# NARADA Release QA Matrix

Record actual test evidence before production. A checked box should correspond to a real device/emulator run, not code review alone.

| Area | API 24 | API 30 | API 35 | API 36 |
| --- | --- | --- | --- | --- |
| Cold launch | ☐ | ☐ | ☐ | ☐ |
| Search / clear / search modes | ☐ | ☐ | ☐ | ☐ |
| Filters / sort / dashboard shortcuts | ☐ | ☐ | ☐ | ☐ |
| Open/close regulation detail | ☐ | ☐ | ☐ | ☐ |
| System Back from detail/dialog/subpage | ☐ | ☐ | ☐ | ☐ |
| Gesture navigation / bottom inset | n/a | ☐ | ☐ | ☐ |
| 3-button navigation / bottom inset | ☐ | ☐ | ☐ | ☐ |
| Display cutout / status-bar inset | ☐ | ☐ | ☐ | ☐ |
| Bookmark persistence | ☐ | ☐ | ☐ | ☐ |
| Note persistence and deletion | ☐ | ☐ | ☐ | ☐ |
| Checklist persistence/reset | ☐ | ☐ | ☐ | ☐ |
| OJK external link | ☐ | ☐ | ☐ | ☐ |
| Official PDF download/open | ☐ | ☐ | ☐ | ☐ |
| Offline PDF search | ☐ | ☐ | ☐ | ☐ |
| PDF-only clear | ☐ | ☐ | ☐ | ☐ |
| Clear all local data | ☐ | ☐ | ☐ | ☐ |
| Rotation/process recreation sanity | ☐ | ☐ | ☐ | ☐ |
| Large font / display scaling | ☐ | ☐ | ☐ | ☐ |
| TalkBack navigation | ☐ | ☐ | ☐ | ☐ |

## Negative/security checks

- ☐ HTTP URLs are not opened by the native bridge.
- ☐ Look-alike domains such as `ojk.go.id.example.com` are rejected by native download logic.
- ☐ Redirects leaving the OJK HTTPS allow-list are rejected.
- ☐ Traversal-like regulation IDs are rejected.
- ☐ App backup/device-transfer exclusions are reflected in the final manifest.
- ☐ WebView debugging is disabled in a release build.
- ☐ No signing files, passwords, APKs, or AABs are committed to the repository.

## Accessibility

- ☐ Primary controls expose meaningful TalkBack labels.
- ☐ Focus returns to the invoking control when modal/detail closes.
- ☐ Detail and confirmation dialogs trap keyboard/focus navigation appropriately.
- ☐ Important controls retain approximately 48dp minimum touch targets.
- ☐ Text remains usable at large Android font sizes without hiding critical actions.
