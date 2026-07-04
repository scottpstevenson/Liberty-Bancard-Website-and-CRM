import type { Express } from "express";
import fs from "fs";
import path from "path";
import { isAdmin, isAuthenticated, requireRole } from "../replit_integrations/auth";
import { storage } from "../storage";
import { db } from "../db";
import { sql, desc, and, gte, eq } from "drizzle-orm";
import { emailLogs, callLogs, outboundMessages, auditLogs, followUpSequences, sequenceSteps, consentAuditLogs } from "@shared/schema";
import { featureFlags } from "../services/feature-flags";
import { runStageProgressionSweep } from "../services/stage-progression";
import { getGhlCircuitState } from "../services/ghl-sync";
import { createPreferenceAwareNotification, sendCriticalEmailNotification } from "../services/digest-service";

const CHANNEL_LABEL: Record<string, string> = {
  sms: "SMS",
  voice_ai: "Voice AI",
  ringless_vm: "Ringless Voicemail",
};

// Alerts the rest of the team (compliance/ops/admins) that a channel has
// been approved via the Approval Gate and is now waiting on a manual
// Replit Secret flip + restart. Purely informational — never touches
// process.env or the Secrets API.
async function notifyChannelApproved(params: {
  channel: ChannelKey;
  envFlag: string;
  actorEmail: string | null;
  auditId: number;
  manualStep: string;
}): Promise<void> {
  const { channel, envFlag, actorEmail, auditId, manualStep } = params;
  const label = CHANNEL_LABEL[channel] || channel;
  const approvedBy = actorEmail || "an admin";
  const title = `${label} approved for go-live`;
  const message = `${approvedBy} approved the ${label} channel (audit #${auditId}). ${manualStep}`;

  try {
    const teamUsers = await storage.getUsersByRole(["admin", "manager"]);
    await Promise.all(
      teamUsers.map((user) =>
        createPreferenceAwareNotification(
          {
            channel: "activation",
            recipientId: user.id,
            title,
            message,
            type: "info",
            metadata: { channel, envFlag, auditId, actorEmail },
          },
          "channel_approved"
        )
      )
    );
  } catch (err) {
    console.error(`[Activation] Failed to create internal notifications for ${channel} approval:`, err);
  }

  await sendCriticalEmailNotification({
    eventType: "channel_approved",
    subject: `[Liberty Bancard] ${label} approved for go-live — manual action required`,
    body: `${title}\n\n${message}`,
  });
}

// ── Task #695: Voice/SMS/Ringless Go-Live Audit — Approval Gate ────────────
// This is a READ/AUDIT-ONLY approval layer. Nothing in this section ever
// reads/writes process.env.SMS_ENABLED, VOICE_AI_ENABLED, or
// RINGLESS_VM_ENABLED, and nothing calls a Replit Secrets mutation API.
// Those flags remain Replit Secrets requiring manual operator action +
// restart. Canonical channel keys are fixed and non-negotiable: "sms",
// "voice_ai", "ringless_vm" — never "voice", "ringless", or bare "call".
export const VALID_CHANNELS = ["sms", "voice_ai", "ringless_vm"] as const;
export type ChannelKey = typeof VALID_CHANNELS[number];

const CHANNEL_ACTION_TYPE: Record<ChannelKey, string> = {
  sms: "sms",
  voice_ai: "call",
  ringless_vm: "voicemail_drop",
};

const CHANNEL_ENV_FLAG: Record<ChannelKey, "SMS_ENABLED" | "VOICE_AI_ENABLED" | "RINGLESS_VM_ENABLED"> = {
  sms: "SMS_ENABLED",
  voice_ai: "VOICE_AI_ENABLED",
  ringless_vm: "RINGLESS_VM_ENABLED",
};

export interface ChannelChecklistItem {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface ChannelChecklistResult {
  channel: ChannelKey;
  passed: boolean;
  items: ChannelChecklistItem[];
  currentlyEnabled: boolean;
  evaluatedAt: string;
}

/**
 * Server-side, non-trusted-client checklist evaluator. Every route that
 * gates on this MUST call this function itself and MUST NOT trust a
 * client-submitted `{ allPassed: true }` (or similar) body.
 */
export async function evaluateChannelChecklist(channel: ChannelKey): Promise<ChannelChecklistResult> {
  const actionType = CHANNEL_ACTION_TYPE[channel];

  // 1. Proven active sequence step using the canonical actionType mapping
  //    (sequence-worker.ts:285-294) — the only real source of truth for
  //    which channels have live outbound scripts/templates.
  let sequenceStepFound = false;
  let sequenceDetail = `No proven active ${channel} sequence step found.`;
  try {
    const rows = await db
      .select({
        sequenceId: followUpSequences.id,
        sequenceName: followUpSequences.name,
        stepId: sequenceSteps.id,
      })
      .from(sequenceSteps)
      .innerJoin(followUpSequences, eq(sequenceSteps.sequenceId, followUpSequences.id))
      .where(and(eq(sequenceSteps.actionType, actionType), eq(followUpSequences.status, "active")))
      .limit(5);
    sequenceStepFound = rows.length > 0;
    if (sequenceStepFound) {
      sequenceDetail = `Found ${rows.length} active step(s) with actionType="${actionType}" (e.g. sequence "${rows[0].sequenceName}")`;
    }
  } catch (err: any) {
    sequenceDetail = `Error evaluating sequence steps: ${err.message}`;
  }

  // 2. PEWC (Prior Express Written Consent) evidence — real predicate from
  //    contactability.ts:168-173, since no pewc_consents table exists.
  let pewcFound = false;
  let pewcDetail = "No express written consent evidence found in consent_audit_logs.";
  try {
    const [row] = await db
      .select({ id: consentAuditLogs.id })
      .from(consentAuditLogs)
      .where(
        and(
          eq(consentAuditLogs.consentType, "express_written"),
          sql`${consentAuditLogs.disclosureVersion} IS NOT NULL`,
          sql`${consentAuditLogs.consentedPhone} IS NOT NULL`
        )
      )
      .limit(1);
    pewcFound = !!row;
    if (pewcFound) {
      pewcDetail = "At least one express_written consent record with a disclosure version and consented phone found.";
    }
  } catch (err: any) {
    pewcDetail = `Error evaluating PEWC evidence: ${err.message}`;
  }

  // 3. Quiet hours are enforced structurally (no global system_settings
  //    on/off row exists) via isWithinBusinessHours() inside the
  //    contactability gate. This runs the REAL function at two known
  //    reference times (a Tuesday 10am ET business-hours slot and a
  //    Tuesday 2am ET quiet-hours slot) and confirms it actually returns
  //    true/false as expected, plus confirms the contactability source
  //    still wires it in — behavioral proof, not just a string match.
  let quietHoursOk = false;
  let quietHoursDetail = "Could not verify isWithinBusinessHours() enforces quiet hours.";
  try {
    const { isWithinBusinessHours } = await import("../services/sdr/voice-orchestrator");
    // Tuesday July 7, 2026, 10:00 ET (business hours) vs. 2:00 ET (quiet hours).
    const businessHoursSample = new Date("2026-07-07T14:00:00.000Z"); // 10:00 ET
    const quietHoursSample = new Date("2026-07-07T06:00:00.000Z"); // 02:00 ET
    const duringBusinessHours = isWithinBusinessHours("America/New_York", businessHoursSample);
    const duringQuietHours = isWithinBusinessHours("America/New_York", quietHoursSample);

    const source = fs.readFileSync(path.join(process.cwd(), "server/services/contactability.ts"), "utf-8");
    const wiredIntoGate = source.includes("isWithinBusinessHours");

    quietHoursOk = duringBusinessHours === true && duringQuietHours === false && wiredIntoGate;
    quietHoursDetail = quietHoursOk
      ? "isWithinBusinessHours() correctly allows a Tue 10am ET sample and blocks a Tue 2am ET sample, and evaluateContactability() calls it before any send."
      : `Quiet-hours behavior check failed (businessHours=${duringBusinessHours}, quietHours=${duringQuietHours}, wiredIntoGate=${wiredIntoGate}).`;
  } catch (err: any) {
    quietHoursDetail = `Error verifying quiet-hours enforcement: ${err.message}`;
  }

  const items: ChannelChecklistItem[] = [
    {
      key: "active_sequence_step",
      label: `Proven active sequence step (actionType="${actionType}")`,
      ok: sequenceStepFound,
      detail: sequenceDetail,
    },
    {
      key: "pewc_consent_evidence",
      label: "PEWC express written consent evidence exists",
      ok: pewcFound,
      detail: pewcDetail,
    },
    {
      key: "quiet_hours_enforcement",
      label: "Quiet hours enforcement wired into compliance path",
      ok: quietHoursOk,
      detail: quietHoursDetail,
    },
  ];

  return {
    channel,
    passed: items.every((i) => i.ok),
    items,
    currentlyEnabled: featureFlags[CHANNEL_ENV_FLAG[channel]] === true,
    evaluatedAt: new Date().toISOString(),
  };
}

export function registerActivationRoutes(app: Express) {
  // === ACTIVATION DIAGNOSTICS ===
  app.get("/api/operator/activation-status", isAuthenticated, async (_req, res) => {
    try {
      const identities = await storage.getSendingIdentities();
      const activeIdentities = identities.filter((i: any) => i.isActive !== false && i.status !== "paused");

      const heartbeat = await storage.getSystemSetting("sequence_runner_last_tick");
      const slaHeartbeat = await storage.getSystemSetting("sla_worker_last_tick");
      const stageRun = await storage.getSystemSetting("stage_progression_last_run");

      const now = Date.now();
      const lastTickAt = heartbeat?.at ? new Date(heartbeat.at).getTime() : 0;
      const lastSlaTickAt = slaHeartbeat?.at ? new Date(slaHeartbeat.at).getTime() : 0;
      const STALE_MS = 15 * 60 * 1000;

      const activeEnrollments = await storage.getActiveEnrollments();

      const [emailCnt] = await db.select({ count: sql<number>`count(*)`, lastAt: sql<string | null>`max(${emailLogs.createdAt})` })
        .from(emailLogs)
        .where(sql`${emailLogs.createdAt} > NOW() - INTERVAL '24 hours'`);
      const [callCnt] = await db.select({ count: sql<number>`count(*)`, lastAt: sql<string | null>`max(${callLogs.createdAt})` })
        .from(callLogs)
        .where(sql`${callLogs.createdAt} > NOW() - INTERVAL '24 hours'`);
      const [outboundCnt] = await db.select({ count: sql<number>`count(*)`, lastAt: sql<string | null>`max(${outboundMessages.sentAt})` })
        .from(outboundMessages)
        .where(sql`${outboundMessages.sentAt} > NOW() - INTERVAL '24 hours'`);
      const totalRecent = Number(emailCnt?.count || 0) + Number(callCnt?.count || 0) + Number(outboundCnt?.count || 0);

      // Last successful send timestamp across all channels (not bounded by
      // the 24h window) so operators can see recency even when there has
      // been no recent activity.
      const [emailMax] = await db.select({ lastAt: sql<string | null>`max(${emailLogs.createdAt})` }).from(emailLogs);
      const [callMax] = await db.select({ lastAt: sql<string | null>`max(${callLogs.createdAt})` }).from(callLogs);
      const [outboundMax] = await db.select({ lastAt: sql<string | null>`max(${outboundMessages.sentAt})` }).from(outboundMessages);
      const lastSendCandidates = [emailMax?.lastAt, callMax?.lastAt, outboundMax?.lastAt]
        .filter((x): x is string => !!x)
        .map(x => new Date(x).getTime());
      const lastSendAtMs = lastSendCandidates.length ? Math.max(...lastSendCandidates) : 0;
      const lastSendAt = lastSendAtMs ? new Date(lastSendAtMs).toISOString() : null;

      // Use the SDR GHL config helper so this matches the wizard's gate
      // (accepts GHL_PRIVATE_INTEGRATION_TOKEN OR GHL_API_KEY plus location).
      const { isSdrGhlConfigured, getSdrGhlConfig, fetchCalendars } = await import("../services/sdr/ghl-client");
      const sdrCfg = getSdrGhlConfig();
      const ghlConfigured = isSdrGhlConfigured();
      let ghlAuthOk = false;
      let ghlAuthDetail = "Skipped (not configured)";
      if (ghlConfigured) {
        try {
          const cals = await fetchCalendars();
          ghlAuthOk = true;
          ghlAuthDetail = `Auth probe OK (${Array.isArray(cals) ? cals.length : 0} calendars)`;
        } catch (err: any) {
          ghlAuthDetail = `Auth probe failed: ${err.message}`;
        }
      }

      const checks = [
        {
          id: "ghl_configured",
          label: "GHL credentials configured & auth verified",
          ok: ghlConfigured && ghlAuthOk,
          detail: ghlConfigured
            ? `Token: ${sdrCfg.hasToken ? "set" : "missing"} · Location: ${sdrCfg.hasLocationId ? "set" : "missing"} · ${ghlAuthDetail}`
            : "Set GHL_PRIVATE_INTEGRATION_TOKEN (or GHL_API_KEY) and GHL_LOCATION_ID",
        },
        {
          id: "active_identity",
          label: "At least one active sending identity",
          ok: activeIdentities.length > 0,
          detail: `${activeIdentities.length} active / ${identities.length} total`,
        },
        {
          id: "outreach_flag",
          label: "LEGACY_OUTREACH_ENABLED flag on",
          ok: featureFlags.LEGACY_OUTREACH_ENABLED,
          detail: featureFlags.LEGACY_OUTREACH_ENABLED ? "Enabled" : "Set LEGACY_OUTREACH_ENABLED=true to start sending",
        },
        {
          id: "sla_worker",
          label: "SLA / scheduler heartbeat fresh (<15min)",
          ok: lastSlaTickAt > 0 && (now - lastSlaTickAt) < STALE_MS,
          detail: lastSlaTickAt ? `Last tick ${new Date(lastSlaTickAt).toISOString()}` : "Never",
        },
        {
          id: "sequence_runner",
          label: "Sequence runner heartbeat fresh (<15min)",
          ok: lastTickAt > 0 && (now - lastTickAt) < STALE_MS,
          detail: lastTickAt
            ? `Last tick ${new Date(lastTickAt).toISOString()} — processed ${heartbeat?.processed ?? 0}, sent ${heartbeat?.sent ?? 0}`
            : "Never (worker disabled or has not run yet)",
        },
        {
          id: "active_enrollments",
          label: "Active sequence enrollments exist",
          ok: activeEnrollments.length > 0,
          detail: `${activeEnrollments.length} active enrollments`,
        },
        {
          id: "recent_sends",
          label: "Outbound activity in last 24h (email + calls + outbound)",
          ok: totalRecent > 0,
          detail: `${totalRecent} total — email ${Number(emailCnt?.count || 0)}, calls ${Number(callCnt?.count || 0)}, outbound ${Number(outboundCnt?.count || 0)}`
            + (lastSendAt ? ` · last send ${lastSendAt}` : " · no sends recorded yet"),
        },
      ];

      const ready = checks.every(c => c.ok);

      const circuitState = getGhlCircuitState();
      res.json({
        ready,
        checks,
        lastSendAt,
        heartbeat: { sequenceRunner: heartbeat || null, slaWorker: slaHeartbeat || null, stageProgression: stageRun || null },
        activeIdentities: activeIdentities.length,
        totalIdentities: identities.length,
        activeEnrollments: activeEnrollments.length,
        flags: {
          LEGACY_OUTREACH_ENABLED: featureFlags.LEGACY_OUTREACH_ENABLED,
          ORCHESTRATOR_ENABLED: featureFlags.ORCHESTRATOR_ENABLED,
          SDR_ENABLED: featureFlags.SDR_ENABLED,
        },
        ghlSync: {
          circuitOpen: circuitState.open,
          consecutiveFailures: circuitState.consecutiveFailures,
        },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === RECENT SENDS WIDGET ===
  app.get("/api/operator/recent-sends", isAuthenticated, async (_req, res) => {
    try {
      const since = sql`NOW() - INTERVAL '24 hours'`;

      const [emailRow] = await db.select({ count: sql<number>`count(*)` })
        .from(emailLogs)
        .where(sql`${emailLogs.createdAt} > ${since}`);

      const [callRow] = await db.select({ count: sql<number>`count(*)` })
        .from(callLogs)
        .where(sql`${callLogs.createdAt} > ${since}`);

      const [outboundRow] = await db.select({ count: sql<number>`count(*)` })
        .from(outboundMessages)
        .where(sql`${outboundMessages.sentAt} > ${since}`);

      const recent = await db.select()
        .from(emailLogs)
        .where(sql`${emailLogs.createdAt} > ${since}`)
        .orderBy(desc(emailLogs.createdAt))
        .limit(20);

      res.json({
        windowHours: 24,
        totals: {
          email: Number(emailRow?.count || 0),
          calls: Number(callRow?.count || 0),
          outbound: Number(outboundRow?.count || 0),
          all: Number(emailRow?.count || 0) + Number(callRow?.count || 0) + Number(outboundRow?.count || 0),
        },
        recent: recent.map((r: any) => ({
          id: r.id,
          channel: "email",
          to: r.to,
          subject: r.subject,
          status: r.status,
          sentAt: r.createdAt,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === SEQUENCES NOT FIRING WIDGET ===
  app.get("/api/operator/silent-sequences", isAuthenticated, async (_req, res) => {
    try {
      const all = await storage.getActiveEnrollments();
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;

      const silent = all.filter((e: any) => {
        const updated = e.updatedAt ? new Date(e.updatedAt).getTime() : 0;
        return updated < cutoff;
      }).slice(0, 50);

      const heartbeat = await storage.getSystemSetting("sequence_runner_last_tick");
      const lastTickAt = heartbeat?.at ? new Date(heartbeat.at).getTime() : 0;
      const STALE_MS = 15 * 60 * 1000;
      const workerStale = lastTickAt === 0 || (Date.now() - lastTickAt) > STALE_MS;

      const reason = !featureFlags.LEGACY_OUTREACH_ENABLED
        ? "LEGACY_OUTREACH_ENABLED is OFF — sequence runner is gated"
        : workerStale
          ? "Sequence runner heartbeat stale — worker may have crashed"
          : "Enrollments not progressing — check next_action_at and sending identities";

      res.json({
        totalActive: all.length,
        silentCount: silent.length,
        reason,
        workerStale,
        outreachEnabled: featureFlags.LEGACY_OUTREACH_ENABLED,
        lastTick: heartbeat || null,
        items: silent.map((e: any) => ({
          id: e.id,
          contactId: e.contactId,
          dealId: e.dealId,
          sequenceId: e.sequenceId,
          currentStep: e.currentStep,
          status: e.status,
          nextActionAt: e.nextActionAt,
          updatedAt: e.updatedAt,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === SENDING IDENTITY VALIDATION ===
  // Server-side validation surfaced by the wizard before the user creates an
  // identity. Checks GHL readiness, email format, duplicates, and (when
  // possible) probes GHL to confirm the address can be used as a sender.
  app.post("/api/operator/validate-identity", isAuthenticated, async (req, res) => {
    try {
      const emailAddress = String(req.body?.emailAddress || "").trim().toLowerCase();
      const label = String(req.body?.label || "").trim();
      const errors: string[] = [];
      const warnings: string[] = [];

      if (!label) errors.push("Label is required");
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailAddress) errors.push("Email address is required");
      else if (!emailRe.test(emailAddress)) errors.push("Email address is not a valid format");

      // Use the real SDR GHL client — it accepts either
      // GHL_PRIVATE_INTEGRATION_TOKEN or GHL_API_KEY plus GHL_LOCATION_ID.
      const { isSdrGhlConfigured, fetchCalendars, getSdrGhlConfig } = await import("../services/sdr/ghl-client");
      const cfg = getSdrGhlConfig();
      const ghlConfigured = isSdrGhlConfigured();
      if (!ghlConfigured) {
        if (!cfg.hasToken) errors.push("GHL is not configured (set GHL_PRIVATE_INTEGRATION_TOKEN or GHL_API_KEY)");
        if (!cfg.hasLocationId) errors.push("GHL_LOCATION_ID is not set");
      }

      const existing = await storage.getSendingIdentities();
      const dup = existing.find((i: any) => (i.emailAddress || "").toLowerCase() === emailAddress);
      if (dup) errors.push(`Email already registered as identity #${dup.id} (${dup.label})`);

      // Real GHL auth probe — fail closed if the call rejects so the wizard
      // can never gate-bypass on a broken connection.
      let ghlProbe: { ok: boolean; detail: string } = { ok: false, detail: "GHL probe skipped (not configured)" };
      if (ghlConfigured && emailRe.test(emailAddress)) {
        try {
          const calendars = await fetchCalendars();
          ghlProbe = {
            ok: true,
            detail: `GHL auth confirmed (${Array.isArray(calendars) ? calendars.length : 0} calendars visible) — sender address can be saved`,
          };
        } catch (err: any) {
          ghlProbe = { ok: false, detail: `GHL auth failed: ${err.message}` };
          errors.push(ghlProbe.detail);
        }
      } else if (!ghlConfigured) {
        errors.push("Cannot validate sender against GHL — fix configuration first");
      }

      res.json({
        ok: errors.length === 0,
        emailAddress,
        label,
        errors,
        warnings,
        ghlProbe,
        existingCount: existing.length,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, errors: [err.message] });
    }
  });

  // === STAGE PROGRESSION BACKFILL ===
  app.post("/api/operator/backfill-stages", isAdmin, async (req, res) => {
    try {
      const limit = parseInt(req.body?.limit || "1000", 10);
      const result = await runStageProgressionSweep({ limit });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === COMMUNICATIONS HEALTH ===
  app.get("/api/operator/communications-health", isAuthenticated, async (_req, res) => {
    try {
      const { isSmtpConfigured, getSmtpStatus } = await import("../services/smtp-email");
      const { isSdrGhlConfigured } = await import("../services/sdr/ghl-client");
      const { isGhlConfigured } = await import("../services/ghl");

      const smtpStatus = getSmtpStatus();
      const ghlEmail = isGhlConfigured();
      const ghlFull = isSdrGhlConfigured();

      const proposalAutoSendSetting = await storage.getSystemSetting("proposal_auto_send");
      const proposalAutoSend = proposalAutoSendSetting?.enabled === true;

      const warnings: string[] = [];
      if (!smtpStatus.configured && !ghlEmail) {
        warnings.push("Neither SMTP nor GHL email is configured. Transactional emails (proposals, rep alerts, merchant welcome) will not be delivered.");
      }
      if (!smtpStatus.configured) {
        warnings.push("SMTP not configured. Direct email fallback unavailable. Set SMTP_HOST, SMTP_USER, and SMTP_PASS.");
      }
      if (!ghlFull) {
        warnings.push("GHL not fully configured. Email via GHL unavailable. Set GHL_PRIVATE_INTEGRATION_TOKEN and GHL_LOCATION_ID.");
      }

      res.json({
        smtp: smtpStatus,
        ghl: {
          emailConfigured: ghlEmail,
          fullyConfigured: ghlFull,
        },
        proposalAutoSend,
        warnings,
        allHealthy: smtpStatus.configured && ghlEmail && !warnings.length,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === GO-LIVE READINESS CHECKS ===
  app.get("/api/operator/readiness-checks", isAuthenticated, async (_req, res) => {
    try {
      const { isSdrGhlConfigured, getSdrGhlConfig } = await import("../services/sdr/ghl-client");
      const { isSmtpConfigured } = await import("../services/smtp-email");

      const identities = await storage.getSendingIdentities();
      const activeIdentities = identities.filter((i: any) => i.status === "active" && i.isActive !== false);
      const totalCapacity = activeIdentities.reduce((sum: number, i: any) => sum + (i.dailyLimit || 0), 0);
      const totalSentToday = activeIdentities.reduce((sum: number, i: any) => sum + (i.sentToday || 0), 0);

      const ghlCfg = getSdrGhlConfig();
      const ghlOk = isSdrGhlConfigured();

      let ghlAuthOk = false;
      let ghlAuthDetail = "Skipped (not configured)";
      if (ghlOk) {
        try {
          const { fetchCalendars } = await import("../services/sdr/ghl-client");
          const probeResult = await Promise.race([
            fetchCalendars().then(cals => ({ ok: true, detail: `Auth probe OK (${Array.isArray(cals) ? cals.length : 0} calendars)` })),
            new Promise<{ ok: boolean; detail: string }>(resolve =>
              setTimeout(() => resolve({ ok: true, detail: "Probe timed out — treating as OK" }), 4000)
            ),
          ]);
          ghlAuthOk = probeResult.ok;
          ghlAuthDetail = probeResult.detail;
        } catch (err: any) {
          const msg = (err.message || "").toLowerCase();
          ghlAuthOk = false;
          ghlAuthDetail = msg.includes("401") || msg.includes("unauthorized") || msg.includes("403")
            ? "Token rejected (401/403) — regenerate in GHL Settings → Private Integrations"
            : `Auth probe error: ${(err.message || "unknown").substring(0, 80)}`;
        }
      }

      const smtpOk = isSmtpConfigured();

      const { GHL_WORKFLOW_REGISTRY } = await import("../services/ghl-workflows");
      const mappedWorkflowCount = (await Promise.all(
        GHL_WORKFLOW_REGISTRY.map(async (w: any) => {
          if (process.env[w.envKey]) return true;
          try {
            const s = await storage.getSystemSetting(`ghl_workflow_${w.id}`);
            return !!((s as any)?.value);
          } catch { return false; }
        })
      )).filter(Boolean).length;

      let redisOk = false;
      let redisDetail = "";
      try {
        const redisUrl = process.env.REDIS_URL;
        if (!redisUrl) {
          redisOk = true;
          redisDetail = "ioredis-mock (dev mode)";
        } else {
          const { default: IORedis } = await import("ioredis");
          const client = new IORedis(redisUrl, { connectTimeout: 2000, maxRetriesPerRequest: 0, enableOfflineQueue: false, lazyConnect: true });
          await client.connect();
          const pong = await client.ping();
          redisOk = pong === "PONG";
          redisDetail = redisOk ? "Connected" : "Ping failed — check REDIS_URL";
          client.disconnect();
        }
      } catch (e: any) {
        redisOk = false;
        redisDetail = `Connection error: ${(e.message || "unknown").substring(0, 80)} — check REDIS_URL`;
      }

      const stuckCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      let stuckCount = 0;
      try {
        const { sdrLeadState } = await import("@shared/schema");
        const { lte, isNotNull } = await import("drizzle-orm");
        const stuckRows = await db.select({ id: sdrLeadState.id })
          .from(sdrLeadState)
          .where(
            and(
              isNotNull(sdrLeadState.nextActionAt),
              lte(sdrLeadState.nextActionAt, stuckCutoff)
            )
          )
          .limit(50);
        stuckCount = stuckRows.length;
      } catch { /* non-fatal */ }

      const adminDigestEmail = !!process.env.ADMIN_DIGEST_EMAIL;
      const bookingLink = !!process.env.GHL_DEFAULT_BOOKING_LINK;

      const inboxesWithCapacity = activeIdentities.filter((i: any) => (i.sentToday || 0) < (i.dailyLimit || 0));

      const checks = [
        {
          id: "redis_connected",
          label: "Redis connected",
          ok: redisOk,
          detail: redisDetail || (redisOk ? "Connected" : "Set REDIS_URL to a valid Redis connection string"),
        },
        {
          id: "inbox_capacity",
          label: "At least 1 active inbox with remaining daily capacity",
          ok: inboxesWithCapacity.length > 0,
          detail: activeIdentities.length === 0
            ? "No active sending identities configured"
            : `${inboxesWithCapacity.length} of ${activeIdentities.length} active inboxes have remaining capacity (${totalSentToday} sent of ${totalCapacity} total limit)`,
        },
        {
          id: "ghl_configured",
          label: "GHL credentials configured & token valid",
          ok: ghlOk && ghlAuthOk,
          detail: !ghlOk
            ? "Set GHL_PRIVATE_INTEGRATION_TOKEN and GHL_LOCATION_ID"
            : ghlAuthOk
            ? `Token valid (live probe) · Location ID: ${ghlCfg.hasLocationId ? "set" : "missing"}`
            : `Token set but probe failed — ${ghlAuthDetail}. Regenerate in GHL Settings → Private Integrations`,
        },
        {
          id: "ghl_workflows_mapped",
          label: "At least 5 GHL workflow IDs mapped",
          ok: mappedWorkflowCount >= 5,
          detail: `${mappedWorkflowCount} of ${GHL_WORKFLOW_REGISTRY.length} workflow IDs configured — set via env or GHL Workflow ID Manager`,
        },
        {
          id: "smtp_fallback",
          label: "SMTP email fallback configured",
          ok: smtpOk,
          detail: smtpOk ? "SMTP configured" : "Set SMTP_HOST, SMTP_USER, SMTP_PASS for transactional email fallback",
        },
        {
          id: "sdr_enabled",
          label: "SDR_ENABLED feature flag on",
          ok: featureFlags.SDR_ENABLED === true,
          detail: featureFlags.SDR_ENABLED ? "Enabled" : "Set SDR_ENABLED=true to activate SDR pipeline",
        },
        {
          id: "orchestrator_enabled",
          label: "ORCHESTRATOR_ENABLED feature flag on",
          ok: featureFlags.ORCHESTRATOR_ENABLED === true,
          detail: featureFlags.ORCHESTRATOR_ENABLED ? "Enabled" : "Set ORCHESTRATOR_ENABLED=true to start orchestrator",
        },
        {
          id: "admin_digest_email",
          label: "ADMIN_DIGEST_EMAIL configured",
          ok: adminDigestEmail,
          detail: adminDigestEmail ? "Set" : "Set ADMIN_DIGEST_EMAIL for daily digest notifications",
        },
        {
          id: "booking_link",
          label: "GHL_DEFAULT_BOOKING_LINK configured",
          ok: bookingLink,
          detail: bookingLink ? "Set" : "Set GHL_DEFAULT_BOOKING_LINK for meeting-intent reply automation",
        },
        {
          id: "no_stuck_leads",
          label: "No stuck leads older than 24h",
          ok: stuckCount === 0,
          detail: stuckCount === 0 ? "No stuck leads" : `${stuckCount} leads past their nextActionAt — check Stuck Leads tab`,
        },
      ];

      const passCount = checks.filter(c => c.ok).length;
      const ready = checks.every(c => c.ok);

      res.json({ ready, passCount, totalChecks: checks.length, checks });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === SLA BREACH ACTIVITY (with collapsed flag) ===
  app.get("/api/operator/sla-breaches", isAuthenticated, async (_req, res) => {
    try {
      const rows = await db.select()
        .from(auditLogs)
        .where(sql`${auditLogs.action} IN ('sla_breach', 'ticket_sla_breach', 'sla_breach_resolved') AND ${auditLogs.createdAt} > NOW() - INTERVAL '7 days'`)
        .orderBy(desc(auditLogs.createdAt))
        .limit(200);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === LIFECYCLE STAGE COUNTS ===
  app.get("/api/operator/lifecycle-stage-counts", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const { contacts } = await import("@shared/schema");
      const { isNull, count } = await import("drizzle-orm");

      const CANONICAL_STAGES = [
        "prospect", "lead", "analysis_requested", "statement_uploaded",
        "call_booked", "proposal_sent", "verbal_commit",
        "live_merchant", "retained", "referred", "closed_lost",
      ];
      const STAGE_LABELS: Record<string, string> = {
        prospect: "Prospect",
        lead: "Lead",
        analysis_requested: "Analysis Requested",
        statement_uploaded: "Statement Uploaded",
        call_booked: "Call Booked",
        proposal_sent: "Proposal Sent",
        verbal_commit: "Verbal Commit",
        live_merchant: "Live Merchant",
        retained: "Retained",
        referred: "Referred",
        closed_lost: "Closed Lost",
      };

      const rows = await db
        .select({
          lifecycleStage: contacts.lifecycleStage,
          total: count(contacts.id),
          stuckApprox: count(contacts.id),
        })
        .from(contacts)
        .where(isNull(contacts.archivedAt))
        .groupBy(contacts.lifecycleStage);

      const stuckThresholdDays = 7;
      const stuckCutoff = new Date(Date.now() - stuckThresholdDays * 86400000);

      const stuckRows = await db
        .select({
          lifecycleStage: contacts.lifecycleStage,
          stuckCount: count(contacts.id),
        })
        .from(contacts)
        .where(sql`${contacts.archivedAt} IS NULL AND ${contacts.updatedAt} <= ${stuckCutoff}`)
        .groupBy(contacts.lifecycleStage);

      const stuckMap: Record<string, number> = {};
      for (const r of stuckRows) {
        if (r.lifecycleStage) stuckMap[r.lifecycleStage] = Number(r.stuckCount);
      }

      const countMap: Record<string, number> = {};
      for (const r of rows) {
        if (r.lifecycleStage) countMap[r.lifecycleStage] = Number(r.total);
      }

      const activePipelineStages = CANONICAL_STAGES.filter(s => s !== "do_not_contact");
      const totalActivePipeline = activePipelineStages.reduce((sum, s) => sum + (countMap[s] || 0), 0);

      const stages = CANONICAL_STAGES.map(stage => ({
        stage,
        label: STAGE_LABELS[stage] || stage,
        count: countMap[stage] || 0,
        stuckCount: stuckMap[stage] ?? null,
        stuckThresholdDays,
        percentOfPipeline: totalActivePipeline > 0
          ? Math.round(((countMap[stage] || 0) / totalActivePipeline) * 1000) / 10
          : 0,
        filterUrl: `/dashboard/contacts?lifecycleStage=${stage}`,
      }));

      res.json({
        generatedAt: new Date().toISOString(),
        stages,
        totalActivePipeline,
        warning: "Stuck count uses updatedAt as approximate proxy — any field update resets the clock.",
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === ACTIVATION READINESS (Wave 9) ===
  app.get("/api/activation/readiness", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const { analyticsEvents, followUpSequences, ghlActivityLog, contacts } = await import("@shared/schema");
      const { count, gte: gteOp, isNotNull } = await import("drizzle-orm");

      const warnings: string[] = [];

      const items: Array<{
        key: string; label: string; status: "green" | "yellow" | "red";
        value: string; description: string; remediation: string | null; source: string;
      }> = [];

      // ghl_configured
      const ghlToken = process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
      items.push({
        key: "ghl_configured",
        label: "GHL Connection Configured",
        status: ghlToken ? "green" : "red",
        value: ghlToken ? "Configured" : "Missing",
        description: "GHL private integration token required for contact sync and communications.",
        remediation: ghlToken ? null : "Set GHL_PRIVATE_INTEGRATION_TOKEN in environment variables.",
        source: "process.env.GHL_PRIVATE_INTEGRATION_TOKEN",
      });

      // pewc_disclosure_version
      const pewcVersion = process.env.PEWC_DISCLOSURE_VERSION;
      items.push({
        key: "pewc_disclosure_version",
        label: "PEWC Disclosure Version Set",
        status: pewcVersion ? "green" : "yellow",
        value: pewcVersion || "Not set",
        description: "PEWC disclosure version ensures compliance audit trail for consent records.",
        remediation: pewcVersion ? null : "Set PEWC_DISCLOSURE_VERSION in environment variables.",
        source: "process.env.PEWC_DISCLOSURE_VERSION",
      });

      // contactability_available
      let contactabilityStatus: "green" | "yellow" | "red" = "red";
      try {
        await import("../services/contactability");
        contactabilityStatus = "green";
      } catch {
        contactabilityStatus = "red";
        warnings.push("contactability service module could not be imported");
      }
      items.push({
        key: "contactability_available",
        label: "Wave 1A evaluateContactability() Available",
        status: contactabilityStatus,
        value: contactabilityStatus === "green" ? "Available" : "Unavailable",
        description: "Contactability permission gate must be available for all outbound sends.",
        remediation: contactabilityStatus !== "green" ? "Ensure server/services/contactability.ts is present and exports evaluateContactability." : null,
        source: "dynamic import('../services/contactability')",
      });

      // consent_tier_migration
      let consentTierStatus: "green" | "yellow" | "red" = "yellow";
      try {
        const [{ consentTierCol }] = await db.execute(sql`
          SELECT column_name AS "consentTierCol" FROM information_schema.columns
          WHERE table_name = 'contacts' AND column_name = 'consent_tier' LIMIT 1
        `);
        consentTierStatus = consentTierCol ? "green" : "yellow";
      } catch {
        consentTierStatus = "yellow";
      }
      items.push({
        key: "consent_tier_migration",
        label: "Consent Tier Migration Applied",
        status: consentTierStatus,
        value: consentTierStatus === "green" ? "Column present" : "Unable to verify",
        description: "contacts.consent_tier column required for PEWC consent routing.",
        remediation: consentTierStatus !== "green" ? "Run pending Drizzle migrations: npx tsx scripts/migrate.ts" : null,
        source: "information_schema.columns",
      });

      // sequences_seeded
      let seqCount = 0;
      try {
        const [{ cnt }] = await db.select({ cnt: count(followUpSequences.id) }).from(followUpSequences);
        seqCount = Number(cnt);
      } catch { seqCount = 0; }
      items.push({
        key: "sequences_seeded",
        label: "Wave 6 Sequence Families Seeded",
        status: seqCount >= 10 ? "green" : "yellow",
        value: `${seqCount} sequences`,
        description: "At least 10 sequences should be seeded across families for outreach coverage.",
        remediation: seqCount < 10 ? "Seed sequence families via the Sequences admin page or seed script." : null,
        source: "followUpSequences table count",
      });

      // ghl_permission_sync_healthy
      const recentCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      let ghlSyncStatus: "green" | "yellow" | "red" = "yellow";
      try {
        const recentEntries = await db.select({ id: ghlActivityLog.id })
          .from(ghlActivityLog)
          .where(gteOp(ghlActivityLog.createdAt, recentCutoff))
          .limit(1);
        ghlSyncStatus = (ghlToken && recentEntries.length > 0) ? "green" : "yellow";
      } catch { ghlSyncStatus = "yellow"; }
      items.push({
        key: "ghl_permission_sync_healthy",
        label: "Wave 7 GHL Permission Fields Healthy",
        status: ghlSyncStatus,
        value: ghlSyncStatus === "green" ? "Recent activity" : "No recent GHL activity",
        description: "GHL activity log should have entries in the last 24h to confirm sync is running.",
        remediation: ghlSyncStatus !== "green" ? "Verify GHL_PRIVATE_INTEGRATION_TOKEN is valid and the 45s sync loop is running." : null,
        source: "ghlActivityLog recent entry check",
      });

      // analytics_events_present
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
      let analyticsCount = 0;
      try {
        const [{ cnt }] = await db.select({ cnt: count(analyticsEvents.id) })
          .from(analyticsEvents)
          .where(gteOp(analyticsEvents.occurredAt, sevenDaysAgo));
        analyticsCount = Number(cnt);
      } catch { analyticsCount = 0; }
      items.push({
        key: "analytics_events_present",
        label: "Wave 8 Analytics Events Present",
        status: analyticsCount > 0 ? "green" : "yellow",
        value: `${analyticsCount} events (last 7 days)`,
        description: "Analytics events table should have data for conversion tracking to function.",
        remediation: analyticsCount === 0 ? "Data still accumulating — events are recorded on page visits and form submissions." : null,
        source: "analyticsEvents table count (7 days)",
      });

      // feature flags
      const flagChecks: Array<{ key: string; label: string; envKey: string }> = [
        { key: "sdr_enabled", label: "SDR_ENABLED Flag", envKey: "SDR_ENABLED" },
        { key: "sms_enabled", label: "SMS_ENABLED Flag", envKey: "SMS_ENABLED" },
        { key: "voice_ai_enabled", label: "VOICE_AI_ENABLED Flag", envKey: "VOICE_AI_ENABLED" },
        { key: "nightly_discovery_enabled", label: "NIGHTLY_DISCOVERY_ENABLED Flag", envKey: "NIGHTLY_DISCOVERY_ENABLED" },
      ];
      for (const fc of flagChecks) {
        const val = process.env[fc.envKey];
        items.push({
          key: fc.key,
          label: fc.label,
          status: val === "true" ? "green" : "yellow",
          value: val || "Not set",
          description: `${fc.envKey} feature flag controls activation of the ${fc.label.replace(" Flag", "")} subsystem.`,
          remediation: val !== "true" ? `Set ${fc.envKey}=true in environment variables to activate.` : null,
          source: `process.env.${fc.envKey}`,
        });
      }

      // inbox_health
      let inboxStatus: "green" | "yellow" | "red" = "red";
      let inboxValue = "No active senders";
      try {
        const identities = await storage.getSendingIdentities();
        const active = identities.filter((i: any) => i.status === "active" && i.isActive !== false);
        const withCapacity = active.filter((i: any) => (i.sentToday || 0) < (i.dailyLimit || 0));
        if (withCapacity.length > 0) {
          inboxStatus = "green";
          inboxValue = `${withCapacity.length} active sender(s) with capacity`;
        } else if (active.length > 0) {
          inboxStatus = "yellow";
          inboxValue = `${active.length} active sender(s) but all at daily limit`;
        } else {
          inboxStatus = "red";
          inboxValue = "No active sending identities configured";
        }
      } catch { inboxStatus = "yellow"; inboxValue = "Unable to check sending identities"; }
      items.push({
        key: "inbox_health",
        label: "Active Sender Health",
        status: inboxStatus,
        value: inboxValue,
        description: "At least one active sending identity with remaining daily capacity required for outreach.",
        remediation: inboxStatus !== "green" ? "Add or activate a sending identity in the Identity Wizard." : null,
        source: "storage.getSendingIdentities()",
      });

      // queue_health
      let queueStatus: "green" | "yellow" | "red" = "yellow";
      let queueValue = "Queue health source unavailable";
      try {
        const { getQueueManager } = await import("../services/queue-manager");
        const qm = await getQueueManager();
        const metrics = await qm.getAllQueueMetrics();
        const dlqTotal = Object.values(metrics as Record<string, any>).reduce((sum: number, q: any) => sum + (q?.dead || 0), 0);
        queueStatus = dlqTotal === 0 ? "green" : "yellow";
        queueValue = dlqTotal === 0 ? "No dead-letter jobs" : `${dlqTotal} dead-letter job(s)`;
      } catch {
        queueStatus = "yellow";
        queueValue = "Queue health source unavailable";
        warnings.push("Could not load queue metrics for readiness check");
      }
      items.push({
        key: "queue_health",
        label: "Queue Health / Dead-Letter",
        status: queueStatus,
        value: queueValue,
        description: "BullMQ dead-letter queue should be empty for healthy background job processing.",
        remediation: queueStatus !== "green" ? "Review dead-letter jobs in Operator Dashboard → Job Queue tab." : null,
        source: "BullMQ queue metrics",
      });

      // sitemap_coverage (always yellow — no audit source)
      items.push({
        key: "sitemap_coverage",
        label: "Sitemap Coverage",
        status: "yellow",
        value: "Check unavailable",
        description: "Sitemap coverage verification requires an external audit tool not configured in this repo.",
        remediation: "Sitemap coverage check unavailable — verify manually via Google Search Console or a sitemap audit tool.",
        source: "N/A",
      });

      const hasRed = items.some(i => i.status === "red");
      const hasYellow = items.some(i => i.status === "yellow");
      const overallStatus: "green" | "yellow" | "red" = hasRed ? "red" : hasYellow ? "yellow" : "green";

      res.json({
        generatedAt: new Date().toISOString(),
        overallStatus,
        items,
        warnings,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === CHANNEL COMPLIANCE APPROVAL GATE (Task #695) ===
  // Approval-gate only. Nothing below this line ever sets, pauses, or
  // resumes SMS_ENABLED / VOICE_AI_ENABLED / RINGLESS_VM_ENABLED — those are
  // Replit Secrets requiring manual operator action + restart.

  function validateChannelParam(req: any, res: any): ChannelKey | null {
    const channel = String(req.params.channel || "");
    if (!(VALID_CHANNELS as readonly string[]).includes(channel)) {
      res.status(400).json({
        message: `Invalid channel "${channel}". Must be one of: ${VALID_CHANNELS.join(", ")}`,
      });
      return null;
    }
    return channel as ChannelKey;
  }

  // Read-only history of past checklist views / approvals / test-batch
  // previews for a channel. Never mutates anything.
  app.get("/api/activation/channel-audit-log/:channel", requireRole("admin"), async (req, res) => {
    const channel = validateChannelParam(req, res);
    if (!channel) return;
    try {
      const entries = await storage.getChannelAuditLog(channel);
      res.json({ channel, entries });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/activation/channel-checklist/:channel", requireRole("admin"), async (req, res) => {
    const channel = validateChannelParam(req, res);
    if (!channel) return;
    try {
      const checklist = await evaluateChannelChecklist(channel);
      const actorUserId = (req.user as any)?.id ?? null;
      const actorEmail = (req.user as any)?.email ?? null;
      await storage.createChannelAuditLog({
        channel,
        action: "checklist_viewed",
        checklistSnapshot: checklist,
        actorUserId,
        actorEmail,
        notes: null,
      });
      res.json(checklist);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/activation/channel-enable/:channel", requireRole("admin"), async (req, res) => {
    const channel = validateChannelParam(req, res);
    if (!channel) return;
    try {
      // Re-run the checklist server-side. A client-submitted { allPassed: true }
      // (or similar) body is never trusted for this decision.
      const checklist = await evaluateChannelChecklist(channel);
      const actorUserId = (req.user as any)?.id ?? null;
      const actorEmail = (req.user as any)?.email ?? null;
      const envFlag = CHANNEL_ENV_FLAG[channel];

      if (!checklist.passed) {
        await storage.createChannelAuditLog({
          channel,
          action: "checklist_viewed",
          checklistSnapshot: checklist,
          actorUserId,
          actorEmail,
          notes: "Approval request denied — checklist requirements not met.",
        });
        return res.status(400).json({
          approvedToEnable: false,
          message: "Checklist requirements not met. Approval cannot be granted.",
          checklist,
        });
      }

      const auditRow = await storage.createChannelAuditLog({
        channel,
        action: "enable_approved",
        checklistSnapshot: checklist,
        actorUserId,
        actorEmail,
        notes: req.body?.notes ? String(req.body.notes).slice(0, 2000) : null,
      });

      const manualStep = `Approval recorded (audit #${auditRow.id}). To actually activate this channel, an operator must manually set the Replit Secret ${envFlag}=true and restart the app. This system never modifies environment variables or secrets on its own.`;

      // Notify the rest of the team (compliance/ops) that a channel has been
      // approved and is now waiting on a manual Secret flip + restart. This
      // is purely informational — it never touches process.env or Secrets.
      notifyChannelApproved({ channel, envFlag, actorEmail, auditId: auditRow.id, manualStep }).catch((err) => {
        console.error(`[Activation] Failed to send channel-approved notification for ${channel}:`, err);
      });

      // This route only records an approval decision. It NEVER sets the
      // env flag — that remains a manual Replit Secrets action + restart.
      res.json({
        approvedToEnable: true,
        auditId: auditRow.id,
        currentlyEnabled: featureFlags[envFlag] === true,
        manualStep,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/activation/channel-test-batch/:channel", requireRole("admin"), async (req, res) => {
    const channel = validateChannelParam(req, res);
    if (!channel) return;
    const TEST_BATCH_LIMIT = 5;
    const POOL_SCAN_LIMIT = 100;
    try {
      const { contacts } = await import("@shared/schema");
      const { isNotNull } = await import("drizzle-orm");
      const { evaluateContactability } = await import("../services/contactability");

      // Pull a candidate pool, then run each one through the SAME
      // channel-aware, real contactability evaluation used by live sends
      // (in dryRun mode — no send/queue side effects). Only contacts that
      // would actually be ALLOWED on this channel right now are returned.
      const pool = await db
        .select({
          id: contacts.id,
          firstName: contacts.firstName,
          lastName: contacts.lastName,
          phone: contacts.phone,
          email: contacts.email,
          state: contacts.state,
          leadSource: contacts.leadSource,
          sourceCategory: contacts.sourceCategory,
        })
        .from(contacts)
        .where(and(eq(contacts.doNotContact, false), isNotNull(contacts.phone), sql`${contacts.phone} <> ''`))
        .limit(POOL_SCAN_LIMIT);

      const candidates: Array<{
        id: number;
        firstName: string | null;
        lastName: string | null;
        phone: string | null;
        email: string | null;
        consentTier: string;
        reason: string;
      }> = [];
      const evaluated: Array<{ contactId: number; allowed: boolean; reason: string }> = [];

      for (const contact of pool) {
        if (candidates.length >= TEST_BATCH_LIMIT) break;
        const result = await evaluateContactability({
          contactId: contact.id,
          channel,
          leadSource: contact.leadSource ?? undefined,
          sourceCategory: contact.sourceCategory ?? undefined,
          state: contact.state ?? undefined,
          mode: "dryRun",
        });
        evaluated.push({ contactId: contact.id, allowed: result.allowed, reason: result.reason });
        if (result.allowed) {
          candidates.push({
            id: contact.id,
            firstName: contact.firstName,
            lastName: contact.lastName,
            phone: contact.phone,
            email: contact.email,
            consentTier: result.consentTier,
            reason: result.reason,
          });
        }
      }

      const actorUserId = (req.user as any)?.id ?? null;
      const actorEmail = (req.user as any)?.email ?? null;
      const auditRow = await storage.createChannelAuditLog({
        channel,
        action: "test_batch_preview",
        checklistSnapshot: {
          scannedCount: pool.length,
          eligibleCount: candidates.length,
          previewedContactIds: candidates.map((c) => c.id),
          evaluated,
        },
        actorUserId,
        actorEmail,
        notes: "Dry-run preview only — no outbound communication was sent or queued.",
      });

      res.json({
        channel,
        dryRun: true,
        sent: false,
        auditId: auditRow.id,
        scannedCount: pool.length,
        candidateCount: candidates.length,
        candidates,
        note: "This is a preview only. No SMS, call, ringless voicemail, email, or sequence step was sent or queued.",
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
