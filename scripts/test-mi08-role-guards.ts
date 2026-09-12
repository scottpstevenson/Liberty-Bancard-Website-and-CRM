#!/usr/bin/env tsx
/**
 * MI-08 operator UI smoke checks.
 *
 * Run with the application server up:
 *   ADMIN_SEED_EMAIL=... ADMIN_SEED_PASSWORD=... npx tsx scripts/test-mi08-role-guards.ts
 */
import bcrypt from "bcryptjs";
import { db, pool } from "../server/db";
import { users } from "../shared/models/auth";
import { eq, sql } from "drizzle-orm";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:5000";
const ADMIN_EMAIL = process.env.ADMIN_SEED_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_SEED_PASSWORD;
const AGENT_EMAIL = process.env.MI08_AGENT_EMAIL ?? "mi08-role-agent@libertybancard.test";
const AGENT_PASSWORD = process.env.MI08_AGENT_PASSWORD ?? "mi08-agent-pw-R7!q2";

let passed = 0;
let failed = 0;
function assert(label: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

async function ensureAgent() {
  const passwordHash = await bcrypt.hash(AGENT_PASSWORD, 12);
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, AGENT_EMAIL));
  if (existing.length) {
    await db.update(users).set({
      passwordHash, role: "agent", authProvider: "local", emailVerified: new Date(),
    }).where(eq(users.email, AGENT_EMAIL));
  } else {
    await db.insert(users).values({
      email: AGENT_EMAIL, firstName: "MI08", lastName: "Agent",
      passwordHash, role: "agent", authProvider: "local", emailVerified: new Date(),
    });
  }
}

async function login(email: string, password: string): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (response.status !== 200) throw new Error(`Login failed (${response.status}): ${await response.text()}`);
  const headers = response.headers as unknown as { getSetCookie?: () => string[] };
  const cookies = (typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : [response.headers.get("set-cookie") ?? ""])
    .map((cookie) => cookie.split(";")[0].trim()).filter(Boolean);
  if (!cookies.length) throw new Error(`No session cookie returned for ${email}`);
  return cookies.join("; ");
}

/** Insert a minimal canonical business for testing and return its id. */
async function seedTestBusiness(): Promise<number> {
  const ts = Date.now();
  const result = await db.execute(sql`
    INSERT INTO businesses (
      canonical_name, normalized_name, record_class, website_domain,
      email_discovery_status, free_enrichment_status, created_at, updated_at
    )
    VALUES (
      ${'MI08 Test Business ' + ts}, ${'mi08 test business ' + ts},
      'canonical', ${'mi08test' + ts + '.example.com'},
      'no_valid_candidate', NULL, NOW(), NOW()
    )
    RETURNING id
  `);
  const rows = (result as any).rows ?? result;
  const id = Number(rows[0]?.id);
  if (!id) throw new Error("Failed to seed test business");
  return id;
}

async function deleteTestBusiness(id: number) {
  // Delete FK-constrained children before the business row itself.
  await db.execute(sql`DELETE FROM master_leads WHERE canonical_business_id = ${id}`);
  await db.execute(sql`DELETE FROM canonical_source_links WHERE business_id = ${id}`);
  await db.execute(sql`DELETE FROM field_route_stops WHERE business_id = ${id}`).catch(() => {});
  await db.execute(sql`DELETE FROM businesses WHERE id = ${id}`);
}

async function main() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error("ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD are required");
  }
  await ensureAgent();
  const adminCookie = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const agentCookie = await login(AGENT_EMAIL, AGENT_PASSWORD);

  // ── Seed a test business so detail checks always run ────────────────────────
  const seededId = await seedTestBusiness();
  console.log(`  ℹ  Seeded test business #${seededId}`);

  try {
    // ── Business list ──────────────────────────────────────────────────────────
    const list = await fetch(`${BASE_URL}/api/lead-ops/businesses?limit=1`, {
      headers: { Cookie: adminCookie },
    });
    const listBody = await list.json();
    assert("Admin can list canonical businesses", list.status === 200, `status=${list.status}`);
    const businessId = listBody.businesses?.[0]?.id ?? seededId;

    // ── Business detail — admin role ───────────────────────────────────────────
    const detail = await fetch(`${BASE_URL}/api/lead-ops/businesses/${businessId}`, {
      headers: { Cookie: adminCookie },
    });
    const body = await detail.json();
    assert("Admin business detail is allowed", detail.status === 200, `status=${detail.status}`);
    assert("Admin detail includes email and phone fields", detail.status === 200
      && Object.prototype.hasOwnProperty.call(body.business ?? {}, "main_email")
      && Object.prototype.hasOwnProperty.call(body.business ?? {}, "main_phone"));
    assert("Detail response has conflictEvidenceAvailable field",
      detail.status === 200 && typeof body.conflictEvidenceAvailable === "boolean");
    assert("Detail response has contactMatchAvailable field",
      detail.status === 200 && typeof body.contactMatchAvailable === "boolean");
    assert("Detail safeNextAction is a string",
      detail.status === 200 && typeof body.safeNextAction === "string");

    // ── Business detail — agent role (must be blocked) ─────────────────────────
    const agentDetail = await fetch(`${BASE_URL}/api/lead-ops/businesses/${businessId}`, {
      headers: { Cookie: agentCookie },
    });
    assert("Agent is blocked from business detail", agentDetail.status === 403, `status=${agentDetail.status}`);

    // ── Master lead database deep link ─────────────────────────────────────────
    const deepLink = await fetch(`${BASE_URL}/dashboard/master-lead-database`, {
      headers: { Cookie: adminCookie },
    });
    assert("Master lead database deep link resolves", deepLink.status >= 200 && deepLink.status < 400, `status=${deepLink.status}`);

    // ── Health endpoint ────────────────────────────────────────────────────────
    const healthResponse = await fetch(`${BASE_URL}/api/lead-ops/health`, {
      headers: { Cookie: adminCookie },
    });
    const health = await healthResponse.json();
    assert("Health endpoint is available", healthResponse.status === 200, `status=${healthResponse.status}`);
    const heartbeats = Object.values(health.workerHeartbeats ?? {}) as Array<Record<string, unknown>>;
    assert("Worker heartbeats are present", heartbeats.length > 0);
    assert("Each worker heartbeat has available", heartbeats.every((entry) => typeof entry.available === "boolean"));
    assert("Stale heartbeat includes staleSince", heartbeats.every((entry) => entry.stale !== true || Boolean(entry.staleSince)));

    // Queue depth has per-metric structure
    const freeQ = (health.freeEnrichQueueDepth ?? {});
    assert("Free enrich queue depth has per-metric structure",
      typeof freeQ.free === "object" && freeQ.free !== null && typeof freeQ.free.available === "boolean",
      JSON.stringify(freeQ.free));
    assert("Paid enrich queue depth has per-metric structure",
      typeof freeQ.paid === "object" && freeQ.paid !== null && typeof freeQ.paid.available === "boolean",
      JSON.stringify(freeQ.paid));

    // ── Fail-closed safe-action derivation ────────────────────────────────────
    assert("Detail contactMatchAvailable defaults to boolean (not null)",
      typeof body.contactMatchAvailable === "boolean",
      `got: ${typeof body.contactMatchAvailable}`);
    // A non-staged business (our seeded one) should not return ready_to_promote.
    assert("Non-staged business does not return ready_to_promote",
      body.safeNextAction !== "ready_to_promote",
      `safeNextAction=${body.safeNextAction}`);

    // ── Lifecycle precedence: promoted/suppressed must be terminal ─────────────
    // Seed a promoted master_lead tied to our test business, check safeNextAction.
    // We simulate using the existing detail endpoint with a business that has
    // provider_valid email but is promoted — must return already_promoted, not
    // run_email_discovery or run_free_enrichment.
    {
      // Create a promoted master_lead for the seeded business
      const insertResult = await db.execute(sql`
        INSERT INTO master_leads (
          canonical_business_id, pipeline_origin, status, fit_tier, quality_score,
          county_fips, created_at, updated_at
        ) VALUES (
          ${seededId}, 'cro03_pipeline', 'promoted', 'B', 70,
          '12086', NOW(), NOW()
        ) RETURNING id
      `);
      const mlRows = (insertResult as any).rows ?? insertResult;
      const mlId = Number(mlRows[0]?.id);
      if (mlId) {
        const promotedDetail = await fetch(`${BASE_URL}/api/lead-ops/businesses/${seededId}`, {
          headers: { Cookie: adminCookie },
        });
        const promotedBody = await promotedDetail.json();
        assert("Promoted lead returns already_promoted (lifecycle takes precedence)",
          promotedBody.safeNextAction === "already_promoted",
          `safeNextAction=${promotedBody.safeNextAction}`);
        // Cleanup
        await db.execute(sql`DELETE FROM master_leads WHERE id = ${mlId}`);
      }
    }
    {
      // Create a suppressed master_lead for the seeded business
      const insertResult2 = await db.execute(sql`
        INSERT INTO master_leads (
          canonical_business_id, pipeline_origin, status, fit_tier, quality_score,
          county_fips, created_at, updated_at
        ) VALUES (
          ${seededId}, 'cro03_pipeline', 'suppressed', 'D', 20,
          '12086', NOW(), NOW()
        ) RETURNING id
      `);
      const mlRows2 = (insertResult2 as any).rows ?? insertResult2;
      const mlId2 = Number(mlRows2[0]?.id);
      if (mlId2) {
        const suppressedDetail = await fetch(`${BASE_URL}/api/lead-ops/businesses/${seededId}`, {
          headers: { Cookie: adminCookie },
        });
        const suppressedBody = await suppressedDetail.json();
        assert("Suppressed lead returns suppressed_no_action (lifecycle takes precedence)",
          suppressedBody.safeNextAction === "suppressed_no_action",
          `safeNextAction=${suppressedBody.safeNextAction}`);
        // Cleanup
        await db.execute(sql`DELETE FROM master_leads WHERE id = ${mlId2}`);
      }
    }

    // ── Budget-preview endpoint ────────────────────────────────────────────────
    const budgetResp = await fetch(`${BASE_URL}/api/lead-ops/budget-preview`, {
      headers: { Cookie: adminCookie },
    });
    const budgetBody = await budgetResp.json();
    assert("Budget preview endpoint returns 200", budgetResp.status === 200, `status=${budgetResp.status}`);
    assert("Budget preview has available field", typeof budgetBody.available === "boolean");
    // When no approved policy with policy_key=cro03c_live_activation exists, must return available:false — never a fabricated price.
    if (!budgetBody.available) {
      assert("Budget preview available:false means no prices array", !Array.isArray(budgetBody.prices));
    } else {
      assert("Budget preview available:true has prices array", Array.isArray(budgetBody.prices));
    }
    // Agent blocked
    const agentBudget = await fetch(`${BASE_URL}/api/lead-ops/budget-preview`, {
      headers: { Cookie: agentCookie },
    });
    assert("Agent is blocked from budget preview", agentBudget.status === 403, `status=${agentBudget.status}`);

    // ── Routing-preview policy_key scoping ───────────────────────────────────
    const routeResp = await fetch(`${BASE_URL}/api/lead-ops/businesses/${seededId}/routing-preview`, {
      headers: { Cookie: adminCookie },
    });
    const routeBody = await routeResp.json();
    assert("Routing preview returns 200", routeResp.status === 200, `status=${routeResp.status}`);
    assert("Routing preview has routePlan field", typeof routeBody.routePlan === "object");
    // Pricing in routing-preview must be from canonical policy_key=cro03c_live_activation.
    // If pricing is returned, it must have available field.
    assert("Routing preview pricing has available field",
      routeBody.pricing === undefined || typeof routeBody.pricing.available === "boolean",
      JSON.stringify(routeBody.pricing));

    // ── Business verticals endpoint ────────────────────────────────────────────
    const verticalsResp = await fetch(`${BASE_URL}/api/lead-ops/business-verticals`, {
      headers: { Cookie: adminCookie },
    });
    const verticalsBody = await verticalsResp.json();
    assert("Business verticals endpoint returns 200", verticalsResp.status === 200, `status=${verticalsResp.status}`);
    assert("Business verticals has verticals array", Array.isArray(verticalsBody.verticals));
    const agentVerticals = await fetch(`${BASE_URL}/api/lead-ops/business-verticals`, {
      headers: { Cookie: agentCookie },
    });
    assert("Agent is blocked from business verticals", agentVerticals.status === 403, `status=${agentVerticals.status}`);

  } finally {
    // ── Cleanup seeded business ──────────────────────────────────────────────
    await deleteTestBusiness(seededId);
    console.log(`  ℹ  Cleaned up test business #${seededId}`);
  }

  console.log(`\nMI-08 checks: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`MI-08 test failed: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}).finally(async () => {
  await pool.end().catch(() => {});
});
