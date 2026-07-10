type TaskSourceLike = {
  source?: string | null;
};

// Temporary: uses the schema-backed `source` column added in #927.
// Returns true only for tasks explicitly written by the SLA worker.
export function isSlaGeneratedTask(
  task: TaskSourceLike | null | undefined
): boolean {
  return task?.source === "sla";
}
