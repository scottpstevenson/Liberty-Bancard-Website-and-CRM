import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { pool } from "../db";

/**
 * Due-run ownership (Stage 4C2). A waiting workflow run is resumed only by the worker that holds its lease; a second
 * worker (or a retry after a crash) cannot resume the same run while the lease is live, and an expired lease can be
 * re-claimed. Resumption is further guarded by the definition pin and by the per-step send receipts, so a re-claimed run
 * never re-sends a delivered step.
 */
export interface ClaimedWorkflowRun { id: number; workflowId: number; entityType: string | null; entityId: number | null; currentStep: number; leaseToken: string }

export const WORKFLOW_RUN_LEASE_MS = 10 * 60_000;

export async function claimDueWorkflowRuns(limit = 25, leaseMs = WORKFLOW_RUN_LEASE_MS): Promise<ClaimedWorkflowRun[]> {
  const token = randomUUID();
  const { rows } = await pool.query(
    `UPDATE workflow_runs SET lease_token = $1, lease_expires_at = now() + ($2::int * interval '1 millisecond')
      WHERE id IN (
        SELECT id FROM workflow_runs
         WHERE status = 'waiting' AND next_run_at <= now() AND (lease_expires_at IS NULL OR lease_expires_at < now())
         ORDER BY next_run_at, id LIMIT $3 FOR UPDATE SKIP LOCKED)
      RETURNING id, workflow_id, entity_type, entity_id, current_step`,
    [token, leaseMs, limit]);
  return rows.map(r => ({
    id: r.id, workflowId: r.workflow_id, entityType: r.entity_type, entityId: r.entity_id,
    currentStep: r.current_step ?? 0, leaseToken: token,
  }));
}

export async function releaseWorkflowRunLease(runId: number, token: string): Promise<void> {
  await pool.query(
    `UPDATE workflow_runs SET lease_token = NULL, lease_expires_at = NULL WHERE id = $1 AND lease_token = $2`, [runId, token],
  ).catch(err => console.error("[Workflow] could not release run lease:", err instanceof Error ? err.message : err));
}

/** Pin of the workflow definition a run was created against; a resume against a changed definition is refused. */
export function workflowDefinitionPin(actions: unknown): string {
  return createHash("sha256").update(JSON.stringify(actions ?? [])).digest("hex");
}

/**
 * Fence: extends the lease only while this token still owns the run and the lease has not lapsed. False means another
 * worker may now own the run; the caller must stop and write nothing further for it.
 */
export async function renewWorkflowRunLease(runId: number, token: string, leaseMs = WORKFLOW_RUN_LEASE_MS): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE workflow_runs SET lease_expires_at = now() + ($3::int * interval '1 millisecond')
      WHERE id = $1 AND lease_token = $2 AND lease_expires_at > now()`, [runId, token, leaseMs]);
  return (rowCount ?? 0) === 1;
}

/** Initial runs that were interrupted (process died while running, lease lapsed) are parked visibly for review, never auto-resumed. */
export async function parkInterruptedWorkflowRuns(): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE workflow_runs SET status = 'blocked', completed_at = now(), lease_token = NULL, lease_expires_at = NULL,
            log = COALESCE(log, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('action','interrupted','status','blocked',
              'reason','run_interrupted_requires_review','timestamp', to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"')))
      WHERE status = 'running' AND occurrence_key IS NOT NULL AND lease_expires_at IS NOT NULL AND lease_expires_at < now()`);
  return rowCount ?? 0;
}
