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
    const explicitlyApproved = process.env.TEST_APPROVED_DB_NAME?.trim();
    const allowed = explicitlyApproved
      ? name === explicitlyApproved && !/(prod|production|live)/i.test(name)
      : !/(prod|production|live)/i.test(name) &&
        /(^|[_-])(test|ci)([_-]|$)|^(test|ci)/i.test(name);
    if (!allowed) {
      throw new Error(
        explicitlyApproved
          ? `Refusing database "${name}"; it does not match TEST_APPROVED_DB_NAME.`
          : `Refusing database "${name}"; use a clearly named test/CI database or set TEST_APPROVED_DB_NAME explicitly.`,
      );
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
  const fixtureHandoffIds: string[] = [];
  const fixtureRunIds: string[] = [];
  const fixtureCommandIds: string[] = [];
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
  async function handoffFixture(ownerEmail: string): Promise<string> {
    const owner = await db.select({ id: users.id }).from(users).where(eq(users.email, ownerEmail));
    assert.equal(owner.length, 1, `handoff fixture owner ${ownerEmail} missing`);
    const source = await pool.query<{
      occurrence_id: string; policy_id: string; policy_version: number; policy_hash: string;
    }>(`
      SELECT o.id occurrence_id,p.id policy_id,p.version policy_version,p.policy_hash
        FROM cro03_source_occurrences o
        CROSS JOIN LATERAL (
          SELECT id,version,policy_hash FROM cro03a_policy_documents ORDER BY created_at DESC LIMIT 1
        ) p
       ORDER BY o.created_at DESC LIMIT 1
    `);
    assert.equal(source.rows.length, 1, "handoff fixture requires source occurrence and qualification policy");
    const ids = { run: randomUUID(), item: randomUUID(), decision: randomUUID(), handoff: randomUUID() };
    const row = source.rows[0];
    await pool.query("BEGIN");
    try {
      await pool.query(`
      INSERT INTO cro03a_qualification_runs
        (id,idempotency_key,actor_id,actor_role,policy_id,policy_hash,scope_hash,
         frozen_occurrence_ids,state,total_count,selected_count,terminal_count)
      VALUES ($1,$2,$3,'manager',$4::uuid,$5,$6,$7::jsonb,'completed',1,1,1)
    `, [ids.run, `cro03-http-run-${ids.run}`, String(owner[0].id), row.policy_id, row.policy_hash,
      randomUUID(), JSON.stringify([row.occurrence_id])]);
      await pool.query(`
      INSERT INTO cro03a_qualification_items
        (id,run_id,occurrence_id,ordinal,state,authority_evidence)
      VALUES ($1,$2,$3::uuid,0,'completed','{}'::jsonb)
    `, [ids.item, ids.run, row.occurrence_id]);
      await pool.query(`
      INSERT INTO cro03a_qualification_decisions
        (id,item_id,run_id,occurrence_id,disposition,score,geography_result,vertical_result,
         active_state_evidence,identity_relationship_evidence,fit_components,reason_codes,
         frozen_occurrence_ids,policy_id,policy_version,policy_hash,selection_hash)
      VALUES ($1,$2,$3,$4::uuid,'selected',90,'{}','{}','{}','{}','{}','[]',$5::jsonb,
              $6::uuid,$7,$8,$9)
    `, [ids.decision, ids.item, ids.run, row.occurrence_id, JSON.stringify([row.occurrence_id]),
      row.policy_id, row.policy_version, row.policy_hash, randomUUID()]);
      await pool.query(`
      INSERT INTO cro03a_handoffs
        (id,run_id,decision_id,source_type,source_system,source_key,occurrence_ids,policy_id,
         policy_version,policy_hash,reason_codes,selection_hash,effect_authorized)
      VALUES ($1,$2,$3,'source_entity','cro03-http',$4,$5::jsonb,$6::uuid,$7,$8,'[]',$9,FALSE)
    `, [ids.handoff, ids.run, ids.decision, `fixture-${ids.handoff}`,
      JSON.stringify([row.occurrence_id]), row.policy_id, row.policy_version, row.policy_hash, randomUUID()]);
      await pool.query("COMMIT");
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
    fixtureHandoffIds.push(ids.handoff);
    fixtureRunIds.push(ids.run);
    return ids.handoff;
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
    const ownerHandoff = await handoffFixture(MANAGER_A);
    const malformed = "not-a-uuid";
    const managerSessionBody = await expectStatus(
      await request("/api/auth/user", {}, managerACookie),
      200,
      "manager session identity",
    );
    const managerSession = parseJson<{ id?: string | number }>(managerSessionBody, "manager session identity");
    const fixtureOwner = await pool.query<{ actor_id: string }>(
      "SELECT actor_id FROM cro03_enrichment_batches WHERE id=$1::uuid",
      [ownerBatch],
    );
    assert.equal(String(managerSession.id), String(fixtureOwner.rows[0]?.actor_id),
      "authenticated manager ID must match the server-derived batch owner ID");
    const { getCro03BatchStatus } = await import("../server/services/cro03/enrichment-factory");
    assert.ok(await getCro03BatchStatus(ownerBatch), "fixture batch must be readable by the status service");

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
    const foreignAdmissionBody = await expectStatus(await request("/api/cro03b/commands", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ handoffIds: [ownerHandoff], reason: "foreign ownership certification" }),
    }, managerBCookie, managerBCsrf), 404, "non-owner manager CRO-03B admission");
    assert.equal(parseJson<{ code: string }>(foreignAdmissionBody, "foreign CRO-03B admission").code,
      "CRO03B_HANDOFF_NOT_FOUND");
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
    const admissionReason = "admin CRO-03B authorization certification";
    const adminAdmissionBody = await expectStatus(await request("/api/cro03b/commands", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ handoffIds: [ownerHandoff], reason: admissionReason }),
    }, adminCookie, adminCsrf), 202, "admin CRO-03B admission");
    const adminAdmission = parseJson<{ commandId: string }>(adminAdmissionBody, "admin CRO-03B admission");
    fixtureCommandIds.push(adminAdmission.commandId);
    await expectStatus(await request("/api/cro03b/commands", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ handoffIds: [ownerHandoff], reason: admissionReason }),
    }, adminCookie, adminCsrf), 200, "admin CRO-03B exact replay");
    const changedReplay = await expectStatus(await request("/api/cro03b/commands", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ handoffIds: [ownerHandoff], reason: `${admissionReason} changed` }),
    }, adminCookie, adminCsrf), 409, "admin CRO-03B changed replay");
    assert.equal(parseJson<{ code: string }>(changedReplay, "changed replay").code,
      "CRO03B_COMMAND_PAYLOAD_CONFLICT");
    const alreadyAdmitted = await expectStatus(await request("/api/cro03b/commands", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ handoffIds: [ownerHandoff], reason: "owner post-admin admission" }),
    }, managerACookie, managerACsrf), 409, "CRO-03B already admitted");
    assert.equal(parseJson<{ code: string }>(alreadyAdmitted, "already admitted").code,
      "CRO03B_HANDOFF_ALREADY_ADMITTED");
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
    if (fixtureHandoffIds.length) {
      await attemptCleanup("CRO-03B handoff fixture deletion", async () => {
        await pool.query("BEGIN");
        try {
          for (const statement of [
            "ALTER TABLE cro03b_recipe_receipts DISABLE TRIGGER cro03b_recipe_receipts_immutable",
            "ALTER TABLE cro03a_consumption_receipts DISABLE TRIGGER cro03a_consumption_receipts_immutable",
            "ALTER TABLE cro03a_handoffs DISABLE TRIGGER cro03a_handoffs_immutable",
            "ALTER TABLE cro03a_qualification_decisions DISABLE TRIGGER cro03a_decisions_immutable",
          ]) await pool.query(statement);
          await pool.query("DELETE FROM cro03a_consumption_receipts WHERE handoff_id=ANY($1::uuid[])", [fixtureHandoffIds]);
          await pool.query("DELETE FROM cro03b_recipe_receipts WHERE handoff_id=ANY($1::uuid[])", [fixtureHandoffIds]);
          await pool.query(`DELETE FROM cro03b_step_executions WHERE item_id IN
            (SELECT id FROM cro03b_recipe_items WHERE handoff_id=ANY($1::uuid[]))`, [fixtureHandoffIds]);
          await pool.query("DELETE FROM cro03b_recipe_items WHERE handoff_id=ANY($1::uuid[])", [fixtureHandoffIds]);
          await pool.query("DELETE FROM cro03b_recipe_commands WHERE id=ANY($1::uuid[])", [fixtureCommandIds]);
          await pool.query("DELETE FROM cro03a_handoffs WHERE id=ANY($1::uuid[])", [fixtureHandoffIds]);
          await pool.query("DELETE FROM cro03a_qualification_decisions WHERE run_id=ANY($1::uuid[])", [fixtureRunIds]);
          await pool.query("DELETE FROM cro03a_qualification_items WHERE run_id=ANY($1::uuid[])", [fixtureRunIds]);
          await pool.query("DELETE FROM cro03a_qualification_runs WHERE id=ANY($1::uuid[])", [fixtureRunIds]);
          for (const statement of [
            "ALTER TABLE cro03b_recipe_receipts ENABLE TRIGGER cro03b_recipe_receipts_immutable",
            "ALTER TABLE cro03a_consumption_receipts ENABLE TRIGGER cro03a_consumption_receipts_immutable",
            "ALTER TABLE cro03a_handoffs ENABLE TRIGGER cro03a_handoffs_immutable",
            "ALTER TABLE cro03a_qualification_decisions ENABLE TRIGGER cro03a_decisions_immutable",
          ]) await pool.query(statement);
          await pool.query("COMMIT");
        } catch (error) {
          await pool.query("ROLLBACK");
          throw error;
        }
      });
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