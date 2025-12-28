"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";

const World = dynamic(() => import("@/components/world"), { ssr: false });

export default function RoomClient({ roomId }: { roomId: string }) {
  const router = useRouter();

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <World roomId={roomId} onExit={() => router.push("/")} />
    </div>
  );
}
