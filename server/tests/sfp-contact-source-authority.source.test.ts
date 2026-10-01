import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

const writer = read("server/services/cro03/sfp-paid-evidence-writer.ts");
const continuousDiscovery = read("server/services/cro03/sfp-continuous-discovery.ts");
const prospecting = read("server/services/cro03/south-florida-prospecting.ts");
const freeEvidence = read("server/services/free-discovery/evidence-service.ts");
const contactCoverage = read("server/services/contact-link-coverage.ts");
const queueManager = read("server/services/queue-manager.ts");
const leadOps = read("server/routes/lead-ops.ts");
const authority = read("server/services/commercial-link-authority.ts");
const schema = read("shared/schema.ts");
const migration = read("migrations/0309_sfp_verified_contact_source.sql");
const journal = read("migrations/meta/_journal.json");

const auditInsertStart = writer.indexOf("INSERT INTO audit_logs");
const auditInsertEnd = writer.indexOf("\n  `);", auditInsertStart);
assert.notEqual(auditInsertStart, -1);
assert.notEqual(auditInsertEnd, -1);
const candidateOpenAuditInsert = writer.slice(auditInsertStart, auditInsertEnd);
assert.match(writer, /const auditDetails = sanitizeAuditPayload\(\{/);
assert.match(candidateOpenAuditInsert, /JSON\.stringify\(auditDetails\)/);
assert.doesNotMatch(candidateOpenAuditInsert, /\bplaintext\b/);
assert.match(candidateOpenAuditInsert, /resolved\.evidenceId/);
assert.match(candidateOpenAuditInsert, /input\.actorId/);
assert.match(writer, /sourceKind: resolved\.sourceKind/);
assert.match(writer, /evidenceId: resolved\.evidenceId/);
assert.match(writer, /businessId: resolved\.businessId/);
assert.match(writer, /purpose: input\.purpose/);
assert.match(writer, /cohortRunId: input\.cohortRunId/);
assert.match(candidateOpenAuditInsert, /'sfp_candidate_plaintext_opened'.*'sfp_candidate_evidence'.*'user'/);

const scheduleAuditStart = prospecting.indexOf("INSERT INTO audit_logs", prospecting.indexOf("setCampaignStagingSchedule"));
const scheduleAuditEnd = prospecting.indexOf("\n    `);", scheduleAuditStart);
assert.notEqual(scheduleAuditStart, -1);
assert.notEqual(scheduleAuditEnd, -1);
const scheduleAuditInsert = prospecting.slice(scheduleAuditStart, scheduleAuditEnd);
assert.match(scheduleAuditInsert, /JSON\.stringify\(sanitizeAuditPayload\(\{/);
assert.match(scheduleAuditInsert, /'sfp_campaign_staging_schedule_changed'/);
assert.match(scheduleAuditInsert, /input\.actorId/);
assert.match(prospecting, /recurringEnabled: input\.recurringEnabled/);
assert.match(prospecting, /campaignStagingBatchSize: input\.batchSize/);
assert.match(prospecting, /programActive: current\.is_active === true/);

const admissionAuditStart = freeEvidence.indexOf(
  "await db.insert(auditLogs).values({",
  freeEvidence.indexOf("export async function promoteCandidateForValidation"),
);
const admissionAuditEnd = freeEvidence.indexOf("}).catch(", admissionAuditStart);
assert.notEqual(admissionAuditStart, -1);
assert.notEqual(admissionAuditEnd, -1);
const admissionAuditInsert = freeEvidence.slice(admissionAuditStart, admissionAuditEnd);
assert.match(admissionAuditInsert, /action: "free_discovery_candidate_admitted"/);
assert.match(admissionAuditInsert, /entityType: "free_discovery_candidate"/);
assert.match(admissionAuditInsert, /entityKey: candidateId/);
assert.match(admissionAuditInsert, /details: sanitizeAuditPayload\(\{/);
assert.match(admissionAuditInsert, /candidateId,/);
assert.match(admissionAuditInsert, /candidate\.business_id/);
assert.match(admissionAuditInsert, /candidate\.contact_id/);
assert.match(admissionAuditInsert, /candidate\.domain/);
assert.match(admissionAuditInsert, /policyId: String\(policy\.id\)/);
assert.match(admissionAuditInsert, /actorType: "system"/);
assert.match(admissionAuditInsert, /actorId: "free-discovery-promotion"/);
assert.doesNotMatch(admissionAuditInsert, /attestationId/);

function sourceAuditInsert(source: string, action: string): string {
  const actionAt = source.indexOf(action);
  assert.notEqual(actionAt, -1, `missing audit action ${action}`);
  const sqlInsertAt = source.lastIndexOf("INSERT INTO audit_logs", actionAt);
  const drizzleInsertAt = source.lastIndexOf("insert(auditLogs).values({", actionAt);
  const insertAt = Math.max(sqlInsertAt, drizzleInsertAt);
  assert.notEqual(insertAt, -1, `missing insert for audit action ${action}`);
  if (drizzleInsertAt > sqlInsertAt) {
    const closeAt = source.indexOf("}).catch", actionAt);
    assert.notEqual(closeAt, -1, `missing Drizzle audit close for ${action}`);
    return source.slice(insertAt, closeAt);
  }
  const endCandidates = [
    source.indexOf("`);", actionAt),
    source.indexOf("`).catch", actionAt),
  ].filter((index) => index >= 0);
  assert.ok(endCandidates.length > 0, `missing SQL audit close for ${action}`);
  return source.slice(insertAt, Math.min(...endCandidates) + 3);
}

const remainingBaselineAuditCases: Array<{ source: string; action: string; fields: RegExp[] }> = [
  { source: prospecting, action: "sfp_validation_promotion_override_changed", fields: [/SFP_VALIDATION_PROMOTION_OVERRIDE_KEY/, /input\.actorId/, /override: input\.value/, /effective/ ] },
  { source: prospecting, action: "sfp_program_initialized_from_legacy_config", fields: [/String\(created\.id\)/, /opts\.actorId/, /sourceHash/, /legacyVerticalIds/] },
  { source: prospecting, action: "sfp_program_migrated_taxonomy_v2", fields: [/String\(updated\.id\)/, /opts\.actorId/, /previousVerticalIds/, /previousPolicyVersion/, /newVerticalIds/, /newPolicyVersion/, /taxonomyVersion/] },
  { source: prospecting, action: "sfp_program_activation_changed", fields: [/program\.id/, /input\.actorId/, /active: input\.active/, /recurringEnabled/, /campaignStagingBatchSize/] },
  { source: prospecting, action: "sfp_cohort_run_voided", fields: [/opts\.cohortRunId/, /opts\.actorId/, /reason: opts\.reason/] },
  { source: prospecting, action: "sfp_cohort_run_superseded", fields: [/opts\.cohortRunId/, /opts\.actorId/, /supersededByRunId: opts\.supersededByRunId/] },
  { source: freeEvidence, action: "free_discovery_generation_auto_reclaimed", fields: [/String\(row\.id\)/, /row\.run_key/, /row\.actor_id/, /row\.reason/, /staleAfterMs/, /row\.started_at/, /row\.subject_count/, /row\.candidate_count/, /free_discovery_generation_reaper/] },
  { source: queueManager, action: "free_enrichment_processing_auto_reclaimed", fields: [/String\(bizRow\.id\)/, /'business'/, /'free-enrichment-lane-reaper'/, /staleAfterMs: BUSINESS_STALE_MS/] },
  { source: leadOps, action: "sfp_stage2_serper_single_probe", fields: [/String\(businessId\)/, /'business'/, /admin:/, /businessId, succeeded/, /windowCallsBefore/, /windowCallsAfter/] },
  { source: leadOps, action: "sfp_serper_provider_approved", fields: [/provider_control/, /'serper'/, /cohortRunId/, /maxBusinesses/, /reason/, /sanitizeAuditPayload\(updated\)/, /actor_type,actor_id/] },
  { source: leadOps, action: "sfp_paid_provider_approved", fields: [/provider_control/, /\$\{provider\}/, /reason/, /sanitizeAuditPayload\(updated\)/, /actor_type,actor_id/] },
];
for (const { source, action, fields } of remainingBaselineAuditCases) {
  const insert = sourceAuditInsert(source, action);
  assert.match(insert, /sanitizeAuditPayload/);
  for (const field of fields) assert.match(insert, field);
}
assert.match(
  continuousDiscovery,
  /INSERT INTO audit_logs[\s\S]*JSON\.stringify\(sanitizeAuditPayload\(\{ outcome, \.\.\.details \}\)\)/,
);
assert.match(continuousDiscovery, /'sfp_program', 'south_florida_v2'/);
assert.match(continuousDiscovery, /'system', 'sfp-continuous-discovery'/);
const checkpointWriterStart = contactCoverage.indexOf("async function writeCoverageCheckpoint");
const checkpointWriterEnd = contactCoverage.indexOf("\nasync function insertPageCandidates", checkpointWriterStart);
assert.notEqual(checkpointWriterStart, -1);
assert.notEqual(checkpointWriterEnd, -1);
const checkpointWriter = contactCoverage.slice(checkpointWriterStart, checkpointWriterEnd);
assert.match(checkpointWriter, /INSERT INTO audit_logs/);
assert.match(checkpointWriter, /JSON\.stringify\(sanitizeAuditPayload\(state\)\)/);
assert.match(checkpointWriter, /CONTACT_LINK_COVERAGE_CHECKPOINT_ACTION/);
assert.match(checkpointWriter, /CONTACT_LINK_COVERAGE_WORKFLOW/);
assert.match(checkpointWriter, /actorId \? "user" : "system"/);
for (const action of ["sfp_serper_provider_approved", "sfp_paid_provider_approved"]) {
  assert.match(sourceAuditInsert(leadOps, action), /JSON\.stringify\(sanitizeAuditPayload\(updated\)\)/);
}

assert.match(writer, /JOIN contact_business_link_decisions d/);
assert.match(writer, /d\.decision='verified' AND d\.superseded_at IS NULL/);
assert.match(writer, /contactBusinessLinkRevision/);
assert.match(writer, /SFP_CONTACT_SOURCE_PIN_STALE/);
assert.match(writer, /const plaintext = resolved\.sourceKind === "contact"\s+\? String\(resolvedRow\.email\)\s+: unseal/);
assert.match(writer, /assertNoPlaintextEscape\(result, plaintext\)/);
assert.match(writer, /emailNormalizedValueHash\(String\(c\.email\)\)/);
assert.doesNotMatch(writer, /contactId\}::uuid/);

assert.match(authority, /getCurrentVerifiedContactLinkPin/);
assert.match(authority, /normalizedEmailHashVersion: 1/);
assert.match(authority, /d\.decision = 'verified'/);
assert.match(authority, /revision: Number\(r\.revision\)/);

assert.match(schema, /contactBusinessLinkDecisionId: uuid\("contact_business_link_decision_id"\)/);
assert.match(schema, /source_kind = 'contact' AND contact_id IS NOT NULL/);
assert.match(schema, /references\(\(\) => contacts\.id, \{ onDelete: "restrict" \}\)/);
assert.match(schema, /export const sfpOutreachEligibility = pgTable/);
assert.match(schema, /export const sfpCampaignStagingIntents = pgTable/);
assert.match(schema, /contactId: integer\("contact_id"\)/);
assert.match(schema, /normalizedValueHashVersion: integer\("normalized_value_hash_version"\)/);
assert.match(migration, /0306 introduced contact_id with SET NULL/);
assert.match(migration, /ALTER TABLE sfp_campaign_staging_intents/);
assert.match(migration, /ON DELETE RESTRICT/);
assert.match(migration, /source_kind = 'contact'/);
assert.match(migration, /normalized_value_hash_version IN \(0,1\)/);
assert.match(journal, /"idx": 313,\s+"version": "7",\s+"when": 1800000013400,\s+"tag": "0309_sfp_verified_contact_source"/);

console.log("SFP verified contact source contracts passed");

// Pure sanitizer contract for the exact provenance fields written by the
// audited boundaries: safe metadata survives, while an email accidentally
// keyed as PII is redacted.
const { sanitizeAuditPayload } = await import("../services/audit-sanitizer");
const candidateEmail = "candidate.private@example.invalid";
const safeAuditDetails = sanitizeAuditPayload({
  sourceKind: "contact",
  evidenceId: "42",
  businessId: 7,
  purpose: "sfp_email_validation",
  cohortRunId: "run-123",
  email: candidateEmail,
}) as Record<string, unknown>;
assert.deepEqual(
  {
    sourceKind: safeAuditDetails.sourceKind,
    evidenceId: safeAuditDetails.evidenceId,
    businessId: safeAuditDetails.businessId,
    purpose: safeAuditDetails.purpose,
    cohortRunId: safeAuditDetails.cohortRunId,
  },
  {
    sourceKind: "contact",
    evidenceId: "42",
    businessId: 7,
    purpose: "sfp_email_validation",
    cohortRunId: "run-123",
  },
);
assert.notEqual(safeAuditDetails.email, candidateEmail);
assert.doesNotMatch(JSON.stringify(safeAuditDetails), new RegExp(candidateEmail));
const safeScheduleAudit = sanitizeAuditPayload({
  recurringEnabled: true,
  campaignStagingBatchSize: 12,
  programActive: true,
}) as Record<string, unknown>;
assert.deepEqual(safeScheduleAudit, {
  recurringEnabled: true,
  campaignStagingBatchSize: 12,
  programActive: true,
});
const safeAdmissionAudit = sanitizeAuditPayload({
  candidateId: "candidate-uuid",
  businessId: 7,
  contactId: 42,
  domain: "example.invalid",
  policyId: "policy-uuid",
}) as Record<string, unknown>;
assert.deepEqual(safeAdmissionAudit, {
  candidateId: "candidate-uuid",
  businessId: 7,
  contactId: 42,
  domain: "example.invalid",
  policyId: "policy-uuid",
});
const baselineAuditPayloads = [
  { outcome: "completed", cohortRunId: "cohort-uuid", count: 3 },
  { override: true, effective: true },
  { source: "cro03c_roi_pilot_verticals", sourceHash: "sha256:abc", verticalIds: [1, 2] },
  { previousVerticalIds: [1], previousPolicyVersion: 1, newVerticalIds: [2], newPolicyVersion: 2, taxonomyVersion: 2 },
  { active: true, recurringEnabled: true, campaignStagingBatchSize: 12 },
  { reason: "operator request" },
  { supersededByRunId: "replacement-uuid" },
  { runKey: "run-2026-01", actorId: "operator-uuid", reason: "stale generation", startedAt: "2026-01-01T00:00:00Z", staleAfterMs: 1000, recoveredSubjectCount: 2, recoveredCandidateCount: 4 },
  { staleAfterMs: 1000 },
  { state: "ready", runId: "run-uuid", cursor: 10, total: 20 },
  { businessId: 7, succeeded: true, blocked: false, ok: true, status: 200, windowCallsBefore: 2, windowCallsAfter: 3 },
  { cohortRunId: "cohort-uuid", maxBusinesses: 10, reason: "operator approval" },
  { reason: "operator approval" },
];
for (const payload of baselineAuditPayloads) {
  assert.deepEqual(sanitizeAuditPayload(payload), payload);
}
console.log("SFP audit inserts use canonical sanitizer without losing provenance");

// Behavioral mixed-source regression: the organization observation remains
// the exact candidate/source row, but cannot erase the named-person safety
// classification contributed by the verified contact at the same address.
process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
const { propagateRestrictiveSfpSubjectType } = await import("../services/cro03/sfp-paid-evidence-writer");
const mixed = propagateRestrictiveSfpSubjectType([
  {
    _hashKey: "biz:42:email:addr-v1",
    sourceKind: "paid",
    evidenceId: "paid-org-row",
    provider: "outscraper",
    subjectType: "business",
    candidateReference: { sourceKind: "paid", paidCandidateEvidenceId: "paid-org-row" },
  },
  {
    _hashKey: "biz:42:email:addr-v1",
    sourceKind: "contact",
    evidenceId: "contact:17",
    provider: null,
    subjectType: "person",
    candidateReference: { sourceKind: "contact", contactId: "17", contactBusinessLinkDecisionId: "decision-1" },
  },
  {
    _hashKey: "biz:42:email:another-v1",
    sourceKind: "paid",
    evidenceId: "paid-role-row",
    provider: "apollo",
    subjectType: "business",
    candidateReference: { sourceKind: "paid", paidCandidateEvidenceId: "paid-role-row" },
  },
]);
const retainedOrganizationObservation = mixed.find((candidate) => candidate.evidenceId === "paid-org-row")!;
assert.equal(retainedOrganizationObservation.subjectType, "person");
assert.equal(retainedOrganizationObservation.sourceSubjectType, "business");
assert.equal(retainedOrganizationObservation.provider, "outscraper");
assert.deepEqual(retainedOrganizationObservation.candidateReference, {
  sourceKind: "paid", paidCandidateEvidenceId: "paid-org-row",
});
assert.equal(mixed.find((candidate) => candidate.evidenceId === "paid-role-row")!.subjectType, "business");
console.log("SFP mixed-source named-person restriction preserves exact candidate source");