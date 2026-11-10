// Home copy that the React page (client/src/components/home/*) and the server-rendered Home
// (server/ssr/home.ts) both render. Hero, solution entry points, founder note and contextual
// starting points live here once so the two emitters cannot disagree. Commercial wording
// (offers, equipment terms) is read from public claim records, never written as a literal here.

import { claimText } from "./public-claims";
import { PUBLIC_NAV_CTA } from "./public-navigation";
import { PUBLIC_CONTACT_CHANNELS } from "./public-contact-content";
import { PAYMENT_PROCESSING_PATH } from "./public-overview-pages";

export const HOME_SOLUTIONS_ANCHOR = "solutions";

/**
 * Home hero photograph (the page's only eager image and its LCP candidate). Phones get the 4:3 "mobile"
 * crop below the actions; from lg the full-frame "desktop" crop is inset beside the copy at roughly half
 * the hero width. scripts/lib/public-image-budget.ts measures this exact id/variant, so the byte budget
 * can never point at an image the page no longer renders.
 */
export const HOME_HERO_IMAGE = {
  id: "home-hero-merchant",
  mobile: { variant: "mobile", sizes: "calc(100vw - 32px)" },
  desktop: { variant: "desktop", media: "(min-width: 1024px)", sizes: "(min-width: 1280px) 560px, 46vw" },
} as const;

export const HOME_HERO = {
  eyebrow: "PAYMENTS FOR YOUR BUSINESS",
  /** Two thoughts; the first is set in navy and the second in blue. One h1, never split into two headings. */
  headingFirst: "Know what you\u2019re paying.",
  headingSecond: "See your options.",
  heading: "Know what you\u2019re paying. See your options.",
  body: "Understand your processing costs, compare payment options, and get personal guidance for your business.",
  primary: { label: "Get a free statement review", href: "/upload-statement#statement-review-form" },
  /** The existing general inquiry (Equipment / A new business). It needs no statement and no query prefill. */
  secondary: { label: "Find the right payment setup", href: "/about-contact#inquiry" },
  /** Desktop only: omitted from the phone layout in both emitters. Wording is read from claim records. */
  desktopHelper: claimText("offer.review.hero-helper", "home"),
  desktopQualification: claimText("offer.review.hero-qualification", "home"),
} as const;

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
      href: PAYMENT_PROCESSING_PATH,
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
 * Payment-setup explanation shown in the solutions section (supplied artwork 12, rebuilt as live text so it
 * stays readable at 390 px). Three contexts; no equipment, software, integration or availability claim.
 * The upright terminal concept (asset 13) appears only inside the Countertop context.
 */
export const HOME_PAYMENT_CONTEXTS = {
  eyebrow: "FIND THE RIGHT PAYMENT SETUP",
  heading: "Different ways to take a payment.",
  intro: "Start with how your business works.",
  label: "Countertop, mobile and online payment options",
  description:
    "Three illustrative payment contexts. Equipment, software, integrations and eligibility are confirmed for each business; this is not a compatibility or availability claim.",
  contexts: [
    { id: "countertop", title: "Countertop", body: "At a fixed checkout or reception desk.", visual: "terminal" },
    { id: "mobile", title: "Mobile", body: "Away from the counter or at the job site.", visual: "phone" },
    { id: "online", title: "Online", body: "When the customer pays remotely.", visual: "browser" },
  ],
  caption: "Illustrative setups. Equipment, software, integrations and eligibility are confirmed during review.",
  terminalImage: {
    id: "equipment-concept-terminal-upright",
    variant: "product",
    sizes: "80px",
  },
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

/**
 * Disclosure lead-in shown with the equipment starting point. It states only that fees and program terms
 * apply (an obligation notice, not an assertion of benefit); the confirming claim text follows it.
 */
export const HOME_OFFER_NOTE = "Processing fees and equipment program terms apply.";

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
      note: `${HOME_OFFER_NOTE} ${claimText("equipment.terms.card", "page")}`,
      ctaLabel: "Discuss checkout fit",
      href: "/free-smart-terminal",
    },
  ] as readonly HomeStartingPoint[],
} as const;

/**
 * Statement-anatomy explanation shown in the process section (supplied artwork 11, rebuilt as live text).
 * It shows how a statement is organised, with a dash where a figure would be: no result, rate, fee amount or
 * saving appears. Fee scope matches the review taxonomy claim (interchange, network assessments, processor
 * and service charges, plus equipment and recurring fees listed separately).
 */
export const HOME_SAMPLE_REVIEW = {
  eyebrow: "THE STATEMENT REVIEW",
  heading: "Understand what goes into the cost.",
  intro: "A clear starting point for a conversation about your processing.",
  documentLabel: "YOUR PROCESSING STATEMENT",
  documentNote: "Illustrative layout \u00b7 no customer figures",
  stamp: "Illustrative",
  label: "Illustrative explanation. Your actual statement and applicable terms determine the review.",
  footnote: "Questions and unknown fees stay visible.",
  rows: [
    { label: "Interchange", heading: "Card-issuer fees", note: "Identify the interchange entries." },
    { label: "Network assessments", heading: "Network charges", note: "Separate the assessment entries." },
    { label: "Processor charges", heading: "Provider charges", note: "Clarify processor and service fees." },
    { label: "Equipment & recurring fees", heading: "Equipment & other costs", note: "Review recurring fees and terms." },
  ],
} as const;

/** Home metadata shared by the server document and the hydrated page. Evergreen: no offer, price or count. */
export const HOME_META = {
  /** Page title without the brand; the document title is `${shortTitle} | Liberty Bancard`. */
  shortTitle: "Payment Processing and Terminal Equipment",
  title: "Payment Processing and Terminal Equipment | Liberty Bancard",
  description:
    "Explore payment processing, terminal equipment and integrations with Liberty Bancard. Start with how your business takes payments and what you want to improve.",
  keywords: "payment processing, merchant services, credit card processing, terminal equipment, payment integrations",
  ogImage: "https://libertybancard.com/og-home-logo-card.jpg",
} as const;

/** Section order contract: both emitters tag each Home section with data-home-section in this order. */
export const HOME_SECTION_ORDER = [
  "hero",
  "solutions",
  "industries",
  "starting-points",
  "founder",
  "process",
  "faq",
  "final",
] as const;
export type HomeSectionId = (typeof HOME_SECTION_ORDER)[number];

/**
 * Industry entrances on Home: five compact image cards. Every slug is an existing /industries/:slug
 * template. Healthcare and contractors/field services stay reachable through the industries hub and the
 * navigation; this display choice does not change any vertical classification. `image` is a public
 * imagery registry id (client/src/lib/public-imagery.ts).
 */
export const HOME_INDUSTRIES_SECTION = {
  eyebrow: "Businesses we serve",
  heading: "Payment solutions for the way your industry works.",
  description: "Choose your industry to see how payments typically work for it and what to ask before changing processors.",
  allLabel: "All industries",
  allHref: "/industries",
  illustrativeNote: "Photos are illustrative and do not show Liberty customers.",
  /** Crop and `sizes` for every card photograph, read by both emitters so they request the same width. */
  cardImage: { variant: "card", sizes: "(min-width: 1024px) 230px, (min-width: 768px) 33vw, 96px" },
  entries: [
    { slug: "restaurant-payment-processing", title: "Restaurant", bestFor: "Tip adjustment and weekend volume", image: "industry-restaurant" },
    { slug: "dental-payment-processing", title: "Dental", bestFor: "Practice payments and patient balances", image: "industry-dental" },
    { slug: "med-spa-payment-processing", title: "Med spa", bestFor: "Treatment packages and recurring payments", image: "industry-med-spa" },
    { slug: "auto-repair-payment-processing", title: "Automotive", bestFor: "High-ticket sales and chargeback handling", image: "industry-automotive" },
    { slug: "retail-payment-processing", title: "Retail", bestFor: "Fast lines and contactless payments", image: "industry-retail" },
  ],
} as const;

/** Process worksheet: how an inquiry moves forward. Timing and approval wording come from claim records. */
export const HOME_PROCESS = {
  eyebrow: "How it works",
  heading: "From a first conversation to clear next steps.",
  links: [
    { label: "Start a statement review", href: "/upload-statement" },
    { label: "No statement handy? Run the 60-second rate check", href: "/estimate" },
  ],
  steps: [
    { title: "Tell us about your business", body: "Share how you take payments and what you want to improve, or send a statement." },
    { title: "We review the details", body: claimText("review.process.summary", "home") },
    { title: "Talk through your options", body: claimText("timing.staged-process", "home") },
  ],
} as const;

export interface HomeFaqItem {
  question: string;
  answer: string;
  link?: { label: string; href: string };
}

export const HOME_FAQ = {
  heading: "Common questions",
  items: [
    {
      question: "Do I have to switch processors to get a statement review?",
      answer: claimText("review.cost.free", "faq"),
    },
    {
      question: "How are uploaded statements handled?",
      answer: claimText("review.handling.summary", "faq"),
    },
    {
      question: "How long does a review take?",
      answer: claimText("review.process.summary", "faq"),
    },
    {
      question: "What if I don't have my statement handy?",
      answer: "Talk to us about your business first, or use the rate check to enter your own numbers. A complete review needs your statement.",
      link: { label: "Open the rate check", href: "/estimate" },
    },
    {
      question: "I use Square or Stripe. Can you still help?",
      answer: "Yes. A review compares using your actual numbers. Which pricing costs less depends on your volume, card mix and ticket size.",
      link: { label: "See the comparison", href: "/beat-square-stripe" },
    },
    {
      question: "Does surcharging apply to debit or prepaid cards?",
      answer: `${claimText("program.card-types", "faq")} ${claimText("program.requirements", "faq")}`,
      link: { label: "Learn more", href: "/0-percent-processing" },
    },
  ] as readonly HomeFaqItem[],
} as const;

/** Final contact section. Real channels only; no hours, response time or text-message capability is stated. */
export const HOME_FINAL = {
  eyebrow: "Contact Liberty",
  heading: "Talk to Liberty about your payments.",
  body: "Tell us how your business takes payments and what you want to improve. Choose the way that suits you.",
  disclosure: "Eligibility, underwriting, card brand rules, and applicable laws apply.",
  actions: [
    { id: "talk", label: PUBLIC_NAV_CTA.label, href: PUBLIC_NAV_CTA.href },
    { id: "review", label: "Review my statement", href: "/upload-statement" },
  ],
  channels: [
    { id: "phone", label: PUBLIC_CONTACT_CHANNELS.phone.label, href: PUBLIC_CONTACT_CHANNELS.phone.href },
    { id: "email", label: PUBLIC_CONTACT_CHANNELS.email.label, href: PUBLIC_CONTACT_CHANNELS.email.href },
    { id: "booking", label: PUBLIC_CONTACT_CHANNELS.booking.label, href: PUBLIC_CONTACT_CHANNELS.booking.href },
  ],
  callback: {
    heading: "Prefer a callback?",
    body: claimText("timing.staged-process", "home"),
    fallbackLabel: "Use the contact options",
    fallbackHref: "/about-contact#inquiry",
  },
} as const;

const HOME_SITE_URL = "https://libertybancard.com";
const HOME_ADDRESS = {
  "@type": "PostalAddress",
  addressLocality: "Fort Lauderdale",
  addressRegion: "FL",
  addressCountry: "US",
} as const;

/**
 * Home structured data shared by the server document and the hydrated page. It states only verified
 * identity facts (name, URL, phone, support email, locality). It deliberately carries no opening hours,
 * price range, rating, review or offer, because none has owner evidence.
 */
export const HOME_ORGANIZATION_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Liberty Bancard",
  url: HOME_SITE_URL,
  telephone: "+1-954-266-8214",
  email: "support@libertybancard.com",
  description:
    "Payment processing, terminal equipment and integrations for businesses, with a statement review that explains your current charges and your options.",
  address: HOME_ADDRESS,
  sameAs: [] as string[],
} as const;

export const HOME_LOCAL_BUSINESS_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  name: "Liberty Bancard",
  description: "Payment processing, terminal equipment and integrations for businesses.",
  url: HOME_SITE_URL,
  telephone: "+1-954-266-8214",
  address: HOME_ADDRESS,
} as const;
