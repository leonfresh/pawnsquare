import type { Metadata } from "next";
import { SITE_NAME } from "@/lib/seo";
import { PageTitle, Section } from "../_seo/ui";
import styles from "../seo.module.css";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: `Terms of service for ${SITE_NAME}.`,
  alternates: { canonical: "/terms" },
  robots: { index: true, follow: true },
};

export default function TermsPage() {
  return (
    <>
      <PageTitle
        title="Terms of Service"
        subtitle="A lightweight template you can finalize later."
      />

      <Section title="Summary">
        <p className={styles.p}>
          This page exists so {SITE_NAME} has a stable Terms URL for SEO and
          platform/trust needs. It’s a simple template — replace it with terms
          that match how your product actually works.
        </p>
      </Section>

      <Section title="Basic rules">
        <ul className={styles.list}>
          <li>Don’t abuse or harass other players.</li>
          <li>Don’t attempt to disrupt rooms or services.</li>
          <li>Use the game at your own risk.</li>
        </ul>
      </Section>

      <Section title="Accounts and access">
        <p className={styles.p}>
          If you offer sign-in or paid features, describe eligibility, account
          responsibilities, and how access may be suspended for abuse.
        </p>
      </Section>

      <Section title="Content and conduct">
        <p className={styles.p}>
          Add any community guidelines here (voice/chat behavior, usernames,
          cheating policies, and reporting).
        </p>
      </Section>

      <Section title="Changes">
        <p className={styles.p}>
          Note how you’ll communicate updates to these terms (e.g., posting a
          new effective date and keeping this URL stable).
        </p>
      </Section>
    </>
  );
}
