"use client";

import { useEffect, useRef, useState } from "react";
import { joinRoom } from "trystero/torrent";

const APP_ID = "pawnsquare-v2";
const DISCOVERY_ROOM = "room-discovery";
const MAX_PLAYERS = 16;

type RoomInfo = {
  roomId: string;
  playerCount: number;
  lastSeen: number;
};

// Trystero/torrent (WebTorrent) can do periodic work (tracker retries, etc.)
// that shows up as long main-thread tasks in dev. Allow callers to disable
// discovery when the UI doesn't need it (e.g., during gameplay).
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
  const [myRoom, setMyRoom] = useState<string | null>(null);
  const [myPlayerCount, setMyPlayerCount] = useState<number>(1);

  // Keep fast-changing values out of React state to avoid re-rendering the
  // entire 3D world on every discovery heartbeat.
  const myRoomRef = useRef<string | null>(null);
  const myPlayerCountRef = useRef<number>(1);
  const peerLastSeenRef = useRef<Map<string, number>>(new Map());
  const peerStableInfoRef = useRef<
    Map<string, { roomId: string; playerCount: number }>
  >(new Map());

  const setMyRoomAndCount = (roomId: string, playerCount: number) => {
    myRoomRef.current = roomId;
    myPlayerCountRef.current = playerCount;

    // Only update React state if values actually changed.
    setMyRoom((prev) => (prev === roomId ? prev : roomId));
    setMyPlayerCount((prev) => (prev === playerCount ? prev : playerCount));
  };

  useEffect(() => {
    if (!enabled) {
      // Stop discovery work entirely when disabled.
      return;
    }
    const room = joinRoom({ appId: APP_ID }, DISCOVERY_ROOM);

    const [sendRoomInfo, onRoomInfo] = room.makeAction<{
      roomId: string;
      playerCount: number;
    }>("roomInfo");

    onRoomInfo((data: unknown, peerId: string) => {
      const info = data as { roomId: string; playerCount: number };
      if (!info || !info.roomId) return;

      const now = Date.now();
      peerLastSeenRef.current.set(peerId, now);

      const prevStable = peerStableInfoRef.current.get(peerId);
      const nextStable = {
        roomId: info.roomId,
        playerCount: info.playerCount,
      };

      // Heartbeats arrive frequently (every ~3s per peer). If nothing changed,
      // don't update React state (avoids periodic world-wide re-render hitches).
      if (
        prevStable &&
        prevStable.roomId === nextStable.roomId &&
        prevStable.playerCount === nextStable.playerCount
      ) {
        return;
      }

      peerStableInfoRef.current.set(peerId, nextStable);
      setRooms((prev) => ({
        ...prev,
        [peerId]: {
          roomId: nextStable.roomId,
          playerCount: nextStable.playerCount,
          lastSeen: now,
        },
      }));
    });

    room.onPeerLeave((peerId: string) => {
      peerLastSeenRef.current.delete(peerId);
      peerStableInfoRef.current.delete(peerId);
      setRooms((prev) => {
        const next = { ...prev };
        delete next[peerId];
        return next;
      });
    });

    // Broadcast our room info every 3 seconds
    const interval = setInterval(() => {
      const roomId = myRoomRef.current;
      if (roomId) {
        sendRoomInfo({
          roomId,
          playerCount: myPlayerCountRef.current,
        });
      }
    }, 3000);

    // Clean up stale entries
    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      const toDelete: string[] = [];
      for (const [peerId, lastSeen] of peerLastSeenRef.current.entries()) {
        if (now - lastSeen > 10000) {
          toDelete.push(peerId);
        }
      }

      if (toDelete.length === 0) return;
      for (const peerId of toDelete) {
        peerLastSeenRef.current.delete(peerId);
        peerStableInfoRef.current.delete(peerId);
      }
      setRooms((prev) => {
        const next = { ...prev };
        for (const peerId of toDelete) {
          delete next[peerId];
        }
        return next;
      });
    }, 5000);

    return () => {
      clearInterval(interval);
      clearInterval(cleanupInterval);
      room.leave();
    };
  }, [enabled]);

  // Each peer reports its observed playerCount for a room. Multiple peers will
  // report the same room; using `max` avoids double-counting.
  const roomCounts = Object.values(rooms).reduce((acc, info) => {
    acc[info.roomId] = Math.max(acc[info.roomId] || 0, info.playerCount || 0);
    return acc;
  }, {} as Record<string, number>);

  // Also include *our* current room so the UI shows at least one channel even
  // when we're the first/only person there (discovery is peer-reported).
  if (myRoom) {
    roomCounts[myRoom] = Math.max(roomCounts[myRoom] || 0, myPlayerCount || 0);
  }

  const availableRooms = Object.entries(roomCounts)
    .map(([roomId, count]) => ({ roomId, playerCount: count }))
    .filter((r) => r.playerCount < MAX_PLAYERS)
    .sort((a, b) => b.playerCount - a.playerCount);

  // Find the best available room, or create a new channel if all are full
  let bestRoom = availableRooms[0]?.roomId;
  if (!bestRoom) {
    // All rooms are full, find the next available channel number
    const allChannels = Object.values(rooms).map((r) => {
      const match = r.roomId.match(/^(.+?)-ch(\d+)$/);
      return match
        ? { base: match[1], channel: parseInt(match[2]) }
        : { base: r.roomId, channel: 0 };
    });

    const baseRoom = myRoom?.replace(/-ch\d+$/, "") || "main-room";
    const usedChannels = allChannels
      .filter((c) => c.base === baseRoom)
      .map((c) => c.channel);

    const nextChannel = Math.max(0, ...usedChannels) + 1;
    bestRoom = nextChannel === 0 ? baseRoom : `${baseRoom}-ch${nextChannel}`;
  }

  // Group rooms by base name for UI display
  const allRoomsList = Object.entries(roomCounts)
    .map(([roomId, count]) => ({ roomId, playerCount: count }))
    .sort((a, b) => {
      // Sort by base room name, then by channel number
      const aBase = a.roomId.replace(/-ch\d+$/, "");
      const bBase = b.roomId.replace(/-ch\d+$/, "");
      if (aBase !== bBase) return aBase.localeCompare(bBase);

      const aMatch = a.roomId.match(/-ch(\d+)$/);
      const bMatch = b.roomId.match(/-ch(\d+)$/);
      const aCh = aMatch ? parseInt(aMatch[1]) : 0;
      const bCh = bMatch ? parseInt(bMatch[1]) : 0;
      return aCh - bCh;
    });

  return {
    rooms: availableRooms,
    allRooms: allRoomsList,
    bestRoom,
    allRoomInfo: rooms,
    setMyRoom: setMyRoomAndCount,
  };
}
