const spawnSync = require('cross-spawn').sync;
const { spawn } = require('node:child_process');

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

function installGlobal(pkg) {
  const result = spawnSync('npm', ['install', '-g', pkg], { stdio: 'inherit' });
  return !result.error && result.status === 0;
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

module.exports = { BIN, INSTALL_PACKAGE, isReachable, run, installGlobal, openInBrowser };
