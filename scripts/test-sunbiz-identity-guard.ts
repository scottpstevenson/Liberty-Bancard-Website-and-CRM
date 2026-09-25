#!/usr/bin/env tsx
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { runSunbizBootstrapBatch } from "../server/services/sunbiz-bootstrap";

const RUN = `identity-${Date.now()}`;
const PREFIX = `task2002-${RUN}-`;
const entityIds: number[] = [];
const businessIds: number[] = [];
let failures = 0;

function check(label: string, value: boolean) {
  console.log(`${value ? "✓" : "✗"} ${label}`);
  if (!value) failures++;
}

async function main() {
  for (const [suffix, name, city, state] of [
    ["bad", "Completely Different Plumbing LLC", "Tampa", "FL"],
    ["good", "Blue Harbor Dental Group", "Miami", "FL"],
  ]) {
    const domain = `${suffix}-${RUN}.example.com`;
    const business = (await db.execute(sql`
      INSERT INTO businesses (canonical_name, normalized_name, website_domain, city, state, record_class)
      VALUES (${suffix === "bad" ? "Quantum Aerospace Labs" : "Blue Harbor Dental"}, 
              ${suffix === "bad" ? "quantum aerospace labs" : "blue harbor dental"},
              ${domain}, ${suffix === "bad" ? "Seattle" : "Miami"},
              ${suffix === "bad" ? "WA" : "FL"}, 'canonical')
      RETURNING id
    `)).rows as any[];
    const businessId = Number(business[0].id);
    businessIds.push(businessId);
    const entity = (await db.execute(sql`
      INSERT INTO sunbiz_entities
        (filing_number, entity_name, score, enrichment_status, website, principal_city, principal_state, source)
      VALUES (${PREFIX + suffix}, ${name}, 'hot', 'enriched', ${`https://${domain}`}, ${city}, ${state}, 'sunbiz')
      RETURNING id
    `)).rows as any[];
    entityIds.push(Number(entity[0].id));
  }

  const results = await runSunbizBootstrapBatch(25, { filingNumberLike: `${PREFIX}%` });
  const byFiling = new Map(results.map((result) => [result.filingNumber, result]));
  check("domain-only match with conflicting name and location requires identity review",
    byFiling.get(`${PREFIX}bad`)?.outcome === "identity_review");
  check("domain match with compatible name and location still matches",
    byFiling.get(`${PREFIX}good`)?.outcome === "matched_existing");
  const reviewClaim = (await db.execute(sql`
    SELECT status, deferred_reason_code FROM sunbiz_bootstrap_claims WHERE filing_number = ${PREFIX + "bad"}
  `)).rows as any[];
  check("identity review is represented as deferred collision with explicit reason",
    reviewClaim[0]?.status === "deferred_collision" &&
    reviewClaim[0]?.deferred_reason_code === "identity_review_required");
}

async function cleanup() {
  await db.execute(sql`DELETE FROM canonical_source_links WHERE stable_key LIKE ${PREFIX + "%"}`).catch(() => {});
  await db.execute(sql`DELETE FROM sunbiz_bootstrap_ledger_events WHERE filing_number LIKE ${PREFIX + "%"}`).catch(() => {});
  await db.execute(sql`DELETE FROM sunbiz_bootstrap_claims WHERE filing_number LIKE ${PREFIX + "%"}`);
  if (entityIds.length) await db.execute(sql`DELETE FROM sunbiz_entities WHERE id = ANY(${sql.raw(`ARRAY[${entityIds.join(",")}]::int[]`)})`);
  if (businessIds.length) await db.execute(sql`DELETE FROM businesses WHERE id = ANY(${sql.raw(`ARRAY[${businessIds.join(",")}]::int[]`)})`);
}

main().catch((error) => { console.error(error); failures++; }).finally(async () => {
  await cleanup().catch((error) => { console.error(error); failures++; });
  console.log(`[test-sunbiz-identity-guard] ${failures ? "FAILED" : "PASSED"}`);
  if (failures) process.exitCode = 1;
});