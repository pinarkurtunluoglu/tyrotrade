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

/** Tone palette — bg / text / emoji prefix. Mirrors the ProgressUI
 *  tone semantics so both surfaces feel from the same family. */
const TONE_PALETTE: Record<
  InsightTone,
  { bg: string; ring: string; text: string; emoji: string }
> = {
  danger: {
    bg: "rgba(244,63,94,0.10)",
    ring: "rgba(244,63,94,0.28)",
    text: "rgb(159 18 57)",
    emoji: "⚠",
  },
  warning: {
    bg: "rgba(245,158,11,0.12)",
    ring: "rgba(245,158,11,0.32)",
    text: "rgb(180 83 9)",
    emoji: "💰",
  },
  positive: {
    bg: "rgba(16,185,129,0.10)",
    ring: "rgba(16,185,129,0.28)",
    text: "rgb(4 120 87)",
    emoji: "✅",
  },
  info: {
    bg: "rgba(59,130,246,0.10)",
    ring: "rgba(59,130,246,0.30)",
    text: "rgb(29 78 216)",
    emoji: "ℹ",
  },
};

/**
 * Single-row insights ribbon — sits between the toolbar and the
 * KPI tiles. Renders 3-5 punchy callouts (auto-generated from the
 * tree). Horizontal scroll on narrow viewports.
 */
export function PLCostInsightsRibbon({
  insights,
  onSelectNode,
}: PLCostInsightsRibbonProps) {
  if (insights.length === 0) return null;

  return (
    <div className="flex items-center gap-2.5 overflow-x-auto whitespace-nowrap min-w-0 flex-1">
      <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground shrink-0">
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
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[13px] font-semibold tracking-tight shrink-0",
        onClick && "cursor-pointer hover:opacity-90 transition-opacity"
      )}
      style={{
        backgroundColor: palette.bg,
        color: palette.text,
        boxShadow: `inset 0 0 0 1px ${palette.ring}`,
      }}
    >
      <span aria-hidden className="text-[15px] leading-none">
        {palette.emoji}
      </span>
      <span>{insight.text}</span>
    </Tag>
  );
}
