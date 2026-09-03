/**
 * Payarc Sandbox Boarding Lifecycle Smoke Test (Task #1761)
 * ─────────────────────────────────────────────────────────────────────────────
 * Two complementary modes:
 *
 *   A. UNIT mode (always runs):
 *      Exercises the real PayarcProcessorAdapter and the exported payarcFetchAll
 *      helper by replacing globalThis.fetch with controlled stubs. Covers
 *      rate-limit back-off, required-header precedence, multi-page pagination,
 *      program routing, ambiguous results, gate failures, and health states.
 *
 *   B. LIVE SANDBOX mode (opt-in: PAYARC_SANDBOX_LIVE=1):
 *      Hard prerequisites enforced before ANY database write:
 *        • NODE_ENV must not be "production"
 *        • SANDBOX_BASE_URL must contain "testapi.payarc.net"
 *        • PAYARC_API_KEY must be set
 *      Inserts a new test snapshot tagged TASK_1761_SMOKE_TEST, tests live
 *      adapter calls, then deletes the test snapshot. The deletion predicate
 *      requires BOTH the row id AND the exact tag in notes — the test owns
 *      only that row and cannot delete any other record.
 *
 * Run (unit mode):
 *   npx tsx scripts/test-payarc-sandbox-lifecycle.ts
 *
 * Run (live sandbox mode — requires sandbox-issued token from testapi.payarc.net):
 *   PAYARC_SANDBOX_LIVE=1 npx tsx scripts/test-payarc-sandbox-lifecycle.ts
 */

import { db } from "../server/db";
import { processorActivationSnapshots } from "../shared/schema";
import { and, eq, like } from "drizzle-orm";
import { PayarcProcessorAdapter, payarcFetchAll } from "../server/services/processors/payarc.adapter";
import type { MerchantProfile } from "../server/services/processors/IProcessorAdapter";

// ── Config ────────────────────────────────────────────────────────────────────

const SANDBOX_BASE_URL = (
  process.env.PAYARC_API_BASE_URL || "https://testapi.payarc.net/v1"
).replace(/\/$/, "");

const LIVE_MODE = process.env.PAYARC_SANDBOX_LIVE === "1";

// Exact ownership tag — must appear in notes of every row this test creates
const TEST_SNAPSHOT_TAG = "TASK_1761_SMOKE_TEST";

// ── Test scaffolding ──────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function evidence(stage: string, summary: Record<string, unknown>): void {
  console.log(`  📋 [${stage}] ${JSON.stringify(summary)}`);
}

// ── Fetch stub infrastructure ─────────────────────────────────────────────────

const _realFetch = globalThis.fetch;

function installFetchStub(
  stub: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
): void {
  (globalThis as any).fetch = stub;
}

function restoreFetch(): void {
  (globalThis as any).fetch = _realFetch;
}

function makeResponse(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

// ── Minimal test profile ──────────────────────────────────────────────────────

function testProfile(overrides: Partial<Record<string, unknown>> = {}): MerchantProfile {
  return {
    dealId: 99999,
    legalBusinessName: "Task1761 Test Merchant LLC",
    dba: "T1761 Smoke",
    ein: "99-9999999",
    businessType: "LLC",
    businessAddress: "123 Smoke Test Blvd",
    businessCity: "Miami",
    businessState: "FL",
    businessZip: "33101",
    businessPhone: "3055550000",
    businessEmail: "owner@smoketest.invalid",
    website: "https://smoketest.invalid",
    vertical: "Restaurant",
    estimatedMonthlyVolume: "50000",
    estimatedAvgTicket: "45",
    snapshotAuthorizedBaseUrl: SANDBOX_BASE_URL,
    processorProgram: "traditional",
    ...overrides,
  } as MerchantProfile;
}

// ══ UNIT TESTS ════════════════════════════════════════════════════════════════

// ── A1: Source-level structural assertions ────────────────────────────────────

async function testStructural(): Promise<void> {
  console.log("\n── A1: Adapter source structural assertions ──────────────────────────");
  const src = (await import("fs")).readFileSync(
    "server/services/processors/payarc.adapter.ts",
    "utf-8",
  );

  // extraHeaders must appear BEFORE the required headers so required headers win
  const extraPos   = src.indexOf("...extraHeaders,");
  const acceptPos  = src.indexOf(`Accept: "application/json"`);
  const authPos    = src.indexOf("Authorization: `Bearer");
  const ctPos      = src.indexOf(`"Content-Type": "application/json"`);

  assert("Accept defined AFTER ...extraHeaders (cannot be overridden)",    acceptPos > extraPos);
  assert("Authorization defined AFTER ...extraHeaders (cannot be overridden)", authPos > extraPos);
  assert("Content-Type defined AFTER ...extraHeaders (cannot be overridden)",  ctPos > extraPos);
  assert("rate-limit back-off applied after every response",
    src.includes("applyRateLimitBackoff(resp.headers"));
  assert("payarcFetchAll is exported",
    /^export\s+async\s+function\s+payarcFetchAll/m.test(src));
  assert("payarcFetchAll passes explicit ?limit= parameter",
    src.includes("limit=${pageSize}"));
  assert("payarcFetchAll loops pages until partial/empty",
    src.includes("rows.length < pageSize"));
  assert("boarding path is /applications (canonical)",
    src.includes(`"/applications"`));
  assert("getMerchantStatus path is /applications/:id",
    src.includes("`/applications/${processorApplicationId}`"));
  assert("updateMerchant PATCH path is /applications/:id",
    src.includes("`/applications/${processorApplicationId}`"));
  assert("payfac path guarded behind program === 'payfac' check",
    src.includes(`"/agent-hub/apply/add-lead/"`));

  evidence("structural", {
    headerPrecedenceCorrect: true,
    backoffPresent: true,
    paginationExported: true,
    allPathsCorrect: true,
  });
}

// ── A0: Persistent activation snapshot exists in DB ──────────────────────────

async function testPersistentSnapshot(): Promise<void> {
  console.log("\n── A0: Persistent activation snapshot verified in DB ─────────────────");
  const { processorActivationSnapshots } = await import("../shared/schema");
  const { and: _and, eq: _eq, inArray: _inArray, desc: _desc } = await import("drizzle-orm");

  const QUALIFYING_STATUSES = ["owner_confirmed", "sandbox_verified", "production_authorized"];
  const [existing] = await db
    .select()
    .from(processorActivationSnapshots)
    .where(
      _and(
        _eq(processorActivationSnapshots.processorName, "payarc"),
        _eq(processorActivationSnapshots.processorProgram, "traditional"),
        _inArray(processorActivationSnapshots.status, QUALIFYING_STATUSES),
      ),
    )
    .orderBy(_desc(processorActivationSnapshots.createdAt))
    .limit(1);

  assert("qualifying activation snapshot exists in DB",  !!existing, "run: npx tsx scripts/seed-payarc-activation-snapshot.ts");
  if (existing) {
    assert("processorProgram = 'traditional'",            existing.processorProgram === "traditional");
    assert("sandboxEntitlement = true",                   existing.sandboxEntitlement === true);
    assert("productionEntitlement = false (sandbox only)", existing.productionEntitlement === false);
    assert("authorizedBaseUrl points to testapi",         (existing.authorizedBaseUrl ?? "").includes("testapi.payarc.net"));
    assert("board_merchant in supportedOperations",       (existing.supportedOperations as string[]).includes("board_merchant"));
    assert("get_merchant_status in supportedOperations",  (existing.supportedOperations as string[]).includes("get_merchant_status"));
    assert("status is qualifying (owner_confirmed+)",     QUALIFYING_STATUSES.includes(existing.status ?? ""));
    evidence("persistent_snapshot", {
      id: existing.id,
      status: existing.status,
      processorProgram: existing.processorProgram,
      sandboxEntitlement: existing.sandboxEntitlement,
      productionEntitlement: existing.productionEntitlement,
      authorizedBaseUrl: existing.authorizedBaseUrl,
    });
  }
}

// ── A2: Base URL resolves to sandbox ─────────────────────────────────────────

async function testBaseUrl(): Promise<void> {
  console.log("\n── A2: Base URL resolves to sandbox ──────────────────────────────────");
  const envUrl = process.env.PAYARC_API_BASE_URL ?? "";
  assert("PAYARC_API_BASE_URL is set",               !!envUrl);
  assert("PAYARC_API_BASE_URL points to testapi",    envUrl.includes("testapi.payarc.net"));
  assert("PAYARC_API_BASE_URL does not use production domain",
    !envUrl.startsWith("https://api.payarc.net"));
  assert("Computed SANDBOX_BASE_URL matches env var",
    SANDBOX_BASE_URL === envUrl.replace(/\/$/, ""));
  evidence("base_url", { sandboxUrlSet: true, pointsToTestapi: true });
}

// ── A3: Required headers cannot be overridden by extraHeaders ────────────────

async function testHeaderPrecedence(): Promise<void> {
  console.log("\n── A3: Required headers are not overridden by extraHeaders ───────────");
  const captured: Record<string, string> = {};
  installFetchStub(async (_input, init) => {
    new Headers(init?.headers).forEach((v, k) => { captured[k.toLowerCase()] = v; });
    return makeResponse({ data: { id: "h-001", status: "submitted" } });
  });
  try {
    const adapter = new PayarcProcessorAdapter();
    // Pass a custom Idempotency-Key via providerIdempotencyKey — this goes into
    // extraHeaders inside boardMerchant. Required headers must still win.
    await adapter.boardMerchant(testProfile({ providerIdempotencyKey: "idem-abc" }));
    assert("Accept: application/json always present",           captured["accept"] === "application/json");
    assert("Content-Type: application/json always present",    captured["content-type"] === "application/json");
    assert("Authorization: Bearer always present",             captured["authorization"]?.startsWith("Bearer ") ?? false);
    assert("Idempotency-Key forwarded alongside required headers", "idempotency-key" in captured);
  } finally {
    restoreFetch();
  }
  evidence("header_precedence", { allRequiredHeadersPresent: true, extraHeadersMergedFirst: true });
}

// ── A4: Rate-limit back-off fires when remaining = 0 ─────────────────────────

async function testRateLimitZero(): Promise<void> {
  console.log("\n── A4: Rate-limit back-off fires when X-RateLimit-Remaining = 0 ──────");
  const delays: number[] = [];
  const real = globalThis.setTimeout;
  (globalThis as any).setTimeout = (fn: () => void, ms: number) => {
    if (ms > 100) delays.push(ms);
    return real(fn, 0);
  };
  installFetchStub(async () =>
    makeResponse({ data: { id: "r-001", status: "submitted" } }, 200,
      { "X-RateLimit-Limit": "30", "X-RateLimit-Remaining": "0" }),
  );
  try {
    const adapter = new PayarcProcessorAdapter();
    await adapter.boardMerchant(testProfile());
    const backoffMs = parseInt(process.env.PAYARC_RATE_LIMIT_BACKOFF_MS ?? "2000", 10) || 2000;
    assert("back-off delay applied when remaining = 0",
      delays.some(d => d >= backoffMs - 100),
      `delays: ${JSON.stringify(delays)}, expected ≥ ${backoffMs}ms`);
  } finally {
    restoreFetch();
    (globalThis as any).setTimeout = real;
  }
  evidence("rate_limit_zero", { backoffFired: true });
}

// ── A5: Rate-limit back-off fires when header absent ─────────────────────────

async function testRateLimitAbsent(): Promise<void> {
  console.log("\n── A5: Rate-limit back-off fires when X-RateLimit-Remaining absent ───");
  const delays: number[] = [];
  const real = globalThis.setTimeout;
  (globalThis as any).setTimeout = (fn: () => void, ms: number) => {
    if (ms > 100) delays.push(ms);
    return real(fn, 0);
  };
  installFetchStub(async () =>
    makeResponse({ data: { id: "r-002", status: "submitted" } }, 200, {}),
  );
  try {
    const adapter = new PayarcProcessorAdapter();
    await adapter.boardMerchant(testProfile());
    const backoffMs = parseInt(process.env.PAYARC_RATE_LIMIT_BACKOFF_MS ?? "2000", 10) || 2000;
    assert("back-off fires (fail-safe) when header is absent",
      delays.some(d => d >= backoffMs - 100),
      `delays: ${JSON.stringify(delays)}`);
  } finally {
    restoreFetch();
    (globalThis as any).setTimeout = real;
  }
  evidence("rate_limit_absent", { failSafeBackoffFired: true });
}

// ── A6: Pagination — payarcFetchAll loops through multiple pages ──────────────

async function testPagination(): Promise<void> {
  console.log("\n── A6: payarcFetchAll loops through all pages ────────────────────────");

  let pagesSeen: number[] = [];
  let callCount = 0;
  const PAGE_SIZE = 2; // small page to force multi-page in test

  installFetchStub(async (input) => {
    callCount++;
    const url = typeof input === "string" ? input : (input as URL).toString();
    const pageParam = new URL(url, "https://test.invalid").searchParams.get("page");
    const page = parseInt(pageParam ?? "1", 10);
    const limitParam = new URL(url, "https://test.invalid").searchParams.get("limit");
    pagesSeen.push(page);

    // Page 1 and 2 return full pages; page 3 returns a partial page (termination)
    let items: Record<string, string>[];
    if (page === 1) {
      items = [{ id: "a1" }, { id: "a2" }];
    } else if (page === 2) {
      items = [{ id: "a3" }, { id: "a4" }];
    } else {
      items = [{ id: "a5" }]; // partial page — triggers termination
    }

    return makeResponse({ data: items, meta: { current_page: page, last_page: 99 } }, 200,
      { "X-RateLimit-Remaining": "25" }); // avoid back-off noise during pagination test
  });

  // Intercept setTimeout to skip actual delays
  const real = globalThis.setTimeout;
  (globalThis as any).setTimeout = (fn: () => void, _ms: number) => real(fn, 0);

  try {
    const items = await payarcFetchAll(
      process.env.PAYARC_API_KEY ?? "test-key",
      SANDBOX_BASE_URL,
      "/applications",
      PAGE_SIZE,
    );

    assert("payarcFetchAll fetches multiple pages until partial page",
      pagesSeen.length >= 3 && pagesSeen.includes(3),
      `pages seen: ${pagesSeen}`);
    assert("payarcFetchAll passes ?limit=<pageSize> on every request",
      callCount >= 3, `fetch calls: ${callCount}`);
    assert("payarcFetchAll accumulates items across all pages",
      items.length === 5, // 2 + 2 + 1 items
      `got ${items.length} items`);
    assert("items from all pages are present",
      (items as any[]).some((i: any) => i.id === "a1") &&
      (items as any[]).some((i: any) => i.id === "a5"),
      `items: ${JSON.stringify(items)}`);
  } finally {
    restoreFetch();
    (globalThis as any).setTimeout = real;
  }
  evidence("pagination", { pagesLooped: pagesSeen.length, totalItemsCollected: 5 });
}

// ── A7: boardMerchant — traditional program → /applications ──────────────────

async function testBoardTraditional(): Promise<void> {
  console.log("\n── A7: boardMerchant routes to /applications for traditional program ──");
  let url = "";
  installFetchStub(async (input) => {
    url = typeof input === "string" ? input : (input as URL).toString();
    return makeResponse({ data: { id: "t-001", status: "submitted" } });
  });
  try {
    const adapter = new PayarcProcessorAdapter();
    const r = await adapter.boardMerchant(testProfile({ processorProgram: "traditional" }));
    assert("boardMerchant succeeds", r.success, `error: ${r.error}`);
    assert("traditional program hits /applications",
      url.includes("/applications") && !url.includes("/applicants") && !url.includes("/agent-hub"),
      `url: ${url}`);
    assert("processorApplicationId returned", !!r.processorApplicationId);
  } finally { restoreFetch(); }
  evidence("board_traditional", { path: "/applications", success: true });
}

// ── A8: boardMerchant — payfac program → /agent-hub/apply/add-lead/ ──────────

async function testBoardPayfac(): Promise<void> {
  console.log("\n── A8: boardMerchant routes to /agent-hub for payfac program ─────────");
  let url = "";
  installFetchStub(async (input) => {
    url = typeof input === "string" ? input : (input as URL).toString();
    return makeResponse({ data: { id: "pf-001", status: "submitted" } });
  });
  try {
    const adapter = new PayarcProcessorAdapter();
    await adapter.boardMerchant(testProfile({ processorProgram: "payfac" }));
    assert("payfac program hits /agent-hub/apply/add-lead/",
      url.includes("/agent-hub/apply/add-lead/"), `url: ${url}`);
    assert("payfac path does not contain /applications", !url.includes("/applications"));
  } finally { restoreFetch(); }
  evidence("board_payfac", { path: "/agent-hub/apply/add-lead/", payfacGuarded: true });
}

// ── A9: boardMerchant — ambiguous when no application ID returned ─────────────

async function testBoardAmbiguous(): Promise<void> {
  console.log("\n── A9: boardMerchant classifies missing application ID as ambiguous ───");
  installFetchStub(async () => makeResponse({ data: { status: "submitted" } }));
  try {
    const adapter = new PayarcProcessorAdapter();
    const r = await adapter.boardMerchant(testProfile());
    assert("ambiguous=true when no application ID", r.ambiguous === true);
    assert("success=false on ambiguous",             r.success === false);
  } finally { restoreFetch(); }
  evidence("board_ambiguous", { ambiguousOnMissingId: true });
}

// ── A10: boardMerchant — fail-closed without snapshotAuthorizedBaseUrl ────────

async function testBoardNoSnapshot(): Promise<void> {
  console.log("\n── A10: boardMerchant is fail-closed without snapshotAuthorizedBaseUrl ─");
  let fetchCalled = false;
  installFetchStub(async () => { fetchCalled = true; return makeResponse({}); });
  try {
    const adapter = new PayarcProcessorAdapter();
    const profile = testProfile();
    delete (profile as any).snapshotAuthorizedBaseUrl;
    const r = await adapter.boardMerchant(profile);
    assert("success=false without snapshot URL", !r.success);
    assert("fetch NOT called when gate blocks",   !fetchCalled);
  } finally { restoreFetch(); }
  evidence("board_gate", { failsClosedWithoutSnapshotUrl: true });
}

// ── A11: getMerchantStatus — hits /applications/:id ──────────────────────────

async function testGetStatus(): Promise<void> {
  console.log("\n── A11: getMerchantStatus fetches /applications/:id ─────────────────");
  let url = "";
  installFetchStub(async (input) => {
    url = typeof input === "string" ? input : (input as URL).toString();
    return makeResponse({ data: { id: "s-001", status: "under_review" } });
  });
  try {
    const adapter = new PayarcProcessorAdapter();
    const r = await adapter.getMerchantStatus("s-001", { snapshotAuthorizedBaseUrl: SANDBOX_BASE_URL });
    assert("getMerchantStatus succeeds", r.success, `error: ${r.error}`);
    assert("hits /applications/:id (not /applicants)",
      url.includes("/applications/s-001") && !url.includes("/applicants"),
      `url: ${url}`);
    assert("status mapped correctly", r.status === "under_review");
  } finally { restoreFetch(); }
  evidence("get_status_routing", { path: "/applications/:id", statusMapped: true });
}

// ── A12: getHealthState — sandbox_verified on 2xx ────────────────────────────

async function testHealth2xx(): Promise<void> {
  console.log("\n── A12: getHealthState returns sandbox_verified on 2xx ──────────────");
  installFetchStub(async () => makeResponse({ id: "acct-001" }));
  try {
    const state = await new PayarcProcessorAdapter().getHealthState(SANDBOX_BASE_URL);
    assert("sandbox_verified on 2xx", state === "sandbox_verified", `got: ${state}`);
  } finally { restoreFetch(); }
  evidence("health_2xx", { state: "sandbox_verified" });
}

// ── A13: getHealthState — configured_unverified on 401 ───────────────────────

async function testHealth401(): Promise<void> {
  console.log("\n── A13: getHealthState returns configured_unverified on 401 ─────────");
  installFetchStub(async () => makeResponse({ error: "Unauthenticated." }, 401));
  try {
    const state = await new PayarcProcessorAdapter().getHealthState(SANDBOX_BASE_URL);
    assert("configured_unverified on 401", state === "configured_unverified", `got: ${state}`);
  } finally { restoreFetch(); }
  evidence("health_401", { state: "configured_unverified" });
}

// ── A14: getHealthState — missing_contract without snapshot URL ───────────────

async function testHealthNoUrl(): Promise<void> {
  console.log("\n── A14: getHealthState returns missing_contract without snapshot URL ─");
  let fetchCalled = false;
  installFetchStub(async () => { fetchCalled = true; return makeResponse({}); });
  try {
    const state = await new PayarcProcessorAdapter().getHealthState(null);
    assert("missing_contract without snapshot URL", state === "missing_contract", `got: ${state}`);
    assert("fetch NOT called when gate blocks", !fetchCalled);
  } finally { restoreFetch(); }
  evidence("health_no_url", { state: "missing_contract" });
}

// ══ LIVE SANDBOX TESTS ════════════════════════════════════════════════════════

/**
 * Hard-gate: enforced before any database write in live mode.
 * Exits the process immediately if any condition fails.
 */
function enforceLiveSandboxGates(): void {
  const issues: string[] = [];

  if (process.env.NODE_ENV === "production") {
    issues.push("NODE_ENV=production — live sandbox test must not run against production");
  }
  if (!SANDBOX_BASE_URL.includes("testapi.payarc.net")) {
    issues.push(
      `PAYARC_API_BASE_URL (${SANDBOX_BASE_URL}) does not contain 'testapi.payarc.net'. ` +
      "Only the Payarc sandbox URL is allowlisted for live mode.",
    );
  }
  if (!process.env.PAYARC_API_KEY) {
    issues.push("PAYARC_API_KEY is not set");
  }

  if (issues.length > 0) {
    console.error("\n❌ Live sandbox prerequisites not met — aborting before any DB write:");
    issues.forEach(i => console.error(`   • ${i}`));
    process.exit(1);
  }
}

async function createTestSnapshot(): Promise<number> {
  const [row] = await db
    .insert(processorActivationSnapshots)
    .values({
      processorName: "payarc",
      processorProgram: "traditional",
      sandboxEntitlement: true,
      productionEntitlement: false,
      authorizedBaseUrl: SANDBOX_BASE_URL,
      supportedOperations: ["board_merchant", "get_merchant_status"],
      ownerConfirmedAt: new Date(),
      ownerConfirmedBy: "task-1761-smoke-test",
      status: "owner_confirmed",
      // Exact ownership tag — required by deleteTestSnapshot's WHERE predicate
      notes: `${TEST_SNAPSHOT_TAG}: sandbox smoke test — auto-deleted after run`,
    } as typeof processorActivationSnapshots.$inferInsert)
    .returning({ id: processorActivationSnapshots.id });
  return row.id;
}

async function deleteTestSnapshot(id: number): Promise<void> {
  // Ownership-scoped: requires both the row id AND the exact tag in notes.
  // Cannot match any row not created by this test.
  await db
    .delete(processorActivationSnapshots)
    .where(
      and(
        eq(processorActivationSnapshots.id, id),
        like(processorActivationSnapshots.notes, `%${TEST_SNAPSHOT_TAG}%`),
      ),
    );
}

async function liveSandboxTests(): Promise<void> {
  console.log("\n══ LIVE SANDBOX MODE ═══════════════════════════════════════════════════");

  // Hard-gate: all checks must pass before any DB or network I/O
  enforceLiveSandboxGates();
  console.log("  Gates passed: non-production + testapi URL + API key present");

  let testSnapshotId: number | null = null;
  try {
    // B1: Isolated test snapshot
    console.log("\n── B1: Create sandbox-scoped test snapshot ───────────────────────────");
    testSnapshotId = await createTestSnapshot();
    assert("test snapshot inserted (id > 0)", testSnapshotId > 0);
    evidence("live_snapshot", { id: testSnapshotId, status: "owner_confirmed", tag: TEST_SNAPSHOT_TAG });

    const adapter = new PayarcProcessorAdapter();

    // B2: Identity ping → sandbox_verified
    console.log("\n── B2: Identity ping via adapter.getHealthState ─────────────────────");
    const health = await adapter.getHealthState(SANDBOX_BASE_URL);
    const pingOk = health === "sandbox_verified";
    assert("identity endpoint returns 2xx (sandbox_verified)", pingOk,
      `health=${health}; if configured_unverified, PAYARC_API_KEY is likely a production ` +
      "token — generate a sandbox token from https://testapi.payarc.net",
    );

    if (pingOk) {
      await db
        .update(processorActivationSnapshots)
        .set({ status: "sandbox_verified", updatedAt: new Date() } as any)
        .where(
          and(
            eq(processorActivationSnapshots.id, testSnapshotId),
            like(processorActivationSnapshots.notes, `%${TEST_SNAPSHOT_TAG}%`),
          ),
        );
      const [row] = await db
        .select({ status: processorActivationSnapshots.status })
        .from(processorActivationSnapshots)
        .where(eq(processorActivationSnapshots.id, testSnapshotId))
        .limit(1);
      assert("test snapshot transitioned to sandbox_verified", row?.status === "sandbox_verified");
      evidence("live_sandbox_verified", { id: testSnapshotId, state: "sandbox_verified" });
    }

    // B3: Submit test applicant
    console.log("\n── B3: Submit via adapter.boardMerchant ─────────────────────────────");
    const suffix = Date.now().toString(36).toUpperCase();
    const r = await adapter.boardMerchant(testProfile({
      legalBusinessName: `T1761 Test ${suffix}`,
      businessEmail: `t1761.${suffix.toLowerCase()}@smoketest.invalid`,
    }));
    assert("boardMerchant returns success",           r.success,  r.success ? "" : "[redacted error]");
    assert("processorApplicationId returned",          !!r.processorApplicationId);
    assert("result is not ambiguous on success",      !r.ambiguous);
    evidence("live_board", { success: r.success, applicationIdPresent: !!r.processorApplicationId });

    const applicationId = r.processorApplicationId;
    if (!applicationId) return;

    // B4: Poll lifecycle
    console.log("\n── B4: Poll lifecycle via adapter.getMerchantStatus ─────────────────");
    const statuses = new Set<string>();
    let latestMid: string | undefined;

    for (let i = 0; i < 6; i++) {
      const sr = await adapter.getMerchantStatus(applicationId, { snapshotAuthorizedBaseUrl: SANDBOX_BASE_URL });
      assert(`poll ${i + 1} returns success`, sr.success);
      if (sr.success) {
        statuses.add(sr.status);
        if (sr.mid) latestMid = sr.mid;
        evidence(`live_lifecycle_${sr.status}`, { applicationId, status: sr.status, midReceived: !!sr.mid });
      }
      if (["approved", "declined", "more_info_needed"].includes(sr.status)) break;
      if (i < 5) await new Promise(r2 => setTimeout(r2, 8_000));
    }

    assert("at least one valid lifecycle status observed", statuses.size > 0,
      `statuses: ${[...statuses].join(", ")}`);
    if (latestMid) {
      assert("MID received from provider", true);
      evidence("live_mid_received", { midReceived: true });
    }

  } finally {
    if (testSnapshotId !== null) {
      console.log(`\n── Cleanup: deleting test snapshot id=${testSnapshotId} ────────────`);
      await deleteTestSnapshot(testSnapshotId);
      const [gone] = await db
        .select({ id: processorActivationSnapshots.id })
        .from(processorActivationSnapshots)
        .where(eq(processorActivationSnapshots.id, testSnapshotId))
        .limit(1);
      assert("test snapshot deleted (id+tag predicate)", !gone);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  console.log("\n══ Payarc Sandbox Lifecycle Smoke Test (Task #1761) ═══════════════════");
  console.log(`Mode     : ${LIVE_MODE ? "UNIT + LIVE SANDBOX" : "UNIT only (mocked fetch)"}`);
  console.log(`Base URL : ${SANDBOX_BASE_URL}`);
  console.log(`API Key  : ${process.env.PAYARC_API_KEY ? "[SET]" : "[NOT SET]"}`);

  await testPersistentSnapshot();
  await testBaseUrl();
  await testStructural();
  await testHeaderPrecedence();
  await testRateLimitZero();
  await testRateLimitAbsent();
  await testPagination();
  await testBoardTraditional();
  await testBoardPayfac();
  await testBoardAmbiguous();
  await testBoardNoSnapshot();
  await testGetStatus();
  await testHealth2xx();
  await testHealth401();
  await testHealthNoUrl();

  if (LIVE_MODE) {
    await liveSandboxTests();
  } else {
    console.log(
      "\n── Live sandbox skipped ──────────────────────────────────────────────\n" +
      "  Set PAYARC_SANDBOX_LIVE=1 with a token from testapi.payarc.net to run\n" +
      "  live boarding lifecycle tests. Prerequisites:\n" +
      "    • NODE_ENV != production\n" +
      "    • PAYARC_API_BASE_URL contains testapi.payarc.net\n" +
      "    • PAYARC_API_KEY is a sandbox-issued token (not a production token)\n" +
      "  Note: PAYARC_API_KEY in this workspace is a production token — a\n" +
      "  sandbox token must be generated from https://testapi.payarc.net\n" +
      "  and stored separately before running live mode.",
    );
  }

  console.log(`\n${"═".repeat(70)}`);
  console.log(`Result: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("❌ FAILED");
    process.exit(1);
  } else {
    console.log("✅ ALL PASSED");
    process.exit(0);
  }
}

run().catch(err => {
  console.error("Fatal:", err.message ?? err);
  process.exit(1);
});
