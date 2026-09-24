import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { loadPolicy, loadRegulatoryData, parseIndonesianDate, normalizeUrl, isAllowedAuthorityUrl, ROOT } from "./load-regulatory-data.mjs";

const args = process.argv.slice(2);
const outputArg = args.indexOf("--output");
const summaryArg = args.indexOf("--summary");
const outputPath = outputArg >= 0 && args[outputArg + 1] ? path.resolve(ROOT, args[outputArg + 1]) : null;
const summaryPath = summaryArg >= 0 && args[summaryArg + 1] ? args[summaryArg + 1] : null;

const policy = await loadPolicy();
const { regulations, metadata } = await loadRegulatoryData();

function decodeEntities(value) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function plainText(value) {
  return decodeEntities(value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim());
}

function fingerprint(value) {
  const normalized = value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return crypto.createHash("sha256").update(normalized, "utf8").digest("hex");
}

async function fetchLimited(urlValue) {
  let current = urlValue;
  for (let redirect = 0; redirect <= policy.network.maxRedirects; redirect++) {
    if (!isAllowedAuthorityUrl(current, policy)) throw new Error(`Blocked non-authority URL: ${current}`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), policy.network.readTimeoutMs);
    let response;
    try {
      response = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": "RegulaBank-Regulatory-Monitor/1.2",
          "accept": "text/html,application/xhtml+xml,application/pdf;q=0.8,*/*;q=0.5"
        }
      });
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`Redirect ${response.status} without Location from ${current}`);
      current = new URL(location, current).toString();
      continue;
    }

    const contentLength = Number(response.headers.get("content-length") || "0");
    if (contentLength > policy.network.maxResponseBytes) throw new Error(`Response too large (${contentLength} bytes)`);

    const reader = response.body?.getReader();
    const chunks = [];
    let total = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > policy.network.maxResponseBytes) {
          await reader.cancel();
          throw new Error(`Response exceeded ${policy.network.maxResponseBytes} bytes`);
        }
        chunks.push(value);
      }
    }
    const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    return {
      status: response.status,
      ok: response.ok,
      finalUrl: current,
      headers: Object.fromEntries(response.headers.entries()),
      body: buffer.toString("utf8")
    };
  }
  throw new Error(`Too many redirects for ${urlValue}`);
}

const checkedAt = new Date();
const sourceChecks = [];
for (const regulation of regulations) {
  const result = {
    id: regulation.id,
    type: regulation.type,
    number: regulation.number,
    title: regulation.title,
    source: regulation.source,
    verifiedAt: metadata[regulation.id]?.verifiedAt || null,
    ok: false
  };
  try {
    const response = await fetchLimited(regulation.source);
    result.ok = response.ok;
    result.httpStatus = response.status;
    result.finalUrl = response.finalUrl;
    result.etag = response.headers.etag || null;
    result.lastModified = response.headers["last-modified"] || null;
    result.contentFingerprint = fingerprint(response.body);
    result.contentBytes = Buffer.byteLength(response.body, "utf8");

    const verified = parseIndonesianDate(result.verifiedAt);
    const lastModified = result.lastModified ? new Date(result.lastModified) : null;
    result.serverModifiedAfterVerification = Boolean(
      verified && lastModified && !Number.isNaN(lastModified.getTime()) && lastModified.getTime() > verified.getTime() + 24 * 60 * 60 * 1000
    );
    if (!response.ok) result.error = `HTTP ${response.status}`;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }
  sourceChecks.push(result);
}

let hubCheck = { ok: false, url: policy.regulatoryHubUrl, candidates: [] };
try {
  const response = await fetchLimited(policy.regulatoryHubUrl);
  hubCheck.ok = response.ok;
  hubCheck.httpStatus = response.status;
  hubCheck.finalUrl = response.finalUrl;
  hubCheck.contentFingerprint = fingerprint(response.body);

  const knownSources = new Set(regulations.map((item) => normalizeUrl(item.source)));
  const candidates = new Map();
  const anchorPattern = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorPattern.exec(response.body)) !== null) {
    let resolved;
    try {
      resolved = new URL(decodeEntities(match[1]), response.finalUrl);
    } catch {
      continue;
    }
    if (!isAllowedAuthorityUrl(resolved.toString(), policy)) continue;
    if (!resolved.pathname.toLowerCase().includes("/regulasi/")) continue;
    if (!resolved.pathname.toLowerCase().endsWith(".aspx")) continue;

    const normalized = normalizeUrl(resolved.toString());
    if (knownSources.has(normalized)) continue;
    const label = plainText(match[2]);
    const haystack = `${normalized} ${label}`.toLowerCase();
    const matchedKeywords = policy.bankingCandidateKeywords.filter((keyword) => haystack.includes(keyword.toLowerCase()));
    if (!matchedKeywords.length) continue;

    const existing = candidates.get(normalized);
    if (!existing || label.length > existing.label.length) {
      candidates.set(normalized, {
        url: normalized,
        label: label || resolved.pathname.split("/").pop(),
        matchedKeywords
      });
    }
  }
  hubCheck.candidates = [...candidates.values()].slice(0, 50);
} catch (error) {
  hubCheck.error = error instanceof Error ? error.message : String(error);
}

const report = {
  schemaVersion: 1,
  generatedAt: checkedAt.toISOString(),
  authority: policy.authority,
  corpusSize: regulations.length,
  sourceChecks,
  hubCheck,
  summary: {
    reachableSources: sourceChecks.filter((item) => item.ok).length,
    sourceErrors: sourceChecks.filter((item) => !item.ok).length,
    modifiedAfterVerification: sourceChecks.filter((item) => item.serverModifiedAfterVerification).length,
    bankingCandidates: hubCheck.candidates?.length || 0
  }
};

const lines = [
  "# RegulaBank regulatory monitor",
  "",
  `Generated: ${report.generatedAt}`,
  `Indexed sources reachable: ${report.summary.reachableSources}/${report.corpusSize}`,
  `Sources with errors: ${report.summary.sourceErrors}`,
  `Server Last-Modified newer than human verification: ${report.summary.modifiedAfterVerification}`,
  `Unindexed banking-like candidates from OJK hub: ${report.summary.bankingCandidates}`,
  ""
];

const changed = sourceChecks.filter((item) => item.serverModifiedAfterVerification);
if (changed.length) {
  lines.push("## Sources requiring review", "");
  for (const item of changed) lines.push(`- ${item.type} ${item.number} — server Last-Modified ${item.lastModified}; human verification ${item.verifiedAt}`);
  lines.push("");
}

const failed = sourceChecks.filter((item) => !item.ok);
if (failed.length) {
  lines.push("## Source errors", "");
  for (const item of failed) lines.push(`- ${item.id}: ${item.error || `HTTP ${item.httpStatus}`}`);
  lines.push("");
}

if (hubCheck.candidates?.length) {
  lines.push("## Candidate OJK regulations not yet indexed", "");
  for (const item of hubCheck.candidates.slice(0, 20)) {
    lines.push(`- ${item.label} — ${item.url} _(matched: ${item.matchedKeywords.join(", ")})_`);
  }
  lines.push("");
}

lines.push("> Detection is evidence only. A human reviewer must verify legal status, amendments, scope, and interpretation before curated RegulaBank data is changed.");
const markdown = `${lines.join("\n")}\n`;
console.log(markdown);

if (outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
if (summaryPath) await fs.appendFile(summaryPath, markdown, "utf8");
