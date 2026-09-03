import { db } from "../../db";
import { sdrMerchants, sdrLeadState, sdrLeadEvents } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { isSerperConfigured } from "../serper";
import { serperGateway, SerperGateway, type SerperGatewayResult } from "../serper-gateway";
import {
  lookupBusinessIdentity,
  type LookupOutcome,
} from "../serper-business-identity";

interface SerperEnrichmentResult {
  website?: string;
  phone?: string;
  email?: string;
  address?: string;
  rating?: number;
  reviewCount?: number;
  socialProfiles?: Record<string, string>;
}

// ── Outcome classification (#1599) ──────────────────────────────────────────
// Three classes drive the cooldown state machine on sdr_merchants:
//   no_result        → 200 OK with no usable match (progressive backoff)
//   matched          → useful result (resets attempts, partial-match cooldown)
//   provider_failure → disabled/circuit/auth/429/timeout/5xx/network (records
//                      outcome + reason code ONLY; never touches attempts or
//                      serper_next_eligible_at)
type SearchClassified =
  | { kind: "no_result" }
  | { kind: "matched"; result: SerperEnrichmentResult }
  | { kind: "provider_failure"; reasonCode: string };

function classifyFailureReason(r: SerperGatewayResult): string {
  if (r.blocked) return r.blockReason || "blocked";
  if (r.status === 401 || r.status === 403) return "auth_error";
  if (r.status === 429) return r.error === "quota_exhausted" ? "quota_exhausted" : "rate_limited";
  if (r.status && r.status >= 500) return "provider_5xx";
  if (r.status && r.status >= 400) return "validation_error";
  if (r.error === "timeout") return "timeout";
  if (r.error === "malformed_response_body") return "malformed_response";
  return "network_error";
}

/**
 * Reads the canonical Serper authority (serper_control via the gateway) and
 * reports whether outbound Serper I/O is currently permitted. Fail-closed.
 */
export async function serperAuthorityPermits(
  gateway: SerperGateway = serperGateway,
): Promise<{ permitted: boolean; reason?: string }> {
  if (!process.env.SERPER_API_KEY) return { permitted: false, reason: "no_api_key" };
  let control;
  try {
    control = await gateway.getControl();
  } catch {
    return { permitted: false, reason: "state_unreadable" };
  }
  if (!control) return { permitted: false, reason: "state_missing" };
  if (!control.enabled) return { permitted: false, reason: "disabled" };
  if (control.state === "open") return { permitted: false, reason: "circuit_open" };
  return { permitted: true };
}

/**
 * Calls the structured `lookupBusinessIdentity()` waterfall (Places-first,
 * with identity scoring and geographic corroboration) and maps its outcome to
 * the three-class SearchClassified type used by this module's cooldown machine.
 *
 * Kill lines enforced:
 *  - First result never accepted without identity + geography validation (done by lookupBusinessIdentity)
 *  - Email addresses never collected or returned from this path
 *  - provider_failure never combined with no_result/identity_rejected
 */
async function searchSerperForBusiness(
  businessName: string,
  city: string | null | undefined,
  state: string | null | undefined,
  gateway: SerperGateway,
  zip?: string | null,
  legalName?: string | null,
  officerSurname?: string | null,
): Promise<SearchClassified> {
  if (!isSerperConfigured()) return { kind: "provider_failure", reasonCode: "no_api_key" };

  let outcome: LookupOutcome;
  try {
    outcome = await lookupBusinessIdentity(
      {
        businessName,
        legalName: legalName ?? undefined,
        zip,
        city: city ?? undefined,
        state: state ?? undefined,
        officerSurname: officerSurname ?? undefined,
      },
      {
        caller: "server/services/sdr/serper-enrichment.ts",
        gateway: gateway as any,
      },
    );
  } catch (err) {
    console.error(`[SerperEnrichment] Error enriching ${businessName}:`, err);
    return { kind: "provider_failure", reasonCode: "network_error" };
  }

  // Map structured lookup outcome to the three-class cooldown machine
  if (outcome.kind === "blocked") {
    return { kind: "provider_failure", reasonCode: outcome.reason ?? "blocked" };
  }
  if (outcome.kind === "provider_failure") {
    return { kind: "provider_failure", reasonCode: outcome.reason ?? "provider_error" };
  }
  if (outcome.kind === "no_result" || outcome.kind === "identity_rejected" || outcome.kind === "ambiguous") {
    return { kind: "no_result" };
  }

  // accepted_match — extract fields from the accepted candidate
  const accepted = outcome.accepted!;
  const result: SerperEnrichmentResult = {};

  if (accepted.website) result.website = accepted.website;
  if (accepted.phone) result.phone = accepted.phone;
  if (accepted.address) result.address = accepted.address;
  if (accepted.rating != null) result.rating = accepted.rating;
  if (accepted.reviewCount != null) result.reviewCount = accepted.reviewCount;

  // A match with no extractable fields is still a no_result for enrichment purposes
  if (!result.website && !result.phone && !result.address) return { kind: "no_result" };

  return { kind: "matched", result };
}

// Email discovery via Serper snippets is PROHIBITED by the task kill lines.
// Email remains the responsibility of separately-authorized providers (ZeroBounce/Apollo).
// This stub is intentionally removed; the searchSerperForEmail call site below
// is disabled to enforce the kill line.
async function searchSerperForEmail(
  _businessName: string,
  _domain: string | null | undefined,
  _gateway: SerperGateway,
): Promise<string | null> {
  // Kill line: "Serper snippet email promoted or persisted" → always return null
  return null;
}

export interface EnrichmentStats {
  totalProcessed: number;
  websitesFound: number;
  phonesFound: number;
  emailsFound: number;
  errors: number;
  skippedGate: number;
}

type DbExecutor = Pick<typeof db, "execute" | "select" | "update" | "insert">;

// ── Cooldown outcome recording (#1599) ──────────────────────────────────────
// Raw SQL updates (not Drizzle .set()) per the silent-drop pitfall.

const NO_RESULT_BACKOFF_SQL = sql`
  CASE
    WHEN serper_no_result_attempts + 1 <= 1 THEN now() + interval '24 hours'
    WHEN serper_no_result_attempts + 1 = 2 THEN now() + interval '7 days'
    ELSE now() + interval '30 days'
  END`;

async function recordNoResult(merchantId: number, executor: DbExecutor): Promise<void> {
  await executor.execute(sql`
    UPDATE sdr_merchants SET
      serper_no_result_attempts = serper_no_result_attempts + 1,
      last_serper_checked_at = now(),
      serper_last_outcome = 'no_result',
      serper_last_reason_code = 'no_usable_match',
      serper_next_eligible_at = ${NO_RESULT_BACKOFF_SQL},
      updated_at = now()
    WHERE id = ${merchantId}`);
}

/** Partial-match cooldown: matched merchants with a still-missing target field
 *  wait 7 days before re-selection; complete merchants become ineligible via
 *  the missing-field predicate (next_eligible_at cleared). */
async function recordMatched(
  merchantId: number,
  stillMissingField: boolean,
  executor: DbExecutor,
): Promise<void> {
  await executor.execute(sql`
    UPDATE sdr_merchants SET
      serper_no_result_attempts = 0,
      last_serper_checked_at = now(),
      serper_last_outcome = 'matched',
      serper_last_reason_code = NULL,
      serper_next_eligible_at = ${stillMissingField ? sql`now() + interval '7 days'` : sql`NULL`},
      updated_at = now()
    WHERE id = ${merchantId}`);
}

/** Provider/control failures record outcome + reason code ONLY — they never
 *  touch serper_no_result_attempts, serper_next_eligible_at, or
 *  last_serper_checked_at (no real check happened). */
async function recordProviderFailure(
  merchantId: number,
  reasonCode: string,
  executor: DbExecutor,
): Promise<void> {
  await executor.execute(sql`
    UPDATE sdr_merchants SET
      serper_last_outcome = 'provider_failure',
      serper_last_reason_code = ${reasonCode},
      updated_at = now()
    WHERE id = ${merchantId}`);
}

export type EnrichOutcome = "matched" | "no_result" | "provider_failure" | "not_found";

export async function enrichMerchantWithSerper(
  merchantId: number,
  opts: { gateway?: SerperGateway; executor?: DbExecutor } = {},
): Promise<{
  enriched: boolean;
  fields: string[];
  outcome: EnrichOutcome;
  reasonCode?: string;
}> {
  const gateway = opts.gateway ?? serperGateway;
  const executor = opts.executor ?? db;

  if (!isSerperConfigured()) {
    return { enriched: false, fields: [], outcome: "provider_failure", reasonCode: "no_api_key" };
  }

  const [merchant] = await executor
    .select()
    .from(sdrMerchants)
    .where(eq(sdrMerchants.id, merchantId));

  if (!merchant) {
    return { enriched: false, fields: [], outcome: "not_found" };
  }

  // Authority gate rechecked immediately before Serper I/O.
  const gate = await serperAuthorityPermits(gateway);
  if (!gate.permitted) {
    await recordProviderFailure(merchantId, gate.reason || "blocked", executor);
    return { enriched: false, fields: [], outcome: "provider_failure", reasonCode: gate.reason };
  }

  const classified = await searchSerperForBusiness(
    merchant.businessName,
    merchant.city,
    merchant.state,
    gateway,
    merchant.zip ?? null,
    merchant.legalName ?? null,
    merchant.ownerLastName ?? null,
  );

  if (classified.kind === "provider_failure") {
    await recordProviderFailure(merchantId, classified.reasonCode, executor);
    return { enriched: false, fields: [], outcome: "provider_failure", reasonCode: classified.reasonCode };
  }

  if (classified.kind === "no_result") {
    await recordNoResult(merchantId, executor);
    return { enriched: false, fields: [], outcome: "no_result" };
  }

  const result = classified.result;
  const updates: Record<string, any> = {};
  const fieldsEnriched: string[] = [];

  if (result.website && !merchant.website) {
    updates.website = result.website;
    updates.domain = result.website;
    fieldsEnriched.push("website");
  }

  if (result.phone && !merchant.mainPhone) {
    updates.mainPhone = result.phone;
    fieldsEnriched.push("phone");
  }

  if (result.address && !merchant.address) {
    updates.address = result.address;
    fieldsEnriched.push("address");
  }

  // Email is intentionally NOT collected from Serper — it is the responsibility
  // of separately-authorized providers (ZeroBounce/Apollo). The stub permanently
  // returns null. This block is removed to prevent any future accidental email
  // writes, and to remove the dead network call.

  if (fieldsEnriched.length > 0) {
    updates.updatedAt = new Date();
    await executor.update(sdrMerchants).set(updates).where(eq(sdrMerchants.id, merchantId));

    const leadStates = await executor
      .select()
      .from(sdrLeadState)
      .where(eq(sdrLeadState.merchantId, merchantId));

    for (const ls of leadStates) {
      const leadUpdates: Record<string, any> = { updatedAt: new Date() };
      // Note: email is intentionally excluded — Serper does not collect it.
      if (updates.mainPhone && !ls.phone) leadUpdates.phone = updates.mainPhone;
      if (updates.website && !ls.website) leadUpdates.website = updates.website;
      if (Object.keys(leadUpdates).length > 1) {
        await executor.update(sdrLeadState).set(leadUpdates).where(eq(sdrLeadState.id, ls.id));
      }
    }

    await executor.insert(sdrLeadEvents).values({
      merchantId,
      eventType: "serper_enrichment",
      channel: "system",
      actorType: "system",
      payloadJson: { fieldsEnriched, source: "serper" },
      decisionReason: `Serper enrichment: found ${fieldsEnriched.join(", ")}`,
    });
  }

  // Determine post-update completeness for the partial-match cooldown.
  // Serper targets only: website, phone, address. Email is NOT a Serper target —
  // merchants with website+phone but no email must NOT be re-claimed on every
  // cycle just because email is missing. stillMissing only covers Serper targets.
  const website = updates.website ?? merchant.website;
  const mainPhone = updates.mainPhone ?? merchant.mainPhone;
  const stillMissing = !website || !mainPhone;

  await recordMatched(merchantId, stillMissing, executor);

  return { enriched: fieldsEnriched.length > 0, fields: fieldsEnriched, outcome: "matched" };
}

/**
 * Atomically claims eligible candidates inside the caller's transaction using
 * SELECT … FOR UPDATE SKIP LOCKED so concurrent workers never double-claim.
 * Eligibility (all applied in one statement):
 *   1. at least one SERPER-collectible field missing (website / main_phone)
 *      NOTE: main_email is intentionally excluded — Serper does not collect email.
 *            Including it would cause merchants with website+phone but no email to
 *            be reclaimed and charged credits on every cooldown cycle forever.
 *   2. do_not_contact_flag IS NOT TRUE
 *   3. serper_next_eligible_at IS NULL OR <= now()
 *   4. no active lease (row not locked by another worker — SKIP LOCKED)
 *   5. gateway authority permits (checked by the caller before selecting)
 */
export async function claimSerperCandidates(
  tx: DbExecutor,
  limit: number,
): Promise<Array<{ id: number }>> {
  const res = await tx.execute(sql`
    SELECT id FROM sdr_merchants
    WHERE (website IS NULL OR main_phone IS NULL)
      AND do_not_contact_flag IS NOT TRUE
      AND (serper_next_eligible_at IS NULL OR serper_next_eligible_at <= now())
    ORDER BY serper_next_eligible_at ASC NULLS FIRST, id ASC
    FOR UPDATE SKIP LOCKED
    LIMIT ${limit}`);
  return (res.rows as Array<{ id: number }>) ?? [];
}

export async function runSerperEnrichmentBatch(
  limit: number = 50,
  opts: { gateway?: SerperGateway } = {},
): Promise<EnrichmentStats> {
  const gateway = opts.gateway ?? serperGateway;
  const stats: EnrichmentStats = {
    totalProcessed: 0,
    websitesFound: 0,
    phonesFound: 0,
    emailsFound: 0,
    errors: 0,
    skippedGate: 0,
  };

  if (!isSerperConfigured()) return stats;

  // Eligibility condition 5: gateway authority must permit the operation.
  const gate = await serperAuthorityPermits(gateway);
  if (!gate.permitted) {
    console.log(`[SerperEnrichment] Batch skipped — authority gate blocks Serper I/O (${gate.reason})`);
    return stats;
  }

  await db.transaction(async (tx) => {
    const candidates = await claimSerperCandidates(tx as unknown as DbExecutor, limit);
    console.log(`[SerperEnrichment] Batch claimed ${candidates.length} merchants`);

    for (const candidate of candidates) {
      try {
        // Re-verify the authority gate immediately before each merchant's I/O.
        const perCallGate = await serperAuthorityPermits(gateway);
        if (!perCallGate.permitted) {
          stats.skippedGate++;
          continue;
        }

        const result = await enrichMerchantWithSerper(candidate.id, {
          gateway,
          executor: tx as unknown as DbExecutor,
        });
        stats.totalProcessed++;

        if (result.fields.includes("website")) stats.websitesFound++;
        if (result.fields.includes("phone")) stats.phonesFound++;
        if (result.fields.includes("email")) stats.emailsFound++;

        await new Promise((r) => setTimeout(r, 300));
      } catch (err) {
        stats.errors++;
        console.error(`[SerperEnrichment] Error enriching merchant ${candidate.id}:`, err);
      }
    }
  });

  console.log(
    `[SerperEnrichment] Batch complete: ${stats.totalProcessed} processed, ${stats.websitesFound} websites, ${stats.phonesFound} phones, ${stats.emailsFound} emails, ${stats.errors} errors, ${stats.skippedGate} gate-skipped`
  );

  return stats;
}

/**
 * Clears a merchant's Serper cooldown so it re-enters the next batch.
 * Refuses while the global Serper authority gate is disabled or open.
 * Used by the admin manual-requeue endpoint. Returns the refusal reason
 * instead of clearing when the gate blocks.
 */
export async function requeueSerperForMerchant(
  merchantId: number,
  opts: { gateway?: SerperGateway } = {},
): Promise<{ ok: boolean; reason?: string }> {
  const gateway = opts.gateway ?? serperGateway;
  const gate = await serperAuthorityPermits(gateway);
  if (!gate.permitted) return { ok: false, reason: gate.reason };

  const res = await db.execute(sql`
    UPDATE sdr_merchants SET
      serper_next_eligible_at = NULL,
      serper_no_result_attempts = 0,
      updated_at = now()
    WHERE id = ${merchantId}
    RETURNING id`);
  if (!res.rows || res.rows.length === 0) return { ok: false, reason: "merchant_not_found" };
  return { ok: true };
}

export async function getSerperEnrichmentMetrics(): Promise<{
  totalEnriched: number;
  last7Days: EnrichmentStats;
  serperConfigured: boolean;
}> {
  const serperConfigured = isSerperConfigured();

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const recentEvents = await db
    .select({
      count: sql<number>`count(*)`,
      websiteCount: sql<number>`count(case when ${sdrLeadEvents.payloadJson}::text like '%website%' then 1 end)`,
      phoneCount: sql<number>`count(case when ${sdrLeadEvents.payloadJson}::text like '%phone%' then 1 end)`,
      emailCount: sql<number>`count(case when ${sdrLeadEvents.payloadJson}::text like '%email%' then 1 end)`,
    })
    .from(sdrLeadEvents)
    .where(
      sql`${sdrLeadEvents.eventType} = 'serper_enrichment' AND ${sdrLeadEvents.createdAt} >= ${sevenDaysAgo}`
    );

  const totalEvents = await db
    .select({ count: sql<number>`count(*)` })
    .from(sdrLeadEvents)
    .where(eq(sdrLeadEvents.eventType, "serper_enrichment"));

  const r = recentEvents[0] || { count: 0, websiteCount: 0, phoneCount: 0, emailCount: 0 };

  return {
    totalEnriched: Number(totalEvents[0]?.count || 0),
    last7Days: {
      totalProcessed: Number(r.count),
      websitesFound: Number(r.websiteCount),
      phonesFound: Number(r.phoneCount),
      emailsFound: Number(r.emailCount),
      errors: 0,
      skippedGate: 0,
    },
    serperConfigured,
  };
}
