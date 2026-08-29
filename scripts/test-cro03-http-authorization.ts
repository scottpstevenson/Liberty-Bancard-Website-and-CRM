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
  assert.equal(response.status, 200, `login failed for ${email}: ${await response.text()}`);
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

async function expectStatus(response: Response, status: number, label: string): Promise<void> {
  assert.equal(response.status, status, `${label}: expected ${status}, got ${response.status}: ${await response.text()}`);
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
      await expectStatus(response, 404, `non-owner manager ${init.method ?? "GET"}`);
      assert.deepEqual(await response.json(), NOT_FOUND, "foreign batch response must be privacy-safe");
    }
    await expectStatus(await request("/api/cro03/reconciliation", {}, managerACookie), 403, "manager reconciliation");
    await expectStatus(await request("/api/cro03/policy", {}, managerACookie), 403, "manager policy");
    await expectStatus(await request(`/api/cro03/batches/${ownerBatch}/cancel`, { method: "POST" }, managerACookie, managerACsrf), 202, "owner manager cancel");

    // Admin has global batch authority and the two aggregate/policy reads.
    const create = await request("/api/cro03/batches", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: `cro03-http-${randomUUID()}`, contactIds: [], purpose: "internal_test" }),
    }, adminCookie, adminCsrf);
    await expectStatus(create, 202, "admin create");
    const created = await create.json() as { batchId: string };
    fixtureBatchIds.push(created.batchId);
    await expectStatus(await request(`/api/cro03/batches/${ownerBatch}`, {}, adminCookie), 200, "admin foreign GET");
    await expectStatus(await request(`/api/cro03/batches/${adminBatch}/cancel`, { method: "POST" }, adminCookie, adminCsrf), 202, "admin cancel");
    await expectStatus(await request(`/api/cro03/batches/${malformed}`, {}, adminCookie), 404, "admin malformed GET");
    await expectStatus(await request(`/api/cro03/batches/${malformed}/cancel`, { method: "POST" }, adminCookie, adminCsrf), 404, "admin malformed cancel");
    await expectStatus(await request("/api/cro03/reconciliation", {}, adminCookie), 200, "admin reconciliation");
    await expectStatus(await request("/api/cro03/policy", {}, adminCookie), 200, "admin policy");
    console.log("CRO-03 HTTP authorization certification passed (no worker/provider transport invoked).");
  } finally {
    if (fixtureBatchIds.length) await pool.query("DELETE FROM cro03_enrichment_batches WHERE id = ANY($1::uuid[])", [fixtureBatchIds]);
    await Promise.all([MANAGER_A, MANAGER_B, AGENT].map((email) => db.delete(users).where(eq(users.email, email)).catch(() => {})));
    await pool.end();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });