const fs = require('node:fs');
const path = require('node:path');
const { TOOLS, toolDir, parseCheckpointName } = require('./paths');

// A checkpoint is one scan run: a (timestamp, label) pair that may have
// produced a folder under one, two, or all three tool directories.
function listCheckpoints(cwd) {
  const byKey = new Map();

  for (const tool of Object.values(TOOLS)) {
    const dir = toolDir(cwd, tool);
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const parsed = parseCheckpointName(entry.name);
      if (!parsed) continue;
      const key = `${parsed.timestamp}_${parsed.label}`;
      if (!byKey.has(key)) {
        byKey.set(key, { timestamp: parsed.timestamp, label: parsed.label, dirs: {} });
      }
      byKey.get(key).dirs[tool] = path.join(dir, entry.name);
    }
  }

  return [...byKey.values()].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
}

function labelExists(cwd, label) {
  return listCheckpoints(cwd).some((cp) => cp.label === label);
}

function findByLabel(cwd, label, beforeTimestamp) {
  let matches = listCheckpoints(cwd).filter((cp) => cp.label === label);
  if (beforeTimestamp) {
    matches = matches.filter((cp) => cp.timestamp <= beforeTimestamp);
  }
  return matches[0] || null; // already sorted most-recent-first
}

function mostRecentTwo(cwd) {
  return listCheckpoints(cwd).slice(0, 2);
}

function allLabels(cwd) {
  const seen = new Set();
  const labels = [];
  for (const cp of listCheckpoints(cwd)) {
    if (!seen.has(cp.label)) {
      seen.add(cp.label);
      labels.push(cp.label);
    }
  }
  return labels;
}

module.exports = { listCheckpoints, labelExists, findByLabel, mostRecentTwo, allLabels };
