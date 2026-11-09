// Single source of truth for the "Free Statement Review" copy shown on
// /upload-statement. The React page, the server-rendered shell, route metadata
// and the home links import this module so they cannot drift apart. Material
// statements (cost, handling, timing, funding, equipment) come from public
// claim records in shared/public-claims.ts.

import { claimText } from "./public-claims";
import { STATEMENT_UPLOAD_HELPER } from "./statement-upload-limits";

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
    `Submit your most recent processing statement — from any processor, as a ${STATEMENT_UPLOAD_HELPER} — using the secure upload form on this page.`,
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
  badge: "STATEMENT REVIEW",
  heading: "See what you’re really paying to accept cards.",
  sub: "Send us a recent processing statement. We’ll explain the charges and help you compare your current costs with an actual Liberty proposal.",
  button: "Get my statement review",
  support: "Understand the full cost before you change processors.",
  effectiveCostTitle: "See your effective cost",
  effectiveCostNote: claimText("review.effective-cost.definition"),
  chips: ["Free", "No obligation", "Secure upload", "No processor login"],
  uploadNote: "Encrypted upload. How documents are handled is explained below.",
} as const;

/** LB-SR-02 — what the review gives you. Four short rows; the sample worksheet carries headings and dashes only. */
export const FSR_DELIVERABLE = {
  heading: "A breakdown you can use.",
  rows: [
    "Your effective processing cost for the statement period.",
    "What interchange, network assessments and processor fees mean.",
    "Questions about equipment and your current agreement.",
    "If we propose an alternative, a comparison of relevant processing, recurring and equipment costs.",
  ],
  sampleLabel: "Illustrative review layout. No customer results shown.",
  /** Worksheet column/row headings only: the sample never shows an amount, a saving or a customer. */
  sampleHeadings: ["Statement period", "Card volume", "Fees included", "Effective cost", "Interchange", "Network assessments", "Processor fees", "Equipment and other"],
} as const;

/** LB-SR-03 — the three steps, with no countdown and no promised response time. */
export const FSR_PROCESS = {
  heading: "One statement. A clearer conversation.",
  steps: [
    "Share a recent statement through the upload form.",
    "We review the charges and identify what needs clarification.",
    "We walk you through the findings and any available next steps.",
  ],
  support: "Your proposal and account eligibility depend on your business and processing requirements.",
} as const;

/** LB-SR-04 — the statement intake form. */
export const FSR_FORM = {
  heading: "Start your statement review.",
  intro: "Share your statement and the details we need to contact you.",
  fileLabel: "Recent processing statement",
  helper: "Need help or don’t have a statement?",
  helperLink: "Discuss your business with us.",
  helperHref: "/about-contact",
  submit: "Request my review",
  pending: "Sending your request…",
  success: "We’ve received your review request. Our team will review the information and contact you using the details you provided.",
  failure: "We couldn’t send your request. Please try again. If the problem continues, contact Liberty Bancard.",
  requiredError: "Please complete this field.",
  emailError: "Enter a valid email address.",
} as const;

/** LB-SR-05 — three questions, all answers visible to assistive technology and no turnaround or confidentiality claim. */
export const FSR_FAQ = {
  heading: "Before you send your statement.",
  items: [
    {
      question: "Will you guarantee savings?",
      answer: "No. Your costs depend on your current pricing, transaction mix and proposed terms. The review helps make that comparison clear.",
    },
    {
      question: "What if I’m starting a new business?",
      answer: "You can discuss your processing and equipment needs without a current statement.",
      link: { label: "Discuss my business", href: "/about-contact" },
    },
    {
      question: "Can I ask about a terminal too?",
      answer: "Yes. We can review whether your business qualifies for the equipment program. Processing fees and program terms apply.",
    },
  ],
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
  { icon: "1️⃣", title: "Upload Your Statement", text: `Upload your most recent processing statement. ${STATEMENT_UPLOAD_HELPER}.` },
  { icon: "2️⃣", title: "We Review It", text: claimText("review.process.summary") },
  { icon: "3️⃣", title: "See Your Options", text: "We explain the numbers with the inputs shown. No obligation; if the numbers don't make sense, we say so." },
];

export const FSR_SSR_CTA = {
  heading: "Ready to See What You Pay?",
  body: `Upload your statement now. ${claimText("timing.staged-process")}`,
} as const;
