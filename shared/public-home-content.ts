// Home copy that the React page (client/src/components/home/*) and the server-rendered Home
// (server/ssr/home.ts) both render. Hero, solution entry points, founder note and contextual
// starting points live here once so the two emitters cannot disagree. Commercial wording
// (offers, equipment terms) is read from public claim records, never written as a literal here.

import { claimText } from "./public-claims";
import { PUBLIC_NAV_CTA } from "./public-navigation";

export const HOME_HERO = {
  eyebrow: "Payment solutions for your business",
  heading: "Payments that fit the way your business works.",
  body: "Explore processing options, terminal equipment and integrations with Liberty Bancard. Start with how you take payments, the systems you use and what you want to improve.",
  primary: { label: "Explore payment solutions", href: "/#solutions" },
  secondary: { label: PUBLIC_NAV_CTA.label, href: PUBLIC_NAV_CTA.href },
} as const;

export const HOME_SOLUTIONS_ANCHOR = "solutions";
export const HOME_PROCESSING_ANCHOR = "processing-options";

export interface HomeSolutionCard {
  id: "processing" | "equipment" | "integrations";
  title: string;
  body: string;
  linkLabel: string;
  href: string;
}

export const HOME_SOLUTIONS = {
  heading: "Find the right starting point for your payments.",
  cards: [
    {
      id: "processing",
      title: "Processing options",
      body: "Understand the pricing structure, requirements and payment methods relevant to your business.",
      linkLabel: "Explore processing options",
      href: `/#${HOME_PROCESSING_ANCHOR}`,
    },
    {
      id: "equipment",
      title: "Terminal equipment",
      body: "Review equipment choices around your checkout and business requirements.",
      linkLabel: "Explore terminal options",
      href: "/shop",
    },
    {
      id: "integrations",
      title: "Integrations",
      body: "Discuss your existing systems and the compatibility details that need to be checked.",
      linkLabel: "Explore integrations",
      href: "/integrations",
    },
  ] as readonly HomeSolutionCard[],
} as const;

/**
 * Founder note. There is no approved portrait asset in the repository, so the section renders text
 * only; it must not substitute a stock or generated person for the founder.
 */
export const HOME_FOUNDER = {
  heading: "Put a person behind the processing conversation.",
  body: "I'm Scott, founder of Liberty Bancard. Tell us how your business takes payments and what you want to improve. We'll discuss the options and the questions to resolve before a change.",
  cta: { label: PUBLIC_NAV_CTA.label, href: PUBLIC_NAV_CTA.href },
} as const;

export interface HomeStartingPoint {
  id: "review" | "equipment";
  title: string;
  body: string;
  note: string;
  ctaLabel: string;
  href: string;
}

export const HOME_STARTING_POINTS = {
  heading: "Want help with a specific decision?",
  cards: [
    {
      id: "review",
      title: "Understand your current processing costs.",
      body: claimText("offer.review.short", "home"),
      note: claimText("offer.review.inquiry", "home"),
      ctaLabel: "Review my statement",
      href: "/upload-statement",
    },
    {
      id: "equipment",
      title: "Need a terminal?",
      body: claimText("equipment.options.summary", "home"),
      note: claimText("equipment.terms.card", "page"),
      ctaLabel: "Check terminal eligibility",
      href: "/free-smart-terminal",
    },
  ] as readonly HomeStartingPoint[],
} as const;

/** Sample review layout (illustrative worksheet). It carries no figures, results or customer data. */
export const HOME_SAMPLE_REVIEW = {
  label: "Illustrative review layout. No customer results shown.",
  rows: [
    { label: "Effective cost", note: "Fees included divided by matching card volume" },
    { label: "Fee categories", note: "Interchange, network, processor and service charges" },
    { label: "Equipment & terms", note: "Listed separately from processing fees" },
    { label: "Comparison questions", note: "What to confirm before any change" },
  ],
} as const;
