/**
 * Queue-owned executor for durable statement-upload commands.
 * The command row owns lifecycle and recovery; BullMQ only transports its ID.
 */
import { randomUUID } from "crypto";
import { and, eq, lt, or, sql } from "drizzle-orm";
import { db } from "../db";
import { statementUploadCommands } from "@shared/schema";
import { runStatementUploadChain, type StatementUploadInput } from "./statement-upload-chain";
import { markRecoverableFailed } from "./statement-upload-idempotency";
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

export async function enqueueStatementUploadCommandId(commandId: string): Promise<boolean> {
  try {
    const { getQueueManagerProducers, QUEUE_NAMES } = await import("./queue-manager");
    const queue = getQueueManagerProducers()?.getQueue(QUEUE_NAMES.STATEMENT_UPLOAD);
    if (!queue) return false;
    await queue.add("execute", { commandId }, { jobId: `statement-command-${commandId}-${Date.now()}`, attempts: 3, backoff: { type: "exponential", delay: 10000 } });
    return true;
  } catch {
    return false;
  }
}

export async function persistAndEnqueueStatementCommand(input: StatementUploadInput): Promise<boolean> {
  if (!input.commandId || !input.fileName) return false;
  const object = input.protectedObjectRef
    ? await getProtectedObjectMetadata(input.protectedObjectRef, {
        tenantScope: `contact:${input.contactId}`,
        environmentScope: process.env.NODE_ENV || "development",
      })
    : input.fileBuffer ? await putProtectedObject({
        bytes: input.fileBuffer,
        mimeType: "application/pdf",
        fileName: input.fileName,
        tenantScope: `contact:${input.contactId}`,
      }) : null;
  if (!object || object.tenantScope !== `contact:${input.contactId}` ||
      object.environmentScope !== (process.env.NODE_ENV || "development") ||
      object.validationState !== "validated" || object.retentionState !== "active") {
    throw new Error("PROTECTED_OBJECT_SCOPE_MISMATCH");
  }
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