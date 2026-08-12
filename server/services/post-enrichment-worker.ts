/**
 * Post-Enrichment Automation Worker
 *
 * Processes "post-enrichment" jobs fired by writebackEnrichmentToLinkedRecords
 * whenever a contactless lead gets its first real email or phone number.
 *
 * Per job it:
 *   1. Guards against re-fires (postEnrichmentAutomationAt already set)
 *   2. Checks the deal is still in an early/contactless stage
 *   3. Advances the deal to "Enriched" stage (if the stage allows it)
 *   4. Finds the best matching vertical sequence, falls back to a generic one
 *   5. Enrolls the contact via the existing contactability-gated enrollment path
 *   6. Writes a nextAction string to the deal card
 *   7. Emits audit log entries at every decision point
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { storage } from "../storage";
import { advanceDealStage } from "./deal-stage-service";
import { enrollContactInGhlWorkflow } from "./ghl-workflow-enrollment";

// Stages that are considered "contactless / early" — the worker only advances
// deals that are still in one of these stages. Any other stage means the deal
// has already been progressed by a rep and should not be touched.
const AUTO_ADVANCE_ELIGIBLE_STAGES = new Set([
  "New Lead",
]);

// ── Sequence lookup ──────────────────────────────────────────────────────────

/**
 * Find the best matching sequence for this contact's vertical.
 * Priority:
 *   1. Active sequence whose sequenceFamily exactly matches the vertical (case-insensitive)
 *   2. Active sequence whose name contains the vertical (case-insensitive)
 *   3. Active sequence whose triggerConfig.vertical matches
 *   4. Active "New Lead" fallback sequence
 *   5. Any active sequence (last resort)
 */
async function findSequenceForVertical(vertical: string | null): Promise<{
  id: number;
  name: string;
} | null> {
  // Load all active sequences once — the table is small enough
  const allSequences = await storage.getFollowUpSequences();
  const active = allSequences.filter((s: any) => s.status === "active");

  if (active.length === 0) return null;

  if (vertical) {
    const vLower = vertical.toLowerCase();

    // 1. sequenceFamily exact match
    const byFamily = active.find((s: any) =>
      typeof s.sequenceFamily === "string" &&
      s.sequenceFamily.toLowerCase() === vLower
    );
    if (byFamily) return { id: byFamily.id, name: byFamily.name };

    // 2. name contains vertical
    const byName = active.find((s: any) =>
      s.name.toLowerCase().includes(vLower)
    );
    if (byName) return { id: byName.id, name: byName.name };

    // 3. triggerConfig.vertical
    const byConfig = active.find((s: any) => {
      try {
        const cfg = typeof s.triggerConfig === "string"
          ? JSON.parse(s.triggerConfig)
          : (s.triggerConfig as Record<string, unknown> | null);
        return cfg && typeof cfg.vertical === "string" &&
          cfg.vertical.toLowerCase() === vLower;
      } catch { return false; }
    });
    if (byConfig) return { id: byConfig.id, name: byConfig.name };
  }

  // 4. Generic "New Lead" sequence
  const newLead = active.find((s: any) =>
    s.name.toLowerCase().includes("new lead") ||
    s.name.toLowerCase().includes("new_lead")
  );
  if (newLead) return { id: newLead.id, name: newLead.name };

  // 5. Any active sequence
  return { id: active[0].id, name: active[0].name };
}

// ── Main processor ───────────────────────────────────────────────────────────

export interface PostEnrichmentJobData {
  entityId: number;
  contactId: number;
  dealId: number;
}

export async function processPostEnrichmentJob(data: PostEnrichmentJobData): Promise<void> {
  const { entityId, contactId, dealId } = data;

  const logPrefix = `[PostEnrich] entity=${entityId} contact=${contactId} deal=${dealId}`;

  // ── 1. Guard: already processed? ─────────────────────────────────────────
  const deal = await storage.getDeal(dealId);
  if (!deal) {
    console.warn(`${logPrefix} — deal not found, skipping`);
    return;
  }

  if ((deal as any).postEnrichmentAutomationAt) {
    console.log(`${logPrefix} — already processed at ${(deal as any).postEnrichmentAutomationAt}, skipping`);
    return;
  }

  // Stamp the deal immediately to prevent concurrent re-fires
  await db.execute(sql`
    UPDATE deals
    SET post_enrichment_automation_at = NOW(), updated_at = NOW()
    WHERE id = ${dealId}
      AND post_enrichment_automation_at IS NULL
  `);

  await storage.createAuditLog({
    action: "post_enrichment_automation_started",
    entityType: "deal",
    entityId: dealId,
    details: { entityId, contactId, dealId, stage: deal.stage },
  });

  // ── 2. Check deal stage — only advance if still in an early stage ─────────
  const stageEligible = AUTO_ADVANCE_ELIGIBLE_STAGES.has(deal.stage ?? "");

  if (stageEligible) {
    try {
      await advanceDealStage(dealId, "Enriched", "post_enrichment_automation", {
        reason: "Enrichment found first contact info for contactless lead",
        actor: "system",
      });
      await storage.createAuditLog({
        action: "post_enrichment_stage_advanced",
        entityType: "deal",
        entityId: dealId,
        details: { fromStage: deal.stage, toStage: "Enriched", trigger: "post_enrichment_automation" },
      });
      console.log(`${logPrefix} — advanced from "${deal.stage}" → "Enriched"`);
    } catch (err: any) {
      // advanceDealStage can throw GoLiveGateError for onboarding deals — non-fatal
      console.warn(`${logPrefix} — stage advance failed (non-fatal): ${err?.message}`);
      await storage.createAuditLog({
        action: "post_enrichment_stage_advance_skipped",
        entityType: "deal",
        entityId: dealId,
        details: { stage: deal.stage, reason: err?.message || "unknown" },
      });
    }
  } else {
    console.log(`${logPrefix} — stage "${deal.stage}" not eligible for auto-advance, skipping stage change`);
    await storage.createAuditLog({
      action: "post_enrichment_stage_advance_skipped",
      entityType: "deal",
      entityId: dealId,
      details: { stage: deal.stage, reason: "Stage not in auto-advance eligible set" },
    });
  }

  // ── 3. Resolve vertical from contact (or deal) ────────────────────────────
  let vertical: string | null = (deal as any).vertical ?? null;
  if (!vertical) {
    try {
      const contact = await storage.getContact(contactId);
      vertical = contact?.vertical ?? null;
    } catch { /* non-critical */ }
  }

  // ── 4. Find sequence ──────────────────────────────────────────────────────
  const sequence = await findSequenceForVertical(vertical);

  if (!sequence) {
    // No sequences at all — write manual review action and exit
    const noSeqAction = "Manual review — no active sequence found";
    await db.execute(sql`
      UPDATE deals SET next_action = ${noSeqAction}, updated_at = NOW() WHERE id = ${dealId}
    `);
    await storage.createAuditLog({
      action: "post_enrichment_no_sequence",
      entityType: "deal",
      entityId: dealId,
      details: { vertical, reason: "No active sequences found in system" },
    });
    console.warn(`${logPrefix} — no active sequences found, wrote manual-review nextAction`);
    return;
  }

  const sequenceSource = vertical ? `vertical "${vertical}"` : "fallback (no vertical)";
  console.log(`${logPrefix} — resolved sequence "${sequence.name}" (id=${sequence.id}) via ${sequenceSource}`);

  // ── 5. Enroll the contact ─────────────────────────────────────────────────
  let enrollmentResult: { enrolled: boolean; method: string; reason?: string };
  try {
    enrollmentResult = await enrollContactInGhlWorkflow({
      contactId,
      sequenceName: sequence.name,
      sequenceId: sequence.id,
      vertical: vertical ?? undefined,
      dealId,
      // Use email-only channel for cold/enriched leads; avoids requiring PEWC
      // for SMS/voice until consent is established.
      outboundChannels: ["email"],
    });
  } catch (err: any) {
    enrollmentResult = { enrolled: false, method: "skipped", reason: err?.message || "enrollment threw" };
    console.error(`${logPrefix} — enrollment threw: ${err?.message}`);
  }

  await storage.createAuditLog({
    action: "post_enrichment_sequence_enrollment",
    entityType: "deal",
    entityId: dealId,
    details: {
      contactId,
      sequenceId: sequence.id,
      sequenceName: sequence.name,
      vertical,
      enrolled: enrollmentResult.enrolled,
      method: enrollmentResult.method,
      reason: enrollmentResult.reason,
    },
  });

  // ── 6. Write nextAction chip to deal ──────────────────────────────────────
  let nextAction: string;
  if (enrollmentResult.enrolled) {
    const vertLabel = vertical ? `${vertical} lead` : "lead";
    nextAction = `Enrolled — enriched ${vertLabel}, sequence started`;
  } else if (enrollmentResult.reason?.includes("do-not-contact") ||
             enrollmentResult.reason?.includes("contactability")) {
    nextAction = "Manual review — contact blocked from auto-outreach";
  } else {
    // Enrollment was skipped (e.g. no email yet, DNC, paused sequence)
    nextAction = `Manual outreach — enriched${vertical ? `, ${vertical}` : ""}, no auto-enrollment`;
  }

  await db.execute(sql`
    UPDATE deals SET next_action = ${nextAction}, updated_at = NOW() WHERE id = ${dealId}
  `);

  await storage.createAuditLog({
    action: "post_enrichment_next_action_set",
    entityType: "deal",
    entityId: dealId,
    details: { nextAction, enrolled: enrollmentResult.enrolled, sequenceId: sequence.id },
  });

  console.log(`${logPrefix} — complete. nextAction="${nextAction}", enrolled=${enrollmentResult.enrolled}`);
}
