"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import type { BoardControlsEvent, LobbyKind, Square, Side } from "./chess-core";
import type { PuzzleRushNetState as PartyPuzzleRushNetState } from "@/lib/partyRoom";

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

function isUciLegalInPosition(chess: Chess, uci: string): boolean {
  const parsed = parseUci(uci);
  if (!parsed) return false;

  const verbose = chess.moves({ square: parsed.from as any, verbose: true }) as
    | any[]
    | undefined;
  if (!verbose || verbose.length === 0) return false;

  return verbose.some((m) => {
    if (!m) return false;
    if (m.from !== parsed.from) return false;
    if (m.to !== parsed.to) return false;
    if (parsed.promotion) return m.promotion === parsed.promotion;
    return true;
  });
}

function sanTokensFromPgn(pgn: string): string[] {
  // Lichess puzzle API often returns move text without headers.
  // Tokenize ourselves so we can reliably apply every move (or fail loudly).
  let text = (pgn ?? "").toString();

  // Drop PGN headers if present.
  text = text.replace(/^\s*\[[^\]]*\]\s*$/gm, " ");

  // Drop comments/annotations/variations.
  text = text.replace(/\{[^}]*\}/g, " ");
  text = text.replace(/;[^\n]*/g, " ");
  // Best-effort: remove parenthesized variations (not fully nested-safe).
  for (let i = 0; i < 4; i++) text = text.replace(/\([^()]*\)/g, " ");

  // Normalize whitespace.
  text = text.replace(/\s+/g, " ").trim();
  if (!text) return [];

  const raw = text.split(" ");
  const tokens: string[] = [];
  for (const tok of raw) {
    let t = tok.trim();
    if (!t) continue;

    // Ignore NAG tokens like "$1".
    if (/^\$\d+$/.test(t)) continue;

    // Handle move numbers attached to SAN, e.g. "30.Nf4+" or "30...Kh6".
    // Also handle pure move number tokens like "30." and "30...".
    // IMPORTANT: Use a single regex so "30...Kh6" doesn't become ".Kh6".
    t = t.replace(/^\d+\.{1,3}/, "");
    t = t.replace(/^\.+/, "");
    t = t.trim();
    if (!t) continue;

    // Ignore game termination markers.
    if (t === "1-0" || t === "0-1" || t === "1/2-1/2" || t === "*") continue;

    // Normalize castling that uses zeros.
    if (t === "0-0") t = "O-O";
    if (t === "0-0-0") t = "O-O-O";

    // Strip common annotation suffixes (keep +/#).
    t = t.replace(/[!?]+$/g, "");
    if (!t) continue;

    tokens.push(t);
  }
  return tokens;
}

function chessFromSanTokens(tokens: string[], plies?: number): Chess {
  const chess = new Chess();
  const n = Math.max(0, Math.floor(plies ?? tokens.length));
  if (tokens.length < n) throw new Error("PGN shorter than requested ply");

  for (let i = 0; i < n; i++) {
    const san = tokens[i] ?? "";
    // Runtime chess.js supports sloppy move parsing; TS types may not expose it.
    const moved = (chess as any).move(san, { sloppy: true });
    if (!moved) {
      throw new Error(`Failed to apply SAN at ply ${i + 1}: ${san}`);
    }
  }

  return chess;
}

function chessAtPly(pgn: string, ply: number): Chess {
  const target = Math.max(0, Math.floor(ply));
  const tokens = sanTokensFromPgn(pgn);
  if (tokens.length === 0) throw new Error("Empty PGN");
  return chessFromSanTokens(tokens, target);
}

function isFullSolutionLegalAtPly(
  pgn: string,
  ply: number,
  solution: string[]
) {
  try {
    const chess = chessAtPly(pgn, ply);
    for (const uci of solution ?? []) {
      const m = parseUci(uci);
      if (!m) return false;
      const ok = chess.move({ from: m.from, to: m.to, promotion: m.promotion });
      if (!ok) return false;
    }
    return true;
  } catch {
    return false;
  }
}

const WRONG_MOVE_PENALTY_MS = 5_000;
const MOVE_ANIM_MS = 420;

type PuzzleRushSounds = {
  move?: () => void;
  capture?: () => void;
  correct?: () => void;
  wrong?: () => void;
};

export function usePuzzleRushGame(opts: {
  enabled: boolean;
  roomId: string;
  boardKey: string;
  lobby: LobbyKind;
  selfConnId?: string;
  netState?: PartyPuzzleRushNetState | null;
  claimLeader?: (boardKey: string) => void;
  publishState?: (state: PartyPuzzleRushNetState) => void;
  controlsOpen: boolean;
  board2dOpen: boolean;
  onBoardControls?: (event: BoardControlsEvent) => void;
  sounds?: PuzzleRushSounds;
}) {
  const {
    enabled,
    roomId,
    boardKey,
    lobby,
    selfConnId,
    netState,
    claimLeader,
    publishState,
    controlsOpen,
    board2dOpen,
    onBoardControls,
    sounds,
  } = opts;

  const [running, setRunning] = useState(false);
  const [score, setScore] = useState(0);
  const [difficulty, setDifficulty] = useState<PuzzleRushDifficulty>("easiest");
  const [puzzleId, setPuzzleId] = useState<string | null>(null);

  const chessRef = useRef<Chess>(new Chess());
  const solutionRef = useRef<string[]>([]);
  const solutionIndexRef = useRef(0);

  const endsAtMsRef = useRef<number | null>(null);
  const [endsAtMs, setEndsAtMs] = useState<number | null>(null);
  const [clockTick, setClockTick] = useState(0);

  const [fen, setFen] = useState(chessRef.current.fen());
  const [turn, setTurn] = useState<Side>("w");

  const [animSeq, setAnimSeq] = useState(0);

  const [selected, setSelected] = useState<Square | null>(null);
  const [legalTargets, setLegalTargets] = useState<Square[]>([]);
  const [lastMove, setLastMove] = useState<{ from: Square; to: Square } | null>(
    null
  );

  const isLeader =
    enabled &&
    !!selfConnId &&
    !!netState &&
    netState.leaderConnId === selfConnId;

  const publishSeqRef = useRef(0);

  const publish = useCallback(() => {
    if (!enabled) return;
    if (!isLeader) return;
    if (!publishState) return;
    if (!selfConnId) return;

    publishSeqRef.current += 1;
    publishState({
      boardKey,
      seq: publishSeqRef.current,
      leaderConnId: selfConnId,
      running,
      endsAtMs,
      fen,
      turn,
      score,
      difficulty,
      puzzleId,
      lastMove: lastMove ? { from: lastMove.from, to: lastMove.to } : null,
    });
  }, [
    enabled,
    isLeader,
    publishState,
    selfConnId,
    boardKey,
    running,
    endsAtMs,
    fen,
    turn,
    score,
    difficulty,
    puzzleId,
    lastMove,
  ]);

  // Try to claim leadership whenever the mode is active.
  useEffect(() => {
    if (!enabled) return;
    if (!selfConnId) return;
    if (!claimLeader) return;
    // If no authoritative state yet (or leader dropped), re-claim.
    if (!netState || !netState.leaderConnId) {
      claimLeader(boardKey);
      return;
    }
    // If leader exists, no need to spam claims.
  }, [enabled, selfConnId, claimLeader, netState, boardKey]);

  // Followers mirror authoritative PartyKit state and disable local play.
  useEffect(() => {
    if (!enabled) return;
    if (isLeader) return;
    if (!netState) return;
    if ((netState.boardKey ?? "") !== boardKey) return;

    const nextFen = (netState.fen ?? "").toString();
    if (nextFen) {
      try {
        const c = new Chess();
        c.load(nextFen);
        chessRef.current = c;
        setFen(c.fen());
        setTurn(c.turn());
      } catch {
        // ignore
      }
    }

    setRunning(Boolean(netState.running));
    endsAtMsRef.current = netState.endsAtMs ?? null;
    setEndsAtMs(netState.endsAtMs ?? null);
    setScore(Math.max(0, Math.floor(Number(netState.score) || 0)));
    setDifficulty((netState.difficulty as PuzzleRushDifficulty) ?? "easiest");
    setPuzzleId(netState.puzzleId ?? null);
    setSelected(null);
    setLegalTargets([]);
    setLastMove(
      netState.lastMove
        ? ({
            from: netState.lastMove.from as Square,
            to: netState.lastMove.to as Square,
          } as any)
        : null
    );
  }, [enabled, isLeader, netState, boardKey]);

  const animatedFromByTo = useMemo(() => {
    const map = new Map<Square, Square>();
    if (!lastMove) return map;

    map.set(lastMove.to, lastMove.from);

    // Castling rook animation, matching the normal chess implementation.
    if (lastMove.from === "e1" && lastMove.to === "g1") map.set("f1", "h1");
    if (lastMove.from === "e1" && lastMove.to === "c1") map.set("d1", "a1");
    if (lastMove.from === "e8" && lastMove.to === "g8") map.set("f8", "h8");
    if (lastMove.from === "e8" && lastMove.to === "c8") map.set("d8", "a8");

    return map;
  }, [lastMove]);

  const timersRef = useRef<number[]>([]);
  const tokenRef = useRef(0);
  const clearTimers = useCallback(() => {
    for (const id of timersRef.current) window.clearTimeout(id);
    timersRef.current = [];
  }, []);

  const bumpAnim = useCallback(() => {
    setAnimSeq((v) => v + 1);
  }, []);

  const refreshClock = useCallback(() => {
    setClockTick((v) => v + 1);
  }, []);

  const applyPenalty = useCallback(() => {
    if (!endsAtMsRef.current) return;
    endsAtMsRef.current = Math.max(
      Date.now(),
      endsAtMsRef.current - WRONG_MOVE_PENALTY_MS
    );
    refreshClock();
  }, [refreshClock]);

  const applyMove = useCallback(
    (from: string, to: string, promotion?: "q" | "r" | "b" | "n") => {
      const chess = chessRef.current;
      const moved = chess.move({ from, to, promotion });
      if (!moved) return null;

      try {
        if (moved.captured) sounds?.capture?.();
        else sounds?.move?.();
      } catch {
        // ignore
      }

      setLastMove({ from: moved.from as Square, to: moved.to as Square });
      setFen(chess.fen());
      setTurn(chess.turn());
      setSelected(null);
      setLegalTargets([]);
      bumpAnim();
      return moved as any;
    },
    [bumpAnim, sounds]
  );

  const undoLastMove = useCallback(() => {
    const chess = chessRef.current;
    const undone = chess.undo() as any;
    if (!undone) return null;

    try {
      // Undo is still a piece movement; use move sound.
      sounds?.move?.();
    } catch {
      // ignore
    }

    // Animate piece moving back.
    setLastMove({ from: undone.to as Square, to: undone.from as Square });
    setFen(chess.fen());
    setTurn(chess.turn());
    setSelected(null);
    setLegalTargets([]);
    bumpAnim();
    return undone;
  }, [bumpAnim, sounds]);

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
      canMove2d: enabled && isLeader && running && !!puzzleId && rem > 0,
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
    isLeader,
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

  const attemptMove = useCallback(
    (
      from: string,
      to: string,
      promotion?: "q" | "r" | "b" | "n"
    ): "illegal" | "wrong" | "correct" => {
      if (!enabled) return "illegal";
      if (!isLeader) return "illegal";
      if (!running) return "illegal";
      if (!puzzleId) return "illegal";
      const end = endsAtMsRef.current;
      if (!end || Date.now() >= end) return "illegal";

      const solution = solutionRef.current;
      const idx = solutionIndexRef.current;
      const expectedUci = solution[idx] ?? "";
      const expected = parseUci(expectedUci);

      // Determine promotion to use.
      let promoToUse = promotion;
      if (expected?.promotion && expected.from === from && expected.to === to) {
        promoToUse = expected.promotion;
      }

      // For promotion moves without UI selection, default to queen.
      if (!promoToUse) {
        const chess = chessRef.current;
        const verbose = chess.moves({ square: from as any, verbose: true }) as
          | any[]
          | undefined;
        const promoMove = verbose?.find(
          (m) => m?.from === from && m?.to === to && m?.promotion
        );
        if (promoMove?.promotion) promoToUse = promoMove.promotion;
      }
      if (!promoToUse) promoToUse = undefined;

      const moved = applyMove(from, to, promoToUse);
      if (!moved) return "illegal";

      const attemptedUci = `${from}${to}${moved.promotion ?? promoToUse ?? ""}`;
      const isCorrect = expectedUci && attemptedUci === expectedUci;

      const token = tokenRef.current;

      if (!isCorrect) {
        try {
          sounds?.wrong?.();
        } catch {
          // ignore
        }
        applyPenalty();
        const undoId = window.setTimeout(() => {
          if (tokenRef.current !== token) return;
          undoLastMove();
        }, MOVE_ANIM_MS);
        timersRef.current.push(undoId);
        return "wrong";
      }

      // Correct: advance solution index and step through opponent replies
      solutionIndexRef.current = idx + 1;

      const stepOpponent = () => {
        if (tokenRef.current !== token) return;
        if (!running) return;
        const end2 = endsAtMsRef.current;
        if (!end2 || Date.now() >= end2) return;

        const sol = solutionRef.current;
        while (
          solutionIndexRef.current < sol.length &&
          solutionIndexRef.current % 2 === 1
        ) {
          const uci = sol[solutionIndexRef.current] ?? "";
          const m = parseUci(uci);
          if (!m) break;

          // Animate opponent replies one-by-one.
          const id = window.setTimeout(() => {
            if (tokenRef.current !== token) return;
            const ok = applyMove(m.from, m.to, m.promotion);
            if (!ok) return;
            solutionIndexRef.current += 1;

            // Continue chaining if there are multiple forced replies.
            stepOpponent();
          }, MOVE_ANIM_MS);
          timersRef.current.push(id);
          return;
        }

        // Puzzle solved.
        if (solutionIndexRef.current >= sol.length) {
          setScore((s) => s + 1);
          try {
            sounds?.correct?.();
          } catch {
            // ignore
          }
        }
      };

      stepOpponent();
      return "correct";
    },
    [
      enabled,
      isLeader,
      running,
      puzzleId,
      applyMove,
      undoLastMove,
      applyPenalty,
      sounds,
    ]
  );

  // Stable onMove2d that we inject into the event objects.
  const tryMove2d = useCallback(
    (from: string, to: string, promotion?: "q" | "r" | "b" | "n") => {
      if (!isLeader) return false;
      const res = attemptMove(from, to, promotion);
      return res !== "illegal";
    },
    [attemptMove, isLeader]
  );

  const onPickSquare = useCallback(
    (sq: Square) => {
      if (!enabled) return;
      if (!isLeader) return;
      if (!running) return;
      if (!puzzleId) return;
      const end = endsAtMsRef.current;
      if (!end || Date.now() >= end) return;

      const chess = chessRef.current;
      const piece = chess.get(sq as any) as any;

      // If nothing is selected, only allow selecting a piece of side-to-move.
      if (!selected) {
        if (!piece) {
          setSelected(null);
          setLegalTargets([]);
          return;
        }
        if (piece.color !== turn) return;

        setSelected(sq);
        const verbose = chess.moves({ square: sq as any, verbose: true }) as
          | any[]
          | undefined;
        const targets = Array.from(
          new Set((verbose ?? []).map((m) => m?.to).filter(Boolean))
        ) as Square[];
        setLegalTargets(targets);
        return;
      }

      // Deselect.
      if (sq === selected) {
        setSelected(null);
        setLegalTargets([]);
        return;
      }

      // If they click another piece of side-to-move, treat as reselect.
      if (piece && piece.color === turn) {
        setSelected(sq);
        const verbose = chess.moves({ square: sq as any, verbose: true }) as
          | any[]
          | undefined;
        const targets = Array.from(
          new Set((verbose ?? []).map((m) => m?.to).filter(Boolean))
        ) as Square[];
        setLegalTargets(targets);
        return;
      }

      // Attempt move: penalize only if the attempted move is legal in chess,
      // but not the expected solution move.
      const verboseMoves = chess.moves({
        square: selected as any,
        verbose: true,
      }) as any[];
      const isLegalAttempt = verboseMoves.some((m) => m?.to === sq);
      if (!isLegalAttempt) return;

      attemptMove(selected, sq);
    },
    [enabled, isLeader, running, puzzleId, selected, turn, attemptMove]
  );

  const fetchNextPuzzle = useCallback(
    async (nextDifficulty: PuzzleRushDifficulty) => {
      clearTimers();
      tokenRef.current += 1;

      const url = new URL("/api/lichess/puzzle/next", window.location.origin);
      // Mirror the url the user provided.
      url.searchParams.set("angle", "");
      url.searchParams.set("difficulty", nextDifficulty);
      url.searchParams.set("color", "white");

      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok)
        throw new Error(`Lichess puzzle fetch failed: ${res.status}`);
      const data = (await res.json()) as LichessPuzzleNext;

      const pgn = data.game.pgn;
      const solution = Array.isArray(data.puzzle.solution)
        ? data.puzzle.solution
        : [];
      const firstSolution = solution[0] ?? "";

      // Tokenize once (also used for debug + endFen).
      const pgnTokens = sanTokensFromPgn(pgn);
      const maxPly = pgnTokens.length;

      const isFullSolutionLegalAtPlyFromTokens = (ply: number) => {
        try {
          const chess = chessFromSanTokens(pgnTokens, ply);
          for (const uci of solution ?? []) {
            const m = parseUci(uci);
            if (!m) return false;
            const ok = chess.move({
              from: m.from,
              to: m.to,
              promotion: m.promotion,
            });
            if (!ok) return false;
          }
          return true;
        } catch {
          return false;
        }
      };

      // Lichess puzzles use `initialPly` as the entry point into the PGN,
      // but different sources/tools sometimes interpret it off-by-one.
      // Checking only the first move can still pick the wrong ply (it might be legal
      // in multiple adjacent positions). Instead, prefer the ply where the *entire*
      // solution line plays legally.
      const basePly = Math.max(0, Math.floor(data.puzzle.initialPly ?? 0));
      const candidates: number[] = [];
      const pushCand = (p: number) => {
        const v = Math.max(0, Math.min(maxPly, Math.floor(p)));
        if (candidates.indexOf(v) !== -1) return;
        candidates.push(v);
      };

      // Many Lichess puzzles start at the END of the PGN (maxPly), so try that first.
      pushCand(maxPly);

      // Then search outward from basePly (initialPly), allowing large drift.
      pushCand(basePly);
      const maxDist = Math.min(96, maxPly);
      for (let d = 1; d <= maxDist; d++) {
        pushCand(basePly - d);
        pushCand(basePly + d);
      }

      // As a last resort, ensure we cover the full PGN.
      if (candidates.length < maxPly + 1) {
        for (let p = 0; p <= maxPly; p++) pushCand(p);
      }

      let chess: Chess | null = null;
      let chosenPly: number | null = null;
      for (const ply of candidates) {
        // If we have a solution line, require it to be fully legal.
        if (solution.length > 0) {
          if (!isFullSolutionLegalAtPlyFromTokens(ply)) continue;
          chess = chessFromSanTokens(pgnTokens, ply);
          chosenPly = ply;
          break;
        }

        // Fallback if solution missing for some reason.
        try {
          const c = chessFromSanTokens(pgnTokens, ply);
          if (!firstSolution || isUciLegalInPosition(c, firstSolution)) {
            chess = c;
            chosenPly = ply;
            break;
          }
        } catch {
          // ignore
        }
      }

      if (!chess) throw new Error("Failed to load puzzle PGN");

      // Debug visibility: helps diagnose cases where piece placements drift.
      // This logs to the browser devtools console.
      let endFen: string | null = null;
      try {
        endFen = chessFromSanTokens(pgnTokens).fen();
      } catch {
        // ignore
      }

      console.log("[PuzzleRush] fetched puzzle", {
        id: data.puzzle.id,
        gameId: data.game.id,
        rating: data.puzzle.rating,
        initialPly: data.puzzle.initialPly,
        chosenPly,
        difficulty: nextDifficulty,
        startFen: chess.fen(),
        startTurn: chess.turn(),
        pgnTokens: pgnTokens.length,
        pgnTail: pgnTokens.slice(-8),
        endFen,
        solutionLen: solution.length,
        solutionHead: solution.slice(0, 8),
      });

      console.log("[PuzzleRush] pgn", {
        id: data.puzzle.id,
        gameId: data.game.id,
        length: pgn.length,
      });
      console.log(pgn);

      chessRef.current = chess;
      solutionRef.current = solution;
      solutionIndexRef.current = 0;

      setPuzzleId(data.puzzle.id);
      setFen(chess.fen());
      setTurn(chess.turn());
      setAnimSeq(0);
      setSelected(null);
      setLegalTargets([]);
      setLastMove(null);
    },
    [clearTimers]
  );

  const start = useCallback(async () => {
    if (!enabled) return;
    if (!isLeader) return;

    clearTimers();
    tokenRef.current += 1;

    setScore(0);
    setDifficulty("easiest");
    setRunning(true);
    const end = Date.now() + 3 * 60 * 1000;
    endsAtMsRef.current = end;
    setEndsAtMs(end);

    try {
      await fetchNextPuzzle("easiest");
    } catch {
      // If lichess is unreachable, still start the timer but remain without a puzzle.
      setPuzzleId(null);
      chessRef.current = new Chess();
      setFen(chessRef.current.fen());
      setTurn(chessRef.current.turn());
      setAnimSeq(0);
      setSelected(null);
      setLegalTargets([]);
      setLastMove(null);
    }
  }, [enabled, isLeader, fetchNextPuzzle, clearTimers]);

  const stop = useCallback(() => {
    if (!isLeader) return;
    clearTimers();
    tokenRef.current += 1;
    setRunning(false);
    setScore(0);
    setDifficulty("easiest");
    setPuzzleId(null);
    endsAtMsRef.current = null;
    setEndsAtMs(null);
    chessRef.current = new Chess();
    setFen(chessRef.current.fen());
    setTurn(chessRef.current.turn());
    setAnimSeq(0);
    setSelected(null);
    setLegalTargets([]);
    setLastMove(null);
  }, [clearTimers, isLeader]);

  // Auto-start/stop: Puzzle Rush begins immediately when the mode is active.
  useEffect(() => {
    if (!enabled) {
      if (running && isLeader) stop();
      return;
    }
    if (!isLeader) return;
    if (!running) void start();
  }, [enabled, isLeader, running, start, stop]);

  useEffect(() => {
    return () => {
      clearTimers();
      tokenRef.current += 1;
    };
  }, [clearTimers]);

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
    if (!isLeader) return;
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
  }, [enabled, isLeader, running, score, fetchNextPuzzle]);

  // Stop automatically when time runs out.
  useEffect(() => {
    if (!enabled) return;
    if (!running) return;

    const end = endsAtMsRef.current;
    if (!end) return;
    if (Date.now() < end) return;
    if (isLeader) stop();
    else setRunning(false);
  }, [enabled, running, clockTick, isLeader, stop]);

  // Keep PartyKit state up-to-date for spectators.
  useEffect(() => {
    if (!enabled) return;
    if (!isLeader) return;
    publish();
  }, [enabled, isLeader, publish]);

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
      canMove2d: enabled && isLeader && running && !!puzzleId && rem > 0,
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
    isLeader,
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
      canMove2d: enabled && isLeader && running && !!puzzleId && rem > 0,
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
    isLeader,
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
    start,
    stop,
  ]);

  return {
    fen,
    turn,
    animSeq,
    animatedFromByTo,
    selected,
    legalTargets,
    lastMove,
    onPickSquare,
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
