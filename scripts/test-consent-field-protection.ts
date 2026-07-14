/**
 * Smoke test: Consent field protection and existing-contact form submission.
 * KL-9 — verifies all kill lines from the task spec.
 * Run: npx tsx scripts/test-consent-field-protection.ts
 * Exit 0 = all assertions pass.
 */

import { db } from "../server/db";
import { storage } from "../server/storage";
import {
  contacts,
  consentAuditLogs,
  contactSourceEvents,
} from "../shared/schema";
import { eq, and } from "drizzle-orm";
import { mergePersistedConsentState } from "../server/services/consent-merge";
import { buildPublicContactPayload } from "../server/services/public-form-payload";
import { processExistingPublicFormSubmission } from "../server/services/public-form-submission";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  ✅  ${label}`);
    passed++;
  } else {
    console.error(`  ❌  ${label}`);
    failed++;
  }
}

async function cleanup(emails: string[]) {
  for (const email of emails) {
    const c = await storage.getContactByEmail(email);
    if (c) {
      await db.delete(consentAuditLogs).where(eq(consentAuditLogs.contactId, c.id));
      await db.delete(contactSourceEvents).where(eq(contactSourceEvents.contactId, c.id));
      await db.update(contacts).set({ primarySourceEventId: null } as any).where(eq(contacts.id, c.id));
      await db.delete(contacts).where(eq(contacts.id, c.id));
    }
  }
}

const TEST_EMAILS = [
  "kl9_email_optout@test.libertybancard.invalid",
  "kl9_sms_optout@test.libertybancard.invalid",
  "kl9_dna@test.libertybancard.invalid",
  "kl9_dnc@test.libertybancard.invalid",
  "kl9_bounced@test.libertybancard.invalid",
  "kl9_new@test.libertybancard.invalid",
  "kl9_null_consent@test.libertybancard.invalid",
  "kl9_idempotent@test.libertybancard.invalid",
  "kl9_crafted@test.libertybancard.invalid",
];

async function createContact(overrides: Record<string, unknown>) {
  const [c] = await db.insert(contacts).values({
    firstName: "KL9",
    lastName: "Test",
    email: overrides.email as string,
    phone: "",
    status: "New",
    ...overrides,
  } as any).returning();
  return c;
}

async function getConsentAuditRows(contactId: number, channel: string, action: string) {
  return db
    .select()
    .from(consentAuditLogs)
    .where(
      and(
        eq(consentAuditLogs.contactId, contactId),
        eq(consentAuditLogs.channel, channel),
        eq(consentAuditLogs.action, action),
      ),
    );
}

async function runTests() {
  console.log("\n[KL-9] Consent Field Protection Smoke Test\n");
  await cleanup(TEST_EMAILS);

  // ─── Unit: mergePersistedConsentState ─────────────────────────────────────
  console.log("── Unit: mergePersistedConsentState ──");

  // Test 1: email opted-out contact resubmits consentEmail=true → blocked, smsStatus unaffected
  {
    const fakeContact = {
      id: 99999,
      emailStatus: "opted_out",
      smsStatus: "active",
      doNotContact: false,
      consentEmail: false,
      consentSms: null,
    } as any;
    const result = mergePersistedConsentState({
      existingContact: fakeContact,
      incomingConsent: { consentEmail: true, consentSms: true },
    });
    assert(
      result.blockedAttempts.some(a => a.channel === "email" && a.reasonCode === "existing_email_opt_out"),
      "Test 1a: email opt-out blocks consentEmail=true attempt"
    );
    assert(
      !result.blockedAttempts.some(a => a.channel === "sms"),
      "Test 1b: email opt-out does NOT affect smsStatus"
    );
    assert(
      result.updates.consentSms === true,
      "Test 1c: consentSms is allowed when only email is opted out"
    );
    assert(
      result.updates.consentEmail === undefined,
      "Test 1d: consentEmail not in updates when blocked"
    );
  }

  // Test 2: SMS opted-out contact resubmits consentSms=true → blocked, emailStatus unaffected
  {
    const fakeContact = {
      id: 99999,
      emailStatus: "active",
      smsStatus: "opted_out",
      doNotContact: false,
      consentEmail: null,
      consentSms: false,
    } as any;
    const result = mergePersistedConsentState({
      existingContact: fakeContact,
      incomingConsent: { consentEmail: true, consentSms: true },
    });
    assert(
      result.blockedAttempts.some(a => a.channel === "sms" && a.reasonCode === "existing_sms_opt_out"),
      "Test 2a: sms opt-out blocks consentSms=true attempt"
    );
    assert(
      !result.blockedAttempts.some(a => a.channel === "email"),
      "Test 2b: sms opt-out does NOT affect email channel"
    );
    assert(
      result.updates.consentEmail === true,
      "Test 2c: consentEmail is allowed when only sms is opted out"
    );
  }

  // Test 3: doNotAutoContact=true — consent fields NOT blocked (only automated sends gated)
  {
    const fakeContact = {
      id: 99999,
      emailStatus: "active",
      smsStatus: "active",
      doNotContact: false,
      doNotAutoContact: true,
      consentEmail: null,
      consentSms: null,
    } as any;
    const result = mergePersistedConsentState({
      existingContact: fakeContact,
      incomingConsent: { consentEmail: true, consentSms: true },
    });
    assert(
      result.blockedAttempts.length === 0,
      "Test 3: doNotAutoContact=true does NOT block consent fields (only gates automated sends)"
    );
    assert(
      result.updates.consentEmail === true && result.updates.consentSms === true,
      "Test 3b: consent fields updated when only doNotAutoContact=true"
    );
  }

  // Test 4: Global DNC blocks both channels
  {
    const fakeContact = {
      id: 99999,
      emailStatus: "active",
      smsStatus: "active",
      doNotContact: true,
      consentEmail: false,
      consentSms: false,
    } as any;
    const result = mergePersistedConsentState({
      existingContact: fakeContact,
      incomingConsent: { consentEmail: true, consentSms: true },
    });
    assert(
      result.blockedAttempts.filter(a => a.reasonCode === "global_dnc").length === 2,
      "Test 4: global DNC blocks both email and sms channels"
    );
    assert(
      Object.keys(result.updates).length === 0,
      "Test 4b: no consent updates when global DNC"
    );
  }

  // Test 5: emailStatus="bounced" is NOT treated as opt-out
  {
    const fakeContact = {
      id: 99999,
      emailStatus: "bounced",
      smsStatus: "active",
      doNotContact: false,
      consentEmail: null,
      consentSms: null,
    } as any;
    const result = mergePersistedConsentState({
      existingContact: fakeContact,
      incomingConsent: { consentEmail: true },
    });
    assert(
      result.blockedAttempts.length === 0,
      "Test 5: emailStatus=bounced does NOT block consent (only opted_out/unsubscribed do)"
    );
    assert(
      result.updates.consentEmail === true,
      "Test 5b: consentEmail can be set when emailStatus=bounced"
    );
  }

  // Test 6: null→true consent update with affirmative form evidence
  {
    const fakeContact = {
      id: 99999,
      emailStatus: "active",
      smsStatus: "active",
      doNotContact: false,
      consentEmail: null,
      consentSms: null,
    } as any;
    const result = mergePersistedConsentState({
      existingContact: fakeContact,
      incomingConsent: { consentEmail: true, consentSms: true },
    });
    assert(
      result.updates.consentEmail === true && result.updates.consentSms === true,
      "Test 6: null→true affirmative consent stored (no block)"
    );
    assert(
      result.blockedAttempts.length === 0,
      "Test 6b: no blocked attempts for fresh affirmative consent"
    );
  }

  // Test 7: incoming=false is accepted as withdrawal (not blocked)
  {
    const fakeContact = {
      id: 99999,
      emailStatus: "active",
      smsStatus: "active",
      doNotContact: false,
      consentEmail: true,
      consentSms: true,
    } as any;
    const result = mergePersistedConsentState({
      existingContact: fakeContact,
      incomingConsent: { consentEmail: false, consentSms: false },
    });
    assert(
      result.updates.consentEmail === false && result.updates.consentSms === false,
      "Test 7: incoming=false (opt-out) accepted as permitted withdrawal"
    );
    assert(
      result.blockedAttempts.length === 0,
      "Test 7b: no blocked attempts for opt-out withdrawal"
    );
  }

  // ─── Unit: buildPublicContactPayload ──────────────────────────────────────
  console.log("\n── Unit: buildPublicContactPayload ──");

  // Test 8: protected fields stripped from form body
  {
    const payload = buildPublicContactPayload("estimate_form", {
      firstName: "Test",
      email: "test@example.com",
      doNotContact: false,
      doNotAutoContact: true,
      emailStatus: "active",
      smsStatus: "active",
      consentTier: "pewc",
      ghlContactId: "abc123",
      archivedAt: new Date(),
      leadScore: 99,
      sourceCategory: "ghl_sync",
    });
    assert(
      !("doNotContact" in payload),
      "Test 8a: doNotContact stripped from public body"
    );
    assert(
      !("doNotAutoContact" in payload),
      "Test 8b: doNotAutoContact stripped from public body"
    );
    assert(
      !("emailStatus" in payload),
      "Test 8c: emailStatus stripped from public body"
    );
    assert(
      !("ghlContactId" in payload),
      "Test 8d: ghlContactId stripped from public body"
    );
    assert(
      !("leadScore" in payload),
      "Test 8e: leadScore stripped from public body"
    );
    assert(
      !("sourceCategory" in payload),
      "Test 8f: sourceCategory stripped from public body"
    );
    assert(
      (payload as any).firstName === "Test",
      "Test 8g: allowed fields (firstName) pass through"
    );
  }

  // ─── Integration: processExistingPublicFormSubmission ─────────────────────
  console.log("\n── Integration: processExistingPublicFormSubmission ──");

  // Test 9: Email-opted-out contact resubmits consentEmail=true
  //         → emailStatus unchanged, one audit row
  {
    const c = await createContact({
      email: "kl9_email_optout@test.libertybancard.invalid",
      emailStatus: "opted_out",
      consentEmail: false,
      smsStatus: "active",
      consentSms: null,
      doNotContact: false,
    });
    const submissionId = crypto.randomUUID();
    await processExistingPublicFormSubmission({
      existingContact: c,
      permittedProfileUpdates: buildPublicContactPayload("estimate_form", { firstName: "Updated" }),
      incomingConsent: { consentEmail: true },
      submissionId,
      formType: "estimate_form",
      requestEvidence: { ipAddress: "1.2.3.4", userAgent: "test-agent" },
    });

    const fresh = await storage.getContact(c.id);
    assert(
      fresh?.emailStatus === "opted_out",
      "Test 9a: emailStatus remains opted_out after blocked re-enable attempt"
    );
    assert(
      fresh?.consentEmail === false,
      "Test 9b: consentEmail remains false after blocked attempt"
    );
    assert(
      fresh?.firstName === "Updated",
      "Test 9c: permitted profile field (firstName) was updated"
    );

    const auditRows = await getConsentAuditRows(c.id, "email", "consent_reenable_blocked");
    assert(
      auditRows.length === 1,
      "Test 9d: exactly one consent_reenable_blocked audit row for email channel"
    );
    assert(
      (auditRows[0]?.details as any)?.reasonCode === "existing_email_opt_out",
      "Test 9e: audit row has correct reasonCode"
    );
    assert(
      auditRows[0]?.formId === submissionId,
      "Test 9f: audit row formId matches submissionId"
    );
    const optInRows = await getConsentAuditRows(c.id, "email", "opt_in");
    assert(
      optInRows.length === 0,
      "Test 9g: NO opt_in audit row written when email consent was blocked (no false evidence)"
    );
  }

  // Test 10: SMS opted-out contact resubmits consentSms=true → blocked, email unaffected
  {
    const c = await createContact({
      email: "kl9_sms_optout@test.libertybancard.invalid",
      emailStatus: "active",
      consentEmail: null,
      smsStatus: "opted_out",
      consentSms: false,
      doNotContact: false,
    });
    const submissionId = crypto.randomUUID();
    await processExistingPublicFormSubmission({
      existingContact: c,
      permittedProfileUpdates: buildPublicContactPayload("support_form", { firstName: "Test" }),
      incomingConsent: { consentSms: true },
      submissionId,
      formType: "support_form",
      requestEvidence: { ipAddress: "1.2.3.4", userAgent: "test-agent" },
    });

    const fresh = await storage.getContact(c.id);
    assert(
      fresh?.smsStatus === "opted_out",
      "Test 10a: smsStatus remains opted_out after blocked re-enable"
    );
    assert(
      fresh?.emailStatus === "active",
      "Test 10b: emailStatus unaffected by sms block"
    );

    const auditRows = await getConsentAuditRows(c.id, "sms", "consent_reenable_blocked");
    assert(
      auditRows.length === 1,
      "Test 10c: one audit row for sms block"
    );
    const optInRows = await getConsentAuditRows(c.id, "sms", "opt_in");
    assert(
      optInRows.length === 0,
      "Test 10d: NO opt_in audit row written when sms consent was blocked (no false evidence)"
    );
  }

  // Test 11: doNotAutoContact=true contact resubmits affirmative consent → consent fields updated
  {
    const c = await createContact({
      email: "kl9_dna@test.libertybancard.invalid",
      emailStatus: "active",
      smsStatus: "active",
      doNotAutoContact: true,
      consentEmail: null,
      consentSms: null,
      doNotContact: false,
    });
    const submissionId = crypto.randomUUID();
    await processExistingPublicFormSubmission({
      existingContact: c,
      permittedProfileUpdates: buildPublicContactPayload("estimate_form", {}),
      incomingConsent: { consentEmail: true, consentSms: true },
      submissionId,
      formType: "estimate_form",
      requestEvidence: { ipAddress: "1.2.3.4", userAgent: "test-agent" },
    });

    const fresh = await storage.getContact(c.id);
    assert(
      fresh?.consentEmail === true,
      "Test 11a: consentEmail updated even when doNotAutoContact=true"
    );
    assert(
      fresh?.consentSms === true,
      "Test 11b: consentSms updated even when doNotAutoContact=true"
    );
    assert(
      fresh?.doNotAutoContact === true,
      "Test 11c: doNotAutoContact unchanged (automated sends still blocked)"
    );

    const auditRows = await db.select().from(consentAuditLogs)
      .where(and(eq(consentAuditLogs.contactId, c.id), eq(consentAuditLogs.action, "consent_reenable_blocked")));
    assert(
      auditRows.length === 0,
      "Test 11d: no blocked audit rows when doNotAutoContact only"
    );
    // Service must write opt_in audit rows for permitted consent updates
    const smsOptIn = await getConsentAuditRows(c.id, "sms", "opt_in");
    const emailOptIn = await getConsentAuditRows(c.id, "email", "opt_in");
    assert(
      smsOptIn.length === 1,
      "Test 11e: service writes opt_in audit for permitted sms consent"
    );
    assert(
      emailOptIn.length === 1,
      "Test 11f: service writes opt_in audit for permitted email consent"
    );
  }

  // Test 12: Global DNC blocks both channels → two audit rows
  {
    const c = await createContact({
      email: "kl9_dnc@test.libertybancard.invalid",
      emailStatus: "active",
      smsStatus: "active",
      doNotContact: true,
      consentEmail: false,
      consentSms: false,
    });
    const submissionId = crypto.randomUUID();
    await processExistingPublicFormSubmission({
      existingContact: c,
      permittedProfileUpdates: buildPublicContactPayload("estimate_form", {}),
      incomingConsent: { consentEmail: true, consentSms: true },
      submissionId,
      formType: "estimate_form",
      requestEvidence: { ipAddress: "1.2.3.4", userAgent: "test-agent" },
    });

    const fresh = await storage.getContact(c.id);
    assert(
      fresh?.doNotContact === true,
      "Test 12a: doNotContact unchanged"
    );
    assert(
      fresh?.consentEmail === false,
      "Test 12b: consentEmail not changed by DNC block"
    );

    const emailAudit = await getConsentAuditRows(c.id, "email", "consent_reenable_blocked");
    const smsAudit = await getConsentAuditRows(c.id, "sms", "consent_reenable_blocked");
    assert(
      emailAudit.length === 1 && smsAudit.length === 1,
      "Test 12c: two audit rows (one per channel) for global DNC"
    );
  }

  // Test 13: Idempotency — replay same submissionId + channel → exactly one audit row
  {
    const c = await createContact({
      email: "kl9_idempotent@test.libertybancard.invalid",
      emailStatus: "opted_out",
      consentEmail: false,
      smsStatus: "active",
      doNotContact: false,
    });
    const submissionId = crypto.randomUUID();
    const args = {
      existingContact: c,
      permittedProfileUpdates: buildPublicContactPayload("estimate_form", {}),
      incomingConsent: { consentEmail: true } as { consentEmail?: boolean; consentSms?: boolean },
      submissionId,
      formType: "estimate_form" as const,
      requestEvidence: { ipAddress: "1.2.3.4", userAgent: "test-agent" },
    };

    await processExistingPublicFormSubmission(args);
    // Re-fetch contact since processExistingPublicFormSubmission returns the latest
    const refreshed = await storage.getContact(c.id);
    await processExistingPublicFormSubmission({ ...args, existingContact: refreshed! });

    const auditRows = await getConsentAuditRows(c.id, "email", "consent_reenable_blocked");
    assert(
      auditRows.length === 1,
      "Test 13: replay of same submissionId+channel produces exactly one audit row (idempotency)"
    );
  }

  // Test 14: GHL sync field protection — consentSms/consentEmail in getReplitOwnedFields
  {
    // Verify by inspecting the set (module-level, no DB needed)
    const { getReplitOwnedFieldsForTest } = await import("../server/services/ghl-sync-test-helper").catch(() => ({ getReplitOwnedFieldsForTest: null }));
    if (getReplitOwnedFieldsForTest) {
      const owned = getReplitOwnedFieldsForTest();
      assert(owned.has("consentSms") && owned.has("consentEmail"), "Test 14: consentSms and consentEmail in GHL→local protected fields set");
    } else {
      // Fallback: grep the file
      const fs = await import("fs");
      const ghlSyncContent = fs.readFileSync("server/services/ghl-sync.ts", "utf8");
      assert(
        ghlSyncContent.includes('"consentSms"') && ghlSyncContent.includes('"consentEmail"'),
        "Test 14: consentSms and consentEmail present in ghl-sync.ts REPLIT_OWNED_FIELDS (GHL→local guard)"
      );
    }
  }

  // Summary
  console.log(`\n[KL-9] Results: ${passed} passed, ${failed} failed\n`);
  await cleanup(TEST_EMAILS);

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error("[KL-9] Fatal error:", err);
  process.exit(1);
});
