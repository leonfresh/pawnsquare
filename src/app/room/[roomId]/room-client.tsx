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
  const [redirecting, setRedirecting] = useState(false);
  const [initialAvatarUrl, setInitialAvatarUrl] = useState<string | undefined>(
    () => {
      try {
        if (typeof window === "undefined") return undefined;
        const v = window.localStorage.getItem("pawnsquare:equippedAvatarUrl");
        const cleaned = (v ?? "").toString().trim();
        return cleaned ? cleaned : undefined;
      } catch {
        return undefined;
      }
    }
  );
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

  // Migration: canonicalize legacy room URLs.
  // - Normal chess base link: /room/main-room -> /room/main-room-ch1
  // - 4P base link: /room/*-4p -> /room/*-4p-ch1
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (/-ch\d+$/i.test(roomId)) return;

    const lower = roomId.toLowerCase();
    const shouldRedirect = lower === "main-room" || lower.endsWith("-4p");
    if (!shouldRedirect) return;

    const nextRoomId = `${roomId}-ch1`;
    setRedirecting(true);
    router.replace(`/room/${encodeURIComponent(nextRoomId)}`);
  }, [roomId, router]);

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
          .select("equipped_theme,equipped_avatar_url")
          .eq("id", user.id)
          .single();

        const equippedTheme = (profile as any)?.equipped_theme;
        const equippedAvatarUrl = (profile as any)?.equipped_avatar_url;
        if (!cancelled) {
          setLobbyType(equippedTheme === "theme_scifi" ? "scifi" : "park");

          if (
            typeof equippedAvatarUrl === "string" &&
            equippedAvatarUrl.trim()
          ) {
            const cleaned = equippedAvatarUrl.trim();
            setInitialAvatarUrl(cleaned);
            try {
              window.localStorage.setItem(
                "pawnsquare:equippedAvatarUrl",
                cleaned
              );
            } catch {
              // ignore
            }
          }

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
      {redirecting ? (
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
      ) : worldReady ? (
        <World
          roomId={roomId}
          initialName={initialName}
          initialAvatarUrl={initialAvatarUrl}
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
