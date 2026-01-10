"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import type { BoardControlsEvent, LobbyKind } from "./chess-core";

export type PuzzleRushDifficulty =
  | "easiest"
  | "easier"
  | "normal"
  | "harder"
  | "hardest";

type LichessPuzzleNext = {
  game: {
    id: string;
    pgn: string;
  };
  puzzle: {
    id: string;
    rating: number;
    plays: number;
    solution: string[];
    themes: string[];
    initialPly: number;
  };
};

function difficultyForScore(score: number): PuzzleRushDifficulty {
  if (score < 3) return "easiest";
  if (score < 6) return "easier";
  if (score < 10) return "normal";
  if (score < 14) return "harder";
  return "hardest";
}

function parseUci(
  uci: string
): { from: string; to: string; promotion?: "q" | "r" | "b" | "n" } | null {
  const cleaned = (uci ?? "").toString().trim();
  if (cleaned.length !== 4 && cleaned.length !== 5) return null;
  const from = cleaned.slice(0, 2);
  const to = cleaned.slice(2, 4);
  const promo = cleaned.length === 5 ? (cleaned[4] as any) : undefined;
  if (promo && !"qrbn".includes(promo)) return null;
  return { from, to, promotion: promo };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export function usePuzzleRushGame(opts: {
  enabled: boolean;
  roomId: string;
  boardKey: string;
  lobby: LobbyKind;
  controlsOpen: boolean;
  board2dOpen: boolean;
  onBoardControls?: (event: BoardControlsEvent) => void;
}) {
  const {
    enabled,
    roomId,
    boardKey,
    lobby,
    controlsOpen,
    board2dOpen,
    onBoardControls,
  } = opts;

  const [running, setRunning] = useState(false);
  const [score, setScore] = useState(0);
  const [difficulty, setDifficulty] = useState<PuzzleRushDifficulty>("easiest");
  const [puzzleId, setPuzzleId] = useState<string | null>(null);

  const chessRef = useRef<Chess>(new Chess());
  const solutionRef = useRef<string[]>([]);
  const solutionIndexRef = useRef(0);

  const endsAtMsRef = useRef<number | null>(null);
  const [clockTick, setClockTick] = useState(0);

  const [fen, setFen] = useState(chessRef.current.fen());
  const [turn, setTurn] = useState<"w" | "b">("w");

  const remainingMs = useMemo(() => {
    const end = endsAtMsRef.current;
    if (!running || !end) return 0;
    return clamp(end - Date.now(), 0, 3 * 60 * 1000);
  }, [running, clockTick]);

  const sync2d = useCallback(() => {
    if (!enabled) return;
    if (!onBoardControls) return;

    const rm = endsAtMsRef.current;
    const rem = running && rm ? clamp(rm - Date.now(), 0, 3 * 60 * 1000) : 0;

    onBoardControls({
      type: "sync2d",
      boardKey,
      lobby,
      fen,
      mySide: turn,
      turn,
      boardOrientation: turn === "b" ? "black" : "white",
      canMove2d: enabled && running && !!puzzleId && rem > 0,
      clockRemainingMs: { w: rem, b: rem },
      clockRunning: enabled && running && rem > 0,
      clockActive: "w",
      clockSnapshotAtMs: Date.now(),
      puzzleRushRunning: enabled && running && rem > 0,
      puzzleRushScore: score,
      puzzleRushDifficulty: difficulty,
      puzzleRushPuzzleId: puzzleId ?? undefined,
      onMove2d: () => false, // replaced below via a stable handler
    } as any);
  }, [
    enabled,
    onBoardControls,
    boardKey,
    lobby,
    fen,
    turn,
    running,
    puzzleId,
    score,
    difficulty,
  ]);

  // Stable onMove2d that we inject into the event objects.
  const tryMove2d = useCallback(
    (from: string, to: string, promotion?: "q" | "r" | "b" | "n") => {
      if (!enabled) return false;
      if (!running) return false;
      if (!puzzleId) return false;
      const end = endsAtMsRef.current;
      if (!end || Date.now() >= end) return false;

      const solution = solutionRef.current;
      const idx = solutionIndexRef.current;
      const expected = solution[idx] ?? "";
      const expectedParsed = parseUci(expected);
      if (!expectedParsed) return false;

      const wantPromo = expectedParsed.promotion;
      const promo = wantPromo ?? promotion;

      const candidate = `${from}${to}${wantPromo ? wantPromo : promo ?? ""}`;
      if (candidate !== expected) return false;

      const chess = chessRef.current;
      const moved = chess.move({ from, to, promotion: wantPromo ?? promo });
      if (!moved) return false;

      solutionIndexRef.current = idx + 1;

      // Auto-play opponent replies (odd indices).
      while (
        solutionIndexRef.current < solution.length &&
        solutionIndexRef.current % 2 === 1
      ) {
        const uci = solution[solutionIndexRef.current] ?? "";
        const m = parseUci(uci);
        if (!m) break;
        const ok = chess.move({
          from: m.from,
          to: m.to,
          promotion: m.promotion,
        });
        if (!ok) break;
        solutionIndexRef.current += 1;
      }

      setFen(chess.fen());
      setTurn(chess.turn());

      if (solutionIndexRef.current >= solution.length) {
        setScore((s) => s + 1);
      }

      return true;
    },
    [enabled, running, puzzleId]
  );

  const fetchNextPuzzle = useCallback(
    async (nextDifficulty: PuzzleRushDifficulty) => {
      const url = new URL("/api/lichess/puzzle/next", window.location.origin);
      // Mirror the url the user provided.
      url.searchParams.set("angle", "");
      url.searchParams.set("difficulty", nextDifficulty);
      url.searchParams.set("color", "white");

      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok)
        throw new Error(`Lichess puzzle fetch failed: ${res.status}`);
      const data = (await res.json()) as LichessPuzzleNext;

      const chess = new Chess();
      try {
        chess.loadPgn(data.game.pgn);
      } catch {
        throw new Error("Failed to load puzzle PGN");
      }

      const targetPly = Math.max(0, Math.floor(data.puzzle.initialPly ?? 0));
      while (chess.history().length > targetPly) chess.undo();

      chessRef.current = chess;
      solutionRef.current = Array.isArray(data.puzzle.solution)
        ? data.puzzle.solution
        : [];
      solutionIndexRef.current = 0;

      setPuzzleId(data.puzzle.id);
      setFen(chess.fen());
      setTurn(chess.turn());
    },
    []
  );

  const start = useCallback(async () => {
    if (!enabled) return;

    setScore(0);
    setDifficulty("easiest");
    setRunning(true);
    endsAtMsRef.current = Date.now() + 3 * 60 * 1000;

    try {
      await fetchNextPuzzle("easiest");
    } catch {
      // If lichess is unreachable, still start the timer but remain without a puzzle.
      setPuzzleId(null);
      chessRef.current = new Chess();
      setFen(chessRef.current.fen());
      setTurn(chessRef.current.turn());
    }
  }, [enabled, fetchNextPuzzle]);

  const stop = useCallback(() => {
    setRunning(false);
    endsAtMsRef.current = null;
  }, []);

  // Drive the 3-minute clock and refresh sync2d for TVs.
  useEffect(() => {
    if (!enabled) return;
    if (!running) return;

    const id = window.setInterval(() => setClockTick((v) => v + 1), 250);
    return () => window.clearInterval(id);
  }, [enabled, running]);

  // When score increases, ramp difficulty and fetch the next puzzle.
  const lastScoreRef = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    if (!running) return;
    if (score === lastScoreRef.current) return;

    lastScoreRef.current = score;
    const nextDifficulty = difficultyForScore(score);
    setDifficulty(nextDifficulty);

    const end = endsAtMsRef.current;
    if (!end || Date.now() >= end) return;

    void (async () => {
      try {
        await fetchNextPuzzle(nextDifficulty);
      } catch {
        // ignore; keep current position
      }
    })();
  }, [enabled, running, score, fetchNextPuzzle]);

  // Stop automatically when time runs out.
  useEffect(() => {
    if (!enabled) return;
    if (!running) return;

    const end = endsAtMsRef.current;
    if (!end) return;
    if (Date.now() < end) return;
    setRunning(false);
  }, [enabled, running, clockTick]);

  // Emit sync2d updates so Wall TVs can show the puzzle + score/time.
  useEffect(() => {
    if (!enabled) return;
    if (!onBoardControls) return;

    const rm = endsAtMsRef.current;
    const rem = running && rm ? clamp(rm - Date.now(), 0, 3 * 60 * 1000) : 0;

    onBoardControls({
      type: "sync2d",
      boardKey,
      lobby,
      fen,
      mySide: turn,
      turn,
      boardOrientation: turn === "b" ? "black" : "white",
      canMove2d: enabled && running && !!puzzleId && rem > 0,
      clockRemainingMs: { w: rem, b: rem },
      clockRunning: enabled && running && rem > 0,
      clockActive: "w",
      clockSnapshotAtMs: Date.now(),
      puzzleRushRunning: enabled && running && rem > 0,
      puzzleRushScore: score,
      puzzleRushDifficulty: difficulty,
      puzzleRushPuzzleId: puzzleId ?? undefined,
      onMove2d: tryMove2d,
    } as any);
  }, [
    enabled,
    onBoardControls,
    boardKey,
    lobby,
    fen,
    turn,
    running,
    puzzleId,
    clockTick,
    score,
    difficulty,
    tryMove2d,
  ]);

  const emitControlsOpen = useCallback(() => {
    if (!enabled) return;
    if (!onBoardControls) return;

    const rm = endsAtMsRef.current;
    const rem = running && rm ? clamp(rm - Date.now(), 0, 3 * 60 * 1000) : 0;

    onBoardControls({
      type: "open",
      boardKey,
      lobby,
      timeMinutes: 3,
      incrementSeconds: 0,
      fen,
      mySide: turn,
      turn,
      boardOrientation: turn === "b" ? "black" : "white",
      canMove2d: enabled && running && !!puzzleId && rem > 0,
      clockRemainingMs: { w: rem, b: rem },
      clockRunning: enabled && running && rem > 0,
      clockActive: "w",
      clockSnapshotAtMs: Date.now(),
      canInc: false,
      canDec: false,
      canIncIncrement: false,
      canDecIncrement: false,
      canReset: false,
      canCenter: true,
      onMove2d: tryMove2d,
      onInc: () => {},
      onDec: () => {},
      onIncIncrement: () => {},
      onDecIncrement: () => {},
      onReset: () => {},
      onCenter: () => {},
      puzzleRushRunning: enabled && running && rem > 0,
      puzzleRushScore: score,
      puzzleRushDifficulty: difficulty,
      puzzleRushPuzzleId: puzzleId ?? undefined,
      onPuzzleRushStart: () => void start(),
      onPuzzleRushStop: stop,
    } as any);
  }, [
    enabled,
    onBoardControls,
    boardKey,
    lobby,
    fen,
    turn,
    running,
    puzzleId,
    score,
    difficulty,
    start,
    stop,
    tryMove2d,
  ]);

  return {
    running,
    score,
    difficulty,
    puzzleId,
    remainingMs,
    emitControlsOpen,
    start,
    stop,
  };
}
