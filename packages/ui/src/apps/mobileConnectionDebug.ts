// In-memory capture of mobile connection lifecycle events, so device-only
// connection failures (Capacitor iOS/Android) can be diagnosed without a
// tethered debugger: the hidden debug panel renders this buffer and offers a
// one-tap copy for bug reports. Console logging stays the primary sink — this
// mirrors it. Never persisted; details are the already-masked logConnect
// payloads (no tokens or secrets reach this module).
//
// The same buffer also carries coarse cold-launch phase marks (boot, fonts,
// auto-connect, initializeApp, session restore, overlay release). Each entry
// records `performance.now()`, i.e. milliseconds since the webview navigation
// started, so a native cold launch and a mobile-web one can be compared on the
// same axis and the per-phase deltas read straight off the panel.

import React from 'react';

type MobileConnectDebugEntry = {
  at: number;
  /** performance.now() at record time: ms since the webview navigation started. */
  t: number;
  step: string;
  detail: string;
};

const MAX_ENTRIES = 300;
// The trail documents THE CURRENT app run only — it resets on every launch.
// Days of accumulated history would bury the failure the panel exists to
// expose. (An earlier revision persisted the log across launches; the storage
// key is removed here so installs that ran it don't keep a stale blob around.)
const LEGACY_STORAGE_KEY = 'openchamber.mobile.connectLog.v1';

const entries: MobileConnectDebugEntry[] = [];

const elapsedSinceNavigation = (): number =>
  typeof performance !== 'undefined' ? Math.round(performance.now()) : 0;

if (typeof window !== 'undefined') {
  try {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Storage unavailable — the in-memory trail still works.
  }
}

export const recordMobileConnectDebug = (step: string, detail: string): void => {
  entries.push({ at: Date.now(), t: elapsedSinceNavigation(), step, detail });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
};

/**
 * Coarse cold-launch phase mark. Cheap (array push, no state, no persistence),
 * so it can stay on in production and is the primary way to attribute the
 * pre-chat wait on a device without a tethered debugger.
 */
export const markStartupPhase = (step: string, detail?: string): void => {
  recordMobileConnectDebug(step, detail ?? '{}');
};

// Launch separator: makes "everything above happened in a previous run of the
// app" readable at a glance in the persisted trail.
if (typeof window !== 'undefined') {
  recordMobileConnectDebug('app:launch', '{}');
}

export const getMobileConnectDebugEntries = (): MobileConnectDebugEntry[] => [...entries];

const formatTime = (at: number): string => {
  const date = new Date(at);
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
};

export const formatMobileConnectDebugEntry = (
  entry: MobileConnectDebugEntry,
  previous?: MobileConnectDebugEntry,
): string => {
  const delta = previous ? entry.t - previous.t : entry.t;
  const stamp = previous ? `+${entry.t}ms (Δ${delta})` : `+${entry.t}ms`;
  return `${formatTime(entry.at)} ${stamp} ${entry.step}${entry.detail && entry.detail !== '{}' ? ` ${entry.detail}` : ''}`;
};

export const getMobileConnectDebugText = (): string =>
  entries.map((entry, index) => formatMobileConnectDebugEntry(entry, entries[index - 1])).join('\n');

// Read the trail from a Web Inspector console (mobile web / any browser) where
// the native long-press panel is unavailable. No console noise by itself.
if (typeof window !== 'undefined') {
  (window as typeof window & { __OPENCHAMBER_CONNECT_DEBUG__?: () => string }).__OPENCHAMBER_CONNECT_DEBUG__ =
    getMobileConnectDebugText;
}

// Long-press detector for the hidden debug-panel triggers. Pointer-based with a
// movement threshold so scrolling and normal taps never fire it; the synthetic
// click that follows a long-press release is swallowed in the capture phase so
// the host element's normal tap action does not also run.
export const useDebugPanelLongPress = (onLongPress: () => void, delayMs = 700) => {
  const timerRef = React.useRef<number | null>(null);
  const originRef = React.useRef<{ x: number; y: number } | null>(null);
  const firedRef = React.useRef(false);

  const clear = React.useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    originRef.current = null;
  }, []);

  React.useEffect(() => clear, [clear]);

  const onPointerDown = React.useCallback((event: React.PointerEvent) => {
    firedRef.current = false;
    originRef.current = { x: event.clientX, y: event.clientY };
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      firedRef.current = true;
      onLongPress();
    }, delayMs);
  }, [delayMs, onLongPress]);

  const onPointerMove = React.useCallback((event: React.PointerEvent) => {
    const origin = originRef.current;
    if (!origin) return;
    if (Math.abs(event.clientX - origin.x) > 10 || Math.abs(event.clientY - origin.y) > 10) clear();
  }, [clear]);

  const onClickCapture = React.useCallback((event: React.MouseEvent) => {
    if (!firedRef.current) return;
    firedRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: clear,
    onPointerCancel: clear,
    onClickCapture,
  };
};
