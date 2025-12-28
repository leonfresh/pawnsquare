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

type Message =
  | { type: "hello"; name: string; color: string; gender: "male" | "female"; avatarUrl?: string }
  | { type: "state"; position: [number, number, number]; rotY: number }
  | { type: "sync"; players: Record<string, Player> };

export default class RoomServer implements Party.Server {
  players: Map<string, Player> = new Map();
  
  constructor(readonly room: Party.Room) {}

  onConnect(conn: Party.Connection) {
    console.log(`[PartyKit] Player connected: ${conn.id}`);
    
    // Send current state to new connection
    const players: Record<string, Player> = {};
    this.players.forEach((player, id) => {
      players[id] = player;
    });
    
    conn.send(JSON.stringify({ type: "sync", players }));
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
          position: [0, 0.5, 0],
          rotY: 0,
        };
        this.players.set(sender.id, player);
        
        // Broadcast to all except sender
        this.room.broadcast(
          JSON.stringify({ type: "player-joined", player }),
          [sender.id]
        );
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
      }
    } catch (err) {
      console.error("[PartyKit] Error parsing message:", err);
    }
  }

  onClose(conn: Party.Connection) {
    console.log(`[PartyKit] Player disconnected: ${conn.id}`);
    this.players.delete(conn.id);
    
    // Notify others
    this.room.broadcast(
      JSON.stringify({ type: "player-left", id: conn.id })
    );
  }
}

RoomServer satisfies Party.Worker;
