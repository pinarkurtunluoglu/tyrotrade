import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert02Icon,
  AlertDiamondIcon,
  CheckmarkCircle02Icon,
  InformationCircleIcon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type {
  PLCostInsight,
  InsightTone,
} from "@/lib/selectors/plInsights";

interface PLCostInsightsRibbonProps {
  insights: PLCostInsight[];
  /** Optional click handler — when provided, chips with a
   *  `targetNodeId` become clickable. */
  onSelectNode?: (nodeId: string) => void;
}

/** Tone palette — premium gradient + ring + text colour + icon glyph.
 *  Same family as the progress UI so both surfaces feel from the
 *  same design system. */
const TONE_PALETTE: Record<
  InsightTone,
  {
    bg: string;
    ring: string;
    text: string;
    iconColor: string;
    iconBg: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    icon: any;
  }
> = {
  danger: {
    bg: "linear-gradient(135deg, rgba(244,63,94,0.10), rgba(225,29,72,0.06))",
    ring: "rgba(244,63,94,0.32)",
    text: "rgb(159 18 57)",
    iconColor: "rgb(244 63 94)",
    iconBg: "rgba(244,63,94,0.14)",
    icon: Alert02Icon,
  },
  warning: {
    bg: "linear-gradient(135deg, rgba(245,158,11,0.12), rgba(217,119,6,0.06))",
    ring: "rgba(245,158,11,0.36)",
    text: "rgb(180 83 9)",
    iconColor: "rgb(217 119 6)",
    iconBg: "rgba(245,158,11,0.16)",
    icon: AlertDiamondIcon,
  },
  positive: {
    bg: "linear-gradient(135deg, rgba(16,185,129,0.10), rgba(5,150,105,0.06))",
    ring: "rgba(16,185,129,0.32)",
    text: "rgb(4 120 87)",
    iconColor: "rgb(16 185 129)",
    iconBg: "rgba(16,185,129,0.14)",
    icon: CheckmarkCircle02Icon,
  },
  info: {
    bg: "linear-gradient(135deg, rgba(59,130,246,0.10), rgba(37,99,235,0.06))",
    ring: "rgba(59,130,246,0.34)",
    text: "rgb(29 78 216)",
    iconColor: "rgb(37 99 235)",
    iconBg: "rgba(59,130,246,0.14)",
    icon: InformationCircleIcon,
  },
};

/**
 * Single-row insights ribbon — sits between the toolbar and the
 * KPI tiles. Renders 3-5 punchy callouts (auto-generated from the
 * tree). Each chip is clickable (opens detail panel on the target
 * node) AND surfaces a richer hover tooltip with context.
 */
export function PLCostInsightsRibbon({
  insights,
  onSelectNode,
}: PLCostInsightsRibbonProps) {
  if (insights.length === 0) return null;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex items-center gap-2.5 overflow-x-auto whitespace-nowrap min-w-0 flex-1">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground shrink-0">
          <HugeiconsIcon
            icon={SparklesIcon}
            size={14}
            strokeWidth={2}
            className="text-amber-500"
          />
          Akıllı İçgörüler
        </span>
        <span className="h-5 w-px bg-border/60 shrink-0" />
        {insights.map((ins, i) => (
          <Chip
            key={i}
            insight={ins}
            onClick={
              ins.targetNodeId && onSelectNode
                ? () => onSelectNode(ins.targetNodeId!)
                : undefined
            }
          />
        ))}
      </div>
    </TooltipProvider>
  );
}

function Chip({
  insight,
  onClick,
}: {
  insight: PLCostInsight;
  onClick?: () => void;
}) {
  const palette = TONE_PALETTE[insight.tone];
  const interactive = !!onClick;

  const chip = (
    <button
      type="button"
      onClick={onClick}
      disabled={!interactive}
      className={cn(
        "group inline-flex items-center gap-2 pl-1.5 pr-3 py-1 rounded-full text-[13px] font-semibold tracking-tight shrink-0 transition-all",
        interactive
          ? "cursor-pointer hover:scale-[1.02] hover:shadow-[0_4px_14px_-4px_rgba(15,23,42,0.18)] active:scale-100"
          : "cursor-default"
      )}
      style={{
        background: palette.bg,
        color: palette.text,
        boxShadow: `inset 0 0 0 1px ${palette.ring}`,
      }}
    >
      <span
        className="size-5 rounded-full grid place-items-center shrink-0 transition-transform group-hover:scale-110"
        style={{ background: palette.iconBg, color: palette.iconColor }}
      >
        <HugeiconsIcon
          icon={palette.icon}
          size={12}
          strokeWidth={2.25}
        />
      </span>
      <span className="leading-none">{insight.text}</span>
    </button>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{chip}</TooltipTrigger>
      <TooltipContent
        side="bottom"
        align="start"
        sideOffset={8}
        className="max-w-[320px] p-0 overflow-hidden"
      >
        <div
          className="px-3 py-2.5"
          style={{
            background: palette.bg,
            color: palette.text,
            boxShadow: `inset 0 0 0 1px ${palette.ring}`,
          }}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <span
              className="size-5 rounded-full grid place-items-center shrink-0"
              style={{ background: palette.iconBg, color: palette.iconColor }}
            >
              <HugeiconsIcon
                icon={palette.icon}
                size={12}
                strokeWidth={2.25}
              />
            </span>
            <span className="text-[11.5px] font-bold uppercase tracking-wider">
              {insight.text}
            </span>
          </div>
          <p className="text-[12px] leading-snug text-foreground/85 normal-case font-normal whitespace-normal">
            {insight.tooltip}
          </p>
          {interactive && (
            <div className="text-[10.5px] font-semibold uppercase tracking-wider mt-1.5 opacity-70">
              ▸ Tıklayın · Detay panel açılır
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
