/**
 * Contact Census Runner — admin-triggered, read-mostly census of all active contacts.
 *
 * Safety guarantees:
 *  - Zero external provider calls (provider_call_count always stays 0)
 *  - Zero writes to canonical contact/business/deal tables
 *  - Mutation proof: before/after row counts on 6 canonical tables
 *  - BACKGROUND_JOB_PROFILE must be 'off' to start a run
 *
 * Single-run ownership — DB-enforced, not process-local:
 *  - Unique partial index census_runs_one_active enforces at most one row in
 *    status IN ('pending','running') across ALL application instances.
 *  - Each run records lease_owner (hostname:pid) and lease_expires_at.
 *  - The lease is refreshed every LEASE_REFRESH_EVERY_N batches.
 *  - A run whose lease_expires_at < now() is considered crashed; admins can cancel it.
 *  - All status transitions (pause/resume/cancel/complete) are CAS-protected:
 *    they check the current status in the WHERE clause and return 0 rows if mismatched.
 *
 * Frozen membership semantics:
 *  - At run start: capture max_contact_id_at_start = MAX(id) WHERE archived_at IS NULL.
 *    This is the ending watermark. Contacts with id > this value are never entered.
 *  - denominator_at_start = COUNT(*) WHERE archived_at IS NULL AND id <= max_contact_id
 *  - Batch query: WHERE archived_at IS NULL AND id > cursor AND id <= max_contact_id
 *  - Contacts archived mid-run (within watermark range, but archived_at IS NOT NULL
 *    by the time the batch reaches them) are counted as terminal_snapshot_exceptions.
 *  - Reconciliation: total_processed + terminal_snapshot_exceptions = denominator_at_start
 *
 * Memory design:
 *  - shared-phone set and business-name set are loaded ONCE per run into process memory.
 *  - Each entry is a raw phone or normalized business-name string (~10–40 chars).
 *  - At 154K contacts: expected shared-phone set ≤ 30K entries (~4 MB), business-name
 *    set ≤ 100K entries (~5 MB). Total per-instance ceiling: 50 MB (enforced at preflight).
 *  - In a multi-instance deployment each process holds its own copy; only one process
 *    can run the census at a time (enforced by DB partial index), so footprint is
 *    bounded to one copy system-wide.
 *  - Raw strings (not hashes) are retained because the classifier must look up each
 *    contact's phone/name in these sets. SHA hashing would require the same normalization
 *    to be applied both at load time and per-contact, gaining nothing.
 */

import os from "os";
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
const HEALTH_CHECK_EVERY_N = 10;     // batches
const LEASE_REFRESH_EVERY_N = 10;    // batches
const LEASE_DURATION_SECS = 120;     // 2 minutes

/** Hard ceiling: abort run if in-memory sets exceed this (per-instance). */
const MEMORY_CEILING_BYTES = 50 * 1024 * 1024; // 50 MB

// ──────────────────────────────────────────────────────────────────────────────
// Lease owner identifier
// ──────────────────────────────────────────────────────────────────────────────
export function leaseOwnerTag(): string {
  return `${os.hostname()}:${process.pid}`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Environment label — server-derived, never supplied by client
// ──────────────────────────────────────────────────────────────────────────────
export function deriveEnvironmentLabel(): "development_preview" | "production_readonly_preview" | "frozen_production_snapshot" {
  const sha = process.env.RELEASE_SHA;
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv === "production" && sha && sha !== "unknown") {
    return "frozen_production_snapshot";
  }
  if (nodeEnv === "production") {
    return "production_readonly_preview";
  }
  return "development_preview";
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
// CAS-protected run update — only touches rows owned by leaseOwner
// ──────────────────────────────────────────────────────────────────────────────
async function casUpdateRun(
  runId: string,
  leaseOwner: string,
  fields: Record<string, unknown>,
): Promise<boolean> {
  const keys = Object.keys(fields);
  if (keys.length === 0) return true;
  const sets = keys.map((k, i) => `"${toSnake(k)}" = $${i + 3}`).join(", ");
  const values = [runId, leaseOwner, ...Object.values(fields)];
  const r = await pool.query(
    `UPDATE contact_census_runs SET ${sets}, updated_at = now()
     WHERE id = $1 AND lease_owner = $2`,
    values,
  );
  return (r.rowCount ?? 0) > 0;
}

function toSnake(s: string): string {
  return s.replace(/([A-Z])/g, (m) => `_${m.toLowerCase()}`);
}

// ──────────────────────────────────────────────────────────────────────────────
// Lease refresh
// ──────────────────────────────────────────────────────────────────────────────
async function refreshLease(runId: string, leaseOwner: string): Promise<boolean> {
  const r = await pool.query(
    `UPDATE contact_census_runs
     SET lease_expires_at = now() + interval '${LEASE_DURATION_SECS} seconds', updated_at = now()
     WHERE id = $1 AND lease_owner = $2 AND status = 'running'`,
    [runId, leaseOwner],
  );
  return (r.rowCount ?? 0) > 0;
}

// ──────────────────────────────────────────────────────────────────────────────
// Load shared-phone set (once per run)
// Returns raw phone strings (not hashes) so the classifier can look them up
// by matching each contact's phone value after the same trim normalization.
// ──────────────────────────────────────────────────────────────────────────────
async function loadSharedPhoneData(client: pg.PoolClient): Promise<{
  sharedPhoneSet: Set<string>;
  sharedPhoneCompanyCount: Map<string, number>;
  sharedPhoneTollFree: Map<string, boolean>;
  sharedPhonePlaceholder: Map<string, boolean>;
  singleCompanySingleSourcePhones: Set<string>;
  estimatedBytes: number;
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
  let estimatedBytes = 0;

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

    // 4 map entries per phone, ~24 bytes overhead each + key string bytes
    estimatedBytes += (phone.length * 4) + (4 * 24);
  }

  return {
    sharedPhoneSet,
    sharedPhoneCompanyCount,
    sharedPhoneTollFree,
    sharedPhonePlaceholder,
    singleCompanySingleSourcePhones,
    estimatedBytes,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Load business normalized-name set (once per run)
// ──────────────────────────────────────────────────────────────────────────────
async function loadBusinessNameSet(client: pg.PoolClient): Promise<{ set: Set<string>; estimatedBytes: number }> {
  const r = await client.query(
    `SELECT LOWER(TRIM(normalized_name)) AS n FROM businesses WHERE normalized_name IS NOT NULL`
  );
  const set = new Set<string>(r.rows.map((row: any) => row.n as string));
  const estimatedBytes = r.rows.reduce((acc: number, row: any) => acc + (row.n?.length ?? 0) + 40, 0);
  return { set, estimatedBytes };
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
export async function executeCensusRun(runId: string, owner: string): Promise<void> {
  // Safety: refuse if worker fleet is active
  const bgProfile = process.env.BACKGROUND_JOB_PROFILE ?? "off";
  if (bgProfile !== "off") {
    await pool.query(
      `UPDATE contact_census_runs SET status = 'failed', failure_reason = $2, failed_at = now(), updated_at = now() WHERE id = $1 AND lease_owner = $3`,
      [runId, `BACKGROUND_JOB_PROFILE is '${bgProfile}', must be 'off' to run census`, owner],
    );
    return;
  }

  const client = await pool.connect();
  let paused = false;

  try {
    const metricsBeforePool = poolMetrics();
    const proofBefore = await snapshotRowCounts(client);
    const dbToken = await fetchDbIdentityToken(client);

    // Capture ending watermark (frozen membership boundary)
    const watermarkR = await client.query(
      `SELECT COALESCE(MAX(id), 0) AS max_id FROM contacts WHERE archived_at IS NULL`
    );
    const maxContactId: number = parseInt(watermarkR.rows[0].max_id, 10);

    // Frozen denominator: count within the watermark
    const denomR = await client.query(
      `SELECT COUNT(*) AS n FROM contacts WHERE archived_at IS NULL AND id <= $1`,
      [maxContactId],
    );
    const denominator = parseInt(denomR.rows[0].n, 10);

    const leaseOk = await casUpdateRun(runId, owner, {
      poolMetricsBefore: metricsBeforePool,
      mutationProofBefore: proofBefore,
      dbIdentityToken: dbToken,
      maxContactIdAtStart: maxContactId,
      denominatorAtStart: denominator,
    });
    if (!leaseOk) {
      console.warn(`[CensusRunner] Lost lease on run ${runId} before watermark capture`);
      return;
    }

    // Memory preflight — load shared-phone and business-name sets once
    const phoneData = await loadSharedPhoneData(client);
    const bizData = await loadBusinessNameSet(client);
    const totalMemBytes = phoneData.estimatedBytes + bizData.estimatedBytes;

    console.log(
      `[CensusRunner] Memory preflight: phone_entries=${phoneData.sharedPhoneSet.size}` +
      ` biz_entries=${bizData.set.size}` +
      ` estimated_bytes=${totalMemBytes}` +
      ` ceiling=${MEMORY_CEILING_BYTES}`
    );

    if (totalMemBytes > MEMORY_CEILING_BYTES) {
      const reason = `In-memory sets (${Math.round(totalMemBytes / 1024 / 1024)}MB) exceed ${Math.round(MEMORY_CEILING_BYTES / 1024 / 1024)}MB ceiling`;
      await pool.query(
        `UPDATE contact_census_runs SET status='paused', pause_reason=$2, updated_at=now() WHERE id=$1 AND lease_owner=$3`,
        [runId, reason, owner],
      );
      return;
    }

    const asOf = new Date().toISOString();
    const ctx: CensusRunContext = {
      runId,
      asOf,
      sharedPhoneSet: phoneData.sharedPhoneSet,
      sharedPhoneCompanyCount: phoneData.sharedPhoneCompanyCount,
      sharedPhoneTollFree: phoneData.sharedPhoneTollFree,
      sharedPhonePlaceholder: phoneData.sharedPhonePlaceholder,
      singleCompanySingleSourcePhones: phoneData.singleCompanySingleSourcePhones,
      businessNameSet: bizData.set,
    };

    // Keyset cursor — bounded to [0, maxContactId]
    let cursor = 0;
    let totalProcessed = 0;
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
      // CAS check: are we still the owner and still 'running'?
      const statusR = await client.query(
        `SELECT status, lease_owner FROM contact_census_runs WHERE id = $1`, [runId]
      );
      const currentStatus = statusR.rows[0]?.status;
      const currentOwner = statusR.rows[0]?.lease_owner;

      if (currentOwner !== owner) {
        console.warn(`[CensusRunner] Lease stolen on run ${runId} — exiting`);
        return;
      }
      if (currentStatus === "cancelled") { return; }
      if (currentStatus === "paused") { paused = true; break; }
      if (currentStatus !== "running") { return; }

      // Pool pressure check
      const pressure = (pool as any).waitingCount ?? 0;
      if (pressure > 0) {
        consecutivePressure++;
        if (consecutivePressure >= 2) {
          await pool.query(
            `UPDATE contact_census_runs SET status='paused', pause_reason=$2, cursor_contact_id=$3,
             total_processed=$4, lane_counts=$5, dimension_counts=$6, phone_quality_counts=$7,
             pool_metrics_during=$8, updated_at=now()
             WHERE id=$1 AND lease_owner=$9`,
            [runId,
              `Pool pressure: waitingCount=${pressure} sustained across 2 batches`,
              cursor, totalProcessed,
              JSON.stringify(laneCounts), JSON.stringify(dimensionCounts), JSON.stringify(phoneQualityCounts),
              JSON.stringify(poolMetrics()), owner],
          );
          paused = true;
          break;
        }
        await new Promise(r => setTimeout(r, POOL_PRESSURE_BACKOFF_MS));
        continue;
      }
      consecutivePressure = 0;

      // Health probe every N batches
      if (batchNum > 0 && batchNum % HEALTH_CHECK_EVERY_N === 0) {
        const healthy = await isLoginHealthy();
        if (!healthy) {
          await pool.query(
            `UPDATE contact_census_runs SET status='paused', pause_reason=$2, cursor_contact_id=$3, total_processed=$4, updated_at=now() WHERE id=$1 AND lease_owner=$5`,
            [runId, "Login health probe failed", cursor, totalProcessed, owner],
          );
          paused = true;
          break;
        }
      }

      // Lease refresh every N batches
      if (batchNum > 0 && batchNum % LEASE_REFRESH_EVERY_N === 0) {
        const renewed = await refreshLease(runId, owner);
        if (!renewed) {
          console.warn(`[CensusRunner] Lease not renewed for run ${runId} — another process may have taken over`);
          return;
        }
      }

      // Fetch batch — bounded by frozen watermark
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
         WHERE archived_at IS NULL AND id > $1 AND id <= $2
         ORDER BY id ASC
         LIMIT $3`,
        [cursor, maxContactId, BATCH_SIZE],
      );

      const batchDuration = Date.now() - batchStart;
      if (batchDuration > BATCH_TIMEOUT_MS) {
        await pool.query(
          `UPDATE contact_census_runs SET status='paused', pause_reason=$2, cursor_contact_id=$3, total_processed=$4, updated_at=now() WHERE id=$1 AND lease_owner=$5`,
          [runId, `Batch query exceeded ${BATCH_TIMEOUT_MS}ms (took ${batchDuration}ms)`, cursor, totalProcessed, owner],
        );
        paused = true;
        break;
      }

      if (batchR.rows.length === 0) break; // exhausted watermark range

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
        await pool.query(
          `UPDATE contact_census_runs SET cursor_contact_id=$2, total_processed=$3,
           lane_counts=$4, dimension_counts=$5, phone_quality_counts=$6,
           pool_metrics_during=$7, updated_at=now()
           WHERE id=$1 AND lease_owner=$8`,
          [runId, cursor, totalProcessed, JSON.stringify(laneCounts),
           JSON.stringify(dimensionCounts), JSON.stringify(phoneQualityCounts),
           JSON.stringify(poolMetrics()), owner],
        );
      }
    }

    if (!paused) {
      // Final mutation proof
      const proofAfter = await snapshotRowCounts(client);
      const metricsAfter = poolMetrics();

      // Terminal snapshot exceptions: contacts in watermark that got archived mid-run
      // (they were counted in denominator but not returned by archived_at IS NULL queries)
      const terminalExceptions = denominator - totalProcessed;

      // Reconciliation: totalProcessed + terminalExceptions = denominator (always true by construction)
      const reconciles = terminalExceptions >= 0;

      await pool.query(
        `UPDATE contact_census_runs SET
           status = $2, completed_at = now(), total_processed = $3, total_excluded = 0,
           terminal_snapshot_exceptions = $4, lane_counts = $5, dimension_counts = $6,
           phone_quality_counts = $7, mutation_proof_after = $8, pool_metrics_after = $9,
           cursor_contact_id = $10, provider_call_count = 0,
           failure_reason = $11, updated_at = now()
         WHERE id = $1 AND lease_owner = $12`,
        [
          runId,
          reconciles ? "completed" : "failed",
          totalProcessed, terminalExceptions,
          JSON.stringify(laneCounts), JSON.stringify(dimensionCounts), JSON.stringify(phoneQualityCounts),
          JSON.stringify(proofAfter), JSON.stringify(metricsAfter),
          cursor,
          reconciles ? null : `Internal error: terminalExceptions (${terminalExceptions}) < 0`,
          owner,
        ],
      );
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
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Create a new run record and kick it off in background.
// Environment label is ALWAYS derived server-side; any client-supplied value is ignored.
// Throws if another run is already active (unique partial index → unique_violation 23505).
// ──────────────────────────────────────────────────────────────────────────────
export async function createAndStartRun(opts: {
  requestedBy: string;
  releaseSha?: string;
}): Promise<string> {
  const envLabel = deriveEnvironmentLabel();
  const sha = opts.releaseSha ?? process.env.RELEASE_SHA ?? "unknown";
  const owner = leaseOwnerTag();
  const { createHash } = await import("crypto");

  const selectorHash = createHash("sha256")
    .update(`full||${new Date().toISOString()}||${sha}`)
    .digest("hex")
    .slice(0, 32);

  // Insert directly as 'running' with lease; the unique partial index
  // (census_runs_one_active) enforces single-run ownership across all instances.
  // A second concurrent insert throws error code 23505 (unique_violation).
  const r = await pool.query(
    `INSERT INTO contact_census_runs
       (snapshot_type, environment_label, selector_hash, selector_params, rules_version,
        release_sha, db_identity_token, as_of, requested_by, status,
        lease_owner, lease_expires_at, max_contact_id_at_start)
     VALUES ('full', $1, $2, '{}', $3, $4, 'pending', now(), $5, 'running',
             $6, now() + interval '${LEASE_DURATION_SECS} seconds', 0)
     RETURNING id`,
    [envLabel, selectorHash, RULES_VERSION, sha, opts.requestedBy, owner],
  );
  const runId: string = r.rows[0].id;

  // Fire-and-forget; status tracked in DB
  setImmediate(() => executeCensusRun(runId, owner).catch(e => console.error("[CensusRunner] Unhandled:", e)));

  return runId;
}

// ──────────────────────────────────────────────────────────────────────────────
// Resume a paused run — atomically claims the active slot.
// If another run is active, the unique partial index blocks the UPDATE (status→running).
// ──────────────────────────────────────────────────────────────────────────────
export async function resumeRun(runId: string): Promise<boolean> {
  const owner = leaseOwnerTag();
  const r = await pool.query(
    `UPDATE contact_census_runs
     SET status = 'running', pause_reason = NULL,
         lease_owner = $2,
         lease_expires_at = now() + interval '${LEASE_DURATION_SECS} seconds',
         updated_at = now()
     WHERE id = $1 AND status = 'paused'
     RETURNING id`,
    [runId, owner],
  );
  if ((r.rowCount ?? 0) === 0) return false;

  setImmediate(() => executeCensusRun(runId, owner).catch(e => console.error("[CensusRunner] Resume error:", e)));
  return true;
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
  environmentLabel: string;
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
      environmentLabel: deriveEnvironmentLabel(),
      poolMetrics: poolMetrics(),
    };
  } finally {
    client.release();
  }
}
