// When each issue page last changed, for the sitemap's <lastmod>.
//
// An issue's publish date says nothing about the repairs since (the WT23–130
// rounds, the audio editions), so Google had no reason to read a page again
// (Search Console, 2026-10-26). The date is the last commit that touched
// apps/site/archive/{N}.md, keyed by the file's name ("140-special").
//
// A shallow clone has one commit, which would date every issue today, so it
// returns nothing and the sitemap keeps the publish date. CI checks out the
// full history for this.

const { execFileSync } = require("child_process");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const ARCHIVE = "apps/site/archive/";

function git(args) {
  return execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

module.exports = () => {
  try {
    if (git(["rev-parse", "--is-shallow-repository"]).trim() !== "false") return {};
    const edited = {};
    let date = null;
    for (const line of git(["log", "--format=@%cI", "--name-only", "--", ARCHIVE]).split("\n")) {
      if (line.startsWith("@")) {
        date = line.slice(1);
        continue;
      }
      const match = line.startsWith(ARCHIVE) && /^([^/]+)\.md$/.exec(line.slice(ARCHIVE.length));
      // git log runs newest first, so a file's first date is its last edit.
      if (match && date && !(match[1] in edited)) edited[match[1]] = date;
    }
    return edited;
  } catch {
    return {};
  }
};
