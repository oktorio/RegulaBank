# RegulaBank

RegulaBank is an Android-first regulatory workspace for searching, reading, bookmarking, and working with Indonesian banking regulations. The app combines a curated local index with official OJK source links and optional offline PDF indexing.

> **Important:** RegulaBank is not an official OJK application and is not a substitute for the authoritative regulation text. Always verify status, amendments, effective dates, and obligations against official OJK sources before making a regulatory or supervisory decision.

## Current capabilities

- Search by regulation number, title, indexed content, aliases, and synonyms.
- Open curated regulation dossiers with status, effective date, related rules, and action notes.
- Download official OJK PDF attachments for offline use.
- Build a local text index from downloaded PDFs for offline search.
- Save bookmarks, personal notes, regulatory alerts, and licensing checklists locally on the device.
- Copy and share citations through a constrained Android WebView bridge.
- Validate curated regulation records automatically before merge.
- Monitor official OJK sources for reachability, trustworthy server signals, visible-text content fingerprints, and unindexed banking-related candidates.
- Compare current source fingerprints with explicitly human-approved baselines.
- Surface freshness state directly in the app and allow users to filter/sort records that need review.

## Architecture

RegulaBank is intentionally small and offline-first:

- `app/src/main/assets/` — HTML/CSS/JavaScript user interface and curated regulation metadata.
- `MainActivity.java` — hardened WebView container and external-link handling.
- `PdfDownloadBridge.java` — official OJK PDF discovery/download bridge.
- `AppBridge.java` — clipboard/share helpers, offline indexing, search, and storage management.
- `PdfProvider.java` — read-only content provider for locally stored PDFs.
- `tools/validate-regulatory-data.mjs` — static integrity validation for the curated corpus.
- `tools/check-ojk-regulatory-feed.mjs` — online evidence collection and candidate discovery against OJK sources.
- `config/regulatory-integrity.json` — authority allow-list, freshness thresholds, monitoring limits, and banking-specific discovery keywords.
- `config/regulatory-baselines.json` — human-approved source fingerprint baselines.
- `tools/approve-regulatory-baseline.mjs` — explicit, auditable baseline approval command.

The app does not require an account or a backend service for its current feature set.

## Security model

V1.1+ applies the following controls:

- Cleartext network traffic is disabled.
- Native PDF downloads are restricted to HTTPS URLs under `ojk.go.id` and its subdomains.
- Every HTTP redirect hop is validated before the native downloader follows it.
- Regulation IDs crossing the JavaScript/native boundary use a strict allow-list format and cannot contain path traversal segments.
- Downloaded pages and PDFs have explicit size limits.
- PDF files are validated by magic header before being exposed to other apps.
- The PDF content provider is not exported and grants temporary read access only.
- WebView debugging is enabled only for debuggable builds.
- App backup is disabled.

## Regulatory data integrity model

V1.2 separates **automated detection** from **human regulatory verification**.

### Automated controls

The static validator checks:

- regulation ID format and uniqueness;
- mandatory fields and supported status values;
- ISO issue dates;
- official HTTPS OJK source URLs;
- metadata completeness;
- verification age against configured review/stale thresholds;
- referential integrity for related regulations;
- runtime freshness/provenance fields;
- alert and checklist references.

The online monitor checks:

- whether each indexed OJK source remains reachable;
- HTTP status, final URL, ETag, Last-Modified and a visible-text SHA-256 fingerprint;
- scheduled human-review age from the recorded verification date;
- whether a usable server modification signal is newer than the human verification;
- the OJK regulatory hub for banking-specific regulation links that are not yet indexed.

`Last-Modified` values close to the current request time are treated as **volatile** and ignored as change evidence. This specifically avoids treating dynamic CMS response headers as legal-content changes. Visible-text fingerprints are retained in the monitoring artifact and compared only with a baseline that has been explicitly approved. Raw HTML is not fingerprinted, reducing false positives from non-semantic CMS markup changes.

### Human-review boundary

A monitoring signal is **evidence only**. It must not automatically change a regulation's legal status, effective date, interpretation, amendment relationship, or supervisory conclusion. Those fields remain curated and require human verification against the authoritative OJK text.

This prevents a CMS page update, metadata change, false-positive keyword match, or transient web behavior from being treated as a legal/regulatory change.

## GitHub monitoring

`.github/workflows/regulatory-monitor.yml` runs static validation on relevant pushes and pull requests. An online monitoring run is scheduled weekly and can also be started manually with `workflow_dispatch`.

Online runs publish a JSON evidence artifact containing:

- source reachability results;
- final URLs and response metadata;
- content fingerprints;
- freshness state based on the last human verification date;
- reliable server modification signals, when available;
- candidate OJK banking regulations not yet present in the curated corpus.

The workflow intentionally does **not** auto-commit detected regulatory changes or approve new baselines.

## Build requirements

- JDK 17
- Android SDK 35
- Android Gradle Plugin 8.6.1
- Gradle 8.7

Android API 35 requires Android Gradle Plugin 8.6.0 or newer; the project uses 8.6.1.

### Build locally

Open the project in a compatible Android Studio version, or use Gradle 8.7 from the project root:

```bash
gradle :app:assembleDebug
```

Run lint with:

```bash
gradle :app:lintDebug
```

Validate regulatory data with:

```bash
node tools/validate-regulatory-data.mjs
```

Run the online OJK monitor manually with:

```bash
node tools/check-ojk-regulatory-feed.mjs --output reports/ojk-regulatory-monitor.json
```

After a human reviewer has checked the authoritative source, approve selected technical source fingerprints explicitly:

```bash
node tools/approve-regulatory-baseline.mjs \
  --report reports/ojk-regulatory-monitor.json \
  --ids pojk-4-2026,padk-1-2026 \
  --approved-by "reviewer-name"
```

Wildcard/bulk approval is intentionally disabled, and monitoring evidence older than the configured approval window is rejected.

## Regulation data maintenance

The curated dataset is stored in:

- `app/src/main/assets/data.js` — primary regulation records.
- `app/src/main/assets/v1-data.js` — verification metadata, aliases, relationships, alerts, checklist templates, and runtime freshness/provenance.

For each regulation update:

1. Review the monitoring evidence, if any.
2. Open and verify the authoritative OJK source.
3. Verify regulation status and effective date.
4. Check whether another regulation amends, partially revokes, replaces, or supplements it.
5. Update the human-readable summary and action/deadline metadata only after verification.
6. Record the human verification date.
7. Run the regulatory validator, Android build, and lint before merging.

## Privacy

Bookmarks, notes, checklists, downloaded PDFs, and generated PDF search indexes stay inside the application sandbox in the current implementation. No analytics or remote note synchronization is implemented.

## Known limitations / next priorities

- Candidate discovery uses rule-based banking keywords and can still miss regulations with indirect titles.
- ETag and Last-Modified are web-server signals, not proof that legal content changed; volatile request-time headers are ignored.
- Fingerprint baselines initially remain unapproved until a human reviewer accepts monitoring evidence for each record.
- A fingerprint difference is a review signal, not proof that the legal text changed.
- The regulation corpus is still curated rather than automatically synchronized with the full OJK catalogue.
- Offline PDF indexing is text extraction only; image-only/scanned PDFs require OCR to become searchable.
- Release shrinking/obfuscation remains disabled until WebView bridge and PDFBox release builds have automated regression coverage.
- A Gradle Wrapper should be added once wrapper binary generation is performed from a trusted Gradle installation.

## Version

Current version: **V1.2.1 Regulatory Data Integrity** (`1.2.1`).
