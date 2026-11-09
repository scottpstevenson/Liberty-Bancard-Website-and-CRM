/**
 * Per-effect durable steps for one public support request.
 *
 * Support is not a sales occurrence and does not join the sales recovery list. Its effects run in a fixed order, and each
 * one is individually idempotent for the request, so a retry of the same key after a partial failure resumes instead of
 * creating a second ticket, comment or notification:
 *
 *   1. contact  - bound to the occurrence as soon as it exists
 *   2. ticket   - authority ticket keyed by the request-derived command key (`inbound:<id>:ticket`)
 *   3. receipt  - ONE factual customer-visible comment, deduplicated by a ticket-scoped existence check under a
 *                 ticket-level advisory lock (ticket_comments has no key column and none is added)
 *   4. notice   - ONE internal notification keyed `inbound:<id>:support-notification`
 *   5. accept   - canonical authority acceptance (links the ticket, SLA evidence)
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { ticketComments, tickets, type Ticket } from "@shared/schema";
import { inboundShortRef } from "./inbound-request-authority";

export const SUPPORT_RECEIPT_AUTHOR = "Liberty Bancard Support";
export const SUPPORT_PHONE_DISPLAY = "954-266-8214";

/**
 * Factual receipt wording. It states what is true when the request is saved: it was received, it has a reference, and
 * where urgent or sensitive items should go. It makes no response-time, staffing, "already reviewing" or priority claim.
 */
export function supportReceiptText(requestId: string): string {
  const ref = inboundShortRef(requestId);
  return [
    `Receipt: we received your support request (reference ${ref}). A member of our team will review it and follow up using the contact details you gave us.`,
    `If your terminal is completely down and you cannot take payments, you can also call ${SUPPORT_PHONE_DISPLAY}.`,
    "Please do not send full card numbers or bank login details in a request or by email.",
  ].join("\n\n");
}

/** The authority ticket already written for this request (null when the ticket step has not committed). */
export async function findSupportTicket(requestId: string): Promise<Ticket | null> {
  const [ticket] = await db.select().from(tickets).where(eq(tickets.commandKey, `inbound:${requestId}:ticket`)).limit(1);
  return ticket ?? null;
}

/**
 * Write the single receipt comment for this request's ticket. The check and the insert share one transaction that holds a
 * ticket-scoped advisory lock, so two concurrent re-entries cannot both pass the check. The match is the exact
 * request-derived text, so a human comment (or any other comment) never suppresses the receipt.
 */
export async function ensureSupportReceiptComment(requestId: string, ticketId: number): Promise<{ created: boolean }> {
  const content = supportReceiptText(requestId);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`support-receipt:${ticketId}`}))`);
    const [existing] = await tx.select({ id: ticketComments.id }).from(ticketComments).where(and(
      eq(ticketComments.ticketId, ticketId),
      eq(ticketComments.authorName, SUPPORT_RECEIPT_AUTHOR),
      eq(ticketComments.content, content),
    )).limit(1);
    if (existing) return { created: false };
    await tx.insert(ticketComments).values({ ticketId, content, authorName: SUPPORT_RECEIPT_AUTHOR, isInternal: false });
    return { created: true };
  });
}
