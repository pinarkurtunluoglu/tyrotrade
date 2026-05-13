import * as React from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Layers, ChevronLeft } from "lucide-react";
import { useProjects } from "@/hooks/useProjects";
import { ProjectList } from "@/components/projects/ProjectList";
import { ProjectsEmptyState } from "@/components/projects/ProjectsEmptyState";
import { RouteMap } from "@/components/map/RouteMap";
import { ProjectOverviewCard } from "@/components/details/ProjectOverviewCard";
import { CommoditySalesCard } from "@/components/details/CommoditySalesCard";
// `ExpectedRealizedExpenseCard` temporarily unmounted — kept in
// `src/components/details/` for the next iteration. Re-import here
// when the per-project expense math is verified end-to-end.
import { BudgetSalesCard } from "@/components/details/BudgetSalesCard";
import { BudgetPLCard } from "@/components/details/BudgetPLCard";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { AdvancedFilter } from "@/components/filters/AdvancedFilter";
import {
  applyProjectFilter,
  makeEmptyFilters,
  type ProjectFilterState,
} from "@/lib/filters/projectFilters";
import { cn } from "@/lib/utils";

type MobileView = "list" | "map" | "details";

// Vessel Projects default = ship-plan-only (operationally-scoped).
// Dashboard uses the opposite default.
const PROJECTS_SHIP_PLAN_DEFAULT = false;

export function ProjectsPage() {
  const { projectId } = useParams<{ projectId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const { projects: rawProjects, isEmpty } = useProjects();
  const now = new Date();

  // Filter state lifted from ProjectList so the AdvancedFilter (rendered
  // inside ProjectList's header) can still drive a unified state shape
  // shared with Dashboard / Veri Yönetimi. The page-level layout is
  // unchanged — the trigger sits next to the search input as before.
  const [filters, setFilters] = React.useState<ProjectFilterState>(() =>
    makeEmptyFilters({ includeWithoutShipPlan: PROJECTS_SHIP_PLAN_DEFAULT })
  );

  // Deep-link from the dashboard KPI drawer (or any other page) — when
  // we land here with `state.focusProjectNo`, swap the filter into a
  // single-project view so the list only shows that one row. The state
  // is consumed once and then wiped via `window.history.replaceState`
  // so a casual re-render doesn't re-apply the filter; the user can
  // clear the projectNos chip from the popover at any time.
  React.useEffect(() => {
    const focusNo = (location.state as { focusProjectNo?: string } | null)
      ?.focusProjectNo;
    if (!focusNo) return;
    setFilters((f) => ({ ...f, projectNos: new Set([focusNo]) }));
    // Drop the navigation state so a back-button round trip / hot reload
    // doesn't re-trigger this effect. `replaceState` preserves the URL
    // (including the hash for HashRouter) and clears the state slot.
    window.history.replaceState({}, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const projects = React.useMemo(
    () => applyProjectFilter(rawProjects, filters, now),
    // `now` recomputes per render but is string-equal stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rawProjects, filters]
  );

  const initialId = projectId ?? projects[0]?.projectNo ?? null;
  const [selectedId, setSelectedId] = React.useState<string | null>(initialId);

  React.useEffect(() => {
    if (projectId && projectId !== selectedId) {
      setSelectedId(projectId);
    }
  }, [projectId, selectedId]);

  // When the projects array first arrives (cache hydration after mount), pick
  // the first project as the default selection so the right-rail isn't empty.
  // Also push the selection into the URL so TopBar's useMatch resolves it and
  // chat context is available immediately on first visit.
  React.useEffect(() => {
    if (!selectedId && projects.length > 0) {
      const firstId = projects[0].projectNo;
      setSelectedId(firstId);
      navigate(`/projects/${firstId}`, { replace: true });
    }
  }, [projects, selectedId, navigate]);

  // Sync initial selection into URL when projects were already loaded on mount
  // (e.g. mock mode) — useState initialiser sets selectedId but URL stays at
  // /projects, so useMatch in TopBar never fires.
  const didSyncUrl = React.useRef(false);
  React.useEffect(() => {
    if (!didSyncUrl.current) {
      didSyncUrl.current = true;
      if (!projectId && selectedId) {
        navigate(`/projects/${selectedId}`, { replace: true });
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [mobileView, setMobileView] = React.useState<MobileView>("list");

  if (isEmpty) {
    return <ProjectsEmptyState />;
  }

  // Look the selected project up in the UNFILTERED rawProjects so the
  // right panel + map keep working when the user lands here via an
  // EventsPanel / NotificationButton click — the deep-linked project
  // might be outside the current filter scope (different FY, different
  // status), and we don't want a blank right rail when the URL
  // explicitly asked for that project.
  const selected =
    rawProjects.find((p) => p.projectNo === selectedId) ?? null;

  const handleSelect = (id: string) => {
    setSelectedId(id);
    navigate(`/projects/${id}`, { replace: true });
    if (isMobile) setMobileView("details");
  };

  // Filter trigger node — passed as a slot into ProjectList so it
  // renders in the list header next to the search input. Icon-only
  // trigger keeps the list header tight; the popover surface is the
  // same as Dashboard / Veri Yönetimi.
  const filterTrigger = (
    <AdvancedFilter
      projects={rawProjects}
      filters={filters}
      onChange={setFilters}
      shipPlanDefault={PROJECTS_SHIP_PLAN_DEFAULT}
      resultCount={projects.length}
      totalCount={rawProjects.length}
      iconOnly
    />
  );

  if (isMobile) {
    return (
      <div className="h-full flex flex-col gap-2">
        <MobileTabs view={mobileView} setView={setMobileView} hasSelection={!!selected} />
        <div className="flex-1 overflow-hidden">
          {mobileView === "list" && (
            <ProjectList
              projects={projects}
              totalCount={rawProjects.length}
              selectedId={selectedId}
              onSelect={handleSelect}
              filterTrigger={filterTrigger}
            />
          )}
          {mobileView === "map" && (
            <div className="h-full flex flex-col gap-2">
              {selected && (
                <Button
                  variant="glass"
                  size="sm"
                  onClick={() => setMobileView("list")}
                  className="self-start"
                >
                  <ChevronLeft className="size-3.5" />
                  Projelere dön
                </Button>
              )}
              <div className="flex-1">
                <RouteMap project={selected} />
              </div>
            </div>
          )}
          {mobileView === "details" && selected && (
            <ScrollArea className="h-full">
              <div className="space-y-3 pb-4">
                <ProjectOverviewCard project={selected} />
                <CommoditySalesCard project={selected} />
                <BudgetSalesCard project={selected} />
                <BudgetPLCard project={selected} />
              </div>
            </ScrollArea>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full grid grid-cols-[224px_minmax(0,1fr)_320px] xl:grid-cols-[260px_minmax(0,1fr)_360px] 2xl:grid-cols-[296px_minmax(0,1fr)_400px] gap-3">
      <div className="min-h-0 min-w-0 overflow-hidden">
        <ProjectList
          projects={projects}
          totalCount={rawProjects.length}
          selectedId={selectedId}
          onSelect={handleSelect}
          filterTrigger={filterTrigger}
        />
      </div>

      <div className="min-h-0 min-w-0 overflow-hidden">
        <RouteMap project={selected} />
      </div>

      <div className="min-h-0 min-w-0 overflow-hidden">
        {selected ? (
          <ScrollArea className="h-full pr-1">
            <div className="space-y-3">
              <ProjectOverviewCard project={selected} />
              <CommoditySalesCard project={selected} />
              <BudgetSalesCard project={selected} />
              <BudgetPLCard project={selected} />
            </div>
          </ScrollArea>
        ) : (
          <div className="h-full grid place-items-center text-muted-foreground text-sm">
            Detay için bir proje seçin
          </div>
        )}
      </div>
    </div>
  );
}

function MobileTabs({
  view,
  setView,
  hasSelection,
}: {
  view: MobileView;
  setView: (v: MobileView) => void;
  hasSelection: boolean;
}) {
  const items: Array<{ key: MobileView; label: string }> = [
    { key: "list", label: "Liste" },
    { key: "map", label: "Harita" },
    { key: "details", label: "Detay" },
  ];
  return (
    <div className="glass rounded-2xl p-1 flex items-center gap-1">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          onClick={() => setView(it.key)}
          disabled={it.key !== "list" && !hasSelection}
          className={cn(
            "flex-1 px-3 py-1.5 rounded-xl text-xs font-medium transition-all relative z-[3]",
            view === it.key
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground disabled:opacity-40 hover:text-foreground"
          )}
        >
          {it.key === "map" && <Layers className="inline size-3 mr-1" />}
          {it.label}
        </button>
      ))}
    </div>
  );
}
