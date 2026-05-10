import * as React from "react";
import { Link, useMatch } from "react-router-dom";
import {
  Ship,
  Database,
  Settings,
  HelpCircle,
  Pin,
  PinOff,
} from "lucide-react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Home01Icon,
  HotPriceIcon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Wordmark } from "@/components/brand/Wordmark";
import { Logo } from "@/components/brand/Logo";
import { useSidebar } from "./sidebar-context";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { ProfileMenu } from "./ProfileMenu";

/** Wrapper to make HugeIcons compatible with the lucide-style ElementType nav signature. */
function HomeLineIcon({ className }: { className?: string }) {
  return (
    <HugeiconsIcon icon={Home01Icon} className={className} strokeWidth={2} />
  );
}

function PLCostIcon({ className }: { className?: string }) {
  return (
    <HugeiconsIcon icon={HotPriceIcon} className={className} strokeWidth={2} />
  );
}

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Ana Menü",
    items: [
      { to: "/", label: "Dashboard", icon: HomeLineIcon },
      { to: "/projects", label: "Vessel Projects", icon: Ship },
      { to: "/pl-cost", label: "Trade Cost", icon: PLCostIcon },
      { to: "/data", label: "Data Management", icon: Database },
    ],
  },
  {
    label: "Sistem",
    items: [
      { to: "/help", label: "Yardım", icon: HelpCircle },
      { to: "/settings", label: "Ayarlar", icon: Settings },
    ],
  },
];

interface AppSidebarProps {
  embedded?: boolean;
  onItemClick?: () => void;
}

export function AppSidebar({ embedded = false, onItemClick }: AppSidebarProps) {
  const { expanded, pinned, togglePin, theme } = useSidebar();
  const showLabels = embedded || expanded;
  const [mainGroup, systemGroup] = NAV_GROUPS;

  return (
    <TooltipProvider delayDuration={150} disableHoverableContent>
      <div
        data-sb-theme={theme}
        className={cn(
          "sidebar-themed flex flex-col h-full overflow-hidden relative rounded-[24px]",
          embedded && "w-full"
        )}
      >
        <div
          className={cn(
            "h-16 flex items-center px-3 shrink-0",
            showLabels ? "justify-between gap-2" : "justify-center"
          )}
        >
          {showLabels ? (
            <>
              <Wordmark
                variant="compact"
                onDark={theme !== "light"}
                palette={theme === "navy" ? "amber" : theme === "black" ? "sky-bright" : "sky"}
              />
              {!embedded && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={togglePin}
                      aria-label={
                        pinned ? "Sabitlemeyi kaldır" : "Sidebar'ı sabitle"
                      }
                      className={cn(
                        "shrink-0 transition-colors text-[var(--sb-text-faint)] hover:text-[var(--sb-text)] hover:bg-[var(--sb-hover-bg)]",
                        pinned &&
                          "text-[var(--sb-pin-active)] hover:text-[var(--sb-pin-active)]"
                      )}
                    >
                      {pinned ? (
                        <PinOff className="size-4" />
                      ) : (
                        <Pin className="size-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {pinned ? "Sabitlemeyi kaldır" : "Sidebar'ı sabitle"}
                  </TooltipContent>
                </Tooltip>
              )}
            </>
          ) : (
            <Logo
              size={34}
              onDark={theme !== "light"}
              palette={theme === "navy" ? "amber" : theme === "black" ? "sky-bright" : "sky"}
            />
          )}
        </div>

        <div className="px-3 pb-2">
          <div className="h-px bg-gradient-to-r from-transparent via-[var(--sb-divider)] to-transparent" />
        </div>

        <nav
          className={cn(
            "flex-1 overflow-y-auto overflow-x-hidden flex flex-col",
            showLabels ? "px-2 pt-1 gap-0.5" : "items-center px-0 pt-1 gap-1.5"
          )}
        >
          <NavSection
            group={mainGroup}
            showLabels={showLabels}
            onItemClick={onItemClick}
          />
        </nav>

        <div
          className={cn(
            "pb-3 pt-2 shrink-0 flex flex-col",
            showLabels ? "px-2 gap-0.5" : "items-center px-0 gap-1.5"
          )}
        >
          <div
            className={cn(
              "mb-2 h-px bg-gradient-to-r from-transparent via-[var(--sb-divider)] to-transparent",
              !showLabels && "w-8 mx-auto"
            )}
          />
          {showLabels && (
            <div className="px-3 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--sb-text-faint)]">
              {systemGroup.label}
            </div>
          )}
          <NavItemLink
            item={systemGroup.items[0]}
            showLabel={showLabels}
            onClick={onItemClick}
          />
          <ThemeSwitcher showLabel={showLabels} />
          <NavItemLink
            item={systemGroup.items[1]}
            showLabel={showLabels}
            onClick={onItemClick}
          />
          {/* Profile menu — pinned to the very bottom of the sidebar */}
          <div
            className={cn(
              "mt-2 mb-1 h-px bg-gradient-to-r from-transparent via-[var(--sb-divider)] to-transparent",
              !showLabels && "w-8 mx-auto"
            )}
          />
          <ProfileMenu expanded={showLabels} />
        </div>
      </div>
    </TooltipProvider>
  );
}

function NavSection({
  group,
  showLabels,
  onItemClick,
  topDivider,
  extra,
}: {
  group: NavGroup;
  showLabels: boolean;
  onItemClick?: () => void;
  topDivider?: boolean;
  extra?: React.ReactNode;
}) {
  return (
    <>
      {topDivider && (
        <div
          className={cn(
            "mb-2 h-px bg-gradient-to-r from-transparent via-[var(--sb-divider)] to-transparent",
            !showLabels && "w-8 mx-auto"
          )}
        />
      )}
      {showLabels && (
        <div className="px-3 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--sb-text-faint)]">
          {group.label}
        </div>
      )}
      {group.items.map((item) => (
        <NavItemLink
          key={item.to}
          item={item}
          showLabel={showLabels}
          onClick={onItemClick}
        />
      ))}
      {extra}
    </>
  );
}

function NavItemLink({
  item,
  showLabel,
  onClick,
}: {
  item: NavItem;
  showLabel: boolean;
  onClick?: () => void;
}) {
  const Icon = item.icon;
  const match = useMatch({ path: item.to, end: item.to === "/" });
  const isActive = !!match;

  const inner = (
    <Link
      to={item.to}
      onClick={onClick}
      className={cn(
        "group flex items-center rounded-xl text-[13px] font-medium transition-all relative shrink-0",
        showLabel
          ? "h-9 w-full pl-3 pr-3 gap-2.5"
          : "h-10 w-10 justify-center px-0",
        isActive
          ? "bg-[var(--sb-active-bg)] text-[var(--sb-text-strong)] shadow-[inset_3px_0_0_0_var(--sb-pin-active),inset_0_0_0_1px_var(--sb-active-ring)]"
          : "text-[var(--sb-text-muted)] hover:text-[var(--sb-text)] hover:bg-[var(--sb-hover-bg)]"
      )}
    >
      <Icon className={cn(showLabel ? "size-4" : "size-[18px]", "shrink-0")} />
      {showLabel && <span className="truncate">{item.label}</span>}
    </Link>
  );

  if (!showLabel) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{inner}</TooltipTrigger>
        <TooltipContent side="right">{item.label}</TooltipContent>
      </Tooltip>
    );
  }
  return inner;
}
