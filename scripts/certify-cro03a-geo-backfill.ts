#!/usr/bin/env npx tsx
/**
 * certify-cro03a-geo-backfill.ts — CRO-03A observation geography backfill
 * certification script (disposable PostgreSQL).
 *
 * Sets DATABASE_URL = TEST_DATABASE_URL before any module load so that the
 * production backfill singleton connects to the disposable DB only.
 * All production functions are dynamically imported AFTER the env override.
 *
 * Scenarios:
 *   (a) Pre-migration guard — column absent → featureDetected=false, no-op.
 *   (b) South-Florida-eligible row — sentinel stamped; payload & payload_hash
 *       are NOT mutated (observation immutability contract preserved).
 *   (c) Non-eligible row — sentinel stamped; payload & payload_hash unchanged.
 *   (d) Second-run exclusion — already-stamped rows are excluded from the
 *       next batch (WHERE geography_backfill_attempted_at IS NULL).
 *   (e) Payload/hash invariant — payload_hash matches sha256 of payload after
 *       backfill (verifies no corruption of the content-address contract).
 *
 * Kill lines:
 *   - Does NOT write to any production table.
 *   - All writes go to TEST_DATABASE_URL (disposable database) only.
 */

// ── MUST be set before any import that initialises the db singleton ──────────
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DATABASE_URL) {
  console.error("✗ TEST_DATABASE_URL is not set — disposable database required");
  process.exit(1);
}
process.env.DATABASE_URL = TEST_DATABASE_URL;

import { createHash, randomUUID } from "crypto";
import pg from "pg";

const { Client } = pg;

let errors = 0;
function pass(msg: string) { console.log(`  ✓ ${msg}`); }
function fail(msg: string) { console.error(`  ✗ ${msg}`); errors++; }

/** Canonical CRO-03 payload hash — must match hashCro03Evidence in source-staging.ts */
function canonicalHash(payload: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/** Minimal schema without FK constraints so a truly empty disposable DB works. */
async function applyBaseSchema(client: pg.Client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS cro03_source_subjects (
      id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      subject_type  text        NOT NULL,
      subject_key   text        NOT NULL,
      source_system text        NOT NULL,
      tombstoned_at timestamptz,
      UNIQUE (subject_type, source_system, subject_key)
    );

    CREATE TABLE IF NOT EXISTS cro03_source_observations (
      id                             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      source_subject_id              uuid        NOT NULL,
      observed_at                    timestamptz NOT NULL DEFAULT NOW(),
      observed_by_actor_type         text        NOT NULL DEFAULT 'import',
      observed_by_actor_id           text,
      provenance                     jsonb       NOT NULL DEFAULT '{}'::jsonb,
      payload                        jsonb       NOT NULL DEFAULT '{}'::jsonb,
      payload_hash                   text        NOT NULL,
      hash_algorithm_version         text        NOT NULL DEFAULT 'sha256-v1',
      created_at                     timestamptz NOT NULL DEFAULT NOW(),
      UNIQUE (source_subject_id, payload_hash)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id          bigserial   PRIMARY KEY,
      action      text        NOT NULL,
      entity_type text,
      entity_key  text,
      actor_type  text,
      actor_id    text,
      details     jsonb       NOT NULL DEFAULT '{}'::jsonb,
      created_at  timestamptz NOT NULL DEFAULT NOW()
    );
  `);
}

interface InsertedObs {
  obsId: string;
  payload: Record<string, unknown>;
  payloadHash: string;
}

async function insertObservation(
  client: pg.Client,
  payload: Record<string, unknown>,
  seed: string,
): Promise<InsertedObs> {
  const subjectId = randomUUID();
  await client.query(
    `INSERT INTO cro03_source_subjects (id, subject_type, subject_key, source_system)
     VALUES ($1, 'prospect', $2, 'cert-geo-backfill')`,
    [subjectId, `key-${seed}`],
  );
  const obsId = randomUUID();
  const payloadHash = canonicalHash(payload);
  await client.query(
    `INSERT INTO cro03_source_observations
       (id, source_subject_id, payload, payload_hash)
     VALUES ($1, $2, $3::jsonb, $4)`,
    [obsId, subjectId, JSON.stringify(payload), payloadHash],
  );
  return { obsId, payload, payloadHash };
}

async function fetchObs(client: pg.Client, obsId: string) {
  const row = (await client.query(
    `SELECT payload, payload_hash, geography_backfill_attempted_at
       FROM cro03_source_observations WHERE id = $1`,
    [obsId],
  )).rows[0];
  return {
    payload: typeof row.payload === "string" ? JSON.parse(row.payload) as Record<string, unknown> : row.payload as Record<string, unknown>,
    payloadHash: String(row.payload_hash),
    stampedAt: row.geography_backfill_attempted_at,
  };
}

async function main() {
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();

  // ── (a) Pre-migration guard: column absent ──────────────────────────────────
  console.log("\n(a) Pre-migration guard — column absent");
  await applyBaseSchema(client);

  // Import AFTER env override so db singleton hits the disposable DB.
  const { backfillCro03aObservationGeography } = await import(
    "../server/services/cro03a/qualification-service"
  );

  const noColResult = await backfillCro03aObservationGeography(50);
  if (!noColResult.featureDetected && noColResult.processed === 0) {
    pass("featureDetected=false, processed=0 when column is absent");
  } else {
    fail(`expected no-op without column; got featureDetected=${noColResult.featureDetected} processed=${noColResult.processed}`);
  }

  // Add the sentinel column so the remaining scenarios can run.
  await client.query(`
    ALTER TABLE cro03_source_observations
      ADD COLUMN IF NOT EXISTS geography_backfill_attempted_at timestamptz;
  `);

  const ts = Date.now();

  // ── (b) South-Florida-eligible row ─────────────────────────────────────────
  console.log("\n(b) South-Florida-eligible row — sentinel stamped, payload immutable");
  // 33101 is a Miami-Dade (12086) zip; geography evaluator classifies as eligible.
  const sfPayload = { zip: "33101", businessName: "South Beach Merchant" };
  const sfObs = await insertObservation(client, sfPayload, `sf-${ts}`);

  const r1 = await backfillCro03aObservationGeography(50);
  if (r1.featureDetected) {
    pass("featureDetected=true after column added");
  } else {
    fail("featureDetected unexpectedly false after column added");
  }

  const sfAfter = await fetchObs(client, sfObs.obsId);
  if (sfAfter.stampedAt !== null) {
    pass("sentinel stamped on SF-eligible row");
  } else {
    fail("sentinel NOT stamped on SF-eligible row");
  }
  // Payload must be bit-for-bit identical to what was inserted.
  const sfPayloadAfterStr = JSON.stringify(sfAfter.payload);
  const sfPayloadBeforeStr = JSON.stringify(sfPayload);
  if (sfPayloadAfterStr === sfPayloadBeforeStr) {
    pass("payload NOT mutated on SF-eligible row (immutability preserved)");
  } else {
    fail(`payload was mutated: before=${sfPayloadBeforeStr} after=${sfPayloadAfterStr}`);
  }

  // ── (e) Payload/hash invariant after backfill ───────────────────────────────
  console.log("\n(e) Payload/hash invariant — payload_hash still matches sha256(payload)");
  const recomputedHash = canonicalHash(sfAfter.payload);
  if (sfAfter.payloadHash === sfObs.payloadHash && recomputedHash === sfObs.payloadHash) {
    pass("payload_hash unchanged and still matches sha256(payload)");
  } else {
    fail(`payload_hash mismatch: stored=${sfAfter.payloadHash} recomputed=${recomputedHash} original=${sfObs.payloadHash}`);
  }
  if (r1.eligible >= 1) {
    pass(`eligible counter incremented (eligible=${r1.eligible})`);
  } else {
    fail(`expected eligible>=1, got ${r1.eligible}`);
  }

  // ── (c) Non-eligible row ────────────────────────────────────────────────────
  console.log("\n(c) Non-eligible row — sentinel stamped, payload immutable");
  const nonSfPayload = { businessName: "Chicago Corp", state: "IL" };
  const nonSfObs = await insertObservation(client, nonSfPayload, `non-sf-${ts}`);

  await backfillCro03aObservationGeography(50);

  const nonSfAfter = await fetchObs(client, nonSfObs.obsId);
  if (nonSfAfter.stampedAt !== null) {
    pass("sentinel stamped on non-eligible row");
  } else {
    fail("sentinel NOT stamped on non-eligible row");
  }
  if (JSON.stringify(nonSfAfter.payload) === JSON.stringify(nonSfPayload)) {
    pass("payload NOT mutated on non-eligible row (immutability preserved)");
  } else {
    fail(`payload was mutated on non-eligible row: ${JSON.stringify(nonSfAfter.payload)}`);
  }
  const nonSfHashAfter = canonicalHash(nonSfAfter.payload);
  if (nonSfAfter.payloadHash === nonSfHashAfter) {
    pass("payload_hash consistent after backfill on non-eligible row");
  } else {
    fail(`payload_hash mismatch on non-eligible row: stored=${nonSfAfter.payloadHash} recomputed=${nonSfHashAfter}`);
  }

  // ── (d) Second-run exclusion ────────────────────────────────────────────────
  console.log("\n(d) Second-run exclusion — already-stamped rows not re-scanned");
  const r2 = await backfillCro03aObservationGeography(50);
  if (r2.processed === 0) {
    pass("no rows returned in second run (all already stamped)");
  } else {
    fail(`expected 0 processed in second run, got ${r2.processed}`);
  }

  // Insert a fresh unstamped row and confirm it IS picked up.
  const freshPayload = { zip: "33131", businessName: "Brickell Merchant" };
  const freshObs = await insertObservation(client, freshPayload, `fresh-${ts}`);
  const r3 = await backfillCro03aObservationGeography(50);
  if (r3.processed === 1) {
    pass("fresh unstamped row picked up correctly");
  } else {
    fail(`expected 1 processed for fresh row, got ${r3.processed}`);
  }
  const freshAfter = await fetchObs(client, freshObs.obsId);
  if (freshAfter.stampedAt !== null) {
    pass("sentinel stamped on fresh row");
  } else {
    fail("sentinel NOT stamped on fresh row");
  }

  await client.end();

  if (errors > 0) {
    console.error(`\n✗ ${errors} assertion(s) failed`);
    process.exit(1);
  }
  console.log("\n✓ All assertions passed");
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
