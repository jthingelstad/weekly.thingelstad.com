// An issue link's `heading_context` is the heading the link sat under, and
// every one in the archive is a single Markdown link: "[Title](url)". The
// per-issue links feed printed that source as it stood until 2026-11-23, so a
// reader saw the brackets and the address. headingLink() reads the two parts.
// The split is at the last "](": a title may hold brackets, and an address
// holds no "](".
function headingLink(context) {
  const value = String(context ?? "").trim();
  const split = value.lastIndexOf("](");
  if (!value.startsWith("[") || !value.endsWith(")") || split < 1) {
    return { text: value, url: null };
  }
  const text = value.slice(1, split);
  const url = value.slice(split + 2, -1);
  if (!text || !/^https?:\/\/\S+$/.test(url)) return { text: value, url: null };
  return { text, url };
}

module.exports = { headingLink };
