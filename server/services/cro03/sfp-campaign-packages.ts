/**
 * sfp-campaign-packages.ts
 *
 * Task #2001 (Defects 3/4/9/10): immutable, versioned five-package
 * (vertical -> campaign+sequence) mapping, plus the explicit
 * preview/apply/verify configuration-convergence command that performs the
 * one-time Dental split / Retail / Auto-Repair narrowing / five-sequence
 * creation. Campaigns and sequences are always resolved by NAME/logical
 * identity here, never by hardcoded numeric ID — those IDs are ordinary
 * serial keys and are not guaranteed stable across environments.
 *
 * This module never writes to sequence_enrollments, campaign_queue_*, or any
 * GHL/outbound table. `lifecycleState = 'current'` on a package version means
 * only "this is the current SFP vertical-to-package mapping" — it is a
 * reference/version authority, never an approval or send authority.
 * campaign_approvals and CR-06 remain the only applicable approval
 * authorities, unchanged by this task.
 */

import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "../../db";

const rows = (r: any): any[] => r?.rows ?? r ?? [];

export type SfpPackageKey =
  | "sfp.restaurant.v1"
  | "sfp.med_spa.v1"
  | "sfp.dental.v1"
  | "sfp.retail.v1"
  | "sfp.auto_repair.v1";

export const SFP_PACKAGE_KEYS: SfpPackageKey[] = [
  "sfp.restaurant.v1",
  "sfp.med_spa.v1",
  "sfp.dental.v1",
  "sfp.retail.v1",
  "sfp.auto_repair.v1",
];

interface PackagePlan {
  packageKey: SfpPackageKey;
  vertical: string;
  /** Source campaign to resolve/narrow-or-split from, by exact name. */
  sourceCampaignName: string;
  /** Final campaign name this package resolves to. */
  targetCampaignName: string;
  /** Whether the target campaign is a brand-new split (never mutate SDR-05 itself for Dental). */
  isSplit: boolean;
  targetSequenceName: string;
  sequenceFamily: string;
}

const PACKAGE_PLAN: PackagePlan[] = [
  {
    packageKey: "sfp.restaurant.v1",
    vertical: "Restaurant",
    sourceCampaignName: "SDR-04: Restaurant & Food Service",
    targetCampaignName: "SDR-04: Restaurant & Food Service",
    isSplit: false,
    targetSequenceName: "SFP Cold Outreach — Restaurant",
    sequenceFamily: "sfp-cold-restaurant",
  },
  {
    packageKey: "sfp.med_spa.v1",
    vertical: "Med Spa",
    sourceCampaignName: "SDR-05: Medical / Dental / Medspa",
    targetCampaignName: "SDR-05: Medical / Medspa",
    isSplit: false,
    targetSequenceName: "SFP Cold Outreach — Med Spa",
    sequenceFamily: "sfp-cold-med-spa",
  },
  {
    packageKey: "sfp.dental.v1",
    vertical: "Dental",
    sourceCampaignName: "SDR-05: Medical / Dental / Medspa",
    targetCampaignName: "SDR-11: Dental (split from SDR-05)",
    isSplit: true,
    targetSequenceName: "SFP Cold Outreach — Dental",
    sequenceFamily: "sfp-cold-dental",
  },
  {
    packageKey: "sfp.retail.v1",
    vertical: "Retail",
    sourceCampaignName: "SDR-06: Retail & E-Commerce",
    targetCampaignName: "SDR-06: Retail & E-Commerce",
    isSplit: false,
    targetSequenceName: "SFP Cold Outreach — Retail",
    sequenceFamily: "sfp-cold-retail",
  },
  {
    packageKey: "sfp.auto_repair.v1",
    vertical: "Auto Repair",
    sourceCampaignName: "SDR-07: Auto / Service / Trades",
    targetCampaignName: "SDR-07: Auto / Service / Trades",
    isSplit: false,
    targetSequenceName: "SFP Cold Outreach — Auto Repair",
    sequenceFamily: "sfp-cold-auto-repair",
  },
];

// SDR-10 (Salon/Spa/Beauty) is explicitly reviewable source material only; it
// must never become a package target. Asserted at module load so a future
// edit cannot silently retarget Med Spa to it.
if (PACKAGE_PLAN.some((p) => p.sourceCampaignName.includes("SDR-10") || p.targetCampaignName.includes("SDR-10"))) {
  throw new Error("SFP_PACKAGE_PLAN_INVALID: SDR-10 must never be a package source or target");
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/**
 * Hashes the ACTUAL campaign/sequence content (description, verticals,
 * content revision, and every step's subject/body/timing/config) — not just
 * IDs, names, and family. A copy edit to a step or a campaign content-revision
 * bump must change this hash, so a package pinned earlier and later reused
 * cannot silently reach `ready_held` against content that moved underneath
 * it. `exec` accepts either `db` or a live transaction executor so this can
 * be recomputed and compared inside the same transaction that writes the
 * staging intent (never trust a value computed outside that transaction).
 */
export async function computeLivePackageContentHash(
  exec: { execute: (q: any) => Promise<any> },
  campaignId: number,
  sequenceId: number,
): Promise<string> {
  const campaignRow = rows(await exec.execute(sql`
    SELECT description, target_verticals, total_steps, content_revision, status
    FROM campaigns WHERE id = ${campaignId}
  `))[0];
  const campaignStepRows = rows(await exec.execute(sql`
    SELECT step_order, step_type, subject, body_template, delay_days, channel
    FROM campaign_steps WHERE campaign_id = ${campaignId} ORDER BY step_order ASC
  `));
  const sequenceRow = rows(await exec.execute(sql`
    SELECT description, total_steps, trigger_type, trigger_config, channels_allowed,
           eligible_consent_tiers, offer_routes, lifecycle_stages_allowed, status
    FROM follow_up_sequences WHERE id = ${sequenceId}
  `))[0];
  const sequenceStepRows = rows(await exec.execute(sql`
    SELECT step_order, action_type, subject, body, delay_days, delay_hours, config
    FROM sequence_steps WHERE sequence_id = ${sequenceId} ORDER BY step_order ASC
  `));
  return sha256({ campaignRow, campaignStepRows, sequenceRow, sequenceStepRows });
}

export interface PackageConvergencePreviewRow {
  packageKey: SfpPackageKey;
  vertical: string;
  action: "noop_current" | "create_campaign" | "narrow_campaign" | "create_sequence" | "reuse_sequence";
  detail: string;
}

export interface PackageConvergencePreview {
  rows: PackageConvergencePreviewRow[];
  wouldChangeCount: number;
  capturedAt: string;
}

/**
 * Read-only preview of what the convergence apply step would do. No writes.
 */
export async function previewPackageConvergence(): Promise<PackageConvergencePreview> {
  const previewRows: PackageConvergencePreviewRow[] = [];

  const currentVersions = rows(await db.execute(sql`
    SELECT package_key, campaign_name, sequence_name FROM sfp_campaign_package_versions
    WHERE lifecycle_state = 'current'
  `));
  const currentByKey = new Map(currentVersions.map((r) => [String(r.package_key), r]));

  for (const plan of PACKAGE_PLAN) {
    const existingCurrent = currentByKey.get(plan.packageKey);
    if (existingCurrent) {
      previewRows.push({
        packageKey: plan.packageKey,
        vertical: plan.vertical,
        action: "noop_current",
        detail: `Already current: campaign="${existingCurrent.campaign_name}" sequence="${existingCurrent.sequence_name}"`,
      });
      continue;
    }

    const campaignRow = rows(await db.execute(sql`
      SELECT id, name, status FROM campaigns WHERE name = ${plan.targetCampaignName} LIMIT 1
    `))[0];
    if (!campaignRow) {
      if (plan.isSplit) {
        previewRows.push({
          packageKey: plan.packageKey,
          vertical: plan.vertical,
          action: "create_campaign",
          detail: `Would create new draft campaign "${plan.targetCampaignName}" split from "${plan.sourceCampaignName}"`,
        });
      } else {
        previewRows.push({
          packageKey: plan.packageKey,
          vertical: plan.vertical,
          action: "narrow_campaign",
          detail: `Target campaign "${plan.targetCampaignName}" not found — would require operator content review before creation`,
        });
      }
    } else if (!plan.isSplit && campaignRow.name !== plan.sourceCampaignName) {
      previewRows.push({
        packageKey: plan.packageKey,
        vertical: plan.vertical,
        action: "narrow_campaign",
        detail: `Existing campaign "${campaignRow.name}" (id=${campaignRow.id}) would be scoped to ${plan.vertical} only`,
      });
    }

    const sequenceRow = rows(await db.execute(sql`
      SELECT id, name, status, sequence_family FROM follow_up_sequences WHERE name = ${plan.targetSequenceName} LIMIT 1
    `))[0];
    if (!sequenceRow) {
      previewRows.push({
        packageKey: plan.packageKey,
        vertical: plan.vertical,
        action: "create_sequence",
        detail: `Would create new paused sequence "${plan.targetSequenceName}" (family=${plan.sequenceFamily}) cloning W6 governance shape`,
      });
    } else {
      previewRows.push({
        packageKey: plan.packageKey,
        vertical: plan.vertical,
        action: "reuse_sequence",
        detail: `Existing sequence "${sequenceRow.name}" (id=${sequenceRow.id}, status=${sequenceRow.status}) would be reused`,
      });
    }
  }

  return {
    rows: previewRows,
    wouldChangeCount: previewRows.filter((r) => r.action !== "noop_current" && r.action !== "reuse_sequence").length,
    capturedAt: new Date().toISOString(),
  };
}

interface ApplyResultRow {
  packageKey: SfpPackageKey;
  status: "created" | "already_current" | "skipped_needs_review";
  packageVersionId?: string;
  campaignId?: number;
  sequenceId?: number;
  reason?: string;
}

/**
 * Apply the configuration convergence. Idempotent: a package_key already
 * `current` is left untouched. Never overwrites an active/approved campaign
 * or a sequence with existing steps/history — those cases are surfaced as
 * `skipped_needs_review` for an explicit, separate operator action rather
 * than silently mutated.
 */
export async function applyPackageConvergence(opts: { actorId: string }): Promise<ApplyResultRow[]> {
  const results: ApplyResultRow[] = [];
  const w6 = rows(await db.execute(sql`
    SELECT id, description, trigger_type, trigger_config, total_steps, eligible_consent_tiers,
           channels_allowed, offer_routes, lifecycle_stages_allowed
    FROM follow_up_sequences WHERE sequence_family = 'cold-email-manual-call' ORDER BY id ASC LIMIT 1
  `))[0];
  if (!w6) {
    throw new Error("SFP_W6_GOVERNANCE_TEMPLATE_NOT_FOUND: cannot clone sequence governance shape");
  }

  for (const plan of PACKAGE_PLAN) {
    const existingCurrent = rows(await db.execute(sql`
      SELECT id FROM sfp_campaign_package_versions WHERE package_key = ${plan.packageKey} AND lifecycle_state = 'current' LIMIT 1
    `))[0];
    if (existingCurrent) {
      results.push({ packageKey: plan.packageKey, status: "already_current", packageVersionId: String(existingCurrent.id) });
      continue;
    }

    // Resolve/create campaign
    let campaignRow = rows(await db.execute(sql`
      SELECT id, name, status, content_revision FROM campaigns WHERE name = ${plan.targetCampaignName} LIMIT 1
    `))[0];
    if (!campaignRow && plan.isSplit) {
      const sourceCampaign = rows(await db.execute(sql`
        SELECT id, description, target_verticals, total_steps FROM campaigns WHERE name = ${plan.sourceCampaignName} LIMIT 1
      `))[0];
      if (!sourceCampaign) {
        results.push({ packageKey: plan.packageKey, status: "skipped_needs_review", reason: `source campaign "${plan.sourceCampaignName}" not found` });
        continue;
      }
      campaignRow = rows(await db.execute(sql`
        INSERT INTO campaigns (name, description, target_verticals, status, total_steps, created_by, content_revision)
        VALUES (${plan.targetCampaignName},
                ${`Draft ${plan.vertical} campaign split from "${plan.sourceCampaignName}" (Task #2001). Content/compliance review required before use.`},
                ARRAY[${plan.vertical}]::text[], 'draft', ${sourceCampaign.total_steps ?? 3}, ${opts.actorId}, 1)
        RETURNING id, name, status, content_revision
      `))[0];
    }
    if (!campaignRow) {
      results.push({ packageKey: plan.packageKey, status: "skipped_needs_review", reason: `target campaign "${plan.targetCampaignName}" does not exist and is not a split — requires an explicit, separately-governed narrowing edit before this package can go current` });
      continue;
    }
    if (campaignRow.status !== "draft") {
      results.push({ packageKey: plan.packageKey, status: "skipped_needs_review", reason: `campaign "${campaignRow.name}" (id=${campaignRow.id}) status is "${campaignRow.status}", not "draft" — refusing to pin an active/approved campaign without explicit review` });
      continue;
    }

    // Resolve/create sequence
    let sequenceRow = rows(await db.execute(sql`
      SELECT id, name, status, total_steps FROM follow_up_sequences WHERE name = ${plan.targetSequenceName} LIMIT 1
    `))[0];
    if (!sequenceRow) {
      sequenceRow = rows(await db.execute(sql`
        INSERT INTO follow_up_sequences
          (name, description, trigger_type, trigger_config, total_steps, status, created_by,
           sequence_family, eligible_consent_tiers, channels_allowed, offer_routes, lifecycle_stages_allowed)
        VALUES (${plan.targetSequenceName},
                ${`SFP ${plan.vertical} cold-outreach sequence (Task #2001), cloned from the W6 governance template. Paused until a later, separately authorized activation task.`},
                ${w6.trigger_type}, ${JSON.stringify(w6.trigger_config)}::jsonb, ${w6.total_steps ?? 0}, 'paused', ${opts.actorId},
                ${plan.sequenceFamily}, ${w6.eligible_consent_tiers}, ${w6.channels_allowed}, ${w6.offer_routes}, ${w6.lifecycle_stages_allowed})
        RETURNING id, name, status, total_steps
      `))[0];
    }
    if (sequenceRow.status !== "paused") {
      results.push({ packageKey: plan.packageKey, status: "skipped_needs_review", reason: `sequence "${sequenceRow.name}" (id=${sequenceRow.id}) status is "${sequenceRow.status}", not "paused" — refusing to pin a live sequence` });
      continue;
    }

    const contentHash = await computeLivePackageContentHash(db, Number(campaignRow.id), Number(sequenceRow.id));

    const inserted = rows(await db.execute(sql`
      INSERT INTO sfp_campaign_package_versions
        (package_key, vertical, campaign_id, campaign_name, sequence_id, sequence_name,
         sequence_family, content_hash, lifecycle_state, effective_at, actor_id, notes)
      VALUES (${plan.packageKey}, ${plan.vertical}, ${Number(campaignRow.id)}, ${campaignRow.name},
              ${Number(sequenceRow.id)}, ${sequenceRow.name}, ${plan.sequenceFamily}, ${contentHash},
              'current', NOW(), ${opts.actorId},
              'Created by Task #2001 configuration-convergence command')
      RETURNING id
    `))[0];

    results.push({
      packageKey: plan.packageKey, status: "created",
      packageVersionId: String(inserted.id), campaignId: Number(campaignRow.id), sequenceId: Number(sequenceRow.id),
    });
  }

  return results;
}

/** Verify step: every package key has exactly one `current` version pinned to a draft campaign + paused sequence. */
export async function verifyPackageConvergence(): Promise<{ ok: boolean; issues: string[] }> {
  const issues: string[] = [];
  for (const key of SFP_PACKAGE_KEYS) {
    const row = rows(await db.execute(sql`
      SELECT v.id, v.campaign_id, v.sequence_id, c.status AS campaign_status, s.status AS sequence_status
      FROM sfp_campaign_package_versions v
      JOIN campaigns c ON c.id = v.campaign_id
      JOIN follow_up_sequences s ON s.id = v.sequence_id
      WHERE v.package_key = ${key} AND v.lifecycle_state = 'current'
      LIMIT 1
    `))[0];
    if (!row) { issues.push(`${key}: no current package version`); continue; }
    if (row.campaign_status !== "draft") issues.push(`${key}: campaign status is "${row.campaign_status}", expected "draft"`);
    if (row.sequence_status !== "paused") issues.push(`${key}: sequence status is "${row.sequence_status}", expected "paused"`);
  }
  return { ok: issues.length === 0, issues };
}

/** Resolve the current package version for a given vertical name (fail-closed if none). */
export async function getCurrentPackageForVertical(vertical: string): Promise<{
  id: string; packageKey: SfpPackageKey; campaignId: number; sequenceId: number; contentHash: string;
} | null> {
  const row = rows(await db.execute(sql`
    SELECT id, package_key, campaign_id, sequence_id, content_hash
    FROM sfp_campaign_package_versions
    WHERE vertical = ${vertical} AND lifecycle_state = 'current'
    LIMIT 1
  `))[0];
  if (!row) return null;
  return {
    id: String(row.id), packageKey: row.package_key as SfpPackageKey,
    campaignId: Number(row.campaign_id), sequenceId: Number(row.sequence_id), contentHash: String(row.content_hash),
  };
}
