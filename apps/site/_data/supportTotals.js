// Compute Supporting Membership totals: sum of past donations + current Stripe balance.
const support = require("./support.json");
const stats = require("./stats.json");

module.exports = (() => {
  const pastTotal = (support.past || []).reduce(
    (sum, org) => sum + (org.amount_raised || 0),
    0
  );
  const currentStripe = stats.amount_raised || 0;
  const totalRaised = pastTotal + currentStripe;

  const years = (support.past || [])
    .map((o) => o.year)
    .filter((y) => typeof y === "number");
  const sinceYear = years.length ? Math.min(...years) : null;

  return {
    pastTotal,
    currentStripe,
    totalRaised,
    sinceYear,
  };
})();
