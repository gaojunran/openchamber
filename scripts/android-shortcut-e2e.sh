#!/usr/bin/env bash
# Drives the launcher shortcut on a running emulator the way a user does, and keeps a screenshot
# of every step. Host-side on purpose: `adb exec-out screencap` is the only way to get the pixels
# out of the emulator reliably, and the files it produces are the evidence attached to the PR.
set -u

PKG=com.openchamber.app
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

# Centre of the node whose text or content-desc matches, as "x y"; empty when absent.
locate() {
  python3 - "$OUT/$1.xml" "$2" <<'PY'
import re, sys
xml = open(sys.argv[1], encoding='utf-8', errors='replace').read()
want = sys.argv[2].lower()
for node in re.findall(r'<node[^>]*>', xml):
    text = re.search(r'text="([^"]*)"', node)
    desc = re.search(r'content-desc="([^"]*)"', node)
    label = ((text.group(1) if text else '') + ' ' + (desc.group(1) if desc else '')).strip()
    if want in label.lower():
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

adb shell am force-stop "$PKG" >/dev/null 2>&1
adb shell input keyevent KEYCODE_HOME
sleep 3
shot 0-home

# The all-apps view holds every installed app; the launcher opens it with an upward swipe.
adb shell input swipe "$((WIDTH / 2))" "$((HEIGHT * 85 / 100))" "$((WIDTH / 2))" "$((HEIGHT * 15 / 100))" 300
sleep 3
dump 1-drawer
shot 1-drawer

read -r ICON_X ICON_Y <<<"$(locate 1-drawer OpenChamber)"
if [ -z "${ICON_X:-}" ]; then
  echo "::error::no OpenChamber icon in the app drawer; visible labels: $(texts 1-drawer)"
  exit 1
fi
echo "icon at ${ICON_X},${ICON_Y}"

# Press and hold in place: `input swipe` with identical start and end and a long duration.
adb shell input swipe "$ICON_X" "$ICON_Y" "$ICON_X" "$ICON_Y" 1500
sleep 3
dump 2-menu
shot 2-menu

read -r ACTION_X ACTION_Y <<<"$(locate 2-menu 'New session')"
if [ -z "${ACTION_X:-}" ]; then
  echo "::error::the long-press menu has no New session action; labels: $(texts 2-menu)"
  exit 1
fi
echo "action at ${ACTION_X},${ACTION_Y}"

adb shell input tap "$ACTION_X" "$ACTION_Y"
sleep 6
shot 3-new-session

RESUMED="$(adb shell dumpsys activity activities | tr -d '\r' | grep -E 'topResumedActivity|mResumedActivity' | head -1)"
echo "resumed: $RESUMED"
case "$RESUMED" in
  *"$PKG"*) echo "the shortcut brought the app to the foreground" ;;
  *) echo "::error::the shortcut did not bring the app to the foreground"; exit 1 ;;
esac
