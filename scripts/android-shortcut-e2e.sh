#!/usr/bin/env bash
# Drives the launcher shortcut on a running emulator the way a user does, and keeps a screenshot
# of every step. Host-side on purpose: `adb exec-out screencap` is the only reliable way to get the
# pixels out of the emulator, and the files it produces are attached to the PR as evidence.
#
# The all-apps view does not render static shortcuts on the AOSP launcher (its long-press menu
# offers only "App info"), so the icon is first dragged onto the workspace, which is where a
# launcher shows them.
set -uo pipefail

PKG=com.openchamber.app
APK=${1:-android/app/build/outputs/apk/debug/app-debug.apk}
SERVER=${E2E_SERVER_URL:-http://10.0.2.2:4123}
OUT="${RUNNER_TEMP:-/tmp}/android-evidence"
SELECTOR="$(cd "$(dirname "$0")" && pwd)/ui-centre.py"
mkdir -p "$OUT"

read -r WIDTH HEIGHT <<<"$(adb shell wm size | tr -d '\r' | sed 's/.*: //; s/x/ /')"
echo "display: ${WIDTH}x${HEIGHT}"

dump() {
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  adb pull /sdcard/ui.xml "$OUT/$1.xml" >/dev/null 2>&1
}

shot() {
  adb exec-out screencap -p > "$OUT/$1.png"
  echo "captured $1.png ($(wc -c < "$OUT/$1.png") bytes)"
}

labels() {
  python3 "$SELECTOR" labels "$OUT/$1.xml"
}

at() {
  python3 "$SELECTOR" "$1" "$OUT/$2.xml" "${3:-}"
}

echo "--- install and launch"
adb install -r -g "$APK" >/dev/null
adb shell am start -W -n "$PKG/.MainActivity" >/dev/null
sleep 8
dump 0-launch
shot 0-launch

echo "--- connect to $SERVER"
# The WebView paints after the activity is up, so the first dump can come back empty.
for _ in $(seq 1 20); do
  if labels 0-launch | grep -q 'Connect by address'; then break; fi
  sleep 3
  dump 0-launch
done

read -r CX CY <<<"$(at centre 0-launch 'Connect by address')"
if [ -n "${CX:-}" ]; then
  adb shell input tap "$CX" "$CY"
  sleep 3
  dump 0-form
  read -r FX FY <<<"$(at first-input 0-form)"
  if [ -n "${FX:-}" ]; then
    adb shell input tap "$FX" "$FY"
    sleep 2
    adb shell input text "$(echo "$SERVER" | sed 's#/#\\/#g')"
    sleep 2
    # The keyboard covers the sheet's Connect button, and Return only dismisses it.
    adb shell input keyevent 4
    sleep 1
    dump 0-filled
    shot 0-filled
    # The sheet is taller than the screen, so its Connect button starts below the fold.
    for _ in $(seq 1 4); do
      read -r BTN_X BTN_Y <<<"$(at exact 0-filled 'Connect')"
      if [ -n "${BTN_X:-}" ]; then break; fi
      adb shell input swipe "$((WIDTH / 2))" "$((HEIGHT * 78 / 100))" "$((WIDTH / 2))" "$((HEIGHT * 30 / 100))" 300
      sleep 2
      dump 0-filled
    done
    if [ -n "${BTN_X:-}" ]; then
      echo "tapping Connect at ${BTN_X},${BTN_Y}"
      adb shell input tap "$BTN_X" "$BTN_Y"
    else
      echo "::warning::no Connect button found; labels: $(labels 0-filled)"
      adb shell input keyevent 66
    fi
    for _ in $(seq 1 20); do
      sleep 3
      dump 0-connected
      if ! labels 0-connected | grep -q 'Connect by address'; then break; fi
    done
    shot 0-connected
    echo "after connect: $(labels 0-connected)"
  else
    echo "::warning::no input in the connect sheet; labels: $(labels 0-form)"
  fi
else
  echo "the app is already connected"
fi

echo "--- find the icon on the workspace"
adb shell input keyevent KEYCODE_HOME
sleep 3
dump 1-home
shot 1-home

read -r HOME_X HOME_Y <<<"$(at centre 1-home OpenCham)"
if [ -z "${HOME_X:-}" ]; then
  echo "the icon is not on the workspace yet; opening the app drawer"
  adb shell input swipe "$((WIDTH / 2))" "$((HEIGHT * 85 / 100))" "$((WIDTH / 2))" "$((HEIGHT * 15 / 100))" 300
  sleep 3
  dump 2-drawer
  shot 2-drawer
  read -r ICON_X ICON_Y <<<"$(at centre 2-drawer OpenCham)"
  if [ -z "${ICON_X:-}" ]; then
    echo "::error::no OpenChamber icon in the app drawer; labels: $(labels 2-drawer)"
    exit 1
  fi
  echo "drawer icon at ${ICON_X},${ICON_Y}"

  # Drag it onto the workspace: a launcher only shows a static shortcut for a workspace icon.
  adb shell input draganddrop "$ICON_X" "$ICON_Y" "$((WIDTH / 2))" "$((HEIGHT / 3))" 1500
  sleep 4
  adb shell input keyevent KEYCODE_HOME
  sleep 3
  dump 2-home
  shot 2-home
  read -r HOME_X HOME_Y <<<"$(at centre 2-home OpenCham)"
fi

read -r HOME_X HOME_Y <<<"$(at centre 2-home OpenCham)"
if [ -z "${HOME_X:-}" ]; then
  echo "::error::the icon did not land on the workspace; labels: $(labels 2-home)"
  exit 1
fi
echo "workspace icon at ${HOME_X},${HOME_Y}"

# Press and hold in place: `input swipe` with identical start and end and a long duration.
adb shell input swipe "$HOME_X" "$HOME_Y" "$HOME_X" "$HOME_Y" 1500
sleep 3
dump 3-menu
shot 3-menu

read -r ACTION_X ACTION_Y <<<"$(at centre 3-menu 'New session')"
if [ -n "${ACTION_X:-}" ]; then
  echo "the launcher rendered the actions; tapping New session at ${ACTION_X},${ACTION_Y}"
  adb shell input tap "$ACTION_X" "$ACTION_Y"
else
  echo "::error::the long-press menu has no New session action; labels: $(labels 3-menu)"
  exit 1
fi
sleep 10
dump 4-new-session
shot 4-new-session

# A build-update banner can cover the top of the page; its close control is drawn by the page
# and is not in the dump, so it is dismissed by position.
if ! labels 4-new-session | grep -q 'update available'; then
  adb shell input tap "$((WIDTH - 31))" 148
  sleep 2
  dump 4-new-session-clean
  shot 4-new-session-clean
fi

RESUMED="$(adb shell dumpsys activity activities | tr -d '\r' | grep -E 'topResumedActivity|mResumedActivity' | head -1)"
echo "resumed: $RESUMED"
case "$RESUMED" in
  *"$PKG"*) echo "the shortcut brought the app to the foreground" ;;
  *) echo "::error::the shortcut did not bring the app to the foreground"; exit 1 ;;
esac

if labels 4-new-session | grep -qiE 'working on|New session'; then
  echo "the shortcut opened a new session draft"
else
  echo "::error::no draft on screen after the shortcut; labels: $(labels 4-new-session)"
  exit 1
fi
