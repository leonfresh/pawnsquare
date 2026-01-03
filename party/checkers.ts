import type * as Party from "partykit/server";

type Side = "w" | "b";

type SeatInfo = {
  connId: string;
  playerId: string;
  name: string;
};

type CheckersPiece = {
  color: Side;
  king: boolean;
};

type Square = string;

type GameResult =
  | { type: "win"; winner: Side }
  | { type: "timeout"; winner: Side };

type ClockState = {
  baseMs: number;
  remainingMs: { w: number; b: number };
  running: boolean;
  active: Side;
  lastTickMs: number | null;
};

type CheckersState = {
  seats: { w: SeatInfo | null; b: SeatInfo | null };
  board: Record<Square, CheckersPiece>;
  turn: Side;
  seq: number;
  clock: ClockState;
  result: GameResult | null;
  lastMove: { from: Square; to: Square; captured: Square[] } | null;
  forcedFrom: Square | null;
};

type CheckersMessage =
  | { type: "join"; side: Side; playerId?: string; name?: string }
  | { type: "leave"; side: Side }
  | { type: "move"; from: Square; to: Square }
  | { type: "setTime"; baseSeconds: number }
  | { type: "reset" }
  | { type: "state"; state: CheckersState };

const DEFAULT_TIME_SECONDS = 5 * 60;
const MIN_TIME_SECONDS = 30;
const MAX_TIME_SECONDS = 60 * 60;
const AUTO_RESET_AFTER_TIMEOUT_MS = 60 * 1000;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function initialClock(baseMs: number): ClockState {
  return {
    baseMs,
    remainingMs: { w: baseMs, b: baseMs },
    running: false,
    active: "w",
    lastTickMs: null,
  };
}

function otherSide(side: Side): Side {
  return side === "w" ? "b" : "w";
}

function isPlayerInSeat(state: CheckersState, connId: string) {
  return state.seats.w?.connId === connId || state.seats.b?.connId === connId;
}

function isSquare(s: string): s is Square {
  if (s.length !== 2) return false;
  const f = s.charCodeAt(0);
  const r = s.charCodeAt(1);
  return f >= 97 && f <= 104 && r >= 49 && r <= 56;
}

function fileIndex(square: Square) {
  return square.charCodeAt(0) - 97;
}

function rankIndex(square: Square) {
  return Number(square[1]) - 1; // 0..7
}

function squareOf(file: number, rank: number): Square {
  const f = String.fromCharCode(97 + file);
  const r = String(rank + 1);
  return `${f}${r}`;
}

function isDarkSquare(square: Square) {
  // a1 is dark in standard chessboard coloring.
  const f = fileIndex(square);
  const r = rankIndex(square);
  return (f + r) % 2 === 0;
}

function initialBoard(): Record<Square, CheckersPiece> {
  const board: Record<Square, CheckersPiece> = {};
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq = squareOf(f, r);
      if (!isDarkSquare(sq)) continue;
      if (r <= 2) {
        // White at ranks 1..3
        board[sq] = { color: "w", king: false };
      } else if (r >= 5) {
        // Black at ranks 6..8
        board[sq] = { color: "b", king: false };
      }
    }
  }
  return board;
}

type MoveCandidate = {
  from: Square;
  to: Square;
  captured: Square[];
  isCapture: boolean;
};

function deltasForPiece(piece: CheckersPiece) {
  // White moves towards higher ranks, black towards lower ranks.
  const forward = piece.color === "w" ? 1 : -1;
  const dirs: Array<[number, number]> = [
    [-1, forward],
    [1, forward],
  ];
  if (piece.king) {
    dirs.push([-1, -forward], [1, -forward]);
  }
  return dirs;
}

function inBounds(file: number, rank: number) {
  return file >= 0 && file < 8 && rank >= 0 && rank < 8;
}

function listCapturesFrom(
  board: Record<Square, CheckersPiece>,
  from: Square,
  piece: CheckersPiece
): MoveCandidate[] {
  const out: MoveCandidate[] = [];
  const f0 = fileIndex(from);
  const r0 = rankIndex(from);
  for (const [df, dr] of deltasForPiece(piece)) {
    const f1 = f0 + df;
    const r1 = r0 + dr;
    const f2 = f0 + df * 2;
    const r2 = r0 + dr * 2;
    if (!inBounds(f2, r2) || !inBounds(f1, r1)) continue;

    const mid = squareOf(f1, r1);
    const to = squareOf(f2, r2);
    if (!isDarkSquare(to)) continue;

    const midPiece = board[mid];
    if (!midPiece) continue;
    if (midPiece.color === piece.color) continue;
    if (board[to]) continue;

    out.push({ from, to, captured: [mid], isCapture: true });
  }
  return out;
}

function listSimpleMovesFrom(
  board: Record<Square, CheckersPiece>,
  from: Square,
  piece: CheckersPiece
): MoveCandidate[] {
  const out: MoveCandidate[] = [];
  const f0 = fileIndex(from);
  const r0 = rankIndex(from);
  for (const [df, dr] of deltasForPiece(piece)) {
    const f1 = f0 + df;
    const r1 = r0 + dr;
    if (!inBounds(f1, r1)) continue;

    const to = squareOf(f1, r1);
    if (!isDarkSquare(to)) continue;
    if (board[to]) continue;

    out.push({ from, to, captured: [], isCapture: false });
  }
  return out;
}

function listAllMoves(
  board: Record<Square, CheckersPiece>,
  side: Side,
  forcedFrom: Square | null
): { moves: MoveCandidate[]; hasAnyCapture: boolean } {
  const moves: MoveCandidate[] = [];
  let hasAnyCapture = false;

  const squares = forcedFrom ? [forcedFrom] : Object.keys(board);
  for (const sq of squares) {
    const piece = board[sq];
    if (!piece) continue;
    if (piece.color !== side) continue;

    const caps = listCapturesFrom(board, sq, piece);
    if (caps.length) {
      hasAnyCapture = true;
      moves.push(...caps);
    }
  }

  if (hasAnyCapture) {
    return { moves, hasAnyCapture: true };
  }

  // No captures anywhere; allow simple moves.
  for (const sq of squares) {
    const piece = board[sq];
    if (!piece) continue;
    if (piece.color !== side) continue;

    moves.push(...listSimpleMovesFrom(board, sq, piece));
  }

  return { moves, hasAnyCapture: false };
}

function shouldKing(piece: CheckersPiece, to: Square) {
  const rank = Number(to[1]);
  return (
    !piece.king &&
    ((piece.color === "w" && rank === 8) || (piece.color === "b" && rank === 1))
  );
}

export default class CheckersServer implements Party.Server {
  state: CheckersState;
  timeoutCheck: ReturnType<typeof setInterval> | null = null;
  autoResetTimer: ReturnType<typeof setTimeout> | null = null;
  autoResetToken = 0;

  constructor(readonly room: Party.Room) {
    const baseMs = DEFAULT_TIME_SECONDS * 1000;
    this.state = {
      seats: { w: null, b: null },
      board: initialBoard(),
      turn: "w",
      seq: 0,
      clock: initialClock(baseMs),
      result: null,
      lastMove: null,
      forcedFrom: null,
    };

    this.timeoutCheck = setInterval(() => {
      if (!this.state.clock.running) return;
      if (this.state.result) return;

      const now = Date.now();
      const { remainingMs } = this.getRemainingWithNow(now);
      const active = this.state.clock.active;
      if (remainingMs[active] > 0) return;

      this.state.clock.remainingMs = remainingMs;
      this.state.clock.running = false;
      this.state.clock.lastTickMs = null;
      this.state.result = { type: "timeout", winner: otherSide(active) };
      this.state.seq++;
      this.room.broadcast(JSON.stringify({ type: "state", state: this.state }));

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

    this.autoResetTimer = setTimeout(() => {
      if (token !== this.autoResetToken) return;
      if (this.state.seq !== expectedSeq) return;
      if (this.state.result?.type !== "timeout") return;

      this.resetGame(baseMs);
      this.state.seq++;
      this.room.broadcast(JSON.stringify({ type: "state", state: this.state }));
    }, AUTO_RESET_AFTER_TIMEOUT_MS);
  }

  getRemainingWithNow(nowMs: number) {
    const clock = this.state.clock;
    const remainingMs = { ...clock.remainingMs };

    if (!clock.running || clock.lastTickMs === null) {
      return { remainingMs, nowMs };
    }

    const elapsed = Math.max(0, nowMs - clock.lastTickMs);
    const active = clock.active;
    remainingMs[active] = Math.max(0, remainingMs[active] - elapsed);
    return { remainingMs, nowMs };
  }

  startClockIfNeeded(nowMs: number) {
    if (this.state.clock.running) return;
    if (this.state.result) return;
    this.state.clock.running = true;
    this.state.clock.active = this.state.turn;
    this.state.clock.lastTickMs = nowMs;
  }

  applyClockAndMaybeTimeout(nowMs: number) {
    const { remainingMs } = this.getRemainingWithNow(nowMs);
    this.state.clock.remainingMs = remainingMs;
    this.state.clock.lastTickMs = nowMs;

    const active = this.state.clock.active;
    if (remainingMs[active] <= 0 && !this.state.result) {
      this.state.clock.running = false;
      this.state.clock.lastTickMs = null;
      this.state.result = { type: "timeout", winner: otherSide(active) };
      this.scheduleAutoResetAfterTimeout();
      return true;
    }
    return false;
  }

  resetGame(baseMs: number) {
    this.state.board = initialBoard();
    this.state.turn = "w";
    this.state.clock = initialClock(baseMs);
    this.state.result = null;
    this.state.lastMove = null;
    this.state.forcedFrom = null;
  }

  onConnect(conn: Party.Connection) {
    console.log(`[Checkers] Player connected: ${conn.id}`);
    conn.send(JSON.stringify({ type: "state", state: this.state }));
  }

  onMessage(message: string, sender: Party.Connection) {
    try {
      const msg = JSON.parse(message) as CheckersMessage;

      if (msg.type === "join") {
        const seat = msg.side;
        if (
          this.state.seats[seat] &&
          this.state.seats[seat]?.connId !== sender.id
        ) {
          return;
        }

        const playerId =
          typeof msg.playerId === "string" && msg.playerId
            ? msg.playerId
            : sender.id;
        const name =
          typeof msg.name === "string" && msg.name ? msg.name : "Player";
        this.state.seats[seat] = { connId: sender.id, playerId, name };
        this.state.seq++;
        this.room.broadcast(
          JSON.stringify({ type: "state", state: this.state })
        );
      } else if (msg.type === "leave") {
        const seat = msg.side;
        if (this.state.seats[seat]?.connId !== sender.id) return;
        this.state.seats[seat] = null;
        this.state.seq++;
        this.room.broadcast(
          JSON.stringify({ type: "state", state: this.state })
        );
      } else if (msg.type === "setTime") {
        if (!isPlayerInSeat(this.state, sender.id)) return;
        if (this.state.clock.running) return;
        if (this.state.result) return;
        // Only before any move has occurred.
        const isStart =
          this.state.turn === "w" &&
          this.state.forcedFrom === null &&
          this.state.lastMove === null;
        if (!isStart) return;

        const baseSeconds = clamp(
          Math.floor(msg.baseSeconds),
          MIN_TIME_SECONDS,
          MAX_TIME_SECONDS
        );
        const baseMs = baseSeconds * 1000;
        this.cancelAutoReset();
        this.resetGame(baseMs);
        this.state.seq++;
        this.room.broadcast(
          JSON.stringify({ type: "state", state: this.state })
        );
      } else if (msg.type === "reset") {
        if (!isPlayerInSeat(this.state, sender.id)) return;
        const baseMs = this.state.clock.baseMs;
        this.cancelAutoReset();
        this.resetGame(baseMs);
        this.state.seq++;
        this.room.broadcast(
          JSON.stringify({ type: "state", state: this.state })
        );
      } else if (msg.type === "move") {
        if (this.state.result) return;

        const expectedPlayer =
          this.state.turn === "w"
            ? this.state.seats.w?.connId
            : this.state.seats.b?.connId;

        if (expectedPlayer !== sender.id) {
          console.log(`[Checkers] Unauthorized move from ${sender.id}`);
          return;
        }

        const from = msg.from;
        const to = msg.to;
        if (!isSquare(from) || !isSquare(to)) return;
        if (!isDarkSquare(from) || !isDarkSquare(to)) return;

        const piece = this.state.board[from];
        if (!piece) return;
        if (piece.color !== this.state.turn) return;
        if (this.state.forcedFrom && this.state.forcedFrom !== from) return;

        const nowMs = Date.now();
        this.startClockIfNeeded(nowMs);
        if (this.applyClockAndMaybeTimeout(nowMs)) {
          this.state.seq++;
          this.room.broadcast(
            JSON.stringify({ type: "state", state: this.state })
          );
          return;
        }

        const { moves, hasAnyCapture } = listAllMoves(
          this.state.board,
          this.state.turn,
          this.state.forcedFrom
        );

        const candidate = moves.find((m) => m.from === from && m.to === to);
        if (!candidate) {
          console.log(`[Checkers] Invalid move from ${sender.id}`);
          return;
        }

        // Enforce forced capture globally.
        if (hasAnyCapture && !candidate.isCapture) return;

        // Apply move.
        const nextBoard: Record<Square, CheckersPiece> = {
          ...this.state.board,
        };
        delete nextBoard[from];

        let movedPiece: CheckersPiece = { ...piece };
        if (shouldKing(movedPiece, to)) {
          movedPiece.king = true;
        }
        nextBoard[to] = movedPiece;

        const capturedSquares: Square[] = [];
        for (const c of candidate.captured) {
          if (nextBoard[c]) {
            delete nextBoard[c];
            capturedSquares.push(c);
          }
        }

        this.state.board = nextBoard;
        this.state.lastMove = { from, to, captured: capturedSquares };

        // If it was a capture, check for additional captures from the landing square.
        if (candidate.isCapture) {
          const more = listCapturesFrom(nextBoard, to, movedPiece);
          if (more.length) {
            this.state.forcedFrom = to;
            // Continue same player's turn, keep clock active.
            this.state.clock.active = this.state.turn;
            this.state.clock.lastTickMs = nowMs;
            this.state.seq++;
            this.room.broadcast(
              JSON.stringify({ type: "state", state: this.state })
            );
            return;
          }
        }

        // Turn ends.
        this.state.forcedFrom = null;
        this.state.turn = otherSide(this.state.turn);

        // Check win: opponent has no pieces or no moves.
        const opponent = this.state.turn;
        const oppHasPiece = Object.values(this.state.board).some(
          (p) => p.color === opponent
        );
        const oppMoves = listAllMoves(this.state.board, opponent, null).moves;
        if (!oppHasPiece || oppMoves.length === 0) {
          this.state.result = { type: "win", winner: otherSide(opponent) };
          this.state.clock.running = false;
          this.state.clock.lastTickMs = null;
          this.cancelAutoReset();
        } else {
          this.state.clock.active = this.state.turn;
          this.state.clock.lastTickMs = nowMs;
        }

        this.state.seq++;
        this.room.broadcast(
          JSON.stringify({ type: "state", state: this.state })
        );
      }
    } catch (err) {
      console.error("[Checkers] Error processing message:", err);
    }
  }

  onClose(conn: Party.Connection) {
    console.log(`[Checkers] Player disconnected: ${conn.id}`);

    let changed = false;
    if (this.state.seats.w?.connId === conn.id) {
      this.state.seats.w = null;
      changed = true;
    }
    if (this.state.seats.b?.connId === conn.id) {
      this.state.seats.b = null;
      changed = true;
    }

    if (changed) {
      this.state.seq++;
      this.room.broadcast(JSON.stringify({ type: "state", state: this.state }));
    }
  }
}

CheckersServer satisfies Party.Worker;
