/**
 * outbound-queue-coordinator.ts (#1532)
 *
 * Outbound Queue Coordinator — reason-scoped logical hold ledger + BullMQ
 * physical pause reconciliation.
 *
 * Responsibilities:
 *   1. Read logical hold ledger; compute effective holds per logical job key.
 *   2. Serialize mutations under a PostgreSQL advisory lock with monotonic ledger_epoch.
 *   3. Source-epoch fencing: stale events cannot overwrite newer holds for the same owner.
 *   4. Calculate desired physical queue state from manifest + effective logical holds.
 *   5. Apply BullMQ pause/resume ONLY after committing desired state to DB, then readback.
 *   6. Return 'applied' only when queue.isPaused() matches desired at current epoch.
 *   7. Return 'pending'/'degraded' on Redis fault — survives restart and reconciles.
 *   8. Periodic expiry sweep; multi-process advisory-lock fencing.
 *   9. getStatus() — side-effect-free accessor for routes and health checks.
 *
 * INVARIANTS:
 *   - Physical pause is NEVER the final send-safety boundary. That is #1531's role.
 *   - Workers must check BOTH OutboundPauseAuthority.authorize() AND coordinator.canExecute().
 *   - 'applied' requires queue.isPaused() readback matching desired state at epoch.
 *   - Redis fault between DB commit and Redis action → 'pending'/'degraded'.
 *   - Two replicas converge to the newest committed desired state.
 */

import { pool } from "../db";
import type { ManifestEntry } from "./logical-job-manifest";

// ---------------------------------------------------------------------------
// Advisory lock key (distinct from OutboundControlService)
// ---------------------------------------------------------------------------

const COORDINATOR_LOCK_KEY = 1_532_1522n;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type HoldReasonCode =
  | "global_outbound"
  | "manual_operator"
  | "maintenance"
  | "incident"
  | "automation_kill_switch"
  | "channel_pause"
  | "release_pending";

export interface HoldEntry {
  holdId: string;
  logicalJobKey: string;
  reasonCode: HoldReasonCode;
  sourceType: string;
  sourceKey: string;
  sourceEpoch: bigint | null;
  ledgerEpoch: bigint;
  active: boolean;
  activatedAt: Date;
  releasedAt: Date | null;
  expiresAt: Date | null;
  actor: string | null;
  correlationId: string | null;
  metadata: Record<string, unknown> | null;
}

export type ReconciliationOutcome = "applied" | "pending" | "degraded" | "noop";

export interface ReconciliationResult {
  physicalQueue: string;
  desiredState: "paused" | "running";
  observedState: "paused" | "running" | "unknown";
  outcome: ReconciliationOutcome;
  desiredEpoch: bigint;
  observedEpoch: bigint | null;
  error: string | null;
}

export interface CoordinatorStatus {
  desiredLogicalHolds: Record<string, HoldEntry[]>; // logicalKey → active holds
  physicalQueueStates: ReconciliationResult[];
  ledgerEpoch: bigint;
  reconciledAt: Date | null;
}

export interface AddHoldRequest {
  logicalJobKey: string;
  reasonCode: HoldReasonCode;
  sourceType: string;
  sourceKey: string;
  sourceEpoch?: bigint;
  actor?: string;
  correlationId?: string;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface ClearHoldRequest {
  logicalJobKey: string;
  reasonCode: HoldReasonCode;
  sourceKey: string;
  actor?: string;
  correlationId?: string;
}

// ---------------------------------------------------------------------------
// Coordinator implementation
// ---------------------------------------------------------------------------

class OutboundQueueCoordinator {
  private _queueManager: any | null = null;

  /** Inject the QueueManager reference (called from queue-manager.ts post-init). */
  setQueueManager(qm: any): void {
    this._queueManager = qm;
  }

  // ── Read path ────────────────────────────────────────────────────────────

  /**
   * Returns true if the given logical job key has no active, non-expired holds.
   * Uses a short-lived cache to reduce DB pressure.
   * Fail-closed: DB error → returns false (blocked).
   */
  async canExecute(logicalJobKey: string): Promise<boolean> {
    try {
      const holds = await this.getActiveHoldsForKey(logicalJobKey);
      return holds.length === 0;
    } catch (err: any) {
      console.warn(
        `[Coordinator] canExecute("${logicalJobKey}") failed — fail-closed: ${err.message}`,
      );
      return false; // Fail closed
    }
  }

  /** Return all active, non-expired holds for a logical job key. */
  async getActiveHoldsForKey(logicalJobKey: string): Promise<HoldEntry[]> {
    const client = await pool.connect();
    try {
      await client.query("SET LOCAL statement_timeout = 3000");
      const result = await client.query<{
        hold_id: string;
        logical_job_key: string;
        reason_code: string;
        source_type: string;
        source_key: string;
        source_epoch: string | null;
        ledger_epoch: string;
        active: boolean;
        activated_at: Date;
        released_at: Date | null;
        expires_at: Date | null;
        actor: string | null;
        correlation_id: string | null;
        metadata: Record<string, unknown> | null;
      }>(
        `SELECT hold_id, logical_job_key, reason_code, source_type, source_key,
                source_epoch::text, ledger_epoch::text, active, activated_at,
                released_at, expires_at, actor, correlation_id, metadata
         FROM logical_job_control_holds
         WHERE logical_job_key = $1
           AND active = true
           AND (expires_at IS NULL OR expires_at > NOW())
         ORDER BY ledger_epoch DESC`,
        [logicalJobKey],
      );
      return result.rows.map(r => ({
        holdId: r.hold_id,
        logicalJobKey: r.logical_job_key,
        reasonCode: r.reason_code as HoldReasonCode,
        sourceType: r.source_type,
        sourceKey: r.source_key,
        sourceEpoch: r.source_epoch ? BigInt(r.source_epoch) : null,
        ledgerEpoch: BigInt(r.ledger_epoch),
        active: r.active,
        activatedAt: r.activated_at,
        releasedAt: r.released_at,
        expiresAt: r.expires_at,
        actor: r.actor,
        correlationId: r.correlation_id,
        metadata: r.metadata,
      }));
    } finally {
      client.release();
    }
  }

  /**
   * Side-effect-free status accessor for routes and health checks.
   * Never throws — returns partial/empty status on error.
   */
  async getStatus(): Promise<CoordinatorStatus> {
    try {
      const client = await pool.connect();
      try {
        await client.query("SET LOCAL statement_timeout = 5000");

        // All active holds
        const holdsResult = await client.query<{
          hold_id: string;
          logical_job_key: string;
          reason_code: string;
          source_type: string;
          source_key: string;
          source_epoch: string | null;
          ledger_epoch: string;
          active: boolean;
          activated_at: Date;
          released_at: Date | null;
          expires_at: Date | null;
          actor: string | null;
          correlation_id: string | null;
          metadata: Record<string, unknown> | null;
        }>(
          `SELECT hold_id, logical_job_key, reason_code, source_type, source_key,
                  source_epoch::text, ledger_epoch::text, active, activated_at,
                  released_at, expires_at, actor, correlation_id, metadata
           FROM logical_job_control_holds
           WHERE active = true AND (expires_at IS NULL OR expires_at > NOW())
           ORDER BY logical_job_key, ledger_epoch DESC`,
        );

        const desiredLogicalHolds: Record<string, HoldEntry[]> = {};
        let maxLedgerEpoch = 0n;
        for (const r of holdsResult.rows) {
          const entry: HoldEntry = {
            holdId: r.hold_id,
            logicalJobKey: r.logical_job_key,
            reasonCode: r.reason_code as HoldReasonCode,
            sourceType: r.source_type,
            sourceKey: r.source_key,
            sourceEpoch: r.source_epoch ? BigInt(r.source_epoch) : null,
            ledgerEpoch: BigInt(r.ledger_epoch),
            active: r.active,
            activatedAt: r.activated_at,
            releasedAt: r.released_at,
            expiresAt: r.expires_at,
            actor: r.actor,
            correlationId: r.correlation_id,
            metadata: r.metadata,
          };
          if (!desiredLogicalHolds[r.logical_job_key]) {
            desiredLogicalHolds[r.logical_job_key] = [];
          }
          desiredLogicalHolds[r.logical_job_key].push(entry);
          if (entry.ledgerEpoch > maxLedgerEpoch) {
            maxLedgerEpoch = entry.ledgerEpoch;
          }
        }

        // Physical queue states
        const reconResult = await client.query<{
          physical_queue: string;
          desired_state: string | null;
          desired_epoch: string | null;
          observed_state: string | null;
          observed_epoch: string | null;
          reconciled_at: Date | null;
          last_error: string | null;
        }>(
          `SELECT physical_queue, desired_state, desired_epoch::text, observed_state,
                  observed_epoch::text, reconciled_at, last_error
           FROM queue_reconciliation_state
           ORDER BY physical_queue`,
        );

        const physicalQueueStates: ReconciliationResult[] = reconResult.rows.map(r => ({
          physicalQueue: r.physical_queue,
          desiredState: (r.desired_state ?? "running") as "paused" | "running",
          observedState: (r.observed_state ?? "unknown") as "paused" | "running" | "unknown",
          outcome: "noop",
          desiredEpoch: r.desired_epoch ? BigInt(r.desired_epoch) : 0n,
          observedEpoch: r.observed_epoch ? BigInt(r.observed_epoch) : null,
          error: r.last_error,
        }));

        return {
          desiredLogicalHolds,
          physicalQueueStates,
          ledgerEpoch: maxLedgerEpoch,
          reconciledAt: reconResult.rows[0]?.reconciled_at ?? null,
        };
      } finally {
        client.release();
      }
    } catch (err: any) {
      console.warn(`[Coordinator] getStatus() failed: ${err.message}`);
      return {
        desiredLogicalHolds: {},
        physicalQueueStates: [],
        ledgerEpoch: 0n,
        reconciledAt: null,
      };
    }
  }

  // ── Write path ───────────────────────────────────────────────────────────

  /**
   * Add a hold for a logical job key. Serialized under advisory lock.
   * Stale source_epoch cannot overwrite a newer hold for the same owner.
   * Returns the hold_id of the created/existing hold.
   */
  async addHold(request: AddHoldRequest): Promise<string> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `SELECT pg_advisory_xact_lock($1)`,
        [Number(COORDINATOR_LOCK_KEY % BigInt(Number.MAX_SAFE_INTEGER))],
      );

      // Get current ledger epoch (max of all holds)
      const epochResult = await client.query<{ max_epoch: string | null }>(
        `SELECT MAX(ledger_epoch)::text AS max_epoch FROM logical_job_control_holds`,
      );
      const currentLedgerEpoch = epochResult.rows[0]?.max_epoch
        ? BigInt(epochResult.rows[0].max_epoch)
        : 0n;
      const newLedgerEpoch = currentLedgerEpoch + 1n;

      // Source epoch staleness guard: check if a newer hold from the same owner exists
      if (request.sourceEpoch !== undefined) {
        const existingResult = await client.query<{ source_epoch: string | null }>(
          `SELECT source_epoch::text FROM logical_job_control_holds
           WHERE logical_job_key = $1 AND reason_code = $2 AND source_key = $3 AND active = true`,
          [request.logicalJobKey, request.reasonCode, request.sourceKey],
        );
        if (existingResult.rows.length > 0) {
          const existingEpoch = existingResult.rows[0].source_epoch
            ? BigInt(existingResult.rows[0].source_epoch)
            : 0n;
          if (request.sourceEpoch <= existingEpoch) {
            // Stale — do not overwrite
            await client.query("ROLLBACK");
            const holdIdResult = await client.query<{ hold_id: string }>(
              `SELECT hold_id FROM logical_job_control_holds
               WHERE logical_job_key = $1 AND reason_code = $2 AND source_key = $3 AND active = true
               LIMIT 1`,
              [request.logicalJobKey, request.reasonCode, request.sourceKey],
            );
            return holdIdResult.rows[0]?.hold_id ?? "stale";
          }
        }
      }

      // Insert the hold
      const insertResult = await client.query<{ hold_id: string }>(
        `INSERT INTO logical_job_control_holds
           (logical_job_key, reason_code, source_type, source_key, source_epoch,
            ledger_epoch, active, activated_at, expires_at, actor, correlation_id, metadata, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, true, NOW(), $7, $8, $9, $10, NOW())
         ON CONFLICT (logical_job_key, reason_code, source_key) WHERE active = true
         DO UPDATE SET
           ledger_epoch = EXCLUDED.ledger_epoch,
           source_epoch = EXCLUDED.source_epoch,
           expires_at   = EXCLUDED.expires_at,
           actor        = EXCLUDED.actor,
           metadata     = EXCLUDED.metadata,
           updated_at   = NOW()
         RETURNING hold_id`,
        [
          request.logicalJobKey,
          request.reasonCode,
          request.sourceType,
          request.sourceKey,
          request.sourceEpoch?.toString() ?? null,
          newLedgerEpoch.toString(),
          request.expiresAt ?? null,
          request.actor ?? null,
          request.correlationId ?? null,
          request.metadata ? JSON.stringify(request.metadata) : null,
        ],
      );

      const holdId = insertResult.rows[0]?.hold_id ?? "unknown";

      // Write audit event
      await client.query(
        `INSERT INTO logical_job_hold_events
           (hold_id, event_type, logical_job_key, reason_code, source_key, ledger_epoch, actor, correlation_id, metadata)
         VALUES ($1, 'activated', $2, $3, $4, $5, $6, $7, $8)`,
        [
          holdId,
          request.logicalJobKey,
          request.reasonCode,
          request.sourceKey,
          newLedgerEpoch.toString(),
          request.actor ?? null,
          request.correlationId ?? null,
          request.metadata ? JSON.stringify(request.metadata) : null,
        ],
      );

      await client.query("COMMIT");
      console.log(
        `[Coordinator] Hold added: key="${request.logicalJobKey}" reason="${request.reasonCode}" ` +
        `source="${request.sourceKey}" epoch=${newLedgerEpoch} holdId=${holdId}`,
      );

      // Trigger reconciliation for affected queues (fire-and-forget)
      this.triggerReconciliation(request.logicalJobKey).catch(e =>
        console.warn("[Coordinator] Reconciliation after addHold failed:", e.message),
      );

      return holdId;
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Clear a hold. Only the matching (logicalJobKey, reasonCode, sourceKey) row is released.
   * Other holds for the same key are unaffected.
   */
  async clearHold(request: ClearHoldRequest): Promise<boolean> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `SELECT pg_advisory_xact_lock($1)`,
        [Number(COORDINATOR_LOCK_KEY % BigInt(Number.MAX_SAFE_INTEGER))],
      );

      const epochResult = await client.query<{ max_epoch: string | null }>(
        `SELECT MAX(ledger_epoch)::text AS max_epoch FROM logical_job_control_holds`,
      );
      const currentLedgerEpoch = epochResult.rows[0]?.max_epoch
        ? BigInt(epochResult.rows[0].max_epoch)
        : 0n;
      const newLedgerEpoch = currentLedgerEpoch + 1n;

      const updateResult = await client.query<{ hold_id: string }>(
        `UPDATE logical_job_control_holds
         SET active = false, released_at = NOW(), ledger_epoch = $1, updated_at = NOW()
         WHERE logical_job_key = $2 AND reason_code = $3 AND source_key = $4 AND active = true
         RETURNING hold_id`,
        [
          newLedgerEpoch.toString(),
          request.logicalJobKey,
          request.reasonCode,
          request.sourceKey,
        ],
      );

      if (updateResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return false; // No active hold found
      }

      const holdId = updateResult.rows[0].hold_id;

      await client.query(
        `INSERT INTO logical_job_hold_events
           (hold_id, event_type, logical_job_key, reason_code, source_key, ledger_epoch, actor, correlation_id)
         VALUES ($1, 'released', $2, $3, $4, $5, $6, $7)`,
        [
          holdId,
          request.logicalJobKey,
          request.reasonCode,
          request.sourceKey,
          newLedgerEpoch.toString(),
          request.actor ?? null,
          request.correlationId ?? null,
        ],
      );

      await client.query("COMMIT");
      console.log(
        `[Coordinator] Hold cleared: key="${request.logicalJobKey}" reason="${request.reasonCode}" ` +
        `source="${request.sourceKey}" epoch=${newLedgerEpoch}`,
      );

      this.triggerReconciliation(request.logicalJobKey).catch(e =>
        console.warn("[Coordinator] Reconciliation after clearHold failed:", e.message),
      );

      return true;
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Write global_outbound holds for all outbound-gated logical keys.
   * Called by OutboundControlService on pause. Runs inside the same client
   * transaction by using an external client passed in.
   */
  async writeGlobalOutboundHolds(
    client: import("pg").PoolClient,
    sourceEpoch: bigint,
    actor: string,
    correlationId?: string,
  ): Promise<void> {
    const { getOutboundGatedKeys } = await import("./logical-job-manifest");
    const keys = getOutboundGatedKeys();

    const epochResult = await client.query<{ max_epoch: string | null }>(
      `SELECT MAX(ledger_epoch)::text AS max_epoch FROM logical_job_control_holds`,
    );
    const currentLedgerEpoch = epochResult.rows[0]?.max_epoch
      ? BigInt(epochResult.rows[0].max_epoch)
      : 0n;

    let ledgerEpoch = currentLedgerEpoch + 1n;

    for (const key of keys) {
      const holdResult = await client.query<{ hold_id: string }>(
        `INSERT INTO logical_job_control_holds
           (logical_job_key, reason_code, source_type, source_key, source_epoch,
            ledger_epoch, active, activated_at, updated_at)
         VALUES ($1, 'global_outbound', 'system', 'pause-authority', $2, $3, true, NOW(), NOW())
         ON CONFLICT (logical_job_key, reason_code, source_key) WHERE active = true
         DO UPDATE SET
           source_epoch = EXCLUDED.source_epoch,
           ledger_epoch = EXCLUDED.ledger_epoch,
           updated_at   = NOW()
         RETURNING hold_id`,
        [key, sourceEpoch.toString(), ledgerEpoch.toString()],
      );

      const holdId = holdResult.rows[0]?.hold_id ?? "unknown";
      await client.query(
        `INSERT INTO logical_job_hold_events
           (hold_id, event_type, logical_job_key, reason_code, source_key, ledger_epoch, actor, correlation_id)
         VALUES ($1, 'activated', $2, 'global_outbound', 'pause-authority', $3, $4, $5)`,
        [holdId, key, ledgerEpoch.toString(), actor, correlationId ?? null],
      );

      ledgerEpoch++;
    }

    console.log(
      `[Coordinator] Global-outbound holds written for ${keys.length} logical job keys (epoch=${sourceEpoch})`,
    );
  }

  /**
   * Transition global_outbound holds to release_pending on unpause.
   * Does NOT delete global_outbound holds immediately.
   * Mixed handlers remain blocked until staged-release approval.
   * Called from OutboundControlService.applyPauseMutation() within the unpause transaction.
   */
  async transitionGlobalHoldsToReleasePending(
    client: import("pg").PoolClient,
    actor: string,
    correlationId?: string,
  ): Promise<void> {
    const { getOutboundGatedKeys } = await import("./logical-job-manifest");
    const keys = getOutboundGatedKeys();

    const epochResult = await client.query<{ max_epoch: string | null }>(
      `SELECT MAX(ledger_epoch)::text AS max_epoch FROM logical_job_control_holds`,
    );
    const currentLedgerEpoch = epochResult.rows[0]?.max_epoch
      ? BigInt(epochResult.rows[0].max_epoch)
      : 0n;

    let ledgerEpoch = currentLedgerEpoch + 1n;

    for (const key of keys) {
      // Release the global_outbound hold (if any)
      const releaseResult = await client.query<{ hold_id: string }>(
        `UPDATE logical_job_control_holds
         SET active = false, released_at = NOW(), ledger_epoch = $1, updated_at = NOW()
         WHERE logical_job_key = $2 AND reason_code = 'global_outbound'
           AND source_key = 'pause-authority' AND active = true
         RETURNING hold_id`,
        [ledgerEpoch.toString(), key],
      );

      if (releaseResult.rows.length > 0) {
        await client.query(
          `INSERT INTO logical_job_hold_events
             (hold_id, event_type, logical_job_key, reason_code, source_key, ledger_epoch, actor, correlation_id)
           VALUES ($1, 'released', $2, 'global_outbound', 'pause-authority', $3, $4, $5)`,
          [releaseResult.rows[0].hold_id, key, ledgerEpoch.toString(), actor, correlationId ?? null],
        );
        ledgerEpoch++;
      }

      // Add a release_pending hold to block queue release until staged-release approval
      const pendingResult = await client.query<{ hold_id: string }>(
        `INSERT INTO logical_job_control_holds
           (logical_job_key, reason_code, source_type, source_key,
            ledger_epoch, active, activated_at, updated_at)
         VALUES ($1, 'release_pending', 'system', 'unpause-transition', $2, true, NOW(), NOW())
         ON CONFLICT (logical_job_key, reason_code, source_key) WHERE active = true
         DO UPDATE SET ledger_epoch = EXCLUDED.ledger_epoch, updated_at = NOW()
         RETURNING hold_id`,
        [key, ledgerEpoch.toString()],
      );

      if (pendingResult.rows.length > 0) {
        await client.query(
          `INSERT INTO logical_job_hold_events
             (hold_id, event_type, logical_job_key, reason_code, source_key, ledger_epoch, actor, correlation_id)
           VALUES ($1, 'activated', $2, 'release_pending', 'unpause-transition', $3, $4, $5)`,
          [pendingResult.rows[0].hold_id, key, ledgerEpoch.toString(), actor, correlationId ?? null],
        );
        ledgerEpoch++;
      }
    }

    console.log(
      `[Coordinator] Global-outbound holds transitioned to release_pending for ${keys.length} keys`,
    );
  }

  /**
   * Approve staged release: clear release_pending holds for given keys (or all).
   * Admin-only action — not called automatically on unpause.
   */
  async approveRelease(
    logicalJobKeys: string[] | "all",
    actor: string,
    correlationId?: string,
  ): Promise<number> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `SELECT pg_advisory_xact_lock($1)`,
        [Number(COORDINATOR_LOCK_KEY % BigInt(Number.MAX_SAFE_INTEGER))],
      );

      const epochResult = await client.query<{ max_epoch: string | null }>(
        `SELECT MAX(ledger_epoch)::text AS max_epoch FROM logical_job_control_holds`,
      );
      const currentLedgerEpoch = epochResult.rows[0]?.max_epoch
        ? BigInt(epochResult.rows[0].max_epoch)
        : 0n;
      const newLedgerEpoch = currentLedgerEpoch + 1n;

      let updateResult: { rows: Array<{ hold_id: string; logical_job_key: string }> };
      if (logicalJobKeys === "all") {
        updateResult = await client.query<{ hold_id: string; logical_job_key: string }>(
          `UPDATE logical_job_control_holds
           SET active = false, released_at = NOW(), ledger_epoch = $1, updated_at = NOW()
           WHERE reason_code = 'release_pending' AND active = true
           RETURNING hold_id, logical_job_key`,
          [newLedgerEpoch.toString()],
        );
      } else {
        updateResult = await client.query<{ hold_id: string; logical_job_key: string }>(
          `UPDATE logical_job_control_holds
           SET active = false, released_at = NOW(), ledger_epoch = $1, updated_at = NOW()
           WHERE reason_code = 'release_pending' AND active = true
             AND logical_job_key = ANY($2)
           RETURNING hold_id, logical_job_key`,
          [newLedgerEpoch.toString(), logicalJobKeys],
        );
      }

      for (const row of updateResult.rows) {
        await client.query(
          `INSERT INTO logical_job_hold_events
             (hold_id, event_type, logical_job_key, reason_code, source_key, ledger_epoch, actor, correlation_id)
           VALUES ($1, 'released', $2, 'release_pending', 'unpause-transition', $3, $4, $5)`,
          [row.hold_id, row.logical_job_key, newLedgerEpoch.toString(), actor, correlationId ?? null],
        );
      }

      await client.query("COMMIT");

      const count = updateResult.rows.length;
      console.log(`[Coordinator] Staged release approved: ${count} release_pending holds cleared by ${actor}`);
      return count;
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  }

  // ── Physical queue reconciliation ────────────────────────────────────────

  /**
   * Reconcile physical BullMQ queue state for queues affected by a logical job key.
   * Only queues that are fully dedicated to outbound-blocked jobs get physically paused.
   * Returns 'applied' only after queue.isPaused() readback matches desired state.
   */
  async triggerReconciliation(logicalJobKey: string): Promise<ReconciliationResult[]> {
    if (!this._queueManager) {
      console.log("[Coordinator] QueueManager not set — skipping physical reconciliation");
      return [];
    }

    const results: ReconciliationResult[] = [];

    // For Phase 4: only WINBACK_OUTREACH gets physical actuation.
    // Other queues use logical gates at the handler level (Phase 3).
    const PHYSICAL_ACTUATION_QUEUES = new Set(["winback-outreach"]);

    const { LOGICAL_JOB_MANIFEST } = await import("./logical-job-manifest");
    const affectedQueues = new Set<string>();

    for (const entry of LOGICAL_JOB_MANIFEST) {
      if (
        entry.logicalKey === logicalJobKey &&
        PHYSICAL_ACTUATION_QUEUES.has(entry.physicalQueue as string)
      ) {
        affectedQueues.add(entry.physicalQueue as string);
      }
    }

    for (const queueName of affectedQueues) {
      const result = await this.reconcileQueue(queueName);
      results.push(result);
    }

    return results;
  }

  /**
   * Reconcile a single physical queue against the hold ledger.
   * Steps:
   *   1. Compute desired state from active holds for all logical jobs on this queue.
   *   2. Commit desired state + epoch to queue_reconciliation_state BEFORE Redis action.
   *   3. Issue Redis pause/resume.
   *   4. Readback queue.isPaused() and update observed state.
   *   5. Return 'applied' only when readback matches desired at current epoch.
   */
  async reconcileQueue(physicalQueue: string): Promise<ReconciliationResult> {
    const client = await pool.connect();
    try {
      // Step 1: compute desired state
      const { LOGICAL_JOB_MANIFEST } = await import("./logical-job-manifest");
      const queueKeys = LOGICAL_JOB_MANIFEST
        .filter(e => e.physicalQueue === physicalQueue && !e.canRunWhileGlobalOutboundPaused)
        .map(e => e.logicalKey);

      let shouldPause = false;
      for (const key of queueKeys) {
        const holds = await this.getActiveHoldsForKey(key);
        if (holds.length > 0) {
          shouldPause = true;
          break;
        }
      }

      const desiredState: "paused" | "running" = shouldPause ? "paused" : "running";

      // Step 2: get current epoch and commit desired state to DB first
      await client.query("BEGIN");
      await client.query(
        `SELECT pg_advisory_xact_lock($1)`,
        [Number(COORDINATOR_LOCK_KEY % BigInt(Number.MAX_SAFE_INTEGER))],
      );

      const epochResult = await client.query<{ desired_epoch: string | null }>(
        `SELECT desired_epoch::text FROM queue_reconciliation_state WHERE physical_queue = $1`,
        [physicalQueue],
      );
      const currentEpoch = epochResult.rows[0]?.desired_epoch
        ? BigInt(epochResult.rows[0].desired_epoch)
        : 0n;
      const newEpoch = currentEpoch + 1n;

      await client.query(
        `INSERT INTO queue_reconciliation_state
           (physical_queue, desired_state, desired_epoch, last_attempt_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         ON CONFLICT (physical_queue) DO UPDATE
           SET desired_state   = EXCLUDED.desired_state,
               desired_epoch   = EXCLUDED.desired_epoch,
               last_attempt_at = NOW(),
               updated_at      = NOW()`,
        [physicalQueue, desiredState, newEpoch.toString()],
      );

      await client.query("COMMIT");

      // Step 3: Issue Redis pause/resume
      let redisError: string | null = null;
      try {
        const queue = this._queueManager.getQueue(physicalQueue);
        if (!queue) {
          throw new Error(`Queue not found: ${physicalQueue}`);
        }
        if (desiredState === "paused") {
          await queue.pause();
        } else {
          await queue.resume();
        }
      } catch (redisErr: any) {
        redisError = redisErr.message;
        console.error(
          `[Coordinator] Redis ${desiredState} failed for queue "${physicalQueue}": ${redisErr.message}`,
        );
      }

      // Step 4: Readback observed state
      let observedState: "paused" | "running" | "unknown" = "unknown";
      let outcome: ReconciliationOutcome = "degraded";
      try {
        const queue = this._queueManager.getQueue(physicalQueue);
        if (queue) {
          const isPaused = await queue.isPaused();
          observedState = isPaused ? "paused" : "running";
          outcome = observedState === desiredState ? "applied" : "pending";
        }
      } catch (readbackErr: any) {
        console.warn(
          `[Coordinator] Readback failed for queue "${physicalQueue}": ${readbackErr.message}`,
        );
        outcome = redisError ? "degraded" : "pending";
      }

      // Step 5: Update observed state in DB
      await client.query(
        `UPDATE queue_reconciliation_state
         SET observed_state  = $1,
             observed_epoch  = $2,
             reconciled_at   = NOW(),
             last_error      = $3,
             updated_at      = NOW()
         WHERE physical_queue = $4`,
        [
          observedState === "unknown" ? null : observedState,
          newEpoch.toString(),
          redisError,
          physicalQueue,
        ],
      );

      const result: ReconciliationResult = {
        physicalQueue,
        desiredState,
        observedState,
        outcome,
        desiredEpoch: newEpoch,
        observedEpoch: newEpoch,
        error: redisError,
      };

      console.log(
        `[Coordinator] Reconcile queue="${physicalQueue}" desired=${desiredState} ` +
        `observed=${observedState} outcome=${outcome} epoch=${newEpoch}`,
      );

      return result;
    } catch (err: any) {
      try { await client.query("ROLLBACK"); } catch { /* ignore */ }
      console.error(`[Coordinator] reconcileQueue("${physicalQueue}") failed: ${err.message}`);
      return {
        physicalQueue,
        desiredState: "running",
        observedState: "unknown",
        outcome: "degraded",
        desiredEpoch: 0n,
        observedEpoch: null,
        error: err.message,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Sweep expired holds and trigger reconciliation for affected queues.
   * Called periodically (e.g. every 5 minutes).
   */
  async sweepExpiredHolds(): Promise<number> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `SELECT pg_advisory_xact_lock($1)`,
        [Number(COORDINATOR_LOCK_KEY % BigInt(Number.MAX_SAFE_INTEGER))],
      );

      const epochResult = await client.query<{ max_epoch: string | null }>(
        `SELECT MAX(ledger_epoch)::text AS max_epoch FROM logical_job_control_holds`,
      );
      const currentLedgerEpoch = epochResult.rows[0]?.max_epoch
        ? BigInt(epochResult.rows[0].max_epoch)
        : 0n;
      const newLedgerEpoch = currentLedgerEpoch + 1n;

      const expiredResult = await client.query<{ hold_id: string; logical_job_key: string; reason_code: string; source_key: string }>(
        `UPDATE logical_job_control_holds
         SET active = false, released_at = NOW(), ledger_epoch = $1, updated_at = NOW()
         WHERE active = true AND expires_at IS NOT NULL AND expires_at <= NOW()
         RETURNING hold_id, logical_job_key, reason_code, source_key`,
        [newLedgerEpoch.toString()],
      );

      const affectedKeys = new Set<string>();
      for (const row of expiredResult.rows) {
        affectedKeys.add(row.logical_job_key);
        await client.query(
          `INSERT INTO logical_job_hold_events
             (hold_id, event_type, logical_job_key, reason_code, source_key, ledger_epoch)
           VALUES ($1, 'expired', $2, $3, $4, $5)`,
          [row.hold_id, row.logical_job_key, row.reason_code, row.source_key, newLedgerEpoch.toString()],
        );
      }

      await client.query("COMMIT");

      if (expiredResult.rows.length > 0) {
        console.log(`[Coordinator] Swept ${expiredResult.rows.length} expired hold(s)`);
        for (const key of affectedKeys) {
          this.triggerReconciliation(key).catch(e =>
            console.warn("[Coordinator] Reconciliation after expiry sweep failed:", e.message),
          );
        }
      }

      return expiredResult.rows.length;
    } catch (err: any) {
      try { await client.query("ROLLBACK"); } catch { /* ignore */ }
      console.warn(`[Coordinator] sweepExpiredHolds failed: ${err.message}`);
      return 0;
    } finally {
      client.release();
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const outboundQueueCoordinator = new OutboundQueueCoordinator();

/**
 * Convenience re-export: can the given logical job execute?
 * Used by workers: await canExecute("logical-key") || return early.
 */
export async function canExecute(logicalJobKey: string): Promise<boolean> {
  return outboundQueueCoordinator.canExecute(logicalJobKey);
}
