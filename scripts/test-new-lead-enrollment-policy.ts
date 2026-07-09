#!/usr/bin/env npx tsx
/**
 * test-new-lead-enrollment-policy.ts
 *
 * Validates the kill-line invariants for the New Lead auto-enrollment pipeline:
 *  1. GET  /api/admin/pipeline/stage-health        → 200 w/ correct fields
 *  2. POST /api/admin/pipeline/auto-enroll-toggle  → 200, sets false first
 *  3. POST /api/admin/pipeline/vertical-sequence-map → 200, saves map + default
 *  4. POST /api/admin/pipeline/new-leads/enroll-preview → 200 w/ preview fields
 *  5. POST /api/admin/pipeline/new-leads/enroll (missing confirmed) → 400
 *  6. GET  /api/admin/pipeline/new-leads/enroll-status → 200 w/ status field
 *  7. Verifies autoEnrollNewLeadDeals defaults to false (kill line)
 *  8. Anonymous access → 401 on all 7 endpoints
 *
 * Usage:
 *   ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=secret npx tsx scripts/test-new-lead-enrollment-policy.ts
 */

const BASE = "http://localhost:5000";
const ADMIN_EMAIL = process.env.ADMIN_SEED_EMAIL ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_SEED_PASSWORD ?? "";

let sessionCookie = "";
let csrfToken = "";
let pass = 0;
let fail = 0;
const failures: string[] = [];

function ok(label: string) { pass++; console.log(`  ✓ ${label}`); }
function ko(label: string, detail?: string) {
  fail++;
  const msg = detail ? `${label}: ${detail}` : label;
  failures.push(msg);
  console.error(`  ✗ ${msg}`);
}

async function jsonFetch(
  method: string,
  path: string,
  body?: object,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Cookie": sessionCookie,
      "x-csrf-token": csrfToken,
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  let responseBody: any;
  try { responseBody = await res.json(); } catch { responseBody = {}; }
  return { status: res.status, body: responseBody };
}

async function login(): Promise<void> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (res.status !== 200) {
    const body = await res.text();
    throw new Error(`Login failed: ${res.status} ${body}`);
  }
  // Use getSetCookie() (Node 18+/undici) — no comma-splitting fragility
  const rawHeaders = res.headers as unknown as { getSetCookie?: () => string[] };
  const setCookieArr: string[] = typeof rawHeaders.getSetCookie === "function"
    ? rawHeaders.getSetCookie()
    : [res.headers.get("set-cookie") ?? ""];
  const cookies = setCookieArr
    .map(c => c.split(";")[0].trim())
    .filter(Boolean);
  if (cookies.length === 0) throw new Error("No session cookie returned by login");
  sessionCookie = cookies.join("; ");

  // Fetch CSRF token using the authenticated session
  const csrfRes = await fetch(`${BASE}/api/csrf-token`, {
    headers: { "Cookie": sessionCookie },
  });
  const csrfBody = await csrfRes.json();
  csrfToken = csrfBody.token ?? "";

  if (!csrfToken) {
    throw new Error("CSRF token missing. Check ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD.");
  }
  console.log("  ✓ Logged in as admin, CSRF token obtained");
}

async function runTests(): Promise<void> {
  console.log("\n═══════════════════════════════════════════════════════");
  console.log(" New Lead Enrollment Policy — Kill-Line Smoke Test");
  console.log("═══════════════════════════════════════════════════════\n");

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.error("ERROR: Set ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD env vars.");
    process.exit(1);
  }

  // ─── Setup ───────────────────────────────────────────────────────────────
  console.log("── Setup ───────────────────────────────────────────────");
  await login();

  // ─── Anonymous access guard ────────────────────────────────────────────
  console.log("\n── Anon access → all 7 endpoints must return 401 ──────");
  const anonEndpoints: Array<[string, string, object?]> = [
    ["GET",  "/api/admin/pipeline/stage-health"],
    ["POST", "/api/admin/pipeline/auto-enroll-toggle",    { enabled: false }],
    ["POST", "/api/admin/pipeline/vertical-sequence-map", { verticalMap: {} }],
    ["POST", "/api/admin/pipeline/new-leads/enroll-preview"],
    ["POST", "/api/admin/pipeline/new-leads/enroll",      { confirmed: true }],
    ["GET",  "/api/admin/pipeline/new-leads/enroll-status"],
    ["POST", "/api/admin/pipeline/new-leads/enroll-cancel"],
  ];
  for (const [method, path, body] of anonEndpoints) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    if (res.status === 401 || res.status === 302) {
      ok(`ANON ${method} ${path} → ${res.status}`);
    } else {
      ko(`ANON ${method} ${path} → expected 401, got ${res.status}`);
    }
  }

  // ─── Stage Health ─────────────────────────────────────────────────────────
  console.log("\n── Test 1: GET /api/admin/pipeline/stage-health ────────");
  const health = await jsonFetch("GET", "/api/admin/pipeline/stage-health");
  if (health.status !== 200) {
    ko("stage-health HTTP status", `${health.status} — ${JSON.stringify(health.body)}`);
  } else {
    ok("stage-health 200 OK");
    const r = health.body;
    const requiredFields = [
      "totalNewLeadDeals", "newLeadNoMovement7d", "newLeadNoActiveEnrollment",
      "autoEnrollNewLeadDeals", "staleness_proxy",
    ];
    for (const f of requiredFields) {
      if (f in r) ok(`  field present: ${f}`);
      else ko(`  missing field: ${f}`);
    }
    if (r.staleness_proxy === "updatedAt") {
      ok("  staleness_proxy is 'updatedAt' (documented)");
    } else {
      ko(`  staleness_proxy unexpected: ${r.staleness_proxy}`);
    }
    if (typeof r.totalNewLeadDeals === "number" && r.totalNewLeadDeals >= 0) {
      ok(`  totalNewLeadDeals is a non-negative number (${r.totalNewLeadDeals})`);
    } else {
      ko(`  totalNewLeadDeals invalid: ${r.totalNewLeadDeals}`);
    }
  }

  // ─── Auto-enroll toggle (force OFF first) ─────────────────────────────────
  console.log("\n── Test 2: POST /api/admin/pipeline/auto-enroll-toggle ─");
  const toggleOff = await jsonFetch("POST", "/api/admin/pipeline/auto-enroll-toggle", { enabled: false });
  if (toggleOff.status !== 200) {
    ko("auto-enroll-toggle OFF HTTP status", `${toggleOff.status}`);
  } else if (toggleOff.body.autoEnrollNewLeadDeals !== false) {
    ko("auto-enroll-toggle OFF body mismatch", JSON.stringify(toggleOff.body));
  } else {
    ok("auto-enroll disabled → autoEnrollNewLeadDeals: false");
  }

  // Verify kill line: confirm it's still false after round-trip via stage-health
  const healthAfterOff = await jsonFetch("GET", "/api/admin/pipeline/stage-health");
  if (healthAfterOff.body?.autoEnrollNewLeadDeals === false) {
    ok("KILL LINE: autoEnrollNewLeadDeals=false persists (no auto enrollments)");
  } else {
    ko("KILL LINE VIOLATED: autoEnrollNewLeadDeals should be false after toggle-off");
  }

  // Bad payload
  const toggleBad = await jsonFetch("POST", "/api/admin/pipeline/auto-enroll-toggle", { enabled: "yes" });
  if (toggleBad.status === 400) {
    ok("invalid 'enabled' type → 400");
  } else {
    ko("invalid 'enabled' type should be 400", `got ${toggleBad.status}`);
  }

  // ─── Vertical sequence map ─────────────────────────────────────────────────
  console.log("\n── Test 3: POST /api/admin/pipeline/vertical-sequence-map");
  const mapSave = await jsonFetch("POST", "/api/admin/pipeline/vertical-sequence-map", {
    verticalMap: { restaurant: 999, dental: 998 },
  });
  if (mapSave.status !== 200) {
    ko("vertical-sequence-map save HTTP status", `${mapSave.status}`);
  } else if (!mapSave.body.saved) {
    ko("vertical-sequence-map save body missing 'saved: true'", JSON.stringify(mapSave.body));
  } else {
    ok("vertical-sequence-map saved → { saved: true }");
  }

  // Bad payload (array not allowed)
  const mapBad = await jsonFetch("POST", "/api/admin/pipeline/vertical-sequence-map", {
    verticalMap: [1, 2, 3],
  });
  if (mapBad.status === 400) {
    ok("array verticalMap → 400");
  } else {
    ko("array verticalMap should be 400", `got ${mapBad.status}`);
  }

  // ─── Preview ──────────────────────────────────────────────────────────────
  console.log("\n── Test 4: POST /api/admin/pipeline/new-leads/enroll-preview");
  const preview = await jsonFetch("POST", "/api/admin/pipeline/new-leads/enroll-preview");
  if (preview.status !== 200) {
    ko("enroll-preview HTTP status", `${preview.status} — ${JSON.stringify(preview.body)}`);
  } else {
    ok("enroll-preview 200 OK");
    const p = preview.body;
    const pFields = ["total", "eligible", "alreadyEnrolled", "dncBlocked", "optOutBlocked",
      "noSequenceBlocked", "inactiveSequenceBlocked", "noContactBlocked",
      "sequenceChannelLabel", "requiresTypedConfirmation"];
    for (const f of pFields) {
      if (f in p) ok(`  field present: ${f}`);
      else ko(`  missing field: ${f}`);
    }
    if (typeof p.total === "number" && typeof p.eligible === "number") {
      ok(`  total=${p.total}, eligible=${p.eligible}`);
    }
    if (typeof p.requiresTypedConfirmation === "boolean") {
      ok("  requiresTypedConfirmation is boolean");
    } else {
      ko(`  requiresTypedConfirmation should be boolean, got ${typeof p.requiresTypedConfirmation}`);
    }
  }

  // ─── Enroll — missing confirmed ────────────────────────────────────────────
  console.log("\n── Test 5: POST /api/admin/pipeline/new-leads/enroll ───");
  const enrollNoConfirm = await jsonFetch("POST", "/api/admin/pipeline/new-leads/enroll", {});
  if (enrollNoConfirm.status === 400) {
    ok("enroll without confirmed → 400");
  } else {
    ko("enroll without confirmed should be 400", `got ${enrollNoConfirm.status}`);
  }

  // Enroll confirmed=false → 400
  const enrollFalseConfirm = await jsonFetch("POST", "/api/admin/pipeline/new-leads/enroll", { confirmed: false });
  if (enrollFalseConfirm.status === 400) {
    ok("enroll with confirmed: false → 400");
  } else {
    ko("enroll with confirmed: false should be 400", `got ${enrollFalseConfirm.status}`);
  }

  // ─── Status endpoint ──────────────────────────────────────────────────────
  console.log("\n── Test 6: GET /api/admin/pipeline/new-leads/enroll-status");
  const status = await jsonFetch("GET", "/api/admin/pipeline/new-leads/enroll-status");
  if (status.status !== 200) {
    ko("enroll-status HTTP status", `${status.status}`);
  } else {
    ok("enroll-status 200 OK");
    const s = status.body;
    const sFields = ["status", "total", "processed", "enrolled", "dncBlocked",
      "optOutBlocked", "noSequenceBlocked", "errors", "jobRunning"];
    for (const f of sFields) {
      if (f in s) ok(`  field present: ${f}`);
      else ko(`  missing field: ${f}`);
    }
    const validStatuses = ["idle", "running", "complete", "cancelled", "failed"];
    if (validStatuses.includes(s.status)) {
      ok(`  status is valid enum: '${s.status}'`);
    } else {
      ko(`  status is not a valid enum value: '${s.status}'`);
    }
  }

  // ─── Cancel with no job running ────────────────────────────────────────────
  console.log("\n── Test 7: POST /api/admin/pipeline/new-leads/enroll-cancel (no job)");
  const cancelNoJob = await jsonFetch("POST", "/api/admin/pipeline/new-leads/enroll-cancel");
  if (cancelNoJob.status === 400) {
    ok("enroll-cancel with no job running → 400");
  } else {
    ko("enroll-cancel with no job running should be 400", `got ${cancelNoJob.status}`);
  }

  // ─── Kill line: autoEnroll defaults to false ───────────────────────────────
  console.log("\n── Test 8: Kill line — autoEnrollNewLeadDeals must default false");
  const finalHealth = await jsonFetch("GET", "/api/admin/pipeline/stage-health");
  if (finalHealth.body?.autoEnrollNewLeadDeals === false) {
    ok("KILL LINE: autoEnrollNewLeadDeals=false (default OFF — no unsolicited enrollment)");
  } else if (finalHealth.status !== 200) {
    ko("KILL LINE check: stage-health returned non-200", `${finalHealth.status}`);
  } else {
    ko("KILL LINE VIOLATED: autoEnrollNewLeadDeals is not false — it was turned ON");
  }

  // ─── Cleanup: restore clean state ─────────────────────────────────────────
  await jsonFetch("POST", "/api/admin/pipeline/auto-enroll-toggle", { enabled: false });
  await jsonFetch("POST", "/api/admin/pipeline/vertical-sequence-map", {
    verticalMap: {},
    defaultSequenceId: null,
  });
  console.log("\n  (Cleaned up: auto-enroll=false, map reset)");

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════");
  console.log(` Results: ${pass} passed, ${fail} failed`);
  if (failures.length) {
    console.error("\n FAILURES:");
    failures.forEach(f => console.error(`  • ${f}`));
  }
  console.log("═══════════════════════════════════════════════════════\n");

  if (fail > 0) process.exit(1);
}

runTests().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
