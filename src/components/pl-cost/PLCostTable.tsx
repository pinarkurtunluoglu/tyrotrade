import * as React from "react";
import { ChevronRight } from "lucide-react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  PinLocation03Icon,
  Flag03Icon,
  BoatIcon,
  Briefcase01Icon,
  ReceiptDollarIcon,
  // Per-status (L2) glyphs — six canonical voyage statuses + fallback
  HourglassIcon,
  BookmarkCheck02Icon,
  Activity03Icon,
  CheckmarkCircle02Icon,
  Archive01Icon,
  CancelCircleIcon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { formatCurrency, formatNumber } from "@/lib/format";
import { useThemeAccent } from "@/components/layout/theme-accent";
import type { PLCostNode, ViewMode } from "@/lib/selectors/plCost";

interface PLCostTableProps {
  tree: PLCostNode[];
  /** L3 grouping mode — drives whether the L3 row icon is a boat
   *  (vessel grouping) or a briefcase (project grouping). */
  viewMode?: ViewMode;
  /** Currently-selected node id — drives the highlighted row. */
  selectedNodeId?: string | null;
  /** Click any row to open the detail panel. */
  onSelectNode?: (node: PLCostNode) => void;
}

/**
 * Hierarchical P&L Cost table — segment → voyage → vessel/project →
 * expense line. Sticky header + sticky tree column. Each metric cell
 * uses tabular-nums alignment; the two `Realized/Expected %` cells
 * carry an inline tone-coloured mini bar (0–150% domain, tick at
 * 100%) so the eye picks up over/under-budget at a glance.
 *
 * Mounting pattern: top-level (L1 segment) nodes start expanded so
 * the user sees the whole portfolio shape immediately. Deeper levels
 * collapsed by default.
 */
export function PLCostTable({
  tree,
  viewMode = "project",
  selectedNodeId,
  onSelectNode,
}: PLCostTableProps) {
  // All segments collapsed by default — the user expands the
  // segment they care about. Otherwise an executive scrolling
  // through 15+ segments × N voyage statuses lands in a sea of
  // nested rows.
  const [expanded, setExpanded] = React.useState<Set<string>>(
    () => new Set()
  );

  const toggle = React.useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Flatten the tree into the visible row order, respecting the
  // expanded set. Each visible row carries its own indentation and
  // chevron state via the node level.
  const visibleRows = React.useMemo(() => {
    const out: PLCostNode[] = [];
    const walk = (nodes: PLCostNode[]) => {
      for (const n of nodes) {
        out.push(n);
        if (expanded.has(n.id) && n.children && n.children.length > 0) {
          walk(n.children);
        }
      }
    };
    walk(tree);
    return out;
  }, [tree, expanded]);

  return (
    <div className="rounded-2xl border border-border/40 overflow-hidden bg-background/40">
      {/* Outer scroll container — vertical for table, horizontal for
          metric columns when cramped. Sticky header + sticky tree
          column rely on this single scroll context. */}
      <div className="overflow-auto max-h-[calc(100vh-260px)]">
        <table className="w-full text-[12px] border-collapse">
          <thead className="sticky top-0 z-20 bg-foreground/[0.04] backdrop-blur-md">
            <tr>
              <th
                className="sticky left-0 z-30 bg-foreground/[0.06] backdrop-blur-md px-3 py-2.5 text-left font-semibold text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border/40 min-w-[280px]"
                style={{ minWidth: 280 }}
              >
                Segment Kırılımı
              </th>
              <Th>Tahmini USD</Th>
              <Th>Gerçekleşen USD</Th>
              <Th>R/E %</Th>
              <Th>Tahmini Birim</Th>
              <Th>Gerçek. Birim</Th>
              <Th>R/E Ton %</Th>
              <Th>Vessel MT</Th>
              <Th>Tahmini MT</Th>
              <Th>Δ USD</Th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((node) => (
              <Row
                key={node.id}
                node={node}
                viewMode={viewMode}
                expanded={expanded.has(node.id)}
                onToggle={toggle}
                selected={selectedNodeId === node.id}
                onSelect={onSelectNode}
              />
            ))}
            {visibleRows.length === 0 && (
              <tr>
                <td
                  colSpan={10}
                  className="px-4 py-12 text-center text-sm text-muted-foreground"
                >
                  Filtreye uyan veri yok
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2.5 text-right font-semibold text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border/40 whitespace-nowrap">
      {children}
    </th>
  );
}

/**
 * Resolve an L2 voyage-status label to its glyph + tone colour. The
 * six canonical statuses each get a semantically-loaded icon and a
 * tone that telegraphs "where in the lifecycle this is" at a glance:
 *
 *   Waiting/planning  → cool greys + sky
 *   In progress       → warm amber
 *   Done well         → emerald
 *   Done finalised    → slate-dark (lock)
 *   Aborted           → rose
 *
 * Unknown / "—" falls back to the original flag.
 */
const STATUS_ICON_BY_LABEL: Record<
  string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  { icon: any; color: string }
> = {
  "to be nominated": {
    icon: HourglassIcon,
    color: "rgb(100 116 139)", // slate — waiting in queue
  },
  nominated: {
    icon: BookmarkCheck02Icon,
    color: "rgb(2 132 199)", // sky — planned + assigned
  },
  commenced: {
    icon: Activity03Icon,
    color: "rgb(217 119 6)", // amber — voyage in motion
  },
  completed: {
    icon: CheckmarkCircle02Icon,
    color: "rgb(5 150 105)", // emerald — operationally done
  },
  closed: {
    // Archive box reads as "filed away / case closed" more clearly
    // than a generic lock (which can be misread as "security
    // restricted" rather than "this voyage is finalised").
    icon: Archive01Icon,
    color: "rgb(71 85 105)", // slate-dark — finalised and filed
  },
  cancelled: {
    icon: CancelCircleIcon,
    color: "rgb(225 29 72)", // rose — aborted
  },
};
function resolveStatusIcon(label: string): {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: any;
  color: string;
} {
  const key = label.trim().toLowerCase();
  return (
    STATUS_ICON_BY_LABEL[key] ?? {
      icon: Flag03Icon,
      color: "rgb(124 58 237)", // violet — generic flag fallback
    }
  );
}

function Row({
  node,
  viewMode,
  expanded,
  onToggle,
  selected,
  onSelect,
}: {
  node: PLCostNode;
  viewMode: ViewMode;
  expanded: boolean;
  onToggle: (id: string) => void;
  selected: boolean;
  onSelect?: (node: PLCostNode) => void;
}) {
  const accent = useThemeAccent();
  const hasChildren = !!node.children && node.children.length > 0;
  const indent = (node.level - 1) * 18;

  // Level-specific row styling — give the eye a clear sense of depth
  // via font weight + size + a subtle bg shade per level. Each level
  // also has its own glyph rendered next to the label so the user
  // can tell "I'm looking at a segment vs. a status vs. a project"
  // at a glance even without inspecting the indent.
  const levelClass = (() => {
    switch (node.level) {
      case 1:
        return "font-semibold text-[13.5px] bg-foreground/[0.05]";
      case 2:
        return "font-semibold text-[13px] bg-foreground/[0.025]";
      case 3:
        return "font-medium text-[12.5px]";
      case 4:
        return "text-[12px] text-foreground/85";
    }
  })();

  // Level glyph + tone — a small but explicit visual cue per level.
  // L3 switches between boat (vessel grouping) and briefcase (project
  // grouping) so the user sees the active view-mode in every row.
  const levelIcon = (() => {
    switch (node.level) {
      case 1:
        // Segment → location pin (geographical grouping). Slightly
        // larger than the other-level glyphs so it anchors the row
        // and reads as the "where" indicator at a glance.
        return { icon: PinLocation03Icon, color: accent.solid };
      case 2:
        // Statü → per-status glyph (hourglass / bookmark / activity /
        // checkmark / lock / cancel) — instantly telegraphs lifecycle
        // stage without reading the label.
        return resolveStatusIcon(node.label);
      case 3:
        return {
          icon: viewMode === "vessel" ? BoatIcon : Briefcase01Icon,
          color: "rgb(15 118 110)",
        };
      case 4:
        // Kalem → receipt-dollar (expense voucher)
        return {
          icon: ReceiptDollarIcon,
          color: "rgb(180 83 9)",
        };
    }
  })();

  const handleRowClick = () => {
    if (onSelect) onSelect(node);
  };

  return (
    <tr
      onClick={handleRowClick}
      className={cn(
        "group hover:bg-foreground/[0.04]",
        levelClass,
        onSelect && "cursor-pointer",
        selected && "bg-foreground/[0.06]"
      )}
    >
      {/* Tree cell — sticky left, handles chevron + indentation */}
      <td
        className={cn(
          "sticky left-0 z-10 backdrop-blur-sm border-b border-border/30 group-hover:bg-foreground/[0.04]",
          selected ? "bg-foreground/[0.07]" : "bg-background/95"
        )}
        style={{
          // Selected row gets the accent bar; otherwise L1 gets it
          // for segment separation.
          borderLeft: selected
            ? `3px solid ${accent.solid}`
            : node.level === 1
              ? `3px solid ${accent.solid}`
              : undefined,
        }}
      >
        <div
          className="flex items-center gap-1.5 px-3 py-2 min-w-0"
          style={{ paddingLeft: 12 + indent }}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggle(node.id);
              }}
              className="size-5 rounded grid place-items-center hover:bg-foreground/10 shrink-0 transition-colors"
              aria-label={expanded ? "Daralt" : "Genişlet"}
            >
              <ChevronRight
                className={cn(
                  "size-3.5 transition-transform",
                  expanded && "rotate-90"
                )}
              />
            </button>
          ) : (
            <span className="size-5 shrink-0" aria-hidden />
          )}
          {/* Icon container is sized to match the label's line-box so
              <flex items-center> centres them on the same midline.
              Without an explicit container size, the icon's hit-box
              collapses to the glyph height and the label baseline
              drifts off-centre at L1 (taller font + chunkier pin). */}
          <span
            className="shrink-0 grid place-items-center"
            style={{
              color: levelIcon.color,
              width: node.level === 1 ? 20 : 18,
              height: node.level === 1 ? 20 : 18,
            }}
            aria-hidden
          >
            <HugeiconsIcon
              icon={levelIcon.icon}
              size={node.level === 1 ? 18 : node.level === 2 ? 15 : 14}
              strokeWidth={node.level === 1 ? 1.85 : 2}
            />
          </span>
          {/* Match the label's line-box height to the icon container
              so a single-line label centres exactly on the icon (with
              normal font metrics the glyph block sits in the top
              ~70% of its line-box; matching line-height bakes the
              vertical breathing room into the line-box symmetrically
              around the glyph). When a subLabel is present the
              `flex-col + justify-center` wrapper still flanks them
              around the icon midline. */}
          <div className="min-w-0 flex-1 flex flex-col justify-center">
            <div
              className="truncate"
              style={{ lineHeight: `${node.level === 1 ? 20 : 18}px` }}
            >
              {node.label}
            </div>
            {node.subLabel && (
              <div
                className="text-[10.5px] text-muted-foreground truncate font-mono"
                style={{ lineHeight: "14px" }}
              >
                {node.subLabel}
              </div>
            )}
          </div>
        </div>
      </td>
      {/* Metric cells */}
      <NumCell value={node.metrics.expectedUsd} kind="usd" />
      <NumCell value={node.metrics.realizedUsd} kind="usd" bold />
      <PctCell value={node.metrics.realizedExpectedPct} />
      <NumCell value={node.metrics.expectedPriceUsdPerMt} kind="price" />
      <NumCell value={node.metrics.realizedPriceUsdPerMt} kind="price" />
      <PctCell value={node.metrics.realizedExpectedTonPct} />
      <NumCell value={node.metrics.quantityVesselMt} kind="tons" />
      <NumCell value={node.metrics.expectedQuantityMt} kind="tons" />
      <DeltaCell value={node.metrics.deltaUsd} />
    </tr>
  );
}

function NumCell({
  value,
  kind,
  bold,
}: {
  value: number;
  kind: "usd" | "price" | "tons";
  bold?: boolean;
}) {
  const empty = !value;
  // USD cells render the FULL formatted amount ($2.235.540 instead
  // of compact "$2,2 Mn"). Compact loses precision the user
  // explicitly wants to see in the comparison table — KPI tiles
  // can still use compact since their footprint is fixed.
  const text = empty
    ? "—"
    : kind === "usd"
      ? formatCurrency(value, "USD")
      : kind === "price"
        ? `${formatNumber(value, 2)}`
        : `${formatNumber(value, 0)} t`;
  return (
    <td
      className={cn(
        "px-3 py-2 text-right tabular-nums whitespace-nowrap border-b border-border/30",
        bold && "font-semibold",
        empty && "text-muted-foreground/50"
      )}
    >
      {text}
    </td>
  );
}

/** R/E % cell with inline mini-bar (0–150% domain, tick at 100%).
 *  Tone-colored: emerald ≥ 90%, amber 60–89%, rose < 60%. Null %
 *  (e.g. expected ≤ 0) renders as a muted dash. */
function PctCell({ value }: { value: number | null }) {
  if (value == null) {
    return (
      <td className="px-3 py-2 text-right text-muted-foreground/50 border-b border-border/30">
        —
      </td>
    );
  }
  const tone =
    value >= 90 ? "emerald" : value >= 60 ? "amber" : "rose";
  const colors = {
    emerald: { fg: "rgb(4 120 87)", bg: "rgb(16 185 129)" },
    amber: { fg: "rgb(180 83 9)", bg: "rgb(245 158 11)" },
    rose: { fg: "rgb(159 18 57)", bg: "rgb(244 63 94)" },
  }[tone];
  // Bar: 0–150% domain (cap), tick at 100%.
  const fillPct = Math.max(0, Math.min(150, value)) / 150 * 100;
  const tickPct = (100 / 150) * 100;
  return (
    <td className="px-3 py-2 border-b border-border/30 min-w-[120px]">
      <div className="flex items-center gap-2 justify-end">
        <span
          className="font-semibold tabular-nums text-[11.5px]"
          style={{ color: colors.fg }}
        >
          %{value.toFixed(0)}
        </span>
        <div className="relative w-16 h-1.5 rounded-full bg-foreground/10 overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ width: `${fillPct}%`, backgroundColor: colors.bg }}
          />
          <span
            aria-hidden
            className="absolute top-0 bottom-0 w-px bg-foreground/40"
            style={{ left: `${tickPct}%` }}
          />
        </div>
      </div>
    </td>
  );
}

/** Δ USD cell — sign-coloured (over budget red, under budget green,
 *  zero muted). Shows the +/- prefix explicitly so a quick glance
 *  reads positive vs negative without requiring colour. */
function DeltaCell({ value }: { value: number }) {
  if (!value) {
    return (
      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground/50 border-b border-border/30">
        —
      </td>
    );
  }
  const overBudget = value > 0;
  const colorClass = overBudget ? "text-rose-700" : "text-emerald-700";
  const sign = overBudget ? "+" : "−";
  return (
    <td
      className={cn(
        "px-3 py-2 text-right tabular-nums font-semibold whitespace-nowrap border-b border-border/30",
        colorClass
      )}
    >
      {sign}
      {formatCurrency(Math.abs(value), "USD")}
    </td>
  );
}
