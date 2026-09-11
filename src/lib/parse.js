const fs = require('node:fs');

function readJsonFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

const EMPTY_NPM_COUNTS = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };

function parseNpmAudit(json) {
  const ids = new Set();
  const vulnerabilities = (json && json.vulnerabilities) || {};

  for (const [pkgName, vuln] of Object.entries(vulnerabilities)) {
    for (const via of vuln.via || []) {
      if (typeof via === 'string') {
        ids.add(`${pkgName}@via:${via}`);
        continue;
      }
      for (const cwe of via.cwe || []) ids.add(cwe);
      if (via.source !== undefined && via.source !== null) ids.add(`GHSA-or-id:${via.source}`);
      if (via.url) ids.add(via.url);
    }
  }

  const counts =
    json && json.metadata && json.metadata.vulnerabilities
      ? { ...EMPTY_NPM_COUNTS, ...json.metadata.vulnerabilities }
      : { ...EMPTY_NPM_COUNTS };

  return { counts, ids };
}

const EMPTY_RETIRE_COUNTS = { low: 0, medium: 0, high: 0, critical: 0, total: 0 };

function parseRetire(json) {
  const ids = new Set();
  const counts = { ...EMPTY_RETIRE_COUNTS };
  let findingRecords = 0;

  for (const file of (json && json.data) || []) {
    for (const result of file.results || []) {
      for (const vuln of result.vulnerabilities || []) {
        findingRecords += 1;
        if (vuln.severity && counts[vuln.severity] !== undefined) {
          counts[vuln.severity] += 1;
        }
        counts.total += 1;
        const cves = (vuln.identifiers && vuln.identifiers.CVE) || [];
        for (const cve of cves) ids.add(cve);
      }
    }
  }

  return { counts, ids, findingRecords };
}

const EMPTY_CVE_LITE_COUNTS = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0, total: 0 };

function parseCveLite(json) {
  const ids = new Set();
  const counts = { ...EMPTY_CVE_LITE_COUNTS };
  const findings = (json && json.findings) || [];

  for (const finding of findings) {
    const bucket = finding.severity === 'none' ? 'unknown' : finding.severity;
    if (counts[bucket] !== undefined) counts[bucket] += 1;
    counts.total += 1;

    const cves = finding.cves || [];
    if (cves.length > 0) {
      for (const cve of cves) ids.add(cve);
    } else {
      ids.add(`${finding.package}@${finding.version}:${finding.severity}`);
    }
  }

  return { counts, ids };
}

module.exports = { readJsonFile, parseNpmAudit, parseRetire, parseCveLite };
