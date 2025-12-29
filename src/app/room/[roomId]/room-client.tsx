"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { OAuthPopupGuard } from "@/components/oauth-popup-guard";

const World = dynamic(() => import("@/components/world"), { ssr: false });

export default function RoomClient({ roomId }: { roomId: string }) {
  const router = useRouter();

  // If this window is the OAuth popup, never mount the 3D world.
  if (typeof window !== "undefined" && window.name === "pawnsquare-oauth") {
    return <OAuthPopupGuard />;
  }

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <World roomId={roomId} onExit={() => router.push("/")} />
    </div>
  );
}
