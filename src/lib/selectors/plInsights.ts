/**
 * Smart insights generator for the Trade Cost page.
 *
 * Walks the L1 (segment) layer of the hierarchy and surfaces 4-6
 * punchy callouts an executive can scan in one breath. The focus is
 * on **segment-level** comparisons because that's the unit of
 * portfolio thinking: "where did we spend most", "which segment did
 * we forecast best", "where did things go off the rails".
 *
 * Generated insights (in priority order):
 *
 *   1. (Optional alert) "X proje %120+ — bütçe aşımı"
 *      A drill-down callout pointing to the worst over-budget project.
 *      Only emitted when at least one L3 row is more than 120%
 *      realised. Keeps the operational signal visible alongside the
 *      portfolio-level segment insights.
 *
 *   2. En Dengeli Segment
 *      Segment whose R/E % is closest to 100% — the segment we
 *      forecast most accurately.
 *
 *   3. En Masraflı Segment
 *      Segment with the highest absolute `realizedUsd` — where the
 *      portfolio is spending the most money.
 *
 *   4. En Az Masraflı Segment
 *      Segment with the lowest absolute `realizedUsd` (above a small
 *      minimum so we don't pick a noise segment) — the smallest line
 *      item in the portfolio.
 *
 *   5. Tahminden En Çok Sapan Segment
 *      Segment with the biggest absolute |deltaUsd| — the biggest
 *      dollar-amount surprise vs estimate, in either direction.
 *
 *   6. Tahminden En Az Sapan Segment
 *      Segment with the smallest absolute |deltaUsd| (still above a
 *      minimum so we don't pick a meaningless near-zero one) — the
 *      best forecast in dollar terms.
 *
 * Each insight carries:
 *   - `text`    : short chip label (≤ 80 chars)
 *   - `tone`    : drives chip background + icon
 *   - `tooltip` : richer hover explanation (2-3 sentences max)
 *   - `targetNodeId` (when applicable): chip becomes clickable and
 *     opens the corresponding detail panel
 *
 * Duplicate suppression: if two insights would point to the same
 * segment id, only the higher-priority one is kept so the ribbon
 * doesn't read as the same segment repeated.
 */

import type { PLCostNode } from "@/lib/selectors/plCost";
import { formatCompactCurrency } from "@/lib/format";

export type InsightTone = "positive" | "warning" | "danger" | "info";

export interface PLCostInsight {
  /** Short, punchy callout text (≤ 80 chars). */
  text: string;
  /** Tone drives chip background + icon. */
  tone: InsightTone;
  /** Hover tooltip explanation (richer than `text`). */
  tooltip: string;
  /** When set, clicking the chip should scroll/highlight this node. */
  targetNodeId?: string;
}

/** Threshold helpers. Tunable in one place if exec preferences shift. */
const OVER_BUDGET_PCT = 120;
/** Minimum realisedUsd a segment needs to be considered eligible for
 *  "en az masraflı" — without it, the smallest segment is always a
 *  $1 noise row and the callout reads as garbage. */
const MIN_REALIZED_FOR_LOW_SPEND = 50_000;
/** Minimum |deltaUsd| for "en az sapan" — same reason; without a
 *  floor we'd surface a $200 delta on a $5M segment as "perfect". */
const MIN_DELTA_FOR_SMALL_VARIANCE = 5_000;

/**
 * Build the ribbon insights from a fully-aggregated tree. Returns up
 * to 6 callouts. Empty tree → empty array (caller hides the ribbon).
 */
export function generateSmartInsights(tree: PLCostNode[]): PLCostInsight[] {
  if (tree.length === 0) return [];

  // L1 segments are the primary subject. Filter to ones with real
  // signal in both expected and realised — empty-expected segments
  // produce null R/E ratios that don't fit the comparisons.
  const segments = tree.filter(
    (s) => s.metrics.expectedUsd > 0 && s.metrics.realizedUsd > 0
  );

  const out: PLCostInsight[] = [];
  const consumedSegmentIds = new Set<string>();

  // ─── 1. Over-budget projects alert (L3-level drill-down) ───
  // Kept because it's the single most operationally urgent signal:
  // "right now, one of your projects is bleeding money". The chip
  // points to the worst offender so a click goes straight to the
  // problem.
  const l3Nodes: PLCostNode[] = [];
  const walk = (nodes: PLCostNode[]) => {
    for (const n of nodes) {
      if (n.level === 3) l3Nodes.push(n);
      if (n.children) walk(n.children);
    }
  };
  walk(tree);
  const overBudget = l3Nodes
    .filter(
      (n) =>
        n.metrics.realizedExpectedPct != null &&
        n.metrics.realizedExpectedPct > OVER_BUDGET_PCT &&
        n.metrics.expectedUsd > 0
    )
    .sort(
      (a, b) =>
        (b.metrics.realizedExpectedPct ?? 0) -
        (a.metrics.realizedExpectedPct ?? 0)
    );
  if (overBudget.length > 0) {
    const worst = overBudget[0];
    const worstPct = worst.metrics.realizedExpectedPct?.toFixed(0) ?? "—";
    out.push({
      text:
        overBudget.length === 1
          ? `${worst.label} %${worstPct} gerçekleşti — bütçe aşımı`
          : `${overBudget.length} proje %${OVER_BUDGET_PCT}+ üzerinde — bütçe aşımı`,
      tone: "danger",
      tooltip:
        overBudget.length === 1
          ? `${worst.label} projesinde gerçekleşen gider tahminin %${worstPct}'ine ulaştı — yani tahminin ${(parseInt(worstPct, 10) - 100).toFixed(0)}% üzerinde. Tıklayarak bu projenin detay panelini açabilir, kalem bazında hangi giderin patladığını görebilirsiniz.`
          : `${overBudget.length} farklı projede gerçekleşen gider, tahmin edilen bütçenin %${OVER_BUDGET_PCT}'ini aştı. En kötü vakada %${worstPct} gerçekleşme var. Tıklayarak en yüksek sapan projeye gidin.`,
      targetNodeId: worst.id,
    });
  }

  if (segments.length === 0) {
    // Nothing comparable on the segment dimension — return only the
    // alert (if any). Caller hides the ribbon when this is empty.
    return out.slice(0, 6);
  }

  // ─── 2. En Dengeli Segment (R/E closest to 100%) ───
  const balanced = [...segments]
    .map((s) => ({
      seg: s,
      // distance from perfectly-on-budget, in percentage points
      gap: Math.abs((s.metrics.realizedExpectedPct ?? 100) - 100),
    }))
    .sort((a, b) => a.gap - b.gap)[0];
  if (balanced) {
    const seg = balanced.seg;
    const pct = seg.metrics.realizedExpectedPct?.toFixed(1) ?? "—";
    const gap = balanced.gap.toFixed(1);
    pushIf(out, consumedSegmentIds, {
      text: `${seg.label} en dengeli segment (%${pct})`,
      tone: "positive",
      tooltip: `${seg.label} segmentinde gerçekleşen gider, tahminin %${pct}'ine geldi — tahminden sadece ${gap} puan sapma. Portföydeki en isabetli forecast. Hangi statü/projelerin bu dengeyi tutturduğunu görmek için tıklayın.`,
      targetNodeId: seg.id,
    });
  }

  // ─── 3. En Masraflı Segment (highest realisedUsd) ───
  const heaviest = [...segments].sort(
    (a, b) => b.metrics.realizedUsd - a.metrics.realizedUsd
  )[0];
  if (heaviest) {
    const realised = formatCompactCurrency(heaviest.metrics.realizedUsd, "USD");
    const share =
      (heaviest.metrics.realizedUsd /
        segments.reduce((s, x) => s + x.metrics.realizedUsd, 0)) *
      100;
    pushIf(out, consumedSegmentIds, {
      text: `${heaviest.label} en masraflı segment (${realised})`,
      tone: "info",
      tooltip: `${heaviest.label} segmenti, gerçekleşen gider toplamının yaklaşık %${share.toFixed(0)}'ini tek başına oluşturuyor (${realised}, ${heaviest.rawProjectNos.length} proje). Portföyün en pahalı parçası. Hangi gider kalemlerinin bu paya katkı verdiğini görmek için tıklayın.`,
      targetNodeId: heaviest.id,
    });
  }

  // ─── 4. En Az Masraflı Segment (lowest realisedUsd above floor) ───
  const lightest = [...segments]
    .filter((s) => s.metrics.realizedUsd >= MIN_REALIZED_FOR_LOW_SPEND)
    .sort((a, b) => a.metrics.realizedUsd - b.metrics.realizedUsd)[0];
  if (lightest) {
    const realised = formatCompactCurrency(lightest.metrics.realizedUsd, "USD");
    pushIf(out, consumedSegmentIds, {
      text: `${lightest.label} en az masraflı segment (${realised})`,
      tone: "positive",
      tooltip: `${lightest.label} segmentinde toplam ${realised} gerçekleşen gider var — anlamlı eşiği aşan en düşük rakam. Küçük portföy ya da düşük lojistik yoğunluğu olabilir. Detay için tıklayın.`,
      targetNodeId: lightest.id,
    });
  }

  // ─── 5. Tahminden En Çok Sapan Segment (highest |deltaUsd|) ───
  const mostDeviated = [...segments].sort(
    (a, b) =>
      Math.abs(b.metrics.deltaUsd) - Math.abs(a.metrics.deltaUsd)
  )[0];
  if (mostDeviated && Math.abs(mostDeviated.metrics.deltaUsd) > 0) {
    const seg = mostDeviated;
    const overshoot = seg.metrics.deltaUsd > 0;
    const deltaTxt = formatCompactCurrency(
      Math.abs(seg.metrics.deltaUsd),
      "USD"
    );
    const pct = seg.metrics.realizedExpectedPct?.toFixed(0) ?? "—";
    pushIf(out, consumedSegmentIds, {
      text: overshoot
        ? `${seg.label} tahmini ${deltaTxt} aştı`
        : `${seg.label} tahminin ${deltaTxt} altında`,
      tone: overshoot ? "warning" : "positive",
      tooltip: overshoot
        ? `${seg.label} segmentinde gerçekleşen gider, tahminin ${deltaTxt} (%${pct}) üzerine çıktı — portföyde tahminden en çok sapan segment. Tıklayarak hangi statü ve projelerin bu sapmaya neden olduğunu görebilirsiniz.`
        : `${seg.label} segmentinde gerçekleşen gider, tahminin ${deltaTxt} (%${pct}) altında kaldı — portföyde tahminden en çok sapan segment ama pozitif yönde. Tıklayarak nereden tasarruf çıktığını görebilirsiniz.`,
      targetNodeId: seg.id,
    });
  }

  // ─── 6. Tahminden En Az Sapan Segment (smallest |deltaUsd|) ───
  // Hard floor on the delta — without it we'd surface a $200 delta
  // on a $5M segment as "perfect forecast" which feels like cheating.
  const leastDeviated = [...segments]
    .filter(
      (s) => Math.abs(s.metrics.deltaUsd) >= MIN_DELTA_FOR_SMALL_VARIANCE
    )
    .sort(
      (a, b) =>
        Math.abs(a.metrics.deltaUsd) - Math.abs(b.metrics.deltaUsd)
    )[0];
  if (leastDeviated) {
    const seg = leastDeviated;
    const deltaTxt = formatCompactCurrency(
      Math.abs(seg.metrics.deltaUsd),
      "USD"
    );
    const pct = seg.metrics.realizedExpectedPct?.toFixed(0) ?? "—";
    pushIf(out, consumedSegmentIds, {
      text: `${seg.label} tahminden en az saptı (Δ ${deltaTxt})`,
      tone: "positive",
      tooltip: `${seg.label} segmentinde gerçekleşen ile tahmini arasında yalnızca ${deltaTxt} fark var (%${pct} gerçekleşme). Anlamlı bir forecast hatası eşiğinin (${formatCompactCurrency(MIN_DELTA_FOR_SMALL_VARIANCE, "USD")}) altındaki en isabetli segment.`,
      targetNodeId: seg.id,
    });
  }

  return out.slice(0, 6);
}

/** Push an insight only when its target segment hasn't already been
 *  consumed by a higher-priority callout. Keeps the ribbon from
 *  showing the same segment three times when one segment happens to
 *  be the heaviest AND the most-balanced AND the most-deviating
 *  (small portfolio edge case). */
function pushIf(
  out: PLCostInsight[],
  consumed: Set<string>,
  insight: PLCostInsight
): void {
  if (insight.targetNodeId && consumed.has(insight.targetNodeId)) return;
  out.push(insight);
  if (insight.targetNodeId) consumed.add(insight.targetNodeId);
}
