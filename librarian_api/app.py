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
from functools import lru_cache
from pathlib import Path
from typing import Any

import boto3
import httpx


BUTTONDOWN_BASE = "https://api.buttondown.com/v1"
OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"
OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings"
TINYLYTICS_BASE = "https://tinylytics.app/api/v1"
DEFAULT_TINYLYTICS_SITE_ID = "3063"
DEFAULT_MODEL = "gpt-5-mini"
DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small"
DEFAULT_EMBEDDING_DIMENSIONS = 256
SESSION_TTL_SECONDS = 60 * 60 * 12
RATE_LIMIT_WINDOW_SECONDS = 60 * 60
RATE_LIMIT_MAX = 20
AUTH_RATE_LIMIT_MAX = 30
PROMPT_RATE_LIMIT_MAX = 10
MAX_HISTORY_MESSAGES = 8
MAX_HISTORY_CHARS = 4000
LIBRARIAN_SOURCE_TAG_ID = "sub_tag_3ts444xst99y08j8bqfnwt1g4h"
TOKEN_RE = re.compile(r"[a-z0-9][a-z0-9'\-]{1,}", re.I)
LOGGER = logging.getLogger(__name__)
LOGGER.setLevel(os.environ.get("LOG_LEVEL", "INFO").upper())

FALLBACK_PROMPTS = [
    {
        "label": "RSS and the open web",
        "question": "What has the archive said about RSS and the open web?",
    },
    {
        "label": "AI in the archive",
        "question": "Find issues where Jamie wrote about AI.",
    },
    {
        "label": "Productivity themes",
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


def openai_api_key() -> str:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is required")
    return api_key


def embed_query(query: str, model: str, dimensions: int) -> list[float]:
    start = time.perf_counter()
    response = httpx.post(
        OPENAI_EMBEDDINGS_URL,
        headers={"Authorization": f"Bearer {openai_api_key()}", "Content-Type": "application/json"},
        json={"model": model, "input": query, "encoding_format": "float", "dimensions": dimensions},
        timeout=20,
    )
    response.raise_for_status()
    log_event(
        "info",
        "query_embedded",
        model=model,
        dimensions=dimensions,
        duration_ms=round((time.perf_counter() - start) * 1000),
    )
    return response.json()["data"][0]["embedding"]


def retrieve_semantic(query: str, limit: int = 8) -> list[dict[str, Any]]:
    start = time.perf_counter()
    corpus = load_corpus()
    chunks = [chunk for chunk in corpus.get("chunks", []) if chunk.get("embedding")]
    if not chunks:
        return []
    model = corpus.get("embedding_model") or os.environ.get("OPENAI_EMBEDDING_MODEL", DEFAULT_EMBEDDING_MODEL)
    dimensions = int(corpus.get("embedding_dimensions") or os.environ.get("OPENAI_EMBEDDING_DIMENSIONS", DEFAULT_EMBEDDING_DIMENSIONS))
    query_embedding = embed_query(query, model, dimensions)
    scored = [(cosine(query_embedding, chunk["embedding"]), chunk) for chunk in chunks]
    scored = [item for item in scored if item[0] > 0]
    scored.sort(key=lambda item: item[0], reverse=True)
    result = []
    for _, chunk in scored[:limit]:
        result.append({k: v for k, v in chunk.items() if k != "embedding"})
    log_event(
        "info",
        "retrieval_completed",
        mode="semantic",
        result_count=len(result),
        duration_ms=round((time.perf_counter() - start) * 1000),
    )
    return result


def retrieve_lexical(query: str, limit: int = 8) -> list[dict[str, Any]]:
    start = time.perf_counter()
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
            scored.append((score / chunk["_norm"], chunk))
    scored.sort(key=lambda item: item[0], reverse=True)
    result = [{k: v for k, v in chunk.items() if not k.startswith("_")} for _, chunk in scored[:limit]]
    log_event(
        "info",
        "retrieval_completed",
        mode="lexical",
        result_count=len(result),
        duration_ms=round((time.perf_counter() - start) * 1000),
    )
    return result


def retrieve(query: str, limit: int = 8) -> list[dict[str, Any]]:
    try:
        semantic = retrieve_semantic(query, limit=limit)
    except (httpx.HTTPError, RuntimeError, MemoryError) as exc:
        log_event("error", "semantic_retrieval_failed", error_type=type(exc).__name__)
        semantic = []
    return semantic or retrieve_lexical(query, limit=limit)


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
                    f"Section: {chunk.get('section', '')}",
                    f"URL: {chunk.get('url', '')}",
                    chunk.get("text", ""),
                ]
            )
        )
    return (
        "You are Thingy, the archive librarian for The Weekly Thing. You are not Jamie. "
        "Use only the archive sources below unless you explicitly say something is outside the archive. "
        "Use the conversation context to resolve follow-up questions, pronouns, and requests like 'tell me more'. "
        "Be direct, specific, and helpful. Do not use a greeting or signoff. "
        "Keep answers under 500 words unless the user asks for more detail. "
        "Cite issue numbers inline for substantive claims, using references like #295 or (#295, #297). "
        "Do not include URLs in prose. "
        "If the archive sources are not enough, say so. "
        "End with one concise, specific next-step offer describing what Thingy can do from here.\n\n"
        "Conversation so far:\n\n"
        f"{conversation_context(history)}\n\n"
        f"Question: {question}\n\n"
        "Archive sources:\n\n"
        + "\n\n---\n\n".join(sources)
    )


def call_openai(question: str, chunks: list[dict[str, Any]], history: list[dict[str, str]] | None = None) -> str:
    history = history or []
    start = time.perf_counter()
    model = os.environ.get("OPENAI_MODEL", DEFAULT_MODEL)
    payload = {
        "model": model,
        "instructions": (
            "You are Thingy, the archive librarian for The Weekly Thing. You are not Jamie. "
            "Be direct, specific, and helpful. Do not use a greeting or signoff. "
            "Keep answers under 500 words unless the user asks for more detail. "
            "Use conversation context for follow-ups. "
            "Cite issue numbers inline for substantive claims using #295 or (#295, #297), do not include URLs in prose, "
            "say when the archive does not contain enough evidence, and end with one concise, specific next-step offer."
        ),
        "input": build_prompt(question, chunks, history),
        "max_output_tokens": int(os.environ.get("OPENAI_MAX_OUTPUT_TOKENS", "2500")),
    }
    response = httpx.post(
        OPENAI_RESPONSES_URL,
        headers={
            "Authorization": f"Bearer {openai_api_key()}",
            "content-type": "application/json",
        },
        json=payload,
        timeout=30,
    )
    response.raise_for_status()
    data = response.json()
    if data.get("output_text"):
        answer = str(data["output_text"]).strip()
        log_event("info", "answer_generated", model=model, duration_ms=round((time.perf_counter() - start) * 1000), answer_chars=len(answer))
        return answer
    parts = []
    for item in data.get("output", []):
        for content in item.get("content", []):
            if content.get("type") in {"output_text", "text"}:
                parts.append(content.get("text", ""))
    answer = "\n".join(part for part in parts if part).strip()
    log_event("info", "answer_generated", model=model, duration_ms=round((time.perf_counter() - start) * 1000), answer_chars=len(answer))
    return answer


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
        prompts.append({"label": label[:64], "question": question[:240]})
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
    model = os.environ.get("OPENAI_MODEL", DEFAULT_MODEL)
    payload = {
        "model": model,
        "instructions": (
            "You are Thingy, the archive librarian for The Weekly Thing. "
            "Generate exactly three short, interesting suggested questions a subscriber could ask about the archive. "
            "Return only JSON with this shape: {\"prompts\":[{\"label\":\"...\",\"question\":\"...\"}]}."
        ),
        "text": {"format": PROMPTS_RESPONSE_FORMAT},
        "input": (
            "Recent archive context:\n"
            f"{prompt_context()}\n\n"
            "The label should be 2 to 5 words. The question should be specific enough to send directly to the chat."
        ),
        "max_output_tokens": 600,
    }
    response = httpx.post(
        OPENAI_RESPONSES_URL,
        headers={
            "Authorization": f"Bearer {openai_api_key()}",
            "content-type": "application/json",
        },
        json=payload,
        timeout=20,
    )
    response.raise_for_status()
    data = response.json()
    text = str(data.get("output_text") or "")
    if not text:
        parts = []
        for item in data.get("output", []):
            for content in item.get("content", []):
                if content.get("type") in {"output_text", "text"}:
                    parts.append(content.get("text", ""))
        text = "\n".join(part for part in parts if part)
    prompts = sanitize_prompts(extract_json_object(text))
    if not prompts:
        raise ValueError("OpenAI returned invalid prompts")
    log_event(
        "info",
        "prompts_generated",
        model=model,
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
    if not check_rate_limit(table, f"prompts#{payload['sub']}", prompt_limit):
        return json_response(429, {"error": "The librarian is at the hourly prompt limit for this session."}, event=event)

    try:
        prompts = generate_prompts()
        source = "generated"
    except (httpx.HTTPError, RuntimeError, ValueError, json.JSONDecodeError) as exc:
        log_event("error", "prompt_generation_failed", subscriber_hash=payload.get("sub"), error_type=type(exc).__name__)
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

    chunks = retrieve(retrieval_query(question, history))
    if not chunks:
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
        answer = call_openai(question, chunks, history)
    except (httpx.HTTPError, RuntimeError) as exc:
        post_tinylytics_event(
            event,
            "librarian.api_error",
            visitor_id=str(payload.get("sub") or ""),
            value=tinylytics_value(member=payload.get("sub"), route="chat", type=type(exc).__name__),
        )
        log_event("error", "answer_generation_failed", subscriber_hash=payload.get("sub"), error_type=type(exc).__name__)
        return json_response(502, {"error": "The librarian could not generate an answer right now."}, event=event)

    citations = citations_for(chunks)
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
            "model": os.environ.get("OPENAI_MODEL", DEFAULT_MODEL),
            "embedding_model": os.environ.get("OPENAI_EMBEDDING_MODEL", DEFAULT_EMBEDDING_MODEL),
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
