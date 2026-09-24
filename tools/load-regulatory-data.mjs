import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "..");

export async function loadPolicy() {
  const raw = await fs.readFile(path.join(ROOT, "config", "regulatory-integrity.json"), "utf8");
  return JSON.parse(raw);
}

export async function loadBaselines() {
  const raw = await fs.readFile(path.join(ROOT, "config", "regulatory-baselines.json"), "utf8");
  return JSON.parse(raw);
}

export async function loadRegulatoryData() {
  const dataPath = path.join(ROOT, "app", "src", "main", "assets", "data.js");
  const metadataPath = path.join(ROOT, "app", "src", "main", "assets", "v1-data.js");
  const [dataSource, metadataSource] = await Promise.all([
    fs.readFile(dataPath, "utf8"),
    fs.readFile(metadataPath, "utf8")
  ]);

  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    Date,
    Intl,
    Set,
    Map,
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
    Math
  };
  const context = vm.createContext(sandbox);
  const exportSource = `\n;globalThis.__REGULATIONS = REGULATIONS;\n` +
    `globalThis.__METADATA = V1_REGULATION_METADATA;\n` +
    `globalThis.__ALERTS = REGULATORY_ALERTS;\n` +
    `globalThis.__CHECKLISTS = LICENSING_CHECKLISTS;\n` +
    `globalThis.__FRESHNESS_POLICY = REGULATORY_FRESHNESS_POLICY;\n`;

  vm.runInContext(`${dataSource}\n${metadataSource}\n${exportSource}`, context, {
    filename: "regulabank-regulatory-data.js",
    timeout: 2000
  });

  return {
    regulations: structuredClone(context.__REGULATIONS),
    metadata: structuredClone(context.__METADATA),
    alerts: structuredClone(context.__ALERTS),
    checklists: structuredClone(context.__CHECKLISTS),
    freshnessPolicy: structuredClone(context.__FRESHNESS_POLICY)
  };
}

export function parseIndonesianDate(value) {
  if (typeof value !== "string") return null;
  const months = new Map([
    ["januari", 0], ["februari", 1], ["maret", 2], ["april", 3],
    ["mei", 4], ["juni", 5], ["juli", 6], ["agustus", 7],
    ["september", 8], ["oktober", 9], ["november", 10], ["desember", 11]
  ]);
  const match = value.trim().toLowerCase().match(/^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/);
  if (!match || !months.has(match[2])) return null;
  const date = new Date(Date.UTC(Number(match[3]), months.get(match[2]), Number(match[1])));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function daysBetween(older, newer = new Date()) {
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.floor((newer.getTime() - older.getTime()) / dayMs);
}

export function normalizeUrl(value) {
  const url = new URL(value);
  url.hash = "";
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
    url.port = "";
  }
  url.hostname = url.hostname.toLowerCase();
  return url.toString().replace(/\/$/, "");
}

export function isAllowedAuthorityUrl(value, policy) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    if (url.port && url.port !== "443") return false;
    const host = url.hostname.toLowerCase();
    return policy.authorityHosts.some((authority) => {
      const normalized = authority.toLowerCase();
      return host === normalized || host.endsWith(`.${normalized}`);
    });
  } catch {
    return false;
  }
}
