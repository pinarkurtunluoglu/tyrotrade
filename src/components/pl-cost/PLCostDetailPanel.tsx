import { motion, AnimatePresence } from "framer-motion";
import { ArrowUpRight, X } from "lucide-react";
import { Link } from "react-router-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Globe02Icon,
  WorkflowSquare05Icon,
  ShipmentTrackingIcon,
  ReceiptDollarIcon,
} from "@hugeicons/core-free-icons";
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

const LEVEL_META: Record<
  1 | 2 | 3 | 4,
  {
    label: string;
    childLabel: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    icon: any;
    accentBg: string;
    accentRing: string;
    accentText: string;
  }
> = {
  1: {
    label: "Segment",
    childLabel: "Statü",
    icon: Globe02Icon,
    accentBg: "linear-gradient(135deg, #38bdf8, #0284c7)",
    accentRing: "rgba(56,189,248,0.40)",
    accentText: "rgb(7 89 133)",
  },
  2: {
    label: "Statü",
    childLabel: "Gemi / Proje",
    icon: WorkflowSquare05Icon,
    accentBg: "linear-gradient(135deg, #a78bfa, #7c3aed)",
    accentRing: "rgba(167,139,250,0.40)",
    accentText: "rgb(76 29 149)",
  },
  3: {
    label: "Gemi / Proje",
    childLabel: "Gider Kalemi",
    icon: ShipmentTrackingIcon,
    accentBg: "linear-gradient(135deg, #34d399, #059669)",
    accentRing: "rgba(16,185,129,0.40)",
    accentText: "rgb(6 95 70)",
  },
  4: {
    label: "Gider Kalemi",
    childLabel: "Voucher Satırı",
    icon: ReceiptDollarIcon,
    accentBg: "linear-gradient(135deg, #fbbf24, #d97706)",
    accentRing: "rgba(245,158,11,0.40)",
    accentText: "rgb(120 53 15)",
  },
};

/**
 * Slide-in detay panel — bir tree node'una tıklayınca sağdan kayarak
 * açılır. Bölüm sırası (üstten alta):
 *   1. Gradient header (level icon + label + project count + close)
 *   2. Variance gauge: büyük R/E % + Δ sapma + tahmini→gerçekleşen
 *   3. Top Children breakdown (L1/L2/L3 — alt 3 düğüm, her biri için
 *      R/E % + delta — segment/voyage-level click'ler için doyurucu)
 *   4. 8-metrik full grid (table'daki mini-bar yerine tam sayılar)
 *   5. L4 expense rows: ham voucher listesi (expense_num, USD)
 *   6. L1-L3 için proje no listesi
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
            className="fixed right-3 top-3 bottom-3 z-40 w-[calc(100%-1.5rem)] md:w-[520px]"
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
  const meta = LEVEL_META[node.level];

  return (
    <>
      {/* Header — level icon pill + label + close button */}
      <div className="px-4 py-3 flex items-start gap-2.5 border-b border-border/40 shrink-0">
        <span
          className="size-10 rounded-xl grid place-items-center shrink-0 text-white shadow-sm"
          style={{
            background: meta.accentBg,
            boxShadow: `0 4px 12px -4px ${meta.accentRing}, inset 0 1px 0 0 rgba(255,255,255,0.25)`,
          }}
        >
          <HugeiconsIcon icon={meta.icon} size={18} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-semibold">
            {meta.label}
          </div>
          <div className="text-[16px] font-bold tracking-tight leading-tight truncate mt-0.5">
            {looksLikeProjectNo(node.label) ? (
              <ProjectNoLink
                projectNo={node.label}
                className="text-[16px] font-bold tracking-tight"
              />
            ) : (
              node.label
            )}
          </div>
          {node.subLabel && (
            <div className="text-[11.5px] text-muted-foreground truncate mt-0.5">
              {looksLikeProjectNo(node.subLabel) ? (
                <ProjectNoLink
                  projectNo={node.subLabel}
                  className="text-[11.5px] text-muted-foreground hover:text-foreground"
                />
              ) : (
                <span className="font-mono">{node.subLabel}</span>
              )}
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

        {/* Top children breakdown — only when this node has children */}
        {node.children && node.children.length > 0 && (
          <TopChildrenSection
            children={node.children}
            childLabel={meta.childLabel}
          />
        )}

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

/**
 * Top-3 children breakdown by realizedUsd. Each row shows label,
 * R/E % chip (tone-coloured), and delta. Helps user drill down into
 * "which child is dragging the parent's variance" without expanding
 * the tree.
 */
function TopChildrenSection({
  children,
  childLabel,
}: {
  children: PLCostNode[];
  childLabel: string;
}) {
  // Sort by realizedUsd desc, take top 3
  const top = [...children]
    .sort((a, b) => b.metrics.realizedUsd - a.metrics.realizedUsd)
    .slice(0, 3);
  const remaining = children.length - top.length;
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5 px-1 flex items-center justify-between">
        <span>En Büyük {childLabel} Kırılımı</span>
        <span className="font-mono normal-case tracking-normal text-muted-foreground/70">
          {top.length}/{children.length}
        </span>
      </div>
      <div className="rounded-xl border border-border/30 overflow-hidden divide-y divide-border/20">
        {top.map((child) => {
          const m = child.metrics;
          const overBudget = m.deltaUsd > 0;
          const onTarget =
            m.realizedExpectedPct != null &&
            Math.abs(m.realizedExpectedPct - 100) <= 5;
          const chipPalette = onTarget
            ? { bg: "rgba(16,185,129,0.12)", text: "rgb(4 120 87)" }
            : overBudget
              ? { bg: "rgba(244,63,94,0.12)", text: "rgb(159 18 57)" }
              : { bg: "rgba(245,158,11,0.14)", text: "rgb(180 83 9)" };
          return (
            <div
              key={child.id}
              className="px-3 py-2 flex items-center gap-2.5"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-semibold truncate">
                  {child.label}
                </div>
                <div className="text-[10.5px] text-muted-foreground tabular-nums font-mono leading-tight mt-0.5">
                  {formatCompactCurrency(m.expectedUsd, "USD")}
                  {" → "}
                  <span className="font-semibold text-foreground/80">
                    {formatCompactCurrency(m.realizedUsd, "USD")}
                  </span>
                </div>
              </div>
              <div className="shrink-0 flex flex-col items-end gap-0.5">
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold tabular-nums"
                  style={{
                    backgroundColor: chipPalette.bg,
                    color: chipPalette.text,
                  }}
                >
                  {m.realizedExpectedPct == null
                    ? "—"
                    : `%${m.realizedExpectedPct.toFixed(0)}`}
                </span>
                <span
                  className="text-[10.5px] font-bold tabular-nums"
                  style={{ color: chipPalette.text }}
                >
                  {m.deltaUsd === 0
                    ? "—"
                    : `${overBudget ? "+" : "−"}${formatCompactCurrency(Math.abs(m.deltaUsd), "USD")}`}
                </span>
              </div>
            </div>
          );
        })}
        {remaining > 0 && (
          <div className="px-3 py-1.5 text-[10.5px] text-muted-foreground italic">
            +{remaining} {childLabel.toLowerCase()} daha
          </div>
        )}
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
    <div>
      <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5 px-1">
        Tüm Metrikler
      </div>
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
                  <ProjectNoLink
                    projectNo={r.projectNo}
                    className="text-[10px] text-muted-foreground/80 hover:text-foreground"
                  />
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
          <Link
            key={no}
            to={`/projects/${no}`}
            onClick={(e) => e.stopPropagation()}
            title={`${no} projesini Vessel Projects'te aç`}
            className="group inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-foreground/[0.06] hover:bg-foreground/[0.10] text-[10.5px] font-mono transition-colors"
          >
            {no}
            <ArrowUpRight
              className="size-2.5 opacity-0 -translate-x-0.5 group-hover:opacity-70 group-hover:translate-x-0 transition-all"
              strokeWidth={2.25}
            />
          </Link>
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

/**
 * Heuristic: does this string look like one of the F&O project IDs
 * we use as the `:projectId` route param? PRJ000002443, TRKTHL01305,
 * TRKYTH00616 etc. — all-caps prefix (≥ 3 letters) + digit run
 * (≥ 3 digits). Lets the detail panel turn project-number labels
 * into deep links without threading viewMode through the props.
 */
function looksLikeProjectNo(value: string): boolean {
  return /^[A-Z]{3,}\d{3,}$/.test(value.trim());
}

/**
 * Inline chip-style link that takes a project number and routes to
 * `/projects/:projectNo` (Vessel Projects with the project pre-
 * selected). Used by the project list, the expense voucher table,
 * and the L3 header sub-label so any projectNo the user sees in the
 * detail panel is one click away from the operational detail page.
 *
 * `e.stopPropagation()` keeps the surrounding row's click handler
 * (which would otherwise re-open or shuffle the detail panel) from
 * firing when the user clicks the link itself.
 */
function ProjectNoLink({
  projectNo,
  className,
}: {
  projectNo: string;
  className?: string;
}) {
  return (
    <Link
      to={`/projects/${projectNo}`}
      onClick={(e) => e.stopPropagation()}
      title={`${projectNo} projesini Vessel Projects'te aç`}
      className={cn(
        "group inline-flex items-center gap-1 font-mono tabular-nums hover:underline underline-offset-2 decoration-foreground/40 transition-colors hover:text-foreground",
        className
      )}
    >
      {projectNo}
      <ArrowUpRight
        className="size-3 opacity-0 -translate-x-0.5 group-hover:opacity-70 group-hover:translate-x-0 transition-all"
        strokeWidth={2.25}
      />
    </Link>
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
