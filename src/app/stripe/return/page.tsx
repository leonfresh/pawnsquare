"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";

function StripeReturnContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("stripe_session_id");
  const [msg, setMsg] = useState("Verifying payment...");

  useEffect(() => {
    if (!sessionId) {
      setMsg("No session ID found.");
      // If cancelled or invalid, just close after a moment
      setTimeout(() => window.close(), 2000);
      return;
    }

    let mounted = true;
    (async () => {
      try {
        const res = await fetch(
          `/api/stripe/verify?session_id=${encodeURIComponent(sessionId)}`
        );
        const data = (await res.json()) as {
          paid?: boolean;
          coins?: number;
          sessionId?: string;
        };

        if (!mounted) return;

        if (data.paid && data.coins && data.sessionId) {
          setMsg("Payment successful! Closing...");
          try {
            window.opener?.postMessage(
              {
                type: "pawnsquare:payment-success",
                coins: data.coins,
                sessionId: data.sessionId,
              },
              "*"
            );
          } catch {
            // ignore
          }
          setTimeout(() => window.close(), 1500);
        } else {
          setMsg("Payment not completed.");
          setTimeout(() => window.close(), 2000);
        }
      } catch {
        if (mounted) setMsg("Error verifying payment.");
      }
    })();

    return () => {
      mounted = false;
    };
  }, [sessionId]);

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
      <p style={{ color: "#666" }}>You can close this window.</p>
    </div>
  );
}

export default function StripeReturnPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <StripeReturnContent />
    </Suspense>
  );
}
