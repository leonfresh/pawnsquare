import type { Metadata } from "next";
import {
  DEFAULT_DESCRIPTION,
  PLAY_4P_URL,
  PLAY_CHESS_URL,
  SITE_NAME,
} from "@/lib/seo";
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

const title = "Play in your browser";
const description =
  "Instant browser play for Chess, 4‑Player Chess, Goose Chess, and Checkers in a chill metaverse lobby. Create a room or join a public channel.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/play" },
  openGraph: { title: `${title} | ${SITE_NAME}`, description, url: "/play" },
};

const faqs = [
  {
    question: "Do I need to install anything?",
    answer: "No—PawnSquare runs in your browser.",
  },
  {
    question: "Can I play with friends?",
    answer: "Yes. Share a room link to bring friends into the same world.",
  },
  {
    question: "Is it free?",
    answer: "The game is playable for free in-browser.",
  },
  {
    question: "What game modes are available?",
    answer:
      "Chess, 4‑Player Chess, Goose Chess, and Checkers. You can switch boards/modes inside the world.",
  },
  {
    question: "What is the ‘metaverse’ part?",
    answer:
      "It’s a shared 3D lobby where players hang out and sit at boards to play.",
  },
] as const;

export default function PlayPage() {
  return (
    <>
      <JsonLd
        data={videoGameSchema({
          name: SITE_NAME,
          description: DEFAULT_DESCRIPTION,
          urlPath: "/play",
          genre: ["Board game", "Multiplayer", "Social"],
        })}
      />
      <JsonLd data={faqPageSchema({ urlPath: "/play", faqs: [...faqs] })} />

      <PageTitle
        title="Play Chess Variants in Your Browser"
        subtitle="Frictionless multiplayer in a chill 3D world—join a room and start playing."
      />

      <PrimaryCtas
        primary={{ href: PLAY_CHESS_URL, label: "Play now (Chess room)" }}
        secondary={{ href: PLAY_4P_URL, label: "Play now (4P room)" }}
      />

      <Section title="What is PawnSquare?">
        <p className={styles.p}>
          PawnSquare is a frictionless browser-first multiplayer world built
          around classic board games and chess variants. You join a shared 3D
          lobby, walk up to a board, sit down, and start playing—no installs, no
          waiting for an app store download, and no “invite code” ceremony.
        </p>
        <p className={styles.p}>
          The goal is simple: make it as easy as possible to get friends into
          the same place. A room link is the invite. The lobby is the hangout.
          The boards are the activity.
        </p>
        <p className={styles.p}>{description}</p>
        <ModeLinks />
      </Section>

      <Section title="Choose your mode">
        <p className={styles.p}>
          PawnSquare supports multiple modes. Some are “classic” (like Chess and
          Checkers). Others are variants that create fresh tactics (like Goose
          Chess) or a different social dynamic (like 4‑Player Chess).
        </p>
        <ul className={styles.list}>
          <li>
            <strong>Chess</strong>: the baseline—perfect for quick matches and
            friendly rivalry.
          </li>
          <li>
            <strong>4‑Player Chess</strong>: higher chaos, more negotiation, and
            a room vibe that feels like a party game.
          </li>
          <li>
            <strong>Goose Chess</strong>: a chess variant that changes how
            threats and movement constraints feel; best learned by playing.
          </li>
          <li>
            <strong>Checkers</strong>: fast, simple, and surprisingly tactical.
          </li>
        </ul>
      </Section>

      <Section title="Rooms, channels, and frictionless invites">
        <p className={styles.p}>
          PawnSquare is organized into <strong>rooms</strong>—URLs you can
          share. Some rooms have <strong>channels</strong> (like CH.1, CH.2,
          CH.3) to keep the experience smooth when lots of people show up at
          once. You can think of a channel as another copy of the same lobby.
        </p>
        <p className={styles.p}>
          For organic growth, this matters: every time you share a link in
          Discord or text, it needs to “just work.” That’s the entire product
          premise. The SEO pages are here to help people discover PawnSquare,
          but the invite loop is what turns discovery into real players.
        </p>
      </Section>

      <Section title="Screenshots (placeholders)">
        <ScreenshotPlaceholders slug="play" />
      </Section>

      <Section title="How to play">
        <ol className={styles.list}>
          <li>
            Open a room: start with the Chess room for the most options, or jump
            straight into the 4‑Player room.
          </li>
          <li>Walk up to a board and sit down.</li>
          <li>
            Choose your mode at the board (Chess / Goose / Checkers). In normal
            rooms, multiple boards can run in parallel.
          </li>
          <li>
            Invite friends by sharing the room link. They land in the same
            lobby.
          </li>
          <li>
            Play, chat, watch other boards, and swap seats whenever you want.
          </li>
        </ol>
      </Section>

      <Section title="Why SEO pages exist (and what to expect)">
        <p className={styles.p}>
          A common SEO myth is that every page needs 1,500–2,000 words. What
          search engines actually reward is: a clear match to the query,
          genuinely useful content, fast load, and good engagement. Long pages
          can help when they’re thorough—but only if the content is real.
        </p>
        <p className={styles.p}>
          These pages aim to be “complete enough” that someone searching for
          “play 4 player chess online” or “goose chess online” gets what they
          need: what it is, why it’s fun, and a one-click path to start playing.
        </p>
      </Section>

      <Section title="FAQ">
        <Faq items={[...faqs]} />
      </Section>
    </>
  );
}
