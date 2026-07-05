/**
 * scripts/test-sales-prep.ts
 *
 * Sales Prep + Statement Acquisition smoke tests.
 * Run: TEST_MODE=true SKIP_AI=true DRY_RUN=true npx tsx scripts/test-sales-prep.ts
 *
 * Expects the server to be running on BASE_URL (default: http://localhost:5000).
 * Requires ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD for authenticated requests.
 *
 * SDR-sourced fixture data (contacts, sdr_merchants, sdr_lead_state, contact_ai_cache)
 * is seeded and torn down directly via Drizzle against the app DB — NOT through a
 * production API route — so Tests 3-5 (generate / cache-hit / GET-after-generate)
 * actually exercise the real Sales Prep routes instead of being skipped.
 */

import { db, pool } from "../server/db";
import { contacts, sdrMerchants, sdrLeadState, contactAiCache, tasks } from "../shared/schema";
import { eq } from "drizzle-orm";

const BASE_URL = process.env.BASE_URL || "http://localhost:5000";

let passed = 0;
let failed = 0;

const createdContactIds: number[] = [];
const createdMerchantIds: number[] = [];

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

async function login(email: string, password: string): Promise<string[]> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status} ${await res.text()}`);
  const setCookieHeaders = res.headers.getSetCookie
    ? res.headers.getSetCookie()
    : [res.headers.get("set-cookie") || ""];
  return setCookieHeaders
    .map((c) => c.split(";")[0])
    .filter(Boolean);
}

async function authFetch(
  cookies: string[],
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const cookieHeader = cookies.join("; ");
  const csrfCookie = cookies.find((c) => c.startsWith("csrf_token="));
  const csrfToken = csrfCookie ? csrfCookie.split("=").slice(1).join("=") : undefined;
  const method = (options.method || "GET").toUpperCase();
  const needsCsrf = !["GET", "HEAD", "OPTIONS"].includes(method);

  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      ...options.headers,
      Cookie: cookieHeader,
      ...(needsCsrf && csrfToken ? { "x-csrf-token": csrfToken } : {}),
    },
  });
}

async function createTestContact(cookies: string[]): Promise<number> {
  const res = await authFetch(cookies, "/api/contacts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      firstName: "SalesPrep",
      lastName: "TestContact",
      email: `sales-prep-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
      phone: "5555550100",
      companyName: "Test Merchant Inc",
      leadSource: "test",
    }),
  });
  if (!res.ok) throw new Error(`Create contact failed: ${res.status} ${await res.text()}`);
  const c = await res.json();
  createdContactIds.push(c.id);
  return c.id;
}

/**
 * Seeds the DB rows required to make a contact "SDR-sourced":
 * an sdr_merchants row, then an sdr_lead_state row whose contactId
 * points at the given contact. Done via direct Drizzle inserts
 * (per task addendum) rather than any HTTP route, since no such
 * production route exists (and none should be added just for tests).
 */
async function seedSdrLeadState(contactId: number): Promise<void> {
  const uniqueTag = `sales-prep-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const [merchant] = await db
    .insert(sdrMerchants)
    .values({
      businessName: `Test Merchant Inc (${uniqueTag})`,
      source: "test-fixture",
      sourceRef: uniqueTag,
    })
    .returning();
  createdMerchantIds.push(merchant.id);

  await db.insert(sdrLeadState).values({
    merchantId: merchant.id,
    contactId,
    companyName: "Test Merchant Inc",
    email: `sdr-test-${uniqueTag}@example.test`,
    stage: "DISCOVERED",
    currentStage: "DISCOVERED",
  });
}

const FK_VIOLATION_RE = /violates foreign key constraint "[^"]+" on table "([\w]+)"/;

/**
 * Deletes a contact row, tolerating FK violations from *other* side-effect
 * tables that get populated asynchronously when a contact is created
 * (e.g. contact_created workflow actions creating tasks, lead_sources,
 * notifications, etc.). On each FK violation it looks up which column on
 * the offending table actually references contacts.id, purges the rows
 * for this contactId from that table, and retries — so cleanup stays
 * correct even as new contact-creation side effects are added elsewhere
 * in the app, without this test needing to hardcode every dependent table.
 */
async function deleteContactWithFkRetry(contactId: number): Promise<void> {
  const maxAttempts = 25;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await pool.query(`DELETE FROM contacts WHERE id = $1`, [contactId]);
      return;
    } catch (err: any) {
      const match = FK_VIOLATION_RE.exec(err.message || "");
      if (!match) throw err;
      const dependentTable = match[1];

      const colRes = await pool.query(
        `SELECT kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         JOIN information_schema.constraint_column_usage ccu
           ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
         WHERE tc.table_name = $1 AND tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = 'contacts'`,
        [dependentTable],
      );
      if (colRes.rows.length === 0) throw err;

      for (const row of colRes.rows) {
        const column = row.column_name as string;
        console.log(`  [Cleanup] Purging "${dependentTable}"."${column}" rows for contact ${contactId} before retry`);
        await pool.query(`DELETE FROM "${dependentTable}" WHERE "${column}" = $1`, [contactId]);
      }
    }
  }
  throw new Error(`Could not delete contact ${contactId} after ${maxAttempts} FK-retry attempts`);
}

async function cleanupFixtures(): Promise<void> {
  console.log("\n[Cleanup] Removing fixture rows...");
  try {
    for (const contactId of createdContactIds) {
      await db.delete(contactAiCache).where(eq(contactAiCache.contactId, contactId));
    }
    for (const contactId of createdContactIds) {
      await db.delete(sdrLeadState).where(eq(sdrLeadState.contactId, contactId));
    }
    for (const merchantId of createdMerchantIds) {
      await db.delete(sdrMerchants).where(eq(sdrMerchants.id, merchantId));
    }
    // Contact-creation workflows (triggerWorkflowsByEvent("contact_created")) may
    // asynchronously create task rows tied to the fixture contact; clear those
    // proactively (the common case), then fall back to the generic FK-retry
    // deletion below for any other side-effect tables.
    for (const contactId of createdContactIds) {
      await db.delete(tasks).where(eq(tasks.contactId, contactId));
    }
    for (const contactId of createdContactIds) {
      await deleteContactWithFkRetry(contactId);
    }
    console.log(
      `[Cleanup] Done — removed ${createdContactIds.length} contact(s), ${createdMerchantIds.length} sdr_merchants row(s), and associated sdr_lead_state/contact_ai_cache rows.`,
    );
  } catch (err: any) {
    console.error("[Cleanup] Failed:", err.message);
    throw err;
  }
}

async function run() {
  console.log(`\n[SalesPrepSmokeTest] Starting against ${BASE_URL}\n`);

  const adminEmail = process.env.ADMIN_SEED_EMAIL;
  const adminPassword = process.env.ADMIN_SEED_PASSWORD;

  if (!adminEmail || !adminPassword) {
    console.error(
      "ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD must be set.\n" +
      "  ADMIN_SEED_EMAIL=admin@example.com ADMIN_SEED_PASSWORD=secret npx tsx scripts/test-sales-prep.ts",
    );
    process.exit(1);
  }

  // ── Test 1: Unauthenticated GET → 401 ──────────────────────────────────────
  console.log("Test 1: Unauthenticated GET /api/contacts/1/sales-prep → 401");
  {
    const res = await fetch(`${BASE_URL}/api/contacts/1/sales-prep`);
    assert(res.status === 401, `status is 401 (got ${res.status})`);
  }

  // ── Login ──────────────────────────────────────────────────────────────────
  let cookies: string[];
  try {
    cookies = await login(adminEmail, adminPassword);
    console.log("\nAdmin login: OK\n");
  } catch (err: any) {
    console.error("Admin login failed:", err.message);
    process.exit(1);
  }

  // ── Test 2: Non-SDR contact → sdrSourced: false ────────────────────────────
  console.log("Test 2: Non-SDR contact GET → { sdrSourced: false }");
  {
    let contactId = 0;
    try {
      contactId = await createTestContact(cookies);
    } catch (err: any) {
      console.error("  Could not create test contact:", err.message);
      failed++;
    }
    if (contactId) {
      const res = await authFetch(cookies, `/api/contacts/${contactId}/sales-prep`);
      assert(res.ok, `GET returns 2xx (got ${res.status})`);
      if (res.ok) {
        const data = await res.json();
        assert(data.sdrSourced === false, `sdrSourced is false`);
        assert(data.cached === null, `cached is null`);
        assert(data.canGenerate === false, `canGenerate is false`);
      }
    }
  }

  // ── Test 3/4/5: SDR-sourced contact → generate / cache-hit / GET ──────────
  console.log("\nTest 3: SDR-sourced contact GET → sdrSourced: true");
  {
    let contactId = 0;
    try {
      contactId = await createTestContact(cookies);
      await seedSdrLeadState(contactId);
    } catch (err: any) {
      console.error("  Could not seed SDR-sourced test fixture:", err.message);
      failed++;
    }

    if (contactId) {
      const sdrCheckRes = await authFetch(cookies, `/api/contacts/${contactId}/sales-prep`);
      assert(sdrCheckRes.ok, `GET returns 2xx (got ${sdrCheckRes.status})`);
      if (sdrCheckRes.ok) {
        const sdrCheckData = await sdrCheckRes.json();
        assert(sdrCheckData.sdrSourced === true, `sdrSourced is true`);
      }

      console.log("\nTest 4: POST /generate with TEST_MODE=true → fixture");
      const genRes = await authFetch(cookies, `/api/contacts/${contactId}/sales-prep/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      assert(genRes.ok, `POST /generate returns 2xx (got ${genRes.status})`);
      if (genRes.ok) {
        const data = await genRes.json();
        assert(typeof data.output === "object" && data.output !== null, `output is a non-null object`);
        assert(typeof data.output?.callOpener === "string", `output.callOpener is a string`);
        assert(typeof data.generatedAt === "string", `generatedAt is a string`);
        const firstGeneratedAt = data.generatedAt;

        // Second POST /generate → cache hit, same generatedAt
        console.log("\nTest 5: Second POST /generate → cache hit");
        const gen2Res = await authFetch(cookies, `/api/contacts/${contactId}/sales-prep/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        assert(gen2Res.ok, `second POST /generate returns 2xx`);
        if (gen2Res.ok) {
          const data2 = await gen2Res.json();
          assert(data2.fromCache === true, `fromCache is true on second call`);
          assert(data2.generatedAt === firstGeneratedAt, `generatedAt matches first call (cache hit)`);
        }

        // GET after generation → cached output returned
        console.log("\nTest 6: GET after generation → cached output");
        const getRes = await authFetch(cookies, `/api/contacts/${contactId}/sales-prep`);
        assert(getRes.ok, `GET returns 2xx`);
        if (getRes.ok) {
          const getData = await getRes.json();
          assert(getData.sdrSourced === true, `sdrSourced is true`);
          assert(getData.cached !== null, `cached is not null after generation`);
        }
      } else {
        console.error(`  [Error] POST /generate failed unexpectedly (${genRes.status}): ${await genRes.text()}`);
      }
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n[SalesPrepSmokeTest] Results: ${passed} passed, ${failed} failed`);
}

run()
  .catch((err) => {
    console.error("[SalesPrepSmokeTest] Fatal:", err);
    failed++;
  })
  .finally(async () => {
    try {
      await cleanupFixtures();
    } catch {
      // cleanupFixtures already logs its own failure; still exit with failure code below.
      failed++;
    } finally {
      process.exit(failed > 0 ? 1 : 0);
    }
  });
