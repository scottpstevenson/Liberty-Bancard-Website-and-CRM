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
  const express = (await import("express")).default;
  const { registerLeadOpsRoutes } = await import("../server/routes/lead-ops");
const { writeContact } = await import("../server/services/contact-writer");
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
const { seal } = await import("../server/services/cro03/candidate-evidence-service");
const { writeSfpPaidCandidateEvidence } = await import("../server/services/cro03/sfp-paid-evidence-writer");

try {
  const business = rows(await db.execute(sql`
    INSERT INTO businesses (canonical_name, normalized_name, vertical, state, record_class, created_at)
    VALUES (${`${runKey} canonical trades business`}, ${`${runKey} canonical trades business`.toLowerCase()},
            NULL, 'FL', 'canonical', NOW())
    RETURNING id
  `))[0];
  const businessId = Number(business.id);

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
  const opened = await openSfpCandidatePlaintext({
    reference: linkInput, cohortRunId: randomUUID(), actorId: reviewerId, purpose: "sfp_email_validation",
  }, async (plaintext) => {
    callbackSawRealEmail = plaintext === email;
    return true;
  }).catch((error) => `ERROR:${String((error as Error).message)}`);
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
      (name, county_fips, vertical_ids, max_cohort_size, policy_version, is_active, created_by, taxonomy_version)
    VALUES (${`${runKey}-program`}, ARRAY['12086'], ARRAY['Construction/Trades/Home Services'],
      10, 1, TRUE, ${runKey}, 2)
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
  const cohortOpen = await openSfpCandidatePlaintext({
    reference: linkInput, cohortRunId, actorId: reviewerId, purpose: "sfp_email_validation",
  }, async (plaintext) => {
    callbackSawRealEmail = plaintext === email;
    return { accepted: true };
  });
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
  check(await rejected(() => openSfpCandidatePlaintext({
    reference: linkInput, cohortRunId, actorId: reviewerId, purpose: "sfp_email_validation",
  }, async () => true), /SFP_CANDIDATE_REFERENCE_NOT_FOUND/),
  "revoked link is rejected before audited plaintext opening");

  const reapproved = await decideContactBusinessLink({
    contactId, businessId, decision: "verified", decisionKey: `${runKey}-verified-2`,
    reviewerId, evidenceSourceEventId: sourceEventId, expectedRevision: 2,
  });
  const activeDecisionId = String(reapproved.id);
  const activeRevision = Number(reapproved.revision);
  const activeLinkInput = { ...linkInput, contactBusinessLinkDecisionId: activeDecisionId, contactBusinessLinkRevision: activeRevision };

  // Seed only the disposable runtime/provider authorities needed to traverse
  // the real paid reservation path. The ZeroBounce API key is a dummy and its
  // single HTTPS URL is intercepted by the fake fetch above.
  const sfpRuntimeIdentity = await (await import("./helpers/sfp-runtime-test-identity")).getSfpRuntimeTestIdentity();
  const attestationKey = `${runKey}-runtime-attestation`;
  await db.execute(sql`
    INSERT INTO cro03c_runtime_attestations
      (idempotency_key,worker_identities,artifact_sha,migration_head,deployment_identity,
       environment_identity,web_boot_identity,worker_boot_identity,queue_topology_hash,
       worker_heartbeat_at,db_healthy,redis_healthy,captured_at,expires_at,attestation_hash,created_by)
    VALUES (${attestationKey},${JSON.stringify([sfpRuntimeIdentity.processIdentity])}::jsonb,
       ${sfpRuntimeIdentity.artifactSha},'task-2056-disposable',
       ${sfpRuntimeIdentity.deploymentIdentity},${sfpRuntimeIdentity.environmentIdentity},
       'task-2056-disposable-web','task-2056-disposable-worker',
       ${sfpRuntimeIdentity.queueTopologyHash},NOW(),TRUE,TRUE,NOW(),NOW()+INTERVAL '1 hour',
       ${createHash("sha256").update(attestationKey).digest("hex")},'task-2056-disposable')
  `);
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
    SELECT id, status, source_kind, contact_id, contact_business_link_decision_id,
           contact_business_link_revision, normalized_value_hash, normalized_value_hash_version,
            named_contact, role_inbox, decision_reason, policy_document_id,
            validation_operation_id,reused_from_operation_id,updated_at
      FROM sfp_outreach_eligibility WHERE cohort_run_id=${cohortRunId}::uuid AND business_id=${businessId}
  `))[0];
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
    check(validationRow.source_kind === "contact" && Number(validationRow.contact_id) === contactId,
      "ZeroBounce eligibility retains the exact contact one-of source reference");
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
           normalized_value_hash_version,status
    FROM sfp_outreach_eligibility WHERE id=${targetEligibilityId}::uuid
  `))[0];
  check(String(finalEligibility.contact_business_link_decision_id) === String(finalApproval.id) &&
    Number(finalEligibility.contact_business_link_revision) === Number(finalApproval.revision) &&
    String(finalEligibility.normalized_value_hash) === normalizedHash &&
    Number(finalEligibility.normalized_value_hash_version) === 1 &&
     finalEligibility.status === "validated_review_required",
   "revalidation replaces the old link pin while retaining named-person review status");
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
           package_key,package_version_id,validation_snapshot,lineage
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
           AND query ILIKE '%FROM contacts WHERE id=%FOR UPDATE%'
      `);
      if (Number(waiting.rows?.[0]?.n ?? 0) > 0) {
        revocationWaitObserved = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  });
  check(bridge.status === "created" && bridge.contactResolution === "matched_existing" &&
    Number(bridge.contactId) === contactId && bridge.enrollmentStatus === "paused",
  "manual bridge reuses the pinned source contact and creates only a paused enrollment");
  check(revocationWaitObserved && concurrentRevocation !== null,
    "concurrent link revocation blocks on the bridge's row lock of its pinned contact and decision");
  const concurrentRevocationResult = concurrentRevocation ? await concurrentRevocation : null;
  check(concurrentRevocationResult?.decision === "rejected",
    "queued revocation commits after the bridge's contact-and-decision verification transaction");
  const enrollment = rows(await db.execute(sql`
    SELECT e.status,e.contact_id,l.contact_resolution FROM sequence_enrollments e
    JOIN sfp_ready_held_enrollments l ON l.sequence_enrollment_id=e.id
    WHERE l.staging_intent_id=${String(intent.id)}::uuid
  `))[0];
  check(enrollment?.status === "paused" && Number(enrollment.contact_id) === contactId,
    "bridge ledger points to the same source contact and paused sequence enrollment");
  const bridgeReplay = await bridgeReadyHeldIntentToPausedEnrollment(String(intent.id), reviewerId);
  check(bridgeReplay.status === "already_bridged" && Number(bridgeReplay.contactId) === contactId,
    "manual bridge replay is idempotent and does not create another enrollment");
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
    subjectType: "business", confidence: 90,
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
} finally {
  if (reviewApiServer) {
    await new Promise<void>((resolve) => reviewApiServer.close(() => resolve()));
  }
  await pool.end();
}

console.log(`\nTASK2056_CONTACT_CERTIFICATION assertions=${assertions} failures=${failures}`);
if (failures > 0) process.exitCode = 1;