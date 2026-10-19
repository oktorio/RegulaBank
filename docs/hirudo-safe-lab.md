# NARADA LAB — inert Hirudo-themed Android telemetry experiment

**Status:** defensive lab demonstration only. **NOT Hirudo, NOT a RAT, NOT an APK wrapping or malware injection tool.**

## Scope

This variant demonstrates how to compare the package and runtime footprint of a normal Android APK and a visibly marked lab build. Only NARADA's original user interface and existing functionality are present. The extra Java `Application` class writes **synthetic, explicitly labeled** lifecycle and technique-stage events to Logcat and an app-private JSON Lines file.

It does not load any malware, dynamically inject DEX, acquire sensitive permissions, install/replace packages, harvest credentials/notifications/SMS, enumerate banking apps, connect to a C2, or run persistently in the background. The Android network permission already exists in the NARADA base app for official regulatory downloads, not the simulator.

## Isolated Android build variant

| Property | Normal debug | Safe lab |
| --- | --- | --- |
| Gradle task | `assembleDebug` | `assembleHirudoLab` |
| Application ID | `id.regulabank.app` | `id.regulabank.app.lab` |
| Visible app name | NARADA | NARADA LAB - SIMULASI |
| Application entry | Android default `Application` | `id.regulabank.app.lab.LabApplication` |
| Network / C2 simulator | None | **No network**; local text events only |
| Dangerous permissions added | None | None |
| Boot receiver / persistent service | None | None |

Production `assembleRelease` and signed release workflows remain unchanged.

## Build and install (emulator, no personal accounts)

Requires JDK 17, Android SDK API 36, Gradle 8.11.1, and an Android emulator.

```bash
git checkout lab/hirudo-simulation
gradle :app:assembleDebug :app:assembleHirudoLab

adb install -r app/build/outputs/apk/hirudoLab/app-hirudoLab.apk
adb shell monkey -p id.regulabank.app.lab 1
adb logcat -d -s HIRUDO_LAB:I
adb shell run-as id.regulabank.app.lab cat files/hirudo_lab_events.jsonl
```

On Windows PowerShell, run the same `adb` commands individually. The JSONL log holds only synthetic strings and timestamps. `run-as` works because the LAB build is debuggable.

## Static comparison commands

```bash
sha256sum app/build/outputs/apk/debug/app-debug.apk app/build/outputs/apk/hirudoLab/app-hirudoLab.apk
$ANDROID_HOME/build-tools/36.0.0/aapt dump badging app/build/outputs/apk/hirudoLab/app-hirudoLab.apk
$ANDROID_HOME/build-tools/36.0.0/aapt dump permissions app/build/outputs/apk/hirudoLab/app-hirudoLab.apk
```

Check:

1. Package name is different, so the lab app cannot update/replace the production package.
2. App label prominently identifies it as a lab simulation.
3. No `RECEIVE_BOOT_COMPLETED`, Accessibility service, SMS access, notification listener, package-install, or overlay permissions were introduced.
4. Instrumentation only emits `HIRUDO_LAB` local lines such as `C2_SIMULATED`.
5. NARADA WebView screens continue to operate unchanged.

## Evidence expected

- Paired SHA-256 values of baseline and lab APK.
- Side-by-side `aapt` manifest/permission comparison.
- Logcat event names `LAB_START`, `BOOTSTRAP_SIMULATED`, `PERSISTENCE_SIMULATED`, `C2_SIMULATED`, `MODULES_SIMULATED`, `BANK_REPLACEMENT_SIMULATED`, and activity callbacks.
- Source diff showing the added build type and lab-only source set.
- A screenshot of the visible `NARADA LAB - SIMULASI` app label.

**Interpretation:** this lab validates Android build/source-set isolation and DFIR evidence collection. It does **not** prove that the real Hirudo can wrap or infect NARADA, or validate actual RAT command execution.
