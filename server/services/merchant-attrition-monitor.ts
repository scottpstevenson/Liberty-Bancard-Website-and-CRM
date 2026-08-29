/**
 * Merchant Attrition Early Warning System
 *
 * Runs after each mid-ingestion tick. Compares current vs prior month volume
 * per merchant (via merchant_residuals) and chargeback ratios (via mid_daily_stats).
 *
 * Trigger conditions (configurable via system_settings):
 *   • Volume drop > 20% month-over-month (ATTRITION_VOLUME_DROP_THRESHOLD_PCT)
 *   • Chargeback ratio > 0.75% of transactions (ATTRITION_CHARGEBACK_RATIO_THRESHOLD_PCT)
 *
 * On trigger (at most once per 30 days per merchant):
 *   1. Creates an urgent rep task
 *   2. Sets contact churnRiskTier to "High" (if not already Critical)
 *   3. Upserts merchantHealthScore with updated risk tier
 *   4. Enrolls contact in the "Reactivation — Cold Lead Revival" sequence
 *   5. Emits an admin/manager digest notification for all triggered accounts
 */

import { db } from "../db";
import { storage } from "../storage";
import {
  merchantResiduals,
  midDailyStats,
  healthAlerts,
  followUpSequences,
  contacts,
  deals,
} from "@shared/schema";
import { eq, and, gte, desc, sql, inArray } from "drizzle-orm";
import { createPreferenceAwareNotification } from "./digest-service";
import { classifyTier } from "./churn-score";
import { decideCr06SequenceLifecycle } from "./cr06-promotional-lifecycle-decision";

// ── Default thresholds ────────────────────────────────────────────────────────
const DEFAULT_VOLUME_DROP_PCT = 20;      // trigger when MoM drop exceeds this %
const DEFAULT_CB_RATIO_PCT    = 0.75;    // trigger when chargeback ratio exceeds this %
const COOLDOWN_DAYS           = 30;      // suppress re-alerts for this many days per merchant

// ── Month helpers ─────────────────────────────────────────────────────────────
function toYearMonth(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function priorMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  d.setMonth(d.getMonth() - 1);
  return toYearMonth(d);
}

// ── Threshold reader ──────────────────────────────────────────────────────────
async function getThresholds(): Promise<{ volumeDropPct: number; cbRatioPct: number }> {
  try {
    const [vSetting, cSetting] = await Promise.all([
      storage.getSystemSetting("attrition_volume_drop_threshold_pct"),
      storage.getSystemSetting("attrition_chargeback_ratio_threshold_pct"),
    ]);
    return {
      volumeDropPct: typeof vSetting === "number" ? vSetting : DEFAULT_VOLUME_DROP_PCT,
      cbRatioPct:    typeof cSetting === "number" ? cSetting : DEFAULT_CB_RATIO_PCT,
    };
  } catch {
    return { volumeDropPct: DEFAULT_VOLUME_DROP_PCT, cbRatioPct: DEFAULT_CB_RATIO_PCT };
  }
}

// ── Cooldown check (30-day per merchant per alert type) ───────────────────────
async function isOnCooldown(contactId: number, alertType: "volume_decline" | "chargeback_spike"): Promise<boolean> {
  try {
    const cutoff = new Date(Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
    const rows = await db
      .select({ id: healthAlerts.id })
      .from(healthAlerts)
      .where(
        and(
          eq(healthAlerts.contactId, contactId),
          eq(healthAlerts.alertType, alertType),
          gte(healthAlerts.createdAt, cutoff),
        )
      )
      .limit(1);
    return rows.length > 0;
  } catch {
    return false; // fail-open so we don't silently suppress
  }
}

// ── Find the Reactivation sequence by name ────────────────────────────────────
let _reactivationSeqId: number | null | undefined = undefined; // undefined = not yet resolved

async function resolveReactivationSequenceId(): Promise<number | null> {
  if (_reactivationSeqId !== undefined) return _reactivationSeqId;
  try {
    const seqs = await storage.getFollowUpSequences();
    const match = seqs.find(
      (s: any) => s.name?.includes("Reactivation") || s.name?.includes("Cold Lead Revival")
    );
    _reactivationSeqId = match?.id ?? null;
    return _reactivationSeqId;
  } catch {
    _reactivationSeqId = null;
    return null;
  }
}

// ── Resolve the deal owner email for a contact ────────────────────────────────
async function resolveDealOwner(contactId: number): Promise<string | null> {
  try {
    const dealsForContact = await storage.getDealsByContact(contactId);
    // Prefer the most-recent active deal owner
    const sorted = dealsForContact
      .filter((d: any) => !d.archivedAt)
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return sorted[0]?.owner ?? null;
  } catch {
    return null;
  }
}

// ── Core per-merchant trigger ─────────────────────────────────────────────────
interface TriggerResult {
  contactId: number;
  merchantName: string;
  reasons: string[];
  volumeDropPct?: number;
  chargebackRatioPct?: number;
}

async function triggerAttritionAlert(
  contactId: number,
  merchantName: string,
  reasons: string[],
  details: { volumeDropPct?: number; chargebackRatioPct?: number },
): Promise<void> {
  const contact = await storage.getContact(contactId).catch(() => null);
  if (!contact) return;

  const displayName =
    merchantName ||
    contact.companyName ||
    [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
    `Contact #${contactId}`;

  const reasonSummary = reasons.join("; ");
  const alertType: "volume_decline" | "chargeback_spike" =
    details.volumeDropPct !== undefined ? "volume_decline" : "chargeback_spike";

  // 1. Health alert (used for cooldown tracking + retention campaign pickup)
  await storage.createHealthAlert({
    contactId,
    alertType,
    severity: "urgent",
    title: `Churn Signal: ${displayName}`,
    description: `Attrition monitor detected: ${reasonSummary}`,
    metric: alertType === "volume_decline" ? "volume_mom_pct" : "chargeback_ratio_pct",
    currentValue: alertType === "volume_decline"
      ? `${details.volumeDropPct?.toFixed(1)}%`
      : `${details.chargebackRatioPct?.toFixed(3)}%`,
    threshold: alertType === "volume_decline"
      ? `>${DEFAULT_VOLUME_DROP_PCT}% drop`
      : `>${DEFAULT_CB_RATIO_PCT}% ratio`,
    status: "active",
  }).catch(e => console.error(`[AttritionMonitor] createHealthAlert error for contact ${contactId}:`, e));

  // 2. Update contact churnRiskTier to "High" (unless already Critical)
  const currentTier = contact.churnRiskTier;
  if (currentTier !== "Critical") {
    await storage.updateContact(contactId, { churnRiskTier: "High" }).catch(() => {});
  }

  // 3. Upsert merchantHealthScore
  try {
    const existing = await storage.getMerchantHealthScoreByContact(contactId);
    const newTier = (currentTier === "Critical") ? "Critical" : "High";
    await storage.upsertMerchantHealthScore({
      contactId,
      churnScore: existing?.churnScore ?? 75,
      riskTier: newTier,
      volumeTrendScore: details.volumeDropPct !== undefined ? Math.min(30, Math.round(details.volumeDropPct / 2)) : (existing?.volumeTrendScore ?? 0),
      chargebackTrendScore: details.chargebackRatioPct !== undefined ? 25 : (existing?.chargebackTrendScore ?? 0),
      ticketVelocityScore: existing?.ticketVelocityScore ?? 0,
      npsScore: existing?.npsScore ?? 0,
      portalActivityScore: existing?.portalActivityScore ?? 0,
      outreachResponseScore: existing?.outreachResponseScore ?? 0,
      overrideScore: existing?.overrideScore ?? null,
      overrideNote: existing?.overrideNote ?? null,
      overriddenAt: existing?.overriddenAt ?? null,
      overriddenBy: existing?.overriddenBy ?? null,
      retentionCampaignTriggered: false,
      agentNotified: false,
    });
  } catch (e) {
    console.error(`[AttritionMonitor] upsertMerchantHealthScore error for contact ${contactId}:`, e);
  }

  // 4. Create urgent rep task
  const dealOwner = await resolveDealOwner(contactId);
  const dueDate = new Date(Date.now() + 24 * 60 * 60 * 1000); // due tomorrow

  await storage.createAuthorityTask({
    contactId,
    title: `Churn Signal — ${displayName}`,
    description:
      `Attrition monitor alert:\n${reasons.map(r => `• ${r}`).join("\n")}\n\n` +
      `Recommended action: reach out within 24 hours to understand what changed and offer support. ` +
      `Consider scheduling a rate review or processing consultation.`,
    assignedTo: dealOwner ?? undefined,
    dueDate,
    priority: "urgent",
    status: "pending",
    source: "attrition_monitor",
    automationKey: `attrition_monitor_${contactId}_${toYearMonth(new Date())}`,
  }).catch(e => console.error(`[AttritionMonitor] createTask error for contact ${contactId}:`, e));

  // 5. Enroll in Reactivation sequence (best-effort — sequence must be active)
  try {
    const seqId = await resolveReactivationSequenceId();
    if (seqId !== null) {
      const sequence = await storage.getFollowUpSequence(seqId);
      if (sequence && decideCr06SequenceLifecycle(sequence).allowed) await storage.createSequenceEnrollment({
        contactId,
        sequenceId: seqId,
        status: "active",
        currentStep: 0,
      });
    }
  } catch (e: any) {
    const msg = String(e?.message ?? "").toLowerCase();
    // "paused/inactive sequence" and "already enrolled" are expected — do not surface as errors
    if (!msg.includes("enrollment blocked") && !msg.includes("already enrolled") && !msg.includes("not found")) {
      console.error(`[AttritionMonitor] Sequence enrollment error for contact ${contactId}:`, e);
    }
  }
}

// ── Main exported function ────────────────────────────────────────────────────
export interface AttritionMonitorResult {
  analysed:  number;
  triggered: number;
  skippedCooldown: number;
  errors:    number;
  triggeredMerchants: { merchantName: string; reasons: string[] }[];
}

export async function runAttritionAnalysis(): Promise<AttritionMonitorResult> {
  const result: AttritionMonitorResult = {
    analysed:  0,
    triggered: 0,
    skippedCooldown: 0,
    errors:    0,
    triggeredMerchants: [],
  };

  try {
    const now        = new Date();
    const curMonth   = toYearMonth(now);
    const prevMonth  = priorMonth(curMonth);

    const { volumeDropPct: volDropThreshold, cbRatioPct: cbThreshold } = await getThresholds();

    // ── 1. Volume analysis via merchant_residuals ─────────────────────────────
    // Fetch current and prior month rows for contacts that have a contactId
    const [curRows, prevRows] = await Promise.all([
      db.select({
        contactId:    merchantResiduals.contactId,
        merchantName: merchantResiduals.merchantName,
        mid:          merchantResiduals.merchantMid,
        volume:       merchantResiduals.volume,
        transactions: merchantResiduals.transactions,
      })
      .from(merchantResiduals)
      .where(and(eq(merchantResiduals.month, curMonth), sql`${merchantResiduals.contactId} IS NOT NULL`)),

      db.select({
        contactId:    merchantResiduals.contactId,
        volume:       merchantResiduals.volume,
        transactions: merchantResiduals.transactions,
      })
      .from(merchantResiduals)
      .where(and(eq(merchantResiduals.month, prevMonth), sql`${merchantResiduals.contactId} IS NOT NULL`)),
    ]);

    // Build a map: contactId → prior volume
    const prevVolumeByContact = new Map<number, number>();
    for (const r of prevRows) {
      if (r.contactId === null) continue;
      const existing = prevVolumeByContact.get(r.contactId) ?? 0;
      prevVolumeByContact.set(r.contactId, existing + (parseFloat(r.volume ?? "0") || 0));
    }

    // Aggregate current month by contact (multiple MIDs per contact)
    const curByContact = new Map<number, { volume: number; merchantName: string; mid: string | null }>();
    for (const r of curRows) {
      if (r.contactId === null) continue;
      const existing = curByContact.get(r.contactId);
      curByContact.set(r.contactId, {
        volume: (existing?.volume ?? 0) + (parseFloat(r.volume ?? "0") || 0),
        merchantName: r.merchantName ?? existing?.merchantName ?? "",
        mid: r.mid ?? existing?.mid ?? null,
      });
    }

    // ── 2. Process each contact with residual data ────────────────────────────
    for (const [contactId, curData] of curByContact) {
      result.analysed++;
      try {
        const reasons: string[] = [];
        const details: { volumeDropPct?: number; chargebackRatioPct?: number } = {};

        const prevVol = prevVolumeByContact.get(contactId) ?? 0;
        const curVol  = curData.volume;

        // Volume drop check
        if (prevVol > 0 && curVol < prevVol) {
          const dropPct = ((prevVol - curVol) / prevVol) * 100;
          if (dropPct >= volDropThreshold) {
            reasons.push(
              `Processing volume dropped ${dropPct.toFixed(1)}% MoM ` +
              `($${prevVol.toLocaleString()} → $${curVol.toLocaleString()})`
            );
            details.volumeDropPct = dropPct;
          }
        }

        // Chargeback ratio check (from midDailyStats for the current calendar month)
        if (curData.mid) {
          try {
            const monthStart = `${curMonth}-01`;
            const cbStats = await db
              .select({
                txCount:         midDailyStats.txCount,
                chargebackCount: midDailyStats.chargebackCount,
              })
              .from(midDailyStats)
              .where(
                and(
                  eq(midDailyStats.mid, curData.mid),
                  gte(midDailyStats.date, monthStart),
                )
              );

            const totalTx = cbStats.reduce((s, r) => s + (r.txCount ?? 0), 0);
            const totalCb = cbStats.reduce((s, r) => s + (r.chargebackCount ?? 0), 0);
            if (totalTx > 0) {
              const ratioPct = (totalCb / totalTx) * 100;
              if (ratioPct >= cbThreshold) {
                reasons.push(
                  `Chargeback ratio is ${ratioPct.toFixed(3)}% ` +
                  `(${totalCb} chargebacks / ${totalTx} transactions) — threshold ${cbThreshold}%`
                );
                details.chargebackRatioPct = ratioPct;
              }
            }
          } catch {
            // chargeback check is best-effort per MID
          }
        }

        if (reasons.length === 0) continue; // no signal

        // Cooldown check — use the most prominent alert type
        const alertType: "volume_decline" | "chargeback_spike" =
          details.volumeDropPct !== undefined ? "volume_decline" : "chargeback_spike";

        if (await isOnCooldown(contactId, alertType)) {
          result.skippedCooldown++;
          continue;
        }

        // Fire
        await triggerAttritionAlert(contactId, curData.merchantName, reasons, details);

        result.triggered++;
        result.triggeredMerchants.push({
          merchantName: curData.merchantName || `Contact #${contactId}`,
          reasons,
        });
      } catch (err) {
        result.errors++;
        console.error(`[AttritionMonitor] Error processing contact ${contactId}:`, err);
      }
    }

    // ── 3. Admin/manager digest notification ──────────────────────────────────
    if (result.triggered > 0) {
      const summary = result.triggeredMerchants
        .map(m => `• ${m.merchantName}: ${m.reasons[0]}`)
        .join("\n");

      await createPreferenceAwareNotification(
        {
          channel: "internal",
          title: `⚠️ ${result.triggered} merchant${result.triggered > 1 ? "s" : ""} showing churn signals`,
          message:
            `The attrition monitor flagged the following accounts today:\n\n${summary}\n\n` +
            `Rep tasks have been created and each account has been enrolled in the Reactivation sequence.`,
          type: "warning",
          metadata: {
            eventType:        "attrition_monitor_digest",
            triggeredCount:   result.triggered,
            merchants:        result.triggeredMerchants,
          } as any,
        },
        "attrition_monitor_digest",
      ).catch(e => console.error("[AttritionMonitor] Digest notification error:", e));
    }

    console.log(
      `[AttritionMonitor] analysed=${result.analysed} triggered=${result.triggered} ` +
      `cooldown_skipped=${result.skippedCooldown} errors=${result.errors}`
    );
  } catch (err) {
    console.error("[AttritionMonitor] Fatal error:", err);
  }

  return result;
}
