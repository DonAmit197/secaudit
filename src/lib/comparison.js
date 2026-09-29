function diffIds(beforeSet, afterSet) {
  const closed = [...beforeSet].filter((id) => !afterSet.has(id)).sort();
  const stillOpen = [...beforeSet].filter((id) => afterSet.has(id)).sort();
  const newlyIntroduced = [...afterSet].filter((id) => !beforeSet.has(id)).sort();
  return { closed, stillOpen, newlyIntroduced };
}

function delta(before, after) {
  const d = after - before;
  return d > 0 ? `+${d}` : `${d}`;
}

function severityTable(order, before, after) {
  const lines = ['| Severity | Before | After | Delta |', '|----------|--------|-------|-------|'];
  for (const key of order) {
    lines.push(`| ${key} | ${before[key] || 0} | ${after[key] || 0} | ${delta(before[key] || 0, after[key] || 0)} |`);
  }
  return lines.join('\n');
}

function bulletList(items) {
  if (items.length === 0) return '_None._';
  return items.map((id) => `- \`${id}\``).join('\n');
}

function closedOpenIntroducedSection(diff) {
  return [
    '### Closed',
    bulletList(diff.closed),
    '',
    '### Still open',
    bulletList(diff.stillOpen),
    '',
    '### Newly introduced',
    bulletList(diff.newlyIntroduced),
  ].join('\n');
}

function plainLanguageVerdict(prodDiff, prodAfterCounts) {
  const summary = `${prodDiff.closed.length} closed, ${prodDiff.stillOpen.length} still open, ${prodDiff.newlyIntroduced.length} newly introduced`;
  if ((prodAfterCounts.total || 0) === 0) {
    return `${summary} — production tree clean, ready to ship.`;
  }
  return `${summary} — production tree still has ${prodAfterCounts.total} finding(s), action needed before release.`;
}

// A tool that didn't run on one side reads as "0 findings" there, which
// would show every finding as closed or newly introduced. Flag it instead.
function notRunNote(toolId, status, label1, label2) {
  if (!status) return null;
  const sides = [];
  if (status.before[toolId] !== 'ran') sides.push(`\`${label1}\` (${status.before[toolId]})`);
  if (status.after[toolId] !== 'ran') sides.push(`\`${label2}\` (${status.after[toolId]})`);
  if (sides.length === 0) return null;
  return `> **Not comparable:** this tool did not run for ${sides.join(' and ')}. Its numbers below are not a real before/after.`;
}

function pushNote(lines, note) {
  if (!note) return;
  lines.push(note, '');
}

function buildComparisonMarkdown({ label1, label2, timestamp1, timestamp2, npmFull, npmProd, retire, cveLite, status }) {
  const npmFullDiff = diffIds(npmFull.before.ids, npmFull.after.ids);
  const npmProdDiff = diffIds(npmProd.before.ids, npmProd.after.ids);
  const retireDiff = diffIds(retire.before.ids, retire.after.ids);
  const cveLiteDiff = diffIds(cveLite.before.ids, cveLite.after.ids);

  const lines = [];
  lines.push('# Scan comparison');
  lines.push('');
  lines.push(`- Generated: ${new Date().toISOString()}`);
  lines.push(`- Before: \`${timestamp1}_${label1}\``);
  lines.push(`- After: \`${timestamp2}_${label2}\``);
  lines.push('');
  lines.push('This report is produced from the raw checkpoint JSON. Confirm the IDs against');
  lines.push('the original scanner files before sending to a stakeholder.');
  lines.push('');
  lines.push(`**Verdict:** ${plainLanguageVerdict(npmProdDiff, npmProd.after.counts)}`);
  lines.push('');

  lines.push('## npm audit — production tree (`--omit=dev`)');
  lines.push('');
  lines.push('This is the gate. It must read zero before a release.');
  lines.push('');
  pushNote(lines, notRunNote('npmAudit', status, label1, label2));
  lines.push(severityTable(['critical', 'high', 'moderate', 'low', 'total'], npmProd.before.counts, npmProd.after.counts));
  lines.push('');
  lines.push(closedOpenIntroducedSection(npmProdDiff));
  lines.push('');

  lines.push('## npm audit — full tree (build toolchain included, informational)');
  lines.push('');
  lines.push(severityTable(['critical', 'high', 'moderate', 'low', 'info', 'total'], npmFull.before.counts, npmFull.after.counts));
  lines.push('');
  lines.push(closedOpenIntroducedSection(npmFullDiff));
  lines.push('');

  lines.push('## retire');
  lines.push('');
  pushNote(lines, notRunNote('retire', status, label1, label2));
  lines.push('| | Before | After | Delta |');
  lines.push('|--|--------|-------|-------|');
  lines.push(`| Finding records | ${retire.before.findingRecords} | ${retire.after.findingRecords} | ${delta(retire.before.findingRecords, retire.after.findingRecords)} |`);
  lines.push(`| Distinct IDs | ${retire.before.ids.size} | ${retire.after.ids.size} | ${delta(retire.before.ids.size, retire.after.ids.size)} |`);
  lines.push('');
  lines.push(closedOpenIntroducedSection(retireDiff));
  lines.push('');

  lines.push('## cve-lite-cli');
  lines.push('');
  pushNote(lines, notRunNote('cveLite', status, label1, label2));
  lines.push(severityTable(['critical', 'high', 'medium', 'low', 'unknown', 'total'], cveLite.before.counts, cveLite.after.counts));
  lines.push('');
  lines.push(closedOpenIntroducedSection(cveLiteDiff));
  lines.push('');

  lines.push('---');
  lines.push('');
  lines.push('## Summary for review');
  lines.push('');
  lines.push('_Fill this section in by hand before sending. It is what gets read first._');
  lines.push('');
  lines.push('- What changed in this cycle:');
  lines.push('- What is now closed:');
  lines.push('- What remains open, and why it is deferred:');
  lines.push('- Any new findings introduced by a dependency bump:');
  lines.push('- Residual risk / recommended next step:');

  return lines.join('\n') + '\n';
}

module.exports = { diffIds, buildComparisonMarkdown, plainLanguageVerdict };
