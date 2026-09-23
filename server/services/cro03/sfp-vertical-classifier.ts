/**
 * sfp-vertical-classifier.ts
 *
 * Deterministic, versioned, pure five-target vertical classifier for the
 * South Florida Prospecting program. Replaces the boolean
 * `verticalMatchesTargets()` helper that could only say yes/no with no
 * confidence, no audit trail, and no distinction between "definitely not a
 * target" and "we don't know how to classify this label yet".
 *
 * This module makes NO network, database, or provider calls (no OpenAI, no
 * Serper, no Outscraper). It is a pure function of its inputs so the same
 * (rawVertical, targetIds, version) triple always produces the same result —
 * required for reproducible cohort freezes and for the disposable
 * certification suite to assert determinism without any live infrastructure.
 *
 * Terminal outcomes:
 *   - resolved_high     — exact/alias match to exactly one target. High confidence.
 *   - resolved_medium    — curated strong-synonym match to exactly one target,
 *                          not a literal alias. Medium confidence.
 *   - review_required    — the label plausibly overlaps one or more targets
 *                          (and possibly non-target categories) but cannot be
 *                          safely auto-resolved. Needs human review before
 *                          admission or exclusion.
 *   - not_target         — the label matches a curated, unambiguous non-target
 *                          category. High confidence exclusion.
 *   - unresolved         — empty input, or a label absent from every table
 *                          above. Needs the taxonomy extended, not a guess.
 */

import { createHash } from "crypto";

/** Bump whenever the alias/synonym/non-target tables or the decision logic change. */
export const CLASSIFIER_VERSION = 1 as const;

export type ClassifierOutcome =
  | "resolved_high"
  | "resolved_medium"
  | "review_required"
  | "not_target"
  | "unresolved";

export interface ClassifierResult {
  version: typeof CLASSIFIER_VERSION;
  outcome: ClassifierOutcome;
  /** 0..1. Deterministic per outcome tier, not a probabilistic model score. */
  confidence: number;
  /** The canonical target ID this label resolves to, when applicable. */
  matchedTargetId: string | null;
  rawVertical: string | null;
  reasons: string[];
  /** sha256 over {version, targetIds, rawVertical, outcome, matchedTargetId, confidence, reasons} */
  evidenceHash: string;
}

// ── Exact/alias matches: same specific concept, only spelling/punctuation varies ──
// Only variants of the SAME concept live here. A match here is unambiguous.
const EXACT_ALIASES: Record<string, string[]> = {
  "Med Spa": ["med spa", "medspa", "medical spa", "med-spa"],
  "Dental": ["dental", "dentist", "dental office", "dentistry"],
  "Auto Repair": ["auto repair", "automotive repair", "auto repair shop", "car repair"],
  "Restaurant": ["restaurant", "restaurants"],
  "Retail": ["retail", "retail store"],
};

// ── Curated strong synonyms: a different phrase but still resolves to exactly
// one target without meaningful ambiguity. Medium confidence because these
// are broader labels than the literal target name, even though they don't
// overlap any other target or a non-target category in practice.
const STRONG_SYNONYMS: Record<string, string[]> = {
  "Med Spa": ["aesthetics clinic", "cosmetic med spa", "botox clinic"],
  "Dental": ["orthodontist", "dental clinic", "family dentistry"],
  "Auto Repair": ["auto mechanic", "auto service center", "transmission repair", "brake shop"],
  "Restaurant": ["diner", "eatery", "bistro", "pizzeria", "steakhouse"],
  "Retail": ["boutique", "retail shop", "clothing store", "gift shop"],
};

// ── Ambiguous broad labels: genuinely span a target and either another
// target or a non-target sub-category. Must go to human review rather than
// being silently admitted or silently rejected.
const AMBIGUOUS_LABELS: Record<string, string[]> = {
  "healthcare": ["Dental", "Med Spa"],
  "salon/spa": ["Med Spa"],
  "salon": ["Med Spa"],
  "spa": ["Med Spa"],
  "food/beverage": ["Restaurant"],
  "food & beverage": ["Restaurant"],
  "auto": ["Auto Repair"],
  "automotive": ["Auto Repair"],
  "shopping": ["Retail"],
  "store": ["Retail"],
  "wellness": ["Med Spa"],
  "clinic": ["Dental", "Med Spa"],
};

// ── Curated non-target categories: unambiguous exclusions. Adding a wrong
// entry here would silently drop legitimate candidates, so this list is
// deliberately narrow and only includes categories that never plausibly
// overlap any of the five targets.
const NOT_TARGET_LABELS = new Set([
  "legal services", "law firm", "attorney", "real estate", "real estate agency",
  "insurance agency", "insurance", "grocery store", "grocery", "liquor store",
  "gas station", "hotel", "motel", "bar", "nightclub", "bank", "credit union",
  "accounting firm", "cpa", "construction", "plumbing", "roofing", "landscaping",
  "hair salon", "barber shop", "gym", "fitness center", "daycare", "school",
  "church", "nonprofit", "government office", "pharmacy", "veterinary clinic",
]);

function normalize(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function findAliasTarget(normalizedLabel: string, targetIds: string[]): string | null {
  for (const targetId of targetIds) {
    if (normalize(targetId) === normalizedLabel) return targetId;
    const aliases = EXACT_ALIASES[targetId];
    if (aliases?.some((a) => a === normalizedLabel)) return targetId;
  }
  return null;
}

function findSynonymTarget(normalizedLabel: string, targetIds: string[]): string | null {
  for (const targetId of targetIds) {
    const synonyms = STRONG_SYNONYMS[targetId];
    if (synonyms?.some((s) => s === normalizedLabel)) return targetId;
  }
  return null;
}

function computeEvidenceHash(input: {
  version: number;
  targetIds: string[];
  rawVertical: string | null;
  outcome: ClassifierOutcome;
  matchedTargetId: string | null;
  confidence: number;
  reasons: string[];
}): string {
  const canonical = JSON.stringify({
    version: input.version,
    targetIds: [...input.targetIds].sort(),
    rawVertical: input.rawVertical,
    outcome: input.outcome,
    matchedTargetId: input.matchedTargetId,
    confidence: input.confidence,
    reasons: input.reasons,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function finish(
  rawVertical: string | null,
  targetIds: string[],
  outcome: ClassifierOutcome,
  confidence: number,
  matchedTargetId: string | null,
  reasons: string[],
): ClassifierResult {
  const evidenceHash = computeEvidenceHash({
    version: CLASSIFIER_VERSION, targetIds, rawVertical, outcome, matchedTargetId, confidence, reasons,
  });
  return { version: CLASSIFIER_VERSION, outcome, confidence, matchedTargetId, rawVertical, reasons, evidenceHash };
}

/**
 * Classify a business's raw vertical label against the program's configured
 * target vertical IDs. Pure function — same inputs always produce the same
 * output, including the evidence hash.
 */
export function classifyVertical(rawVertical: string | null | undefined, targetIds: string[]): ClassifierResult {
  const normalized = normalize(rawVertical);
  const raw = typeof rawVertical === "string" ? rawVertical : null;

  if (!normalized) {
    return finish(raw, targetIds, "unresolved", 0, null, ["EMPTY_VERTICAL_LABEL"]);
  }

  const aliasTarget = findAliasTarget(normalized, targetIds);
  if (aliasTarget) {
    return finish(raw, targetIds, "resolved_high", 0.95, aliasTarget, [`EXACT_ALIAS_MATCH:${aliasTarget}`]);
  }

  const synonymTarget = findSynonymTarget(normalized, targetIds);
  if (synonymTarget) {
    return finish(raw, targetIds, "resolved_medium", 0.75, synonymTarget, [`STRONG_SYNONYM_MATCH:${synonymTarget}`]);
  }

  const ambiguousMatches = AMBIGUOUS_LABELS[normalized];
  if (ambiguousMatches) {
    const relevantTargets = ambiguousMatches.filter((t) => targetIds.includes(t));
    if (relevantTargets.length > 0) {
      return finish(raw, targetIds, "review_required", 0.4, null, [
        `AMBIGUOUS_LABEL_OVERLAPS:${relevantTargets.join(",")}`,
      ]);
    }
    // Ambiguous label but none of its possible targets are in this program's
    // configured target set — treat as not_target for THIS program.
    return finish(raw, targetIds, "not_target", 0.6, null, ["AMBIGUOUS_LABEL_NO_CONFIGURED_TARGET_OVERLAP"]);
  }

  if (NOT_TARGET_LABELS.has(normalized)) {
    return finish(raw, targetIds, "not_target", 0.9, null, ["CURATED_NON_TARGET_CATEGORY"]);
  }

  return finish(raw, targetIds, "unresolved", 0, null, ["LABEL_NOT_IN_TAXONOMY"]);
}

/** Exported for the disposable certification suite and future taxonomy audits. */
export const _TAXONOMY_FOR_TEST = {
  EXACT_ALIASES,
  STRONG_SYNONYMS,
  AMBIGUOUS_LABELS,
  NOT_TARGET_LABELS,
};
