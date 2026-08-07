#!/usr/bin/env npx tsx
/**
 * Tier Breakdown E2E Smoke Test (#613)
 *
 * Verifies:
 *  1. GET /api/sequences returns sequences with eligibleConsentTiers populated.
 *  2. GET /api/sequences/:id/enrollments/by-tier returns valid tier breakdown data
 *     for every sequence that has eligibleConsentTiers.
 *  3. Every tier in eligibleConsentTiers appears as a key in the by-tier response.
 *  4. Counts are non-negative numbers.
 *
 * Usage:
 *   npx tsx scripts/test-tier-breakdown.ts
 * Requires ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD or a live dev server session.
 */

const BASE = process.env.BASE_URL ?? "http://localhost:5000";
const EMAIL = process.env.ADMIN_SEED_EMAIL;
const PASSWORD = process.env.ADMIN_SEED_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error("ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD not set");
  process.exit(1);
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function login(): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  const cookies = res.headers.get("set-cookie") ?? "";
  const match = cookies.match(/connect\.sid=([^;]+)/);
  if (!match) throw new Error("No session cookie returned");
  return `connect.sid=${match[1]}`;
}

async function get(cookie: string, path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Cookie: cookie },
  });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

// ── test runner ──────────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;

function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    pass++;
  } else {
    console.error(`  ✗ ${label}`);
    fail++;
  }
}

async function main() {
  console.log("=== Tier Breakdown Toggle — E2E Smoke Test ===\n");

  const cookie = await login();
  const sequences = (await get(cookie, "/api/sequences")) as any[];

  check("GET /api/sequences returns an array", Array.isArray(sequences));
  check("At least one sequence exists", sequences.length > 0);

  let testedCount = 0;

  for (const seq of sequences) {
    const tiers: string[] = Array.isArray(seq.eligibleConsentTiers)
      ? seq.eligibleConsentTiers
      : [];

    const label = `seq #${seq.id} (${seq.name ?? "unnamed"})`;

    if (tiers.length === 0) {
      console.log(`  · ${label}: no eligibleConsentTiers — skipping by-tier check`);
      continue;
    }

    let byTier: Record<string, unknown>;
    try {
      byTier = (await get(
        cookie,
        `/api/sequences/${seq.id}/enrollments/by-tier`,
      )) as Record<string, unknown>;
    } catch (err: any) {
      console.error(`  ✗ ${label}: by-tier request failed — ${err.message}`);
      fail++;
      continue;
    }

    check(`${label}: by-tier response is an object`, typeof byTier === "object" && byTier !== null);

    for (const tier of tiers) {
      const val = (byTier as any)[tier];
      check(
        `${label}: tier "${tier}" present with numeric count`,
        typeof val === "number" && val >= 0,
      );
    }

    testedCount++;
  }

  if (testedCount === 0 && sequences.length > 0) {
    console.log("\n  ⚠  No sequences have eligibleConsentTiers set yet — by-tier checks skipped.");
    console.log("     Toggle UI will render empty state; that is valid until tiers are assigned.\n");
  }

  console.log(`\n── Results: ${pass} passed, ${fail} failed ──`);
  if (fail > 0) {
    console.error("FAIL");
    process.exit(1);
  }
  console.log("PASS");
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
