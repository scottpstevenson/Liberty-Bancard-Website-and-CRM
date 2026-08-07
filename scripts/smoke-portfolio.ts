#!/usr/bin/env tsx
/**
 * Task #1312 — Portfolio scoping smoke test.
 *
 * Verifies that /api/portfolio enforces ownership boundaries:
 *   agent   → sees ONLY contacts where deals.owner = their email
 *   manager → can filter to any rep via ?owner= and sees that rep's contacts
 *   admin   → same cross-rep visibility as manager
 *
 * All fixtures (users, deals, contacts) are created inside a try/finally so
 * they are deleted on both success and failure — including partial setup
 * failures. Teardown order: deals → contacts → users (FK-safe).
 *
 * Admin/manager assertions use ?owner= queries rather than the unfiltered
 * list so they are robust against the endpoint's LIMIT 500 on populated DBs.
 *
 * Per-run unique credentials mean no persistent known-credential accounts.
 *
 * Usage (dev server must be running):
 *   BASE_URL=http://localhost:5000 npx tsx scripts/smoke-portfolio.ts
 *
 * Exits 0 if every scoping assertion holds, 1 otherwise.
 */

import bcrypt from "bcryptjs";
import { db } from "../server/db";
import { users } from "../shared/models/auth";
import { contacts, deals } from "../shared/schema";
import { eq, inArray } from "drizzle-orm";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5000";

if (!process.env.ADMIN_SEED_EMAIL || !process.env.ADMIN_SEED_PASSWORD) {
  console.error(
    "\n✗ MISSING REQUIRED ENV: ADMIN_SEED_EMAIL and/or ADMIN_SEED_PASSWORD not set.\n" +
      "  Portfolio smoke tests CANNOT run without admin credentials — failing closed.\n\n" +
      "  Set both env vars before running:\n" +
      "    ADMIN_SEED_EMAIL=admin@example.com ADMIN_SEED_PASSWORD=secret npx tsx scripts/smoke-portfolio.ts\n"
  );
  process.exit(1);
}

const ADMIN_EMAIL = process.env.ADMIN_SEED_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_SEED_PASSWORD;

// ── Per-run unique identifiers ─────────────────────────────────────────────
// Fresh on every invocation — no persistent known-credential accounts,
// no collision with interrupted previous runs.
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const AGENT_A_EMAIL   = `sp-a-${RUN_ID}@libertybancard.test`;
const AGENT_A_PASS    = `spA!${RUN_ID}`;
const AGENT_B_EMAIL   = `sp-b-${RUN_ID}@libertybancard.test`;
const AGENT_B_PASS    = `spB!${RUN_ID}`;
const MANAGER_EMAIL   = `sp-mgr-${RUN_ID}@libertybancard.test`;
const MANAGER_PASS    = `spM!${RUN_ID}`;

// Phones are also unique per run to avoid partial-index collisions on contacts.
const CONTACT_A_PHONE = `+15550${RUN_ID.replace(/\D/g, "").slice(0, 7).padEnd(7, "1")}`;
const CONTACT_B_PHONE = `+15551${RUN_ID.replace(/\D/g, "").slice(0, 7).padEnd(7, "2")}`;

// ── Fixture state (string IDs for UUID PKs, number IDs for serial PKs) ─────
let userAId:   string | null = null;
let userBId:   string | null = null;
let userMgrId: string | null = null;
let contactAId: number | null = null;
let contactBId: number | null = null;
let dealAId:   number | null = null;
let dealBId:   number | null = null;

// ── Helpers ─────────────────────────────────────────────────────────────────

async function createUser(
  email: string,
  password: string,
  role: "agent" | "manager"
): Promise<string> {
  const passwordHash = await bcrypt.hash(password, 12);
  const [row] = await db
    .insert(users)
    .values({
      email,
      passwordHash,
      role,
      firstName: "SmokePortfolio",
      lastName: role,
      authProvider: "local",
      emailVerified: new Date(),
    } as any)
    .returning({ id: users.id });
  return row.id as string;
}

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    redirect: "manual",
  });
  const setCookieArr: string[] = Array.isArray((res.headers as any).getSetCookie?.())
    ? (res.headers as any).getSetCookie()
    : [res.headers.get("set-cookie") ?? ""];
  const cookies = setCookieArr
    .flatMap((s: string) => s.split(","))
    .map((s: string) => s.split(";")[0].trim())
    .filter(Boolean);
  if (cookies.length === 0)
    throw new Error(`No session cookie returned for ${email} (HTTP ${res.status})`);
  return cookies.join("; ");
}

async function loginWithRetry(email: string, password: string, attempts = 3): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await login(email, password); }
    catch (err) { lastErr = err; await new Promise(r => setTimeout(r, 1000 * (i + 1))); }
  }
  throw lastErr;
}

/** Fetch /api/portfolio with an optional ?owner= filter. */
async function fetchPortfolio(cookie: string, ownerEmail?: string): Promise<any[]> {
  const url = ownerEmail
    ? `${BASE_URL}/api/portfolio?owner=${encodeURIComponent(ownerEmail)}`
    : `${BASE_URL}/api/portfolio`;
  const res = await fetch(url, { headers: { cookie } });
  if (res.status !== 200) throw new Error(`/api/portfolio returned HTTP ${res.status}`);
  const body = (await res.json()) as any;
  return Array.isArray(body.data) ? body.data : [];
}

// ── Teardown (deals → contacts → users, FK-safe order) ─────────────────────
async function teardown(): Promise<void> {
  if (dealAId    !== null) await db.delete(deals).where(eq(deals.id, dealAId)).catch(() => {});
  if (dealBId    !== null) await db.delete(deals).where(eq(deals.id, dealBId)).catch(() => {});

  const cIds = [contactAId, contactBId].filter((id): id is number => id !== null);
  if (cIds.length > 0) await db.delete(contacts).where(inArray(contacts.id, cIds)).catch(() => {});

  const uIds = [userAId, userBId, userMgrId].filter((id): id is string => id !== null);
  if (uIds.length > 0) await db.delete(users).where(inArray(users.id, uIds)).catch(() => {});
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function run(): Promise<void> {
  console.log(`── smoke-portfolio run=${RUN_ID} ──`);
  let failures = 0;
  let tests = 0;

  function pass(label: string) { console.log(`✓ ${label}`); }
  function fail(label: string) { console.log(`✗ ${label}`); failures++; }

  try {
    // ── Setup (inside try so any partial success is cleaned up) ────────────
    console.log("\n── Setting up per-run test users and fixtures ──");

    // Sequential inserts so each ID is captured before the next step;
    // if any insert fails, teardown() will clean up whatever was created.
    userAId   = await createUser(AGENT_A_EMAIL,  AGENT_A_PASS,  "agent");
    userBId   = await createUser(AGENT_B_EMAIL,  AGENT_B_PASS,  "agent");
    userMgrId = await createUser(MANAGER_EMAIL,  MANAGER_PASS,  "manager");

    const [cA] = await db
      .insert(contacts)
      .values({
        firstName: "SmokePortfolioA", lastName: "Contact",
        email: `sp-ca-${RUN_ID}@libertybancard.test`,
        phone: CONTACT_A_PHONE, status: "active",
        leadSource: "smoke-test", sourceCategory: "smoke-test",
      } as any)
      .returning({ id: contacts.id });
    contactAId = cA.id;

    const [cB] = await db
      .insert(contacts)
      .values({
        firstName: "SmokePortfolioB", lastName: "Contact",
        email: `sp-cb-${RUN_ID}@libertybancard.test`,
        phone: CONTACT_B_PHONE, status: "active",
        leadSource: "smoke-test", sourceCategory: "smoke-test",
      } as any)
      .returning({ id: contacts.id });
    contactBId = cB.id;

    const [dA] = await db
      .insert(deals)
      .values({ contactId: contactAId, pipeline: "sales", stage: "New Lead", owner: AGENT_A_EMAIL } as any)
      .returning({ id: deals.id });
    dealAId = dA.id;

    const [dB] = await db
      .insert(deals)
      .values({ contactId: contactBId, pipeline: "sales", stage: "New Lead", owner: AGENT_B_EMAIL } as any)
      .returning({ id: deals.id });
    dealBId = dB.id;

    console.log(
      `  contact A=#${contactAId} deal=#${dealAId} owner=${AGENT_A_EMAIL}\n` +
      `  contact B=#${contactBId} deal=#${dealBId} owner=${AGENT_B_EMAIL}`
    );

    // ── Log in as all roles ────────────────────────────────────────────────
    console.log("\n── Logging in ──");
    let agentACookie: string, agentBCookie: string, managerCookie: string, adminCookie: string;
    try {
      [agentACookie, agentBCookie, managerCookie, adminCookie] = await Promise.all([
        loginWithRetry(AGENT_A_EMAIL,  AGENT_A_PASS),
        loginWithRetry(AGENT_B_EMAIL,  AGENT_B_PASS),
        loginWithRetry(MANAGER_EMAIL,  MANAGER_PASS),
        loginWithRetry(ADMIN_EMAIL,    ADMIN_PASSWORD),
      ]);
    } catch (err) {
      console.error(`✗ Login failed: ${err instanceof Error ? err.message : String(err)}`);
      console.error("  Rate-limiter caps 5 attempts/15 min — wait or restart the server.");
      // Throw so the finally block runs (teardown) and then the outer catch
      // drives process.exit(1) — guarantees a non-zero exit code in CI.
      throw new Error(`Login setup failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // ── Agent A scoping ────────────────────────────────────────────────────
    console.log("\n── Agent A portfolio scoping ──");
    try {
      const ids = (await fetchPortfolio(agentACookie)).map((r: any) => r.id);
      tests++;
      ids.includes(contactAId)
        ? pass(`Agent A sees own contact #${contactAId}`)
        : fail(`Agent A MISSING own contact #${contactAId}`);
      tests++;
      !ids.includes(contactBId)
        ? pass(`Agent A does NOT see Agent B's contact #${contactBId}`)
        : fail(`Agent A LEAKED Agent B's contact #${contactBId} — ownership boundary broken`);
    } catch (err) {
      console.log(`✗ Agent A request failed: ${err instanceof Error ? err.message : String(err)}`);
      failures += 2; tests += 2;
    }

    // ── Agent B scoping ────────────────────────────────────────────────────
    console.log("\n── Agent B portfolio scoping ──");
    try {
      const ids = (await fetchPortfolio(agentBCookie)).map((r: any) => r.id);
      tests++;
      ids.includes(contactBId)
        ? pass(`Agent B sees own contact #${contactBId}`)
        : fail(`Agent B MISSING own contact #${contactBId}`);
      tests++;
      !ids.includes(contactAId)
        ? pass(`Agent B does NOT see Agent A's contact #${contactAId}`)
        : fail(`Agent B LEAKED Agent A's contact #${contactAId} — ownership boundary broken`);
    } catch (err) {
      console.log(`✗ Agent B request failed: ${err instanceof Error ? err.message : String(err)}`);
      failures += 2; tests += 2;
    }

    // ── Agent ?owner= override — agents must not be able to peek at other reps ──
    // The route ignores ?owner= for agents (hardcodes the logged-in email).
    // Passing another agent's email must NOT expose that agent's contacts.
    console.log("\n── Agent ?owner= override (hostile parameter) ──");
    try {
      // Agent A tries to pass Agent B's email via ?owner=
      const resA = await fetch(
        `${BASE_URL}/api/portfolio?owner=${encodeURIComponent(AGENT_B_EMAIL)}`,
        { headers: { cookie: agentACookie } }
      );
      if (resA.status !== 200) throw new Error(`HTTP ${resA.status} for Agent A ?owner=B`);
      const idsA = ((await resA.json()) as any).data.map((r: any) => r.id);

      tests++;
      !idsA.includes(contactBId)
        ? pass(`Agent A with ?owner=B cannot see Agent B's contact #${contactBId}`)
        : fail(`Agent A with ?owner=B LEAKED Agent B's contact #${contactBId} — param override not blocked`);

      // Agent B tries to pass Agent A's email via ?owner=
      const resB = await fetch(
        `${BASE_URL}/api/portfolio?owner=${encodeURIComponent(AGENT_A_EMAIL)}`,
        { headers: { cookie: agentBCookie } }
      );
      if (resB.status !== 200) throw new Error(`HTTP ${resB.status} for Agent B ?owner=A`);
      const idsB = ((await resB.json()) as any).data.map((r: any) => r.id);

      tests++;
      !idsB.includes(contactAId)
        ? pass(`Agent B with ?owner=A cannot see Agent A's contact #${contactAId}`)
        : fail(`Agent B with ?owner=A LEAKED Agent A's contact #${contactAId} — param override not blocked`);
    } catch (err) {
      console.log(`✗ Agent ?owner= override request failed: ${err instanceof Error ? err.message : String(err)}`);
      failures += 2; tests += 2;
    }

    // ── Admin cross-rep access via ?owner= filter ──────────────────────────
    // Using ?owner= avoids LIMIT 500 pagination masking fixtures in large DBs,
    // while still verifying admin can access any rep's contacts.
    console.log("\n── Admin cross-rep access ──");
    try {
      const [rowsA, rowsB] = await Promise.all([
        fetchPortfolio(adminCookie, AGENT_A_EMAIL),
        fetchPortfolio(adminCookie, AGENT_B_EMAIL),
      ]);
      const idsA = rowsA.map((r: any) => r.id);
      const idsB = rowsB.map((r: any) => r.id);

      tests++;
      idsA.includes(contactAId)
        ? pass(`Admin ?owner=A sees contact #${contactAId}`)
        : fail(`Admin ?owner=A MISSING contact #${contactAId}`);
      tests++;
      idsB.includes(contactBId)
        ? pass(`Admin ?owner=B sees contact #${contactBId}`)
        : fail(`Admin ?owner=B MISSING contact #${contactBId}`);

      // ownerEmail must be set correctly on each row.
      const rowA = rowsA.find((r: any) => r.id === contactAId);
      const rowB = rowsB.find((r: any) => r.id === contactBId);
      tests++;
      rowA?.ownerEmail === AGENT_A_EMAIL
        ? pass(`Admin row A ownerEmail correct`)
        : fail(`Admin row A ownerEmail wrong: ${rowA?.ownerEmail ?? "(not found)"}`);
      tests++;
      rowB?.ownerEmail === AGENT_B_EMAIL
        ? pass(`Admin row B ownerEmail correct`)
        : fail(`Admin row B ownerEmail wrong: ${rowB?.ownerEmail ?? "(not found)"}`);

      // Confirm admin cannot also see B in the A-only filter (sanity check).
      tests++;
      !idsA.includes(contactBId)
        ? pass(`Admin ?owner=A does NOT include Agent B's contact #${contactBId}`)
        : fail(`Admin ?owner=A LEAKED Agent B's contact #${contactBId}`);
    } catch (err) {
      console.log(`✗ Admin request failed: ${err instanceof Error ? err.message : String(err)}`);
      failures += 5; tests += 5;
    }

    // ── Manager cross-rep access via ?owner= filter ────────────────────────
    console.log("\n── Manager cross-rep access ──");
    try {
      const [rowsA, rowsB] = await Promise.all([
        fetchPortfolio(managerCookie, AGENT_A_EMAIL),
        fetchPortfolio(managerCookie, AGENT_B_EMAIL),
      ]);
      const idsA = rowsA.map((r: any) => r.id);
      const idsB = rowsB.map((r: any) => r.id);

      tests++;
      idsA.includes(contactAId)
        ? pass(`Manager ?owner=A sees contact #${contactAId}`)
        : fail(`Manager ?owner=A MISSING contact #${contactAId}`);
      tests++;
      idsB.includes(contactBId)
        ? pass(`Manager ?owner=B sees contact #${contactBId}`)
        : fail(`Manager ?owner=B MISSING contact #${contactBId}`);
      tests++;
      !idsA.includes(contactBId)
        ? pass(`Manager ?owner=A does NOT include Agent B's contact #${contactBId}`)
        : fail(`Manager ?owner=A LEAKED Agent B's contact #${contactBId}`);
    } catch (err) {
      console.log(`✗ Manager request failed: ${err instanceof Error ? err.message : String(err)}`);
      failures += 3; tests += 3;
    }

    // ── Unauthenticated guard ──────────────────────────────────────────────
    console.log("\n── Unauthenticated access ──");
    try {
      const status = await fetch(`${BASE_URL}/api/portfolio`).then(r => r.status);
      tests++;
      status === 401
        ? pass(`Anon → 401`)
        : fail(`Anon → ${status} (expected 401)`);
    } catch (err) {
      console.log(`✗ Anon request failed: ${err instanceof Error ? err.message : String(err)}`);
      failures++; tests++;
    }

  } finally {
    // Always runs — cleans up partial setup and full setup alike.
    await teardown();
    console.log("\n── Fixtures and test users deleted ──");
  }

  const passed = tests - failures;
  console.log(`\n${passed}/${tests} portfolio scoping tests passed.`);
  if (failures > 0) console.log(`\n✗ ${failures} test(s) FAILED — portfolio ownership boundary is broken.`);
  else              console.log(`\n✓ All portfolio scoping checks passed.`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(err => {
  console.error(err);
  teardown().finally(() => process.exit(1));
});
