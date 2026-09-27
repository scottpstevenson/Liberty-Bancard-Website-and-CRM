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

/**
 * Bump whenever the alias/synonym/non-target tables or the decision logic
 * change. This is the RULESET version and is intentionally independent of
 * `taxonomyVersion` (which target-vertical group a program uses, e.g. the
 * legacy five-package taxonomy vs the South Florida v2 taxonomy). Bridge
 * code must store both separately — never conflate "which target list" with
 * "which classification rules" when writing evidence/cache columns.
 *
 * v2 (2026-09): inferVerticalNameSignal() replaces the single-longest-match
 * name inference with conflict detection, so a legal name containing both a
 * target-associated term and a non-target/other-target term can no longer
 * silently resolve to an authoritative outcome from name alone.
 */
export const CLASSIFIER_VERSION = 2 as const;

/**
 * SFP South Florida target-vertical taxonomy v2 (2026-09). Replaces the
 * original five-package taxonomy (Med Spa, Dental, Auto Repair, Restaurant,
 * Retail) for the South Florida program only -- the v1 tables above are left
 * untouched so any other program still configured with the old five-package
 * target list keeps its existing behavior byte-for-byte. Restaurants, food
 * trucks, and DBPR-licensed categories are explicitly excluded here; DBPR
 * lineage is also independently enforced upstream in the cohort selector.
 */
export const TAXONOMY_VERSION_V2 = 2 as const;

export const SFP_TARGET_VERTICALS_V2 = [
  "Automotive",
  "Healthcare",
  "Beauty/Spa",
  "Construction/Trades/Home Services",
  "Fitness/Recreation",
] as const;
export type SfpTargetVerticalV2 = typeof SFP_TARGET_VERTICALS_V2[number];

export type ClassifierOutcome =
  | "resolved_high"
  | "resolved_medium"
  | "review_required"
  | "not_target"
  | "unresolved";

export interface ClassifierResult {
  version: typeof CLASSIFIER_VERSION;
  taxonomyVersion: 1 | 2;
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

// ── v2 taxonomy tables (South Florida program). Same structure/semantics as
// the v1 tables above, scoped to the five new broader groups. ──
const EXACT_ALIASES_V2: Record<string, string[]> = {
  "Automotive": [
    "auto repair", "automotive repair", "auto repair shop", "car repair",
    "automotive", "auto service", "auto body shop", "tire shop", "auto shop",
  ],
  "Healthcare": [
    "dental", "dentist", "dental office", "dentistry", "med spa", "medspa",
    "medical spa", "med-spa", "medical clinic", "doctor's office",
    "physician office", "urgent care", "chiropractor", "physical therapy",
  ],
  "Beauty/Spa": [
    "hair salon", "salon", "spa", "nail salon", "beauty salon", "barber shop",
    "barbershop", "day spa",
  ],
  "Construction/Trades/Home Services": [
    "construction", "general contractor", "plumbing", "plumber", "roofing",
    "electrician", "hvac", "landscaping", "home services", "handyman",
  ],
  "Fitness/Recreation": [
    "gym", "fitness center", "yoga studio", "crossfit", "martial arts",
    "personal training", "recreation center",
  ],
};

const STRONG_SYNONYMS_V2: Record<string, string[]> = {
  "Automotive": ["transmission repair", "brake shop", "auto mechanic", "auto service center", "car wash", "detailing shop"],
  "Healthcare": ["orthodontist", "dental clinic", "family dentistry", "aesthetics clinic", "cosmetic med spa", "botox clinic", "wellness clinic", "urgent care clinic"],
  "Beauty/Spa": ["nail bar", "blow dry bar", "waxing studio", "lash studio", "massage therapy"],
  "Construction/Trades/Home Services": ["home remodeling", "home improvement", "pest control", "cleaning service", "painting contractor"],
  "Fitness/Recreation": ["boxing gym", "pilates studio", "dance studio", "sports club"],
};

const AMBIGUOUS_LABELS_V2: Record<string, string[]> = {
  "wellness": ["Healthcare", "Beauty/Spa"],
  "clinic": ["Healthcare"],
  "salon/spa": ["Beauty/Spa"],
  "health": ["Healthcare"],
  "trades": ["Construction/Trades/Home Services"],
  "recreation": ["Fitness/Recreation"],
  "services": ["Construction/Trades/Home Services"],
};

// Explicitly excludes restaurants/food trucks/food service and DBPR-licensed
// categories (restaurant, hotel/motel, bar) per the South Florida program
// scope. DBPR lineage itself is enforced independently upstream.
const NOT_TARGET_LABELS_V2 = new Set([
  "restaurant", "restaurants", "diner", "eatery", "bistro", "pizzeria",
  "steakhouse", "food truck", "food trucks", "catering", "cafe", "coffee shop",
  "bar", "nightclub", "legal services", "law firm", "attorney", "real estate",
  "real estate agency", "insurance agency", "insurance", "grocery store",
  "grocery", "liquor store", "gas station", "hotel", "motel", "bank",
  "credit union", "accounting firm", "cpa", "daycare", "school", "church",
  "nonprofit", "government office", "pharmacy", "veterinary clinic", "retail",
  "retail store", "clothing store", "gift shop", "boutique", "shopping", "store",
  // Additional unambiguous exclusions found while auditing name-derived
  // evidence: these are specific financial/professional-services or
  // transportation categories that never plausibly overlap Automotive,
  // Healthcare, Beauty/Spa, Construction/Trades/Home Services, or
  // Fitness/Recreation, so a curated exact match here carries the same
  // 0.9-confidence "unambiguous exclusion" guarantee as the entries above.
  "realty", "mortgage", "title insurance", "title company", "trust company",
  "aircraft", "aviation", "attorneys", "attorneys at law", "law offices",
]);

function normalize(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Free, deterministic fallback evidence source for `rawVertical` when a
 * business's structured `vertical` column is empty (the normal case for the
 * vast majority of Sunbiz-sourced canonical businesses — filing data alone
 * doesn't populate it). Rather than send every such business straight to
 * paid OpenAI escalation with zero signal, scan its legal/canonical name for
 * a whole-word/phrase match against the SAME curated alias/synonym/non-target
 * tables `classifyVertical` already trusts, and return the matched phrase
 * verbatim so it flows through the identical exact-match path afterward.
 *
 * This is intentionally conservative: only a whole-word/phrase substring
 * match counts (word-boundary regex, not naive `.includes`), and the longest
 * matching phrase across all tables wins so a broader ambiguous label never
 * shadows a more specific curated one. It is a source-of-evidence
 * improvement only — it does not lower any confidence gate. A name-derived
 * "insurance agency" still resolves through `classifyVertical` exactly like
 * a real `vertical` column value of "insurance agency" would: not_target at
 * 0.9 confidence, same as any other curated non-target hit.
 */
export interface VerticalNameSignal {
  /** The single longest matched phrase, but ONLY when it is non-conflicting. Null when conflicting or no match. */
  rawVertical: string | null;
  /**
   * True when the legal name matched two or more phrases that resolve to
   * different classification buckets (e.g. one target-associated term and
   * one unrelated/non-target term, or two different targets). A conflicting
   * name is deliberately NOT collapsed to a single "best" phrase — doing so
   * previously let a name like "Coastal Healthcare Realty LLC" resolve
   * straight to a high-confidence outcome from whichever keyword happened to
   * be longest, even though the name itself is genuinely ambiguous.
   */
  conflicting: boolean;
  /** Every matched phrase (unique, longest first), kept for audit provenance regardless of conflict. */
  matchedPhrases: string[];
}

/** Returns which classification bucket a single curated phrase belongs to, or null if it has no bucket of its own (e.g. an ambiguous-label key, which is already safely routed to review by classifyVertical itself). */
function bucketForPhrase(
  phrase: string,
  aliases: Record<string, string[]>,
  synonyms: Record<string, string[]>,
  notTarget: Set<string>,
): string | null {
  if (notTarget.has(phrase)) return "NOT_TARGET";
  for (const [targetId, list] of Object.entries(aliases)) if (list.includes(phrase)) return targetId;
  for (const [targetId, list] of Object.entries(synonyms)) if (list.includes(phrase)) return targetId;
  return null;
}

/**
 * Free, deterministic fallback evidence source for `rawVertical` when a
 * business's structured `vertical` column is empty. Scans the canonical
 * name for whole-word/phrase matches against the same curated tables
 * `classifyVertical` trusts. Unlike a naive "longest match wins" approach,
 * this detects when multiple matched phrases disagree about which target
 * (or non-target) the name belongs to, and refuses to pick one over the
 * other in that case — conflicting names must fall through to website
 * evidence / OpenAI escalation / review, never a silently authoritative
 * resolved_high or terminal not_target from name text alone.
 */
export function inferVerticalNameSignal(
  canonicalName: string | null | undefined,
  taxonomyVersion: 1 | 2 = 1,
): VerticalNameSignal {
  const name = normalize(canonicalName);
  if (!name) return { rawVertical: null, conflicting: false, matchedPhrases: [] };
  const { aliases, synonyms, ambiguous, notTarget } = tablesFor(taxonomyVersion);
  const candidatePhrases = new Set<string>([
    ...Object.values(aliases).flat(),
    ...Object.values(synonyms).flat(),
    ...Object.keys(ambiguous),
    ...notTarget,
  ]);
  const matched: string[] = [];
  for (const phrase of candidatePhrases) {
    if (!phrase) continue;
    const pattern = new RegExp(`(?:^|[^a-z0-9])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z0-9])`);
    if (pattern.test(` ${name} `)) matched.push(phrase);
  }
  matched.sort((a, b) => b.length - a.length);
  if (matched.length === 0) return { rawVertical: null, conflicting: false, matchedPhrases: [] };

  const buckets = new Set(
    matched.map((p) => bucketForPhrase(p, aliases, synonyms, notTarget)).filter((b): b is string => b !== null),
  );
  const conflicting = buckets.size > 1;
  return { rawVertical: conflicting ? null : matched[0], conflicting, matchedPhrases: matched };
}

/** @deprecated Use inferVerticalNameSignal() so callers can distinguish a genuine match from a conflicting one instead of silently collapsing to the longest phrase. Kept only for any caller that has not been migrated. */
export function inferRawVerticalFromName(
  canonicalName: string | null | undefined,
  taxonomyVersion: 1 | 2 = 1,
): string | null {
  return inferVerticalNameSignal(canonicalName, taxonomyVersion).rawVertical;
}

function tablesFor(taxonomyVersion: 1 | 2) {
  return taxonomyVersion === 2
    ? { aliases: EXACT_ALIASES_V2, synonyms: STRONG_SYNONYMS_V2, ambiguous: AMBIGUOUS_LABELS_V2, notTarget: NOT_TARGET_LABELS_V2 }
    : { aliases: EXACT_ALIASES, synonyms: STRONG_SYNONYMS, ambiguous: AMBIGUOUS_LABELS, notTarget: NOT_TARGET_LABELS };
}

function findAliasTarget(normalizedLabel: string, targetIds: string[], aliases: Record<string, string[]>): string | null {
  for (const targetId of targetIds) {
    if (normalize(targetId) === normalizedLabel) return targetId;
    const targetAliases = aliases[targetId];
    if (targetAliases?.some((a) => a === normalizedLabel)) return targetId;
  }
  return null;
}

function findSynonymTarget(normalizedLabel: string, targetIds: string[], synonymTable: Record<string, string[]>): string | null {
  for (const targetId of targetIds) {
    const synonyms = synonymTable[targetId];
    if (synonyms?.some((s) => s === normalizedLabel)) return targetId;
  }
  return null;
}

function computeEvidenceHash(input: {
  version: number;
  taxonomyVersion: 1 | 2;
  targetIds: string[];
  rawVertical: string | null;
  outcome: ClassifierOutcome;
  matchedTargetId: string | null;
  confidence: number;
  reasons: string[];
}): string {
  const canonical = JSON.stringify({
    version: input.version,
    taxonomyVersion: input.taxonomyVersion,
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
  taxonomyVersion: 1 | 2,
  outcome: ClassifierOutcome,
  confidence: number,
  matchedTargetId: string | null,
  reasons: string[],
): ClassifierResult {
  const evidenceHash = computeEvidenceHash({
    version: CLASSIFIER_VERSION, taxonomyVersion, targetIds, rawVertical, outcome, matchedTargetId, confidence, reasons,
  });
  return { version: CLASSIFIER_VERSION, taxonomyVersion, outcome, confidence, matchedTargetId, rawVertical, reasons, evidenceHash };
}

/**
 * Classify a business's raw vertical label against the program's configured
 * target vertical IDs. Pure function — same inputs always produce the same
 * output, including the evidence hash.
 *
 * `taxonomyVersion` selects which alias/synonym/non-target tables to use:
 *   1 (default) — legacy five-package taxonomy (Med Spa, Dental, Auto Repair,
 *      Restaurant, Retail). Unchanged from before this taxonomy existed, so
 *      any caller that omits this argument keeps its exact prior behavior.
 *   2 — South Florida program's five-group taxonomy (Automotive, Healthcare,
 *      Beauty/Spa, Construction/Trades/Home Services, Fitness/Recreation).
 */
export function classifyVertical(
  rawVertical: string | null | undefined,
  targetIds: string[],
  taxonomyVersion: 1 | 2 = 1,
): ClassifierResult {
  const normalized = normalize(rawVertical);
  const raw = typeof rawVertical === "string" ? rawVertical : null;
  const { aliases, synonyms, ambiguous, notTarget } = tablesFor(taxonomyVersion);

  if (!normalized) {
    return finish(raw, targetIds, taxonomyVersion, "unresolved", 0, null, ["EMPTY_VERTICAL_LABEL"]);
  }

  const aliasTarget = findAliasTarget(normalized, targetIds, aliases);
  if (aliasTarget) {
    return finish(raw, targetIds, taxonomyVersion, "resolved_high", 0.95, aliasTarget, [`EXACT_ALIAS_MATCH:${aliasTarget}`]);
  }

  const synonymTarget = findSynonymTarget(normalized, targetIds, synonyms);
  if (synonymTarget) {
    return finish(raw, targetIds, taxonomyVersion, "resolved_medium", 0.75, synonymTarget, [`STRONG_SYNONYM_MATCH:${synonymTarget}`]);
  }

  const ambiguousMatches = ambiguous[normalized];
  if (ambiguousMatches) {
    const relevantTargets = ambiguousMatches.filter((t) => targetIds.includes(t));
    if (relevantTargets.length > 0) {
      return finish(raw, targetIds, taxonomyVersion, "review_required", 0.4, null, [
        `AMBIGUOUS_LABEL_OVERLAPS:${relevantTargets.join(",")}`,
      ]);
    }
    // Ambiguous label but none of its possible targets are in this program's
    // configured target set — treat as not_target for THIS program.
    return finish(raw, targetIds, taxonomyVersion, "not_target", 0.6, null, ["AMBIGUOUS_LABEL_NO_CONFIGURED_TARGET_OVERLAP"]);
  }

  if (notTarget.has(normalized)) {
    return finish(raw, targetIds, taxonomyVersion, "not_target", 0.9, null, ["CURATED_NON_TARGET_CATEGORY"]);
  }

  return finish(raw, targetIds, taxonomyVersion, "unresolved", 0, null, ["LABEL_NOT_IN_TAXONOMY"]);
}

/** Exported for the disposable certification suite and future taxonomy audits. */
export const _TAXONOMY_FOR_TEST = {
  EXACT_ALIASES,
  STRONG_SYNONYMS,
  AMBIGUOUS_LABELS,
  NOT_TARGET_LABELS,
  EXACT_ALIASES_V2,
  STRONG_SYNONYMS_V2,
  AMBIGUOUS_LABELS_V2,
  NOT_TARGET_LABELS_V2,
};
