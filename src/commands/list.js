const path = require('node:path');
const { TOOLS } = require('../lib/paths');
const { listCheckpoints } = require('../lib/checkpoints');
const { readJsonFile, parseNpmAudit, parseRetire, parseCveLite } = require('../lib/parse');
const { combinedSummary, checkpointStatus } = require('../lib/summary');

function summarize(checkpoint) {
  const npmDir = checkpoint.dirs[TOOLS.NPM_AUDIT];
  const retireDir = checkpoint.dirs[TOOLS.RETIRE];
  const cveDir = checkpoint.dirs[TOOLS.CVE_AUDIT];

  const npmFull = parseNpmAudit(npmDir ? readJsonFile(path.join(npmDir, 'report.json')) : null);
  const retire = parseRetire(retireDir ? readJsonFile(path.join(retireDir, 'report.json')) : null);
  const cveLite = parseCveLite(cveDir ? readJsonFile(path.join(cveDir, 'report.json')) : null);

  return combinedSummary(npmFull, retire, cveLite, { status: checkpointStatus(checkpoint) });
}

async function list(cwd) {
  const checkpoints = listCheckpoints(cwd);
  if (checkpoints.length === 0) {
    console.log('No checkpoints found yet. Run `secaudit scan` to create your first one.');
    return;
  }

  const rows = checkpoints.map((cp) => ({
    label: cp.label,
    timestamp: cp.timestamp,
    summary: summarize(cp),
  }));

  const labelWidth = Math.max(5, ...rows.map((r) => r.label.length));
  const tsWidth = Math.max(9, ...rows.map((r) => r.timestamp.length));

  console.log(`${'Label'.padEnd(labelWidth)}  ${'Timestamp'.padEnd(tsWidth)}  Summary`);
  for (const row of rows) {
    console.log(`${row.label.padEnd(labelWidth)}  ${row.timestamp.padEnd(tsWidth)}  ${row.summary}`);
  }
}

module.exports = list;
