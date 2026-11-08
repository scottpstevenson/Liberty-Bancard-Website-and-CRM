// Single source of truth for the "Free Statement Review" copy shown on
// /upload-statement. The React page, the server-rendered shell, route metadata
// and the home links import this module so they cannot drift apart. Material
// statements (cost, handling, timing, funding, equipment) come from public
// claim records in shared/public-claims.ts.

import { claimText } from "./public-claims";

export const FSR_HEADING = "Free Statement Review";

export const FSR_WHAT_IT_IS = {
  heading: "What the review is",
  intro:
    "A statement review is a line-by-line explanation of your current processing statement. We sort the charges into at least these categories:",
  parts: [
    {
      term: "Interchange",
      text: "fees set by the card networks and paid to the banks that issue the cards.",
    },
    {
      term: "Network assessments and fees",
      text: "fees charged by the card networks themselves, such as assessments and network access or processing fees.",
    },
    {
      term: "Processor and service charges",
      text: "what your processor or provider charges, such as per-transaction rates, monthly, statement and PCI fees, and other service fees.",
    },
    {
      term: "Equipment, gateway and other charges",
      text: "terminal rental or lease, gateway, software and any other applicable charges, listed separately.",
    },
  ],
  outro: `For each fee on your statement, we identify what it is and who charges it. ${claimText("review.effective-cost.definition")}`,
} as const;

export const FSR_WHAT_YOU_RECEIVE = {
  heading: "What you receive",
  text: `A written explanation of your effective cost, your recurring monthly fees and the charges we identified, line by line. ${claimText("review.process.summary")} Keep it either way; there is no obligation to switch.`,
} as const;

export const FSR_COST = {
  heading: "Cost",
  text: claimText("review.cost.free"),
} as const;

export const FSR_WHAT_TO_SUBMIT = {
  heading: "What to submit, and how",
  paragraphs: [
    "Submit your most recent processing statement — any processor, any format — using the secure upload form on this page.",
    "Please don't send financial documents by email, text, or social media messages. The upload form on this page is the secure way to send us your statement. If a statement reaches us any other way, we will ask you to resend it here.",
  ],
} as const;

export const FSR_HANDLING = {
  heading: "How your documents are handled",
  text: `${claimText("review.handling.summary")} If you decide to become a Liberty Bancard merchant, any documents needed for your application are requested and handled separately during onboarding.`,
} as const;

export const FSR_WHO_QUALIFIES = {
  heading: "Who qualifies",
  text:
    "Any business that currently accepts card payments and has a recent processing statement can request a review. Processing with Liberty Bancard requires an approved merchant account; accounts are subject to application, credit approval, and underwriting, and approval timing depends on underwriting.",
} as const;

export const FSR_FUNDING_NOTE = {
  heading: "A note on funding",
  text: `${claimText("funding.availability")} Your specific funding timeline is outlined during onboarding.`,
} as const;

export const FSR_DISCLOSURE = "Liberty Bancard is a registered ISO/MSP, not a bank.";

/** Anchor text for the plain links added to the homepage review sections. */
export const FSR_HOME_LINK_TEXT = "What we check — and how your documents are handled";
/** Anchor id of the explainer on /upload-statement. */
export const FSR_ANCHOR_ID = "free-statement-review";

// ── Page-level copy shared by React and server-rendered HTML ────────────────

export const FSR_META = {
  title: "Free Merchant Statement Review | Liberty Bancard",
  /** No savings promise: the review explains costs; it does not predict savings. */
  description:
    "Upload your merchant processing statement for a free, no-obligation review. We explain what you pay in fees, category by category.",
  keywords:
    "free statement review, merchant statement analysis, processing fee review, effective cost, upload merchant statement",
  serviceDescription:
    "Upload your merchant processing statement for a free, no-obligation review of your fees, category by category.",
} as const;

export const FSR_HERO = {
  badge: "Free statement review",
  heading: "Know what you pay for card processing.",
  sub: "Upload your statement — no processor login needed. We'll explain your effective cost and each fee we can identify, including who charges it.",
  effectiveCostTitle: "See your effective cost",
  effectiveCostNote: claimText("review.effective-cost.definition"),
  chips: ["Free", "No obligation", "Secure upload", "No processor login"],
  uploadNote: "Encrypted upload. How documents are handled is explained below.",
} as const;

export const FSR_REVIEW_ITEMS: readonly { label: string; note: string }[] = [
  { label: "Your effective cost", note: "fees included ÷ matching card volume" },
  { label: "Recurring monthly fees", note: "PCI, batch, statement and service fees" },
  { label: "Interchange", note: "network cost by card type and entry method" },
  { label: "Network assessments and fees", note: "charged by the card networks" },
  { label: "Processor and service charges", note: "what your provider adds" },
  { label: "Equipment, gateway and other charges", note: "listed separately" },
];

export const FSR_REVIEW_CARD_FOOTNOTE =
  "You can redact account numbers; totals and fee lines are what the review needs. Handling is described below and in our Privacy Policy.";

export const FSR_EQUIPMENT_STRIP = claimText("equipment.options.summary");

export const FSR_EQUIPMENT_CARD = {
  title: "Equipment Options",
  body: claimText("equipment.options.summary"),
  fine: claimText("equipment.agreement.summary"),
} as const;

export const FSR_NEXT_HEADING = "What happens next";
export const FSR_NEXT_NOTE = claimText("timing.staged-process");

export const FSR_NEXT_STEPS: readonly { n: string; title: string; body: string }[] = [
  { n: "1", title: "Upload received", body: "You see a confirmation on screen with a reference when your statement is received." },
  { n: "2", title: "Line-by-line fee review", body: "We identify each fee we can, what it is and who charges it, and calculate your effective cost." },
  { n: "3", title: "Your options", body: "We explain your options with the calculation inputs shown, and no pressure to switch." },
];

export const FSR_SSR_CARDS: readonly { title: string; text: string }[] = [
  {
    title: "📊 Line-Item Fee Breakdown",
    text: "We explain every line of your statement in categories: interchange, network assessments and fees, processor and service charges, and equipment, gateway and other charges.",
  },
  {
    title: "🧮 Effective Cost",
    text: claimText("review.effective-cost.definition"),
  },
  {
    title: "🎯 Program Options",
    text: claimText("program.overview"),
  },
];

export const FSR_SSR_STEPS: readonly { icon: string; title: string; text: string }[] = [
  { icon: "1️⃣", title: "Upload Your Statement", text: "Upload your most recent processing statement. PDF, JPG or PNG up to 10 MB." },
  { icon: "2️⃣", title: "We Review It", text: claimText("review.process.summary") },
  { icon: "3️⃣", title: "See Your Options", text: "We explain the numbers with the inputs shown. No obligation; if the numbers don't make sense, we say so." },
];

export const FSR_SSR_CTA = {
  heading: "Ready to See What You Pay?",
  body: `Upload your statement now. ${claimText("timing.staged-process")}`,
} as const;
