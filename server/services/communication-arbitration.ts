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
 */

import { storage } from "../storage";

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

// ─── Channel-to-audit-action mapping ─────────────────────────────────────────

const CHANNEL_SEND_ACTIONS: Record<string, string[]> = {
  email: ["email_sent", "outbound_email_sent", "sequence_email_sent", "transactional_email_sent"],
  sms:   ["sms_sent", "outbound_sms_sent", "sequence_sms_sent"],
  ringless_vm: ["rvm_sent", "voicemail_sent", "ringless_vm_sent"],
  voice: ["call_initiated", "call_completed"],
};

const ALL_HUMAN_TOUCH_ACTIONS = new Set([
  "note_added", "manual_email_sent", "call_logged", "meeting_logged",
  "task_completed", "deal_updated", "contact_updated",
]);

// ─── Window config loader (cached per-tick with 5 min TTL) ───────────────────

let _configCache: {
  humanTouchWindowHours: number;
  autoSendWindowMinutes: number;
  replyPendingWindowHours: number;
  fetchedAt: number;
} | null = null;

async function getArbitrationConfig() {
  const now = Date.now();
  if (_configCache && now - _configCache.fetchedAt < 5 * 60 * 1000) {
    return _configCache;
  }
  const [humanSetting, autoSetting, replySetting] = await Promise.all([
    storage.getSystemSetting("arbitration_human_touch_window_hours").catch(() => null),
    storage.getSystemSetting("arbitration_auto_send_window_minutes").catch(() => null),
    storage.getSystemSetting("arbitration_reply_pending_window_hours").catch(() => null),
  ]);
  _configCache = {
    humanTouchWindowHours: humanSetting ? Number(humanSetting) || DEFAULT_HUMAN_TOUCH_WINDOW_HOURS : DEFAULT_HUMAN_TOUCH_WINDOW_HOURS,
    autoSendWindowMinutes: autoSetting  ? Number(autoSetting)  || DEFAULT_AUTO_SEND_WINDOW_MINUTES  : DEFAULT_AUTO_SEND_WINDOW_MINUTES,
    replyPendingWindowHours: replySetting ? Number(replySetting) || DEFAULT_REPLY_PENDING_WINDOW_HOURS : DEFAULT_REPLY_PENDING_WINDOW_HOURS,
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
 * @returns ArbitrationResult — `suppressed: true` means the send should not proceed.
 */
export async function shouldSuppress(
  contactId: number,
  channel: string,
  opts: {
    skipHumanTouchCheck?: boolean;
    skipAutoSendCheck?: boolean;
  } = {},
): Promise<ArbitrationResult> {
  try {
    const config = await getArbitrationConfig();
    const now = Date.now();

    // Load recent audit logs for this contact (last 48h, capped at 200 rows)
    const since48h = new Date(now - 48 * 60 * 60 * 1000);
    let logs: any[];
    try {
      logs = await storage.getAuditLogs({
        entityType: "contact",
        entityId: contactId,
        startDate: since48h,
        limit: 200,
      });
    } catch {
      // If audit log query fails, fail-open (don't suppress)
      return { suppressed: false };
    }

    // ── Check 1: Recent human touch ──────────────────────────────────────────
    if (!opts.skipHumanTouchCheck) {
      const humanWindowMs = config.humanTouchWindowHours * 60 * 60 * 1000;
      const humanCutoff = now - humanWindowMs;
      const humanTouch = logs.find((l: any) => {
        const ts = l.createdAt ? new Date(l.createdAt).getTime() : 0;
        if (ts < humanCutoff) return false;
        // Explicit actorType = human OR known human actions
        return l.actorType === "human" || ALL_HUMAN_TOUCH_ACTIONS.has(l.action);
      });
      if (humanTouch) {
        const touchedAt = new Date(humanTouch.createdAt);
        const resumeAfter = new Date(touchedAt.getTime() + humanWindowMs);
        return {
          suppressed: true,
          signal: "human_touch",
          reason: `Rep activity on this contact ${Math.round((now - touchedAt.getTime()) / 60000)}min ago — automated send suppressed for ${config.humanTouchWindowHours}h`,
          resumeAfter,
        };
      }
    }

    // ── Check 2: Recent automated send on same channel ───────────────────────
    if (!opts.skipAutoSendCheck) {
      const autoWindowMs = config.autoSendWindowMinutes * 60 * 1000;
      const autoCutoff = now - autoWindowMs;
      const channelActions = new Set(CHANNEL_SEND_ACTIONS[channel] ?? []);
      const recentAutoSend = logs.find((l: any) => {
        const ts = l.createdAt ? new Date(l.createdAt).getTime() : 0;
        return ts >= autoCutoff && l.actorType !== "human" && channelActions.has(l.action);
      });
      if (recentAutoSend) {
        const sentAt = new Date(recentAutoSend.createdAt);
        const resumeAfter = new Date(sentAt.getTime() + autoWindowMs);
        return {
          suppressed: true,
          signal: "recent_auto_send",
          reason: `Automated ${channel} sent to this contact ${Math.round((now - sentAt.getTime()) / 60000)}min ago — waiting ${config.autoSendWindowMinutes}min between sends`,
          resumeAfter,
        };
      }
    }

    // ── Check 3: Open inbound reply without a human response ─────────────────
    const replyWindowMs = config.replyPendingWindowHours * 60 * 60 * 1000;
    const replyCutoff = now - replyWindowMs;
    const inboundReply = logs.find((l: any) => {
      const ts = l.createdAt ? new Date(l.createdAt).getTime() : 0;
      return ts >= replyCutoff && l.action === "inbound_message_processed";
    });
    if (inboundReply) {
      // Check if there's been a human response AFTER the reply
      const replyTs = new Date(inboundReply.createdAt).getTime();
      const humanResponseAfter = logs.find((l: any) => {
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
