"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PartySocket from "partysocket";

const PARTYKIT_HOST = process.env.NEXT_PUBLIC_PARTYKIT_HOST || "127.0.0.1:1999";
const DISCOVERY_ROOM = "room-discovery";
const MAX_PLAYERS = 16;

type RoomInfo = {
  roomId: string;
  playerCount: number;
  lastSeen: number;
};

type DiscoverSyncMsg = {
  type: "discover:sync";
  rooms: Record<string, { playerCount: number; lastSeen: number }>;
};

type DiscoverMsg = DiscoverSyncMsg;

// PartyKit-backed discovery. Allow callers to disable discovery when the UI
// doesn't need it (e.g., during gameplay).
//
// Back-compat: default is enabled.
export function useRoomDiscovery(): {
  rooms: Array<{ roomId: string; playerCount: number }>;
  allRooms: Array<{ roomId: string; playerCount: number }>;
  bestRoom: string;
  allRoomInfo: Record<string, RoomInfo>;
  setMyRoom: (roomId: string, playerCount: number) => void;
};
export function useRoomDiscovery(opts?: { enabled?: boolean }): {
  rooms: Array<{ roomId: string; playerCount: number }>;
  allRooms: Array<{ roomId: string; playerCount: number }>;
  bestRoom: string;
  allRoomInfo: Record<string, RoomInfo>;
  setMyRoom: (roomId: string, playerCount: number) => void;
};
export function useRoomDiscovery(opts?: { enabled?: boolean }) {
  const enabled = opts?.enabled ?? true;
  const [rooms, setRooms] = useState<Record<string, RoomInfo>>({});

  const myRoomRef = useRef<string | null>(null);
  const myPlayerCountRef = useRef<number>(1);
  const lastSentRef = useRef<{ roomId: string; playerCount: number } | null>(
    null
  );

  const socketRef = useRef<PartySocket | null>(null);
  const connectSeqRef = useRef(0);

  const setMyRoomAndCount = useCallback(
    (roomId: string, playerCount: number) => {
      myRoomRef.current = roomId;
      myPlayerCountRef.current = playerCount;

      const socket = socketRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        const next = { roomId, playerCount };
        const prev = lastSentRef.current;
        if (
          !prev ||
          prev.roomId !== next.roomId ||
          prev.playerCount !== next.playerCount
        ) {
          lastSentRef.current = next;
          try {
            socket.send(JSON.stringify({ type: "discover:update", ...next }));
          } catch {
            // ignore
          }
        }
      }
    },
    []
  );

  useEffect(() => {
    if (!enabled) {
      const prev = socketRef.current;
      if (prev) {
        try {
          prev.close();
        } catch {
          // ignore
        }
        socketRef.current = null;
      }
      setRooms({});
      return;
    }

    connectSeqRef.current += 1;
    const seq = connectSeqRef.current;

    const prev = socketRef.current;
    if (prev) {
      try {
        prev.close();
      } catch {
        // ignore
      }
      socketRef.current = null;
    }

    const socket = new PartySocket({
      host: PARTYKIT_HOST,
      room: DISCOVERY_ROOM,
    });
    socketRef.current = socket;

    const onOpen = () => {
      if (connectSeqRef.current !== seq) return;
      const roomId = myRoomRef.current;
      if (!roomId) return;
      const playerCount = myPlayerCountRef.current;
      const next = { roomId, playerCount };
      lastSentRef.current = next;
      try {
        socket.send(JSON.stringify({ type: "discover:update", ...next }));
      } catch {
        // ignore
      }
    };

    const onMessage = (event: MessageEvent) => {
      if (connectSeqRef.current !== seq) return;
      try {
        const msg = JSON.parse(event.data) as DiscoverMsg;
        if (msg.type !== "discover:sync") return;

        const now = Date.now();
        const next: Record<string, RoomInfo> = {};
        for (const [roomId, info] of Object.entries(msg.rooms || {})) {
          const playerCount = Math.max(0, info.playerCount || 0);
          const lastSeen = Number.isFinite(info.lastSeen) ? info.lastSeen : now;
          next[roomId] = { roomId, playerCount, lastSeen };
        }
        setRooms(next);
      } catch {
        // ignore
      }
    };

    socket.addEventListener("open", onOpen);
    socket.addEventListener("message", onMessage);

    // Lightweight heartbeat: does not touch React state.
    const heartbeat = window.setInterval(() => {
      if (connectSeqRef.current !== seq) return;
      const s = socketRef.current;
      if (!s || s.readyState !== WebSocket.OPEN) return;
      const roomId = myRoomRef.current;
      if (!roomId) return;
      const playerCount = myPlayerCountRef.current;
      const next = { roomId, playerCount };
      lastSentRef.current = next;
      try {
        s.send(JSON.stringify({ type: "discover:update", ...next }));
      } catch {
        // ignore
      }
    }, 8000);

    return () => {
      window.clearInterval(heartbeat);
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("message", onMessage);
      try {
        socket.close();
      } catch {
        // ignore
      }
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [enabled]);

  // Each peer reports its observed playerCount for a room. Multiple peers will
  // report the same room; using `max` avoids double-counting.
  const roomCounts = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const info of Object.values(rooms)) {
      acc[info.roomId] = Math.max(acc[info.roomId] || 0, info.playerCount || 0);
    }
    const myRoom = myRoomRef.current;
    if (myRoom) {
      acc[myRoom] = Math.max(acc[myRoom] || 0, myPlayerCountRef.current || 0);
    }
    return acc;
  }, [rooms]);

  const availableRooms = useMemo(() => {
    return Object.entries(roomCounts)
      .map(([roomId, count]) => ({ roomId, playerCount: count }))
      .filter((r) => r.playerCount < MAX_PLAYERS)
      .sort((a, b) => b.playerCount - a.playerCount);
  }, [roomCounts]);

  const bestRoom = useMemo(() => {
    let best = availableRooms[0]?.roomId;
    if (best) return best;

    const baseRoom = myRoomRef.current?.replace(/-ch\d+$/, "") || "main-room";

    const allChannels = Object.keys(roomCounts).map((roomId) => {
      const match = roomId.match(/^(.+?)-ch(\d+)$/);
      return match
        ? { base: match[1]!, channel: parseInt(match[2]!, 10) }
        : { base: roomId, channel: 0 };
    });

    const usedChannels = allChannels
      .filter((c) => c.base === baseRoom)
      .map((c) => c.channel)
      .filter((n) => Number.isFinite(n));

    const nextChannel = Math.max(0, ...usedChannels) + 1;
    return nextChannel === 0 ? baseRoom : `${baseRoom}-ch${nextChannel}`;
  }, [availableRooms, roomCounts]);

  // Group rooms by base name for UI display
  const allRoomsList = useMemo(() => {
    return Object.entries(roomCounts)
      .map(([roomId, count]) => ({ roomId, playerCount: count }))
      .sort((a, b) => {
        const aBase = a.roomId.replace(/-ch\d+$/, "");
        const bBase = b.roomId.replace(/-ch\d+$/, "");
        if (aBase !== bBase) return aBase.localeCompare(bBase);

        const aMatch = a.roomId.match(/-ch(\d+)$/);
        const bMatch = b.roomId.match(/-ch(\d+)$/);
        const aCh = aMatch ? parseInt(aMatch[1]!, 10) : 0;
        const bCh = bMatch ? parseInt(bMatch[1]!, 10) : 0;
        return aCh - bCh;
      });
  }, [roomCounts]);

  return {
    rooms: availableRooms,
    allRooms: allRoomsList,
    bestRoom,
    allRoomInfo: rooms,
    setMyRoom: setMyRoomAndCount,
  };
}
