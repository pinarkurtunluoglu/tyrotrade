import * as React from "react";
import {
  CACHE_UPDATED_EVENT,
  readCache,
  type CacheUpdatedDetail,
} from "@/lib/storage/entityCache";
import {
  ACTUAL_EXPENSE_ROLLUP_CACHE,
} from "@/lib/dataverse/refreshAll";
import type { ActualExpenseRollupRow } from "@/lib/dataverse/actualExpenseRollup";

export interface UseActualExpenseRollupReturn {
  /** Flat realised-expense rollup rows (per projectNo × expenseId).
   *  Empty array when the cache hasn't been populated yet — the
   *  P&L Cost page should prompt the user to run "Verileri
   *  Güncelle" in that case. */
  rows: ActualExpenseRollupRow[];
  /** ISO timestamp of the most recent cache write, or null when
   *  the slot is missing. */
  fetchedAt: string | null;
  /** True when the cache slot doesn't exist or carries no rows. */
  isEmpty: boolean;
}

/**
 * 🔒 Read-only hook — exposes the tenant-wide realised-expense
 * rollup written by the "Gerçekleşen Gider Toplamları" refresh step.
 *
 * Listens for the same `tyro:cache-updated` events as
 * `useRealProjects` so the P&L Cost page re-derives whenever the
 * rollup gets rewritten (manual refresh, post-login auto-refresh).
 */
export function useActualExpenseRollup(): UseActualExpenseRollupReturn {
  const fingerprint = useCacheFingerprint(ACTUAL_EXPENSE_ROLLUP_CACHE);

  return React.useMemo<UseActualExpenseRollupReturn>(() => {
    const cached = readCache<ActualExpenseRollupRow>(
      ACTUAL_EXPENSE_ROLLUP_CACHE
    );
    const rows = cached?.value ?? [];
    return {
      rows,
      fetchedAt: cached?.fetchedAt ?? null,
      isEmpty: rows.length === 0,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint]);
}

/** Same fingerprint pattern as `useRealProjects.useCacheFingerprint`
 *  — listens for cross-tab `storage` events AND the same-tab
 *  `tyro:cache-updated` custom event so consumers re-render after a
 *  refresh in either tab. */
function useCacheFingerprint(entitySet: string): string {
  const [fp, setFp] = React.useState(() => readFingerprint(entitySet));
  React.useEffect(() => {
    const storageHandler = (e: StorageEvent) => {
      if (!e.key || e.key === `tyro:dv:${entitySet}`) {
        setFp(readFingerprint(entitySet));
      }
    };
    const cacheHandler = (e: Event) => {
      const detail = (e as CustomEvent<CacheUpdatedDetail>).detail;
      if (!detail || detail.entitySet === entitySet) {
        setFp(readFingerprint(entitySet));
      }
    };
    window.addEventListener("storage", storageHandler);
    window.addEventListener(CACHE_UPDATED_EVENT, cacheHandler);
    const fresh = readFingerprint(entitySet);
    if (fresh !== fp) setFp(fresh);
    return () => {
      window.removeEventListener("storage", storageHandler);
      window.removeEventListener(CACHE_UPDATED_EVENT, cacheHandler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entitySet]);
  return fp;
}

function readFingerprint(entitySet: string): string {
  try {
    const raw = localStorage.getItem(`tyro:dv:${entitySet}`);
    if (!raw) return "";
    return raw.slice(0, 80);
  } catch {
    return "";
  }
}
