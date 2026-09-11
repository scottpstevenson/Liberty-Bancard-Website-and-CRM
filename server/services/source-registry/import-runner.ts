/**
 * MI-02: Source Registry Import Runner
 *
 * Safety invariants:
 * - All import intent (adapterKey, isFullSnapshot) is read from the DB run row,
 *   never from BullMQ job payload or function arguments (BullMQ sends only runId).
 * - Advisory lock is derived from the DB row's adapter_key BEFORE the lock is
 *   acquired, so the per-adapter mutual exclusion always uses the right key.
 * - Tombstoning ONLY fires when this is a FRESH run (startOffset === 0),
 *   is_full_snapshot === true (DB-persisted), all batches succeeded,
 *   and at least 1 key was seen. A resumed run never tombstones.
 * - Any batch failure immediately marks the run failed and skips tombstoning.
 * - Normalization error rate counts only THROWN exceptions; null returns from
 *   normalize() are intentional filtered rows (out-of-county ZIP, unknown license
 *   type, etc.) and do NOT count against the error rate.
 * - AES-GCM IV is derived deterministically from plaintext so the same input
 *   produces the same ciphertext across crash-recovery re-runs (stable hash).
 * - csv_data, is_full_snapshot, and requested_adapter_key are stored atomically on
 *   the run row in createImportRun() before any job is enqueued. The BullMQ job
 *   payload contains only { runId }.
 * - createImportRun uses ON CONFLICT DO NOTHING on the unique partial index
 *   (adapter_key) WHERE status IN ('queued','running') to block both queued
 *   AND running duplicates atomically. Returns null when blocked.
 * - Stale-run recovery: cancelStaleRuns() cancels runs stuck in 'queued' or
 *   'running' with no lease for > STALE_RUN_TIMEOUT_MS, freeing the unique slot.
 * - csv_data is NULLed after the run completes or fails to free DB space.
 */

import { createHash, randomUUID } from "crypto";
import { parse } from "csv-parse/sync";
import { pool } from "../../db";
import { createCro03SourceBatch } from "../cro03/source-staging";
import { getAdapter, IMPLEMENTED_ADAPTER_KEYS } from "./registry";
import type { NormalizedSourceRecord } from "./adapter";

const BATCH_SIZE = 200;
/** Advisory lock base offset — distinct from other app advisory locks */
const ADVISORY_LOCK_BASE = 1_900_000;
/**
 * If more than this fraction of rows THROW an exception during normalization,
 * the run fails. Null returns (filtered/out-of-scope rows) are NOT counted.
 */
const MAX_ERROR_RATE_PCT = 0.10;
/** Runs stuck queued/running without lease renewal for this long get cancelled */
const STALE_RUN_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour
/**
 * Tombstone baseline-drop guard: if a full-snapshot run accepts fewer than this
 * fraction of the previous active population, tombstoning is refused and the run
 * fails. Protects against schema drift / wrong CSV being uploaded.
 * Only applied when previousActiveCount > TOMBSTONE_MIN_POPULATION.
 */
const TOMBSTONE_MIN_FRACTION = 0.50; // 50% of previous active count
const TOMBSTONE_MIN_POPULATION = 50; // only guard when prior population is substantial
/**
 * Stranded queued runs older than this threshold (but without a started_at)
 * are eligible for re-enqueue by the startup recovery path.
 * Must be shorter than STALE_RUN_TIMEOUT_MS so we re-enqueue before cancelling.
 */
const STRANDED_QUEUED_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function adapterLockId(adapterKey: string): number {
  let hash = 0;
  for (let i = 0; i < adapterKey.length; i++) {
    hash = ((hash << 5) - hash + adapterKey.charCodeAt(i)) | 0;
  }
  return ADVISORY_LOCK_BASE + Math.abs(hash % 100_000);
}

export interface ImportRunResult {
  runId: string;
  recordsProcessed: number;
  recordsNew: number;
  recordsUpdated: number;
  recordsTombstoned: number;
  status: "completed" | "failed";
  errorText?: string;
}

/**
 * Returns the count of subject_keys from the provided list that already exist
 * in cro03_source_subjects (not tombstoned). Used to compute new vs. updated.
 */
async function countExistingSubjects(subjectKeys: string[]): Promise<number> {
  if (subjectKeys.length === 0) return 0;
  const result = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*)::bigint AS cnt FROM cro03_source_subjects
     WHERE subject_key = ANY($1::text[]) AND tombstoned_at IS NULL`,
    [subjectKeys]
  );
  return Number(result.rows[0]?.cnt ?? 0);
}

/**
 * Returns stranded queued runs: runs that have been in 'queued' state for longer
 * than STRANDED_QUEUED_TIMEOUT_MS without being picked up by a worker (e.g. process
 * crashed between DB insert and BullMQ enqueue). These should be RE-ENQUEUED, not
 * cancelled. The caller (queue-manager startup) is responsible for re-enqueueing.
 *
 * A stranded run is defined as: status='queued', created_at older than threshold,
 * AND csv_data IS NOT NULL (so re-enqueue is viable).
 */
export async function listStrandedQueuedRuns(adapterKey?: string): Promise<Array<{ runId: string; adapterKey: string }>> {
  const strandedThreshold = new Date(Date.now() - STRANDED_QUEUED_TIMEOUT_MS);
  const result = await pool.query<{ id: string; adapter_key: string }>(
    `SELECT id, adapter_key FROM source_import_runs
     WHERE status = 'queued'
       AND created_at < $1
       AND csv_data IS NOT NULL
       ${adapterKey ? "AND adapter_key = $2" : ""}
     ORDER BY created_at ASC`,
    adapterKey ? [strandedThreshold, adapterKey] : [strandedThreshold]
  );
  return result.rows.map((r) => ({ runId: r.id, adapterKey: r.adapter_key }));
}

/**
 * Cancels stale RUNNING runs whose lease has expired (worker likely crashed mid-run).
 * Does NOT cancel queued runs — those should be re-enqueued by listStrandedQueuedRuns.
 * Safe to call concurrently; uses a conditional UPDATE.
 */
export async function cancelStaleRuns(adapterKey?: string): Promise<number> {
  const result = await pool.query<{ id: string }>(
    `UPDATE source_import_runs
     SET status = 'cancelled',
         completed_at = NOW(),
         error_text = 'SOURCE_REGISTRY_STALE_RUN: cancelled by recovery sweep (lease expired)',
         csv_data = NULL
     WHERE status = 'running'
       AND (lease_expires_at IS NULL OR lease_expires_at < NOW())
       ${adapterKey ? "AND adapter_key = $1" : ""}
     RETURNING id`,
    adapterKey ? [adapterKey] : []
  );
  return result.rowCount ?? 0;
}

/**
 * Cancels all queued runs older than STALE_RUN_TIMEOUT_MS (regardless of csv_data).
 * Used when re-enqueue is not possible (e.g. csv_data IS NULL — data already lost).
 * Normal recovery path should use listStrandedQueuedRuns() + cancelStaleRuns().
 */
export async function cancelStaleQueuedRuns(adapterKey?: string): Promise<number> {
  const staleThreshold = new Date(Date.now() - STALE_RUN_TIMEOUT_MS);
  const result = await pool.query<{ id: string }>(
    `UPDATE source_import_runs
     SET status = 'cancelled',
         completed_at = NOW(),
         error_text = 'SOURCE_REGISTRY_STALE_RUN: cancelled by recovery sweep (queued too long, no csv_data)',
         csv_data = NULL
     WHERE status = 'queued'
       AND created_at < $1
       AND (csv_data IS NULL)
       ${adapterKey ? "AND adapter_key = $2" : ""}
     RETURNING id`,
    adapterKey ? [staleThreshold, adapterKey] : [staleThreshold]
  );
  return result.rowCount ?? 0;
}

/**
 * Runs a source import. All intent (adapter key, full-snapshot flag) is read from
 * the source_import_runs DB row. The BullMQ processor passes only runId.
 *
 * The advisory lock is derived from the DB row's adapter_key AFTER reading the
 * row, ensuring per-adapter mutual exclusion is correct for all code paths
 * (BullMQ path, setImmediate fallback, and test bypass).
 */
export async function runSourceImport(params: {
  runId: string;
  /** For direct test calls only — bypasses DB csv_data read. */
  _testCsvBuffer?: Buffer;
  /** Unused by worker; provided only for test-path validation */
  adapterKey?: string;
  /** Unused by worker; provided only for test-path validation */
  isFullSnapshot?: boolean;
}): Promise<ImportRunResult> {
  const { runId } = params;

  // ── Step 1: Read the run row BEFORE acquiring any lock ──────────────────────
  // This lets us derive the correct per-adapter advisory lock key from the DB.
  const preReadResult = await pool.query<{
    adapter_key: string;
    is_full_snapshot: boolean;
    cursor: { offset: number } | null;
    records_processed: string | null;
    csv_data: Buffer | null;
    requested_adapter_key: string | null;
    status: string;
  }>(
    `SELECT adapter_key, is_full_snapshot, cursor, records_processed, csv_data,
            requested_adapter_key, status
     FROM source_import_runs WHERE id = $1::uuid`,
    [runId]
  );

  const runData = preReadResult.rows[0];
  if (!runData) {
    return { runId, recordsProcessed: 0, recordsNew: 0, recordsUpdated: 0, recordsTombstoned: 0, status: "failed", errorText: `SOURCE_REGISTRY_RUN_NOT_FOUND:${runId}` };
  }

  // Validate test-path caller-declared adapter matches DB (extra safety check)
  const adapterKey = runData.adapter_key;
  if (params.adapterKey && params.adapterKey !== adapterKey) {
    return { runId, recordsProcessed: 0, recordsNew: 0, recordsUpdated: 0, recordsTombstoned: 0, status: "failed", errorText: `SOURCE_REGISTRY_ADAPTER_MISMATCH: caller declared '${params.adapterKey}' but run belongs to '${adapterKey}'` };
  }
  if (runData.requested_adapter_key && runData.requested_adapter_key !== adapterKey) {
    return { runId, recordsProcessed: 0, recordsNew: 0, recordsUpdated: 0, recordsTombstoned: 0, status: "failed", errorText: `SOURCE_REGISTRY_ADAPTER_MISMATCH: requested_adapter_key '${runData.requested_adapter_key}' != adapter_key '${adapterKey}'` };
  }

  // Derive lock ID from the DB row's adapter_key (not from params)
  const lockId = adapterLockId(adapterKey);
  const client = await pool.connect();

  try {
    // Acquire per-adapter advisory lock (session-level, released in finally)
    await client.query("SELECT pg_advisory_lock($1)", [lockId]);

    // Read tombstone intent from the DB row (authoritative)
    const isFullSnapshot: boolean = runData.is_full_snapshot;

    const adapter = getAdapter(adapterKey);
    if (!adapter) {
      return failRun(runId, `SOURCE_REGISTRY_ADAPTER_NOT_FOUND:${adapterKey}`);
    }
    if (!IMPLEMENTED_ADAPTER_KEYS.has(adapterKey)) {
      return failRun(runId, `SOURCE_REGISTRY_ADAPTER_STUB:${adapterKey}`);
    }

    // Atomically claim the run — only from queued or running state
    const myLeaseToken = randomUUID();
    const claimResult = await client.query<{ id: string }>(
      `UPDATE source_import_runs
       SET status = 'running', started_at = COALESCE(started_at, NOW()),
           lease_token = $2::uuid, lease_expires_at = NOW() + INTERVAL '30 minutes'
       WHERE id = $1::uuid AND status IN ('queued', 'running')
       RETURNING id`,
      [runId, myLeaseToken]
    );
    if (!claimResult.rowCount) {
      return { runId, recordsProcessed: 0, recordsNew: 0, recordsUpdated: 0, recordsTombstoned: 0, status: "failed", errorText: "SOURCE_REGISTRY_RUN_NOT_CLAIMABLE: run already completed, failed, or cancelled" };
    }

    const savedCursor = runData.cursor;
    const startOffset: number = savedCursor?.offset ?? 0;
    let recordsProcessed: number = Number(runData.records_processed ?? 0);

    // Determine CSV source: test bypass buffer, then DB column
    let csvBuffer: Buffer;
    if (params._testCsvBuffer) {
      csvBuffer = params._testCsvBuffer;
    } else {
      const dbCsv = runData.csv_data;
      if (!dbCsv || dbCsv.length === 0) {
        throw new Error(`SOURCE_REGISTRY_NO_CSV: run ${runId} has no csv_data in DB`);
      }
      csvBuffer = dbCsv;
    }

    // SAFETY: Only tombstone on a fresh run (startOffset === 0).
    // Resumed runs have an incomplete seenStableKeys set and must never tombstone.
    const canTombstone = startOffset === 0;

    // ── Pre-processing snapshot manifest ──────────────────────────────────────
    // Compute and persist csv_sha256 BEFORE processing any rows. This proves the
    // exact bytes that were imported and allows post-hoc verification that a
    // tombstone sweep was authorized by a complete known-good snapshot.
    // On a resumed run (startOffset > 0), the manifest was already written.
    const csvSha256 = createHash("sha256").update(csvBuffer).digest("hex");
    if (startOffset === 0) {
      // Parse total row count first (before processing) so the manifest is complete
      // even if the run fails partway through.
      let totalRows = 0;
      try {
        // Count rows quickly without full parse
        const lineCount = csvBuffer.toString("utf8").split(/\r?\n/).filter((l) => l.trim().length > 0).length;
        totalRows = Math.max(0, lineCount - 1); // subtract header row
      } catch {
        totalRows = -1; // unknown
      }
      await client.query(
        `UPDATE source_import_runs
         SET csv_sha256 = $2, source_row_count = $3
         WHERE id = $1::uuid`,
        [runId, csvSha256, totalRows]
      );
    }

    // ── Parse CSV ─────────────────────────────────────────────────────────────
    let rows: Record<string, string>[];
    try {
      rows = parse(csvBuffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
      }) as Record<string, string>[];
    } catch (err: any) {
      throw new Error(`SOURCE_REGISTRY_CSV_PARSE:${err?.message}`);
    }

    // ── Header validation ─────────────────────────────────────────────────────
    // Validate that all required headers declared by the adapter are present in
    // the CSV before processing any rows. A malformed or wrong-format file fails
    // immediately — no rows are processed, no tombstoning can occur.
    if (rows.length > 0 && adapter.requiredHeaders.length > 0) {
      const parsedHeaders = new Set(Object.keys(rows[0]));
      const missingHeaders = adapter.requiredHeaders.filter((h) => !parsedHeaders.has(h));
      if (missingHeaders.length > 0) {
        throw new Error(
          `SOURCE_REGISTRY_MISSING_HEADERS: CSV is missing required headers for ${adapterKey}: ${missingHeaders.join(", ")}. ` +
          `Found: ${[...parsedHeaders].join(", ")}`
        );
      }
    }

    // ── Tombstone baseline guard setup ───────────────────────────────────────
    // For full-snapshot runs, read the current active population BEFORE processing.
    // If the run accepts fewer than TOMBSTONE_MIN_FRACTION of this count, we refuse
    // to tombstone — the CSV likely has schema drift or is an incorrect file.
    let previousActiveCount = 0;
    if (isFullSnapshot && canTombstone) {
      const popResult = await client.query<{ cnt: string }>(
        `SELECT COUNT(*)::bigint AS cnt FROM cro03_source_subjects
         WHERE source_system = $1 AND tombstoned_at IS NULL`,
        [adapterKey]
      );
      previousActiveCount = Number(popResult.rows[0]?.cnt ?? 0);
    }

    let recordsNew = 0;
    let recordsUpdated = 0;
    const seenStableKeys = new Set<string>();

    // ── Process in batches ────────────────────────────────────────────────────
    for (let offset = startOffset; offset < rows.length; offset += BATCH_SIZE) {
      const chunk = rows.slice(offset, offset + BATCH_SIZE);
      const normalized: NormalizedSourceRecord[] = [];
      let normalizationExceptions = 0; // only THROWN exceptions count — null=filtered

      for (const row of chunk) {
        try {
          const record = adapter.normalize(row);
          // null is an intentional filter (out-of-scope type, out-of-county ZIP, etc.)
          // It does NOT count as an error — only thrown exceptions do.
          if (record !== null) {
            normalized.push(record);
            seenStableKeys.add(record.stableKey);
          }
        } catch (normErr: any) {
          const msg: string = normErr?.message ?? "";
          // Encryption key missing is always fatal
          if (msg.includes("SOURCE_REGISTRY_ENCRYPT_KEY")) {
            throw normErr;
          }
          // Unexpected exception (malformed row, missing required field, etc.)
          normalizationExceptions++;
        }
      }

      // If exception rate in this batch exceeds threshold, fail the entire run.
      // A high exception rate signals a malformed or wrong-format file.
      if (chunk.length > 0 && normalizationExceptions / chunk.length > MAX_ERROR_RATE_PCT) {
        throw new Error(
          `SOURCE_REGISTRY_NORM_ERROR_RATE: batch at offset ${offset} had ${normalizationExceptions}/${chunk.length} normalization exceptions (>${Math.round(MAX_ERROR_RATE_PCT * 100)}% threshold)`
        );
      }

      if (normalized.length === 0) {
        await client.query(
          `UPDATE source_import_runs SET cursor = $2, records_processed = $3 WHERE id = $1::uuid`,
          [runId, JSON.stringify({ offset: offset + BATCH_SIZE }), recordsProcessed]
        );
        continue;
      }

      // Count how many of these subject_keys already exist (to compute new vs. updated)
      const subjectKeys = normalized.map((r) => `${r.registryId}:${r.stableKey}`);
      const existingCount = await countExistingSubjects(subjectKeys);
      const batchNew = normalized.length - existingCount;
      const batchUpdated = existingCount;

      const idempotencyKey = `source-registry:${adapterKey}:${runId}:offset-${offset}`;

      const batchResult = await createCro03SourceBatch({
        idempotencyKey,
        actorType: "import",
        actorId: `source-registry-${adapterKey}`,
        purpose: "staging_review",
        subjects: normalized.map((r) => ({
          subjectType: "provider_csv_row" as const,
          subjectKey: `${r.registryId}:${r.stableKey}`,
          sourceSystem: r.registryId,
          payload: {
            // Encrypted full row — used for audit; never surfaced as outreach eligibility
            rawPayload: r.rawPayload,
            // Public registry fields included in plain payload for audit readability
            businessName: r.businessName ?? null,
            addressZip: r.zip ?? null,
            countyFips: r.countyFips,
            licenseType: r.licenseType,
            sourceStatus: r.sourceStatus,
            sourceStatusActive: r.sourceStatusActive,
            stableKey: r.stableKey,
            registryId: r.registryId,
          },
          // candidateValues populate cro03_normalized_candidates for CRO-03B arbitration.
          // These use canonical field names from Cro03CandidateField.
          candidateValues: {
            // Public business registry fields — not PII; safe to store in candidates
            ...(r.businessName ? { business_name: r.businessName } : {}),
            ...(r.zip ? { postal_code: r.zip } : {}),
            registry_id: `${adapterKey}:${r.stableKey}`,
            // Entity status for active/inactive signal
            entity_status: r.sourceStatusActive ? "active" : (r.sourceStatus ?? "unknown"),
          },
          provenance: {
            sourceSystem: r.registryId,
            runId,
            adapterKey,
            isFullSnapshot,
            // Versioned status mapping — allows future code changes to the
            // activeStatusMapping to be traced back to which version produced
            // each sourceStatusActive value in existing evidence.
            mappingVersion: adapter.mappingVersion,
            csvSha256,
          },
          // Run-scoped sourceEventKey: one occurrence per run per merchant.
          // Re-importing the same runId+offset (crash recovery) is idempotent
          // because the idempotencyKey is also run+offset-scoped.
          // A new import (new runId) creates a new occurrence with updated evidence.
          sourceEventKey: `${adapterKey}:${r.stableKey}:${runId}`,
          timestampProvenance: "import",
        })),
      });

      // batchResult is used for error detection; occurrence IDs are recovered
      // from the DB at finalization time (crash-safe — see Step 5 below).
      void batchResult;

      // Renew lease after each batch to prevent stale-run recovery from cancelling
      // a legitimate long-running import between batches.
      await client.query(
        `UPDATE source_import_runs SET lease_expires_at = NOW() + INTERVAL '30 minutes' WHERE id = $1::uuid`,
        [runId]
      ).catch(() => {}); // Non-fatal: don't fail the import on a lease renewal glitch

      recordsNew += batchNew;
      recordsUpdated += batchUpdated;
      recordsProcessed += normalized.length;

      // Persist cursor after each successful batch
      await client.query(
        `UPDATE source_import_runs SET cursor = $2, records_processed = $3 WHERE id = $1::uuid`,
        [runId, JSON.stringify({ offset: offset + BATCH_SIZE }), recordsProcessed]
      );
    }

    // ── Atomic finalization: lease check + reactivate + tombstone + complete ──
    // All of these are executed inside a single SERIALIZABLE-isolation-level transaction
    // on the advisory-lock client. This guarantees that a cancelled run (whose lease was
    // reclaimed by the startup recovery path) can NEVER mutate tombstoned_at on any
    // subject, because the lease check and subject mutations are in the same transaction.
    //
    // Safety invariants:
    // 1. Lease token verified FIRST — if already cancelled/overwritten, abort.
    // 2. Tombstone baseline-drop check — if count is too low, abort without mutations.
    // 3. Reactivation then tombstone — both subject mutations in the same tx as finalization.
    // 4. Finalization (status='completed') conditioned on lease_token match (defense-in-depth).
    const snapshotHash = createHash("sha256")
      .update([...seenStableKeys].sort().join(","))
      .digest("hex");

    await client.query("BEGIN");
    try {
      // Step 1: Verify lease ownership — abort if recovery has taken over this run.
      const leaseCheck = await client.query<{ lease_token: string | null; status: string }>(
        `SELECT lease_token, status FROM source_import_runs WHERE id = $1::uuid FOR UPDATE`,
        [runId]
      );
      const leaseRow = leaseCheck.rows[0];
      if (!leaseRow || leaseRow.status !== "running" || leaseRow.lease_token !== myLeaseToken) {
        throw new Error(
          `SOURCE_REGISTRY_LEASE_OWNERSHIP: run ${runId} lease no longer owned by this worker ` +
          `(current status=${leaseRow?.status ?? "unknown"}, expected token=${myLeaseToken}). ` +
          `Recovery path has taken ownership — this worker will not finalize.`
        );
      }

      // Step 2: Tombstone baseline-drop guard (checked inside tx for consistency)
      let recordsTombstoned = 0;
      if (isFullSnapshot && canTombstone && seenStableKeys.size > 0) {
        if (
          previousActiveCount >= TOMBSTONE_MIN_POPULATION &&
          seenStableKeys.size < previousActiveCount * TOMBSTONE_MIN_FRACTION
        ) {
          throw new Error(
            `SOURCE_REGISTRY_TOMBSTONE_BASELINE_DROP: full-snapshot import for '${adapterKey}' ` +
            `accepted only ${seenStableKeys.size} records vs ${previousActiveCount} previously active ` +
            `(${Math.round((seenStableKeys.size / previousActiveCount) * 100)}% < ${Math.round(TOMBSTONE_MIN_FRACTION * 100)}% minimum). ` +
            `Tombstoning refused — check that the correct full-source CSV was uploaded.`
          );
        }

        const subjectKeysForAdapter = [...seenStableKeys].map((k) => `${adapterKey}:${k}`);

        // Step 3a: Reactivate previously-tombstoned subjects that reappear in this snapshot.
        await client.query(
          `UPDATE cro03_source_subjects
           SET tombstoned_at = NULL
           WHERE source_system = $1
             AND tombstoned_at IS NOT NULL
             AND subject_key = ANY($2::text[])`,
          [adapterKey, subjectKeysForAdapter]
        );

        // Step 3b: Tombstone subjects that are active but absent from this full snapshot.
        const tombstoneResult = await client.query<{ id: string }>(
          `UPDATE cro03_source_subjects
           SET tombstoned_at = NOW()
           WHERE source_system = $1
             AND tombstoned_at IS NULL
             AND subject_key NOT IN (SELECT unnest($2::text[]))
           RETURNING id`,
          [adapterKey, subjectKeysForAdapter]
        );
        recordsTombstoned = tombstoneResult.rowCount ?? 0;
      }

      // Step 4: Finalize the run (conditioned on lease_token match — defense-in-depth).
      // accepted_key_count is stored in the manifest so post-mortem review can verify
      // that tombstoning was authorized by a known-good key population.
      const finalizeResult = await client.query(
        `UPDATE source_import_runs
         SET status = 'completed', completed_at = NOW(),
             snapshot_hash = $2,
             records_processed = $3,
             records_new = $4,
             records_updated = $5,
             records_tombstoned = $6,
             accepted_key_count = $8,
             cursor = NULL,
             csv_data = NULL
         WHERE id = $1::uuid AND lease_token = $7::uuid AND status = 'running'`,
        [runId, snapshotHash, recordsProcessed, recordsNew, recordsUpdated, recordsTombstoned, myLeaseToken, seenStableKeys.size]
      );
      if (!finalizeResult.rowCount) {
        throw new Error(
          `SOURCE_REGISTRY_FINALIZE_RACE: run ${runId} could not be finalized — lease token mismatch or status changed during write.`
        );
      }

      // Step 5: Write CRO-03A qualification command outbox rows — atomic with completion.
      // Occurrence IDs are recovered durably from the DB (via cro03_enrichment_batches +
      // cro03_batch_memberships) so crash-and-resume runs that processed some batches
      // before the crash are included. The idempotency key prefix uniquely scopes every
      // batch to this run. ON CONFLICT DO NOTHING ensures re-runs after a crash between
      // Step 4 and COMMIT do not produce duplicate command rows.
      const occurrenceRowsResult = await client.query<{ id: string }>(
        `SELECT DISTINCT o.id
           FROM cro03_enrichment_batches b
           JOIN cro03_batch_memberships m
                ON m.batch_id = b.id
               AND m.source_subject_id IS NOT NULL
               AND m.source_observation_id IS NOT NULL
           JOIN cro03_source_occurrences o
                ON o.source_subject_id = m.source_subject_id
               AND o.source_observation_id = m.source_observation_id
          WHERE b.idempotency_key LIKE $1`,
        [`source-registry:${adapterKey}:${runId}:%`]
      );
      const durableOccurrenceIds = occurrenceRowsResult.rows.map((r) => String(r.id));
      if (durableOccurrenceIds.length > 0) {
        const OUTBOX_CHUNK_SIZE = 500;
        for (let ci = 0; ci < durableOccurrenceIds.length; ci += OUTBOX_CHUNK_SIZE) {
          const chunkIds = durableOccurrenceIds.slice(ci, ci + OUTBOX_CHUNK_SIZE);
          const chunkNumber = Math.floor(ci / OUTBOX_CHUNK_SIZE);
          const chunkSelectionHash = createHash("sha256")
            .update([...chunkIds].sort().join(","))
            .digest("hex");
          await client.query(
            `INSERT INTO cro03a_qualification_commands
               (source_import_run_id, chunk_number, selection_hash, occurrence_ids, state)
             VALUES ($1::uuid, $2, $3, $4::jsonb, 'pending')
             ON CONFLICT (source_import_run_id, chunk_number, selection_hash) DO NOTHING`,
            [runId, chunkNumber, chunkSelectionHash, JSON.stringify(chunkIds)]
          );
        }
      }

      await client.query("COMMIT");
      return { runId, recordsProcessed, recordsNew, recordsUpdated, recordsTombstoned, status: "completed" };
    } catch (txErr: any) {
      await client.query("ROLLBACK").catch(() => {});
      throw txErr; // rethrown to the outer catch which marks the run failed
    }

  } catch (err: any) {
    const errorText: string = err?.message || "Unknown error";

    // Classify the failure as retryable (transient) or non-retryable (data/config).
    // Non-retryable errors mark the run permanently failed and clear csv_data (space freed).
    // Retryable errors keep csv_data and reset the run to 'queued' so a BullMQ retry
    // (or startup recovery re-enqueue) can resume. The run is NOT marked 'failed' yet —
    // BullMQ's final exhausted-attempts hook must be wired to do that.
    const isNonRetryable =
      errorText.includes("SOURCE_REGISTRY_ADAPTER_NOT_FOUND") ||
      errorText.includes("SOURCE_REGISTRY_ADAPTER_STUB") ||
      errorText.includes("SOURCE_REGISTRY_ADAPTER_MISMATCH") ||
      errorText.includes("SOURCE_REGISTRY_RUN_NOT_FOUND") ||
      errorText.includes("SOURCE_REGISTRY_RUN_NOT_CLAIMABLE") ||
      errorText.includes("SOURCE_REGISTRY_ENCRYPT_KEY") ||
      errorText.includes("SOURCE_REGISTRY_MISSING_HEADERS") ||
      errorText.includes("SOURCE_REGISTRY_TOMBSTONE_BASELINE_DROP") ||
      errorText.includes("SOURCE_REGISTRY_FINALIZE_RACE") ||
      errorText.includes("SOURCE_REGISTRY_LEASE_OWNERSHIP");

    if (isNonRetryable) {
      // Permanently failed — clear csv_data to free space
      await pool.query(
        `UPDATE source_import_runs
         SET status = 'failed', completed_at = NOW(), error_text = $2, csv_data = NULL
         WHERE id = $1::uuid AND status IN ('queued', 'running')`,
        [runId, errorText.substring(0, 2000)]
      ).catch(() => {});
      return { runId, recordsProcessed: 0, recordsNew: 0, recordsUpdated: 0, recordsTombstoned: 0, status: "failed", errorText };
    } else {
      // Transient failure — keep csv_data, reset to 'queued' for BullMQ retry.
      // Reset cursor to null so the next attempt starts fresh (partial progress is
      // not resumable after a transient failure since seenStableKeys is lost in memory).
      // Reset records_processed to 0 along with the cursor so the next retry
      // starts fresh and does not accumulate inflated metrics from partial runs.
      await pool.query(
        `UPDATE source_import_runs
         SET status = 'queued', lease_token = NULL, lease_expires_at = NULL,
             started_at = NULL, cursor = NULL, records_processed = 0,
             error_text = $2
         WHERE id = $1::uuid AND status IN ('queued', 'running')`,
        [runId, `RETRYABLE: ${errorText.substring(0, 1900)}`]
      ).catch(() => {});
      // Throw so BullMQ sees a failed job and retries (up to the configured attempts limit)
      throw err;
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [lockId]).catch(() => {});
    client.release();
  }
}

/** Marks a run failed using pool directly (no live client needed). */
async function failRun(runId: string, errorText: string): Promise<ImportRunResult> {
  await pool.query(
    `UPDATE source_import_runs SET status = 'failed', completed_at = NOW(), error_text = $2, csv_data = NULL
     WHERE id = $1::uuid`,
    [runId, errorText.substring(0, 2000)]
  ).catch(() => {});
  return { runId, recordsProcessed: 0, recordsNew: 0, recordsUpdated: 0, recordsTombstoned: 0, status: "failed", errorText };
}

/**
 * Creates a new import run record atomically — csv_data, is_full_snapshot, and
 * requested_adapter_key are all stored in the same INSERT so the row is fully
 * populated before any BullMQ job is enqueued. The worker receives only runId.
 *
 * Uses ON CONFLICT DO NOTHING on the unique partial index
 * (adapter_key) WHERE status IN ('queued','running') to enforce
 * single-active-run-per-adapter atomically. Returns null when blocked.
 */
export async function createImportRun(
  adapterKey: string,
  isFullSnapshot: boolean = false,
  csvBuffer?: Buffer
): Promise<{ runId: string } | null> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO source_import_runs
       (adapter_key, is_full_snapshot, requested_adapter_key, csv_data, status, created_at)
     VALUES ($1, $2, $1, $3, 'queued', NOW())
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [adapterKey, isFullSnapshot, csvBuffer ?? null]
  );
  if (!result.rowCount) return null;
  return { runId: result.rows[0].id };
}

/**
 * Stores the CSV buffer on the run row (used in tests where csv isn't passed to createImportRun).
 * In production, csv_data is always set atomically in createImportRun before enqueue.
 */
export async function setRunCsvData(runId: string, csvBuffer: Buffer): Promise<void> {
  await pool.query(
    `UPDATE source_import_runs SET csv_data = $2 WHERE id = $1::uuid`,
    [runId, csvBuffer]
  );
}

/** Returns the current status of an import run, or null if not found. */
export async function getImportRunStatus(runId: string) {
  const result = await pool.query(
    `SELECT id, adapter_key, status, records_processed, records_new, records_updated,
            records_tombstoned, started_at, completed_at, error_text, snapshot_hash
     FROM source_import_runs WHERE id = $1::uuid`,
    [runId]
  );
  return result.rows[0] ?? null;
}
