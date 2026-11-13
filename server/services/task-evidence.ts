import { and, eq, inArray } from "drizzle-orm";
import { documents, inboundRequests, inboundRequestWorkLinks, statementReviews } from "@shared/schema";
import type { TaskEvidence, TaskEvidenceFile } from "@shared/task-evidence";
import { db } from "../db";
import { inboundShortRef } from "./inbound-request-authority";
import { readStatementOccurrenceTruth } from "./statement-chain-read-model";

/**
 * Read-only task evidence projection (website request and retained file behind a work task).
 *
 * Relationships come ONLY from recorded rows: `inbound_request_work_links` for request -> task, and the recorded statement
 * upload command (through readStatementOccurrenceTruth) for request -> retained document. Nothing here parses a task
 * description, matches a name/email/time, downloads a file, starts analysis or writes a row. Request and file identity is
 * limited to the roles that already manage website requests (admin, manager); the task itself must already have been
 * authorized by the caller through the actor-scoped exact task read.
 */
const REQUEST_ROLES = new Set(["admin", "manager"]);

const base = (taskId: number, state: TaskEvidence["state"], reason: string | null): TaskEvidence => ({ taskId, state, request: null, file: null, reason });

export async function readTaskEvidence(input: { taskId: number; taskContactId: number | null; role: string | null | undefined }): Promise<TaskEvidence> {
  const { taskId } = input;
  if (!input.role || !REQUEST_ROLES.has(input.role)) return base(taskId, "restricted", "role");

  const links = await db.select({ requestId: inboundRequestWorkLinks.requestId })
    .from(inboundRequestWorkLinks)
    .where(and(eq(inboundRequestWorkLinks.taskId, taskId), eq(inboundRequestWorkLinks.workType, "task")));
  const requestIds = [...new Set(links.map((link) => link.requestId))];
  if (requestIds.length === 0) return base(taskId, "none_recorded", "no_work_link");
  if (requestIds.length > 1) return base(taskId, "ambiguous", "multiple_requests");

  const [request] = await db.select().from(inboundRequests).where(eq(inboundRequests.id, requestIds[0])).limit(1);
  if (!request) return base(taskId, "none_recorded", "request_missing");
  if (request.contactId !== null && input.taskContactId !== null && request.contactId !== input.taskContactId) {
    return base(taskId, "mismatch", "contact_differs");
  }

  const evidence: TaskEvidence = {
    taskId, state: "linked", reason: null, file: null,
    request: {
      requestReceipt: request.id,
      shortRef: inboundShortRef(request.id),
      sourceType: request.sourceType,
      lifecycleState: request.lifecycleState,
      createdAt: request.createdAt.toISOString(),
      contactId: request.contactId,
    },
  };
  if (request.sourceType !== "statement_upload") return evidence;

  evidence.file = await readFile(request);
  return evidence;
}

async function readFile(request: typeof inboundRequests.$inferSelect): Promise<TaskEvidenceFile> {
  const unavailable = (state: "unavailable" = "unavailable"): TaskEvidenceFile => ({
    state, documentId: null, fileName: null, fileSize: null, mimeType: null,
    review: { state: "unavailable", reviewId: null, status: null }, analysis: null,
  });
  try {
    const truth = await readStatementOccurrenceTruth([{
      id: request.id, idempotencyKey: request.idempotencyKey, dealId: request.dealId,
      lifecycleState: request.lifecycleState, terminalReason: request.terminalReason,
    }]);
    const occurrence = truth.byRequest.get(request.id);
    if (!occurrence) return unavailable();
    const documentId = occurrence.documentId;
    if (documentId === null) {
      return { state: "none_recorded", documentId: null, fileName: null, fileSize: null, mimeType: null,
        review: { state: "none", reviewId: null, status: null }, analysis: occurrence.analysis };
    }
    const [document] = await db.select({ id: documents.id, fileName: documents.fileName, fileSize: documents.fileSize, mimeType: documents.mimeType })
      .from(documents).where(eq(documents.id, documentId)).limit(1);
    if (!document) {
      return { state: "missing", documentId, fileName: null, fileSize: null, mimeType: null,
        review: { state: "none", reviewId: null, status: null }, analysis: occurrence.analysis };
    }
    const reviews = await db.select({ id: statementReviews.id, status: statementReviews.status })
      .from(statementReviews).where(inArray(statementReviews.documentId, [documentId]));
    const review = reviews.length === 0 ? { state: "none" as const, reviewId: null, status: null }
      : reviews.length > 1 ? { state: "ambiguous" as const, reviewId: null, status: null }
        : { state: "present" as const, reviewId: reviews[0].id, status: reviews[0].status ?? null };
    return {
      state: "retained", documentId, fileName: document.fileName, fileSize: document.fileSize ?? null,
      mimeType: document.mimeType ?? null, review, analysis: occurrence.analysis,
    };
  } catch (error) {
    console.error("[TaskEvidence] retained file read failed:", error instanceof Error ? error.name : "unknown");
    return unavailable();
  }
}
