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
  badge: "LIBERTY BANCARD EQUIPMENT PROGRAM",
  heading: "Equipment options. For qualified merchants.",
  sub: `${claimText("equipment.options.summary")} Start with an eligibility check so you understand the processing costs and equipment terms before you decide.`,
  primaryCta: "Discuss my setup",
  secondaryCta: "Book a review call",
  /** Shown beside the primary action, at readable size. Matches the approved footer disclosure's account requirement. */
  offerNote: "Approved processing account required. Processing fees and equipment program terms apply.",
  disclaimer: `${claimText("equipment.agreement.summary")} Not a guaranteed offer.`,
} as const;

/** The terminal request path: an offer-specific mode of the existing intake. A statement is never required here. */
export const FST_INQUIRY_PATH = "/get-started?offer=free-terminal";
/** Existing merchants who already accept cards can ask for a statement review instead. */
export const FST_STATEMENT_REVIEW_PATH = "/upload-statement#statement-review-form";

/** Directly after the hero: the equipment and the processing are explained together, with the approved terms adjacent. */
export const FST_OFFER = {
  heading: "Understand the equipment and the processing together.",
  body: "We'll discuss your business, current equipment and card-processing needs. If your business qualifies, we'll explain the equipment arrangement, applicable costs and next steps.",
  checklist: ["Business eligibility", "Equipment arrangement", "Processing and recurring fees", "Setup and support requirements"],
  secondaryLead: "Already accepting cards?",
  secondaryCta: "Get a statement review.",
  /** Hardware shown is a set of equipment options, not a guarantee of a model or its availability. */
  imageNote: "Models shown are examples of equipment options. Which model is available for your business is confirmed during review.",
} as const;

/**
 * Visible only if a written program record approves it. While the claim is
 * withheld this is null and renderers show nothing. When approved, renderers
 * must place it directly next to FST_EQUIPMENT_TERMS_DISCLOSURE.
 */
export const FST_PLACEMENT_CLAIM: string | null = publicClaims.textOrNull("equipment.placement.no-upfront", "page");

export const FST_EQUIPMENT_TERMS_DISCLOSURE = claimText("equipment.footer.disclosure", "page");

export const FST_TRUST_STRIP: readonly string[] = [
  "Eligibility confirmed during review",
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
    "Equipment is not guaranteed for all merchants. Eligibility depends on account approval, underwriting, card volume and business type. We confirm details during review.",
  ctaCardHeading: "Not Sure What Fits?",
  ctaCardBody:
    "Tell us about your business and your current setup. We'll review whether it fits the equipment program and contact you about next steps. A new business doesn't need a statement.",
} as const;

export const FST_STEPS_HEADING = "How It Works";
export const FST_STEPS_INTRO = "The stages are separate, and each depends on your review and approval.";

export const FST_STEPS: readonly { step: string; title: string; desc: string }[] = [
  { step: "1", title: "Tell Us About Your Business", desc: "Share your business type, expected card volume and whether you lease a terminal today. No statement is needed for a new business." },
  { step: "2", title: "Review", desc: "Our team reviews your details and contacts you about eligibility and next steps." },
  { step: "3", title: "Account Approval", desc: "If you apply, your account is underwritten. Approval is separate from equipment." },
  { step: "4", title: "Equipment and Activation", desc: "Equipment availability, shipping and activation are confirmed separately after approval." },
];

export const FST_TIMING_NOTE = TIMING_NOTE;
export const FST_TIMING_STAGES = TIMING_STAGES;

export const FST_FINAL = {
  heading: "Find Out What Fits",
  body: "Tell us about your business and we'll review your equipment options. If you already accept cards, you can also request a statement review.",
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
