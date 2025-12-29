"use client";

import { useEffect, useState } from "react";

export default function StripeReturnPage() {
  const [msg, setMsg] = useState("Finalizing purchase...");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const url = new URL(window.location.href);
        const sessionId =
          url.searchParams.get("stripe_session_id") ||
          url.searchParams.get("session_id");

        if (!sessionId) {
          setMsg("Missing session id.");
          return;
        }

        const res = await fetch(
          `/api/stripe/verify?session_id=${encodeURIComponent(sessionId)}`
        );
        const data = (await res.json()) as {
          paid?: boolean;
          coins?: number;
          sessionId?: string;
        };
        if (cancelled) return;

        if (!data?.paid || !data.sessionId || !data.coins) {
          setMsg("Payment not completed.");
          return;
        }

        try {
          window.opener?.postMessage(
            {
              type: "pawnsquare:stripe-credit",
              ok: true,
              sessionId: data.sessionId,
              coins: data.coins,
            },
            window.location.origin
          );
        } catch {
          // ignore
        }

        setMsg("Purchase complete. You can close this window.");
        window.close();
      } catch {
        if (!cancelled) setMsg("Could not verify payment.");
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
