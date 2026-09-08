/**
 * Identity Crosswalk Runner — admin-triggered, read-only evidence sweep.
 *
 * Safety guarantees:
 *  - Zero external provider calls
 *  - Zero writes to contacts, businesses, deals, prospects, sunbiz_entities
 *  - BACKGROUND_JOB_PROFILE must be 'off' to start a run
 *  - All fingerprints are HMAC digests; no raw PII stored in evidence rows
 *
 * Single-run ownership:
 *  - identity_runs_one_active partial unique index enforces at most one row
 *    in status IN ('pending','running','paused') globally.
 *  - Lease owner/expires pattern mirrors census runner exactly.
 *
 * Frozen membership:
 *  - All watermarks and denominators are captured atomically in the POST /runs
 *    transaction. The runner loads them from the run row; never recaptures.
 *  - Contacts with id > frozen_contacts_max_id are never touched.
 *
 * Pagination:
 *  - sunbiz/prospects: WHERE id > $cursor AND id <= $frozen_max ORDER BY id
 *  - master_leads: WHERE (created_at, id) > ($cursor_ts, $cursor_uuid)
 *                   AND (created_at, id) <= ($frozen_ts, $frozen_uuid)
 *                  ORDER BY created_at, id
 *
 * Evidence rules:
 *  - FK chain (sunbiz→prospect→contact): EXPLICIT_LINK, tier 1
 *  - Filing number exact match: DETERMINISTIC_MATCH, tier 2
 *  - Exact normalized email (requires email_status IN ('valid','active')): DETERMINISTIC_MATCH, tier 3
 *  - Company + domain: STRONG_REVIEW_CANDIDATE, tier 4
 *  - Company + phone: STRONG_REVIEW_CANDIDATE, tier 5
 *  - Company + address: STRONG_REVIEW_CANDIDATE, tier 6
 *  - Company name alone: INSUFFICIENT_EVIDENCE, tier 7 (never deterministic)
 *  - Phone alone / unvalidated email alone: INSUFFICIENT_EVIDENCE, tier 7
 *  - Two signals from same root_source count as ONE for confidence
 *  - Two sources needed for STRONG_REVIEW_CANDIDATE: different providers AND root_sources
 */

import crypto from "crypto";
import os from "os";
import type { PoolClient } from 'pg';
import { pool } from "../db";
import type { VerticalResolutionInput } from "./sdr/canonical-vertical-resolver";

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────
const RULES_VERSION = "gen1-1.0.0";
const BATCH_SIZE = 500;
const BATCH_TIMEOUT_MS = 30_000;
const POOL_PRESSURE_SLEEP_MS = 5_000;
const MEMORY_CEILING_BYTES = 50 * 1024 * 1024;
const LEASE_DURATION_SECS = 120;
const LEASE_REFRESH_EVERY_N = 10;

// ──────────────────────────────────────────────────────────────────────────────
// Lease owner tag
// ──────────────────────────────────────────────────────────────────────────────
/**
 * Returns a unique claim token for this invocation.  Including a UUID means
 * that even if the same process re-invokes executeIdentityRun (e.g. pause →
 * resume in the same PID), the resumed invocation gets a different token and
 * the old worker's CAS cursor updates will find 0 matching rows and abort.
 */
export function leaseOwnerTag(): string {
  return `${os.hostname()}:${process.pid}:${crypto.randomUUID()}`;
}

// ──────────────────────────────────────────────────────────────────────────────
// HMAC fingerprint (versioned; no raw PII stored)
// ──────────────────────────────────────────────────────────────────────────────
function hmacFingerprint(data: string): string {
  const key = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      "[CrosswalkRunner] CREDENTIAL_ENCRYPTION_KEY is required for HMAC fingerprinting. " +
      "Refusing to store predictably-keyed PII digests.",
    );
  }
  return "v1:" + crypto.createHmac("sha256", key).update(data).digest("hex");
}

function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  return email.trim().toLowerCase();
}

function normalizeCompany(name: string | null | undefined): string | null {
  if (!name) return null;
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

// ──────────────────────────────────────────────────────────────────────────────
// Pool metrics
// ──────────────────────────────────────────────────────────────────────────────
function poolWaitingCount(): number {
  return (pool as any).waitingCount ?? 0;
}

// ──────────────────────────────────────────────────────────────────────────────
// Lease refresh
// ──────────────────────────────────────────────────────────────────────────────
async function refreshLease(runId: string, owner: string): Promise<boolean> {
  const r = await pool.query(
    `UPDATE contact_identity_reconciliation_runs
     SET lease_expires_at = now() + interval '${LEASE_DURATION_SECS} seconds', updated_at = now()
     WHERE id = $1 AND lease_owner = $2 AND status = 'running'`,
    [runId, owner],
  );
  return (r.rowCount ?? 0) > 0;
}

// ──────────────────────────────────────────────────────────────────────────────
// CAS-protected status check
// ──────────────────────────────────────────────────────────────────────────────
async function getRunStatus(runId: string): Promise<{ status: string; leaseOwner: string | null } | null> {
  const r = await pool.query(
    `SELECT status, lease_owner FROM contact_identity_reconciliation_runs WHERE id = $1`,
    [runId],
  );
  if (r.rows.length === 0) return null;
  return { status: r.rows[0].status, leaseOwner: r.rows[0].lease_owner };
}

// ──────────────────────────────────────────────────────────────────────────────
// Pause a run
// ──────────────────────────────────────────────────────────────────────────────
async function pauseRun(runId: string, owner: string, reason: string): Promise<void> {
  await pool.query(
    `UPDATE contact_identity_reconciliation_runs
     SET status = 'paused', pause_reason = $3,
         pool_waiting_count_at_checkpoint = $4, updated_at = now()
     WHERE id = $1 AND lease_owner = $2 AND status = 'running'`,
    [runId, owner, reason, poolWaitingCount()],
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Evidence class from tier + signal count
// ──────────────────────────────────────────────────────────────────────────────
type EvidenceClass =
  | "EXPLICIT_LINK"
  | "DETERMINISTIC_MATCH"
  | "STRONG_REVIEW_CANDIDATE"
  | "AMBIGUOUS_MATCH"
  | "SOURCE_CONFLICT"
  | "INSUFFICIENT_EVIDENCE";

/**
 * Classify evidence given the best signal tier and the number of DISTINCT root sources
 * that corroborate the same candidate. STRONG_REVIEW_CANDIDATE requires signals from
 * at least 2 independent root sources (different source tables or different source rows).
 *
 * Gen-1 processes one source row at a time (distinctRootSources = 1 always), so
 * STRONG_REVIEW_CANDIDATE is unreachable in this generation. This is intentional — do
 * not substitute providers.length; that would count signals from the same root source
 * and falsely elevate evidence class.
 */
function classifyEvidence(
  minTier: number,
  distinctRootSources: number,
  conflicting: boolean,
): EvidenceClass {
  if (conflicting) return "SOURCE_CONFLICT";
  if (minTier === 1) return "EXPLICIT_LINK";
  if (minTier <= 3 && distinctRootSources >= 1) return "DETERMINISTIC_MATCH";
  if (minTier <= 6 && distinctRootSources >= 2) return "STRONG_REVIEW_CANDIDATE";
  if (minTier <= 6 && distinctRootSources === 1) return "AMBIGUOUS_MATCH";
  return "INSUFFICIENT_EVIDENCE";
}

// ──────────────────────────────────────────────────────────────────────────────
// Process a single population batch
// Returns: { processed, exceptions }
// ──────────────────────────────────────────────────────────────────────────────
interface BatchSourceRow {
  id: number | string;
  entity_name?: string | null;
  owner_email?: string | null;
  email?: string | null;
  phone?: string | null;
  owner_phone?: string | null;
  filing_number?: string | null;
  vertical?: string | null;
  prospect_id?: number | null;
  contact_id?: number | null;
  business_id?: number | null;
  // prospects
  sunbiz_entity_id?: number | null;
  // master_leads
  created_at?: string | Date | null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Vertical candidate writer
// ──────────────────────────────────────────────────────────────────────────────
async function insertVerticalCandidate(
  tx: PoolClient,
  runId: string,
  contactId: number,
  sourceTable: string,
  sourceId: string,
  sourceVertical: string,
): Promise<void> {
  const contactR = await tx.query(
    `SELECT vertical FROM contacts WHERE id = $1`,
    [contactId],
  );
  const currentVertical = contactR.rows[0]?.vertical ?? null;
  const conflictState = !currentVertical ? "proposed_upgrade"
    : currentVertical === sourceVertical ? "agree"
    : "proposed_change";
  const resolverInput = { sourceVertical, currentVertical, sourceTable, sourceId };
  const resolverOutput = { conflictState, resolved: conflictState === "agree" ? currentVertical : sourceVertical };
  await tx.query(
    `INSERT INTO contact_vertical_candidates
       (run_id, contact_id, source_table, source_id, source_vertical,
        current_contact_vertical, conflict_state, resolver_input, resolver_output)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [runId, contactId, sourceTable, sourceId, sourceVertical,
     currentVertical, conflictState,
     JSON.stringify(resolverInput), JSON.stringify(resolverOutput)],
  );
}

async function processBatch(
  runId: string,
  frozenContactsMaxId: bigint,
  sourceRows: BatchSourceRow[],
  sourceTable: string,
): Promise<{ processed: number; exceptions: number; classCounts: Record<string, number> }> {
  if (sourceRows.length === 0) return { processed: 0, exceptions: 0, classCounts: {} };

  let processed = 0;
  let exceptions = 0;
  const classCounts: Record<string, number> = {};

  // Acquire a single client and open an explicit transaction for the batch.
  // PostgreSQL rejects SAVEPOINT outside a transaction (autocommit mode has no transaction).
  // Each row uses a SAVEPOINT for atomic writes: if candidate/evidence/counter writes fail
  // after a subject INSERT, the per-row ROLLBACK TO SAVEPOINT undoes the partial write so
  // the unique constraint on (run_id, source_table, source_id) does NOT block replay.
  // Cursor advancement is recorded after COMMIT so a crash between COMMIT and the cursor
  // update is the only replay risk, and it is idempotent (ON CONFLICT DO NOTHING on subjects).
  // ── Systemic configuration preflight ────────────────────────────────────
  // hmacFingerprint requires CREDENTIAL_ENCRYPTION_KEY. If the key is missing,
  // every row in the loop would throw, be counted as an exception, and the cursor
  // would still advance — producing a run that marks 'completed' with 0 useful
  // evidence. Validate the key before opening the transaction so the error
  // propagates to the lifecycle handler, which marks the run 'failed'.
  hmacFingerprint("_preflight_check_");

  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    for (const row of sourceRows) {
      const sourceId = String(row.id);
      const savepointName = `row_${sourceTable}_${String(sourceId).replace(/[^a-zA-Z0-9]/g, "_")}`;

      try {
        // ── Root source resolution ────────────────────────────────────────────
        let rootSourceTable = sourceTable;
        let rootSourceId = sourceId;
        let existingFkContactId: number | null = null;
        const existingFkBusinessId: number | null = null; // prospects has no business_id column
        const importExecutionId: string | null = null;

        if (sourceTable === "prospects" && row.sunbiz_entity_id) {
          rootSourceTable = "sunbiz_entities";
          rootSourceId = String(row.sunbiz_entity_id);
        }

        // ── SAVEPOINT: wraps BOTH probe queries and writes ────────────────────
        // Opening the SAVEPOINT here (before any DB reads) ensures that a PostgreSQL
        // error inside a probe query (which aborts the transaction) is contained
        // within this savepoint and can be rolled back. Without this, a probe SQL
        // error would abort the batch transaction, and all subsequent SAVEPOINT
        // commands would fail with "current transaction is aborted, commands ignored".
        await tx.query(`SAVEPOINT ${savepointName}`);
        try {
        // ── FK chain traversal (read-only; within savepoint) ─────────────────
        // sunbiz → prospect (via prospect_id on sunbiz_entities) → contact
        // prospects has contact_id but no business_id column
        if (sourceTable === "sunbiz_entities" && row.prospect_id) {
          const pR = await tx.query(
            `SELECT contact_id FROM prospects WHERE id = $1`,
            [row.prospect_id],
          );
          if (pR.rows.length > 0) {
            existingFkContactId = pR.rows[0].contact_id ?? null;
          }
        } else {
          if (row.contact_id) existingFkContactId = Number(row.contact_id);
        }

        const sourceEmail = normalizeEmail(row.email ?? row.owner_email);
        const sourceCompany = normalizeCompany(row.entity_name);
        const sourcePhone = (row.phone ?? row.owner_phone ?? null);
        const sourceVertical = row.vertical ?? null;

        // ── Read-only signal probes (inside savepoint) ────────────────────────
        let skipToExplicit = false;
        let explicitContactUpdatedAt: Date | null = null;

        if (existingFkContactId && existingFkContactId <= Number(frozenContactsMaxId)) {
          const contactCheck = await tx.query(
            `SELECT id, updated_at FROM contacts
             WHERE id = $1 AND archived_at IS NULL AND record_class = 'production'`,
            [existingFkContactId],
          );
          if (contactCheck.rows.length > 0) {
            skipToExplicit = true;
            explicitContactUpdatedAt = contactCheck.rows[0].updated_at;
          }
        }

        let emailMatchId: number | null = null;
        let emailAmbiguous = false;
        let companyPhoneMatchId: number | null = null;
        let companyOnlyMatchId: number | null = null;

        if (!skipToExplicit) {
          if (sourceEmail) {
            const eR = await tx.query(
              `SELECT id FROM contacts
               WHERE lower(trim(email)) = $1
                 AND archived_at IS NULL AND record_class = 'production' AND id <= $2
                 AND email_status IN ('valid', 'active')
               LIMIT 3`,
              [sourceEmail, frozenContactsMaxId],
            );
            if (eR.rows.length === 1) emailMatchId = eR.rows[0].id;
            else if (eR.rows.length > 1) emailAmbiguous = true;
          }
          if (sourceCompany && sourcePhone) {
            const phoneNorm = sourcePhone.replace(/\D/g, "");
            if (phoneNorm.length >= 10) {
              const cpR = await tx.query(
                `SELECT id FROM contacts
                 WHERE lower(trim(company_name)) = $1
                   AND regexp_replace(COALESCE(phone,''), '[^0-9]', '', 'g') = $2
                   AND archived_at IS NULL AND record_class = 'production' AND id <= $3
                 LIMIT 3`,
                [sourceCompany, phoneNorm, frozenContactsMaxId],
              );
              if (cpR.rows.length === 1) companyPhoneMatchId = cpR.rows[0].id;
            }
          }
          if (sourceCompany && !companyPhoneMatchId) {
            const coR = await tx.query(
              `SELECT id FROM contacts
               WHERE lower(trim(company_name)) = $1
                 AND archived_at IS NULL AND record_class = 'production' AND id <= $2
               LIMIT 3`,
              [sourceCompany, frozenContactsMaxId],
            );
            if (coR.rows.length === 1) companyOnlyMatchId = coR.rows[0].id;
          }
        }

        // ── Build fingerprint ─────────────────────────────────────────────────
        const sourceFingerprint = hmacFingerprint([
          sourceTable, sourceId,
          sourceEmail ?? "",
          sourceCompany ?? "",
          row.filing_number ?? "",
          sourcePhone ?? "",
        ].join("|"));

        // ── Writes follow (still within the same single SAVEPOINT try block) ─
          if (skipToExplicit) {
            // ── Tier 1: Explicit FK link ────────────────────────────────────────
            const subjectR = await tx.query(
              `INSERT INTO contact_identity_subjects
                 (run_id, source_table, source_id, root_source_table, root_source_id,
                  import_execution_id, existing_fk_contact_id, existing_fk_business_id,
                  disposition, candidate_count, source_fingerprint)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'MATCHED',1,$9)
               ON CONFLICT (run_id, source_table, source_id) DO NOTHING
               RETURNING id`,
              [runId, sourceTable, sourceId, rootSourceTable, rootSourceId,
               importExecutionId, existingFkContactId, existingFkBusinessId, sourceFingerprint],
            );
            if (subjectR.rows.length > 0) {
              const subjectId = subjectR.rows[0].id;
              const candidateR = await tx.query(
                `INSERT INTO contact_identity_candidates
                   (subject_id, run_id, candidate_type, candidate_id, candidate_updated_at,
                    evidence_class, confidence_score, match_tier)
                 VALUES ($1,$2,'contact',$3,$4,'EXPLICIT_LINK',100,1)
                 RETURNING id`,
                [subjectId, runId, existingFkContactId, explicitContactUpdatedAt],
              );
              const candidateId = candidateR.rows[0].id;
              const fp = hmacFingerprint(`fk_chain|${sourceTable}|${sourceId}|${existingFkContactId}`);
              await tx.query(
                `INSERT INTO contact_identity_evidence
                   (candidate_id, run_id, root_source_table, root_source_id, evidence_provider, evidence_fingerprint)
                 VALUES ($1,$2,$3,$4,'fk_chain',$5)
                 ON CONFLICT (candidate_id, root_source_table, root_source_id, evidence_fingerprint) DO NOTHING`,
                [candidateId, runId, rootSourceTable, rootSourceId, fp],
              );
              await tx.query(
                `UPDATE contact_identity_reconciliation_runs
                 SET explicit_link_count = explicit_link_count + 1, updated_at = now() WHERE id = $1`,
                [runId],
              );
              if (sourceVertical) {
                await insertVerticalCandidate(tx, runId, existingFkContactId!, sourceTable, sourceId, sourceVertical);
              }
              classCounts["EXPLICIT_LINK"] = (classCounts["EXPLICIT_LINK"] ?? 0) + 1;
            }
            await tx.query(`RELEASE SAVEPOINT ${savepointName}`);
            processed++;
            continue;
          }

          // ── Signal map ──────────────────────────────────────────────────────
          const candidateMap = new Map<number, { providers: Array<{ provider: string; tier: number }>; minTier: number }>();
          const addSignal = (cid: number, provider: string, tier: number) => {
            const ex = candidateMap.get(cid);
            if (ex) { ex.providers.push({ provider, tier }); ex.minTier = Math.min(ex.minTier, tier); }
            else candidateMap.set(cid, { providers: [{ provider, tier }], minTier: tier });
          };
          // Tier 2 (filing_number via businesses) deferred to Gen-2 — businesses has no filing_number column
          if (emailMatchId) addSignal(emailMatchId, "exact_email", 3);
          if (companyPhoneMatchId) addSignal(companyPhoneMatchId, "company_phone", 5);
          if (companyOnlyMatchId) addSignal(companyOnlyMatchId, "company_only", 7);

          const candidateIds = Array.from(candidateMap.keys());

          if (candidateIds.length === 0 && !emailAmbiguous) {
            const nmR = await tx.query(
              `INSERT INTO contact_identity_subjects
                 (run_id, source_table, source_id, root_source_table, root_source_id,
                  import_execution_id, disposition, candidate_count, source_fingerprint)
               VALUES ($1,$2,$3,$4,$5,$6,'NO_MATCH',0,$7)
               ON CONFLICT (run_id, source_table, source_id) DO NOTHING
               RETURNING id`,
              [runId, sourceTable, sourceId, rootSourceTable, rootSourceId, importExecutionId, sourceFingerprint],
            );
            // Only increment counter if the subject is newly inserted — prevents
            // double-counting on replay (cursor advanced after COMMIT, subject already exists).
            if (nmR.rows.length > 0) {
              await tx.query(
                `UPDATE contact_identity_reconciliation_runs
                 SET no_match_count = no_match_count + 1, updated_at = now() WHERE id = $1`,
                [runId],
              );
              classCounts["NO_MATCH"] = (classCounts["NO_MATCH"] ?? 0) + 1;
            }
            await tx.query(`RELEASE SAVEPOINT ${savepointName}`);
            processed++;
            continue;
          }

          // ── Evidence class ──────────────────────────────────────────────────
          const conflicting = candidateIds.length > 1;
          let finalClass: EvidenceClass;
          let finalContactId: number | null = null;
          let overallMinTier = 7;

          if (conflicting) {
            finalClass = "SOURCE_CONFLICT";
          } else if (candidateIds.length === 1) {
            finalContactId = candidateIds[0];
            const sig = candidateMap.get(finalContactId)!;
            overallMinTier = sig.minTier;
            // Gen-1: always 1 distinct root source per batch row — STRONG requires >= 2
            finalClass = classifyEvidence(overallMinTier, 1, false);
          } else {
            finalClass = "INSUFFICIENT_EVIDENCE";
          }

          // ── Write subjects / candidates / evidence ──────────────────────────
          // newSubject = true means the subject row was newly inserted (not a replay conflict).
          // Counter increments, vertical candidates, and classCounts updates are ONLY applied
          // when newSubject=true, preventing double-counting on replay after a post-COMMIT crash.
          let newSubject = false;
          if (conflicting) {
            const multiCands = candidateIds.map(cid => {
              const s = candidateMap.get(cid)!;
              return { contactId: cid, class: "SOURCE_CONFLICT" as EvidenceClass,
                       tier: s.minTier, confidence: 30, provider: s.providers[0].provider };
            });
            newSubject = await insertSubjectWithCandidates(
              tx, runId, sourceTable, sourceId, rootSourceTable, rootSourceId,
              sourceFingerprint, importExecutionId, null, null, "CONFLICTING", multiCands,
            );
          } else if (finalContactId !== null) {
            const sig = candidateMap.get(finalContactId)!;
            const confidence = finalClass === "DETERMINISTIC_MATCH"
              ? (sig.providers.length >= 2 ? 90 : 80)
              : finalClass === "AMBIGUOUS_MATCH" ? 40
              : 20; // INSUFFICIENT_EVIDENCE; STRONG unreachable in Gen-1
            const disposition = finalClass === "INSUFFICIENT_EVIDENCE" ? "INSUFFICIENT_EVIDENCE" : "MATCHED";
            newSubject = await insertSubjectWithSingleCandidate(
              tx, runId, sourceTable, sourceId, rootSourceTable, rootSourceId,
              sourceFingerprint, importExecutionId, existingFkContactId, existingFkBusinessId,
              disposition, finalContactId, finalClass, overallMinTier, confidence,
              sig.providers,
            );
            // Vertical candidate only on new subject — prevents duplicates on replay
            if (newSubject && sourceVertical) {
              await insertVerticalCandidate(tx, runId, finalContactId, sourceTable, sourceId, sourceVertical);
            }
          } else {
            // emailAmbiguous with no unique candidate
            const insR = await tx.query(
              `INSERT INTO contact_identity_subjects
                 (run_id, source_table, source_id, root_source_table, root_source_id,
                  import_execution_id, disposition, candidate_count, source_fingerprint)
               VALUES ($1,$2,$3,$4,$5,$6,'INSUFFICIENT_EVIDENCE',0,$7)
               ON CONFLICT (run_id, source_table, source_id) DO NOTHING
               RETURNING id`,
              [runId, sourceTable, sourceId, rootSourceTable, rootSourceId, importExecutionId, sourceFingerprint],
            );
            newSubject = insR.rows.length > 0;
          }

          // ── Run-level counter (only on new subject — replay idempotency) ────
          if (newSubject) {
            const counterField: string = finalClass === "EXPLICIT_LINK" ? "explicit_link_count"
              : finalClass === "DETERMINISTIC_MATCH" ? "deterministic_match_count"
              : finalClass === "STRONG_REVIEW_CANDIDATE" ? "strong_candidate_count"
              : finalClass === "AMBIGUOUS_MATCH" ? "ambiguous_count"
              : finalClass === "SOURCE_CONFLICT" ? "source_conflict_count"
              : "insufficient_evidence_count";
            await tx.query(
              `UPDATE contact_identity_reconciliation_runs
               SET ${counterField} = ${counterField} + 1, updated_at = now() WHERE id = $1`,
              [runId],
            );
            classCounts[finalClass] = (classCounts[finalClass] ?? 0) + 1;
          }
          await tx.query(`RELEASE SAVEPOINT ${savepointName}`);
          processed++;

        } catch (writeErr) {
          // Roll back only this row's writes; cursor advances and exceptions accumulates
          await tx.query(`ROLLBACK TO SAVEPOINT ${savepointName}`).catch(() => {});
          await tx.query(`RELEASE SAVEPOINT ${savepointName}`).catch(() => {});
          console.error(`[CrosswalkRunner] Row write failed (${sourceTable} id=${sourceId}); rolled back to savepoint:`, writeErr);
          exceptions++;
        }
      } catch (rowErr) {
        // Outer per-row catch: fires only when root-source resolution or the
        // SAVEPOINT command itself throws (no savepoint to roll back at this level).
        // All probe/write errors are caught by the inner try block above.
        console.error(`[CrosswalkRunner] Row pre-savepoint error (${sourceTable} id=${row.id}):`, rowErr);
        exceptions++;
      }
    }
    // Commit all writes for this batch atomically; individual row failures were already
    // rolled back to their SAVEPOINTs and counted in exceptions.
    await tx.query("COMMIT");
  } catch (batchErr) {
    // Outer transaction failure (BEGIN failed, COMMIT failed, or unrecoverable error).
    // Roll back any writes that landed before the failure.
    await tx.query("ROLLBACK").catch(() => {});
    throw batchErr;
  } finally {
    tx.release();
  }

  return { processed, exceptions, classCounts };
}

/**
 * Insert subject + candidate + evidence rows atomically (within the caller's tx).
 * Returns true when a new subject was inserted; false when the subject already existed
 * (ON CONFLICT DO NOTHING). Callers MUST skip counter increments on false to preserve
 * replay idempotency — replaying a batch after a post-COMMIT crash must not inflate
 * class counts or vertical candidates.
 */
async function insertSubjectWithSingleCandidate(
  tx: PoolClient,
  runId: string,
  sourceTable: string,
  sourceId: string,
  rootSourceTable: string,
  rootSourceId: string,
  sourceFingerprint: string,
  importExecutionId: string | null,
  existingFkContactId: number | null,
  existingFkBusinessId: number | null,
  disposition: string,
  contactId: number,
  evidenceClass: string,
  matchTier: number,
  confidence: number,
  providers: Array<{ provider: string; tier: number }>,
): Promise<boolean> {
  const subjectR = await tx.query(
    `INSERT INTO contact_identity_subjects
       (run_id, source_table, source_id, root_source_table, root_source_id,
        import_execution_id, existing_fk_contact_id, existing_fk_business_id,
        disposition, candidate_count, source_fingerprint)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10)
     ON CONFLICT (run_id, source_table, source_id) DO NOTHING
     RETURNING id`,
    [runId, sourceTable, sourceId, rootSourceTable, rootSourceId,
     importExecutionId, existingFkContactId, existingFkBusinessId,
     disposition, sourceFingerprint],
  );
  if (subjectR.rows.length === 0) return false; // subject already existed — idempotent replay
  const subjectId = subjectR.rows[0].id;

  const updR = await tx.query(
    `SELECT updated_at FROM contacts WHERE id = $1`,
    [contactId],
  );
  const updAt = updR.rows[0]?.updated_at ?? new Date();

  const candR = await tx.query(
    `INSERT INTO contact_identity_candidates
       (subject_id, run_id, candidate_type, candidate_id, candidate_updated_at,
        evidence_class, confidence_score, match_tier)
     VALUES ($1,$2,'contact',$3,$4,$5,$6,$7)
     RETURNING id`,
    [subjectId, runId, contactId, updAt, evidenceClass, confidence, matchTier],
  );
  const candidateId = candR.rows[0].id;

  for (const { provider } of providers) {
    const fp = hmacFingerprint(`${provider}|${sourceTable}|${sourceId}|${contactId}`);
    await tx.query(
      `INSERT INTO contact_identity_evidence
         (candidate_id, run_id, root_source_table, root_source_id, evidence_provider, evidence_fingerprint)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (candidate_id, root_source_table, root_source_id, evidence_fingerprint) DO NOTHING`,
      [candidateId, runId, rootSourceTable, rootSourceId, provider, fp],
    );
  }
  return true; // new subject inserted
}

/**
 * Insert subject + multiple candidate + evidence rows.
 * Returns true when a new subject was inserted; false when subject already existed.
 * Callers MUST skip counter increments on false (replay idempotency).
 */
async function insertSubjectWithCandidates(
  tx: PoolClient,
  runId: string,
  sourceTable: string,
  sourceId: string,
  rootSourceTable: string,
  rootSourceId: string,
  sourceFingerprint: string,
  importExecutionId: string | null,
  existingFkContactId: number | null,
  existingFkBusinessId: number | null,
  disposition: string,
  candidates: Array<{ contactId: number; class: string; tier: number; confidence: number; provider: string }>,
): Promise<boolean> {
  const subjectR = await tx.query(
    `INSERT INTO contact_identity_subjects
       (run_id, source_table, source_id, root_source_table, root_source_id,
        import_execution_id, existing_fk_contact_id, existing_fk_business_id,
        disposition, candidate_count, source_fingerprint)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (run_id, source_table, source_id) DO NOTHING
     RETURNING id`,
    [runId, sourceTable, sourceId, rootSourceTable, rootSourceId,
     importExecutionId, existingFkContactId, existingFkBusinessId,
     disposition, candidates.length, sourceFingerprint],
  );
  if (subjectR.rows.length === 0) return false; // subject already existed — idempotent replay
  const subjectId = subjectR.rows[0].id;

  for (const cand of candidates) {
    const updR = await tx.query(`SELECT updated_at FROM contacts WHERE id = $1`, [cand.contactId]);
    const updAt = updR.rows[0]?.updated_at ?? new Date();
    const candR = await tx.query(
      `INSERT INTO contact_identity_candidates
         (subject_id, run_id, candidate_type, candidate_id, candidate_updated_at,
          evidence_class, confidence_score, match_tier)
       VALUES ($1,$2,'contact',$3,$4,$5,$6,$7)
       RETURNING id`,
      [subjectId, runId, cand.contactId, updAt, cand.class, cand.confidence, cand.tier],
    );
    const candidateId = candR.rows[0].id;
    const fp = hmacFingerprint(`${cand.provider}|${sourceTable}|${sourceId}|${cand.contactId}`);
    await tx.query(
      `INSERT INTO contact_identity_evidence
         (candidate_id, run_id, root_source_table, root_source_id, evidence_provider, evidence_fingerprint)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (candidate_id, root_source_table, root_source_id, evidence_fingerprint) DO NOTHING`,
      [candidateId, runId, rootSourceTable, rootSourceId, cand.provider, fp],
    );
  }
  return true; // new subject inserted
}

// ──────────────────────────────────────────────────────────────────────────────
// Main executor
// ──────────────────────────────────────────────────────────────────────────────
export async function executeIdentityRun(runId: string, owner: string): Promise<void> {
  // ── Top-level failure guard ───────────────────────────────────────────────
  // Wraps the ENTIRE lifecycle — preflight, run loading, pending→running claim,
  // sweep, and completion — so any escaping exception CAS-transitions the run
  // to 'failed' while the current lease_owner still matches.
  //
  // Coverage:
  //  - Preflight failures (BACKGROUND_JOB_PROFILE, run not found, pg errors):
  //    run may still be 'pending'; WHERE status IN ('pending','running') catches both.
  //  - Claim failures: run is 'pending'; caught by the same WHERE clause.
  //  - Sweep failures: run is 'running'; caught as before.
  //
  // A superseded worker (lease taken by a resumed invocation) finds 0 matching
  // rows on the failure UPDATE and leaves the resumed worker's run intact.
  try {
  const bgProfile = process.env.BACKGROUND_JOB_PROFILE ?? "off";
  if (bgProfile !== "off") {
    await pool.query(
      `UPDATE contact_identity_reconciliation_runs
       SET status = 'failed', fail_reason = $2, updated_at = now()
       WHERE id = $1 AND lease_owner = $3`,
      [runId, `BACKGROUND_JOB_PROFILE is '${bgProfile}', must be 'off' to run identity crosswalk`, owner],
    );
    return;
  }

  // Load frozen watermarks from run row
  const runR = await pool.query(
    `SELECT frozen_sunbiz_max_id, frozen_prospects_max_id,
            frozen_master_leads_created_at, frozen_master_leads_max_uuid,
            frozen_contacts_max_id, frozen_businesses_max_id,
            sunbiz_denominator, prospects_denominator, master_leads_denominator,
            sunbiz_cursor, prospects_cursor,
            master_leads_cursor_created_at, master_leads_cursor_uuid
     FROM contact_identity_reconciliation_runs WHERE id = $1`,
    [runId],
  );
  if (runR.rows.length === 0) return;

  const run = runR.rows[0];
  const frozenContactsMaxId = BigInt(run.frozen_contacts_max_id ?? 0);

  // Transition pending → running
  const startR = await pool.query(
    `UPDATE contact_identity_reconciliation_runs
     SET status = 'running', started_at = COALESCE(started_at, now()),
         lease_expires_at = now() + interval '${LEASE_DURATION_SECS} seconds',
         updated_at = now()
     WHERE id = $1 AND lease_owner = $2 AND status IN ('pending', 'running')`,
    [runId, owner],
  );
  if ((startR.rowCount ?? 0) === 0) {
    console.warn(`[CrosswalkRunner] Could not claim running status for run ${runId}`);
    return;
  }

  // ── Unconditional HMAC-key preflight ─────────────────────────────────────
  // This check fires regardless of whether the frozen denominators are zero.
  // A missing CREDENTIAL_ENCRYPTION_KEY would otherwise produce a run that
  // marks 'completed' with 0 evidence on empty-population databases.
  // hmacFingerprint throws with a descriptive message when the key is absent;
  // the top-level lifecycle catch block marks the run 'failed' with that reason.
  hmacFingerprint("_preflight_check_");

  let batchNum = 0;
  let consecutivePressure = 0;
  let sunbizCursor = Number(run.sunbiz_cursor ?? 0);
  let prospectsCursor = Number(run.prospects_cursor ?? 0);
  let mlCursorCreatedAt: Date | null = run.master_leads_cursor_created_at ?? null;
  let mlCursorUuid: string | null = run.master_leads_cursor_uuid ?? null;
  { // inner scope for sweep logic (no separate IIFE needed — already inside try)

  const populations: Array<"sunbiz" | "prospects" | "master_leads"> = ["sunbiz", "prospects", "master_leads"];

  for (const population of populations) {
    while (true) {
      // CAS status check
      const status = await getRunStatus(runId);
      if (!status || status.leaseOwner !== owner) {
        console.warn(`[CrosswalkRunner] Lease lost on run ${runId}`);
        return;
      }
      if (status.status === "cancelled") return;
      if (status.status === "paused") return;
      if (status.status !== "running") return;

      // Pool pressure
      const pressure = poolWaitingCount();
      if (pressure > 0) {
        consecutivePressure++;
        if (consecutivePressure >= 2) {
          await pauseRun(runId, owner, `Pool pressure: waitingCount=${pressure} sustained across 2 batches`);
          return;
        }
        await new Promise(r => setTimeout(r, POOL_PRESSURE_SLEEP_MS));
        continue;
      }
      consecutivePressure = 0;

      // Lease refresh
      if (batchNum > 0 && batchNum % LEASE_REFRESH_EVERY_N === 0) {
        const renewed = await refreshLease(runId, owner);
        if (!renewed) {
          console.warn(`[CrosswalkRunner] Lease not renewed for run ${runId}`);
          return;
        }
      }

      // Fetch batch
      const batchStart = Date.now();
      let rows: BatchSourceRow[] = [];

      try {
        if (population === "sunbiz") {
          const frozenMax = run.frozen_sunbiz_max_id;
          if (!frozenMax) break;
          const r = await pool.query(
            `SELECT id, entity_name, filing_number, email, owner_email,
                  phone, owner_phone, vertical, prospect_id
             FROM sunbiz_entities
             WHERE id > $1 AND id <= $2
             ORDER BY id ASC LIMIT $3`,
            [sunbizCursor, frozenMax, BATCH_SIZE],
          );
          rows = r.rows;
        } else if (population === "prospects") {
          const frozenMax = run.frozen_prospects_max_id;
          if (!frozenMax) break;
          // prospects has no sunbiz_entity_id or business_id — only contact_id is the FK
          const r = await pool.query(
            `SELECT id, email, owner_email, phone, owner_phone,
                    company_name AS entity_name, vertical, contact_id
               FROM prospects
               WHERE id > $1 AND id <= $2
               ORDER BY id ASC LIMIT $3`,
            [prospectsCursor, frozenMax, BATCH_SIZE],
          );
          rows = r.rows;
        } else {
          // master_leads — UUID; composite keyset (created_at, id)
          const frozenTs = run.frozen_master_leads_created_at;
          const frozenUuid = run.frozen_master_leads_max_uuid;
          if (!frozenTs || !frozenUuid) break;
          const r = await pool.query(
            `SELECT id::text AS id, created_at, email, phone,
                    company AS entity_name, vertical
               FROM master_leads
             WHERE (created_at, id::text) > ($1, $2)
               AND (created_at, id::text) <= ($3, $4)
             ORDER BY created_at ASC, id ASC
             LIMIT $5`,
            [mlCursorCreatedAt ?? new Date(0), mlCursorUuid ?? "00000000-0000-0000-0000-000000000000",
             frozenTs, frozenUuid, BATCH_SIZE],
          );
          rows = r.rows;
        }
      } catch (err) {
        console.error(`[CrosswalkRunner] Batch fetch error (${population}):`, err);
        await pauseRun(runId, owner, `Batch fetch error: ${String(err)}`);
        return;
      }

      const batchDuration = Date.now() - batchStart;
      if (batchDuration > BATCH_TIMEOUT_MS) {
        await pauseRun(runId, owner, `Batch exceeded ${BATCH_TIMEOUT_MS}ms`);
        return;
      }

      if (rows.length === 0) break; // Population exhausted

      // Process batch
      const sourceTable = population === "sunbiz" ? "sunbiz_entities"
        : population === "prospects" ? "prospects"
        : "master_leads";

      const result = await processBatch(runId, frozenContactsMaxId, rows, sourceTable);

      // Advance cursors — each update is a CAS: WHERE lease_owner = $owner.
      // If it returns 0 rows the lease was superseded by a resumed invocation;
      // abort immediately so the stale worker cannot continue inflating counters.
      let cursorRowCount = 0;
      if (population === "sunbiz") {
        sunbizCursor = Number(rows[rows.length - 1].id);
        const ur = await pool.query(
          `UPDATE contact_identity_reconciliation_runs
           SET sunbiz_cursor = $2,
               sunbiz_processed = sunbiz_processed + $3,
               sunbiz_exceptions = sunbiz_exceptions + $4,
               updated_at = now()
           WHERE id = $1 AND lease_owner = $5`,
          [runId, sunbizCursor, result.processed, result.exceptions, owner],
        );
        cursorRowCount = ur.rowCount ?? 0;
      } else if (population === "prospects") {
        prospectsCursor = Number(rows[rows.length - 1].id);
        const ur = await pool.query(
          `UPDATE contact_identity_reconciliation_runs
           SET prospects_cursor = $2,
               prospects_processed = prospects_processed + $3,
               prospects_exceptions = prospects_exceptions + $4,
               updated_at = now()
           WHERE id = $1 AND lease_owner = $5`,
          [runId, prospectsCursor, result.processed, result.exceptions, owner],
        );
        cursorRowCount = ur.rowCount ?? 0;
      } else {
        const lastRow = rows[rows.length - 1];
        mlCursorCreatedAt = lastRow.created_at instanceof Date ? lastRow.created_at : new Date(lastRow.created_at as string);
        mlCursorUuid = String(lastRow.id);
        const ur = await pool.query(
          `UPDATE contact_identity_reconciliation_runs
           SET master_leads_cursor_created_at = $2,
               master_leads_cursor_uuid = $3,
               master_leads_processed = master_leads_processed + $4,
               master_leads_exceptions = master_leads_exceptions + $5,
               updated_at = now()
           WHERE id = $1 AND lease_owner = $6`,
          [runId, mlCursorCreatedAt, mlCursorUuid,
           result.processed, result.exceptions, owner],
        );
        cursorRowCount = ur.rowCount ?? 0;
      }
      if (cursorRowCount === 0) {
        // Lease superseded: another invocation owns this run. Abort without marking failed
        // so the new owner can complete and mark it status='completed'.
        console.warn(`[CrosswalkRunner] Lease superseded for run ${runId} after batch ${batchNum}; aborting stale worker.`);
        return;
      }

      batchNum++;
      if (rows.length < BATCH_SIZE) break; // Last batch for this population
    }
  }

  // Mark complete
  await pool.query(
    `UPDATE contact_identity_reconciliation_runs
     SET status = 'completed', completed_at = now(), updated_at = now()
     WHERE id = $1 AND lease_owner = $2 AND status = 'running'`,
    [runId, owner],
  );
  console.log(`[CrosswalkRunner] Run ${runId} completed`);
  } // end inner sweep scope
  } catch (lifecycleErr: any) {
    // CAS-scoped failure: marks the run failed only while this invocation's
    // lease_owner still matches and status is pending or running.
    // A superseded worker finds 0 rows and leaves the resumed worker intact.
    const reason = String(lifecycleErr?.message ?? lifecycleErr).slice(0, 1000);
    console.error(`[CrosswalkRunner] Lifecycle error for run ${runId}:`, lifecycleErr);
    await pool.query(
      `UPDATE contact_identity_reconciliation_runs
       SET status = 'failed', fail_reason = $2, updated_at = now()
       WHERE id = $1 AND lease_owner = $3 AND status IN ('pending', 'running')`,
      [runId, reason, owner],
    ).catch((markErr) => {
      console.error(`[CrosswalkRunner] Could not mark run ${runId} failed:`, markErr);
    });
  }
}

/** Exported for certification testing only — do not call from production code. */
export { processBatch as _testProcessBatch };
