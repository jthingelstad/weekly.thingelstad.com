#!/usr/bin/env node
// Refresh apps/site/_data/stats.json — the landing-page numbers.
//
// weekly owns its own stats: subscriber + premium counts (Buttondown) and the
// amount raised (Stripe balance). These are surface metrics, fetched here, NOT
// produced by Studio. Dependency-free (Node 20+ native fetch), so it fits
// weekly's render-only, Node-only CI.
//
// Best-effort: any API hiccup falls back to the committed stats.json value, so
// a Buttondown/Stripe outage never blanks the landing page. Mirrors the prior
// pipeline/content/content.py `stats` behavior.
//
// Env: BUTTONDOWN_API_KEY, STRIPE_API_KEY
// Run: node scripts/refresh-stats.mjs   (or `npm run refresh-stats`)

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const STATS_PATH = resolve(HERE, "..", "apps", "site", "_data", "stats.json");
const BUTTONDOWN_API = "https://api.buttondown.com/v1";

function readExisting() {
  try {
    return JSON.parse(readFileSync(STATS_PATH, "utf8"));
  } catch {
    return {};
  }
}

// Buttondown returns a paginated list with a top-level `count`; page_size=1
// keeps the payload tiny since we only want the total.
async function buttondownCount(params) {
  const key = process.env.BUTTONDOWN_API_KEY;
  if (!key) throw new Error("BUTTONDOWN_API_KEY not set");
  const url = new URL(`${BUTTONDOWN_API}/subscribers`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const resp = await fetch(url, { headers: { Authorization: `Token ${key}` } });
  if (!resp.ok) throw new Error(`Buttondown ${resp.status}: ${await resp.text()}`);
  return (await resp.json()).count ?? 0;
}

// Stripe REST API directly (no SDK dep). Amount raised = USD available + pending.
async function stripeBalanceUsd() {
  const key = process.env.STRIPE_API_KEY;
  if (!key) throw new Error("STRIPE_API_KEY not set");
  const resp = await fetch("https://api.stripe.com/v1/balance", {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!resp.ok) throw new Error(`Stripe ${resp.status}: ${await resp.text()}`);
  const balance = await resp.json();
  let cents = 0;
  for (const bucket of ["available", "pending"]) {
    for (const entry of balance[bucket] ?? []) {
      if (entry.currency === "usd") cents += entry.amount;
    }
  }
  return cents / 100;
}

const existing = readExisting();

let subscriber_count, premium_subscriber_count;
try {
  console.log("Fetching subscriber stats from Buttondown…");
  subscriber_count = await buttondownCount({ page_size: "1" });
  premium_subscriber_count = await buttondownCount({ type: "premium", page_size: "1" });
} catch (err) {
  console.warn(`  Warning: subscriber stats failed, keeping committed values: ${err.message}`);
  subscriber_count = existing.subscriber_count ?? 0;
  premium_subscriber_count = existing.premium_subscriber_count ?? 0;
}

let amount_raised;
try {
  console.log("Fetching Stripe balance…");
  amount_raised = await stripeBalanceUsd();
} catch (err) {
  console.warn(`  Warning: Stripe balance failed, keeping committed value: ${err.message}`);
  amount_raised = existing.amount_raised ?? 0;
}

const stats = {
  subscriber_count,
  premium_subscriber_count,
  amount_raised: Math.round(amount_raised * 100) / 100,
};
writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2) + "\n", "utf8");
console.log("Wrote stats.json:", JSON.stringify(stats));
