"use client";

import { useFrame } from "@react-three/fiber";
import { Chess, type Square } from "chess.js";
import PartySocket from "partysocket";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { Vec3 } from "@/lib/partyRoom";
import {
  clamp,
  isSquare,
  piecePath,
  PieceModel,
  squareCenter,
  type BoardControlsEvent,
  type ClockState,
  type LobbyKind,
  type Side,
  TIME_OPTIONS_SECONDS,
  INCREMENT_OPTIONS_SECONDS,
  winnerLabel,
} from "./chess-core";

export type TeamSeat = "w1" | "w2" | "b1" | "b2";

export type TeamSeatInfo = {
  connId: string;
  playerId: string;
  name: string;
};

export type Chess4NetState = {
  seats: Record<TeamSeat, TeamSeatInfo | null>;
  fen: string;
  seq: number;
  clock: ClockState;
  result:
    | { type: "timeout"; winner: Side }
    | { type: "checkmate"; winner: Side }
    | { type: "draw"; reason: string }
    | null;
  lastMove: { from: Square; to: Square } | null;
};

export type Chess4Message =
  | { type: "state"; state: Chess4NetState }
  | { type: "seats"; seats: Chess4NetState["seats"]; seq: number };

export type Chess4SendMessage =
  | { type: "join"; seat: TeamSeat; playerId?: string; name?: string }
  | { type: "leave"; seat: TeamSeat }
  | {
      type: "move";
      from: Square;
      to: Square;
      promotion?: "q" | "r" | "b" | "n";
    }
  | { type: "setTime"; baseSeconds: number; incrementSeconds?: number }
  | { type: "reset" };

export type UseChess4GameOptions = {
  enabled?: boolean;
  roomId: string;
  boardKey: string;
  origin: [number, number, number];
  selfPositionRef: RefObject<THREE.Vector3>;
  selfId: string;
  selfName?: string;
  onActivityMove?: () => void;
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
  onBoardControls?: (event: BoardControlsEvent) => void;
  controlsOpen?: boolean;
  board2dOpen?: boolean;
  chessTheme?: string;
  lobby?: LobbyKind;
  connectRadius?: number;
};

export type UseChess4GameResult = {
  originVec: THREE.Vector3;
  squareSize: number;
  boardSize: number;
  netState: Chess4NetState;
  chessSelfId: string;
  turn: Side;
  mySides: Set<Side>;
  myPrimarySide: Side | null;
  isSeated: boolean;
  selected: Square | null;
  legalTargets: Square[];
  hoveredSquare: Square | null;
  setHoveredSquare: (square: Square | null) => void;
  lastMove: Chess4NetState["lastMove"];
  pieces: Array<{ square: Square; type: string; color: Side }>;
  pendingJoinSeat: TeamSeat | null;
  clocks: {
    remaining: ClockState["remainingMs"];
    active: Side | null;
    baseMs: number;
    incrementMs: number;
    running: boolean;
  };
  timeIndex: number;
  incrementIndex: number;
  canConfigure: boolean;
  boardOrientation: "white" | "black";
  canMove2d: boolean;
  onPickSquare: (square: Square) => void;
  onPickPiece: (square: Square) => void;
  clickJoin: (seat: TeamSeat) => void;
  setTimeControlByIndex: (idx: number) => void;
  setIncrementByIndex: (idx: number) => void;
  clickReset: () => void;
  requestSitAt: (seatX: number, seatZ: number) => void;
  centerCamera: () => void;
  emitControlsOpen: () => void;
  resultLabel: string | null;
};

const PARTYKIT_HOST = process.env.NEXT_PUBLIC_PARTYKIT_HOST || "127.0.0.1:1999";

function seatSide(seat: TeamSeat): Side {
  return seat.startsWith("w") ? "w" : "b";
}

export function useChess4Game({
  enabled = true,
  roomId,
  boardKey,
  origin,
  selfPositionRef,
  selfId,
  selfName,
  onActivityMove,
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
  chessTheme,
  lobby = "park",
  connectRadius = 12,
}: UseChess4GameOptions): UseChess4GameResult {
  const originVec = useMemo(
    () => new THREE.Vector3(origin[0], origin[1], origin[2]),
    [origin]
  );
  const squareSize = 0.6;
  const boardSize = squareSize * 8;

  const socketRef = useRef<PartySocket | null>(null);
  const [chessSelfId, setChessSelfId] = useState<string>("");
  const [chessConnected, setChessConnected] = useState(false);
  const chessConnectedRef = useRef(false);

  const pendingJoinRef = useRef<TeamSeat | null>(null);
  const [pendingJoinSeat, setPendingJoinSeat] = useState<TeamSeat | null>(null);

  const activeModeRef = useRef(true);
  useEffect(() => {
    activeModeRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    chessConnectedRef.current = chessConnected;
  }, [chessConnected]);

  // Pre-connect as soon as the board is mounted.
  // This shifts initial socket handshake/state parse away from the join click.
  useEffect(() => {
    if (!enabled) return;
    if (!chessConnectedRef.current) {
      chessConnectedRef.current = true;
      setChessConnected(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const initialFen = useMemo(() => new Chess().fen(), []);
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

  const [netState, setNetState] = useState<Chess4NetState>(() => ({
    seats: { w1: null, w2: null, b1: null, b2: null },
    fen: initialFen,
    seq: 0,
    clock: defaultClock,
    result: null,
    lastMove: null,
  }));

  useEffect(() => {
    setNetState({
      seats: { w1: null, w2: null, b1: null, b2: null },
      fen: initialFen,
      seq: 0,
      clock: defaultClock,
      result: null,
      lastMove: null,
    });
  }, [initialFen, defaultClock]);

  const mySides = useMemo(() => {
    const sides = new Set<Side>();
    (Object.keys(netState.seats) as TeamSeat[]).forEach((seat) => {
      if (netState.seats[seat]?.connId === chessSelfId) {
        sides.add(seatSide(seat));
      }
    });
    return sides;
  }, [netState.seats, chessSelfId]);

  const isSeated = mySides.size > 0;
  const myPrimarySide: Side | null = mySides.has("w")
    ? "w"
    : mySides.has("b")
    ? "b"
    : null;

  const anySeatEmpty = useMemo(() => {
    return (
      !netState.seats.w1 ||
      !netState.seats.w2 ||
      !netState.seats.b1 ||
      !netState.seats.b2
    );
  }, [netState.seats]);

  const allSeatsOccupied = !anySeatEmpty;
  const canUseControlTV = isSeated || !allSeatsOccupied;

  useEffect(() => {
    if (enabled) return;

    if (socketRef.current) {
      try {
        socketRef.current.close();
      } catch {
        // ignore
      }
      socketRef.current = null;
    }

    pendingJoinRef.current = null;
    setPendingJoinSeat(null);
    setSelected(null);
    setLegalTargets([]);
    setChessConnected(false);
    chessConnectedRef.current = false;
    setChessSelfId("");
  }, [enabled]);

  const chess = useMemo(() => new Chess(netState.fen), [netState.fen]);
  const turn = chess.turn() as Side;
  const lastMove = netState.lastMove;

  const [selected, setSelected] = useState<Square | null>(null);
  const [legalTargets, setLegalTargets] = useState<Square[]>([]);
  const [hoveredSquare, setHoveredSquare] = useState<Square | null>(null);

  const send = (msg: Chess4SendMessage) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(msg));
    }
  };

  useEffect(() => {
    if (!enabled) {
      onSelfSeatChange?.(boardKey, false);
      setPendingJoinSeat(null);
      return;
    }
    onSelfSeatChange?.(boardKey, isSeated);
    if (isSeated) setPendingJoinSeat(null);
  }, [enabled, boardKey, isSeated, onSelfSeatChange]);

  useEffect(() => {
    if (!enabled) return;
    if (!leaveAllNonce) return;
    if (leaveAllExceptBoardKey && leaveAllExceptBoardKey === boardKey) return;
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN)
      return;

    (Object.keys(netState.seats) as TeamSeat[]).forEach((seat) => {
      if (netState.seats[seat]?.connId === chessSelfId) {
        send({ type: "leave", seat });
      }
    });
  }, [
    enabled,
    leaveAllNonce,
    leaveAllExceptBoardKey,
    boardKey,
    netState.seats,
    chessSelfId,
  ]);

  useEffect(() => {
    if (!enabled) return;
    if (!chessConnected) return;

    const socket = new PartySocket({
      host: PARTYKIT_HOST,
      party: "chess4",
      room: `${roomId}-chess4-${boardKey}`,
    });

    socketRef.current = socket;

    socket.addEventListener("open", () => {
      if (!activeModeRef.current) return;
      setChessSelfId(socket.id);
      const pendingSeat = pendingJoinRef.current;
      if (pendingSeat) {
        pendingJoinRef.current = null;
        send({ type: "join", seat: pendingSeat });
      }
    });

    socket.addEventListener("message", (event) => {
      if (!activeModeRef.current) return;
      try {
        const msg = JSON.parse(event.data) as Chess4Message;

        if (msg.type === "seats") {
          setNetState((prev) => {
            if (msg.seq <= prev.seq) return prev;

            let changed = false;
            (
              Object.keys(msg.seats) as Array<keyof Chess4NetState["seats"]>
            ).forEach((seat) => {
              const a = prev.seats[seat];
              const b = msg.seats[seat];
              if (a === null && b === null) return;
              if (a === null || b === null) {
                changed = true;
                return;
              }
              if (
                a.connId !== b.connId ||
                a.playerId !== b.playerId ||
                a.name !== b.name
              ) {
                changed = true;
              }
            });
            if (!changed) return prev;

            return { ...prev, seats: msg.seats, seq: msg.seq };
          });
          return;
        }

        if (msg.type === "state") {
          setNetState((prev) => {
            if (msg.state.seq < prev.seq) return prev;
            if (msg.state.seq === prev.seq && msg.state.fen === prev.fen)
              return prev;
            return msg.state;
          });
        }
      } catch (err) {
        console.error("[Chess4] Error parsing message:", err);
      }
    });

    return () => {
      socket.close();
    };
  }, [enabled, chessConnected, roomId, boardKey]);

  const lastSeenSeqRef = useRef<number>(-1);
  useEffect(() => {
    if (netState.seq === lastSeenSeqRef.current) return;
    lastSeenSeqRef.current = netState.seq;
    setSelected(null);
    setLegalTargets([]);
  }, [netState.seq]);

  const pendingMoveRef = useRef(false);
  const pendingMoveSentSeqRef = useRef<number | null>(null);

  useEffect(() => {
    if (!pendingMoveRef.current) return;
    const sentSeq = pendingMoveSentSeqRef.current;
    if (sentSeq === null) return;
    if (netState.seq <= sentSeq) return;

    pendingMoveRef.current = false;
    pendingMoveSentSeqRef.current = null;
    onActivityMove?.();
  }, [netState.seq, onActivityMove]);

  const requestJoin = (seat: TeamSeat) => {
    const info = netState.seats[seat];
    if (info && info.connId !== chessSelfId) return;
    send({ type: "join", seat, playerId: selfId, name: selfName });
  };

  const requestLeave = (seat: TeamSeat) => {
    send({ type: "leave", seat });
  };

  const canMoveNow =
    enabled && isSeated && !netState.result && mySides.has(turn);

  const submitMove = (
    from: Square,
    to: Square,
    promotion?: "q" | "r" | "b" | "n"
  ) => {
    if (!canMoveNow) return;
    pendingMoveRef.current = true;
    pendingMoveSentSeqRef.current = netState.seq;
    send({ type: "move", from, to, promotion });
  };

  const onPickSquare = (square: Square) => {
    if (!enabled) return;
    if (netState.result) return;
    if (!canMoveNow) {
      setSelected(null);
      setLegalTargets([]);
      return;
    }

    if (selected && legalTargets.includes(square)) {
      const piece = chess.get(selected);
      const isPawn = piece?.type === "p";
      const toRank = Number(square[1]);
      const isPromotion =
        isPawn && (toRank === 1 || toRank === 8) ? true : false;

      submitMove(selected, square, isPromotion ? "q" : undefined);
      setSelected(null);
      setLegalTargets([]);
      return;
    }

    const piece = chess.get(square);
    if (piece && piece.color === turn) {
      setSelected(square);
      const verboseMoves = chess.moves({
        square,
        verbose: true,
      }) as unknown as Array<{
        to: string;
      }>;
      const targets = verboseMoves.map((m) => m.to).filter(isSquare);
      setLegalTargets(targets);
      return;
    }

    setSelected(null);
    setLegalTargets([]);
  };

  const onPickPiece = (square: Square) => {
    onPickSquare(square);
  };

  useFrame(() => {
    if (!enabled) return;
    const pos = selfPositionRef.current;
    if (!pos) return;

    if (!chessConnectedRef.current) {
      const dx = pos.x - originVec.x;
      const dz = pos.z - originVec.z;
      const near = dx * dx + dz * dz < connectRadius * connectRadius;
      if (near) {
        chessConnectedRef.current = true;
        setChessConnected(true);
      }
    }
  });

  const pieces = useMemo(() => {
    const out: Array<{ square: Square; type: string; color: Side }> = [];
    const board = chess.board();
    const files = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;

    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const p = board[r]?.[f];
        if (!p) continue;
        const file = files[f]!;
        const rank = 8 - r;
        const sq = `${file}${rank}`;
        if (!isSquare(sq)) continue;
        out.push({ square: sq, type: p.type, color: p.color });
      }
    }

    return out;
  }, [chess]);

  const [clockNow, setClockNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    if (!netState.clock.running) return;
    const id = window.setInterval(() => setClockNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [enabled, netState.clock.running]);

  const clocks = useMemo(() => {
    const c = netState.clock;
    const now = c.running ? clockNow : Date.now();
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
    netState.fen === initialFen &&
    (isSeated || !allSeatsOccupied);

  const boardOrientation: "white" | "black" =
    myPrimarySide === "b" ? "black" : "white";

  const canMove2d = canMoveNow;

  const tryMove2d = (
    from: string,
    to: string,
    promotion?: "q" | "r" | "b" | "n"
  ) => {
    if (!canMoveNow) return false;

    const source = from as Square;
    const target = to as Square;
    const tmp = new Chess(netState.fen);
    const piece = tmp.get(source);
    if (!piece) return false;
    if (piece.color !== turn) return false;

    let promo = promotion;
    if (piece.type === "p") {
      const rank = String(target[1] ?? "");
      if ((rank === "1" || rank === "8") && !promo) promo = "q";
    }

    const mv = tmp.move({ from: source, to: target, promotion: promo });
    if (!mv) return false;

    send({ type: "move", from: source, to: target, promotion: promo });
    setSelected(null);
    setLegalTargets([]);
    return true;
  };

  const centerCamera = () => {
    onCenterCamera?.([originVec.x, originVec.y, originVec.z]);
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

  const clickReset = () => {
    if (!isSeated && allSeatsOccupied) return;
    send({ type: "reset" });
  };

  const setTimeControlByIndex = (nextIdx: number) => {
    if (!canConfigure) return;
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
    const idx = clamp(nextIdx, 0, INCREMENT_OPTIONS_SECONDS.length - 1);
    const incSecs = INCREMENT_OPTIONS_SECONDS[idx]!;
    const currentBaseSecs = Math.round(clocks.baseMs / 1000);
    send({
      type: "setTime",
      baseSeconds: currentBaseSecs,
      incrementSeconds: incSecs,
    });
  };

  const resultLabel = useMemo(() => {
    const r = netState.result;
    if (!r) return null;
    if (r.type === "timeout") return `${winnerLabel(r.winner)} wins (time)`;
    if (r.type === "checkmate") return `${winnerLabel(r.winner)} wins (mate)`;
    if (r.type === "draw") return `Draw (${r.reason})`;
    return null;
  }, [netState.result]);

  const emitControlsOpen = () => {
    if (!enabled) return;
    if (!canUseControlTV) return;

    onBoardControls?.({
      type: "open",
      boardKey,
      lobby,
      timeMinutes: Math.round(clocks.baseMs / 60000),
      incrementSeconds: Math.round(clocks.incrementMs / 1000),
      fen: netState.fen,
      mySide: myPrimarySide,
      turn,
      boardOrientation,
      canMove2d,
      canInc: canConfigure && timeIndex < TIME_OPTIONS_SECONDS.length - 1,
      canDec: canConfigure && timeIndex > 0,
      canIncIncrement:
        canConfigure && incrementIndex < INCREMENT_OPTIONS_SECONDS.length - 1,
      canDecIncrement: canConfigure && incrementIndex > 0,
      canReset: isSeated || !allSeatsOccupied,
      canCenter: !!onCenterCamera,
      onMove2d: tryMove2d,
      onInc: () => setTimeControlByIndex(timeIndex + 1),
      onDec: () => setTimeControlByIndex(timeIndex - 1),
      onIncIncrement: () => setIncrementByIndex(incrementIndex + 1),
      onDecIncrement: () => setIncrementByIndex(incrementIndex - 1),
      onReset: clickReset,
      onCenter: centerCamera,
    });
  };

  const emit2dSync = () => {
    if (!enabled) return;
    onBoardControls?.({
      type: "sync2d",
      boardKey,
      lobby,
      fen: netState.fen,
      mySide: myPrimarySide,
      turn,
      boardOrientation,
      canMove2d,
      onMove2d: tryMove2d,
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
    if (!enabled) return;
    if (!board2dOpen) return;
    emit2dSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    board2dOpen,
    netState.fen,
    myPrimarySide,
    turn,
    netState.result,
    canMove2d,
    isSeated,
  ]);

  const joinScheduleRef = useRef<number | null>(null);

  const clickJoin = (seat: TeamSeat) => {
    if (joinLockedBoardKey && joinLockedBoardKey !== boardKey) return;

    onJoinIntent?.(boardKey);
    setPendingJoinSeat(seat);

    if (joinScheduleRef.current) {
      window.clearTimeout(joinScheduleRef.current);
      joinScheduleRef.current = null;
    }

    joinScheduleRef.current = window.setTimeout(() => {
      joinScheduleRef.current = null;

      const seatInfo = netState.seats[seat];
      const mine = seatInfo?.connId === chessSelfId;

      if (!chessConnectedRef.current) {
        pendingJoinRef.current = seat;
        chessConnectedRef.current = true;
        setChessConnected(true);
        return;
      }

      if (
        !socketRef.current ||
        socketRef.current.readyState !== WebSocket.OPEN
      ) {
        pendingJoinRef.current = seat;
        return;
      }

      if (mine) {
        requestLeave(seat);
        setPendingJoinSeat(null);
        return;
      }

      requestJoin(seat);
    }, 0);
  };

  const prevIsSeatedRef = useRef(false);
  useEffect(() => {
    if (!enabled) {
      prevIsSeatedRef.current = false;
      return;
    }

    const wasSeated = prevIsSeatedRef.current;
    prevIsSeatedRef.current = isSeated;

    if (isSeated && !wasSeated) {
      onCenterCamera?.([originVec.x, originVec.y, originVec.z]);
    }
  }, [enabled, isSeated, onCenterCamera, originVec]);

  return {
    originVec,
    squareSize,
    boardSize,
    netState,
    chessSelfId,
    turn,
    mySides,
    myPrimarySide,
    isSeated,
    selected,
    legalTargets,
    hoveredSquare,
    setHoveredSquare,
    lastMove,
    pieces,
    pendingJoinSeat,
    clocks,
    timeIndex,
    incrementIndex,
    canConfigure,
    boardOrientation,
    canMove2d,
    onPickSquare,
    onPickPiece,
    clickJoin,
    setTimeControlByIndex,
    setIncrementByIndex,
    clickReset,
    requestSitAt,
    centerCamera,
    emitControlsOpen,
    resultLabel,
  };
}

export function Chess4Piece({
  square,
  type,
  color,
  origin,
  squareSize,
  chessTheme,
  canMove,
  onPickPiece,
}: {
  square: Square;
  type: string;
  color: Side;
  origin: THREE.Vector3;
  squareSize: number;
  chessTheme?: string;
  canMove: boolean;
  onPickPiece: (square: Square) => void;
}) {
  const pos = useMemo(
    () => squareCenter(square, origin, squareSize),
    [square, origin, squareSize]
  );

  const whiteTint = useMemo(() => new THREE.Color("#e8e8e8"), []);
  const blackTint = useMemo(() => new THREE.Color("#1c1c1c"), []);
  const tint = color === "w" ? whiteTint : blackTint;
  const scale = 11.25;

  return (
    <group
      position={[pos.x, origin.y + 0.04, pos.z]}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        onPickPiece(square);
      }}
      onPointerEnter={() => {
        if (canMove) document.body.style.cursor = "pointer";
      }}
      onPointerLeave={() => {
        document.body.style.cursor = "default";
      }}
    >
      <group scale={[scale, scale, scale]}>
        <PieceModel
          path={piecePath(type)}
          tint={tint}
          chessTheme={chessTheme}
          side={color}
        />
      </group>
    </group>
  );
}
