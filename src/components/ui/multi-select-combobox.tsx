import * as React from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** Option as either a bare string (value === label) or a rich object
 *  with separate value / label / keywords for searchable comboboxes
 *  where the display string is richer than the underlying selection
 *  value (e.g. "PRJ000123 — 55KMT BRZ SOY" with value `PRJ000123`). */
export type MultiSelectOption =
  | string
  | { value: string; label: string; keywords?: string[]; sub?: string };

interface MultiSelectComboboxProps {
  /** Options — strings OR rich {value, label, keywords, sub} objects. */
  options: ReadonlyArray<MultiSelectOption>;
  /** Currently-selected values (Set for O(1) toggle). */
  selected: Set<string>;
  /** Callback receives the next Set when toggled. */
  onChange: (next: Set<string>) => void;
  /** Placeholder shown when nothing is selected. */
  placeholder?: string;
  /** Search input placeholder. */
  searchPlaceholder?: string;
  /** Empty state copy when search returns nothing. */
  emptyText?: string;
  /** Theme accent for the active-state colours. */
  accent: { solid: string; ring: string; tint: string };
  className?: string;
  triggerClassName?: string;
  /** Optional max-height override on the list (default 240px). */
  maxListHeight?: number;
  /** Compact rendering for tight toolbars (Trade Cost quick filters):
   *  fixed-height single-line trigger that NEVER grows past h-9 when
   *  multiple values are selected — single chip with truncated label
   *  + numeric overflow pill instead of stacking selected items down.
   *  Default false (legacy wrap-and-grow behaviour). */
  compact?: boolean;
  /** Optional element id whose text should be the trigger's
   *  accessible name. Used by quick-filter columns whose visible
   *  label sits ABOVE the trigger so screen readers announce e.g.
   *  "Segment, combobox, no selection". */
  triggerAriaLabelledBy?: string;
}

function normalizeOption(o: MultiSelectOption): {
  value: string;
  label: string;
  keywords?: string[];
  sub?: string;
} {
  return typeof o === "string" ? { value: o, label: o } : o;
}

/**
 * Searchable multi-select combobox built on cmdk + Popover. Matches the
 * Advanced Filter visual language: chip-style trigger that shows the
 * selection count, popover content with a search input, scrollable
 * checklist of options, and a "Clear" affordance when items are
 * selected. Selected items render as removable mini-chips inside the
 * trigger up to 2 rows so the user can see what they picked without
 * opening the popover.
 */
export function MultiSelectCombobox({
  options,
  selected,
  onChange,
  placeholder = "Hepsi",
  searchPlaceholder = "Ara…",
  emptyText = "Sonuç bulunamadı",
  accent,
  className,
  triggerClassName,
  maxListHeight = 240,
  compact = false,
  triggerAriaLabelledBy,
}: MultiSelectComboboxProps) {
  const [open, setOpen] = React.useState(false);

  function toggle(value: string) {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  }

  function clearAll() {
    onChange(new Set());
  }

  const count = selected.size;
  const hasSelection = count > 0;

  // Build a value→label lookup so trigger chips can render the
  // friendlier label instead of the raw value when rich options are
  // supplied. Bare-string options collapse value === label.
  const labelByValue = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const o of options) {
      const n = normalizeOption(o);
      m.set(n.value, n.label);
    }
    return m;
  }, [options]);

  return (
    <div className={className}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-labelledby={triggerAriaLabelledBy}
            className={cn(
              // Bigger trigger surface — was min-h-9 + 12px text + tight
              // px-2.5/py-1.5. Bumped to min-h-10 + 13.5px + px-3/py-2
              // so labels read clearly and chips inside breathe; keeps
              // the same rounded shape so the popover still anchors
              // cleanly. Solid white background (was 80% translucent)
              // so the border and chips read as a crisp form field
              // rather than a faint ghost.
              //
              // Compact mode (Trade Cost quick filters): single-line
              // fixed height, no wrap — multiple selections collapse
              // into a count badge instead of stacking down.
              "w-full rounded-lg border bg-white text-left text-[13.5px] leading-tight",
              "flex items-center gap-1.5",
              "transition-colors hover:bg-foreground/[0.02]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              compact
                ? "h-9 px-2.5 py-1 flex-nowrap overflow-hidden"
                : "min-h-10 px-3 py-2 flex-wrap",
              hasSelection
                ? "border-foreground/20"
                : "border-input",
              triggerClassName
            )}
            style={
              hasSelection
                ? { borderColor: accent.ring, boxShadow: `0 0 0 1px ${accent.ring}` }
                : undefined
            }
          >
            {hasSelection ? (
              compact ? (
                /* Compact: single truncated chip for the first
                   selection + numeric pill for the rest. Trigger
                   stays exactly one line tall so adjacent quick-
                   filter columns can't push downstream content. */
                <>
                  <span
                    className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md text-[11.5px] font-semibold min-w-0 max-w-[140px]"
                    style={{
                      backgroundColor: accent.tint,
                      color: accent.solid,
                      boxShadow: `inset 0 0 0 1px ${accent.ring}`,
                    }}
                  >
                    <span className="truncate">
                      {labelByValue.get([...selected][0]) ?? [...selected][0]}
                    </span>
                    <X
                      className="size-3 shrink-0 opacity-70 hover:opacity-100 cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle([...selected][0]);
                      }}
                    />
                  </span>
                  {count > 1 && (
                    <span
                      className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[11.5px] font-bold tabular-nums shrink-0"
                      style={{
                        backgroundColor: accent.solid,
                        color: "white",
                      }}
                    >
                      +{count - 1}
                    </span>
                  )}
                </>
              ) : (
                <>
                  {/* Up to 4 chips inline (was 3); each chip wider
                      (max-w 220 vs 160) and roomier (px-2 py-1 vs
                      px-1.5 py-0.5) so long counterparty names stay
                      legible without truncating to 2 chars. */}
                  {[...selected].slice(0, 4).map((v) => (
                    <span
                      key={v}
                      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[12px] font-semibold max-w-[220px]"
                      style={{
                        backgroundColor: accent.tint,
                        color: accent.solid,
                        boxShadow: `inset 0 0 0 1px ${accent.ring}`,
                      }}
                    >
                      <span className="truncate">{labelByValue.get(v) ?? v}</span>
                      <X
                        className="size-3 shrink-0 opacity-70 hover:opacity-100 cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle(v);
                        }}
                      />
                    </span>
                  ))}
                  {selected.size > 4 && (
                    <span
                      className="inline-flex items-center px-2 py-1 rounded-md text-[12px] font-bold tabular-nums"
                      style={{
                        backgroundColor: accent.solid,
                        color: "white",
                      }}
                    >
                      +{selected.size - 4}
                    </span>
                  )}
                </>
              )
            ) : (
              <span className="text-muted-foreground/80 truncate">
                {placeholder}
              </span>
            )}
            <ChevronsUpDown className="ml-auto size-4 shrink-0 opacity-60" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={4}
          className="p-0 w-[var(--radix-popover-trigger-width)] min-w-[280px]"
        >
          <Command shouldFilter>
            <CommandInput placeholder={searchPlaceholder} className="text-[13px]" />
            <CommandList style={{ maxHeight: maxListHeight }}>
              <CommandEmpty>{emptyText}</CommandEmpty>
              <CommandGroup>
                {options.map((opt) => {
                  const n = normalizeOption(opt);
                  const isSelected = selected.has(n.value);
                  // cmdk filters by `value` + `keywords` — so rich
                  // options can surface in a search even when the
                  // visible label doesn't match the query (e.g. type
                  // "soybean" to find a project whose name has it).
                  return (
                    <CommandItem
                      key={n.value}
                      value={n.value}
                      keywords={n.keywords}
                      onSelect={() => toggle(n.value)}
                      // Bigger checklist row — px-2.5/py-2 so the
                      // checkbox + label have visual room and rows
                      // don't read as cramped lines.
                      className="cursor-pointer px-2.5 py-2 text-[13px] gap-2.5"
                    >
                      <span
                        className="size-[18px] rounded-[5px] grid place-items-center shrink-0 transition-colors"
                        style={{
                          backgroundColor: isSelected ? accent.solid : "transparent",
                          boxShadow: `inset 0 0 0 1.5px ${
                            isSelected ? accent.solid : "rgba(15,23,42,0.25)"
                          }`,
                        }}
                      >
                        {isSelected && (
                          <Check className="size-3.5 text-white" strokeWidth={3} />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-foreground/95 leading-tight">
                          {n.label}
                        </div>
                        {n.sub && (
                          <div className="truncate text-[11.5px] text-muted-foreground/80 mt-0.5 leading-tight">
                            {n.sub}
                          </div>
                        )}
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
              {hasSelection && (
                <>
                  <CommandSeparator />
                  <CommandGroup>
                    <CommandItem
                      onSelect={clearAll}
                      className="cursor-pointer text-rose-600 hover:text-rose-700 px-2.5 py-2 text-[13px] gap-2"
                    >
                      <X className="size-4" />
                      <span className="font-medium">Tümünü temizle ({count})</span>
                    </CommandItem>
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
