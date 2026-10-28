/**
 * Stage 4A: the REAL registered lead-ops handlers (persisted sessions, CSRF, actual requireRole) for every retired
 * pilot entrance, with DB row-count proof that nothing was written. The emergency stop is only probed for denial
 * (never executed by an allowed role) so no provider control is changed. Disposable DB only; provider fetch is denied.
 */
import assert from "node:assert/strict";
import { stage3BHttpFixture } from "./fixtures/stage3-b-http";

const h = await stage3BHttpFixture(async (app) => {
  (await import("../server/routes/lead-ops")).registerLeadOpsRoutes(app);
}, undefined, { backgroundProfile: "off" });
const { RETIRED_PILOT_ENTRANCES, PILOT_RETIRED_CODE } = await import("../server/services/pilot-entrance-retirement");

const TABLES = ["audit_logs", "mi09_pilot_advancement_receipts", "mi09_pilot_checkpoints", "mi09_pilot_cohort_members", "mi09_pilot_definitions",
  "mi09_pilot_effect_links", "mi09_pilot_enrichment_outcomes", "mi09_pilot_reconciliation_reports", "mi09_pilot_runs", "provider_controls", "system_settings"];
const counts = async () => {
  const out: Record<string, string> = {};
  for (const t of TABLES) out[t] = (await h.pool.query(`SELECT count(*)::text n FROM ${t}`)).rows[0].n;
  // Row count alone misses updates: also fingerprint mutable control rows.
  out.__controls = (await h.pool.query(`SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) h FROM provider_controls t`)).rows[0].h;
  out.__settings = (await h.pool.query(`SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) h FROM system_settings t`)).rows[0].h;
  return out;
};
let passed = 0;
const ok = (m: string) => { passed++; console.log(`  ✅ ${m}`); };
const roles = ["manager", "agent", "merchant", "affiliate", "partner"] as const;

try {
  const before = await counts();
  for (const e of RETIRED_PILOT_ENTRANCES) {
    const path = e.route.replace(":runId", "run-does-not-exist");
    // Anonymous: refused by the real session gate.
    const anon = await h.originalFetch(`${h.base}${path}`, { method: e.method, headers: { "content-type": "application/json" }, body: "{}" });
    assert.ok([401, 403].includes(anon.status), `${e.key} anonymous refused (got ${anon.status})`);
    for (const role of roles) {
      const r = await h.request(role, e.method, path, {});
      assert.equal(r.status, 403, `${e.key}: ${role} must be denied by requireRole (got ${r.status})`);
      assert.notEqual(r.body?.code, PILOT_RETIRED_CODE, `${e.key}: ${role} must be refused before the fence handler`);
    }
    // CSRF is enforced by the real middleware before the admin ever reaches the handler.
    const noCsrf = await h.request("admin", e.method, path, {}, false);
    assert.equal(noCsrf.status, 403, `${e.key}: admin without CSRF refused (got ${noCsrf.status})`);
    assert.notEqual(noCsrf.body?.code, PILOT_RETIRED_CODE);
    const a1 = await h.request("admin", e.method, path, {});
    assert.equal(a1.status, 410, `${e.key}: admin gets the retired response`);
    assert.equal(a1.body.code, PILOT_RETIRED_CODE);
    assert.equal(a1.body.performed, false);
    const a2 = await h.request("admin", e.method, path, {});
    assert.deepEqual(a2.body, a1.body, `${e.key}: stable body`);
  }
  ok(`all ${RETIRED_PILOT_ENTRANCES.length} retired entrances: anon refused, 5 non-admin roles 403, admin without CSRF 403, admin with CSRF stable 410 performed:false`);
  assert.deepEqual(await counts(), before, "retired entrances wrote nothing (row counts and control fingerprints identical)");
  ok("database row counts and provider/system control fingerprints unchanged after every attempt");

  // Emergency stop stays registered and role-gated: denial only, never executed by an allowed role here.
  const stop = "/api/lead-ops/pilot/emergency-stop-paid";
  const stopAnon = await h.originalFetch(`${h.base}${stop}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.ok([401, 403].includes(stopAnon.status));
  for (const role of roles) {
    const r = await h.request(role, "POST", stop, {});
    assert.equal(r.status, 403, `emergency stop denied for ${role}`);
  }
  const stopNoCsrf = await h.request("admin", "POST", stop, {}, false);
  assert.equal(stopNoCsrf.status, 403, "emergency stop needs CSRF");
  assert.deepEqual(await counts(), before, "denied emergency-stop attempts changed nothing");
  ok("emergency-stop-paid remains registered and refuses anonymous, non-admin and CSRF-less requests without side effects");

  assert.equal(h.externalCalls(), 0, "no provider fetch attempted");
  ok("no external provider call attempted");
  console.log(`\n${passed} check groups passed`);
} catch (e) {
  console.error("FAIL", e);
  process.exitCode = 1;
} finally {
  await h.close();
}
