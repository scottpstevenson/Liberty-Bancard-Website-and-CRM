// Overview pages for the two header destinations "Payment processing" (/payment-processing) and
// "Pricing & programs" (/pricing-and-programs). The React pages (client/src/pages/PaymentProcessing.tsx,
// PricingPrograms.tsx) and the server renderer (server/ssr/overview-pages.ts) both read this module, so
// the two emitters cannot disagree. Every commercial statement is read from a public claim record or from
// the already reviewed program records; this file adds no price, saving, guarantee, timing, eligibility or
// "cheapest" statement. Structural definitions of fee categories describe how a statement is organized and
// carry no Liberty-specific figure.

import { claimText } from "./public-claims";
import { industryHref } from "./public-industries";
import { PUBLIC_NAV_CTA } from "./public-navigation";
import {
  ZP_HOME_DESCRIPTION,
  ZP_HOME_FOOTNOTE,
  ZP_HOME_PROGRAMS,
  ZP_PATH,
} from "./zero-percent-content";

export interface OverviewLink {
  label: string;
  href: string;
}

export interface OverviewItem {
  title: string;
  body: string;
  /** Optional badge shown above the title (program type). */
  badge?: string;
  points?: readonly string[];
  link?: OverviewLink;
}

export interface OverviewSection {
  id: string;
  heading: string;
  intro?: string;
  layout: "cards" | "steps";
  items: readonly OverviewItem[];
  /** Small-print note under the section (disclosure wording only). */
  footnote?: string;
}

export interface OverviewPage {
  path: string;
  /** Page title without the brand (the SEO component appends " | Liberty Bancard"). */
  shortTitle: string;
  /** Full document title including the brand, 30-70 characters. */
  title: string;
  /** 100-165 characters. */
  description: string;
  keywords: string;
  /** Short label used in breadcrumbs. */
  breadcrumbLabel: string;
  h1: string;
  intro: string;
  sections: readonly OverviewSection[];
  closing: {
    heading: string;
    body: string;
    primary: OverviewLink;
    secondary: OverviewLink;
  };
}

export const PAYMENT_PROCESSING_PATH = "/payment-processing";
export const PRICING_AND_PROGRAMS_PATH = "/pricing-and-programs";

const REVIEW_LINK: OverviewLink = { label: "Review my statement", href: "/upload-statement" };
const TALK_LINK: OverviewLink = { label: PUBLIC_NAV_CTA.label, href: PUBLIC_NAV_CTA.href };

export const PAYMENT_PROCESSING_PAGE: OverviewPage = {
  path: PAYMENT_PROCESSING_PATH,
  shortTitle: "Payment Processing for Your Business",
  title: "Payment Processing for Your Business | Liberty Bancard",
  description:
    "Explore payment processing for in-person, online and mobile sales, plus equipment and integrations, and start with how your business takes payments.",
  keywords: "payment processing, merchant services, credit card processing, terminal equipment, payment integrations",
  breadcrumbLabel: "Payment processing",
  h1: "Payment processing for the way you do business.",
  intro:
    "Start with how your customers pay and the systems you use today. Liberty Bancard reviews your processing, equipment and integrations with you so you know what to confirm before changing anything.",
  sections: [
    {
      id: "ways-to-accept",
      heading: "Ways your customers pay",
      intro: "Most businesses take payments in more than one way. Tell us which apply to you.",
      layout: "cards",
      items: [
        {
          title: "In person",
          body: "Counter, tableside and curbside payments on a terminal or point-of-sale system.",
          link: { label: "Explore terminal options", href: "/shop" },
        },
        {
          title: "Online",
          body: "Website checkout, payment links and invoices, depending on the platform and gateway you use.",
          link: { label: "See online payments", href: industryHref("ecommerce-payment-processing") },
        },
        {
          title: "On the go",
          body: "Payments away from a fixed counter, such as at job sites, events or deliveries.",
          link: { label: "See mobile equipment options", href: "/shop" },
        },
      ],
    },
    {
      id: "what-we-review",
      heading: "What we review with you",
      layout: "cards",
      items: [
        {
          title: "Your current costs",
          body: claimText("review.taxonomy.summary", "page"),
          link: REVIEW_LINK,
        },
        {
          title: "Equipment and checkout",
          body: claimText("equipment.options.summary", "page"),
          link: { label: "Explore terminal options", href: "/shop" },
        },
        {
          title: "Software and integrations",
          body: claimText("compat.inquiry", "page"),
          link: { label: "Explore integrations", href: "/integrations" },
        },
        {
          title: "Program options",
          body: claimText("program.overview", "page"),
          link: { label: "Pricing & programs", href: PRICING_AND_PROGRAMS_PATH },
        },
      ],
    },
    {
      id: "process",
      heading: "From first conversation to a written agreement",
      intro: claimText("timing.staged-process", "page"),
      layout: "steps",
      items: [
        {
          title: "Tell us about your business",
          body: "Share how you take payments today and what you want to improve. You can call, write, book a conversation or request a statement review.",
        },
        { title: "We review the details", body: claimText("review.process.summary", "page") },
        {
          title: "Compare your options",
          body: "We walk through the options and the questions to resolve before any change.",
        },
        { title: "Confirm terms in writing", body: claimText("equipment.agreement.summary", "page") },
      ],
    },
  ],
  closing: {
    heading: "Ready to talk it through?",
    body: "Tell us how your business takes payments and what you want to improve. We'll discuss the options and the questions to resolve before a change.",
    primary: TALK_LINK,
    secondary: REVIEW_LINK,
  },
};

const PROGRAM_LINKS: Record<string, OverviewLink> = {
  "cash-discount": { label: "Learn about the program review", href: ZP_PATH },
  surcharging: { label: "Learn about the program review", href: ZP_PATH },
  "interchange-plus": REVIEW_LINK,
};

export const PRICING_AND_PROGRAMS_PAGE: OverviewPage = {
  path: PRICING_AND_PROGRAMS_PATH,
  shortTitle: "Processing Pricing and Program Options",
  title: "Processing Pricing and Program Options | Liberty Bancard",
  description:
    "See what makes up card processing costs and how cash discount, surcharging and interchange-plus programs differ. Fit depends on your state and card mix.",
  keywords: "processing fees explained, interchange plus pricing, cash discount program, credit card surcharging, effective cost",
  breadcrumbLabel: "Pricing & programs",
  h1: "Understand your processing options and costs.",
  intro:
    "Processing costs have several parts, and programs differ in how those costs reach your customers and your statement. This page explains the pieces and where to confirm what applies to your business.",
  sections: [
    {
      id: "costs",
      heading: "What makes up processing costs",
      intro: claimText("review.taxonomy.summary", "page"),
      layout: "cards",
      items: [
        { title: "Interchange", body: "Charged per transaction and varies by card type and how the sale is taken." },
        { title: "Network assessments and fees", body: "Fees charged by the card networks in addition to interchange." },
        { title: "Processor or service charges", body: "The processing company's markup and account or service fees." },
        {
          title: "Equipment, gateway and other charges",
          body: "Identified separately, together with software and PCI fees where they apply.",
        },
      ],
    },
    {
      id: "programs",
      heading: "Program options",
      intro: ZP_HOME_DESCRIPTION,
      layout: "cards",
      items: ZP_HOME_PROGRAMS.map((program) => ({
        title: program.title,
        badge: program.badge,
        body: program.body,
        points: program.points,
        link: PROGRAM_LINKS[program.value],
      })),
      footnote: ZP_HOME_FOOTNOTE,
    },
    {
      id: "remaining-costs",
      heading: "Costs that can remain",
      intro: claimText("program.remaining-costs", "page"),
      layout: "cards",
      items: [
        { title: "Requirements by program", body: claimText("program.requirements", "page") },
        { title: "Written terms", body: claimText("equipment.agreement.summary", "page") },
      ],
    },
    {
      id: "comparing",
      heading: "How to compare your options",
      intro: claimText("review.effective-cost.definition", "page"),
      layout: "cards",
      items: [
        { title: "Start with a statement review", body: claimText("review.cost.free", "page"), link: REVIEW_LINK },
        {
          title: "Check the program fit",
          body: "Cash discount and surcharging depend on your state and card mix. The program review confirms what applies.",
          link: { label: "Liberty Zero program review", href: ZP_PATH },
        },
      ],
    },
  ],
  closing: {
    heading: "Talk through your options",
    body: "Bring your statement or your questions. We'll discuss which options may fit and which costs can remain.",
    primary: REVIEW_LINK,
    secondary: TALK_LINK,
  },
};

export const OVERVIEW_PAGES: readonly OverviewPage[] = [PAYMENT_PROCESSING_PAGE, PRICING_AND_PROGRAMS_PAGE];
