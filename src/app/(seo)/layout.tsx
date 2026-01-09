import type { ReactNode } from "react";
import Link from "next/link";
import styles from "./seo.module.css";
import AmbientShapes from "./_seo/ambient-shapes";

export const dynamic = "force-static";

export default function SeoLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <div className={styles.bg} aria-hidden="true">
        <div className={styles.bgGradients} />
        <AmbientShapes className={styles.bgCanvas} />
        <div className={styles.bgWash} />
      </div>
      <div className={styles.container}>
        <header className={styles.topbar}>
          <Link href="/" className={styles.brand}>
            PawnSquare
          </Link>
          <nav className={styles.nav} aria-label="Primary">
            <Link href="/play">Play</Link>
            <Link href="/chess">Chess</Link>
            <Link href="/4-player-chess">4P</Link>
            <Link href="/goose-chess">Goose</Link>
            <Link href="/checkers">Checkers</Link>
            <Link href="/faq">FAQ</Link>
          </nav>
        </header>

        <main>{children}</main>

        <footer className={styles.footer}>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <span>© {new Date().getFullYear()} PawnSquare</span>
        </footer>
      </div>
    </div>
  );
}
