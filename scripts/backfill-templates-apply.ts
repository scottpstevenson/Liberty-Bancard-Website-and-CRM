#!/usr/bin/env tsx
/**
 * Apply: Replace subject and body/bodyTemplate for every sequence step and
 * campaign step whose vertical maps to a template in VERTICAL_OUTREACH_TEMPLATES.
 *
 * REQUIRED: Run the dry-run script first to produce a backup JSON.
 *
 * Usage:
 *   npx tsx scripts/backfill-templates-apply.ts
 *   npx tsx scripts/backfill-templates-apply.ts --include-active
 *
 * Kill lines enforced:
 *   - Will not run unless a backup JSON exists in scripts/
 *   - Sequence steps use `body`; campaign steps use `bodyTemplate` — never mixed
 *   - Does not touch status, enrolledAt, isActive, or any send-queue field
 *   - Active sequences are skipped unless --include-active is passed
 *   - Warns on any unsupported merge tag found in written content (post-write read)
 */

import fs from "fs";
import path from "path";
import { db } from "../server/db";
import {
  followUpSequences,
  sequenceSteps,
  campaigns,
  campaignSteps,
} from "../shared/schema";
import {
  VERTICAL_OUTREACH_TEMPLATES,
  getVerticalTemplate,
  type VerticalTemplate,
} from "../server/services/vertical-email-sms-templates";
import { asc, eq } from "drizzle-orm";

// ── CLI flags ──────────────────────────────────────────────────────────────────
const INCLUDE_ACTIVE = process.argv.includes("--include-active");

// ── Allowed merge tags ─────────────────────────────────────────────────────────
const ALLOWED_TAGS = new Set([
  "firstName",
  "companyName",
  "businessName",
  "agentName",
  "agentPhone",
  "agentEmail",
  "bookingLink",
]);

function auditMergeTagsInText(text: string, label: string): void {
  const found = [...text.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]);
  for (const tag of found) {
    if (!ALLOWED_TAGS.has(tag)) {
      console.warn(`  ⚠  UNSUPPORTED TAG {{${tag}}} in ${label}`);
    }
  }
}

// ── Compliance checks ──────────────────────────────────────────────────────────
const BANNED_PHRASES = [
  "guaranteed savings",
  "guaranteed approval",
  "unsubscribe",
  "physical mailing address",
  "can-spam",
  "fake chargeback",
];

function failOnBannedContent(text: string, label: string): void {
  for (const phrase of BANNED_PHRASES) {
    if (text.toLowerCase().includes(phrase)) {
      console.error(`\n🛑 KILL LINE: banned content "${phrase}" found in ${label}. Aborting.`);
      process.exit(2);
    }
  }
}

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
  // Longest-first so "auto repair" beats "auto"
  const aliases = Object.keys(VERTICAL_ALIAS_MAP).sort((a, b) => b.length - a.length);
  for (const alias of aliases) {
    if (raw === alias) return VERTICAL_ALIAS_MAP[alias];
  }
  // Direct template key match fallback
  const direct = Object.keys(VERTICAL_OUTREACH_TEMPLATES).find(
    k => k.toLowerCase() === raw
  );
  return direct ?? null;
}

function getEmailSlot(
  template: VerticalTemplate,
  emailIndex: number
): { subject: string; body: string } | null {
  if (emailIndex === 1) return template.email;
  if (emailIndex === 2) return template.followUpEmail;
  if (emailIndex === 3 && template.thirdEmail) return template.thirdEmail;
  return null;
}

// ── Backup guard ───────────────────────────────────────────────────────────────

function ensureBackupExists(): void {
  const scriptsDir = path.join(process.cwd(), "scripts");
  const backups = fs
    .readdirSync(scriptsDir)
    .filter(f => f.startsWith("backfill-backup-") && f.endsWith(".json"));

  if (backups.length === 0) {
    console.error(
      "\n🛑 KILL LINE: No backup JSON found in scripts/. Run the dry-run script first:\n" +
        "   npx tsx scripts/backfill-templates-dryrun.ts\n"
    );
    process.exit(2);
  }

  const newest = backups.sort().at(-1)!;
  console.log(`✅ Backup found: scripts/${newest}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Backfill Templates — APPLY ===\n");
  if (INCLUDE_ACTIVE) {
    console.log("⚠  --include-active flag is set: active sequences will also be updated.\n");
  }

  ensureBackupExists();

  let seqStepsUpdated = 0;
  let campStepsUpdated = 0;
  const activeSkipped: Array<{ id: number; name: string; stepCount: number }> = [];

  // ── 1. Sequence steps ──────────────────────────────────────────────────────
  console.log("\n─── Updating Sequence Steps ──────────────────────────────────────────────────");

  const allSeqs = await db.select().from(followUpSequences).orderBy(asc(followUpSequences.id));

  for (const seq of allSeqs) {
    const steps = await db
      .select()
      .from(sequenceSteps)
      .where(eq(sequenceSteps.sequenceId, seq.id))
      .orderBy(asc(sequenceSteps.stepOrder));

    // Active-sequence guard
    if (seq.status === "active" && !INCLUDE_ACTIVE) {
      activeSkipped.push({ id: seq.id, name: seq.name, stepCount: steps.length });
      continue;
    }

    const verticalKey = extractVerticalKey(seq.name);
    if (!verticalKey) {
      console.log(`  [SKIP] "${seq.name}" — no vertical mapping found`);
      continue;
    }

    // Use the authoritative getVerticalTemplate() lookup
    const template = getVerticalTemplate(verticalKey);
    if (!template) {
      console.log(`  [SKIP] "${seq.name}" — vertical "${verticalKey}" not in VERTICAL_OUTREACH_TEMPLATES`);
      continue;
    }

    let emailIndex = 0;

    for (const step of steps) {
      if (step.actionType !== "email") continue;

      emailIndex++;
      const slot = getEmailSlot(template, emailIndex);

      if (!slot) {
        console.log(
          `  [SKIP] seq="${seq.name}" stepId=${step.id} order=${step.stepOrder} ` +
            `emailIndex=${emailIndex} — no template slot (only email/followUpEmail/thirdEmail)`
        );
        continue;
      }

      const { subject, body } = slot;

      // Compliance checks before writing
      failOnBannedContent(subject, `seq="${seq.name}" stepId=${step.id} subject`);
      failOnBannedContent(body, `seq="${seq.name}" stepId=${step.id} body`);

      // Write — only subject and body; never touches status, isActive, etc.
      await db
        .update(sequenceSteps)
        .set({ subject, body })
        .where(eq(sequenceSteps.id, step.id));

      seqStepsUpdated++;

      // Post-write audit: re-read the stored row and validate merge tags
      const [stored] = await db
        .select({ subject: sequenceSteps.subject, body: sequenceSteps.body })
        .from(sequenceSteps)
        .where(eq(sequenceSteps.id, step.id));

      if (stored) {
        auditMergeTagsInText(stored.subject ?? "", `seq="${seq.name}" stepId=${step.id} [stored] subject`);
        auditMergeTagsInText(stored.body ?? "", `seq="${seq.name}" stepId=${step.id} [stored] body`);
      }

      console.log(
        `  [UPDATED] seq="${seq.name}" stepId=${step.id} order=${step.stepOrder} ` +
          `emailSlot=${emailIndex} subject="${subject.slice(0, 60)}"`
      );
    }
  }

  // ── 2. Campaign steps ──────────────────────────────────────────────────────
  console.log("\n─── Updating Campaign Steps ──────────────────────────────────────────────────");

  const allCampaigns = await db.select().from(campaigns).orderBy(asc(campaigns.id));

  for (const camp of allCampaigns) {
    const steps = await db
      .select()
      .from(campaignSteps)
      .where(eq(campaignSteps.campaignId, camp.id))
      .orderBy(asc(campaignSteps.stepOrder));

    const verticalKey = extractVerticalKey(camp.name);
    if (!verticalKey) {
      console.log(`  [SKIP] campaign="${camp.name}" — no vertical mapping found`);
      continue;
    }

    const template = getVerticalTemplate(verticalKey);
    if (!template) {
      console.log(`  [SKIP] campaign="${camp.name}" — vertical "${verticalKey}" not in VERTICAL_OUTREACH_TEMPLATES`);
      continue;
    }

    let emailIndex = 0;

    for (const step of steps) {
      if (step.stepType !== "email") continue;

      emailIndex++;
      const slot = getEmailSlot(template, emailIndex);

      if (!slot) {
        console.log(
          `  [SKIP] campaign="${camp.name}" stepId=${step.id} order=${step.stepOrder} ` +
            `emailIndex=${emailIndex} — no template slot`
        );
        continue;
      }

      const { subject } = slot;
      // Kill line: campaign steps use bodyTemplate, NOT body
      const bodyTemplate = slot.body;

      failOnBannedContent(subject, `campaign="${camp.name}" stepId=${step.id} subject`);
      failOnBannedContent(bodyTemplate, `campaign="${camp.name}" stepId=${step.id} bodyTemplate`);

      // Write — only subject and bodyTemplate; never touches status, isActive, etc.
      await db
        .update(campaignSteps)
        .set({ subject, bodyTemplate })
        .where(eq(campaignSteps.id, step.id));

      campStepsUpdated++;

      // Post-write audit: re-read stored row and validate merge tags
      const [stored] = await db
        .select({ subject: campaignSteps.subject, bodyTemplate: campaignSteps.bodyTemplate })
        .from(campaignSteps)
        .where(eq(campaignSteps.id, step.id));

      if (stored) {
        auditMergeTagsInText(stored.subject ?? "", `campaign="${camp.name}" stepId=${step.id} [stored] subject`);
        auditMergeTagsInText(stored.bodyTemplate ?? "", `campaign="${camp.name}" stepId=${step.id} [stored] bodyTemplate`);
      }

      console.log(
        `  [UPDATED] campaign="${camp.name}" stepId=${step.id} order=${step.stepOrder} ` +
          `emailSlot=${emailIndex} subject="${subject.slice(0, 60)}"`
      );
    }
  }

  // ── 3. Active-sequence skipped report ─────────────────────────────────────
  console.log("\n─── Active Sequences Skipped ─────────────────────────────────────────────────");
  if (activeSkipped.length === 0) {
    console.log("  (none — no active sequences were present, or --include-active was used)");
  } else {
    for (const s of activeSkipped) {
      console.log(
        `  [SKIPPED] id=${s.id}  steps=${s.stepCount}  reason=status=active  name="${s.name}"`
      );
    }
    console.log(
      `\n  To update active sequences, re-run with --include-active flag.\n` +
        `  WARNING: active sequences may have live enrollments.`
    );
  }

  // ── 4. Final count ────────────────────────────────────────────────────────
  console.log("\n─── Final Count ──────────────────────────────────────────────────────────────");
  console.log(`  Sequence steps updated:      ${seqStepsUpdated}`);
  console.log(`  Campaign steps updated:      ${campStepsUpdated}`);
  console.log(`  Active sequences skipped:    ${activeSkipped.length}`);
  console.log("\n✅ Apply complete.\n");

  process.exit(0);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
