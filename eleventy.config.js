const fs = require("fs");
const markdownItAnchor = require("markdown-it-anchor");

module.exports = function (eleventyConfig) {
  // --- Passthrough copy ---
  eleventyConfig.addPassthroughCopy("src/img");
  eleventyConfig.addPassthroughCopy("src/css");
  eleventyConfig.addPassthroughCopy("src/CNAME");
  eleventyConfig.addPassthroughCopy("src/favicon.svg");
  eleventyConfig.addPassthroughCopy("src/robots.txt");
  // Prevent GitHub Pages from running Jekyll
  eleventyConfig.addPassthroughCopy({ "src/_nojekyll": ".nojekyll" });

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
    permalink: markdownItAnchor.permalink.headerLink({
      safariReaderFix: true,
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

  // XML-escape text for Atom/RSS feeds
  eleventyConfig.addFilter("xmlEscape", (str) => {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
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

  // Read the raw markdown body of an issue file, stripping YAML front matter
  // and the outer {% raw %}...{% endraw %} wrapper used to preserve Buttondown
  // template syntax in source. Returns the body as a markdown string.
  eleventyConfig.addFilter("readIssueMarkdownBody", (inputPath) => {
    if (!inputPath) return "";
    const raw = fs.readFileSync(inputPath, "utf8");
    // Strip leading YAML front matter
    let body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
    // Strip {% raw %} / {% endraw %} wrappers (line-anchored and inline)
    body = body.replace(/\{%\s*raw\s*%\}/g, "");
    body = body.replace(/\{%\s*endraw\s*%\}/g, "");
    return body.trim();
  });

  // Strip Buttondown/Mailchimp template tags from a markdown string.
  // Mirrors the stripButtondownTags HTML transform but operates on markdown.
  eleventyConfig.addFilter("stripButtondownMd", (str) => {
    if (!str) return "";
    return (
      String(str)
        // Remove entire {% if %}...{% endif %} and {% for %}...{% endfor %}
        // blocks (including contents). All such blocks in Buttondown issues are
        // email-only conditionals (subscriber type, medium == 'email', etc.)
        // that don't belong in the archive.
        .replace(/\{%\s*if\b[\s\S]*?\{%\s*endif\s*%\}/g, "")
        .replace(/\{%\s*for\b[\s\S]*?\{%\s*endfor\s*%\}/g, "")
        // Remove {{ subscriber.* }} references
        .replace(/\{\{[^}]*subscriber[^}]*\}\}/g, "")
        // Remove {{ email.* }} and {{email_link}}-style references
        .replace(/\{\{[^}]*email[._]?\w*[^}]*\}\}/g, "")
        // Remove {{ survey.* }} references
        .replace(/\{\{[^}]*survey\.[^}]*\}\}/g, "")
        // Remove {{ subscribe_form }} and {{ subscribe_url }}
        .replace(/\{\{\s*subscribe_(?:form|url)\s*\}\}/g, "")
        // Replace common Buttondown URLs with "#"
        .replace(/\{\{\s*unsubscribe_url\s*\}\}/g, "#")
        .replace(/\{\{\s*manage_subscription_url\s*\}\}/g, "#")
        .replace(/\{\{\s*upgrade_url\s*\}\}/g, "#")
        .replace(/\{\{\s*email_url\s*\}\}/g, "#")
        // Remove remaining stray {% %} tags
        .replace(/\{%[\s\S]*?%\}/g, "")
        // Remove remaining stray {{ ... }} simple template variables
        .replace(/\{\{\s*[a-zA-Z_][a-zA-Z_0-9.]*\s*\}\}/g, "")
        // Remove Buttondown editor-mode HTML comment
        .replace(/<!--\s*buttondown-editor-mode:[^>]*-->\s*/gi, "")
        // Remove Mailchimp merge tags
        .replace(/\*\|[A-Z_:]+\|\*/g, "")
        // Collapse runs of 3+ blank lines left behind
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    );
  });

  // Strip Buttondown template tags from rendered HTML
  eleventyConfig.addTransform("stripButtondownTags", (content, outputPath) => {
    if (!outputPath || !outputPath.endsWith(".html")) return content;

    return (
      content
        // Remove {{ subscriber.* }} references (including pipes, dots, and nested properties)
        .replace(/\{\{[^}]*subscriber[^}]*\}\}/g, "")
        // Remove {{ email.* }} references
        .replace(/\{\{[^}]*email\.\w[^}]*\}\}/g, "")
        // Remove {{ survey.* }} references
        .replace(/\{\{[^}]*survey\.[^}]*\}\}/g, "")
        // Remove {{ subscribe_form }} and {{ subscribe_url }}
        .replace(/\{\{\s*subscribe_(?:form|url)\s*\}\}/g, "")
        // Remove common Buttondown URLs
        .replace(/\{\{\s*unsubscribe_url\s*\}\}/g, "#")
        .replace(/\{\{\s*manage_subscription_url\s*\}\}/g, "#")
        .replace(/\{\{\s*upgrade_url\s*\}\}/g, "#")
        .replace(/\{\{\s*email_url\s*\}\}/g, "#")
        // Remove entire {% if %}...{% endif %} and {% for %}...{% endfor %}
        // blocks (including contents). All such blocks in Buttondown issues
        // are email-only conditionals that shouldn't appear in the web archive.
        .replace(/\{%\s*if\b[\s\S]*?\{%\s*endif\s*%\}/g, "")
        .replace(/\{%\s*for\b[\s\S]*?\{%\s*endfor\s*%\}/g, "")
        // Remove remaining stray {% %} tags
        .replace(/\{%.*?%\}/g, "")
        // Remove Mailchimp/TinyLetter merge tags (*|ARCHIVE|*, *|LIST:DESCRIPTION|*, etc.)
        .replace(/\*\|[A-Z_:]+\|\*/g, "")
        // Clean up empty paragraphs left behind
        .replace(/<p>\s*<\/p>/g, "")
    );
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
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data",
    },
    templateFormats: ["njk", "md"],
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk",
  };
};
