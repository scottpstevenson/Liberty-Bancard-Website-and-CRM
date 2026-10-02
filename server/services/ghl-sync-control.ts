import crypto from "crypto";
import { pool } from "../db";
import {
  classifyGhlOperation,
  ghlBodyContainsPermissionWrite,
  isKnownPermissionCustomFieldKey,
  isRegisteredGhlWriteTemplate,
  resolveGhlWriteTemplate,
  type GhlCapability,
} from "./ghl-capability-policy";
import { resolveRoutineSfpDeploymentIdentity } from "../../shared/sfp-publish-build-identity";

const SETTING_KEY = "ghlSyncControl";
const REVIEW_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface NativeWorkflowEvidence {
  locationId: string;
  id: string;
  status: string;
  updatedAt: string;
  version: string;
}
export interface NativeCustomFieldEvidence {
  id: string;
  key: string;
}

export interface NativeReview {
  state: "unverified" | "approved";
  reviewedAt: string | null;
  expiresAt: string | null;
  evidenceReference: string | null;
  locationId?: string;
  allowedOperations: Array<{
    method: string;
    path: string;
    fields: string[];
    tags: string[];
    stageIds: string[];
    safetyEvidence: string;
    purpose: string;
    customFieldIds: string[];
  }>;
  reviewerId?: string;
  inventoryRevision?: string;
  workflows?: NativeWorkflowEvidence[];
  workflowActionEvidence?: Array<{
    workflowId: string;
    disposition: "reviewed_safe" | "no_native_triggers";
    evidenceReference: string;
    observedUpdatedAt: string;
    observedVersion: string;
    definitionHash: string;
    changeMetadata: string;
  }>;
  customFields?: NativeCustomFieldEvidence[];
  customFieldInventoryRevision?: string;
}

export interface GhlSyncControl {
  enabled: boolean;
  permissionsEnabled: boolean;
  epoch: number;
  ownerProfile: string | null;
  selectedRuntime: string | null;
  transitioning?: boolean;
  nativeReview: NativeReview;
}

export interface GhlCrmDecision {
  allowed: boolean;
  capability: GhlCapability;
  epoch: number;
  reasonCode: string;
  reason?: string;
  method: string;
  path: string;
  body?: unknown;
  locationId: string | null;
  reviewRevision?: string;
}

export function getCurrentGhlRuntimeIdentity(): string | null {
  return resolveRoutineSfpDeploymentIdentity({
    releaseSha: process.env.RELEASE_SHA,
    publishArtifactSha: process.env.SFP_PUBLISH_ARTIFACT_SHA,
    publishBuildId: process.env.SFP_PUBLISH_BUILD_ID,
    platformDeploymentId: process.env.REPL_DEPLOYMENT_ID,
  });
}

export function isGhlRuntimeWriteSelected(control: GhlSyncControl, runtimeIdentity: string | null): boolean {
  return !!runtimeIdentity && control.ownerProfile === "ghl-sync-only"
    && control.selectedRuntime === runtimeIdentity;
}

function defaultControl(): GhlSyncControl {
  return {
    enabled: false,
    permissionsEnabled: false,
    epoch: 0,
    ownerProfile: null,
    selectedRuntime: null,
    transitioning: false,
    nativeReview: {
      state: "unverified", reviewedAt: null, expiresAt: null, evidenceReference: null,
      allowedOperations: [],
    },
  };
}

function parseControl(value: any): GhlSyncControl {
  const fallback = defaultControl();
  if (!value || typeof value !== "object") return fallback;
  const control: GhlSyncControl = {
    enabled: value.enabled === true,
    permissionsEnabled: value.permissionsEnabled === true,
    epoch: Number.isSafeInteger(Number(value.epoch)) ? Number(value.epoch) : 0,
    ownerProfile: value.ownerProfile === "ghl-sync-only" ? "ghl-sync-only" : null,
    selectedRuntime: typeof value.selectedRuntime === "string" ? value.selectedRuntime : null,
    transitioning: value.transitioning === true,
    nativeReview: value.nativeReview && typeof value.nativeReview === "object"
      ? value.nativeReview as NativeReview : fallback.nativeReview,
  };
  if (!isFreshReview(control.nativeReview)) control.nativeReview.state = "unverified";
  return control;
}

export async function getGhlSyncControl(): Promise<GhlSyncControl> {
  const result = await pool.query<{ value: any }>(
    "SELECT value FROM system_settings WHERE key = $1", [SETTING_KEY],
  );
  if (!result.rows.length) return defaultControl();
  const raw = result.rows[0].value;
  return parseControl(typeof raw === "string" ? JSON.parse(raw) : raw);
}

export function hashNativeWorkflowInventory(workflows: NativeWorkflowEvidence[]): string {
  const canonical = workflows.slice().sort((a, b) => a.id.localeCompare(b.id))
    .map(w => `${w.locationId}\0${w.id}\0${w.status}\0${w.updatedAt}\0${w.version}`).join("\n");
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

export function hashGhlCustomFieldInventory(fields: NativeCustomFieldEvidence[]): string {
  const canonical = fields.slice().sort((a, b) => a.id.localeCompare(b.id))
    .map(field => `${field.id}\0${field.key}`).join("\n");
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

function isFreshReview(review: NativeReview, now = Date.now()): boolean {
  if (review.state !== "approved" || !review.reviewedAt || !review.expiresAt
      || !review.evidenceReference || !review.inventoryRevision || !Array.isArray(review.workflows)
      || !Array.isArray(review.workflowActionEvidence) || !Array.isArray(review.customFields)
      || !Array.isArray(review.allowedOperations) || review.allowedOperations.length === 0
      || !review.customFieldInventoryRevision
      || hashGhlCustomFieldInventory(review.customFields) !== review.customFieldInventoryRevision) return false;
  const expiry = Date.parse(review.expiresAt);
  const reviewed = Date.parse(review.reviewedAt);
  const knownWorkflowStatuses = new Set(["active", "published", "draft", "inactive", "unpublished", "paused", "disabled", "deleted"]);
  const validInventory = review.workflows.every(workflow =>
    !!workflow.id && !!workflow.locationId && !!workflow.status && knownWorkflowStatuses.has(workflow.status)
    && !!workflow.updatedAt && !!workflow.version);
  const validOperations = review.allowedOperations.every(operation =>
    isRegisteredGhlWriteTemplate(operation.method, operation.path)
    && !!operation.purpose?.trim() && !!operation.safetyEvidence?.trim()
    && Array.isArray(operation.fields) && operation.fields.length > 0
    && Array.isArray(operation.tags) && Array.isArray(operation.stageIds)
    && Array.isArray(operation.customFieldIds));
  const covered = validInventory && validOperations
    && review.workflowActionEvidence.length === review.workflows.length
    && new Set(review.workflowActionEvidence.map(item => item.workflowId)).size === review.workflowActionEvidence.length
    && review.workflows.every(workflow =>
      review.workflowActionEvidence!.some(item => item.workflowId === workflow.id
        && !!item.evidenceReference?.trim() && !!item.changeMetadata?.trim()
        && /^[a-f0-9]{64}$/i.test(item.definitionHash)
        && item.observedUpdatedAt === workflow.updatedAt
        && item.observedVersion === workflow.version));
  return covered && Number.isFinite(expiry) && Number.isFinite(reviewed) && expiry > now
    && now - reviewed <= REVIEW_MAX_AGE_MS
    && hashNativeWorkflowInventory(review.workflows) === review.inventoryRevision;
}

export function isGhlCrmDecisionCurrent(
  decision: GhlCrmDecision,
  control: GhlSyncControl,
  liveInventoryRevision?: string,
  now = Date.now(),
  fieldMap: Array<{ id: string; key: string }> = [],
): boolean {
  if (!decision.allowed || control.epoch !== decision.epoch) return false;
  if (decision.capability === "communication" || decision.capability === "unknown"
      || decision.capability === "crm_read" || decision.capability === "diagnostic_read") return true;
  if (control.transitioning) return false;
  if (ghlBodyContainsPermissionWrite(decision.body) && !control.permissionsEnabled) return false;
  if (decision.capability === "permission_write" && !control.permissionsEnabled) return false;
  if (decision.capability === "crm_write" && !control.enabled) return false;
  if (!isFreshReview(control.nativeReview, now)
      || control.nativeReview.inventoryRevision !== decision.reviewRevision
      || control.nativeReview.locationId !== (decision.locationId || process.env.GHL_LOCATION_ID || null)
      || !liveInventoryRevision || liveInventoryRevision !== decision.reviewRevision
      || hashGhlCustomFieldInventory(fieldMap) !== control.nativeReview.customFieldInventoryRevision) return false;
  const operation = control.nativeReview.allowedOperations.find(candidate =>
    candidate.method.toUpperCase() === decision.method
    && resolveGhlWriteTemplate(decision.method, decision.path) === candidate.path);
  return !!operation && payloadCovered(decision.body, operation, control.nativeReview.locationId ?? null, fieldMap);
}

function normalizePath(path: string): string {
  return path.split("?")[0].replace(/\/+$/, "") || "/";
}

function payloadCovered(
  body: unknown,
  allowed: NativeReview["allowedOperations"][number],
  locationId: string | null,
  fieldMap: Array<{ id: string; key: string }> = [],
): boolean {
  const obj = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, any> : {};
  const forbidden = new Set(["workflowId", "workflowIds", "automationId", "triggerId"]);
  if (obj.locationId !== undefined && String(obj.locationId) !== locationId) return false;
  if (Object.keys(obj).some(key => forbidden.has(key))) return false;
  const actualFields = Object.keys(obj).filter(key => !["contactId", "id", "locationId"].includes(key)).sort();
  if (actualFields.some(key => !allowed.fields.includes(key))) return false;
  for (const [key, value] of Object.entries(obj)) {
    if (["customFields", "tags", "stageIds"].includes(key)) continue;
    if (value !== null && typeof value === "object") return false;
  }
  if (obj.customFields !== undefined) {
    if (!Array.isArray(obj.customFields)) return false;
    for (const field of obj.customFields) {
      if (!field || typeof field !== "object" || Array.isArray(field)) return false;
      if (Object.keys(field).some(key => !["id", "key", "field_value", "value"].includes(key))) return false;
      if (typeof field.id !== "string" || !allowed.customFieldIds.includes(field.id)) return false;
      const verifiedField = fieldMap.find(candidate => candidate.id === field.id);
      if (!verifiedField || (field.key !== undefined && field.key !== verifiedField.key)) return false;
      if (classifyGhlOperation("PUT", "/contacts/permission-policy-check", body) === "permission_write"
          && !isKnownPermissionCustomFieldKey(verifiedField.key)) return false;
      const fieldValue = field.field_value ?? field.value;
      if (fieldValue !== null && typeof fieldValue === "object") return false;
    }
  }
  if (obj.tags !== undefined && (!Array.isArray(obj.tags)
      || obj.tags.some((tag: unknown) => typeof tag !== "string" || !allowed.tags.includes(tag)))) return false;
  if (obj.stageIds !== undefined && (!Array.isArray(obj.stageIds)
      || obj.stageIds.some((stage: unknown) => typeof stage !== "string" || !allowed.stageIds.includes(stage)))) return false;
  if (obj.pipelineStageId !== undefined && (typeof obj.pipelineStageId !== "string" || !allowed.stageIds.includes(obj.pipelineStageId))) return false;
  if (obj.stageId !== undefined && (typeof obj.stageId !== "string" || !allowed.stageIds.includes(obj.stageId))) return false;
  return actualFields.length > 0;
}

async function getVerifiedCustomFieldMap(locationId: string | null | undefined): Promise<Array<{ id: string; key: string }>> {
  const { getGhlCustomFieldInventory } = await import("./ghl");
  return getGhlCustomFieldInventory(locationId);
}

function deny(capability: GhlCapability, control: GhlSyncControl, code: string, reason: string, args: any): GhlCrmDecision {
  return {
    allowed: false, capability, epoch: control.epoch, reasonCode: code, reason,
    method: args.method.toUpperCase(), path: normalizePath(args.path), body: args.body,
    locationId: args.locationId ?? null,
  };
}

/** Pure policy evaluator used by transport authorization and fail-closed tests. */
export function evaluateGhlCapabilityPolicy(args: {
  method: string; path: string; body?: unknown; locationId?: string;
}, control: GhlSyncControl, liveInventoryRevision?: string, now = Date.now(),
fieldMap: Array<{ id: string; key: string }> = []): GhlCrmDecision {
  const capability = classifyGhlOperation(args.method, args.path, args.body);
  const common = {
    allowed: true, capability, epoch: control.epoch, reasonCode: "allowed",
    method: args.method.toUpperCase(), path: normalizePath(args.path), body: args.body,
    locationId: args.locationId ?? null,
  } satisfies GhlCrmDecision;
  if (capability === "unknown" || capability === "communication") {
    return deny(capability, control, "outbound_authority_required", "Operation must use the existing outbound authorization protocol", args);
  }
  if (capability === "crm_read" || capability === "diagnostic_read") return common;
  if (control.transitioning) {
    return deny(capability, control, "control_transitioning", "GHL CRM control is changing; retry after it settles", args);
  }
  if (ghlBodyContainsPermissionWrite(args.body) && !control.permissionsEnabled) {
    return deny(capability, control, "permissions_disabled", "GHL permission projection is disabled", args);
  }
  if (capability === "permission_write" && !control.permissionsEnabled) {
    return deny(capability, control, "permissions_disabled", "GHL permission projection is disabled", args);
  }
  if (capability === "crm_write" && !control.enabled) {
    return deny(capability, control, "control_disabled", "GHL CRM writes are disabled", args);
  }
  const review = control.nativeReview;
  if (!isFreshReview(review, now)) {
    return deny(capability, control, "native_review_unverified", "Current, fresh native-trigger safety review is required", args);
  }
  if (review.locationId !== (args.locationId || process.env.GHL_LOCATION_ID || null)) {
    return deny(capability, control, "native_review_location_mismatch", "Native-trigger review is not pinned to this GHL location", args);
  }
  if (!liveInventoryRevision || liveInventoryRevision !== review.inventoryRevision) {
    return deny(capability, control, "native_inventory_unverified", "Live native workflow inventory does not match the reviewed revision", args);
  }
  if (hashGhlCustomFieldInventory(fieldMap) !== review.customFieldInventoryRevision) {
    return deny(capability, control, "custom_field_inventory_unverified", "Live provider custom-field map differs from reviewed evidence", args);
  }
  if (/[?#]/.test(args.path)) {
    return deny(capability, control, "operation_not_reviewed", "CRM writes with query or fragment suffixes are not in the exact operation allowlist", args);
  }
  const template = resolveGhlWriteTemplate(args.method, args.path);
  const op = review.allowedOperations.find(candidate =>
    candidate.method.toUpperCase() === args.method.toUpperCase()
    && candidate.path === template
    && isRegisteredGhlWriteTemplate(candidate.method, candidate.path));
  if (!op || !payloadCovered(args.body, op, review.locationId ?? null, fieldMap)) {
    return deny(capability, control, "operation_not_reviewed", "Exact operation and payload are not covered by the native-trigger review", args);
  }
  return { ...common, reviewRevision: review.inventoryRevision };
}

export async function authorizeGhlCrmOperation(args: {
  method: string; path: string; body?: unknown; locationId?: string;
}): Promise<GhlCrmDecision> {
  const capability = classifyGhlOperation(args.method, args.path, args.body);
  const control = await getGhlSyncControl();
  const common = {
    allowed: true, capability, epoch: control.epoch, reasonCode: "allowed",
    method: args.method.toUpperCase(), path: normalizePath(args.path), body: args.body,
    locationId: args.locationId ?? null,
  } satisfies GhlCrmDecision;

  // Do not exempt communication or unknown paths. Obtain the established
  // outbound authorization disposition here; transports still perform their
  // full register/recheck/inflight protocol immediately before I/O.
  if (capability === "communication" || capability === "unknown") {
    const { authorize } = await import("./outbound-pause-authority");
    const outbound = await authorize({});
    return outbound.allowed ? common : {
      ...common, allowed: false, reasonCode: outbound.reasonCode,
      reason: "Existing outbound pause authority denied this GHL operation",
    };
  }
  if (capability === "crm_read" || capability === "diagnostic_read") return common;
  if (!isGhlRuntimeWriteSelected(control, getCurrentGhlRuntimeIdentity())) {
    return deny(capability, control, "runtime_not_selected", "This published runtime is not selected for GHL CRM writes", args);
  }
  const review = control.nativeReview;
  if (!isFreshReview(review)) {
    return deny(capability, control, "native_review_unverified", "Current, fresh native-trigger safety review is required", args);
  }
  let liveInventory: NativeWorkflowEvidence[];
  try {
    const { getGhlNativeWorkflowInventory } = await import("./ghl");
    liveInventory = await getGhlNativeWorkflowInventory(args.locationId);
    if (hashNativeWorkflowInventory(liveInventory) !== review.inventoryRevision) {
      return deny(capability, control, "native_inventory_changed", "Live native workflow inventory differs from the reviewed revision", args);
    }
  } catch {
    return deny(capability, control, "native_inventory_unverified", "Live workflow inventory could not be verified", args);
  }
  let fieldMap: Array<{ id: string; key: string }>;
  try {
    fieldMap = await getVerifiedCustomFieldMap(args.locationId);
  } catch {
    return deny(capability, control, "custom_field_inventory_unverified", "GHL custom-field IDs cannot be verified", args);
  }
  return evaluateGhlCapabilityPolicy(args, control, hashNativeWorkflowInventory(liveInventory), Date.now(), fieldMap);
}

export async function recheckGhlCrmOperation(decision: GhlCrmDecision): Promise<boolean> {
  if (!decision.allowed) return false;
  const control = await getGhlSyncControl();
  let liveRevision: string | undefined;
  let fieldMap: Array<{ id: string; key: string }> = [];
  if (decision.capability !== "communication" && decision.capability !== "unknown"
      && decision.capability !== "crm_read" && decision.capability !== "diagnostic_read") {
    if (!isGhlRuntimeWriteSelected(control, getCurrentGhlRuntimeIdentity())) return false;
    try {
      const { getGhlNativeWorkflowInventory } = await import("./ghl");
      liveRevision = hashNativeWorkflowInventory(await getGhlNativeWorkflowInventory(decision.locationId));
      fieldMap = await getVerifiedCustomFieldMap(decision.locationId);
    } catch { return false; }
  }
  return isGhlCrmDecisionCurrent(decision, control, liveRevision, Date.now(), fieldMap);
}

/** CRM projections have their own allow-switch but still join the global pause
 * drain. Unlike outbound sends, they may run while state is paused; never during
 * activation, safe-default, or after the captured global epoch changes. */
export async function captureGhlCrmPauseEpoch(): Promise<bigint> {
  const result = await pool.query<{ state: string; epoch: string }>(
    "SELECT state,epoch::text FROM outbound_pause_control ORDER BY id LIMIT 1",
  );
  const row = result.rows[0];
  if (!row || !["paused", "unpaused"].includes(row.state)) {
    throw new Error("GHL_CRM_GLOBAL_PAUSE_STATE_UNVERIFIED");
  }
  return BigInt(row.epoch);
}

export async function recheckGhlCrmPauseEpoch(epoch: bigint): Promise<boolean> {
  try {
    const result = await pool.query<{ state: string; epoch: string }>(
      "SELECT state,epoch::text FROM outbound_pause_control ORDER BY id LIMIT 1",
    );
    const row = result.rows[0];
    return !!row && ["paused", "unpaused"].includes(row.state) && BigInt(row.epoch) === epoch;
  } catch { return false; }
}

export async function registerGhlCrmInflight(controlEpoch: number): Promise<string> {
  const token = crypto.randomUUID();
  const { registerInflight } = await import("./outbound-control-service");
  await registerInflight(token, -(BigInt(controlEpoch) + 1n));
  return token;
}

export function deregisterGhlCrmInflight(token: string): void {
  import("./outbound-control-service").then(({ deregisterInflight }) => deregisterInflight(token))
    .catch(error => console.warn("[GHL CRM control] Failed to deregister in-flight CRM write", error));
}

/** Every independent CRM adapter must join both CRM and global pause drains. */
export async function withGhlCrmInflight<T>(decision: GhlCrmDecision, io: () => Promise<T>): Promise<T> {
  const epoch = await captureGhlCrmPauseEpoch();
  const token = await registerGhlCrmInflight(decision.epoch);
  try {
    if (!await recheckGhlCrmOperation(decision) || !await recheckGhlCrmPauseEpoch(epoch)) {
      throw new Error("GHL CRM operation blocked: control_or_native_review_changed");
    }
    return await io();
  } finally {
    deregisterGhlCrmInflight(token);
  }
}

async function drainGhlCrmInflight(timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM outbound_inflight_sends WHERE granted_epoch < 0 AND expires_at > NOW()",
    );
    if (Number(result.rows[0]?.count ?? 0) === 0) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("GHL_CRM_INFLIGHT_DRAIN_TIMEOUT");
}

/** Atomic epoch-CAS update. Fields for runtime identity are always derived server-side. */
export async function patchGhlSyncControl(input: {
  expectedEpoch: number;
  enabled?: boolean;
  permissionsEnabled?: boolean;
  ownerProfile?: "ghl-sync-only" | null;
  selectCurrentRuntime?: true;
}, actor: string): Promise<GhlSyncControl> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [73190421]);
    const result = await client.query<{ value: any }>(
      "SELECT value FROM system_settings WHERE key=$1 FOR UPDATE", [SETTING_KEY],
    );
    const raw = result.rows[0]?.value;
    const current = parseControl(typeof raw === "string" ? JSON.parse(raw) : raw);
    if (current.epoch !== input.expectedEpoch) throw new Error("GHL_CONTROL_EPOCH_CONFLICT");
    if (input.selectCurrentRuntime && !getCurrentGhlRuntimeIdentity()) {
      throw new Error("GHL_CURRENT_RUNTIME_IDENTITY_UNVERIFIED");
    }
    const transition: GhlSyncControl = {
      ...current,
      transitioning: true,
      epoch: current.epoch + 1,
    };
    await client.query(
      `INSERT INTO system_settings(key,value,updated_at) VALUES($1,$2::jsonb,NOW())
       ON CONFLICT(key) DO UPDATE SET value=$2::jsonb,updated_at=NOW()`,
      [SETTING_KEY, JSON.stringify(transition)],
    );
    await client.query(
      `INSERT INTO audit_logs(action,entity_type,entity_key,actor_type,actor_id,details,created_at)
       VALUES('ghl_sync_control_changed','system',$1,'user',$2,$3::jsonb,NOW())`,
      [SETTING_KEY, actor, JSON.stringify({ epoch: transition.epoch, transition: "started" })],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  await drainGhlCrmInflight();
  const finish = await pool.connect();
  try {
    await finish.query("BEGIN");
    await finish.query("SELECT pg_advisory_xact_lock($1)", [73190421]);
    const row = await finish.query<{ value: any }>("SELECT value FROM system_settings WHERE key=$1 FOR UPDATE", [SETTING_KEY]);
    const raw = row.rows[0]?.value;
    const current = parseControl(typeof raw === "string" ? JSON.parse(raw) : raw);
    if (current.epoch !== input.expectedEpoch + 1 || !current.transitioning) {
      throw new Error("GHL_CONTROL_EPOCH_CONFLICT");
    }
    const next: GhlSyncControl = {
      ...current,
      enabled: input.enabled ?? current.enabled,
      permissionsEnabled: input.permissionsEnabled ?? current.permissionsEnabled,
      ownerProfile: input.ownerProfile === undefined ? current.ownerProfile : input.ownerProfile,
      selectedRuntime: input.selectCurrentRuntime ? getCurrentGhlRuntimeIdentity() : current.selectedRuntime,
      transitioning: false,
      epoch: current.epoch + 1,
    };
    await finish.query(
      "UPDATE system_settings SET value=$2::jsonb,updated_at=NOW() WHERE key=$1",
      [SETTING_KEY, JSON.stringify(next)],
    );
    await finish.query(
      `INSERT INTO audit_logs(action,entity_type,entity_key,actor_type,actor_id,details,created_at)
       VALUES('ghl_sync_control_changed','system',$1,'user',$2,$3::jsonb,NOW())`,
      [SETTING_KEY, actor, JSON.stringify({ epoch: next.epoch, enabled: next.enabled, permissionsEnabled: next.permissionsEnabled, ownerProfile: next.ownerProfile, selectedRuntime: next.selectedRuntime, transition: "committed" })],
    );
    await finish.query("COMMIT");
    return next;
  } catch (error) {
    await finish.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    finish.release();
  }
}

export async function recordGhlNativeReview(review: NativeReview, actorId: string, expectedEpoch: number): Promise<GhlSyncControl> {
  const configuredLocation = process.env.GHL_LOCATION_ID || null;
  const providerFields = await getVerifiedCustomFieldMap(configuredLocation);
  const providerFieldRevision = hashGhlCustomFieldInventory(providerFields);
  if (!review.locationId || !configuredLocation || review.locationId !== configuredLocation
      || review.workflows?.some(workflow => workflow.locationId !== review.locationId)
      || new Set(review.workflows?.map(workflow => workflow.id) ?? []).size !== (review.workflows?.length ?? 0)
      || !review.evidenceReference?.trim() || !review.inventoryRevision || !Array.isArray(review.workflows)
      || hashNativeWorkflowInventory(review.workflows) !== review.inventoryRevision) {
    throw new Error("GHL_NATIVE_REVIEW_EVIDENCE_UNVERIFIED");
  }
  if (review.customFieldInventoryRevision !== providerFieldRevision
      || hashGhlCustomFieldInventory(review.customFields ?? []) !== review.customFieldInventoryRevision) {
    throw new Error("GHL_CUSTOM_FIELD_INVENTORY_CHANGED");
  }
  if (!review.allowedOperations.length || review.allowedOperations.some(op =>
    !op.method || !isRegisteredGhlWriteTemplate(op.method, op.path) || !op.fields.length
    || !op.safetyEvidence?.trim() || !op.purpose?.trim()
    || op.customFieldIds.some(id => !providerFields.some(field => field.id === id))
    || (op.customFieldIds.length > 0 && !op.fields.includes("customFields"))
    || op.fields.some(field => !/^[A-Za-z][A-Za-z0-9_]*$/.test(field)))) {
    throw new Error("GHL_NATIVE_REVIEW_ALLOWLIST_INVALID");
  }
  const actionEvidence = review.workflowActionEvidence ?? [];
  const workflowIds = new Set(review.workflows.map(workflow => workflow.id));
  if (actionEvidence.length !== workflowIds.size
      || new Set(actionEvidence.map(item => item.workflowId)).size !== actionEvidence.length
      || actionEvidence.some(item => {
        const workflow = review.workflows?.find(candidate => candidate.id === item.workflowId);
        return !workflow || !item.evidenceReference?.trim() || !item.changeMetadata?.trim()
          || !/^[a-f0-9]{64}$/i.test(item.definitionHash)
          || item.observedUpdatedAt !== workflow.updatedAt || item.observedVersion !== workflow.version;
      })) {
    throw new Error("GHL_NATIVE_WORKFLOW_ACTION_EVIDENCE_INCOMPLETE");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [73190421]);
    const result = await client.query<{ value: any }>("SELECT value FROM system_settings WHERE key=$1 FOR UPDATE", [SETTING_KEY]);
    const raw = result.rows[0]?.value;
    const current = parseControl(typeof raw === "string" ? JSON.parse(raw) : raw);
    if (current.epoch !== expectedEpoch) throw new Error("GHL_CONTROL_EPOCH_CONFLICT");
    const transition = { ...current, transitioning: true, epoch: current.epoch + 1 };
    await client.query(
      `INSERT INTO system_settings(key,value,updated_at) VALUES($1,$2::jsonb,NOW())
       ON CONFLICT(key) DO UPDATE SET value=$2::jsonb,updated_at=NOW()`,
      [SETTING_KEY, JSON.stringify(transition)],
    );
    await client.query(
      `INSERT INTO audit_logs(action,entity_type,entity_key,actor_type,actor_id,details,created_at)
       VALUES('ghl_native_trigger_safety_reviewed','system',$1,'user',$2,$3::jsonb,NOW())`,
      [SETTING_KEY, actorId, JSON.stringify({ epoch: transition.epoch, transition: "started", evidenceReference: review.evidenceReference })],
    );
    await client.query("COMMIT");
    const now = new Date();
    const nativeReview: NativeReview = {
      ...review, state: "approved", reviewedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + REVIEW_MAX_AGE_MS).toISOString(), reviewerId: actorId,
    };
    await drainGhlCrmInflight();
    const finish = await pool.connect();
    try {
      await finish.query("BEGIN");
      await finish.query("SELECT pg_advisory_xact_lock($1)", [73190421]);
      const finishRow = await finish.query<{ value: any }>("SELECT value FROM system_settings WHERE key=$1 FOR UPDATE", [SETTING_KEY]);
      const finishRaw = finishRow.rows[0]?.value;
      const currentAfterDrain = parseControl(typeof finishRaw === "string" ? JSON.parse(finishRaw) : finishRaw);
      if (currentAfterDrain.epoch !== expectedEpoch + 1 || !currentAfterDrain.transitioning) {
        throw new Error("GHL_CONTROL_EPOCH_CONFLICT");
      }
      const next = {
        ...currentAfterDrain, nativeReview, transitioning: false, epoch: currentAfterDrain.epoch + 1,
      };
      await finish.query("UPDATE system_settings SET value=$2::jsonb,updated_at=NOW() WHERE key=$1", [SETTING_KEY, JSON.stringify(next)]);
      await finish.query(
        `INSERT INTO audit_logs(action,entity_type,entity_key,actor_type,actor_id,details,created_at)
         VALUES('ghl_native_trigger_safety_reviewed','system',$1,'user',$2,$3::jsonb,NOW())`,
        [SETTING_KEY, actorId, JSON.stringify({ epoch: next.epoch, evidenceReference: nativeReview.evidenceReference, inventoryRevision: nativeReview.inventoryRevision, allowedOperations: nativeReview.allowedOperations, transition: "committed" })],
      );
      await finish.query("COMMIT");
      return next;
    } catch (error) {
      await finish.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      finish.release();
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}