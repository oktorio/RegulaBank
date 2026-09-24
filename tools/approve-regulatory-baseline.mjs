import fs from "node:fs/promises";
import path from "node:path";
import { isAllowedAuthorityUrl, loadBaselines, loadPolicy, loadRegulatoryData, normalizeUrl, ROOT } from "./load-regulatory-data.mjs";

const args = process.argv.slice(2);
function arg(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

const reportArg = arg("--report");
const idsArg = arg("--ids");
const approvedBy = arg("--approved-by");

if (!reportArg || !idsArg || !approvedBy) {
  console.error("Usage: node tools/approve-regulatory-baseline.mjs --report <monitor.json> --ids <id1,id2> --approved-by <name>");
  process.exit(2);
}

const selectedIds = [...new Set(idsArg.split(",").map((value) => value.trim()).filter(Boolean))];
if (!selectedIds.length) {
  console.error("At least one explicit regulation id is required.");
  process.exit(2);
}
if (selectedIds.includes("all") || selectedIds.includes("*")) {
  console.error("Bulk wildcard approval is intentionally disabled. List regulation ids explicitly.");
  process.exit(2);
}

const policy = await loadPolicy();
const baselines = await loadBaselines();
const { regulations } = await loadRegulatoryData();
const reportPath = path.resolve(ROOT, reportArg);
const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
if (report.schemaVersion !== 3) {
  console.error("Evidence report schemaVersion 3 is required for baseline approval.");
  process.exit(1);
}

const generatedAt = new Date(report.generatedAt || "");
if (Number.isNaN(generatedAt.getTime())) {
  console.error("Evidence report has an invalid generatedAt timestamp.");
  process.exit(1);
}
const evidenceAgeMs = Date.now() - generatedAt.getTime();
const maxAgeDays = policy.baseline?.maxEvidenceAgeDays ?? 7;
if (evidenceAgeMs < 0 || evidenceAgeMs > maxAgeDays * 86400000) {
  console.error(`Evidence report is outside the approval window of ${maxAgeDays} days.`);
  process.exit(1);
}

const regulationMap = new Map(regulations.map((item) => [item.id, item]));
const checkMap = new Map((report.sourceChecks || []).map((item) => [item.id, item]));
const approvedAt = new Date().toISOString();

for (const id of selectedIds) {
  const regulation = regulationMap.get(id);
  const check = checkMap.get(id);
  if (!regulation) throw new Error(`Unknown regulation id: ${id}`);
  if (!check || !check.ok) throw new Error(`No successful monitoring evidence for: ${id}`);
  if (!/^[a-f0-9]{64}$/.test(String(check.contentFingerprint || ""))) {
    throw new Error(`Invalid SHA-256 content fingerprint for: ${id}`);
  }
  if (check.fingerprintMethod !== "visible-text-sha256-v1") {
    throw new Error(`Unsupported fingerprint method for: ${id}`);
  }
  if (!isAllowedAuthorityUrl(check.finalUrl || "", policy)) {
    throw new Error(`Monitoring evidence ended outside the allowed OJK authority for: ${id}`);
  }
  if (normalizeUrl(check.source) !== normalizeUrl(regulation.source)) {
    throw new Error(`Evidence source does not match curated source for: ${id}`);
  }

  baselines.records[id] = {
    sourceUrl: regulation.source,
    fingerprint: check.contentFingerprint,
    fingerprintMethod: check.fingerprintMethod,
    approvedAt,
    approvedBy,
    evidenceGeneratedAt: report.generatedAt
  };
}

await fs.writeFile(
  path.join(ROOT, "config", "regulatory-baselines.json"),
  `${JSON.stringify(baselines, null, 2)}\n`,
  "utf8"
);

console.log(`Approved ${selectedIds.length} regulatory fingerprint baseline(s): ${selectedIds.join(", ")}`);
console.log("Review the resulting config/regulatory-baselines.json diff before committing.");
