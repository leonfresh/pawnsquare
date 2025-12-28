import type * as Party from "partykit/server";
import { Chess, type Square } from "chess.js";

type Side = "w" | "b";

type SeatInfo = {
  connId: string;
  playerId: string;
  name: string;
};

type GameResult =
  | { type: "timeout"; winner: Side }
  | { type: "checkmate"; winner: Side }
  | { type: "draw"; reason: DrawReason };

type DrawReason = "stalemate" | "insufficient" | "threefold" | "fifty-move" | "draw";

type ClockState = {
  baseMs: number;
  remainingMs: { w: number; b: number };
  running: boolean;
  active: Side;
  lastTickMs: number | null;
};

type ChessState = {
  seats: { w: SeatInfo | null; b: SeatInfo | null };
  fen: string;
  seq: number;
  clock: ClockState;
  result: GameResult | null;
  lastMove: { from: Square; to: Square } | null;
};

type ChessMessage =
  | { type: "join"; side: Side; playerId?: string; name?: string }
  | { type: "leave"; side: Side }
  | { type: "move"; from: Square; to: Square; promotion?: "q" | "r" | "b" | "n" }
  | { type: "setTime"; baseSeconds: number }
  | { type: "reset" }
  | { type: "state"; state: ChessState };

const DEFAULT_TIME_SECONDS = 5 * 60;
const MIN_TIME_SECONDS = 30;
const MAX_TIME_SECONDS = 60 * 60;

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

function isPlayerInSeat(state: ChessState, connId: string) {
  return state.seats.w?.connId === connId || state.seats.b?.connId === connId;
}

function otherSide(side: Side): Side {
  return side === "w" ? "b" : "w";
}

function computeDrawReason(chess: Chess): DrawReason {
  // chess.js naming varies slightly across versions; check what exists.
  const anyChess = chess as any;
  if (typeof anyChess.isStalemate === "function" && anyChess.isStalemate()) return "stalemate";
  if (typeof anyChess.isInsufficientMaterial === "function" && anyChess.isInsufficientMaterial()) return "insufficient";
  if (typeof anyChess.isThreefoldRepetition === "function" && anyChess.isThreefoldRepetition()) return "threefold";
  if (typeof anyChess.isDrawByFiftyMoves === "function" && anyChess.isDrawByFiftyMoves()) return "fifty-move";
  return "draw";
}

export default class ChessServer implements Party.Server {
  state: ChessState;
  timeoutCheck: ReturnType<typeof setInterval> | null = null;
  
  constructor(readonly room: Party.Room) {
    const baseMs = DEFAULT_TIME_SECONDS * 1000;
    this.state = {
      seats: { w: null, b: null },
      fen: new Chess().fen(),
      seq: 0,
      clock: initialClock(baseMs),
      result: null,
      lastMove: null,
    };

    // Enforce timeouts even if nobody sends messages.
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
    }, 250);
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

  startClockIfNeeded(nowMs: number, chess: Chess) {
    if (this.state.clock.running) return;
    if (this.state.result) return;
    // Start on first move, not on join.
    this.state.clock.running = true;
    this.state.clock.active = chess.turn();
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
      return true;
    }
    return false;
  }

  resetGame(baseMs: number) {
    this.state.fen = new Chess().fen();
    this.state.clock = initialClock(baseMs);
    this.state.result = null;
    this.state.lastMove = null;
  }

  onConnect(conn: Party.Connection) {
    console.log(`[Chess] Player connected: ${conn.id}`);
    
    // Send current state
    conn.send(JSON.stringify({ type: "state", state: this.state }));
  }

  onMessage(message: string, sender: Party.Connection) {
    try {
      const msg = JSON.parse(message) as ChessMessage;
      
      if (msg.type === "join") {
        const seat = msg.side;
        if (this.state.seats[seat] && this.state.seats[seat]?.connId !== sender.id) {
          // Seat taken by someone else
          return;
        }

        // Ensure a player can only occupy one seat.
        const other: Side = seat === "w" ? "b" : "w";
        if (this.state.seats[other]?.connId === sender.id) {
          this.state.seats[other] = null;
        }

        const playerId = typeof msg.playerId === "string" && msg.playerId ? msg.playerId : sender.id;
        const name = typeof msg.name === "string" && msg.name ? msg.name : "Player";
        this.state.seats[seat] = { connId: sender.id, playerId, name };
        this.state.seq++;
        
        this.room.broadcast(JSON.stringify({ type: "state", state: this.state }));
      } else if (msg.type === "leave") {
        const seat = msg.side;
        if (this.state.seats[seat]?.connId !== sender.id) return;

        this.state.seats[seat] = null;
        this.state.seq++;
        this.room.broadcast(JSON.stringify({ type: "state", state: this.state }));
      } else if (msg.type === "move") {
        if (this.state.result) return;

        const chess = new Chess(this.state.fen);
        const turn = chess.turn();
        const expectedPlayer = turn === "w" ? this.state.seats.w?.connId : this.state.seats.b?.connId;
        
        if (expectedPlayer !== sender.id) {
          console.log(`[Chess] Unauthorized move from ${sender.id}`);
          return;
        }

        const nowMs = Date.now();
        this.startClockIfNeeded(nowMs, chess);

        // Update active side time (and potentially end by timeout) before move.
        if (this.applyClockAndMaybeTimeout(nowMs)) {
          this.state.seq++;
          this.room.broadcast(JSON.stringify({ type: "state", state: this.state }));
          return;
        }
        
        const result = chess.move({
          from: msg.from,
          to: msg.to,
          promotion: msg.promotion,
        });
        
        if (!result) {
          console.log(`[Chess] Invalid move from ${sender.id}`);
          return;
        }
        
        this.state.fen = chess.fen();
        this.state.lastMove = { from: msg.from, to: msg.to };

        // If the move ended the game, lock clocks.
        const anyChess = chess as any;
        const isGameOver = typeof anyChess.isGameOver === "function" ? anyChess.isGameOver() : false;
        if (isGameOver) {
          if (typeof anyChess.isCheckmate === "function" && anyChess.isCheckmate()) {
            // After a checkmating move, the turn is the losing side.
            const winner = otherSide(chess.turn());
            this.state.result = { type: "checkmate", winner };
          } else if (
            (typeof anyChess.isDraw === "function" && anyChess.isDraw()) ||
            (typeof anyChess.isStalemate === "function" && anyChess.isStalemate())
          ) {
            this.state.result = { type: "draw", reason: computeDrawReason(chess) };
          } else {
            // Fallback
            this.state.result = { type: "draw", reason: "draw" };
          }
          this.state.clock.running = false;
          this.state.clock.lastTickMs = null;
        } else {
          // Switch active side and continue timing.
          this.state.clock.active = chess.turn();
          this.state.clock.lastTickMs = nowMs;
        }

        this.state.seq++;
        
        this.room.broadcast(JSON.stringify({ type: "state", state: this.state }));
      } else if (msg.type === "setTime") {
        // Allow players to change time control only before the game starts.
        if (!isPlayerInSeat(this.state, sender.id)) return;
        if (this.state.clock.running) return;
        if (this.state.result) return;

        const chess = new Chess(this.state.fen);
        const isStartPos = chess.fen() === new Chess().fen();
        if (!isStartPos) return;

        const baseSeconds = clamp(Math.floor(msg.baseSeconds), MIN_TIME_SECONDS, MAX_TIME_SECONDS);
        const baseMs = baseSeconds * 1000;
        this.resetGame(baseMs);
        this.state.seq++;
        this.room.broadcast(JSON.stringify({ type: "state", state: this.state }));
      } else if (msg.type === "reset") {
        // Only seated players can reset.
        if (!isPlayerInSeat(this.state, sender.id)) return;
        const baseMs = this.state.clock.baseMs;
        this.resetGame(baseMs);
        this.state.seq++;
        this.room.broadcast(JSON.stringify({ type: "state", state: this.state }));
      }
    } catch (err) {
      console.error("[Chess] Error processing message:", err);
    }
  }

  onClose(conn: Party.Connection) {
    console.log(`[Chess] Player disconnected: ${conn.id}`);
    
    // Remove seats held by this player
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

ChessServer satisfies Party.Worker;
