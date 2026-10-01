// Every date a reader sees is the day in Chicago, where Jamie writes and sends
// from. Send times are instants (UTC in front matter); an evening send in
// Chicago is already the next day in UTC, so slicing the UTC date put WT22,
// WT35, WT251 and WT299 on the wrong day (2026-10-01). Machine timestamps
// (feeds, sitemap, article:published_time) stay instants and do not use this.
const SITE_TIME_ZONE = "America/Chicago";

// A bare calendar date ("2018-01-06") names a day, not an instant. Read
// through a time zone it would land on the evening before, so it is held at
// noon UTC, which is the same calendar day in Chicago.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function toDate(value) {
  if (value == null || value === "") return null;
  if (typeof value === "string" && DATE_ONLY.test(value)) {
    return new Date(`${value}T12:00:00Z`);
  }
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: SITE_TIME_ZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
});

// {year, month (1-12), day} of an instant in Chicago.
function siteDateParts(value) {
  const d = toDate(value);
  if (!d) return null;
  const parts = {};
  for (const { type, value: v } of partsFormatter.formatToParts(d)) {
    if (type === "year" || type === "month" || type === "day") parts[type] = Number(v);
  }
  return parts;
}

function formatSiteDate(value, options) {
  const d = toDate(value);
  if (!d) return null;
  return d.toLocaleDateString("en-US", { ...options, timeZone: SITE_TIME_ZONE });
}

function formatSiteTime(value, options) {
  const d = toDate(value);
  if (!d) return null;
  return d.toLocaleTimeString("en-US", { ...options, timeZone: SITE_TIME_ZONE });
}

module.exports = { SITE_TIME_ZONE, toDate, siteDateParts, formatSiteDate, formatSiteTime };
