import * as React from "react";
import ReactWebChat, { createDirectLine, createStore } from "botframework-webchat";

const TOKEN_URL =
  "https://zpujifdpjwwjqlezxfxp.supabase.co/functions/v1/get-copilot-token";

const SUPABASE_ANON_KEY: string =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? "";

const STYLE_OPTIONS = {
  hideUploadButton: true,
  bubbleBorderRadius: 12,
  bubbleFromUserBorderRadius: 12,
  bubbleFromUserBackground: "#6366f1",
  bubbleFromUserTextColor: "#ffffff",
  bubbleBackground: "#f1f5f9",
  bubbleTextColor: "#0f172a",
  primaryFont: "Inter Variable, Inter, system-ui, sans-serif",
  bubbleBorderColor: "transparent",
  bubbleFromUserBorderColor: "transparent",
  backgroundColor: "#ffffff",
  sendBoxBackground: "#f8fafc",
  sendBoxBorderBottom: "1px solid #e2e8f0",
  sendBoxBorderLeft: "1px solid #e2e8f0",
  sendBoxBorderRight: "1px solid #e2e8f0",
  sendBoxBorderTop: "1px solid #e2e8f0",
  sendBoxButtonColor: "#6366f1",
  sendBoxButtonColorOnFocus: "#4f46e5",
  sendBoxButtonColorOnHover: "#4f46e5",
  sendBoxTextWrap: true,
  timestampFormat: "relative" as const,
};

export interface ProjectContext {
  projectId: string;
  projectName: string;
}

interface ProjectWebChatProps {
  /** When provided, dispatches a setProjectContext event to the bot. */
  projectContext?: ProjectContext;
}

/**
 * Renders a botframework-webchat panel connected to Copilot Studio via
 * Direct Line. When `projectContext` is provided (user is on a project
 * detail route) it dispatches a `setProjectContext` event to the bot
 * after the first incoming agent message — this is when the Copilot
 * runtime is confirmed ready. Subsequent prop changes (user switches
 * projects without closing the drawer) re-dispatch the event without
 * resetting the conversation.
 */
export function ProjectWebChat({ projectContext }: ProjectWebChatProps) {
  const [directLine, setDirectLine] = React.useState<ReturnType<
    typeof createDirectLine
  > | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Holds the webchat Redux store so we can dispatch into it from effects.
  const storeRef = React.useRef<ReturnType<typeof createStore> | null>(null);
  // Set to true after first incoming agent message — gate for sending context.
  const connectedRef = React.useRef(false);
  // Always tracks the latest context without triggering store recreation.
  const contextRef = React.useRef<ProjectContext | undefined>(projectContext);

  // Keep contextRef in sync with prop changes.
  React.useEffect(() => {
    contextRef.current = projectContext;
  }, [projectContext]);

  // Re-send context whenever projectContext changes AND bot is already ready.
  React.useEffect(() => {
    if (!connectedRef.current || !storeRef.current || !projectContext) return;
    storeRef.current.dispatch({
      type: "WEB_CHAT/SEND_EVENT",
      payload: {
        name: "setProjectContext",
        value: {
          projectId: projectContext.projectId,
          projectName: projectContext.projectName,
        },
      },
    });
  }, [projectContext?.projectId, projectContext?.projectName]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const headers: Record<string, string> = {};
        if (SUPABASE_ANON_KEY) headers["apikey"] = SUPABASE_ANON_KEY;

        const res = await fetch(TOKEN_URL, { headers });
        if (!res.ok) throw new Error(`Token alınamadı (HTTP ${res.status})`);

        const data = (await res.json()) as { token?: string };
        if (!data.token) throw new Error("Geçersiz token yanıtı");
        if (cancelled) return;

        // Build Redux middleware that sends project context once the
        // agent runtime signals readiness via its first message activity.
        const store = createStore(
          {},
          ({ dispatch }: { dispatch: (a: unknown) => void }) =>
            (next: (a: unknown) => unknown) =>
            (action: { type: string; payload?: { activity?: { type?: string; from?: { role?: string } } } }) => {
              if (
                action.type === "DIRECT_LINE/INCOMING_ACTIVITY" &&
                action.payload?.activity?.type === "message" &&
                !connectedRef.current
              ) {
                connectedRef.current = true;
                const ctx = contextRef.current;
                if (ctx) {
                  dispatch({
                    type: "WEB_CHAT/SEND_EVENT",
                    payload: {
                      name: "setProjectContext",
                      value: {
                        projectId: ctx.projectId,
                        projectName: ctx.projectName,
                      },
                    },
                  });
                }
              }
              return next(action);
            }
        );

        storeRef.current = store;
        setDirectLine(createDirectLine({ token: data.token }));
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Bağlantı hatası");
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
    // Intentionally empty deps — store + directLine are created once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-[13px] font-medium text-slate-700">Bağlantı kurulamadı</p>
        <p className="text-[11.5px] text-muted-foreground leading-relaxed">{error}</p>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setDirectLine(null);
            connectedRef.current = false;
            storeRef.current = null;
          }}
          className="mt-1 text-[12px] font-medium text-indigo-600 hover:text-indigo-700 underline-offset-2 hover:underline"
        >
          Tekrar dene
        </button>
      </div>
    );
  }

  if (!directLine || !storeRef.current) {
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
    <div className="h-full w-full">
      <ReactWebChat
        directLine={directLine}
        store={storeRef.current}
        styleOptions={STYLE_OPTIONS}
        locale="tr-TR"
      />
    </div>
  );
}
