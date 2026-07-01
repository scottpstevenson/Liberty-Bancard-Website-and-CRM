/**
 * Backfill canonical business IDs onto sdr_merchants rows.
 *
 * Usage:
 *   npx tsx scripts/backfill-sdr-business-ids.ts                  # dry-run (no writes)
 *   npx tsx scripts/backfill-sdr-business-ids.ts --dry-run         # explicit dry-run
 *   npx tsx scripts/backfill-sdr-business-ids.ts --execute         # link existing businesses only (no creates)
 *   npx tsx scripts/backfill-sdr-business-ids.ts --execute --create-missing-domain-businesses
 *                                                                   # also create new canonical rows for domain-based merchants
 *
 * Outcome categories per merchant:
 *   domain_match              — domain found an existing canonical business row
 *   name_city_match           — exact normalizedName+city+state found an existing row (no domain)
 *   safe_domain_create        — domain present but no match; new row would be / was created (requires --create-missing-domain-businesses)
 *   skipped_no_domain_no_match — no domain and no exact name+city+state match found
 *   ambiguous                 — multiple name+city+state matches (cannot safely link without domain)
 *   error                     — unexpected exception
 */

import { storage } from "../server/storage";
import { db } from "../server/db";
import { sdrMerchants } from "../shared/schema";
import { isNull } from "drizzle-orm";

const args = process.argv.slice(2);
const isDryRun = !args.includes("--execute");
const allowCreate = args.includes("--create-missing-domain-businesses");

const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 100;

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

type Outcome = "domain_match" | "name_city_match" | "safe_domain_create" | "skipped_no_domain_no_match" | "ambiguous" | "error";

const counts: Record<Outcome, number> = {
  domain_match: 0,
  name_city_match: 0,
  safe_domain_create: 0,
  skipped_no_domain_no_match: 0,
  ambiguous: 0,
  error: 0,
};

async function classifyMerchant(merchant: typeof sdrMerchants.$inferSelect): Promise<{ outcome: Outcome; bizId?: number }> {
  const domain = merchant.domain || merchant.website || null;
  const city = merchant.city || null;
  const state = merchant.state || null;
  const normalizedName = merchant.businessName.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();

  if (domain) {
    const byDomain = await storage.getBusinessByDomain(domain);
    if (byDomain) {
      return { outcome: "domain_match", bizId: byDomain.id };
    }
    return { outcome: "safe_domain_create" };
  }

  // No domain — exact name+city+state lookup (read-only)
  const match1 = await storage.getBusinessByNormalizedNameCity(normalizedName, city, state);
  if (match1) {
    // Verify uniqueness: check if a second row would appear with different id by checking without state
    if (state) {
      const withoutState = await storage.getBusinessByNormalizedNameCity(normalizedName, city, null);
      if (withoutState && withoutState.id !== match1.id) {
        return { outcome: "ambiguous" };
      }
    }
    return { outcome: "name_city_match", bizId: match1.id };
  }

  return { outcome: "skipped_no_domain_no_match" };
}

async function main() {
  console.log("=== SDR Business ID Backfill ===");
  console.log(`Mode: ${isDryRun ? "DRY-RUN (no writes)" : "EXECUTE"}`);
  console.log(`Allow domain-based creates: ${allowCreate}`);
  console.log("");

  const merchants = await db.select().from(sdrMerchants).where(isNull(sdrMerchants.businessId));
  console.log(`Found ${merchants.length} sdr_merchants with businessId = null`);
  console.log("");

  for (let i = 0; i < merchants.length; i += BATCH_SIZE) {
    const batch = merchants.slice(i, i + BATCH_SIZE);
    for (const merchant of batch) {
      try {
        const { outcome, bizId } = await classifyMerchant(merchant);
        counts[outcome]++;

        if (isDryRun) {
          console.log(`[DRY] merchant #${merchant.id} "${merchant.businessName}": ${outcome}${bizId != null ? ` → business #${bizId}` : ""}${outcome === "safe_domain_create" && !allowCreate ? " (skipped — use --create-missing-domain-businesses)" : ""}`);
          continue;
        }

        // Execute mode
        if (outcome === "domain_match" && bizId != null) {
          await storage.updateSdrMerchant(merchant.id, { businessId: bizId });
          console.log(`[EXEC] merchant #${merchant.id} "${merchant.businessName}": domain_match → business #${bizId}`);
        } else if (outcome === "name_city_match" && bizId != null) {
          await storage.updateSdrMerchant(merchant.id, { businessId: bizId });
          console.log(`[EXEC] merchant #${merchant.id} "${merchant.businessName}": name_city_match → business #${bizId}`);
        } else if (outcome === "safe_domain_create" && allowCreate) {
          const domain = merchant.domain || merchant.website || null;
          const resolved = await storage.findOrCreateBusinessForMerchant(
            domain,
            merchant.businessName,
            merchant.city || null,
            merchant.state || null,
          );
          if (resolved) {
            await storage.updateSdrMerchant(merchant.id, { businessId: resolved.id });
            console.log(`[EXEC] merchant #${merchant.id} "${merchant.businessName}": safe_domain_create → business #${resolved.id}`);
          } else {
            console.log(`[EXEC] merchant #${merchant.id} "${merchant.businessName}": safe_domain_create → no row returned (unexpected)`);
          }
        } else {
          console.log(`[EXEC] merchant #${merchant.id} "${merchant.businessName}": ${outcome} (skipped)`);
        }
      } catch (err: any) {
        counts.error++;
        console.error(`[ERROR] merchant #${merchant.id} "${merchant.businessName}": ${err.message}`);
      }
    }
    if (i + BATCH_SIZE < merchants.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  console.log("");
  console.log("=== Summary ===");
  console.log(`domain_match:              ${counts.domain_match}`);
  console.log(`name_city_match:           ${counts.name_city_match}`);
  console.log(`safe_domain_create:        ${counts.safe_domain_create}`);
  console.log(`skipped_no_domain_no_match:${counts.skipped_no_domain_no_match}`);
  console.log(`ambiguous:                 ${counts.ambiguous}`);
  console.log(`error:                     ${counts.error}`);
  console.log(`mode:                      ${isDryRun ? "DRY-RUN — no writes made" : "EXECUTE — writes applied"}`);

  process.exit(counts.error > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
