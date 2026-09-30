#!/usr/bin/env npx tsx
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluateSfpEmailTypePolicy } from "../server/services/cro03/sfp-outreach-policy";
import { isFrozenV2ClassificationAdmissible } from "../server/services/cro03/sfp-campaign-staging-v2";

const policy = {
  id: "policy", version: 1, documentHash: "hash", validationTtlDays: 30,
  acceptedOutcomes: ["valid"], retryableOutcomes: [], consentTierPolicy: {},
  reasonCodes: [], roleInboxPolicy: {
    role_inbox_eligible_for_cold_b2b: true,
    named_or_unclassified_requires_review: true,
  },
};

assert.deepEqual(
  evaluateSfpEmailTypePolicy({ namedContact: true, roleInbox: false, policy }),
  { status: "eligibility_review_required", reasonCode: "named_email_requires_eligibility_review" },
  "named person remains a named person and requires eligibility review under active policy",
);
assert.deepEqual(
  evaluateSfpEmailTypePolicy({
    namedContact: true,
    roleInbox: false,
    policy: { ...policy, roleInboxPolicy: { ...policy.roleInboxPolicy, named_or_unclassified_requires_review: false } },
  }),
  { status: "eligible_for_staging_review", reasonCode: "named_email_policy_eligible_for_review" },
  "a named person can be policy-eligible for held staging review only when the active policy says so",
);
assert.deepEqual(
  evaluateSfpEmailTypePolicy({ namedContact: false, roleInbox: true, policy }),
  { status: "eligible_for_staging_review", reasonCode: "role_inbox_policy_eligible_for_review" },
  "role inbox policy is evaluated independently from named-person policy",
);

const classification = {
  targetVertical: "Construction/Trades/Home Services",
  classifierVersion: 3,
  taxonomyVersion: 2,
  currentTaxonomyVersion: 2,
  classificationPolicyVersion: 7,
  currentPolicyVersion: 7,
  decisionTarget: "Construction/Trades/Home Services",
  evidenceTarget: "Construction/Trades/Home Services",
  evidenceOutcome: "target",
  decisionEvidenceHash: "frozen-hash",
  evidenceHash: "frozen-hash",
};
assert.equal(isFrozenV2ClassificationAdmissible(classification), true,
  "raw NULL or legacy labels can route through the exact frozen v2 classification target");
assert.equal(isFrozenV2ClassificationAdmissible({ ...classification, targetVertical: null }), false,
  "unresolved classification cannot route");
assert.equal(isFrozenV2ClassificationAdmissible({ ...classification, evidenceTarget: "Automotive" }), false,
  "conflicting frozen target evidence cannot route");
assert.equal(isFrozenV2ClassificationAdmissible({ ...classification, evidenceHash: "changed" }), false,
  "changed evidence hash cannot route");
assert.equal(isFrozenV2ClassificationAdmissible({ ...classification, currentTaxonomyVersion: 1 }), false,
  "stale v1 taxonomy cannot route to a v2 package");
assert.equal(isFrozenV2ClassificationAdmissible({ ...classification, currentPolicyVersion: 8 }), false,
  "stale classification policy cannot route");

const staging = readFileSync(new URL("../server/services/cro03/sfp-campaign-staging-v2.ts", import.meta.url), "utf8");
const bridge = readFileSync(new URL("../server/services/cro03/sfp-enrollment-bridge.ts", import.meta.url), "utf8");
const worker = readFileSync(new URL("../server/services/cro03/sfp-campaign-staging-worker.ts", import.meta.url), "utf8");
assert.match(staging, /sourceKind:\s*"free"\s*\|\s*"paid"\s*\|\s*"contact"/,
  "staging preview carries contact as a distinct source kind");
assert.match(staging, /sourceKind:\s*"contact"\s+as const,\s*contactId:/,
  "contact plaintext is opened through the audited contact reference");
assert.match(staging, /paid_candidate_evidence_id,\s*contact_id,\s*source_kind/,
  "staging intent persists the typed contact source pin");
assert.match(bridge, /WHERE c\.id=\$\{Number\(intent\.contact_id\)\}/,
  "bridge resolves a pinned source contact by its exact ID");
assert.match(bridge, /PINNED_SOURCE_CONTACT_LINK_REVOKED_OR_AMBIGUOUS/,
  "revoked or ambiguous pinned contact remains held");
assert.match(bridge, /PINNED_SOURCE_CONTACT_EMAIL_STALE/,
  "email drift on the pinned contact remains held");
assert.match(bridge, /status='paused'/,
  "bridge only creates paused enrollments");
assert.match(worker, /e\.paid_candidate_evidence_id,\s*e\.contact_id/,
  "recurring worker carries the typed contact reference to staging");
assert.doesNotMatch(staging.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, ""), /INSERT INTO sequence_enrollments|campaign_queue_runs|campaign_queue_items/,
  "staging remains isolated from enrollment and dispatch");

console.log("SFP C1/C3/C6 typed contact, classification and policy tests passed");