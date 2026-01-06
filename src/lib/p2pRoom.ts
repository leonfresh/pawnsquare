"use client";

// Legacy compatibility shim.
// The app now uses PartyKit for realtime multiplayer, and Trystero/torrent has
// been removed to avoid WebTorrent tracker traffic and related hitches.
export { usePartyRoom as useP2PRoom } from "./partyRoom";
