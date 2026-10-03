import assert from "node:assert/strict";
import type { Pool } from "pg";
import { randomInt } from "node:crypto";

type RequestFixture = (role: string, method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }>;

/** Called only after the entry suite has proved disposable infrastructure. */
export async function certifyStage3Reads(ctx: {
  pool: Pool; prefix: string; owned: number; nonowned: number; agentEmail: string;
  request: RequestFixture;
}) {
  const { pool, prefix, owned, nonowned, agentEmail, request } = ctx;
  const { storage } = await import("../server/storage");
  const { readTaskMetrics } = await import("../server/services/task-read-authority");
  const { contactReadPredicate, dealReadPredicate } = await import("../server/services/revenue-read-authority");
  const { readTerminalRecommendationReport } = await import("../server/services/terminal-report-authority");
  const { SEQUENCE_REPORT_SQL } = await import("../server/services/sequence-report-query");
  const seedContact = async (kind: string, recordClass: string, archived = false) => {
    const row = await pool.query(`INSERT INTO contacts(first_name,last_name,email,phone,record_class,assigned_to,archived_at)
      VALUES('Read','Fixture',$1,$2,$3,$4,$5) RETURNING id`,
    [`${prefix}-${kind}@example.test`, `+1555${randomInt(1000000, 9999999)}`, recordClass, agentEmail, archived ? new Date() : null]);
    return row.rows[0].id as number;
  };
  const testContact = await seedContact("test", "test");
  const archivedContact = await seedContact("archived", "production", true);
  const seedDeal = async (recordClass: string, owner: string, archived = false) => {
    const row = await pool.query(`INSERT INTO deals(name,contact_id,record_class,owner,archived_at)
      VALUES($1,$2,$3,$4,$5) RETURNING id`, [prefix, owned, recordClass, owner, archived ? new Date() : null]);
    return row.rows[0].id as number;
  };
  const ownedDeal = await seedDeal("production", agentEmail);
  const testDeal = await seedDeal("test", agentEmail);
  const archivedDeal = await seedDeal("production", agentEmail, true);
  const otherDeal = await seedDeal("production", `${prefix}-other@example.test`);
  // One static fixture population; cached totals declare their own observation
  // time, not an atomic snapshot shared with a separately queried row page.
  for (const role of ["admin", "manager", "agent"]) {
    for (const recordClass of [undefined, "production", "test", "demo", "synthetic"]) {
      for (const archived of [false, true]) {
        const query = new URLSearchParams({ search: prefix, limit: "250", archived: String(archived) });
        if (recordClass) query.set("recordClass", recordClass);
        const [list, facets] = await Promise.all([
          request(role, "GET", `/api/contacts?${query}`),
          request(role, "GET", `/api/contacts/facets?${query}`),
        ]);
        if (role === "agent" && archived) {
          assert.equal(list.status, 403);
          assert.equal(facets.status, 403);
          continue;
        }
        assert.equal(list.status, 200, JSON.stringify(list.body));
        assert.equal(facets.status, 200, JSON.stringify(facets.body));
        const rows = list.body.data as Array<{ id: number }>;
        assert.ok(Array.isArray(rows));
        assert.equal(facets.body.total, rows.length);
        assert.ok(facets.body.asOf, "Successful cached facets carry a separate observation timestamp");
        if (role === "agent") assert.ok(!rows.some(row => row.id === nonowned));
        const csv = await request(role, "GET", `/api/contacts/export-csv?${query}`);
        if (role === "agent") {
          assert.equal(csv.status, 403, "Export retains its explicit management-only contract");
        } else {
          assert.equal(csv.status, 200);
          const ids = String(csv.body).split("\n").slice(1).filter(Boolean).map(line => Number(line.split(",")[0])).sort((a, b) => a - b);
          assert.deepEqual(ids, rows.map(row => row.id).sort((a, b) => a - b));
        }
      }
    }
  }
  const phone = (await pool.query("SELECT phone FROM contacts WHERE id=$1", [owned])).rows[0].phone;
  const phoneQuery = new URLSearchParams({ search: phone, limit: "250" });
  const [phoneList, phoneFacets, phoneCsv] = await Promise.all([
    request("admin", "GET", `/api/contacts?${phoneQuery}`),
    request("admin", "GET", `/api/contacts/facets?${phoneQuery}`),
    request("admin", "GET", `/api/contacts/export-csv?${phoneQuery}`),
  ]);
  assert.equal(phoneList.status, 200);
  assert.equal(phoneFacets.status, 200);
  assert.equal(phoneCsv.status, 200);
  assert.ok(phoneList.body.data.some((row: { id: number }) => row.id === owned));
  assert.equal(phoneFacets.body.total, phoneList.body.data.length);
  assert.equal(String(phoneCsv.body).split("\n").filter(Boolean).length - 1, phoneList.body.data.length);
  console.log("PASS actual session rows/facet-cache/export ID parity across actor/class/archive/empty populations; restricted export and shared phone search retained");
  const ticket = await pool.query("INSERT INTO tickets(subject,description,contact_id) VALUES($1,'Fixture',$2) RETURNING id", [prefix, archivedContact]);
  const expected = new Set<number>();
  const cases = [
    { contact: owned, allowed: true }, { contact: nonowned, allowed: false },
    { contact: testContact, allowed: false }, { contact: archivedContact, allowed: false },
    { deal: ownedDeal, allowed: true }, { deal: testDeal, allowed: false },
    { deal: archivedDeal, allowed: false }, { deal: otherDeal, allowed: false },
    { ticket: ticket.rows[0].id, allowed: false },
    { assignee: agentEmail, allowed: true }, { assignee: `${prefix}-other@example.test`, allowed: false },
    { allowed: false },
  ];
  const seeded: number[] = [];
  for (const c of cases) {
    const row = await pool.query(`INSERT INTO tasks(title,contact_id,deal_id,ticket_id,assigned_to,status,authority_state,due_date)
      VALUES($1,$2,$3,$4,$5,'pending','open','2026-10-03T11:00:00Z') RETURNING id`,
    [prefix, "contact" in c ? c.contact : null, "deal" in c ? c.deal : null,
      "ticket" in c ? c.ticket : null, "assignee" in c ? c.assignee : null]);
    seeded.push(row.rows[0].id);
    if (c.allowed) expected.add(row.rows[0].id);
  }
  const scope = { actor: { role: "agent", email: agentEmail }, asOf: new Date("2026-10-03T12:00:00Z"), timezone: "America/New_York" };
  const list = await storage.getTasks({ scope });
  assert.deepEqual(new Set(list.filter(t => seeded.includes(t.id)).map(t => t.id)), expected);
  assert.equal((await storage.getTasks({ scope: { ...scope, states: [] } })).length, 0);
  for (const timezone of ["UTC", "America/New_York"]) {
    const dateScope = { ...scope, timezone, states: ["open" as const], dueFrom: new Date("2026-10-03T11:00:00Z"), dueBefore: new Date("2026-10-03T12:00:00Z") };
    assert.equal((await readTaskMetrics(dateScope)).rows[0].total, (await storage.getTasks({ scope: dateScope })).length);
    assert.equal((await storage.getTasks({ scope: { ...dateScope, dueBefore: dateScope.dueFrom } })).length, 0);
  }
  console.log("PASS task linked class/archive/owner/ticket/unlinked/empty-state and inclusive/exclusive date boundaries; canonical NOT NULL states preserved");

  // Static fixture data, and one frozen application clock, establish same-asOf
  // parity across actual registered readers. No concurrent-snapshot claim.
  const RealDate = Date;
  const asOf = new RealDate();
  class FixtureDate extends RealDate {
    constructor(value?: any) { super(value === undefined ? asOf.getTime() : value); }
    static now() { return asOf.getTime(); }
  }
  globalThis.Date = FixtureDate as typeof Date;
  try {
    for (const role of ["admin", "manager"]) {
      const [overview, analytics, briefing, tasks] = await Promise.all([
        request(role, "GET", "/api/kpi/summary"), request(role, "GET", "/api/analytics/tasks"),
        request(role, "POST", "/api/overview/daily-briefing/refresh"), request(role, "GET", "/api/tasks"),
      ]);
      for (const response of [overview, analytics, briefing, tasks]) assert.equal(response.status, 200, JSON.stringify(response.body));
      const m = await readTaskMetrics({ actor: { role }, asOf, timezone: "UTC" });
      assert.equal(overview.body.tasks.pending, m.rows[0].pending);
      assert.equal(overview.body.tasks.overdue, m.rows[0].overdue);
      assert.equal(analytics.body.overdue, m.rows[0].overdue);
      assert.equal(analytics.body.pending, m.rows[0].pending);
      assert.equal(briefing.body.overdueTaskCount, m.rows[0].overdue);
      assert.equal(overview.body.tasks.meta.asOf, asOf.toISOString());
      assert.equal(analytics.body.meta.asOf, asOf.toISOString());
      assert.equal(briefing.body.taskMetricContract.asOf, asOf.toISOString());
      const taskRows = Array.isArray(tasks.body) ? tasks.body : tasks.body.data;
      assert.equal(taskRows.length, m.rows[0].total);
    }
    const overview = await request("agent", "GET", "/api/kpi/summary");
    assert.equal(overview.status, 200);
    const values: unknown[] = [];
    const predicate = contactReadPredicate(scope.actor, { recordClass: "production", limit: 1, offset: 0 }, values);
    const contacts = await pool.query(`SELECT count(*)::int AS n FROM contacts c WHERE ${predicate}`, values);
    assert.equal(overview.body.contacts.total, contacts.rows[0].n);
    const dealValues: unknown[] = [];
    const dp = dealReadPredicate(scope.actor, {}, dealValues);
    const deals = await pool.query(`SELECT count(*)::int AS n FROM deals d WHERE ${dp}`, dealValues);
    assert.equal(Object.values(overview.body.pipeline.stagesBreakdown).reduce((a: any, b: any) => a + b, 0), deals.rows[0].n);
  } finally { globalThis.Date = RealDate; }
  console.log("PASS actual same-clock task HTTP list/overview/analytics/briefing parity and scoped agent contact/deal scalar reads");

  const sequence = await pool.query("INSERT INTO follow_up_sequences(name,status,created_by) VALUES($1,'paused',$2) RETURNING id",
    [prefix, `${prefix}-manager`]);
  const sid = sequence.rows[0].id;
  const zero = (await pool.query(SEQUENCE_REPORT_SQL)).rows.find(r => r.id === sid);
  assert.equal(zero.step_count, 0); assert.equal(zero.total_memberships, 0); assert.equal(zero.unique_contacts, 0);
  await pool.query("INSERT INTO sequence_enrollments(sequence_id,contact_id,status) VALUES($1,$2,'completed')", [sid, owned]);
  assert.equal((await request("manager", "GET", "/api/sequence-enrollments")).status, 403);
  const ownedRead = await request("manager", "GET", `/api/sequence-enrollments?sequenceId=${sid}`);
  assert.equal(ownedRead.status, 200); assert.equal(ownedRead.body.length, 1);
  const allOwned = await request("manager", "GET", "/api/sequence-enrollments/owned");
  assert.equal(allOwned.status, 200); assert.ok(allOwned.body.some((r: any) => r.sequenceId === sid));
  const other = await pool.query("SELECT id FROM follow_up_sequences WHERE name=$1 AND id<>$2", [prefix, sid]);
  assert.equal((await request("manager", "GET", `/api/sequence-enrollments?sequenceId=${other.rows[0].id}`)).status, 403);
  const originalRead = storage.getSequenceEnrollments;
  storage.getSequenceEnrollments = async () => { throw new Error("FIXTURE_SEQUENCE_READ_FAILED"); };
  try {
    assert.equal((await request("manager", "GET", "/api/sequence-enrollments/owned")).status, 500);
  } finally { storage.getSequenceEnrollments = originalRead; }
  console.log("PASS empty sequence DB counts, real manager owned-positive/global-and-other-denied sessions and failed read not empty");

  const before = await readTerminalRecommendationReport(0, { greenThresholdMonths: 6, yellowThresholdMonths: 12 });
  await pool.query(`UPDATE deals SET terminal_recommendation='Fixture missing-price model',
    closed_at=NOW(),terminal_approval_status='rejected' WHERE id=ANY($1::int[])`, [[ownedDeal, testDeal, archivedDeal]]);
  const finance = await readTerminalRecommendationReport(0, { greenThresholdMonths: 6, yellowThresholdMonths: 12 });
  assert.equal(finance.summary.totalRecommendations - before.summary.totalRecommendations, 1);
  assert.equal(finance.summary.forecastCost, null);
  assert.equal(finance.summary.thisMonthCost, null);
  assert.equal(finance.summary.actualCashRecovery, null);
  console.log("PASS archived/test recommendations excluded, rejected recommendation remains only a forecast and missing monthly cost is unavailable");
}