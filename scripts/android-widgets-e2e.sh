#!/usr/bin/env bash
# Drives the Quick Settings tile the way a user does, and keeps a screenshot of each step.
set -uo pipefail

PKG=com.openchamber.app
TILE="$PKG/.NewSessionTileService"
APK=${1:-android/app/build/outputs/apk/debug/app-debug.apk}
SERVER=${E2E_SERVER_URL:-http://10.0.2.2:4123}
OUT="${RUNNER_TEMP:-/tmp}/android-evidence"
SELECTOR="$(cd "$(dirname "$0")" && pwd)/ui-centre.py"
mkdir -p "$OUT"

read -r WIDTH HEIGHT <<<"$(adb shell wm size | tr -d '\r' | sed 's/.*: //; s/x/ /')"
echo "display: ${WIDTH}x${HEIGHT}"

dump() {
  local out
  out=$(adb shell uiautomator dump /sdcard/ui.xml 2>&1 | tr -d '\r')
  case "$out" in
    *"dumped to"*) ;;
    *) echo "dump $1 failed: $out" ;;
  esac
  adb pull /sdcard/ui.xml "$OUT/$1.xml" >/dev/null 2>&1 || echo "pull $1 failed"
}
shot() { adb exec-out screencap -p > "$OUT/$1.png"; echo "captured $1.png ($(wc -c < "$OUT/$1.png") bytes)"; }
labels() { python3 "$SELECTOR" labels "$OUT/$1.xml"; }
at() { python3 "$SELECTOR" "$1" "$OUT/$2.xml" "${3:-}"; }
foreground() { adb shell dumpsys activity activities | tr -d '\r' | grep -E 'topResumedActivity' | head -1; }
in_app() { case "$(foreground)" in *"$PKG"*) return 0;; *) return 1;; esac; }
draft_visible() { labels "$1" | grep -qiE 'working on|New session'; }

connect() {
  dump 0-launch
  for _ in $(seq 1 20); do
    if labels 0-launch | grep -q 'Connect by address'; then break; fi
    sleep 3
    dump 0-launch
  done
  read -r CX CY <<<"$(at centre 0-launch 'Connect by address')"
  [ -n "${CX:-}" ] || { echo "the app is already connected"; return 0; }
  adb shell input tap "$CX" "$CY"
  sleep 3
  dump 0-form
  read -r FX FY <<<"$(at first-input 0-form)"
  [ -n "${FX:-}" ] || { echo "::error::no URL field; labels: $(labels 0-form)"; return 1; }
  adb shell input tap "$FX" "$FY"
  sleep 2
  adb shell input text "$(echo "$SERVER" | sed 's#/#\\/#g')"
  sleep 2
  adb shell input keyevent 4
  sleep 1
  for _ in $(seq 1 4); do
    read -r BX BY <<<"$(at exact 0-filled 'Connect')"
    [ -n "${BX:-}" ] && break
    adb shell input swipe "$((WIDTH / 2))" "$((HEIGHT * 78 / 100))" "$((WIDTH / 2))" "$((HEIGHT * 30 / 100))" 300
    sleep 2
    dump 0-filled
  done
  [ -n "${BX:-}" ] || { echo "::error::no Connect button; labels: $(labels 0-filled)"; return 1; }
  adb shell input tap "$BX" "$BY"
  for _ in $(seq 1 20); do
    sleep 3
    dump 0-connected
    if ! labels 0-connected | grep -q 'Connect by address'; then break; fi
  done
  shot 0-connected
  echo "after connect: $(labels 0-connected)"
}

echo "--- install and connect"
echo "apk under test: $APK"
# connectedDebugAndroidTest uninstalls both APKs when it finishes, so install the app again
# before anything reads the system's view of its tile service.
adb install -r "$APK" || { echo "::error::could not install the debug APK"; exit 1; }
adb shell am start -W -n "$PKG/.MainActivity" >/dev/null
sleep 6
if ! in_app; then echo "::error::the app did not come to the foreground: $(foreground)"; exit 1; fi
connect || exit 1

echo "--- add the Quick Settings tile"
echo "tiles before: $(adb shell settings get secure sysui_qs_tiles | tr -d '\r')"
adb shell cmd statusbar add-tile "$TILE" 2>&1 | tr -d '\r'
sleep 2
echo "tiles after:  $(adb shell settings get secure sysui_qs_tiles | tr -d '\r')"
# SystemUI reads the tile list when it starts; restarting it is what puts a tile added
# after boot into the panel.
# The shell user may write secure settings on a debuggable image; no adb root needed.
adb shell "settings put secure sysui_qs_tiles 'custom(com.openchamber.app/.NewSessionTileService),internet,bt,flashlight,dnd,alarm'" 2>&1 | tr -d '\r'
sleep 4
echo "tiles now: $(adb shell settings get secure sysui_qs_tiles | tr -d '\r')"
adb shell cmd statusbar expand-settings >/dev/null 2>&1
sleep 5
dump 1-qs-panel
shot 1-qs-panel
echo "qs labels: $(labels 1-qs-panel)"
echo "--- tile binding log"
adb shell logcat -d -v brief 2>/dev/null | tr -d '\r' | grep -iE "TileService|QSTile|openchamber" | tail -30 || true
# The panel scrolls; the new tile can sit on the second page.
adb shell input swipe "$((WIDTH / 2))" "$((HEIGHT * 70 / 100))" "$((WIDTH / 2))" "$((HEIGHT * 25 / 100))" 300
sleep 2
dump 1-qs-panel-2
shot 1-qs-panel-2
echo "qs page 2 labels: $(labels 1-qs-panel-2)"
case "$(labels 1-qs-panel)" in
  *"New session"*) echo "the panel shows the tile" ;;
  *) echo "::warning::the tile is not in the visible panel; opening the edit screen" ;;
esac

echo "--- add the tile the way a user does, in the panel's editor"
read -r EX EY <<<"$(at centre 1-qs-panel 'Edit order of settings.')"
[ -z "${EX:-}" ] && read -r EX EY <<<"$(at centre 1-qs-panel 'Edit tiles')"
[ -z "${EX:-}" ] && read -r EX EY <<<"$(at centre 1-qs-panel-2 'Edit tiles')"
if [ -n "${EX:-}" ]; then
  adb shell input tap "$EX" "$EY"
  sleep 4
  dump 1-qs-edit
  shot 1-qs-edit
  echo "edit labels: $(labels 1-qs-edit)"
  read -r AX AY <<<"$(at centre 1-qs-edit 'New session')"
  [ -z "${AX:-}" ] && read -r AX AY <<<"$(at centre 1-qs-edit 'OpenChamber')"
  if [ -z "${AX:-}" ]; then
    echo "--- scroll the add-tiles list"
    for attempt in $(seq 1 6); do
      adb shell input swipe "$((WIDTH / 2))" "$((HEIGHT * 78 / 100))" "$((WIDTH / 2))" "$((HEIGHT * 35 / 100))" 300
      sleep 2
      dump 1-qs-edit-scrolled
      read -r AX AY <<<"$(at centre 1-qs-edit-scrolled 'New session')"
      [ -z "${AX:-}" ] && read -r AX AY <<<"$(at centre 1-qs-edit-scrolled 'OpenChamber')"
      [ -n "${AX:-}" ] && break
    done
    shot 1-qs-edit-scrolled
    echo "scrolled labels: $(labels 1-qs-edit-scrolled)"
  fi
  if [ -n "${AX:-}" ]; then
    adb shell input tap "$AX" "$AY"
    sleep 3
    dump 1-qs-edit-added
    shot 1-qs-edit-added
    echo "after adding: $(labels 1-qs-edit-added)"
  else
    echo "::warning::the editor does not list the tile; labels: $(labels 1-qs-edit)"
  fi
  read -r DX DY <<<"$(at exact 1-qs-edit 'Done')"
  [ -z "${DX:-}" ] && read -r DX DY <<<"$(at exact 1-qs-edit 'Save')"
  if [ -n "${DX:-}" ]; then
    adb shell input tap "$DX" "$DY"
    sleep 3
  fi
  adb shell cmd statusbar collapse >/dev/null 2>&1
  sleep 2
  adb shell cmd statusbar expand-settings >/dev/null 2>&1
  sleep 3
  dump 1-qs-panel-added
  shot 1-qs-panel-added
  echo "panel after adding: $(labels 1-qs-panel-added)"
else
  echo "::warning::no edit control in the panel; labels: $(labels 1-qs-panel)"
fi
adb shell cmd statusbar collapse >/dev/null 2>&1
sleep 1

echo "--- click the tile through the system"
adb shell input keyevent KEYCODE_HOME
sleep 3
adb shell am force-stop "$PKG" >/dev/null 2>&1
sleep 2
adb shell logcat -c >/dev/null 2>&1 || true
adb shell cmd statusbar click-tile "$TILE" 2>&1 | tr -d '\r'
sleep 6
if in_app; then echo "the tile brought the app to the foreground"; else echo "::warning::the tile did not open the app: $(foreground)"; fi
# The WebView only exposes its text once the page has painted.
for _ in $(seq 1 12); do
  dump 2-tile-draft
  if [ -n "$(labels 2-tile-draft)" ]; then break; fi
  sleep 4
done
shot 2-tile-draft
if draft_visible 2-tile-draft; then
  echo "the tile opened a new session draft"
else
  echo "::warning::the draft is not on screen after the tile; labels: $(labels 2-tile-draft)"
fi

echo "--- fall back to the exact intent the tile sends"
# This checks the routing the tile depends on when SystemUI will not dispatch the tile itself.
adb shell am force-stop "$PKG" >/dev/null 2>&1
sleep 2
echo "am start: $(adb shell am start -W -a android.intent.action.VIEW -d "openchamber://new-session" -n "$PKG/.MainActivity" 2>&1 | tr -d '\r' | tr '\n' ' ')"
sleep 8
for _ in $(seq 1 10); do
  dump 2-intent-draft
  if draft_visible 2-intent-draft; then break; fi
  sleep 4
done
shot 2-intent-draft
if draft_visible 2-intent-draft; then
  echo "the tile's deep link opened a new session draft"
else
  echo "::warning::no draft from the tile's deep link; labels: $(labels 2-intent-draft)"
fi

echo "--- tile related logcat"
adb shell logcat -d -v brief 2>/dev/null | tr -d '\r' | grep -iE "openchamber|TileService|AndroidRuntime|FATAL" | head -20 || true

echo "--- what the system knows about the tile"
adb shell dumpsys package "$PKG" | tr -d '\r' | grep -iE -B2 -A8 "NewSessionTileService" | head -30 || true
echo "--- the APK's own manifest"
AAPT=$(ls "${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/usr/local/lib/android/sdk}}"/build-tools/*/aapt2 2>/dev/null | tail -1)
"$AAPT" dump xmltree "$APK" --file AndroidManifest.xml 2>&1 | grep -iE -B3 -A12 "NewSessionTileService" | head -40 || true
echo "--- statusbar's view of the tiles"
adb shell cmd statusbar help 2>&1 | tr -d '\r' | head -20 || true
adb shell dumpsys statusbar 2>/dev/null | tr -d '\r' | grep -iE "tile|openchamber" | head -20 || true
