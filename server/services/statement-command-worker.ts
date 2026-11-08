/**
 * Queue-owned executor for durable statement-upload commands.
 * The command row owns lifecycle and recovery; BullMQ only transports its ID.
 */
import { randomUUID } from "crypto";
import { and, eq, lt, or, sql } from "drizzle-orm";
import { db } from "../db";
import { inboundRequests, statementUploadCommands } from "@shared/schema";
import { runStatementUploadChain, type StatementUploadInput } from "./statement-upload-chain";
import { markRecoverableFailed, recoverCommand } from "./statement-upload-idempotency";
import { sniffStatementMimeType } from "./statement-upload-file";
import { getProtectedObject, getProtectedObjectMetadata, putProtectedObject } from "./protected-object";
import {
  linkInboundRequest,
  reconcileInboundRequestLifecycle,
  setInboundRequestLifecycle,
  transitionInboundEffectByKey,
} from "./inbound-request-authority";

const LEASE_MS = 2 * 60 * 1000;

type PersistedInput = Omit<StatementUploadInput, "fileBuffer"> & {
  protectedObjectRef?: string;
  protectedObjectChecksum?: string;
};

async function requireStatementObject(
  objectRef: string,
  expectedChecksum: string | undefined,
  contactId: number,
): Promise<Buffer> {
  // A reference alone is not authority. Bind every command read to the
  // environment and contact tenant that were claimed with the command.
  if (!/^[0-9a-f-]{36}$/i.test(objectRef)) throw new Error("PROTECTED_OBJECT_REF_INVALID");
  const authorization = {
    tenantScope: `contact:${contactId}`,
    environmentScope: process.env.NODE_ENV || "development",
  };
  const metadata = await getProtectedObjectMetadata(objectRef, authorization);
  if (!metadata) throw new Error("PROTECTED_OBJECT_UNAVAILABLE");
  return getProtectedObject(objectRef, authorization, expectedChecksum);
}

async function releaseStatementCommandLease(commandId: string, token: string): Promise<void> {
  await db.update(statementUploadCommands).set({
    leaseToken: null,
    leaseExpiresAt: null,
    heartbeatAt: new Date(),
    updatedAt: new Date(),
  }).where(and(
    eq(statementUploadCommands.id, commandId),
    eq(statementUploadCommands.leaseToken, token),
  ));
}

export async function executeStatementUploadCommand(commandId: string): Promise<void> {
  const token = randomUUID();
  const claimed = await db.update(statementUploadCommands).set({
    leaseToken: token,
    leaseExpiresAt: new Date(Date.now() + LEASE_MS),
    heartbeatAt: new Date(),
    attemptCount: sql`${statementUploadCommands.attemptCount} + 1`,
    updatedAt: new Date(),
  }).where(and(
    eq(statementUploadCommands.id, commandId),
    eq(statementUploadCommands.status, "in_progress"),
    or(lt(statementUploadCommands.leaseExpiresAt, new Date()), sql`${statementUploadCommands.leaseExpiresAt} IS NULL`),
  )).returning();
  const command = claimed[0];
  if (!command) return; // terminal, leased, or duplicate delivery

  const input = command.context as PersistedInput | null;
  const inboundRequestId = input?.inboundRequestId;
  if (inboundRequestId) {
    await transitionInboundEffectByKey({
      requestId: inboundRequestId,
      effectKey: "statement_review",
      state: "attempting",
      terminalReason: "STATEMENT_WORKER_CLAIMED",
    });
    await setInboundRequestLifecycle(inboundRequestId, "processing", null);
  }
  if (!input?.contactId || !input.source || !input.protectedObjectRef) {
    await markRecoverableFailed(commandId, {
      code: (input as any)?.durableFilePath ? "LEGACY_LOCAL_PATH_UNRECOVERABLE" : "MISSING_PROTECTED_OBJECT",
    }, token);
    await releaseStatementCommandLease(commandId, token);
    if (inboundRequestId) {
      await transitionInboundEffectByKey({
        requestId: inboundRequestId,
        effectKey: "statement_review",
        state: "failed",
        terminalReason: "STATEMENT_COMMAND_INPUT_INVALID",
      });
      await reconcileInboundRequestLifecycle({
        requestId: inboundRequestId,
        terminalReason: "STATEMENT_COMMAND_INPUT_INVALID",
      });
    }
    return;
  }
  let fileBuffer: Buffer;
  try {
    fileBuffer = await requireStatementObject(input.protectedObjectRef, input.protectedObjectChecksum, input.contactId);
  } catch (error) {
    await markRecoverableFailed(commandId, {
      code: error instanceof Error ? error.message : "PROTECTED_OBJECT_UNAVAILABLE",
    }, token);
    await releaseStatementCommandLease(commandId, token);
    if (inboundRequestId) {
      await transitionInboundEffectByKey({
        requestId: inboundRequestId,
        effectKey: "statement_review",
        state: "failed",
        terminalReason: "STATEMENT_PROTECTED_OBJECT_UNAVAILABLE",
      });
      await reconcileInboundRequestLifecycle({
        requestId: inboundRequestId,
        terminalReason: "STATEMENT_PROTECTED_OBJECT_UNAVAILABLE",
      });
    }
    return;
  }
  const heartbeat = setInterval(() => {
    void db.update(statementUploadCommands).set({
      heartbeatAt: new Date(),
      leaseExpiresAt: new Date(Date.now() + LEASE_MS),
      updatedAt: new Date(),
    }).where(and(
      eq(statementUploadCommands.id, commandId),
      eq(statementUploadCommands.leaseToken, token),
      eq(statementUploadCommands.status, "in_progress"),
    ));
  }, 30_000);
  try {
    const result = await runStatementUploadChain({ ...input, fileBuffer, commandId, commandLeaseToken: token });
    if (inboundRequestId) {
      if (result.allSuccess) {
        await transitionInboundEffectByKey({
          requestId: inboundRequestId,
          effectKey: "statement_review",
          state: "sent",
          terminalReason: "STATEMENT_WORKER_COMPLETED",
        });
        await reconcileInboundRequestLifecycle({
          requestId: inboundRequestId,
          incompleteState: "review_required",
          completedState: "completed",
        });
      } else {
        await transitionInboundEffectByKey({
          requestId: inboundRequestId,
          effectKey: "statement_review",
          state: "failed",
          terminalReason: "STATEMENT_COMMAND_STEP_FAILURE",
        });
        await reconcileInboundRequestLifecycle({
          requestId: inboundRequestId,
          terminalReason: "STATEMENT_COMMAND_STEP_FAILURE",
        });
      }
    }
  } catch (error) {
    await markRecoverableFailed(commandId, { code: "retryable_worker_failure" }, token);
    if (inboundRequestId) {
      await transitionInboundEffectByKey({
        requestId: inboundRequestId,
        effectKey: "statement_review",
        state: "failed",
        terminalReason: "STATEMENT_COMMAND_RETRYABLE_FAILURE",
      });
      await reconcileInboundRequestLifecycle({
        requestId: inboundRequestId,
        terminalReason: "STATEMENT_COMMAND_RETRYABLE_FAILURE",
      });
    }
    throw error;
  } finally {
    clearInterval(heartbeat);
    await releaseStatementCommandLease(commandId, token);
  }
}

export async function recoverStatementUploadCommands(): Promise<void> {
  const stale = await db.select({ id: statementUploadCommands.id })
    .from(statementUploadCommands)
    .where(and(eq(statementUploadCommands.status, "in_progress"),
      or(lt(statementUploadCommands.leaseExpiresAt, new Date()), sql`${statementUploadCommands.leaseExpiresAt} IS NULL`)))
    .limit(100);
  await Promise.all(stale.map(({ id }) => enqueueStatementUploadCommandId(id)));
}

/**
 * Sanitized, structured outcome of handing a command id to the physical `statement-upload` queue. The code names the
 * layer that refused (no producer at all, queue not selected by the background profile, or the broker rejecting the
 * add) so an operator can act on it; no error message, host, credential or payload is ever carried.
 */
export type StatementEnqueueOutcome =
  | { ok: true }
  | { ok: false; code: "STATEMENT_QUEUE_PRODUCER_UNAVAILABLE" | "STATEMENT_QUEUE_NOT_SELECTED" | "STATEMENT_QUEUE_ADD_FAILED" };

export async function enqueueStatementUploadCommand(commandId: string): Promise<StatementEnqueueOutcome> {
  let queue: { add: (...args: any[]) => Promise<unknown> } | undefined;
  try {
    const { getQueueManagerProducers, QUEUE_NAMES } = await import("./queue-manager");
    const producers = getQueueManagerProducers();
    if (!producers) return { ok: false, code: "STATEMENT_QUEUE_PRODUCER_UNAVAILABLE" };
    queue = producers.getQueue(QUEUE_NAMES.STATEMENT_UPLOAD) as typeof queue;
    // The queue manager only creates Queue objects for queues selected by BACKGROUND_JOB_PROFILE. A missing queue
    // while producers exist is therefore a profile/capability gap, not a transient broker fault.
    if (!queue) return { ok: false, code: "STATEMENT_QUEUE_NOT_SELECTED" };
  } catch (error) {
    console.error("[StatementQueue] producer lookup failed:", error instanceof Error ? error.name : "unknown");
    return { ok: false, code: "STATEMENT_QUEUE_PRODUCER_UNAVAILABLE" };
  }
  try {
    await queue.add("execute", { commandId }, { jobId: `statement-command-${commandId}-${Date.now()}`, attempts: 3, backoff: { type: "exponential", delay: 10000 } });
    return { ok: true };
  } catch (error) {
    console.error("[StatementQueue] enqueue failed:", error instanceof Error ? error.name : "unknown");
    return { ok: false, code: "STATEMENT_QUEUE_ADD_FAILED" };
  }
}

export async function enqueueStatementUploadCommandId(commandId: string): Promise<boolean> {
  return (await enqueueStatementUploadCommand(commandId)).ok;
}

type StatementObject = Awaited<ReturnType<typeof putProtectedObject>>;

/**
 * Retains the statement bytes (or verifies an already-retained object) bound to the contact tenant and environment.
 * The real media type is recorded; a caller-declared type is never trusted and a photo is never labelled a PDF.
 */
async function retainStatementObject(input: StatementUploadInput): Promise<StatementObject | null> {
  const tenantScope = `contact:${input.contactId}`;
  const environmentScope = process.env.NODE_ENV || "development";
  if (input.protectedObjectRef) {
    return getProtectedObjectMetadata(input.protectedObjectRef, { tenantScope, environmentScope });
  }
  if (!input.fileBuffer) return null;
  const sniffed = sniffStatementMimeType(input.fileBuffer);
  return putProtectedObject({
    bytes: input.fileBuffer,
    mimeType: sniffed ?? "application/octet-stream",
    fileName: input.fileName ?? "statement",
    tenantScope,
  });
}

function assertStatementObjectScope(object: StatementObject | null, contactId: number): asserts object is StatementObject {
  if (!object || object.tenantScope !== `contact:${contactId}` ||
      object.environmentScope !== (process.env.NODE_ENV || "development") ||
      object.validationState !== "validated" || object.retentionState !== "active") {
    throw new Error("PROTECTED_OBJECT_SCOPE_MISMATCH");
  }
}

export async function persistAndEnqueueStatementCommand(input: StatementUploadInput): Promise<boolean> {
  if (!input.commandId || !input.fileName) return false;
  const object = await retainStatementObject(input);
  assertStatementObjectScope(object, input.contactId);
  const persisted = await db.update(statementUploadCommands).set({
    context: {
      ...input,
      fileBuffer: undefined,
      protectedObjectRef: object.objectRef,
      protectedObjectChecksum: input.protectedObjectChecksum || object.checksumSha256,
    },
    updatedAt: new Date(),
  }).where(and(eq(statementUploadCommands.id, input.commandId), eq(statementUploadCommands.status, "in_progress"))).returning({ id: statementUploadCommands.id });
  if (persisted.length !== 1) {
    // Do not delete a caller-owned object here: its retention and cleanup are
    // governed by the protected-object authority, not an enqueue race.
    return false;
  }
  if (input.inboundRequestId) {
    await linkInboundRequest(input.inboundRequestId, {
      contactId: input.contactId,
      dealId: input.dealId,
      protectedObjectRef: object.objectRef,
      lifecycleState: "processing",
    });
  }
  const queued = await enqueueStatementUploadCommandId(input.commandId);
  if (input.inboundRequestId && queued) {
    const transitioned = await transitionInboundEffectByKey({
      requestId: input.inboundRequestId,
      effectKey: "statement_review",
      state: "ready",
      terminalReason: "DURABLE_STATEMENT_COMMAND_HANDOFF",
    });
    if (!transitioned) throw new Error("STATEMENT_HANDOFF_EFFECT_MISSING");
  }
  return queued;
}

/**
 * Public-intake handoff. Retention of the file and the durable command context are the commitments the merchant relies
 * on; the queue is only transport. So a refused enqueue is NOT a failed request: the retained object, the in-progress
 * command (no lease, picked up by the recovery tick as soon as a consumer is selected) and the request link all
 * stand, `statement_review` stays held with the sanitized reason, and the caller proceeds to create the durable review
 * obligation. Only a failure to retain or bind the object throws.
 */
export type StatementHandoffOutcome =
  | { state: "queued"; protectedObjectRef: string }
  | { state: "deferred"; protectedObjectRef: string; code: Extract<StatementEnqueueOutcome, { ok: false }>["code"] };

export async function retainStatementAndTryEnqueue(input: StatementUploadInput): Promise<StatementHandoffOutcome> {
  if (!input.commandId || !input.fileName) throw new Error("STATEMENT_COMMAND_INPUT_INVALID");
  const object = await retainStatementObject(input);
  assertStatementObjectScope(object, input.contactId);
  const persisted = await db.update(statementUploadCommands).set({
    context: {
      ...input,
      fileBuffer: undefined,
      protectedObjectRef: object.objectRef,
      protectedObjectChecksum: input.protectedObjectChecksum || object.checksumSha256,
    },
    updatedAt: new Date(),
  }).where(and(eq(statementUploadCommands.id, input.commandId), eq(statementUploadCommands.status, "in_progress"))).returning({ id: statementUploadCommands.id });
  if (persisted.length !== 1) throw new Error("STATEMENT_COMMAND_NOT_PERSISTED");
  if (input.inboundRequestId) {
    const linked = await linkInboundRequest(input.inboundRequestId, {
      contactId: input.contactId,
      dealId: input.dealId,
      protectedObjectRef: object.objectRef,
      lifecycleState: "processing",
    });
    if (!linked) throw new Error("INBOUND_REQUEST_LINK_FAILED");
  }
  const outcome = await enqueueStatementUploadCommand(input.commandId);
  if (outcome.ok) {
    if (input.inboundRequestId) {
      const transitioned = await transitionInboundEffectByKey({
        requestId: input.inboundRequestId,
        effectKey: "statement_review",
        state: "ready",
        terminalReason: "DURABLE_STATEMENT_COMMAND_HANDOFF",
      });
      if (!transitioned) throw new Error("STATEMENT_HANDOFF_EFFECT_MISSING");
    }
    return { state: "queued", protectedObjectRef: object.objectRef };
  }
  if (input.inboundRequestId) {
    await transitionInboundEffectByKey({
      requestId: input.inboundRequestId,
      effectKey: "statement_review",
      state: "held",
      terminalReason: outcome.code,
    });
  }
  return { state: "deferred", protectedObjectRef: object.objectRef, code: outcome.code };
}

/**
 * Authorized, idempotent re-drive of ONE retained statement occurrence whose handoff never reached a consumer.
 *
 * It never creates a replacement submission (the same request, command, contact and protected object are reused),
 * never touches the receipt effect (`transactional_ack` is not read or written here, so a receipt already sent is never
 * replayed and one not yet sent follows its own capability), and refuses anything that is not exactly the retained,
 * validated, tenant/environment-bound object of the request's own command. Replaying it is harmless: an in-progress
 * command is only re-enqueued and a succeeded one is left alone.
 */
export type StatementRedriveResult =
  | { ok: true; commandState: "recovered" | "already_in_progress" | "already_succeeded"; enqueued: boolean; enqueueCode?: string }
  | { ok: false; code: string };

export async function redriveRetainedStatementOccurrence(requestId: string): Promise<StatementRedriveResult> {
  const [request] = await db.select({
    id: inboundRequests.id, sourceType: inboundRequests.sourceType, contactId: inboundRequests.contactId,
    protectedObjectRef: inboundRequests.protectedObjectRef, idempotencyKey: inboundRequests.idempotencyKey,
  }).from(inboundRequests).where(eq(inboundRequests.id, requestId)).limit(1);
  if (!request) return { ok: false, code: "REQUEST_NOT_FOUND" };
  if (request.sourceType !== "statement_upload") return { ok: false, code: "NOT_A_STATEMENT_OCCURRENCE" };
  if (!request.contactId || !request.protectedObjectRef) return { ok: false, code: "NO_RETAINED_STATEMENT" };

  const [command] = await db.select().from(statementUploadCommands)
    .where(eq(statementUploadCommands.requestId, request.idempotencyKey)).limit(1);
  if (!command) return { ok: false, code: "COMMAND_NOT_FOUND" };
  const context = command.context as PersistedInput | null;
  if (!context || context.inboundRequestId !== request.id || context.protectedObjectRef !== request.protectedObjectRef) {
    return { ok: false, code: "COMMAND_CONTEXT_MISMATCH" };
  }
  const object = await getProtectedObjectMetadata(request.protectedObjectRef, {
    tenantScope: `contact:${request.contactId}`,
    environmentScope: process.env.NODE_ENV || "development",
  });
  try { assertStatementObjectScope(object, request.contactId); } catch { return { ok: false, code: "RETAINED_OBJECT_UNAVAILABLE" }; }

  if (command.status === "succeeded") return { ok: true, commandState: "already_succeeded", enqueued: false };
  let commandState: "recovered" | "already_in_progress" = "already_in_progress";
  if (command.status === "recoverable_failed") {
    // Same row, same key, same owner scope: not a new idempotency key. Checkpoint/result are cleared so the retry is clean.
    const reopened = await recoverCommand(command.id, command.ownerScope);
    if (!reopened) return { ok: false, code: "COMMAND_STATE_CHANGED" };
    commandState = "recovered";
  } else if (command.status !== "in_progress") {
    return { ok: false, code: "COMMAND_STATE_NOT_RECOVERABLE" };
  }
  const outcome = await enqueueStatementUploadCommand(command.id);
  if (outcome.ok) {
    await transitionInboundEffectByKey({
      requestId: request.id, effectKey: "statement_review", state: "ready", terminalReason: "DURABLE_STATEMENT_COMMAND_HANDOFF",
    });
    return { ok: true, commandState, enqueued: true };
  }
  await transitionInboundEffectByKey({
    requestId: request.id, effectKey: "statement_review", state: "held", terminalReason: outcome.code,
  });
  return { ok: true, commandState, enqueued: false, enqueueCode: outcome.code };
}