/**
 * Tenant-wide aggregation of realised expense lines for the P&L Cost
 * report. Mirrors the per-project chain inside `useProjectExpenseLines`
 * (inventdimb → dist → expense-line + refmap) but runs ONCE for all
 * active projects in the refresh chain — so the report can render
 * 320 projects without firing 320 round-trips.
 *
 * Output is a flat array keyed by (projectNo, expenseId), with the
 * Step-R refmap label joined in and code 710041 (Satış Fiyat Farkı)
 * applied as a NEGATIVE contribution (the realised expense reducer
 * documented in BudgetSalesCard).
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
const REFMAP_ENTITY = "mserp_tryaiotherexpenseprojectlineentities";

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
  projids: string[]
): Promise<ActualExpenseRollupRow[]> {
  if (projids.length === 0) return [];

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
  if (projToInventDimIds.size === 0) return [];

  // Flat distinct inventdimids for the dist fetch.
  const allInventDimIds = Array.from(
    new Set(
      Array.from(projToInventDimIds.values()).flatMap((s) => Array.from(s))
    )
  );

  // Step 2: dist rows → expensenums, keyed by inventdimid.
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
  if (dimToExpenseNums.size === 0) return [];

  // Flat distinct expensenums.
  const allExpenseNums = Array.from(
    new Set(
      Array.from(dimToExpenseNums.values()).flatMap((s) => Array.from(s))
    )
  );

  // Step 3: authoritative expense-line rows.
  const expResult = await listAllByInChunked<Record<string, unknown>>(
    client,
    EXPENSE_ENTITY,
    "mserp_expensenum",
    allExpenseNums,
    { $select: EXPENSE_LINE_COLUMNS.join(",") }
  );

  // Index expense-rows by expensenum for the per-project pass.
  const rowsByExpenseNum = new Map<string, Record<string, unknown>[]>();
  for (const r of expResult.value) {
    const en = String(r.mserp_expensenum ?? "").trim();
    if (!en) continue;
    if (!rowsByExpenseNum.has(en)) rowsByExpenseNum.set(en, []);
    rowsByExpenseNum.get(en)!.push(r);
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
      for (const exr of expRows) {
        const expenseId = String(exr.mserp_expenseid ?? "").trim();
        if (!expenseId) continue;
        const description = String(exr.mserp_description ?? "").trim();
        const rawAmount = Number(exr.mserp_amountcur);
        const amount = Number.isFinite(rawAmount) ? rawAmount : 0;
        // 710041 (Satış Fiyat Farkı) reduces realised expense.
        const adjusted =
          expenseId === PRICE_DIFF_EXPENSE_CODE ? -amount : amount;

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
  return result;
}
