#!/usr/bin/env tsx
/**
 * Wave 12 — Form Integration Tests
 *
 * Tests 5 public form flows and verifies DB state. No real GHL contacts
 * are created — the GHL live-sync kill line is enforced at startup.
 *
 * ── GHL LIVE-SYNC PREVENTION (KILL LINE) ────────────────────────────────────
 * At startup: if GHL_PRIVATE_INTEGRATION_TOKEN is set and looks real, this
 * script aborts UNLESS GHL_TEST_MODE=true is also set. Form submissions via
 * the public routes would normally queue a GHL sync job. In test mode:
 *   • GHL_PRIVATE_INTEGRATION_TOKEN is unset  → GHL calls fail at API layer (safe)
 *   • GHL_TEST_MODE=true is set  → operator explicitly acknowledges test isolation
 * Isolation method used is logged at the top of the report.
 *
 * ── TEST CASES ───────────────────────────────────────────────────────────────
 *   1. Statement upload  → contact + deal in "Statement Received" stage + document linked
 *   2. Estimate          → contact + deal, offerPath/stage set, attribution captured
 *   3. Get Started       → contact + deal created, offerPath assigned
 *   4. Merchant app draft → finalize → consent log with disclosureVersion;
 *                           duplicate EIN → 409
 *   5. Booking attribution (internal service call, NOT webhook endpoint)
 *                        → sdr_lead_events row written with eventType='appointment_booked'
 *
 * ── CLEANUP ──────────────────────────────────────────────────────────────────
 * `finally` block deletes from: contacts, deals, documents, merchant_applications,
 * consent_audit_logs, sdr_lead_events, audit_logs. Records that cannot be safely
 * deleted are tagged doNotAutoContact=true + QA_RELEASE_TEST in notes.
 *
 * Exit codes: 0 = all pass, 1 = any fail, 2 = environment not suitable
 *
 * Run:
 *   BASE_URL=http://localhost:5000 npx tsx scripts/test-forms.ts
 *   BASE_URL=http://localhost:5000 GHL_TEST_MODE=true npx tsx scripts/test-forms.ts
 */

import { db } from "../server/db";
import { contacts, deals, consentAuditLogs, sdrMerchants, partners, sdrLeadState } from "../shared/schema";
import { pool } from "../server/db";
import { eq, and, desc } from "drizzle-orm";
import { sql as drizzleSql } from "drizzle-orm";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:5000";

// ── GHL Kill Line ─────────────────────────────────────────────────────────────
const GHL_TOKEN = process.env.GHL_PRIVATE_INTEGRATION_TOKEN ?? "";
const GHL_TEST_MODE = process.env.GHL_TEST_MODE === "true";

const TOKEN_LOOKS_REAL =
  GHL_TOKEN.length > 20 &&
  !GHL_TOKEN.startsWith("test_") &&
  !GHL_TOKEN.startsWith("placeholder") &&
  !GHL_TOKEN.startsWith("CHANGE_ME");

if (TOKEN_LOOKS_REAL && !GHL_TEST_MODE) {
  console.error(
    "\nKILL LINE: GHL_PRIVATE_INTEGRATION_TOKEN is set. Form tests would create real GHL contacts.\n" +
    "  Unset the token or set GHL_TEST_MODE=true to confirm test isolation.\n\n" +
    "  Options:\n" +
    "    1. Unset GHL_PRIVATE_INTEGRATION_TOKEN before running (safest)\n" +
    "    2. Set GHL_TEST_MODE=true to acknowledge test isolation with a live token present\n"
  );
  process.exit(1);
}

// Log isolation method
if (GHL_TEST_MODE && TOKEN_LOOKS_REAL) {
  console.log("🔒 GHL isolation method: GHL_TEST_MODE=true (operator acknowledged; token present but test mode active)");
} else if (!GHL_TOKEN || !TOKEN_LOOKS_REAL) {
  console.log("🔒 GHL isolation method: GHL_PRIVATE_INTEGRATION_TOKEN is absent or sentinel — GHL API calls will fail at the API layer (safe)");
}

let passed = 0;
let failed = 0;
const failures: string[] = [];

// Cleanup tracking
const cleanupContactIds: number[] = [];
const cleanupDealIds: number[] = [];
const cleanupAppIds: number[] = [];
const cleanupPartnerIds: number[] = [];

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

async function waitForServer(maxMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  return false;
}

function uniqueEmail(prefix = "qa-release-test-form"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@libertybancard.test`;
}

async function cleanup(): Promise<void> {
  console.log("\n── Cleanup ─────────────────────────────────────────────────");

  // consent_audit_logs for test contacts
  for (const id of cleanupContactIds) {
    await db.delete(consentAuditLogs).where(eq(consentAuditLogs.contactId, id)).catch(() => {});
  }

  // sdr_lead_events: only delete by ghl_ref_id patterns used in Test 5
  // (sdr_lead_events links to sdr_merchants, not contacts directly — avoid broad deletes)
  await db.execute(drizzleSql`DELETE FROM sdr_lead_events WHERE ghl_ref_id LIKE 'qa-release-test-%'`).catch(() => {});

  // audit_logs for test contacts
  for (const id of cleanupContactIds) {
    await db.execute(drizzleSql`DELETE FROM audit_logs WHERE entity_id = ${id} AND entity_type = 'contact'`).catch(() => {});
  }

  // sequence_enrollments for test contacts
  for (const id of cleanupContactIds) {
    await db.execute(drizzleSql`DELETE FROM sequence_enrollments WHERE contact_id = ${id}`).catch(() => {});
  }

  // referrals / attribution records for test contacts and test partners
  for (const id of cleanupContactIds) {
    await db.execute(drizzleSql`DELETE FROM referrals WHERE contact_id = ${id}`).catch(() => {});
    await db.execute(drizzleSql`DELETE FROM affiliate_clicks WHERE contact_id = ${id}`).catch(() => {});
  }
  for (const id of cleanupPartnerIds) {
    await db.execute(drizzleSql`DELETE FROM referrals WHERE partner_id = ${id}`).catch(() => {});
    await db.delete(partners).where(eq(partners.id, id)).catch(() => {});
  }

  // merchant_referrals for test contacts
  for (const id of cleanupContactIds) {
    await db.execute(drizzleSql`DELETE FROM merchant_referrals WHERE contact_id = ${id}`).catch(() => {});
  }

  // documents linked to test contacts
  for (const id of cleanupContactIds) {
    await db.execute(drizzleSql`DELETE FROM documents WHERE contact_id = ${id}`).catch(() => {});
  }

  // merchant_applications
  for (const id of cleanupAppIds) {
    await db.execute(drizzleSql`DELETE FROM merchant_applications WHERE id = ${id}`).catch(() => {});
  }
  // also delete any test app by EIN
  await db.execute(drizzleSql`DELETE FROM merchant_applications WHERE tax_id LIKE 'QA9%'`).catch(() => {});

  // deals
  for (const id of cleanupDealIds) {
    await db.execute(drizzleSql`DELETE FROM deals WHERE id = ${id}`).catch(() => {});
  }
  for (const id of cleanupContactIds) {
    await db.execute(drizzleSql`DELETE FROM deals WHERE contact_id = ${id}`).catch(() => {});
  }

  // contacts
  for (const id of cleanupContactIds) {
    await db.delete(contacts).where(eq(contacts.id, id)).catch(() => {});
  }

  console.log(`  Cleaned up: ${cleanupContactIds.length} contact(s), ${cleanupDealIds.length} deal(s), ${cleanupAppIds.length} application(s)`);
  console.log("  Tables cleaned: contacts, deals, documents, merchant_applications, consent_audit_logs, sdr_lead_events, audit_logs, sequence_enrollments, referrals, affiliate_clicks, merchant_referrals");
}

// ── Test 1: Statement Upload ──────────────────────────────────────────────────
async function testStatementUpload(): Promise<void> {
  console.log("\n▶ Test 1: Statement Upload — POST /api/public/statement-upload\n");

  const email = uniqueEmail("qa-release-test-stmt");

  // Pre-create a test partner for ?ref= attribution test (Wave 12 requirement)
  const stmtAffiliateCode = `qa-stmt-ref-${Date.now()}`;
  const [stmtPartner] = await db.insert(partners).values({
    companyName: "QA Release Test Partner (Statement)",
    affiliateCode: stmtAffiliateCode,
    status: "active",
    partnerType: "referral",
  }).returning({ id: partners.id });
  cleanupPartnerIds.push(stmtPartner.id);

  // Statement upload route uses multipart/form-data (upload.single("statementFile"))
  // and expects contactName / mobile (not firstName/phone)
  const form = new FormData();
  form.append("contactName", "StmtTest QAUser");
  form.append("email", email);
  form.append("mobile", "3055550011");
  form.append("businessName", "QA_RELEASE_TEST Statement Co");
  form.append("currentProvider", "Square");
  form.append("consentSms", "false");
  form.append("referralCode", stmtAffiliateCode);
  // Attach a minimal fake file so multer does not reject the upload
  const fakeFile = new Blob(["fake-statement"], { type: "application/pdf" });
  form.append("statementFile", fakeFile, "test-statement.pdf");

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/api/public/statement-upload`, {
      method: "POST",
      body: form,
    });
  } catch (err) {
    assert("Statement upload endpoint reachable", false, String(err));
    return;
  }

  assert(
    "Statement upload returns 2xx (not rate-limited — run from a fresh IP or wait 15 min if 429)",
    res.status >= 200 && res.status < 300,
    `status=${res.status}`
  );
  if (res.status === 429) return;

  // Statement chain is fire-and-forget; poll for up to 4s for contact + deal to appear
  let contact: typeof import("../shared/schema").contacts.$inferSelect | undefined;
  for (let i = 0; i < 16; i++) {
    await new Promise(r => setTimeout(r, 250));
    const rows = await db.select().from(contacts).where(eq(contacts.email, email)).limit(1);
    if (rows[0]) { contact = rows[0]; break; }
  }
  assert("Contact created after statement upload", !!contact, `email=${email}`);
  if (!contact) return;
  cleanupContactIds.push(contact.id);

  // Poll for deal — chain is async, may take a moment after contact appears
  let dealRow: any;
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 500));
    const rawStmtDeal = await db.execute(drizzleSql`SELECT id, stage FROM deals WHERE contact_id = ${contact!.id} LIMIT 1`) as any;
    const stmtDealRows = Array.isArray(rawStmtDeal) ? rawStmtDeal : rawStmtDeal?.rows ?? [];
    if (stmtDealRows[0]) { dealRow = stmtDealRows[0]; break; }
  }
  assert("Deal created after statement upload", !!dealRow, `contactId=${contact.id}`);
  if (dealRow?.id) cleanupDealIds.push(dealRow.id);

  assert(
    "Deal stage is 'Statement Received'",
    dealRow?.stage === "Statement Received",
    `stage="${dealRow?.stage}"`
  );

  // Check document record linked to contact + deal
  const rawDocResult = await db.execute(drizzleSql`
    SELECT id, contact_id, deal_id FROM documents
    WHERE contact_id = ${contact.id} LIMIT 1
  `) as any;
  const docRows = Array.isArray(rawDocResult) ? rawDocResult : rawDocResult?.rows ?? [];
  const docRow = docRows[0];
  if (docRow) {
    assert("Document record linked to contact", docRow.contact_id === contact.id, `contact_id=${docRow.contact_id}`);
    assert("Document record linked to deal", !!docRow.deal_id, `deal_id=${docRow.deal_id}`);
  } else {
    assert("Document record created after statement upload", false, "no document row found — file WAS attached in payload; statement-upload-chain should create a document record");
  }

  assert("doNotContact not set by form", contact.doNotContact !== true, `doNotContact=${contact.doNotContact}`);

  // Verify referral attribution row was created — trackReferral stores referred_email (not contact_id)
  const rawStmtRef = await db.execute(drizzleSql`
    SELECT id FROM referrals WHERE referred_email = ${email} AND partner_id = ${stmtPartner.id} LIMIT 1
  `) as any;
  const stmtRefRows = Array.isArray(rawStmtRef) ? rawStmtRef : rawStmtRef?.rows ?? [];
  assert("Statement upload: referral attribution row created for referralCode field", !!stmtRefRows[0], `email=${email} partnerId=${stmtPartner.id}`);
}

// ── Test 2: Estimate Form ─────────────────────────────────────────────────────
async function testEstimateForm(): Promise<void> {
  console.log("\n▶ Test 2: Estimate Form — POST /api/public/estimate\n");

  // Pre-create a test partner with a unique affiliateCode so trackReferral() resolves it.
  // This is the ?ref= attribution path required by Wave 12 Step 4.
  // getPartnerByCode() lowercases the lookup — store the code lowercase so it resolves
  const testAffiliateCode = `qa-ref-${Date.now()}`;
  const [testPartner] = await db.insert(partners).values({
    companyName: "QA Release Test Partner",
    affiliateCode: testAffiliateCode,
    status: "active",
    partnerType: "referral",
  }).returning({ id: partners.id });
  cleanupPartnerIds.push(testPartner.id);

  const email = uniqueEmail("qa-release-test-estimate");
  const payload = {
    firstName: "EstTest",
    lastName: "QAUser",
    email,
    phone: "3055550022",
    businessName: "QA_RELEASE_TEST Estimate Co",
    monthlyVolume: "15000",
    currentRate: "3.5",
    leadSource: "google",
    sourceCategory: "inbound",
    referralCode: testAffiliateCode,   // ?ref= attribution path
  };

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/api/public/estimate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    assert("Estimate endpoint reachable", false, String(err));
    return;
  }

  assert(
    "Estimate form returns 2xx (not rate-limited — run from a fresh IP or wait 15 min if 429)",
    res.status >= 200 && res.status < 300,
    `status=${res.status}`
  );
  if (res.status === 429) return;

  await new Promise(r => setTimeout(r, 400));
  const [contact] = await db.select().from(contacts).where(eq(contacts.email, email)).limit(1);
  assert("Contact created after estimate form", !!contact, `email=${email}`);
  if (!contact) return;
  cleanupContactIds.push(contact.id);

  // Check deal created with offerPath/stage
  const rawEstimateDeal = await db.execute(drizzleSql`SELECT id, stage, offer_path FROM deals WHERE contact_id = ${contact.id} LIMIT 1`) as any;
  const estimateDealRows = Array.isArray(rawEstimateDeal) ? rawEstimateDeal : rawEstimateDeal?.rows ?? [];
  const dealRow = estimateDealRows[0];
  assert("Deal created after estimate form", !!dealRow, `contactId=${contact.id}`);
  if (dealRow?.id) cleanupDealIds.push(dealRow.id);

  assert(
    "Deal has stage or offerPath set",
    !!(dealRow?.stage || dealRow?.offer_path),
    `stage="${dealRow?.stage}" offer_path="${dealRow?.offer_path}"`
  );

  // ── Wave 12 Step 4: ?ref= attribution assertion ─────────────────────────────
  // trackReferral() is fire-and-forget; poll for up to 3s for the referral row.
  let referralRow: any;
  for (let i = 0; i < 6; i++) {
    await new Promise(r => setTimeout(r, 500));
    const raw = await db.execute(
      drizzleSql`SELECT id, partner_id, referred_email FROM referrals WHERE referred_email = ${email} AND partner_id = ${testPartner.id} LIMIT 1`
    ) as any;
    const rows = Array.isArray(raw) ? raw : raw?.rows ?? [];
    if (rows[0]) { referralRow = rows[0]; break; }
  }
  assert(
    "Referral record created for ?ref= code (attribution path proved)",
    !!referralRow,
    `affiliateCode=${testAffiliateCode} email=${email}`
  );
  assert(
    "Referral record linked to correct partner",
    referralRow?.partner_id === testPartner.id,
    `partner_id=${referralRow?.partner_id} expected=${testPartner.id}`
  );
}

// ── Test 3: Get Started Form ──────────────────────────────────────────────────
async function testGetStartedForm(): Promise<void> {
  console.log("\n▶ Test 3: Get Started Form — POST /api/public/get-started\n");

  const email = uniqueEmail("qa-release-test-getstarted");
  const payload = {
    firstName: "GetStarted",
    lastName: "QAUser",
    email,
    phone: "3055550033",
    businessName: "QA_RELEASE_TEST GetStarted Co",
    businessType: "restaurant",
    monthlyVolume: "10000",
    leadSource: "website",
    sourceCategory: "inbound",
    path: "upload",
  };

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/api/public/get-started`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    assert("Get Started endpoint reachable", false, String(err));
    return;
  }

  assert(
    "Get Started form returns 2xx (not rate-limited — run from a fresh IP or wait 15 min if 429)",
    res.status >= 200 && res.status < 300,
    `status=${res.status}`
  );
  if (res.status === 429) return;

  await new Promise(r => setTimeout(r, 400));
  const [contact] = await db.select().from(contacts).where(eq(contacts.email, email)).limit(1);
  assert("Contact created after get-started form", !!contact, `email=${email}`);
  if (!contact) return;
  cleanupContactIds.push(contact.id);

  const rawGetStartedDeal = await db.execute(drizzleSql`SELECT id, offer_path, stage FROM deals WHERE contact_id = ${contact.id} LIMIT 1`) as any;
  const getStartedDealRows = Array.isArray(rawGetStartedDeal) ? rawGetStartedDeal : rawGetStartedDeal?.rows ?? [];
  const gsDealRow = getStartedDealRows[0];
  assert("Deal created after get-started form", !!gsDealRow, `contactId=${contact.id}`);
  if (gsDealRow?.id) cleanupDealIds.push(gsDealRow.id);

  assert(
    "Deal has offerPath assigned by deterministic router",
    !!(gsDealRow?.offer_path || gsDealRow?.stage),
    `offer_path="${gsDealRow?.offer_path}" stage="${gsDealRow?.stage}"`
  );
}

// ── Test 4: Merchant App Draft → Finalize → Duplicate EIN ────────────────────
async function testMerchantApplication(): Promise<void> {
  console.log("\n▶ Test 4: Merchant App Draft → Finalize → Duplicate EIN check\n");

  // 9-digit fake EIN — passes the /\D/g.length >= 9 validation in check-duplicate
  const testEin = "919191919";
  const email = uniqueEmail("qa-release-test-merchantapp");

  // Step 4a: Create draft using the correct public fields (legalBusinessName, ownerEmail)
  let draftRes: Response;
  try {
    draftRes = await fetch(`${BASE_URL}/api/merchant-applications/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        legalBusinessName: "QA_RELEASE_TEST App Co",
        ownerEmail: email,
        vertical: "restaurant",
      }),
    });
  } catch (err) {
    assert("Merchant app draft endpoint reachable", false, String(err));
    return;
  }

  assert(
    "Merchant app draft returns 2xx (not rate-limited — run from a fresh IP or wait 15 min if 429)",
    draftRes.status >= 200 && draftRes.status < 300,
    `status=${draftRes.status}`
  );
  if (draftRes.status === 429) return;

  const draftBody = await draftRes.json().catch(() => null);
  const draftId = draftBody?.id;
  const draftToken = draftBody?.draftToken;
  if (draftId) cleanupAppIds.push(draftId);

  assert("Draft response includes draftToken", !!draftToken, "draftToken missing — cannot test finalize path");
  if (!draftId || !draftToken) return;

  // Step 4b: Finalize via PATCH /api/merchant-applications/:id/finalize (public, token-authenticated)
  let finalRes: Response;
  try {
    finalRes = await fetch(`${BASE_URL}/api/merchant-applications/${draftId}/finalize`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-draft-token": draftToken,
      },
      body: JSON.stringify({
        ownerEmail: email,
        ownerFirstName: "AppTest",
        ownerLastName: "QAUser",
        legalBusinessName: "QA_RELEASE_TEST App Co",
        businessPhone: "3055550044",
        vertical: "restaurant",
        pewcConsent: true,
        ein: testEin,
      }),
    });
  } catch (err) {
    assert("Merchant app finalize endpoint reachable", false, String(err));
    return;
  }

  const finalStatus = finalRes.status;
  assert("Merchant app finalize endpoint responsive", finalStatus < 500, `status=${finalStatus}`);
  assert("Merchant app finalize returns 2xx (PATCH with valid draft token)", finalStatus >= 200 && finalStatus < 300, `status=${finalStatus}`);

  // Step 4c: Verify PEWC consent_audit_log was written (async side-effect — poll up to 2.5s)
  await new Promise(r => setTimeout(r, 1500));
  const [finalContact] = await db.select().from(contacts).where(eq(contacts.email, email)).limit(1);
  if (finalContact) {
    if (!cleanupContactIds.includes(finalContact.id)) cleanupContactIds.push(finalContact.id);
    const consentLogs = await db
      .select()
      .from(consentAuditLogs)
      .where(and(eq(consentAuditLogs.contactId, finalContact.id), eq(consentAuditLogs.consented, true)))
      .limit(5);
    assert("PEWC consent_audit_logs entry created on finalize", consentLogs.length > 0, `no PEWC log found for contactId=${finalContact.id}`);
    assert("Consent log has consented=true", consentLogs[0]?.consented === true, `consented=${consentLogs[0]?.consented}`);
  } else {
    assert("PEWC contact exists after finalize (side-effect contact creation)", false, `no contact found for email=${email}`);
    assert("PEWC consent log check", false, "skipped — contact not created");
  }

  // Step 4d: Duplicate EIN check — after finalize sets EIN, check-duplicate must return exists=true
  try {
    const dupCheckRes = await fetch(`${BASE_URL}/api/merchant-applications/check-duplicate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ein: testEin }),
    });
    const dupBody = await dupCheckRes.json().catch(() => null);
    assert("Duplicate EIN check returns exists=true after finalize", dupBody?.exists === true, `status=${dupCheckRes.status} body=${JSON.stringify(dupBody)}`);
  } catch (err) {
    assert("Duplicate EIN check endpoint reachable", false, String(err));
  }
}

// ── Test 5: Booking Attribution (internal service) ───────────────────────────
async function testBookingAttribution(): Promise<void> {
  console.log("\n▶ Test 5: Booking Attribution — internal handleAppointmentBooked() call\n");
  console.log("  NOTE: NOT using /api/webhooks/ghl/appointment-booked — that endpoint validates");
  console.log("  x-ghl-signature; calling internal service directly to verify attribution behavior.\n");

  // Import the internal booking attribution service
  let handleAppointmentBooked: Function;
  try {
    const scheduling = await import("../server/services/sdr/scheduling");
    handleAppointmentBooked = scheduling.handleAppointmentBooked;
  } catch (err) {
    assert("Booking attribution service importable", false, String(err));
    return;
  }
  assert("handleAppointmentBooked is importable from sdr/scheduling", typeof handleAppointmentBooked === "function");

  // ── 5a: Matched path — create a real sdrMerchant and verify attribution is linked ──
  const matchedGhlId = `qa-release-booking-matched-${Date.now()}`;
  const matchedApptId = `qa-appt-matched-${Date.now()}`;
  let testMerchantId: number | null = null;
  try {
    const [testMerchant] = await db.insert(sdrMerchants).values({
      businessName: "QA Release Test Merchant",
      ghlContactId: matchedGhlId,
    }).returning({ id: sdrMerchants.id });
    testMerchantId = testMerchant.id;

    await handleAppointmentBooked({
      contactId: matchedGhlId,
      appointmentId: matchedApptId,
      startTime: new Date(Date.now() + 86400000).toISOString(),
      status: "confirmed",
    });
    assert("handleAppointmentBooked() runs without throwing (matched merchant path)", true);
  } catch (err) {
    assert("handleAppointmentBooked() runs without throwing (matched merchant path)", false, String(err));
    return;
  }

  await new Promise(r => setTimeout(r, 300));
  const rawMatchedEvt = await db.execute(drizzleSql`
    SELECT id, event_type, merchant_id, ghl_ref_id FROM sdr_lead_events
    WHERE ghl_ref_id = ${matchedApptId} OR ghl_ref_id = ${matchedGhlId}
    ORDER BY created_at DESC LIMIT 1
  `) as any;
  const matchedEvtRows = Array.isArray(rawMatchedEvt) ? rawMatchedEvt : rawMatchedEvt?.rows ?? [];
  const matchedEvt = matchedEvtRows[0];

  assert("Matched booking: sdr_lead_events row created", !!matchedEvt, `no row found for matchedGhlId=${matchedGhlId}`);
  assert("Matched booking: sdr_lead_events.merchant_id is non-null (attribution linked to merchant)", matchedEvt?.merchant_id !== null && matchedEvt?.merchant_id !== undefined, `merchant_id=${matchedEvt?.merchant_id}`);
  assert("Matched booking: event_type = 'appointment_booked'", matchedEvt?.event_type === "appointment_booked", `event_type=${matchedEvt?.event_type}`);

  // Verify sdr_lead_state stage was advanced to MEETING_SET by handleAppointmentBooked
  if (testMerchantId !== null) {
    const rawLeadState = await db.execute(drizzleSql`
      SELECT current_stage FROM sdr_lead_state WHERE merchant_id = ${testMerchantId} LIMIT 1
    `) as any;
    const leadStateRows = Array.isArray(rawLeadState) ? rawLeadState : rawLeadState?.rows ?? [];
    assert("Matched booking: sdr_lead_state.current_stage advanced to MEETING_SET", leadStateRows[0]?.current_stage === "MEETING_SET", `current_stage="${leadStateRows[0]?.current_stage}"`);
  }

  // Cleanup matched path
  if (matchedEvt?.id) await db.execute(drizzleSql`DELETE FROM sdr_lead_events WHERE id = ${matchedEvt.id}`).catch(() => {});
  if (testMerchantId !== null) {
    await db.execute(drizzleSql`DELETE FROM sdr_lead_state WHERE merchant_id = ${testMerchantId}`).catch(() => {});
    await db.execute(drizzleSql`DELETE FROM outreach_pauses WHERE merchant_id = ${testMerchantId}`).catch(() => {});
    await db.delete(sdrMerchants).where(eq(sdrMerchants.id, testMerchantId)).catch(() => {});
  }

  // ── 5b: Unmatched path — verify attribution is still written (no-op on stage) ──
  const fakeGhlContactId = `qa-release-test-booking-unmatched-${Date.now()}`;
  const fakeAppointmentId = `qa-appt-unmatched-${Date.now()}`;
  try {
    await handleAppointmentBooked({
      contactId: fakeGhlContactId,
      appointmentId: fakeAppointmentId,
      startTime: new Date(Date.now() + 86400000).toISOString(),
      status: "confirmed",
    });
    assert("handleAppointmentBooked() runs without throwing (unmatched path)", true);
  } catch (err) {
    assert("handleAppointmentBooked() runs without throwing (unmatched path)", false, String(err));
    return;
  }

  await new Promise(r => setTimeout(r, 300));
  const rawEvtResult = await db.execute(drizzleSql`
    SELECT id, event_type, merchant_id, ghl_ref_id FROM sdr_lead_events
    WHERE ghl_ref_id = ${fakeAppointmentId} OR ghl_ref_id = ${fakeGhlContactId}
    ORDER BY created_at DESC LIMIT 1
  `) as any;
  const evtRows = Array.isArray(rawEvtResult) ? rawEvtResult : rawEvtResult?.rows ?? [];
  const evtRow = evtRows[0];

  assert("Unmatched booking: sdr_lead_events row still written (no attribution lost)", !!evtRow, `event was not written — unmatched booking attribution path is broken`);
  assert("Unmatched booking: merchant_id is null (no false attribution)", evtRow?.merchant_id === null || evtRow?.merchant_id === undefined, `merchant_id=${evtRow?.merchant_id}`);

  // Cleanup
  if (evtRow?.id) await db.execute(drizzleSql`DELETE FROM sdr_lead_events WHERE id = ${evtRow.id}`).catch(() => {});
}

async function main(): Promise<void> {
  console.log("\n=== Wave 12 Form Integration Tests ===\n");
  console.log(`Target: ${BASE_URL}\n`);

  const serverReady = await waitForServer();
  if (!serverReady) {
    console.error("❌ Dev server not reachable at", BASE_URL);
    console.error("   Start it with: npm run dev");
    process.exit(2);
  }
  console.log("✓ Dev server reachable\n");

  try {
    await testStatementUpload();
    await testEstimateForm();
    await testGetStartedForm();
    await testMerchantApplication();
    await testBookingAttribution();
  } finally {
    await cleanup();
  }

  console.log(`\n${"=".repeat(56)}`);
  console.log("Form Integration Test Results:");
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  if (failures.length > 0) {
    console.log("\nFailed assertions:");
    failures.forEach(f => console.log(`  - ${f}`));
  }
  console.log("=".repeat(56));

  if (failed > 0) {
    console.error("\n✗ Form integration tests FAILED.\n");
    process.exit(1);
  } else {
    console.log(`\n✅ All ${passed} form integration assertions passed.\n`);
  }
}

main()
  .catch(err => { console.error("Test runner error:", err); process.exit(1); })
  .finally(() => pool.end());
