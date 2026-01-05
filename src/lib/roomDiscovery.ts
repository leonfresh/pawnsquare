"use client";

import { useEffect, useState } from "react";
import { joinRoom, selfId as trysteroSelfId } from "trystero/torrent";

const APP_ID = "pawnsquare-v2";
const DISCOVERY_ROOM = "room-discovery";
const MAX_PLAYERS = 16;

type RoomInfo = {
  roomId: string;
  playerCount: number;
  lastSeen: number;
};

export function useRoomDiscovery() {
  const [rooms, setRooms] = useState<Record<string, RoomInfo>>({});
  const [myRoom, setMyRoom] = useState<string | null>(null);
  const [myPlayerCount, setMyPlayerCount] = useState<number>(1);

  const setMyRoomAndCount = (roomId: string, playerCount: number) => {
    setMyRoom(roomId);
    setMyPlayerCount(playerCount);
  };

  useEffect(() => {
    console.log("[RoomDiscovery] Joining discovery room");
    const room = joinRoom({ appId: APP_ID }, DISCOVERY_ROOM);

    const [sendRoomInfo, onRoomInfo] = room.makeAction<{
      roomId: string;
      playerCount: number;
    }>("roomInfo");

    onRoomInfo((data: unknown, peerId: string) => {
      const info = data as { roomId: string; playerCount: number };
      if (!info || !info.roomId) return;

      console.log(`[RoomDiscovery] Received room info from ${peerId}:`, info);
      setRooms((prev) => ({
        ...prev,
        [peerId]: {
          roomId: info.roomId,
          playerCount: info.playerCount,
          lastSeen: Date.now(),
        },
      }));
    });

    room.onPeerLeave((peerId: string) => {
      console.log(`[RoomDiscovery] Peer left discovery: ${peerId}`);
      setRooms((prev) => {
        const next = { ...prev };
        delete next[peerId];
        return next;
      });
    });

    // Broadcast our room info every 3 seconds
    const interval = setInterval(() => {
      if (myRoom) {
        console.log(
          `[RoomDiscovery] Broadcasting: room=${myRoom}, players=${myPlayerCount}`
        );
        sendRoomInfo({ roomId: myRoom, playerCount: myPlayerCount });
      }
    }, 3000);

    // Clean up stale entries
    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      setRooms((prev) => {
        const next = { ...prev };
        for (const [peerId, info] of Object.entries(next)) {
          if (now - info.lastSeen > 10000) {
            delete next[peerId];
          }
        }
        return next;
      });
    }, 5000);

    return () => {
      clearInterval(interval);
      clearInterval(cleanupInterval);
      room.leave();
    };
  }, [myRoom, myPlayerCount]);

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
