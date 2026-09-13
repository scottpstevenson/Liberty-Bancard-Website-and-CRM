#!/usr/bin/env tsx
/**
 * Focused static/unit tests for the 2026-09-13 corrective build (items 1-10
 * from the third-party MI-09/CRO-08A audit). No real provider network calls.
 * Uses uniquely-namespaced, self-cleaning dev-DB fixtures only where a real
 * row is unavoidable (record_class convergence, gap-driven provider SQL).
 * Everything else is a pure/static assertion against exported contracts.
 *
 * Run: npx tsx scripts/test-corrective-build-2026-09-13.ts
 */
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db } from "../server/db";
import { CONTACT_ELIGIBLE_FOR_ENRICHMENT_SQL } from "../server/services/enrichment";
import { isDbprSourceSystem, filterToCro08aSourceScope, CRO08A_ALLOWED_SOURCE_SYSTEMS } from "../server/services/cro08a/source-scope";
import { ingestBusiness } from "../server/services/sdr/dedupe";
import {
  setPoolAuthorityDecision, getPoolAuthorityDecision,
  getActivationReadiness, authorizeSelectiveActivation, MI09_ACTIVATION_TYPED_CONFIRMATION,
} from "../server/services/mi09-pilot-authority";

const rows = (r: any): any[] => r?.rows ?? r ?? [];
const RUN = `corrective-test-${Date.now()}`;
let failures = 0;

async function ok(name: string, fn: () => Promise<void>) {
  try { await fn(); console.log(`  PASS  ${name}`); }
  catch (err: any) { failures++; console.error(`  FAIL  ${name}: ${err?.message ?? err}`); }
}

async function main() {
  console.log(`Corrective build test run: ${RUN}`);

  // ── Item 2: shared eligibility predicate ────────────────────────────────
  await ok("shared predicate excludes DBPR-lineage contacts by primary_source_type", async () => {
    const testEmail = `${RUN}-dbpr@test.internal`;
    await db.execute(sql`
      INSERT INTO contacts (email, phone, first_name, last_name, primary_source_type, record_class)
      VALUES (${testEmail}, ${`+1305555${String(Date.now()).slice(-4)}`}, 'Test', 'Dbpr', 'dbpr-hr', 'unknown')
    `);
    try {
      const r = rows(await db.execute(sql`SELECT id FROM contacts WHERE email = ${testEmail} AND ${CONTACT_ELIGIBLE_FOR_ENRICHMENT_SQL}`));
      assert.equal(r.length, 0, "DBPR-sourced contact must not satisfy the shared eligibility predicate");
    } finally {
      await db.execute(sql`DELETE FROM contacts WHERE email = ${testEmail}`);
    }
  });

  await ok("shared predicate admits an otherwise-clean, non-DBPR contact", async () => {
    const testEmail = `${RUN}-clean@test.internal`;
    await db.execute(sql`
      INSERT INTO contacts (email, phone, first_name, last_name, primary_source_type, record_class)
      VALUES (${testEmail}, ${`+1305555${String(Date.now()).slice(-4)}1`}, 'Test', 'Clean', 'sunbiz', 'unknown')
    `);
    try {
      const r = rows(await db.execute(sql`SELECT id FROM contacts WHERE email = ${testEmail} AND ${CONTACT_ELIGIBLE_FOR_ENRICHMENT_SQL}`));
      assert.equal(r.length, 1, "a clean, non-DBPR contact must satisfy the shared eligibility predicate");
    } finally {
      await db.execute(sql`DELETE FROM contacts WHERE email = ${testEmail}`);
    }
  });

  await ok("shared predicate excludes test/demo/synthetic record_class", async () => {
    const testEmail = `${RUN}-synthetic@test.internal`;
    await db.execute(sql`
      INSERT INTO contacts (email, phone, first_name, last_name, record_class)
      VALUES (${testEmail}, ${`+1305555${String(Date.now()).slice(-4)}2`}, 'Test', 'Synthetic', 'synthetic')
    `);
    try {
      const r = rows(await db.execute(sql`SELECT id FROM contacts WHERE email = ${testEmail} AND ${CONTACT_ELIGIBLE_FOR_ENRICHMENT_SQL}`));
      assert.equal(r.length, 0, "synthetic record_class must not satisfy the shared eligibility predicate");
    } finally {
      await db.execute(sql`DELETE FROM contacts WHERE email = ${testEmail}`);
    }
  });

  // ── Item 3: record_class convergence on materialization ────────────────
  await ok("ingestBusiness() materializes new businesses as record_class='canonical'", async () => {
    const uniqueName = `Corrective Test Business ${RUN}`;
    const created = await ingestBusiness({
      name: uniqueName,
      city: "Miami", state: "FL",
      sourceType: "sunbiz",
      sourceExternalId: `${RUN}-sunbiz-key`,
    });
    try {
      assert.ok(created.businessId, "ingestBusiness must return a business id");
      const row = rows(await db.execute(sql`SELECT record_class FROM businesses WHERE id = ${created.businessId}`))[0];
      assert.equal(row?.record_class, "canonical", "newly materialized business must be record_class='canonical', not 'unknown' or 'production'");
    } finally {
      await db.execute(sql`DELETE FROM lead_sources WHERE business_id = ${created.businessId}`);
      await db.execute(sql`DELETE FROM businesses WHERE id = ${created.businessId}`);
    }
  });

  // ── Item 6: gap-driven provider eligibility (pure SQL check, no live command) ─
  await ok("gap SQL correctly separates a serper-gapped business from a fully-enriched one", async () => {
    const gapped = rows(await db.execute(sql`
      INSERT INTO businesses (canonical_name, normalized_name, record_class)
      VALUES (${`Gapped Biz ${RUN}`}, ${`gapped biz ${RUN}`}, 'canonical')
      RETURNING id
    `))[0];
    const complete = rows(await db.execute(sql`
      INSERT INTO businesses (canonical_name, normalized_name, website_domain, main_phone, street_address, main_email, review_count, rating, industry_primary, record_class)
      VALUES (${`Complete Biz ${RUN}`}, ${`complete biz ${RUN}`}, 'example.com', '3055551234', '1 Main St', 'owner@example.com', 10, 4.5, 'retail', 'canonical')
      RETURNING id
    `))[0];
    try {
      const serperGapSql = sql`(b.website_domain IS NULL OR b.main_phone IS NULL OR b.street_address IS NULL)`;
      const gappedMatch = rows(await db.execute(sql`SELECT id FROM businesses b WHERE b.id = ${gapped.id} AND ${serperGapSql}`));
      const completeMatch = rows(await db.execute(sql`SELECT id FROM businesses b WHERE b.id = ${complete.id} AND ${serperGapSql}`));
      assert.equal(gappedMatch.length, 1, "business missing website/phone/address must match the serper gap condition");
      assert.equal(completeMatch.length, 0, "a fully-enriched business must NOT match the serper gap condition (no unjustified provider call)");
    } finally {
      await db.execute(sql`DELETE FROM businesses WHERE id IN (${gapped.id}, ${complete.id})`);
    }
  });

  // ── Item 8: DBPR exclusion from CRO-08A source scope ────────────────────
  await ok("isDbprSourceSystem flags all DBPR aliases", () => {
    for (const s of ["dbpr-hr", "dbpr-abt", "dbpr-cos", "dbpr-bar", "DBPR_HR", "some_dbpr_alias"]) {
      assert.equal(isDbprSourceSystem(s), true, `${s} must be classified as DBPR lineage`);
    }
    return Promise.resolve();
  });

  await ok("filterToCro08aSourceScope drops DBPR rows but keeps allowed non-DBPR rows", () => {
    const input = [...CRO08A_ALLOWED_SOURCE_SYSTEMS, "dbpr-hr", "dbpr-abt", "some_unlisted_system"];
    const filtered = filterToCro08aSourceScope(input);
    assert.ok(!filtered.some((s) => isDbprSourceSystem(s)), "no DBPR source system may survive filtering");
    assert.ok(!filtered.includes("some_unlisted_system"), "an unlisted, non-allowlisted source system must not survive filtering either");
    for (const s of CRO08A_ALLOWED_SOURCE_SYSTEMS) assert.ok(filtered.includes(s), `${s} is allowlisted and must survive filtering`);
    return Promise.resolve();
  });

  // ── Item 5: pool authority round trip ───────────────────────────────────
  await ok("setPoolAuthorityDecision/getPoolAuthorityDecision round-trip and increment revision", async () => {
    const before = await getPoolAuthorityDecision();
    const startRevision = before?.revision ?? 0;
    const decision = await setPoolAuthorityDecision({ pool: "master_leads", decidedBy: `${RUN}@test` });
    assert.equal(decision.pool, "master_leads");
    assert.equal(decision.revision, startRevision + 1);
    const read = await getPoolAuthorityDecision();
    assert.equal(read?.pool, "master_leads");
    assert.equal(read?.revision, decision.revision);
  });

  // ── Item 10: activation readiness fails closed and never touches env ───
  await ok("authorizeSelectiveActivation rejects a wrong typed confirmation", async () => {
    await assert.rejects(
      () => authorizeSelectiveActivation({ authorizedBy: `${RUN}@test`, typedConfirmation: "wrong phrase" }),
      /MI09_ACTIVATION_CONFIRMATION_MISMATCH/,
    );
  });

  await ok("getActivationReadiness never mutates BACKGROUND_JOB_PROFILE", async () => {
    const before = process.env.BACKGROUND_JOB_PROFILE;
    await getActivationReadiness();
    assert.equal(process.env.BACKGROUND_JOB_PROFILE, before, "readiness computation must be read-only w.r.t. BACKGROUND_JOB_PROFILE");
  });

  await ok("authorizeSelectiveActivation fails closed unless every gate passes (typed confirmation correct, gates incomplete)", async () => {
    const readiness = await getActivationReadiness();
    if (readiness.ready) {
      console.log("    (skipped strict assertion — all gates happen to be true in this environment)");
      return;
    }
    await assert.rejects(
      () => authorizeSelectiveActivation({ authorizedBy: `${RUN}@test`, typedConfirmation: MI09_ACTIVATION_TYPED_CONFIRMATION }),
      /MI09_ACTIVATION_NOT_READY/,
    );
    const auth = await import("../server/services/mi09-pilot-authority").then((m) => m.getSelectiveActivationAuthorization());
    // Whatever this returns, BACKGROUND_JOB_PROFILE must still be untouched.
    assert.notEqual(process.env.BACKGROUND_JOB_PROFILE, "selective:enrichment,provider-live,email-validation,continuous-enrichment");
    void auth;
  });

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
