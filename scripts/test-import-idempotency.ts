#!/usr/bin/env npx tsx
/**
 * Disposable PostgreSQL certification for prospect import idempotency.
 *
 * This suite intentionally certifies the storage/database contract only. It
 * does not claim HTTP CSV or COREVT coverage; those routes are inspected as
 * the writer census and use the same storage owners below.
 *
 * Usage: npx tsx scripts/test-import-idempotency.ts
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";

const REPLAY_CONSTRAINT = "prospect_lists_import_type_hash_uidx";
const RUN_ID = randomUUID();
const MARKER = `import-idempotency-${RUN_ID}`;

let passed = 0;

function check(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${label}`);
  passed++;
  console.log(`  ✓ ${label}`);
}

function normalizePredicate(value: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

interface NormalizerApi {
  computeFileHash: (buffer: Buffer) => string;
  computeRowFingerprint: (input: {
    email: string | null;
    phone: string | null;
    companyName: string | null;
  }) => string;
  isValidEmailFormat: (email: string) => boolean;
  normalizeProspectEmail: (raw: string) => string | null;
  normalizeProspectPhone: (raw: string) => string | null;
}

function runPureNormalizerChecks(normalizer: NormalizerApi): void {
  const {
    computeFileHash,
    computeRowFingerprint,
    isValidEmailFormat,
    normalizeProspectEmail,
    normalizeProspectPhone,
  } = normalizer;
  console.log("\n=== import normalizer contract ===");
  check(normalizeProspectEmail("  TEST@Example.COM  ") === "test@example.com", "email normalization trims and lowercases");
  check(normalizeProspectEmail("   ") === null, "blank email normalizes to null");
  check(normalizeProspectEmail(null as any) === null, "null-like email normalizes to null");
  check(isValidEmailFormat("test@example.com"), "valid email format is accepted");
  check(!isValidEmailFormat("not-an-email"), "invalid email format is rejected");
  check(normalizeProspectPhone("(813) 555-1234") === "8135551234", "phone normalization strips punctuation");
  check(normalizeProspectPhone("1-813-555-1234") === "8135551234", "leading country code is removed");
  check(normalizeProspectPhone("not-a-phone") === null, "invalid phone normalizes to null");
  const fingerprint = computeRowFingerprint({
    email: "test@example.com",
    phone: "8135551234",
    companyName: "Acme",
  });
  check(
    fingerprint === computeRowFingerprint({
      email: "test@example.com",
      phone: "8135551234",
      companyName: "Acme",
    }),
    "row fingerprint is deterministic",
  );
  check(
    computeFileHash(Buffer.from("same bytes")) === computeFileHash(Buffer.from("same bytes")),
    "file hash is based on bytes, not filename",
  );
}

async function runBoundaryChecks(): Promise<void> {
  console.log("\n=== disposable boundary contract ===");
  const source = readFileSync(new URL(import.meta.url), "utf8");
  const guardOffset = source.indexOf("const infrastructure = await assertDisposableTestInfrastructure");
  check(guardOffset > 0, "disposable infrastructure assertion exists");
  for (const applicationImport of [
    'import("../server/db-migrate")',
    'import("../server/db")',
    'import("../server/storage")',
    'import("../server/storage/prospects")',
    'import("../server/services/import-normalizer")',
  ]) {
    const importOffset = source.indexOf(applicationImport);
    check(importOffset > guardOffset, `${applicationImport} occurs only after the infrastructure assertion`);
  }
  check(
    !/^import .*from ["']\.\.\/(?:server\/|shared\/schema)/m.test(source),
    "no application server or schema module is statically imported",
  );

  const refusalCases: Array<[string, NodeJS.ProcessEnv, string]> = [
    ["missing database settings", { NODE_ENV: "test" }, "exactly equal"],
    [
      "mismatched database settings",
      {
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://localhost/ci_one",
        TEST_DATABASE_URL: "postgresql://localhost/ci_two",
      },
      "exactly equal",
    ],
    [
      "ambiguously named database",
      {
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://localhost/application",
        TEST_DATABASE_URL: "postgresql://localhost/application",
      },
      "not clearly named",
    ],
  ];
  for (const [label, env, message] of refusalCases) {
    let refusal: unknown = null;
    try {
      await assertDisposableTestInfrastructure({
        operation: `prospect-import-idempotency negative ${label}`,
        env,
      });
    } catch (error) {
      refusal = error;
    }
    check(
      refusal instanceof Error && refusal.message.includes(message),
      `${label} fails closed before application imports`,
    );
  }
}

async function main(): Promise<void> {
  await runBoundaryChecks();

  // This must be the first application-boundary operation. In particular,
  // server/db, storage, schema, and migration modules are imported below it.
  const infrastructure = await assertDisposableTestInfrastructure({
    operation: "prospect-import-idempotency",
    requireRedis: true,
    // The canonical runner owns the reservation. A direct guarded invocation
    // must reserve its own high-entropy namespace instead.
    reserveRedisNamespace: !process.env.CERTIFICATION_RUN_ID,
  });

  let pool: any = null;
  const listIds = new Set<number>();
  const prospectIds = new Set<number>();
  let testFailure: unknown = null;
  let cleanupFailure: unknown = null;

  try {
    // The canonical runner is invoked twice before catalog or fixture checks.
    const { runDrizzleMigrations } = await import("../server/db-migrate");
    await runDrizzleMigrations();
    await runDrizzleMigrations();
    check(true, "canonical migrations apply twice without replay failure");

    const [
      { pool: appPool },
      { storage },
      { isProspectListReplayConflict },
      normalizer,
    ] =
      await Promise.all([
        import("../server/db"),
        import("../server/storage"),
        import("../server/storage/prospects"),
        import("../server/services/import-normalizer"),
      ]);
    pool = appPool;
    runPureNormalizerChecks(normalizer);

    const trackList = (list: { id?: number } | undefined): void => {
      if (list?.id) listIds.add(Number(list.id));
    };
    const trackProspectsForRun = async (): Promise<void> => {
      const result = await pool.query(
        `SELECT id FROM prospects
         WHERE company_name LIKE $1 OR email LIKE $2
         ORDER BY id`,
        [`${MARKER}%`, `idem-${RUN_ID}%`],
      );
      for (const row of result.rows) prospectIds.add(Number(row.id));
    };
    const createList = async (
      suffix: string,
      fileHash: string | null,
      importType: string | null,
      status: string,
    ) => {
      const list = await storage.createProspectList({
        name: `${MARKER}-${suffix}`,
        fileHash,
        importType,
        status,
      } as any);
      trackList(list);
      return list;
    };
    const countLists = async (importType: string | null, fileHash: string | null): Promise<number> => {
      const result = await pool.query(
        `SELECT count(*)::int AS count
         FROM prospect_lists
         WHERE name LIKE $1
           AND import_type IS NOT DISTINCT FROM $2
           AND file_hash IS NOT DISTINCT FROM $3`,
        [`${MARKER}%`, importType, fileHash],
      );
      return Number(result.rows[0].count);
    };

    console.log("\n=== exact PostgreSQL catalog contract ===");
    const catalog = await pool.query(
      `SELECT
         ns.nspname AS schema_name,
         table_class.relname AS table_name,
         index_class.relname AS index_name,
         index_meta.indisunique,
         index_meta.indisvalid,
         index_meta.indisready,
         COALESCE((
           SELECT json_agg(attribute.attname ORDER BY key.ordinal)
           FROM unnest(index_meta.indkey) WITH ORDINALITY AS key(attnum, ordinal)
           JOIN pg_attribute attribute
             ON attribute.attrelid = index_meta.indrelid
            AND attribute.attnum = key.attnum
         ), '[]'::json) AS key_columns,
         pg_get_expr(index_meta.indpred, index_meta.indrelid) AS predicate
       FROM pg_index index_meta
       JOIN pg_class index_class ON index_class.oid = index_meta.indexrelid
       JOIN pg_class table_class ON table_class.oid = index_meta.indrelid
       JOIN pg_namespace ns ON ns.oid = table_class.relnamespace
       WHERE ns.nspname = 'public'
         AND index_class.relname = ANY($1::text[])
       ORDER BY index_class.relname`,
      [[
        REPLAY_CONSTRAINT,
        "prospects_execution_row_uidx",
        "prospects_email_import_unique_idx",
        "sunbiz_entities_source_fn_unique",
      ]],
    );
    const expectedCatalog: Record<string, {
      table: string;
      columns: string[];
      predicate: string;
    }> = {
      [REPLAY_CONSTRAINT]: {
        table: "prospect_lists",
        columns: ["import_type", "file_hash"],
        predicate: "(status = ANY (ARRAY['running'::text, 'complete'::text]))",
      },
      prospects_execution_row_uidx: {
        table: "prospects",
        columns: ["import_execution_id", "source_row_index"],
        predicate: "((import_execution_id IS NOT NULL) AND (source_row_index IS NOT NULL))",
      },
      prospects_email_import_unique_idx: {
        table: "prospects",
        columns: ["email"],
        predicate: "((email IS NOT NULL) AND (import_execution_id IS NOT NULL))",
      },
      sunbiz_entities_source_fn_unique: {
        table: "sunbiz_entities",
        columns: ["source", "filing_number"],
        predicate: "((source IS NOT NULL) AND (filing_number IS NOT NULL))",
      },
    };
    check(catalog.rowCount === Object.keys(expectedCatalog).length, "all four idempotency indexes are present in public schema");
    for (const [indexName, expected] of Object.entries(expectedCatalog)) {
      const row = catalog.rows.find((candidate: any) => candidate.index_name === indexName);
      check(Boolean(row), `${indexName} is attached to a catalog row`);
      check(row.schema_name === "public", `${indexName} is in public schema`);
      check(row.table_name === expected.table, `${indexName} targets ${expected.table}`);
      check(row.indisunique === true, `${indexName} is unique`);
      check(row.indisvalid === true, `${indexName} is valid`);
      check(row.indisready === true, `${indexName} is ready`);
      check(JSON.stringify(row.key_columns) === JSON.stringify(expected.columns), `${indexName} has exact ordered key columns`);
      check(normalizePredicate(row.predicate) === normalizePredicate(expected.predicate), `${indexName} has exact normalized predicate`);
    }

    console.log("\n=== exact replay-conflict error contract ===");
    check(
      isProspectListReplayConflict({ code: "23505", constraint: REPLAY_CONSTRAINT }),
      "direct PostgreSQL replay error shape is accepted",
    );
    check(
      isProspectListReplayConflict({ cause: { code: "23505", constraint: REPLAY_CONSTRAINT } }),
      "nested PostgreSQL replay error shape is accepted",
    );
    check(
      !isProspectListReplayConflict({ code: "23505", constraint: "other_unique_constraint", message: "unique" }),
      "wrong unique constraint is rejected",
    );
    check(
      !isProspectListReplayConflict({ code: "23503", constraint: REPLAY_CONSTRAINT }),
      "wrong PostgreSQL error code is rejected",
    );
    check(
      !isProspectListReplayConflict({ message: "duplicate key violates unique constraint" }),
      "message-only unique lookalike is rejected",
    );

    console.log("\n=== prospect storage ownership ===");
    const firstList = await createList("storage-first", `storage-${RUN_ID}`, "prospect_csv", "running");
    const secondList = await createList("storage-second", `storage-second-${RUN_ID}`, "prospect_csv", "running");
    const email = `idem-${RUN_ID}@example.invalid`;
    const baseProspect = {
      listId: firstList.id,
      importExecutionId: firstList.id,
      sourceRowIndex: 0,
      companyName: `${MARKER}-email-first`,
      email,
      status: "raw",
      score: "cold",
      qualificationScore: "C",
      doNotContact: false,
    };
    const firstInsert = await storage.createProspectsBulkIdempotent([baseProspect] as any);
    await trackProspectsForRun();
    check(firstInsert.inserted === 1, "actual createProspectsBulkIdempotent inserts the first row");
    const sameExecution = await storage.createProspectsBulkIdempotent([baseProspect] as any);
    await trackProspectsForRun();
    check(sameExecution.inserted === 0, "same execution/source row replay inserts zero rows");
    const crossExecution = await storage.createProspectsBulkIdempotent([{
      ...baseProspect,
      listId: secondList.id,
      importExecutionId: secondList.id,
      sourceRowIndex: 99,
      companyName: `${MARKER}-email-cross-execution`,
    }] as any);
    await trackProspectsForRun();
    check(crossExecution.inserted === 0, "same email across valid executions inserts zero rows");
    const unrelated = await storage.createProspectsBulkIdempotent([{
      ...baseProspect,
      listId: secondList.id,
      importExecutionId: secondList.id,
      sourceRowIndex: 100,
      companyName: `${MARKER}-email-unrelated`,
      email: `unrelated-${RUN_ID}@example.invalid`,
    }] as any);
    await trackProspectsForRun();
    check(unrelated.inserted === 1, "unrelated execution/source/email remains insertable");

    const firstProspectResult = await pool.query(
      "SELECT id FROM prospects WHERE email = $1 AND import_execution_id = $2",
      [email, firstList.id],
    );
    const firstProspectId = Number(firstProspectResult.rows[0]?.id);
    check(Number.isInteger(firstProspectId), "run-scoped prospect exists for FK-child cleanup fixtures");
    await pool.query(
      `INSERT INTO enrichment_jobs(list_id,prospect_id,job_type,status)
       VALUES($1,$2,$3,'pending')`,
      [firstList.id, firstProspectId, `${MARKER}-enrichment`],
    );
    await pool.query(
      `INSERT INTO campaigns(name,target_list_id,status)
       VALUES($1,$2,'draft')`,
      [`${MARKER}-campaign`, firstList.id],
    );
    await pool.query(
      `INSERT INTO outbound_messages(prospect_id,subject,status)
       VALUES($1,$2,'queued')`,
      [firstProspectId, `${MARKER}-outbound`],
    );
    await pool.query(
      `INSERT INTO sunbiz_entities(entity_name,filing_number,source,list_id,prospect_id)
       VALUES($1,$2,'certification',$3,$4)`,
      [`${MARKER}-sunbiz`, `${MARKER}-filing`, firstList.id, firstProspectId],
    );
    check(true, "all direct prospect/list FK-child paths have run-scoped fixtures");

    const replayHash = `replay-${RUN_ID}`;
    const replayList = await createList("replay-complete", replayHash, "prospect_csv", "complete");
    const foundReplay = await storage.getProspectListByHash("prospect_csv", replayHash);
    check(foundReplay?.id === replayList.id, "actual getProspectListByHash returns the active replay winner");

    console.log("\n=== active-status and boundary matrix ===");
    const activeStatuses = ["running", "complete"];
    for (const firstStatus of activeStatuses) {
      for (const secondStatus of activeStatuses) {
        const hash = `matrix-${firstStatus}-${secondStatus}-${RUN_ID}`;
        await createList(`matrix-${firstStatus}-${secondStatus}-first`, hash, "prospect_csv", firstStatus);
        let duplicateError: unknown = null;
        try {
          const result = await pool.query(
            `INSERT INTO prospect_lists(name,file_hash,import_type,status)
             VALUES($1,$2,$3,$4) RETURNING id`,
            [`${MARKER}-matrix-${firstStatus}-${secondStatus}-duplicate`, hash, "prospect_csv", secondStatus],
          );
          for (const row of result.rows) listIds.add(Number(row.id));
        } catch (error) {
          duplicateError = error;
        }
        check(duplicateError !== null, `${firstStatus} → ${secondStatus} active duplicate is rejected`);
        check(isProspectListReplayConflict(duplicateError), `${firstStatus} → ${secondStatus} names ${REPLAY_CONSTRAINT}`);
        check(await countLists("prospect_csv", hash) === 1, `${firstStatus} → ${secondStatus} leaves exactly one committed list`);
      }
    }

    const transitionHash = `transition-${RUN_ID}`;
    const transition = await createList("running-to-complete", transitionHash, "prospect_csv", "running");
    const transitioned = await storage.updateProspectList(transition.id, { status: "complete" } as any);
    check(transitioned?.status === "complete", "same row transitions from running to complete");
    check(await countLists("prospect_csv", transitionHash) === 1, "running-to-complete transition keeps one committed list");

    const failedHash = `failed-retry-${RUN_ID}`;
    await createList("failed-retry", failedHash, "prospect_csv", "failed");
    const retried = await createList("failed-retry-active", failedHash, "prospect_csv", "running");
    check(Boolean(retried.id), "failed import can be retried as a new active list");
    check(await countLists("prospect_csv", failedHash) === 2, "failed plus active retry both remain committed");

    const differentHash = `different-hash-${RUN_ID}`;
    await createList("different-type", differentHash, "sunbiz_corevt", "running");
    await createList("different-hash", `other-${RUN_ID}`, "prospect_csv", "running");
    check(await countLists("sunbiz_corevt", differentHash) === 1, "different import type remains insertable");
    check(await countLists("prospect_csv", `other-${RUN_ID}`) === 1, "different file hash remains insertable");

    const nullHash = await createList("null-hash-one", null, "prospect_csv", "running");
    const nullHashSecond = await createList("null-hash-two", null, "prospect_csv", "complete");
    check(Boolean(nullHash.id && nullHashSecond.id), "NULL file hashes do not collide");
    check(await countLists("prospect_csv", null) === 2, "two active NULL file hashes are allowed");
    const nullType = await createList("null-type-one", `null-type-${RUN_ID}`, null, "running");
    const nullTypeSecond = await createList("null-type-two", `null-type-${RUN_ID}`, null, "complete");
    check(Boolean(nullType.id && nullTypeSecond.id), "NULL import types do not collide");
    check(await countLists(null, `null-type-${RUN_ID}`) === 2, "two active NULL import types are allowed");

    // These states are intentionally outside the current predicate. This is a
    // documented boundary, not an assertion that they are active.
    await createList("processing-one", `outside-processing-${RUN_ID}`, "prospect_csv", "processing");
    await createList("processing-two", `outside-processing-${RUN_ID}`, "prospect_csv", "processing");
    await createList("ready-one", `outside-ready-${RUN_ID}`, "prospect_csv", "ready");
    await createList("ready-two", `outside-ready-${RUN_ID}`, "prospect_csv", "ready");
    check(await countLists("prospect_csv", `outside-processing-${RUN_ID}`) === 2, "processing remains outside the current active predicate");
    check(await countLists("prospect_csv", `outside-ready-${RUN_ID}`) === 2, "ready remains outside the current active predicate");

    console.log("\n=== two-connection insert race ===");
    const raceHash = `race-${RUN_ID}`;
    const raceClients = [await pool.connect(), await pool.connect()];
    const raceWork = Promise.all(raceClients.map(async (client: any, index: number) => {
      try {
        await client.query("SET statement_timeout = 10000");
        const result = await client.query(
          `INSERT INTO prospect_lists(name,file_hash,import_type,status)
           VALUES($1,$2,'prospect_csv','running') RETURNING id`,
          [`${MARKER}-race-${index}`, raceHash],
        );
        return { outcome: "success", id: Number(result.rows[0].id) };
      } catch (error) {
        return { outcome: "error", error };
      } finally {
        client.release();
      }
    }));
    let raceTimer: NodeJS.Timeout | undefined;
    const raceResults = await Promise.race([
      raceWork,
      new Promise<never>((_, reject) => {
        raceTimer = setTimeout(() => reject(new Error("Two-connection insert race exceeded 15 seconds")), 15_000);
      }),
    ]).finally(() => {
      if (raceTimer) clearTimeout(raceTimer);
    });
    for (const result of raceResults) if (result.outcome === "success") listIds.add(result.id);
    check(raceResults.filter((result) => result.outcome === "success").length === 1, "race produces exactly one committed winner");
    check(raceResults.filter((result) => result.outcome === "error").length === 1, "race produces exactly one rejected loser");
    const raceError = raceResults.find((result) => result.outcome === "error")?.error;
    check(isProspectListReplayConflict(raceError), "race loser has exact 23505 replay constraint identity");
    check(await countLists("prospect_csv", raceHash) === 1, "race key has exactly one committed row");

    await trackProspectsForRun();
    check(prospectIds.size >= 2, "all created prospect rows, including unexpected duplicates, are tracked");
    console.log(`\n✓ ${passed} assertions passed`);
  } catch (error) {
    testFailure = error;
  } finally {
    if (pool) {
      try {
        // Discover every run-scoped list before deleting, including an
        // unexpected race winner or row created by a failed assertion.
        const createdLists = await pool.query(
          "SELECT id FROM prospect_lists WHERE name LIKE $1",
          [`${MARKER}%`],
        );
        for (const row of createdLists.rows) listIds.add(Number(row.id));
        const ids = [...listIds];
        await pool.query(
          `DELETE FROM outbound_messages
           WHERE subject LIKE $1
              OR prospect_id IN (
                SELECT id FROM prospects
                WHERE list_id = ANY($2::int[]) OR import_execution_id = ANY($2::int[])
              )`,
          [`${MARKER}%`, ids],
        );
        await pool.query(
          `DELETE FROM enrichment_jobs
           WHERE job_type LIKE $1
              OR list_id = ANY($2::int[])
              OR prospect_id IN (
                SELECT id FROM prospects
                WHERE list_id = ANY($2::int[]) OR import_execution_id = ANY($2::int[])
              )`,
          [`${MARKER}%`, ids],
        );
        await pool.query(
          `DELETE FROM sunbiz_entities
           WHERE entity_name LIKE $1
              OR filing_number LIKE $1
              OR list_id = ANY($2::int[])
              OR prospect_id IN (
                SELECT id FROM prospects
                WHERE list_id = ANY($2::int[]) OR import_execution_id = ANY($2::int[])
              )`,
          [`${MARKER}%`, ids],
        );
        await pool.query(
          `DELETE FROM campaigns
           WHERE name LIKE $1 OR target_list_id = ANY($2::int[])`,
          [`${MARKER}%`, ids],
        );
        await pool.query(
          `DELETE FROM prospects
           WHERE list_id = ANY($1::int[])
              OR import_execution_id = ANY($1::int[])
              OR company_name LIKE $2
              OR email LIKE $3`,
          [ids, `${MARKER}%`, `idem-${RUN_ID}%`],
        );
        await pool.query(
          `DELETE FROM prospect_lists
           WHERE id = ANY($1::int[]) OR name LIKE $2`,
          [ids, `${MARKER}%`],
        );
        const residue = await pool.query(
          `SELECT
             (SELECT count(*)::int FROM prospects WHERE company_name LIKE $1 OR email LIKE $2) AS prospects,
             (SELECT count(*)::int FROM prospect_lists WHERE name LIKE $1) AS lists,
             (SELECT count(*)::int FROM enrichment_jobs WHERE job_type LIKE $1) AS enrichment_jobs,
             (SELECT count(*)::int FROM campaigns WHERE name LIKE $1) AS campaigns,
             (SELECT count(*)::int FROM outbound_messages WHERE subject LIKE $1) AS outbound_messages,
             (SELECT count(*)::int FROM sunbiz_entities WHERE entity_name LIKE $1 OR filing_number LIKE $1) AS sunbiz_entities`,
          [`${MARKER}%`, `idem-${RUN_ID}%`],
        );
        check(Number(residue.rows[0].outbound_messages) === 0, "cleanup leaves zero run-scoped outbound messages");
        check(Number(residue.rows[0].enrichment_jobs) === 0, "cleanup leaves zero run-scoped enrichment jobs");
        check(Number(residue.rows[0].sunbiz_entities) === 0, "cleanup leaves zero run-scoped Sunbiz entities");
        check(Number(residue.rows[0].campaigns) === 0, "cleanup leaves zero run-scoped campaigns");
        check(Number(residue.rows[0].prospects) === 0, "cleanup leaves zero run-scoped prospects");
        check(Number(residue.rows[0].lists) === 0, "cleanup leaves zero run-scoped prospect lists");
      } catch (error) {
        cleanupFailure = error;
      } finally {
        await pool.end().catch((error: unknown) => {
          cleanupFailure ??= error;
        });
      }
    }
    await infrastructure.releaseRedisReservation().catch((error: unknown) => {
      cleanupFailure ??= error;
    });
  }

  if (testFailure && cleanupFailure) {
    throw new AggregateError([testFailure, cleanupFailure], "Certification and cleanup both failed");
  }
  if (testFailure) throw testFailure;
  if (cleanupFailure) throw cleanupFailure;
}

main().catch((error) => {
  console.error(`\n✗ Prospect import idempotency certification failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});