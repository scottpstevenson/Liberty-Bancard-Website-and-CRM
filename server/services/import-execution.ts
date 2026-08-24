import crypto from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { importExecutions, importRowDispositions } from "@shared/schema";

export type ImportDisposition = "created" | "matched_noop" | "updated" | "rejected" | "deferred" | "failed";

export interface ImportExecutionClaim {
  execution: typeof importExecutions.$inferSelect;
  claimed: boolean;
  replay: boolean;
  claimToken: string | null;
}

const LEASE_MS = 5 * 60 * 1000;

export function csvExecutionKey(fileHash: string): string {
  return `csv_contact:${fileHash}`;
}

/**
 * Atomically create or claim an import execution. A replay never receives a
 * second processor lease; an expired lease can be reclaimed safely.
 */
export async function claimCsvExecution(args: {
  fileHash: string;
  totalRows: number;
  actorType: string;
  actorId: string;
  metadata?: Record<string, unknown>;
  sourcePayload?: Array<Record<string, string>>;
}): Promise<ImportExecutionClaim> {
  const executionKey = csvExecutionKey(args.fileHash);
  const claimToken = crypto.randomUUID();
  const expiry = new Date(Date.now() + LEASE_MS);

  return db.transaction(async (tx) => {
    const inserted = await tx.insert(importExecutions).values({
      importType: "csv_contact",
      fileHash: args.fileHash,
      executionKey,
      status: "running",
      totalRows: args.totalRows,
      actorType: args.actorType,
      actorId: args.actorId,
      metadata: args.metadata ?? null,
      sourcePayload: args.sourcePayload ?? null,
      claimToken,
      leaseExpiresAt: expiry,
      heartbeatAt: new Date(),
      attemptCount: 1,
    }).onConflictDoNothing().returning();
    if (inserted[0]) return { execution: inserted[0], claimed: true, replay: false, claimToken };

    const [existing] = await tx.select().from(importExecutions)
      .where(eq(importExecutions.executionKey, executionKey)).limit(1);
    if (!existing) throw new Error("IMPORT_EXECUTION_CLAIM_RACE");
    if (existing.status === "completed") {
      return { execution: existing, claimed: false, replay: true, claimToken: null };
    }

    if (existing.status === "running" && existing.leaseExpiresAt && existing.leaseExpiresAt > new Date()) {
      return { execution: existing, claimed: false, replay: false, claimToken: null };
    }
    const reclaimed = await tx.update(importExecutions)
      .set({
        claimToken,
        leaseExpiresAt: expiry,
        heartbeatAt: new Date(),
        attemptCount: sql`${importExecutions.attemptCount} + 1`,
        status: "running",
      })
      .where(and(
        eq(importExecutions.id, existing.id),
        sql`(${importExecutions.leaseExpiresAt} IS NULL OR ${importExecutions.leaseExpiresAt} < now())`,
      ))
      .returning();
    if (reclaimed[0]) return { execution: reclaimed[0], claimed: true, replay: false, claimToken };
    return { execution: existing, claimed: false, replay: true, claimToken: null };
  });
}

export async function heartbeatImportExecution(executionId: string, claimToken: string): Promise<boolean> {
  const changed = await db.update(importExecutions)
    .set({ heartbeatAt: new Date(), leaseExpiresAt: new Date(Date.now() + LEASE_MS) })
    .where(and(eq(importExecutions.id, executionId), eq(importExecutions.claimToken, claimToken), eq(importExecutions.status, "running")))
    .returning({ id: importExecutions.id });
  return changed.length === 1;
}

/**
 * Return only executions which are safe for a recovery worker to attempt.  The
 * caller must still use claimCsvExecution before doing any work; this query is
 * deliberately advisory so two application instances can run recovery at the
 * same time without creating two owners.
 */
export async function getExpiredRecoverableCsvExecutions() {
  return db.select().from(importExecutions).where(and(
    eq(importExecutions.importType, "csv_contact"),
    eq(importExecutions.status, "running"),
    sql`${importExecutions.sourcePayload} IS NOT NULL`,
    sql`(${importExecutions.leaseExpiresAt} IS NULL OR ${importExecutions.leaseExpiresAt} < now())`,
  ));
}

export async function recordImportRowDisposition(args: {
  executionId: string;
  claimToken?: string;
  sourceRowNumber: number;
  rowFingerprint: string;
  disposition: ImportDisposition;
  reasonCode: string;
  contactId?: number | null;
  diagnostic?: Record<string, unknown> | null;
}): Promise<boolean> {
  const { claimToken: _claimToken, ...ledgerRow } = args;
  if (args.claimToken) {
    const [owner] = await db.select({ id: importExecutions.id })
      .from(importExecutions)
      .where(and(
        eq(importExecutions.id, args.executionId),
        eq(importExecutions.claimToken, args.claimToken),
        eq(importExecutions.status, "running"),
      ))
      .limit(1);
    if (!owner) throw new Error(`IMPORT_EXECUTION_LEASE_LOST:${args.executionId}`);
  }
  const result = await db.insert(importRowDispositions).values({
    ...ledgerRow,
    contactId: ledgerRow.contactId ?? null,
    diagnostic: ledgerRow.diagnostic ?? null,
  }).onConflictDoNothing().returning({ id: importRowDispositions.id });
  if (result.length === 1) return true;
  const [existing] = await db.select({
    rowFingerprint: importRowDispositions.rowFingerprint,
    disposition: importRowDispositions.disposition,
    reasonCode: importRowDispositions.reasonCode,
    contactId: importRowDispositions.contactId,
  }).from(importRowDispositions).where(and(
    eq(importRowDispositions.executionId, args.executionId),
    eq(importRowDispositions.sourceRowNumber, args.sourceRowNumber),
  )).limit(1);
  if (
    existing &&
    existing.rowFingerprint === args.rowFingerprint &&
    existing.disposition === args.disposition &&
    existing.reasonCode === args.reasonCode &&
    existing.contactId === (args.contactId ?? null)
  ) return true;
  throw new Error(`IMPORT_LEDGER_DISPOSITION_CONFLICT:${args.executionId}:${args.sourceRowNumber}`);
}

export async function getImportLedgerSummary(executionId: string) {
  const rows = await db.execute(sql`
    SELECT disposition, count(*)::int AS count
    FROM import_row_dispositions
    WHERE execution_id = ${executionId}
    GROUP BY disposition
  `);
  const counts: Record<string, number> = {};
  for (const row of ((rows as any).rows ?? [])) counts[row.disposition] = Number(row.count);
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return { counts, total };
}

export async function completeImportExecution(args: {
  executionId: string;
  claimToken: string;
  expectedRows: number;
}): Promise<{ completed: boolean; counts: Record<string, number>; total: number }> {
  const summary = await getImportLedgerSummary(args.executionId);
  if (summary.total !== args.expectedRows) {
    await db.update(importExecutions).set({
      status: "failed",
      failureReason: "LEDGER_RECONCILIATION_MISMATCH",
      heartbeatAt: new Date(),
    }).where(and(
      eq(importExecutions.id, args.executionId),
      eq(importExecutions.claimToken, args.claimToken),
      eq(importExecutions.status, "running"),
    ));
    return { completed: false, ...summary };
  }
  const completed = await db.update(importExecutions).set({
    status: "completed",
    completedAt: new Date(),
    heartbeatAt: new Date(),
    leaseExpiresAt: null,
    claimToken: null,
    insertedRows: summary.counts.created ?? 0,
    updatedRows: summary.counts.updated ?? 0,
    skippedRows: (summary.counts.matched_noop ?? 0) + (summary.counts.deferred ?? 0),
    errorRows: (summary.counts.rejected ?? 0) + (summary.counts.failed ?? 0),
  }).where(and(eq(importExecutions.id, args.executionId), eq(importExecutions.claimToken, args.claimToken)))
    .returning({ id: importExecutions.id });
  return { completed: completed.length === 1, ...summary };
}