import type * as Party from "partykit/server";
import { Chess, type Square } from "chess.js";
import {
  applyGooseMove,
  gooseHasAnyLegalMove,
  gooseKingInCheck,
  gooseLegalMovesForSquare,
  isCenter4,
  parseFenMoveNumber,
  type Side,
  type GoosePhase,
} from "../src/lib/gooseChess";

type SeatInfo = {
  connId: string;
  playerId: string;
  name: string;
};

type GameResult =
  | { type: "timeout"; winner: Side }
  | { type: "checkmate"; winner: Side }
  | { type: "resign"; winner: Side }
  | { type: "draw"; reason: DrawReason };

type DrawReason =
  | "stalemate"
  | "insufficient"
  | "threefold"
  | "fifty-move"
  | "draw";

type ClockState = {
  baseMs: number;
  incrementMs: number;
  remainingMs: { w: number; b: number };
  running: boolean;
  active: Side;
  lastTickMs: number | null;
};

type GooseChessState = {
  seats: { w: SeatInfo | null; b: SeatInfo | null };
  fen: string;
  seq: number;
  clock: ClockState;
  result: GameResult | null;
  lastMove: { from: Square; to: Square } | null;
  gooseSquare: Square;
  phase: GoosePhase;
  activeSide: Side;
  drawOfferFrom: Side | null;
  rematch: { w: boolean; b: boolean };
};

type GooseChessMessage =
  | { type: "join"; side: Side; playerId?: string; name?: string }
  | { type: "leave"; side: Side }
  | {
      type: "move";
      from: Square;
      to: Square;
      promotion?: "q" | "r" | "b" | "n";
    }
  | { type: "goose"; square: Square }
  | { type: "resign" }
  | { type: "draw:offer" }
  | { type: "draw:accept" }
  | { type: "draw:decline" }
  | { type: "draw:cancel" }
  | { type: "rematch:request" }
  | { type: "rematch:decline" }
  | { type: "rematch:cancel" }
  | { type: "setTime"; baseSeconds: number; incrementSeconds?: number }
  | { type: "reset" }
  | { type: "state"; state: GooseChessState };

type SeatsMessage = {
  type: "seats";
  seats: GooseChessState["seats"];
  seq: number;
};

const DEFAULT_TIME_SECONDS = 5 * 60;
const MIN_TIME_SECONDS = 30;
const MAX_TIME_SECONDS = 60 * 60;
const AUTO_RESET_AFTER_TIMEOUT_MS = 60 * 1000;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function initialClock(baseMs: number, incrementMs = 0): ClockState {
  return {
    baseMs,
    incrementMs,
    remainingMs: { w: baseMs, b: baseMs },
    running: false,
    active: "w",
    lastTickMs: null,
  };
}

function otherSide(side: Side): Side {
  return side === "w" ? "b" : "w";
}

function computeDrawReason(chess: Chess): DrawReason {
  const anyChess = chess as any;
  if (typeof anyChess.isStalemate === "function" && anyChess.isStalemate())
    return "stalemate";
  if (
    typeof anyChess.isInsufficientMaterial === "function" &&
    anyChess.isInsufficientMaterial()
  )
    return "insufficient";
  if (
    typeof anyChess.isThreefoldRepetition === "function" &&
    anyChess.isThreefoldRepetition()
  )
    return "threefold";
  if (
    typeof anyChess.isDrawByFiftyMoves === "function" &&
    anyChess.isDrawByFiftyMoves()
  )
    return "fifty-move";
  return "draw";
}

export default class GooseChessServer implements Party.Server {
  state: GooseChessState;
  timeoutCheck: ReturnType<typeof setInterval> | null = null;
  autoResetTimer: ReturnType<typeof setTimeout> | null = null;
  autoResetToken = 0;

  constructor(readonly room: Party.Room) {
    const baseMs = DEFAULT_TIME_SECONDS * 1000;
    this.state = {
      seats: { w: null, b: null },
      fen: new Chess().fen(),
      seq: 0,
      clock: initialClock(baseMs),
      result: null,
      lastMove: null,
      gooseSquare: "d5",
      phase: "piece",
      activeSide: "w",
      drawOfferFrom: null,
      rematch: { w: false, b: false },
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
    this.state.clock.active = this.state.activeSide;
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

  resetGame(baseMs: number, incrementMs = 0) {
    this.state.fen = new Chess().fen();
    this.state.clock = initialClock(baseMs, incrementMs);
    this.state.result = null;
    this.state.lastMove = null;
    this.state.gooseSquare = "d5";
    this.state.phase = "piece";
    this.state.activeSide = "w";
    this.state.drawOfferFrom = null;
    this.state.rematch = { w: false, b: false };
  }

  sideForConn(connId: string): Side | null {
    if (this.state.seats.w?.connId === connId) return "w";
    if (this.state.seats.b?.connId === connId) return "b";
    return null;
  }

  stopClockAt(nowMs: number) {
    const { remainingMs } = this.getRemainingWithNow(nowMs);
    this.state.clock.remainingMs = remainingMs;
    this.state.clock.running = false;
    this.state.clock.lastTickMs = null;
  }

  broadcastState() {
    this.room.broadcast(JSON.stringify({ type: "state", state: this.state }));
  }

  broadcastSeats() {
    this.room.broadcast(
      JSON.stringify({
        type: "seats",
        seats: this.state.seats,
        seq: this.state.seq,
      } satisfies SeatsMessage)
    );
  }

  evaluateResultIfNeeded(chess: Chess) {
    if (this.state.result) return;
    if (this.state.phase !== "piece") return;

    // Only evaluate at the start of a normal piece turn.
    const gooseSquare = this.state.gooseSquare;
    const sideToMove = chess.turn() as Side;

    const anyLegal = gooseHasAnyLegalMove(chess, gooseSquare);
    if (anyLegal) {
      const anyChess = chess as any;
      if (typeof anyChess.isDraw === "function" && anyChess.isDraw()) {
        this.state.result = { type: "draw", reason: computeDrawReason(chess) };
      }
      return;
    }

    const inCheck = gooseKingInCheck(chess, sideToMove, gooseSquare);
    if (inCheck) {
      this.state.result = { type: "checkmate", winner: otherSide(sideToMove) };
    } else {
      this.state.result = { type: "draw", reason: "stalemate" };
    }
  }

  onConnect(conn: Party.Connection) {
    console.log(`[Goose] Player connected: ${conn.id}`);
    conn.send(JSON.stringify({ type: "state", state: this.state }));
  }

  onMessage(message: string, sender: Party.Connection) {
    try {
      const msg = JSON.parse(message) as GooseChessMessage;

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
        this.broadcastSeats();
      } else if (msg.type === "leave") {
        const seat = msg.side;
        if (this.state.seats[seat]?.connId !== sender.id) return;

        this.state.seats[seat] = null;
        this.state.seq++;
        this.broadcastSeats();
      } else if (msg.type === "setTime") {
        const isSeated =
          this.state.seats.w?.connId === sender.id ||
          this.state.seats.b?.connId === sender.id;
        const canConfigureAsGuest =
          this.state.seats.w === null || this.state.seats.b === null;

        // Allow changing time control only before the game starts.
        if (!isSeated && !canConfigureAsGuest) return;
        if (this.state.clock.running) return;
        if (this.state.result) return;
        const isStartPos = this.state.fen === new Chess().fen();
        if (!isStartPos) return;

        const baseSeconds = clamp(
          Math.floor(msg.baseSeconds ?? DEFAULT_TIME_SECONDS),
          MIN_TIME_SECONDS,
          MAX_TIME_SECONDS
        );
        const baseMs = baseSeconds * 1000;
        const incrementSeconds = clamp(
          Math.floor(msg.incrementSeconds ?? 0),
          0,
          60
        );
        const incrementMs = incrementSeconds * 1000;

        this.cancelAutoReset();
        this.resetGame(baseMs, incrementMs);
        this.state.seq++;
        this.broadcastState();
      } else if (msg.type === "reset") {
        const isSeated =
          this.state.seats.w?.connId === sender.id ||
          this.state.seats.b?.connId === sender.id;
        const canResetAsGuest =
          this.state.seats.w === null || this.state.seats.b === null;

        // Allow reset if seated, OR as a spectator when at least one seat is empty.
        if (!isSeated && !canResetAsGuest) return;

        this.cancelAutoReset();
        const baseMs = this.state.clock.baseMs;
        const incrementMs = this.state.clock.incrementMs;
        this.resetGame(baseMs, incrementMs);
        this.state.seq++;
        this.broadcastState();
      } else if (msg.type === "resign") {
        if (this.state.result) return;
        const side = this.sideForConn(sender.id);
        if (!side) return;
        const now = Date.now();
        this.stopClockAt(now);
        this.state.drawOfferFrom = null;
        this.state.rematch = { w: false, b: false };
        this.state.result = { type: "resign", winner: otherSide(side) };
        this.cancelAutoReset();
        this.state.seq++;
        this.broadcastState();
      } else if (msg.type === "draw:offer") {
        if (this.state.result) return;
        const side = this.sideForConn(sender.id);
        if (!side) return;
        this.state.drawOfferFrom = side;
        this.state.seq++;
        this.broadcastState();
      } else if (msg.type === "draw:cancel") {
        const side = this.sideForConn(sender.id);
        if (!side) return;
        if (this.state.drawOfferFrom !== side) return;
        this.state.drawOfferFrom = null;
        this.state.seq++;
        this.broadcastState();
      } else if (msg.type === "draw:decline") {
        const side = this.sideForConn(sender.id);
        if (!side) return;
        if (!this.state.drawOfferFrom) return;
        if (this.state.drawOfferFrom === side) return;
        this.state.drawOfferFrom = null;
        this.state.seq++;
        this.broadcastState();
      } else if (msg.type === "draw:accept") {
        if (this.state.result) return;
        const side = this.sideForConn(sender.id);
        if (!side) return;
        if (!this.state.drawOfferFrom) return;
        if (this.state.drawOfferFrom === side) return;

        const now = Date.now();
        this.stopClockAt(now);
        this.state.drawOfferFrom = null;
        this.state.rematch = { w: false, b: false };
        this.state.result = { type: "draw", reason: "draw" };
        this.cancelAutoReset();
        this.state.seq++;
        this.broadcastState();
      } else if (msg.type === "rematch:request") {
        const side = this.sideForConn(sender.id);
        if (!side) return;
        if (!this.state.result) return;
        this.state.rematch[side] = true;

        if (this.state.rematch.w && this.state.rematch.b) {
          const baseMs = this.state.clock.baseMs;
          const incrementMs = this.state.clock.incrementMs;
          this.cancelAutoReset();
          this.resetGame(baseMs, incrementMs);
        }

        this.state.seq++;
        this.broadcastState();
      } else if (msg.type === "rematch:decline") {
        const side = this.sideForConn(sender.id);
        if (!side) return;
        if (!this.state.result) return;

        const other: Side = side === "w" ? "b" : "w";
        if (!this.state.rematch[other]) return;
        if (this.state.rematch[side]) return;

        this.state.rematch[other] = false;
        this.state.seq++;
        this.broadcastState();
      } else if (msg.type === "rematch:cancel") {
        const side = this.sideForConn(sender.id);
        if (!side) return;
        this.state.rematch[side] = false;
        this.state.seq++;
        this.broadcastState();
      } else if (msg.type === "move") {
        if (this.state.result) return;
        if (this.state.phase !== "piece") return;

        const side = this.state.activeSide;
        if (this.state.seats[side]?.connId !== sender.id) return;

        const chess = new Chess(this.state.fen);
        if ((chess.turn() as Side) !== side) return;

        const now = Date.now();
        this.startClockIfNeeded(now);

        // Any action cancels draw offers / rematch intent.
        this.state.drawOfferFrom = null;
        this.state.rematch = { w: false, b: false };
        if (this.applyClockAndMaybeTimeout(now)) {
          this.state.seq++;
          this.broadcastState();
          return;
        }

        const from = msg.from;
        const to = msg.to;
        const promotion = msg.promotion;

        const legal = gooseLegalMovesForSquare(
          chess,
          from,
          this.state.gooseSquare
        );
        const match = legal.find(
          (m) =>
            m.to === to &&
            ((m.promotion ?? undefined) as any) === (promotion as any)
        );
        if (!match) return;

        applyGooseMove(chess, match);

        this.state.fen = chess.fen();
        this.state.lastMove = { from, to };
        this.state.phase = "goose";
        this.state.activeSide = side;
        this.state.clock.active = side;

        // Add increment after piece move
        if (this.state.clock.incrementMs > 0) {
          this.state.clock.remainingMs[side] += this.state.clock.incrementMs;
        }

        this.state.seq++;
        this.broadcastState();
      } else if (msg.type === "goose") {
        if (this.state.result) return;
        if (this.state.phase !== "goose") return;

        const side = this.state.activeSide;
        if (this.state.seats[side]?.connId !== sender.id) return;

        const chess = new Chess(this.state.fen);
        const square = msg.square;

        // if (square === this.state.gooseSquare) return;
        if (chess.get(square)) return;

        const moveNumber = parseFenMoveNumber(this.state.fen);
        if (moveNumber > 20 && isCenter4(square)) return;

        const now = Date.now();
        this.startClockIfNeeded(now);

        // Any action cancels draw offers / rematch intent.
        this.state.drawOfferFrom = null;
        this.state.rematch = { w: false, b: false };
        if (this.applyClockAndMaybeTimeout(now)) {
          this.state.seq++;
          this.broadcastState();
          return;
        }

        this.state.gooseSquare = square;
        this.state.phase = "piece";
        this.state.activeSide = otherSide(side);
        this.state.clock.active = this.state.activeSide;
        this.state.clock.lastTickMs = now;

        // Evaluate result after goose placement (since honk can change check).
        this.evaluateResultIfNeeded(chess);

        this.state.seq++;
        this.broadcastState();
      }
    } catch (err) {
      console.error("[Goose] Error parsing message:", err);
    }
  }

  onClose(conn: Party.Connection) {
    console.log(`[Goose] Player disconnected: ${conn.id}`);

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
      this.broadcastState();
    }
  }
}
