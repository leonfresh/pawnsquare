import { Chess, type Square } from "chess.js";

export type Side = "w" | "b";
export type GoosePhase = "piece" | "goose";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const CENTER_4 = new Set<Square>(["d4", "e4", "d5", "e5"]);

function otherSide(side: Side): Side {
  return side === "w" ? "b" : "w";
}

function isOnBoard(file: number, rank: number) {
  return file >= 0 && file < 8 && rank >= 1 && rank <= 8;
}

export function isCenter4(square: Square) {
  return CENTER_4.has(square);
}

export function adjacentSquares(square: Square): Square[] {
  const f0 = square.charCodeAt(0) - 97;
  const r0 = Number(square[1]);
  const out: Square[] = [];

  for (let df = -1; df <= 1; df++) {
    for (let dr = -1; dr <= 1; dr++) {
      if (df === 0 && dr === 0) continue;
      const f = f0 + df;
      const r = r0 + dr;
      if (!isOnBoard(f, r)) continue;
      const sq = `${FILES[f]}${r}` as Square;
      out.push(sq);
    }
  }

  return out;
}

export function isStartledSquare(
  square: Square,
  gooseSquare: Square | null
): boolean {
  if (!gooseSquare) return false;
  const adj = adjacentSquares(gooseSquare);
  return adj.includes(square);
}

export function parseFenMoveNumber(fen: string): number {
  const parts = (fen ?? "").trim().split(/\s+/);
  const n = Number(parts[5] ?? "1");
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function isGooseJumpableSquare(square: Square, gooseSquare: Square | null) {
  return !!gooseSquare && square === gooseSquare;
}

function findKingSquare(chess: Chess, color: Side): Square | null {
  const board = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = board[r]?.[f];
      if (!p) continue;
      if (p.type !== "k") continue;
      if (p.color !== color) continue;
      const sq = `${FILES[f]}${8 - r}` as Square;
      return sq;
    }
  }
  return null;
}

function attacksByPiece(
  chess: Chess,
  from: Square,
  piece: { type: string; color: Side },
  gooseSquare: Square | null
): Square[] {
  // Treat the goose square as empty for line-of-sight purposes.
  const out: Square[] = [];
  const f0 = from.charCodeAt(0) - 97;
  const r0 = Number(from[1]);

  const add = (f: number, r: number) => {
    if (!isOnBoard(f, r)) return;
    const sq = `${FILES[f]}${r}` as Square;
    out.push(sq);
  };

  const ray = (df: number, dr: number) => {
    let f = f0 + df;
    let r = r0 + dr;
    while (isOnBoard(f, r)) {
      const sq = `${FILES[f]}${r}` as Square;
      out.push(sq);

      const hasPiece = !!chess.get(sq);
      if (hasPiece && !isGooseJumpableSquare(sq, gooseSquare)) break;

      // If it's the goose square (which should never have a piece), keep going.
      f += df;
      r += dr;
    }
  };

  switch (piece.type) {
    case "p": {
      const dir = piece.color === "w" ? 1 : -1;
      add(f0 - 1, r0 + dir);
      add(f0 + 1, r0 + dir);
      break;
    }
    case "n": {
      const deltas = [
        [1, 2],
        [2, 1],
        [2, -1],
        [1, -2],
        [-1, -2],
        [-2, -1],
        [-2, 1],
        [-1, 2],
      ] as const;
      for (const [df, dr] of deltas) add(f0 + df, r0 + dr);
      break;
    }
    case "b": {
      ray(1, 1);
      ray(1, -1);
      ray(-1, 1);
      ray(-1, -1);
      break;
    }
    case "r": {
      ray(1, 0);
      ray(-1, 0);
      ray(0, 1);
      ray(0, -1);
      break;
    }
    case "q": {
      ray(1, 1);
      ray(1, -1);
      ray(-1, 1);
      ray(-1, -1);
      ray(1, 0);
      ray(-1, 0);
      ray(0, 1);
      ray(0, -1);
      break;
    }
    case "k": {
      for (let df = -1; df <= 1; df++) {
        for (let dr = -1; dr <= 1; dr++) {
          if (df === 0 && dr === 0) continue;
          add(f0 + df, r0 + dr);
        }
      }
      break;
    }
  }

  return out;
}

export function gooseIsSquareAttacked(
  chess: Chess,
  target: Square,
  byColor: Side,
  gooseSquare: Square | null
): boolean {
  const board = chess.board();

  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = board[r]?.[f];
      if (!p) continue;
      if (p.color !== byColor) continue;

      const from = `${FILES[f]}${8 - r}` as Square;
      if (isStartledSquare(from, gooseSquare)) continue;

      const attacked = attacksByPiece(chess, from, p as any, gooseSquare);
      if (attacked.includes(target)) return true;
    }
  }

  return false;
}

export function gooseKingInCheck(
  chess: Chess,
  color: Side,
  gooseSquare: Square | null
): boolean {
  const kingSq = findKingSquare(chess, color);
  if (!kingSq) return false;
  return gooseIsSquareAttacked(chess, kingSq, otherSide(color), gooseSquare);
}

function isCastlingThroughGoose(
  from: Square,
  to: Square,
  gooseSquare: Square | null
) {
  if (!gooseSquare) return false;

  if (from === "e1" && to === "g1") return gooseSquare === "f1";
  if (from === "e1" && to === "c1") return gooseSquare === "d1";
  if (from === "e8" && to === "g8") return gooseSquare === "f8";
  if (from === "e8" && to === "c8") return gooseSquare === "d8";

  return false;
}

export type GooseLegalInternalMove = {
  from: Square;
  to: Square;
  promotion?: string;
  captured?: string;
};

export function gooseLegalMovesForSquare(
  chess: Chess,
  from: Square,
  gooseSquare: Square | null
): GooseLegalInternalMove[] {
  // Use public API for pseudo-legal moves, then filter by goose rules.
  const baseMoves = chess.moves({ square: from, verbose: true }) as any[];

  const piece = chess.get(from);
  if (!piece) return [];

  const startled = isStartledSquare(from, gooseSquare);

  const out: GooseLegalInternalMove[] = [];

  for (const mv of baseMoves) {
    const to = mv.to as Square;

    if (gooseSquare && to === gooseSquare) continue;

    // Semi-solid exception for castling: king cannot "pass through" the goose.
    if (piece.type === "k" && isCastlingThroughGoose(from, to, gooseSquare)) {
      continue;
    }

    // Startled pieces cannot capture (including en passant).
    if (startled && mv.captured) continue;

    // Simulate and enforce king-safety under goose attack rules.
    const testChess = new Chess(chess.fen());
    testChess.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
    const inCheck = gooseKingInCheck(
      testChess,
      piece.color as Side,
      gooseSquare
    );

    if (inCheck) continue;

    out.push({
      from: mv.from,
      to: mv.to,
      promotion: mv.promotion,
      captured: mv.captured,
    });
  }

  return out;
}

export function gooseHasAnyLegalMove(
  chess: Chess,
  gooseSquare: Square | null
): boolean {
  const side = chess.turn() as Side;
  const board = chess.board();

  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = board[r]?.[f];
      if (!p) continue;
      if (p.color !== side) continue;

      const from = `${FILES[f]}${8 - r}` as Square;
      const moves = gooseLegalMovesForSquare(chess, from, gooseSquare);
      if (moves.length > 0) return true;
    }
  }

  return false;
}

export function applyGooseMove(
  chess: Chess,
  move: { from: Square; to: Square; promotion?: string }
) {
  const result = chess.move({
    from: move.from,
    to: move.to,
    promotion: move.promotion as any,
  });
  if (!result) {
    throw new Error(`Failed to apply goose move: ${move.from} -> ${move.to}`);
  }
  return result;
}
