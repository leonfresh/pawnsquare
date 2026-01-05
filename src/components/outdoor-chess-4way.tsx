"use client";

import { RoundedBox, Text } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { Vec3 } from "@/lib/partyRoom";
import { formatClock } from "./chess-core";
import {
  Chess4Piece,
  isSquare4,
  squareCenter4,
  useChess4WayGame,
  type UseChess4WayGameOptions,
  type Color4,
  type TeamArrow4,
} from "./chess4way-core";

function TeamArrow({
  arrow,
  origin,
  squareSize,
  color,
}: {
  arrow: TeamArrow4;
  origin: THREE.Vector3;
  squareSize: number;
  color: string;
}) {
  const { start, end, dir, len } = useMemo(() => {
    const start = squareCenter4(arrow.from, origin, squareSize).add(
      new THREE.Vector3(0, 0.12, 0)
    );
    const end = squareCenter4(arrow.to, origin, squareSize).add(
      new THREE.Vector3(0, 0.12, 0)
    );
    const v = end.clone().sub(start);
    const len = v.length();
    const dir = len > 1e-6 ? v.clone().multiplyScalar(1 / len) : v;
    return { start, end, dir, len };
  }, [arrow.from, arrow.to, origin, squareSize]);

  if (len < 1e-3) return null;

  const shaftLen = Math.max(0.001, len - squareSize * 0.35);
  const headLen = Math.min(squareSize * 0.35, len * 0.45);
  const shaftMid = start.clone().add(dir.clone().multiplyScalar(shaftLen / 2));
  const headMid = start
    .clone()
    .add(dir.clone().multiplyScalar(shaftLen + headLen / 2));
  const quat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    dir.clone().normalize()
  );

  return (
    <group>
      <mesh
        position={[shaftMid.x, shaftMid.y, shaftMid.z]}
        quaternion={quat}
        renderOrder={4}
      >
        <cylinderGeometry args={[0.03, 0.03, shaftLen, 12]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.55}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <mesh
        position={[headMid.x, headMid.y, headMid.z]}
        quaternion={quat}
        renderOrder={4}
      >
        <coneGeometry args={[0.075, headLen, 14]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.75}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

function JoinPad({
  label,
  center,
  size,
  active,
  isTurn,
  disabled,
  onClick,
  tint,
  rotation = 0,
}: {
  label: string;
  center: THREE.Vector3;
  size: [number, number];
  active: boolean;
  isTurn: boolean;
  disabled?: boolean;
  onClick: () => void;
  tint: string;
  rotation?: number;
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
      rotation={[0, rotation, 0]}
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
          color={disabled ? "#4a4a4a" : active ? tint : "#8b7355"}
          roughness={0.6}
          metalness={active ? 0.35 : 0.1}
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
          color={disabled ? "#3a3a3a" : active ? "#ffffff" : "#a0826d"}
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
        color={disabled ? "#888" : "#111"}
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

      {isTurn && !disabled ? (
        <mesh
          position={[0, 0.246, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          renderOrder={5}
        >
          <ringGeometry
            args={[Math.min(w, d) * 0.36, Math.min(w, d) * 0.46, 48]}
          />
          <meshBasicMaterial
            color={tint}
            transparent
            opacity={0.85}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            polygonOffset
            polygonOffsetFactor={-2}
            polygonOffsetUnits={-2}
          />
        </mesh>
      ) : null}

      {active && (
        <pointLight
          position={[0, 0.5, 0]}
          color={tint}
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
  turnLabel,
  modeLabel,
}: {
  center: THREE.Vector3;
  active: boolean;
  onClick: () => void;
  turnLabel: string;
  modeLabel: string;
}) {
  const baseY = center.y;
  const standY = baseY + 0.6;

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
      <RoundedBox
        args={[1.25, 0.78, 0.1]}
        radius={0.08}
        smoothness={6}
        position={[0, 1.1, 0]}
      >
        <meshStandardMaterial
          color={active ? "#ffd700" : "#1b2a3a"}
          emissive={active ? "#ffd700" : "#0b1220"}
          emissiveIntensity={active ? 0.8 : 0.35}
          roughness={0.35}
          metalness={0.25}
        />
      </RoundedBox>
      <Text
        position={[0, 1.1, 0.06]}
        fontSize={0.12}
        color={active ? "#000" : "#e6f7ff"}
        anchorX="center"
        anchorY="middle"
        fontWeight="bold"
        lineHeight={1.05}
        maxWidth={1.15}
        textAlign="center"
      >
        {`Turn: ${turnLabel}\nMode: ${modeLabel}`}
      </Text>
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
    <group position={position} rotation={rotation}>
      <mesh
        castShadow
        receiveShadow
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
        <boxGeometry args={[1.35, 0.16, 0.45]} />
        <meshStandardMaterial
          color="#4a3324"
          roughness={0.8}
          metalness={0.05}
        />
      </mesh>
      <mesh position={[0, 0.22, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.35, 0.06, 0.5]} />
        <meshStandardMaterial
          color="#5a3d2b"
          roughness={0.75}
          metalness={0.06}
        />
      </mesh>
    </group>
  );
}

export type OutdoorChess4PProps = {
  roomId: string;
  boardKey: string;
  origin: [number, number, number];
  selfPositionRef: React.RefObject<THREE.Vector3>;
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
  onBoardControls?: UseChess4WayGameOptions["onBoardControls"];
  controlsOpen?: boolean;
  board2dOpen?: boolean;
  chessTheme?: string;
  suppressCameraRotateRef?: React.MutableRefObject<boolean>;
};

function colorTint(c: Color4): string {
  switch (c) {
    case "r":
      return "#ff3b3b";
    case "g":
      return "#37ff70";
    case "y":
      return "#ffe14a";
    case "b":
      return "#3aa0ff";
  }
}

function prettySeat(c: Color4) {
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
  chessTheme,
  suppressCameraRotateRef,
}: OutdoorChess4PProps) {
  const chessGame = useChess4WayGame({
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
    chessTheme,
    lobby: "park",
    connectRadius: 1000,
    arrowDragActiveExternalRef: suppressCameraRotateRef,
  });

  const {
    originVec,
    squareSize,
    boardSize,
    netState,
    chessSelfId,
    turn,
    myColors,
    isSeated,
    selected,
    legalTargets,
    teamArrows,
    pieces,
    pendingJoinSeat,
    clocks,
    emitControlsOpen,
    onPickSquare,
    onPickPiece,
    onRightDownSquare,
    onRightEnterSquare,
    requestSitAt,
    resultLabel,
    canMoveThisTurn,
  } = chessGame;

  const padOffset = boardSize / 2 + 1.15;
  const padSize: [number, number] = [2.35, 0.75];

  const padCenters = useMemo(() => {
    return {
      r: new THREE.Vector3(originVec.x, 0.06, originVec.z + padOffset),
      y: new THREE.Vector3(originVec.x, 0.06, originVec.z - padOffset),
      g: new THREE.Vector3(originVec.x + padOffset, 0.06, originVec.z),
      b: new THREE.Vector3(originVec.x - padOffset, 0.06, originVec.z),
      tv: new THREE.Vector3(
        originVec.x + padOffset + 2.4,
        0.06,
        originVec.z + 0.2
      ),
    };
  }, [originVec, padOffset]);

  const seatLabel = (seat: Color4) => {
    const info = netState.seats[seat];
    const clock = clocks.remaining[seat];
    const pretty = prettySeat(seat);

    if (info) return `${formatClock(clock)}\n${info.name || pretty}`;
    if (pendingJoinSeat === seat) return `${formatClock(clock)}\nJoining…`;
    return `${formatClock(clock)}\nJoin ${pretty}`;
  };

  const seatDisabled = (seat: Color4) => {
    if (joinLockedBoardKey && joinLockedBoardKey !== boardKey) return true;
    const info = netState.seats[seat];
    if (info && info.connId !== chessSelfId) return true;
    if (pendingJoinSeat && pendingJoinSeat !== seat) return true;
    return false;
  };

  const validSquares = useMemo(() => {
    const out: string[] = [];
    for (let f = 0; f < 14; f++) {
      for (let r = 0; r < 14; r++) {
        const sq = `${"abcdefghijklmn"[f]}${r + 1}`;
        if (sq && isSquare4(sq)) out.push(sq);
      }
    }
    return out;
  }, []);

  const boardStyle = useMemo(() => ({ light: "#deb887", dark: "#8b4513" }), []);

  const ffaScoreCornerPos = useMemo(() => {
    const inset = 5.5 * squareSize;
    return {
      tl: new THREE.Vector3(
        originVec.x - inset,
        originVec.y + 0.091,
        originVec.z + inset
      ),
      tr: new THREE.Vector3(
        originVec.x + inset,
        originVec.y + 0.091,
        originVec.z + inset
      ),
      br: new THREE.Vector3(
        originVec.x + inset,
        originVec.y + 0.091,
        originVec.z - inset
      ),
      bl: new THREE.Vector3(
        originVec.x - inset,
        originVec.y + 0.091,
        originVec.z - inset
      ),
    };
  }, [originVec.x, originVec.y, originVec.z, squareSize]);

  return (
    <group>
      {resultLabel ? (
        <Text
          position={[originVec.x, originVec.y + 1.6, originVec.z]}
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

      {/* Board squares (14x14 cross) */}
      <group position={[originVec.x, originVec.y, originVec.z]}>
        {validSquares.map((square) => {
          const p = squareCenter4(
            square,
            new THREE.Vector3(0, 0, 0),
            squareSize
          );
          const file = square.charCodeAt(0) - 97;
          const rank = Number(square.slice(1)) - 1;
          const isDark = (file + rank) % 2 === 1;

          const isTarget = legalTargets.includes(square);
          const isSel = selected === square;

          return (
            <group
              key={square}
              position={[p.x, 0, p.z]}
              onPointerDown={(e) => {
                if (e.button === 2) {
                  e.stopPropagation();
                  e.nativeEvent?.preventDefault?.();
                  onRightDownSquare(square);
                  return;
                }

                if (e.button !== 0) return;
                e.stopPropagation();
                onPickSquare(square);
              }}
              onContextMenu={(e) => {
                e.stopPropagation();
                e.nativeEvent?.preventDefault?.();
              }}
              onPointerEnter={() => {
                onRightEnterSquare(square);
                if (canMoveThisTurn && (isTarget || isSel))
                  document.body.style.cursor = "pointer";
              }}
              onPointerLeave={() => {
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

              {isSel ? (
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
              ) : null}

              {isTarget && !isSel ? (
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
              ) : null}
            </group>
          );
        })}
      </group>

      {/* Team arrows (Teams mode only, but harmless to render empty) */}
      {teamArrows.map((a, idx) => (
        <TeamArrow
          key={`${a.by}-${a.from}-${a.to}-${idx}`}
          arrow={a}
          origin={originVec}
          squareSize={squareSize}
          color={colorTint(a.by)}
        />
      ))}

      {/* Pieces */}
      {pieces.map((p) => (
        <Chess4Piece
          key={`${p.square}-${p.type}-${p.color}`}
          square={p.square}
          type={p.type}
          color={p.color}
          defeated={!!(netState.defeated && netState.defeated[p.color])}
          origin={originVec}
          squareSize={squareSize}
          // 4P defaults to simple colored pieces (no skins/textures).
          chessTheme={undefined}
          canMove={canMoveThisTurn}
          onPickPiece={onPickPiece}
        />
      ))}

      {/* Join pads */}
      {(["r", "g", "y", "b"] as const).map((seat) => {
        let rotation = 0;
        if (seat === "r") rotation = Math.PI; // north faces south
        else if (seat === "g") rotation = Math.PI / 2; // east faces west
        else if (seat === "b") rotation = -Math.PI / 2; // west faces east
        // yellow (south) faces north (0)

        return (
          <JoinPad
            key={seat}
            label={seatLabel(seat)}
            center={padCenters[seat]}
            size={padSize}
            active={netState.seats[seat]?.connId === chessSelfId}
            isTurn={!netState.result && netState.turn === seat}
            disabled={seatDisabled(seat)}
            onClick={() => chessGame.clickJoin(seat)}
            tint={colorTint(seat)}
            rotation={rotation}
          />
        );
      })}

      {/* Control TV */}
      <ControlTV
        center={padCenters.tv}
        active={controlsOpen}
        turnLabel={prettySeat(turn)}
        modeLabel={netState.variant.toUpperCase()}
        onClick={() => {
          if (controlsOpen) {
            onBoardControls?.({ type: "close", boardKey });
            return;
          }
          emitControlsOpen();
        }}
      />

      {/* In-world indicators (flat on the board) */}
      {!netState.result ? (
        <>
          {netState.variant === "ffa" ? (
            <>
              <Text
                position={[
                  ffaScoreCornerPos.tl.x,
                  ffaScoreCornerPos.tl.y,
                  ffaScoreCornerPos.tl.z,
                ]}
                rotation={[-Math.PI / 2, 0, 0]}
                fontSize={0.2}
                lineHeight={0.95}
                color={colorTint("r")}
                anchorX="center"
                anchorY="middle"
                outlineWidth={0.01}
                outlineColor="#000"
                fontWeight="bold"
                depthOffset={-2}
              >
                {`Red: ${netState.scores?.r ?? 0}`}
              </Text>

              <Text
                position={[
                  ffaScoreCornerPos.tr.x,
                  ffaScoreCornerPos.tr.y,
                  ffaScoreCornerPos.tr.z,
                ]}
                rotation={[-Math.PI / 2, 0, 0]}
                fontSize={0.2}
                lineHeight={0.95}
                color={colorTint("g")}
                anchorX="center"
                anchorY="middle"
                outlineWidth={0.01}
                outlineColor="#000"
                fontWeight="bold"
                depthOffset={-2}
              >
                {`Green: ${netState.scores?.g ?? 0}`}
              </Text>

              <Text
                position={[
                  ffaScoreCornerPos.br.x,
                  ffaScoreCornerPos.br.y,
                  ffaScoreCornerPos.br.z,
                ]}
                rotation={[-Math.PI / 2, 0, 0]}
                fontSize={0.2}
                lineHeight={0.95}
                color={colorTint("y")}
                anchorX="center"
                anchorY="middle"
                outlineWidth={0.01}
                outlineColor="#000"
                fontWeight="bold"
                depthOffset={-2}
              >
                {`Yellow: ${netState.scores?.y ?? 0}`}
              </Text>

              <Text
                position={[
                  ffaScoreCornerPos.bl.x,
                  ffaScoreCornerPos.bl.y,
                  ffaScoreCornerPos.bl.z,
                ]}
                rotation={[-Math.PI / 2, 0, 0]}
                fontSize={0.2}
                lineHeight={0.95}
                color={colorTint("b")}
                anchorX="center"
                anchorY="middle"
                outlineWidth={0.01}
                outlineColor="#000"
                fontWeight="bold"
                depthOffset={-2}
              >
                {`Blue: ${netState.scores?.b ?? 0}`}
              </Text>
            </>
          ) : null}
        </>
      ) : null}
    </group>
  );
}
