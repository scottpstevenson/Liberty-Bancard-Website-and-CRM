/**
 * Contact Census Runner — admin-triggered, read-mostly census of all active contacts.
 *
 * Safety guarantees:
 *  - Refuses to start if BACKGROUND_JOB_PROFILE !== 'off'
 *  - Zero external provider calls (provider_call_count always stays 0)
 *  - Zero writes to canonical contact tables
 *  - Mutation proof: before/after row counts on key tables
 *  - Pool pressure check before every batch; backs off if waitingCount > 0
 *  - Keyset cursor over contacts_active_idx, batch size 500
 *  - Shared-phone set and business-name set loaded once per run
 *
 * One run at a time enforced via in-process runningRunIds set.
 */

import pg from "pg";
import { pool } from "../db";
import {
  classifyContact,
  type CensusContactRow,
  type CensusRunContext,
} from "./contact-census-classifier";

const { Client } = pg;

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────
const RULES_VERSION = "1.0.0";
const BATCH_SIZE = 500;
const POOL_PRESSURE_BACKOFF_MS = 5_000;
const BATCH_TIMEOUT_MS = 30_000;
const HEALTH_CHECK_EVERY_N = 10; // batches

// ──────────────────────────────────────────────────────────────────────────────
// In-process singleton: only one run at a time per process
// ──────────────────────────────────────────────────────────────────────────────
const runningRunIds = new Set<string>();

export function isRunActive(runId: string): boolean {
  return runningRunIds.has(runId);
}

export function hasAnyActiveRun(): boolean {
  return runningRunIds.size > 0;
}

// ──────────────────────────────────────────────────────────────────────────────
// Mutation-proof snapshot
// ──────────────────────────────────────────────────────────────────────────────
async function snapshotRowCounts(client: pg.PoolClient): Promise<Record<string, number>> {
  const tables = [
    "contacts", "businesses", "deals", "commercial_classification_events",
    "sequence_enrollments", "communication_events",
  ];
  const out: Record<string, number> = {};
  for (const t of tables) {
    const r = await client.query(`SELECT COUNT(*) AS n FROM ${t}`);
    out[t] = parseInt(r.rows[0].n, 10);
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────────
// Pool metrics snapshot
// ──────────────────────────────────────────────────────────────────────────────
function poolMetrics() {
  return {
    totalCount: (pool as any).totalCount ?? 0,
    idleCount: (pool as any).idleCount ?? 0,
    waitingCount: (pool as any).waitingCount ?? 0,
    at: new Date().toISOString(),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// DB identity token (opaque; never exposes connection string)
// ──────────────────────────────────────────────────────────────────────────────
async function fetchDbIdentityToken(client: pg.PoolClient): Promise<string> {
  const r = await client.query(
    "SELECT current_database() AS db, pg_postmaster_start_time() AS started_at"
  );
  const { db, started_at } = r.rows[0];
  const { createHash } = await import("crypto");
  return createHash("sha256").update(`${db}||${started_at}`).digest("hex").slice(0, 16);
}

// ──────────────────────────────────────────────────────────────────────────────
// Update run record in DB
// ──────────────────────────────────────────────────────────────────────────────
async function updateRun(runId: string, fields: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  const sets = keys.map((k, i) => `"${toSnake(k)}" = $${i + 2}`).join(", ");
  const values = [runId, ...Object.values(fields)];
  await pool.query(
    `UPDATE contact_census_runs SET ${sets}, updated_at = now() WHERE id = $1`,
    values,
  );
}

function toSnake(s: string): string {
  return s.replace(/([A-Z])/g, (m) => `_${m.toLowerCase()}`);
}

// ──────────────────────────────────────────────────────────────────────────────
// Load shared-phone set (once per run)
// ──────────────────────────────────────────────────────────────────────────────
async function loadSharedPhoneData(client: pg.PoolClient): Promise<{
  sharedPhoneSet: Set<string>;
  sharedPhoneCompanyCount: Map<string, number>;
  sharedPhoneTollFree: Map<string, boolean>;
  sharedPhonePlaceholder: Map<string, boolean>;
  singleCompanySingleSourcePhones: Set<string>;
}> {
  const r = await client.query(`
    SELECT
      phone                                         AS phone,
      COUNT(*)                                      AS cnt,
      COUNT(DISTINCT LOWER(TRIM(company_name)))     AS distinct_companies,
      COUNT(DISTINCT lead_source)                   AS distinct_sources
    FROM contacts
    WHERE archived_at IS NULL
      AND phone IS NOT NULL
      AND TRIM(phone) <> ''
    GROUP BY phone
    HAVING COUNT(*) > 1
  `);

  const sharedPhoneSet = new Set<string>();
  const sharedPhoneCompanyCount = new Map<string, number>();
  const sharedPhoneTollFree = new Map<string, boolean>();
  const sharedPhonePlaceholder = new Map<string, boolean>();
  const singleCompanySingleSourcePhones = new Set<string>();

  for (const row of r.rows) {
    const phone: string = row.phone;
    const companyCount = parseInt(row.distinct_companies, 10);
    const sourceCount = parseInt(row.distinct_sources, 10);

    sharedPhoneSet.add(phone);
    sharedPhoneCompanyCount.set(phone, companyCount);

    const digits = phone.replace(/\D/g, "");
    sharedPhoneTollFree.set(phone, /^1?(800|888|877|866|855|844|833)/.test(digits));
    sharedPhonePlaceholder.set(phone, /1234$|0000$|5555$/.test(digits));

    if (companyCount === 1 && sourceCount === 1) {
      singleCompanySingleSourcePhones.add(phone);
    }
  }

  return { sharedPhoneSet, sharedPhoneCompanyCount, sharedPhoneTollFree, sharedPhonePlaceholder, singleCompanySingleSourcePhones };
}

// ──────────────────────────────────────────────────────────────────────────────
// Load business normalized-name set (once per run)
// ──────────────────────────────────────────────────────────────────────────────
async function loadBusinessNameSet(client: pg.PoolClient): Promise<Set<string>> {
  const r = await client.query(
    `SELECT LOWER(TRIM(normalized_name)) AS n FROM businesses WHERE normalized_name IS NOT NULL`
  );
  return new Set(r.rows.map((row: any) => row.n as string));
}

// ──────────────────────────────────────────────────────────────────────────────
// Login health probe
// ──────────────────────────────────────────────────────────────────────────────
async function isLoginHealthy(): Promise<boolean> {
  try {
    const r = await pool.query("SELECT 1");
    return r.rowCount != null && r.rowCount > 0;
  } catch {
    return false;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Insert batch of member rows
// ──────────────────────────────────────────────────────────────────────────────
async function insertMemberBatch(
  client: pg.PoolClient,
  results: ReturnType<typeof classifyContact>[],
): Promise<void> {
  if (results.length === 0) return;

  const columns = [
    "run_id", "contact_id", "selection_hash",
    "record_class", "identity_state", "business_materialization_state",
    "contactability_state", "vertical_state", "validation_state",
    "compliance_state", "evidence_state", "enrichment_state", "phone_quality_state",
    "primary_lane", "gap_codes",
    "has_business_id", "has_company_name", "has_email", "has_phone", "has_vertical",
    "readiness_score", "lead_score", "has_ghl_link", "has_deal", "lead_source",
  ];

  const valuePlaceholders: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  for (const r of results) {
    const rowParams = [
      r.runId, r.contactId, r.selectionHash,
      r.recordClass, r.identityState, r.businessMaterializationState,
      r.contactabilityState, r.verticalState, r.validationState,
      r.complianceState, r.evidenceState, r.enrichmentState, r.phoneQualityState,
      r.primaryLane, r.gapCodes,
      r.hasBusinessId, r.hasCompanyName, r.hasEmail, r.hasPhone, r.hasVertical,
      r.readinessScore, r.leadScore, r.hasGhlLink, r.hasDeal, r.leadSource,
    ];
    valuePlaceholders.push(`(${rowParams.map(() => `$${paramIdx++}`).join(",")})`);
    values.push(...rowParams);
  }

  await client.query(
    `INSERT INTO contact_census_members (${columns.join(",")}) VALUES ${valuePlaceholders.join(",")}
     ON CONFLICT (run_id, contact_id) DO NOTHING`,
    values,
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Pre-join signals for a batch
// ──────────────────────────────────────────────────────────────────────────────
async function loadBatchSignals(
  client: pg.PoolClient,
  contactIds: number[],
): Promise<Map<number, { hasDeal: boolean; hasSourceEvent: boolean; hasEnrichmentRun: boolean; hasZerobounceRun: boolean; hasMergeRedirect: boolean }>> {
  if (contactIds.length === 0) return new Map();

  const ids = contactIds.join(",");

  const [dealRows, sourceRows, enrichRows, zbRows, mergeRows] = await Promise.all([
    client.query(`SELECT DISTINCT contact_id FROM deals WHERE contact_id = ANY(ARRAY[${ids}]::int[])`),
    client.query(`SELECT DISTINCT contact_id FROM contact_source_events WHERE contact_id = ANY(ARRAY[${ids}]::int[])`),
    client.query(`SELECT DISTINCT contact_id FROM enrichment_runs WHERE contact_id = ANY(ARRAY[${ids}]::int[])`),
    client.query(`SELECT DISTINCT contact_id FROM zerobounce_attempts WHERE contact_id = ANY(ARRAY[${ids}]::int[])`)
      .catch(() => ({ rows: [] })),
    client.query(`SELECT DISTINCT deprecated_contact_id AS contact_id FROM contact_merge_redirects WHERE deprecated_contact_id = ANY(ARRAY[${ids}]::int[]) AND active = true`),
  ]);

  const deals = new Set(dealRows.rows.map((r: any) => r.contact_id as number));
  const sources = new Set(sourceRows.rows.map((r: any) => r.contact_id as number));
  const enriches = new Set(enrichRows.rows.map((r: any) => r.contact_id as number));
  const zbs = new Set(zbRows.rows.map((r: any) => r.contact_id as number));
  const merges = new Set(mergeRows.rows.map((r: any) => r.contact_id as number));

  const out = new Map<number, any>();
  for (const id of contactIds) {
    out.set(id, {
      hasDeal: deals.has(id),
      hasSourceEvent: sources.has(id),
      hasEnrichmentRun: enriches.has(id),
      hasZerobounceRun: zbs.has(id),
      hasMergeRedirect: merges.has(id),
    });
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────────
// Main runner
// ──────────────────────────────────────────────────────────────────────────────
export async function executeCensusRun(runId: string): Promise<void> {
  if (runningRunIds.has(runId)) return; // idempotent

  // Safety: refuse if worker fleet is active
  const bgProfile = process.env.BACKGROUND_JOB_PROFILE ?? "off";
  if (bgProfile !== "off") {
    await pool.query(
      `UPDATE contact_census_runs SET status = 'failed', failure_reason = $2, failed_at = now(), updated_at = now() WHERE id = $1`,
      [runId, `BACKGROUND_JOB_PROFILE is '${bgProfile}', must be 'off' to run census`],
    );
    return;
  }

  runningRunIds.add(runId);
  const client = await pool.connect();
  let paused = false;

  try {
    // Mark running
    await updateRun(runId, { status: "running" });

    const metricsBeforePool = poolMetrics();
    const proofBefore = await snapshotRowCounts(client);
    const dbToken = await fetchDbIdentityToken(client);

    await updateRun(runId, {
      poolMetricsBefore: metricsBeforePool,
      mutationProofBefore: proofBefore,
      dbIdentityToken: dbToken,
    });

    // Count denominator
    const denomR = await client.query(
      `SELECT COUNT(*) AS n FROM contacts WHERE archived_at IS NULL`
    );
    const denominator = parseInt(denomR.rows[0].n, 10);
    await updateRun(runId, { denominatorAtStart: denominator });

    // Load shared-phone and business-name sets once
    const phoneData = await loadSharedPhoneData(client);
    const businessNameSet = await loadBusinessNameSet(client);

    const asOf = new Date().toISOString();
    const ctx: CensusRunContext = {
      runId,
      asOf,
      ...phoneData,
      businessNameSet,
    };

    // Keyset cursor
    let cursor = 0;
    let totalProcessed = 0;
    let totalExcluded = 0;
    const laneCounts: Record<string, number> = {};
    const dimensionCounts: Record<string, Record<string, number>> = {
      d1_record_class: {}, d2_identity: {}, d3_business: {}, d4_contactability: {},
      d5_vertical: {}, d6_validation: {}, d7_compliance: {}, d8_evidence: {},
      d9_enrichment: {}, d10_phone_quality: {},
    };
    const phoneQualityCounts: Record<string, number> = {};
    let batchNum = 0;
    let consecutivePressure = 0;

    while (true) {
      // Check for pause/cancel signal
      const statusR = await client.query(
        `SELECT status FROM contact_census_runs WHERE id = $1`, [runId]
      );
      const currentStatus = statusR.rows[0]?.status;
      if (currentStatus === "cancelled" || currentStatus === "paused") {
        paused = currentStatus === "paused";
        break;
      }

      // Pool pressure check
      const pressure = (pool as any).waitingCount ?? 0;
      if (pressure > 0) {
        consecutivePressure++;
        if (consecutivePressure >= 2) {
          await updateRun(runId, {
            status: "paused",
            pauseReason: `Pool pressure: waitingCount=${pressure} sustained across 2 batches`,
            cursorContactId: cursor,
            totalProcessed,
            totalExcluded,
            laneCounts,
            dimensionCounts,
            phoneQualityCounts,
            poolMetricsDuring: poolMetrics(),
          });
          paused = true;
          break;
        }
        await new Promise(r => setTimeout(r, POOL_PRESSURE_BACKOFF_MS));
        continue;
      }
      consecutivePressure = 0;

      // Login health probe every N batches
      if (batchNum > 0 && batchNum % HEALTH_CHECK_EVERY_N === 0) {
        const healthy = await isLoginHealthy();
        if (!healthy) {
          await updateRun(runId, {
            status: "paused",
            pauseReason: "Login health probe failed",
            cursorContactId: cursor,
            totalProcessed,
            totalExcluded,
          });
          paused = true;
          break;
        }
      }

      // Fetch batch
      const batchStart = Date.now();
      const batchR = await client.query(
        `SELECT
          id, first_name, last_name, email, phone, company_name,
          vertical, vertical_source, manual_vertical_override,
          data_readiness_score, lead_score,
          email_status, email_validation_updated_at,
          business_id, do_not_contact, suppression_reason,
          bounce_status, complaint_status, consent_tier,
          record_class, ghl_contact_id, lead_source
         FROM contacts
         WHERE archived_at IS NULL AND id > $1
         ORDER BY id ASC
         LIMIT $2`,
        [cursor, BATCH_SIZE],
      );

      const batchDuration = Date.now() - batchStart;
      if (batchDuration > BATCH_TIMEOUT_MS) {
        await updateRun(runId, {
          status: "paused",
          pauseReason: `Batch query exceeded ${BATCH_TIMEOUT_MS}ms (took ${batchDuration}ms)`,
          cursorContactId: cursor,
          totalProcessed,
          totalExcluded,
        });
        paused = true;
        break;
      }

      if (batchR.rows.length === 0) break;

      const contactIds = batchR.rows.map((r: any) => r.id as number);
      const signals = await loadBatchSignals(client, contactIds);

      const results: ReturnType<typeof classifyContact>[] = [];

      for (const raw of batchR.rows) {
        const sig = signals.get(raw.id) ?? {
          hasDeal: false, hasSourceEvent: false, hasEnrichmentRun: false,
          hasZerobounceRun: false, hasMergeRedirect: false,
        };

        const row: CensusContactRow = {
          id: raw.id,
          firstName: raw.first_name,
          lastName: raw.last_name,
          email: raw.email || null,
          phone: raw.phone || null,
          companyName: raw.company_name || null,
          vertical: raw.vertical || null,
          verticalSource: raw.vertical_source || null,
          manualVerticalOverride: raw.manual_vertical_override,
          dataReadinessScore: raw.data_readiness_score != null ? parseInt(raw.data_readiness_score) : null,
          leadScore: raw.lead_score != null ? parseInt(raw.lead_score) : null,
          emailStatus: raw.email_status || null,
          emailValidationUpdatedAt: raw.email_validation_updated_at ? new Date(raw.email_validation_updated_at) : null,
          businessId: raw.business_id != null ? parseInt(raw.business_id) : null,
          doNotContact: raw.do_not_contact,
          suppressionReason: raw.suppression_reason || null,
          bounceStatus: raw.bounce_status || null,
          complaintStatus: raw.complaint_status || null,
          consentTier: raw.consent_tier || null,
          recordClass: raw.record_class || null,
          ghlContactId: raw.ghl_contact_id || null,
          leadSource: raw.lead_source || null,
          hasDeal: sig.hasDeal,
          hasSourceEvent: sig.hasSourceEvent,
          hasEnrichmentRun: sig.hasEnrichmentRun,
          hasZerobounceRun: sig.hasZerobounceRun,
          hasMergeRedirect: sig.hasMergeRedirect,
          normalizedPhone: raw.phone?.trim() || null,
        };

        const result = classifyContact(row, ctx);
        results.push(result);

        // Tally
        laneCounts[result.primaryLane] = (laneCounts[result.primaryLane] ?? 0) + 1;
        dimensionCounts.d1_record_class[result.recordClass] = (dimensionCounts.d1_record_class[result.recordClass] ?? 0) + 1;
        dimensionCounts.d2_identity[result.identityState] = (dimensionCounts.d2_identity[result.identityState] ?? 0) + 1;
        dimensionCounts.d3_business[result.businessMaterializationState] = (dimensionCounts.d3_business[result.businessMaterializationState] ?? 0) + 1;
        dimensionCounts.d4_contactability[result.contactabilityState] = (dimensionCounts.d4_contactability[result.contactabilityState] ?? 0) + 1;
        dimensionCounts.d5_vertical[result.verticalState] = (dimensionCounts.d5_vertical[result.verticalState] ?? 0) + 1;
        dimensionCounts.d6_validation[result.validationState] = (dimensionCounts.d6_validation[result.validationState] ?? 0) + 1;
        dimensionCounts.d7_compliance[result.complianceState] = (dimensionCounts.d7_compliance[result.complianceState] ?? 0) + 1;
        dimensionCounts.d8_evidence[result.evidenceState] = (dimensionCounts.d8_evidence[result.evidenceState] ?? 0) + 1;
        dimensionCounts.d9_enrichment[result.enrichmentState] = (dimensionCounts.d9_enrichment[result.enrichmentState] ?? 0) + 1;
        dimensionCounts.d10_phone_quality[result.phoneQualityState] = (dimensionCounts.d10_phone_quality[result.phoneQualityState] ?? 0) + 1;
        phoneQualityCounts[result.phoneQualityState] = (phoneQualityCounts[result.phoneQualityState] ?? 0) + 1;

        totalProcessed++;
      }

      await insertMemberBatch(client, results);

      cursor = batchR.rows[batchR.rows.length - 1].id;
      batchNum++;

      // Progress checkpoint every 10 batches
      if (batchNum % 10 === 0) {
        await updateRun(runId, {
          cursorContactId: cursor,
          totalProcessed,
          totalExcluded,
          laneCounts,
          dimensionCounts,
          phoneQualityCounts,
          poolMetricsDuring: poolMetrics(),
        });
      }
    }

    if (!paused) {
      // Final mutation proof
      const proofAfter = await snapshotRowCounts(client);
      const metricsAfter = poolMetrics();

      // Reconciliation invariant
      const reconciles = totalProcessed + totalExcluded === denominator;

      await updateRun(runId, {
        status: reconciles ? "completed" : "failed",
        failureReason: reconciles ? null : `Reconciliation failed: processed(${totalProcessed}) + excluded(${totalExcluded}) ≠ denominator(${denominator})`,
        completedAt: new Date().toISOString(),
        totalProcessed,
        totalExcluded,
        laneCounts,
        dimensionCounts,
        phoneQualityCounts,
        mutationProofAfter: proofAfter,
        poolMetricsAfter: metricsAfter,
        cursorContactId: cursor,
        providerCallCount: 0,
      });
    }
  } catch (err: any) {
    console.error("[CensusRunner] Fatal error:", err.message);
    try {
      await pool.query(
        `UPDATE contact_census_runs SET status = 'failed', failure_reason = $2, failed_at = now(), updated_at = now() WHERE id = $1`,
        [runId, String(err.message ?? err)],
      );
    } catch { /* ignore secondary errors */ }
  } finally {
    client.release();
    runningRunIds.delete(runId);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Create a new run record and kick it off in background
// ──────────────────────────────────────────────────────────────────────────────
export async function createAndStartRun(opts: {
  requestedBy: string;
  environmentLabel: "development_preview" | "production_readonly_preview" | "frozen_production_snapshot";
  releaseSha?: string;
}): Promise<string> {
  if (hasAnyActiveRun()) {
    throw new Error("A census run is already in progress. Pause or wait for it to complete.");
  }

  const sha = opts.releaseSha ?? process.env.RELEASE_SHA ?? "unknown";
  const selectorHash = require("crypto")
    .createHash("sha256")
    .update(`full||${new Date().toISOString()}||${sha}`)
    .digest("hex")
    .slice(0, 32);

  const r = await pool.query(
    `INSERT INTO contact_census_runs
       (snapshot_type, environment_label, selector_hash, selector_params, rules_version, release_sha, db_identity_token, requested_by)
     VALUES ('full', $1, $2, '{}', $3, $4, 'pending', $5)
     RETURNING id`,
    [opts.environmentLabel, selectorHash, RULES_VERSION, sha, opts.requestedBy],
  );
  const runId: string = r.rows[0].id;

  // Fire-and-forget; status tracked in DB
  setImmediate(() => executeCensusRun(runId).catch(e => console.error("[CensusRunner] Unhandled:", e)));

  return runId;
}

// ──────────────────────────────────────────────────────────────────────────────
// Preview — counts without creating a run
// ──────────────────────────────────────────────────────────────────────────────
export async function getCensusPreview(): Promise<{
  totalActive: number;
  totalArchived: number;
  byRecordClass: Record<string, number>;
  byContactability: Record<string, number>;
  byEmailStatus: Record<string, number>;
  sharedPhoneContactCount: number;
  sharedPhoneDistinctValues: number;
  businessRows: number;
  poolMetrics: ReturnType<typeof poolMetrics>;
}> {
  const client = await pool.connect();
  try {
    const [activeR, archivedR, rcR, emailR, phoneSharedR, bizR] = await Promise.all([
      client.query(`SELECT COUNT(*) AS n FROM contacts WHERE archived_at IS NULL`),
      client.query(`SELECT COUNT(*) AS n FROM contacts WHERE archived_at IS NOT NULL`),
      client.query(`SELECT record_class, COUNT(*) AS n FROM contacts WHERE archived_at IS NULL GROUP BY record_class ORDER BY n DESC`),
      client.query(`SELECT email_status, COUNT(*) AS n FROM contacts WHERE archived_at IS NULL GROUP BY email_status ORDER BY n DESC`),
      client.query(`
        SELECT COUNT(*) AS shared_contacts, COUNT(DISTINCT phone) AS distinct_phones
        FROM contacts
        WHERE archived_at IS NULL AND phone IN (
          SELECT phone FROM contacts WHERE archived_at IS NULL AND phone IS NOT NULL AND TRIM(phone) <> ''
          GROUP BY phone HAVING COUNT(*) > 1
        )
      `),
      client.query(`SELECT COUNT(*) AS n FROM businesses`),
    ]);

    const byRecordClass: Record<string, number> = {};
    for (const row of rcR.rows) {
      byRecordClass[row.record_class ?? "null"] = parseInt(row.n, 10);
    }

    const byEmailStatus: Record<string, number> = {};
    for (const row of emailR.rows) {
      byEmailStatus[row.email_status ?? "null"] = parseInt(row.n, 10);
    }

    const contactability: Record<string, number> = {};
    const cR = await client.query(`
      SELECT
        CASE WHEN email IS NOT NULL AND TRIM(email) <> '' AND phone IS NOT NULL AND TRIM(phone) <> '' THEN 'email_and_phone'
             WHEN email IS NOT NULL AND TRIM(email) <> '' THEN 'email_only'
             WHEN phone IS NOT NULL AND TRIM(phone) <> '' THEN 'phone_only'
             ELSE 'no_usable_channel' END AS c,
        COUNT(*) AS n
      FROM contacts WHERE archived_at IS NULL GROUP BY 1
    `);
    for (const row of cR.rows) contactability[row.c] = parseInt(row.n, 10);

    return {
      totalActive: parseInt(activeR.rows[0].n, 10),
      totalArchived: parseInt(archivedR.rows[0].n, 10),
      byRecordClass,
      byContactability: contactability,
      byEmailStatus,
      sharedPhoneContactCount: parseInt(phoneSharedR.rows[0].shared_contacts, 10),
      sharedPhoneDistinctValues: parseInt(phoneSharedR.rows[0].distinct_phones, 10),
      businessRows: parseInt(bizR.rows[0].n, 10),
      poolMetrics: poolMetrics(),
    };
  } finally {
    client.release();
  }
}
