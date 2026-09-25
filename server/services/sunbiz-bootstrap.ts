/**
 * Sunbiz → canonical-business bootstrap (Task #1956, Step 2).
 *
 * Materializes real `businesses` rows from hot/warm Sunbiz entities through a
 * bounded, previewable batch. Idempotency rests on a durable claim keyed by
 * the Sunbiz entity's stable source identity (filing_number), enforced by a
 * DB unique index (sunbiz_bootstrap_claims_filing_number_unique) — NOT on
 * advisory locks, business-name matching, or generated business IDs alone.
 *
 * Every materialized business gets a canonical_source_links row
 * (source_system='sunbiz', source_type='sunbiz_entity', stable_key=filing
 * number) preserving lineage back to the originating Sunbiz entity.
 *
 * This module is intentionally wired only to the governed admin route. It is
 * not wired to any cron/worker or scheduled tick; every invocation is bounded
 * and requires the route's typed confirmation gate.
 */
import { sql } from "drizzle-orm";
import crypto from "node:crypto";
import { db } from "../db";
import type { SunbizEntity } from "@shared/schema";
import {
  resolveOrganization,
  peekOrganizationResolution,
} from "./organization-resolver";

function rows<T = any>(result: unknown): T[] {
  return (result as { rows?: T[] })?.rows ?? [];
}

const DEFAULT_BATCH_LIMIT = 25;
const MAX_BATCH_LIMIT = 25;

// A claim that has sat in 'claimed' status longer than this is treated as
// abandoned (the process that took it crashed or was killed mid-resolution)
// and becomes eligible for reclaim by a later run, same as a 'failed' claim.
const STALE_CLAIM_MINUTES = 15;

// A filing that has failed resolution this many times is moved to the
// terminal 'dead_letter' claim status instead of being retried forever by
// the full-backfill worker (see runSunbizBackfillMicrobatch below).
export const SUNBIZ_BACKFILL_MAX_RETRIES = 5;

export interface SunbizBootstrapCandidate {
  id: number;
  filingNumber: string;
  entityName: string;
  website: string | null;
  phone: string | null;
  principalCity: string | null;
  principalState: string | null;
}

/**
 * Selects unclaimed hot/warm Sunbiz entities with enough identity signal to
 * attempt organization resolution. Excludes any entity whose filing_number
 * already has a non-failed claim row. Failed claims remain selectable so an
 * explicit rerun can recover them; successful claims remain permanently
 * idempotently excluded.
 */
export async function selectSunbizBootstrapCandidates(
  limit = DEFAULT_BATCH_LIMIT,
  opts: { filingNumberLike?: string; afterId?: number } = {},
): Promise<SunbizBootstrapCandidate[]> {
  const boundedLimit = Math.min(MAX_BATCH_LIMIT, Math.max(1, Math.floor(limit)));

  // filingNumberLike is test-only (never passed by the production routes).
  // When it IS set, the query must not rely on the id-ordered hot/warm partial
  // index scan below: fixture rows always land at the newest (highest) ids,
  // so a `LIKE` filter that matches nothing else in the ~1.9M-row table forces
  // Postgres to walk the entire hot/warm index before concluding there's no
  // LIMIT match. Route it through idx_sunbiz_filing_number (a plain btree on
  // filing_number) instead, using a sargable range bound derived from the
  // literal prefix so the planner can seek directly to the matching rows
  // rather than scanning by id.
  let filingNumberRangeClause = sql`TRUE`;
  if (opts.filingNumberLike) {
    const prefix = opts.filingNumberLike.replace(/%+$/, "");
    if (prefix) {
      // Exclusive upper bound: prefix with its last char's code point + 1,
      // e.g. "abc" -> "abd", which bounds every string starting with "abc".
      const upperBound = prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1);
      filingNumberRangeClause = sql`se.filing_number >= ${prefix} AND se.filing_number < ${upperBound}`;
    }
  }

  const rows = (await db.execute(sql`
    SELECT se.id, se.filing_number, se.entity_name, se.website, se.phone,
           se.principal_city, se.principal_state
    FROM sunbiz_entities se
    WHERE se.filing_number IS NOT NULL
      AND se.entity_name IS NOT NULL
      AND se.score IN ('hot', 'warm')
      AND (se.website IS NOT NULL OR se.phone IS NOT NULL
           OR (se.principal_city IS NOT NULL AND se.principal_state IS NOT NULL))
      AND (${opts.filingNumberLike ?? null}::text IS NULL OR se.filing_number LIKE ${opts.filingNumberLike ?? null}::text)
      AND (${filingNumberRangeClause})
      AND (${opts.afterId ?? null}::int IS NULL OR se.id > ${opts.afterId ?? null}::int)
      AND NOT EXISTS (
        SELECT 1 FROM sunbiz_bootstrap_claims c
        WHERE c.filing_number = se.filing_number
          AND NOT (
            (c.status = 'failed' AND c.retry_count < ${SUNBIZ_BACKFILL_MAX_RETRIES})
            OR (c.status = 'claimed' AND c.claimed_at < now() - (${STALE_CLAIM_MINUTES} || ' minutes')::interval)
          )
      )
    ORDER BY se.id ASC
    LIMIT ${boundedLimit}
  `)).rows as any[];

  return rows.map((r) => ({
    id: Number(r.id),
    filingNumber: String(r.filing_number),
    entityName: String(r.entity_name),
    website: r.website ?? null,
    phone: r.phone ?? null,
    principalCity: r.principal_city ?? null,
    principalState: r.principal_state ?? null,
  }));
}

function domainFromWebsite(website: string | null): string | null {
  if (!website) return null;
  try {
    const withScheme = website.startsWith("http") ? website : `https://${website}`;
    return new URL(withScheme).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

function toResolverInput(candidate: SunbizBootstrapCandidate) {
  return {
    canonicalName: candidate.entityName,
    websiteDomain: domainFromWebsite(candidate.website),
    mainPhone: candidate.phone,
    city: candidate.principalCity,
    state: candidate.principalState,
  };
}

function normalizedIdentityName(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

// Generic legal-form/entity-type tokens carry zero corroborating identity
// signal — "llc", "inc", "corp" etc. appear on huge numbers of unrelated
// Sunbiz filings. Without stripping these, two entirely unrelated
// "... LLC" businesses that happen to share a domain or phone (shared
// registered agent, franchise hub) could pass token-overlap matching on the
// "llc" token alone. Every identity-name comparison in this module must
// strip these before comparing tokens.
const GENERIC_LEGAL_FORM_TOKENS = new Set([
  "llc", "inc", "incorporated", "corp", "corporation", "co", "company",
  "ltd", "limited", "llp", "lllp", "lp", "pa", "pc", "pllc", "plc",
  "group", "holdings", "enterprises", "services", "solutions", "the",
]);

function meaningfulTokens(normalized: string): Set<string> {
  return new Set(
    normalized
      .split(" ")
      .filter((token) => token.length > 2 && !GENERIC_LEGAL_FORM_TOKENS.has(token)),
  );
}

function compatibleIdentityName(a: string, b: string): boolean {
  const left = normalizedIdentityName(a);
  const right = normalizedIdentityName(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const leftTokens = meaningfulTokens(left);
  const rightTokens = meaningfulTokens(right);
  if (!leftTokens.size || !rightTokens.size) return false;
  // A pure substring match ("joes pizza" within "joes pizza llc") is only
  // trusted once legal-form/stopword tokens are stripped from both sides —
  // otherwise "llc" alone would satisfy this branch for two unrelated "...
  // LLC" businesses.
  const leftCore = [...leftTokens].sort().join(" ");
  const rightCore = [...rightTokens].sort().join(" ");
  if (leftCore === rightCore) return true;
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return overlap / Math.max(leftTokens.size, rightTokens.size) >= 0.6;
}

function compatibleCityState(candidate: SunbizBootstrapCandidate, business: any): boolean {
  return !!candidate.principalCity && !!candidate.principalState &&
    candidate.principalCity.trim().toLowerCase() === String(business.city ?? "").trim().toLowerCase() &&
    candidate.principalState.trim().toLowerCase() === String(business.state ?? "").trim().toLowerCase();
}

/**
 * True only when both names are present and share literally no meaningful
 * token overlap (e.g. "Joe's Pizza LLC" vs "City Nail Salon Inc") — a
 * stronger signal than "not compatible", used to stop a same-city/state
 * coincidence from overriding an outright unrelated business name. A
 * same-city match on two genuinely unrelated businesses (shared registered
 * agent address, franchise hub, etc.) must not auto-link just because the
 * city/state happens to match.
 */
function namesClearlyConflict(a: string, b: string): boolean {
  const left = normalizedIdentityName(a);
  const right = normalizedIdentityName(b);
  if (!left || !right) return false;
  const leftTokens = meaningfulTokens(left);
  const rightTokens = meaningfulTokens(right);
  if (!leftTokens.size || !rightTokens.size) return false;
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return overlap === 0;
}

async function wasPromotedByLegacySunbiz(filingNumber: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT 1
    FROM sunbiz_entities se
    LEFT JOIN prospects p ON p.id = se.prospect_id
    WHERE se.filing_number = ${filingNumber}
      AND (
        p.id IS NOT NULL
        OR EXISTS (
          SELECT 1 FROM canonical_source_links csl
          WHERE csl.stable_key = ${filingNumber}
            AND NOT (csl.source_system = 'sunbiz' AND csl.source_type = 'sunbiz_entity')
            AND NOT (csl.source_system = 'sunbiz_entities' AND csl.source_type = 'sunbiz_filing')
        )
      )
    LIMIT 1
  `);
  return rows(result).length > 0;
}

async function findCRO03BCrosswalkBusiness(filingNumber: string): Promise<number | null> {
  const result = await db.execute(sql`
    SELECT business_id
    FROM canonical_source_links
    WHERE source_system = 'sunbiz_entities'
      AND source_type = 'sunbiz_filing'
      AND stable_key = ${filingNumber}
    LIMIT 1
  `);
  const found = rows(result)[0] as { business_id: number } | undefined;
  return found ? Number(found.business_id) : null;
}

/**
 * Single source of truth for the typed-confirmation phrase, derived from the
 * actual candidate count (never the requested limit). Both the preview route
 * (what it advertises to the caller) and the run route (what it requires)
 * MUST call this same function so they can never drift apart on an
 * UNCHANGED corpus. See sunbizBootstrapPreviewTokens below for how the two
 * routes stay consistent even when the corpus/claims change between the two
 * calls.
 */
export function sunbizBootstrapConfirmationPhrase(candidateCount: number): string {
  return `RUN SUNBIZ BOOTSTRAP ${candidateCount}`;
}

interface SunbizBootstrapPreviewTokenRecord {
  confirmationPhrase: string;
  limit: number;
  filingNumberLike?: string;
  expiresAt: number;
  /**
   * The exact, ordered set of filing_numbers previewSunbizBootstrap()
   * selected when this token was minted. /run must select candidates again
   * (claims are live, so a stale in-memory list can't be executed directly)
   * but MUST verify the fresh selection is identical to this snapshot before
   * doing any claim/write work — otherwise a claim landing between preview
   * and run (another admin's batch, or this module's own stale-claim
   * recovery reordering the queue) can execute a materially different set of
   * entities than the admin reviewed and typed a count-derived confirmation
   * phrase for. See runSunbizBootstrapBatch's `expectedFilingNumbers` param
   * and SunbizBootstrapSnapshotDriftError.
   */
  candidateFilingNumbers: string[];
}

const PREVIEW_TOKEN_TTL_MS = 5 * 60 * 1000;

// In-memory, single-process, single-use preview tokens binding a specific
// preview response to the exact confirmation phrase it displayed. GET preview
// and POST run independently recomputing candidateCount left a real gap: an
// intervening claim (another admin's run, or this module's own stale-claim
// recovery) can change candidateCount between the two calls, silently
// rejecting exactly the phrase the UI just showed the caller. Binding run's
// validation to the token preview minted — not to a freshly recomputed count
// — closes that gap. Tokens are single-use and short-lived; if the corpus
// materially changed since the token was minted, the caller must re-preview
// rather than trust a stale count.
const sunbizBootstrapPreviewTokens = new Map<string, SunbizBootstrapPreviewTokenRecord>();

function pruneExpiredPreviewTokens(): void {
  const now = Date.now();
  for (const [token, record] of sunbizBootstrapPreviewTokens) {
    if (record.expiresAt <= now) sunbizBootstrapPreviewTokens.delete(token);
  }
}

export function issueSunbizBootstrapPreviewToken(
  confirmationPhrase: string,
  limit: number,
  candidateFilingNumbers: string[],
  filingNumberLike?: string,
): string {
  pruneExpiredPreviewTokens();
  const token = crypto.randomUUID();
  sunbizBootstrapPreviewTokens.set(token, {
    confirmationPhrase,
    limit,
    filingNumberLike,
    candidateFilingNumbers: [...candidateFilingNumbers].sort(),
    expiresAt: Date.now() + PREVIEW_TOKEN_TTL_MS,
  });
  return token;
}

/**
 * Thrown by runSunbizBootstrapBatch() when the candidate set it selects at
 * execution time does not exactly match the snapshot a preview token was
 * minted against. Thrown BEFORE any claim/write happens — the batch never
 * touches the DB with a mismatched set.
 */
export class SunbizBootstrapSnapshotDriftError extends Error {
  code = "candidate_snapshot_drifted" as const;
  constructor(public readonly expected: string[], public readonly actual: string[]) {
    super(
      `Candidate set changed since preview (expected ${expected.length} entities, found ${actual.length}); re-preview before running.`,
    );
  }
}

/**
 * Read-only lookup: does NOT delete the token. Use this to validate a
 * request (limit match, confirmation phrase match) before deciding whether
 * to consume it — a typo'd confirmation should not burn the token, or the
 * caller is forced to re-preview (and risk a changed candidateCount) just to
 * fix a typo.
 */
export function peekSunbizBootstrapPreviewToken(token: string): SunbizBootstrapPreviewTokenRecord | null {
  pruneExpiredPreviewTokens();
  return sunbizBootstrapPreviewTokens.get(token) ?? null;
}

/** Single-use: consuming a valid token deletes it immediately. Call this only once validation (limit + confirmation) has already passed. */
export function consumeSunbizBootstrapPreviewToken(token: string): SunbizBootstrapPreviewTokenRecord | null {
  pruneExpiredPreviewTokens();
  const record = sunbizBootstrapPreviewTokens.get(token);
  if (!record) return null;
  sunbizBootstrapPreviewTokens.delete(token);
  return record;
}

export interface SunbizBootstrapPreview {
  candidateCount: number;
  wouldCreate: number;
  wouldMatchExisting: number;
  wouldDefer: number;
  candidates: Array<{ filingNumber: string; entityName: string; outcome: "would_create" | "matched" | "deferred" }>;
}

/**
 * Dry run: reports exactly what runSunbizBootstrapBatch() would do, without
 * claiming anything or writing to businesses/canonical_source_links. Uses
 * peekOrganizationResolution() (no lock, no write) so the preview count is a
 * true prediction of the actual insert count on an unchanged fixture/corpus.
 */
export async function previewSunbizBootstrap(limit = DEFAULT_BATCH_LIMIT, opts: { filingNumberLike?: string } = {}): Promise<SunbizBootstrapPreview> {
  const candidates = await selectSunbizBootstrapCandidates(limit, opts);
  const result: SunbizBootstrapPreview = {
    candidateCount: candidates.length,
    wouldCreate: 0,
    wouldMatchExisting: 0,
    wouldDefer: 0,
    candidates: [],
  };

  for (const candidate of candidates) {
    const peek = await peekOrganizationResolution(toResolverInput(candidate));
    if (peek.kind === "would_create") {
      result.wouldCreate++;
      result.candidates.push({ filingNumber: candidate.filingNumber, entityName: candidate.entityName, outcome: "would_create" });
    } else if (peek.kind === "matched" &&
        !compatibleIdentityName(candidate.entityName, peek.business.canonicalName) &&
        (!compatibleCityState(candidate, peek.business) ||
          namesClearlyConflict(candidate.entityName, peek.business.canonicalName))) {
      result.wouldDefer++;
      result.candidates.push({ filingNumber: candidate.filingNumber, entityName: candidate.entityName, outcome: "deferred" });
    } else if (peek.kind === "matched") {
      result.wouldMatchExisting++;
      result.candidates.push({ filingNumber: candidate.filingNumber, entityName: candidate.entityName, outcome: "matched" });
    } else {
      result.wouldDefer++;
      result.candidates.push({ filingNumber: candidate.filingNumber, entityName: candidate.entityName, outcome: "deferred" });
    }
  }

  return result;
}

// ── Record-class repair (one-time production correction) ──────────────────
//
// Before this correction, resolveOrganization() was called without
// create.recordClass, so newly created businesses fell through to the
// businesses.record_class database default of 'unknown' — invisible to
// /api/lead-ops/businesses, the free-enrichment cohort, and MI-09
// eligibility, all of which require record_class='canonical'.
//
// This repair is scoped as narrowly as possible: only businesses that are
// PROVEN to be a Sunbiz-bootstrap "created" outcome (not "matched_existing",
// which must never have its record_class touched) and that still carry the
// pre-fix 'unknown' default, and for which the expected canonical Sunbiz
// source lineage row genuinely exists (proving the claim's finalize step
// actually completed for this exact business/filing pair, not a partial or
// unrelated row). It never widens to "any unknown business" — other
// ingestion paths intentionally rely on fail-closed 'unknown' classification
// for businesses that have NOT been proven canonical, and this repair must
// not silently reclassify those.
const RECORD_CLASS_REPAIR_COHORT_SQL = sql`
  SELECT b.id, b.canonical_name AS canonical_name, c.filing_number AS filing_number
  FROM sunbiz_bootstrap_claims c
  JOIN businesses b ON b.id = c.business_id
  JOIN canonical_source_links csl
    ON csl.business_id = b.id
   AND csl.source_system = 'sunbiz'
   AND csl.source_type = 'sunbiz_entity'
   AND csl.stable_key = c.filing_number
  WHERE c.status = 'created'
    AND b.record_class = 'unknown'
  ORDER BY b.id
`;

export interface SunbizRecordClassRepairRow {
  id: number;
  canonicalName: string;
  filingNumber: string;
}

export interface SunbizRecordClassRepairPreview {
  cohortCount: number;
  rows: SunbizRecordClassRepairRow[];
}

/** Read-only: derives the exact repair cohort from the database. Never writes. */
export async function previewSunbizRecordClassRepair(): Promise<SunbizRecordClassRepairPreview> {
  const result = rows(await db.execute(RECORD_CLASS_REPAIR_COHORT_SQL)) as Array<{
    id: number;
    canonical_name: string;
    filing_number: string;
  }>;
  return {
    cohortCount: result.length,
    rows: result.map((r) => ({ id: r.id, canonicalName: r.canonical_name, filingNumber: r.filing_number })),
  };
}

export function sunbizRecordClassRepairConfirmationPhrase(cohortCount: number): string {
  return `REPAIR SUNBIZ RECORD CLASS ${cohortCount}`;
}

interface SunbizRecordClassRepairTokenRecord {
  confirmationPhrase: string;
  businessIds: number[];
  expiresAt: number;
}

const sunbizRecordClassRepairTokens = new Map<string, SunbizRecordClassRepairTokenRecord>();

function pruneExpiredRepairTokens(): void {
  const now = Date.now();
  for (const [token, record] of sunbizRecordClassRepairTokens) {
    if (record.expiresAt <= now) sunbizRecordClassRepairTokens.delete(token);
  }
}

export function issueSunbizRecordClassRepairToken(confirmationPhrase: string, businessIds: number[]): string {
  pruneExpiredRepairTokens();
  const token = crypto.randomUUID();
  sunbizRecordClassRepairTokens.set(token, {
    confirmationPhrase,
    businessIds: [...businessIds].sort((a, b) => a - b),
    expiresAt: Date.now() + PREVIEW_TOKEN_TTL_MS,
  });
  return token;
}

export function peekSunbizRecordClassRepairToken(token: string): SunbizRecordClassRepairTokenRecord | null {
  pruneExpiredRepairTokens();
  return sunbizRecordClassRepairTokens.get(token) ?? null;
}

export function consumeSunbizRecordClassRepairToken(token: string): SunbizRecordClassRepairTokenRecord | null {
  pruneExpiredRepairTokens();
  const record = sunbizRecordClassRepairTokens.get(token);
  if (!record) return null;
  sunbizRecordClassRepairTokens.delete(token);
  return record;
}

export interface SunbizRecordClassRepairResult {
  attemptedCount: number;
  repairedCount: number;
  repairedIds: number[];
}

/**
 * Executes the repair. Idempotent by construction: it re-derives the SAME
 * proven cohort live (not trusting the token's snapshot to still be
 * 'unknown') and updates only rows that are STILL 'unknown' at execution
 * time, scoped to the exact business IDs the token captured. Re-running this
 * after a successful repair (or after nothing qualifies any more) always
 * updates zero rows rather than erroring or reclassifying anything new.
 */
export async function runSunbizRecordClassRepair(expectedBusinessIds: number[]): Promise<SunbizRecordClassRepairResult> {
  if (expectedBusinessIds.length === 0) {
    return { attemptedCount: 0, repairedCount: 0, repairedIds: [] };
  }
  const idList = sql.join(expectedBusinessIds.map((id) => sql`${id}::int`), sql`, `);
  const updated = rows(await db.execute(sql`
    UPDATE businesses
    SET record_class = 'canonical'
    WHERE id IN (${idList})
      AND record_class = 'unknown'
      AND id IN (SELECT id FROM (${RECORD_CLASS_REPAIR_COHORT_SQL}) AS proven_cohort)
    RETURNING id
  `)) as Array<{ id: number }>;
  return {
    attemptedCount: expectedBusinessIds.length,
    repairedCount: updated.length,
    repairedIds: updated.map((r) => r.id),
  };
}

export interface SunbizBootstrapRunOutcome {
  filingNumber: string;
  entityName: string;
  outcome: "created" | "matched_existing" | "deferred_collision" | "identity_review" | "already_claimed" | "failed" | "dead_letter" | "lost_lease";
  businessId?: number;
  error?: string;
}

/**
 * Executes a bounded batch. For each candidate:
 *   1. Attempt to durably claim the filing_number via
 *      INSERT ... ON CONFLICT (filing_number) DO NOTHING (or reclaim a failed
 *      or stale-abandoned claim). If no row is returned, another run already
 *      holds a live claim on this entity. The claim row's own `claimed_at`
 *      (returned by the claiming statement) becomes this executor's lease
 *      fencing token for every subsequent write.
 *   2. Only once claimed, call resolveOrganization() (transactional,
 *      advisory-locked) to either match an existing business or create one.
 *   3. Finalize inside a transaction that FIRST re-locks the claim row with
 *      `WHERE claimed_at = <lease token>` — i.e. a compare-and-swap on the
 *      lease, not just a plain filing_number match. If a second executor
 *      reclaimed this filing (because this executor stalled past
 *      STALE_CLAIM_MINUTES) and already finalized it, the fenced re-lock
 *      finds zero rows (claimed_at no longer matches), so this executor's
 *      resume cannot overwrite the winner's terminal status/business
 *      association — it reports "lost_lease" and writes nothing. This is a
 *      fencing-token pattern, not a plain filing_number keyed update: every
 *      finalize path (success, deferred, failure) uses it.
 *
 * Never call this against the full ~250K hot/warm corpus in one invocation —
 * `limit` bounds the batch. Not wired to any scheduler; caller-invoked only.
 *
 * Known residual limitation: resolveOrganization() itself runs OUTSIDE this
 * fencing transaction (it has its own transactional/advisory-lock semantics
 * that this module does not control). If this executor loses its lease
 * during the resolveOrganization() call, a business row it creates can be
 * left orphaned (no lineage, no claim association) rather than silently
 * duplicated or corrupting the winner's state — the fencing check still
 * prevents the previously-reported bug (a stale executor overwriting a
 * live winner's terminal status). Losing a lease requires stalling past
 * STALE_CLAIM_MINUTES mid-batch, which is rare in practice for a
 * caller-invoked, small (<=25) bounded batch.
 */
export async function runSunbizBootstrapBatch(
  limit = DEFAULT_BATCH_LIMIT,
  opts: { filingNumberLike?: string; afterId?: number } = {},
  expectedFilingNumbers?: string[],
): Promise<SunbizBootstrapRunOutcome[]> {
  let candidates: SunbizBootstrapCandidate[];
  // Pre-established leases from the atomic snapshot-acquisition path below,
  // keyed by filing_number, so the per-candidate loop can skip re-claiming
  // entities it already atomically holds.
  const preAcquiredLeases = new Map<string, unknown>();

  if (expectedFilingNumbers) {
    // Snapshot-binding: when a caller passes the filing_number set a preview
    // token was minted against, this batch may ONLY execute exactly that
    // set. A prior version of this check re-selected candidates fresh and
    // compared the resulting list to `expectedFilingNumbers`, then claimed
    // each one individually in a separate statement — but that left a
    // TOCTOU race: two concurrent confirmed runs could both pass the
    // comparison before either claimed anything, then split the claims
    // between them, each executing a partial subset the admin never
    // reviewed as such.
    //
    // Instead, acquire a claim on EVERY expected filing_number atomically,
    // inside one transaction, re-verifying live eligibility (the same
    // predicate selectSunbizBootstrapCandidates uses) as part of the same
    // INSERT. If any single acquisition fails — raced by a concurrent run,
    // or the entity is no longer eligible since preview — the whole
    // transaction throws and Postgres rolls back every claim this batch
    // took, so a drifted run performs zero durable writes. Only once ALL
    // expected filings are held does this function proceed to resolve/
    // finalize them (reusing the leases already acquired here).
    const expected = [...expectedFilingNumbers].sort();
    const acquired: Array<{ filingNumber: string; entityId: number; claimedAt: unknown }> = [];
    {
      await db.transaction(async (tx) => {
        for (const filingNumber of expected) {
          const rows = (await tx.execute(sql`
            INSERT INTO sunbiz_bootstrap_claims (filing_number, sunbiz_entity_id, status)
            SELECT se.filing_number, se.id, 'claimed'
            FROM sunbiz_entities se
            WHERE se.filing_number = ${filingNumber}
              AND se.filing_number IS NOT NULL
              AND se.entity_name IS NOT NULL
              AND se.score IN ('hot', 'warm')
              AND (se.website IS NOT NULL OR se.phone IS NOT NULL
                   OR (se.principal_city IS NOT NULL AND se.principal_state IS NOT NULL))
            ON CONFLICT (filing_number) DO UPDATE
              SET status = 'claimed', claimed_at = now(), completed_at = NULL, deferred_reason_code = NULL
              WHERE sunbiz_bootstrap_claims.status = 'failed'
                 OR (sunbiz_bootstrap_claims.status = 'claimed'
                     AND sunbiz_bootstrap_claims.claimed_at < now() - (${STALE_CLAIM_MINUTES} || ' minutes')::interval)
            RETURNING sunbiz_entity_id, claimed_at
          `)).rows as any[];

          if (rows.length === 0) {
            // Either the entity is no longer eligible (disqualified, or
            // missing since preview) or another executor already holds a
            // live claim on it. Throwing here rolls back every claim this
            // transaction already took above, so the batch ends with zero
            // durable writes, not a partial subset.
            throw new SunbizBootstrapSnapshotDriftError(expected, acquired.map((a) => a.filingNumber));
          }
          acquired.push({ filingNumber, entityId: Number(rows[0].sunbiz_entity_id), claimedAt: rows[0].claimed_at });
        }
      });
    }

    for (const a of acquired) preAcquiredLeases.set(a.filingNumber, a.claimedAt);

    const entityIds = acquired.map((a) => a.entityId);
    const detailRows = (await db.execute(sql`
      SELECT id, filing_number, entity_name, website, phone, principal_city, principal_state
      FROM sunbiz_entities
      WHERE id = ANY(${sql.raw(`ARRAY[${entityIds.join(",")}]::int[]`)})
    `)).rows as any[];
    const byFilingNumber = new Map(
      detailRows.map((r) => [
        String(r.filing_number),
        {
          id: Number(r.id),
          filingNumber: String(r.filing_number),
          entityName: String(r.entity_name),
          website: r.website ?? null,
          phone: r.phone ?? null,
          principalCity: r.principal_city ?? null,
          principalState: r.principal_state ?? null,
        } as SunbizBootstrapCandidate,
      ]),
    );
    // Preserve the expected (sorted) order; every filing is guaranteed
    // present since acquisition above throws on any miss.
    candidates = expected.map((fn) => byFilingNumber.get(fn)!);
  } else {
    candidates = await selectSunbizBootstrapCandidates(limit, opts);
  }

  const outcomes: SunbizBootstrapRunOutcome[] = [];
  const runId = crypto.randomUUID();
  const recordOutcome = async (outcome: SunbizBootstrapRunOutcome) => {
    outcomes.push(outcome);
    try {
      const attempt = rows(await db.execute(sql`
        SELECT COALESCE(MAX(attempt_number), 0)::int + 1 AS attempt_number
        FROM sunbiz_bootstrap_ledger_events
        WHERE filing_number = ${outcome.filingNumber}
      `))[0] as { attempt_number: number } | undefined;
      const reasonCode = outcome.outcome === "identity_review"
        ? "identity_review_required"
        : outcome.outcome === "deferred_collision"
          ? "deferred_collision"
          : outcome.outcome === "failed"
            ? "processing_failed"
            : null;
      await db.execute(sql`
        INSERT INTO sunbiz_bootstrap_ledger_events
          (filing_number, run_id, attempt_number, outcome, deferred_reason_code, business_id, actor)
        VALUES (
          ${outcome.filingNumber}, ${runId}, ${Number(attempt?.attempt_number ?? 1)},
          ${outcome.outcome}, ${reasonCode}, ${outcome.businessId ?? null}, 'system'
        )
      `);
    } catch {
      // Ledger is observational only; its failure must never affect business
      // or source-link writes.
      console.warn(`[Sunbiz Bootstrap] Ledger insert failed for filing ${outcome.filingNumber}; outcome=${outcome.outcome}`);
    }
  };

  for (const candidate of candidates) {
    let myLeaseToken: unknown;
    if (preAcquiredLeases.has(candidate.filingNumber)) {
      // Already atomically claimed above as part of the all-or-none
      // snapshot acquisition; no separate claim statement needed here.
      myLeaseToken = preAcquiredLeases.get(candidate.filingNumber);
    } else {
      const claimRows = (await db.execute(sql`
        INSERT INTO sunbiz_bootstrap_claims (filing_number, sunbiz_entity_id, status)
        VALUES (${candidate.filingNumber}, ${candidate.id}, 'claimed')
        ON CONFLICT (filing_number) DO UPDATE
          SET status = 'claimed', claimed_at = now(), completed_at = NULL, deferred_reason_code = NULL
          WHERE sunbiz_bootstrap_claims.status = 'failed'
             OR (sunbiz_bootstrap_claims.status = 'claimed'
                 AND sunbiz_bootstrap_claims.claimed_at < now() - (${STALE_CLAIM_MINUTES} || ' minutes')::interval)
        RETURNING id, claimed_at
      `)).rows as any[];

      if (claimRows.length === 0) {
        await recordOutcome({ filingNumber: candidate.filingNumber, entityName: candidate.entityName, outcome: "already_claimed" });
        continue;
      }

      // Lease fencing token: the EXACT claimed_at value this executor was
      // just granted. Every later write to this claim row must be
      // conditioned on claimed_at still equalling this value — if another
      // executor reclaimed the row (which always bumps claimed_at), that
      // write becomes a no-op instead of an overwrite.
      myLeaseToken = claimRows[0].claimed_at;
    }

    if (await wasPromotedByLegacySunbiz(candidate.filingNumber)) {
      const won = await db.transaction(async (tx) => {
        const locked = rows(await tx.execute(sql`
          SELECT id FROM sunbiz_bootstrap_claims
          WHERE filing_number = ${candidate.filingNumber} AND claimed_at = ${myLeaseToken}
          FOR UPDATE
        `));
        if (!locked.length) return false;
        await tx.execute(sql`
          UPDATE sunbiz_bootstrap_claims
          SET status = 'deferred_collision', deferred_reason_code = 'legacy_sunbiz_promotion_exists', completed_at = now()
          WHERE filing_number = ${candidate.filingNumber} AND claimed_at = ${myLeaseToken}
        `);
        return true;
      });
      await recordOutcome({
        filingNumber: candidate.filingNumber,
        entityName: candidate.entityName,
        outcome: won ? "deferred_collision" : "lost_lease",
      });
      continue;
    }

    const crosswalkBusinessId = await findCRO03BCrosswalkBusiness(candidate.filingNumber);
    if (crosswalkBusinessId != null) {
      const won = await db.transaction(async (tx) => {
        const locked = rows(await tx.execute(sql`
          SELECT id FROM sunbiz_bootstrap_claims
          WHERE filing_number = ${candidate.filingNumber} AND claimed_at = ${myLeaseToken}
          FOR UPDATE
        `));
        if (!locked.length) return false;
        await tx.execute(sql`
          INSERT INTO canonical_source_links (business_id, source_system, source_type, stable_key, registry_id)
          VALUES (${crosswalkBusinessId}, 'sunbiz', 'sunbiz_entity', ${candidate.filingNumber}, NULL)
          ON CONFLICT (source_system, source_type, stable_key) DO NOTHING
        `);
        await tx.execute(sql`
          UPDATE sunbiz_bootstrap_claims
          SET status = 'matched_existing', business_id = ${crosswalkBusinessId}, completed_at = now()
          WHERE filing_number = ${candidate.filingNumber} AND claimed_at = ${myLeaseToken}
        `);
        return true;
      });
      await recordOutcome({
        filingNumber: candidate.filingNumber,
        entityName: candidate.entityName,
        outcome: won ? "matched_existing" : "lost_lease",
        ...(won ? { businessId: crosswalkBusinessId } : {}),
      });
      continue;
    }

    let identityReview = false;
    const priorClaimBusinessRows = rows(await db.execute(sql`
      SELECT business_id FROM sunbiz_bootstrap_claims
      WHERE filing_number = ${candidate.filingNumber} AND claimed_at = ${myLeaseToken}
    `)) as Array<{ business_id: number | null }>;
    const previouslyAssociatedBusinessId = priorClaimBusinessRows[0]?.business_id == null
      ? null
      : Number(priorClaimBusinessRows[0].business_id);
    let resolution: Awaited<ReturnType<typeof resolveOrganization>> | {
      kind: "deferred";
      reasonCode: "IDENTITY_REVIEW_REQUIRED";
      candidateIds: number[];
    };
    try {
      // Explicitly classify newly created businesses as 'canonical'. Without
      // this, resolveOrganization()'s insert falls through to the
      // businesses.record_class database default of 'unknown' — which is
      // invisible to /api/lead-ops/businesses, the free-enrichment cohort,
      // and MI-09 eligibility, all of which require record_class='canonical'.
      // This only affects the newly INSERTed row for this candidate; a
      // "matched" resolution reuses an existing business row untouched, so
      // an already-existing business's record_class is never altered here.
      resolution = await resolveOrganization({
        ...toResolverInput(candidate),
        create: { recordClass: "canonical" },
      });
      if (resolution.kind === "matched" &&
          resolution.business.id !== previouslyAssociatedBusinessId &&
          !compatibleIdentityName(candidate.entityName, resolution.business.canonicalName) &&
          (!compatibleCityState(candidate, resolution.business) ||
            namesClearlyConflict(candidate.entityName, resolution.business.canonicalName))) {
        identityReview = true;
        resolution = {
          kind: "deferred",
          reasonCode: "IDENTITY_REVIEW_REQUIRED",
          candidateIds: [resolution.business.id],
        };
      }
    } catch (err: any) {
      // Retry/dead-letter: bump retry_count; once it reaches the threshold
      // this filing becomes permanently terminal (dead_letter) so it stops
      // being re-selected by both the bounded admin route and the full
      // backfill worker, instead of retrying the same failure forever.
      const fenced = (await db.execute(sql`
        UPDATE sunbiz_bootstrap_claims
        SET status = CASE WHEN retry_count + 1 >= ${SUNBIZ_BACKFILL_MAX_RETRIES} THEN 'dead_letter' ELSE 'failed' END,
            retry_count = retry_count + 1,
            deferred_reason_code = ${String(err?.message ?? err).slice(0, 250)},
            completed_at = now()
        WHERE filing_number = ${candidate.filingNumber} AND claimed_at = ${myLeaseToken}
        RETURNING id, status
      `)).rows as any[];
      await recordOutcome(
        fenced.length === 0
          ? { filingNumber: candidate.filingNumber, entityName: candidate.entityName, outcome: "lost_lease" }
          : {
              filingNumber: candidate.filingNumber,
              entityName: candidate.entityName,
              outcome: fenced[0].status === "dead_letter" ? "dead_letter" : "failed",
              error: String(err?.message ?? err),
            },
      );
      continue;
    }

    const finalStatus =
      resolution.kind === "created" ? "created" : resolution.kind === "matched" ? "matched_existing" : "deferred_collision";
    const businessId = resolution.kind === "created" || resolution.kind === "matched" ? resolution.business.id : undefined;

    // Finalize (lineage insert + claim status) atomically, gated by a
    // fenced re-lock of the claim row so a stale executor resuming after a
    // reclaim can never overwrite the current holder's result.
    const won = await db.transaction(async (tx) => {
      const locked = (await tx.execute(sql`
        SELECT id FROM sunbiz_bootstrap_claims
        WHERE filing_number = ${candidate.filingNumber} AND claimed_at = ${myLeaseToken}
        FOR UPDATE
      `)).rows as any[];
      if (locked.length === 0) return false;

      if (resolution.kind === "created" || resolution.kind === "matched") {
        // Lineage is upserted for BOTH outcomes, not just "created". This is
        // deliberate: a crash/failure between business creation and lineage
        // insertion on a prior attempt leaves the business row in place but
        // the claim marked 'failed'; the retry then resolves as "matched"
        // against the already-created business, and must still repair the
        // missing canonical_source_links row before finalizing the claim.
        // ON CONFLICT DO NOTHING makes this idempotent whether or not the
        // lineage row already exists.
        //
        // registry_id has a FK to source_registry_adapters; Sunbiz has no
        // adapter row there (that table is for the county/DBPR license
        // registries), so it must stay NULL here rather than restating the
        // filing number into a column with a foreign-key contract it doesn't
        // satisfy.
        await tx.execute(sql`
          INSERT INTO canonical_source_links (business_id, source_system, source_type, stable_key, registry_id)
          VALUES (${resolution.business.id}, 'sunbiz', 'sunbiz_entity', ${candidate.filingNumber}, NULL)
          ON CONFLICT (source_system, source_type, stable_key) DO NOTHING
        `);
        await tx.execute(sql`
          UPDATE sunbiz_bootstrap_claims
          SET status = ${finalStatus}, business_id = ${resolution.business.id}, completed_at = now()
          WHERE filing_number = ${candidate.filingNumber} AND claimed_at = ${myLeaseToken}
        `);
      } else {
        await tx.execute(sql`
          UPDATE sunbiz_bootstrap_claims
          SET status = 'deferred_collision',
              deferred_reason_code = ${identityReview ? "identity_review_required" : resolution.reasonCode},
              completed_at = now()
          WHERE filing_number = ${candidate.filingNumber} AND claimed_at = ${myLeaseToken}
        `);
      }
      return true;
    });

    if (!won) {
      await recordOutcome({ filingNumber: candidate.filingNumber, entityName: candidate.entityName, outcome: "lost_lease" });
      continue;
    }

    if (resolution.kind === "created" || resolution.kind === "matched") {
      await recordOutcome({
        filingNumber: candidate.filingNumber,
        entityName: candidate.entityName,
        outcome: resolution.kind === "created" ? "created" : "matched_existing",
        businessId,
      });
    } else {
      await recordOutcome({
        filingNumber: candidate.filingNumber,
        entityName: candidate.entityName,
        outcome: identityReview ? "identity_review" : "deferred_collision",
      });
    }
  }

  return outcomes;
}
