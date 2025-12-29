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

    const u = new URL(window.location.href);
    const hasParams =
      Boolean(u.searchParams.get("code")) ||
      Boolean(u.searchParams.get("error")) ||
      (u.hash || "").includes("access_token=") ||
      (u.hash || "").includes("refresh_token=") ||
      (u.hash || "").includes("error=");

    // Run if:
    // 1. Window name matches our popup
    // 2. OR we have OAuth params and this was recently opened as a popup
    // 3. OR we have OAuth params and window.opener exists
    return (
      window.name === "pawnsquare-oauth" ||
      (hasParams && isRecentOAuthPopup()) ||
      (hasParams && Boolean(window.opener))
    );
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
          // Exchange the code here. Even though we might see a PKCE error in console,
          // the session still gets stored in localStorage (shared with main window).
          const supabase = getSupabaseBrowserClient();
          try {
            await supabase.auth.exchangeCodeForSession(window.location.href);
          } catch (e) {
            // Ignore PKCE errors - session is still persisted to localStorage
            console.log("[OAuthPopup] Exchange error (ignoring):", e);
          }

          // Notify main window to refresh its auth state
          notify({ type: "pawnsquare:supabase-auth", ok: true });
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
