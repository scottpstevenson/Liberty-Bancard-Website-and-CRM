/**
 * Public partner-program content owner, read by the React pages, the server-rendered documents and the tests.
 *
 * Commercial rule: this module carries NO proposed or unapproved referral share. The referral compensation sentence is
 * produced by a generic formatter from a published-policy projection (`PartnerReferralPolicy`) that only the server
 * produces, and only while an administrator-approved policy record exists (see partner_public_policy_versions). With no
 * approval the projection is `written_agreement` and every referral surface says compensation is confirmed in the
 * written agreement. The qualified sales-agent 50% wording is the one numeric term that is approved for public use.
 *
 * No database or server imports: the client bundle imports this file.
 */

export const PARTNER_PATH_IDS = ["referral", "sales_agent"] as const;
export type PartnerPathId = (typeof PARTNER_PATH_IDS)[number];

export const PARTNER_ROUTES = {
  hub: "/partners",
  referral: "/partners/referrals",
  salesAgent: "/partners/sales-agents",
  cpa: "/partners/cpa",
  bookkeeper: "/partners/bookkeeper",
  insurance: "/partners/insurance",
  affiliate: "/affiliate",
  login: "/partner-login",
  privacy: "/privacy-policy",
  contact: "/about-contact#inquiry",
} as const;

export const PARTNER_PATH_ROUTE: Record<PartnerPathId, string> = {
  referral: PARTNER_ROUTES.referral,
  sales_agent: PARTNER_ROUTES.salesAgent,
};

export const PARTNER_PATH_LABEL: Record<PartnerPathId, string> = {
  referral: "Referral partner",
  sales_agent: "Sales agent",
};

// ── Published referral policy projection ────────────────────────────────────────────────────────────────────────────

export type PartnerReferralPolicy =
  | { state: "written_agreement" }
  | { state: "approved"; version: number; sharePercent: number };

/** The release-safe default: also what any malformed, unavailable or revoked projection collapses to. */
export const DEFAULT_REFERRAL_POLICY: PartnerReferralPolicy = { state: "written_agreement" };

/** Accepts only a well-formed approved projection; anything else is the safe default. Never throws. */
export function parseReferralPolicy(value: unknown): PartnerReferralPolicy {
  if (!value || typeof value !== "object") return DEFAULT_REFERRAL_POLICY;
  const v = value as Record<string, unknown>;
  if (v.state !== "approved") return DEFAULT_REFERRAL_POLICY;
  const share = v.sharePercent;
  const version = v.version;
  if (typeof share !== "number" || !Number.isInteger(share) || share < 1 || share > 100) return DEFAULT_REFERRAL_POLICY;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) return DEFAULT_REFERRAL_POLICY;
  return { state: "approved", version, sharePercent: share };
}

export const REFERRAL_WRITTEN_AGREEMENT_SENTENCE =
  "Eligible partners can earn recurring compensation under their written referral agreement.";
export const REFERRAL_RESULT_GATED_MESSAGE = "Referral compensation is confirmed in your written agreement.";

/** The only place a published referral percentage is turned into words. The number always comes from the projection. */
export function referralCompensationSentence(policy: PartnerReferralPolicy): string {
  if (policy.state === "approved") {
    return `Earn ${policy.sharePercent}% of eligible collected processing residual from your qualifying referred merchants, subject to your written referral agreement.`;
  }
  return REFERRAL_WRITTEN_AGREEMENT_SENTENCE;
}

// ── Page copy ───────────────────────────────────────────────────────────────────────────────────────────────────────

export const PARTNER_HUB_HERO = {
  eyebrow: "Liberty partnerships",
  heading: "Grow with Liberty Bancard.",
  body: "Introduce a business that needs payment processing, or build your own portfolio as a sales agent. Choose the partnership that matches the work you want to do.",
  primaryCta: "Refer a business",
  secondaryCta: "Become a sales agent",
  signIn: "Already a partner? Sign in",
} as const;

export const PARTNER_AGENT_QUALIFIED_SENTENCE =
  "Eligible self-sourced, full-cycle sales agents earn 50% of eligible collected processing residual under their signed compensation schedule. Company-provided and referred leads may have different agreed terms.";

export const PARTNER_REFERRAL_CARD = {
  title: "Make the introduction. Let us handle the sale.",
  bodyLead:
    "Connect Liberty Bancard with a business that has agreed to hear from us. Our team handles the sales conversation, onboarding and ongoing payment-processing support.",
  cta: "Explore referrals",
  responsibilities: [
    "Introduce only businesses that agreed to hear from Liberty",
    "Share who you are introducing and why",
    "Leave pricing, proposals and onboarding to Liberty",
  ],
} as const;

export function partnerReferralCardBody(policy: PartnerReferralPolicy): string {
  return `${PARTNER_REFERRAL_CARD.bodyLead} ${referralCompensationSentence(policy)}`;
}

export const PARTNER_AGENT_CARD = {
  title: "Build and manage your own merchant portfolio.",
  body: `Source and develop merchant relationships, guide the sales process and coordinate onboarding with Liberty Bancard. ${PARTNER_AGENT_QUALIFIED_SENTENCE}`,
  cta: "Explore sales-agent opportunities",
  responsibilities: [
    "Prospect and develop your own merchant relationships",
    "Guide each opportunity through the sales process",
    "Coordinate onboarding with Liberty Bancard",
  ],
} as const;

export const PARTNER_REFERRAL_JOURNEY = {
  heading: "Turn trusted introductions into a referral partnership.",
  body: "You know businesses that could benefit from a payment-processing conversation. Make a permission-based introduction and Liberty Bancard will handle the sales process, onboarding and support. Your written agreement explains qualifying referrals, attribution and compensation.",
  applyCta: "Apply as a referral partner",
  otherPathLink: "Explore the sales-agent path",
  formHeading: "Request a referral partnership.",
  youDo: [
    "Make a permission-based introduction",
    "Tell us who you are introducing and why",
    "Stay available if the business has questions about you",
  ],
  libertyDoes: [
    "Handles the sales conversation and proposal",
    "Completes underwriting and onboarding with its processing partners",
    "Supports the merchant after approval",
  ],
  steps: [
    { title: "Apply", body: "Tell us about your professional network. No password, statements or financial documents are needed." },
    { title: "Review and agreement", body: "Liberty Bancard reviews your application and, if it moves forward, confirms terms in a written referral agreement." },
    { title: "Introduce businesses", body: "After approval you introduce businesses that agreed to an introduction. Liberty takes it from there." },
  ],
} as const;

export const PARTNER_AGENT_JOURNEY = {
  heading: "Build your payments portfolio with Liberty Bancard.",
  body: "This path is for people who want to prospect, develop relationships and help close merchant opportunities. For qualifying self-sourced, full-cycle business, the compensation structure is 50% of eligible collected processing residual under your signed schedule. Other lead sources and arrangements are confirmed separately.",
  applyCta: "Apply as a sales agent",
  otherPathLink: "Explore the referral path",
  formHeading: "Apply to become a sales agent.",
  responsibilities: [
    "Prospect and build relationships with business owners",
    "Guide opportunities through discovery, proposal and onboarding",
    "Keep merchant information accurate and handle it with care",
  ],
  libertySupport: [
    "Pricing and proposal review for the opportunities you bring",
    "Underwriting and onboarding through Liberty and its processing partners",
    "A written compensation schedule before any compensation terms apply",
  ],
  qualification: PARTNER_AGENT_QUALIFIED_SENTENCE,
  steps: [
    { title: "Apply", body: "Describe your payments or sales experience and how you prospect." },
    { title: "Review and schedule", body: "Liberty reviews your background and, if it moves forward, confirms a written compensation schedule." },
    { title: "Work your portfolio", body: "Approved agents source merchants and coordinate onboarding with Liberty." },
  ],
} as const;

export const PARTNER_REVIEW_DISCLOSURE =
  "Applications and merchant accounts are subject to review and approval by Liberty Bancard and its processing partners, as applicable. Earnings depend on merchant activity, collected eligible income and the applicable agreement. No approval or earnings are guaranteed.";

export const PARTNER_SUCCESS_COPY: Record<PartnerPathId, { heading: string; body: string }> = {
  referral: {
    heading: "Application received",
    body: "Thank you. Your referral-partner application has been received. Liberty Bancard will review it and contact you about next steps. No compensation terms apply until confirmed in your agreement.",
  },
  sales_agent: {
    heading: "Application received",
    body: "Thank you. Your application has been received. Liberty Bancard will review your background and discuss the appropriate next steps and written compensation terms.",
  },
};

export const PARTNER_RECOVERABLE_FAILURE =
  "We couldn’t confirm your submission. Your entries are still here. Please try again or use the contact option below.";
export const PARTNER_NOT_ACCEPTED_ONLINE =
  "We couldn’t accept this application online. Please use the contact option below and mention your application.";

export const PARTNER_PROCESS_STEPS = [
  { title: "Choose and apply", body: "Pick the path that fits your work and tell us about your background." },
  { title: "Review and confirm terms", body: "Liberty Bancard reviews your application and confirms compensation terms in writing." },
  { title: "Introduce or sell", body: "Approved referral partners make consented introductions; approved agents do their own sales work." },
  { title: "Compensation under agreement", body: "Compensation follows your signed agreement, not a public rate card." },
] as const;

export const PARTNER_COMPARISON_ROWS: readonly { attribute: string; referral: string; salesAgent: string }[] = [
  { attribute: "Your role", referral: "Introduce businesses that agreed to hear from Liberty.", salesAgent: "Prospect, develop and help close your own merchant relationships." },
  { attribute: "Who leads the sale", referral: "Liberty Bancard.", salesAgent: "You, with Liberty’s support." },
  { attribute: "Lead source", referral: "Your professional network, with permission.", salesAgent: "Self-sourced; company-lead arrangements are confirmed separately." },
  { attribute: "Compensation basis", referral: "Eligible collected processing residual under your written referral agreement.", salesAgent: "Eligible collected processing residual under your signed schedule." },
  { attribute: "Next step", referral: "Apply as a referral partner.", salesAgent: "Apply as a sales agent." },
];

export const PARTNER_COMPENSATION_BASE =
  "Eligible collected processing residual is recurring processing income actually collected by Liberty after documented processor and sponsor costs and upstream processor share, before partner allocation and general overhead. It is not merchant volume or total fees.";

export interface PartnerFaq {
  id: string;
  question: string;
  answer: string;
}

/** Ten required answers. Item 4 is the only one that depends on the published policy state. */
export function partnerFaqs(policy: PartnerReferralPolicy): readonly PartnerFaq[] {
  const referralCompensation =
    policy.state === "approved"
      ? `After your application is approved, qualifying referred merchants attributed to you earn the approved standard referral share of eligible collected processing residual (${policy.sharePercent}%), as set out in your written agreement. Tailored terms are agreed separately in writing.`
      : "Referral compensation is confirmed in your written agreement before any work begins. Tailored terms are agreed separately in writing.";
  return [
    {
      id: "difference",
      question: "What is the difference between a referral partner and a sales agent?",
      answer: "Referral partners make permission-based introductions and Liberty handles the sale. Sales agents actively develop and help close opportunities. Your agreement defines the responsibilities and the pay.",
    },
    {
      id: "base",
      question: "What is the percentage based on?",
      answer: `${PARTNER_COMPENSATION_BASE} Your agreement lists what is included, excluded and adjusted.`,
    },
    {
      id: "agent-all-deals",
      question: "Do all of a sales agent’s deals pay 50%?",
      answer: "No. The 50% structure applies to qualifying self-sourced, full-cycle business under your signed schedule. House leads and referred leads may be handled on different terms.",
    },
    {
      id: "referral-compensation",
      question: "How are referral partners compensated?",
      answer: referralCompensation,
    },
    {
      id: "calculator",
      question: "Is the calculator a guarantee?",
      answer: "No. It shows hypothetical results from the assumptions you select. It is not a verified average or an earnings guarantee, and the annualized figure assumes the same activity every month.",
    },
    {
      id: "continuing",
      question: "Do payments continue indefinitely?",
      answer: "Continuing payments depend on the merchant remaining active, Liberty collecting eligible income and your agreement. There is no unconditional lifetime promise.",
    },
    {
      id: "timing",
      question: "When are partners paid?",
      answer: "Your agreement governs payment timing, statements and adjustments. We do not publish a fixed payment date.",
    },
    {
      id: "permission",
      question: "Do I need permission before introducing a business?",
      answer: "Yes. Get the business contact’s agreement to an introduction before you submit their details. Do not submit contact details without permission.",
    },
    {
      id: "account",
      question: "Do I need an account to apply?",
      answer: "No. There is no password at the application stage. If your application is accepted, we explain how to set up portal access.",
    },
    {
      id: "existing",
      question: "What happens to existing partner agreements?",
      answer: "Existing signed terms stay in place unless they are changed through an authorized written agreement.",
    },
  ];
}

// ── FAQ selection (shared by the React pages and the server documents) ────────────────────────────────────────────────

export const PARTNER_FAQ_IDS = {
  referral: ["difference", "referral-compensation", "permission", "continuing", "timing", "account", "existing"],
  salesAgent: ["difference", "base", "agent-all-deals", "continuing", "timing", "account", "existing"],
  profession: ["referral-compensation", "permission", "calculator", "account", "existing"],
} as const;

/** FAQ list for the whole policy state (or a subset by id, in the shared order). */
export function selectPartnerFaqs(policy: PartnerReferralPolicy, ids?: readonly string[]): readonly PartnerFaq[] {
  const all = partnerFaqs(policy);
  return ids ? all.filter((faq) => ids.includes(faq.id)) : all;
}

/** FAQ structured data built from exactly the answers a page renders, never a longer list than the page shows. */
export function buildPartnerFaqJsonLd(faqs: readonly PartnerFaq[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({ "@type": "Question", name: faq.question, acceptedAnswer: { "@type": "Answer", text: faq.answer } })),
  };
}

// ── Section copy (hub, journeys, profession pages) ──────────────────────────────────────────────────────────────────

export const PARTNER_HUB_SECTIONS = {
  paths: { heading: "Two ways to partner with Liberty.", description: "Choose the path that matches the work you want to do." },
  compare: { heading: "How the two paths differ.", description: "Compensation for either path is confirmed in writing before any work begins." },
  process: { heading: "How it works.", description: "Four steps from choosing a path to working under a written agreement." },
  calculator: { heading: "See how a portfolio could add up.", description: "An illustration with assumptions you choose. It is not a quote, an average or a promise of earnings." },
  faq: { heading: "Questions partners ask." },
  choose: {
    heading: "Choose your path.",
    description: "Each path has its own short application. There is no password and no account to create.",
    referralCta: "Referral partner: refer a business",
    agentCta: "Sales agent: build a portfolio",
  },
} as const;

export const PARTNER_JOURNEY_SECTIONS = {
  who: { heading: "Who this is for.", description: "People who work closely with business owners. Listing a profession here is not an endorsement of anyone." },
  rolesReferral: { heading: "Who does what." },
  rolesAgent: { heading: "What the work involves." },
  steps: { heading: "What happens next." },
  applicationDescription: "Your application is reviewed by Liberty Bancard. If it moves forward we confirm terms in writing before any work begins. We do not promise a response time or any earnings.",
  faq: { heading: "Common questions." },
} as const;

export const PARTNER_PROFESSION_SECTIONS = {
  calculator: { heading: "See how a portfolio could add up.", description: "An illustration with assumptions you choose. It is not a quote, an average or a promise of earnings." },
  next: { heading: "Ready to apply?", description: "The application is short, needs no password and creates no account." },
  faq: { heading: "Common questions." },
} as const;

// ── Application inputs shared by the form and the server ────────────────────────────────────────────────────────────

export const PARTNER_PROFESSIONS = [
  { id: "referral", label: "Referral partner" },
  { id: "cpa", label: "CPA or accountant" },
  { id: "bookkeeper", label: "Bookkeeper" },
  { id: "insurance", label: "Insurance agent" },
  { id: "adviser", label: "Financial or business adviser" },
  { id: "consultant", label: "Consultant" },
  { id: "association", label: "Association or membership organization" },
  { id: "other", label: "Other" },
] as const;
export type PartnerProfessionId = (typeof PARTNER_PROFESSIONS)[number]["id"];
export const PARTNER_PROFESSION_IDS = PARTNER_PROFESSIONS.map((p) => p.id) as readonly PartnerProfessionId[];

export function isPartnerProfession(value: unknown): value is PartnerProfessionId {
  return typeof value === "string" && (PARTNER_PROFESSION_IDS as readonly string[]).includes(value);
}

export const PARTNER_INTRO_VOLUME_BANDS = [
  { id: "1_5", label: "1–5 a year" },
  { id: "6_15", label: "6–15 a year" },
  { id: "16_40", label: "16–40 a year" },
  { id: "41_plus", label: "More than 40 a year" },
] as const;
export type PartnerIntroVolumeBandId = (typeof PARTNER_INTRO_VOLUME_BANDS)[number]["id"];

export const PARTNER_LEAD_SOURCE_INTERESTS = [
  { id: "self_sourced", label: "Self-sourced merchants" },
  { id: "company_leads", label: "Company-provided leads (interest only, not a promise of leads)" },
  { id: "both", label: "Both" },
] as const;
export type PartnerLeadSourceInterestId = (typeof PARTNER_LEAD_SOURCE_INTERESTS)[number]["id"];

export const PARTNER_CONTACT_PREFERENCES = [
  { id: "email", label: "Email" },
  { id: "phone", label: "Phone" },
] as const;
export type PartnerContactPreferenceId = (typeof PARTNER_CONTACT_PREFERENCES)[number]["id"];

// ── Introduction permission (post-approval flow) ────────────────────────────────────────────────────────────────────

export const PARTNER_INTRODUCTION_PERMISSION = {
  version: "partner_introduction_permission@1",
  text: "This contact has agreed to an introduction to Liberty Bancard about payment processing. Do not submit contact details without permission.",
} as const;

/** Display for a partner's stored commission value: absent means no terms agreed yet, never 0% or a default. */
export function formatPartnerTerms(commissionPercent: number | null | undefined): string {
  if (commissionPercent === null || commissionPercent === undefined || !Number.isFinite(commissionPercent)) return "Terms pending";
  return `${commissionPercent}%`;
}
