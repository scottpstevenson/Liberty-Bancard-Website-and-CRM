/**
 * Test script for LifecycleService.
 *
 * Tests all 8 specified cases using the dev DB.
 * Creates test contacts and cleans up after itself.
 *
 * Usage:
 *   npx tsx scripts/test-lifecycle.ts
 */

import "../server/env";
import { db } from "../server/db";
import { contacts, contactLifecycleHistory } from "../shared/schema";
import { eq, and } from "drizzle-orm";
import { LifecycleService, LifecycleTransitionError } from "../server/services/lifecycle-service";

const TEST_EMAIL_PREFIX = `lifecycle-test-${Date.now()}`;
let createdContactIds: number[] = [];

async function createTestContact(suffix: string): Promise<number> {
  const [row] = await db
    .insert(contacts)
    .values({
      firstName: "Test",
      lastName: `Lifecycle${suffix}`,
      email: `${TEST_EMAIL_PREFIX}-${suffix}@example-test.invalid`,
      phone: "0000000000",
    })
    .returning({ id: contacts.id });

  createdContactIds.push(row.id);
  return row.id;
}

async function cleanup() {
  for (const id of createdContactIds) {
    await db.delete(contactLifecycleHistory).where(eq(contactLifecycleHistory.contactId, id));
    await db.delete(contacts).where(eq(contacts.id, id));
  }
  console.log(`[Test] Cleaned up ${createdContactIds.length} test contacts`);
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? `: ${detail}` : ""}`);
    failed++;
  }
}

async function runTests() {
  console.log("[Test] Starting lifecycle service tests...\n");

  // ── Test 1: PROSPECT → ENGAGED (allowed) ──────────────────────────────────
  console.log("Test 1: PROSPECT → ENGAGED (allowed)");
  {
    const id = await createTestContact("1");
    const result = await LifecycleService.transition(id, "ENGAGED", {
      trigger: "test",
      source: "test-lifecycle",
    });
    assert(result === "ENGAGED", "transition returned ENGAGED");
    const state = await LifecycleService.getCurrentState(id);
    assert(state === "ENGAGED", "getCurrentState returns ENGAGED");
  }

  // ── Test 2: PROSPECT → PROPOSAL_SENT (skip-ahead allowed) ─────────────────
  console.log("\nTest 2: PROSPECT → PROPOSAL_SENT (skip-ahead allowed)");
  {
    const id = await createTestContact("2");
    const result = await LifecycleService.transition(id, "PROPOSAL_SENT", {
      trigger: "test",
      source: "test-lifecycle",
    });
    assert(result === "PROPOSAL_SENT", "skip-ahead transition allowed");
  }

  // ── Test 3: ACTIVE_PROCESSING → PROSPECT (backwards, prohibited) ──────────
  console.log("\nTest 3: ACTIVE_PROCESSING → PROSPECT (backwards, prohibited)");
  {
    const id = await createTestContact("3");
    // First advance to ACTIVE_PROCESSING
    await LifecycleService.transition(id, "ACTIVE_PROCESSING", {
      trigger: "test",
      source: "test-lifecycle",
    });
    let threw = false;
    try {
      await LifecycleService.transition(id, "PROSPECT", {
        trigger: "test",
        source: "test-lifecycle",
      });
    } catch (err) {
      threw = err instanceof LifecycleTransitionError;
    }
    assert(threw, "backwards transition throws LifecycleTransitionError");
  }

  // ── Test 4: Any state → CLOSED_LOST (always allowed) ─────────────────────
  console.log("\nTest 4: Any state → CLOSED_LOST (always allowed)");
  {
    const id = await createTestContact("4");
    await LifecycleService.transition(id, "ACTIVE_PROCESSING", {
      trigger: "test",
      source: "test-lifecycle",
    });
    const result = await LifecycleService.transition(id, "CLOSED_LOST", {
      trigger: "test",
      source: "test-lifecycle",
    });
    assert(result === "CLOSED_LOST", "ACTIVE_PROCESSING → CLOSED_LOST allowed");
  }

  // ── Test 5: CHURNED → WINBACK (allowed recovery path) ────────────────────
  console.log("\nTest 5: CHURNED → WINBACK (allowed)");
  {
    const id = await createTestContact("5");
    await LifecycleService.transition(id, "CHURNED", {
      trigger: "test",
      source: "test-lifecycle",
    });
    const result = await LifecycleService.transition(id, "WINBACK", {
      trigger: "test",
      source: "test-lifecycle",
    });
    assert(result === "WINBACK", "CHURNED → WINBACK allowed");
  }

  // ── Test 6: Same state → same state (idempotent, no new history row) ──────
  console.log("\nTest 6: Same state → same state (idempotent)");
  {
    const id = await createTestContact("6");
    await LifecycleService.transition(id, "ENGAGED", {
      trigger: "test",
      source: "test-lifecycle",
    });
    // Count history rows before
    const beforeHistory = await LifecycleService.getHistory(id);
    const beforeCount = beforeHistory.length;
    // Transition to same state
    const result = await LifecycleService.transition(id, "ENGAGED", {
      trigger: "test-idempotent",
      source: "test-lifecycle",
    });
    const afterHistory = await LifecycleService.getHistory(id);
    const afterCount = afterHistory.length;
    assert(result === "ENGAGED", "idempotent transition returns current state");
    assert(afterCount === beforeCount, "no new history row on idempotent transition");
  }

  // ── Test 7: transition() writes a history row ─────────────────────────────
  console.log("\nTest 7: transition() writes a history row");
  {
    const id = await createTestContact("7");
    await LifecycleService.transition(id, "ENGAGED", {
      trigger: "test_trigger_7",
      source: "test-lifecycle",
      actorType: "user",
      actorId: "test-user-123",
    });
    const history = await LifecycleService.getHistory(id);
    assert(history.length >= 1, "history row written");
    const row = history[0];
    assert(row.toState === "ENGAGED", "history row has correct toState");
    assert(row.fromState === "PROSPECT", "history row has correct fromState");
    assert(row.trigger === "test_trigger_7", "history row has correct trigger");
    assert(row.actorId === "test-user-123", "history row has correct actorId");
  }

  // ── Test 8: getHistory() returns rows in desc order ───────────────────────
  console.log("\nTest 8: getHistory() returns rows in desc order");
  {
    const id = await createTestContact("8");
    await LifecycleService.transition(id, "ENGAGED", {
      trigger: "test_a",
      source: "test-lifecycle",
    });
    await LifecycleService.transition(id, "PROPOSAL_SENT", {
      trigger: "test_b",
      source: "test-lifecycle",
    });
    await LifecycleService.transition(id, "APPROVED", {
      trigger: "test_c",
      source: "test-lifecycle",
    });
    const history = await LifecycleService.getHistory(id);
    assert(history.length >= 3, "at least 3 history rows");
    const sorted = [...history].sort(
      (a, b) =>
        new Date(b.transitionedAt).getTime() - new Date(a.transitionedAt).getTime(),
    );
    assert(
      history[0].id === sorted[0].id,
      "rows returned in descending order",
    );
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n[Test] Results: ${passed} passed, ${failed} failed`);
  return failed === 0;
}

async function main() {
  try {
    const success = await runTests();
    await cleanup();
    process.exit(success ? 0 : 1);
  } catch (err) {
    console.error("[Test] Fatal error:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  }
}

main();
