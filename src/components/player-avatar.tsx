"use client";

import { getAvatarSystem } from "@/lib/avatarSystem";
import { ThreeAvatar } from "@/components/three-avatar";

export function PlayerAvatar({
  id,
  movingSpeed,
  gender,
  url,
}: {
  id?: string;
  movingSpeed?: number;
  gender?: "male" | "female";
  url?: string;
}) {
  const system = getAvatarSystem();

  if (system === "three-avatar") {
    return <ThreeAvatar movingSpeed={movingSpeed ?? 0} url={url} />;
  }

  return null;
}
