/**
 * The ticket cohort predicate shared by Reports (which counts it) and Support (which lists it), so a count and the list it
 * opens use one definition. `open` is every ticket that is not Resolved or Closed, matching the analytics aggregate;
 * `breached` is an open ticket whose SLA deadline is before `asOf`.
 */
import type { ticketSlaFilters, ticketStateFilters } from "./crm-destination-state";

export type TicketCohort = { state: typeof ticketStateFilters[number]; sla: typeof ticketSlaFilters[number] };
type CohortTicket = { status?: string | null; slaDeadline?: string | Date | null };

const CLOSED = new Set(["Resolved", "Closed"]);
export const isOpenTicket = (ticket: CohortTicket) => !CLOSED.has(ticket.status ?? "New Ticket");

export function ticketInCohort(ticket: CohortTicket, cohort: TicketCohort, asOf: Date): boolean {
  const open = isOpenTicket(ticket);
  if (cohort.state === "open" && !open) return false;
  if (cohort.state === "resolved" && open) return false;
  if (cohort.sla === "breached") {
    if (!open || !ticket.slaDeadline) return false;
    const deadline = new Date(ticket.slaDeadline).getTime();
    if (!Number.isFinite(deadline) || deadline >= asOf.getTime()) return false;
  }
  return true;
}

export function ticketCohortLabel(cohort: TicketCohort): string | null {
  if (cohort.state === "all" && cohort.sla === "all") return null;
  if (cohort.sla === "breached") return "Open tickets past their SLA deadline";
  return cohort.state === "open" ? "Open tickets (not Resolved or Closed)" : "Resolved and Closed tickets";
}
