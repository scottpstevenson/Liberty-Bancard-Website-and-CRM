import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { auditLogs, contacts, deals, inboundRequests, statementUploadCommands } from "@shared/schema";
import {
  analysisStepOutcome,
  deriveAnalysisState,
  deriveOccurrenceStatus,
  sanitizeChainDetail,
  type AnalysisState,
  type AnalysisStepOutcome,
  type ChainStepState,
  type StatementChainResponse,
  type StatementChainRow,
  type StoredChainStep,
} from "@shared/statement-chain-state";
import { db } from "../db";
import { storage } from "../storage";
import { inboundShortRef } from "./inbound-request-authority";

/** The owner switch for automatic analysis. Duplicated as a literal on purpose: this module must not import the upload chain. */
const AUTO_ANALYSIS_SETTING = "statement_auto_analysis_enabled";

const STEP_STATES: readonly ChainStepState[] = ["done", "held", "handed_off", "failed"];

/** Accept only the shape the chain stores; anything else is "no recorded steps", never a guessed success. */
export function parseStoredChainSteps(result: unknown): StoredChainStep[] {
  const raw = result && typeof result === "object" ? (result as { steps?: unknown }).steps : undefined;
  if (!Array.isArray(raw)) return [];
  const steps: StoredChainStep[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Partial<StoredChainStep>;
    if (typeof candidate.step !== "number" || typeof candidate.name !== "string" || !STEP_STATES.includes(candidate.state as ChainStepState)) continue;
    const detail = sanitizeChainDetail(candidate.detail);
    steps.push({ step: candidate.step, name: candidate.name.slice(0, 80), state: candidate.state as ChainStepState, ...(detail ? { detail } : {}) });
  }
  return steps;
}

export interface StatementOccurrenceInput {
  id: string;
  idempotencyKey: string;
  dealId: number | null;
  lifecycleState: string;
  terminalReason: string | null;
}

export interface StatementOccurrenceTruth {
  documentId: number | null;
  commandStatus: string | null;
  steps: StoredChainStep[];
  analysis: AnalysisState;
}

/** The audit action the statement analyzer writes, with the document it actually analysed, when an analysis finishes. */
const ANALYSIS_COMPLETE_ACTION = "statement_analysis_complete";

/**
 * Durable, read-only truth for statement occurrences: the command's recorded steps and retained document, and an analysis
 * state derived from that occurrence's OWN evidence (its analysis step, the deal's status only where this occurrence owns
 * it, and analysis-complete records that name its document), plus the owner setting. Nothing here starts work, calls a
 * provider, changes a setting or rewrites a row.
 */
export async function readStatementOccurrenceTruth(
  requests: readonly StatementOccurrenceInput[],
): Promise<{ autoAnalysisEnabled: boolean; byRequest: Map<string, StatementOccurrenceTruth> }> {
  const autoAnalysisEnabled = (await storage.getSystemSetting(AUTO_ANALYSIS_SETTING)) === "true";
  const byRequest = new Map<string, StatementOccurrenceTruth>();
  if (requests.length === 0) return { autoAnalysisEnabled, byRequest };

  const dealIds = [...new Set(requests.map((request) => request.dealId).filter((id): id is number => typeof id === "number"))];

  // Every statement occurrence on these deals, not only the ones being read: the deal's analysis status belongs to the newest
  // occurrence that queued work, which may be outside this window.
  const siblings = dealIds.length
    ? await db.select({ id: inboundRequests.id, idempotencyKey: inboundRequests.idempotencyKey, dealId: inboundRequests.dealId, createdAt: inboundRequests.createdAt })
      .from(inboundRequests)
      .where(and(eq(inboundRequests.sourceType, "statement_upload"), inArray(inboundRequests.dealId, dealIds)))
    : [];

  const keys = [...new Set([...requests.map((request) => request.idempotencyKey), ...siblings.map((sibling) => sibling.idempotencyKey)])];
  const commands = await db.select({
    requestId: statementUploadCommands.requestId,
    status: statementUploadCommands.status,
    documentId: statementUploadCommands.documentId,
    result: statementUploadCommands.result,
  }).from(statementUploadCommands).where(and(eq(statementUploadCommands.operationScope, "statement_upload"), inArray(statementUploadCommands.requestId, keys)));
  const commandByKey = new Map(commands.map((command) => [command.requestId, command]));
  const stepsByKey = new Map(commands.map((command) => [command.requestId, parseStoredChainSteps(command.result)]));

  const dealRows = dealIds.length
    ? await db.select({ id: deals.id, analysisStatus: deals.analysisStatus }).from(deals).where(inArray(deals.id, dealIds))
    : [];
  const analysisByDeal = new Map(dealRows.map((deal) => [deal.id, deal.analysisStatus]));

  // The queue attempts (queued or failed after the status was set to pending) are the only chain writes to the deal's analysis
  // status; a held upload leaves it alone. The newest attempt per deal owns the status.
  const statusOwnerByDeal = new Map<number, string>();
  const attemptsByDeal = new Map<number, typeof siblings>();
  for (const sibling of siblings) {
    if (sibling.dealId === null) continue;
    const outcome: AnalysisStepOutcome = analysisStepOutcome(stepsByKey.get(sibling.idempotencyKey));
    if (outcome !== "queued" && outcome !== "failed") continue;
    attemptsByDeal.set(sibling.dealId, [...(attemptsByDeal.get(sibling.dealId) ?? []), sibling]);
  }
  for (const [dealId, attempts] of attemptsByDeal) {
    attempts.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1));
    statusOwnerByDeal.set(dealId, attempts[0].id);
  }

  // Analysis-complete records name the document that was analysed, which is the only direct tie between a result and an upload.
  const documentIds = new Set(commands.map((command) => command.documentId).filter((id): id is number => typeof id === "number"));
  const analysedDocuments = new Set<string>();
  if (dealIds.length && documentIds.size) {
    const records = await db.select({ dealId: auditLogs.entityId, documentId: sql<string | null>`${auditLogs.details}->>'documentId'` })
      .from(auditLogs)
      .where(and(eq(auditLogs.action, ANALYSIS_COMPLETE_ACTION), eq(auditLogs.entityType, "deal"), inArray(auditLogs.entityId, dealIds)));
    for (const record of records) if (record.dealId !== null && record.documentId) analysedDocuments.add(`${record.dealId}:${record.documentId}`);
  }

  for (const request of requests) {
    const command = commandByKey.get(request.idempotencyKey);
    const steps = stepsByKey.get(request.idempotencyKey) ?? [];
    const documentId = command?.documentId ?? null;
    byRequest.set(request.id, {
      documentId,
      commandStatus: command?.status ?? null,
      steps,
      analysis: deriveAnalysisState({
        dealId: request.dealId,
        analysisStatus: request.dealId ? analysisByDeal.get(request.dealId) ?? null : null,
        autoAnalysisEnabled,
        ownStep: analysisStepOutcome(steps),
        ownsDealStatus: request.dealId !== null && statusOwnerByDeal.get(request.dealId) === request.id,
        analyzedThisDocument: request.dealId !== null && documentId !== null && analysedDocuments.has(`${request.dealId}:${documentId}`),
        finishedWithoutSteps: command?.status === "succeeded" && steps.length === 0,
      }),
    });
  }
  return { autoAnalysisEnabled, byRequest };
}

/** Latest statement occurrences with their per-occurrence handoff and analysis truth. Counts describe this window only. */
export async function readStatementChain(options: { limit?: number; failuresOnly?: boolean }): Promise<StatementChainResponse> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 60) || 60, 1), 200);
  const failuresOnly = options.failuresOnly === true;
  const requests = await db.select({
    id: inboundRequests.id,
    idempotencyKey: inboundRequests.idempotencyKey,
    createdAt: inboundRequests.createdAt,
    contactId: inboundRequests.contactId,
    dealId: inboundRequests.dealId,
    lifecycleState: inboundRequests.lifecycleState,
    terminalReason: inboundRequests.terminalReason,
    companyName: contacts.companyName,
  }).from(inboundRequests)
    .leftJoin(contacts, eq(contacts.id, inboundRequests.contactId))
    .where(eq(inboundRequests.sourceType, "statement_upload"))
    .orderBy(desc(inboundRequests.createdAt))
    .limit(limit);

  const { autoAnalysisEnabled, byRequest } = await readStatementOccurrenceTruth(requests);
  const all: StatementChainRow[] = requests.map((request) => {
    const truth = byRequest.get(request.id)!;
    return {
      requestReceipt: request.id,
      shortRef: inboundShortRef(request.id),
      occurredAt: request.createdAt.toISOString(),
      businessName: request.companyName?.trim() || null,
      contactId: request.contactId,
      dealId: request.dealId,
      documentId: truth.documentId,
      lifecycleState: request.lifecycleState,
      commandStatus: truth.commandStatus,
      status: deriveOccurrenceStatus({
        lifecycleState: request.lifecycleState,
        terminalReason: request.terminalReason,
        commandStatus: truth.commandStatus,
        steps: truth.steps,
      }),
      analysis: truth.analysis,
      steps: truth.steps,
      diagnostics: { terminalReason: sanitizeChainDetail(request.terminalReason) ?? null },
    };
  });
  const needsAttention = all.filter((row) => row.status === "needs_attention" || row.status === "manual_review").length;
  const rows = failuresOnly ? all.filter((row) => row.status === "needs_attention" || row.status === "manual_review") : all;
  return {
    asOf: new Date().toISOString(),
    scope: { kind: "latest_occurrences", limit, failuresOnly, returned: rows.length, needsAttention },
    autoAnalysisEnabled,
    rows,
  };
}
