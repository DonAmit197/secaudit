const fs = require('node:fs');
const path = require('node:path');
const { auditsDir } = require('../lib/paths');
const { SCANNERS, getVersion } = require('../lib/tools');
const { isSkipped } = require('../lib/config');
const env = require('../lib/env');
const ui = require('../lib/ui');

// Read-only health check. Changes nothing; prints a checklist a teammate
// can paste into a chat when something isn't working.
async function doctor(cwd) {
  const problems = [];
  const problem = (text) => problems.push(text);

  console.log(ui.color.bold('\nsecaudit doctor'));

  ui.heading('Environment');
  const node = env.nodeInfo();
  ui.ok(`${ui.col('Node.js')}${node.version} ${ui.color.dim(`(${node.platform}-${node.arch})`)}`);

  const npmVersion = env.npmVersion();
  if (npmVersion) {
    ui.ok(`${ui.col('npm')}${npmVersion}`);
  } else {
    ui.fail(`${ui.col('npm')}not found`);
    problem('npm is missing — reinstall Node.js from https://nodejs.org.');
  }

  const binDir = npmVersion ? env.npmGlobalBinDir() : null;
  if (binDir && env.isOnPath(binDir)) {
    ui.ok(`${ui.col('PATH')}${ui.color.dim(`includes npm's global folder (${binDir})`)}`);
  } else if (binDir) {
    ui.fail(`${ui.col('PATH')}npm's global folder is missing: ${binDir}`);
    problem(`Add npm's global folder to PATH, then open a new terminal:\n  ${env.pathFixCommand(binDir)}`);
  }

  ui.heading('Network');
  const proxy = env.proxySettings();
  if (env.anyProxy(proxy)) {
    ui.info(`${ui.col('Proxy')}npm: ${proxy.npmHttpsProxy || proxy.npmProxy || 'none'} · env: ${proxy.envHttpsProxy || proxy.envHttpProxy || 'none'}`);
  } else {
    ui.info(`${ui.col('Proxy')}${ui.color.dim('none configured')}`);
  }

  if (npmVersion) {
    const spin = ui.spinner('Checking the npm registry...');
    if (env.registryReachable()) {
      spin.succeed(`${ui.col('npm registry')}${ui.color.dim('reachable')}`);
    } else {
      spin.fail(`${ui.col('npm registry')}not reachable`);
      problem('npm cannot reach its registry, so nothing can be installed. If you are behind a company proxy:\n  npm config set proxy http://<proxy-host>:<port>\n  npm config set https-proxy http://<proxy-host>:<port>');
    }
  }

  const ghSpin = ui.spinner('Checking GitHub downloads...');
  if (await env.githubReachable()) {
    ghSpin.succeed(`${ui.col('GitHub')}${ui.color.dim('reachable (needed for prebuilt native binaries)')}`);
  } else if (env.anyProxy(proxy)) {
    ghSpin.warn(`${ui.col('GitHub')}no direct connection ${ui.color.dim('(normal behind a proxy — npm installs go through the proxy)')}`);
  } else {
    ghSpin.warn(`${ui.col('GitHub')}not reachable`);
    problem('GitHub is not reachable. cve-lite-cli downloads a prebuilt binary (better-sqlite3) from GitHub; without it npm has to compile one, which needs C++ build tools.');
  }

  ui.heading('Scanners');
  if (npmVersion) ui.ok(`${ui.col('npm audit')}${ui.color.dim('built into npm')}`);
  for (const scanner of SCANNERS) {
    const version = getVersion(scanner.bin);
    const label = ui.col(scanner.name);
    const skipped = isSkipped(cwd, scanner.id);
    if (version && skipped) {
      ui.warn(`${label}${version} — installed but skipped for this project ${ui.color.dim('(`secaudit init` re-enables it)')}`);
    } else if (version) {
      ui.ok(`${label}${ui.color.dim(version)}`);
    } else if (skipped) {
      ui.skip(`${label}skipped for this project`);
    } else {
      ui.fail(`${label}not installed`);
      if (scanner.nativeDep) {
        ui.detail(ui.color.dim(`needs ${scanner.nativeDep} (compiled code): GitHub access for a prebuilt copy, or C++ build tools + Python`));
      }
      if (node.major < scanner.minNode) {
        problem(`${scanner.name} needs Node.js ${scanner.minNode}+ (you have ${node.version}). Upgrade Node.js, or skip it with \`secaudit init\`.`);
      } else {
        problem(`${scanner.name} is not installed — run \`secaudit init\` to install it (or skip it).`);
      }
    }
  }

  const logsDir = path.join(auditsDir(cwd), 'logs');
  if (fs.existsSync(logsDir)) {
    const logs = fs.readdirSync(logsDir).filter((f) => f.endsWith('.log'));
    if (logs.length) {
      ui.heading('Install logs');
      for (const log of logs) ui.info(path.relative(cwd, path.join(logsDir, log)));
    }
  }

  ui.heading('Result');
  if (problems.length === 0) {
    ui.ok('Everything looks good.\n');
    return;
  }
  ui.fail(`${problems.length} problem${problems.length === 1 ? '' : 's'} found:`);
  problems.forEach((p, i) => {
    console.log('');
    ui.detail(`${i + 1}. ${p}`);
  });
  console.log('');
  process.exitCode = 1;
}

module.exports = doctor;
