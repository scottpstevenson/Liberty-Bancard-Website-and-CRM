/**
 * Canonical vertical resolver with source-authority ranking.
 *
 * This module implements `resolveCanonicalVertical()` — a pure function (no DB
 * reads or writes) that determines the authoritative vertical classification
 * for a contact/merchant based on source priority, confidence, and operator
 * override flags.
 *
 * `getCanonicalLeadVertical()` (display helper for downstream consumers) lives in
 * vertical-resolver.ts and is intentionally kept separate.
 */
import { CANONICAL_COARSE_VERTICALS } from "./vertical-constants";

// ─── Source Authority Table ──────────────────────────────────────────────────

export type VerticalSource =
  | "operator_override"
  | "discovery_enrichment"
  | "import_classification"
  | "website_form"
  | "ghl_sync"
  | "legacy_unknown";

export const VERTICAL_SOURCE_AUTHORITY: Record<string, number> = {
  operator_override: 500,
  discovery_enrichment: 400,
  import_classification: 300,
  website_form: 200,
  ghl_sync: 100,
  legacy_unknown: 0,
};

// ─── Subvertical → Coarse Parent Mapping ─────────────────────────────────────

export const SUBVERTICAL_MAP_VERSION = "1";

export const SUBVERTICAL_TO_COARSE_VERTICAL: Record<string, string> = {
  "Med Spa": "Healthcare",
  "Medical Spa": "Healthcare",
  "Dental": "Healthcare",
  "Optometry": "Healthcare",
  "Chiropractic": "Healthcare",
  "Veterinary": "Healthcare",
  "Hair Salon": "Salon/Spa",
  "Nail Salon": "Salon/Spa",
  "Barber": "Salon/Spa",
  "Esthetics": "Salon/Spa",
  "Waxing": "Salon/Spa",
  "Auto Repair": "Auto",
  "Auto Detailing": "Auto",
  "Tire Shop": "Auto",
  "Towing": "Auto",
  "Pizza": "Restaurant",
  "Fast Food": "Restaurant",
  "Café": "Restaurant",
  "Cafe": "Restaurant",
  "Bar": "Restaurant",
  "Yoga": "Fitness/Recreation",
  "CrossFit": "Fitness/Recreation",
  "Martial Arts": "Fitness/Recreation",
  "Gym": "Fitness/Recreation",
  "Plumbing": "Construction",
  "HVAC": "Construction",
  "Roofing": "Construction",
  "Electrician": "Construction",
  "Landscaping": "Construction",
  "CPA": "Accounting",
  "Bookkeeping": "Accounting",
  "Attorney": "Legal",
  "Law Firm": "Legal",
  "Trucking": "Transportation",
  "Moving": "Transportation",
  "Retail Store": "Retail",
  "Boutique": "Retail",
  "Hotel": "Hospitality",
  "Motel": "Hospitality",
  "Resort": "Hospitality",
  "Cleaning": "Cleaning Services",
  "Janitorial": "Cleaning Services",
  "Maid Service": "Cleaning Services",
  "Tutor": "Education",
  "Academy": "Education",
  "School": "Education",
};

// ─── Resolution Types ─────────────────────────────────────────────────────────

export type VerticalResolutionReasonCode =
  | "merchant_manual_override"
  | "contact_manual_override"
  | "highest_authority_source"
  | "subvertical_parent_resolved"
  | "subvertical_parent_unknown"
  | "fallback_only"
  | "no_candidates";

export interface VerticalResolutionInput {
  merchantVertical?: string | null;
  merchantSubvertical?: string | null;
  merchantVerticalSource?: string | null;
  merchantVerticalConfidence?: number | null;
  merchantSubverticalSource?: string | null;
  merchantSubverticalConfidence?: number | null;
  merchantManualOverride?: boolean | null;
  contactVertical?: string | null;
  contactVerticalSource?: string | null;
  contactVerticalConfidence?: number | null;
  contactManualOverride?: boolean | null;
}

export interface VerticalResolutionResult {
  vertical: string | null;
  subvertical: string | null;
  source: VerticalSource | "unknown";
  confidence: number | null;
  reasonCode: VerticalResolutionReasonCode;
  algorithmVersion: string;
  needsReview: boolean;
}

interface VerticalCandidate {
  vertical: string | null;
  subvertical: string | null;
  source: string;
  authority: number;
  confidence: number | null;
  origin: "merchant" | "contact";
}

// ─── Confidence Qualification ─────────────────────────────────────────────────

/**
 * Minimum confidence score required for discovery_enrichment to maintain its
 * authority tier in ranking. Below this threshold the candidate is ranked as
 * legacy_unknown (authority 0) — it can still win if ALL candidates are below
 * threshold, but it cannot outrank a known-source classification at normal authority.
 *
 * This satisfies the task's validation requirement:
 *   "Low-confidence enrichment (confidence=20) does NOT win over a valid known
 *    contact classification (source=import_classification)."
 */
export const ENRICHMENT_MIN_CONFIDENCE = 30;

/**
 * Return the effective ranking authority for a candidate, accounting for the
 * minimum-confidence requirement on discovery_enrichment.
 */
function qualifyAuthority(
  source: VerticalSource,
  baseAuthority: number,
  confidence: number | null,
): number {
  if (
    source === "discovery_enrichment" &&
    (confidence === null || confidence < ENRICHMENT_MIN_CONFIDENCE)
  ) {
    return VERTICAL_SOURCE_AUTHORITY.legacy_unknown; // 0 — fallback-only
  }
  return baseAuthority;
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Normalize an arbitrary source string to a canonical VerticalSource key.
 * Any string not in VERTICAL_SOURCE_AUTHORITY collapses to "legacy_unknown".
 */
function normalizeSource(raw: string | null | undefined): VerticalSource {
  if (raw && Object.prototype.hasOwnProperty.call(VERTICAL_SOURCE_AUTHORITY, raw)) {
    return raw as VerticalSource;
  }
  return "legacy_unknown";
}

/**
 * Apply the canonical-coarse-vertical invariant to a raw (vertical, subvertical) pair.
 * Guarantees: returned `vertical` is always in CANONICAL_COARSE_VERTICALS or null.
 * Returned `subvertical` preserves the fine-grained value when one is resolved.
 */
function canonicalizeCoarseVertical(
  rawVertical: string | null | undefined,
  rawSubvertical: string | null | undefined,
): { vertical: string | null; subvertical: string | null; needsReview: boolean } {
  const sub = rawSubvertical?.trim() || null;
  const vert = rawVertical?.trim() || null;

  // If subvertical is present and already canonical, both are done.
  if (sub) {
    if (vert && CANONICAL_COARSE_VERTICALS.has(vert)) {
      return { vertical: vert, subvertical: sub, needsReview: false };
    }
    // Try to derive coarse parent from subvertical.
    const coarse = SUBVERTICAL_TO_COARSE_VERTICAL[sub];
    if (coarse) {
      return { vertical: coarse, subvertical: sub, needsReview: false };
    }
    // Sub is unknown; coarse vertical from vert if canonical, otherwise null.
    const fallbackCoarse = (vert && CANONICAL_COARSE_VERTICALS.has(vert)) ? vert : null;
    return { vertical: fallbackCoarse, subvertical: sub, needsReview: true };
  }

  // No subvertical. Check if vert is already a canonical coarse value.
  if (vert && CANONICAL_COARSE_VERTICALS.has(vert)) {
    return { vertical: vert, subvertical: null, needsReview: false };
  }

  // vert may be a fine-grained subvertical masquerading as the coarse field.
  if (vert) {
    const coarse = SUBVERTICAL_TO_COARSE_VERTICAL[vert];
    if (coarse) {
      return { vertical: coarse, subvertical: vert, needsReview: false };
    }
    // Unknown — cannot produce a canonical coarse value.
    return { vertical: null, subvertical: vert, needsReview: true };
  }

  return { vertical: null, subvertical: null, needsReview: false };
}

// ─── Resolution Algorithm ────────────────────────────────────────────────────

export function resolveCanonicalVertical(
  input: VerticalResolutionInput,
): VerticalResolutionResult {
  const ALGORITHM_VERSION = "v1";

  // (B) Merchant manual override always wins unconditionally.
  // Canonicalize before returning so result.vertical is always a coarse canonical value or null.
  if (input.merchantManualOverride === true) {
    const normalized = canonicalizeCoarseVertical(input.merchantVertical, input.merchantSubvertical);
    // Manual overrides always surface as "operator_override" source — unconditionally.
    // This ensures getResolutionStrength() can reliably detect override authority from the
    // returned source string, independent of whatever was stored in verticalSource metadata.
    return {
      vertical: normalized.vertical,
      subvertical: normalized.subvertical,
      source: "operator_override" as VerticalSource,
      confidence: input.merchantVerticalConfidence ?? null,
      reasonCode: "merchant_manual_override",
      algorithmVersion: ALGORITHM_VERSION,
      needsReview: normalized.needsReview,
    };
  }

  // (C) Contact manual override wins if no merchant override.
  // Contacts do not carry a subvertical field; canonicalize the coarse vertical only.
  if (input.contactManualOverride === true) {
    const normalized = canonicalizeCoarseVertical(input.contactVertical, null);
    // Same rule: always return "operator_override" so strength comparisons are reliable.
    return {
      vertical: normalized.vertical,
      subvertical: normalized.subvertical,
      source: "operator_override" as VerticalSource,
      confidence: input.contactVerticalConfidence ?? null,
      reasonCode: "contact_manual_override",
      algorithmVersion: ALGORITHM_VERSION,
      needsReview: normalized.needsReview,
    };
  }

  // (A) Build candidate list from non-null inputs.
  // Normalize source keys: unrecognized strings collapse to "legacy_unknown" (authority 0).
  // Apply qualifyAuthority() so low-confidence discovery_enrichment cannot outrank
  // known-source classifications (validates task requirement #3).
  const candidates: VerticalCandidate[] = [];

  if (input.merchantVertical || input.merchantSubvertical) {
    // Use the stronger of coarse-vertical provenance vs. subvertical provenance for ranking.
    // The schema separates them; when a merchant was enriched with a stronger source on the
    // subvertical than on the coarse vertical, we must honour that for bridge decisions.
    const coarseSourceKey = normalizeSource(input.merchantVerticalSource);
    const coarseConf = input.merchantVerticalConfidence ?? null;
    const coarseAuth = qualifyAuthority(coarseSourceKey, VERTICAL_SOURCE_AUTHORITY[coarseSourceKey], coarseConf);

    let sourceKey = coarseSourceKey;
    let confidence = coarseConf;
    let authority = coarseAuth;

    if (input.merchantSubvertical && input.merchantSubverticalSource) {
      const subSourceKey = normalizeSource(input.merchantSubverticalSource);
      const subConf = input.merchantSubverticalConfidence ?? null;
      const subAuth = qualifyAuthority(subSourceKey, VERTICAL_SOURCE_AUTHORITY[subSourceKey], subConf);
      if (
        subAuth > authority ||
        (subAuth === authority && (subConf ?? 0) > (confidence ?? 0))
      ) {
        sourceKey = subSourceKey;
        confidence = subConf;
        authority = subAuth;
      }
    }

    candidates.push({
      vertical: input.merchantVertical ?? null,
      subvertical: input.merchantSubvertical ?? null,
      source: sourceKey,
      authority,
      confidence,
      origin: "merchant",
    });
  }

  if (input.contactVertical) {
    const sourceKey = normalizeSource(input.contactVerticalSource);
    const confidence = input.contactVerticalConfidence ?? null;
    const authority = qualifyAuthority(sourceKey, VERTICAL_SOURCE_AUTHORITY[sourceKey], confidence);
    candidates.push({
      vertical: input.contactVertical,
      subvertical: null,
      source: sourceKey,
      authority,
      confidence,
      origin: "contact",
    });
  }

  if (candidates.length === 0) {
    return {
      vertical: null,
      subvertical: null,
      source: "legacy_unknown",
      confidence: null,
      reasonCode: "no_candidates",
      algorithmVersion: ALGORITHM_VERSION,
      needsReview: true,
    };
  }

  // (D) Rank: known-source candidates always outrank unknown-source candidates.
  // Within the same source tier, rank by authority desc, then confidence desc.
  const knownCandidates = candidates.filter(c => c.authority > 0);
  const unknownCandidates = candidates.filter(c => c.authority === 0);

  const rankList = knownCandidates.length > 0 ? knownCandidates : unknownCandidates;
  rankList.sort((a, b) => {
    if (b.authority !== a.authority) return b.authority - a.authority;
    return (b.confidence ?? 0) - (a.confidence ?? 0);
  });

  const winner = rankList[0];
  const isFallbackOnly = knownCandidates.length === 0;

  // (E) Resolve coarse vs fine vertical via the canonical normalizer.
  // This applies the invariant: result.vertical is always a canonical coarse value or null.
  const canon = canonicalizeCoarseVertical(winner.vertical, winner.subvertical);

  // Preserve the base reasonCode; subvertical-parent outcomes override it.
  let reasonCode: VerticalResolutionReasonCode = isFallbackOnly
    ? "fallback_only"
    : "highest_authority_source";

  const hasSub = !!(winner.subvertical?.trim());
  if (hasSub) {
    const knownParent = winner.subvertical && SUBVERTICAL_TO_COARSE_VERTICAL[winner.subvertical];
    if (knownParent) {
      reasonCode = "subvertical_parent_resolved";
    } else {
      reasonCode = "subvertical_parent_unknown";
      // Winner's subvertical is unmapped; its coarse vertical may also be non-canonical.
      // When canonicalizeCoarseVertical could not produce a coarse value, look at the
      // remaining rank-list candidates for the next-best canonical coarse vertical.
      if (!canon.vertical) {
        const altCoarse = rankList.find(
          c => c !== winner && c.vertical && CANONICAL_COARSE_VERTICALS.has(c.vertical),
        );
        // Provenance must be internally consistent: the coarse vertical comes from
        // altCoarse's lineage, so source/confidence must also come from altCoarse.
        // The winner's subvertical cannot be retained — it belongs to a different
        // data lineage from the coarse vertical we are returning, which would corrupt
        // subvertical provenance writes in the bridge. Clear it so every field in
        // the result points to the same origin.
        return {
          vertical: altCoarse?.vertical ?? null,
          subvertical: null,
          source: (altCoarse?.source ?? "legacy_unknown") as VerticalSource,
          confidence: altCoarse?.confidence ?? null,
          reasonCode,
          algorithmVersion: ALGORITHM_VERSION,
          needsReview: true,
        };
      }
    }
  } else if (winner.vertical && !CANONICAL_COARSE_VERTICALS.has(winner.vertical)) {
    const knownParent = SUBVERTICAL_TO_COARSE_VERTICAL[winner.vertical];
    if (knownParent) {
      reasonCode = "subvertical_parent_resolved";
    } else {
      // Winner's coarse field was not canonical and couldn't be remapped.
      // Try to find an alternate canonical coarse candidate from the rank list.
      if (!canon.vertical) {
        reasonCode = "subvertical_parent_unknown";
        const altCoarse = rankList.find(
          c => c !== winner && c.vertical && CANONICAL_COARSE_VERTICALS.has(c.vertical)
        );
        // Same lineage-consistency rule: coarse and subvertical must share one origin.
        // Clear subvertical so provenance is always internally consistent.
        return {
          vertical: altCoarse?.vertical ?? null,
          subvertical: null,
          source: (altCoarse?.source ?? "legacy_unknown") as VerticalSource,
          confidence: altCoarse?.confidence ?? null,
          reasonCode,
          algorithmVersion: ALGORITHM_VERSION,
          needsReview: true,
        };
      }
      reasonCode = "subvertical_parent_unknown";
    }
  }

  return {
    vertical: canon.vertical,
    subvertical: canon.subvertical,
    source: winner.source as VerticalSource,
    confidence: winner.confidence,
    reasonCode,
    algorithmVersion: ALGORITHM_VERSION,
    needsReview: canon.needsReview,
  };
}

// ─── Strength Helper ──────────────────────────────────────────────────────────

/**
 * Returns a numeric strength score used by the bridge to compare existing
 * vs. incoming resolution strength before deciding whether to overwrite.
 * Formula: authority * 1000 + confidence, with a special sentinel for manual overrides.
 */
export function getResolutionStrength(
  source: string | null | undefined,
  confidence: number | null | undefined,
  manualOverride?: boolean | null,
): number {
  if (manualOverride === true) return 999999;
  const authority = VERTICAL_SOURCE_AUTHORITY[source ?? "legacy_unknown"] ?? 0;
  return authority * 1000 + (confidence ?? 0);
}
