// Reader-facing dates are Chicago days (lib/siteTime.js). These pin the four
// issues whose UTC date was a day late (2026-10-01) and the instants that must
// stay UTC. CI runs them with TZ=UTC so the runner's zone can't mask a bug.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { dateFormat, dateShort, dateTimeShort, year } = require("../../apps/site/lib/dateFilters.js");
const { siteDateParts } = require("../../apps/site/lib/siteTime.js");

test("an evening send in Chicago shows its Chicago day", () => {
  // WT35: subject "Weekly Thing for January 6, 2018".
  assert.equal(dateFormat("2018-01-07T01:28:21Z"), "January 6, 2018");
  assert.equal(dateShort("2018-01-07T01:28:21Z"), "Jan 6, 2018");
  assert.equal(dateFormat("2017-10-07T00:00:00Z"), "October 6, 2017"); // WT22
  assert.equal(dateFormat("2023-04-24T01:14:21.760981Z"), "April 23, 2023"); // WT251
  assert.equal(dateFormat("2024-11-04T01:45:48.042998Z"), "November 3, 2024"); // WT299
});

test("noon UTC, WT Builder's send stamp, is the same day in Chicago", () => {
  assert.equal(dateFormat("2026-09-26T12:00:00Z"), "September 26, 2026");
  assert.equal(dateFormat("2026-01-03T12:00:00Z"), "January 3, 2026");
});

test("instants stay UTC", () => {
  assert.equal(dateFormat("2018-01-07T01:28:21Z", "iso"), "2018-01-07T01:28:21.000Z");
  assert.equal(dateFormat("2018-01-07T01:28:21Z", "rfc822"), "Sun, 07 Jan 2018 01:28:21 GMT");
});

test("a bare calendar date is never moved", () => {
  assert.equal(dateFormat("2018-01-07"), "January 7, 2018");
  assert.equal(dateShort("2026-03-01"), "Mar 1, 2026");
});

test("years and months are Chicago ones", () => {
  assert.equal(year("2018-01-01T03:00:00Z"), 2017);
  assert.equal(year("2018-01-01T12:00:00Z"), 2018);
  assert.deepEqual(siteDateParts("2017-10-07T00:00:00Z"), { year: 2017, month: 10, day: 6 });
  assert.equal(dateFormat("2019-03-01T02:00:00Z", "month-year"), "Feb 2019");
});

test("the time of day is Chicago's, with its zone", () => {
  assert.equal(dateTimeShort("2018-01-07T01:28:21Z"), "Jan 6, 2018 19:28 CST");
  assert.equal(dateTimeShort("2026-07-04T17:05:00Z"), "Jul 4, 2026 12:05 CDT");
});

test("empty and unparseable values pass through", () => {
  assert.equal(dateFormat(""), "");
  assert.equal(dateFormat(null), "");
  assert.equal(dateFormat("not a date"), "not a date");
  assert.equal(year(""), "");
});
