import assert from "node:assert/strict";
import {
  getApiErrorMessage,
  isGhlCommandActive,
  valueOrUnknown,
  type GhlCommandStatus,
} from "../client/src/lib/ghlTruth";
import { isSha256, parseGhlReviewOperations } from "../client/src/lib/ghlNativeReview";

function command(state: string, complete: boolean): GhlCommandStatus {
  return {
    runId: "run-1",
    state,
    pollingUrl: "/api/admin/commands/run-1",
    stepUrl: "/api/admin/commands/run-1/step",
    processed: null,
    matched: null,
    notFound: null,
    skipped: null,
    errors: null,
    cursor: null,
    watermark: null,
    heartbeatAt: null,
    lastError: null,
    complete,
  };
}

assert.equal(
  getApiErrorMessage(new Error('503: {"code":"RECONCILIATION_COMMAND_REQUIRED","message":"Durable command unavailable."}'), "fallback"),
  "Durable command unavailable.",
);
assert.equal(
  getApiErrorMessage(new Error('409: {"error":"epoch_conflict","reason":"Refresh and retry."}'), "fallback"),
  "Refresh and retry.",
);
assert.equal(getApiErrorMessage(new Error("403: access denied"), "fallback"), "access denied");
assert.equal(isGhlCommandActive(command("queued", false)), true);
assert.equal(isGhlCommandActive(command("running", false)), true);
assert.equal(isGhlCommandActive(command("succeeded", true)), false);
assert.equal(isGhlCommandActive(command("failed", true)), false);
assert.equal(valueOrUnknown(null), "Unknown");
assert.equal(valueOrUnknown(undefined), "Unknown");
assert.equal(valueOrUnknown(0), "0");

const currentCustomFieldIds = new Set(["cf-1"]);
const reviewOperation = {
  method: "PATCH",
  path: "/contacts/:contactId",
  fields: ["firstName"],
  tags: [],
  stageIds: [],
  safetyEvidence: "Inspected this CRM field update path",
  purpose: "Keep the contact name aligned with the local record",
  customFieldIds: [],
};
assert.equal(
  parseGhlReviewOperations(JSON.stringify([reviewOperation]), currentCustomFieldIds).operations?.length,
  1,
);
assert.match(
  parseGhlReviewOperations(JSON.stringify([{ ...reviewOperation, path: "/contacts/*" }]), currentCustomFieldIds).error ?? "",
  /supported explicit CRM endpoint/,
);
assert.match(
  parseGhlReviewOperations(JSON.stringify([{ ...reviewOperation, fields: ["*"] }]), currentCustomFieldIds).error ?? "",
  /wildcards/,
);
assert.match(
  parseGhlReviewOperations(JSON.stringify([{ ...reviewOperation, customFieldIds: ["not-in-inventory"], fields: ["customFields"] }]), currentCustomFieldIds).error ?? "",
  /not in the current server inventory/,
);
assert.equal(isSha256("a".repeat(64)), true);
assert.equal(isSha256("not-a-hash"), false);

console.log("GHL truthful UI utility tests passed");