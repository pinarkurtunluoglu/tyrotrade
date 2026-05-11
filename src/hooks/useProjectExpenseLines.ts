import * as React from "react";
import { getDataverseClient } from "@/lib/dataverse";
import { EXPENSE_LINE_COLUMNS } from "@/lib/dataverse/columnOrder";

/** Inventory-dimension entity — maps a project number (carried in
 *  `mserp_inventdimension2`) to the set of `mserp_inventdimid` keys
 *  that the distribution lines are stamped with. The distribution
 *  entity has no `mserp_etgtryprojid` we can rely on; the project
 *  link goes through this dim table. */
const INVENTDIMB_ENTITY = "mserp_inventdimbientities";

/** Distribution-line entity — used purely as a "is this expense
 *  linked to this project?" filter via `mserp_inventdimid`. Its own
 *  column data isn't shown anywhere; we only read `mserp_expensenum`
 *  from each row to drive the final lookup against the authoritative
 *  entity. */
const DIST_ENTITY = "mserp_tryaifrtexpenselinedistlineentities";

/** Authoritative expense-line entity carrying the correct amounts
 *  and descriptions. Joined to the distribution entity via
 *  `mserp_expensenum`. */
const EXPENSE_ENTITY = "mserp_tryaiexpenselineentities";

/** Expense HEADER entity — one row per `mserp_expensenum` carrying
 *  the row's currency + USD exchange rate. The LINE entity exposes
 *  only the native-currency amount (`mserp_amountcur`) and no
 *  currency context, so non-USD entries silently inflate any naive
 *  USD sum (a TRY 1M entry would otherwise be summed as $1M). We
 *  fetch headers in parallel chunks once we have the expensenum
 *  set, then convert each line to USD via `amount * exchratesecond`
 *  when the row's currency isn't already USD. Header lookup is
 *  best-effort: if it fails the line keeps its native amount (the
 *  legacy bug behaviour), so the rest of the chain stays usable. */
const EXPENSE_TABLE_ENTITY = "mserp_tryaiexpensetableentities";

/** Reference-map entity — per project, carries
 *  `(mserp_tryexpensetype, mserp_refexpenseid)` pairs that translate
 *  the numeric `mserp_expenseid` values surfaced on the realised
 *  expense-line entity (e.g. `730026`, `710041`) into the textual
 *  label used on the forecast side (e.g. `OPEX`, `FREIGHT`,
 *  `İTHALAT BULK - NAVLUN`). Without this lookup the forecast and
 *  realised expense rows are impossible to reconcile by class.
 *  Filtered per project so the map stays small. */
const EXPENSE_REFMAP_ENTITY = "mserp_tryaiotherexpenseprojectlineentities";

/** Same chunk size as the global IN filter helpers — keeps each
 *  request URL safely under proxy/CDN limits. Used for both the
 *  inventdimid → distribution lookup and the expensenum → expense
 *  lookup. */
const IN_CHUNK_SIZE = 50;

export interface UseProjectExpenseLinesReturn {
  /** Authoritative expense-line rows for the current project. */
  rows: Record<string, unknown>[];
  /** True while ANY of the three async steps is in flight. */
  isFetching: boolean;
  /** ISO timestamp of the most recent successful chain completion. */
  fetchedAt: string | null;
  /** Last error message, when the chain failed. */
  error: string | null;
}

/**
 * 🔒 Read-only — fetch realised-expense LINES for one project via a
 * chain of three sequential steps + one parallel reference-map step:
 *
 *   0. List inventory-dimension rows from `mserp_inventdimbientities`
 *      filtered by `mserp_inventdimension2 eq '<projectNo>'`. Pull
 *      only `mserp_inventdimid`. This step exists because the
 *      distribution entity (Step 1) is not directly indexed by
 *      project number — the project link lives in the inventdim
 *      table.
 *   R. (PARALLEL to Step 0) List rows from
 *      `mserp_tryaiotherexpenseprojectlineentities` filtered by
 *      `mserp_etgtryprojid eq '<projectNo>'`. Build a
 *      `mserp_tryexpensetype → mserp_refexpenseid` map. This is
 *      best-effort: failure here just leaves enriched rows without
 *      the textual class label, the rest of the chain proceeds.
 *   1. De-duplicate the inventdimids, then list distribution rows
 *      from `mserp_tryaifrtexpenselinedistlineentities` using a
 *      chunked `In(mserp_inventdimid, …)` filter. Pull only
 *      `mserp_expensenum`.
 *   2. De-duplicate the expense numbers, then fetch the matching
 *      rows from `mserp_tryaiexpenselineentities` using a chunked
 *      `In(mserp_expensenum, …)` filter so the URL stays under
 *      proxy limits even when a project touches hundreds of expense
 *      vouchers.
 *   2b. (PARALLEL to Step 2) Fetch the expense HEADER rows from
 *       `mserp_tryaiexpensetableentities` for the same expensenum
 *       chunks. Header carries `mserp_currencycode` and
 *       `mserp_exchratesecond` (the row's USD exchange rate at the
 *       transaction date). Build a `expensenum → { currency, rate }`
 *       map. Best-effort — failure here just falls back to
 *       treating the native amount as USD.
 *   3. Enrich each Step-2 row by setting `mserp_refexpenseid` from
 *      Step-R's map keyed on the row's `mserp_expenseid`, AND
 *      attaching a derived `mserp_amountcur_usd` field — the
 *      native `mserp_amountcur` multiplied by Step-2b's exchRate
 *      when the row's currency isn't USD. Consumers should sum
 *      `mserp_amountcur_usd` for USD totals; the original
 *      `mserp_amountcur` is preserved for the raw inspector view.
 *
 * Returns the enriched step-2 rows. The inventdimb + distribution +
 * refmap entities act as filter / lookup intermediaries only — their
 * raw rows aren't surfaced anywhere.
 *
 * In-memory state only (no localStorage cache). The hook re-fetches
 * on every project change; same-project re-renders use cached state.
 */
export function useProjectExpenseLines(
  projectNo: string | null | undefined
): UseProjectExpenseLinesReturn {
  const [rows, setRows] = React.useState<Record<string, unknown>[]>([]);
  const [isFetching, setIsFetching] = React.useState(false);
  const [fetchedAt, setFetchedAt] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!projectNo) {
      setRows([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setIsFetching(true);
    setError(null);
    (async () => {
      try {
        const client = getDataverseClient();

        // Step 0 (parallel): inventory-dimension rows for the project →
        //   distinct inventdimids that drive Step 1.
        // Step R (parallel to Step 0): expense-type → refexpenseid map
        //   for this project. Used purely to enrich Step 2 rows with a
        //   textual expense class (`OPEX`, `FREIGHT`, …). Refmap fetch
        //   is best-effort — if it fails we keep going with raw rows.
        const [dimSettled, refMapSettled] = await Promise.allSettled([
          client.listAll<Record<string, unknown>>(INVENTDIMB_ENTITY, {
            $filter: `mserp_inventdimension2 eq '${projectNo}'`,
            $select: "mserp_inventdimid",
          }),
          client.listAll<Record<string, unknown>>(EXPENSE_REFMAP_ENTITY, {
            $filter: `mserp_etgtryprojid eq '${projectNo}'`,
            $select: "mserp_tryexpensetype,mserp_refexpenseid",
          }),
        ]);
        if (cancelled) return;

        // Step 0 is required — bail if it failed.
        if (dimSettled.status === "rejected") throw dimSettled.reason;
        const dimResult = dimSettled.value;

        // Step R is best-effort. Build the lookup either way.
        const refMap = new Map<string, string>();
        if (refMapSettled.status === "fulfilled") {
          for (const r of refMapSettled.value.value) {
            const k = String(r.mserp_tryexpensetype ?? "").trim();
            const v = String(r.mserp_refexpenseid ?? "").trim();
            if (k && v && !refMap.has(k)) refMap.set(k, v);
          }
        } else {
          // eslint-disable-next-line no-console
          console.warn(
            `[useProjectExpenseLines] refmap fetch failed for ${projectNo} — proceeding without expense-class labels:`,
            refMapSettled.reason
          );
        }

        const inventDimIds = [
          ...new Set(
            dimResult.value
              .map((r) => String(r.mserp_inventdimid ?? "").trim())
              .filter((s): s is string => s.length > 0)
          ),
        ];

        if (inventDimIds.length === 0) {
          // No inventdim link → no distribution rows → no expenses.
          setRows([]);
          setFetchedAt(new Date().toISOString());
          return;
        }

        // Step 1: distribution rows for those inventdimids → distinct expensenums.
        // Chunked IN to keep each URL under enterprise-proxy limits.
        const distRows: Record<string, unknown>[] = [];
        for (let i = 0; i < inventDimIds.length; i += IN_CHUNK_SIZE) {
          const chunk = inventDimIds.slice(i, i + IN_CHUNK_SIZE);
          const inFilter = `Microsoft.Dynamics.CRM.In(PropertyName='mserp_inventdimid',PropertyValues=[${chunk
            .map((id) => `'${id}'`)
            .join(",")}])`;
          const distResult = await client.listAll<Record<string, unknown>>(
            DIST_ENTITY,
            {
              $filter: inFilter,
              $select: "mserp_expensenum",
            }
          );
          if (cancelled) return;
          distRows.push(...distResult.value);
        }

        const expensenums = [
          ...new Set(
            distRows
              .map((r) => String(r.mserp_expensenum ?? "").trim())
              .filter((s): s is string => s.length > 0)
          ),
        ];

        if (expensenums.length === 0) {
          // Distribution rows existed but carried no expensenums.
          setRows([]);
          setFetchedAt(new Date().toISOString());
          return;
        }

        // Step 2 + 2b in parallel: line rows (authoritative amounts
        // in native currency) AND header rows (currency + exchRate
        // context). Header lookup is best-effort — a failure means
        // we lose FX conversion for any non-USD lines but the rest
        // of the chain proceeds with native amounts.
        const linePromises: Promise<{ value: Record<string, unknown>[] }>[] = [];
        const headerPromises: Promise<{ value: Record<string, unknown>[] }>[] = [];
        for (let i = 0; i < expensenums.length; i += IN_CHUNK_SIZE) {
          const chunk = expensenums.slice(i, i + IN_CHUNK_SIZE);
          const inFilter = `Microsoft.Dynamics.CRM.In(PropertyName='mserp_expensenum',PropertyValues=[${chunk
            .map((n) => `'${n}'`)
            .join(",")}])`;
          linePromises.push(
            client.listAll<Record<string, unknown>>(EXPENSE_ENTITY, {
              $filter: inFilter,
              $select: EXPENSE_LINE_COLUMNS.join(","),
              $count: true,
            })
          );
          headerPromises.push(
            client.listAll<Record<string, unknown>>(EXPENSE_TABLE_ENTITY, {
              $filter: inFilter,
              $select:
                "mserp_expensenum,mserp_currencycode,mserp_exchratesecond",
            })
          );
        }
        const [lineSettled, headerSettled] = await Promise.all([
          Promise.all(linePromises),
          Promise.allSettled(headerPromises),
        ]);
        if (cancelled) return;

        const all: Record<string, unknown>[] = [];
        for (const r of lineSettled) all.push(...r.value);

        // Build expensenum → { currency, exchRate } map from header
        // rows. Each settled chunk that succeeded contributes; chunks
        // that failed (rare, e.g. proxy error on a single batch) are
        // skipped — lines whose expensenum lacks an entry fall back
        // to treating amountcur as USD.
        const fxByExpensenum = new Map<
          string,
          { currency: string; rate: number }
        >();
        for (const settled of headerSettled) {
          if (settled.status !== "fulfilled") continue;
          for (const h of settled.value.value) {
            const num = String(h.mserp_expensenum ?? "").trim();
            const cur = String(h.mserp_currencycode ?? "").trim().toUpperCase();
            const rate = Number(h.mserp_exchratesecond);
            if (!num) continue;
            fxByExpensenum.set(num, {
              currency: cur || "USD",
              rate: Number.isFinite(rate) ? rate : 1,
            });
          }
        }
        const headerFailureCount = headerSettled.filter(
          (s) => s.status === "rejected"
        ).length;
        if (headerFailureCount > 0) {
          // eslint-disable-next-line no-console
          console.warn(
            `[useProjectExpenseLines] expense-table header fetch failed for ${headerFailureCount}/${headerSettled.length} chunks of ${projectNo} — non-USD lines in those chunks will be treated as USD.`
          );
        }

        // Enrichment: (a) refmap → mserp_refexpenseid textual class,
        // (b) FX conversion → mserp_amountcur_usd (native amount
        // multiplied by exchRate when currency != USD). The original
        // mserp_amountcur is preserved untouched for raw inspector
        // views. Downstream P&L sums should read `_usd` so totals
        // never mix currencies.
        const enriched = all.map((r) => {
          const out: Record<string, unknown> = { ...r };
          const code = String(r.mserp_expenseid ?? "").trim();
          const ref = code ? refMap.get(code) : undefined;
          if (ref) out.mserp_refexpenseid = ref;

          const amount = Number(r.mserp_amountcur);
          if (Number.isFinite(amount)) {
            const expensenum = String(r.mserp_expensenum ?? "").trim();
            const fx = expensenum ? fxByExpensenum.get(expensenum) : undefined;
            // USD or unknown currency → no conversion. Otherwise
            // multiply by the header's exchratesecond (rate is in
            // USD-per-native-unit form, so e.g. TRY × 0.0750 = USD).
            const usd =
              !fx || fx.currency === "USD"
                ? amount
                : amount * fx.rate;
            out.mserp_amountcur_usd = usd;
            // Optional companion fields — handy in the inspector +
            // for debugging "why does this line read as $X". They're
            // attached only when FX context was actually found so the
            // inspector doesn't show empty columns for USD lines.
            if (fx) {
              out.mserp_currencycode = fx.currency;
              out.mserp_exchratesecond = fx.rate;
            }
          }
          return out;
        });

        setRows(enriched);
        setFetchedAt(new Date().toISOString());
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.warn(
          `[useProjectExpenseLines] fetch failed for ${projectNo}:`,
          err
        );
        setError(message);
      } finally {
        if (!cancelled) setIsFetching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectNo]);

  return {
    rows,
    isFetching,
    fetchedAt,
    error,
  };
}
