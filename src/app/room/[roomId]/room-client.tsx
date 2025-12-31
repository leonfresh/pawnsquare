"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { OAuthPopupGuard } from "@/components/oauth-popup-guard";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";

const World = dynamic(() => import("@/components/world"), { ssr: false });

export default function RoomClient({ roomId }: { roomId: string }) {
  const router = useRouter();
  const [lobbyType, setLobbyType] = useState<"park" | "scifi">("park");
  const [worldReady, setWorldReady] = useState(false);

  // If this window is the OAuth popup, never mount the 3D world.
  if (typeof window !== "undefined" && window.name === "pawnsquare-oauth") {
    return <OAuthPopupGuard />;
  }

  // Decide the correct lobby BEFORE mounting the heavy 3D world.
  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data: auth } = await supabase.auth.getUser();
        const user = auth.user;
        if (!user) {
          if (!cancelled) setWorldReady(true);
          return;
        }

        const { data: profile } = await supabase
          .from("profiles")
          .select("equipped_theme")
          .eq("id", user.id)
          .single();

        const equippedTheme = (profile as any)?.equipped_theme;
        if (!cancelled) {
          setLobbyType(equippedTheme === "theme_scifi" ? "scifi" : "park");
          setWorldReady(true);
        }
      } catch {
        if (!cancelled) setWorldReady(true);
      }
    };

    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      {worldReady ? (
        <World
          roomId={roomId}
          lobbyType={lobbyType}
          onLobbyChange={setLobbyType}
          onExit={() => router.push("/")}
        />
      ) : (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#000",
            color: "#fff",
            fontFamily: "system-ui, -apple-system, sans-serif",
            fontSize: "16px",
            opacity: 0.9,
          }}
        >
          Loading world…
        </div>
      )}
    </div>
  );
}
