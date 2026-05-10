import { HugeiconsIcon } from "@hugeicons/react";
import {
  Coins02Icon,
  ChartHistogramIcon,
  TargetIcon,
  TrendingDown,
  TrendingUp,
  Alert02Icon,
} from "@hugeicons/core-free-icons";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
 *
 * Every tile has an explanatory hover tooltip describing what the KPI
 * actually means — definition + how it's calculated + when it matters.
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
    <TooltipProvider delayDuration={250}>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <Tile
          label="Toplam Tahmini"
          value={formatCompactCurrency(rootMetrics.expectedUsd, "USD")}
          sub={`${totalProjects} proje`}
          icon={Coins02Icon}
          tone="slate"
          tooltip={{
            title: "Toplam Tahmini Gider",
            body:
              "Filtrelenmiş tüm projelerin Masraf Tahmini (cost estimate) toplamı. Her projedeki Navlun, Sigorta, Gümrük ve diğer kalemlerin USD eşdeğer toplamından gelir. Karşılaştırma referansı budur — gerçekleşen bu rakama yakınsadıkça performans hedeftedir.",
            formula: "Σ project.costEstimate.totalUsd",
          }}
        />
        <Tile
          label="Toplam Gerçekleşen"
          value={formatCompactCurrency(rootMetrics.realizedUsd, "USD")}
          sub="rollup'tan toplam"
          icon={ChartHistogramIcon}
          tone="sky"
          valueBold
          tooltip={{
            title: "Toplam Gerçekleşen Gider",
            body:
              "F&O fatura/expense kayıtlarından gelen gerçekleşen gider toplamı. Inventdimb → distribution → expense-line zincirinden aggregate edilir. 710041 (Satış Fiyat Farkı) negatif kontribüsyon olarak işlenir, yani toplamı düşürür. Bu rakam tahmine yaklaştıkça proje performansı tutarlıdır.",
            formula: "Σ rollup.totalUsd (PRJ × expense)",
          }}
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
          tooltip={{
            title: "Gerçekleşme Oranı",
            body:
              "Gerçekleşen ile Tahmini arasındaki oransal ilişki. %95–%105 aralığı hedefte sayılır — bu aralıkta yeşil, üzerinde kırmızı (bütçe aşıldı), altında amber (henüz tamamlanmamış olabilir) gösterilir.",
            formula: "Gerçekleşen ÷ Tahmini × 100",
          }}
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
          tooltip={{
            title: "Mutlak Sapma (USD)",
            body:
              "Gerçekleşen − Tahmini farkı. Pozitif değer bütçe üstü, negatif değer bütçe altı kalındığını gösterir. Yön kadar büyüklüğü de önemli: küçük bir % sapma bile dolar tabanında büyük olabilir (özellikle yüksek hacimli projelerde).",
            formula: "Gerçekleşen − Tahmini",
          }}
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
          tooltip={{
            title: "En Sapan L3 Düğümü",
            body:
              "Tüm 'Vessel × Statü' (3. seviye) düğümleri arasında mutlak sapması (|Gerçekleşen − Tahmini|) en yüksek olanı. Tahminin sıfır olduğu düğümler hariç tutulur (oran patlaması engellenir). Hangi proje/geminin sapmaya en çok katkı verdiğini görmek için tabloda arayın.",
            formula: "arg max |deltaUsd|",
          }}
        />
      </div>
    </TooltipProvider>
  );
}

function Tile({
  label,
  value,
  sub,
  icon,
  tone,
  valueBold,
  tooltip,
}: {
  label: string;
  value: string;
  sub: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: any;
  tone: Tone;
  valueBold?: boolean;
  tooltip: {
    title: string;
    body: string;
    formula: string;
  };
}) {
  const palette = TONE_PALETTE[tone];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="cursor-help">
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
                    valueBold
                      ? "text-[19px] font-bold"
                      : "text-[18px] font-semibold"
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
        </div>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        align="start"
        sideOffset={8}
        className="max-w-[320px] p-0 overflow-hidden"
      >
        <div className="px-3 py-2.5">
          <div className="flex items-center gap-2 mb-1.5">
            <span
              className="size-5 rounded-md grid place-items-center shrink-0 text-white"
              style={{ background: palette.gradient }}
            >
              <HugeiconsIcon icon={icon} size={11} strokeWidth={2.25} />
            </span>
            <span className="text-[11.5px] font-bold uppercase tracking-wider text-foreground">
              {tooltip.title}
            </span>
          </div>
          <p className="text-[12px] leading-snug text-foreground/85 whitespace-normal font-normal">
            {tooltip.body}
          </p>
          <div className="mt-2 pt-1.5 border-t border-foreground/10">
            <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground font-semibold mb-0.5">
              Formül
            </div>
            <code className="text-[11px] font-mono text-foreground/90 leading-tight">
              {tooltip.formula}
            </code>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
