import fs from "node:fs/promises";
import path from "node:path";
import { ROOT } from "./load-regulatory-data.mjs";

const [html, css, app] = await Promise.all([
  fs.readFile(path.join(ROOT, "app", "src", "main", "assets", "index.html"), "utf8"),
  fs.readFile(path.join(ROOT, "app", "src", "main", "assets", "v1.css"), "utf8"),
  fs.readFile(path.join(ROOT, "app", "src", "main", "assets", "app.js"), "utf8")
]);

const errors = [];
const expect = (condition, message) => { if (!condition) errors.push(message); };

expect(!html.includes("BANKING REGULATORY WORKSPACE"), "Legacy hero eyebrow returned.");
expect(!html.includes("Temukan ketentuan"), "Legacy marketing hero returned.");
expect(!html.includes('id="aboutButton"'), "Duplicate top-bar Info control returned.");
expect(html.includes("Cari nomor, judul, atau isi ketentuan…"), "Primary search placeholder changed unexpectedly.");
expect(html.includes("Perlu verifikasi"), "Dashboard must separate legal verification status.");
expect(html.includes("Kebijakan privasi"), "Privacy policy entry point is missing.");
expect(html.includes("frame-src 'none'"), "CSP must block frames.");
expect((html.match(/class="nav-item/g) || []).length === 5, "Bottom navigation must have five primary destinations.");
expect(css.includes("min-height: 48px"), "Accessibility touch-target override is missing.");
expect(app.includes("window.naradaHandleBack"), "Android predictive-back JS bridge is missing.");
expect(app.includes('item.status === "Perlu verifikasi"'), "Legal verification shortcut must not mix freshness states.");

for (const error of errors) console.error(`ERROR: ${error}`);
if (errors.length) process.exit(1);
console.log("NARADA UI contract validation passed.");
