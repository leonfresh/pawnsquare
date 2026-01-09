import Link from "next/link";
import type { ReactNode } from "react";
import type { FaqItem } from "./types";
import styles from "../seo.module.css";

export function PageTitle({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className={styles.hero}>
      <div className={styles.kicker}>Browser multiplayer</div>
      <h1 className={styles.h1}>{title}</h1>
      {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
    </div>
  );
}

export function PrimaryCtas({
  primary,
  secondary,
}: {
  primary: { href: string; label: string };
  secondary?: { href: string; label: string };
}) {
  return (
    <div className={styles.ctaRow}>
      <Link
        href={primary.href}
        className={`${styles.btn} ${styles.btnPrimary}`}
      >
        {primary.label}
      </Link>
      {secondary ? (
        <Link
          href={secondary.href}
          className={`${styles.btn} ${styles.btnSecondary}`}
        >
          {secondary.label}
        </Link>
      ) : null}
    </div>
  );
}

export function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.section}>
      <h2 className={styles.h2}>{title}</h2>
      {children}
    </section>
  );
}

export function ScreenshotPlaceholders({ slug }: { slug: string }) {
  const base = `/seo/screenshots/${slug}`;
  const items = [
    { src: `${base}/01-hero.webp`, label: "Hero" },
    { src: `${base}/02-lobby.webp`, label: "Lobby" },
    { src: `${base}/03-gameplay.webp`, label: "Gameplay" },
  ];

  return (
    <div className={styles.screenshotGrid}>
      {items.map((it) => (
        <div key={it.src} className={styles.screenshotCard}>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>{it.label}</div>
          <div className={styles.small} style={{ wordBreak: "break-all" }}>
            {it.src}
          </div>
          <div className={styles.small} style={{ marginTop: 10 }}>
            (Add the image later; this is a placeholder reference.)
          </div>
        </div>
      ))}
    </div>
  );
}

export function Faq({ items }: { items: FaqItem[] }) {
  return (
    <div className={styles.faq}>
      {items.map((f) => (
        <details key={f.question} className={styles.faqItem}>
          <summary className={styles.faqSummary}>{f.question}</summary>
          <div className={styles.faqBody}>{f.answer}</div>
        </details>
      ))}
    </div>
  );
}

export function ModeLinks() {
  return (
    <p className={styles.p}>
      Modes: <Link href="/chess">Chess</Link>,{" "}
      <Link href="/4-player-chess">4‑Player Chess</Link>,{" "}
      <Link href="/goose-chess">Goose Chess</Link>,{" "}
      <Link href="/checkers">Checkers</Link>.
    </p>
  );
}
