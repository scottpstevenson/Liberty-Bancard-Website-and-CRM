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
 * This module is intentionally NOT wired into any cron/worker/route. It is a
 * bounded, manually-invoked function pending the post-publish activation
 * decision (see task #1956's activation runbook requirement, Step 10). Do
 * not call this from queue-manager.ts or any scheduled tick.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import type { SunbizEntity } from "@shared/schema";
import {
  resolveOrganization,
  peekOrganizationResolution,
} from "./organization-resolver";

const DEFAULT_BATCH_LIMIT = 25;

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
 * already has a claim row (regardless of that claim's outcome) — this is
 * what makes repeated calls over the same corpus safe to resume.
 */
export async function selectSunbizBootstrapCandidates(
  limit = DEFAULT_BATCH_LIMIT,
  opts: { filingNumberLike?: string } = {},
): Promise<SunbizBootstrapCandidate[]> {
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
      AND NOT EXISTS (
        SELECT 1 FROM sunbiz_bootstrap_claims c WHERE c.filing_number = se.filing_number
      )
    ORDER BY se.id ASC
    LIMIT ${limit}
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

export interface SunbizBootstrapRunOutcome {
  filingNumber: string;
  entityName: string;
  outcome: "created" | "matched_existing" | "deferred_collision" | "already_claimed" | "failed";
  businessId?: number;
  error?: string;
}

/**
 * Executes a bounded batch. For each candidate:
 *   1. Attempt to durably claim the filing_number via
 *      INSERT ... ON CONFLICT (filing_number) DO NOTHING. If no row is
 *      returned, another run already claimed this entity — skip.
 *   2. Only once claimed, call resolveOrganization() (transactional,
 *      advisory-locked) to either match an existing business or create one.
 *   3. Update the claim row with the outcome and, on creation, insert the
 *      canonical_source_links lineage row.
 *
 * Never call this against the full ~250K hot/warm corpus in one invocation —
 * `limit` bounds the batch. Not wired to any scheduler; caller-invoked only.
 */
export async function runSunbizBootstrapBatch(limit = DEFAULT_BATCH_LIMIT, opts: { filingNumberLike?: string } = {}): Promise<SunbizBootstrapRunOutcome[]> {
  const candidates = await selectSunbizBootstrapCandidates(limit, opts);
  const outcomes: SunbizBootstrapRunOutcome[] = [];

  for (const candidate of candidates) {
    const claimRows = (await db.execute(sql`
      INSERT INTO sunbiz_bootstrap_claims (filing_number, sunbiz_entity_id, status)
      VALUES (${candidate.filingNumber}, ${candidate.id}, 'claimed')
      ON CONFLICT (filing_number) DO NOTHING
      RETURNING id
    `)).rows as any[];

    if (claimRows.length === 0) {
      outcomes.push({ filingNumber: candidate.filingNumber, entityName: candidate.entityName, outcome: "already_claimed" });
      continue;
    }

    try {
      const resolution = await resolveOrganization(toResolverInput(candidate));

      if (resolution.kind === "created") {
        // registry_id has a FK to source_registry_adapters; Sunbiz has no
        // adapter row there (that table is for the county/DBPR license
        // registries), so it must stay NULL here rather than restating the
        // filing number into a column with a foreign-key contract it doesn't
        // satisfy.
        await db.execute(sql`
          INSERT INTO canonical_source_links (business_id, source_system, source_type, stable_key, registry_id)
          VALUES (${resolution.business.id}, 'sunbiz', 'sunbiz_entity', ${candidate.filingNumber}, NULL)
          ON CONFLICT (source_system, source_type, stable_key) DO NOTHING
        `);
        await db.execute(sql`
          UPDATE sunbiz_bootstrap_claims
          SET status = 'created', business_id = ${resolution.business.id}, completed_at = now()
          WHERE filing_number = ${candidate.filingNumber}
        `);
        outcomes.push({ filingNumber: candidate.filingNumber, entityName: candidate.entityName, outcome: "created", businessId: resolution.business.id });
      } else if (resolution.kind === "matched") {
        await db.execute(sql`
          UPDATE sunbiz_bootstrap_claims
          SET status = 'matched_existing', business_id = ${resolution.business.id}, completed_at = now()
          WHERE filing_number = ${candidate.filingNumber}
        `);
        outcomes.push({ filingNumber: candidate.filingNumber, entityName: candidate.entityName, outcome: "matched_existing", businessId: resolution.business.id });
      } else {
        await db.execute(sql`
          UPDATE sunbiz_bootstrap_claims
          SET status = 'deferred_collision', deferred_reason_code = ${resolution.reasonCode}, completed_at = now()
          WHERE filing_number = ${candidate.filingNumber}
        `);
        outcomes.push({ filingNumber: candidate.filingNumber, entityName: candidate.entityName, outcome: "deferred_collision" });
      }
    } catch (err: any) {
      await db.execute(sql`
        UPDATE sunbiz_bootstrap_claims
        SET status = 'failed', deferred_reason_code = ${String(err?.message ?? err).slice(0, 250)}, completed_at = now()
        WHERE filing_number = ${candidate.filingNumber}
      `);
      outcomes.push({ filingNumber: candidate.filingNumber, entityName: candidate.entityName, outcome: "failed", error: String(err?.message ?? err) });
    }
  }

  return outcomes;
}
