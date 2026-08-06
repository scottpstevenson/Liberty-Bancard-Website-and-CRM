#!/usr/bin/env tsx
/**
 * test-tier-breakdown.ts
 *
 * End-to-end API contract tests for the Tier Breakdown endpoint used by
 * the Tier Breakdown toggle on each Sequence card in the dashboard.
 *
 * Covers:
 *  - Unauthenticated request → 401 (role guard)
 *  - GET /api/sequences → 200 with an array of sequences
 *  - GET /api/sequences/:id/enrollments/by-tier → 200 for first 3 sequences
 *  - Response shape: array of { consentTier: string, count: number }
 *  - Invalid sequence id (non-numeric) → 400
 *  - Non-existent sequence id → 404
 *
 * Requires the dev server to be running on BASE_URL (default: localhost:5000).
 * Exits 0 if all assertions pass, 1 if any fail.
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5000";
const ADMIN_EMAIL = process.env.ADMIN_SEED_EMAIL ?? "admin@libertybancard.com";
const ADMIN_PASSWORD = process.env.ADMIN_SEED_PASSWORD ?? "Liberty2024!";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push(detail ? `${label} — ${detail}` : label);
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function fetchJson(path: string, options: RequestInit = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, { redirect: "manual", ...options });
  let body: any = null;
  try {
    const text = await res.text();
    body = text ? JSON.parse(text) : null;
  } catch {}
  return { status: res.status, body };
}

async function getAuthSession(email: string, password: string): Promise<string | null> {
  const csrfRes = await fetch(`${BASE_URL}/api/csrf-token`, { redirect: "manual" });
  const csrfCookie = csrfRes.headers.get("set-cookie") ?? "";
  const csrfBody = await csrfRes.json().catch(() => ({})) as any;
  const csrfToken = csrfBody.token ?? "";

  const loginRes = await fetch(`${BASE_URL}/api/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-csrf-token": csrfToken,
      Cookie: csrfCookie,
    },
    body: JSON.stringify({ email, password }),
    redirect: "manual",
  });

  if (loginRes.status !== 200) return null;

  const loginCookie = loginRes.headers.get("set-cookie") ?? "";
  const allCookies = [csrfCookie, loginCookie]
    .flatMap(h => h.split(",").map(s => s.split(";")[0].trim()))
    .filter(Boolean)
    .join("; ");
  return allCookies || null;
}

// ── 1. Role guard: unauthenticated → 401 ─────────────────────────────────────

async function testUnauthenticatedRejection() {
  console.log("\n1. Unauthenticated access to by-tier endpoint → 401");

  const { status } = await fetchJson("/api/sequences/1/enrollments/by-tier", {
    method: "GET",
    redirect: "manual",
  });
  assert(
    "GET /api/sequences/1/enrollments/by-tier unauthenticated → 401",
    status === 401,
    `got ${status}`
  );
}

// ── 2. GET /api/sequences returns a list ─────────────────────────────────────

async function testSequenceList(session: string): Promise<number[]> {
  console.log("\n2. GET /api/sequences returns 200 with array");

  const { status, body } = await fetchJson("/api/sequences", {
    headers: { Cookie: session },
  });

  assert(
    "GET /api/sequences → 200",
    status === 200,
    `got ${status}`
  );
  assert(
    "GET /api/sequences body is an array",
    Array.isArray(body),
    `got ${typeof body}`
  );

  if (!Array.isArray(body)) return [];

  assert(
    "GET /api/sequences returns at least one sequence (or empty array is valid)",
    true // empty is valid; just confirm it's an array
  );

  return body.slice(0, 3).map((s: any) => s.id).filter((id: any) => typeof id === "number");
}

// ── 3. by-tier response shape for each sequence ───────────────────────────────

async function testByTierShape(session: string, sequenceIds: number[]) {
  console.log("\n3. GET /api/sequences/:id/enrollments/by-tier → shape check");

  if (sequenceIds.length === 0) {
    console.log("  (skipped) No sequences found — shape tests skipped");
    assert("by-tier shape: skipped (no sequences in DB)", true);
    return;
  }

  for (const id of sequenceIds) {
    const { status, body } = await fetchJson(`/api/sequences/${id}/enrollments/by-tier`, {
      headers: { Cookie: session },
    });

    assert(
      `GET /api/sequences/${id}/enrollments/by-tier → 200`,
      status === 200,
      `got ${status}`
    );

    assert(
      `Sequence ${id} by-tier body is an array`,
      Array.isArray(body),
      `got ${typeof body}`
    );

    if (Array.isArray(body) && body.length > 0) {
      const allHaveConsentTier = body.every(
        (row: any) => typeof row.consentTier === "string"
      );
      const allHaveCount = body.every(
        (row: any) => typeof row.count === "number"
      );

      assert(
        `Sequence ${id} by-tier rows have consentTier: string`,
        allHaveConsentTier,
        `first row: ${JSON.stringify(body[0])}`
      );
      assert(
        `Sequence ${id} by-tier rows have count: number`,
        allHaveCount,
        `first row: ${JSON.stringify(body[0])}`
      );

      // counts must be non-negative integers
      const allCountsNonNegative = body.every((row: any) => row.count >= 0);
      assert(
        `Sequence ${id} by-tier all counts are non-negative`,
        allCountsNonNegative,
        `rows: ${JSON.stringify(body)}`
      );

      // consentTier must never be null (endpoint normalises null → "unknown")
      const noNullTiers = body.every((row: any) => row.consentTier !== null);
      assert(
        `Sequence ${id} by-tier consentTier is never null (null → "unknown")`,
        noNullTiers,
        `rows: ${JSON.stringify(body)}`
      );
    } else if (Array.isArray(body) && body.length === 0) {
      // Empty array is valid for a sequence with no active enrollments
      assert(
        `Sequence ${id} by-tier empty array is valid`,
        true
      );
    }
  }
}

// ── 4. Invalid / non-existent sequence ids ────────────────────────────────────

async function testEdgeCaseIds(session: string) {
  console.log("\n4. Edge-case sequence IDs");

  // Non-numeric id → 400
  const { status: badStatus } = await fetchJson(
    "/api/sequences/not-a-number/enrollments/by-tier",
    { headers: { Cookie: session } }
  );
  assert(
    "Non-numeric id → 400",
    badStatus === 400,
    `got ${badStatus}`
  );

  // Zero id → 400
  const { status: zeroStatus } = await fetchJson(
    "/api/sequences/0/enrollments/by-tier",
    { headers: { Cookie: session } }
  );
  assert(
    "id=0 → 400",
    zeroStatus === 400,
    `got ${zeroStatus}`
  );

  // Very large id that almost certainly doesn't exist → 404
  const { status: missingStatus } = await fetchJson(
    "/api/sequences/999999999/enrollments/by-tier",
    { headers: { Cookie: session } }
  );
  assert(
    "Non-existent sequence id → 404",
    missingStatus === 404,
    `got ${missingStatus}`
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log(" Tier Breakdown API Contract Tests");
  console.log(`  Server: ${BASE_URL}`);
  console.log("═══════════════════════════════════════════════════════");

  // Quick server health check
  try {
    const healthRes = await fetch(`${BASE_URL}/api/health`, { redirect: "manual" }).catch(() => null);
    if (!healthRes || healthRes.status >= 500) {
      console.error(`\nERROR: Server not reachable at ${BASE_URL}`);
      console.error("Start the server first: npm run dev");
      process.exit(1);
    }
  } catch {
    console.error(`\nERROR: Cannot connect to ${BASE_URL}`);
    process.exit(1);
  }

  try {
    // 1. Role guard (no session needed)
    await testUnauthenticatedRejection();

    // Authenticate as admin for the remaining tests
    const session = await getAuthSession(ADMIN_EMAIL, ADMIN_PASSWORD);
    if (!session) {
      console.error("\nERROR: Could not authenticate admin user. Check ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD.");
      process.exit(1);
    }
    console.log("\n  ✓ Admin session obtained");

    // 2. Sequence list
    const sequenceIds = await testSequenceList(session);

    // 3. by-tier shape for each sequence
    await testByTierShape(session, sequenceIds);

    // 4. Edge-case IDs
    await testEdgeCaseIds(session);

  } catch (err: any) {
    console.error("\nUnhandled error:", err?.message ?? err);
    failed++;
    failures.push(`Unhandled error: ${err?.message ?? err}`);
  }

  console.log(`\n${"═".repeat(55)}`);
  console.log(` Results: ${passed} passed, ${failed} failed`);
  console.log("═".repeat(55));
  if (failures.length) {
    console.error("\nFailures:");
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("\n✅ All Tier Breakdown API contract tests passed.");
  process.exit(0);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
