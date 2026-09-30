# Google Play Data Safety — NARADA

This document is the release-team worksheet for the current offline-first build. Re-check the answers against the actual production binary immediately before Play Console submission.

## Current declaration

- **Does the app collect or share required user data with the developer?** No.
- **Account required?** No.
- **Advertising SDK?** No.
- **Analytics SDK?** No.
- **Crash-reporting SDK?** No.
- **Location, camera, microphone, contacts, phone, SMS, health, financial-account or advertising permissions?** No.
- **Internet permission?** Yes, for official OJK document/source access.
- **Local user content?** Bookmarks, notes, checklist progress, recent searches, PDFs, and PDF text indexes remain in the app sandbox.
- **Cloud backup / device transfer of workspace data?** Explicitly excluded.
- **User-initiated sharing?** Yes. Copy/share actions may send selected citation text to the Android clipboard or a user-selected external app. Treat these as user-initiated transfers rather than developer collection.
- **External browsing?** Yes. Official HTTPS sources open in the user's browser; OJK/browser/network-provider policies then apply.

## Before submitting to Play Console

1. Compare the production dependency tree with this document.
2. Confirm that no analytics, telemetry, ad, crash, or remote-sync SDK was added.
3. Confirm the public privacy-policy URL.
4. Complete the Data Safety form using the production behavior, not this draft alone.
5. Repeat the review whenever permissions, SDKs, network endpoints, or storage behavior changes.
