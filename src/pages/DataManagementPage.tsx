import * as React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { ScrollArea } from "@/components/ui/scroll-area";
import { GlassPanel } from "@/components/glass/GlassPanel";
import { useThemeAccent } from "@/components/layout/theme-accent";
import { cn } from "@/lib/utils";
import { useEntityRows } from "@/hooks/useEntityRows";
import { getDataverseClient } from "@/lib/dataverse";
import { readCache, writeCache } from "@/lib/storage/entityCache";
import {
  ACTUAL_EXPENSE_ROLLUP_CACHE,
  applyByInChunked,
  fetchFinancingOrderIds,
  fetchVesselMasterAndEnrichShipCache,
  FINANCING_PURCH_IDS_CACHE,
  FINANCING_SALES_IDS_CACHE,
  getFinancingPurchIdSet,
  getFinancingSalesIdSet,
  listAllByInChunked,
  NON_INTERCOMPANY_FILTER,
} from "@/lib/dataverse/refreshAll";
import { fetchActualExpenseRollupForAllProjects } from "@/lib/dataverse/actualExpenseRollup";
import {
  EntityRowsTable,
  sortRows,
  type SortState,
} from "@/components/data-management/EntityRowsTable";
import { RefreshAllButton } from "@/components/data-management/RefreshAllButton";
import { TabStrip, type TabItem } from "@/components/data-management/TabStrip";
import { AdvancedFilter } from "@/components/filters/AdvancedFilter";
import {
  applyProjectFilter,
  makeEmptyFilters,
  type ProjectFilterState,
} from "@/lib/filters/projectFilters";
import { useProjects } from "@/hooks/useProjects";
import {
  PROJECT_COLUMNS,
  PROJECT_LINE_COLUMNS,
  SHIP_COLUMNS,
  SHIP_DISPLAY_COLUMNS,
  EXPENSE_COLUMNS,
  EXPENSE_LINE_COLUMNS,
  PURCHASE_COLUMNS,
  SALES_COLUMNS,
  BUDGET_COLUMNS,
} from "@/lib/dataverse/columnOrder";
import { useProjectExpenseLines } from "@/hooks/useProjectExpenseLines";

/* ─────────── Entity sets + filters ─────────── */

const ENTITY_SETS = {
  projects: "mserp_etgtryprojecttableentities",
  ship: "mserp_tryaiprojectshiprelationentities",
  lines: "mserp_tryaiprojectlineentities",
  // Switched April 2026 from `mserp_tryaiotherexpenseprojectlineentities`
  // (project-line variant) to this direct expense entity. Project FK is now
  // `mserp_etgtryprojid` instead of `mserp_tryplanprojectid`.
  expense: "mserp_tryaiotherexpenseentities",
  // Realised expense distribution lines — booked freight/expense actually
  // applied to each project. New entity (added by F&O team). FK is
  // `mserp_etgtryprojid`, mirroring the sibling estimate table.
  actualExpense: "mserp_tryaifrtexpenselinedistlineentities",
  // Realised project purchases — vendor invoice transactions. Linked
  // via the parent purchase table's `mserp_purchtable_etgtryprojid`.
  // Counterpart of the customer-side `sales` entity below.
  purchase: "mserp_tryaivendinvoicetransentities",
  // Customer invoice transactions (posted invoices), filtered per-project.
  // Replaced earlier salesline entity which mostly carried the same data
  // but in unposted form; invoice trans are the realised "actual" sales.
  sales: "mserp_tryaicustinvoicetransentities",
  // Sales / purchase order header tables — joined to invoice trans
  // rows on `mserp_salesid` / `mserp_purchid` to identify financing
  // (mserp_etgordertype === 'Finansman') orders, whose invoice rows
  // are excluded from realised totals.
  salesTable: "mserp_tryaisalestableentities",
  purchTable: "mserp_tryaipurchtableentities",
  // Vessel master — joined to ship rows via `mserp_vessel` (RecID)
  // → `mserp_vesseltable_recid` to enrich each ship-relation row
  // with a real vessel name + IMO. The fetch + ship-cache
  // enrichment lives in `fetchVesselMasterAndEnrichShipCache`.
  vesselTable: "mserp_tryvlxvesseltableentities",
  budget: "mserp_tryaiprojectbudgetlineentities",
} as const;

/* ─────────── Page ─────────── */

type TopTabKey = "projects" | "budget";
type ChildTabKey =
  | "lines"
  | "ship"
  | "expense"
  | "actualExpense"
  | "sales"
  | "purchase";


export function DataManagementPage() {
  const [topTab, setTopTab] = React.useState<TopTabKey>("projects");
  const [childTab, setChildTab] = React.useState<ChildTabKey>("lines");

  // Unified Advanced Filter state — same shape as Dashboard / Vessel
  // Projects. Veri Yönetimi defaults to "all projects in" since the
  // page is for raw-row inspection, not operational triage.
  const [projectFilters, setProjectFilters] = React.useState<ProjectFilterState>(
    () => makeEmptyFilters({ includeWithoutShipPlan: true })
  );
  // Free-text search applied across the projects master table AND
  // the ship-plan child rows. Independent of the categorical
  // AdvancedFilter — the two compose: filter narrows rows by
  // dimension chips, search narrows by substring.
  const [searchQuery, setSearchQuery] = React.useState("");
  const matchesSearch = React.useCallback(
    (row: Record<string, unknown>): boolean => {
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      // Substring match on every value in the row, cast to string —
      // dates, numbers, codes, FormattedValue annotations all caught.
      // `Object.values` walks the row in one pass; rows with hundreds
      // of fields stay fast because we early-return on first hit.
      for (const value of Object.values(row)) {
        if (value == null) continue;
        if (String(value).toLowerCase().includes(q)) return true;
      }
      return false;
    },
    [searchQuery]
  );

  // Domain Project[] (already-composed) — used to derive the allowed
  // projectNo set after applying the unified filter, then narrow the
  // raw `projects.rows` accordingly. Keeps the Dataverse Inspector's
  // raw-row display unchanged while reusing the page-agnostic filter UI.
  const { projects: domainProjects } = useProjects();
  // Default sort: contractdate desc (newest first)
  const [projectSort, setProjectSort] = React.useState<SortState | null>({
    field: "mserp_contractdate",
    direction: "desc",
  });
  // Selection by stable project ID — survives filter/sort/tab changes so the
  // child panels + budget filter keep working when user explores other tabs.
  const [selectedProjId, setSelectedProjId] = React.useState<string | null>(
    null
  );

  // 🔒 5 entity hooks — read-only, manual trigger via "Verileri Güncelle".
  // Projects scope: dlvmode=Gemi + segment ne null. Mirrors
  // `PROJECTS_FILTER` in refreshAll.ts so the inspector and the
  // auto-refresh see the same working set.
  const projects = useEntityRows<Record<string, unknown>>({
    entitySet: ENTITY_SETS.projects,
    query: {
      $filter: "mserp_dlvmode eq 'Gemi' and mserp_tryprojectsegment ne null",
      // Only fetch the columns we display — drops mserp_isorganic and below
      // (sub-contract flags, financial dimensions, payment specs, etc.)
      $select: PROJECT_COLUMNS.join(","),
      $count: true,
    },
  });
  // $select on each child entity — only priority columns + their formatted-value
  // annotations come back. Reduces fetch payload + localStorage cache size so we
  // don't blow past the 5–10 MB browser quota (lines table alone has ~3000 rows).
  const ship = useEntityRows<Record<string, unknown>>({
    entitySet: ENTITY_SETS.ship,
    query: { $select: SHIP_COLUMNS.join(","), $count: true },
  });
  const lines = useEntityRows<Record<string, unknown>>({
    entitySet: ENTITY_SETS.lines,
    query: { $select: PROJECT_LINE_COLUMNS.join(","), $count: true },
  });
  const expense = useEntityRows<Record<string, unknown>>({
    entitySet: ENTITY_SETS.expense,
    query: { $select: EXPENSE_COLUMNS.join(","), $count: true },
  });
  // Realised expense LINES — fetched per-selected project via a
  // three-step chain (see `useProjectExpenseLines`):
  //   0. inventdimb entity (`mserp_inventdimbientities`) filtered by
  //      `mserp_inventdimension2 eq <projectNo>` → distinct
  //      `mserp_inventdimid` keys
  //   1. distribution entity (`mserp_tryaifrtexpenselinedistlineentities`)
  //      filtered by `In(mserp_inventdimid, …)` → distinct expensenums
  //   2. expense-line entity (`mserp_tryaiexpenselineentities`)
  //      filtered by `In(mserp_expensenum, …)` → authoritative rows
  // The inventdimb + dist entities are project-scoping filters only;
  // the rows we surface here come from the expense-line entity. This
  // is also the entity dashboard calculations will read from when we
  // wire them up later.
  const actualExpense = useProjectExpenseLines(selectedProjId);
  // Realised project purchases — vendor invoice transactions, narrowed
  // to the 12 inspector columns. Project FK lives at
  // `mserp_purchtable_etgtryprojid` (different prefix from siblings).
  // Intercompany rows excluded — see NON_INTERCOMPANY_FILTER.
  const purchase = useEntityRows<Record<string, unknown>>({
    entitySet: ENTITY_SETS.purchase,
    query: {
      $filter: NON_INTERCOMPANY_FILTER,
      $select: PURCHASE_COLUMNS.join(","),
      $count: true,
    },
  });
  // Customer invoice transactions — per-PROJECT server-side fetch.
  // Entity is huge tenant-wide (thousands of invoiced rows; a single
  // project can have 600+), so we filter to the selected project and
  // pull every matching invoice. No row cap — `listAll` paginates as
  // needed. Sorted by invoice date desc so the table reads newest-
  // first. Effect below auto-refetches when the user picks a different
  // project.
  const salesQuery = React.useMemo(() => {
    if (!selectedProjId) return { $top: 0 };
    // Intercompany rows excluded server-side. Financing-order rows
    // (`mserp_salesid` in cached financing set) are stripped CLIENT-SIDE
    // below — F&O virtual entities reject `not In(...)` filters with
    // a 405, so we can't push that exclusion to the server.
    return {
      $filter: `mserp_etgtryprojid eq '${selectedProjId}' and (${NON_INTERCOMPANY_FILTER})`,
      $select: SALES_COLUMNS.join(","),
      $orderby: "mserp_invoicedate desc",
      $count: true,
    };
  }, [selectedProjId]);
  const sales = useEntityRows<Record<string, unknown>>({
    entitySet: ENTITY_SETS.sales,
    query: salesQuery,
  });

  // Auto-fetch per-selected-project sales when the project changes.
  // (`actualExpense` uses `useProjectExpenseLines`, which has its
  // own `useEffect` keyed on projectNo — no manual refetch needed.)
  React.useEffect(() => {
    if (selectedProjId) {
      void sales.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjId]);

  // Diagnostic: log row counts + first-row keys for the two recently
  // added entities so we can spot FK mismatches or empty-result fetches
  // without users digging through localStorage. Console-only; no UI.
  React.useEffect(() => {
    const probe = (
      label: string,
      rows: Record<string, unknown>[],
      fetchedAt: string | null,
      expectedFkField: string
    ) => {
      if (rows.length > 0) {
        const first = rows[0];
        const keys = Object.keys(first);
        const fkValue = first[expectedFkField];
        console.log(
          `[${label}] ${rows.length} satır cache'te. ` +
            `İlk satırın "${expectedFkField}" değeri: ${JSON.stringify(fkValue)}. ` +
            `Tüm alanlar:`,
          keys
        );
      } else if (fetchedAt) {
        console.warn(
          `[${label}] Fetch çalıştı (${fetchedAt}) ama 0 satır döndü — ` +
            `bu projeler için bu entity'de kayıt olmayabilir veya FK eşleşmiyor.`
        );
      }
    };
    probe(
      "Gerçekleşen Gider",
      actualExpense.rows,
      actualExpense.fetchedAt,
      // Expense-line entity has no project FK — the dist entity
      // filtered upstream. The probe just surfaces row count + the
      // expense voucher number on the first row for sanity.
      "mserp_expensenum"
    );
    probe(
      "Proje Satınalma",
      purchase.rows,
      purchase.fetchedAt,
      "mserp_purchtable_etgtryprojid"
    );
  }, [
    actualExpense.rows,
    actualExpense.fetchedAt,
    purchase.rows,
    purchase.fetchedAt,
  ]);
  const budget = useEntityRows<Record<string, unknown>>({
    entitySet: ENTITY_SETS.budget,
    query: { $select: BUDGET_COLUMNS.join(","), $count: true },
  });

  /* Sequential refresh steps — RefreshAllButton fires these in order.
   *
   * Strategy:
   *   1. Projeler — server filter `dlvmode='Gemi' AND segment ne null`
   *      (+ optional trader narrow when env is set).
   *   2. Read fresh project IDs from the just-written cache.
   *   3. Lines / Ship / Expense — `Microsoft.Dynamics.CRM.In(...)` filter
   *      built from those IDs (~7.5KB URL, well under Dataverse limits).
   *      Reduces tenant-wide payloads (3.3K + 0.4K + 0.65K = ~4.3K rows)
   *      to only the rows actually linked to the in-scope projects.
   *   4. Tahmini Bütçe — segment-based, no project filter (1267 rows).
   *
   * Sales (invoices) intentionally OUT — fetched per selected project via
   * the effect above; can hit hundreds of rows for a single big project. */
  const refreshSteps = React.useMemo(() => {
    // Project-id IN filters get URL-encoded into ~10KB+ when we send
    // every project as one request. Some networks (proxies / CDNs in
    // front of Dataverse) reject those at HTTP 400/414 — auto-refresh
    // hit it post-login while the manual click later succeeded only
    // because the proxy state had warmed up. Solution: chunk the IN
    // list (100/batch) via the helpers from refreshAll.ts. Both the
    // post-login auto-refresh and this manual button now share the
    // same code path, so success/failure modes stay aligned.
    const readProjids = (): string[] => {
      const cached = readCache<Record<string, unknown>>(ENTITY_SETS.projects);
      return (cached?.value ?? [])
        .map((p) => p.mserp_projid as string | undefined)
        .filter((s): s is string => !!s);
    };
    return [
      { label: "Projeler", refetch: projects.refetch },
      {
        label: "Proje Satırları",
        refetch: async () => {
          const client = getDataverseClient();
          const projids = readProjids();
          const result = await listAllByInChunked<Record<string, unknown>>(
            client,
            ENTITY_SETS.lines,
            "mserp_projid",
            projids,
            { $select: PROJECT_LINE_COLUMNS.join(","), $count: true }
          );
          writeCache(ENTITY_SETS.lines, {
            fetchedAt: new Date().toISOString(),
            value: result.value,
            totalCount: result.totalCount,
          });
        },
      },
      {
        label: "Gemi Planı",
        refetch: async () => {
          const client = getDataverseClient();
          const projids = readProjids();
          const result = await listAllByInChunked<Record<string, unknown>>(
            client,
            ENTITY_SETS.ship,
            "mserp_tryshipprojid",
            projids,
            { $select: SHIP_COLUMNS.join(","), $count: true }
          );
          writeCache(ENTITY_SETS.ship, {
            fetchedAt: new Date().toISOString(),
            value: result.value,
            totalCount: result.totalCount,
          });
        },
      },
      {
        // Vessel master lookup — same helper the auto-refresh chain
        // uses. Runs RIGHT AFTER Gemi Planı so the freshly-written
        // ship cache is the one we enrich. Bails gracefully if the
        // ship cache wasn't populated.
        label: "Gemi Bilgileri",
        refetch: async () => {
          const client = getDataverseClient();
          await fetchVesselMasterAndEnrichShipCache(client);
        },
      },
      {
        label: "Tahmini Gider",
        refetch: async () => {
          const client = getDataverseClient();
          const projids = readProjids();
          const result = await listAllByInChunked<Record<string, unknown>>(
            client,
            ENTITY_SETS.expense,
            "mserp_etgtryprojid",
            projids,
            { $select: EXPENSE_COLUMNS.join(","), $count: true }
          );
          writeCache(ENTITY_SETS.expense, {
            fetchedAt: new Date().toISOString(),
            value: result.value,
            totalCount: result.totalCount,
          });
        },
      },
      {
        // Build the exclusion list of sales orders flagged
        // "Finansman" on their header so the next steps (sales
        // aggregate, monthly sales, per-project invoice fetch) can
        // chain a `not In(...)` clause and drop those invoice rows
        // server-side. Label leads with "Hariç" so the user reads
        // it as "we're EXCLUDING financing", not "we're fetching
        // financing".
        label: "Gerçekleşen Satış",
        refetch: async () => {
          const client = getDataverseClient();
          // Discovery + targeted filter via `fetchFinancingOrderIds`:
          //   1. groupby → distinct option-set codes (~5-10 row)
          //   2. eq <Finansman code> → just the financing salesids
          // No full-table pull, no client-side filter on huge payload.
          const ids = await fetchFinancingOrderIds(
            client,
            ENTITY_SETS.salesTable,
            "mserp_salesid"
          );
          writeCache(FINANCING_SALES_IDS_CACHE, {
            fetchedAt: new Date().toISOString(),
            value: ids,
          });
        },
      },
      {
        label: "Gerçekleşen Satınalma",
        refetch: async () => {
          const client = getDataverseClient();
          const ids = await fetchFinancingOrderIds(
            client,
            ENTITY_SETS.purchTable,
            "mserp_purchid"
          );
          writeCache(FINANCING_PURCH_IDS_CACHE, {
            fetchedAt: new Date().toISOString(),
            value: ids,
          });
        },
      },
      // "Gerçekleşen Gider" intentionally OUT of the bulk refresh.
      // Granular distribution lines per project — the tenant-wide
      // payload pushed the localStorage cache over its quota when
      // bundled with lines / ship / expense / sales / etc, causing
      // those caches to be evicted by the older "smart eviction"
      // implementation. Now fetched per-project on demand by the
      // `actualExpense` useEntityRows hook above (effect refetches
      // whenever `selectedProjId` changes).
      {
        // Renamed from "Gerçekleşen Satınalma" — the financing-list
        // step above now owns that label. This step pulls the
        // actual realised purchase invoice rows.
        //
        // Realised project purchases — vendor invoice transactions.
        // Same chunked-IN pattern; FK is `mserp_purchtable_etgtryprojid`
        // (purchtable_ prefix, NOT the standard `mserp_etgtryprojid`).
        // Intercompany rows excluded server-side. Financing-order rows
        // are stripped CLIENT-SIDE here (F&O 405's on `not In(...)`),
        // so the master cache is written already-filtered.
        label: "Satınalma Faturaları",
        refetch: async () => {
          const client = getDataverseClient();
          const projids = readProjids();
          const result = await listAllByInChunked<Record<string, unknown>>(
            client,
            ENTITY_SETS.purchase,
            "mserp_purchtable_etgtryprojid",
            projids,
            {
              $select: PURCHASE_COLUMNS.join(","),
              $count: true,
            },
            undefined,
            NON_INTERCOMPANY_FILTER
          );
          const financingSet = getFinancingPurchIdSet();
          const filtered = financingSet.size > 0
            ? result.value.filter(
                (r) => !financingSet.has(String(r.mserp_purchid ?? ""))
              )
            : result.value;
          writeCache(ENTITY_SETS.purchase, {
            fetchedAt: new Date().toISOString(),
            value: filtered,
            totalCount: result.totalCount,
          });
        },
      },
      { label: "Tahmini Bütçe", refetch: budget.refetch },
      {
        // Per-project invoiced sales totals (segmented by currency).
        // Chunked $apply pipeline — each chunk groups its slice of
        // projids; chunks don't overlap so the row arrays just
        // concatenate. Intercompany rows excluded.
        label: "Satış Toplamları",
        refetch: async () => {
          // Financing-order rows can't be excluded server-side (F&O
          // rejects `not In(...)`, no salesid → header navigation).
          // We include `mserp_salesid` in the groupby key so the
          // response carries one row per (projid, currency, salesid),
          // strip financing salesids client-side, then re-aggregate
          // on (projid, currency) to match the cache shape downstream
          // consumers expect.
          const client = getDataverseClient();
          const projids = readProjids();
          const result = await applyByInChunked<Record<string, unknown>>(
            client,
            "mserp_tryaicustinvoicetransentities",
            "mserp_etgtryprojid",
            projids,
            (inClause) =>
              `filter((${inClause}) and (${NON_INTERCOMPANY_FILTER}))/groupby((mserp_etgtryprojid,mserp_currencycode,mserp_salesid),aggregate(mserp_lineamount with sum as total,$count as cnt))`
          );
          const financingSet = getFinancingSalesIdSet();
          const rolled = new Map<
            string,
            { projid: string; currency: string; total: number; cnt: number }
          >();
          for (const row of result.value) {
            const salesid = String(row.mserp_salesid ?? "");
            if (financingSet.has(salesid)) continue;
            const projid = String(row.mserp_etgtryprojid ?? "");
            const currency = String(row.mserp_currencycode ?? "");
            if (!projid) continue;
            const key = `${projid}::${currency}`;
            const total = Number(row.total) || 0;
            const cnt = Number(row.cnt) || 0;
            const existing = rolled.get(key);
            if (existing) {
              existing.total += total;
              existing.cnt += cnt;
            } else {
              rolled.set(key, { projid, currency, total, cnt });
            }
          }
          const reAggregated: Record<string, unknown>[] = [];
          for (const r of rolled.values()) {
            reAggregated.push({
              mserp_etgtryprojid: r.projid,
              mserp_currencycode: r.currency,
              total: r.total,
              cnt: r.cnt,
            });
          }
          writeCache("salesAggregateByProject", {
            fetchedAt: new Date().toISOString(),
            value: reAggregated,
          });
        },
      },
      {
        // Raw USD invoice rows for the monthly timeline. Currency gate
        // is AND-ed with each chunk's IN clause inside the loop because
        // the chunked helpers don't compose extra filter terms.
        label: "Proje × Ay Satış",
        refetch: async () => {
          const client = getDataverseClient();
          const projids = readProjids();
          if (projids.length === 0) {
            writeCache("salesByProjectMonth", {
              fetchedAt: new Date().toISOString(),
              value: [],
              totalCount: 0,
            });
            return;
          }
          const all: Record<string, unknown>[] = [];
          let totalCount: number | undefined;
          const financingSet = getFinancingSalesIdSet();
          for (let i = 0; i < projids.length; i += 100) {
            const chunk = projids.slice(i, i + 100);
            const inClause = `Microsoft.Dynamics.CRM.In(PropertyName='mserp_etgtryprojid',PropertyValues=[${chunk
              .map((p) => `'${p}'`)
              .join(",")}])`;
            const $filter = `${inClause} and mserp_currencycode eq 'USD' and (${NON_INTERCOMPANY_FILTER})`;
            const result = await client.listAll<Record<string, unknown>>(
              "mserp_tryaicustinvoicetransentities",
              {
                $filter,
                $select:
                  "mserp_etgtryprojid,mserp_invoicedate,mserp_lineamount,mserp_salesid",
                $count: true,
              }
            );
            for (const row of result.value) {
              if (financingSet.size > 0) {
                const salesid = String(row.mserp_salesid ?? "");
                if (financingSet.has(salesid)) continue;
              }
              all.push(row);
            }
            if (typeof result.totalCount === "number") {
              totalCount = (totalCount ?? 0) + result.totalCount;
            }
          }
          writeCache("salesByProjectMonth", {
            fetchedAt: new Date().toISOString(),
            value: all,
            totalCount,
          });
        },
      },
      {
        // Tenant-wide realised-expense rollup — feeds the P&L Cost
        // report. See `actualExpenseRollup.ts` for the 4-stage
        // pipeline. Mirrors the auto-refresh chain step.
        label: "Gerçekleşen Gider Toplamları",
        refetch: async () => {
          const client = getDataverseClient();
          const projids = readProjids();
          const rollup = await fetchActualExpenseRollupForAllProjects(
            client,
            projids
          );
          writeCache(ACTUAL_EXPENSE_ROLLUP_CACHE, {
            fetchedAt: new Date().toISOString(),
            value: rollup,
          });
        },
      },
    ];
  }, [projects.refetch, budget.refetch]);

  // Apply unified filter (period + categorical) on the domain Project
  // list, derive the allowed projectNo set, then narrow the raw rows
  // by `mserp_projid` membership. Sort at the end.
  const allowedProjectNos = React.useMemo(() => {
    const filtered = applyProjectFilter(domainProjects, projectFilters);
    return new Set(filtered.map((p) => p.projectNo));
  }, [domainProjects, projectFilters]);

  const visibleProjects = React.useMemo(() => {
    let filtered = projects.rows.filter((r) =>
      allowedProjectNos.has(String(r.mserp_projid ?? ""))
    );
    if (searchQuery.trim()) filtered = filtered.filter(matchesSearch);
    return sortRows(filtered, projectSort);
  }, [projects.rows, allowedProjectNos, projectSort, searchQuery, matchesSearch]);

  // Resolve selected project from the FULL projects.rows (not filtered) so it
  // survives if the project is filtered out of the visible list.
  const selectedProject = React.useMemo(() => {
    if (!selectedProjId) return null;
    return (
      projects.rows.find((r) => r.mserp_projid === selectedProjId) ?? null
    );
  }, [projects.rows, selectedProjId]);

  // Selected row index within `visibleProjects` (for table highlight only).
  // null when project is filtered out of the visible list.
  const selectedVisibleIndex = React.useMemo(() => {
    if (!selectedProjId) return null;
    const i = visibleProjects.findIndex(
      (r) => r.mserp_projid === selectedProjId
    );
    return i >= 0 ? i : null;
  }, [visibleProjects, selectedProjId]);

  // Selected project's segment — used by Tahmini Bütçe tab to filter rows
  const selectedSegment =
    (selectedProject?.["mserp_tryprojectsegment"] as string | undefined) ??
    null;

  /* Filter children to selected project. */
  const childLines = React.useMemo(
    () =>
      selectedProjId
        ? lines.rows.filter((r) => r["mserp_projid"] === selectedProjId)
        : [],
    [lines.rows, selectedProjId]
  );
  const childShip = React.useMemo(
    () => {
      if (!selectedProjId) return [];
      let rows = ship.rows.filter(
        (r) => r["mserp_tryshipprojid"] === selectedProjId
      );
      // Search applies to the ship-plan child too — user explicitly
      // asked for projects + gemi planı text search in one pass.
      if (searchQuery.trim()) rows = rows.filter(matchesSearch);
      return rows;
    },
    [ship.rows, selectedProjId, searchQuery, matchesSearch]
  );
  const childExpense = React.useMemo(
    () =>
      selectedProjId
        ? expense.rows.filter(
            // FK is `mserp_etgtryprojid` on the new
            // `mserp_tryaiotherexpenseentities` entity.
            (r) => r["mserp_etgtryprojid"] === selectedProjId
          )
        : [],
    [expense.rows, selectedProjId]
  );
  // Expense-line rows are already server-side scoped to the
  // selected project (via the three-step chain in
  // `useProjectExpenseLines` — inventdimb → dist → expense-line),
  // so no client-side filter is needed — a redundant filter on
  // `mserp_etgtryprojid` would always return 0 rows because the
  // expense-line entity doesn't carry that FK.
  const childActualExpense = actualExpense.rows;
  // Realised purchase rows for the selected project — FK is the
  // flattened parent-table column `mserp_purchtable_etgtryprojid`.
  const childPurchase = React.useMemo(
    () =>
      selectedProjId
        ? purchase.rows.filter(
            (r) => r["mserp_purchtable_etgtryprojid"] === selectedProjId
          )
        : [],
    [purchase.rows, selectedProjId]
  );
  // Sales rows for the selected project — joined via mserp_etgtryprojid
  // (custom Tiryaki field on the sales line carrying the project ID).
  // Financing-order rows (mserp_salesid in cached financing set) are
  // stripped here CLIENT-SIDE because F&O rejects `not In(...)` filters
  // server-side. Set is rebuilt on every memo run; cheap (~300 IDs).
  const childSales = React.useMemo(() => {
    if (!selectedProjId) return [];
    const projectRows = sales.rows.filter(
      (r) => r["mserp_etgtryprojid"] === selectedProjId
    );
    const financingSet = getFinancingSalesIdSet();
    return financingSet.size > 0
      ? projectRows.filter(
          (r) => !financingSet.has(String(r["mserp_salesid"] ?? ""))
        )
      : projectRows;
  }, [sales.rows, selectedProjId]);

  // Budget rows filtered to selected project's segment (when applicable).
  // Computed at page level so the tab badge can show the filtered count.
  const filteredBudgetRows = React.useMemo(() => {
    if (!selectedProjId || !selectedSegment || selectedSegment.length === 0) {
      return budget.rows;
    }
    return budget.rows.filter((r) => r.mserp_segment === selectedSegment);
  }, [budget.rows, selectedProjId, selectedSegment]);

  // Top tabs — counts reflect active filter (visible projects + filtered budget)
  const topTabs: TabItem[] = [
    {
      key: "projects",
      label: "Projeler",
      count: visibleProjects.length || projects.rows.length || undefined,
    },
    {
      key: "budget",
      label: "Tahmini Bütçe (Segment)",
      count: filteredBudgetRows.length || undefined,
    },
  ];

  // Bottom panel tabs (only shown when "projects" top tab + project selected)
  const childTabs: TabItem[] = [
    { key: "lines", label: "Proje Satırları", count: childLines.length },
    { key: "ship", label: "Proje-Gemi Planı", count: childShip.length },
    {
      key: "expense",
      label: "Tahmini Gider Satırları",
      count: childExpense.length,
    },
    {
      key: "actualExpense",
      label: "Gerçekleşen Gider Satırları",
      count: childActualExpense.length,
    },
    {
      key: "sales",
      label: "Proje Satış Satırları",
      count: childSales.length,
    },
    {
      key: "purchase",
      label: "Proje Satınalma Satırları",
      count: childPurchase.length,
    },
  ];

  return (
    <ScrollArea className="h-full">
      <div className="space-y-3 pb-3">
        {/* ── Top tabs (Projeler / Tahmini Bütçe) + page actions on the right ── */}
        <GlassPanel tone="default" className="rounded-2xl">
          <div className="px-3 py-2 flex items-center gap-3 flex-wrap">
            <div className="min-w-0 flex-1">
              <TabStrip
                tabs={topTabs}
                activeKey={topTab}
                onChange={(k) => setTopTab(k as TopTabKey)}
              />
            </div>
            {topTab === "projects" && (
              <DataInspectorSearch
                value={searchQuery}
                onChange={setSearchQuery}
              />
            )}
            {topTab === "projects" && (
              <AdvancedFilter
                projects={domainProjects}
                filters={projectFilters}
                onChange={setProjectFilters}
                shipPlanDefault={true}
                resultCount={visibleProjects.length}
                totalCount={projects.rows.length}
                collapsible
              />
            )}
            <RefreshAllButton steps={refreshSteps} />
          </div>
        </GlassPanel>

        {/* ── Top body: master table ── */}
        {topTab === "projects" ? (
          <GlassPanel tone="default" className="rounded-2xl overflow-hidden">
            <CacheBanner
              fetchedAt={projects.fetchedAt}
              isFetching={projects.isFetching}
              loaded={projects.loaded}
              count={visibleProjects.length}
              totalCount={
                projects.rows.length !== visibleProjects.length
                  ? projects.rows.length
                  : projects.totalCount
              }
              error={projects.error}
            />
            {/* Search + Advanced Filter live in the Dataverse Inspector header
             *  now (alongside Güncelle), so no toolbar row needed here. */}
            {/* All-columns sortable table — horizontal scroll for wide schemas.
             *  Compact height so bottom child panel gets more breathing room. */}
            <EntityRowsTable
              rows={visibleProjects}
              // Explicit columns (not just priority) — only these are shown.
              // mserp_isorganic and everything after is hidden + not fetched.
              columns={[...PROJECT_COLUMNS]}
              onRowClick={(row) => {
                const id = row.mserp_projid as string | undefined;
                // Toggle off if clicking the already-selected row
                setSelectedProjId((prev) => (prev === id ? null : id ?? null));
              }}
              selectedIndex={selectedVisibleIndex}
              sort={projectSort}
              onSortChange={setProjectSort}
              emptyText={
                projects.rows.length === 0
                  ? "Henüz çekilmedi — üstten Verileri Güncelle"
                  : "Filtreyle eşleşen proje yok"
              }
              maxHeight="34vh"
            />
          </GlassPanel>
        ) : (
          <BudgetsMaster
            query={budget}
            filteredRows={filteredBudgetRows}
            filterSegment={selectedSegment}
            selectedProjectName={
              selectedProject?.["mserp_projname"] as string | undefined
            }
            selectedProjId={selectedProjId}
            onClearFilter={() => setSelectedProjId(null)}
          />
        )}

        {/* ── Bottom panel: single full-width, 3 tabs (Lines / Ship / Expense) ── */}
        {topTab === "projects" && (
          <GlassPanel tone="default" className="rounded-2xl overflow-hidden">
            <div className="px-3 py-2 border-b border-foreground/[0.04]">
              <TabStrip
                tabs={childTabs}
                activeKey={childTab}
                onChange={(k) => setChildTab(k as ChildTabKey)}
              />
            </div>
            <SelectedProjectInfo selectedProject={selectedProject} />
            {childTab === "lines" && (
              <EntityRowsTable
                rows={childLines}
                // Explicit columns (not priorityColumns) → cached rows with
                // legacy fields (linenum, overdelivery, inventdimid, …) are
                // filtered out on render, even before the next "Güncelle".
                columns={[...PROJECT_LINE_COLUMNS]}
                emptyText={
                  selectedProjId
                    ? "Bu projeye ait satır yok"
                    : "Üstten bir proje seç"
                }
                maxHeight="55vh"
              />
            )}
            {childTab === "ship" && (
              <EntityRowsTable
                rows={childShip}
                priorityColumns={SHIP_DISPLAY_COLUMNS}
                emptyText={
                  selectedProjId
                    ? "Bu projeye ait gemi planı yok"
                    : "Üstten bir proje seç"
                }
                maxHeight="55vh"
              />
            )}
            {childTab === "expense" && (
              <EntityRowsTable
                rows={childExpense}
                // Explicit columns → hide cached fob/cif/export/import/…
                // fields immediately, even before re-fetching.
                columns={[...EXPENSE_COLUMNS]}
                emptyText={
                  selectedProjId
                    ? "Bu projeye ait gider satırı yok"
                    : "Üstten bir proje seç"
                }
                maxHeight="55vh"
              />
            )}
            {childTab === "actualExpense" && (
              <EntityRowsTable
                rows={childActualExpense}
                // Three-step chain: inventdimb → dist → expense-line
                // (rows come from the expense-line entity — auth.
                // amounts + descriptions). `mserp_refexpenseid` is
                // appended as a virtual column populated by the
                // hook's refmap enrichment so the realised side can
                // show the same textual class (`OPEX`, `FREIGHT`,
                // …) the forecast table already shows.
                columns={[...EXPENSE_LINE_COLUMNS, "mserp_refexpenseid"]}
                emptyText={
                  selectedProjId
                    ? actualExpense.error
                      ? `Hata: ${actualExpense.error}`
                      : actualExpense.isFetching
                        ? "Yükleniyor…"
                        : "Bu projeye ait gerçekleşen gider kaydı yok"
                    : "Üstten bir proje seç"
                }
                maxHeight="55vh"
              />
            )}
            {childTab === "sales" && (
              <EntityRowsTable
                rows={childSales}
                columns={[...SALES_COLUMNS]}
                emptyText={
                  selectedProjId
                    ? sales.rows.length === 0
                      ? "Henüz çekilmedi — üstten Güncelle"
                      : "Bu projeye ait fatura kesilmiş satış satırı yok"
                    : "Üstten bir proje seç"
                }
                maxHeight="55vh"
              />
            )}
            {childTab === "purchase" && (
              <EntityRowsTable
                rows={childPurchase}
                // Explicit columns — only the 12 confirmed fields render.
                columns={[...PURCHASE_COLUMNS]}
                emptyText={
                  selectedProjId
                    ? purchase.rows.length === 0
                      ? "Henüz çekilmedi — üstten Verileri Güncelle"
                      : "Bu projeye ait satınalma satırı yok"
                    : "Üstten bir proje seç"
                }
                maxHeight="55vh"
              />
            )}
          </GlassPanel>
        )}
      </div>
    </ScrollArea>
  );
}

/* ─────────── Sub-views ─────────── */

function BudgetsMaster({
  query,
  filteredRows,
  filterSegment,
  selectedProjectName,
  selectedProjId,
  onClearFilter,
}: {
  query: ReturnType<typeof useEntityRows<Record<string, unknown>>>;
  /** Already-filtered rows from page (matches the tab-badge count). */
  filteredRows: Record<string, unknown>[];
  /** Selected project's segment — non-empty when filter is active. */
  filterSegment: string | null;
  selectedProjectName?: string | null;
  selectedProjId: string | null;
  onClearFilter: () => void;
}) {
  // Distinguish: filter active (segment non-empty) vs. project picked but segment blank
  const projectSelected = !!selectedProjId;
  const filterActive = projectSelected && !!filterSegment && filterSegment.length > 0;

  // Default sort: mserp_year desc (newest budget periods first)
  const [budgetSort, setBudgetSort] = React.useState<SortState | null>({
    field: "mserp_year",
    direction: "desc",
  });
  const sortedRows = React.useMemo(
    () => sortRows(filteredRows, budgetSort),
    [filteredRows, budgetSort]
  );

  return (
    <GlassPanel tone="default" className="rounded-2xl overflow-hidden">
      <CacheBanner
        fetchedAt={query.fetchedAt}
        isFetching={query.isFetching}
        loaded={query.loaded}
        count={filteredRows.length}
        totalCount={
          query.rows.length !== filteredRows.length
            ? query.rows.length
            : query.totalCount
        }
        error={query.error}
      />
      {projectSelected && (
        <div className="px-4 py-2 bg-foreground/[0.025] border-b border-foreground/[0.04] flex items-center gap-2 text-[11px] flex-wrap">
          {filterActive ? (
            <>
              <span className="text-muted-foreground">Segment filtresi:</span>
              <code className="font-mono font-semibold text-foreground">
                {filterSegment}
              </code>
            </>
          ) : (
            <>
              <span className="text-amber-700 font-medium">
                ⚠ Seçili projenin segmenti boş — filtre uygulanmadı, tüm
                bütçeler gösteriliyor
              </span>
            </>
          )}
          {selectedProjectName && (
            <span className="text-muted-foreground truncate min-w-0">
              · {selectedProjectName}
            </span>
          )}
          <button
            type="button"
            onClick={onClearFilter}
            className="ml-auto h-6 px-2 rounded-md text-[10.5px] font-medium text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors shrink-0"
          >
            Seçimi kaldır
          </button>
        </div>
      )}
      <EntityRowsTable
        rows={sortedRows}
        // Explicit columns → hide cached itemid/accountnum/namealias/custname/
        // primaryfield/entityid fields right away, even before re-fetching.
        columns={[...BUDGET_COLUMNS]}
        sort={budgetSort}
        onSortChange={setBudgetSort}
        emptyText={
          query.rows.length === 0
            ? "Henüz çekilmedi — üstten Verileri Güncelle"
            : filterActive
            ? `'${filterSegment}' segmentine ait bütçe satırı yok`
            : "Veri yok"
        }
        maxHeight="60vh"
      />
    </GlassPanel>
  );
}

function CacheBanner({
  fetchedAt,
  isFetching,
  loaded,
  count,
  totalCount,
  error,
}: {
  fetchedAt: string | null;
  isFetching: boolean;
  loaded: number | null;
  count: number;
  totalCount?: number;
  error: Error | null;
}) {
  if (error) {
    return (
      <div className="px-4 py-2.5 border-b border-rose-200 bg-rose-50 text-rose-700 text-[11.5px]">
        Hata: {error.message}
      </div>
    );
  }
  if (!fetchedAt && !isFetching) return null;
  const ago = fetchedAt ? humanAgo(new Date(fetchedAt)) : null;
  return (
    <div className="px-4 py-2 border-b border-foreground/[0.04] flex items-center gap-2 text-[10.5px] text-muted-foreground">
      <span
        className={cn(
          "size-1.5 rounded-full",
          isFetching ? "bg-amber-500 animate-pulse" : "bg-emerald-500"
        )}
      />
      {isFetching ? (
        loaded !== null ? (
          <>Yükleniyor… <span className="tabular-nums font-semibold text-foreground">{loaded.toLocaleString("tr-TR")}</span> kayıt</>
        ) : (
          "Bağlanıyor…"
        )
      ) : (
        <>
          <span>Son güncelleme: <span className="font-semibold text-foreground">{ago}</span></span>
          <span>·</span>
          <span>
            <span className="font-semibold text-foreground tabular-nums">
              {count.toLocaleString("tr-TR")}
            </span>
            {totalCount !== undefined && totalCount > count && (
              <> / {totalCount.toLocaleString("tr-TR")}</>
            )}
            {" "}kayıt
          </span>
        </>
      )}
    </div>
  );
}

function SelectedProjectInfo({
  selectedProject,
}: {
  selectedProject: Record<string, unknown> | null;
}) {
  if (!selectedProject) return null;
  return (
    <div className="px-4 py-1.5 bg-foreground/[0.025] border-b border-foreground/[0.04] text-[10.5px] flex items-center gap-2 flex-wrap">
      <span className="text-muted-foreground">Filtre:</span>
      <code className="font-mono font-semibold text-foreground">
        {String(selectedProject["mserp_projid"] ?? "—")}
      </code>
      <span className="text-muted-foreground truncate flex-1 min-w-0">
        {String(selectedProject["mserp_projname"] ?? "")}
      </span>
    </div>
  );
}

function humanAgo(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "şimdi";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} dk önce`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} saat önce`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} gün önce`;
  return d.toLocaleDateString("tr-TR");
}

/**
 * Free-text search input for the Veri Yönetimi top bar — sits to
 * the LEFT of the AdvancedFilter trigger and filters BOTH the
 * projects master table AND the ship-plan child rows by matching
 * the query against every column value (case-insensitive
 * substring). Composes with the AdvancedFilter chip-based narrowing
 * (filter narrows by dimension; search narrows by substring).
 *
 * Style mirrors the ProjectList search pill — rounded-full, accent
 * search icon on the left, X-clear on the right, soft drop shadow
 * + inset highlight for the glassy disc look. Capped at 280px so
 * the toolbar stays compact alongside the filter pill +
 * RefreshAllButton.
 */
function DataInspectorSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const accent = useThemeAccent();
  return (
    <div className="relative w-full max-w-[280px] shrink-0 min-w-[180px]">
      <HugeiconsIcon
        icon={Search01Icon}
        size={15}
        strokeWidth={2.25}
        className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none z-[1]"
        style={{ color: accent.solid }}
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Proje veya gemi planı içinde ara…"
        aria-label="Veri yönetimi içinde ara"
        className={cn(
          "w-full h-9 pl-9 pr-7 rounded-full text-[13px] outline-none",
          "bg-white/85 backdrop-blur-xl backdrop-saturate-150",
          "ring-1 ring-foreground/15 hover:ring-foreground/30 focus:ring-2 focus:ring-ring",
          "placeholder:text-muted-foreground/70 transition-shadow"
        )}
        style={{
          boxShadow:
            "0 4px 12px -4px rgba(15,23,42,0.18), inset 0 1px 0 0 rgba(255,255,255,0.85)",
        }}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Aramayı temizle"
          className="absolute right-2 top-1/2 -translate-y-1/2 size-5 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] z-[1]"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}
