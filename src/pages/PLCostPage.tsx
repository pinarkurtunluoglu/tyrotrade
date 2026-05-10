import * as React from "react";
import { Link } from "react-router-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  DashboardSpeed01Icon,
  Database01Icon,
  HotPriceIcon,
  RefreshIcon,
  ShipmentTrackingIcon,
  ProjectorIcon,
} from "@hugeicons/core-free-icons";
import { Loader2 } from "lucide-react";
import { GlassPanel } from "@/components/glass/GlassPanel";
import { Button } from "@/components/ui/button";
import { useThemeAccent } from "@/components/layout/theme-accent";
import { useProjects } from "@/hooks/useProjects";
import { useActualExpenseRollup } from "@/hooks/useActualExpenseRollup";
import { formatDate } from "@/lib/format";
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
      {/* ─── Header (sadece title) ─── */}
      <GlassPanel tone="strong" className="rounded-2xl shrink-0">
        <div className="px-4 py-3 flex items-center gap-3">
          <span
            className="size-11 rounded-2xl grid place-items-center shrink-0 text-white shadow-sm"
            style={{
              background: accent.gradient,
              boxShadow: `0 4px 14px -4px ${accent.ring}, inset 0 1px 0 0 rgba(255,255,255,0.28)`,
            }}
          >
            <HugeiconsIcon icon={HotPriceIcon} size={22} strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[18px] font-bold tracking-tight leading-tight">
              P&amp;L Cost
            </div>
            <div className="text-[12px] text-muted-foreground leading-tight mt-0.5">
              Tahmini × Gerçekleşen Maliyet
              {totalProjects > 0 && ` · ${totalProjects} proje`}
              {rollup.fetchedAt && (
                <> · son hesap {formatDate(rollup.fetchedAt)}</>
              )}
            </div>
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
          {/* Insights + controls bar — chips solda, küçük dikey
              ayraçlarla ayrılmış controls grubu sağda. Tek bara
              yerleştirildi ki "P&L Cost" header'ı sade başlık olarak
              kalsın, ikincil her şey buraya odaklansın. */}
          <GlassPanel tone="subtle" className="rounded-xl shrink-0">
            <div className="px-3.5 py-2.5 flex items-center gap-3">
              <PLCostInsightsRibbon
                insights={insights}
                onSelectNode={setSelectedNodeId}
              />
              <span className="h-6 w-px bg-border/60 shrink-0" />
              <div className="flex items-center gap-2 shrink-0">
                <AdvancedFilter
                  projects={rawProjects}
                  filters={filters}
                  onChange={setFilters}
                />
                <ViewModeToggle value={viewMode} onChange={setViewMode} />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={rollup.refresh}
                  disabled={rollup.isFetching}
                  className="gap-1.5"
                >
                  {rollup.isFetching ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <HugeiconsIcon
                      icon={RefreshIcon}
                      size={14}
                      strokeWidth={2}
                    />
                  )}
                  {rollup.isFetching ? "Hesaplanıyor..." : "Yenile"}
                </Button>
              </div>
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

/** Görünüm Modu (Gemi/Proje) — segmented pill toggle. */
function ViewModeToggle({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (v: ViewMode) => void;
}) {
  return (
    <div className="inline-flex items-center rounded-full bg-foreground/[0.06] p-0.5">
      <ToggleButton
        active={value === "project"}
        onClick={() => onChange("project")}
        icon={ProjectorIcon}
        label="Proje"
      />
      <ToggleButton
        active={value === "vessel"}
        onClick={() => onChange("vessel")}
        icon={ShipmentTrackingIcon}
        label="Gemi"
      />
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: any;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-[12px] font-medium flex items-center gap-1.5 transition-colors ${
        active
          ? "bg-background shadow-sm text-foreground"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <HugeiconsIcon icon={icon} size={13} strokeWidth={2} />
      {label}
    </button>
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
