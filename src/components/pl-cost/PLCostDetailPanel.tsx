import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import {
  formatCompactCurrency,
  formatCurrency,
  formatNumber,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PLCostNode } from "@/lib/selectors/plCost";

interface PLCostDetailPanelProps {
  node: PLCostNode | null;
  onClose: () => void;
}

const LEVEL_LABELS: Record<1 | 2 | 3 | 4, string> = {
  1: "Segment",
  2: "Voyage Status",
  3: "Vessel / Proje",
  4: "Gider Kalemi",
};

/**
 * Slide-in detay panel — bir tree node'una tıklayınca sağdan kayarak
 * açılır. İçinde:
 *   - Breadcrumb header (level label + node name + project count)
 *   - Variance gauge: büyük R/E % + sapma rakamı
 *   - 9-metrik full görünüm (table'daki mini-bar yerine sayılar
 *     daha net gösteriliyor)
 *   - L4 expense rows: ham voucher listesi (expense_num, USD)
 */
export function PLCostDetailPanel({ node, onClose }: PLCostDetailPanelProps) {
  return (
    <AnimatePresence>
      {node && (
        <>
          {/* Backdrop — tıklayınca kapatır, mobile'da overlay olarak gerek */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-30 bg-foreground/20 backdrop-blur-[2px] md:hidden"
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="fixed right-3 top-3 bottom-3 z-40 w-[calc(100%-1.5rem)] md:w-[500px]"
          >
            {/* Solid white surface — the GlassPanel's `tone="strong"` was
                still translucent enough that the table behind bled
                through. Detail mode is a focus-mode; readability beats
                glass effect here. */}
            <div className="rounded-3xl h-full flex flex-col bg-white shadow-[0_24px_64px_-16px_rgba(15,23,42,0.32)] ring-1 ring-foreground/8 overflow-hidden">
              <Body node={node} onClose={onClose} />
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function Body({ node, onClose }: { node: PLCostNode; onClose: () => void }) {
  const m = node.metrics;
  const overBudget = m.deltaUsd > 0;
  const onTarget =
    m.realizedExpectedPct != null && Math.abs(m.realizedExpectedPct - 100) <= 5;
  const tone = onTarget ? "neutral" : overBudget ? "danger" : "positive";

  return (
    <>
      {/* Header */}
      <div className="px-4 py-3 flex items-start gap-2 border-b border-border/40 shrink-0">
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-medium">
            {LEVEL_LABELS[node.level]}
          </div>
          <div className="text-[15px] font-bold tracking-tight leading-tight truncate mt-0.5">
            {node.label}
          </div>
          {node.subLabel && (
            <div className="text-[11.5px] text-muted-foreground font-mono truncate mt-0.5">
              {node.subLabel}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Detay panelini kapat"
          className="size-8 rounded-lg grid place-items-center hover:bg-foreground/10 transition-colors shrink-0"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Variance gauge */}
        <VarianceGauge metrics={m} tone={tone} />

        {/* Full metrics grid */}
        <MetricGrid node={node} />

        {/* L4 expense rows — ham voucher listesi */}
        {node.rawExpenseRows && node.rawExpenseRows.length > 0 && (
          <ExpenseRowsTable rows={node.rawExpenseRows} />
        )}

        {/* Project list (L1-L3 için) */}
        {node.level < 4 && node.rawProjectNos.length > 0 && (
          <ProjectListSection projectNos={node.rawProjectNos} />
        )}
      </div>
    </>
  );
}

function VarianceGauge({
  metrics,
  tone,
}: {
  metrics: PLCostNode["metrics"];
  tone: "positive" | "danger" | "neutral";
}) {
  const pct = metrics.realizedExpectedPct;
  const palette = {
    positive: { bg: "rgba(16,185,129,0.10)", text: "rgb(4 120 87)", bar: "rgb(16 185 129)" },
    danger: { bg: "rgba(244,63,94,0.10)", text: "rgb(159 18 57)", bar: "rgb(244 63 94)" },
    neutral: { bg: "rgba(100,116,139,0.10)", text: "rgb(71 85 105)", bar: "rgb(100 116 139)" },
  }[tone];
  const fillPct =
    pct == null ? 0 : Math.max(0, Math.min(150, pct)) / 150 * 100;
  const tickPct = (100 / 150) * 100;
  const overBudget = metrics.deltaUsd > 0;
  return (
    <div
      className="rounded-xl px-4 py-3"
      style={{ backgroundColor: palette.bg }}
    >
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-[10.5px] uppercase tracking-wider font-semibold text-muted-foreground">
          Gerçekleşme %
        </div>
        <div
          className="text-[28px] font-bold tabular-nums leading-none"
          style={{ color: palette.text }}
        >
          {pct == null ? "—" : `%${pct.toFixed(1)}`}
        </div>
      </div>
      <div className="relative w-full h-2.5 rounded-full bg-foreground/10 overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
          style={{ width: `${fillPct}%`, backgroundColor: palette.bar }}
        />
        <span
          aria-hidden
          className="absolute top-0 bottom-0 w-px bg-foreground/40"
          style={{ left: `${tickPct}%` }}
        />
      </div>
      <div className="flex items-baseline justify-between mt-3 text-[12px]">
        <div>
          <div className="text-muted-foreground/80 font-medium uppercase tracking-wide text-[10px]">
            Δ Sapma
          </div>
          <div
            className="font-bold tabular-nums"
            style={{ color: palette.text }}
          >
            {metrics.deltaUsd === 0
              ? "—"
              : `${overBudget ? "+" : "−"}${formatCompactCurrency(Math.abs(metrics.deltaUsd), "USD")}`}
          </div>
        </div>
        <div className="text-right">
          <div className="text-muted-foreground/80 font-medium uppercase tracking-wide text-[10px]">
            Tahmini → Gerçekleşen
          </div>
          <div className="font-mono tabular-nums">
            {formatCompactCurrency(metrics.expectedUsd, "USD")} →{" "}
            <span
              className="font-bold"
              style={{ color: palette.text }}
            >
              {formatCompactCurrency(metrics.realizedUsd, "USD")}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricGrid({ node }: { node: PLCostNode }) {
  const m = node.metrics;
  const items: Array<{ label: string; value: string; muted?: boolean }> = [
    {
      label: "Tahmini USD",
      value: formatCompactCurrency(m.expectedUsd, "USD"),
    },
    {
      label: "Gerçekleşen USD",
      value: formatCompactCurrency(m.realizedUsd, "USD"),
    },
    {
      label: "Tahmini Birim USD/MT",
      value: m.expectedPriceUsdPerMt
        ? formatNumber(m.expectedPriceUsdPerMt, 2)
        : "—",
    },
    {
      label: "Gerçek. Birim USD/MT",
      value: m.realizedPriceUsdPerMt
        ? formatNumber(m.realizedPriceUsdPerMt, 2)
        : "—",
    },
    {
      label: "Vessel MT",
      value: m.quantityVesselMt
        ? `${formatNumber(m.quantityVesselMt, 0)} t`
        : "—",
    },
    {
      label: "Tahmini MT",
      value: m.expectedQuantityMt
        ? `${formatNumber(m.expectedQuantityMt, 0)} t`
        : "—",
    },
    {
      label: "R/E Ton %",
      value:
        m.realizedExpectedTonPct == null
          ? "—"
          : `%${m.realizedExpectedTonPct.toFixed(1)}`,
    },
    {
      label: "Katkı satır sayısı",
      value: `${node.rawProjectNos.length} proje`,
      muted: true,
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map((it) => (
        <div
          key={it.label}
          className="rounded-lg bg-foreground/[0.04] px-3 py-2"
        >
          <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground/80 font-semibold">
            {it.label}
          </div>
          <div
            className={cn(
              "text-[13px] tabular-nums leading-tight mt-0.5",
              it.muted ? "text-muted-foreground" : "font-semibold"
            )}
          >
            {it.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function ExpenseRowsTable({
  rows,
}: {
  rows: NonNullable<PLCostNode["rawExpenseRows"]>;
}) {
  // Sort by abs(totalUsd) desc — biggest contributors lead.
  const sorted = [...rows].sort(
    (a, b) => Math.abs(b.totalUsd) - Math.abs(a.totalUsd)
  );
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5 px-1">
        Ham Voucher Satırları ({rows.length})
      </div>
      <div className="rounded-lg border border-border/30 overflow-hidden max-h-72 overflow-y-auto">
        <table className="w-full text-[11px]">
          <thead className="bg-foreground/[0.04] sticky top-0">
            <tr>
              <Th>Proje</Th>
              <Th>Kalem</Th>
              <Th align="right">Tutar</Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr
                key={i}
                className="hover:bg-foreground/[0.04] border-b border-border/20 last:border-b-0"
              >
                <Td>
                  <span className="font-mono text-[10px] text-muted-foreground/80">
                    {r.projectNo}
                  </span>
                </Td>
                <Td>
                  <div className="font-medium truncate">
                    {r.refExpenseId || r.description || r.expenseId || "—"}
                  </div>
                  <div className="font-mono text-[10px] text-muted-foreground/80">
                    {r.expenseId} · {r.expenseNum}
                  </div>
                </Td>
                <Td align="right">
                  <span
                    className={cn(
                      "tabular-nums font-semibold",
                      r.totalUsd < 0 && "text-emerald-700"
                    )}
                  >
                    {formatCurrency(r.totalUsd, "USD")}
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProjectListSection({ projectNos }: { projectNos: string[] }) {
  // De-dupe and cap to ~12 visible to avoid mega-list in the panel.
  const unique = Array.from(new Set(projectNos));
  const visible = unique.slice(0, 12);
  const hidden = unique.length - visible.length;
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5 px-1">
        Bu Düzeydeki Projeler ({unique.length})
      </div>
      <div className="flex flex-wrap gap-1">
        {visible.map((no) => (
          <span
            key={no}
            className="inline-flex items-center px-2 py-0.5 rounded-full bg-foreground/[0.06] text-[10.5px] font-mono"
          >
            {no}
          </span>
        ))}
        {hidden > 0 && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-foreground/[0.04] text-[10.5px] text-muted-foreground italic">
            +{hidden} daha
          </span>
        )}
      </div>
    </div>
  );
}

function Th({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: "right";
}) {
  return (
    <th
      className={cn(
        "px-2.5 py-1.5 font-semibold text-[10px] uppercase tracking-wider text-muted-foreground",
        align === "right" ? "text-right" : "text-left"
      )}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: "right";
}) {
  return (
    <td
      className={cn(
        "px-2.5 py-1.5",
        align === "right" ? "text-right" : "text-left"
      )}
    >
      {children}
    </td>
  );
}
