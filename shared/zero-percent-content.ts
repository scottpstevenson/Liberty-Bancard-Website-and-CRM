// Single source of truth for the /0-percent-processing page and every other
// surface that describes the cash discount and surcharging programs (home
// programs block, server-rendered HTML, route metadata, JSON-LD). Material
// statements come from public claim records in shared/public-claims.ts. No
// legality opinion, savings figure, uniform fee, registration promise or timing
// window appears here: those assertions are retired claims.

import { claimText } from "./public-claims";
import { TIMING_NOTE } from "./public-disclosures";

export const ZP_PATH = "/0-percent-processing";

export const ZP_META = {
  title: "Liberty Zero — Cash Discount & Surcharging Programs",
  description: claimText("program.overview.meta", "meta"),
  keywords:
    "liberty zero, cash discount program, surcharging program, dual pricing, credit card surcharge review, 0% processing program",
  serviceName: "Liberty Zero — Cash Discount and Surcharging Program Review",
  serviceDescription: claimText("program.overview", "schema"),
} as const;

export const ZP_HERO = {
  badge: "Cash Discount & Surcharging",
  headingLead: "Cash discount and surcharging programs,",
  headingAccent: "reviewed for your business.",
  sub: claimText("program.overview"),
  cta: "Check Eligibility — Free Review",
  secondaryCta: "Talk to a Specialist",
  disclaimer:
    "Program availability depends on business type, state rules, card-network rules, disclosure requirements, and underwriting.",
  microcopy: "Eligibility confirmed via statement review.",
} as const;

/** Replaces the former illustrative savings card: what the review confirms. */
export const ZP_REVIEW_CARD = {
  heading: "What a review confirms",
  items: [
    "Whether your state and card brand rules permit a program for your business",
    "How credit, debit and prepaid cards are treated",
    "Which costs remain after any program, such as equipment, software, gateway and PCI",
    "Signage, receipt and registration or disclosure requirements",
  ],
  footnote: "No dollar figures are shown without your statement. We show the inputs behind any estimate.",
} as const;

export const ZP_TRUST_STRIP: readonly string[] = [
  "Secure statement review",
  "No obligation comparison",
  "Transparent rate analysis",
  "Merchant-focused payment review",
  "Eligibility confirmed via statement review",
];

export const ZP_PROGRAMS_HEADING = "Cash Discount and Surcharging Are Different Programs";
export const ZP_PROGRAMS_INTRO = `${claimText("program.overview")} Here is how each works.`;

export const ZP_CASH_DISCOUNT = {
  title: "Cash Discount",
  badge: "Pricing program",
  body: "Your listed price is the card price, and customers who pay with cash receive a discount. How prices are displayed and disclosed depends on your state and card brand rules.",
  fit: "Fit depends on your customers, ticket size and state.",
  cta: "Review My Cash Discount Options",
  summary: "A discount for customers who pay with cash",
} as const;

export const ZP_SURCHARGE = {
  title: "Compliant Surcharging",
  badge: "Credit cards only",
  body: "A disclosed fee is added to eligible credit card transactions at checkout. Whether, where and how much depends on state law and card brand rules, and debit cards are treated differently. We review eligibility before recommending this path.",
  fit: "Fit depends on your customers, ticket size and state.",
  cta: "Check My Surcharging Eligibility",
  summary: "A clearly disclosed fee on eligible credit card sales, after a state and card-brand review",
} as const;

export const ZP_UNSURE = "Not sure which structure fits? Upload your statement and we'll review your card mix, ticket size and state rules, then explain your options.";

export const ZP_FIT = {
  heading: "Is This a Good Fit for Your Business?",
  intro:
    "Fit depends on your state, card mix, customer type and ticket size. Upload your statement and we review what applies to you instead of guessing.",
  businessTypesHeading: "Business types we commonly review",
  businessTypes: [
    "Restaurants & Cafes",
    "Retail Stores",
    "Medical & Dental",
    "Auto Repair",
    "Home Services",
    "Professional Services",
  ],
  checklistHeading: "What the review looks at",
  checklist: [
    "Your business location, so state rules can be reviewed",
    "Your card mix: credit, debit and prepaid",
    "Your customers and average ticket",
    "Whether signage, receipts and checkout messaging can be updated",
    "Whether staff can explain the program at checkout",
    "Your current equipment, software and gateway",
  ],
  cta: "Check My Eligibility",
} as const;

export const ZP_REQUIREMENTS = {
  heading: "Requirements We Review With You",
  intro: claimText("program.requirements"),
  cards: [
    { title: "Signage", desc: "Point-of-sale signage and disclosure wording depend on the program. We review what applies before you enroll." },
    { title: "Receipt Formatting", desc: "Receipts must show required disclosures. We review the receipt format for your program and equipment." },
    { title: "Staff Explanation", desc: "Your team needs a simple, consistent way to explain the program at checkout. We review one with you." },
    { title: "Registration and Notices", desc: "Where card brands or states require registration or notice, we review the requirement and who is responsible for it. Responsibilities are set out in your written agreement." },
  ],
  listHeading: "What we review with you before enrollment",
  list: [
    "Signage and checkout messaging",
    "Receipt format and required disclosures",
    "How debit and prepaid cards are treated",
    "Card brand and state requirements, including any registration or notice",
    "What to do if card brand or state rules change",
    "How your staff will explain the program",
  ],
} as const;

export const ZP_COSTS = {
  heading: "Reading Your Own Numbers",
  intro: `${claimText("review.effective-cost.definition")} ${claimText("program.remaining-costs")}`,
  cards: [
    { title: "Fees on your statement", desc: "We list each fee we can identify, what it is, and who charges it. A fee we cannot identify is shown as unknown rather than estimated." },
    { title: "Costs that remain", desc: claimText("program.remaining-costs") },
    { title: "What customers see", desc: "A program changes what customers see at checkout, which can affect how they pay. We do not predict customer reaction or sales." },
  ],
  footnote: "No savings figure is shown without your statement. When a material cost is unknown, we show the inputs and the unknowns instead of a total.",
} as const;

export const ZP_EQUIPMENT = {
  heading: "Equipment and Setup",
  description: `Equipment and configuration depend on the program and your terminal. ${TIMING_NOTE}`,
  steps: [
    "Statement review to confirm which program, if any, fits",
    "Program type and state rules confirmed",
    "Terminal configuration and receipt format confirmed",
    "Staff explanation reviewed before you go live",
  ],
  primaryCta: "Upload Statement",
  secondaryCta: "Call",
  footnote: `${claimText("equipment.options.summary")} ${claimText("equipment.agreement.summary")}`,
} as const;

export const ZP_FAQ_HEADING = "Cash Discount & Surcharging — Common Questions";

export const ZP_FAQ: readonly { question: string; answer: string }[] = [
  {
    question: 'Is Liberty Zero the same as "surcharging"?',
    answer: `Liberty Zero is the name of our program review. It covers two different structures: cash discount (a discount for customers who pay with cash) and surcharging (a disclosed fee on eligible credit card transactions). ${claimText("program.overview", "faq")}`,
  },
  {
    question: "Does this apply to debit cards?",
    answer: claimText("program.card-types", "faq"),
  },
  {
    question: "Will customers push back?",
    answer:
      "Customer reaction varies by business and customer type. Clear signage and receipts help, and we review the disclosure wording with you. We cannot predict how your customers will respond.",
  },
  {
    question: "Is it allowed in my state?",
    answer:
      "State rules differ and can change, and card brand rules apply too. Whether a program is permitted for your business is confirmed in a business-specific review; it is not assumed.",
  },
  {
    question: "What businesses qualify?",
    answer:
      "Business type is one factor. State, card mix, customer type and ticket size also matter, and card-not-present and e-commerce businesses have different considerations. We confirm fit in your statement review.",
  },
  {
    question: "What does the math actually look like?",
    answer: `${claimText("program.remaining-costs", "faq")} We show the inputs behind any estimate and do not state a savings figure when a material cost is unknown.`,
  },
];

export const ZP_FINAL = {
  heading: "Ready to See Whether a Program Fits?",
  body: "Upload your statement and we'll review which program, if any, fits your state and card mix, and show the inputs behind any estimate.",
  primaryCta: "Upload Statement — Check Eligibility",
  compliance: "Eligibility, underwriting, card brand rules, and applicable laws apply. No savings claims without statement review.",
} as const;

// ── Server-rendered page and Home program cards ────────────────────────────

export const ZP_SSR = {
  badge: "Program review, no obligation",
  h1: "Cash Discount and Surcharging Programs for Your Business",
  primaryCta: "📤 See If You Qualify — Free Review",
  secondaryCta: "📞 Ask About These Programs",
  finalHeading: "Ready to See Whether a Program Fits?",
  finalBody: ZP_FINAL.body,
} as const;

export interface HomeProgramCard {
  value: "cash-discount" | "surcharging" | "interchange-plus";
  title: string;
  badge: string;
  summary: string;
  body: string;
  points: readonly string[];
  figureLabel: string;
  figure: string;
  cta: string;
  href: string;
}

export const ZP_HOME_PROGRAMS: readonly HomeProgramCard[] = [
  {
    value: "cash-discount",
    title: "Cash Discount",
    badge: "Pricing program",
    summary: "A discount for customers who pay with cash, after a state and card-brand review",
    body: "Your listed price is the card price and cash payers receive a discount. How prices are displayed and disclosed depends on state and card brand rules, and we review them with you first.*",
    points: ["State and card-brand review first", "Signage and receipt requirements reviewed", "Staff explanation reviewed"],
    figureLabel: "What it changes",
    figure: "How customers see your prices*",
    cta: "Review My Options",
    href: ZP_PATH,
  },
  {
    value: "surcharging",
    title: "Compliant Surcharging",
    badge: "Credit cards only",
    summary: "A clearly disclosed fee on eligible credit card sales, after a state and card-brand review",
    body: "A disclosed fee appears on eligible credit card transactions at checkout. State law and card brand rules govern where this applies, and debit cards are treated differently. We review eligibility before recommending it.*",
    points: ["Card-brand notices reviewed with you", "State eligibility confirmed before enrollment", "Receipts and checkout disclosures reviewed"],
    figureLabel: "What it changes",
    figure: "A disclosed fee on eligible credit sales*",
    cta: "Review My Options",
    href: ZP_PATH,
  },
  {
    value: "interchange-plus",
    title: "Interchange Plus",
    badge: "One price for all customers",
    summary: "The card-network cost plus a processor markup shown separately",
    body: "No bundled tiers. Interchange and the processor markup appear as separate lines on your statement, and we explain how your current pricing compares in a statement review.*",
    points: ["Interchange passed through at its actual cost", "Statement lines explained one by one", "Compare your current effective cost for free"],
    figureLabel: "How it is priced",
    figure: "Interchange + a visible markup*",
    cta: "Get My Rate Comparison",
    href: "/compare-rates",
  },
];

export const ZP_HOME_HEADING = "Choose the program that fits your business";
export const ZP_HOME_DESCRIPTION =
  "Cash discount and surcharging are different programs, and whether either fits depends on your state and card mix. Interchange Plus keeps one price for every customer and shows the processor markup separately.";
export const ZP_HOME_FOOTNOTE = "*Eligibility, underwriting, card brand rules, and applicable laws apply. No savings claims without statement review.";

/** Home server-rendered feature card for the program. */
export const ZP_HOME_SSR = {
  title: "Liberty Zero™ — Cash Discount & Surcharging Review",
  text: `${claimText("program.overview", "home")}*`,
} as const;

/** Navigation description strings (React and SSR navigation). */
export const ZP_NAV_DESCRIPTION = "Cash discount and surcharging program review";
