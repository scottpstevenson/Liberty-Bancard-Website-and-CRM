#!/usr/bin/env tsx
/**
 * Task #1718 — direct HTTP authorization certification for CRO-03.
 *
 * This is deliberately an HTTP test: route guards, sessions, CSRF, and the
 * privacy-safe ownership response are exercised together. It never starts a
 * worker and it creates only empty/local batch fixtures, so it cannot invoke a
 * provider.
 *
 * Run against a server configured to use TEST_DATABASE_URL:
 *   BASE_URL=http://localhost:5000 TEST_DATABASE_URL=... \
 *   ADMIN_SEED_EMAIL=... ADMIN_SEED_PASSWORD=... \
 *   npx tsx scripts/test-cro03-http-authorization.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { Client } from "pg";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5000";
const MANAGER_A = "__cro03_http_manager_a@libertybancard.test";
const MANAGER_B = "__cro03_http_manager_b@libertybancard.test";
const AGENT = "__cro03_http_agent@libertybancard.test";
const PASSWORD = "Cro03HttpAuth-Aa1!";
const NOT_FOUND = { code: "not_found", message: "Not found" };

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Required environment variable ${name} is not set.`);
  return value;
}

async function approveTestDatabase(url: string): Promise<void> {
  if (!process.env.DATABASE_URL || url !== process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL and TEST_DATABASE_URL must identify the same disposable database.");
  }
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    const result = await client.query<{ current_database: string }>("SELECT current_database()");
    const name = result.rows[0]?.current_database ?? "";
    if (/(prod|production|live)/i.test(name) || !/(^|[_-])(test|ci)([_-]|$)|^(test|ci)/i.test(name)) {
      throw new Error(`Refusing database "${name}"; use a clearly named test/CI database.`);
    }
  } finally {
    await client.end();
  }
}

async function login(email: string, password: string): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const responseBody = await response.text();
  assert.equal(response.status, 200, `login failed for ${email}: ${bounded(responseBody)}`);
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
  const cookie = setCookies.map((value) => value.split(";")[0].trim()).filter(Boolean).join("; ");
  assert.ok(cookie, `no session cookie returned for ${email}`);
  return cookie;
}

async function csrf(cookie: string): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/csrf-token`, { headers: { cookie } });
  assert.equal(response.status, 200, "could not obtain CSRF token");
  const body = await response.json() as { token?: string; csrfToken?: string };
  assert.ok(body.token ?? body.csrfToken, "CSRF token missing from response");
  return body.token ?? body.csrfToken!;
}

async function request(path: string, init: RequestInit = {}, cookie?: string, token?: string): Promise<Response> {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  if (token) headers.set("x-csrf-token", token);
  return fetch(`${BASE_URL}${path}`, { ...init, headers });
}

function bounded(value: string, maxLength = 1000): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
}

async function expectStatus(response: Response, status: number, label: string): Promise<string> {
  const responseBody = await response.text();
  assert.equal(
    response.status,
    status,
    `${label}: expected ${status}, got ${response.status}; response body: ${bounded(responseBody)}`,
  );
  return responseBody;
}

function parseJson<T>(responseBody: string, label: string): T {
  try {
    return JSON.parse(responseBody) as T;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    assert.fail(`${label}: malformed JSON response: ${bounded(responseBody)} (${bounded(detail, 300)})`);
  }
}

async function main(): Promise<void> {
  const testDbUrl = required("TEST_DATABASE_URL");
  const adminEmail = required("ADMIN_SEED_EMAIL");
  const adminPassword = required("ADMIN_SEED_PASSWORD");
  await approveTestDatabase(testDbUrl);
  // This process only uses the approved database for fixture setup/cleanup.
  process.env.DATABASE_URL = testDbUrl;
  const { pool } = await import("../server/db");
  const { users } = await import("../shared/models/auth");
  const { eq } = await import("drizzle-orm");
  const { db } = await import("../server/db");
  const fixtureBatchIds: string[] = [];
  const cleanupFailures: Array<{ stage: string; error: unknown }> = [];

  async function ensureUser(email: string, role: "manager" | "agent"): Promise<void> {
    const hash = await bcrypt.hash(PASSWORD, 12);
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (existing.length) {
      await db.update(users).set({ passwordHash: hash, role, authProvider: "local", emailVerified: new Date() } as any)
        .where(eq(users.email, email));
    } else {
      await db.insert(users).values({
        email, firstName: "CRO03", lastName: role, passwordHash: hash, role,
        authProvider: "local", emailVerified: new Date(),
      } as any);
    }
  }
  async function fixture(ownerEmail: string): Promise<string> {
    const owner = await db.select({ id: users.id }).from(users).where(eq(users.email, ownerEmail));
    assert.equal(owner.length, 1, `fixture owner ${ownerEmail} missing`);
    const id = randomUUID();
    await pool.query(
      `INSERT INTO cro03_enrichment_batches
        (id,idempotency_key,actor_type,actor_id,purpose,state,total_count,executable_count,blocked_count,selection_hash)
       VALUES ($1,$2,'user',$3,'internal_test','queued',1,1,0,$4)`,
      [id, `cro03-http-${id}`, String(owner[0].id), randomUUID()],
    );
    fixtureBatchIds.push(id);
    return id;
  }

  let primaryFailure: unknown;
  try {
    await Promise.all([ensureUser(MANAGER_A, "manager"), ensureUser(MANAGER_B, "manager"), ensureUser(AGENT, "agent")]);
    const [managerACookie, managerBCookie, agentCookie, adminCookie] = await Promise.all([
      login(MANAGER_A, PASSWORD), login(MANAGER_B, PASSWORD), login(AGENT, PASSWORD), login(adminEmail, adminPassword),
    ]);
    const [managerACsrf, managerBCsrf, adminCsrf] = await Promise.all([
      csrf(managerACookie), csrf(managerBCookie), csrf(adminCookie),
    ]);
    const ownerBatch = await fixture(MANAGER_A);
    const adminBatch = await fixture(adminEmail);
    const malformed = "not-a-uuid";

    // Anonymous and agent callers are rejected before validation/ownership lookup.
    for (const [label, cookie] of [["anonymous", undefined], ["agent", agentCookie]] as const) {
      const expected = label === "anonymous" ? 401 : 403;
      await expectStatus(await request(`/api/cro03/batches/${ownerBatch}`, {}, cookie), expected, `${label} batch GET`);
      await expectStatus(await request(`/api/cro03/batches/${ownerBatch}/cancel`, { method: "POST" }, cookie), expected, `${label} batch cancel`);
      await expectStatus(await request("/api/cro03/reconciliation", {}, cookie), expected, `${label} reconciliation`);
      await expectStatus(await request("/api/cro03/policy", {}, cookie), expected, `${label} policy`);
      await expectStatus(await request("/api/cro03/batches", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: `cro03-http-${randomUUID()}`, contactIds: [] }),
      }, cookie), expected, `${label} create`);
    }

    // Manager A can read and cancel only its own durable command.
    await expectStatus(await request(`/api/cro03/batches/${ownerBatch}`, {}, managerACookie), 200, "owner manager GET");
    await expectStatus(await request(`/api/cro03/batches/${malformed}`, {}, managerACookie), 404, "owner malformed GET");
    await expectStatus(await request(`/api/cro03/batches/${malformed}/cancel`, { method: "POST" }, managerACookie, managerACsrf), 404, "owner malformed cancel");

    // Manager B receives the same minimal 404 for an existing foreign ID: no ownership disclosure.
    for (const [path, init] of [
      [`/api/cro03/batches/${ownerBatch}`, {}],
      [`/api/cro03/batches/${ownerBatch}/cancel`, { method: "POST" }],
    ] as const) {
      const response = await request(path, init, managerBCookie, managerBCsrf);
      const responseBody = await expectStatus(response, 404, `non-owner manager ${init.method ?? "GET"}`);
      assert.deepEqual(
        parseJson(responseBody, `non-owner manager ${init.method ?? "GET"}`),
        NOT_FOUND,
        "foreign batch response must be privacy-safe",
      );
    }
    await expectStatus(await request("/api/cro03/reconciliation", {}, managerACookie), 403, "manager reconciliation");
    await expectStatus(await request("/api/cro03/policy", {}, managerACookie), 403, "manager policy");
    await expectStatus(await request(`/api/cro03/batches/${ownerBatch}/cancel`, { method: "POST" }, managerACookie, managerACsrf), 202, "owner manager cancel");

    // Admin has global batch authority and the two aggregate/policy reads.
    const create = await request("/api/cro03/batches", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: `cro03-http-${randomUUID()}`, contactIds: [], purpose: "internal_test" }),
    }, adminCookie, adminCsrf);
    const createBody = await expectStatus(create, 202, "admin create");
    const created = parseJson<{ batchId?: unknown }>(createBody, "admin create");
    assert.ok(
      typeof created.batchId === "string" && created.batchId.trim().length > 0,
      "admin create: response batchId must be a non-empty string",
    );
    assert.match(
      created.batchId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      "admin create: response batchId must be a UUID",
    );
    fixtureBatchIds.push(created.batchId);
    await expectStatus(await request(`/api/cro03/batches/${ownerBatch}`, {}, adminCookie), 200, "admin foreign GET");
    await expectStatus(await request(`/api/cro03/batches/${adminBatch}/cancel`, { method: "POST" }, adminCookie, adminCsrf), 202, "admin cancel");
    await expectStatus(await request(`/api/cro03/batches/${malformed}`, {}, adminCookie), 404, "admin malformed GET");
    await expectStatus(await request(`/api/cro03/batches/${malformed}/cancel`, { method: "POST" }, adminCookie, adminCsrf), 404, "admin malformed cancel");
    await expectStatus(await request("/api/cro03/reconciliation", {}, adminCookie), 200, "admin reconciliation");
    await expectStatus(await request("/api/cro03/policy", {}, adminCookie), 200, "admin policy");
  } catch (error) {
    primaryFailure = error;
  } finally {
    const attemptCleanup = async (stage: string, cleanup: () => Promise<unknown>): Promise<void> => {
      try {
        await cleanup();
      } catch (error) {
        cleanupFailures.push({ stage, error });
        const detail = error instanceof Error ? error.message : String(error);
        console.error(`[cleanup] ${stage} failed: ${bounded(detail, 500)}`);
      }
    };

    if (fixtureBatchIds.length) {
      await attemptCleanup(
        "batch deletion",
        () => pool.query("DELETE FROM cro03_enrichment_batches WHERE id = ANY($1::uuid[])", [fixtureBatchIds]),
      );
    }
    for (const email of [MANAGER_A, MANAGER_B, AGENT]) {
      await attemptCleanup(`fixture-user deletion for ${email}`, () => db.delete(users).where(eq(users.email, email)));
    }
    await attemptCleanup("pool closure", () => pool.end());
  }

  if (primaryFailure) {
    if (cleanupFailures.length) {
      throw new AggregateError(
        [
          primaryFailure,
          ...cleanupFailures.map(({ stage, error }) =>
            new Error(`${stage}: ${error instanceof Error ? error.message : String(error)}`),
          ),
        ],
        "CRO-03 HTTP authorization certification and cleanup failed",
      );
    }
    throw primaryFailure;
  }
  if (cleanupFailures.length) {
    throw new AggregateError(
      cleanupFailures.map(({ stage, error }) =>
        new Error(`${stage}: ${error instanceof Error ? error.message : String(error)}`),
      ),
      "CRO-03 HTTP authorization cleanup failed",
    );
  }
  console.log("CRO-03 HTTP authorization certification passed (no worker/provider transport invoked).");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});