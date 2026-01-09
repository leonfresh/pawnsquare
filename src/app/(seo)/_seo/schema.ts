import { absoluteUrl, SITE_NAME } from "@/lib/seo";
import type { FaqItem } from "./types";

export function videoGameSchema(opts: {
  name: string;
  description: string;
  urlPath: string;
  genre?: string[];
}) {
  return {
    "@context": "https://schema.org",
    "@type": "VideoGame",
    name: opts.name,
    description: opts.description,
    url: absoluteUrl(opts.urlPath),
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      url: absoluteUrl("/"),
    },
    genre: opts.genre ?? ["Board game", "Multiplayer"],
    playMode: "MultiPlayer",
    applicationCategory: "GameApplication",
    operatingSystem: "Web",
  };
}

export function faqPageSchema(opts: { urlPath: string; faqs: FaqItem[] }) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: opts.faqs.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
    url: absoluteUrl(opts.urlPath),
  };
}
