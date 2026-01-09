import type { Metadata } from "next";
import { SITE_NAME } from "@/lib/seo";
import { PageTitle, Section } from "../_seo/ui";
import styles from "../seo.module.css";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: `Privacy policy for ${SITE_NAME}.`,
  alternates: { canonical: "/privacy" },
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  return (
    <>
      <PageTitle
        title="Privacy Policy"
        subtitle="A simple template page you can finalize later."
      />

      <Section title="Summary">
        <p className={styles.p}>
          This page exists so {SITE_NAME} has a stable privacy URL for SEO and
          player trust. It’s written as a lightweight template — update it to
          match what you actually do (analytics, authentication, payments,
          logging, multiplayer networking, etc.).
        </p>
        <p className={styles.p}>
          If you’re not sure what applies, it’s safer to be specific and honest
          rather than broad and vague.
        </p>
      </Section>

      <Section title="What information could be involved">
        <p className={styles.p}>
          Depending on the features you enable, you may process some combination
          of:
        </p>
        <ul className={styles.list}>
          <li>
            Usage data (e.g., which pages are visited) if analytics are enabled.
          </li>
          <li>
            Multiplayer session data needed to run rooms (e.g., game state and
            synchronization events).
          </li>
          <li>
            Account information if a player signs in (e.g., email or profile
            fields).
          </li>
          <li>
            Purchase/payment metadata if you offer paid features (typically
            handled by a payment provider).
          </li>
        </ul>
      </Section>

      <Section title="Third-party services">
        <p className={styles.p}>
          If you use third-party providers (hosting, analytics, auth, payments),
          list them here and link to their policies. Also note what data flows
          to them and why.
        </p>
      </Section>

      <Section title="Retention and deletion">
        <p className={styles.p}>
          Add your retention approach here. Example: keep operational logs for a
          limited time for debugging/security, then delete or anonymize.
        </p>
      </Section>

      <Section title="Contact">
        <p className={styles.p}>Add a contact email address here.</p>
      </Section>
    </>
  );
}
