import { HugeiconsIcon } from "@hugeicons/react";
import {
  Coins02Icon,
  ChartHistogramIcon,
  TargetIcon,
  TrendingDown,
  TrendingUp,
  Alert02Icon,
} from "@hugeicons/core-free-icons";
import { GlassPanel } from "@/components/glass/GlassPanel";
import { formatCompactCurrency } from "@/lib/format";
import type { PLCostMetrics } from "@/lib/selectors/plCost";

interface PLCostKpiTilesProps {
  rootMetrics: PLCostMetrics;
  totalProjects: number;
  topVariance?: {
    label: string;
    deltaUsd: number;
    realizedExpectedPct: number | null;
  };
}

/** Per-tile gradient palette — keeps each KPI distinguishable at a
 *  glance. Gradients mirror the AdvancedFilter trigger style (white
 *  stroke icon over a tone'd gradient pill). */
type Tone = "slate" | "emerald" | "sky" | "rose" | "amber";

const TONE_PALETTE: Record<
  Tone,
  { gradient: string; ring: string }
> = {
  slate: {
    gradient: "linear-gradient(135deg, #94a3b8, #64748b)",
    ring: "rgba(100,116,139,0.35)",
  },
  emerald: {
    gradient: "linear-gradient(135deg, #34d399, #059669)",
    ring: "rgba(16,185,129,0.40)",
  },
  sky: {
    gradient: "linear-gradient(135deg, #38bdf8, #0284c7)",
    ring: "rgba(56,189,248,0.40)",
  },
  rose: {
    gradient: "linear-gradient(135deg, #fb7185, #e11d48)",
    ring: "rgba(244,63,94,0.40)",
  },
  amber: {
    gradient: "linear-gradient(135deg, #fbbf24, #d97706)",
    ring: "rgba(245,158,11,0.40)",
  },
};

/**
 * Five-up KPI tile bar — every tile carries its own coloured gradient
 * pill icon (white stroke glyph over a tone-coloured gradient bg)
 * mirroring the filter-trigger language. Tones are KPI-specific:
 *
 *   1. Toplam Tahmini    — slate (neutral baseline)
 *   2. Toplam Gerçekleşen — sky (the headline number)
 *   3. Gerçekleşme %     — emerald / amber / rose (tone-aware)
 *   4. Δ Sapma           — emerald (under) / rose (over)
 *   5. En Sapan          — amber (always — attention-callout)
 */
export function PLCostKpiTiles({
  rootMetrics,
  totalProjects,
  topVariance,
}: PLCostKpiTilesProps) {
  const overBudget = rootMetrics.deltaUsd > 0;
  const onTarget =
    rootMetrics.realizedExpectedPct != null &&
    Math.abs(rootMetrics.realizedExpectedPct - 100) <= 5;
  const tonePctLabel: Tone = onTarget
    ? "emerald"
    : overBudget
      ? "rose"
      : "amber";
  const toneDelta: Tone = overBudget ? "rose" : "emerald";

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
      <Tile
        label="Toplam Tahmini"
        value={formatCompactCurrency(rootMetrics.expectedUsd, "USD")}
        sub={`${totalProjects} proje`}
        icon={Coins02Icon}
        tone="slate"
      />
      <Tile
        label="Toplam Gerçekleşen"
        value={formatCompactCurrency(rootMetrics.realizedUsd, "USD")}
        sub="rollup'tan toplam"
        icon={ChartHistogramIcon}
        tone="sky"
        valueBold
      />
      <Tile
        label="Gerçekleşme"
        value={
          rootMetrics.realizedExpectedPct == null
            ? "—"
            : `%${rootMetrics.realizedExpectedPct.toFixed(1)}`
        }
        sub={onTarget ? "hedefte" : overBudget ? "bütçe aşıldı" : "altında"}
        icon={TargetIcon}
        tone={tonePctLabel}
      />
      <Tile
        label="Δ Sapma"
        value={
          rootMetrics.deltaUsd === 0
            ? "—"
            : `${overBudget ? "+" : "−"}${formatCompactCurrency(Math.abs(rootMetrics.deltaUsd), "USD")}`
        }
        sub={overBudget ? "bütçe üstü" : "bütçe altı"}
        icon={overBudget ? TrendingUp : TrendingDown}
        tone={toneDelta}
        valueBold
      />
      <Tile
        label="En Sapan"
        value={
          topVariance
            ? `${topVariance.deltaUsd >= 0 ? "+" : "−"}${formatCompactCurrency(Math.abs(topVariance.deltaUsd), "USD")}`
            : "—"
        }
        sub={topVariance ? topVariance.label : "veri yok"}
        icon={Alert02Icon}
        tone="amber"
      />
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  icon,
  tone,
  valueBold,
}: {
  label: string;
  value: string;
  sub: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: any;
  tone: Tone;
  valueBold?: boolean;
}) {
  const palette = TONE_PALETTE[tone];
  return (
    <GlassPanel tone="subtle" className="rounded-xl">
      <div className="px-4 py-3 flex items-start gap-3">
        <span
          className="size-10 rounded-xl grid place-items-center shrink-0 text-white shadow-sm"
          style={{
            background: palette.gradient,
            boxShadow: `0 4px 12px -4px ${palette.ring}, inset 0 1px 0 0 rgba(255,255,255,0.25)`,
          }}
        >
          <HugeiconsIcon icon={icon} size={18} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-medium">
            {label}
          </div>
          <div
            className={`mt-0.5 tabular-nums leading-tight truncate ${
              valueBold ? "text-[19px] font-bold" : "text-[18px] font-semibold"
            }`}
          >
            {value}
          </div>
          <div className="text-[10.5px] text-muted-foreground/80 mt-0.5 truncate">
            {sub}
          </div>
        </div>
      </div>
    </GlassPanel>
  );
}
