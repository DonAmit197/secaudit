const fs = require('node:fs');
const path = require('node:path');
const { TOOLS, auditsDir, toolDir, comparisonsDir, ensureDir } = require('../lib/paths');
const { SCANNERS, getVersion, installGlobal } = require('../lib/tools');
const { confirm, closePrompts } = require('../lib/prompt');
const { isSkipped, setSkipped } = require('../lib/config');
const { diagnoseInstall } = require('../lib/diagnose');
const env = require('../lib/env');
const ui = require('../lib/ui');

const ask = (text) => `  ${ui.color.cyan('?')} ${text}`;

// What the user keeps if they skip a tool — said out loud so skipping feels
// like a safe choice rather than a broken setup.
function skipEffect(scanner) {
  if (scanner.purpose) return `npm audit still runs, just without its ${scanner.purpose}.`;
  return `\`secaudit scan\` still runs the other scanners and leaves ${scanner.name} out of the results.`;
}

async function offerSkip(cwd, scanner) {
  ui.detail(skipEffect(scanner));
  const yes = await confirm(ask(`Skip ${scanner.name} for this project?`), true);
  if (yes) {
    setSkipped(cwd, scanner.id, true);
    ui.skip(`${ui.col(scanner.name)}skipped — re-enable any time with \`secaudit init\``);
    return 'skipped';
  }
  ui.detail('Leaving it enabled. Fix the issue above, then run `secaudit init` again.');
  ui.detail('Until then `secaudit scan` will report it as missing.');
  return 'missing';
}

function printDiagnosis(diagnosis, logPath, cwd) {
  console.log('');
  ui.detail(`${ui.color.bold('Why:')} ${diagnosis.title}`);
  ui.detail(diagnosis.why.join('\n'), 3);
  console.log('');
  ui.detail(ui.color.bold('How to fix:'));
  ui.detail(diagnosis.fixes.join('\n'), 3);
  console.log('');
  if (logPath) ui.detail(ui.color.dim(`Full npm log: ${path.relative(cwd, logPath)}`));
  ui.detail(`Run ${ui.color.cyan('secaudit doctor')} for a full check of your machine (PATH, proxy, GitHub access).`);
  console.log('');
}

// Shown before the install question, so that if it breaks the user already
// has a hint why — and knows `secaudit doctor` is where to look next.
function printNeeds(scanner, ctx) {
  const bullet = (text) => {
    const [first, ...rest] = text.split('\n');
    ui.detail(`• ${first}`, 3);
    for (const more of rest) ui.detail(`  ${more}`, 3);
  };
  ui.detail(ui.color.dim(`${scanner.name} needs:`));
  bullet(`Node.js ${scanner.minNode}+ ${ui.color.dim(`(you have ${ctx.node.version})`)}`);
  scanner.needs.forEach(bullet);
  if (scanner.headsUp) ui.detail(`${ui.color.yellow('Heads-up:')} ${scanner.headsUp}`);
  ui.detail(ui.color.dim('If the install fails, run `secaudit doctor` to check your machine.'));
}

async function installScanner(cwd, scanner, ctx) {
  const label = ui.col(scanner.name);
  const spin = ui.spinner(`Installing ${scanner.name}...`);
  const logPath = path.join(auditsDir(cwd), 'logs', `install-${scanner.pkg}.log`);
  const result = await installGlobal(scanner.pkg, logPath);

  if (result.ok) {
    const version = getVersion(scanner.bin);
    if (version) {
      spin.succeed(`${label}${ui.color.dim(version)} — installed`);
      return 'ready';
    }
    spin.warn(`${label}installed, but your terminal can't find it yet`);
    ui.detail("npm's global folder isn't on your PATH (see Environment above). Fix that, open a new terminal,");
    ui.detail('and it will work — no reinstall needed.');
    return 'missing';
  }

  spin.fail(`${label}could not be installed`);
  printDiagnosis(diagnoseInstall(result.output, scanner, { globalModulesDir: ctx.globalModulesDir() }), result.logPath, cwd);
  return offerSkip(cwd, scanner);
}

// Returns 'ready' | 'skipped' | 'missing'.
async function setupScanner(cwd, scanner, ctx) {
  const label = ui.col(scanner.name);
  const purpose = scanner.purpose ? ui.color.dim(` (${scanner.purpose})`) : '';
  const version = getVersion(scanner.bin);

  if (version) {
    if (isSkipped(cwd, scanner.id)) {
      setSkipped(cwd, scanner.id, false);
      ui.ok(`${label}${ui.color.dim(version)} — found, re-enabled for this project`);
    } else {
      ui.ok(`${label}${ui.color.dim(version)}${purpose}`);
    }
    return 'ready';
  }

  if (isSkipped(cwd, scanner.id)) {
    ui.skip(`${label}skipped for this project`);
    const retry = await confirm(ask(`Try installing ${scanner.name} again?`), false);
    if (!retry) return 'skipped';
  } else {
    ui.fail(`${label}not installed${purpose}`);
  }

  // Catch the failures we can predict before npm spends a minute failing.
  if (!ctx.npmVersion) {
    ui.detail('npm itself is missing, so secaudit cannot install anything. Reinstall Node.js from https://nodejs.org.');
    return offerSkip(cwd, scanner);
  }
  if (ctx.node.major < scanner.minNode) {
    ui.detail(`${scanner.name} needs Node.js ${scanner.minNode} or later — this machine has ${ctx.node.version}, so installing it would fail.`);
    ui.detail(`Upgrade Node.js (https://nodejs.org), open a new terminal, and run \`secaudit init\` again.`);
    return offerSkip(cwd, scanner);
  }

  printNeeds(scanner, ctx);
  const install = await confirm(ask(`Install ${scanner.name} now? (npm install -g ${scanner.pkg})`), true);
  if (!install) return offerSkip(cwd, scanner);
  return installScanner(cwd, scanner, ctx);
}

function checkEnvironment() {
  const node = env.nodeInfo();
  ui.ok(`${ui.col('Node.js')}${node.version} ${ui.color.dim(`(${node.platform}-${node.arch})`)}`);

  const npmVersion = env.npmVersion();
  if (npmVersion) ui.ok(`${ui.col('npm')}${npmVersion}`);
  else ui.fail(`${ui.col('npm')}not found — reinstall Node.js from https://nodejs.org`);

  const binDir = npmVersion ? env.npmGlobalBinDir() : null;
  if (binDir && !env.isOnPath(binDir)) {
    ui.warn(`${ui.col('PATH')}npm's global folder is not on your PATH`);
    ui.detail(`${binDir}`);
    ui.detail('Globally installed commands (including `secaudit` itself) only work through `npx` until it is. Fix:');
    ui.detail(env.pathFixCommand(binDir), 3);
    ui.detail('Then open a new terminal.');
  } else if (binDir) {
    ui.ok(`${ui.col('PATH')}${ui.color.dim("npm's global folder is on PATH")}`);
  }

  let modulesDir;
  return {
    node,
    npmVersion,
    globalModulesDir: () => {
      if (modulesDir === undefined) modulesDir = env.npmGlobalModulesDir();
      return modulesDir;
    },
  };
}

async function addAuditsToGitignore(cwd) {
  const gitignorePath = path.join(cwd, '.gitignore');
  const entry = 'audits';
  let existing = '';
  if (fs.existsSync(gitignorePath)) {
    existing = fs.readFileSync(gitignorePath, 'utf8');
    const already = existing.split(/\r?\n/).some((line) => line.trim() === entry || line.trim() === `${entry}/`);
    if (already) {
      ui.ok('.gitignore already ignores audits/');
      return;
    }
  }
  const needsNewline = existing.length > 0 && !existing.endsWith('\n');
  fs.writeFileSync(gitignorePath, existing + (needsNewline ? '\n' : '') + `${entry}\n`);
  ui.ok('Added audits/ to .gitignore');
}

function printReady(statuses) {
  const scanners = SCANNERS.filter((s) => !s.purpose);
  const willRun = ['npm audit', ...scanners.filter((s) => statuses[s.id] === 'ready').map((s) => s.name)];
  const skipped = SCANNERS.filter((s) => statuses[s.id] === 'skipped').map((s) => s.name);
  const missing = SCANNERS.filter((s) => statuses[s.id] === 'missing').map((s) => s.name);

  ui.heading('Ready');
  if (skipped.length === 0 && missing.length === 0) {
    ui.ok('All scanners are set up.');
  } else {
    ui.ok(`\`secaudit scan\` will run: ${willRun.join(', ')}`);
    if (skipped.length) ui.skip(`Skipped: ${skipped.join(', ')} ${ui.color.dim('(run `secaudit init` again to retry)')}`);
    if (missing.length) ui.warn(`Missing: ${missing.join(', ')} ${ui.color.dim('(run `secaudit doctor` for details)')}`);
  }
  console.log(`\n  Next: run ${ui.color.cyan('secaudit scan')} to take your first baseline.\n`);
}

async function init(cwd) {
  try {
    console.log(ui.color.bold('\nsecaudit init'));

    ui.heading('Project');
    ensureDir(toolDir(cwd, TOOLS.NPM_AUDIT));
    ensureDir(toolDir(cwd, TOOLS.RETIRE));
    ensureDir(toolDir(cwd, TOOLS.CVE_AUDIT));
    ensureDir(comparisonsDir(cwd));
    ui.ok(`audits/ folder ready ${ui.color.dim(`(${auditsDir(cwd)})`)}`);

    ui.heading('Environment');
    const ctx = checkEnvironment();

    ui.heading('Scanners');
    if (ctx.npmVersion) ui.ok(`${ui.col('npm audit')}${ui.color.dim('built into npm')}`);
    else ui.fail(`${ui.col('npm audit')}unavailable — npm not found`);
    const statuses = {};
    for (const scanner of SCANNERS) {
      statuses[scanner.id] = await setupScanner(cwd, scanner, ctx);
    }

    ui.heading('Git');
    const addToGitignore = await confirm(ask('Add audits/ to .gitignore? (raw scan data can be large and project-specific)'), true);
    if (addToGitignore) {
      await addAuditsToGitignore(cwd);
    } else {
      ui.skip('Leaving .gitignore untouched — audit history will be tracked in git.');
    }

    printReady(statuses);
  } finally {
    closePrompts();
  }
}

module.exports = init;
