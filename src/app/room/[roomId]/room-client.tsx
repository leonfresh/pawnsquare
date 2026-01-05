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
  const [initialName] = useState<string | undefined>(() => {
    try {
      if (typeof window === "undefined") return undefined;
      const savedSession =
        window.sessionStorage.getItem("pawnsquare:name") ?? "";
      const cleanedSession = savedSession.trim().slice(0, 24);
      if (cleanedSession) return cleanedSession;

      const rawUser = window.localStorage.getItem("pawnsquare-user");
      if (!rawUser) return undefined;
      const parsed = JSON.parse(rawUser);
      const cleanedLocal = (parsed?.username ?? parsed?.name ?? "")
        .toString()
        .trim()
        .slice(0, 24);
      if (!cleanedLocal) return undefined;
      try {
        window.sessionStorage.setItem("pawnsquare:name", cleanedLocal);
      } catch {
        // ignore
      }
      return cleanedLocal;
    } catch {
      return undefined;
    }
  });

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
          initialName={initialName}
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
