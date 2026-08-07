#!/usr/bin/env tsx
/**
 * Smoke test — promotional enrollment quality gate (Task #1266)
 *
 * Verifies that evaluatePromotionalEnrollmentEligibility correctly blocks:
 *   1. Malformed email address (missing @)
 *   2. Disposable email domain (mailinator.com)
 *   3. Permanently bad emailStatus: "blocked"
 *   4. Permanently bad emailStatus: "invalid"
 *   5. Permanently bad emailStatus: "bounced"
 *   6. Permanently bad emailStatus: "unsafe" (ZeroBounce spam trap / abuse)
 *   7. doNotContact = true  (pre-existing dnc gate)
 *
 * And correctly ALLOWS:
 *   8. Contact with emailStatus = "unverified" (pending enrichment — must NOT be blocked)
 *   9. Contact with emailStatus = "unknown"    (pending enrichment — must NOT be blocked)
 *  10. Contact with valid email and emailStatus = "active"
 *
 * Uses direct DB row insertion / cleanup so no real contacts are dirtied.
 * Run with:
 *   npx tsx scripts/smoke-enrollment-quality-gate.ts
 *
 * Exits 0 on all-pass, 1 on any failure.
 */

import { db } from "../server/db";
import { contacts } from "../shared/schema";
import { eq } from "drizzle-orm";
import { evaluatePromotionalEnrollmentEligibility } from "../server/services/promotional-enrollment-eligibility";

const TEST_PREFIX = "smoke_gate_";

let passed = 0;
let failed = 0;
const createdIds: number[] = [];

function pass(label: string) {
  console.log(`  ✓ ${label}`);
  passed++;
}

function fail(label: string, detail?: string) {
  console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  failed++;
}

async function createContact(overrides: Partial<typeof contacts.$inferInsert>): Promise<number> {
  const [row] = await db
    .insert(contacts)
    .values({
      firstName: "SmokeTest",
      lastName: "Gate",
      email: `${TEST_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`,
      phone: "",
      status: "New",
      sourceCategory: "inbound",
      consentTier: "warm_no_pewc",
      emailStatus: "active",
      smsStatus: "active",
      doNotContact: false,
      ...overrides,
    })
    .returning({ id: contacts.id });
  createdIds.push(row.id);
  return row.id;
}

async function cleanup() {
  for (const id of createdIds) {
    await db.delete(contacts).where(eq(contacts.id, id)).catch(() => {});
  }
}

interface Case {
  label: string;
  overrides: Partial<typeof contacts.$inferInsert>;
  expectEligible: boolean;
  expectedReasonCode?: string;
}

const CASES: Case[] = [
  // ── Blocked cases ─────────────────────────────────────────────────────────
  {
    label: "Case 1: malformed email (no @)",
    overrides: { email: "notanemail" },
    expectEligible: false,
    expectedReasonCode: "invalid_email_format",
  },
  {
    label: "Case 2: malformed email (missing domain)",
    overrides: { email: "user@" },
    expectEligible: false,
    expectedReasonCode: "invalid_email_format",
  },
  {
    label: "Case 3: disposable domain (mailinator.com)",
    overrides: { email: `${TEST_PREFIX}bot@mailinator.com` },
    expectEligible: false,
    expectedReasonCode: "disposable_email_domain",
  },
  {
    label: "Case 4: disposable domain (yopmail.com)",
    overrides: { email: `${TEST_PREFIX}spam@yopmail.com` },
    expectEligible: false,
    expectedReasonCode: "disposable_email_domain",
  },
  {
    label: "Case 5: emailStatus = blocked",
    overrides: { emailStatus: "blocked" },
    expectEligible: false,
    expectedReasonCode: "email_status_blocked",
  },
  {
    label: "Case 6: emailStatus = invalid",
    overrides: { emailStatus: "invalid" },
    expectEligible: false,
    expectedReasonCode: "email_status_blocked",
  },
  {
    label: "Case 7: emailStatus = bounced",
    overrides: { emailStatus: "bounced" },
    expectEligible: false,
    expectedReasonCode: "email_status_blocked",
  },
  {
    label: "Case 8: emailStatus = unsafe (ZeroBounce spam trap / abuse)",
    overrides: { emailStatus: "unsafe" },
    expectEligible: false,
    expectedReasonCode: "email_status_blocked",
  },
  {
    label: "Case 9: doNotContact = true (pre-existing dnc gate)",
    overrides: { doNotContact: true },
    expectEligible: false,
    expectedReasonCode: "dnc",
  },
  // ── Allowed cases — enrichment still pending ──────────────────────────────
  {
    label: "Case 10: emailStatus = unverified (pending enrichment — must be ALLOWED)",
    overrides: { emailStatus: "unverified" },
    expectEligible: true,
  },
  {
    label: "Case 11: emailStatus = unknown (pending enrichment — must be ALLOWED)",
    overrides: { emailStatus: "unknown" },
    expectEligible: true,
  },
  {
    label: "Case 12: valid email and emailStatus = active",
    overrides: {},
    expectEligible: true,
  },
];

async function runCases() {
  for (const c of CASES) {
    let contactId: number | undefined;
    try {
      contactId = await createContact(c.overrides);
      const result = await evaluatePromotionalEnrollmentEligibility(
        contactId,
        "form_submitted",
        {}
      );

      const eligibleOk = result.eligible === c.expectEligible;
      const reasonOk =
        !c.expectedReasonCode ||
        result.reasonCodes.includes(c.expectedReasonCode as any);

      if (eligibleOk && reasonOk) {
        pass(c.label);
      } else {
        const got = `eligible=${result.eligible}, reasonCodes=${JSON.stringify(result.reasonCodes)}`;
        const want = `eligible=${c.expectEligible}${c.expectedReasonCode ? `, reasonCode includes ${c.expectedReasonCode}` : ""}`;
        fail(c.label, `got {${got}}, want {${want}}`);
      }
    } catch (err: any) {
      fail(c.label, `threw: ${err?.message ?? err}`);
    }
  }
}

async function main() {
  console.log("Promotional Enrollment Quality Gate — smoke test\n");
  try {
    await runCases();
  } finally {
    await cleanup();
  }
  console.log(`\n${passed + failed} checks: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
