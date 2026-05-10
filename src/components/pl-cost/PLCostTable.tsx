import * as React from "react";
import { ChevronRight, Anchor } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCompactCurrency, formatNumber } from "@/lib/format";
import { useThemeAccent } from "@/components/layout/theme-accent";
import type { PLCostNode } from "@/lib/selectors/plCost";

interface PLCostTableProps {
  tree: PLCostNode[];
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
export function PLCostTable({ tree }: PLCostTableProps) {
  // Expanded set keyed by node id. L1 nodes auto-expanded on first
  // render. We don't auto-expand L2+ — the table would be enormous
  // and the user can drill in via chevron clicks.
  const [expanded, setExpanded] = React.useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const n of tree) s.add(n.id);
    return s;
  });

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
                Segment / Voyage / Proje / Kalem
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
                expanded={expanded.has(node.id)}
                onToggle={toggle}
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

function Row({
  node,
  expanded,
  onToggle,
}: {
  node: PLCostNode;
  expanded: boolean;
  onToggle: (id: string) => void;
}) {
  const accent = useThemeAccent();
  const hasChildren = !!node.children && node.children.length > 0;
  const indent = (node.level - 1) * 16;

  // Level-specific row styling — give the eye a sense of depth
  // without spelling out the level number.
  const levelClass = (() => {
    switch (node.level) {
      case 1:
        return "font-semibold text-[13px] bg-foreground/[0.03]";
      case 2:
        return "font-medium text-[12.5px]";
      case 3:
        return "text-[12.5px]";
      case 4:
        return "text-[11.5px] text-foreground/85";
    }
  })();

  return (
    <tr className={cn("group hover:bg-foreground/[0.04]", levelClass)}>
      {/* Tree cell — sticky left, handles chevron + indentation */}
      <td
        className="sticky left-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border/30 group-hover:bg-foreground/[0.04]"
        style={{
          // Level 1 gets a thin accent bar so segments visually
          // separate from each other.
          borderLeft:
            node.level === 1 ? `3px solid ${accent.solid}` : undefined,
        }}
      >
        <div
          className="flex items-center gap-1.5 px-3 py-2 min-w-0"
          style={{ paddingLeft: 12 + indent }}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={() => onToggle(node.id)}
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
          {node.level === 3 && (
            <Anchor
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate">{node.label}</div>
            {node.subLabel && (
              <div className="text-[10.5px] text-muted-foreground truncate font-mono">
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
  const text = empty
    ? "—"
    : kind === "usd"
      ? formatCompactCurrency(value, "USD")
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
      {formatCompactCurrency(Math.abs(value), "USD")}
    </td>
  );
}
