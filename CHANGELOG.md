# Changelog

## 1.4.0 RC1 — 30 September 2026

### Android platform
- Target/compile Android API 36.
- Upgrade AGP to 8.9.1 and pin CI to Gradle 8.11.1.
- Add Android 16 edge-to-edge/system-inset handling.
- Move Back handling to the AndroidX back dispatcher.
- Serve bundled web content through `WebViewAssetLoader` instead of `file://`.
- Add adaptive and themed launcher icon resources.

### Security and privacy
- Centralize OJK HTTPS and regulation-ID validation.
- Add native security unit tests.
- Explicitly exclude workspace data from cloud backup and device transfer.
- Add complete local-workspace deletion.
- Add privacy policy, Data Safety worksheet, security policy, CodeQL, and Dependabot.
- Stop storing APK binaries in the current repository tree.

### Regulatory integrity
- Separate legal `Perlu verifikasi` status from technical freshness signals.
- Record current-status evidence for POJK 27/POJK.03/2016.
- Add strict production gates for human verification and source fingerprint baselines.

### Release engineering
- Add API 36 CI, debug/release lint, unit tests, RC APK/AAB artifacts, and signed release workflow.
- Require permanent application-ID confirmation and production version/tag matching before release.

## 1.3.12 — 28 September 2026

- Simplified home-screen information density.
- Made search the primary home action.
- Reduced redundant copy across Update, Checklist, Saved, and Info views.
- Deduplicated recent-search chips already shown as quick suggestions.
