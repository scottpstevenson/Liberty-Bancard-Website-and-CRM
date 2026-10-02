import assert from "node:assert/strict";
import fs from "node:fs";
import { isSfpReceiptProjectionRepairCandidate } from "../services/cro03/sfp-eligibility-receipt-repair";

const candidate = {
  sourceKind: "free", evidenceId: "candidate-a",
  normalizedValueHash: "address-a", normalizedValueHashVersion: 1,
};
const prior = {
  receipt_projection_needs_repair: true, status: "validated_outreach_eligible",
  source_kind: "free", candidate_id: "candidate-a",
  normalized_value_hash: "address-a", normalized_value_hash_version: 1,
};
assert.equal(isSfpReceiptProjectionRepairCandidate(prior, candidate), true);
for (const change of [
  { receipt_projection_needs_repair: false },
  { receipt_projection_needs_repair: "false" },
  { status: "validated_review_required" },
  { status: "invalid" },
  { source_kind: "paid" },
  { candidate_id: "candidate-b" },
  { normalized_value_hash: "address-b" },
  { normalized_value_hash_version: 0 },
  { normalized_value_hash_version: null },
]) {
  assert.equal(isSfpReceiptProjectionRepairCandidate({ ...prior, ...change }, candidate), false);
}
assert.equal(isSfpReceiptProjectionRepairCandidate(undefined, candidate), false);
assert.equal(isSfpReceiptProjectionRepairCandidate(prior, { ...candidate, normalizedValueHashVersion: 2 }), false);
assert.equal(isSfpReceiptProjectionRepairCandidate(
  { ...prior, source_kind: "paid", paid_id: "paid-a" },
  { ...candidate, sourceKind: "paid", evidenceId: "paid-a" },
), true);
assert.equal(isSfpReceiptProjectionRepairCandidate(
  { ...prior, source_kind: "contact", contact_id: "42" },
  { ...candidate, sourceKind: "contact", evidenceId: "contact:42" },
), true);

const source = fs.readFileSync(new URL("../services/cro03/sfp-validation.ts", import.meta.url), "utf8");
assert.match(source, /po\.subject_type='business' AND po\.subject_id=e\.business_id/);
assert.match(source, /po\.operation_id=COALESCE\(e\.validation_operation_id,e\.reused_from_operation_id\)/);
assert.match(source, /op\.state='completed'/);
assert.match(source, /po\.outcome='valid' AND po\.retryable=FALSE/);
assert.match(source, /e\.staging_intent_id IS NULL/);
assert.match(source, /candidateWork\.state === "completed" && repairProjection/);
assert.match(source, /const observedAtForEligibility = receiptAfterWait\?\.observedAt/);
console.log("SFP exact-source receipt-projection recovery assertions passed");