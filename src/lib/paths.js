const path = require('node:path');
const fs = require('node:fs');

const TOOLS = {
  NPM_AUDIT: 'npm-audit',
  RETIRE: 'retire',
  CVE_AUDIT: 'cve-audit',
};

function auditsDir(cwd) {
  return path.join(cwd, 'audits');
}

function toolDir(cwd, tool) {
  return path.join(auditsDir(cwd), tool);
}

function comparisonsDir(cwd) {
  return path.join(auditsDir(cwd), 'comparisons');
}

// Matches the reference format, e.g. 2026-09-10T04-44-09Z
function formatTimestamp(date) {
  return date.toISOString().replace(/:/g, '-').replace(/\.\d+Z$/, 'Z');
}

function checkpointName(timestamp, label) {
  return `${timestamp}_${label}`;
}

const CHECKPOINT_NAME_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z)_(.+)$/;

function parseCheckpointName(name) {
  const m = CHECKPOINT_NAME_RE.exec(name);
  if (!m) return null;
  return { timestamp: m[1], label: m[2] };
}

function checkpointDir(cwd, tool, timestamp, label) {
  return path.join(toolDir(cwd, tool), checkpointName(timestamp, label));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

module.exports = {
  TOOLS,
  auditsDir,
  toolDir,
  comparisonsDir,
  formatTimestamp,
  checkpointName,
  parseCheckpointName,
  checkpointDir,
  ensureDir,
};
