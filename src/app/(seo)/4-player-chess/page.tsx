import type { Metadata } from "next";
import { PLAY_4P_URL, SITE_NAME } from "@/lib/seo";
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

const title = "4 Player Chess Online";
const description =
  "Play 4 player chess online in your browser—jump into a 4P room and start a match in a shared 3D lobby.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/4-player-chess" },
  openGraph: {
    title: `${title} | ${SITE_NAME}`,
    description,
    url: "/4-player-chess",
  },
};

const faqs = [
  {
    question: "How do I start a 4 player chess game?",
    answer: "Open the 4P room and sit at the 4-player board.",
  },
  {
    question: "Can I invite friends?",
    answer: "Yes—share the room link and friends can join instantly.",
  },
  {
    question: "Do I need to download an app?",
    answer: "No—4P chess runs in your browser.",
  },
  {
    question: "Is there a public 4P room?",
    answer: "Yes—the Play button takes you into a public 4P room/channel.",
  },
] as const;

export default function FourPlayerChessPage() {
  return (
    <>
      <JsonLd
        data={videoGameSchema({
          name: `${SITE_NAME} — 4 Player Chess`,
          description,
          urlPath: "/4-player-chess",
          genre: ["Board game", "Chess", "Multiplayer"],
        })}
      />
      <JsonLd
        data={faqPageSchema({ urlPath: "/4-player-chess", faqs: [...faqs] })}
      />

      <PageTitle
        title="Play 4 Player Chess Online"
        subtitle="Chaos, diplomacy, and tactics—jump into a 4P room in seconds."
      />
      <PrimaryCtas
        primary={{ href: PLAY_4P_URL, label: "Play now (4P room)" }}
      />

      <Section title="What to expect">
        <p className={styles.p}>
          4‑Player Chess is what happens when chess stops being purely “you vs
          them” and becomes a small social system. It’s tactical, but it’s also
          political: who’s ahead, who’s vulnerable, and who’s about to get
          teamed up on.
        </p>
        <ul className={styles.list}>
          <li>
            <strong>Instant browser play</strong>: open the room and start.
          </li>
          <li>
            <strong>Shared lobby</strong>: friends can join, watch, and rotate
            in.
          </li>
          <li>
            <strong>Room links</strong>: invite people in one message.
          </li>
        </ul>
      </Section>

      <Section title="How to play 4 player chess online">
        <ol className={styles.list}>
          <li>Click “Play now” to enter the public 4P room.</li>
          <li>Sit at the 4‑player board to join the match.</li>
          <li>Invite friends by sharing the room URL.</li>
          <li>
            If the room is busy, try another channel/room link to find an open
            seat.
          </li>
        </ol>
        <p className={styles.p}>
          The best way to think about 4P is: play solid, avoid early
          overextension, and keep an eye on who’s about to win—not just who’s
          attacking you.
        </p>
      </Section>

      <Section title="Why a 3D lobby helps">
        <p className={styles.p}>
          In a standard “table UI” 4P site, people tab out the moment they lose.
          A shared lobby changes the rhythm: players can spectate, talk, and
          jump into the next match. That keeps groups together longer, which is
          exactly what you want from a party-style board game.
        </p>
      </Section>

      <Section title="Screenshots (placeholders)">
        <ScreenshotPlaceholders slug="4-player-chess" />
      </Section>

      <Section title="FAQ">
        <Faq items={[...faqs]} />
      </Section>
    </>
  );
}
