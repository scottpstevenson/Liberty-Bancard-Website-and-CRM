import assert from "node:assert/strict";
import { pool } from "../server/db";
import { effectiveContactVerticalSql } from "../shared/effective-vertical";
import { relationshipReasonsSql } from "../shared/relationship-evidence-sql";
import { syntheticQaIdentitySql } from "../shared/synthetic-qa-identity";
import { CONTACT_LINK_COVERAGE_BATCH_SQL } from "../server/services/contact-link-coverage-query";
import { readPeopleFacets, readRevenueLeads } from "../server/services/revenue-read-authority";

const mode = process.argv.includes("--database") ? "database" : "mock";
try {
  for (const query of [effectiveContactVerticalSql("c"), CONTACT_LINK_COVERAGE_BATCH_SQL]) {
    assert.doesNotMatch(query, /\bcrm_(automatic_relationship_reasons|identity_name|identity_domain)\s*\(/,
      "read-only screens must compile when migration-only functions are absent");
  }
  if (mode === "database") {
    // Read-only comparison against the installed development authority. Includes
    // absent subjects/sources and actual source pairs; never changes records.
    const expression = relationshipReasonsSql("pairs.cid", "pairs.bid", "pairs.sid", "pairs.eid");
    const { rows } = await pool.query(`
      WITH pairs AS MATERIALIZED (
        SELECT c.id cid,b.id bid,sl.id sid,se.id eid
        FROM contacts c JOIN businesses b ON b.id=c.business_id
        JOIN canonical_source_links sl ON sl.business_id=b.id
        LEFT JOIN sunbiz_entities se ON sl.source_system='sunbiz'
          AND sl.source_type='sunbiz_entity' AND se.filing_number=sl.stable_key
          AND se.source IN ('sunbiz','cordata','corevt')
        LIMIT 20
      ), probes AS (
        SELECT ${expression} inline,crm_automatic_relationship_reasons(cid,bid,sid,eid) native FROM pairs
        UNION ALL SELECT ${relationshipReasonsSql("0","0","NULL","NULL")},
          crm_automatic_relationship_reasons(0,0,NULL,NULL)
        UNION ALL SELECT ${relationshipReasonsSql("(SELECT min(id) FROM contacts)","0","NULL","NULL")},
          crm_automatic_relationship_reasons((SELECT min(id) FROM contacts),0,NULL,NULL)
      ) SELECT inline,native FROM probes`);
    for (const row of rows) assert.deepEqual([...row.inline].sort(), [...row.native].sort());
    console.log(`PASS: ${rows.length} native/read-only evaluator parity probes`);
  } else {
    const originalQuery = pool.query;
    let leadCountQueries = 0;
    (pool as any).query = async (query: string) => {
      if (query.includes("jsonb_object_agg")) return { rows: [{
        total: 154012, by_record_class: { production: 154012 },
        by_email_health: {}, as_of: new Date(),
      }] };
      if (query.includes("SELECT COUNT(*)::int AS total")) {
        assert.ok(query.includes(syntheticQaIdentitySql("c")), "legacy synthetic QA records cannot count as revenue leads");
        leadCountQueries++;
        return { rows: [{ total: 1, as_of: new Date() }] };
      }
      if (query.includes("jsonb_build_object('primaryDeal'")) return { rows: [] };
      throw new Error("Unexpected query in isolated cache regression test");
    };
    try {
      const user = { role: "admin", email: "cache-test@example.invalid" };
      const filters = { limit: 50, offset: 0, archived: false, recordClass: "production" };
      assert.equal((await readPeopleFacets(user, filters)).total, 154012);
      assert.equal((await readRevenueLeads(user, filters)).total, 1);
      assert.equal((await readRevenueLeads(user, filters)).total, 1);
      assert.equal(leadCountQueries, 1, "lead totals retain their own cache");
      assert.equal((await readPeopleFacets(user, filters)).total, 154012);
      console.log("PASS: People/Leads cache isolation, both request orders, cached replay");
    } finally { pool.query = originalQuery; }
  }
  console.log("CRM screen regression checks passed; zero provider requests or outbound sends.");
} finally { await pool.end(); }