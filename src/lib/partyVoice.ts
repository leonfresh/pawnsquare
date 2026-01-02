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
  audioTransceiver?: RTCRtpTransceiver;
  stream?: MediaStream;
  audioEl?: HTMLAudioElement;
  source?: MediaStreamAudioSourceNode;
  gain?: GainNode;
  hasRemoteAudio?: boolean;
  iceRestarting?: boolean;
  lastIceRestartAt?: number;
};

export type VoiceDebugEvent = {
  t: number;
  kind:
    | "info"
    | "warn"
    | "error"
    | "offer-in"
    | "offer-out"
    | "answer-in"
    | "answer-out"
    | "ice-in"
    | "ice-out"
    | "track-in"
    | "hangup-in"
    | "hangup-out"
    | "cleanup"
    | "request-connections";
  peerId?: string;
  message?: string;
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
  autoRequestConnections?: boolean;
}) {
  const { socketRef, selfId, onRemoteGainForPeerId } = opts;
  const socket = socketRef.current;

  const audioCtxRef = useRef<AudioContext | null>(null);
  const peersRef = useRef<Map<string, PeerConnection>>(new Map());
  const micStreamRef = useRef<MediaStream | null>(null);
  const micTrackRef = useRef<MediaStreamTrack | null>(null);
  const onRemoteGainRef = useRef(onRemoteGainForPeerId);
  const pendingTracksRef = useRef<Map<string, MediaStream>>(new Map());
  const gestureUnlockedRef = useRef(false);
  const deviceIdRef = useRef<string>("");
  const micDeviceIdRef = useRef<string>("");
  const cleanupRef = useRef<(peerId: string) => void>(() => {});

  // Keep callback ref updated
  useEffect(() => {
    onRemoteGainRef.current = onRemoteGainForPeerId;
  }, [onRemoteGainForPeerId]);

  const [micAvailable, setMicAvailable] = useState(false);
  const [micMuted, setMicMuted] = useState(true);
  const [micDeviceLabel, setMicDeviceLabel] = useState<string>("");
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicDeviceId, setSelectedMicDeviceId] = useState<string>("");
  const [micLastError, setMicLastError] = useState<string | null>(null);
  const [peerCount, setPeerCount] = useState(0);
  const [remoteStreamCount, setRemoteStreamCount] = useState(0);
  const [connectedPeerIds, setConnectedPeerIds] = useState<string[]>([]);
  const [debugEvents, setDebugEvents] = useState<VoiceDebugEvent[]>([]);

  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

  const recomputeCounts = useCallback(() => {
    const peers = peersRef.current;
    setPeerCount(peers.size);

    // Keep a lightweight list for UI/debug.
    setConnectedPeerIds(Array.from(peers.keys()));

    // Count peers for which we've received at least one remote audio track.
    // This avoids showing 0 when tracks arrived before the first user gesture.
    const streamCount = Array.from(peers.values()).filter((c) => {
      if (!c.hasRemoteAudio) return false;
      return true;
    }).length;

    setRemoteStreamCount(streamCount);
  }, []);

  const pushEvent = useCallback((e: Omit<VoiceDebugEvent, "t">) => {
    const event: VoiceDebugEvent = { t: Date.now(), ...e };
    setDebugEvents((prev) => {
      const next = [...prev, event];
      if (next.length > 60) next.splice(0, next.length - 60);
      return next;
    });
  }, []);

  // Stable per-device id (prevents self-echo if multiple tabs open on same device).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = "pawnsquare:voiceDeviceId";
    let id = "";
    try {
      id = window.localStorage.getItem(key) ?? "";
      if (!id) {
        const cryptoAny = globalThis.crypto as Crypto | undefined;
        id = cryptoAny?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
        window.localStorage.setItem(key, id);
      }
    } catch {
      id = `${Date.now()}-${Math.random()}`;
    }
    deviceIdRef.current = id;
  }, []);

  // Preferred mic device id (user selectable).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = "pawnsquare:preferredMicDeviceId";
    try {
      const saved = window.localStorage.getItem(key) ?? "";
      micDeviceIdRef.current = saved;
      setSelectedMicDeviceId(saved);
    } catch {
      // ignore
    }
  }, []);

  const refreshMicDevices = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const mics = devices.filter((d) => d.kind === "audioinput");
      setMicDevices(mics);

      // If we have a saved selection that no longer exists, clear it.
      const cur = micDeviceIdRef.current;
      if (cur && !mics.some((d) => d.deviceId === cur)) {
        micDeviceIdRef.current = "";
        setSelectedMicDeviceId("");
        try {
          window.localStorage.removeItem("pawnsquare:preferredMicDeviceId");
        } catch {
          // ignore
        }
      }
    } catch (e) {
      // Some browsers throw if not on HTTPS or no permissions.
      pushEvent({
        kind: "warn",
        message: "enumerateDevices failed",
      });
    }
  }, [pushEvent]);

  // Keep mic device list fresh.
  useEffect(() => {
    if (typeof window === "undefined") return;
    void refreshMicDevices();
    const handler = () => {
      void refreshMicDevices();
    };
    try {
      navigator.mediaDevices?.addEventListener?.("devicechange", handler);
      return () =>
        navigator.mediaDevices?.removeEventListener?.("devicechange", handler);
    } catch {
      return;
    }
  }, [refreshMicDevices]);

  const stopMic = useCallback(() => {
    try {
      micTrackRef.current?.stop();
    } catch {
      // ignore
    }
    micTrackRef.current = null;
    micStreamRef.current = null;
    setMicAvailable(false);
    setMicDeviceLabel("");
  }, []);

  const ensureRemoteAudioEl = useCallback(
    (peerId: string): HTMLAudioElement | null => {
      if (typeof window === "undefined") return null;
      const conn = peersRef.current.get(peerId);
      if (!conn) return null;
      if (conn.audioEl) return conn.audioEl;

      const el = document.createElement("audio");
      el.autoplay = true;
      // iOS/Safari: playsinline is an attribute (TS doesn't type playsInline on audio).
      el.setAttribute("playsinline", "true");
      el.muted = false;
      el.volume = 1;
      // Avoid display:none (some browsers behave oddly); keep it effectively invisible.
      el.style.position = "fixed";
      el.style.left = "0";
      el.style.top = "0";
      el.style.width = "1px";
      el.style.height = "1px";
      el.style.opacity = "0";
      el.style.pointerEvents = "none";

      try {
        document.body.appendChild(el);
      } catch {
        // ignore
      }

      conn.audioEl = el;
      return el;
    },
    []
  );

  const attachAndPlayRemoteStream = useCallback(
    async (peerId: string, stream: MediaStream) => {
      const conn = peersRef.current.get(peerId);
      if (!conn) return;

      const el = ensureRemoteAudioEl(peerId);
      if (!el) return;

      // Attach the latest stream.
      conn.stream = stream;
      conn.hasRemoteAudio = true;
      if (el.srcObject !== stream) {
        el.srcObject = stream;
      }

      // Try to play; if blocked, we'll retry on the first user gesture.
      try {
        await el.play();
        console.log("[party-voice] ✓ Remote audio playing for", peerId);
      } catch (e) {
        console.warn(
          "[party-voice] Remote audio play() blocked; will retry on gesture for",
          peerId,
          e
        );
      }

      recomputeCounts();
    },
    [ensureRemoteAudioEl, recomputeCounts]
  );

  const ensureAudio = useCallback(async () => {
    if (typeof window === "undefined") return;

    // Mark that we have a user gesture (pointerdown/keydown OR mic toggle).
    gestureUnlockedRef.current = true;

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

    // Process any pending tracks now that we have a gesture.
    if (pendingTracksRef.current.size > 0) {
      console.log(
        "[party-voice] Processing",
        pendingTracksRef.current.size,
        "pending tracks"
      );
      const pending = Array.from(pendingTracksRef.current.entries());
      pendingTracksRef.current.clear();

      for (const [peerId, stream] of pending) {
        await attachAndPlayRemoteStream(peerId, stream);
      }
    }
  }, [attachAndPlayRemoteStream]);

  const ensureMic = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (micStreamRef.current && micTrackRef.current) {
      setMicAvailable(true);
      return;
    }

    try {
      setMicLastError(null);
      const preferred = micDeviceIdRef.current;

      const baseAudio: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      };

      const tryWithPreferred = async () => {
        if (!preferred) return null;
        return navigator.mediaDevices.getUserMedia({
          audio: {
            ...baseAudio,
            deviceId: { exact: preferred },
          },
          video: false,
        });
      };

      const tryDefault = async () =>
        navigator.mediaDevices.getUserMedia({
          audio: baseAudio,
          video: false,
        });

      let stream: MediaStream;
      try {
        const s = await tryWithPreferred();
        stream = s ?? (await tryDefault());
      } catch (e) {
        // If preferred device failed, fall back once to default.
        if (preferred) {
          pushEvent({
            kind: "warn",
            message: "preferred mic failed; falling back",
          });
          stream = await tryDefault();
        } else {
          throw e;
        }
      }

      const track = stream.getAudioTracks()[0] || null;
      if (!track) throw new Error("No audio track available");

      const deviceLabel = track.label || "Unknown Microphone";
      console.log("[party-voice] ✓ Mic acquired:", {
        label: deviceLabel,
        id: track.id,
        enabled: track.enabled,
        readyState: track.readyState,
      });

      void refreshMicDevices();

      micStreamRef.current = stream;
      micTrackRef.current = track;
      track.enabled = !micMuted;
      setMicDeviceLabel(deviceLabel);
      setMicAvailable(true);

      // Add track to all existing peer connections
      for (const [peerId, conn] of peersRef.current.entries()) {
        const state = conn.pc.connectionState;
        if (
          state === "closed" ||
          state === "failed" ||
          state === "disconnected"
        ) {
          console.log(
            "[party-voice] Skipping disconnected peer:",
            peerId,
            state
          );
          continue;
        }
        if (conn.audioTransceiver) {
          console.log(
            "[party-voice] Replacing mic track for existing peer:",
            peerId
          );
          try {
            void conn.audioTransceiver.sender.replaceTrack(track);
          } catch (e) {
            console.warn(
              "[party-voice] replaceTrack failed; falling back to addTrack for",
              peerId,
              e
            );
            conn.pc.addTrack(track, stream);
          }
        } else {
          console.log(
            "[party-voice] No audio transceiver; adding mic track to existing peer:",
            peerId
          );
          conn.pc.addTrack(track, stream);
        }
      }
    } catch (e) {
      console.error("[party-voice] getUserMedia failed", e);
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === "string"
          ? e
          : "Failed to access microphone";
      setMicLastError(msg);
      pushEvent({ kind: "error", message: `getUserMedia failed: ${msg}` });
      setMicAvailable(false);
      throw e;
    }
  }, [micMuted, pushEvent, refreshMicDevices]);

  const setMicDeviceId = useCallback(
    async (deviceId: string) => {
      if (typeof window === "undefined") return;
      micDeviceIdRef.current = deviceId;
      setSelectedMicDeviceId(deviceId);
      try {
        if (deviceId) {
          window.localStorage.setItem(
            "pawnsquare:preferredMicDeviceId",
            deviceId
          );
        } else {
          window.localStorage.removeItem("pawnsquare:preferredMicDeviceId");
        }
      } catch {
        // ignore
      }

      // If mic is already acquired, re-acquire with the new device.
      if (micStreamRef.current || micTrackRef.current) {
        stopMic();
        try {
          await ensureMic();
        } catch {
          // keep muted; error will be surfaced via micLastError/debug
        }
      }
    },
    [ensureMic, stopMic]
  );

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
    (peerId: string): PeerConnection => {
      const pc = new RTCPeerConnection(RTC_CONFIG);

      // Always negotiate an audio m-line up front.
      // Later, when the user enables mic, we can replaceTrack() without renegotiation.
      const audioTransceiver = pc.addTransceiver("audio", {
        direction: "sendrecv",
      });

      pc.onicecandidate = (event) => {
        if (event.candidate && socket) {
          pushEvent({ kind: "ice-out", peerId });
          socket.send(
            JSON.stringify({
              type: "voice:ice",
              to: peerId,
              candidate: event.candidate,
              deviceId: deviceIdRef.current,
            })
          );
        }
      };

      const maybeRestartIce = async () => {
        const conn = peersRef.current.get(peerId);
        if (!conn) return;

        const now = Date.now();
        const last = conn.lastIceRestartAt ?? 0;
        if (conn.iceRestarting) return;
        // Avoid restart loops.
        if (now - last < 8000) return;
        if (!socket) return;
        if (pc.signalingState !== "stable") return;

        conn.iceRestarting = true;
        conn.lastIceRestartAt = now;
        console.warn("[party-voice] ICE failed; restarting ICE for", peerId);

        try {
          const offer = await pc.createOffer({ iceRestart: true });
          await pc.setLocalDescription(offer);
          socket.send(
            JSON.stringify({
              type: "voice:offer",
              to: peerId,
              offer,
              deviceId: deviceIdRef.current,
            })
          );
          console.log("[party-voice] → Sent ICE-restart offer to", peerId);
        } catch (e) {
          console.error("[party-voice] ICE restart failed for", peerId, e);
        } finally {
          const latest = peersRef.current.get(peerId);
          if (latest) latest.iceRestarting = false;
        }
      };

      pc.ontrack = async (event) => {
        console.log("[party-voice] ← Received track from", peerId, {
          kind: event.track.kind,
          id: event.track.id,
        });

        if (event.track.kind !== "audio") return;

        pushEvent({ kind: "track-in", peerId });

        const stream = event.streams[0] || new MediaStream([event.track]);

        const conn = peersRef.current.get(peerId);
        if (conn) {
          // Mark for counting even if we can't play yet (autoplay policies).
          conn.stream = stream;
          conn.hasRemoteAudio = true;
          recomputeCounts();
        }

        // If we haven't had a user gesture yet, store track for later.
        if (!gestureUnlockedRef.current) {
          console.log(
            "[party-voice] ⏸️ Storing track for",
            peerId,
            "until user gesture"
          );
          pendingTracksRef.current.set(peerId, stream);
          return;
        }

        await attachAndPlayRemoteStream(peerId, stream);
      };

      pc.onconnectionstatechange = () => {
        console.log(
          "[party-voice] Connection state:",
          peerId,
          pc.connectionState
        );

        if (pc.connectionState === "failed") {
          void maybeRestartIce();
          // Give ICE restart a moment; cleanup only if it stays failed.
          globalThis.setTimeout(() => {
            const cur = peersRef.current.get(peerId);
            if (!cur) return;
            if (cur.pc.connectionState === "failed") {
              cleanupRef.current(peerId);
            }
          }, 12000);
        }

        if (pc.connectionState === "closed") {
          cleanupRef.current(peerId);
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === "failed") {
          void maybeRestartIce();
        }
      };

      // Add mic track if we already have it
      const track = micTrackRef.current;
      const stream = micStreamRef.current;
      if (track && stream) {
        console.log("[party-voice] Replacing mic track for new peer:", peerId);
        try {
          void audioTransceiver.sender.replaceTrack(track);
        } catch (e) {
          console.warn(
            "[party-voice] replaceTrack failed; falling back to addTrack for",
            peerId,
            e
          );
          pc.addTrack(track, stream);
        }
      }

      return { pc, audioTransceiver };
    },
    [ensureAudio, socket]
  );

  const cleanup = useCallback(
    (peerId: string) => {
      const conn = peersRef.current.get(peerId);
      if (!conn) return;

      pushEvent({ kind: "cleanup", peerId });

      try {
        conn.source?.disconnect();
        conn.gain?.disconnect();
        if (conn.audioEl) {
          try {
            conn.audioEl.pause();
          } catch {
            // ignore
          }
          try {
            conn.audioEl.srcObject = null;
          } catch {
            // ignore
          }
          try {
            conn.audioEl.remove();
          } catch {
            // ignore
          }
          conn.audioEl = undefined;
        }
        conn.pc.close();
      } catch (e) {
        console.error("[party-voice] Cleanup error:", e);
      }

      peersRef.current.delete(peerId);
      recomputeCounts();
      onRemoteGainRef.current(peerId, null);
    },
    [pushEvent, recomputeCounts]
  );

  useEffect(() => {
    cleanupRef.current = cleanup;
  }, [cleanup]);

  const handleOffer = useCallback(
    async (from: string, offer: RTCSessionDescriptionInit) => {
      console.log("[party-voice] ← Received offer from", from);
      pushEvent({ kind: "offer-in", peerId: from });

      let conn = peersRef.current.get(from);
      if (!conn) {
        conn = createPeerConnection(from);
        peersRef.current.set(from, conn);
        recomputeCounts();
      }

      const pc = conn.pc;

      try {
        await pc.setRemoteDescription(offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        if (socket) {
          pushEvent({ kind: "answer-out", peerId: from });
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
        pushEvent({
          kind: "error",
          peerId: from,
          message: "handleOffer failed",
        });
      }
    },
    [createPeerConnection, socket, recomputeCounts, pushEvent]
  );

  const handleAnswer = useCallback(
    async (from: string, answer: RTCSessionDescriptionInit) => {
      console.log("[party-voice] ← Received answer from", from);
      pushEvent({ kind: "answer-in", peerId: from });

      const conn = peersRef.current.get(from);
      if (!conn) return;

      try {
        await conn.pc.setRemoteDescription(answer);
      } catch (e) {
        console.error("[party-voice] Failed to set answer:", e);
        pushEvent({
          kind: "error",
          peerId: from,
          message: "setRemoteDescription(answer) failed",
        });
      }
    },
    [pushEvent]
  );

  const handleIceCandidate = useCallback(
    async (from: string, candidate: RTCIceCandidateInit) => {
      const conn = peersRef.current.get(from);
      if (!conn) return;

      pushEvent({ kind: "ice-in", peerId: from });

      try {
        await conn.pc.addIceCandidate(candidate);
      } catch (e) {
        console.error("[party-voice] Failed to add ICE candidate:", e);
        pushEvent({
          kind: "error",
          peerId: from,
          message: "addIceCandidate failed",
        });
      }
    },
    [pushEvent]
  );

  const initiateConnectionTo = useCallback(
    async (peerId: string) => {
      if (!socket || !selfId || peerId === selfId) return;

      console.log("[party-voice] → Initiating connection to", peerId);

      const conn = createPeerConnection(peerId);
      const pc = conn.pc;
      peersRef.current.set(peerId, conn);
      recomputeCounts();

      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        pushEvent({ kind: "offer-out", peerId });
        socket.send(
          JSON.stringify({
            type: "voice:offer",
            to: peerId,
            offer,
            deviceId: deviceIdRef.current,
          })
        );

        console.log("[party-voice] → Sent offer to", peerId);
      } catch (e) {
        console.error("[party-voice] Failed to create offer:", e);
        pushEvent({ kind: "error", peerId, message: "createOffer failed" });
      }
    },
    [createPeerConnection, selfId, socket, recomputeCounts, pushEvent]
  );

  const requestConnections = useCallback(
    (peers?: string[]) => {
      const socket = socketRef.current;
      if (!socket) return;
      if (!selfId) return;
      if (socket.readyState !== WebSocket.OPEN) return;

      pushEvent({
        kind: "request-connections",
        message: Array.isArray(peers) ? `peers=${peers.length}` : "all",
      });

      socket.send(
        JSON.stringify({
          type: "voice:request-connections",
          deviceId: deviceIdRef.current,
          peers: Array.isArray(peers) ? peers : undefined,
        })
      );
    },
    [selfId, pushEvent, socketRef]
  );

  const hangupPeer = useCallback(
    (peerId: string, reason?: string) => {
      const socket = socketRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        pushEvent({ kind: "hangup-out", peerId, message: reason });
        socket.send(
          JSON.stringify({
            type: "voice:hangup",
            to: peerId,
            reason: reason ?? "out-of-range",
          })
        );
      }
      cleanup(peerId);
    },
    [cleanup, pushEvent, socketRef]
  );

  const setRemoteGainForPeerId = useCallback((peerId: string, gain: number) => {
    const conn = peersRef.current.get(peerId);
    if (conn?.gain) {
      conn.gain.gain.value = gain;
    }

    // Primary playback path: HTMLAudioElement volume.
    if (conn?.audioEl) {
      const v = Number.isFinite(gain) ? clamp01(gain) : 1;
      conn.audioEl.volume = v;
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
        } else if (msg.type === "voice:hangup" && msg.from) {
          pushEvent({
            kind: "hangup-in",
            peerId: msg.from,
            message: msg.reason,
          });
          cleanup(msg.from);
        } else if (msg.type === "voice:request-connection" && msg.from) {
          // If two tabs are open on the same device, avoid connecting (prevents local self-echo).
          if (
            typeof msg.fromDeviceId === "string" &&
            msg.fromDeviceId &&
            msg.fromDeviceId === deviceIdRef.current
          ) {
            console.log(
              "[party-voice] Skipping same-device peer connection request from",
              msg.from
            );
            return;
          }
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
    cleanup,
    pushEvent,
  ]);

  // (Optional) Request full-mesh voice connections on join.
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

    if (opts.autoRequestConnections === false) {
      return;
    }

    const requestConnections = () => {
      console.log("[party-voice] → Requesting voice connections from server");
      socket.send(
        JSON.stringify({
          type: "voice:request-connections",
          deviceId: deviceIdRef.current,
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

      stopMic();

      if (audioCtxRef.current) {
        void audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
    };
  }, [cleanup, stopMic]);

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
    micDevices,
    selectedMicDeviceId,
    micLastError,
    peerCount,
    remoteStreamCount,
    connectedPeerIds,
    debugEvents,
    toggleMic,
    setRemoteGainForPeerId,
    initiateConnectionTo,
    requestConnections,
    hangupPeer,
    disconnectPeer: cleanup,
    refreshMicDevices,
    setMicDeviceId,
  };
}
