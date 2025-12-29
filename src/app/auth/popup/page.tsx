"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";

type Provider = "google" | "discord";

export default function AuthPopupPage() {
  const [msg, setMsg] = useState("Opening sign-in...");

  useEffect(() => {
    const providerRaw = (
      new URL(window.location.href).searchParams.get("provider") ?? ""
    ).toLowerCase();
    const provider = (
      providerRaw === "google" || providerRaw === "discord" ? providerRaw : ""
    ) as Provider | "";

    if (!provider) {
      setMsg("Missing/invalid provider.");
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const redirectTo = `${window.location.origin}/auth/callback`;

        // Important: initiate OAuth INSIDE the popup window.
        // Supabase stores the PKCE verifier in this window's sessionStorage.
        const { error } = await supabase.auth.signInWithOAuth({
          provider,
          options: {
            redirectTo,
          },
        });

        if (cancelled) return;
        if (error) {
          setMsg(error.message);
          return;
        }

        setMsg("Redirecting...");
      } catch {
        if (!cancelled) setMsg("Could not start sign-in.");
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
