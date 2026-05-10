import * as React from "react";
import {
  MultiSelectCombobox,
  type MultiSelectOption,
} from "@/components/ui/multi-select-combobox";
import { useThemeAccent } from "@/components/layout/theme-accent";
import type { Project } from "@/lib/dataverse/entities";
import type { ProjectFilterState } from "@/lib/filters/projectFilters";

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
    <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
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

/** Compact wrapper that renders a small uppercase label above the
 *  combobox trigger so the user can tell at a glance which filter
 *  each chip controls without opening it. */
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
  return (
    <div className="flex flex-col gap-0.5 min-w-[140px] max-w-[200px]">
      <span className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground/80 px-0.5">
        {label}
      </span>
      <MultiSelectCombobox
        options={options}
        selected={selected}
        onChange={onChange}
        accent={accent}
        placeholder="Hepsi"
        searchPlaceholder={searchPlaceholder}
        triggerClassName="h-8 text-[12px]"
      />
    </div>
  );
}
