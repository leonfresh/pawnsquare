# PawnSquare — Evergreen SEO Growth Plan (Next.js + Vercel)

Goal: Create a small set of _indexable, high-intent_ SEO pages that can be shipped once and left mostly unattended, driving a steady trickle of organic traffic to frictionless browser play.

Scope constraints (important):

- No ongoing content marketing required.
- Pages must be **SSG/SSR with real HTML content** (not just a client-only canvas) or SEO will be weak.
- Use placeholders for screenshots/OG images now; you can replace later.

## 0) Positioning (one-liner)

“Frictionless browser play for chess variants (Chess, 4‑Player Chess, Goose Chess, Checkers) in a chill metaverse environment.”

Optional variants to test later:

- “A chill metaverse lobby for instant multiplayer chess variants.”
- “Play chess variants instantly in your browser—no installs, invite friends with a link.”

## 1) What we’re building

### A) SEO landing pages (indexable)

These are content pages with a clear CTA (“Play now”), screenshots, FAQ, and internal links.

### B) Technical SEO primitives

- `app/robots.ts`
- `app/sitemap.ts`
- `app/(...)` SEO routes with `export const dynamic = 'force-static'` or `generateStaticParams` where appropriate
- `metadata` (title/description/canonical/OG/Twitter)
- JSON-LD structured data (`VideoGame` + `FAQPage`)

### C) Shareability primitives (helps SEO indirectly)

- Strong OpenGraph image per page (placeholder first)
- Clear “Invite friends” CTA (already part of product, but ensure it exists on SEO pages)

## 2) Page map (the “articles” we will create)

Keep the set small and high-quality. Each page targets a distinct query cluster.

### Core landing pages (6)

1. `/play` — “Play in browser” (generic, strongest CTA)
   - Target intent: “play in browser”, “instant multiplayer”, “no download”
2. `/chess` — Normal chess in the metaverse lobby
   - Target: “play chess in browser with friends”, “multiplayer chess browser”
3. `/4-player-chess` — 4P chess
   - Target: “4 player chess online”, “multiplayer 4 player chess browser”
4. `/goose-chess` — Goose Chess
   - Target: “goose chess online”, “goose chess rules”, “play goose chess”
5. `/checkers` — Checkers
   - Target: “play checkers online with friends”, “browser checkers multiplayer”
6. `/chill-metaverse-games` — The vibe page (metaverse chill environment)
   - Target: “chill browser games”, “social metaverse browser game”, “hangout + board games”

### Support / trust pages (3–4)

These help conversions and credibility (and reduce thin-content signals). 7. `/how-it-works` — 1–2 minutes to understand the experience 8. `/faq` — consolidated FAQ (also used for schema) 9. `/privacy` — required for trust (and often for platforms) 10. `/terms` — optional but recommended

### Optional (only if you want 2 more pages)

11. `/chess-variants` — overview hub page that links to Chess / 4P / Goose / Checkers
12. `/rooms` or `/multiplayer-rooms` — join/create rooms, invite links, spectate

## 3) Content template for each SEO page (copy skeleton)

Each landing page should follow a consistent layout:

- H1: clear intent match (ex: “Play 4 Player Chess Online (In Your Browser)”)
- 2–3 sentence intro: what it is + why it’s fun + “no download”
- Primary CTA button: “Play now” (goes to actual game route)
- 3 feature bullets (keep concrete):
  - Instant browser play (no install)
  - Multiplayer rooms + share link
  - Chill metaverse environment / social lobby vibe
- Screenshot section (placeholders ok):
  - `public/seo/screenshots/<slug>/01-hero.webp`
  - `public/seo/screenshots/<slug>/02-lobby.webp`
  - `public/seo/screenshots/<slug>/03-gameplay.webp`
- “How to play” (5–7 steps)
- FAQ (5–8 questions) — unique per page
- Secondary links:
  - Link to the other modes
  - Link to `/faq`, `/privacy`

## 4) Screenshot + media placeholder plan

We’ll create placeholder paths and reference them in the pages so you can drop files in later.

Recommended filenames (per page slug):

- `public/seo/screenshots/<slug>/01-hero.webp`
- `public/seo/screenshots/<slug>/02-lobby.webp`
- `public/seo/screenshots/<slug>/03-gameplay.webp`

OG image placeholders (can be 1200×630 PNG or WebP):

- `public/seo/og/<slug>.png`

If you don’t have images yet:

- We can reference placeholders and fall back to a single sitewide OG image.

## 5) Technical implementation checklist (Next.js App Router)

### Step 1 — Decide canonical domain

- Choose one canonical domain (e.g. `https://pawnsquare.xyz`).
- Ensure Vercel redirects alternate domains → canonical.

### Step 2 — Global metadata + site config

- Add a single site config (site name, canonical base URL, social handles).
- Ensure `metadataBase` is set so OG URLs are absolute.

### Step 3 — `robots` + `sitemap`

- Implement `app/robots.ts` (allow indexing; disallow internal/private routes if any).
- Implement `app/sitemap.ts` listing all SEO pages + important app routes.

### Step 4 — Create SEO routes and keep them static

- Add the routes under `src/app/(seo)/...` (or directly under `src/app/...`).
- Ensure pages render meaningful HTML content.
- Ensure each page has:
  - unique `title`, `description`
  - canonical URL
  - OG/Twitter metadata

### Step 5 — Add JSON-LD structured data

Per page:

- `VideoGame` schema (name, description, url, genre, operatingSystem, applicationCategory)
- `FAQPage` schema for the on-page FAQ

### Step 6 — Internal linking

- Add links between all mode pages (a small “Modes” section).
- Add a hub page `/chess-variants` if desired.

### Step 7 — Verify performance basics

- Don’t ship huge client bundles for SEO pages.
- Use `next/image` for screenshots.
- Avoid rendering heavy 3D canvas on SEO pages; keep it content-first.

### Step 8 — Launch + index (one-time)

- Create Google Search Console property for the canonical domain.
- Submit sitemap: `https://<domain>/sitemap.xml`
- Inspect + request indexing for the 6 core pages.

## 6) Page-by-page outlines (draft copy prompts)

These are the “articles” with outlines we’ll implement.

### `/play` — Play in browser

- H1: “Play Chess Variants in Your Browser (No Download)”
- Sections: What is PawnSquare, Modes, Create/join rooms, Invite friends, FAQ
- FAQ ideas:
  - Is it free?
  - Do I need an account?
  - Can I play with friends?
  - Does it work on mobile?
  - Is it real-time multiplayer?

### `/chess` — Chess

- H1: “Play Chess Online in Your Browser (With Friends)”
- Sections: Classic chess rules summary, how rooms work, lobby vibe, FAQ
- FAQ ideas:
  - How do I start a private match?
  - Can friends spectate?
  - Time controls? (if applicable)

### `/4-player-chess`

- H1: “4 Player Chess Online (Instant Browser Play)”
- Sections: What makes 4P fun, room flow, strategy notes, FAQ
- FAQ ideas:
  - How many players can join?
  - Is it teams or free-for-all? (match your actual mode)
  - Can I invite friends with a link?

### `/goose-chess`

- H1: “Goose Chess Online — Rules + Instant Play”
- Sections: What Goose Chess is, core rules (short), how to play here, FAQ
- FAQ ideas:
  - What is Goose Chess?
  - How is it different from normal chess?
  - Can I play it online with friends?

### `/checkers`

- H1: “Play Checkers Online (Browser Multiplayer)”
- Sections: quick rules, rooms + invites, FAQ
- FAQ ideas:
  - Do you support kings / jumps rules? (match implementation)
  - Can I play on mobile?

### `/chill-metaverse-games`

- H1: “Chill Metaverse Games You Can Play in the Browser”
- Sections: vibe/atmosphere, social lobby, board games as activities, modes, FAQ
- FAQ ideas:
  - Is this a metaverse?
  - Do I need to install anything?
  - Can I just hang out and watch?

## 7) Minimal “leave it alone” maintenance plan

To truly park the project, do the following once:

- Add uptime monitoring (free tier) so you hear about outages.
- Set dependency update cadence (optional): one update every 3–6 months.
- Ensure billing/limits for realtime providers are safe.

## 8) Definition of done

- All 6 core pages are indexable and render meaningful HTML.
- `robots.txt` and `sitemap.xml` exist and validate.
- Each page has unique metadata + OG.
- Google Search Console sees the sitemap and starts indexing.

---

## Notes / inputs I will need before implementation

- Canonical production domain (exact URL).
- The correct “Play now” route(s) for each mode.
- Whether you want separate “Rules” pages (only if you want more SEO surface area).
