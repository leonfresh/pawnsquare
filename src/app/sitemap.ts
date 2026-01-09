import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/seo";

type Entry = {
  path: string;
  priority?: number;
  changeFrequency?: MetadataRoute.Sitemap[number]["changeFrequency"];
};

const PAGES: Entry[] = [
  { path: "/", priority: 1, changeFrequency: "weekly" },

  // SEO landing pages
  { path: "/play", priority: 0.9, changeFrequency: "monthly" },
  { path: "/chess", priority: 0.7, changeFrequency: "monthly" },
  { path: "/4-player-chess", priority: 0.7, changeFrequency: "monthly" },
  { path: "/goose-chess", priority: 0.7, changeFrequency: "monthly" },
  { path: "/checkers", priority: 0.7, changeFrequency: "monthly" },
  { path: "/chill-metaverse-games", priority: 0.6, changeFrequency: "monthly" },

  // Support / trust
  { path: "/how-it-works", priority: 0.4, changeFrequency: "yearly" },
  { path: "/faq", priority: 0.4, changeFrequency: "yearly" },
  { path: "/privacy", priority: 0.2, changeFrequency: "yearly" },
  { path: "/terms", priority: 0.2, changeFrequency: "yearly" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return PAGES.map((p) => ({
    url: `${SITE_URL}${p.path}`,
    lastModified: now,
    changeFrequency: p.changeFrequency,
    priority: p.priority,
  }));
}
