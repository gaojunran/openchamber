// Host resolution for notification routing. A notification names the runtime
// that owns its session; the desktop shell resolves that runtime to a host
// entry so a click can open the session on the owning instance instead of the
// currently active one.

const HOST_RUNTIME_KEY_PREFIX = 'host:';
const URL_RUNTIME_KEY_PREFIX = 'url:';

// The id doubles as the host-window tag (main.mjs __ocHostWindowId), so a
// local-instance window is reused like any host window.
const LOCAL_HOST_ENTRY_ID = 'local';

// Mirrors the renderer's runtime key normalization (runtime-switch.ts) so a
// URL-bound window's key can be matched back to the host entry its API URL
// came from: hash and search stripped, trailing slash removed, 'url:' prefix.
const runtimeKeyForHostUrl = (raw) => {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    url.hash = '';
    url.search = '';
    return `${URL_RUNTIME_KEY_PREFIX}${url.toString().replace(/\/+$/, '')}`;
  } catch {
    return '';
  }
};

export const resolveHostEntryForRuntimeKey = (rawKey, { hosts, localUrl, localClientToken }) => {
  const key = typeof rawKey === 'string' ? rawKey.trim() : '';
  if (!key) return null;
  if (key === LOCAL_HOST_ENTRY_ID) {
    // Without a local server (e.g. skip-local-server desktop) there is no
    // local instance to route to.
    if (!localUrl) return null;
    return { id: LOCAL_HOST_ENTRY_ID, url: localUrl, clientToken: localClientToken || '', requestHeaders: {} };
  }
  if (key.startsWith(HOST_RUNTIME_KEY_PREFIX)) {
    const hostId = key.slice(HOST_RUNTIME_KEY_PREFIX.length);
    return (Array.isArray(hosts) ? hosts : []).find((entry) => entry?.id === hostId) || null;
  }
  if (key.startsWith(URL_RUNTIME_KEY_PREFIX)) {
    // Windows that bind a host API URL without a host tag of their own (a
    // mini-chat bound to a host session) name their runtime in this form;
    // match it back to the host entry the URL belongs to.
    return (Array.isArray(hosts) ? hosts : []).find((entry) => runtimeKeyForHostUrl(entry?.apiUrl || entry?.url) === key) || null;
  }
  return null;
};

// A forwarded notification must name the owning runtime in the resolver's
// vocabulary ('local' | 'host:<id>'). The forwarding window's own tag is
// authoritative: a direct host window's renderer computes an unroutable
// 'url:<origin>' key or inherits a stale one, while the shell knows which
// host the window was opened for. Windows without a host tag (the primary
// window) keep the renderer-provided key, which tracks in-place switches.
export const resolveForwardedNotificationRuntimeKey = ({ runtimeKey, hostWindowId }) => {
  const hostId = typeof hostWindowId === 'string' ? hostWindowId.trim() : '';
  if (hostId) return `${HOST_RUNTIME_KEY_PREFIX}${hostId}`;
  return typeof runtimeKey === 'string' ? runtimeKey.trim() : '';
};

// Flattens a desktop notification input: the UI IPC path wraps fields in
// { payload: {...} }, other paths are flat. Nested payload fields win over
// top-level ones.
export const normalizeNotificationInput = (raw) => {
  if (!raw || typeof raw !== 'object') return {};
  if (raw.payload && typeof raw.payload === 'object') {
    return { ...raw, ...raw.payload };
  }
  return raw;
};

// Builds the notification input for a renderer-forwarded desktop_notify:
// flatten the wrapped payload, strip the nested copy, and stamp the runtime
// key with the forwarding window's tag taking precedence. Stripping the
// nested payload matters: maybeShowNativeNotification normalizes again, and
// a surviving nested runtimeKey would shadow the stamp.
export const stampForwardedNotification = (rawInput, hostWindowId) => {
  const { payload: _nested, ...flat } = normalizeNotificationInput(rawInput);
  return {
    ...flat,
    runtimeKey: resolveForwardedNotificationRuntimeKey({
      runtimeKey: typeof flat.runtimeKey === 'string' ? flat.runtimeKey : undefined,
      hostWindowId,
    }),
  };
};
