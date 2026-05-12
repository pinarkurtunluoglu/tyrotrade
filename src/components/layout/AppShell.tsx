import * as React from "react";
import { Outlet, useLocation, useMatch } from "react-router-dom";
import { Menu, Ship, Database, Search, Settings } from "lucide-react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Home01Icon, HotPriceIcon } from "@hugeicons/core-free-icons";
import { GlassPanel } from "@/components/glass/GlassPanel";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { TyroChatButton } from "@/components/layout/TyroChatButton";
import { NotificationButton } from "@/components/layout/NotificationButton";
import { TyroAiDrawer } from "@/components/chat/TyroAiDrawer";
import { TyroChatDrawer } from "@/components/chat/TyroChatDrawer";
import { useProjects } from "@/hooks/useProjects";
import { AppSidebar } from "./AppSidebar";
import { SidebarProvider, useSidebar } from "./sidebar-context";
import { DataverseLoginAutoRefresh } from "@/components/auth/DataverseLoginAutoRefresh";
import {
  CommandPalette,
  useCommandPalette,
} from "@/components/command/CommandPalette";
import { CommandPaletteTrigger } from "@/components/command/CommandPaletteTrigger";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useThemeAccent } from "./theme-accent";
import { shouldUseMock } from "@/lib/dataverse";
import { cn } from "@/lib/utils";

const PAGE_TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/projects": "Vessel Projects",
  "/data": "Veri Yönetimi",
  "/settings": "Ayarlar",
};

export function AppShell() {
  return (
    <SidebarProvider>
      <ShellInner />
    </SidebarProvider>
  );
}

function ShellInner() {
  const isMobile = useIsMobile();
  const { mobileOpen, setMobileOpen } = useSidebar();
  const location = useLocation();
  const title =
    PAGE_TITLES[location.pathname] ||
    (location.pathname.startsWith("/projects") ? "Vessel Projects" : "tyrotrade");

  // AI drawer state lifted to ShellInner — the trigger now lives in
  // the sidebar (system group), but the drawer overlays the whole
  // app so it has to mount up here.
  const [aiOpen, setAiOpen] = React.useState(false);
  const openAi = React.useCallback(() => setAiOpen(true), []);

  return (
    <div className="h-screen w-screen flex overflow-hidden">
      {!isMobile && <DesktopSidebarSlot onOpenAi={openAi} />}

      {isMobile && (
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent
            side="left"
            className="p-3 max-w-[280px] sm:max-w-[280px]"
            aria-describedby={undefined}
          >
            <SheetTitle className="sr-only">Menu</SheetTitle>
            <AppSidebar
              embedded
              onItemClick={() => setMobileOpen(false)}
              onOpenAi={() => {
                openAi();
                setMobileOpen(false);
              }}
            />
          </SheetContent>
        </Sheet>
      )}

      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        <TopBar title={title} pathname={location.pathname} />
        <div className="flex-1 overflow-hidden p-3 pt-0">
          <Outlet />
        </div>
      </main>

      {/* AI drawer mounted at shell level so the sidebar trigger
          opens an overlay that covers everything regardless of route. */}
      <TyroAiDrawer open={aiOpen} onOpenChange={setAiOpen} />

      {/* Fires the post-login Dataverse refresh exactly once per browser
          session (sessionStorage flag). Renders nothing — toast is the
          only visible signal. */}
      <DataverseLoginAutoRefresh />
    </div>
  );
}

function DesktopSidebarSlot({ onOpenAi }: { onOpenAi: () => void }) {
  const { expanded, setHovering } = useSidebar();
  const closeTimer = React.useRef<number | null>(null);

  const handleEnter = () => {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setHovering(true);
  };

  const handleLeave = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setHovering(false), 180);
  };

  React.useEffect(() => {
    return () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
    };
  }, []);

  return (
    <div
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      className={cn(
        "shrink-0 p-3 transition-[width] duration-200 ease-out",
        expanded ? "w-[272px]" : "w-[92px]"
      )}
    >
      <AppSidebar onOpenAi={onOpenAi} />
    </div>
  );
}

function TopBar({ title, pathname }: { title: string; pathname: string }) {
  const isMobile = useIsMobile();
  const { setMobileOpen } = useSidebar();
  const { open: cmdOpen, setOpen: setCmdOpen } = useCommandPalette();
  const [chatOpen, setChatOpen] = React.useState(() => {
    // Auto-open chat when returning from Power Platform consent redirect.
    if (sessionStorage.getItem("tyro:openChatAfterAuth")) {
      sessionStorage.removeItem("tyro:openChatAfterAuth");
      return true;
    }
    return false;
  });

  // Resolve the active project when the user is on a detail route so
  // TyroChatDrawer can forward the context to the Copilot agent.
  const projectMatch = useMatch("/projects/:projectId");
  const activeProjectId = projectMatch?.params.projectId;
  const { projects } = useProjects();
  const activeProject = activeProjectId
    ? projects.find((p) => p.projectNo === activeProjectId)
    : undefined;
  const projectContext =
    activeProject
      ? { projectId: activeProject.projectNo, projectName: activeProject.projectName }
      : undefined;

  return (
    <>
      <div className="px-3 pt-3 pb-3">
        <GlassPanel tone="default" className="rounded-2xl">
          <div className="flex items-center gap-3 px-4 h-14">
            {isMobile && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMobileOpen(true)}
                aria-label="Menüyü aç"
              >
                <Menu />
              </Button>
            )}
            <PageTitleSlot title={title} pathname={pathname} />
            <CommandPaletteTrigger
              onOpen={() => setCmdOpen(true)}
              className="hidden md:inline-flex"
            />
            {/* Mobile-only search shortcut — opens the same command
                palette without taking horizontal real estate from the
                title slot. */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setCmdOpen(true)}
              aria-label="Ara"
              className="md:hidden text-muted-foreground"
            >
              <Search />
            </Button>
            <NotificationButton />
            {/* TYRO AI + TYROSTOCK CTAs moved into the sidebar's
                Sistem group (above Yardım). The chat trigger stays
                here because it's a frequently-toggled inline action
                rather than a sibling app. */}
            <TyroChatButton
              className="hidden sm:inline-flex"
              onClick={() => setChatOpen(true)}
            />
          </div>
        </GlassPanel>
      </div>
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
      <TyroChatDrawer
        open={chatOpen}
        onOpenChange={setChatOpen}
        projectContext={projectContext}
      />
    </>
  );
}

/**
 * Per-route page-title block. Mirrors the Veri Yönetimi pattern (stroke
 * HugeIcon + small uppercase label + bold descriptive title) for every
 * route so the top toolbar reads consistently across the app.
 *
 * Falls back to the legacy generic title (`{title} · International Trade`)
 * for routes that haven't been mapped yet — e.g. Settings or Help.
 */
interface PageTitleConfig {
  /** Icon glyph rendered inside the accent pill. Mirrors the AppSidebar
   *  icon for the same route so nav and header agree visually. */
  renderIcon: () => React.ReactNode;
  label: string;
  title: string;
}

const PAGE_TITLE_CONFIGS: Array<{
  match: (path: string) => boolean;
  config: PageTitleConfig;
}> = [
  {
    match: (p) => p === "/",
    config: {
      // Sidebar uses HugeIcons Home01Icon for Dashboard
      renderIcon: () => (
        <HugeiconsIcon icon={Home01Icon} size={16} strokeWidth={2} />
      ),
      label: "Dashboard",
      title: "Genel Bakış",
    },
  },
  {
    match: (p) => p === "/projects" || p.startsWith("/projects/"),
    config: {
      // Sidebar uses lucide Ship for Projects
      renderIcon: () => <Ship className="size-4" strokeWidth={2} />,
      label: "Vessel Projects",
      title: "Sefer Takibi",
    },
  },
  {
    match: (p) => p === "/pl-cost",
    config: {
      renderIcon: () => (
        <HugeiconsIcon icon={HotPriceIcon} size={16} strokeWidth={2} />
      ),
      label: "Trade Cost",
      title: "Tahmini × Gerçekleşen Maliyet",
    },
  },
  {
    match: (p) => p === "/data",
    config: {
      // Sidebar uses lucide Database for Data Management
      renderIcon: () => <Database className="size-4" strokeWidth={2} />,
      label: "Veri Yönetimi",
      title: "Dataverse Inspector",
    },
  },
  {
    match: (p) => p === "/settings",
    config: {
      renderIcon: () => <Settings className="size-4" strokeWidth={2} />,
      label: "Ayarlar",
      title: "Uygulama Tercihleri",
    },
  },
];

function PageTitleSlot({
  title,
  pathname,
}: {
  title: string;
  pathname: string;
}) {
  const accent = useThemeAccent();
  const mock = shouldUseMock();
  const matched = PAGE_TITLE_CONFIGS.find((c) => c.match(pathname))?.config;
  const isDataInspector = pathname === "/data";

  if (!matched) {
    // Fallback for unmapped routes — keeps the original light header.
    return (
      <div className="min-w-0 flex-1">
        <h1 className="text-base font-semibold truncate">{title}</h1>
        <p className="text-[11px] text-muted-foreground truncate">
          International Trade
        </p>
      </div>
    );
  }

  return (
    <div className="min-w-0 flex-1 flex items-center gap-2.5">
      <span
        className="size-9 rounded-xl grid place-items-center shrink-0 shadow-sm"
        style={{
          background: accent.gradient,
          color: "white",
          boxShadow: `0 4px 12px -4px ${accent.ring}, inset 0 1px 0 0 rgba(255,255,255,0.25)`,
        }}
      >
        {matched.renderIcon()}
      </span>
      <div className="min-w-0">
        <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground flex items-center gap-2 leading-tight">
          {matched.label}
          {isDataInspector && (
            <span
              className={cn(
                "inline-flex items-center gap-1 h-4 px-1.5 rounded text-[9.5px] font-semibold uppercase tracking-wide",
                mock
                  ? "bg-amber-500/15 text-amber-700"
                  : "bg-emerald-500/15 text-emerald-700"
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  mock ? "bg-amber-500" : "bg-emerald-500"
                )}
              />
              {mock ? "MOCK" : "CANLI"}
            </span>
          )}
        </div>
        <h1 className="text-[15px] font-semibold tracking-tight leading-tight truncate">
          {matched.title}
        </h1>
      </div>
    </div>
  );
}
