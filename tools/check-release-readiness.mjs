import fs from "node:fs/promises";
import path from "node:path";
import { ROOT, loadBaselines, loadRegulatoryData } from "./load-regulatory-data.mjs";

const reportOnly = process.argv.includes("--report-only");
const blockers = [];
const warnings = [];

const [baselines, data, releaseConfig, appGradle] = await Promise.all([
  loadBaselines(),
  loadRegulatoryData(),
  fs.readFile(path.join(ROOT, "config", "release-readiness.json"), "utf8").then(JSON.parse),
  fs.readFile(path.join(ROOT, "app", "build.gradle"), "utf8")
]);

function block(message) { blockers.push(message); }
function warn(message) { warnings.push(message); }

if (releaseConfig.schemaVersion !== 1) block("Unsupported release-readiness schema.");
if (!releaseConfig.applicationIdConfirmed) {
  block("Permanent applicationId has not been explicitly confirmed by the owner.");
}
if (!appGradle.includes(`applicationId "${releaseConfig.applicationId}"`)) {
  block(`Configured applicationId does not match app/build.gradle: ${releaseConfig.applicationId}`);
}
if (!/compileSdk\s+36\b/.test(appGradle) || !/targetSdk\s+36\b/.test(appGradle)) {
  block("Android compileSdk/targetSdk must both be API 36.");
}

const versionMatch = appGradle.match(/versionName\s+"([^"]+)"/);
if (!versionMatch) {
  block("versionName is missing from app/build.gradle.");
} else if (!new RegExp(releaseConfig.productionVersionPattern).test(versionMatch[1])) {
  const message = `Current versionName "${versionMatch[1]}" is not a final production version.`;
  if (reportOnly) warn(message);
  else block(message);
}

const unresolved = data.regulations.filter((item) => item.status === "Perlu verifikasi");
if (unresolved.length) {
  block(`Regulatory corpus still has ${unresolved.length} Perlu verifikasi record(s): ${unresolved.map((x) => x.id).join(", ")}`);
}

const missingVerification = data.regulations.filter((item) => !item.integrity?.verifiedOn);
if (missingVerification.length) {
  block(`Regulatory corpus still has ${missingVerification.length} record(s) without a human verification date.`);
}

const baselineEntries = Object.entries(baselines.records || {});
const unapprovedBaselines = baselineEntries.filter(([, value]) => value === null);
if (unapprovedBaselines.length) {
  block(`${unapprovedBaselines.length} of ${baselineEntries.length} regulatory source fingerprint baseline(s) are not human-approved.`);
}

for (const required of [
  "docs/privacy-policy.md",
  "docs/data-safety.md",
  "docs/release-checklist.md",
  "docs/play-store-listing.md",
  "docs/content-rating.md",
  "SECURITY.md"
]) {
  try {
    await fs.access(path.join(ROOT, required));
  } catch {
    block(`Required release document is missing: ${required}`);
  }
}

if (!String(releaseConfig.privacyPolicyUrl || "").startsWith("https://")) {
  block("Privacy policy URL must be public HTTPS.");
}

console.log("NARADA production release readiness");
console.log(`- regulations: ${data.regulations.length}`);
console.log(`- approved baselines: ${baselineEntries.length - unapprovedBaselines.length}/${baselineEntries.length}`);
console.log(`- applicationId confirmed: ${Boolean(releaseConfig.applicationIdConfirmed)}`);
for (const item of warnings) console.warn(`WARNING: ${item}`);
for (const item of blockers) console.error(`BLOCKER: ${item}`);

if (blockers.length) {
  console.error(`Release gate: BLOCKED (${blockers.length} blocker(s)).`);
  if (!reportOnly) process.exit(1);
} else {
  console.log("Release gate: READY.");
}
