const fs = require('node:fs');
const path = require('node:path');
const { TOOLS, comparisonsDir, ensureDir } = require('../lib/paths');
const { findByLabel, mostRecentTwo, allLabels } = require('../lib/checkpoints');
const { readJsonFile, parseNpmAudit, parseRetire, parseCveLite } = require('../lib/parse');
const { buildComparisonMarkdown } = require('../lib/comparison');
const { checkpointStatus } = require('../lib/summary');

function loadSide(checkpoint) {
  const npmDir = checkpoint.dirs[TOOLS.NPM_AUDIT];
  const retireDir = checkpoint.dirs[TOOLS.RETIRE];
  const cveDir = checkpoint.dirs[TOOLS.CVE_AUDIT];

  const npmFullJson = npmDir ? readJsonFile(path.join(npmDir, 'report.json')) : null;
  const npmProdJson = npmDir ? readJsonFile(path.join(npmDir, 'report-prod.json')) : null;
  const retireJson = retireDir ? readJsonFile(path.join(retireDir, 'report.json')) : null;
  const cveLiteJson = cveDir ? readJsonFile(path.join(cveDir, 'report.json')) : null;

  return {
    npmFull: parseNpmAudit(npmFullJson),
    npmProd: parseNpmAudit(npmProdJson),
    retire: parseRetire(retireJson),
    cveLite: parseCveLite(cveLiteJson),
  };
}

function printAvailableLabels(cwd) {
  const labels = allLabels(cwd);
  if (labels.length === 0) {
    console.log('No checkpoints found yet. Run `secaudit scan` first.');
    return;
  }
  console.log('Available labels:');
  for (const l of labels) console.log(`  - ${l}`);
}

async function compare(cwd, label1, label2, { beforeTimestamp } = {}) {
  let beforeCp;
  let afterCp;

  if (!label1 && !label2) {
    const recent = mostRecentTwo(cwd);
    if (recent.length < 2) {
      console.log('Not enough checkpoints to compare yet — run `secaudit scan` at least twice.');
      process.exitCode = 1;
      return;
    }
    [afterCp, beforeCp] = recent; // mostRecentTwo is sorted newest-first
    label1 = beforeCp.label;
    label2 = afterCp.label;
    console.log(`No labels given — comparing the two most recent checkpoints:`);
    console.log(`  Before: ${label1} (${beforeCp.timestamp})`);
    console.log(`  After:  ${label2} (${afterCp.timestamp})\n`);
  } else {
    // --before-timestamp is the escape hatch for the "before" side only.
    beforeCp = findByLabel(cwd, label1, beforeTimestamp);
    afterCp = findByLabel(cwd, label2);

    if (!beforeCp) {
      console.log(`No checkpoint found for label "${label1}".`);
      printAvailableLabels(cwd);
      process.exitCode = 1;
      return;
    }
    if (!afterCp) {
      console.log(`No checkpoint found for label "${label2}".`);
      printAvailableLabels(cwd);
      process.exitCode = 1;
      return;
    }
  }

  const before = loadSide(beforeCp);
  const after = loadSide(afterCp);

  const markdown = buildComparisonMarkdown({
    label1,
    label2,
    timestamp1: beforeCp.timestamp,
    timestamp2: afterCp.timestamp,
    npmFull: { before: before.npmFull, after: after.npmFull },
    npmProd: { before: before.npmProd, after: after.npmProd },
    retire: { before: before.retire, after: after.retire },
    cveLite: { before: before.cveLite, after: after.cveLite },
    status: { before: checkpointStatus(beforeCp), after: checkpointStatus(afterCp) },
  });

  ensureDir(comparisonsDir(cwd));
  const outPath = path.join(comparisonsDir(cwd), `${label1}_vs_${label2}.md`);
  fs.writeFileSync(outPath, markdown);

  console.log(`Comparison written to: ${outPath}`);
}

module.exports = compare;
