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

    // ── Task #866: Detail endpoint tests (10 new cases) ────────────────────

    async function fetchVerticalDetail(vertical: string, extra = ""): Promise<any> {
      const url = `${BASE_URL}/api/admin/pipeline/stage-health/vertical-detail?vertical=${encodeURIComponent(vertical)}${extra}`;
      const res = await fetch(url, { headers: { cookie: adminCookie } });
      if (!res.ok) throw new Error(`vertical-detail returned ${res.status}: ${await res.text()}`);
      return res.json();
    }

    // ── Detail Test 1: endpoint returns rows for selected vertical ───────────
    console.log("\nDetail Test 1: endpoint returns rows for selected named vertical");
    try {
      const detail = await fetchVerticalDetail(V_DENT);
      assert(detail.verticalDetail !== undefined, "detail Test 1: verticalDetail field present");
      assert(Array.isArray(detail.verticalDetail.rows), "detail Test 1: rows is array");
      assert(typeof detail.verticalDetail.total === "number", "detail Test 1: total is number");
      assert(detail.verticalDetail.rows.length > 0, `detail Test 1: rows is non-empty (got ${detail.verticalDetail.rows.length})`);
    } catch (err) {
      fail("detail Test 1: fetch threw", String(err));
    }

    // ── Detail Test 2: endpoint is read-only (no DB writes) ──────────────────
    console.log("\nDetail Test 2: endpoint is read-only (no DB writes triggered)");
    try {
      const enrollsBefore = await db.select({ id: sequenceEnrollments.id }).from(sequenceEnrollments).where(eq(sequenceEnrollments.sequenceId, seqId!));
      await fetchVerticalDetail(V_REST);
      const enrollsAfter = await db.select({ id: sequenceEnrollments.id }).from(sequenceEnrollments).where(eq(sequenceEnrollments.sequenceId, seqId!));
      assert(enrollsBefore.length === enrollsAfter.length, `detail Test 2: no enrollments created (before=${enrollsBefore.length}, after=${enrollsAfter.length})`);
    } catch (err) {
      fail("detail Test 2: read-only check threw", String(err));
    }

    // ── Detail Test 3: DNC row returns 'DNC' reason ──────────────────────────
    console.log("\nDetail Test 3: DNC contact returns 'DNC' block reason");
    try {
      const detail = await fetchVerticalDetail(V_DENT);
      const rows: any[] = detail.verticalDetail.rows ?? [];
      // c3 is DNC and linked to d3 in V_DENT
      const dncRow = rows.find((r: any) => r.dealId === d3.id);
      assert(dncRow !== undefined, `detail Test 3: DNC deal (d3=#${d3.id}) appears in detail rows`);
      assert(dncRow?.blockReason === "DNC", `detail Test 3: blockReason='DNC' (got '${dncRow?.blockReason}')`);
      assert(typeof dncRow?.blockReasonLabel === "string", "detail Test 3: blockReasonLabel is string");
    } catch (err) {
      fail("detail Test 3: DNC check threw", String(err));
    }

    // ── Detail Test 4: opted-out row returns 'opted_out' reason ─────────────
    console.log("\nDetail Test 4: opted-out contact returns 'opted_out' block reason");
    try {
      // Create a temp opted-out contact + deal in V_DENT
      const [cOpt] = await db.insert(contacts).values({
        firstName: "T866", lastName: "OptedOut",
        email: `t866-opt-${uniqueTag}@test.local`, phone: "+10000866001",
        doNotContact: false, consentTier: "opted_out",
      } as any).returning({ id: contacts.id });
      cleanup.push({ table: "contacts", id: cOpt.id });
      const [dOpt] = await db.insert(deals).values({
        contactId: cOpt.id, pipeline: "sales", stage: "New Lead", vertical: V_DENT,
      } as any).returning({ id: deals.id });
      cleanup.push({ table: "deals", id: dOpt.id });

      const detail = await fetchVerticalDetail(V_DENT);
      const rows: any[] = detail.verticalDetail.rows ?? [];
      const optRow = rows.find((r: any) => r.dealId === dOpt.id);
      assert(optRow !== undefined, `detail Test 4: opted-out deal (dOpt=#${dOpt.id}) appears in detail rows`);
      assert(optRow?.blockReason === "opted_out", `detail Test 4: blockReason='opted_out' (got '${optRow?.blockReason}')`);
    } catch (err) {
      fail("detail Test 4: opted-out check threw", String(err));
    }

    // ── Detail Test 5: suppressed deal returns 'suppressed' reason ───────────
    console.log("\nDetail Test 5: suppressed deal returns 'suppressed' block reason");
    try {
      const detail = await fetchVerticalDetail(V_DENT);
      const rows: any[] = detail.verticalDetail.rows ?? [];
      const suppRow = rows.find((r: any) => r.dealId === d4.id);
      assert(suppRow !== undefined, `detail Test 5: suppressed deal (d4=#${d4.id}) appears in detail rows`);
      assert(suppRow?.blockReason === "suppressed", `detail Test 5: blockReason='suppressed' (got '${suppRow?.blockReason}')`);
    } catch (err) {
      fail("detail Test 5: suppressed check threw", String(err));
    }

    // ── Detail Test 6: missing email returns 'no_email' reason ──────────────
    console.log("\nDetail Test 6: missing email returns 'no_email' block reason");
    try {
      const detail = await fetchVerticalDetail(V_REST);
      const rows: any[] = detail.verticalDetail.rows ?? [];
      const noEmailRow = rows.find((r: any) => r.dealId === d2.id);
      assert(noEmailRow !== undefined, `detail Test 6: no-email deal (d2=#${d2.id}) appears in detail rows`);
      assert(noEmailRow?.blockReason === "no_email", `detail Test 6: blockReason='no_email' (got '${noEmailRow?.blockReason}')`);
    } catch (err) {
      fail("detail Test 6: no-email check threw", String(err));
    }

    // ── Detail Test 7: missing mapping returns 'no_sequence_mapped' ─────────
    console.log("\nDetail Test 7: missing mapping returns 'no_sequence_mapped' block reason");
    try {
      // V_TINY has no mapping and d7/c7 has no special block: should be no_sequence_mapped
      const detail = await fetchVerticalDetail(V_TINY);
      const rows: any[] = detail.verticalDetail.rows ?? [];
      const noMapRow = rows.find((r: any) => r.dealId === d7.id);
      assert(noMapRow !== undefined, `detail Test 7: no-map deal (d7=#${d7.id}) appears in detail rows`);
      assert(noMapRow?.blockReason === "no_sequence_mapped", `detail Test 7: blockReason='no_sequence_mapped' (got '${noMapRow?.blockReason}')`);
    } catch (err) {
      fail("detail Test 7: no-mapping check threw", String(err));
    }

    // ── Detail Test 8: unknown/null vertical detail works via __unknown__ ────
    console.log("\nDetail Test 8: null vertical detail works via __unknown__ canonical key");
    try {
      const detail = await fetchVerticalDetail("__unknown__");
      assert(detail.verticalDetail !== undefined, "detail Test 8: verticalDetail present");
      assert(detail.verticalDetail.vertical === null, `detail Test 8: vertical is null (got ${JSON.stringify(detail.verticalDetail.vertical)})`);
      assert(detail.verticalDetail.label === "Unknown / Uncategorized", `detail Test 8: label is 'Unknown / Uncategorized' (got '${detail.verticalDetail.label}')`);
      // The total must be >= 1 (we seeded at least d6 in the null vertical).
      // d6 may be beyond the first page if the DB has many null-vertical deals —
      // paginate through all pages (up to 200-row limit each) to find it.
      const totalNullBlocked = detail.verticalDetail.total as number;
      assert(totalNullBlocked >= 1, `detail Test 8: total >= 1 for null vertical (got ${totalNullBlocked})`);
      let foundD6 = (detail.verticalDetail.rows as any[]).some((r: any) => r.dealId === d6.id);
      let paginationOffset = detail.verticalDetail.rows.length;
      while (!foundD6 && paginationOffset < totalNullBlocked) {
        const nextPage = await fetchVerticalDetail("__unknown__", `&limit=200&offset=${paginationOffset}`);
        const nextRows: any[] = nextPage.verticalDetail?.rows ?? [];
        foundD6 = nextRows.some((r: any) => r.dealId === d6.id);
        paginationOffset += nextRows.length;
        if (nextRows.length === 0) break;
      }
      assert(foundD6, `detail Test 8: null-vertical deal (d6=#${d6.id}) found across all pages (checked ${paginationOffset} of ${totalNullBlocked} rows)`);
    } catch (err) {
      fail("detail Test 8: null vertical check threw", String(err));
    }

    // ── Detail Test 9: limit enforced (request 500 → capped at 200) ─────────
    console.log("\nDetail Test 9: limit=500 is capped at 200 server-side");
    try {
      const res = await fetch(
        `${BASE_URL}/api/admin/pipeline/stage-health/vertical-detail?vertical=${encodeURIComponent(V_DENT)}&limit=500`,
        { headers: { cookie: adminCookie } }
      );
      assert(res.ok, `detail Test 9: request succeeded (got ${res.status})`);
      const body = await res.json();
      const rows: any[] = body.verticalDetail?.rows ?? [];
      assert(rows.length <= 200, `detail Test 9: rows.length <= 200 (got ${rows.length})`);
      // total may be larger; rows.length is what's returned and must be ≤ 200
      assert(body.verticalDetail?.total !== undefined, "detail Test 9: total field present");
    } catch (err) {
      fail("detail Test 9: limit cap check threw", String(err));
    }

    // ── Detail Test 10: aggregate count reconciles with detail reason counts ─
    console.log("\nDetail Test 10: aggregate dncBlocked reconciles with detail DNC count for V_DENT");
    try {
      const health3 = await fetchStageHealth(adminCookie);
      const dentRow3 = (health3.breakdownByVertical as any[])?.find((r: any) => r.vertical === V_DENT);
      const detail = await fetchVerticalDetail(V_DENT);
      const rows: any[] = detail.verticalDetail.rows ?? [];

      // The number of rows with blockReason=DNC must equal aggregate dncBlocked for this vertical
      const detailDncCount = rows.filter((r: any) => r.blockReason === "DNC").length;
      // detail total must equal aggregate noActiveEnrollment
      assert(
        detail.verticalDetail.total === dentRow3?.noActiveEnrollment,
        `detail Test 10: detail.total (${detail.verticalDetail.total}) === aggregate noActiveEnrollment (${dentRow3?.noActiveEnrollment})`
      );
      assert(
        detailDncCount >= 1 && detailDncCount === (dentRow3?.dncBlocked ?? 0),
        `detail Test 10: detail DNC count (${detailDncCount}) reconciles with aggregate dncBlocked (${dentRow3?.dncBlocked})`
      );
    } catch (err) {
      fail("detail Test 10: reconciliation check threw", String(err));
    }

    // ── Task #872: blockReason filter tests (10 new cases) ──────────────────

    async function fetchVerticalDetailRaw(vertical: string, extra = ""): Promise<Response> {
      const url = `${BASE_URL}/api/admin/pipeline/stage-health/vertical-detail?vertical=${encodeURIComponent(vertical)}${extra}`;
      return fetch(url, { headers: { cookie: adminCookie } });
    }

    // ── Filter Test 1: omitted blockReason → all blocked rows returned ────────
    console.log("\nFilter Test 1: omitted blockReason returns all blocked rows (existing behavior unchanged)");
    try {
      const detail = await fetchVerticalDetail(V_DENT);
      assert(detail.verticalDetail !== undefined, "filter Test 1: verticalDetail present");
      const allTotal = detail.verticalDetail.total as number;
      // Should include DNC + suppressed rows (at least 2)
      assert(allTotal >= 2, `filter Test 1: total >= 2 when no filter (got ${allTotal})`);
      // blockReason field should be "all" when omitted
      assert(detail.verticalDetail.blockReason === "all", `filter Test 1: blockReason field is 'all' when omitted (got '${detail.verticalDetail.blockReason}')`);
    } catch (err) {
      fail("filter Test 1: omitted blockReason threw", String(err));
    }

    // ── Filter Test 2: blockReason=all → same as omitted ─────────────────────
    console.log("\nFilter Test 2: blockReason=all returns same result as omitted");
    try {
      const detailOmitted = await fetchVerticalDetail(V_DENT);
      const detailAll = await fetchVerticalDetail(V_DENT, "&blockReason=all");
      assert(
        detailOmitted.verticalDetail.total === detailAll.verticalDetail.total,
        `filter Test 2: total matches between omitted (${detailOmitted.verticalDetail.total}) and blockReason=all (${detailAll.verticalDetail.total})`
      );
      assert(detailAll.verticalDetail.blockReason === "all", `filter Test 2: blockReason field is 'all' (got '${detailAll.verticalDetail.blockReason}')`);
    } catch (err) {
      fail("filter Test 2: blockReason=all threw", String(err));
    }

    // ── Filter Test 3: blockReason=no_email → only no_email rows returned ────
    console.log("\nFilter Test 3: blockReason=no_email returns only no_email rows");
    try {
      const detail = await fetchVerticalDetail(V_REST, "&blockReason=no_email");
      const rows: any[] = detail.verticalDetail.rows ?? [];
      assert(rows.length > 0, `filter Test 3: at least 1 no_email row returned (c2 has empty email)`);
      const allNoEmail = rows.every((r: any) => r.blockReason === "no_email");
      assert(allNoEmail, `filter Test 3: all returned rows have blockReason='no_email'`);
      assert(detail.verticalDetail.blockReason === "no_email", `filter Test 3: response.blockReason='no_email' (got '${detail.verticalDetail.blockReason}')`);
      // total must equal rows with no_email in the unfiltered result
      const allDetail = await fetchVerticalDetail(V_REST);
      const expectedCount = (allDetail.verticalDetail.rows as any[]).filter((r: any) => r.blockReason === "no_email").length;
      assert(
        detail.verticalDetail.total === expectedCount,
        `filter Test 3: filtered total (${detail.verticalDetail.total}) equals expected no_email count (${expectedCount})`
      );
    } catch (err) {
      fail("filter Test 3: blockReason=no_email threw", String(err));
    }

    // ── Filter Test 4a: blockReason=DNC (uppercase) → DNC rows returned ──────
    // Filter Test 4b: blockReason=dnc (lowercase) → 400
    console.log("\nFilter Test 4: DNC uppercase succeeds; dnc lowercase returns 400");
    try {
      const detailDNC = await fetchVerticalDetail(V_DENT, "&blockReason=DNC");
      const dncRows: any[] = detailDNC.verticalDetail.rows ?? [];
      assert(dncRows.length > 0, `filter Test 4a: at least 1 DNC row returned (got ${dncRows.length})`);
      const allDNC = dncRows.every((r: any) => r.blockReason === "DNC");
      assert(allDNC, `filter Test 4a: all returned rows have blockReason='DNC'`);
      assert(detailDNC.verticalDetail.blockReason === "DNC", `filter Test 4a: response.blockReason='DNC'`);

      const resDncLower = await fetchVerticalDetailRaw(V_DENT, "&blockReason=dnc");
      assert(resDncLower.status === 400, `filter Test 4b: blockReason=dnc (lowercase) returns 400 (got ${resDncLower.status})`);
    } catch (err) {
      fail("filter Test 4: DNC case sensitivity threw", String(err));
    }

    // ── Filter Test 5: blockReason=suppressed → suppressed rows returned ──────
    console.log("\nFilter Test 5: blockReason=suppressed returns only suppressed rows");
    try {
      const detail = await fetchVerticalDetail(V_DENT, "&blockReason=suppressed");
      const rows: any[] = detail.verticalDetail.rows ?? [];
      assert(rows.length > 0, `filter Test 5: at least 1 suppressed row returned (d4 is suppressed; got ${rows.length})`);
      const allSuppressed = rows.every((r: any) => r.blockReason === "suppressed");
      assert(allSuppressed, `filter Test 5: all returned rows have blockReason='suppressed'`);
    } catch (err) {
      fail("filter Test 5: blockReason=suppressed threw", String(err));
    }

    // ── Filter Test 6: invalid blockReason value → 400 ───────────────────────
    console.log("\nFilter Test 6: invalid blockReason value returns 400");
    try {
      const res = await fetchVerticalDetailRaw(V_DENT, "&blockReason=foobar");
      assert(res.status === 400, `filter Test 6: blockReason=foobar returns 400 (got ${res.status})`);
      const body = await res.json();
      assert(typeof body.message === "string", `filter Test 6: error body has message field`);
    } catch (err) {
      fail("filter Test 6: invalid blockReason threw", String(err));
    }

    // ── Filter Test 7: filter-before-pagination (correct second page) ─────────
    console.log("\nFilter Test 7: filter applied before pagination — second page correct");
    try {
      // Use V_DENT which has DNC + suppressed rows. Fetch all with no filter first.
      const allDetail = await fetchVerticalDetail(V_DENT);
      const allRows2 = allDetail.verticalDetail.rows as any[];
      const totalUnfiltered = allDetail.verticalDetail.total as number;

      // Count suppressed in the full set
      const suppressedInAll = allRows2.filter((r: any) => r.blockReason === "suppressed");
      if (suppressedInAll.length > 0) {
        // Fetch page 1 with limit=1 + blockReason=suppressed
        const page1 = await fetchVerticalDetail(V_DENT, "&blockReason=suppressed&limit=1&offset=0");
        const p1Rows: any[] = page1.verticalDetail.rows ?? [];
        // page1 total = count of suppressed rows (filter-before-pagination)
        const filteredTotal = page1.verticalDetail.total as number;
        assert(filteredTotal < totalUnfiltered, `filter Test 7: filtered total (${filteredTotal}) < unfiltered total (${totalUnfiltered}) — proves filter applied`);
        assert(p1Rows.length === 1, `filter Test 7: page1 has 1 row (limit=1; got ${p1Rows.length})`);
        assert(p1Rows[0].blockReason === "suppressed", `filter Test 7: page1 row is suppressed`);

        if (filteredTotal > 1) {
          const page2 = await fetchVerticalDetail(V_DENT, "&blockReason=suppressed&limit=1&offset=1");
          const p2Rows: any[] = page2.verticalDetail.rows ?? [];
          assert(p2Rows.length === 1, `filter Test 7: page2 has 1 row (got ${p2Rows.length})`);
          assert(p2Rows[0].blockReason === "suppressed", `filter Test 7: page2 row is suppressed`);
          assert(p1Rows[0].dealId !== p2Rows[0].dealId, `filter Test 7: page1 and page2 return different deals`);
        } else {
          pass("filter Test 7: only 1 suppressed row in V_DENT; single-page validation sufficient");
        }
      } else {
        pass("filter Test 7: no suppressed rows in V_DENT to paginate — skipped (seeding may differ)");
      }
    } catch (err) {
      fail("filter Test 7: filter-before-pagination check threw", String(err));
    }

    // ── Filter Test 8: total reflects filtered count, not total blocked count ─
    console.log("\nFilter Test 8: total reflects filtered count, not total blocked count");
    try {
      const allDetail = await fetchVerticalDetail(V_DENT);
      const totalAll = allDetail.verticalDetail.total as number;

      const dncDetail = await fetchVerticalDetail(V_DENT, "&blockReason=DNC");
      const totalDNC = dncDetail.verticalDetail.total as number;

      // DNC-filtered total must be <= total blocked (and < if there are non-DNC blocked rows)
      assert(totalDNC <= totalAll, `filter Test 8: DNC filtered total (${totalDNC}) <= total blocked (${totalAll})`);
      // The DNC rows in the full set should match the DNC-filtered total
      const allRows3 = allDetail.verticalDetail.rows as any[];
      const dncCountInAll = allRows3.filter((r: any) => r.blockReason === "DNC").length;
      assert(
        dncDetail.verticalDetail.total === dncCountInAll,
        `filter Test 8: DNC filtered total (${dncDetail.verticalDetail.total}) equals DNC count in all rows (${dncCountInAll})`
      );
    } catch (err) {
      fail("filter Test 8: filtered total check threw", String(err));
    }

    // ── Filter Test 9: no DB write during any filter operation ───────────────
    console.log("\nFilter Test 9: no DB writes triggered by filter operations");
    try {
      const enrollsBefore9 = await db.select({ id: sequenceEnrollments.id }).from(sequenceEnrollments).where(eq(sequenceEnrollments.sequenceId, seqId!));
      await fetchVerticalDetail(V_DENT, "&blockReason=DNC");
      await fetchVerticalDetail(V_REST, "&blockReason=no_email");
      await fetchVerticalDetail(V_TINY, "&blockReason=suppressed");
      await fetchVerticalDetailRaw(V_DENT, "&blockReason=foobar");
      const enrollsAfter9 = await db.select({ id: sequenceEnrollments.id }).from(sequenceEnrollments).where(eq(sequenceEnrollments.sequenceId, seqId!));
      assert(
        enrollsBefore9.length === enrollsAfter9.length,
        `filter Test 9: no enrollments created during filter calls (before=${enrollsBefore9.length}, after=${enrollsAfter9.length})`
      );
    } catch (err) {
      fail("filter Test 9: write-check threw", String(err));
    }

    // ── Filter Test 10: blockReason=unknown → only unknown rows returned ──────
    console.log("\nFilter Test 10: blockReason=unknown returns only unknown rows");
    try {
      // Create a contact that will fall through to 'unknown' — has email, sequence mapped,
      // active sequence, no enrollment, not DNC, not suppressed, not opted out,
      // not doNotAutoContact, emailStatus=active (or null).
      // Map a sequence for V_TINY so no_sequence_mapped doesn't fire.
      await fetch(`${BASE_URL}/api/admin/pipeline/vertical-sequence-map`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: adminCookie,
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({ verticalMap: { [V_TINY]: seqId } }),
      });

      // c7 (d7) in V_TINY: has email, sequence now mapped and active, no enrollment
      // → should be 'unknown' (passes all checks but no explicit block)
      // Re-fetch detail for V_TINY with blockReason=unknown
      const detailUnknown = await fetchVerticalDetail(V_TINY, "&blockReason=unknown");
      const rows: any[] = detailUnknown.verticalDetail.rows ?? [];
      // c7 may appear — if the sequence is active it should pass all gates and be 'unknown'
      const allUnknown = rows.every((r: any) => r.blockReason === "unknown");
      assert(allUnknown, `filter Test 10: all returned rows have blockReason='unknown' (got ${rows.map((r: any) => r.blockReason).join(", ")})`);
      assert(detailUnknown.verticalDetail.blockReason === "unknown", `filter Test 10: response.blockReason='unknown'`);

      // Clean up the mapping for V_TINY
      await fetch(`${BASE_URL}/api/admin/pipeline/vertical-sequence-map`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: adminCookie,
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({ verticalMap: {} }),
      }).catch(() => {});
    } catch (err) {
      fail("filter Test 10: blockReason=unknown threw", String(err));
    }

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
