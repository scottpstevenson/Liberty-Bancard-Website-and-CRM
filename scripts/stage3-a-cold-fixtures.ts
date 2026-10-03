import assert from "node:assert/strict";
import type { Pool } from "pg";

export async function certifyStage3Cold(ctx: {
  pool: Pool; prefix: string; owned: number; nonowned: number; agentEmail: string;
  request: (role: string, method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }>;
}) {
  const { pool, prefix, owned, nonowned, agentEmail, request } = ctx;
  const linkedDeal = await pool.query("INSERT INTO deals(name,contact_id,owner,stage,record_class) VALUES($1,$2,$3,'Closed Lost','production') RETURNING id",
    [prefix, nonowned, agentEmail]);
  const audience = await request("agent", "GET", "/api/contacts/cold-leads");
  assert.equal(audience.status, 200);
  assert.ok(audience.body.data.some((r: any) => r.id === nonowned), "approved owned-deal collection visibility retained");
  assert.equal((await request("agent", "POST", `/api/contacts/${nonowned}/re-engage`)).status, 404,
    "the deliberately narrower direct-object guard was not widened");
  assert.equal((await request("agent", "POST", "/api/contacts/bulk-re-engage", { contactIds: [nonowned] })).body.enrolled, 0);
  const relationshipBlocker = await pool.connect();
  const relationshipAudits = (await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE entity_id=$1 AND action='re_engage_request_processed'", [nonowned])).rows[0].n;
  try {
    await relationshipBlocker.query("BEGIN");
    await relationshipBlocker.query("UPDATE deals SET owner=$1 WHERE id=$2", [`${prefix}-other@example.test`, linkedDeal.rows[0].id]);
    const racingRelationship = request("agent", "POST", "/api/contacts/bulk-re-engage", { contactIds: [owned, nonowned] });
    let observedWait = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const waiting = await pool.query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
        AND wait_event_type='Lock' AND query LIKE '%FROM deals d WHERE d.contact_id=ANY%') AS waiting`);
      if (waiting.rows[0].waiting) { observedWait = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(observedWait, "the actual request freezes the relationship that granted authority");
    await relationshipBlocker.query("COMMIT");
    assert.equal((await racingRelationship).status, 404);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE entity_id=$1 AND action='re_engage_request_processed'", [nonowned])).rows[0].n, relationshipAudits);
  } finally { await relationshipBlocker.query("ROLLBACK"); relationshipBlocker.release(); }
  assert.equal((await request("agent", "POST", "/api/contacts/bulk-re-engage", { contactIds: [nonowned, owned] })).status, 404);
  assert.ok(!(await request("agent", "GET", "/api/contacts/cold-leads")).body.data.some((r: any) => r.id === nonowned));

  // The request sees the old owner before blocking at FOR UPDATE. A committed
  // ownership change must be re-evaluated, not authorized from that old view.
  const blocker = await pool.connect();
  const before = (await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE entity_id=$1 AND action='re_engage_request_processed'", [owned])).rows[0].n;
  try {
    await blocker.query("BEGIN");
    await blocker.query("UPDATE contacts SET assigned_to=$1 WHERE id=$2", [`${prefix}-other@example.test`, owned]);
    const racingRequest = request("agent", "POST", "/api/contacts/bulk-re-engage", { contactIds: [owned] });
    let observedWait = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const waiting = await pool.query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event_type='Lock'
          AND query LIKE '%FROM contacts c WHERE c.id=ANY%') AS waiting`);
      if (waiting.rows[0].waiting) { observedWait = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(observedWait, "the actual registered request must wait at the final object lock");
    await blocker.query("COMMIT");
    assert.equal((await racingRequest).status, 404);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE entity_id=$1 AND action='re_engage_request_processed'", [owned])).rows[0].n, before);
  } finally {
    await blocker.query("ROLLBACK"); blocker.release();
    await pool.query("UPDATE contacts SET assigned_to=$1 WHERE id=$2", [agentEmail, owned]);
  }
  await pool.query("UPDATE contacts SET do_not_contact=true WHERE id=$1", [owned]);
  const blocked = await request("agent", "POST", `/api/contacts/${owned}/re-engage`);
  assert.equal(blocked.status, 200); assert.equal(blocked.body.enrolled, false);
  assert.equal(blocked.body.state, "blocked");
  await pool.query("UPDATE contacts SET do_not_contact=false WHERE id=$1", [owned]);
  console.log("PASS real owned-deal collection versus direct-object policy, changed-deal scope, concurrent contact-owner recheck and consent block; zero enrollment/tag/provider effects");
}