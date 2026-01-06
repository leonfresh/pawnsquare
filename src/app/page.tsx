"use client";

import dynamic from "next/dynamic";
import { useState, useEffect } from "react";
import { OAuthPopupGuard } from "@/components/oauth-popup-guard";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";
import { useRoomDiscovery } from "@/lib/roomDiscovery";

const World = dynamic(() => import("@/components/world"), { ssr: false });

export default function Home() {
  // If this window is the OAuth popup, do NOT mount the 3D world or connect networking.
  // Just finalize auth and close.
  if (typeof window !== "undefined" && window.name === "pawnsquare-oauth") {
    return <OAuthPopupGuard />;
  }

  const [joined, setJoined] = useState(false);
  const [username, setUsername] = useState("");
  const [gender, setGender] = useState<"male" | "female">("male");
  const [inputValue, setInputValue] = useState("");
  const [selectedRoom, setSelectedRoom] = useState<string>("main-room");
  const [selectedMode, setSelectedMode] = useState<"normal" | "4p">("normal");
  const [lobbyType, setLobbyType] = useState<"park" | "scifi">("park");
  const [worldReady, setWorldReady] = useState(false);

  const { allRooms } = useRoomDiscovery({ enabled: !joined });

  const MAX_PLAYERS_PER_ROOM = 16;
  const baseNormalRoom = "main-room";
  const base4pRoom = "main-room-4p";

  const baseForMode = selectedMode === "4p" ? base4pRoom : baseNormalRoom;

  const roomIdForChannel = (base: string, ch: number) => {
    if (ch <= 1) return base;
    return `${base}-ch${ch - 1}`;
  };

  const channelForRoomId = (base: string, roomId: string) => {
    if (roomId === base) return 1;
    const m = roomId.match(
      new RegExp(
        `^${base.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}-ch(\\d+)$`,
        "i"
      )
    );
    if (!m) return null;
    const n = parseInt(m[1]!, 10);
    if (!Number.isFinite(n)) return null;
    return n + 1;
  };

  const occupiedChannels = (base: string) => {
    // Only channels with people, but always include CH.1 so the UI isn't empty.
    const list = (allRooms || [])
      .filter((r) => r.roomId === base || r.roomId.startsWith(`${base}-ch`))
      .filter((r) => r.playerCount > 0)
      .map((r) => ({
        roomId: r.roomId,
        playerCount: r.playerCount,
        ch: channelForRoomId(base, r.roomId),
      }))
      .filter(
        (r): r is { roomId: string; playerCount: number; ch: number } =>
          typeof r.ch === "number"
      )
      .sort((a, b) => a.ch - b.ch);

    if (!list.some((r) => r.ch === 1)) {
      list.unshift({ roomId: base, playerCount: 0, ch: 1 });
    }

    return list;
  };

  const autoPickRoom = (base: string) => {
    const known = (allRooms || [])
      .filter((r) => r.roomId === base || r.roomId.startsWith(`${base}-ch`))
      .sort((a, b) => b.playerCount - a.playerCount);

    const available = known.filter((r) => r.playerCount < MAX_PLAYERS_PER_ROOM);
    if (available[0]) return available[0].roomId;

    const channels = known
      .map((r) => channelForRoomId(base, r.roomId))
      .filter((n): n is number => typeof n === "number");
    const maxCh = channels.length ? Math.max(...channels) : 1;
    return roomIdForChannel(base, maxCh + 1);
  };

  // Keep selectedRoom consistent with selectedMode when on the join screen.
  useEffect(() => {
    if (joined) return;
    // If user already selected something for this base, keep it.
    const current = selectedRoom;
    const isForBase =
      current === baseForMode || current.startsWith(`${baseForMode}-ch`);
    if (!isForBase) {
      setSelectedRoom(autoPickRoom(baseForMode));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseForMode, joined]);

  useEffect(() => {
    const stored = localStorage.getItem("pawnsquare-user");
    if (stored) {
      try {
        const data = JSON.parse(stored);
        setUsername(data.username || "");
        setGender(data.gender || "male");
        setJoined(true);
      } catch {}
    }
  }, []);

  // Decide the correct lobby BEFORE mounting the heavy 3D world.
  useEffect(() => {
    if (!joined) {
      setWorldReady(false);
      return;
    }

    let cancelled = false;
    const boot = async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data: auth } = await supabase.auth.getUser();
        const user = auth.user;
        if (!user) {
          if (!cancelled) setWorldReady(true);
          return;
        }

        const { data: profile } = await supabase
          .from("profiles")
          .select("equipped_theme")
          .eq("id", user.id)
          .single();

        const equippedTheme = (profile as any)?.equipped_theme;
        if (!cancelled) {
          setLobbyType(equippedTheme === "theme_scifi" ? "scifi" : "park");
          setWorldReady(true);
        }
      } catch {
        if (!cancelled) setWorldReady(true);
      }
    };

    void boot();
    return () => {
      cancelled = true;
    };
  }, [joined]);

  const handleJoin = () => {
    const name = inputValue.trim() || "Guest";
    setUsername(name);
    try {
      // World reads this on mount and uses it as the network display name.
      window.sessionStorage.setItem("pawnsquare:name", name);
    } catch {
      // ignore
    }
    localStorage.setItem(
      "pawnsquare-user",
      JSON.stringify({ username: name, gender })
    );
    setJoined(true);
  };

  if (!joined) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div
          style={{
            background: "white",
            borderRadius: "20px",
            padding: "40px",
            boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
            maxWidth: "400px",
            width: "90%",
          }}
        >
          <h1
            style={{
              margin: "0 0 10px 0",
              fontSize: "32px",
              fontWeight: "700",
              background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            PawnSquare
          </h1>
          <p style={{ margin: "0 0 30px 0", color: "#666", fontSize: "14px" }}>
            Enter the 3D multiplayer world
          </p>

          <label
            style={{
              display: "block",
              marginBottom: "8px",
              fontWeight: "600",
              color: "#333",
              fontSize: "14px",
            }}
          >
            Game Mode
          </label>
          <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
            <button
              onClick={() => setSelectedMode("normal")}
              style={{
                flex: 1,
                padding: "12px 14px",
                fontSize: 14,
                fontWeight: 700,
                border:
                  selectedMode === "normal"
                    ? "3px solid #667eea"
                    : "2px solid #e0e0e0",
                borderRadius: 12,
                background: selectedMode === "normal" ? "#f0f4ff" : "white",
                color: selectedMode === "normal" ? "#667eea" : "#666",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              Normal Chess
            </button>
            <button
              onClick={() => setSelectedMode("4p")}
              style={{
                flex: 1,
                padding: "12px 14px",
                fontSize: 14,
                fontWeight: 700,
                border:
                  selectedMode === "4p"
                    ? "3px solid #764ba2"
                    : "2px solid #e0e0e0",
                borderRadius: 12,
                background: selectedMode === "4p" ? "#f8f0ff" : "white",
                color: selectedMode === "4p" ? "#764ba2" : "#666",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              4P Chess
            </button>
          </div>

          <label
            style={{
              display: "block",
              marginBottom: "8px",
              fontWeight: "600",
              color: "#333",
              fontSize: "14px",
            }}
          >
            Channel
          </label>
          <div
            style={{
              border: "2px solid #e0e0e0",
              borderRadius: 12,
              padding: 12,
              marginBottom: 20,
              background: "white",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                marginBottom: 10,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 700, color: "#333" }}>
                Selected: {selectedRoom}
              </div>
              <button
                onClick={() => setSelectedRoom(autoPickRoom(baseForMode))}
                style={{
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "2px solid #e0e0e0",
                  background: "white",
                  color: "#333",
                  cursor: "pointer",
                  fontWeight: 700,
                  fontSize: 12,
                }}
              >
                Auto
              </button>
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                maxHeight: 120,
                overflowY: "auto",
              }}
            >
              {occupiedChannels(baseForMode).map((r) => {
                const isSelected = r.roomId === selectedRoom;
                const isFull = r.playerCount >= MAX_PLAYERS_PER_ROOM;
                return (
                  <button
                    key={r.roomId}
                    onClick={() => setSelectedRoom(r.roomId)}
                    disabled={isFull}
                    style={{
                      height: 34,
                      padding: "0 10px",
                      borderRadius: 10,
                      border: isSelected
                        ? "2px solid #667eea"
                        : "1px solid #e0e0e0",
                      background: isSelected ? "#f0f4ff" : "white",
                      color: isFull ? "#999" : "#333",
                      cursor: isFull ? "not-allowed" : "pointer",
                      fontSize: 12,
                      fontWeight: 800,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                    title={`${r.playerCount}/${MAX_PLAYERS_PER_ROOM}`}
                  >
                    <span>{`CH.${r.ch}`}</span>
                    <span style={{ opacity: 0.7, fontWeight: 700 }}>
                      {`${r.playerCount}/${MAX_PLAYERS_PER_ROOM}`}
                    </span>
                  </button>
                );
              })}
            </div>
            <div style={{ marginTop: 10, color: "#777", fontSize: 12 }}>
              Rooms are capped at {MAX_PLAYERS_PER_ROOM} players. If a channel
              is full, use Auto or pick another channel.
            </div>
          </div>

          <label
            style={{
              display: "block",
              marginBottom: "8px",
              fontWeight: "600",
              color: "#333",
              fontSize: "14px",
            }}
          >
            Username
          </label>
          <input
            type="text"
            placeholder="Enter your name..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleJoin()}
            maxLength={24}
            style={{
              width: "100%",
              padding: "12px 16px",
              fontSize: "16px",
              border: "2px solid #e0e0e0",
              borderRadius: "12px",
              outline: "none",
              transition: "border-color 0.2s",
              boxSizing: "border-box",
              marginBottom: "20px",
            }}
            onFocus={(e) => (e.target.style.borderColor = "#667eea")}
            onBlur={(e) => (e.target.style.borderColor = "#e0e0e0")}
          />

          <label
            style={{
              display: "block",
              marginBottom: "12px",
              fontWeight: "600",
              color: "#333",
              fontSize: "14px",
            }}
          >
            Avatar Gender
          </label>
          <div style={{ display: "flex", gap: "12px", marginBottom: "30px" }}>
            <button
              onClick={() => setGender("male")}
              style={{
                flex: 1,
                padding: "16px",
                fontSize: "16px",
                fontWeight: "600",
                border:
                  gender === "male" ? "3px solid #667eea" : "2px solid #e0e0e0",
                borderRadius: "12px",
                background: gender === "male" ? "#f0f4ff" : "white",
                color: gender === "male" ? "#667eea" : "#666",
                cursor: "pointer",
                transition: "all 0.2s",
              }}
            >
              🚹 Male
            </button>
            <button
              onClick={() => setGender("female")}
              style={{
                flex: 1,
                padding: "16px",
                fontSize: "16px",
                fontWeight: "600",
                border:
                  gender === "female"
                    ? "3px solid #764ba2"
                    : "2px solid #e0e0e0",
                borderRadius: "12px",
                background: gender === "female" ? "#f8f0ff" : "white",
                color: gender === "female" ? "#764ba2" : "#666",
                cursor: "pointer",
                transition: "all 0.2s",
              }}
            >
              🚺 Female
            </button>
          </div>

          <button
            onClick={handleJoin}
            style={{
              width: "100%",
              padding: "16px",
              fontSize: "18px",
              fontWeight: "700",
              border: "none",
              borderRadius: "12px",
              background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
              color: "white",
              cursor: "pointer",
              transition: "transform 0.2s, box-shadow 0.2s",
              boxShadow: "0 4px 12px rgba(102, 126, 234, 0.4)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-2px)";
              e.currentTarget.style.boxShadow =
                "0 6px 20px rgba(102, 126, 234, 0.5)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow =
                "0 4px 12px rgba(102, 126, 234, 0.4)";
            }}
          >
            {selectedMode === "4p" ? "Join 4P World" : "Join World"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      {worldReady ? (
        <World
          roomId={selectedRoom}
          initialName={username}
          initialGender={gender}
          lobbyType={lobbyType}
          onLobbyChange={setLobbyType}
          onExit={() => setJoined(false)}
        />
      ) : (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#000",
            color: "#fff",
            fontFamily: "system-ui, -apple-system, sans-serif",
            fontSize: "16px",
            opacity: 0.9,
          }}
        >
          Loading world…
        </div>
      )}
    </div>
  );
}
