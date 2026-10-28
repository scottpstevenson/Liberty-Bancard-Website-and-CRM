/** Stage 4A P05: identity health / send monitoring carry insufficient evidence as null, never 0%. Disposable DB. */
import assert from "node:assert/strict";
import { pool } from "../server/db";
import { getIdentityHealthReport, getSendMonitoringData } from "../server/services/sdr/funnel-metrics";

let n = 0;
const ok = (m: string) => { n++; console.log(`  ✅ ${m}`); };
const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const old = new Date(Date.now() - 20 * 86400_000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const ids: number[] = [];

async function mk(label: string, score: number | null, daily: Array<{ date: string; sent: number; bounced: number; replied: number; opened: number; complaints?: number }>) {
  const r = await pool.query(
    `INSERT INTO sending_identities(label, domain, email_address, health_score, daily_limit) VALUES ($1, $2, $3, $4, 30) RETURNING id`,
    [`s4a-${label}`, `s4a-${label}.test`, `${label}@s4a.test`, score]);
  const id = r.rows[0].id as number; ids.push(id);
  for (const d of daily) {
    await pool.query(
      `INSERT INTO identity_performance_daily(sending_identity_id, date, emails_sent, delivered, bounced, replied, opened, complaints) VALUES ($1,$2,$3,$3,$4,$5,$6,$7)`,
      [id, d.date, d.sent, d.bounced, d.replied, d.opened, d.complaints ?? 0]);
  }
  return id;
}

async function main() {
  try {
    const zero = await mk("zero", null, []);                       // no rows at all, unknown score
    const stale = await mk("stale", 0, [{ date: old, sent: 50, bounced: 5, replied: 1, opened: 10 }]); // only outside window, real 0 score
    const real0 = await mk("real0", 90, [{ date: today, sent: 40, bounced: 0, replied: 0, opened: 0 }]); // sends, genuine 0%
    const busy = await mk("busy", 80, [{ date: today, sent: 20, bounced: 4, replied: 2, opened: 10 }]);

    const health = await getIdentityHealthReport();
    const h = (id: number) => health.find((x: any) => x.id === id);
    for (const id of [zero, stale]) {
      const r = h(id);
      assert.equal(r.bounceRate, null); assert.equal(r.replyRate, null); assert.equal(r.openRate, null); assert.equal(r.complaintRate, null);
      assert.equal(r.weekSent, 0);
      assert.deepEqual([r.evidence.sufficient, r.evidence.denominator], [false, 0]);
      assert.notEqual(r.alert, "high_bounce", "no sends cannot raise a bounce alert");
    }
    assert.equal(h(zero).alert, null, "unknown score and no sends: no alert");
    assert.equal(h(stale).alert, "degraded", "a real 0 health score still degrades");
    assert.equal(h(zero).healthScore, null, "unknown score stays null");
    assert.equal(h(stale).healthScore, 0, "a real 0 score stays 0");
    ok("identity health: zero-send and outside-window identities give null rates, insufficient evidence, no alert");
    assert.equal(h(real0).bounceRate, 0); assert.equal(h(real0).replyRate, 0); assert.equal(h(real0).evidence.sufficient, true);
    assert.equal(h(busy).bounceRate, 20); assert.equal(h(busy).replyRate, 10); assert.equal(h(busy).alert, "high_bounce");
    ok("identity health: real zero with sends stays 0%; non-zero rates and the high-bounce alert are unchanged");

    const mon = await getSendMonitoringData();
    const m = (id: number) => mon.identities.find((x: any) => x.id === id);
    for (const id of [zero, stale]) {
      const w = m(id).week;
      assert.equal(w.bounceRate, null); assert.equal(w.replyRate, null); assert.equal(w.complaintRate, null); assert.equal(w.openRate, null);
      assert.equal(w.evidence.sufficient, false);
    }
    assert.equal(m(real0).week.bounceRate, 0);
    assert.equal(m(busy).week.bounceRate, 20);
    assert.equal(m(busy).week.evidence.denominator, 20);
    ok("send monitoring: week rates are null with no sends, real zero preserved, evidence carries the denominator");
    assert.equal(typeof mon.aggregated.totalDailyLimit, "number");
    ok("send monitoring aggregate still reports capacity when limits exist");
  } finally {
    if (ids.length) {
      await pool.query(`DELETE FROM identity_performance_daily WHERE sending_identity_id = ANY($1)`, [ids]);
      await pool.query(`DELETE FROM sending_identities WHERE id = ANY($1)`, [ids]);
    }
  }
  console.log(`\n${n} check groups passed`);
  process.exit(0);
}
main().catch((e) => { console.error("FAIL", e); process.exit(1); });
