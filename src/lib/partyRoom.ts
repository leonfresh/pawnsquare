"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import PartySocket from "partysocket";
import { colorFromId } from "@/lib/hashColor";

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

type PartyMessage =
  | {
      type: "sync";
      players: Record<string, Omit<Player, "lastSeen">>;
      chat?: ChatMessage[];
    }
  | { type: "player-joined"; player: Omit<Player, "lastSeen"> }
  | { type: "player-moved"; id: string; position: Vec3; rotY: number }
  | { type: "player-left"; id: string }
  | { type: "chat"; message: ChatMessage };

function defaultName(selfId: string) {
  return `Player-${selfId.slice(0, 4)}`;
}

const PARTYKIT_HOST = process.env.NEXT_PUBLIC_PARTYKIT_HOST || "localhost:1999";

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

  const socketRef = useRef<PartySocket | null>(null);
  const selfNameRef = useRef<string>("");
  const selfGenderRef = useRef<"male" | "female">("male");
  const selfAvatarUrlRef = useRef<string | undefined>(undefined);
  const paused = opts?.paused ?? false;

  useEffect(() => {
    const initial = (opts?.initialName ?? "").trim().slice(0, 24);
    selfNameRef.current = initial;
    setSelfName(initial);
    const gender = opts?.initialGender ?? "male";
    selfGenderRef.current = gender;
    setSelfGender(gender);
  }, [opts?.initialName, opts?.initialGender]);

  useEffect(() => {
    if (paused) return;

    console.log(`[PartyKit] Connecting to room: ${roomId}`);

    const socket = new PartySocket({
      host: PARTYKIT_HOST,
      room: roomId,
    });

    socketRef.current = socket;

    socket.addEventListener("open", () => {
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
    });

    socket.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(event.data) as PartyMessage;

        if (msg.type === "sync") {
          // Initial sync with all players
          console.log("[PartyKit] Received sync:", msg.players);
          const playersWithTimestamp: Record<string, Player> = {};
          Object.entries(msg.players).forEach(([id, player]) => {
            playersWithTimestamp[id] = { ...player, lastSeen: Date.now() };
          });
          setPlayers(playersWithTimestamp);
          if (Array.isArray(msg.chat)) {
            setChat(msg.chat.slice(-60));
          }
        } else if (msg.type === "player-joined") {
          console.log("[PartyKit] Player joined:", msg.player.id);
          setPlayers((prev) => ({
            ...prev,
            [msg.player.id]: { ...msg.player, lastSeen: Date.now() },
          }));
        } else if (msg.type === "player-moved") {
          setPlayers((prev) => {
            const player = prev[msg.id];
            if (!player) return prev;
            return {
              ...prev,
              [msg.id]: {
                ...player,
                position: msg.position,
                rotY: msg.rotY,
                lastSeen: Date.now(),
              },
            };
          });
        } else if (msg.type === "player-left") {
          console.log("[PartyKit] Player left:", msg.id);
          setPlayers((prev) => {
            const next = { ...prev };
            delete next[msg.id];
            return next;
          });
        } else if (msg.type === "chat") {
          setChat((prev) => {
            const next = [...prev, msg.message];
            if (next.length > 60) next.splice(0, next.length - 60);
            return next;
          });
        }
      } catch (err) {
        console.error("[PartyKit] Error parsing message:", err);
      }
    });

    socket.addEventListener("close", () => {
      console.log("[PartyKit] Disconnected");
      setConnected(false);
    });

    socket.addEventListener("error", (err) => {
      console.error("[PartyKit] Socket error:", err);
    });

    return () => {
      socket.close();
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
    connected,
    sendSelfState,
    sendChat,
    setName,
    setAvatarUrl,
    socketRef, // Expose for voice integration
  };
}
