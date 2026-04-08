// Generate redirect data for old Buttondown slug-based URLs.
// Only includes entries where the slug differs from the issue number.
const emails = require("./emails.json");

module.exports = emails.filter(
  (email) => email.slug && email.slug !== String(email.number)
);
