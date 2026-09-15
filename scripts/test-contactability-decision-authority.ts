#!/usr/bin/env tsx
/**
 * Task #1956 step 8 contract test — server/services/contactability.ts's
 * evaluateContactDecisions()/evaluateBusinessEnrichmentEligibility()/
 * evaluateBusinessPromotionEligibility() shared authority.
 *
 * Asserts the four dimensions (data-hygiene, enrichment, promotion, send)
 * return consistent decisions for the same underlying fact pattern —
 * DBPR-family lineage blocks all three non-send dimensions identically,
 * an existing-customer relationship blocks ONLY promotion (not enrichment
 * or data-hygiene), and a clean record is eligible on all three.
 *
 * Uses uniquely-namespaced, self-cleaning dev-DB fixtures (no real provider
 * or network calls). Run: npx tsx scripts/test-contactability-decision-authority.ts
 */
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db } from "../server/db";
import {
  evaluateContactDecisions,
  evaluateBusinessEnrichmentEligibility,
  evaluateBusinessPromotionEligibility,
} from "../server/services/contactability";

const rows = (r: any): any[] => r?.rows ?? r ?? [];
const RUN = `contactability-authority-test-${Date.now()}`;
let failures = 0;

async function ok(name: string, fn: () => Promise<void>) {
  try { await fn(); console.log(`  PASS  ${name}`); }
  catch (err: any) { failures++; console.error(`  FAIL  ${name}: ${err?.message ?? err} | cause: ${err?.cause?.message ?? err?.cause}`); }
}

async function makeBusiness(suffix: string, opts: { status?: string } = {}): Promise<number> {
  const name = `${RUN}-${suffix}`;
  const r = rows(await db.execute(sql`
    INSERT INTO businesses (canonical_name, normalized_name, status, record_class)
    VALUES (${name}, ${name.toLowerCase()}, ${opts.status ?? "new"}, 'unknown')
    RETURNING id
  `));
  return Number(r[0].id);
}

async function makeDbprSourceLink(businessId: number): Promise<void> {
  await db.execute(sql`
    INSERT INTO canonical_source_links (business_id, source_system, source_type, stable_key)
    VALUES (${businessId}, 'dbpr_hr', 'restaurant', ${`${RUN}-key`})
  `);
}

async function makeContact(suffix: string, opts: { businessId?: number | null; doNotContact?: boolean } = {}): Promise<number> {
  const email = `${RUN}-${suffix}@test.internal`;
  const phone = `+1305555${String(Date.now()).slice(-4)}`;
  const r = rows(await db.execute(sql`
    INSERT INTO contacts (first_name, last_name, email, phone, business_id, do_not_contact)
    VALUES ('Test', ${suffix}, ${email}, ${phone}, ${opts.businessId ?? null}, ${opts.doNotContact ?? false})
    RETURNING id
  `));
  return Number(r[0].id);
}

// drizzle-orm's node-postgres driver mis-binds `${arr}::int[]` as a scalar
// tuple, not a Postgres array literal — build a real ARRAY[...] expression
// by hand instead (see memory: drizzle-array-param-bug).
const toIntArraySql = (arr: number[]) =>
  arr.length === 0 ? sql`ARRAY[]::int[]` : sql`ARRAY[${sql.join(arr.map((v) => sql`${v}`), sql`, `)}]::int[]`;

async function cleanup(businessIds: number[], contactIds: number[]) {
  if (contactIds.length > 0) {
    await db.execute(sql`DELETE FROM contacts WHERE id = ANY(${toIntArraySql(contactIds)})`);
  }
  if (businessIds.length > 0) {
    await db.execute(sql`DELETE FROM canonical_source_links WHERE business_id = ANY(${toIntArraySql(businessIds)})`);
    await db.execute(sql`DELETE FROM businesses WHERE id = ANY(${toIntArraySql(businessIds)})`);
  }
}

async function main() {
  console.log(`Contactability decision-authority contract test run: ${RUN}`);

  await ok("DBPR-lineage business blocks data-hygiene, enrichment, AND promotion identically", async () => {
    const businessId = await makeBusiness("dbpr");
    await makeDbprSourceLink(businessId);
    const contactId = await makeContact("dbpr", { businessId });
    try {
      const decisions = await evaluateContactDecisions({ contactId, businessId });
      assert.equal(decisions.dataHygiene.status, "blocked", "data-hygiene must block DBPR lineage");
      assert.equal(decisions.enrichment.status, "blocked", "enrichment must block DBPR lineage");
      assert.equal(decisions.promotion.status, "blocked", "promotion must block DBPR lineage");
      assert.ok(decisions.dataHygiene.reasonCodes.includes("DBPR_LINEAGE"));
      assert.ok(decisions.enrichment.reasonCodes.includes("DBPR_LINEAGE"));
      assert.ok(decisions.promotion.reasonCodes.includes("DBPR_LINEAGE"));

      // Business-level entry points (used pre-contact-creation) must agree.
      const bizEnrichment = await evaluateBusinessEnrichmentEligibility(businessId);
      const bizPromotion = await evaluateBusinessPromotionEligibility(businessId);
      assert.equal(bizEnrichment.status, "blocked");
      assert.equal(bizPromotion.status, "blocked");
    } finally {
      await cleanup([businessId], [contactId]);
    }
  });

  await ok("existing-customer business blocks ONLY promotion, not enrichment or data-hygiene", async () => {
    const businessId = await makeBusiness("customer", { status: "customer" });
    const contactId = await makeContact("customer", { businessId });
    try {
      const decisions = await evaluateContactDecisions({ contactId, businessId });
      assert.equal(decisions.dataHygiene.status, "eligible", "existing-customer must not block data-hygiene");
      assert.equal(decisions.enrichment.status, "eligible", "existing-customer must not block enrichment");
      assert.equal(decisions.promotion.status, "blocked", "existing-customer must block promotion");
      assert.ok(decisions.promotion.reasonCodes.includes("EXISTING_CUSTOMER"));

      const bizPromotion = await evaluateBusinessPromotionEligibility(businessId);
      assert.equal(bizPromotion.status, "blocked");
      assert.ok(bizPromotion.reasonCodes.includes("EXISTING_CUSTOMER"));
      const bizEnrichment = await evaluateBusinessEnrichmentEligibility(businessId);
      assert.equal(bizEnrichment.status, "eligible", "existing-customer must not block business-level enrichment eligibility");
    } finally {
      await cleanup([businessId], [contactId]);
    }
  });

  await ok("do-not-contact blocks data-hygiene, enrichment, AND promotion identically", async () => {
    const contactId = await makeContact("dnc", { doNotContact: true });
    try {
      const decisions = await evaluateContactDecisions({ contactId });
      assert.equal(decisions.dataHygiene.status, "blocked");
      assert.equal(decisions.enrichment.status, "blocked");
      assert.equal(decisions.promotion.status, "blocked");
      for (const dim of [decisions.dataHygiene, decisions.enrichment, decisions.promotion]) {
        assert.ok(dim.reasonCodes.includes("DO_NOT_CONTACT"));
      }
    } finally {
      await cleanup([], [contactId]);
    }
  });

  await ok("a clean, non-DBPR, non-customer contact is eligible on all three non-send dimensions", async () => {
    const businessId = await makeBusiness("clean");
    const contactId = await makeContact("clean", { businessId });
    try {
      const decisions = await evaluateContactDecisions({ contactId, businessId });
      assert.equal(decisions.dataHygiene.status, "eligible");
      assert.equal(decisions.enrichment.status, "eligible");
      assert.equal(decisions.promotion.status, "eligible");
      assert.equal(decisions.send, null, "send decision must be null when no channel is requested");
    } finally {
      await cleanup([businessId], [contactId]);
    }
  });

  await ok("send decision is populated (and independent) only when a channel is supplied", async () => {
    const contactId = await makeContact("send");
    try {
      const decisions = await evaluateContactDecisions({ contactId, channel: "email", mode: "dryRun" });
      assert.ok(decisions.send !== null, "send decision must be populated when channel is supplied");
    } finally {
      await cleanup([], [contactId]);
    }
  });

  console.log(failures === 0 ? "\n✓ All contactability decision-authority contract tests passed." : `\n✗ ${failures} test(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
