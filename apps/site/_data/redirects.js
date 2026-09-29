// Generate redirect data for old Buttondown slug-based URLs.
// Only includes entries where the slug differs from the issue number.
const issues = require("../lib/issueIndex.js");

module.exports = issues.filter(
  (issue) => issue.slug && issue.slug !== String(issue.number)
);
