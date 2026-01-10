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

type BoardMode = "chess" | "checkers" | "goose" | "puzzleRush";

type PuzzleRushDifficulty =
  | "easiest"
  | "easier"
  | "normal"
  | "harder"
  | "hardest";

type PuzzleRushNetState = {
  boardKey: string;
  seq: number;
  leaderConnId: string;
  running: boolean;
  endsAtMs: number | null;
  fen: string;
  turn: "w" | "b";
  score: number;
  difficulty: PuzzleRushDifficulty;
  puzzleId: string | null;
  lastMove: { from: string; to: string } | null;
};

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
  | { type: "puzzleRush:claim"; boardKey: string }
  | { type: "puzzleRush:state"; state: PuzzleRushNetState }
  | { type: "voice:offer"; to: string; offer: RTCSessionDescriptionInit }
  | { type: "voice:answer"; to: string; answer: RTCSessionDescriptionInit }
  | { type: "voice:ice"; to: string; candidate: RTCIceCandidateInit }
  | { type: "voice:hangup"; to: string; reason?: string }
  | { type: "voice:request-connections"; deviceId?: string; peers?: string[] }
  | { type: "discover:update"; roomId: string; playerCount: number };

type DiscoverSyncMessage = {
  type: "discover:sync";
  rooms: Record<string, { playerCount: number; lastSeen: number }>;
};

type LeaderboardMessage = { type: "leaderboard"; entries: LeaderboardEntry[] };

type PuzzleRushStateMessage = {
  type: "puzzleRush:state";
  state: PuzzleRushNetState;
};
type PuzzleRushClearMessage = { type: "puzzleRush:clear"; boardKey: string };

export default class RoomServer implements Party.Server {
  players: Map<string, Player> = new Map();
  chat: ChatMessage[] = [];
  boardModes: Record<string, BoardMode> = {
    a: "chess",
    b: "chess",
    c: "chess",
    d: "chess",
  };

  puzzleRushStates: Record<string, PuzzleRushNetState> = {};

  stats: Map<
    string,
    { name: string; moves: number; playMsAcc: number; connectedAtMs: number }
  > = new Map();
  leaderboardTimer: ReturnType<typeof setInterval> | null = null;

  // Discovery room state (only used when room id === 'room-discovery').
  discoveryReporters: Map<
    string,
    { roomId: string; playerCount: number; lastSeen: number }
  > = new Map();
  discoveryBroadcastTimer: ReturnType<typeof setTimeout> | null = null;

  static readonly MAX_PLAYERS = 16;

  constructor(readonly room: Party.Room) {}

  private sanitizeBoardKey(boardKey: unknown) {
    return (boardKey ?? "").toString().trim().slice(0, 8);
  }

  private broadcastPuzzleRushState(state: PuzzleRushNetState) {
    this.room.broadcast(
      JSON.stringify({
        type: "puzzleRush:state",
        state,
      } satisfies PuzzleRushStateMessage)
    );
  }

  private clearPuzzleRushState(boardKey: string) {
    if (!this.puzzleRushStates[boardKey]) return;
    delete this.puzzleRushStates[boardKey];
    this.room.broadcast(
      JSON.stringify({
        type: "puzzleRush:clear",
        boardKey,
      } satisfies PuzzleRushClearMessage)
    );
  }

  private isDiscoveryRoom() {
    // PartyKit room id is stable for the server instance.
    return this.room.id === "room-discovery";
  }

  private computeDiscoverySnapshot(): DiscoverSyncMessage {
    const agg = new Map<string, { playerCount: number; lastSeen: number }>();
    for (const rep of this.discoveryReporters.values()) {
      const roomId = (rep.roomId ?? "").toString().trim().slice(0, 64);
      if (!roomId) continue;
      const playerCount = Math.max(
        0,
        Math.min(RoomServer.MAX_PLAYERS, rep.playerCount || 0)
      );
      const lastSeen = rep.lastSeen || Date.now();

      const prev = agg.get(roomId);
      if (!prev) {
        agg.set(roomId, { playerCount, lastSeen });
      } else {
        // max avoids double counting across multiple reporters for the same room.
        prev.playerCount = Math.max(prev.playerCount, playerCount);
        prev.lastSeen = Math.max(prev.lastSeen, lastSeen);
      }
    }

    const rooms: Record<string, { playerCount: number; lastSeen: number }> = {};
    for (const [roomId, info] of agg.entries()) {
      rooms[roomId] = info;
    }
    return { type: "discover:sync", rooms };
  }

  private scheduleDiscoveryBroadcast() {
    if (this.discoveryBroadcastTimer) return;
    this.discoveryBroadcastTimer = setTimeout(() => {
      this.discoveryBroadcastTimer = null;
      const msg = this.computeDiscoverySnapshot();
      this.room.broadcast(JSON.stringify(msg));
    }, 150);
  }

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
    if (this.isDiscoveryRoom()) {
      conn.send(JSON.stringify(this.computeDiscoverySnapshot()));
      return;
    }
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
        puzzleRushStates: this.puzzleRushStates,
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

      if (this.isDiscoveryRoom()) {
        if (msg.type === "discover:update") {
          const roomId = (msg.roomId ?? "").toString().trim().slice(0, 64);
          const playerCount = Math.max(
            0,
            Math.min(RoomServer.MAX_PLAYERS, Number(msg.playerCount) || 0)
          );
          if (!roomId) return;

          this.discoveryReporters.set(sender.id, {
            roomId,
            playerCount,
            lastSeen: Date.now(),
          });
          this.scheduleDiscoveryBroadcast();
        }
        return;
      }

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
        const boardKey = this.sanitizeBoardKey(msg.boardKey);
        const mode: BoardMode =
          msg.mode === "checkers"
            ? "checkers"
            : msg.mode === "goose"
            ? "goose"
            : msg.mode === "puzzleRush"
            ? "puzzleRush"
            : "chess";
        if (!boardKey) return;

        const prev = this.boardModes[boardKey] ?? "chess";
        if (prev === mode) return;
        this.boardModes[boardKey] = mode;

        // Leaving Puzzle Rush clears shared state for that board.
        if (prev === "puzzleRush" && mode !== "puzzleRush") {
          this.clearPuzzleRushState(boardKey);
        }

        this.room.broadcast(
          JSON.stringify({ type: "board:modes", boardModes: this.boardModes })
        );
      } else if (msg.type === "puzzleRush:claim") {
        const boardKey = this.sanitizeBoardKey(msg.boardKey);
        if (!boardKey) return;
        if ((this.boardModes[boardKey] ?? "chess") !== "puzzleRush") return;

        const existing = this.puzzleRushStates[boardKey];
        const leaderAlive = existing?.leaderConnId
          ? Boolean(this.room.getConnection(existing.leaderConnId))
          : false;

        if (!existing || !leaderAlive) {
          const next: PuzzleRushNetState = {
            boardKey,
            seq: (existing?.seq ?? 0) + 1,
            leaderConnId: sender.id,
            running: false,
            endsAtMs: null,
            fen:
              existing?.fen ??
              "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
            turn: existing?.turn ?? "w",
            score: existing?.score ?? 0,
            difficulty: existing?.difficulty ?? "easiest",
            puzzleId: existing?.puzzleId ?? null,
            lastMove: existing?.lastMove ?? null,
          };
          this.puzzleRushStates[boardKey] = next;
          this.broadcastPuzzleRushState(next);
        } else {
          // Leader already exists; just re-broadcast authoritative state.
          this.broadcastPuzzleRushState(existing);
        }
      } else if (msg.type === "puzzleRush:state") {
        const st = msg.state as PuzzleRushNetState;
        const boardKey = this.sanitizeBoardKey(st?.boardKey);
        if (!boardKey) return;
        if ((this.boardModes[boardKey] ?? "chess") !== "puzzleRush") return;

        const existing = this.puzzleRushStates[boardKey];
        if (!existing) return;
        if (existing.leaderConnId !== sender.id) return;

        const safe: PuzzleRushNetState = {
          boardKey,
          seq: Math.max(existing.seq + 1, Number(st.seq) || 0),
          leaderConnId: sender.id,
          running: Boolean(st.running),
          endsAtMs:
            st.endsAtMs === null || st.endsAtMs === undefined
              ? null
              : Number(st.endsAtMs) || null,
          fen: (st.fen ?? "").toString().slice(0, 128),
          turn: st.turn === "b" ? "b" : "w",
          score: Math.max(0, Math.floor(Number(st.score) || 0)),
          difficulty:
            st.difficulty === "hardest"
              ? "hardest"
              : st.difficulty === "harder"
              ? "harder"
              : st.difficulty === "normal"
              ? "normal"
              : st.difficulty === "easier"
              ? "easier"
              : "easiest",
          puzzleId: st.puzzleId
            ? (st.puzzleId ?? "").toString().slice(0, 16)
            : null,
          lastMove:
            st.lastMove && (st.lastMove as any).from && (st.lastMove as any).to
              ? {
                  from: ((st.lastMove as any).from ?? "")
                    .toString()
                    .slice(0, 2),
                  to: ((st.lastMove as any).to ?? "").toString().slice(0, 2),
                }
              : null,
        };

        this.puzzleRushStates[boardKey] = safe;
        this.broadcastPuzzleRushState(safe);
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
    if (this.isDiscoveryRoom()) {
      this.discoveryReporters.delete(conn.id);
      this.scheduleDiscoveryBroadcast();
      return;
    }
    console.log(`[PartyKit] Player disconnected: ${conn.id}`);

    const st = this.stats.get(conn.id);
    if (st) {
      const now = Date.now();
      st.playMsAcc += Math.max(0, now - st.connectedAtMs);
      st.connectedAtMs = now;
    }

    this.players.delete(conn.id);

    // If a leader disconnects, clear the board's Puzzle Rush state.
    for (const [boardKey, st] of Object.entries(this.puzzleRushStates)) {
      if (st.leaderConnId === conn.id) {
        this.clearPuzzleRushState(boardKey);
      }
    }

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
