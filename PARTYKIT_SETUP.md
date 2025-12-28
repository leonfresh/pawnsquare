# PawnSquare - Multiplayer Chess Metaverse

## Quick Start (Local Development)

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Run both Next.js and PartyKit dev servers:**
   ```bash
   npm run dev
   ```
   
   This will start:
   - Next.js on `http://localhost:3000`
   - PartyKit on `http://localhost:1999`

3. **Open multiple browser windows** to `http://localhost:3000` to test multiplayer

## What Changed - PartyKit Architecture

The app now uses **PartyKit** instead of P2P WebRTC (Trystero), providing:

✅ **Reliable connections** - Works consistently on all networks
✅ **Works locally** - No NAT/firewall issues
✅ **Server-authoritative** - Chess moves validated on the server
✅ **Free hosting** - PartyKit has a generous free tier
✅ **Vercel-compatible** - Deploy PartyKit separately, works with Vercel frontend

### Architecture:
- **PartyKit Room Server** (`party/room.ts`) - Handles player positions/state
- **PartyKit Chess Server** (`party/chess.ts`) - Handles chess game logic
- **Next.js Frontend** - 3D world with Three.js/R3F

## Deploy to Production

### 1. Deploy PartyKit Backend:
```bash
npm run party:deploy
```

This will give you a URL like `your-project.partykit.dev`

### 2. Update Environment:
Create `.env.local`:
```
NEXT_PUBLIC_PARTYKIT_HOST=your-project.partykit.dev
```

### 3. Deploy Next.js to Vercel:
```bash
vercel deploy
```

Add the environment variable in Vercel dashboard:
- `NEXT_PUBLIC_PARTYKIT_HOST` = `your-project.partykit.dev`

## Features

- **3D Avatar System** - VRM avatars with procedural body generation
- **Multiplayer Chess** - Full chess implementation with server-side validation
- **Anime Colosseum** - Beautiful environment with pillars, benches, torches
- **Real-time Sync** - WebSocket-based multiplayer (no P2P issues!)

## Troubleshooting

**Issue:** Can't connect to other players
- Make sure `npm run dev` is running (starts both Next.js AND PartyKit)
- Check browser console for PartyKit connection logs
- Verify port 1999 isn't blocked by firewall

**Issue:** Chess moves not syncing
- Open browser console, look for `[Chess]` logs
- Make sure PartyKit server is running
- Try refreshing the page

## Development Notes

- PartyKit servers automatically reload when you save `party/*.ts` files
- Use browser dev tools Network tab to see WebSocket connections
- Check PartyKit logs in the terminal for server-side debugging
