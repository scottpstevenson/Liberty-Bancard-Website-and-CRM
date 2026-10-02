import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const service = await readFile(new URL("../services/cro03/sfp-staged-projection-reconciliation.ts", import.meta.url), "utf8");
const routes = await readFile(new URL("../routes/sfp-staged-projection-reconciliation.ts", import.meta.url), "utf8");
const setup = await readFile(new URL("../routes/lead-ops.ts", import.meta.url), "utf8");

assert.match(service, /contact_business_sfp_link_evidence/);
assert.match(service, /createHash\("sha256"\)\.update\(JSON\.stringify\(facts\)\)/);
assert.match(service, /i\.validation_snapshot->>'validationExpiresAt'/);
assert.match(service, /po\.observed_at::text AS receipt_observed_at/);
assert.match(service, /md5\(jsonb_build_object\('intent',to_jsonb\(i\),'eligibility',to_jsonb\(e\)\)/);
assert.match(service, /await lockSfpEligibilityProjectionWriteGate\(tx\);\s+const policy = await lockCurrentSfpOutreachPolicy\(tx\);\s+await lockCurrentSfpRuntimeOwner\(tx\)/);
assert.match(service, /lockSfpBusinessSafetySentinel\(tx, businessId, "exclusive"\)/);
assert.match(service, /lockSfpContactAddress\(tx, email\)/);
assert.match(service, /checkCurrentSfpEligibilityAndPackage\(tx/);
assert.match(service, /isCurrentSfpValidationReceiptFresh\(tx/);
assert.match(service, /INSERT INTO audit_logs/);
assert.match(service, /sanitizeAuditPayload\(auditDetails\)/);
assert.match(service, /staged_projection_reconciled_from_immutable_business_role_evidence/);
assert.match(service, /status='validated_outreach_eligible',named_contact=FALSE,role_inbox=TRUE/);
assert.match(service, /e\.suppression_status='not_suppressed'/);
assert.match(service, /restoration_validation_expires_at/);
assert.match(service, /free_attribution_scope !== "role"/);
assert.match(service, /row\.source_kind === "free" && row\.candidate_id != null/);
assert.match(service, /current_restrictive_or_unproven_state:\$\{row\.status\}/);
assert.match(service, /receiptWrites: 0, approvals: 0, sends: 0, providerCalls: 0/);
assert.doesNotMatch(service, /INSERT INTO provider_observations|UPDATE provider_observations|fetch\(/i);
assert.doesNotMatch(service, /UPDATE sfp_campaign_staging_intents|UPDATE sfp_ready_held_enrollments|UPDATE sequence_enrollments/i);
assert.match(routes, /requireRole\("admin"\)/);
assert.match(routes, /SFP_STAGED_PROJECTION_RECONCILIATION_PREVIEW_CHANGED/);
assert.match(routes, /staged-projection-reconciliation\/execute/);
assert.match(setup, /registerSfpStagedProjectionReconciliationRoutes\(app\)/);

console.log("SFP staged projection reconciliation safety-source tests passed");