import type { Express } from "express";
import { isAdmin, isAuthenticated } from "../replit_integrations/auth";
import { storage } from "../storage";
import { db } from "../db";
import { sql, desc, and, gte } from "drizzle-orm";
import { emailLogs, callLogs, outboundMessages, auditLogs } from "@shared/schema";
import { featureFlags } from "../services/feature-flags";
import { runStageProgressionSweep } from "../services/stage-progression";

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
}
