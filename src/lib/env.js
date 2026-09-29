const path = require('node:path');
const https = require('node:https');
const spawnSync = require('cross-spawn').sync;

// Facts about the machine that explain most install failures. Everything
// here is read-only and safe to run from both `init` and `doctor`.

function nodeInfo() {
  return {
    version: process.version,
    major: Number(process.versions.node.split('.')[0]),
    arch: process.arch,
    platform: process.platform,
  };
}

function npmOutput(args, timeout = 20000) {
  const result = spawnSync('npm', args, { encoding: 'utf8', timeout });
  if (result.error || result.status !== 0) return null;
  return (result.stdout || '').trim();
}

function npmVersion() {
  return npmOutput(['--version']);
}

// Where `npm install -g` puts command shims: the prefix itself on Windows,
// <prefix>/bin elsewhere.
function npmGlobalBinDir() {
  const prefix = npmOutput(['prefix', '-g']);
  if (!prefix) return null;
  return process.platform === 'win32' ? prefix : path.join(prefix, 'bin');
}

function npmGlobalModulesDir() {
  return npmOutput(['root', '-g']);
}

function normalizeDir(dir) {
  const resolved = path.resolve(dir).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isOnPath(dir) {
  if (!dir) return false;
  const target = normalizeDir(dir);
  const entries = (process.env.PATH || process.env.Path || '').split(path.delimiter).filter(Boolean);
  return entries.some((entry) => normalizeDir(entry.replace(/^"|"$/g, '')) === target);
}

function pathFixCommand(dir) {
  if (process.platform === 'win32') {
    return `[Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path", "User") + ";${dir}", "User")`;
  }
  return `echo 'export PATH="${dir}:$PATH"' >> ~/.bashrc   # or ~/.zshrc`;
}

function envVar(name) {
  return process.env[name] || process.env[name.toLowerCase()] || null;
}

function proxySettings() {
  const fromNpm = (key) => {
    const value = npmOutput(['config', 'get', key]);
    return value && value !== 'null' && value !== 'undefined' ? value : null;
  };
  return {
    npmProxy: fromNpm('proxy'),
    npmHttpsProxy: fromNpm('https-proxy'),
    envHttpsProxy: envVar('HTTPS_PROXY'),
    envHttpProxy: envVar('HTTP_PROXY'),
  };
}

function anyProxy(proxy) {
  return Boolean(proxy.npmProxy || proxy.npmHttpsProxy || proxy.envHttpsProxy || proxy.envHttpProxy);
}

// Uses npm's own network settings (proxy, CA certs), so it answers exactly
// "can npm install packages from here?".
function registryReachable() {
  const result = spawnSync('npm', ['ping'], { encoding: 'utf8', timeout: 20000 });
  return !result.error && result.status === 0;
}

// Native modules such as better-sqlite3 download their prebuilt binary from
// GitHub releases, not from the npm registry — a network can allow one and
// block the other. This is a direct connection (no proxy), so with a proxy
// configured a failure here is a hint, not proof.
function githubReachable(timeout = 8000) {
  return new Promise((resolve) => {
    const req = https.request('https://github.com', { method: 'HEAD', timeout }, (res) => {
      res.resume();
      resolve(res.statusCode < 500);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve(false));
    req.end();
  });
}

module.exports = {
  nodeInfo,
  npmVersion,
  npmGlobalBinDir,
  npmGlobalModulesDir,
  isOnPath,
  pathFixCommand,
  proxySettings,
  anyProxy,
  registryReachable,
  githubReachable,
};
