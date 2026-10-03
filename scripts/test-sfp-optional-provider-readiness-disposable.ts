import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary } from "./certification-provider-deny";

await assertDisposableTestInfrastructure({
  operation: "SFP optional-provider readiness certification",
  requireRedis: false,
});
process.env.VG_PROVIDER_DENY_MODE = "1";
applyCertificationProviderDenyBoundary({ fatal: true });
// These are synthetic values in an infrastructure-guarded disposable process.
process.env.APOLLO_API_KEY = "optional-provider-certification-only";
process.env.OUTSCRAPER_API_KEY = "optional-provider-certification-only";
process.env.ZEROBOUNCE_API_KEY = "optional-provider-certification-only";
// Authorize only the test callback through the real dispatch boundary.
// The independent network-deny boundary still prevents external transport.
process.env.CRO03_PROVIDER_TRANSPORT_ENABLED = "true";

const { sql } = await import("drizzle-orm");
const { db, pool } = await import("../server/db");
const { getSfpProviderReadiness } = await import("../server/services/cro03/sfp-provider-operations");
const { readIndependentSfpDiscoveryReadiness, hasSfpValidationProgress } =
  await import("../server/services/cro03/sfp-continuous-progress");
const rows = (result: any): any[] => result?.rows ?? result ?? [];
const nonce = randomUUID();
const operationIds: string[] = [];
let assertions = 0;
const check = (value: unknown, message: string) => {
  assert.ok(value, message);
  assertions++;
};

async function observation(status: number, success: boolean, minutesAgo: number) {
  const id = randomUUID();
  operationIds.push(id);
  await db.execute(sql`
    INSERT INTO provider_operations
      (id,provider,operation_type,purpose,idempotency_key,actor_type,
       target_fingerprint,state,sfp_result_data,created_at,completed_at,updated_at)
    VALUES (
      ${id}::uuid,'apollo','sfp_enrichment','sfp_named_decision_maker_discovery',
      ${`optional-readiness:${nonce}:${id}`},'system',${`business:certification:${nonce}`},
      ${success ? "completed" : "failed"},
      ${JSON.stringify({ httpStatus: status, retrievalState: success ? "completed" : "failed" })}::jsonb,
      NOW()-(${minutesAgo}::text||' minutes')::interval,
      NOW()-(${minutesAgo}::text||' minutes')::interval,
      NOW()-(${minutesAgo}::text||' minutes')::interval
    )
  `);
}

try {
  await db.execute(sql`
    UPDATE provider_controls SET enabled=TRUE,circuit_state='closed'
     WHERE provider IN ('apollo','outscraper','zerobounce')
  `);
  await observation(402, false, 2);
  const failed = await readIndependentSfpDiscoveryReadiness(getSfpProviderReadiness);
  check(!failed.apollo.ready, "recent Apollo rejection suppresses automatic Apollo attempts");
  check(failed.apollo.reason === "provider_unavailable:apollo:http_402", "skip reports provider-specific availability, not a global block");
  check(failed.outscraper.ready, "Apollo credit rejection does not block Outscraper");
  check((await getSfpProviderReadiness("zerobounce")).ready, "Apollo credit rejection does not block ZeroBounce");

  await observation(200, true, 1);
  check((await getSfpProviderReadiness("apollo")).ready, "newer successful Apollo response clears the scheduling hint");
  await observation(401, false, 0);
  check(!(await getSfpProviderReadiness("apollo")).ready, "fresh rejected authorization is local to Apollo");

  await db.execute(sql`
    UPDATE provider_operations SET updated_at=NOW()-INTERVAL '16 minutes'
     WHERE id=ANY(ARRAY[${sql.join(operationIds.map(id => sql`${id}`), sql`, `)}]::uuid[])
  `);
  check((await getSfpProviderReadiness("apollo")).ready, "existing 15-minute failure cooldown expires without a new authority or manual unlock");
  await db.execute(sql`UPDATE provider_controls SET enabled=FALSE WHERE provider='apollo'`);
  const disabled = await readIndependentSfpDiscoveryReadiness(getSfpProviderReadiness);
  check(!disabled.apollo.ready && disabled.outscraper.ready, "explicitly disabled Apollo still leaves healthy discovery available");
  check((await getSfpProviderReadiness("zerobounce")).ready, "ZeroBounce remains available with Apollo disabled");

  await (await import("./helpers/sfp-runtime-test-identity"))
    .selectSfpRuntimeTestRelease(`cert:optional:${nonce}`);
  const { ensureProgram, setProgramActivation } = await import("../server/services/cro03/south-florida-prospecting");
  const { previewSfpValidation, executeSfpValidation } = await import("../server/services/cro03/sfp-validation");
  const { seal } = await import("../server/services/cro03/candidate-evidence-service");
  const { authorizePaidBudget, MI09_PAID_BUDGET_TYPED_CONFIRMATION } =
    await import("../server/services/mi09-pilot-authority");
  await authorizePaidBudget({
    authorizedBy: `cert:optional:${nonce}`,
    typedConfirmation: MI09_PAID_BUDGET_TYPED_CONFIRMATION,
  });
  const program = await ensureProgram({ createdBy: `cert:optional:${nonce}` });
  await setProgramActivation({ active: true, actorId: `cert:optional:${nonce}` });
  const business = rows(await db.execute(sql`
    INSERT INTO businesses (canonical_name,normalized_name,vertical,state,record_class)
    VALUES (${`Optional Provider Fixture ${nonce}`},${`optional provider fixture ${nonce}`},
            'Med Spa','FL','canonical') RETURNING id
  `))[0];
  const businessId = Number(business.id);
  await db.execute(sql`
    INSERT INTO business_locations (business_id,county_fips) VALUES (${businessId},'12086')
  `);
  const generation = rows(await db.execute(sql`
    INSERT INTO free_discovery_generations (run_key,actor_id,purpose,reason,state)
    VALUES (${`optional:${nonce}`},${`cert:optional:${nonce}`},'email_discovery','certification','running')
    RETURNING id
  `))[0];
  const expectedGoodEmail = `qualified-${nonce}@gmail.com`;
  for (const [email, confidence] of [
    [`unreachable-${nonce}@gmail.com`, 99],
    [expectedGoodEmail, 80],
  ] as const) {
    const sealed = seal("email", email);
    await db.execute(sql`
      INSERT INTO free_discovery_candidates
        (generation_id,business_id,field,subject_type,domain,source,attribution_scope,disposition,
         confidence,envelope_ciphertext,envelope_nonce,envelope_tag,envelope_key_version,
         normalized_value_hash,masked_value)
      VALUES (${String(generation.id)}::uuid,${businessId},'email','business','gmail.com',
              'cert-seed','role','staged',${confidence},${sealed.ciphertext},${sealed.nonce},
              ${sealed.tag},1,${sealed.normalizedValueHash},${sealed.maskedValue})
    `);
  }
  const cohortId = randomUUID();
  await db.execute(sql`
    INSERT INTO sfp_cohort_runs
      (id,program_id,idempotency_key,status,cohort_size,cohort_hash,release_sha,
       actor_id,cohort_state,request_hash,config_hash)
    VALUES (${cohortId}::uuid,${program.id}::uuid,${`optional-freeze:${nonce}`},
            'freezing',1,${nonce},${"0".repeat(40)},${`cert:optional:${nonce}`},
            'freezing',${nonce},${nonce})
  `);
  await db.execute(sql`
    INSERT INTO sfp_cohort_members
      (cohort_run_id,business_id,roi_score,geography_class,geography_source,county_fips,vertical)
    VALUES (${cohortId}::uuid,${businessId},100,'verified','fips','12086','Med Spa')
  `);
  await db.execute(sql`
    INSERT INTO sfp_cohort_decisions
      (cohort_run_id,business_id,disposition,selected,geography_class,geography_source,vertical,roi_score)
    VALUES (${cohortId}::uuid,${businessId},'selected',TRUE,'verified','fips','Med Spa',100)
  `);
  await db.execute(sql`
    UPDATE sfp_cohort_runs SET status='frozen',cohort_state='frozen',frozen_at=NOW()
     WHERE id=${cohortId}::uuid
  `);

  let transportCalls = 0;
  const zbTransport = async (_candidateId: string, email: string) => {
    check(email === expectedGoodEmail, "only the usable next address reaches fake ZeroBounce");
    transportCalls++;
    return "valid" as const;
  };
  const firstPreview = await previewSfpValidation(cohortId);
  check(firstPreview.selectedCandidates.length === 1, "first address is selected with Apollo disabled");
  const first = await executeSfpValidation(cohortId, {
    idempotencyKey: `optional-precheck:${nonce}`, actorId: `cert:optional:${nonce}`,
    snapshotHash: firstPreview.snapshotHash, zbTransport, mxCheck: async () => "no_mx",
  });
  check(first.addressesValidated === 0 && first.eligibilityRowsCreated === 1,
    "the actual validator persists its no-MX decision without a provider call");
  const firstDecision = rows(await db.execute(sql`
    SELECT decision_reason FROM sfp_outreach_eligibility
     WHERE cohort_run_id=${cohortId}::uuid AND business_id=${businessId}
  `))[0];
  check(firstDecision?.decision_reason === "precheck_no_mx:authoritative_ineligible:zero_provider_spend",
    "the zero-call batch is genuinely a completed DNS precheck, not an authority rejection");
  check(hasSfpValidationProgress(first), "the real precheck result keeps the drain actionable");
  const nextPreview = await previewSfpValidation(cohortId);
  check(nextPreview.selectedCandidates.length === 1 &&
    nextPreview.snapshotHash !== firstPreview.snapshotHash,
    "real selection advances past the rejected address to the next address");
  const next = await executeSfpValidation(cohortId, {
    idempotencyKey: `optional-valid:${nonce}`, actorId: `cert:optional:${nonce}`,
    snapshotHash: nextPreview.snapshotHash, zbTransport, mxCheck: async () => "ok",
    onProviderFailureDiagnostic: (phase, safeCode) =>
      console.log("Optional-provider fixture dispatch diagnostic:", phase, safeCode),
  });
  if (next.addressesValidated !== 1 || transportCalls !== 1) {
    console.log("Optional-provider fixture result:", next);
    console.log("Optional-provider fixture eligibility:", rows(await db.execute(sql`
      SELECT status,decision_reason FROM sfp_outreach_eligibility
       WHERE cohort_run_id=${cohortId}::uuid AND business_id=${businessId}
    `)));
  }
  check(next.addressesValidated === 1 && transportCalls === 1,
    "real validation executes the next fake ZeroBounce call without Apollo");
  check(next.zeroOutreachConfirmed, "validation does not release outbound");
  console.log(`${assertions} optional-provider readiness and real validation-selection assertions passed; zero external provider calls`);
} finally {
  await pool.end();
}