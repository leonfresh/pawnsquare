"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { joinRoom } from "trystero/torrent";

type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

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
  const [micDeviceLabel, setMicDeviceLabel] = useState<string>("");
  const [lastError, setLastError] = useState<string | null>(null);
  const [peerCount, setPeerCount] = useState(0);
  const [remoteStreamCount, setRemoteStreamCount] = useState(0);

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

      const deviceLabel = track.label || "Unknown Microphone";
      console.log("[voice] ✓ Mic acquired:", {
        label: deviceLabel,
        id: track.id,
        enabled: track.enabled,
        muted: track.muted,
        readyState: track.readyState,
      });

      micStreamRef.current = stream;
      micTrackRef.current = track;
      track.enabled = !micMuted;
      setMicDeviceLabel(deviceLabel);
      setMicAvailable(true);

      const room = roomRef.current;
      if (room) {
        console.log("[voice] Broadcasting mic track to all peers (addTrack)");
        // Use addTrack for more reliable audio transmission
        const promises = room.addTrack(track, stream, undefined, {
          partyId: partySelfId ?? null,
          kind: "mic",
        });
        console.log("[voice] addTrack returned", promises.length, "promises");
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
    if (track) {
      track.enabled = !micMuted;
      console.log("[voice] Track enabled state:", {
        enabled: track.enabled,
        muted: micMuted,
        readyState: track.readyState,
      });
    }
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

  const setRemoteGainForPartyId = useCallback(
    (partyId: string, gain: number) => {
      const peerId = partyIdToPeerIdRef.current.get(partyId);
      if (!peerId) return;
      const peer = peersRef.current.get(peerId);
      if (!peer) return;
      peer.gain.gain.value = gain;
    },
    []
  );

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

    console.log("[voice] Voice room initialized for roomId:", roomId);

    // If the user granted mic permission before the room finished booting,
    // broadcast the existing stream now.
    const existingMic = micStreamRef.current;
    const existingTrack = micTrackRef.current;
    if (existingMic && existingTrack) {
      console.log("[voice] Room ready; broadcasting existing mic track");
      const promises = room.addTrack(existingTrack, existingMic, undefined, {
        partyId: partySelfId ?? null,
        kind: "mic",
      });
      console.log("[voice] Broadcasted to", promises.length, "existing peers");
    }

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
      console.log("[voice] ✓ Peer joined:", peerId);
      sendMyHello(peerId);

      // If we already have mic permission, ensure new peers get the track.
      const stream = micStreamRef.current;
      const track = micTrackRef.current;
      if (stream && track) {
        console.log("[voice] → Sending mic track to peer:", peerId, {
          trackId: track.id,
          trackEnabled: track.enabled,
          trackReadyState: track.readyState,
        });
        const promises = room.addTrack(track, stream, peerId, {
          partyId: partySelfId ?? null,
          kind: "mic",
        });
        console.log("[voice] addTrack promise count:", promises.length);
      } else {
        console.log("[voice] ⚠ No mic track to send to", peerId);
      }
    });

    room.onPeerLeave((peerId) => {
      setPeerCount((c) => Math.max(0, c - 1));
      console.log("[voice] peer left", peerId);
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

    // Handle incoming audio tracks from peers
    room.onPeerTrack((track, stream, peerId, metadata: Json) => {
      if (track.kind !== "audio") {
        console.log("[voice] ⚠ Ignoring non-audio track:", track.kind);
        return;
      }

      console.log("[voice] ← Received audio track from peer:", peerId, {
        trackId: track.id,
        trackLabel: track.label,
        trackEnabled: track.enabled,
        trackMuted: track.muted,
        trackReadyState: track.readyState,
        streamId: stream.id,
        metadata,
      });

      // Lazily create audio context; try to resume on first track.
      void ensureAudio();

      const ctx = audioCtxRef.current;
      if (!ctx) {
        console.error("[voice] No audio context available");
        return;
      }

      // Only one audio pipeline per peer.
      if (peers.has(peerId)) {
        console.log("[voice] ⚠ Already have audio for peer", peerId);
        return;
      }

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

        setRemoteStreamCount((c) => c + 1);
        console.log("[voice] ✓ Audio pipeline created for peer:", peerId, {
          partyId: existingPartyId,
          gainValue: gain.gain.value,
        });
      } catch (e) {
        console.error("[voice] ✗ Failed to attach audio:", e);
      }
    });

    // Also keep onPeerStream as fallback (some browsers might send streams)
    room.onPeerStream((stream, peerId, metadata: Json) => {
      console.log("[voice] ← Received peer stream (fallback):", peerId);
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        console.log("[voice] ⚠ Stream has no audio tracks");
        return;
      }

      // If we don't already have this peer, set up audio
      if (peers.has(peerId)) return;

      void ensureAudio();
      const ctx = audioCtxRef.current;
      if (!ctx) return;

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

        setRemoteStreamCount((c) => c + 1);
        console.log("[voice] ✓ Audio from stream (fallback):", peerId);
      } catch (e) {
        console.error("[voice] ✗ Stream fallback failed:", e);
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
      setRemoteStreamCount(0);

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
    micDeviceLabel,
    lastError,
    peerCount,
    remoteStreamCount,
    toggleMic,
    ensureMic,
    ensureAudio,
    setRemoteGainForPartyId,
    setRemoteGainForPeerId,
  };
}
