function combinedSummary(npmFull, retire, cveLite, { npmSkipped = false } = {}) {
  const critical = npmFull.counts.critical + retire.counts.critical + cveLite.counts.critical;
  const high = npmFull.counts.high + retire.counts.high + cveLite.counts.high;
  const moderate = npmFull.counts.moderate + retire.counts.medium + cveLite.counts.medium;
  const low = npmFull.counts.low + retire.counts.low + cveLite.counts.low;
  const total = npmFull.counts.total + retire.findingRecords + cveLite.counts.total;

  const scope = npmSkipped ? 'across retire.js + cve-lite-cli — npm audit skipped' : 'across all three tools';

  if (total === 0) return `Clean — no findings (${scope}).`;
  const parts = [];
  if (critical) parts.push(`${critical} critical`);
  if (high) parts.push(`${high} high`);
  if (moderate) parts.push(`${moderate} moderate`);
  if (low) parts.push(`${low} low`);
  return `${parts.join(', ')} — ${total} total (${scope})`;
}

module.exports = { combinedSummary };
