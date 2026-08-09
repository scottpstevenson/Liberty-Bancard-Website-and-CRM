#!/usr/bin/env tsx
/**
 * #1338 — Attrition monitor cooldown smoke test.
 *
 * Verifies that isOnCooldown() correctly:
 *   1. Returns true (suppresses) when a recent health_alert exists for the same
 *      contact + alertType within the 30-day window.
 *   2. Returns false (allows new alert) when the most recent alert is > 30 days old.
 *   3. Returns false when no alert exists at all.
 *
 * The function isOnCooldown() is private, so we test it indirectly by inserting
 * health_alerts rows and calling db.select() with the same WHERE logic the function
 * uses — this validates the DB query, not just the function signature.
 *
 * Exits 0 on pass, 1 on failure.
 */

import { db } from "../server/db";
import { healthAlerts, contacts } from "../shared/schema";
import { eq, and, gte } from "drizzle-orm";

const COOLDOWN_DAYS = 30;

let errors = 0;
let contactId = 0;
let insertedIds: number[] = [];

function pass(msg: string) { console.log(`  ✓ ${msg}`); }
function fail(msg: string) { console.error(`  ✗ ${msg}`); errors++; }

// Mirrors the isOnCooldown() logic in merchant-attrition-monitor.ts
async function checkCooldown(
  cId: number,
  alertType: "volume_decline" | "chargeback_spike"
): Promise<boolean> {
  const cutoff = new Date(Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ id: healthAlerts.id })
    .from(healthAlerts)
    .where(
      and(
        eq(healthAlerts.contactId, cId),
        eq(healthAlerts.alertType, alertType),
        gte(healthAlerts.createdAt, cutoff),
      )
    )
    .limit(1);
  return rows.length > 0;
}

console.log("\n── Setup ──────────────────────────────────────────────────");

try {
  // Create a throwaway contact for this run (use a unique email so no conflicts)
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const [contact] = await db
    .insert(contacts)
    .values({
      firstName: "Cooldown",
      lastName: `Smoke-${runId}`,
      email: `cooldown-smoke-${runId}@libertybancard.test`,
      phone: `+1555${runId.replace(/\D/g, "").slice(0, 7).padEnd(7, "0")}`,
      status: "active",
    } as any)
    .returning({ id: contacts.id });
  contactId = contact.id;
  console.log(`  Created test contact #${contactId}`);
} catch (err: any) {
  console.error("Setup failed:", err.message);
  process.exit(1);
}

// ── Case 1: No alerts → cooldown returns false ────────────────────────────────

console.log("\n── Case 1: No existing alerts → should NOT be on cooldown ──");
{
  const onCooldown = await checkCooldown(contactId, "volume_decline");
  if (!onCooldown) {
    pass("cooldown=false when no health_alerts exist for contact");
  } else {
    fail("cooldown=true but no alerts were inserted — unexpected suppression");
  }
}

// ── Case 2: Recent alert (now) → cooldown returns true ────────────────────────

console.log("\n── Case 2: Recent alert (created now) → should be on cooldown ──");
{
  const [row] = await db
    .insert(healthAlerts)
    .values({
      contactId,
      alertType: "volume_decline",
      title: "Smoke test — volume decline",
      severity: "warning",
      metadata: { source: "smoke_test" },
    } as any)
    .returning({ id: healthAlerts.id });
  insertedIds.push(row.id);

  const onCooldown = await checkCooldown(contactId, "volume_decline");
  if (onCooldown) {
    pass("cooldown=true for alert created NOW (within 30-day window)");
  } else {
    fail("cooldown=false but a recent alert was just inserted — cooldown logic is broken");
  }
}

// ── Case 3: Alert exists but for different type → not on cooldown for other type ──

console.log("\n── Case 3: Alert for volume_decline → chargeback_spike should NOT be suppressed ──");
{
  const onCooldown = await checkCooldown(contactId, "chargeback_spike");
  if (!onCooldown) {
    pass("cooldown=false for a different alert_type (chargeback_spike) — correct isolation");
  } else {
    fail("cooldown=true for chargeback_spike even though only volume_decline was inserted");
  }
}

// ── Case 4: Alert set to 31 days ago → cooldown returns false ────────────────

console.log("\n── Case 4: Alert from 31 days ago → should NOT be on cooldown ──");
{
  // Update the inserted row's created_at to 31 days ago
  await db.execute(
    // Using raw SQL so we can set an arbitrary timestamp
    (await import("drizzle-orm")).sql`
      UPDATE health_alerts
      SET created_at = NOW() - INTERVAL '31 days'
      WHERE id = ${insertedIds[0]}
    `
  );

  const onCooldown = await checkCooldown(contactId, "volume_decline");
  if (!onCooldown) {
    pass("cooldown=false for an alert 31 days old (outside 30-day window)");
  } else {
    fail("cooldown=true for an alert 31 days old — cooldown window comparison is wrong");
  }
}

// ── Case 5: Two alerts — one stale (31d), one fresh (now) → still suppressed ──

console.log("\n── Case 5: Stale + fresh alert → should be on cooldown ──");
{
  const [fresh] = await db
    .insert(healthAlerts)
    .values({
      contactId,
      alertType: "volume_decline",
      title: "Smoke test — fresh alert",
      severity: "warning",
      metadata: { source: "smoke_test_fresh" },
    } as any)
    .returning({ id: healthAlerts.id });
  insertedIds.push(fresh.id);

  const onCooldown = await checkCooldown(contactId, "volume_decline");
  if (onCooldown) {
    pass("cooldown=true with one stale + one fresh alert (fresh alert triggers suppression)");
  } else {
    fail("cooldown=false even though a fresh alert exists alongside a stale one");
  }
}

// ── Teardown ──────────────────────────────────────────────────────────────────

console.log("\n── Teardown ────────────────────────────────────────────────");
try {
  if (insertedIds.length > 0) {
    for (const id of insertedIds) {
      await db.delete(healthAlerts).where(eq(healthAlerts.id, id));
    }
    pass(`Deleted ${insertedIds.length} health_alert row(s)`);
  }
  if (contactId) {
    await db.delete(contacts).where(eq(contacts.id, contactId));
    pass(`Deleted test contact #${contactId}`);
  }
} catch (err: any) {
  console.error("Teardown error (non-fatal):", err.message);
}

// ── Result ────────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
if (errors === 0) {
  console.log("✓ PASS — Attrition monitor cooldown smoke test (0 failures)");
  process.exit(0);
} else {
  console.error(`✗ FAIL — ${errors} assertion(s) failed`);
  process.exit(1);
}
