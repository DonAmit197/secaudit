const fs = require('node:fs');
const path = require('node:path');
const { auditsDir, ensureDir } = require('./paths');

// Per-project settings. Lives inside audits/ on purpose: a skipped scanner
// is usually a machine problem (proxy, missing build tools), and audits/ is
// normally gitignored, so one person's skip doesn't silently apply to the team.
function configPath(cwd) {
  return path.join(auditsDir(cwd), 'secaudit.config.json');
}

function readConfig(cwd) {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath(cwd), 'utf8'));
    return { skip: Array.isArray(parsed.skip) ? parsed.skip : [] };
  } catch {
    return { skip: [] };
  }
}

function writeConfig(cwd, config) {
  ensureDir(auditsDir(cwd));
  fs.writeFileSync(configPath(cwd), `${JSON.stringify(config, null, 2)}\n`);
}

function isSkipped(cwd, toolId) {
  return readConfig(cwd).skip.includes(toolId);
}

function setSkipped(cwd, toolId, skipped) {
  const config = readConfig(cwd);
  const without = config.skip.filter((id) => id !== toolId);
  config.skip = skipped ? [...without, toolId] : without;
  writeConfig(cwd, config);
}

module.exports = { configPath, readConfig, isSkipped, setSkipped };
