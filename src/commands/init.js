const fs = require('node:fs');
const path = require('node:path');
const { TOOLS, auditsDir, toolDir, comparisonsDir, ensureDir } = require('../lib/paths');
const { BIN, INSTALL_PACKAGE, isReachable, installGlobal } = require('../lib/tools');
const { confirm } = require('../lib/prompt');

async function checkAndOfferInstall(name, bin, pkg) {
  if (isReachable(bin)) {
    console.log(`  ✔ ${name} found`);
    return true;
  }
  console.log(`  ✘ ${name} not found`);
  if (!pkg) {
    console.log(`    secaudit cannot install ${name} for you — check your Node.js installation.`);
    return false;
  }
  const shouldInstall = await confirm(`    Install it now with "npm install -g ${pkg}"?`, true);
  if (!shouldInstall) {
    console.log(`    Skipped. secaudit will report this tool as unavailable until it's installed.`);
    return false;
  }
  const ok = installGlobal(pkg);
  console.log(ok ? `    Installed ${pkg}.` : `    Install failed — you can retry manually later.`);
  return ok;
}

async function addAuditsToGitignore(cwd) {
  const gitignorePath = path.join(cwd, '.gitignore');
  const entry = 'audits';
  let existing = '';
  if (fs.existsSync(gitignorePath)) {
    existing = fs.readFileSync(gitignorePath, 'utf8');
    const already = existing.split(/\r?\n/).some((line) => line.trim() === entry || line.trim() === `${entry}/`);
    if (already) {
      console.log('  .gitignore already ignores audits/.');
      return;
    }
  }
  const needsNewline = existing.length > 0 && !existing.endsWith('\n');
  fs.writeFileSync(gitignorePath, existing + (needsNewline ? '\n' : '') + `${entry}\n`);
  console.log('  Added audits/ to .gitignore.');
}

async function init(cwd) {
  console.log('Setting up secaudit...\n');

  console.log('Creating audits/ folder structure...');
  ensureDir(toolDir(cwd, TOOLS.NPM_AUDIT));
  ensureDir(toolDir(cwd, TOOLS.RETIRE));
  ensureDir(toolDir(cwd, TOOLS.CVE_AUDIT));
  ensureDir(comparisonsDir(cwd));
  console.log(`  ✔ ${auditsDir(cwd)}\n`);

  console.log('Checking scanners...');
  await checkAndOfferInstall('npm', BIN.npm, null);
  await checkAndOfferInstall('retire.js', BIN.retire, INSTALL_PACKAGE.retire);
  await checkAndOfferInstall('cve-lite-cli', BIN.cveLite, INSTALL_PACKAGE.cveLite);
  await checkAndOfferInstall('audit-export', BIN.auditExport, INSTALL_PACKAGE.auditExport);
  console.log('');

  const addToGitignore = await confirm('Add audits/ to .gitignore? (raw scan data can be large and project-specific)', true);
  if (addToGitignore) {
    await addAuditsToGitignore(cwd);
  } else {
    console.log('  Leaving .gitignore untouched — audit history will be tracked in git.');
  }

  console.log("\nYou're ready — run `secaudit scan` to get your first baseline.");
}

module.exports = init;
