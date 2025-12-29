"use client";

import { useEffect } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";

export function AuthUrlHandler() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Only attempt popup auto-close behavior for windows we opened.
    const isPopup = Boolean(window.opener) || window.name === "pawnsquare-oauth";
    if (!isPopup) return;

    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    if (!code && !error) return;

    let cancelled = false;

    (async () => {
      try {
        const supabase = getSupabaseBrowserClient();

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(
            window.location.href
          );
          if (cancelled) return;
          if (error) {
            try {
              window.opener?.postMessage(
                { type: "pawnsquare:supabase-auth", ok: false, error: error.message },
                window.location.origin
              );
            } catch {
              // ignore
            }
            return;
          }
        }

        try {
          window.opener?.postMessage(
            { type: "pawnsquare:supabase-auth", ok: true },
            window.location.origin
          );
        } catch {
          // ignore
        }

        window.close();
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
