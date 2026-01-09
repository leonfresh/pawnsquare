import type { Metadata } from "next";
import { SITE_NAME } from "@/lib/seo";
import { JsonLd } from "../_seo/jsonld";
import { faqPageSchema } from "../_seo/schema";
import { Faq, PageTitle, Section } from "../_seo/ui";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "FAQ",
  description:
    "Frequently asked questions about PawnSquare browser play and rooms.",
  alternates: { canonical: "/faq" },
};

const faqs = [
  {
    question: "What is PawnSquare?",
    answer:
      "PawnSquare is a frictionless browser game: a shared 3D lobby where you play chess variants and checkers together.",
  },
  {
    question: "Do I need to install anything?",
    answer: "No—PawnSquare runs in the browser.",
  },
  {
    question: "How do I invite friends?",
    answer:
      "Share your room link (the URL). Anyone with the link can join the same world.",
  },
  {
    question: "What game modes are available?",
    answer: "Chess, 4‑Player Chess, Goose Chess, and Checkers.",
  },
  {
    question: "Is there an official mobile app?",
    answer:
      "No—use the mobile browser (support varies by device and performance).",
  },
  {
    question: "Why do I see channels like CH.1 / CH.2?",
    answer:
      "Channels are separate instances of the same room base. They help keep rooms from getting too full.",
  },
] as const;

export default function FaqPage() {
  return (
    <>
      <JsonLd
        data={faqPageSchema({
          urlPath: "/faq",
          faqs: [...faqs],
        })}
      />

      <PageTitle
        title="PawnSquare FAQ"
        subtitle={`Answers about ${SITE_NAME}.`}
      />

      <Section title="Questions">
        <Faq items={[...faqs]} />
      </Section>
    </>
  );
}
