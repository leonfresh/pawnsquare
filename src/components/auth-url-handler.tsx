"use client";

import { useEffect } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";

export function AuthUrlHandler() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Only attempt popup auto-close behavior for windows we opened.
    const isPopup =
      Boolean(window.opener) || window.name === "pawnsquare-oauth";
    if (!isPopup) return;

    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    const hash = url.hash || "";
    const hasHashTokens =
      hash.includes("access_token=") ||
      hash.includes("refresh_token=") ||
      hash.includes("error=");

    if (!code && !error && !hasHashTokens) return;

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
                {
                  type: "pawnsquare:supabase-auth",
                  ok: false,
                  error: error.message,
                },
                window.location.origin
              );
            } catch {
              // ignore
            }
            return;
          }
        }

        // If the provider returned tokens in the hash (implicit flow), Supabase client will
        // typically parse them when detectSessionInUrl is enabled. Fetch session to ensure it's stored.
        if (hasHashTokens) {
          await supabase.auth.getSession();
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
