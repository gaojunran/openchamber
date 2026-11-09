#!/usr/bin/env bash
# Drives the two Android entry points the way a user does, and keeps a screenshot of each step.
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

echo "--- what the placement test reported"
# The test logs its own decisions; run-as cannot read the app's files on this image.
adb shell logcat -d -v brief -s WidgetPlacement 2>/dev/null | tr -d '\r' | head -20 || true

echo "--- the screenshot the test published"
for name in openchamber-widget openchamber-widget-page openchamber-home \
            openchamber-widget-overview openchamber-widget-sessions openchamber-widget-quick-actions; do
  if adb pull "/sdcard/Pictures/$name.png" "$OUT/$name.png" >/dev/null 2>&1; then
    echo "pulled $name.png ($(wc -c < "$OUT/$name.png") bytes)"
  else
    echo "::warning::the test published no $name"
  fi
done
echo "--- what the launcher stored"
adb shell content query --uri content://com.android.launcher3.settings/favorites \
  --projection _id,screen,cellX,cellY,spanX,spanY,itemType,title 2>&1 | tr -d '\r' | head -20 || true

echo "--- the home screen the test left behind"
adb shell input keyevent KEYCODE_HOME
sleep 4
for page in 1 2 3; do
  dump "0-home-$page"
  shot "0-home-$page"
  echo "home page $page labels: $(labels "0-home-$page")"
  adb shell input swipe "$((WIDTH * 80 / 100))" "$((HEIGHT / 2))" "$((WIDTH * 20 / 100))" "$((HEIGHT / 2))" 300
  sleep 3
done
adb shell input keyevent KEYCODE_HOME
sleep 2

echo "--- install and connect"
echo "apk under test: $APK"
adb shell am start -W -n "$PKG/.MainActivity" >/dev/null
sleep 6
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

read -r EX EY <<<"$(at centre 1-qs-panel 'Edit tiles')"
if [ -z "${EX:-}" ]; then
  read -r EX EY <<<"$(at centre 1-qs-panel-2 'Edit tiles')"
fi
if [ -n "${EX:-}" ]; then
  adb shell input tap "$EX" "$EY"
  sleep 4
  dump 1-qs-edit
  shot 1-qs-edit
  echo "edit labels: $(labels 1-qs-edit)"
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
if in_app; then echo "the tile brought the app to the foreground"; else echo "::error::the tile did not open the app: $(foreground)"; fi
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

echo "--- open the widget picker"
adb shell input keyevent KEYCODE_HOME
sleep 3
adb shell input swipe "$((WIDTH / 2))" "$((HEIGHT / 2))" "$((WIDTH / 2))" "$((HEIGHT / 2))" 1500
sleep 3
dump 3-home-menu
shot 3-home-menu
read -r WX WY <<<"$(at exact 3-home-menu 'Widgets')"
if [ -z "${WX:-}" ]; then
  echo "::error::no Widgets entry on the home menu; labels: $(labels 3-home-menu)"
  exit 1
fi
adb shell input tap "$WX" "$WY"
sleep 4
dump 4-widget-picker
shot 4-widget-picker

echo "--- scroll the picker to OpenChamber"
for attempt in $(seq 1 8); do
  if labels 4-widget-picker | grep -qi 'OpenChamber'; then break; fi
  adb shell input swipe "$((WIDTH / 2))" "$((HEIGHT * 75 / 100))" "$((WIDTH / 2))" "$((HEIGHT * 35 / 100))" 300
  sleep 2
  dump 4-widget-picker
done
echo "picker labels: $(labels 4-widget-picker)"
read -r AW AY <<<"$(at centre 4-widget-picker OpenChamber)"
if [ -z "${AW:-}" ]; then
  echo "::warning::OpenChamber is not in this page of the widget picker; labels: $(labels 4-widget-picker)"
  exit 0
fi
adb shell input tap "$AW" "$AY"
sleep 4
dump 5-widget-previews
shot 5-widget-previews
echo "preview labels: $(labels 5-widget-previews)"

echo "--- back to the home screen"
adb shell input keyevent KEYCODE_HOME
sleep 4
dump 6-home-after
shot 6-home-after
echo "home labels: $(labels 6-home-after)"

echo "--- tile related logcat"
adb shell logcat -d -v brief 2>/dev/null | tr -d '\r' | grep -iE "openchamber|TileService|AndroidRuntime|FATAL" | head -20 || true

echo "--- bound widget instances"
adb shell dumpsys appwidget | tr -d '\r' | grep -E "openchamber|instanceId|bound" | head -15

echo "--- what the system knows about the widgets"
adb shell dumpsys appwidget | tr -d '\r' | grep -E "Provider|$PKG" | head -20
adb shell dumpsys package "$PKG" | tr -d '\r' | grep -iE "AppWidget|TileService" | head -10
