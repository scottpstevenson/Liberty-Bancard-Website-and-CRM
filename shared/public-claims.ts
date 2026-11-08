// Public claim and offer-terms records.
//
// One typed, client/server-safe module. Every public surface that states a
// material fact about equipment, contract terms, timing, funding, statement
// handling, program legality, integration compatibility or pricing reads the
// wording from here. Renderers never hard-code those assertions.
//
// Rules enforced by the selector and by scripts/test-public-claims-contract.ts:
//  - Only an "approved" record exposes wording. A "withheld" or "retired"
//    record never exposes its asserting wording: it carries no text at all and
//    yields its safe fallback (or nothing).
//  - An "approved" record must name an evidence key that exists in the
//    server-only register (server/data/public-claim-evidence.ts). The key is an
//    opaque identifier; the evidence itself never enters the public bundle.
//  - Records have no database or server imports so the same module can run in
//    the browser bundle and in server-rendered HTML.

export type ClaimFamily =
  | "equipment"
  | "timing"
  | "funding"
  | "review"
  | "program"
  | "compat"
  | "price";

export type ClaimDisposition = "approved" | "withheld" | "retired";

export type ClaimPlacement =
  | "page"
  | "faq"
  | "meta"
  | "schema"
  | "footer"
  | "nav"
  | "quiz"
  | "home";

export const ALL_CLAIM_PLACEMENTS: readonly ClaimPlacement[] = [
  "page",
  "faq",
  "meta",
  "schema",
  "footer",
  "nav",
  "quiz",
  "home",
];

interface ClaimBase {
  /** Stable identifier. Never reused for different wording. */
  id: string;
  /** Increment when the wording changes. */
  version: number;
  family: ClaimFamily;
  /** ISO date the disposition was last reviewed. */
  reviewedOn: string;
}

export interface ApprovedClaim extends ClaimBase {
  disposition: "approved";
  /** Safe display wording. */
  text: string;
  placements: readonly ClaimPlacement[];
  /** Opaque key into the server-only evidence register. Required. */
  evidenceKey: string;
}

export interface HeldClaim extends ClaimBase {
  disposition: "withheld" | "retired";
  /** Safe text shown instead of the held assertion, or null to show nothing. */
  fallbackId: string | null;
  /** The held assertion has no wording here by design. */
  text?: never;
  placements?: never;
}

export type PublicClaimRecord = ApprovedClaim | HeldClaim;

const REVIEWED = "2026-11-08";

function approved(
  id: string,
  family: ClaimFamily,
  text: string,
  evidenceKey: string,
  placements: readonly ClaimPlacement[] = ALL_CLAIM_PLACEMENTS,
  version = 1,
): ApprovedClaim {
  return { id, version, family, disposition: "approved", text, placements, evidenceKey, reviewedOn: REVIEWED };
}

function held(
  id: string,
  family: ClaimFamily,
  disposition: "withheld" | "retired",
  fallbackId: string | null,
): HeldClaim {
  return { id, version: 1, family, disposition, fallbackId, reviewedOn: REVIEWED };
}

// Evidence keys. The register entries live in server/data/public-claim-evidence.ts.
const EV_CONTRACT = "EV-WA-CONTRACT-SAFE-WORDING";
const EV_TAXONOMY = "EV-WA-CONTRACT-FEE-TAXONOMY";
const EV_HANDLING = "EV-WA-CODE-STATEMENT-HANDLING-TRACE";
const EV_CARD_TYPES = "EV-WA-CARD-NETWORK-DEBIT-PREPAID";

export const PUBLIC_CLAIM_RECORDS: readonly PublicClaimRecord[] = [
  // ── Equipment and processing agreement ────────────────────────────────────
  approved(
    "equipment.options.summary",
    "equipment",
    "Explore equipment options for your business. Availability, processing costs and equipment terms are confirmed during review.",
    EV_CONTRACT,
  ),
  approved(
    "equipment.agreement.summary",
    "equipment",
    "Your written processing agreement and equipment arrangement set the applicable fees, term, cancellation and return requirements.",
    EV_CONTRACT,
  ),
  approved(
    "equipment.footer.disclosure",
    "equipment",
    "Equipment placement, where offered, requires an approved and active processing account. Your written processing agreement and equipment arrangement set the applicable fees, minimum processing requirements, term, ownership, cancellation and return requirements, including any early termination fee that applies. Equipment availability is confirmed during review.",
    EV_CONTRACT,
    ["footer", "page"],
  ),
  approved(
    "equipment.models.options",
    "equipment",
    "Smart terminal models can include the Clover Flex 3 and the PAX A920. Which model is available for your business, and on what terms, is confirmed during review.",
    EV_CONTRACT,
    ["page", "faq", "schema"],
  ),
  approved(
    "equipment.eligibility.questions",
    "equipment",
    "We will ask about your business type, expected monthly card volume, any current equipment lease or processing agreement, and the information needed to review an account application.",
    EV_CONTRACT,
    ["page", "faq", "schema"],
  ),
  approved(
    "equipment.lease.existing",
    "equipment",
    "If you are under an equipment lease or processing agreement with another provider, bring it to the review. We will note it and show you the cost picture. We do not guarantee lease buyouts.",
    EV_CONTRACT,
    ["page", "faq", "schema"],
  ),
  approved(
    "equipment.terms.card",
    "equipment",
    "Equipment availability, fees and terms are confirmed in your quote and written processing agreement before you decide.",
    EV_CONTRACT,
    ["page", "faq"],
  ),
  approved(
    "equipment.terms.quote",
    "equipment",
    "Terms confirmed in your quote",
    EV_CONTRACT,
    ["page", "faq", "schema"],
  ),
  // Held: the unqualified no-upfront-cost placement offer. Becomes displayable
  // only with a written program record (qualification, ownership, return, term,
  // fees) shown together before inquiry submission.
  held("equipment.placement.no-upfront", "equipment", "withheld", null),
  held("equipment.contract.month-to-month", "equipment", "retired", "equipment.agreement.summary"),
  held("equipment.contract.no-etf", "equipment", "retired", "equipment.agreement.summary"),
  held("equipment.contract.you-own-equipment", "equipment", "retired", "equipment.agreement.summary"),
  held("equipment.contract.no-lock-in", "equipment", "retired", "equipment.agreement.summary"),
  // Held: absolute equipment-cost promises that no written program record supports.
  held("equipment.contract.no-lease", "equipment", "retired", "equipment.agreement.summary"),
  held("equipment.placement.free-with-processing", "equipment", "retired", "equipment.agreement.summary"),
  held("equipment.monthly-fee.zero", "equipment", "retired", "equipment.terms.quote"),
  held("equipment.volume-threshold", "equipment", "withheld", "equipment.eligibility.questions"),
  held("equipment.commonly-placed", "equipment", "retired", "equipment.models.options"),

  // ── Review offers and promotions ──────────────────────────────────────────
  approved(
    "offer.review.inquiry",
    "review",
    "Upload your statement and we'll review your current processing costs and the options that may fit your business. Eligibility, pricing and equipment terms are confirmed during review, and costs such as equipment, software, gateway and PCI can remain.",
    EV_CONTRACT,
    ["page", "faq", "home"],
  ),
  approved(
    "offer.review.short",
    "review",
    "Upload your statement for a review of your processing costs. Eligibility, pricing and equipment terms are confirmed during review.",
    EV_CONTRACT,
    ["page", "home"],
  ),
  held("offer.free-processing", "review", "retired", "offer.review.inquiry"),
  held("offer.eliminate-processing-fees", "review", "retired", "offer.review.inquiry"),

  // ── Timing ────────────────────────────────────────────────────────────────
  approved(
    "timing.staged-process",
    "timing",
    "We'll review your request and contact you about next steps. Account approval, equipment availability, shipping and activation are separate.",
    EV_CONTRACT,
  ),
  held("timing.window.48-hours", "timing", "retired", "timing.staged-process"),
  held("timing.window.same-day", "timing", "retired", "timing.staged-process"),
  held("timing.window.one-business-day", "timing", "retired", "timing.staged-process"),
  held("timing.window.shipping-days", "timing", "retired", "timing.staged-process"),
  held("timing.window.approval-days", "timing", "retired", "timing.staged-process"),

  // ── Funding ───────────────────────────────────────────────────────────────
  approved(
    "funding.availability",
    "funding",
    "Funding availability and timing depend on the product, your eligibility, processing cutoffs, and bank and risk conditions.",
    EV_CONTRACT,
  ),
  held("funding.next-day", "funding", "retired", "funding.availability"),

  // ── Statement review ──────────────────────────────────────────────────────
  approved(
    "review.taxonomy.summary",
    "review",
    "A statement review explains your charges in at least three categories: interchange, network assessments and fees, and processor or service charges. Equipment, gateway and other applicable charges are identified separately.",
    EV_TAXONOMY,
  ),
  approved(
    "review.effective-cost.definition",
    "review",
    "Effective cost is the fees included in the review divided by the card volume they relate to over the same period. A fee we cannot identify is listed as unknown rather than estimated.",
    EV_TAXONOMY,
  ),
  approved(
    "review.cost.free",
    "review",
    "The review is free, with no obligation to change processors. Charges for processing, equipment or other services are separate.",
    EV_CONTRACT,
  ),
  approved(
    "review.process.summary",
    "review",
    "Our team reviews your statement and follows up with what we found and your options.",
    EV_CONTRACT,
  ),
  approved(
    "review.handling.summary",
    "review",
    "Uploaded statements are stored in encrypted form and retrieved only through authorized access. How we use and share information, including with service providers, is described in our Privacy Policy. You can redact account numbers; totals and fee lines are what the review needs.",
    EV_HANDLING,
    ["page", "faq", "schema"],
  ),
  held("review.savings.benchmark", "review", "retired", null),
  held("review.industry-rate-ranges", "review", "retired", null),
  held("review.handling.never-shared", "review", "retired", "review.handling.summary"),
  held("review.handling.confidential-badge", "review", "retired", "review.handling.summary"),
  held("review.handling.team-only-access", "review", "retired", "review.handling.summary"),
  held("review.analysis.automatic-ai", "review", "retired", "review.process.summary"),
  held("review.approval.business-days", "review", "retired", "timing.staged-process"),

  // ── 0% / cash discount / surcharge program ────────────────────────────────
  approved(
    "program.overview",
    "program",
    "Cash discount and credit card surcharging are two different programs. Whether either fits your business depends on your state, card mix, customer type and card brand and acquirer rules, and is confirmed in a business-specific review.",
    EV_CONTRACT,
  ),
  approved(
    "program.surcharge.credit-only",
    "program",
    "Credit card surcharging does not apply to debit or prepaid cards, including a debit card run without a PIN.",
    EV_CARD_TYPES,
    ["page", "faq", "schema", "home"],
  ),
  approved(
    "program.card-types",
    "program",
    "Credit card surcharging does not apply to debit or prepaid cards, including a debit card run without a PIN. A cash discount is a separate program and is reviewed separately. We review how each card type applies to your business, under state law and card brand rules, before recommending a program.",
    EV_CARD_TYPES,
  ),
  approved(
    "program.remaining-costs",
    "program",
    "Your business can still have costs, such as equipment, software, gateway, PCI and other account fees. A review shows which ones apply to you.",
    EV_CONTRACT,
  ),
  approved(
    "program.requirements",
    "program",
    "Signage, receipt and registration or disclosure requirements depend on the program and on card brand and state rules. We review them with you before you enroll.",
    EV_CONTRACT,
  ),
  approved(
    "program.overview.meta",
    "program",
    "Cash discount and surcharging are different programs. Whether either fits your business depends on your state, card mix and card brand rules.",
    EV_CONTRACT,
    ["meta", "schema"],
  ),
  held("program.zero-cost", "program", "retired", "program.overview"),
  held("program.legal-path", "program", "retired", "program.overview"),
  held("program.every-requirement", "program", "retired", "program.requirements"),
  held("program.all-states", "program", "retired", "program.overview"),
  held("program.savings-math", "program", "retired", "program.remaining-costs"),
  held("program.uniform-surcharge-rate", "program", "retired", "program.card-types"),

  // ── Integrations ──────────────────────────────────────────────────────────
  approved(
    "compat.inquiry",
    "compat",
    "Tell us your platform, product or version, and current setup. We'll confirm supported options and any limitations before recommending a change.",
    EV_CONTRACT,
  ),
  approved(
    "compat.inquiry.meta",
    "compat",
    "We'll confirm supported options and any limitations for your platform before recommending a change.",
    EV_CONTRACT,
    ["meta", "schema"],
  ),
  held("compat.universal", "compat", "retired", "compat.inquiry"),
  held("compat.platform-count", "compat", "retired", "compat.inquiry"),
  held("compat.no-lock-in", "compat", "retired", "compat.inquiry"),
  held("compat.fee-bypass", "compat", "retired", "compat.inquiry"),
  held("compat.single-billing-relationship", "compat", "retired", "compat.inquiry"),
  held("compat.no-gateway-layer", "compat", "retired", "compat.inquiry"),

  // ── Pricing ───────────────────────────────────────────────────────────────
  approved(
    "price.comparison.method",
    "price",
    "Provider rates shown are published list rates for the plan and channel named, checked on the date shown. They are not a quote for your business. A like-for-like comparison needs your statement.",
    EV_CONTRACT,
  ),
  approved(
    "price.comparison.method.unpublished",
    "price",
    "No provider rate is shown here because the provider does not publish a single rate. A like-for-like comparison needs your statement.",
    EV_CONTRACT,
  ),
  held("price.liberty.assumed-rates", "price", "retired", "price.comparison.method"),
  held("price.savings-estimates", "price", "retired", "price.comparison.method"),
];

// ── Selector ────────────────────────────────────────────────────────────────

export class ClaimLookupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaimLookupError";
  }
}

export interface SafeClaimDto {
  id: string;
  text: string;
}

export interface ClaimSelector {
  /** Wording for a claim at a placement, or null when nothing may be shown. */
  textOrNull(id: string, placement: ClaimPlacement): string | null;
  /** Like textOrNull but throws when nothing may be shown (use for required copy). */
  text(id: string, placement?: ClaimPlacement): string;
  dto(id: string, placement: ClaimPlacement): SafeClaimDto | null;
  has(id: string): boolean;
  disposition(id: string): ClaimDisposition;
  ids(): string[];
}

const MAX_FALLBACK_DEPTH = 4;

export function createClaimSelector(records: readonly PublicClaimRecord[]): ClaimSelector {
  const byId = new Map<string, PublicClaimRecord>();
  for (const record of records) {
    if (byId.has(record.id)) throw new ClaimLookupError(`Duplicate public claim id: ${record.id}`);
    byId.set(record.id, record);
  }

  function lookup(id: string): PublicClaimRecord {
    const record = byId.get(id);
    if (!record) throw new ClaimLookupError(`Unknown public claim id: ${id}`);
    return record;
  }

  function resolve(id: string, placement: ClaimPlacement, depth: number): string | null {
    if (depth > MAX_FALLBACK_DEPTH) throw new ClaimLookupError(`Fallback chain too deep for ${id}`);
    const record = lookup(id);
    if (record.disposition === "approved") {
      return record.placements.includes(placement) ? record.text : null;
    }
    return record.fallbackId ? resolve(record.fallbackId, placement, depth + 1) : null;
  }

  return {
    textOrNull: (id, placement) => resolve(id, placement, 0),
    text(id, placement = "page") {
      const value = resolve(id, placement, 0);
      if (value === null) throw new ClaimLookupError(`No displayable wording for ${id} at ${placement}`);
      return value;
    },
    dto(id, placement) {
      const value = resolve(id, placement, 0);
      return value === null ? null : { id, text: value };
    },
    has: (id) => byId.has(id),
    disposition: (id) => lookup(id).disposition,
    ids: () => Array.from(byId.keys()),
  };
}

export interface ClaimProblem {
  id: string;
  problem: string;
}

/**
 * Structural validation. `knownEvidenceKeys` is the key set from the
 * server-only register; omit it to skip the evidence-existence check (browser).
 */
export function validateClaimRecords(
  records: readonly PublicClaimRecord[],
  knownEvidenceKeys?: ReadonlySet<string>,
): ClaimProblem[] {
  const problems: ClaimProblem[] = [];
  const ids = new Set(records.map((r) => r.id));
  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.id)) problems.push({ id: record.id, problem: "duplicate id" });
    seen.add(record.id);
    if (!/^[a-z0-9]+(\.[a-z0-9-]+)+$/.test(record.id)) problems.push({ id: record.id, problem: "malformed id" });
    if (!Number.isInteger(record.version) || record.version < 1) problems.push({ id: record.id, problem: "invalid version" });
    if (record.disposition === "approved") {
      if (!record.evidenceKey) problems.push({ id: record.id, problem: "approved claim has no evidence key" });
      else if (knownEvidenceKeys && !knownEvidenceKeys.has(record.evidenceKey)) {
        problems.push({ id: record.id, problem: `evidence key not in register: ${record.evidenceKey}` });
      }
      if (!record.text || !record.text.trim()) problems.push({ id: record.id, problem: "approved claim has no wording" });
      if (!record.placements || record.placements.length === 0) problems.push({ id: record.id, problem: "approved claim has no placements" });
    } else {
      if ((record as { text?: unknown }).text !== undefined) problems.push({ id: record.id, problem: "held claim carries wording" });
      if (record.fallbackId !== null) {
        if (!ids.has(record.fallbackId)) problems.push({ id: record.id, problem: `fallback not found: ${record.fallbackId}` });
        else {
          const target = records.find((r) => r.id === record.fallbackId);
          if (target && target.disposition !== "approved") problems.push({ id: record.id, problem: "fallback is not approved" });
        }
      }
    }
  }
  return problems;
}

/** Default selector over the production records. */
export const publicClaims: ClaimSelector = createClaimSelector(PUBLIC_CLAIM_RECORDS);

/** Convenience: required visible wording for a claim. */
export function claimText(id: string, placement: ClaimPlacement = "page"): string {
  return publicClaims.text(id, placement);
}

// ── Cost comparison with unknown material costs ─────────────────────────────

export interface CostInput {
  label: string;
  /** Monthly dollars, or null when unknown. */
  monthlyUsd: number | null;
  /** Material costs must be known before a complete figure can be shown. */
  material: boolean;
}

export interface CostComparison {
  includedUsd: number;
  includedLabels: string[];
  unknownLabels: string[];
  /** True only when every material input is known. */
  complete: boolean;
}

export function compareCosts(inputs: readonly CostInput[]): CostComparison {
  let includedUsd = 0;
  const includedLabels: string[] = [];
  const unknownLabels: string[] = [];
  for (const input of inputs) {
    if (input.monthlyUsd === null) {
      if (input.material) unknownLabels.push(input.label);
      continue;
    }
    includedUsd += input.monthlyUsd;
    includedLabels.push(input.label);
  }
  return { includedUsd, includedLabels, unknownLabels, complete: unknownLabels.length === 0 };
}

/**
 * A savings figure may be rendered only when both sides are complete. With any
 * unknown material cost this returns null and callers must show the inputs and
 * the unknowns instead of a total.
 */
export function renderableSavingsUsd(current: CostComparison, proposed: CostComparison): number | null {
  if (!current.complete || !proposed.complete) return null;
  return Math.round((current.includedUsd - proposed.includedUsd) * 100) / 100;
}
