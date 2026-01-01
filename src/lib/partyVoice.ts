"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type PartySocket from "partysocket";

type WebkitAudioWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

function getAudioContext(): AudioContext {
  const w = window as WebkitAudioWindow;
  const Ctx = window.AudioContext || w.webkitAudioContext;
  return new Ctx();
}

type PeerConnection = {
  pc: RTCPeerConnection;
  stream?: MediaStream;
  source?: MediaStreamAudioSourceNode;
  gain?: GainNode;
};

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

export function usePartyVoice(opts: {
  socketRef: React.RefObject<PartySocket | null>;
  selfId: string | null;
  onRemoteGainForPeerId: (peerId: string, gain: GainNode | null) => void;
}) {
  const { socketRef, selfId, onRemoteGainForPeerId } = opts;
  const socket = socketRef.current;

  const audioCtxRef = useRef<AudioContext | null>(null);
  const peersRef = useRef<Map<string, PeerConnection>>(new Map());
  const micStreamRef = useRef<MediaStream | null>(null);
  const micTrackRef = useRef<MediaStreamTrack | null>(null);
  const onRemoteGainRef = useRef(onRemoteGainForPeerId);
  const pendingTracksRef = useRef<Map<string, MediaStream>>(new Map());

  // Keep callback ref updated
  useEffect(() => {
    onRemoteGainRef.current = onRemoteGainForPeerId;
  }, [onRemoteGainForPeerId]);

  const [micAvailable, setMicAvailable] = useState(false);
  const [micMuted, setMicMuted] = useState(true);
  const [micDeviceLabel, setMicDeviceLabel] = useState<string>("");
  const [peerCount, setPeerCount] = useState(0);
  const [remoteStreamCount, setRemoteStreamCount] = useState(0);

  const ensureAudio = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (!audioCtxRef.current) {
      audioCtxRef.current = getAudioContext();
      console.log("[party-voice] ✓ AudioContext created");
    }
    const ctx = audioCtxRef.current;
    if (ctx.state !== "running") {
      try {
        await ctx.resume();
        console.log("[party-voice] ✓ AudioContext resumed from", ctx.state);
      } catch {
        // ignore
      }
    }
    
    // Process any pending tracks now that AudioContext is ready
    if (ctx.state === "running" && pendingTracksRef.current.size > 0) {
      console.log("[party-voice] Processing", pendingTracksRef.current.size, "pending tracks");
      const pending = Array.from(pendingTracksRef.current.entries());
      pendingTracksRef.current.clear();
      
      for (const [peerId, stream] of pending) {
        const conn = peersRef.current.get(peerId);
        if (!conn || conn.stream) continue; // Skip if already processed
        
        try {
          const source = ctx.createMediaStreamSource(stream);
          const gain = ctx.createGain();
          gain.gain.value = 1;
          source.connect(gain);
          gain.connect(ctx.destination);

          conn.stream = stream;
          conn.source = source;
          conn.gain = gain;

          console.log("[party-voice] ✓ Audio pipeline created for pending", peerId);
          onRemoteGainRef.current(peerId, gain);
        } catch (err) {
          console.warn("[party-voice] Failed to create audio pipeline for", peerId, err);
        }
      }
      
      // Update stream count
      const streamCount = Array.from(peersRef.current.values()).filter(
        (c) => c.stream
      ).length;
      setRemoteStreamCount(streamCount);
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
      console.log("[party-voice] ✓ Mic acquired:", {
        label: deviceLabel,
        id: track.id,
        enabled: track.enabled,
        readyState: track.readyState,
      });

      micStreamRef.current = stream;
      micTrackRef.current = track;
      track.enabled = !micMuted;
      setMicDeviceLabel(deviceLabel);
      setMicAvailable(true);

      // Add track to all existing peer connections
      for (const [peerId, conn] of peersRef.current.entries()) {
        console.log("[party-voice] Adding mic track to existing peer:", peerId);
        conn.pc.addTrack(track, stream);
      }
    } catch (e) {
      console.error("[party-voice] getUserMedia failed", e);
      setMicAvailable(false);
      throw e;
    }
  }, [micMuted]);

  const toggleMic = useCallback(async () => {
    await ensureAudio();

    const nextMuted = !micMuted;
    setMicMuted(nextMuted);

    if (nextMuted === false) {
      try {
        await ensureMic();
      } catch {
        setMicMuted(true);
        return;
      }
    }

    const track = micTrackRef.current;
    if (track) {
      track.enabled = !nextMuted;
      console.log("[party-voice] Track enabled:", !nextMuted);
    }
  }, [ensureAudio, ensureMic, micMuted]);

  const createPeerConnection = useCallback(
    (peerId: string): RTCPeerConnection => {
      const pc = new RTCPeerConnection(RTC_CONFIG);

      pc.onicecandidate = (event) => {
        if (event.candidate && socket) {
          socket.send(
            JSON.stringify({
              type: "voice:ice",
              to: peerId,
              candidate: event.candidate,
            })
          );
        }
      };

      pc.ontrack = async (event) => {
        console.log("[party-voice] ← Received track from", peerId, {
          kind: event.track.kind,
          id: event.track.id,
        });

        if (event.track.kind !== "audio") return;

        const stream = event.streams[0] || new MediaStream([event.track]);
        const ctx = audioCtxRef.current;
        
        // If AudioContext not ready or suspended, store track for later
        if (!ctx || ctx.state !== "running") {
          console.log("[party-voice] ⏸️ Storing track for", peerId, "until AudioContext ready");
          pendingTracksRef.current.set(peerId, stream);
          return;
        }

        const conn = peersRef.current.get(peerId);
        if (!conn) return;

        try {
          const source = ctx.createMediaStreamSource(stream);
          const gain = ctx.createGain();
          gain.gain.value = 1;
          source.connect(gain);
          gain.connect(ctx.destination);

          conn.stream = stream;
          conn.source = source;
          conn.gain = gain;

          setRemoteStreamCount((c) => c + 1);
          onRemoteGainRef.current(peerId, gain);

          console.log("[party-voice] ✓ Audio pipeline for", peerId);
        } catch (e) {
          console.error("[party-voice] Failed to attach audio:", e);
        }
      };

      pc.onconnectionstatechange = () => {
        console.log(
          "[party-voice] Connection state:",
          peerId,
          pc.connectionState
        );
        if (
          pc.connectionState === "failed" ||
          pc.connectionState === "closed"
        ) {
          cleanup(peerId);
        }
      };

      // Add mic track if we already have it
      const track = micTrackRef.current;
      const stream = micStreamRef.current;
      if (track && stream) {
        console.log("[party-voice] Adding mic track to new peer:", peerId);
        pc.addTrack(track, stream);
      }

      return pc;
    },
    [ensureAudio, socket]
  );

  const cleanup = useCallback((peerId: string) => {
    const conn = peersRef.current.get(peerId);
    if (!conn) return;

    try {
      conn.source?.disconnect();
      conn.gain?.disconnect();
      conn.pc.close();
    } catch (e) {
      console.error("[party-voice] Cleanup error:", e);
    }

    peersRef.current.delete(peerId);
    setPeerCount((c) => Math.max(0, c - 1));
    if (conn.stream) {
      setRemoteStreamCount((c) => Math.max(0, c - 1));
    }
    onRemoteGainRef.current(peerId, null);
  }, []);

  const handleOffer = useCallback(
    async (from: string, offer: RTCSessionDescriptionInit) => {
      console.log("[party-voice] ← Received offer from", from);

      let pc = peersRef.current.get(from)?.pc;
      if (!pc) {
        pc = createPeerConnection(from);
        peersRef.current.set(from, { pc });
        setPeerCount((c) => c + 1);
      }

      try {
        await pc.setRemoteDescription(offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        if (socket) {
          socket.send(
            JSON.stringify({
              type: "voice:answer",
              to: from,
              answer,
            })
          );
          console.log("[party-voice] → Sent answer to", from);
        }
      } catch (e) {
        console.error("[party-voice] Failed to handle offer:", e);
      }
    },
    [createPeerConnection, socket]
  );

  const handleAnswer = useCallback(
    async (from: string, answer: RTCSessionDescriptionInit) => {
      console.log("[party-voice] ← Received answer from", from);

      const conn = peersRef.current.get(from);
      if (!conn) return;

      try {
        await conn.pc.setRemoteDescription(answer);
      } catch (e) {
        console.error("[party-voice] Failed to set answer:", e);
      }
    },
    []
  );

  const handleIceCandidate = useCallback(
    async (from: string, candidate: RTCIceCandidateInit) => {
      const conn = peersRef.current.get(from);
      if (!conn) return;

      try {
        await conn.pc.addIceCandidate(candidate);
      } catch (e) {
        console.error("[party-voice] Failed to add ICE candidate:", e);
      }
    },
    []
  );

  const initiateConnectionTo = useCallback(
    async (peerId: string) => {
      if (!socket || !selfId || peerId === selfId) return;

      console.log("[party-voice] → Initiating connection to", peerId);

      const pc = createPeerConnection(peerId);
      peersRef.current.set(peerId, { pc });
      setPeerCount((c) => c + 1);

      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        socket.send(
          JSON.stringify({
            type: "voice:offer",
            to: peerId,
            offer,
          })
        );

        console.log("[party-voice] → Sent offer to", peerId);
      } catch (e) {
        console.error("[party-voice] Failed to create offer:", e);
      }
    },
    [createPeerConnection, selfId, socket]
  );

  const setRemoteGainForPeerId = useCallback((peerId: string, gain: number) => {
    const conn = peersRef.current.get(peerId);
    if (conn?.gain) {
      conn.gain.gain.value = gain;
    }
  }, []);

  // Handle incoming voice messages from PartyKit
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);

        // Log all voice-related messages
        if (msg.type?.startsWith?.("voice:")) {
          console.log("[party-voice] ← Received message:", msg.type, {
            from: msg.from,
            to: msg.to,
          });
        }

        if (msg.type === "voice:offer" && msg.from && msg.offer) {
          void handleOffer(msg.from, msg.offer);
        } else if (msg.type === "voice:answer" && msg.from && msg.answer) {
          void handleAnswer(msg.from, msg.answer);
        } else if (msg.type === "voice:ice" && msg.from && msg.candidate) {
          void handleIceCandidate(msg.from, msg.candidate);
        } else if (msg.type === "voice:request-connection" && msg.from) {
          console.log(
            "[party-voice] ⏩ Peer",
            msg.from,
            "requesting connection"
          );
          void initiateConnectionTo(msg.from);
        }
      } catch (e) {
        // Not a voice message, ignore
      }
    };

    socket.addEventListener("message", handleMessage);
    return () => socket.removeEventListener("message", handleMessage);
  }, [
    socketRef,
    handleOffer,
    handleAnswer,
    handleIceCandidate,
    initiateConnectionTo,
  ]);

  // Request connections to all existing players when socket connects
  useEffect(() => {
    const socket = socketRef.current;

    if (!socket) {
      console.log("[party-voice] Waiting for socket...");
      return;
    }
    if (!selfId) {
      console.log("[party-voice] Waiting for selfId...");
      return;
    }

    console.log("[party-voice] ✅ Socket & selfId ready:", {
      socketState: socket.readyState,
      selfId,
    });

    const requestConnections = () => {
      console.log("[party-voice] → Requesting voice connections from server");
      socket.send(
        JSON.stringify({
          type: "voice:request-connections",
        })
      );
    };

    if (socket.readyState === WebSocket.OPEN) {
      requestConnections();
    } else {
      console.log("[party-voice] Socket not open yet, waiting...");
      socket.addEventListener("open", requestConnections, { once: true });
      return () => socket.removeEventListener("open", requestConnections);
    }
  }, [socketRef, selfId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const [peerId] of peersRef.current.entries()) {
        cleanup(peerId);
      }

      micTrackRef.current?.stop();
      micTrackRef.current = null;
      micStreamRef.current = null;

      if (audioCtxRef.current) {
        void audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
    };
  }, [cleanup]);

  // Keep track enabled state in sync
  useEffect(() => {
    const track = micTrackRef.current;
    if (track) {
      track.enabled = !micMuted;
    }
  }, [micMuted]);

  // Unlock audio on first gesture
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onGesture = async () => {
      await ensureAudio();
      console.log("[party-voice] ✓ AudioContext ready after user gesture");
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
    peerCount,
    remoteStreamCount,
    toggleMic,
    setRemoteGainForPeerId,
    initiateConnectionTo,
  };
}
