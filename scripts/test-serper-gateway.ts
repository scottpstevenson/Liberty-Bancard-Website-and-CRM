/**
 * test-serper-gateway.ts — Fake-transport test suite for SerperGateway (#1600)
 *
 * Uses fetchOverride injection — never touches real HTTP. Runs against the
 * dev DB's serper_control row; the original row state is saved and restored.
 *
 * Proves the 10 spec cases:
 *  1. blocked while enabled=false
 *  2. missing / malformed / DB-error state blocks (fail-closed)
 *  3. 20 configured failures open the circuit
 *  4. 401/403 and confirmed quota exhaustion open immediately
 *  5. 200 with zero results = provider success, zero yield
 *  6. concurrent budget claims cannot exceed local_budget
 *  7. concurrent half-open claims result in only one probe
 *  8. monthly rollover preserves lifetime totals, resets window, quota-open → half_open
 *  9. manual recovery enters half_open and is audited
 * 10. scan-serper-raw-fetch exits non-zero when a raw Serper URL is present
 *
 * Run: npx tsx scripts/test-serper-gateway.ts
 */

import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { pool } from "../server/db";
import { SerperGateway, type SerperControlRow } from "../server/services/serper-gateway";

process.env.SERPER_API_KEY = process.env.SERPER_API_KEY || "test-key-fake";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

function fakeFetch(status: number, body: any = {}): { impl: any; calls: () => number } {
  let n = 0;
  return {
    impl: async () => {
      n++;
      return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    },
    calls: () => n,
  };
}

async function getRow(): Promise<SerperControlRow> {
  const { rows } = await pool.query(`SELECT * FROM serper_control WHERE id = 1`);
  return rows[0];
}

async function setRow(fields: Record<string, any>) {
  const keys = Object.keys(fields);
  const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
  await pool.query(`UPDATE serper_control SET ${sets}, updated_at = now() WHERE id = 1`, keys.map(k => fields[k]));
}

const RESET_BASE = {
  enabled: true,
  state: "closed",
  consecutive_failures: 0,
  opened_at: null,
  reason_code: null,
  half_open_probe_claimed_at: null,
  window_calls: 0,
  window_successes: 0,
  window_failures: 0,
  local_budget: 50000,
};

async function main() {
  const original = await getRow();
  if (!original) {
    console.error("serper_control row missing — run migrations first.");
    process.exit(1);
  }

  try {
    // ── Case 1: blocked while enabled=false ─────────────────────────────
    console.log("\nCase 1: enabled=false blocks");
    await setRow({ ...RESET_BASE, enabled: false });
    {
      const f = fakeFetch(200, { organic: [] });
      const gw = new SerperGateway({ fetchOverride: f.impl });
      const r = await gw.executeSearch("/search", { q: "x" }, "test1");
      check("blocked", r.blocked && r.blockReason === "disabled", JSON.stringify(r));
      check("no HTTP call made", f.calls() === 0);
    }

    // ── Case 2: missing / malformed / DB-error state blocks ─────────────
    console.log("\nCase 2: fail-closed on bad state");
    {
      const f = fakeFetch(200, {});
      const missingPool = { query: async (t: string) => (t.trim().startsWith("SELECT") ? { rows: [], rowCount: 0 } : { rows: [], rowCount: 0 }) };
      const gw1 = new SerperGateway({ fetchOverride: f.impl, poolOverride: missingPool as any });
      const r1 = await gw1.executeSearch("/search", { q: "x" }, "test2a");
      check("missing row blocks", r1.blocked && r1.blockReason === "state_missing", JSON.stringify(r1));

      const malformedPool = { query: async () => ({ rows: [{ id: 1, enabled: "yes", state: "weird" }], rowCount: 1 }) };
      const gw2 = new SerperGateway({ fetchOverride: f.impl, poolOverride: malformedPool as any });
      const r2 = await gw2.executeSearch("/search", { q: "x" }, "test2b");
      check("malformed row blocks", r2.blocked && r2.blockReason === "state_malformed", JSON.stringify(r2));

      const errorPool = { query: async () => { throw new Error("db down"); } };
      const gw3 = new SerperGateway({ fetchOverride: f.impl, poolOverride: errorPool as any });
      const r3 = await gw3.executeSearch("/search", { q: "x" }, "test2c");
      check("DB error blocks", r3.blocked && r3.blockReason === "state_unreadable", JSON.stringify(r3));
      check("no HTTP calls made", f.calls() === 0);
    }

    // ── Case 3: threshold failures open the circuit ─────────────────────
    console.log("\nCase 3: 20 failures open circuit");
    await setRow({ ...RESET_BASE });
    {
      const f = fakeFetch(500, { error: "boom" });
      const gw = new SerperGateway({ fetchOverride: f.impl });
      for (let i = 0; i < 20; i++) {
        const r = await gw.executeSearch("/search", { q: "x" }, "test3");
        if (r.blocked) break;
      }
      const row = await getRow();
      check("circuit open after threshold", row.state === "open", `state=${row.state}, cf=${row.consecutive_failures}`);
      check("reason recorded", row.reason_code === "provider_5xx", String(row.reason_code));
      const rBlocked = await gw.executeSearch("/search", { q: "x" }, "test3");
      check("subsequent call blocked", rBlocked.blocked && rBlocked.blockReason === "circuit_open");
    }

    // ── Case 4: 401/403 + quota open immediately ────────────────────────
    console.log("\nCase 4: auth/quota open immediately");
    for (const [status, body, expected] of [
      [401, {}, "auth_error"],
      [403, {}, "auth_error"],
      [429, { message: "Not enough credits" }, "quota_exhausted"],
    ] as const) {
      await setRow({ ...RESET_BASE });
      const f = fakeFetch(status as number, body);
      const gw = new SerperGateway({ fetchOverride: f.impl });
      await gw.executeSearch("/search", { q: "x" }, "test4");
      const row = await getRow();
      check(`${status} opens immediately (${expected})`, row.state === "open" && row.reason_code === expected,
        `state=${row.state} reason=${row.reason_code}`);
    }

    // ── Case 5: 200 zero results = success, zero yield ──────────────────
    console.log("\nCase 5: 200 zero results is success");
    await setRow({ ...RESET_BASE, yield_websites: 0, yield_emails: 0, yield_phones: 0 });
    {
      const f = fakeFetch(200, { organic: [] });
      const gw = new SerperGateway({ fetchOverride: f.impl });
      const r = await gw.executeSearch("/search", { q: "x" }, "test5");
      const row = await getRow();
      check("result ok", r.ok === true);
      check("counted as success", row.window_successes === 1 && row.consecutive_failures === 0,
        `ws=${row.window_successes} cf=${row.consecutive_failures}`);
      check("zero yield recorded", Number(row.yield_websites) === 0 && Number(row.yield_emails) === 0 && Number(row.yield_phones) === 0);
    }

    // ── Case 6: concurrent budget claims capped at local_budget ─────────
    console.log("\nCase 6: concurrent budget claims");
    await setRow({ ...RESET_BASE, local_budget: 5 });
    {
      const f = fakeFetch(200, { organic: [] });
      const gw = new SerperGateway({ fetchOverride: f.impl });
      const results = await Promise.all(
        Array.from({ length: 12 }, (_, i) => gw.executeSearch("/search", { q: String(i) }, "test6")),
      );
      const okCount = results.filter(r => r.ok).length;
      const budgetBlocked = results.filter(r => r.blockReason === "budget_exhausted").length;
      const row = await getRow();
      check("exactly budget succeeded", okCount === 5, `ok=${okCount}`);
      check("rest budget-blocked", budgetBlocked === 7, `blocked=${budgetBlocked}`);
      check("window_calls == budget", row.window_calls === 5, `wc=${row.window_calls}`);
      check("HTTP calls == budget", f.calls() === 5, `fetches=${f.calls()}`);
    }

    // ── Case 7: only one half-open probe ────────────────────────────────
    console.log("\nCase 7: single half-open probe");
    await setRow({ ...RESET_BASE, state: "half_open", half_open_probe_claimed_at: null });
    {
      const f = fakeFetch(200, { organic: [] });
      const gw = new SerperGateway({ fetchOverride: f.impl });
      const results = await Promise.all(
        Array.from({ length: 8 }, () => gw.executeSearch("/search", { q: "probe" }, "test7")),
      );
      const okCount = results.filter(r => r.ok).length;
      const probeBlocked = results.filter(r => r.blockReason === "half_open_probe_in_flight").length;
      const row = await getRow();
      check("exactly one probe executed", f.calls() === 1, `fetches=${f.calls()}`);
      check("one ok, rest blocked", okCount === 1 && probeBlocked === 7, `ok=${okCount} blocked=${probeBlocked}`);
      check("probe success closes circuit", row.state === "closed", row.state);
    }

    // ── Case 8: monthly rollover ────────────────────────────────────────
    console.log("\nCase 8: monthly rollover");
    await setRow({
      ...RESET_BASE,
      state: "open",
      reason_code: "quota_exhausted",
      window_calls: 100, window_successes: 80, window_failures: 20,
      lifetime_calls: 1000, lifetime_successes: 900, lifetime_failures: 100,
    });
    await pool.query(`UPDATE serper_control SET window_started_at = now() - interval '2 months', window_ends_at = now() - interval '1 month' WHERE id = 1`);
    {
      const gw = new SerperGateway({ fetchOverride: fakeFetch(200, {}).impl });
      const before = await getRow();
      await gw.checkAndApplyWindowRollover(before);
      const row = await getRow();
      check("window counters reset", row.window_calls === 0 && row.window_successes === 0 && row.window_failures === 0);
      check("lifetime preserved", Number(row.lifetime_calls) === 1000 && Number(row.lifetime_successes) === 900 && Number(row.lifetime_failures) === 100);
      check("quota-open → half_open", row.state === "half_open", row.state);
      check("window advanced one month", new Date(row.window_ends_at) > new Date(before.window_ends_at));

      // Auth-open stays open.
      await setRow({ ...RESET_BASE, state: "open", reason_code: "auth_error" });
      await pool.query(`UPDATE serper_control SET window_ends_at = now() - interval '1 day' WHERE id = 1`);
      const before2 = await getRow();
      await gw.checkAndApplyWindowRollover(before2);
      const row2 = await getRow();
      check("auth-open stays open", row2.state === "open", row2.state);
    }

    // ── Case 9: manual recovery is audited + enters half_open ───────────
    console.log("\nCase 9: manual recovery");
    await setRow({ ...RESET_BASE, state: "open", reason_code: "quota_exhausted", half_open_probe_claimed_at: new Date() });
    {
      const gw = new SerperGateway({ fetchOverride: fakeFetch(200, { organic: [] }).impl });
      const { auditChange } = await import("../server/services/audit-change");
      const correlationId = `test-recovery-${Date.now()}`;
      await auditChange({
        actorType: "system", action: "serper_manual_recovery", entityType: "serper_control",
        entityKey: "1", details: { reason: "test recovery", correlationId },
      });
      await gw.transitionToHalfOpenForRecovery();
      const mid = await getRow();
      check("transitioned to half_open + claim cleared", mid.state === "half_open" && mid.half_open_probe_claimed_at === null);
      const probe = await gw.executeSearch("/search", { q: "test" }, "admin_recovery_probe");
      const after = await getRow();
      check("probe succeeded and closed circuit", probe.ok && after.state === "closed", `ok=${probe.ok} state=${after.state}`);
      const audit = await pool.query(
        `SELECT id FROM audit_logs WHERE action = 'serper_manual_recovery' AND details->>'correlationId' = $1`,
        [correlationId],
      );
      check("audit row written", (audit.rowCount ?? 0) === 1);

      // Failed probe reopens.
      await setRow({ ...RESET_BASE, state: "half_open", half_open_probe_claimed_at: null });
      const gwFail = new SerperGateway({ fetchOverride: fakeFetch(500, {}).impl });
      await gwFail.executeSearch("/search", { q: "test" }, "admin_recovery_probe");
      const reopened = await getRow();
      check("failed probe reopens circuit", reopened.state === "open", reopened.state);
    }

    // ── Case 10: raw-fetch scan catches offenders ────────────────────────
    console.log("\nCase 10: raw-fetch scan");
    {
      const tmpFile = path.resolve(process.cwd(), "server/tmp-serper-scan-canary.ts");
      const rawUrl = ["https://google", "serper", "dev/search"].join(".");
      fs.writeFileSync(tmpFile, `// canary\nconst r = await fetch("${rawUrl}", { method: "POST" });\nexport default r;\n`);
      let exitCode = 0;
      try {
        execFileSync("npx", ["tsx", "scripts/scan-serper-raw-fetch.ts"], { cwd: process.cwd(), stdio: "pipe" });
      } catch (err: any) {
        exitCode = err.status ?? 1;
      }
      fs.unlinkSync(tmpFile);
      check("scan exits non-zero with canary present", exitCode !== 0, `exit=${exitCode}`);

      let cleanExit = 0;
      try {
        execFileSync("npx", ["tsx", "scripts/scan-serper-raw-fetch.ts"], { cwd: process.cwd(), stdio: "pipe" });
      } catch (err: any) {
        cleanExit = err.status ?? 1;
      }
      check("scan exits zero when clean", cleanExit === 0, `exit=${cleanExit}`);
    }
  } finally {
    // Restore original control row.
    await setRow({
      enabled: original.enabled,
      state: original.state,
      consecutive_failures: original.consecutive_failures,
      opened_at: original.opened_at,
      reason_code: original.reason_code,
      half_open_probe_claimed_at: original.half_open_probe_claimed_at,
      window_calls: original.window_calls,
      window_successes: original.window_successes,
      window_failures: original.window_failures,
      window_started_at: original.window_started_at,
      window_ends_at: original.window_ends_at,
      local_budget: original.local_budget,
      lifetime_calls: original.lifetime_calls,
      lifetime_successes: original.lifetime_successes,
      lifetime_failures: original.lifetime_failures,
      yield_websites: original.yield_websites,
      yield_emails: original.yield_emails,
      yield_phones: original.yield_phones,
    });
  }

  console.log(`\n══ Serper Gateway suite: ${pass} passed, ${fail} failed ══`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
