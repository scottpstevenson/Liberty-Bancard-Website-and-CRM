/**
 * merchant-success-sequences.ts  (#1406)
 *
 * 30 / 60 / 90 day merchant success program.
 *
 * After a MID is activated (merchantMids.activatedAt IS NOT NULL), this
 * service runs daily and enrolls the linked contact into the appropriate
 * milestone sequence at each threshold — once per milestone, idempotent.
 *
 * Sequences are looked up by family name:
 *   "merchant_success_30d"  → 30-day check-in
 *   "merchant_success_60d"  → 60-day health review
 *   "merchant_success_90d"  → 90-day QBR / upsell outreach
 *
 * If no matching sequence is found, the milestone is silently skipped
 * and logged so ops can create the sequences when ready.
 */

import { db } from "../db";
import { merchantMids, contacts, followUpSequences as sequences, sequenceEnrollments } from "@shared/schema";
import { eq, and, isNotNull, lt, gte, isNull, inArray } from "drizzle-orm";
import { storage } from "../storage";

const MILESTONES: Array<{ days: number; family: string }> = [
  { days: 30,  family: "merchant_success_30d" },
  { days: 60,  family: "merchant_success_60d" },
  { days: 90,  family: "merchant_success_90d" },
];

/** Grace window: re-use the same ±3 day window so the job doesn't need to
 *  run at the exact millisecond of the 30/60/90 mark. */
const WINDOW_DAYS = 3;

export async function runMerchantSuccessSequences(): Promise<{
  checked: number;
  enrolled: number;
  skipped: number;
}> {
  let enrolled = 0;
  let skipped = 0;

  // Load all active sequences with a merchant_success family so we look them
  // up once instead of per-contact.
  const successSequences = await db
    .select({ id: sequences.id, family: sequences.sequenceFamily, status: sequences.status })
    .from(sequences)
    .where(
      inArray(
        sequences.sequenceFamily,
        MILESTONES.map((m) => m.family),
      )
    );

  const activeByFamily = new Map(
    successSequences
      .filter((s) => s.status === "active")
      .map((s) => [s.family!, s.id]),
  );

  const now = Date.now();

  // Find all activated MIDs — one row per MID
  const activatedRows = await db
    .select({
      midId:       merchantMids.id,
      contactId:   merchantMids.contactId,
      activatedAt: merchantMids.activatedAt,
    })
    .from(merchantMids)
    .where(isNotNull(merchantMids.activatedAt));

  const checked = activatedRows.length;

  for (const row of activatedRows) {
    if (!row.activatedAt || !row.contactId) continue;

    const activatedMs = new Date(row.activatedAt).getTime();
    const daysSince = (now - activatedMs) / (24 * 60 * 60 * 1000);

    for (const milestone of MILESTONES) {
      const { days, family } = milestone;
      const seqId = activeByFamily.get(family);

      // Skip if milestone not yet due or past the re-check window
      if (daysSince < days - WINDOW_DAYS || daysSince > days + WINDOW_DAYS) continue;

      if (!seqId) {
        // Sequence not configured — log once and move on
        await storage.createAuditLog({
          action: "merchant_success_sequence_not_configured",
          entityType: "contact",
          entityId: row.contactId,
          actorType: "system",
          details: { family, days, midId: row.midId, daysSinceActivation: Math.round(daysSince) },
        }).catch(() => {});
        skipped++;
        continue;
      }

      // Idempotent check — is the contact already enrolled in this sequence?
      const [existing] = await db
        .select({ id: sequenceEnrollments.id })
        .from(sequenceEnrollments)
        .where(
          and(
            eq(sequenceEnrollments.contactId, row.contactId),
            eq(sequenceEnrollments.sequenceId, seqId),
          )
        )
        .limit(1);

      if (existing) {
        skipped++;
        continue;
      }

      // Enroll the contact
      try {
        await db.insert(sequenceEnrollments).values({
          contactId:     row.contactId,
          sequenceId:    seqId,
          status:        "active",
          nextActionAt:  new Date(),
          currentStep:   0,
          metadata: { midId: row.midId, milestone: `${days}d`, daysSinceActivation: Math.round(daysSince), enrollmentSource: "merchant_success_program" },
        });

        await storage.createAuditLog({
          action: "merchant_success_enrollment",
          entityType: "contact",
          entityId: row.contactId,
          actorType: "system",
          details: { family, days, sequenceId: seqId, midId: row.midId, daysSinceActivation: Math.round(daysSince) },
        });

        enrolled++;
      } catch (err: any) {
        // Unique constraint: already enrolled (race condition) — ignore
        if (!String(err?.message).includes("unique") && !String(err?.message).includes("duplicate")) {
          console.error(`[MerchantSuccess] Enrollment failed for contact ${row.contactId}:`, err);
        }
        skipped++;
      }
    }
  }

  return { checked, enrolled, skipped };
}
