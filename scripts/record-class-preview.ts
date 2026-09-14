/**
 * scripts/record-class-preview.ts
 *
 * Task #1955 — governed record_class preview/reconciliation tooling.
 *
 * READ-ONLY by default. Produces a full evidence report classifying every
 * `deals` row with record_class='unknown' and every `businesses` row into
 * buckets, with per-row evidence, before any reclassification is ever
 * applied. Never touches production automatically — the --apply flag must
 * be passed explicitly, and even then only ever applies to clean-match
 * rows.
 *
 * Usage:
 *   npx tsx scripts/record-class-preview.ts                 # preview only, prints report
 *   npx tsx scripts/record-class-preview.ts --json           # machine-readable report
 *   npx tsx scripts/record-class-preview.ts --apply           # apply clean-match deals rows
 *   npx tsx scripts/record-class-preview.ts --apply --target=businesses
 *
 * Buckets (deals):
 *   clean-match     — deal has a linked contact whose record_class is NOT 'unknown'
 *                     → eligible for apply, copies the contact's record_class
 *   unmatched       — deal has no contact_id at all → left untouched
 *   conflicting     — deal has a contact_id, but that contact's own
 *                     record_class is itself 'unknown' → left untouched
 *   already-correct — deal's record_class is not 'unknown' → no-op
 *
 * Buckets (businesses):
 *   test-candidate  — meets the documented multi-signal test-fixture rule
 *                     (see isTestFixtureBusiness below) → NOT auto-applied;
 *                     always requires human review, never auto-applied even
 *                     with --apply, because "test fixture" is a judgment
 *                     call this tool must never make unsupervised.
 *   unknown-other   — record_class='unknown' but does not meet the test
 *                     signal rule → left untouched, reported for visibility
 *   already-correct — record_class is not 'unknown' → no-op
 *
 * Apply path is idempotent (safe to rerun) and transactional per batch;
 * every applied row is written to record_class_reconciliation_log for a
 * targeted rollback (see rollback query in the runbook / task file).
 */
import { db, pool } from "../server/db";
import { sql } from "drizzle-orm";

const APPLY = process.argv.includes("--apply");
const JSON_OUT = process.argv.includes("--json");
const TARGET = (process.argv.find((a) => a.startsWith("--target="))?.split("=")[1] ?? "deals") as
  | "deals"
  | "businesses";

const TEST_NAME_PATTERNS = [
  "test", "sample", "example", "demo co", "acme", "fixture", "playwright", "qa-",
];

function isTestFixtureBusiness(row: {
  canonical_name: string;
  last_source_type: string | null;
  linked_test_contacts: number;
  linked_total_contacts: number;
}): { isCandidate: boolean; signals: string[] } {
  const signals: string[] = [];
  const nameLower = row.canonical_name.toLowerCase();
  if (TEST_NAME_PATTERNS.some((p) => nameLower.includes(p))) {
    signals.push("name_pattern_match");
  }
  if (row.linked_total_contacts > 0 && row.linked_test_contacts === row.linked_total_contacts) {
    signals.push("all_linked_contacts_are_test");
  }
  if (row.last_source_type === "manual_upload") {
    // Explicitly NOT sufficient alone (Task #1955 correction) — recorded only
    // as one signal among several, never as standalone proof.
    signals.push("manual_upload (supporting signal only, not sufficient alone)");
  }
  // Require at least one STRONG signal (name pattern or all-linked-contacts-test),
  // not manual_upload alone.
  const strongSignals = signals.filter((s) => s !== "manual_upload (supporting signal only, not sufficient alone)");
  return { isCandidate: strongSignals.length > 0, signals };
}

async function previewDeals() {
  const rows = await db.execute(sql`
    SELECT
      d.id AS deal_id,
      d.record_class AS deal_record_class,
      d.contact_id,
      c.record_class AS contact_record_class
    FROM deals d
    LEFT JOIN contacts c ON c.id = d.contact_id
    ORDER BY d.id
  `);

  const buckets = {
    cleanMatch: [] as { dealId: number; from: string; to: string }[],
    unmatched: [] as number[],
    conflicting: [] as number[],
    alreadyCorrect: [] as number[],
  };

  for (const r of rows.rows as any[]) {
    if (r.deal_record_class !== "unknown") {
      buckets.alreadyCorrect.push(r.deal_id);
      continue;
    }
    if (!r.contact_id) {
      buckets.unmatched.push(r.deal_id);
      continue;
    }
    if (!r.contact_record_class || r.contact_record_class === "unknown") {
      buckets.conflicting.push(r.deal_id);
      continue;
    }
    buckets.cleanMatch.push({ dealId: r.deal_id, from: r.deal_record_class, to: r.contact_record_class });
  }

  const total = rows.rows.length;
  const accountedFor =
    buckets.cleanMatch.length + buckets.unmatched.length + buckets.conflicting.length + buckets.alreadyCorrect.length;
  if (accountedFor !== total) {
    throw new Error(
      `Reconciliation invariant violated: ${accountedFor} bucketed rows != ${total} total deals rows — report would silently drop rows.`,
    );
  }

  return { total, buckets };
}

async function previewBusinesses() {
  const rows = await db.execute(sql`
    SELECT
      b.id AS business_id,
      b.canonical_name,
      b.record_class,
      b.last_source_type,
      COUNT(c.id)::int AS linked_total_contacts,
      COUNT(c.id) FILTER (WHERE c.record_class = 'test')::int AS linked_test_contacts
    FROM businesses b
    LEFT JOIN contacts c ON c.business_id = b.id
    GROUP BY b.id, b.canonical_name, b.record_class, b.last_source_type
    ORDER BY b.id
  `);

  const buckets = {
    testCandidate: [] as { businessId: number; name: string; signals: string[] }[],
    unknownOther: [] as number[],
    alreadyCorrect: [] as number[],
  };

  for (const r of rows.rows as any[]) {
    if (r.record_class !== "unknown") {
      buckets.alreadyCorrect.push(r.business_id);
      continue;
    }
    const { isCandidate, signals } = isTestFixtureBusiness({
      canonical_name: r.canonical_name,
      last_source_type: r.last_source_type,
      linked_test_contacts: r.linked_test_contacts,
      linked_total_contacts: r.linked_total_contacts,
    });
    if (isCandidate) {
      buckets.testCandidate.push({ businessId: r.business_id, name: r.canonical_name, signals });
    } else {
      buckets.unknownOther.push(r.business_id);
    }
  }

  const total = rows.rows.length;
  const accountedFor = buckets.testCandidate.length + buckets.unknownOther.length + buckets.alreadyCorrect.length;
  if (accountedFor !== total) {
    throw new Error(
      `Reconciliation invariant violated: ${accountedFor} bucketed rows != ${total} total businesses rows.`,
    );
  }

  return { total, buckets };
}

async function ensureReconciliationLogTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS record_class_reconciliation_log (
      id SERIAL PRIMARY KEY,
      table_name TEXT NOT NULL,
      row_id INTEGER NOT NULL,
      previous_record_class TEXT NOT NULL,
      new_record_class TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      applied_by TEXT NOT NULL DEFAULT 'record-class-preview-script'
    )
  `);
}

async function applyDealsCleanMatch(cleanMatch: { dealId: number; from: string; to: string }[]) {
  await ensureReconciliationLogTable();
  let applied = 0;
  await pool.query("BEGIN");
  try {
    for (const row of cleanMatch) {
      // Idempotent: only updates rows still in the 'unknown' state; a rerun
      // after a partial apply is a safe no-op for already-applied rows.
      const result = await pool.query(
        `UPDATE deals SET record_class = $1 WHERE id = $2 AND record_class = 'unknown'`,
        [row.to, row.dealId],
      );
      if ((result.rowCount ?? 0) > 0) {
        await pool.query(
          `INSERT INTO record_class_reconciliation_log (table_name, row_id, previous_record_class, new_record_class)
           VALUES ('deals', $1, $2, $3)`,
          [row.dealId, row.from, row.to],
        );
        applied++;
      }
    }
    await pool.query("COMMIT");
  } catch (err) {
    await pool.query("ROLLBACK");
    throw err;
  }
  return applied;
}

async function main() {
  if (TARGET === "deals") {
    const { total, buckets } = await previewDeals();
    const report = {
      target: "deals",
      total,
      cleanMatch: buckets.cleanMatch.length,
      unmatched: buckets.unmatched.length,
      conflicting: buckets.conflicting.length,
      alreadyCorrect: buckets.alreadyCorrect.length,
      cleanMatchSample: buckets.cleanMatch.slice(0, 10),
    };
    if (JSON_OUT) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`\n[record-class-preview] deals: ${total} total`);
      console.log(`  clean-match:      ${report.cleanMatch} (eligible for apply)`);
      console.log(`  unmatched:        ${report.unmatched} (no contact_id — left untouched)`);
      console.log(`  conflicting:      ${report.conflicting} (linked contact also unknown — left untouched)`);
      console.log(`  already-correct:  ${report.alreadyCorrect} (no-op)`);
    }
    if (APPLY) {
      console.log(`\n[record-class-preview] --apply passed: applying ${buckets.cleanMatch.length} clean-match deals rows...`);
      const applied = await applyDealsCleanMatch(buckets.cleanMatch);
      console.log(`[record-class-preview] applied ${applied} rows (idempotent — reruns skip already-applied rows).`);
    }
  } else {
    const { total, buckets } = await previewBusinesses();
    const report = {
      target: "businesses",
      total,
      testCandidate: buckets.testCandidate.length,
      unknownOther: buckets.unknownOther.length,
      alreadyCorrect: buckets.alreadyCorrect.length,
      testCandidateDetail: buckets.testCandidate,
    };
    if (JSON_OUT) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`\n[record-class-preview] businesses: ${total} total`);
      console.log(`  test-candidate:   ${report.testCandidate} (requires human review — never auto-applied)`);
      console.log(`  unknown-other:    ${report.unknownOther} (left untouched)`);
      console.log(`  already-correct:  ${report.alreadyCorrect} (no-op)`);
      for (const c of buckets.testCandidate) {
        console.log(`    business #${c.businessId} "${c.name}": ${c.signals.join(", ")}`);
      }
    }
    if (APPLY) {
      console.log(`\n[record-class-preview] --apply is a no-op for businesses: test-candidate rows always require explicit human-approved reclassification, never an automated apply.`);
    }
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[record-class-preview] FAILED:", err);
  process.exit(1);
});
