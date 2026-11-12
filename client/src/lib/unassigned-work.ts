/**
 * Pure rules for the unassigned-work queue shared by Work (tasks) and Support (tickets).
 *
 * Nothing here assigns anything. An unassigned record is shown with its precise review blocker, and a single-record claim
 * goes through the existing fenced work-command edit (`expectedFence`, retained command id, actor binding). Whether a claim is
 * accepted is decided by that authority (linked-contact ownership, eligible account, current version); the screen reports its
 * answer verbatim instead of inventing an assignment policy.
 */
export type WorkOwnerSubject = { assignedTo?: string | null; canonicalAssignee?: string | null };

export function workOwner(row: WorkOwnerSubject): string | null {
  const owner = (row.canonicalAssignee ?? row.assignedTo ?? "").trim();
  return owner ? owner : null;
}

export const isUnassignedWork = (row: WorkOwnerSubject) => workOwner(row) === null;

/** Only management roles claim from the queue; the server still decides each claim. */
export function canClaimUnassignedWork(role: string | null | undefined) {
  return role === "admin" || role === "manager";
}

export const UNASSIGNED_POLICY_NOTE =
  "Nothing is assigned automatically and no assignment policy is applied here. Claim one record at a time, or assign it from Edit; the record's linked contact owner and current version still decide whether the change is accepted.";

/** A conflict from the fenced command is an answer, not a failure to retry blindly. */
export function claimConflictMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "";
  const body = raw.replace(/^\d{3}:\s*/, "");
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    if (typeof parsed.message === "string" && parsed.message) return parsed.message;
  } catch { /* not JSON */ }
  return body || "The claim was not accepted. Reload the queue and try again.";
}

export type UnassignedSummary = { unassigned: number; unassignedOverdue: number; loaded: number };

/** Counts over the rows the authorized reader returned; they describe loaded work, never a global total. */
export function summarizeUnassigned<T extends WorkOwnerSubject>(rows: readonly T[], isOverdue: (row: T) => boolean): UnassignedSummary {
  let unassigned = 0, unassignedOverdue = 0;
  for (const row of rows) {
    if (!isUnassignedWork(row)) continue;
    unassigned += 1;
    if (isOverdue(row)) unassignedOverdue += 1;
  }
  return { unassigned, unassignedOverdue, loaded: rows.length };
}

/** The visible review blocker for a record that has no owner. */
export function unassignedBlocker(kind: "task" | "ticket", links: { contactId?: number | null; dealId?: number | null; ticketId?: number | null }): string {
  if (links.contactId || links.dealId || links.ticketId) {
    return `This ${kind} has no owner. It is linked to another record, so only that record's current owner can be assigned until an approved ownership handoff is recorded.`;
  }
  return `This ${kind} has no owner and no linked record. A manager or administrator must claim or assign it.`;
}
