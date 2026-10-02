#!/usr/bin/env npx tsx
/**
 * Task #2056 focused contact-source certification.
 *
 * This test deliberately runs only against a disposable local PostgreSQL
 * cluster launched by run-sfp2056-contact-certification-disposable.ts.
 * ZeroBounce is an in-process fake response inside the normal provider adapter,
 * DNS is stubbed, credentials are scrubbed, and all non-fake outbound requests
 * are denied by the certification HTTP boundary. Named-email review exercises
 * the registered admin GET/POST routes over loopback with a test-only auth
 * identity middleware; it does not bootstrap production session auth.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { promises as dns } from "node:dns";
import { sql } from "drizzle-orm";
import {
  applyCertificationProviderDenyBoundary,
  getBlockedCertificationNetworkAttemptCount,
} from "./certification-provider-deny";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";

await assertDisposableTestInfrastructure({
  operation: "Task #2056 C1/C2/C3/C6 contact-source certification",
  requireRedis: false,
});
process.env.VG_PROVIDER_DENY_MODE = "1";
applyCertificationProviderDenyBoundary({ fatal: true });

// Drive the production reservation/attempt/settlement path while replacing
// only ZeroBounce's fetch with a deterministic in-process response. Every
// other outbound URL still goes through the hard-deny wrapper.
const denyFetch = globalThis.fetch;
const fakeZeroBounceKey = "task-2056-disposable-zero-bounce-key";
process.env.ZEROBOUNCE_API_KEY = fakeZeroBounceKey;
process.env.CRO03_PROVIDER_TRANSPORT_ENABLED = "true";
process.env.FREE_DISCOVERY_VALIDATION_PROMOTION_ENABLED = "true";
let fakeZeroBounceCalls = 0;
globalThis.fetch = (async (input: any, init?: RequestInit) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
  if (url.origin === "https://api.zerobounce.net" && url.pathname === "/v2/validate") {
    if (url.searchParams.get("api_key") !== fakeZeroBounceKey) {
      throw new Error("CERTIFICATION_FAKE_ZEROBOUNCE_KEY_MISMATCH");
    }
    fakeZeroBounceCalls++;
    return new Response(JSON.stringify({ status: "valid", sub_status: "" }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }
  return denyFetch(input, init);
}) as typeof fetch;

// No external DNS lookup is needed for this certification; return an
// authoritative positive MX answer to the application gate locally.
(dns as any).resolveMx = async () => [{ exchange: "mx.cert.invalid", priority: 10 }];

let assertions = 0;
let failures = 0;
function check(condition: unknown, label: string): void {
  assertions++;
  try {
    assert.ok(condition, label);
    console.log(`✓ [2056-${String(assertions).padStart(2, "0")}] ${label}`);
  } catch (error) {
    failures++;
    console.error(`✗ [2056-${String(assertions).padStart(2, "0")}] ${label}: ${(error as Error).message}`);
  }
}
async function rejected(action: () => Promise<unknown>, expression: RegExp): Promise<boolean> {
  try {
    await action();
    return false;
  } catch (error) {
    const message = `${String((error as Error)?.message ?? error)} ${(error as any)?.cause?.message ?? ""}`;
    if (!expression.test(message)) console.error(`UNEXPECTED_REJECTION_REASON: ${message}`);
    return expression.test(message);
  }
}
function diagnoseBridgeResult(label: string, result: {
  status?: unknown;
  heldReason?: unknown;
  currentHoldReason?: unknown;
}): void {
  // Safe certification diagnostic only: never print source values, IDs,
  // provider receipts, credentials, or contact data.
  console.info(`BRIDGE_STATUS_DIAGNOSTIC ${label}: ${JSON.stringify({
    status: result?.status ?? null,
    heldReason: result?.heldReason ?? null,
    currentHoldReason: result?.currentHoldReason ?? null,
  })}`);
}
const rows = (r: any): any[] => r?.rows ?? r ?? [];
const runKey = `sfp2056-${randomUUID()}`;
const email = `contact-${randomUUID().slice(0, 10)}@gmail.com`;
const normalizedHash = createHash("sha256").update(`email\0${email.trim().toLowerCase()}`).digest("hex");
const tokenHash = createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
const routeReviewerId = `${runKey}-review-admin`;
let reviewApiServer: any;
let reviewApiBaseUrl = "";

const { runDrizzleMigrations } = await import("../server/db-migrate");
await runDrizzleMigrations();
const { db, pool } = await import("../server/db");
const { initializePauseControl, applyPauseMutation } =
  await import("../server/services/outbound-control-service");
const express = (await import("express")).default;
const { registerLeadOpsRoutes } = await import("../server/routes/lead-ops");
const { writeContact } = await import("../server/services/contact-writer");
const { applyConsentCommand } = await import("../server/services/consent-authority");
const { projectBusinessOnly } = await import("../server/services/cro03/projection-service");
const {
  recordContactBusinessLinkCandidate,
  decideContactBusinessLink,
} = await import("../server/services/commercial-link-authority");
const {
  getUnifiedSfpCandidates,
  openSfpCandidatePlaintext,
  resolveSfpCandidateReference,
} = await import("../server/services/cro03/sfp-paid-evidence-writer");
const { executeSfpValidation, previewSfpValidation } = await import("../server/services/cro03/sfp-validation");
const {
  previewStagingV2,
  executeStagingV2,
} = await import("../server/services/cro03/sfp-campaign-staging-v2");
const { computeLivePackageContentHash } = await import("../server/services/cro03/sfp-campaign-packages");
const { bridgeReadyHeldIntentToPausedEnrollment } = await import("../server/services/cro03/sfp-enrollment-bridge");
const { hashEmailToken } = await import("../server/services/provider-readiness-decision");
const { normalizedSfpEmailHash, sfpRecipientIdentityHash } =
  await import("../server/services/cro03/sfp-recipient-link-predicates");
const { seal } = await import("../server/services/cro03/candidate-evidence-service");
const { writeSfpPaidCandidateEvidence } = await import("../server/services/cro03/sfp-paid-evidence-writer");

try {
  const initializedPause = await initializePauseControl();
  const canonicalPause = initializedPause.state === "paused"
    ? initializedPause
    : await applyPauseMutation({
        outboundGlobalPaused: true,
        reason: "Task 2056 disposable contact certification safety fixture",
        actor: `${runKey}-certification`,
        idempotencyKey: `${runKey}-outbound-pause`,
      }).then((result) => result.control);
  if (canonicalPause.state !== "paused") {
    throw new Error("CERTIFICATION_CANONICAL_OUTBOUND_PAUSE_NOT_ESTABLISHED");
  }

  const business = rows(await db.execute(sql`
    INSERT INTO businesses (canonical_name, normalized_name, vertical, state, record_class, created_at)
    VALUES (${`${runKey} canonical trades business`}, ${`${runKey} canonical trades business`.toLowerCase()},
            NULL, 'FL', 'canonical', NOW())
    RETURNING id
  `))[0];
  const businessId = Number(business.id);
  await db.execute(sql`
    INSERT INTO business_locations
      (business_id,location_name,street_address,city,state,postal_code,county_fips,is_primary)
    VALUES (${businessId},${`${runKey} operating location`},'100 Certification Way','Miami','FL',
      '33101','12086',TRUE)
  `);

  // The canonical writer creates a genuinely unlinked contact and retained
  // source event. The admin reviewer is a different actor from that event.
  const created = await writeContact({
    mode: "local_only",
    mutation: {
      firstName: "Casey", lastName: "Trades", email, phone: "3055550199",
      companyName: `${runKey} canonical trades business`, status: "New",
    },
    provenance: {
      sourceCategory: "discovery", sourceType: "cro03",
      eventKey: `${runKey}-source-event`, actorType: "system", actorId: `${runKey}-contact-writer`,
    },
    actor: { actorType: "system", actorId: `${runKey}-contact-writer` },
    hookPolicy: {
      source: "cro03", deferValidation: true, deferReadiness: true,
      deferLeadScoring: true, suppressProviderProjection: true,
    },
  });
  const contactId = Number(created.id);
  const sourceEventId = Number(created._sourceEventId);
  const initiallyUnlinked = rows(await db.execute(sql`
    SELECT business_id, email_status FROM contacts WHERE id=${contactId}
  `))[0];
  check(initiallyUnlinked.business_id == null && initiallyUnlinked.email_status !== "valid",
    "canonical source contact begins unlinked; legacy email status is not validation proof");
  check(normalizedSfpEmailHash(email, 0) !== normalizedSfpEmailHash(email, 1) &&
    normalizedSfpEmailHash(email, 1) === normalizedHash &&
    sfpRecipientIdentityHash(email) === sfpRecipientIdentityHash(` ${email.toUpperCase()} `),
  "historical address hash versions remain distinct while recipient identity compares supported normalized addresses");

  const reviewerId = `${runKey}-admin`;
  await db.execute(sql`
    INSERT INTO users (id, email, first_name, last_name, role)
    VALUES (${reviewerId}, ${`${runKey}@cert.invalid`}, 'Validation', 'Actor', 'admin'),
           (${routeReviewerId}, ${`${runKey}-reviewer@cert.invalid`}, 'Independent', 'Reviewer', 'admin')
  `);
  const reviewApp = express();
  reviewApp.use(express.json());
  reviewApp.use((req: any, _res: any, next: () => void) => {
    req.user = { id: routeReviewerId, role: "admin" };
    req.isAuthenticated = () => true;
    next();
  });
  registerLeadOpsRoutes(reviewApp);
  reviewApiServer = reviewApp.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    reviewApiServer.once("listening", resolve);
    reviewApiServer.once("error", reject);
  });
  reviewApiBaseUrl = `http://127.0.0.1:${reviewApiServer.address().port}`;
  const candidate = await recordContactBusinessLinkCandidate({
    contactId, businessId, source: "legacy_import", sourceVersion: "cert-2056",
    candidateKey: `${runKey}-candidate`, confidence: 91,
  });
  check(Boolean(candidate?.id), "real contact-business candidate is recorded as review-only evidence");
  check((await resolveSfpCandidateReference({ sourceKind: "contact", contactId: String(contactId) })) === null,
    "candidate evidence alone does not authorize contact use");

  // Negative control: a populated FK alone remains non-authoritative.
  await db.execute(sql`UPDATE contacts SET business_id=${businessId} WHERE id=${contactId}`);
  check((await resolveSfpCandidateReference({ sourceKind: "contact", contactId: String(contactId) })) === null,
    "bare contacts.business_id FK is rejected without a current verified decision");
  check(!(await getUnifiedSfpCandidates([businessId])).some((c: any) => c.sourceKind === "contact"),
    "bare FK does not enter SFP candidate listing or winner input");
  await db.execute(sql`UPDATE contacts SET business_id=NULL WHERE id=${contactId}`);

  const approved = await decideContactBusinessLink({
    contactId, businessId, decision: "verified", decisionKey: `${runKey}-verified-1`,
    reviewerId, evidenceSourceEventId: sourceEventId, expectedRevision: 0,
  });
  const linkDecisionId = String(approved.id);
  const linkRevision = Number(approved.revision);
  check(approved.decision === "verified" && linkRevision === 1,
    "independent admin review writes current verified decision and its FK projection through the sole authority");
  const linkInput = {
    sourceKind: "contact" as const, contactId: String(contactId),
    contactBusinessLinkDecisionId: linkDecisionId, contactBusinessLinkRevision: linkRevision,
    normalizedValueHash: normalizedHash, normalizedValueHashVersion: 1,
  };
  const linkedCandidates = await getUnifiedSfpCandidates([businessId]);
  check(linkedCandidates.some((c: any) => c.sourceKind === "contact" && c.evidenceId === `contact:${contactId}`),
    "only the current verified, projection-consistent contact enters the unified candidate pool");

  let callbackSawRealEmail = false;
  const opened = await db.transaction(async (tx) => openSfpCandidatePlaintext({
    reference: linkInput, cohortRunId: randomUUID(), actorId: reviewerId, purpose: "sfp_email_validation",
  }, async (plaintext) => {
    callbackSawRealEmail = plaintext === email;
    return true;
  }, tx)).catch((error) => `ERROR:${String((error as Error).message)}`);
  // Create the actual frozen-cohort membership used by the audited opener,
  // then repeat the audited open against the real run below.
  check(String(opened).startsWith("ERROR:SFP_CANDIDATE_BUSINESS_NOT_IN_COHORT"),
    "audited contact opening fails closed before use when its business is not in the supplied cohort");

  const campaign = rows(await db.execute(sql`
    INSERT INTO campaigns (name, status, target_verticals, created_by, total_steps)
    VALUES (${`${runKey}-v2-campaign`}, 'draft', ARRAY['Construction/Trades/Home Services'],
      ${runKey}, 1)
    RETURNING id, name
  `))[0];
  const sequence = rows(await db.execute(sql`
    INSERT INTO follow_up_sequences
      (name, status, trigger_type, total_steps, sequence_family, channels_allowed, eligible_consent_tiers)
    VALUES (${`${runKey}-v2-sequence`}, 'paused', 'manual', 1,
      ${`${runKey}-v2-sequence-family`}, ARRAY['email','task'], ARRAY['first_party_role_inbox'])
    RETURNING id, name
  `))[0];
  const packageHash = await computeLivePackageContentHash(db, Number(campaign.id), Number(sequence.id));
  await db.execute(sql`
    INSERT INTO sfp_campaign_package_versions
      (package_key, vertical, campaign_id, campaign_name, sequence_id, sequence_name,
       sequence_family, content_hash, lifecycle_state, effective_at, actor_id)
    VALUES ('sfp.construction_trades_home_services.v2', 'Construction/Trades/Home Services',
      ${Number(campaign.id)}, ${String(campaign.name)}, ${Number(sequence.id)}, ${String(sequence.name)},
      ${`${runKey}-v2-sequence-family`}, ${packageHash}, 'current', NOW(), ${runKey})
  `);
  const currentPolicy = rows(await db.execute(sql`
    SELECT d.* FROM sfp_outreach_policy_control c
    JOIN sfp_outreach_policy_documents d ON d.id=c.active_policy_id
    WHERE c.singleton=TRUE
  `))[0];
  const program = rows(await db.execute(sql`
    INSERT INTO sfp_programs
      (name, county_fips, vertical_ids, max_cohort_size, policy_version, is_active, created_by,
       taxonomy_version, recurring_enabled, schedule_config)
    VALUES ('south-florida-v1', ARRAY['12086'], ARRAY['Construction/Trades/Home Services'],
      10, 1, TRUE, ${runKey}, 2, FALSE,
      '{"freeBatch":25,"paidBatch":10,"validationBatch":25,"campaignStaging":1}'::jsonb)
    ON CONFLICT (name) DO UPDATE SET
      county_fips=EXCLUDED.county_fips, vertical_ids=EXCLUDED.vertical_ids,
      max_cohort_size=EXCLUDED.max_cohort_size, policy_version=EXCLUDED.policy_version,
      is_active=TRUE, taxonomy_version=EXCLUDED.taxonomy_version, recurring_enabled=FALSE,
      schedule_config=EXCLUDED.schedule_config
    RETURNING id
  `))[0];
  const cohortRunId = randomUUID();
  const cohortHash = createHash("sha256").update(cohortRunId).digest("hex");
  await db.execute(sql`
    INSERT INTO sfp_cohort_runs
      (id, program_id, idempotency_key, status, cohort_size, cohort_hash, release_sha, actor_id,
       cohort_state, frozen_at, request_hash, config_hash)
    VALUES (${cohortRunId}::uuid, ${String(program.id)}::uuid, ${`${runKey}-cohort`},
      'freezing', 1, ${cohortHash}, ${"0".repeat(40)}, ${runKey}, 'freezing', NULL, ${cohortHash}, ${cohortHash})
  `);
  await db.execute(sql`
    INSERT INTO sfp_cohort_members
      (cohort_run_id, business_id, roi_score, geography_class, geography_source, county_fips, vertical,
       classifier_version, classifier_outcome, classifier_confidence, classifier_matched_target,
       classifier_reasons, classifier_evidence_hash, geography_resolver_version, geography_outcome)
    VALUES (${cohortRunId}::uuid, ${businessId}, 95, 'verified', 'fips', '12086', NULL,
      3, 'target', 0.99, 'Construction/Trades/Home Services', '["certified evidence"]'::jsonb,
      ${cohortHash}, 1, 'verified')
  `);
  const evidenceHash = createHash("sha256").update(`${runKey}-classification`).digest("hex");
  const evidence = rows(await db.execute(sql`
    INSERT INTO sfp_classification_evidence
      (business_id, evidence_hash, source_refs, classifier_version, model_version, prompt_version,
       policy_version, taxonomy_version, outcome, confidence, reason_codes, idempotency_key, resolved_vertical_id, admission_tier)
    VALUES (${businessId}, ${evidenceHash}, '[]'::jsonb, 3, 'cert-fixture', 'cert-fixture', 1, 2,
      'target', 0.99, '["certification"]'::jsonb, ${`${runKey}-classification`},
      'Construction/Trades/Home Services', 'resolved_high')
    RETURNING id
  `))[0];
  await db.execute(sql`
    INSERT INTO sfp_cohort_decisions
      (cohort_run_id, business_id, disposition, geography_class, geography_source, vertical, roi_score,
       selected, classifier_version, classifier_outcome, classifier_confidence, classifier_matched_target,
       classifier_reasons, classifier_evidence_hash, classification_evidence_id,
       classification_policy_version, classification_evidence_hash)
    VALUES (${cohortRunId}::uuid, ${businessId}, 'selected', 'verified', 'fips', 'Construction/Trades/Home Services',
      95, TRUE, 3, 'target', 0.99, 'Construction/Trades/Home Services',
      '["certification"]'::jsonb, ${evidenceHash}, ${String(evidence.id)}::uuid, 1, ${evidenceHash})
  `);
  await db.execute(sql`
    UPDATE sfp_cohort_runs SET status='frozen', cohort_state='frozen', frozen_at=NOW()
    WHERE id=${cohortRunId}::uuid
  `);
  const cohortOpen = await db.transaction(async (tx) => openSfpCandidatePlaintext({
    reference: linkInput, cohortRunId, actorId: reviewerId, purpose: "sfp_email_validation",
  }, async (plaintext) => {
    callbackSawRealEmail = plaintext === email;
    return { accepted: true };
  }, tx));
  check((cohortOpen as any).accepted === true && callbackSawRealEmail,
    "audited callback receives the canonical contact email only inside callback scope");
  const openAudit = rows(await db.execute(sql`
    SELECT details FROM audit_logs
    WHERE action='sfp_candidate_plaintext_opened' AND entity_key=${String(contactId)}
      AND actor_id=${reviewerId}
    ORDER BY created_at DESC LIMIT 1
  `))[0];
  check(Boolean(openAudit) && !JSON.stringify(openAudit.details).includes(email),
    "plaintext-open audit records typed source and actor without leaking email plaintext");

  // A revoked decision supersedes rather than edits the original verified row.
  const revoked = await decideContactBusinessLink({
    contactId, decision: "rejected", decisionKey: `${runKey}-rejected`,
    reviewerId, expectedRevision: 1,
  });
  check(revoked.decision === "rejected" &&
    (await resolveSfpCandidateReference({ sourceKind: "contact", contactId: String(contactId) })) === null,
  "superseded/rejected link is immediately denied by authoritative candidate resolution");
  check(await rejected(() => db.transaction(async (tx) => openSfpCandidatePlaintext({
    reference: linkInput, cohortRunId, actorId: reviewerId, purpose: "sfp_email_validation",
  }, async () => true, tx)), /SFP_CANDIDATE_REFERENCE_NOT_FOUND/),
  "revoked link is rejected before audited plaintext opening");

  const reapproved = await decideContactBusinessLink({
    contactId, businessId, decision: "verified", decisionKey: `${runKey}-verified-2`,
    reviewerId, evidenceSourceEventId: sourceEventId, expectedRevision: 2,
  });
  const activeDecisionId = String(reapproved.id);
  const activeRevision = Number(reapproved.revision);
  const activeLinkInput = { ...linkInput, contactBusinessLinkDecisionId: activeDecisionId, contactBusinessLinkRevision: activeRevision };

  // The dummy ZeroBounce key is used only by the single HTTPS URL intercepted
  // by the fake fetch above. Establish owner readiness through the real
  // process-fence and durable owner-claim APIs; do not fabricate a CRO03
  // attestation row with claimed DB/Redis health.
  const sfpRuntimeIdentity =
    await (await import("./helpers/sfp-runtime-test-identity")).getSfpRuntimeTestIdentity();
  const selectedRuntimeRelease =
    await (await import("./helpers/sfp-runtime-test-identity")).selectSfpRuntimeTestRelease(reviewerId);
  check(selectedRuntimeRelease.currentReleaseSelected &&
    selectedRuntimeRelease.selectedRelease?.selectedBy === reviewerId,
  "the private admin selects the publisher-verified test release through the normal selector API");
  const { claimSfpRuntimeDeploymentOwner } =
    await import("../server/services/cro03/sfp-provider-operations");
  const runtimeOwner = await claimSfpRuntimeDeploymentOwner();
  const persistedRuntimeOwner = rows(await db.execute(sql`
    SELECT deployment_identity,environment_identity,artifact_sha,queue_topology_hash,
           owner_epoch,owner_token,lease_expires_at,revoked_at
      FROM sfp_runtime_owner_authority
     WHERE authority_key='routine_sfp'
  `))[0];
  const fabricatedHealthAttestations = rows(await db.execute(sql`
    SELECT COUNT(*)::int AS count
      FROM cro03c_runtime_attestations
     WHERE idempotency_key LIKE ${`${runKey}%`}
  `))[0];
  check(Boolean(persistedRuntimeOwner) &&
    String(persistedRuntimeOwner.deployment_identity) === sfpRuntimeIdentity.deploymentIdentity &&
    String(persistedRuntimeOwner.environment_identity) === sfpRuntimeIdentity.environmentIdentity &&
    String(persistedRuntimeOwner.artifact_sha) === sfpRuntimeIdentity.artifactSha &&
    String(persistedRuntimeOwner.queue_topology_hash) === sfpRuntimeIdentity.queueTopologyHash &&
    Number(persistedRuntimeOwner.owner_epoch) === runtimeOwner.ownerEpoch &&
    String(persistedRuntimeOwner.owner_token) === runtimeOwner.ownerToken &&
    Date.parse(String(persistedRuntimeOwner.lease_expires_at)) > Date.now() &&
    persistedRuntimeOwner.revoked_at == null &&
    Number(fabricatedHealthAttestations.count) === 0,
  "disposable process acquires durable runtime-owner authority from its current fence without fabricated health attestation");
  const { authorizePaidBudget, MI09_PAID_BUDGET_TYPED_CONFIRMATION } =
    await import("../server/services/mi09-pilot-authority");
  await authorizePaidBudget({
    authorizedBy: `${runKey}-disposable-authority`,
    typedConfirmation: MI09_PAID_BUDGET_TYPED_CONFIRMATION,
  });
  await db.execute(sql`
    UPDATE provider_controls SET enabled=TRUE,circuit_state='closed',local_budget_units=25,
      reserved_units=0,consumed_units=0,version=version+1,updated_at=NOW()
    WHERE provider='zerobounce'
  `);

  const validationPreview = await previewSfpValidation(cohortRunId);
  const validationResult = await executeSfpValidation(cohortRunId, {
    idempotencyKey: `${runKey}-fake-zb`,
    snapshotHash: validationPreview.snapshotHash,
    actorId: reviewerId,
    maxValidations: 25,
  }).catch((error) => {
    console.error(`CONTACT_VALIDATION_CONTRACT_FINDING: ${String((error as Error).message)}`);
    return null;
  });
  check(fakeZeroBounceCalls === 1, "normal reserved ZeroBounce attempt invokes exactly one intercepted fake response");
  check(getBlockedCertificationNetworkAttemptCount() === 0,
    "all other network transports remained blocked without an attempted non-loopback call");
  check(validationResult !== null,
    "canonical contact validation persists typed link-decision and normalized-email pins under the real PostgreSQL CHECK");

  const validationRow = rows(await db.execute(sql`
    SELECT id, status, source_kind, candidate_id, paid_candidate_evidence_id, contact_id,
           contact_business_link_decision_id,
           contact_business_link_revision, normalized_value_hash, normalized_value_hash_version,
            named_contact, role_inbox, decision_reason, policy_document_id,
            validation_operation_id,reused_from_operation_id,updated_at
      FROM sfp_outreach_eligibility WHERE cohort_run_id=${cohortRunId}::uuid AND business_id=${businessId}
  `))[0];
  const providerReceiptAge = rows(await db.execute(sql`
    SELECT po.observed_at,po.expires_at,e.validation_at,e.validation_expires_at,
           d.validation_ttl_days
      FROM sfp_outreach_eligibility e
      JOIN sfp_outreach_policy_documents d ON d.id=e.policy_document_id
      JOIN provider_observations po
        ON po.operation_id=COALESCE(e.validation_operation_id,e.reused_from_operation_id)
     WHERE e.id=${String(validationRow?.id ?? "")}::uuid
       AND po.provider='zerobounce' AND po.outcome='valid' AND po.retryable=FALSE
       AND po.subject_type='business' AND po.subject_id=e.business_id
       AND po.email_token_hash=${hashEmailToken(email)}
     LIMIT 1
  `))[0];
  const receiptObservedAt = Date.parse(String(providerReceiptAge?.observed_at ?? ""));
  const receiptValidationAt = Date.parse(String(providerReceiptAge?.validation_at ?? ""));
  const receiptPolicyExpiry = receiptObservedAt +
    Number(providerReceiptAge?.validation_ttl_days ?? 0) * 86_400_000;
  const receiptExpiryLimit = providerReceiptAge?.expires_at == null
    ? receiptPolicyExpiry
    : Math.min(receiptPolicyExpiry, Date.parse(String(providerReceiptAge.expires_at)));
  check(Boolean(providerReceiptAge) && Number.isFinite(receiptObservedAt) &&
    Math.abs(receiptObservedAt - receiptValidationAt) <= 5 * 60_000 &&
    receiptObservedAt <= Date.now() && receiptPolicyExpiry > Date.now() &&
    Date.parse(String(providerReceiptAge.validation_expires_at)) <= receiptExpiryLimit &&
    (providerReceiptAge.expires_at == null ||
      Date.parse(String(providerReceiptAge.expires_at)) > Date.now()),
  "fresh eligibility binds its original provider-observation timestamp and expiry rather than trusting a rewritable validation timestamp");
  if (validationRow?.validation_operation_id) {
    const operation = rows(await db.execute(sql`
      SELECT o.state,o.billing_state,a.outcome AS attempt_outcome,po.outcome AS observation_outcome,
             c.reserved_units,c.consumed_units
        FROM provider_operations o
        JOIN provider_attempts a ON a.operation_id=o.id AND a.attempt_number=1
        JOIN provider_observations po ON po.operation_id=o.id
        JOIN provider_controls c ON c.provider=o.provider
       WHERE o.id=${String(validationRow.validation_operation_id)}::uuid
    `))[0];
    check(operation?.state === "completed" && operation?.billing_state === "committed" &&
      operation?.attempt_outcome === "completed" && operation?.observation_outcome === "valid" &&
      Number(operation?.reserved_units) === 0 && Number(operation?.consumed_units) === 1,
    "validation used the normal provider reservation, completed attempt, valid observation, and settled local unit");
  } else {
    check(false, "normal validation retained its settled provider-operation receipt");
  }
  if (validationRow) {
    check(validationRow.source_kind === "contact" && Number(validationRow.contact_id) === contactId &&
      validationRow.candidate_id == null && validationRow.paid_candidate_evidence_id == null,
      "ZeroBounce eligibility retains the exact contact source and NULLs both free/paid references");
    check(String(validationRow.contact_business_link_decision_id ?? "") === activeDecisionId &&
      Number(validationRow.contact_business_link_revision) === activeRevision &&
      String(validationRow.normalized_value_hash ?? "") === normalizedHash &&
      Number(validationRow.normalized_value_hash_version) === 1,
    "eligibility freezes the verified-link revision and v1 normalized-address identity");
    check(validationRow.named_contact === true && validationRow.role_inbox === false &&
      validationRow.status === "validated_review_required",
    "valid person contact remains named and held for named-email eligibility review, not relabeled as a role");
  }

  // Named-person addresses stay held until an independent administrator uses
  // the real review endpoints. This does not authorize sending.
  const activeNamedReviewRequired = currentPolicy.role_inbox_policy?.named_or_unclassified_requires_review !== false;
  check(activeNamedReviewRequired, "fresh default policy requires explicit review for named-person email");
  async function approveThroughNamedReviewApi(eligibilityId: string, suffix: string): Promise<string> {
    const expectedPins = rows(await db.execute(sql`
      SELECT contact_business_link_decision_id,contact_business_link_revision,
             normalized_value_hash,normalized_value_hash_version
        FROM sfp_outreach_eligibility WHERE id=${eligibilityId}::uuid
    `))[0];
    const listResponse = await fetch(`${reviewApiBaseUrl}/api/lead-ops/sfp/named-email-eligibility-reviews?limit=50`);
    const listPayload = await listResponse.json() as { reviews?: any[] };
    const item = listPayload.reviews?.find((row) => String(row.eligibility_id) === eligibilityId);
    check(listResponse.ok && Boolean(item) && item?.source_kind === "contact" &&
      Boolean(item?.masked_email) &&
      Number(expectedPins?.normalized_value_hash_version) === 1 &&
      String(expectedPins?.normalized_value_hash) === normalizedHash &&
      String(item?.contact_business_link_decision_id) === String(expectedPins?.contact_business_link_decision_id) &&
      Number(item?.contact_business_link_revision) === Number(expectedPins?.contact_business_link_revision) &&
      !JSON.stringify(listPayload).includes(email),
    `admin review GET returns the current version-1 identity and verified-link pins without plaintext (${suffix})`);
    if (!item) return "";
    const postResponse = await fetch(`${reviewApiBaseUrl}/api/lead-ops/sfp/named-email-eligibility-reviews/${eligibilityId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        decision: "approved",
        reason: "Independent admin eligibility review",
        expectedUpdatedAt: item.updated_at,
        idempotencyKey: `${runKey}-http-eligibility-review-${suffix}`,
      }),
    });
    const postPayload = await postResponse.json() as { review?: any; error?: string };
    check(postResponse.ok && postPayload.review?.decision === "approved" &&
      postPayload.review?.reviewer_id === `admin:${routeReviewerId}`,
    `admin review POST records the independent named-email decision via the real route (${suffix})`);
    return String(postPayload.review?.id ?? "");
  }
  if (validationRow) {
    const blocked = await previewStagingV2({
      cohortRunId, eligibilityIds: [String(validationRow.id)], actorId: reviewerId,
    });
    check(blocked.eligibleCount === 0 && blocked.rows[0]?.blockedReason === "named_email_requires_eligibility_review",
      "named-person eligibility is blocked at staging until the separate policy review authority approves it");
  }

  let namedReviewId: string | null = null;
  if (validationRow) {
    namedReviewId = await approveThroughNamedReviewApi(String(validationRow.id), "initial");
    const approvedPreview = await previewStagingV2({
      cohortRunId, eligibilityIds: [String(validationRow.id)], actorId: reviewerId,
    });
    check(approvedPreview.eligibleCount === 1 &&
      approvedPreview.rows[0]?.eligibilityReviewId === namedReviewId,
    "GET->POST review-route approval admits the real version-1 contact under the unchanged active policy and staging preview");
  }

  check(Boolean(validationRow), "eligibility comes exclusively from the real validation writer");
  if (!validationRow) throw new Error("CONTACT_VALIDATION_DID_NOT_PERSIST_ELIGIBILITY");
  const targetEligibilityId = String(validationRow.id);

  const pinnedPreview = await previewStagingV2({
    cohortRunId, eligibilityIds: [targetEligibilityId], actorId: reviewerId,
  });
  if (pinnedPreview.eligibleCount !== 1) {
    console.error(`CONTACT_STAGING_PREVIEW_FINDING: ${JSON.stringify(pinnedPreview.rows[0])}`);
  }
  check(pinnedPreview.eligibleCount === 1 &&
    pinnedPreview.rows[0]?.sourceKind === "contact" &&
    pinnedPreview.rows[0]?.packageKey === "sfp.construction_trades_home_services.v2",
  "contact preview routes raw-NULL canonical business using frozen admitted v2 evidence and pins the exact v2 package");

  // Changed email is rejected by the preview pin and cannot be staged.
  await db.execute(sql`
    UPDATE contacts SET email=${`changed-${email}`}, email_token_hash=${hashEmailToken(`changed-${email}`)},
      updated_at=NOW() WHERE id=${contactId}
  `);
  const changedEmailPreview = await previewStagingV2({
    cohortRunId, eligibilityIds: [targetEligibilityId], actorId: reviewerId,
  });
  check(changedEmailPreview.eligibleCount === 0 &&
    /contact_link_or_email_pin_stale/.test(String(changedEmailPreview.rows[0]?.blockedReason)),
  "changed contact email is rejected before staging by the frozen normalized identity pin");
  await db.execute(sql`
    UPDATE contacts SET email=${email}, email_token_hash=${tokenHash}, updated_at=NOW() WHERE id=${contactId}
  `);

  // Revocation between preview and execute must invalidate the exact reviewed
  // link revision at the final write boundary.
  const preRevocationPreview = await previewStagingV2({
    cohortRunId, eligibilityIds: [targetEligibilityId], actorId: reviewerId,
  });
  await decideContactBusinessLink({
    contactId, decision: "rejected", decisionKey: `${runKey}-rejected-before-stage`,
    reviewerId, expectedRevision: 3,
  });
  const rejectedExecution = await rejected(() => executeStagingV2({
    cohortRunId, eligibilityIds: [targetEligibilityId], commandKey: preRevocationPreview.commandKey,
    snapshotHash: preRevocationPreview.snapshotHash, actorId: reviewerId,
    confirmPayloadHash: preRevocationPreview.payloadHash,
  }), /SNAPSHOT|CONTACT_LINK|blocked/i);
  check(rejectedExecution, "revoked verified-link decision between preview and execute fails closed");

  const finalApproval = await decideContactBusinessLink({
    contactId, businessId, decision: "verified", decisionKey: `${runKey}-verified-final`,
    reviewerId, evidenceSourceEventId: sourceEventId, expectedRevision: 4,
  });
  const finalValidationPreview = await previewSfpValidation(cohortRunId);
  const finalValidation = await executeSfpValidation(cohortRunId, {
    idempotencyKey: `${runKey}-fake-zb-final-link-revision`,
    snapshotHash: finalValidationPreview.snapshotHash,
    actorId: reviewerId,
    maxValidations: 25,
  });
  check(finalValidation !== null,
    "new verified-link revision is admitted only after validation rechecks the current contact identity and its still-fresh valid receipt");
  const finalEligibility = rows(await db.execute(sql`
    SELECT contact_business_link_decision_id,contact_business_link_revision,normalized_value_hash,
           normalized_value_hash_version,status,validation_operation_id,reused_from_operation_id,validation_at
    FROM sfp_outreach_eligibility WHERE id=${targetEligibilityId}::uuid
  `))[0];
  check(String(finalEligibility.contact_business_link_decision_id) === String(finalApproval.id) &&
    Number(finalEligibility.contact_business_link_revision) === Number(finalApproval.revision) &&
    String(finalEligibility.normalized_value_hash) === normalizedHash &&
    Number(finalEligibility.normalized_value_hash_version) === 1 &&
     finalEligibility.status === "validated_review_required",
   "revalidation replaces the old link pin while retaining named-person review status");
  const originalReceipt = rows(await db.execute(sql`
    SELECT observed_at FROM provider_observations
     WHERE operation_id=${String(finalEligibility.reused_from_operation_id ?? "")}::uuid
       AND provider='zerobounce' AND outcome='valid' AND retryable=FALSE
       AND subject_type='business' AND subject_id=${businessId}
       AND email_token_hash=${hashEmailToken(email)}
     LIMIT 1
  `))[0];
  check(Boolean(finalEligibility.reused_from_operation_id) &&
    String(finalEligibility.validation_operation_id ?? "") === "" &&
    Boolean(originalReceipt) &&
    Math.abs(Date.parse(String(finalEligibility.validation_at)) -
      Date.parse(String(originalReceipt.observed_at))) <= 5 * 60_000,
  "reused validation preserves the original provider observation age instead of refreshing receipt freshness");
  namedReviewId = await approveThroughNamedReviewApi(targetEligibilityId, "final-link-revision");
  const finalPreview = await previewStagingV2({
    cohortRunId, eligibilityIds: [targetEligibilityId], actorId: reviewerId,
  });
  check(finalPreview.eligibleCount === 1 &&
    finalPreview.rows[0]?.sourceContactLinkDecisionId === String(finalApproval.id) &&
    finalPreview.rows[0]?.sourceContactLinkRevision === Number(finalApproval.revision) &&
    finalPreview.rows[0]?.eligibilityReviewId === namedReviewId,
  "fresh preview freezes the newly current link revision and independently approved eligibility decision");
  const stageResult = await executeStagingV2({
    cohortRunId, eligibilityIds: [targetEligibilityId], commandKey: finalPreview.commandKey,
    snapshotHash: finalPreview.snapshotHash, actorId: reviewerId,
    confirmPayloadHash: finalPreview.payloadHash,
  });
  const intent = rows(await db.execute(sql`
    SELECT id,state,source_kind,contact_id,contact_business_link_decision_id,
           contact_business_link_revision,normalized_value_hash,normalized_value_hash_version,
           candidate_id,paid_candidate_evidence_id,
            package_key,package_version_id,recipient_commitment_id,validation_snapshot,lineage
    FROM sfp_campaign_staging_intents WHERE eligibility_id=${targetEligibilityId}::uuid
  `))[0];
  check(stageResult.readyHeld === 1 && intent?.state === "ready_held",
    "package-pinned contact eligibility executes to ready_held only");
  check(intent?.source_kind === "contact" && Number(intent.contact_id) === contactId &&
    intent.candidate_id == null && intent.paid_candidate_evidence_id == null,
  "ready_held intent retains exact contact source and excludes free/paid UUID references");
  check(String(intent?.contact_business_link_decision_id) === String(finalApproval.id) &&
    Number(intent?.contact_business_link_revision) === Number(finalApproval.revision) &&
    String(intent?.normalized_value_hash) === normalizedHash &&
    Number(intent?.normalized_value_hash_version) === 1,
  "ready_held intent persists the exact validation-time link decision, revision, and versioned identity pin");
  check(String(intent?.package_key) === "sfp.construction_trades_home_services.v2",
    "held intent retains the package key selected from the frozen v2 target, not the raw NULL vertical");
  const stagedContactClaim = rows(await db.execute(sql`
    SELECT c.program_id,c.objective_key,c.recipient_identity_hash,c.recipient_identity_hash_version,
           c.business_id,c.package_version_id,c.staging_intent_id,c.state,c.committed_at,
           c.contact_id,c.contact_business_link_decision_id,
           a.source_kind,a.source_reference_id,a.normalized_value_hash,
           a.normalized_value_hash_version,a.disposition
      FROM sfp_recipient_address_commitments c
      JOIN sfp_recipient_commitment_aliases a
        ON a.commitment_id=c.id AND a.staging_intent_id=${String(intent.id)}::uuid
     WHERE c.id=${String(intent.recipient_commitment_id ?? "")}::uuid
  `))[0];
  check(Boolean(stagedContactClaim) &&
    String(stagedContactClaim.program_id) === String(program.id) &&
    stagedContactClaim.objective_key === "sfp.initial_recipient_acquisition.v1" &&
    String(stagedContactClaim.recipient_identity_hash) === sfpRecipientIdentityHash(email) &&
    Number(stagedContactClaim.recipient_identity_hash_version) === 1 &&
    Number(stagedContactClaim.business_id) === businessId &&
    String(stagedContactClaim.package_version_id) === String(intent.package_version_id) &&
    String(stagedContactClaim.staging_intent_id) === String(intent.id) &&
    stagedContactClaim.state === "claimed" && stagedContactClaim.committed_at == null &&
    stagedContactClaim.contact_id == null && stagedContactClaim.contact_business_link_decision_id == null &&
    stagedContactClaim.source_kind === "contact" &&
    String(stagedContactClaim.source_reference_id) === String(contactId) &&
    String(stagedContactClaim.normalized_value_hash) === normalizedHash &&
    Number(stagedContactClaim.normalized_value_hash_version) === 1 &&
    stagedContactClaim.disposition === "initial",
  "staging persists the versioned recipient claim and exact contact source-hash alias before bridge acceptance");

  await db.execute(sql`UPDATE campaigns SET status='archived' WHERE id=${Number(campaign.id)}`);
  const changedPackageBridge = await bridgeReadyHeldIntentToPausedEnrollment(String(intent.id), reviewerId);
  diagnoseBridgeResult("contact-package-drift", changedPackageBridge);
  const packageDriftArtifacts = rows(await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM sfp_ready_held_enrollments
        WHERE staging_intent_id=${String(intent.id)}::uuid) AS bridge_ledgers,
      (SELECT count(*)::int FROM sfp_recipient_address_commitments
        WHERE program_id=${String(program.id)}::uuid
           AND recipient_identity_hash=${sfpRecipientIdentityHash(email)}
           AND state='claimed' AND staging_intent_id=${String(intent.id)}::uuid) AS commitments
  `))[0];
  check(changedPackageBridge.status === "left_held" && changedPackageBridge.heldReason === "campaign_not_draft" &&
     Number(packageDriftArtifacts.bridge_ledgers) === 0 && Number(packageDriftArtifacts.commitments) === 1,
   "bridge revalidates live campaign state and records a hold while retaining only the pre-staging recipient claim");
  await db.execute(sql`UPDATE campaigns SET status='draft' WHERE id=${Number(campaign.id)}`);

  let concurrentRevocation: Promise<any> | null = null;
  let revocationWaitObserved = false;
  const bridge = await bridgeReadyHeldIntentToPausedEnrollment(String(intent.id), reviewerId, async (stage) => {
    if (stage !== "after_source_contact_locked") return;
    concurrentRevocation = decideContactBusinessLink({
      contactId, decision: "rejected", decisionKey: `${runKey}-concurrent-bridge-revocation`,
      reviewerId, expectedRevision: Number(finalApproval.revision),
    });
    for (let attempt = 0; attempt < 100; attempt++) {
      const waiting = await pool.query(`
        SELECT COUNT(*)::int AS n FROM pg_stat_activity
         WHERE datname=current_database() AND state='active' AND wait_event_type='Lock'
            AND query ILIKE '%pg_advisory_xact_lock(hashtextextended%'
      `);
      if (Number(waiting.rows?.[0]?.n ?? 0) > 0) {
        revocationWaitObserved = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  });
  diagnoseBridgeResult("contact-primary-bridge", bridge);
  check(bridge.status === "created" && bridge.contactResolution === "matched_existing" &&
    Number(bridge.contactId) === contactId && bridge.enrollmentStatus === "paused",
  "manual bridge reuses the pinned source contact and creates only a paused enrollment");
  check(revocationWaitObserved && concurrentRevocation !== null,
     "concurrent link revocation blocks on the bridge's contact/business graph lock of its pinned contact and decision");
  const concurrentRevocationResult = concurrentRevocation ? await concurrentRevocation : null;
  check(concurrentRevocationResult?.decision === "rejected",
    "queued revocation commits after the bridge's contact-and-decision verification transaction");
  const enrollment = rows(await db.execute(sql`
    SELECT e.status,e.contact_id,l.contact_resolution,l.contact_business_link_decision_id,
           l.contact_business_link_revision,l.recipient_commitment_id,
           c.state AS commitment_state,c.committed_at,c.contact_id AS committed_contact_id,
           c.contact_business_link_decision_id AS committed_link_id,c.recipient_identity_hash,
           c.recipient_identity_hash_version
      FROM sequence_enrollments e
    JOIN sfp_ready_held_enrollments l ON l.sequence_enrollment_id=e.id
    JOIN sfp_recipient_address_commitments c ON c.id=l.recipient_commitment_id
    WHERE l.staging_intent_id=${String(intent.id)}::uuid
  `))[0];
  check(enrollment?.status === "paused" && Number(enrollment.contact_id) === contactId,
    "bridge ledger points to the same source contact and paused sequence enrollment");
  check(String(enrollment?.contact_business_link_decision_id) === String(finalApproval.id) &&
    Number(enrollment?.contact_business_link_revision) === Number(finalApproval.revision) &&
    Boolean(enrollment?.recipient_commitment_id) &&
    enrollment?.commitment_state === "committed" && enrollment?.committed_at != null &&
    Number(enrollment?.committed_contact_id) === contactId &&
    String(enrollment?.committed_link_id) === String(finalApproval.id) &&
    String(enrollment?.recipient_identity_hash) === sfpRecipientIdentityHash(email) &&
    Number(enrollment?.recipient_identity_hash_version) === 1,
  "bridge ledger commits the original staged recipient claim to the exact verified contact/link and versioned address identity");
  const bridgeReplay = await bridgeReadyHeldIntentToPausedEnrollment(String(intent.id), reviewerId);
  diagnoseBridgeResult("contact-historical-replay", bridgeReplay);
  check(bridgeReplay.status === "already_bridged" && Number(bridgeReplay.contactId) === contactId,
    "manual bridge replay is idempotent and does not create another enrollment");
  check(bridgeReplay.currentHoldReason === "historical_contact_business_link_no_longer_current",
    "historical bridge success remains immutable while current link drift is separately surfaced and held");
  const forbidden = rows(await db.execute(sql`
    SELECT (SELECT COUNT(*)::int FROM campaign_queue_runs) AS queue_runs,
           (SELECT COUNT(*)::int FROM campaign_queue_items) AS queue_items
  `))[0];
  check(Number(forbidden.queue_runs) === 0 && Number(forbidden.queue_items) === 0,
    "ready_held and paused bridge produce no campaign dispatch queue activity");

  // Add direct free/paid CHECK coverage to the contact-source certification:
  // both legacy sources must preserve their own UUID reference exclusively.
  const missingFreeReference = await rejected(async () => {
    await db.execute(sql`
      INSERT INTO sfp_outreach_eligibility
        (cohort_run_id,business_id,source_kind,policy_version,status,decision_reason,validation_at)
      VALUES (${cohortRunId}::uuid,${businessId},'free',99,'invalid','bad-free-one-of',NOW())
    `);
  }, /source_ref_one_of|check constraint/i);
  check(missingFreeReference, "real eligibility CHECK rejects a free source without its sole free-candidate reference");
  const missingPaidReference = await rejected(async () => {
    await db.execute(sql`
      INSERT INTO sfp_outreach_eligibility
        (cohort_run_id,business_id,source_kind,policy_version,status,decision_reason,validation_at)
      VALUES (${cohortRunId}::uuid,${businessId},'paid',98,'invalid','bad-paid-one-of',NOW())
    `);
  }, /source_ref_one_of|check constraint/i);
  check(missingPaidReference, "real eligibility CHECK rejects a paid source without its sole paid-evidence reference");

  const freeEmail = `free-${runKey}@gmail.com`;
  const generation = rows(await db.execute(sql`
    INSERT INTO free_discovery_generations (run_key, actor_id, purpose, reason, state)
    VALUES (${`${runKey}-free-gen`}, ${runKey}, 'email_discovery', 'typed-source certification', 'completed')
    RETURNING id
  `))[0];
  const sealed = seal("email", freeEmail);
  const freeCandidate = rows(await db.execute(sql`
    INSERT INTO free_discovery_candidates
      (generation_id,business_id,field,subject_type,domain,source,attribution_scope,disposition,
       confidence,envelope_ciphertext,envelope_nonce,envelope_tag,envelope_key_version,
       normalized_value_hash,masked_value,created_at)
    VALUES (${String(generation.id)}::uuid,${businessId},'email','business','gmail.com',
       'certification','role','staged',90,${sealed.ciphertext},${sealed.nonce},${sealed.tag},1,
       ${sealed.normalizedValueHash},${sealed.maskedValue},NOW())
    RETURNING id
  `))[0];
  const paid = await writeSfpPaidCandidateEvidence({
    businessId, provider: "outscraper", field: "email", value: `paid-${runKey}@gmail.com`,
    subjectType: "business", confidence: 10,
  });
  const freeTyped = rows(await db.execute(sql`
    INSERT INTO sfp_outreach_eligibility
      (cohort_run_id,business_id,candidate_id,source_kind,policy_version,status,decision_reason,validation_at)
    VALUES (${cohortRunId}::uuid,${businessId},${String(freeCandidate.id)}::uuid,'free',97,'invalid','typed-free-cert',NOW())
    RETURNING source_kind,candidate_id,paid_candidate_evidence_id,contact_id
  `))[0];
  const paidTyped = rows(await db.execute(sql`
    INSERT INTO sfp_outreach_eligibility
      (cohort_run_id,business_id,paid_candidate_evidence_id,source_kind,policy_version,status,decision_reason,validation_at)
    VALUES (${cohortRunId}::uuid,${businessId},${String(paid.id)}::uuid,'paid',96,'invalid','typed-paid-cert',NOW())
    RETURNING source_kind,candidate_id,paid_candidate_evidence_id,contact_id
  `))[0];
  check(freeTyped?.source_kind === "free" && Boolean(freeTyped.candidate_id) &&
    freeTyped.paid_candidate_evidence_id == null && freeTyped.contact_id == null,
  "real free-source eligibility retains exactly candidate_id and no paid/contact references");
  check(paidTyped?.source_kind === "paid" &&
    Boolean(paidTyped.paid_candidate_evidence_id) && paidTyped.candidate_id == null && paidTyped.contact_id == null,
  "real paid-source eligibility retains exactly paid_candidate_evidence_id and no free/contact references");

  async function createFrozenBridgeCohort(suffix: string, cohortBusinessId = businessId): Promise<string> {
    const id = randomUUID();
    const digest = createHash("sha256").update(id).digest("hex");
    const cohortEvidenceHash = createHash("sha256").update(`${runKey}-${suffix}-classification`).digest("hex");
    const cohortEvidence = rows(await db.execute(sql`
      INSERT INTO sfp_classification_evidence
        (business_id,evidence_hash,source_refs,classifier_version,model_version,prompt_version,
         policy_version,taxonomy_version,outcome,confidence,reason_codes,idempotency_key,
         resolved_vertical_id,admission_tier)
      VALUES (${cohortBusinessId},${cohortEvidenceHash},'[]'::jsonb,3,'cert-fixture','cert-fixture',
        1,2,'target',0.99,'["certification"]'::jsonb,${`${runKey}-${suffix}-classification`},
        'Construction/Trades/Home Services','resolved_high')
      RETURNING id
    `))[0];
    await db.execute(sql`
      INSERT INTO sfp_cohort_runs
        (id,program_id,idempotency_key,status,cohort_size,cohort_hash,release_sha,actor_id,
         cohort_state,frozen_at,request_hash,config_hash)
      VALUES (${id}::uuid,${String(program.id)}::uuid,${`${runKey}-${suffix}`},
        'freezing',1,${digest},${"0".repeat(40)},${runKey},'freezing',NULL,${digest},${digest})
    `);
    await db.execute(sql`
      INSERT INTO sfp_cohort_members
        (cohort_run_id,business_id,roi_score,geography_class,geography_source,county_fips,vertical,
         classifier_version,classifier_outcome,classifier_confidence,classifier_matched_target,
         classifier_reasons,classifier_evidence_hash,geography_resolver_version,geography_outcome)
       VALUES (${id}::uuid,${cohortBusinessId},95,'verified','fips','12086',
        'Construction/Trades/Home Services',3,'target',0.99,'Construction/Trades/Home Services',
         '["real disposable certification classification"]'::jsonb,${cohortEvidenceHash},1,'verified')
    `);
    await db.execute(sql`
      INSERT INTO sfp_cohort_decisions
        (cohort_run_id,business_id,disposition,geography_class,geography_source,vertical,roi_score,
         selected,classifier_version,classifier_outcome,classifier_confidence,classifier_matched_target,
         classifier_reasons,classifier_evidence_hash,classification_evidence_id,
         classification_policy_version,classification_evidence_hash)
       VALUES (${id}::uuid,${cohortBusinessId},'selected','verified','fips',
        'Construction/Trades/Home Services',95,TRUE,3,'target',0.99,
        'Construction/Trades/Home Services','["real disposable certification classification"]'::jsonb,
         ${cohortEvidenceHash},${String(cohortEvidence.id)}::uuid,1,${cohortEvidenceHash})
    `);
    await db.execute(sql`
      UPDATE sfp_cohort_runs SET status='frozen',cohort_state='frozen',frozen_at=NOW()
       WHERE id=${id}::uuid
    `);
    return id;
  }

  async function validateCandidateForBridge(cohortId: string, suffix: string) {
    const preview = await previewSfpValidation(cohortId);
    const result = await executeSfpValidation(cohortId, {
      idempotencyKey: `${runKey}-${suffix}-real-validation`,
      snapshotHash: preview.snapshotHash,
      actorId: reviewerId,
      maxValidations: 25,
    });
    check(result !== null, `${suffix} source reaches eligibility through the real reserved/fake-provider validation path`);
    const cohortBusiness = rows(await db.execute(sql`
      SELECT business_id FROM sfp_cohort_members
       WHERE cohort_run_id=${cohortId}::uuid LIMIT 1
    `))[0];
    const eligibility = rows(await db.execute(sql`
      SELECT id,source_kind,candidate_id,paid_candidate_evidence_id,status,
             normalized_value_hash,normalized_value_hash_version
        FROM sfp_outreach_eligibility
       WHERE cohort_run_id=${cohortId}::uuid AND business_id=${Number(cohortBusiness.business_id)}
    `))[0];
    return eligibility;
  }

  function makeDeferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((accept) => { resolve = accept; });
    return { promise, resolve };
  }

  function observeBackground<T>(promise: Promise<T>): Promise<T> {
    void promise.catch(() => undefined);
    return promise;
  }

  async function waitForBarrier(promise: Promise<void>, errorCode: string): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        promise,
        new Promise<void>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(errorCode)), 15_000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function waitForCompletion<T>(
    promise: Promise<T>,
    errorCode: string,
    timeoutMs = 15_000,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(errorCode)), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const delay = (milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

  async function waitForApplicationLock(applicationName: string, timeoutMs = 8_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = await pool.query(`
        SELECT wait_event_type,wait_event,state
          FROM pg_stat_activity
         WHERE application_name=$1
      `, [applicationName]);
      if (result.rows.some((row: any) => row.wait_event_type === "Lock")) return true;
      await delay(25);
    }
    return false;
  }

  async function waitForBlockedQuery(
    blockerPid: number,
    queryFragment: string,
    timeoutMs = 8_000,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = await pool.query(`
        SELECT a.pid,a.wait_event_type,a.query,pg_blocking_pids(a.pid) AS blocking_pids
          FROM pg_stat_activity a
         WHERE a.pid<>pg_backend_pid()
           AND a.wait_event_type='Lock'
           AND $1=ANY(pg_blocking_pids(a.pid))
           AND a.query ILIKE $2
      `, [blockerPid, `%${queryFragment}%`]);
      if (result.rows.length > 0) return true;
      await delay(25);
    }
    return false;
  }

  async function waitForAnyBlockedQuery(queryFragment: string, timeoutMs = 8_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = await pool.query(`
        SELECT pid,wait_event_type,query
          FROM pg_stat_activity
         WHERE pid<>pg_backend_pid()
           AND wait_event_type='Lock'
           AND query ILIKE $1
      `, [`%${queryFragment}%`]);
      if (result.rows.length > 0) return true;
      await delay(25);
    }
    return false;
  }

  function classifyCanonicalSfpLockQuery(query: unknown): string {
    const normalized = String(query ?? "").toLowerCase();
    if (normalized.includes("sfp-business-safety-v1:") &&
        normalized.includes("pg_advisory_xact_lock")) return "business_safety_sentinel";
    if (normalized.includes("pg_advisory_xact_lock") &&
        normalized.includes("hashtextextended($1")) return "parameterized_advisory_lock";
    if (normalized.includes("sfp-eligibility-projection-global-v1") &&
        normalized.includes("pg_advisory_xact_lock")) return "global_eligibility_write_fence";
    if (normalized.includes("routine-sfp-runtime-owner") &&
        normalized.includes("pg_advisory_xact_lock")) return "runtime_owner_advisory_fence";
    if (normalized.includes("sfp_runtime_owner_authority") &&
        normalized.includes("for update")) return "runtime_owner_authority_row";
    if (normalized.includes("sfp_recipient_address_commitments") &&
        normalized.includes("for update")) return "recipient_commitment_owner_row";
    if (normalized.includes("sfp-bridge-recipient:") &&
        normalized.includes("pg_advisory_xact_lock")) return "recipient_identity_advisory_fence";
    if (normalized.includes("update contacts set do_not_contact")) return "consent_contact_projection";
    if (normalized.includes("insert into sdr_merchants")) return "existing_customer_fact_writer";
    if (normalized.includes("canonical_source_links") &&
        (normalized.includes("insert into") || normalized.includes("update "))) return "dbpr_lineage_writer";
    if (normalized.includes("from businesses") && normalized.includes("for update")) {
      return "business_organization_tuple";
    }
    return "other_lock";
  }

  async function waitForCanonicalSfpAuthorityContention(timeoutMs = 8_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    let lastSafeWaits: Array<{ queryClass: string; waitEventType: string; waitEvent: string }> = [];
    while (Date.now() < deadline) {
      const result = await pool.query(`
        SELECT a.wait_event_type,a.wait_event,a.query,pg_blocking_pids(a.pid) AS blocking_pids,
               ARRAY(
                 SELECT b.state FROM pg_stat_activity b
                  WHERE b.pid=ANY(pg_blocking_pids(a.pid))
               ) AS blocking_states
          FROM pg_stat_activity a
         WHERE a.pid<>pg_backend_pid()
           AND a.state='active'
           AND a.wait_event_type='Lock'
      `);
      const waits = result.rows.map((row: any) => ({
        queryClass: classifyCanonicalSfpLockQuery(row.query),
        waitEventType: String(row.wait_event_type ?? "unknown"),
        waitEvent: String(row.wait_event ?? "unknown"),
        hasBlocker: Array.isArray(row.blocking_pids) && row.blocking_pids.length > 0,
        blockedByHeldTransaction: Array.isArray(row.blocking_states) &&
          row.blocking_states.includes("idle in transaction"),
      }));
      lastSafeWaits = waits
        .map(({ queryClass, waitEventType, waitEvent }: any) => ({ queryClass, waitEventType, waitEvent }));
      const canonicalWait = waits.find((wait: any) =>
        ["global_eligibility_write_fence", "runtime_owner_advisory_fence",
          "runtime_owner_authority_row", "recipient_commitment_owner_row",
          "recipient_identity_advisory_fence"].includes(wait.queryClass) &&
        wait.hasBlocker && wait.blockedByHeldTransaction);
      if (canonicalWait) {
        console.info("SFP_CONCURRENCY_SQL_WAIT_DIAGNOSTIC", JSON.stringify({
          observed: true,
          queryClass: canonicalWait.queryClass,
          waitEventType: canonicalWait.waitEventType,
          waitEvent: canonicalWait.waitEvent,
          blocker: "held_transaction",
        }));
        return true;
      }
      await delay(25);
    }
    console.info("SFP_CONCURRENCY_SQL_WAIT_DIAGNOSTIC", JSON.stringify({
      observed: false,
      classifiedWaits: lastSafeWaits.slice(0, 8),
    }));
    return false;
  }

  async function readSafeLockWaits(): Promise<Array<{
    queryClass: string;
    waitEventType: string;
    waitEvent: string;
    blockerClass: string;
    blockerState: string;
  }>> {
    const result = await pool.query(`
      SELECT a.wait_event_type,a.wait_event,
             CASE
               WHEN a.query ILIKE '%sfp-business-safety-v1:%'
                 AND a.query ILIKE '%pg_advisory_xact_lock%' THEN 'business_safety_sentinel'
               WHEN a.query ILIKE '%sfp-eligibility-projection-global-v1%'
                 AND a.query ILIKE '%pg_advisory_xact_lock%' THEN 'global_eligibility_write_fence'
               WHEN a.query ILIKE '%routine-sfp-runtime-owner%'
                 AND a.query ILIKE '%pg_advisory_xact_lock%' THEN 'runtime_owner_advisory_fence'
               WHEN a.query ILIKE '%sfp_runtime_owner_authority%'
                 AND a.query ILIKE '%for update%' THEN 'runtime_owner_authority_row'
               WHEN a.query ILIKE '%sfp_recipient_address_commitments%'
                 AND a.query ILIKE '%for update%' THEN 'recipient_commitment_owner_row'
               WHEN a.query ILIKE '%sfp-bridge-recipient:%'
                 AND a.query ILIKE '%pg_advisory_xact_lock%' THEN 'recipient_identity_advisory_fence'
               WHEN a.query ILIKE '%update contacts set do_not_contact%' THEN 'consent_contact_projection'
               WHEN a.query ILIKE '%hashtextextended($1%' THEN 'parameterized_advisory_lock'
               WHEN a.query ILIKE '%from businesses%' AND a.query ILIKE '%for update%'
                 THEN 'business_organization_tuple'
               ELSE 'other_lock'
             END AS query_class,
             pg_blocking_pids(a.pid) AS blocking_pids,
             ARRAY(
               SELECT b.state FROM pg_stat_activity b
                WHERE b.pid=ANY(pg_blocking_pids(a.pid))
             ) AS blocking_states,
             ARRAY(
               SELECT CASE
                        WHEN b.query ILIKE '%insert into sdr_merchants%' THEN 'existing_customer_fact_writer'
                        WHEN b.query ILIKE '%canonical_source_links%' THEN 'dbpr_lineage_writer'
                        WHEN b.query ILIKE '%update contacts set do_not_contact%' THEN 'consent_contact_projection'
                        WHEN b.query ILIKE '%sfp-business-safety-v1:%' THEN 'business_safety_sentinel_holder'
                        ELSE 'other_transaction'
                      END
                 FROM pg_stat_activity b
                WHERE b.pid=ANY(pg_blocking_pids(a.pid))
             ) AS blocking_queries
        FROM pg_stat_activity a
       WHERE a.pid<>pg_backend_pid()
         AND a.state='active'
         AND a.wait_event_type='Lock'
    `);
    return result.rows
      .filter((row: any) => Array.isArray(row.blocking_pids) && row.blocking_pids.length > 0)
      .map((row: any) => {
        const states = Array.isArray(row.blocking_states) ? row.blocking_states.map(String) : [];
        const blockerClasses = Array.isArray(row.blocking_queries)
          ? [...new Set(row.blocking_queries.map(String))]
          : [];
        return {
          queryClass: String(row.query_class ?? "other_lock"),
          waitEventType: String(row.wait_event_type ?? "unknown"),
          waitEvent: String(row.wait_event ?? "unknown"),
          blockerClass: blockerClasses[0] === "existing_customer_fact_writer" &&
            states.includes("idle in transaction")
              ? "test_existing_customer_writer_transaction"
              : String(blockerClasses[0] ?? "unknown_blocker"),
          blockerState: states.includes("idle in transaction") ? "idle_in_transaction" : "active_or_other",
        };
      });
  }

  async function readSafeAdvisoryWaitForKey(
    lockKey: string,
    queryClass: string,
    options: {
      dispatchPinsHookHeld?: boolean;
      expectedBlockerPid?: number;
      expectedBlockerClass?: string;
    } = {},
  ): Promise<{
    queryClass: string;
    waitEventType: string;
    waitEvent: string;
    blockerClass: string;
    blockerState: string;
    blockerMatchesExpected: boolean;
  } | null> {
    const result = await pool.query(`
      WITH target_lock AS (
        SELECT hashtextextended($1::text,0) AS lock_key
      )
      SELECT a.wait_event_type,a.wait_event,
             pg_blocking_pids(a.pid) AS blocking_pids,
             ARRAY(
               SELECT b.state FROM pg_stat_activity b
                WHERE b.pid=ANY(pg_blocking_pids(a.pid))
             ) AS blocking_states
        FROM pg_locks waiting_lock
        JOIN pg_stat_activity a ON a.pid=waiting_lock.pid
        CROSS JOIN target_lock
       WHERE waiting_lock.locktype='advisory'
         AND waiting_lock.granted=FALSE
         AND waiting_lock.classid=((target_lock.lock_key >> 32) & 4294967295)::oid
         AND waiting_lock.objid=(target_lock.lock_key & 4294967295)::oid
         AND waiting_lock.objsubid=1
         AND a.pid<>pg_backend_pid()
         AND a.state='active'
    `, [lockKey]);
    const row = result.rows.find((candidate: any) =>
      Array.isArray(candidate.blocking_pids) &&
      candidate.blocking_pids.length > 0 &&
      (options.expectedBlockerPid === undefined ||
        candidate.blocking_pids.map(Number).includes(options.expectedBlockerPid)));
    if (!row) return null;
    const states = Array.isArray(row.blocking_states) ? row.blocking_states.map(String) : [];
    const blockerState = states.includes("idle in transaction") ? "idle_in_transaction" : "active_or_other";
    const blockerMatchesExpected = options.expectedBlockerPid !== undefined &&
      Array.isArray(row.blocking_pids) &&
      row.blocking_pids.map(Number).includes(options.expectedBlockerPid);
    return {
      queryClass,
      waitEventType: String(row.wait_event_type ?? "unknown"),
      waitEvent: String(row.wait_event ?? "unknown"),
      blockerClass: blockerMatchesExpected && options.expectedBlockerClass &&
        blockerState === "idle_in_transaction"
        ? options.expectedBlockerClass
        : options.dispatchPinsHookHeld && blockerState === "idle_in_transaction"
        ? "test_dispatch_pins_hook_transaction"
        : "other_transaction",
      blockerState,
      blockerMatchesExpected,
    };
  }

  async function waitForContactAddressContention(email: string, timeoutMs = 8_000): Promise<{
    observed: boolean;
    harnessBarrierContention: boolean;
    diagnostic: { queryClass: string; waitEventType: string; waitEvent: string; blockerClass: string; blockerState: string } | null;
  }> {
    const deadline = Date.now() + timeoutMs;
    const lockKey = `sfp-contact-address-v1:${email.trim().toLowerCase()}`;
    let lastWait: Awaited<ReturnType<typeof readSafeAdvisoryWaitForKey>> = null;
    while (Date.now() < deadline) {
      lastWait = await readSafeAdvisoryWaitForKey(
        lockKey,
        "canonical_contact_address_advisory_lock",
        { dispatchPinsHookHeld: true },
      );
      if (lastWait) {
        const harnessBarrierContention =
          lastWait.blockerClass === "test_dispatch_pins_hook_transaction" &&
          lastWait.blockerState === "idle_in_transaction";
        console.info("CONTACT_SUPPRESSION_LOCK_DIAGNOSTIC", JSON.stringify({
          phase: "dispatch_marker_before_provider_io",
          harnessBarrierHeld: true,
          observed: true,
          harnessBarrierContention,
          queryClass: lastWait.queryClass,
          waitEventType: lastWait.waitEventType,
          waitEvent: lastWait.waitEvent,
          blockerClass: lastWait.blockerClass,
          blockerState: lastWait.blockerState,
        }));
        return { observed: true, harnessBarrierContention, diagnostic: lastWait };
      }
      await delay(25);
    }
    console.info("CONTACT_SUPPRESSION_LOCK_DIAGNOSTIC", JSON.stringify({
      phase: "dispatch_marker_before_provider_io",
      harnessBarrierHeld: true,
      observed: false,
      expectedQueryClass: "canonical_contact_address_advisory_lock",
      lastObservedWait: lastWait,
    }));
    return {
      observed: false,
      harnessBarrierContention: false,
      diagnostic: lastWait,
    };
  }

  async function waitForPendingEligibilityGlobalFence(
    blockerPid: number,
    timeoutMs = 8_000,
  ): Promise<{
    observed: boolean;
    queryClass: string | null;
    waitEventType: string | null;
    waitEvent: string | null;
    blockerClass: string | null;
    blockerState: string | null;
    blockerMatchesPendingWriter: boolean;
  }> {
    const deadline = Date.now() + timeoutMs;
    let lastWait: Awaited<ReturnType<typeof readSafeAdvisoryWaitForKey>> = null;
    while (Date.now() < deadline) {
      lastWait = await readSafeAdvisoryWaitForKey(
        "sfp-eligibility-projection-global-v1",
        "global_eligibility_write_fence",
        {
          expectedBlockerPid: blockerPid,
          expectedBlockerClass: "test_pending_eligibility_writer_transaction",
        },
      );
      if (lastWait) {
        const observed =
          lastWait.waitEventType === "Lock" &&
          lastWait.waitEvent === "advisory" &&
          lastWait.blockerState === "idle_in_transaction" &&
          lastWait.blockerMatchesExpected &&
          lastWait.blockerClass === "test_pending_eligibility_writer_transaction";
        const diagnostic = {
          observed,
          queryClass: lastWait.queryClass,
          waitEventType: lastWait.waitEventType,
          waitEvent: lastWait.waitEvent,
          blockerClass: lastWait.blockerClass,
          blockerState: lastWait.blockerState,
          blockerMatchesPendingWriter: lastWait.blockerMatchesExpected,
        };
        console.info("ELIGIBILITY_UNIQUE_WAIT_LOCK_DIAGNOSTIC", JSON.stringify(diagnostic));
        return diagnostic;
      }
      await delay(25);
    }
    const diagnostic = {
      observed: false,
      queryClass: null,
      waitEventType: null,
      waitEvent: null,
      blockerClass: null,
      blockerState: null,
      blockerMatchesPendingWriter: false,
    };
    console.info("ELIGIBILITY_UNIQUE_WAIT_LOCK_DIAGNOSTIC", JSON.stringify({
      ...diagnostic,
      expectedQueryClass: "global_eligibility_write_fence",
    }));
    return diagnostic;
  }

  async function waitForSafeLockQueryClass(
    queryClass: string,
    phase: string,
    timeoutMs = 5_000,
  ): Promise<{
    observed: boolean;
    queryClass: string | null;
    waitEventType: string | null;
    waitEvent: string | null;
    blockerClass: string | null;
    blockerState: string | null;
  }> {
    const deadline = Date.now() + timeoutMs;
    let lastWaits: Awaited<ReturnType<typeof readSafeLockWaits>> = [];
    while (Date.now() < deadline) {
      lastWaits = await readSafeLockWaits();
      const match = lastWaits.find((wait) => wait.queryClass === queryClass);
      if (match) {
        const diagnostic = {
          observed: true,
          queryClass: match.queryClass,
          waitEventType: match.waitEventType,
          waitEvent: match.waitEvent,
          blockerClass: match.blockerClass,
          blockerState: match.blockerState,
        };
        console.info("ABSENCE_WRITER_LOCK_DIAGNOSTIC", JSON.stringify({
          phase,
          ...diagnostic,
        }));
        return diagnostic;
      }
      await delay(25);
    }
    const lastMatch = lastWaits.find((wait) => wait.queryClass === queryClass) ?? lastWaits[0];
    const diagnostic = {
      observed: false,
      queryClass: lastMatch?.queryClass ?? null,
      waitEventType: lastMatch?.waitEventType ?? null,
      waitEvent: lastMatch?.waitEvent ?? null,
      blockerClass: lastMatch?.blockerClass ?? null,
      blockerState: lastMatch?.blockerState ?? null,
    };
    console.info("ABSENCE_WRITER_LOCK_DIAGNOSTIC", JSON.stringify({
      phase,
      ...diagnostic,
      expectedQueryClass: queryClass,
    }));
    return diagnostic;
  }

  async function monitorSafeLockWaitsUntilSettled(
    promise: Promise<unknown>,
    phase: string,
    timeoutMs = 7_000,
  ): Promise<void> {
    let settled = false;
    void promise.then(() => { settled = true; }, () => { settled = true; });
    const deadline = Date.now() + timeoutMs;
    const observed = new Map<string, {
      queryClass: string; waitEventType: string; waitEvent: string; blockerClass: string; blockerState: string;
    }>();
    while (!settled && Date.now() < deadline) {
      for (const wait of await readSafeLockWaits()) {
        const key = [wait.queryClass, wait.waitEventType, wait.waitEvent, wait.blockerClass, wait.blockerState].join("|");
        observed.set(key, wait);
      }
      if (!settled) await delay(40);
    }
    console.info("CONTACT_SUPPRESSION_FINALIZATION_LOCK_DIAGNOSTIC", JSON.stringify({
      phase,
      settledBeforeDiagnosticTimeout: settled,
      classifiedWaits: [...observed.values()].slice(0, 8),
    }));
  }

  async function connectHeldWriter(applicationName: string) {
    const client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SELECT set_config('application_name',$1,true)", [applicationName]);
    return client;
  }

  async function createRaceFreeFixture(suffix: string, value = `${suffix}-${runKey}@gmail.com`) {
    const businessName = `${runKey} ${suffix} barrier business`;
    const websiteDomain = `${runKey}-${suffix}.cert.invalid`;
    const businessRow = rows(await db.execute(sql`
      INSERT INTO businesses
        (canonical_name,normalized_name,website_domain,vertical,state,record_class,created_at)
      VALUES (${businessName},${businessName.toLowerCase()},${websiteDomain},NULL,'FL','canonical',NOW())
      RETURNING id
    `))[0];
    const raceBusinessId = Number(businessRow.id);
    await db.execute(sql`
      INSERT INTO business_locations
        (business_id,location_name,street_address,city,state,postal_code,county_fips,is_primary)
      VALUES (${raceBusinessId},${`${runKey}-${suffix}-location`},'300 Certification Way',
        'Miami','FL','33101','12086',TRUE)
    `);
    const sealedAddress = seal("email", value);
    const candidateRow = rows(await db.execute(sql`
      INSERT INTO free_discovery_candidates
        (generation_id,business_id,field,subject_type,domain,source,attribution_scope,disposition,
         confidence,envelope_ciphertext,envelope_nonce,envelope_tag,envelope_key_version,
         normalized_value_hash,masked_value,created_at)
      VALUES (${String(generation.id)}::uuid,${raceBusinessId},'email','business','gmail.com',
        'certification','role','staged',90,${sealedAddress.ciphertext},${sealedAddress.nonce},
        ${sealedAddress.tag},1,${sealedAddress.normalizedValueHash},${sealedAddress.maskedValue},NOW())
      RETURNING id
    `))[0];
    const raceCohortId = await createFrozenBridgeCohort(`${suffix}-barrier-cohort`, raceBusinessId);
    return {
      businessId: raceBusinessId,
      businessName,
      websiteDomain,
      email: value,
      candidateId: String(candidateRow.id),
      cohortId: raceCohortId,
      normalizedValueHash: sealedAddress.normalizedValueHash,
    };
  }

  async function stageBridgeSource(
    cohortId: string,
    eligibilityId: string,
    suffix: string,
    expectMasterLead = true,
  ) {
    const preview = await previewStagingV2({
      cohortRunId: cohortId, eligibilityIds: [eligibilityId], actorId: reviewerId,
    });
    check(preview.eligibleCount === 1, `${suffix} source passes the shared current staging eligibility/package predicate`);
    const stage = await executeStagingV2({
      cohortRunId: cohortId, eligibilityIds: [eligibilityId], commandKey: preview.commandKey,
      snapshotHash: preview.snapshotHash, actorId: reviewerId, confirmPayloadHash: preview.payloadHash,
    });
    const stagedIntent = rows(await db.execute(sql`
      SELECT id,state,source_kind,contact_id,candidate_id,paid_candidate_evidence_id,
             package_version_id,package_key,normalized_value_hash,normalized_value_hash_version,
             recipient_commitment_id,master_lead_id
        FROM sfp_campaign_staging_intents WHERE eligibility_id=${eligibilityId}::uuid
    `))[0];
    const stagedSourcePins = rows(await db.execute(sql`
      SELECT e.source_kind,e.candidate_id,e.paid_candidate_evidence_id,e.contact_id,
             e.normalized_value_hash,e.normalized_value_hash_version,
             fc.normalized_value_hash AS free_source_hash,
             pe.normalized_value_hash AS paid_source_hash,c.email AS contact_email
        FROM sfp_outreach_eligibility e
        LEFT JOIN free_discovery_candidates fc ON fc.id=e.candidate_id
        LEFT JOIN sfp_paid_candidate_evidence pe ON pe.id=e.paid_candidate_evidence_id
        LEFT JOIN contacts c ON c.id=e.contact_id
       WHERE e.id=${eligibilityId}::uuid
    `))[0];
    const expectedSourceHash = stagedSourcePins?.source_kind === "free"
      ? String(stagedSourcePins.free_source_hash ?? "")
      : stagedSourcePins?.source_kind === "paid"
        ? String(stagedSourcePins.paid_source_hash ?? "")
        : stagedSourcePins?.source_kind === "contact"
          ? normalizedSfpEmailHash(String(stagedSourcePins.contact_email ?? ""), Number(stagedSourcePins.normalized_value_hash_version))
          : "";
    const sourceReferencesAreExclusive =
      (stagedSourcePins?.source_kind === "free" &&
        Boolean(stagedSourcePins.candidate_id) &&
        stagedSourcePins.paid_candidate_evidence_id == null && stagedSourcePins.contact_id == null) ||
      (stagedSourcePins?.source_kind === "paid" &&
        Boolean(stagedSourcePins.paid_candidate_evidence_id) &&
        stagedSourcePins.candidate_id == null && stagedSourcePins.contact_id == null) ||
      (stagedSourcePins?.source_kind === "contact" &&
        Boolean(stagedSourcePins.contact_id) &&
        stagedSourcePins.candidate_id == null && stagedSourcePins.paid_candidate_evidence_id == null);
    const stagedSourceReferenceMatches =
      stagedSourcePins?.source_kind === "free"
        ? String(stagedSourcePins.candidate_id) === String(stagedIntent?.candidate_id) &&
          stagedIntent?.paid_candidate_evidence_id == null && stagedIntent?.contact_id == null
        : stagedSourcePins?.source_kind === "paid"
          ? String(stagedSourcePins.paid_candidate_evidence_id) === String(stagedIntent?.paid_candidate_evidence_id) &&
            stagedIntent?.candidate_id == null && stagedIntent?.contact_id == null
          : stagedSourcePins?.source_kind === "contact"
            ? String(stagedSourcePins.contact_id) === String(stagedIntent?.contact_id) &&
              stagedIntent?.candidate_id == null && stagedIntent?.paid_candidate_evidence_id == null
            : false;
    check(stagedSourcePins?.source_kind === stagedIntent?.source_kind &&
      sourceReferencesAreExclusive &&
      stagedSourceReferenceMatches &&
      Number(stagedSourcePins.normalized_value_hash_version) === 1 &&
      String(stagedSourcePins.normalized_value_hash) === expectedSourceHash,
    `${suffix} staging preserves its actual source hash/version and exact source-reference NULL contract`);
    check(stage.readyHeld === 1 && stagedIntent?.state === "ready_held",
      `${suffix} source stages as one paused-ready held intent only`);
    const persistedClaim = rows(await db.execute(sql`
      SELECT program_id,objective_key,recipient_identity_hash,recipient_identity_hash_version,
             package_version_id,state,committed_at
        FROM sfp_recipient_address_commitments
       WHERE id=${String(stagedIntent?.recipient_commitment_id ?? "")}::uuid
    `))[0];
    check(Boolean(persistedClaim) &&
      String(persistedClaim.program_id) === String(program.id) &&
      persistedClaim.objective_key === "sfp.initial_recipient_acquisition.v1" &&
      /^[0-9a-f]{64}$/.test(String(persistedClaim.recipient_identity_hash)) &&
      Number(persistedClaim.recipient_identity_hash_version) === 1 &&
      String(persistedClaim.package_version_id) === String(stagedIntent?.package_version_id) &&
      ((persistedClaim.state === "claimed" && persistedClaim.committed_at == null) ||
        (persistedClaim.state === "committed" && persistedClaim.committed_at != null)) &&
      Boolean(stagedIntent?.recipient_commitment_id) &&
      Boolean(stagedIntent?.master_lead_id) === expectMasterLead,
    `${suffix} source persists its real program/address commitment in claimed state before projection or duplicate suppression`);
    return stagedIntent;
  }

  const freeCohortId = await createFrozenBridgeCohort("free-bridge-cohort");
  const freeEligibility = await validateCandidateForBridge(freeCohortId, "free-source");
  check(freeEligibility?.source_kind === "free" &&
    String(freeEligibility.candidate_id) === String(freeCandidate.id) &&
    freeEligibility.paid_candidate_evidence_id == null,
  "free validation preserves the genuine free candidate source identity");
  if (!freeEligibility) throw new Error("FREE_BRIDGE_ELIGIBILITY_NOT_CREATED");
  const freeIntent = await stageBridgeSource(freeCohortId, String(freeEligibility.id), "free");
  if (!freeIntent) throw new Error("FREE_BRIDGE_INTENT_NOT_CREATED");

  const originalEligibilityTime = rows(await db.execute(sql`
    SELECT validation_at,validation_expires_at,updated_at
      FROM sfp_outreach_eligibility WHERE id=${String(freeEligibility.id)}::uuid
  `))[0];
  await db.execute(sql`
    UPDATE sfp_outreach_eligibility
       SET validation_at=validation_at-INTERVAL '10 minutes',
           validation_expires_at=validation_expires_at-INTERVAL '10 minutes',
           updated_at=NOW()
     WHERE id=${String(freeEligibility.id)}::uuid
  `);
  const staleEligibilityTimeBridge = await bridgeReadyHeldIntentToPausedEnrollment(
    String(freeIntent.id), reviewerId,
  );
  diagnoseBridgeResult("eligibility-receipt-time-drift", staleEligibilityTimeBridge);
  check(staleEligibilityTimeBridge.status === "left_held" &&
    staleEligibilityTimeBridge.heldReason === "receipt_subject_or_address_changed",
  "SQL commit-time receipt fence rejects an eligibility timestamp rewrite even when its shifted TTL remains fresh");
  await db.execute(sql`
    UPDATE sfp_outreach_eligibility
       SET validation_at=${originalEligibilityTime.validation_at},
           validation_expires_at=${originalEligibilityTime.validation_expires_at},
           updated_at=${originalEligibilityTime.updated_at}
     WHERE id=${String(freeEligibility.id)}::uuid
  `);

  const originalFreeSource = rows(await db.execute(sql`
    SELECT envelope_ciphertext,envelope_nonce,envelope_tag,envelope_key_version,normalized_value_hash
      FROM free_discovery_candidates WHERE id=${String(freeCandidate.id)}::uuid
  `))[0];
  const changedFreeSource = seal("email", `changed-${runKey}@gmail.com`);
  await db.execute(sql`
    UPDATE free_discovery_candidates
       SET envelope_ciphertext=${changedFreeSource.ciphertext},
           envelope_nonce=${changedFreeSource.nonce},
           envelope_tag=${changedFreeSource.tag},
           envelope_key_version=1,
           normalized_value_hash=${changedFreeSource.normalizedValueHash}
     WHERE id=${String(freeCandidate.id)}::uuid
  `);
  const sourceDriftBridge = await bridgeReadyHeldIntentToPausedEnrollment(String(freeIntent.id), reviewerId);
  diagnoseBridgeResult("free-source-address-drift", sourceDriftBridge);
  const sourceDriftArtifacts = rows(await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM contacts WHERE lower(email)=lower(${freeEmail})) AS contacts,
      (SELECT count(*)::int FROM sfp_recipient_address_commitments
        WHERE program_id=${String(program.id)}::uuid
          AND recipient_identity_hash=${sfpRecipientIdentityHash(freeEmail)}
          AND state='claimed' AND staging_intent_id=${String(freeIntent.id)}::uuid) AS commitments
  `))[0];
  check(sourceDriftBridge.status === "left_held" &&
    sourceDriftBridge.heldReason === "free_source_address_hash_changed" &&
    Number(sourceDriftArtifacts.contacts) === 0 && Number(sourceDriftArtifacts.commitments) === 1,
  "bridge re-reads and rejects a source-address mutation after staging without creating a CRM identity or accepting the staged recipient claim");
  await db.execute(sql`
    UPDATE free_discovery_candidates
       SET envelope_ciphertext=${originalFreeSource.envelope_ciphertext},
           envelope_nonce=${originalFreeSource.envelope_nonce},
           envelope_tag=${originalFreeSource.envelope_tag},
           envelope_key_version=${Number(originalFreeSource.envelope_key_version)},
           normalized_value_hash=${String(originalFreeSource.normalized_value_hash)}
     WHERE id=${String(freeCandidate.id)}::uuid
  `);

  // Inject a failure after the canonical contact, typed evidence-backed link,
  // claimed-to-committed transition, and paused enrollment have all been
  // written in the bridge transaction. Only the earlier staging claim remains.
  const rollbackResult = await rejected(() => bridgeReadyHeldIntentToPausedEnrollment(
    String(freeIntent.id), reviewerId, async (stage) => {
      if (stage === "after_enrollment_before_ledger") throw new Error("CERT_SFP_BRIDGE_ROLLBACK");
    },
  ), /CERT_SFP_BRIDGE_ROLLBACK/);
  const rollbackArtifacts = rows(await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM contacts WHERE lower(email)=lower(${freeEmail})) AS contacts,
      (SELECT count(*)::int FROM contact_business_sfp_link_evidence
        WHERE eligibility_id=${String(freeEligibility.id)}::uuid) AS typed_links,
      (SELECT count(*)::int FROM sfp_recipient_address_commitments
        WHERE program_id=${String(program.id)}::uuid
          AND recipient_identity_hash=${sfpRecipientIdentityHash(freeEmail)}
          AND state='claimed' AND staging_intent_id=${String(freeIntent.id)}::uuid) AS commitments,
      (SELECT count(*)::int FROM sfp_ready_held_enrollments
        WHERE staging_intent_id=${String(freeIntent.id)}::uuid) AS ledgers
  `))[0];
  check(rollbackResult && Number(rollbackArtifacts.contacts) === 0 &&
    Number(rollbackArtifacts.typed_links) === 0 && Number(rollbackArtifacts.commitments) === 1 &&
    Number(rollbackArtifacts.ledgers) === 0,
  "injected failure rolls every new contact/link/commit/enrollment artifact back while retaining only the earlier staged claim");

  // The paid source arrives later with the same normalized recipient from a
  // separate typed candidate authority. De-rank the already bridged free
  // observation so paid evidence is the canonical validation representative
  // in its own cohort; neither source hash nor lineage is rewritten.
  await db.execute(sql`
    UPDATE free_discovery_candidates SET confidence=1 WHERE id=${String(freeCandidate.id)}::uuid
  `);
  const duplicatePaid = await writeSfpPaidCandidateEvidence({
    businessId, provider: "outscraper", field: "email", value: freeEmail,
    subjectType: "business", confidence: 65,
  });
  const paidCohortId = await createFrozenBridgeCohort("paid-bridge-cohort");
  const paidEligibility = await validateCandidateForBridge(paidCohortId, "paid-source");
  check(paidEligibility?.source_kind === "paid" &&
    String(paidEligibility.paid_candidate_evidence_id) === String(duplicatePaid.id) &&
    paidEligibility.candidate_id == null &&
    String(paidEligibility.normalized_value_hash) === String(freeEligibility.normalized_value_hash) &&
    Number(paidEligibility.normalized_value_hash_version) === Number(freeEligibility.normalized_value_hash_version),
  "paid validation keeps the paid source pin and matching versioned address identity separate from free evidence");
  if (!paidEligibility) throw new Error("PAID_BRIDGE_ELIGIBILITY_NOT_CREATED");
  const paidIntent = await stageBridgeSource(paidCohortId, String(paidEligibility.id), "paid", false);
  if (!paidIntent) throw new Error("PAID_BRIDGE_INTENT_NOT_CREATED");
  const duplicateClaim = rows(await db.execute(sql`
    SELECT id,program_id,objective_key,recipient_identity_hash,recipient_identity_hash_version,
           business_id,package_version_id,staging_intent_id,state,committed_at
      FROM sfp_recipient_address_commitments
     WHERE id=${String(paidIntent.recipient_commitment_id)}::uuid
  `))[0];
  const freeClaimCount = rows(await db.execute(sql`
    SELECT COUNT(*)::int AS count
      FROM sfp_recipient_address_commitments
     WHERE program_id=${String(program.id)}::uuid
       AND objective_key='sfp.initial_recipient_acquisition.v1'
       AND recipient_identity_hash=${sfpRecipientIdentityHash(freeEmail)}
  `))[0];
  check(paidIntent.master_lead_id == null &&
    String(paidIntent.recipient_commitment_id) === String(freeIntent.recipient_commitment_id) &&
    String(duplicateClaim?.id) === String(freeIntent.recipient_commitment_id) &&
    String(duplicateClaim?.staging_intent_id) === String(freeIntent.id) &&
    duplicateClaim?.state === "claimed" && duplicateClaim?.committed_at == null &&
    Number(duplicateClaim?.business_id) === businessId &&
    String(duplicateClaim?.package_version_id) === String(freeIntent.package_version_id) &&
    Number(freeClaimCount.count) === 1,
  "paid duplicate reuses the original free-owned claimed commitment without a second ownership claim or master-lead projection");

  let releaseFreeBridge!: () => void;
  let freeReachedLockBarrier!: () => void;
  let paidBridgeSubmitted!: () => void;
  let paidBridgeSettled = false;
  const freeBridgeLockBarrier = new Promise<void>((resolve) => { freeReachedLockBarrier = resolve; });
  const allowFreeBridgeCommit = new Promise<void>((resolve) => { releaseFreeBridge = resolve; });
  const paidBridgeSubmission = new Promise<void>((resolve) => { paidBridgeSubmitted = resolve; });
  const freeBridgePromise = observeBackground(bridgeReadyHeldIntentToPausedEnrollment(
    String(freeIntent.id), reviewerId, async (stage) => {
      if (stage === "after_contact_before_enrollment") {
        freeReachedLockBarrier();
        await allowFreeBridgeCommit;
      }
    },
  ));
  try {
    await waitForBarrier(freeBridgeLockBarrier, "FREE_BRIDGE_LOCK_BARRIER_NOT_REACHED");
  } catch (error) {
    releaseFreeBridge();
    await waitForCompletion(freeBridgePromise, "FREE_BRIDGE_ABORT_CLEANUP_TIMEOUT").catch(() => undefined);
    throw error;
  }
  const paidBridgePromise = observeBackground((async () => {
    paidBridgeSubmitted();
    return bridgeReadyHeldIntentToPausedEnrollment(String(paidIntent.id), reviewerId);
  })().finally(() => {
    paidBridgeSettled = true;
  }));
  let paidWaitedOnEligibilityFence = false;
  try {
    await waitForBarrier(paidBridgeSubmission, "PAID_BRIDGE_INVOCATION_NOT_SUBMITTED");
    paidWaitedOnEligibilityFence = await waitForCanonicalSfpAuthorityContention();
    check(paidWaitedOnEligibilityFence && !paidBridgeSettled,
      "duplicate paid bridge blocks on a SQL-observed canonical SFP global, recipient-claim, or runtime-owner authority lock held by the free bridge transaction");
  } finally {
    // Always release the first transaction, including when SQL observation
    // times out, so a failed assertion cannot strand the disposable DB.
    releaseFreeBridge();
  }
  const [freeBridge, paidBridge] = await waitForCompletion(
    Promise.all([freeBridgePromise, paidBridgePromise]),
    "FREE_PAID_BRIDGE_COMPLETION_TIMEOUT",
  );
  diagnoseBridgeResult("concurrent-free-bridge", freeBridge);
  diagnoseBridgeResult("concurrent-paid-bridge", paidBridge);
  check([freeBridge, paidBridge].filter((result) => result.status === "created").length === 1 &&
    [freeBridge, paidBridge].filter((result) => result.status === "already_bridged").length === 1 &&
    freeBridge.enrollmentStatus === "paused" && paidBridge.enrollmentStatus === "paused",
  "concurrent free/paid arrivals for one program/address serialize to one initial paused recipient assignment");
  const initialSourceKind = freeBridge.status === "created" ? "free" : "paid";
  const reusedSourceKind = initialSourceKind === "free" ? "paid" : "free";
  const freePaidAssignment = rows(await db.execute(sql`
     SELECT c.id AS commitment_id,c.business_id,c.package_version_id,c.state AS commitment_state,
            c.committed_at,c.contact_id AS committed_contact_id,
            c.contact_business_link_decision_id AS committed_link_id,
             COUNT(DISTINCT l.id)::int AS enrollment_ledgers,
            COUNT(DISTINCT se.id)::int AS total_enrollments,
            COUNT(DISTINCT se.id) FILTER (WHERE se.status='paused')::int AS paused_enrollments,
             COUNT(DISTINCT a.id)::int AS source_aliases,
             COUNT(DISTINCT co.id)::int AS matching_contacts,
             COUNT(DISTINCT d.id)::int AS typed_link_decisions
      FROM sfp_recipient_address_commitments c
      LEFT JOIN sfp_ready_held_enrollments l ON l.recipient_commitment_id=c.id
       LEFT JOIN sequence_enrollments se ON se.id=l.sequence_enrollment_id
      LEFT JOIN sfp_recipient_commitment_aliases a ON a.commitment_id=c.id
      LEFT JOIN contacts co ON co.id=c.contact_id
      LEFT JOIN contact_business_link_decisions d ON d.id=c.contact_business_link_decision_id
     WHERE c.program_id=${String(program.id)}::uuid
       AND c.objective_key='sfp.initial_recipient_acquisition.v1'
       AND c.recipient_identity_hash=${sfpRecipientIdentityHash(freeEmail)}
     GROUP BY c.id,c.business_id,c.package_version_id
  `))[0];
  const aliases = rows(await db.execute(sql`
    SELECT source_kind,disposition,normalized_value_hash_version
      FROM sfp_recipient_commitment_aliases
     WHERE commitment_id=${String(freePaidAssignment.commitment_id)}::uuid
  `));
  const recipientCommitmentCount = rows(await db.execute(sql`
    SELECT COUNT(*)::int AS count
      FROM sfp_recipient_address_commitments
     WHERE program_id=${String(program.id)}::uuid
       AND objective_key='sfp.initial_recipient_acquisition.v1'
       AND recipient_identity_hash=${sfpRecipientIdentityHash(freeEmail)}
  `))[0];
  check(Number(freePaidAssignment.enrollment_ledgers) === 1 &&
     Number(recipientCommitmentCount.count) === 1 &&
     Number(freePaidAssignment.total_enrollments) === 1 &&
     Number(freePaidAssignment.paused_enrollments) === 1 &&
     freePaidAssignment.commitment_state === "committed" &&
     freePaidAssignment.committed_at != null &&
     Number(freePaidAssignment.committed_contact_id) > 0 &&
     Boolean(freePaidAssignment.committed_link_id) &&
    Number(freePaidAssignment.source_aliases) === 2 &&
    Number(freePaidAssignment.matching_contacts) === 1 &&
    Number(freePaidAssignment.typed_link_decisions) === 1 &&
    aliases.some((alias: any) => alias.source_kind === initialSourceKind && alias.disposition === "initial") &&
    aliases.some((alias: any) => alias.source_kind === reusedSourceKind && alias.disposition === "reused") &&
    aliases.every((alias: any) => Number(alias.normalized_value_hash_version) === 1),
  "database uniqueness retains free/paid aliases and one evidence-backed contact/link/commitment/enrollment without rewriting hash versions");

  const freeBridgeReplay = await bridgeReadyHeldIntentToPausedEnrollment(String(freeIntent.id), reviewerId);
  diagnoseBridgeResult("free-historical-replay", freeBridgeReplay);
  check(freeBridgeReplay.status === "already_bridged",
    "free-source successful bridge replay creates no additional recipient or paused enrollment");
  const paidBridgeReplay = await bridgeReadyHeldIntentToPausedEnrollment(String(paidIntent.id), reviewerId);
  diagnoseBridgeResult("paid-historical-replay", paidBridgeReplay);
  check(paidBridgeReplay.status === "already_bridged",
    "paid duplicate replay reuses the same accepted recipient assignment without new enrollment side effects");

  const conflictBusiness = rows(await db.execute(sql`
    INSERT INTO businesses (canonical_name,normalized_name,vertical,state,record_class,created_at)
    VALUES (${`${runKey} conflicting trades business`},
      ${`${runKey} conflicting trades business`.toLowerCase()},NULL,'FL','canonical',NOW())
    RETURNING id
  `))[0];
  const conflictBusinessId = Number(conflictBusiness.id);
  await db.execute(sql`
    INSERT INTO business_locations
      (business_id,location_name,street_address,city,state,postal_code,county_fips,is_primary)
    VALUES (${conflictBusinessId},${`${runKey} conflict location`},'200 Certification Way',
      'Miami','FL','33101','12086',TRUE)
  `);
  const conflictGeneration = rows(await db.execute(sql`
    INSERT INTO free_discovery_generations (run_key, actor_id, purpose, reason, state)
    VALUES (${`${runKey}-conflict-gen`}, ${runKey}, 'email_discovery',
      'recipient ownership conflict certification', 'completed')
    RETURNING id
  `))[0];
  const conflictingSource = seal("email", freeEmail);
  const conflictingCandidate = rows(await db.execute(sql`
    INSERT INTO free_discovery_candidates
      (generation_id,business_id,field,subject_type,domain,source,attribution_scope,disposition,
       confidence,envelope_ciphertext,envelope_nonce,envelope_tag,envelope_key_version,
       normalized_value_hash,masked_value,created_at)
    VALUES (${String(conflictGeneration.id)}::uuid,${conflictBusinessId},'email','business','gmail.com',
      'certification','role','staged',90,${conflictingSource.ciphertext},${conflictingSource.nonce},
      ${conflictingSource.tag},1,${conflictingSource.normalizedValueHash},
      ${conflictingSource.maskedValue},NOW())
    RETURNING id
  `))[0];
  const conflictCohortId = await createFrozenBridgeCohort("recipient-conflict", conflictBusinessId);
  const conflictEligibility = await validateCandidateForBridge(conflictCohortId, "recipient-conflict");
  check(conflictEligibility?.source_kind === "free" &&
    String(conflictEligibility.candidate_id) === String(conflictingCandidate.id),
  "second canonical business gets independently validated against the same real recipient address");
  if (!conflictEligibility) throw new Error("RECIPIENT_CONFLICT_ELIGIBILITY_NOT_CREATED");
  const conflictIntent = await stageBridgeSource(
    conflictCohortId, String(conflictEligibility.id), "recipient-conflict", false,
  );
  if (!conflictIntent) throw new Error("RECIPIENT_CONFLICT_INTENT_NOT_CREATED");
  check(String(conflictIntent.recipient_commitment_id) === String(freeIntent.recipient_commitment_id),
    "cross-business staging resolves the existing program/address ownership claim before projection");
  const conflictBridge = await bridgeReadyHeldIntentToPausedEnrollment(String(conflictIntent.id), reviewerId);
  diagnoseBridgeResult("cross-business-recipient-conflict", conflictBridge);
  const conflictArtifacts = rows(await db.execute(sql`
    SELECT c.business_id,c.state,
           (SELECT count(*)::int FROM sfp_ready_held_enrollments
             WHERE staging_intent_id=${String(conflictIntent.id)}::uuid) AS bridge_ledgers,
           (SELECT count(*)::int FROM sfp_recipient_commitment_aliases
             WHERE commitment_id=c.id AND staging_intent_id=${String(conflictIntent.id)}::uuid
               AND disposition='held' AND reason_code='recipient_assignment_conflict') AS held_aliases
      FROM sfp_recipient_address_commitments c WHERE c.id=${String(freeIntent.recipient_commitment_id)}::uuid
  `))[0];
  check(conflictBridge.status === "left_held" &&
    conflictBridge.heldReason === "recipient_assignment_conflict" &&
    Number(conflictArtifacts.business_id) === businessId && conflictArtifacts.state === "committed" &&
    Number(conflictArtifacts.bridge_ledgers) === 0 && Number(conflictArtifacts.held_aliases) === 1,
  "different-business duplicate is durably aliased and held without changing the accepted assignment or creating CRM/enrollment projections");

  const acceptedLink = rows(await db.execute(sql`
    SELECT c.contact_id,d.revision
      FROM sfp_recipient_address_commitments c
      JOIN contact_business_link_decisions d ON d.id=c.contact_business_link_decision_id
     WHERE c.id=${String(freeIntent.recipient_commitment_id)}::uuid
  `))[0];
  const revokedAcceptedLink = await decideContactBusinessLink({
    contactId: Number(acceptedLink.contact_id), decision: "rejected",
    decisionKey: `${runKey}-recipient-assignment-revocation`,
    reviewerId, expectedRevision: Number(acceptedLink.revision),
  });
  check(revokedAcceptedLink.decision === "rejected",
    "independent authority revokes the accepted recipient assignment before duplicate revalidation");
  const paidAfterRevocation = await bridgeReadyHeldIntentToPausedEnrollment(String(paidIntent.id), reviewerId);
  diagnoseBridgeResult("paid-revoked-assignment", paidAfterRevocation);
  const revokedAlias = rows(await db.execute(sql`
    SELECT disposition,reason_code FROM sfp_recipient_commitment_aliases
     WHERE commitment_id=${String(freeIntent.recipient_commitment_id)}::uuid
       AND staging_intent_id=${String(paidIntent.id)}::uuid
     ORDER BY created_at DESC LIMIT 1
  `))[0];
  check(paidAfterRevocation.status === "left_held" &&
    paidAfterRevocation.heldReason === "accepted_assignment_no_longer_current" &&
    revokedAlias?.disposition === "held" &&
    revokedAlias?.reason_code === "accepted_assignment_no_longer_current",
  "duplicate reuse locks and revalidates the original contact/link/enrollment rows and refuses a revoked assignment");

  const paidUnique = await writeSfpPaidCandidateEvidence({
    businessId, provider: "outscraper", field: "email", value: `paid-unique-${runKey}@gmail.com`,
    subjectType: "business", confidence: 90,
  });
  const paidUniqueCohortId = await createFrozenBridgeCohort("paid-unique-bridge-cohort");
  const paidUniqueEligibility = await validateCandidateForBridge(paidUniqueCohortId, "paid-unique-source");
  check(paidUniqueEligibility?.source_kind === "paid" &&
    String(paidUniqueEligibility.paid_candidate_evidence_id) === String(paidUnique.id) &&
    String(paidUniqueEligibility.normalized_value_hash) !== String(freeEligibility.normalized_value_hash),
  "independent paid candidate reaches a second current eligibility using its own distinct real address");
  if (!paidUniqueEligibility) throw new Error("PAID_UNIQUE_BRIDGE_ELIGIBILITY_NOT_CREATED");
  const paidUniqueIntent = await stageBridgeSource(
    paidUniqueCohortId, String(paidUniqueEligibility.id), "paid-unique",
  );
  if (!paidUniqueIntent) throw new Error("PAID_UNIQUE_BRIDGE_INTENT_NOT_CREATED");
  const paidUniqueBridge = await bridgeReadyHeldIntentToPausedEnrollment(String(paidUniqueIntent.id), reviewerId);
  diagnoseBridgeResult("paid-unique-source", paidUniqueBridge);
  const paidTypedLink = rows(await db.execute(sql`
    SELECT e.source_kind,e.paid_candidate_evidence_id,d.contact_id,d.business_id,d.decision,d.superseded_at,
           l.recipient_commitment_id,se.status AS enrollment_status
      FROM sfp_ready_held_enrollments l
      JOIN contact_business_link_decisions d ON d.id=l.contact_business_link_decision_id
      JOIN contact_business_sfp_link_evidence e ON e.id=d.sfp_evidence_id
      JOIN sequence_enrollments se ON se.id=l.sequence_enrollment_id
     WHERE l.staging_intent_id=${String(paidUniqueIntent.id)}::uuid
  `))[0];
  check(paidUniqueBridge.status === "created" && paidUniqueBridge.enrollmentStatus === "paused" &&
    paidTypedLink?.source_kind === "paid" &&
    String(paidTypedLink.paid_candidate_evidence_id) === String(paidUnique.id) &&
    Number(paidTypedLink.business_id) === businessId && paidTypedLink.decision === "verified" &&
    paidTypedLink.superseded_at == null && Boolean(paidTypedLink.recipient_commitment_id) &&
    paidTypedLink.enrollment_status === "paused",
  "paid-only bridge creates a same-transaction verified link through typed paid evidence and commits a separate paused recipient");

  // Deterministically exercise the common contact-row/address lock order at
  // the provider marker boundary. The writer is admitted while dispatch pins
  // are held, then commits after that boundary releases. The fake provider
  // transport waits for the writer outside any database transaction, so the
  // final safety recheck must observe the suppression update without a lock
  // inversion or stale projection.
  const contactLockFixture = await createRaceFreeFixture("contact-lock-order");
  const contactLockWrite = await writeContact({
    mode: "local_only",
    mutation: {
      firstName: "Unlinked",
      lastName: "Suppression",
      email: contactLockFixture.email,
      phone: "3055550299",
      companyName: contactLockFixture.businessName,
      status: "New",
    },
    provenance: {
      sourceCategory: "discovery",
      sourceType: "cro03",
      eventKey: `${runKey}-contact-lock-order-source`,
      actorType: "system",
      actorId: `${runKey}-contact-lock-order-writer`,
    },
    actor: { actorType: "system", actorId: `${runKey}-contact-lock-order-writer` },
    hookPolicy: {
      source: "cro03",
      deferValidation: true,
      deferReadiness: true,
      deferLeadScoring: true,
      suppressProviderProjection: true,
    },
  });
  const contactLockId = Number(contactLockWrite.id);
  const contactLockPreview = await previewSfpValidation(contactLockFixture.cohortId);
  const dispatchPinsReached = makeDeferred<void>();
  const dispatchPinsRelease = makeDeferred<void>();
  const contactWriterCommitted = makeDeferred<void>();
  const contactLockValidation = observeBackground(executeSfpValidation(contactLockFixture.cohortId, {
    idempotencyKey: `${runKey}-contact-lock-order-validation`,
    snapshotHash: contactLockPreview.snapshotHash,
    actorId: reviewerId,
    maxValidations: 25,
    zbTransport: async () => {
      await contactWriterCommitted.promise;
      return "valid";
    },
    concurrencyTestHooks: {
      onDispatchPinsLocked: async (context: any) => {
        if (context.businessId !== contactLockFixture.businessId) return;
        dispatchPinsReached.resolve();
        await dispatchPinsRelease.promise;
      },
    },
  }));
  let contactSuppressionCommand: Promise<any> | undefined;
  let contactLockWaitObserved = false;
  let contactLockWaitDiagnostic: Awaited<ReturnType<typeof waitForContactAddressContention>> | null = null;
  let contactLockValidationResult: any;
  try {
    await waitForBarrier(dispatchPinsReached.promise, "DISPATCH_PINS_BARRIER_NOT_REACHED");
    contactSuppressionCommand = observeBackground(applyConsentCommand({
      subject: { type: "contact", id: contactLockId },
      kind: "global_dnc",
      eventNamespace: "sfp_private_concurrency_certification",
      eventKey: `${runKey}-contact-lock-order-global-dnc`,
      source: "private_concurrency_certification",
      actorId: `${runKey}-contact-lock-order-writer`,
      evidence: { reason: `${runKey}-serialized-test-suppression` },
    }));
    contactLockWaitDiagnostic = await waitForContactAddressContention(contactLockFixture.email);
    contactLockWaitObserved = contactLockWaitDiagnostic.harnessBarrierContention;
    dispatchPinsRelease.resolve();
    if (contactSuppressionCommand) {
      await waitForCompletion(
        contactSuppressionCommand,
        "CONTACT_SUPPRESSION_COMMAND_COMPLETION_TIMEOUT",
      );
    }
    contactWriterCommitted.resolve();
    const finalizationLockMonitor = observeBackground(monitorSafeLockWaitsUntilSettled(
      contactLockValidation,
      "after_dispatch_marker_and_contact_suppression_commit",
    ));
    try {
      contactLockValidationResult = await waitForCompletion(
        contactLockValidation,
        "CONTACT_LOCK_VALIDATION_COMPLETION_TIMEOUT",
      );
    } catch (error) {
      await waitForCompletion(
        finalizationLockMonitor,
        "CONTACT_LOCK_FINALIZATION_DIAGNOSTIC_TIMEOUT",
        8_000,
      ).catch(() => undefined);
      throw error;
    }
    await waitForCompletion(finalizationLockMonitor, "CONTACT_LOCK_FINALIZATION_DIAGNOSTIC_TIMEOUT", 8_000);
  } finally {
    dispatchPinsRelease.resolve();
    contactWriterCommitted.resolve();
  }
  const contactLockOutcome = rows(await db.execute(sql`
    SELECT e.id,e.status,e.decision_reason,e.suppression_status,e.validation_operation_id,
           o.state AS operation_state,
           c.suppression_reason,b.main_email
      FROM sfp_outreach_eligibility e
      JOIN provider_operations o ON o.id=e.validation_operation_id
      JOIN contacts c ON c.id=${contactLockId}
      JOIN businesses b ON b.id=e.business_id
     WHERE e.cohort_run_id=${contactLockFixture.cohortId}::uuid
       AND e.business_id=${contactLockFixture.businessId}
  `))[0];
  console.info("CONTACT_SUPPRESSION_ASSERTION_DIAGNOSTIC", JSON.stringify({
    dispatchContactAddressWaitObserved: contactLockWaitDiagnostic?.observed ?? false,
    dispatchContactAddressWaitBlockedByHarnessHook:
      contactLockWaitDiagnostic?.harnessBarrierContention ?? false,
    validationFailedCountIsZero: contactLockValidationResult?.failedCount === 0,
    eligibilityStatus: String(contactLockOutcome?.status ?? "missing"),
    decisionReason: String(contactLockOutcome?.decision_reason ?? "missing"),
    suppressionStatus: String(contactLockOutcome?.suppression_status ?? "missing"),
    providerOperationState: String(contactLockOutcome?.operation_state ?? "missing"),
    businessEmailProjectionAbsent: contactLockOutcome?.main_email == null,
    canonicalSuppressionReasonMatches:
      contactLockOutcome?.suppression_reason === `do_not_contact:${runKey}-serialized-test-suppression`,
  }));
  check(contactLockWaitObserved &&
    contactLockValidationResult.failedCount === 0 &&
    contactLockOutcome?.status === "validated_suppressed" &&
    contactLockOutcome?.suppression_status === "suppressed" &&
    contactLockOutcome?.decision_reason === "canonical_suppression_match_at_final_projection" &&
    contactLockOutcome?.operation_state === "completed" &&
    contactLockOutcome?.main_email == null &&
    contactLockOutcome?.suppression_reason === `do_not_contact:${runKey}-serialized-test-suppression`,
  "existing-contact suppression update waits at dispatch pins, commits after marker release, and is honored before any business projection");
  const contactLockStagePreview = await previewStagingV2({
    cohortRunId: contactLockFixture.cohortId,
    eligibilityIds: [String(contactLockOutcome.id)],
    actorId: reviewerId,
  });
  check(contactLockStagePreview.eligibleCount === 0,
    "a committed post-validation suppression mutation is re-evaluated before staging");

  // This hook is before the final transaction's first lock. Keep a real
  // existing-customer writer transaction open to queue the DBPR and consent
  // writers behind their normal tuple/sentinel fences, then commit all three
  // mutations before releasing validation. The final recheck must see them;
  // it would be incorrect to expect them to wait behind validation while the
  // hook is still before its first lock.
  const absenceFixture = await createRaceFreeFixture("absence-writer-fences");
  const absenceContactWrite = await writeContact({
    mode: "local_only",
    mutation: {
      firstName: "Unlinked",
      lastName: "Absence",
      email: absenceFixture.email,
      phone: "3055550398",
      companyName: absenceFixture.businessName,
      status: "New",
    },
    provenance: {
      sourceCategory: "discovery",
      sourceType: "cro03",
      eventKey: `${runKey}-absence-writer-contact-source`,
      actorType: "system",
      actorId: `${runKey}-absence-writer-contact`,
    },
    actor: { actorType: "system", actorId: `${runKey}-absence-writer-contact` },
    hookPolicy: {
      source: "cro03",
      deferValidation: true,
      deferReadiness: true,
      deferLeadScoring: true,
      suppressProviderProjection: true,
    },
  });
  const absenceContactId = Number(absenceContactWrite.id);
  const absencePreview = await previewSfpValidation(absenceFixture.cohortId);
  const absenceReached = makeDeferred<void>();
  const absenceRelease = makeDeferred<void>();
  const absenceValidation = observeBackground(executeSfpValidation(absenceFixture.cohortId, {
    idempotencyKey: `${runKey}-absence-writer-validation`,
    snapshotHash: absencePreview.snapshotHash,
    actorId: reviewerId,
    maxValidations: 25,
    zbTransport: async () => "valid",
    concurrencyTestHooks: {
      onBeforeFinalEligibilityLocks: async (context: any) => {
        if (context.businessId !== absenceFixture.businessId) return;
        absenceReached.resolve();
        await absenceRelease.promise;
      },
    },
  }));
  const absenceWriters: Array<{ client: any; applicationName: string; query: Promise<any> }> = [];
  let absenceBusinessTupleWait: Awaited<ReturnType<typeof waitForSafeLockQueryClass>> | null = null;
  let absenceSuppressionCommand: Promise<any> | undefined;
  let absenceValidationResult: any;
  const committedAbsenceWriters = new Set<any>();
  try {
    await waitForBarrier(absenceReached.promise, "ABSENCE_WRITER_BARRIER_NOT_REACHED");
    const customerWriterName = `${runKey}-customer-absence-writer`;
    const customerWriter = await connectHeldWriter(customerWriterName);
    absenceWriters.push({
      client: customerWriter,
      applicationName: customerWriterName,
      query: observeBackground(customerWriter.query(`
        INSERT INTO sdr_merchants (business_id,business_name,existing_customer_flag,source)
        VALUES ($1,$2,TRUE,'private_concurrency_certification')
      `, [absenceFixture.businessId, absenceFixture.businessName]),
      ),
    });
    await waitForCompletion(
      absenceWriters[0].query,
      "ABSENCE_CUSTOMER_FACT_INSERT_COMPLETION_TIMEOUT",
      5_000,
    );

    const dbprProjection = observeBackground(projectBusinessOnly({
      itemId: randomUUID(),
      sourceSystem: "DBPR-HR",
      sourceType: "business_registration",
      stableKey: `${runKey}-dbpr-absence-key`,
      organization: {
        canonicalName: absenceFixture.businessName,
        websiteDomain: absenceFixture.websiteDomain,
        city: "Miami",
        state: "FL",
      },
      rawEvidence: { testScope: "private_absence_race" },
    }));

    absenceSuppressionCommand = observeBackground(applyConsentCommand({
      subject: { type: "contact", id: absenceContactId },
      kind: "global_dnc",
      eventNamespace: "sfp_private_concurrency_certification",
      eventKey: `${runKey}-absence-writer-global-dnc`,
      source: "private_concurrency_certification",
      actorId: `${runKey}-absence-writer-suppression`,
      evidence: { reason: "private_absence_concurrency_certification" },
    }));
    absenceBusinessTupleWait = await waitForSafeLockQueryClass(
      "business_organization_tuple",
      "onBeforeFinalEligibilityLocks_pre_first_lock_dbpr_writer",
    );
    for (const writer of absenceWriters) {
      await waitForCompletion(
        writer.client.query("COMMIT"),
        "ABSENCE_CUSTOMER_FACT_COMMIT_TIMEOUT",
        5_000,
      );
      committedAbsenceWriters.add(writer.client);
      writer.client.release();
    }
    await waitForCompletion(dbprProjection, "ABSENCE_DBPR_PROJECTION_COMPLETION_TIMEOUT");
    if (absenceSuppressionCommand) {
      await waitForCompletion(absenceSuppressionCommand, "ABSENCE_SUPPRESSION_COMPLETION_TIMEOUT");
    }
    const absenceFinalizationLockMonitor = observeBackground(monitorSafeLockWaitsUntilSettled(
      absenceValidation,
      "absence_writers_committed_before_final_eligibility_locks",
    ));
    absenceRelease.resolve();
    try {
      absenceValidationResult = await waitForCompletion(
        absenceValidation,
        "ABSENCE_VALIDATION_COMPLETION_TIMEOUT",
      );
    } catch (error) {
      await waitForCompletion(
        absenceFinalizationLockMonitor,
        "ABSENCE_FINALIZATION_DIAGNOSTIC_TIMEOUT",
        8_000,
      ).catch(() => undefined);
      throw error;
    }
    await waitForCompletion(absenceFinalizationLockMonitor, "ABSENCE_FINALIZATION_DIAGNOSTIC_TIMEOUT", 8_000);
    const absenceEligibility = rows(await db.execute(sql`
      SELECT id,status,validation_operation_id
        FROM sfp_outreach_eligibility
       WHERE cohort_run_id=${absenceFixture.cohortId}::uuid
         AND business_id=${absenceFixture.businessId}
    `))[0];
    const absenceFacts = rows(await db.execute(sql`
      SELECT
        EXISTS(
          SELECT 1 FROM canonical_source_links
           WHERE business_id=${absenceFixture.businessId} AND source_system='DBPR-HR'
        ) AS dbpr_lineage_present,
        EXISTS(
          SELECT 1 FROM sdr_merchants
           WHERE business_id=${absenceFixture.businessId} AND existing_customer_flag=TRUE
        ) AS existing_customer_present,
        EXISTS(
          SELECT 1 FROM contacts
           WHERE id=${absenceContactId} AND do_not_contact=TRUE
        ) AS contact_suppression_present
    `))[0];
    const absenceStagePreview = await previewStagingV2({
      cohortRunId: absenceFixture.cohortId,
      eligibilityIds: absenceEligibility?.id ? [String(absenceEligibility.id)] : [],
      actorId: reviewerId,
    });
    const absenceBusinessTupleWaitProven =
      absenceBusinessTupleWait?.observed === true &&
      absenceBusinessTupleWait.queryClass === "business_organization_tuple" &&
      absenceBusinessTupleWait.waitEventType === "Lock" &&
      absenceBusinessTupleWait.waitEvent === "transactionid" &&
      absenceBusinessTupleWait.blockerClass === "test_existing_customer_writer_transaction" &&
      absenceBusinessTupleWait.blockerState === "idle_in_transaction";
    console.info("ABSENCE_FINAL_FACT_ASSERTION_DIAGNOSTIC", JSON.stringify({
      businessOrganizationTupleWaitProven: absenceBusinessTupleWaitProven,
      businessTupleWaitEvent: absenceBusinessTupleWait?.waitEvent ?? "missing",
      businessTupleBlockerClass: absenceBusinessTupleWait?.blockerClass ?? "missing",
      dbprLineagePresent: absenceFacts?.dbpr_lineage_present === true,
      existingCustomerPresent: absenceFacts?.existing_customer_present === true,
      contactSuppressionPresent: absenceFacts?.contact_suppression_present === true,
      validationFailedCountIsZero: absenceValidationResult?.failedCount === 0,
      eligibilityStatus: String(absenceEligibility?.status ?? "missing"),
      validationOperationPresent: Boolean(absenceEligibility?.validation_operation_id),
      stagingEligibleCountIsZero: absenceStagePreview.eligibleCount === 0,
    }));
    check(absenceBusinessTupleWaitProven &&
      absenceFacts?.dbpr_lineage_present === true &&
      absenceFacts?.existing_customer_present === true &&
      absenceFacts?.contact_suppression_present === true &&
      absenceValidationResult.failedCount === 0 &&
      absenceEligibility?.status === "validated_suppressed" &&
      Boolean(absenceEligibility.validation_operation_id) &&
      absenceStagePreview.eligibleCount === 0,
    "DBPR, existing-customer, and canonical suppression writers commit while the final-lock hook is pre-lock, and validation rechecks those facts before staging");
  } finally {
    absenceRelease.resolve();
    for (const writer of absenceWriters) {
      if (committedAbsenceWriters.has(writer.client)) continue;
      try { await writer.client.query("ROLLBACK"); } catch { /* already completed or failed */ }
      writer.client.release();
    }
  }

  // A pending-only competing insert holds the unique eligibility key while
  // the governed validator reaches its real INSERT ... ON CONFLICT path.
  // This is not a healthy/eligible fixture: it exists solely to exercise the
  // absent-row unique-index wait and must be overwritten by the real result.
  const uniqueWaitFixture = await createRaceFreeFixture("eligibility-unique-wait");
  const uniqueWaitFixtureIsolation =
    uniqueWaitFixture.businessId !== absenceFixture.businessId &&
    uniqueWaitFixture.cohortId !== absenceFixture.cohortId &&
    uniqueWaitFixture.candidateId !== absenceFixture.candidateId &&
    uniqueWaitFixture.email !== absenceFixture.email;
  const uniqueWaitFixtureCleanRow = rows(await db.execute(sql`
    SELECT
      NOT EXISTS(
        SELECT 1 FROM sfp_outreach_eligibility
         WHERE cohort_run_id=${uniqueWaitFixture.cohortId}::uuid
           AND business_id=${uniqueWaitFixture.businessId}
      ) AS no_prior_eligibility,
      NOT EXISTS(
        SELECT 1 FROM canonical_source_links
         WHERE business_id=${uniqueWaitFixture.businessId} AND source_system='DBPR-HR'
      ) AS no_dbpr_lineage,
      NOT EXISTS(
        SELECT 1 FROM sdr_merchants
         WHERE business_id=${uniqueWaitFixture.businessId} AND existing_customer_flag=TRUE
      ) AS no_existing_customer,
      NOT EXISTS(
        SELECT 1 FROM contacts c
         WHERE lower(btrim(c.email))=lower(btrim(${uniqueWaitFixture.email}))
           AND (
             COALESCE(c.do_not_contact,FALSE)=TRUE OR
             COALESCE(c.do_not_auto_contact,FALSE)=TRUE OR
             c.suppression_reason IS NOT NULL OR
             c.opt_out_status='opted_out' OR
             c.unsubscribe_status='unsubscribed' OR
             c.bounce_status='hard'
           )
      ) AND NOT EXISTS(
        SELECT 1
          FROM consent_subjects cs
          LEFT JOIN consent_subject_global_suppressions gs
            ON gs.subject_id=cs.id AND gs.is_suppressed=TRUE
          LEFT JOIN consent_subject_channel_states es
            ON es.subject_id=cs.id AND es.channel='email'
           AND es.permission_state IN ('withdrawn','suppressed')
         WHERE lower(btrim(cs.normalized_email))=lower(btrim(${uniqueWaitFixture.email}))
           AND (gs.subject_id IS NOT NULL OR es.id IS NOT NULL)
      ) AS no_suppression
  `))[0];
  const uniqueWaitFixtureClean =
    uniqueWaitFixtureIsolation &&
    uniqueWaitFixtureCleanRow?.no_prior_eligibility === true &&
    uniqueWaitFixtureCleanRow?.no_dbpr_lineage === true &&
    uniqueWaitFixtureCleanRow?.no_existing_customer === true &&
    uniqueWaitFixtureCleanRow?.no_suppression === true;
  const uniqueWaitPreview = await previewSfpValidation(uniqueWaitFixture.cohortId);
  const activePolicy = rows(await db.execute(sql`
    SELECT d.version
      FROM sfp_outreach_policy_control c
      JOIN sfp_outreach_policy_documents d ON d.id=c.active_policy_id
     WHERE c.singleton=TRUE
  `))[0];
  assert.ok(Number.isInteger(Number(activePolicy?.version)) && Number(activePolicy?.version) > 0,
    "active outreach policy is required for the pending unique-conflict fixture");
  const uniqueWaitBeforeFinal = makeDeferred<void>();
  const uniqueWaitRelease = makeDeferred<void>();
  const uniqueWaitValidation = observeBackground(executeSfpValidation(uniqueWaitFixture.cohortId, {
    idempotencyKey: `${runKey}-eligibility-unique-wait-validation`,
    snapshotHash: uniqueWaitPreview.snapshotHash,
    actorId: reviewerId,
    maxValidations: 25,
    zbTransport: async () => "valid",
    concurrencyTestHooks: {
      onBeforeFinalEligibilityLocks: async (context: any) => {
        if (context.businessId !== uniqueWaitFixture.businessId) return;
        uniqueWaitBeforeFinal.resolve();
        await uniqueWaitRelease.promise;
      },
    },
  }));
  const uniqueWaitWriter = await connectHeldWriter(`${runKey}-pending-eligibility-writer`);
  let uniqueWaitWriterPid = 0;
  let pendingEligibilityId = "";
  let uniqueWaitObserved = false;
  let uniqueWaitLockDiagnostic: Awaited<ReturnType<typeof waitForPendingEligibilityGlobalFence>> | null = null;
  let uniqueWaitWriterCommitted = false;
  try {
    await waitForBarrier(uniqueWaitBeforeFinal.promise, "ELIGIBILITY_UNIQUE_WAIT_BARRIER_NOT_REACHED");
    uniqueWaitWriterPid = Number((await uniqueWaitWriter.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
    pendingEligibilityId = String((await uniqueWaitWriter.query(`
      INSERT INTO sfp_outreach_eligibility
        (cohort_run_id,business_id,candidate_id,source_kind,policy_version,status,
         decision_reason,normalized_value_hash,normalized_value_hash_version)
      VALUES ($1::uuid,$2,$3::uuid,'free',$4,'validation_pending',
        'private_pending_unique_wait_holder',$5,1)
      RETURNING id
    `, [
      uniqueWaitFixture.cohortId,
      uniqueWaitFixture.businessId,
      uniqueWaitFixture.candidateId,
      Number(activePolicy.version),
      uniqueWaitFixture.normalizedValueHash,
    ])).rows[0].id);
    uniqueWaitRelease.resolve();
    uniqueWaitLockDiagnostic = await waitForPendingEligibilityGlobalFence(uniqueWaitWriterPid);
    uniqueWaitObserved = uniqueWaitLockDiagnostic.observed;
    await uniqueWaitWriter.query("COMMIT");
    uniqueWaitWriterCommitted = true;
    uniqueWaitWriter.release();
    const uniqueWaitResult = await uniqueWaitValidation;
    const uniqueWaitRows = rows(await db.execute(sql`
      SELECT id,status,source_kind,candidate_id,normalized_value_hash,validation_operation_id
        FROM sfp_outreach_eligibility
       WHERE cohort_run_id=${uniqueWaitFixture.cohortId}::uuid
         AND business_id=${uniqueWaitFixture.businessId}
    `));
    const uniqueWaitOperation = uniqueWaitRows[0]?.validation_operation_id
      ? rows(await db.execute(sql`
          SELECT state,billing_state FROM provider_operations
           WHERE id=${String(uniqueWaitRows[0].validation_operation_id)}::uuid
        `))[0]
      : null;
    const uniqueWaitRowIdReused = String(uniqueWaitRows[0]?.id ?? "") === pendingEligibilityId;
    const uniqueWaitSourcePinMatches =
      uniqueWaitRows[0]?.source_kind === "free" &&
      String(uniqueWaitRows[0]?.candidate_id ?? "") === uniqueWaitFixture.candidateId &&
      String(uniqueWaitRows[0]?.normalized_value_hash ?? "") === uniqueWaitFixture.normalizedValueHash;
    const uniqueWaitSettledGenuine =
      uniqueWaitOperation?.state === "completed" &&
      uniqueWaitOperation?.billing_state === "committed";
    console.info("ELIGIBILITY_UNIQUE_WAIT_ASSERTION_DIAGNOSTIC", JSON.stringify({
      fixtureIndependentAndClean: uniqueWaitFixtureClean,
      uniqueConflictGlobalFenceWaitObserved: uniqueWaitObserved,
      globalFenceQueryClass: uniqueWaitLockDiagnostic?.queryClass ?? "missing",
      globalFenceWaitEventType: uniqueWaitLockDiagnostic?.waitEventType ?? "missing",
      globalFenceWaitEvent: uniqueWaitLockDiagnostic?.waitEvent ?? "missing",
      globalFenceBlockerClass: uniqueWaitLockDiagnostic?.blockerClass ?? "missing",
      globalFenceBlockerState: uniqueWaitLockDiagnostic?.blockerState ?? "missing",
      globalFenceBlockedByPendingWriter: uniqueWaitLockDiagnostic?.blockerMatchesPendingWriter ?? false,
      validationFailedCountIsZero: uniqueWaitResult?.failedCount === 0,
      finalEligibilityCount: uniqueWaitRows.length,
      pendingRowIdReused: uniqueWaitRowIdReused,
      finalEligibilityStatus: String(uniqueWaitRows[0]?.status ?? "missing"),
      sourcePinMatchesFixture: uniqueWaitSourcePinMatches,
      providerOperationState: String(uniqueWaitOperation?.state ?? "missing"),
      providerBillingState: String(uniqueWaitOperation?.billing_state ?? "missing"),
      genuineSettledValidation: uniqueWaitSettledGenuine,
    }));
    check(uniqueWaitFixtureClean && uniqueWaitObserved && uniqueWaitResult.failedCount === 0 &&
      uniqueWaitRows.length === 1 &&
      uniqueWaitRowIdReused &&
      uniqueWaitRows[0]?.status === "validated_outreach_eligible" &&
      uniqueWaitSourcePinMatches && uniqueWaitSettledGenuine,
    "a concurrent pending-only eligibility insert is awaited and atomically replaced by the genuine settled validation without a duplicate row");
  } finally {
    uniqueWaitRelease.resolve();
    if (!uniqueWaitWriterCommitted) {
      try { await uniqueWaitWriter.query("ROLLBACK"); } catch { /* already completed or failed */ }
      uniqueWaitWriter.release();
    }
  }

  // Seed a genuinely reserved, dispatched, and settled ZeroBounce operation,
  // then record its immutable observation once with a short explicit expiry.
  // The private harness does not run this operation's stage finalizer, so
  // retire its stage lease before settlement; this preserves the completed /
  // committed operation while allowing the test to record the provider
  // observation with its explicit expiry through the normal receipt schema.
  const expiredReceiptFixture = await createRaceFreeFixture("expired-receipt-projection");
  const expiredReceiptPreview = await previewSfpValidation(expiredReceiptFixture.cohortId);
  const ttl = rows(await db.execute(sql`
    SELECT d.validation_ttl_days
      FROM sfp_outreach_policy_control c
      JOIN sfp_outreach_policy_documents d ON d.id=c.active_policy_id
     WHERE c.singleton=TRUE
  `))[0];
  assert.ok(Number.isInteger(Number(ttl?.validation_ttl_days)) && Number(ttl?.validation_ttl_days) > 0,
    "active validation TTL is required for the genuine expiring-receipt fixture");
  const {
    finishSfpProviderOperation,
    invokeSfpProviderTransport,
    reserveSfpProviderOperation,
  } = await import("../server/services/cro03/sfp-provider-operations");
  const seedValidationStageId = randomUUID();
  const seedValidationStageClaim = randomUUID();
  await db.execute(sql`
    INSERT INTO sfp_stage_runs
      (id,cohort_run_id,stage,idempotency_key,actor_id,state,max_items,provider_keys,
       payload_hash,preview_snapshot_hash,claim_token,started_at,last_heartbeat_at,lease_expires_at)
    VALUES (${seedValidationStageId}::uuid,${expiredReceiptFixture.cohortId}::uuid,'validation',
      ${`${runKey}-expired-receipt-seed`},${reviewerId},'running',1,'["zerobounce"]'::jsonb,
      ${createHash("sha256").update(`${runKey}-expired-receipt-seed`).digest("hex")},
      ${expiredReceiptPreview.snapshotHash},${seedValidationStageClaim}::uuid,
      NOW(),NOW(),clock_timestamp()+INTERVAL '5 minutes')
  `);
  const expiredReceiptReservation = await reserveSfpProviderOperation({
    stageRunId: seedValidationStageId,
    cohortRunId: expiredReceiptFixture.cohortId,
    businessId: expiredReceiptFixture.businessId,
    candidateId: expiredReceiptFixture.candidateId,
    provider: "zerobounce",
    purpose: "sfp_email_validation",
    idempotencyKey: `${runKey}-expired-receipt-seed`,
    actorId: reviewerId,
    workUnit: "request",
    units: 1,
  });
  await invokeSfpProviderTransport(
    expiredReceiptReservation,
    async () => ({ status: "valid" }),
    async (tx: any) => {
      const source = rows(await tx.execute(sql`
        SELECT id FROM free_discovery_candidates
         WHERE id=${expiredReceiptFixture.candidateId}::uuid
           AND business_id=${expiredReceiptFixture.businessId}
           AND normalized_value_hash=${expiredReceiptFixture.normalizedValueHash}
      `))[0];
      if (!source) throw new Error("TASK_2056_EXPIRED_RECEIPT_SEED_SOURCE_MISMATCH");
    },
  );
  // Invalidate only this disposable seed stage's promotion lease after the
  // transport boundary. The provider operation itself remains settleable from
  // its durable dispatch marker; its observation is recorded below exactly
  // once with the explicit expiry rather than the default policy-age expiry.
  await db.execute(sql`
    UPDATE sfp_stage_runs
       SET state='completed',claim_token=NULL,lease_expires_at=NULL,
           completed_at=clock_timestamp(),updated_at=clock_timestamp()
     WHERE id=${seedValidationStageId}::uuid
  `);
  const expiredReceiptSettlement = await finishSfpProviderOperation({
    reservation: expiredReceiptReservation,
    outcome: "completed",
    observation: "valid",
    businessId: expiredReceiptFixture.businessId,
    emailTokenHash: hashEmailToken(expiredReceiptFixture.email),
    workUnit: "request",
    workCompleted: 1,
    providerUsage: {
      status: "unknown",
      quantity: null,
      unit: null,
      source: "task_2056_disposable_expiring_receipt_fixture",
    },
    resultData: { retrievalState: "completed" },
  });
  assert.equal(expiredReceiptSettlement.replayed, false);
  const expiredReceiptAttempt = rows(await db.execute(sql`
    SELECT id,outcome,dispatch_marked_at
      FROM provider_attempts
     WHERE operation_id=${expiredReceiptReservation.operationId}::uuid
       AND attempt_number=1
  `))[0];
  const expiredReceiptOperation = rows(await db.execute(sql`
    SELECT state,billing_state
      FROM provider_operations
     WHERE id=${expiredReceiptReservation.operationId}::uuid
  `))[0];
  assert.ok(expiredReceiptAttempt?.id && expiredReceiptAttempt.dispatch_marked_at);
  assert.equal(expiredReceiptAttempt.outcome, "completed");
  assert.equal(expiredReceiptOperation.state, "completed");
  assert.equal(expiredReceiptOperation.billing_state, "committed");
  const seedObservationCount = Number(rows(await db.execute(sql`
    SELECT COUNT(*)::int AS count FROM provider_observations
     WHERE operation_id=${expiredReceiptReservation.operationId}::uuid
       AND provider='zerobounce'
  `))[0].count);
  assert.equal(seedObservationCount, 0,
    "the retired disposable seed stage leaves the settled operation ready for one explicit-expiry observation");
  const expiredReceipt = rows(await db.execute(sql`
    INSERT INTO provider_observations
      (provider,operation_id,attempt_id,subject_type,subject_id,email_token_hash,
       outcome,retryable,observed_at,expires_at)
    VALUES ('zerobounce',${expiredReceiptReservation.operationId}::uuid,
      ${String(expiredReceiptAttempt.id)}::uuid,'business',${expiredReceiptFixture.businessId},
      ${hashEmailToken(expiredReceiptFixture.email)},'valid',FALSE,
      clock_timestamp(),clock_timestamp()+INTERVAL '15 seconds')
    RETURNING id,operation_id,attempt_id,observed_at,expires_at::text AS expires_at
  `))[0];
  assert.ok(expiredReceipt?.id);
  assert.equal(String(expiredReceipt.operation_id), String(expiredReceiptReservation.operationId));
  assert.equal(String(expiredReceipt.attempt_id), String(expiredReceiptAttempt.id));
  const expiredReceiptDeadline = String(expiredReceipt.expires_at);

  const expiredReceiptRunId = await createFrozenBridgeCohort(
    "expired-receipt-projection-finalization",
    expiredReceiptFixture.businessId,
  );
  const expiredReceiptFinalPreview = await previewSfpValidation(expiredReceiptRunId);
  assert.equal(expiredReceiptFinalPreview.addressesForValidation, 1,
    "the finalization cohort selects the business whose genuine receipt is cached");
  const expiredReceiptReached = makeDeferred<void>();
  const expiredReceiptRelease = makeDeferred<void>();
  let expiredReceiptTransportCalls = 0;
  const expiredReceiptValidation = observeBackground(executeSfpValidation(expiredReceiptRunId, {
    idempotencyKey: `${runKey}-expired-receipt-projection-validation`,
    snapshotHash: expiredReceiptFinalPreview.snapshotHash,
    actorId: reviewerId,
    maxValidations: 25,
    zbTransport: async () => {
      expiredReceiptTransportCalls++;
      return { status: "valid" } as any;
    },
    concurrencyTestHooks: {
      onFinalEligibilityLocksHeld: async (context: any) => {
        if (context.businessId !== expiredReceiptFixture.businessId) return;
        expiredReceiptReached.resolve();
        await expiredReceiptRelease.promise;
      },
    },
  }));
  try {
    await waitForBarrier(expiredReceiptReached.promise, "EXPIRED_RECEIPT_BARRIER_NOT_REACHED");
    const expiryDeadline = Date.now() + 15_000;
    let receiptExpiryReached = false;
    while (!receiptExpiryReached && Date.now() < expiryDeadline) {
      receiptExpiryReached = rows(await db.execute(sql`
        SELECT expires_at<=clock_timestamp() AS expired
          FROM provider_observations WHERE id=${String(expiredReceipt.id)}::uuid
      `))[0]?.expired === true;
      if (!receiptExpiryReached) await delay(25);
    }
    const observedReceiptDeadline = rows(await db.execute(sql`
      SELECT expires_at::text AS expires_at
        FROM provider_observations WHERE id=${String(expiredReceipt.id)}::uuid
    `))[0]?.expires_at;
    assert.equal(String(observedReceiptDeadline), expiredReceiptDeadline,
      "the wait is bound to the exact immutable observation expiry stored by PostgreSQL");
    check(receiptExpiryReached,
      "the database clock passes the provider receipt's bounded expiry while final eligibility locks are held");
  } finally {
    expiredReceiptRelease.resolve();
  }
  const expiredReceiptResult = await expiredReceiptValidation;
  const expiredReceiptState = rows(await db.execute(sql`
    SELECT e.status,e.decision_reason,e.validation_at,e.validation_operation_id,e.reused_from_operation_id,
           e.validation_expires_at<=clock_timestamp() AS expired_at_commit,
           o.state AS operation_state,o.billing_state,
           b.main_email,b.email_discovery_status
      FROM sfp_outreach_eligibility e
      JOIN provider_operations o ON o.id=COALESCE(e.validation_operation_id,e.reused_from_operation_id)
      JOIN businesses b ON b.id=e.business_id
     WHERE e.cohort_run_id=${expiredReceiptRunId}::uuid
       AND e.business_id=${expiredReceiptFixture.businessId}
  `))[0];
  check(expiredReceiptTransportCalls === 0 &&
    expiredReceiptResult.failedCount > 0 &&
    expiredReceiptState?.expired_at_commit === true &&
    expiredReceiptState?.status === "validation_pending" &&
    expiredReceiptState?.decision_reason === "provider_observation_expired_before_eligibility_commit" &&
    String(expiredReceiptState?.reused_from_operation_id) === String(expiredReceiptReservation.operationId) &&
    expiredReceiptState?.operation_state === "completed" &&
    expiredReceiptState?.billing_state === "committed" &&
    expiredReceiptState?.main_email == null &&
    expiredReceiptState?.email_discovery_status !== "provider_valid",
  "cached receipt expiry during the held finalization barrier preserves the original settled operation but forbids a stale business email projection");
} finally {
  if (reviewApiServer) {
    await new Promise<void>((resolve) => reviewApiServer.close(() => resolve()));
  }
  await pool.end();
}

console.log(`\nTASK2056_CONTACT_CERTIFICATION assertions=${assertions} failures=${failures}`);
if (failures > 0) process.exitCode = 1;