"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import PartySocket from "partysocket";
import { colorFromId } from "@/lib/hashColor";

const PARTYKIT_HOST = process.env.NEXT_PUBLIC_PARTYKIT_HOST || "127.0.0.1:1999";

type Bot = {
  socket: PartySocket;
  index: number;
};

function shouldShowPanel() {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return params.get("loadtest") === "1";
}

export function LoadTestPanel({ roomId }: { roomId: string }) {
  const enabled = useMemo(() => shouldShowPanel(), []);

  const botsRef = useRef<Bot[]>([]);
  const moveTimerRef = useRef<number | null>(null);
  const chatTimerRef = useRef<number | null>(null);

  const [desiredBots, setDesiredBots] = useState(50);
  const [connectSpacingMs, setConnectSpacingMs] = useState(10);
  const [tickMs, setTickMs] = useState(100);
  const [registerPlayers, setRegisterPlayers] = useState(true);
  const [randomVrm, setRandomVrm] = useState(false);

  const [openCount, setOpenCount] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);

  const availableVrms = [
    "/three-avatar/avatars/cherry_rose_optimized_5mb.vrm",
    "/three-avatar/avatars/fuyuki_optimized_5mb.vrm",
    "/three-avatar/avatars/kawaii_optimized_5mb.vrm",
    "/three-avatar/avatars/miu_optimized_5mb.vrm",
    "/three-avatar/avatars/ren_optimized_7mb.vrm",
    "/three-avatar/avatars/default_male.vrm",
  ];

  const stopMoveSpam = () => {
    if (moveTimerRef.current != null) {
      window.clearInterval(moveTimerRef.current);
      moveTimerRef.current = null;
    }
  };

  const stopChatSpam = () => {
    if (chatTimerRef.current != null) {
      window.clearInterval(chatTimerRef.current);
      chatTimerRef.current = null;
    }
  };

  const disconnectAll = () => {
    stopMoveSpam();
    stopChatSpam();
    const bots = botsRef.current;
    botsRef.current = [];
    setOpenCount(0);

    for (const bot of bots) {
      try {
        bot.socket.close();
      } catch {
        // ignore
      }
    }
  };

  useEffect(() => {
    if (!enabled) return;
    return () => {
      disconnectAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  if (!enabled) return null;

  const connectBots = (count: number) => {
    setLastError(null);

    // Avoid accidentally stacking bots on bots.
    disconnectAll();

    const spacing = Math.max(0, Math.min(250, Math.floor(connectSpacingMs)));

    for (let i = 0; i < count; i += 1) {
      window.setTimeout(() => {
        const socket = new PartySocket({ host: PARTYKIT_HOST, room: roomId });
        const bot: Bot = { socket, index: i };
        botsRef.current.push(bot);

        const onOpen = () => {
          setOpenCount((n) => n + 1);

          if (registerPlayers) {
            const avatarUrl = randomVrm
              ? availableVrms[Math.floor(Math.random() * availableVrms.length)]
              : undefined;

            socket.send(
              JSON.stringify({
                type: "hello",
                name: `Bot-${socket.id.slice(0, 4)}`,
                color: colorFromId(socket.id),
                gender: "male",
                avatarUrl,
              })
            );
          }
        };

        const onError = () => {
          setLastError("Socket error (see console for close code).");
        };

        const onClose = () => {
          setOpenCount((n) => Math.max(0, n - 1));
        };

        socket.addEventListener("open", onOpen);
        socket.addEventListener("error", onError);
        socket.addEventListener("close", onClose);
      }, i * spacing);
    }
  };

  const startMoveSpam = () => {
    stopMoveSpam();
    const intervalMs = Math.max(16, Math.min(2000, Math.floor(tickMs)));
    moveTimerRef.current = window.setInterval(() => {
      const bots = botsRef.current;
      const t = performance.now() / 1000;

      for (let i = 0; i < bots.length; i += 1) {
        const s = bots[i].socket;
        if (s.readyState !== WebSocket.OPEN) continue;

        const a = (bots[i].index * 0.61803398875) % (Math.PI * 2);
        const r = 10 + (bots[i].index % 7) * 0.75;
        const x = Math.cos(t + a) * r;
        const z = Math.sin(t + a) * r;
        const rotY = (t + a) % (Math.PI * 2);

        s.send(
          JSON.stringify({
            type: "state",
            position: [x, 0, z],
            rotY,
          })
        );
      }
    }, intervalMs);
  };

  const startChatSpam = () => {
    stopChatSpam();
    const intervalMs = Math.max(100, Math.min(10000, Math.floor(tickMs)));
    chatTimerRef.current = window.setInterval(() => {
      const bots = botsRef.current;
      const t = performance.now();
      for (let i = 0; i < bots.length; i += 1) {
        const s = bots[i].socket;
        if (s.readyState !== WebSocket.OPEN) continue;
        s.send(
          JSON.stringify({
            type: "chat",
            text: `loadtest ${Math.floor(t)} #${bots[i].index}`,
          })
        );
      }
    }, intervalMs);
  };

  const panelStyle: React.CSSProperties = {
    position: "fixed",
    left: 12,
    bottom: 12,
    width: 320,
    maxWidth: "92vw",
    zIndex: 80,
    pointerEvents: "auto",
    borderRadius: 12,
    background: "rgba(0,0,0,0.55)",
    backdropFilter: "blur(8px)",
    border: "1px solid rgba(255,255,255,0.12)",
    color: "white",
    padding: 10,
    fontSize: 12,
  };

  const labelStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  };

  const inputStyle: React.CSSProperties = {
    width: 96,
    padding: "6px 8px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.35)",
    color: "white",
  };

  const buttonStyle: React.CSSProperties = {
    padding: "8px 10px",
    borderRadius: 10,
    background: "rgba(255,255,255,0.10)",
    border: "1px solid rgba(255,255,255,0.14)",
    color: "white",
    cursor: "pointer",
    fontSize: 12,
  };

  return (
    <div style={panelStyle}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <div style={{ fontWeight: 800, letterSpacing: 0.3 }}>Load Test</div>
        <div style={{ opacity: 0.75 }}>{roomId}</div>
      </div>

      <div
        style={{
          marginTop: 8,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div style={labelStyle}>
          <div>Bot count</div>
          <input
            style={inputStyle}
            type="number"
            min={1}
            max={2000}
            value={desiredBots}
            onChange={(e) =>
              setDesiredBots(parseInt(e.target.value || "0", 10) || 0)
            }
          />
        </div>

        <div style={labelStyle}>
          <div>Connect spacing (ms)</div>
          <input
            style={inputStyle}
            type="number"
            min={0}
            max={250}
            value={connectSpacingMs}
            onChange={(e) =>
              setConnectSpacingMs(parseInt(e.target.value || "0", 10) || 0)
            }
          />
        </div>

        <div style={labelStyle}>
          <div>Tick (ms)</div>
          <input
            style={inputStyle}
            type="number"
            min={16}
            max={10000}
            value={tickMs}
            onChange={(e) =>
              setTickMs(parseInt(e.target.value || "0", 10) || 0)
            }
          />
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={registerPlayers}
            onChange={(e) => setRegisterPlayers(e.target.checked)}
          />
          Register bots as players (sends hello)
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={randomVrm}
            onChange={(e) => setRandomVrm(e.target.checked)}
          />
          Random VRM models
        </label>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button style={buttonStyle} onClick={() => connectBots(desiredBots)}>
            Connect
          </button>
          <button style={buttonStyle} onClick={disconnectAll}>
            Disconnect
          </button>
          <button style={buttonStyle} onClick={startMoveSpam}>
            Start move spam
          </button>
          <button style={buttonStyle} onClick={stopMoveSpam}>
            Stop move spam
          </button>
          <button style={buttonStyle} onClick={startChatSpam}>
            Start chat spam
          </button>
          <button style={buttonStyle} onClick={stopChatSpam}>
            Stop chat spam
          </button>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            opacity: 0.85,
          }}
        >
          <div>Open: {openCount}</div>
          <div>{lastError ? `Error: ${lastError}` : ""}</div>
        </div>

        <div style={{ opacity: 0.7, fontSize: 11 }}>
          Enable with{" "}
          <span style={{ fontFamily: "monospace" }}>?loadtest=1</span>
        </div>
      </div>
    </div>
  );
}
