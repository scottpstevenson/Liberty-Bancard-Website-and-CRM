import assert from "node:assert/strict";
import fs from "node:fs";
import { assertDisposableTestInfrastructure } from "../test-infrastructure-guard";
import { CONTACT_VERTICAL_ALIASES, resolveContactTargetVertical } from "../../shared/contact-vertical-taxonomy";

async function main() {
  await assertDisposableTestInfrastructure({ operation: "canonical-vertical-storage-certification" });
  const { pool } = await import("../../server/db");
  const { storage } = await import("../../server/storage");
  let checks = 0;
  try {
    const fixtures: Array<{ id: number; target: string | null; raw: string | null }> = [];
    for (const [index, [target, aliases]] of Object.entries(CONTACT_VERTICAL_ALIASES).entries()) {
      const raw = aliases.find(value => value !== target) ?? target;
      assert.equal(resolveContactTargetVertical(raw), target);
      const row = (await pool.query(`INSERT INTO contacts
        (first_name,last_name,email,phone,company_name,vertical,email_status,record_class)
        VALUES ('Canonical','Fixture',$1,'',$2,$3,'valid','production') RETURNING id`,
        [`canonical_${index}@example.invalid`, `Canonical Fixture ${index}`, raw])).rows[0];
      fixtures.push({ id: row.id, target, raw });
    }
    for (const [index, raw] of ["unrecognized trade fixture", null].entries()) {
      const row = (await pool.query(`INSERT INTO contacts
        (first_name,last_name,email,phone,company_name,vertical,email_status,record_class)
        VALUES ('Canonical','Fixture',$1,'',$2,$3,'valid','production') RETURNING id`,
        [`canonical_unknown_${index}@example.invalid`, `Canonical Unknown Fixture ${index}`, raw])).rows[0];
      fixtures.push({ id: row.id, target: null, raw });
    }
    const counts = await storage.getContactVerticalCounts();
    assert.equal(counts.reduce((sum, row) => sum + row.count, 0), fixtures.length);
    checks++;
    for (const fixture of fixtures) {
      const detail = await storage.getContact(fixture.id) as any;
      assert.equal(detail.vertical, fixture.target);
      assert.equal(detail.rawVertical, fixture.raw);
      checks += 2;
      if (fixture.target) {
        assert.equal(counts.find(row => row.vertical === fixture.target)?.count, 1);
        const list = await storage.getContactsByVertical(fixture.target);
        assert.deepEqual(list.map(row => row.id), [fixture.id]);
        assert.equal(list[0].vertical, fixture.target);
        const aliasList = await storage.getContactsByVertical(fixture.raw!);
        assert.deepEqual(aliasList.map(row => row.id), [fixture.id]);
        const audience = await storage.getContactsForCampaignAudience({ verticals: [fixture.target] });
        const audienceCount = await storage.countContactsForCampaignAudience({ verticals: [fixture.target] });
        assert.equal(audienceCount, audience.length);
        assert.deepEqual(audience.map(row => row.id), [fixture.id]);
        assert.equal(audience[0].vertical, fixture.target);
        checks += 7;
      }
    }
    assert.equal(counts.find(row => row.vertical === "unresolved")?.count, 1);
    assert.equal(counts.find(row => row.vertical === "missing")?.count, 1);
    assert.deepEqual(await storage.getContactsByVertical("unrecognized trade fixture"), []);
    checks += 3;
    const result = { observedAt: new Date().toISOString(), checks, fixtures: fixtures.length,
      scope: "Actual legacy storage readers: alias projection, detail, counts, audience count/filter/list parity",
      productionExecution: false, completeTaskCertification: false };
    fs.writeFileSync("docs/certification/canonical-enrichment-vertical-storage.json", JSON.stringify(result, null, 2) + "\n");
    console.log(JSON.stringify(result));
  } finally { await pool.end(); }
}
main().catch(error => {
  console.error("Canonical storage certification failed:", String(error.message).split("\n")[0]);
  console.error(error.stack?.split("\n").filter((line: string) => line.trim().startsWith("at ")).join("\n"));
  process.exitCode = 1;
});