import type { Task, PublicTaskUpdateInput } from "@shared/schema";

const COMPLETION_STATUSES = new Set(["completed", "done", "resolved"]);

/**
 * Canonical completion/reopen normalization for task updates.
 *
 * Rules:
 * 1. Completing a task (status → any completion status) without an explicit
 *    completedAt → set completedAt = now.
 * 2. Reopening a task (status → any NON-completion status) when the task has a
 *    completedAt and the update does not explicitly provide completedAt
 *    → clear completedAt (set to null).
 *    NOTE: The rule applies to ALL non-completion statuses ("reopened",
 *    "in-progress", "pending", custom values, etc.) — not just an allowlist —
 *    so that completedAt is never left populated on an active task regardless
 *    of which status string the caller uses.
 * 3. If completedAt is explicitly provided in the update → respect it as-is.
 *
 * This function must be called by EVERY writer that changes task status or
 * completedAt, so that the partial unique index invariant (completed_at IS NULL
 * for active SLA tasks) is never bypassed.
 */
export function normalizeTaskCompletionState(
  update: PublicTaskUpdateInput,
  existing: Pick<Task, "status" | "completedAt">,
): PublicTaskUpdateInput {
  const result = { ...update };

  const completedAtExplicit = "completedAt" in update;
  const newStatus = update.status;

  if (newStatus !== undefined) {
    if (newStatus && COMPLETION_STATUSES.has(newStatus)) {
      if (!completedAtExplicit) {
        result.completedAt = new Date();
      }
    } else {
      // Any non-completion status: clear completedAt if the task was previously
      // completed and the update does not explicitly supply a completedAt value.
      if (existing.completedAt && !completedAtExplicit) {
        result.completedAt = null;
      }
    }
  }

  return result;
}
