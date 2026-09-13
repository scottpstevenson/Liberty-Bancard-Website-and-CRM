/**
 * CRO-08A Processor Worker (MI-09)
 *
 * Claims pending CRO-08A schedule occurrences, enumerates the frozen cohort,
 * binds CRO-03C commands for each subject, advances checkpoints, and
 * reconciles once all subjects reach terminal state.
 *
 * Resumability contract:
 *   1. committed AND command bound → skip enumeration AND command binding; go to reconciliation.
 *   2. committed AND no command   → re-enumerate (same deterministic result from identical
 *                                   cursor bounds), skip checkpoint commit (already committed),
 *                                   retry command binding.
 *   3. not committed              → enumerate, commit checkpoint, bind command.
 *
 * Lease-renewal: opts.extendLock() called before the default lockDuration expires.
 * Failure path: lease is expired (not occurrence marked 'failed') so BullMQ can retry.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import {
  commitCro08aEnumerationCheckpoint,
  tryCompleteCro08aReconciliation,
} from "../services/cro08a/occurrence-service";
import { createCro03cCommand } from "../services/cro03/live-execution";
import { assertCro08aSourceScope } from "../services/cro08a/source-scope";
import { createHash } from "crypto";

const rows = (r: any): any[] => r?.rows ?? r ?? [];

export const CRO08A_PROCESSOR_JOB_NAME = "cro08a-processor-run";

const MAX_RECONCILIATION_POLLS = 12; // up to ~2 minutes of polling
const RECONCILIATION_POLL_INTERVAL_MS = 10_000;
const PROCESSOR_LEASE_MS = 120_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/**
 * Find the oldest open (unclaimed / lease-expired) occurrence and claim it.
 * Returns null if there are no claimable occurrences.
 */
async function findAndClaimOccurrence(claimToken: string): Promise<{
  occurrenceId: string;
  frozenCursorSnapshot: Record<string, unknown>;
} | null> {
  const found = rows(await db.execute(sql`
    UPDATE cro08a_schedule_occurrences
       SET state = 'claimed',
           claim_token = ${claimToken}::uuid,
           lease_expires_at = NOW() + (${String(PROCESSOR_LEASE_MS)} || ' milliseconds')::interval,
           updated_at = NOW()
     WHERE id = (
       SELECT id FROM cro08a_schedule_occurrences
        WHERE state IN ('open', 'claimed', 'enumerating', 'enumerated', 'reconciling')
          AND (lease_expires_at IS NULL OR lease_expires_at < NOW() OR claim_token = ${claimToken}::uuid)
          AND cancel_requested_at IS NULL
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
     )
     RETURNING id, frozen_cursor_snapshot
  `));
  if (!found.length) return null;
  const row = found[0];
  return {
    occurrenceId: String(row.id),
    frozenCursorSnapshot: (typeof row.frozen_cursor_snapshot === "string"
      ? JSON.parse(row.frozen_cursor_snapshot)
      : row.frozen_cursor_snapshot) as Record<string, unknown>,
  };
}

/**
 * Enumerate handoffs from cro03a_handoffs for a given source system,
 * bounded by the current occurrence's frozen snapshot as the UPPER bound and the
 * PRIOR committed occurrence's snapshot_high_water as the EXCLUSIVE LOWER bound.
 *
 * The lower bound is derived from CRO-08A's own occurrence history, NOT from
 * cro03a_census_cursors.cursor_value (which is the CRO-03A staging cursor and is
 * advanced as rows are staged — when fully caught up, cursor_value == snapshot_high_water,
 * making the range (cursor_value, snapshot_high_water] empty, causing every occurrence to
 * produce zero subjects). By deriving the lower bound from the prior occurrence's
 * snapshot_high_water, consecutive occurrences process non-overlapping windows:
 *
 *   Occurrence 1: (0,            snapshot_hw_1]
 *   Occurrence 2: (snapshot_hw_1, snapshot_hw_2]
 *   Occurrence 3: (snapshot_hw_2, snapshot_hw_3]
 *
 * priorSnapshotHighWater: numeric; priorSnapshotHighWaterText: UUID variant.
 * When null (first ever occurrence for this definition), the lower bound is open (select all up to high-water).
 *
 * Returns handoff UUIDs in source_key order (deterministic for retry).
 */
async function enumerateHandoffsForSource(
  adapterKey: string,
  snap: {
    snapshotHighWater?: string;
    snapshotHighWaterText?: string | null;
  } | undefined,
  priorHighWater: {
    numericLow?: bigint | null;
    uuidLow?: string | null;
  },
  limit: number,
): Promise<string[]> {
  const isUuidCursor = snap?.snapshotHighWaterText != null && snap.snapshotHighWaterText !== "";
  const uuidHighWater = isUuidCursor ? String(snap!.snapshotHighWaterText!) : null;
  const numHighWater  = !isUuidCursor && snap?.snapshotHighWater
    ? BigInt(snap.snapshotHighWater) : null;

  let result: any[];
  if (isUuidCursor && uuidHighWater) {
    const uuidLow = priorHighWater.uuidLow ?? null;
    if (uuidLow) {
      result = rows(await db.execute(sql`
        SELECT h.id
          FROM cro03a_handoffs h
         WHERE h.source_system = ${adapterKey}
           AND h.effect_authorized = false
           AND h.source_key::uuid >  ${uuidLow}::uuid
           AND h.source_key::uuid <= ${uuidHighWater}::uuid
         ORDER BY h.source_key::uuid
         LIMIT ${limit}
      `));
    } else {
      result = rows(await db.execute(sql`
        SELECT h.id
          FROM cro03a_handoffs h
         WHERE h.source_system = ${adapterKey}
           AND h.effect_authorized = false
           AND h.source_key::uuid <= ${uuidHighWater}::uuid
         ORDER BY h.source_key::uuid
         LIMIT ${limit}
      `));
    }
  } else if (numHighWater !== null && numHighWater > 0n) {
    const numLow = priorHighWater.numericLow ?? null;
    if (numLow !== null && numLow > 0n) {
      result = rows(await db.execute(sql`
        SELECT h.id
          FROM cro03a_handoffs h
         WHERE h.source_system = ${adapterKey}
           AND h.effect_authorized = false
           AND h.source_key::bigint >  ${String(numLow)}::bigint
           AND h.source_key::bigint <= ${String(numHighWater)}::bigint
         ORDER BY h.source_key::bigint
         LIMIT ${limit}
      `));
    } else {
      result = rows(await db.execute(sql`
        SELECT h.id
          FROM cro03a_handoffs h
         WHERE h.source_system = ${adapterKey}
           AND h.effect_authorized = false
           AND h.source_key::bigint <= ${String(numHighWater)}::bigint
         ORDER BY h.source_key::bigint
         LIMIT ${limit}
      `));
    }
  } else {
    // No frozen bound: enumerate without predicate (should not occur in production).
    result = rows(await db.execute(sql`
      SELECT h.id
        FROM cro03a_handoffs h
       WHERE h.source_system = ${adapterKey}
         AND h.effect_authorized = false
       ORDER BY h.source_key
       LIMIT ${limit}
    `));
  }
  return result.map((r: any) => String(r.id));
}

/**
 * Derive the exclusive lower bound for CRO-08A handoff enumeration from the prior
 * committed occurrence's ACTUALLY SELECTED handoffs (not from snapshot_high_water).
 *
 * Why not snapshot_high_water: if batch_size < window_size, snapshot_high_water of the
 * prior occurrence would skip past unprocessed handoffs. Example: 1,000 new handoffs with
 * batch_size=50 → occurrence 1 selects keys 1-50 → MAX selected source_key = 50 → next
 * occurrence lower bound = 50 → selects keys 51-100 → ... → occurrence 20 selects 951-1000.
 * Using snapshot_high_water instead would let occurrence 2 start from 1,000, permanently
 * losing the 950 un-enriched handoffs.
 *
 * We derive the lower bound by joining cro08a_occurrence_selected_handoffs with
 * cro03a_handoffs to find the MAX source_key among those the prior occurrence actually
 * committed. This is CRO-08A's own durable consumption cursor.
 */
async function getPriorOccurrenceHighWater(
  scheduleDefinitionId: string,
  currentOccurrenceId: string,
  adapterKeys: string[],
): Promise<Record<string, { numericLow: bigint | null; uuidLow: string | null }>> {
  const result: Record<string, { numericLow: bigint | null; uuidLow: string | null }> = {};

  // Find the most recent prior committed occurrence for this schedule definition.
  const priorRow = rows(await db.execute(sql`
    SELECT id, frozen_cursor_snapshot
    FROM cro08a_schedule_occurrences
    WHERE schedule_definition_id = ${scheduleDefinitionId}::uuid
      AND id != ${currentOccurrenceId}::uuid
      AND reconciliation_checkpoint = 'complete'
    ORDER BY created_at DESC
    LIMIT 1
  `))[0];

  if (!priorRow) {
    // First occurrence — all adapters get null lower bound (process from the beginning).
    for (const key of adapterKeys) result[key] = { numericLow: null, uuidLow: null };
    return result;
  }

  const priorOccurrenceId = String(priorRow.id);
  const priorSnap: Record<string, any> = typeof priorRow.frozen_cursor_snapshot === "string"
    ? JSON.parse(priorRow.frozen_cursor_snapshot)
    : priorRow.frozen_cursor_snapshot ?? {};

  for (const adapterKey of adapterKeys) {
    const adapterSnap = priorSnap[adapterKey];
    const isUuid = adapterSnap?.snapshotHighWaterText != null && adapterSnap.snapshotHighWaterText !== "";

    if (isUuid) {
      // UUID cursor: find the MAX source_key (UUID text) among selected handoffs for this adapter.
      // UUID ordering is not numerically meaningful, but MAX on UUID text gives a consistent
      // sentinel — if the prior occurrence selected any handoffs from this adapter, we get a value
      // that ensures the current occurrence won't re-process the same rows (they'll be filtered
      // by effect_authorized=false which is updated after each handoff is processed).
      // This is a best-effort bound; the effect_authorized=false filter is the primary guard.
      const maxRow = rows(await db.execute(sql`
        SELECT MAX(h.source_key)::text AS max_key
        FROM cro08a_occurrence_selected_handoffs osh
        JOIN cro03a_handoffs h ON h.id = osh.handoff_id::uuid
        WHERE osh.occurrence_id = ${priorOccurrenceId}::uuid
          AND h.source_system = ${adapterKey}
      `))[0];
      result[adapterKey] = { numericLow: null, uuidLow: maxRow?.max_key ?? null };
    } else {
      // Numeric cursor: find the MAX source_key::bigint among selected handoffs for this adapter.
      // This is the exact last source_key the prior occurrence consumed — the next occurrence
      // starts from exactly here, ensuring no gaps and no double-processing.
      const maxRow = rows(await db.execute(sql`
        SELECT MAX(h.source_key::bigint) AS max_key
        FROM cro08a_occurrence_selected_handoffs osh
        JOIN cro03a_handoffs h ON h.id = osh.handoff_id::uuid
        WHERE osh.occurrence_id = ${priorOccurrenceId}::uuid
          AND h.source_system = ${adapterKey}
      `))[0];
      result[adapterKey] = {
        numericLow: maxRow?.max_key != null ? BigInt(maxRow.max_key) : null,
        uuidLow: null,
      };
    }
  }
  return result;
}

/**
 * Bind a CRO-03C command for the given occurrence and handoff set.
 * Idempotent via stableHash-derived idempotencyKey.
 */
async function bindCro03cCommand(
  occurrenceId: string,
  handoffIds: string[],
  selectionReceiptHash: string,
  claimToken: string,
): Promise<string> {
  // Fetch the occurrence's definition hash and logical_key.
  const occRow = rows(await db.execute(sql`
    SELECT o.id, o.schedule_definition_id, d.definition_hash, d.logical_key
    FROM cro08a_schedule_occurrences o
    JOIN cro08a_schedule_definitions d ON d.id = o.schedule_definition_id
    WHERE o.id = ${occurrenceId}::uuid
  `))[0];
  if (!occRow) throw new Error(`CRO08A_PROCESSOR_OCCURRENCE_NOT_FOUND:${occurrenceId}`);

  // Fetch the latest approved policy revision + latest unexpired attestation separately.
  // cro03c_activation_policies does NOT have a runtime_attestation_id FK column.
  // The two are linked by ceremony, not by a DB FK — query each table independently.
  const policyRow = rows(await db.execute(sql`
    SELECT expected_revision
    FROM cro03c_activation_policies
    WHERE policy_key = 'cro03c_live_activation'
      AND status = 'approved'
    ORDER BY expected_revision DESC
    LIMIT 1
  `))[0];
  if (!policyRow) throw new Error("CRO08A_PROCESSOR_NO_ACTIVE_POLICY");
  const attestationRow = rows(await db.execute(sql`
    SELECT id FROM cro03c_runtime_attestations
    WHERE expires_at > NOW()
    ORDER BY issued_at DESC
    LIMIT 1
  `))[0];
  if (!attestationRow) throw new Error("CRO08A_PROCESSOR_NO_VALID_ATTESTATION");

  const providerKeyMap: Record<string, string> = {
    candidate_enrichment:        "serper",
    candidate_freshness_refresh: "serper",
    candidate_discovery:         "outscraper",
    candidate_backfill:          "apollo",
  };
  const derivedProvider = providerKeyMap[String(occRow.logical_key)] ?? "serper";

  // Idempotent key: bound to occurrence + selection hash to avoid duplicate commands on retry.
  const commandIdem = stableHash({
    occurrenceId,
    selectionReceiptHash,
    processor: "cro08a-processor-worker-v1",
  }).slice(0, 128);

  const { commandId } = await createCro03cCommand({
    actorId:                    "cro08a-processor",
    idempotencyKey:             commandIdem,
    commandType:                "continuous_occurrence",
    expectedActivationRevision: Number(policyRow.expected_revision),
    runtimeAttestationId:       String(attestationRow.id),
    handoffIds,
    provider:                   derivedProvider as any,
    reason:                     `CRO-08A occurrence ${occurrenceId} — ${occRow.logical_key}`,
    expiresAt:                  new Date(Date.now() + 4 * 3600_000),
    scheduleOccurrenceId:       occurrenceId,
    scheduleDefinitionHash:     String(occRow.definition_hash),
  });

  console.log(`[CRO08A-Processor] Occurrence ${occurrenceId}: bound CRO-03C command ${commandId}`);
  return commandId;
}

/**
 * Process one pending CRO-08A occurrence:
 * 1. Find and claim a pending occurrence (FOR UPDATE SKIP LOCKED).
 * 2. Read occurrence state to determine resumability case.
 * 3. Enumerate subjects (or recover committed population) + commit checkpoint.
 * 4. Bind a CRO-03C command for the enumerated population.
 * 5. Poll reconciliation until complete or timeout.
 */
export async function processCro08aOccurrence(opts?: {
  extendLock?: () => Promise<void>;
}): Promise<{
  claimed: boolean;
  occurrenceId?: string;
  enumeratedCount?: number;
  reconciled?: boolean;
  error?: string;
}> {
  const claimToken = createHash("sha256")
    .update(`cro08a-processor-${Date.now()}-${Math.random()}`)
    .digest("hex")
    .slice(0, 32);

  // Step 1: Claim a pending occurrence.
  let claimedOccurrence: Awaited<ReturnType<typeof findAndClaimOccurrence>>;
  try {
    claimedOccurrence = await findAndClaimOccurrence(claimToken);
  } catch (err: any) {
    throw new Error(`CRO08A_PROCESSOR_CLAIM_ERROR: ${err?.message}`);
  }
  if (!claimedOccurrence) return { claimed: false };

  const { occurrenceId, frozenCursorSnapshot } = claimedOccurrence;
  console.log(`[CRO08A-Processor] Claimed occurrence ${occurrenceId}`);

  if (opts?.extendLock) { try { await opts.extendLock(); } catch {} }

  // Step 2: Load schedule definition's batch_size (global cap).
  const defRow = rows(await db.execute(sql`
    SELECT d.batch_size
    FROM cro08a_schedule_occurrences o
    JOIN cro08a_schedule_definitions d ON d.id = o.schedule_definition_id
    WHERE o.id = ${occurrenceId}::uuid
  `))[0];
  if (!defRow) throw new Error(`CRO08A_PROCESSOR_DEFINITION_NOT_FOUND:occurrence=${occurrenceId}`);
  const globalBatchSize = Math.max(1, Number(defRow.batch_size ?? 500));

  // Step 3: Read occurrence state to determine resumability case.
  const occurrenceState = rows(await db.execute(sql`
    SELECT enumeration_checkpoint, cro03c_command_id, state
    FROM cro08a_schedule_occurrences WHERE id = ${occurrenceId}::uuid
  `))[0];

  const isEnumerationCommitted = occurrenceState?.enumeration_checkpoint === "committed";
  const isCommandBound         = occurrenceState?.cro03c_command_id != null;

  // Case 1: both committed and command bound → skip to reconciliation.
  if (isEnumerationCommitted && isCommandBound) {
    console.log(`[CRO08A-Processor] Occurrence ${occurrenceId}: resuming — committed + command bound`);
    return await pollAndReturnReconciliation(occurrenceId, claimToken, 0, opts);
  }

  // Cases 2 and 3: either not committed or committed without a command.
  // For case 2 (committed + no command): load the exact committed population from
  // cro08a_occurrence_selected_handoffs (the durable selected-handoff registry written
  // by commitCro08aEnumerationCheckpoint). This is required because handoff eligibility
  // may change between retries (e.g. new handoffs inserted, old ones removed), so
  // re-enumerating from mutable source tables would produce a different set than the
  // one originally committed — causing selection_receipt_hash mismatch and permanent failure.
  // For case 3 (not committed): enumerate from source tables, then commit.
  try {
    let subjectHandoffIds: string[];

    if (isEnumerationCommitted) {
      // Case 2: Load the exact durable committed set from the selected_handoffs registry.
      const committedRows = rows(await db.execute(sql`
        SELECT handoff_id::text AS id
          FROM cro08a_occurrence_selected_handoffs
         WHERE occurrence_id = ${occurrenceId}::uuid
         ORDER BY handoff_id
      `));
      subjectHandoffIds = committedRows.map((r: any) => String(r.id));
      console.log(`[CRO08A-Processor] Occurrence ${occurrenceId}: loaded ${subjectHandoffIds.length} committed handoffs from registry (case 2: committed + no command)`);
    } else {
      // Case 3: Enumerate from source tables using frozen cursor bounds.
      const adapterKeys = Object.keys(frozenCursorSnapshot);
      if (adapterKeys.length === 0) throw new Error("CRO08A_PROCESSOR_EMPTY_CURSOR_SNAPSHOT");
      // CRO-08A source-scope contract: reject (never silently skip) any DBPR or
      // non-allowlisted source system before it can ever be enumerated for
      // handoffs. See server/services/cro08a/source-scope.ts.
      assertCro08aSourceScope(adapterKeys);

      // Derive the schedule definition ID for looking up prior occurrence high-water marks.
      const scheduleDefRow = rows(await db.execute(sql`
        SELECT schedule_definition_id::text AS schedule_definition_id
        FROM cro08a_schedule_occurrences WHERE id = ${occurrenceId}::uuid
      `))[0];
      const scheduleDefinitionId = scheduleDefRow?.schedule_definition_id ?? "";

      // Get prior committed occurrence's snapshot_high_water for each adapter.
      // This is CRO-08A's own consumption cursor — NOT cro03a_census_cursors.cursor_value
      // (which is the staging cursor and would be equal to snapshot_high_water when caught up,
      // causing every occurrence to enumerate zero subjects).
      const priorHighWaters = await getPriorOccurrenceHighWater(scheduleDefinitionId, occurrenceId, adapterKeys);

      const handoffRows: string[] = [];
      for (const adapterKey of adapterKeys) {
        const snap = frozenCursorSnapshot[adapterKey] as {
          snapshotHighWater?: string;
          snapshotHighWaterText?: string | null;
          updatedAt?: string;
        } | undefined;
        const priorHw = priorHighWaters[adapterKey] ?? { numericLow: null, uuidLow: null };
        const adapterHandoffs = await enumerateHandoffsForSource(adapterKey, snap, priorHw, globalBatchSize);
        handoffRows.push(...adapterHandoffs);
      }

      // Enforce global batch_size across all sources.
      subjectHandoffIds = handoffRows.slice(0, globalBatchSize);
    }

    if (opts?.extendLock) { try { await opts.extendLock(); } catch {} }

    if (subjectHandoffIds.length === 0) {
      // No subjects: occurrence is complete (nothing to process).
      console.warn(`[CRO08A-Processor] Occurrence ${occurrenceId}: zero subjects — reconciling immediately`);
      await db.execute(sql`
        UPDATE cro08a_schedule_occurrences
           SET enumeration_checkpoint = 'committed',
               reconciliation_checkpoint = 'complete',
               state = 'reconciled',
               reconciliation_completed_at = NOW(),
               terminal_count = 0,
               updated_at = NOW()
         WHERE id = ${occurrenceId}::uuid
      `);
      return { claimed: true, occurrenceId, enumeratedCount: 0, reconciled: true };
    }

    const selectionReceiptHash = stableHash({
      occurrenceId,
      handoffIds: [...subjectHandoffIds].sort(),
    });

    // Commit checkpoint ONLY if not already committed (case 3; skip for case 2).
    if (!isEnumerationCommitted) {
      await commitCro08aEnumerationCheckpoint({
        occurrenceId,
        claimToken,
        selectedCount: subjectHandoffIds.length,
        selectionReceiptHash,
        selectedHandoffIds: subjectHandoffIds,
      });
      console.log(`[CRO08A-Processor] Occurrence ${occurrenceId}: committed ${subjectHandoffIds.length} handoffs`);
    } else {
      console.log(`[CRO08A-Processor] Occurrence ${occurrenceId}: checkpoint already committed; retrying command binding for ${subjectHandoffIds.length} handoffs`);
    }

    if (opts?.extendLock) { try { await opts.extendLock(); } catch {} }

    // Bind command (idempotent — safe to call even if a previous attempt created one).
    await bindCro03cCommand(occurrenceId, subjectHandoffIds, selectionReceiptHash, claimToken);

    if (opts?.extendLock) { try { await opts.extendLock(); } catch {} }

    return await pollAndReturnReconciliation(occurrenceId, claimToken, subjectHandoffIds.length, opts);

  } catch (err: any) {
    // Expire the lease so BullMQ can retry — do NOT mark 'failed' (terminal state).
    console.error(`[CRO08A-Processor] Occurrence ${occurrenceId} error (retryable):`, err?.message);
    await db.execute(sql`
      UPDATE cro08a_schedule_occurrences
         SET lease_expires_at = NOW() - INTERVAL '1 second',
             updated_at = NOW()
       WHERE id = ${occurrenceId}::uuid
         AND state NOT IN ('reconciled', 'cancelled')
    `).catch(() => {});
    throw err;
  }
}

/**
 * Renew the DB lease for a claimed occurrence under claim-token CAS.
 * This prevents another worker from reclaiming the occurrence while the first
 * worker is still polling reconciliation (which can take many minutes).
 * Called alongside opts.extendLock() (BullMQ lock renewal).
 *
 * CAS condition: only update if the claim_token still matches — if it does not,
 * another worker has taken the occurrence, and we should not renew.
 */
async function renewOccurrenceDbLease(occurrenceId: string, claimToken: string): Promise<void> {
  const updated = rows(await db.execute(sql`
    UPDATE cro08a_schedule_occurrences
       SET lease_expires_at = NOW() + (${String(PROCESSOR_LEASE_MS)} || ' milliseconds')::interval,
           updated_at = NOW()
     WHERE id = ${occurrenceId}::uuid
       AND claim_token = ${claimToken}::uuid
       AND state NOT IN ('reconciled', 'cancelled')
     RETURNING id
  `));
  if (!updated.length) {
    // CAS failed: claim token no longer matches. Another worker claimed this occurrence.
    // Throw so the caller can stop processing and let the new owner proceed.
    throw new Error(
      `CRO08A_PROCESSOR_LEASE_CAS_FAILED:occurrence=${occurrenceId} — ` +
      `DB lease renewal failed: claim_token mismatch or occurrence in terminal state`,
    );
  }
}

async function pollAndReturnReconciliation(
  occurrenceId: string,
  claimToken: string,
  enumeratedCount: number,
  opts?: { extendLock?: () => Promise<void> },
): Promise<{
  claimed: boolean;
  occurrenceId: string;
  enumeratedCount: number;
  reconciled: boolean;
}> {
  let reconciled = false;
  for (let poll = 0; poll < MAX_RECONCILIATION_POLLS; poll++) {
    // Renew both BullMQ lock and DB lease before each poll.
    if (opts?.extendLock) { try { await opts.extendLock(); } catch {} }
    // DB lease renewal under claim-token CAS: throws if another worker took the occurrence.
    await renewOccurrenceDbLease(occurrenceId, claimToken);
    try {
      const result = await tryCompleteCro08aReconciliation(occurrenceId);
      if (result.completed) {
        reconciled = true;
        console.log(`[CRO08A-Processor] Occurrence ${occurrenceId} reconciled (${result.terminalCount} terminal)`);
        break;
      }
      console.log(`[CRO08A-Processor] Occurrence ${occurrenceId} reconciliation poll ${poll + 1}: ${result.terminalCount} terminal, ${result.pendingCount} pending`);
    } catch (err: any) {
      console.error(`[CRO08A-Processor] Reconciliation poll error for ${occurrenceId}:`, err?.message);
    }
    if (poll < MAX_RECONCILIATION_POLLS - 1) await sleep(RECONCILIATION_POLL_INTERVAL_MS);
  }
  if (!reconciled) {
    console.warn(`[CRO08A-Processor] Occurrence ${occurrenceId}: reconciliation incomplete after ${MAX_RECONCILIATION_POLLS} polls — leaving for next tick`);
  }
  return { claimed: true, occurrenceId, enumeratedCount, reconciled };
}

/**
 * BullMQ worker entry point: processes one occurrence per job execution.
 * The job is repeating; the worker processes whatever occurrence is next in line.
 */
export async function runCro08aProcessorJob(opts?: {
  extendLock?: () => Promise<void>;
}): Promise<void> {
  const result = await processCro08aOccurrence(opts);
  if (result.claimed) {
    console.log(
      `[CRO08A-Processor] Job complete: occurrence=${result.occurrenceId} ` +
      `enumerated=${result.enumeratedCount} reconciled=${result.reconciled}`,
    );
  }
}
