import { HugeiconsIcon } from "@hugeicons/react";
import { AiBrain02Icon } from "@hugeicons/core-free-icons";
import { useThemeAccent } from "@/components/layout/theme-accent";
import { cn } from "@/lib/utils";

export interface ChatMessageData {
  id: string;
  role: "user" | "ai";
  text: string;
  timestamp: Date;
  /** Set on the AI message currently waiting for a response so the
   *  bubble can render a 3-dot loader instead of empty text. */
  pending?: boolean;
}

interface ChatMessageProps {
  message: ChatMessageData;
  className?: string;
}

/**
 * Render a single chat bubble. User messages right-aligned with an
 * accent bubble; AI messages left-aligned with a small avatar +
 * glass card. Light markdown subset ( **bold**, line breaks,
 * "- " bullet lists ) is rendered inline.
 */
export function ChatMessage({ message, className }: ChatMessageProps) {
  const accent = useThemeAccent();
  const isUser = message.role === "user";
  if (isUser) {
    return (
      <div className={cn("flex justify-end", className)}>
        <div
          className="max-w-[85%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed shadow-sm"
          style={{
            // User bubble tint follows the theme accent so user messages
            // and the send button + drawer avatar all share the same hue.
            background: accent.tint,
            border: `1px solid ${accent.ring}`,
            color: "#0f172a",
          }}
        >
          {message.text}
        </div>
      </div>
    );
  }
  return (
    <div className={cn("flex gap-2 items-start", className)}>
      <span
        className="size-7 rounded-xl grid place-items-center shrink-0 shadow-sm text-white mt-0.5"
        style={{
          background: accent.gradient,
          boxShadow: `0 4px 12px -4px ${accent.ring}, inset 0 1px 0 0 rgba(255,255,255,0.25)`,
        }}
      >
        <HugeiconsIcon icon={AiBrain02Icon} size={14} strokeWidth={2} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed bg-white/85 border border-border/50 shadow-sm">
          {message.pending ? <PendingDots /> : <MarkdownText text={message.text} />}
        </div>
      </div>
    </div>
  );
}

/* ─────────── Tiny markdown subset ─────────── */

/**
 * Render a small subset of markdown: paragraphs, line breaks,
 * `**bold**`, and bullet lines starting with "- ". Anything fancier
 * (links, code blocks) is rendered as plain text — Gemini follows the
 * "kısa ve net" guidance from our system prompt so this is enough.
 */
export function MarkdownText({ text }: { text: string }) {
  // Group consecutive bullet lines into a single <ul>; everything else
  // becomes a <p>. Keeps the renderer trivially lightweight without
  // pulling react-markdown.
  const lines = text.split(/\r?\n/);
  const blocks: Array<{ type: "p" | "ul"; content: string[] }> = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    const isBullet = /^\s*[-*•]\s+/.test(line);
    if (isBullet) {
      const last = blocks[blocks.length - 1];
      if (last && last.type === "ul") {
        last.content.push(line.replace(/^\s*[-*•]\s+/, ""));
      } else {
        blocks.push({ type: "ul", content: [line.replace(/^\s*[-*•]\s+/, "")] });
      }
    } else if (line.trim() === "") {
      // Paragraph break — close current block by starting a fresh one
      if (blocks.length && blocks[blocks.length - 1].type === "p") {
        blocks.push({ type: "p", content: [] });
      }
    } else {
      const last = blocks[blocks.length - 1];
      if (last && last.type === "p") {
        last.content.push(line);
      } else {
        blocks.push({ type: "p", content: [line] });
      }
    }
  }
  return (
    <div className="space-y-1.5">
      {blocks.map((b, i) =>
        b.type === "ul" ? (
          <ul key={i} className="list-disc pl-4 space-y-0.5">
            {b.content.map((c, j) => (
              <li key={j}>
                <Inline text={c} />
              </li>
            ))}
          </ul>
        ) : b.content.length === 0 ? null : (
          <p key={i}>
            {b.content.map((c, j) => (
              <span key={j}>
                {j > 0 && <br />}
                <Inline text={c} />
              </span>
            ))}
          </p>
        )
      )}
    </div>
  );
}

/** Render a single line, applying `**bold**` segments. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (/^\*\*[^*]+\*\*$/.test(p)) {
          return (
            <strong key={i} className="font-semibold text-foreground">
              {p.slice(2, -2)}
            </strong>
          );
        }
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

/* ─────────── Pending state ─────────── */

function PendingDots() {
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <span className="text-[12px]">TYRO AI düşünüyor</span>
      <span className="inline-flex gap-0.5">
        <Dot delay="0ms" />
        <Dot delay="150ms" />
        <Dot delay="300ms" />
      </span>
    </span>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="size-1 rounded-full bg-current animate-pulse"
      style={{ animationDelay: delay }}
    />
  );
}
