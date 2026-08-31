/**
 * CRO-08A durable occurrence and checkpoint contract (section 12,
 * Correction 2). One row per logical due window, claimed at most once
 * (unique index on schedule_definition_id + window bounds means a second
 * concurrent claim for the same window always hits the same row). Two
 * checkpoints are tracked and advanced independently:
 *
 *  - enumeration_checkpoint: 'pending' -> 'committed', only after selected
 *    subjects + a selection receipt hash are durably written to this row.
 *  - reconciliation_checkpoint: 'pending' -> 'complete', only after every
 *    selected item this occurrence produced reaches a terminal CRO-03C
 *    disposition (reusing CRO-03C's own terminal states — this module does
 *    not invent new ones).
 *
 * The frozen cursor snapshot is captured once, at occurrence-creation time,
 * from the caller-supplied cro03a_census_cursors row(s) — this module never
 * re-reads a live cursor on its own, so a later cursor advance can never
 * make an existing occurrence's frozen window unreproducible.
 */
import { createHash } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "../../db";

const rows = (result: any): any[] => result?.rows ?? result ?? [];

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/**
 * Create (or return the existing) occurrence for a due window. Freezes the
 * caller-supplied cursor snapshot into the row; does not read
 * cro03a_census_cursors itself, so the caller is responsible for reading it
 * inside the same logical freeze step, before this call.
 */
export async function ensureCro08aScheduleOccurrence(input: {
  scheduleDefinitionId: string;
  definitionHash: string;
  windowStart: Date;
  windowEnd: Date;
  frozenCursorSnapshot: Record<string, unknown>;
  reason?: string;
}): Promise<{ id: string; created: boolean }> {
  const frozenPopulationHash = stableHash(input.frozenCursorSnapshot);
  return db.transaction(async (tx) => {
    // Lock the schedule definition row and require the caller's definition
    // hash to exactly match its current definition_hash column. Without this,
    // a caller (or a stale/racing scheduler process) could bind an occurrence
    // -- and every continuous_occurrence command created against it -- to a
    // hash that was never the definition's real content, defeating the
    // immutable-schedule-version authority the whole contract rests on.
    const definition = rows(await tx.execute(sql`
      SELECT id, definition_hash, active FROM cro08a_schedule_definitions
       WHERE id=${input.scheduleDefinitionId}::uuid FOR UPDATE
    `))[0];
    if (!definition) throw new Error("CRO08A_SCHEDULE_DEFINITION_NOT_FOUND");
    if (definition.definition_hash !== input.definitionHash) {
      throw new Error("CRO08A_DEFINITION_HASH_MISMATCH");
    }
    // Atomic, replay-safe claim: INSERT ... ON CONFLICT DO NOTHING against the
    // existing unique index on (schedule_definition_id, window_start,
    // window_end), then fetch whichever row now exists. This removes the
    // read-then-insert race where two concurrent schedulers for the same due
    // window could both observe no row and one then hit a raw unique-
    // constraint failure instead of the documented "return existing" result.
    const inserted = rows(await tx.execute(sql`
      INSERT INTO cro08a_schedule_occurrences
        (schedule_definition_id, definition_hash, window_start, window_end,
         frozen_cursor_snapshot, frozen_population_hash, reason)
      VALUES (${input.scheduleDefinitionId}::uuid, ${input.definitionHash},
              ${input.windowStart.toISOString()}::timestamptz, ${input.windowEnd.toISOString()}::timestamptz,
              ${JSON.stringify(input.frozenCursorSnapshot)}::jsonb, ${frozenPopulationHash}, ${input.reason ?? null})
      ON CONFLICT (schedule_definition_id, window_start, window_end) DO NOTHING
      RETURNING id
    `));
    if (inserted[0]) return { id: String(inserted[0].id), created: true };
    // Lost the race: another concurrent caller's insert won. Fetch its row
    // rather than treating this as a failure.
    const existing = rows(await tx.execute(sql`
      SELECT id FROM cro08a_schedule_occurrences
       WHERE schedule_definition_id=${input.scheduleDefinitionId}::uuid
         AND window_start=${input.windowStart.toISOString()}::timestamptz
         AND window_end=${input.windowEnd.toISOString()}::timestamptz
    `))[0];
    if (!existing) throw new Error("CRO08A_OCCURRENCE_CLAIM_FAILED");
    return { id: String(existing.id), created: false };
  });
}

/** Claim an open occurrence with a lease, for crash-safe resumable
 * processing. Only 'open' or lease-expired occurrences can be claimed. */
export async function claimCro08aScheduleOccurrence(input: {
  occurrenceId: string;
  claimToken: string;
  leaseMs: number;
}): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE cro08a_schedule_occurrences
       SET state='claimed', claim_token=${input.claimToken}::uuid,
           lease_expires_at=NOW() + (${input.leaseMs}::text || ' milliseconds')::interval, updated_at=NOW()
     WHERE id=${input.occurrenceId}::uuid
       AND state IN ('open','claimed','enumerating','reconciling')
       AND (lease_expires_at IS NULL OR lease_expires_at < NOW() OR claim_token=${input.claimToken}::uuid)
       AND cancel_requested_at IS NULL
  `);
  return ((result as any).rowCount ?? 0) > 0;
}

/**
 * Commit the enumeration checkpoint. Only allowed once per occurrence
 * (idempotent no-op on replay with the identical receipt hash; throws on a
 * conflicting replay, mirroring the idempotency-conflict pattern used
 * throughout CRO-03C).
 */
export async function commitCro08aEnumerationCheckpoint(input: {
  occurrenceId: string;
  claimToken: string;
  selectedCount: number;
  selectionReceiptHash: string;
  /** Exact set of handoff ids this occurrence's enumeration selected. Must
   * have exactly selectedCount distinct entries. Durably recorded so a later
   * continuous_occurrence command can be constrained to exactly this
   * authorized population instead of trusting a bare count (a count alone
   * cannot stop a caller from substituting different handoffs). */
  selectedHandoffIds: string[];
}): Promise<void> {
  const distinct = [...new Set(input.selectedHandoffIds)];
  if (distinct.length !== input.selectedHandoffIds.length || distinct.length !== input.selectedCount) {
    throw new Error("CRO08A_SELECTED_HANDOFFS_COUNT_MISMATCH");
  }
  await db.transaction(async (tx) => {
    const occurrence = rows(await tx.execute(sql`
      SELECT enumeration_checkpoint, selection_receipt_hash, claim_token
        FROM cro08a_schedule_occurrences WHERE id=${input.occurrenceId}::uuid FOR UPDATE
    `))[0];
    if (!occurrence) throw new Error("CRO08A_OCCURRENCE_NOT_FOUND");
    if (String(occurrence.claim_token) !== input.claimToken) throw new Error("CRO08A_OCCURRENCE_CLAIM_MISMATCH");
    if (occurrence.enumeration_checkpoint === "committed") {
      if (occurrence.selection_receipt_hash !== input.selectionReceiptHash) {
        throw new Error("CRO08A_ENUMERATION_ALREADY_COMMITTED_CONFLICT");
      }
      return;
    }
    await tx.execute(sql`
      UPDATE cro08a_schedule_occurrences
         SET enumeration_checkpoint='committed', enumeration_committed_at=NOW(),
             selection_receipt_hash=${input.selectionReceiptHash}, selected_count=${input.selectedCount},
             state='enumerated', updated_at=NOW()
       WHERE id=${input.occurrenceId}::uuid
    `);
    for (const handoffId of distinct) {
      await tx.execute(sql`
        INSERT INTO cro08a_occurrence_selected_handoffs (occurrence_id, handoff_id)
        VALUES (${input.occurrenceId}::uuid, ${handoffId}::uuid)
        ON CONFLICT DO NOTHING
      `);
    }
  });
}

/**
 * Bind the 1:1 continuous_occurrence CRO-03C command to this occurrence.
 * cro08a_occurrence_command_uidx (UNIQUE on cro03c_command_id) plus this
 * row-level guard together guarantee at most one command per occurrence even
 * under concurrent claim attempts on the same occurrence key.
 */
export async function bindCro08aOccurrenceCommand(input: {
  occurrenceId: string;
  cro03cCommandId: string;
}): Promise<void> {
  const result = await db.execute(sql`
    UPDATE cro08a_schedule_occurrences
       SET cro03c_command_id=${input.cro03cCommandId}::uuid, state='reconciling', updated_at=NOW()
     WHERE id=${input.occurrenceId}::uuid
       AND enumeration_checkpoint='committed'
       AND cro03c_command_id IS NULL
  `);
  if (((result as any).rowCount ?? 0) === 0) {
    // Either already bound (a concurrent winner got there first — safe,
    // caller should re-read) or enumeration was not yet committed.
    const existing = rows(await db.execute(sql`
      SELECT cro03c_command_id FROM cro08a_schedule_occurrences WHERE id=${input.occurrenceId}::uuid
    `))[0];
    if (!existing?.cro03c_command_id) throw new Error("CRO08A_OCCURRENCE_NOT_READY_FOR_COMMAND");
    if (String(existing.cro03c_command_id) !== input.cro03cCommandId) {
      throw new Error("CRO08A_OCCURRENCE_ALREADY_BOUND_TO_DIFFERENT_COMMAND");
    }
  }
}

/**
 * Advance the reconciliation checkpoint only after every selected item this
 * occurrence's bound command produced has reached a terminal CRO-03C
 * disposition. Reuses cro03c_stage_operations.state and
 * cro03c_receipts.normalized_outcome as the terminal-state source of truth
 * rather than inventing a new one.
 */
export async function tryCompleteCro08aReconciliation(occurrenceId: string): Promise<{ completed: boolean; terminalCount: number; pendingCount: number }> {
  return db.transaction(async (tx) => {
    const occurrence = rows(await tx.execute(sql`
      SELECT cro03c_command_id, reconciliation_checkpoint FROM cro08a_schedule_occurrences
       WHERE id=${occurrenceId}::uuid FOR UPDATE
    `))[0];
    if (!occurrence) throw new Error("CRO08A_OCCURRENCE_NOT_FOUND");
    if (!occurrence.cro03c_command_id) throw new Error("CRO08A_OCCURRENCE_NO_BOUND_COMMAND");
    if (occurrence.reconciliation_checkpoint === "complete") {
      return { completed: true, terminalCount: 0, pendingCount: 0 };
    }
    // Reconciliation completeness must be evaluated against the occurrence's
    // OWN durably-recorded selected-handoff population
    // (cro08a_occurrence_selected_handoffs), not merely against whatever
    // stage_operations rows happen to exist for the bound command. Two gaps
    // in the prior implementation:
    //   1. createCro03cCommand accepts any subset of the selected handoffs,
    //      so a command could cover fewer handoffs than were selected; that
    //      subset relationship was never checked here, so an occurrence
    //      could reconcile as "complete" while some selected handoffs were
    //      never even generated.
    //   2. A generation with zero cro03c_stage_operations rows (e.g. still
    //      'queued'/'claimed'/'running', or blocked before any provider
    //      operation was reserved) was invisible to the old query — it
    //      contributed to neither pending_count nor terminal_count — so it
    //      could never block completion.
    // Fix: LEFT JOIN every selected handoff to its generation (if any) for
    // the bound command, and require every one to have a generation in a
    // terminal cro03c_generations.state ('completed','failed','cancelled').
    // 'queued','claimed','running', and 'inconclusive_pending_reconciliation'
    // are all non-terminal and must block completion, exactly like a missing
    // generation does.
    const rowsOut = rows(await tx.execute(sql`
      SELECT
        h.handoff_id,
        g.state AS generation_state,
        (g.id IS NOT NULL AND g.state IN ('completed','failed','cancelled')) AS is_terminal
        FROM cro08a_occurrence_selected_handoffs h
        LEFT JOIN cro03c_generations g
          ON g.handoff_id = h.handoff_id AND g.command_id = ${occurrence.cro03c_command_id}::uuid
       WHERE h.occurrence_id = ${occurrenceId}::uuid
    `));
    if (rowsOut.length === 0) throw new Error("CRO08A_OCCURRENCE_NO_SELECTED_POPULATION");
    const terminalCount = rowsOut.filter((r: any) => r.is_terminal).length;
    const pendingCount = rowsOut.length - terminalCount;
    if (pendingCount > 0) {
      return { completed: false, terminalCount, pendingCount };
    }
    await tx.execute(sql`
      UPDATE cro08a_schedule_occurrences
         SET reconciliation_checkpoint='complete', reconciliation_completed_at=NOW(),
             terminal_count=${terminalCount},
             state='reconciled', updated_at=NOW()
       WHERE id=${occurrenceId}::uuid
    `);
    return { completed: true, terminalCount, pendingCount: 0 };
  });
}

export async function cancelCro08aScheduleOccurrence(occurrenceId: string): Promise<void> {
  // Preserve completed evidence on cancellation: only flips state/timestamp,
  // never deletes or rewrites enumeration/reconciliation checkpoints or
  // anything already committed under them.
  await db.execute(sql`
    UPDATE cro08a_schedule_occurrences
       SET cancel_requested_at=NOW(),
           state=CASE WHEN state IN ('reconciled') THEN state ELSE 'cancelled' END,
           updated_at=NOW()
     WHERE id=${occurrenceId}::uuid
  `);
}
