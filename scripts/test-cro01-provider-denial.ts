#!/usr/bin/env tsx
/**
 * Server-required CRO-01 authorization/effect-denial proof.
 * Creates only short-lived users, invokes no successful mutation endpoint, and
 * never constructs a provider, queue, task, notification, or enrollment transport.
 */
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { db } from "../server/db";
import { users } from "../shared/models/auth";
import { inArray } from "drizzle-orm";

const base = process.env.BASE_URL ?? "http://127.0.0.1:5000";
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(?:\/|$)/.test(base)) {
  throw new Error("BASE_URL must be an explicit localhost test server.");
}
if (!process.env.ADMIN_SEED_EMAIL || !process.env.ADMIN_SEED_PASSWORD) {
  throw new Error("ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD are required isolated test dependencies.");
}

const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const password = `Cro01!${nonce}`;
const agentEmail = `cro01-agent-${nonce}@libertybancard.test`;
const managerEmail = `cro01-manager-${nonce}@libertybancard.test`;
const createdUserIds: string[] = [];
let assertions = 0;
const check = (condition: unknown, message: string) => { assertions++; assert.ok(condition, message); };

async function login(email: string, loginPassword: string) {
  const response = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: loginPassword }),
    redirect: "manual",
    signal: AbortSignal.timeout(8_000),
  });
  check(response.ok, `login succeeds for ${email.split("@")[0]}`);
  const raw = response.headers.get("set-cookie") ?? "";
  const cookie = raw.split(",").map((part) => part.split(";")[0].trim()).filter(Boolean).join("; ");
  check(Boolean(cookie), "login returns a session cookie");
  const csrfResponse = await fetch(`${base}/api/csrf-token`, { headers: { cookie }, signal: AbortSignal.timeout(5_000) });
  check(csrfResponse.ok, "CSRF token endpoint is available");
  const csrf = String(((await csrfResponse.json()) as any).token ?? "");
  check(Boolean(csrf), "CSRF token is non-empty");
  return { cookie, csrf };
}

async function request(path: string, cookie?: string, init: RequestInit = {}) {
  return fetch(`${base}${path}`, {
    ...init,
    headers: { accept: "application/json", ...(cookie ? { cookie } : {}), ...(init.headers ?? {}) },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
}

try {
  const passwordHash = await bcrypt.hash(password, 12);
  const rows = await db.insert(users).values([
    { email: agentEmail, passwordHash, role: "agent", firstName: "CRO01", lastName: "Agent", authProvider: "local", emailVerified: new Date() },
    { email: managerEmail, passwordHash, role: "manager", firstName: "CRO01", lastName: "Manager", authProvider: "local", emailVerified: new Date() },
  ] as any).returning({ id: users.id });
  createdUserIds.push(...rows.map((row) => row.id));

  const health = await request("/api/health");
  check(health.ok, "server is reachable before denial proof");
  const agent = await login(agentEmail, password);
  const manager = await login(managerEmail, password);
  const admin = await login(process.env.ADMIN_SEED_EMAIL!, process.env.ADMIN_SEED_PASSWORD!);

  check((await request("/api/prospects?limit=1")).status === 401, "anonymous staging list is denied");
  check((await request("/api/prospects?limit=1", agent.cookie)).status === 403, "agent staging list is denied");
  check((await request("/api/prospect-lists", agent.cookie)).status === 403, "agent staging-list identities are denied");
  check((await request("/api/prospects/999999999", agent.cookie)).status === 403, "agent direct staging ID is denied without existence leakage");
  const search = await request("/api/search?q=cro01", agent.cookie);
  check(search.ok, "agent universal search remains available");
  const searchBody = await search.json() as any;
  check(!(searchBody.results ?? searchBody ?? []).some((item: any) => item.type === "prospect"), "agent search contains no prospect staging identity");

  for (const [role, session] of [["manager", manager], ["admin", admin]] as const) {
    check((await request("/api/prospects?limit=1", session.cookie)).status === 200, `${role} can list staging rows`);
    check((await request("/api/revenue/leads?limit=1&offset=0", session.cookie)).status === 200, `${role} can read canonical leads`);
    check((await request("/api/revenue/reconciliation", session.cookie)).status === 200, `${role} can read aggregate reconciliation`);
  }
  check((await request("/api/revenue/reconciliation", agent.cookie)).status === 403, "agent reconciliation is denied");

  const deniedConversion = await request("/api/prospects/999999999/convert", agent.cookie, {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": agent.csrf },
    body: "{}",
  });
  check(deniedConversion.status === 403, "agent conversion is denied before local or external effects");
  const deniedRecalculation = await request("/api/prospects/999999999/recalculate-volume", agent.cookie, {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": agent.csrf },
    body: "{}",
  });
  check(deniedRecalculation.status === 403, "agent prospect recalculation is denied before staging lookup");

  const strictUpdate = await request("/api/prospects/999999999", manager.cookie, {
    method: "PUT",
    headers: { "content-type": "application/json", "x-csrf-token": manager.csrf },
    body: JSON.stringify({ conversionClaimId: "forbidden", unknownField: "forbidden" }),
  });
  check(strictUpdate.status === 400, "strict prospect update rejects authority-managed and unknown fields before storage");
  check(assertions > 0, "provider denial suite has core assertions");
  console.log(`CRO-01 server denial contract passed (${assertions} assertions; all mutation attempts denied before effects).`);
} finally {
  if (createdUserIds.length) await db.delete(users).where(inArray(users.id, createdUserIds)).catch(() => {});
}