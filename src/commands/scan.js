const fs = require('node:fs');
const path = require('node:path');
const { TOOLS, checkpointDir, formatTimestamp, ensureDir } = require('../lib/paths');
const { deriveLabel, readProjectVersion } = require('../lib/labels');
const { labelExists } = require('../lib/checkpoints');
const { BIN, isReachable, run, openInBrowser } = require('../lib/tools');
const { readJsonFile, parseNpmAudit, parseRetire, parseCveLite } = require('../lib/parse');
const { combinedSummary } = require('../lib/summary');
const { detectLockfile } = require('../lib/packageManager');
const { isSkipped } = require('../lib/config');
const ui = require('../lib/ui');

const SKIPPED_BY_USER = 'skipped for this project (chosen during `secaudit init`) — run `secaudit init` to re-enable';
const NOT_FOUND_HINT = 'not installed — run `secaudit doctor` to see why, or `secaudit init` to install or skip it';

// Written into a tool's checkpoint folder so `list` and `compare` can tell
// "skipped" apart from "ran and found nothing" long after the scan.
function writeSkippedMarker(dir, text) {
  fs.writeFileSync(path.join(dir, 'SKIPPED.txt'), `${text}\n`);
}

function runNpmAudit(cwd, { npmDir, label, open }) {
  const fullReportPath = path.join(npmDir, 'report.json');
  const prodReportPath = path.join(npmDir, 'report-prod.json');
  const htmlPath = path.join(npmDir, 'report.html');
  const name = ui.col('npm audit', 14);
  const spin = ui.spinner('Running npm audit...');

  // npm audit only understands npm's own lockfile — running it against a
  // pnpm/yarn/bun project fails with ENOLOCK. That failure is still valid
  // JSON on stdout, so it must be checked for explicitly below; detecting
  // the lockfile up front lets us skip the doomed call and explain why.
  const lockfile = detectLockfile(cwd);
  if (lockfile && lockfile.manager !== 'npm') {
    writeSkippedMarker(
      npmDir,
      `npm audit skipped: this project uses ${lockfile.manager} (${lockfile.file} found), not npm's package-lock.json.\nThe other scanners still ran and cover this project.`
    );
    spin.skip(`${name}skipped (project uses ${lockfile.manager} — ${lockfile.file} found, not npm's package-lock.json)`);
    return { status: 'skipped', html: false, fullReportPath };
  }

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
  if (fullAudit.error || fullParsed === null || fullParsed.error) {
    let reason = 'could not parse npm audit output';
    if (fullAudit.error) reason = fullAudit.error.message;
    else if (fullParsed?.error) reason = fullParsed.error.summary;
    spin.fail(`${name}failed (${reason})`);
    return { status: 'failed', html: false, fullReportPath };
  }

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

  if (isSkipped(cwd, 'auditExport')) {
    spin.succeed(`${name}→ ${fullReportPath} ${ui.color.dim('(audit-export skipped — JSON only)')}`);
    return { status: 'ran', html: false, fullReportPath };
  }
  if (!isReachable(BIN.auditExport)) {
    spin.warn(`${name}→ ${fullReportPath} ${ui.color.dim('(audit-export not installed — no HTML; `secaudit init` to fix)')}`);
    return { status: 'ran', html: false, fullReportPath };
  }

  // audit-export's own --open flag is unreliable on Windows, so secaudit
  // always generates the HTML quietly and opens it itself below instead.
  const exportArgs = ['--path', htmlPath, '--title', `NPM Audit — ${label}`];
  const exportResult = run(BIN.auditExport, exportArgs, { cwd, input: fullJsonText });
  if (exportResult.error || !fs.existsSync(htmlPath)) {
    spin.warn(`${name}→ ${fullReportPath} ${ui.color.dim('(JSON only — audit-export failed)')}`);
    return { status: 'ran', html: false, fullReportPath };
  }
  spin.succeed(`${name}→ ${htmlPath}`);
  if (open) openInBrowser(htmlPath);
  return { status: 'ran', html: true, fullReportPath };
}

function runRetire(cwd, { retireDir }) {
  const reportPath = path.join(retireDir, 'report.json');
  const name = ui.col('retire.js', 14);
  const spin = ui.spinner('Running retire.js...');

  if (isSkipped(cwd, 'retire')) {
    writeSkippedMarker(retireDir, 'retire.js skipped: disabled for this project during `secaudit init`.');
    spin.skip(`${name}${SKIPPED_BY_USER}`);
    return { status: 'skipped', reportPath };
  }
  if (!isReachable(BIN.retire)) {
    spin.fail(`${name}${NOT_FOUND_HINT}`);
    return { status: 'failed', reportPath };
  }
  const result = run(BIN.retire, ['--outputformat', 'json', '--outputpath', reportPath], { cwd });
  if (result.error || !fs.existsSync(reportPath)) {
    spin.fail(`${name}failed (${result.error ? result.error.message : 'no output produced'})`);
    return { status: 'failed', reportPath };
  }
  spin.succeed(`${name}→ ${reportPath} ${ui.color.dim('(no HTML for this tool)')}`);
  return { status: 'ran', reportPath };
}

function runCveLite(cwd, { cveDir, open }) {
  const indexPath = path.join(cveDir, 'index.html');
  const reportPath = path.join(cveDir, 'report.json');
  const name = ui.col('cve-lite-cli', 14);
  const spin = ui.spinner('Running cve-lite-cli...');

  if (isSkipped(cwd, 'cveLite')) {
    writeSkippedMarker(cveDir, 'cve-lite-cli skipped: disabled for this project during `secaudit init`.');
    spin.skip(`${name}${SKIPPED_BY_USER}`);
    return { status: 'skipped', reportPath };
  }
  if (!isReachable(BIN.cveLite)) {
    spin.fail(`${name}${NOT_FOUND_HINT}`);
    return { status: 'failed', reportPath };
  }
  const args = ['.', '--report', cveDir];
  if (!open) args.push('--no-open');
  const result = run(BIN.cveLite, args, { cwd });
  if (result.error || !fs.existsSync(reportPath)) {
    spin.fail(`${name}failed (${result.error ? result.error.message : 'no output produced'})`);
    return { status: 'failed', reportPath };
  }
  spin.succeed(`${name}→ ${indexPath}`);
  return { status: 'ran', reportPath };
}

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

  const npm = runNpmAudit(cwd, { npmDir, label, open });
  const retire = runRetire(cwd, { retireDir });
  const cve = runCveLite(cwd, { cveDir, open });

  console.log('');

  const npmFullParsed = parseNpmAudit(npm.status === 'ran' ? readJsonFile(npm.fullReportPath) : null);
  const retireParsed = parseRetire(retire.status === 'ran' ? readJsonFile(retire.reportPath) : null);
  const cveLiteParsed = parseCveLite(cve.status === 'ran' ? readJsonFile(cve.reportPath) : null);
  const status = { npmAudit: npm.status, retire: retire.status, cveLite: cve.status };

  console.log(`Summary: ${combinedSummary(npmFullParsed, retireParsed, cveLiteParsed, { status })}`);

  if (open && npm.html) console.log('Opening npm audit report in browser...');
  if (open && cve.status === 'ran') console.log('Opening cve-lite report in browser...');
}

module.exports = scan;
