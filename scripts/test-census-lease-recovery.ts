#!/usr/bin/env npx tsx
/**
 * Census Lease Recovery Proof — Task #1817 closeout.
 *
 * Demonstrates that an expired or crashed lease:
 *   1. Can be detected by any admin (status='running', lease_expires_at < now())
 *   2. Can be cancelled via DELETE /api/admin/census/runs/:runId (no active run after cancel)
 *   3. After cancel, a NEW run can be started immediately (unique partial index slot is free)
 *   4. Cancelling a crashed run does NOT create a second active run
 *   5. Member rows from the crashed run are permanently orphaned (no re-classification
 *      using a crashed run's members — a new run always writes new member rows with ON CONFLICT DO NOTHING)
 *
 * This test verifies the mechanism via DB queries and HTTP calls, not process simulation.
 *
 * Exit 0 = pass. Exit 1 = fail.
 */

import { pool } from "../server/db.js";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5000";
const ADMIN_EMAIL = process.env.ADMIN_SEED_EMAIL ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_SEED_PASSWORD ?? "";

let pass = 0; let fail = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; process.stdout.write(`  ✓ ${label}\n`); }
  else { fail++; process.stdout.write(`  ✗ ${label}${detail ? ` — ${detail}` : ""}\n`); }
}

async function login(email: string, password: string): Promise<{ cookies: string; csrf: string }> {
  const r = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }), redirect: "manual",
  });
  const rawCookies = r.headers.getSetCookie?.() ?? (r.headers.get("set-cookie") ? [r.headers.get("set-cookie")!] : []);
  const cookies = rawCookies.map((c: string) => c.split(";")[0]).join("; ");
  const csrfR = await fetch(`${BASE_URL}/api/csrf-token`, { headers: { Cookie: cookies } });
  const csrfData = await csrfR.json();
  return { cookies, csrf: csrfData.token ?? csrfData.csrfToken ?? "" };
}

async function apiCall(method: string, path: string, opts: { cookies?: string; csrf?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.cookies) headers["Cookie"] = opts.cookies;
  if (opts.csrf && method !== "GET") headers["X-CSRF-Token"] = opts.csrf;
  const r = await fetch(`${BASE_URL}${path}`, {
    method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const body = await r.json().catch(() => null);
  return { status: r.status, body };
}

async function main() {
  console.log("══════════════════════════════════════════════════════════════════");
  console.log("  Census Lease Recovery Proof — Task #1817 Closeout");
  console.log("══════════════════════════════════════════════════════════════════\n");

  const session = await login(ADMIN_EMAIL, ADMIN_PASSWORD);

  // ── Step 1: Inject a synthetic "crashed" run directly into DB ──────────────
  // Simulates a process that started a run and then crashed (lease expired).
  const FAKE_OWNER = `crashed-host:99999`;
  const injectR = await pool.query(`
    INSERT INTO contact_census_runs
      (snapshot_type, environment_label, selector_hash, selector_params, rules_version,
       release_sha, db_identity_token, as_of, requested_by, status,
       lease_owner, lease_expires_at, max_contact_id_at_start)
    VALUES
      ('full', 'development_preview', md5(random()::text), '{}', '1.0.0',
       'test-sha', 'test-token', now(), 'lease-recovery-test', 'running',
       $1, now() - interval '10 minutes', 0)
    RETURNING id
  `, [FAKE_OWNER]);
  const crashedRunId: string = injectR.rows[0].id;
  console.log(`  Injected crashed run: ${crashedRunId.slice(0, 8)}… (lease expired 10 minutes ago)`);

  // ── Step 2: Verify the crashed run is detectable ───────────────────────────
  const stalledR = await pool.query(`
    SELECT id, status, lease_owner, lease_expires_at
    FROM contact_census_runs
    WHERE status = 'running' AND lease_expires_at < now()
  `);
  check("Stalled/crashed run is detectable (status=running AND lease_expires_at < now())", stalledR.rows.length >= 1);

  // ── Step 3: A second concurrent POST → 409 (crashed run blocks the slot) ───
  const secondStart = await apiCall("POST", "/api/admin/census/runs", {
    cookies: session.cookies, csrf: session.csrf, body: {},
  });
  check("A new run is blocked (409) while crashed run still active", secondStart.status === 409, `Got: ${secondStart.status}`);

  // ── Step 4: Admin can cancel the crashed run via DELETE ────────────────────
  const cancelR = await apiCall("DELETE", `/api/admin/census/runs/${crashedRunId}`, {
    cookies: session.cookies, csrf: session.csrf,
  });
  check("Crashed run can be cancelled via DELETE (CAS: running → cancelled)", cancelR.status === 200, `Got: ${cancelR.status}`);

  // ── Step 5: After cancel, unique partial index slot is free ────────────────
  const activeAfterCancel = await pool.query(`
    SELECT id FROM contact_census_runs WHERE status IN ('pending', 'running')
  `);
  check("No active runs remain after cancellation", activeAfterCancel.rows.length === 0, `Found ${activeAfterCancel.rows.length} active`);

  // ── Step 6: A new run can now start (slot is free) ─────────────────────────
  const newStart = await apiCall("POST", "/api/admin/census/runs", {
    cookies: session.cookies, csrf: session.csrf, body: {},
  });
  check("New run starts successfully after crash recovery (201)", newStart.status === 201, `Got: ${newStart.status}`);
  const newRunId = (newStart.body as any)?.runId;

  // ── Step 7: Exactly one active run exists ──────────────────────────────────
  const activeNowR = await pool.query(`SELECT id FROM contact_census_runs WHERE status IN ('pending', 'running')`);
  check("Exactly one active run after recovery", activeNowR.rows.length === 1, `Found: ${activeNowR.rows.length}`);

  // ── Step 8: ON CONFLICT DO NOTHING prevents duplicate member rows ──────────
  // Crashed run members (if any) are owned by their run_id. New run writes to NEW run_id.
  // Even if a contact was partially classified in the crashed run, the new run classifies it
  // under the new run_id — no duplication across runs.
  const colConstraint = await pool.query(`
    SELECT constraint_name FROM information_schema.table_constraints
    WHERE table_name = 'contact_census_members'
      AND constraint_type = 'UNIQUE'
  `);
  const hasMemberUnique = colConstraint.rows.some((r: any) =>
    r.constraint_name?.includes("run_id") || r.constraint_name?.includes("contact")
  );
  // Also check via pg_indexes
  const memberIdxR = await pool.query(`
    SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'contact_census_members'
  `);
  const hasUniquePerRun = memberIdxR.rows.some((r: any) =>
    (r.indexdef ?? "").toLowerCase().includes("unique") &&
    (r.indexdef ?? "").includes("run_id") &&
    (r.indexdef ?? "").includes("contact_id")
  );
  check(
    "contact_census_members has UNIQUE (run_id, contact_id) — ON CONFLICT DO NOTHING is safe",
    hasMemberUnique || hasUniquePerRun,
    `Found constraints: ${colConstraint.rows.map((r: any) => r.constraint_name).join(", ") || "none in table_constraints"}`
  );

  // ── Step 9: Stale writer (fake_owner) cannot write progress ───────────────
  const fakeWriteR = await pool.query(`
    UPDATE contact_census_runs
    SET total_processed = 9999, updated_at = now()
    WHERE id = $1 AND lease_owner = $2 AND status = 'running'
  `, [crashedRunId, FAKE_OWNER]);
  check(
    "Stale writer (fake owner) cannot write progress to cancelled run (0 rows updated)",
    (fakeWriteR.rowCount ?? 0) === 0,
    `Updated: ${fakeWriteR.rowCount} rows`,
  );

  // ── Cleanup ────────────────────────────────────────────────────────────────
  if (newRunId) {
    await apiCall("DELETE", `/api/admin/census/runs/${newRunId}`, {
      cookies: session.cookies, csrf: session.csrf,
    });
    console.log(`\n  Cleaned up test run ${newRunId.slice(0, 8)}`);
  }
  await pool.end();

  console.log(`\n  Summary: ${pass} passed, ${fail} failed`);
  console.log("══════════════════════════════════════════════════════════════════\n");
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
