import assert from "node:assert/strict";
import express, { type Request } from "express";
import cookieParser from "cookie-parser";
import { csrfProtection } from "../middleware/csrf";
import { registerContactLinkCoverageRoutes } from "../routes/contact-link-coverage";

const app = express();
const handlerCalls: Array<{ action: string; actorId?: string }> = [];
const sourceRecoveryAudits: Array<{ action: string; userId: string; details: Record<string, unknown> }> = [];
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

registerContactLinkCoverageRoutes(app, {
  getStatus: async () => ({
    runId: "route-test-run",
    status: "ready",
    total: 8,
    processed: 3,
    counts: {
      STRICT_AUTO_ELIGIBLE: 1,
      ALREADY_VERIFIED: 0,
      RECOVERABLE_IDENTITY: 1,
      NEEDS_BUSINESS_DISCOVERY: 1,
      REVIEW: 0,
      OUT_OF_SCOPE: 0,
      SUPPRESSED: 0,
      UNUSABLE: 0,
    },
  }),
  listCandidates: async (input) => {
    handlerCalls.push({ action: "list" });
    return { candidates: [], nextCursor: null, limit: input.limit ?? 100 };
  },
  start: async (actorId) => {
    handlerCalls.push({ action: "start", actorId });
    return { runId: "route-test-run", status: "ready" };
  },
  step: async (actorId) => {
    handlerCalls.push({ action: "step", actorId });
    return { runId: "route-test-run", status: "running" };
  },
  pause: async (actorId) => {
    handlerCalls.push({ action: "pause", actorId });
    return { runId: "route-test-run", status: "paused" };
  },
  resume: async (actorId) => {
    handlerCalls.push({ action: "resume", actorId });
    return { runId: "route-test-run", status: "running" };
  },
  reviewBatch: async (_items, reviewerId) => {
    handlerCalls.push({ action: "review", actorId: reviewerId });
    return { outcomes: [{ status: "applied", contactId: 101, businessId: 202 }] };
  },
  previewSourceRecoveryBatch: async (items) => ({
    denominator: items.length,
    results: items.map((identity: any) => ({
      identity,
      status: "READY",
      reasonCodes: [],
      snapshotHash: "c".repeat(64),
      source: { entityName: "Cypress Garden Supply LLC", dba: "Cypress Outdoor" },
      canonicalBusiness: { businessId: 202, canonicalName: "Cypress Garden Supply LLC" },
    })),
  }),
  applySourceRecoveryBatch: async (items) => ({
    denominator: items.length,
    results: items.map((item: any) => ({
        identity: {
          candidateId: item.candidateId, contactId: item.contactId, businessId: item.businessId,
          sourceEntityId: item.sourceEntityId, filingNumber: item.filingNumber,
        },
        status: "MATERIALIZED",
        reasonCodes: ["canonical_sunbiz_source_link_materialized"],
        sourceLinkId: "source-link-test",
        snapshotHash: item.expectedSnapshotHash,
    })),
  }),
  auditSourceRecovery: async (input) => {
    sourceRecoveryAudits.push(input);
  },
});

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

try {
  const anonymous = await request("/api/admin/contact-link-coverage/status");
  assert.equal(anonymous.status, 401, "the rendered admin handler rejects unauthenticated callers");
  const agent = await request("/api/admin/contact-link-coverage/status", { role: "agent", userId: "agent-7" });
  assert.equal(agent.status, 403, "dashboard access does not grant the admin-only handler");
  const admin = await request("/api/admin/contact-link-coverage/status", { role: "admin", userId: "admin-4" });
  assert.equal(admin.status, 200);
  const status = await admin.json() as any;
  assert.equal(status.total, 8);
  assert.equal(status.counts.NEEDS_BUSINESS_DISCOVERY, 1);
  assert.equal("REJECTED" in status.counts, false);

  const noCsrf = await request("/api/admin/contact-link-coverage/start", {
    method: "POST", role: "admin", userId: "admin-4", body: {},
  });
  assert.equal(noCsrf.status, 403, "the real global CSRF middleware blocks session-authenticated mutations without a token");
  assert.equal(handlerCalls.some((call) => call.action === "start"), false);
  const mismatchedCsrf = await request("/api/admin/contact-link-coverage/start", {
    method: "POST", role: "admin", userId: "admin-4",
    cookie: "csrf_token=correct-token", csrf: "wrong-token", body: {},
  });
  assert.equal(mismatchedCsrf.status, 403);
  const manager = await request("/api/admin/contact-link-coverage/start", {
    method: "POST", role: "manager", userId: "manager-2",
    cookie: "csrf_token=correct-token", csrf: "correct-token", body: {},
  });
  assert.equal(manager.status, 403, "a valid CSRF token does not bypass the admin role");
  const missingIdentity = await request("/api/admin/contact-link-coverage/start", {
    method: "POST", role: "admin",
    cookie: "csrf_token=correct-token", csrf: "correct-token", body: {},
  });
  assert.equal(missingIdentity.status, 401, "an absent admin ID cannot be replaced with a synthetic reviewer");
  assert.equal(handlerCalls.some((call) => call.action === "start"), false);

  const started = await request("/api/admin/contact-link-coverage/start", {
    method: "POST", role: "admin", userId: "admin-4",
    cookie: "csrf_token=correct-token", csrf: "correct-token", body: {},
  });
  assert.equal(started.status, 200);
  assert.deepEqual(handlerCalls.find((call) => call.action === "start"), { action: "start", actorId: "admin-4" });

  const invalidPage = await request("/api/admin/contact-link-coverage/candidates?limit=501", {
    role: "admin", userId: "admin-4",
  });
  assert.equal(invalidPage.status, 400, "the actual route validates bounded candidate pages");
  const invalidReview = await request("/api/admin/contact-link-coverage/review-batch", {
    method: "POST", role: "admin", userId: "admin-4",
    cookie: "csrf_token=correct-token", csrf: "correct-token", body: { items: [] },
  });
  assert.equal(invalidReview.status, 400);

  const recoveryIdentity = {
    candidateId: "00000000-0000-4000-8000-000000000101",
    contactId: 101,
    businessId: 202,
    sourceEntityId: 505,
    filingNumber: "FL-2025-005",
  };
  const previewNoCsrf = await request("/api/admin/contact-link-coverage/source-recovery/preview", {
    method: "POST", role: "admin", userId: "admin-4", body: { items: [recoveryIdentity] },
  });
  assert.equal(previewNoCsrf.status, 403, "the actual preview handler remains protected by CSRF");
  const preview = await request("/api/admin/contact-link-coverage/source-recovery/preview", {
    method: "POST", role: "admin", userId: "admin-4",
    cookie: "csrf_token=test-csrf-token", csrf: "test-csrf-token",
    body: { items: [recoveryIdentity] },
  });
  assert.equal(preview.status, 200);
  assert.deepEqual((await preview.json() as any).results[0].identity, recoveryIdentity);
  const tooManyRecoveryItems = await request("/api/admin/contact-link-coverage/source-recovery/preview", {
    method: "POST", role: "admin", userId: "admin-4",
    cookie: "csrf_token=test-csrf-token", csrf: "test-csrf-token",
    body: { items: Array.from({ length: 26 }, () => recoveryIdentity) },
  });
  assert.equal(tooManyRecoveryItems.status, 400, "the real route enforces the 25-identity bound");
  const recoveryApply = await request("/api/admin/contact-link-coverage/source-recovery/apply", {
    method: "POST", role: "admin", userId: "admin-4",
    cookie: "csrf_token=test-csrf-token", csrf: "test-csrf-token",
    body: { items: [{ ...recoveryIdentity, expectedSnapshotHash: "c".repeat(64) }] },
  });
  assert.equal(recoveryApply.status, 200);
  assert.equal((await recoveryApply.json() as any).results[0].status, "MATERIALIZED");
  assert.equal(sourceRecoveryAudits.length, 1);
  assert.equal(sourceRecoveryAudits[0].action, "contact_link_source_recovery_applied");
  assert.equal(sourceRecoveryAudits[0].userId, "admin-4", "source-link materialization audit preserves the authenticated admin identity");

  const validReview = await request("/api/admin/contact-link-coverage/review-batch", {
    method: "POST", role: "admin", userId: "admin-4",
    cookie: "csrf_token=correct-token", csrf: "correct-token",
    body: { items: [{
      candidateId: "00000000-0000-4000-8000-000000000101",
      contactId: 101,
      businessId: 202,
      decision: "verified",
      expectedRevision: 3,
      snapshotHash: "a".repeat(64),
      evidenceSourceEventId: 902,
    }] },
  });
  assert.equal(validReview.status, 200);
  assert.deepEqual(handlerCalls.find((call) => call.action === "review"), { action: "review", actorId: "admin-4" });
  console.log("contact-link-coverage rendered route/role/CSRF tests passed");
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}