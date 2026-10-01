// The site's date filters, kept out of eleventy.config.js so a unit test can
// pin them (tests/unit/date-filters.test.mjs). Reader-facing days are Chicago
// days (lib/siteTime.js); "iso" and "rfc822" are instants and stay UTC.
const { toDate, siteDateParts, formatSiteDate, formatSiteTime } = require("./siteTime.js");

// dateFormat(value)              "January 6, 2018"
// dateFormat(value, "month-year") "Jan 2018"
// dateFormat(value, "iso")       "2018-01-07T01:28:21.000Z"
// dateFormat(value, "rfc822")    "Sun, 07 Jan 2018 01:28:21 GMT"
function dateFormat(value, format) {
  if (!value) return "";
  const d = toDate(value);
  if (!d) return String(value);
  if (format === "iso") return d.toISOString();
  if (format === "rfc822") return d.toUTCString();
  if (format === "month-year") return formatSiteDate(d, { year: "numeric", month: "short" });
  return formatSiteDate(d, { year: "numeric", month: "long", day: "numeric" });
}

// "Jan 6, 2018"
function dateShort(value) {
  if (!value) return "";
  const d = toDate(value);
  if (!d) return String(value);
  return formatSiteDate(d, { year: "numeric", month: "short", day: "numeric" });
}

// "Jan 6, 2018 19:28 CST"
function dateTimeShort(value) {
  if (!value) return "";
  const d = toDate(value);
  if (!d) return String(value);
  const date = formatSiteDate(d, { year: "numeric", month: "short", day: "numeric" });
  const time = formatSiteTime(d, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  });
  return `${date} ${time}`;
}

// The Chicago year of an instant.
function year(value) {
  const parts = siteDateParts(value);
  return parts ? parts.year : "";
}

module.exports = { dateFormat, dateShort, dateTimeShort, year };
