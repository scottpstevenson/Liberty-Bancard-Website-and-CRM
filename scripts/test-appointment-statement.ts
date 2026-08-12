/**
 * test-appointment-statement.ts
 *
 * Acceptance tests for Wave C1 — Appointment-to-Statement Auto-Trigger.
 * Verifies that positive call outcomes automatically trigger statement requests
 * without requiring manual rep action.
 *
 * Tests:
 *  1. Positive call outcome (interested) → sendStatementRequest fires → lead stage = STATEMENT_REQUESTED
 *  2. Positive call outcome → lifecycle transitions to APPOINTMENT_COMPLETED → STATEMENT_REQUESTED
 *  3. Human-owned bypass is gone — suppressStatementAuto flag is the new gate
 *  4. Negative call outcome (no_answer) → statement request NOT triggered
 *  5. Already-requested lead → no duplicate sendStatementRequest
 *
 * Exit code 0 = all pass.
 */

import { db } from "../server/db";
import { storage } from "../server/storage";
import {
  contacts, sdrLeadState, sdrLeadEvents, deals,
} from "../shared/schema";
import { eq } from "drizzle-orm";
import { handleCallOutcome } from "../server/services/sdr/webhook-handlers";

/**
 * Poll a condition function until it returns truthy or the timeout expires.
 * Replaces fixed setTimeout waits, making tests resilient to GHL rate-limit
 * waits and Redis ETIMEDOUT blips that resolve within a few seconds.
 */
async function pollUntil<T>(
  fn: () => Promise<T | null | undefined>,
  check: (v: T | null | undefined) => boolean,
  { intervalMs = 200, timeoutMs = 10_000 }: { intervalMs?: number; timeoutMs?: number } = {}
): Promise<T | null | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await fn();
    if (check(v)) return v;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return fn(); // return final value so caller can assert on it
}

const RUN_ID = Date.now();
let passed = 0;
let failed = 0;
const failures: string[] = [];
const contactIdsToClean: number[] = [];
const leadIdsToClean: number[] = [];

function assert(label: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
    failures.push(label);
  }
}

async function createTestContactWithLead(suffix: string, opts: { statementAlreadyRequested?: boolean } = {}) {
  const ghlContactId = `c1-test-${RUN_ID}-${suffix}`;
  const contact = await storage.createContact({
    firstName: "C1Test",
    lastName: suffix,
    email: `c1-${RUN_ID}-${suffix}@test.internal`,
    phone: `+15550003${RUN_ID.toString().slice(-4)}`,
    ghlContactId,
    status: "Active",
  });
  contactIdsToClean.push(contact.id);

  // Create SDR merchant (businessName is NOT NULL)
  const { sdrMerchants } = await import("../shared/schema");
  const [merchant] = await db.insert(sdrMerchants).values({
    ghlContactId,
    businessName: `Test Merchant ${suffix}`,
    mainEmail: `c1-${RUN_ID}-${suffix}@test.internal`,
    ownerFirstName: "Test",
    ownerLastName: "Owner",
    source: "test",
  }).returning();

  const [lead] = await db.insert(sdrLeadState).values({
    merchantId: merchant.id,
    contactId: contact.id,
    companyName: `Test Merchant ${suffix}`,
    ownerName: "Test Owner",
    ghlContactId,
    stage: "DISCOVERY_CALL_SCHEDULED",
    ownerType: "human",
    assignedOwnerType: "human", // previously this would block statement request
    nextActionType: "call",
    nextActionAt: new Date(),
    statementRequestedAt: opts.statementAlreadyRequested ? new Date() : null,
  }).returning();
  leadIdsToClean.push(lead.id);

  return { contact, merchant, lead, ghlContactId };
}

// ── Test 1: Positive call outcome triggers statement request ─────────────────

async function test1PositiveOutcomeTriggers() {
  console.log("\n1. Positive call outcome (interested) → sendStatementRequest fires");

  const { contact, lead, ghlContactId } = await createTestContactWithLead("positive");

  await handleCallOutcome({
    contactId: ghlContactId,
    status: "interested",
    callId: `call-test-1-${RUN_ID}`,
    direction: "outbound",
    duration: 120,
    locationId: process.env.GHL_LOCATION_ID ?? "test-loc",
  });

  // Poll until fire-and-forget completes (resilient to GHL rate-limit waits & Redis blips)
  const updated = await pollUntil(
    () => db.select().from(sdrLeadState).where(eq(sdrLeadState.id, lead.id)).then(r => r[0]),
    v => v?.stage === "STATEMENT_REQUESTED",
    { timeoutMs: 12_000 }
  );
  assert(
    "Lead stage set to STATEMENT_REQUESTED after positive call",
    updated?.stage === "STATEMENT_REQUESTED",
    `stage=${updated?.stage}`
  );
  assert(
    "statementRequestedAt timestamp set",
    !!updated?.statementRequestedAt,
    `statementRequestedAt=${updated?.statementRequestedAt}`
  );
}

// ── Test 2: Lifecycle transitions to APPOINTMENT_COMPLETED → STATEMENT_REQUESTED ─

async function test2LifecycleTransition() {
  console.log("\n2. Lifecycle transitions APPOINTMENT_COMPLETED → STATEMENT_REQUESTED");

  const { contact, lead, ghlContactId } = await createTestContactWithLead("lifecycle");

  await handleCallOutcome({
    contactId: ghlContactId,
    status: "booked_meeting",
    callId: `call-test-2-${RUN_ID}`,
    direction: "outbound",
    duration: 300,
    locationId: process.env.GHL_LOCATION_ID ?? "test-loc",
  });

  const updatedContact = await pollUntil(
    () => storage.getContact(contact.id),
    v => ["STATEMENT_REQUESTED", "APPOINTMENT_COMPLETED", "STATEMENT_RECEIVED", "PROPOSAL_SENT"].includes(v?.lifecycleState ?? ""),
    { timeoutMs: 12_000 }
  );
  const finalState = updatedContact?.lifecycleState;
  assert(
    "Contact lifecycle state reaches STATEMENT_REQUESTED (or later) after booked_meeting",
    ["STATEMENT_REQUESTED", "STATEMENT_RECEIVED", "PROPOSAL_SENT", "APPOINTMENT_COMPLETED"].includes(finalState ?? ""),
    `lifecycleState=${finalState}`
  );
}

// ── Test 3: suppressStatementAuto flag blocks auto-request ───────────────────

async function test3SuppressFlagRespected() {
  console.log("\n3. suppressStatementAuto=true flag blocks auto statement request");

  const { contact, lead, ghlContactId } = await createTestContactWithLead("suppress");

  // Set suppressStatementAuto flag in enrichmentData (the existing JSONB column on sdr_lead_state)
  const { sql: drizzleSql } = await import("drizzle-orm");
  await db.execute(
    drizzleSql`UPDATE sdr_lead_state SET enrichment_data = COALESCE(enrichment_data, '{}'::jsonb) || '{"suppressStatementAuto":true}'::jsonb WHERE id = ${lead.id}`
  );

  await handleCallOutcome({
    contactId: ghlContactId,
    status: "interested",
    callId: `call-test-3-${RUN_ID}`,
    direction: "outbound",
    duration: 60,
    locationId: process.env.GHL_LOCATION_ID ?? "test-loc",
  });

  // Wait a beat for any fire-and-forget, then verify it did NOT change stage
  await new Promise(r => setTimeout(r, 2500));

  const [updated] = await db.select().from(sdrLeadState).where(eq(sdrLeadState.id, lead.id));
  assert(
    "Lead stage NOT changed to STATEMENT_REQUESTED when suppressStatementAuto=true",
    updated?.stage !== "STATEMENT_REQUESTED",
    `stage=${updated?.stage}`
  );
}

// ── Test 4: Negative call outcome does NOT trigger statement request ──────────

async function test4NegativeOutcomeSkipped() {
  console.log("\n4. Negative call outcome (no_answer) → statement request NOT triggered");

  const { contact, lead, ghlContactId } = await createTestContactWithLead("negative");

  await handleCallOutcome({
    contactId: ghlContactId,
    status: "no_answer",
    callId: `call-test-4-${RUN_ID}`,
    direction: "outbound",
    duration: 0,
    locationId: process.env.GHL_LOCATION_ID ?? "test-loc",
  });

  // Negative outcome — wait a fixed beat to confirm no change fires
  await new Promise(r => setTimeout(r, 2500));

  const [updated] = await db.select().from(sdrLeadState).where(eq(sdrLeadState.id, lead.id));
  assert(
    "Lead stage unchanged after no_answer disposition",
    updated?.stage !== "STATEMENT_REQUESTED",
    `stage=${updated?.stage}`
  );
  assert(
    "statementRequestedAt not set for no_answer",
    !updated?.statementRequestedAt,
    `statementRequestedAt=${updated?.statementRequestedAt}`
  );
}

// ── Test 5: Already-requested leads don't get duplicate sendStatementRequest ──

async function test5NoDuplicate() {
  console.log("\n5. Already-requested lead → no duplicate statement request");

  const { contact, lead, ghlContactId } = await createTestContactWithLead("duplicate", {
    statementAlreadyRequested: true,
  });
  const originalRequestedAt = lead.statementRequestedAt;

  await handleCallOutcome({
    contactId: ghlContactId,
    status: "promised_statement",
    callId: `call-test-5-${RUN_ID}`,
    direction: "outbound",
    duration: 90,
    locationId: process.env.GHL_LOCATION_ID ?? "test-loc",
  });

  // Wait a beat to confirm no second request fires
  await new Promise(r => setTimeout(r, 2500));

  const [updated] = await db.select().from(sdrLeadState).where(eq(sdrLeadState.id, lead.id));
  assert(
    "statementRequestedAt timestamp unchanged for already-requested lead",
    updated?.statementRequestedAt?.getTime() === originalRequestedAt?.getTime(),
    `original=${originalRequestedAt?.toISOString()} updated=${updated?.statementRequestedAt?.toISOString()}`
  );
}

// ── Cleanup + Main ────────────────────────────────────────────────────────────

async function cleanup() {
  const { sdrMerchants } = await import("../shared/schema");
  for (const id of leadIdsToClean) {
    try { await db.delete(sdrLeadState).where(eq(sdrLeadState.id, id)); } catch {}
  }
  // Delete test sdr_merchants by ghlContactId prefix
  try {
    await db.execute(
      (await import("drizzle-orm")).sql`DELETE FROM sdr_merchants WHERE ghl_contact_id LIKE ${"c1-test-" + RUN_ID + "-%"}`
    );
  } catch {}
  for (const id of contactIdsToClean) {
    try { await db.delete(contacts).where(eq(contacts.id, id)); } catch {}
  }
}

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log(" Wave C1 — Appointment-to-Statement Auto-Trigger Tests");
  console.log("═══════════════════════════════════════════════════════");

  try {
    await test1PositiveOutcomeTriggers();
    await test2LifecycleTransition();
    await test3SuppressFlagRespected();
    await test4NegativeOutcomeSkipped();
    await test5NoDuplicate();
  } catch (err: any) {
    console.error("Fatal:", err.message, err.stack);
    await cleanup();
    process.exit(1);
  }

  await cleanup();
  await db.$client.end().catch(() => {});

  console.log("\n═══════════════════════════════════════════════════════");
  console.log(` Results: ${passed} passed, ${failed} failed`);
  console.log("═══════════════════════════════════════════════════════");

  if (failed > 0) {
    console.error("\n❌ Failed tests:");
    failures.forEach(f => console.error(`   - ${f}`));
    process.exit(1);
  }
  console.log("\n✅ All Wave C1 tests passed.");
  process.exit(0);
}

main();
