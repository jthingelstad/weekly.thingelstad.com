// The issue index, read from the issue pages themselves.
//
// Every apps/site/archive/{N}.md already carries its issue's metadata in
// front matter (subject, date, description, image, slug, word count, domains,
// links), so the index is derived from the pages at build time rather than
// kept as a second copy that every send has to merge into.
//
// Global data runs before Eleventy builds collections, so a data file cannot
// ask for collections.issuesByNumber. This reads the pages itself, with the
// same parser and YAML engine Eleventy uses for front matter.

const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");
const yaml = require("js-yaml");

const ARCHIVE_DIR = path.join(__dirname, "..", "archive");

// Briefly has gone by other names: "Recommended Links" and "FYI" in
// WT131–187. Everything else ("Links 📌", "Featured", "Must Read", "Notable",
// or no section at all) is Notable.
const BRIEFLY = /brief|recommended|fyi/i;

function isoString(value) {
  if (value instanceof Date) return value.toISOString().replace(".000Z", "Z");
  return value == null ? value : String(value);
}

// Ascending by number; "140-special" sorts right after 140.
function byNumber(a, b) {
  const an = parseInt(String(a.number), 10);
  const bn = parseInt(String(b.number), 10);
  if (an !== bn) return an - bn;
  return (typeof a.number === "number" ? 0 : 1) - (typeof b.number === "number" ? 0 : 1);
}

function readIssue(file) {
  const source = fs.readFileSync(path.join(ARCHIVE_DIR, file), "utf8");
  const { data } = matter(source, { engines: { yaml: yaml.load.bind(yaml) } });
  const links = Array.isArray(data.links) ? data.links : [];
  return {
    ...data,
    publish_date: isoString(data.publish_date),
    domains: Array.isArray(data.domains) ? data.domains : [],
    links,
    notable_links: links.filter((l) => !BRIEFLY.test(l.section || "")),
    briefly_links: links.filter((l) => BRIEFLY.test(l.section || "")),
  };
}

module.exports = fs
  .readdirSync(ARCHIVE_DIR)
  .filter((file) => file.endsWith(".md"))
  .map(readIssue)
  .sort(byNumber);
