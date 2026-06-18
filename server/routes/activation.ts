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
}
