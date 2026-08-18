#!/usr/bin/env tsx
/**
 * Task #1609 — Serper admin panel, circuit alerts & invalid-contact surface.
 *
 * Isolation guarantees (kill lines):
 *  - All gateway mutations run against a throwaway schema `serper_test_1609`
 *    (cloned table structures) via poolOverride + dbOverride. The shared
 *    public.serper_control row and public cooldown keys are NEVER written.
 *  - SMTP is faked via sendEmailOverride — no real email is ever sent.
 *  - HTTP tests only issue non-mutating requests (401/403/400 rejections and
 *    read-only GETs).
 *
 * Requires the dev server running on BASE_URL (default http://localhost:5000)
 * and ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD for the admin-session tests.
 */

import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { SerperGateway } from "../server/services/serper-gateway";
import { db, pool as sharedPool } from "../server/db";
import { listInvalidGhlContacts } from "../server/services/ghl-invalid-contacts";
import { requireRole } from "../server/replit_integrations/auth/replitAuth";

const { Pool } = pg;
const BASE_URL = process.env.BASE_URL ?? "http://localhost:5000";
const SCHEMA = "serper_test_1609";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Drizzle tx.execute returns timestamptz as strings; pg pool returns Dates — normalize.
const ts = (v: any) => (v == null ? null : new Date(v).getTime());

// ── Fake SMTP recorder ─────────────────────────────────────────────────────
const sentEmails: { to: string; subject: string; category: string }[] = [];
let emailShouldThrow = false;
let emailShouldFailSoft = false; // sendSmtpEmail contract: { success: false } without throwing
async function fakeSendEmail(p: { to: string; subject: string; html: string; category: string }) {
  if (emailShouldThrow) throw new Error("simulated SMTP outage");
  if (emailShouldFailSoft) return { success: false, error: "SMTP not configured" };
  sentEmails.push({ to: p.to, subject: p.subject, category: p.category });
  return { success: true };
}

async function main() {
  // ── Snapshot shared state (kill-line #14 verification) ──────────────────
  const sharedBefore = await sharedPool.query(`SELECT * FROM serper_control WHERE id = 1`);
  const cooldownBefore = await sharedPool.query(
    `SELECT key, value, updated_at FROM system_settings WHERE key IN ('serper_circuit_open_alert_at','serper_circuit_recovery_alert_at') ORDER BY key`,
  );

  // ── Build isolated schema ────────────────────────────────────────────────
  await sharedPool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await sharedPool.query(`CREATE SCHEMA ${SCHEMA}`);
  await sharedPool.query(`CREATE TABLE ${SCHEMA}.serper_control (LIKE public.serper_control INCLUDING ALL)`);
  await sharedPool.query(`CREATE TABLE ${SCHEMA}.audit_logs (LIKE public.audit_logs INCLUDING ALL)`);
  await sharedPool.query(`CREATE TABLE ${SCHEMA}.system_settings (LIKE public.system_settings INCLUDING ALL)`);
  await sharedPool.query(`CREATE TABLE ${SCHEMA}.contacts (LIKE public.contacts INCLUDING DEFAULTS INCLUDING IDENTITY)`);
  await sharedPool.query(`INSERT INTO ${SCHEMA}.serper_control SELECT * FROM public.serper_control WHERE id = 1`);

  // search_path is set via connection startup options — applied synchronously
  // BEFORE any query can run on a new connection (no on-connect race).
  const testPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    options: `-c search_path=${SCHEMA}`,
  });
  const spCheck = await testPool.query(`SHOW search_path`);
  if (!String(spCheck.rows[0].search_path).includes(SCHEMA)) {
    throw new Error(`search_path not applied: ${spCheck.rows[0].search_path}`);
  }
  const testDb = drizzle(testPool) as unknown as typeof db;

  const gateway = new SerperGateway({
    poolOverride: testPool,
    dbOverride: testDb,
    sendEmailOverride: fakeSendEmail,
    failureThreshold: 2,
    fetchOverride: async () => new Response("{}", { status: 200 }),
  });

  const readControl = async () => (await testPool.query(`SELECT * FROM serper_control WHERE id = 1`)).rows[0];
  const setControl = async (setSql: string) =>
    testPool.query(`UPDATE serper_control SET ${setSql}, updated_at = now() WHERE id = 1`);
  const auditCount = async (action: string) =>
    parseInt((await testPool.query(`SELECT COUNT(*) AS n FROM audit_logs WHERE action = $1`, [action])).rows[0].n, 10);
  const clearCooldowns = async () =>
    testPool.query(`DELETE FROM system_settings WHERE key LIKE 'serper_circuit_%'`);

  try {
    // ═══ Test 4: enable with open circuit — circuit stays open, audit committed ═══
    console.log("\n[4] setEnabled with open circuit");
    await setControl(`enabled = false, state = 'open', reason_code = 'auth_error', opened_at = now(), consecutive_failures = 7`);
    const beforeRow = await readControl();
    const row4 = await gateway.setEnabled(true, { actorId: "test-admin", reason: "test enable", correlationId: "t4" });
    check("returns committed row with enabled=true", row4.enabled === true);
    check("circuit stays open", row4.state === "open");
    check("consecutive_failures untouched", row4.consecutive_failures === 7);
    check("opened_at untouched", ts(row4.opened_at) === ts(beforeRow.opened_at));
    check("reason_code untouched", row4.reason_code === "auth_error");
    check("audit row committed", (await auditCount("serper_enabled_toggle")) === 1);

    // ═══ Test 5: audit failure → both rolled back ═══
    console.log("\n[5] setEnabled with failing audit insert → rollback");
    await testPool.query(
      `CREATE FUNCTION ${SCHEMA}.fail_insert() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'audit_fail_test'; END $$ LANGUAGE plpgsql`,
    );
    await testPool.query(
      `CREATE TRIGGER fail_audit BEFORE INSERT ON ${SCHEMA}.audit_logs FOR EACH ROW EXECUTE FUNCTION ${SCHEMA}.fail_insert()`,
    );
    let threw5 = false;
    try {
      await gateway.setEnabled(false, { actorId: "test-admin", reason: "should roll back", correlationId: "t5" });
    } catch { threw5 = true; }
    await testPool.query(`DROP TRIGGER fail_audit ON ${SCHEMA}.audit_logs`);
    await testPool.query(`DROP FUNCTION ${SCHEMA}.fail_insert()`);
    const row5 = await readControl();
    check("setEnabled threw on audit failure", threw5);
    check("enabled mutation rolled back (still true)", row5.enabled === true);
    check("no extra audit row", (await auditCount("serper_enabled_toggle")) === 1);

    // ═══ Test 6: window reset preserves lifetime totals + circuit state ═══
    console.log("\n[6] resetWindow preserves lifetime + circuit");
    await setControl(
      `window_calls = 50, window_successes = 40, window_failures = 10, ` +
      `lifetime_calls = 1000, lifetime_successes = 900, lifetime_failures = 100, ` +
      `yield_websites = 5, yield_emails = 6, yield_phones = 7, state = 'open'`,
    );
    const row6pre = await readControl();
    const row6 = await gateway.resetWindow(new Date(row6pre.window_started_at), {
      actorId: "test-admin", reason: "test reset", correlationId: "t6",
    });
    check("reset succeeded", row6 !== null);
    check("window counters zeroed", row6!.window_calls === 0 && row6!.window_successes === 0 && row6!.window_failures === 0);
    check("yields zeroed", Number(row6!.yield_websites) === 0 && Number(row6!.yield_emails) === 0 && Number(row6!.yield_phones) === 0);
    check("lifetime preserved", Number(row6!.lifetime_calls) === 1000 && Number(row6!.lifetime_successes) === 900 && Number(row6!.lifetime_failures) === 100);
    check("circuit state preserved (open)", row6!.state === "open");
    check("enabled preserved", row6!.enabled === true);
    check("window_ends_at preserved", ts(row6!.window_ends_at) === ts(row6pre.window_ends_at));
    check("local_budget preserved", row6!.local_budget === row6pre.local_budget);
    check("window_started_at advanced", new Date(row6!.window_started_at).getTime() > new Date(row6pre.window_started_at).getTime());
    check("reset audit row written", (await auditCount("serper_window_reset")) === 1);

    // ═══ Test 7: wrong expectedWindowStartedAt → null (route: 409) ═══
    console.log("\n[7] resetWindow concurrency guard");
    const row7 = await gateway.resetWindow(new Date("2000-01-01T00:00:00Z"), {
      actorId: "test-admin", reason: "stale guard", correlationId: "t7",
    });
    check("returns null on stale windowStartedAt", row7 === null);
    check("no audit row on guard failure", (await auditCount("serper_window_reset")) === 1);

    // ═══ Test 8: concurrent setEnabled ═══
    console.log("\n[8] concurrent setEnabled");
    const [a8, b8] = await Promise.all([
      gateway.setEnabled(true, { actorId: "test-admin", reason: "concurrent A", correlationId: "t8a" }),
      gateway.setEnabled(true, { actorId: "test-admin", reason: "concurrent B", correlationId: "t8b" }),
    ]);
    check("both concurrent enables succeed", a8.enabled === true && b8.enabled === true);
    check("exactly one audit row per request (3 total)", (await auditCount("serper_enabled_toggle")) === 3);

    // ═══ Test 9: circuit-open alert fires once, cooldown suppresses repeats ═══
    console.log("\n[9] circuit-open alert + cooldown");
    await clearCooldowns();
    sentEmails.length = 0;
    await setControl(`state = 'closed', consecutive_failures = 0, opened_at = NULL, reason_code = NULL`);
    // Two concurrent open-transitions racing for the cooldown claim.
    await Promise.all([
      (gateway as any).recordFailure("auth_error", true, false),
      (gateway as any).recordFailure("auth_error", true, false),
    ]);
    await sleep(500);
    check("exactly one open alert under concurrency", sentEmails.length === 1, `got ${sentEmails.length}`);
    check("alert uses internal_ops category", sentEmails[0]?.category === "internal_ops");
    check("alert subject mentions circuit", /circuit/i.test(sentEmails[0]?.subject ?? ""));
    // Reset to closed and re-open within the 1 h cooldown → suppressed.
    await setControl(`state = 'closed', consecutive_failures = 0`);
    await (gateway as any).recordFailure("auth_error", true, false);
    await sleep(400);
    check("second transition within 1h suppressed", sentEmails.length === 1, `got ${sentEmails.length}`);
    // Repeated failures while already open → no transition, no alert.
    await clearCooldowns();
    await (gateway as any).recordFailure("provider_5xx", false, false);
    await sleep(400);
    check("failure while already open does not alert", sentEmails.length === 1, `got ${sentEmails.length}`);

    // ═══ Test 10: recovery alert on half_open→closed, claimed once ═══
    console.log("\n[10] recovery alert");
    await clearCooldowns();
    sentEmails.length = 0;
    await setControl(`state = 'half_open', half_open_probe_claimed_at = now()`);
    await (gateway as any).recordSuccess(true);
    await sleep(400);
    check("recovery alert fired once", sentEmails.length === 1 && /RESOLVED/i.test(sentEmails[0].subject));
    check("circuit closed after recovery", (await readControl()).state === "closed");
    // Second half_open→closed within 15 min → suppressed.
    await setControl(`state = 'half_open'`);
    await (gateway as any).recordSuccess(true);
    await sleep(400);
    check("second recovery within 15min suppressed", sentEmails.length === 1, `got ${sentEmails.length}`);
    // Plain success while closed → no alert.
    await clearCooldowns();
    await (gateway as any).recordSuccess(false);
    await sleep(400);
    check("success while closed does not alert", sentEmails.length === 1, `got ${sentEmails.length}`);

    // ═══ Test 11: SMTP failure never throws from record paths ═══
    console.log("\n[11] alert delivery failure is swallowed");
    await clearCooldowns();
    emailShouldThrow = true;
    await setControl(`state = 'closed', consecutive_failures = 0`);
    let threw11 = false;
    try {
      await (gateway as any).recordFailure("auth_error", true, false);
      await sleep(400);
    } catch { threw11 = true; }
    check("recordFailure did not throw on SMTP failure", !threw11);
    check("circuit still transitioned to open", (await readControl()).state === "open");
    await setControl(`state = 'half_open'`);
    let threw11b = false;
    try {
      await (gateway as any).recordSuccess(true);
      await sleep(400);
    } catch { threw11b = true; }
    check("recordSuccess did not throw on SMTP failure", !threw11b);
    emailShouldThrow = false;

    // ═══ Test 11b: soft failure ({ success: false }, no throw) releases cooldown ═══
    // sendSmtpEmail reports SMTP-down/paused/not-configured as { success: false }
    // WITHOUT throwing — the cooldown claim must be released so the next
    // transition can retry instead of silently consuming the whole window.
    console.log("\n[11b] soft delivery failure releases cooldown");
    await clearCooldowns();
    sentEmails.length = 0;
    emailShouldFailSoft = true;
    await setControl(`state = 'closed', consecutive_failures = 0`);
    await (gateway as any).recordFailure("auth_error", true, false);
    await sleep(400);
    check("no email recorded on soft failure", sentEmails.length === 0, `got ${sentEmails.length}`);
    check("circuit still transitioned to open", (await readControl()).state === "open");
    emailShouldFailSoft = false;
    // Cooldown must have been released → an immediate second transition delivers.
    await setControl(`state = 'closed', consecutive_failures = 0`);
    await (gateway as any).recordFailure("auth_error", true, false);
    await sleep(400);
    check("cooldown released — retry delivers alert", sentEmails.length === 1, `got ${sentEmails.length}`);

    // ═══ Test 1b: role guard — non-admin roles get 403, admin passes ═══
    // Unit-tests the exact requireRole('admin') middleware used by every new
    // route (verified below via _requiredRoles introspection is not needed —
    // the anon-401 HTTP tests prove the middleware chain is attached).
    console.log("\n[1b] requireRole('admin') unit tests");
    const guard = requireRole("admin");
    const runGuard = async (user: any): Promise<number | "next"> => {
      let statusCode: number | "next" = "next";
      const req: any = { isAuthenticated: () => true, sessionID: undefined, user };
      const res: any = { status: (c: number) => { statusCode = c; return { json: () => {} }; } };
      let nexted = false;
      await (guard as any)(req, res, () => { nexted = true; });
      return nexted ? "next" : statusCode;
    };
    check("merchant role → 403", (await runGuard({ role: "merchant" })) === 403);
    check("agent role → 403", (await runGuard({ role: "agent" })) === 403);
    check("manager role → 403", (await runGuard({ role: "manager" })) === 403);
    check("admin role → passes", (await runGuard({ role: "admin" })) === "next");
    {
      let anonStatus: number | "next" = "next";
      const req: any = { isAuthenticated: () => false };
      const res: any = { status: (c: number) => { anonStatus = c; return { json: () => {} }; } };
      await (guard as any)(req, res, () => {});
      check("unauthenticated → 401", anonStatus === 401);
    }

    // ═══ HTTP tests (require dev server) ═══
    console.log("\n[HTTP] auth + validation tests");
    let serverUp = true;
    try { await fetch(BASE_URL, { signal: AbortSignal.timeout(4000) }); } catch { serverUp = false; }
    if (!serverUp) {
      check("dev server reachable", false, `cannot reach ${BASE_URL}`);
    } else {
      const routes: [string, string][] = [
        ["GET", "/api/admin/serper/control"],
        ["PATCH", "/api/admin/serper/enabled"],
        ["POST", "/api/admin/serper/reset-window"],
        ["POST", "/api/admin/serper/recovery"],
        ["GET", "/api/admin/ghl/invalid-contacts"],
      ];
      // Test 1a: anonymous → 401
      for (const [method, path] of routes) {
        const res = await fetch(`${BASE_URL}${path}`, { method });
        check(`anon ${method} ${path} → 401`, res.status === 401, `got ${res.status}`);
      }

      const login = async (email: string, password: string): Promise<string> => {
        const res = await fetch(`${BASE_URL}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        if (res.status !== 200) throw new Error(`login failed ${email}: ${res.status}`);
        const raw = (res.headers as any).getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""];
        return raw.map((c: string) => c.split(";")[0].trim()).filter(Boolean).join("; ");
      };
      // Admin session for validation + read-only tests
      if (!process.env.ADMIN_SEED_EMAIL || !process.env.ADMIN_SEED_PASSWORD) {
        check("admin credentials present", false, "ADMIN_SEED_EMAIL/PASSWORD not set");
      } else {
        const adminCookie = await login(process.env.ADMIN_SEED_EMAIL, process.env.ADMIN_SEED_PASSWORD);
        const csrfRes = await fetch(`${BASE_URL}/api/csrf-token`, { headers: { cookie: adminCookie } });
        const csrfToken = (await csrfRes.json()).token;
        const csrfRaw = (csrfRes.headers as any).getSetCookie?.() ?? [csrfRes.headers.get("set-cookie") ?? ""];
        const csrfCookiePart = csrfRaw.map((c: string) => c.split(";")[0].trim()).find((c: string) => c.startsWith("csrf_token="));
        const fullCookie = csrfCookiePart ? `${adminCookie}; ${csrfCookiePart}` : adminCookie;
        const adminJson = (method: string, path: string, body: any) =>
          fetch(`${BASE_URL}${path}`, {
            method,
            headers: { cookie: fullCookie, "Content-Type": "application/json", "x-csrf-token": csrfToken },
            body: JSON.stringify(body),
          });

        // Test 2/3: validation rejections (never mutate)
        let r = await adminJson("PATCH", "/api/admin/serper/enabled", { enabled: true, reason: "   " });
        check("blank reason → 400", r.status === 400, `got ${r.status}`);
        r = await adminJson("PATCH", "/api/admin/serper/enabled", { reason: "valid reason" });
        check("missing enabled → 400", r.status === 400, `got ${r.status}`);
        r = await adminJson("PATCH", "/api/admin/serper/enabled", { enabled: "yes", reason: "valid reason" });
        check("non-boolean enabled → 400", r.status === 400, `got ${r.status}`);
        r = await adminJson("POST", "/api/admin/serper/reset-window", { reason: "" });
        check("reset-window blank reason → 400", r.status === 400, `got ${r.status}`);
        r = await adminJson("POST", "/api/admin/serper/reset-window", { reason: "ok", expectedWindowStartedAt: "not-a-date" });
        check("reset-window bad timestamp → 400", r.status === 400, `got ${r.status}`);

        // Read-only shape check of the live route (no mutations).
        const list = await fetch(`${BASE_URL}/api/admin/ghl/invalid-contacts?limit=5`, { headers: { cookie: adminCookie } });
        check("invalid-contacts GET → 200", list.status === 200, `got ${list.status}`);
        const body = await list.json();
        check("route response has { total, rows }", typeof body.total === "number" && Array.isArray(body.rows));
        check("route rows never leak details/phone", (body.rows as any[]).every((r) => !("details" in r) && !("phone" in r) && !("retryable" in r)));
      }
    }

    // ═══ Tests 12/13: invalid-contact dedup + resolved filter (ISOLATED) ═══
    // Runs the exact service function the route delegates to, against the
    // isolated schema — zero writes to public contacts/audit_logs.
    console.log("\n[12/13] invalid-contact surface (isolated schema)");
    {
      const insCid = async (email: string, phone: string): Promise<number> => {
        const r = await testPool.query(
          `INSERT INTO contacts (first_name, last_name, email, phone) VALUES ($1, $2, $3, $4) RETURNING id`,
          ["SerperTest", "InvalidContact1609", email, phone],
        );
        return r.rows[0].id;
      };
      const insAudit = (cid: number, ageMinutes: number) =>
        testPool.query(
          `INSERT INTO audit_logs (action, entity_type, entity_id, details, actor_type, created_at)
           VALUES ('ghl_sync_skipped_invalid_contact', 'contact', $1,
                   '{"reason":"GHL_NO_USABLE_IDENTITY","stage":"pre_send_validation","retryable":false}'::jsonb,
                   'system', now() - ($2 || ' minutes')::interval)`,
          [cid, ageMinutes],
        );

      const badCid = await insCid("not-an-email", "123");           // unresolved
      const goodCid = await insCid("fixed-contact@example.com", "5551234567"); // resolved
      await insAudit(badCid, 60);
      await insAudit(badCid, 5); // 2 occurrences, latest 5 min ago
      await insAudit(goodCid, 30);

      const unresolved = await listInvalidGhlContacts({ status: "unresolved", limit: 100, offset: 0 }, testPool as any);
      const mine = unresolved.rows.filter((x) => x.contactId === badCid);
      check("deduplicated to one row per contact", mine.length === 1, `got ${mine.length}`);
      check("occurrence count aggregated (2)", mine[0]?.occurrences === 2, `got ${mine[0]?.occurrences}`);
      check("status computed unresolved", mine[0]?.status === "unresolved");
      check("reasonCode/stage normalized", mine[0]?.reasonCode === "GHL_NO_USABLE_IDENTITY" && mine[0]?.stage === "pre_send_validation");
      check("no raw details leaked", !("details" in (mine[0] ?? {})) && !("retryable" in (mine[0] ?? {})));
      check("no phone leaked in response", !("phone" in (mine[0] ?? {})));
      check("resolved contact excluded from unresolved view", unresolved.rows.every((x) => x.contactId !== goodCid));

      const all = await listInvalidGhlContacts({ status: "all", limit: 100, offset: 0 }, testPool as any);
      const good = all.rows.filter((x) => x.contactId === goodCid);
      check("resolved contact visible under status=all as resolved", good.length === 1 && good[0].status === "resolved");

      const resolvedOnly = await listInvalidGhlContacts({ status: "resolved", limit: 100, offset: 0 }, testPool as any);
      check("status=resolved returns only resolved", resolvedOnly.rows.some((x) => x.contactId === goodCid) && resolvedOnly.rows.every((x) => x.status === "resolved"));
    }

    // ═══ Test 14: shared state untouched ═══
    console.log("\n[14] shared-state isolation");
    const sharedAfter = await sharedPool.query(`SELECT * FROM serper_control WHERE id = 1`);
    check("shared serper_control row unchanged",
      JSON.stringify(sharedBefore.rows[0]) === JSON.stringify(sharedAfter.rows[0]));
    const cooldownAfter = await sharedPool.query(
      `SELECT key, value, updated_at FROM system_settings WHERE key IN ('serper_circuit_open_alert_at','serper_circuit_recovery_alert_at') ORDER BY key`,
    );
    check("shared cooldown keys unchanged",
      JSON.stringify(cooldownBefore.rows) === JSON.stringify(cooldownAfter.rows));
  } finally {
    await testPool.end().catch(() => {});
    await sharedPool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
  }

  console.log(`\n═══ RESULT: ${passed} passed, ${failed} failed ═══`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
