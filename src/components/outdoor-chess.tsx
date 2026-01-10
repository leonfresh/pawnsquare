"use client";

import { RoundedBox, Text, useGLTF, Html, Billboard } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Chess } from "chess.js";
import * as THREE from "three";
import type { BoardMode, PuzzleRushNetState, Vec3 } from "@/lib/partyRoom";
import {
  chessVariantForMode,
  engineForMode,
  isGooseMode,
} from "@/lib/boardModes";
import { useChessSounds } from "./chess-sounds";
import { LocalArrow3D, useLocalArrows } from "./local-arrows";
import { useCheckersGame } from "./checkers-core";
import {
  applyChessThemeToMaterial,
  useChessGame,
  type BoardControlsEvent,
  type Side,
  type Square,
} from "./chess-core";
import { usePuzzleRushGame } from "./puzzle-rush-core";

/**
 * Park board implementation notes (unified game logic)
 *
 * Like `scifi-chess.tsx`, this component should keep mode logic centralized:
 * - Route gameplay by `engineForMode(mode)`.
 * - For chess-like modes, choose the variant via `chessVariantForMode(mode)`.
 *
 * The goal is: adding a new mode does not require duplicating per-world logic.
 * Only update this file when introducing a new engine/hook or adding park-only visuals.
 */

type CheckersPiece = { color: Side; king: boolean };

function CheckerPiece({
  position,
  tint,
  side,
  chessTheme,
  king,
  canMove,
  onPick,
}: {
  position: [number, number, number];
  tint: THREE.Color;
  side: Side;
  chessTheme?: string;
  king: boolean;
  canMove: boolean;
  onPick: () => void;
}) {
  const gltf = useGLTF("/models/checker.glb") as any;

  const modelHeight = useMemo(() => {
    const tmp = gltf.scene.clone(true);
    tmp.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(tmp);
    const size = new THREE.Vector3();
    box.getSize(size);
    return Number.isFinite(size.y) && size.y > 0 ? size.y : 1;
  }, [gltf.scene]);

  const model = useMemo(() => {
    const root = gltf.scene.clone(true);
    root.traverse((obj: any) => {
      if (obj && obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;

        const themed = new THREE.MeshStandardMaterial();
        applyChessThemeToMaterial(themed, { chessTheme, tint, side });
        obj.material = themed;
      }
    });
    return root;
  }, [gltf.scene, tint, chessTheme, side]);

  const scale = 2.2;
  const dy = 0.02;
  const kingStackDy = modelHeight * scale * 0.9;

  return (
    <group
      position={position}
      onPointerDown={(e) => {
        e.stopPropagation();
        onPick();
      }}
      onPointerEnter={() => {
        if (canMove) document.body.style.cursor = "pointer";
      }}
      onPointerLeave={() => {
        document.body.style.cursor = "default";
      }}
    >
      <group scale={[scale, scale, scale]} position={[0, dy, 0]}>
        <primitive object={model} />
      </group>
      {king ? (
        <group
          scale={[scale, scale, scale]}
          position={[0, dy + kingStackDy, 0]}
        >
          <primitive object={model.clone(true)} />
        </group>
      ) : null}
    </group>
  );
}

function HolographicPlacementText({
  originVec,
  boardSize,
  squareSize,
}: {
  originVec: THREE.Vector3;
  boardSize: number;
  squareSize: number;
}) {
  const textRef = useRef<any>(null);

  useFrame(() => {
    if (!textRef.current) return;
    const time = performance.now() * 0.001;
    // Gentle float animation
    textRef.current.position.y =
      originVec.y + 1.8 + Math.sin(time * 1.5) * 0.08;
    // Subtle pulse on opacity
    const opacity = 0.85 + Math.sin(time * 2) * 0.15;
    if (textRef.current.material) {
      textRef.current.material.opacity = opacity;
    }
  });

  return (
    <Text
      ref={textRef}
      position={[
        originVec.x,
        originVec.y + 1.8,
        originVec.z - boardSize / 2 - 0.8,
      ]}
      fontSize={0.28}
      color="#00d9ff"
      anchorX="center"
      anchorY="middle"
      outlineWidth={0.015}
      outlineColor="#003d4d"
      font="/fonts/Orbitron-Bold.ttf"
    >
      PLACE GOOSE
      <meshBasicMaterial
        attach="material"
        color="#00d9ff"
        transparent
        opacity={0.85}
        toneMapped={false}
      />
    </Text>
  );
}

function HolographicDrawOfferText({
  originVec,
  boardSize,
  offeredBy,
}: {
  originVec: THREE.Vector3;
  boardSize: number;
  offeredBy: "w" | "b";
}) {
  const frontRef = useRef<any>(null);
  const backRef = useRef<any>(null);

  useFrame(() => {
    if (!frontRef.current || !backRef.current) return;
    const time = performance.now() * 0.001;
    const y = originVec.y + 1.62 + Math.sin(time * 1.4) * 0.08;
    frontRef.current.position.y = y;
    backRef.current.position.y = y;
    const opacity = 0.85 + Math.sin(time * 2.1) * 0.15;
    if (frontRef.current.material) frontRef.current.material.opacity = opacity;
    if (backRef.current.material) backRef.current.material.opacity = opacity;
  });

  return (
    <group>
      <Text
        ref={frontRef}
        position={[
          originVec.x,
          originVec.y + 1.62,
          originVec.z - boardSize / 2 - 0.8,
        ]}
        fontSize={0.2}
        color="#00d9ff"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.015}
        outlineColor="#003d4d"
        font="/fonts/Orbitron-Bold.ttf"
      >
        DRAW OFFERED ({offeredBy === "w" ? "WHITE" : "BLACK"})
        <meshBasicMaterial
          attach="material"
          color="#00d9ff"
          transparent
          opacity={0.85}
          toneMapped={false}
        />
      </Text>
      <Text
        ref={backRef}
        position={[
          originVec.x,
          originVec.y + 1.62,
          originVec.z - boardSize / 2 - 0.8,
        ]}
        rotation={[0, Math.PI, 0]}
        fontSize={0.2}
        color="#00d9ff"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.015}
        outlineColor="#003d4d"
        font="/fonts/Orbitron-Bold.ttf"
      >
        DRAW OFFERED ({offeredBy === "w" ? "WHITE" : "BLACK"})
        <meshBasicMaterial
          attach="material"
          color="#00d9ff"
          transparent
          opacity={0.85}
          toneMapped={false}
        />
      </Text>
    </group>
  );
}

function HolographicRematchRequestText({
  originVec,
  boardSize,
  requestedBy,
}: {
  originVec: THREE.Vector3;
  boardSize: number;
  requestedBy: "w" | "b";
}) {
  const frontRef = useRef<any>(null);
  const backRef = useRef<any>(null);

  useFrame(() => {
    if (!frontRef.current || !backRef.current) return;
    const time = performance.now() * 0.001;
    const y = originVec.y + 1.52 + Math.sin(time * 1.35) * 0.08;
    frontRef.current.position.y = y;
    backRef.current.position.y = y;
    const opacity = 0.85 + Math.sin(time * 2.0) * 0.15;
    if (frontRef.current.material) frontRef.current.material.opacity = opacity;
    if (backRef.current.material) backRef.current.material.opacity = opacity;
  });

  const label = `REMATCH? (${requestedBy === "w" ? "WHITE" : "BLACK"})`;

  return (
    <group>
      <Text
        ref={frontRef}
        position={[
          originVec.x,
          originVec.y + 1.52,
          originVec.z - boardSize / 2 - 0.8,
        ]}
        fontSize={0.2}
        color="#00d9ff"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.015}
        outlineColor="#003d4d"
        font="/fonts/Orbitron-Bold.ttf"
      >
        {label}
        <meshBasicMaterial
          attach="material"
          color="#00d9ff"
          transparent
          opacity={0.85}
          toneMapped={false}
        />
      </Text>
      <Text
        ref={backRef}
        position={[
          originVec.x,
          originVec.y + 1.52,
          originVec.z - boardSize / 2 - 0.8,
        ]}
        rotation={[0, Math.PI, 0]}
        fontSize={0.2}
        color="#00d9ff"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.015}
        outlineColor="#003d4d"
        font="/fonts/Orbitron-Bold.ttf"
      >
        {label}
        <meshBasicMaterial
          attach="material"
          color="#00d9ff"
          transparent
          opacity={0.85}
          toneMapped={false}
        />
      </Text>
    </group>
  );
}

function HolographicPuzzleRushHud({
  originVec,
  boardSize,
  label,
}: {
  originVec: THREE.Vector3;
  boardSize: number;
  label: string;
}) {
  const textRef = useRef<any>(null);

  useFrame(() => {
    if (!textRef.current) return;
    const time = performance.now() * 0.001;
    const opacity = 0.85 + Math.sin(time * 2.2) * 0.12;
    if (textRef.current.material) {
      textRef.current.material.opacity = opacity;
    }
  });

  return (
    <Billboard
      position={[
        originVec.x + boardSize / 2 + 0.75,
        originVec.y + 1.8,
        originVec.z - boardSize / 2 - 0.5,
      ]}
      follow
      lockX={false}
      lockY={false}
      lockZ={false}
    >
      <Text
        ref={textRef}
        fontSize={0.18}
        color="#00d9ff"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.012}
        outlineColor="#003d4d"
        font="/fonts/Orbitron-Bold.ttf"
      >
        {label}
        <meshBasicMaterial
          attach="material"
          color="#00d9ff"
          transparent
          opacity={0.85}
          toneMapped={false}
        />
      </Text>
    </Billboard>
  );
}

function GooseWarningText({
  position,
  startMs,
}: {
  position: [number, number, number];
  startMs: number;
}) {
  const textRef = useRef<any>(null);
  const [opacity, setOpacity] = useState(1);

  useFrame(() => {
    if (!textRef.current) return;
    const elapsed = performance.now() - startMs;
    const duration = 900;
    const t = Math.min(elapsed / duration, 1);

    // Hover above goose head and fly upward
    const y = position[1] + 0.85 + t * 0.55;
    const op = 1 - t;
    textRef.current.position.set(position[0], y, position[2]);
    setOpacity(op);
  });

  return (
    <Text
      ref={textRef}
      position={[position[0], position[1] + 0.85, position[2]]}
      fontSize={0.34}
      color="#ff4444"
      anchorX="center"
      anchorY="middle"
      fillOpacity={opacity}
      renderOrder={10}
    >
      !
      <meshBasicMaterial
        attach="material"
        color="#ff4444"
        transparent
        opacity={opacity}
        depthTest={false}
        toneMapped={false}
      />
    </Text>
  );
}

function PulsingIndicatorMaterial({
  color,
  baseOpacity,
  pulsingUntilMs,
}: {
  color: string;
  baseOpacity: number;
  pulsingUntilMs: number;
}) {
  const matRef = useRef<THREE.MeshBasicMaterial>(null);

  useFrame(() => {
    const mat = matRef.current;
    if (!mat) return;
    const now = Date.now();
    if (pulsingUntilMs && now < pulsingUntilMs) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 90);
      mat.opacity = Math.min(0.95, baseOpacity + pulse * 0.35);
    } else {
      mat.opacity = baseOpacity;
    }
  });

  return (
    <meshBasicMaterial
      ref={matRef}
      color={color}
      transparent
      opacity={baseOpacity}
      blending={THREE.AdditiveBlending}
      depthWrite={false}
      polygonOffset
      polygonOffsetFactor={-1}
      polygonOffsetUnits={-1}
    />
  );
}

function SlowPulsingIndicatorMaterial({
  color,
  baseOpacity,
  periodSeconds = 2.2,
}: {
  color: string;
  baseOpacity: number;
  periodSeconds?: number;
}) {
  const matRef = useRef<THREE.MeshBasicMaterial>(null);

  useFrame(({ clock }) => {
    const mat = matRef.current;
    if (!mat) return;
    const t = clock.getElapsedTime();
    const phase = (t * 2 * Math.PI) / periodSeconds;
    const pulse = 0.5 + 0.5 * Math.sin(phase);
    // Slow fade in/out around baseOpacity.
    mat.opacity = Math.min(
      0.95,
      Math.max(0.02, baseOpacity * (0.55 + 0.65 * pulse))
    );
  });

  return (
    <meshBasicMaterial
      ref={matRef}
      color={color}
      transparent
      opacity={baseOpacity}
      blending={THREE.AdditiveBlending}
      depthWrite={false}
      polygonOffset
      polygonOffsetFactor={-1}
      polygonOffsetUnits={-1}
    />
  );
}

function ControlTV({
  center,
  active,
  hintText = null,
  badgeCount = 0,
  onClick,
}: {
  center: THREE.Vector3;
  active: boolean;
  hintText?: string | null;
  badgeCount?: number;
  onClick: (e: any) => void;
}) {
  const baseY = center.y;
  const standY = baseY + 0.6;
  const screenY = baseY + 1.22;

  return (
    <group
      position={[center.x, center.y, center.z]}
      onPointerDown={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      onPointerEnter={(e) => {
        e.stopPropagation();
        document.body.style.cursor = "pointer";
      }}
      onPointerLeave={(e) => {
        e.stopPropagation();
        document.body.style.cursor = "default";
      }}
    >
      {/* Base */}
      <mesh position={[0, 0.09, 0]} castShadow>
        <cylinderGeometry args={[0.26, 0.32, 0.18, 16]} />
        <meshStandardMaterial
          color="#2b1b12"
          roughness={0.65}
          metalness={0.15}
        />
      </mesh>

      {/* Stand */}
      <mesh position={[0, standY - baseY, 0]} castShadow>
        <cylinderGeometry args={[0.045, 0.065, 0.84, 12]} />
        <meshStandardMaterial color="#3a2a1f" roughness={0.7} metalness={0.1} />
      </mesh>

      {/* Accent ring */}
      <mesh position={[0, 1.03, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.12, 0.012, 10, 36]} />
        <meshBasicMaterial
          color={active ? "#7cffd8" : "#ffffff"}
          transparent
          opacity={active ? 0.28 : 0.16}
        />
      </mesh>

      {/* Screen */}
      <group position={[0, screenY - baseY, 0]}>
        <RoundedBox args={[0.95, 0.62, 0.08]} radius={0.06} smoothness={6}>
          <meshStandardMaterial
            color="#111"
            roughness={0.35}
            metalness={0.35}
          />
        </RoundedBox>
        <mesh position={[0, 0, 0.05]}>
          <planeGeometry args={[0.86, 0.52]} />
          <meshBasicMaterial
            color={active ? "#7cffd8" : "#ffffff"}
            transparent
            opacity={active ? 0.22 : 0.12}
          />
        </mesh>
        <mesh position={[0, 0, -0.05]} rotation={[0, Math.PI, 0]}>
          <planeGeometry args={[0.86, 0.52]} />
          <meshBasicMaterial
            color={active ? "#7cffd8" : "#ffffff"}
            transparent
            opacity={active ? 0.22 : 0.12}
          />
        </mesh>
        <Text
          position={[0, 0, 0.055]}
          fontSize={0.12}
          color={active ? "#7cffd8" : "#ffffff"}
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.006}
          outlineColor="#000000"
          fontWeight="bold"
        >
          {active ? "CLOSE" : "CONTROLS"}
        </Text>
        <Text
          position={[0, 0, -0.055]}
          rotation={[0, Math.PI, 0]}
          fontSize={0.12}
          color={active ? "#7cffd8" : "#ffffff"}
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.006}
          outlineColor="#000000"
          fontWeight="bold"
        >
          {active ? "CLOSE" : "CONTROLS"}
        </Text>

        {badgeCount > 0 ? (
          <group>
            <mesh position={[0.33, 0.19, 0.056]}>
              <circleGeometry args={[0.1, 20]} />
              <meshBasicMaterial color={active ? "#7cffd8" : "#ffffff"} />
            </mesh>
            <Text
              position={[0.33, 0.19, 0.057]}
              fontSize={0.095}
              color="#000000"
              anchorX="center"
              anchorY="middle"
              fontWeight="bold"
            >
              ({badgeCount})
            </Text>

            <mesh position={[0.33, 0.19, -0.056]} rotation={[0, Math.PI, 0]}>
              <circleGeometry args={[0.1, 20]} />
              <meshBasicMaterial color={active ? "#7cffd8" : "#ffffff"} />
            </mesh>
            <Text
              position={[0.33, 0.19, -0.057]}
              rotation={[0, Math.PI, 0]}
              fontSize={0.095}
              color="#000000"
              anchorX="center"
              anchorY="middle"
              fontWeight="bold"
            >
              ({badgeCount})
            </Text>
          </group>
        ) : null}
      </group>

      {hintText ? (
        <group position={[0, screenY - baseY + 0.6, 0]}>
          <RoundedBox args={[1.18, 0.24, 0.04]} radius={0.05} smoothness={5}>
            <meshBasicMaterial
              color="#000000"
              transparent
              opacity={0.55}
              depthWrite={false}
            />
          </RoundedBox>
          <Text
            position={[0, 0, 0.03]}
            fontSize={0.1}
            color="#ffffff"
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.004}
            outlineColor="#000000"
          >
            {hintText}
          </Text>
          <Text
            position={[0, 0, -0.03]}
            rotation={[0, Math.PI, 0]}
            fontSize={0.1}
            color="#ffffff"
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.004}
            outlineColor="#000000"
          >
            {hintText}
          </Text>
        </group>
      ) : null}
    </group>
  );
}

const TIME_OPTIONS_SECONDS = [60, 3 * 60, 5 * 60, 10 * 60, 15 * 60] as const;
const INCREMENT_OPTIONS_SECONDS = [0, 1, 2, 3, 5, 10] as const;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function formatClock(ms: number) {
  const safe = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(safe / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return `${mm}:${ss}`;
}

function winnerLabel(side: Side) {
  return side === "w" ? "White" : "Black";
}

const PARTYKIT_HOST = process.env.NEXT_PUBLIC_PARTYKIT_HOST || "127.0.0.1:1999";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;

function squareCenter(
  square: Square,
  origin: THREE.Vector3,
  squareSize: number
): THREE.Vector3 {
  const file = square.charCodeAt(0) - 97; // a=0
  const rank = Number(square[1]); // 1..8
  const x = (file - 3.5) * squareSize;
  const z = (4.5 - rank) * squareSize;
  return new THREE.Vector3(origin.x + x, origin.y, origin.z + z);
}

function isSquare(val: string): val is Square {
  if (val.length !== 2) return false;
  const f = val.charCodeAt(0);
  const r = val.charCodeAt(1);
  return f >= 97 && f <= 104 && r >= 49 && r <= 56;
}

function chessPiecesFromFen(
  fen: string
): Array<{ square: Square; type: string; color: Side }> {
  const chess = (() => {
    try {
      return new Chess(fen);
    } catch {
      return new Chess();
    }
  })();

  const out: Array<{ square: Square; type: string; color: Side }> = [];
  const board = chess.board();

  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = board[r]?.[f];
      if (!p) continue;
      const file = FILES[f]!;
      const rank = 8 - r;
      const sq = `${file}${rank}`;
      if (!isSquare(sq)) continue;
      out.push({ square: sq, type: p.type, color: p.color });
    }
  }

  return out;
}

function isDarkSquare(square: string) {
  if (!isSquare(square)) return false;
  // a1 is dark.
  const f = square.charCodeAt(0) - 97;
  const r = Number(square[1]) - 1;
  return (f + r) % 2 === 0;
}

type CheckersMoveCandidate = {
  from: string;
  to: string;
  captured: string[];
  isCapture: boolean;
};

function checkersDeltas(piece: CheckersPiece): Array<[number, number]> {
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

function listCheckersCapturesFrom(
  board: Record<string, CheckersPiece>,
  from: string,
  piece: CheckersPiece
): CheckersMoveCandidate[] {
  const out: CheckersMoveCandidate[] = [];
  const { f: f0, r: r0 } = squareFileRank(from);
  for (const [df, dr] of checkersDeltas(piece)) {
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

function listCheckersSimpleMovesFrom(
  board: Record<string, CheckersPiece>,
  from: string,
  piece: CheckersPiece
): CheckersMoveCandidate[] {
  const out: CheckersMoveCandidate[] = [];
  const { f: f0, r: r0 } = squareFileRank(from);
  for (const [df, dr] of checkersDeltas(piece)) {
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

function listAllCheckersMoves(
  board: Record<string, CheckersPiece>,
  side: Side,
  forcedFrom: string | null
): { moves: CheckersMoveCandidate[]; hasAnyCapture: boolean } {
  const moves: CheckersMoveCandidate[] = [];
  let hasAnyCapture = false;
  const squares = forcedFrom ? [forcedFrom] : Object.keys(board);

  for (const sq of squares) {
    const p = board[sq];
    if (!p || p.color !== side) continue;
    const caps = listCheckersCapturesFrom(board, sq, p);
    if (caps.length) {
      hasAnyCapture = true;
      moves.push(...caps);
    }
  }

  if (hasAnyCapture) return { moves, hasAnyCapture };

  for (const sq of squares) {
    const p = board[sq];
    if (!p || p.color !== side) continue;
    moves.push(...listCheckersSimpleMovesFrom(board, sq, p));
  }

  return { moves, hasAnyCapture: false };
}

function piecePath(type: string) {
  switch (type) {
    case "p":
      return "/models/pawn.glb";
    case "n":
      return "/models/knight.glb";
    case "b":
      return "/models/bishop.glb";
    case "r":
      return "/models/rook.glb";
    case "q":
      return "/models/queen.glb";
    case "k":
      return "/models/king.glb";
    default:
      return "/models/pawn.glb";
  }
}

function applyFresnelRim(
  material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
  rimColor: THREE.Color,
  rimPower = 2.25,
  rimIntensity = 0.65
) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    try {
      (prev as any).call(material as any, shader, renderer);
    } catch {
      // ignore
    }
    shader.uniforms.uRimColor = { value: rimColor };
    shader.uniforms.uRimPower = { value: rimPower };
    shader.uniforms.uRimIntensity = { value: rimIntensity };

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\nuniform vec3 uRimColor;\nuniform float uRimPower;\nuniform float uRimIntensity;`
      )
      .replace(
        "#include <output_fragment>",
        `float rim = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), uRimPower);\noutgoingLight += uRimColor * rim * uRimIntensity;\n#include <output_fragment>`
      );
  };
  material.needsUpdate = true;
}

function applyClearGlassShader(
  material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
  opts?: {
    scale?: number;
    absorbStrength?: number;
    bottomTint?: THREE.Color;
  }
) {
  const scale = opts?.scale ?? 1.0;
  const absorbStrength = opts?.absorbStrength ?? 0.35;
  const bottomTint = opts?.bottomTint ?? new THREE.Color("#e9f2ff");

  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    try {
      (prev as any).call(material as any, shader, renderer);
    } catch {
      // ignore
    }

    shader.uniforms.uGlassScale = { value: scale };
    shader.uniforms.uGlassAbsorb = { value: absorbStrength };
    shader.uniforms.uGlassBottomTint = { value: bottomTint };

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying vec3 vGlassWorldPos;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\nvec4 wsPosG = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\nwsPosG = instanceMatrix * wsPosG;\n#endif\nwsPosG = modelMatrix * wsPosG;\nvGlassWorldPos = wsPosG.xyz;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying vec3 vGlassWorldPos;\nuniform float uGlassScale;\nuniform float uGlassAbsorb;\nuniform vec3 uGlassBottomTint;`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>\nfloat gy = clamp(vGlassWorldPos.y * uGlassScale, 0.0, 1.0);\n// Slight base tint, clearer towards the top\ndiffuseColor.rgb = mix(uGlassBottomTint, diffuseColor.rgb, smoothstep(0.0, 1.0, gy));`
      )
      .replace(
        "#include <output_fragment>",
        `// Gentle absorption at grazing angles\nfloat ndv = clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0);\nfloat fres = pow(1.0 - ndv, 2.0);\noutgoingLight *= (1.0 - fres * uGlassAbsorb);\n#include <output_fragment>`
      );
  };

  material.needsUpdate = true;
}

function applyMilkGlassShader(
  material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
  opts?: {
    milkiness?: number;
    bottomTint?: THREE.Color;
  }
) {
  const milkiness = opts?.milkiness ?? 0.75;
  const bottomTint = opts?.bottomTint ?? new THREE.Color("#ffffff");

  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    try {
      (prev as any).call(material as any, shader, renderer);
    } catch {
      // ignore
    }

    shader.uniforms.uMilkiness = { value: milkiness };
    shader.uniforms.uMilkBottomTint = { value: bottomTint };

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying vec3 vMilkWorldPos;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\nvec4 wsPosM = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\nwsPosM = instanceMatrix * wsPosM;\n#endif\nwsPosM = modelMatrix * wsPosM;\nvMilkWorldPos = wsPosM.xyz;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying vec3 vMilkWorldPos;\nuniform float uMilkiness;\nuniform vec3 uMilkBottomTint;`
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>\n// Smooth frosted roughness (no dotty noise)\nroughnessFactor = clamp(max(roughnessFactor, 0.75) + uMilkiness * 0.15, 0.0, 1.0);`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>\n// Subtle vertical density: slightly denser near base\nfloat g = clamp(vMilkWorldPos.y, 0.0, 1.0);\ndiffuseColor.rgb = mix(uMilkBottomTint, diffuseColor.rgb, smoothstep(0.0, 1.0, g));`
      )
      .replace(
        "#include <output_fragment>",
        `float ndv = clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0);\n// More scattering at grazing angles\nfloat scatter = clamp(uMilkiness * 0.75 + (1.0 - ndv) * 0.35, 0.0, 1.0);\noutgoingLight = mix(outgoingLight, vec3(1.0), scatter);\n#include <output_fragment>`
      );
  };

  material.needsUpdate = true;
}

function applyWoodGrainShader(
  material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
  opts?: { scale?: number; intensity?: number }
) {
  const scale = opts?.scale ?? 6.0;
  const intensity = opts?.intensity ?? 0.4;

  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    try {
      (prev as any).call(material as any, shader, renderer);
    } catch {
      // ignore
    }
    shader.uniforms.uWoodScale = { value: scale };
    shader.uniforms.uWoodIntensity = { value: intensity };

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying vec3 vWorldPos;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\nvec4 wsPos = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\nwsPos = instanceMatrix * wsPos;\n#endif\nwsPos = modelMatrix * wsPos;\nvWorldPos = wsPos.xyz;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vWorldPos;
uniform float uWoodScale;
uniform float uWoodIntensity;

float woodHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float woodNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f*f*(3.0-2.0*f);
    return mix(mix(woodHash(i + vec2(0.0,0.0)), woodHash(i + vec2(1.0,0.0)), f.x),
               mix(woodHash(i + vec2(0.0,1.0)), woodHash(i + vec2(1.0,1.0)), f.x), f.y);
}

float fbmWood(vec2 p) {
    float v = 0.0;
    v += 0.5 * woodNoise(p); p *= 2.0;
    v += 0.25 * woodNoise(p); p *= 2.0;
    return v;
}`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
vec2 wp = vWorldPos.xz * uWoodScale;
// Distort domain for organic look
float n = fbmWood(wp);
wp += n * 0.5;

// Wood rings
float ring = sin(wp.x * 10.0 + wp.y * 2.0);
ring = smoothstep(-0.4, 0.4, ring);

// Fibers
float fiber = fbmWood(wp * vec2(20.0, 1.0));

float grain = mix(ring, fiber, 0.3);
float shade = mix(0.7, 1.1, grain);

diffuseColor.rgb *= mix(1.0, shade, uWoodIntensity);
`
      );
  };

  material.needsUpdate = true;
}

function applyHammeredMetalShader(
  material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
  opts?: { strength?: number; scale?: number }
) {
  const strength = opts?.strength ?? 0.15;
  const scale = opts?.scale ?? 12.0;

  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    try {
      (prev as any).call(material as any, shader, renderer);
    } catch {
      // ignore
    }
    shader.uniforms.uMetalVarStrength = { value: strength };
    shader.uniforms.uMetalVarScale = { value: scale };

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying vec3 vWorldPos2;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\nvec4 wsPos2 = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\nwsPos2 = instanceMatrix * wsPos2;\n#endif\nwsPos2 = modelMatrix * wsPos2;\nvWorldPos2 = wsPos2.xyz;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vWorldPos2;
uniform float uMetalVarStrength;
uniform float uMetalVarScale;

float metalHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

float hammeredNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float md = 1.0;
    for(int y=-1; y<=1; y++)
    for(int x=-1; x<=1; x++) {
        vec2 g = vec2(float(x), float(y));
        vec2 o = vec2(metalHash(i + g), metalHash(i + g + 57.0));
        vec2 r = g + o - f;
        float d = length(r);
        if(d < md) md = d;
    }
    return md;
}`
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
float dents = hammeredNoise(vWorldPos2.xz * uMetalVarScale);
float dentFactor = smoothstep(0.2, 0.8, dents);
roughnessFactor = clamp(roughnessFactor + (dentFactor - 0.5) * uMetalVarStrength, 0.05, 0.9);`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
float cDents = hammeredNoise(vWorldPos2.xz * uMetalVarScale);
float cFactor = smoothstep(0.25, 0.75, cDents);
// High contrast for hammered look
diffuseColor.rgb *= mix(0.7, 1.3, cFactor);`
      );
  };

  material.needsUpdate = true;
}

function PieceModel({
  path,
  tint,
  chessTheme,
  side,
}: {
  path: string;
  tint: THREE.Color;
  chessTheme?: string;
  side?: "w" | "b";
}) {
  const gltf = useGLTF(path) as any;

  const cloned = useMemo(() => {
    const root: THREE.Object3D = gltf.scene.clone(true);
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      const srcMat = mesh.material as any;
      if (!srcMat || !srcMat.isMaterial) return;
      mesh.material = srcMat.clone();
      const clonedMat = mesh.material as any;
      if (clonedMat.color && clonedMat.color.isColor) {
        clonedMat.color = clonedMat.color.clone();
      }

      if (chessTheme === "chess_glass") {
        const isWhite = side === "w";
        // Match ref: white = frosted/milky, black = clear glass.
        const base = isWhite
          ? new THREE.Color("#f7fbff")
          : new THREE.Color("#0f141b");
        const rim = isWhite
          ? new THREE.Color("#ffffff")
          : new THREE.Color("#e9f2ff");

        if (clonedMat.color && clonedMat.color.isColor)
          clonedMat.color.copy(base);
        if (typeof clonedMat.metalness === "number") clonedMat.metalness = 0.0;
        if (typeof clonedMat.roughness === "number")
          clonedMat.roughness = isWhite ? 0.92 : 0.03;
        clonedMat.transparent = true;
        clonedMat.opacity = isWhite ? 0.86 : 0.42;
        // Clear glass blends better without writing depth.
        clonedMat.depthWrite = isWhite;
        (clonedMat as any).premultipliedAlpha = true;
        if (clonedMat.emissive && clonedMat.emissive.isColor) {
          clonedMat.emissive = clonedMat.emissive.clone();
          clonedMat.emissive.copy(rim);
          clonedMat.emissiveIntensity = isWhite ? 0.02 : 0.04;
        }
        if (typeof clonedMat.envMapIntensity === "number")
          clonedMat.envMapIntensity = isWhite ? 0.8 : 1.6;

        if (isWhite) {
          applyMilkGlassShader(clonedMat, {
            milkiness: 0.85,
            bottomTint: new THREE.Color("#eef4ff"),
          });
          applyFresnelRim(clonedMat, rim, 2.2, 0.25);
        } else {
          applyClearGlassShader(clonedMat, {
            scale: 1.0,
            absorbStrength: 0.7,
            bottomTint: new THREE.Color("#050607"),
          });
          applyFresnelRim(clonedMat, rim, 2.8, 0.22);
        }
      } else if (chessTheme === "chess_gold") {
        const isWhite = side === "w";
        // Shader-based metals: white side = silver, black side = gold.
        const base = isWhite
          ? new THREE.Color("#d8dee6")
          : new THREE.Color("#ffd15a");
        const rim = isWhite
          ? new THREE.Color("#ffffff")
          : new THREE.Color("#fff0c2");

        if (clonedMat.color && clonedMat.color.isColor)
          clonedMat.color.copy(base);
        if (typeof clonedMat.metalness === "number")
          clonedMat.metalness = isWhite ? 0.72 : 0.9;
        if (typeof clonedMat.roughness === "number")
          clonedMat.roughness = isWhite ? 0.34 : 0.2;
        if (clonedMat.emissive && clonedMat.emissive.isColor) {
          clonedMat.emissive = clonedMat.emissive.clone();
          clonedMat.emissive.copy(rim);
          clonedMat.emissiveIntensity = isWhite ? 0.04 : 0.08;
        }
        if (typeof clonedMat.envMapIntensity === "number")
          clonedMat.envMapIntensity = isWhite ? 1.1 : 1.25;
        applyHammeredMetalShader(clonedMat, {
          strength: isWhite ? 0.15 : 0.2,
          scale: 14.0,
        });
        applyFresnelRim(clonedMat, rim, 2.8, isWhite ? 0.24 : 0.28);
      } else if (chessTheme === "chess_wood") {
        if (clonedMat.color && clonedMat.color.isColor)
          clonedMat.color.copy(tint);
        // Wood: low metalness, higher roughness, with procedural grain shader
        if (typeof clonedMat.metalness === "number") clonedMat.metalness = 0.05;
        if (typeof clonedMat.roughness === "number") clonedMat.roughness = 0.85;
        if (typeof clonedMat.envMapIntensity === "number")
          clonedMat.envMapIntensity = 0.35;
        if (clonedMat.emissive && clonedMat.emissive.isColor) {
          clonedMat.emissive = clonedMat.emissive.clone();
          clonedMat.emissive.copy(tint.clone().multiplyScalar(0.02));
          clonedMat.emissiveIntensity = 0.25;
        }
        applyWoodGrainShader(clonedMat, { scale: 11.5, intensity: 0.55 });
      } else if (chessTheme === "chess_marble") {
        const isWhite = side === "w";
        // Marble shader using the same technique as the marble board
        const darkBase = isWhite
          ? new THREE.Color("#e8e8e8")
          : new THREE.Color("#5e5e5e");
        const lightBase = isWhite
          ? new THREE.Color("#6a6560")
          : new THREE.Color("#c0c0c0");

        if (clonedMat.color && clonedMat.color.isColor)
          clonedMat.color.copy(darkBase);
        if (typeof clonedMat.metalness === "number") clonedMat.metalness = 0.12;
        if (typeof clonedMat.roughness === "number") clonedMat.roughness = 0.25;
        if (typeof clonedMat.envMapIntensity === "number")
          clonedMat.envMapIntensity = 0.85;

        // Apply marble shader
        const prev = clonedMat.onBeforeCompile;
        clonedMat.onBeforeCompile = (shader: any, renderer: any) => {
          try {
            (prev as any).call(clonedMat as any, shader, renderer);
          } catch {
            // ignore
          }

          shader.uniforms.uDarkBase = { value: darkBase };
          shader.uniforms.uLightBase = { value: lightBase };
          shader.uniforms.uIsWhite = { value: isWhite ? 1.0 : 0.0 };

          shader.vertexShader = shader.vertexShader
            .replace(
              "#include <common>",
              `#include <common>\nvarying vec3 vWorldPos;`
            )
            .replace(
              "#include <begin_vertex>",
              `#include <begin_vertex>\nvec4 wsPos = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\nwsPos = instanceMatrix * wsPos;\n#endif\nwsPos = modelMatrix * wsPos;\nvWorldPos = wsPos.xyz;`
            );

          shader.fragmentShader = shader.fragmentShader
            .replace(
              "#include <common>",
              `#include <common>
varying vec3 vWorldPos;
uniform vec3 uDarkBase;
uniform vec3 uLightBase;
uniform float uIsWhite;

vec2 hash2(vec2 p) {
    p = vec2(dot(p,vec2(127.1,311.7)), dot(p,vec2(269.5,183.3)));
    return fract(sin(p)*43758.5453);
}

float voronoiCracks(vec2 p) {
    vec2 n = floor(p);
    vec2 f = fract(p);
    float md = 8.0;
    vec2 mg, mr;
    
    for(int j=-1; j<=1; j++)
    for(int i=-1; i<=1; i++) {
        vec2 g = vec2(float(i),float(j));
        vec2 o = hash2(n + g);
        vec2 r = g + o - f;
        float d = dot(r,r);
        if(d < md) {
            md = d;
            mr = r;
            mg = g;
        }
    }
    
    md = 8.0;
    for(int j=-1; j<=1; j++)
    for(int i=-1; i<=1; i++) {
        vec2 g = vec2(float(i),float(j));
        vec2 o = hash2(n + g);
        vec2 r = g + o - f;
        if(dot(mr-r,mr-r) > 0.00001) {
            md = min(md, dot(0.5*(mr+r), normalize(r-mr)));
        }
    }
    return md;
}`
            )
            .replace(
              "#include <color_fragment>",
              `#include <color_fragment>
vec3 p = vWorldPos * 4.0;
float cracks = voronoiCracks(p.xz + p.y * 0.5);
float crackLine = 1.0 - smoothstep(0.0, 0.04, cracks);

float noise = 0.0;
vec2 np = p.xz * 0.5;
noise += (sin(np.x * 3.0 + sin(np.y * 2.0)) + 1.0) * 0.5;

vec3 baseColor = uDarkBase * (0.85 + noise * 0.3); // Subtle variance
vec3 crackColor = uIsWhite > 0.5 ? vec3(0.2, 0.2, 0.25) : vec3(0.9, 0.9, 0.95);

diffuseColor.rgb = mix(baseColor, crackColor, crackLine * 0.65);
`
            );
        };
        clonedMat.needsUpdate = true;
      } else {
        if (clonedMat.color && clonedMat.color.isColor)
          clonedMat.color.copy(tint);
        // Metallic material for pieces
        if (typeof clonedMat.metalness === "number") clonedMat.metalness = 0.7;
        if (typeof clonedMat.roughness === "number") clonedMat.roughness = 0.3;
      }
    });

    // Orient upright and center the model on its base.
    root.rotation.set(Math.PI / 2, 0, 0);
    root.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(root);
    if (
      Number.isFinite(box.min.x) &&
      Number.isFinite(box.min.y) &&
      Number.isFinite(box.min.z)
    ) {
      const center = box.getCenter(new THREE.Vector3());
      // Center X/Z, but rest on the bottom Y
      root.position.x -= center.x;
      root.position.z -= center.z;
      root.position.y -= box.min.y;
      root.updateWorldMatrix(true, true);
    }

    return root;
  }, [gltf, tint, chessTheme, side]);

  return <primitive object={cloned} />;
}

const BOARD_TOP_Y = 0.08;
const SQUARE_TOP_Y = 0.04;

function easeInOut(t: number) {
  // smoothstep
  return t * t * (3 - 2 * t);
}

function AnimatedPiece({
  square,
  type,
  color,
  originVec,
  squareSize,
  animateFrom,
  animSeq,
  canMove,
  mySide,
  onPickPiece,
  whiteTint,
  blackTint,
  chessTheme,
  isStartled,
}: {
  square: Square;
  type: string;
  color: Side;
  originVec: THREE.Vector3;
  squareSize: number;
  animateFrom: Square | null;
  animSeq: number;
  canMove: boolean;
  mySide: Side | null;
  onPickPiece: (sq: Square) => void;
  whiteTint: THREE.Color;
  blackTint: THREE.Color;
  chessTheme?: string;
  isStartled?: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const animRef = useRef<{
    seq: number;
    startMs: number;
    from: THREE.Vector3;
    to: THREE.Vector3;
  } | null>(null);

  const finalPos = useMemo(
    () => squareCenter(square, originVec, squareSize),
    [square, originVec, squareSize]
  );

  useEffect(() => {
    if (!animateFrom) {
      animRef.current = null;
      const g = groupRef.current;
      if (g) g.position.set(finalPos.x, BOARD_TOP_Y, finalPos.z);
      return;
    }

    const fromPos = squareCenter(animateFrom, originVec, squareSize);
    animRef.current = {
      seq: animSeq,
      startMs: performance.now(),
      from: fromPos,
      to: finalPos,
    };
    const g = groupRef.current;
    if (g) g.position.set(fromPos.x, BOARD_TOP_Y, fromPos.z);
  }, [animateFrom, animSeq, originVec, squareSize, finalPos]);

  useFrame(() => {
    const g = groupRef.current;
    if (!g) return;
    const a = animRef.current;
    if (!a) {
      g.position.set(finalPos.x, BOARD_TOP_Y, finalPos.z);
      return;
    }
    if (a.seq !== animSeq) {
      animRef.current = null;
      g.position.set(finalPos.x, BOARD_TOP_Y, finalPos.z);
      return;
    }

    const dur = 240;
    const t = (performance.now() - a.startMs) / dur;
    const k = easeInOut(clamp(t, 0, 1));
    const x = THREE.MathUtils.lerp(a.from.x, a.to.x, k);
    const z = THREE.MathUtils.lerp(a.from.z, a.to.z, k);
    g.position.set(x, BOARD_TOP_Y, z);

    if (t >= 1) {
      animRef.current = null;
    }
  });

  const tint = color === "w" ? whiteTint : blackTint;
  const scale = 11.25;

  return (
    <group
      ref={groupRef}
      onPointerDown={(e) => {
        if (e.button !== 0) return; // Left click only
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

function JoinPad({
  label,
  center,
  size,
  active,
  disabled,
  onClick,
}: {
  label: string;
  center: THREE.Vector3;
  size: [number, number];
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const [w, d] = size;
  const handleClick = (e: any) => {
    if (e.button !== 0) return; // Left click only
    e.stopPropagation();
    if (disabled) return;
    onClick();
  };
  return (
    <group
      position={[center.x, center.y, center.z]}
      onPointerDown={handleClick}
      onPointerEnter={() => {
        if (!disabled) document.body.style.cursor = "pointer";
      }}
      onPointerLeave={() => {
        document.body.style.cursor = "default";
      }}
    >
      {/* Stone pillar base */}
      <mesh receiveShadow castShadow onPointerDown={handleClick}>
        <boxGeometry args={[w, 0.3, d]} />
        <meshStandardMaterial
          color={disabled ? "#4a4a4a" : active ? "#d4af37" : "#8b7355"}
          roughness={0.6}
          metalness={active ? 0.3 : 0.1}
        />
      </mesh>
      {/* Decorative top cap */}
      <mesh
        receiveShadow
        castShadow
        position={[0, 0.18, 0]}
        onPointerDown={handleClick}
      >
        <boxGeometry args={[w * 1.1, 0.06, d * 1.1]} />
        <meshStandardMaterial
          color={disabled ? "#3a3a3a" : active ? "#ffd700" : "#a0826d"}
          roughness={0.5}
          metalness={active ? 0.4 : 0.15}
        />
      </mesh>
      {/* Text on top */}
      <Text
        position={[0, 0.235, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.2}
        lineHeight={0.9}
        maxWidth={w * 0.98}
        textAlign="center"
        color={disabled ? "#888" : active ? "#fff" : "#1a1a1a"}
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.008}
        outlineColor={active ? "#000" : "#000000"}
        fontWeight="bold"
        depthOffset={-1}
        onPointerDown={handleClick}
      >
        {label}
      </Text>
      {/* Glowing effect when active */}
      {active && (
        <pointLight
          position={[0, 0.5, 0]}
          color="#ffd700"
          intensity={2}
          distance={3}
        />
      )}
    </group>
  );
}

function PlantMaterial(props: any) {
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);

  const onBeforeCompile = (shader: any) => {
    shader.vertexShader = `
      varying vec3 vPos;
      
      vec3 hash33(vec3 p3) {
          p3 = fract(p3 * vec3(.1031, .1030, .0973));
          p3 += dot(p3, p3.yxz + 33.33);
          return fract((p3.xxy + p3.yxx) * p3.zyx);
      }

      float voronoi(vec3 x) {
          vec3 p = floor(x);
          vec3 f = fract(x);
          float res = 100.0;
          for(int k=-1; k<=1; k++)
          for(int j=-1; j<=1; j++)
          for(int i=-1; i<=1; i++) {
              vec3 b = vec3(float(i), float(j), float(k));
              vec3 r = vec3(b) - f + hash33(p + b);
              float d = dot(r, r);
              res = min(res, d);
          }
          return sqrt(res);
      }

      ${shader.vertexShader}
    `
      .replace(
        "#include <worldpos_vertex>",
        `
      #include <worldpos_vertex>
      vPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
      `
      )
      .replace(
        "#include <begin_vertex>",
        `
      #include <begin_vertex>
      
      // Vertex Displacement for Bushes
      float disp = voronoi(position * 3.5); 
      float strength = 0.25; 
      transformed += normal * (1.0 - disp) * strength;
      `
      );

    shader.fragmentShader = `
      varying vec3 vPos;
      
      // Bush colors from reference
      #define COLOR_BUSH1 (0.8*vec3(0.07,0.3,0.05))
      #define COLOR_BUSH2 (0.55*vec3(0.12,0.6,0.2))
      #define COLOR_BUSH3 (0.55*vec3(0.1,0.35,0.09))
      #define COLOR_BUSH4 (0.82*vec3(0.18,0.39,0.06))
      #define COLOR_BUSH5 vec3(0.1,0.3,0.01)

      // Voronoi / Cellular Noise for leaves
      vec3 hash33(vec3 p3) {
          p3 = fract(p3 * vec3(.1031, .1030, .0973));
          p3 += dot(p3, p3.yxz + 33.33);
          return fract((p3.xxy + p3.yxx) * p3.zyx);
      }

      float voronoi(vec3 x) {
          vec3 p = floor(x);
          vec3 f = fract(x);
          float res = 100.0;
          for(int k=-1; k<=1; k++)
          for(int j=-1; j<=1; j++)
          for(int i=-1; i<=1; i++) {
              vec3 b = vec3(float(i), float(j), float(k));
              vec3 r = vec3(b) - f + hash33(p + b);
              float d = dot(r, r);
              res = min(res, d);
          }
          return sqrt(res); // Distance to center
      }

      ${shader.fragmentShader}
    `.replace(
      "#include <color_fragment>",
      `
      #include <color_fragment>
      
      // Leafy Voronoi Pattern
      float v = voronoi(vPos * 12.0);
      float leaf = 1.0 - smoothstep(0.0, 0.7, v);
      vec3 col = mix(COLOR_BUSH1, COLOR_BUSH2, leaf);
      float largeNoise = voronoi(vPos * 2.0);
      col = mix(col, COLOR_BUSH3, largeNoise);
      if (largeNoise > 0.8) {
         col = mix(col, COLOR_BUSH5, 0.5);
      }
      float ao = smoothstep(0.0, 0.5, 1.0 - v);
      diffuseColor.rgb = col * (0.4 + 0.6 * ao);
      
      // Silhouette breakup
      // Use gl_FrontFacing or similar if needed, but for now just discard based on noise
      // to avoid vNormal issues
      if (v > 0.65) {
          // discard; // Optional: can look messy on small plants without proper depth sorting
      }
      `
    );
  };

  return (
    <meshStandardMaterial
      ref={materialRef}
      onBeforeCompile={onBeforeCompile}
      side={THREE.DoubleSide}
      {...props}
    />
  );
}

function WoodMaterial({ color, ...props }: any) {
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);

  const onBeforeCompile = (shader: any) => {
    shader.vertexShader = `
      varying vec3 vPos;
      ${shader.vertexShader}
    `.replace(
      "#include <worldpos_vertex>",
      `
      #include <worldpos_vertex>
      vPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
      `
    );

    shader.fragmentShader = `
      varying vec3 vPos;
      
      float hash(vec2 p) {
          return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
      }
      float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
                    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      float fbm(vec2 p) {
          float f = 0.0;
          f += 0.5000 * noise(p); p *= 2.02;
          f += 0.2500 * noise(p); p *= 2.03;
          f += 0.1250 * noise(p); p *= 2.01;
          f += 0.0625 * noise(p);
          return f;
      }

      ${shader.fragmentShader}
    `.replace(
      "#include <color_fragment>",
      `
      #include <color_fragment>
      
      // Wood grain logic
      // Stretch noise along one axis to simulate grain
      // Use world position for continuity across squares if desired, or local if we want them distinct.
      // vPos is world position.
      
      float grain = fbm(vPos.xz * vec2(1.0, 12.0)); // Stretched z-axis grain
      
      // Add some ring-like patterns (turbulence)
      float rings = noise(vPos.xz * 1.5 + grain * 0.3);
      
      // Mix base color with darker/lighter variations
      vec3 baseColor = diffuseColor.rgb;
      vec3 darkGrain = baseColor * 0.75;
      vec3 lightGrain = baseColor * 1.15;
      
      // Combine
      float pattern = smoothstep(0.2, 0.8, grain * 0.7 + rings * 0.3);
      diffuseColor.rgb = mix(darkGrain, lightGrain, pattern);
      `
    );
  };

  return (
    <meshStandardMaterial
      ref={materialRef}
      color={color}
      onBeforeCompile={onBeforeCompile}
      {...props}
    />
  );
}

function MarbleTileMaterial({ color, ...props }: { color: string } & any) {
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const base = useMemo(() => new THREE.Color(color), [color]);
  const vein = useMemo(() => new THREE.Color("#ffffff"), []);

  const onBeforeCompile = (shader: any) => {
    shader.uniforms.uBase = { value: base };
    shader.uniforms.uVein = { value: vein };
    shader.uniforms.uSquareSize = { value: 0.6 };

    shader.vertexShader = `
      varying vec3 vPos;
      varying vec2 vMarbleUv;
      ${shader.vertexShader}
    `
      .replace(
        "#include <uv_vertex>",
        `
      #include <uv_vertex>
      vMarbleUv = uv;
      `
      )
      .replace(
        "#include <worldpos_vertex>",
        `
        #include <worldpos_vertex>
        vPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        `
      );

    shader.fragmentShader = `
      varying vec3 vPos;
      varying vec2 vMarbleUv;
      uniform vec3 uBase;
      uniform vec3 uVein;
      uniform float uSquareSize;

      float hash21(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }
      float noise2(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        float a = hash21(i + vec2(0.0, 0.0));
        float b = hash21(i + vec2(1.0, 0.0));
        float c = hash21(i + vec2(0.0, 1.0));
        float d = hash21(i + vec2(1.0, 1.0));
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }

      // Granite: layered abs noise (from reference shader)
      float granite(vec2 p) {
        float o = 0.0;
        for (int i = 0; i < 4; i++) {
          o = o * 2.0 + abs(noise2(p) * 2.0 - 1.0);
          p *= 2.0;
        }
        return o / 15.0; // normalize (2^4 - 1)
      }

      mat2 rot(float a) {
        float s = sin(a);
        float c = cos(a);
        return mat2(c, -s, s, c);
      }

      ${shader.fragmentShader}
    `.replace(
      "#include <color_fragment>",
      `
      #include <color_fragment>

      // Per-square variation so tiles don't all look identical.
      // Index in world space (board is centered near origin, squareSize=0.6).
      vec2 idx = floor((vPos.xz / uSquareSize) + vec2(4.0));
      float r0 = hash21(idx + vec2(1.7, 9.2));
      float r1 = hash21(idx + vec2(7.3, 2.1));
      float r2 = hash21(idx + vec2(3.1, 5.9));

      float ang = r0 * 6.2831853;
      vec2 uv = vMarbleUv - 0.5;
      uv = rot(ang) * uv;
      uv += 0.5;

      vec2 tileOffset = vec2(r1, r2) * 3.5;
      vec2 p = (uv + tileOffset) * vec2(2.0, 2.0);

      // Reference shader approach: squash vector + granite pattern
      float tileFlip = r0 > 0.5 ? 1.0 : -1.0;
      vec2 v = normalize(vec2(tileFlip, 1.0));
      float squash = dot(v, p) * (2.5 + 0.5 * tileFlip);
      float pattern = 1.0 - granite((p + v * squash) * 2.2);
      
      // Sharp color transition using power curve (like reference)
      float veinThreshold = 0.12;
      vec3 darkBase = uBase * 0.45;
      vec3 lightBase = mix(uBase, uVein, 0.35);
      float t = pow(clamp(pattern / (1.0 - veinThreshold * 0.7), 0.0, 1.0), 18.0);
      vec3 col = mix(darkBase, lightBase, t);
      
      // Subtle per-tile brightness variation
      col *= 1.0 + (r1 - 0.5) * 0.08;

      diffuseColor.rgb = col;
      `
    );

    (materialRef.current as any).userData.shader = shader;
  };

  return (
    <meshStandardMaterial
      ref={materialRef}
      onBeforeCompile={onBeforeCompile}
      roughness={0.22}
      metalness={0.0}
      {...props}
    />
  );
}

function NeonTileMaterial({ color, ...props }: { color: string } & any) {
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const base = useMemo(() => new THREE.Color(color), [color]);
  const neon = useMemo(() => new THREE.Color("#4be7ff"), []);
  const neonAlt = useMemo(() => new THREE.Color("#ff4bd8"), []);

  const onBeforeCompile = (shader: any) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uBase = { value: base };
    shader.uniforms.uNeon = { value: neon };
    shader.uniforms.uNeonAlt = { value: neonAlt };
    shader.uniforms.uSquareSize = { value: 0.6 };

    shader.vertexShader = `
      varying vec3 vPos;
      varying vec2 vTronUv;
      ${shader.vertexShader}
    `
      .replace(
        "#include <uv_vertex>",
        `
        #include <uv_vertex>
        vTronUv = uv;
        `
      )
      .replace(
        "#include <worldpos_vertex>",
        `
        #include <worldpos_vertex>
        vPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        `
      );

    shader.fragmentShader = `
      varying vec3 vPos;
      varying vec2 vTronUv;
      uniform float uTime;
      uniform vec3 uBase;
      uniform vec3 uNeon;
      uniform vec3 uNeonAlt;
      uniform float uSquareSize;

      float hash21(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }
      float noise2(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        float a = hash21(i + vec2(0.0, 0.0));
        float b = hash21(i + vec2(1.0, 0.0));
        float c = hash21(i + vec2(0.0, 1.0));
        float d = hash21(i + vec2(1.0, 1.0));
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }
      float fbm2(vec2 p) {
        float f = 0.0;
        f += 0.5000 * noise2(p); p *= 2.02;
        f += 0.2500 * noise2(p); p *= 2.03;
        f += 0.1250 * noise2(p); p *= 2.01;
        f += 0.0625 * noise2(p);
        return f;
      }

      float panelSeams(vec2 p, vec2 cell) {
        vec2 g = p / cell;
        vec2 f = abs(fract(g) - 0.5);
        float line = min(f.x, f.y);
        return 1.0 - smoothstep(0.485, 0.5, line);
      }
      ${shader.fragmentShader}
    `
      .replace(
        "#include <color_fragment>",
        `
        #include <color_fragment>

        vec2 uv = vTronUv;
        vec2 pW = vPos.xz;
        float grime = fbm2(pW * 0.30);
        float pulse = 0.82 + 0.18 * sin(uTime * 1.10 + (vPos.x + vPos.z) * 0.65);

        float s0 = panelSeams(pW, vec2(1.8, 1.8));
        float s1 = panelSeams(pW + vec2(0.55, 0.8), vec2(4.6, 4.6));
        float seams = clamp(s0 * 0.9 + s1 * 0.35, 0.0, 1.0);

        float edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
        float borderLine = 1.0 - smoothstep(0.045, 0.070, edge);

        vec2 p = uv * 10.0;
        vec2 cell = abs(fract(p) - 0.5);
        float grid = 1.0 - smoothstep(0.492, 0.5, min(cell.x, cell.y));

        float n = fbm2(uv * 14.0 + vec2(2.3, -1.7));
        float traces = smoothstep(0.70, 0.86, n) * 0.55;

        vec2 idx = floor((pW / uSquareSize) + vec2(4.0));
        float parity = mod(idx.x + idx.y, 2.0);
        vec3 neonCol = mix(uNeon, uNeonAlt, parity);

        float baseLum = dot(uBase, vec3(0.299, 0.587, 0.114));
        float baseMul = mix(0.28, 0.52, smoothstep(0.08, 0.34, baseLum));

        diffuseColor.rgb = uBase * baseMul;
        diffuseColor.rgb *= mix(0.92, 1.03, grime);
        float dataPulse = smoothstep(0.92, 1.0, abs(sin((uv.x + uv.y) * 18.0 + uTime * 1.6 + n * 4.0)));
        diffuseColor.rgb += neonCol * (borderLine * 0.045 + grid * 0.016 + traces * 0.015) * pulse;
        diffuseColor.rgb += neonCol * (seams * 0.012) * (0.85 + 0.15 * grime);
        diffuseColor.rgb += neonCol * (dataPulse * 0.008) * (0.8 + 0.2 * pulse);
        `
      )
      .replace(
        "#include <emissivemap_fragment>",
        `
        #include <emissivemap_fragment>
        vec2 uv2 = vTronUv;
        float edge2 = min(min(uv2.x, 1.0 - uv2.x), min(uv2.y, 1.0 - uv2.y));
        float borderLine2 = 1.0 - smoothstep(0.045, 0.070, edge2);

        vec2 p2 = uv2 * 10.0;
        vec2 cell2 = abs(fract(p2) - 0.5);
        float grid2 = 1.0 - smoothstep(0.492, 0.5, min(cell2.x, cell2.y));

        float n2 = fbm2(uv2 * 14.0 + vec2(2.3, -1.7));
        float traces2 = smoothstep(0.70, 0.86, n2) * 0.55;

        vec2 pW2 = vPos.xz;
        float s02 = panelSeams(pW2, vec2(1.8, 1.8));
        float s12 = panelSeams(pW2 + vec2(0.55, 0.8), vec2(4.6, 4.6));
        float seams2 = clamp(s02 * 0.9 + s12 * 0.35, 0.0, 1.0);

        vec2 idx2 = floor((pW2 / uSquareSize) + vec2(4.0));
        float parity2 = mod(idx2.x + idx2.y, 2.0);
        vec3 neonCol2 = mix(uNeon, uNeonAlt, parity2);

        float pulse2 = 0.82 + 0.18 * sin(uTime * 1.10 + (vPos.x + vPos.z) * 0.65);
        float flicker2 = 0.92 + 0.08 * noise2(vPos.xz * 0.70 + vec2(uTime * 0.10, uTime * 0.07));

        totalEmissiveRadiance += neonCol2 * (borderLine2 * 0.10 + grid2 * 0.032 + traces2 * 0.040) * pulse2 * flicker2;
        totalEmissiveRadiance += neonCol2 * (seams2 * 0.030) * (0.85 + 0.15 * flicker2);
        `
      );

    (materialRef.current as any).userData.shader = shader;
  };

  useFrame(({ clock }) => {
    const shader = (materialRef.current as any)?.userData?.shader;
    if (shader?.uniforms?.uTime)
      shader.uniforms.uTime.value = clock.getElapsedTime();
  });

  return (
    <meshStandardMaterial
      ref={materialRef}
      onBeforeCompile={onBeforeCompile}
      roughness={0.25}
      metalness={0.45}
      emissive={neon}
      emissiveIntensity={0.05}
      {...props}
    />
  );
}

function Bench({
  position,
  rotation,
  onClick,
}: {
  position: [number, number, number];
  rotation?: [number, number, number];
  onClick?: (e: any) => void;
}) {
  const legColor = "#222222";
  const woodColor = "#8b5a2b";

  return (
    <group
      position={position}
      rotation={rotation}
      onPointerDown={(e) => {
        e.stopPropagation();
        onClick && onClick(e);
      }}
      onPointerEnter={(e) => {
        e.stopPropagation();
        document.body.style.cursor = "pointer";
      }}
      onPointerLeave={(e) => {
        e.stopPropagation();
        document.body.style.cursor = "default";
      }}
    >
      {/* Cast Iron Legs (Ornate style simplified) */}
      <group position={[-0.9, 0, 0]}>
        {/* Front Leg */}
        <mesh castShadow position={[0, 0.2, 0.25]}>
          <boxGeometry args={[0.1, 0.4, 0.1]} />
          <meshStandardMaterial
            color={legColor}
            roughness={0.8}
            metalness={0.6}
          />
        </mesh>
        {/* Back Leg + Backrest Support */}
        <mesh castShadow position={[0, 0.45, -0.25]} rotation={[-0.2, 0, 0]}>
          <boxGeometry args={[0.1, 0.9, 0.1]} />
          <meshStandardMaterial
            color={legColor}
            roughness={0.8}
            metalness={0.6}
          />
        </mesh>
        {/* Base Connector */}
        <mesh castShadow position={[0, 0.1, 0]}>
          <boxGeometry args={[0.08, 0.1, 0.6]} />
          <meshStandardMaterial
            color={legColor}
            roughness={0.8}
            metalness={0.6}
          />
        </mesh>
      </group>

      <group position={[0.9, 0, 0]}>
        {/* Front Leg */}
        <mesh castShadow position={[0, 0.2, 0.25]}>
          <boxGeometry args={[0.1, 0.4, 0.1]} />
          <meshStandardMaterial
            color={legColor}
            roughness={0.8}
            metalness={0.6}
          />
        </mesh>
        {/* Back Leg + Backrest Support */}
        <mesh castShadow position={[0, 0.45, -0.25]} rotation={[-0.2, 0, 0]}>
          <boxGeometry args={[0.1, 0.9, 0.1]} />
          <meshStandardMaterial
            color={legColor}
            roughness={0.8}
            metalness={0.6}
          />
        </mesh>
        {/* Base Connector */}
        <mesh castShadow position={[0, 0.1, 0]}>
          <boxGeometry args={[0.08, 0.1, 0.6]} />
          <meshStandardMaterial
            color={legColor}
            roughness={0.8}
            metalness={0.6}
          />
        </mesh>
      </group>

      {/* Seat Slats */}
      {[0.2, 0.0, -0.2].map((z, i) => (
        <mesh
          key={`seat-${i}`}
          castShadow
          receiveShadow
          position={[0, 0.42, z]}
        >
          <boxGeometry args={[2.0, 0.05, 0.15]} />
          <WoodMaterial color={woodColor} roughness={0.8} />
        </mesh>
      ))}

      {/* Backrest Slats */}
      {[0.6, 0.8].map((y, i) => (
        <mesh
          key={`back-${i}`}
          castShadow
          receiveShadow
          position={[0, y, -0.32 + i * 0.05]}
          rotation={[-0.2, 0, 0]}
        >
          <boxGeometry args={[2.0, 0.15, 0.05]} />
          <WoodMaterial color={woodColor} roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

function OutdoorBenches({
  origin,
  padOffset,
  onRequestMove,
}: {
  origin: [number, number, number];
  padOffset: number;
  onRequestMove?: (
    dest: Vec3,
    opts?: { rotY?: number; sit?: boolean; sitDest?: Vec3; lookAtTarget?: Vec3 }
  ) => void;
}) {
  const [ox, oy, oz] = origin;

  const requestSitAt = useCallback(
    (seatX: number, seatZ: number) => {
      if (!onRequestMove) return;
      const dx = ox - seatX;
      const dz = oz - seatZ;
      const face = Math.atan2(dx, dz);

      // Calculate approach point (0.5m in front of the seat, towards the table)
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
        lookAtTarget: [ox, oy, oz],
      });
    },
    [onRequestMove, ox, oy, oz]
  );

  // Determine which bench to skip based on board position relative to center (0,0)
  // Top-Left board (ox < 0, oz < 0): Skip Bottom-Right bench (White Right)
  // Top-Right board (ox > 0, oz < 0): Skip Bottom-Left bench (White Left)
  // Bottom-Left board (ox < 0, oz > 0): Skip Top-Right bench (Black Right)
  // Bottom-Right board (ox > 0, oz > 0): Skip Top-Left bench (Black Left)
  const skipWhiteRight = ox < -1 && oz < -1;
  const skipWhiteLeft = ox > 1 && oz < -1;
  const skipBlackRight = ox < -1 && oz > 1;
  const skipBlackLeft = ox > 1 && oz > 1;

  return (
    <group>
      {/* Decorative benches */}
      {/* White side benches (facing board -> -Z) */}
      {(() => {
        if (skipWhiteLeft) return null;
        const x = ox - 3.5;
        const z = oz + padOffset + 1.5;
        return (
          <Bench
            position={[x, 0, z]}
            rotation={[0, Math.PI, 0]}
            onClick={() => requestSitAt(x, oz + padOffset + 1.35)}
          />
        );
      })()}
      {(() => {
        if (skipWhiteRight) return null;
        const x = ox + 3.5;
        const z = oz + padOffset + 1.5;
        return (
          <Bench
            position={[x, 0, z]}
            rotation={[0, Math.PI, 0]}
            onClick={() => requestSitAt(x, oz + padOffset + 1.35)}
          />
        );
      })()}

      {/* Black side benches (facing board -> +Z) */}
      {(() => {
        if (skipBlackLeft) return null;
        const x = ox - 3.5;
        const z = oz - padOffset - 1.5;
        return (
          <Bench
            position={[x, 0, z]}
            rotation={[0, 0, 0]}
            onClick={() => requestSitAt(x, oz - padOffset - 1.35)}
          />
        );
      })()}
      {(() => {
        if (skipBlackRight) return null;
        const x = ox + 3.5;
        const z = oz - padOffset - 1.5;
        return (
          <Bench
            position={[x, 0, z]}
            rotation={[0, 0, 0]}
            onClick={() => requestSitAt(x, oz - padOffset - 1.35)}
          />
        );
      })()}
    </group>
  );
}

export type OutdoorChessProps = {
  roomId: string;
  boardKey: string;
  origin: [number, number, number];
  selfPositionRef: RefObject<THREE.Vector3>;
  selfId: string;
  selfName?: string;
  puzzleRushNetState?: PuzzleRushNetState | null;
  claimPuzzleRushLeader?: (boardKey: string) => void;
  sendPuzzleRushState?: (state: PuzzleRushNetState) => void;
  onActivityMove?: (game: string, boardKey: string) => void;
  joinLockedBoardKey?: string | null;
  leaveAllNonce?: number;
  leaveAllExceptBoardKey?: string | null;
  onJoinIntent?: (boardKey: string) => void;
  onSelfSeatChange?: (boardKey: string, isSeated: boolean) => void;
  quickPlay?: { token: number; targetBoardKey: string | null } | null;
  onQuickPlayResult?: (
    token: number,
    boardKey: string,
    ok: boolean,
    reason?: string
  ) => void;
  onGameEnd?: (event: {
    boardKey: string;
    mode: BoardMode;
    resultLabel: string;
    didWin: boolean | null;
    hadOpponent?: boolean;
    resultSeq?: number;
    rematch: () => void;
    switchSides: () => void;
    leave: () => void;
  }) => void;
  onRequestMove?: (
    dest: Vec3,
    opts?: { rotY?: number; sit?: boolean; sitDest?: Vec3; lookAtTarget?: Vec3 }
  ) => void;
  onCenterCamera?: (target: Vec3) => void;
  onBoardControls?: (event: BoardControlsEvent) => void;
  controlsOpen?: boolean;
  board2dOpen?: boolean;
  chessTheme?: string;
  chessBoardTheme?: string;
  gameMode?: BoardMode;
  suppressCameraRotateRef?: React.MutableRefObject<boolean>;
};

function OutdoorChessChessMode({
  roomId,
  boardKey,
  origin,
  selfPositionRef,
  selfId,
  selfName,
  puzzleRushNetState,
  claimPuzzleRushLeader,
  sendPuzzleRushState,
  onActivityMove,
  joinLockedBoardKey,
  leaveAllNonce,
  leaveAllExceptBoardKey,
  onJoinIntent,
  onSelfSeatChange,
  quickPlay,
  onQuickPlayResult,
  onGameEnd,
  onRequestMove,
  onCenterCamera,
  onBoardControls,
  controlsOpen = false,
  board2dOpen = false,
  chessTheme,
  chessBoardTheme,
  gameMode = "chess",
  suppressCameraRotateRef,
}: OutdoorChessProps) {
  const isPuzzleRush = gameMode === "puzzleRush";
  const [showCoordinates, setShowCoordinates] = useState(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("chess-show-coordinates");
      return stored !== null ? stored === "true" : true;
    }
    return true;
  });

  // Listen for storage changes from the settings modal
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleStorageChange = () => {
      const stored = localStorage.getItem("chess-show-coordinates");
      setShowCoordinates(stored !== null ? stored === "true" : true);
    };

    // Custom event for same-window updates
    window.addEventListener("chess-coordinates-changed", handleStorageChange);
    // Storage event for cross-tab updates
    window.addEventListener("storage", handleStorageChange);

    return () => {
      window.removeEventListener(
        "chess-coordinates-changed",
        handleStorageChange
      );
      window.removeEventListener("storage", handleStorageChange);
    };
  }, []);

  const {
    playMove,
    playCapture,
    playSelect,
    playWarning,
    playClick,
    playHonk,
    playCorrect,
    playWrong,
  } = useChessSounds();
  const localArrows = useLocalArrows({
    enabled: true,
    suppressRightDragRef: suppressCameraRotateRef,
  });

  const chessGame = useChessGame({
    enabled: !isPuzzleRush,
    variant: chessVariantForMode(gameMode),
    roomId,
    boardKey,
    origin,
    selfPositionRef,
    selfId,
    selfName,
    onActivityMove: () =>
      onActivityMove?.(isGooseMode(gameMode) ? "goose" : "chess", boardKey),
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
    lobby: "park",
    sounds: {
      move: playMove,
      capture: playCapture,
      select: playSelect,
      warning: playWarning,
      click: playClick,
      honk: playHonk,
    },
  });

  const puzzleRush = usePuzzleRushGame({
    enabled: isPuzzleRush,
    roomId,
    boardKey,
    lobby: "park",
    selfConnId: selfId,
    netState: puzzleRushNetState ?? null,
    claimLeader: claimPuzzleRushLeader,
    publishState: sendPuzzleRushState,
    controlsOpen,
    board2dOpen,
    onBoardControls,
    sounds: {
      move: playMove,
      capture: playCapture,
      correct: playCorrect,
      wrong: playWrong,
    },
  });

  // Quick Play: if targeted, try to join an available seat (only on fresh games).
  const lastQuickPlayTokenRef = useRef<number>(-1);
  useEffect(() => {
    const token = quickPlay?.token ?? -1;
    const target = quickPlay?.targetBoardKey ?? null;
    if (token <= 0) return;
    if (!target || target !== boardKey) return;
    if (token === lastQuickPlayTokenRef.current) return;
    lastQuickPlayTokenRef.current = token;

    if (gameMode !== "chess") {
      onQuickPlayResult?.(token, boardKey, false, "not-chess");
      return;
    }

    const seats = chessGame.netState.seats;
    const wConnId = seats.w?.connId ?? null;
    const bConnId = seats.b?.connId ?? null;

    // Already seated -> treat as success.
    if (
      wConnId === chessGame.chessSelfId ||
      bConnId === chessGame.chessSelfId
    ) {
      onQuickPlayResult?.(token, boardKey, true);
      return;
    }

    // Avoid joining mid-game: treat a "fresh" game as no moves yet and clock not running.
    const isFresh =
      chessGame.netState.seq === 0 &&
      !chessGame.netState.lastMove &&
      !chessGame.netState.clock.running &&
      !chessGame.netState.result;

    const wTaken = !!wConnId;
    const bTaken = !!bConnId;
    const bothTaken = wTaken && bTaken;
    if (bothTaken) {
      onQuickPlayResult?.(token, boardKey, false, "full");
      return;
    }
    if (!isFresh) {
      onQuickPlayResult?.(token, boardKey, false, "in-progress");
      return;
    }

    const side: Side | null = !wTaken ? "w" : !bTaken ? "b" : null;
    if (!side) {
      onQuickPlayResult?.(token, boardKey, false, "full");
      return;
    }

    onJoinIntent?.(boardKey);
    chessGame.centerCamera();
    chessGame.clickJoin(side);
    onQuickPlayResult?.(token, boardKey, true);
  }, [
    quickPlay?.token,
    quickPlay?.targetBoardKey,
    boardKey,
    gameMode,
    chessGame.netState.seats,
    chessGame.netState.seq,
    chessGame.netState.lastMove,
    chessGame.netState.clock.running,
    chessGame.netState.result,
    chessGame.chessSelfId,
    chessGame.centerCamera,
    chessGame.clickJoin,
    onJoinIntent,
    onQuickPlayResult,
  ]);

  // Game end -> notify world so it can show rematch/switch UI.
  const lastReportedResultSeqRef = useRef<number>(-1);
  useEffect(() => {
    if (gameMode !== "chess" && gameMode !== "goose") return;
    const r = chessGame.netState.result;
    if (!r) return;
    if (chessGame.netState.seq === lastReportedResultSeqRef.current) return;
    lastReportedResultSeqRef.current = chessGame.netState.seq;
    if (!chessGame.resultLabel) return;

    const mySide = chessGame.myPrimarySide;
    const didWin =
      r.type === "draw" ? null : mySide ? r.winner === mySide : null;

    const seats = chessGame.netState.seats;
    const hadOpponent =
      !!seats.w?.connId &&
      !!seats.b?.connId &&
      seats.w.connId !== seats.b.connId;

    onGameEnd?.({
      boardKey,
      mode: gameMode,
      resultLabel: chessGame.resultLabel,
      didWin,
      hadOpponent,
      resultSeq: chessGame.netState.seq,
      rematch: () => chessGame.clickReset(),
      switchSides: () => {
        const s = chessGame.myPrimarySide;
        if (!s) return;
        const other: Side = s === "w" ? "b" : "w";
        chessGame.clickJoin(s);
        chessGame.clickJoin(other);
      },
      leave: () => {
        const s = chessGame.myPrimarySide;
        if (!s) return;
        chessGame.clickJoin(s);
      },
    });
  }, [
    gameMode,
    chessGame.netState.result,
    chessGame.netState.seq,
    chessGame.myPrimarySide,
    chessGame.resultLabel,
    chessGame.clickReset,
    chessGame.clickJoin,
    onGameEnd,
    boardKey,
  ]);

  const {
    originVec,
    squareSize,
    boardSize,
    netState,
    chessSelfId,
    turn,
    gooseSquare,
    goosePhase,
    startledSquares,
    mySides,
    myPrimarySide,
    isSeated,
    selected,
    legalTargets,
    hoveredSquare,
    setHoveredSquare,
    pulseGoosePlacementUntilMs,
    lastMove,
    pieces,
    animatedFromByTo,
    pendingJoinSide,
    clocks,
    emitControlsOpen,
    onPickSquare,
    onPickPiece,
    clickJoin,
    devModeEnabled,
    devJoinLog,
    resultLabel,
    gooseBlocked,
    drawOfferFrom,
    rematch,
  } = chessGame;

  const puzzlePieces = useMemo(() => {
    if (!isPuzzleRush) return null;
    return chessPiecesFromFen(puzzleRush.fen);
  }, [isPuzzleRush, puzzleRush.fen]);

  const activePieces = isPuzzleRush ? puzzlePieces ?? [] : pieces;
  const activeTurn = isPuzzleRush ? puzzleRush.turn : turn;
  const activeSelected = isPuzzleRush ? puzzleRush.selected : selected;
  const activeLegalTargets = isPuzzleRush
    ? puzzleRush.legalTargets
    : legalTargets;
  const activeLastMove = isPuzzleRush ? puzzleRush.lastMove : lastMove;
  const activeAnimatedFromByTo = isPuzzleRush
    ? puzzleRush.animatedFromByTo
    : animatedFromByTo;
  const activeSeq = isPuzzleRush ? puzzleRush.animSeq : netState.seq;

  const [devJoinModalOpen, setDevJoinModalOpen] = useState(false);
  const [devJoinModalSide, setDevJoinModalSide] = useState<Side | null>(null);
  const lastPendingJoinSideRef = useRef<Side | null>(null);
  useEffect(() => {
    if (!devModeEnabled) {
      setDevJoinModalOpen(false);
      setDevJoinModalSide(null);
      lastPendingJoinSideRef.current = pendingJoinSide;
      return;
    }

    const prev = lastPendingJoinSideRef.current;
    lastPendingJoinSideRef.current = pendingJoinSide;

    // Auto-open when a join starts.
    if (pendingJoinSide && pendingJoinSide !== prev) {
      setDevJoinModalOpen(true);
      setDevJoinModalSide(pendingJoinSide);
    }

    // Also open if we have fresh logs while joining.
    if (pendingJoinSide && devJoinLog.length > 0) {
      setDevJoinModalOpen(true);
    }
  }, [devModeEnabled, pendingJoinSide, devJoinLog.length]);

  const devClickJoin = useCallback(
    (side: Side) => {
      if (devModeEnabled) {
        setDevJoinModalSide(side);
        setDevJoinModalOpen(true);
      }
      clickJoin(side);
    },
    [devModeEnabled, clickJoin]
  );

  const lastMoveKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const lm = netState.lastMove as any;
    const key = lm ? `${lm.from}-${lm.to}` : null;
    if (key !== lastMoveKeyRef.current) {
      if (localArrows.arrows.length > 0) localArrows.clearArrows();
      lastMoveKeyRef.current = key;
    }
  }, [netState.lastMove, localArrows.arrows.length, localArrows.clearArrows]);

  const rematchRequestedBy: Side | null =
    netState.result && rematch && rematch.w !== rematch.b
      ? rematch.w
        ? "w"
        : "b"
      : null;
  const pendingRequestCount =
    (drawOfferFrom && !netState.result && goosePhase !== "goose" ? 1 : 0) +
    (rematchRequestedBy ? 1 : 0);

  const whiteTint = useMemo(() => {
    if (chessTheme === "chess_wood") return new THREE.Color("#e1c28b");
    return new THREE.Color("#e8e8e8");
  }, [chessTheme]);
  const blackTint = useMemo(() => {
    // For the wood set, the dark side should read warm/golden (not near-black).
    if (chessTheme === "chess_wood") return new THREE.Color("#8a6a1b");
    // Classic default should actually be dark.
    return new THREE.Color("#1c1c1c");
  }, [chessTheme]);

  const boardStyle = useMemo(() => {
    switch (chessBoardTheme) {
      case "board_walnut":
        return { kind: "wood" as const, light: "#c7a07a", dark: "#5a2d13" };
      case "board_marble":
        return { kind: "marble" as const, light: "#d9d9df", dark: "#3a3a44" };
      case "board_neon":
        // Darker, closer to preview.
        return { kind: "neon" as const, light: "#1f5561", dark: "#070a10" };
      default:
        return { kind: "wood" as const, light: "#deb887", dark: "#8b4513" };
    }
  }, [chessBoardTheme]);

  const seatOccupied = (
    seat?: { connId?: string | null; playerId?: string | null } | null
  ) => !!seat?.connId && !!seat?.playerId;
  const bothSeatsOccupied =
    seatOccupied(netState.seats.w) && seatOccupied(netState.seats.b);
  const canUseControlTV = isPuzzleRush ? true : isSeated || !bothSeatsOccupied;

  const controlsHintTimerRef = useRef<number | null>(null);
  const [controlsHintOpen, setControlsHintOpen] = useState(false);
  const showControlsHint = () => {
    setControlsHintOpen(true);
    if (controlsHintTimerRef.current !== null) {
      window.clearTimeout(controlsHintTimerRef.current);
    }
    controlsHintTimerRef.current = window.setTimeout(() => {
      setControlsHintOpen(false);
      controlsHintTimerRef.current = null;
    }, 2200);
  };
  useEffect(() => {
    return () => {
      if (controlsHintTimerRef.current !== null) {
        window.clearTimeout(controlsHintTimerRef.current);
      }
    };
  }, []);

  const [warningSquare, setWarningSquare] = useState<Square | null>(null);
  const [warningStartMs, setWarningStartMs] = useState(0);

  const padOffset = boardSize / 2 + 1.1;
  const padSize: [number, number] = [2.1, 0.7];
  const whitePadCenter = useMemo(
    () => new THREE.Vector3(originVec.x, 0.06, originVec.z + padOffset),
    [originVec, padOffset]
  );
  const blackPadCenter = useMemo(
    () => new THREE.Vector3(originVec.x, 0.06, originVec.z - padOffset),
    [originVec, padOffset]
  );
  const controlPadCenter = useMemo(
    () => new THREE.Vector3(originVec.x + padOffset, 0.06, originVec.z),
    [originVec, padOffset]
  );

  return (
    <group>
      {/* Result banner */}
      {resultLabel ? (
        <Text
          position={[originVec.x, originVec.y + 1.5, originVec.z]}
          fontSize={0.32}
          color="#ffffff"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.02}
          outlineColor="#000"
          fontWeight="bold"
        >
          {resultLabel}
        </Text>
      ) : null}

      {/* Decorative potted plants */}
      {[-1].map((side) => (
        <group
          key={`plant-${side}`}
          position={[originVec.x + side * 7, 0, originVec.z]}
        >
          {/* Pot (rim + body + soil) */}
          <mesh castShadow receiveShadow position={[0, 0.12, 0]}>
            <cylinderGeometry args={[0.34, 0.38, 0.26, 14]} />
            <meshStandardMaterial
              color="#6f3b22"
              roughness={0.85}
              metalness={0.02}
            />
          </mesh>
          <mesh castShadow receiveShadow position={[0, 0.26, 0]}>
            <cylinderGeometry args={[0.4, 0.4, 0.06, 14]} />
            <meshStandardMaterial color="#4c2414" roughness={0.9} />
          </mesh>
          <mesh receiveShadow position={[0, 0.285, 0]}>
            <cylinderGeometry args={[0.33, 0.33, 0.02, 14]} />
            <meshStandardMaterial color="#2a1b12" roughness={1} />
          </mesh>

          {/* Plant: leafy shrub (more organic than stacked cones) */}
          <group
            position={[0, 0.32, 0]}
            rotation={[0, side > 0 ? 0.35 : -0.25, 0]}
          >
            {/* Stem */}
            <mesh castShadow position={[0, 0.12, 0]}>
              <cylinderGeometry args={[0.03, 0.045, 0.26, 8]} />
              <meshStandardMaterial
                color="#2a1f17"
                roughness={1}
                metalness={0}
              />
            </mesh>

            {/* Leaf clumps - Procedural */}
            <group position={[0, 0.22, 0]}>
              <mesh castShadow scale={[1.25, 0.92, 1.2]}>
                <sphereGeometry args={[0.22, 12, 10]} />
                <PlantMaterial roughness={1} />
              </mesh>
              <mesh
                castShadow
                position={[0.16, -0.02, 0.1]}
                rotation={[0, 0.6, 0]}
                scale={[1.05, 0.8, 1.0]}
              >
                <sphereGeometry args={[0.18, 12, 10]} />
                <PlantMaterial roughness={1} />
              </mesh>
              <mesh
                castShadow
                position={[-0.15, -0.03, -0.12]}
                rotation={[0, -0.35, 0]}
                scale={[1.0, 0.78, 1.05]}
              >
                <sphereGeometry args={[0.17, 12, 10]} />
                <PlantMaterial roughness={1} />
              </mesh>
            </group>

            {/* Small flowers (subtle) */}
            {[-0.12, 0.0, 0.12].map((fx, i) => (
              <mesh key={i} position={[fx, 0.32, (i - 1) * 0.08]}>
                <sphereGeometry args={[0.03, 8, 8]} />
                <meshStandardMaterial
                  color={side > 0 ? "#ffd6e7" : "#fff1b8"}
                  roughness={0.7}
                />
              </mesh>
            ))}
          </group>
        </group>
      ))}

      {/* Board */}
      <group
        position={[originVec.x, originVec.y, originVec.z]}
        rotation={[0, isPuzzleRush && puzzleRush.turn === "b" ? Math.PI : 0, 0]}
      >
        {Array.from({ length: 64 }).map((_, idx) => {
          const file = idx % 8;
          const rankFromTop = Math.floor(idx / 8);
          const rank = 8 - rankFromTop;
          const square = `${FILES[file]!}${rank}` as const;

          const x = (file - 3.5) * squareSize;
          const z = (rankFromTop - 3.5) * squareSize;
          const isDark = (file + rankFromTop) % 2 === 1;

          const isTarget = activeLegalTargets.includes(square as any);
          const isSel = activeSelected === (square as any);
          const isLastMoveFrom = activeLastMove?.from === square;
          const isLastMoveTo = activeLastMove?.to === square;
          const pieceOnSquare = activePieces.find(
            (p) => p.square === (square as Square)
          );
          const isStartled =
            gameMode === "goose" &&
            !!pieceOnSquare &&
            goosePhase !== "goose" &&
            startledSquares.includes(square as Square);
          const canInteract = isPuzzleRush
            ? isTarget ||
              isSel ||
              (!!pieceOnSquare && activeTurn === pieceOnSquare.color)
            : isTarget ||
              (pieceOnSquare &&
                mySides.has(pieceOnSquare.color) &&
                activeTurn === pieceOnSquare.color);

          // Check if this is a valid goose placement square
          const isValidGoosePlacement =
            gameMode === "goose" &&
            goosePhase === "goose" &&
            !pieceOnSquare &&
            !(square === gooseSquare) &&
            !(
              Number(netState.fen.split(" ")[5] ?? "1") > 20 &&
              (square === "d4" ||
                square === "e4" ||
                square === "d5" ||
                square === "e5")
            );

          return (
            <group
              key={square}
              position={[x, 0, z]}
              onPointerDown={(e) => {
                if (e.button === 2) {
                  e.stopPropagation();
                  localArrows.onRightDownSquare(square as Square);
                  return;
                }
                if (e.button !== 0) return; // Left click only
                e.stopPropagation();
                if (isPuzzleRush) puzzleRush.onPickSquare(square as any);
                else onPickSquare(square as any);
              }}
              onContextMenu={(e) => {
                e.stopPropagation();
                e.nativeEvent?.preventDefault?.();
              }}
              onPointerEnter={() => {
                localArrows.onRightEnterSquare(square as Square);
                setHoveredSquare(square as Square);
                if (canInteract) document.body.style.cursor = "pointer";
              }}
              onPointerLeave={() => {
                setHoveredSquare(null);
                document.body.style.cursor = "default";
              }}
            >
              <mesh receiveShadow>
                <boxGeometry args={[squareSize, 0.08, squareSize]} />
                {boardStyle.kind === "wood" ? (
                  <WoodMaterial
                    color={isDark ? boardStyle.dark : boardStyle.light}
                    roughness={0.7}
                    metalness={0.1}
                  />
                ) : boardStyle.kind === "marble" ? (
                  <MarbleTileMaterial
                    color={isDark ? boardStyle.dark : boardStyle.light}
                  />
                ) : (
                  <NeonTileMaterial
                    color={isDark ? boardStyle.dark : boardStyle.light}
                  />
                )}
              </mesh>

              {/* Glow indicators (flush to board) */}
              {isSel && (
                <mesh
                  position={[0, SQUARE_TOP_Y + 0.001, 0]}
                  rotation={[-Math.PI / 2, 0, 0]}
                  renderOrder={3}
                >
                  <planeGeometry
                    args={[squareSize * 0.92, squareSize * 0.92]}
                  />
                  <meshBasicMaterial
                    color="#ffffff"
                    transparent
                    opacity={0.14}
                    blending={THREE.AdditiveBlending}
                    depthWrite={false}
                    polygonOffset
                    polygonOffsetFactor={-1}
                    polygonOffsetUnits={-1}
                  />
                </mesh>
              )}

              {isTarget && !isSel && (
                <mesh
                  position={[0, SQUARE_TOP_Y + 0.001, 0]}
                  rotation={[-Math.PI / 2, 0, 0]}
                  renderOrder={2}
                >
                  <planeGeometry args={[squareSize * 0.9, squareSize * 0.9]} />
                  <meshBasicMaterial
                    color="#ffffff"
                    transparent
                    opacity={0.09}
                    blending={THREE.AdditiveBlending}
                    depthWrite={false}
                    polygonOffset
                    polygonOffsetFactor={-1}
                    polygonOffsetUnits={-1}
                  />
                </mesh>
              )}

              {/* Startled square indicator (bluish overlay) */}
              {isStartled && (
                <group
                  position={[0, SQUARE_TOP_Y + 0.02, 0]}
                  rotation={[-Math.PI / 2, 0, 0]}
                  renderOrder={1}
                >
                  <mesh rotation={[0, 0, -Math.PI / 4]}>
                    <planeGeometry
                      args={[squareSize * 0.91, squareSize * 0.104]}
                    />
                    <SlowPulsingIndicatorMaterial
                      color="#4a9eff"
                      baseOpacity={0.22}
                    />
                  </mesh>
                  <mesh rotation={[0, 0, Math.PI / 4]}>
                    <planeGeometry
                      args={[squareSize * 0.91, squareSize * 0.104]}
                    />
                    <SlowPulsingIndicatorMaterial
                      color="#4a9eff"
                      baseOpacity={0.22}
                    />
                  </mesh>
                </group>
              )}

              {isLastMoveFrom && (
                <mesh
                  position={[0, SQUARE_TOP_Y + 0.001, 0]}
                  rotation={[-Math.PI / 2, 0, 0]}
                  renderOrder={1}
                >
                  <planeGeometry
                    args={[squareSize * 0.96, squareSize * 0.96]}
                  />
                  <meshBasicMaterial
                    color="#4a9eff"
                    transparent
                    opacity={0.18}
                    blending={THREE.AdditiveBlending}
                    depthWrite={false}
                    polygonOffset
                    polygonOffsetFactor={-1}
                    polygonOffsetUnits={-1}
                  />
                </mesh>
              )}

              {isLastMoveTo && (
                <mesh
                  position={[0, SQUARE_TOP_Y + 0.001, 0]}
                  rotation={[-Math.PI / 2, 0, 0]}
                  renderOrder={1}
                >
                  <planeGeometry
                    args={[squareSize * 0.96, squareSize * 0.96]}
                  />
                  <meshBasicMaterial
                    color="#ffa04a"
                    transparent
                    opacity={0.2}
                    blending={THREE.AdditiveBlending}
                    depthWrite={false}
                    polygonOffset
                    polygonOffsetFactor={-1}
                    polygonOffsetUnits={-1}
                  />
                </mesh>
              )}
            </group>
          );
        })}
      </group>

      {/* Local-only arrows (right-drag). */}
      {localArrows.arrows.map((a, idx) => (
        <LocalArrow3D
          key={`${a.from}-${a.to}-${idx}`}
          arrow={a}
          origin={originVec}
          squareSize={squareSize}
        />
      ))}

      {/* Dev Mode: join modal log */}
      {devModeEnabled && devJoinModalOpen ? (
        <Html position={[0, 0, 0]} center style={{ pointerEvents: "none" }}>
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0, 0, 0, 0.55)",
              zIndex: 100000,
              pointerEvents: "auto",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "18px",
            }}
            onClick={() => setDevJoinModalOpen(false)}
          >
            <div
              style={{
                width: "min(780px, 92vw)",
                maxHeight: "min(520px, 82vh)",
                background: "rgba(0, 0, 0, 0.92)",
                color: "white",
                borderRadius: "12px",
                padding: "14px",
                fontFamily: "monospace",
                boxSizing: "border-box",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                  marginBottom: "10px",
                }}
              >
                <div style={{ fontWeight: "bold" }}>
                  Dev Mode Join Log (joining{" "}
                  {devJoinModalSide
                    ? devJoinModalSide === "w"
                      ? "White"
                      : "Black"
                    : "?"}
                  )
                </div>
                <button
                  type="button"
                  style={{
                    background: "transparent",
                    color: "white",
                    border: "1px solid rgba(255,255,255,0.25)",
                    borderRadius: "8px",
                    padding: "6px 10px",
                    cursor: "pointer",
                  }}
                  onClick={() => setDevJoinModalOpen(false)}
                >
                  Close
                </button>
              </div>
              <div
                style={{
                  opacity: 0.75,
                  fontSize: "11px",
                  marginBottom: "10px",
                }}
              >
                Tip: This join flow is intentionally slowed down in dev mode.
              </div>
              <pre
                style={{
                  margin: 0,
                  whiteSpace: "pre-wrap",
                  overflow: "auto",
                  maxHeight: "min(400px, 62vh)",
                  padding: "10px",
                  borderRadius: "10px",
                  background: "rgba(255,255,255,0.06)",
                }}
              >
                {devJoinLog.length > 0
                  ? devJoinLog.join("\n")
                  : "(waiting for logs…)"}
              </pre>
            </div>
          </div>
        </Html>
      ) : null}

      {/* Join pads */}
      {!isPuzzleRush ? (
        <>
          <JoinPad
            label={`${formatClock(clocks.remaining.w)}\n${
              netState.seats.w
                ? netState.seats.w.name || "White"
                : pendingJoinSide === "w"
                ? "Joining…"
                : "Join White"
            }`}
            center={whitePadCenter}
            size={padSize}
            active={mySides.has("w")}
            disabled={
              (joinLockedBoardKey && joinLockedBoardKey !== boardKey) ||
              pendingJoinSide === "b" ||
              (!!netState.seats.w && netState.seats.w.connId !== chessSelfId)
            }
            onClick={() => devClickJoin("w")}
          />
          <JoinPad
            label={`${formatClock(clocks.remaining.b)}\n${
              netState.seats.b
                ? netState.seats.b.name || "Black"
                : pendingJoinSide === "b"
                ? "Joining…"
                : "Join Black"
            }`}
            center={blackPadCenter}
            size={padSize}
            active={mySides.has("b")}
            disabled={
              (joinLockedBoardKey && joinLockedBoardKey !== boardKey) ||
              pendingJoinSide === "w" ||
              (!!netState.seats.b && netState.seats.b.connId !== chessSelfId)
            }
            onClick={() => devClickJoin("b")}
          />
        </>
      ) : null}

      {/* Control TV */}
      <ControlTV
        center={controlPadCenter}
        active={controlsOpen}
        hintText={controlsHintOpen ? "Both seats occupied" : null}
        badgeCount={pendingRequestCount}
        onClick={() => {
          console.log("[ControlTV Chess] Click detected", {
            isSeated,
            bothSeatsOccupied,
            canUseControlTV,
            seats: {
              w: netState.seats.w,
              b: netState.seats.b,
            },
            controlsOpen,
          });
          if (!canUseControlTV) {
            console.log("[ControlTV Chess] Blocked: canUseControlTV is false");
            showControlsHint();
            return;
          }
          console.log("[ControlTV Chess] Allowed: proceeding");
          if (controlsOpen) {
            console.log("[ControlTV Chess] Closing controls");
            onBoardControls?.({ type: "close", boardKey });
            return;
          }
          console.log(
            "[ControlTV Chess] Opening controls via emitControlsOpen"
          );
          if (isPuzzleRush) puzzleRush.emitControlsOpen();
          else emitControlsOpen();
        }}
      />
      {/* Goose Chess visuals */}
      {gameMode === "goose"
        ? (() => {
            // Position goose off-board initially or during placement
            if (gooseSquare && lastMove && goosePhase !== "goose") {
              // On board at gooseSquare (only if a move has been played and not placing)
              const sq = gooseSquare;
              const file = sq.charCodeAt(0) - 97;
              const rank = Number(sq[1]);
              const rankFromTop = 8 - rank;
              const x = (file - 3.5) * squareSize;
              const z = (rankFromTop - 3.5) * squareSize;
              const y = originVec.y + SQUARE_TOP_Y;

              // Face the bottom of the board by default.
              let yaw = 0;
              let warningStartMs = 0;

              const nowMs = Date.now();
              const warningActive =
                !!gooseBlocked &&
                gooseBlocked.gooseSquare === sq &&
                nowMs - gooseBlocked.at < 950;

              if (warningActive) {
                const psq = gooseBlocked!.pieceSquare;
                const pFile = psq.charCodeAt(0) - 97;
                const pRank = Number(psq[1]);
                const pRankFromTop = 8 - pRank;
                const px = (pFile - 3.5) * squareSize;
                const pz = (pRankFromTop - 3.5) * squareSize;
                const dx = px - x;
                const dz = pz - z;
                yaw = Math.atan2(dx, dz);
                warningStartMs = gooseBlocked!.at;
              }

              return (
                <group key={`goose:${sq}`}>
                  <GooseModel
                    position={[originVec.x + x, y, originVec.z + z]}
                    rotation={[0, yaw, 0]}
                    scale={squareSize * 0.525}
                  />
                  {warningActive && warningStartMs > 0 && (
                    <GooseWarningText
                      position={[originVec.x + x, y, originVec.z + z]}
                      startMs={warningStartMs}
                    />
                  )}
                </group>
              );
            } else {
              // Off to the side near control TV (before first move or during placement)
              return (
                <GooseModel
                  key="goose-waiting"
                  position={[
                    originVec.x + boardSize / 2 + 1.2,
                    originVec.y + 0.15,
                    originVec.z + 0.6,
                  ]}
                  rotation={[0, -Math.PI / 3, 0]}
                  scale={squareSize * 0.525}
                />
              );
            }
          })()
        : null}

      {/* Holographic "Place Goose" text during placement phase */}
      {gameMode === "goose" && goosePhase === "goose" && (
        <HolographicPlacementText
          originVec={originVec}
          boardSize={boardSize}
          squareSize={squareSize}
        />
      )}

      {drawOfferFrom && !netState.result && goosePhase !== "goose" ? (
        <HolographicDrawOfferText
          originVec={originVec}
          boardSize={boardSize}
          offeredBy={drawOfferFrom}
        />
      ) : null}

      {rematchRequestedBy ? (
        <HolographicRematchRequestText
          originVec={originVec}
          boardSize={boardSize}
          requestedBy={rematchRequestedBy}
        />
      ) : null}

      {isPuzzleRush ? (
        <HolographicPuzzleRushHud
          originVec={originVec}
          boardSize={boardSize}
          label={`PUZZLE RUSH\nSCORE: ${puzzleRush.score}\nTIME: ${formatClock(
            puzzleRush.remainingMs
          )}`}
        />
      ) : null}

      {/* Startled squares handled by shader effect on pieces */}

      {/* Coordinate labels */}
      <CoordinateLabels
        originVec={originVec}
        squareSize={squareSize}
        boardSize={boardSize}
        showCoordinates={showCoordinates}
        boardTheme={chessBoardTheme}
      />

      {/* Pieces */}
      {activePieces.map((p) => {
        const isMyPiece = mySides.has(p.color);
        const canMove = isPuzzleRush
          ? activeTurn === p.color
          : activeTurn === p.color && isMyPiece;
        const animateFrom = activeAnimatedFromByTo.get(p.square) ?? null;
        const isStartled =
          gameMode === "goose" && startledSquares.includes(p.square);

        // Keep key stable for the duration of a move animation.
        const animKey = animateFrom
          ? `anim:${activeSeq}:${p.color}:${p.type}:${animateFrom}->${p.square}`
          : `static:${p.color}:${p.type}:${p.square}`;

        return (
          <group key={animKey}>
            <AnimatedPiece
              square={p.square}
              type={p.type}
              color={p.color}
              originVec={originVec}
              squareSize={squareSize}
              animateFrom={animateFrom}
              animSeq={activeSeq}
              canMove={canMove}
              mySide={isPuzzleRush ? activeTurn : myPrimarySide}
              onPickPiece={(sq) => {
                if (isPuzzleRush) {
                  puzzleRush.onPickSquare(sq);
                  return;
                }
                onPickPiece(sq);
              }}
              whiteTint={whiteTint}
              blackTint={blackTint}
              chessTheme={chessTheme}
              isStartled={isStartled}
            />
          </group>
        );
      })}
    </group>
  );
}

function OutdoorChessCheckersMode({
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
  controlsOpen = false,
  board2dOpen = false,
  chessTheme,
  chessBoardTheme,
  suppressCameraRotateRef,
}: OutdoorChessProps) {
  const [showCoordinates, setShowCoordinates] = useState(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("chess-show-coordinates");
      return stored !== null ? stored === "true" : true;
    }
    return true;
  });

  // Listen for storage changes from the settings modal
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleStorageChange = () => {
      const stored = localStorage.getItem("chess-show-coordinates");
      setShowCoordinates(stored !== null ? stored === "true" : true);
    };

    // Custom event for same-window updates
    window.addEventListener("chess-coordinates-changed", handleStorageChange);
    // Storage event for cross-tab updates
    window.addEventListener("storage", handleStorageChange);

    return () => {
      window.removeEventListener(
        "chess-coordinates-changed",
        handleStorageChange
      );
      window.removeEventListener("storage", handleStorageChange);
    };
  }, []);

  const { playMove, playCapture, playSelect, playWarning, playClick } =
    useChessSounds();

  const checkersGame = useCheckersGame({
    enabled: true,
    roomId,
    boardKey,
    origin,
    selfPositionRef,
    selfId,
    selfName,
    onActivityMove: () => onActivityMove?.("checkers", boardKey),
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
    lobby: "park",
    sounds: {
      move: playMove,
      capture: playCapture,
      select: playSelect,
      warning: playWarning,
      click: playClick,
    },
  });

  const {
    originVec,
    squareSize,
    boardSize,
    netState,
    turn,
    mySides,
    isSeated,
    selected,
    legalTargets,
    pulseTargetsUntilMs,
    lastMove,
    pieces,
    pendingJoinSide,
    clocks,
    emitControlsOpen,
    onPickSquare,
    onPickPiece,
    clickJoin,
    resultLabel,
  } = checkersGame;

  const whiteTint = useMemo(() => {
    if (chessTheme === "chess_wood") return new THREE.Color("#e1c28b");
    return new THREE.Color("#e8e8e8");
  }, [chessTheme]);
  const blackTint = useMemo(() => {
    if (chessTheme === "chess_wood") return new THREE.Color("#8a6a1b");
    return new THREE.Color("#1c1c1c");
  }, [chessTheme]);

  const boardStyle = useMemo(() => {
    switch (chessBoardTheme) {
      case "board_walnut":
        return { kind: "wood" as const, light: "#c7a07a", dark: "#5a2d13" };
      case "board_marble":
        return { kind: "marble" as const, light: "#d9d9df", dark: "#3a3a44" };
      case "board_neon":
        return { kind: "neon" as const, light: "#1f5561", dark: "#070a10" };
      default:
        return { kind: "wood" as const, light: "#deb887", dark: "#8b4513" };
    }
  }, [chessBoardTheme]);

  const padOffset = boardSize / 2 + 1.1;
  const padSize: [number, number] = [2.1, 0.7];
  const whitePadCenter = useMemo(
    () => new THREE.Vector3(originVec.x, 0.06, originVec.z + padOffset),
    [originVec, padOffset]
  );
  const blackPadCenter = useMemo(
    () => new THREE.Vector3(originVec.x, 0.06, originVec.z - padOffset),
    [originVec, padOffset]
  );
  const controlPadCenter = useMemo(
    () => new THREE.Vector3(originVec.x + padOffset, 0.06, originVec.z),
    [originVec, padOffset]
  );

  const localArrows = useLocalArrows({
    enabled: true,
    suppressRightDragRef: suppressCameraRotateRef,
  });

  const lastMoveKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const lm = netState.lastMove as any;
    const key = lm ? `${lm.from}-${lm.to}` : null;
    if (key !== lastMoveKeyRef.current) {
      if (localArrows.arrows.length > 0) localArrows.clearArrows();
      lastMoveKeyRef.current = key;
    }
  }, [netState.lastMove, localArrows.arrows.length, localArrows.clearArrows]);

  const controlsHintTimerRef = useRef<number | null>(null);
  const [controlsHintOpen, setControlsHintOpen] = useState(false);

  const showControlsHint = () => {
    setControlsHintOpen(true);
    if (controlsHintTimerRef.current !== null) {
      window.clearTimeout(controlsHintTimerRef.current);
    }
    controlsHintTimerRef.current = window.setTimeout(() => {
      setControlsHintOpen(false);
      controlsHintTimerRef.current = null;
    }, 2200);
  };

  useEffect(() => {
    return () => {
      if (controlsHintTimerRef.current !== null) {
        window.clearTimeout(controlsHintTimerRef.current);
      }
    };
  }, []);

  return (
    <group>
      {/* Result banner */}
      {resultLabel ? (
        <Text
          position={[originVec.x, originVec.y + 1.5, originVec.z]}
          fontSize={0.32}
          color="#ffffff"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.02}
          outlineColor="#000"
          fontWeight="bold"
        >
          {resultLabel}
        </Text>
      ) : null}

      {/* Board */}
      <group position={[originVec.x, originVec.y, originVec.z]}>
        {Array.from({ length: 64 }).map((_, idx) => {
          const file = idx % 8;
          const rankFromTop = Math.floor(idx / 8);
          const rank = 8 - rankFromTop;
          const square = `${FILES[file]!}${rank}` as const;

          const x = (file - 3.5) * squareSize;
          const z = (rankFromTop - 3.5) * squareSize;
          const isDark = (file + rankFromTop) % 2 === 1;

          const isTarget = legalTargets.includes(square as any);
          const isSel = (selected as any) === square;
          const isLastMoveFrom = (lastMove as any)?.from === square;
          const isLastMoveTo = (lastMove as any)?.to === square;

          const pieceOnSquare = pieces.find((p) => p.square === square);
          const canInteract =
            isTarget ||
            (pieceOnSquare &&
              mySides.has(pieceOnSquare.color) &&
              turn === pieceOnSquare.color &&
              (!netState.forcedFrom || netState.forcedFrom === square));

          return (
            <group
              key={square}
              position={[x, 0, z]}
              onPointerDown={(e) => {
                if (e.button === 2) {
                  e.stopPropagation();
                  localArrows.onRightDownSquare(square as Square);
                  return;
                }
                if (e.button !== 0) return; // Left click only
                e.stopPropagation();
                onPickSquare(square as any);
              }}
              onContextMenu={(e) => {
                e.stopPropagation();
                e.nativeEvent?.preventDefault?.();
              }}
              onPointerEnter={() => {
                localArrows.onRightEnterSquare(square as Square);
                if (canInteract) document.body.style.cursor = "pointer";
              }}
              onPointerLeave={() => {
                document.body.style.cursor = "default";
              }}
            >
              <mesh receiveShadow>
                <boxGeometry args={[squareSize, 0.08, squareSize]} />
                {boardStyle.kind === "wood" ? (
                  <WoodMaterial
                    color={isDark ? boardStyle.dark : boardStyle.light}
                    roughness={0.7}
                    metalness={0.1}
                  />
                ) : boardStyle.kind === "marble" ? (
                  <MarbleTileMaterial
                    color={isDark ? boardStyle.dark : boardStyle.light}
                  />
                ) : (
                  <NeonTileMaterial
                    color={isDark ? boardStyle.dark : boardStyle.light}
                  />
                )}
              </mesh>

              {isSel && (
                <mesh
                  position={[0, SQUARE_TOP_Y + 0.001, 0]}
                  rotation={[-Math.PI / 2, 0, 0]}
                  renderOrder={3}
                >
                  <planeGeometry
                    args={[squareSize * 0.92, squareSize * 0.92]}
                  />
                  <meshBasicMaterial
                    color="#ffffff"
                    transparent
                    opacity={0.14}
                    blending={THREE.AdditiveBlending}
                    depthWrite={false}
                    polygonOffset
                    polygonOffsetFactor={-1}
                    polygonOffsetUnits={-1}
                  />
                </mesh>
              )}

              {isTarget && !isSel && (
                <mesh
                  position={[0, SQUARE_TOP_Y + 0.001, 0]}
                  rotation={[-Math.PI / 2, 0, 0]}
                  renderOrder={2}
                >
                  <planeGeometry args={[squareSize * 0.9, squareSize * 0.9]} />
                  <PulsingIndicatorMaterial
                    color="#ffffff"
                    baseOpacity={0.09}
                    pulsingUntilMs={
                      netState.forcedFrom ? pulseTargetsUntilMs : 0
                    }
                  />
                </mesh>
              )}

              {isLastMoveFrom && (
                <mesh
                  position={[0, SQUARE_TOP_Y + 0.001, 0]}
                  rotation={[-Math.PI / 2, 0, 0]}
                  renderOrder={1}
                >
                  <planeGeometry
                    args={[squareSize * 0.96, squareSize * 0.96]}
                  />
                  <meshBasicMaterial
                    color="#4a9eff"
                    transparent
                    opacity={0.18}
                    blending={THREE.AdditiveBlending}
                    depthWrite={false}
                    polygonOffset
                    polygonOffsetFactor={-1}
                    polygonOffsetUnits={-1}
                  />
                </mesh>
              )}

              {isLastMoveTo && (
                <mesh
                  position={[0, SQUARE_TOP_Y + 0.001, 0]}
                  rotation={[-Math.PI / 2, 0, 0]}
                  renderOrder={1}
                >
                  <planeGeometry
                    args={[squareSize * 0.96, squareSize * 0.96]}
                  />
                  <meshBasicMaterial
                    color="#ffa04a"
                    transparent
                    opacity={0.2}
                    blending={THREE.AdditiveBlending}
                    depthWrite={false}
                    polygonOffset
                    polygonOffsetFactor={-1}
                    polygonOffsetUnits={-1}
                  />
                </mesh>
              )}
            </group>
          );
        })}
      </group>

      {/* Local-only arrows (right-drag). */}
      {localArrows.arrows.map((a, idx) => (
        <LocalArrow3D
          key={`${a.from}-${a.to}-${idx}`}
          arrow={a}
          origin={originVec}
          squareSize={squareSize}
        />
      ))}

      {/* Join pads */}
      <JoinPad
        label={`${formatClock(clocks.remaining.w)}\n${
          netState.seats.w
            ? netState.seats.w.name || "White"
            : pendingJoinSide === "w"
            ? "Joining…"
            : "Join White"
        }`}
        center={whitePadCenter}
        size={padSize}
        active={mySides.has("w")}
        disabled={
          (joinLockedBoardKey && joinLockedBoardKey !== boardKey) ||
          pendingJoinSide === "b" ||
          (!!netState.seats.w &&
            netState.seats.w.connId !== checkersGame.gameSelfId)
        }
        onClick={() => clickJoin("w")}
      />
      <JoinPad
        label={`${formatClock(clocks.remaining.b)}\n${
          netState.seats.b
            ? netState.seats.b.name || "Black"
            : pendingJoinSide === "b"
            ? "Joining…"
            : "Join Black"
        }`}
        center={blackPadCenter}
        size={padSize}
        active={mySides.has("b")}
        disabled={
          (joinLockedBoardKey && joinLockedBoardKey !== boardKey) ||
          pendingJoinSide === "w" ||
          (!!netState.seats.b &&
            netState.seats.b.connId !== checkersGame.gameSelfId)
        }
        onClick={() => clickJoin("b")}
      />

      {/* Control TV */}
      <ControlTV
        center={controlPadCenter}
        active={controlsOpen}
        hintText={controlsHintOpen ? "Both seats occupied" : null}
        onClick={() => {
          const seatOccupied = (
            seat?: { connId?: string | null; playerId?: string | null } | null
          ) => !!seat?.connId && !!seat?.playerId;
          const bothSeatsOccupied =
            seatOccupied(netState.seats.w) && seatOccupied(netState.seats.b);
          const canUseControlTV = isSeated || !bothSeatsOccupied;
          console.log("[ControlTV Checkers] Click detected", {
            isSeated,
            bothSeatsOccupied,
            canUseControlTV,
            seats: {
              w: netState.seats.w,
              b: netState.seats.b,
            },
            controlsOpen,
          });
          if (!canUseControlTV) {
            console.log(
              "[ControlTV Checkers] Blocked: canUseControlTV is false"
            );
            showControlsHint();
            return;
          }
          console.log("[ControlTV Checkers] Allowed: proceeding");
          if (controlsOpen) {
            console.log("[ControlTV Checkers] Closing controls");
            onBoardControls?.({ type: "close", boardKey });
            return;
          }
          console.log(
            "[ControlTV Checkers] Opening controls via emitControlsOpen"
          );
          emitControlsOpen();
        }}
      />

      {/* Coordinate labels */}
      <CoordinateLabels
        originVec={originVec}
        squareSize={squareSize}
        boardSize={boardSize}
        showCoordinates={showCoordinates}
        boardTheme={chessBoardTheme}
      />

      {/* Pieces */}
      {pieces.map((p) => {
        const file = p.square.charCodeAt(0) - 97;
        const rank = Number(p.square[1]);
        const rankFromTop = 8 - rank;
        const x = (file - 3.5) * squareSize;
        const z = (rankFromTop - 3.5) * squareSize;

        const tint = p.color === "w" ? whiteTint : blackTint;
        const isMyPiece = mySides.has(p.color);
        const canMove = turn === p.color && isMyPiece;

        const y = originVec.y + SQUARE_TOP_Y;
        return (
          <CheckerPiece
            key={`${p.color}:${p.king ? "k" : "m"}:${p.square}`}
            position={[originVec.x + x, y, originVec.z + z]}
            tint={tint}
            side={p.color}
            chessTheme={chessTheme}
            king={p.king}
            canMove={canMove}
            onPick={() => onPickPiece(p.square as any)}
          />
        );
      })}
    </group>
  );
}

function CoordinateLabels({
  originVec,
  squareSize,
  boardSize,
  showCoordinates,
  boardTheme,
}: {
  originVec: THREE.Vector3;
  squareSize: number;
  boardSize: number;
  showCoordinates: boolean;
  boardTheme?: string;
}) {
  if (!showCoordinates) return null;

  const files = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const ranks = ["1", "2", "3", "4", "5", "6", "7", "8"];
  const borderWidth = 0.35;
  const borderHeight = 0.12;
  const borderExtend = boardSize / 2 + borderWidth / 2;
  const borderY = originVec.y - 0.09;
  const textY = originVec.y + 0.02;
  const textOffset = 0.25;

  // Material props based on board theme
  const isMarble = boardTheme === "board_marble";
  const isNeon = boardTheme === "board_neon";
  const isWalnut = boardTheme === "board_walnut";
  const isWood = !isMarble && !isNeon;

  // Border colors based on theme
  const borderColor = isMarble
    ? "#2b2b33"
    : isNeon
    ? "#07101c"
    : isWalnut
    ? "#5a3a1a"
    : "#6b4423";

  return (
    <group>
      {/* Border frame */}
      {/* Bottom border */}
      <mesh
        position={[originVec.x, borderY, originVec.z + borderExtend]}
        receiveShadow
        castShadow
      >
        <boxGeometry
          args={[boardSize + borderWidth * 2, borderHeight, borderWidth]}
        />
        {isMarble ? (
          <MarbleTileMaterial color={borderColor} />
        ) : isNeon ? (
          <NeonTileMaterial color={borderColor} />
        ) : (
          <WoodMaterial color={borderColor} roughness={0.7} metalness={0.15} />
        )}
      </mesh>

      {/* Top border */}
      <mesh
        position={[originVec.x, borderY, originVec.z - borderExtend]}
        receiveShadow
        castShadow
      >
        <boxGeometry
          args={[boardSize + borderWidth * 2, borderHeight, borderWidth]}
        />
        {isMarble ? (
          <MarbleTileMaterial color={borderColor} />
        ) : isNeon ? (
          <NeonTileMaterial color={borderColor} />
        ) : (
          <WoodMaterial color={borderColor} roughness={0.7} metalness={0.15} />
        )}
      </mesh>

      {/* Left border */}
      <mesh
        position={[originVec.x - borderExtend, borderY, originVec.z]}
        receiveShadow
        castShadow
      >
        <boxGeometry args={[borderWidth, borderHeight, boardSize]} />
        {isMarble ? (
          <MarbleTileMaterial color={borderColor} />
        ) : isNeon ? (
          <NeonTileMaterial color={borderColor} />
        ) : (
          <WoodMaterial color={borderColor} roughness={0.7} metalness={0.15} />
        )}
      </mesh>

      {/* Right border */}
      <mesh
        position={[originVec.x + borderExtend, borderY, originVec.z]}
        receiveShadow
        castShadow
      >
        <boxGeometry args={[borderWidth, borderHeight, boardSize]} />
        {isMarble ? (
          <MarbleTileMaterial color={borderColor} />
        ) : isNeon ? (
          <NeonTileMaterial color={borderColor} />
        ) : (
          <WoodMaterial color={borderColor} roughness={0.7} metalness={0.15} />
        )}
      </mesh>

      {/* File labels (a-h) at bottom */}
      {files.map((file, idx) => {
        const x = (idx - 3.5) * squareSize;
        return (
          <Text
            key={`file-${file}`}
            position={[originVec.x + x, textY, originVec.z + borderExtend]}
            rotation={[-Math.PI / 2, 0, 0]}
            fontSize={0.18}
            color={isNeon ? "#00d9ff" : "#e8d5c0"}
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.015}
            outlineColor="#000000"
          >
            {file}
          </Text>
        );
      })}

      {/* Rank labels (1-8) on left side */}
      {ranks.map((rank, idx) => {
        const z = (7 - idx - 3.5) * squareSize;
        return (
          <Text
            key={`rank-${rank}`}
            position={[originVec.x - borderExtend, textY, originVec.z + z]}
            rotation={[-Math.PI / 2, 0, 0]}
            fontSize={0.18}
            color={isNeon ? "#00d9ff" : "#e8d5c0"}
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.015}
            outlineColor="#000000"
          >
            {rank}
          </Text>
        );
      })}
    </group>
  );
}

function GooseModel({
  position,
  rotation,
  scale,
}: {
  position: [number, number, number];
  rotation?: [number, number, number];
  scale: number;
}) {
  const { scene } = useGLTF("/models/goose.glb");
  const gooseRef = useRef<THREE.Group>(null);
  const idleRef = useRef<THREE.Group>(null);
  const seed = useMemo(() => Math.random() * 1000, []);
  const baseYRef = useRef(position[1]);

  useEffect(() => {
    baseYRef.current = position[1];
  }, [position[1]]);

  // Clone the scene to avoid sharing geometry between instances
  const clonedScene = useMemo(() => scene.clone(), [scene]);

  useEffect(() => {
    if (gooseRef.current) {
      gooseRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
    }
  }, []);

  useFrame(({ clock }) => {
    const g = idleRef.current;
    if (!g) return;
    const t = clock.getElapsedTime() + seed;

    // Cute idle: gentle bob + tiny sway/tilt. (No yaw so facing stays stable.)
    g.position.y = Math.sin(t * 1.3) * 0.035;
    g.rotation.x = Math.sin(t * 1.9) * 0.06;
    g.rotation.z = Math.sin(t * 1.6) * 0.05;
  });

  return (
    <group
      ref={gooseRef}
      position={[position[0], baseYRef.current, position[2]]}
      rotation={rotation}
      scale={[scale, scale, scale]}
    >
      <group ref={idleRef}>
        <primitive object={clonedScene} />
      </group>
    </group>
  );
}

export function OutdoorChess(props: OutdoorChessProps) {
  const squareSize = 0.6;
  const boardSize = squareSize * 8;
  const padOffset = boardSize / 2 + 1.1;
  const engine = engineForMode(props.gameMode ?? "chess");

  return (
    <group userData={{ blocksClickToMove: true }}>
      <OutdoorBenches
        origin={props.origin}
        padOffset={padOffset}
        onRequestMove={props.onRequestMove}
      />
      {engine === "checkers" ? (
        <OutdoorChessCheckersMode {...props} />
      ) : (
        <OutdoorChessChessMode {...props} />
      )}
    </group>
  );
}

useGLTF.preload("/models/pawn.glb");
useGLTF.preload("/models/knight.glb");
useGLTF.preload("/models/bishop.glb");
useGLTF.preload("/models/rook.glb");
useGLTF.preload("/models/queen.glb");
useGLTF.preload("/models/king.glb");
useGLTF.preload("/models/checker.glb");
