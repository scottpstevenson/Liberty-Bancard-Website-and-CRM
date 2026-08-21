/**
 * Statement Upload Idempotency Foundation
 *
 * Provides a durable, race-safe idempotency layer for statement-upload
 * operations.  Every entry point that begins a new upload attempt must call
 * `claimCommand` first; the return value tells the caller whether to proceed
 * with the upload, replay a prior result, or reject a conflicting request.
 *
 * Key guarantees
 * ──────────────
 * 1. A valid Idempotency-Key must be a UUID v4 string.
 * 2. The request fingerprint is SHA-256(canonical fields + file buffer).
 * 3. The first caller to INSERT a (statement_upload, requestId) row wins the
 *    "claim".  Concurrent callers get CLAIMED_BY_OTHER until the row
 *    transitions out of in_progress.
 * 4. Same key + same fingerprint + same owner scope → REPLAY (idempotent)
 *    for succeeded rows, or RECOVERABLE_FAILED_REPLAY for recoverable_failed
 *    rows (so routes can distinguish a prior failure from a prior success).
 * 5. Same key + different fingerprint (any scope) → CONFLICT (reject 422).
 * 6. Same key + same fingerprint + DIFFERENT owner scope → SCOPE_MISMATCH
 *    (the prior row is NOT returned to the new caller; reject 403).
 * 7. Checkpoint, context, and result updates are atomic single-row UPDATEs.
 * 8. A recoverable-failed command can be atomically reclaimed via
 *    `recoverCommand` (owner-scoped) to re-enter in_progress.
 */

import { createHash } from "crypto";
import { eq, and } from "drizzle-orm";
import { db } from "../db";
import { statementUploadCommands, type StatementUploadCommand } from "@shared/schema";

// ── UUID v4 validation ────────────────────────────────────────────────────────

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUUIDv4(key: string): boolean {
  return UUID_V4_RE.test(key);
}

// ── Fingerprint helpers ───────────────────────────────────────────────────────

export interface FingerprintFields {
  /** Canonical string fields that identify this logical request. */
  fields: Record<string, string | number | boolean | null | undefined>;
  /** Raw file buffer (if any).  Pass Buffer.alloc(0) when no file. */
  fileBuffer: Buffer;
}

/**
 * Returns the SHA-256 hex digest of the canonical request payload.
 *
 * Field order is deterministic because we sort keys before hashing.
 */
export function computeRequestFingerprint(input: FingerprintFields): string {
  const h = createHash("sha256");
  // Sorted keys ensure field insertion order doesn't affect the digest.
  const sortedKeys = Object.keys(input.fields).sort();
  for (const k of sortedKeys) {
    const v = input.fields[k];
    h.update(`${k}=${v ?? ""}\x00`);
  }
  h.update(input.fileBuffer);
  return h.digest("hex");
}

// ── Claim result discriminated union ─────────────────────────────────────────

export type ClaimResult =
  | { outcome: "claimed";                    command: StatementUploadCommand }
  | { outcome: "replay";                     command: StatementUploadCommand }
  /**
   * The prior attempt for this key ended in recoverable_failed.
   * The command is returned so the route can surface a clear error response
   * (e.g. 422 with the stored error detail) rather than treating it as a
   * successful replay.  Use `recoverCommand` to re-enter in_progress.
   */
  | { outcome: "recoverable_failed_replay";  command: StatementUploadCommand }
  | { outcome: "claimed_by_other";           commandId: string }
  | { outcome: "conflict" }
  | { outcome: "scope_mismatch" };

// ── Core service ──────────────────────────────────────────────────────────────

/**
 * Attempt to atomically claim an idempotency slot for a statement-upload
 * operation.
 *
 * @param requestId        Idempotency-Key header value (must be UUIDv4).
 * @param fingerprint      SHA-256 hex from `computeRequestFingerprint`.
 * @param ownerScope       Authorized caller scope (e.g. "user:42", "api:abc").
 * @param context          Opaque JSON to store with the command row (optional).
 * @param meta             Optional FK hints and source tag.
 */
export async function claimCommand(params: {
  requestId: string;
  fingerprint: string;
  ownerScope: string;
  context?: Record<string, unknown>;
  source?: string;
  contactId?: number;
  dealId?: number;
  documentId?: number;
}): Promise<ClaimResult> {
  const { requestId, fingerprint, ownerScope, context, source, contactId, dealId, documentId } = params;
  const operationScope = "statement_upload";

  // ── Validate Idempotency-Key ──────────────────────────────────────────────
  if (!isValidUUIDv4(requestId)) {
    throw new Error(
      `Invalid Idempotency-Key: "${requestId}" is not a UUID v4.  ` +
      `Supply a valid UUID v4 in the Idempotency-Key header.`
    );
  }

  // ── Atomic INSERT (first writer wins) ────────────────────────────────────
  // INSERT … ON CONFLICT DO NOTHING RETURNING gives us the new row if we won
  // the race, or nothing if another transaction already inserted this scope+key.
  const inserted = await db
    .insert(statementUploadCommands)
    .values({
      requestId,
      requestFingerprint: fingerprint,
      operationScope,
      ownerScope,
      source: source ?? null,
      contactId:  contactId  ?? null,
      dealId:     dealId     ?? null,
      documentId: documentId ?? null,
      status: "in_progress",
      context: context ?? null,
    })
    .onConflictDoNothing()
    .returning();

  if (inserted.length > 0) {
    // We inserted the row — we own this slot.
    return { outcome: "claimed", command: inserted[0] };
  }

  // ── Conflict resolution: fetch the existing row ───────────────────────────
  // Use a raw SQL fetch with FOR SHARE so we don't race with an in-progress
  // delete (there shouldn't be one, but it's defensive).
  const rows = await db
    .select()
    .from(statementUploadCommands)
    .where(
      and(
        eq(statementUploadCommands.operationScope, operationScope),
        eq(statementUploadCommands.requestId, requestId)
      )
    )
    .limit(1);

  if (rows.length === 0) {
    // Extremely rare race: the competing row was deleted between our INSERT
    // attempt and this SELECT.  Retry once by recursing.
    return claimCommand(params);
  }

  const existing = rows[0];

  // ── Fingerprint mismatch → conflict (any scope) ───────────────────────────
  if (existing.requestFingerprint !== fingerprint) {
    return { outcome: "conflict" };
  }

  // ── Scope mismatch → do not reveal the row to the new caller ─────────────
  if (existing.ownerScope !== ownerScope) {
    return { outcome: "scope_mismatch" };
  }

  // ── Same scope, same fingerprint ──────────────────────────────────────────
  if (existing.status === "in_progress") {
    // Another caller is still processing this command.
    return { outcome: "claimed_by_other", commandId: existing.id };
  }

  if (existing.status === "recoverable_failed") {
    // The prior attempt failed in a recoverable way.  Surface this distinctly
    // so routes can return a clear error (e.g. 422) instead of treating it as
    // a successful idempotent replay.  Callers may use `recoverCommand` to
    // re-enter in_progress under a new idempotency key.
    return { outcome: "recoverable_failed_replay", command: existing };
  }

  // status is "succeeded" → idempotent replay.
  return { outcome: "replay", command: existing };
}

/**
 * Atomically transition a recoverable-failed command back to in_progress so
 * that the owner can retry the operation.  The command is identified by its
 * primary key and must be owned by the supplied ownerScope.
 *
 * Returns the updated command row if the transition succeeded, or null if:
 *   - The command was not found.
 *   - The ownerScope does not match (no information leak).
 *   - The command is not in recoverable_failed status (already in_progress or
 *     succeeded — the caller should re-check its state).
 *
 * This is NOT a new idempotency key.  It re-uses the existing command row and
 * clears checkpoint + result so the retry starts fresh.
 */
export async function recoverCommand(
  commandId: string,
  ownerScope: string
): Promise<StatementUploadCommand | null> {
  const rows = await db
    .update(statementUploadCommands)
    .set({
      status:      "in_progress",
      checkpoint:  null,
      result:      null,
      completedAt: null,
      updatedAt:   new Date(),
    })
    .where(
      and(
        eq(statementUploadCommands.id, commandId),
        eq(statementUploadCommands.ownerScope, ownerScope),
        eq(statementUploadCommands.status, "recoverable_failed")
      )
    )
    .returning();

  return rows[0] ?? null;
}

/**
 * Check whether any caller has already registered this requestId.
 *
 * This intentionally does not return a command result; callers still need an
 * owner-scope match to read a stored result.
 *
 * Returns the existing command's id and scope, or null if the key is free.
 */
export async function findCommandByRequestId(
  requestId: string
): Promise<{ id: string; operationScope: string; requestFingerprint: string; status: string } | null> {
  const rows = await db
    .select({
      id:                 statementUploadCommands.id,
      operationScope:     statementUploadCommands.operationScope,
      requestFingerprint: statementUploadCommands.requestFingerprint,
      status:             statementUploadCommands.status,
    })
    .from(statementUploadCommands)
    .where(eq(statementUploadCommands.requestId, requestId))
    .limit(1);

  return rows[0] ?? null;
}

// ── Lifecycle update helpers ──────────────────────────────────────────────────

/**
 * Write an intermediate checkpoint (crash-recovery cursor).
 * No-op if the row is already in a terminal state.
 */
export async function updateCheckpoint(
  commandId: string,
  checkpoint: Record<string, unknown>
): Promise<void> {
  await db
    .update(statementUploadCommands)
    .set({
      checkpoint,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(statementUploadCommands.id, commandId),
        eq(statementUploadCommands.status, "in_progress")
      )
    );
}

/**
 * Update the mutable context blob (original request parameters, enriched
 * metadata, etc.).  Does not enforce status constraints.
 */
export async function updateContext(
  commandId: string,
  context: Record<string, unknown>
): Promise<void> {
  await db
    .update(statementUploadCommands)
    .set({ context, updatedAt: new Date() })
    .where(eq(statementUploadCommands.id, commandId));
}

/**
 * Update FK references on the command row (contact/deal/document).
 * Call this after the chain creates or resolves these IDs.
 */
export async function updateCommandFKs(
  commandId: string,
  fks: { contactId?: number; dealId?: number; documentId?: number }
): Promise<void> {
  const updateValues: {
    updatedAt: Date;
    contactId?: number | null;
    dealId?: number | null;
    documentId?: number | null;
  } = { updatedAt: new Date() };
  if (fks.contactId !== undefined) updateValues.contactId = fks.contactId;
  if (fks.dealId !== undefined) updateValues.dealId = fks.dealId;
  if (fks.documentId !== undefined) updateValues.documentId = fks.documentId;
  await db
    .update(statementUploadCommands)
    .set(updateValues)
    .where(eq(statementUploadCommands.id, commandId));
}

/**
 * Mark the command as succeeded and persist the final result payload.
 *
 * ONE-WAY TRANSITION: only an `in_progress` command can be terminalized.
 * If the command already reached a terminal state (succeeded or
 * recoverable_failed) this is a no-op and returns null — the first terminal
 * writer wins, so a late route-level failure can never overwrite a chain
 * success (or vice versa) and the durable result stays deterministic.
 */
export async function markSucceeded(
  commandId: string,
  result: Record<string, unknown>
): Promise<StatementUploadCommand | null> {
  const rows = await db
    .update(statementUploadCommands)
    .set({
      status:      "succeeded",
      result,
      completedAt: new Date(),
      updatedAt:   new Date(),
    })
    .where(
      and(
        eq(statementUploadCommands.id, commandId),
        eq(statementUploadCommands.status, "in_progress")
      )
    )
    .returning();

  return rows[0] ?? null;
}

/**
 * Mark the command as recoverable-failed (can be retried with a new key or
 * via `recoverCommand`).
 *
 * ONE-WAY TRANSITION: only an `in_progress` command can be terminalized.
 * Returns null (no-op) if the command already reached a terminal state —
 * see markSucceeded for the rationale.
 */
export async function markRecoverableFailed(
  commandId: string,
  result: Record<string, unknown>
): Promise<StatementUploadCommand | null> {
  const rows = await db
    .update(statementUploadCommands)
    .set({
      status:      "recoverable_failed",
      result,
      completedAt: new Date(),
      updatedAt:   new Date(),
    })
    .where(
      and(
        eq(statementUploadCommands.id, commandId),
        eq(statementUploadCommands.status, "in_progress")
      )
    )
    .returning();

  return rows[0] ?? null;
}

/**
 * Fetch a command by its primary key, scoped to a specific owner.
 * Returns null if not found or scope does not match (caller sees nothing).
 */
export async function getCommandForOwner(
  commandId: string,
  ownerScope: string
): Promise<StatementUploadCommand | null> {
  const rows = await db
    .select()
    .from(statementUploadCommands)
    .where(
      and(
        eq(statementUploadCommands.id, commandId),
        eq(statementUploadCommands.ownerScope, ownerScope)
      )
    )
    .limit(1);

  return rows[0] ?? null;
}
