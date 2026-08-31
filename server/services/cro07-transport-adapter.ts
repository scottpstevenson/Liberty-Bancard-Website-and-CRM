/**
 * CRO-07 provider-neutral transport adapter contract.
 *
 * Denied-by-default: the only registered adapter is the "denied_fake"
 * adapter. It performs zero network I/O and always returns a denied outcome.
 * No SMTP/GHL/other provider is fabricated as an approved cold-outreach
 * transport (task requirement — out of scope until a real provider + sender
 * infrastructure is explicitly approved).
 *
 * Every attempt is persisted BEFORE any adapter call (claimAttempt), and its
 * terminal state is only ever set via compare-and-set (terminalizeAttempt).
 * Timeout/unknown outcomes remain "timeout_unknown" until an explicit
 * reconciliation event — they are never blind-retried and never silently
 * treated as success.
 */

import { randomUUID } from "node:crypto";
import { pool } from "../db";
import { getPauseState } from "./outbound-pause-authority";
import { canExecute } from "./outbound-queue-coordinator";
import { recordCro07AttributionEdge } from "./cro07-attribution";

export type Cro07AttemptState =
  | "reserved"
  | "in_flight"
  | "accepted"
  | "rejected"
  | "timeout_unknown"
  | "duplicate"
  | "reconciled_success"
  | "reconciled_failed";

export interface Cro07TransportResult {
  outcome: "accepted" | "rejected" | "timeout_unknown";
  providerAttemptId?: string;
  redactedError?: string;
}

export interface Cro07TransportAdapter {
  key: string;
  /** Must never perform real network I/O unless explicitly approved. */
  send(input: { attemptId: string; provider: string; frozenPayloadHash: string }): Promise<Cro07TransportResult>;
}

/**
 * The only adapter wired today. It denies every attempt deterministically —
 * proving the claim/reservation/attempt machinery end-to-end without ever
 * emitting a real message.
 */
export const deniedFakeAdapter: Cro07TransportAdapter = {
  key: "denied_fake",
  async send() {
    return {
      outcome: "rejected",
      redactedError: "CRO07_TRANSPORT_NOT_AUTHORIZED: no approved cold-outreach provider is configured",
    };
  },
};

const ADAPTERS: Record<string, Cro07TransportAdapter> = {
  [deniedFakeAdapter.key]: deniedFakeAdapter,
};

export function getCro07Adapter(key: string): Cro07TransportAdapter {
  const adapter = ADAPTERS[key];
  if (!adapter) throw new Error("CRO07_UNKNOWN_ADAPTER");
  return adapter;
}

/** Test-only injection point so certification can swap in deterministic fakes. */
export function registerCro07TestAdapter(adapter: Cro07TransportAdapter) {
  if (process.env.NODE_ENV === "production") throw new Error("CRO07_TEST_ADAPTER_FORBIDDEN_IN_PRODUCTION");
  ADAPTERS[adapter.key] = adapter;
}

/**
 * Atomically: locks the release + CR-06 intent, revalidates pause/dependency
 * state, reserves one capacity unit, and persists a 'reserved' attempt row —
 * all BEFORE any transport call. Returns the durable attempt id/lease token
 * the caller must use for the actual send.
 */
export async function claimCro07Attempt(input: {
  releaseId: string;
  provider: string;
  idempotencyKey: string;
}) {
  // providerAccountId is never taken from the caller — it is the release's
  // own approved sender_route, immutably bound to the attempt at claim time
  // so authenticated feedback can later verify the event actually came from
  // the same provider account the send was made under (see
  // ingestCro07Feedback's provider-account correlation check).
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`cro07-claim:${input.releaseId}`]);

    // A release claims exactly one attempt, period — check by release_id
    // (not just idempotency_key) so a client retry with a *different*
    // idempotency key can never mint a second attempt for the same release.
    // The cro07_attempts_release_id_unique DB constraint is the hard
    // backstop for this invariant.
    const existingAttempt = await client.query(
      `SELECT * FROM cro07_attempts WHERE release_id = $1 OR idempotency_key = $2 LIMIT 1`,
      [input.releaseId, input.idempotencyKey],
    );
    if (existingAttempt.rows[0]) {
      await client.query("COMMIT");
      return { attempt: existingAttempt.rows[0], replayed: true };
    }

    const releaseRow = await client.query(`SELECT * FROM cro07_releases WHERE id = $1 FOR UPDATE`, [input.releaseId]);
    const release = releaseRow.rows[0];
    if (!release) throw new Error("CRO07_RELEASE_NOT_FOUND");
    if (release.state !== "approved" && release.state !== "active") throw new Error("CRO07_RELEASE_NOT_APPROVED");
    if (new Date(release.expires_at).getTime() < Date.now()) throw new Error("CRO07_RELEASE_EXPIRED");

    // Live pause epoch is re-checked at claim time, never trusted from the
    // release row alone — a release approved before a pause activation must
    // deny claims immediately, without requiring a new release.
    const pauseState = await getPauseState();
    if (pauseState.state !== "unpaused") throw new Error("CRO07_OUTBOUND_PAUSED");
    const canRun = await canExecute(`cro07:release:${input.releaseId}`);
    if (!canRun) throw new Error("CRO07_COORDINATOR_HOLD_ACTIVE");

    // Reserve EVERY cap declared on the release atomically in this same
    // transaction — daily_cap, per_hour_cap, and canary_size must all be
    // enforced, not just whichever one the caller happened to name.
    const caps = release.caps as { dailyCap?: number; perHourCap?: number };
    const canarySize = Number(release.canary_size ?? 0);
    const capChecks: Array<{ key: string; limit: number }> = [];
    if (caps?.dailyCap != null) capChecks.push({ key: "daily_cap", limit: Number(caps.dailyCap) });
    if (caps?.perHourCap != null) capChecks.push({ key: "per_hour_cap", limit: Number(caps.perHourCap) });
    if (canarySize > 0) capChecks.push({ key: "canary_size", limit: canarySize });

    for (const check of capChecks) {
      const reservation = await client.query(
        `INSERT INTO cro07_reservations (release_id, capacity_key, reserved_cap, used_count)
         VALUES ($1, $2, $3, 0)
         ON CONFLICT (release_id, capacity_key) DO UPDATE SET reserved_cap = EXCLUDED.reserved_cap
         RETURNING *`,
        [input.releaseId, check.key, check.limit],
      );
      const res = reservation.rows[0];
      if (res.used_count >= res.reserved_cap) throw new Error(`CRO07_CAPACITY_EXHAUSTED:${check.key}`);
    }
    for (const check of capChecks) {
      await client.query(
        `UPDATE cro07_reservations SET used_count = used_count + 1 WHERE release_id = $1 AND capacity_key = $2`,
        [input.releaseId, check.key],
      );
    }

    const attempt = await client.query(
      `INSERT INTO cro07_attempts (
        release_id, cr06_delivery_intent_id, idempotency_key, fence_epoch, provider, provider_account_id, provider_source, adapter_key, state
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'reserved')
      RETURNING *`,
      [
        input.releaseId, release.cr06_delivery_intent_id, input.idempotencyKey, String(pauseState.epoch ?? "0"),
        input.provider, release.sender_route, release.provider_source, release.adapter_key,
      ],
    );

    await client.query("COMMIT");
    const claimedAttempt = attempt.rows[0];

    // Production attribution writer: release -> attempt edge.
    await recordCro07AttributionEdge({
      edgeType: "release_attempt",
      fromType: "cro07_release", fromId: input.releaseId,
      toType: "cro07_attempt", toId: claimedAttempt.id,
    }).catch((err) => {
      console.error("[CRO07] Failed to record release_attempt attribution edge (non-fatal):", err?.message ?? err);
    });

    return { attempt: claimedAttempt, replayed: false };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Executes the actual adapter call for a reserved attempt and records the
 * terminal (or timeout_unknown) state via compare-and-set. Never called
 * without a prior claimCro07Attempt row.
 */
export async function executeCro07Attempt(input: { attemptId: string; frozenPayloadHash: string }) {
  const before = await pool.query(`SELECT * FROM cro07_attempts WHERE id = $1`, [input.attemptId]);
  const attempt = before.rows[0];
  if (!attempt) throw new Error("CRO07_ATTEMPT_NOT_FOUND");
  if (attempt.state !== "reserved") throw new Error("CRO07_ATTEMPT_NOT_RESERVED");

  const casInFlight = await pool.query(
    `UPDATE cro07_attempts SET state = 'in_flight', attempted_at = NOW() WHERE id = $1 AND state = 'reserved' RETURNING *`,
    [input.attemptId],
  );
  if (!casInFlight.rows[0]) throw new Error("CRO07_ATTEMPT_CAS_CONFLICT");

  const adapter = getCro07Adapter(attempt.adapter_key);
  let result: Cro07TransportResult;
  try {
    result = await adapter.send({ attemptId: attempt.id, provider: attempt.provider, frozenPayloadHash: input.frozenPayloadHash });
  } catch {
    // Any thrown error during the call is ambiguous — the network state is
    // unknown, not a failure. It must never be blind-retried.
    result = { outcome: "timeout_unknown", redactedError: "CRO07_TRANSPORT_CALL_THREW" };
  }

  const nextState: Cro07AttemptState = result.outcome === "accepted" ? "accepted" : result.outcome === "rejected" ? "rejected" : "timeout_unknown";
  const cas = await pool.query(
    `UPDATE cro07_attempts
     SET state = $2, provider_attempt_id = $3, redacted_error = $4, terminal_at = CASE WHEN $2 <> 'timeout_unknown' THEN NOW() ELSE terminal_at END
     WHERE id = $1 AND state = 'in_flight'
     RETURNING *`,
    [input.attemptId, nextState, result.providerAttemptId ?? null, result.redactedError ?? null],
  );
  if (!cas.rows[0]) throw new Error("CRO07_ATTEMPT_CAS_CONFLICT");
  return cas.rows[0];
}

/**
 * Explicit reconciliation for a timeout_unknown (or otherwise unresolved)
 * attempt. Requires evidence and an actor; never runs automatically.
 */
export async function reconcileCro07Attempt(input: {
  attemptId: string;
  toState: "reconciled_success" | "reconciled_failed" | "duplicate";
  reasonCode: string;
  actorId: string;
  evidence: Record<string, unknown>;
  idempotencyKey: string;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(`SELECT * FROM cro07_reconciliations WHERE idempotency_key = $1`, [input.idempotencyKey]);
    if (existing.rows[0]) {
      await client.query("COMMIT");
      return { reconciliation: existing.rows[0], replayed: true };
    }
    const row = await client.query(`SELECT * FROM cro07_attempts WHERE id = $1 FOR UPDATE`, [input.attemptId]);
    const attempt = row.rows[0];
    if (!attempt) throw new Error("CRO07_ATTEMPT_NOT_FOUND");
    if (!["timeout_unknown", "accepted", "rejected"].includes(attempt.state)) {
      throw new Error("CRO07_ATTEMPT_NOT_RECONCILABLE");
    }
    const cas = await client.query(
      `UPDATE cro07_attempts SET state = $2, terminal_at = NOW() WHERE id = $1 RETURNING *`,
      [input.attemptId, input.toState],
    );
    const reconciliation = await client.query(
      `INSERT INTO cro07_reconciliations (attempt_id, from_state, to_state, reason_code, actor_id, evidence, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [input.attemptId, attempt.state, input.toState, input.reasonCode, input.actorId, JSON.stringify(input.evidence), input.idempotencyKey],
    );
    await client.query("COMMIT");
    return { reconciliation: reconciliation.rows[0], attempt: cas.rows[0], replayed: false };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function newAttemptIdempotencyKey(releaseId: string, intentId: string): string {
  return `cro07-attempt-${releaseId}-${intentId}-${randomUUID()}`;
}
