"use client";

import { Text, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { Chess, type Square } from "chess.js";
import { joinRoom, selfId as trysteroSelfId } from "trystero/torrent";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

type Side = "w" | "b";

type ChessNetState = {
  seats: { w: string | null; b: string | null };
  fen: string;
  seq: number;
};

type JoinMsg = { t: "join"; side: Side };

type MoveMsg = {
  t: "move";
  move: { from: Square; to: Square; promotion?: "q" | "r" | "b" | "n" };
};

type StateMsg = { t: "state"; state: ChessNetState };

type HelloMsg = { t: "hello" };

type ChessMsg = JoinMsg | MoveMsg | StateMsg | HelloMsg;

const APP_ID = "pawnsquare";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;

function minLex(ids: string[]) {
  return ids.reduce((best, id) => (best === "" || id < best ? id : best), "");
}

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
        if (typeof clonedMat.metalness === "number") clonedMat.metalness = 0.05;
        if (typeof clonedMat.roughness === "number") clonedMat.roughness = 0.9;
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
  return (
    <group position={[center.x, center.y, center.z]}>
      <mesh
        receiveShadow
        onPointerDown={(e) => {
          e.stopPropagation();
          if (disabled) return;
          onClick();
        }}
      >
        <boxGeometry args={[w, 0.12, d]} />
        <meshStandardMaterial
          color={disabled ? "#5a5a5a" : active ? "#e6e6e6" : "#7a7a7a"}
          roughness={0.9}
        />
      </mesh>
      <Text
        position={[0, 0.25, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.45}
        color={disabled ? "#2a2a2a" : "#111"}
        anchorX="center"
        anchorY="middle"
      >
        {label}
      </Text>
    </group>
  );
}

export function OutdoorChess({
  selfPositionRef,
}: {
  selfPositionRef: RefObject<THREE.Vector3>;
}) {
  // Place the board away from the default spawn (0,0,0) but still inside
  // the current movement bounds (x/z clamped to [-18, 18] in world).
  const origin = useMemo(() => new THREE.Vector3(14, 0.04, 14), []);
  const squareSize = 0.6;
  const boardSize = squareSize * 8;

  const whiteTint = useMemo(() => new THREE.Color("#e6e6e6"), []);
  const blackTint = useMemo(() => new THREE.Color("#1a1a1a"), []);

  const sendRef = useRef<((data: any, targetPeers?: any) => Promise<any>) | null>(null);

  const [chessConnected, setChessConnected] = useState(false);
  const chessConnectedRef = useRef(false);
  const pendingJoinRef = useRef<Side | null>(null);
  useEffect(() => {
    chessConnectedRef.current = chessConnected;
  }, [chessConnected]);

  const [peerIds, setPeerIds] = useState<string[]>([]);

  const hostId = useMemo(() => {
    const ids = [trysteroSelfId, ...peerIds];
    return minLex(Array.from(new Set(ids)));
  }, [peerIds]);

  const isHost = hostId === trysteroSelfId;
  const isHostRef = useRef(isHost);
  useEffect(() => {
    isHostRef.current = isHost;
  }, [isHost]);

  const initialFen = useMemo(() => new Chess().fen(), []);
  const [netState, setNetState] = useState<ChessNetState>({
    seats: { w: null, b: null },
    fen: initialFen,
    seq: 0,
  });

  const netStateRef = useRef(netState);
  useEffect(() => {
    netStateRef.current = netState;
  }, [netState]);

  const mySide: Side | null = useMemo(() => {
    if (netState.seats.w === trysteroSelfId) return "w";
    if (netState.seats.b === trysteroSelfId) return "b";
    return null;
  }, [netState.seats.w, netState.seats.b]);

  const chess = useMemo(() => new Chess(netState.fen), [netState.fen]);

  const turn = chess.turn();

  const [selected, setSelected] = useState<Square | null>(null);
  const [legalTargets, setLegalTargets] = useState<Square[]>([]);

  const send = useMemo(() => {
    return (msg: ChessMsg, targetPeer?: string) => {
      const fn = sendRef.current;
      if (!fn) return;
      void fn(msg, targetPeer);
    };
  }, []);

  const broadcastState = useMemo(() => {
    return (state: ChessNetState, targetPeer?: string) => {
      send({ t: "state", state }, targetPeer);
    };
  }, [send]);

  const hostSetState = (next: Omit<ChessNetState, "seq">) => {
    const currentSeq = netStateRef.current.seq;
    const state: ChessNetState = { ...next, seq: currentSeq + 1 };
    setNetState(state);
    broadcastState(state);
  };

  const hostMaybeRemoveSeatsForPeer = (peerId: string) => {
    const current = netStateRef.current;
    if (!current.seats.w && !current.seats.b) return;
    const nextSeats = {
      w: current.seats.w === peerId ? null : current.seats.w,
      b: current.seats.b === peerId ? null : current.seats.b,
    };
    if (nextSeats.w === current.seats.w && nextSeats.b === current.seats.b) return;
    hostSetState({ seats: nextSeats, fen: current.fen });
  };

  useEffect(() => {
    if (!chessConnected) return;
    const room = joinRoom({ appId: APP_ID }, "chess-global");

    const [sendChess, onChess] = room.makeAction<ChessMsg>("chess");
    sendRef.current = sendChess;

    const applyState = (incoming: ChessNetState) => {
      setSelected(null);
      setLegalTargets([]);
      setNetState((prev) => {
        if (incoming.seq < prev.seq) return prev;
        return incoming;
      });
    };

    const hostHandleJoin = (peerId: string, side: Side) => {
      const current = netStateRef.current;
      const nextSeats = { ...current.seats };

      if (side === "w") {
        if (!nextSeats.w || nextSeats.w === peerId) nextSeats.w = peerId;
        else return;
      } else {
        if (!nextSeats.b || nextSeats.b === peerId) nextSeats.b = peerId;
        else return;
      }

      hostSetState({ seats: nextSeats, fen: current.fen });
    };

    const hostHandleMove = (
      peerId: string,
      move: { from: Square; to: Square; promotion?: "q" | "r" | "b" | "n" }
    ) => {
      const current = netStateRef.current;
      const chess = new Chess(current.fen);

      const expectedSide = chess.turn();
      const expectedPlayer = expectedSide === "w" ? current.seats.w : current.seats.b;
      if (!expectedPlayer || expectedPlayer !== peerId) return;

      const result = chess.move({
        from: move.from,
        to: move.to,
        promotion: move.promotion,
      });
      if (!result) return;

      hostSetState({ seats: current.seats, fen: chess.fen() });
    };

    onChess((data: unknown, peerId: string) => {
      const msg = (data ?? null) as Partial<ChessMsg> | null;
      if (!msg || typeof msg.t !== "string") return;

      if (msg.t === "hello") {
        if (isHostRef.current) {
          broadcastState(netStateRef.current, peerId);
        }
        return;
      }

      if (msg.t === "state") {
        if (!msg.state) return;
        applyState(msg.state);
        return;
      }

      if (msg.t === "join") {
        if (!isHostRef.current) return;
        if (msg.side !== "w" && msg.side !== "b") return;
        hostHandleJoin(peerId, msg.side);
        return;
      }

      if (msg.t === "move") {
        if (!isHostRef.current) return;
        const move = msg.move as any;
        if (!move || !isSquare(move.from) || !isSquare(move.to)) return;
        hostHandleMove(peerId, move);
        return;
      }
    });

    room.onPeerJoin((peerId: string) => {
      setPeerIds((prev) => (prev.includes(peerId) ? prev : [...prev, peerId]));

      if (isHostRef.current) {
        broadcastState(netStateRef.current, peerId);
      }
    });

    room.onPeerLeave((peerId: string) => {
      setPeerIds((prev) => prev.filter((p) => p !== peerId));
      if (isHostRef.current) hostMaybeRemoveSeatsForPeer(peerId);
    });

    // announce ourselves
    void sendChess({ t: "hello" });

    return () => {
      room.leave();
      sendRef.current = null;
    };
  }, [broadcastState, chessConnected]);

  // If host changes and we become host, broadcast our latest known state.
  useEffect(() => {
    if (!isHost) return;
    broadcastState(netStateRef.current);
  }, [isHost, broadcastState]);

  const requestJoin = (side: Side) => {
    if (mySide === side) return;
    if (isHostRef.current) {
      const current = netStateRef.current;
      const nextSeats = { ...current.seats };
      if (side === "w") {
        if (nextSeats.w && nextSeats.w !== trysteroSelfId) return;
        nextSeats.w = trysteroSelfId;
      } else {
        if (nextSeats.b && nextSeats.b !== trysteroSelfId) return;
        nextSeats.b = trysteroSelfId;
      }
      hostSetState({ seats: nextSeats, fen: current.fen });
      return;
    }

    send({ t: "join", side });
  };

  // If the user clicked a join button before we were connected, fulfill it once connected.
  useEffect(() => {
    if (!chessConnected) return;
    if (!sendRef.current) return;
    const side = pendingJoinRef.current;
    if (!side) return;
    pendingJoinRef.current = null;
    requestJoin(side);
  }, [chessConnected]);

  const submitMove = (from: Square, to: Square, promotion?: "q" | "r" | "b" | "n") => {
    if (!mySide) return;
    if (turn !== mySide) return;

    if (isHostRef.current) {
      hostHandleLocalMove(from, to, promotion);
      return;
    }

    send({ t: "move", move: { from, to, promotion } });
  };

  const hostHandleLocalMove = (
    from: Square,
    to: Square,
    promotion?: "q" | "r" | "b" | "n"
  ) => {
    const current = netStateRef.current;
    const chess = new Chess(current.fen);
    const expectedSide = chess.turn();
    const expectedPlayer = expectedSide === "w" ? current.seats.w : current.seats.b;
    if (expectedPlayer !== trysteroSelfId) return;

    const result = chess.move({ from, to, promotion });
    if (!result) return;

    hostSetState({ seats: current.seats, fen: chess.fen() });
  };

  const onPickSquare = (square: Square) => {
    if (!selected) return;
    if (!legalTargets.includes(square)) {
      setSelected(null);
      setLegalTargets([]);
      return;
    }

    // minimal promotion handling: always queen
    const piece = chess.get(selected);
    const isPawn = piece?.type === "p";
    const toRank = Number(square[1]);
    const promotion =
      isPawn && ((piece?.color === "w" && toRank === 8) || (piece?.color === "b" && toRank === 1))
        ? "q"
        : undefined;

    submitMove(selected, square, promotion);
    setSelected(null);
    setLegalTargets([]);
  };

  const onPickPiece = (square: Square) => {
    if (!mySide) return;
    if (turn !== mySide) return;

    const piece = chess.get(square);
    if (!piece) return;
    if (piece.color !== mySide) return;

    setSelected(square);
    const moves = chess.moves({ square, verbose: true }) as any[];
    const targets = moves.map((m) => m.to).filter(isSquare);
    setLegalTargets(targets);
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
    requestJoin(side);
  };

  return (
    <group>
      {/* Natural-ish local lighting for the chess set */}
      <hemisphereLight intensity={0.25} groundColor="#3a3a3a" color="#f3fbff" />
      <directionalLight intensity={0.35} position={[origin.x + 6, 10, origin.z + 4]} color="#fff6e6" />

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

          return (
            <group key={square} position={[x, 0, z]}>
              <mesh
                receiveShadow
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onPickSquare(square as any);
                }}
              >
                <boxGeometry args={[squareSize, 0.08, squareSize]} />
                <meshStandardMaterial
                  color={isDark ? "#3a3a3a" : "#1f1f1f"}
                  roughness={0.95}
                />
              </mesh>

              {isTarget || isSel ? (
                <mesh position={[0, 0.06, 0]}>
                  <boxGeometry args={[squareSize * 0.82, 0.02, squareSize * 0.82]} />
                  <meshStandardMaterial
                    color={isSel ? "#e6e6e6" : "#9a9a9a"}
                    roughness={0.8}
                    transparent
                    opacity={0.65}
                  />
                </mesh>
              ) : null}
            </group>
          );
        })}
      </group>

      {/* Join pads */}
      <JoinPad
        label={netState.seats.w ? "White Taken" : "Join White"}
        center={whitePadCenter}
        size={padSize}
        active={mySide === "w"}
        disabled={!!netState.seats.w && netState.seats.w !== trysteroSelfId}
        onClick={() => clickJoin("w")}
      />
      <JoinPad
        label={netState.seats.b ? "Black Taken" : "Join Black"}
        center={blackPadCenter}
        size={padSize}
        active={mySide === "b"}
        disabled={!!netState.seats.b && netState.seats.b !== trysteroSelfId}
        onClick={() => clickJoin("b")}
      />

      {/* Pieces */}
      {pieces.map((p) => {
        const pos = squareCenter(p.square, origin, squareSize);
        const tint = p.color === "w" ? whiteTint : blackTint;
        const scale = 7.5;

        return (
          <group
            key={`${p.square}:${p.type}:${p.color}`}
            position={[pos.x, BOARD_TOP_Y, pos.z]}
            scale={[scale, scale, scale]}
            onPointerDown={(e) => {
              e.stopPropagation();
              onPickPiece(p.square);
            }}
          >
            <PieceModel path={piecePath(p.type)} tint={tint} />
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
