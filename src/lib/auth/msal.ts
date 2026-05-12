import {
  PublicClientApplication,
  type Configuration,
  type RedirectRequest,
} from "@azure/msal-browser";

/**
 * MSAL configuration for the TYRO International Trade SPA.
 *
 * Auth flow: PKCE redirect (Microsoft's recommendation for SPAs).
 * Token cache: sessionStorage — survives F5 within the tab, gone on close.
 *
 * The Dataverse env URL + user_impersonation scope come from `.env.local`.
 * Dev workflow: `VITE_USE_MOCK=true` bypasses login entirely.
 */

const tenantId = import.meta.env.VITE_AAD_TENANT_ID ?? "";
const clientId = import.meta.env.VITE_AAD_CLIENT_ID ?? "";
const redirectUri =
  import.meta.env.VITE_AAD_REDIRECT_URI ??
  (typeof window !== "undefined" ? window.location.origin : "");

const dataverseScope =
  import.meta.env.VITE_DATAVERSE_SCOPE ??
  (import.meta.env.VITE_DATAVERSE_URL
    ? `${import.meta.env.VITE_DATAVERSE_URL}/user_impersonation`
    : "");

export const msalConfig: Configuration = {
  auth: {
    clientId,
    authority: `https://login.microsoftonline.com/${tenantId}`,
    redirectUri,
    postLogoutRedirectUri: redirectUri,
  },
  cache: {
    cacheLocation: "sessionStorage",
  },
};

/** Login request — opens Microsoft sign-in with required scopes. */
export const loginRequest: RedirectRequest = {
  scopes: ["openid", "profile", "User.Read", dataverseScope].filter(Boolean),
  prompt: "select_account",
};

/** Token request shape used by `acquireToken()`. */
export const dataverseTokenRequest = {
  scopes: dataverseScope ? [dataverseScope] : [],
};

/** Lazy-init MSAL instance — only created when env vars are present. */
let msalInstance: PublicClientApplication | null = null;

export function getMsalInstance(): PublicClientApplication {
  if (!msalInstance) {
    if (!clientId || !tenantId) {
      throw new Error(
        "[auth] VITE_AAD_CLIENT_ID veya VITE_AAD_TENANT_ID tanımlı değil. " +
          ".env.local dosyasını kontrol et."
      );
    }
    msalInstance = new PublicClientApplication(msalConfig);
  }
  return msalInstance;
}

/** Convenience flag — true when MSAL config is complete. */
export const isAuthConfigured = !!(clientId && tenantId && dataverseScope);
