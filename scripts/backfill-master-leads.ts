/**
 * CLI script — backfill existing contacts into master_leads.
 *
 * Usage:
 *   npx tsx scripts/backfill-master-leads.ts
 *
 * Idempotent: contacts already present by email are skipped.
 * No enrollment, no outbound — rows land in master_leads with status=imported.
 */
import { runMasterLeadBackfill } from "../server/services/master-lead-backfill";

console.log("[backfill-master-leads] Starting…");
runMasterLeadBackfill()
  .then(({ total, inserted, skipped }) => {
    console.log(`[backfill-master-leads] Done. Total: ${total}, Inserted: ${inserted}, Skipped: ${skipped}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("[backfill-master-leads] Error:", err);
    process.exit(1);
  });
