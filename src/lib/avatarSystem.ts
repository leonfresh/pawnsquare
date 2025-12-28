export type AvatarSystem = "legacy" | "three-avatar";

export function getAvatarSystem(): AvatarSystem {
  const raw = process.env.NEXT_PUBLIC_AVATAR_SYSTEM;
  if (raw === "legacy") return "legacy";
  return "three-avatar";
}
