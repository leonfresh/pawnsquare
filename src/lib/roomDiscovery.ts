"use client";

import { useEffect, useState } from "react";
import { joinRoom, selfId as trysteroSelfId } from "trystero/torrent";

const APP_ID = "pawnsquare-v2";
const DISCOVERY_ROOM = "room-discovery";
const MAX_PLAYERS = 20;

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
    
    const [sendRoomInfo, onRoomInfo] = room.makeAction<{ roomId: string; playerCount: number }>("roomInfo");

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
        console.log(`[RoomDiscovery] Broadcasting: room=${myRoom}, players=${myPlayerCount}`);
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

  const roomCounts = Object.values(rooms).reduce((acc, info) => {
    acc[info.roomId] = (acc[info.roomId] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const availableRooms = Object.entries(roomCounts)
    .map(([roomId, count]) => ({ roomId, playerCount: count }))
    .filter((r) => r.playerCount < MAX_PLAYERS)
    .sort((a, b) => b.playerCount - a.playerCount);

  const bestRoom = availableRooms[0]?.roomId || "room-1";

  return {
    rooms: availableRooms,
    bestRoom,
    allRoomInfo: rooms,
    setMyRoom: setMyRoomAndCount,
  };
}
