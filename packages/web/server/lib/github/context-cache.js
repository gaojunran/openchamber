export function createPRContextCache(ttlMs, maxEntries) {
  const entries = new Map();
  let epoch = 0;
  return Object.freeze({
    begin: () => epoch,
    read: (key, includeCheckDetails) => {
      const entry = entries.get(key);
      return entry && Date.now() - entry.fetchedAt < ttlMs && (entry.includeCheckDetails || !includeCheckDetails)
        ? entry.data
        : null;
    },
    store: (key, scope, data, includeCheckDetails, started) => {
      if (started !== epoch) return;
      entries.delete(key);
      entries.set(key, { data, includeCheckDetails, fetchedAt: data.fetchedAt, scope });
      if (entries.size > maxEntries) entries.delete(entries.keys().next().value);
    },
    invalidate: (scope) => {
      epoch += 1;
      for (const [key, entry] of entries) {
        if (Object.entries(scope).every(([field, value]) => entry.scope[field] === value)) entries.delete(key);
      }
    },
  });
}
