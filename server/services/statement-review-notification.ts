import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { notifications } from "@shared/schema";
import { ensureOccurrenceNotification } from "./public-sales-occurrence";
import { inboundShortRef } from "./inbound-request-authority";

/**
 * The single internal notification for one statement occurrence.
 *
 * Identity is the request-derived command key owned by `ensureOccurrenceNotification`, so the public handler, a
 * worker run and a recovery can all call this and exactly one row exists. It carries no statement content, file name
 * or financial figure: only the business name, the short reference the merchant was shown, and a link to the existing
 * Inbound Operations review surface (never a retired deal URL).
 *
 * Audience is the management default bound by the notification authority (no recipient, no typed target).
 */

export type StatementProcessingState = "queued" | "needs_attention";

export const STATEMENT_NEEDS_ATTENTION_LABEL = "Processing needs attention";

export function statementReviewLink(requestId: string): string {
  return `/dashboard/lead-ops?tab=pipeline&ref=${inboundShortRef(requestId)}`;
}

function copy(input: { requestId: string; business: string | null; state: StatementProcessingState }) {
  const ref = inboundShortRef(input.requestId);
  const who = input.business?.trim() || "A merchant";
  return {
    title: `New statement upload — ${input.business?.trim() || "business name not provided"}`,
    message: input.state === "needs_attention"
      ? `${who} uploaded a processing statement (reference ${ref}). ${STATEMENT_NEEDS_ATTENTION_LABEL}: the file is safely retained, review work is open, and automatic processing has not started.`
      : `${who} uploaded a processing statement (reference ${ref}). Review it from Inbound Operations.`,
  };
}

export async function ensureStatementOccurrenceNotification(input: {
  requestId: string;
  contactId: number;
  dealId?: number | null;
  business: string | null;
  state: StatementProcessingState;
}): Promise<{ id: number }> {
  const text = copy(input);
  return ensureOccurrenceNotification(input.requestId, {
    channel: "internal",
    title: text.title,
    message: text.message,
    type: "alert",
    metadata: {
      eventType: "statement_uploaded",
      requestId: input.requestId,
      shortRef: inboundShortRef(input.requestId),
      // No contactId/dealId here on purpose: a typed target would hide the notification for an unclassified or unlinked
      // contact, and the review surface shows the contact and deal links under its own authority.
      processingState: input.state,
      link: statementReviewLink(input.requestId),
    },
  });
}

/**
 * Keeps the one notification truthful when processing state changes (for example after a recovery re-drive): the
 * warning is removed only when the command really reached a consumer. Never creates a row and never reads financial data.
 */
export async function settleStatementNotificationState(input: {
  requestId: string;
  business: string | null;
  state: StatementProcessingState;
}): Promise<boolean> {
  const commandKey = `inbound:${input.requestId}:sales-notification`;
  const text = copy(input);
  const [row] = await db.select({ id: notifications.id, metadata: notifications.metadata }).from(notifications)
    .where(and(eq(notifications.commandKey, commandKey), eq(notifications.inboundRequestId, input.requestId))).limit(1);
  if (!row) return false;
  await db.update(notifications).set({
    message: text.message,
    metadata: { ...((row.metadata as Record<string, unknown> | null) ?? {}), processingState: input.state },
  }).where(eq(notifications.id, row.id));
  return true;
}
