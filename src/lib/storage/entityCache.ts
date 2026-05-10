/**
 * Persistent localStorage cache for Data Inspector entity rows.
 *
 * - One cache slot per entity set (key: `tyro:dv:<entitySet>`)
 * - Stores `{ fetchedAt, value, totalCount? }`
 * - "Verileri Güncelle" overwrites the slot
 * - Survives page reloads — user sees last-fetched data instantly on reopen
 * - 5MB browser quota limit per origin → graceful degradation on quota error
 *
 * After every successful write a same-tab `tyro:cache-updated` CustomEvent
 * fires (window-scoped) so subscribers (`useCacheFingerprint` etc.) can
 * re-derive without waiting for the next render. Cross-tab updates are
 * still covered by the native `storage` event.
 */

const KEY_PREFIX = "tyro:dv:";

/** Custom event fired on the window after a successful cache write.
 *  Same-tab `localStorage.setItem` does NOT fire the native `storage`
 *  event, so consumers listen to this instead. */
export const CACHE_UPDATED_EVENT = "tyro:cache-updated";

export interface CacheUpdatedDetail {
  entitySet: string;
}

function dispatchCacheUpdated(entitySet: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<CacheUpdatedDetail>(CACHE_UPDATED_EVENT, {
      detail: { entitySet },
    })
  );
}

export interface EntityCacheEntry<T = Record<string, unknown>> {
  /** ISO timestamp when this snapshot was captured */
  fetchedAt: string;
  /** Raw rows */
  value: T[];
  /** Server-reported total (may be undefined if `$count` wasn't requested) */
  totalCount?: number;
}

function key(entitySet: string): string {
  return `${KEY_PREFIX}${entitySet}`;
}

export function readCache<T = Record<string, unknown>>(
  entitySet: string
): EntityCacheEntry<T> | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(key(entitySet));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as EntityCacheEntry<T>;
    if (!parsed?.fetchedAt || !Array.isArray(parsed.value)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeCache<T = Record<string, unknown>>(
  entitySet: string,
  entry: EntityCacheEntry<T>
): { ok: boolean; reason?: string } {
  if (typeof localStorage === "undefined") {
    return { ok: false, reason: "no-localStorage" };
  }
  const k = key(entitySet);
  const payload = JSON.stringify(entry);
  try {
    localStorage.setItem(k, payload);
    dispatchCacheUpdated(entitySet);
    return { ok: true };
  } catch (err) {
    // QuotaExceededError. Try evicting OUR own entry for this entity
    // (might be a stale large payload from a wider $select) and retry
    // once — keeps other entities intact.
    //
    // We deliberately do NOT cross-evict OTHER `tyro:dv:*` entries on
    // quota exhaustion, because in a refresh chain that turns into
    // musical chairs: a later step displaces the cache another tab
    // is still using. Big entities (granular distribution lines etc.)
    // should be moved to per-project on-demand fetches instead of
    // being kept in the global cache.
    const firstReason = err instanceof Error ? err.name : "unknown";
    try {
      localStorage.removeItem(k);
      localStorage.setItem(k, payload);
      dispatchCacheUpdated(entitySet);
      return { ok: true };
    } catch (err2) {
      // Still no room — accept that this entity won't persist. The fetched
      // rows are still in React state for the current session via the
      // cache-updated event path. Console.warn so DevTools surfaces it.
      const reason2 = err2 instanceof Error ? err2.name : firstReason;
      // eslint-disable-next-line no-console
      console.warn(
        `[entityCache] localStorage write failed for ${entitySet}: ${reason2}. Data is in-session only.`
      );
      return { ok: false, reason: reason2 };
    }
  }
}

export function clearCache(entitySet: string): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(key(entitySet));
  // Same-tab consumers listening on the custom event need to know the
  // slot is gone — without this dispatch, a hook reading via the
  // fingerprint pattern would stay stale until the next page reload.
  dispatchCacheUpdated(entitySet);
}

export function clearAllCaches(): void {
  if (typeof localStorage === "undefined") return;
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(KEY_PREFIX)) keysToRemove.push(k);
  }
  for (const k of keysToRemove) localStorage.removeItem(k);
}

/** All cached entity sets and their `fetchedAt` timestamps — for diagnostics. */
export function listCacheSnapshots(): Array<{
  entitySet: string;
  fetchedAt: string;
  count: number;
}> {
  if (typeof localStorage === "undefined") return [];
  const out: Array<{ entitySet: string; fetchedAt: string; count: number }> = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(KEY_PREFIX)) continue;
    try {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as EntityCacheEntry;
      out.push({
        entitySet: k.slice(KEY_PREFIX.length),
        fetchedAt: parsed.fetchedAt,
        count: parsed.value?.length ?? 0,
      });
    } catch {
      // skip
    }
  }
  return out.sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt));
}
