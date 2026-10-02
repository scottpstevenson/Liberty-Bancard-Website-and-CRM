import assert from "node:assert/strict";
import express, { type Request } from "express";
import cookieParser from "cookie-parser";
import { csrfProtection } from "../middleware/csrf";
import { registerSfpReadyHeldOperatorRoutes } from "../routes/sfp-ready-held-operator";
import { registerSfpStagedProjectionReconciliationRoutes } from "../routes/sfp-staged-projection-reconciliation";

const app = express();
const calls: Array<{ action: string; value?: unknown; actorId?: string }> = [];
let runtimeSelectionIsReady = false;
app.use(cookieParser());
app.use(express.json());
app.use((req: Request & { user?: unknown; isAuthenticated?: () => boolean }, _res, next) => {
  const role = req.header("x-test-role");
  const id = req.header("x-test-user");
  req.user = role ? { role, ...(id ? { id } : {}) } : undefined;
  req.isAuthenticated = () => Boolean(role);
  next();
});
app.use(csrfProtection);
registerSfpReadyHeldOperatorRoutes(app, {
  verifyPackages: async () => {
    calls.push({ action: "verify-packages" });
    return { ok: true, issues: [] };
  },
  setSchedule: async (input) => {
    calls.push({ action: "schedule", value: input });
    return { id: "program-1", ...input };
  },
  processBatch: async (input) => {
    calls.push({ action: "process", value: input, actorId: input.actorId });
    return {
      enabled: false, discovered: 0, attempted: 0, completed: 0, held: 0,
      retrying: 0, deadLettered: 0, persistenceFailures: 0, stopReason: "global_outbound_not_paused",
    };
  },
  retryItem: async (id) => {
    calls.push({ action: "retry-item", value: id });
    return { id, stagingIntentId: "00000000-0000-4000-8000-000000000301" };
  },
  getRuntimeReleaseSelectionStatus: async () => ({
    selectedRelease: runtimeSelectionIsReady ? {
      artifactSha: "a".repeat(40), deploymentIdentity: "deployment-current",
      environmentIdentity: "production", queueTopologyHash: "b".repeat(64),
      selectedBy: "admin-8", selectedAt: "2026-01-01T00:00:00.000Z",
      selectionVersion: 1, selectionEventId: "selection-event-1",
      publisherVerifiedArtifactSha: "a".repeat(40),
      publisherVerifiedDeploymentIdentity: "deployment-current",
      verificationReference: "https://deployments.example.test/release/current",
    } : null,
    currentRelease: {
      artifactSha: "a".repeat(40), deploymentIdentity: "deployment-current",
      environmentIdentity: "production", queueTopologyHash: "b".repeat(64),
    },
    currentReleaseSelected: runtimeSelectionIsReady,
    ownerLeaseExpiresAt: runtimeSelectionIsReady ? "2026-01-01T00:02:00.000Z" : null,
    ownerLive: runtimeSelectionIsReady,
    ready: runtimeSelectionIsReady,
    reason: runtimeSelectionIsReady ? null : "current_release_not_selected",
  }),
  selectCurrentRuntimeRelease: async (input) => {
    calls.push({ action: "select-runtime", value: input, actorId: input.actorId });
    if (input.expectedPreviousSelectionVersion !== null) {
      throw new Error("SFP_RUNTIME_RELEASE_SELECTION_PREVIOUS_RELEASE_MISMATCH");
    }
    runtimeSelectionIsReady = true;
    return {
      eventId: "selection-event-1",
      action: "bootstrap",
      selectedRelease: { artifactSha: input.publisherVerifiedArtifactSha },
    };
  },
  audit: async (input) => {
    calls.push({ action: "audit", value: input, actorId: input.userId });
  },
});
registerSfpStagedProjectionReconciliationRoutes(app);

const server = app.listen(0);
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
assert.ok(address && typeof address === "object");
const baseUrl = `http://127.0.0.1:${address.port}`;

async function request(path: string, options: {
  method?: string;
  role?: string;
  userId?: string;
  cookie?: string;
  csrf?: string;
  body?: unknown;
} = {}) {
  const headers = new Headers();
  if (options.role) headers.set("x-test-role", options.role);
  if (options.userId) headers.set("x-test-user", options.userId);
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.csrf) headers.set("x-csrf-token", options.csrf);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

const token = "sfp-route-csrf";
const cookie = `csrf_token=${token}`;
const schedulePath = "/api/lead-ops/sfp/program/campaign-staging-schedule";
const runPath = "/api/lead-ops/sfp/ready-held-consumer/run";
const retryId = "00000000-0000-4000-8000-000000000302";
const runtimeStatusPath = "/api/lead-ops/sfp/runtime-release-selection";
const runtimeSelectPath = "/api/lead-ops/sfp/runtime-release-selection/select";
const reconcilePreviewPath = "/api/lead-ops/sfp/staged-projection-reconciliation/preview";
const reconcileExecutePath = "/api/lead-ops/sfp/staged-projection-reconciliation/execute";

try {
  const reconcileUnauthorized = await request(reconcilePreviewPath);
  assert.equal(reconcileUnauthorized.status, 401);
  const reconcileManager = await request(reconcilePreviewPath, { role: "manager", userId: "manager-1" });
  assert.equal(reconcileManager.status, 403, "reconciliation preview remains admin-only");
  const reconcileNoCsrf = await request(reconcileExecutePath, {
    method: "POST", role: "admin", userId: "admin-8",
    body: { ids: ["00000000-0000-4000-8000-000000000301"], expectedSnapshotHashes: { "00000000-0000-4000-8000-000000000301": "a".repeat(32) } },
  });
  assert.equal(reconcileNoCsrf.status, 403, "the global CSRF middleware protects reconciliation execution");
  const reconcileInvalidSelection = await request(`${reconcilePreviewPath}?id=not-a-uuid`, {
    role: "admin", userId: "admin-8",
  });
  assert.equal(reconcileInvalidSelection.status, 400, "preview requires explicit strict UUID intent selectors");

  const unauthorized = await request(schedulePath, { method: "POST", body: { recurringEnabled: true, batchSize: 5 } });
  assert.equal(unauthorized.status, 401);
  const manager = await request(schedulePath, {
    method: "POST", role: "manager", userId: "manager-1", cookie, csrf: token,
    body: { recurringEnabled: true, batchSize: 5 },
  });
  assert.equal(manager.status, 403, "the real role middleware keeps schedule controls admin-only");

  const noCsrf = await request(schedulePath, {
    method: "POST", role: "admin", userId: "admin-8",
    body: { recurringEnabled: true, batchSize: 5 },
  });
  assert.equal(noCsrf.status, 403, "the real CSRF middleware blocks an admin mutation without a token");
  const missingIdentity = await request(schedulePath, {
    method: "POST", role: "admin", cookie, csrf: token,
    body: { recurringEnabled: true, batchSize: 5 },
  });
  assert.equal(missingIdentity.status, 401);
  assert.equal(calls.some((call) => call.action === "schedule"), false);

  const schedule = await request(schedulePath, {
    method: "POST", role: "admin", userId: "admin-8", cookie, csrf: token,
    body: { recurringEnabled: true, batchSize: 5 },
  });
  assert.equal(schedule.status, 200);
  assert.deepEqual(calls.find((call) => call.action === "schedule")?.value, {
    recurringEnabled: true, batchSize: 5, actorId: "admin:admin-8",
  });
  assert.equal(calls.some((call) => call.action === "verify-packages"), true, "enabling recurrence verifies the current draft/paused campaign packages");

  const runtimeStatusNonAdmin = await request(runtimeStatusPath, { role: "manager", userId: "manager-1" });
  assert.equal(runtimeStatusNonAdmin.status, 403, "runtime-release readiness/status is admin-only");
  const runtimeStatus = await request(runtimeStatusPath, { role: "admin", userId: "admin-8" });
  assert.equal(runtimeStatus.status, 200);
  const runtimeStatusBody = await runtimeStatus.json() as any;
  assert.equal(runtimeStatusBody.ready, false);
  assert.equal(runtimeStatusBody.reason, "current_release_not_selected", "unselected queue owner is returned as a held status, not a claim");
  const selectionInput = {
    expectedPreviousSelectionVersion: null,
    expectedPreviousArtifactSha: null,
    publisherVerifiedArtifactSha: "a".repeat(40),
    publisherVerifiedDeploymentIdentity: "deployment-current",
    verificationReference: "https://deployments.example.test/release/current",
  };
  const selectionNoCsrf = await request(runtimeSelectPath, {
    method: "POST", role: "admin", userId: "admin-8", body: selectionInput,
  });
  assert.equal(selectionNoCsrf.status, 403, "runtime selection remains protected by real CSRF middleware");
  const selectionManager = await request(runtimeSelectPath, {
    method: "POST", role: "manager", userId: "manager-1", cookie, csrf: token, body: selectionInput,
  });
  assert.equal(selectionManager.status, 403, "release bootstrap/transfer is admin-only");
  const impersonatedSelection = await request(runtimeSelectPath, {
    method: "POST", role: "admin", userId: "admin-8", cookie, csrf: token,
    body: { ...selectionInput, actorId: "forged-actor" },
  });
  assert.equal(impersonatedSelection.status, 400, "request cannot supply or impersonate audit actor");
  const selection = await request(runtimeSelectPath, {
    method: "POST", role: "admin", userId: "admin-8", cookie, csrf: token, body: selectionInput,
  });
  assert.equal(selection.status, 200);
  const selectionBody = await selection.json() as any;
  assert.equal(selectionBody.selection.eventId, "selection-event-1");
  assert.equal(selectionBody.status.ready, true);
  assert.deepEqual(calls.find((call) => call.action === "select-runtime")?.value, {
    ...selectionInput, actorId: "admin-8",
  }, "CAS fields and evidence pass through while actor identity comes exclusively from req.user");
  const staleSelection = await request(runtimeSelectPath, {
    method: "POST", role: "admin", userId: "admin-8", cookie, csrf: token,
    body: { ...selectionInput, expectedPreviousSelectionVersion: 1, expectedPreviousArtifactSha: "c".repeat(40) },
  });
  assert.equal(staleSelection.status, 409, "stale selection version/SHA fails compare-and-set");

  const oversized = await request(runPath, {
    method: "POST", role: "admin", userId: "admin-8", cookie, csrf: token, body: { limit: 26 },
  });
  assert.equal(oversized.status, 400, "batch bounds are validated before execution");
  const runWithoutCsrf = await request(runPath, {
    method: "POST", role: "admin", userId: "admin-8", body: { limit: 25 },
  });
  assert.equal(runWithoutCsrf.status, 403);
  const run = await request(runPath, {
    method: "POST", role: "admin", userId: "admin-8", cookie, csrf: token, body: { limit: 25 },
  });
  assert.equal(run.status, 200);
  assert.equal((await run.json() as any).stopReason, "global_outbound_not_paused");
  assert.deepEqual(calls.find((call) => call.action === "process")?.value, { limit: 25, actorId: "admin:admin-8" });
  assert.equal(calls.find((call) => call.action === "audit")?.actorId, "admin-8", "operator batch request is independently attributed to its authenticated admin");

  const malformedRetry = await request("/api/lead-ops/sfp/ready-held-consumer/items/not-a-uuid/retry", {
    method: "POST", role: "admin", userId: "admin-8", cookie, csrf: token, body: {},
  });
  assert.equal(malformedRetry.status, 400);
  const retry = await request(`/api/lead-ops/sfp/ready-held-consumer/items/${retryId}/retry`, {
    method: "POST", role: "admin", userId: "admin-8", cookie, csrf: token, body: {},
  });
  assert.equal(retry.status, 200);
  assert.equal((await retry.json() as any).state, "pending");
  assert.equal(calls.find((call) => call.action === "retry-item")?.value, retryId);
  assert.equal(calls.filter((call) => call.action === "audit").length, 2, "both batch execution and manual retry are audited");
  console.log("SFP ready-held route/role/CSRF tests passed");
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}