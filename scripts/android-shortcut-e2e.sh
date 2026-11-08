#!/usr/bin/env bash
# Drives the launcher shortcut on a running emulator the way a user does, and keeps a screenshot
# of every step. Host-side on purpose: `adb exec-out screencap` is the only reliable way to get the
# pixels out of the emulator, and the files it produces are attached to the PR as evidence.
set -uo pipefail

PKG=com.openchamber.app
APK=${1:-packages/mobile/android/app/build/outputs/apk/debug/app-debug.apk}
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

# Centre of the first node whose text or content-desc matches, as "x y"; empty when absent.
locate() {
  python3 - "$OUT/$1.xml" "$2" <<'PY'
import re, sys
xml = open(sys.argv[1], encoding='utf-8', errors='replace').read()
want = sys.argv[2].lower()
for node in re.findall(r'<node[^>]*>', xml):
    parts = []
    for key in ('text', 'content-desc'):
        value = re.search(key + r'="([^"]*)"', node)
        if value:
            parts.append(value.group(1))
    if want in ' '.join(parts).lower():
        bounds = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', node)
        if bounds:
            x1, y1, x2, y2 = map(int, bounds.groups())
            print((x1 + x2) // 2, (y1 + y2) // 2)
            break
PY
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

tapText() {
  dump "$2-candidate"
  read -r X Y <<<"$(locate "$2-candidate" "$1")"
  if [ -z "${X:-}" ]; then
    echo "not on screen: $1 -> $(texts "$2-candidate")"
    return 1
  fi
  adb shell input tap "$X" "$Y"
  return 0
}

echo "--- install and launch"
adb install -r -g "$APK" >/dev/null
adb shell am start -W -n "$PKG/.MainActivity" >/dev/null
sleep 6
dump 0-launch
shot 0-launch

echo "--- connect to $SERVER"
if tapText "Connect by address" 0-connect; then
  sleep 2
  dump 0-form
  read -r FX FY <<<"$(locate 0-form 'Server URL')"
  if [ -z "${FX:-}" ]; then
    # The label sits over the input, so the form's only editable node is the fallback.
    FX=$(python3 - "$OUT/0-form.xml" <<'PY'
import re, sys
xml = open(sys.argv[1], encoding='utf-8', errors='replace').read()
for node in re.findall(r'<node[^>]*>', xml):
    if 'class="android.widget.EditText"' in node:
        b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', node)
        if b:
            x1, y1, x2, y2 = map(int, b.groups())
            print((x1 + x2) // 2)
            break
PY
)
    FY=$(python3 - "$OUT/0-form.xml" <<'PY'
import re, sys
xml = open(sys.argv[1], encoding='utf-8', errors='replace').read()
for node in re.findall(r'<node[^>]*>', xml):
    if 'class="android.widget.EditText"' in node:
        b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', node)
        if b:
            x1, y1, x2, y2 = map(int, b.groups())
            print((y1 + y2) // 2)
            break
PY
)
  fi
  if [ -n "${FX:-}" ]; then
    adb shell input tap "$FX" "$FY"
    sleep 1
    adb shell input text "$(echo "$SERVER" | sed 's#/#\\/#g')"
    sleep 1
    adb shell input keyevent 66
    sleep 12
    dump 0-connected
    shot 0-connected
    echo "after connect: $(texts 0-connected)"
  else
    echo "::warning::the manual connect form was not found"
  fi
fi

echo "--- home, then the app icon"
adb shell input keyevent KEYCODE_HOME
sleep 3
shot 1-home

# The launcher opens the all-apps view with an upward swipe.
adb shell input swipe "$((WIDTH / 2))" "$((HEIGHT * 85 / 100))" "$((WIDTH / 2))" "$((HEIGHT * 15 / 100))" 300
sleep 3
dump 2-drawer
shot 2-drawer

read -r ICON_X ICON_Y <<<"$(locate 2-drawer OpenChamber)"
if [ -z "${ICON_X:-}" ]; then
  echo "::error::no OpenChamber icon in the app drawer; visible labels: $(texts 2-drawer)"
  exit 1
fi
echo "icon at ${ICON_X},${ICON_Y}"

# Press and hold in place: `input swipe` with identical start and end and a long duration.
adb shell input swipe "$ICON_X" "$ICON_Y" "$ICON_X" "$ICON_Y" 1500
sleep 3
dump 3-menu
shot 3-menu

read -r ACTION_X ACTION_Y <<<"$(locate 3-menu 'New session')"
if [ -z "${ACTION_X:-}" ]; then
  echo "::error::the long-press menu has no New session action; labels: $(texts 3-menu)"
  exit 1
fi
echo "action at ${ACTION_X},${ACTION_Y}"
read -r ATTENTION_X ATTENTION_Y <<<"$(locate 3-menu 'Needs attention')"
if [ -z "${ATTENTION_X:-}" ]; then
  echo "::error::the long-press menu has no Needs attention action; labels: $(texts 3-menu)"
  exit 1
fi
echo "attention at ${ATTENTION_X},${ATTENTION_Y}"

adb shell input tap "$ACTION_X" "$ACTION_Y"
sleep 8
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
