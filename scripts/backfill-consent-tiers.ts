#!/usr/bin/env tsx
/**
 * Wave 1A — Conservative Consent Tier Backfill
 *
 * Backfills `consent_tier` for all contacts that still have the default
 * value 'cold_no_consent' (or null) by applying the 5-rule conservative
 * derivation from deriveConsentTier().
 *
 * Conservative assumptions (in priority order):
 *   1. doNotContact = true              → do_not_contact
 *   2. Global opt-out (smsStatus/emailStatus = opted_out) → opted_out
 *   3. Verified PEWC evidence in consent_audit_logs
 *      (express_written + consentedPhone + disclosureVersion) → pewc_full_automation
 *   4. Inbound / referral / partner source → warm_no_pewc
 *   5. Scraped / imported / unknown source → cold_no_consent (default; no update)
 *
 * Critical: emailOptInAt is NOT treated as PEWC for automated SMS, AI voice, or ringless voicemail.
 * PEWC evidence check applies to ALL contacts regardless of source category.
 *
 * This script is SAFE TO RUN MULTIPLE TIMES — it only updates contacts
 * whose consentTier is still 'cold_no_consent' (the DB default) and
 * does not overwrite contacts already explicitly set to warm_no_pewc,
 * pewc_full_automation, opted_out, or do_not_contact.
 *
 * Usage:
 *   npx tsx scripts/backfill-consent-tiers.ts
 *
 * Dry-run (print counts only, no writes):
 *   DRY_RUN=true npx tsx scripts/backfill-consent-tiers.ts
 *
 * Exits 0 on success, 1 on error.
 */

import { db } from "../server/db";
import { contacts, consentAuditLogs } from "../shared/schema";
import { eq, and, isNull, isNotNull, sql } from "drizzle-orm";
import { pool } from "../server/db";
import { deriveConsentTier } from "../server/services/contactability";

const DRY_RUN = process.env.DRY_RUN === "true";
const BATCH_SIZE = 200;

async function runBackfill() {
  console.log(`\n=== Wave 1A — Consent Tier Backfill ${DRY_RUN ? "(DRY RUN)" : ""} ===\n`);

  // ── Pre-fetch ALL contact IDs with verified PEWC evidence in a single query ──
  // This avoids N+1 DB queries; we check for express_written consent with
  // consentedPhone + disclosureVersion (the two required PEWC fields).
  console.log("Pre-fetching PEWC-evidenced contacts...");
  const pewcRows = await db
    .select({ contactId: consentAuditLogs.contactId })
    .from(consentAuditLogs)
    .where(
      and(
        eq(consentAuditLogs.consented, true),
        eq(consentAuditLogs.consentType, "express_written"),
        isNotNull(consentAuditLogs.consentedPhone),
        isNotNull(consentAuditLogs.disclosureVersion),
      )
    )
    .groupBy(consentAuditLogs.contactId);

  const pewcContactIds = new Set(pewcRows.map(r => r.contactId).filter((id): id is number => id !== null));
  console.log(`Found ${pewcContactIds.size} contacts with verified PEWC evidence.\n`);

  // ── Load contacts still at default cold_no_consent tier ──
  const allContacts = await db
    .select({
      id: contacts.id,
      doNotContact: contacts.doNotContact,
      smsStatus: contacts.smsStatus,
      emailStatus: contacts.emailStatus,
      consentTier: contacts.consentTier,
      leadSource: contacts.leadSource,
      sourceCategory: contacts.sourceCategory,
      consentSms: contacts.consentSms,
      emailOptInAt: contacts.emailOptInAt,
    })
    .from(contacts)
    .where(
      and(
        isNull(contacts.archivedAt),
        eq(contacts.consentTier, "cold_no_consent")
      )
    );

  console.log(`Found ${allContacts.length} contacts with default 'cold_no_consent' tier to evaluate.`);

  const updates: Record<string, { contactId: number; newTier: string }[]> = {
    do_not_contact: [],
    opted_out: [],
    pewc_full_automation: [],
    warm_no_pewc: [],
    cold_no_consent: [],
  };

  for (const contact of allContacts) {
    // Step 1+2: DNC / opted-out (never upgradeD to PEWC — DNC takes priority)
    const baseTier = deriveConsentTier(contact);
    if (baseTier === "do_not_contact" || baseTier === "opted_out") {
      updates[baseTier].push({ contactId: contact.id, newTier: baseTier });
      continue;
    }

    // Step 3: PEWC evidence check — applies to ALL non-DNC/opted-out contacts
    // regardless of source category. Evidence is authoritative.
    if (pewcContactIds.has(contact.id)) {
      updates["pewc_full_automation"].push({ contactId: contact.id, newTier: "pewc_full_automation" });
      continue;
    }

    // Step 4+5: source-category heuristics (warm vs cold)
    if (baseTier !== "cold_no_consent") {
      updates[baseTier]?.push({ contactId: contact.id, newTier: baseTier });
    } else {
      updates["cold_no_consent"].push({ contactId: contact.id, newTier: "cold_no_consent" });
    }
  }

  console.log("\nBackfill plan:");
  for (const [tier, rows] of Object.entries(updates)) {
    if (rows.length > 0) {
      console.log(`  ${tier}: ${rows.length} contacts`);
    }
  }

  if (DRY_RUN) {
    console.log("\n[DRY RUN] No database writes performed. Remove DRY_RUN=true to apply.\n");
    return;
  }

  let totalUpdated = 0;

  for (const [tier, rows] of Object.entries(updates)) {
    if (tier === "cold_no_consent" || rows.length === 0) continue;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const ids = batch.map(r => r.contactId);

      await db
        .update(contacts)
        .set({ consentTier: tier as string })
        .where(sql`id = ANY(${ids})`);

      totalUpdated += batch.length;
      console.log(`  Updated ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length} contacts → ${tier}`);
    }
  }

  console.log(`\n✅ Backfill complete. ${totalUpdated} contacts updated.\n`);
  console.log("Note: Contacts that remained 'cold_no_consent' were not modified (they are already at the conservative default).\n");
}

runBackfill()
  .catch(err => {
    console.error("Backfill error:", err);
    process.exit(1);
  })
  .finally(() => pool.end());
