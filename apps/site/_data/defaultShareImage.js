// The cover photo of the newest issue that has one. The front page's h-feed
// names it as the newsletter's card's photo (index.njk `u-featured`), which
// every page with no image of its own shares; topic pages use their own
// newest cover instead (topics.js `image`), and an issue its own card.

const issues = require("../lib/issueIndex.js");
const isCover = (image) => typeof image === "string" && image.startsWith("https://files.thingelstad.com/");

module.exports = [...issues].reverse().find((issue) => isCover(issue.image))?.image || "";
