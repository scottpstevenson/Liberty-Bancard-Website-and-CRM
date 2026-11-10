// Public proof projection (W-D, WD-R03, WD-R04, WD-R09).
//
// The only way a customer result, quote or testimonial reaches a public page, the public API or a
// schema block is through projectPublicProof(). A row that is merely "approved" or "published" is not
// proof: the table has no permission, evidence, reporting-period or calculation field, so something
// beyond the row has to exist. This module defines what that is and fails closed when any part is
// missing.
//
// What must be on file for one result to qualify (all of it stays server-side; none of it is projected):
//   - a private, traceable source record
//   - the reporting period, the volume and fee scope that were compared, the calculation and how it
//     was annualized, the intervention and the limits
//   - the review date
//   - recorded permission naming the surfaces it covers, with its own evidence reference
// A quote needs its own evidence reference, separate from the result's.
//
// Candidates live in server/data/public-proof-register.ts. That register is empty: no existing record
// qualifies, so every surface ships the fallback below. Adding the first real entry is a content
// operation that needs no code change; the first-HTML renderers, the React pages and the approved
// endpoint all read the same projection.

import { claimText } from "./public-claims";
import { FSR_DELIVERABLE } from "./free-statement-review-content";
import { ABOUT_CONTACT_PATH } from "./public-contact-content";
import type { OverviewItem, OverviewLink, OverviewPage, OverviewSection } from "./public-overview-pages";

export type ProofSurface = "case-studies" | "testimonials";

export const PROOF_SURFACES: readonly ProofSurface[] = ["case-studies", "testimonials"];

export function isProofSurface(value: unknown): value is ProofSurface {
  return typeof value === "string" && (PROOF_SURFACES as readonly string[]).includes(value);
}

export interface ProofBasis {
  /** Private pointer to the traceable source. Never projected. */
  privateSourceRef: string;
  reportingPeriod: string;
  volumeAndFeeScope: string;
  calculation: string;
  annualizationBasis: string;
  intervention: string;
  limits: string;
  /** ISO date (YYYY-MM-DD) of the last review of this record. */
  reviewedOn: string;
}

export interface ProofPermission {
  granted: boolean;
  /** Private pointer to the recorded permission. Never projected. */
  evidenceRef: string;
  /** ISO date (YYYY-MM-DD) the permission was recorded. */
  recordedOn: string;
  surfaces: readonly ProofSurface[];
}

export interface ProofCandidate {
  id: string;
  /** Set when the entry corresponds to a testimonial_submissions row; that row must also be approved and published. */
  submissionId?: number;
  basis: Partial<ProofBasis>;
  permission?: Partial<ProofPermission>;
  draft: {
    attribution?: string;
    outcome?: string;
    /** Projected only with its own evidence reference. */
    quote?: { text?: string; evidenceRef?: string };
  };
}

/** What a public surface may show. Contains no private reference, calculation workings or contact detail. */
export interface PublicProofItem {
  id: string;
  attribution: string;
  outcome: string;
  quote?: string;
  reportingPeriod: string;
  scope: string;
  limits: string;
  reviewedOn: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function filled(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function validDate(value: unknown, today: string): boolean {
  return typeof value === "string" && ISO_DATE.test(value) && !Number.isNaN(Date.parse(value)) && value <= today;
}

const BASIS_FIELDS: readonly (keyof ProofBasis)[] = [
  "privateSourceRef",
  "reportingPeriod",
  "volumeAndFeeScope",
  "calculation",
  "annualizationBasis",
  "intervention",
  "limits",
];

/** The names of everything missing or invalid for this surface; empty means the candidate qualifies. */
export function proofGaps(candidate: ProofCandidate, surface: ProofSurface, today = new Date().toISOString().slice(0, 10)): string[] {
  const gaps: string[] = [];
  for (const field of BASIS_FIELDS) if (!filled(candidate.basis?.[field])) gaps.push(`basis.${field}`);
  if (!validDate(candidate.basis?.reviewedOn, today)) gaps.push("basis.reviewedOn");

  const permission = candidate.permission;
  if (!permission || permission.granted !== true) gaps.push("permission.granted");
  if (!filled(permission?.evidenceRef)) gaps.push("permission.evidenceRef");
  if (!validDate(permission?.recordedOn, today)) gaps.push("permission.recordedOn");
  if (!permission?.surfaces || !permission.surfaces.includes(surface)) gaps.push(`permission.surfaces:${surface}`);

  if (!filled(candidate.draft?.attribution)) gaps.push("draft.attribution");
  if (!filled(candidate.draft?.outcome)) gaps.push("draft.outcome");
  return gaps;
}

export interface ProjectionContext {
  /** Ids of testimonial_submissions rows that are approved and published right now. */
  approvedSubmissionIds?: ReadonlySet<number>;
  /** ISO date; injectable for tests. */
  today?: string;
}

export function projectPublicProof(
  candidates: readonly ProofCandidate[],
  surface: ProofSurface,
  context: ProjectionContext = {},
): PublicProofItem[] {
  const items: PublicProofItem[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate.id)) continue;
    if (candidate.submissionId !== undefined && !context.approvedSubmissionIds?.has(candidate.submissionId)) continue;
    if (proofGaps(candidate, surface, context.today).length > 0) continue;
    seen.add(candidate.id);

    const item: PublicProofItem = {
      id: candidate.id,
      attribution: (candidate.draft.attribution as string).trim(),
      outcome: (candidate.draft.outcome as string).trim(),
      reportingPeriod: (candidate.basis.reportingPeriod as string).trim(),
      scope: (candidate.basis.volumeAndFeeScope as string).trim(),
      limits: (candidate.basis.limits as string).trim(),
      reviewedOn: candidate.basis.reviewedOn as string,
    };
    const quote = candidate.draft.quote;
    if (quote && filled(quote.text) && filled(quote.evidenceRef)) item.quote = (quote.text as string).trim();
    items.push(item);
  }
  return items;
}

// ── Fallback and page content (shared by the server documents and the React pages) ────────────

export const PROOF_FALLBACK_HEADING = "Understand your processing costs before you decide.";

export const PROOF_ACTIONS: { primary: OverviewLink; secondary: OverviewLink } = {
  primary: { label: "Get a free statement review", href: "/upload-statement" },
  secondary: { label: "Ask a question without a statement", href: `${ABOUT_CONTACT_PATH}#inquiry` },
};

const DELIVERABLE_CARD: OverviewItem = {
  title: "What a statement review gives you",
  body: claimText("review.cost.free"),
  points: FSR_DELIVERABLE.rows,
};

const QUESTIONS_CARD: OverviewItem = {
  title: "Questions to ask any processor",
  body: "These apply to any provider, including us.",
  points: [
    "What is my effective cost: every fee on the statement divided by the card volume it applies to?",
    "Which charges come from the card networks, and which come from my processor?",
    "Which fees are fixed each month no matter what I sell?",
    "How are debit, credit and keyed-in payments priced?",
    "What do the equipment terms say about ending the agreement or returning a terminal?",
    "Who do I contact if something goes wrong, and when are they available?",
  ],
};

function formatReviewedOn(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${months[month - 1]} ${day}, ${year}`;
}

function itemCard(item: PublicProofItem): OverviewItem {
  return {
    badge: item.attribution,
    title: item.outcome,
    body: item.quote ? `\u201c${item.quote}\u201d` : `Reporting period: ${item.reportingPeriod}.`,
    points: [
      ...(item.quote ? [`Reporting period: ${item.reportingPeriod}`] : []),
      `What was compared: ${item.scope}`,
      `Limits: ${item.limits}`,
      `Reviewed ${formatReviewedOn(item.reviewedOn)}`,
    ],
  };
}

interface ProofPageDefinition {
  path: string;
  shortTitle: string;
  description: string;
  keywords: string;
  breadcrumbLabel: string;
  h1: string;
  intro: string;
  itemsHeading: string;
}

const PROOF_PAGE_DEFINITIONS: Record<ProofSurface, ProofPageDefinition> = {
  "case-studies": {
    path: "/case-studies",
    shortTitle: "Case Studies: Understand Your Processing Costs",
    description:
      "We are not publishing customer results right now. See what a statement review covers and the questions to ask any processor before you switch.",
    keywords: "payment processing statement review, effective cost, questions to ask a payment processor, merchant services comparison",
    breadcrumbLabel: "Case studies",
    h1: PROOF_FALLBACK_HEADING,
    intro:
      "We are not publishing customer results on this page right now. What you can see today is what a review of your own statement covers, and the questions worth asking any processor.",
    itemsHeading: "Reviewed results",
  },
  testimonials: {
    path: "/testimonials",
    shortTitle: "Customer Testimonials",
    description:
      "We are not publishing customer testimonials right now. See what a statement review covers and what to ask any processor before you decide.",
    keywords: "payment processing statement review, effective cost, questions to ask a payment processor",
    breadcrumbLabel: "Testimonials",
    h1: "Customer testimonials",
    intro: `We are not publishing customer testimonials on this page right now. ${PROOF_FALLBACK_HEADING}`,
    itemsHeading: "Customer testimonials",
  },
};

/**
 * The page record both the server renderer and the hydrated page render. With no qualifying item the
 * page is the fallback; with items, they appear first and the review and questions follow.
 */
export function proofOverviewPage(surface: ProofSurface, items: readonly PublicProofItem[] = []): OverviewPage {
  const def = PROOF_PAGE_DEFINITIONS[surface];
  const sections: OverviewSection[] = [];
  if (items.length > 0) {
    sections.push({
      id: "reviewed-results",
      heading: def.itemsHeading,
      layout: "cards",
      items: items.map(itemCard),
    });
  }
  sections.push({
    id: "review-and-questions",
    heading: surface === "testimonials" ? PROOF_FALLBACK_HEADING : "Before you decide",
    layout: "cards",
    items: [DELIVERABLE_CARD, QUESTIONS_CARD],
  });
  return {
    path: def.path,
    shortTitle: def.shortTitle,
    title: `${def.shortTitle} | Liberty Bancard`,
    description: def.description,
    keywords: def.keywords,
    breadcrumbLabel: def.breadcrumbLabel,
    h1: def.h1,
    intro: def.intro,
    sections,
    closing: {
      heading: "See what you are paying",
      body: claimText("review.process.summary"),
      primary: PROOF_ACTIONS.primary,
      secondary: PROOF_ACTIONS.secondary,
    },
  };
}

/**
 * Wording for /testimonials/submit, shared by the React page and the server document. Submitting a
 * story is not permission to publish it: the projection above requires recorded permission and a
 * calculation on file, so the page says only what is true.
 */
export const TESTIMONIAL_SUBMIT_COPY = {
  title: "Share Your Experience",
  description:
    "Share your experience with Liberty Bancard. Submitting does not publish anything; we ask for written permission before anything appears on this website.",
  intro:
    "Tell us about your experience with Liberty Bancard, including what you were paying before, what changed and what it meant for your business. Submitting does not publish anything.",
  received: "We've received your submission and our team will review it. Nothing is published without your written permission.",
  videoHelp: "Have a video on YouTube, Vimeo, or another platform? Paste the link here. No video? Leave this blank.",
  usageHeading: "How We Use Your Story",
  usage:
    "Your submission is reviewed by our team and is not published automatically. Before any story, quote or result appears on our website or in our materials, we ask for your written permission, and we show what it covers.",
} as const;
