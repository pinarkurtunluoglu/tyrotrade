import * as React from "react";
import { useMsal } from "@azure/msal-react";
import {
  InteractionRequiredAuthError,
  InteractionStatus,
} from "@azure/msal-browser";
import { loginRequest } from "@/lib/auth/msal";
import { LoginPage } from "@/pages/LoginPage";

const PP_SCOPE = "https://api.powerplatform.com/.default";

interface AuthGateProps {
  children: React.ReactNode;
}

/**
 * Show login UI when no signed-in account; otherwise render children.
 *
 * Two-phase auth:
 *  1. Dataverse login — standard MSAL redirect via loginRequest.
 *  2. Power Platform consent — acquired silently immediately after Dataverse
 *     login. If consent hasn't been granted yet, AuthGate redirects for it
 *     automatically (no user action needed). On return the silent call
 *     succeeds and the app renders as normal.
 *
 * The result: the user clicks "tyroverse ile bağlan" once, sees the
 * connection overlay while both consents are processed, then lands in
 * the app with the chat fully functional.
 */
export function AuthGate({ children }: AuthGateProps) {
  const { instance, accounts, inProgress } = useMsal();

  const isAuthenticated = accounts.length > 0;
  const isLoading =
    inProgress !== InteractionStatus.None &&
    inProgress !== InteractionStatus.HandleRedirect;

  // true once the PP token is confirmed in cache (or a non-interactive
  // failure — network, config — that we shouldn't block the app for).
  const [ppReady, setPpReady] = React.useState(false);

  React.useEffect(() => {
    if (isAuthenticated && !instance.getActiveAccount()) {
      instance.setActiveAccount(accounts[0]);
    }
  }, [accounts, isAuthenticated, instance]);

  // As soon as the Dataverse session is established, probe for a PP token.
  // Silent hit → ppReady immediately. Cache miss / no consent →
  // acquireTokenRedirect fires automatically; on return the token is in
  // cache and the silent call succeeds.
  React.useEffect(() => {
    if (!isAuthenticated || isLoading || ppReady) return;

    instance
      .acquireTokenSilent({ scopes: [PP_SCOPE], account: accounts[0] })
      .then(() => setPpReady(true))
      .catch((err) => {
        if (err instanceof InteractionRequiredAuthError) {
          void instance.acquireTokenRedirect({
            scopes: [PP_SCOPE],
            account: accounts[0],
          });
          // Page is navigating away; don't update state.
        } else {
          // Non-interactive failure (network, misconfiguration).
          // Don't block the app — the chat will surface its own error.
          setPpReady(true);
        }
      });
  }, [isAuthenticated, isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Show the login / connection screen while:
  //  a) not yet authenticated, OR
  //  b) MSAL is mid-flow, OR
  //  c) authenticated but PP probe hasn't resolved yet.
  if (!isAuthenticated || isLoading || !ppReady) {
    return (
      <LoginPage
        onLogin={() => instance.loginRedirect(loginRequest)}
        isLoading={isLoading || (isAuthenticated && !ppReady)}
      />
    );
  }

  return <>{children}</>;
}
