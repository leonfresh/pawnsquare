import type { Metadata } from "next";
import Link from "next/link";
import { PLAY_4P_URL, PLAY_CHESS_URL } from "@/lib/seo";
import { PageTitle, PrimaryCtas, Section } from "../_seo/ui";
import styles from "../seo.module.css";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "How PawnSquare works: rooms, channels, sitting at boards, switching modes, and inviting friends with a link.",
  alternates: { canonical: "/how-it-works" },
};

export default function HowItWorksPage() {
  return (
    <>
      <PageTitle
        title="How PawnSquare Works"
        subtitle="A quick guide to rooms, boards, and switching game modes."
      />

      <PrimaryCtas
        primary={{ href: PLAY_CHESS_URL, label: "Play now (Chess room)" }}
        secondary={{ href: PLAY_4P_URL, label: "Play now (4P room)" }}
      />

      <Section title="Rooms and channels">
        <p className={styles.p}>
          PawnSquare is organized into room links (URLs). When you open a room,
          you’re joining a shared 3D space where people can gather and sit down
          at boards.
        </p>
        <p className={styles.p}>
          Normal rooms are split into channels like <strong>CH.1</strong>,{" "}
          <strong>CH.2</strong>, and so on. Think of channels as separate tables
          within the same hangout — useful when you want multiple games running
          at once without everyone crowding the same spot.
        </p>
        <p className={styles.p}>
          4‑Player Chess uses a separate room base so those matches stay focused
          and easier to find.
        </p>
      </Section>

      <Section title="Boards and modes">
        <p className={styles.p}>
          In normal rooms, multiple boards are available. Walk up, sit at a
          board, then choose a mode — Chess, Goose Chess, or Checkers. You can
          leave and switch boards at any time.
        </p>
        <p className={styles.p}>
          The “mode pages” explain the rules and what’s special about each
          experience:
        </p>
        <ul className={styles.list}>
          <li>
            <Link href="/chess">Chess</Link> (classic multiplayer)
          </li>
          <li>
            <Link href="/4-player-chess">4‑Player Chess</Link> (free‑for‑all)
          </li>
          <li>
            <Link href="/goose-chess">Goose Chess</Link> (chaos variant)
          </li>
          <li>
            <Link href="/checkers">Checkers</Link> (quick matches)
          </li>
        </ul>
      </Section>

      <Section title="Inviting friends">
        <p className={styles.p}>
          The simplest invite is to share the room URL from your browser. Anyone
          with the link can join the same space instantly — no downloads.
        </p>
        <p className={styles.p}>
          If you want a friend to understand what you’re inviting them into
          (before they click a room link), share <Link href="/play">/play</Link>
          . It’s the overview page that explains the vibe and the modes.
        </p>
      </Section>

      <Section title="Need help?">
        <p className={styles.p}>
          Check the <Link href="/faq">FAQ</Link>. If something feels confusing,
          the most common fix is to start from <Link href="/play">/play</Link>
          and pick the mode you actually want, then use the “Play now” button.
        </p>
      </Section>
    </>
  );
}
