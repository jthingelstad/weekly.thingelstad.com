// Asset cache-busting helpers.
//
// Computes a short content hash for each tracked static asset so its URL
// can be suffixed with `?v=<hash>`. The hash changes only when the file
// changes, so browsers re-fetch on edit but reuse cached copies otherwise.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SITE_DIR = path.join(__dirname, "..");

function fileHash(relativePath) {
  const abs = path.join(SITE_DIR, relativePath);
  try {
    const data = fs.readFileSync(abs);
    return crypto.createHash("md5").update(data).digest("hex").slice(0, 10);
  } catch (err) {
    return Date.now().toString(36);
  }
}

module.exports = {
  cssVersion: fileHash("css/style.css"),
};
