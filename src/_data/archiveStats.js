// Compute stats from emails.json for the /stats/ page.
const emails = require("./emails.json");

module.exports = (() => {
  const now = new Date();
  const years = {};
  const domainCounts = {};
  let totalLinks = 0;
  let totalDomains = 0;
  let longestStreak = 0;
  let currentStreak = 0;
  let maxLinksIssue = { count: 0 };
  let maxDomainsIssue = { count: 0 };
  let shortestSubject = { length: Infinity };
  let longestSubject = { length: 0 };

  // Sort by number ascending for streak calculation
  const sorted = [...emails]
    .filter((e) => typeof e.number === "number")
    .sort((a, b) => a.number - b.number);

  // First issue date and latest
  const firstDate = sorted[0]?.publish_date;
  const latestDate = sorted[sorted.length - 1]?.publish_date;
  const firstYear = new Date(firstDate).getUTCFullYear();
  const latestYear = new Date(latestDate).getUTCFullYear();

  // Streak calculation: consecutive weeks published
  let prevDate = null;
  for (const email of sorted) {
    const d = new Date(email.publish_date);
    if (prevDate) {
      const gap = (d - prevDate) / (1000 * 60 * 60 * 24);
      if (gap <= 10) {
        // Roughly weekly (allowing some slack)
        currentStreak++;
      } else {
        longestStreak = Math.max(longestStreak, currentStreak);
        currentStreak = 1;
      }
    } else {
      currentStreak = 1;
    }
    prevDate = d;
  }
  longestStreak = Math.max(longestStreak, currentStreak);

  // Per-year stats + records
  for (const email of emails) {
    const yr = email.publish_date?.slice(0, 4);
    if (!yr) continue;

    if (!years[yr]) {
      years[yr] = { issues: 0, links: 0, domains: new Set(), uniqueDomains: 0 };
    }
    years[yr].issues++;

    const linkCount = (email.links || []).length;
    const domainCount = (email.domains || []).length;
    totalLinks += linkCount;

    years[yr].links += linkCount;
    for (const d of email.domains || []) {
      years[yr].domains.add(d);
      domainCounts[d] = (domainCounts[d] || 0) + 1;
    }

    if (linkCount > maxLinksIssue.count) {
      maxLinksIssue = {
        count: linkCount,
        number: email.number,
        subject: email.subject,
      };
    }
    if (domainCount > maxDomainsIssue.count) {
      maxDomainsIssue = {
        count: domainCount,
        number: email.number,
        subject: email.subject,
      };
    }

    const subjLen = (email.subject || "").length;
    if (subjLen < shortestSubject.length && subjLen > 0) {
      shortestSubject = {
        length: subjLen,
        number: email.number,
        subject: email.subject,
      };
    }
    if (subjLen > longestSubject.length) {
      longestSubject = {
        length: subjLen,
        number: email.number,
        subject: email.subject,
      };
    }
  }

  // Convert year domain sets to counts + build yearly array
  const yearlyStats = Object.entries(years)
    .map(([year, data]) => ({
      year: parseInt(year),
      issues: data.issues,
      links: data.links,
      uniqueDomains: data.domains.size,
      avgLinksPerIssue:
        data.issues > 0 ? Math.round(data.links / data.issues) : 0,
    }))
    .sort((a, b) => a.year - b.year);

  // Top domains
  const topDomains = Object.entries(domainCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([domain, count]) => ({ domain, count }));

  // Unique domains total
  const uniqueDomainsTotal = Object.keys(domainCounts).length;

  // Day of week distribution
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dayOfWeek = [0, 0, 0, 0, 0, 0, 0];
  for (const email of sorted) {
    const d = new Date(email.publish_date);
    dayOfWeek[d.getUTCDay()]++;
  }
  const publishDays = dayNames.map((name, i) => ({
    day: name,
    count: dayOfWeek[i],
    pct: Math.round((dayOfWeek[i] / sorted.length) * 100),
  }));

  // Month distribution
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthCounts = new Array(12).fill(0);
  for (const email of sorted) {
    const d = new Date(email.publish_date);
    monthCounts[d.getUTCMonth()]++;
  }
  const publishMonths = monthNames.map((name, i) => ({
    month: name,
    count: monthCounts[i],
  }));

  // Years active
  const yearsActive = latestYear - firstYear + 1;

  // Words estimate (rough — count words in all subjects as proxy)
  // Actually let's count issues per month on average
  const totalMonths =
    (new Date(latestDate) - new Date(firstDate)) / (1000 * 60 * 60 * 24 * 30.44);
  const issuesPerMonth =
    totalMonths > 0 ? (sorted.length / totalMonths).toFixed(1) : 0;

  return {
    totalIssues: emails.length,
    regularIssues: sorted.length,
    totalLinks,
    uniqueDomainsTotal,
    yearsActive,
    firstDate,
    latestDate,
    longestStreak,
    issuesPerMonth: parseFloat(issuesPerMonth),
    avgLinksPerIssue:
      sorted.length > 0 ? Math.round(totalLinks / sorted.length) : 0,
    yearlyStats,
    topDomains,
    publishDays,
    publishMonths,
    records: {
      maxLinks: maxLinksIssue,
      maxDomains: maxDomainsIssue,
      shortestSubject,
      longestSubject,
    },
  };
})();
