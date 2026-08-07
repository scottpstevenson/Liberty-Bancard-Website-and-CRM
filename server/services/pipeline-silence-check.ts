/**
 * Pipeline Stage Silence Check
 * Runs daily to detect pipeline stages where no deal has been updated in the last
 * 24 hours (configurable via PIPELINE_SILENCE_THRESHOLD_HOURS). For each silent
 * stage, creates an in-app review-queue alert and sends an admin email.
 *
 * Cooldown: once alerted for a (pipeline, stage) pair, will not re-alert for 24h.
 * Cooldown is stored in system_settings under "pipeline_silence_cooldown".
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { storage } from "../storage";
import { sendSmtpEmail } from "./smtp-email";

const COOLDOWN_KEY = "pipeline_silence_cooldown";
const THRESHOLD_HOURS =
  parseInt(process.env.PIPELINE_SILENCE_THRESHOLD_HOURS ?? "24", 10) || 24;

interface SilentStageRow {
  pipeline: string;
  stage: string;
  max_updated_at: string | null;
  deal_count: string;
}

interface CooldownMap {
  [stageKey: string]: string; // ISO timestamp of last alert
}

export async function runPipelineSilenceCheck(): Promise<void> {
  const thresholdMs = THRESHOLD_HOURS * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - thresholdMs);

  // Find all active (pipeline, stage) pairs where the most-recently-updated deal
  // was last touched more than THRESHOLD_HOURS ago.
  let silentStages: SilentStageRow[] = [];
  try {
    const result = await db.execute(sql`
      SELECT
        pipeline,
        stage,
        MAX(updated_at) AS max_updated_at,
        COUNT(*)        AS deal_count
      FROM deals
      WHERE closed_at IS NULL
        AND archived_at IS NULL
      GROUP BY pipeline, stage
      HAVING MAX(updated_at) < ${cutoff.toISOString()}::timestamptz
         OR  MAX(updated_at) IS NULL
      ORDER BY max_updated_at ASC NULLS FIRST
    `);
    silentStages = result.rows as unknown as SilentStageRow[];
  } catch (err: any) {
    console.error("[PipelineSilenceCheck] DB query failed:", err.message);
    return;
  }

  if (silentStages.length === 0) {
    console.log("[PipelineSilenceCheck] No silent stages found — all active.");
    return;
  }

  // Load cooldown map
  let cooldownMap: CooldownMap = {};
  try {
    const raw = await storage.getSystemSetting(COOLDOWN_KEY);
    if (raw && typeof raw === "object") cooldownMap = raw as CooldownMap;
  } catch {
    // Start fresh if unreadable
  }

  const now = Date.now();
  const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h between re-alerts per stage
  const alertedStages: string[] = [];

  for (const row of silentStages) {
    const stageKey = `${row.pipeline}::${row.stage}`;
    const lastAlertAt = cooldownMap[stageKey] ? new Date(cooldownMap[stageKey]).getTime() : 0;

    if (now - lastAlertAt < COOLDOWN_MS) {
      // Already alerted within the cooldown window
      continue;
    }

    const ageHours = row.max_updated_at
      ? Math.round((now - new Date(row.max_updated_at).getTime()) / (60 * 60 * 1000))
      : null;
    const ageLabel = ageHours !== null ? `${ageHours}h` : "unknown";
    const dealCount = Number(row.deal_count ?? 0);
    const msg = `Pipeline stage silent: pipeline="${row.pipeline}" stage="${row.stage}" — ${dealCount} active deal(s), last movement ${ageLabel} ago (threshold ${THRESHOLD_HOURS}h)`;

    console.warn(`[PipelineSilenceCheck] ${msg}`);

    // Create in-app alert
    try {
      await storage.createReviewQueueItem({
        sourceType: "pipeline_silence_alert" as any,
        sourceId: 0,
        status: "pending",
        notes: msg,
        metadata: {
          alertType: "pipeline_stage_silent",
          pipeline: row.pipeline,
          stage: row.stage,
          dealCount,
          lastMovementAt: row.max_updated_at ?? null,
          thresholdHours: THRESHOLD_HOURS,
          ageHours,
        },
      });
    } catch (createErr: any) {
      console.error("[PipelineSilenceCheck] Failed to create review queue item:", createErr.message);
    }

    // Send admin email — cooldown is only recorded on success so a failed send retries next cycle
    const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    try {
      const recipient = process.env.ADMIN_ALERT_EMAIL || "accounts@libertybancard.com";
      const subject = `[Pipeline Alert] Stage "${row.stage}" silent for ${ageLabel} — ${dealCount} deal(s) stuck`;
      const html = `
        <div style="font-family:sans-serif;max-width:600px">
          <h2 style="color:#dc2626">Pipeline Stage Silence Alert</h2>
          <p>The following pipeline stage has had <strong>no deal movement</strong> for
             more than <strong>${THRESHOLD_HOURS} hours</strong>:</p>
          <table style="border-collapse:collapse;width:100%;margin:12px 0">
            <tr><th style="text-align:left;padding:6px 12px;background:#f3f4f6">Pipeline</th><td style="padding:6px 12px">${escHtml(String(row.pipeline ?? ""))}</td></tr>
            <tr><th style="text-align:left;padding:6px 12px;background:#f3f4f6">Stage</th><td style="padding:6px 12px">${escHtml(String(row.stage ?? ""))}</td></tr>
            <tr><th style="text-align:left;padding:6px 12px;background:#f3f4f6">Active Deals</th><td style="padding:6px 12px">${dealCount}</td></tr>
            <tr><th style="text-align:left;padding:6px 12px;background:#f3f4f6">Last Movement</th><td style="padding:6px 12px">${row.max_updated_at ? new Date(row.max_updated_at).toLocaleString() : "Unknown"} (${escHtml(ageLabel)} ago)</td></tr>
            <tr><th style="text-align:left;padding:6px 12px;background:#f3f4f6">Threshold</th><td style="padding:6px 12px">${THRESHOLD_HOURS} hours</td></tr>
          </table>
          <p>Please review the pipeline to ensure deals are progressing. This alert will not repeat for 24 hours.</p>
          <p style="color:#6b7280;font-size:12px">Sent at ${new Date().toISOString()}</p>
        </div>
      `;
      await sendSmtpEmail({ to: recipient, subject, html, category: "internal_ops" });
      // Only record cooldown after a successful send — failed email retries next cycle
      cooldownMap[stageKey] = new Date().toISOString();
      alertedStages.push(stageKey);
    } catch (emailErr: any) {
      console.warn("[PipelineSilenceCheck] Alert email failed — cooldown NOT recorded, will retry next cycle:", emailErr.message);
    }
  }

  // Persist updated cooldown map
  if (alertedStages.length > 0) {
    try {
      await storage.setSystemSetting(COOLDOWN_KEY, cooldownMap);
    } catch (err: any) {
      console.warn("[PipelineSilenceCheck] Could not persist cooldown map:", err.message);
    }
  }

  console.log(
    `[PipelineSilenceCheck] Done. Silent stages found=${silentStages.length} alerted=${alertedStages.length}`
  );
}
