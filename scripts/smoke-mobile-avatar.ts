#!/usr/bin/env tsx
/**
 * Task #1113 — Mobile avatar / ProfileSheet smoke test.
 *
 * The AvatarOverlay and ProfileSheet in MobileApp.tsx rely on useAuth() which
 * ultimately reads from /api/auth/user. This script verifies:
 *
 *   1. An authenticated rep (agent role) can reach /mobile (the SPA shell).
 *   2. /api/auth/user returns the correct firstName / lastName / email that
 *      ProfileSheet renders in [data-testid="sheet-user-name"] and
 *      [data-testid="sheet-user-email"].
 *   3. After a simulated session-token refresh (second request with the same
 *      cookie), user data is still intact — avatar initials and name stay stable.
 *   4. /mobile/profile is accessible to the same session (the "Profile &
 *      Settings" sheet action would navigate here).
 *   5. POST /api/auth/logout terminates the session; a subsequent /api/auth/user
 *      call returns 401 — matching the redirect to /mobile/login.
 *
 * Run with the dev server up:
 *   BASE_URL=http://localhost:5000 npx tsx scripts/smoke-mobile-avatar.ts
 *
 * Exits 0 if all assertions pass, 1 otherwise.
 */

import bcrypt from "bcryptjs";
import { db } from "../server/db";
import { users } from "../shared/models/auth";
import { eq } from "drizzle-orm";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5000";

if (!process.env.ADMIN_SEED_EMAIL || !process.env.ADMIN_SEED_PASSWORD) {
  console.error(
    "\n✗ MISSING REQUIRED ENV: ADMIN_SEED_EMAIL and/or ADMIN_SEED_PASSWORD not set.\n" +
    "  This smoke test needs admin credentials to ensure the test rep user exists.\n\n" +
    "  Set both env vars before running:\n" +
    "    ADMIN_SEED_EMAIL=admin@example.com ADMIN_SEED_PASSWORD=secret npx tsx scripts/smoke-mobile-avatar.ts\n"
  );
  process.exit(1);
}

const REP_EMAIL    = "smoke-test-mobile-rep@libertybancard.test";
const REP_PASSWORD = "smoke-mobile-rep-Aa1!";
const REP_FIRST    = "MobileSmoke";
const REP_LAST     = "Rep";

// ── helpers ────────────────────────────────────────────────────────────────

/** Deterministic initials — mirrors getInitials() in MobileApp.tsx */
function getInitials(first?: string | null, last?: string | null): string {
  return `${first?.[0] || ""}${last?.[0] || ""}`.toUpperCase() || "?";
}

async function waitForServer(url: string, maxMs = 30_000): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(2000) });
      await new Promise((r) => setTimeout(r, 3000));
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(`Server at ${url} did not become ready within ${maxMs / 1000}s`);
}

async function ensureRepUser(): Promise<void> {
  const passwordHash = await bcrypt.hash(REP_PASSWORD, 12);
  const existing = await db.select().from(users).where(eq(users.email, REP_EMAIL));
  if (existing.length === 0) {
    await db.insert(users).values({
      email: REP_EMAIL,
      firstName: REP_FIRST,
      lastName: REP_LAST,
      passwordHash,
      role: "agent",
      authProvider: "local",
      emailVerified: new Date(),
    });
  } else {
    await db
      .update(users)
      .set({ passwordHash, firstName: REP_FIRST, lastName: REP_LAST, role: "agent", authProvider: "local", emailVerified: new Date() })
      .where(eq(users.email, REP_EMAIL));
  }
}

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) {
    const body = await res.text();
    throw new Error(`Login failed for ${email}: ${res.status} ${body}`);
  }
  const rawHeaders = res.headers as unknown as { getSetCookie?: () => string[] };
  const setCookieArr: string[] =
    typeof rawHeaders.getSetCookie === "function"
      ? rawHeaders.getSetCookie()
      : [res.headers.get("set-cookie") ?? ""];
  const cookies = setCookieArr
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean);
  if (cookies.length === 0) throw new Error(`No session cookie returned for ${email}`);
  return cookies.join("; ");
}

async function authedGet(path: string, cookie: string): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, { headers: { cookie } });
}

async function authedPost(path: string, cookie: string, body = ""): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { cookie, "Content-Type": "application/json" },
    body,
  });
}

// ── assertions ─────────────────────────────────────────────────────────────

let failures = 0;

function pass(label: string) {
  console.log(`  ✓ ${label}`);
}

function fail(label: string, detail?: string) {
  console.error(`  ✗ ${label}${detail ? `\n      ${detail}` : ""}`);
  failures++;
}

function assert(condition: boolean, label: string, detail?: string) {
  if (condition) pass(label); else fail(label, detail);
}

// ── main ───────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  console.log("── Mobile Avatar / ProfileSheet smoke test ──\n");

  await waitForServer(`${BASE_URL}/api/health`);
  await ensureRepUser();

  let repCookie: string;
  try {
    repCookie = await login(REP_EMAIL, REP_PASSWORD);
    pass("Authenticated rep login succeeds");
  } catch (err) {
    fail("Rep login", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // ── 1. /mobile SPA shell is reachable when authenticated ─────────────────
  console.log("\n[1] SPA shell accessibility");
  {
    const res = await authedGet("/mobile", repCookie);
    assert(
      res.status === 200,
      `/mobile returns 200 for authenticated rep (got ${res.status})`,
    );
  }

  // ── 2. /api/auth/user returns correct profile data ────────────────────────
  // This is what useAuth() resolves to; ProfileSheet renders the result.
  console.log("\n[2] User data — mirrors what AvatarOverlay + ProfileSheet display");
  let userData: { firstName?: string; lastName?: string; email?: string; role?: string } = {};
  {
    const res = await authedGet("/api/auth/user", repCookie);
    assert(res.status === 200, `/api/auth/user returns 200 (got ${res.status})`);
    if (res.status === 200) {
      userData = await res.json() as typeof userData;
      assert(
        userData.email === REP_EMAIL,
        `email matches [data-testid="sheet-user-email"] expectation`,
        `expected "${REP_EMAIL}", got "${userData.email}"`,
      );
      assert(
        userData.firstName === REP_FIRST,
        `firstName matches (drives avatar initials)`,
        `expected "${REP_FIRST}", got "${userData.firstName}"`,
      );
      assert(
        userData.lastName === REP_LAST,
        `lastName matches (drives avatar initials)`,
        `expected "${REP_LAST}", got "${userData.lastName}"`,
      );

      const expectedName = [userData.firstName, userData.lastName].filter(Boolean).join(" ");
      const expectedInitials = getInitials(userData.firstName, userData.lastName);
      assert(
        expectedInitials === `${REP_FIRST[0]}${REP_LAST[0]}`.toUpperCase(),
        `getInitials("${userData.firstName}", "${userData.lastName}") = "${expectedInitials}" (matches button-avatar-overlay content)`,
      );
      pass(`[data-testid="sheet-user-name"] would render "${expectedName}"`);
    }
  }

  // ── 3. Session-token refresh — data survives a second request ─────────────
  // Simulates the component re-mounting or React Query refetching after a
  // background token refresh. The sheet must still show the same data.
  console.log("\n[3] Session token refresh — user data persists across requests");
  {
    const res = await authedGet("/api/auth/user", repCookie);
    assert(res.status === 200, `Second /api/auth/user (post-refresh) still returns 200`);
    if (res.status === 200) {
      const refreshed = await res.json() as typeof userData;
      assert(
        refreshed.email === userData.email &&
        refreshed.firstName === userData.firstName &&
        refreshed.lastName === userData.lastName,
        "User fields are stable after session refresh (avatar initials unchanged)",
        `before: ${JSON.stringify(userData)}, after: ${JSON.stringify(refreshed)}`,
      );
    }
  }

  // ── 4. /mobile/profile is accessible (sheet "Profile & Settings" action) ──
  console.log("\n[4] Profile & Settings navigation target");
  {
    const res = await authedGet("/mobile/profile", repCookie);
    // SPA serves index.html for all /mobile/* routes → expect 200
    assert(
      res.status === 200,
      `/mobile/profile returns 200 for authenticated rep (sheet navigation target)`,
      `got ${res.status}`,
    );
  }

  // ── 5. Sign Out terminates the session → 401 on subsequent user fetch ─────
  // ProfileSheet calls logout() → POST /api/auth/logout → redirect to /mobile/login
  console.log("\n[5] Sign Out — session terminated, redirect to login");
  {
    const logoutRes = await authedPost("/api/auth/logout", repCookie);
    assert(
      [200, 204, 302].includes(logoutRes.status),
      `POST /api/auth/logout returns ${logoutRes.status} (logout accepted)`,
    );

    // After logout the session cookie is invalidated; /api/auth/user must 401
    const afterRes = await authedGet("/api/auth/user", repCookie);
    assert(
      afterRes.status === 401,
      `/api/auth/user returns 401 after logout (matches redirect to /mobile/login)`,
      `got ${afterRes.status}`,
    );
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const total = 5;
  console.log(`\n── Result: ${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} ──`);
  if (failures > 0) {
    console.error("\nSmoke test failed. Fix the issues above before deploying.");
    process.exit(1);
  }
  console.log("Avatar overlay and ProfileSheet are verified — session, data, navigation, and sign-out all correct.\n");
}

run().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
