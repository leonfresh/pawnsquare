"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";

function isRecentOAuthPopup() {
  try {
    const markerRaw = window.localStorage.getItem(
      "pawnsquare:oauthPopupStartedAt"
    );
    const markerMs = Number(markerRaw ?? "0") || 0;
    return markerMs > 0 && Date.now() - markerMs < 10 * 60 * 1000;
  } catch {
    return false;
  }
}

export function OAuthPopupGuard() {
  const [msg, setMsg] = useState("Signing you in...");

  const shouldRun = useMemo(() => {
    if (typeof window === "undefined") return false;
    if (window.name !== "pawnsquare-oauth") return false;

    const u = new URL(window.location.href);
    const hasParams =
      Boolean(u.searchParams.get("code")) ||
      Boolean(u.searchParams.get("error")) ||
      (u.hash || "").includes("access_token=") ||
      (u.hash || "").includes("refresh_token=") ||
      (u.hash || "").includes("error=");

    return hasParams || isRecentOAuthPopup();
  }, []);

  useEffect(() => {
    if (!shouldRun) return;

    let cancelled = false;

    const notify = (payload: any) => {
      try {
        window.opener?.postMessage(payload, window.location.origin);
      } catch {
        // ignore
      }
      try {
        const ch = new BroadcastChannel("pawnsquare-auth");
        ch.postMessage(payload);
        ch.close();
      } catch {
        // ignore
      }
    };

    const tryCloseLoop = () => {
      let tries = 0;
      const t = window.setInterval(() => {
        tries++;
        try {
          window.close();
        } catch {
          // ignore
        }
        if (tries >= 20) {
          window.clearInterval(t);
          setMsg("Signed in. You can close this window.");
        }
      }, 200);
    };

    (async () => {
      try {
        const url = new URL(window.location.href);

        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        const hash = url.hash || "";
        const hasHashTokens =
          hash.includes("access_token=") || hash.includes("refresh_token=");

        if (error) {
          setMsg(`Auth error: ${error}`);
          notify({ type: "pawnsquare:supabase-auth", ok: false, error });
          return;
        }

        if (code) {
          // IMPORTANT: Don't exchange the code in the popup.
          // For PKCE, the code verifier was stored when the flow started (in the main window).
          // Discord returns a code-only callback; exchanging in the popup fails with
          // "PKCE code verifier not found". So we forward the callback URL to the main window.
          const callbackUrl = window.location.href;
          try {
            window.localStorage.setItem(
              "pawnsquare:oauthCallbackUrl",
              callbackUrl
            );
          } catch {
            // ignore
          }
          notify({
            type: "pawnsquare:supabase-auth",
            ok: true,
            code: true,
            callbackUrl,
          });
          setMsg("Signed in. Closing...");

          // Wait a moment for the message to be received before closing
          setTimeout(() => {
            tryCloseLoop();
          }, 500);
          return;
        }

        if (hasHashTokens) {
          // Implicit flow tokens are in the hash; Supabase should auto-persist.
          const supabase = getSupabaseBrowserClient();
          await supabase.auth.getSession();
          notify({ type: "pawnsquare:supabase-auth", ok: true });
          setMsg("Signed in. Closing...");
          tryCloseLoop();
          return;
        }

        // Fallback: if session exists, close anyway.
        const supabase = getSupabaseBrowserClient();
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          notify({ type: "pawnsquare:supabase-auth", ok: true });
          setMsg("Signed in. Closing...");
          tryCloseLoop();
          return;
        }

        setMsg("No session found.");
      } catch {
        if (!cancelled) setMsg("Could not complete sign-in.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [shouldRun]);

  if (!shouldRun) return null;

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ fontSize: 14 }}>{msg}</div>
    </main>
  );
}
