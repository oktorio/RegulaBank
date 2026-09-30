# NARADA

NARADA is an Android-first regulatory workspace for searching, reading, bookmarking, and working with curated Indonesian banking regulations. The app combines a local curated index, official OJK source links, optional offline PDF indexing, personal notes, and licensing checklists.

> **Important:** NARADA is not an official OJK application and is not a substitute for authoritative regulation text. Status, amendments, effective dates, obligations, and supervisory conclusions must be verified against official OJK sources.

## Release state

Current engineering version: **V1.4.0 RC1** (`1.4.0-rc1`).

This release candidate upgrades the Android stack to API 36, migrates local web assets to `WebViewAssetLoader`, adds predictive-back compatible navigation, handles system insets for Android 16 edge-to-edge behavior, introduces adaptive icons, improves accessibility touch targets, adds explicit privacy/data-deletion controls, separates legal-status attention from freshness signals, and prepares signed AAB/APK release automation.

Production publication is intentionally blocked until the human release gates in `config/release-readiness.json` and `tools/check-release-readiness.mjs` are satisfied.

## Current capabilities

- Search by regulation number, title, indexed content, aliases, and synonyms.
- Open curated dossiers with legal-status metadata, effective date, related rules, verification provenance, and action notes.
- Download official OJK PDF attachments for offline use.
- Build a local text index from downloaded PDFs for offline search.
- Save bookmarks, personal notes, regulatory alerts, and licensing checklists locally on the device.
- Copy and share citations through constrained Android bridges.
- Delete PDFs only or erase the entire local workspace from the Info screen.
- Validate curated regulatory records automatically before merge.
- Monitor official OJK sources for reachability, server signals, visible-text fingerprints, and unindexed banking-related candidates.
- Keep freshness/integrity signals separate from human legal-status verification.

## Architecture

- `app/src/main/assets/` — HTML/CSS/JavaScript UI and curated regulation metadata.
- `MainActivity.java` — Android 16-ready WebView container, system insets, predictive-back dispatch, external-link handling, and `WebViewAssetLoader`.
- `SecurityPolicy.java` — shared OJK HTTPS allow-list and regulation-ID validation.
- `PdfDownloadBridge.java` — official OJK PDF discovery/download bridge.
- `AppBridge.java` — clipboard/share helpers, offline indexing, search, and storage controls.
- `PdfProvider.java` — read-only non-exported content provider for downloaded PDFs.
- `tools/validate-regulatory-data.mjs` — curated corpus integrity validator.
- `tools/validate-ui-contract.mjs` — lightweight release UI contract validation.
- `tools/check-release-readiness.mjs` — strict human + technical production release gate.
- `tools/check-ojk-regulatory-feed.mjs` — online evidence collection and candidate discovery.
- `config/regulatory-integrity.json` — authority allow-list and freshness policy.
- `config/regulatory-baselines.json` — human-approved source fingerprint baselines.
- `config/release-readiness.json` — permanent package-ID confirmation and release metadata.

The app does not require an account or a NARADA-operated backend for the current feature set.

## Security and privacy model

The current release candidate applies these controls:

- cleartext network traffic is disabled;
- native document downloads are restricted to HTTPS `ojk.go.id` and subdomains;
- every redirect hop is revalidated;
- local application content is served through `WebViewAssetLoader`, not `file://`;
- file/content access from WebView is disabled;
- the content security policy blocks frames, object embedding, form submission, and non-approved network targets;
- regulation IDs crossing the JavaScript/native boundary use a strict allow-list format;
- page/PDF downloads have explicit size limits;
- downloaded PDFs are magic-header validated;
- the PDF provider is non-exported and grants temporary read access only;
- WebView debugging is enabled only in debuggable builds;
- Android backup and device-to-device transfer are explicitly excluded for workspace data;
- no account, advertising, analytics, telemetry, or remote note synchronization is present.

See `docs/privacy-policy.md`, `docs/data-safety.md`, and `SECURITY.md`.

## Regulatory integrity model

Automated monitoring produces **evidence only**. It must not automatically change legal status, effective date, interpretation, amendment relationships, or supervisory conclusions.

The static validator checks record format, supported status values, official OJK URLs, verification metadata, referential integrity, freshness fields, alerts, and checklist references.

The online monitor checks source reachability, redirects, selected HTTP metadata, visible-text SHA-256 fingerprints, review age, and unindexed banking-related candidates. Fingerprint comparison is meaningful only after a human reviewer explicitly approves a baseline.

### Human release boundary

A production release is blocked if:

- any regulation remains `Perlu verifikasi`;
- any regulation lacks a human verification date;
- any source fingerprint baseline is still unapproved; or
- the permanent Google Play `applicationId` has not been explicitly confirmed.

Run:

```bash
node tools/check-release-readiness.mjs
```

Use `--report-only` for non-blocking RC diagnostics.

## Build requirements

- JDK 17
- Android SDK / target API 36
- Android Gradle Plugin 8.9.1
- Gradle Wrapper pinned to 8.11.1

### Local build

```bash
./gradlew :app:testDebugUnitTest
./gradlew :app:assembleDebug
./gradlew :app:lintDebug
./gradlew :app:bundleRelease
```

### Data and UI validation

```bash
node tools/validate-regulatory-data.mjs
node tools/validate-ui-contract.mjs
node tools/check-release-readiness.mjs --report-only
```

### Regulatory monitoring

```bash
node tools/check-ojk-regulatory-feed.mjs --output reports/ojk-regulatory-monitor.json
```

After a human reviewer has checked the authoritative source, selected fingerprints can be approved explicitly:

```bash
node tools/approve-regulatory-baseline.mjs \
  --report reports/ojk-regulatory-monitor.json \
  --ids pojk-4-2026,padk-1-2026 \
  --approved-by "reviewer-name"
```

Bulk/wildcard approval is intentionally disabled.

## CI/CD

- `.github/workflows/android-ci.yml` — API 36 build, unit tests, debug/release lint, unsigned RC AAB, regulatory validation, UI validation, and readiness report.
- `.github/workflows/regulatory-monitor.yml` — static regulatory checks on changes plus scheduled/manual OJK monitoring.
- `.github/workflows/codeql.yml` — Java and JavaScript CodeQL analysis.
- `.github/workflows/release.yml` — strict signed AAB/APK release workflow.
- `.github/dependabot.yml` — weekly Gradle and GitHub Actions dependency checks.

Production signing secrets expected by the release workflow:

- `NARADA_KEYSTORE_B64`
- `NARADA_KEYSTORE_PASSWORD`
- `NARADA_KEY_ALIAS`
- `NARADA_KEY_PASSWORD`

Build binaries are no longer committed to the Git tree. Release artifacts should be distributed through GitHub Actions / GitHub Releases and the Google Play testing tracks.

## Google Play preparation

See `docs/release-checklist.md` and `docs/data-safety.md`. The release workflow produces a signed AAB only after the strict gate and signing-secret checks pass.

## Known limitations

- The regulation corpus is curated, not automatically synchronized with the full OJK catalogue.
- Rule-based candidate discovery can miss indirectly titled regulations.
- ETag and Last-Modified values are technical web-server signals, not proof of legal change.
- A fingerprint difference is a review signal, not proof that the legal text changed.
- Image-only/scanned PDFs require OCR before their content can become searchable.
- Release shrinking/obfuscation remains disabled pending device-level regression coverage for the PDFBox/WebView bridge.
- Source-code licensing for the public repository remains an owner decision; third-party notices are documented in `THIRD_PARTY_NOTICES.md`.
