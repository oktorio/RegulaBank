# NARADA Production Release Checklist

## Human decisions

- [ ] Confirm the permanent Google Play `applicationId` in `config/release-readiness.json`.
- [ ] Approve all regulatory fingerprint baselines from fresh monitoring evidence.
- [ ] Confirm store listing owner/developer name, support contact, and privacy-policy URL.
- [ ] Confirm source-code licensing policy for the public repository.

## Regulatory corpus

- [ ] `node tools/validate-regulatory-data.mjs` passes.
- [ ] No record has status `Perlu verifikasi`.
- [ ] Every record has a human verification date.
- [ ] Every baseline in `config/regulatory-baselines.json` is explicitly human-approved.
- [ ] Scheduled OJK monitor has no unresolved material change signal.

## Android

- [ ] API 36 compile/target confirmed.
- [ ] Debug unit tests pass.
- [ ] UI contract validation passes.
- [ ] Debug and release lint pass.
- [ ] Release AAB and APK build successfully.
- [ ] Signed release APK passes `apksigner verify`.
- [ ] Back navigation tested on Android 16.
- [ ] Edge-to-edge/system insets tested in gesture and 3-button navigation.
- [ ] Search, filters, detail sheet, bookmarks, notes, checklist, PDF download/open, and clear-data flows tested.
- [ ] TalkBack and large-font testing completed on at least one physical device.

## Signing and distribution

- [ ] Permanent upload keystore generated and stored outside the repository.
- [ ] GitHub Actions secrets configured: `NARADA_KEYSTORE_B64`, `NARADA_KEYSTORE_PASSWORD`, `NARADA_KEY_ALIAS`, `NARADA_KEY_PASSWORD`.
- [ ] Play App Signing enabled.
- [ ] Internal testing track used before production.
- [ ] Final production version has no `-rc` suffix.

## Google Play

- [ ] Privacy policy published and reachable over HTTPS.
- [ ] Data Safety form matches the production binary.
- [ ] IARC/content-rating questionnaire completed.
- [ ] Store screenshots, short description, full description, and feature graphic prepared.
- [ ] App access declaration completed.
- [ ] Target-audience and ads declarations completed.
- [ ] Required closed-testing requirement, if applicable to the developer account, completed.

The strict command `node tools/check-release-readiness.mjs` must pass before a production tag is created.
