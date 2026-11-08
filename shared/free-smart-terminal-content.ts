// Single source of truth for the /free-smart-terminal page. The React page, the
// server-rendered shell, the FAQ/Service JSON-LD and the route metadata all read
// from this module, and every material statement comes from a public claim
// record (shared/public-claims.ts). The route URL and the offer parameter are
// unchanged; the page label stays "Free Smart Terminal" in navigation.

import { claimText, publicClaims } from "./public-claims";
import { TIMING_NOTE, TIMING_STAGES } from "./public-disclosures";

export const FST_PATH = "/free-smart-terminal";

export const FST_TITLE = "Smart Terminal Options for Qualifying Merchants";

export const FST_TITLE_FULL = `${FST_TITLE} | Liberty Bancard`;

/** Neutral wording only: no free, no-upfront or timing assertion in metadata. */
export const FST_DESCRIPTION = `${claimText("equipment.options.summary", "meta")} Upload your statement for a free review.`;

export const FST_KEYWORDS =
  "smart terminal, payment terminal options, clover flex, pax terminal, merchant services terminal, payment processing terminal";

/** Navigation description: neutral, no free/no-upfront assertion. */
export const FST_NAV_DESCRIPTION = "Smart terminal options for qualifying merchants";

export const FST_SERVICE_NAME = "Smart Terminal Equipment Options";

export const FST_SERVICE_DESCRIPTION = claimText("equipment.options.summary", "schema");

export const FST_HERO = {
  badge: "Smart Terminal Options",
  heading: "Explore Smart Terminal Options for Your Business.",
  sub: `${claimText("equipment.options.summary")} We review your statement to confirm what fits.`,
  primaryCta: "Check My Options — Free Review",
  secondaryCta: "Book a review call",
  disclaimer: `${claimText("equipment.agreement.summary")} Not a guaranteed offer.`,
} as const;

/**
 * Visible only if a written program record approves it. While the claim is
 * withheld this is null and renderers show nothing. When approved, renderers
 * must place it directly next to FST_EQUIPMENT_TERMS_DISCLOSURE.
 */
export const FST_PLACEMENT_CLAIM: string | null = publicClaims.textOrNull("equipment.placement.no-upfront", "page");

export const FST_EQUIPMENT_TERMS_DISCLOSURE = claimText("equipment.footer.disclosure", "page");

export const FST_TRUST_STRIP: readonly string[] = [
  "Eligibility confirmed via statement review",
  "Equipment terms confirmed during review",
  "Your written agreement sets term, fees and return requirements",
  "Account approval, equipment availability and shipping are separate",
];

export const FST_FEATURES_HEADING = "What to Look For in a Smart Terminal";
export const FST_FEATURES_INTRO =
  "Features depend on the model and configuration confirmed during review. Equipment terms are set by your written agreement.";

export const FST_FEATURES: readonly { label: string; desc: string }[] = [
  { label: "Tap, chip & swipe", desc: "Accepts tap, chip and swipe payments" },
  { label: "Pricing-program ready", desc: "Can be configured for cash discount or standard processing where the program applies" },
  { label: "Guided setup", desc: "Configured for your business and supported by our team" },
  { label: "Clear receipts", desc: "Receipts can show the disclosures your pricing program requires" },
];

export const FST_ELIGIBILITY = {
  heading: "What We Will Ask About",
  intro: claimText("equipment.eligibility.questions"),
  items: [
    "Your business type and how you take card payments",
    "Your expected monthly card volume",
    "Any current equipment lease or processing agreement",
    "The information needed to review an account application",
  ],
  notGuaranteed:
    "Equipment is not guaranteed for all merchants. Eligibility depends on account approval, underwriting, card volume and business type. We confirm details during your free statement review.",
  ctaCardHeading: "Not Sure What Fits?",
  ctaCardBody:
    "Upload your most recent processing statement. We'll review your card volume, current setup and equipment situation, then follow up with your options.",
} as const;

export const FST_STEPS_HEADING = "How It Works";
export const FST_STEPS_INTRO = "The stages are separate, and each depends on your review and approval.";

export const FST_STEPS: readonly { step: string; title: string; desc: string }[] = [
  { step: "1", title: "Upload Your Statement", desc: "PDF or photo. We only need totals and fee lines. Redact account numbers if you prefer." },
  { step: "2", title: "Review", desc: "We review your volume, setup and current equipment situation and contact you about next steps." },
  { step: "3", title: "Account Approval", desc: "If you apply, your account is underwritten. Approval is separate from equipment." },
  { step: "4", title: "Equipment and Activation", desc: "Equipment availability, shipping and activation are confirmed separately after approval." },
];

export const FST_TIMING_NOTE = TIMING_NOTE;
export const FST_TIMING_STAGES = TIMING_STAGES;

export const FST_FINAL = {
  heading: "Find Out What Fits",
  body: "Upload your statement and we'll review it. The review is free, with no obligation. You keep the breakdown either way.",
  footnote: `${claimText("equipment.options.summary")} ${claimText("equipment.agreement.summary")}`,
} as const;

export const fstFaqItems: { question: string; answer: string }[] = [
  {
    question: "What does the terminal cost?",
    answer: `${claimText("equipment.options.summary", "faq")} ${claimText("equipment.agreement.summary", "faq")}`,
  },
  {
    question: "Which terminals are available?",
    answer: claimText("equipment.models.options", "faq"),
  },
  {
    question: "What if I'm already in a lease?",
    answer: claimText("equipment.lease.existing", "faq"),
  },
  {
    question: "How long does it take to get a terminal?",
    answer: claimText("timing.staged-process", "faq"),
  },
  {
    question: "What are the contract terms?",
    answer: `${claimText("equipment.agreement.summary", "faq")} Review the written agreement before you sign it.`,
  },
];
