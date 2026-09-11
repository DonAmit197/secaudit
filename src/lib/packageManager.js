const fs = require('node:fs');
const path = require('node:path');

// npm audit requires an npm-format lockfile (ENOLOCK otherwise) — this lets
// scan.js detect that up front instead of letting npm audit fail and
// mistaking its error JSON for a real (empty) result.
const LOCKFILES = [
  { manager: 'npm', file: 'package-lock.json' },
  { manager: 'npm', file: 'npm-shrinkwrap.json' },
  { manager: 'pnpm', file: 'pnpm-lock.yaml' },
  { manager: 'yarn', file: 'yarn.lock' },
  { manager: 'bun', file: 'bun.lock' },
  { manager: 'bun', file: 'bun.lockb' },
];

function detectLockfile(cwd) {
  for (const entry of LOCKFILES) {
    if (fs.existsSync(path.join(cwd, entry.file))) return entry;
  }
  return null;
}

module.exports = { detectLockfile };
