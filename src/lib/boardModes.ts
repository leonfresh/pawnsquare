/**
 * PawnSquare Board Modes (Single Source of Truth)
 *
 * Goal: adding a new mode should NOT require editing both “park” and “scifi” worlds.
 *
 * This file is the canonical registry for:
 * - which modes exist (`key`)
 * - how the UI labels them (`label`, `icon`)
 * - which gameplay engine powers them (`engine`)
 * - any engine-specific variant config (e.g. `chessVariant`)
 *
 * How modes flow through the app:
 * - UI (World modal) renders mode buttons from `BOARD_MODE_DEFS`.
 * - Networking (Party room) stores `BoardMode` values as strings.
 * - 3D boards (park/scifi) route by `engineForMode(mode)`:
 *   - `engine === "chess"` -> `useChessGame({ variant: chessVariantForMode(mode) })`
 *   - `engine === "checkers"` -> `useCheckersGame()`
 *
 * Adding a new mode:
 * 1) Add an entry to `BOARD_MODE_DEFS`.
 * 2) If it’s another chess-like variant, set `engine: "chess"` and a new `chessVariant`.
 * 3) If it’s a new engine, add a new engine type + hook and update the boards’ routing.
 *
 * Keep `BoardMode` derived from `BOARD_MODE_DEFS` so we never maintain a separate union.
 */
export const BOARD_MODE_DEFS = [
  {
    key: "chess",
    label: "Chess",
    icon: "♔",
    engine: "chess",
    chessVariant: "standard",
  },
  {
    key: "puzzleRush",
    label: "Puzzle Rush",
    icon: "⚡",
    engine: "chess",
    chessVariant: "standard",
  },
  {
    key: "checkers",
    label: "Checkers",
    icon: "⬤",
    engine: "checkers",
  },
  {
    key: "goose",
    label: "Goose",
    icon: "🪿",
    engine: "chess",
    chessVariant: "goose",
  },
] as const;

export type BoardModeDefinition = (typeof BOARD_MODE_DEFS)[number];

export type BoardEngine = BoardModeDefinition["engine"];

export type BoardMode = BoardModeDefinition["key"];

export function isBoardMode(value: unknown): value is BoardMode {
  return BOARD_MODE_DEFS.some((d) => d.key === value);
}

export function getBoardModeDef(mode: BoardMode): BoardModeDefinition {
  const found = BOARD_MODE_DEFS.find((d) => d.key === mode);
  return found ?? BOARD_MODE_DEFS[0]!;
}

export function engineForMode(mode: BoardMode): BoardEngine {
  return getBoardModeDef(mode).engine;
}

export function isGooseMode(mode: BoardMode): boolean {
  return mode === "goose";
}

export function chessVariantForMode(mode: BoardMode): "standard" | "goose" {
  const def = getBoardModeDef(mode);
  if (def.engine !== "chess") return "standard";
  return def.chessVariant ?? "standard";
}
