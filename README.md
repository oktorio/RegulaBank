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

## Architecture

RegulaBank is intentionally small and offline-first:

- `app/src/main/assets/` — HTML/CSS/JavaScript user interface and curated regulation metadata.
- `MainActivity.java` — hardened WebView container and external-link handling.
- `PdfDownloadBridge.java` — official OJK PDF discovery/download bridge.
- `AppBridge.java` — clipboard/share helpers, offline indexing, search, and storage management.
- `PdfProvider.java` — read-only content provider for locally stored PDFs.

The app does not require an account or a backend service for its current V1 feature set.

## Security model

V1.1 applies the following controls:

- Cleartext network traffic is disabled.
- Native PDF downloads are restricted to HTTPS URLs under `ojk.go.id` and its subdomains.
- Every HTTP redirect hop is validated before the native downloader follows it.
- Regulation IDs crossing the JavaScript/native boundary use a strict allow-list format and cannot contain path traversal segments.
- Downloaded pages and PDFs have explicit size limits.
- PDF files are validated by magic header before being exposed to other apps.
- The PDF content provider is not exported and grants temporary read access only.
- WebView debugging is enabled only for debuggable builds.
- App backup is disabled.

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

GitHub Actions runs both commands on pushes and pull requests.

## Regulation data maintenance

The curated dataset is stored in:

- `app/src/main/assets/data.js` — primary regulation records.
- `app/src/main/assets/v1-data.js` — verification metadata, aliases, relationships, alerts, and checklist templates.

For each regulation update:

1. Verify the authoritative OJK source URL.
2. Verify the regulation status and effective date.
3. Check whether another regulation amends, partially revokes, replaces, or supplements it.
4. Update the human-readable summary and action/deadline metadata.
5. Record the verification date.
6. Build and lint before merging.

A future version should automate freshness checks and distinguish machine-detected changes from human-verified regulatory interpretation.

## Privacy

Bookmarks, notes, checklists, downloaded PDFs, and generated PDF search indexes stay inside the application sandbox in the current implementation. No analytics or remote note synchronization is implemented.

## Known limitations / next priorities

- The regulation corpus is curated and is not yet synchronized automatically with the full OJK regulatory catalogue.
- Verification freshness is metadata-driven; stale records should be surfaced more prominently in a future release.
- Offline PDF indexing is text extraction only; image-only/scanned PDFs require OCR to become searchable.
- Release shrinking/obfuscation remains disabled until WebView bridge and PDFBox release builds have automated regression coverage.
- A Gradle Wrapper should be added once wrapper binary generation is performed from a trusted Gradle installation.

## Version

Current development branch: **V1.1 hardening** (`v1.1-hardening`).
