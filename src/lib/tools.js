const fs = require('node:fs');
const path = require('node:path');
const crossSpawn = require('cross-spawn');
const { spawn } = require('node:child_process');

const spawnSync = crossSpawn.sync;

// Binary names actually invoked on the command line.
const BIN = {
  npm: 'npm',
  retire: 'retire',
  cveLite: 'cve-lite', // the cve-lite-cli package's executable is named "cve-lite"
  auditExport: 'audit-export',
};

// npm package names to suggest/run for `npm install -g <pkg>` when a tool is missing.
// npm itself ships with Node and is never offered for install here.
const INSTALL_PACKAGE = {
  retire: 'retire',
  cveLite: 'cve-lite-cli',
  auditExport: 'audit-export',
};

const MAX_BUFFER = 100 * 1024 * 1024;

function isReachable(bin) {
  const result = spawnSync(bin, ['--version'], { encoding: 'utf8' });
  return !result.error;
}

function run(bin, args, { cwd, input } = {}) {
  return spawnSync(bin, args, {
    encoding: 'utf8',
    cwd,
    input,
    maxBuffer: MAX_BUFFER,
  });
}

// The globally installable tools secaudit relies on. npm itself ships with
// Node and is never installed here. minNode mirrors each package's own
// "engines" field; nativeDep names a compiled dependency that can fail to
// install on locked-down machines (no prebuilt download, no build tools).
const SCANNERS = [
  { id: 'retire', name: 'retire.js', bin: BIN.retire, pkg: INSTALL_PACKAGE.retire, minNode: 18 },
  { id: 'cveLite', name: 'cve-lite-cli', bin: BIN.cveLite, pkg: INSTALL_PACKAGE.cveLite, minNode: 20, nativeDep: 'better-sqlite3' },
  {
    id: 'auditExport',
    name: 'audit-export',
    bin: BIN.auditExport,
    pkg: INSTALL_PACKAGE.auditExport,
    minNode: 10,
    purpose: 'HTML report for npm audit',
  },
];

function scannerById(id) {
  return SCANNERS.find((s) => s.id === id);
}

// First x.y.z in the tool's --version output (cve-lite prints a banner around it).
function getVersion(bin) {
  const result = spawnSync(bin, ['--version'], { encoding: 'utf8' });
  if (result.error) return null;
  const match = /\d{1,6}\.\d{1,6}\.\d{1,6}/.exec(`${result.stdout || ''}\n${result.stderr || ''}`);
  return match ? match[0] : 'unknown version';
}

// Runs `npm install -g <pkg>` with its output captured instead of streamed,
// so a failure can be explained in plain language rather than dumping npm's
// raw log on the user. The full output is kept in logPath for support.
function installGlobal(pkg, logPath) {
  const args = ['install', '-g', pkg, '--foreground-scripts', '--no-fund', '--no-audit', '--color=false'];
  return new Promise((resolve) => {
    let output = '';
    const finish = (ok, extra = '') => {
      output += extra;
      let savedLog = null;
      if (logPath) {
        try {
          fs.mkdirSync(path.dirname(logPath), { recursive: true });
          fs.writeFileSync(logPath, `$ npm ${args.join(' ')}\n\n${output}`);
          savedLog = logPath;
        } catch {
          // the diagnosis still works from the in-memory output
        }
      }
      resolve({ ok, output, logPath: savedLog });
    };

    let child;
    try {
      child = crossSpawn('npm', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      finish(false, err.message);
      return;
    }
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('error', (err) => finish(false, `\n${err.message}`));
    child.on('close', (code) => finish(code === 0));
  });
}

// audit-export's own --open flag is broken on Windows (it runs `start "<path>"`,
// which cmd.exe treats as a window title, not a target, so nothing opens) — so
// secaudit opens generated HTML reports itself instead of relying on that flag.
function openInBrowser(filePath) {
  let cmd = 'xdg-open';
  if (process.platform === 'darwin') cmd = 'open';
  else if (process.platform === 'win32') cmd = 'cmd';
  const args = process.platform === 'win32' ? ['/c', 'start', '', filePath] : [filePath];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true, shell: false });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

module.exports = { BIN, INSTALL_PACKAGE, SCANNERS, scannerById, isReachable, getVersion, run, installGlobal, openInBrowser };
