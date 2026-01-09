import type { Metadata } from "next";
import { PLAY_CHESS_URL, SITE_NAME } from "@/lib/seo";
import styles from "../seo.module.css";
import { JsonLd } from "../_seo/jsonld";
import { faqPageSchema, videoGameSchema } from "../_seo/schema";
import {
  Faq,
  ModeLinks,
  PageTitle,
  PrimaryCtas,
  ScreenshotPlaceholders,
  Section,
} from "../_seo/ui";

export const dynamic = "force-static";

const title = "Chill metaverse games";
const description =
  "A chill, shared 3D lobby where you can hang out and play board games together—frictionless browser play and room-link invites.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/chill-metaverse-games" },
  openGraph: {
    title: `${title} | ${SITE_NAME}`,
    description,
    url: "/chill-metaverse-games",
  },
};

const faqs = [
  {
    question: "Is this actually a metaverse?",
    answer:
      "Think of it as a shared 3D hangout space where you jump between boards and play together.",
  },
  {
    question: "Do I need to download anything?",
    answer: "No—PawnSquare runs in the browser.",
  },
  {
    question: "What can I do in the lobby?",
    answer:
      "Hang out, chat, watch games, and sit at boards to play different modes.",
  },
  {
    question: "Can I invite friends?",
    answer: "Yes—share your room link.",
  },
] as const;

export default function ChillMetaverseGamesPage() {
  return (
    <>
      <JsonLd
        data={videoGameSchema({
          name: `${SITE_NAME} — Chill Metaverse Board Games`,
          description,
          urlPath: "/chill-metaverse-games",
          genre: ["Social", "Multiplayer", "Board game"],
        })}
      />
      <JsonLd
        data={faqPageSchema({
          urlPath: "/chill-metaverse-games",
          faqs: [...faqs],
        })}
      />

      <PageTitle
        title="Chill Metaverse Games (In Your Browser)"
        subtitle="A low-friction 3D hangout space that turns board games into a social activity."
      />
      <PrimaryCtas
        primary={{ href: PLAY_CHESS_URL, label: "Enter the world" }}
      />

      <Section title="What you can play">
        <p className={styles.p}>
          PawnSquare is a chill browser “metaverse-style” hangout where the main
          activities are board games. Instead of jumping between separate game
          menus, you’re in one shared place: walk around, sit at a board, and
          play.
        </p>
        <ModeLinks />
      </Section>

      <Section title="Why this works for friends">
        <p className={styles.p}>
          If you’re looking for chill metaverse games, you’re usually not
          looking for a massive MMO. You’re looking for a lightweight place to
          meet up—like a digital park bench—where there’s something to do
          together.
        </p>
        <ul className={styles.list}>
          <li>
            <strong>One link</strong> gets everyone into the same lobby.
          </li>
          <li>
            <strong>Ambient hangout energy</strong>: spectate, chat, and rotate
            opponents.
          </li>
          <li>
            <strong>Multiple games</strong> without leaving: switch a board’s
            mode and keep going.
          </li>
        </ul>
      </Section>

      <Section title="What ‘metaverse’ means here">
        <p className={styles.p}>
          PawnSquare isn’t trying to be a fully-fledged “everything world.” It’s
          a focused shared space built around real-time multiplayer rooms and
          low-friction play. That’s why it works as an organic-growth project:
          people can discover it via search, click once, and immediately
          understand what it is.
        </p>
      </Section>

      <Section title="Screenshots (placeholders)">
        <ScreenshotPlaceholders slug="chill-metaverse-games" />
      </Section>

      <Section title="FAQ">
        <Faq items={[...faqs]} />
      </Section>
    </>
  );
}
