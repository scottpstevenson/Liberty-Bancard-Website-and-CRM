/**
 * Queue-owned executor for durable statement-upload commands.
 * The command row owns lifecycle and recovery; BullMQ only transports its ID.
 */
import fs from "fs/promises";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import { and, eq, lt, or, sql } from "drizzle-orm";
import { db } from "../db";
import { statementUploadCommands } from "@shared/schema";
import { runStatementUploadChain, type StatementUploadInput } from "./statement-upload-chain";
import { markRecoverableFailed } from "./statement-upload-idempotency";

const LEASE_MS = 2 * 60 * 1000;

type PersistedInput = Omit<StatementUploadInput, "fileBuffer"> & { durableFilePath?: string };

export async function resolveStatementCommandDirectory(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): Promise<{ dir: string; disposableTestRoot: boolean }> {
  if (env.NODE_ENV !== "production" && env.STATEMENT_COMMAND_TEST_STORAGE === "true") {
    return {
      dir: await fs.mkdtemp(path.join(os.tmpdir(), "liberty-statement-command-test-")),
      disposableTestRoot: true,
    };
  }
  return { dir: path.join(cwd, "uploads", "statement-command"), disposableTestRoot: false };
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
  if (!input?.contactId || !input.source || !input.durableFilePath) {
    await markRecoverableFailed(commandId, { code: "missing_durable_upload" }, token);
    await releaseStatementCommandLease(commandId, token);
    return;
  }
  let fileBuffer: Buffer;
  try {
    fileBuffer = await fs.readFile(input.durableFilePath);
  } catch {
    await markRecoverableFailed(commandId, { code: "durable_upload_unreadable" }, token);
    await releaseStatementCommandLease(commandId, token);
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
    await runStatementUploadChain({ ...input, fileBuffer, commandId, commandLeaseToken: token });
  } catch (error) {
    await markRecoverableFailed(commandId, { code: "retryable_worker_failure" }, token);
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
  if (!input.commandId || !input.fileBuffer || !input.fileName) return false;
  const { dir } = await resolveStatementCommandDirectory();
  await fs.mkdir(dir, { recursive: true });
  const durableFilePath = path.join(dir, `${input.commandId}-${path.basename(input.fileName).replace(/[^a-zA-Z0-9._-]/g, "_")}`);
  await fs.writeFile(durableFilePath, input.fileBuffer, { flag: "wx" }).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  const persisted = await db.update(statementUploadCommands).set({
    context: { ...input, fileBuffer: undefined, durableFilePath },
    updatedAt: new Date(),
  }).where(and(eq(statementUploadCommands.id, input.commandId), eq(statementUploadCommands.status, "in_progress"))).returning({ id: statementUploadCommands.id });
  if (persisted.length !== 1) return false;
  return enqueueStatementUploadCommandId(input.commandId);
}