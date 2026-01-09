# SEO Media Placeholders

This folder is used by the static SEO landing pages.

## Screenshot placeholders

Each SEO page references up to three screenshots at predictable paths:

- `public/seo/screenshots/<slug>/01-hero.webp`
- `public/seo/screenshots/<slug>/02-lobby.webp`
- `public/seo/screenshots/<slug>/03-gameplay.webp`

Slugs used by current pages:

- `play`
- `chess`
- `4-player-chess`
- `goose-chess`
- `checkers`
- `chill-metaverse-games`

You can add these files later; missing images won’t block deploy, but they will 404 until you add them.

## OG images

OpenGraph/Twitter images are generated automatically via:

- `/opengraph-image`
- `/twitter-image`

So you don’t need to add image assets for link previews.
