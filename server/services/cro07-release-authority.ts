/**
 * CRO-07 Release Authority.
 *
 * Owns immutable, compare-and-set release revisions bound to one exact CR-06
 * delivery intent. This is a SEPARATE authority from CR-06's own
 * package/cohort/render/approval/preparation rows in cr06_*: it never writes
 * to those tables, and it never changes the response contract of
 * POST /api/admin/cr06/runs/:id/release (which must keep returning
 * CR06_FINAL_DISPATCH_NOT_AUTHORIZED — see server/routes/cr06.ts).
 *
 * A database-level partial unique index (cro07_release_active_chain_per_intent_uidx)
 * guarantees at most one draft/approved/active release chain per CR-06 intent.
 */

import { createHash, randomUUID } from "node:crypto";
import { pool } from "../db";
import { getPauseState } from "./outbound-pause-authority";
import { recordCro07AttributionEdge } from "./cro07-attribution";

export const CRO07_ADAPTER_KEY = "denied_fake" as const;
export const CRO07_PRODUCTION_CONNECTED = false;
export const CRO07_SENDING_ENABLED = false;

export interface Cro07ReleaseInput {
  cr06DeliveryIntentId: string;
  reviewedSha: string;
  migrationHead: string;
  senderRoute: string;
  // Approved webhook source the provider must sign its feedback events
  // under. Immutable input, hashed into revisionHash like senderRoute, and
  // copied onto the claimed attempt so ingestCro07Feedback can require both
  // source and account to match before applying any effect.
  providerSource: string;
  caps: { dailyCap: number; perHourCap: number };
  canarySize: number;
  stopThresholds: { maxBounceRatePct: number; maxComplaintRatePct: number; maxReplyBacklog: number };
  reason: string;
  expiresAt: Date;
  actorId: string;
  idempotencyKey: string;
}

export interface Cro07ReleaseRow {
  id: string;
  cr06_delivery_intent_id: string;
  revision: number;
  state: string;
  dependency_fingerprint: string;
  revision_hash: string;
  created_at: string;
}

function stableHash(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/** Loads the immutable CR-06 delivery intent + its lineage by id, read-only. */
async function loadCr06IntentLineage(intentId: string) {
  const result = await pool.query(
    `SELECT di.id, di.state AS intent_state, di.render_hash, di.dependency_snapshot AS intent_dependency_snapshot,
            pr.id AS preparation_run_id, pr.dependency_fingerprint AS run_dependency_fingerprint,
            pr.program_artifact_id, pr.approval_id, pr.cohort_run_id,
            g.id AS gate_id, g.state AS gate_state
     FROM cr06_delivery_intents di
     JOIN cr06_preparation_runs pr ON pr.id = di.preparation_run_id
     LEFT JOIN cr06_campaign_gates g ON g.program_artifact_id = pr.program_artifact_id AND g.cohort_run_id = pr.cohort_run_id
     WHERE di.id = $1
     LIMIT 1`,
    [intentId],
  );
  return result.rows[0] ?? null;
}

/**
 * Creates (or replays, via idempotencyKey) a draft CRO-07 release revision
 * bound to one exact CR-06 delivery intent. Fails closed on missing/expired
 * dependencies. Never mutates any cr06_* row.
 */
export async function createCro07Release(input: Cro07ReleaseInput) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`cro07-release:${input.cr06DeliveryIntentId}`]);

    const existing = await client.query(
      `SELECT * FROM cro07_releases WHERE idempotency_key = $1 LIMIT 1`,
      [input.idempotencyKey],
    );
    if (existing.rows[0]) {
      await client.query("COMMIT");
      return { release: existing.rows[0] as Cro07ReleaseRow, replayed: true };
    }

    const lineage = await loadCr06IntentLineage(input.cr06DeliveryIntentId);
    if (!lineage) throw new Error("CRO07_INTENT_NOT_FOUND");
    if (lineage.intent_state !== "held" && lineage.intent_state !== "ready_held") {
      throw new Error("CRO07_INTENT_NOT_HELD");
    }

    const active = await client.query(
      `SELECT id FROM cro07_releases WHERE cr06_delivery_intent_id = $1 AND state IN ('draft','approved','active') LIMIT 1`,
      [input.cr06DeliveryIntentId],
    );
    if (active.rows[0]) throw new Error("CRO07_ACTIVE_RELEASE_CHAIN_EXISTS");

    const pauseState = await getPauseState();
    const dependencySnapshot = {
      cr06IntentRenderHash: lineage.render_hash,
      cr06IntentDependencySnapshot: lineage.intent_dependency_snapshot,
      cr06RunDependencyFingerprint: lineage.run_dependency_fingerprint,
      cr06GateState: lineage.gate_state ?? null,
      pauseEpoch: String(pauseState.epoch ?? "0"),
      reviewedSha: input.reviewedSha,
      migrationHead: input.migrationHead,
    };
    const dependencyFingerprint = stableHash(dependencySnapshot);
    const revisionHash = stableHash({
      ...dependencySnapshot, senderRoute: input.senderRoute, providerSource: input.providerSource,
      caps: input.caps, canarySize: input.canarySize,
    });

    const readinessSnapshot = {
      productionConnected: CRO07_PRODUCTION_CONNECTED,
      sendingEnabled: CRO07_SENDING_ENABLED,
      adapterKey: CRO07_ADAPTER_KEY,
      checkedAt: new Date().toISOString(),
    };

    const insert = await client.query(
      `INSERT INTO cro07_releases (
        cr06_delivery_intent_id, revision, state, reviewed_sha, migration_head,
        cr06_gate_id, cr06_program_artifact_id, cr06_cohort_run_id, sender_route, provider_source,
        adapter_key, environment, readiness_snapshot, suppression_generation, pause_epoch,
        caps, canary_size, stop_thresholds, dependency_snapshot, dependency_fingerprint,
        reason, expires_at, revision_hash, idempotency_key, created_by
      ) VALUES (
        $1, 1, 'draft', $2, $3,
        $4, $5, $6, $7, $8,
        $9, 'disabled', $10, $11, $12,
        $13, $14, $15, $16, $17,
        $18, $19, $20, $21, $22
      ) RETURNING *`,
      [
        input.cr06DeliveryIntentId, input.reviewedSha, input.migrationHead,
        lineage.gate_id ?? null, lineage.program_artifact_id ?? null, lineage.cohort_run_id ?? null, input.senderRoute, input.providerSource,
        CRO07_ADAPTER_KEY, JSON.stringify(readinessSnapshot), String(pauseState.epoch ?? "0"), String(pauseState.epoch ?? "0"),
        JSON.stringify(input.caps), input.canarySize, JSON.stringify(input.stopThresholds), JSON.stringify(dependencySnapshot), dependencyFingerprint,
        input.reason, input.expiresAt.toISOString(), revisionHash, input.idempotencyKey, input.actorId,
      ],
    );

    await client.query("COMMIT");
    const release = insert.rows[0] as Cro07ReleaseRow;

    // Production attribution writer: cohort -> release edge, so the
    // source-to-revenue graph has a real starting point once a release
    // exists, not only when disposable certification writes one by hand.
    if (lineage.cohort_run_id) {
      await recordCro07AttributionEdge({
        edgeType: "cohort_release",
        fromType: "cr04_cohort_run", fromId: String(lineage.cohort_run_id),
        toType: "cro07_release", toId: release.id,
      }).catch((err) => {
        console.error("[CRO07] Failed to record cohort_release attribution edge (non-fatal):", err?.message ?? err);
      });
    }

    return { release, replayed: false };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Approves a draft release. Re-validates dependency freshness at approval
 * time; drift (a changed gate/pause/dependency fingerprint since the draft
 * was created) denies approval rather than silently approving stale intent.
 */
export async function approveCro07Release(input: { releaseId: string; approverId: string; expectedRevisionHash: string }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const row = await client.query(`SELECT * FROM cro07_releases WHERE id = $1 FOR UPDATE`, [input.releaseId]);
    const release = row.rows[0];
    if (!release) throw new Error("CRO07_RELEASE_NOT_FOUND");
    if (release.state !== "draft") throw new Error("CRO07_RELEASE_NOT_DRAFT");
    if (release.revision_hash !== input.expectedRevisionHash) throw new Error("CRO07_RELEASE_HASH_DRIFT");

    const lineage = await loadCr06IntentLineage(release.cr06_delivery_intent_id);
    if (!lineage) throw new Error("CRO07_INTENT_NOT_FOUND");
    const pauseState = await getPauseState();
    const currentFingerprint = stableHash({
      cr06IntentRenderHash: lineage.render_hash,
      cr06IntentDependencySnapshot: lineage.intent_dependency_snapshot,
      cr06RunDependencyFingerprint: lineage.run_dependency_fingerprint,
      cr06GateState: lineage.gate_state ?? null,
      pauseEpoch: String(pauseState.epoch ?? "0"),
      reviewedSha: release.reviewed_sha,
      migrationHead: release.migration_head,
    });
    if (currentFingerprint !== release.dependency_fingerprint) {
      throw new Error("CRO07_DEPENDENCY_DRIFT_SINCE_DRAFT");
    }

    const updated = await client.query(
      `UPDATE cro07_releases SET state = 'approved', approver_id = $2, approved_at = NOW() WHERE id = $1 RETURNING *`,
      [input.releaseId, input.approverId],
    );
    await client.query("COMMIT");
    return updated.rows[0] as Cro07ReleaseRow;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getCro07Release(releaseId: string) {
  const result = await pool.query(`SELECT * FROM cro07_releases WHERE id = $1`, [releaseId]);
  return result.rows[0] ?? null;
}

export async function listCro07ReleasesForIntent(intentId: string) {
  const result = await pool.query(
    `SELECT * FROM cro07_releases WHERE cr06_delivery_intent_id = $1 ORDER BY revision DESC, created_at DESC`,
    [intentId],
  );
  return result.rows;
}

export function newIdempotencyKey(): string {
  return randomUUID();
}
