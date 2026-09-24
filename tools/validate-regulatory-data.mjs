import { daysBetween, isAllowedAuthorityUrl, loadPolicy, loadRegulatoryData, parseIndonesianDate } from "./load-regulatory-data.mjs";

const policy = await loadPolicy();
const { regulations, metadata, alerts, checklists } = await loadRegulatoryData();

const errors = [];
const warnings = [];
const allowedStatuses = new Set(["Berlaku", "Akan berlaku", "Sebagian dicabut", "Perlu verifikasi"]);
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const ids = new Set();
const sources = new Set();

function error(scope, message) {
  errors.push({ scope, message });
}

function warn(scope, message) {
  warnings.push({ scope, message });
}

if (!Array.isArray(regulations) || regulations.length === 0) {
  error("dataset", "REGULATIONS must contain at least one regulation.");
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(regulation.issued) || Number.isNaN(Date.parse(`${regulation.issued}T00:00:00Z`))) {
    error(scope, `issued must be ISO YYYY-MM-DD: ${regulation.issued}`);
  }
  if (!Array.isArray(regulation.topics) || regulation.topics.length === 0) error(scope, "topics must contain at least one entry.");
  if (!isAllowedAuthorityUrl(regulation.source, policy)) error(scope, `Source is not an allowed HTTPS authority URL: ${regulation.source}`);

  try {
    const normalized = new URL(regulation.source).toString().replace(/\/$/, "");
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
  for (const field of ["verifiedAt", "verification", "changeSummary"]) {
    if (typeof record[field] !== "string" || !record[field].trim()) error(scope, `Metadata ${field} is required.`);
  }
  for (const field of ["aliases", "deadlines", "relatedIds"]) {
    if (!Array.isArray(record[field])) error(scope, `Metadata ${field} must be an array.`);
  }

  const verified = parseIndonesianDate(record.verifiedAt);
  if (!verified) {
    error(scope, `verifiedAt is not a supported Indonesian date: ${record.verifiedAt}`);
  } else {
    const age = daysBetween(verified);
    if (age > policy.freshness.staleAfterDays) {
      warn(scope, `Verification is stale (${age} days; threshold ${policy.freshness.staleAfterDays}).`);
    } else if (age > policy.freshness.reviewAfterDays) {
      warn(scope, `Verification review is due (${age} days; review threshold ${policy.freshness.reviewAfterDays}).`);
    }
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(alert.date)) error(scope, `Alert date must be ISO YYYY-MM-DD: ${alert.date}`);
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

console.log(`RegulaBank regulatory integrity: ${regulations.length} regulations, ${alerts.length} alerts, ${checklists.length} checklists.`);
for (const item of warnings) console.warn(`WARNING [${item.scope}] ${item.message}`);
for (const item of errors) console.error(`ERROR [${item.scope}] ${item.message}`);

if (errors.length) {
  console.error(`Validation failed with ${errors.length} error(s) and ${warnings.length} warning(s).`);
  process.exit(1);
}

console.log(`Validation passed with ${warnings.length} warning(s).`);
