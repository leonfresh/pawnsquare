"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { joinRoom, selfId as trysteroSelfId } from "trystero/torrent";
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

type HelloPayload = { name: string; color: string; gender: "male" | "female"; avatarUrl?: string };
type StatePayload = { p: Vec3; r: number };

const APP_ID = "pawnsquare-v2";
const MAX_PLAYERS_PER_ROOM = 20;

function defaultName(selfId: string) {
  return `Player-${selfId.slice(0, 4)}`;
}

export function useP2PRoom(roomId: string, opts?: { initialName?: string; initialGender?: "male" | "female" }) {
  const roomRef = useRef<ReturnType<typeof joinRoom> | null>(null);
  const sendStateRef = useRef<
    ((data: any, targetPeers?: any) => Promise<any>) | null
  >(null);
  const sendHelloRef = useRef<
    ((data: any, targetPeers?: any) => Promise<any>) | null
  >(null);
  const selfNameRef = useRef<string>("");
  const selfGenderRef = useRef<"male" | "female">("male");
  const selfAvatarUrlRef = useRef<string | undefined>(undefined);
  const [selfId, setSelfId] = useState<string>("");
  const [selfName, setSelfName] = useState<string>("");
  const [selfGender, setSelfGender] = useState<"male" | "female">("male");
  const [selfAvatarUrl, setSelfAvatarUrl] = useState<string | undefined>(undefined);
  const [players, setPlayers] = useState<Record<string, Player>>({});

  console.log(`[P2P] useP2PRoom init - selfId: ${trysteroSelfId || '(not set)'}`);

  const self = useMemo(() => {
    if (!selfId) return null;
    return {
      id: selfId,
      name: selfName || defaultName(selfId),
      color: colorFromId(selfId),
      gender: selfGender,
      avatarUrl: selfAvatarUrl,
    };
  }, [selfId, selfName, selfGender, selfAvatarUrl]);

  useEffect(() => {
    console.log(`[P2P] Joining room: ${roomId}`);
    const room = joinRoom(
      { 
        appId: APP_ID,
        rtcConfig: {
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
          ],
        },
      }, 
      roomId
    );
    roomRef.current = room;
    setSelfId(trysteroSelfId);
    console.log(`[P2P] Self ID set: ${trysteroSelfId}`);
    {
      const initial = (opts?.initialName ?? "").trim().slice(0, 24);
      selfNameRef.current = initial;
      setSelfName(initial);
      const gender = opts?.initialGender ?? "male";
      selfGenderRef.current = gender;
      setSelfGender(gender);
    }

    const [sendHello, onHello] = room.makeAction<HelloPayload>("hello");
    const [sendState, onState] = room.makeAction<StatePayload>("state");
    sendStateRef.current = sendState;
    sendHelloRef.current = sendHello;

    const ensurePlayer = (id: string, patch: Partial<Player> = {}) => {
      setPlayers((prev) => {
        const existing = prev[id];
        const base: Player =
          existing ??
          ({
            id,
            name: defaultName(id),
            color: colorFromId(id),
            gender: "male",
            position: [0, 0.5, 0],
            rotY: 0,
            lastSeen: Date.now(),
          } satisfies Player);

        return {
          ...prev,
          [id]: {
            ...base,
            ...patch,
            lastSeen: Date.now(),
          },
        };
      });
    };

    onHello((data: unknown, peerId: string) => {
      const payload = (data ?? null) as HelloPayload | null;
      console.log(`[P2P] Received hello from ${peerId}:`, payload);
      ensurePlayer(peerId, {
        name: payload?.name ?? defaultName(peerId),
        color: payload?.color ?? colorFromId(peerId),
        gender: payload?.gender ?? "male",
        avatarUrl: payload?.avatarUrl,
      });
    });

    onState((data: unknown, peerId: string) => {
      const payload = (data ?? null) as StatePayload | null;
      if (!payload) return;
      ensurePlayer(peerId, {
        position: payload.p,
        rotY: payload.r,
      });
    });

    room.onPeerJoin((peerId: string) => {
      console.log(`[P2P] Peer joined: ${peerId}`);
      ensurePlayer(peerId);
      // greet the new peer with our identity; they will do the same
      const name = selfNameRef.current || defaultName(trysteroSelfId);
      const helloPayload = {
        name,
        color: colorFromId(trysteroSelfId),
        gender: selfGenderRef.current,
        avatarUrl: selfAvatarUrlRef.current,
      } satisfies HelloPayload;
      console.log(`[P2P] Sending hello to ${peerId}:`, helloPayload);
      sendHello(helloPayload, peerId);
    });

    room.onPeerLeave((peerId: string) => {
      console.log(`[P2P] Peer left: ${peerId}`);
      setPlayers((prev) => {
        const next = { ...prev };
        delete next[peerId];
        return next;
      });
    });

    // announce ourselves to everyone already in the room
    // (works even if 0 peers; harmless)
    {
      const name = selfNameRef.current || defaultName(trysteroSelfId);
      const helloPayload = {
        name,
        color: colorFromId(trysteroSelfId),
        gender: selfGenderRef.current,
        avatarUrl: selfAvatarUrlRef.current,
      } satisfies HelloPayload;
      console.log(`[P2P] Broadcasting initial hello:`, helloPayload);
      sendHello(helloPayload);
    }

    return () => {
      console.log(`[P2P] Leaving room: ${roomId}`);
      room.leave();
      roomRef.current = null;
      sendStateRef.current = null;
      sendHelloRef.current = null;
    };
  }, [roomId]);

  const setName = useCallback((name: string) => {
    const cleaned = name.trim().slice(0, 24);
    selfNameRef.current = cleaned;
    setSelfName(cleaned);
    const sendHello = sendHelloRef.current;
    if (!sendHello) return;
    void sendHello({
      name: cleaned || defaultName(trysteroSelfId),
      color: colorFromId(trysteroSelfId),
      gender: selfGenderRef.current,
      avatarUrl: selfAvatarUrlRef.current,
    } satisfies HelloPayload);
  }, []);

  const setAvatarUrl = useCallback((url: string | undefined) => {
    selfAvatarUrlRef.current = url;
    setSelfAvatarUrl(url);
    const sendHello = sendHelloRef.current;
    if (!sendHello) return;
    const name = selfNameRef.current || defaultName(trysteroSelfId);
    void sendHello({
      name,
      color: colorFromId(trysteroSelfId),
      gender: selfGenderRef.current,
      avatarUrl: url,
    } satisfies HelloPayload);
  }, []);

  const sendSelfState = useCallback((position: Vec3, rotY: number) => {
    const sendState = sendStateRef.current;
    if (!sendState) return;
    void sendState({ p: position, r: rotY } satisfies StatePayload);
  }, []);

  const peerCount = useMemo(() => Object.keys(players).length, [players]);

  return {
    self,
    players,
    peerCount,
    sendSelfState,
    setName,
    setAvatarUrl,
  };
}
