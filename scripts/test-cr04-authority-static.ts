#!/usr/bin/env npx tsx
import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync("migrations/0178_cr04_channel_cohort_authority.sql", "utf8");
const authority = fs.readFileSync("server/services/cr04-cohort-ready-authority.ts", "utf8");
const queue = fs.readFileSync("server/routes/outreach-queue.ts", "utf8");
const campaign = fs.readFileSync("server/services/campaign-engine.ts", "utf8");
const promotional = fs.readFileSync("server/services/promotional-enrollment-eligibility.ts", "utf8");
const worker = fs.readFileSync("server/services/sequence-worker.ts", "utf8");

assert.match(migration, /cr04_channel_decisions/);
assert.match(migration, /UNIQUE\s+\(contact_id,channel,purpose,policy_version,dependency_fingerprint\)/);
assert.match(migration, /CR04_FROZEN_MEMBER_IMMUTABLE/);
assert.match(migration, /CR04_FROZEN_MEMBER_DELETE_FORBIDDEN/);
assert.match(migration, /CR04_DECISION_IMMUTABLE/);
assert.match(migration, /UNIQUE \(definition_id,idempotency_key\)/);
assert.match(migration, /idempotency_key TEXT NOT NULL UNIQUE/);
assert.doesNotMatch(migration, /\bINSERT\s+INTO\s+cr04_(?:cohort_runs|cohort_members|enrollment_intents)\b/i);

for (const channel of ["email", "manual_call", "sms"]) assert.match(authority, new RegExp(`"${channel}"`));
for (const dependency of [
  "authorizeCommercialUse",
  "evaluateContactability",
  "evaluateMarketingEmailEligibility",
  "canEnrollContactInSequence",
  "cro03_source_observations",
]) assert.match(authority, new RegExp(dependency));

assert.match(queue, /queryCr04ReadyProjection/);
assert.match(queue, /enrollThroughCr04Fence/);
assert.match(queue, /Idempotency-Key/);
assert.match(queue, /current frozen cohort is required/i);
assert.match(queue, /requireRole\("admin", "manager"\)/);
assert.match(campaign, /evaluateCr04ChannelQualification/);
assert.equal((campaign.match(/CR04_FROZEN_PREVIEW_REQUIRED/g) ?? []).length, 2);
assert.match(campaign, /cr04DecisionId/);
assert.match(promotional, /evaluateCr04ChannelQualification/);
assert.match(worker, /enrollThroughCr04Fence/);
assert.match(worker, /if \(!opts\?\.promotionalIntent\)/);
assert.match(worker, /CR04_PROMOTIONAL_INTENT_REQUIRED/);
assert.match(authority, /outbound-pause-authority/);
assert.match(authority, /outbound-queue-coordinator/);
assert.match(authority, /resolveSender\("cold_outreach"\)/);
assert.match(authority, /decisionEpoch:\s*Math\.floor/);
assert.match(authority, /authorityFingerprint/);
assert.match(authority, /FROM cr04_cohort_runs[\s\S]*FOR UPDATE/);
assert.doesNotMatch(authority, /tx\.insert\(sequenceEnrollments\)/);
assert.doesNotMatch(authority, /set\(\{\s*status:\s*"consumed"/);
assert.match(authority, /status:\s*"blocked"/);
assert.match(authority, /ACTIVATION_AUTHORITY_NOT_ENABLED/);
assert.doesNotMatch(queue, /readyForOutreachPredicate/);

console.log("CR-04 static authority contract: PASS");