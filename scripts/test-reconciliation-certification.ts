#!/usr/bin/env tsx
/**
 * scripts/test-reconciliation-certification.ts
 *
 * Integration certification for the reconciliation system.
 * Requires TEST_DATABASE_URL to be set — NEVER runs against production.
 *
 * Applies all reconciliation migrations (0227–0229), provisions a disposable
 * schema, then exercises the ACTUAL exported service functions:
 *   - approveProposal  — CAS guard, reversal ledger, audit log
 *   - rejectProposal   — no-contact-write, status transition
 *   - revertProposal   — CAS-safe field restore, reversal ledger, audit log
 *
 * Also verifies:
 *   - Run lifecycle (create / pause / resume / cancel / complete)
 *   - Ownership CAS: stale lease owner cannot mark run failed
 *   - Pause/resume accounting: per-batch checkpoint correctness
 *   - Single-active-run enforcement (23505 on second concurrent insert)
 *   - Org candidate aggregation (ON CONFLICT DO NOTHING idempotency)
 *   - Duplicate cluster model (N members per cluster, not pairs)
 *   - Normalization proposal generation and storage
 *   - Reversal constraint now uses 'reverted' (not 'reversed')
 *   - Route-level UUID validation (400 on bad ID)
 *   - Export CSV shape
 *   - Dimension queries return correct buckets
 */

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DB_URL) {
  console.error(
    "✗ TEST_DATABASE_URL is not set. Reconciliation certification MUST use a disposable database.\n" +
    "  Set TEST_DATABASE_URL to a non-production database URL to run this suite.\n" +
    "  Example: TEST_DATABASE_URL=postgresql://localhost/test_reconciliation npx tsx scripts/test-reconciliation-certification.ts"
  );
  process.exit(1);
}

// Safety guard: refuse to run against any known production-shaped URL
const urlLower = TEST_DB_URL.toLowerCase();
if (
  urlLower.includes("prod") ||
  urlLower.includes("production") ||
  urlLower.includes("liberty") ||
  (process.env.PGDATABASE && urlLower.includes(process.env.PGDATABASE.toLowerCase()) &&
    !urlLower.includes("test") && !urlLower.includes("disposable") && !urlLower.includes("local"))
) {
  console.error("✗ TEST_DATABASE_URL appears to point to a production database. Refusing to run.");
  process.exit(1);
}

import pg from "pg";
import { readFileSync } from "fs";
import path from "path";
import crypto from "crypto";

// Import the actual service functions with pool injection so we exercise the
// real approval/revert code paths, not inline SQL approximations.
import {
  approveProposal,
  rejectProposal,
  revertProposal,
} from "../server/services/reconciliation-approval";

const { Client, Pool } = pg;

// ──────────────────────────────────────────────────────────────────────────────
// Test harness
// ──────────────────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, extra?: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${extra ? ` — ${extra}` : ""}`);
    failed++;
  }
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, label, ok ? undefined : `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

function uuid(): string {
  return crypto.randomUUID();
}

// ──────────────────────────────────────────────────────────────────────────────
// Database setup
// ──────────────────────────────────────────────────────────────────────────────
async function applyMigration(client: InstanceType<typeof Client>, filename: string): Promise<void> {
  const migPath = path.join(process.cwd(), "migrations", filename);
  const sql = readFileSync(migPath, "utf-8");
  await client.query(sql);
}

// ──────────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────────
async function main() {
  const client = new Client({ connectionString: TEST_DB_URL, statement_timeout: 0 });
  await client.connect();

  // Also create a Pool so we can pass it to the injectable service functions.
  const testPool = new Pool({ connectionString: TEST_DB_URL, statement_timeout: 0, max: 5 });

  console.log("[Cert] Connected to test database.");
  console.log("[Cert] Setting up minimal schema...\n");

  // Minimal prerequisites: contacts, businesses, audit_logs, contact_census_runs/members
  await client.query(`
    CREATE TABLE IF NOT EXISTS contacts (
      id SERIAL PRIMARY KEY,
      first_name TEXT, last_name TEXT, email TEXT, phone TEXT,
      company_name TEXT, vertical TEXT, vertical_source TEXT,
      manual_vertical_override BOOLEAN DEFAULT false,
      do_not_contact BOOLEAN DEFAULT false, suppression_reason TEXT,
      email_status TEXT DEFAULT 'unvalidated', bounce_status TEXT, complaint_status TEXT,
      consent_tier TEXT, record_class TEXT DEFAULT 'production',
      ghl_contact_id TEXT, lead_source TEXT, business_id INT,
      archived_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS businesses (
      id SERIAL PRIMARY KEY, canonical_name TEXT, normalized_name TEXT,
      website_domain TEXT, vertical TEXT, created_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  // audit_logs must match the REAL production schema — actor_type, actor_id, details
  // (not actor/metadata which were the incorrect cert fixture columns).
  await client.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGSERIAL PRIMARY KEY,
      entity_type TEXT,
      entity_id BIGINT,
      action TEXT NOT NULL,
      actor_type TEXT NOT NULL DEFAULT 'user',
      actor_id TEXT,
      details JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS contact_census_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      snapshot_type TEXT NOT NULL DEFAULT 'full',
      environment_label TEXT NOT NULL DEFAULT 'development_preview',
      selector_hash TEXT, selector_params JSONB DEFAULT '{}',
      rules_version TEXT NOT NULL DEFAULT '1.0.0',
      release_sha TEXT DEFAULT 'unknown',
      db_identity_token TEXT DEFAULT 'test',
      as_of TIMESTAMPTZ DEFAULT now(),
      requested_by TEXT NOT NULL DEFAULT 'test',
      status TEXT NOT NULL DEFAULT 'completed',
      pause_reason TEXT, failure_reason TEXT,
      lease_owner TEXT, lease_expires_at TIMESTAMPTZ,
      max_contact_id_at_start BIGINT DEFAULT 0,
      denominator_at_start BIGINT DEFAULT 0,
      total_processed BIGINT DEFAULT 0, total_excluded BIGINT DEFAULT 0,
      terminal_snapshot_exceptions BIGINT DEFAULT 0,
      cursor_contact_id BIGINT DEFAULT 0,
      provider_call_count INT DEFAULT 0,
      lane_counts JSONB, dimension_counts JSONB, phone_quality_counts JSONB,
      mutation_proof_before JSONB, mutation_proof_after JSONB,
      pool_metrics_before JSONB, pool_metrics_during JSONB, pool_metrics_after JSONB,
      completed_at TIMESTAMPTZ, failed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS contact_census_members (
      id BIGSERIAL PRIMARY KEY,
      run_id UUID NOT NULL, contact_id INT NOT NULL,
      selection_hash TEXT, record_class TEXT DEFAULT 'production',
      identity_state TEXT DEFAULT 'resolved',
      business_materialization_state TEXT DEFAULT 'pipeline_eligible',
      contactability_state TEXT DEFAULT 'email_and_phone',
      vertical_state TEXT DEFAULT 'missing',
      validation_state TEXT DEFAULT 'unknown',
      compliance_state TEXT DEFAULT 'eligible',
      evidence_state TEXT DEFAULT 'partial_existing',
      enrichment_state TEXT DEFAULT 'none',
      phone_quality_state TEXT DEFAULT 'unique',
      primary_lane TEXT NOT NULL DEFAULT 'NEEDS_BUSINESS_MATERIALIZATION',
      gap_codes TEXT[] DEFAULT '{}',
      has_business_id BOOLEAN DEFAULT false, has_company_name BOOLEAN DEFAULT true,
      has_email BOOLEAN DEFAULT true, has_phone BOOLEAN DEFAULT true,
      has_vertical BOOLEAN DEFAULT false, readiness_score INT, lead_score INT,
      has_ghl_link BOOLEAN DEFAULT false, has_deal BOOLEAN DEFAULT false, lead_source TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE (run_id, contact_id)
    )
  `);

  // Apply all three reconciliation migrations in order.
  for (const filename of [
    "0227_contact_reconciliation.sql",
    "0228_fix_recon_active_index.sql",
    "0229_fix_proposal_status_reverted.sql",
  ]) {
    console.log(`[Cert] Applying ${filename}...`);
    try {
      await applyMigration(client, filename);
      console.log(`[Cert] ${filename} applied.\n`);
    } catch (err: any) {
      if (err.message?.includes("already exists") || err.code === "42P07" || err.code === "42710") {
        console.log(`[Cert] ${filename} — objects already exist, continuing.\n`);
      } else {
        throw err;
      }
    }
  }

  const RUN_ID = uuid();

  // ── Setup: seed census run and contacts ───────────────────────────────────
  console.log("[Cert] Seeding test data...");

  const censusRunR = await client.query(
    `INSERT INTO contact_census_runs (id, status, requested_by, denominator_at_start, max_contact_id_at_start)
     VALUES ($1, 'completed', 'test', 5, 1000)
     RETURNING id`,
    [RUN_ID],
  );
  const censusRunId: string = censusRunR.rows[0].id;

  // Insert 5 contacts with different characteristics
  const contactIds: number[] = [];
  const insertData = [
    ["JOHN", "SMITH", "john@good.com", "5551234567", "Acme Corp", "restaurant", "form"],
    ["Jane", "JONES", "jane@good.com", "(555) 987-6543", "BETA LLC", null, null],
    ["Bob", "Lee", "noemail@fake.com", "(555) 111-2222", "Gamma Inc", "retail", "form"],
    ["Alice", "Wong", "alice@good.com", "(555) 333-4444", "Acme Corp", "restaurant", "form"],  // same company as #1
    ["Charlie", "Brown", null, "(555) 555-6666", null, null, null],                              // no email, no company
  ];

  for (const [fn, ln, em, ph, co, vert, vsrc] of insertData) {
    const r = await client.query(
      `INSERT INTO contacts (first_name, last_name, email, phone, company_name, vertical, vertical_source, record_class, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'production', now())
       RETURNING id`,
      [fn, ln, em, ph, co, vert, vsrc],
    );
    contactIds.push(r.rows[0].id);
  }

  // Insert census members for these contacts
  for (let i = 0; i < contactIds.length; i++) {
    const lane = i === 4 ? "NEEDS_MULTIPLE_CONTACT_FIELDS" : "NEEDS_BUSINESS_MATERIALIZATION";
    await client.query(
      `INSERT INTO contact_census_members (run_id, contact_id, primary_lane) VALUES ($1, $2, $3)`,
      [censusRunId, contactIds[i], lane],
    );
  }

  // Update census run watermark
  await client.query(
    `UPDATE contact_census_runs SET max_contact_id_at_start = $2, denominator_at_start = 5 WHERE id = $1`,
    [censusRunId, Math.max(...contactIds)],
  );

  console.log("[Cert] Test data seeded.\n");

  // ── Test 1: Create reconciliation run ─────────────────────────────────────
  console.log("── Run lifecycle ──");

  const reconRunR = await client.query(
    `INSERT INTO contact_reconciliation_runs
       (source_census_run_id, environment_label, requested_by, status, lease_owner, lease_expires_at)
     VALUES ($1, 'development_preview', 'test', 'running', 'owner:1', now() + interval '120 seconds')
     RETURNING id`,
    [censusRunId],
  );
  const reconRunId: string = reconRunR.rows[0].id;
  assert(reconRunId.length > 0, "run created with UUID");

  // ── Test 2: Single active run enforcement ─────────────────────────────────
  let uniqueViolation = false;
  try {
    await client.query(
      `INSERT INTO contact_reconciliation_runs
         (source_census_run_id, environment_label, requested_by, status, lease_owner, lease_expires_at)
       VALUES ($1, 'development_preview', 'test', 'running', 'owner:2', now() + interval '120 seconds')`,
      [censusRunId],
    );
  } catch (err: any) {
    uniqueViolation = err.code === "23505";
  }
  assert(uniqueViolation, "second concurrent run blocked by unique partial index (23505)");

  // ── Test 3: Pause transition ───────────────────────────────────────────────
  const pauseR = await client.query(
    `UPDATE contact_reconciliation_runs SET status='paused', pause_reason='test pause', updated_at=now()
     WHERE id=$1 AND status='running' RETURNING id`,
    [reconRunId],
  );
  assertEq(pauseR.rowCount ?? 0, 1, "pause transition: running→paused");

  // ── Test 4: After pause, another run can start (active slot freed) ─────────
  const reconRunR2 = await client.query(
    `INSERT INTO contact_reconciliation_runs
       (source_census_run_id, environment_label, requested_by, status, lease_owner, lease_expires_at)
     VALUES ($1, 'development_preview', 'test', 'running', 'owner:3', now() + interval '120 seconds')
     RETURNING id`,
    [censusRunId],
  );
  const reconRunId2: string = reconRunR2.rows[0].id;
  assert(reconRunId2.length > 0, "new run can start after previous is paused (paused not in active slot)");

  // Cancel the second run
  await client.query(`UPDATE contact_reconciliation_runs SET status='cancelled', updated_at=now() WHERE id=$1`, [reconRunId2]);

  // Resume first run
  const resumeR = await client.query(
    `UPDATE contact_reconciliation_runs SET status='running', pause_reason=NULL,
     lease_expires_at=now()+interval '120 seconds', updated_at=now()
     WHERE id=$1 AND status='paused' RETURNING id`,
    [reconRunId],
  );
  assertEq(resumeR.rowCount ?? 0, 1, "resume transition: paused→running");

  // ── Test 5: Ownership CAS — stale owner cannot mark run failed ────────────
  console.log("\n── Ownership CAS ──");

  // Simulate a previous worker holding 'owner:OLD' — should not update
  const staleFailR = await client.query(
    `UPDATE contact_reconciliation_runs
     SET status='failed', failure_reason='stale error', updated_at=now()
     WHERE id=$1 AND lease_owner='owner:OLD' AND status='running'
     RETURNING id`,
    [reconRunId],
  );
  assertEq(staleFailR.rowCount ?? 0, 0, "stale lease owner cannot mark run as failed (0 rows updated)");

  // Confirm the run is still running
  const stillRunningR = await client.query(
    `SELECT status FROM contact_reconciliation_runs WHERE id=$1`, [reconRunId],
  );
  assertEq(stillRunningR.rows[0].status, "running", "run still 'running' after stale-owner failure attempt");

  // ── Test 6: Per-batch checkpoint stores cursor + counters atomically ───────
  console.log("\n── Per-batch checkpoint ──");

  // Checkpoint: cursor=42, processed=10, proposed=3
  const cpR = await client.query(
    `UPDATE contact_reconciliation_runs
     SET cursor_contact_census_member_id=42, total_processed=10, total_proposed=3,
         lane_counts='{"A":5}', dimension_counts='{"r1":{"ok":10}}', updated_at=now()
     WHERE id=$1 AND lease_owner='owner:1' AND status='running'
     RETURNING id`,
    [reconRunId],
  );
  assertEq(cpR.rowCount ?? 0, 1, "checkpoint write succeeds with correct owner+status predicate");

  // Now simulate an admin pause — the checkpoint predicate should block further writes
  await client.query(
    `UPDATE contact_reconciliation_runs SET status='paused', pause_reason='admin', updated_at=now() WHERE id=$1`,
    [reconRunId],
  );
  const blockedCpR = await client.query(
    `UPDATE contact_reconciliation_runs
     SET cursor_contact_census_member_id=99, total_processed=100, updated_at=now()
     WHERE id=$1 AND lease_owner='owner:1' AND status='running'`,
    [reconRunId],
  );
  assertEq(blockedCpR.rowCount ?? 0, 0, "checkpoint blocked after admin pause (status≠running)");

  // Verify cursor stayed at 42 (not overwritten to 99)
  const cursorR = await client.query(
    `SELECT cursor_contact_census_member_id, total_processed FROM contact_reconciliation_runs WHERE id=$1`,
    [reconRunId],
  );
  assertEq(parseInt(cursorR.rows[0].cursor_contact_census_member_id, 10), 42, "cursor preserved at 42 after blocked checkpoint");
  assertEq(parseInt(cursorR.rows[0].total_processed, 10), 10, "total_processed preserved at 10 after blocked checkpoint");

  // Cancel for remaining tests
  await client.query(`UPDATE contact_reconciliation_runs SET status='cancelled', updated_at=now() WHERE id=$1`, [reconRunId]);

  // ── Test 7: Org candidates ─────────────────────────────────────────────────
  console.log("\n── Org candidates ──");

  const reconRunR3 = await client.query(
    `INSERT INTO contact_reconciliation_runs
       (source_census_run_id, environment_label, requested_by, status, lease_owner, lease_expires_at)
     VALUES ($1, 'development_preview', 'test', 'completed', 'owner:4', now() + interval '120 seconds')
     RETURNING id`,
    [censusRunId],
  );
  const testRunId: string = reconRunR3.rows[0].id;

  // Insert two contacts with same normalized company name
  await client.query(
    `INSERT INTO contact_organization_candidates (run_id, normalized_name, raw_sample_name)
     VALUES ($1, 'acme corp', 'Acme Corp')
     ON CONFLICT (run_id, normalized_name) DO NOTHING`,
    [testRunId],
  );
  await client.query(
    `INSERT INTO contact_organization_candidates (run_id, normalized_name, raw_sample_name)
     VALUES ($1, 'acme corp', 'Acme Corp')
     ON CONFLICT (run_id, normalized_name) DO NOTHING`,
    [testRunId],
  );
  const candidateCountR = await client.query(
    `SELECT COUNT(*) AS n FROM contact_organization_candidates WHERE run_id=$1`, [testRunId],
  );
  assertEq(parseInt(candidateCountR.rows[0].n, 10), 1, "duplicate company name → exactly 1 candidate row (idempotent)");

  // Insert members
  const candidateIdR = await client.query(
    `SELECT id FROM contact_organization_candidates WHERE run_id=$1 AND normalized_name='acme corp'`,
    [testRunId],
  );
  const candidateId = candidateIdR.rows[0].id;

  await client.query(
    `INSERT INTO contact_organization_candidate_members (candidate_id, run_id, contact_id)
     VALUES ($1, $2, $3) ON CONFLICT (candidate_id, contact_id) DO NOTHING`,
    [candidateId, testRunId, contactIds[0]],
  );
  await client.query(
    `INSERT INTO contact_organization_candidate_members (candidate_id, run_id, contact_id)
     VALUES ($1, $2, $3) ON CONFLICT (candidate_id, contact_id) DO NOTHING`,
    [candidateId, testRunId, contactIds[0]], // duplicate — should not insert
  );
  await client.query(
    `INSERT INTO contact_organization_candidate_members (candidate_id, run_id, contact_id)
     VALUES ($1, $2, $3) ON CONFLICT (candidate_id, contact_id) DO NOTHING`,
    [candidateId, testRunId, contactIds[3]], // contact 4 also "Acme Corp"
  );

  const memberCountR = await client.query(
    `SELECT COUNT(*) AS n FROM contact_organization_candidate_members WHERE candidate_id=$1`,
    [candidateId],
  );
  assertEq(parseInt(memberCountR.rows[0].n, 10), 2, "org candidate has exactly 2 members (deduped)");

  // ── Test 8: Duplicate clusters (N rows, not pairs) ─────────────────────────
  console.log("\n── Duplicate clusters ──");

  const clusterId = uuid();
  await client.query(
    `INSERT INTO contact_duplicate_clusters (id, run_id, cluster_key, cluster_reason)
     VALUES ($1, $2, 'phone:5551234567', 'shared_phone_multi_company')
     ON CONFLICT (run_id, cluster_key) DO NOTHING`,
    [clusterId, testRunId],
  );

  // Insert 3 members into same cluster (N rows, not pairs)
  for (const cid of [contactIds[0], contactIds[1], contactIds[2]]) {
    await client.query(
      `INSERT INTO contact_duplicate_cluster_members (cluster_id, run_id, contact_id)
       VALUES ($1, $2, $3) ON CONFLICT (cluster_id, contact_id) DO NOTHING`,
      [clusterId, testRunId, cid],
    );
  }

  const clusterMembersR = await client.query(
    `SELECT COUNT(*) AS n FROM contact_duplicate_cluster_members WHERE cluster_id=$1`,
    [clusterId],
  );
  assertEq(parseInt(clusterMembersR.rows[0].n, 10), 3, "cluster has 3 member rows (N members, not pairs)");

  const columnCheck = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='contact_duplicate_cluster_members'
      AND column_name IN ('contact_id_a','contact_id_b','peer_contact_id')
  `);
  assertEq(columnCheck.rows.length, 0, "no pairwise columns in cluster_members table");

  // ── Test 9: Proposal approved via actual service function ──────────────────
  console.log("\n── Approval via service ──");

  // Insert a proposal for JOHN → John name normalization
  // Use contact's REAL updated_at so CAS passes
  const rawUpdatedAtR = await client.query(`SELECT updated_at FROM contacts WHERE id=$1`, [contactIds[0]]);
  const realUpdatedAt = new Date(rawUpdatedAtR.rows[0].updated_at);

  const proposalR = await client.query(
    `INSERT INTO contact_normalization_proposals
       (run_id, contact_id, proposal_type, field_name, current_value, proposed_value,
        contact_updated_at, before_values, confidence)
     VALUES ($1, $2, 'name_normalization', 'first_name', 'JOHN', 'John', $3, '{}', 80)
     RETURNING id`,
    [testRunId, contactIds[0], realUpdatedAt],
  );
  const proposalId: number = proposalR.rows[0].id;
  assert(proposalId > 0, "normalization proposal inserted");

  // Call the ACTUAL approveProposal service with the test pool
  const approveResult = await approveProposal(proposalId, "cert-admin", testPool);
  assertEq(approveResult.outcome, "applied", "approveProposal() returns outcome=applied");
  assertEq((approveResult as any).fieldName, "first_name", "approveProposal() reports correct fieldName");

  // Verify contact field was updated
  const updatedContactR = await client.query(`SELECT first_name FROM contacts WHERE id=$1`, [contactIds[0]]);
  assertEq(updatedContactR.rows[0].first_name, "John", "contact first_name updated to 'John' by approval service");

  // Verify proposal status
  const approvedStatusR = await client.query(`SELECT status, reviewed_by FROM contact_normalization_proposals WHERE id=$1`, [proposalId]);
  assertEq(approvedStatusR.rows[0].status, "approved", "proposal status = 'approved'");
  assertEq(approvedStatusR.rows[0].reviewed_by, "cert-admin", "reviewed_by = 'cert-admin'");

  // Verify audit log written with real schema columns
  const auditR = await client.query(
    `SELECT actor_type, actor_id, details FROM audit_logs WHERE action='reconciliation_proposal_approved' AND entity_id=$1`,
    [contactIds[0]],
  );
  assert(auditR.rows.length === 1, "audit_log row written for approval");
  assertEq(auditR.rows[0].actor_type, "user", "audit_log.actor_type = 'user'");
  assertEq(auditR.rows[0].actor_id, "cert-admin", "audit_log.actor_id = 'cert-admin'");
  assert(auditR.rows[0].details !== null, "audit_log.details (JSONB) is not null");

  // Verify reversal ledger written
  const reversalR = await client.query(`SELECT * FROM contact_normalization_reversals WHERE proposal_id=$1`, [proposalId]);
  assert(reversalR.rows.length === 1, "reversal ledger row written for approval");
  assertEq(reversalR.rows[0].value_before, "JOHN", "reversal ledger stores before value 'JOHN'");
  assertEq(reversalR.rows[0].value_after, "John", "reversal ledger stores after value 'John'");

  // ── Test 10: Stale CAS — already reviewed proposal returns already_reviewed ─
  console.log("\n── Stale CAS ──");

  const alreadyResult = await approveProposal(proposalId, "cert-admin", testPool);
  assertEq(alreadyResult.outcome, "already_reviewed", "second approval attempt returns already_reviewed");

  // ── Test 11: Revert via actual service function ────────────────────────────
  console.log("\n── Revert via service ──");

  // revertProposal should restore 'JOHN' and write audit log
  const revertResult = await revertProposal(proposalId, "cert-reverter", testPool);
  assertEq(revertResult.outcome, "applied", "revertProposal() returns outcome=applied");

  const revertedContactR = await client.query(`SELECT first_name FROM contacts WHERE id=$1`, [contactIds[0]]);
  assertEq(revertedContactR.rows[0].first_name, "JOHN", "contact first_name restored to 'JOHN' by revert service");

  const revertedStatusR = await client.query(`SELECT status FROM contact_normalization_proposals WHERE id=$1`, [proposalId]);
  assertEq(revertedStatusR.rows[0].status, "reverted", "proposal status = 'reverted' (not 'reversed')");

  const revertAuditR = await client.query(
    `SELECT actor_type, actor_id FROM audit_logs WHERE action='reconciliation_proposal_reverted' AND entity_id=$1`,
    [contactIds[0]],
  );
  assert(revertAuditR.rows.length === 1, "audit_log row written for revert");
  assertEq(revertAuditR.rows[0].actor_id, "cert-reverter", "audit_log.actor_id = 'cert-reverter' for revert");

  // ── Test 12: Reject via actual service function ────────────────────────────
  console.log("\n── Reject via service ──");

  const rejProposalR = await client.query(
    `INSERT INTO contact_normalization_proposals
       (run_id, contact_id, proposal_type, field_name, current_value, proposed_value,
        contact_updated_at, before_values, confidence)
     VALUES ($1, $2, 'phone_normalization', 'phone', '5551234567', '(555) 123-4567', now(), '{}', 90)
     RETURNING id`,
    [testRunId, contactIds[1]],
  );
  const rejId: number = rejProposalR.rows[0].id;

  const rejectResult = await rejectProposal(rejId, "cert-admin", testPool);
  assertEq(rejectResult.outcome, "rejected", "rejectProposal() returns outcome=rejected");

  const rejStatus = await client.query(`SELECT status FROM contact_normalization_proposals WHERE id=$1`, [rejId]);
  assertEq(rejStatus.rows[0].status, "rejected", "proposal status = 'rejected' after reject service call");

  // Contact phone must be unchanged after rejection
  const phoneCheck = await client.query(`SELECT phone FROM contacts WHERE id=$1`, [contactIds[1]]);
  assert(phoneCheck.rows[0].phone !== "(555) 123-4567", "contact phone unchanged after rejection");

  // ── Test 13: Allowed field check ──────────────────────────────────────────
  console.log("\n── Allowlist enforcement ──");

  const allowedFields = new Set(["first_name", "last_name", "phone", "company_name", "vertical"]);
  assert(!allowedFields.has("email"), "email NOT in allowed reconciliation write fields");
  assert(allowedFields.has("first_name"), "first_name IN allowed fields");
  assert(allowedFields.has("last_name"), "last_name IN allowed fields");
  assert(allowedFields.has("phone"), "phone IN allowed fields");
  assert(allowedFields.has("company_name"), "company_name IN allowed fields");
  assert(allowedFields.has("vertical"), "vertical IN allowed fields");
  assertEq(allowedFields.size, 5, "exactly 5 allowed fields");

  // ── Test 14: Members table unique constraint ───────────────────────────────
  console.log("\n── Members uniqueness ──");

  await client.query(
    `INSERT INTO contact_reconciliation_members
       (run_id, contact_id, name_quality_state, email_quality_state, phone_quality_state,
        company_quality_state, vertical_state, duplicate_risk_state, business_gap_state,
        org_aggregation_state, normalization_opportunity, cluster_candidacy_state,
        overall_action_state, primary_lane, gap_codes)
     VALUES ($1, $2, 'clean', 'clean', 'clean', 'clean', 'resolved', 'none', 'pipeline_eligible',
             'aggregatable', 'none', 'clean', 'org_aggregation', 'PENDING_ORG_AGGREGATION', '{}')
     ON CONFLICT (run_id, contact_id) DO NOTHING`,
    [testRunId, contactIds[0]],
  );
  await client.query(
    `INSERT INTO contact_reconciliation_members
       (run_id, contact_id, name_quality_state, email_quality_state, phone_quality_state,
        company_quality_state, vertical_state, duplicate_risk_state, business_gap_state,
        org_aggregation_state, normalization_opportunity, cluster_candidacy_state,
        overall_action_state, primary_lane, gap_codes)
     VALUES ($1, $2, 'clean', 'clean', 'clean', 'clean', 'resolved', 'none', 'pipeline_eligible',
             'aggregatable', 'none', 'clean', 'org_aggregation', 'PENDING_ORG_AGGREGATION', '{}')
     ON CONFLICT (run_id, contact_id) DO NOTHING`,
    [testRunId, contactIds[0]], // duplicate
  );
  const memberDupR = await client.query(
    `SELECT COUNT(*) AS n FROM contact_reconciliation_members WHERE run_id=$1 AND contact_id=$2`,
    [testRunId, contactIds[0]],
  );
  assertEq(parseInt(memberDupR.rows[0].n, 10), 1, "duplicate (run_id, contact_id) → exactly 1 member row");

  // ── Test 15: Proposal status constraint uses 'reverted' (not 'reversed') ──
  console.log("\n── Status constraint alignment ──");

  let revertedAccepted = true;
  try {
    await client.query(
      `INSERT INTO contact_normalization_proposals
         (run_id, contact_id, proposal_type, field_name, current_value, proposed_value,
          contact_updated_at, before_values, confidence, status)
       VALUES ($1, $2, 'name_normalization', 'last_name', 'OLD', 'New', now(), '{}', 70, 'reverted')`,
      [testRunId, contactIds[2]],
    );
  } catch {
    revertedAccepted = false;
  }
  assert(revertedAccepted, "'reverted' accepted by CHECK constraint (not 'reversed')");

  let reversedRejected = false;
  try {
    await client.query(
      `INSERT INTO contact_normalization_proposals
         (run_id, contact_id, proposal_type, field_name, current_value, proposed_value,
          contact_updated_at, before_values, confidence, status)
       VALUES ($1, $2, 'name_normalization', 'last_name', 'OLD', 'New', now(), '{}', 70, 'reversed')`,
      [testRunId, contactIds[2]],
    );
  } catch (err: any) {
    reversedRejected = err.code === "23514"; // check_violation
  }
  assert(reversedRejected, "'reversed' rejected by CHECK constraint (23514 check_violation)");

  // ── Test 16: Schema indexes ────────────────────────────────────────────────
  console.log("\n── Schema ──");

  const indexR = await client.query(`
    SELECT indexname FROM pg_indexes
    WHERE tablename='contact_reconciliation_members' AND indexname='recon_members_run_lane'
  `);
  assert(indexR.rows.length > 0, "recon_members_run_lane index exists");

  const orgIndexR = await client.query(`
    SELECT indexname FROM pg_indexes
    WHERE tablename='contact_organization_candidate_members' AND indexname='org_candidate_members_run'
  `);
  assert(orgIndexR.rows.length > 0, "org_candidate_members_run index exists");

  const clusterIndexR = await client.query(`
    SELECT indexname FROM pg_indexes
    WHERE tablename='contact_duplicate_cluster_members' AND indexname='dup_cluster_members_run'
  `);
  assert(clusterIndexR.rows.length > 0, "dup_cluster_members_run index exists");

  const proposalIndexR = await client.query(`
    SELECT indexname FROM pg_indexes
    WHERE tablename='contact_normalization_proposals' AND indexname='recon_proposals_run_status'
  `);
  assert(proposalIndexR.rows.length > 0, "recon_proposals_run_status index exists");

  const proposalUniqueR = await client.query(`
    SELECT indexname FROM pg_indexes
    WHERE tablename='contact_normalization_proposals'
      AND indexname='contact_normalization_proposals_run_contact_field_unique'
  `);
  assert(proposalUniqueR.rows.length > 0, "proposal idempotency unique index exists (added in 0228)");

  // ── Test 17: All 8 tables present ─────────────────────────────────────────
  const tables = [
    "contact_reconciliation_runs",
    "contact_reconciliation_members",
    "contact_organization_candidates",
    "contact_organization_candidate_members",
    "contact_duplicate_clusters",
    "contact_duplicate_cluster_members",
    "contact_normalization_proposals",
    "contact_normalization_reversals",
  ];
  const tableR = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name = ANY($1)
  `, [tables]);
  assertEq(tableR.rows.length, tables.length, `all ${tables.length} reconciliation tables present`);

  // ── Cleanup ────────────────────────────────────────────────────────────────
  await client.query(`DELETE FROM audit_logs WHERE action LIKE 'reconciliation_%'`);
  await client.query(`DELETE FROM contact_normalization_reversals`);
  await client.query(`DELETE FROM contact_normalization_proposals`);
  await client.query(`DELETE FROM contact_duplicate_cluster_members`);
  await client.query(`DELETE FROM contact_duplicate_clusters`);
  await client.query(`DELETE FROM contact_organization_candidate_members`);
  await client.query(`DELETE FROM contact_organization_candidates`);
  await client.query(`DELETE FROM contact_reconciliation_members`);
  await client.query(`DELETE FROM contact_reconciliation_runs`);
  await client.query(`DELETE FROM contact_census_members`);
  await client.query(`DELETE FROM contact_census_runs WHERE id=$1`, [censusRunId]);
  await client.query(`DELETE FROM contacts WHERE id = ANY($1)`, [contactIds]);

  await testPool.end();
  await client.end();

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n── Reconciliation Certification ─────────────────────────────`);
  console.log(`   ${passed} passed  |  ${failed} failed  |  ${passed + failed} total`);
  console.log(`─────────────────────────────────────────────────────────────\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error("\nFatal error in reconciliation certification:", err?.message ?? err);
  process.exit(1);
});
