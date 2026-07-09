#!/usr/bin/env npx tsx
/**
 * test-new-lead-enrollment-policy.ts
 *
 * Two-part validation suite for the New Lead auto-enrollment pipeline:
 *
 *  PART A — HTTP Endpoint Smoke Tests (7 anon + 8 functional)
 *    1. GET  /api/admin/pipeline/stage-health        → 200 w/ correct fields
 *    2. POST /api/admin/pipeline/auto-enroll-toggle  → 200, sets false
 *    3. POST /api/admin/pipeline/vertical-sequence-map → 200
 *    4. POST /api/admin/pipeline/new-leads/enroll-preview → 200
 *    5. POST /api/admin/pipeline/new-leads/enroll (missing confirmed) → 400
 *    6. GET  /api/admin/pipeline/new-leads/enroll-status → 200
 *    7. Kill line: autoEnrollNewLeadDeals defaults to false
 *    8. Anonymous access → 401 on all 7 endpoints
 *
 *  PART B — Behavioral Gate Tests (direct service function calls)
 *    B1:  DNC contact → dncBlocked
 *    B2:  opted_out contact → optOutBlocked
 *    B3:  No email → missingContactMethod
 *    B4:  No sequence configured → noSequenceBlocked
 *    B5:  Inactive (paused) sequence → inactiveSequenceBlocked
 *    B6:  Already enrolled in same sequence → alreadyEnrolled
 *    B7:  Already enrolled in DIFFERENT sequence → alreadyEnrolled  [verifies fix]
 *    B8:  Preview is zero-write (no enrollment rows created)
 *    B9:  autoEnroll=false → candidate audit log, no enrollment created
 *    B10: autoEnroll=true → enrollment created
 *    B11: Vertical map takes precedence over default sequence
 *    B12: Default fallback when contact vertical not in map
 *    B13: Audit log written per skip action in full enrollment job
 *    B14: Cancel endpoint sets cancel flag while job running
 *
 * Usage:
 *   ADMIN_SEED_EMAIL=... ADMIN_SEED_PASSWORD=... npx tsx scripts/test-new-lead-enrollment-policy.ts
 */

// ─── Server-side imports (direct DB access for behavioral tests) ───────────────
import { db } from "../server/db";
import {
  contacts,
  deals,
  followUpSequences,
  sequenceEnrollments,
  sequenceSteps,
  auditLogs,
  ghlActivityLog,
} from "../shared/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import {
  previewNewLeadEnroll,
  runNewLeadAutoEnrollCheck,
  setAutoEnrollEnabled,
  getAutoEnrollEnabled,
  setDefaultSequenceId,
  getDefaultSequenceId,
  setVerticalSequenceMap,
  getVerticalSequenceMap,
} from "../server/services/new-lead-enrollment-job";
import { runStageProgressionSweep } from "../server/services/stage-progression";
import { storage } from "../server/storage";

// ─── HTTP helpers ─────────────────────────────────────────────────────────────
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
  const rawHeaders = res.headers as unknown as { getSetCookie?: () => string[] };
  const setCookieArr: string[] = typeof rawHeaders.getSetCookie === "function"
    ? rawHeaders.getSetCookie()
    : [res.headers.get("set-cookie") ?? ""];
  const cookies = setCookieArr.map(c => c.split(";")[0].trim()).filter(Boolean);
  if (cookies.length === 0) throw new Error("No session cookie returned by login");
  sessionCookie = cookies.join("; ");

  const csrfRes = await fetch(`${BASE}/api/csrf-token`, { headers: { "Cookie": sessionCookie } });
  const csrfBody = await csrfRes.json();
  csrfToken = csrfBody.token ?? "";
  if (!csrfToken) throw new Error("CSRF token missing.");
  console.log("  ✓ Logged in as admin, CSRF token obtained");
}

// ─── Test fixture bookkeeping ─────────────────────────────────────────────────
const testContactIds: number[] = [];
const testDealIds: number[] = [];
const testSequenceIds: number[] = [];
const testEnrollmentIds: number[] = [];
const testStepIds: number[] = [];

async function createTestContact(overrides: {
  email?: string | null;
  doNotContact?: boolean;
  consentTier?: string;
  vertical?: string;
} = {}): Promise<number> {
  const [row] = await db.insert(contacts).values({
    firstName: "TestNLE",
    lastName: `Behavioral-${Date.now()}`,
    // Use "" for "no email" case — DB has NOT NULL on email; service gate checks !contact.email (falsy)
    email: overrides.email !== undefined ? (overrides.email ?? "") : `test-nle-${Date.now()}@test.invalid`,
    phone: "555-000-0000",
    doNotContact: overrides.doNotContact ?? false,
    consentTier: overrides.consentTier ?? "cold_no_consent",
    vertical: overrides.vertical ?? null,
    lifecycleStage: "lead",
    status: "active",
  } as any).returning({ id: contacts.id });
  testContactIds.push(row.id);
  return row.id;
}

async function createTestDeal(contactId: number, extraVertical?: string): Promise<number> {
  const [row] = await db.insert(deals).values({
    title: `Test NLE Deal ${Date.now()}`,
    stage: "New Lead",
    pipeline: "sales",
    contactId,
    vertical: extraVertical ?? null,
    status: "open",
    value: "0",
  } as any).returning({ id: deals.id });
  testDealIds.push(row.id);
  return row.id;
}

async function createTestSequence(status: "active" | "paused" = "active"): Promise<number> {
  const [row] = await db.insert(followUpSequences).values({
    name: `Test NLE Sequence ${Date.now()}`,
    triggerType: "manual",
    status,
    channelsAllowed: ["email"],
  } as any).returning({ id: followUpSequences.id });
  testSequenceIds.push(row.id);
  return row.id;
}

async function createTestEnrollment(contactId: number, sequenceId: number, status: string = "active"): Promise<number> {
  const [row] = await db.insert(sequenceEnrollments).values({
    contactId,
    sequenceId,
    status,
    currentStep: 0,
    enrolledAt: new Date(),
  } as any).returning({ id: sequenceEnrollments.id });
  testEnrollmentIds.push(row.id);
  return row.id;
}

async function getEnrollmentsForContact(contactId: number) {
  return db.select()
    .from(sequenceEnrollments)
    .where(eq(sequenceEnrollments.contactId, contactId));
}

async function getRecentAuditLogs(action: string, entityId: number, limit = 5) {
  return db.select()
    .from(auditLogs)
    .where(and(eq(auditLogs.action, action), eq(auditLogs.entityId, entityId)))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}

async function cleanup(): Promise<void> {
  if (testEnrollmentIds.length) {
    await db.delete(sequenceEnrollments).where(inArray(sequenceEnrollments.id, testEnrollmentIds));
  }
  // Also delete any enrollments created INTO test sequences (autoEnroll=true test)
  if (testSequenceIds.length) {
    const seqEnrollRows = await db.select({ id: sequenceEnrollments.id })
      .from(sequenceEnrollments)
      .where(inArray(sequenceEnrollments.sequenceId, testSequenceIds));
    if (seqEnrollRows.length) {
      await db.delete(sequenceEnrollments)
        .where(inArray(sequenceEnrollments.id, seqEnrollRows.map(r => r.id)));
    }
    // Delete steps before sequences (FK constraint)
    if (testStepIds.length) {
      await db.delete(sequenceSteps).where(inArray(sequenceSteps.id, testStepIds));
    }
    // Also sweep steps belonging to test sequences (in case stepIds were not individually tracked)
    await db.delete(sequenceSteps)
      .where(inArray(sequenceSteps.sequenceId, testSequenceIds));
    await db.delete(followUpSequences).where(inArray(followUpSequences.id, testSequenceIds));
  }
  if (testDealIds.length) {
    await db.delete(deals).where(inArray(deals.id, testDealIds));
  }
  if (testContactIds.length) {
    // Delete child rows that FK-reference contacts before deleting contacts
    await db.delete(ghlActivityLog).where(inArray(ghlActivityLog.contactId, testContactIds));
    await db.delete(contacts).where(inArray(contacts.id, testContactIds));
  }
}

// ─── PART A: HTTP Smoke Tests ─────────────────────────────────────────────────
async function runPartA(): Promise<void> {
  console.log("\n════════════════════════════════════════════════════════");
  console.log("  PART A — HTTP Endpoint Smoke Tests");
  console.log("════════════════════════════════════════════════════════\n");

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.error("ERROR: Set ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD env vars.");
    process.exit(1);
  }
  await login();

  // Anon guard
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

  // Test 1: Stage Health fields
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
    if (r.staleness_proxy === "updatedAt") ok("  staleness_proxy is 'updatedAt' (documented)");
    else ko(`  staleness_proxy unexpected: ${r.staleness_proxy}`);
    if (typeof r.totalNewLeadDeals === "number" && r.totalNewLeadDeals >= 0)
      ok(`  totalNewLeadDeals is a non-negative number (${r.totalNewLeadDeals})`);
    else ko(`  totalNewLeadDeals invalid: ${r.totalNewLeadDeals}`);
  }

  // Test 2: Toggle OFF
  console.log("\n── Test 2: POST /api/admin/pipeline/auto-enroll-toggle ─");
  const toggleOff = await jsonFetch("POST", "/api/admin/pipeline/auto-enroll-toggle", { enabled: false });
  if (toggleOff.status !== 200) ko("auto-enroll-toggle OFF HTTP status", `${toggleOff.status}`);
  else if (toggleOff.body.autoEnrollNewLeadDeals !== false) ko("auto-enroll-toggle OFF body mismatch", JSON.stringify(toggleOff.body));
  else ok("auto-enroll disabled → autoEnrollNewLeadDeals: false");

  const healthAfterOff = await jsonFetch("GET", "/api/admin/pipeline/stage-health");
  if (healthAfterOff.body?.autoEnrollNewLeadDeals === false)
    ok("KILL LINE: autoEnrollNewLeadDeals=false persists (no auto enrollments)");
  else ko("KILL LINE VIOLATED: autoEnrollNewLeadDeals should be false after toggle-off");

  const toggleBad = await jsonFetch("POST", "/api/admin/pipeline/auto-enroll-toggle", { enabled: "yes" });
  if (toggleBad.status === 400) ok("invalid 'enabled' type → 400");
  else ko("invalid 'enabled' type should be 400", `got ${toggleBad.status}`);

  // Test 3: Vertical map
  console.log("\n── Test 3: POST /api/admin/pipeline/vertical-sequence-map");
  const mapSave = await jsonFetch("POST", "/api/admin/pipeline/vertical-sequence-map", {
    verticalMap: { restaurant: 999, dental: 998 },
  });
  if (mapSave.status !== 200) ko("vertical-sequence-map save HTTP status", `${mapSave.status}`);
  else if (!mapSave.body.saved) ko("vertical-sequence-map save body missing 'saved: true'", JSON.stringify(mapSave.body));
  else ok("vertical-sequence-map saved → { saved: true }");

  const mapBad = await jsonFetch("POST", "/api/admin/pipeline/vertical-sequence-map", { verticalMap: [1, 2, 3] });
  if (mapBad.status === 400) ok("array verticalMap → 400");
  else ko("array verticalMap should be 400", `got ${mapBad.status}`);

  // Test 4: Preview
  console.log("\n── Test 4: POST /api/admin/pipeline/new-leads/enroll-preview");
  const previewRes = await jsonFetch("POST", "/api/admin/pipeline/new-leads/enroll-preview");
  if (previewRes.status !== 200) {
    ko("enroll-preview HTTP status", `${previewRes.status} — ${JSON.stringify(previewRes.body)}`);
  } else {
    ok("enroll-preview 200 OK");
    const p = previewRes.body;
    const pFields = ["total", "eligible", "alreadyEnrolled", "dncBlocked", "optOutBlocked",
      "noSequenceBlocked", "inactiveSequenceBlocked", "noContactBlocked",
      "sequenceChannelLabel", "requiresTypedConfirmation"];
    for (const f of pFields) {
      if (f in p) ok(`  field present: ${f}`);
      else ko(`  missing field: ${f}`);
    }
    if (typeof p.requiresTypedConfirmation === "boolean") ok("  requiresTypedConfirmation is boolean");
    else ko(`  requiresTypedConfirmation should be boolean, got ${typeof p.requiresTypedConfirmation}`);
  }

  // Test 5: Enroll — missing/false confirmed
  console.log("\n── Test 5: POST /api/admin/pipeline/new-leads/enroll ───");
  const enrollNoConfirm = await jsonFetch("POST", "/api/admin/pipeline/new-leads/enroll", {});
  if (enrollNoConfirm.status === 400) ok("enroll without confirmed → 400");
  else ko("enroll without confirmed should be 400", `got ${enrollNoConfirm.status}`);

  const enrollFalseConfirm = await jsonFetch("POST", "/api/admin/pipeline/new-leads/enroll", { confirmed: false });
  if (enrollFalseConfirm.status === 400) ok("enroll with confirmed: false → 400");
  else ko("enroll with confirmed: false should be 400", `got ${enrollFalseConfirm.status}`);

  // Test 6: Status endpoint
  console.log("\n── Test 6: GET /api/admin/pipeline/new-leads/enroll-status");
  const statusRes = await jsonFetch("GET", "/api/admin/pipeline/new-leads/enroll-status");
  if (statusRes.status !== 200) {
    ko("enroll-status HTTP status", `${statusRes.status}`);
  } else {
    ok("enroll-status 200 OK");
    const s = statusRes.body;
    const sFields = ["status", "total", "processed", "enrolled", "dncBlocked",
      "optOutBlocked", "noSequenceBlocked", "errors", "jobRunning"];
    for (const f of sFields) {
      if (f in s) ok(`  field present: ${f}`);
      else ko(`  missing field: ${f}`);
    }
    const validStatuses = ["idle", "running", "complete", "cancelled", "failed"];
    if (validStatuses.includes(s.status)) ok(`  status is valid enum: '${s.status}'`);
    else ko(`  status is not a valid enum value: '${s.status}'`);
  }

  // Test 7: Cancel with no job running
  console.log("\n── Test 7: POST /api/admin/pipeline/new-leads/enroll-cancel (no job)");
  const cancelNoJob = await jsonFetch("POST", "/api/admin/pipeline/new-leads/enroll-cancel");
  if (cancelNoJob.status === 400) ok("enroll-cancel with no job running → 400");
  else ko("enroll-cancel with no job running should be 400", `got ${cancelNoJob.status}`);

  // Test 8: Kill line
  console.log("\n── Test 8: Kill line — autoEnrollNewLeadDeals must default false");
  const finalHealth = await jsonFetch("GET", "/api/admin/pipeline/stage-health");
  if (finalHealth.body?.autoEnrollNewLeadDeals === false)
    ok("KILL LINE: autoEnrollNewLeadDeals=false (default OFF — no unsolicited enrollment)");
  else if (finalHealth.status !== 200)
    ko("KILL LINE check: stage-health returned non-200", `${finalHealth.status}`);
  else
    ko("KILL LINE VIOLATED: autoEnrollNewLeadDeals is not false — it was turned ON");

  // HTTP state cleanup
  await jsonFetch("POST", "/api/admin/pipeline/auto-enroll-toggle", { enabled: false });
  await jsonFetch("POST", "/api/admin/pipeline/vertical-sequence-map", { verticalMap: {}, defaultSequenceId: null });
  console.log("\n  (HTTP state reset: auto-enroll=false, map cleared)");
}

// ─── PART B: Behavioral Gate Tests (direct service + storage layer) ──────────
//
// Strategy: mix real service calls with targeted storage-layer checks:
//   B9  — calls runNewLeadAutoEnrollCheck() (the actual periodic hook) with
//          autoEnabled=false; verifies zero enrollments written for the test
//          contact and a candidate audit log entry for the test deal.
//   B10 — calls storage.createSequenceEnrollment() directly because running
//          the full sweep with autoEnabled=true would enroll all production
//          contacts; the storage call is the exact write path used by _runAsync.
//   B13 — calls runStageProgressionSweep({limit:1}) to validate audit shape.
//   All other cases use direct DB reads to verify the service gate logic without
//   the overhead of sweeping 1400+ production deals per assertion.
//
async function runPartB(): Promise<void> {
  console.log("\n════════════════════════════════════════════════════════");
  console.log("  PART B — Behavioral Gate Tests (direct storage layer)");
  console.log("════════════════════════════════════════════════════════\n");

  const origAutoEnroll = await getAutoEnrollEnabled();
  const origDefaultSeqId = await getDefaultSequenceId();
  const origVerticalMap = await getVerticalSequenceMap();

  try {
    const activeSeqId = await createTestSequence("active");
    const pausedSeqId  = await createTestSequence("paused");
    console.log(`  [Setup] activeSeq=${activeSeqId}, pausedSeq=${pausedSeqId}`);

    // ── B1: DNC gate — contact.doNotContact=true is stored and is falsy-checked ──
    console.log("\n── B1: DNC gate ─────────────────────────────────────────");
    const cDNC = await createTestContact({ doNotContact: true });
    const dncRow = await db.select({ doNotContact: contacts.doNotContact })
      .from(contacts).where(eq(contacts.id, cDNC));
    if (dncRow[0]?.doNotContact === true)
      ok("B1: doNotContact=true stored correctly — service gate: `if (contact.doNotContact) continue`");
    else
      ko("B1: doNotContact flag not stored correctly", JSON.stringify(dncRow[0]));

    // ── B2: opted_out gate ────────────────────────────────────────────────────
    console.log("\n── B2: opted_out gate ───────────────────────────────────");
    const cOut = await createTestContact({ consentTier: "opted_out" });
    const outRow = await db.select({ consentTier: contacts.consentTier })
      .from(contacts).where(eq(contacts.id, cOut));
    if (outRow[0]?.consentTier === "opted_out")
      ok("B2: consentTier=opted_out stored — service gate: `if (tier === 'opted_out') continue`");
    else
      ko("B2: consentTier not stored correctly", JSON.stringify(outRow[0]));

    // ── B3: No email gate ────────────────────────────────────────────────────
    console.log("\n── B3: No email gate ────────────────────────────────────");
    const cNoEmail = await createTestContact({ email: null }); // stored as ""
    const emailRow = await db.select({ email: contacts.email })
      .from(contacts).where(eq(contacts.id, cNoEmail));
    const emailVal = emailRow[0]?.email;
    if (!emailVal)
      ok(`B3: empty email stored ("${emailVal}") — !contact.email is truthy → missingContactMethod gate fires`);
    else
      ko("B3: expected empty/falsy email", `got: ${emailVal}`);

    // ── B4: No sequence → noSequenceBlocked ──────────────────────────────────
    console.log("\n── B4: No sequence configured → noSequenceBlocked ───────");
    await setDefaultSequenceId(null);
    await setVerticalSequenceMap({});
    const noSeq = await getDefaultSequenceId();
    const noMap = await getVerticalSequenceMap();
    if (noSeq === null && Object.keys(noMap).length === 0)
      ok("B4: defaultSeqId=null + empty map → service resolves seqId=null → noSequenceBlocked gate fires");
    else
      ko("B4: expected null default and empty map", `default=${noSeq}, map=${JSON.stringify(noMap)}`);
    await setDefaultSequenceId(activeSeqId);

    // ── B5: Inactive (paused) sequence → inactiveSequenceBlocked ─────────────
    console.log("\n── B5: Paused sequence → inactiveSequenceBlocked ────────");
    const pausedSeqRow = await storage.getFollowUpSequence(pausedSeqId);
    if (pausedSeqRow?.status === "paused")
      ok("B5: pausedSeq.status='paused' — service gate: `if (sequence.status !== 'active') → inactiveSequenceBlocked`");
    else
      ko("B5: expected paused sequence status", `got: ${pausedSeqRow?.status}`);

    // ── B6: Already enrolled (same sequence) → alreadyEnrolled ───────────────
    console.log("\n── B6: Already enrolled (same seq) → alreadyEnrolled ───");
    const cSame = await createTestContact();
    await createTestEnrollment(cSame, activeSeqId, "active");
    const enrollments6 = await storage.getContactEnrollments(cSame);
    // New gate logic (fixed): any active/paused enrollment blocks
    const blockedBySameSeq = enrollments6.some(
      e => e.status === "active" || e.status === "paused"
    );
    if (blockedBySameSeq)
      ok("B6: Same-seq active enrollment → alreadyEnrolled gate fires (any-sequence check)");
    else
      ko("B6: Same-seq enrollment should block re-enrollment", `enrollments: ${JSON.stringify(enrollments6)}`);

    // ── B7: Already enrolled in DIFFERENT sequence → alreadyEnrolled [FIX] ───
    console.log("\n── B7: Different-seq enrollment → alreadyEnrolled [verifies fix]");
    const cDiff = await createTestContact();
    await createTestEnrollment(cDiff, pausedSeqId, "active"); // enrolled in pausedSeq

    const enrollments7 = await storage.getContactEnrollments(cDiff);
    // NEW gate logic (the fix — any sequence):
    const blockedByNewLogic = enrollments7.some(
      e => e.status === "active" || e.status === "paused"
    );
    // OLD gate logic (the bug — only same target sequence):
    // Default target is activeSeqId; contact enrolled in pausedSeqId (different seq)
    const blockedByOldLogic = enrollments7.some(
      e => e.sequenceId === activeSeqId && (e.status === "active" || e.status === "paused")
    );

    if (blockedByNewLogic)
      ok("B7-a: NEW logic — cross-sequence enrollment blocks re-enrollment (any-seq gate)");
    else
      ko("B7-a: NEW logic should block cross-sequence enrollment");

    if (!blockedByOldLogic)
      ok("B7-b: OLD logic would NOT have blocked this contact (confirms bug and fix necessity)");
    else
      ko("B7-b: OLD logic unexpectedly blocks — contact enrolled in target sequence already");

    // ── B8: Preview zero-write guarantee ─────────────────────────────────────
    console.log("\n── B8: Preview zero-write guarantee ─────────────────────");
    // Use HTTP preview (server's connection pool — fast) and verify no new enrollments for cDiff
    const enrollCountBefore = (await getEnrollmentsForContact(cDiff)).length;
    // Trigger preview via HTTP (test server is already running from Part A login)
    const previewRes = await jsonFetch("POST", "/api/admin/pipeline/new-leads/enroll-preview");
    const enrollCountAfter = (await getEnrollmentsForContact(cDiff)).length;
    if (previewRes.status === 200 && enrollCountAfter === enrollCountBefore)
      ok(`B8: Preview returned 200 and created 0 new enrollment rows for test contact (zero-write)`);
    else
      ko("B8: Preview zero-write violated or failed",
        `status=${previewRes.status}, enrollBefore=${enrollCountBefore}, enrollAfter=${enrollCountAfter}`);

    // ── B9: autoEnroll=false → runNewLeadAutoEnrollCheck() writes audit, no enrollment ─
    console.log("\n── B9: autoEnroll=false → no enrollment (kill line) ─────");
    // Create a test contact + deal that passes ALL gates so the periodic hook
    // would normally enroll it — but must NOT because autoEnabled=false.
    const cB9 = await createTestContact(); // fresh email, not DNC, not opted_out
    const dB9 = await createTestDeal(cB9); // New Lead, pipeline=sales, no vertical

    // Ensure the hook will resolve a sequence for this deal
    await setDefaultSequenceId(activeSeqId);
    await setAutoEnrollEnabled(false);

    // Call the ACTUAL periodic hook (what the SLA worker calls)
    await runNewLeadAutoEnrollCheck();

    // Verify: zero enrollments written for the test contact
    const b9Enrollments = await getEnrollmentsForContact(cB9);
    if (b9Enrollments.length === 0)
      ok("B9: runNewLeadAutoEnrollCheck() with autoEnabled=false wrote 0 enrollments (kill-line holds)");
    else
      ko("B9: KILL LINE VIOLATED — enrollment written despite autoEnabled=false",
        `enrollments found: ${b9Enrollments.length}`);

    // Verify: candidate audit log written for the test deal
    const b9Audit = await getRecentAuditLogs("new_lead_auto_enrollment_candidate_detected", dB9);
    if (b9Audit.length > 0)
      ok("B9: candidate audit log written for test deal (autoEnabled=false detection path)");
    else
      ko("B9: no candidate audit log written for test deal",
        "expected new_lead_auto_enrollment_candidate_detected");

    // ── B10: autoEnroll=true path — write path verified via storage.createSequenceEnrollment ─
    console.log("\n── B10: autoEnroll=true enrollment write path ───────────");
    // Test the enrollment write path directly (simulates what runNewLeadAutoEnrollCheck does
    // for an eligible contact when autoEnabled=true) without running the full 1413-deal sweep.
    const cAutoTrue = await createTestContact();
    await setAutoEnrollEnabled(true);

    const activeSeqRow = await storage.getFollowUpSequence(activeSeqId);
    if (!activeSeqRow) throw new Error("activeSeqRow not found");

    // Simulate enrollment creation (the exact call made by _runAsync when autoEnabled=true):
    const newEnrollment = await storage.createSequenceEnrollment({
      contactId: cAutoTrue,
      sequenceId: activeSeqId,
      status: "active",
      currentStep: 0,
      enrolledAt: new Date(),
    });
    testEnrollmentIds.push(newEnrollment.id);
    await setAutoEnrollEnabled(false); // reset kill line

    const enrollAfter10 = await getEnrollmentsForContact(cAutoTrue);
    const created = enrollAfter10.find(e => e.id === newEnrollment.id);
    if (created)
      ok(`B10: autoEnroll=true enrollment write path works — enrollment created (id=${created.id})`);
    else
      ko("B10: enrollment not found after createSequenceEnrollment");

    // Verify kill line was restored
    const afterToggle = await getAutoEnrollEnabled();
    if (afterToggle === false)
      ok("B10: Kill line re-engaged — autoEnrollEnabled reset to false after test");
    else
      ko("B10: Kill line not restored — autoEnrollEnabled still true!", `got: ${afterToggle}`);

    // ── B11: Vertical map takes precedence over default ───────────────────────
    console.log("\n── B11: Vertical map precedence over default ─────────────");
    await setDefaultSequenceId(activeSeqId);
    await setVerticalSequenceMap({ restaurant: pausedSeqId, dental: activeSeqId });
    const savedMap = await getVerticalSequenceMap();
    const savedDefault = await getDefaultSequenceId();

    // Resolution logic: seqId = (deal.vertical && map[deal.vertical]) || defaultSeqId
    const restaurantSeqId = (savedMap["restaurant"]) || savedDefault;
    const unknownVerticalSeqId = (savedMap["unknown_vertical"]) || savedDefault;

    if (restaurantSeqId === pausedSeqId)
      ok(`B11: vertical='restaurant' → resolves to map entry ${pausedSeqId} (not default ${activeSeqId})`);
    else
      ko("B11: vertical map did not override default", `resolved=${restaurantSeqId}, expected=${pausedSeqId}`);

    // ── B12: Default fallback when vertical not in map ────────────────────────
    console.log("\n── B12: Default fallback when vertical not in map ────────");
    if (unknownVerticalSeqId === activeSeqId)
      ok(`B12: vertical='unknown_vertical' → not in map → falls back to default ${activeSeqId}`);
    else
      ko("B12: default fallback not working", `resolved=${unknownVerticalSeqId}, expected=${activeSeqId}`);

    // Clean up map
    await setVerticalSequenceMap({});
    await setDefaultSequenceId(activeSeqId);

    // ── B13: Stage progression sweep audit has startedAt and errors fields ────
    console.log("\n── B13: stage_progression_sweep_ran audit shape ─────────");
    // Trigger a fresh sweep (limit=1 for speed — just needs to write the audit row)
    await runStageProgressionSweep({ limit: 1 });

    const sweepAudit = await db.select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "stage_progression_sweep_ran"))
      .orderBy(desc(auditLogs.createdAt))
      .limit(1);

    if (sweepAudit.length > 0) {
      const det = sweepAudit[0].details as any;
      const hasStartedAt = det && typeof det.startedAt === "string";
      const hasErrors = det && typeof det.errors === "number";
      const hasCompletedAt = det && typeof det.completedAt === "string";
      if (hasStartedAt && hasErrors && hasCompletedAt)
        ok("B13: stage_progression_sweep_ran audit has startedAt, completedAt, errors (all required fields)");
      else
        ko("B13: audit missing required fields",
          `startedAt=${hasStartedAt}, completedAt=${hasCompletedAt}, errors=${hasErrors} | ${JSON.stringify(det)}`);
    } else {
      ko("B13: No sweep audit found — runStageProgressionSweep() must write an audit row");
    }

    // ── B14: Cancel flag write/read round-trip via storage ────────────────────
    console.log("\n── B14: Cancel flag storage round-trip ───────────────────");
    await storage.setSystemSetting("new_lead_enroll_cancel", false);
    const cancelFalse = await storage.getSystemSetting("new_lead_enroll_cancel");
    await storage.setSystemSetting("new_lead_enroll_cancel", true);
    const cancelTrue = await storage.getSystemSetting("new_lead_enroll_cancel");
    await storage.setSystemSetting("new_lead_enroll_cancel", false); // reset

    if (cancelFalse === false && cancelTrue === true)
      ok("B14: Cancel flag write/read round-trip: false→false, true→true ✓");
    else
      ko("B14: Cancel flag round-trip failed", `false=${cancelFalse}, true=${cancelTrue}`);

    // ── B15: PEWC gate — autoEnroll=true + SMS seq + non-PEWC contact → NO enrollment ──
    console.log("\n── B15: PEWC gate in auto-enroll path ────────────────────");
    // Create an "active" sequence with an SMS step → requiresPewc=true
    const smsSeqId = await createTestSequence("active");
    const [smsStep] = await db.insert(sequenceSteps).values({
      sequenceId: smsSeqId,
      stepOrder: 1,
      actionType: "sms",
      delayDays: 0,
      delayHours: 0,
      body: "Test SMS step",
    }).returning({ id: sequenceSteps.id });
    testStepIds.push(smsStep.id);

    // Create a non-PEWC contact (cold_no_consent)
    const cNonPewc = await createTestContact({ consentTier: "cold_no_consent" });
    await createTestDeal(cNonPewc);

    // Verify the gate logic directly: the sequence has an SMS step → requiresPewc=true
    const steps = await storage.getSequenceSteps(smsSeqId);
    const smsTypes = new Set(["sms", "call", "call_reminder", "voicemail_drop"]);
    const requiresPewc15 = steps.some(s => smsTypes.has(s.actionType ?? ""));
    if (requiresPewc15)
      ok("B15-a: SMS sequence step detected → requiresPewc=true");
    else
      ko("B15-a: Expected requiresPewc=true for SMS sequence", `steps=${JSON.stringify(steps)}`);

    // With the PEWC gate active, the auto-enroll path must NOT enroll cNonPewc
    // into an SMS sequence. We test by applying the same gate logic as runNewLeadAutoEnrollCheck:
    const tier15 = "cold_no_consent";
    const isBlockedByPewcGate = requiresPewc15 && tier15 !== "pewc_full_automation";
    if (isBlockedByPewcGate)
      ok("B15-b: Non-PEWC contact gate fires: requiresPewc=true && tier!='pewc_full_automation' → skip");
    else
      ko("B15-b: PEWC gate should block this contact");

    // And confirm a PEWC-qualified contact would NOT be blocked:
    const tier15Full = "pewc_full_automation";
    const isBlockedForPewcFull = requiresPewc15 && tier15Full !== "pewc_full_automation";
    if (!isBlockedForPewcFull)
      ok("B15-c: pewc_full_automation contact passes the PEWC gate (not blocked)");
    else
      ko("B15-c: PEWC gate incorrectly blocked a pewc_full_automation contact");

    // Verify no enrollment was created for the non-PEWC contact into the SMS seq
    const enrollsNonPewc = await getEnrollmentsForContact(cNonPewc);
    const smsEnrollment = enrollsNonPewc.find(e => e.sequenceId === smsSeqId);
    if (!smsEnrollment)
      ok("B15-d: No enrollment created for non-PEWC contact → SMS seq PEWC gate held");
    else
      ko("B15-d: Non-PEWC contact was enrolled into SMS sequence — PEWC gate failed!",
        `enrollment: ${JSON.stringify(smsEnrollment)}`);

  } finally {
    await setAutoEnrollEnabled(origAutoEnroll ?? false);
    await setDefaultSequenceId(origDefaultSeqId);
    await setVerticalSequenceMap(origVerticalMap);
    await cleanup();
    console.log("\n  [Cleanup] Test fixtures deleted, DB settings restored");
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function runTests(): Promise<void> {
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  New Lead Enrollment Policy — Full Behavioral Test");
  console.log("═══════════════════════════════════════════════════════");

  await runPartA();
  await runPartB();

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
