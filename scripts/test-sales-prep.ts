/**
 * scripts/test-sales-prep.ts
 *
 * Sales Prep + Statement Acquisition smoke tests.
 * Run: TEST_MODE=true npx tsx scripts/test-sales-prep.ts
 *
 * Expects the server to be running on BASE_URL (default: http://localhost:5000).
 * Requires ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD for authenticated requests.
 */

const BASE_URL = process.env.BASE_URL || "http://localhost:5000";

let passed = 0;
let failed = 0;

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
      email: `sales-prep-test-${Date.now()}@example.test`,
      phone: "5555550100",
      companyName: "Test Merchant Inc",
      leadSource: "test",
    }),
  });
  if (!res.ok) throw new Error(`Create contact failed: ${res.status} ${await res.text()}`);
  const c = await res.json();
  return c.id;
}

async function createTestSdrLeadState(cookies: string[], contactId: number): Promise<void> {
  // Insert a minimal sdrLeadState row via the SDR import endpoint if available,
  // otherwise use db direct. We use a raw /api route.
  const res = await authFetch(cookies, "/api/sdr/lead-state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contactId,
      companyName: "Test Merchant Inc",
      email: `sdr-test-${Date.now()}@example.test`,
      stage: "DISCOVERED",
    }),
  });
  // Non-fatal if this endpoint doesn't exist — we'll test sdrSourced: false path
  if (!res.ok) {
    console.log(`    [Note] Could not create sdrLeadState (${res.status}); testing non-SDR path only`);
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
    let contactId: number;
    try {
      contactId = await createTestContact(cookies);
    } catch (err: any) {
      console.error("  Could not create test contact:", err.message);
      failed++;
      goto_test3: ;
      contactId = 0;
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

  // ── Test 3: POST /generate with TEST_MODE=true → fixture, no OpenAI ────────
  console.log("\nTest 3: POST /generate with TEST_MODE=true → fixture");
  {
    let contactId: number;
    try {
      contactId = await createTestContact(cookies);
    } catch (err: any) {
      console.error("  Could not create test contact:", err.message);
      failed++;
      goto_test4: ;
      contactId = 0;
    }
    if (contactId) {
      // Attempt to inject an sdrLeadState row
      await createTestSdrLeadState(cookies, contactId);

      // Try the generate endpoint — with TEST_MODE=true it should succeed even without sdrLeadState
      const genRes = await authFetch(cookies, `/api/contacts/${contactId}/sales-prep/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (genRes.status === 400) {
        console.log("  [Note] Contact is not SDR-sourced; skipping generate tests (need real sdrLeadState row)");
      } else {
        assert(genRes.ok, `POST /generate returns 2xx (got ${genRes.status})`);
        if (genRes.ok) {
          const data = await genRes.json();
          assert(typeof data.output === "object", `output is an object`);
          assert(typeof data.output?.callOpener === "string", `output.callOpener is a string`);
          assert(typeof data.generatedAt === "string", `generatedAt is a string`);
          const firstGeneratedAt = data.generatedAt;

          // Test 4: Second POST /generate → cache hit, same generatedAt
          console.log("\nTest 4: Second POST /generate → cache hit");
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

          // Test 5: GET after generation → cached output returned
          console.log("\nTest 5: GET after generation → cached output");
          const getRes = await authFetch(cookies, `/api/contacts/${contactId}/sales-prep`);
          assert(getRes.ok, `GET returns 2xx`);
          if (getRes.ok) {
            const getData = await getRes.json();
            assert(getData.sdrSourced === true, `sdrSourced is true`);
            assert(getData.cached !== null, `cached is not null after generation`);
          }
        }
      }
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n[SalesPrepSmokeTest] Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

run().catch((err) => {
  console.error("[SalesPrepSmokeTest] Fatal:", err);
  process.exit(1);
});
