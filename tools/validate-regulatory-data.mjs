import {
  daysBetween,
  isAllowedAuthorityUrl,
  loadBaselines,
  loadPolicy,
  loadRegulatoryData,
  normalizeUrl,
  parseIndonesianDate
} from "./load-regulatory-data.mjs";

const policy = await loadPolicy();
const baselines = await loadBaselines();
const { regulations, metadata, alerts, checklists, freshnessPolicy } = await loadRegulatoryData();

const errors = [];
const warnings = [];
const allowedStatuses = new Set(["Berlaku", "Akan berlaku", "Sebagian dicabut", "Perlu verifikasi"]);
const allowedFreshnessStates = new Set(["current", "review", "stale", "unknown"]);
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const ids = new Set();
const sources = new Set();

function error(scope, message) {
  errors.push({ scope, message });
}

function warn(scope, message) {
  warnings.push({ scope, message });
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isoFromDate(date) {
  return date ? date.toISOString().slice(0, 10) : "";
}

if (!Array.isArray(regulations) || regulations.length === 0) {
  error("dataset", "REGULATIONS must contain at least one regulation.");
}

if (!freshnessPolicy ||
    freshnessPolicy.reviewAfterDays !== policy.freshness.reviewAfterDays ||
    freshnessPolicy.staleAfterDays !== policy.freshness.staleAfterDays) {
  error("freshness-policy", "Runtime freshness thresholds must match config/regulatory-integrity.json.");
}

for (const regulation of regulations) {
  const scope = regulation.id || "unknown";
  if (!idPattern.test(String(regulation.id || ""))) error(scope, "Invalid regulation id format.");
  if (ids.has(regulation.id)) error(scope, "Duplicate regulation id.");
  ids.add(regulation.id);

  for (const field of ["number", "type", "title", "category", "status", "issued", "effective", "summary", "content", "source"]) {
    if (typeof regulation[field] !== "string" || !regulation[field].trim()) error(scope, `Missing or invalid ${field}.`);
  }

  if (!allowedStatuses.has(regulation.status)) error(scope, `Unsupported status: ${regulation.status}`);
  if (!isIsoDate(regulation.issued)) error(scope, `issued must be a real ISO YYYY-MM-DD date: ${regulation.issued}`);
  if (!Array.isArray(regulation.topics) || regulation.topics.length === 0) error(scope, "topics must contain at least one entry.");
  if (!isAllowedAuthorityUrl(regulation.source, policy)) error(scope, `Source is not an allowed HTTPS authority URL: ${regulation.source}`);

  try {
    const normalized = normalizeUrl(regulation.source);
    if (sources.has(normalized)) warn(scope, "Source URL is shared by more than one record.");
    sources.add(normalized);
  } catch {
    // Already reported by authority URL validation.
  }

  const record = metadata[regulation.id];
  if (!record) {
    error(scope, "Missing V1_REGULATION_METADATA entry.");
    continue;
  }
  for (const field of ["verifiedOn", "verifiedAt", "verification", "changeSummary"]) {
    if (typeof record[field] !== "string" || !record[field].trim()) error(scope, `Metadata ${field} is required.`);
  }
  for (const field of ["aliases", "deadlines", "relatedIds"]) {
    if (!Array.isArray(record[field])) error(scope, `Metadata ${field} must be an array.`);
  }

  if (!isIsoDate(record.verifiedOn)) {
    error(scope, `verifiedOn must be a real ISO YYYY-MM-DD date: ${record.verifiedOn}`);
  }

  const displayVerified = parseIndonesianDate(record.verifiedAt);
  if (!displayVerified) {
    error(scope, `verifiedAt is not a supported Indonesian date: ${record.verifiedAt}`);
  } else {
    if (isIsoDate(record.verifiedOn) && isoFromDate(displayVerified) !== record.verifiedOn) {
      error(scope, `verifiedOn (${record.verifiedOn}) does not match verifiedAt (${record.verifiedAt}).`);
    }
    const canonicalVerified = isIsoDate(record.verifiedOn)
      ? new Date(`${record.verifiedOn}T00:00:00Z`)
      : displayVerified;
    const age = daysBetween(canonicalVerified);
    if (age > policy.freshness.staleAfterDays) {
      warn(scope, `Verification is stale (${age} days; threshold ${policy.freshness.staleAfterDays}).`);
    } else if (age > policy.freshness.reviewAfterDays) {
      warn(scope, `Verification review is due (${age} days; review threshold ${policy.freshness.reviewAfterDays}).`);
    }
  }

  const integrity = regulation.integrity;
  if (!integrity || typeof integrity !== "object") {
    error(scope, "Runtime integrity/provenance metadata is missing.");
  } else {
    if (!allowedFreshnessStates.has(integrity.state)) error(scope, `Unsupported freshness state: ${integrity.state}`);
    if (integrity.authority !== policy.authority) error(scope, `Integrity authority must be ${policy.authority}.`);
    if (integrity.sourceUrl !== regulation.source) error(scope, "Integrity sourceUrl must match the regulation source.");
    if (integrity.verificationMethod !== "human-curated") error(scope, "verificationMethod must preserve the human-curated boundary.");
    if (integrity.verifiedOn !== record.verifiedOn) error(scope, "Runtime integrity.verifiedOn must match metadata verifiedOn.");
  }
}

for (const regulation of regulations) {
  const record = metadata[regulation.id];
  if (!record || !Array.isArray(record.relatedIds)) continue;
  for (const relatedId of record.relatedIds) {
    if (relatedId === regulation.id) error(regulation.id, "relatedIds must not reference itself.");
    if (!ids.has(relatedId)) error(regulation.id, `relatedIds references unknown regulation: ${relatedId}`);
  }
}

for (const alert of alerts) {
  const scope = `alert:${alert.id || "unknown"}`;
  if (!alert.id || !alert.regulationId || !alert.level || !alert.date || !alert.title || !alert.message) {
    error(scope, "Alert is missing a required field.");
    continue;
  }
  if (!ids.has(alert.regulationId)) error(scope, `Unknown regulationId: ${alert.regulationId}`);
  if (!isIsoDate(alert.date)) error(scope, `Alert date must be a real ISO YYYY-MM-DD date: ${alert.date}`);
}

for (const checklist of checklists) {
  const scope = `checklist:${checklist.id || "unknown"}`;
  if (!checklist.id || !checklist.title || !checklist.regulationId || !Array.isArray(checklist.items)) {
    error(scope, "Checklist is missing required fields.");
    continue;
  }
  if (!ids.has(checklist.regulationId)) error(scope, `Unknown regulationId: ${checklist.regulationId}`);
  const itemIds = new Set();
  for (const item of checklist.items) {
    if (!item.id || !item.group || !item.title) error(scope, "Checklist item is missing id/group/title.");
    if (itemIds.has(item.id)) error(scope, `Duplicate checklist item id: ${item.id}`);
    itemIds.add(item.id);
  }
}

if (baselines.schemaVersion !== 1 || baselines.authority !== policy.authority || typeof baselines.records !== "object" || !baselines.records) {
  error("baselines", "Invalid regulatory fingerprint baseline registry.");
} else {
  for (const id of ids) {
    if (!Object.prototype.hasOwnProperty.call(baselines.records, id)) {
      error(`baseline:${id}`, "Baseline registry is missing this regulation id.");
      continue;
    }
    const baseline = baselines.records[id];
    if (baseline === null) {
      warn(`baseline:${id}`, "No human-approved source fingerprint baseline yet.");
      continue;
    }
    if (typeof baseline !== "object") {
      error(`baseline:${id}`, "Baseline must be null or an object.");
      continue;
    }
    const regulation = regulations.find((item) => item.id === id);
    if (!sha256Pattern.test(String(baseline.fingerprint || ""))) error(`baseline:${id}`, "Baseline fingerprint must be lowercase SHA-256.");
    if (baseline.fingerprintMethod !== "visible-text-sha256-v1") error(`baseline:${id}`, "Unsupported baseline fingerprintMethod.");
    if (!baseline.approvedBy || typeof baseline.approvedBy !== "string") error(`baseline:${id}`, "approvedBy is required.");
    for (const field of ["approvedAt", "evidenceGeneratedAt"]) {
      if (!baseline[field] || Number.isNaN(Date.parse(baseline[field]))) error(`baseline:${id}`, `${field} must be an ISO timestamp.`);
    }
    if (!isAllowedAuthorityUrl(baseline.sourceUrl, policy)) error(`baseline:${id}`, "Baseline sourceUrl is outside the allowed OJK authority.");
    if (regulation && normalizeUrl(baseline.sourceUrl) !== normalizeUrl(regulation.source)) {
      error(`baseline:${id}`, "Baseline sourceUrl does not match the curated regulation source.");
    }
  }

  for (const id of Object.keys(baselines.records)) {
    if (!ids.has(id)) error(`baseline:${id}`, "Baseline registry references an unknown regulation id.");
  }
}

console.log(`RegulaBank regulatory integrity: ${regulations.length} regulations, ${alerts.length} alerts, ${checklists.length} checklists.`);
for (const item of warnings) console.warn(`WARNING [${item.scope}] ${item.message}`);
for (const item of errors) console.error(`ERROR [${item.scope}] ${item.message}`);

if (errors.length) {
  console.error(`Validation failed with ${errors.length} error(s) and ${warnings.length} warning(s).`);
  process.exit(1);
}

console.log(`Validation passed with ${warnings.length} warning(s).`);
