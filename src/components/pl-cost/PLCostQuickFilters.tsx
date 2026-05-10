import * as React from "react";
import {
  MultiSelectCombobox,
  type MultiSelectOption,
} from "@/components/ui/multi-select-combobox";
import { useThemeAccent } from "@/components/layout/theme-accent";
import type { Project } from "@/lib/dataverse/entities";
import type { ProjectFilterState } from "@/lib/filters/projectFilters";

/** Auto-incrementing ID seed so each Combo gets a stable
 *  `aria-labelledby` link from its trigger to its small visible
 *  label. Avoids running React's useId hook six times. */
let comboLabelCounter = 0;

interface PLCostQuickFiltersProps {
  /** Domain project list (unfiltered) — used as the source for
   *  building distinct option lists for each combobox. */
  projects: Project[];
  filters: ProjectFilterState;
  onChange: (next: ProjectFilterState) => void;
}

/**
 * P&L Cost'un sabit filtre satırı — 6 multiselect combobox yan yana:
 * Segment, Proje No, Gemi, Gemi Durumu (vesselStatus), Ana Trader,
 * Trader. Her birinin trigger'ı `MultiSelectCombobox` (filterler
 * ile aynı dialect — selected count chip + searchable list).
 *
 * State `ProjectFilterState` ile senkron — AdvancedFilter popover'ı
 * ile aynı şeyi yazıyoruz. Yani burada bir segment seçince
 * gelişmiş filtre popover'ında o segment chip'i de aktif. Tek
 * kaynak.
 */
export function PLCostQuickFilters({
  projects,
  filters,
  onChange,
}: PLCostQuickFiltersProps) {
  const accent = useThemeAccent();

  // Distinct option lists derived from the unfiltered domain project
  // list — same source the AdvancedFilter popover uses, so the chip
  // sets stay aligned.
  const options = React.useMemo(() => {
    const segments = new Set<string>();
    const projectNos = new Map<string, MultiSelectOption>();
    const vessels = new Set<string>();
    const voyageStatuses = new Set<string>();
    const mainTraders = new Set<string>();
    const traders = new Set<string>();

    for (const p of projects) {
      if (p.segment) segments.add(p.segment);
      if (p.projectNo) {
        projectNos.set(p.projectNo, {
          value: p.projectNo,
          label: p.projectNo,
          sub: p.projectName,
          keywords: [p.projectName, p.segment ?? ""],
        });
      }
      const vesselName = p.vesselPlan?.vesselName?.trim();
      if (vesselName) vessels.add(vesselName);
      const vs = p.vesselPlan?.vesselStatus;
      if (vs) voyageStatuses.add(vs);
      if (p.mainTraderNo) mainTraders.add(p.mainTraderNo);
      if (p.traderNo) traders.add(p.traderNo);
    }
    const toSortedArr = (s: Set<string>) =>
      Array.from(s).sort((a, b) => a.localeCompare(b, "tr"));
    return {
      segments: toSortedArr(segments),
      projects: Array.from(projectNos.values()).sort((a, b) =>
        normalizeLabel(a).localeCompare(normalizeLabel(b), "tr")
      ),
      vessels: toSortedArr(vessels),
      voyageStatuses: toSortedArr(voyageStatuses),
      mainTraders: toSortedArr(mainTraders),
      traders: toSortedArr(traders),
    };
  }, [projects]);

  return (
    <div
      role="group"
      aria-label="Hızlı filtreler"
      className="flex items-end gap-2.5 flex-wrap min-w-0 flex-1"
    >
      <Combo
        label="Segment"
        options={options.segments}
        selected={filters.segments}
        onChange={(next) => onChange({ ...filters, segments: next })}
        accent={accent}
        searchPlaceholder="Segment ara..."
      />
      <Combo
        label="Proje"
        options={options.projects}
        selected={filters.projectNos}
        onChange={(next) => onChange({ ...filters, projectNos: next })}
        accent={accent}
        searchPlaceholder="Proje no / adı ara..."
      />
      <Combo
        label="Gemi"
        options={options.vessels}
        selected={filters.vessels}
        onChange={(next) => onChange({ ...filters, vessels: next })}
        accent={accent}
        searchPlaceholder="Gemi adı ara..."
      />
      <Combo
        label="Gemi Durumu"
        options={options.voyageStatuses}
        selected={filters.voyageStatuses}
        onChange={(next) => onChange({ ...filters, voyageStatuses: next })}
        accent={accent}
        searchPlaceholder="Durum ara..."
      />
      <Combo
        label="Ana Trader"
        options={options.mainTraders}
        selected={filters.mainTraders}
        onChange={(next) => onChange({ ...filters, mainTraders: next })}
        accent={accent}
        searchPlaceholder="Ana trader ara..."
      />
      <Combo
        label="Trader"
        options={options.traders}
        selected={filters.traders}
        onChange={(next) => onChange({ ...filters, traders: next })}
        accent={accent}
        searchPlaceholder="Trader ara..."
      />
    </div>
  );
}

function normalizeLabel(o: MultiSelectOption): string {
  return typeof o === "string" ? o : o.label;
}

/**
 * Compact wrapper that renders a small uppercase label above the
 * combobox trigger so the user can tell at a glance which filter
 * each chip controls without opening it.
 *
 * Best-practice details:
 *   - Stable id on the label + `aria-labelledby` on the trigger so
 *     screen readers announce "Segment combobox, no selection" etc.
 *   - Label uses `leading-none` and a fixed 4 px gap below so the
 *     label baseline + trigger top are visually predictable.
 *   - Tight min-width (132 px) lets 6 columns fit comfortably on a
 *     1280 px viewport without wrap.
 *   - Label colour shifts to accent.solid when a selection is
 *     active — instant visual feedback that the column is "doing
 *     something" without needing to read the chip inside the
 *     trigger.
 */
function Combo({
  label,
  options,
  selected,
  onChange,
  accent,
  searchPlaceholder,
}: {
  label: string;
  options: ReadonlyArray<MultiSelectOption>;
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  accent: { solid: string; ring: string; tint: string };
  searchPlaceholder: string;
}) {
  // Stable id for aria-labelledby linkage. useRef instead of useId
  // because the global counter is enough and we never want this id
  // to change across renders.
  const idRef = React.useRef<string>("");
  if (!idRef.current) {
    comboLabelCounter += 1;
    idRef.current = `plcost-combo-label-${comboLabelCounter}`;
  }
  const hasSelection = selected.size > 0;
  return (
    <div className="flex flex-col min-w-[132px] max-w-[180px]">
      <span
        id={idRef.current}
        className="text-[10.5px] font-bold uppercase tracking-wider leading-none mb-1.5 px-0.5 transition-colors"
        style={{
          color: hasSelection ? accent.solid : "rgba(15, 23, 42, 0.78)",
        }}
      >
        {label}
      </span>
      <MultiSelectCombobox
        options={options}
        selected={selected}
        onChange={onChange}
        accent={accent}
        placeholder="Hepsi"
        searchPlaceholder={searchPlaceholder}
        triggerClassName="text-[12.5px]"
        triggerAriaLabelledBy={idRef.current}
        compact
      />
    </div>
  );
}
