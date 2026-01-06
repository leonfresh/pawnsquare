import type * as Party from "partykit/server";

type Player = {
  id: string;
  name: string;
  color: string;
  gender: "male" | "female";
  avatarUrl?: string;
  position: [number, number, number];
  rotY: number;
};

type ChatMessage = {
  id: string;
  fromId: string;
  fromName: string;
  text: string;
  t: number;
};

type BoardMode = "chess" | "checkers" | "goose";

type LeaderboardEntry = {
  id: string;
  name: string;
  moves: number;
  playMs: number;
  score: number;
};

type Message =
  | {
      type: "hello";
      name: string;
      color: string;
      gender: "male" | "female";
      avatarUrl?: string;
    }
  | { type: "activity:move"; game: string; boardKey?: string }
  | { type: "state"; position: [number, number, number]; rotY: number }
  | { type: "chat"; text: string }
  | { type: "sync"; players: Record<string, Player>; chat: ChatMessage[] }
  | { type: "board:set-mode"; boardKey: string; mode: BoardMode }
  | { type: "voice:offer"; to: string; offer: RTCSessionDescriptionInit }
  | { type: "voice:answer"; to: string; answer: RTCSessionDescriptionInit }
  | { type: "voice:ice"; to: string; candidate: RTCIceCandidateInit }
  | { type: "voice:hangup"; to: string; reason?: string }
  | { type: "voice:request-connections"; deviceId?: string; peers?: string[] };

type LeaderboardMessage = { type: "leaderboard"; entries: LeaderboardEntry[] };

export default class RoomServer implements Party.Server {
  players: Map<string, Player> = new Map();
  chat: ChatMessage[] = [];
  boardModes: Record<string, BoardMode> = {
    a: "chess",
    b: "chess",
    c: "chess",
    d: "chess",
  };

  stats: Map<
    string,
    { name: string; moves: number; playMsAcc: number; connectedAtMs: number }
  > = new Map();
  leaderboardTimer: ReturnType<typeof setInterval> | null = null;

  static readonly MAX_PLAYERS = 16;

  constructor(readonly room: Party.Room) {}

  computeLeaderboard(nowMs: number): LeaderboardEntry[] {
    const entries: LeaderboardEntry[] = [];

    for (const [id, player] of this.players.entries()) {
      const st = this.stats.get(id);
      const name = st?.name || player.name || `Player-${id.slice(0, 4)}`;
      const moves = st?.moves ?? 0;
      const playMs =
        (st?.playMsAcc ?? 0) +
        Math.max(0, nowMs - (st?.connectedAtMs ?? nowMs));
      const minutes = Math.max(1, playMs / 60000);
      const score = moves / minutes;

      entries.push({ id, name, moves, playMs, score });
    }

    entries.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.moves !== a.moves) return b.moves - a.moves;
      return b.playMs - a.playMs;
    });

    return entries.slice(0, 10);
  }

  broadcastLeaderboard() {
    const now = Date.now();
    const entries = this.computeLeaderboard(now);
    this.room.broadcast(
      JSON.stringify({
        type: "leaderboard",
        entries,
      } satisfies LeaderboardMessage)
    );
  }

  onConnect(conn: Party.Connection) {
    console.log(`[PartyKit] Player connected: ${conn.id}`);

    // Track playtime while connected.
    const existing = this.stats.get(conn.id);
    if (existing) {
      existing.connectedAtMs = Date.now();
    } else {
      this.stats.set(conn.id, {
        name: `Player-${conn.id.slice(0, 4)}`,
        moves: 0,
        playMsAcc: 0,
        connectedAtMs: Date.now(),
      });
    }

    // Start periodic leaderboard updates (for playtime ticking up).
    if (!this.leaderboardTimer) {
      this.leaderboardTimer = setInterval(() => {
        if (!this.players.size) return;
        this.broadcastLeaderboard();
      }, 5000);
    }

    // Send current state to new connection
    const players: Record<string, Player> = {};
    this.players.forEach((player, id) => {
      players[id] = player;
    });

    conn.send(
      JSON.stringify({
        type: "sync",
        players,
        chat: this.chat,
        boardModes: this.boardModes,
      })
    );

    // Also send the current leaderboard snapshot.
    conn.send(
      JSON.stringify({
        type: "leaderboard",
        entries: this.computeLeaderboard(Date.now()),
      } satisfies LeaderboardMessage)
    );
  }

  onMessage(message: string, sender: Party.Connection) {
    try {
      const msg = JSON.parse(message) as Message;

      if (msg.type === "hello") {
        // Check if room is full
        if (this.players.size >= RoomServer.MAX_PLAYERS) {
          sender.send(
            JSON.stringify({
              type: "error",
              message: "room-full",
              reason: "This room has reached maximum capacity (16 players)",
            })
          );
          sender.close();
          return;
        }

        // New player joined
        const player: Player = {
          id: sender.id,
          name: msg.name,
          color: msg.color,
          gender: msg.gender,
          avatarUrl: msg.avatarUrl,
          position: [0, 0, 0],
          rotY: 0,
        };
        this.players.set(sender.id, player);

        const st = this.stats.get(sender.id);
        if (st) st.name = msg.name;

        // Broadcast to all except sender
        this.room.broadcast(JSON.stringify({ type: "player-joined", player }), [
          sender.id,
        ]);

        this.broadcastLeaderboard();
      } else if (msg.type === "activity:move") {
        const st = this.stats.get(sender.id);
        if (st) st.moves += 1;
        this.broadcastLeaderboard();
      } else if (msg.type === "state") {
        // Update player position
        const player = this.players.get(sender.id);
        if (player) {
          player.position = msg.position;
          player.rotY = msg.rotY;

          // Broadcast position update
          this.room.broadcast(
            JSON.stringify({
              type: "player-moved",
              id: sender.id,
              position: msg.position,
              rotY: msg.rotY,
            }),
            [sender.id]
          );
        }
      } else if (msg.type === "chat") {
        const player = this.players.get(sender.id);
        if (!player) return;

        const text = (msg.text ?? "").toString().trim().slice(0, 160);
        if (!text) return;

        const chatMsg: ChatMessage = {
          id: `${Date.now().toString(36)}-${Math.random()
            .toString(36)
            .slice(2, 8)}`,
          fromId: sender.id,
          fromName: player.name,
          text,
          t: Date.now(),
        };

        this.chat.push(chatMsg);
        if (this.chat.length > 60) this.chat.splice(0, this.chat.length - 60);

        this.room.broadcast(JSON.stringify({ type: "chat", message: chatMsg }));
      } else if (msg.type === "board:set-mode") {
        const boardKey = (msg.boardKey ?? "").toString().trim().slice(0, 8);
        const mode: BoardMode =
          msg.mode === "checkers"
            ? "checkers"
            : msg.mode === "goose"
            ? "goose"
            : "chess";
        if (!boardKey) return;

        const prev = this.boardModes[boardKey] ?? "chess";
        if (prev === mode) return;
        this.boardModes[boardKey] = mode;

        this.room.broadcast(
          JSON.stringify({ type: "board:modes", boardModes: this.boardModes })
        );
      } else if (msg.type === "voice:offer" && msg.to) {
        // Relay WebRTC offer to target peer
        console.log(
          `[PartyKit Voice] Relaying offer: ${sender.id} -> ${msg.to}`
        );
        this.room.getConnection(msg.to)?.send(
          JSON.stringify({
            type: "voice:offer",
            from: sender.id,
            fromDeviceId: (msg as any).deviceId ?? null,
            offer: msg.offer,
          })
        );
      } else if (msg.type === "voice:answer" && msg.to) {
        // Relay WebRTC answer to target peer
        console.log(
          `[PartyKit Voice] Relaying answer: ${sender.id} -> ${msg.to}`
        );
        this.room.getConnection(msg.to)?.send(
          JSON.stringify({
            type: "voice:answer",
            from: sender.id,
            fromDeviceId: (msg as any).deviceId ?? null,
            answer: msg.answer,
          })
        );
      } else if (msg.type === "voice:ice" && msg.to) {
        // Relay ICE candidate to target peer
        this.room.getConnection(msg.to)?.send(
          JSON.stringify({
            type: "voice:ice",
            from: sender.id,
            fromDeviceId: (msg as any).deviceId ?? null,
            candidate: msg.candidate,
          })
        );
      } else if (msg.type === "voice:hangup" && msg.to) {
        // Ask target peer to close their voice connection to the sender
        this.room.getConnection(msg.to)?.send(
          JSON.stringify({
            type: "voice:hangup",
            from: sender.id,
            reason: msg.reason ?? null,
          })
        );
      } else if (msg.type === "voice:request-connections") {
        // Tell selected peers (or everyone) to initiate connection to this sender
        const requestedPeers = Array.isArray(msg.peers) ? msg.peers : null;
        const others = (requestedPeers ?? Array.from(this.players.keys()))
          .filter((id) => id !== sender.id)
          .filter((id) => this.players.has(id));
        console.log(
          `[PartyKit Voice] ${sender.id} requesting connections to ${others.length} peers:`,
          others
        );
        for (const peerId of others) {
          console.log(
            `[PartyKit Voice] Telling ${peerId} to connect to ${sender.id}`
          );
          this.room.getConnection(peerId)?.send(
            JSON.stringify({
              type: "voice:request-connection",
              from: sender.id,
              fromDeviceId: (msg as any).deviceId ?? null,
            })
          );
        }
      }
    } catch (err) {
      console.error("[PartyKit] Error parsing message:", err);
    }
  }

  onClose(conn: Party.Connection) {
    console.log(`[PartyKit] Player disconnected: ${conn.id}`);

    const st = this.stats.get(conn.id);
    if (st) {
      const now = Date.now();
      st.playMsAcc += Math.max(0, now - st.connectedAtMs);
      st.connectedAtMs = now;
    }

    this.players.delete(conn.id);

    // Notify others
    this.room.broadcast(JSON.stringify({ type: "player-left", id: conn.id }));

    this.broadcastLeaderboard();

    if (!this.players.size && this.leaderboardTimer) {
      clearInterval(this.leaderboardTimer);
      this.leaderboardTimer = null;
    }
  }
}

RoomServer satisfies Party.Worker;
