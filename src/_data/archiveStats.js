// Compute stats from emails.json for the /stats/ page.
// Link/domain analysis uses only curated links (Notable + Briefly sections).
const emails = require("./emails.json");

module.exports = (() => {
  const years = {};
  const domainCounts = {};
  let totalLinks = 0;
  let totalNotable = 0;
  let totalBriefly = 0;
  let totalWords = 0;
  let longestStreak = 0;
  let currentStreak = 0;
  let maxLinksIssue = { count: 0 };
  let maxDomainsIssue = { count: 0 };
  let maxWordsIssue = { count: 0 };

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
      years[yr] = {
        issues: 0,
        notable: 0,
        briefly: 0,
        links: 0,
        words: 0,
        domains: new Set(),
      };
    }
    years[yr].issues++;

    const notableCount = (email.notable_links || []).length;
    const brieflyCount = (email.briefly_links || []).length;
    const linkCount = notableCount + brieflyCount;
    const domainCount = (email.domains || []).length;
    const wordCount = email.word_count || 0;

    totalLinks += linkCount;
    totalNotable += notableCount;
    totalBriefly += brieflyCount;
    totalWords += wordCount;

    years[yr].notable += notableCount;
    years[yr].briefly += brieflyCount;
    years[yr].links += linkCount;
    years[yr].words += wordCount;

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
    if (wordCount > maxWordsIssue.count) {
      maxWordsIssue = {
        count: wordCount,
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
      notable: data.notable,
      briefly: data.briefly,
      links: data.links,
      words: data.words,
      uniqueDomains: data.domains.size,
    }))
    .sort((a, b) => a.year - b.year);

  // Top domains (from curated links only)
  const topDomains = Object.entries(domainCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([domain, count]) => ({ domain, count }));

  // Unique domains total
  const uniqueDomainsTotal = Object.keys(domainCounts).length;

  // Month distribution
  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
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

  // Issues per month average
  const totalMonths =
    (new Date(latestDate) - new Date(firstDate)) / (1000 * 60 * 60 * 24 * 30.44);
  const issuesPerMonth =
    totalMonths > 0 ? (sorted.length / totalMonths).toFixed(1) : 0;

  return {
    totalIssues: emails.length,
    regularIssues: sorted.length,
    totalLinks,
    totalNotable,
    totalBriefly,
    totalWords,
    uniqueDomainsTotal,
    yearsActive,
    firstDate,
    latestDate,
    longestStreak,
    issuesPerMonth: parseFloat(issuesPerMonth),
    yearlyStats,
    topDomains,
    publishMonths,
    records: {
      maxLinks: maxLinksIssue,
      maxDomains: maxDomainsIssue,
      maxWords: maxWordsIssue,
    },
  };
})();
