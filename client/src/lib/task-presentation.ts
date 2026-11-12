/**
 * Pure task presentation rules shared by desktop Work and the mobile task list:
 * the verb a control performs (never the status it produces), the separate
 * "no work exists" and "no matching work" states, and exact links to the
 * records a task is about. Navigation metadata never authorizes anything; each
 * destination still authorizes its own record.
 */
export type TaskLinkSubject = { dealId?: number | null; contactId?: number | null; ticketId?: number | null };

export function taskActionVerb(status: string | null | undefined): { verb: string; next: "in_progress" | "completed" } | null {
  if (status === "pending") return { verb: "Start task", next: "in_progress" };
  if (status === "in_progress") return { verb: "Mark complete", next: "completed" };
  return null;
}

export type TaskRelatedLink = { kind: "contact" | "deal" | "ticket"; label: string; href: string };

export function taskRelatedLinks(task: TaskLinkSubject): TaskRelatedLink[] {
  const valid = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n > 0 && n <= 2147483647;
  const links: TaskRelatedLink[] = [];
  if (valid(task.contactId)) links.push({ kind: "contact", label: `Contact #${task.contactId}`, href: `/dashboard/contacts/${task.contactId}` });
  if (valid(task.dealId)) links.push({ kind: "deal", label: `Deal #${task.dealId}`, href: `/dashboard/pipeline?id=${task.dealId}` });
  if (valid(task.ticketId)) links.push({ kind: "ticket", label: `Ticket #${task.ticketId}`, href: `/dashboard/tickets?id=${task.ticketId}` });
  return links;
}

export type TaskEmptyState =
  | { kind: "none_exist"; title: string; detail: string }
  | { kind: "no_match"; title: string; detail: string; canClear: true };

/** `loaded` is what the authorized reader returned; `matching` is what survives the current filters. Null when rows exist. */
export function taskEmptyState(loaded: number, matching: number): TaskEmptyState | null {
  if (matching > 0) return null;
  if (loaded === 0) {
    return { kind: "none_exist", title: "No tasks yet", detail: "No tasks are assigned to you or visible to your role. Create one to start tracking work and deadlines." };
  }
  return {
    kind: "no_match", canClear: true,
    title: "No tasks match these filters",
    detail: `${loaded} ${loaded === 1 ? "task is" : "tasks are"} loaded but none match the current status, due or source filter. Clear the filters to see them.`,
  };
}
