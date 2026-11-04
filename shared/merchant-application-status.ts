/**
 * Merchant application status graph — single source for the server service and the operator UI
 * (S5-03). Operator actions are derived from this graph, never hard-coded in the client.
 */
export const MERCHANT_APPLICATION_STATUSES = [
  "draft", "in_progress", "submitted", "under_review", "approved", "declined", "withdrawn",
] as const;

export const STATUS_TRANSITIONS: Record<string, ReadonlySet<string>> = {
  draft: new Set(["in_progress", "submitted", "withdrawn"]),
  in_progress: new Set(["submitted", "withdrawn"]),
  submitted: new Set(["under_review", "declined", "withdrawn"]),
  under_review: new Set(["approved", "declined"]),
  approved: new Set(),
  declined: new Set(),
  withdrawn: new Set(),
};

export const TERMINAL_APPLICATION_STATUSES: ReadonlySet<string> = new Set(["approved", "declined", "withdrawn"]);

export function canTransition(from: string, to: string): boolean {
  const allowed = STATUS_TRANSITIONS[from];
  return !!allowed && allowed.has(to);
}

/** Draft semantics: both `draft` and `in_progress` are unsubmitted drafts. */
export const DRAFT_STATUSES: readonly string[] = ["draft", "in_progress"];

/** Maps a list filter value to the concrete statuses it covers. */
export function statusesForFilter(filter: string): string[] {
  return filter === "draft" ? [...DRAFT_STATUSES] : [filter];
}
