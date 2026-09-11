const fs = require('node:fs');
const path = require('node:path');
const { TOOLS, toolDir, checkpointDir, formatTimestamp, ensureDir } = require('../lib/paths');
const { deriveLabel, readProjectVersion } = require('../lib/labels');
const { labelExists } = require('../lib/checkpoints');
const { BIN, isReachable, run, openInBrowser } = require('../lib/tools');
const { readJsonFile, parseNpmAudit, parseRetire, parseCveLite } = require('../lib/parse');
const { combinedSummary } = require('../lib/summary');
const { detectLockfile } = require('../lib/packageManager');

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
  let npmSkipped = false;

  // --- npm audit + audit-export ---
  process.stdout.write('Running npm audit...       ');
  const fullReportPath = path.join(npmDir, 'report.json');
  const prodReportPath = path.join(npmDir, 'report-prod.json');
  const htmlPath = path.join(npmDir, 'report.html');
  const skippedMarkerPath = path.join(npmDir, 'SKIPPED.txt');

  // npm audit only understands npm's own lockfile — running it against a
  // pnpm/yarn/bun project fails with ENOLOCK. That failure is still valid
  // JSON on stdout, so it must be checked for explicitly below; detecting
  // the lockfile up front lets us skip the doomed call and explain why.
  const lockfile = detectLockfile(cwd);
  if (lockfile && lockfile.manager !== 'npm') {
    npmSkipped = true;
    fs.writeFileSync(
      skippedMarkerPath,
      `npm audit skipped: this project uses ${lockfile.manager} (${lockfile.file} found), not npm's package-lock.json.\nretire.js and cve-lite-cli both still ran and cover this project.\n`
    );
    console.log(`skipped (project uses ${lockfile.manager} — ${lockfile.file} found, not npm's package-lock.json)`);
  } else {
    const fullAudit = run(BIN.npm, ['audit', '--json'], { cwd });
    const prodAudit = run(BIN.npm, ['audit', '--omit=dev', '--json'], { cwd });

    let fullParsed = null;
    try {
      fullParsed = JSON.parse(fullAudit.stdout);
    } catch {
      fullParsed = null;
    }
    // npm audit reports real failures (missing lockfile, registry errors,
    // etc.) as a valid `{ error: {...} }` JSON body with a non-zero exit
    // code, not as a spawn error — treat that shape as a failure too,
    // otherwise it silently reads as "0 vulnerabilities found".
    const npmAuditFailed = fullAudit.error || fullParsed === null || fullParsed.error;

    if (npmAuditFailed) {
      let reason = 'could not parse npm audit output';
      if (fullAudit.error) reason = fullAudit.error.message;
      else if (fullParsed?.error) reason = fullParsed.error.summary;
      console.log(`failed (${reason})`);
    } else {
      const fullJsonText = fullAudit.stdout;
      fs.writeFileSync(fullReportPath, fullJsonText);
      if (!prodAudit.error) {
        try {
          const prodParsed = JSON.parse(prodAudit.stdout);
          if (!prodParsed.error) fs.writeFileSync(prodReportPath, prodAudit.stdout);
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

  console.log(`Summary: ${combinedSummary(npmFullParsed, retireParsed, cveLiteParsed, { npmSkipped })}`);

  if (open && results.npmAudit) console.log('Opening npm audit report in browser...');
  if (open && results.cveLite) console.log('Opening cve-lite report in browser...');
}

module.exports = scan;
