import { and, eq } from "drizzle-orm";
import { inboundRequests, statementUploadCommands } from "@shared/schema";
import { db } from "../db";
import { inboundShortRef } from "./inbound-request-authority";

export type StatementRequestLink =
  | { linked: true; requestReceipt: string; shortRef: string }
  | { linked: false; reason: "no_document" | "no_request_recorded" | "ambiguous"; count?: number };

/**
 * The retained website request that produced one document, derived ONLY from the recorded statement upload command that
 * names that document. No name, contact, deal or time match is ever used. Two requests naming one document are
 * `ambiguous` and neither is chosen. Read-only.
 */
export async function resolveStatementRequestByDocument(documentId: number | null): Promise<StatementRequestLink> {
  if (documentId === null) return { linked: false, reason: "no_document" };
  const rows = await db.select({ id: inboundRequests.id })
    .from(statementUploadCommands)
    .innerJoin(inboundRequests, eq(inboundRequests.idempotencyKey, statementUploadCommands.requestId))
    .where(and(
      eq(statementUploadCommands.documentId, documentId),
      eq(statementUploadCommands.operationScope, "statement_upload"),
      eq(inboundRequests.sourceType, "statement_upload"),
    ));
  const ids = [...new Set(rows.map((row) => row.id))];
  if (ids.length === 0) return { linked: false, reason: "no_request_recorded" };
  if (ids.length > 1) return { linked: false, reason: "ambiguous", count: ids.length };
  return { linked: true, requestReceipt: ids[0], shortRef: inboundShortRef(ids[0]) };
}
