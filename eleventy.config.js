const fs = require("fs");
const { runtime: nunjucksRuntime } = require("nunjucks");
const markdownItAnchor = require("markdown-it-anchor");

module.exports = function (eleventyConfig) {
  // --- Passthrough copy ---
  eleventyConfig.addPassthroughCopy("site/img");
  eleventyConfig.addPassthroughCopy("site/css");
  eleventyConfig.addPassthroughCopy("site/CNAME");
  eleventyConfig.addPassthroughCopy("site/favicon.svg");
  eleventyConfig.addPassthroughCopy("site/robots.txt");
  // Prevent GitHub Pages from running Jekyll
  eleventyConfig.addPassthroughCopy({ "site/_nojekyll": ".nojekyll" });

  // Ensure dev server sends UTF-8 charset for .txt files (GitHub Pages does
  // this automatically in production, but the local dev server does not).
  eleventyConfig.setServerOptions({
    middleware: [
      (req, res, next) => {
        if (req.url && /\.txt(\?|$)/.test(req.url)) {
          const origSetHeader = res.setHeader.bind(res);
          res.setHeader = (name, value) => {
            if (String(name).toLowerCase() === "content-type") {
              value = "text/plain; charset=utf-8";
            }
            return origSetHeader(name, value);
          };
        }
        next();
      },
    ],
  });

  // --- Markdown configuration ---
  const md = require("markdown-it")({
    html: true,
    linkify: true,
    typographer: true,
  });

  md.use(markdownItAnchor, {
    permalink: markdownItAnchor.permalink.linkInsideHeader({
      placement: "after",
      space: " ",
      symbol: "#",
      renderAttrs: () => ({ "aria-label": "Permalink to this heading" }),
    }),
    slugify: (s) =>
      s
        .trim()
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .replace(/[\s]+/g, "-")
        .replace(/-+/g, "-"),
  });

  eleventyConfig.setLibrary("md", md);

  // --- Filters ---

  // Format a date string
  eleventyConfig.addFilter("dateFormat", (dateStr, format) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    if (format === "iso") return d.toISOString();
    if (format === "rfc822") return d.toUTCString();
    // Default: "March 15, 2026"
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
  });

  // Short date: "Mar 15, 2026"
  eleventyConfig.addFilter("dateShort", (dateStr) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  });

  // Current year (for copyright notices, etc.)
  eleventyConfig.addFilter("currentYear", () => new Date().getFullYear());

  // Format number with commas (e.g., 19253 → "19,253")
  eleventyConfig.addFilter("numberFormat", (num) => {
    if (num == null) return "0";
    return Number(num).toLocaleString("en-US");
  });

  // Year from date
  eleventyConfig.addFilter("year", (dateStr) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "";
    return d.getUTCFullYear();
  });

  // Array slice (Nunjucks built-in slice works differently)
  eleventyConfig.addFilter("slice", (arr, start, end) => {
    if (!arr) return [];
    return arr.slice(start, end);
  });

  // Truncate text
  eleventyConfig.addFilter("truncate", (str, len) => {
    if (!str) return "";
    if (str.length <= len) return str;
    return str.slice(0, len).replace(/\s+\S*$/, "") + "…";
  });

  // Get the numeric base of an issue number (handles "140-special" → 140)
  eleventyConfig.addFilter("issueNumberBase", (num) => {
    if (typeof num === "number") return num;
    const m = String(num).match(/^(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  });

  // JSON stringify for embedding data in templates
  eleventyConfig.addFilter("jsonify", (obj) => JSON.stringify(obj));

  // Mark top-level navigation items active for their page or section.
  eleventyConfig.addFilter("isActiveNav", (pageUrl, navUrl) => {
    if (!pageUrl || !navUrl || navUrl === "/") return pageUrl === navUrl;
    return pageUrl === navUrl || pageUrl.startsWith(navUrl);
  });

  // XML-escape text for Atom/RSS feeds
  eleventyConfig.addFilter("xmlEscape", (str) => {
    if (!str) return new nunjucksRuntime.SafeString("");
    const escaped = String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
    return new nunjucksRuntime.SafeString(escaped);
  });

  // Render markdown string to HTML (for use in templates)
  eleventyConfig.addFilter("markdownify", (str) => {
    if (!str) return "";
    return md.render(str);
  });

  // Extract headings from rendered HTML for TOC
  eleventyConfig.addFilter("extractToc", (content) => {
    if (!content) return [];
    const headings = [];
    // Match <h2> and <h3> tags with their id attributes and text content
    const regex = /<h([23])\s+id="([^"]*)"[^>]*>([\s\S]*?)<\/h[23]>/gi;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const level = parseInt(match[1], 10);
      const id = match[2];
      // Strip HTML tags from the heading text (links, anchor icons, etc.)
      const text = match[3].replace(/<[^>]*>/g, "").trim();
      if (text) {
        headings.push({ level, text, id });
      }
    }
    return headings;
  });

  // Read the generated archive markdown body of an issue file, stripping YAML
  // front matter and the generated-file notice. Buttondown cleanup happens in
  // pipeline/content/content.py before these files are written.
  eleventyConfig.addFilter("readIssueMarkdownBody", (inputPath) => {
    if (!inputPath) return "";
    const raw = fs.readFileSync(inputPath, "utf8");
    let body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
    body = body.replace(/^<!-- Generated by (?:scripts\/content|pipeline\/content\/content)\.py from data\/buttondown; do not edit directly\. -->\r?\n/, "");
    return body.trim();
  });

  // --- Collections ---

  // Issues sorted by number ascending
  eleventyConfig.addCollection("issuesByNumber", (collectionApi) => {
    return collectionApi.getFilteredByTag("issue").sort((a, b) => {
      const aNum =
        typeof a.data.number === "number"
          ? a.data.number
          : parseInt(String(a.data.number), 10);
      const bNum =
        typeof b.data.number === "number"
          ? b.data.number
          : parseInt(String(b.data.number), 10);
      return aNum - bNum;
    });
  });

  // Issues sorted newest first (for archive index, landing page)
  eleventyConfig.addCollection("issuesByDate", (collectionApi) => {
    return collectionApi.getFilteredByTag("issue").sort((a, b) => {
      return (
        new Date(b.data.publish_date) - new Date(a.data.publish_date)
      );
    });
  });

  // Group issues by year for archive
  eleventyConfig.addFilter("groupByYear", (issues) => {
    const years = {};
    for (const issue of issues) {
      const year = new Date(issue.data.publish_date).getUTCFullYear();
      if (!years[year]) years[year] = [];
      years[year].push(issue);
    }
    // Return as array of {year, issues} sorted newest first
    return Object.entries(years)
      .map(([year, items]) => ({ year: parseInt(year), issues: items }))
      .sort((a, b) => b.year - a.year);
  });

  // --- Config ---
  return {
    dir: {
    input: "site",
      output: "_site",
      includes: "_includes",
      data: "_data",
    },
    templateFormats: ["njk", "md"],
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk",
  };
};
