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

texts() {
  python3 - "$OUT/$1.xml" <<'PY'
import re, sys
xml = open(sys.argv[1], encoding='utf-8', errors='replace').read()
seen = []
for node in re.findall(r'<node[^>]*>', xml):
    for key in ('text', 'content-desc'):
        value = re.search(key + r'="([^"]*)"', node)
        if value and value.group(1).strip() and value.group(1) not in seen:
            seen.append(value.group(1))
print(' | '.join(seen[:40]))
PY
}

# "x y" centre of the first node whose label contains the text; empty when absent.
centre() {
  python3 - "$OUT/$1.xml" "$2" <<'PY'
import re, sys
xml = open(sys.argv[1], encoding='utf-8', errors='replace').read()
want = sys.argv[2].lower()
exact = want.startswith('=')
if exact:
    want = want[1:]
for node in re.findall(r'<node[^>]*>', xml):
    labels = []
    for key in ('text', 'content-desc'):
        value = re.search(key + r'="([^"]*)"', node)
        if value:
            labels.append(value.group(1))
    joined = ' '.join(labels).lower()
    if (want in joined) if not exact else (want in [label.lower() for label in labels]):
        bounds = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', node)
        if bounds:
            x1, y1, x2, y2 = map(int, bounds.groups())
            print((x1 + x2) // 2, (y1 + y2) // 2)
            break
PY
}

echo "--- install and launch"
adb install -r -g "$APK" >/dev/null
adb shell am start -W -n "$PKG/.MainActivity" >/dev/null
sleep 8
dump 0-launch
shot 0-launch

echo "--- what the system knows about the shortcuts"
adb shell dumpsys package "$PKG" | grep -iE "shortcut|android.app.shortcuts" | head -10 || true
adb shell dumpsys shortcut > "$OUT/dumpsys-shortcut.txt" 2>/dev/null || true
adb logcat -d -v time 2>/dev/null | grep -iE "shortcut" | tail -80 > "$OUT/logcat-shortcut.txt" || true
echo "saved dumpsys-shortcut.txt ($(wc -l < "$OUT/dumpsys-shortcut.txt") lines)"
echo "shortcut log lines: $(wc -l < "$OUT/logcat-shortcut.txt")"
grep -i "$PKG" "$OUT/dumpsys-shortcut.txt" | head -10 || true

echo "--- connect to $SERVER"
# The WebView paints after the activity is up, so the first dump can come back empty.
for _ in $(seq 1 20); do
  if texts 0-launch | grep -q 'Connect by address'; then break; fi
  sleep 3
  dump 0-launch
done
read -r CX CY <<<"$(centre 0-launch 'Connect by address')"
if [ -n "${CX:-}" ]; then
  adb shell input tap "$CX" "$CY"
  sleep 3
  dump 0-form
  read -r FX FY <<<"$(centre 0-form 'Server URL')"
  if [ -z "${FX:-}" ]; then
    read -r FX FY <<<"$(python3 - "$OUT/0-form.xml" <<'PY'
import re, sys
xml = open(sys.argv[1], encoding='utf-8', errors='replace').read()
for node in re.findall(r'<node[^>]*>', xml):
    if 'EditText' in node:
        b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', node)
        if b:
            x1, y1, x2, y2 = map(int, b.groups())
            print((x1 + x2) // 2, (y1 + y2) // 2)
            break
PY
)"
  fi
  if [ -n "${FX:-}" ]; then
    adb shell input tap "$FX" "$FY"
    sleep 2
    adb shell input text "$(echo "$SERVER" | sed 's#/#\\/#g')"
    sleep 2
    dump 0-filled
    shot 0-filled
    # The form has its own Connect button; Return only dismisses the keyboard.
    read -r BTN_X BTN_Y <<<"$(centre 0-filled '=Connect')"
    if [ -n "${BTN_X:-}" ]; then
      adb shell input tap "$BTN_X" "$BTN_Y"
    else
      adb shell input keyevent 66
    fi
    for _ in $(seq 1 20); do
      sleep 3
      dump 0-connected
      if ! texts 0-connected | grep -q 'Connect by address'; then break; fi
    done
    shot 0-connected
    echo "after connect: $(texts 0-connected)"
  else
    echo "::warning::the manual connect form was not found; labels: $(texts 0-form)"
  fi
else
  echo "the app is already connected"
fi

echo "--- put the icon on the workspace"
adb shell input keyevent KEYCODE_HOME
sleep 3
adb shell input swipe "$((WIDTH / 2))" "$((HEIGHT * 85 / 100))" "$((WIDTH / 2))" "$((HEIGHT * 15 / 100))" 300
sleep 3
dump 1-drawer
shot 1-drawer

read -r ICON_X ICON_Y <<<"$(centre 1-drawer OpenCham)"
if [ -z "${ICON_X:-}" ]; then
  echo "::error::no OpenChamber icon in the app drawer; labels: $(texts 1-drawer)"
  exit 1
fi
echo "icon at ${ICON_X},${ICON_Y}"

# Drag it onto the workspace: a launcher only shows a static shortcut for a workspace icon.
adb shell input draganddrop "$ICON_X" "$ICON_Y" "$((WIDTH / 2))" "$((HEIGHT / 3))" 1500
sleep 4
adb shell input keyevent KEYCODE_HOME
sleep 3
dump 2-home
shot 2-home

read -r HOME_X HOME_Y <<<"$(centre 2-home OpenCham)"
if [ -z "${HOME_X:-}" ]; then
  echo "::error::the icon did not land on the workspace; labels: $(texts 2-home)"
  exit 1
fi
echo "workspace icon at ${HOME_X},${HOME_Y}"

# Press and hold in place: `input swipe` with identical start and end and a long duration.
adb shell input swipe "$HOME_X" "$HOME_Y" "$HOME_X" "$HOME_Y" 1500
sleep 3
dump 3-menu
shot 3-menu

read -r ACTION_X ACTION_Y <<<"$(centre 3-menu 'New session')"
if [ -n "${ACTION_X:-}" ]; then
  echo "the launcher rendered the actions; tapping New session at ${ACTION_X},${ACTION_Y}"
  adb shell input tap "$ACTION_X" "$ACTION_Y"
else
  # The AOSP launcher in the emulator image renders only "App info", so the tap is replaced by
  # the intent the shortcut carries. The declaration itself is asserted by LauncherShortcutsTest.
  echo "::warning::the launcher did not render the actions (labels: $(texts 3-menu)); launching the shortcut intent instead"
  adb shell am start -a android.intent.action.VIEW -d "openchamber://new-session" >/dev/null
fi
sleep 10
dump 4-new-session
shot 4-new-session

RESUMED="$(adb shell dumpsys activity activities | tr -d '\r' | grep -E 'topResumedActivity|mResumedActivity' | head -1)"
echo "resumed: $RESUMED"
case "$RESUMED" in
  *"$PKG"*) echo "the shortcut brought the app to the foreground" ;;
  *) echo "::error::the shortcut did not bring the app to the foreground"; exit 1 ;;
esac

if texts 4-new-session | grep -qi 'working on'; then
  echo "the shortcut opened a new session draft"
else
  echo "::warning::no draft on screen after the shortcut; labels: $(texts 4-new-session)"
fi
