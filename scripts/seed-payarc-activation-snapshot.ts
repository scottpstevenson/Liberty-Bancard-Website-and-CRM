/**
 * scripts/seed-payarc-activation-snapshot.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Idempotent provisioning of the Payarc sandbox activation snapshot.
 *
 * This script creates the owner-confirmed activation snapshot that unlocks the
 * Payarc transport gate for sandbox use. It is safe to run multiple times:
 *   • If a qualifying snapshot (owner_confirmed or higher) already exists for
 *     the "traditional" program it prints the existing record and exits 0.
 *   • Otherwise it inserts a new owner_confirmed snapshot and exits 0.
 *
 * Owner-confirmed facts:
 *   - processorProgram    : "traditional"   (Payfac NOT activated)
 *   - sandboxEntitlement  : true
 *   - productionEntitlement: false
 *   - authorizedBaseUrl   : https://testapi.payarc.net/v1
 *   - supportedOperations : ["board_merchant", "get_merchant_status"]
 *
 * Run:
 *   npx tsx scripts/seed-payarc-activation-snapshot.ts
 */

import { db } from "../server/db";
import { processorActivationSnapshots } from "../shared/schema";
import { and, eq, inArray, desc } from "drizzle-orm";

const SANDBOX_BASE_URL = (
  process.env.PAYARC_API_BASE_URL ?? "https://testapi.payarc.net/v1"
).replace(/\/$/, "");

const QUALIFYING_STATUSES = ["owner_confirmed", "sandbox_verified", "production_authorized"];

async function run(): Promise<void> {
  console.log("Payarc Activation Snapshot — idempotent seed");
  console.log(`  Sandbox URL : ${SANDBOX_BASE_URL}`);

  // Check for existing qualifying snapshot for the traditional program
  const [existing] = await db
    .select()
    .from(processorActivationSnapshots)
    .where(
      and(
        eq(processorActivationSnapshots.processorName, "payarc"),
        eq(processorActivationSnapshots.processorProgram, "traditional"),
        inArray(processorActivationSnapshots.status, QUALIFYING_STATUSES),
      ),
    )
    .orderBy(desc(processorActivationSnapshots.createdAt))
    .limit(1);

  if (existing) {
    console.log(`\n✅ Existing qualifying snapshot found — no action needed`);
    console.log(`   id      : ${existing.id}`);
    console.log(`   status  : ${existing.status}`);
    console.log(`   program : ${existing.processorProgram}`);
    console.log(`   url     : ${existing.authorizedBaseUrl}`);
    console.log(`   created : ${existing.createdAt}`);
    process.exit(0);
  }

  // No qualifying snapshot — create one
  console.log("\n📋 No qualifying snapshot found — inserting owner_confirmed snapshot...");

  const [row] = await db
    .insert(processorActivationSnapshots)
    .values({
      processorName: "payarc",
      processorProgram: "traditional",
      sandboxEntitlement: true,
      productionEntitlement: false,
      authorizedBaseUrl: SANDBOX_BASE_URL,
      supportedOperations: ["board_merchant", "get_merchant_status"],
      ownerConfirmedAt: new Date(),
      ownerConfirmedBy: "seed-payarc-activation-snapshot",
      status: "owner_confirmed",
      notes:
        "Task #1761 sandbox lifecycle — traditional program only; " +
        "Payfac path NOT activated; sandbox entitlement only.",
    } as typeof processorActivationSnapshots.$inferInsert)
    .returning({
      id: processorActivationSnapshots.id,
      status: processorActivationSnapshots.status,
      createdAt: processorActivationSnapshots.createdAt,
    });

  console.log(`\n✅ Snapshot created`);
  console.log(`   id      : ${row.id}`);
  console.log(`   status  : ${row.status}`);
  console.log(`   program : traditional`);
  console.log(`   url     : ${SANDBOX_BASE_URL}`);
  console.log(`   created : ${row.createdAt}`);

  process.exit(0);
}

run().catch(err => {
  console.error("Fatal:", err.message ?? err);
  process.exit(1);
});
