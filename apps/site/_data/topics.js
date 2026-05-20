// Build a Topics index from data/librarian/graph.json.
//
// Exposes:
//   all       — qualified topic records sorted by issue count desc
//   bySlug    — slug → record
//   byIssue   — issue number → top 8 topic slugs, ranked by topic.count
//   byLetter  — first letter ('a'..'z' or '#') → records under that letter
//
// A topic must appear in >= MIN_ISSUES issues to be included. Stop-words are
// already filtered upstream in librarian-core/librarian_core/graph.py.

const fs = require("fs");
const path = require("path");
const emails = require("./emails.json");

const GRAPH_PATH = path.join(__dirname, "..", "..", "..", "data", "librarian", "graph.json");
const AUDIO_MANIFEST_PATH = path.join(__dirname, "..", "..", "..", "data", "audio", "manifest.json");
const MIN_ISSUES = 3;
const PER_ISSUE_CHIPS = 8;
const RELATED_LIMIT = 8;

function emptyShape() {
  return { all: [], bySlug: {}, byIssue: {}, byLetter: {} };
}

function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/['‘’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function loadGraph() {
  if (!fs.existsSync(GRAPH_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(GRAPH_PATH, "utf8"));
  } catch {
    return null;
  }
}

function loadAudioManifest() {
  if (!fs.existsSync(AUDIO_MANIFEST_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(AUDIO_MANIFEST_PATH, "utf8")) || {};
  } catch {
    return {};
  }
}

module.exports = (() => {
  const graph = loadGraph();
  if (!graph || !graph.entity_index || !graph.issues) return emptyShape();

  // Per-issue metadata from emails.json + audio manifest. The
  // expanded shape lets topic.njk render the same archive-entry
  // cards the main archive page uses (cover, description, links
  // count, word count, Listen action).
  const audioManifest = loadAudioManifest();
  const metaByNumber = {};
  for (const e of emails) {
    if (typeof e.number === "number") {
      const audioRec = audioManifest[String(e.number)];
      metaByNumber[String(e.number)] = {
        publish_date: e.publish_date,
        subject: e.subject,
        description: e.description || "",
        image: e.image || "",
        links: Array.isArray(e.links) ? e.links : [],
        word_count: e.word_count || 0,
        audio_url:
          audioRec && audioRec.audio_url ? audioRec.audio_url : "",
      };
    }
  }
  const dateByNumber = (n) => metaByNumber[n]?.publish_date || "";

  // Display-name resolver: for each lowercase entity, count its
  // original-case spellings across issues; pick the most-frequent form.
  const caseCounts = {}; // lower -> { display: count }
  for (const issue of Object.values(graph.issues)) {
    for (const ent of issue.entities || []) {
      const lower = String(ent).toLowerCase();
      const bucket = caseCounts[lower] || (caseCounts[lower] = {});
      bucket[ent] = (bucket[ent] || 0) + 1;
    }
  }
  const displayName = (lower) => {
    const bucket = caseCounts[lower];
    if (!bucket) return lower;
    return Object.entries(bucket).sort((a, b) => b[1] - a[1])[0][0];
  };

  // Build qualified records, slugified, with collisions merged.
  const bySlug = {};
  for (const [lower, issues] of Object.entries(graph.entity_index)) {
    if (!Array.isArray(issues) || issues.length < MIN_ISSUES) continue;
    const name = displayName(lower);
    const slug = slugify(name);
    if (!slug) continue;
    if (bySlug[slug]) {
      // merge: union issue lists, prefer the higher-count display name
      const existing = bySlug[slug];
      const merged = new Set([...existing.issues, ...issues.map(String)]);
      existing.issues = [...merged];
      if (issues.length > existing.count) existing.name = name;
      existing.count = existing.issues.length;
      continue;
    }
    bySlug[slug] = {
      slug,
      name,
      issues: issues.map(String),
      count: issues.length,
    };
  }

  // Attach issue metadata, sort newest-first.
  for (const rec of Object.values(bySlug)) {
    const sorted = rec.issues
      .map((n) => ({
        number: n,
        publish_date: dateByNumber(n),
        subject: metaByNumber[n]?.subject || "",
        description: metaByNumber[n]?.description || "",
        image: metaByNumber[n]?.image || "",
        links: metaByNumber[n]?.links || [],
        word_count: metaByNumber[n]?.word_count || 0,
        audio_url: metaByNumber[n]?.audio_url || "",
      }))
      .sort((a, b) =>
        a.publish_date < b.publish_date ? 1 :
        a.publish_date > b.publish_date ? -1 :
        Number(b.number) - Number(a.number)
      );
    rec.issues = sorted; // now full archive-shaped issue records
    rec.lastNumber = sorted[0]?.number || null;
    rec.firstNumber = sorted[sorted.length - 1]?.number || null;
    rec.lastDate = sorted[0]?.publish_date || null;
    rec.firstDate = sorted[sorted.length - 1]?.publish_date || null;
  }

  // Related topics: count co-mentions per issue. Faster than NxN
  // intersection; ~347 issues × C(k,2) per issue.
  const lowerToSlug = {};
  for (const [lower, _] of Object.entries(graph.entity_index)) {
    const name = displayName(lower);
    const s = slugify(name);
    if (s && bySlug[s]) lowerToSlug[lower] = s;
  }
  const coCount = {}; // slug -> Map(otherSlug -> count)
  for (const issue of Object.values(graph.issues)) {
    const slugs = Array.from(
      new Set(
        (issue.entities || [])
          .map((e) => lowerToSlug[String(e).toLowerCase()])
          .filter(Boolean)
      )
    );
    for (let i = 0; i < slugs.length; i++) {
      for (let j = i + 1; j < slugs.length; j++) {
        const a = slugs[i], b = slugs[j];
        (coCount[a] = coCount[a] || {})[b] = (coCount[a][b] || 0) + 1;
        (coCount[b] = coCount[b] || {})[a] = (coCount[b][a] || 0) + 1;
      }
    }
  }
  for (const [slug, rec] of Object.entries(bySlug)) {
    const pairs = coCount[slug] || {};
    rec.related = Object.entries(pairs)
      .sort((a, b) => b[1] - a[1])
      .slice(0, RELATED_LIMIT)
      .map(([s, n]) => ({ slug: s, name: bySlug[s].name, coMentions: n }));
  }

  // byIssue: top 8 topic slugs per issue, ranked by topic.count desc.
  const byIssue = {};
  for (const [num, issue] of Object.entries(graph.issues)) {
    const candidates = (issue.entities || [])
      .map((e) => lowerToSlug[String(e).toLowerCase()])
      .filter(Boolean);
    const uniq = [...new Set(candidates)]
      .map((s) => bySlug[s])
      .sort((a, b) => b.count - a.count)
      .slice(0, PER_ISSUE_CHIPS)
      .map((r) => r.slug);
    if (uniq.length) byIssue[num] = uniq;
  }

  // all + byLetter
  const all = Object.values(bySlug).sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name)
  );
  const byLetter = {};
  for (const rec of [...all].sort((a, b) => a.name.localeCompare(b.name))) {
    const first = rec.name.charAt(0).toLowerCase();
    const key = /[a-z]/.test(first) ? first : "#";
    (byLetter[key] = byLetter[key] || []).push(rec);
  }

  return { all, bySlug, byIssue, byLetter };
})();
