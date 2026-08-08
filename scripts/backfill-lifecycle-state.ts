/**
 * Backfill lifecycle_state for existing contacts.
 *
 * Processes contacts in batches of 500.
 * For each contact, joins deals + merchant_profiles + sdr_lead_state + merchant_applications
 * and computes the most advanced lifecycle state.
 *
 * SAFE: Only moves contacts FORWARD — never backwards.
 * Skips contacts already past PROSPECT.
 *
 * Usage:
 *   npx tsx scripts/backfill-lifecycle-state.ts --dry-run
 *   npx tsx scripts/backfill-lifecycle-state.ts
 */

import "../server/env"; // load environment variables
import { db } from "../server/db";
import { contacts, contactLifecycleHistory, deals, merchantProfiles, merchantApplications, sdrLeadState } from "../shared/schema";
import { eq, isNull, and, lt } from "drizzle-orm";
import {
  LIFECYCLE_STATES,
  type LifecycleState,
  dealStageToLifecycleState,
  applicationStatusToLifecycleState,
  accountStatusToLifecycleState,
} from "../server/services/lifecycle-service";

const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = 500;

const STATE_ORDER: Record<LifecycleState, number> = Object.fromEntries(
  LIFECYCLE_STATES.map((s, i) => [s, i]),
) as Record<LifecycleState, number>;

function mostAdvanced(states: Array<LifecycleState | null>): LifecycleState {
  let best: LifecycleState = "PROSPECT";
  for (const s of states) {
    if (!s) continue;
    if (STATE_ORDER[s] > STATE_ORDER[best]) {
      best = s;
    }
  }
  return best;
}

async function computeLifecycleState(contactId: number): Promise<LifecycleState> {
  const candidates: Array<LifecycleState | null> = [];

  // From deals
  const contactDeals = await db
    .select({ stage: deals.stage, pipeline: deals.pipeline })
    .from(deals)
    .where(and(eq(deals.contactId, contactId), isNull(deals.archivedAt)));

  for (const d of contactDeals) {
    candidates.push(dealStageToLifecycleState(d.stage, d.pipeline));
  }

  // From merchant_profiles
  const profiles = await db
    .select({ accountStatus: merchantProfiles.accountStatus })
    .from(merchantProfiles)
    .where(eq(merchantProfiles.contactId, contactId));

  for (const p of profiles) {
    if (p.accountStatus) {
      candidates.push(accountStatusToLifecycleState(p.accountStatus));
    }
  }

  // From merchant_applications
  const apps = await db
    .select({ status: merchantApplications.status })
    .from(merchantApplications)
    .where(eq(merchantApplications.contactId, contactId));

  for (const a of apps) {
    if (a.status) {
      candidates.push(applicationStatusToLifecycleState(a.status));
    }
  }

  // From sdr_lead_state
  const sdrRows = await db
    .select({ stage: sdrLeadState.stage })
    .from(sdrLeadState)
    .where(eq(sdrLeadState.contactId, contactId));

  for (const s of sdrRows) {
    if (s.stage && s.stage !== "DISCOVERED") {
      candidates.push("ENGAGED");
    }
  }

  return mostAdvanced(candidates);
}

async function run() {
  console.log(`[Backfill] Starting lifecycle state backfill (dry-run: ${DRY_RUN})`);

  let offset = 0;
  let totalProcessed = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  while (true) {
    const batch = await db
      .select({ id: contacts.id, lifecycleState: contacts.lifecycleState })
      .from(contacts)
      .where(isNull(contacts.archivedAt))
      .limit(BATCH_SIZE)
      .offset(offset);

    if (batch.length === 0) break;

    for (const contact of batch) {
      totalProcessed++;

      try {
        const currentState = (contact.lifecycleState ?? "PROSPECT") as LifecycleState;

        // If already past PROSPECT, compute and only advance — never downgrade
        const computed = await computeLifecycleState(contact.id);

        // Only update if computed is more advanced than current
        if (STATE_ORDER[computed] <= STATE_ORDER[currentState]) {
          totalSkipped++;
          continue;
        }

        if (!DRY_RUN) {
          await db.transaction(async (tx) => {
            await tx
              .update(contacts)
              .set({
                lifecycleState: computed,
                lifecycleStateUpdatedAt: new Date(),
              })
              .where(eq(contacts.id, contact.id));

            await tx.insert(contactLifecycleHistory).values({
              contactId: contact.id,
              fromState: currentState,
              toState: computed,
              transitionedAt: new Date(),
              trigger: "backfill",
              actorType: "system",
              source: "backfill-lifecycle-state",
              reason: "Initial backfill from domain state",
            });
          });
          totalUpdated++;
        } else {
          console.log(`[Backfill] DRY-RUN: contact #${contact.id} ${currentState} → ${computed}`);
          totalUpdated++;
        }
      } catch (err: any) {
        console.error(`[Backfill] Error processing contact #${contact.id}:`, err.message);
        totalErrors++;
      }
    }

    offset += batch.length;

    if (totalProcessed % 1000 === 0 || batch.length < BATCH_SIZE) {
      console.log(
        `[Backfill] Progress: ${totalProcessed} processed, ${totalUpdated} updated, ${totalSkipped} skipped, ${totalErrors} errors`,
      );
    }

    if (batch.length < BATCH_SIZE) break;
  }

  console.log(
    `[Backfill] Complete: ${totalProcessed} processed, ${totalUpdated} updated, ${totalSkipped} skipped, ${totalErrors} errors`,
  );

  process.exit(0);
}

run().catch((err) => {
  console.error("[Backfill] Fatal error:", err);
  process.exit(1);
});
