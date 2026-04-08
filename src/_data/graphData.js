// Compute domain co-occurrence graph from emails.json for the /graph/ page.
const emails = require("./emails.json");

module.exports = (() => {
  const MIN_APPEARANCES = 3;
  const MIN_EDGE_WEIGHT = 2;

  const domainCounts = {};
  const domainIssues = {};
  const issueDomains = [];

  // Pass 1: count domain appearances and build domain→issue index
  for (const email of emails) {
    const domains = email.domains || [];
    if (domains.length === 0) continue;

    const issueRef = {
      number: email.number,
      subject: email.subject,
      date: email.publish_date,
    };

    for (const d of domains) {
      domainCounts[d] = (domainCounts[d] || 0) + 1;
      if (!domainIssues[d]) domainIssues[d] = [];
      domainIssues[d].push(issueRef);
    }

    issueDomains.push(domains);
  }

  // Filter to domains with enough appearances
  const qualifyingDomains = new Set(
    Object.entries(domainCounts)
      .filter(([, count]) => count >= MIN_APPEARANCES)
      .map(([domain]) => domain)
  );

  // Build nodes
  const nodes = [];
  for (const domain of qualifyingDomains) {
    const issues = domainIssues[domain];
    const dates = issues.map((i) => i.date).filter(Boolean).sort();
    nodes.push({
      id: domain,
      count: domainCounts[domain],
      firstSeen: dates[0] || null,
      lastSeen: dates[dates.length - 1] || null,
    });
  }

  // Pass 2: build co-occurrence edges
  const edgeMap = {};
  for (const domains of issueDomains) {
    // Filter to qualifying domains in this issue
    const qualified = domains.filter((d) => qualifyingDomains.has(d));

    // Create edges for each pair
    for (let i = 0; i < qualified.length; i++) {
      for (let j = i + 1; j < qualified.length; j++) {
        const a = qualified[i];
        const b = qualified[j];
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        edgeMap[key] = (edgeMap[key] || 0) + 1;
      }
    }
  }

  // Filter edges by minimum weight
  const edges = [];
  for (const [key, weight] of Object.entries(edgeMap)) {
    if (weight >= MIN_EDGE_WEIGHT) {
      const [source, target] = key.split("|");
      edges.push({ source, target, weight });
    }
  }

  // Filter domainIssues to only qualifying domains, sort by date descending
  const filteredDomainIssues = {};
  for (const domain of qualifyingDomains) {
    filteredDomainIssues[domain] = domainIssues[domain].sort(
      (a, b) => (b.date || "").localeCompare(a.date || "")
    );
  }

  // Count issues that have domains (for the subtitle)
  const issuesWithDomains = emails.filter(
    (e) => (e.domains || []).length > 0
  ).length;

  return {
    nodes,
    edges,
    domainIssues: filteredDomainIssues,
    issuesWithDomains,
    minAppearances: MIN_APPEARANCES,
  };
})();
