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

const title = "Goose Chess Online";
const description =
  "Play Goose Chess online in your browser. Join a room, then switch a board to Goose mode inside the world.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/goose-chess" },
  openGraph: {
    title: `${title} | ${SITE_NAME}`,
    description,
    url: "/goose-chess",
  },
};

const faqs = [
  {
    question: "What is Goose Chess?",
    answer:
      "It’s a chess variant that adds a goose to the board, changing tactics and threats.",
  },
  {
    question: "How do I play Goose Chess in PawnSquare?",
    answer:
      "Join a room, sit at a board, then select ‘Goose’ from the mode buttons.",
  },
  {
    question: "Can I play Goose Chess with friends?",
    answer: "Yes—share your room link so friends join the same world.",
  },
  {
    question: "Do I need to install anything?",
    answer: "No—Goose Chess runs in your browser.",
  },
] as const;

export default function GooseChessPage() {
  return (
    <>
      <JsonLd
        data={videoGameSchema({
          name: `${SITE_NAME} — Goose Chess`,
          description,
          urlPath: "/goose-chess",
          genre: ["Board game", "Chess variant", "Multiplayer"],
        })}
      />
      <JsonLd
        data={faqPageSchema({ urlPath: "/goose-chess", faqs: [...faqs] })}
      />

      <PageTitle
        title="Goose Chess Online (Browser Play)"
        subtitle="Join a room, sit at a board, and switch to Goose mode."
      />
      <PrimaryCtas primary={{ href: PLAY_CHESS_URL, label: "Play now" }} />

      <Section title="How it works">
        <p className={styles.p}>
          Goose Chess is a chess variant designed to create “wait, what just
          happened?” moments—without needing a whole new rulebook. The easiest
          way to learn it is to play a few games: sit at a board, switch to
          Goose mode, and let the mechanics teach you.
        </p>
        <ol className={styles.list}>
          <li>Enter a chess room.</li>
          <li>Sit at any board.</li>
          <li>Select ‘Goose’ from the mode selector.</li>
          <li>Invite friends via the room link.</li>
        </ol>
      </Section>

      <Section title="Why people search for Goose Chess">
        <p className={styles.p}>
          Most players find Goose Chess because they want a variant that feels
          familiar (it’s still chess at the core) but breaks opening
          memorization and produces new tactical patterns. In groups, it’s also
          a great “party variant” because it creates surprises you can laugh
          about.
        </p>
        <p className={styles.p}>
          In PawnSquare, variants shine because the lobby makes it easy to
          rotate opponents and keep the vibe going—play one game of Goose, then
          switch back to classic chess or try checkers.
        </p>
      </Section>

      <Section title="Screenshots (placeholders)">
        <ScreenshotPlaceholders slug="goose-chess" />
      </Section>

      <Section title="FAQ">
        <Faq items={[...faqs]} />
      </Section>
    </>
  );
}
