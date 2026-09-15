#!/usr/bin/env tsx
/**
 * Task #1956 step 9 tests — Master Lead Database import/backfill correction.
 *
 * Covers the "Required tests" bullet for step 9:
 *  - DBPR exclusion (backfill via contacts.business_id lineage; import via
 *    businesses.website_domain lineage)
 *  - Quarantine of insufficiently-identified rows (no email AND no phone)
 *  - Pre-existing DNC/opt-out/unsubscribe/hard-bounce/existing-customer
 *    checks are untouched
 *  - Zero network calls occur during import/backfill (both are pure SQL —
 *    asserted by monkey-patching global.fetch to fail loudly if called)
 *
 * Uses uniquely-namespaced, self-cleaning dev-DB fixtures only.
 * Run: npx tsx scripts/test-master-lead-import-backfill-dbpr.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "../server/db";
import { runMasterLeadBackfill } from "../server/services/master-lead-backfill";
import { processMasterLeadBatch } from "../server/services/master-lead-import";

const rows = (r: any): any[] => r?.rows ?? r ?? [];
const RUN = `mlimport-test-${Date.now()}`;
let failures = 0;

async function ok(name: string, fn: () => Promise<void>) {
  try { await fn(); console.log(`  PASS  ${name}`); }
  catch (err: any) { failures++; console.error(`  FAIL  ${name}: ${err?.message ?? err}`); }
}

const toIntArraySql = (arr: number[]) =>
  arr.length === 0 ? sql`ARRAY[]::int[]` : sql`ARRAY[${sql.join(arr.map((v) => sql`${v}`), sql`, `)}]::int[]`;

async function makeBusiness(suffix: string, opts: { websiteDomain?: string } = {}): Promise<number> {
  const name = `${RUN}-${suffix}`;
  const r = rows(await db.execute(sql`
    INSERT INTO businesses (canonical_name, normalized_name, website_domain, status, record_class)
    VALUES (${name}, ${name.toLowerCase()}, ${opts.websiteDomain ?? null}, 'new', 'unknown')
    RETURNING id
  `));
  return Number(r[0].id);
}

async function makeDbprSourceLink(businessId: number): Promise<void> {
  await db.execute(sql`
    INSERT INTO canonical_source_links (business_id, source_system, source_type, stable_key)
    VALUES (${businessId}, 'dbpr_hr', 'restaurant', ${`${RUN}-${businessId}-key`})
  `);
}

async function makeContact(suffix: string, fields: Record<string, any> = {}): Promise<number> {
  const email = fields.email !== undefined ? fields.email : `${RUN}-${suffix}@test.internal`;
  const phone = fields.phone !== undefined ? fields.phone : `+1305555${String(Date.now()).slice(-4)}`;
  // Each fixture needs its OWN domain — the backfill's extractDomain() falls
  // back to the email's host part, and every test email shares the literal
  // "test.internal" host, which would otherwise collide on the backfill's
  // domain-dedupe set across fixtures. A unique website per contact avoids
  // that false collision.
  const website = fields.website !== undefined ? fields.website : `https://${RUN}-${suffix.toLowerCase()}.example.test`;
  const r = rows(await db.execute(sql`
    INSERT INTO contacts (
      first_name, last_name, email, phone, website, business_id, lead_source, source_category,
      do_not_contact, existing_merchant_customer, lifecycle_stage,
      opt_out_status, unsubscribe_status, bounce_status
    ) VALUES (
      'Test', ${suffix}, ${email}, ${phone}, ${website}, ${fields.businessId ?? null},
      ${fields.leadSource ?? "csv_import"}, ${fields.sourceCategory ?? null},
      ${fields.doNotContact ?? false}, ${fields.existingMerchantCustomer ?? false}, ${fields.lifecycleStage ?? "new_lead"},
      ${fields.optOutStatus ?? "active"}, ${fields.unsubscribeStatus ?? "active"}, ${fields.bounceStatus ?? "none"}
    ) RETURNING id
  `));
  return Number(r[0].id);
}

async function cleanupContacts(ids: number[]) {
  if (ids.length > 0) await db.execute(sql`DELETE FROM contacts WHERE id = ANY(${toIntArraySql(ids)})`);
}
async function cleanupBusinesses(ids: number[]) {
  if (ids.length > 0) {
    await db.execute(sql`DELETE FROM canonical_source_links WHERE business_id = ANY(${toIntArraySql(ids)})`);
    await db.execute(sql`DELETE FROM businesses WHERE id = ANY(${toIntArraySql(ids)})`);
  }
}
async function cleanupMasterLeads(emails: string[]) {
  for (const e of emails) {
    // Delete referencing "duplicate" rows first (duplicate_of_id FK) before
    // the canonical row they point at, or the canonical row's delete fails.
    await db.execute(sql`DELETE FROM master_leads WHERE duplicate_of_id IN (SELECT id FROM master_leads WHERE LOWER(email) = LOWER(${e}))`);
    await db.execute(sql`DELETE FROM master_leads WHERE LOWER(email) = LOWER(${e})`);
  }
}
async function cleanupMasterLeadsByCompany(companies: string[]) {
  for (const c of companies) {
    await db.execute(sql`DELETE FROM master_leads WHERE duplicate_of_id IN (SELECT id FROM master_leads WHERE LOWER(company) = LOWER(${c}))`);
    await db.execute(sql`DELETE FROM master_leads WHERE LOWER(company) = LOWER(${c})`);
  }
}

async function main() {
  console.log(`Master-lead import/backfill DBPR/quarantine test run: ${RUN}`);

  // ── Zero network calls during import/backfill ─────────────────────────────
  const originalFetch = (global as any).fetch;
  let fetchCalled = false;
  (global as any).fetch = (...args: any[]) => {
    fetchCalled = true;
    throw new Error(`Unexpected network call during import/backfill: ${JSON.stringify(args[0])}`);
  };

  const businessIds: number[] = [];
  const contactIds: number[] = [];
  const masterLeadEmails: string[] = [];
  const masterLeadCompanies: string[] = [];

  try {
    // ── Set up ALL backfill fixtures first, then run the (slow, ~150K-row)
    // backfill scan exactly ONCE and assert on every fixture afterward —
    // the contacts table is large enough that running it per-assertion
    // would multiply an already-slow full scan.
    const dbprBusinessId = await makeBusiness("backfill-dbpr");
    businessIds.push(dbprBusinessId);
    await makeDbprSourceLink(dbprBusinessId);
    const dbprEmail = `${RUN}-backfill-dbpr@test.internal`;
    const dncEmail = `${RUN}-dnc@test.internal`;
    const optOutEmail = `${RUN}-optout@test.internal`;
    const unsubEmail = `${RUN}-unsub@test.internal`;
    const bounceEmail = `${RUN}-bounce@test.internal`;
    const customerEmail = `${RUN}-customer@test.internal`;
    masterLeadEmails.push(dbprEmail, dncEmail, optOutEmail, unsubEmail, bounceEmail, customerEmail);

    contactIds.push(
      await makeContact("BackfillDbpr", { businessId: dbprBusinessId, email: dbprEmail }),
      await makeContact("Dnc", { email: dncEmail, doNotContact: true }),
      await makeContact("OptOut", { email: optOutEmail, optOutStatus: "opted_out" }),
      await makeContact("Unsub", { email: unsubEmail, unsubscribeStatus: "unsubscribed" }),
      await makeContact("Bounce", { email: bounceEmail, bounceStatus: "hard" }),
      await makeContact("Customer", { email: customerEmail, existingMerchantCustomer: true }),
      await makeContact("Insufficient", { email: "", phone: "123" }),
    );

    console.log("  (running full master-lead backfill scan once — this can take a couple minutes on a large contacts table)");
    await runMasterLeadBackfill();

    await ok("backfill: DBPR-lineage contact quarantined via suppressed/dbpr_lineage", async () => {
      const r = rows(await db.execute(sql`SELECT status, suppression_reason FROM master_leads WHERE LOWER(email) = LOWER(${dbprEmail})`));
      assert.equal(r.length, 1, "expected exactly one master_leads row for the DBPR-lineage contact");
      assert.equal(r[0].status, "suppressed");
      assert.equal(r[0].suppression_reason, "dbpr_lineage");
    });

    await ok("backfill: pre-existing suppression checks (DNC, opt-out, unsubscribed, hard-bounce, existing-customer) still work", async () => {
      const check = async (email: string, expectedStatus: string, expectedReason: string) => {
        const r = rows(await db.execute(sql`SELECT status, suppression_reason FROM master_leads WHERE LOWER(email) = LOWER(${email})`));
        assert.equal(r.length, 1, `expected exactly one master_leads row for ${email}`);
        assert.equal(r[0].status, expectedStatus, `${email} status`);
        assert.equal(r[0].suppression_reason, expectedReason, `${email} suppression_reason`);
      };
      await check(dncEmail, "suppressed", "do_not_contact");
      await check(optOutEmail, "suppressed", "opt_out");
      await check(unsubEmail, "unsubscribed", "unsubscribed");
      await check(bounceEmail, "bounced", "hard_bounce");
      await check(customerEmail, "client_customer", "existing_merchant_customer");
    });

    await ok("backfill: contact with neither valid email nor valid phone is quarantined", async () => {
      const r = rows(await db.execute(sql`
        SELECT status, suppression_reason FROM master_leads
        WHERE contact_name = 'Test Insufficient' AND created_at > NOW() - INTERVAL '10 minutes'
        ORDER BY created_at DESC LIMIT 1
      `));
      assert.equal(r.length, 1, "expected a master_leads row for the insufficiently-identified contact");
      assert.equal(r[0].status, "quarantined");
      assert.equal(r[0].suppression_reason, "insufficient_identifiers");
    });

    // ── Import: DBPR-lineage business (matched by domain) is quarantined ────
    await ok("import: sheet row matching a DBPR-lineage business domain is quarantined", async () => {
      const domain = `${RUN}-dbpr-import.example.com`;
      const businessId = await makeBusiness("import-dbpr", { websiteDomain: domain });
      businessIds.push(businessId);
      await makeDbprSourceLink(businessId);

      const company = `${RUN} Import Dbpr Co`;
      masterLeadCompanies.push(company);
      const batchId = randomUUID();
      await db.execute(sql`
        INSERT INTO master_lead_batches (id, batch_name, source_method, status, imported_by)
        VALUES (${batchId}::uuid, 'test batch', 'sheet', 'processing', 'test')
      `);
      const result = await processMasterLeadBatch(batchId, [
        { company, domain, email: `${RUN}-import-dbpr@test.internal` },
      ], { sheetId: "test-sheet" });
      masterLeadEmails.push(`${RUN}-import-dbpr@test.internal`);

      assert.equal(result.suppressedCount, 1, "DBPR-domain row must be counted as suppressed/quarantined");
      const r = rows(await db.execute(sql`SELECT status, suppression_reason FROM master_leads WHERE import_batch_id = ${batchId}::uuid`));
      assert.equal(r.length, 1);
      assert.equal(r[0].status, "quarantined");
      assert.equal(r[0].suppression_reason, "dbpr_lineage");
    });

    // ── Import: insufficiently-identified sheet row (domain/company only) is quarantined ──
    await ok("import: sheet row with only company/domain (no email, no phone) is quarantined", async () => {
      const company = `${RUN} No Identifiers Co`;
      masterLeadCompanies.push(company);
      const batchId = randomUUID();
      await db.execute(sql`
        INSERT INTO master_lead_batches (id, batch_name, source_method, status, imported_by)
        VALUES (${batchId}::uuid, 'test batch', 'sheet', 'processing', 'test')
      `);
      const result = await processMasterLeadBatch(batchId, [
        { company },
      ], { sheetId: "test-sheet" });

      assert.equal(result.suppressedCount, 1);
      const r = rows(await db.execute(sql`SELECT status, suppression_reason FROM master_leads WHERE import_batch_id = ${batchId}::uuid`));
      assert.equal(r.length, 1);
      assert.equal(r[0].status, "quarantined");
      assert.equal(r[0].suppression_reason, "insufficient_identifiers");
    });

    // ── Import: within-batch duplicate prevention still works alongside the new checks ──
    await ok("import: within-batch duplicate rows are still deduped (unaffected by DBPR/quarantine checks)", async () => {
      const company = `${RUN} Dup Co`;
      masterLeadCompanies.push(company);
      const email = `${RUN}-dup@test.internal`;
      masterLeadEmails.push(email);
      const batchId = randomUUID();
      await db.execute(sql`
        INSERT INTO master_lead_batches (id, batch_name, source_method, status, imported_by)
        VALUES (${batchId}::uuid, 'test batch', 'sheet', 'processing', 'test')
      `);
      const result = await processMasterLeadBatch(batchId, [
        { company, email },
        { company, email },
      ], { sheetId: "test-sheet" });

      assert.equal(result.stagedCount, 1);
      assert.equal(result.duplicateCount, 1);
    });

    assert.equal(fetchCalled, false, "import/backfill must never make a network call");
  } finally {
    (global as any).fetch = originalFetch;
    await cleanupMasterLeads(masterLeadEmails);
    await cleanupMasterLeadsByCompany(masterLeadCompanies);
    await cleanupContacts(contactIds);
    await cleanupBusinesses(businessIds);
    await db.execute(sql`DELETE FROM master_leads WHERE import_batch_id IN (SELECT id FROM master_lead_batches WHERE batch_name = 'test batch')`);
    await db.execute(sql`DELETE FROM master_lead_batches WHERE batch_name = 'test batch'`);
  }

  console.log(failures === 0 ? "\n✓ All master-lead import/backfill DBPR/quarantine tests passed." : `\n✗ ${failures} test(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
