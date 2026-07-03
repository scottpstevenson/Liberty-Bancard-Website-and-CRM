/**
 * Re-tag already-enrolled SDR leads whose inbox tag still reflects the coarse
 * vertical bucket (e.g. "LB-SDR-SALON") instead of the specific canonical
 * vertical resolved by getCanonicalLeadVertical() (e.g. "LB-MEDSPA" for
 * "Med Spa"). This is a one-time correction for leads that were tagged
 * before the fix that made new tagging use the canonical vertical.
 *
 * Scope: only sdr_lead_state rows in an active outreach stage (skips
 * DEAD, CONVERTED, TERMINAL_SHIPPED, CLOSED_WON, BOARDED, NURTURE — same
 * "active" definition used elsewhere, e.g. funnel-metrics stuck-lead query).
 *
 * Safe to re-run: a lead is only touched if the currently-tagged vertical
 * bucket differs from the freshly-resolved canonical one.
 *
 * Usage:
 *   npx tsx scripts/backfill-vertical-tags.ts                # dry-run (no writes)
 *   npx tsx scripts/backfill-vertical-tags.ts --dry-run       # explicit dry-run
 *   npx tsx scripts/backfill-vertical-tags.ts --execute       # apply corrections in GHL
 */

import { db } from "../server/db";
import { sdrLeadState, sdrMerchants, contacts } from "../shared/schema";
import { eq, notInArray } from "drizzle-orm";
import { getCanonicalLeadVertical } from "../server/services/sdr/vertical-resolver";
import { getVerticalTag } from "../server/services/ghl-workflow-enrollment";
import { addTag, removeTag } from "../server/services/sdr/ghl-client";

const args = process.argv.slice(2);
const isDryRun = !args.includes("--execute");

const BATCH_SIZE = 25;
const BATCH_DELAY_MS = 150;

// Terminal / dormant stages excluded from this backfill — matches the
// "active" definition already used for stuck-lead alerting in funnel-metrics.ts.
const TERMINAL_STAGES = ["DEAD", "CONVERTED", "TERMINAL_SHIPPED", "CLOSED_WON", "BOARDED", "NURTURE"];

// All possible outputs of getVerticalTag() — used to detect and strip a
// stale vertical tag before applying the corrected one.
const KNOWN_VERTICAL_TAGS = [
  "LB-AUTO",
  "LB-MEDSPA",
  "LB-DENTAL",
  "LB-MEDICAL",
  "LB-RESTAURANT",
  "LB-RETAIL",
  "LB-SDR-SALON",
  "LB-SDR-GYM",
  "LB-SDR-HOTEL",
  "LB-SDR-LANDSCAPING",
  "LB-SDR-CONSTRUCTION",
  "LB-SDR-LEGAL",
  "LB-VERTICAL-GENERAL",
];

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

type Outcome = "already_correct" | "retagged" | "skipped_no_ghl_id" | "skipped_no_tags_field" | "error";

const counts: Record<Outcome, number> = {
  already_correct: 0,
  retagged: 0,
  skipped_no_ghl_id: 0,
  skipped_no_tags_field: 0,
  error: 0,
};

async function main() {
  console.log("=== SDR Inbox Vertical Tag Backfill ===");
  console.log(`Mode: ${isDryRun ? "DRY-RUN (no writes)" : "EXECUTE"}`);
  console.log("");

  const rows = await db
    .select({
      leadId: sdrLeadState.id,
      leadVertical: sdrLeadState.vertical,
      leadGhlContactId: sdrLeadState.ghlContactId,
      contactId: sdrLeadState.contactId,
      merchantVertical: sdrMerchants.vertical,
      merchantSubvertical: sdrMerchants.subvertical,
      contactGhlContactId: contacts.ghlContactId,
      contactTags: contacts.tags,
      contactDoNotContact: contacts.doNotContact,
    })
    .from(sdrLeadState)
    .leftJoin(sdrMerchants, eq(sdrLeadState.merchantId, sdrMerchants.id))
    .leftJoin(contacts, eq(sdrLeadState.contactId, contacts.id))
    .where(notInArray(sdrLeadState.stage, TERMINAL_STAGES));

  console.log(`Found ${rows.length} active-stage leads to evaluate`);
  console.log("");

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    for (const row of batch) {
      try {
        if (row.contactDoNotContact) {
          continue;
        }

        const ghlContactId = row.contactGhlContactId || row.leadGhlContactId;
        if (!ghlContactId) {
          counts.skipped_no_ghl_id++;
          continue;
        }

        const canonicalVertical = getCanonicalLeadVertical({
          subvertical: row.merchantSubvertical,
          vertical: row.merchantVertical ?? row.leadVertical,
        });
        const correctTag = getVerticalTag(canonicalVertical);

        const currentTags = row.contactTags || [];
        if (currentTags.includes(correctTag)) {
          counts.already_correct++;
          continue;
        }

        const staleTags = KNOWN_VERTICAL_TAGS.filter(t => t !== correctTag && currentTags.includes(t));

        if (isDryRun) {
          console.log(
            `[DRY] lead #${row.leadId} (contact ${row.contactId}): canonical="${canonicalVertical}" → +${correctTag}` +
              (staleTags.length ? ` -${staleTags.join(",")}` : " (no prior vertical tag)")
          );
          counts.retagged++;
          continue;
        }

        if (staleTags.length > 0) {
          await removeTag({ contactId: ghlContactId, tags: staleTags });
        }
        await addTag({ contactId: ghlContactId, tags: [correctTag] });

        console.log(
          `[EXEC] lead #${row.leadId} (contact ${row.contactId}): canonical="${canonicalVertical}" → +${correctTag}` +
            (staleTags.length ? ` -${staleTags.join(",")}` : "")
        );
        counts.retagged++;
      } catch (err: any) {
        counts.error++;
        console.error(`[ERROR] lead #${row.leadId}: ${err.message}`);
      }
    }
    if (i + BATCH_SIZE < rows.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  console.log("");
  console.log("=== Summary ===");
  console.log(`already_correct:   ${counts.already_correct}`);
  console.log(`retagged:          ${counts.retagged}`);
  console.log(`skipped_no_ghl_id: ${counts.skipped_no_ghl_id}`);
  console.log(`error:             ${counts.error}`);
  console.log(`mode:              ${isDryRun ? "DRY-RUN — no writes made" : "EXECUTE — writes applied"}`);

  process.exit(counts.error > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
