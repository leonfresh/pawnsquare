"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";
import Link from "next/link";

export default function MagicLinkPage() {
  const [msg, setMsg] = useState("Verifying magic link...");
  const [countdown, setCountdown] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;

    const announceAuthToOtherTabs = () => {
      try {
        const targetOrigin = window.location.origin;
        window.opener?.postMessage(
          { type: "pawnsquare:auth", ok: true, source: "magic-link" },
          targetOrigin
        );
        window.opener?.focus?.();
      } catch {
        // ignore
      }

      try {
        const bc = new BroadcastChannel("pawnsquare-auth");
        bc.postMessage({ type: "AUTH_OK", t: Date.now() });
        bc.close();
      } catch {
        // ignore
      }

      // Fallback: storage event for tabs that don't get BC.
      try {
        window.localStorage.setItem(
          "pawnsquare:authUpdatedAt",
          String(Date.now())
        );
      } catch {
        // ignore
      }
    };

    const startCloseCountdown = () => {
      announceAuthToOtherTabs();
      setCountdown(3);
      let n = 3;
      const t = window.setInterval(() => {
        n -= 1;
        if (!mounted) {
          window.clearInterval(t);
          return;
        }

        if (n <= 0) {
          window.clearInterval(t);
          try {
            window.close();
          } catch {
            // ignore
          }
          return;
        }

        setCountdown(n);
      }, 1000);
      return () => window.clearInterval(t);
    };

    (async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        // The AuthUrlHandler in layout.tsx should have already triggered session recovery.
        // We just check if we have a session.
        const { data } = await supabase.auth.getSession();

        if (!mounted) return;

        if (data.session) {
          setMsg("Signed in. Returning to PawnSquare...");
          startCloseCountdown();
        } else {
          // Give it a moment in case the hash processing is slightly delayed
          setTimeout(async () => {
            if (!mounted) return;
            const { data: retryData } = await supabase.auth.getSession();
            if (retryData.session) {
              setMsg("Signed in. Returning to PawnSquare...");
              startCloseCountdown();
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

  useEffect(() => {
    try {
      document.title = "PawnSquare";
    } catch {
      // ignore
    }
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
      {countdown !== null ? (
        <p style={{ marginBottom: 16, color: "#666" }}>
          Closing this tab in {countdown}...
        </p>
      ) : null}
      <p style={{ marginBottom: 32, color: "#666" }}>
        If it doesn’t auto-close, switch back to your PawnSquare tab.
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
