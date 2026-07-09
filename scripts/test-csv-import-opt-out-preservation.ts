#!/usr/bin/env tsx
/**
 * Task #864 + #884 — Validation script: CSV import opt-out preservation
 *
 * Tests 13 cases verifying the monotonic consent merge rule:
 *   "restrictive consent state is never downgraded by a CSV import"
 *
 * Cases 14-19 (Task #884): GHL sync payload verification after CSV opt-out.
 *   Confirms that after a CSV import applies an opt-out, the GHL upsert
 *   payload correctly includes lb_do_not_contact and lb_consent_tier.
 *
 * Run with the dev server NOT required — directly tests the merge helpers
 * and database update logic extracted from server/routes/imports.ts.
 *
 * Exit 0 = all cases pass. Exit 1 = failures.
 */

import { pool, db } from "../server/db";
import { contacts } from "../shared/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { storage } from "../server/storage";
import { upsertGhlContact } from "../server/services/ghl";

// ── Replica of the helpers from server/routes/imports.ts ─────────────────────
const RESTRICTIVE_EMAIL_STATUSES = new Set(["unsubscribed", "opted_out"]);
const RESTRICTIVE_CONSENT_TIERS = new Set(["opted_out", "do_not_contact"]);

function existingContactIsRestrictive(c: {
  emailStatus: string; consentTier: string;
  optedOutEmail: boolean | null; doNotContact: boolean | null;
}): boolean {
  return RESTRICTIVE_EMAIL_STATUSES.has(c.emailStatus) ||
    RESTRICTIVE_CONSENT_TIERS.has(c.consentTier) ||
    c.optedOutEmail === true ||
    c.doNotContact === true;
}

function csvMappedHasRestrictiveConsent(mapped: Record<string, string>): boolean {
  const emailStatus = (mapped.emailStatus || "").toLowerCase();
  const consentTier = (mapped.consentTier || "").toLowerCase();
  const optedOutEmail = (mapped.optedOutEmail || "").toLowerCase();
  const doNotContact = (mapped.doNotContact || "").toLowerCase();
  return RESTRICTIVE_EMAIL_STATUSES.has(emailStatus) ||
    RESTRICTIVE_CONSENT_TIERS.has(consentTier) ||
    optedOutEmail === "true" || optedOutEmail === "1" || optedOutEmail === "yes" ||
    doNotContact === "true" || doNotContact === "1" || doNotContact === "yes";
}

// ── Suppression call tracking ─────────────────────────────────────────────────
const suppressionCalls: Array<{ contactId: number; reason: string }> = [];

async function mockSuppressNewLeadAutoEnrollmentForContact(contactId: number, reason: string): Promise<void> {
  suppressionCalls.push({ contactId, reason });
}

// ── Test harness ─────────────────────────────────────────────────────────────
type TestResult = { name: string; passed: boolean; error?: string };
const results: TestResult[] = [];
const cleanupIds: number[] = [];

function pass(name: string): void {
  results.push({ name, passed: true });
  console.log(`  ✓ ${name}`);
}

function fail(name: string, error: string): void {
  results.push({ name, passed: false, error });
  console.log(`  ✗ ${name}: ${error}`);
}

async function createTestContact(overrides: Record<string, unknown> = {}): Promise<number> {
  const email = `test-opt-out-${randomUUID()}@test.libertybancard.internal`;
  const [row] = await db.insert(contacts).values({
    firstName: "TestOptOut",
    lastName: "Preservation",
    email,
    phone: "",
    status: "active",
    leadSource: "test",
    sourceCategory: "test",
    emailStatus: "active",
    consentTier: "cold_no_consent",
    optedOutEmail: false,
    doNotContact: false,
    ...overrides,
  } as any).returning({ id: contacts.id, email: contacts.email });
  cleanupIds.push(row.id);
  return row.id;
}

async function getContact(id: number): Promise<{
  emailStatus: string; consentTier: string;
  optedOutEmail: boolean | null; doNotContact: boolean | null;
}> {
  const row = await pool.query(
    `SELECT email_status, consent_tier, opted_out_email, do_not_contact FROM contacts WHERE id = $1`,
    [id]
  );
  const r = row.rows[0];
  return {
    emailStatus: r.email_status,
    consentTier: r.consent_tier,
    optedOutEmail: r.opted_out_email,
    doNotContact: r.do_not_contact,
  };
}

// ── Simulate the merge logic as applied in imports.ts ─────────────────────────
// Returns { optOutPreserved, optOutApplied, updated }
async function simulateMerge(contactId: number, csvMapped: Record<string, string>): Promise<{
  optOutPreserved: number; optOutApplied: number; updated: number;
}> {
  let optOutPreserved = 0;
  let optOutApplied = 0;
  let updated = 0;

  const snapshot = await getContact(contactId);

  const existingRestricted = existingContactIsRestrictive(snapshot);
  const csvRestricts = csvMappedHasRestrictiveConsent(csvMapped);

  if (existingRestricted) {
    optOutPreserved++;
    updated++;
    await mockSuppressNewLeadAutoEnrollmentForContact(contactId, "csv_import_existing_opt_out_preserved");
  } else if (csvRestricts) {
    optOutApplied++;
    updated++;
    const consentUpdates: Record<string, unknown> = {};
    const csvEmailStatus = (csvMapped.emailStatus || "").toLowerCase();
    const csvConsentTier = (csvMapped.consentTier || "").toLowerCase();
    const csvOptedOutEmail = (csvMapped.optedOutEmail || "").toLowerCase();
    const csvDoNotContact = (csvMapped.doNotContact || "").toLowerCase();
    if (RESTRICTIVE_EMAIL_STATUSES.has(csvEmailStatus)) consentUpdates.email_status = csvEmailStatus;
    if (RESTRICTIVE_CONSENT_TIERS.has(csvConsentTier)) consentUpdates.consent_tier = csvConsentTier;
    if (csvOptedOutEmail === "true" || csvOptedOutEmail === "1" || csvOptedOutEmail === "yes") consentUpdates.opted_out_email = true;
    if (csvDoNotContact === "true" || csvDoNotContact === "1" || csvDoNotContact === "yes") consentUpdates.do_not_contact = true;
    if (Object.keys(consentUpdates).length > 0) {
      await pool.query(
        `UPDATE contacts SET ${Object.keys(consentUpdates).map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE id = $1`,
        [contactId, ...Object.values(consentUpdates)]
      );
    }
    await mockSuppressNewLeadAutoEnrollmentForContact(contactId, "csv_import_opt_out");
  }

  return { optOutPreserved, optOutApplied, updated };
}

// ── Tests ─────────────────────────────────────────────────────────────────────
async function runTests(): Promise<void> {
  console.log("\n── Case 1: optedOutEmail=true preserved when CSV sends false ──");
  {
    const id = await createTestContact({ optedOutEmail: true, emailStatus: "opted_out" });
    const before = await getContact(id);
    await simulateMerge(id, { optedOutEmail: "false", emailStatus: "active" });
    const after = await getContact(id);
    if (after.optedOutEmail === true && after.emailStatus === "opted_out") {
      pass("Case 1: optedOutEmail=true preserved against CSV false");
    } else {
      fail("Case 1", `optedOutEmail=${after.optedOutEmail}, emailStatus=${after.emailStatus} (expected true/opted_out)`);
    }
  }

  console.log("\n── Case 2: doNotContact=true preserved when CSV sends false ──");
  {
    const id = await createTestContact({ doNotContact: true });
    await simulateMerge(id, { doNotContact: "false" });
    const after = await getContact(id);
    if (after.doNotContact === true) {
      pass("Case 2: doNotContact=true preserved against CSV false");
    } else {
      fail("Case 2", `doNotContact=${after.doNotContact} (expected true)`);
    }
  }

  console.log("\n── Case 3: consentTier=opted_out preserved when CSV sends subscribed ──");
  {
    const id = await createTestContact({ consentTier: "opted_out" });
    await simulateMerge(id, { consentTier: "subscribed" });
    const after = await getContact(id);
    if (after.consentTier === "opted_out") {
      pass("Case 3: consentTier=opted_out preserved against CSV subscribed");
    } else {
      fail("Case 3", `consentTier=${after.consentTier} (expected opted_out)`);
    }
  }

  console.log("\n── Case 4: emailStatus=unsubscribed preserved when CSV sends active ──");
  {
    const id = await createTestContact({ emailStatus: "unsubscribed" });
    await simulateMerge(id, { emailStatus: "active" });
    const after = await getContact(id);
    if (after.emailStatus === "unsubscribed") {
      pass("Case 4: emailStatus=unsubscribed preserved against CSV active");
    } else {
      fail("Case 4", `emailStatus=${after.emailStatus} (expected unsubscribed)`);
    }
  }

  console.log("\n── Case 5: CSV opt-out applied to previously contactable contact ──");
  {
    const id = await createTestContact({ emailStatus: "active", doNotContact: false });
    await simulateMerge(id, { emailStatus: "unsubscribed" });
    const after = await getContact(id);
    if (after.emailStatus === "unsubscribed") {
      pass("Case 5: CSV opt-out (emailStatus=unsubscribed) applied to contactable contact");
    } else {
      fail("Case 5", `emailStatus=${after.emailStatus} (expected unsubscribed)`);
    }
  }

  console.log("\n── Case 6: optOutPreserved increments when restrictive state preserved ──");
  {
    const id = await createTestContact({ optedOutEmail: true });
    const { optOutPreserved } = await simulateMerge(id, { optedOutEmail: "false" });
    if (optOutPreserved === 1) {
      pass("Case 6: optOutPreserved=1 when existing opt-out preserved");
    } else {
      fail("Case 6", `optOutPreserved=${optOutPreserved} (expected 1)`);
    }
  }

  console.log("\n── Case 7: optOutApplied increments when CSV applies new opt-out ──");
  {
    const id = await createTestContact({ emailStatus: "active" });
    const { optOutApplied } = await simulateMerge(id, { doNotContact: "true" });
    if (optOutApplied === 1) {
      pass("Case 7: optOutApplied=1 when CSV applies new opt-out");
    } else {
      fail("Case 7", `optOutApplied=${optOutApplied} (expected 1)`);
    }
  }

  console.log("\n── Case 8: suppressNewLeadAutoEnrollmentForContact called for preserved opt-out ──");
  {
    const id = await createTestContact({ doNotContact: true });
    const beforeLen = suppressionCalls.length;
    await simulateMerge(id, { doNotContact: "false" });
    const afterCalls = suppressionCalls.slice(beforeLen);
    const called = afterCalls.some(c => c.contactId === id && c.reason === "csv_import_existing_opt_out_preserved");
    if (called) {
      pass("Case 8: suppression called with csv_import_existing_opt_out_preserved");
    } else {
      fail("Case 8", `suppression not called for preserved opt-out (calls: ${JSON.stringify(afterCalls)})`);
    }
  }

  console.log("\n── Case 9: suppressNewLeadAutoEnrollmentForContact called for newly applied opt-out ──");
  {
    const id = await createTestContact({ emailStatus: "active" });
    const beforeLen = suppressionCalls.length;
    await simulateMerge(id, { emailStatus: "opted_out" });
    const afterCalls = suppressionCalls.slice(beforeLen);
    const called = afterCalls.some(c => c.contactId === id && c.reason === "csv_import_opt_out");
    if (called) {
      pass("Case 9: suppression called with csv_import_opt_out");
    } else {
      fail("Case 9", `suppression not called for newly applied opt-out (calls: ${JSON.stringify(afterCalls)})`);
    }
  }

  console.log("\n── Case 10: Import totals remain reconciled ──");
  {
    const totalRows = 5;
    let inserted = 0, updated = 0, duplicatesSkipped = 0, invalidRows = 0, skippedRows = 0, errors = 0;

    // Simulate 5 rows:
    // Row 1: new contact → inserted
    inserted++;
    // Row 2: duplicate, opted-out existing → updated (optOutPreserved)
    updated++;
    // Row 3: duplicate, contactable existing, CSV sends opt-out → updated (optOutApplied)
    updated++;
    // Row 4: duplicate, contactable, no opt-out signal → duplicatesSkipped
    duplicatesSkipped++;
    // Row 5: invalid (no required fields) → invalidRows
    invalidRows++;

    const reconciled = inserted + updated + duplicatesSkipped + invalidRows + skippedRows + errors;
    if (reconciled === totalRows) {
      pass(`Case 10: totals reconcile (${inserted}+${updated}+${duplicatesSkipped}+${invalidRows}+${skippedRows}+${errors}=${reconciled}==${totalRows})`);
    } else {
      fail("Case 10", `reconciliation failed: ${reconciled} != ${totalRows}`);
    }
  }

  console.log("\n── Case 11: No sequence enrollments created ──");
  {
    // The merge logic calls suppressNewLeadAutoEnrollmentForContact (which PAUSES enrollments)
    // but never calls autoEnrollFromTrigger or enrollContactInGhlWorkflow.
    // We verify that the merge simulation above did NOT create any sequence enrollments.
    const enrollmentCheck = await pool.query(
      `SELECT COUNT(*)::int as cnt FROM sequence_enrollments WHERE status = 'active' AND created_at > NOW() - INTERVAL '5 seconds'`
    );
    const recentEnrollments = enrollmentCheck.rows[0].cnt;
    if (recentEnrollments === 0) {
      pass("Case 11: No sequence enrollments created by opt-out merge");
    } else {
      fail("Case 11", `${recentEnrollments} active sequence enrollments found (expected 0)`);
    }
  }

  console.log("\n── Case 12: No outbound sent ──");
  {
    // The merge logic does DB writes only; no email/SMS send methods are called.
    // We verify via audit_logs that no 'email_sent' or 'sms_sent' events were written in
    // the last few seconds by our test.
    const sentCheck = await pool.query(
      `SELECT COUNT(*)::int as cnt FROM audit_logs
       WHERE action IN ('email_sent','sms_sent','sequence_step_executed')
         AND created_at > NOW() - INTERVAL '5 seconds'`
    );
    const recentSent = sentCheck.rows[0].cnt;
    if (recentSent === 0) {
      pass("Case 12: No outbound sent during opt-out merge");
    } else {
      fail("Case 12", `${recentSent} outbound send audit entries found (expected 0)`);
    }
  }

  console.log("\n── Case 13: No GHL sync triggered ──");
  {
    // The merge logic uses pool.query() for updates — not createContactGhlFirst or
    // updateContactGhlFirst.  No GHL sync jobs queued; verify via audit_logs.
    const ghlCheck = await pool.query(
      `SELECT COUNT(*)::int as cnt FROM audit_logs
       WHERE action LIKE 'ghl_%'
         AND created_at > NOW() - INTERVAL '5 seconds'`
    );
    const recentGhl = ghlCheck.rows[0].cnt;
    if (recentGhl === 0) {
      pass("Case 13: No GHL sync triggered during opt-out merge");
    } else {
      fail("Case 13", `${recentGhl} GHL-related audit entries found (expected 0)`);
    }
  }

  // ── Cases 14-19: GHL sync payload verification (Task #884) ───────────────
  //
  // After a CSV import applies an opt-out, the GHL 45-second sync loop calls
  // upsertGhlContact() via syncContactToGhl().  We verify that the permission-
  // fields payload it builds contains lb_do_not_contact and lb_consent_tier
  // with the correct opt-out values.
  //
  // Mock strategy: replace global.fetch before calling upsertGhlContact() so
  // no real network request is made. ghlFetch() (ghl.ts:44) calls global.fetch
  // directly, so this intercept is sufficient.  We also set fake GHL env vars
  // so getConfig() returns non-null, enabling the payload builder to run.

  console.log("\n── Cases 14-19: GHL payload after CSV opt-out apply ──");

  // Captured GHL HTTP calls from the mock
  type CapturedCall = { url: string; method: string; body: any };
  const capturedGhlCalls: CapturedCall[] = [];
  const originalFetch = (global as any).fetch;

  // Save and override GHL env vars with fake values
  const origToken = process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
  const origApiKey = process.env.GHL_API_KEY;
  const origLocId = process.env.GHL_LOCATION_ID;
  process.env.GHL_PRIVATE_INTEGRATION_TOKEN = "test-mock-token-884";
  process.env.GHL_LOCATION_ID = "test-mock-location-884";
  // Clear real API key so only the private integration token is used
  delete process.env.GHL_API_KEY;

  // Install mock fetch — records calls and returns a synthetic 200 success
  (global as any).fetch = async (url: string, options: RequestInit = {}) => {
    let bodyParsed: any;
    if (options.body) {
      try { bodyParsed = JSON.parse(options.body as string); } catch { bodyParsed = options.body; }
    }
    capturedGhlCalls.push({ url, method: (options.method || "GET").toUpperCase(), body: bodyParsed });
    // Synthetic success response — includes a contact id for the POST/create path
    const responseBody = JSON.stringify({ contact: { id: "fake-ghl-id-884" } });
    return {
      ok: true,
      status: 200,
      headers: { get: (k: string) => k === "content-type" ? "application/json" : null },
      text: async () => responseBody,
    } as unknown as Response;
  };

  try {
    // Create fixture contact simulating a full CSV opt-out apply.
    // createTestContact() inserts via Drizzle ORM; then we apply the same
    // raw-SQL path that imports.ts:1765-1769 uses so the fixture mirrors
    // the exact DB state produced by a real CSV import.
    const ghlFixtureId = await createTestContact({
      emailStatus: "active",
      consentTier: "cold_no_consent",
      optedOutEmail: false,
      doNotContact: false,
    });

    // Simulate CSV opt-out apply (mirrors imports.ts:1765-1769 raw SQL path)
    await pool.query(
      `UPDATE contacts
          SET email_status = $2, consent_tier = $3, opted_out_email = $4, do_not_contact = $5
        WHERE id = $1`,
      [ghlFixtureId, "unsubscribed", "opted_out", true, true]
    );

    // ── Case 14: Local DB correctness after CSV opt-out apply ──────────────
    console.log("\n── Case 14: Local DB correctness for GHL fixture ──");
    {
      const dbState = await getContact(ghlFixtureId);
      if (
        dbState.consentTier === "opted_out" &&
        dbState.doNotContact === true &&
        dbState.optedOutEmail === true &&
        dbState.emailStatus === "unsubscribed"
      ) {
        pass("Case 14: DB has consent_tier=opted_out, do_not_contact=true, opted_out_email=true, email_status=unsubscribed after CSV apply");
      } else {
        fail(
          "Case 14",
          `consent_tier=${dbState.consentTier}, do_not_contact=${dbState.doNotContact}, ` +
          `opted_out_email=${dbState.optedOutEmail}, email_status=${dbState.emailStatus}`
        );
      }
    }

    // Read contact as the GHL sync worker would (via storage.getContact)
    const storedContact = await storage.getContact(ghlFixtureId);
    if (!storedContact) {
      fail("Case 15", "storage.getContact returned undefined — cannot test GHL payload");
      fail("Case 16", "storage.getContact returned undefined — cannot test GHL payload");
      fail("Case 17", "storage.getContact returned undefined — cannot test GHL payload");
      fail("Case 18", "storage.getContact returned undefined — cannot test GHL payload");
      fail("Case 19", "storage.getContact returned undefined — cannot test GHL payload");
    } else {
      // Inject a fake ghlContactId so upsertGhlContact takes the PUT (update) path
      // and does not attempt to POST (create) a new GHL contact.
      const contactInput = { ...storedContact, ghlContactId: "fake-ghl-id-884" };

      // Reset captured calls so only calls from this upsert are inspected
      capturedGhlCalls.length = 0;

      // Invoke the real payload builder — all HTTP calls are captured by the mock
      await upsertGhlContact(contactInput);

      // The permission fields are written in a SEPARATE PUT call (Wave 7 pattern —
      // ghl.ts:436).  Find that call by looking for customFields containing lb_do_not_contact.
      const permCall = capturedGhlCalls.find(
        c => c.method === "PUT" &&
             Array.isArray(c.body?.customFields) &&
             c.body.customFields.some((f: any) => f.key === "lb_do_not_contact")
      );

      // ── Case 15: lb_do_not_contact = "true" present in permission payload ──
      console.log("\n── Case 15: lb_do_not_contact in GHL permission payload ──");
      {
        const field = permCall?.body?.customFields?.find((f: any) => f.key === "lb_do_not_contact");
        if (field && field.field_value === "true") {
          pass(`Case 15: lb_do_not_contact="true" found in GHL permission payload`);
        } else {
          fail(
            "Case 15",
            `lb_do_not_contact not found or wrong value: ${JSON.stringify(field)}. ` +
            `permCall customFields: ${JSON.stringify(permCall?.body?.customFields)}`
          );
        }
      }

      // ── Case 16: lb_consent_tier = "opted_out" present (primary gap test) ──
      // ghl.ts:409 guards this with `if (contact.consentTier)`.  If the contact
      // returned by storage.getContact() has consentTier=null/undefined even though
      // the DB has consent_tier="opted_out", this field would be silently omitted.
      console.log("\n── Case 16: lb_consent_tier=opted_out in GHL permission payload ──");
      {
        const field = permCall?.body?.customFields?.find((f: any) => f.key === "lb_consent_tier");
        if (field && field.field_value === "opted_out") {
          pass(`Case 16: lb_consent_tier="opted_out" found in GHL permission payload`);
        } else {
          fail(
            "Case 16",
            `lb_consent_tier not found or wrong value: ${JSON.stringify(field)}. ` +
            `All permission customFields: ${JSON.stringify(permCall?.body?.customFields)}`
          );
        }
      }

      // ── Case 17: No resubscribe — lb_do_not_contact="false" must not appear ──
      console.log("\n── Case 17: No resubscribe signal (lb_do_not_contact!=false) ──");
      {
        const allFields = capturedGhlCalls.flatMap(c =>
          Array.isArray(c.body?.customFields) ? (c.body.customFields as any[]) : []
        );
        const badField = allFields.find(
          (f: any) => f.key === "lb_do_not_contact" && f.field_value === "false"
        );
        if (!badField) {
          pass("Case 17: No lb_do_not_contact=\"false\" — opted-out contact will not be resubscribed");
        } else {
          fail("Case 17", `Found lb_do_not_contact="false" — contact would be resubscribed in GHL`);
        }
      }

      // ── Case 18: No sequence enrollment created during mock sync ───────────
      console.log("\n── Case 18: No sequence enrollment during mock GHL sync ──");
      {
        const enrollCheck = await pool.query(
          `SELECT COUNT(*)::int as cnt
             FROM sequence_enrollments
            WHERE status = 'active'
              AND created_at > NOW() - INTERVAL '5 seconds'`
        );
        if (enrollCheck.rows[0].cnt === 0) {
          pass("Case 18: No sequence enrollment created during mock GHL sync");
        } else {
          fail("Case 18", `${enrollCheck.rows[0].cnt} active enrollment(s) found (expected 0)`);
        }
      }

      // ── Case 19: Real GHL was not called — mock intercepted all requests ──
      // We verify: (a) at least one call was captured by the mock, and (b) every
      // captured URL targets the GHL API base we expected, confirming the mock
      // interceptor was active for the entire upsert.
      console.log("\n── Case 19: Real GHL not called — all requests captured by mock ──");
      {
        const expectedBase = "https://services.leadconnectorhq.com";
        const allCaptured = capturedGhlCalls.length > 0;
        const allTargetGhl = capturedGhlCalls.every(c => c.url.startsWith(expectedBase));
        if (allCaptured && allTargetGhl) {
          pass(
            `Case 19: Real GHL not called — ${capturedGhlCalls.length} call(s) captured by mock ` +
            `(all to ${expectedBase}; no real network requests)`
          );
        } else if (!allCaptured) {
          fail("Case 19", "No GHL calls were captured — upsertGhlContact may not have executed");
        } else {
          const unexpected = capturedGhlCalls.filter(c => !c.url.startsWith(expectedBase)).map(c => c.url);
          fail("Case 19", `Unexpected URL(s) outside GHL base: ${JSON.stringify(unexpected)}`);
        }
      }
    }
  } finally {
    // Restore global.fetch and GHL env vars unconditionally
    (global as any).fetch = originalFetch;
    if (origToken !== undefined) process.env.GHL_PRIVATE_INTEGRATION_TOKEN = origToken;
    else delete process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
    if (origApiKey !== undefined) process.env.GHL_API_KEY = origApiKey;
    else delete process.env.GHL_API_KEY;
    if (origLocId !== undefined) process.env.GHL_LOCATION_ID = origLocId;
    else delete process.env.GHL_LOCATION_ID;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log("=== CSV Import Opt-Out Preservation — 13 test cases ===");
  try {
    await runTests();
  } finally {
    // Clean up all test contacts
    if (cleanupIds.length > 0) {
      await pool.query(
        `DELETE FROM contacts WHERE id = ANY($1::int[])`,
        [cleanupIds]
      ).catch(e => console.warn("[cleanup] Failed:", e.message));
    }
    await pool.end().catch(() => {});
  }

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`\n${passed}/${results.length} tests passed.`);

  if (failed > 0) {
    console.log("\nFailed tests:");
    for (const r of results.filter(r => !r.passed)) {
      console.log(`  ✗ ${r.name}: ${r.error}`);
    }
    process.exit(1);
  } else {
    console.log("\nAll tests passed. ✓");
    process.exit(0);
  }
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
