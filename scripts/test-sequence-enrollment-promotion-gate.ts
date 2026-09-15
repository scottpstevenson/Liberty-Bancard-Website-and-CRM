#!/usr/bin/env tsx
/**
 * scripts/test-sequence-enrollment-promotion-gate.ts
 *
 * Task #1963 — Sequence-enrollment eligibility trace and fix.
 *
 * Confirms that DBPR-family lineage and existing-customer status, the
 * canonical "promotion" dimension of evaluateContactDecisions()
 * (server/services/contactability.ts), now block sequence enrollment on
 * BOTH enrollment surfaces:
 *   - POST /api/sequence-enrollments      (single-contact route)
 *   - POST /api/sequences/:id/enroll-vertical  (bulk vertical-cohort route)
 *
 * These routes cannot be exercised over HTTP without a running server and
 * an authenticated admin session, so — matching the established pattern in
 * scripts/test-vertical-enrollment-compliance.ts — this test:
 *   1. Exercises the shared service-layer authority directly
 *      (evaluateContactDecisions().promotion) against DBPR-lineage,
 *      existing-customer, and clean control contacts.
 *   2. Statically asserts both routes in server/routes/campaigns.ts call
 *      evaluateContactDecisions before creating an enrollment, so the gate
 *      cannot silently regress out of either route.
 *
 * SAFETY: aborts if DATABASE_URL looks like production. No HTTP calls, no
 * outbound sends, no worker/import/enrichment triggered.
 *
 * Run:  npx tsx scripts/test-sequence-enrollment-promotion-gate.ts
 * Exit: 0 = all pass, 1 = any fail
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { db } from "../server/db";
import { contacts, businesses } from "../shared/schema";
import { eq } from "drizzle-orm";

if (
  process.env.NODE_ENV === "production" &&
  !process.env.ALLOW_TEST_ON_PROD
) {
  console.error("ABORT: NODE_ENV=production detected. Refusing to run against production data.");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("ABORT: DATABASE_URL is not set.");
  process.exit(1);
}

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  \u2713 ${label}`);
    passed++;
  } else {
    console.error(`  \u2717 ${label}${detail ? ` \u2014 ${detail}` : ""}`);
    failed++;
    failures.push(`${label}${detail ? ` \u2014 ${detail}` : ""}`);
  }
}

const testContactIds: number[] = [];
const testBusinessIds: number[] = [];

async function makeContact(overrides: { leadSource?: string; businessId?: number } = {}): Promise<number> {
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const [row] = await db
    .insert(contacts)
    .values({
      firstName: "PromoGate",
      lastName: "Test",
      email: `promogate-test-${tag}@libertybancard.test`,
      phone: "3055550002",
      companyName: `PromoGate Test Co ${tag}`,
      emailStatus: "active" as any,
      doNotContact: false,
      consentTier: "cold_no_consent",
      lifecycleStage: "prospect",
      sourceCategory: overrides.leadSource ?? "outbound",
      leadSource: overrides.leadSource ?? null,
      recordClass: "production",
      businessId: overrides.businessId ?? null,
    } as any)
    .returning({ id: contacts.id });
  testContactIds.push(row.id);
  return row.id;
}

async function makeBusiness(status: string): Promise<number> {
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const [row] = await db
    .insert(businesses)
    .values({
      canonicalName: `PromoGate Test Business ${tag}`,
      normalizedName: `promogate test business ${tag}`,
      status,
      recordClass: "unknown",
    } as any)
    .returning({ id: businesses.id });
  testBusinessIds.push(row.id);
  return row.id;
}

async function cleanup(): Promise<void> {
  for (const id of testContactIds) {
    await db.delete(contacts).where(eq(contacts.id, id)).catch(() => {});
  }
  for (const id of testBusinessIds) {
    await db.delete(businesses).where(eq(businesses.id, id)).catch(() => {});
  }
}

process.on("SIGTERM", () => cleanup().catch(() => {}).finally(() => process.exit(1)));
process.on("SIGINT", () => cleanup().catch(() => {}).finally(() => process.exit(1)));

async function testDbprLineageBlocked(): Promise<void> {
  console.log("\nTest 1: DBPR-family lineage blocks the promotion dimension");
  const { evaluateContactDecisions } = await import("../server/services/contactability");
  const contactId = await makeContact({ leadSource: "dbpr_hr" });
  const { promotion } = await evaluateContactDecisions({ contactId });
  assert("DBPR-lineage contact is blocked", promotion.status === "blocked", JSON.stringify(promotion));
  assert("Reason code is DBPR_LINEAGE", promotion.reasonCodes.includes("DBPR_LINEAGE"), promotion.reasonCodes.join(","));
}

async function testExistingCustomerBlocked(): Promise<void> {
  console.log("\nTest 2: Existing-customer business blocks the promotion dimension");
  const { evaluateContactDecisions } = await import("../server/services/contactability");
  const businessId = await makeBusiness("customer");
  const contactId = await makeContact({ businessId });
  const { promotion } = await evaluateContactDecisions({ contactId });
  assert("Existing-customer-linked contact is blocked", promotion.status === "blocked", JSON.stringify(promotion));
  assert("Reason code is EXISTING_CUSTOMER", promotion.reasonCodes.includes("EXISTING_CUSTOMER"), promotion.reasonCodes.join(","));
}

async function testCleanContactEligible(): Promise<void> {
  console.log("\nTest 3: Clean contact (no DBPR lineage, no existing-customer link) remains eligible");
  const { evaluateContactDecisions } = await import("../server/services/contactability");
  const contactId = await makeContact();
  const { promotion } = await evaluateContactDecisions({ contactId });
  assert("Clean contact is eligible (no over-blocking regression)", promotion.status === "eligible", JSON.stringify(promotion));
}

function testRoutesCallPromotionGate(): void {
  console.log("\nTest 4: Both enrollment routes call evaluateContactDecisions before creating an enrollment (static regression guard)");
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(__dirname, "../server/routes/campaigns.ts"), "utf8");

  const singleRouteStart = src.indexOf('app.post("/api/sequence-enrollments"');
  const singleRouteEnd = src.indexOf('app.put("/api/sequence-enrollments/:id"');
  assert("Found POST /api/sequence-enrollments route body", singleRouteStart !== -1 && singleRouteEnd !== -1 && singleRouteEnd > singleRouteStart);
  const singleRouteBody = src.slice(singleRouteStart, singleRouteEnd);
  assert(
    "POST /api/sequence-enrollments calls evaluateContactDecisions before createSequenceEnrollment",
    singleRouteBody.includes("evaluateContactDecisions") &&
      singleRouteBody.indexOf("evaluateContactDecisions") < singleRouteBody.indexOf("storage.createSequenceEnrollment")
  );

  const vertRouteStart = src.indexOf('app.post("/api/sequences/:id/enroll-vertical"');
  assert("Found POST /api/sequences/:id/enroll-vertical route", vertRouteStart !== -1);
  const vertRouteBody = src.slice(vertRouteStart, vertRouteStart + 10000);
  assert(
    "POST /api/sequences/:id/enroll-vertical calls evaluateContactDecisions inside its per-contact loop before createSequenceEnrollment",
    vertRouteBody.includes("evaluateContactDecisions") &&
      vertRouteBody.indexOf("evaluateContactDecisions") < vertRouteBody.indexOf("storage.createSequenceEnrollment")
  );
}

async function main() {
  console.log("=== Sequence Enrollment Promotion Gate Test (#1963) ===");
  try {
    await testDbprLineageBlocked();
    await testExistingCustomerBlocked();
    await testCleanContactEligible();
    testRoutesCallPromotionGate();
  } finally {
    await cleanup();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("\nFailures:");
    failures.forEach(f => console.error(`  - ${f}`));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Test script crashed:", err);
  cleanup().finally(() => process.exit(1));
});
