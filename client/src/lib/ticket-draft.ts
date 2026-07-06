// Per-ticket reply draft persistence (Task #767). Scoped tightly to
// { ticketId, draftBody, updatedAt } — no auth tokens, no unrelated ticket
// metadata — so an AI-inserted or hand-typed reply survives navigating away
// from a ticket and back, instead of disappearing silently. Extracted from
// Tickets.tsx so the pure storage logic can be exercised by an automated
// regression test (scripts/test-ticket-drafts.ts) without mounting React.

export interface TicketDraftRecord {
  ticketId: number;
  draftBody: string;
  updatedAt: string;
}

export function ticketDraftStorageKey(ticketId: number): string {
  return `ticket-reply-draft:${ticketId}`;
}

export function loadTicketDraft(ticketId: number): string {
  try {
    const raw = window.localStorage.getItem(ticketDraftStorageKey(ticketId));
    if (!raw) return "";
    const parsed = JSON.parse(raw) as TicketDraftRecord;
    if (parsed && parsed.ticketId === ticketId && typeof parsed.draftBody === "string") {
      return parsed.draftBody;
    }
    return "";
  } catch {
    return "";
  }
}

export function saveTicketDraft(ticketId: number, draftBody: string): void {
  try {
    if (!draftBody.trim()) {
      window.localStorage.removeItem(ticketDraftStorageKey(ticketId));
      return;
    }
    window.localStorage.setItem(
      ticketDraftStorageKey(ticketId),
      JSON.stringify({ ticketId, draftBody, updatedAt: new Date().toISOString() } satisfies TicketDraftRecord)
    );
  } catch {
    // localStorage unavailable (private browsing, quota, etc.) — draft
    // persistence is a UX improvement, so fail silently rather than break the reply flow.
  }
}

export function clearTicketDraft(ticketId: number): void {
  try {
    window.localStorage.removeItem(ticketDraftStorageKey(ticketId));
  } catch {
    // no-op
  }
}
