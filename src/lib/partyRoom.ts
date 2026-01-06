"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import PartySocket from "partysocket";
import { colorFromId } from "@/lib/hashColor";
import type { BoardMode } from "@/lib/boardModes";

/**
 * Board mode unification note:
 *
 * `BoardMode` is imported/re-exported from `src/lib/boardModes.ts` so the PartyKit
 * room state and the UI/boards share the same single source of truth.
 *
 * When adding a new mode, prefer updating the registry (`BOARD_MODE_DEFS`) rather
 * than expanding unions here.
 */
export type { BoardMode } from "@/lib/boardModes";

export type Vec3 = [number, number, number];

export type Player = {
  id: string;
  name: string;
  color: string;
  gender: "male" | "female";
  avatarUrl?: string;
  position: Vec3;
  rotY: number;
  lastSeen: number;
};

export type ChatMessage = {
  id: string;
  fromId: string;
  fromName: string;
  text: string;
  t: number;
};

export type LeaderboardEntry = {
  id: string;
  name: string;
  moves: number;
  playMs: number;
  score: number;
};

type PartyMessage =
  | {
      type: "sync";
      players: Record<string, Omit<Player, "lastSeen">>;
      chat?: ChatMessage[];
      boardModes?: Record<string, BoardMode>;
    }
  | { type: "player-joined"; player: Omit<Player, "lastSeen"> }
  | { type: "player-moved"; id: string; position: Vec3; rotY: number }
  | { type: "player-left"; id: string }
  | { type: "chat"; message: ChatMessage }
  | { type: "board:modes"; boardModes: Record<string, BoardMode> }
  | { type: "leaderboard"; entries: LeaderboardEntry[] };

function defaultName(selfId: string) {
  return `Player-${selfId.slice(0, 4)}`;
}

const PARTYKIT_HOST = process.env.NEXT_PUBLIC_PARTYKIT_HOST || "127.0.0.1:1999";

export function usePartyRoom(
  roomId: string,
  opts?: {
    initialName?: string;
    initialGender?: "male" | "female";
    paused?: boolean;
  }
) {
  const [selfId, setSelfId] = useState<string>("");
  const [selfName, setSelfName] = useState<string>("");
  const [selfGender, setSelfGender] = useState<"male" | "female">("male");
  const [selfAvatarUrl, setSelfAvatarUrl] = useState<string | undefined>(
    undefined
  );
  const [players, setPlayers] = useState<Record<string, Player>>({});
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [boardModes, setBoardModes] = useState<Record<string, BoardMode>>({
    a: "chess",
    b: "chess",
    c: "chess",
    d: "chess",
  });

  const socketRef = useRef<PartySocket | null>(null);
  const connectSeqRef = useRef(0);
  const selfNameRef = useRef<string>("");
  const selfGenderRef = useRef<"male" | "female">("male");
  const selfAvatarUrlRef = useRef<string | undefined>(undefined);
  const paused = opts?.paused ?? false;

  // Batch chat updates so spam doesn't trigger a render per message.
  const pendingChatRef = useRef<ChatMessage[]>([]);
  const chatFlushRafRef = useRef<number | null>(null);

  // Batch movement updates to reduce render churn at scale.
  const pendingMovesRef = useRef<Map<string, { position: Vec3; rotY: number }>>(
    new Map()
  );
  const movesFlushRafRef = useRef<number | null>(null);

  const initialNameStable = useMemo(
    () => (opts?.initialName ?? "").trim().slice(0, 24),
    [opts?.initialName]
  );
  const initialGenderStable = useMemo(
    () => opts?.initialGender ?? "male",
    [opts?.initialGender]
  );

  useEffect(() => {
    selfNameRef.current = initialNameStable;
    setSelfName(initialNameStable);
    selfGenderRef.current = initialGenderStable;
    setSelfGender(initialGenderStable);
  }, [initialNameStable, initialGenderStable]);

  useEffect(() => {
    if (paused) return;

    // Bump connection sequence so stale sockets can't update state.
    connectSeqRef.current += 1;
    const seq = connectSeqRef.current;

    // If a socket already exists (Fast Refresh / StrictMode edge cases), close it first.
    const prev = socketRef.current;
    if (prev) {
      try {
        prev.close();
      } catch {
        // ignore
      }
      socketRef.current = null;
    }

    console.log(`[PartyKit] Connecting to room: ${roomId}`);

    const socket = new PartySocket({
      host: PARTYKIT_HOST,
      room: roomId,
    });

    socketRef.current = socket;

    const onOpen = () => {
      if (connectSeqRef.current !== seq) return;
      console.log("[PartyKit] Connected");
      setConnected(true);
      setSelfId(socket.id);

      // Send hello message
      socket.send(
        JSON.stringify({
          type: "hello",
          name: selfNameRef.current || defaultName(socket.id),
          color: colorFromId(socket.id),
          gender: selfGenderRef.current,
          avatarUrl: selfAvatarUrlRef.current,
        })
      );
    };

    const onMessage = (event: MessageEvent) => {
      if (connectSeqRef.current !== seq) return;
      try {
        const msg = JSON.parse(event.data) as PartyMessage;

        if (msg.type === "sync") {
          // Initial sync with all players - batch updates
          console.log("[PartyKit] Received sync:", msg.players);
          const playersWithTimestamp: Record<string, Player> = {};
          for (const [id, player] of Object.entries(msg.players)) {
            playersWithTimestamp[id] = { ...player, lastSeen: Date.now() };
          }
          setPlayers(playersWithTimestamp);
          if (Array.isArray(msg.chat)) {
            // Reset any buffered chat, then apply the authoritative sync.
            pendingChatRef.current = [];
            if (chatFlushRafRef.current !== null) {
              cancelAnimationFrame(chatFlushRafRef.current);
              chatFlushRafRef.current = null;
            }
            setChat(msg.chat.slice(-60));
          }
          if (msg.boardModes && typeof msg.boardModes === "object") {
            setBoardModes(msg.boardModes);
          }
        } else if (msg.type === "player-joined") {
          console.log("[PartyKit] Player joined:", msg.player.id);
          setPlayers((prev) => ({
            ...prev,
            [msg.player.id]: { ...msg.player, lastSeen: Date.now() },
          }));
        } else if (msg.type === "player-moved") {
          pendingMovesRef.current.set(msg.id, {
            position: msg.position,
            rotY: msg.rotY,
          });

          if (movesFlushRafRef.current === null) {
            movesFlushRafRef.current = requestAnimationFrame(() => {
              movesFlushRafRef.current = null;
              const pending = pendingMovesRef.current;
              if (!pending.size) return;
              pendingMovesRef.current = new Map();

              const now = Date.now();
              setPlayers((prev) => {
                let changed = false;
                const next: Record<string, Player> = { ...prev };

                for (const [id, upd] of pending.entries()) {
                  const player = prev[id];
                  if (!player) continue;

                  const samePos =
                    player.position[0] === upd.position[0] &&
                    player.position[1] === upd.position[1] &&
                    player.position[2] === upd.position[2];
                  const sameRot = player.rotY === upd.rotY;

                  if (samePos && sameRot) {
                    // Still bump lastSeen so stale players can be detected.
                    if (player.lastSeen !== now) {
                      next[id] = { ...player, lastSeen: now };
                      changed = true;
                    }
                    continue;
                  }

                  next[id] = {
                    ...player,
                    position: upd.position,
                    rotY: upd.rotY,
                    lastSeen: now,
                  };
                  changed = true;
                }

                return changed ? next : prev;
              });
            });
          }
        } else if (msg.type === "player-left") {
          console.log("[PartyKit] Player left:", msg.id);
          setPlayers((prev) => {
            const next = { ...prev };
            delete next[msg.id];
            return next;
          });
        } else if (msg.type === "chat") {
          pendingChatRef.current.push(msg.message);

          if (chatFlushRafRef.current === null) {
            chatFlushRafRef.current = requestAnimationFrame(() => {
              chatFlushRafRef.current = null;
              const buffered = pendingChatRef.current;
              if (!buffered.length) return;
              pendingChatRef.current = [];

              setChat((prev) => {
                const next = prev.concat(buffered);
                if (next.length > 60) next.splice(0, next.length - 60);
                return next;
              });
            });
          }
        } else if (msg.type === "board:modes") {
          setBoardModes(msg.boardModes);
        } else if (msg.type === "leaderboard") {
          setLeaderboard(
            Array.isArray(msg.entries) ? msg.entries.slice(0, 10) : []
          );
        }
      } catch (err) {
        console.error("[PartyKit] Error parsing message:", err);
      }
    };

    const onClose = (event?: CloseEvent) => {
      if (connectSeqRef.current !== seq) return;
      const code = typeof event?.code === "number" ? event.code : undefined;
      const reason =
        typeof event?.reason === "string" ? event.reason : undefined;
      console.log("[PartyKit] Disconnected", {
        host: PARTYKIT_HOST,
        room: roomId,
        code,
        reason,
        wasClean: event?.wasClean,
      });
      setConnected(false);
    };

    const onError = (event: Event) => {
      if (connectSeqRef.current !== seq) return;
      // Browser WebSocket 'error' events intentionally provide almost no detail.
      // Log context so we can correlate with close codes and server logs.
      console.error("[PartyKit] Socket error", {
        host: PARTYKIT_HOST,
        room: roomId,
        type: event?.type,
        readyState: (socket as any)?.readyState,
      });
    };

    socket.addEventListener("open", onOpen);
    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onClose);
    socket.addEventListener("error", onError);

    return () => {
      pendingChatRef.current = [];
      if (chatFlushRafRef.current !== null) {
        cancelAnimationFrame(chatFlushRafRef.current);
        chatFlushRafRef.current = null;
      }

      pendingMovesRef.current = new Map();
      if (movesFlushRafRef.current !== null) {
        cancelAnimationFrame(movesFlushRafRef.current);
        movesFlushRafRef.current = null;
      }

      // Invalidate this connection.
      if (connectSeqRef.current === seq) {
        connectSeqRef.current += 1;
      }

      try {
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("message", onMessage);
        socket.removeEventListener("close", onClose);
        socket.removeEventListener("error", onError);
      } catch {
        // ignore
      }

      try {
        socket.close();
      } catch {
        // ignore
      }

      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    };
  }, [roomId, paused]);

  const sendSelfState = useCallback((position: Vec3, rotY: number) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          type: "state",
          position,
          rotY,
        })
      );
    }
  }, []);

  const sendChat = useCallback((text: string) => {
    const cleaned = (text ?? "").toString().trim().slice(0, 160);
    if (!cleaned) return;
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "chat", text: cleaned }));
    }
  }, []);

  const setBoardMode = useCallback((boardKey: string, mode: BoardMode) => {
    const cleanedKey = (boardKey ?? "").toString().trim().slice(0, 8);
    const cleanedMode: BoardMode = mode;
    if (!cleanedKey) return;
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          type: "board:set-mode",
          boardKey: cleanedKey,
          mode: cleanedMode,
        })
      );
    }
  }, []);

  const reportActivityMove = useCallback((game: string, boardKey?: string) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          type: "activity:move",
          game: (game ?? "").toString().slice(0, 16),
          boardKey: boardKey
            ? (boardKey ?? "").toString().slice(0, 8)
            : undefined,
        })
      );
    }
  }, []);

  const setName = useCallback((name: string) => {
    selfNameRef.current = name;
    setSelfName(name);
  }, []);

  const setAvatarUrl = useCallback(
    (url: string) => {
      selfAvatarUrlRef.current = url;
      setSelfAvatarUrl(url);

      // Re-send hello with updated avatar
      if (socketRef.current?.readyState === WebSocket.OPEN && selfId) {
        socketRef.current.send(
          JSON.stringify({
            type: "hello",
            name: selfNameRef.current || defaultName(selfId),
            color: colorFromId(selfId),
            gender: selfGenderRef.current,
            avatarUrl: url,
          })
        );
      }
    },
    [selfId]
  );

  const self = selfId
    ? {
        id: selfId,
        name: selfName || defaultName(selfId),
        color: colorFromId(selfId),
        gender: selfGender,
        avatarUrl: selfAvatarUrl,
      }
    : null;

  return {
    self,
    players,
    peerCount: Object.keys(players).length,
    chat,
    leaderboard,
    connected,
    boardModes,
    sendSelfState,
    sendChat,
    setBoardMode,
    reportActivityMove,
    setName,
    setAvatarUrl,
    socketRef, // Expose for voice integration
  };
}
