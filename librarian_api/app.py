"""AWS Lambda handlers for the Weekly Thing archive librarian."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import math
import os
import re
import secrets
import time
import urllib.parse
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

import boto3
import httpx
import yaml


BUTTONDOWN_BASE = "https://api.buttondown.com/v1"
TINYLYTICS_BASE = "https://tinylytics.app/api/v1"
DEFAULT_TINYLYTICS_SITE_ID = "3063"
DEFAULT_AGENT_MODEL = "us.anthropic.claude-sonnet-4-6"
DEFAULT_EMBEDDING_MODEL = "cohere.embed-english-v3"
DEFAULT_RERANK_MODEL = "cohere.rerank-v3-5:0"
DEFAULT_EMBEDDING_DIMENSIONS = 1024
DEFAULT_MAX_TOOL_TURNS = 8
SESSION_TTL_SECONDS = 60 * 60 * 12
RATE_LIMIT_WINDOW_SECONDS = 60 * 60
RATE_LIMIT_MAX = 20
AUTH_RATE_LIMIT_MAX = 30
PROMPT_RATE_LIMIT_MAX = 10
CONVERSATION_LOG_TTL_DAYS = 60
MAX_HISTORY_MESSAGES = 8
MAX_HISTORY_CHARS = 4000
LIBRARIAN_SOURCE_TAG_ID = "sub_tag_3ts444xst99y08j8bqfnwt1g4h"
TOKEN_RE = re.compile(r"[a-z0-9][a-z0-9'\-]{1,}", re.I)
LOGGER = logging.getLogger(__name__)
LOGGER.setLevel(os.environ.get("LOG_LEVEL", "INFO").upper())
ANSWER_STYLE_INSTRUCTIONS = (
    "Answer like Thingy: a warm, genuinely curious librarian for this specific archive, with the personal, friendly vibe of The Weekly Thing. "
    "You know this is Jamie's long-running weekly notebook of links, observations, travel, web culture, technology, family, and Minnesota life. "
    "Sound like a person helping a reader find their way through a beloved archive, not like a search-results report or enterprise assistant. "
    "Lead with the most interesting interpretation, surprise, or pattern you see, then support it with archive evidence. "
    "Prefer two to five concise paragraphs. Use bullets only when a list is genuinely easier to scan, such as a reading path or comparison. "
    "Vary your openings; do not repeatedly start with phrases like 'The thread I see'. "
    "Avoid canned section labels like 'Short answer', 'Gaps in the archive', 'Evidence and themes', or 'Older vs. newer context' unless the user asks for that structure. "
    "Name concrete details from the sources and explain why they matter. "
    "It is fine to say 'I'd start with...', 'this one has a very Weekly Thing shape', or 'there's a lovely little pattern here' when it fits. "
    "Use light first-person guidance as Thingy when it helps: 'I'd start here', 'the bit I would not miss is...', or 'this is where it gets interesting'. "
    "Prefer plain, human words over analytical labels; avoid sounding like a research memo with words such as 'trajectory', 'synthesis', or 'framing' unless they are truly useful. "
    "If evidence is thin, mention that briefly in the flow of the answer instead of adding a formal limitations section. "
    "Include a concrete reading path only when it directly answers the question. "
    "Do not offer to do more work, suggest what the user can ask next, or ask any closing question. "
    "Do not narrate your tool process or say that you have enough information; start directly with the answer. "
    "Never write customer-support phrasing anywhere, including 'if you want', 'would you like', 'should I', or 'which would you prefer'."
)
EVOLUTION_TERMS = {"evolution", "evolve", "changed", "change", "history", "timeline", "over", "between", "compare", "trend", "progressed"}
CURRENT_TERMS = {"current", "currently", "recent", "latest", "today", "now", "recommend", "recommendation", "should", "best"}
STOPWORDS = {
    "a", "an", "and", "are", "as", "about", "across", "between", "can", "did", "do", "does",
    "for", "from", "has", "have", "how", "in", "is", "it", "jamie", "me", "of", "on", "or",
    "over", "said", "say", "show", "the", "their", "thing", "thingy", "to", "up", "what",
    "where", "with", "weekly", "years",
}

FALLBACK_PROMPTS = [
    {
        "label": "What changed about RSS?",
        "question": "What has the archive said about RSS and the open web?",
    },
    {
        "label": "Where did AI get weird?",
        "question": "Find issues where Jamie wrote about AI.",
    },
    {
        "label": "What should I revisit?",
        "question": "What themes show up around productivity and personal systems?",
    },
]
PROMPTS_RESPONSE_FORMAT = {
    "type": "json_schema",
    "name": "weekly_thing_librarian_prompts",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "prompts": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "label": {"type": "string"},
                        "question": {"type": "string"},
                    },
                    "required": ["label", "question"],
                    "additionalProperties": False,
                },
            }
        },
        "required": ["prompts"],
        "additionalProperties": False,
    },
}


def request_id(event: dict[str, Any] | None = None, context: Any | None = None) -> str:
    if context and getattr(context, "aws_request_id", None):
        return str(context.aws_request_id)
    if event:
        return str(
            event.get("requestContext", {}).get("requestId")
            or event.get("headers", {}).get("x-request-id")
            or ""
        )
    return ""


def log_event(level: str, message: str, **fields: Any) -> None:
    payload = {
        "level": level,
        "message": message,
        "service": "weekly-thing-librarian",
        "timestamp": int(time.time()),
        **{key: value for key, value in fields.items() if value is not None},
    }
    LOGGER.log(getattr(logging, level.upper(), logging.INFO), json.dumps(payload, default=str))


def truthy_env(name: str, default: str = "0") -> bool:
    value = str(os.environ.get(name, default)).strip().lower()
    return value not in {"", "0", "false", "no", "off"}


@lru_cache(maxsize=1)
def bedrock_runtime():
    return boto3.client("bedrock-runtime")


@lru_cache(maxsize=1)
def bedrock_agent_runtime():
    return boto3.client("bedrock-agent-runtime", region_name=os.environ.get("BEDROCK_RERANK_REGION", "us-west-2"))


def agent_model() -> str:
    return os.environ.get("BEDROCK_AGENT_MODEL", DEFAULT_AGENT_MODEL)


def embedding_model() -> str:
    return os.environ.get("BEDROCK_EMBEDDING_MODEL", DEFAULT_EMBEDDING_MODEL)


def rerank_model() -> str:
    return os.environ.get("BEDROCK_RERANK_MODEL", DEFAULT_RERANK_MODEL)


def rerank_model_arn() -> str:
    model = rerank_model()
    if model.startswith("arn:"):
        return model
    region = os.environ.get("BEDROCK_RERANK_REGION", "us-west-2")
    return f"arn:aws:bedrock:{region}::foundation-model/{model}"


def privacy_guard_answer(question: str) -> str | None:
    text = question.lower()
    wants_private_contact = any(term in text for term in ("home address", "street address", "phone number", "cell number", "mobile number", "personal address"))
    if not wants_private_contact:
        return None
    return (
        "I cannot help find or share Jamie's private home address or phone number. "
        "For public contact, use the contact links Jamie publishes on thingelstad.com or reply through the newsletter's normal public channels."
    )


def event_summary(event: dict[str, Any], context: Any | None = None) -> dict[str, Any]:
    method, path = route_key(event)
    headers = {str(k).lower(): v for k, v in (event.get("headers") or {}).items()}
    return {
        "request_id": request_id(event, context),
        "method": method,
        "path": path,
        "origin": headers.get("origin"),
    }


def allowed_origins() -> list[str]:
    value = os.environ.get("ALLOWED_ORIGIN", "https://weekly.thingelstad.com")
    return [origin.strip() for origin in value.split(",") if origin.strip()]


def cors_origin(event: dict[str, Any] | None) -> str:
    origins = allowed_origins()
    if event:
        headers = {str(k).lower(): v for k, v in (event.get("headers") or {}).items()}
        origin = str(headers.get("origin") or "")
        if origin in origins:
            return origin
    return origins[0] if origins else "https://weekly.thingelstad.com"


def json_response(
    status: int,
    payload: dict[str, Any],
    headers: dict[str, str] | None = None,
    event: dict[str, Any] | None = None,
) -> dict[str, Any]:
    result_headers = {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": cors_origin(event),
        "access-control-allow-headers": "content-type, authorization",
        "access-control-allow-methods": "OPTIONS,POST",
    }
    if headers:
        result_headers.update(headers)
    return {"statusCode": status, "headers": result_headers, "body": json.dumps(payload)}


def parse_body(event: dict[str, Any]) -> dict[str, Any]:
    body = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        body = base64.b64decode(body).decode("utf-8")
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def route_key(event: dict[str, Any]) -> tuple[str, str]:
    method = (
        event.get("requestContext", {}).get("http", {}).get("method")
        or event.get("httpMethod")
        or "GET"
    ).upper()
    path = event.get("rawPath") or event.get("path") or "/"
    return method, path.rstrip("/") or "/"


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def unb64url(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def session_secret() -> bytes:
    value = os.environ.get("SESSION_SECRET") or os.environ.get("LIBRARIAN_SIGNING_SECRET")
    if not value:
        raise RuntimeError("SESSION_SECRET is required")
    return value.encode("utf-8")


def sign_payload(payload: dict[str, Any]) -> str:
    encoded = b64url(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    signature = hmac.new(session_secret(), encoded.encode("ascii"), hashlib.sha256).digest()
    return f"{encoded}.{b64url(signature)}"


def verify_token(token: str) -> dict[str, Any] | None:
    try:
        encoded, signature = token.split(".", 1)
        expected = hmac.new(session_secret(), encoded.encode("ascii"), hashlib.sha256).digest()
        if not hmac.compare_digest(unb64url(signature), expected):
            return None
        payload = json.loads(unb64url(encoded))
    except Exception:
        return None
    if int(payload.get("exp", 0)) < int(time.time()):
        return None
    return payload


def normalize_email(email: str) -> str:
    return email.strip().lower()


def email_hash(email: str) -> str:
    return hashlib.sha256(normalize_email(email).encode("utf-8")).hexdigest()


def stable_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def client_identity_hash(event: dict[str, Any]) -> str:
    request_context = event.get("requestContext", {})
    source_ip = (
        request_context.get("http", {}).get("sourceIp")
        or request_context.get("identity", {}).get("sourceIp")
        or "unknown"
    )
    headers = {str(k).lower(): v for k, v in (event.get("headers") or {}).items()}
    user_agent = str(headers.get("user-agent") or "")
    return stable_hash(f"{source_ip}\0{user_agent}")


def client_source_ip(event: dict[str, Any]) -> str | None:
    request_context = event.get("requestContext", {})
    source_ip = (
        request_context.get("http", {}).get("sourceIp")
        or request_context.get("identity", {}).get("sourceIp")
    )
    return str(source_ip) if source_ip else None


def user_agent(event: dict[str, Any]) -> str | None:
    headers = {str(k).lower(): v for k, v in (event.get("headers") or {}).items()}
    value = headers.get("user-agent")
    return str(value) if value else None


def tinylytics_enabled() -> bool:
    enabled = os.environ.get("TINYLYTICS_ENABLED", "1").lower()
    return enabled not in {"0", "false", "no"} and bool(os.environ.get("TINYLYTICS_API_KEY"))


def tinylytics_headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {os.environ['TINYLYTICS_API_KEY']}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "WeeklyThingLibrarian/1.0 (+https://weekly.thingelstad.com)",
    }


@lru_cache(maxsize=1)
def tinylytics_site_id() -> str:
    configured = os.environ.get("TINYLYTICS_SITE_ID") or DEFAULT_TINYLYTICS_SITE_ID
    if configured.isdigit() or not tinylytics_enabled():
        return configured
    try:
        response = httpx.get(f"{TINYLYTICS_BASE}/sites", headers=tinylytics_headers(), timeout=5)
        response.raise_for_status()
        for site in response.json().get("sites", []):
            if str(site.get("uid") or "") == configured:
                return str(site["id"])
            if str(site.get("url") or "").rstrip("/") == "https://weekly.thingelstad.com":
                return str(site["id"])
    except Exception as exc:
        log_event("warning", "tinylytics_site_resolve_failed", error_type=type(exc).__name__)
    return configured


def tinylytics_value(**fields: Any) -> str:
    parts = []
    for key, value in fields.items():
        if value is None or value == "":
            continue
        safe_value = str(value).replace(";", ",").replace("\n", " ")[:120]
        parts.append(f"{key}={safe_value}")
    return ";".join(parts)


def post_tinylytics_event(
    event: dict[str, Any],
    name: str,
    *,
    visitor_id: str | None = None,
    value: str | None = None,
    path: str = "/librarian/api",
) -> None:
    if not tinylytics_enabled():
        return
    site_id = tinylytics_site_id()
    body: dict[str, Any] = {"event": name, "path": path, "source": "librarian-api"}
    if value:
        body["value"] = value
    if visitor_id:
        body["visitor_id"] = visitor_id
    if source_ip := client_source_ip(event):
        body["ip_address"] = source_ip
    try:
        response = httpx.post(
            f"{TINYLYTICS_BASE}/sites/{site_id}/events",
            headers=tinylytics_headers(),
            json=body,
            timeout=2,
        )
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        log_event(
            "warning",
            "tinylytics_event_failed",
            tinylytics_event=name,
            status_code=exc.response.status_code,
            response_text=exc.response.text[:200],
            error_type=type(exc).__name__,
        )
    except Exception as exc:
        log_event("warning", "tinylytics_event_failed", tinylytics_event=name, error_type=type(exc).__name__)


def buttondown_headers() -> dict[str, str]:
    api_key = os.environ.get("BUTTONDOWN_API_KEY")
    if not api_key:
        raise RuntimeError("BUTTONDOWN_API_KEY is required")
    return {"Authorization": f"Token {api_key}"}


def fetch_subscriber(email: str) -> dict[str, Any] | None:
    url = f"{BUTTONDOWN_BASE}/subscribers/{urllib.parse.quote(normalize_email(email), safe='')}"
    start = time.perf_counter()
    response = httpx.get(url, headers=buttondown_headers(), timeout=10)
    log_event(
        "info",
        "buttondown_subscriber_lookup",
        email_hash=email_hash(email),
        status_code=response.status_code,
        duration_ms=round((time.perf_counter() - start) * 1000),
    )
    if response.status_code == 404:
        return None
    response.raise_for_status()
    return response.json()


def create_subscriber(email: str, event: dict[str, Any]) -> dict[str, Any]:
    body: dict[str, Any] = {
        "email_address": normalize_email(email),
        "tags": [LIBRARIAN_SOURCE_TAG_ID],
    }
    source_ip = client_source_ip(event)
    if source_ip:
        body["ip_address"] = source_ip
    start = time.perf_counter()
    response = httpx.post(
        f"{BUTTONDOWN_BASE}/subscribers",
        headers={**buttondown_headers(), "Content-Type": "application/json"},
        json=body,
        timeout=10,
    )
    log_event(
        "info",
        "buttondown_subscriber_create",
        email_hash=email_hash(email),
        status_code=response.status_code,
        duration_ms=round((time.perf_counter() - start) * 1000),
    )
    response.raise_for_status()
    return response.json()


def send_subscriber_reminder(email: str) -> None:
    encoded_email = urllib.parse.quote(normalize_email(email), safe="")
    start = time.perf_counter()
    response = httpx.post(
        f"{BUTTONDOWN_BASE}/subscribers/{encoded_email}/send-reminder",
        headers=buttondown_headers(),
        timeout=10,
    )
    log_event(
        "info",
        "buttondown_subscriber_reminder",
        email_hash=email_hash(email),
        status_code=response.status_code,
        duration_ms=round((time.perf_counter() - start) * 1000),
    )
    response.raise_for_status()


def subscriber_is_active(subscriber: dict[str, Any] | None) -> bool:
    if not subscriber:
        return False
    if subscriber.get("unsubscription_date") or subscriber.get("churn_date"):
        return False
    subscriber_type = str(subscriber.get("type") or "").lower()
    if subscriber_type in {"unactivated", "unsubscribed", "churned", "disabled"}:
        return False
    return True


def subscriber_status(subscriber: dict[str, Any] | None) -> str:
    if not subscriber:
        return "not_found"
    subscriber_type = str(subscriber.get("type") or "").lower()
    if subscriber_type == "unactivated":
        return "unconfirmed"
    if subscriber.get("unsubscription_date") or subscriber.get("churn_date"):
        return "inactive"
    if subscriber_type in {"unsubscribed", "churned", "disabled"}:
        return "inactive"
    if subscriber_type == "premium":
        return "premium"
    return "active"


def bedrock_text_response(
    system_text: str,
    user_text: str,
    *,
    max_tokens: int = 700,
    temperature: float = 0.4,
) -> str:
    response = bedrock_runtime().converse(
        modelId=agent_model(),
        system=[{"text": system_text}, {"cachePoint": {"type": "default"}}],
        messages=[{"role": "user", "content": [{"text": user_text}]}],
        inferenceConfig={"maxTokens": max_tokens, "temperature": temperature},
    )
    text = extract_bedrock_text(response.get("output", {}).get("message", {})).strip()
    if not text:
        raise ValueError("Bedrock returned an empty response")
    log_event(
        "info",
        "bedrock_text_generated",
        model=agent_model(),
        stop_reason=response.get("stopReason"),
        output_tokens=(response.get("usage") or {}).get("outputTokens"),
    )
    return text


def generate_premium_thank_you() -> str:
    start = time.perf_counter()
    text = bedrock_text_response(
        (
            "You are Thingy, the Weekly Thing archive librarian. "
            "Write one warm, concise thank-you for a premium subscriber who just unlocked the archive librarian. "
            "Mention that they are a Weekly Thing Supporting Member. "
            "Return plain text only. No greeting, markdown, emoji, or signoff."
        ),
        "Generate a fresh thank-you under 28 words.",
        max_tokens=120,
        temperature=0.7,
    )
    text = re.sub(r"\s+", " ", text)
    if not text or len(text) > 220:
        raise ValueError("Bedrock returned invalid premium thank-you")
    log_event(
        "info",
        "premium_thank_you_generated",
        model=agent_model(),
        duration_ms=round((time.perf_counter() - start) * 1000),
        message_chars=len(text),
    )
    return text


def auth_success_response(email: str, subscriber: dict[str, Any], table: Any, event: dict[str, Any], start: float) -> dict[str, Any]:
    session_id = secrets.token_urlsafe(18)
    expires_at = int(time.time()) + SESSION_TTL_SECONDS
    token = sign_payload({"sid": session_id, "sub": email_hash(email), "exp": expires_at})
    record_session(table, session_id, email, expires_at)
    status = subscriber_status(subscriber)
    log_event(
        "info",
        "auth_succeeded",
        email_hash=email_hash(email),
        subscriber_status=status,
        duration_ms=round((time.perf_counter() - start) * 1000),
    )
    post_tinylytics_event(
        event,
        "librarian.auth_success",
        visitor_id=email_hash(email),
        value=tinylytics_value(member=email_hash(email), status=status),
    )
    payload: dict[str, Any] = {"status": status, "token": token, "expires_at": expires_at}
    if status == "premium":
        try:
            payload["message"] = generate_premium_thank_you()
        except (Exception,) as exc:
            log_event("warning", "premium_thank_you_generation_failed", email_hash=email_hash(email), error_type=type(exc).__name__)
            payload["message"] = "Thanks for being a Weekly Thing Supporting Member!"
    return json_response(200, payload, event=event)


def dynamodb_table():
    table_name = os.environ.get("TABLE_NAME")
    if not table_name:
        return None
    return boto3.resource("dynamodb").Table(table_name)


def record_session(table: Any, session_id: str, email: str, expires_at: int) -> None:
    if not table:
        return
    start = time.perf_counter()
    table.put_item(
        Item={
            "pk": f"session#{session_id}",
            "sk": "session",
            "email_hash": email_hash(email),
            "expires_at": expires_at,
            "ttl": expires_at,
        }
    )
    log_event(
        "info",
        "session_recorded",
        email_hash=email_hash(email),
        duration_ms=round((time.perf_counter() - start) * 1000),
    )


def check_rate_limit(table: Any, identity: str, max_requests: int | None = None) -> bool:
    if not table:
        return True
    max_allowed = max_requests if max_requests is not None else int(os.environ.get("RATE_LIMIT_MAX", RATE_LIMIT_MAX))
    now = int(time.time())
    window = now // RATE_LIMIT_WINDOW_SECONDS
    key = f"rate#{identity}#{window}"
    response = table.update_item(
        Key={"pk": key, "sk": "rate"},
        UpdateExpression="ADD #count :one SET #ttl = :ttl",
        ExpressionAttributeNames={"#count": "count", "#ttl": "ttl"},
        ExpressionAttributeValues={":one": 1, ":ttl": now + RATE_LIMIT_WINDOW_SECONDS * 2},
        ReturnValues="UPDATED_NEW",
    )
    count = int(response["Attributes"].get("count", 0))
    log_event(
        "info",
        "rate_limit_checked",
        identity_hash=identity,
        count=count,
        limit=max_allowed,
        allowed=count <= max_allowed,
    )
    return count <= max_allowed


def conversation_logging_enabled() -> bool:
    return os.environ.get("LIBRARIAN_CONVERSATION_LOGGING", "1").lower() not in {"0", "false", "no"}


def citation_issues(citations: list[dict[str, Any]]) -> list[str]:
    issues = []
    seen = set()
    for citation in citations:
        issue = str(citation.get("issue_number") or "").strip()
        if issue and issue not in seen:
            seen.add(issue)
            issues.append(issue)
    return issues


def record_conversation(
    table: Any,
    *,
    event: dict[str, Any],
    subscriber_hash: str,
    question: str,
    answer: str,
    history_count: int,
    citations: list[dict[str, Any]],
    route: str,
) -> None:
    if not table or not conversation_logging_enabled():
        return
    started = time.perf_counter()
    now = datetime.now(timezone.utc)
    ttl = int(time.time()) + int(os.environ.get("LIBRARIAN_CONVERSATION_LOG_TTL_DAYS", CONVERSATION_LOG_TTL_DAYS)) * 86400
    req_id = request_id(event) or secrets.token_urlsafe(8)
    issues = citation_issues(citations)
    try:
        table.put_item(
            Item={
                "pk": f"conversation#{now.isoformat()}#{req_id}",
                "sk": "chat",
                "created_at": now.isoformat().replace("+00:00", "Z"),
                "ttl": ttl,
                "request_id": req_id,
                "subscriber_hash": subscriber_hash,
                "route": route,
                "question": question[:4000],
                "answer": answer[:12000],
                "question_chars": len(question),
                "answer_chars": len(answer),
                "history_count": history_count,
                "citation_count": len(citations),
                "source_issues": issues,
                "citations": citations[:12],
            }
        )
        log_event(
            "info",
            "conversation_recorded",
            subscriber_hash=subscriber_hash,
            request_id=req_id,
            question_chars=len(question),
            answer_chars=len(answer),
            citation_count=len(citations),
            duration_ms=round((time.perf_counter() - started) * 1000),
        )
    except Exception as exc:
        log_event("warning", "conversation_record_failed", request_id=req_id, error_type=type(exc).__name__)


def auth_handler(event: dict[str, Any]) -> dict[str, Any]:
    start = time.perf_counter()
    body = parse_body(event)
    email = normalize_email(str(body.get("email") or ""))
    action = str(body.get("action") or "check").strip().lower()
    hashed_email = email_hash(email) if email else None
    table = dynamodb_table()
    auth_limit = int(os.environ.get("AUTH_RATE_LIMIT_MAX", AUTH_RATE_LIMIT_MAX))
    if not check_rate_limit(table, f"auth#{client_identity_hash(event)}", auth_limit):
        log_event("warning", "auth_rate_limited", email_hash=hashed_email)
        return json_response(429, {"error": "Too many access attempts. Please try again later."}, event=event)
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        log_event("info", "auth_rejected_invalid_email", email_hash=hashed_email)
        return json_response(400, {"error": "Enter a valid email address."}, event=event)
    if action not in {"check", "subscribe", "resend_confirmation"}:
        log_event("info", "auth_rejected_invalid_action", email_hash=hashed_email, action=action)
        return json_response(400, {"error": "Unsupported subscriber action."}, event=event)

    if action == "subscribe":
        try:
            subscriber = create_subscriber(email, event)
        except httpx.HTTPError as exc:
            log_event("error", "buttondown_subscriber_create_failed", email_hash=hashed_email, error_type=type(exc).__name__)
            return json_response(502, {"error": "Could not add that email right now."}, event=event)
        status = subscriber_status(subscriber)
        log_event("info", "auth_subscribe_completed", email_hash=hashed_email, subscriber_status=status)
        return json_response(
            200,
            {
                "status": "subscribed",
                "subscriber_status": status,
                "message": "Check your inbox to confirm your subscription before using Thingy.",
            },
            event=event,
        )

    if action == "resend_confirmation":
        try:
            send_subscriber_reminder(email)
        except httpx.HTTPError as exc:
            log_event("error", "buttondown_subscriber_reminder_failed", email_hash=hashed_email, error_type=type(exc).__name__)
            return json_response(
                502,
                {
                    "status": "reminder_unavailable",
                    "error": "Could not resend the confirmation email right now. Please look for the original confirmation email.",
                },
                event=event,
            )
        return json_response(
            200,
            {"status": "reminder_sent", "message": "Confirmation email sent. Check your inbox."},
            event=event,
        )

    try:
        subscriber = fetch_subscriber(email)
    except httpx.HTTPError as exc:
        log_event("error", "buttondown_lookup_failed", email_hash=hashed_email, error_type=type(exc).__name__)
        return json_response(502, {"error": "Could not validate subscriber status right now."}, event=event)

    status = subscriber_status(subscriber)
    if status == "not_found":
        log_event("info", "auth_subscriber_not_found", email_hash=hashed_email)
        return json_response(
            200,
            {"status": "not_found", "message": "That email is not subscribed. Would you like to be added?"},
            event=event,
        )
    if status == "unconfirmed":
        log_event("info", "auth_subscriber_unconfirmed", email_hash=hashed_email)
        return json_response(
            200,
            {
                "status": "unconfirmed",
                "message": "Please confirm your email before using Thingy.",
            },
            event=event,
        )
    if status == "inactive":
        log_event("info", "auth_rejected_inactive_subscriber", email_hash=hashed_email)
        return json_response(
            200,
            {"status": "inactive", "message": "I could not verify active subscriber access for that email."},
            event=event,
        )

    return auth_success_response(email, subscriber or {}, table, event, start)


def extract_bearer(event: dict[str, Any], body: dict[str, Any]) -> str:
    headers = {str(k).lower(): v for k, v in (event.get("headers") or {}).items()}
    auth = str(headers.get("authorization") or "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return str(body.get("token") or "")


def tokenize(text: str) -> list[str]:
    return [m.group(0).lower() for m in TOKEN_RE.finditer(text)]


def plain_text(markdown: str) -> str:
    text = re.sub(r"!\[[^\]]*\]\([^)]+\)", "", markdown or "")
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"^#{1,6}\s+", "", text, flags=re.M)
    text = re.sub(r"[*_>~]+", "", text)
    return " ".join(text.split())


def content_terms(text: str) -> set[str]:
    return {term for term in tokenize(text) if term not in STOPWORDS and len(term) > 2}


def parse_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def source_age_days(source: dict[str, Any]) -> int | None:
    published = parse_datetime(source.get("publish_date"))
    if not published:
        return None
    return max((datetime.now(timezone.utc) - published).days, 0)


def source_age_label(source: dict[str, Any]) -> str:
    days = source_age_days(source)
    if days is None:
        return "unknown age"
    if days < 45:
        return "recent"
    if days < 365:
        return f"about {max(round(days / 30), 1)} months old"
    return f"about {max(round(days / 365), 1)} years old"


def recency_score(source: dict[str, Any]) -> float:
    days = source_age_days(source)
    if days is None:
        return 0.0
    return 1.0 / (1.0 + days / 365.0)


def query_intent(query: str) -> str:
    terms = set(tokenize(query))
    if terms & EVOLUTION_TERMS:
        return "evolution"
    if terms & CURRENT_TERMS:
        return "current"
    return "general"


def normalize_scores(items: list[tuple[float, dict[str, Any], str]]) -> list[tuple[float, dict[str, Any], str]]:
    if not items:
        return []
    maximum = max(score for score, _, _ in items) or 1.0
    return [(score / maximum, source, mode) for score, source, mode in items if score > 0]


@lru_cache(maxsize=1)
def load_corpus() -> dict[str, Any]:
    bucket = os.environ.get("CORPUS_BUCKET")
    key = os.environ.get("CORPUS_KEY", "librarian/corpus.json")
    start = time.perf_counter()
    if bucket:
        response = boto3.client("s3").get_object(Bucket=bucket, Key=key)
        corpus = json.loads(response["Body"].read().decode("utf-8"))
        log_event(
            "info",
            "corpus_loaded",
            source="s3",
            bucket=bucket,
            key=key,
            chunk_count=corpus.get("chunk_count") or len(corpus.get("chunks", [])),
            embedding_dimensions=corpus.get("embedding_dimensions"),
            duration_ms=round((time.perf_counter() - start) * 1000),
        )
        return corpus

    local_path = Path(__file__).resolve().parents[1] / "data" / "librarian" / "corpus.json"
    corpus = json.loads(local_path.read_text(encoding="utf-8"))
    log_event(
        "info",
        "corpus_loaded",
        source="local",
        chunk_count=corpus.get("chunk_count") or len(corpus.get("chunks", [])),
        embedding_dimensions=corpus.get("embedding_dimensions"),
        duration_ms=round((time.perf_counter() - start) * 1000),
    )
    return corpus


@lru_cache(maxsize=1)
def load_graph() -> dict[str, Any]:
    bucket = os.environ.get("CORPUS_BUCKET")
    key = os.environ.get("GRAPH_KEY", "librarian/graph.json")
    start = time.perf_counter()
    if bucket:
        try:
            response = boto3.client("s3").get_object(Bucket=bucket, Key=key)
            graph = json.loads(response["Body"].read().decode("utf-8"))
            log_event(
                "info",
                "graph_loaded",
                source="s3",
                bucket=bucket,
                key=key,
                issue_count=len(graph.get("issues", {})),
                duration_ms=round((time.perf_counter() - start) * 1000),
            )
            return graph
        except Exception as exc:
            log_event("warning", "graph_load_failed", source="s3", key=key, error_type=type(exc).__name__)
            return {}

    local_path = Path(__file__).resolve().parents[1] / "data" / "librarian" / "graph.json"
    if not local_path.exists():
        return {}
    graph = json.loads(local_path.read_text(encoding="utf-8"))
    log_event(
        "info",
        "graph_loaded",
        source="local",
        issue_count=len(graph.get("issues", {})),
        duration_ms=round((time.perf_counter() - start) * 1000),
    )
    return graph


@lru_cache(maxsize=1)
def indexed_chunks() -> list[dict[str, Any]]:
    chunks = load_corpus().get("chunks", [])
    document_frequency: dict[str, int] = {}
    indexed = []
    for chunk in chunks:
        terms = tokenize(" ".join([chunk.get("subject", ""), chunk.get("section", ""), chunk.get("text", "")]))
        term_counts: dict[str, int] = {}
        for term in terms:
            term_counts[term] = term_counts.get(term, 0) + 1
        for term in term_counts:
            document_frequency[term] = document_frequency.get(term, 0) + 1
        indexed.append({**chunk, "_terms": term_counts})

    total = max(len(indexed), 1)
    for chunk in indexed:
        vector = {}
        norm = 0.0
        for term, count in chunk["_terms"].items():
            weight = (1 + math.log(count)) * math.log(1 + total / (1 + document_frequency.get(term, 0)))
            vector[term] = weight
            norm += weight * weight
        chunk["_vector"] = vector
        chunk["_norm"] = math.sqrt(norm) or 1.0
    return indexed


def cosine(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    dot = 0.0
    left_norm = 0.0
    right_norm = 0.0
    for a, b in zip(left, right):
        dot += a * b
        left_norm += a * a
        right_norm += b * b
    if not left_norm or not right_norm:
        return 0.0
    return dot / (math.sqrt(left_norm) * math.sqrt(right_norm))


def embed_query(query: str, model: str, dimensions: int) -> list[float]:
    start = time.perf_counter()
    response = bedrock_runtime().invoke_model(
        modelId=model,
        body=json.dumps({"texts": [query], "input_type": "search_query", "truncate": "END"}),
        accept="application/json",
        contentType="application/json",
    )
    data = json.loads(response["body"].read())
    embeddings = data.get("embeddings") or []
    if not embeddings:
        raise RuntimeError("Bedrock embedding response did not include embeddings")
    log_event(
        "info",
        "query_embedded",
        model=model,
        dimensions=dimensions,
        duration_ms=round((time.perf_counter() - start) * 1000),
    )
    return embeddings[0]


def retrieve_semantic(query: str, limit: int = 8) -> list[dict[str, Any]]:
    start = time.perf_counter()
    scored = score_semantic(query)
    result = [item for _, item, _ in scored[:limit]]
    log_event(
        "info",
        "retrieval_completed",
        mode="semantic",
        result_count=len(result),
        duration_ms=round((time.perf_counter() - start) * 1000),
    )
    return result


def score_semantic(query: str) -> list[tuple[float, dict[str, Any], str]]:
    corpus = load_corpus()
    chunks = [chunk for chunk in corpus.get("chunks", []) if chunk.get("embedding")]
    if not chunks:
        return []
    model = corpus.get("embedding_model") or embedding_model()
    dimensions = int(corpus.get("embedding_dimensions") or DEFAULT_EMBEDDING_DIMENSIONS)
    query_embedding = embed_query(query, model, dimensions)
    scored = []
    for chunk in chunks:
        score = cosine(query_embedding, chunk["embedding"])
        if score > 0:
            scored.append((score, {k: v for k, v in chunk.items() if k != "embedding"}, "semantic"))
    scored.sort(key=lambda item: item[0], reverse=True)
    return normalize_scores(scored)


def retrieve_lexical(query: str, limit: int = 8) -> list[dict[str, Any]]:
    start = time.perf_counter()
    scored = score_lexical(query)
    result = [item for _, item, _ in scored[:limit]]
    log_event(
        "info",
        "retrieval_completed",
        mode="lexical",
        result_count=len(result),
        duration_ms=round((time.perf_counter() - start) * 1000),
    )
    return result


def score_lexical(query: str) -> list[tuple[float, dict[str, Any], str]]:
    query_terms: dict[str, int] = {}
    for term in tokenize(query):
        query_terms[term] = query_terms.get(term, 0) + 1
    if not query_terms:
        return []

    scored = []
    for chunk in indexed_chunks():
        score = 0.0
        for term, count in query_terms.items():
            score += chunk["_vector"].get(term, 0.0) * count
        if score > 0:
            scored.append((score / chunk["_norm"], {k: v for k, v in chunk.items() if not k.startswith("_")}, "lexical"))
    scored.sort(key=lambda item: item[0], reverse=True)
    return normalize_scores(scored)


def issue_summary_source(issue: dict[str, Any], score: float, reason: str) -> tuple[float, dict[str, Any], str]:
    summary = issue.get("summary") or {}
    text_parts = [str(summary.get("abstract") or "")]
    text_parts.extend(str(point) for point in summary.get("key_points", [])[:4])
    source = {
        "id": f"issue-summary:{issue.get('number')}",
        "issue_number": issue.get("number"),
        "subject": issue.get("subject"),
        "publish_date": issue.get("publish_date"),
        "issue_year": issue.get("issue_year"),
        "url": issue.get("url"),
        "section": "Issue summary",
        "text": "\n".join(part for part in text_parts if part),
        "topics": issue.get("topics", []),
        "source_kind": "issue_summary",
        "retrieval_reason": reason,
    }
    return score, source, "graph"


def score_graph(query: str) -> list[tuple[float, dict[str, Any], str]]:
    corpus = load_corpus()
    query_terms = content_terms(query)
    if not query_terms:
        return []
    topic_matches = []
    for topic in corpus.get("topics", []):
        topic_terms = content_terms(topic.get("name", ""))
        overlap = len(query_terms & topic_terms)
        if overlap:
            topic_matches.append((overlap, topic))
    matched_topics = {topic["name"]: overlap for overlap, topic in topic_matches}
    scored = []
    for issue in corpus.get("issues", []):
        issue_topics = set(issue.get("topics", []))
        topic_score = sum(matched_topics.get(topic, 0) for topic in issue_topics)
        summary_text = " ".join(
            [
                str(issue.get("subject", "")),
                str((issue.get("summary") or {}).get("abstract", "")),
                " ".join(issue.get("topics", [])),
            ]
        )
        lexical_overlap = len(query_terms & content_terms(summary_text))
        score = topic_score * 2.0 + lexical_overlap
        if score > 0:
            scored.append(issue_summary_source(issue, score, "topic/summary match"))
    scored.sort(key=lambda item: (item[0], recency_score(item[1])), reverse=True)
    return normalize_scores(scored)


def parse_year_range(value: Any) -> tuple[int | None, int | None]:
    if not value:
        return None, None
    if isinstance(value, (list, tuple)) and len(value) == 2:
        start, end = value
    elif isinstance(value, dict):
        start, end = value.get("start") or value.get("from"), value.get("end") or value.get("to")
    else:
        text = str(value)
        years = [int(year) for year in re.findall(r"\b(20\d{2}|19\d{2})\b", text)]
        if len(years) >= 2:
            start, end = min(years), max(years)
        elif len(years) == 1:
            start = end = years[0]
        else:
            return None, None
    try:
        start_year = int(start) if start is not None and str(start).strip() else None
    except (TypeError, ValueError):
        start_year = None
    try:
        end_year = int(end) if end is not None and str(end).strip() else None
    except (TypeError, ValueError):
        end_year = None
    if start_year and end_year and start_year > end_year:
        start_year, end_year = end_year, start_year
    return start_year, end_year


def source_matches_filters(source: dict[str, Any], year_range: Any = None, section: str | None = None) -> bool:
    start_year, end_year = parse_year_range(year_range)
    issue_year = source.get("issue_year")
    if start_year and (not issue_year or int(issue_year) < start_year):
        return False
    if end_year and (not issue_year or int(issue_year) > end_year):
        return False
    if section:
        wanted = section.strip().lower()
        if wanted and wanted not in str(source.get("section") or "").lower():
            return False
    return True


def rerank_document(source: dict[str, Any]) -> str:
    return "\n".join(
        [
            f"Weekly Thing #{source.get('issue_number')}: {source.get('subject', '')}",
            f"Date: {source.get('publish_date', '')}",
            f"Section: {source.get('section', '')}",
            f"Topics: {', '.join(source.get('topics', []))}",
            plain_text(str(source.get("text") or ""))[:1800],
        ]
    )


def rerank_sources(query: str, scored: list[tuple[float, dict[str, Any]]], limit: int) -> list[tuple[float, dict[str, Any]]]:
    if not scored or not truthy_env("LIBRARIAN_RERANK_ENABLED", "1"):
        return scored[:limit]
    start = time.perf_counter()
    top = scored[: max(limit * 5, 40)]
    sources = [
        {
            "type": "INLINE",
            "inlineDocumentSource": {
                "type": "TEXT",
                "textDocument": {"text": rerank_document(source)},
            },
        }
        for _, source in top
    ]
    try:
        response = bedrock_agent_runtime().rerank(
            queries=[{"type": "TEXT", "textQuery": {"text": query}}],
            sources=sources,
            rerankingConfiguration={
                "type": "BEDROCK_RERANKING_MODEL",
                "bedrockRerankingConfiguration": {
                    "numberOfResults": min(len(sources), max(limit, 8)),
                    "modelConfiguration": {"modelArn": rerank_model_arn()},
                },
            },
        )
        ordered = []
        for item in response.get("results", []):
            index = int(item.get("index", -1))
            if 0 <= index < len(top):
                original_score, source = top[index]
                source = dict(source)
                relevance = float(item.get("relevanceScore") or original_score)
                source["_rerank_score"] = round(relevance, 4)
                ordered.append((relevance + original_score * 0.05, source))
        if ordered:
            log_event(
                "info",
                "rerank_completed",
                model=rerank_model(),
                candidate_count=len(top),
                result_count=len(ordered),
                duration_ms=round((time.perf_counter() - start) * 1000),
            )
            return ordered
    except Exception as exc:
        log_event("warning", "rerank_failed", model=rerank_model(), error_type=type(exc).__name__)
    return scored[:limit]


def source_key(source: dict[str, Any]) -> str:
    return str(source.get("id") or f"{source.get('source_kind', 'chunk')}:{source.get('issue_number')}:{source.get('section')}")


def blended_score(base_score: float, source: dict[str, Any], intent: str) -> float:
    recency_weight = 0.36 if intent == "current" else 0.12 if intent == "general" else 0.0
    graph_weight = 0.04 if source.get("source_kind") == "issue_summary" else 0.0
    return base_score + recency_weight * recency_score(source) + graph_weight


def diversify_sources(scored: list[tuple[float, dict[str, Any]]], limit: int, intent: str) -> list[dict[str, Any]]:
    selected = []
    issue_counts: dict[str, int] = {}
    kind_counts: dict[str, int] = {}
    for score, source in scored:
        issue = str(source.get("issue_number"))
        kind = str(source.get("source_kind") or "chunk")
        max_per_issue = 3 if intent == "evolution" else 2
        max_per_kind = 4 if intent == "evolution" else 3
        if issue_counts.get(issue, 0) >= max_per_issue:
            continue
        if kind == "issue_summary" and kind_counts.get(kind, 0) >= max_per_kind:
            continue
        source["_retrieval_score"] = round(score, 4)
        source["age_label"] = source_age_label(source)
        selected.append(source)
        issue_counts[issue] = issue_counts.get(issue, 0) + 1
        kind_counts[kind] = kind_counts.get(kind, 0) + 1
        if len(selected) >= limit:
            break
    return selected


def retrieve(query: str, limit: int = 8, year_range: Any = None, section: str | None = None, rerank: bool = True) -> list[dict[str, Any]]:
    start = time.perf_counter()
    intent = query_intent(query)
    candidates: dict[str, tuple[float, dict[str, Any], set[str]]] = {}
    semantic_error = None
    try:
        semantic = score_semantic(query)[: max(limit * 4, 24)]
    except (Exception,) as exc:
        semantic_error = type(exc).__name__
        log_event("error", "semantic_retrieval_failed", error_type=semantic_error)
        semantic = []
    lexical = score_lexical(query)[: max(limit * 4, 24)]
    graph = score_graph(query)[: max(limit * 6, 48)]
    weights = {"semantic": 0.58, "lexical": 0.32, "graph": 0.22}
    for score, source, mode in [*semantic, *lexical, *graph]:
        key = source_key(source)
        weighted = score * weights.get(mode, 0.25)
        if key not in candidates:
            source = dict(source)
            candidates[key] = (0.0, source, set())
        current, candidate, modes = candidates[key]
        modes.add(mode)
        candidate["retrieval_modes"] = sorted(modes)
        candidate["retrieval_reason"] = candidate.get("retrieval_reason") or "+".join(sorted(modes))
        candidates[key] = (current + weighted, candidate, modes)
    scored = [
        (blended_score(score, source, intent), source)
        for score, source, _ in candidates.values()
        if source_matches_filters(source, year_range, section)
    ]
    scored.sort(key=lambda item: item[0], reverse=True)
    reranked = rerank_sources(query, scored, limit=max(limit, 8)) if rerank else scored[:limit]
    result = diversify_sources(reranked, limit, intent)
    log_event(
        "info",
        "retrieval_completed",
        mode="hybrid",
        intent=intent,
        result_count=len(result),
        semantic_candidates=len(semantic),
        lexical_candidates=len(lexical),
        graph_candidates=len(graph),
        reranked=rerank and bool(scored),
        semantic_error=semantic_error,
        source_years=",".join(str(item.get("issue_year") or "") for item in result[:12]),
        duration_ms=round((time.perf_counter() - start) * 1000),
    )
    return result


def issue_number_key(value: Any) -> str:
    return str(value or "").strip().lstrip("#")


def issue_sort_key(value: Any) -> tuple[int, str]:
    text = str(value)
    match = re.match(r"(\d+)", text)
    return (int(match.group(1)), text) if match else (10**9, text)


def parse_year(value: str) -> int | None:
    match = re.match(r"(\d{4})", str(value or ""))
    return int(match.group(1)) if match else None


def issue_by_number(number: Any) -> dict[str, Any] | None:
    wanted = issue_number_key(number)
    for issue in load_corpus().get("issues", []):
        if issue_number_key(issue.get("number")) == wanted:
            return issue
    return None


def issue_sections(issue: dict[str, Any]) -> list[dict[str, Any]]:
    sections = issue.get("sections")
    if isinstance(sections, list) and sections:
        return [section for section in sections if isinstance(section, dict)]
    chunks = [
        chunk for chunk in load_corpus().get("chunks", [])
        if issue_number_key(chunk.get("issue_number")) == issue_number_key(issue.get("number"))
    ]
    grouped: dict[str, list[str]] = {}
    for chunk in chunks:
        grouped.setdefault(str(chunk.get("section") or "Issue"), []).append(str(chunk.get("text") or ""))
    return [{"name": name, "text": "\n\n".join(parts)} for name, parts in grouped.items()]


def compact_source(source: dict[str, Any], text_limit: int = 900) -> dict[str, Any]:
    return {
        "issue_number": source.get("issue_number"),
        "subject": source.get("subject"),
        "publish_date": source.get("publish_date"),
        "issue_year": source.get("issue_year"),
        "section": source.get("section"),
        "age": source.get("age_label") or source_age_label(source),
        "score": source.get("_rerank_score") or source.get("_retrieval_score"),
        "reason": source.get("retrieval_reason") or ", ".join(source.get("retrieval_modes", [])),
        "url": source.get("url"),
        "topics": source.get("topics", []),
        "text": str(source.get("text") or "")[:text_limit],
    }


def tool_search_archive(args: dict[str, Any]) -> dict[str, Any]:
    query = str(args.get("query") or "").strip()
    if not query:
        return {"results": []}
    limit = min(max(int(args.get("limit") or 8), 1), 12)
    results = retrieve(
        query,
        limit=limit,
        year_range=args.get("year_range"),
        section=str(args.get("section") or "").strip() or None,
    )
    return {"query": query, "results": [compact_source(item) for item in results]}


def tool_get_issue(args: dict[str, Any]) -> dict[str, Any]:
    issue = issue_by_number(args.get("number"))
    if not issue:
        return {"error": "Issue not found."}
    sections = issue_sections(issue)
    body = issue.get("body") or "\n\n".join(f"## {section.get('name')}\n{section.get('text', '')}" for section in sections)
    return {
        "issue": {
            "number": issue.get("number"),
            "subject": issue.get("subject"),
            "publish_date": issue.get("publish_date"),
            "url": issue.get("url"),
            "topics": issue.get("topics", []),
            "sections": [{"name": section.get("name"), "word_count": len(tokenize(section.get("text", "")))} for section in sections],
            "body": str(body)[:16000],
        }
    }


def tool_get_section(args: dict[str, Any]) -> dict[str, Any]:
    issue = issue_by_number(args.get("number"))
    wanted = str(args.get("section") or "").strip().lower()
    if not issue or not wanted:
        return {"error": "Issue or section not found."}
    for section in issue_sections(issue):
        name = str(section.get("name") or "")
        if wanted == name.lower() or wanted in name.lower():
            return {
                "issue_number": issue.get("number"),
                "subject": issue.get("subject"),
                "publish_date": issue.get("publish_date"),
                "section": name,
                "url": issue.get("url"),
                "text": str(section.get("text") or "")[:12000],
            }
    return {"error": "Section not found.", "available_sections": [section.get("name") for section in issue_sections(issue)]}


def normalized_domain(value: str) -> str:
    value = re.sub(r"^https?://", "", str(value or "").strip().lower())
    return value.split("/", 1)[0].removeprefix("www.")


def link_records() -> list[dict[str, Any]]:
    corpus = load_corpus()
    if isinstance(corpus.get("links"), list):
        if corpus["links"]:
            return corpus["links"]
    records = []
    for issue in corpus.get("issues", []):
        for link in issue.get("links", []) or []:
            if isinstance(link, dict):
                records.append({**link, "issue_number": issue.get("number"), "subject": issue.get("subject"), "publish_date": issue.get("publish_date"), "issue_year": issue.get("issue_year"), "url": issue.get("url")})
    if records:
        return records
    archive_dir = Path(__file__).resolve().parents[1] / "src" / "archive"
    if archive_dir.exists():
        frontmatter_re = re.compile(r"^---\s*\n(.*?)\n---\s*\n?", re.S)
        for path in sorted(archive_dir.glob("*.md"), key=lambda p: issue_sort_key(p.stem)):
            text = path.read_text(encoding="utf-8")
            match = frontmatter_re.match(text)
            if not match:
                continue
            metadata = yaml.safe_load(match.group(1)) or {}
            number = metadata.get("number") or path.stem
            subject = metadata.get("subject") or f"Weekly Thing {number}"
            publish_date = metadata.get("publish_date") or ""
            for link in metadata.get("links") or []:
                if isinstance(link, dict):
                    records.append(
                        {
                            "issue_number": number,
                            "subject": subject,
                            "publish_date": publish_date,
                            "issue_year": parse_year(str(publish_date)),
                            "url": link.get("url"),
                            "domain": link.get("domain"),
                            "section": link.get("section"),
                            "text": link.get("text") or link.get("title") or link.get("heading_context"),
                            "heading_context": link.get("heading_context"),
                            "context": link.get("context") or link.get("heading_context"),
                        }
                    )
    return records


def tool_find_links(args: dict[str, Any]) -> dict[str, Any]:
    domain = normalized_domain(str(args.get("domain") or ""))
    topic = str(args.get("topic") or "").strip().lower()
    start_year, end_year = parse_year_range(args.get("year_range"))
    limit = min(max(int(args.get("limit") or 20), 1), 50)
    results = []
    graph = load_graph()
    entity_index = graph.get("entity_index", {}) if isinstance(graph, dict) else {}
    issue_matches = set(entity_index.get(topic, [])) if topic else set()
    filtered_links = []
    for link in link_records():
        link_domain = normalized_domain(str(link.get("domain") or link.get("url") or ""))
        if domain and domain not in link_domain:
            continue
        year = link.get("issue_year")
        if start_year and (not year or int(year) < start_year):
            continue
        if end_year and (not year or int(year) > end_year):
            continue
        haystack = " ".join(str(link.get(key) or "") for key in ("text", "title", "section", "heading_context", "context", "domain")).lower()
        if topic and topic not in haystack and issue_number_key(link.get("issue_number")) not in issue_matches:
            continue
        filtered_links.append(link)
        if len(results) < limit:
            results.append(
                {
                    "issue_number": link.get("issue_number"),
                    "subject": link.get("subject"),
                    "publish_date": link.get("publish_date"),
                    "section": link.get("section"),
                    "domain": link.get("domain"),
                    "link_text": link.get("text") or link.get("title") or link.get("heading_context"),
                    "context": link.get("context") or link.get("heading_context"),
                    "url": link.get("url"),
                }
            )
    domain_counts: dict[str, int] = {}
    for link in filtered_links:
        link_domain = normalized_domain(str(link.get("domain") or link.get("url") or ""))
        if link_domain:
            domain_counts[link_domain] = domain_counts.get(link_domain, 0) + 1
    top_domains = [
        {"domain": name, "count": count}
        for name, count in sorted(domain_counts.items(), key=lambda item: (-item[1], item[0]))[:20]
    ]
    return {"results": results, "top_domains": top_domains}


def tool_domain_history(args: dict[str, Any]) -> dict[str, Any]:
    domain = normalized_domain(str(args.get("domain") or ""))
    if not domain:
        return {"error": "domain is required", "results": []}
    return tool_find_links({"domain": domain, "limit": args.get("limit") or 80})


def context_around(text: str, phrase: str, radius: int = 240) -> str:
    lower = text.lower()
    index = lower.find(phrase.lower())
    if index < 0:
        return ""
    start = max(0, index - radius)
    end = min(len(text), index + len(phrase) + radius)
    return text[start:end].strip()


def tool_quote_search(args: dict[str, Any]) -> dict[str, Any]:
    phrase = str(args.get("phrase") or "").strip()
    if len(phrase) < 3:
        return {"results": []}
    limit = min(max(int(args.get("limit") or 20), 1), 50)
    results = []
    for issue in load_corpus().get("issues", []):
        body = str(issue.get("body") or "")
        if not body:
            body = "\n\n".join(section.get("text", "") for section in issue_sections(issue))
        if phrase.lower() in body.lower():
            results.append(
                {
                    "issue_number": issue.get("number"),
                    "subject": issue.get("subject"),
                    "publish_date": issue.get("publish_date"),
                    "url": issue.get("url"),
                    "context": context_around(body, phrase),
                }
            )
            if len(results) >= limit:
                break
    return {"phrase": phrase, "results": results}


def tool_list_issues(args: dict[str, Any]) -> dict[str, Any]:
    year = args.get("year")
    topic = str(args.get("topic") or args.get("entity") or "").strip().lower()
    limit = min(max(int(args.get("limit") or 60), 1), 120)
    graph = load_graph()
    entity_index = graph.get("entity_index", {}) if isinstance(graph, dict) else {}
    issue_matches = set(entity_index.get(topic, [])) if topic else set()
    results = []
    topic_counts: dict[str, int] = {}
    entity_counts: dict[str, int] = {}
    trope_counts: dict[str, int] = {}
    for issue in load_corpus().get("issues", []):
        graph_issue = (graph.get("issues", {}) or {}).get(issue_number_key(issue.get("number")), {})
        for issue_topic in issue.get("topics", []):
            topic_counts[issue_topic] = topic_counts.get(issue_topic, 0) + 1
        for entity in graph_issue.get("entities", [])[:20]:
            key = str(entity).lower()
            entity_counts[key] = entity_counts.get(key, 0) + 1
        for trope in graph_issue.get("tropes", [])[:12]:
            key = str(trope).lower()
            trope_counts[key] = trope_counts.get(key, 0) + 1
        if year and int(issue.get("issue_year") or 0) != int(year):
            continue
        text = " ".join([str(issue.get("subject") or ""), " ".join(issue.get("topics", []))]).lower()
        if topic and topic not in text and issue_number_key(issue.get("number")) not in issue_matches:
            continue
        if len(results) < limit:
            results.append(
                {
                    "number": issue.get("number"),
                    "issue_number": issue.get("number"),
                    "subject": issue.get("subject"),
                    "publish_date": issue.get("publish_date"),
                    "url": issue.get("url"),
                    "topics": issue.get("topics", []),
                    "entities": graph_issue.get("entities", [])[:12],
                    "tropes": graph_issue.get("tropes", [])[:6],
                }
            )
    return {
        "results": results,
        "topic_counts": [{"topic": name, "count": count} for name, count in sorted(topic_counts.items(), key=lambda item: (-item[1], item[0]))[:20]],
        "entity_counts": [{"entity": name, "count": count} for name, count in sorted(entity_counts.items(), key=lambda item: (-item[1], item[0]))[:20]],
        "trope_counts": [{"trope": name, "count": count} for name, count in sorted(trope_counts.items(), key=lambda item: (-item[1], item[0]))[:20]],
    }


def year_window(value: Any) -> list[int] | None:
    try:
        year = int(value)
    except (TypeError, ValueError):
        return None
    return [year, year]


def tool_compare_eras(args: dict[str, Any]) -> dict[str, Any]:
    topic = str(args.get("topic") or "").strip()
    if not topic:
        return {"error": "topic is required"}
    limit = min(max(int(args.get("limit") or 6), 1), 10)
    first = retrieve(topic, limit=limit, year_range=args.get("year_a") or year_window(args.get("year_a")), rerank=True)
    second = retrieve(topic, limit=limit, year_range=args.get("year_b") or year_window(args.get("year_b")), rerank=True)
    return {
        "topic": topic,
        "year_a": args.get("year_a"),
        "year_b": args.get("year_b"),
        "results_a": [compact_source(item, text_limit=700) for item in first],
        "results_b": [compact_source(item, text_limit=700) for item in second],
    }


ARCHIVE_TOOLS = {
    "search_archive": tool_search_archive,
    "get_issue": tool_get_issue,
    "get_section": tool_get_section,
    "find_links": tool_find_links,
    "domain_history": tool_domain_history,
    "quote_search": tool_quote_search,
    "list_issues": tool_list_issues,
    "compare_eras": tool_compare_eras,
}


def sanitize_history(history: Any) -> list[dict[str, str]]:
    if not isinstance(history, list):
        return []
    cleaned = []
    chars = 0
    for item in history[-MAX_HISTORY_MESSAGES:]:
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        if role not in {"user", "assistant"}:
            continue
        content = re.sub(r"\s+", " ", str(item.get("content") or "").strip())
        if not content:
            continue
        clipped = content[:700]
        chars += len(clipped)
        if chars > MAX_HISTORY_CHARS:
            break
        cleaned.append({"role": role, "content": clipped})
    return cleaned


def retrieval_query(question: str, history: list[dict[str, str]]) -> str:
    context = "\n".join(f"{item['role']}: {item['content']}" for item in history[-4:])
    return "\n\n".join(part for part in [context, f"user: {question}"] if part)[-MAX_HISTORY_CHARS:]


def conversation_context(history: list[dict[str, str]]) -> str:
    if not history:
        return "No earlier conversation in this session."
    return "\n".join(
        f"{'User' if item['role'] == 'user' else 'Thingy'}: {item['content']}"
        for item in history
    )


def build_prompt(question: str, chunks: list[dict[str, Any]], history: list[dict[str, str]] | None = None) -> str:
    history = history or []
    sources = []
    for index, chunk in enumerate(chunks, 1):
        sources.append(
            "\n".join(
                [
                    f"Source {index}: Weekly Thing #{chunk['issue_number']} - {chunk['subject']}",
                    f"Date: {chunk.get('publish_date', '')}",
                    f"Age: {chunk.get('age_label') or source_age_label(chunk)}",
                    f"Source kind: {chunk.get('source_kind', 'chunk')}",
                    f"Retrieval reason: {chunk.get('retrieval_reason') or ', '.join(chunk.get('retrieval_modes', []))}",
                    f"Topics: {', '.join(chunk.get('topics', []))}",
                    f"Section: {chunk.get('section', '')}",
                    f"URL: {chunk.get('url', '')}",
                    chunk.get("text", ""),
                ]
            )
        )
    return (
        "You are Thingy, the archive librarian for The Weekly Thing. You are not Jamie. "
        "When referring to Jamie Thingelstad, use he/him pronouns. "
        "Use only the archive sources below unless you explicitly say something is outside the archive. "
        "Use the conversation context to resolve follow-up questions, pronouns, and requests like 'tell me more'. "
        "Prefer newer sources for current recommendations or present-day guidance. "
        "Use older sources as historical context unless the user asks for history or evolution. "
        "When sources span years, explicitly distinguish older context from more recent writing. "
        "Be direct, specific, and helpful. Do not use a greeting or signoff. "
        f"{ANSWER_STYLE_INSTRUCTIONS} "
        "Keep answers under 500 words unless the user asks for more detail. "
        "Cite issue numbers inline for substantive claims, using references like #295 or (#295, #297). "
        "Do not include URLs in prose. "
        "If the archive sources are not enough, say so. "
        "Do not end by asking whether the user wants more. If a next step is useful, provide it directly.\n\n"
        "Conversation so far:\n\n"
        f"{conversation_context(history)}\n\n"
        f"Question: {question}\n\n"
        "Archive sources:\n\n"
        + "\n\n---\n\n".join(sources)
    )


def extract_bedrock_text(message: dict[str, Any]) -> str:
    parts = []
    for block in message.get("content", []) or []:
        if "text" in block:
            parts.append(str(block.get("text") or ""))
    return "\n".join(part for part in parts if part)


def call_bedrock_answer(question: str, chunks: list[dict[str, Any]], history: list[dict[str, str]] | None = None) -> str:
    history = history or []
    start = time.perf_counter()
    system_text = (
            "You are Thingy, the archive librarian for The Weekly Thing. You are not Jamie. "
            "When referring to Jamie Thingelstad, use he/him pronouns. "
            "Be direct, specific, and helpful. Do not use a greeting or signoff. "
            f"{ANSWER_STYLE_INSTRUCTIONS} "
            "Keep answers under 500 words unless the user asks for more detail. "
            "Use conversation context for follow-ups. "
            "Prefer newer sources for current guidance, but deliberately use older sources for history and evolution questions. "
            "When sources span years, distinguish older context from newer writing. "
            "Cite issue numbers inline for substantive claims using #295 or (#295, #297), do not include URLs in prose, "
            "say when the archive does not contain enough evidence, and do not end by asking whether the user wants more."
    )
    response = bedrock_runtime().converse(
        modelId=agent_model(),
        system=[{"text": system_text}, {"cachePoint": {"type": "default"}}],
        messages=[{"role": "user", "content": [{"text": build_prompt(question, chunks, history)}]}],
        inferenceConfig={
            "maxTokens": int(os.environ.get("BEDROCK_MAX_OUTPUT_TOKENS", "2500")),
            "temperature": float(os.environ.get("BEDROCK_TEMPERATURE", "0.45")),
        },
    )
    answer = polish_answer(extract_bedrock_text(response.get("output", {}).get("message", {})).strip())
    log_event("info", "answer_generated", model=agent_model(), duration_ms=round((time.perf_counter() - start) * 1000), answer_chars=len(answer))
    return answer


def call_archive_answer(question: str, chunks: list[dict[str, Any]], history: list[dict[str, str]] | None = None) -> str:
    return call_bedrock_answer(question, chunks, history)


def tool_specs() -> list[dict[str, Any]]:
    return [
        {
            "toolSpec": {
                "name": "search_archive",
                "description": "Hybrid search over Weekly Thing chunks. Use iteratively for topics, themes, and evidence gathering.",
                "inputSchema": {"json": {"type": "object", "properties": {"query": {"type": "string"}, "year_range": {"type": ["array", "string", "object"]}, "section": {"type": "string"}, "limit": {"type": "integer"}}, "required": ["query"]}},
            }
        },
        {
            "toolSpec": {
                "name": "get_issue",
                "description": "Return one full Weekly Thing issue with section structure preserved.",
                "inputSchema": {"json": {"type": "object", "properties": {"number": {"type": ["string", "integer"]}}, "required": ["number"]}},
            }
        },
        {
            "toolSpec": {
                "name": "get_section",
                "description": "Return a named section from one issue.",
                "inputSchema": {"json": {"type": "object", "properties": {"number": {"type": ["string", "integer"]}, "section": {"type": "string"}}, "required": ["number", "section"]}},
            }
        },
        {
            "toolSpec": {
                "name": "find_links",
                "description": "Query the editorial link graph by domain, topic/entity, and year range. Does not fetch linked pages.",
                "inputSchema": {"json": {"type": "object", "properties": {"domain": {"type": "string"}, "topic": {"type": "string"}, "year_range": {"type": ["array", "string", "object"]}, "limit": {"type": "integer"}}}},
            }
        },
        {
            "toolSpec": {
                "name": "domain_history",
                "description": "List every issue that cited a domain with date and surrounding link context.",
                "inputSchema": {"json": {"type": "object", "properties": {"domain": {"type": "string"}, "limit": {"type": "integer"}}, "required": ["domain"]}},
            }
        },
        {
            "toolSpec": {
                "name": "quote_search",
                "description": "Exact substring search across issue bodies for questions like whether Jamie ever said a phrase.",
                "inputSchema": {"json": {"type": "object", "properties": {"phrase": {"type": "string"}, "limit": {"type": "integer"}}, "required": ["phrase"]}},
            }
        },
        {
            "toolSpec": {
                "name": "list_issues",
                "description": "Metadata-only issue listing filtered by year, topic, or entity.",
                "inputSchema": {"json": {"type": "object", "properties": {"year": {"type": ["integer", "string"]}, "topic": {"type": "string"}, "entity": {"type": "string"}, "limit": {"type": "integer"}}}},
            }
        },
        {
            "toolSpec": {
                "name": "compare_eras",
                "description": "Search the same topic in two year windows and return both result sets.",
                "inputSchema": {"json": {"type": "object", "properties": {"topic": {"type": "string"}, "year_a": {"type": ["integer", "string", "array", "object"]}, "year_b": {"type": ["integer", "string", "array", "object"]}, "limit": {"type": "integer"}}, "required": ["topic", "year_a", "year_b"]}},
            }
        },
        {"cachePoint": {"type": "default"}},
    ]


AGENT_SYSTEM_PROMPT = (
    "You are Thingy, the archive librarian for The Weekly Thing. You are not Jamie. "
    "Use the supplied archive tools to investigate before answering. Do not rely on memory or outside web content. "
    "Use search_archive first for broad thematic questions, quote_search for exact wording, domain_history/find_links for link-domain questions, "
    "get_issue/get_section when you need full context, and compare_eras for before/after questions. "
    "For named products, unusual phrases, remembered snippets, and likely-not-covered questions, use quote_search before synthesizing; do not infer exact coverage from related search hits. "
    "For aggregate pattern questions, use list_issues for topic/entity/trope counts and find_links without filters for top domains. "
    "For evolution questions, inspect early, middle, and recent windows before answering. "
    "Never provide private personal data such as a home address or phone number; redirect to public contact methods. "
    "Do not imitate Jamie's exact living-person voice; if asked to write in his style, write a clearly archive-inspired Weekly Thing-style entry instead. "
    "For reading paths, choose a small sequence of issues or sections and explain why each belongs. "
    "For changed-his-mind or theme-summary questions, gather evidence from multiple years before synthesizing. "
    "Cite issue numbers inline for substantive claims using #295 or (#295, #297), and do not include URLs in prose. "
    f"{ANSWER_STYLE_INSTRUCTIONS} "
    "Keep answers under 500 words unless the user asks for more detail. "
    "If the archive tools do not provide enough evidence, say so directly in the answer."
)


def agent_user_prompt(question: str, history: list[dict[str, str]]) -> str:
    return (
        "Conversation so far:\n\n"
        f"{conversation_context(history)}\n\n"
        f"User question: {question}\n\n"
        "Investigate with tools as needed, then answer as Thingy."
    )


def execute_tool_use(tool_use: dict[str, Any]) -> dict[str, Any]:
    name = str(tool_use.get("name") or "")
    args = tool_use.get("input") if isinstance(tool_use.get("input"), dict) else {}
    start = time.perf_counter()
    if name not in ARCHIVE_TOOLS:
        result = {"error": f"Unknown tool: {name}"}
    else:
        try:
            result = ARCHIVE_TOOLS[name](args)
        except Exception as exc:
            log_event("error", "tool_call_failed", tool_name=name, error_type=type(exc).__name__)
            result = {"error": f"{name} failed: {type(exc).__name__}"}
    log_event("info", "tool_call_completed", tool_name=name, duration_ms=round((time.perf_counter() - start) * 1000))
    return result


def collect_citation_sources(tool_results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    sources = []
    for result in tool_results:
        candidates = []
        if isinstance(result.get("results"), list):
            candidates.extend(result["results"])
        if isinstance(result.get("results_a"), list):
            candidates.extend(result["results_a"])
        if isinstance(result.get("results_b"), list):
            candidates.extend(result["results_b"])
        if isinstance(result.get("issue"), dict):
            issue = result["issue"]
            candidates.append({"issue_number": issue.get("number"), **issue})
        for item in candidates:
            if isinstance(item, dict) and item.get("issue_number"):
                sources.append(
                    {
                        "issue_number": item.get("issue_number"),
                        "subject": item.get("subject"),
                        "publish_date": item.get("publish_date"),
                        "section": item.get("section") or "Issue",
                        "url": item.get("url") or f"/archive/{item.get('issue_number')}/",
                        "source_kind": "tool",
                        "text": item.get("text") or item.get("body") or item.get("summary") or "",
                    }
                )
    return citations_for(sources)


def prioritize_citations_for_answer(citations: list[dict[str, Any]], answer: str) -> list[dict[str, Any]]:
    mentioned = [int(match) for match in re.findall(r"#(\d+)", answer or "")]
    if not mentioned:
        return citations
    first_seen: dict[int, int] = {}
    for index, issue_number in enumerate(mentioned):
        first_seen.setdefault(issue_number, index)
    original_index = {id(citation): index for index, citation in enumerate(citations)}
    return sorted(
        citations,
        key=lambda citation: (
            first_seen.get(int(citation.get("issue_number") or -1), 10_000),
            original_index[id(citation)],
        ),
    )


def run_agent(question: str, history: list[dict[str, str]] | None = None) -> tuple[str, list[dict[str, Any]], list[dict[str, Any]]]:
    history = history or []
    start = time.perf_counter()
    messages = [{"role": "user", "content": [{"text": agent_user_prompt(question, history)}]}]
    tool_results: list[dict[str, Any]] = []
    tool_trace: list[dict[str, Any]] = []
    max_turns = int(os.environ.get("MAX_TOOL_TURNS", DEFAULT_MAX_TOOL_TURNS))
    final_answer = ""
    for turn in range(max_turns + 1):
        response = bedrock_runtime().converse(
            modelId=agent_model(),
            system=[{"text": AGENT_SYSTEM_PROMPT}, {"cachePoint": {"type": "default"}}],
            messages=messages,
            toolConfig={"tools": tool_specs()},
            inferenceConfig={
                "maxTokens": int(os.environ.get("BEDROCK_MAX_OUTPUT_TOKENS", "2500")),
                "temperature": float(os.environ.get("BEDROCK_TEMPERATURE", "0.45")),
            },
        )
        message = response.get("output", {}).get("message", {})
        messages.append(message)
        tool_uses = [block["toolUse"] for block in message.get("content", []) if isinstance(block, dict) and block.get("toolUse")]
        if not tool_uses:
            final_answer = polish_answer(extract_bedrock_text(message))
            break
        if turn >= max_turns:
            messages.append(
                {
                    "role": "user",
                    "content": [{"text": "Tool turn limit reached. Answer from the evidence already gathered and mention any limits briefly."}],
                }
            )
            final_response = bedrock_runtime().converse(
                modelId=agent_model(),
                system=[{"text": AGENT_SYSTEM_PROMPT}, {"cachePoint": {"type": "default"}}],
                messages=messages,
                inferenceConfig={
                    "maxTokens": int(os.environ.get("BEDROCK_MAX_OUTPUT_TOKENS", "2500")),
                    "temperature": float(os.environ.get("BEDROCK_TEMPERATURE", "0.45")),
                },
            )
            final_answer = polish_answer(extract_bedrock_text(final_response.get("output", {}).get("message", {})))
            break
        result_blocks = []
        for tool_use in tool_uses:
            result = execute_tool_use(tool_use)
            tool_results.append(result)
            tool_trace.append({"name": tool_use.get("name"), "result_count": len(result.get("results", [])) if isinstance(result, dict) else 0})
            result_blocks.append(
                {
                    "toolResult": {
                        "toolUseId": tool_use.get("toolUseId"),
                        "content": [{"json": result}],
                    }
                }
            )
        messages.append({"role": "user", "content": result_blocks})
    if not final_answer:
        final_answer = "I could not produce a reliable answer from the archive tools for that question."
    citations = prioritize_citations_for_answer(collect_citation_sources(tool_results), final_answer)
    log_event(
        "info",
        "agent_completed",
        model=agent_model(),
        tool_turns=len(tool_results),
        citation_count=len(citations),
        duration_ms=round((time.perf_counter() - start) * 1000),
    )
    return final_answer, citations, tool_trace


def polish_answer(answer: str) -> str:
    answer = answer.strip()
    if not answer:
        return answer
    process_starts = (
        "i have everything i need",
        "now i have everything",
        "i have enough",
        "i have a rich",
        "let me put this together",
    )
    banned_starts = (
        "if you want",
        "if you'd like",
        "if you would like",
        "would you like",
        "should i",
        "which would you prefer",
    )
    paragraphs = re.split(r"\n\s*\n", answer)
    cleaned_paragraphs = []
    for paragraph in paragraphs:
        stripped = paragraph.strip()
        lower = stripped.lower()
        if lower.startswith(process_starts):
            continue
        if lower.startswith(banned_starts):
            if re.match(r"^if you want\s*,?\s*i can\b", stripped, flags=re.I):
                continue
            stripped = re.sub(
                r"^If you want(?: to)?\s*,?\s*",
                "To ",
                stripped,
                flags=re.I,
            )
            stripped = re.sub(
                r"^If you'd like(?: to)?\s*|^If you would like(?: to)?\s*",
                "To ",
                stripped,
                flags=re.I,
            )
            stripped = re.sub(r"^To a\s+", "A ", stripped)
        cleaned_paragraphs.append(stripped)
    paragraphs = cleaned_paragraphs
    while paragraphs and paragraphs[-1].strip().lower().startswith(banned_starts):
        paragraphs.pop()
    answer = "\n\n".join(paragraphs).strip()
    return re.sub(
        r"\s+(?:If you want|If you'd like|If you would like|Would you like|Should I|Which would you prefer)[^.?!]*(?:[.?!])?\s*$",
        "",
        answer,
        flags=re.I,
    ).strip()


def prompt_context() -> str:
    corpus = load_corpus()
    issues = corpus.get("issues", [])
    recent = issues[-24:]
    selected = recent[::3] if len(recent) > 12 else recent
    if not selected:
        selected = issues[-8:]
    lines = []
    for issue in selected[-8:]:
        lines.append(
            f"#{issue.get('number')}: {issue.get('subject', '')} "
            f"({str(issue.get('publish_date') or '')[:10]})"
        )
    return "\n".join(lines)


def sanitize_prompts(value: Any) -> list[dict[str, str]]:
    if isinstance(value, dict):
        value = value.get("prompts")
    prompts: list[dict[str, str]] = []
    if not isinstance(value, list):
        return []
    for item in value:
        if not isinstance(item, dict):
            continue
        label = str(item.get("label") or "").strip()
        question = str(item.get("question") or "").strip()
        if not label or not question:
            continue
        prompts.append({"label": label[:72], "question": question[:220]})
        if len(prompts) == 3:
            break
    return prompts if len(prompts) == 3 else []


def extract_json_object(text: str) -> Any:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.S)
        if not match:
            raise
        return json.loads(match.group(0))


def generate_prompts() -> list[dict[str, str]]:
    start = time.perf_counter()
    text = bedrock_text_response(
        (
            "You are Thingy, the archive librarian for The Weekly Thing. "
            "Generate exactly three personal, genuine, friendly conversation starters a subscriber could ask about the archive. "
            "They should feel like The Weekly Thing: curious, specific, warm, and a little playful without being cute, poetic, or clever. "
            "Use plain-spoken questions that a real reader would naturally click. "
            "Avoid topic-only labels like 'Theme evolution', 'Privacy & Security', or 'Travel & Place'. "
            "Avoid sterile labels like an enterprise search product. "
            "Each visible label must be a natural, friendly question under 8 words. "
            "The full question can be a little more specific, but keep it under 18 words. "
            "Return only JSON with this shape: {\"prompts\":[{\"label\":\"...\",\"question\":\"...\"}]}."
        ),
        (
            "Recent archive context:\n"
            f"{prompt_context()}\n\n"
            "Make the prompts feel like easy ways to start talking with Thingy, not research tasks. "
            "Good label examples: \"What got Jamie thinking?\", \"Where did AI get weird?\", "
            "\"What should I revisit?\", \"Any open web gems?\", \"What feels hopeful here?\", "
            "\"What changed about RSS?\", \"What did Jamie notice?\" "
            "Avoid long multi-part questions, issue ranges, subtitles, academic wording, and generic topic categories."
        ),
        max_tokens=700,
        temperature=0.7,
    )
    prompts = sanitize_prompts(extract_json_object(text))
    if not prompts:
        raise ValueError("Bedrock returned invalid prompts")
    log_event(
        "info",
        "prompts_generated",
        model=agent_model(),
        duration_ms=round((time.perf_counter() - start) * 1000),
    )
    return prompts


def prompts_handler(event: dict[str, Any]) -> dict[str, Any]:
    body = parse_body(event)
    payload = verify_token(extract_bearer(event, body))
    if not payload:
        return json_response(401, {"error": "Please validate your subscriber email to use the librarian."}, event=event)

    table = dynamodb_table()
    prompt_limit = int(os.environ.get("PROMPT_RATE_LIMIT_MAX", PROMPT_RATE_LIMIT_MAX))
    if not check_rate_limit(table, f"prompts#{payload.get('sid') or payload['sub']}", prompt_limit):
        return json_response(429, {"error": "The librarian is at the hourly prompt limit for this session."}, event=event)

    try:
        prompts = generate_prompts()
        source = "generated"
    except (Exception,) as exc:
        log_event(
            "error",
            "prompt_generation_failed",
            subscriber_hash=payload.get("sub"),
            error_type=type(exc).__name__,
            error_detail=str(exc)[:160],
        )
        prompts = FALLBACK_PROMPTS
        source = "fallback"
    post_tinylytics_event(
        event,
        "librarian.prompts_generated",
        visitor_id=str(payload.get("sub") or ""),
        value=tinylytics_value(member=payload.get("sub"), source=source),
    )
    return json_response(200, {"prompts": prompts, "source": source}, event=event)


def citations_for(chunks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen = set()
    citations = []
    for chunk in chunks:
        key = (chunk.get("issue_number"), chunk.get("section"))
        if key in seen:
            continue
        seen.add(key)
        citations.append(
            {
                "issue_number": chunk.get("issue_number"),
                "subject": chunk.get("subject"),
                "publish_date": chunk.get("publish_date"),
                "section": chunk.get("section"),
                "url": chunk.get("url"),
                "age_label": chunk.get("age_label") or source_age_label(chunk),
                "source_kind": chunk.get("source_kind", "chunk"),
                "topic": ", ".join(chunk.get("topics", [])[:3]),
                "text": str(chunk.get("text") or chunk.get("body") or chunk.get("summary") or "")[:900],
            }
        )
    return citations


def chat_handler(event: dict[str, Any]) -> dict[str, Any]:
    start = time.perf_counter()
    body = parse_body(event)
    payload = verify_token(extract_bearer(event, body))
    if not payload:
        return json_response(401, {"error": "Please validate your subscriber email to use the librarian."}, event=event)

    question = str(body.get("message") or "").strip()
    history = sanitize_history(body.get("history"))
    if not question:
        return json_response(400, {"error": "Ask a question about the archive."}, event=event)
    if len(question) > int(os.environ.get("MAX_QUESTION_CHARS", "1200")):
        return json_response(400, {"error": "Please ask a shorter question."}, event=event)

    table = dynamodb_table()
    if not check_rate_limit(table, str(payload["sub"])):
        return json_response(429, {"error": "The librarian is at the hourly limit for this session."}, event=event)

    guarded_answer = privacy_guard_answer(question)
    if guarded_answer:
        citations: list[dict[str, Any]] = []
        record_conversation(
            table,
            event=event,
            subscriber_hash=str(payload.get("sub") or ""),
            question=question,
            answer=guarded_answer,
            history_count=len(history),
            citations=citations,
            route="chat",
        )
        post_tinylytics_event(
            event,
            "librarian.chat_success",
            visitor_id=str(payload.get("sub") or ""),
            value=tinylytics_value(member=payload.get("sub"), citations=0, history=len(history), chars=len(question)),
        )
        return json_response(200, {"answer": guarded_answer, "citations": citations}, event=event)

    agent_enabled = truthy_env("LIBRARIAN_AGENT_ENABLED", "0")
    chunks = [] if agent_enabled else retrieve(retrieval_query(question, history))
    if not agent_enabled and not chunks:
        post_tinylytics_event(
            event,
            "librarian.chat_no_sources",
            visitor_id=str(payload.get("sub") or ""),
            value=tinylytics_value(member=payload.get("sub"), history=len(history), chars=len(question)),
        )
        log_event(
            "info",
            "chat_completed_no_sources",
            subscriber_hash=payload.get("sub"),
            question_chars=len(question),
            duration_ms=round((time.perf_counter() - start) * 1000),
        )
        return json_response(
            200,
            {
                "answer": "I could not find enough in the archive to answer that from Weekly Thing sources. I can try a broader search term, look for a specific issue, or compare this topic with another archive theme.",
                "citations": [],
            },
            event=event,
        )

    try:
        if agent_enabled:
            answer, citations, _trace = run_agent(question, history)
            if not citations:
                citations = []
        else:
            answer = call_archive_answer(question, chunks, history)
            citations = citations_for(chunks)
    except (Exception,) as exc:
        post_tinylytics_event(
            event,
            "librarian.api_error",
            visitor_id=str(payload.get("sub") or ""),
            value=tinylytics_value(member=payload.get("sub"), route="chat", type=type(exc).__name__),
        )
        log_event("error", "answer_generation_failed", subscriber_hash=payload.get("sub"), error_type=type(exc).__name__)
        return json_response(502, {"error": "The librarian could not generate an answer right now."}, event=event)

    record_conversation(
        table,
        event=event,
        subscriber_hash=str(payload.get("sub") or ""),
        question=question,
        answer=answer,
        history_count=len(history),
        citations=citations,
        route="chat",
    )
    post_tinylytics_event(
        event,
        "librarian.chat_success",
        visitor_id=str(payload.get("sub") or ""),
        value=tinylytics_value(member=payload.get("sub"), citations=len(citations), history=len(history), chars=len(question)),
    )
    log_event(
        "info",
        "chat_completed",
        subscriber_hash=payload.get("sub"),
        question_chars=len(question),
        history_count=len(history),
        citation_count=len(citations),
        duration_ms=round((time.perf_counter() - start) * 1000),
    )
    return json_response(200, {"answer": answer, "citations": citations}, event=event)


def health_handler(event: dict[str, Any]) -> dict[str, Any]:
    return json_response(
        200,
        {
            "ok": True,
            "service": "weekly-thing-librarian",
            "model": agent_model(),
            "embedding_model": embedding_model(),
            "rerank_model": rerank_model(),
            "agent_enabled": truthy_env("LIBRARIAN_AGENT_ENABLED", "0"),
        },
        event=event,
    )


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    start = time.perf_counter()
    summary = event_summary(event, context)
    log_event("info", "request_started", **summary)
    try:
        method, path = route_key(event)
        if method == "OPTIONS":
            response = json_response(204, {}, event=event)
        elif method == "GET" and path.endswith("/health"):
            response = health_handler(event)
        elif method == "POST" and path.endswith("/auth"):
            response = auth_handler(event)
        elif method == "POST" and path.endswith("/prompts"):
            response = prompts_handler(event)
        elif method == "POST" and path.endswith("/chat"):
            response = chat_handler(event)
        else:
            response = json_response(404, {"error": "Not found."}, event=event)
    except Exception as exc:
        post_tinylytics_event(
            event,
            "librarian.api_error",
            value=tinylytics_value(route=summary.get("path"), type=type(exc).__name__),
        )
        log_event("error", "request_failed", **summary, error_type=type(exc).__name__)
        response = json_response(500, {"error": "Thingy is unavailable right now."}, event=event)
    response.setdefault("headers", {})["x-request-id"] = summary.get("request_id", "")
    log_event(
        "info",
        "request_completed",
        **summary,
        status_code=response.get("statusCode"),
        duration_ms=round((time.perf_counter() - start) * 1000),
    )
    return response
