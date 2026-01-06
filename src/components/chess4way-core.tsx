"use client";

import { useFrame } from "@react-three/fiber";
import PartySocket from "partysocket";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { Vec3 } from "@/lib/partyRoom";
import {
  clamp,
  piecePath,
  PieceModel,
  TIME_OPTIONS_SECONDS,
  INCREMENT_OPTIONS_SECONDS,
} from "./chess-core";

export type Color4 = "r" | "g" | "y" | "b";
export type Variant4 = "2v2" | "ffa";
export type PieceType4 = "p" | "n" | "b" | "r" | "q" | "k";

export type SeatInfo4 = {
  connId: string;
  playerId: string;
  name: string;
};

export type ClockState4 = {
  baseMs: number;
  incrementMs: number;
  remainingMs: Record<Color4, number>;
  running: boolean;
  active: Color4;
  lastTickMs: number | null;
};

export type Chess4NetState = {
  variant: Variant4;
  seats: Record<Color4, SeatInfo4 | null>;
  pieces: Record<string, { t: PieceType4; c: Color4; pp?: true }>;
  defeated: Partial<Record<Color4, true>>;
  scores: Record<Color4, number>;
  turn: Color4;
  seq: number;
  clock: ClockState4;
  result:
    | { type: "win"; variant: Variant4; winner: Color4 | "ry" | "bg" }
    | { type: "timeout"; variant: Variant4; winner: Color4 | "ry" | "bg" }
    | null;
  claimable: {
    leader: Color4;
    runnerUp: Color4;
    lead: number;
  } | null;
  lastMove: { from: string; to: string } | null;
};

type Chess4Message =
  | { type: "state"; state: Chess4NetState }
  | { type: "seats"; seats: Chess4NetState["seats"]; seq: number }
  | { type: "teamArrow"; from: string; to: string; by: Color4 }
  | { type: "teamClearArrows"; by: Color4 };

export type TeamArrow4 = {
  from: string;
  to: string;
  by: Color4;
};

function normalizeChess4State(
  raw: any,
  fallbackClock: ClockState4
): Chess4NetState {
  const state = (raw ?? {}) as Partial<Chess4NetState> & {
    eliminated?: Partial<Record<Color4, true>>;
  };

  const defeated = (state.defeated ?? state.eliminated ?? {}) as Partial<
    Record<Color4, true>
  >;

  return {
    variant: state.variant === "ffa" ? "ffa" : "2v2",
    seats: (state.seats as any) ?? { r: null, g: null, y: null, b: null },
    pieces: (state.pieces as any) ?? {},
    defeated,
    scores: (state.scores as any) ?? { r: 0, g: 0, y: 0, b: 0 },
    turn:
      state.turn === "r" ||
      state.turn === "g" ||
      state.turn === "y" ||
      state.turn === "b"
        ? state.turn
        : "r",
    seq: typeof state.seq === "number" ? state.seq : 0,
    clock: (state.clock as any) ?? fallbackClock,
    result: (state.result as any) ?? null,
    claimable: (state.claimable as any) ?? null,
    lastMove: (state.lastMove as any) ?? null,
  };
}

type Chess4SendMessage =
  | { type: "join"; seat: Color4; playerId?: string; name?: string }
  | { type: "leave"; seat: Color4 }
  | { type: "move"; from: string; to: string }
  | { type: "suggestArrow"; from: string; to: string }
  | { type: "clearArrows" }
  | { type: "claimWin" }
  | { type: "setTime"; baseSeconds: number; incrementSeconds?: number }
  | { type: "setVariant"; variant: Variant4 }
  | { type: "reset" };

type BoardControlsOpenLike = {
  type: "open";
  boardKey: string;
  lobby: "scifi" | "park";
  timeMinutes: number;
  incrementSeconds: number;
  fen: string;
  mySide: "w" | "b" | null;
  turn: "w" | "b";
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
  chess4Variant?: "2v2" | "ffa";
  canSetChess4Variant?: boolean;
  onSetChess4Variant?: (variant: "2v2" | "ffa") => void;
  chess4Scores?: Record<Color4, number>;
  chess4Claimable?: Chess4NetState["claimable"];
  chess4CanClaimWin?: boolean;
  onChess4ClaimWin?: () => void;
};

type BoardControlsEventLike =
  | BoardControlsOpenLike
  | { type: "close"; boardKey?: string }
  | {
      type: "sync2d";
      boardKey: string;
      lobby: "scifi" | "park";
      fen: string;
      mySide: "w" | "b" | null;
      turn: "w" | "b";
      boardOrientation: "white" | "black";
      canMove2d: boolean;
      onMove2d: (
        from: string,
        to: string,
        promotion?: "q" | "r" | "b" | "n"
      ) => boolean;
    };

export type UseChess4WayGameOptions = {
  enabled?: boolean;
  roomId: string;
  boardKey: string;
  origin: [number, number, number];
  selfPositionRef: RefObject<THREE.Vector3>;
  selfId: string;
  selfName?: string;
  onActivityMove?: () => void;
  arrowDragActiveExternalRef?: React.MutableRefObject<boolean>;
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
  onBoardControls?: (event: BoardControlsEventLike) => void;
  controlsOpen?: boolean;
  chessTheme?: string;
  lobby?: "scifi" | "park";
  connectRadius?: number;
};

export type UseChess4WayGameResult = {
  originVec: THREE.Vector3;
  squareSize: number;
  boardSize: number;
  netState: Chess4NetState;
  chessSelfId: string;
  turn: Color4;
  myColors: Set<Color4>;
  myPrimaryColor: Color4 | null;
  isSeated: boolean;
  selected: string | null;
  legalTargets: string[];
  hoveredSquare: string | null;
  setHoveredSquare: (square: string | null) => void;
  teamArrows: TeamArrow4[];
  lastMove: Chess4NetState["lastMove"];
  pieces: Array<{ square: string; type: PieceType4; color: Color4 }>;
  pendingJoinSeat: Color4 | null;
  clocks: {
    remaining: ClockState4["remainingMs"];
    active: Color4 | null;
    baseMs: number;
    incrementMs: number;
    running: boolean;
  };
  timeIndex: number;
  incrementIndex: number;
  canConfigure: boolean;
  canMoveThisTurn: boolean;
  canMove2d: boolean;
  arrowDragActive: boolean;
  onPickSquare: (square: string) => void;
  onPickPiece: (square: string) => void;
  onRightDownSquare: (square: string) => void;
  onRightEnterSquare: (square: string) => void;
  clickJoin: (seat: Color4) => void;
  setVariant: (variant: Variant4) => void;
  setTimeControlByIndex: (idx: number) => void;
  setIncrementByIndex: (idx: number) => void;
  clickReset: () => void;
  claimWin: () => void;
  requestSitAt: (seatX: number, seatZ: number) => void;
  centerCamera: () => void;
  emitControlsOpen: () => void;
  resultLabel: string | null;
};

const PARTYKIT_HOST = process.env.NEXT_PUBLIC_PARTYKIT_HOST || "127.0.0.1:1999";

const FILES_14 = "abcdefghijklmn" as const;

export function isSquare4(val: string): boolean {
  const m = /^([a-n])(\d{1,2})$/i.exec(val);
  if (!m) return false;
  const file = m[1].toLowerCase();
  const rank = Number(m[2]);
  if (!Number.isFinite(rank)) return false;
  if (rank < 1 || rank > 14) return false;
  const f = FILES_14.indexOf(file as (typeof FILES_14)[number]);
  if (f < 0) return false;
  const r = rank - 1;
  const inLeft = f <= 2;
  const inRight = f >= 11;
  const inBottom = r <= 2;
  const inTop = r >= 11;
  if (
    (inLeft && inBottom) ||
    (inLeft && inTop) ||
    (inRight && inBottom) ||
    (inRight && inTop)
  )
    return false;
  return true;
}

function parseSquare4(sq: string): { f: number; r: number } | null {
  if (!isSquare4(sq)) return null;
  const file = sq[0]!.toLowerCase();
  const rank = Number(sq.slice(1));
  const f = FILES_14.indexOf(file as (typeof FILES_14)[number]);
  return { f, r: rank - 1 };
}

function toSquare4(f: number, r: number): string {
  const file = FILES_14[f] ?? "a";
  return `${file}${r + 1}`;
}

function sqKey(f: number, r: number) {
  return `${f},${r}`;
}

export function squareCenter4(
  square: string,
  origin: THREE.Vector3,
  squareSize: number
): THREE.Vector3 {
  const p = parseSquare4(square);
  if (!p) return origin.clone();
  const x = (p.f - 6.5) * squareSize;
  const z = (p.r - 6.5) * squareSize;
  return new THREE.Vector3(origin.x + x, origin.y, origin.z + z);
}

function isValidCoord(f: number, r: number) {
  if (f < 0 || f > 13 || r < 0 || r > 13) return false;
  const inLeft = f <= 2;
  const inRight = f >= 11;
  const inBottom = r <= 2;
  const inTop = r >= 11;
  if (
    (inLeft && inBottom) ||
    (inLeft && inTop) ||
    (inRight && inBottom) ||
    (inRight && inTop)
  )
    return false;
  return true;
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

function teamOf(c: Color4): "ry" | "bg" {
  return c === "r" || c === "y" ? "ry" : "bg";
}

function isFriendly(variant: Variant4, a: Color4, b: Color4) {
  if (a === b) return true;
  if (variant === "2v2") return teamOf(a) === teamOf(b);
  return false;
}

function genMovesForPiece(
  pieces: Chess4NetState["pieces"],
  from: { f: number; r: number },
  piece: { t: PieceType4; c: Color4 },
  variant: Variant4
): Array<{ f: number; r: number }> {
  const at = (f: number, r: number) => pieces[sqKey(f, r)] ?? null;
  const out: Array<{ f: number; r: number }> = [];
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
      if (df === 0) {
        addIf(from.f - 1, from.r + dr);
        addIf(from.f + 1, from.r + dr);
      } else {
        addIf(from.f + df, from.r - 1);
        addIf(from.f + df, from.r + 1);
      }
      return out.filter(({ f, r }) => {
        if (f === f1 && r === r1) return true;
        if (canDouble && f === f2 && r === r2) return true;
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

function colorName(c: Color4) {
  switch (c) {
    case "r":
      return "Red";
    case "g":
      return "Green";
    case "y":
      return "Yellow";
    case "b":
      return "Blue";
  }
}

export function useChess4WayGame({
  enabled = true,
  roomId,
  boardKey,
  origin,
  selfPositionRef,
  selfId,
  selfName,
  onActivityMove,
  arrowDragActiveExternalRef,
  joinLockedBoardKey,
  leaveAllNonce,
  leaveAllExceptBoardKey,
  onJoinIntent,
  onSelfSeatChange,
  onRequestMove,
  onCenterCamera,
  onBoardControls,
  controlsOpen,
  chessTheme,
  lobby = "park",
  connectRadius = 12,
}: UseChess4WayGameOptions): UseChess4WayGameResult {
  const originVec = useMemo(
    () => new THREE.Vector3(origin[0], origin[1], origin[2]),
    [origin]
  );
  const squareSize = 0.5;
  const boardSize = squareSize * 14;

  const socketRef = useRef<PartySocket | null>(null);
  const [chessSelfId, setChessSelfId] = useState<string>("");
  const [chessConnected, setChessConnected] = useState(false);
  const chessConnectedRef = useRef(false);

  const pendingJoinRef = useRef<Color4 | null>(null);
  const [pendingJoinSeat, setPendingJoinSeat] = useState<Color4 | null>(null);

  const activeModeRef = useRef(true);
  useEffect(() => {
    activeModeRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    chessConnectedRef.current = chessConnected;
  }, [chessConnected]);

  // Unlike the other boards, this 4-way chess table is always present at the
  // center of the world. Always connect so seats/pieces update reliably.
  useEffect(() => {
    if (!enabled) return;
    if (!chessConnectedRef.current) setChessConnected(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const defaultClock = useMemo<ClockState4>(() => {
    const baseMs = 5 * 60 * 1000;
    return {
      baseMs,
      incrementMs: 0,
      remainingMs: { r: baseMs, g: baseMs, y: baseMs, b: baseMs },
      running: false,
      active: "r",
      lastTickMs: null,
    };
  }, []);

  const [netState, setNetState] = useState<Chess4NetState>(() => ({
    variant: "2v2",
    seats: { r: null, g: null, y: null, b: null },
    pieces: {},
    defeated: {},
    scores: { r: 0, g: 0, y: 0, b: 0 },
    turn: "r",
    seq: -1, // Start at -1 so the server's initial seq: 0 will be accepted
    clock: defaultClock,
    result: null,
    claimable: null,
    lastMove: null,
  }));

  const myColors = useMemo(() => {
    const colors = new Set<Color4>();
    (Object.keys(netState.seats) as Color4[]).forEach((c) => {
      if (netState.seats[c]?.connId === chessSelfId) colors.add(c);
    });
    return colors;
  }, [netState.seats, chessSelfId]);

  const myPrimaryColor = useMemo<Color4 | null>(() => {
    const all = ["r", "g", "y", "b"] as const;
    for (const c of all) {
      if (netState.seats[c]?.connId === chessSelfId) return c;
    }
    return null;
  }, [netState.seats, chessSelfId]);

  const isSeated = myColors.size > 0;

  useEffect(() => {
    onSelfSeatChange?.(boardKey, isSeated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSeated]);

  const [selected, setSelected] = useState<string | null>(null);
  const [legalTargets, setLegalTargets] = useState<string[]>([]);
  const [hoveredSquare, setHoveredSquare] = useState<string | null>(null);

  const [teamArrows, setTeamArrows] = useState<
    Array<TeamArrow4 & { expiresAtMs: number }>
  >([]);

  const arrowDragActiveInternalRef = useRef(false);
  const arrowDragStartRef = useRef<string | null>(null);
  const arrowDragEndRef = useRef<string | null>(null);
  const [arrowDragActive, setArrowDragActive] = useState(false);

  const pieces = useMemo(() => {
    const out: Array<{ square: string; type: PieceType4; color: Color4 }> = [];
    for (const [k, p] of Object.entries(netState.pieces)) {
      const [fStr, rStr] = k.split(",");
      const f = Number(fStr);
      const r = Number(rStr);
      if (!Number.isFinite(f) || !Number.isFinite(r)) continue;
      const sq = toSquare4(f, r);
      if (!isSquare4(sq)) continue;
      out.push({ square: sq, type: p.t, color: p.c });
    }
    return out;
  }, [netState.pieces]);

  const turn = netState.turn;

  const canMoveThisTurn =
    isSeated &&
    !netState.result &&
    myColors.has(turn) &&
    !netState.defeated[turn];

  const clocks = useMemo(() => {
    return {
      remaining: netState.clock.remainingMs,
      active: netState.clock.running ? netState.clock.active : null,
      baseMs: netState.clock.baseMs,
      incrementMs: netState.clock.incrementMs,
      running: netState.clock.running,
    };
  }, [netState.clock]);

  const timeIndex = useMemo(() => {
    const seconds = Math.round(netState.clock.baseMs / 1000);
    const idx = TIME_OPTIONS_SECONDS.findIndex((s) => s === seconds);
    return idx >= 0 ? idx : 0;
  }, [netState.clock.baseMs]);

  const incrementIndex = useMemo(() => {
    const seconds = Math.round(netState.clock.incrementMs / 1000);
    const idx = INCREMENT_OPTIONS_SECONDS.findIndex((s) => s === seconds);
    return idx >= 0 ? idx : 0;
  }, [netState.clock.incrementMs]);

  const canConfigure = useMemo(() => {
    if (netState.result) return false;
    if (netState.clock.running) return false;
    const anySeatEmpty =
      !netState.seats.r ||
      !netState.seats.g ||
      !netState.seats.y ||
      !netState.seats.b;
    // Allow configuration if at least one seat is open (lobby state), OR if the
    // local player is seated (so a full table can still reset/switch variants).
    return anySeatEmpty || isSeated;
  }, [netState]);

  const canMove2d = false;

  const send = (msg: Chess4SendMessage) => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.send(JSON.stringify(msg));
  };

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
        send({
          type: "join",
          seat: pendingSeat,
          playerId: selfId,
          name: selfName,
        });
      }
    });

    socket.addEventListener("error", (event) => {
      // eslint-disable-next-line no-console
      console.error("[Chess4Way] Socket error:", event);
    });

    socket.addEventListener("close", (event) => {
      // eslint-disable-next-line no-console
      console.warn("[Chess4Way] Socket closed:", event.code, event.reason);
    });

    socket.addEventListener("message", (event) => {
      if (!activeModeRef.current) return;
      try {
        const msg = JSON.parse(event.data) as Chess4Message;
        if (msg?.type === "seats") {
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

        if (msg?.type === "state") {
          const nextState = normalizeChess4State(msg.state, defaultClock);
          setNetState((prev) => {
            // Accept equal `seq` so the initial server state (often seq=0)
            // and reconnects don't get dropped.
            if (nextState.seq < prev.seq) return prev;
            return nextState;
          });
          return;
        }

        if (msg?.type === "teamArrow") {
          if (!isSquare4(msg.from) || !isSquare4(msg.to)) return;
          if (
            msg.by !== "r" &&
            msg.by !== "g" &&
            msg.by !== "y" &&
            msg.by !== "b"
          )
            return;

          const now = Date.now();
          const ttlMs = 10_000;
          setTeamArrows((prev) => {
            const next = prev.filter((a) => a.expiresAtMs > now).slice(-7);
            next.push({
              from: msg.from,
              to: msg.to,
              by: msg.by,
              expiresAtMs: now + ttlMs,
            });
            return next;
          });
        }

        if (msg?.type === "teamClearArrows") {
          setTeamArrows([]);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[Chess4Way] Error parsing message:", err);
      }
    });

    return () => {
      socket.close();
    };
  }, [enabled, chessConnected, roomId, boardKey, selfId, selfName]);

  // Keep `useFrame` import for parity with other boards; no distance gating.
  useFrame(() => {
    return;
  });

  useEffect(() => {
    if (!leaveAllNonce) return;
    if (!isSeated) return;
    if (leaveAllExceptBoardKey && leaveAllExceptBoardKey === boardKey) return;

    (Object.keys(netState.seats) as Color4[]).forEach((seat) => {
      if (netState.seats[seat]?.connId === chessSelfId) {
        send({ type: "leave", seat });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaveAllNonce]);

  const requestJoin = (seat: Color4) => {
    const info = netState.seats[seat];
    if (info && info.connId !== chessSelfId) return;
    send({ type: "join", seat, playerId: selfId, name: selfName });
  };

  const requestLeave = (seat: Color4) => {
    send({ type: "leave", seat });
  };

  const clickJoin = (seat: Color4) => {
    if (joinLockedBoardKey && joinLockedBoardKey !== boardKey) return;
    onJoinIntent?.(boardKey);
    setPendingJoinSeat(seat);
    pendingJoinRef.current = seat;
    if (!chessConnectedRef.current) return;

    const info = netState.seats[seat];
    if (info && info.connId === chessSelfId) {
      requestLeave(seat);
      setPendingJoinSeat(null);
      pendingJoinRef.current = null;
      return;
    }
    requestJoin(seat);
  };

  useEffect(() => {
    if (!pendingJoinSeat) return;
    const info = netState.seats[pendingJoinSeat];
    if (info && info.connId === chessSelfId) {
      setPendingJoinSeat(null);
      pendingJoinRef.current = null;
    }
  }, [pendingJoinSeat, netState.seats, chessSelfId]);

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

  const submitMove = (from: string, to: string) => {
    if (!isSeated) return;
    if (netState.result) return;
    if (!myColors.has(turn)) return;
    pendingMoveRef.current = true;
    pendingMoveSentSeqRef.current = netState.seq;
    send({ type: "move", from, to });

    // Moving a piece clears all team arrows.
    if (netState.variant === "2v2") {
      setTeamArrows([]);
      arrowDragActiveInternalRef.current = false;
      setArrowDragActive(false);
      if (arrowDragActiveExternalRef)
        arrowDragActiveExternalRef.current = false;
      arrowDragStartRef.current = null;
      arrowDragEndRef.current = null;
      send({ type: "clearArrows" });
    }
  };

  const canSuggestArrows =
    netState.variant === "2v2" && isSeated && !netState.result;

  const clearTeamArrows = () => {
    if (!canSuggestArrows) return;
    const mySeat = myPrimaryColor;
    if (!mySeat || netState.defeated?.[mySeat]) return;
    setTeamArrows([]);
    if (arrowDragActiveExternalRef) arrowDragActiveExternalRef.current = false;
    send({ type: "clearArrows" });
  };

  const onRightDownSquare = (square: string) => {
    if (!isSquare4(square)) return;
    if (!canSuggestArrows) return;
    const mySeat = myPrimaryColor;
    if (!mySeat || netState.defeated?.[mySeat]) return;

    arrowDragActiveInternalRef.current = true;
    setArrowDragActive(true);
    if (arrowDragActiveExternalRef) arrowDragActiveExternalRef.current = true;
    arrowDragStartRef.current = square;
    arrowDragEndRef.current = square;
  };

  const onRightEnterSquare = (square: string) => {
    if (!isSquare4(square)) return;
    if (!arrowDragActiveInternalRef.current) return;
    arrowDragEndRef.current = square;
  };

  useEffect(() => {
    const onPointerUp = () => {
      if (!arrowDragActiveInternalRef.current) return;
      arrowDragActiveInternalRef.current = false;
      setArrowDragActive(false);
      if (arrowDragActiveExternalRef)
        arrowDragActiveExternalRef.current = false;

      const from = arrowDragStartRef.current;
      const to = arrowDragEndRef.current;
      arrowDragStartRef.current = null;
      arrowDragEndRef.current = null;

      if (!from || !to) return;
      if (from === to) {
        clearTeamArrows();
        return;
      }
      send({ type: "suggestArrow", from, to });
    };

    const onContextMenu = (e: MouseEvent) => {
      if (arrowDragActiveInternalRef.current) e.preventDefault();
    };

    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("contextmenu", onContextMenu);
    return () => {
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("contextmenu", onContextMenu);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [netState.variant, isSeated, myPrimaryColor]);

  const onPickSquare = (square: string) => {
    if (!isSquare4(square)) return;

    if (!canMoveThisTurn) return;

    if (selected && legalTargets.includes(square)) {
      submitMove(selected, square);
      return;
    }

    const from = parseSquare4(square);
    if (!from) {
      setSelected(null);
      setLegalTargets([]);
      return;
    }
    const key = sqKey(from.f, from.r);
    const p = netState.pieces[key] ?? null;
    if (!p) {
      setSelected(null);
      setLegalTargets([]);
      return;
    }
    if (p.c !== turn || !myColors.has(p.c)) {
      setSelected(null);
      setLegalTargets([]);
      return;
    }

    setSelected(square);
    const moves = genMovesForPiece(netState.pieces, from, p, netState.variant)
      .map((m) => toSquare4(m.f, m.r))
      .filter(isSquare4);
    setLegalTargets(moves);
  };

  const onPickPiece = (square: string) => {
    onPickSquare(square);
  };

  const setVariant = (variant: Variant4) => {
    if (!canConfigure) return;
    send({ type: "setVariant", variant });
  };

  const setTimeControlByIndex = (idx: number) => {
    if (!canConfigure) return;
    const seconds = TIME_OPTIONS_SECONDS[idx] ?? TIME_OPTIONS_SECONDS[0];
    send({
      type: "setTime",
      baseSeconds: seconds,
      incrementSeconds: netState.clock.incrementMs / 1000,
    });
  };

  const setIncrementByIndex = (idx: number) => {
    if (!canConfigure) return;
    const seconds =
      INCREMENT_OPTIONS_SECONDS[idx] ?? INCREMENT_OPTIONS_SECONDS[0];
    send({
      type: "setTime",
      baseSeconds: netState.clock.baseMs / 1000,
      incrementSeconds: seconds,
    });
  };

  const clickReset = () => {
    send({ type: "reset" });
  };

  const claimWin = () => {
    send({ type: "claimWin" });
  };

  const requestSitAt = (seatX: number, seatZ: number) => {
    if (!onRequestMove) return;
    const dest: Vec3 = [seatX, originVec.y, seatZ];
    onRequestMove(dest, {
      rotY: Math.atan2(originVec.x - seatX, originVec.z - seatZ),
      sit: true,
      sitDest: [seatX, originVec.y, seatZ],
      lookAtTarget: [originVec.x, originVec.y + 1.2, originVec.z],
    });
  };

  const centerCamera = () => {
    onCenterCamera?.([originVec.x, originVec.y + 1.2, originVec.z]);
  };

  const emitControlsOpen = () => {
    if (!onBoardControls) return;

    const baseSeconds = Math.round(netState.clock.baseMs / 1000);
    const incSeconds = Math.round(netState.clock.incrementMs / 1000);

    const canReset =
      !netState.seats.r ||
      !netState.seats.g ||
      !netState.seats.y ||
      !netState.seats.b ||
      isSeated;

    onBoardControls({
      type: "open",
      boardKey,
      lobby,
      timeMinutes: Math.max(1, Math.round(baseSeconds / 60)),
      incrementSeconds: incSeconds,
      fen: "",
      mySide: null,
      turn: "w",
      boardOrientation: "white",
      canMove2d: false,
      canInc: canConfigure,
      canDec: canConfigure,
      canIncIncrement: canConfigure,
      canDecIncrement: canConfigure,
      canReset,
      canCenter: true,
      chess4Variant: netState.variant,
      canSetChess4Variant: canConfigure,
      onSetChess4Variant: (v) => setVariant(v),
      chess4Scores: netState.scores,
      chess4Claimable: netState.claimable,
      chess4CanClaimWin:
        netState.variant === "ffa" &&
        !!netState.claimable &&
        netState.claimable.leader === myPrimaryColor &&
        !netState.result,
      onChess4ClaimWin: claimWin,
      onMove2d: () => false,
      onInc: () =>
        setTimeControlByIndex(
          Math.min(TIME_OPTIONS_SECONDS.length - 1, timeIndex + 1)
        ),
      onDec: () => setTimeControlByIndex(Math.max(0, timeIndex - 1)),
      onIncIncrement: () =>
        setIncrementByIndex(
          Math.min(INCREMENT_OPTIONS_SECONDS.length - 1, incrementIndex + 1)
        ),
      onDecIncrement: () =>
        setIncrementByIndex(Math.max(0, incrementIndex - 1)),
      onReset: clickReset,
      onCenter: centerCamera,
    });
  };

  useEffect(() => {
    if (!controlsOpen) return;
    emitControlsOpen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    controlsOpen,
    netState.seq,
    netState.clock,
    netState.result,
    netState.variant,
    myPrimaryColor,
  ]);

  const resultLabel = useMemo(() => {
    const r = netState.result;
    if (!r) return null;
    const label =
      r.winner === "ry"
        ? "Red/Yellow"
        : r.winner === "bg"
        ? "Blue/Green"
        : colorName(r.winner);
    const why = r.type === "timeout" ? "wins on time" : "wins";
    return `${label} ${why}`;
  }, [netState.result]);

  return {
    originVec,
    squareSize,
    boardSize,
    netState,
    chessSelfId,
    turn,
    myColors,
    myPrimaryColor,
    isSeated,
    selected,
    legalTargets,
    hoveredSquare,
    setHoveredSquare,
    teamArrows: teamArrows
      .filter((a) => a.expiresAtMs > Date.now())
      .map(({ expiresAtMs: _expiresAtMs, ...rest }) => rest),
    lastMove: netState.lastMove,
    pieces,
    pendingJoinSeat,
    clocks,
    timeIndex,
    incrementIndex,
    canConfigure,
    canMoveThisTurn,
    canMove2d,
    arrowDragActive,
    onPickSquare,
    onPickPiece,
    onRightDownSquare,
    onRightEnterSquare,
    clickJoin,
    setVariant,
    setTimeControlByIndex,
    setIncrementByIndex,
    clickReset,
    claimWin,
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
  defeated,
  origin,
  squareSize,
  chessTheme,
  canMove,
  onPickPiece,
}: {
  square: string;
  type: PieceType4;
  color: Color4;
  defeated?: boolean;
  origin: THREE.Vector3;
  squareSize: number;
  chessTheme?: string;
  canMove: boolean;
  onPickPiece: (square: string) => void;
}) {
  const pos = useMemo(
    () => squareCenter4(square, origin, squareSize),
    [square, origin, squareSize]
  );

  const tint = useMemo(() => {
    if (defeated) return new THREE.Color("#8d8d8d");
    switch (color) {
      case "r":
        return new THREE.Color("#ff3b3b");
      case "g":
        return new THREE.Color("#37ff70");
      case "y":
        return new THREE.Color("#ffe14a");
      case "b":
        return new THREE.Color("#3aa0ff");
    }
  }, [color, defeated]);

  const side = color === "r" || color === "y" ? "w" : "b";
  // Match the piece sizing used on the standard 8x8 outdoor board.
  // Standard board uses squareSize=0.6 and piece scale=11.25.
  const scale = (11.25 * squareSize) / 0.6;

  return (
    <group
      position={[pos.x, pos.y + 0.08, pos.z]}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        if (!canMove) return;
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
          side={side}
        />
      </group>
    </group>
  );
}
