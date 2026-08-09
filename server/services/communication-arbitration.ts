/**
 * Communication Arbitration Engine
 *
 * Prevents automated outbound sends from conflicting with recent human activity
 * or recent automated sends on the same channel. Runs as the first gate inside
 * ChannelOrchestrator.checkCompliance() — BEFORE DNC/contactability checks.
 *
 * Suppression windows are configurable via system_settings:
 *   arbitration_human_touch_window_hours  (default: 4)
 *   arbitration_auto_send_window_minutes  (default: 60)
 *   arbitration_reply_pending_window_hours (default: 24)
 *
 * Data sources queried for each signal:
 *   Human touch  → notes table (any rep note) +
 *                  audit_logs with known human-activity actions
 *   Auto-send    → ghl_activity_log (direction=outbound, channel match) +
 *                  audit_logs (sequence worker email/sms actions)
 *   Reply pending → audit_logs (inbound_message_processed)
 */

import { db } from "../db";
import { storage } from "../storage";
import { notes, ghlActivityLog, auditLogs } from "@shared/schema";
import { and, eq, gte, desc } from "drizzle-orm";

// ─── Config defaults ─────────────────────────────────────────────────────────

const DEFAULT_HUMAN_TOUCH_WINDOW_HOURS = 4;
const DEFAULT_AUTO_SEND_WINDOW_MINUTES = 60;
const DEFAULT_REPLY_PENDING_WINDOW_HOURS = 24;

// ─── Result type ─────────────────────────────────────────────────────────────

export interface ArbitrationResult {
  suppressed: boolean;
  reason?: string;
  signal?: "human_touch" | "recent_auto_send" | "reply_pending" | "appointment_proximity";
  resumeAfter?: Date;
}

// ─── Human-touch action names in audit_logs ───────────────────────────────────
// These are the actual action strings written by the application's route handlers.

const HUMAN_TOUCH_AUDIT_ACTIONS = new Set([
  // Rep manual email actions (contacts.ts:2074, activity.ts:267)
  "email_sent_via_composer",
  "email_logged",
  // Call logging, note activity
  "call_logged",
  "task_completed",
  "deal_updated",
  "contact_updated",
  // Legacy/other human-touch actions
  "note_added",
  "manual_email_sent",
  "meeting_logged",
]);

// GHL activity log channel values mapped to arbitration channel strings
const ARBITRATION_TO_GHL_CHANNEL: Record<string, string> = {
  email: "email",
  sms:   "sms",
  // ringless_vm and voice are not tracked in ghl_activity_log; rely on audit_logs
};

// Audit log action names written by the sequence worker / SDR for automated sends
const AUDIT_AUTO_SEND_ACTIONS: Record<string, string[]> = {
  email: [
    "email_sent",
    "outbound_email_sent",
    "sequence_email_sent",
    "transactional_email_sent",
    // Arbitration's own suppression log (excluded via actorType check)
    "sequence_step_deferred_arbitration",
  ],
  sms: [
    "sms_sent",
    "outbound_sms_sent",
    "sequence_sms_sent",
  ],
  ringless_vm: ["rvm_sent", "voicemail_sent", "ringless_vm_sent"],
  voice:       ["call_initiated", "call_completed"],
};

// ─── ArbitrationConfig type ───────────────────────────────────────────────────

interface ArbitrationConfig {
  humanTouchWindowHours: number;
  autoSendWindowMinutes: number;
  replyPendingWindowHours: number;
  fetchedAt: number;
}

// ─── Window config loader (cached per-tick with 5 min TTL) ───────────────────

let _configCache: ArbitrationConfig | null = null;

async function getArbitrationConfig(): Promise<ArbitrationConfig> {
  const now = Date.now();
  if (_configCache && now - _configCache.fetchedAt < 5 * 60 * 1000) {
    return _configCache;
  }
  const [humanSetting, autoSetting, replySetting] = await Promise.all([
    storage.getSystemSetting("arbitration_human_touch_window_hours").catch(() => null),
    storage.getSystemSetting("arbitration_auto_send_window_minutes").catch(() => null),
    storage.getSystemSetting("arbitration_reply_pending_window_hours").catch(() => null),
  ]);

  // Use null-check (not truthiness) so that an admin-configured value of 0
  // is honoured — e.g. setting humanTouchWindowHours=0 disables that gate.
  function parseWindow(raw: unknown, defaultVal: number): number {
    if (raw === null || raw === undefined) return defaultVal;
    const n = Number(raw);
    return isNaN(n) ? defaultVal : n;
  }

  _configCache = {
    humanTouchWindowHours:    parseWindow(humanSetting,  DEFAULT_HUMAN_TOUCH_WINDOW_HOURS),
    autoSendWindowMinutes:    parseWindow(autoSetting,   DEFAULT_AUTO_SEND_WINDOW_MINUTES),
    replyPendingWindowHours:  parseWindow(replySetting,  DEFAULT_REPLY_PENDING_WINDOW_HOURS),
    fetchedAt: now,
  };
  return _configCache;
}

// ─── Core arbitration function ────────────────────────────────────────────────

/**
 * Evaluate whether an automated outbound send should be suppressed.
 *
 * @param contactId  The contact the send is targeting.
 * @param channel    "email" | "sms" | "ringless_vm" | "voice"
 * @param opts.skipHumanTouchCheck  Skip the human-touch signal (e.g. transactional sends).
 * @param opts.skipAutoSendCheck    Skip the recent-auto-send signal.
 * @param opts._logsForTest  @internal Test-only: pre-built audit log objects, bypasses DB query.
 * @param opts._configOverrideForTest  @internal Test-only: override window config without DB.
 * @returns ArbitrationResult — `suppressed: true` means the send should not proceed.
 */
export async function shouldSuppress(
  contactId: number,
  channel: string,
  opts: {
    skipHumanTouchCheck?: boolean;
    skipAutoSendCheck?: boolean;
    /** @internal Test-only: provide audit logs directly, bypassing DB queries. */
    _logsForTest?: Array<{ action: string; actorType: string; createdAt: Date | string }>;
    /** @internal Test-only: override window config directly, bypassing system_settings. */
    _configOverrideForTest?: Partial<ArbitrationConfig>;
  } = {},
): Promise<ArbitrationResult> {
  try {
    const baseConfig = await getArbitrationConfig();
    const config: ArbitrationConfig = {
      ...baseConfig,
      ...opts._configOverrideForTest,
      fetchedAt: baseConfig.fetchedAt,
    };
    const now = Date.now();
    const since48h = new Date(now - 48 * 60 * 60 * 1000);

    // ── Check 1: Recent human touch ──────────────────────────────────────────
    if (!opts.skipHumanTouchCheck && config.humanTouchWindowHours > 0) {
      const humanWindowMs = config.humanTouchWindowHours * 60 * 60 * 1000;
      const humanCutoff = now - humanWindowMs;

      let humanTouchAt: Date | null = null;

      if (opts._logsForTest !== undefined) {
        // Test-only path: check injected logs
        const hit = opts._logsForTest.find(l => {
          const ts = new Date(l.createdAt).getTime();
          return ts >= humanCutoff && (l.actorType === "human" || HUMAN_TOUCH_AUDIT_ACTIONS.has(l.action));
        });
        if (hit) humanTouchAt = new Date(hit.createdAt);
      } else {
        // Production path: check the notes table first (rep notes have no audit event)
        try {
          const recentNote = await db.select({ createdAt: notes.createdAt })
            .from(notes)
            .where(and(
              eq(notes.entityType, "contact"),
              eq(notes.entityId, contactId),
              gte(notes.createdAt, new Date(humanCutoff)),
            ))
            .orderBy(desc(notes.createdAt))
            .limit(1);
          if (recentNote[0]) {
            humanTouchAt = new Date(recentNote[0].createdAt!);
          }
        } catch {
          // Non-fatal: fail-open for this sub-check
        }

        // Also check audit_logs for other human-activity actions
        if (!humanTouchAt) {
          try {
            const auditHit = await storage.getAuditLogs({
              entityType: "contact",
              entityId: contactId,
              startDate: new Date(humanCutoff),
              limit: 50,
            });
            const match = auditHit.find(l =>
              l.actorType === "human" || HUMAN_TOUCH_AUDIT_ACTIONS.has(l.action)
            );
            if (match) humanTouchAt = new Date(match.createdAt!);
          } catch {
            // Non-fatal: fail-open
          }
        }
      }

      if (humanTouchAt) {
        const resumeAfter = new Date(humanTouchAt.getTime() + humanWindowMs);
        return {
          suppressed: true,
          signal: "human_touch",
          reason: `Rep activity on this contact ${Math.round((now - humanTouchAt.getTime()) / 60000)}min ago — automated send suppressed for ${config.humanTouchWindowHours}h`,
          resumeAfter,
        };
      }
    }

    // ── Check 2: Recent automated send on same channel ───────────────────────
    if (!opts.skipAutoSendCheck && config.autoSendWindowMinutes > 0) {
      const autoWindowMs = config.autoSendWindowMinutes * 60 * 1000;
      const autoCutoff = now - autoWindowMs;

      let recentAutoSendAt: Date | null = null;

      if (opts._logsForTest !== undefined) {
        // Test-only path: check injected logs
        const auditActions = new Set(AUDIT_AUTO_SEND_ACTIONS[channel] ?? []);
        const hit = opts._logsForTest.find(l => {
          const ts = new Date(l.createdAt).getTime();
          return ts >= autoCutoff && l.actorType !== "human" && auditActions.has(l.action);
        });
        if (hit) recentAutoSendAt = new Date(hit.createdAt);
      } else {
        // Production path 1: ghl_activity_log (most authoritative for GHL sends)
        const ghlChannel = ARBITRATION_TO_GHL_CHANNEL[channel];
        if (ghlChannel) {
          try {
            const ghlHit = await db.select({ createdAt: ghlActivityLog.createdAt })
              .from(ghlActivityLog)
              .where(and(
                eq(ghlActivityLog.contactId, contactId),
                eq(ghlActivityLog.direction, "outbound"),
                eq(ghlActivityLog.channel, ghlChannel),
                gte(ghlActivityLog.createdAt, new Date(autoCutoff)),
              ))
              .orderBy(desc(ghlActivityLog.createdAt))
              .limit(1);
            if (ghlHit[0]) recentAutoSendAt = new Date(ghlHit[0].createdAt!);
          } catch {
            // Non-fatal: fall through to audit_logs check
          }
        }

        // Production path 2: audit_logs (sequence worker, SMTP, etc.)
        if (!recentAutoSendAt) {
          const auditActions = AUDIT_AUTO_SEND_ACTIONS[channel] ?? [];
          try {
            const auditRows = await storage.getAuditLogs({
              entityType: "contact",
              entityId: contactId,
              startDate: new Date(autoCutoff),
              limit: 50,
            });
            const match = auditRows.find(l => {
              return l.actorType !== "human" && auditActions.includes(l.action);
            });
            if (match) recentAutoSendAt = new Date(match.createdAt!);
          } catch {
            // Non-fatal
          }
        }
      }

      if (recentAutoSendAt) {
        const resumeAfter = new Date(recentAutoSendAt.getTime() + autoWindowMs);
        return {
          suppressed: true,
          signal: "recent_auto_send",
          reason: `Automated ${channel} sent to this contact ${Math.round((now - recentAutoSendAt.getTime()) / 60000)}min ago — waiting ${config.autoSendWindowMinutes}min between sends`,
          resumeAfter,
        };
      }
    }

    // ── Check 3: Open inbound reply without a human response ─────────────────
    if (config.replyPendingWindowHours > 0 && opts._logsForTest === undefined) {
      // Only run in production — test path uses _logsForTest to inject scenarios
      const replyWindowMs = config.replyPendingWindowHours * 60 * 60 * 1000;
      try {
        const recentLogs = await storage.getAuditLogs({
          entityType: "contact",
          entityId: contactId,
          startDate: since48h,
          limit: 200,
        });
        const replyCutoff = now - replyWindowMs;
        const inboundReply = recentLogs.find((l: any) => {
          const ts = l.createdAt ? new Date(l.createdAt).getTime() : 0;
          return ts >= replyCutoff && l.action === "inbound_message_processed";
        });
        if (inboundReply) {
          const replyTs = new Date(inboundReply.createdAt as Date | string).getTime();
          const humanResponseAfter = recentLogs.find((l: any) => {
            const ts = l.createdAt ? new Date(l.createdAt).getTime() : 0;
            return ts > replyTs && l.actorType === "human";
          });
          if (!humanResponseAfter) {
            return {
              suppressed: true,
              signal: "reply_pending",
              reason: `Unanswered inbound reply from this contact — human response required before resuming automation`,
              resumeAfter: new Date(replyTs + replyWindowMs),
            };
          }
        }
      } catch {
        // Non-fatal
      }
    } else if (config.replyPendingWindowHours > 0 && opts._logsForTest !== undefined) {
      // Test path: check injected logs for inbound reply signal
      const replyWindowMs = config.replyPendingWindowHours * 60 * 60 * 1000;
      const replyCutoff = now - replyWindowMs;
      const inboundReply = opts._logsForTest.find(l => {
        const ts = new Date(l.createdAt).getTime();
        return ts >= replyCutoff && (l.action as string) === "inbound_message_processed";
      });
      if (inboundReply) {
        const replyTs = new Date(inboundReply.createdAt).getTime();
        const humanResponseAfter = opts._logsForTest.find(l => {
          const ts = new Date(l.createdAt).getTime();
          return ts > replyTs && l.actorType === "human";
        });
        if (!humanResponseAfter) {
          return {
            suppressed: true,
            signal: "reply_pending",
            reason: `Unanswered inbound reply from this contact — human response required before resuming automation`,
            resumeAfter: new Date(replyTs + replyWindowMs),
          };
        }
      }
    }

    return { suppressed: false };
  } catch (err) {
    // Fail-open: if arbitration throws, don't block the send
    console.warn("[Arbitration] Error during arbitration check (fail-open):", (err as Error).message);
    return { suppressed: false };
  }
}

/**
 * Log a suppression event to the audit trail so ops can track and tune windows.
 */
export async function logArbitrationSuppression(
  contactId: number,
  channel: string,
  result: ArbitrationResult,
): Promise<void> {
  try {
    await storage.createAuditLog({
      action: "arbitration_suppressed",
      entityType: "contact",
      entityId: contactId,
      details: {
        channel,
        signal: result.signal,
        reason: result.reason,
        resumeAfter: result.resumeAfter?.toISOString(),
      },
    });
  } catch {
    // Non-critical — don't let logging failure block anything
  }
}

/** Invalidate the config cache (useful after admin changes settings). */
export function invalidateArbitrationConfigCache(): void {
  _configCache = null;
}
