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

type Message =
  | {
      type: "hello";
      name: string;
      color: string;
      gender: "male" | "female";
      avatarUrl?: string;
    }
  | { type: "state"; position: [number, number, number]; rotY: number }
  | { type: "chat"; text: string }
  | { type: "sync"; players: Record<string, Player>; chat: ChatMessage[] }
  | { type: "voice:offer"; to: string; offer: RTCSessionDescriptionInit }
  | { type: "voice:answer"; to: string; answer: RTCSessionDescriptionInit }
  | { type: "voice:ice"; to: string; candidate: RTCIceCandidateInit }
  | { type: "voice:request-connections"; deviceId?: string };

export default class RoomServer implements Party.Server {
  players: Map<string, Player> = new Map();
  chat: ChatMessage[] = [];

  constructor(readonly room: Party.Room) {}

  onConnect(conn: Party.Connection) {
    console.log(`[PartyKit] Player connected: ${conn.id}`);

    // Send current state to new connection
    const players: Record<string, Player> = {};
    this.players.forEach((player, id) => {
      players[id] = player;
    });

    conn.send(JSON.stringify({ type: "sync", players, chat: this.chat }));
  }

  onMessage(message: string, sender: Party.Connection) {
    try {
      const msg = JSON.parse(message) as Message;

      if (msg.type === "hello") {
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

        // Broadcast to all except sender
        this.room.broadcast(JSON.stringify({ type: "player-joined", player }), [
          sender.id,
        ]);
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
      } else if (msg.type === "voice:request-connections") {
        // Tell all other peers to initiate connection to this sender
        const others = Array.from(this.players.keys()).filter(
          (id) => id !== sender.id
        );
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
    this.players.delete(conn.id);

    // Notify others
    this.room.broadcast(JSON.stringify({ type: "player-left", id: conn.id }));
  }
}

RoomServer satisfies Party.Worker;
