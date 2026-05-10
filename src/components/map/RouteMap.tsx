import * as React from "react";
import {
  Map,
  Source,
  Layer,
  Marker,
  AttributionControl,
  type MapRef,
} from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  Anchor,
  MapPin,
  Ship as ShipIcon,
  Compass,
  Plus,
  Minus,
  Crosshair,
  CalendarClock,
  X,
  Check,
  Clock,
  ArrowDownToLine,
  ArrowUpFromLine,
  Hourglass,
  CircleCheck,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import lineSliceAlong from "@turf/line-slice-along";
import along from "@turf/along";
import bearing from "@turf/bearing";
import { point } from "@turf/helpers";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUp01Icon, ArrowDown01Icon } from "@hugeicons/core-free-icons";
import type { Feature, LineString, Position } from "geojson";

import { GlassPanel } from "@/components/glass/GlassPanel";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DEFAULT_STYLE } from "@/lib/map/style";
import { useRouteGeometry } from "@/hooks/useRouteGeometry";
import { useRouteProgress } from "@/hooks/useRouteProgress";
import { formatDate } from "@/lib/format";
import type { Project } from "@/lib/dataverse/entities";
import { useThemeAccent } from "@/components/layout/theme-accent";

interface RouteMapProps {
  project: Project | null;
}

const STAGE_LABEL: Record<string, string> = {
  "pre-loading": "Yüklemeye hazır",
  "at-loading-port": "Yükleme limanında",
  loading: "Yükleme yapılıyor",
  "in-transit": "Yolda",
  "at-discharge-port": "Varış limanında",
  discharged: "Tahliye tamamlandı",
};

/** Stage chip palette — semantic but minimal. Soft tinted bg + colored
 *  text + thin border so it reads as a status hint, not a CTA. Fixed,
 *  NOT theme-aware (voyage state isn't a brand concept). */
const STAGE_TONE: Record<string, { bg: string; text: string; border: string }> = {
  "pre-loading": {
    bg: "rgba(100, 116, 139, 0.10)",
    text: "#475569",
    border: "rgba(100, 116, 139, 0.30)",
  },
  "at-loading-port": {
    bg: "rgba(217, 119, 6, 0.10)",
    text: "#b45309",
    border: "rgba(217, 119, 6, 0.30)",
  },
  loading: {
    bg: "rgba(234, 88, 12, 0.10)",
    text: "#9a3412",
    border: "rgba(234, 88, 12, 0.30)",
  },
  "in-transit": {
    bg: "rgba(2, 132, 199, 0.10)",
    text: "#075985",
    border: "rgba(2, 132, 199, 0.30)",
  },
  "at-discharge-port": {
    bg: "rgba(16, 185, 129, 0.10)",
    text: "#047857",
    border: "rgba(16, 185, 129, 0.30)",
  },
  discharged: {
    bg: "rgba(5, 150, 105, 0.10)",
    text: "#065f46",
    border: "rgba(5, 150, 105, 0.35)",
  },
};
const FALLBACK_STAGE_TONE = STAGE_TONE["in-transit"];

/** Stage-specific glyph for the status chip. Picks the icon that
 *  best signals the voyage's current operational mode at a glance:
 *
 *    pre-loading / at-loading-port → Anchor (sitting in port)
 *    loading                       → ArrowDownToLine (cargo flowing in)
 *    in-transit                    → Ship (under way)
 *    at-discharge-port             → MapPin (arrived at destination)
 *    discharged                    → CircleCheck (voyage closed)
 *
 *  Falls back to Compass when the stage string is unknown — same
 *  neutral cue the topbar's "Rota Haritası" header uses. */
const STAGE_ICON: Record<string, LucideIcon> = {
  "pre-loading": Anchor,
  "at-loading-port": Anchor,
  loading: ArrowDownToLine,
  "in-transit": ShipIcon,
  "at-discharge-port": MapPin,
  discharged: CircleCheck,
};

export function RouteMap({ project }: RouteMapProps) {
  const mapRef = React.useRef<MapRef>(null);
  const [mapReady, setMapReady] = React.useState(false);
  // Timeline open by default — every project landing has the strip
  // visible. User can dismiss with the toggle (X icon when open),
  // and switching projects re-opens it so the new project's milestone
  // history is the first thing they see on the map.
  const [timelineOpen, setTimelineOpen] = React.useState(true);
  const accent = useThemeAccent();
  const geom = useRouteGeometry(project);
  const { progress, stage } = useRouteProgress(project);

  // Re-open timeline when project changes — fresh project, fresh
  // milestone view.
  React.useEffect(() => {
    setTimelineOpen(true);
  }, [project?.projectNo]);

  // Fit padding is asymmetric so the route never sits under the
  // floating overlays:
  //   - top: leaves room for the "Rota Haritası" status pill (top-left)
  //   - right: clears the zoom controls column (top-right)
  //   - left: clears the loading PortChip
  //   - bottom: depends on the timeline strip — when open it's
  //     PortChips (52) + toggle pill (44) + MilestoneStrip (~74) +
  //     gaps; when closed only the chip row.
  const fitToRoute = React.useCallback(
    (animate: boolean) => {
      const map = mapRef.current;
      if (!map || !geom) return;
      const [west, south, east, north] = geom.bbox;
      const bottomPad = timelineOpen ? 200 : 110;
      map.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        {
          padding: { top: 80, right: 80, bottom: bottomPad, left: 80 },
          duration: animate ? 900 : 0,
          maxZoom: 4.5,
        }
      );
    },
    [geom, timelineOpen]
  );

  React.useEffect(() => {
    if (!mapReady) return;
    fitToRoute(true);
  }, [mapReady, fitToRoute]);

  // Force the MapLibre attribution control into its collapsed (i)
  // state on mount — CSS overrides alone weren't enough because
  // newer maplibre versions pre-apply `maplibregl-compact-show` to
  // satisfy attribution-on-first-paint requirements. Strip the class
  // ourselves so the control reads as a single icon at rest;
  // attribution is still one click away (the user toggles the (i)).
  React.useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current?.getMap?.();
    if (!map) return;
    const container = map.getContainer();
    const attrib = container.querySelector<HTMLElement>(
      ".maplibregl-ctrl-attrib"
    );
    if (!attrib) return;
    attrib.classList.remove("maplibregl-compact-show");
    attrib.classList.add("maplibregl-compact");
  }, [mapReady]);

  const { completedLine, position, headingDeg } = React.useMemo(() => {
    if (!geom) {
      return { completedLine: null, position: null as Position | null, headingDeg: 0 };
    }
    const { line, totalKm } = geom;
    const km = Math.max(0.001, totalKm * Math.max(0.0001, Math.min(0.9999, progress)));
    const completed: Feature<LineString> | null =
      progress > 0
        ? (lineSliceAlong(line, 0, km, { units: "kilometers" }) as Feature<LineString>)
        : null;
    const position = geom.positionAt(progress);
    let headingDeg = 0;
    if (completed && completed.geometry.coordinates.length >= 2) {
      const coords = completed.geometry.coordinates;
      const last = coords[coords.length - 1];
      const prev = coords[coords.length - 2];
      headingDeg = bearing(point(prev), point(last));
    } else if (line.geometry.coordinates.length >= 2) {
      const coords = line.geometry.coordinates;
      headingDeg = bearing(point(coords[0]), point(coords[1]));
    }
    return { completedLine: completed, position, headingDeg };
  }, [geom, progress]);

  /**
   * Direction arrows placed at evenly-spaced intervals along the
   * route, rotated to follow the local direction of travel. Arrows
   * before the vessel's `progress` use the active theme accent
   * (bright); arrows after stay muted. Skips the 8% nearest each
   * port so they don't collide with the pins / vessel marker.
   *
   * Bearing is sampled from a centred backward+forward pair so the
   * tangent stays accurate on tight great-circle curves (single
   * forward step drifted off-line on long ocean legs).
   */
  const chevrons = React.useMemo(() => {
    if (!geom) return [] as Array<{
      lon: number;
      lat: number;
      bearingDeg: number;
      done: boolean;
    }>;
    const { line, totalKm } = geom;
    const COUNT = 6;
    const out: Array<{
      lon: number;
      lat: number;
      bearingDeg: number;
      done: boolean;
    }> = [];
    for (let i = 0; i < COUNT; i++) {
      const t = 0.08 + (i / (COUNT - 1)) * 0.84;
      const km = totalKm * t;
      const here = along(line, km, { units: "kilometers" }).geometry
        .coordinates as [number, number];
      // Centred bearing — sample equally before and after, average via
      // a vector from `back` to `ahead`. Stays on the rendered
      // polyline even on curved sea-route great circles.
      const halfStep = Math.max(0.5, totalKm * 0.005);
      const ahead = along(
        line,
        Math.min(totalKm, km + halfStep),
        { units: "kilometers" }
      ).geometry.coordinates as [number, number];
      const back = along(
        line,
        Math.max(0, km - halfStep),
        { units: "kilometers" }
      ).geometry.coordinates as [number, number];
      out.push({
        lon: here[0],
        lat: here[1],
        bearingDeg: bearing(point(back), point(ahead)),
        done: t < progress,
      });
    }
    return out;
  }, [geom, progress]);

  const lp = project?.vesselPlan?.loadingPort;
  const dp = project?.vesselPlan?.dischargePort;
  const ms = project?.vesselPlan?.milestones;

  return (
    <TooltipProvider delayDuration={200} disableHoverableContent>
      <div className="relative h-full rounded-3xl overflow-hidden glass">
        <div className="absolute inset-0 z-[1]">
          {project && geom ? (
            <Map
              ref={mapRef}
              mapStyle={DEFAULT_STYLE}
              initialViewState={{
                longitude: (geom.bbox[0] + geom.bbox[2]) / 2,
                latitude: (geom.bbox[1] + geom.bbox[3]) / 2,
                zoom: 2,
              }}
              attributionControl={false}
              cooperativeGestures={false}
              onLoad={() => setMapReady(true)}
            >
              <Source id="route-full" type="geojson" data={geom.line}>
                <Layer
                  id="route-remaining-glow"
                  type="line"
                  paint={{
                    "line-color": "rgba(80, 95, 130, 0.35)",
                    "line-width": 7,
                    "line-blur": 6,
                  }}
                />
                <Layer
                  id="route-remaining"
                  type="line"
                  paint={{
                    "line-color": "#3f4a64",
                    "line-width": 2.5,
                    "line-dasharray": [1.6, 2],
                    "line-opacity": 0.9,
                  }}
                />
              </Source>

              {completedLine && (
                <Source id="route-completed" type="geojson" data={completedLine}>
                  <Layer
                    id="route-completed-glow"
                    type="line"
                    paint={{
                      "line-color": "rgba(42, 79, 127, 0.45)",
                      "line-width": 9,
                      "line-blur": 6,
                    }}
                  />
                  <Layer
                    id="route-completed-line"
                    type="line"
                    paint={{
                      "line-color": "#2a4f7f",
                      "line-width": 3.2,
                      "line-opacity": 1,
                    }}
                  />
                </Source>
              )}

              {lp && ms && (
                <Marker longitude={lp.lon} latitude={lp.lat} anchor="center">
                  <div title={`${lp.name} · ${lp.country}\nLP-ETA: ${formatDate(ms.lpEta)}`}>
                    <PortPin kind="loading" />
                  </div>
                </Marker>
              )}

              {dp && ms && (
                <Marker longitude={dp.lon} latitude={dp.lat} anchor="center">
                  <div title={`${dp.name} · ${dp.country}\nDP-ETA: ${formatDate(ms.dpEta)}`}>
                    <PortPin kind="discharge" />
                  </div>
                </Marker>
              )}

              {/* Direction chevrons along the route — convey LP→DP
                  flow at a glance. Rendered before the vessel so the
                  vessel marker stays on top. */}
              {chevrons.map((c, i) => (
                <Marker
                  key={`chev-${i}`}
                  longitude={c.lon}
                  latitude={c.lat}
                  anchor="center"
                >
                  <DirectionChevron
                    bearingDeg={c.bearingDeg}
                    done={c.done}
                  />
                </Marker>
              ))}

              {position && progress > 0.02 && progress < 0.98 && project && (
                <Marker
                  longitude={position[0]}
                  latitude={position[1]}
                  anchor="center"
                >
                  <div
                    title={`${project.vesselPlan!.vesselName} · ${
                      STAGE_LABEL[stage] ?? stage
                    } · %${(progress * 100).toFixed(0)}`}
                  >
                    <VesselMarker heading={headingDeg} accent={accent} />
                  </div>
                </Marker>
              )}

              {/* Attribution must stay (Carto + OSM licence). Forced
                  collapsed-(i) state via the useEffect above + the
                  globals.css override; we anchor it flush to the
                  bottom-right corner so the (i) icon sits in dead
                  space below the discharge PortChip — no overlap with
                  the chip row or the timeline strip. */}
              <AttributionControl
                compact
                position="bottom-right"
                style={{
                  marginRight: 4,
                  marginBottom: 4,
                }}
              />
            </Map>
          ) : (
            <EmptyState
              kind={
                !project
                  ? "no-selection"
                  : !project.vesselPlan
                    ? "no-vessel-plan"
                    : "no-route"
              }
              projectNo={project?.projectNo}
            />
          )}
        </div>

        <div className="absolute top-3 left-3 z-[3] pointer-events-none">
          <GlassPanel
            tone="strong"
            className="rounded-xl pointer-events-auto"
            style={{
              boxShadow: `0 6px 18px -4px ${accent.ring}, inset 0 1px 0 0 rgba(255,255,255,0.55)`,
            }}
          >
            <div className="px-3 py-2 flex items-center gap-2">
              <Compass
                className="size-3.5"
                style={{ color: accent.solid }}
                strokeWidth={2.5}
              />
              <span className="text-[13px] font-semibold tracking-tight">
                Rota Haritası
              </span>
              {project &&
                (() => {
                  const stageTone = STAGE_TONE[stage] ?? FALLBACK_STAGE_TONE;
                  // Compass is the neutral fallback — it's already the
                  // header glyph next to "Rota Haritası", so an unknown
                  // stage just degrades to the same cue rather than
                  // forcing an arbitrary mismatched icon.
                  const StageIcon = STAGE_ICON[stage] ?? Compass;
                  return (
                    <span
                      className="ml-1 inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium tracking-tight"
                      style={{
                        backgroundColor: stageTone.bg,
                        color: stageTone.text,
                        boxShadow: `inset 0 0 0 1px ${stageTone.border}`,
                      }}
                    >
                      <StageIcon
                        className="size-2.5 mr-1"
                        strokeWidth={2.5}
                      />
                      {STAGE_LABEL[stage] ?? stage} · %
                      {(progress * 100).toFixed(0)}
                    </span>
                  );
                })()}
              {project && <DurationPills project={project} />}
            </div>
          </GlassPanel>
        </div>

        {project && (
          <div className="absolute top-3 right-3 z-[3] flex flex-col gap-2 pointer-events-none">
            <GlassPanel tone="strong" className="rounded-xl pointer-events-auto">
              <div className="flex flex-col p-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => mapRef.current?.zoomIn({ duration: 250 })}
                      aria-label="Yakınlaştır"
                    >
                      <Plus className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="left">Yakınlaştır</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => mapRef.current?.zoomOut({ duration: 250 })}
                      aria-label="Uzaklaştır"
                    >
                      <Minus className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="left">Uzaklaştır</TooltipContent>
                </Tooltip>
                <div className="h-px bg-border my-0.5" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => fitToRoute(true)}
                      aria-label="Rotaya odakla"
                    >
                      <Crosshair className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="left">Rotaya odakla</TooltipContent>
                </Tooltip>
              </div>
            </GlassPanel>
          </div>
        )}

        {project?.vesselPlan && (
          <div className="absolute bottom-3 left-3 right-3 z-[3] flex flex-col gap-2 pointer-events-none">
            {timelineOpen && (
              <MilestoneStrip
                ms={project.vesselPlan.milestones}
                progress={progress}
                onClose={() => setTimelineOpen(false)}
              />
            )}
            <div className="flex items-stretch gap-2">
              <PortChip
                kind="loading"
                name={project.vesselPlan.loadingPort.name}
                country={project.vesselPlan.loadingPort.country}
                date={project.vesselPlan.milestones.lpEta}
                dateLabel="LP-ETA"
              />
              <button
                type="button"
                onClick={() => setTimelineOpen((v) => !v)}
                aria-label={
                  timelineOpen ? "Milestone zaman çizgisini kapat" : "Milestone zaman çizgisini aç"
                }
                className={cn(
                  "pointer-events-auto shrink-0 self-center size-11 rounded-full grid place-items-center transition-all",
                  "text-white shadow-lg ring-2 ring-white/80 backdrop-blur-sm",
                  "hover:scale-110 active:scale-95"
                )}
                style={{
                  background: accent.gradient,
                  boxShadow: timelineOpen
                    ? `0 0 0 4px ${accent.ring}, 0 8px 20px -6px ${accent.ring}`
                    : `0 8px 20px -6px ${accent.ring}, inset 0 1px 0 0 rgba(255,255,255,0.2)`,
                }}
              >
                {timelineOpen ? (
                  // Arrow-down on open = "tuck the strip away". More
                  // natural than an X close glyph for a panel that's
                  // always available — it's collapsing, not dismissing.
                  // HugeIcons ArrowDown01 mirrors the ArrowUp01 used on
                  // the symmetric "open" affordance elsewhere on the map.
                  <HugeiconsIcon
                    icon={ArrowDown01Icon}
                    size={16}
                    strokeWidth={2}
                  />
                ) : (
                  // CalendarClock = "open timeline". Reads as a date /
                  // schedule trigger, which is exactly what the strip
                  // shows (LP-ETA → DP-ED milestone dates).
                  <CalendarClock className="size-4" />
                )}
              </button>
              {(() => {
                // Show the most-recent populated DP milestone instead
                // of always pinning the chip to DP-ETA — once the
                // vessel reaches the discharge port the chip should
                // advance to DP-NOR / DP-SD / DP-ED.
                const dp = pickLatestDpMilestone(
                  project.vesselPlan.milestones
                );
                return (
                  <PortChip
                    kind="discharge"
                    name={project.vesselPlan.dischargePort.name}
                    country={project.vesselPlan.dischargePort.country}
                    date={dp.date}
                    dateLabel={dp.label}
                  />
                );
              })()}
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

/* ─────────── Duration pills (Yükleme + Tahliye + Transit + Operasyon) ─────────── */

/** Calendar-day count strictly BETWEEN two ISO date strings — excludes
 *  both the start and the end day from the result. Used for the
 *  "Operasyon" pill: the voyage's first milestone (LP-ETA) and last
 *  milestone (DP-ED) are NOT counted as operation days; only the
 *  full days strictly in between are. Returns 0 for adjacent or
 *  same-day pairs and null when either side is missing.
 *
 * Examples:
 *   2026-01-01 → 2026-01-10 → 8  (days 2-9 inclusive)
 *   2026-01-01 → 2026-01-02 → 0  (no full day in between)
 *   2026-01-01 → 2026-01-01 → 0  (clamped, never negative) */
function daysBetweenExclusive(
  startIso: string | null | undefined,
  endIso: string | null | undefined
): number | null {
  if (!startIso || !endIso) return null;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const span = Math.round((end - start) / 86_400_000);
  return Math.max(0, span - 1);
}

/** Operasyon Süresi — full-day count between LP-ETA and DP-ED on the
 *  voyage timeline, exclusive of both endpoints (per user spec). The
 *  start and end milestones themselves don't count as operation
 *  days, only what's strictly in between. */
function operationDays(p: Project): number | null {
  const ms = p.vesselPlan?.milestones;
  if (!ms) return null;
  return daysBetweenExclusive(ms.lpEta, ms.dpEd);
}

/** Pill colour palette per metric — four distinct chromatic
 *  families so no two pills sit in the same hue territory.
 *
 *   Yükleme   → amber  (warm yellow-orange)
 *   Transit   → sky    (cool light blue)
 *   Tahliye   → rose   (warm pink-red)
 *   Operasyon → indigo (cool deep blue-purple — keeps the
 *                       original "summary" colour) */
const PILL_TONES = {
  loading: {
    bg: "rgba(245,158,11,0.13)",
    ring: "rgba(245,158,11,0.34)",
    label: "rgb(180 83 9 / 0.85)", // amber-700 @ 85
    value: "rgb(120 53 15)", // amber-900
  },
  discharge: {
    bg: "rgba(244,63,94,0.13)",
    ring: "rgba(244,63,94,0.34)",
    label: "rgb(159 18 57 / 0.85)", // rose-700 @ 85
    value: "rgb(136 19 55)", // rose-900
  },
  transit: {
    bg: "rgba(56,189,248,0.14)",
    ring: "rgba(56,189,248,0.35)",
    label: "rgb(2 132 199 / 0.85)", // sky-700 @ 85
    value: "rgb(12 74 110)", // sky-900
  },
  operation: {
    bg: "rgba(99,102,241,0.13)",
    ring: "rgba(99,102,241,0.32)",
    label: "rgb(67 56 202 / 0.85)", // indigo-700 @ 85
    value: "rgb(49 46 129)", // indigo-900
  },
} as const;

/** Compact day-count pill shared by all four metrics. Renders only
 *  when `value` is a finite number — null collapses to nothing. The
 *  leading `Icon` is metric-specific (caller decides) so the four
 *  pills can be told apart at a glance even before the eye reaches
 *  the label text. */
function DurationPill({
  value,
  label,
  tone,
  title,
  Icon,
}: {
  value: number | null;
  label: string;
  tone: (typeof PILL_TONES)[keyof typeof PILL_TONES];
  title: string;
  Icon: LucideIcon;
}) {
  if (value == null) return null;
  return (
    <span
      className="ml-1 inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium tracking-tight"
      style={{
        backgroundColor: tone.bg,
        boxShadow: `inset 0 0 0 1px ${tone.ring}`,
      }}
      title={title}
    >
      <Icon
        className="size-2.5 mr-1"
        strokeWidth={2.5}
        style={{ color: tone.label }}
      />
      <span
        className="uppercase tracking-wider"
        style={{ color: tone.label }}
      >
        {label}
      </span>
      <span aria-hidden className="mx-1" style={{ color: tone.label, opacity: 0.4 }}>
        ·
      </span>
      <span
        className="font-semibold tabular-nums"
        style={{ color: tone.value }}
      >
        {value}g
      </span>
    </span>
  );
}

/** Four duration pills shown next to the stage chip in the map
 *  header — chronological voyage order (load → sail → discharge →
 *  total operation):
 *
 *    Yükleme   ← `mserp_loadingtime`
 *    Transit   ← `mserp_transfertime`     (between load + discharge)
 *    Tahliye   ← `mserp_evacuationtime`
 *    Operasyon ← derived: full days between LP-ETA and DP-ED
 *                 (endpoints excluded; milestone days don't count
 *                 against the operation span).
 *
 *  Each pill self-hides when its source value is missing/zero, so
 *  voyages with partial data still render whatever's available. */
function DurationPills({ project }: { project: Project }) {
  const vp = project.vesselPlan;
  const loading = vp?.loadingDays ?? null;
  const transit = vp?.transferDays ?? null;
  const discharge = vp?.evacuationDays ?? null;
  const operation = operationDays(project);
  if (
    loading == null &&
    transit == null &&
    discharge == null &&
    operation == null
  ) {
    return null;
  }
  return (
    <>
      {/* Yükleme = cargo flowing INTO the vessel — down-arrow.
          Transit = under way — Ship.
          Tahliye = cargo flowing OUT of the vessel — up-arrow.
          Operasyon = total elapsed time — Hourglass (the only
                     one that's a duration metric vs. a verb). */}
      <DurationPill
        value={loading}
        label="Yükleme"
        tone={PILL_TONES.loading}
        Icon={ArrowDownToLine}
        title={`Yükleme Süresi: ${loading} gün (mserp_loadingtime)`}
      />
      <DurationPill
        value={transit}
        label="Transit"
        tone={PILL_TONES.transit}
        Icon={ShipIcon}
        title={`Transit Süresi: ${transit} gün (mserp_transfertime)`}
      />
      <DurationPill
        value={discharge}
        label="Tahliye"
        tone={PILL_TONES.discharge}
        Icon={ArrowUpFromLine}
        title={`Tahliye Süresi: ${discharge} gün (mserp_evacuationtime)`}
      />
      <DurationPill
        value={operation}
        label="Operasyon"
        tone={PILL_TONES.operation}
        Icon={Hourglass}
        title={
          operation != null
            ? `Operasyon Süresi: ${operation} gün (LP-ETA → DP-ED, başlangıç/bitiş günleri hariç)`
            : ""
        }
      />
    </>
  );
}

function EmptyState({
  kind,
  projectNo,
}: {
  kind: "no-selection" | "no-vessel-plan" | "no-route";
  projectNo?: string;
}) {
  const message =
    kind === "no-selection"
      ? "Bir proje seçin"
      : kind === "no-vessel-plan"
        ? "Bu projede gemi planı yok"
        : "Rota verisi eksik";
  const sublabel =
    kind === "no-vessel-plan"
      ? "Dataverse'de bu proje için bir Gemi Planı kaydı bulunamadı"
      : kind === "no-route"
        ? "Liman koordinatları eksik — port dictionary'e eklenmesi gerekebilir"
        : null;
  return (
    <div className="h-full grid place-items-center text-muted-foreground">
      <div className="text-center px-6 max-w-sm">
        <Compass className="size-10 mx-auto mb-2 opacity-50" />
        <p className="text-sm font-medium">{message}</p>
        {sublabel && (
          <p className="text-[11px] text-muted-foreground/80 mt-1.5 leading-relaxed">
            {sublabel}
          </p>
        )}
        {projectNo && (
          <p className="text-[10px] font-mono text-muted-foreground/60 mt-2">
            {projectNo}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Tiny chevron arrow placed along the route to convey LP→DP direction
 * at a glance. Rotated so the tip points along the local route
 * tangent. Bright sky-blue when on the completed segment, dim white
 * when still ahead of the vessel.
 *
 *  - `bearingDeg` is in compass degrees (0=N, 90=E…). We translate to
 *    SVG rotation by subtracting 90° so a default east-pointing
 *    chevron lines up with bearing=90.
 *  - `pointer-events: none` so chevrons don't steal hover from the
 *    underlying line / port pins.
 */
function DirectionChevron({
  bearingDeg,
  done,
}: {
  bearingDeg: number;
  done: boolean;
}) {
  // HugeIcons ArrowUp01Icon points up by default; we add 180° to make
  // it point along the bearing (icon "down" → travel direction).
  // Active arrows show in deep navy; pending arrows fade.
  return (
    <div
      className="pointer-events-none"
      style={{
        transform: `rotate(${bearingDeg}deg)`,
        transformOrigin: "center",
        filter: done
          ? "drop-shadow(0 0 5px rgba(56,189,248,0.55)) drop-shadow(0 0 1px rgba(255,255,255,0.7))"
          : "drop-shadow(0 0 2px rgba(255,255,255,0.45))",
        color: done ? "#1e3a8a" : "rgba(71,85,105,0.7)",
      }}
    >
      <HugeiconsIcon
        icon={ArrowUp01Icon}
        size={done ? 16 : 14}
        strokeWidth={done ? 3 : 2.4}
      />
    </div>
  );
}

function PortPin({ kind }: { kind: "loading" | "discharge" }) {
  const Icon = kind === "loading" ? Anchor : MapPin;
  const colorClass =
    kind === "loading"
      ? "bg-amber-500 border-amber-300"
      : "bg-emerald-500 border-emerald-300";
  return (
    <div className="relative">
      <span
        className={`absolute inset-0 -m-2 rounded-full ${
          kind === "loading" ? "bg-amber-500/25" : "bg-emerald-500/25"
        } animate-ping`}
        aria-hidden
      />
      <div
        className={`relative size-7 rounded-full ${colorClass} grid place-items-center text-white border-2 shadow-md`}
      >
        <Icon className="size-3.5" />
      </div>
    </div>
  );
}

function VesselMarker({
  heading,
  accent,
}: {
  heading: number;
  accent: ReturnType<typeof useThemeAccent>;
}) {
  return (
    <div className="relative" style={{ transform: "translate(-50%, -50%)" }}>
      {/* Pulsing halo — uses the live sidebar accent ring for the glow. */}
      <span
        className="absolute inset-0 -m-3 rounded-full blur-md animate-pulse"
        style={{ backgroundColor: accent.ring }}
      />
      <div
        className="relative size-9 rounded-full grid place-items-center text-white shadow-lg"
        style={{
          background: accent.gradient,
          boxShadow: `0 0 0 2px ${accent.ringStrong}, 0 6px 14px -4px ${accent.ring}, inset 0 1px 0 0 rgba(255,255,255,0.18)`,
          transform: `rotate(${heading}deg)`,
        }}
      >
        <ShipIcon
          className="size-4"
          style={{ transform: `rotate(${-heading}deg)` }}
        />
      </div>
    </div>
  );
}

/** Pick the most recent populated discharge-port milestone for the
 *  varış-limanı chip. Once the vessel passes a stage we want the chip
 *  to reflect that — DP-ETA only stays visible while the voyage is
 *  still en route. Priority chain (most recent first):
 *    DP-ED > DP-SD > DP-NOR > DP-ETA.
 *  When all are null we still fall back to DP-ETA's slot (label +
 *  null date) so the layout doesn't shift. */
function pickLatestDpMilestone(
  ms: NonNullable<Project["vesselPlan"]>["milestones"]
): { date: string | null; label: string } {
  if (ms.dpEd) return { date: ms.dpEd, label: "DP-ED" };
  if (ms.dpSd) return { date: ms.dpSd, label: "DP-SD" };
  if (ms.dpNorAccepted) return { date: ms.dpNorAccepted, label: "DP-NOR" };
  return { date: ms.dpEta, label: "DP-ETA" };
}

function PortChip({
  kind,
  name,
  country,
  date,
  dateLabel,
}: {
  kind: "loading" | "discharge";
  name: string;
  country: string;
  date: string | null;
  dateLabel: string;
}) {
  const Icon = kind === "loading" ? Anchor : MapPin;
  const tone = kind === "loading" ? "text-amber-700" : "text-emerald-700";
  const bg = kind === "loading" ? "bg-amber-500/15" : "bg-emerald-500/15";
  return (
    <GlassPanel tone="strong" className="rounded-2xl flex-1 min-w-0 pointer-events-auto">
      <div className="px-3 py-2.5 flex items-center gap-2.5">
        <div className={`size-9 rounded-xl ${bg} ${tone} grid place-items-center shrink-0`}>
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {kind === "loading" ? "Kalkış Limanı" : "Varış Limanı"}
          </div>
          <div className="text-sm font-semibold truncate">{name}</div>
          <div className="text-[10px] text-muted-foreground truncate">{country}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {dateLabel}
          </div>
          <div className="text-xs font-medium">{formatDate(date)}</div>
        </div>
      </div>
    </GlassPanel>
  );
}

interface MilestoneStripProps {
  ms: Project["vesselPlan"] extends infer V
    ? V extends { milestones: infer M }
      ? M
      : never
    : never;
  progress: number;
  onClose: () => void;
}

function MilestoneStrip({ ms, progress, onClose }: MilestoneStripProps) {
  // Production-aligned 9-step voyage timeline. Order matches the D365
  // F&O screen (LP loading → BL → DP discharge) so the chip strip
  // reads the same as the source system.
  //
  // `tooltipTitle` + `tooltipBody` feed the Radix Tooltip that shows
  // when the user hovers on a step — abbreviations like "LP-ETA"
  // are operationally familiar but not self-explanatory, so each
  // chip explains itself in plain Turkish.
  const steps: Array<{
    key: string;
    label: string;
    date: string | null;
    tooltipTitle: string;
    tooltipBody: string;
  }> = [
    {
      key: "lpEta",
      label: "LP-ETA",
      date: ms.lpEta,
      tooltipTitle: "Yükleme Limanı — Tahmini Varış",
      tooltipBody:
        "Geminin yükleme limanına tahmini varış tarihi (Loading Port — Estimated Time of Arrival).",
    },
    {
      key: "lpNor",
      label: "LP-NOR",
      date: ms.lpNorAccepted,
      tooltipTitle: "Yükleme Limanı — NOR Kabul",
      tooltipBody:
        "Geminin yüklemeye hazır olduğunu bildiren Notice of Readiness'in liman tarafından kabul edildiği tarih.",
    },
    {
      key: "lpSd",
      label: "LP-SD",
      date: ms.lpSd,
      tooltipTitle: "Yükleme — Başlangıç",
      tooltipBody:
        "Yükleme operasyonunun fiilen başladığı tarih (Loading Start Date).",
    },
    {
      key: "lpEd",
      label: "LP-ED",
      date: ms.lpEd,
      tooltipTitle: "Yükleme — Bitiş",
      tooltipBody:
        "Yükleme operasyonunun tamamlandığı tarih (Loading End Date).",
    },
    {
      key: "bl",
      label: "BL",
      date: ms.blDate,
      tooltipTitle: "Bill of Lading",
      tooltipBody:
        "Konşimentonun (taşıma senedi) düzenlendiği tarih. Yükün gemiye teslim edildiğinin resmî kanıtı.",
    },
    {
      key: "dpEta",
      label: "DP-ETA",
      date: ms.dpEta,
      tooltipTitle: "Varış Limanı — Tahmini Varış",
      tooltipBody:
        "Geminin tahliye limanına tahmini varış tarihi (Discharge Port — Estimated Time of Arrival).",
    },
    {
      key: "dpNor",
      label: "DP-NOR",
      date: ms.dpNorAccepted,
      tooltipTitle: "Varış Limanı — NOR Kabul",
      tooltipBody:
        "Geminin tahliyeye hazır olduğunu bildiren Notice of Readiness'in liman tarafından kabul edildiği tarih.",
    },
    {
      key: "dpSd",
      label: "DP-SD",
      date: ms.dpSd,
      tooltipTitle: "Tahliye — Başlangıç",
      tooltipBody:
        "Tahliye operasyonunun fiilen başladığı tarih (Discharge Start Date).",
    },
    {
      key: "dpEd",
      label: "DP-ED",
      date: ms.dpEd,
      tooltipTitle: "Tahliye — Bitiş",
      tooltipBody:
        "Tahliye operasyonunun tamamlandığı tarih (Discharge End Date). Operasyon süresinin bitiş kotalı milestone'u.",
    },
  ];
  const completedCount = steps.filter((s) => s.date).length;
  const pct = Math.round(progress * 100);

  return (
    <GlassPanel
      tone="strong"
      className="rounded-2xl pointer-events-auto animate-in fade-in-0 slide-in-from-bottom-2 duration-300"
    >
      <div className="px-3 pt-2.5 pb-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Zaman Çizelgesi
            </span>
            <span className="text-[10px] font-semibold text-foreground/80 tabular-nums">
              {completedCount} / {steps.length}
            </span>
            <span className="text-[10px] text-muted-foreground">·</span>
            <span className="text-[10px] font-semibold text-emerald-700 tabular-nums">
              %{pct} yol alındı
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="size-3.5" />
          </button>
        </div>

        {/* Tooltip provider — local instance keeps the strip's
            tooltips independent from the marker tooltips above
            (markers use the native `title` attribute per CLAUDE.md
            because Radix portals collide with react-map-gl's
            <Marker> portal). The strip is a regular DOM child of
            the glass panel, so Radix works fine here. */}
        <TooltipProvider delayDuration={150}>
          <div className="flex items-stretch gap-1">
            {steps.map((s, i) => {
              const done = !!s.date;
              const nextDone = i < steps.length - 1 && !!steps[i + 1].date;
              const isCurrent = done && !nextDone;
              return (
                <Tooltip key={s.key}>
                  <TooltipTrigger asChild>
                    <div
                      className="flex-1 min-w-0 flex flex-col items-center gap-1.5 cursor-help focus:outline-none rounded-md focus-visible:ring-2 focus-visible:ring-ring"
                      tabIndex={0}
                      aria-label={`${s.label} — ${s.tooltipTitle}`}
                    >
                      <div className="relative w-full flex items-center">
                        <div
                          className={cn(
                            "h-1.5 flex-1 rounded-full transition-colors",
                            done
                              ? isCurrent
                                ? "bg-gradient-to-r from-emerald-500 to-emerald-400"
                                : "bg-emerald-500"
                              : "bg-muted"
                          )}
                        />
                        <div
                          className={cn(
                            "ml-1 size-4 shrink-0 rounded-full grid place-items-center transition-colors",
                            done
                              ? "bg-emerald-500 text-white"
                              : "bg-muted text-muted-foreground/60 border border-border"
                          )}
                        >
                          {done ? (
                            <Check className="size-2.5" strokeWidth={3} />
                          ) : (
                            <Clock className="size-2.5" strokeWidth={2.5} />
                          )}
                        </div>
                      </div>
                      <div className="text-center min-w-0 w-full">
                        <div
                          className={cn(
                            "text-[9px] font-semibold uppercase tracking-wider truncate",
                            done ? "text-foreground" : "text-muted-foreground"
                          )}
                        >
                          {s.label}
                        </div>
                        <div
                          className={cn(
                            "text-[9px] tabular-nums truncate",
                            done
                              ? "text-muted-foreground"
                              : "text-muted-foreground/60"
                          )}
                        >
                          {s.date ? formatDate(s.date) : "—"}
                        </div>
                      </div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    sideOffset={8}
                    className="max-w-[280px] px-3 py-2"
                  >
                    {/* Two-line tooltip: bold abbreviation + Turkish
                        title on top, full description below in a
                        muted tone. Date echoed at the bottom for
                        quick reference (so the user doesn't have to
                        re-read the chip). */}
                    <div className="flex items-center gap-1.5 text-[11.5px] font-semibold leading-tight">
                      <span className="font-mono text-[10.5px] text-muted-foreground/85 tracking-tight">
                        {s.label}
                      </span>
                      <span className="text-foreground">
                        · {s.tooltipTitle}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground leading-snug mt-1">
                      {s.tooltipBody}
                    </div>
                    <div className="text-[10.5px] tabular-nums text-foreground/80 mt-1.5 pt-1.5 border-t border-border/40">
                      {s.date
                        ? `Tarih: ${formatDate(s.date)}`
                        : "Tarih henüz girilmemiş"}
                    </div>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </TooltipProvider>
      </div>
    </GlassPanel>
  );
}
