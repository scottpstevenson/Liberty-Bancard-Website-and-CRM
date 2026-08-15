#!/usr/bin/env tsx
/**
 * Smoke test: 'unvalidated' email status gates
 *
 * Functional tests:
 *  1. getContactsForCampaignAudience / countContactsForCampaignAudience exclude 'unvalidated'
 *  2. evaluateContactability() blocks 'unvalidated' at Step 9
 *  3. 'valid' contact NOT blocked at Step 9 (regression guard)
 *
 * Behavioral tests for passesZeroBounceCheck() (injected-dep interface):
 *  4. Budget exhaustion → false for null/active/unvalidated contacts
 *  5. Budget exhaustion → true for already-checked contacts (unverified/unknown)
 *  6. Failed credit claim → false for null/active/unvalidated contacts
 *  7. ZB returns invalid ('unsafe') → false even when audit writes throw
 *  8. ZB returns 'valid' → true (regression guard)
 *
 * Static code checks:
 *  9.  schema.ts column default is 'unvalidated'
 * 10. Winback engine SQL excludes unvalidated
 * 11. Outreach-queue SQL excludes unvalidated
 * 12. passesZeroBounceCheck fast-return excludes 'unvalidated'
 * 13. Legacy prospect sender skip-guard does NOT include 'unvalidated' (lazy ZB path reachable)
 *
 * No real ZeroBounce API calls are made.
 *
 * Run:
 *   npx tsx scripts/test-email-status-unvalidated.ts
 */

import { db, pool } from "../server/db";
import { contacts } from "../shared/schema";
import { eq } from "drizzle-orm";
import { storage } from "../server/storage";
import { evaluateContactability } from "../server/services/contactability";
import { passesZeroBounceCheck } from "../server/services/campaign-engine";
import * as fs from "fs";

let passed = 0;
let failed = 0;
const failures: string[] = [];
const testContactIds: number[] = [];

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

async function makeContact(emailStatus: string, consentTier = "pewc_full_automation"): Promise<number> {
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const [row] = await db
    .insert(contacts)
    .values({
      firstName: "UnvalidatedSmoke",
      lastName: "QALead",
      email: `unvalidated-smoke-${tag}@libertybancard.test`,
      phone: "3055559901",
      companyName: `QA UnvalidatedSmoke Co ${tag}`,
      emailStatus,
      smsStatus: "active",
      doNotContact: false,
      doNotAutoContact: false,
      consentTier,
      lifecycleStage: "prospect",
      sourceCategory: "outbound",
    } as any)
    .returning({ id: contacts.id });
  testContactIds.push(row.id);
  return row.id;
}

async function cleanup(): Promise<void> {
  for (const id of testContactIds) {
    await db.delete(contacts).where(eq(contacts.id, id)).catch(() => {});
  }
}

// ── Dep factories for passesZeroBounceCheck behavioral tests ─────────────────

const budgetExhaustedDeps = {
  checkBudget: async () => ({ allowed: false, used: 500, limit: 500 }),
};

const creditFailDeps = {
  checkBudget: async () => ({ allowed: true, used: 1, limit: 500 }),
  claimCredit: async () => false,
};

function zbReturnsDeps(status: string, auditFn?: () => Promise<unknown>) {
  return {
    checkBudget: async () => ({ allowed: true, used: 1, limit: 500 }),
    claimCredit: async () => true,
    runVerifyEmail: async () => ({ status, subStatus: null }),
    ...(auditFn ? { runAuditLog: auditFn } : {}),
  };
}

// ── Test runner ───────────────────────────────────────────────────────────────

async function runTests(): Promise<void> {
  console.log("=== Email Status Unvalidated Smoke Test ===\n");

  // ── Tests 1–3: Functional DB / contactability tests ──────────────────────

  console.log("Test 1: Campaign audience count excludes 'unvalidated', includes 'valid'");
  const baseCount = await storage.countContactsForCampaignAudience({});

  const unvalidatedId = await makeContact("unvalidated");
  const afterUnvalidated = await storage.countContactsForCampaignAudience({});
  assert(
    "adding 'unvalidated' contact does NOT increase campaign audience count",
    afterUnvalidated === baseCount,
    `base=${baseCount} after=${afterUnvalidated}`,
  );

  const validId = await makeContact("valid");
  const afterValid = await storage.countContactsForCampaignAudience({});
  assert(
    "adding 'valid' contact DOES increase campaign audience count by 1",
    afterValid === baseCount + 1,
    `base=${baseCount} after=${afterValid}`,
  );

  console.log("\nTest 2: evaluateContactability blocks 'unvalidated' at Step 9");
  const blocked = await evaluateContactability({ contactId: unvalidatedId, channel: "email", mode: "dryRun" });
  assert("'unvalidated' contact blocked by contactability", !blocked.allowed, blocked.reason ?? "(no reason)");
  assert(
    "block reason references email status",
    (blocked.reason?.toLowerCase().includes("unvalidated") ?? false) ||
      (blocked.reason?.toLowerCase().includes("email status") ?? false) ||
      (blocked.reason?.toLowerCase().includes("status") ?? false),
    blocked.reason ?? "(no reason)",
  );

  console.log("\nTest 3: 'valid' contact not blocked at Step 9 due to email status");
  const validResult = await evaluateContactability({ contactId: validId, channel: "email", mode: "dryRun" });
  const blockedByStatus =
    !validResult.allowed &&
    ((validResult.reason?.toLowerCase().includes("unvalidated") ?? false) ||
      (validResult.reason?.toLowerCase().includes("email status") ?? false));
  assert("'valid' contact NOT blocked at Step 9 due to email status", !blockedByStatus, validResult.reason ?? "");

  // ── Tests 4–8: passesZeroBounceCheck behavioral tests ────────────────────
  // Contact must have a real email for the function to proceed past the email check.
  const [row] = await db.select({ email: contacts.email }).from(contacts).where(eq(contacts.id, unvalidatedId));
  const zbContact = { id: unvalidatedId, email: row!.email, emailStatus: "unvalidated" as string | null };

  console.log("\nTest 4: passesZeroBounceCheck — budget exhaustion → false for unvalidated contacts");
  for (const status of [null, "active", "unvalidated"] as (string | null)[]) {
    const result = await passesZeroBounceCheck({ ...zbContact, emailStatus: status }, 999999, budgetExhaustedDeps);
    assert(`budget exhaustion → false for emailStatus=${JSON.stringify(status)}`, result === false, `got ${result}`);
  }

  console.log("\nTest 5: passesZeroBounceCheck — budget exhaustion → true for already-checked contacts");
  for (const status of ["unverified", "unknown"]) {
    const result = await passesZeroBounceCheck({ ...zbContact, emailStatus: status }, 999999, budgetExhaustedDeps);
    assert(`budget exhaustion → true for emailStatus='${status}'`, result === true, `got ${result}`);
  }

  console.log("\nTest 6: passesZeroBounceCheck — failed credit claim → false for unvalidated contacts");
  for (const status of [null, "active", "unvalidated"] as (string | null)[]) {
    const result = await passesZeroBounceCheck({ ...zbContact, emailStatus: status }, 999999, creditFailDeps);
    assert(`credit claim failure → false for emailStatus=${JSON.stringify(status)}`, result === false, `got ${result}`);
  }

  console.log("\nTest 7: passesZeroBounceCheck — ZB returns 'unsafe' → false even when audit writes throw");
  let auditAttempts = 0;
  const throwingAuditFn = async () => {
    auditAttempts++;
    throw new Error("Simulated audit write failure");
  };
  const invalidResult = await passesZeroBounceCheck(
    { ...zbContact, emailStatus: "unvalidated" },
    999999,
    zbReturnsDeps("unsafe", throwingAuditFn),
  );
  assert(
    "ZB returns 'unsafe' → false even when audit writes throw",
    invalidResult === false,
    `got ${invalidResult}; audit attempts=${auditAttempts}`,
  );
  assert("at least one audit write was attempted", auditAttempts > 0, `auditAttempts=${auditAttempts}`);

  console.log("\nTest 8: passesZeroBounceCheck — ZB returns 'valid' → true (regression guard)");
  const validZbResult = await passesZeroBounceCheck(
    { ...zbContact, emailStatus: "unvalidated" },
    999999,
    zbReturnsDeps("valid"),
  );
  assert("ZB returns 'valid' → passesZeroBounceCheck returns true", validZbResult === true, `got ${validZbResult}`);

  // ── Tests 9–13: Static code checks ───────────────────────────────────────

  console.log("\nTest 9: schema.ts column default is 'unvalidated'");
  const schemaCode = fs.readFileSync("./shared/schema.ts", "utf8");
  assert(
    "schema.ts emailStatus defaults to 'unvalidated'",
    schemaCode.includes('text("email_status").notNull().default("unvalidated")'),
    "email_status column default is not 'unvalidated'",
  );

  console.log("\nTest 10: Winback engine SQL uses explicit allowlist — only 'valid' status");
  const winbackCode = fs.readFileSync("./server/services/winback-outreach-engine.ts", "utf8");
  // Allowlist approach: only email_status = 'valid' is eligible for winback sends.
  // This excludes unvalidated, unknown, unverified, active, unsafe, bounced, and any unknown future status.
  assert(
    "winback SQL uses allowlist (email_status = 'valid')",
    winbackCode.includes("email_status = 'valid'"),
    "allowlist pattern not found; winback may allow unconfirmed statuses",
  );
  assert(
    "winback SQL does not use blacklist approach (NOT IN)",
    !winbackCode.includes("email_status NOT IN"),
    "NOT IN still present — switch to allowlist",
  );
  assert(
    "winback SQL does not allow IS NULL",
    !winbackCode.includes("email_status IS NULL OR"),
    "IS NULL allowance still present",
  );

  console.log("\nTest 11: Outreach-queue SQL excludes 'unvalidated'");
  const queueCode = fs.readFileSync("./server/routes/outreach-queue.ts", "utf8");
  assert("outreach-queue COALESCE SQL contains 'unvalidated'", queueCode.includes("'unvalidated'"), "pattern not found");
  assert('badEmailStatuses array includes "unvalidated"', queueCode.includes('"unvalidated"'), "missing from badEmailStatuses");

  console.log("\nTest 12: passesZeroBounceCheck fast-return guard excludes 'unvalidated'");
  const campaignCode = fs.readFileSync("./server/services/campaign-engine.ts", "utf8");
  assert(
    "fast-return guard excludes 'unvalidated' status",
    campaignCode.includes('emailStatus !== "unvalidated"'),
    "fast-return unvalidated guard not found",
  );

  console.log("\nTest 13: Legacy prospect sender skip-guard does NOT include 'unvalidated' (lazy ZB path reachable)");
  // The skip guard should only block bounced/invalid/unsafe; unvalidated falls through to lazy ZB.
  assert(
    "legacy skip-guard does not immediately skip 'unvalidated'",
    !campaignCode.includes('contact.emailStatus === "unsafe" || contact.emailStatus === "unvalidated"'),
    "unvalidated still in legacy skip-guard alongside unsafe",
  );
}

async function main(): Promise<void> {
  try {
    await runTests();
  } finally {
    await cleanup();
    await pool.end();
  }

  console.log(`\n${"=".repeat(56)}`);
  console.log("Email Status Unvalidated Smoke Test Results:");
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  if (failures.length > 0) {
    console.log("\nFailed assertions:");
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  console.log("=".repeat(56));

  if (failed > 0) {
    console.error("\n✗ Smoke test FAILED.\n");
    process.exit(1);
  } else {
    console.log(`\n✅ All ${passed} assertions passed.\n`);
  }
}

main().catch((err) => {
  console.error("Smoke test runner error:", err);
  process.exit(1);
});
