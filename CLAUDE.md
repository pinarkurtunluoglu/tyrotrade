# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Vite dev server on http://localhost:5173/TYROInternationalTrade/
npm run build     # tsc -b (composite project typecheck) then vite build
npm run preview   # Serve the built dist
npm run lint      # tsc --noEmit (no separate ESLint configured)

python scripts/build-mocks.py   # Regenerate src/mocks/projects.ts from Excel
```

There is no test runner configured. `npm run lint` runs the TypeScript compiler in noEmit mode — that is the contract for "did I break anything." Always run lint before claiming work is done.

## What this app is

TYRO International Trade ("tyrotrade") — a dashboard for Tiryaki's international commodity trade operations: buying grain / oilseed at one port, shipping it to another via vessel or truck, tracking budget vs. actuals across the voyage. The data model mirrors the Dynamics 365 F&O **TRYK Projeler** module (project header + vessel plan + project lines + cost estimate + actuals). Active scope is filtered server-side to `mserp_dlvmode eq 'Gemi' and mserp_tryprojectsegment ne null` (~320 sea projects).

Main app surfaces (each is its own page module):

- `/` — **Dashboard** (BentoGrid KPI tiles + Leaderboards + Events)
- `/projects` and `/projects/:projectId` — **Vessel Projects** (3-pane: list + map + detail rail)
- `/pl-cost` — **Trade Cost** (Tahmini × Gerçekleşen — segment-level hierarchical comparison; route prefix `/pl-cost` preserved for code-search continuity, UI label says "Trade Cost")
- `/data` — **Veri Yönetimi** inspector (raw entity tabs + refresh button)
- `/settings`, `/help` — config / help

Sibling apps share the lowercase wordmark and Inter Variable font:

- **tyrostrategy** (`C:\Users\Cenk\Desktop\tyrostrategy-repo\tyrostrategy-app`) — gold gradient identity
- **TYRO Stock** (sibling inventory/WMS app, opens `https://tyrowms.github.io/` in a new tab — host name kept until the rebrand moves) — aurora gradient identity

tyrotrade itself uses **sky-navy** (`#38bdf8 → #2563eb → #1e3a8a` via `.text-brand-gradient`). Don't reintroduce gold on the tyrotrade wordmark.

## Architecture

**Stack:** React 19 + TypeScript 5.7 + Vite 6 + Tailwind v4 (`@tailwindcss/vite`, `@theme inline` tokens in `src/globals.css` — no `tailwind.config.js`) + shadcn/ui new-york style + react-router 7 (HashRouter) + MapLibre GL via `react-map-gl/maplibre` + Turf for sea-route geometry + MSAL.js for Dataverse auth + framer-motion + recharts. Path alias: `@/*` → `src/*`.

### 🔒 READ-ONLY invariant

**This app never writes to Dataverse.** The `DataverseClient` interface (`src/lib/dataverse/client.ts`) exposes only `list()` + `get()` — no `create`/`update`/`patch`/`delete`. Both `realClient.ts` and `mockClient.ts` honour this. Any code introducing `useMutation`, `method: "POST/PATCH/PUT/DELETE"`, or `If-Match` headers is a regression. Sanity check:

```
git grep -nE "useMutation|method:.*\b(POST|PATCH|PUT|DELETE)\b" src/    # must return nothing
```

The only writer in the app is `writeCache()` in `src/lib/storage/entityCache.ts`, which writes to **localStorage**, not Dataverse.

### Routing model — GitHub Pages constraints

- `vite.config.ts` has `base: "/TYROInternationalTrade/"`. Asset URLs must respect `import.meta.env.BASE_URL`.
- `main.tsx` uses **HashRouter** — avoids the GH Pages 404.html dance under the sub-path.
- `/login` is a standalone full-screen page (Globe scene + MSAL `loginRedirect`). Everything else lives inside `<AppShell>` (sidebar + topbar) behind `<AuthGate>`. See `src/App.tsx`.

### Dataverse pipeline (the big architecture)

This is the most important section to internalise. Real F&O data flows through four cooperating layers:

```
                 ┌─────────────────────────────────────────────────┐
                 │  RefreshAllButton or post-login auto-refresh    │
                 │  → src/lib/dataverse/refreshAll.ts              │
                 │    runs ~10-step async chain (6 entities + 2    │
                 │    sales aggregates + vessel-master enrichment) │
                 └────────────────────┬────────────────────────────┘
                                      │ writeCache(entitySet, …)
                                      ▼
                 ┌─────────────────────────────────────────────────┐
                 │  localStorage   tyro:dv:<entitySet>             │
                 │  src/lib/storage/entityCache.ts                 │
                 │  — single source of truth for every consumer    │
                 │  — writeCache() AND clearCache() both fire      │
                 │    `tyro:cache-updated` so same-tab subscribers │
                 │    re-render on writes AND invalidations        │
                 └────────────────────┬────────────────────────────┘
                                      │ readCache(entitySet)
                ┌─────────────────────┴────────────────────┐
                ▼                                          ▼
   ┌────────────────────────────┐      ┌────────────────────────────────┐
   │ useRealProjects()          │      │ useEntityRows({entitySet,$q})  │
   │ src/hooks/useRealProjects  │      │ src/hooks/useEntityRows.ts     │
   │ joins 5 caches via         │      │ raw row reader for the         │
   │ composeProjects()          │      │ Veri Yönetimi inspector        │
   │ → Project[] for the UI     │      │                                │
   └─────────────┬──────────────┘      └────────────────────────────────┘
                 │
                 ▼
   ┌────────────────────────────┐
   │ useProjects() — mock-vs-   │
   │ real branch (VITE_USE_MOCK)│
   │ Dashboard, Projects page,  │
   │ CommandPalette use this    │
   └────────────────────────────┘
```

**Mock vs real toggle.** `getDataverseClient()` in `src/lib/dataverse/index.ts` reads `import.meta.env.VITE_USE_MOCK`. Default (unset) → mock. `VITE_USE_MOCK=false` → real client (requires MSAL login). `useProjects()` mirrors the same toggle: real mode hydrates from the cache via `useRealProjects()`, mock mode imports `mockProjects` directly.

**Cache fingerprint pattern.** `useRealProjects` doesn't deep-compare cache contents — it reads an 80-char prefix of each `tyro:dv:<entitySet>` localStorage value as a fingerprint, listens to both the native `storage` event (cross-tab) AND a custom `tyro:cache-updated` event (same-tab, fired by `writeCache`), and re-runs `composeProjects` only when a fingerprint changes. Don't replace this with full `useState` of large arrays — performance was specifically tuned around the fingerprint approach.

**Per-project on-demand hooks.** `useProjectInvoices`, `useProjectExpenseLines`, `useProjectActualExpense`, `useProjectFull` fetch project-scoped data when a single project is selected. They DON'T go through the `tyro:dv:*` cache — they fetch on every project change with in-memory state and a `cancelled` flag in the effect cleanup. This avoids cache quota issues on small per-project datasets. Every `await` in these hooks must be followed by `if (cancelled) return` or stale state will leak across project switches.

**Derived synthetic caches (lazy-loaded by their consumer page).** Some pages need a tenant-wide aggregation that's too slow to run inside the main refresh chain. The current example is `tyro:dv:actualExpenseRollup` (used by Trade Cost — see `useActualExpenseRollup`): a 4-stage pipeline (inventdimb → dist → expense-line + parallel refmap) that takes ~30-60 s across all 224 active projects. It's NOT a real Dataverse entity set — `writeCache` just accepts any string key. Pattern:

- Lazy auto-fetch on page mount when the cache is empty or older than 6 h.
- Manual "Yenile" button on the page re-runs it explicitly.
- The main `refreshAllEntities` chain calls `clearCache(ACTUAL_EXPENSE_ROLLUP_CACHE)` at the end so the next Trade Cost visit re-runs the pipeline (the underlying invoice/expense rows just changed). The `tyro:cache-updated` event from `clearCache` makes the same-tab consumer drop its rows immediately.

If you add another expensive aggregation, follow this lazy pattern instead of growing the refresh chain.

### F&O / `mserp_*` entity conventions

Field names follow the `mserp_<domain>` virtual-entity prefix from F&O dual-write. Things to know:

- **`@FormattedValue` annotations.** `Prefer: odata.include-annotations="*"` is set on every request. Numeric-coded fields (`mserp_voyagestatus`, `mserp_status`, `mserp_tryexpensetype`, …) carry an `@FormattedValue`-suffixed sibling property with the human label. The composer reads both — see `getFormattedOrRaw()` in `src/lib/dataverse/formatted.ts`.
- **Project FK is not uniform.** Most child entities use `mserp_etgtryprojid`. The vendor-purchase entity uses `mserp_purchtable_etgtryprojid` (FK lives on the parent purchase table). The realised distribution-line entity has no usable project FK at all — see "3-step expense chain" below.
- **`NON_INTERCOMPANY_FILTER`** (`src/lib/dataverse/refreshAll.ts`) is `(mserp_intercompanyinventtransid eq null or mserp_intercompanyinventtransid eq '')`. The Tiryaki tenant populates this column with empty-string instead of NULL on non-intercompany rows, so a pure `eq null` clause leaks intercompany rows into the cache. Always splice this constant via `${NON_INTERCOMPANY_FILTER}` (it's pre-wrapped in parens) — don't open-code it.
- **`IN_CHUNK_SIZE = 50`** for `Microsoft.Dynamics.CRM.In(PropertyName='X', PropertyValues=[…])` clauses. Helpers `listAllByInChunked` / `applyByInChunked` in `refreshAll.ts` and the inline loops in per-project hooks all use 50 to keep URL length under enterprise-proxy limits.
- **`columnOrder.ts` is locked.** Each `<ENTITY>_COLUMNS` constant is the `$select` list AND the inspector display order. Don't speculatively widen — Dataverse 400's on `$select` of properties not on the virtual entity. Notable removed/rejected fields are documented inline (e.g. `mserp_vesselname` was removed from ship-relation in the May 2026 schema refresh; `mserp_currencycode` is rejected on `mserp_tryaiexpenselineentities`).

### 3-step expense chain (and the refmap step)

`useProjectExpenseLines` is the most complex per-project chain. It exists because the distribution entity has no project FK we can rely on:

```
Step 0 (parallel) ─ mserp_inventdimbientities
                    $filter mserp_inventdimension2 eq '<projectNo>'
                    $select mserp_inventdimid                            ┐
                                                                         │
Step R (parallel) ─ mserp_tryaiotherexpenseprojectlineentities           │
                    $filter mserp_etgtryprojid eq '<projectNo>'          │ Promise.allSettled
                    $select mserp_tryexpensetype, mserp_refexpenseid     │
                    → builds expensetype→refexpenseid map (best-effort)  ┘

Step 1 ─ mserp_tryaifrtexpenselinedistlineentities
         chunked $filter In(mserp_inventdimid, [50 ids per request])
         $select mserp_expensenum  → distinct expensenums

Step 2 ─ mserp_tryaiexpenselineentities
         chunked $filter In(mserp_expensenum, [50 ids per request])
         $select EXPENSE_LINE_COLUMNS  → authoritative rows

Step 3 ─ enrich each Step-2 row by setting `mserp_refexpenseid` from
         Step-R map keyed on row's `mserp_expenseid` (so realised side
         carries the same textual class — OPEX, FREIGHT — that the
         forecast side shows)
```

The refmap step is best-effort: a failure logs a warning and the chain proceeds with raw rows (the textual class column reads empty in the UI).

**Tenant-wide variant for Trade Cost.** The same 4-stage pipeline runs at scale in `fetchActualExpenseRollupForAllProjects` (`src/lib/dataverse/actualExpenseRollup.ts`) — one IN-chunked sweep across every active projectNo instead of one project at a time. Output is a flat `ActualExpenseRollupRow[]` (per-project × expenseId aggregate) cached at `tyro:dv:actualExpenseRollup`. Same refmap join, same 710041 sign-flip — so per-project drill-downs and the Trade Cost aggregate always agree.

### Special-case rules in P&L math

- **Code `710041` (Satış Fiyat Farkı)** is an FX-driven sales price-difference adjustment that REDUCES realised expense burden. In `BudgetSalesCard.tsx`, `actualExpenseRollup.ts`, and any future P&L surface, rows with `mserp_expenseid === "710041"` are rendered as positive (green `+$X`) instead of negative AND subtracted from the realised total instead of added. The headline "Gerçekleşen Gider" can flip sign when net price-diff exceeds raw expenses (rare but handled). Hard-coded by code via `PRICE_DIFF_EXPENSE_CODE` — if F&O introduces another such code, add it next to that constant in BOTH files.
- **`selectTransitDays(p)`** in `src/lib/selectors/project.ts` is the single source of truth for transit-day computation. Both `aggregateAvgTransitDays` (Velocity tile) and `VelocityBreakdown` (drawer) read it so tile and breakdown numbers always agree.

### Trade Cost report (`/pl-cost`)

The Tahmini × Gerçekleşen comparison page is structurally distinct enough to be worth documenting:

- **Page module**: `src/pages/PLCostPage.tsx`. Internal identifiers (file name, hook name, types) preserved the legacy "PL Cost" naming for code-search continuity; the UI label is "Trade Cost". Don't rename the files.
- **Cache + progress**: `useActualExpenseRollup()` is the only hook the page reads expense numbers from. While `isFetching` is true (initial mount with empty cache, post-Veri-Yönetimi invalidation, or manual "Yenile"), the entire content area is replaced by `PLCostProgress` — a chain-of-thought "AI thinking" panel that narrates each of the five rollup stages. The headline phrase rotates with the currently-running stage (`STAGE_META[stage].aiPhrase`). No background-spinner state — every active fetch is a full takeover so the user always sees what's happening.
- **Tree builder**: `buildPLCostTree(projects, rollupRows, viewMode)` in `src/lib/selectors/plCost.ts` produces a 4-level hierarchy — `Segment → Voyage Status → Vessel|Project → Expense Line`. `viewMode` ("vessel" / "project") only changes the L3 grouping key. Parent metrics are bottom-up sums; derived ratios (R/E %, R/E Ton %) are re-derived at every level by `finaliseMetrics`.
- **Sortable columns**: `sortTree(nodes, key, dir)` in `PLCostTable.tsx` recurses through every level so each parent's children reorder in place. Sort state lives in the table; click toggles asc ↔ desc, switching column resets to that column's natural default (alpha → asc, numeric → desc). Nulls always sort to the end regardless of direction.
- **Smart insights ribbon**: `generateSmartInsights(tree)` in `src/lib/selectors/plInsights.ts` produces up to five segment-level callouts (En Dengeli / En Masraflı / En Az Masraflı / Tahminden En Çok Sapan / Tahminden En Az Sapan). Diversification logic: each slot iterates its own ranked candidate list and picks the highest-ranked segment that isn't already consumed by a higher-priority slot — every slot reliably surfaces a distinct segment instead of silently dropping when its #1 candidate collides.
- **Detail panel deep links**: `PLCostDetailPanel` turns any visible projectNo (`PRJ000…`, `TRKTHL01305`, etc. via `/^[A-Z]{3,}\d{3,}$/` heuristic) into `<Link to="/projects/X" state={{ focusProjectNo: X }}>`. `ProjectsPage` consumes that state once and pre-filters the left rail to one project so the user lands with no ambiguity about which project just opened.
- **Quick filters**: 6 multiselect comboboxes (`PLCostQuickFilters`) share the same `ProjectFilterState` as the popover-style `AdvancedFilter` button next to them — edits in one surface mirror the other. Triggers use `MultiSelectCombobox` in **compact mode** (`compact={true}` prop): fixed `h-9 rounded-full` height, single selected chip + "+N" overflow pill instead of stacking chips down. This mode only exists for tight toolbars; default (wrap-and-grow `min-h-10 rounded-lg`) is preserved for AdvancedFilter popover and Dashboard.
- **Trade Cost-specific filter defaults**: `makeEmptyFilters({ period: "all", includeWithoutShipPlan: true })` — period defaults to "all" because Tahmini × Gerçekleşen lifecycles span multiple fiscal years. The AdvancedFilter on this page passes `periodDefault="all"` so its active-filter badge doesn't fire on the page's own default.

### Mock data pipeline (offline / dev mode)

`src/mocks/projects.ts` is **auto-generated** (~1.6 MB). Workflow:

1. Source: `C:/Users/Cenk/Downloads/TRYK Projeler_639126704967068109.xlsx` (real F&O export, header rows only).
2. Generator: `scripts/build-mocks.py` parses vessel names from project titles via regex (last `MV`/`MT` match wins), infers ports + commodity + supplier from heuristic keyword matching, synthesizes milestone dates by mapping `(today - projectDate)` to a stage (at-loading / loading / in-transit / at-discharge / discharged), and writes the TS file.
3. Reference date: `TODAY = datetime(2026, 4, 25)` inside the script. Progress states are stable as long as this matches `useRouteProgress`'s default `now`.

When `entities.ts` types change, **both** the script's TS emitter and the type definitions must be updated together, then re-run the script. Real Dataverse is the production default; mock is for offline development with no auth round-trip.

### Sea-route waypoint corridors

`src/lib/routing/seaRoute.ts` builds a `LineString` from origin → optional waypoints → destination using `@turf/great-circle` for each segment. **Never use a single great-circle pair for routes that cross continents** — it cuts across land. Projects supply explicit waypoints through known maritime corridors. Reusable corridors live in both `scripts/build-mocks.py` (for synthesis) and `src/lib/routing/corridors.ts` (for runtime composition from real Dataverse rows): `ARG_TO_GIB`, `BRAZIL_TO_GIB`, `BLACK_SEA_TO_MED`, `MED_TO_SUEZ`, `SUEZ_TO_GULF`, `TURKEY_TO_EGYPT`. New routes need a waypoint list that hugs straits/canals (Bosphorus, Gibraltar, Suez, Hormuz, Bab-el-Mandeb).

`src/lib/routing/portCoordinates.ts` is the port lookup; unresolved port names are surfaced via `useRealProjects` warning so they can be added in batches rather than discovered one-by-one.

### Route progress logic

`src/lib/routing/progress.ts` maps `VesselMilestones` + `VesselStatus` + `now` → `progress` (0..1) and a `stage` label. The animated vessel marker uses `@turf/along` keyed by `progress * totalKm`; the completed segment is `lineSliceAlong(line, 0, completedKm)`.

### Map gotchas

- **Paint colors must be hex/rgba, not OKLCH.** MapLibre's paint validator rejects `oklch(...)` in `line-color` / `fill-color`. Use hex or `rgba()` for any `<Layer paint={{...}}>` value, even though the rest of the codebase uses OKLCH for CSS.
- **No Radix Tooltip inside Marker.** `react-map-gl` `<Marker>` mounts via portal which breaks the `TooltipProvider` context chain. Use the native HTML `title` attribute for marker hover text. Tooltips on map controls (the corner glass panel) work fine because they render inline.
- **Discharge port chip is dynamic.** The varış-limanı chip in `RouteMap.tsx` doesn't pin to DP-ETA — `pickLatestDpMilestone` walks `dpEd > dpSd > dpNorAccepted > dpEta` and shows whichever populated milestone is most recent. Falls back to DP-ETA's slot when all are null.

### Theme system

Three sidebar themes: `"navy" | "light" | "black"` — persisted under `tyro:sidebar:theme`. Default for new visitors / cleared cache is **`"light"`**. `useThemeAccent()` (`src/components/layout/theme-accent.ts`) returns `{ solid, gradient, ring, ringStrong, tint }` per theme:

- light → sky
- navy → amber/gold
- black → bright sky

Components style accent surfaces via inline `style={{ background: accent.gradient, … }}`, NOT via hardcoded colors. The `AccentIconBadge` component (`src/components/details/AccentIconBadge.tsx`) takes a fixed `tone` prop (`TONE_PL`, `TONE_EXPENSE`, `TONE_FORECAST`, `TONE_AI`, …) for semantic colours that should be theme-independent (e.g. profit always emerald, AI always teal).

### Glass / brand design tokens

Glass surfaces and brand colours are CSS classes in `src/globals.css`:

- `.glass`, `.glass-strong`, `.glass-subtle`, `.glass-noise` — light frosted surfaces
- `.sidebar-dark` — blue gradient sidebar surface
- `.text-brand-gradient` — sky-navy gradient on the "trade" half of the wordmark and accent text. The legacy `.text-gold-gradient` was renamed during Phase F.1 — do not reintroduce gold on the wordmark.

Wordmark is always lowercase: "tyro" (black on light, white on dark) + "trade" (sky-navy gradient). See `src/components/brand/Wordmark.tsx` and `Logo.tsx`.

### Sidebar behavior

`src/components/layout/sidebar-context.tsx` tracks `pinned` (persisted under `tyro:sidebar:pinned`) and `hovering`. Effective expanded state = `pinned || hovering`. `AppShell.tsx`'s `DesktopSidebarSlot` drives `hovering` with a 180ms close delay to avoid flicker. Mobile uses a shadcn `Sheet` drawer instead of hover.

The Sistem group (below the main nav, above the footer) carries two sibling-app shortcuts above Yardım: **TYRO AI** (button — opens the right-side AI drawer) and **TYRO Stock** (external link — opens the WMS sibling app in a new tab). They live in the sidebar instead of the topbar so the topbar stays compact; the AI drawer state is lifted to `ShellInner` and the sidebar receives an `onOpenAi` callback. The TYRO Stock row uses the origami `<Logo palette="aurora" />` as its icon (a tiny sibling-app brand mark); TYRO AI uses the same `AiBrain02Icon` the drawer header carries so the click visually rhymes with the drawer that opens. Render via `SidebarToolItem` — the icon prop is `iconNode: ReactNode` (any element, not a HugeIcon-only signature), with an optional `accentDot` for monochrome glyphs.

### Field labels + inspector configuration

- `src/lib/dataverse/fieldLabels.ts` — Turkish display labels keyed by Dataverse field name.
- `src/lib/dataverse/entityConfig.ts` — per-entity metadata for the Veri Yönetimi inspector (tab title, primary key, featured columns).
- `src/lib/dataverse/columnOrder.ts` — per-entity priority lists for the inspector. Includes `*_DISPLAY_COLUMNS` variants when display order diverges from `$select` order (e.g. `SHIP_DISPLAY_COLUMNS` injects vessel-master-enriched fields like `mserp_vesselname` near the top).

## Conventions specific to this repo

- **Turkish + English mix is intentional.** UI labels Turkish, code English. Don't translate either way without being asked.
- **The user prefers to drive the browser preview themselves.** Don't run `preview_screenshot` / `preview_eval` for verification unless explicitly asked.
- **When changing brand / accent colours**, update `globals.css` tokens and `useThemeAccent()` mappings — don't hardcode hex values in component files. Existing hardcoded references (sidebar gradient stops, logo SVG fills) are intentional.
- **When adding a new Dataverse fetch**, ask: does this row apply to all projects (→ master cache via `refreshAll.ts`) or just one (→ per-project on-demand hook)? Don't grow the master-cache list lightly — localStorage quota is real, and 320-project × N-rows multiplications hit 5 MB faster than expected.
- **Don't auto-stick fields into `$select`.** When schema changes are flagged, verify field existence on a sample row first — the diagnostic-enriched 400 toast surfaces the rejected field name. Speculative additions are the most common source of "everything stopped loading" regressions.
- **Phase plan history** lives at `C:\Users\Cenk\.claude\plans\`. The active plan file is dynamic-named (e.g. `web-uygulamas-yapaca-m-mobil-gentle-coral.md`). Phases A–L are largely shipped; new structural work usually starts a new plan rather than amending the existing one.
