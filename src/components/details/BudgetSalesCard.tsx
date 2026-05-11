import * as React from "react";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  ChevronDown,
} from "lucide-react";
import { GlassPanel } from "@/components/glass/GlassPanel";
import {
  AccentIconBadge,
  TONE_PL,
  TONE_EXPENSE,
  TONE_FORECAST,
} from "./AccentIconBadge";
import { formatCurrency, formatNumber } from "@/lib/format";
import {
  selectSalesTotal,
  selectPurchaseTotal,
} from "@/lib/selectors/profitLoss";
import {
  selectEstimateTotal,
  selectExecutionDate,
} from "@/lib/selectors/project";
import { toUsdAtDate } from "@/lib/finance/fxRates";
import { readCache } from "@/lib/storage/entityCache";
import { useProjectInvoices } from "@/hooks/useProjectInvoices";
import { useProjectExpenseLines } from "@/hooks/useProjectExpenseLines";
import { cn } from "@/lib/utils";
import type { Project } from "@/lib/dataverse/entities";

interface Props {
  project: Project;
}

const PURCHASE_ENTITY_SET = "mserp_tryaivendinvoicetransentities";

/**
 * "Realized P&L" — full sales × purchase × expense P&L resolution
 * for the selected project, both forecast and realized side-by-side.
 *
 * Mirrors the ProfitLossCard ("Expected P&L") layout pattern:
 *   - Top toggle expands the whole card.
 *   - Each section row (Tahmini/Gerçekleşen × Satış/Alım/Gider) is
 *     itself an `ExpandableRow` carrying a +/- signed value chip
 *     in the appropriate emerald/rose tone, and revealing per-line
 *     `DetailLine` breakdowns when opened.
 *   - Footer carries two K&Z resolutions (Tahmini first, Gerçekleşen
 *     second) with margin chips, in the same visual dialect as
 *     ProfitLossCard's single footer.
 *
 * Estimates side: same line math the Expected P&L card uses
 *   (line.qty/1000) × line.unitPrice / line.purchasePrice, plus the
 *   project's `costEstimateLines`. Totals FX-converted to USD at the
 *   project's signing date so estimated and realized sit on the same
 *   axis.
 *
 * Realized side:
 *   - Satış  ← `useProjectInvoices` rows, each FX→USD per
 *              `mserp_invoicedate`
 *   - Alım   ← `mserp_tryaivendinvoicetransentities` cache rows
 *              filtered by `mserp_purchtable_etgtryprojid`,
 *              FX→USD per `mserp_invoicedate`
 *   - Gider  ← `useProjectExpenseLines` rows (the 3-step chain
 *              inventdimb → dist → expense-line); `mserp_amountcur`
 *              summed as USD (entity doesn't expose currencycode).
 *
 * Hides itself entirely when every figure is zero.
 */
export function BudgetSalesCard({ project }: Props) {
  const lines = project.lines ?? [];
  const lineCurrency = lines[0]?.currency ?? project.currency ?? "USD";
  const [open, setOpen] = React.useState(false);

  /* ─────────── Invoice item label lookup (shared helper) ───────────
   * Project lines carry only the F&O item code (no Turkish product
   * name). Customer invoices DO carry a `mserp_name` per item, so
   * build a code→name map from invoices to enrich the estimate
   * line breakdown — same trick ProfitLossCard uses. */
  const { invoices } = useProjectInvoices(project.projectNo);
  const productNameByCode = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const inv of invoices) {
      const code = String(inv["mserp_itemid"] ?? "").trim();
      const name = String(inv["mserp_name"] ?? "").trim();
      if (!code || !name) continue;
      if (!map.has(code)) map.set(code, name);
    }
    return map;
  }, [invoices]);
  const labelFor = React.useCallback(
    (code: string) => productNameByCode.get(code) ?? code,
    [productNameByCode]
  );

  /* ─────────── Estimate line breakdowns ─────────── */
  const tahminiSalesLines = React.useMemo(
    () =>
      lines
        .filter((l) => l.unitPrice > 0 && l.quantityKg > 0)
        .map((l) => ({
          label: labelFor(l.itemCode),
          tons: l.quantityKg / 1000,
          price: l.unitPrice,
          totalNative: (l.quantityKg / 1000) * l.unitPrice,
        })),
    [lines, labelFor]
  );
  const tahminiPurchaseLines = React.useMemo(
    () =>
      lines
        .filter((l) => (l.purchasePrice ?? 0) > 0 && l.quantityKg > 0)
        .map((l) => ({
          label: labelFor(l.itemCode),
          tons: l.quantityKg / 1000,
          price: l.purchasePrice ?? 0,
          totalNative: (l.quantityKg / 1000) * (l.purchasePrice ?? 0),
        })),
    [lines, labelFor]
  );
  const tahminiExpenseLines = React.useMemo(
    () => project.costEstimateLines ?? [],
    [project.costEstimateLines]
  );

  /* ─────────── Estimate totals (USD-equivalent at execution date) ───────────
   * Operasyon periyodu (`mserp_executionperiod`) is the FX anchor when set;
   * legacy projects without it fall back to the signing date via the
   * `selectExecutionDate` helper. Same precedence the dashboard FY filter
   * + per-row aggregations use, so the right rail and the executive tiles
   * agree on which month's rate applies. */
  const fxDate = selectExecutionDate(project);
  const tahminiSatisUsd = toUsdAtDate(
    selectSalesTotal(project),
    lineCurrency,
    fxDate
  );
  const tahminiAlimUsd = toUsdAtDate(
    selectPurchaseTotal(project),
    lineCurrency,
    fxDate
  );
  const tahminiGiderUsd = selectEstimateTotal(project);

  /* ─────────── Realized line breakdowns ─────────── */
  // Sales — invoices carry per-line currency + invoice date, so
  // FX-convert each row before summing. Filter zero-amount rows so
  // the breakdown count reflects substantive postings only.
  const gerceklesenSalesLines = React.useMemo(() => {
    return invoices
      .map((inv) => {
        const amount = Number(inv["mserp_lineamount"]);
        if (!Number.isFinite(amount) || amount === 0) return null;
        const cur = String(inv["mserp_currencycode"] ?? "USD")
          .trim()
          .toUpperCase();
        const date =
          typeof inv["mserp_invoicedate"] === "string"
            ? (inv["mserp_invoicedate"] as string)
            : null;
        const qty = Number(inv["mserp_qty"]);
        return {
          label: String(inv["mserp_name"] ?? inv["mserp_itemid"] ?? "—"),
          tons: Number.isFinite(qty) ? qty / 1000 : 0,
          nativeAmount: amount,
          nativeCurrency: cur,
          totalUsd: toUsdAtDate(amount, cur, date),
        };
      })
      .filter((l): l is NonNullable<typeof l> => l !== null);
  }, [invoices]);
  const gerceklesenSatisUsd = gerceklesenSalesLines.reduce(
    (s, l) => s + l.totalUsd,
    0
  );

  // Purchase — read cached vendor invoice rows scoped to the
  // selected project, same FX treatment as sales.
  const gerceklesenPurchaseLines = React.useMemo(() => {
    if (!project.projectNo) return [];
    const cached = readCache<Record<string, unknown>>(PURCHASE_ENTITY_SET);
    const all = cached?.value ?? [];
    return all
      .filter((r) => r["mserp_purchtable_etgtryprojid"] === project.projectNo)
      .map((r) => {
        const amount = Number(r["mserp_lineamount"]);
        if (!Number.isFinite(amount) || amount === 0) return null;
        const cur = String(r["mserp_currencycode"] ?? "USD")
          .trim()
          .toUpperCase();
        const date =
          typeof r["mserp_invoicedate"] === "string"
            ? (r["mserp_invoicedate"] as string)
            : null;
        const qty = Number(r["mserp_qty"]);
        return {
          label: String(r["mserp_name"] ?? r["mserp_itemid"] ?? "—"),
          tons: Number.isFinite(qty) ? qty / 1000 : 0,
          nativeAmount: amount,
          nativeCurrency: cur,
          totalUsd: toUsdAtDate(amount, cur, date),
        };
      })
      .filter((l): l is NonNullable<typeof l> => l !== null);
  }, [project.projectNo]);
  const gerceklesenAlimUsd = gerceklesenPurchaseLines.reduce(
    (s, l) => s + l.totalUsd,
    0
  );

  // Expense — 3-step chain via `useProjectExpenseLines` (inventdimb
  // → dist → expense-line + refmap enrichment + header FX join).
  // The enriched rows carry `mserp_amountcur_usd` — native amount
  // converted to USD via the expense HEADER's `mserp_exchratesecond`
  // when the row's currency isn't already USD. We read the `_usd`
  // field for sums so totals never mix currencies. The original
  // `mserp_amountcur` is still preserved for raw inspector views
  // and is used as a fallback when the header lookup couldn't
  // attach FX context (best-effort step).
  //
  // Special handling for code `710041` (Satış Fiyat Farkı): this is
  // an FX-driven sales price-difference adjustment that REDUCES the
  // realised expense burden rather than adding to it. We surface it
  // as a positive (green +) line in the breakdown AND subtract its
  // amount from the gerceklesenGider total instead of adding.
  const PRICE_DIFF_EXPENSE_CODE = "710041";
  const expenseLineQuery = useProjectExpenseLines(project.projectNo);
  const gerceklesenExpenseLines = React.useMemo(
    () =>
      expenseLineQuery.rows
        .map((r) => {
          // Use the USD-converted amount when present; fall back to
          // the native amount only when the header join didn't run
          // for this row (rare — best-effort fallback).
          const rawUsd = r["mserp_amountcur_usd"];
          const amount =
            rawUsd !== undefined && rawUsd !== null && Number.isFinite(Number(rawUsd))
              ? Number(rawUsd)
              : Number(r["mserp_amountcur"]);
          if (!Number.isFinite(amount) || amount === 0) return null;
          const description = String(r["mserp_description"] ?? "").trim();
          const expenseId = String(r["mserp_expenseid"] ?? "").trim();
          const expensenum = String(r["mserp_expensenum"] ?? "").trim();
          // Refmap-derived textual class (e.g. "İTHALAT BULK - NAVLUN").
          // Falls back to description / id / num when refmap had no
          // entry for this code. This is what the user sees as the
          // primary line label.
          const refExpenseId = String(r["mserp_refexpenseid"] ?? "").trim();
          const isPriceDiff = expenseId === PRICE_DIFF_EXPENSE_CODE;
          return {
            label:
              refExpenseId ||
              description ||
              expenseId ||
              expensenum ||
              "—",
            expenseId,
            expensenum,
            refExpenseId,
            totalUsd: amount,
            isPriceDiff,
          };
        })
        .filter((l): l is NonNullable<typeof l> => l !== null),
    [expenseLineQuery.rows]
  );
  // Net gider: regular expenses ADD, price-diff entries SUBTRACT.
  const gerceklesenGiderUsd = gerceklesenExpenseLines.reduce(
    (s, l) => s + (l.isPriceDiff ? -l.totalUsd : l.totalUsd),
    0
  );
  // Net price-diff outweighed raw expenses → row reads as a credit.
  const isGiderNetCredit = gerceklesenGiderUsd < 0;

  /* ─────────── P&L resolutions ─────────── */
  const tahminiKZ = tahminiSatisUsd - tahminiAlimUsd - tahminiGiderUsd;
  const gerceklesenKZ =
    gerceklesenSatisUsd - gerceklesenAlimUsd - gerceklesenGiderUsd;

  const tahminiMargin =
    tahminiSatisUsd > 0 ? (tahminiKZ / tahminiSatisUsd) * 100 : null;
  const gerceklesenMargin =
    gerceklesenSatisUsd > 0
      ? (gerceklesenKZ / gerceklesenSatisUsd) * 100
      : null;

  // Auto-hide when nothing meaningful exists on any side.
  if (
    tahminiSatisUsd <= 0 &&
    tahminiAlimUsd <= 0 &&
    tahminiGiderUsd <= 0 &&
    gerceklesenSatisUsd <= 0 &&
    gerceklesenAlimUsd <= 0 &&
    gerceklesenGiderUsd <= 0
  ) {
    return null;
  }

  /* ─────────── Header tone — driven by Realized K&Z ─────────── */
  const realizedTone: Tone =
    gerceklesenSatisUsd === 0 &&
    gerceklesenAlimUsd === 0 &&
    gerceklesenGiderUsd === 0
      ? "neutral"
      : gerceklesenKZ > 0
        ? "positive"
        : gerceklesenKZ < 0
          ? "negative"
          : "neutral";
  const Icon =
    realizedTone === "positive"
      ? TrendingUp
      : realizedTone === "negative"
        ? TrendingDown
        : Minus;
  // Icon-pill background follows the tone too:
  //   positive (profit)   → emerald TONE_PL  (no change)
  //   negative (loss)     → rose TONE_EXPENSE (was emerald — misleading)
  //   neutral / no data   → TONE_FORECAST (matches the now-removed
  //                         Expected P&L card so neutral surfaces
  //                         keep the same chrome)
  const iconTone =
    realizedTone === "positive"
      ? TONE_PL
      : realizedTone === "negative"
        ? TONE_EXPENSE
        : TONE_FORECAST;

  return (
    <GlassPanel tone="default" className="rounded-2xl">
      <div className="p-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="w-full flex items-center gap-2.5 mb-3 text-left cursor-pointer hover:opacity-90 transition-colors"
        >
          <AccentIconBadge size="sm" tone={iconTone}>
            <Icon className="size-4" strokeWidth={2} />
          </AccentIconBadge>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Gerçekleşen Kâr &amp; Zarar
            </div>
            <div className="text-[13px] font-semibold leading-snug text-foreground/85">
              Realized P&amp;L
            </div>
          </div>
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180"
            )}
          />
        </button>

        <div className="rounded-xl border border-border/40 overflow-hidden">
          {open && (
            <>
              {/* ─── Satış ─── */}
              <SectionHeader>Satış</SectionHeader>
              <ExpandableRow
                label="Tahmini Satış"
                count={tahminiSalesLines.length}
                countLabel="satış kalemi"
                value={`+${formatCurrency(tahminiSatisUsd, "USD")}`}
                sign="positive"
                disabled={tahminiSalesLines.length === 0}
                faded={tahminiSatisUsd === 0}
              >
                {tahminiSalesLines.map((l, i) => (
                  <DetailLine
                    key={i}
                    code={l.label}
                    sub={`${formatNumber(l.tons, 0)} t × ${formatCurrency(l.price, lineCurrency, { maximumFractionDigits: 2 })} / t`}
                    total={`+${formatCurrency(l.totalNative, lineCurrency)}`}
                    sign="positive"
                  />
                ))}
              </ExpandableRow>
              <ExpandableRow
                label="Gerçekleşen Satış"
                count={gerceklesenSalesLines.length}
                countLabel="fatura kalemi"
                value={`+${formatCurrency(gerceklesenSatisUsd, "USD")}`}
                sign="positive"
                disabled={gerceklesenSalesLines.length === 0}
                faded={gerceklesenSatisUsd === 0}
              >
                {gerceklesenSalesLines.map((l, i) => (
                  <DetailLine
                    key={i}
                    code={l.label}
                    sub={subForRealizedLine(l)}
                    total={`+${formatCurrency(l.totalUsd, "USD")}`}
                    sign="positive"
                  />
                ))}
              </ExpandableRow>

              {/* ─── Alım ─── */}
              <SectionHeader>Alım</SectionHeader>
              <ExpandableRow
                label="Tahmini Alım"
                count={tahminiPurchaseLines.length}
                countLabel="alım kalemi"
                value={`-${formatCurrency(tahminiAlimUsd, "USD")}`}
                sign="negative"
                disabled={tahminiPurchaseLines.length === 0}
                faded={tahminiAlimUsd === 0}
              >
                {tahminiPurchaseLines.map((l, i) => (
                  <DetailLine
                    key={i}
                    code={l.label}
                    sub={`${formatNumber(l.tons, 0)} t × ${formatCurrency(l.price, lineCurrency, { maximumFractionDigits: 2 })} / t`}
                    total={`-${formatCurrency(l.totalNative, lineCurrency)}`}
                    sign="negative"
                  />
                ))}
              </ExpandableRow>
              <ExpandableRow
                label="Gerçekleşen Alım"
                count={gerceklesenPurchaseLines.length}
                countLabel="tedarikçi faturası"
                value={`-${formatCurrency(gerceklesenAlimUsd, "USD")}`}
                sign="negative"
                disabled={gerceklesenPurchaseLines.length === 0}
                faded={gerceklesenAlimUsd === 0}
              >
                {gerceklesenPurchaseLines.map((l, i) => (
                  <DetailLine
                    key={i}
                    code={l.label}
                    sub={subForRealizedLine(l)}
                    total={`-${formatCurrency(l.totalUsd, "USD")}`}
                    sign="negative"
                  />
                ))}
              </ExpandableRow>

              {/* ─── Gider ─── */}
              <SectionHeader>Gider</SectionHeader>
              <ExpandableRow
                label="Tahmini Gider"
                count={tahminiExpenseLines.length}
                countLabel="gider kalemi"
                value={`-${formatCurrency(tahminiGiderUsd, "USD")}`}
                sign="negative"
                disabled={tahminiExpenseLines.length === 0}
                faded={tahminiGiderUsd === 0}
              >
                {tahminiExpenseLines.map((l, i) => (
                  <DetailLine
                    key={i}
                    code={l.name}
                    sub={`${formatNumber(l.tons, 0)} t × ${formatCurrency(l.unitPriceUsd, "USD", { maximumFractionDigits: 2 })} / t`}
                    total={`-${formatCurrency(l.totalUsd, "USD")}`}
                    sign="negative"
                  />
                ))}
              </ExpandableRow>
              <ExpandableRow
                label="Gerçekleşen Gider"
                count={gerceklesenExpenseLines.length}
                countLabel="masraf kaydı"
                // When price-diff lines outweigh raw expenses the net
                // becomes negative — flip the sign on the headline so
                // the row reads "+$X" green instead of "-$-X".
                value={`${isGiderNetCredit ? "+" : "-"}${formatCurrency(Math.abs(gerceklesenGiderUsd), "USD")}`}
                sign={isGiderNetCredit ? "positive" : "negative"}
                disabled={gerceklesenExpenseLines.length === 0}
                faded={gerceklesenGiderUsd === 0}
              >
                {gerceklesenExpenseLines.map((l, i) => (
                  <DetailLine
                    key={i}
                    code={l.label}
                    sub={
                      l.expenseId
                        ? `Masraf Kalemi: ${l.expenseId}`
                        : l.expensenum
                          ? `Masraf No: ${l.expensenum}`
                          : ""
                    }
                    // Price-diff (710041) lines reduce the realised
                    // expense burden — show them as positive/green
                    // instead of negative/red so the breakdown reads
                    // honestly.
                    total={`${l.isPriceDiff ? "+" : "-"}${formatCurrency(l.totalUsd, "USD")}`}
                    sign={l.isPriceDiff ? "positive" : "negative"}
                  />
                ))}
              </ExpandableRow>
            </>
          )}

          {/* Footer totals — Tahmini first, Gerçekleşen second.
              Each row mirrors the ProfitLossCard footer layout.
              Tahmini's margin pill is muted (always grey) so the
              realised K&Z row below it carries the headline colour. */}
          <KZFooterRow
            label="Tahmini Kâr / Zarar"
            marginLabel="Tahmini marj"
            value={tahminiKZ}
            marginPct={tahminiMargin}
            muted
          />
          <KZFooterRow
            label="Gerçekleşen Kâr / Zarar"
            marginLabel="Gerçekleşen marj"
            value={gerceklesenKZ}
            marginPct={gerceklesenMargin}
          />
          {/* Variance + achievement bar — Realised vs Forecast K&Z.
              Always rendered (regardless of `open`) so the bottom-line
              comparison is visible at a glance even when the per-section
              breakdown is collapsed. */}
          <VarianceFooter tahmini={tahminiKZ} gerceklesen={gerceklesenKZ} />
        </div>
      </div>
    </GlassPanel>
  );
}

/* ─────────── Variance + achievement footer ─────────── */
/**
 * Two-row block summarising Realised vs Forecast K&Z:
 *   Row 1 — "Δ Sapma": absolute USD delta + percent deviation,
 *           sign-coloured (positive = realised better than forecast,
 *           negative = worse). Sub-line reads "Tahminin üstünde / altında".
 *   Row 2 — achievement bar: realised / forecast as a percent, capped
 *           at 0–150% so a wild overshoot doesn't blow the visual but
 *           the trailing chip still shows the true number. A vertical
 *           tick at the 100% mark gives "hit forecast exactly" a
 *           reference point. Bar is suppressed when the forecast K&Z
 *           is ≤ 0 (a planned-loss project — achievement % becomes
 *           misleading because the math flips signs).
 */
function VarianceFooter({
  tahmini,
  gerceklesen,
}: {
  tahmini: number;
  gerceklesen: number;
}) {
  const delta = gerceklesen - tahmini;
  // Percent deviation against the magnitude of the forecast — gives
  // a stable "X% above/below plan" reading even when forecast is
  // negative (planned loss).
  const deltaPct = tahmini !== 0 ? (delta / Math.abs(tahmini)) * 100 : null;
  const tone: Tone =
    deltaPct == null
      ? "neutral"
      : deltaPct > 5
        ? "positive"
        : deltaPct < -5
          ? "negative"
          : "neutral";
  const valueColor =
    tone === "positive"
      ? "text-emerald-700"
      : tone === "negative"
        ? "text-rose-700"
        : "text-foreground";
  // Achievement bar only makes sense when the forecast is profit —
  // realised/forecast becomes a "hit my plan?" signal. With a planned
  // loss the same ratio flips orientation (a smaller actual loss is
  // good but produces a smaller %), so we hide the bar there.
  const achievedPct =
    tahmini > 0 ? (gerceklesen / tahmini) * 100 : null;

  return (
    <>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-3 py-2.5 bg-foreground/[0.06] items-baseline border-t border-border/40">
        <div className="min-w-0">
          <div className="text-[10.5px] uppercase tracking-wider font-semibold text-muted-foreground">
            Δ Sapma
          </div>
          {deltaPct != null && (
            <div className="text-[10.5px] text-muted-foreground/80 mt-0.5">
              Tahminin {deltaPct >= 0 ? "üstünde" : "altında"}
            </div>
          )}
        </div>
        <div className="text-right">
          <div
            className={cn(
              "tabular-nums font-bold text-[13px]",
              valueColor
            )}
          >
            {delta >= 0 ? "+" : "−"}
            {formatCurrency(Math.abs(delta), "USD")}
          </div>
          {deltaPct != null && (
            <div
              className={cn(
                "text-[11px] tabular-nums font-semibold mt-0.5",
                valueColor
              )}
            >
              {deltaPct >= 0 ? "+" : ""}
              {deltaPct.toFixed(1)}%
            </div>
          )}
        </div>
      </div>
      {achievedPct != null && (
        <div className="px-3 pt-3 pb-3 border-t border-border/40 bg-foreground/[0.04]">
          <ProgressBar pct={achievedPct} tone={tone} />
        </div>
      )}
    </>
  );
}

const TONE_BAR: Record<Tone, string> = {
  positive: "bg-gradient-to-r from-emerald-500 to-emerald-400",
  neutral: "bg-gradient-to-r from-slate-500 to-slate-400",
  negative: "bg-gradient-to-r from-rose-600 to-rose-400",
};

const TONE_CHIP: Record<Tone, string> = {
  positive: "bg-emerald-500/15 text-emerald-700",
  neutral: "bg-slate-500/15 text-slate-700",
  negative: "bg-rose-500/15 text-rose-700",
};

function ProgressBar({ pct, tone }: { pct: number; tone: Tone }) {
  // Visual domain is 0–150% so a wild overshoot doesn't blow the bar
  // but the chip on the right still shows the unclamped real value.
  const clamped = Math.max(0, Math.min(150, pct));
  const fill = (clamped / 150) * 100;
  return (
    <div className="flex items-center gap-2">
      <div
        className="relative flex-1 h-2.5 rounded-full bg-foreground/[0.08] ring-1 ring-foreground/10 overflow-hidden"
        style={{ boxShadow: "inset 0 1px 2px 0 rgba(15,23,42,0.08)" }}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={150}
        aria-valuenow={Math.round(pct)}
      >
        <div
          className={cn(
            "absolute inset-y-0 left-0 rounded-full transition-all duration-500",
            TONE_BAR[tone]
          )}
          style={{
            width: `${fill}%`,
            boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.35)",
          }}
        />
        {/* 100% mark — vertical tick for "hit forecast exactly". */}
        <span
          aria-hidden
          className="absolute top-0 bottom-0 w-px bg-foreground/35"
          style={{ left: `${(100 / 150) * 100}%` }}
        />
      </div>
      <span
        className={cn(
          "shrink-0 text-[11px] font-semibold tabular-nums px-1.5 py-0.5 rounded-sm",
          TONE_CHIP[tone]
        )}
      >
        %{pct.toFixed(1)}
      </span>
    </div>
  );
}

/* ─────────── Realized-line subtitle helper ─────────── */
/**
 * Pretty-print the per-line subtitle for a realized invoice/purchase
 * row: "X t · $Y" when both quantity and a different native currency
 * are usable, otherwise falls back to whichever piece is meaningful.
 * Hides redundancy — we don't repeat USD when totals are already in
 * USD on the right side.
 */
function subForRealizedLine(l: {
  tons: number;
  nativeAmount: number;
  nativeCurrency: string;
}): string {
  const tonsPart =
    Number.isFinite(l.tons) && l.tons > 0
      ? `${formatNumber(l.tons, 0)} t`
      : "";
  const nativePart =
    l.nativeCurrency && l.nativeCurrency !== "USD"
      ? formatCurrency(l.nativeAmount, l.nativeCurrency)
      : "";
  if (tonsPart && nativePart) return `${tonsPart} · ${nativePart}`;
  return tonsPart || nativePart;
}

/* ─────────── Helpers ─────────── */

type Tone = "positive" | "negative" | "neutral";

/** Tailwind class for the headline value column in `KZFooterRow`. */
const VALUE_TEXT_CLASS: Record<Tone, string> = {
  positive: "text-emerald-700",
  negative: "text-rose-700",
  // Neutral is also the muted (Tahmini) tone — slate-600 keeps the
  // total legible while ceding the headline emerald/rose to the
  // realised row directly below.
  neutral: "text-slate-600",
};

/** Margin-pill colour pair (text + bg) used in `KZFooterRow`. */
const MARGIN_PILL_STYLE: Record<Tone, { color: string; bg: string }> = {
  positive: {
    color: "rgb(4 120 87)", // emerald-700
    bg: "rgba(16,185,129,0.12)",
  },
  negative: {
    color: "rgb(159 18 57)", // rose-700
    bg: "rgba(244,63,94,0.12)",
  },
  neutral: {
    color: "rgb(71 85 105)", // slate-600
    bg: "rgba(100,116,139,0.12)",
  },
};

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 py-1.5 bg-foreground/[0.03] border-t border-border/30 first:border-t-0 text-[9.5px] font-bold uppercase tracking-[0.14em] text-foreground/70">
      {children}
    </div>
  );
}

/* ─────────── Expandable section row ───────────
 * Verbatim copy of ProfitLossCard's `ExpandableRow` so the two cards
 * stack with identical row chrome. Local rather than shared so each
 * card's behaviour can drift independently if needed (e.g. the
 * Realized side might surface FX hover later). */
function ExpandableRow({
  label,
  count,
  countLabel,
  value,
  sign,
  faded = false,
  disabled = false,
  children,
}: {
  label: string;
  count: number;
  countLabel: string;
  value: string;
  sign: Tone;
  faded?: boolean;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const valueColor =
    sign === "positive"
      ? "text-emerald-700"
      : sign === "negative"
        ? "text-rose-700"
        : "text-foreground";
  return (
    <div
      className={cn(
        "border-t border-border/30 first:border-t-0",
        faded && "opacity-55"
      )}
    >
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className={cn(
          "w-full grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-3 py-2 text-[11.5px] items-baseline transition-colors text-left",
          !disabled && "hover:bg-foreground/[0.025] cursor-pointer",
          disabled && "cursor-default"
        )}
        aria-expanded={open}
      >
        <div className="min-w-0 flex items-center gap-1">
          <ChevronDown
            className={cn(
              "size-3 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
              disabled && "opacity-40"
            )}
          />
          <div className="min-w-0">
            <div className="font-medium text-foreground truncate">{label}</div>
            <div className="text-[10px] text-muted-foreground/80 truncate mt-0.5">
              {count} {countLabel}
            </div>
          </div>
        </div>
        <div
          className={cn("text-right tabular-nums font-semibold", valueColor)}
        >
          {value}
        </div>
      </button>
      {open && children && (
        <div className="bg-foreground/[0.025] px-3 pb-2.5 pt-1 border-t border-border/20">
          <div className="space-y-1">{children}</div>
        </div>
      )}
    </div>
  );
}

/* ─────────── Detail line shown inside an expanded row ───────────
 * Same shape as ProfitLossCard's `DetailLine` but the `sub` is a
 * pre-formatted string so each section can carry its own subtitle
 * dialect (tons × rate for estimates, native currency / expense
 * code / etc. for realized). */
function DetailLine({
  code,
  sub,
  total,
  sign,
}: {
  code: string;
  sub: string;
  total: string;
  sign: "positive" | "negative";
}) {
  const valueColor =
    sign === "positive" ? "text-emerald-700" : "text-rose-700";
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 py-0.5 tabular-nums items-baseline">
      <div className="min-w-0">
        <div className="text-[12px] text-foreground/90 line-clamp-2 font-medium leading-snug">
          {code}
        </div>
        {sub && (
          <div className="text-muted-foreground/90 text-[11px] truncate mt-0.5">
            {sub}
          </div>
        )}
      </div>
      <div
        className={cn("text-right font-semibold text-[12px]", valueColor)}
      >
        {total}
      </div>
    </div>
  );
}

/* ─────────── K&Z footer row (mirrors ProfitLossCard footer) ─────────── */
function KZFooterRow({
  label,
  marginLabel,
  value,
  marginPct,
  muted = false,
}: {
  label: string;
  marginLabel: string;
  value: number;
  marginPct: number | null;
  /** When true the margin pill is forced to the neutral (gri) palette
   *  regardless of the percentage, so the row reads as a reference
   *  number rather than the headline metric. We use this for the
   *  Tahmini row so the eye lands on the realised K&Z below it
   *  (which keeps its value-driven emerald/rose colouring). */
  muted?: boolean;
}) {
  // Margin tone — muted rows always neutral; otherwise derived from
  // the margin %. ±5% is the dead-band that reads as "no signal".
  const marginTone: Tone = muted
    ? "neutral"
    : marginPct == null || (marginPct >= -5 && marginPct <= 5)
      ? "neutral"
      : marginPct > 5
        ? "positive"
        : "negative";
  // Headline value tone — muted rows force grey so the forecast K&Z
  // total can't be confused with the realised K&Z below it. Sign is
  // still legible from the leading +/− and bold tabular-nums weight.
  const valueTone: Tone = muted
    ? "neutral"
    : value > 0
      ? "positive"
      : value < 0
        ? "negative"
        : "neutral";
  const marginPill = MARGIN_PILL_STYLE[marginTone];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-3 py-2.5 text-[11.5px] bg-foreground/[0.04] items-baseline border-t border-border/40">
      <div className="min-w-0">
        <div className="font-semibold uppercase tracking-wider text-[10.5px] text-muted-foreground">
          {label}
        </div>
        {marginPct != null && (
          <span
            className="inline-flex items-center mt-1 px-2 py-[3px] rounded-md text-[11.5px] font-semibold tabular-nums tracking-tight"
            style={{ color: marginPill.color, backgroundColor: marginPill.bg }}
          >
            {marginLabel} %{marginPct.toFixed(1)}
          </span>
        )}
      </div>
      <div
        className={cn(
          "text-right tabular-nums text-[13px] font-bold",
          VALUE_TEXT_CLASS[valueTone]
        )}
      >
        {value >= 0 ? "+" : "−"}
        {formatCurrency(Math.abs(value), "USD")}
      </div>
    </div>
  );
}
