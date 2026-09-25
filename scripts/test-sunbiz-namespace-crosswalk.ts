#!/usr/bin/env tsx
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { runSunbizBootstrapBatch } from "../server/services/sunbiz-bootstrap";

const RUN = `crosswalk-${Date.now()}`;
const FILING = `task2002-${RUN}`;
let entityId: number | null = null;
let businessId: number | null = null;
let failed = false;

async function main() {
  const business = (await db.execute(sql`
    INSERT INTO businesses (canonical_name, normalized_name, record_class)
    VALUES ('CRO Namespace Crosswalk Fixture', 'cro namespace crosswalk fixture', 'canonical')
    RETURNING id
  `)).rows as any[];
  businessId = Number(business[0].id);
  const entity = (await db.execute(sql`
    INSERT INTO sunbiz_entities
      (filing_number, entity_name, score, enrichment_status, website, source)
    VALUES (${FILING}, 'CRO Namespace Crosswalk Fixture LLC', 'hot', 'enriched',
      ${`https://${RUN}.example.com`}, 'sunbiz')
    RETURNING id
  `)).rows as any[];
  entityId = Number(entity[0].id);
  await db.execute(sql`
    INSERT INTO canonical_source_links (business_id, source_system, source_type, stable_key)
    VALUES (${businessId}, 'sunbiz_entities', 'sunbiz_filing', ${FILING})
  `);

  const results = await runSunbizBootstrapBatch(25, { filingNumberLike: `${FILING}%` });
  const result = results.find((row) => row.filingNumber === FILING);
  const link = (await db.execute(sql`
    SELECT business_id FROM canonical_source_links
    WHERE source_system = 'sunbiz' AND source_type = 'sunbiz_entity' AND stable_key = ${FILING}
  `)).rows as any[];
  const claim = (await db.execute(sql`
    SELECT business_id, status FROM sunbiz_bootstrap_claims WHERE filing_number = ${FILING}
  `)).rows as any[];
  const businesses = (await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM businesses WHERE id = ${businessId}
  `)).rows as any[];
  const passed = result?.outcome === "matched_existing" &&
    Number(result.businessId) === businessId &&
    Number(link[0]?.business_id) === businessId &&
    Number(claim[0]?.business_id) === businessId &&
    claim[0]?.status === "matched_existing" &&
    Number(businesses[0]?.n) === 1;
  console.log(`${passed ? "✓" : "✗"} CRO-03B filing namespace reuses its existing business`);
  if (!passed) failed = true;
}

async function cleanup() {
  await db.execute(sql`DELETE FROM canonical_source_links WHERE stable_key = ${FILING}`).catch(() => {});
  await db.execute(sql`DELETE FROM sunbiz_bootstrap_ledger_events WHERE filing_number = ${FILING}`).catch(() => {});
  await db.execute(sql`DELETE FROM sunbiz_bootstrap_claims WHERE filing_number = ${FILING}`);
  if (entityId != null) await db.execute(sql`DELETE FROM sunbiz_entities WHERE id = ${entityId}`);
  if (businessId != null) await db.execute(sql`DELETE FROM businesses WHERE id = ${businessId}`);
}

main().catch((error) => { console.error(error); failed = true; }).finally(async () => {
  await cleanup().catch((error) => { console.error(error); failed = true; });
  console.log(`[test-sunbiz-namespace-crosswalk] ${failed ? "FAILED" : "PASSED"}`);
  if (failed) process.exitCode = 1;
});