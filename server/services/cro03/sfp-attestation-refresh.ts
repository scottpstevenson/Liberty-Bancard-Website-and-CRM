/**
 * Recurring, self-healing refresh for the CRO-03C runtime attestation that
 * SFP paid operations require (assertSfpRuntimeAuthority /
 * getSfpAttestationReadiness).
 *
 * Before this file existed, the attestation was ONLY ever (re)created by a
 * human hitting the admin ceremony endpoint (routes/cro03.ts →
 * createCro03cRuntimeAttestation). Its TTL is capped at 15 minutes, so any
 * gap in manual operator action makes it expire and every SFP validation
 * preview reports gateOpen=false with no automatic recovery path — exactly
 * the production symptom reported (promotion enabled, gate closed because
 * the attestation is simply absent).
 *
 * This tick renews the attestation on a short interval using the EXACT same
 * createCro03cRuntimeAttestation() function and gates the admin route uses —
 * it invents no new authority and cannot succeed unless the real worker
 * fleet, deployment inventory, and DB/Redis health checks all pass. When
 * those prerequisites aren't met (e.g. right after a deploy before the
 * worker fleet heartbeats are all fresh), this fails closed and logs one
 * audit row; it never throws out of the tick, and the absence of a fresh
 * attestation is picked up by getSfpAttestationReadiness() as a quiet,
 * resumable per-cohort pause rather than a stall.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { createCro03cRuntimeAttestation } from "./live-execution";

async function auditRefresh(outcome: string, details: Record<string, unknown>) {
  await db.execute(sql`
    INSERT INTO audit_logs (user_id, action, entity_type, entity_key, details, actor_type, actor_id)
    VALUES ('system', 'sfp_attestation_refresh_tick', 'cro03c_runtime_attestation', 'sfp',
            ${JSON.stringify({ outcome, ...details })}::jsonb, 'system', 'sfp-attestation-refresh')
  `).catch(() => {});
}

// Bucket the idempotency key to 5-minute windows: short enough that a fresh
// attestation is very unlikely to lapse mid-window given the 15-min TTL
// (issuing every 5 min keeps at least 2 overlapping valid attestations at
// all times), coarse enough that a crash-looping tick can't spam distinct
// idempotency keys.
function fiveMinuteBucket(): string {
  const now = new Date();
  const bucketed = Math.floor(now.getTime() / (5 * 60 * 1000));
  return String(bucketed);
}

export interface SfpAttestationRefreshResult {
  refreshed: boolean;
  reason?: string;
  attestationId?: string;
  expiresAt?: string;
  replayed?: boolean;
}

export async function processSfpAttestationRefreshTick(): Promise<SfpAttestationRefreshResult> {
  const idempotencyKey = `sfp-attestation-refresh:${fiveMinuteBucket()}`;
  try {
    const result = await createCro03cRuntimeAttestation({
      idempotencyKey,
      actorId: "system:sfp-attestation-refresh",
      // BUG FIX: createCro03cRuntimeAttestation defaults ttlMs to 60_000 (1
      // minute) when not passed explicitly, but this tick only runs every
      // 5 minutes (see queue-manager.ts NAMED_QUEUE_SCHEDULES). That left a
      // ~4-minute gap after every refresh with NO live attestation, so
      // every sfp-continuous-validation tick landing in that gap saw
      // getSfpAttestationReadiness() report "no_live_runtime_attestation"
      // and paused — this was the actual production stall behind zero
      // sfp_outreach_eligibility rows despite FREE_DISCOVERY_VALIDATION_
      // PROMOTION_ENABLED already being on. Request the max allowed TTL
      // (15 min, clamped in createCro03cRuntimeAttestation) so a fresh
      // attestation always overlaps the next scheduled refresh with
      // margin to spare, exactly like SFP_ATTESTATION_REFRESH's own
      // "two overlapping valid attestations at all times" design intent.
      ttlMs: 15 * 60_000,
    });
    await auditRefresh("attestation_refreshed", {
      attestationId: result.id, expiresAt: result.expiresAt, replayed: result.replayed,
    });
    return { refreshed: true, attestationId: result.id, expiresAt: result.expiresAt, replayed: result.replayed };
  } catch (err: any) {
    // Expected, recoverable causes: worker fleet not yet complete right
    // after a deploy, Redis/DB transient unhealthiness, deployment inventory
    // not yet signed. All of these self-heal on a later tick — this is
    // exactly the "durable paused state, not a crash" contract required of
    // every SFP background tick.
    const reason = String(err?.message ?? err);
    await auditRefresh("attestation_refresh_failed", { reason });
    return { refreshed: false, reason };
  }
}
