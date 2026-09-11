const fs = require('node:fs');
const path = require('node:path');
const { TOOLS, toolDir, checkpointDir, formatTimestamp, ensureDir } = require('../lib/paths');
const { deriveLabel, readProjectVersion } = require('../lib/labels');
const { labelExists } = require('../lib/checkpoints');
const { BIN, isReachable, run, openInBrowser } = require('../lib/tools');
const { readJsonFile, parseNpmAudit, parseRetire, parseCveLite } = require('../lib/parse');
const { combinedSummary } = require('../lib/summary');

async function scan(cwd, { label: explicitLabel, open = true } = {}) {
  let label;
  try {
    if (explicitLabel) {
      label = explicitLabel;
    } else {
      const version = readProjectVersion(cwd);
      console.log(`Reading package.json → version ${version}`);
      label = deriveLabel(cwd, null);
    }
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
    return;
  }

  console.log(`Label: ${label}\n`);

  if (labelExists(cwd, label)) {
    console.log(`A checkpoint labeled "${label}" already exists. Options:`);
    console.log('  1. Pass a different --label (e.g. --label mid-fix-check)');
    console.log('  2. Bump the version in package.json first');
    process.exitCode = 1;
    return;
  }

  const timestamp = formatTimestamp(new Date());
  const npmDir = checkpointDir(cwd, TOOLS.NPM_AUDIT, timestamp, label);
  const retireDir = checkpointDir(cwd, TOOLS.RETIRE, timestamp, label);
  const cveDir = checkpointDir(cwd, TOOLS.CVE_AUDIT, timestamp, label);
  ensureDir(npmDir);
  ensureDir(retireDir);
  ensureDir(cveDir);

  const results = { npmAudit: false, retire: false, cveLite: false };

  // --- npm audit + audit-export ---
  process.stdout.write('Running npm audit...       ');
  const fullReportPath = path.join(npmDir, 'report.json');
  const prodReportPath = path.join(npmDir, 'report-prod.json');
  const htmlPath = path.join(npmDir, 'report.html');

  const fullAudit = run(BIN.npm, ['audit', '--json'], { cwd });
  const prodAudit = run(BIN.npm, ['audit', '--omit=dev', '--json'], { cwd });

  let fullJsonText = null;
  try {
    JSON.parse(fullAudit.stdout);
    fullJsonText = fullAudit.stdout;
  } catch {
    fullJsonText = null;
  }

  if (fullAudit.error || fullJsonText === null) {
    console.log(`failed (${fullAudit.error ? fullAudit.error.message : 'could not parse npm audit output'})`);
  } else {
    fs.writeFileSync(fullReportPath, fullJsonText);
    if (!prodAudit.error) {
      try {
        JSON.parse(prodAudit.stdout);
        fs.writeFileSync(prodReportPath, prodAudit.stdout);
      } catch {
        // production-tree capture is best-effort; full tree already saved
      }
    }

    if (!isReachable(BIN.auditExport)) {
      console.log(`done → ${fullReportPath} (audit-export not found — no HTML generated)`);
    } else {
      // audit-export's own --open flag is unreliable on Windows, so secaudit
      // always generates the HTML quietly and opens it itself below instead.
      const exportArgs = ['--path', htmlPath, '--title', `NPM Audit — ${label}`];
      const exportResult = run(BIN.auditExport, exportArgs, { cwd, input: fullJsonText });
      if (exportResult.error || !fs.existsSync(htmlPath)) {
        console.log(`done (JSON only — audit-export failed) → ${fullReportPath}`);
      } else {
        console.log(`done → ${htmlPath}`);
        results.npmAudit = true;
        if (open) openInBrowser(htmlPath);
      }
    }
  }

  // --- retire.js ---
  process.stdout.write('Running retire.js...       ');
  const retireReportPath = path.join(retireDir, 'report.json');
  if (!isReachable(BIN.retire)) {
    console.log('failed (retire not found — run `secaudit init` to install it)');
  } else {
    const retireResult = run(BIN.retire, ['--outputformat', 'json', '--outputpath', retireReportPath], { cwd });
    if (retireResult.error || !fs.existsSync(retireReportPath)) {
      console.log(`failed (${retireResult.error ? retireResult.error.message : 'no output produced'})`);
    } else {
      console.log(`done → ${retireReportPath} (no HTML for this tool)`);
      results.retire = true;
    }
  }

  // --- cve-lite ---
  process.stdout.write('Running cve-lite...        ');
  const cveIndexPath = path.join(cveDir, 'index.html');
  const cveReportPath = path.join(cveDir, 'report.json');
  if (!isReachable(BIN.cveLite)) {
    console.log('failed (cve-lite not found — run `secaudit init` to install it)');
  } else {
    const cveArgs = ['.', '--report', cveDir];
    if (!open) cveArgs.push('--no-open');
    const cveResult = run(BIN.cveLite, cveArgs, { cwd });
    if (cveResult.error || !fs.existsSync(cveReportPath)) {
      console.log(`failed (${cveResult.error ? cveResult.error.message : 'no output produced'})`);
    } else {
      console.log(`done → ${cveIndexPath}`);
      results.cveLite = true;
    }
  }

  console.log('');

  const npmFullParsed = results.npmAudit || fs.existsSync(fullReportPath) ? parseNpmAudit(readJsonFile(fullReportPath)) : parseNpmAudit(null);
  const retireParsed = results.retire ? parseRetire(readJsonFile(retireReportPath)) : parseRetire(null);
  const cveLiteParsed = results.cveLite ? parseCveLite(readJsonFile(cveReportPath)) : parseCveLite(null);

  console.log(`Summary: ${combinedSummary(npmFullParsed, retireParsed, cveLiteParsed)}`);

  if (open && results.npmAudit) console.log('Opening npm audit report in browser...');
  if (open && results.cveLite) console.log('Opening cve-lite report in browser...');
}

module.exports = scan;
