#!/usr/bin/env tsx
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { filterSunbizEntitiesOwnedByBootstrap, getSunbizCronFeatureFlags } from "../server/services/sunbiz-cron";
import { runSunbizBootstrapBatch } from "../server/services/sunbiz-bootstrap";

const RUN = `interlock-${Date.now()}`;
const PREFIX = `task2002-${RUN}-`;
const entityIds: number[] = [];
let prospectId: number | null = null;
let contactId: number | null = null;
let failed = false;

function check(label: string, value: boolean) {
  console.log(`${value ? "✓" : "✗"} ${label}`);
  if (!value) failed = true;
}

async function main() {
  const originalLegacy = process.env.SUNBIZ_LEGACY_PROMOTION_ENABLED;
  const originalMaterialization = process.env.SUNBIZ_MATERIALIZATION_ENABLED;
  const actualFlags = getSunbizCronFeatureFlags();
  console.log(`[test-sunbiz-legacy-interlock] actual SUNBIZ_LEGACY_PROMOTION_ENABLED=${String(originalLegacy)}; SUNBIZ_MATERIALIZATION_ENABLED=${String(originalMaterialization)}`);
  check("legacy gate reflects the actual live environment value",
    actualFlags.legacyPromotionEnabled === (originalLegacy !== "false"));
  check("materialization gate reflects the actual live environment value",
    actualFlags.materializationEnabled === (originalMaterialization === "true"));
  try {
    process.env.SUNBIZ_LEGACY_PROMOTION_ENABLED = "false";
    process.env.SUNBIZ_MATERIALIZATION_ENABLED = "true";
    const controlled = getSunbizCronFeatureFlags();
    check("controlled process env override exercises both gate directions",
      !controlled.legacyPromotionEnabled && controlled.materializationEnabled);
  } finally {
    if (originalLegacy === undefined) delete process.env.SUNBIZ_LEGACY_PROMOTION_ENABLED;
    else process.env.SUNBIZ_LEGACY_PROMOTION_ENABLED = originalLegacy;
    if (originalMaterialization === undefined) delete process.env.SUNBIZ_MATERIALIZATION_ENABLED;
    else process.env.SUNBIZ_MATERIALIZATION_ENABLED = originalMaterialization;
  }

  const legacyContact = (await db.execute(sql`
    INSERT INTO contacts (first_name, last_name, email, phone, company_name)
    VALUES ('Fixture', 'Contact', ${`${RUN}@example.invalid`}, '5550000199', 'Legacy Interlock Fixture')
    RETURNING id
  `)).rows as any[];
  contactId = Number(legacyContact[0].id);
  const legacyProspect = (await db.execute(sql`
    INSERT INTO prospects (company_name, contact_id, status)
    VALUES ('Legacy Interlock Fixture', ${contactId}, 'converted')
    RETURNING id
  `)).rows as any[];
  prospectId = Number(legacyProspect[0].id);
  const claimed = (await db.execute(sql`
    INSERT INTO sunbiz_entities (filing_number, entity_name, score, website, source)
    VALUES (${PREFIX + "claimed"}, 'New Engine In Flight LLC', 'hot', ${`https://${RUN}.one.example.com`}, 'sunbiz')
    RETURNING id
  `)).rows as any[];
  entityIds.push(Number(claimed[0].id));
  await db.execute(sql`
    INSERT INTO sunbiz_bootstrap_claims (filing_number, sunbiz_entity_id, status)
    VALUES (${PREFIX + "claimed"}, ${entityIds[0]}, 'claimed')
  `);
  const passedLegacy = await filterSunbizEntitiesOwnedByBootstrap([
    { filingNumber: PREFIX + "claimed" },
  ]);
  check("legacy candidate filtering skips a filing actively claimed by the new engine",
    passedLegacy.length === 0);

  const promoted = (await db.execute(sql`
    INSERT INTO sunbiz_entities (filing_number, entity_name, score, website, source, prospect_id)
    VALUES (${PREFIX + "legacy"}, 'Previously Promoted Fixture LLC', 'hot',
      ${`https://${RUN}.two.example.com`}, 'sunbiz', ${prospectId})
    RETURNING id
  `)).rows as any[];
  entityIds.push(Number(promoted[0].id));
  const engineResults = await runSunbizBootstrapBatch(25, { filingNumberLike: `${PREFIX}legacy%` });
  const claim = (await db.execute(sql`
    SELECT status, deferred_reason_code FROM sunbiz_bootstrap_claims WHERE filing_number = ${PREFIX + "legacy"}
  `)).rows as any[];
  const entityBusinessLinks = (await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM canonical_source_links
    WHERE source_system = 'sunbiz' AND source_type = 'sunbiz_entity' AND stable_key = ${PREFIX + "legacy"}
  `)).rows as any[];
  const legacyContactBacklink = (await db.execute(sql`
    SELECT p.contact_id FROM sunbiz_entities se JOIN prospects p ON p.id = se.prospect_id
    WHERE se.filing_number = ${PREFIX + "legacy"}
  `)).rows as any[];
  check("legacy-promoted filing is deferred rather than duplicated",
    engineResults[0]?.outcome === "deferred_collision" &&
    claim[0]?.status === "deferred_collision" &&
    claim[0]?.deferred_reason_code === "legacy_sunbiz_promotion_exists" &&
    Number(legacyContactBacklink[0]?.contact_id) === contactId &&
    claim[0]?.business_id == null &&
    Number(entityBusinessLinks[0]?.n) === 0);
}

async function cleanup() {
  await db.execute(sql`DELETE FROM canonical_source_links WHERE stable_key LIKE ${PREFIX + "%"}`).catch(() => {});
  await db.execute(sql`DELETE FROM sunbiz_bootstrap_ledger_events WHERE filing_number LIKE ${PREFIX + "%"}`).catch(() => {});
  await db.execute(sql`DELETE FROM sunbiz_bootstrap_claims WHERE filing_number LIKE ${PREFIX + "%"}`);
  if (entityIds.length) await db.execute(sql`DELETE FROM sunbiz_entities WHERE id = ANY(${sql.raw(`ARRAY[${entityIds.join(",")}]::int[]`)})`);
  if (prospectId != null) await db.execute(sql`DELETE FROM prospects WHERE id = ${prospectId}`);
  if (contactId != null) await db.execute(sql`DELETE FROM contacts WHERE id = ${contactId}`);
}

main().catch((error) => { console.error(error); failed = true; }).finally(async () => {
  await cleanup().catch((error) => { console.error(error); failed = true; });
  console.log(`[test-sunbiz-legacy-interlock] ${failed ? "FAILED" : "PASSED"}`);
  if (failed) process.exitCode = 1;
});