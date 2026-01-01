"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { joinRoom } from "trystero/torrent";

type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json }
  | Json[];

type VoiceHello = {
  partyId: string;
  name?: string;
  t: number;
};

type TargetPeers = string | string[] | null;

type PeerAudio = {
  peerId: string;
  partyId?: string;
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
};

const VOICE_APP_ID = "pawnsquare-voice-v1";

type WebkitAudioWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

function getAudioContext(): AudioContext {
  const w = window as WebkitAudioWindow;
  const Ctx = window.AudioContext || w.webkitAudioContext;
  return new Ctx();
}

function getPartyIdFromMetadata(metadata: Json): string | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return undefined;
  }
  const value = (metadata as { partyId?: Json }).partyId;
  return typeof value === "string" ? value : undefined;
}

export function useProximityVoice(opts: {
  roomId: string;
  partySelfId?: string;
  selfName?: string;
}) {
  const { roomId, partySelfId, selfName } = opts;

  const roomRef = useRef<ReturnType<typeof joinRoom> | null>(null);
  const sendHelloRef = useRef<
    ((data: VoiceHello, targetPeers?: TargetPeers) => Promise<void[]>) | null
  >(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const peersRef = useRef<Map<string, PeerAudio>>(new Map());
  const partyIdToPeerIdRef = useRef<Map<string, string>>(new Map());

  const micStreamRef = useRef<MediaStream | null>(null);
  const micTrackRef = useRef<MediaStreamTrack | null>(null);

  const [micAvailable, setMicAvailable] = useState(false);
  const [micMuted, setMicMuted] = useState(true);
  const [lastError, setLastError] = useState<string | null>(null);
  const [peerCount, setPeerCount] = useState(0);

  const ensureAudio = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (!audioCtxRef.current) {
      audioCtxRef.current = getAudioContext();
    }
    const ctx = audioCtxRef.current;
    if (ctx.state !== "running") {
      try {
        await ctx.resume();
      } catch {
        // ignore
      }
    }
  }, []);

  const ensureMic = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (micStreamRef.current && micTrackRef.current) {
      setMicAvailable(true);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      const track = stream.getAudioTracks()[0] || null;
      if (!track) throw new Error("No audio track available");

      micStreamRef.current = stream;
      micTrackRef.current = track;
      track.enabled = !micMuted;

      setMicAvailable(true);

      const room = roomRef.current;
      if (room) {
        // Send the stream to everyone currently connected.
        void room.addStream(stream, undefined, {
          partyId: partySelfId ?? null,
          kind: "mic",
        });
      }
    } catch (e) {
      console.error("[voice] getUserMedia failed", e);
      setLastError(
        e instanceof Error ? e.message : "Failed to access microphone"
      );
      setMicAvailable(false);
      throw e;
    }
  }, [micMuted, partySelfId]);

  // Keep the underlying track enabled state consistent with micMuted.
  useEffect(() => {
    const track = micTrackRef.current;
    if (track) track.enabled = !micMuted;
  }, [micMuted]);

  const toggleMic = useCallback(async () => {
    await ensureAudio();

    const nextMuted = !micMuted;
    setMicMuted(nextMuted);

    // If unmuting for the first time, request permission.
    if (nextMuted === false) {
      try {
        await ensureMic();
      } catch {
        // If we fail to get a mic, revert to muted.
        setMicMuted(true);
        return;
      }
    }

    const track = micTrackRef.current;
    if (track) track.enabled = !nextMuted;
  }, [ensureAudio, ensureMic, micMuted]);

  const setRemoteGainForPartyId = useCallback((partyId: string, gain: number) => {
    const peerId = partyIdToPeerIdRef.current.get(partyId);
    if (!peerId) return;
    const peer = peersRef.current.get(peerId);
    if (!peer) return;
    peer.gain.gain.value = gain;
  }, []);

  const setRemoteGainForPeerId = useCallback((peerId: string, gain: number) => {
    const peer = peersRef.current.get(peerId);
    if (!peer) return;
    peer.gain.gain.value = gain;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const peers = peersRef.current;
    const partyIdToPeerId = partyIdToPeerIdRef.current;

    const room = joinRoom(
      {
        appId: VOICE_APP_ID,
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

    const [sendHello, onHello] = room.makeAction<VoiceHello>("voice:hello");
    sendHelloRef.current = sendHello;

    const sendMyHello = (target?: string) => {
      if (!partySelfId) return;
      const payload: VoiceHello = {
        partyId: partySelfId,
        name: selfName,
        t: Date.now(),
      };
      try {
        void sendHello(payload, target);
      } catch {
        // ignore
      }
    };

    onHello((data: unknown, peerId: string) => {
      const payload = (data ?? null) as VoiceHello | null;
      const pid = payload?.partyId;
      if (!pid) return;

      partyIdToPeerId.set(pid, peerId);
      const peer = peers.get(peerId);
      if (peer) peer.partyId = pid;
    });

    room.onPeerJoin((peerId) => {
      setPeerCount((c) => c + 1);
      sendMyHello(peerId);

      // If we already have mic permission, ensure new peers get the stream.
      const stream = micStreamRef.current;
      if (stream) {
        void room.addStream(stream, peerId, {
          partyId: partySelfId ?? null,
          kind: "mic",
        });
      }
    });

    room.onPeerLeave((peerId) => {
      setPeerCount((c) => Math.max(0, c - 1));
      const peer = peers.get(peerId);
      if (peer) {
        try {
          peer.source.disconnect();
          peer.gain.disconnect();
        } catch {
          // ignore
        }
        peers.delete(peerId);
      }

      // Remove partyId mapping if present.
      for (const [pid, mappedPeerId] of partyIdToPeerId.entries()) {
        if (mappedPeerId === peerId) {
          partyIdToPeerId.delete(pid);
        }
      }
    });

    room.onPeerStream((stream, peerId, metadata: Json) => {
      // Lazily create audio context; try to resume on first stream.
      void ensureAudio();

      const ctx = audioCtxRef.current;
      if (!ctx) return;

      // Only one audio pipeline per peer.
      if (peers.has(peerId)) return;

      try {
        const source = ctx.createMediaStreamSource(stream);
        const gain = ctx.createGain();
        gain.gain.value = 1;
        source.connect(gain);
        gain.connect(ctx.destination);

        const existingPartyId = getPartyIdFromMetadata(metadata);
        if (existingPartyId) {
          partyIdToPeerId.set(existingPartyId, peerId);
        }

        peers.set(peerId, {
          peerId,
          partyId: existingPartyId,
          stream,
          source,
          gain,
        });
      } catch (e) {
        console.error("[voice] failed to attach stream", e);
      }
    });

    // Broadcast our party-id mapping (if we already have it)
    sendMyHello();

    return () => {
      sendHelloRef.current = null;

      // Stop mic
      try {
        micTrackRef.current?.stop();
      } catch {
        // ignore
      }
      micTrackRef.current = null;
      micStreamRef.current = null;

      // Disconnect peer nodes
      for (const peer of peers.values()) {
        try {
          peer.source.disconnect();
          peer.gain.disconnect();
        } catch {
          // ignore
        }
      }
      peers.clear();
      partyIdToPeerId.clear();
      setPeerCount(0);

      // Close audio context
      if (audioCtxRef.current) {
        try {
          void audioCtxRef.current.close();
        } catch {
          // ignore
        }
        audioCtxRef.current = null;
      }

      // Leave room
      void room.leave();
      roomRef.current = null;
    };
  }, [ensureAudio, partySelfId, roomId, selfName]);

  // If our PartyKit id becomes available later, re-announce it.
  useEffect(() => {
    const sendHello = sendHelloRef.current;
    if (!sendHello) return;
    if (!partySelfId) return;
    try {
      void sendHello({ partyId: partySelfId, name: selfName, t: Date.now() });
    } catch {
      // ignore
    }
  }, [partySelfId, selfName]);

  // Unlock audio on the first user gesture (autoplay policies).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onGesture = () => {
      void ensureAudio();
    };
    window.addEventListener("pointerdown", onGesture, { once: true });
    window.addEventListener("keydown", onGesture, { once: true });
    return () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
  }, [ensureAudio]);

  return {
    micAvailable,
    micMuted,
    lastError,
    peerCount,
    toggleMic,
    ensureMic,
    ensureAudio,
    setRemoteGainForPartyId,
    setRemoteGainForPeerId,
  };
}
