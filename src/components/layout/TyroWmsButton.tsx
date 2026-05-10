import * as React from "react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/brand/Logo";

interface TyroWmsButtonProps {
  className?: string;
}

/**
 * Sister-app shortcut — opens TYROSTOCK (the warehouse/inventory
 * management app that used to be called tyrowms) in a new tab.
 * Wears the official aurora gradient (sky → violet → cyan) so it
 * reads as a colour pair with the TYRO AI button.
 *
 * Collapsed-by-default: at rest the button is a circular icon-only
 * pill (9×9) so it doesn't crowd the topbar. On hover it animates the
 * width open to reveal the "tyrostock" wordmark — full button visible.
 */

const AURORA_GRADIENT =
  "linear-gradient(135deg, #3b82f6 0%, #8b5cf6 50%, #06b6d4 100%)";
const AURORA_RING = "rgba(99, 102, 241, 0.55)";

export function TyroWmsButton({ className }: TyroWmsButtonProps) {
  const [hovered, setHovered] = React.useState(false);
  return (
    <a
      href="https://tyrowms.github.io/"
      target="_blank"
      rel="noopener noreferrer"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      className={cn(
        "group relative inline-flex items-center shrink-0 overflow-hidden",
        "rounded-full h-9 text-[13px] font-semibold lowercase text-white",
        "ring-1 ring-white/20 hover:ring-white/40",
        // Width animation: 36px collapsed → 146px expanded. The expanded
        // width is sized so the centred "tyrostock" wordmark at 13px
        // sits comfortably between the icon and the right edge without
        // crowding either side (tyrostock is 1 character longer than
        // the legacy tyrowms label).
        "transition-[width,box-shadow,transform] duration-300 ease-out",
        hovered ? "w-[146px]" : "w-9",
        "active:scale-95",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className
      )}
      style={{
        background: AURORA_GRADIENT,
        boxShadow: `0 4px 14px -4px ${AURORA_RING}, inset 0 1px 0 0 rgba(255,255,255,0.25)`,
      }}
      aria-label="TYROSTOCK uygulamasını aç"
    >
      {/* Animated shimmer overlay on hover */}
      <span
        aria-hidden
        className={cn(
          "absolute inset-0 rounded-full pointer-events-none",
          "before:absolute before:inset-0 before:bg-gradient-to-r before:from-transparent before:via-white/35 before:to-transparent",
          "before:translate-x-[-120%] before:transition-transform before:duration-700",
          hovered && "before:translate-x-[120%]"
        )}
      />

      {/* Origami T badge — pinned to the left, always 36×36 so the
          collapsed pill is a perfect circle. */}
      <span className="relative z-[1] size-9 grid place-items-center shrink-0">
        <span className="size-6 rounded-full grid place-items-center bg-white/95 shadow-sm">
          <Logo size={16} palette="aurora" />
        </span>
      </span>

      {/* Wordmark fades in alongside the width animation. `flex-1 +
          justify-center` puts the label in the middle of the freed
          space (post-icon area) so the expanded pill reads balanced
          rather than icon-heavy. `whitespace-nowrap` + the parent's
          `overflow-hidden` keep it from wrapping while the pill is
          still narrow during the open animation. */}
      <span
        className={cn(
          "relative z-[1] flex-1 inline-flex items-center justify-center",
          "tracking-tight whitespace-nowrap pr-3",
          "transition-opacity duration-200",
          hovered ? "opacity-100 delay-100" : "opacity-0"
        )}
      >
        <span className="text-white">tyro</span>
        <span className="text-white font-bold">stock</span>
      </span>
    </a>
  );
}
