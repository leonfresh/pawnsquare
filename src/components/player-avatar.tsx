"use client";

import { getAvatarSystem } from "@/lib/avatarSystem";
import { ThreeAvatar } from "@/components/three-avatar";

export function PlayerAvatar({
  id,
  movingSpeed,
  gender,
  url,
  pose,
}: {
  id?: string;
  movingSpeed?: number;
  gender?: "male" | "female";
  url?: string;
  pose?: "stand" | "sit";
}) {
  const system = getAvatarSystem();

  if (system === "three-avatar") {
    return <ThreeAvatar movingSpeed={movingSpeed ?? 0} url={url} pose={pose} />;
  }

  return null;
}
