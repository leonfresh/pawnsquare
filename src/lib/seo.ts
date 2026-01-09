export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.pawnsquare.com"
)
  .trim()
  .replace(/\/$/, "");

export const SITE_NAME = "PawnSquare";

export const DEFAULT_DESCRIPTION =
  "Frictionless browser play for Chess, 4‑Player Chess, Goose Chess, and Checkers in a chill metaverse environment.";

export function absoluteUrl(path: string): string {
  const base = SITE_URL;
  if (!path) return base;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}

export const PLAY_URL = "/";
export const PLAY_CHESS_URL = "/room/main-room-ch1";
export const PLAY_4P_URL = "/room/main-room-4p-ch1";
