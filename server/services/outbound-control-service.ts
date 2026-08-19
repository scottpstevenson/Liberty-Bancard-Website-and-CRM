/**
 * OutboundControlService — Owns all outbound pause mutations.
 *
 * All PATCH requests to /api/system/outbound-settings delegate here.
 * Mutations are serialized under a PostgreSQL advisory lock, recorded
 * atomically with the audit trail in a single transaction, and epoch-stamped.
 *
 * Pause activation follows a linearization barrier:
 *   1. Transition state → "activating" (new epoch, reject all new send auths)
 *   2. Drain registered in-flight authorizations (bounded timeout)
 *   3. Commit state → "paused" (new epoch, linearization point)
 *
 * No provider request may begin after the pause activation linearization point.
 *
 * Atomicity proof:
 *   outbound_pause_control (state + epoch) and outbound_pause_audit (audit row)
 *   are written in the SAME database transaction. If the transaction rolls back
 *   (e.g., fault injection), BOTH rows roll back together — there is no state
 *   without a corresponding audit entry, and no orphaned audit entry.
 */

import { pool } from "../db";
import { invalidatePauseStateCache, getPauseState } from "./outbound-pause-authority";
import type { PauseState, OutboundPauseStateResult } from "./outbound-pause-authority";
import { outboundQueueCoordinator } from "./outbound-queue-coordinator";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ChangeType = "state-transition" | "metadata-revision" | "idempotent-return";

export interface PauseControlResult {
  ok: boolean;
  control: {
    outboundGlobalPaused: boolean;
    reason: string | null;
    epoch: string; // bigint serialized as string for JSON
    committedAt: string | null;
    state: PauseState;
  };
  sendEnforcement: {
    status: "enforced";
    policyVersion: "1.0";
  };
  queueBackpressure: {
    status: "not_configured" | "coordinator";
    enrollmentsRestored?: number;
  };
  changeType: ChangeType;
}

export interface PauseMutationRequest {
  /** Target pause state (true = pause, false = unpause). */
  outboundGlobalPaused: boolean;
  /** Non-empty operational reason is required. */
  reason: string;
  /** Actor identity (email or user ID). */
  actor: string;
  /** Caller-supplied idempotency key (UUID or similar). When the same key is
   *  submitted twice, the second call returns the existing committed transition
   *  without writing a new epoch. */
  idempotencyKey?: string;
  /** Correlation ID for audit trail tracing. */
  correlationId?: string;
}

// ---------------------------------------------------------------------------
// Advisory lock
// ---------------------------------------------------------------------------
// All mutations acquire the same advisory lock so concurrent PATCHes serialize
// at the DB level. The lock is released when the transaction commits/rolls back.
const ADVISORY_LOCK_KEY = 1_531_1522n; // Arbitrary stable number for this subsystem

// ---------------------------------------------------------------------------
// In-flight authorization drain (DB-backed, cross-process)
// ---------------------------------------------------------------------------
// Workers that obtained an AuthorizedSendDecision register here so the pause
// activation barrier can wait for them to complete before committing paused.
//
// The in-flight registry is backed by the `outbound_inflight_sends` DB table
// so that sends authorized in any process are visible to the drain in every
// process. The process-local Set provides a fast path for single-process
// scenarios and for immediate deregister notifications.
//
// Token IDs are UUID strings so they can be stored in the DB.

const _inflightSet = new Set<string>();
const _drainWaiters: Array<() => void> = [];

/**
 * Called by the transport layer immediately after obtaining an AuthorizedSendDecision.
 *
 * Awaitable and FAIL-CLOSED: if the DB insert fails for any reason other than
 * "table does not exist" (pre-migration graceful degradation), the token is
 * removed from the local Set and the error is re-thrown so the caller can
 * abort the send. This ensures the drain count is always accurate.
 */
export async function registerInflight(tokenId: string, epoch: bigint | number = 0n): Promise<void> {
  _inflightSet.add(tokenId);
  try {
    await pool.query(
      `INSERT INTO outbound_inflight_sends (token_id, process_pid, granted_epoch, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '60 seconds')
       ON CONFLICT (token_id) DO NOTHING`,
      [tokenId, process.pid, epoch.toString()],
    );
  } catch (err: any) {
    const msg: string = err?.message ?? "";
    // Graceful degradation before migration 0134 is applied
    if (msg.includes("does not exist") || msg.includes("relation") || msg.includes("42P01")) {
      return; // pre-migration path: local Set only
    }
    // Any other DB error → fail closed (remove from local Set and re-throw)
    _inflightSet.delete(tokenId);
    throw new Error(`[InFlight] Cannot register in-flight send — fail closed: ${msg}`);
  }
}

/** Called by the transport layer immediately after provider I/O completes. */
export function deregisterInflight(tokenId: string): void {
  _inflightSet.delete(tokenId);
  if (_inflightSet.size === 0) {
    const waiters = _drainWaiters.splice(0);
    for (const w of waiters) w();
  }
  // DB delete — fire and forget
  pool.query(
    `DELETE FROM outbound_inflight_sends WHERE token_id = $1`,
    [tokenId],
  ).catch((err: Error) => {
    if (!err.message.includes("does not exist") && !err.message.includes("relation")) {
      console.warn("[InFlight] Failed to delete DB inflight row:", err.message);
    }
  });
}

/**
 * Wait until all in-flight authorizations complete, or the timeout expires.
 * Checks both the process-local Set and the DB table for cross-process coverage.
 */
export type DrainStatus = "drained" | "timeout" | "degraded";

/**
 * Typed error thrown when a pause activation cannot commit because the
 * in-flight drain was degraded (DB error) or timed out. The control row is
 * left in "activating" state, which is fail-closed: all sends remain blocked
 * until the operator retries the pause or resolves the DB issue.
 */
export class PauseDrainError extends Error {
  readonly drainStatus: DrainStatus;
  readonly reasonCode: string;
  constructor(drainStatus: DrainStatus, detail: string) {
    super(`Pause activation drain ${drainStatus}: ${detail}`);
    this.name = "PauseDrainError";
    this.drainStatus = drainStatus;
    this.reasonCode = drainStatus === "degraded" ? "drain_db_error" : "drain_timeout";
  }
}

export async function drainInflight(timeoutMs: number): Promise<{ status: DrainStatus; reason?: string }> {
  const deadline = Date.now() + timeoutMs;

  // Fast path: nothing in-flight in this process and nothing in DB.
  // A DB error here is fail-closed: report degraded, never "assume empty".
  let dbCount: number;
  try {
    dbCount = await countDbInflight();
  } catch (err: any) {
    return { status: "degraded", reason: `inflight count query failed: ${err.message}` };
  }
  if (_inflightSet.size === 0 && dbCount === 0) return { status: "drained" };

  // Poll until both the local Set and DB are empty, or timeout
  while (Date.now() < deadline) {
    if (_inflightSet.size === 0) {
      let remaining: number;
      try {
        remaining = await countDbInflight();
      } catch (err: any) {
        return { status: "degraded", reason: `inflight count query failed: ${err.message}` };
      }
      if (remaining === 0) return { status: "drained" };
    }
    await new Promise<void>(resolve => {
      const waitMs = Math.min(200, deadline - Date.now());
      if (waitMs <= 0) { resolve(); return; }
      const timer = setTimeout(resolve, waitMs);
      // Also wake early if the local set drains
      _drainWaiters.push(() => { clearTimeout(timer); resolve(); });
    });
    // Remove stale waiter entries
    const drainedLocally = _inflightSet.size === 0;
    if (drainedLocally) {
      let remaining: number;
      try {
        remaining = await countDbInflight();
      } catch (err: any) {
        return { status: "degraded", reason: `inflight count query failed: ${err.message}` };
      }
      if (remaining === 0) return { status: "drained" };
    }
  }
  return { status: "timeout", reason: `in-flight sends did not drain within ${timeoutMs}ms (local remaining: ${_inflightSet.size})` };
}

/**
 * Count active in-flight rows. THROWS on any DB error except the
 * pre-migration missing-table case (graceful degradation → 0).
 * Callers must treat a throw as fail-closed (drain degraded).
 */
async function countDbInflight(): Promise<number> {
  try {
    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM outbound_inflight_sends WHERE expires_at > NOW()`,
    );
    return parseInt(result.rows[0]?.count ?? "0", 10);
  } catch (err: any) {
    const msg: string = err?.message ?? "";
    if (msg.includes("does not exist") || msg.includes("relation") || err?.code === "42P01") {
      // Table missing (pre-migration) — local Set is authoritative
      return 0;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Mutation
// ---------------------------------------------------------------------------

const DRAIN_TIMEOUT_MS = 10_000; // Max wait for in-flight sends to drain

export async function applyPauseMutation(
  request: PauseMutationRequest,
): Promise<PauseControlResult> {
  // Validate inputs
  if (!request.reason || request.reason.trim().length === 0) {
    throw new Error("Pause mutation requires a non-empty reason");
  }
  if (!request.actor || request.actor.trim().length === 0) {
    throw new Error("Pause mutation requires a non-empty actor");
  }

  const targetState: PauseState = request.outboundGlobalPaused ? "paused" : "unpaused";
  const client = await pool.connect();

  try {
    // ── Phase 1: Acquire advisory lock and read current state ───────────────
    await client.query("BEGIN");
    await client.query(
      `SELECT pg_advisory_xact_lock($1)`,
      [Number(ADVISORY_LOCK_KEY % BigInt(Number.MAX_SAFE_INTEGER))],
    );

    const currentRow = await client.query<{
      id: number;
      state: string;
      reason: string | null;
      epoch: string;
      idempotency_key: string | null;
      committed_at: Date;
    }>(
      `SELECT id, state, reason, epoch::text, idempotency_key, committed_at
       FROM outbound_pause_control
       ORDER BY id
       LIMIT 1
       FOR UPDATE`,
    );

    const currentState = currentRow.rows[0]?.state as PauseState | undefined;
    const currentEpoch = currentRow.rows[0]?.epoch
      ? BigInt(currentRow.rows[0].epoch)
      : 0n;
    const currentIdempotencyKey = currentRow.rows[0]?.idempotency_key ?? null;
    const currentReason = currentRow.rows[0]?.reason ?? null;
    const currentCommittedAt = currentRow.rows[0]?.committed_at ?? null;

    // ── Idempotency check ────────────────────────────────────────────────────
    if (
      request.idempotencyKey &&
      request.idempotencyKey === currentIdempotencyKey &&
      currentState === targetState
    ) {
      await client.query("ROLLBACK");
      return buildResult(
        currentState,
        currentReason,
        currentEpoch,
        currentCommittedAt,
        "idempotent-return",
      );
    }

    // ── Same-state changed-reason check ──────────────────────────────────────
    if (currentState === targetState && currentState !== undefined) {
      // Same state but different reason → metadata revision under new epoch
      const newEpoch = currentEpoch + 1n;
      const now = new Date();

      await upsertControlRow(client, {
        state: targetState,
        reason: request.reason,
        epoch: newEpoch,
        actor: request.actor,
        idempotencyKey: request.idempotencyKey ?? null,
        committedAt: now,
        existingId: currentRow.rows[0]?.id,
      });

      await writeAuditRow(client, {
        epoch: newEpoch,
        changeType: "metadata-revision",
        fromState: currentState,
        toState: targetState,
        actor: request.actor,
        correlationId: request.correlationId ?? null,
        reason: request.reason,
        details: {
          previousReason: currentReason,
          idempotencyKey: request.idempotencyKey ?? null,
        },
      });

      await client.query("COMMIT");
      invalidatePauseStateCache();

      return buildResult(targetState, request.reason, newEpoch, now, "metadata-revision");
    }

    // ── State transition ─────────────────────────────────────────────────────

    if (targetState === "paused") {
      // Pause activation barrier:
      // 1. Transition to "activating" first
      const activatingEpoch = currentEpoch + 1n;
      const now1 = new Date();

      await upsertControlRow(client, {
        state: "activating",
        reason: request.reason,
        epoch: activatingEpoch,
        actor: request.actor,
        idempotencyKey: null, // activating is transient, don't mark idempotent
        committedAt: now1,
        existingId: currentRow.rows[0]?.id,
      });

      await writeAuditRow(client, {
        epoch: activatingEpoch,
        changeType: "state-transition",
        fromState: currentState ?? "unknown",
        toState: "activating",
        actor: request.actor,
        correlationId: request.correlationId ?? null,
        reason: request.reason,
        details: { activationBarrierStart: now1.toISOString() },
      });

      // Mixed-version rolling-deployment safety: write legacy system_settings
      // flag IN THE SAME TRANSACTION as the 'activating' control row.
      // If this write fails the entire transaction rolls back — 'activating'
      // is never committed without the legacy flag, so older processes cannot
      // proceed unaware of the pause.
      await client.query(
        `INSERT INTO system_settings (key, value, updated_at)
         VALUES ('outboundGlobalPaused', 'true', NOW())
         ON CONFLICT (key) DO UPDATE SET value = 'true', updated_at = NOW()`,
      );

      await client.query("COMMIT");
      invalidatePauseStateCache();
      console.log("[OutboundControlService] Pause activation: legacy flag written atomically with activating state");

      // 2. Drain in-flight authorizations (outside transaction)
      const drain = await drainInflight(DRAIN_TIMEOUT_MS);
      const drainResult = drain.status;
      console.log(
        `[OutboundControlService] Pause activation: drain ${drainResult} ` +
        `(remaining in-flight: ${_inflightSet.size}${drain.reason ? `, reason: ${drain.reason}` : ""})`,
      );

      // Fail-closed: do NOT commit "paused" on a degraded or timed-out drain.
      // The control row remains in "activating", which blocks ALL sends
      // (authorize() rejects during activating), so nothing leaks — but the
      // pause is not falsely reported as committed either.
      if (drainResult !== "drained") {
        try {
          const auditClient = await pool.connect();
          try {
            await auditClient.query("BEGIN");
            await writeAuditRow(auditClient, {
              epoch: activatingEpoch,
              changeType: "state-transition",
              fromState: "activating",
              toState: "activating",
              actor: request.actor,
              correlationId: request.correlationId ?? null,
              reason: `Pause activation NOT committed — drain ${drainResult}`,
              details: { drainResult, drainReason: drain.reason ?? null, remainingInflight: _inflightSet.size },
            });
            await auditClient.query("COMMIT");
          } finally {
            auditClient.release();
          }
        } catch { /* audit best-effort */ }
        throw new PauseDrainError(drainResult, drain.reason ?? "in-flight drain incomplete");
      }

      // 3. Commit final paused state (new transaction)
      await client.query("BEGIN");
      await client.query(
        `SELECT pg_advisory_xact_lock($1)`,
        [Number(ADVISORY_LOCK_KEY % BigInt(Number.MAX_SAFE_INTEGER))],
      );

      // Re-read to get current row after the activating epoch.
      // CRITICAL: verify state is still 'activating' before committing 'paused'.
      // A concurrent unpause may have committed during the drain window; if so,
      // honor that result rather than overwriting an admin-initiated unpause.
      const reRead = await client.query<{ id: number; epoch: string; state: string }>(
        `SELECT id, epoch::text, state FROM outbound_pause_control ORDER BY id LIMIT 1 FOR UPDATE`,
      );
      const reReadState = reRead.rows[0]?.state as PauseState | undefined;

      if (reReadState !== "activating") {
        // A concurrent mutation resolved the state during drain.
        // Rollback and return whatever is now committed.
        await client.query("ROLLBACK");
        invalidatePauseStateCache();
        const concurrentEpoch = BigInt(reRead.rows[0]?.epoch ?? 0);
        console.warn(
          `[OutboundControlService] Pause activation superseded by concurrent mutation ` +
          `(state=${reReadState}, epoch=${concurrentEpoch}) — honoring concurrent result`,
        );
        return buildResult(
          reReadState ?? "unpaused",
          request.reason,
          concurrentEpoch,
          new Date(),
          "idempotent-return",
        );
      }

      const pausedEpoch = BigInt(reRead.rows[0]?.epoch ?? 0) + 1n;
      const now2 = new Date();

      await upsertControlRow(client, {
        state: "paused",
        reason: request.reason,
        epoch: pausedEpoch,
        actor: request.actor,
        idempotencyKey: request.idempotencyKey ?? null,
        committedAt: now2,
        existingId: reRead.rows[0]?.id,
      });

      await writeAuditRow(client, {
        epoch: pausedEpoch,
        changeType: "state-transition",
        fromState: "activating",
        toState: "paused",
        actor: request.actor,
        correlationId: request.correlationId ?? null,
        reason: request.reason,
        details: {
          drainResult,
          remainingInflight: _inflightSet.size,
          activatingEpoch: activatingEpoch.toString(),
        },
      });

      // Write global_outbound coordinator holds (same transaction as paused commit)
      try {
        await outboundQueueCoordinator.writeGlobalOutboundHolds(
          client,
          pausedEpoch,
          request.actor,
          request.correlationId,
        );
      } catch (holdErr: any) {
        console.warn(
          `[OutboundControlService] Coordinator hold write failed (non-fatal, table may not exist yet): ${holdErr.message}`,
        );
        // Non-fatal if table doesn't exist (pre-migration graceful degradation)
      }

      await client.query("COMMIT");
      invalidatePauseStateCache();

      // Sync to legacy system_settings so older processes detect the pause
      // within one legacy read cycle (mixed-version rolling-deployment guard).
      await syncToLegacySystemSetting(true);

      return buildResult("paused", request.reason, pausedEpoch, now2, "state-transition");
    } else {
      // Unpause — single-transaction commit with VFC-22 restoration + coordinator integration
      const newEpoch = currentEpoch + 1n;
      const now = new Date();

      await upsertControlRow(client, {
        state: "unpaused",
        reason: request.reason,
        epoch: newEpoch,
        actor: request.actor,
        idempotencyKey: request.idempotencyKey ?? null,
        committedAt: now,
        existingId: currentRow.rows[0]?.id,
      });

      await writeAuditRow(client, {
        epoch: newEpoch,
        changeType: "state-transition",
        fromState: currentState ?? "unknown",
        toState: "unpaused",
        actor: request.actor,
        correlationId: request.correlationId ?? null,
        reason: request.reason,
        details: { idempotencyKey: request.idempotencyKey ?? null },
      });

      // ── VFC-22 fix: restore _globalPauseBlock* enrollments to 'active' ───────
      // sequence-worker.ts mutates enrollment status to 'paused' + sets
      // _globalPauseBlock* metadata when globally paused. These enrollments are
      // permanently stuck unless explicitly restored here.
      // This sweep runs atomically within the same transaction as the control row commit.
      let restoredCount = 0;
      try {
        const restored = await client.query<{ id: number }>(
          `UPDATE sequence_enrollments
           SET status     = 'active',
               metadata   = metadata
                            - '_globalPauseBlockStep'
                            - '_globalPauseBlockReason',
               updated_at = NOW()
           WHERE status = 'paused'
             AND metadata->>'_globalPauseBlockReason' IS NOT NULL
           RETURNING id`,
        );
        restoredCount = restored.rows.length;
        if (restoredCount > 0) {
          console.log(
            `[OutboundControlService] VFC-22: restored ${restoredCount} _globalPauseBlock* ` +
            `enrollment(s) to active within unpause transaction`,
          );
          // Write audit entries for restored enrollments (fire-and-forget outside transaction)
          const restoredIds = restored.rows.map(r => r.id);
          setImmediate(() => {
            writeEnrollmentRestorationAudit(restoredIds, request.actor).catch(e =>
              console.warn("[OutboundControlService] Enrollment restoration audit failed:", e.message),
            );
          });
        }
      } catch (restoreErr: any) {
        // Non-fatal — the column may not exist (pre-existing DB without the column)
        // or the table may not have metadata. Log and continue.
        const isSchemaErr =
          restoreErr.message?.includes("does not exist") ||
          restoreErr.message?.includes("column") ||
          restoreErr.message?.includes("relation");
        if (!isSchemaErr) {
          console.warn(
            `[OutboundControlService] VFC-22 restoration sweep warning: ${restoreErr.message}`,
          );
        }
      }

      // Transition coordinator global_outbound holds to release_pending
      // (does NOT delete immediately — mixed handlers remain blocked until
      // admin-triggered staged-release approval)
      try {
        await outboundQueueCoordinator.transitionGlobalHoldsToReleasePending(
          client,
          request.actor,
          request.correlationId,
        );
      } catch (holdErr: any) {
        console.warn(
          `[OutboundControlService] Coordinator hold transition failed (non-fatal): ${holdErr.message}`,
        );
      }

      await client.query("COMMIT");
      invalidatePauseStateCache();

      // Also persist into system_settings for backward compat
      await syncToLegacySystemSetting(false);

      return buildResult("unpaused", request.reason, newEpoch, now, "state-transition", restoredCount);
    }
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch { /* ignore rollback error */ }
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function upsertControlRow(
  client: import("pg").PoolClient,
  opts: {
    state: PauseState;
    reason: string;
    epoch: bigint;
    actor: string;
    idempotencyKey: string | null;
    committedAt: Date;
    existingId: number | undefined;
  },
): Promise<void> {
  if (opts.existingId != null) {
    await client.query(
      `UPDATE outbound_pause_control
       SET state = $1, reason = $2, epoch = $3, actor = $4, idempotency_key = $5, committed_at = $6
       WHERE id = $7`,
      [
        opts.state,
        opts.reason,
        opts.epoch,
        opts.actor,
        opts.idempotencyKey,
        opts.committedAt,
        opts.existingId,
      ],
    );
  } else {
    await client.query(
      `INSERT INTO outbound_pause_control (state, reason, epoch, actor, idempotency_key, committed_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        opts.state,
        opts.reason,
        opts.epoch,
        opts.actor,
        opts.idempotencyKey,
        opts.committedAt,
      ],
    );
  }
}

async function writeAuditRow(
  client: import("pg").PoolClient,
  opts: {
    epoch: bigint;
    changeType: ChangeType;
    fromState: string;
    toState: string;
    actor: string;
    correlationId: string | null;
    reason: string;
    details: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO outbound_pause_audit
       (epoch, change_type, from_state, to_state, actor, correlation_id, reason, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      opts.epoch,
      opts.changeType,
      opts.fromState,
      opts.toState,
      opts.actor,
      opts.correlationId,
      opts.reason,
      JSON.stringify(opts.details),
    ],
  );
}

async function syncToLegacySystemSetting(paused: boolean): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO system_settings (key, value, updated_at)
       VALUES ('outboundGlobalPaused', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [JSON.stringify(paused)],
    );
  } catch (err: any) {
    console.warn(`[OutboundControlService] Legacy system_settings sync failed (non-fatal): ${err.message}`);
  } finally {
    client.release();
  }
}

function buildResult(
  state: PauseState,
  reason: string | null,
  epoch: bigint,
  committedAt: Date | null,
  changeType: ChangeType,
  enrollmentsRestored = 0,
): PauseControlResult {
  return {
    ok: true,
    control: {
      outboundGlobalPaused: state !== "unpaused",
      reason,
      epoch: epoch.toString(),
      committedAt: committedAt?.toISOString() ?? null,
      state,
    },
    sendEnforcement: {
      status: "enforced",
      policyVersion: "1.0",
    },
    queueBackpressure: {
      status: "coordinator",
      enrollmentsRestored,
    },
    changeType,
  };
}

/**
 * Write audit log entries for enrollments restored during VFC-22 sweep.
 * Fire-and-forget; called outside the unpause transaction.
 */
async function writeEnrollmentRestorationAudit(
  enrollmentIds: number[],
  actor: string,
): Promise<void> {
  if (enrollmentIds.length === 0) return;
  // Write a single batch audit entry
  try {
    await pool.query(
      `INSERT INTO audit_logs (action, entity_type, entity_id, actor_type, details, created_at)
       VALUES ('global_pause_enrollments_restored', 'system', 0, 'system', $1, NOW())`,
      [
        JSON.stringify((await import("./audit-sanitizer")).sanitizeAuditPayload({
          restoredCount: enrollmentIds.length,
          enrollmentIds: enrollmentIds.slice(0, 100), // truncate for storage
          actor,
          restorationType: "vfc22_global_pause_block_sweep",
        })),
      ],
    );
  } catch (auditErr: any) {
    console.warn(`[OutboundControlService] Enrollment restoration audit write failed: ${auditErr.message}`);
  }
}

export { writeEnrollmentRestorationAudit };

// ---------------------------------------------------------------------------
// Startup initialization
// ---------------------------------------------------------------------------

/**
 * Initialize the control row from the legacy system_settings key if no row
 * exists yet. Called during server startup BEFORE workers start.
 * Returns the current committed state and epoch.
 */
export async function initializePauseControl(): Promise<OutboundPauseStateResult> {
  const client = await pool.connect();
  try {
    // Check if control table exists
    const tableCheck = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'outbound_pause_control'
       ) as exists`,
    );

    if (!tableCheck.rows[0]?.exists) {
      console.warn(
        "[OutboundControlService] outbound_pause_control table does not exist — " +
        "migration not yet applied; falling back to system_settings",
      );
      // Return fail-closed state
      return {
        state: "paused",
        reason: "Control table missing — fail-closed startup default",
        epoch: 0n,
        source: "safe_default",
        committedAt: null,
      };
    }

    // Check if a row exists
    const existing = await client.query<{ id: number }>(
      `SELECT id FROM outbound_pause_control ORDER BY id LIMIT 1`,
    );

    if (existing.rows.length > 0) {
      // Row exists — read current state
      const { getPauseState } = await import("./outbound-pause-authority");
      invalidatePauseStateCache();
      return getPauseState();
    }

    // No row yet — seed from system_settings (fail-closed default)
    let legacyPaused = true;
    let legacyReason: string | null = "Startup fail-closed default";

    try {
      const ssRow = await client.query<{ value: unknown }>(
        `SELECT value FROM system_settings WHERE key = 'outboundGlobalPaused' LIMIT 1`,
      );
      if (ssRow.rows.length > 0) {
        const v = ssRow.rows[0].value;
        legacyPaused = !(v === false || v === "false");
        legacyReason = legacyPaused
          ? "Seeded from system_settings (paused)"
          : "Seeded from system_settings (unpaused)";
      }
    } catch {
      legacyPaused = true;
      legacyReason = "system_settings read failed — fail-closed";
    }

    const initialState: PauseState = legacyPaused ? "paused" : "unpaused";
    const now = new Date();

    // Atomic transaction: control row + audit row must both commit or both roll back.
    await client.query("BEGIN");
    try {
      await client.query(
        `INSERT INTO outbound_pause_control (state, reason, epoch, actor, committed_at)
         VALUES ($1, $2, 1, 'system-startup', $3)`,
        [initialState, legacyReason, now],
      );

      await client.query(
        `INSERT INTO outbound_pause_audit
           (epoch, change_type, from_state, to_state, actor, reason, details)
         VALUES (1, 'state-transition', 'unknown', $1, 'system-startup', $2, $3)`,
        [
          initialState,
          legacyReason,
          JSON.stringify({ source: "startup-seed", legacyPaused }),
        ],
      );
      await client.query("COMMIT");
    } catch (txErr) {
      await client.query("ROLLBACK").catch(() => {});
      throw txErr;
    }

    invalidatePauseStateCache();

    console.log(
      `[OutboundControlService] Seeded control row: state=${initialState} epoch=1`,
    );

    return {
      state: initialState,
      reason: legacyReason,
      epoch: 1n,
      source: "database",
      committedAt: now,
    };
  } finally {
    client.release();
  }
}
