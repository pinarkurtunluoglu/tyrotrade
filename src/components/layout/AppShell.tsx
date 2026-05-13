import * as React from "react";
import { Outlet, useLocation, useMatch } from "react-router-dom";
import { Menu, Ship, Database, Search, Settings, X } from "lucide-react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Home01Icon, HotPriceIcon, BubbleChatIcon } from "@hugeicons/core-free-icons";
import { GlassPanel } from "@/components/glass/GlassPanel";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { TyroChatButton, TYRO_CHAT_TONE } from "@/components/layout/TyroChatButton";
import { NotificationButton } from "@/components/layout/NotificationButton";
import { TyroAiDrawer } from "@/components/chat/TyroAiDrawer";
import { TyroChatDrawer } from "@/components/chat/TyroChatDrawer";
import { ProjectWebChat, type ProjectContext } from "@/components/chat/ProjectWebChat";
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

  const [aiOpen, setAiOpen] = React.useState(false);
  const openAi = React.useCallback(() => setAiOpen(true), []);

  // Chat state lifted here so desktop panel is a flex sibling (push layout)
  // rather than a portal overlay.
  const [chatOpen, setChatOpen] = React.useState(() => {
    if (sessionStorage.getItem("tyro:openChatAfterAuth")) {
      sessionStorage.removeItem("tyro:openChatAfterAuth");
      return true;
    }
    return false;
  });

  // Project context resolved here so both desktop panel and mobile drawer share it.
  const projectMatch = useMatch("/projects/:projectId");
  const activeProjectId = projectMatch?.params.projectId;
  const { projects } = useProjects();
  const activeProject = activeProjectId
    ? projects.find((p) => p.projectNo === activeProjectId)
    : undefined;
  const projectContext: ProjectContext | undefined = activeProjectId
    ? {
        projectId: activeProjectId,
        projectName: activeProject?.projectName ?? activeProjectId,
      }
    : undefined;

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
        <TopBar
          title={title}
          pathname={location.pathname}
          onOpenChat={() => setChatOpen(true)}
        />
        <div className="flex-1 overflow-hidden p-3 pt-0">
          <Outlet />
        </div>
      </main>

      {/* Desktop: inline push panel — content shifts left, no overlay */}
      {!isMobile && (
        <DesktopChatSlot
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          projectContext={projectContext}
        />
      )}

      {/* Mobile: sheet drawer overlay */}
      {isMobile && (
        <TyroChatDrawer
          open={chatOpen}
          onOpenChange={setChatOpen}
          projectContext={projectContext}
        />
      )}

      <TyroAiDrawer open={aiOpen} onOpenChange={setAiOpen} />
      <DataverseLoginAutoRefresh />
    </div>
  );
}

/* ─── Desktop inline chat panel ──────────────────────────────────────────── */

function DesktopChatSlot({
  open,
  onClose,
  projectContext,
}: {
  open: boolean;
  onClose: () => void;
  projectContext?: ProjectContext;
}) {
  const [hasOpened, setHasOpened] = React.useState(false);
  React.useEffect(() => {
    if (open) setHasOpened(true);
  }, [open]);

  return (
    <div
      className={cn(
        "shrink-0 flex flex-col border-l border-border/60 overflow-hidden",
        "bg-white/95 backdrop-blur-2xl backdrop-saturate-150",
        "shadow-[-30px_0_80px_-16px_rgba(15,23,42,0.12)]",
        "transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
        open ? "w-[460px]" : "w-0"
      )}
    >
      {hasOpened && (
        <>
          {/* Top accent bar */}
          <div
            aria-hidden
            className="h-1 w-full shrink-0"
            style={{ background: TYRO_CHAT_TONE.gradient }}
          />

          {/* Header */}
          <div className="px-5 py-4 flex items-center gap-3 shrink-0 border-b border-border/40">
            <span
              className="size-10 rounded-xl grid place-items-center shrink-0 shadow-sm text-white"
              style={{
                background: TYRO_CHAT_TONE.gradient,
                boxShadow: `0 4px 12px -4px ${TYRO_CHAT_TONE.ring}, inset 0 1px 0 0 rgba(255,255,255,0.25)`,
              }}
            >
              <HugeiconsIcon icon={BubbleChatIcon} size={18} strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[16px] font-semibold tracking-tight leading-tight">
                TYRO Chat
              </p>
              <p className="text-[12px] text-muted-foreground leading-tight mt-0.5">
                {projectContext ? projectContext.projectName : "Uluslararası ticaret asistanı"}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="size-8 rounded-lg grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              aria-label="Kapat"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Chat body */}
          <div className="flex-1 min-h-0 bg-white">
            <ProjectWebChat projectContext={projectContext} />
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Desktop sidebar slot ───────────────────────────────────────────────── */

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

/* ─── Top bar ────────────────────────────────────────────────────────────── */

function TopBar({
  title,
  pathname,
  onOpenChat,
}: {
  title: string;
  pathname: string;
  onOpenChat: () => void;
}) {
  const isMobile = useIsMobile();
  const { setMobileOpen } = useSidebar();
  const { open: cmdOpen, setOpen: setCmdOpen } = useCommandPalette();

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
            <TyroChatButton
              className="hidden sm:inline-flex"
              onClick={onOpenChat}
            />
          </div>
        </GlassPanel>
      </div>
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
    </>
  );
}

/* ─── Page title slot ────────────────────────────────────────────────────── */

interface PageTitleConfig {
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
