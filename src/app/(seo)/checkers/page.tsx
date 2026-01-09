import type { Metadata } from "next";
import { PLAY_CHESS_URL, SITE_NAME } from "@/lib/seo";
import styles from "../seo.module.css";
import { JsonLd } from "../_seo/jsonld";
import { faqPageSchema, videoGameSchema } from "../_seo/schema";
import {
  Faq,
  PageTitle,
  PrimaryCtas,
  ScreenshotPlaceholders,
  Section,
} from "../_seo/ui";

export const dynamic = "force-static";

const title = "Play Checkers Online";
const description =
  "Play checkers online in your browser. Join a room, sit at a board, and switch the board to Checkers mode.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/checkers" },
  openGraph: {
    title: `${title} | ${SITE_NAME}`,
    description,
    url: "/checkers",
  },
};

const faqs = [
  {
    question: "How do I start a checkers game?",
    answer:
      "Join a room, sit at a board, then choose ‘Checkers’ from the mode selector.",
  },
  {
    question: "Can I play checkers with friends?",
    answer: "Yes—share the room link so friends join instantly.",
  },
  {
    question: "Does it work on mobile?",
    answer:
      "It runs in the browser; device support depends on your browser and performance.",
  },
  {
    question: "Is it free?",
    answer: "The game is playable for free in-browser.",
  },
] as const;

export default function CheckersPage() {
  return (
    <>
      <JsonLd
        data={videoGameSchema({
          name: `${SITE_NAME} — Checkers`,
          description,
          urlPath: "/checkers",
          genre: ["Board game", "Checkers", "Multiplayer"],
        })}
      />
      <JsonLd data={faqPageSchema({ urlPath: "/checkers", faqs: [...faqs] })} />

      <PageTitle
        title="Play Checkers Online (Browser Multiplayer)"
        subtitle="Join a room, switch a board to Checkers, and invite friends with a link."
      />
      <PrimaryCtas primary={{ href: PLAY_CHESS_URL, label: "Play now" }} />

      <Section title="How to play">
        <p className={styles.p}>
          Checkers is one of the best “meetup games” on the internet: quick to
          understand, fast to finish, and still deep enough to reward practice.
          If you’re searching for “play checkers online”, you probably want
          something that loads instantly and lets you play with friends. That’s
          exactly what PawnSquare is built for.
        </p>
        <ol className={styles.list}>
          <li>Enter a normal room (Chess room).</li>
          <li>Sit at a board.</li>
          <li>Select ‘Checkers’ from the mode selector.</li>
          <li>Share the room link to bring friends in.</li>
        </ol>
      </Section>

      <Section title="Why play checkers in a shared lobby?">
        <p className={styles.p}>
          Traditional online checkers is usually a single screen: you finish a
          game and you’re done. In PawnSquare, the board is part of a shared
          space. That means you can spectate, chat, and keep a group together
          across multiple rounds—like a real table.
        </p>
      </Section>

      <Section title="Screenshots (placeholders)">
        <ScreenshotPlaceholders slug="checkers" />
      </Section>

      <Section title="FAQ">
        <Faq items={[...faqs]} />
      </Section>
    </>
  );
}
