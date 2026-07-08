#!/usr/bin/env tsx
/**
 * Dry-run: Inventory all sequence steps and campaign steps, flag active
 * sequences, and export a timestamped backup JSON. Makes NO DB writes.
 *
 * Usage:
 *   npx tsx scripts/backfill-templates-dryrun.ts
 */

import fs from "fs";
import path from "path";
import { db } from "../server/db";
import { followUpSequences, sequenceSteps, campaigns, campaignSteps } from "../shared/schema";
import { VERTICAL_OUTREACH_TEMPLATES, getVerticalTemplate } from "../server/services/vertical-email-sms-templates";
import { asc, eq } from "drizzle-orm";

// ── Vertical extraction ────────────────────────────────────────────────────────

const VERTICAL_ALIAS_MAP: Record<string, string> = {
  "retail":        "Retail",
  "auto repair":   "Auto Repair",
  "auto":          "Auto Shop",
  "medical":       "Healthcare",
  "med spa":       "MedSpa",
  "medspa":        "MedSpa",
  "restaurant":    "Restaurant",
  "dental":        "Dental",
  "salon":         "Salon/Beauty",
  "gym":           "Gym/Fitness",
  "hotel":         "Hotel/Lodging",
  "landscaping":   "Landscaping",
  "construction":  "Construction",
  "legal":         "Legal",
  "jewelry":       "Jewelry",
  "veterinary":    "Veterinary",
  "vet":           "Veterinary",
  "healthcare":    "Healthcare",
};

function extractVerticalKey(name: string): string | null {
  const match = name.match(/^V-(.+?):/i);
  if (!match) return null;
  const raw = match[1].trim().toLowerCase();
  const aliases = Object.keys(VERTICAL_ALIAS_MAP).sort((a, b) => b.length - a.length);
  for (const alias of aliases) {
    if (raw === alias) return VERTICAL_ALIAS_MAP[alias];
  }
  // Fallback through getVerticalTemplate's normalisation logic
  const direct = Object.keys(VERTICAL_OUTREACH_TEMPLATES).find(
    k => k.toLowerCase() === raw
  );
  return direct ?? null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Backfill Templates — DRY RUN ===\n");

  // ── 1. Sequences ─────────────────────────────────────────────────────────────
  const allSeqs = await db.select().from(followUpSequences).orderBy(asc(followUpSequences.id));
  console.log(`Found ${allSeqs.length} follow-up sequences.\n`);

  type SeqRow = {
    seqId: number;
    seqName: string;
    seqStatus: string;
    stepId: number;
    stepOrder: number;
    actionType: string;
    subject: string | null;
    bodyPreview: string;
    delayDays: number;
    mappedVertical: string | null;
    templateKeyAvailable: boolean;
    rawBody: string | null;
  };

  const seqRows: SeqRow[] = [];
  const activeSequences: Array<{ id: number; name: string; stepCount: number }> = [];
  const unmappedSequences: string[] = [];

  for (const seq of allSeqs) {
    const steps = await db
      .select()
      .from(sequenceSteps)
      .where(eq(sequenceSteps.sequenceId, seq.id))
      .orderBy(asc(sequenceSteps.stepOrder));

    const vertical = extractVerticalKey(seq.name);
    const template = vertical ? getVerticalTemplate(vertical) : null;
    const templateExists = template !== null;

    if (!vertical) unmappedSequences.push(seq.name);
    if (seq.status === "active") {
      activeSequences.push({ id: seq.id, name: seq.name, stepCount: steps.length });
    }

    for (const step of steps) {
      seqRows.push({
        seqId: seq.id,
        seqName: seq.name,
        seqStatus: seq.status ?? "paused",
        stepId: step.id,
        stepOrder: step.stepOrder,
        actionType: step.actionType,
        subject: step.subject ?? null,
        bodyPreview: (step.body ?? "").slice(0, 100).replace(/\n/g, " "),
        delayDays: step.delayDays ?? 0,
        mappedVertical: vertical,
        templateKeyAvailable: templateExists,
        rawBody: step.body ?? null,
      });
    }
  }

  // Print sequence inventory table
  console.log("─── Sequence Step Inventory ─────────────────────────────────────────────────");
  console.log(
    "SID".padEnd(5) +
    "Status".padEnd(9) +
    "StID".padEnd(6) +
    "Ord".padEnd(5) +
    "Type".padEnd(7) +
    "VerticalKey".padEnd(16) +
    "Tmpl".padEnd(5) +
    "SeqName".padEnd(38) +
    "Subject".padEnd(40) +
    "BodyPreview"
  );
  console.log("─".repeat(175));
  for (const row of seqRows) {
    const status = row.seqStatus === "active" ? "ACTIVE⚠" : row.seqStatus;
    console.log(
      String(row.seqId).padEnd(5) +
      status.padEnd(9) +
      String(row.stepId).padEnd(6) +
      String(row.stepOrder).padEnd(5) +
      row.actionType.padEnd(7) +
      (row.mappedVertical ?? "(unmapped)").slice(0, 15).padEnd(16) +
      (row.templateKeyAvailable ? "YES" : "NO").padEnd(5) +
      row.seqName.slice(0, 37).padEnd(38) +
      (row.subject ?? "(none)").slice(0, 39).padEnd(40) +
      row.bodyPreview.slice(0, 80)
    );
  }

  // ── 2. Campaigns ──────────────────────────────────────────────────────────────
  const allCampaigns = await db.select().from(campaigns).orderBy(asc(campaigns.id));
  console.log(`\nFound ${allCampaigns.length} campaigns.\n`);

  type CampRow = {
    campaignId: number;
    campaignName: string;
    stepId: number;
    stepOrder: number;
    stepType: string;
    subject: string | null;
    bodyPreview: string;
    delayDays: number;
    mappedVertical: string | null;
    templateKeyAvailable: boolean;
    rawBodyTemplate: string | null;
  };

  const campRows: CampRow[] = [];
  const unmappedCampaigns: string[] = [];

  for (const camp of allCampaigns) {
    const steps = await db
      .select()
      .from(campaignSteps)
      .where(eq(campaignSteps.campaignId, camp.id))
      .orderBy(asc(campaignSteps.stepOrder));

    const vertical = extractVerticalKey(camp.name);
    const template = vertical ? getVerticalTemplate(vertical) : null;
    const templateExists = template !== null;

    if (!vertical) unmappedCampaigns.push(camp.name);

    for (const step of steps) {
      campRows.push({
        campaignId: camp.id,
        campaignName: camp.name,
        stepId: step.id,
        stepOrder: step.stepOrder,
        stepType: step.stepType,
        subject: step.subject ?? null,
        bodyPreview: (step.bodyTemplate ?? "").slice(0, 100).replace(/\n/g, " "),
        delayDays: step.delayDays ?? 0,
        mappedVertical: vertical,
        templateKeyAvailable: templateExists,
        rawBodyTemplate: step.bodyTemplate ?? null,
      });
    }
  }

  if (allCampaigns.length > 0) {
    console.log("─── Campaign Step Inventory ──────────────────────────────────────────────────");
    console.log(
      "CID".padEnd(5) +
      "StID".padEnd(6) +
      "Ord".padEnd(5) +
      "Type".padEnd(7) +
      "VerticalKey".padEnd(16) +
      "Tmpl".padEnd(5) +
      "CampaignName".padEnd(38) +
      "Subject".padEnd(40) +
      "BodyPreview"
    );
    console.log("─".repeat(175));
    for (const row of campRows) {
      console.log(
        String(row.campaignId).padEnd(5) +
        String(row.stepId).padEnd(6) +
        String(row.stepOrder).padEnd(5) +
        row.stepType.padEnd(7) +
        (row.mappedVertical ?? "(unmapped)").slice(0, 15).padEnd(16) +
        (row.templateKeyAvailable ? "YES" : "NO").padEnd(5) +
        row.campaignName.slice(0, 37).padEnd(38) +
        (row.subject ?? "(none)").slice(0, 39).padEnd(40) +
        row.bodyPreview.slice(0, 80)
      );
    }
  }

  // ── 3. Active sequences report ───────────────────────────────────────────────
  console.log("\n─── Active Sequences (will be SKIPPED by apply unless --include-active) ─────");
  if (activeSequences.length === 0) {
    console.log("  (none — all sequences are paused/draft)");
  } else {
    for (const s of activeSequences) {
      console.log(`  [ACTIVE] id=${s.id}  name="${s.name}"  steps=${s.stepCount}`);
    }
  }

  // ── 4. Unmapped sequences/campaigns ──────────────────────────────────────────
  console.log("\n─── Unmapped (no vertical template — will be skipped by apply) ─────────────");
  const allUnmapped = [...unmappedSequences, ...unmappedCampaigns];
  if (allUnmapped.length === 0) {
    console.log("  (none)");
  } else {
    for (const n of allUnmapped) {
      console.log(`  [UNMAPPED] "${n}"`);
    }
  }

  // ── 5. Summary counts ─────────────────────────────────────────────────────────
  const totalSeqSteps = seqRows.length;
  const emailSeqSteps = seqRows.filter(r => r.actionType === "email").length;
  const mappableSeqEmailSteps = seqRows.filter(
    r => r.actionType === "email" && r.templateKeyAvailable && r.seqStatus !== "active"
  ).length;
  const campEmailSteps = campRows.filter(r => r.stepType === "email").length;
  const mappableCampEmailSteps = campRows.filter(
    r => r.stepType === "email" && r.templateKeyAvailable
  ).length;

  console.log("\n─── Summary ─────────────────────────────────────────────────────────────────");
  console.log(`  Sequence steps total:                             ${totalSeqSteps}`);
  console.log(`  Sequence email steps:                             ${emailSeqSteps}`);
  console.log(`  Sequence email steps (would update, excl active): ${mappableSeqEmailSteps}`);
  console.log(`  Campaign steps total:                             ${campRows.length}`);
  console.log(`  Campaign email steps:                             ${campEmailSteps}`);
  console.log(`  Campaign email steps (would update):              ${mappableCampEmailSteps}`);
  console.log(`  Active sequences (skipped):                       ${activeSequences.length}`);
  console.log(`  Unmapped names (skipped):                         ${allUnmapped.length}`);

  // ── 6. Write backup JSON ──────────────────────────────────────────────────────
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(process.cwd(), "scripts", `backfill-backup-${timestamp}.json`);

  const fullBackup = {
    generatedAt: new Date().toISOString(),
    sequenceSteps: seqRows.map(r => ({
      stepId: r.stepId,
      sequenceId: r.seqId,
      sequenceName: r.seqName,
      sequenceStatus: r.seqStatus,
      stepOrder: r.stepOrder,
      actionType: r.actionType,
      delayDays: r.delayDays,
      subject: r.subject,
      body: r.rawBody,
    })),
    campaignSteps: campRows.map(r => ({
      stepId: r.stepId,
      campaignId: r.campaignId,
      campaignName: r.campaignName,
      stepOrder: r.stepOrder,
      stepType: r.stepType,
      delayDays: r.delayDays,
      subject: r.subject,
      bodyTemplate: r.rawBodyTemplate,
    })),
  };

  fs.writeFileSync(backupPath, JSON.stringify(fullBackup, null, 2));
  console.log(`\n✅ Backup written to: ${backupPath}`);
  console.log("   Includes: stepId, sequenceId/campaignId, sequenceName/campaignName,");
  console.log("   sequenceStatus, stepOrder, actionType, subject, body/bodyTemplate.");
  console.log("\nDry run complete. Review the inventory above, then run the apply script.\n");

  process.exit(0);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
