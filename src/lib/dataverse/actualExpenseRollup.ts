/**
 * Tenant-wide aggregation of realised expense lines for the Trade
 * Cost report. Mirrors the per-project chain inside
 * `useProjectExpenseLines` (inventdimb → dist → expense-line + refmap
 * + FX header join) but runs ONCE for all active projects so the
 * report can render 320 projects without firing 320 round-trips.
 *
 * Two normalisations applied during aggregation:
 *
 *   1. **Expense-id exclusion**: lines whose `mserp_expenseid` is
 *      in `EXCLUDED_EXPENSE_IDS` (KDV, Damga Vergisi, …) are
 *      dropped. Targeted to pass-through tax / surcharge codes that
 *      don't belong in operational P&L.
 *   2. **FX conversion**: each line's native `mserp_amountcur` is
 *      multiplied by the header's `mserp_exchratesecond` when the
 *      row's currency isn't USD, so non-USD invoices don't inflate
 *      the dollar sum (TRY 1M was previously summed as $1M).
 *
 * FX context comes from a parallel expense-table header fetch
 * (Step 3b below). Best-effort: a failed header chunk degrades to
 * "treat as USD" for its lines. Code 710041 (Satış Fiyat Farkı)
 * stays applied as a NEGATIVE contribution on the already-USD-
 * converted amount — same rule BudgetSalesCard runs row-by-row.
 *
 * Output is a flat array keyed by (projectNo, expenseId).
 */

import type { DataverseClient } from "@/lib/dataverse";
import { listAllByInChunked } from "@/lib/dataverse/refreshAll";
import { EXPENSE_LINE_COLUMNS } from "@/lib/dataverse/columnOrder";

/** Realised expense rollup row — one per (projectNo, expenseId). */
export interface ActualExpenseRollupRow {
  /** Project number — join key against the projects cache. */
  projectNo: string;
  /** F&O numeric expense category code (e.g. "712621", "710041"). */
  expenseId: string;
  /** Sample expense voucher number from the contributing rows. */
  expenseNum: string;
  /** Textual class from the per-project refmap (e.g. "OPEX",
   *  "FREIGHT", "İTHALAT BULK - NAVLUN"). null when refmap had no
   *  entry. */
  refExpenseId: string | null;
  /** Sample free-text description from the contributing rows. */
  description: string;
  /** Net USD total. Code 710041 contributes NEGATIVELY (FX-driven
   *  sales-price-difference adjustment that REDUCES realised expense
   *  burden — same rule the BudgetSalesCard applies row-by-row). */
  totalUsd: number;
  /** Number of underlying expense-line rows aggregated. Helpful for
   *  drill-down: "this rollup row aggregates 4 voucher entries." */
  rowCount: number;
}

/** Localised constant — code 710041 ("Satış Fiyat Farkı") subtracts
 *  from realised expense instead of adding. Mirrors
 *  `PRICE_DIFF_EXPENSE_CODE` in BudgetSalesCard.tsx so the two stay
 *  consistent. */
const PRICE_DIFF_EXPENSE_CODE = "710041";

/* ─────────── Entity sets used by the chain ─────────── */
const INVENTDIMB_ENTITY = "mserp_inventdimbientities";
const DIST_ENTITY = "mserp_tryaifrtexpenselinedistlineentities";
const EXPENSE_ENTITY = "mserp_tryaiexpenselineentities";
/** Expense HEADER entity — joined to lines by `mserp_expensenum`
 *  purely for FX context (currency + exchratesecond). Without
 *  this join non-USD line amounts silently inflate the USD sum.
 *  Same pattern as the per-project chain in
 *  `useProjectExpenseLines`. */
const EXPENSE_TABLE_ENTITY = "mserp_tryaiexpensetableentities";
const REFMAP_ENTITY = "mserp_tryaiotherexpenseprojectlineentities";

/** F&O `mserp_expenseid` codes excluded from realised P&L. Tax /
 *  pass-through line types that don't belong in operational
 *  expense totals (KDV, Damga Vergisi). Mirrors
 *  `EXCLUDED_EXPENSE_IDS` in `useProjectExpenseLines` so the
 *  project drill-down and the Trade Cost aggregate agree on which
 *  codes are filtered out. */
const EXCLUDED_EXPENSE_IDS = new Set<string>(["731016", "730030"]);

/* ─────────── Progress reporting ─────────── */

/** Logical stage names for the rollup pipeline. UI surfaces these as
 *  step rows — tick / spinner / pending. The order is the actual
 *  execution order (steps 1+R run in parallel). */
export type RollupStage =
  | "inventdimb"
  | "refmap"
  | "dist"
  | "expense-line"
  | "aggregate";

export const ROLLUP_STAGES: RollupStage[] = [
  "inventdimb",
  "refmap",
  "dist",
  "expense-line",
  "aggregate",
];

/** One per stage transition. Caller can use this to drive a
 *  step-by-step progress UI (tyrowms-style). `count` is the natural
 *  unit for each step:
 *   - inventdimb     → distinct inventdimid count
 *   - refmap         → refmap row count (per-project mapping count)
 *   - dist           → distinct expensenum count
 *   - expense-line   → ham realised row count
 *   - aggregate      → final rollup row count
 */
export interface RollupProgress {
  /** The stage that just completed (or just started, when `running`). */
  stage: RollupStage;
  /** Was this a "stage starting" report or a "stage just completed"? */
  status: "running" | "done";
  /** Number of records associated with the just-completed stage. */
  count?: number;
}

export type ProgressCallback = (p: RollupProgress) => void;

/**
 * Tenant-wide pipeline (4 chunked fetches; refmap is parallel with
 * the inventdimb step so the whole thing runs in roughly the time of
 * the longest single stage):
 *
 *   1. inventdimb   — projids × IN(`mserp_inventdimension2`)
 *      → Map<projid, Set<inventdimid>>
 *
 *   R. refmap (paralleled with step 1)
 *      — projids × IN(`mserp_etgtryprojid`)
 *      → Map<projid, Map<expensetype, refexpenseid>>
 *
 *   2. dist         — flat inventdimids × IN(`mserp_inventdimid`)
 *      → Map<inventdimid, Set<expensenum>>
 *
 *   3. expense-line — flat expensenums × IN(`mserp_expensenum`)
 *      → ham gerçekleşen rows
 *
 * Then a single in-memory pass over the expense rows: re-attach each
 * row to every project whose inventdimids resolve to its expensenum,
 * apply the 710041 sign-flip, and roll up by (projid, expenseId).
 *
 * Best-effort failure handling: refmap (R) failure logs a warning
 * and proceeds with `refExpenseId: null`. Steps 1-3 failure throws —
 * the caller (refreshAll step) catches and reports the chain failure.
 */
export async function fetchActualExpenseRollupForAllProjects(
  client: DataverseClient,
  projids: string[],
  onProgress?: ProgressCallback
): Promise<ActualExpenseRollupRow[]> {
  if (projids.length === 0) return [];

  // Mark steps 1 & R as running. They fire in parallel.
  onProgress?.({ stage: "inventdimb", status: "running" });
  onProgress?.({ stage: "refmap", status: "running" });

  // Step 1 + R in parallel.
  const [dimSettled, refMapSettled] = await Promise.allSettled([
    listAllByInChunked<Record<string, unknown>>(
      client,
      INVENTDIMB_ENTITY,
      "mserp_inventdimension2",
      projids,
      { $select: "mserp_inventdimension2,mserp_inventdimid" }
    ),
    listAllByInChunked<Record<string, unknown>>(
      client,
      REFMAP_ENTITY,
      "mserp_etgtryprojid",
      projids,
      {
        $select: "mserp_etgtryprojid,mserp_tryexpensetype,mserp_refexpenseid",
      }
    ),
  ]);

  if (dimSettled.status === "rejected") throw dimSettled.reason;
  const dimResult = dimSettled.value;

  // Build refmap (best-effort). Map<projid, Map<expensetype, ref>>.
  const projRefMap = new Map<string, Map<string, string>>();
  if (refMapSettled.status === "fulfilled") {
    for (const r of refMapSettled.value.value) {
      const pid = String(r.mserp_etgtryprojid ?? "").trim();
      const type = String(r.mserp_tryexpensetype ?? "").trim();
      const ref = String(r.mserp_refexpenseid ?? "").trim();
      if (!pid || !type || !ref) continue;
      if (!projRefMap.has(pid)) projRefMap.set(pid, new Map());
      projRefMap.get(pid)!.set(type, ref);
    }
  } else {
    // eslint-disable-next-line no-console
    console.warn(
      "[actualExpenseRollup] refmap fetch failed — proceeding without expense-class labels:",
      refMapSettled.reason
    );
  }

  // Map projid → Set<inventdimid>.
  const projToInventDimIds = new Map<string, Set<string>>();
  for (const r of dimResult.value) {
    const pid = String(r.mserp_inventdimension2 ?? "").trim();
    const did = String(r.mserp_inventdimid ?? "").trim();
    if (!pid || !did) continue;
    if (!projToInventDimIds.has(pid)) projToInventDimIds.set(pid, new Set());
    projToInventDimIds.get(pid)!.add(did);
  }

  // Flat distinct inventdimids for the dist fetch.
  const allInventDimIds = Array.from(
    new Set(
      Array.from(projToInventDimIds.values()).flatMap((s) => Array.from(s))
    )
  );

  // Report Step 1 done (even on early return so the UI ticks).
  onProgress?.({
    stage: "inventdimb",
    status: "done",
    count: allInventDimIds.length,
  });
  // Refmap also "done" by now (Promise.allSettled awaited above).
  onProgress?.({
    stage: "refmap",
    status: "done",
    count:
      refMapSettled.status === "fulfilled"
        ? refMapSettled.value.value.length
        : 0,
  });

  if (projToInventDimIds.size === 0) return [];

  // Step 2: dist rows → expensenums, keyed by inventdimid.
  onProgress?.({ stage: "dist", status: "running" });
  const distResult = await listAllByInChunked<Record<string, unknown>>(
    client,
    DIST_ENTITY,
    "mserp_inventdimid",
    allInventDimIds,
    { $select: "mserp_inventdimid,mserp_expensenum" }
  );
  const dimToExpenseNums = new Map<string, Set<string>>();
  for (const r of distResult.value) {
    const did = String(r.mserp_inventdimid ?? "").trim();
    const en = String(r.mserp_expensenum ?? "").trim();
    if (!did || !en) continue;
    if (!dimToExpenseNums.has(did)) dimToExpenseNums.set(did, new Set());
    dimToExpenseNums.get(did)!.add(en);
  }

  // Flat distinct expensenums.
  const allExpenseNums = Array.from(
    new Set(
      Array.from(dimToExpenseNums.values()).flatMap((s) => Array.from(s))
    )
  );

  onProgress?.({
    stage: "dist",
    status: "done",
    count: allExpenseNums.length,
  });

  if (dimToExpenseNums.size === 0) return [];

  // Step 3: authoritative expense-line rows + expense-table
  // headers in parallel. The header fetch supplies FX context
  // (currency + exchratesecond) for non-USD conversion; line-
  // level exclusions run separately against EXCLUDED_EXPENSE_IDS.
  // Header lookup is best-effort — a failed chunk just degrades
  // to "treat as USD" for its lines.
  onProgress?.({ stage: "expense-line", status: "running" });
  const [expResult, headerSettled] = await Promise.all([
    listAllByInChunked<Record<string, unknown>>(
      client,
      EXPENSE_ENTITY,
      "mserp_expensenum",
      allExpenseNums,
      { $select: EXPENSE_LINE_COLUMNS.join(",") }
    ),
    listAllByInChunked<Record<string, unknown>>(
      client,
      EXPENSE_TABLE_ENTITY,
      "mserp_expensenum",
      allExpenseNums,
      { $select: "mserp_expensenum,mserp_currencycode,mserp_exchratesecond" }
    )
      .then((r) => ({ status: "fulfilled" as const, value: r }))
      .catch((reason) => ({ status: "rejected" as const, reason })),
  ]);

  // Build expensenum → { currency, rate } map from header rows for
  // FX conversion. If the whole fetch failed (rare — proxy/5xx),
  // the map stays empty and every line falls back to USD treatment.
  const fxByExpenseNum = new Map<
    string,
    { currency: string; rate: number }
  >();
  if (headerSettled.status === "fulfilled") {
    for (const h of headerSettled.value.value) {
      const num = String(h.mserp_expensenum ?? "").trim();
      const cur = String(h.mserp_currencycode ?? "").trim().toUpperCase();
      const rate = Number(h.mserp_exchratesecond);
      if (!num) continue;
      fxByExpenseNum.set(num, {
        currency: cur || "USD",
        rate: Number.isFinite(rate) ? rate : 1,
      });
    }
  } else {
    // eslint-disable-next-line no-console
    console.warn(
      "[actualExpenseRollup] expense-table header fetch failed — non-USD lines will be treated as USD (FX rate unknown):",
      headerSettled.reason
    );
  }

  onProgress?.({
    stage: "expense-line",
    status: "done",
    count: expResult.value.length,
  });
  onProgress?.({ stage: "aggregate", status: "running" });

  // Index expense-rows by expensenum for the per-project pass.
  // Lines whose `mserp_expenseid` is in EXCLUDED_EXPENSE_IDS
  // (KDV, Damga Vergisi, …) are dropped here — same gate the
  // per-project hook applies.
  const rowsByExpenseNum = new Map<string, Record<string, unknown>[]>();
  let droppedExcludedCount = 0;
  for (const r of expResult.value) {
    const en = String(r.mserp_expensenum ?? "").trim();
    if (!en) continue;
    const code = String(r.mserp_expenseid ?? "").trim();
    if (code && EXCLUDED_EXPENSE_IDS.has(code)) {
      droppedExcludedCount += 1;
      continue;
    }
    if (!rowsByExpenseNum.has(en)) rowsByExpenseNum.set(en, []);
    rowsByExpenseNum.get(en)!.push(r);
  }
  if (droppedExcludedCount > 0) {
    // eslint-disable-next-line no-console
    console.info(
      `[actualExpenseRollup] dropped ${droppedExcludedCount}/${expResult.value.length} expense lines — expenseid in EXCLUDED_EXPENSE_IDS (${Array.from(EXCLUDED_EXPENSE_IDS).join(", ")}).`
    );
  }

  // Aggregate per (projid, expenseId).
  const rollup = new Map<
    string,
    Map<
      string,
      { totalUsd: number; rowCount: number; expenseNum: string; description: string }
    >
  >();
  for (const [projid, dimIds] of projToInventDimIds) {
    // Collect this project's expensenum set via its inventdimids.
    const projExpenseNums = new Set<string>();
    for (const did of dimIds) {
      const ens = dimToExpenseNums.get(did);
      if (ens) for (const en of ens) projExpenseNums.add(en);
    }
    if (projExpenseNums.size === 0) continue;

    if (!rollup.has(projid)) rollup.set(projid, new Map());
    const projMap = rollup.get(projid)!;

    for (const en of projExpenseNums) {
      const expRows = rowsByExpenseNum.get(en);
      if (!expRows) continue;
      // FX context for this expensenum. May be missing when the
      // header chunk failed — fall back to treating the native
      // amount as USD (degraded, see the console.warn above).
      const fx = fxByExpenseNum.get(en);
      for (const exr of expRows) {
        const expenseId = String(exr.mserp_expenseid ?? "").trim();
        if (!expenseId) continue;
        const description = String(exr.mserp_description ?? "").trim();
        const rawAmount = Number(exr.mserp_amountcur);
        const nativeAmount = Number.isFinite(rawAmount) ? rawAmount : 0;
        // FX conversion: USD (or no header) stays as-is; non-USD
        // multiplies by the header's exchratesecond (rate is in
        // USD-per-native form — TRY × 0.0750 ≈ USD).
        const amountUsd =
          !fx || fx.currency === "USD"
            ? nativeAmount
            : nativeAmount * fx.rate;
        // 710041 (Satış Fiyat Farkı) reduces realised expense.
        const adjusted =
          expenseId === PRICE_DIFF_EXPENSE_CODE ? -amountUsd : amountUsd;

        const existing = projMap.get(expenseId);
        if (existing) {
          existing.totalUsd += adjusted;
          existing.rowCount += 1;
        } else {
          projMap.set(expenseId, {
            totalUsd: adjusted,
            rowCount: 1,
            expenseNum: en,
            description,
          });
        }
      }
    }
  }

  // Flatten + refmap join.
  const result: ActualExpenseRollupRow[] = [];
  for (const [projectNo, expenseMap] of rollup) {
    const refMap = projRefMap.get(projectNo);
    for (const [expenseId, agg] of expenseMap) {
      result.push({
        projectNo,
        expenseId,
        expenseNum: agg.expenseNum,
        refExpenseId: refMap?.get(expenseId) ?? null,
        description: agg.description,
        totalUsd: agg.totalUsd,
        rowCount: agg.rowCount,
      });
    }
  }
  onProgress?.({
    stage: "aggregate",
    status: "done",
    count: result.length,
  });
  return result;
}
