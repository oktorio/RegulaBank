#!/usr/bin/env bash
# Authorized remote control of user's own Android Studio emulator via SSH + ADB + scrcpy.
# Not part of the APK; no covert access, persistence, or Android dangerous permissions.
set -Eeuo pipefail
APP_ID='id.regulabank.app.lab'
ADB_SERIAL="${NARADA_LAB_EMULATOR_SERIAL:-emulator-5554}"
ADB_SERVER_SOCKET='tcp:127.0.0.1:5038'
MODE="${1:-help}"

usage() {
  cat <<'EOF'
NARADA LAB authorized emulator controller
  tools/narada-lab-remote.sh tunnel <windows-ssh-user>@<VMnet1-Windows-IP> [SSH-port]
  tools/narada-lab-remote.sh devices
  tools/narada-lab-remote.sh status
  tools/narada-lab-remote.sh view
  tools/narada-lab-remote.sh open
  tools/narada-lab-remote.sh stop
  tools/narada-lab-remote.sh logs
  tools/narada-lab-remote.sh screenshot [file.png]
Start tunnel in one terminal and view in another. Close tunnel to end remote access.
Only Android Studio emulators are accepted as device targets.
EOF
}
need_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing command: $1" >&2; exit 127; }
}
emulator_only() {
  if [[ ! "$ADB_SERIAL" =~ ^emulator-[0-9]+$ ]]; then
    echo "Refusing non-emulator serial; use your Android Studio emulator only." >&2
    exit 2
  fi
}
adb_lab() {
  emulator_only
  need_cmd adb
  export ADB_SERVER_SOCKET
  adb -s "$ADB_SERIAL" "$@"
}

case "$MODE" in
  help|-h|--help) usage ;;
  tunnel)
    [[ $# -ge 2 ]] || { usage >&2; exit 2; }
    target="$2"
    port="${3:-22}"
    if [[ ! "$target" =~ ^[A-Za-z0-9_.-]+@[A-Za-z0-9_.:-]+$ ]] ||
       [[ ! "$port" =~ ^[0-9]+$ ]] ||
       (( port < 1 || port > 65535 )); then
      echo "Usage: tunnel user@Windows-VMnet1-IP [port]" >&2
      exit 2
    fi
    need_cmd ssh
    echo "Connecting to $target. Press Ctrl+C to disconnect."
    exec ssh -NT -o ExitOnForwardFailure=yes -o StrictHostKeyChecking=yes \
      -o ServerAliveInterval=15 -p "$port" \
      -L 127.0.0.1:5038:127.0.0.1:5037 \
      -L 127.0.0.1:27183:127.0.0.1:27183 "$target"
    ;;
  devices)
    need_cmd adb
    export ADB_SERVER_SOCKET
    adb devices -l
    ;;
  status)
    adb_lab shell getprop ro.build.version.release
    if adb_lab shell pm path "$APP_ID" | grep -q '^package:'; then
      echo "Installed: $APP_ID"
    else
      echo "NARADA LAB not installed." >&2
      exit 1
    fi
    ;;
  view)
    emulator_only
    need_cmd scrcpy
    need_cmd adb
    export ADB_SERVER_SOCKET
    exec scrcpy --serial="$ADB_SERIAL" --force-adb-forward --port=27183 --no-audio
    ;;
  open)
    adb_lab shell monkey -p "$APP_ID" -c android.intent.category.LAUNCHER 1
    ;;
  stop)
    adb_lab shell am force-stop "$APP_ID"
    ;;
  logs)
    adb_lab logcat -d -s HIRUDO_LAB:I
    ;;
  screenshot)
    output="${2:-narada-lab-emulator.png}"
    if [[ "$output" != *.png ]] || [[ "$output" == -* ]]; then
      echo "Screenshot filename must be *.png and cannot start with -." >&2
      exit 2
    fi
    umask 077
    adb_lab exec-out screencap -p > "$output"
    echo "Screenshot saved: $output"
    ;;
  *)
    echo "Unknown command: $MODE" >&2
    usage >&2
    exit 2
    ;;
esac
