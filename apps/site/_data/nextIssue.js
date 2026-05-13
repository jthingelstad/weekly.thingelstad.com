// Build-time fetch of `weekly-thing/workshop.json` — workshop_bot's pointer
// to the currently in-flight issue (its number, publish date, etc.).
//
// Eleventy resolves this on every build (push to main + the weekly cron),
// so the site bakes in the latest in-flight issue + its publish date.
// A small inline script on the homepage reads `data-pub-date` off the
// rendered element and computes days-to-pub against the visitor's local
// `new Date()`, so the badge stays fresh between builds without any
// client-side cross-origin fetch (and no CORS on files.thingelstad.com).
//
// On any failure (network, 404, bad JSON, missing fields) we return {}
// and the homepage just doesn't render the badge. Best-effort.

const POINTER_URL = "https://files.thingelstad.com/weekly-thing/workshop.json";

module.exports = async () => {
  try {
    const resp = await fetch(POINTER_URL, { headers: { accept: "application/json" } });
    if (!resp.ok) return {};
    const data = await resp.json();
    if (!data || typeof data !== "object") return {};
    const n = Number(data.issue_number);
    const pub = String(data.pub_date || "");
    if (!Number.isFinite(n) || n <= 0) return {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(pub)) return {};
    return { issue_number: n, pub_date: pub };
  } catch (_err) {
    return {};
  }
};
