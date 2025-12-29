"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";

function isRecentOAuthPopup() {
  try {
    const markerRaw = window.localStorage.getItem("pawnsquare:oauthPopupStartedAt");
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
        const supabase = getSupabaseBrowserClient();
        const url = new URL(window.location.href);

        const code = url.searchParams.get("code");
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(
            window.location.href
          );
          if (cancelled) return;
          if (error) {
            setMsg(error.message);
            notify({ type: "pawnsquare:supabase-auth", ok: false, error: error.message });
            return;
          }
        }

        // Make sure session is persisted (covers hash-token returns too).
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;

        if (!data.session) {
          setMsg("No session found.");
          return;
        }

        notify({ type: "pawnsquare:supabase-auth", ok: true });
        setMsg("Signed in. Closing...");

        // Attempt close repeatedly; some browsers delay allowing it.
        tryCloseLoop();
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
