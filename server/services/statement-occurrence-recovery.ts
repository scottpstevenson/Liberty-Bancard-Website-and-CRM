import { eq } from "drizzle-orm";
import { db } from "../db";
import { contacts, inboundRequests } from "@shared/schema";
import { storage } from "../storage";
import { orchestrateInboundRequest, setInboundRequestLifecycle, inboundShortRef } from "./inbound-request-authority";
import { redriveRetainedStatementOccurrence } from "./statement-command-worker";
import { ensureStatementOccurrenceNotification, settleStatementNotificationState } from "./statement-review-notification";

/**
 * Operator recovery of ONE retained statement occurrence.
 *
 * It repairs only the two things an occurrence that failed at handoff is missing: the durable internal review
 * obligation (the request-derived task, SLA and notification) and the command's path to a consumer. Everything is
 * keyed by the original request, so repeating it changes nothing.
 *
 * What it never does: create a replacement submission or a second contact, read or change the receipt (`transactional_ack`)
 * effect or the acknowledgement row (a receipt already sent is not replayed; one not yet sent follows its own capability
 * and the durable-review gate), enable a send or provider capability, or touch any other occurrence.
 */
export type StatementOccurrenceRecoveryResult =
  | {
      ok: true;
      reference: string;
      commandState: "recovered" | "already_in_progress" | "already_succeeded";
      queued: boolean;
      queueCode: string | null;
      lifecycleState: string;
    }
  | { ok: false; code: string; status: 404 | 409 | 422 | 500 };

export async function recoverStatementOccurrence(input: { requestId: string; actor: string }): Promise<StatementOccurrenceRecoveryResult> {
  const [request] = await db.select().from(inboundRequests).where(eq(inboundRequests.id, input.requestId)).limit(1);
  if (!request) return { ok: false, code: "REQUEST_NOT_FOUND", status: 404 };
  if (request.sourceType !== "statement_upload") return { ok: false, code: "NOT_A_STATEMENT_OCCURRENCE", status: 422 };
  if (!request.contactId || !request.protectedObjectRef) return { ok: false, code: "NO_RETAINED_STATEMENT", status: 422 };

  const redrive = await redriveRetainedStatementOccurrence(request.id);
  if (!redrive.ok) return { ok: false, code: redrive.code, status: redrive.code === "REQUEST_NOT_FOUND" ? 404 : 409 };

  // The durable review obligation: same request-derived keys as the public handler, so an existing task is reused.
  const [contact] = await db.select({ companyName: contacts.companyName }).from(contacts).where(eq(contacts.id, request.contactId)).limit(1);
  const queued = redrive.enqueued || redrive.commandState === "already_succeeded";
  const business = contact?.companyName?.trim() || null;
  await ensureStatementOccurrenceNotification({
    requestId: request.id, contactId: request.contactId, dealId: request.dealId, business,
    state: queued ? "queued" : "needs_attention",
  });
  await settleStatementNotificationState({ requestId: request.id, business, state: queued ? "queued" : "needs_attention" });
  const accepted = await orchestrateInboundRequest({ requestId: request.id, contactId: request.contactId, dealId: request.dealId });
  let lifecycleState = accepted.lifecycleState;
  if (!queued) {
    lifecycleState = "review_required";
    await setInboundRequestLifecycle(request.id, "review_required", `STATEMENT_PROCESSING_DEFERRED:${redrive.enqueueCode ?? "STATEMENT_QUEUE_NOT_SELECTED"}`);
  }
  await storage.createAuditLog({
    action: "statement_occurrence_recovered",
    entityType: "contact",
    entityId: request.contactId,
    actorType: "user",
    details: {
      actor: input.actor, reference: inboundShortRef(request.id), commandState: redrive.commandState,
      queued, queueCode: redrive.enqueueCode ?? null, receiptTouched: false, replacementSubmissionCreated: false,
    },
  } as any);
  return {
    ok: true, reference: inboundShortRef(request.id), commandState: redrive.commandState,
    queued, queueCode: redrive.enqueueCode ?? null, lifecycleState,
  };
}
