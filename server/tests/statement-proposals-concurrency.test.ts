/**
 * Focused concurrency test for statement_proposals unique partial index.
 *
 * Run with:
 *   npx tsx server/tests/statement-proposals-concurrency.test.ts
 *
 * Requires DATABASE_URL to be set. Creates and cleans up its own rows.
 *
 * Proves that concurrent INSERT ... ON CONFLICT upserts for the same deal_id
 * always result in exactly ONE row (not duplicates).
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function countProposalsForDeal(dealId: number): Promise<number> {
  const result = await db.execute(
    sql`SELECT COUNT(*)::text AS cnt FROM statement_proposals WHERE deal_id = ${dealId}`
  );
  const row = result.rows[0] as { cnt: string };
  return parseInt(row.cnt, 10);
}

async function cleanupDeal(dealId: number): Promise<void> {
  await db.execute(sql`DELETE FROM statement_proposals WHERE deal_id = ${dealId}`);
}

/** Performs the same upsert as the upload-chain Step 10. */
async function upsertDraftProposal(dealId: number, merchantName: string): Promise<number> {
  const result = await db.execute(sql`
    INSERT INTO statement_proposals
      (deal_id, contact_id, status, merchant_name, source, statement_file_name, plans, notes, created_at, updated_at)
    VALUES
      (${dealId}, NULL, 'draft', ${merchantName}, NULL, NULL, ${'[]'}::jsonb,
       'Statement received — awaiting AI analysis to populate pricing plans.',
       NOW(), NOW())
    ON CONFLICT (deal_id) WHERE deal_id IS NOT NULL
    DO UPDATE SET
      merchant_name       = CASE WHEN statement_proposals.status IN ('analyzed','failed')
                                 THEN statement_proposals.merchant_name
                                 ELSE EXCLUDED.merchant_name END,
      source              = COALESCE(statement_proposals.source, EXCLUDED.source),
      statement_file_name = COALESCE(statement_proposals.statement_file_name, EXCLUDED.statement_file_name),
      contact_id          = COALESCE(statement_proposals.contact_id, EXCLUDED.contact_id),
      updated_at          = NOW()
    RETURNING id
  `);
  return (result.rows[0] as { id: number }).id;
}

/** Performs the same upsert as the analyzer completion path. */
async function upsertAnalyzedProposal(dealId: number, effectiveRate: string, notes: string): Promise<number> {
  const result = await db.execute(sql`
    INSERT INTO statement_proposals
      (deal_id, status, effective_rate, savings_estimate, notes, plans, created_at, updated_at)
    VALUES
      (${dealId}, 'analyzed', ${effectiveRate}, 'Saving $100/mo', ${notes}, ${'[]'}::jsonb, NOW(), NOW())
    ON CONFLICT (deal_id) WHERE deal_id IS NOT NULL
    DO UPDATE SET
      status           = 'analyzed',
      effective_rate   = EXCLUDED.effective_rate,
      savings_estimate = EXCLUDED.savings_estimate,
      notes            = EXCLUDED.notes,
      updated_at       = NOW()
    RETURNING id
  `);
  return (result.rows[0] as { id: number }).id;
}

/** Performs the same upsert as markFailed. */
async function upsertFailedProposal(dealId: number, reason: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO statement_proposals
      (deal_id, status, notes, plans, created_at, updated_at)
    VALUES
      (${dealId}, 'failed', ${reason}, ${'[]'}::jsonb, NOW(), NOW())
    ON CONFLICT (deal_id) WHERE deal_id IS NOT NULL
    DO UPDATE SET
      status     = 'failed',
      notes      = EXCLUDED.notes,
      updated_at = NOW()
  `);
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// statement_proposals.deal_id has a real FK to deals(id), so the test creates
// its own parent contact + deal fixtures and cleans them up afterwards.
let fixtureContactId: number;
const fixtureDealIds: number[] = [];

async function createFixtures(): Promise<void> {
  const suffix = Date.now();
  const contactRes = await db.execute(sql`
    INSERT INTO contacts (first_name, last_name, email, phone, created_at, updated_at)
    VALUES ('Proposal', 'ConcurrencyTest', ${`proposal-concurrency-${suffix}@test.invalid`},
            ${`+1555${String(suffix).slice(-7)}`}, NOW(), NOW())
    RETURNING id
  `);
  fixtureContactId = (contactRes.rows[0] as { id: number }).id;

  for (let i = 0; i < 6; i++) {
    const dealRes = await db.execute(sql`
      INSERT INTO deals (contact_id, pipeline, stage, name, created_at, updated_at)
      VALUES (${fixtureContactId}, 'sales', 'New Lead', ${`proposal-concurrency-test-${suffix}-${i}`}, NOW(), NOW())
      RETURNING id
    `);
    fixtureDealIds.push((dealRes.rows[0] as { id: number }).id);
  }
}

async function dropFixtures(): Promise<void> {
  for (const dealId of fixtureDealIds) {
    await db.execute(sql`DELETE FROM statement_proposals WHERE deal_id = ${dealId}`);
    await db.execute(sql`DELETE FROM deals WHERE id = ${dealId}`);
  }
  if (fixtureContactId) {
    await db.execute(sql`DELETE FROM contacts WHERE id = ${fixtureContactId}`);
  }
}

async function runTests(): Promise<void> {
  console.log("\n── statement_proposals concurrency tests ──\n");

  await createFixtures();
  console.log(`  (fixtures: contact ${fixtureContactId}, deals ${fixtureDealIds.join(", ")})\n`);

  // ── T1: Single draft upsert creates exactly one row ────────────────────────
  await test("T1: single draft upsert creates exactly one row", async () => {
    const dealId = fixtureDealIds[0];
    await cleanupDeal(dealId);
    try {
      const id = await upsertDraftProposal(dealId, "Acme Corp");
      assert(typeof id === "number" && id > 0, "returned id should be a positive integer");
      const count = await countProposalsForDeal(dealId);
      assert(count === 1, `expected 1 row, got ${count}`);
    } finally {
      await cleanupDeal(dealId);
    }
  });

  // ── T2: Two sequential draft upserts → still one row ───────────────────────
  await test("T2: two sequential draft upserts produce one row", async () => {
    const dealId = fixtureDealIds[1];
    await cleanupDeal(dealId);
    try {
      const id1 = await upsertDraftProposal(dealId, "Acme Corp");
      const id2 = await upsertDraftProposal(dealId, "Acme Corp v2");
      assert(id1 === id2, `both upserts should return the same row id (got ${id1}, ${id2})`);
      const count = await countProposalsForDeal(dealId);
      assert(count === 1, `expected 1 row after two upserts, got ${count}`);
    } finally {
      await cleanupDeal(dealId);
    }
  });

  // ── T3: Concurrent draft upserts → exactly one row ─────────────────────────
  await test("T3: concurrent draft upserts produce exactly one row", async () => {
    const dealId = fixtureDealIds[2];
    await cleanupDeal(dealId);
    try {
      // Fire N concurrent upserts simultaneously
      const N = 10;
      const results = await Promise.allSettled(
        Array.from({ length: N }, (_, i) =>
          upsertDraftProposal(dealId, `Merchant ${i}`)
        )
      );
      const failures = results.filter(r => r.status === "rejected");
      assert(failures.length === 0, `${failures.length} concurrent upserts threw errors`);
      const count = await countProposalsForDeal(dealId);
      assert(count === 1, `expected exactly 1 row after ${N} concurrent upserts, got ${count}`);
      // All successful calls must return the same row id
      const ids = new Set(
        results
          .filter((r): r is PromiseFulfilledResult<number> => r.status === "fulfilled")
          .map(r => r.value)
      );
      assert(ids.size === 1, `expected all upserts to return same row id, got ${ids.size} distinct ids: ${[...ids]}`);
    } finally {
      await cleanupDeal(dealId);
    }
  });

  // ── T4: Draft then analyzer completion → one row, status=analyzed ──────────
  await test("T4: draft followed by analyzer completion → one row, status=analyzed", async () => {
    const dealId = fixtureDealIds[3];
    await cleanupDeal(dealId);
    try {
      await upsertDraftProposal(dealId, "Merchant X");
      const analyzedId = await upsertAnalyzedProposal(dealId, "2.50%", '{"test":true}');
      const count = await countProposalsForDeal(dealId);
      assert(count === 1, `expected 1 row after draft + analyzed upsert, got ${count}`);
      const rowResult = await db.execute(
        sql`SELECT status, effective_rate FROM statement_proposals WHERE deal_id = ${dealId}`
      );
      const row = rowResult.rows[0] as { status: string; effective_rate: string };
      assert(row.status === "analyzed", `expected status='analyzed', got '${row.status}'`);
      assert(row.effective_rate === "2.50%", `expected effective_rate='2.50%', got '${row.effective_rate}'`);
    } finally {
      await cleanupDeal(dealId);
    }
  });

  // ── T5: Concurrent draft + analyzer upserts → one row ──────────────────────
  await test("T5: concurrent draft and analyzer upserts produce exactly one row", async () => {
    const dealId = fixtureDealIds[4];
    await cleanupDeal(dealId);
    try {
      const results = await Promise.allSettled([
        upsertDraftProposal(dealId, "Racing Merchant"),
        upsertAnalyzedProposal(dealId, "3.10%", '{"concurrent":true}'),
        upsertDraftProposal(dealId, "Racing Merchant 2"),
        upsertFailedProposal(dealId, "parse error"),
        upsertDraftProposal(dealId, "Racing Merchant 3"),
      ]);
      const failures = results.filter(r => r.status === "rejected");
      assert(failures.length === 0, `${failures.length} concurrent upserts threw errors`);
      const count = await countProposalsForDeal(dealId);
      assert(count === 1, `expected exactly 1 row after mixed concurrent upserts, got ${count}`);
    } finally {
      await cleanupDeal(dealId);
    }
  });

  // ── T6: markFailed creates or updates → one row, status=failed ─────────────
  await test("T6: markFailed upsert on fresh deal → one row, status=failed", async () => {
    const dealId = fixtureDealIds[5];
    await cleanupDeal(dealId);
    try {
      await upsertFailedProposal(dealId, "AI extraction error");
      const count = await countProposalsForDeal(dealId);
      assert(count === 1, `expected 1 row, got ${count}`);
      const rowResult = await db.execute(
        sql`SELECT status FROM statement_proposals WHERE deal_id = ${dealId}`
      );
      const row = rowResult.rows[0] as { status: string };
      assert(row.status === "failed", `expected status='failed', got '${row.status}'`);
    } finally {
      await cleanupDeal(dealId);
    }
  });

  // ── T7: NULL deal_id rows are not subject to the unique constraint ──────────
  await test("T7: multiple rows with deal_id=NULL are allowed", async () => {
    // Insert two rows with NULL deal_id — the partial index does not apply
    const res1 = await db.execute(sql`
      INSERT INTO statement_proposals (deal_id, status, plans, created_at, updated_at)
      VALUES (NULL, 'draft', '[]'::jsonb, NOW(), NOW())
      RETURNING id
    `);
    const res2 = await db.execute(sql`
      INSERT INTO statement_proposals (deal_id, status, plans, created_at, updated_at)
      VALUES (NULL, 'draft', '[]'::jsonb, NOW(), NOW())
      RETURNING id
    `);
    const r1 = res1.rows[0] as { id: number };
    const r2 = res2.rows[0] as { id: number };
    try {
      assert(r1.id !== r2.id, "two NULL deal_id rows should have distinct ids");
    } finally {
      await db.execute(sql`DELETE FROM statement_proposals WHERE id = ${r1.id} OR id = ${r2.id}`);
    }
  });

  // ---------------------------------------------------------------------------
  console.log(`\n── Results: ${passed} passed, ${failed} failed ──\n`);
  if (failed > 0) process.exitCode = 1;
}

runTests()
  .catch(err => {
    console.error("Fatal test error:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await dropFixtures();
      console.log("(fixtures cleaned up)");
    } catch (e) {
      console.warn("Fixture cleanup error:", e);
    }
    setTimeout(() => process.exit(process.exitCode ?? 0), 200);
  });
