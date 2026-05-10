import type { Project } from "@/lib/dataverse/entities";
import type { ActualExpenseRollupRow } from "@/lib/dataverse/actualExpenseRollup";
import { selectEstimateTotal } from "@/lib/selectors/project";

/** Hierarchy: Segment → Voyage Status → Vessel/Project → Expense Line. */
export type ViewMode = "vessel" | "project";

export interface PLCostMetrics {
  /** Tahmini USD — composer'dan `costEstimate.totalUsd`. */
  expectedUsd: number;
  /** Gerçekleşen USD — actual rollup rows toplamı (710041 sign-flipped). */
  realizedUsd: number;
  /** realizedUsd / expectedUsd × 100. null when expectedUsd ≤ 0. */
  realizedExpectedPct: number | null;
  /** Tahmini birim USD/MT — expectedUsd / expectedQty. */
  expectedPriceUsdPerMt: number;
  /** Gerçekleşen birim USD/MT — realizedUsd / vesselQty. */
  realizedPriceUsdPerMt: number;
  /** vesselQty / expectedQty × 100. null when expectedQty ≤ 0. */
  realizedExpectedTonPct: number | null;
  /** Gemi tonajı (MT) — `vesselPlan.voyageTotalTonnage`. */
  quantityVesselMt: number;
  /** Tahmini miktar (MT) — Σ `lines[i].quantityKg / 1000`. */
  expectedQuantityMt: number;
  /** realizedUsd − expectedUsd (positive = bütçe aşımı). */
  deltaUsd: number;
}

export type PLCostNodeLevel = 1 | 2 | 3 | 4;

export interface PLCostNode {
  /** Path-based unique key (segment::voyage::project::expense). */
  id: string;
  level: PLCostNodeLevel;
  /** Display label (segment, voyage status, vessel/project name, expense). */
  label: string;
  /** Optional secondary label — mono code (PRJ no, expense code). */
  subLabel?: string;
  children?: PLCostNode[];
  metrics: PLCostMetrics;
  /** Project numbers contributing to this node (for drill-down filter). */
  rawProjectNos: string[];
  /** Expense rollup rows contributing to this node (only L3 + L4
   *  carry these; aggregates above sum recursively). */
  rawExpenseRows?: ActualExpenseRollupRow[];
}

const EMPTY_METRICS: PLCostMetrics = {
  expectedUsd: 0,
  realizedUsd: 0,
  realizedExpectedPct: null,
  expectedPriceUsdPerMt: 0,
  realizedPriceUsdPerMt: 0,
  realizedExpectedTonPct: null,
  quantityVesselMt: 0,
  expectedQuantityMt: 0,
  deltaUsd: 0,
};

/** Per-project metrics — domain values straight from the composer +
 *  the rollup rows. Used as leaves' starting point; parent levels
 *  recursive-sum these. */
function projectMetrics(
  project: Project,
  rollupForProject: ActualExpenseRollupRow[]
): PLCostMetrics {
  const expectedUsd = selectEstimateTotal(project);
  const realizedUsd = rollupForProject.reduce(
    (s, r) => s + (Number.isFinite(r.totalUsd) ? r.totalUsd : 0),
    0
  );
  const expectedQuantityMt =
    project.lines.reduce((s, l) => s + (l.quantityKg ?? 0), 0) / 1000;
  const quantityVesselMt = project.vesselPlan?.voyageTotalTonnage ?? 0;
  return finaliseMetrics({
    ...EMPTY_METRICS,
    expectedUsd,
    realizedUsd,
    expectedQuantityMt,
    quantityVesselMt,
  });
}

/** Compute the derived ratio + price fields from the raw sums. Used
 *  both for leaf metrics and parent rollups (the latter sums first,
 *  then re-derives). */
function finaliseMetrics(m: PLCostMetrics): PLCostMetrics {
  const realizedExpectedPct =
    m.expectedUsd > 0 ? (m.realizedUsd / m.expectedUsd) * 100 : null;
  const realizedExpectedTonPct =
    m.expectedQuantityMt > 0
      ? (m.quantityVesselMt / m.expectedQuantityMt) * 100
      : null;
  const expectedPriceUsdPerMt =
    m.expectedQuantityMt > 0 ? m.expectedUsd / m.expectedQuantityMt : 0;
  const realizedPriceUsdPerMt =
    m.quantityVesselMt > 0 ? m.realizedUsd / m.quantityVesselMt : 0;
  const deltaUsd = m.realizedUsd - m.expectedUsd;
  return {
    ...m,
    realizedExpectedPct,
    realizedExpectedTonPct,
    expectedPriceUsdPerMt,
    realizedPriceUsdPerMt,
    deltaUsd,
  };
}

/** Sum a child's contributing sums into the parent. Derived ratios
 *  are NOT summed — they're re-computed by `finaliseMetrics` once
 *  all children have been folded in. */
function addToParent(parent: PLCostMetrics, child: PLCostMetrics): void {
  parent.expectedUsd += child.expectedUsd;
  parent.realizedUsd += child.realizedUsd;
  parent.expectedQuantityMt += child.expectedQuantityMt;
  parent.quantityVesselMt += child.quantityVesselMt;
}

/** Group a list by a key extractor, preserving insertion order of
 *  first occurrence. */
function groupBy<T>(
  items: T[],
  keyOf: (item: T) => string
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = keyOf(item) || "";
    const bucket = out.get(k);
    if (bucket) bucket.push(item);
    else out.set(k, [item]);
  }
  return out;
}

/**
 * Build the 4-level hierarchy:
 *
 *   Level 1: Segment            (Project.segment, "—" when empty)
 *   Level 2: Voyage Status      (vesselPlan.vesselStatus, fallback "—")
 *   Level 3: Vessel OR Project  (toggle via `viewMode`)
 *   Level 4: Expense Line       (rollup row, label = refExpenseId
 *                                fallback description fallback expenseId)
 *
 * Aggregates roll up bottom-to-top: leaf project metrics fold into
 * their L3 parent (when viewMode="vessel" multiple projects per
 * vessel collapse together), then up through voyage status into
 * segment. Expense lines (L4) only carry realised numbers — there's
 * no per-line tahmini comparison in the source data, so estimate
 * fields are set to 0 at L4 and the comparison happens at L3+.
 */
export function buildPLCostTree(
  projects: Project[],
  rollupRows: ActualExpenseRollupRow[],
  viewMode: ViewMode
): PLCostNode[] {
  // Index rollup rows by projectNo for O(1) per-project lookup.
  const rollupByProject = groupBy(rollupRows, (r) => r.projectNo);

  // L1: segment
  const bySegment = groupBy(projects, (p) => p.segment || "—");
  const tree: PLCostNode[] = [];

  for (const [segmentKey, segmentProjects] of bySegment) {
    const segmentMetrics: PLCostMetrics = { ...EMPTY_METRICS };
    const segmentChildren: PLCostNode[] = [];
    const segmentProjectNos: string[] = [];

    // L2: voyage status within segment
    const byVoyage = groupBy(
      segmentProjects,
      (p) => p.vesselPlan?.vesselStatus || "—"
    );

    for (const [voyageKey, voyageProjects] of byVoyage) {
      const voyageMetrics: PLCostMetrics = { ...EMPTY_METRICS };
      const voyageChildren: PLCostNode[] = [];
      const voyageProjectNos: string[] = [];

      // L3: vessel OR project
      const l3Groups =
        viewMode === "vessel"
          ? groupBy(
              voyageProjects,
              (p) => p.vesselPlan?.vesselName || p.projectNo
            )
          : groupBy(voyageProjects, (p) => p.projectNo);

      for (const [l3Key, l3Projects] of l3Groups) {
        const l3Metrics: PLCostMetrics = { ...EMPTY_METRICS };
        const l3ProjectNos: string[] = [];
        const l3RollupRows: ActualExpenseRollupRow[] = [];

        // L4: expense lines from all rollup rows of all projects
        // belonging to this L3 group, grouped by expenseId so the
        // user sees one row per (vessel/project, expense category).
        const expenseRowsForL3: ActualExpenseRollupRow[] = [];
        for (const project of l3Projects) {
          const projRollup = rollupByProject.get(project.projectNo) ?? [];
          const projMetrics = projectMetrics(project, projRollup);
          addToParent(l3Metrics, projMetrics);
          l3ProjectNos.push(project.projectNo);
          expenseRowsForL3.push(...projRollup);
          l3RollupRows.push(...projRollup);
        }

        const byExpense = groupBy(
          expenseRowsForL3,
          (r) => r.expenseId || "—"
        );
        const expenseChildren: PLCostNode[] = [];
        for (const [expenseId, rows] of byExpense) {
          const realizedSum = rows.reduce(
            (s, r) => s + (Number.isFinite(r.totalUsd) ? r.totalUsd : 0),
            0
          );
          // Pick the most descriptive label available.
          const sampleRow = rows[0];
          const label =
            sampleRow.refExpenseId ||
            sampleRow.description ||
            expenseId ||
            "—";
          expenseChildren.push({
            id: `${segmentKey}::${voyageKey}::${l3Key}::${expenseId}`,
            level: 4,
            label,
            subLabel: expenseId,
            metrics: finaliseMetrics({
              ...EMPTY_METRICS,
              realizedUsd: realizedSum,
            }),
            rawProjectNos: l3ProjectNos,
            rawExpenseRows: rows,
          });
        }
        // Sort expense lines by realizedUsd desc so the biggest
        // contributors lead.
        expenseChildren.sort(
          (a, b) => b.metrics.realizedUsd - a.metrics.realizedUsd
        );

        const l3 = l3Projects[0];
        // L3 sub-label: when grouping by vessel, sample project no;
        // when grouping by project, the project name.
        const l3SubLabel =
          viewMode === "vessel"
            ? l3Projects.length === 1
              ? l3.projectNo
              : `${l3Projects.length} proje`
            : l3.projectName;

        const l3Node: PLCostNode = {
          id: `${segmentKey}::${voyageKey}::${l3Key}`,
          level: 3,
          label: l3Key,
          subLabel: l3SubLabel,
          metrics: finaliseMetrics(l3Metrics),
          rawProjectNos: l3ProjectNos,
          rawExpenseRows: l3RollupRows,
          children: expenseChildren.length > 0 ? expenseChildren : undefined,
        };

        addToParent(voyageMetrics, l3Metrics);
        voyageProjectNos.push(...l3ProjectNos);
        voyageChildren.push(l3Node);
      }

      // Sort L3 within voyage by realizedUsd desc.
      voyageChildren.sort(
        (a, b) => b.metrics.realizedUsd - a.metrics.realizedUsd
      );

      const voyageNode: PLCostNode = {
        id: `${segmentKey}::${voyageKey}`,
        level: 2,
        label: voyageKey,
        metrics: finaliseMetrics(voyageMetrics),
        rawProjectNos: voyageProjectNos,
        children: voyageChildren,
      };
      addToParent(segmentMetrics, voyageMetrics);
      segmentProjectNos.push(...voyageProjectNos);
      segmentChildren.push(voyageNode);
    }

    voyageChildren_sort: {
      // Sort voyage statuses inside segment by realizedUsd desc.
      segmentChildren.sort(
        (a, b) => b.metrics.realizedUsd - a.metrics.realizedUsd
      );
      break voyageChildren_sort;
    }

    tree.push({
      id: segmentKey,
      level: 1,
      label: segmentKey,
      metrics: finaliseMetrics(segmentMetrics),
      rawProjectNos: segmentProjectNos,
      children: segmentChildren,
    });
  }

  // Sort segments by realizedUsd desc.
  tree.sort((a, b) => b.metrics.realizedUsd - a.metrics.realizedUsd);
  return tree;
}

/** Aggregate metrics across the whole tree — top-level KPI tile
 *  numbers (toplam tahmini, toplam gerçekleşen, vs). */
export function aggregateRootMetrics(tree: PLCostNode[]): PLCostMetrics {
  const sum: PLCostMetrics = { ...EMPTY_METRICS };
  for (const node of tree) addToParent(sum, node.metrics);
  return finaliseMetrics(sum);
}
