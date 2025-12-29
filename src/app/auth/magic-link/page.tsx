"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";
import Link from "next/link";

export default function MagicLinkPage() {
  const [msg, setMsg] = useState("Verifying magic link...");

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        // The AuthUrlHandler in layout.tsx should have already triggered session recovery.
        // We just check if we have a session.
        const { data } = await supabase.auth.getSession();

        if (!mounted) return;

        if (data.session) {
          setMsg("Success! You are signed in.");
          // Attempt to close the tab after a short delay
          setTimeout(() => {
            window.close();
          }, 2000);
        } else {
          // Give it a moment in case the hash processing is slightly delayed
          setTimeout(async () => {
            if (!mounted) return;
            const { data: retryData } = await supabase.auth.getSession();
            if (retryData.session) {
              setMsg("Success! You are signed in.");
              setTimeout(() => {
                window.close();
              }, 2000);
            } else {
              setMsg(
                "Could not verify session. Please try again or check your email link."
              );
            }
          }, 1000);
        }
      } catch {
        if (mounted) setMsg("Error verifying link.");
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        fontFamily: "system-ui, sans-serif",
        padding: 20,
        textAlign: "center",
        background: "#f5f5f5",
        color: "#333",
      }}
    >
      <h1 style={{ marginBottom: 16 }}>{msg}</h1>
      <p style={{ marginBottom: 32, color: "#666" }}>
        You can close this tab and return to your game.
      </p>
      <Link
        href="/"
        style={{
          color: "white",
          background: "#667eea",
          padding: "12px 24px",
          borderRadius: "8px",
          textDecoration: "none",
          fontWeight: 600,
        }}
      >
        Play in this tab
      </Link>
    </div>
  );
}
