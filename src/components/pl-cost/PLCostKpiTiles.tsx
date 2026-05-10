import { HugeiconsIcon } from "@hugeicons/react";
import {
  Coins02Icon,
  ChartLineData01Icon,
  TargetIcon,
  TrendingDown,
  TrendingUp,
} from "@hugeicons/core-free-icons";
import { GlassPanel } from "@/components/glass/GlassPanel";
import { formatCompactCurrency } from "@/lib/format";
import { useThemeAccent } from "@/components/layout/theme-accent";
import type { PLCostMetrics } from "@/lib/selectors/plCost";

interface PLCostKpiTilesProps {
  rootMetrics: PLCostMetrics;
  /** Total contributing project count for the subtitle of the
   *  "Toplam Tahmini" tile. */
  totalProjects: number;
  /** Single biggest variance row (largest |deltaUsd|) for the
   *  "En Sapan" tile. Caller computes from the tree. */
  topVariance?: {
    label: string;
    deltaUsd: number;
    realizedExpectedPct: number | null;
  };
}

/**
 * Five-up KPI tile bar — the visual anchor at the top of the P&L
 * Cost page. Numbers use AnimatedNumber-style compact formatting so
 * the tile width stays predictable across $1M / $100M scales.
 */
export function PLCostKpiTiles({
  rootMetrics,
  totalProjects,
  topVariance,
}: PLCostKpiTilesProps) {
  const accent = useThemeAccent();
  const overBudget = rootMetrics.deltaUsd > 0;
  const onTarget =
    rootMetrics.realizedExpectedPct != null &&
    Math.abs(rootMetrics.realizedExpectedPct - 100) <= 5;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
      {/* 1. Toplam Tahmini */}
      <Tile
        label="Toplam Tahmini"
        value={formatCompactCurrency(rootMetrics.expectedUsd, "USD")}
        sub={`${totalProjects} proje`}
        icon={Coins02Icon}
        iconBg="rgba(100,116,139,0.14)"
        iconColor="rgb(71 85 105)"
      />
      {/* 2. Toplam Gerçekleşen */}
      <Tile
        label="Toplam Gerçekleşen"
        value={formatCompactCurrency(rootMetrics.realizedUsd, "USD")}
        sub="rollup'tan toplam"
        icon={ChartLineData01Icon}
        iconBg={accent.tint}
        iconColor={accent.solid}
        valueBold
      />
      {/* 3. Gerçekleşme % */}
      <Tile
        label="Gerçekleşme"
        value={
          rootMetrics.realizedExpectedPct == null
            ? "—"
            : `%${rootMetrics.realizedExpectedPct.toFixed(1)}`
        }
        sub={onTarget ? "hedefte" : overBudget ? "bütçe aşıldı" : "altında"}
        icon={TargetIcon}
        iconBg={
          onTarget
            ? "rgba(16,185,129,0.14)"
            : overBudget
              ? "rgba(244,63,94,0.14)"
              : "rgba(245,158,11,0.14)"
        }
        iconColor={
          onTarget
            ? "rgb(4 120 87)"
            : overBudget
              ? "rgb(159 18 57)"
              : "rgb(180 83 9)"
        }
      />
      {/* 4. Δ Sapma */}
      <Tile
        label="Δ Sapma"
        value={
          rootMetrics.deltaUsd === 0
            ? "—"
            : `${overBudget ? "+" : "−"}${formatCompactCurrency(Math.abs(rootMetrics.deltaUsd), "USD")}`
        }
        sub={overBudget ? "bütçe üstü" : "bütçe altı"}
        icon={overBudget ? TrendingUp : TrendingDown}
        iconBg={
          overBudget ? "rgba(244,63,94,0.14)" : "rgba(16,185,129,0.14)"
        }
        iconColor={overBudget ? "rgb(159 18 57)" : "rgb(4 120 87)"}
        valueBold
      />
      {/* 5. En Sapan */}
      <Tile
        label="En Sapan"
        value={
          topVariance
            ? `${topVariance.deltaUsd >= 0 ? "+" : "−"}${formatCompactCurrency(Math.abs(topVariance.deltaUsd), "USD")}`
            : "—"
        }
        sub={topVariance ? topVariance.label : "veri yok"}
        icon={topVariance && topVariance.deltaUsd > 0 ? TrendingUp : TrendingDown}
        iconBg="rgba(245,158,11,0.14)"
        iconColor="rgb(180 83 9)"
      />
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  icon,
  iconBg,
  iconColor,
  valueBold,
}: {
  label: string;
  value: string;
  sub: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: any;
  iconBg: string;
  iconColor: string;
  valueBold?: boolean;
}) {
  return (
    <GlassPanel tone="subtle" className="rounded-xl">
      <div className="px-4 py-3 flex items-start gap-3">
        <span
          className="size-9 rounded-xl grid place-items-center shrink-0"
          style={{ backgroundColor: iconBg, color: iconColor }}
        >
          <HugeiconsIcon icon={icon} size={18} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-medium">
            {label}
          </div>
          <div
            className={`mt-0.5 tabular-nums leading-tight truncate ${
              valueBold ? "text-[18px] font-bold" : "text-[18px] font-semibold"
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
