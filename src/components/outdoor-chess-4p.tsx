"use client";

import { RoundedBox, Text } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import type { RefObject } from "react";
import { Chess } from "chess.js";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { BoardMode, Vec3 } from "@/lib/partyRoom";
import {
  formatClock,
  isSquare,
  type BoardControlsEvent,
  type Square,
} from "./chess-core";
import { Chess4Piece, useChess4Game, type TeamSeat } from "./chess4-core";
import { useChessSounds } from "./chess-sounds";

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
  const handleClick = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
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
      <mesh receiveShadow castShadow onPointerDown={handleClick}>
        <boxGeometry args={[w, 0.3, d]} />
        <meshStandardMaterial
          color={disabled ? "#4a4a4a" : active ? "#d4af37" : "#8b7355"}
          roughness={0.6}
          metalness={active ? 0.3 : 0.1}
        />
      </mesh>
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
        outlineColor="#000000"
        fontWeight="bold"
        depthOffset={-1}
        onPointerDown={handleClick}
      >
        {label}
      </Text>
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

function ControlTV({
  center,
  active,
  onClick,
}: {
  center: THREE.Vector3;
  active: boolean;
  onClick: () => void;
}) {
  const baseY = center.y;
  const standY = baseY + 0.6;
  const screenY = baseY + 1.22;

  return (
    <group
      position={[center.x, center.y, center.z]}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        onClick();
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
      <mesh position={[0, 0.09, 0]} castShadow>
        <cylinderGeometry args={[0.26, 0.32, 0.18, 16]} />
        <meshStandardMaterial
          color="#2b1b12"
          roughness={0.65}
          metalness={0.15}
        />
      </mesh>
      <mesh position={[0, standY - baseY, 0]} castShadow>
        <cylinderGeometry args={[0.045, 0.065, 0.84, 12]} />
        <meshStandardMaterial color="#3a2a1f" roughness={0.7} metalness={0.1} />
      </mesh>
      <mesh position={[0, 1.03, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.12, 0.012, 10, 36]} />
        <meshBasicMaterial
          color={active ? "#7cffd8" : "#ffffff"}
          transparent
          opacity={active ? 0.28 : 0.16}
        />
      </mesh>
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
      </group>
    </group>
  );
}

function SimpleBench({
  position,
  rotation,
  onClick,
}: {
  position: [number, number, number];
  rotation: [number, number, number];
  onClick: () => void;
}) {
  return (
    <group
      position={position}
      rotation={rotation}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        onClick();
      }}
      onPointerEnter={() => {
        document.body.style.cursor = "pointer";
      }}
      onPointerLeave={() => {
        document.body.style.cursor = "default";
      }}
    >
      <mesh castShadow receiveShadow>
        <boxGeometry args={[2.2, 0.18, 0.55]} />
        <meshStandardMaterial color="#6b4a2f" roughness={0.85} />
      </mesh>
      <mesh castShadow receiveShadow position={[0, 0.25, 0]}>
        <boxGeometry args={[2.2, 0.06, 0.55]} />
        <meshStandardMaterial color="#7a5535" roughness={0.8} />
      </mesh>
      {[-0.95, 0.95].map((x) => (
        <mesh key={x} castShadow receiveShadow position={[x, -0.22, 0]}>
          <boxGeometry args={[0.12, 0.55, 0.12]} />
          <meshStandardMaterial color="#3a2a1f" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

export type OutdoorChess4PProps = {
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
  onBoardControls?: (event: BoardControlsEvent) => void;
  controlsOpen?: boolean;
  board2dOpen?: boolean;
  chessTheme?: string;
  // kept for signature parity
  gameMode?: BoardMode;
};

export function OutdoorChess4P({
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
  controlsOpen = false,
  board2dOpen = false,
  chessTheme,
}: OutdoorChess4PProps) {
  const chessGame = useChess4Game({
    enabled: true,
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
    chessTheme,
    lobby: "park",
    connectRadius: 14,
  });

  const {
    originVec,
    squareSize,
    boardSize,
    netState,
    chessSelfId,
    turn,
    mySides,
    isSeated,
    selected,
    legalTargets,
    hoveredSquare,
    setHoveredSquare,
    pieces,
    pendingJoinSeat,
    clocks,
    emitControlsOpen,
    onPickSquare,
    onPickPiece,
    requestSitAt,
    resultLabel,
  } = chessGame;

  const { playMove, playCapture } = useChessSounds();
  const prevFenForSoundRef = useRef(netState.fen);
  const lastSoundSeqRef = useRef(0);

  useEffect(() => {
    if (!isSeated) {
      prevFenForSoundRef.current = netState.fen;
      return;
    }
    if (netState.seq <= lastSoundSeqRef.current) return;
    lastSoundSeqRef.current = netState.seq;

    if (netState.lastMove) {
      try {
        const tempChess = new Chess(prevFenForSoundRef.current);
        const moveResult = tempChess.move({
          from: netState.lastMove.from,
          to: netState.lastMove.to,
          promotion: "q",
        });
        if (moveResult && (moveResult as any).captured) playCapture();
        else playMove();
      } catch {
        playMove();
      }
    }

    prevFenForSoundRef.current = netState.fen;
  }, [
    isSeated,
    netState.seq,
    netState.fen,
    netState.lastMove,
    playMove,
    playCapture,
  ]);
  const boardStyle = useMemo(() => ({ light: "#deb887", dark: "#8b4513" }), []);

  const canInteract = isSeated && !netState.result && mySides.has(turn);

  const padOffset = boardSize / 2 + 1.2;
  const padSize: [number, number] = [2.05, 0.7];

  const padCenters = useMemo(() => {
    return {
      w1: new THREE.Vector3(originVec.x, 0.06, originVec.z + padOffset),
      b1: new THREE.Vector3(originVec.x, 0.06, originVec.z - padOffset),
      w2: new THREE.Vector3(originVec.x + padOffset, 0.06, originVec.z),
      b2: new THREE.Vector3(originVec.x - padOffset, 0.06, originVec.z),
      tv: new THREE.Vector3(
        originVec.x + padOffset + 2.4,
        0.06,
        originVec.z + 0.2
      ),
    };
  }, [originVec, padOffset]);

  const seatLabel = (seat: TeamSeat) => {
    const info = netState.seats[seat];
    const side = seat.startsWith("w") ? "w" : "b";
    const pretty =
      seat === "w1"
        ? "White A"
        : seat === "w2"
        ? "White B"
        : seat === "b1"
        ? "Black A"
        : "Black B";
    const clock = side === "w" ? clocks.remaining.w : clocks.remaining.b;

    if (info) {
      return `${formatClock(clock)}\n${info.name || pretty}`;
    }
    if (pendingJoinSeat === seat) {
      return `${formatClock(clock)}\nJoining…`;
    }
    return `${formatClock(clock)}\nJoin ${pretty}`;
  };

  const seatDisabled = (seat: TeamSeat) => {
    if (joinLockedBoardKey && joinLockedBoardKey !== boardKey) return true;
    const info = netState.seats[seat];
    if (info && info.connId !== chessSelfId) return true;
    // prevent double-clicking another seat while join is pending
    if (pendingJoinSeat && pendingJoinSeat !== seat) return true;
    return false;
  };

  const [warningSquare, setWarningSquare] = useState<string | null>(null);

  return (
    <group userData={{ blocksClickToMove: true }}>
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

      {/* Board squares */}
      <group position={[originVec.x, originVec.y, originVec.z]}>
        {Array.from({ length: 64 }).map((_, idx) => {
          const file = idx % 8;
          const rankFromTop = Math.floor(idx / 8);
          const rank = 8 - rankFromTop;
          const sq = `${String.fromCharCode(97 + file)}${rank}`;
          if (!isSquare(sq)) return null;
          const square = sq as Square;

          const x = (file - 3.5) * squareSize;
          const z = (rankFromTop - 3.5) * squareSize;
          const isDark = (file + rankFromTop) % 2 === 1;

          const isTarget = legalTargets.includes(square);
          const isSel = selected === square;
          const canMoveHere = isTarget || isSel;

          return (
            <group
              key={square}
              position={[x, 0, z]}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                onPickSquare(square);
                setWarningSquare(null);
              }}
              onPointerEnter={() => {
                setHoveredSquare(square);
                if (canInteract && canMoveHere)
                  document.body.style.cursor = "pointer";
              }}
              onPointerLeave={() => {
                setHoveredSquare(null);
                document.body.style.cursor = "default";
              }}
            >
              <mesh receiveShadow>
                <boxGeometry args={[squareSize, 0.08, squareSize]} />
                <meshStandardMaterial
                  color={isDark ? boardStyle.dark : boardStyle.light}
                  roughness={0.75}
                  metalness={0.05}
                />
              </mesh>

              {isSel && (
                <mesh
                  position={[0, 0.081, 0]}
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
                  position={[0, 0.081, 0]}
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
            </group>
          );
        })}
      </group>

      {/* Pieces */}
      {pieces.map((p) => (
        <Chess4Piece
          key={`${p.square}-${p.type}-${p.color}`}
          square={p.square}
          type={p.type}
          color={p.color}
          origin={originVec}
          squareSize={squareSize}
          chessTheme={chessTheme}
          canMove={canInteract}
          onPickPiece={onPickPiece}
        />
      ))}

      {/* Join pads (4 seats) */}
      {(Object.keys(padCenters) as Array<keyof typeof padCenters>)
        .filter((k) => k !== "tv")
        .map((seatKey) => {
          const seat = seatKey as TeamSeat;
          const side: "w" | "b" = seat.startsWith("w") ? "w" : "b";
          return (
            <JoinPad
              key={seat}
              label={seatLabel(seat)}
              center={padCenters[seat]}
              size={padSize}
              active={
                mySides.has(side) &&
                netState.seats[seat]?.connId === chessSelfId
              }
              disabled={seatDisabled(seat)}
              onClick={() => chessGame.clickJoin(seat)}
            />
          );
        })}

      {/* Control TV */}
      <ControlTV
        center={padCenters.tv}
        active={controlsOpen}
        onClick={() => {
          if (controlsOpen) {
            onBoardControls?.({ type: "close", boardKey });
            return;
          }
          emitControlsOpen();
        }}
      />

      {/* Benches (one per side) */}
      <group>
        <SimpleBench
          position={[originVec.x, 0, originVec.z + padOffset + 1.55]}
          rotation={[0, Math.PI, 0]}
          onClick={() =>
            requestSitAt(originVec.x, originVec.z + padOffset + 1.4)
          }
        />
        <SimpleBench
          position={[originVec.x, 0, originVec.z - padOffset - 1.55]}
          rotation={[0, 0, 0]}
          onClick={() =>
            requestSitAt(originVec.x, originVec.z - padOffset - 1.4)
          }
        />
        <SimpleBench
          position={[originVec.x + padOffset + 1.55, 0, originVec.z]}
          rotation={[0, -Math.PI / 2, 0]}
          onClick={() =>
            requestSitAt(originVec.x + padOffset + 1.4, originVec.z)
          }
        />
        <SimpleBench
          position={[originVec.x - padOffset - 1.55, 0, originVec.z]}
          rotation={[0, Math.PI / 2, 0]}
          onClick={() =>
            requestSitAt(originVec.x - padOffset - 1.4, originVec.z)
          }
        />
      </group>

      {warningSquare ? (
        <Text
          position={[originVec.x, originVec.y + 1.2, originVec.z]}
          fontSize={0.22}
          color="#ff4444"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.01}
          outlineColor="#000"
        >
          {warningSquare}
        </Text>
      ) : null}
    </group>
  );
}
