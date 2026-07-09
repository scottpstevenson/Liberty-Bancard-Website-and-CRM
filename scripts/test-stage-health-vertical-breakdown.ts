#!/usr/bin/env tsx
/**
 * Task #860 — Validation script: per-vertical enrollment coverage gaps on Stage Health.
 *
 * Tests 9 cases:
 *  1. Stage-health returns breakdownByVertical.
 *  2. Unknown/null vertical appears as "Unknown / Uncategorized".
 *  3. enrolled and noActiveEnrollment counts are correct (enrolled = active OR completed).
 *  4. Missing mapping increments noSequenceMapped.
 *  5. Contact with empty email increments noEmail.
 *  6. DNC contact increments dncBlocked.
 *  7. Suppressed contact increments suppressed (field exists since #859).
 *  8. Array is sorted by noActiveEnrollment desc, tie-break totalDeals desc.
 *  9. Mapping editor prefill: breakdownByVertical rows carry correct mappedSequenceId/Name;
 *     saving mapping via endpoint does NOT trigger enrollment.
 *
 * Run with dev server up:
 *   BASE_URL=http://localhost:5000 npx tsx scripts/test-stage-health-vertical-breakdown.ts
 */

import { db } from "../server/db";
import { deals, contacts, followUpSequences, sequenceEnrollments } from "../shared/schema";
import { eq, sql as drizzleSql } from "drizzle-orm";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5000";

if (!process.env.ADMIN_SEED_EMAIL || !process.env.ADMIN_SEED_PASSWORD) {
  console.error(
    "\n✗ MISSING REQUIRED ENV: ADMIN_SEED_EMAIL and/or ADMIN_SEED_PASSWORD not set.\n" +
    "  Set both env vars before running:\n" +
    "    ADMIN_SEED_EMAIL=admin@example.com ADMIN_SEED_PASSWORD=secret npx tsx scripts/test-stage-health-vertical-breakdown.ts\n"
  );
  process.exit(1);
}

const ADMIN_EMAIL = process.env.ADMIN_SEED_EMAIL!;
const ADMIN_PASSWORD = process.env.ADMIN_SEED_PASSWORD!;

let passCount = 0;
let failCount = 0;

function pass(label: string) {
  console.log(`  ✓ ${label}`);
  passCount++;
}

function fail(label: string, detail?: string) {
  console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  failCount++;
}

function assert(cond: boolean, label: string, detail?: string) {
  if (cond) pass(label);
  else fail(label, detail);
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
  const setCookieArr: string[] = typeof rawHeaders.getSetCookie === "function"
    ? rawHeaders.getSetCookie()
    : [res.headers.get("set-cookie") ?? ""];
  const cookies = setCookieArr.map((c) => c.split(";")[0].trim()).filter(Boolean);
  if (cookies.length === 0) throw new Error(`No session cookie returned for ${email}`);
  return cookies.join("; ");
}

async function waitForServer(url: string, maxMs = 30_000): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(2000) });
      await new Promise((r) => setTimeout(r, 2000));
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(`Server at ${url} did not become ready within ${maxMs / 1000}s`);
}

async function fetchStageHealth(cookie: string): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/admin/pipeline/stage-health`, {
    headers: { cookie },
  });
  if (!res.ok) throw new Error(`stage-health returned ${res.status}: ${await res.text()}`);
  return res.json();
}

async function getCsrfToken(cookie: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/csrf-token`, { headers: { cookie } });
  const body = await res.json();
  return body.token;
}

interface CleanupItem {
  table: "deals" | "contacts" | "followUpSequences" | "sequenceEnrollments";
  id: number;
}
const cleanup: CleanupItem[] = [];

async function teardown() {
  for (const item of cleanup.reverse()) {
    try {
      if (item.table === "deals") {
        await db.delete(deals).where(eq(deals.id, item.id));
      } else if (item.table === "contacts") {
        await db.delete(contacts).where(eq(contacts.id, item.id));
      } else if (item.table === "followUpSequences") {
        await db.delete(followUpSequences).where(eq(followUpSequences.id, item.id));
      } else if (item.table === "sequenceEnrollments") {
        await db.delete(sequenceEnrollments).where(eq(sequenceEnrollments.id, item.id));
      }
    } catch {}
  }
}

async function run() {
  console.log("── Test: per-vertical enrollment coverage gaps on Stage Health ──\n");
  await waitForServer(`${BASE_URL}/api/health`);

  let adminCookie: string;
  try {
    adminCookie = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  } catch (err) {
    console.error(`✗ Could not log in admin: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
  const csrfToken = await getCsrfToken(adminCookie);

  const uniqueTag = `t860-${Date.now()}`;

  // Shorthands for vertical names used in tests
  const V_REST = `rest-${uniqueTag}`;   // restaurant group — 2 deals, 1 enrolled, 1 uncovered
  const V_DENT = `dent-${uniqueTag}`;   // dental group — 3 deals: 1 DNC, 1 suppressed, 1 completed-enroll
  const V_TINY = `tiny-${uniqueTag}`;   // tiny group — 1 deal, for tie-break sort test

  let seqId: number | null = null;

  try {
    // ── Seed shared sequence ─────────────────────────────────────────────────
    const [seq] = await db.insert(followUpSequences).values({
      name: `T860 Seq ${uniqueTag}`,
      status: "active",
      triggerType: "manual",
    } as any).returning({ id: followUpSequences.id });
    seqId = seq.id;
    cleanup.push({ table: "followUpSequences", id: seqId });

    // ── Seed contacts ─────────────────────────────────────────────────────────

    // c1: restaurant, has email — will be actively enrolled
    const [c1] = await db.insert(contacts).values({
      firstName: "T860", lastName: "RestEnrolled",
      email: `t860-c1-${uniqueTag}@test.local`, phone: "+10000860001",
      doNotContact: false, consentTier: "cold_no_consent",
    } as any).returning({ id: contacts.id });
    cleanup.push({ table: "contacts", id: c1.id });

    // c2: restaurant, email will be cleared to '' (noEmail case)
    const [c2] = await db.insert(contacts).values({
      firstName: "T860", lastName: "RestNoEmail",
      email: `t860-c2-${uniqueTag}@test.local`, phone: "+10000860002",
      doNotContact: false, consentTier: "cold_no_consent",
    } as any).returning({ id: contacts.id });
    cleanup.push({ table: "contacts", id: c2.id });
    // Blank the email via raw SQL (schema column is NOT NULL but allows empty string)
    await db.execute(drizzleSql`UPDATE contacts SET email = '' WHERE id = ${c2.id}`);

    // c3: dental, DNC
    const [c3] = await db.insert(contacts).values({
      firstName: "T860", lastName: "DentDnc",
      email: `t860-c3-${uniqueTag}@test.local`, phone: "+10000860003",
      doNotContact: true, consentTier: "cold_no_consent",
    } as any).returning({ id: contacts.id });
    cleanup.push({ table: "contacts", id: c3.id });

    // c4: dental, suppressed deal (set on deal, not contact)
    const [c4] = await db.insert(contacts).values({
      firstName: "T860", lastName: "DentSupp",
      email: `t860-c4-${uniqueTag}@test.local`, phone: "+10000860004",
      doNotContact: false, consentTier: "cold_no_consent",
    } as any).returning({ id: contacts.id });
    cleanup.push({ table: "contacts", id: c4.id });

    // c5: dental, will have a "completed" enrollment → enrolled
    const [c5] = await db.insert(contacts).values({
      firstName: "T860", lastName: "DentCompleted",
      email: `t860-c5-${uniqueTag}@test.local`, phone: "+10000860005",
      doNotContact: false, consentTier: "cold_no_consent",
    } as any).returning({ id: contacts.id });
    cleanup.push({ table: "contacts", id: c5.id });

    // c6: null-vertical contact
    const [c6] = await db.insert(contacts).values({
      firstName: "T860", lastName: "NullVert",
      email: `t860-c6-${uniqueTag}@test.local`, phone: "+10000860006",
      doNotContact: false, consentTier: "cold_no_consent",
    } as any).returning({ id: contacts.id });
    cleanup.push({ table: "contacts", id: c6.id });

    // c7: tiny group (for sort tie-break)
    const [c7] = await db.insert(contacts).values({
      firstName: "T860", lastName: "Tiny",
      email: `t860-c7-${uniqueTag}@test.local`, phone: "+10000860007",
      doNotContact: false, consentTier: "cold_no_consent",
    } as any).returning({ id: contacts.id });
    cleanup.push({ table: "contacts", id: c7.id });

    // ── Seed deals ────────────────────────────────────────────────────────────

    // Restaurant: d1 (c1 — will be enrolled, active), d2 (c2 — noEmail)
    const [d1] = await db.insert(deals).values({
      contactId: c1.id, pipeline: "sales", stage: "New Lead", vertical: V_REST,
    } as any).returning({ id: deals.id });
    cleanup.push({ table: "deals", id: d1.id });

    const [d2] = await db.insert(deals).values({
      contactId: c2.id, pipeline: "sales", stage: "New Lead", vertical: V_REST,
    } as any).returning({ id: deals.id });
    cleanup.push({ table: "deals", id: d2.id });

    // Dental: d3 (c3 — DNC), d4 (c4 — suppressed), d5 (c5 — completed enrollment)
    const [d3] = await db.insert(deals).values({
      contactId: c3.id, pipeline: "sales", stage: "New Lead", vertical: V_DENT,
    } as any).returning({ id: deals.id });
    cleanup.push({ table: "deals", id: d3.id });

    const [d4] = await db.insert(deals).values({
      contactId: c4.id, pipeline: "sales", stage: "New Lead", vertical: V_DENT,
      autoEnrollmentSuppressedAt: new Date(),
      autoEnrollmentSuppressedReason: "test860-suppressed",
    } as any).returning({ id: deals.id });
    cleanup.push({ table: "deals", id: d4.id });

    const [d5] = await db.insert(deals).values({
      contactId: c5.id, pipeline: "sales", stage: "New Lead", vertical: V_DENT,
    } as any).returning({ id: deals.id });
    cleanup.push({ table: "deals", id: d5.id });

    // Null vertical: d6
    const [d6] = await db.insert(deals).values({
      contactId: c6.id, pipeline: "sales", stage: "New Lead", vertical: null,
    } as any).returning({ id: deals.id });
    cleanup.push({ table: "deals", id: d6.id });

    // Tiny group: d7 (no enrollments, 1 uncovered — for sort tie-break)
    const [d7] = await db.insert(deals).values({
      contactId: c7.id, pipeline: "sales", stage: "New Lead", vertical: V_TINY,
    } as any).returning({ id: deals.id });
    cleanup.push({ table: "deals", id: d7.id });

    // ── Seed enrollments ──────────────────────────────────────────────────────

    // c1: active enrollment → enrolled for restaurant
    const [e1] = await db.insert(sequenceEnrollments).values({
      sequenceId: seqId, contactId: c1.id, dealId: d1.id,
      status: "active", currentStep: 0,
    } as any).returning({ id: sequenceEnrollments.id });
    cleanup.push({ table: "sequenceEnrollments", id: e1.id });

    // c5: completed enrollment → enrolled for dental (tests active|completed rule)
    const [e5] = await db.insert(sequenceEnrollments).values({
      sequenceId: seqId, contactId: c5.id, dealId: d5.id,
      status: "completed", currentStep: 1,
    } as any).returning({ id: sequenceEnrollments.id });
    cleanup.push({ table: "sequenceEnrollments", id: e5.id });

    // ── Fetch initial stage health (no mapping set yet for our verticals) ─────
    const health = await fetchStageHealth(adminCookie);

    // ── Test 1: breakdownByVertical present ───────────────────────────────────
    console.log("Test 1: stage-health returns breakdownByVertical");
    assert(Array.isArray(health.breakdownByVertical), "breakdownByVertical is an array");

    const breakdown: any[] = health.breakdownByVertical ?? [];

    // ── Test 2: null vertical → "Unknown / Uncategorized" ────────────────────
    console.log("\nTest 2: null vertical appears as 'Unknown / Uncategorized'");
    const unknownRow = breakdown.find((r: any) => r.vertical === null);
    assert(unknownRow !== undefined, "row with vertical=null is present");
    assert(unknownRow?.label === "Unknown / Uncategorized",
      `label is 'Unknown / Uncategorized' (got '${unknownRow?.label}')`);

    // ── Test 3: enrolled/noActiveEnrollment counts (active AND completed) ─────
    console.log("\nTest 3: enrolled and noActiveEnrollment counts (active|completed) are correct");
    const restRow = breakdown.find((r: any) => r.vertical === V_REST);
    const dentRow = breakdown.find((r: any) => r.vertical === V_DENT);

    assert(restRow !== undefined, `${V_REST} row present`);
    assert(restRow?.totalDeals >= 2, `restaurant totalDeals >= 2 (got ${restRow?.totalDeals})`);
    // c1 has active enrollment → enrolled=1
    assert(restRow?.enrolled >= 1, `restaurant enrolled >= 1 (c1 active; got ${restRow?.enrolled})`);
    const restExpectedUncovered = (restRow?.totalDeals ?? 0) - (restRow?.enrolled ?? 0);
    assert(restRow?.noActiveEnrollment === restExpectedUncovered,
      `restaurant noActiveEnrollment = totalDeals - enrolled = ${restExpectedUncovered} (got ${restRow?.noActiveEnrollment})`);

    assert(dentRow !== undefined, `${V_DENT} row present`);
    // c5 has *completed* enrollment → should count as enrolled
    assert(dentRow?.enrolled >= 1,
      `dental enrolled >= 1 (c5 has completed enrollment; got ${dentRow?.enrolled})`);
    assert(dentRow?.noActiveEnrollment < dentRow?.totalDeals,
      `dental noActiveEnrollment < totalDeals (completed enrollment reduces gap; uncovered=${dentRow?.noActiveEnrollment}, total=${dentRow?.totalDeals})`);

    // ── Test 4: missing mapping increments noSequenceMapped ──────────────────
    console.log("\nTest 4: missing mapping increments noSequenceMapped");
    // Neither V_REST nor V_DENT has a mapping yet (no default set either)
    assert((restRow?.noSequenceMapped ?? 0) >= 1,
      `restaurant noSequenceMapped >= 1 (no mapping set; got ${restRow?.noSequenceMapped})`);
    assert((dentRow?.noSequenceMapped ?? 0) >= 1,
      `dental noSequenceMapped >= 1 (no mapping set; got ${dentRow?.noSequenceMapped})`);

    // ── Test 5: contact with empty email increments noEmail ──────────────────
    console.log("\nTest 5: contact with empty email increments noEmail");
    // c2 has email set to '' via raw SQL update above
    assert((restRow?.noEmail ?? 0) >= 1,
      `restaurant noEmail >= 1 (c2 has empty email; got ${restRow?.noEmail})`);

    // ── Test 6: DNC contact increments dncBlocked ────────────────────────────
    console.log("\nTest 6: DNC contact increments dncBlocked");
    assert((dentRow?.dncBlocked ?? 0) >= 1,
      `dental dncBlocked >= 1 (c3 has doNotContact=true; got ${dentRow?.dncBlocked})`);

    // ── Test 7: suppressed deal increments suppressed ─────────────────────────
    console.log("\nTest 7: suppressed deal increments suppressed");
    assert(typeof health.newLeadAutoEnrollmentSuppressed === "number",
      "newLeadAutoEnrollmentSuppressed is present on top-level response");
    assert(typeof dentRow?.suppressed === "number",
      `suppressed field is a number on dental row (got ${typeof dentRow?.suppressed})`);
    assert((dentRow?.suppressed ?? 0) >= 1,
      `dental suppressed >= 1 (d4 has autoEnrollmentSuppressedAt set; got ${dentRow?.suppressed})`);

    // ── Test 8: sorted by noActiveEnrollment desc, tie-break totalDeals desc ─
    console.log("\nTest 8: array sorted by noActiveEnrollment desc, tie-break totalDeals desc");
    let sortOk = true;
    for (let i = 1; i < breakdown.length; i++) {
      const prev = breakdown[i - 1];
      const curr = breakdown[i];
      if (curr.noActiveEnrollment > prev.noActiveEnrollment) {
        fail(`primary sort violation at [${i}]: noActiveEnrollment ${curr.noActiveEnrollment} > prev ${prev.noActiveEnrollment}`);
        sortOk = false;
        break;
      }
      if (curr.noActiveEnrollment === prev.noActiveEnrollment && curr.totalDeals > prev.totalDeals) {
        fail(`tie-break sort violation at [${i}]: equal noActiveEnrollment(${curr.noActiveEnrollment}), but totalDeals ${curr.totalDeals} > prev ${prev.totalDeals}`);
        sortOk = false;
        break;
      }
    }
    if (sortOk) pass("array is sorted by noActiveEnrollment desc, totalDeals desc on ties");

    // ── Test 9: Mapping editor prefill semantics + no enrollment on save ──────
    console.log("\nTest 9: breakdownByVertical carries correct mapped sequence after mapping saved; saving does NOT enroll");

    // Set a mapping for V_REST → seqId
    const mapRes = await fetch(`${BASE_URL}/api/admin/pipeline/vertical-sequence-map`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: adminCookie,
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({ verticalMap: { [V_REST]: seqId } }),
    });
    assert(mapRes.ok, `mapping save returned 200 (got ${mapRes.status})`);

    // Count enrollments before re-fetch
    const enrollsBefore = await db
      .select({ id: sequenceEnrollments.id })
      .from(sequenceEnrollments)
      .where(eq(sequenceEnrollments.sequenceId, seqId!));
    const countBefore = enrollsBefore.length;

    // Re-fetch stage health — breakdown rows should now reflect the mapping
    const health2 = await fetchStageHealth(adminCookie);
    const restRow2 = (health2.breakdownByVertical as any[])?.find((r: any) => r.vertical === V_REST);

    assert(restRow2 !== undefined, `${V_REST} row present in second fetch`);
    assert(restRow2?.mappedSequenceId === seqId,
      `mappedSequenceId = ${seqId} on ${V_REST} row (got ${restRow2?.mappedSequenceId})`);
    assert(typeof restRow2?.mappedSequenceName === "string" && restRow2.mappedSequenceName.length > 0,
      `mappedSequenceName is non-empty string on ${V_REST} row (got '${restRow2?.mappedSequenceName}')`);
    // noSequenceMapped should be 0 for V_REST now (mapping resolved)
    assert((restRow2?.noSequenceMapped ?? 1) === 0,
      `restaurant noSequenceMapped = 0 after mapping set (got ${restRow2?.noSequenceMapped})`);

    // Verify no new enrollments were created by saving the mapping
    await new Promise((r) => setTimeout(r, 400));
    const enrollsAfter = await db
      .select({ id: sequenceEnrollments.id })
      .from(sequenceEnrollments)
      .where(eq(sequenceEnrollments.sequenceId, seqId!));
    assert(enrollsAfter.length === countBefore,
      `no new enrollments from saving mapping (before=${countBefore}, after=${enrollsAfter.length})`);

    // Clean up the mapping
    await fetch(`${BASE_URL}/api/admin/pipeline/vertical-sequence-map`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: adminCookie,
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({ verticalMap: {} }),
    }).catch(() => {});

  } finally {
    await teardown();
  }

  console.log(`\n── Results: ${passCount} passed, ${failCount} failed ──`);
  process.exit(failCount > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
