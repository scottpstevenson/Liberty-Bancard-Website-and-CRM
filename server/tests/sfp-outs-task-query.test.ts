import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { assertDisposableTestInfrastructure } from "../../scripts/test-infrastructure-guard";

await assertDisposableTestInfrastructure({
  operation: "SFP Outscraper retrieval-task query regression",
  requireRedis: false,
});

const { sql } = await import("drizzle-orm");
const { db, pool } = await import("../db");
const { processSfpOutscraperRetrievalTask } = await import("../services/cro03/sfp-paid-waterfall");
const rows = (result: any): any[] => result?.rows ?? result ?? [];
const programId = randomUUID();
const cohortRunId = randomUUID();
const stageRunId = randomUUID();
const businessId = randomUUID();
const taskId = randomUUID();
const operationId = randomUUID();
const claimToken = randomUUID();
const runtimeOwnerToken = randomUUID();
const actorId = `outscraper-task-query-cert-${randomUUID()}`;
let businessRowId: number | undefined;

try {
  const program = rows(await db.execute(sql`
    INSERT INTO sfp_programs (id,name,county_fips,vertical_ids,created_by)
    VALUES (${programId}::uuid,${`outscraper-query-${programId}`},'{}','{}',${actorId})
    RETURNING id
  `))[0];
  assert.ok(program);
  const cohort = rows(await db.execute(sql`
    INSERT INTO sfp_cohort_runs (id,program_id,idempotency_key,status,actor_id)
    VALUES (${cohortRunId}::uuid,${programId}::uuid,${`outscraper-query-${cohortRunId}`},'freezing',${actorId})
    RETURNING id
  `))[0];
  assert.ok(cohort);
  const business = rows(await db.execute(sql`
    INSERT INTO businesses (canonical_name,normalized_name,record_class)
    VALUES (${`Query fixture ${businessId}`},${`query fixture ${businessId}`},'test')
    RETURNING id
  `))[0];
  businessRowId = Number(business.id);
  await db.execute(sql`
    INSERT INTO sfp_stage_runs
      (id,cohort_run_id,stage,idempotency_key,actor_id,state,max_items,provider_keys,payload_hash)
    VALUES (${stageRunId}::uuid,${cohortRunId}::uuid,'paid_waterfall',
      ${`outscraper-query-${stageRunId}`},${actorId},'completed',1,'["outscraper"]'::jsonb,'fixture')
  `);
  await db.execute(sql`
    INSERT INTO provider_operations
      (id,provider,operation_type,purpose,idempotency_key,actor_type,actor_id,target_fingerprint,
       state,reserved_units,billing_state,claim_token,unit_price_micros,unit_price_unit,
       runtime_owner_epoch,runtime_owner_token,sfp_result_data)
    VALUES (${operationId}::uuid,'outscraper','sfp_enrichment','sfp_outscraper_maps',
      ${`outscraper-query-${operationId}`},'user',${actorId},${`business:${businessRowId}`},
      'completed',3,'committed',${claimToken}::uuid,765,'result',41,
      ${runtimeOwnerToken}::uuid,${JSON.stringify({
        reservedWorkUnit: "result",
        noResultBillable: false,
        reservedStageRunId: stageRunId,
        reservedCohortRunId: cohortRunId,
        reservedBusinessId: businessRowId,
        reservedProvider: "outscraper",
      })}::jsonb)
  `);
  const submittedAt = new Date(Date.now() - 60_000);
  const completionBound = new Date(submittedAt.getTime());
  const resultsExpireAt = new Date(completionBound.getTime() + 4 * 60 * 60 * 1000);
  await db.execute(sql`
    INSERT INTO sfp_provider_retrieval_tasks
      (id,provider,task_kind,provider_task_id,submission_operation_id,stage_run_id,cohort_run_id,
       business_id,business_name_snapshot,state,request_fingerprint,submitted_at,next_poll_at,
       completion_time_lower_bound_at,completion_time_bound_kind,results_expires_at,expires_at)
    VALUES (${taskId}::uuid,'outscraper','maps_search',${`fixture-${taskId}`},${operationId}::uuid,
       ${stageRunId}::uuid,${cohortRunId}::uuid,${businessRowId},${`Query fixture ${businessId}`},
       'completed',repeat('a',64),${submittedAt.toISOString()}::timestamptz,
       ${submittedAt.toISOString()}::timestamptz,${completionBound.toISOString()}::timestamptz,
       'submission_started',${resultsExpireAt.toISOString()}::timestamptz,
       ${new Date(Date.now() + 60 * 60 * 1000).toISOString()}::timestamptz)
  `);

  // Confirm the fixture's FK and provider-operation pins have intentionally
  // distinct owners in the real migrated schema; provider_operations has no
  // stage_run_id column for the service to accidentally read.
  const linked = rows(await db.execute(sql`
    SELECT task.stage_run_id::text AS task_stage_run_id,
           submission.unit_price_micros,submission.unit_price_unit,
           submission.runtime_owner_epoch,submission.runtime_owner_token::text AS runtime_owner_token,
           EXISTS (
             SELECT 1 FROM information_schema.columns
              WHERE table_schema=current_schema() AND table_name='provider_operations'
                AND column_name='stage_run_id'
           ) AS operation_has_stage_run_id
      FROM sfp_provider_retrieval_tasks task
      JOIN provider_operations submission ON submission.id=task.submission_operation_id
     WHERE task.id=${taskId}::uuid
  `))[0];
  assert.equal(linked.task_stage_run_id, stageRunId);
  assert.equal(Number(linked.unit_price_micros), 765);
  assert.equal(linked.unit_price_unit, "result");
  assert.equal(Number(linked.runtime_owner_epoch), 41);
  assert.equal(linked.runtime_owner_token, runtimeOwnerToken);
  assert.equal(linked.operation_has_stage_run_id, false);
  await assert.rejects(
    db.execute(sql`SELECT submission.stage_run_id FROM provider_operations submission WHERE submission.id=${operationId}::uuid`),
    (error: any) => error?.cause?.code === "42703" &&
      String(error.cause.message).includes("column submission.stage_run_id does not exist"),
  );

  const fetchCalls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    fetchCalls.push(String(input));
    throw new Error("Provider transport must not run in this regression test");
  }) as typeof fetch;
  assert.deepEqual(await processSfpOutscraperRetrievalTask({ taskId, fetchImpl }), {
    taskId, state: "completed", providerRequests: 0,
  });
  const missingTaskId = randomUUID();
  await assert.rejects(
    processSfpOutscraperRetrievalTask({ taskId: missingTaskId, fetchImpl }),
    /SFP_OUTSCRAPER_TASK_NOT_FOUND/,
  );
  assert.deepEqual(fetchCalls, []);

  const source = fs.readFileSync(
    new URL("../services/cro03/sfp-paid-waterfall.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /task\.stage_run_id AS submission_stage_run_id/);
  assert.match(source, /stageRunId: String\(row\.submission_stage_run_id\)/);
  assert.match(source, /submission\.unit_price_micros/);
  assert.match(source, /submission\.unit_price_unit/);
  assert.match(source, /submission\.runtime_owner_epoch/);
  assert.match(source, /submission\.runtime_owner_token/);
  console.log("SFP Outscraper retrieval-task real-schema query regression assertions passed");
} finally {
  await db.execute(sql`DELETE FROM sfp_provider_retrieval_tasks WHERE id=${taskId}::uuid`);
  await db.execute(sql`DELETE FROM provider_operations WHERE id=${operationId}::uuid`);
  await db.execute(sql`DELETE FROM sfp_stage_runs WHERE id=${stageRunId}::uuid`);
  await db.execute(sql`DELETE FROM sfp_cohort_runs WHERE id=${cohortRunId}::uuid`);
  await db.execute(sql`DELETE FROM sfp_programs WHERE id=${programId}::uuid`);
  if (businessRowId !== undefined) {
    await db.execute(sql`DELETE FROM businesses WHERE id=${businessRowId}`);
  }
  await pool.end();
}