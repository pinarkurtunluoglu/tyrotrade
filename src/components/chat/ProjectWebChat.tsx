import * as React from "react";
import { useMsal } from "@azure/msal-react";
import { InteractionRequiredAuthError } from "@azure/msal-browser";
import {
  CopilotStudioClient,
  ConnectionSettings,
} from "@microsoft/agents-copilotstudio-client";
import type { Activity } from "@microsoft/agents-activity";
import { ArrowUp } from "lucide-react";
import { HugeiconsIcon } from "@hugeicons/react";
import { BubbleChatIcon } from "@hugeicons/core-free-icons";
import { shouldUseMock } from "@/lib/dataverse";
import { MarkdownText } from "./ChatMessage";
import { isAuthConfigured, COPILOT_STUDIO_SCOPE } from "@/lib/auth/msal";
import { TYRO_CHAT_TONE } from "@/components/layout/TyroChatButton";
import { cn } from "@/lib/utils";

// Regenerated on every page load (module re-evaluation). Same value across
// component mount/unmount within a session → messages persist when drawer
// closes and reopens. New value on page refresh → stale storage is ignored.
const PAGE_SESSION_ID = Math.random().toString(36).slice(2);

const COPILOT_SETTINGS = new ConnectionSettings({
  directConnectUrl:
    "https://default9efa3bdf67ad47e38dfbd1df79a6d7.fa.environment.api.powerplatform.com/copilotstudio/dataverse-backed/authenticated/bots/crfc1_agentokBCAt/conversations?api-version=2022-03-01-preview",
  environmentId: "Default-9efa3bdf-67ad-47e3-8dfb-d1df79a6d7fa",
  schemaName: "crfc1_agentokBCAt",
});

export interface ProjectContext {
  projectId: string;
  projectName: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "bot";
  text: string;
  pending?: boolean;   // waiting for first token — show dots
  streaming?: boolean; // tokens arriving — show text + cursor
}

interface ProjectWebChatProps {
  projectContext?: ProjectContext;
}

/**
 * Outer shell — guards against calling useMsal() when MsalProvider is not
 * mounted (mock mode or incomplete auth config).
 */
export function ProjectWebChat(props: ProjectWebChatProps) {
  if (shouldUseMock() || !isAuthConfigured) {
    return (
      <div className="h-full flex items-center justify-center px-8 text-center">
        <p className="text-[12.5px] text-muted-foreground leading-relaxed">
          TYRO Chat gerçek mod gerektirir.
          <br />
          <span className="font-medium text-slate-600">VITE_USE_MOCK=false</span>{" "}
          ile oturum açın.
        </p>
      </div>
    );
  }
  return <ProjectWebChatCore {...props} />;
}

/**
 * Inner component — safe to call useMsal() here because the outer guard
 * ensures MsalProvider is mounted before this renders.
 */
function ProjectWebChatCore({ projectContext }: ProjectWebChatProps) {
  const { instance, accounts } = useMsal();

  // Restore messages only when page session AND project both match.
  // Page refresh generates a new PAGE_SESSION_ID → stored data is ignored.
  // Different project → start fresh so stale history doesn't bleed across.
  const [messages, setMessages] = React.useState<ChatMessage[]>(() => {
    try {
      const raw = sessionStorage.getItem("tyro:chat:session");
      if (!raw) return [];
      const stored = JSON.parse(raw) as {
        pageSessionId: string;
        projectId: string | null;
        messages: ChatMessage[];
      };
      const currentId = projectContext?.projectId ?? null;
      if (stored.pageSessionId !== PAGE_SESSION_ID) return [];
      return stored.projectId === currentId ? stored.messages : [];
    } catch {
      return [];
    }
  });
  const [input, setInput] = React.useState("");
  const [ready, setReady] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [initKey, setInitKey] = React.useState(0);

  // True when component mounts with prior session messages → skip greeting.
  const hadPriorSession = React.useRef(messages.length > 0);

  const clientRef = React.useRef<CopilotStudioClient | null>(null);
  const contextRef = React.useRef(projectContext);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  // Persist messages tagged with page session + project ID.
  React.useEffect(() => {
    try {
      sessionStorage.setItem(
        "tyro:chat:session",
        JSON.stringify({
          pageSessionId: PAGE_SESSION_ID,
          projectId: projectContext?.projectId ?? null,
          messages,
        })
      );
    } catch { /* ignore quota errors */ }
  }, [messages, projectContext?.projectId]);

  React.useEffect(() => {
    contextRef.current = projectContext;
  }, [projectContext]);

  React.useEffect(() => {
    if (!ready || !projectContext || !clientRef.current) return;
    void sendEvent(clientRef.current, projectContext);
  }, [projectContext?.projectId, projectContext?.projectName, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Initialise: get token → create client → start conversation → send context.
  React.useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const token = await getToken(instance, accounts);
        if (cancelled) return;

        const client = new CopilotStudioClient(COPILOT_SETTINGS, token);
        clientRef.current = client;

        setBusy(true);

        // Stream greeting — consume the generator to complete the handshake.
        // If restoring a prior session, suppress display so the old history
        // remains intact without a duplicate welcome message.
        const showGreeting = !hadPriorSession.current;
        const GREETING_ID = "greeting";
        let hadGreetingChunks = false;
        let firstGreetingMsg = true;

        for await (const activity of client.startConversationStreaming()) {
          if (cancelled) return;
          if (!showGreeting) continue;
          if (isStreamingChunk(activity) && activity.text != null) {
            hadGreetingChunks = true;
            if (firstGreetingMsg) {
              firstGreetingMsg = false;
              setMessages([
                { id: GREETING_ID, role: "bot", text: activity.text, streaming: true },
              ]);
            } else {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === GREETING_ID ? { ...m, text: activity.text! } : m
                )
              );
            }
          } else if (
            activity.type === "message" &&
            activity.from?.role === "bot" &&
            activity.text
          ) {
            if (hadGreetingChunks || firstGreetingMsg) {
              firstGreetingMsg = false;
              setMessages((prev) => {
                const existing = prev.find((m) => m.id === GREETING_ID);
                const msg = { id: GREETING_ID, role: "bot" as const, text: activity.text!, streaming: true };
                return existing ? prev.map((m) => m.id === GREETING_ID ? msg : m) : [...prev, msg];
              });
            } else {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === GREETING_ID
                    ? { ...m, text: m.text + "\n" + activity.text! }
                    : m
                )
              );
            }
          }
        }

        if (cancelled) return;

        if (showGreeting) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === GREETING_ID ? { ...m, streaming: false } : m
            )
          );
        }

        setReady(true);
        setBusy(false);

        const ctx = contextRef.current;
        if (ctx) await sendEvent(client, ctx);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof InteractionRequiredAuthError) {
          sessionStorage.setItem("tyro:openChatAfterAuth", "1");
          void instance.acquireTokenRedirect({
            scopes: [COPILOT_STUDIO_SCOPE],
            account: accounts[0],
          });
          return;
        }
        setError(err instanceof Error ? err.message : "Bağlantı hatası");
        setBusy(false);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [initKey]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSend() {
    const text = input.trim();
    if (!text || !clientRef.current || busy) return;

    setInput("");
    const userId = `u${Date.now()}`;
    const botId = `b${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: userId, role: "user", text },
      { id: botId, role: "bot", text: "", pending: true },
    ]);
    setBusy(true);

    // Silently prepend project context so the bot can resolve "bu proje" /
    // "bu gemi" references without the user having to repeat the ID.
    const ctx = contextRef.current;
    const enrichedText = ctx
      ? `[Aktif Proje: ${ctx.projectId} - ${ctx.projectName}]\n${text}`
      : text;

    try {
      const activity = { type: "message", text: enrichedText } as Activity;
      // Track whether we received any streaming typing chunks.
      // If yes, the final message activity is the authoritative version
      // (replace, not append). If no chunks came, each message appends.
      let hadStreamingChunks = false;
      let firstMessage = true;

      for await (const reply of clientRef.current.sendActivityStreaming(
        activity
      )) {
        if (isStreamingChunk(reply) && reply.text != null) {
          // Typing chunk: each has the CUMULATIVE text so far → replace.
          hadStreamingChunks = true;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === botId
                ? { ...m, text: reply.text!, pending: false, streaming: true }
                : m
            )
          );
        } else if (
          reply.type === "message" &&
          reply.from?.role === "bot" &&
          reply.text
        ) {
          if (hadStreamingChunks || firstMessage) {
            firstMessage = false;
            // Replace: either finalising streaming chunks, or first message.
            setMessages((prev) =>
              prev.map((m) =>
                m.id === botId
                  ? { ...m, text: reply.text!, pending: false, streaming: true }
                  : m
              )
            );
          } else {
            // Subsequent standalone messages → append.
            setMessages((prev) =>
              prev.map((m) =>
                m.id === botId
                  ? { ...m, text: m.text + "\n" + reply.text! }
                  : m
              )
            );
          }
        }
      }

      // Stream finished: remove cursor, fill fallback if nothing arrived.
      setMessages((prev) =>
        prev.map((m) =>
          m.id === botId
            ? { ...m, text: m.text || "…", pending: false, streaming: false }
            : m
        )
      );
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === botId
            ? { ...m, text: "Yanıt alınamadı.", pending: false, streaming: false }
            : m
        )
      );
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-[13px] font-medium text-slate-700">Bağlantı kurulamadı</p>
        <p className="text-[11.5px] text-muted-foreground leading-relaxed max-w-xs">{error}</p>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setReady(false);
            clientRef.current = null;
            setInitKey((k) => k + 1);
          }}
          className="text-[12px] font-semibold underline-offset-2 hover:underline transition-opacity hover:opacity-70"
          style={{ color: TYRO_CHAT_TONE.solid }}
        >
          Tekrar dene
        </button>
      </div>
    );
  }

  if (!ready && messages.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <span
            className="size-11 rounded-2xl grid place-items-center shadow-sm text-white"
            style={{
              background: TYRO_CHAT_TONE.gradient,
              boxShadow: `0 8px 24px -6px ${TYRO_CHAT_TONE.ring}, inset 0 1px 0 0 rgba(255,255,255,0.25)`,
            }}
          >
            <HugeiconsIcon icon={BubbleChatIcon} size={20} strokeWidth={1.75} />
          </span>
          <div className="flex gap-1">
            {[0, 150, 300].map((delay) => (
              <span
                key={delay}
                className="size-1.5 rounded-full animate-bounce"
                style={{ background: TYRO_CHAT_TONE.solid, animationDelay: `${delay}ms` }}
              />
            ))}
          </div>
          <p className="text-[11.5px] text-muted-foreground">Bağlanıyor…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-slate-50/40">
      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn("flex gap-2 items-end", msg.role === "user" ? "justify-end" : "justify-start")}
          >
            {msg.role === "bot" && (
              <span
                className="size-7 rounded-xl grid place-items-center shrink-0 text-white shadow-sm"
                style={{
                  background: TYRO_CHAT_TONE.gradient,
                  boxShadow: `0 4px 12px -4px ${TYRO_CHAT_TONE.ring}, inset 0 1px 0 0 rgba(255,255,255,0.25)`,
                }}
              >
                <HugeiconsIcon icon={BubbleChatIcon} size={13} strokeWidth={2} />
              </span>
            )}
            <div
              className={cn(
                "max-w-[82%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed",
                msg.role === "user"
                  ? "text-white rounded-br-sm shadow-sm"
                  : "bg-white border border-border/50 text-slate-800 rounded-bl-sm shadow-sm"
              )}
              style={msg.role === "user" ? {
                background: TYRO_CHAT_TONE.gradient,
                boxShadow: `0 4px 16px -4px ${TYRO_CHAT_TONE.ring}`,
              } : undefined}
            >
              {msg.pending ? (
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <span className="text-[12px]">TYRO düşünüyor</span>
                  <span className="inline-flex gap-0.5">
                    {[0, 150, 300].map((delay) => (
                      <span
                        key={delay}
                        className="size-1 rounded-full bg-current animate-pulse"
                        style={{ animationDelay: `${delay}ms` }}
                      />
                    ))}
                  </span>
                </span>
              ) : (
                <>
                  {msg.role === "bot" ? (
                    <MarkdownText text={msg.text} />
                  ) : (
                    <span className="whitespace-pre-wrap">{msg.text}</span>
                  )}
                  {msg.streaming && (
                    <span
                      className="inline-block w-0.5 h-[1em] ml-0.5 align-middle animate-pulse rounded-full"
                      style={{ background: msg.role === "user" ? "rgba(255,255,255,0.7)" : TYRO_CHAT_TONE.solid }}
                    />
                  )}
                </>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-border/40 px-3 py-3 bg-white/80 backdrop-blur-sm">
        <div
          className={cn(
            "flex items-end gap-2 rounded-2xl border border-border/50 bg-white px-3 py-2",
            "transition-all duration-150",
            "focus-within:border-[#6366f1]/40 focus-within:shadow-[0_0_0_3px_rgba(99,102,241,0.08)]"
          )}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Bir şey sorun…"
            rows={1}
            disabled={busy}
            className={cn(
              "flex-1 resize-none bg-transparent",
              "text-[13px] leading-relaxed outline-none",
              "placeholder:text-muted-foreground/50 disabled:opacity-50",
              "max-h-32 overflow-y-auto"
            )}
            style={{ height: "auto" }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = `${el.scrollHeight}px`;
            }}
          />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!input.trim() || busy}
            className="size-8 rounded-xl grid place-items-center shrink-0 text-white transition-all hover:scale-[1.06] active:scale-95 disabled:opacity-35 disabled:pointer-events-none shadow-sm"
            style={{
              background: TYRO_CHAT_TONE.gradient,
              boxShadow: `0 4px 12px -4px ${TYRO_CHAT_TONE.ring}`,
            }}
          >
            <ArrowUp className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getToken(
  instance: ReturnType<typeof useMsal>["instance"],
  accounts: ReturnType<typeof useMsal>["accounts"]
): Promise<string> {
  const account = accounts[0];
  if (!account) throw new Error("Microsoft oturumu bulunamadı.");
  const request = { scopes: [COPILOT_STUDIO_SCOPE], account };
  const result = await instance.acquireTokenSilent(request);
  return result.accessToken;
}

/**
 * Returns true when an activity is a streaming text chunk from the SDK.
 *
 * The Copilot Studio SDK yields `typing` activities while the bot is
 * generating its response. Each one carries the CUMULATIVE text so far
 * (sorted and joined from all received chunks). The streaming metadata
 * lives in either `channelData.streamType` (legacy) or an `entities`
 * entry with `type === "streaminfo"`.
 */
function isStreamingChunk(activity: Activity): boolean {
  if (activity.type !== "typing") return false;
  const cd = activity.channelData as { streamType?: string } | undefined;
  if (cd?.streamType === "streaming") return true;
  const entities = activity.entities as
    | Array<{ type?: string; streamType?: string }>
    | undefined;
  return !!entities?.some(
    (e) => e.type === "streaminfo" && e.streamType === "streaming"
  );
}

/** Send a setProjectContext event activity; ignore any bot response. */
async function sendEvent(
  client: CopilotStudioClient,
  ctx: ProjectContext
): Promise<void> {
  const activity = {
    type: "event",
    name: "setProjectContext",
    value: { projectId: ctx.projectId, projectName: ctx.projectName },
  } as Activity;
  for await (const _ of client.sendActivityStreaming(activity)) {
    // noop — consume generator so the HTTP request completes
  }
}
