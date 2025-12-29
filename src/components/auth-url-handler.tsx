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

    const markerRaw = window.localStorage.getItem(
      "pawnsquare:oauthPopupStartedAt"
    );
    const markerMs = Number(markerRaw ?? "0") || 0;
    const markerFresh = markerMs > 0 && Date.now() - markerMs < 10 * 60 * 1000;

    // If there are no visible auth params, still try a quick session check when this is our OAuth popup.
    // On some setups Supabase may clean the URL after persisting the session.
    if (!code && !error && !hasHashTokens && !markerFresh) return;

    let cancelled = false;

    (async () => {
      try {
        const supabase = getSupabaseBrowserClient();

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

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(
            window.location.href
          );
          if (cancelled) return;
          if (error) {
            notify({
              type: "pawnsquare:supabase-auth",
              ok: false,
              error: error.message,
            });
            return;
          }
        }

        // If the provider returned tokens in the hash (implicit flow), Supabase client will
        // typically parse them when detectSessionInUrl is enabled. Fetch session to ensure it's stored.
        if (hasHashTokens) {
          await supabase.auth.getSession();
        }

        // Fallback: if URL is clean but session exists, close anyway.
        if (!code && !hasHashTokens) {
          const { data } = await supabase.auth.getSession();
          if (!data.session) return;
        }

        notify({ type: "pawnsquare:supabase-auth", ok: true });

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
