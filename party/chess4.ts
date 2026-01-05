import type * as Party from "partykit/server";

type Color4 = "r" | "g" | "y" | "b";
type Variant4 = "2v2" | "ffa";
type PieceType = "p" | "n" | "b" | "r" | "q" | "k";

type SeatInfo = {
  connId: string;
  playerId: string;
  name: string;
};

type Piece = {
  t: PieceType;
  c: Color4;
  // True when a pawn promoted to a queen; worth 1 point in FFA.
  pp?: true;
};

type ClockState = {
  baseMs: number;
  incrementMs: number;
  remainingMs: Record<Color4, number>;
  running: boolean;
  active: Color4;
  lastTickMs: number | null;
};

type GameResult =
  | { type: "win"; variant: Variant4; winner: Color4 | "ry" | "bg" }
  | { type: "timeout"; variant: Variant4; winner: Color4 | "ry" | "bg" };

type Chess4State = {
  variant: Variant4;
  seats: Record<Color4, SeatInfo | null>;
  pieces: Record<string, Piece>;
  defeated: Partial<Record<Color4, true>>;
  scores: Record<Color4, number>;
  turn: Color4;
  seq: number;
  clock: ClockState;
  result: GameResult | null;
  claimable: {
    leader: Color4;
    runnerUp: Color4;
    lead: number;
  } | null;
  lastMove: { from: string; to: string } | null;
};

type Chess4Message =
  | { type: "join"; seat: Color4; playerId?: string; name?: string }
  | { type: "leave"; seat: Color4 }
  | { type: "move"; from: string; to: string }
  | { type: "suggestArrow"; from: string; to: string }
  | { type: "clearArrows" }
  | { type: "claimWin" }
  | { type: "setTime"; baseSeconds: number; incrementSeconds?: number }
  | { type: "setVariant"; variant: Variant4 }
  | { type: "reset" }
  | { type: "state"; state: Chess4State }
  | { type: "teamArrow"; from: string; to: string; by: Color4 }
  | { type: "teamClearArrows"; by: Color4 };

type SeatsMessage = {
  type: "seats";
  seats: Chess4State["seats"];
  seq: number;
};

const DEFAULT_TIME_SECONDS = 5 * 60;
const MIN_TIME_SECONDS = 30;
const MAX_TIME_SECONDS = 60 * 60;
const MIN_INCREMENT_SECONDS = 0;
const MAX_INCREMENT_SECONDS = 60;

const AUTO_RESET_AFTER_TIMEOUT_MS = 60 * 1000;

const ORDER: readonly Color4[] = ["r", "g", "y", "b"];

const FILES_14 = "abcdefghijklmn" as const;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function teamOf(c: Color4): "ry" | "bg" {
  return c === "r" || c === "y" ? "ry" : "bg";
}

function isFriendly(variant: Variant4, a: Color4, b: Color4) {
  if (a === b) return true;
  if (variant === "2v2") return teamOf(a) === teamOf(b);
  return false;
}

function isValidCoord(f: number, r: number) {
  if (f < 0 || f > 13 || r < 0 || r > 13) return false;
  const inLeft = f <= 2;
  const inRight = f >= 11;
  const inBottom = r <= 2;
  const inTop = r >= 11;
  // Remove 3x3 corners.
  if (
    (inLeft && inBottom) ||
    (inLeft && inTop) ||
    (inRight && inBottom) ||
    (inRight && inTop)
  )
    return false;
  return true;
}

function sqKey(f: number, r: number) {
  return `${f},${r}`;
}

function parseSquare(sq: string): { f: number; r: number } | null {
  // Accept algebraic like a1..n14
  const m = /^([a-n])(\d{1,2})$/i.exec(sq);
  if (!m) return null;
  const fileCh = m[1].toLowerCase();
  const rankNum = Number(m[2]);
  if (!Number.isFinite(rankNum)) return null;
  if (rankNum < 1 || rankNum > 14) return null;
  const f = FILES_14.indexOf(fileCh as (typeof FILES_14)[number]);
  if (f < 0) return null;
  const r = rankNum - 1;
  if (!isValidCoord(f, r)) return null;
  return { f, r };
}

function toSquare(f: number, r: number) {
  const file = FILES_14[f] ?? "a";
  return `${file}${r + 1}`;
}

function initialPieces(): Record<string, Piece> {
  const pieces: Record<string, Piece> = {};
  const place = (f: number, r: number, c: Color4, t: PieceType) => {
    pieces[sqKey(f, r)] = { c, t };
  };

  // Files/ranks for the 8-wide arms are 3..10.
  const arm = [3, 4, 5, 6, 7, 8, 9, 10];
  const back: PieceType[] = ["r", "n", "b", "q", "k", "b", "n", "r"];

  // Red (top), moving south.
  for (let i = 0; i < 8; i++) {
    place(arm[i]!, 13, "r", back[i]!);
    place(arm[i]!, 12, "r", "p");
  }

  // Yellow (bottom), moving north.
  for (let i = 0; i < 8; i++) {
    place(arm[i]!, 0, "y", back[i]!);
    place(arm[i]!, 1, "y", "p");
  }

  // Blue (left), moving east.
  for (let i = 0; i < 8; i++) {
    place(0, arm[i]!, "b", back[i]!);
    place(1, arm[i]!, "b", "p");
  }

  // Green (right), moving west.
  for (let i = 0; i < 8; i++) {
    place(13, arm[i]!, "g", back[i]!);
    place(12, arm[i]!, "g", "p");
  }

  return pieces;
}

function initialClock(baseMs: number, incrementMs = 0): ClockState {
  return {
    baseMs,
    incrementMs,
    remainingMs: { r: baseMs, g: baseMs, y: baseMs, b: baseMs },
    running: false,
    active: "r",
    lastTickMs: null,
  };
}

function nextTurn(
  current: Color4,
  defeated: Partial<Record<Color4, true>>
): Color4 {
  const idx = ORDER.indexOf(current);
  for (let step = 1; step <= ORDER.length; step++) {
    const c = ORDER[(idx + step) % ORDER.length]!;
    if (!defeated[c]) return c;
  }
  return current;
}

function forwardDelta(c: Color4): { df: number; dr: number } {
  switch (c) {
    case "r":
      return { df: 0, dr: -1 };
    case "y":
      return { df: 0, dr: 1 };
    case "b":
      return { df: 1, dr: 0 };
    case "g":
      return { df: -1, dr: 0 };
  }
}

function pawnStart(c: Color4, f: number, r: number) {
  if (c === "r") return r === 12;
  if (c === "y") return r === 1;
  if (c === "b") return f === 1;
  return f === 12;
}

function pawnPromotes(variant: Variant4, c: Color4, f: number, r: number) {
  // 4-player chess promotion is not on the far edge.
  // - FFA: “middle” (8th-rank area). On an even-sized 14x14, the middle is a
  //   2-square-wide band.
  // - 2v2: 11th rank from the player's home edge.
  //
  // Rank counts from each player's home edge:
  //   Red: r=13 is rank 1, pawn start r=12 is rank 2.
  //   Yellow: r=0 is rank 1, pawn start r=1 is rank 2.
  //   Blue: f=0 is rank 1, pawn start f=1 is rank 2.
  //   Green: f=13 is rank 1, pawn start f=12 is rank 2.

  if (variant === "ffa") {
    // Central band: indices 6 and 7 are the two middle ranks/files on 0..13.
    // Vertical movers (red/yellow) promote on the two middle ranks.
    // Horizontal movers (blue/green) promote on the two middle files.
    if (c === "r" || c === "y") return r === 6 || r === 7;
    return f === 6 || f === 7;
  }

  const targetRank = 11;
  if (c === "r") return 14 - r === targetRank; // rank = 14 - r
  if (c === "y") return r + 1 === targetRank; // rank = r + 1
  if (c === "b") return f + 1 === targetRank; // rank = f + 1
  return 14 - f === targetRank; // green: rank = 14 - f
}

function pieceValue(p: Piece): number {
  if (p.t === "p") return 1;
  if (p.pp) return 1; // promoted pawn (queen) still worth 1
  switch (p.t) {
    case "n":
      return 3;
    case "b":
      return 5;
    case "r":
      return 5;
    case "q":
      return 9;
    case "k":
      return 0;
  }
}

function findKingSquare(
  pieces: Record<string, Piece>,
  color: Color4
): { f: number; r: number } | null {
  for (const [k, p] of Object.entries(pieces)) {
    if (p.c !== color) continue;
    if (p.t !== "k") continue;
    const [fStr, rStr] = k.split(",");
    const f = Number(fStr);
    const r = Number(rStr);
    if (!Number.isFinite(f) || !Number.isFinite(r)) continue;
    return { f, r };
  }
  return null;
}

function pawnAttackSquares(from: { f: number; r: number }, c: Color4) {
  const { df, dr } = forwardDelta(c);
  if (df === 0) {
    return [
      { f: from.f - 1, r: from.r + dr },
      { f: from.f + 1, r: from.r + dr },
    ];
  }
  return [
    { f: from.f + df, r: from.r - 1 },
    { f: from.f + df, r: from.r + 1 },
  ];
}

function isSquareAttacked(
  pieces: Record<string, Piece>,
  target: { f: number; r: number },
  by: Color4,
  defeated: Partial<Record<Color4, true>>
): boolean {
  if (defeated[by]) return false;
  const at = (f: number, r: number) => pieces[sqKey(f, r)] ?? null;

  for (const [k, p] of Object.entries(pieces)) {
    if (p.c !== by) continue;
    const [fStr, rStr] = k.split(",");
    const f0 = Number(fStr);
    const r0 = Number(rStr);
    if (!Number.isFinite(f0) || !Number.isFinite(r0)) continue;
    const from = { f: f0, r: r0 };

    if (p.t === "p") {
      for (const s of pawnAttackSquares(from, by)) {
        if (!isValidCoord(s.f, s.r)) continue;
        if (s.f === target.f && s.r === target.r) return true;
      }
      continue;
    }

    if (p.t === "n") {
      const deltas = [
        { df: 1, dr: 2 },
        { df: 2, dr: 1 },
        { df: 2, dr: -1 },
        { df: 1, dr: -2 },
        { df: -1, dr: -2 },
        { df: -2, dr: -1 },
        { df: -2, dr: 1 },
        { df: -1, dr: 2 },
      ];
      for (const d of deltas) {
        const ff = from.f + d.df;
        const rr = from.r + d.dr;
        if (!isValidCoord(ff, rr)) continue;
        if (ff === target.f && rr === target.r) return true;
      }
      continue;
    }

    const slideDirs: Array<{ df: number; dr: number }> = [];
    if (p.t === "b" || p.t === "q") {
      slideDirs.push(
        { df: 1, dr: 1 },
        { df: 1, dr: -1 },
        { df: -1, dr: 1 },
        { df: -1, dr: -1 }
      );
    }
    if (p.t === "r" || p.t === "q") {
      slideDirs.push(
        { df: 1, dr: 0 },
        { df: -1, dr: 0 },
        { df: 0, dr: 1 },
        { df: 0, dr: -1 }
      );
    }

    if (p.t === "k") {
      for (let df = -1; df <= 1; df++) {
        for (let dr = -1; dr <= 1; dr++) {
          if (df === 0 && dr === 0) continue;
          const ff = from.f + df;
          const rr = from.r + dr;
          if (!isValidCoord(ff, rr)) continue;
          if (ff === target.f && rr === target.r) return true;
        }
      }
      continue;
    }

    for (const { df, dr } of slideDirs) {
      let ff = from.f + df;
      let rr = from.r + dr;
      while (isValidCoord(ff, rr)) {
        if (ff === target.f && rr === target.r) return true;
        if (at(ff, rr)) break;
        ff += df;
        rr += dr;
      }
    }
  }

  return false;
}

function isInCheck(
  pieces: Record<string, Piece>,
  color: Color4,
  defeated: Partial<Record<Color4, true>>,
  variant: Variant4
) {
  const king = findKingSquare(pieces, color);
  if (!king) return true; // king missing => treat as checked/defeated
  for (const c of ORDER) {
    if (c === color) continue;
    if (variant === "2v2" && teamOf(c) === teamOf(color)) continue;
    if (isSquareAttacked(pieces, king, c, defeated)) return true;
  }
  return false;
}

function applyMoveToPieces(
  pieces: Record<string, Piece>,
  from: { f: number; r: number },
  to: { f: number; r: number },
  variant: Variant4
): { nextPieces: Record<string, Piece>; captured: Piece | null } {
  const fromKey = sqKey(from.f, from.r);
  const toKey = sqKey(to.f, to.r);
  const moving = pieces[fromKey];
  const captured = pieces[toKey] ?? null;
  const nextPieces: Record<string, Piece> = { ...pieces };
  delete nextPieces[fromKey];
  const promote =
    moving?.t === "p" && pawnPromotes(variant, moving.c, to.f, to.r);
  nextPieces[toKey] = promote ? { c: moving!.c, t: "q", pp: true } : moving!;
  return { nextPieces, captured };
}

function escapeMovesForColor(
  pieces: Record<string, Piece>,
  color: Color4,
  defeated: Partial<Record<Color4, true>>,
  variant: Variant4
): Array<{ from: { f: number; r: number }; to: { f: number; r: number } }> {
  if (defeated[color]) return [];
  const out: Array<{
    from: { f: number; r: number };
    to: { f: number; r: number };
  }> = [];
  for (const [k, p] of Object.entries(pieces)) {
    if (p.c !== color) continue;
    const [fStr, rStr] = k.split(",");
    const f0 = Number(fStr);
    const r0 = Number(rStr);
    if (!Number.isFinite(f0) || !Number.isFinite(r0)) continue;
    const from = { f: f0, r: r0 };
    const moves = genMovesForPiece(pieces, from, p, variant);
    for (const to of moves) {
      const { nextPieces } = applyMoveToPieces(pieces, from, to, variant);
      if (!isInCheck(nextPieces, color, defeated, variant)) {
        out.push({ from, to });
      }
    }
  }
  return out;
}

function pseudoMovesForColor(
  pieces: Record<string, Piece>,
  color: Color4,
  defeated: Partial<Record<Color4, true>>,
  variant: Variant4
): Array<{ from: { f: number; r: number }; to: { f: number; r: number } }> {
  if (defeated[color]) return [];
  const out: Array<{
    from: { f: number; r: number };
    to: { f: number; r: number };
  }> = [];
  for (const [k, p] of Object.entries(pieces)) {
    if (p.c !== color) continue;
    const [fStr, rStr] = k.split(",");
    const f0 = Number(fStr);
    const r0 = Number(rStr);
    if (!Number.isFinite(f0) || !Number.isFinite(r0)) continue;
    const from = { f: f0, r: r0 };
    const moves = genMovesForPiece(pieces, from, p, variant);
    for (const to of moves) {
      out.push({ from, to });
    }
  }
  return out;
}

function isCheckmated(
  pieces: Record<string, Piece>,
  color: Color4,
  defeated: Partial<Record<Color4, true>>,
  variant: Variant4
): boolean {
  if (defeated[color]) return false;
  if (!findKingSquare(pieces, color)) return true;
  if (!isInCheck(pieces, color, defeated, variant)) return false;
  return escapeMovesForColor(pieces, color, defeated, variant).length === 0;
}

function genMovesForPiece(
  pieces: Record<string, Piece>,
  from: { f: number; r: number },
  piece: Piece,
  variant: Variant4
): Array<{ f: number; r: number }> {
  const out: Array<{ f: number; r: number }> = [];
  const at = (f: number, r: number) => pieces[sqKey(f, r)] ?? null;
  const addIf = (f: number, r: number) => {
    if (!isValidCoord(f, r)) return;
    const occ = at(f, r);
    if (occ && isFriendly(variant, occ.c, piece.c)) return;
    out.push({ f, r });
  };

  const slide = (dirs: Array<{ df: number; dr: number }>) => {
    for (const { df, dr } of dirs) {
      let f = from.f + df;
      let r = from.r + dr;
      while (isValidCoord(f, r)) {
        const occ = at(f, r);
        if (!occ) {
          out.push({ f, r });
        } else {
          if (!isFriendly(variant, occ.c, piece.c)) out.push({ f, r });
          break;
        }
        f += df;
        r += dr;
      }
    }
  };

  switch (piece.t) {
    case "p": {
      const { df, dr } = forwardDelta(piece.c);
      const f1 = from.f + df;
      const r1 = from.r + dr;
      const canDouble = pawnStart(piece.c, from.f, from.r);
      const f2 = from.f + df * 2;
      const r2 = from.r + dr * 2;
      if (isValidCoord(f1, r1) && !at(f1, r1)) {
        out.push({ f: f1, r: r1 });
        if (canDouble) {
          if (isValidCoord(f2, r2) && !at(f2, r2)) out.push({ f: f2, r: r2 });
        }
      }

      // Captures
      if (df === 0) {
        addIf(from.f - 1, from.r + dr);
        addIf(from.f + 1, from.r + dr);
      } else {
        addIf(from.f + df, from.r - 1);
        addIf(from.f + df, from.r + 1);
      }

      // Remove non-capture pawn diagonals where square is empty.
      return out.filter(({ f, r }) => {
        if (f === f1 && r === r1) return true;
        if (canDouble && f === f2 && r === r2) return true;
        // for captures, require occupied by opponent
        const occ = at(f, r);
        if (!occ) return false;
        return !isFriendly(variant, occ.c, piece.c);
      });
    }
    case "n": {
      const deltas = [
        { df: 1, dr: 2 },
        { df: 2, dr: 1 },
        { df: 2, dr: -1 },
        { df: 1, dr: -2 },
        { df: -1, dr: -2 },
        { df: -2, dr: -1 },
        { df: -2, dr: 1 },
        { df: -1, dr: 2 },
      ];
      for (const d of deltas) addIf(from.f + d.df, from.r + d.dr);
      return out;
    }
    case "b":
      slide([
        { df: 1, dr: 1 },
        { df: 1, dr: -1 },
        { df: -1, dr: 1 },
        { df: -1, dr: -1 },
      ]);
      return out;
    case "r":
      slide([
        { df: 1, dr: 0 },
        { df: -1, dr: 0 },
        { df: 0, dr: 1 },
        { df: 0, dr: -1 },
      ]);
      return out;
    case "q":
      slide([
        { df: 1, dr: 0 },
        { df: -1, dr: 0 },
        { df: 0, dr: 1 },
        { df: 0, dr: -1 },
        { df: 1, dr: 1 },
        { df: 1, dr: -1 },
        { df: -1, dr: 1 },
        { df: -1, dr: -1 },
      ]);
      return out;
    case "k": {
      for (let df = -1; df <= 1; df++) {
        for (let dr = -1; dr <= 1; dr++) {
          if (df === 0 && dr === 0) continue;
          addIf(from.f + df, from.r + dr);
        }
      }
      return out;
    }
  }
}

function broadcast(room: Party.Room, state: Chess4State) {
  room.broadcast(
    JSON.stringify({ type: "state", state } satisfies Chess4Message)
  );
}

function broadcastSeats(room: Party.Room, state: Chess4State) {
  room.broadcast(
    JSON.stringify({
      type: "seats",
      seats: state.seats,
      seq: state.seq,
    } satisfies SeatsMessage)
  );
}

export default class Chess4Server implements Party.Server {
  state: Chess4State;
  timeoutCheck: ReturnType<typeof setInterval> | null = null;
  autoResetTimer: ReturnType<typeof setTimeout> | null = null;
  autoResetToken = 0;

  constructor(readonly room: Party.Room) {
    const baseMs = DEFAULT_TIME_SECONDS * 1000;
    this.state = {
      variant: "2v2",
      seats: { r: null, g: null, y: null, b: null },
      pieces: initialPieces(),
      defeated: {},
      scores: { r: 0, g: 0, y: 0, b: 0 },
      turn: "r",
      seq: 0,
      clock: initialClock(baseMs, 0),
      result: null,
      claimable: null,
      lastMove: null,
    };

    this.timeoutCheck = setInterval(() => {
      if (!this.state.clock.running) return;
      if (this.state.result) return;
      const now = Date.now();
      this.tickClock(now);
      if (!this.state.result) return;
      this.state.seq++;
      broadcast(this.room, this.state);
      this.scheduleAutoResetAfterTimeout();
    }, 250);
  }

  cancelAutoReset() {
    if (this.autoResetTimer) {
      clearTimeout(this.autoResetTimer);
      this.autoResetTimer = null;
    }
    this.autoResetToken++;
  }

  scheduleAutoResetAfterTimeout() {
    if (this.state.result?.type !== "timeout") return;
    this.cancelAutoReset();

    const token = this.autoResetToken;
    const expectedSeq = this.state.seq;
    const baseMs = this.state.clock.baseMs;
    const incrementMs = this.state.clock.incrementMs;
    const variant = this.state.variant;

    this.autoResetTimer = setTimeout(() => {
      if (token !== this.autoResetToken) return;
      if (this.state.seq !== expectedSeq) return;
      if (this.state.result?.type !== "timeout") return;
      this.resetGame(baseMs, incrementMs, variant);
      this.state.seq++;
      broadcast(this.room, this.state);
    }, AUTO_RESET_AFTER_TIMEOUT_MS);
  }

  resetGame(baseMs: number, incrementMs: number, variant: Variant4) {
    this.state.variant = variant;
    this.state.pieces = initialPieces();
    this.state.defeated = {};
    this.state.scores = { r: 0, g: 0, y: 0, b: 0 };
    this.state.turn = "r";
    this.state.clock = initialClock(baseMs, incrementMs);
    this.state.result = null;
    this.state.claimable = null;
    this.state.lastMove = null;
  }

  tickClock(nowMs: number) {
    const clock = this.state.clock;
    if (!clock.running || clock.lastTickMs === null) return;
    const elapsed = Math.max(0, nowMs - clock.lastTickMs);
    const active = clock.active;
    clock.remainingMs[active] = Math.max(
      0,
      clock.remainingMs[active] - elapsed
    );
    clock.lastTickMs = nowMs;

    if (clock.remainingMs[active] > 0) return;

    // Timeout eliminates the current player.
    this.markDefeated(active);

    const winner = this.computeWinner();
    if (winner) {
      this.state.result = {
        type: "timeout",
        variant: this.state.variant,
        winner,
      };
      clock.running = false;
      clock.lastTickMs = null;
      return;
    }

    const next = nextTurn(active, this.state.defeated);
    this.state.turn = next;
    clock.active = next;
    clock.lastTickMs = nowMs;
  }

  markDefeated(color: Color4) {
    if (this.state.defeated[color]) return;
    this.state.defeated[color] = true;
  }

  computeWinner(): Color4 | "ry" | "bg" | null {
    const alive = ORDER.filter((c) => !this.state.defeated[c]);

    if (this.state.variant === "ffa") {
      // FFA ends when 3 players are defeated.
      if (alive.length === 1) return alive[0]!;
      return null;
    }

    // 2v2 ends on the first checkmate/defeat of an opponent.
    // Winner is the surviving team.
    const ryAlive = alive.some((c) => teamOf(c) === "ry");
    const bgAlive = alive.some((c) => teamOf(c) === "bg");
    if (ryAlive && !bgAlive) return "ry";
    if (bgAlive && !ryAlive) return "bg";
    return null;
  }

  updateFfaClaimable() {
    if (this.state.variant !== "ffa") {
      this.state.claimable = null;
      return;
    }
    if (this.state.result) {
      this.state.claimable = null;
      return;
    }
    const alive = ORDER.filter((c) => !this.state.defeated[c]);
    if (alive.length !== 2) {
      this.state.claimable = null;
      return;
    }
    const [a, b] = alive;
    const sa = this.state.scores[a!];
    const sb = this.state.scores[b!];
    const leader = sa >= sb ? a! : b!;
    const runnerUp = leader === a ? b! : a!;
    const lead = Math.abs(sa - sb);
    this.state.claimable = lead > 20 ? { leader, runnerUp, lead } : null;
  }

  applyImmediateFfaCheckmates(mover: Color4) {
    if (this.state.variant !== "ffa") return;
    for (const c of ORDER) {
      if (this.state.defeated[c]) continue;
      if (isCheckmated(this.state.pieces, c, this.state.defeated, "ffa")) {
        this.markDefeated(c);
        // Checkmate is worth 20 points to the player who delivered it.
        this.state.scores[mover] = (this.state.scores[mover] ?? 0) + 20;
      }
    }
  }

  onConnect(conn: Party.Connection) {
    conn.send(
      JSON.stringify({
        type: "state",
        state: this.state,
      } satisfies Chess4Message)
    );
  }

  onMessage(message: string, sender: Party.Connection) {
    try {
      const msg = JSON.parse(message) as Chess4Message;

      if (msg.type === "claimWin") {
        if (this.state.variant !== "ffa") return;
        if (this.state.result) return;
        if (!this.state.claimable) return;
        const leader = this.state.claimable.leader;
        const seat = this.state.seats[leader];
        if (!seat || seat.connId !== sender.id) return;
        this.state.result = {
          type: "win",
          variant: "ffa",
          winner: leader,
        };
        this.state.clock.running = false;
        this.state.clock.lastTickMs = null;
        this.state.claimable = null;
        this.state.seq++;
        broadcast(this.room, this.state);
        return;
      }

      if (msg.type === "join") {
        const seat = msg.seat;
        if (!seat) return;
        const cur = this.state.seats[seat];
        if (cur && cur.connId !== sender.id) return;
        const playerId =
          typeof msg.playerId === "string" && msg.playerId
            ? msg.playerId
            : sender.id;
        const name =
          typeof msg.name === "string" && msg.name ? msg.name : "Player";
        this.state.seats[seat] = { connId: sender.id, playerId, name };
        this.state.seq++;
        broadcastSeats(this.room, this.state);
        return;
      }

      if (msg.type === "leave") {
        const seat = msg.seat;
        if (!seat) return;
        if (this.state.seats[seat]?.connId !== sender.id) return;
        this.state.seats[seat] = null;
        this.state.seq++;
        broadcastSeats(this.room, this.state);
        return;
      }

      if (msg.type === "setVariant") {
        if (this.state.clock.running) return;
        if (this.state.result) return;
        const anySeatEmpty =
          !this.state.seats.r ||
          !this.state.seats.g ||
          !this.state.seats.y ||
          !this.state.seats.b;
        const senderSeated =
          this.state.seats.r?.connId === sender.id ||
          this.state.seats.g?.connId === sender.id ||
          this.state.seats.y?.connId === sender.id ||
          this.state.seats.b?.connId === sender.id;
        if (!senderSeated && !anySeatEmpty) return;
        const baseMs = this.state.clock.baseMs;
        const incrementMs = this.state.clock.incrementMs;
        const variant = msg.variant;
        if (variant !== "2v2" && variant !== "ffa") return;
        this.cancelAutoReset();
        this.resetGame(baseMs, incrementMs, variant);
        this.state.seq++;
        broadcast(this.room, this.state);
        return;
      }

      if (msg.type === "setTime") {
        if (this.state.clock.running) return;
        if (this.state.result) return;

        const baseSeconds = clamp(
          Math.floor(msg.baseSeconds ?? DEFAULT_TIME_SECONDS),
          MIN_TIME_SECONDS,
          MAX_TIME_SECONDS
        );
        const incrementSeconds = clamp(
          Math.floor(msg.incrementSeconds ?? 0),
          MIN_INCREMENT_SECONDS,
          MAX_INCREMENT_SECONDS
        );

        const baseMs = baseSeconds * 1000;
        const incrementMs = incrementSeconds * 1000;
        this.state.clock = initialClock(baseMs, incrementMs);
        this.state.seq++;
        broadcast(this.room, this.state);
        return;
      }

      if (msg.type === "suggestArrow") {
        if (this.state.variant !== "2v2") return;
        if (this.state.result) return;

        const fromSq = parseSquare(msg.from);
        const toSq = parseSquare(msg.to);
        if (!fromSq || !toSq) return;
        if (fromSq.f === toSq.f && fromSq.r === toSq.r) return;

        // Must be seated to suggest.
        const senderColor = (ORDER.find(
          (c) => this.state.seats[c]?.connId === sender.id
        ) ?? null) as Color4 | null;
        if (!senderColor) return;
        if (this.state.defeated[senderColor]) return;

        const team = teamOf(senderColor);
        const recipients = ORDER.filter((c) => teamOf(c) === team)
          .map((c) => this.state.seats[c]?.connId)
          .filter((id): id is string => !!id);

        const payload = JSON.stringify({
          type: "teamArrow",
          from: msg.from,
          to: msg.to,
          by: senderColor,
        } satisfies Chess4Message);

        for (const connId of recipients) {
          this.room.getConnection(connId)?.send(payload);
        }
        return;
      }

      if (msg.type === "clearArrows") {
        if (this.state.variant !== "2v2") return;

        // Must be seated to clear.
        const senderColor = (ORDER.find(
          (c) => this.state.seats[c]?.connId === sender.id
        ) ?? null) as Color4 | null;
        if (!senderColor) return;
        if (this.state.defeated[senderColor]) return;

        const team = teamOf(senderColor);
        const recipients = ORDER.filter((c) => teamOf(c) === team)
          .map((c) => this.state.seats[c]?.connId)
          .filter((id): id is string => !!id);

        const payload = JSON.stringify({
          type: "teamClearArrows",
          by: senderColor,
        } satisfies Chess4Message);

        for (const connId of recipients) {
          this.room.getConnection(connId)?.send(payload);
        }
        return;
      }

      if (msg.type === "reset") {
        // Allow reset by anyone seated, OR when at least one seat is open.
        const anySeatEmpty =
          !this.state.seats.r ||
          !this.state.seats.g ||
          !this.state.seats.y ||
          !this.state.seats.b;
        const senderSeated =
          this.state.seats.r?.connId === sender.id ||
          this.state.seats.g?.connId === sender.id ||
          this.state.seats.y?.connId === sender.id ||
          this.state.seats.b?.connId === sender.id;
        if (!senderSeated && !anySeatEmpty) return;

        this.cancelAutoReset();
        const baseMs = this.state.clock.baseMs;
        const incrementMs = this.state.clock.incrementMs;
        const variant = this.state.variant;
        this.resetGame(baseMs, incrementMs, variant);
        this.state.seq++;
        broadcast(this.room, this.state);
        return;
      }

      if (msg.type === "move") {
        if (this.state.result) return;

        const fromSq = parseSquare(msg.from);
        const toSq = parseSquare(msg.to);
        if (!fromSq || !toSq) return;

        const nowMs = Date.now();
        // Update clock before processing move.
        if (this.state.clock.running) {
          this.tickClock(nowMs);
          if (this.state.result) {
            this.state.seq++;
            broadcast(this.room, this.state);
            return;
          }
        }

        const turn = this.state.turn;
        const seat = this.state.seats[turn];
        if (!seat || seat.connId !== sender.id) return;
        if (this.state.defeated[turn]) return;

        const fromKey = sqKey(fromSq.f, fromSq.r);
        const moving = this.state.pieces[fromKey];
        if (!moving) return;
        if (moving.c !== turn) return;

        // King-capture rules: moves that leave your king in check are allowed.
        // We validate only pseudo-legal movement + team-friendly capture rules.
        const legal = pseudoMovesForColor(
          this.state.pieces,
          turn,
          this.state.defeated,
          this.state.variant
        );
        if (
          !legal.some(
            (m) =>
              m.from.f === fromSq.f &&
              m.from.r === fromSq.r &&
              m.to.f === toSq.f &&
              m.to.r === toSq.r
          )
        )
          return;

        const toKey = sqKey(toSq.f, toSq.r);
        const captured = this.state.pieces[toKey] ?? null;
        if (captured && isFriendly(this.state.variant, captured.c, moving.c))
          return;

        // Apply move.
        delete this.state.pieces[fromKey];
        const promote =
          moving.t === "p" &&
          pawnPromotes(this.state.variant, moving.c, toSq.f, toSq.r);
        this.state.pieces[toKey] = promote
          ? { c: moving.c, t: "q", pp: true }
          : moving;
        this.state.lastMove = { from: msg.from, to: msg.to };

        // FFA scoring: captures are points (capturing grey/defeated pieces yields 0).
        if (
          this.state.variant === "ffa" &&
          captured &&
          !this.state.defeated[captured.c]
        ) {
          this.state.scores[turn] =
            (this.state.scores[turn] ?? 0) + pieceValue(captured);
        }

        if (captured?.t === "k") {
          // Rare king capture: treat as checkmate/defeat.
          this.markDefeated(captured.c);
          if (this.state.variant === "ffa") {
            this.state.scores[turn] = (this.state.scores[turn] ?? 0) + 20;
          }
        }

        if (this.state.variant === "ffa") {
          // In FFA, checkmates are immediate (no waiting through other turns).
          this.applyImmediateFfaCheckmates(turn);
        }

        // Start clock on first move.
        if (!this.state.clock.running) {
          this.state.clock.running = true;
          this.state.clock.active = turn;
          this.state.clock.lastTickMs = nowMs;
        }

        // Increment for the mover.
        if (this.state.clock.running) {
          this.state.clock.remainingMs[turn] =
            this.state.clock.remainingMs[turn] + this.state.clock.incrementMs;
        }

        const winner = this.computeWinner();
        if (winner) {
          this.state.result = {
            type: "win",
            variant: this.state.variant,
            winner,
          };
          this.state.clock.running = false;
          this.state.clock.lastTickMs = null;
        } else {
          const next = nextTurn(turn, this.state.defeated);
          this.state.turn = next;
          this.state.clock.active = next;
          this.state.clock.lastTickMs = nowMs;

          // In teams, checkmate happens on the player's own turn.
          if (this.state.variant === "2v2") {
            const victim = this.state.turn;
            if (
              isCheckmated(
                this.state.pieces,
                victim,
                this.state.defeated,
                "2v2"
              )
            ) {
              this.markDefeated(victim);
              const teamWinner = teamOf(turn);
              this.state.result = {
                type: "win",
                variant: "2v2",
                winner: teamWinner,
              };
              this.state.clock.running = false;
              this.state.clock.lastTickMs = null;
            }
          }

          this.updateFfaClaimable();
        }

        this.state.seq++;
        broadcast(this.room, this.state);
        return;
      }
    } catch (err) {
      console.error("[Chess4] Error parsing message:", err);
    }
  }

  onClose(conn: Party.Connection) {
    let changed = false;
    for (const seat of ORDER) {
      if (this.state.seats[seat]?.connId === conn.id) {
        this.state.seats[seat] = null;
        changed = true;
      }
    }
    if (changed) {
      this.state.seq++;
      broadcast(this.room, this.state);
    }
  }
}

Chess4Server satisfies Party.Worker;
