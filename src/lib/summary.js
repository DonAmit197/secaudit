const fs = require('node:fs');
const path = require('node:path');
const { TOOLS } = require('./paths');

const TOOL_NAMES = { npmAudit: 'npm audit', retire: 'retire.js', cveLite: 'cve-lite-cli' };

// status: { npmAudit, retire, cveLite } each 'ran' | 'skipped' | 'failed'.
// The scope must say which tools actually contributed, so a skipped or
// failed scanner is never mistaken for "no vulnerabilities found".
function scopeText(status) {
  const ids = Object.keys(TOOL_NAMES);
  const ran = ids.filter((id) => status[id] === 'ran').map((id) => TOOL_NAMES[id]);
  const notRun = ids.filter((id) => status[id] !== 'ran').map((id) => `${TOOL_NAMES[id]} ${status[id] || 'not run'}`);
  if (notRun.length === 0) return 'across all three tools';
  return `across ${ran.join(' + ')} — ${notRun.join(', ')}`;
}

function combinedSummary(npmFull, retire, cveLite, { status = { npmAudit: 'ran', retire: 'ran', cveLite: 'ran' } } = {}) {
  if (!Object.values(status).includes('ran')) return 'No results — no scanner ran successfully.';

  const critical = npmFull.counts.critical + retire.counts.critical + cveLite.counts.critical;
  const high = npmFull.counts.high + retire.counts.high + cveLite.counts.high;
  const moderate = npmFull.counts.moderate + retire.counts.medium + cveLite.counts.medium;
  const low = npmFull.counts.low + retire.counts.low + cveLite.counts.low;
  const total = npmFull.counts.total + retire.findingRecords + cveLite.counts.total;

  const scope = scopeText(status);

  if (total === 0) return `Clean — no findings (${scope}).`;
  const parts = [];
  if (critical) parts.push(`${critical} critical`);
  if (high) parts.push(`${high} high`);
  if (moderate) parts.push(`${moderate} moderate`);
  if (low) parts.push(`${low} low`);
  return `${parts.join(', ')} — ${total} total (${scope})`;
}

// Reconstructs each tool's status for a checkpoint already on disk:
// a SKIPPED.txt marker means skipped, a report.json means it ran,
// anything else means it failed (or predates secaudit writing markers).
function checkpointStatus(checkpoint) {
  const statusOf = (dir) => {
    if (!dir) return 'not run';
    if (fs.existsSync(path.join(dir, 'SKIPPED.txt'))) return 'skipped';
    if (fs.existsSync(path.join(dir, 'report.json'))) return 'ran';
    return 'failed';
  };
  return {
    npmAudit: statusOf(checkpoint.dirs[TOOLS.NPM_AUDIT]),
    retire: statusOf(checkpoint.dirs[TOOLS.RETIRE]),
    cveLite: statusOf(checkpoint.dirs[TOOLS.CVE_AUDIT]),
  };
}

module.exports = { combinedSummary, checkpointStatus, TOOL_NAMES };
