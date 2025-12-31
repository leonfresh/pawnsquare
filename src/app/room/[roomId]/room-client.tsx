"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { OAuthPopupGuard } from "@/components/oauth-popup-guard";

const World = dynamic(() => import("@/components/world"), { ssr: false });

export default function RoomClient({ roomId }: { roomId: string }) {
  const router = useRouter();
  const [lobbyType, setLobbyType] = useState<"park" | "scifi">("park");

  // If this window is the OAuth popup, never mount the 3D world.
  if (typeof window !== "undefined" && window.name === "pawnsquare-oauth") {
    return <OAuthPopupGuard />;
  }

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <World
        roomId={roomId}
        lobbyType={lobbyType}
        onLobbyChange={setLobbyType}
        onExit={() => router.push("/")}
      />
    </div>
  );
}
