#!/usr/bin/env tsx
/**
 * Task 713 — SDR Manual Email Enrollment Smoke Test
 *
 * Tests all gates on POST /api/contacts/:id/sdr-enroll and
 * read-only behaviour of GET /api/contacts/:id/contactability-status.
 *
 * Test cases (in order):
 *  1. Non-SDR contact → 403 "Contact is not SDR-sourced"
 *  2. confirmed: false → 400 "Explicit confirmation required"
 *  3. Non-email sequence (has sms step) → 422 "not email-only"
 *  4. DNC contact → 403 with audit row in consentAuditLogs
 *  5. opted_out contact → 403
 *  6. Duplicate active enrollment → 409 { alreadyEnrolled: true }
 *  7. Happy path → 200 { enrolled: true } and row in sequenceEnrollments
 *  8. GET /contactability-status → 200, no new rows written
 *
 * Run (dev server must be up):
 *   BASE_URL=http://localhost:5000 npx tsx scripts/test-sdr-manual-enroll.ts
 *
 * Exit: 0 = all pass, 1 = any fail.
 */

import bcrypt from "bcryptjs";
import { db } from "../server/db";
import {
  contacts,
  sdrLeadState,
  sdrMerchants,
  followUpSequences,
  sequenceSteps,
  sequenceEnrollments,
  consentAuditLogs,
} from "../shared/schema";
import { users } from "../shared/models/auth";
import { eq, and, desc, count } from "drizzle-orm";
import { pool } from "../server/db";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:5000";
const TEST_AGENT_EMAIL = "sdr-enroll-test-agent@libertybancard.test";
const TEST_AGENT_PASSWORD = "sdr-enroll-Test-Pw7!";

let passed = 0;
let failed = 0;
const failures: string[] = [];

// IDs to clean up after tests
const createdContactIds: number[] = [];
const createdMerchantIds: number[] = [];
const createdLeadStateIds: number[] = [];
const createdSequenceIds: number[] = [];
const createdEnrollmentIds: number[] = [];

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
    failures.push(label);
  }
}

async function ensureTestAgent(): Promise<void> {
  const passwordHash = await bcrypt.hash(TEST_AGENT_PASSWORD, 12);
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, TEST_AGENT_EMAIL));
  if (existing.length === 0) {
    await db.insert(users).values({
      email: TEST_AGENT_EMAIL,
      firstName: "SDREnroll",
      lastName: "TestAgent",
      passwordHash,
      role: "agent",
      authProvider: "local",
      emailVerified: new Date(),
    });
  } else {
    await db.update(users)
      .set({ passwordHash, role: "agent", authProvider: "local", emailVerified: new Date() })
      .where(eq(users.email, TEST_AGENT_EMAIL));
  }
}

async function loginForCookie(email: string, password: string): Promise<string> {
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

async function fetchCsrfToken(cookie: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/csrf-token`, {
    headers: { Cookie: cookie },
  });
  if (res.status !== 200) throw new Error(`CSRF token fetch failed: ${res.status}`);
  const body = await res.json();
  return body.token as string;
}

async function makeContact(overrides: {
  firstName?: string;
  doNotContact?: boolean;
  doNotAutoContact?: boolean;
  consentTier?: string;
  emailStatus?: string;
  dncReason?: string;
} = {}): Promise<number> {
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const [row] = await db.insert(contacts).values({
    firstName: overrides.firstName ?? "SDRTest",
    lastName: "EnrollQA",
    email: `sdr-enroll-test-${tag}@libertybancard.test`,
    phone: "3055551234",
    companyName: `SDR Enroll QA Co ${tag}`,
    emailStatus: overrides.emailStatus ?? "active",
    doNotContact: overrides.doNotContact ?? false,
    doNotAutoContact: overrides.doNotAutoContact ?? false,
    consentTier: overrides.consentTier ?? "cold_no_consent",
    ...(overrides.dncReason ? { dncReason: overrides.dncReason } : {}),
  }).returning({ id: contacts.id });
  createdContactIds.push(row.id);
  return row.id;
}

async function makeSdrContactId(contactId: number): Promise<number> {
  // sdrLeadState requires a merchant row
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const [merch] = await db.insert(sdrMerchants).values({
    businessName: `SDREnroll Test Merchant ${tag}`,
    email: `sdr-merch-${tag}@libertybancard.test`,
    status: "discovered",
    sourceType: "import",
  }).returning({ id: sdrMerchants.id });
  createdMerchantIds.push(merch.id);

  const [lead] = await db.insert(sdrLeadState).values({
    merchantId: merch.id,
    contactId,
    stage: "DISCOVERED",
    currentStage: "DISCOVERED",
  }).returning({ id: sdrLeadState.id });
  createdLeadStateIds.push(lead.id);
  return lead.id;
}

async function makeEmailSequence(opts: {
  withSmsStep?: boolean;
  status?: string;
} = {}): Promise<number> {
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const channelsAllowed = opts.withSmsStep ? null : ["email"];
  const [seq] = await db.insert(followUpSequences).values({
    name: `SDREnroll Test Seq ${tag}`,
    status: opts.status ?? "active",
    triggerType: "manual",
    channelsAllowed,
  }).returning({ id: followUpSequences.id });
  createdSequenceIds.push(seq.id);

  // Add step(s)
  if (opts.withSmsStep) {
    await db.insert(sequenceSteps).values({
      sequenceId: seq.id,
      stepOrder: 1,
      actionType: "sms",
      delayDays: 0,
      delayHours: 0,
      subject: "Test SMS step",
      body: "Test",
    });
  } else {
    await db.insert(sequenceSteps).values({
      sequenceId: seq.id,
      stepOrder: 1,
      actionType: "email",
      delayDays: 0,
      delayHours: 1,
      subject: "Test email",
      body: "Hello",
    });
  }

  return seq.id;
}

async function cleanUp() {
  for (const id of createdEnrollmentIds) {
    await db.delete(sequenceEnrollments).where(eq(sequenceEnrollments.id, id));
  }
  for (const id of createdLeadStateIds) {
    await db.delete(sdrLeadState).where(eq(sdrLeadState.id, id));
  }
  for (const id of createdMerchantIds) {
    await db.delete(sdrMerchants).where(eq(sdrMerchants.id, id));
  }
  // Delete sequence steps before sequences
  for (const id of createdSequenceIds) {
    await db.delete(sequenceSteps).where(eq(sequenceSteps.sequenceId, id));
    await db.delete(followUpSequences).where(eq(followUpSequences.id, id));
  }
  // Delete consentAuditLogs before contacts (FK constraint)
  for (const id of createdContactIds) {
    await db.delete(consentAuditLogs).where(eq(consentAuditLogs.contactId, id));
  }
  for (const id of createdContactIds) {
    await db.delete(contacts).where(eq(contacts.id, id));
  }
  console.log("  [cleanup] test fixtures removed");
}

async function runTests() {
  console.log("\n=== SDR Manual Email Enrollment Smoke Test ===\n");

  await ensureTestAgent();
  const cookie = await loginForCookie(TEST_AGENT_EMAIL, TEST_AGENT_PASSWORD);
  const csrfToken = await fetchCsrfToken(cookie);

  async function post(contactId: number, body: object): Promise<{ status: number; json: any }> {
    const res = await fetch(`${BASE_URL}/api/contacts/${contactId}/sdr-enroll`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": cookie,
        "X-CSRF-Token": csrfToken,
      },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  }

  async function getStatus(contactId: number): Promise<{ status: number; json: any }> {
    const res = await fetch(`${BASE_URL}/api/contacts/${contactId}/contactability-status`, {
      headers: { Cookie: cookie },
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  }

  // ── Test 1: Non-SDR contact → 403 ───────────────────────────────────────
  console.log("Test 1: Non-SDR contact → 403");
  {
    const contactId = await makeContact();
    const seqId = await makeEmailSequence();
    const r = await post(contactId, { sequenceId: seqId, confirmed: true });
    assert("non-SDR contact returns 403", r.status === 403, `got ${r.status}: ${r.json?.message}`);
    assert("non-SDR message correct", r.json?.message?.includes("not SDR-sourced"), r.json?.message);
  }

  // ── Test 2: confirmed: false → 400 ──────────────────────────────────────
  console.log("\nTest 2: confirmed: false → 400");
  {
    const contactId = await makeContact();
    await makeSdrContactId(contactId);
    const seqId = await makeEmailSequence();
    const r = await post(contactId, { sequenceId: seqId, confirmed: false });
    assert("confirmed:false returns 400", r.status === 400, `got ${r.status}: ${r.json?.message}`);
    assert("confirmation message correct", r.json?.message?.includes("confirmation required"), r.json?.message);
  }

  // ── Test 3: Non-email sequence → 422 ─────────────────────────────────────
  console.log("\nTest 3: Non-email sequence (SMS step) → 422");
  {
    const contactId = await makeContact();
    await makeSdrContactId(contactId);
    const seqId = await makeEmailSequence({ withSmsStep: true });
    const r = await post(contactId, { sequenceId: seqId, confirmed: true });
    assert("non-email sequence returns 422", r.status === 422, `got ${r.status}: ${r.json?.message}`);
    assert("non-email message mentions SMS/voice", r.json?.message?.toLowerCase().includes("email-only") || r.json?.message?.toLowerCase().includes("sms"), r.json?.message);
  }

  // ── Test 4: doNotAutoContact contact → 403 with audit log ───────────────
  // Using doNotAutoContact:true (not doNotContact) so canEnrollContactInSequence passes
  // but evaluateContactability(enforcement) blocks — and writes the consentAuditLogs row.
  console.log("\nTest 4: doNotAutoContact contact → 403 with consentAuditLogs entry");
  {
    const contactId = await makeContact({ doNotAutoContact: true });
    await makeSdrContactId(contactId);
    const seqId = await makeEmailSequence();

    // Count audit logs before
    const [beforeCount] = await db.select({ n: count() }).from(consentAuditLogs)
      .where(eq(consentAuditLogs.contactId, contactId));
    const before = Number(beforeCount.n);

    const r = await post(contactId, { sequenceId: seqId, confirmed: true });
    assert("DNC contact returns 403", r.status === 403, `got ${r.status}: ${r.json?.message}`);

    // Audit log should have been written by evaluateContactability(enforcement mode)
    const [afterCount] = await db.select({ n: count() }).from(consentAuditLogs)
      .where(eq(consentAuditLogs.contactId, contactId));
    const after = Number(afterCount.n);
    assert("audit log written for DNC block", after > before, `before=${before} after=${after}`);
  }

  // ── Test 5: opted-out email → 403 from evaluateContactability ───────────
  // Using emailStatus:"opted_out" (not consentTier:"opted_out") so canEnrollContactInSequence
  // passes (it checks consentTier, not emailStatus) but evaluateContactability step 5 blocks
  // with 403 and writes the consentAuditLogs row since email is an AUTOMATED_CHANNEL.
  console.log("\nTest 5: emailStatus opted_out → 403 from contactability engine");
  {
    const contactId = await makeContact({ emailStatus: "opted_out" });
    await makeSdrContactId(contactId);
    const seqId = await makeEmailSequence();
    const r = await post(contactId, { sequenceId: seqId, confirmed: true });
    assert("opted-out email contact returns 403", r.status === 403, `got ${r.status}: ${r.json?.message}`);
  }

  // ── Test 6: Duplicate enrollment → 409 ───────────────────────────────────
  console.log("\nTest 6: Duplicate active enrollment → 409");
  {
    const contactId = await makeContact();
    await makeSdrContactId(contactId);
    const seqId = await makeEmailSequence();

    // First enrollment should succeed
    const r1 = await post(contactId, { sequenceId: seqId, confirmed: true });
    assert("first enrollment succeeds (200)", r1.status === 200, `got ${r1.status}: ${r1.json?.message}`);

    if (r1.status === 200) {
      // Track the enrollment for cleanup
      const [enrolled] = await db.select({ id: sequenceEnrollments.id })
        .from(sequenceEnrollments)
        .where(and(eq(sequenceEnrollments.contactId, contactId), eq(sequenceEnrollments.sequenceId, seqId)))
        .limit(1);
      if (enrolled) createdEnrollmentIds.push(enrolled.id);
    }

    // Second enrollment should be 409
    const r2 = await post(contactId, { sequenceId: seqId, confirmed: true });
    assert("duplicate enrollment returns 409", r2.status === 409, `got ${r2.status}: ${r2.json?.message}`);
    assert("409 body has alreadyEnrolled:true", r2.json?.alreadyEnrolled === true, JSON.stringify(r2.json));
  }

  // ── Test 7: Happy path → 200 and DB row ──────────────────────────────────
  console.log("\nTest 7: Happy path → 200 and sequenceEnrollments row");
  {
    const contactId = await makeContact();
    await makeSdrContactId(contactId);
    const seqId = await makeEmailSequence();

    const r = await post(contactId, { sequenceId: seqId, confirmed: true });
    assert("happy path returns 200", r.status === 200, `got ${r.status}: ${r.json?.message}`);
    assert("response has enrolled:true", r.json?.enrolled === true, JSON.stringify(r.json));
    assert("response has sequenceId", r.json?.sequenceId === seqId, JSON.stringify(r.json));

    // Check DB row
    const rows = await db.select().from(sequenceEnrollments)
      .where(and(eq(sequenceEnrollments.contactId, contactId), eq(sequenceEnrollments.sequenceId, seqId)));
    assert("sequenceEnrollments row created", rows.length === 1, `found ${rows.length} rows`);
    assert("enrollment status is active", rows[0]?.status === "active", rows[0]?.status ?? "no row");

    if (rows[0]) createdEnrollmentIds.push(rows[0].id);
  }

  // ── Test 8: GET /contactability-status — read-only, no new rows ──────────
  console.log("\nTest 8: GET /contactability-status is read-only");
  {
    const contactId = await makeContact();
    await makeSdrContactId(contactId);

    const [beforeCount] = await db.select({ n: count() }).from(consentAuditLogs)
      .where(eq(consentAuditLogs.contactId, contactId));
    const before = Number(beforeCount.n);

    const r = await getStatus(contactId);
    assert("GET contactability-status returns 200", r.status === 200, `got ${r.status}`);
    assert("response has sdrSourced:true", r.json?.sdrSourced === true, JSON.stringify(r.json));
    assert("response has allowed field", "allowed" in r.json, JSON.stringify(r.json));
    assert("response has channel:email", r.json?.channel === "email", r.json?.channel);

    const [afterCount] = await db.select({ n: count() }).from(consentAuditLogs)
      .where(eq(consentAuditLogs.contactId, contactId));
    const after = Number(afterCount.n);
    assert("GET status writes zero audit log rows (dryRun)", after === before, `before=${before} after=${after}`);

    // Non-SDR contact should return sdrSourced: false
    const nonSdrContactId = await makeContact();
    const r2 = await getStatus(nonSdrContactId);
    assert("non-SDR contact returns sdrSourced:false", r2.json?.sdrSourced === false, JSON.stringify(r2.json));
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failures.length > 0) {
    console.error("Failures:");
    for (const f of failures) console.error(`  - ${f}`);
  }
}

runTests()
  .then(async () => {
    await cleanUp();
    await pool.end();
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch(async (err) => {
    console.error("Fatal error:", err);
    await cleanUp().catch(() => {});
    await pool.end();
    process.exit(1);
  });
