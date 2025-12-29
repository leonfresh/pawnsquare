"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";

export default function AuthCallbackPage() {
  const [msg, setMsg] = useState("Signing you in...");

  useEffect(() => {
    let cancelled = false;

    const isPopup =
      typeof window !== "undefined" &&
      (Boolean(window.opener) || window.name === "pawnsquare-oauth");

    (async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const url = new URL(window.location.href);

        // OAuth (PKCE) typically comes back with `?code=...`
        const code = url.searchParams.get("code");
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(
            window.location.href
          );
          if (error) {
            setMsg(error.message);
            return;
          }
        }

        const { data, error } = await supabase.auth.getSession();
        if (cancelled) return;

        if (error) {
          setMsg(error.message);
          return;
        }

        if (!data.session?.user) {
          setMsg("No session found.");
          return;
        }

        if (isPopup) {
          try {
            window.opener?.postMessage(
              { type: "pawnsquare:supabase-auth", ok: true },
              window.location.origin
            );
          } catch {
            // ignore
          }
          try {
            const ch = new BroadcastChannel("pawnsquare-auth");
            ch.postMessage({ type: "pawnsquare:supabase-auth", ok: true });
            ch.close();
          } catch {
            // ignore
          }

          setMsg("Signed in. You can close this window.");
          window.close();
          return;
        }

        // Same-tab flow: navigate back to where the user started.
        let returnTo = "/";
        try {
          const raw = window.localStorage.getItem("pawnsquare:authReturnTo");
          if (raw) returnTo = raw;
          window.localStorage.removeItem("pawnsquare:authReturnTo");
        } catch {
          // ignore
        }

        setMsg("Signed in. Redirecting...");
        window.location.replace(returnTo);
      } catch {
        if (!cancelled) setMsg("Could not complete sign-in.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ fontSize: 14 }}>{msg}</div>
    </main>
  );
}
