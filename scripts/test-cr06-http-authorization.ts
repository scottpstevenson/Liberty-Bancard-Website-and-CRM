#!/usr/bin/env tsx
/**
 * CR-06 HTTP authorization certification.  This uses the running isolated
 * test-auth server rather than route-source inspection.  Its only successful
 * command is the CR-06 read-only rollout preview; no release or transport is
 * reachable from this suite.
 */
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { db } from "../server/db";
import { users } from "../shared/models/auth";
import { inArray } from "drizzle-orm";

const base = process.env.BASE_URL ?? "http://127.0.0.1:5000";
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(?:\/|$)/.test(base)) {
  throw new Error("BASE_URL must name the isolated localhost test server.");
}
const adminEmail = process.env.ADMIN_SEED_EMAIL;
const adminPassword = process.env.ADMIN_SEED_PASSWORD;
if (!adminEmail || !adminPassword) throw new Error("ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD are required.");

const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const password = `Cr06Http!${nonce}`;
const fixture = [
  ["manager", `cr06-manager-${nonce}@libertybancard.test`],
  ["agent", `cr06-agent-${nonce}@libertybancard.test`],
  ["merchant", `cr06-merchant-${nonce}@libertybancard.test`],
] as const;
let createdIds: string[] = [];
let assertions = 0;
function check(value: unknown, message: string): asserts value {
  assertions++;
  assert.ok(value, message);
}
async function login(email: string, loginPassword: string) {
  const response = await fetch(`${base}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: loginPassword }), signal: AbortSignal.timeout(10_000),
  });
  check(response.status === 200, `login succeeds for ${email}`);
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const cookie = (headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""])
    .map((value) => value.split(";")[0].trim()).filter(Boolean).join("; ");
  check(cookie, `session cookie is returned for ${email}`);
  const csrfResponse = await fetch(`${base}/api/csrf-token`, { headers: { cookie } });
  check(csrfResponse.status === 200, `CSRF token is available for ${email}`);
  const body = await csrfResponse.json() as { token?: string; csrfToken?: string };
  const csrf = body.token ?? body.csrfToken;
  check(csrf, `CSRF token is non-empty for ${email}`);
  return { cookie, csrf: csrf! };
}
async function request(path: string, session?: { cookie: string; csrf: string }, init: RequestInit = {}, csrf?: string) {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (session) headers.set("cookie", session.cookie);
  if (csrf) headers.set("x-csrf-token", csrf);
  return fetch(`${base}${path}`, { ...init, headers, signal: AbortSignal.timeout(10_000) });
}
async function status(path: string, expected: number, session?: { cookie: string; csrf: string }, init?: RequestInit, csrf?: string) {
  const response = await request(path, session, init, csrf);
  const body = await response.text();
  assert.equal(response.status, expected, `${path}: expected ${expected}, got ${response.status}: ${body.slice(0, 500)}`);
  assertions++;
  return body;
}

try {
  const passwordHash = await bcrypt.hash(password, 12);
  const rows = await db.insert(users).values(fixture.map(([role, email]) => ({
    email, passwordHash, role, firstName: "CR06", lastName: role, authProvider: "local", emailVerified: new Date(),
  })) as any).returning({ id: users.id });
  createdIds = rows.map((row) => row.id);
  const [manager, agent, merchant, admin] = await Promise.all([
    login(fixture[0][1], password), login(fixture[1][1], password), login(fixture[2][1], password),
    login(adminEmail, adminPassword),
  ]);
  await status("/api/admin/cr06/manifest", 401);
  await status("/api/admin/cr06/manifest", 200, manager);
  for (const session of [agent, merchant]) await status("/api/admin/cr06/manifest", 403, session);

  const preview = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dryRun: true }) };
  await status("/api/admin/cr06/rollout", 401, undefined, preview);
  await status("/api/admin/cr06/rollout", 403, manager, preview, manager.csrf);
  await status("/api/admin/cr06/rollout", 403, admin, preview);
  await status("/api/admin/cr06/rollout", 403, admin, preview, "wrong-csrf-token");
  await status("/api/admin/cr06/rollout", 200, admin, preview, admin.csrf);

  const invalidGate = { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": `cr06-${nonce}` },
    body: JSON.stringify({ programArtifactId: "not-a-uuid", cohortRunId: "not-a-uuid", preflightHash: "0".repeat(64), cap: 1, state: "closed", expiresAt: new Date().toISOString() }) };
  await status("/api/admin/cr06/gates", 403, agent, invalidGate, agent.csrf);
  await status("/api/admin/cr06/gates", 403, manager, invalidGate, manager.csrf);
  await status("/api/admin/cr06/gates", 400, admin, invalidGate, admin.csrf);
  await status("/api/admin/cr06/gates", 400, admin, { ...invalidGate, headers: { "content-type": "application/json" } }, admin.csrf);

  const approve = { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedHash: "0".repeat(64), confirmation: "CR06_APPROVE_EXACT_IMMUTABLE_PACKAGE" }) };
  await status("/api/admin/cr06/programs/not-a-uuid/approve", 400, admin, approve, admin.csrf);
  await status("/api/admin/cr06/runs/not-a-uuid", 400, admin);
  await status("/api/admin/cr06/runs/not-a-uuid/release", 400, admin, { method: "POST" }, admin.csrf);
  await status("/api/admin/cr06/runs/not-a-uuid/release", 403, manager, { method: "POST" }, manager.csrf);
  const feedback = { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ deliveryIntentId: "not-a-uuid", eventKey: `cr06-${nonce}`, eventType: "delivered" }) };
  await status("/api/admin/cr06/feedback/synthetic", 400, admin, feedback, admin.csrf);
  await status("/api/admin/cr06/feedback/synthetic", 403, merchant, feedback, merchant.csrf);
  check(assertions > 20, "CR-06 HTTP suite exercised role, CSRF, ID, and idempotency boundaries");
  console.log(`CR-06 HTTP authorization certification passed (${assertions} assertions; no provider transport invoked).`);
} finally {
  if (createdIds.length) await db.delete(users).where(inArray(users.id, createdIds)).catch(() => {});
}