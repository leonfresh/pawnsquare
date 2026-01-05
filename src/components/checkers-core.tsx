"use client";

import PartySocket from "partysocket";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { Vec3 } from "@/lib/partyRoom";

export type Side = "w" | "b";
export type LobbyKind = "park" | "scifi";

export type SeatInfo = {
  connId: string;
  playerId: string;
  name: string;
};

export type ClockState = {
  baseMs: number;
  incrementMs: number;
  remainingMs: { w: number; b: number };
  running: boolean;
  active: Side;
  lastTickMs: number | null;
};

export type CheckersPiece = { color: Side; king: boolean };

export type CheckersResult =
  | { type: "win"; winner: Side }
  | { type: "timeout"; winner: Side };

export type CheckersNetState = {
  seats: { w: SeatInfo | null; b: SeatInfo | null };
  board: Record<string, CheckersPiece>;
  turn: Side;
  seq: number;
  clock: ClockState;
  result: CheckersResult | null;
  lastMove: { from: string; to: string; captured: string[] } | null;
  forcedFrom: string | null;
};

export type CheckersMessage =
  | { type: "state"; state: CheckersNetState }
  | { type: "seats"; seats: CheckersNetState["seats"]; seq: number };

export type CheckersSendMessage =
  | { type: "join"; side: Side; playerId?: string; name?: string }
  | { type: "leave"; side: Side }
  | { type: "move"; from: string; to: string }
  | { type: "setTime"; baseSeconds: number; incrementSeconds?: number }
  | { type: "reset" };

export type BoardControlsEvent =
  | {
      type: "open";
      boardKey: string;
      lobby: LobbyKind;
      timeMinutes: number;
      // Checkers does not use increment, but the Controls modal expects these.
      incrementSeconds: number;
      // Present for compatibility with existing UI; unused for checkers.
      fen: string;
      mySide: Side | null;
      turn: Side;
      boardOrientation: "white" | "black";
      canMove2d: boolean;
      canInc: boolean;
      canDec: boolean;
      canIncIncrement: boolean;
      canDecIncrement: boolean;
      canReset: boolean;
      canCenter: boolean;
      onMove2d: (
        from: string,
        to: string,
        promotion?: "q" | "r" | "b" | "n"
      ) => boolean;
      onInc: () => void;
      onDec: () => void;
      onIncIncrement: () => void;
      onDecIncrement: () => void;
      onReset: () => void;
      onCenter: () => void;
    }
  | {
      type: "sync2d";
      boardKey: string;
      lobby: LobbyKind;
      fen: string;
      mySide: Side | null;
      boardOrientation: "white" | "black";
      canMove2d: boolean;
      onMove2d: (
        from: string,
        to: string,
        promotion?: "q" | "r" | "b" | "n"
      ) => boolean;
    }
  | { type: "close"; boardKey?: string };

export const TIME_OPTIONS_SECONDS = [
  60,
  3 * 60,
  5 * 60,
  10 * 60,
  15 * 60,
] as const;

export const INCREMENT_OPTIONS_SECONDS = [0, 1, 2, 3, 5, 10] as const;

type BivariantHandler<T> = { bivarianceHack(event: T): void }["bivarianceHack"];

const PARTYKIT_HOST = process.env.NEXT_PUBLIC_PARTYKIT_HOST || "127.0.0.1:1999";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function otherSide(side: Side): Side {
  return side === "w" ? "b" : "w";
}

function isSquare(s: string) {
  if (s.length !== 2) return false;
  const f = s.charCodeAt(0);
  const r = s.charCodeAt(1);
  return f >= 97 && f <= 104 && r >= 49 && r <= 56;
}

function isDarkSquare(square: string) {
  if (!isSquare(square)) return false;
  const f = square.charCodeAt(0) - 97;
  const r = Number(square[1]) - 1;
  return (f + r) % 2 === 0;
}

function initialBoard(): Record<string, CheckersPiece> {
  const board: Record<string, CheckersPiece> = {};
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq = `${String.fromCharCode(97 + f)}${String(r + 1)}`;
      if (!isDarkSquare(sq)) continue;
      if (r <= 2) board[sq] = { color: "w", king: false };
      else if (r >= 5) board[sq] = { color: "b", king: false };
    }
  }
  return board;
}

type MoveCandidate = {
  from: string;
  to: string;
  captured: string[];
  isCapture: boolean;
};

function deltas(piece: CheckersPiece): Array<[number, number]> {
  const forward = piece.color === "w" ? 1 : -1;
  const dirs: Array<[number, number]> = [
    [-1, forward],
    [1, forward],
  ];
  if (piece.king) dirs.push([-1, -forward], [1, -forward]);
  return dirs;
}

function squareFileRank(sq: string) {
  const f = sq.charCodeAt(0) - 97;
  const r = Number(sq[1]) - 1;
  return { f, r };
}

function squareFromFileRank(f: number, r: number) {
  return `${String.fromCharCode(97 + f)}${String(r + 1)}`;
}

function inBounds(f: number, r: number) {
  return f >= 0 && f < 8 && r >= 0 && r < 8;
}

function listCapturesFrom(
  board: Record<string, CheckersPiece>,
  from: string,
  piece: CheckersPiece
): MoveCandidate[] {
  const out: MoveCandidate[] = [];
  const { f: f0, r: r0 } = squareFileRank(from);
  for (const [df, dr] of deltas(piece)) {
    const f1 = f0 + df;
    const r1 = r0 + dr;
    const f2 = f0 + df * 2;
    const r2 = r0 + dr * 2;
    if (!inBounds(f1, r1) || !inBounds(f2, r2)) continue;
    const mid = squareFromFileRank(f1, r1);
    const to = squareFromFileRank(f2, r2);
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
  board: Record<string, CheckersPiece>,
  from: string,
  piece: CheckersPiece
): MoveCandidate[] {
  const out: MoveCandidate[] = [];
  const { f: f0, r: r0 } = squareFileRank(from);
  for (const [df, dr] of deltas(piece)) {
    const f1 = f0 + df;
    const r1 = r0 + dr;
    if (!inBounds(f1, r1)) continue;
    const to = squareFromFileRank(f1, r1);
    if (!isDarkSquare(to)) continue;
    if (board[to]) continue;
    out.push({ from, to, captured: [], isCapture: false });
  }
  return out;
}

function listAllMoves(
  board: Record<string, CheckersPiece>,
  side: Side,
  forcedFrom: string | null
) {
  const moves: MoveCandidate[] = [];
  let hasAnyCapture = false;

  const squares = forcedFrom ? [forcedFrom] : Object.keys(board);
  for (const sq of squares) {
    const p = board[sq];
    if (!p || p.color !== side) continue;
    const caps = listCapturesFrom(board, sq, p);
    if (caps.length) {
      hasAnyCapture = true;
      moves.push(...caps);
    }
  }

  if (hasAnyCapture) return { moves, hasAnyCapture };

  for (const sq of squares) {
    const p = board[sq];
    if (!p || p.color !== side) continue;
    moves.push(...listSimpleMovesFrom(board, sq, p));
  }

  return { moves, hasAnyCapture: false };
}

function shouldKing(piece: CheckersPiece, to: string) {
  const rank = Number(to[1]);
  return (
    !piece.king &&
    ((piece.color === "w" && rank === 8) || (piece.color === "b" && rank === 1))
  );
}

export type UseCheckersGameOptions = {
  enabled?: boolean;
  roomId: string;
  boardKey: string;
  origin: [number, number, number];
  selfPositionRef: RefObject<THREE.Vector3>;
  selfId: string;
  selfName?: string;
  joinLockedBoardKey?: string | null;
  leaveAllNonce?: number;
  leaveAllExceptBoardKey?: string | null;
  onJoinIntent?: (boardKey: string) => void;
  onSelfSeatChange?: (boardKey: string, isSeated: boolean) => void;
  onRequestMove?: (
    dest: Vec3,
    opts?: { rotY?: number; sit?: boolean; sitDest?: Vec3; lookAtTarget?: Vec3 }
  ) => void;
  onCenterCamera?: (target: Vec3) => void;
  onBoardControls?: BivariantHandler<BoardControlsEvent>;
  controlsOpen?: boolean;
  board2dOpen?: boolean;
  lobby?: LobbyKind;
  connectRadius?: number;
  sounds?: Partial<{
    move: () => void;
    capture: () => void;
    select: () => void;
    warning: () => void;
    click: () => void;
  }>;
};

export type UseCheckersGameResult = {
  originVec: THREE.Vector3;
  squareSize: number;
  boardSize: number;
  netState: CheckersNetState;
  gameSelfId: string;
  turn: Side;
  mySides: Set<Side>;
  myPrimarySide: Side | null;
  isSeated: boolean;
  selected: string | null;
  legalTargets: string[];
  pulseTargetsUntilMs: number;
  lastMove: CheckersNetState["lastMove"];
  pieces: Array<{ square: string; color: Side; king: boolean }>;
  animatedFromByTo: Map<string, string>;
  pendingJoinSide: Side | null;
  clocks: {
    remaining: ClockState["remainingMs"];
    active: Side | null;
    baseMs: number;
    running: boolean;
  };
  timeIndex: number;
  canConfigure: boolean;
  boardOrientation: "white" | "black";
  canMove2d: boolean;
  onPickSquare: (square: string) => void;
  onPickPiece: (square: string) => void;
  clickJoin: (side: Side) => void;
  setTimeControlByIndex: (idx: number) => void;
  clickReset: () => void;
  requestSitAt: (seatX: number, seatZ: number) => void;
  centerCamera: () => void;
  emitControlsOpen: () => void;
  resultLabel: string | null;
};

export function useCheckersGame({
  enabled = true,
  roomId,
  boardKey,
  origin,
  selfPositionRef,
  selfId,
  selfName,
  joinLockedBoardKey,
  leaveAllNonce,
  leaveAllExceptBoardKey,
  onJoinIntent,
  onSelfSeatChange,
  onRequestMove,
  onCenterCamera,
  onBoardControls,
  controlsOpen,
  board2dOpen,
  lobby = "scifi",
  connectRadius = 12,
  sounds,
}: UseCheckersGameOptions): UseCheckersGameResult {
  const originVec = useMemo(
    () => new THREE.Vector3(origin[0], origin[1], origin[2]),
    [origin]
  );
  const squareSize = 0.6;
  const boardSize = squareSize * 8;

  const socketRef = useRef<PartySocket | null>(null);
  const [gameSelfId, setGameSelfId] = useState<string>("");
  const [connected, setConnected] = useState(false);
  const connectedRef = useRef(false);
  const pendingJoinRef = useRef<Side | null>(null);
  const [pendingJoinSide, setPendingJoinSide] = useState<Side | null>(null);

  const pendingJoinTimerRef = useRef<number | null>(null);

  useEffect(() => {
    connectedRef.current = connected;
  }, [connected]);

  // Pre-connect as soon as the board is mounted.
  // This moves the initial websocket + state sync off the "join" click.
  useEffect(() => {
    if (!enabled) return;
    if (!connectedRef.current) {
      connectedRef.current = true;
      setConnected(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useEffect(() => {
    if (enabled) return;

    // When switching away from checkers mode, clear transient state so
    // the next time we enter checkers mode, joining works immediately.
    pendingJoinRef.current = null;
    setPendingJoinSide(null);
    setSelected(null);
    setLegalTargets([]);
    setConnected(false);
    connectedRef.current = false;
    setGameSelfId("");

    // Ensure we fully disconnect from the PartyKit room when switching modes.
    if (socketRef.current) {
      try {
        socketRef.current.close();
      } catch {
        // ignore
      }
      socketRef.current = null;
    }

    if (pendingJoinTimerRef.current !== null) {
      window.clearTimeout(pendingJoinTimerRef.current);
      pendingJoinTimerRef.current = null;
    }
  }, [enabled]);

  const defaultClock = useMemo<ClockState>(() => {
    const baseMs = 5 * 60 * 1000;
    return {
      baseMs,
      incrementMs: 0,
      remainingMs: { w: baseMs, b: baseMs },
      running: false,
      active: "w",
      lastTickMs: null,
    };
  }, []);

  const [netState, setNetState] = useState<CheckersNetState>(() => ({
    seats: { w: null, b: null },
    board: initialBoard(),
    turn: "w",
    seq: 0,
    clock: defaultClock,
    result: null,
    lastMove: null,
    forcedFrom: null,
  }));

  const mySides = useMemo(() => {
    const sides = new Set<Side>();
    if (netState.seats.w?.connId === gameSelfId) sides.add("w");
    if (netState.seats.b?.connId === gameSelfId) sides.add("b");
    return sides;
  }, [netState.seats.w, netState.seats.b, gameSelfId]);

  const isSeated = mySides.size > 0;
  const seatOccupied = (seat: SeatInfo | null | undefined) =>
    !!seat?.connId && !!seat?.playerId;
  const bothSeatsOccupied =
    seatOccupied(netState.seats.w) && seatOccupied(netState.seats.b);
  const canUseControlTV = isSeated || !bothSeatsOccupied;
  const myPrimarySide: Side | null = mySides.has("w")
    ? "w"
    : mySides.has("b")
    ? "b"
    : null;

  const turn = netState.turn;

  const [selected, setSelected] = useState<string | null>(null);
  const [legalTargets, setLegalTargets] = useState<string[]>([]);
  const lastMove = netState.lastMove;

  const { move, capture, select, warning, click } = sounds ?? {};

  const lastSoundSeq = useRef(0);
  const hasWarnedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    if (!isSeated) return;
    if (netState.seq <= lastSoundSeq.current) return;
    lastSoundSeq.current = netState.seq;

    if (netState.lastMove) {
      if ((netState.lastMove.captured ?? []).length > 0) capture?.();
      else move?.();
    }

    hasWarnedRef.current = false;
  }, [enabled, isSeated, netState.seq, netState.lastMove, move, capture]);

  const [clockNow, setClockNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    if (!netState.clock.running) return;
    const id = window.setInterval(() => setClockNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [enabled, netState.clock.running]);

  useEffect(() => {
    if (!enabled) return;
    if (!isSeated) return;
    if (!netState.clock.running) return;
    const c = netState.clock;
    if (!mySides.has(c.active)) return;

    const now = clockNow;
    const remaining = c.remainingMs[c.active];
    const elapsed = c.lastTickMs ? Math.max(0, now - c.lastTickMs) : 0;
    const currentRemaining = Math.max(0, remaining - elapsed);

    if (
      currentRemaining < 30000 &&
      currentRemaining > 0 &&
      !hasWarnedRef.current
    ) {
      warning?.();
      hasWarnedRef.current = true;
    }
  }, [enabled, isSeated, mySides, clockNow, netState.clock, warning]);

  const send = (msg: CheckersSendMessage) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(msg));
    }
  };

  useEffect(() => {
    if (!enabled) {
      onSelfSeatChange?.(boardKey, false);
      setPendingJoinSide(null);
      return;
    }
    onSelfSeatChange?.(boardKey, isSeated);
    if (isSeated) setPendingJoinSide(null);
  }, [enabled, boardKey, isSeated, onSelfSeatChange]);

  useEffect(() => {
    if (!enabled) return;
    if (!leaveAllNonce) return;
    if (leaveAllExceptBoardKey && leaveAllExceptBoardKey === boardKey) return;
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN)
      return;

    if (netState.seats.w?.connId === gameSelfId)
      send({ type: "leave", side: "w" });
    if (netState.seats.b?.connId === gameSelfId)
      send({ type: "leave", side: "b" });
  }, [
    enabled,
    leaveAllNonce,
    leaveAllExceptBoardKey,
    boardKey,
    gameSelfId,
    netState.seats.w,
    netState.seats.b,
  ]);

  const activeModeRef = useRef(true);
  useEffect(() => {
    activeModeRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    if (!connected) return;

    const socket = new PartySocket({
      host: PARTYKIT_HOST,
      party: "checkers",
      room: `${roomId}-checkers-${boardKey}`,
    });

    socketRef.current = socket;

    socket.addEventListener("open", () => {
      if (!activeModeRef.current) return;
      setGameSelfId(socket.id);
      const pendingSide = pendingJoinRef.current;
      if (pendingSide) {
        pendingJoinRef.current = null;
        send({
          type: "join",
          side: pendingSide,
          playerId: selfId,
          name: selfName,
        });
      }
    });

    socket.addEventListener("error", () => {
      // Don't permanently wedge the UI in "Joining…" if the socket can't connect.
      setPendingJoinSide(null);
      pendingJoinRef.current = null;
    });

    socket.addEventListener("message", (event) => {
      if (!activeModeRef.current) return;
      try {
        const msg = JSON.parse(event.data) as CheckersMessage;

        if (msg.type === "seats") {
          setNetState((prev) => {
            if (msg.seq <= prev.seq) return prev;

            const prevW = prev.seats.w;
            const prevB = prev.seats.b;
            const nextW = msg.seats.w;
            const nextB = msg.seats.b;
            const sameW =
              (prevW === null && nextW === null) ||
              (prevW !== null &&
                nextW !== null &&
                prevW.connId === nextW.connId &&
                prevW.playerId === nextW.playerId &&
                prevW.name === nextW.name);
            const sameB =
              (prevB === null && nextB === null) ||
              (prevB !== null &&
                nextB !== null &&
                prevB.connId === nextB.connId &&
                prevB.playerId === nextB.playerId &&
                prevB.name === nextB.name);
            if (sameW && sameB) return prev;

            return { ...prev, seats: msg.seats, seq: msg.seq };
          });
          return;
        }

        if (msg.type === "state") {
          setNetState((prev) => {
            if (msg.state.seq < prev.seq) return prev;
            if (msg.state.seq === prev.seq) return prev;
            return msg.state;
          });
        }
      } catch (err) {
        console.error("[Checkers] Error parsing message:", err);
      }
    });

    socket.addEventListener("close", () => {
      // If we disconnect mid-join, allow retry.
      setPendingJoinSide(null);
      pendingJoinRef.current = null;
    });

    return () => {
      try {
        socket.close();
      } catch {
        // ignore
      }
    };
  }, [enabled, connected, roomId, boardKey]);

  const lastSeenSeqRef = useRef<number>(-1);
  const prevForcedFromRef = useRef<string | null>(null);
  const [pulseTargetsUntilMs, setPulseTargetsUntilMs] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    if (netState.seq === lastSeenSeqRef.current) return;
    lastSeenSeqRef.current = netState.seq;

    // If the server requires a multi-jump continuation, keep the capturing piece selected
    // and keep showing the legal targets.
    const forcedFrom = netState.forcedFrom;
    const shouldForceContinue =
      !!forcedFrom && isSeated && mySides.has(turn) && forcedFrom.length === 2;

    if (shouldForceContinue) {
      const { moves, hasAnyCapture } = listAllMoves(
        netState.board,
        turn,
        forcedFrom
      );
      const targets = moves
        .filter((m) => m.from === forcedFrom)
        .filter((m) => (!hasAnyCapture ? true : m.isCapture))
        .map((m) => m.to);

      setSelected(forcedFrom);
      setLegalTargets(targets);

      if (prevForcedFromRef.current !== forcedFrom) {
        // Briefly pulse the target indicators to hint the next jump.
        setPulseTargetsUntilMs(Date.now() + 1400);
      }
      prevForcedFromRef.current = forcedFrom;
      return;
    }

    prevForcedFromRef.current = forcedFrom;
    setSelected(null);
    setLegalTargets([]);
  }, [
    enabled,
    netState.seq,
    netState.board,
    netState.forcedFrom,
    isSeated,
    mySides,
    turn,
  ]);

  const requestJoin = (side: Side) => {
    const seat = netState.seats[side];
    if (seat && seat.connId !== gameSelfId) return;
    send({ type: "join", side, playerId: selfId, name: selfName });
  };

  const requestLeave = (side: Side) => {
    send({ type: "leave", side });
  };

  const submitMove = (from: string, to: string) => {
    if (!isSeated) return;
    if (netState.result) return;
    if (!mySides.has(turn)) return;

    send({ type: "move", from, to });
  };

  const onPickSquare = (square: string) => {
    if (!enabled) return;
    if (!isSquare(square)) return;
    if (netState.result) return;

    if (selected && legalTargets.includes(square)) {
      submitMove(selected, square);
      setSelected(null);
      setLegalTargets([]);
      return;
    }

    const piece = netState.board[square];
    if (piece && mySides.has(turn) && piece.color === turn) {
      if (netState.forcedFrom && netState.forcedFrom !== square) return;
      select?.();
      setSelected(square);
      const { moves, hasAnyCapture } = listAllMoves(
        netState.board,
        turn,
        netState.forcedFrom
      );
      const targets = moves
        .filter((m) => m.from === square)
        .filter((m) => (!hasAnyCapture ? true : m.isCapture))
        .map((m) => m.to);
      setLegalTargets(targets);
      return;
    }

    setSelected(null);
    setLegalTargets([]);
  };

  const onPickPiece = (square: string) => {
    onPickSquare(square);
  };

  useFrame(() => {
    if (!enabled) return;
    const pos = selfPositionRef.current;
    if (!pos) return;

    if (!connectedRef.current) {
      const dx = pos.x - originVec.x;
      const dz = pos.z - originVec.z;
      const near = dx * dx + dz * dz < connectRadius * connectRadius;
      if (near) {
        connectedRef.current = true;
        setConnected(true);
      }
      return;
    }
  });

  const pieces = useMemo(() => {
    const out: Array<{ square: string; color: Side; king: boolean }> = [];
    for (const [sq, p] of Object.entries(netState.board)) {
      out.push({ square: sq, color: p.color, king: p.king });
    }
    return out;
  }, [netState.board]);

  const animatedFromByTo = useMemo(() => {
    const map = new Map<string, string>();
    if (!lastMove) return map;
    map.set(lastMove.to, lastMove.from);
    return map;
  }, [lastMove]);

  const padOffset = boardSize / 2 + 1.1;
  const padSize: [number, number] = [2.1, 0.7];
  void padSize;

  const joinScheduleRef = useRef<number | null>(null);
  const clickJoin = (side: Side) => {
    if (!enabled) return;
    if (joinLockedBoardKey && joinLockedBoardKey !== boardKey) return;

    onJoinIntent?.(boardKey);
    setPendingJoinSide(side);

    if (joinScheduleRef.current) {
      window.clearTimeout(joinScheduleRef.current);
      joinScheduleRef.current = null;
    }

    joinScheduleRef.current = window.setTimeout(() => {
      joinScheduleRef.current = null;
      click?.();

      if (!connectedRef.current) {
        pendingJoinRef.current = side;
        connectedRef.current = true;
        setConnected(true);
        return;
      }

      if (
        !socketRef.current ||
        socketRef.current.readyState !== WebSocket.OPEN
      ) {
        pendingJoinRef.current = side;
        return;
      }

      if (mySides.has(side)) {
        requestLeave(side);
        setPendingJoinSide(null);
        return;
      }

      requestJoin(side);
    }, 0);

    // Safety: clear "Joining…" if we don't acquire a seat quickly.
    if (pendingJoinTimerRef.current !== null) {
      window.clearTimeout(pendingJoinTimerRef.current);
      pendingJoinTimerRef.current = null;
    }
    pendingJoinTimerRef.current = window.setTimeout(() => {
      pendingJoinTimerRef.current = null;
      setPendingJoinSide((cur) => {
        if (cur !== side) return cur;
        const seat = netState.seats[side];
        if (seat && seat.connId === gameSelfId) return null;
        return null;
      });
      pendingJoinRef.current = null;
    }, 3500);
  };

  const requestSitAt = (seatX: number, seatZ: number) => {
    if (!onRequestMove) return;
    const dx = originVec.x - seatX;
    const dz = originVec.z - seatZ;
    const face = Math.atan2(dx, dz);

    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    const ux = dx / len;
    const uz = dz / len;
    const approachDist = 0.5;
    const approachX = seatX + ux * approachDist;
    const approachZ = seatZ + uz * approachDist;

    onRequestMove([approachX, 0, approachZ], {
      rotY: face,
      sit: true,
      sitDest: [seatX, 0.36, seatZ],
      lookAtTarget: [originVec.x, originVec.y, originVec.z],
    });
  };

  const centerCamera = () => {
    onCenterCamera?.([originVec.x, originVec.y, originVec.z]);
  };

  const clocks = useMemo(() => {
    const c = netState.clock;
    const now = netState.clock.running ? clockNow : Date.now();
    const remaining = { ...c.remainingMs };
    if (c.running && c.lastTickMs !== null) {
      const elapsed = Math.max(0, now - c.lastTickMs);
      remaining[c.active] = Math.max(0, remaining[c.active] - elapsed);
    }
    return {
      remaining,
      active: c.running ? c.active : null,
      baseMs: c.baseMs,
      incrementMs: c.incrementMs,
      running: c.running,
    };
  }, [netState.clock, clockNow]);

  const timeIndex = useMemo(() => {
    const baseSeconds = Math.round(clocks.baseMs / 1000);
    let bestIdx = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    TIME_OPTIONS_SECONDS.forEach((s, idx) => {
      const d = Math.abs(s - baseSeconds);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = idx;
      }
    });
    return bestIdx;
  }, [clocks.baseMs]);

  const incrementIndex = useMemo(() => {
    const incrementSeconds = Math.round(clocks.incrementMs / 1000);
    let bestIdx = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    INCREMENT_OPTIONS_SECONDS.forEach((s, idx) => {
      const d = Math.abs(s - incrementSeconds);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = idx;
      }
    });
    return bestIdx;
  }, [clocks.incrementMs]);

  const canConfigure =
    !netState.clock.running &&
    !netState.result &&
    netState.lastMove === null &&
    netState.forcedFrom === null &&
    netState.turn === "w" &&
    (isSeated || !bothSeatsOccupied);

  const boardOrientation: "white" | "black" =
    myPrimarySide === "b" ? "black" : "white";

  const canMove2d = false;

  const setTimeControlByIndex = (nextIdx: number) => {
    if (!canConfigure) return;
    click?.();
    const idx = clamp(nextIdx, 0, TIME_OPTIONS_SECONDS.length - 1);
    const secs = TIME_OPTIONS_SECONDS[idx]!;
    const currentIncrementSecs = Math.round(clocks.incrementMs / 1000);
    send({
      type: "setTime",
      baseSeconds: secs,
      incrementSeconds: currentIncrementSecs,
    });
  };

  const setIncrementByIndex = (nextIdx: number) => {
    if (!canConfigure) return;
    click?.();
    const idx = clamp(nextIdx, 0, INCREMENT_OPTIONS_SECONDS.length - 1);
    const incSecs = INCREMENT_OPTIONS_SECONDS[idx]!;
    const currentBaseSecs = Math.round(clocks.baseMs / 1000);
    send({
      type: "setTime",
      baseSeconds: currentBaseSecs,
      incrementSeconds: incSecs,
    });
  };

  const clickReset = () => {
    // Allow reset if seated, OR as a spectator when at least one seat is empty.
    if (!isSeated && bothSeatsOccupied) return;
    click?.();
    send({ type: "reset" });
  };

  const emitControlsOpen = () => {
    if (!canUseControlTV) {
      console.log(
        "[Checkers emitControlsOpen] BLOCKED: canUseControlTV is false",
        {
          canUseControlTV,
          isSeated,
          bothSeatsOccupied,
          seats: { w: netState.seats.w, b: netState.seats.b },
        }
      );
      return;
    }
    console.log(
      "[Checkers emitControlsOpen] ALLOWED: calling onBoardControls",
      {
        canUseControlTV,
        isSeated,
        bothSeatsOccupied,
        hasCallback: !!onBoardControls,
      }
    );
    onBoardControls?.({
      type: "open",
      boardKey,
      lobby,
      timeMinutes: Math.round(clocks.baseMs / 60000),
      incrementSeconds: Math.round(clocks.incrementMs / 1000),
      fen: "",
      mySide: myPrimarySide,
      turn,
      boardOrientation,
      canMove2d,
      canInc: canConfigure && timeIndex < TIME_OPTIONS_SECONDS.length - 1,
      canDec: canConfigure && timeIndex > 0,
      canIncIncrement:
        canConfigure && incrementIndex < INCREMENT_OPTIONS_SECONDS.length - 1,
      canDecIncrement: canConfigure && incrementIndex > 0,
      canReset: isSeated || !bothSeatsOccupied,
      canCenter: !!onCenterCamera,
      onMove2d: () => false,
      onInc: () => setTimeControlByIndex(timeIndex + 1),
      onDec: () => setTimeControlByIndex(timeIndex - 1),
      onIncIncrement: () => setIncrementByIndex(incrementIndex + 1),
      onDecIncrement: () => setIncrementByIndex(incrementIndex - 1),
      onReset: clickReset,
      onCenter: centerCamera,
    });
  };

  useEffect(() => {
    if (!enabled) return;
    return () => {
      onBoardControls?.({ type: "close", boardKey });
    };
  }, [enabled, onBoardControls, boardKey]);

  useEffect(() => {
    if (!enabled) return;
    if (!controlsOpen) return;
    if (!canUseControlTV) {
      onBoardControls?.({ type: "close", boardKey });
      return;
    }
    emitControlsOpen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    controlsOpen,
    canUseControlTV,
    canConfigure,
    timeIndex,
    incrementIndex,
    clocks.baseMs,
    clocks.incrementMs,
    myPrimarySide,
    onCenterCamera,
  ]);

  useEffect(() => {
    // Checkers: no 2D board.
    void board2dOpen;
  }, [board2dOpen]);

  const resultLabel = useMemo(() => {
    const r = netState.result;
    if (!r) return null;
    const winner = r.winner === "w" ? "White" : "Black";
    if (r.type === "timeout") return `${winner} wins (time)`;
    return `${winner} wins`;
  }, [netState.result]);

  return {
    originVec,
    squareSize,
    boardSize,
    netState,
    gameSelfId,
    turn,
    mySides,
    myPrimarySide,
    isSeated,
    selected,
    legalTargets,
    pulseTargetsUntilMs,
    lastMove,
    pieces,
    animatedFromByTo,
    pendingJoinSide,
    clocks,
    timeIndex,
    canConfigure,
    boardOrientation,
    canMove2d,
    onPickSquare,
    onPickPiece,
    clickJoin,
    setTimeControlByIndex,
    clickReset,
    requestSitAt,
    centerCamera,
    emitControlsOpen,
    resultLabel,
  };
}
