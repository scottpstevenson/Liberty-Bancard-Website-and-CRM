type TaskSourceLike = {
  source?: string | null;
};

import { legacyTaskStatusToAuthorityState } from "@shared/work-item-commands";
import type { Task } from "@shared/schema";

/** Consume the existing reader's effective state, not an independent work rule. */
export function taskPresentationState(task: {
  effectiveState?: unknown; authorityState?: string | null; status?: string | null;
}) {
  const state = task.effectiveState ?? task.authorityState ?? legacyTaskStatusToAuthorityState(task.status);
  if (state !== "open" && state !== "in_progress" && state !== "completed" && state !== "cancelled") {
    throw new Error("Effective task state unavailable. Reload the authorized work reader.");
  }
  return state;
}

export function isPendingTask(task: Parameters<typeof taskPresentationState>[0]) {
  const state = taskPresentationState(task);
  return state === "open" || state === "in_progress";
}

export function decodeTaskRows(value: unknown): Task[] {
  if (!Array.isArray(value) || !value.every(task => task && Number.isSafeInteger(task.id) && task.id > 0 &&
    typeof task.title === "string" && typeof task.status === "string" && Number.isInteger(task.authorityFence))) {
    throw new Error("Invalid authorized task collection");
  }
  for (const task of value) taskPresentationState(task);
  return value;
}

// Temporary: uses the schema-backed `source` column added in #927.
// Returns true only for tasks explicitly written by the SLA worker.
export function isSlaGeneratedTask(
  task: TaskSourceLike | null | undefined
): boolean {
  return task?.source === "sla";
}
