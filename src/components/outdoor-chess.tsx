"use client";

import { Text, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { Chess, type Square } from "chess.js";
import PartySocket from "partysocket";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

type Side = "w" | "b";

type GameResult =
  | { type: "timeout"; winner: Side }
  | { type: "checkmate"; winner: Side }
  | { type: "draw"; reason: "stalemate" | "insufficient" | "threefold" | "fifty-move" | "draw" };

type ClockState = {
  baseMs: number;
  remainingMs: { w: number; b: number };
  running: boolean;
  active: Side;
  lastTickMs: number | null;
};

type ChessNetState = {
  seats: { w: string | null; b: string | null };
  fen: string;
  seq: number;
  clock: ClockState;
  result: GameResult | null;
};

type ChessMessage =
  | { type: "state"; state: ChessNetState };

type ChessSendMessage =
  | { type: "join"; side: Side }
  | { type: "leave"; side: Side }
  | { type: "move"; from: Square; to: Square; promotion?: "q" | "r" | "b" | "n" }
  | { type: "setTime"; baseSeconds: number }
  | { type: "reset" };

const TIME_OPTIONS_SECONDS = [60, 3 * 60, 5 * 60, 10 * 60, 15 * 60] as const;

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

const PARTYKIT_HOST = process.env.NEXT_PUBLIC_PARTYKIT_HOST || "localhost:1999";

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

function PieceModel({
  path,
  tint,
}: {
  path: string;
  tint: THREE.Color;
}) {
  const gltf = useGLTF(path) as any;

  const cloned = useMemo(() => {
    const root: THREE.Object3D = gltf.scene.clone(true);
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      const mat = mesh.material as any;
      if (mat && mat.isMaterial) {
        mesh.material = mat.clone();
        const clonedMat = mesh.material as any;
        if (clonedMat.color && clonedMat.color.isColor) {
          clonedMat.color = clonedMat.color.clone();
          clonedMat.color.copy(tint);
        }
        // Metallic material for pieces
        if (typeof clonedMat.metalness === "number") clonedMat.metalness = 0.7;
        if (typeof clonedMat.roughness === "number") clonedMat.roughness = 0.3;
      }
    });

    // Orient upright and center the model on its base.
    root.rotation.set(Math.PI / 2, 0, 0);
    root.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(root);
    if (Number.isFinite(box.min.x) && Number.isFinite(box.min.y) && Number.isFinite(box.min.z)) {
      const center = box.getCenter(new THREE.Vector3());
      // Center X/Z, but rest on the bottom Y
      root.position.x -= center.x;
      root.position.z -= center.z;
      root.position.y -= box.min.y;
      root.updateWorldMatrix(true, true);
    }

    return root;
  }, [gltf, tint]);

  return <primitive object={cloned} />;
}

const BOARD_TOP_Y = 0.08;

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
      <mesh
        receiveShadow
        castShadow
        onPointerDown={handleClick}
      >
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
        outlineColor={active ? "#000" : "transparent"}
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

export function OutdoorChess({
  roomId,
  selfPositionRef,
  selfId,
}: {
  roomId: string;
  selfPositionRef: RefObject<THREE.Vector3>;
  selfId: string;
}) {
  // Place the board inside the central plaza, but not directly on spawn.
  // Movement bounds are x/z clamped to [-18, 18] in world.
  const origin = useMemo(() => new THREE.Vector3(0, 0.04, -10), []);
  const squareSize = 0.6;
  const boardSize = squareSize * 8;

  const whiteTint = useMemo(() => new THREE.Color("#e8e8e8"), []);
  // Dark gold instead of near-black: keeps contrast, reads premium, avoids disappearing in warm lighting.
  const blackTint = useMemo(() => new THREE.Color("#8a6a1b"), []);

  const socketRef = useRef<PartySocket | null>(null);
  const [chessSelfId, setChessSelfId] = useState<string>("");
  const [chessConnected, setChessConnected] = useState(false);
  const chessConnectedRef = useRef(false);
  const pendingJoinRef = useRef<Side | null>(null);
  
  useEffect(() => {
    chessConnectedRef.current = chessConnected;
  }, [chessConnected]);

  const initialFen = useMemo(() => new Chess().fen(), []);
  const defaultClock = useMemo<ClockState>(() => {
    const baseMs = 5 * 60 * 1000;
    return { baseMs, remainingMs: { w: baseMs, b: baseMs }, running: false, active: "w", lastTickMs: null };
  }, []);
  const [netState, setNetState] = useState<ChessNetState>({
    seats: { w: null, b: null },
    fen: initialFen,
    seq: 0,
    clock: defaultClock,
    result: null,
  });

  const mySide: Side | null = useMemo(() => {
    if (netState.seats.w === chessSelfId) return "w";
    if (netState.seats.b === chessSelfId) return "b";
    return null;
  }, [netState.seats.w, netState.seats.b, chessSelfId]);

  const chess = useMemo(() => new Chess(netState.fen), [netState.fen]);

  const turn = chess.turn();

  const [selected, setSelected] = useState<Square | null>(null);
  const [legalTargets, setLegalTargets] = useState<Square[]>([]);
  const [lastMove, setLastMove] = useState<{ from: Square; to: Square } | null>(null);

  // Drive clock rendering while it's running.
  const [clockNow, setClockNow] = useState(() => Date.now());
  useEffect(() => {
    if (!netState.clock.running) return;
    const id = window.setInterval(() => setClockNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [netState.clock.running]);

  const send = (msg: ChessSendMessage) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(msg));
    }
  };

  useEffect(() => {
    if (!chessConnected) return;

    console.log(`[Chess] Connecting to room ${roomId}-chess`);
    const socket = new PartySocket({
      host: PARTYKIT_HOST,
      party: "chess",
      room: `${roomId}-chess`,
    });

    socketRef.current = socket;

    socket.addEventListener("open", () => {
      console.log("[Chess] Connected");

      // IMPORTANT: PartyKit ids are per-connection. Use the chess socket id
      // for seat ownership checks and move permissions.
      setChessSelfId(socket.id);
      
      // Request any pending join
      const pendingSide = pendingJoinRef.current;
      if (pendingSide) {
        pendingJoinRef.current = null;
        send({ type: "join", side: pendingSide });
      }
    });

    socket.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(event.data) as ChessMessage;

        if (msg.type === "state") {
          setNetState((prev) => {
            if (msg.state.seq < prev.seq) return prev;
            if (msg.state.seq === prev.seq && msg.state.fen === prev.fen) return prev;
            setSelected(null);
            setLegalTargets([]);
            return msg.state;
          });
        }
      } catch (err) {
        console.error("[Chess] Error parsing message:", err);
      }
    });

    socket.addEventListener("close", () => {
      console.log("[Chess] Disconnected");
    });

    return () => {
      socket.close();
    };
  }, [chessConnected, roomId]);

  const requestJoin = (side: Side) => {
    const seat = netState.seats[side];
    if (seat && seat !== chessSelfId) return; // Taken by someone else
    send({ type: "join", side });
  };

  const requestLeave = (side: Side) => {
    send({ type: "leave", side });
  };

  const submitMove = (from: Square, to: Square, promotion?: "q" | "r" | "b" | "n") => {
    if (!mySide) return;
    if (netState.result) return;
    if (turn !== mySide) return;
    
    send({ type: "move", from, to, promotion });
  };

  const onPickSquare = (square: Square) => {
    if (netState.result) return;
    // If we have a selection and click a legal target, move there
    if (selected && legalTargets.includes(square)) {
      const piece = chess.get(selected);
      const isPawn = piece?.type === "p";
      const toRank = Number(square[1]);
      const promotion =
        isPawn && ((piece?.color === "w" && toRank === 8) || (piece?.color === "b" && toRank === 1))
          ? "q"
          : undefined;

      submitMove(selected, square, promotion);
      setLastMove({ from: selected, to: square });
      setSelected(null);
      setLegalTargets([]);
      return;
    }
    
    // Check if there's a piece on this square we can select
    const piece = chess.get(square);
    
    // If clicking our own piece, select it
    if (piece && mySide && turn === mySide && piece.color === mySide) {
      setSelected(square);
      const moves = chess.moves({ square, verbose: true }) as any[];
      const targets = moves.map((m) => m.to).filter(isSquare);
      setLegalTargets(targets);
      return;
    }
    
    // Otherwise deselect
    setSelected(null);
    setLegalTargets([]);
  };

  const onPickPiece = (square: Square) => {
    // Clicking a piece is the same as clicking its square
    onPickSquare(square);
  };

  useFrame(({ clock }) => {
    const pos = selfPositionRef.current;
    if (!pos) return;

    // Only connect to the chess room when the player is near the board.
    // This avoids doubling WebRTC room overhead for everyone.
    if (!chessConnectedRef.current) {
      const dx = pos.x - origin.x;
      const dz = pos.z - origin.z;
      const near = dx * dx + dz * dz < 12 * 12;
      if (near) {
        chessConnectedRef.current = true;
        setChessConnected(true);
      }
      return;
    }

    void clock; // keep signature stable; no per-frame join behavior anymore
  });

  const pieces = useMemo(() => {
    const out: Array<{ square: Square; type: string; color: Side }> = [];
    const board = chess.board(); // ranks 8..1

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
  }, [chess]);

  const padOffset = boardSize / 2 + 1.1;
  const padSize: [number, number] = [2.1, 0.7];
  const whitePadCenter = useMemo(
    () => new THREE.Vector3(origin.x, 0.06, origin.z + padOffset),
    [origin, padOffset]
  );
  const blackPadCenter = useMemo(
    () => new THREE.Vector3(origin.x, 0.06, origin.z - padOffset),
    [origin, padOffset]
  );

  const clickJoin = (side: Side) => {
    // Ensure we are connected, then join.
    if (!chessConnectedRef.current) {
      pendingJoinRef.current = side;
      chessConnectedRef.current = true;
      setChessConnected(true);
      return;
    }

    // If socket isn't open yet, queue the join.
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      pendingJoinRef.current = side;
      return;
    }

    // Toggle behavior:
    // - Clicking your current side leaves (frees seat)
    // - Clicking the other side switches
    if (mySide === side) {
      requestLeave(side);
      return;
    }

    if (mySide) requestLeave(mySide);
    requestJoin(side);
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

  const canConfigure = !!mySide && !netState.clock.running && !netState.result && netState.fen === initialFen;

  const setTimeControlByIndex = (nextIdx: number) => {
    if (!canConfigure) return;
    const idx = clamp(nextIdx, 0, TIME_OPTIONS_SECONDS.length - 1);
    const secs = TIME_OPTIONS_SECONDS[idx]!;
    send({ type: "setTime", baseSeconds: secs });
  };

  const clickReset = () => {
    if (!mySide) return;
    send({ type: "reset" });
  };

  const resultLabel = useMemo(() => {
    const r = netState.result;
    if (!r) return null;
    if (r.type === "timeout") return `${winnerLabel(r.winner)} wins (time)`;
    if (r.type === "checkmate") return `${winnerLabel(r.winner)} wins (mate)`;
    return `Draw (${r.reason})`;
  }, [netState.result]);

  return (
    <group>
      {/* Result banner */}
      {resultLabel ? (
        <Text
          position={[origin.x, origin.y + 1.5, origin.z]}
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

      {/* Decorative stone benches */}
      {/* White side benches */}
      <group position={[origin.x - 3.5, 0.2, origin.z + padOffset + 1.5]}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[2.5, 0.15, 0.6]} />
          <meshStandardMaterial color="#a0826d" roughness={0.7} metalness={0.1} />
        </mesh>
        {/* Bench legs */}
        <mesh castShadow position={[-1, -0.15, 0]}>
          <boxGeometry args={[0.15, 0.25, 0.5]} />
          <meshStandardMaterial color="#8b7355" roughness={0.6} />
        </mesh>
        <mesh castShadow position={[1, -0.15, 0]}>
          <boxGeometry args={[0.15, 0.25, 0.5]} />
          <meshStandardMaterial color="#8b7355" roughness={0.6} />
        </mesh>
      </group>
      <group position={[origin.x + 3.5, 0.2, origin.z + padOffset + 1.5]}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[2.5, 0.15, 0.6]} />
          <meshStandardMaterial color="#a0826d" roughness={0.7} metalness={0.1} />
        </mesh>
        <mesh castShadow position={[-1, -0.15, 0]}>
          <boxGeometry args={[0.15, 0.25, 0.5]} />
          <meshStandardMaterial color="#8b7355" roughness={0.6} />
        </mesh>
        <mesh castShadow position={[1, -0.15, 0]}>
          <boxGeometry args={[0.15, 0.25, 0.5]} />
          <meshStandardMaterial color="#8b7355" roughness={0.6} />
        </mesh>
      </group>
      
      {/* Black side benches */}
      <group position={[origin.x - 3.5, 0.2, origin.z - padOffset - 1.5]}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[2.5, 0.15, 0.6]} />
          <meshStandardMaterial color="#a0826d" roughness={0.7} metalness={0.1} />
        </mesh>
        <mesh castShadow position={[-1, -0.15, 0]}>
          <boxGeometry args={[0.15, 0.25, 0.5]} />
          <meshStandardMaterial color="#8b7355" roughness={0.6} />
        </mesh>
        <mesh castShadow position={[1, -0.15, 0]}>
          <boxGeometry args={[0.15, 0.25, 0.5]} />
          <meshStandardMaterial color="#8b7355" roughness={0.6} />
        </mesh>
      </group>
      <group position={[origin.x + 3.5, 0.2, origin.z - padOffset - 1.5]}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[2.5, 0.15, 0.6]} />
          <meshStandardMaterial color="#a0826d" roughness={0.7} metalness={0.1} />
        </mesh>
        <mesh castShadow position={[-1, -0.15, 0]}>
          <boxGeometry args={[0.15, 0.25, 0.5]} />
          <meshStandardMaterial color="#8b7355" roughness={0.6} />
        </mesh>
        <mesh castShadow position={[1, -0.15, 0]}>
          <boxGeometry args={[0.15, 0.25, 0.5]} />
          <meshStandardMaterial color="#8b7355" roughness={0.6} />
        </mesh>
      </group>
      
      {/* Decorative potted plants */}
      {[-1, 1].map((side) => (
        <group key={`plant-${side}`} position={[origin.x + side * 5, 0, origin.z]}>
          {/* Pot (rim + body + soil) */}
          <mesh castShadow receiveShadow position={[0, 0.12, 0]}>
            <cylinderGeometry args={[0.34, 0.38, 0.26, 14]} />
            <meshStandardMaterial color="#6f3b22" roughness={0.85} metalness={0.02} />
          </mesh>
          <mesh castShadow receiveShadow position={[0, 0.26, 0]}>
            <cylinderGeometry args={[0.4, 0.4, 0.06, 14]} />
            <meshStandardMaterial color="#4c2414" roughness={0.9} />
          </mesh>
          <mesh receiveShadow position={[0, 0.285, 0]}>
            <cylinderGeometry args={[0.33, 0.33, 0.02, 14]} />
            <meshStandardMaterial color="#2a1b12" roughness={1} />
          </mesh>

          {/* Plant: layered leaves */}
          <group position={[0, 0.32, 0]}>
            <mesh castShadow>
              <coneGeometry args={[0.28, 0.45, 10]} />
              <meshStandardMaterial color="#2f5b2f" roughness={1} />
            </mesh>
            <mesh castShadow position={[0.12, 0.05, 0.08]} rotation={[0, 0.4, 0]}>
              <coneGeometry args={[0.22, 0.38, 10]} />
              <meshStandardMaterial color="#3a7436" roughness={1} />
            </mesh>
            <mesh castShadow position={[-0.12, 0.03, -0.06]} rotation={[0, -0.3, 0]}>
              <coneGeometry args={[0.2, 0.34, 10]} />
              <meshStandardMaterial color="#2a4f2a" roughness={1} />
            </mesh>

            {/* Small flowers (subtle) */}
            {[-0.12, 0.0, 0.12].map((fx, i) => (
              <mesh key={i} position={[fx, 0.28, (i - 1) * 0.08]}>
                <sphereGeometry args={[0.03, 8, 8]} />
                <meshStandardMaterial color={side > 0 ? "#ffd6e7" : "#fff1b8"} roughness={0.7} />
              </mesh>
            ))}
          </group>
        </group>
      ))}
      
      {/* Board */}
      <group position={[origin.x, origin.y, origin.z]}>
        {Array.from({ length: 64 }).map((_, idx) => {
          const file = idx % 8;
          const rankFromTop = Math.floor(idx / 8);
          const rank = 8 - rankFromTop;
          const square = `${FILES[file]!}${rank}` as const;

          const x = (file - 3.5) * squareSize;
          const z = (rankFromTop - 3.5) * squareSize;
          const isDark = (file + rankFromTop) % 2 === 1;

          const isTarget = legalTargets.includes(square as any);
          const isSel = selected === (square as any);
          const isLastMoveFrom = lastMove?.from === square;
          const isLastMoveTo = lastMove?.to === square;
          const pieceOnSquare = chess.get(square as Square);
          const canInteract = 
            (isTarget) || 
            (pieceOnSquare && mySide === pieceOnSquare.color && turn === mySide);

          return (
            <group
              key={square}
              position={[x, 0, z]}
              onPointerDown={(e) => {
                e.stopPropagation();
                onPickSquare(square as any);
              }}
              onPointerEnter={() => {
                if (canInteract) document.body.style.cursor = "pointer";
              }}
              onPointerLeave={() => {
                document.body.style.cursor = "default";
              }}
            >
              <mesh receiveShadow>
                <boxGeometry args={[squareSize, 0.08, squareSize]} />
                <meshStandardMaterial
                  color={isDark ? "#8b4513" : "#deb887"}
                  roughness={0.7}
                  metalness={0.1}
                />
              </mesh>

              {/* Selected square highlight */}
              {isSel && (
                <mesh position={[0, 0.06, 0]}>
                  <boxGeometry args={[squareSize * 0.82, 0.02, squareSize * 0.82]} />
                  <meshStandardMaterial
                    color="#e6e6e6"
                    roughness={0.8}
                    transparent
                    opacity={0.65}
                  />
                </mesh>
              )}
              
              {/* Legal move target highlight */}
              {isTarget && !isSel && (
                <mesh position={[0, 0.06, 0]}>
                  <boxGeometry args={[squareSize * 0.82, 0.02, squareSize * 0.82]} />
                  <meshStandardMaterial
                    color="#9a9a9a"
                    roughness={0.8}
                    transparent
                    opacity={0.65}
                  />
                </mesh>
              )}
              
              {/* Last move glow - from square */}
              {isLastMoveFrom && (
                <>
                  <mesh position={[0, 0.1, 0]}>
                    <boxGeometry args={[squareSize * 0.9, 0.01, squareSize * 0.9]} />
                    <meshStandardMaterial
                      color="#4a9eff"
                      emissive="#4a9eff"
                      emissiveIntensity={0.5}
                      transparent
                      opacity={0.4}
                    />
                  </mesh>
                  <pointLight
                    position={[0, 0.2, 0]}
                    color="#4a9eff"
                    intensity={0.8}
                    distance={1.2}
                  />
                </>
              )}
              
              {/* Last move glow - to square */}
              {isLastMoveTo && (
                <>
                  <mesh position={[0, 0.1, 0]}>
                    <boxGeometry args={[squareSize * 0.9, 0.01, squareSize * 0.9]} />
                    <meshStandardMaterial
                      color="#ffa04a"
                      emissive="#ffa04a"
                      emissiveIntensity={0.6}
                      transparent
                      opacity={0.5}
                    />
                  </mesh>
                  <pointLight
                    position={[0, 0.2, 0]}
                    color="#ffa04a"
                    intensity={1}
                    distance={1.5}
                  />
                </>
              )}
            </group>
          );
        })}
      </group>

      {/* Join pads */}
      <JoinPad
        label={`${formatClock(clocks.remaining.w)}\n${netState.seats.w ? "White Taken" : "Join White"}`}
        center={whitePadCenter}
        size={padSize}
        active={mySide === "w"}
        disabled={!!netState.seats.w && netState.seats.w !== chessSelfId}
        onClick={() => clickJoin("w")}
      />
      <JoinPad
        label={`${formatClock(clocks.remaining.b)}\n${netState.seats.b ? "Black Taken" : "Join Black"}`}
        center={blackPadCenter}
        size={padSize}
        active={mySide === "b"}
        disabled={!!netState.seats.b && netState.seats.b !== chessSelfId}
        onClick={() => clickJoin("b")}
      />

      {/* Time control + reset (right side of board) */}
      {(() => {
        const controlX = origin.x + boardSize / 2 + 2.6;
        const controlZ = origin.z;
        const smallSize: [number, number] = [0.9, 0.6];
        const leftCenter = new THREE.Vector3(controlX - 1.15, 0.06, controlZ + 1.2);
        const rightCenter = new THREE.Vector3(controlX + 1.15, 0.06, controlZ + 1.2);
        const resetCenter = new THREE.Vector3(controlX, 0.06, controlZ - 1.0);
        return (
          <group>
            <JoinPad
              label="-"
              center={leftCenter}
              size={smallSize}
              active={false}
              disabled={!canConfigure || timeIndex === 0}
              onClick={() => setTimeControlByIndex(timeIndex - 1)}
            />
            <JoinPad
              label="+"
              center={rightCenter}
              size={smallSize}
              active={false}
              disabled={!canConfigure || timeIndex === TIME_OPTIONS_SECONDS.length - 1}
              onClick={() => setTimeControlByIndex(timeIndex + 1)}
            />
            <Text
              position={[controlX, 0.48, controlZ + 1.2]}
              rotation={[-Math.PI / 2, 0, 0]}
              fontSize={0.18}
              color="#111"
              anchorX="center"
              anchorY="middle"
              outlineWidth={0.008}
              outlineColor="transparent"
              fontWeight="bold"
            >
              {`Time ${Math.round(clocks.baseMs / 60000)}m`}
            </Text>
            <JoinPad
              label="Reset"
              center={resetCenter}
              size={[2.0, 0.7]}
              active={false}
              disabled={!mySide}
              onClick={clickReset}
            />
          </group>
        );
      })()}

      {/* Pieces */}
      {pieces.map((p) => {
        const pos = squareCenter(p.square, origin, squareSize);
        const tint = p.color === "w" ? whiteTint : blackTint;
        const scale = 11.25;
        const isMyPiece = mySide === p.color;
        const canMove = turn === p.color && isMyPiece;

        return (
          <group
            key={`${p.square}:${p.type}:${p.color}`}
            position={[pos.x, BOARD_TOP_Y, pos.z]}
            onPointerDown={(e) => {
              e.stopPropagation();
              onPickPiece(p.square);
            }}
            onPointerEnter={() => {
              if (canMove) document.body.style.cursor = "pointer";
            }}
            onPointerLeave={() => {
              document.body.style.cursor = "default";
            }}
          >
            {/* Visual model (scaled up) */}
            <group scale={[scale, scale, scale]}>
              <PieceModel path={piecePath(p.type)} tint={tint} />
            </group>
          </group>
        );
      })}
    </group>
  );
}

useGLTF.preload("/models/pawn.glb");
useGLTF.preload("/models/knight.glb");
useGLTF.preload("/models/bishop.glb");
useGLTF.preload("/models/rook.glb");
useGLTF.preload("/models/queen.glb");
useGLTF.preload("/models/king.glb");
