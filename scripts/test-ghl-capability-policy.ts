import assert from "node:assert/strict";
import { classifyGhlOperation } from "../server/services/ghl-capability-policy";
import {
  evaluateGhlCapabilityPolicy,
  hashGhlCustomFieldInventory,
  hashNativeWorkflowInventory,
  isGhlCrmDecisionCurrent,
  isGhlRuntimeWriteSelected,
  type GhlSyncControl,
  type NativeWorkflowEvidence,
} from "../server/services/ghl-sync-control";

const now = Date.now();
const workflows: NativeWorkflowEvidence[] = [{
  locationId: "loc-1", id: "workflow-1", status: "published",
  updatedAt: "2025-01-01T00:00:00.000Z", version: "4",
}];
const revision = hashNativeWorkflowInventory(workflows);
const control: GhlSyncControl = {
  enabled: true,
  permissionsEnabled: true,
  epoch: 8,
  ownerProfile: null,
  selectedRuntime: "test",
  nativeReview: {
    state: "approved",
    reviewedAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
    evidenceReference: "admin-review-ticket-42",
    locationId: "loc-1",
    inventoryRevision: revision,
    workflows,
    workflowActionEvidence: [{
      workflowId: "workflow-1", disposition: "reviewed_safe", evidenceReference: "workflow-inspection-42",
      observedUpdatedAt: workflows[0].updatedAt, observedVersion: workflows[0].version,
      definitionHash: "a".repeat(64), changeMetadata: "reviewed workflow CHANGE metadata ticket 42",
    }],
    allowedOperations: [{
      method: "POST",
      path: "/contacts",
      fields: ["firstName", "lastName", "email"],
      tags: ["reviewed-tag"],
      stageIds: [],
      safetyEvidence: "contact-create-inspection-42",
      purpose: "Create contact identity fields only",
      customFieldIds: [],
    }],
    customFields: [],
    customFieldInventoryRevision: hashGhlCustomFieldInventory([]),
  },
};

assert.equal(classifyGhlOperation("GET", "/contacts"), "crm_read");
assert.equal(classifyGhlOperation("POST", "/contacts/search", { query: "x" }), "crm_read");
assert.equal(classifyGhlOperation("POST", "/contacts/trigger/search", {}), "unknown");
assert.equal(classifyGhlOperation("POST", "/opportunities/search", { query: "x" }), "crm_read");
assert.equal(classifyGhlOperation("POST", "/contacts/c-1/search", { query: "x" }), "unknown");
assert.equal(classifyGhlOperation("GET", "/locations/loc-1/email-settings"), "diagnostic_read");
assert.equal(classifyGhlOperation("GET", "/locations/loc-1"), "diagnostic_read");
assert.equal(classifyGhlOperation("GET", "/workflows/?locationId=loc-1"), "diagnostic_read");
assert.equal(classifyGhlOperation("PATCH", "/contacts/c-1", { lb_sms_allowed: true }), "permission_write");
assert.equal(classifyGhlOperation("PUT", "/contacts/c-1", {
  customFields: [{ id: "cf-1", key: "lb_can_sms", field_value: "true" }],
}), "permission_write");
assert.equal(classifyGhlOperation("PUT", "/contacts/c-1", { firstName: "A", lb_sms_allowed: true }), "crm_write");
assert.equal(classifyGhlOperation("PUT", "/contacts/c-1", {
  firstName: "A", customFields: [{ id: "cf-1", key: "lb_can_sms", field_value: "true" }],
}), "crm_write");
assert.equal(classifyGhlOperation("POST", "/conversations/messages", { message: "hi" }), "communication");
assert.equal(classifyGhlOperation("PATCH", "/unknown/provider-resource", {}), "unknown");
assert.equal(evaluateGhlCapabilityPolicy(
  { method: "GET", path: "/contacts", locationId: "loc-1" },
  { ...control, enabled: false, permissionsEnabled: false }, undefined, now,
).allowed, true);
assert.equal(evaluateGhlCapabilityPolicy(
  { method: "POST", path: "/contacts/search", body: { query: "x" }, locationId: "loc-1" },
  { ...control, enabled: false, permissionsEnabled: false }, undefined, now,
).allowed, true);

const contactCreate = { method: "POST", path: "/contacts", locationId: "loc-1", body: { firstName: "A", email: "a@example.test" } };
assert.equal(evaluateGhlCapabilityPolicy(contactCreate, control, revision, now).allowed, true);
assert.equal(evaluateGhlCapabilityPolicy(contactCreate, { ...control, enabled: false }, revision, now).reasonCode, "control_disabled");
assert.equal(evaluateGhlCapabilityPolicy({
  ...contactCreate,
  body: { firstName: "A", lb_sms_allowed: true },
}, { ...control, enabled: false, permissionsEnabled: true }, revision, now).reasonCode, "control_disabled");
assert.equal(evaluateGhlCapabilityPolicy({
  ...contactCreate,
  body: { firstName: "A", lb_sms_allowed: true },
}, { ...control, enabled: true, permissionsEnabled: false }, revision, now).reasonCode, "permissions_disabled");
assert.equal(evaluateGhlCapabilityPolicy(contactCreate, {
  ...control, nativeReview: { ...control.nativeReview, state: "unverified" },
}, revision, now).reasonCode, "native_review_unverified");
assert.equal(evaluateGhlCapabilityPolicy(contactCreate, {
  ...control, nativeReview: { ...control.nativeReview, expiresAt: new Date(now - 1).toISOString() },
}, revision, now).reasonCode, "native_review_unverified");
assert.equal(evaluateGhlCapabilityPolicy(contactCreate, control, "changed-revision", now).reasonCode, "native_inventory_unverified");
assert.equal(evaluateGhlCapabilityPolicy({
  ...contactCreate, body: { firstName: "A", locationId: "loc-other" },
}, control, revision, now).reasonCode, "operation_not_reviewed");
assert.equal(evaluateGhlCapabilityPolicy({
  method: "PUT", path: "/contacts/c-1", locationId: "loc-1",
  body: { customFields: [{ id: "unverified-custom-field", key: "lb_can_sms", field_value: "true" }] },
}, {
  ...control,
  nativeReview: {
    ...control.nativeReview,
    allowedOperations: [{
      method: "PUT", path: "/contacts/:contactId", fields: ["customFields"],
      tags: [], stageIds: [], safetyEvidence: "permission-change-evidence-42",
      purpose: "Project reviewed permission fields",
      customFieldIds: ["unverified-custom-field"],
    }],
  },
}, revision, now).reasonCode, "operation_not_reviewed");
assert.equal(evaluateGhlCapabilityPolicy({
  ...contactCreate, body: { firstName: "A", email: "a@example.test", unreviewedField: "bad" },
}, control, revision, now).reasonCode, "operation_not_reviewed");
assert.equal(evaluateGhlCapabilityPolicy({
  method: "POST", path: "/contacts/c-1/workflow/w-1", body: {}, locationId: "loc-1",
}, control, revision, now).reasonCode, "outbound_authority_required");
assert.equal(evaluateGhlCapabilityPolicy({
  method: "POST", path: "/conversations/messages", body: { message: "test" }, locationId: "loc-1",
}, control, revision, now).reasonCode, "outbound_authority_required");
assert.equal(evaluateGhlCapabilityPolicy({
  method: "POST", path: "/contacts/c-1/enrollments", body: {}, locationId: "loc-1",
}, control, revision, now).reasonCode, "outbound_authority_required");
assert.equal(evaluateGhlCapabilityPolicy({
  method: "POST", path: "/contacts/c-1/automation/trigger", body: { firstName: "A" }, locationId: "loc-1",
}, control, revision, now).reasonCode, "outbound_authority_required");
assert.equal(evaluateGhlCapabilityPolicy({
  method: "POST", path: "/contacts/trigger/search", body: {}, locationId: "loc-1",
}, control, revision, now).allowed, false);

const decision = evaluateGhlCapabilityPolicy(contactCreate, control, revision, now);
assert.equal(isGhlCrmDecisionCurrent(decision, control, revision, now), true);
assert.equal(isGhlCrmDecisionCurrent(decision, { ...control, epoch: control.epoch + 1 }, revision, now), false);
assert.equal(evaluateGhlCapabilityPolicy(
  { method: "PATCH", path: "/contacts/c-1", body: { lb_sms_allowed: true }, locationId: "loc-1" },
  { ...control, permissionsEnabled: false }, revision, now,
).reasonCode, "permissions_disabled");

assert.equal(isGhlRuntimeWriteSelected({ ...control, ownerProfile: "ghl-sync-only", selectedRuntime: "build-a" }, "build-a"), true);
assert.equal(isGhlRuntimeWriteSelected({ ...control, ownerProfile: "ghl-sync-only", selectedRuntime: "build-a" }, "build-b"), false);
assert.equal(isGhlRuntimeWriteSelected({ ...control, ownerProfile: "ghl-sync-only", selectedRuntime: "build-a" }, null), false);
assert.equal(isGhlRuntimeWriteSelected({ ...control, ownerProfile: null, selectedRuntime: "build-a" }, "build-a"), false);
assert.equal(classifyGhlOperation("GET", "/locations/loc-1/customFields/automation/trigger"), "unknown");
assert.equal(classifyGhlOperation("GET", "/locations/loc-1/tags"), "diagnostic_read");
assert.equal(classifyGhlOperation("GET", "/calendars/cal-1/free-slots"), "crm_read");
console.log("GHL capability/control policy safety assertions passed.");