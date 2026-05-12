import * as React from "react";
import { useMsal } from "@azure/msal-react";
import {
  InteractionRequiredAuthError,
  InteractionStatus,
} from "@azure/msal-browser";
import { loginRequest } from "@/lib/auth/msal";
import { LoginPage } from "@/pages/LoginPage";

const PP_SCOPE = "https://api.powerplatform.com/.default";

/** sessionStorage flag set BEFORE acquireTokenRedirect for PP consent.
 *  If we return from a redirect and acquireTokenSilent STILL fails, the
 *  consent was dismissed or denied — don't redirect again (infinite loop). */
const PP_CONSENT_ATTEMPTED_KEY = "tyro:ppConsentAttempted";

interface AuthGateProps {
  children: React.ReactNode;
}

/**
 * Two-phase auth gate:
 *   1. Dataverse — standard MSAL redirect via loginRequest.
 *   2. Power Platform — silent token probe after Dataverse session exists.
 *      Missing consent triggers a one-shot acquireTokenRedirect. On return
 *      the silent call succeeds and the app renders.
 *
 * Loop protection: a sessionStorage flag tracks whether we've already
 * redirected for PP consent in this session. If we redirected once and the
 * silent call STILL fails on return, we proceed without PP and let the chat
 * surface its own error — never redirect twice in a single session.
 */
export function AuthGate({ children }: AuthGateProps) {
  const { instance, accounts, inProgress } = useMsal();

  const isAuthenticated = accounts.length > 0;
  // Wait until MSAL is fully idle — covers Startup, Login, AcquireToken,
  // Logout, HandleRedirect. Probing during any of these is a race.
  const msalBusy = inProgress !== InteractionStatus.None;

  const [ppReady, setPpReady] = React.useState(false);

  React.useEffect(() => {
    if (isAuthenticated && !instance.getActiveAccount()) {
      instance.setActiveAccount(accounts[0]);
    }
  }, [accounts, isAuthenticated, instance]);

  React.useEffect(() => {
    if (!isAuthenticated || msalBusy || ppReady) return;
    const account = accounts[0];
    if (!account) return;

    let cancelled = false;

    instance
      .acquireTokenSilent({ scopes: [PP_SCOPE], account })
      .then(() => {
        if (cancelled) return;
        sessionStorage.removeItem(PP_CONSENT_ATTEMPTED_KEY);
        setPpReady(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;

        const code = (err as { errorCode?: string })?.errorCode;
        const needsInteraction =
          err instanceof InteractionRequiredAuthError ||
          code === "interaction_required" ||
          code === "consent_required" ||
          code === "login_required";

        if (!needsInteraction) {
          // Network / config error. Don't block the app — chat will
          // surface its own message if/when the user opens it.
          setPpReady(true);
          return;
        }

        // One-shot redirect: if we already tried in this session and are
        // back here without a token, the consent was dismissed or denied.
        // Proceed without PP so the app at least loads.
        if (sessionStorage.getItem(PP_CONSENT_ATTEMPTED_KEY)) {
          sessionStorage.removeItem(PP_CONSENT_ATTEMPTED_KEY);
          setPpReady(true);
          return;
        }

        sessionStorage.setItem(PP_CONSENT_ATTEMPTED_KEY, "1");
        void instance.acquireTokenRedirect({
          scopes: [PP_SCOPE],
          account,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, msalBusy]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isAuthenticated || msalBusy || !ppReady) {
    return (
      <LoginPage
        onLogin={() => instance.loginRedirect(loginRequest)}
        isLoading={msalBusy || (isAuthenticated && !ppReady)}
      />
    );
  }

  return <>{children}</>;
}
