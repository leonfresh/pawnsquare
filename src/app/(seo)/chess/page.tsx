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

const title = "Play Chess Online";
const description =
  "Play chess online in your browser with friends—join a shared 3D lobby and sit at a board. No download.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/chess" },
  openGraph: { title: `${title} | ${SITE_NAME}`, description, url: "/chess" },
};

const faqs = [
  {
    question: "How do I play chess with friends?",
    answer:
      "Open a room and share the link—friends can join instantly in-browser.",
  },
  {
    question: "Do I need an account?",
    answer:
      "No—guest play works. If you sign in, you may unlock extra features.",
  },
  {
    question: "Can people spectate?",
    answer: "Yes—friends can join the same room and watch boards in the lobby.",
  },
  {
    question: "Is this standard chess?",
    answer:
      "Yes—classic chess is available, plus other variants like Goose Chess.",
  },
] as const;

export default function ChessPage() {
  return (
    <>
      <JsonLd
        data={videoGameSchema({
          name: `${SITE_NAME} — Chess`,
          description,
          urlPath: "/chess",
          genre: ["Board game", "Chess", "Multiplayer"],
        })}
      />
      <JsonLd data={faqPageSchema({ urlPath: "/chess", faqs: [...faqs] })} />

      <PageTitle
        title="Play Chess Online (In Your Browser)"
        subtitle="A shared 3D lobby + real-time boards. Join a room and start playing."
      />
      <PrimaryCtas primary={{ href: PLAY_CHESS_URL, label: "Play now" }} />

      <Section title="Why PawnSquare chess?">
        <p className={styles.p}>
          If you’re searching for “play chess online” you probably want one of
          two things: a fast match, or a way to play with friends without
          friction. PawnSquare focuses on the second—while still making it easy
          to jump into a live room.
        </p>
        <ul className={styles.list}>
          <li>
            <strong>Frictionless browser play</strong>: no install, no launcher.
          </li>
          <li>
            <strong>Room link invites</strong>: the URL is the invite, which is
            perfect for Discord groups.
          </li>
          <li>
            <strong>Chill lobby energy</strong>: hang out, watch boards, and
            rotate opponents without leaving the world.
          </li>
        </ul>
      </Section>

      <Section title="How multiplayer chess works here">
        <p className={styles.p}>
          You enter a room (often a public channel like CH.1), then sit at a
          board to start a match. Normal rooms can host multiple boards at once,
          which means a group can play in parallel—two people on one board,
          another pair on another board, and spectators roaming around.
        </p>
        <p className={styles.p}>
          If you want a private vibe, share a room link and treat it as your
          group’s hangout space. If you want quick opponents, pick a populated
          channel.
        </p>
      </Section>

      <Section title="Chess variants (optional, but fun)">
        <p className={styles.p}>
          Classic chess is the baseline, but you can also switch a board into
          variants like Goose Chess. Variants are a great way to keep casual
          groups engaged because they create novel moments and memorable
          highlights.
        </p>
      </Section>

      <Section title="Screenshots (placeholders)">
        <ScreenshotPlaceholders slug="chess" />
      </Section>

      <Section title="FAQ">
        <Faq items={[...faqs]} />
      </Section>
    </>
  );
}
