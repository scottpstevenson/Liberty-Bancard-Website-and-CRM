/** Stage 4A P04: GHL dashboard activity counts come from scoped SQL aggregates, not a capped row read. Disposable DB. */
import assert from "node:assert/strict";
import { pool, db } from "../server/db";
import { readGhlDashboardActivity } from "../server/services/ghl-dashboard-metrics";

let n = 0;
const ok = (m: string) => { n++; console.log(`  ✅ ${m}`); };
const TAG = "s4a-ghl-dash";
const asOf = new Date("2026-03-10T12:00:00.000Z");
const at = (hoursBefore: number) => new Date(asOf.getTime() - hoursBefore * 3600_000);

async function audit(action: string, when: Date, count = 1) {
  await pool.query(`INSERT INTO audit_logs(action, entity_type, created_at) SELECT $1, $2, $3 FROM generate_series(1, $4)`, [action, TAG, when, count]);
}
async function activity(direction: string, channel: string, metadata: unknown, when: Date, count = 1) {
  await pool.query(`INSERT INTO ghl_activity_log(direction, channel, metadata, created_at) SELECT $1, $2, $3::jsonb, $4 FROM generate_series(1, $5)`,
    [direction, channel, metadata == null ? null : JSON.stringify(metadata), when, count]);
}
const failingNth = (target: number) => { let c = 0; return { execute: (q: any) => { c++; if (c === target) return Promise.reject(new Error("boom")); return (db as any).execute(q); } }; };

async function cleanup() {
  await pool.query(`DELETE FROM audit_logs WHERE entity_type = $1`, [TAG]);
  await pool.query(`DELETE FROM ghl_activity_log WHERE created_at >= '2026-03-08' AND created_at <= '2026-03-11' AND (metadata->>'tag' = $1 OR metadata IS NULL)`, [TAG]);
}

async function main() {
  await cleanup();
  const pre = await readGhlDashboardActivity(db, asOf);
  assert.equal(pre.failedSyncs, 0);
  assert.equal(pre.webhookEvents, 0);
  assert.equal(pre.fieldWriteErrors422, 0);
  assert.equal(pre.recent422.length, 0);
  ok("exact zero is a real 0 when the window has no matching rows");

  try {
    // >500 mixed in-window rows first (older), and the matching rows last: a capped newest-200 read would miss them.
    await audit("some_other_action", at(1), 700);
    await audit("ghl_sync_error", at(20), 3);
    await audit("ghl_sync_failed", at(19), 2);
    await audit("contact_unsubscribed", at(18), 4);
    await audit("contact_dnd_set", at(17), 1);
    await audit("ghl_sync_error", at(30), 9);      // outside the window (older)
    await audit("ghl_sync_error", new Date(asOf.getTime() + 3600_000), 5); // after asOf
    await audit("noise_after", at(0.1), 600);      // 600 newer unrelated rows
    const a = await readGhlDashboardActivity(db, asOf);
    assert.equal(a.failedSyncs, 5, "late matching rows beyond 500 newer rows are counted; outside-window rows are not");
    assert.equal(a.optOutEvents, 5);
    assert.equal(a.availability.audit, true);
    ok(">500 mixed rows: matching events past the old 200-row cap counted; outside-window and after-asOf rows excluded");

    // Circuit variants: ordered latest-event semantics, independent of the window and of any row cap.
    await audit("GHL_CIRCUIT_OPEN", new Date("2099-01-01T00:00:00Z"));
    let c = await readGhlDashboardActivity(db, asOf);
    assert.equal(c.lastCircuitTripAt, "2099-01-01T00:00:00.000Z");
    assert.equal(c.lastCircuitEvent?.action, "GHL_CIRCUIT_OPEN");
    await audit("GHL_CIRCUIT_OPEN_AUTH", new Date("2099-02-01T00:00:00Z"));
    c = await readGhlDashboardActivity(db, asOf);
    assert.equal(c.lastCircuitTripAt, "2099-02-01T00:00:00.000Z", "an auth-open trip counts as a trip");
    await audit("GHL_CIRCUIT_CLOSED", new Date("2099-03-01T00:00:00Z"));
    c = await readGhlDashboardActivity(db, asOf);
    assert.equal(c.lastCircuitTripAt, "2099-02-01T00:00:00.000Z", "a later close does not erase the last trip");
    assert.equal(c.lastCircuitEvent?.action, "GHL_CIRCUIT_CLOSED");
    assert.equal(c.lastCircuitEvent?.at, "2099-03-01T00:00:00.000Z");
    ok("circuit: open, auth-open and closed variants resolve by ordered latest event; close is visible, trip is retained");

    // Activity: 422 kinds separated; sample bounded; counts exact beyond the bound.
    const m = (errorBody: string) => ({ tag: TAG, httpStatus: 422, errorBody, operation: "update" });
    await activity("outbound", "sync_error", m('{"message":["email must be an email"]}'), at(5), 12);
    await activity("outbound", "sync_error", m('{"message":"Custom field lb_can_email is not defined"}'), at(6), 3);
    await activity("outbound", "sync_error", m('{"message":"something unexpected"}'), at(7), 2);
    await activity("outbound", "sync_error", { tag: TAG, httpStatus: "422", errorBody: "customFields invalid" }, at(8), 1); // string status
    await activity("outbound", "sync_error", { tag: TAG, httpStatus: 500, errorBody: "email invalid" }, at(8), 4);        // not a 422
    await activity("inbound", "webhook", { tag: TAG }, at(9), 6);
    await activity("outbound", "permission_check", { tag: TAG }, at(9), 7);
    await activity("inbound", "webhook", { tag: TAG }, at(40), 20);   // outside window
    await activity("outbound", "sync_error", m("email invalid"), at(40), 20); // outside window
    const d = await readGhlDashboardActivity(db, asOf);
    assert.equal(d.emailValidation422, 12, "email-validation 422s are separate from field gaps (the 500 and outside-window rows are excluded)");
    assert.equal(d.fieldWriteErrors422, 4, "custom-field 422s, including a string-typed status");
    assert.equal(d.unclassified422, 2, "unknown 422 bodies are unclassified, not field gaps");
    assert.equal(d.webhookEvents, 6 + 0);
    assert.equal(d.permissionChecks, 7);
    assert.equal(d.recent422.length, 10, "only the detail sample is bounded");
    assert.ok(d.recent422.every((r) => r.httpStatus === 422));
    const times = d.recent422.map((r) => r.createdAt!);
    assert.deepEqual([...times].sort().reverse(), times, "sample is newest-first");
    assert.equal(d.recent422[0].kind, "email_validation");
    ok("422 aggregates: email/custom-field/unknown separated in SQL, exact beyond the 10-row sample, window and status predicates applied first");
    assert.equal(d.window.asOf, asOf.toISOString());
    assert.equal(d.window.since, at(24).toISOString());
    assert.equal(d.window.scope, "all_contacts");
    ok("one asOf/window/scope contract is returned with the counts");

    // Query failure: the failed section is unavailable (null), other sections still report.
    const f1 = await readGhlDashboardActivity(failingNth(1) as any, asOf);
    assert.equal(f1.failedSyncs, null);
    assert.equal(f1.optOutEvents, null);
    assert.equal(f1.availability.audit, false);
    assert.equal(f1.availability.activity, true);
    assert.equal(f1.webhookEvents, 6);
    const f2 = await readGhlDashboardActivity(failingNth(3) as any, asOf);
    assert.equal(f2.availability.circuit, false);
    assert.equal(f2.lastCircuitTripAt, null);
    assert.equal(f2.lastCircuitEvent, null);
    assert.equal(f2.failedSyncs, 5);
    const f4 = await readGhlDashboardActivity(failingNth(4) as any, asOf);
    assert.equal(f4.availability.activity, false);
    assert.equal(f4.fieldWriteErrors422, null);
    assert.equal(f4.emailValidation422, null);
    assert.equal(f4.webhookEvents, null);
    assert.deepEqual(f4.recent422, []);
    const f5 = await readGhlDashboardActivity(failingNth(5) as any, asOf);
    assert.equal(f5.availability.activity, false, "a failed sample read also marks the whole activity section unavailable");
    assert.equal(f5.fieldWriteErrors422, null);
    ok("a failed query makes only its section null/unavailable, never zero");

    const { getFullSyncDashboard } = await import("../server/services/ghl-sync");
    const dash: any = await getFullSyncDashboard();
    assert.ok(dash.activityWindow && dash.activityWindow.hours === 24);
    assert.ok("lastEvent" in dash.circuitState);
    ok("getFullSyncDashboard serves the scoped aggregate contract (activityWindow, circuitState.lastEvent)");
  } finally {
    await cleanup();
    await pool.query(`DELETE FROM ghl_activity_log WHERE metadata->>'tag' = $1`, [TAG]);
  }
  console.log(`\n${n} check groups passed`);
  process.exit(0);
}
main().catch((e) => { console.error("FAIL", e); process.exit(1); });
