import * as React from "react";
import { useMsal } from "@azure/msal-react";
import { InteractionRequiredAuthError } from "@azure/msal-browser";
import {
  CopilotStudioClient,
  ConnectionSettings,
  ScopeHelper,
} from "@microsoft/agents-copilotstudio-client";
import type { Activity } from "@microsoft/agents-activity";
import { ArrowUp, Bot } from "lucide-react";
import { shouldUseMock } from "@/lib/dataverse";
import { isAuthConfigured } from "@/lib/auth/msal";
import { cn } from "@/lib/utils";

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
  pending?: boolean;
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

  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [ready, setReady] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [needsConsent, setNeedsConsent] = React.useState(false);
  const [initKey, setInitKey] = React.useState(0);

  const clientRef = React.useRef<CopilotStudioClient | null>(null);
  const contextRef = React.useRef(projectContext);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  // Keep contextRef current so the init effect always reads the latest value.
  React.useEffect(() => {
    contextRef.current = projectContext;
  }, [projectContext]);

  // Re-send project context when user navigates to a different project
  // while the conversation is already live.
  React.useEffect(() => {
    if (!ready || !projectContext || !clientRef.current) return;
    void sendEvent(clientRef.current, projectContext);
  }, [projectContext?.projectId, projectContext?.projectName, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to bottom whenever messages change.
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
        const greeting = await collectMessages(
          client.startConversationStreaming()
        );
        if (cancelled) return;

        if (greeting.length > 0) {
          setMessages(
            greeting.map((text, i) => ({ id: `g${i}`, role: "bot", text }))
          );
        }

        setReady(true);
        setBusy(false);

        // Send initial project context after greeting — the Copilot runtime
        // is confirmed alive once startConversationStreaming() resolves.
        const ctx = contextRef.current;
        if (ctx) await sendEvent(client, ctx);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof InteractionRequiredAuthError) {
          // Silently redirect for consent — no button, no screen.
          // sessionStorage flag reopens chat on return.
          sessionStorage.setItem("tyro:openChatAfterAuth", "1");
          void instance.acquireTokenRedirect({
            scopes: [ScopeHelper.getScopeFromSettings(COPILOT_SETTINGS)],
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

    try {
      const activity: Activity = { type: "message", text };
      const replies = await collectMessages(
        clientRef.current.sendActivityStreaming(activity)
      );
      setMessages((prev) =>
        prev.map((m) =>
          m.id === botId
            ? { ...m, text: replies.join("\n") || "…", pending: false }
            : m
        )
      );
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === botId
            ? { ...m, text: "Yanıt alınamadı.", pending: false }
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

  if (needsConsent) {
    const scope = ScopeHelper.getScopeFromSettings(COPILOT_SETTINGS);
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-[13px] font-medium text-slate-700">
          Power Platform izni gerekiyor
        </p>
        <p className="text-[11.5px] text-muted-foreground leading-relaxed max-w-xs">
          TYRO Chat için Microsoft'un onay sayfasına yönlendirileceksiniz.
          Geri döndükten sonra chat otomatik açılır.
        </p>
        <button
          type="button"
          onClick={() => {
            // Store intent so the chat opens automatically after redirect.
            sessionStorage.setItem("tyro:openChatAfterAuth", "1");
            void instance.acquireTokenRedirect({
              scopes: [scope],
              account: accounts[0],
            });
          }}
          className="h-9 px-4 rounded-full text-[13px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
        >
          İzin ver ve bağlan
        </button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-[13px] font-medium text-slate-700">
          Bağlantı kurulamadı
        </p>
        <p className="text-[11.5px] text-muted-foreground leading-relaxed max-w-xs">
          {error}
        </p>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setReady(false);
            clientRef.current = null;
          }}
          className="text-[12px] font-medium text-indigo-600 hover:text-indigo-700 underline-offset-2 hover:underline"
        >
          Tekrar dene
        </button>
      </div>
    );
  }

  if (!ready && messages.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <div className="size-6 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
          <p className="text-[11.5px] text-muted-foreground">Bağlanıyor…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn(
              "flex gap-2",
              msg.role === "user" ? "justify-end" : "justify-start"
            )}
          >
            {msg.role === "bot" && (
              <span className="size-6 rounded-full bg-indigo-100 text-indigo-600 grid place-items-center shrink-0 mt-0.5">
                <Bot className="size-3.5" />
              </span>
            )}
            <div
              className={cn(
                "max-w-[80%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed",
                msg.role === "user"
                  ? "bg-indigo-600 text-white rounded-br-sm"
                  : "bg-slate-100 text-slate-800 rounded-bl-sm"
              )}
            >
              {msg.pending ? (
                <span className="flex gap-1 items-center h-4">
                  <span className="size-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:0ms]" />
                  <span className="size-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:150ms]" />
                  <span className="size-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:300ms]" />
                </span>
              ) : (
                <span className="whitespace-pre-wrap">{msg.text}</span>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-border/40 px-3 py-2.5 flex items-end gap-2">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Bir şey sorun…"
          rows={1}
          disabled={busy}
          className={cn(
            "flex-1 resize-none rounded-xl border border-border/60 bg-slate-50",
            "px-3 py-2 text-[13px] leading-relaxed outline-none",
            "focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400/30",
            "placeholder:text-muted-foreground/60 disabled:opacity-50",
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
          className={cn(
            "size-9 rounded-full grid place-items-center shrink-0",
            "bg-indigo-600 text-white shadow-sm",
            "hover:bg-indigo-700 active:scale-95 transition-all",
            "disabled:opacity-40 disabled:pointer-events-none"
          )}
        >
          <ArrowUp className="size-4" />
        </button>
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
  const scope = ScopeHelper.getScopeFromSettings(COPILOT_SETTINGS);
  const request = { scopes: [scope], account };
  const result = await instance.acquireTokenSilent(request);
  return result.accessToken;
}

/** Drain an Activity async-generator and return bot message texts. */
async function collectMessages(
  gen: AsyncGenerator<Activity>
): Promise<string[]> {
  const texts: string[] = [];
  for await (const activity of gen) {
    if (
      activity.type === "message" &&
      activity.from?.role === "bot" &&
      activity.text
    ) {
      texts.push(activity.text);
    }
  }
  return texts;
}

/** Send a setProjectContext event activity; ignore any bot response. */
async function sendEvent(
  client: CopilotStudioClient,
  ctx: ProjectContext
): Promise<void> {
  const activity: Activity = {
    type: "event",
    name: "setProjectContext",
    value: { projectId: ctx.projectId, projectName: ctx.projectName },
  };
  // Consume the generator so the HTTP request completes; responses are
  // intentionally discarded (the topic sets a variable, not a message).
  for await (const _ of client.sendActivityStreaming(activity)) {
    // noop
  }
}
