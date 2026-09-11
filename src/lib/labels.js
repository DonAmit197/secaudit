const path = require('node:path');
const fs = require('node:fs');

function readProjectVersion(cwd) {
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    throw new Error(
      `No package.json found in ${cwd}. secaudit needs a package.json to read the project version ` +
        `(or pass --label explicitly).`
    );
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (!pkg.version) {
    throw new Error(
      `package.json has no "version" field. Pass --label explicitly, e.g. --label baseline.`
    );
  }
  return pkg.version;
}

function deriveLabel(cwd, explicitLabel) {
  if (explicitLabel) return explicitLabel;
  const version = readProjectVersion(cwd);
  return `release-${version}`;
}

module.exports = { readProjectVersion, deriveLabel };
