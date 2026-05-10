import * as React from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  DashboardSpeed01Icon,
  Database01Icon,
  RefreshIcon,
  BoatIcon,
  Briefcase01Icon,
} from "@hugeicons/core-free-icons";
import { Loader2 } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { GlassPanel } from "@/components/glass/GlassPanel";
import { Button } from "@/components/ui/button";
import { useThemeAccent, type ThemeAccent } from "@/components/layout/theme-accent";
import { useProjects } from "@/hooks/useProjects";
import { useActualExpenseRollup } from "@/hooks/useActualExpenseRollup";
import {
  buildPLCostTree,
  aggregateRootMetrics,
  type ViewMode,
  type PLCostNode,
} from "@/lib/selectors/plCost";
import { PLCostTable } from "@/components/pl-cost/PLCostTable";
import { PLCostKpiTiles } from "@/components/pl-cost/PLCostKpiTiles";
import { PLCostProgress } from "@/components/pl-cost/PLCostProgress";
import { PLCostInsightsRibbon } from "@/components/pl-cost/PLCostInsightsRibbon";
import { PLCostDetailPanel } from "@/components/pl-cost/PLCostDetailPanel";
import { PLCostQuickFilters } from "@/components/pl-cost/PLCostQuickFilters";
import { generateSmartInsights } from "@/lib/selectors/plInsights";
import { AdvancedFilter } from "@/components/filters/AdvancedFilter";
import {
  applyProjectFilter,
  makeEmptyFilters,
  type ProjectFilterState,
} from "@/lib/filters/projectFilters";

/**
 * P&L Cost — Tahmini × Gerçekleşen maliyet karşılaştırma raporu.
 *
 * Layout:
 *   - Toolbar: title + view-mode segmented control (Gemi/Proje) +
 *     manual "Yenile" button
 *   - 5 KPI tiles (Toplam Tahmini, Gerçekleşen, %, Δ, En Sapan)
 *   - Hierarchical table: Segment → Voyage → Vessel/Project → Expense
 *
 * Data:
 *   - Project skeleton from `useProjects` (filtered by composer)
 *   - Realised expense rollup from `useActualExpenseRollup`
 *     (lazy auto-fetched on mount, 6h freshness cache)
 */
export function PLCostPage() {
  const accent = useThemeAccent();
  const { projects: rawProjects } = useProjects();
  const rollup = useActualExpenseRollup();
  const [viewMode, setViewMode] = React.useState<ViewMode>("project");
  // Unified filter state (period + categorical multi-selects). Same
  // shape Vessel Projects + Dashboard use, so the AdvancedFilter
  // popover renders identical UI here. Default = current FY +
  // ship-plan-included, with `includeWithoutShipPlan: true` so a
  // project missing a vessel plan still shows up (P&L data lives on
  // the project, not the voyage).
  const [filters, setFilters] = React.useState<ProjectFilterState>(() =>
    makeEmptyFilters({ includeWithoutShipPlan: true })
  );
  const now = React.useMemo(() => new Date(), []);

  // Apply the unified filter on the domain project list. Tree builds
  // off the filtered subset.
  const projects = React.useMemo(
    () => applyProjectFilter(rawProjects, filters, now),
    [rawProjects, filters, now]
  );
  const totalProjects = projects.length;

  // Build the tree only once per (projects × rollup × viewMode) combo.
  const tree = React.useMemo<PLCostNode[]>(() => {
    if (rollup.isEmpty || projects.length === 0) return [];
    return buildPLCostTree(projects, rollup.rows, viewMode);
  }, [projects, rollup.rows, rollup.isEmpty, viewMode]);

  const rootMetrics = React.useMemo(
    () => aggregateRootMetrics(tree),
    [tree]
  );

  // Find the L3 row with the largest |deltaUsd| — this is the
  // "En Sapan" KPI tile. Skip nodes whose expected is 0 (they
  // produce infinite ratios but no real signal).
  const topVariance = React.useMemo(() => {
    let best: { node: PLCostNode } | null = null;
    const walk = (nodes: PLCostNode[]) => {
      for (const n of nodes) {
        if (n.level === 3 && n.metrics.expectedUsd > 0) {
          if (
            !best ||
            Math.abs(n.metrics.deltaUsd) >
              Math.abs(best.node.metrics.deltaUsd)
          ) {
            best = { node: n };
          }
        }
        if (n.children) walk(n.children);
      }
    };
    walk(tree);
    if (!best) return undefined;
    const node: PLCostNode = (best as { node: PLCostNode }).node;
    return {
      label: node.label,
      deltaUsd: node.metrics.deltaUsd,
      realizedExpectedPct: node.metrics.realizedExpectedPct,
    };
  }, [tree]);

  const insights = React.useMemo(() => generateSmartInsights(tree), [tree]);

  // Refresh button: fire a sticky toast on click, swap to success on
  // completion, error on failure. Watches `isFetching` and `error` so
  // the user always sees a clear "started → finished" handshake even
  // though the refresh chain takes ~30-60s.
  const refreshToastIdRef = React.useRef<string | number | null>(null);
  const wasFetchingRef = React.useRef(false);
  React.useEffect(() => {
    if (rollup.isFetching && !wasFetchingRef.current) {
      // Just started — open a sticky loading toast.
      refreshToastIdRef.current = toast.loading(
        "Trade Cost hesaplama motoru çalıştırılıyor",
        {
          description:
            "5 aşamalı zincirleme analiz çalışıyor — birkaç dakika sürebilir.",
          duration: Infinity,
        }
      );
    }
    if (!rollup.isFetching && wasFetchingRef.current) {
      // Just finished — replace with success / error.
      const id = refreshToastIdRef.current;
      if (rollup.error) {
        toast.error("Yenileme başarısız oldu", {
          id: id ?? undefined,
          description: rollup.error,
          duration: 8000,
        });
      } else {
        toast.success("Trade Cost verileri güncellendi", {
          id: id ?? undefined,
          description: `${rollup.rows.length.toLocaleString("tr-TR")} özet satırı hazırlandı.`,
          duration: 4000,
        });
      }
      refreshToastIdRef.current = null;
    }
    wasFetchingRef.current = rollup.isFetching;
  }, [rollup.isFetching, rollup.error, rollup.rows.length]);

  const handleRefresh = React.useCallback(() => {
    if (rollup.isFetching) return;
    rollup.refresh();
  }, [rollup]);

  // Detail panel: selected node id (path) + lookup helper.
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(
    null
  );
  const findNodeById = React.useCallback(
    (nodes: PLCostNode[], id: string): PLCostNode | null => {
      for (const n of nodes) {
        if (n.id === id) return n;
        if (n.children) {
          const found = findNodeById(n.children, id);
          if (found) return found;
        }
      }
      return null;
    },
    []
  );
  const selectedNode = React.useMemo(
    () => (selectedNodeId ? findNodeById(tree, selectedNodeId) : null),
    [selectedNodeId, tree, findNodeById]
  );

  return (
    <div className="h-full flex flex-col gap-3 min-h-0">
      {/* ─── Quick filters + global controls ─── */}
      <GlassPanel tone="strong" className="rounded-2xl shrink-0">
        <div className="px-3.5 py-2.5 flex items-end gap-3 flex-wrap">
          <PLCostQuickFilters
            projects={rawProjects}
            filters={filters}
            onChange={setFilters}
          />
          <span className="h-9 w-px bg-border/60 shrink-0 self-end mb-px" />
          <div className="flex items-end gap-2 shrink-0">
            <AdvancedFilter
              projects={rawProjects}
              filters={filters}
              onChange={setFilters}
            />
            <ViewModeToggle
              value={viewMode}
              onChange={setViewMode}
              accent={accent}
            />
            <RefreshButton
              onClick={handleRefresh}
              isFetching={rollup.isFetching}
              accent={accent}
            />
          </div>
        </div>
      </GlassPanel>

      {/* ─── İçerik ─── */}
      {rollup.error ? (
        <ErrorState error={rollup.error} onRetry={rollup.refresh} />
      ) : rollup.isFetching && rollup.isEmpty ? (
        <GlassPanel tone="default" className="flex-1 min-h-0 rounded-2xl">
          <PLCostProgress
            stages={rollup.stages}
            totalProjects={totalProjects}
          />
        </GlassPanel>
      ) : rollup.isEmpty ? (
        <EmptyState accentColor={accent.solid} accentRing={accent.ring} accentGradient={accent.gradient} />
      ) : (
        <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
          <GlassPanel tone="subtle" className="rounded-xl shrink-0">
            <div className="px-3.5 py-2.5">
              <PLCostInsightsRibbon
                insights={insights}
                onSelectNode={setSelectedNodeId}
              />
            </div>
          </GlassPanel>
          <PLCostKpiTiles
            rootMetrics={rootMetrics}
            totalProjects={totalProjects}
            topVariance={topVariance}
          />
          <div className="flex-1 min-h-0 overflow-hidden">
            <PLCostTable
              tree={tree}
              viewMode={viewMode}
              selectedNodeId={selectedNodeId}
              onSelectNode={(node) => setSelectedNodeId(node.id)}
            />
          </div>
          {rollup.isFetching && (
            <div className="text-[11px] text-muted-foreground/80 flex items-center gap-1.5 shrink-0">
              <Loader2 className="size-3 animate-spin" /> Arka planda
              yenileniyor...
            </div>
          )}
        </div>
      )}
      {/* Detail side panel — slide-in / dismissible. Lives outside
          the main grid so it overlays the table without affecting
          its layout. */}
      <PLCostDetailPanel
        node={selectedNode}
        onClose={() => setSelectedNodeId(null)}
      />
    </div>
  );
}

/**
 * Görünüm Modu (Proje | Gemi) — segmented round pill, same height as
 * the filter trigger + refresh button. Active half gets the accent
 * gradient + white icon; inactive half stays subtle but legible.
 */
function ViewModeToggle({
  value,
  onChange,
  accent,
}: {
  value: ViewMode;
  onChange: (v: ViewMode) => void;
  accent: ThemeAccent;
}) {
  return (
    <TooltipProvider delayDuration={250}>
      <div className="inline-flex items-center h-9 rounded-full bg-foreground/[0.06] ring-1 ring-foreground/10 p-1 gap-1">
        <ToggleButton
          active={value === "project"}
          onClick={() => onChange("project")}
          icon={Briefcase01Icon}
          label="Proje"
          tooltip="3. seviyede projeleri grupla"
          accent={accent}
        />
        <ToggleButton
          active={value === "vessel"}
          onClick={() => onChange("vessel")}
          icon={BoatIcon}
          label="Gemi"
          tooltip="3. seviyede gemileri grupla"
          accent={accent}
        />
      </div>
    </TooltipProvider>
  );
}

function ToggleButton({
  active,
  onClick,
  icon,
  label,
  tooltip,
  accent,
}: {
  active: boolean;
  onClick: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: any;
  label: string;
  tooltip: string;
  accent: ThemeAccent;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-pressed={active}
          aria-label={label}
          className="h-7 px-3 rounded-full text-[12.5px] font-semibold inline-flex items-center gap-1.5 transition-all"
          style={{
            background: active ? accent.gradient : "transparent",
            color: active ? "white" : "rgba(15,23,42,0.7)",
            boxShadow: active
              ? `0 3px 10px -3px ${accent.ring}, inset 0 1px 0 0 rgba(255,255,255,0.25)`
              : undefined,
          }}
        >
          <HugeiconsIcon icon={icon} size={15} strokeWidth={2} />
          {label}
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        className="bg-white text-foreground shadow-[0_12px_28px_-8px_rgba(15,23,42,0.24)] ring-1 ring-foreground/10 backdrop-blur-none"
      >
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Refresh control — round, accent-tinted, same dimensions as the
 * filter trigger pill (size-9). Rotating refresh glyph while
 * `isFetching=true` makes it crystal-clear the engine is working;
 * the page-level toast surfaced via `useActualExpenseRollup` is the
 * loud parallel signal so users browsing other tiles still see
 * progress.
 */
function RefreshButton({
  onClick,
  isFetching,
  accent,
}: {
  onClick: () => void;
  isFetching: boolean;
  accent: ThemeAccent;
}) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onClick}
            disabled={isFetching}
            aria-label={isFetching ? "Hesaplama sürüyor" : "Verileri yenile"}
            className="size-9 rounded-full grid place-items-center shrink-0 shadow-sm transition-all hover:scale-[1.04] active:scale-95 disabled:cursor-not-allowed"
            style={{
              background: isFetching ? accent.gradient : "white",
              color: isFetching ? "white" : "rgba(15,23,42,0.78)",
              boxShadow: isFetching
                ? `0 4px 12px -4px ${accent.ring}, inset 0 1px 0 0 rgba(255,255,255,0.25)`
                : "0 1px 2px 0 rgba(15,23,42,0.08), 0 4px 12px -4px rgba(15,23,42,0.18), inset 0 0 0 1px rgba(15,23,42,0.10)",
            }}
          >
            <HugeiconsIcon
              icon={RefreshIcon}
              size={16}
              strokeWidth={2}
              className={isFetching ? "animate-spin" : undefined}
            />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          className="bg-white text-foreground shadow-[0_12px_28px_-8px_rgba(15,23,42,0.24)] ring-1 ring-foreground/10 backdrop-blur-none"
        >
          {isFetching
            ? "Hesaplama sürüyor…"
            : "Trade Cost motorunu yeniden çalıştır"}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function ErrorState({
  error,
  onRetry,
}: {
  error: string;
  onRetry: () => void;
}) {
  return (
    <GlassPanel tone="default" className="flex-1 min-h-0 rounded-2xl">
      <div className="h-full flex items-center justify-center p-8">
        <div className="max-w-md text-center space-y-3">
          <div className="text-rose-700 font-semibold">Hata</div>
          <p className="text-sm text-muted-foreground break-words">{error}</p>
          <Button onClick={onRetry} variant="outline" size="sm">
            Tekrar dene
          </Button>
        </div>
      </div>
    </GlassPanel>
  );
}

function EmptyState({
  accentColor,
  accentRing,
  accentGradient,
}: {
  accentColor: string;
  accentRing: string;
  accentGradient: string;
}) {
  return (
    <GlassPanel tone="default" className="flex-1 min-h-0 rounded-2xl">
      <div className="h-full flex items-center justify-center p-8">
        <div className="max-w-md text-center space-y-4">
          <span
            className="size-14 mx-auto rounded-2xl grid place-items-center text-white"
            style={{
              background: accentGradient,
              boxShadow: `0 6px 18px -4px ${accentRing}`,
            }}
          >
            <HugeiconsIcon
              icon={DashboardSpeed01Icon}
              size={26}
              strokeWidth={2}
            />
          </span>
          <div>
            <div className="text-base font-semibold">Veri henüz yüklenmedi</div>
            <p className="text-sm text-muted-foreground mt-1">
              Önce projeler verisi çekilmeli. Veri Yönetimi sayfasından Verileri
              Güncelle'ye basıp dönün — bu sayfa otomatik hazırlamaya başlar.
            </p>
          </div>
          <Button asChild>
            <Link to="/data" className="gap-1.5">
              <HugeiconsIcon
                icon={Database01Icon}
                size={16}
                strokeWidth={2}
              />
              Veri Yönetimi'ne git
            </Link>
          </Button>
          <div className="text-[10px] text-muted-foreground/60">
            {accentColor /* eslint guard */}
          </div>
        </div>
      </div>
    </GlassPanel>
  );
}
