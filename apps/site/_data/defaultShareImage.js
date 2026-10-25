// The share image for a page with none of its own (the home page, About,
// the FAQ and the rest): the cover photo of the newest issue that has one,
// the photo the home page's stamp shows. Topic pages use their own newest
// cover instead (topics.js `image`); an issue page has only its own `image`.

const issues = require("../lib/issueIndex.js");
const isCover = (image) => typeof image === "string" && image.includes("files.thingelstad.com");

module.exports = [...issues].reverse().find((issue) => isCover(issue.image))?.image || "";
