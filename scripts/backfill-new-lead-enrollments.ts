#!/usr/bin/env tsx
/**
 * scripts/backfill-new-lead-enrollments.ts
 *
 * One-shot CLI script to bulk-enroll the backlogged "New Lead" contacts that
 * have never been enrolled in a sequence.  Designed to be run immediately after
 * the operator maps a `defaultNewLeadSequenceId` (or vertical-specific sequences)
 * via the Operator Dashboard → New Lead Enrollment tab.
 *
 * Safety guarantees (identical to the UI job):
 *  - DNC contacts are NEVER enrolled.
 *  - Opted-out contacts are NEVER enrolled.
 *  - Contacts already actively enrolled in any sequence are skipped.
 *  - Contacts without email are skipped for email-only sequences.
 *  - Contacts without PEWC consent are skipped for SMS/voice/ringless sequences.
 *  - Sequences with status !== "active" are never used.
 *  - Per-contact dedup — safe to run multiple times.
 *  - No deals created, no GHL sync triggered, no outbound sends fired directly.
 *
 * Usage:
 *   npx tsx scripts/backfill-new-lead-enrollments.ts             # live run
 *   npx tsx scripts/backfill-new-lead-enrollments.ts --dry-run   # preview only
 *   DRY_RUN=true npx tsx scripts/backfill-new-lead-enrollments.ts
 *
 * Exit codes:
 *   0 — completed (or dry-run finished) with no blocking errors
 *   1 — one or more contacts failed to enroll (see error output)
 *   2 — no default sequence configured (nothing to enroll into)
 */

import { db } from "../server/db";
import {
  deals,
  contacts,
  sequenceEnrollments,
  followUpSequences,
  sequenceSteps,
} from "../shared/schema";
import { and, eq, isNull, inArray } from "drizzle-orm";
import { storage } from "../server/storage";
import { canEnrollContactInSequence } from "../server/services/sequence-eligibility";
import { evaluateContactability } from "../server/services/contactability";

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN =
  args.includes("--dry-run") ||
  args.includes("--dryrun") ||
  process.env.DRY_RUN === "true";

if (DRY_RUN) {
  console.log("[backfill-new-lead-enrollments] DRY RUN — no enrollments will be created.\n");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SMS_VOICE_RINGLESS_TYPES = new Set(["sms", "call", "call_reminder", "voicemail_drop"]);
const UNKNOWN_VERTICAL_KEY = "__unknown__";

function resolveVertical(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = raw.trim();
  if (!t || t.toLowerCase() === "unknown" || t.toLowerCase() === "uncategorized") return null;
  return t;
}

async function requiresPewc(sequenceId: number): Promise<boolean> {
  const steps = await storage.getSequenceSteps(sequenceId);
  return steps.some((s) => SMS_VOICE_RINGLESS_TYPES.has(s.actionType ?? ""));
}

// ─── Counters ─────────────────────────────────────────────────────────────────

const counts = {
  total: 0,
  enrolled: 0,
  alreadyEnrolled: 0,
  dncBlocked: 0,
  optOutBlocked: 0,
  contactabilityBlocked: 0,
  pewcBlocked: 0,
  missingContactMethod: 0,
  eligibilityBlocked: 0,
  noSequenceBlocked: 0,
  inactiveSequenceBlocked: 0,
  noContactBlocked: 0,
  errors: 0,
};

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Load routing config
  const { getDefaultSequenceId, getVerticalSequenceMap } = await import(
    "../server/services/new-lead-enrollment-job"
  );
  const [defaultSeqId, verticalMap] = await Promise.all([
    getDefaultSequenceId(),
    getVerticalSequenceMap(),
  ]);

  if (defaultSeqId == null && Object.keys(verticalMap).length === 0) {
    console.error(
      "[backfill-new-lead-enrollments] ERROR: No defaultNewLeadSequenceId and no vertical " +
        "sequence map configured. Configure at least a default sequence via the Operator Dashboard " +
        "→ New Lead Enrollment tab before running this script."
    );
    process.exit(2);
  }

  console.log(
    `[backfill-new-lead-enrollments] Routing: defaultSeqId=${defaultSeqId ?? "none"} ` +
      `verticalMap keys=[${Object.keys(verticalMap).join(", ") || "none"}]`
  );

  // 2. Fetch all non-archived "New Lead" deals with their contacts
  const dealRows = await db
    .select({
      dealId: deals.id,
      dealVertical: deals.vertical,
      contactId: deals.contactId,
    })
    .from(deals)
    .where(
      and(
        eq(deals.pipeline, "sales"),
        eq(deals.stage, "New Lead"),
        isNull(deals.archivedAt)
      )
    );

  if (dealRows.length === 0) {
    console.log("[backfill-new-lead-enrollments] No New Lead deals found. Nothing to do.");
    process.exit(0);
  }

  // 3. Identify contacts that already have an active/completed enrollment — skip them
  const contactIds = dealRows.map((d) => d.contactId).filter(Boolean) as number[];
  let enrolledContactIds = new Set<number>();
  if (contactIds.length > 0) {
    const existingEnrollments = await db
      .select({ contactId: sequenceEnrollments.contactId, status: sequenceEnrollments.status })
      .from(sequenceEnrollments)
      .where(inArray(sequenceEnrollments.contactId, contactIds));
    const COVERED = new Set(["active", "paused", "completed"]);
    enrolledContactIds = new Set(
      existingEnrollments
        .filter((e) => COVERED.has(e.status ?? ""))
        .map((e) => Number(e.contactId))
    );
  }

  const unenrolledDeals = dealRows.filter(
    (d) => !d.contactId || !enrolledContactIds.has(d.contactId)
  );

  counts.total = unenrolledDeals.length;
  const totalDeals = dealRows.length;

  console.log(
    `[backfill-new-lead-enrollments] ${totalDeals} total New Lead deals; ` +
      `${totalDeals - unenrolledDeals.length} already enrolled; ` +
      `${unenrolledDeals.length} to process.\n`
  );

  if (unenrolledDeals.length === 0) {
    console.log("[backfill-new-lead-enrollments] All New Lead contacts are already enrolled. Done.");
    printSummary();
    process.exit(0);
  }

  // 4. Process each unenrolled deal
  for (const row of unenrolledDeals) {
    const { dealId, dealVertical, contactId } = row;

    if (!contactId) {
      counts.noContactBlocked++;
      if (DRY_RUN) console.log(`  [SKIP] deal=${dealId} — no contact linked`);
      continue;
    }

    try {
      const contact = await storage.getContact(contactId);
      if (!contact) {
        counts.noContactBlocked++;
        if (DRY_RUN) console.log(`  [SKIP] deal=${dealId} contactId=${contactId} — contact not found`);
        continue;
      }

      // DNC gate
      if (contact.doNotContact) {
        counts.dncBlocked++;
        if (DRY_RUN) console.log(`  [DNC ] deal=${dealId} contactId=${contactId}`);
        continue;
      }

      // Consent gate
      const tier = contact.consentTier ?? "cold_no_consent";
      if (tier === "opted_out" || tier === "do_not_contact") {
        counts.optOutBlocked++;
        if (DRY_RUN) console.log(`  [OPT ] deal=${dealId} contactId=${contactId} tier=${tier}`);
        continue;
      }

      // Resolve sequence (vertical map → unknown key → default)
      const v = resolveVertical(dealVertical);
      const seqId = (v && verticalMap[v]) || (!v && verticalMap[UNKNOWN_VERTICAL_KEY]) || defaultSeqId;
      if (!seqId) {
        counts.noSequenceBlocked++;
        if (DRY_RUN) console.log(`  [SEQ ] deal=${dealId} contactId=${contactId} — no sequence mapped for vertical="${dealVertical ?? "null"}"`);
        continue;
      }

      const sequence = await storage.getFollowUpSequence(seqId);
      if (!sequence) {
        counts.noSequenceBlocked++;
        if (DRY_RUN) console.log(`  [SEQ ] deal=${dealId} contactId=${contactId} — sequenceId=${seqId} not found`);
        continue;
      }
      if (sequence.status !== "active") {
        counts.inactiveSequenceBlocked++;
        if (DRY_RUN) console.log(`  [ISEQ] deal=${dealId} contactId=${contactId} — sequence "${sequence.name}" is ${sequence.status}`);
        continue;
      }

      // Channel + contact-method gate
      const needsPewc = await requiresPewc(seqId);
      if (needsPewc) {
        if (tier !== "pewc_full_automation") {
          counts.pewcBlocked++;
          if (DRY_RUN) console.log(`  [PEWC] deal=${dealId} contactId=${contactId} — tier=${tier}`);
          continue;
        }
        if (!contact.phone) {
          counts.missingContactMethod++;
          if (DRY_RUN) console.log(`  [NOPH] deal=${dealId} contactId=${contactId} — no phone for SMS/voice sequence`);
          continue;
        }
      } else {
        if (!contact.email) {
          counts.missingContactMethod++;
          if (DRY_RUN) console.log(`  [NOEM] deal=${dealId} contactId=${contactId} — no email for email sequence`);
          continue;
        }
      }

      // Eligibility gate
      const enrollCheck = await canEnrollContactInSequence(contactId, sequence);
      if (!enrollCheck.allowed) {
        counts.eligibilityBlocked++;
        if (DRY_RUN) console.log(`  [ELIG] deal=${dealId} contactId=${contactId} — ${enrollCheck.reason}`);
        continue;
      }

      // Contactability gate
      const contactResult = await evaluateContactability({
        contactId,
        channel: needsPewc ? "sms" : "email",
        mode: "dryRun",
      });
      if (!contactResult.allowed) {
        counts.contactabilityBlocked++;
        if (DRY_RUN) console.log(`  [CTCT] deal=${dealId} contactId=${contactId} — ${contactResult.reason}`);
        continue;
      }

      // Already enrolled (re-check inline — enrollment could have been created mid-loop)
      const existingCheck = await storage.getContactEnrollments(contactId);
      const alreadyIn = existingCheck.some((e) => e.status === "active" || e.status === "paused");
      if (alreadyIn) {
        counts.alreadyEnrolled++;
        if (DRY_RUN) console.log(`  [DUPL] deal=${dealId} contactId=${contactId} — already enrolled (concurrent)`);
        continue;
      }

      if (DRY_RUN) {
        counts.enrolled++;
        console.log(
          `  [WOUL] deal=${dealId} contactId=${contactId} — WOULD enroll into sequence "${sequence.name}" (${seqId})`
        );
        continue;
      }

      // Enroll
      await storage.createSequenceEnrollment({
        sequenceId: seqId,
        contactId,
        dealId,
        status: "active",
        currentStep: 0,
        nextActionAt: new Date(),
        metadata: {
          enrolledBy: "backfill-new-lead-enrollments-script",
          vertical: dealVertical ?? null,
          dealId,
        },
      });
      counts.enrolled++;
      await storage.createAuditLog({
        action: "new_lead_deal_enrolled",
        entityType: "deal",
        entityId: dealId,
        details: {
          contactId,
          sequenceId: seqId,
          vertical: dealVertical ?? null,
          dealId,
          enrolledBy: "backfill-new-lead-enrollments-script",
        },
      });

      if (counts.enrolled % 25 === 0) {
        console.log(
          `  ... enrolled ${counts.enrolled} so far (processed ${counts.enrolled + counts.alreadyEnrolled + counts.dncBlocked + counts.optOutBlocked + counts.contactabilityBlocked + counts.pewcBlocked + counts.missingContactMethod + counts.eligibilityBlocked + counts.noSequenceBlocked + counts.inactiveSequenceBlocked + counts.noContactBlocked + counts.errors})`
        );
      }
    } catch (err) {
      counts.errors++;
      console.error(
        `  [ERR ] deal=${dealId} contactId=${contactId} — ${err instanceof Error ? err.message : String(err)}`
      );
      // Write review queue item so operator can see the failure in the dashboard
      try {
        await storage.createReviewQueueItem({
          sourceType: "dead_letter_job" as any,
          sourceId: dealId,
          status: "pending",
          notes: `Backfill script: new-lead enrollment failed for deal ${dealId} (contact ${contactId}): ${err instanceof Error ? err.message : String(err)}`,
          metadata: {
            alertType: "new_lead_enrollment_error",
            dealId,
            contactId,
            vertical: row.dealVertical ?? null,
            error: err instanceof Error ? err.message : String(err),
            source: "backfill-new-lead-enrollments-script",
          },
        });
      } catch (rqErr) {
        console.error(`  [ERR ] Failed to write review queue item for deal ${dealId}:`, rqErr);
      }
    }
  }

  printSummary();

  if (counts.errors > 0) {
    process.exit(1);
  }
  process.exit(0);
}

function printSummary() {
  const separator = "─".repeat(56);
  console.log(`\n${separator}`);
  console.log(`backfill-new-lead-enrollments — ${DRY_RUN ? "DRY RUN " : ""}SUMMARY`);
  console.log(separator);
  console.log(`  Total unenrolled deals processed : ${counts.total}`);
  console.log(`  ${DRY_RUN ? "Would enroll" : "Enrolled"}              : ${counts.enrolled}`);
  console.log(`  Already enrolled (skipped)       : ${counts.alreadyEnrolled}`);
  console.log(`  DNC blocked                      : ${counts.dncBlocked}`);
  console.log(`  Opt-out blocked                  : ${counts.optOutBlocked}`);
  console.log(`  No sequence mapped               : ${counts.noSequenceBlocked}`);
  console.log(`  Inactive sequence                : ${counts.inactiveSequenceBlocked}`);
  console.log(`  PEWC blocked                     : ${counts.pewcBlocked}`);
  console.log(`  Missing contact method           : ${counts.missingContactMethod}`);
  console.log(`  Eligibility blocked              : ${counts.eligibilityBlocked}`);
  console.log(`  Contactability blocked           : ${counts.contactabilityBlocked}`);
  console.log(`  No contact linked                : ${counts.noContactBlocked}`);
  console.log(`  Errors                           : ${counts.errors}`);
  console.log(separator);
  if (counts.errors > 0) {
    console.log(
      "  ⚠ Failed enrollments were written to the review queue in the Operator Dashboard."
    );
  }
  if (DRY_RUN && counts.enrolled > 0) {
    console.log(`\n  Re-run without --dry-run to apply ${counts.enrolled} enrollment(s).`);
  }
}

main().catch((err) => {
  console.error("[backfill-new-lead-enrollments] Fatal error:", err);
  process.exit(1);
});
