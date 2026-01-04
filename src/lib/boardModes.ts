// Single source of truth for:
// - which modes exist
// - how the UI should label them
// - which underlying engine/hook powers them
export const BOARD_MODE_DEFS = [
  {
    key: "chess",
    label: "Chess",
    icon: "♔",
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
