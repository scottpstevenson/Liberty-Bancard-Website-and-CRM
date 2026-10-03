import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";
import { CONTACT_VERTICAL_ALIASES, contactTargetVerticalSql, resolveContactTargetVertical } from "../shared/contact-vertical-taxonomy";
import { lockSfpRecipientCapacity } from "../server/services/cro03/sfp-recipient-capacity";

await assertDisposableTestInfrastructure({ operation: "SFP preflight build certification" });
const databaseUrl = process.env.TEST_DATABASE_URL;
assert.ok(databaseUrl, "a launcher-owned database is required");
const control = new pg.Client({ connectionString: databaseUrl });
await control.connect();
const schema = `preflight_${randomUUID().replace(/-/g, "")}`;
const program = randomUUID();
const objective = "sfp.initial_recipient_acquisition.v1";
let checked = 0;
try {
  await control.query(`CREATE SCHEMA "${schema}"`);
  // Isolated real SQL reservation table, not mocks or app-production fixtures.
  await control.query(`CREATE TABLE "${schema}".sfp_recipient_address_commitments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),program_id uuid NOT NULL,objective_key text NOT NULL,
    recipient_identity_hash text NOT NULL,business_id integer NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(program_id,objective_key,recipient_identity_hash))`);
  await control.query(`SET search_path TO "${schema}",public`);
  for (const [canonical, aliases] of Object.entries(CONTACT_VERTICAL_ALIASES)) {
    for (const alias of aliases) {
      assert.equal(resolveContactTargetVertical(alias), canonical);
      const result = await control.query(`SELECT ${contactTargetVerticalSql("c.vertical")} AS mapped
        FROM (SELECT $1::text AS vertical) c`, [alias]);
      assert.equal(result.rows[0].mapped, canonical, "SQL and UI normalization must agree");
      checked++;
    }
  }
  assert.equal(resolveContactTargetVertical("wellness"), null, "ambiguous raw labels do not gain qualification");
  assert.equal(resolveContactTargetVertical("restaurant"), null);
  assert.throws(() => contactTargetVerticalSql("c.vertical); DROP TABLE contacts"), /COLUMN_INVALID/);

  async function reserve(businessId: number, address: string) {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(`SET search_path TO "${schema}",public`);
      await client.query("BEGIN");
      const capacity = await lockSfpRecipientCapacity(drizzle(client), program, objective, businessId, address);
      await client.query(`INSERT INTO sfp_recipient_address_commitments
        (program_id,objective_key,recipient_identity_hash,business_id) VALUES($1,$2,$3,$4)
        ON CONFLICT DO NOTHING`, [program, objective, address, businessId]);
      // Hold the lock briefly so independent clients really contend.
      await client.query("SELECT pg_sleep(0.03)");
      await client.query("COMMIT");
      return capacity;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { await client.end(); }
  }
  const concurrent = await Promise.allSettled(["first", "second", "third", "fourth"].map(address => reserve(9001, address)));
  assert.equal(concurrent.filter(row => row.status === "fulfilled").length, 3, "exactly three concurrent slots");
  const held = concurrent.find(row => row.status === "rejected") as PromiseRejectedResult;
  assert.match(String(held.reason), /CAPACITY_REACHED/);
  const stored = await control.query("SELECT recipient_identity_hash FROM sfp_recipient_address_commitments WHERE business_id=9001");
  assert.equal(stored.rowCount, 3);
  const replay = await reserve(9001, stored.rows[0].recipient_identity_hash);
  assert.equal(replay.replay, true, "aliases/restarts cannot consume another slot");
  assert.ok(replay.slot >= 1 && replay.slot <= 3);
  await assert.rejects(reserve(9002, stored.rows[0].recipient_identity_hash), /BUSINESS_CONFLICT/);
  assert.equal((await reserve(9002, "new-primary")).role, "primary");
  assert.equal((await control.query("SELECT count(*)::integer AS n FROM sfp_recipient_address_commitments")).rows[0].n, 4);

  // Test actual application read SQL and incremental source queries against
  // migrated schema, without starting workers or authorizing automatic writes.
  const { readPeople } = await import("../server/services/revenue-read-authority");
  const contacts = await readPeople({ role: "admin" }, {
    limit: 5, offset: 0, recordClass: "production", vertical: "Auto Repair",
  });
  assert.equal(contacts.data.length, 0);
  const phone = Date.now() % 10000000000;
  await control.query(`INSERT INTO public.contacts(first_name,last_name,email,phone,company_name,record_class,vertical)
    VALUES('Alias','Auto','auto@alias.example.test',$1,'Alias Auto','production','Auto'),
          ('Alias','Healthcare','medical@alias.example.test',$2,'Alias Healthcare','production','medical')`,
    [String(phone), String(phone + 1)]);
  assert.equal((await readPeople({ role: "admin" }, {
    limit: 5, offset: 0, recordClass: "production", vertical: "Auto Repair",
  })).data.length, 1, "real contact query retrieves legacy Auto through Auto Repair");
  assert.equal((await readPeople({ role: "admin" }, {
    limit: 5, offset: 0, recordClass: "production", vertical: "Medical/Dental/Medspa",
  })).data.length, 1, "real contact query retrieves medical through Healthcare group");
  const { previewContactBusinessSystemLinks } = await import("../server/services/contact-business-system-links");
  const incremental = await previewContactBusinessSystemLinks({
    afterContactId: 0, limit: 25, changedSince: new Date().toISOString(),
  });
  assert.equal(incremental.rows.length, 0);
  const { getContactSfpReadiness } = await import("../server/services/contact-sfp-readiness");
  const empty = await getContactSfpReadiness({ id: 2147483600, email: "no-person@example.test", emailStatus: "unvalidated" });
  assert.deepEqual(empty.decisions, []);
  assert.equal(empty.separateFromCrm, true);
  const { getContactLinkAutomationStatus, processContactLinkAutomationTick } = await import("../server/services/contact-link-automation");
  assert.equal(await getContactLinkAutomationStatus(), null);
  assert.deepEqual(await processContactLinkAutomationTick(), { ran: false }, "no implicit automatic-write authorization");
  console.log(`PASS: ${checked} SQL/UI aliases, concurrent 1–3 reservations, replay/conflict, real read and incremental SQL, no implicit activation`);
} finally {
  await control.query(`DROP SCHEMA "${schema}" CASCADE`);
  await control.end();
  const { pool } = await import("../server/db");
  await pool.end();
}