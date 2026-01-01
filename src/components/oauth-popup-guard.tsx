"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";

export function OAuthPopupGuard() {
  const [msg, setMsg] = useState("Finalizing sign-in...");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const supabase = getSupabaseBrowserClient();

        // Trigger URL parsing / session finalization.
        const { data } = await supabase.auth.getSession();

        if (cancelled) return;

        if (data.session) {
          try {
            const targetOrigin = window.location.origin;
            window.opener?.postMessage(
              { type: "pawnsquare:auth", ok: true },
              targetOrigin
            );
          } catch {
            // ignore
          }

          setMsg("Signed in. You can close this window.");
          // Best effort: close popup windows.
          window.close();
          return;
        }

        setMsg("Sign-in not completed. You can close this window.");
      } catch {
        if (cancelled) return;
        setMsg("Auth not configured in this environment.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      style={{
        padding: 16,
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div style={{ fontSize: 14 }}>{msg}</div>
    </div>
  );
}
