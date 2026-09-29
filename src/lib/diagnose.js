// Turns the raw output of a failed `npm install -g <pkg>` into a short,
// plain-language explanation plus concrete next steps. Rules are checked
// from the most specific cause to the most generic; the first match wins.

const NETWORK_CODES = ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNABORTED', 'E407', 'EPROXY', 'E403'];
const CERT_CODES = [
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
];

function npmErrorCode(log) {
  const match = /npm (?:error|ERR!) code (\S+)/.exec(log);
  return match ? match[1] : null;
}

// Name of the package whose install script failed, from npm's
// "npm error path .../node_modules/<name>" line.
function failingPackage(log) {
  const match = /npm (?:error|ERR!) path (.+)/.exec(log);
  if (!match) return null;
  const parts = match[1].trim().split(/[\\/]+/);
  const idx = parts.lastIndexOf('node_modules');
  if (idx === -1 || idx === parts.length - 1) return null;
  const name = parts[idx + 1];
  return name.startsWith('@') && parts[idx + 2] ? `${name}/${parts[idx + 2]}` : name;
}

function hasAny(text, needles) {
  return needles.some((n) => text.includes(n));
}

const PROXY_FIXES = [
  'If your company uses a proxy, point npm at it (ask IT for the address):',
  '    npm config set proxy http://<proxy-host>:<port>',
  '    npm config set https-proxy http://<proxy-host>:<port>',
];

const BUILD_TOOLS_FIXES = {
  win32: [
    'Or install the C++ build tools so npm can compile it on this machine:',
    '    winget install Microsoft.VisualStudio.2022.BuildTools --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"',
    '    winget install Python.Python.3.12',
  ],
  darwin: ['Or install the build tools so npm can compile it on this machine:', '    xcode-select --install'],
  linux: ['Or install the build tools so npm can compile it on this machine:', '    sudo apt install build-essential python3   # Debian/Ubuntu'],
};

function isNativeFailure({ text, code }) {
  return /gyp ERR!|node-gyp|prebuild-install/.test(text) && (code === '1' || /gyp ERR!/.test(text));
}

// A native build's own download timing out also prints ETIMEDOUT etc., so a
// text match only counts as a registry problem when no native build failed.
function matchesCodeOrText(ctx, codes) {
  return codes.includes(ctx.code) || (!isNativeFailure(ctx) && hasAny(ctx.text, codes));
}

const RULES = [
  {
    match: ({ text, code }) => code === 'EBADENGINE' || /Unsupported engine/i.test(text),
    explain: ({ scanner }) => ({
      title: `${scanner.name} needs a newer Node.js`,
      why: [`${scanner.name} requires Node.js ${scanner.minNode} or later; this machine runs ${process.version}.`],
      fixes: [`Install Node.js ${scanner.minNode}+ (https://nodejs.org), open a new terminal, then run \`secaudit init\` again.`],
    }),
  },
  {
    match: (ctx) => matchesCodeOrText(ctx, CERT_CODES),
    explain: () => ({
      title: "npm does not trust your network's security certificate",
      why: ['Your network inspects HTTPS traffic with its own certificate (common on company networks), and npm rejects it.'],
      fixes: ['Ask IT for the company root certificate (.pem) and tell npm about it:', '    npm config set cafile <path-to>/company-root.pem'],
    }),
  },
  {
    match: (ctx) => matchesCodeOrText(ctx, NETWORK_CODES) || (!isNativeFailure(ctx) && /407 Proxy Authentication/i.test(ctx.text)),
    explain: () => ({
      title: 'npm could not reach the package registry',
      why: ['The download was blocked or timed out — usually a company proxy/firewall, VPN, or no internet connection.'],
      fixes: [...PROXY_FIXES, 'Then check with `npm ping` and run `secaudit init` again.'],
    }),
  },
  {
    match: isNativeFailure,
    explain: ({ text, scanner, platform }) => {
      const dep = failingPackage(text) || scanner.nativeDep || 'a dependency';
      const downloadBlocked = /prebuild-install (?:warn|WARN)|No prebuilt binaries found|Request timed out|getaddrinfo|ECONNRESET|\b403\b/.test(text);
      const noBuildTools = /Could not find any Visual Studio|find VS|Could not find any Python|find Python|not found: make/.test(text);
      return {
        title: `${scanner.name} could not build its native part (${dep})`,
        why: [
          `${scanner.name} depends on ${dep}, which contains compiled code. npm tried two ways to get it:`,
          `  1. Download a ready-made binary from GitHub — failed${downloadBlocked ? ' (the download was blocked or timed out)' : ''}.`,
          `  2. Compile it on this machine — failed${noBuildTools ? ' (C++ build tools / Python are not installed)' : ''}.`,
          'On company networks this usually means GitHub downloads are blocked by a proxy.',
        ],
        fixes: [...PROXY_FIXES, ...(BUILD_TOOLS_FIXES[platform] || BUILD_TOOLS_FIXES.linux)],
      };
    },
  },
  {
    match: ({ code }) => code === 'EACCES',
    explain: ({ platform }) => ({
      title: 'No permission to install global packages',
      why: ['npm tried to write to a system folder that your user account cannot change.'],
      fixes: [
        platform === 'win32'
          ? 'Run the terminal as Administrator, or ask IT to allow global npm installs.'
          : 'Use a Node version manager (nvm, fnm) so global installs go to your home folder — avoid `sudo npm`.',
      ],
    }),
  },
  {
    match: ({ code }) => ['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(code),
    explain: () => ({
      title: 'A file npm needed was locked',
      why: ['Another program (a terminal, VS Code, or antivirus scanning new files) had a file open, so npm could not replace it.'],
      fixes: ['Close other terminals and editors, wait a minute for antivirus to finish, then run `secaudit init` again.'],
    }),
  },
  {
    match: ({ code }) => code === 'ENOSPC',
    explain: () => ({
      title: 'The disk is full',
      why: ['npm ran out of disk space while installing.'],
      fixes: ['Free up some disk space, then run `secaudit init` again.'],
    }),
  },
  {
    match: ({ code }) => code === 'E404',
    explain: ({ scanner }) => ({
      title: `${scanner.pkg} was not found on the npm registry`,
      why: ['Your npm registry setting may point to a company mirror that does not carry this package.'],
      fixes: ['Check `npm config get registry` and ask whoever runs that mirror to add it.'],
    }),
  },
];

function fallback({ code, scanner }) {
  return {
    title: `${scanner.name} could not be installed`,
    why: [code ? `npm stopped with error code ${code}.` : 'npm stopped with an error secaudit does not recognise.'],
    fixes: [`Try it by hand to see npm's full message:  npm install -g ${scanner.pkg}`],
  };
}

// A failed native build usually leaves a half-installed folder that Windows
// can't delete while something holds it open (npm's EPERM "cleanup"
// warnings). Clearing it avoids a confusing second failure on retry.
function leftoverFolderFixes({ text, code, scanner, platform, globalModulesDir }) {
  if (!/EPERM|EBUSY/.test(text) || code === 'EPERM' || code === 'EBUSY') return [];
  const fixes = ['npm also left a half-installed folder behind (a file was locked). Before retrying, close other terminals/editors and delete it:'];
  if (globalModulesDir) {
    const sep = platform === 'win32' ? '\\' : '/';
    const leftover = `${globalModulesDir}${sep}${scanner.pkg}`;
    fixes.push(platform === 'win32' ? `    Remove-Item -Recurse -Force "${leftover}"` : `    rm -rf "${leftover}"`);
  }
  return fixes;
}

function diagnoseInstall(log, scanner, { platform = process.platform, globalModulesDir = null } = {}) {
  const text = String(log || '');
  const ctx = { text, code: npmErrorCode(text), scanner, platform, globalModulesDir };
  const rule = RULES.find((r) => r.match(ctx));
  const result = rule ? rule.explain(ctx) : fallback(ctx);
  result.fixes = [...result.fixes, ...leftoverFolderFixes(ctx)];
  return result;
}

module.exports = { diagnoseInstall, npmErrorCode, failingPackage };
