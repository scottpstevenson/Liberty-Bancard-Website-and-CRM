import type { Express, Request as ExpressRequest } from "express";
import { isAuthenticated, isAdmin, isDashboardUser, requireRole } from "../replit_integrations/auth";
import { storage } from "../storage";
import { db, pool } from "../db";
import { z } from "zod";
import { contacts, consentAuditLogs, insertBusinessAliasSchema, insertBusinessLocationSchema, insertBusinessSchema, insertLeadSourceSchema, sdrLeadState, sdrChannelAttempts, sdrLeadEvents, sdrMerchants } from "@shared/schema";
import { eq, sql, desc, and } from "drizzle-orm";
import { getSerperUsage, isSerperConfigured } from "../services/serper";
import { scoreLeadFull } from "../services/sdr/scoring";
import { bridgeContactsToSdr, getDailyLimits, getSdrDashboardStats, isOrchestratorRunning, startOrchestrator, stopOrchestrator, sweepLeads, pauseAll, resumeAll, isGloballyPaused, getGlobalPauseReason, getLastSweepTime, getLastSweepErrors, trackWebhookFailure, getWebhookFailureCount } from "../services/sdr/orchestrator";
import { getEnrollmentStatus, getWorkflowMappings, getInboxSmartListTags } from "../services/ghl-workflow-enrollment";
import { buildGhlVoicePayload, getAllVoiceScripts, getVoiceScript, personalizeVoiceScript, resolveVoiceScriptForLead } from "../services/sdr/voice-orchestrator";
import { bridgeContactsToBusinesses, getDedupeStats, ingestBusiness } from "../services/sdr/dedupe";
import { getAllFlags, featureFlags } from "../services/feature-flags";
import { validateWebhookSignature, getSdrGhlConfig, isSdrGhlConfigured, fetchCalendars } from "../services/sdr/ghl-client";
import { handleContactUpdated, handleMessageReceived, handleCallOutcome, handleAppointmentBooked, handleAppointmentCanceled, handleOptOut } from "../services/sdr/webhook-handlers";
import { handleConversationCreated, handleChatMessage, handleSmsThread, handleEmailThread, handleChatBooking } from "../services/sdr/chat-handlers";
import { parse } from "csv-parse/sync";

export function registerSdrRoutes(app: Express) {
  // === HEALTH ENDPOINTS ===
  // Public minimal health check — intentionally reveals nothing about internals
  app.get("/health", async (_req, res) => {
    let dbOk = false;
    try {
      await pool.query("SELECT 1");
      dbOk = true;
    } catch (err) {
      console.error("[Health] DB check failed:", err);
    }
    if (!dbOk) {
      return res.status(503).json({ status: "degraded" });
    }
    return res.status(200).json({ status: "ok" });
  });

  // Public minimal API health check — no internals exposed
  app.get("/api/health", async (_req, res) => {
    let dbOk = false;
    try {
      const result = await pool.query("SELECT 1 AS check");
      dbOk = result.rows.length > 0;
    } catch {}
    if (!dbOk) {
      return res.status(503).json({ status: "degraded" });
    }
    res.json({ status: "ok" });
  });

  // Verbose health check — dashboard users only
  app.get("/api/admin/health", isDashboardUser, async (_req, res) => {
    const uptime = process.uptime();
    let dbOk = false;
    let sessionOk = false;
    let sessionCount: number | null = null;
    try {
      const result = await pool.query("SELECT 1 AS check");
      dbOk = result.rows.length > 0;
    } catch {}
    try {
      const sessResult = await pool.query("SELECT COUNT(*) AS cnt FROM sessions");
      sessionOk = sessResult.rows.length > 0;
      sessionCount = sessResult.rows[0] ? parseInt(sessResult.rows[0].cnt, 10) : null;
    } catch {}
    const { isGhlConfigured } = await import("../services/ghl");
    res.json({
      ok: dbOk && sessionOk,
      uptime: Math.floor(uptime),
      db: dbOk ? "connected" : "error",
      session: sessionOk ? "connected" : "error",
      sessionCount,
      ghl: isGhlConfigured() ? "configured" : "missing",
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/api/ghl/health", isAuthenticated, async (_req, res) => {
    try {
      const config = getSdrGhlConfig();
      let authTest = false;
      if (isSdrGhlConfigured()) {
        try {
          await fetchCalendars();
          authTest = true;
        } catch {}
      }
      const { getGhlCircuitStatus } = await import("../services/ghl-sync");
      const circuit = getGhlCircuitStatus();
      res.json({ ...config, authTest, ...circuit });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/ghl/circuit-reset", isAuthenticated, async (_req, res) => {
    try {
      const { resetGhlCircuit } = await import("../services/ghl-sync");
      resetGhlCircuit();
      await storage.createAuditLog({ action: "GHL_CIRCUIT_RESET", entityType: "system", details: "GHL circuit breaker manually reset via Activation Panel" });
      res.json({ ok: true, message: "GHL circuit breaker reset — consecutive failure count cleared" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/sdr/health", isAuthenticated, async (_req, res) => {
    try {
      const identities = await storage.getSendingIdentities();
      const activeIdentities = identities.filter((i: any) => i.status === "active");

      const eligibleLeads = await db.select({ count: sql<number>`count(*)` })
        .from(sdrLeadState)
        .where(sql`${sdrLeadState.stage} NOT IN ('DEAD', 'CONVERTED') AND ${sdrLeadState.nextActionAt} IS NOT NULL`);

      const recentFailures = await db.select({ count: sql<number>`count(*)` })
        .from(sdrChannelAttempts)
        .where(sql`${sdrChannelAttempts.status} = 'failed' AND ${sdrChannelAttempts.sentAt} > NOW() - INTERVAL '24 hours'`);

      const lastWebhookEvent = await db.select({ createdAt: sdrLeadEvents.createdAt })
        .from(sdrLeadEvents)
        .where(sql`${sdrLeadEvents.eventType} LIKE '%webhook%' OR ${sdrLeadEvents.eventType} IN ('reply_received', 'call_outcome', 'appointment_booked')`)
        .orderBy(desc(sdrLeadEvents.createdAt))
        .limit(1);

      res.json({
        sendingIdentityCount: identities.length,
        activeIdentityCount: activeIdentities.length,
        eligibleLeadCount: Number(eligibleLeads[0]?.count || 0),
        orchestratorRunning: isOrchestratorRunning(),
        globalPaused: isGloballyPaused(),
        globalPauseReason: getGlobalPauseReason(),
        lastSweepTime: getLastSweepTime()?.toISOString() || null,
        lastSweepErrors: getLastSweepErrors(),
        recentFailures24h: Number(recentFailures[0]?.count || 0),
        webhookLastReceived: lastWebhookEvent[0]?.createdAt?.toISOString() || null,
        flags: getAllFlags(),
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === FEATURE FLAGS ===
  app.get("/api/sdr/flags", isAuthenticated, (_req, res) => {
    res.json(getAllFlags());
  });

  // === GLOBAL PAUSE / RESUME ===
  app.post("/api/sdr/pause-all", requireRole("admin"), (req, res) => {
    const reason = req.body?.reason || "Manual pause from admin panel";
    pauseAll(reason);
    res.json({ success: true, paused: true, reason });
  });

  app.post("/api/sdr/resume-all", requireRole("admin"), (req, res) => {
    resumeAll();
    res.json({ success: true, paused: false });
  });

  // === BRIDGE SCRIPT ===
  app.post("/api/sdr/bridge", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== "admin") return res.status(403).json({ message: "Admin only" });
    try {
      const source = req.body?.source || "contacts";
      const limit = Math.min(parseInt(req.body?.limit || "50", 10), 500);
      const dryRun = req.body?.dryRun === true || req.query.dryRun === "true";
      const verticalFilter = req.body?.vertical || null;
      const geographyFilter = req.body?.geography || null;

      if (source === "contacts") {
        const { data: allContacts } = await storage.getContacts({ limit: 500 });
        let filtered = allContacts;

        if (verticalFilter) {
          filtered = filtered.filter((c: any) => c.vertical && c.vertical.toLowerCase().includes(verticalFilter.toLowerCase()));
        }
        if (geographyFilter) {
          filtered = filtered.filter((c: any) => (c.city && c.city.toLowerCase().includes(geographyFilter.toLowerCase())) || (c.state && c.state.toLowerCase().includes(geographyFilter.toLowerCase())));
        }

        filtered = filtered.slice(0, limit);

        const existingLeads = await db.select({ contactId: sdrLeadState.contactId })
          .from(sdrLeadState)
          .where(sql`${sdrLeadState.contactId} IS NOT NULL`);
        const existingContactIds = new Set(existingLeads.map((l: any) => l.contactId));

        const results: any[] = [];
        let created = 0, deduped = 0, skipped = 0, errors = 0;

        for (const contact of filtered) {
          if (existingContactIds.has(contact.id)) {
            deduped++;
            results.push({ id: contact.id, name: contact.companyName || `${contact.firstName} ${contact.lastName}`, status: "deduped" });
            continue;
          }
          if (!contact.email && !contact.phone) {
            skipped++;
            results.push({ id: contact.id, name: contact.companyName || `${contact.firstName} ${contact.lastName}`, status: "skipped", reason: "No email or phone" });
            continue;
          }

          if (dryRun) {
            created++;
            results.push({ id: contact.id, name: contact.companyName || `${contact.firstName} ${contact.lastName}`, status: "would_create", vertical: contact.vertical, city: contact.city });
          } else {
            try {
              const bridgeResult = await bridgeContactsToSdr({ limit: 1, contactIds: [contact.id] });
              if (bridgeResult.imported > 0) {
                created++;
                results.push({ id: contact.id, name: contact.companyName || `${contact.firstName} ${contact.lastName}`, status: "created" });
              } else {
                skipped++;
                results.push({ id: contact.id, name: contact.companyName || `${contact.firstName} ${contact.lastName}`, status: "skipped" });
              }
            } catch (err: any) {
              errors++;
              results.push({ id: contact.id, name: contact.companyName || `${contact.firstName} ${contact.lastName}`, status: "error", reason: err.message });
            }
          }
        }

        res.json({ dryRun, source, totalProcessed: filtered.length, created, deduped, skipped, errors, results });
      } else if (source === "sunbiz") {
        let sunbizEntities: Record<string, unknown>[] = [];
        try {
          const rawResult = await db.execute(sql`
            SELECT * FROM sunbiz_entities
            WHERE TRUE
            ${verticalFilter ? sql`AND vertical ILIKE ${'%' + verticalFilter + '%'}` : sql``}
            ${geographyFilter ? sql`AND (city ILIKE ${'%' + geographyFilter + '%'} OR state ILIKE ${'%' + geographyFilter + '%'})` : sql``}
            LIMIT ${limit}
          `);
          sunbizEntities = (rawResult.rows || []) as Record<string, unknown>[];
        } catch {
          sunbizEntities = [];
        }

        const existingMerchantRefs = await db.select({ sourceRef: sdrMerchants.sourceRef })
          .from(sdrMerchants)
          .where(sql`${sdrMerchants.source} = 'sunbiz_bridge'`);
        const existingRefs = new Set(existingMerchantRefs.map(r => r.sourceRef));

        interface BridgeResult { id: unknown; name: unknown; status: string; reason?: string; vertical?: unknown; city?: unknown; businessId?: number; merchantId?: number }
        const results: BridgeResult[] = [];
        let created = 0, deduped = 0, skipped = 0, errors = 0;

        for (const entity of sunbizEntities) {
          const entityId = entity.id;
          const businessName = (entity.business_name || entity.businessName || "Unknown") as string;
          const entityEmail = entity.email as string | null;
          const entityPhone = entity.phone as string | null;

          if (!entityEmail && !entityPhone) {
            skipped++;
            results.push({ id: entityId, name: businessName, status: "skipped", reason: "No contact info" });
            continue;
          }

          const refKey = `sunbiz_${entityId}`;
          if (existingRefs.has(refKey)) {
            deduped++;
            results.push({ id: entityId, name: businessName, status: "deduped" });
            continue;
          }

          if (dryRun) {
            created++;
            results.push({ id: entityId, name: businessName, status: "would_create", vertical: entity.vertical, city: entity.city });
          } else {
            try {
              const bizResult = await ingestBusiness({
                name: businessName,
                phone: entityPhone || undefined,
                email: entityEmail || undefined,
                address: (entity.address as string) || undefined,
                city: (entity.city as string) || undefined,
                state: (entity.state as string) || "FL",
                vertical: (entity.vertical as string) || undefined,
                sourceType: "sunbiz_bridge",
                sourceLabel: refKey,
              });
              const resolvedBusinessId = bizResult.businessId;

              const [merchant] = await db.insert(sdrMerchants).values({
                businessName,
                website: null,
                mainPhone: entityPhone || null,
                mainEmail: entityEmail || null,
                address: (entity.address as string) || null,
                city: (entity.city as string) || null,
                state: (entity.state as string) || "FL",
                vertical: (entity.vertical as string) || null,
                source: "sunbiz_bridge",
                sourceRef: refKey,
                businessId: resolvedBusinessId,
              }).returning();

              await db.insert(sdrLeadState).values({
                merchantId: merchant.id,
                businessId: resolvedBusinessId,
                companyName: businessName,
                email: entityEmail || null,
                phone: entityPhone || null,
                vertical: (entity.vertical as string) || null,
                city: (entity.city as string) || null,
                state: (entity.state as string) || "FL",
                stage: "DISCOVERED",
                sourceType: "sunbiz_bridge",
                sourceId: refKey,
                nextActionType: "score",
                nextActionAt: new Date(),
              });

              existingRefs.add(refKey);
              created++;
              results.push({ id: entityId, name: businessName, status: "created", businessId: resolvedBusinessId, merchantId: merchant.id });
            } catch (err: unknown) {
              const errMsg = err instanceof Error ? err.message : String(err);
              if (errMsg.includes("duplicate") || errMsg.includes("already exists")) {
                deduped++;
                results.push({ id: entityId, name: businessName, status: "deduped" });
              } else {
                errors++;
                results.push({ id: entityId, name: businessName, status: "error", reason: errMsg });
              }
            }
          }
        }

        res.json({ dryRun, source, totalProcessed: sunbizEntities.length, created, deduped, skipped, errors, results });
      } else {
        res.status(400).json({ message: "source must be 'contacts' or 'sunbiz'" });
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === COMPLIANCE CHANNEL STATUS ===
  app.get("/api/sdr/compliance-channel-status", isDashboardUser, async (_req, res) => {
    try {
      const [totalRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(contacts)
        .where(sql`${contacts.archivedAt} IS NULL`);
      const totalContacts = totalRow?.count ?? 0;

      const [smsPewcRow] = await db
        .select({ count: sql<number>`count(distinct ${consentAuditLogs.contactId})::int` })
        .from(consentAuditLogs)
        .where(and(
          eq(consentAuditLogs.channel, "sms"),
          eq(consentAuditLogs.consented, true),
          eq(consentAuditLogs.consentType, "express_written"),
        ));
      const smsPewcCount = smsPewcRow?.count ?? 0;

      const [callPewcRow] = await db
        .select({ count: sql<number>`count(distinct ${consentAuditLogs.contactId})::int` })
        .from(consentAuditLogs)
        .where(and(
          eq(consentAuditLogs.channel, "call"),
          eq(consentAuditLogs.consented, true),
          eq(consentAuditLogs.consentType, "express_written"),
        ));
      const callPewcCount = callPewcRow?.count ?? 0;

      const [smsAnyConsentRow] = await db
        .select({ count: sql<number>`count(distinct ${consentAuditLogs.contactId})::int` })
        .from(consentAuditLogs)
        .where(and(eq(consentAuditLogs.channel, "sms"), eq(consentAuditLogs.consented, true)));
      const smsAnyConsentCount = smsAnyConsentRow?.count ?? 0;

      const strictStates = (process.env.STRICT_STATE_CONSENT_REQUIRED || "FL")
        .split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);

      const missingApiKeys: string[] = [];
      if (!process.env.SERPER_API_KEY) missingApiKeys.push("SERPER_API_KEY");
      if (!process.env.OUTSCRAPER_API_KEY) missingApiKeys.push("OUTSCRAPER_API_KEY");
      if (!process.env.APIFY_API_TOKEN) missingApiKeys.push("APIFY_API_TOKEN");
      if (!process.env.APOLLO_API_KEY) missingApiKeys.push("APOLLO_API_KEY");

      const smsEnabled = featureFlags.SMS_ENABLED;
      const voiceEnabled = featureFlags.VOICE_AI_ENABLED;
      const discoveryEnabled = featureFlags.NIGHTLY_DISCOVERY_ENABLED;
      const orchestratorEnabled = featureFlags.ORCHESTRATOR_ENABLED;
      const sdrEnabled = featureFlags.SDR_ENABLED;

      res.json({
        strictStates,
        lastUpdated: new Date().toISOString(),
        channels: [
          {
            key: "cold_email",
            name: "Cold Email",
            icon: "mail",
            status: sdrEnabled ? "safe" : "warning",
            flagKey: "SDR_ENABLED",
            flagEnabled: sdrEnabled,
            regulation: "CAN-SPAM",
            consentRequired: false,
            summary: sdrEnabled
              ? "Safe to use — B2B cold email is governed by CAN-SPAM, not TCPA. No prior consent required for business contacts."
              : "SDR_ENABLED is off. Email sequences will not run until you enable it.",
            requirements: [
              "Include physical mailing address in every email",
              "Honor unsubscribe requests within 10 business days",
              "No deceptive subject lines",
              "Identify message as an advertisement",
            ],
            blockers: sdrEnabled ? [] : ["SDR_ENABLED=false — set to true in Replit Secrets"],
            stats: null,
          },
          {
            key: "manual_call",
            name: "Manual Cold Call (Human Rep)",
            icon: "phone",
            status: "safe",
            flagKey: null,
            flagEnabled: true,
            regulation: "TCPA — B2B DNC Exemption",
            consentRequired: false,
            summary: "Safe — manually dialed B2B calls by a human rep are exempt from TCPA auto-dialer restrictions and the National DNC Registry.",
            requirements: [
              "Rep must manually dial — no predictive or auto-dialer software",
              "Respect individual Do-Not-Call requests immediately",
              "Comply with FL quiet hours: 8am–8pm local time",
              "Identify yourself and your company at the start of every call",
            ],
            blockers: [],
            stats: null,
          },
          {
            key: "automated_sms",
            name: "Automated SMS",
            icon: "message-square",
            status: !smsEnabled ? "off" : smsPewcCount === 0 ? "blocked" : "warning",
            flagKey: "SMS_ENABLED",
            flagEnabled: smsEnabled,
            regulation: "TCPA + FL SB 1120",
            consentRequired: true,
            summary: !smsEnabled
              ? "SMS_ENABLED=false — automated SMS is disabled. Safe default for launch."
              : smsPewcCount === 0
              ? "Automated SMS is enabled but 0 contacts have express written consent (PEWC). Do not send until consent is captured."
              : `${smsPewcCount} of ${totalContacts} contacts have PEWC for SMS. Only send to consented contacts.`,
            requirements: [
              "Express written consent (PEWC) required before any automated message",
              "FL contacts require PEWC per SB 1120 — captured via merchant application checkbox",
              "Reply STOP must stop all messages immediately",
              "Identify sender in every message",
              "Message & data rates disclosure required at opt-in",
            ],
            blockers: [
              ...(!smsEnabled ? ["SMS_ENABLED=false — set to true in Replit Secrets when ready"] : []),
              ...(smsEnabled && smsPewcCount === 0 ? ["0 contacts have express written consent — capture PEWC via merchant application before sending"] : []),
            ],
            stats: { totalContacts, smsAnyConsentCount, smsPewcCount, strictStates },
          },
          {
            key: "voice_ai",
            name: "Voice AI / Auto-Dialer",
            icon: "mic",
            status: !voiceEnabled ? "off" : callPewcCount === 0 ? "blocked" : "warning",
            flagKey: "VOICE_AI_ENABLED",
            flagEnabled: voiceEnabled,
            regulation: "TCPA + FL SB 1120",
            consentRequired: true,
            summary: !voiceEnabled
              ? "VOICE_AI_ENABLED=false — automated calling is disabled. Recommended: keep off until PEWC is established."
              : callPewcCount === 0
              ? "Voice AI is enabled but 0 contacts have express written consent for calls. Do not place automated calls."
              : `${callPewcCount} of ${totalContacts} contacts have PEWC for calls.`,
            requirements: [
              "Express written consent required before any automated or pre-recorded call",
              "FL contacts require PEWC per SB 1120",
              "Identify caller and company in the first seconds of every call",
              "Provide opt-out mechanism during every call",
              "Comply with quiet hours (8am–9pm local time)",
            ],
            blockers: [
              ...(!voiceEnabled ? ["VOICE_AI_ENABLED=false — set to true in Replit Secrets only after PEWC flow is established"] : []),
              ...(voiceEnabled && callPewcCount === 0 ? ["0 contacts have call PEWC — do not place automated calls"] : []),
            ],
            stats: { totalContacts, callPewcCount, strictStates },
          },
          {
            key: "ringless_voicemail",
            name: "Ringless Voicemail (RVM)",
            icon: "voicemail",
            status: "blocked",
            flagKey: "VOICE_AI_ENABLED",
            flagEnabled: false,
            regulation: "TCPA — Legally Uncertain",
            consentRequired: true,
            summary: "Treat RVM as an automated call. FL courts and multiple federal circuits classify RVM as a TCPA 'call'. Requires PEWC — keep off until consent infrastructure is fully established.",
            requirements: [
              "Treat exactly like an automated call — PEWC required",
              "FL 11th Circuit has ruled RVM = TCPA call",
              "FCC rulemaking expected to formally classify RVM as a call",
            ],
            blockers: ["RVM is gated by VOICE_AI_ENABLED — keep off until PEWC is widespread"],
            stats: null,
          },
          {
            key: "nightly_discovery",
            name: "Nightly Lead Discovery",
            icon: "search",
            status: !discoveryEnabled ? "off" : missingApiKeys.length === 4 ? "blocked" : missingApiKeys.length > 0 ? "warning" : "safe",
            flagKey: "NIGHTLY_DISCOVERY_ENABLED",
            flagEnabled: discoveryEnabled,
            regulation: "No TCPA restriction",
            consentRequired: false,
            summary: !discoveryEnabled
              ? "NIGHTLY_DISCOVERY_ENABLED=false — automated lead discovery is off."
              : missingApiKeys.length === 0
              ? "All 4 discovery API keys are configured. Nightly discovery will run at the scheduled time."
              : `${4 - missingApiKeys.length}/4 discovery API keys configured. Missing: ${missingApiKeys.join(", ")}.`,
            requirements: [
              "Set SERPER_API_KEY, OUTSCRAPER_API_KEY, APIFY_API_TOKEN, APOLLO_API_KEY for full coverage",
              "Discovery does not contact leads — it only populates the prospect queue",
              "Contacts discovered here will need consent captured before automated SMS/calls",
            ],
            blockers: [
              ...(!discoveryEnabled ? ["NIGHTLY_DISCOVERY_ENABLED=false — set to true in Replit Secrets when ready"] : []),
              ...missingApiKeys.map((k) => `${k} not set — this discovery source will be skipped`),
            ],
            stats: { missingApiKeys, configuredCount: 4 - missingApiKeys.length },
          },
        ],
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === ACTIVATION PANEL DATA ===
  app.get("/api/sdr/activation/recent-attempts", isAdmin, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string || "50", 10);
      const attempts = await db.select()
        .from(sdrChannelAttempts)
        .orderBy(desc(sdrChannelAttempts.sentAt))
        .limit(limit);
      res.json(attempts);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/sdr/activation/recent-events", isAdmin, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string || "50", 10);
      const events = await db.select()
        .from(sdrLeadEvents)
        .orderBy(desc(sdrLeadEvents.createdAt))
        .limit(limit);
      res.json(events);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/sdr/activation/stuck-leads", isAdmin, async (_req, res) => {
    try {
      const stuckLeads = await db.select()
        .from(sdrLeadState)
        .where(sql`
          ${sdrLeadState.stage} NOT IN ('DEAD', 'CONVERTED')
          AND (
            (${sdrLeadState.nextActionAt} < NOW() - INTERVAL '24 hours')
            OR (${sdrLeadState.updatedAt} < NOW() - INTERVAL '72 hours' AND ${sdrLeadState.stage} NOT IN ('DEAD', 'CONVERTED'))
          )
        `)
        .orderBy(sql`${sdrLeadState.nextActionAt} ASC NULLS LAST`)
        .limit(100);
      res.json(stuckLeads);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === SDR WEBHOOK RECEIVER ===
  // Guard: reject all GHL webhooks with 503 in production when the signing secret is unset.
  // This forces the operator to configure GHL_WEBHOOK_SECRET before enabling GHL.
  app.use("/api/webhooks/ghl/", (req, res, next) => {
    if (!process.env.GHL_WEBHOOK_SECRET && process.env.NODE_ENV === "production") {
      console.error("[SDR Webhook] GHL_WEBHOOK_SECRET not configured — rejecting webhook in production");
      return res.status(503).json({ received: false, error: "Webhook signing not configured" });
    }
    next();
  });

  function getSdrWebhookRawBody(req: ExpressRequest): string {
    const rawBody = (req as ExpressRequest & { rawBody?: Buffer }).rawBody;
    if (rawBody && Buffer.isBuffer(rawBody)) {
      return rawBody.toString("utf8");
    }
    return JSON.stringify(req.body);
  }

  app.post("/api/webhooks/ghl/contact-updated", async (req, res) => {
    try {
      const signature = req.headers["x-ghl-signature"] as string || "";
      if (!validateWebhookSignature(getSdrWebhookRawBody(req), signature)) {
        return res.status(401).json({ message: "Invalid webhook signature" });
      }

      await handleContactUpdated(req.body);
      res.json({ received: true });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[SDR Webhook] contact-updated error:", errMsg);
      trackWebhookFailure();
      res.status(500).json({ message: errMsg });
    }
  });

  app.post("/api/webhooks/ghl/message-received", async (req, res) => {
    try {
      const signature = req.headers["x-ghl-signature"] as string || "";
      if (!validateWebhookSignature(getSdrWebhookRawBody(req), signature)) {
        return res.status(401).json({ message: "Invalid webhook signature" });
      }

      await handleMessageReceived(req.body);
      res.json({ received: true });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[SDR Webhook] message-received error:", errMsg);
      trackWebhookFailure();
      res.status(500).json({ message: errMsg });
    }
  });

  app.post("/api/webhooks/ghl/call-outcome", async (req, res) => {
    try {
      const signature = req.headers["x-ghl-signature"] as string || "";
      if (!validateWebhookSignature(getSdrWebhookRawBody(req), signature)) {
        return res.status(401).json({ message: "Invalid webhook signature" });
      }

      await handleCallOutcome(req.body);
      res.json({ received: true });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[SDR Webhook] call-outcome error:", errMsg);
      trackWebhookFailure();
      res.status(500).json({ message: errMsg });
    }
  });

  app.post("/api/webhooks/ghl/appointment-booked", async (req, res) => {
    try {
      const signature = req.headers["x-ghl-signature"] as string || "";
      if (!validateWebhookSignature(getSdrWebhookRawBody(req), signature)) {
        return res.status(401).json({ message: "Invalid webhook signature" });
      }

      await handleAppointmentBooked(req.body);
      res.json({ received: true });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[SDR Webhook] appointment-booked error:", errMsg);
      trackWebhookFailure();
      res.status(500).json({ message: errMsg });
    }
  });

  app.post("/api/webhooks/ghl/appointment-canceled", async (req, res) => {
    try {
      const signature = req.headers["x-ghl-signature"] as string || "";
      if (!validateWebhookSignature(getSdrWebhookRawBody(req), signature)) {
        return res.status(401).json({ message: "Invalid webhook signature" });
      }

      await handleAppointmentCanceled(req.body);
      res.json({ received: true });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[SDR Webhook] appointment-canceled error:", errMsg);
      trackWebhookFailure();
      res.status(500).json({ message: errMsg });
    }
  });

  app.post("/api/webhooks/ghl/opt-out", async (req, res) => {
    try {
      const signature = req.headers["x-ghl-signature"] as string || "";
      if (!validateWebhookSignature(getSdrWebhookRawBody(req), signature)) {
        return res.status(401).json({ message: "Invalid webhook signature" });
      }

      await handleOptOut(req.body);
      res.json({ received: true });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[SDR Webhook] opt-out error:", errMsg);
      trackWebhookFailure();
      res.status(500).json({ message: errMsg });
    }
  });

  app.post("/api/webhooks/ghl/conversation-created", async (req, res) => {
    try {
      const signature = req.headers["x-ghl-signature"] as string || "";
      if (!validateWebhookSignature(getSdrWebhookRawBody(req), signature)) {
        return res.status(401).json({ message: "Invalid webhook signature" });
      }

      await handleConversationCreated(req.body);
      res.json({ received: true });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[SDR Webhook] conversation-created error:", errMsg);
      trackWebhookFailure();
      res.status(500).json({ message: errMsg });
    }
  });

  app.post("/api/webhooks/ghl/chat-message", async (req, res) => {
    try {
      const signature = req.headers["x-ghl-signature"] as string || "";
      if (!validateWebhookSignature(getSdrWebhookRawBody(req), signature)) {
        return res.status(401).json({ message: "Invalid webhook signature" });
      }

      const result = await handleChatMessage(req.body);
      res.json({ received: true, ...(result || {}) });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[SDR Webhook] chat-message error:", errMsg);
      trackWebhookFailure();
      res.status(500).json({ message: errMsg });
    }
  });

  app.post("/api/webhooks/ghl/sms-thread", async (req, res) => {
    try {
      const signature = req.headers["x-ghl-signature"] as string || "";
      if (!validateWebhookSignature(getSdrWebhookRawBody(req), signature)) {
        return res.status(401).json({ message: "Invalid webhook signature" });
      }

      const result = await handleSmsThread(req.body);
      res.json({ received: true, ...(result || {}) });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[SDR Webhook] sms-thread error:", errMsg);
      trackWebhookFailure();
      res.status(500).json({ message: errMsg });
    }
  });

  app.post("/api/webhooks/ghl/email-thread", async (req, res) => {
    try {
      const signature = req.headers["x-ghl-signature"] as string || "";
      if (!validateWebhookSignature(getSdrWebhookRawBody(req), signature)) {
        return res.status(401).json({ message: "Invalid webhook signature" });
      }

      const result = await handleEmailThread(req.body);
      res.json({ received: true, ...(result || {}) });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[SDR Webhook] email-thread error:", errMsg);
      trackWebhookFailure();
      res.status(500).json({ message: errMsg });
    }
  });

  app.post("/api/webhooks/ghl/chat-booking", async (req, res) => {
    try {
      const signature = req.headers["x-ghl-signature"] as string || "";
      if (!validateWebhookSignature(getSdrWebhookRawBody(req), signature)) {
        return res.status(401).json({ message: "Invalid webhook signature" });
      }

      await handleChatBooking(req.body);
      res.json({ received: true });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[SDR Webhook] chat-booking error:", errMsg);
      trackWebhookFailure();
      res.status(500).json({ message: errMsg });
    }
  });


  // === SDR DASHBOARD API ===
  app.get("/api/sdr/dashboard/summary", isAuthenticated, async (_req, res) => {
    try {
      const summary = await storage.getSdrDashboardSummary();
      res.json(summary);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.get("/api/sdr/dashboard/funnel", isAuthenticated, async (_req, res) => {
    try {
      const funnel = await storage.getSdrFunnelData();
      res.json(funnel);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.get("/api/sdr/dashboard/stuck-leads", isAuthenticated, async (_req, res) => {
    try {
      const stuck = await storage.getSdrStuckLeads();
      res.json(stuck);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.get("/api/sdr/dashboard/activity", isAuthenticated, async (_req, res) => {
    try {
      const activity = await storage.getSdrActivityData();
      res.json(activity);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.get("/api/sdr/dashboard/chat-analytics", isAuthenticated, async (_req, res) => {
    try {
      const { getChatAnalytics } = await import("../services/sdr/chat-handlers");
      const analytics = await getChatAnalytics();
      res.json(analytics);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.get("/api/sdr/discovery/config", isAuthenticated, async (_req, res) => {
    try {
      const { getSearchMatrix } = await import("../services/sdr/lead-finder");
      const matrix = await getSearchMatrix();
      res.json(matrix);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.put("/api/sdr/discovery/config", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin only" });
    try {
      const { updateSearchMatrix } = await import("../services/sdr/lead-finder");
      const updated = await updateSearchMatrix(req.body);
      res.json(updated);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.post("/api/sdr/discovery/run", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin only" });
    try {
      const { runLeadDiscovery, isDiscoveryRunning } = await import("../services/sdr/lead-finder");
      if (isDiscoveryRunning()) {
        return res.status(409).json({ message: "Lead discovery is already running" });
      }
      const { verticals, metros, dataSources } = req.body;
      res.json({ message: "Lead discovery started", started: true });
      runLeadDiscovery("manual", { verticals, metros, dataSources }).catch(err =>
        console.error("[LeadDiscovery API] Error:", err)
      );
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.get("/api/sdr/discovery/status", isAuthenticated, async (_req, res) => {
    try {
      const { isDiscoveryRunning, isNightlyDiscoveryRunning } = await import("../services/sdr/lead-finder");
      res.json({
        discoveryRunning: isDiscoveryRunning(),
        nightlySchedulerActive: isNightlyDiscoveryRunning(),
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.post("/api/sdr/discovery/nightly/start", isAuthenticated, async (req, res) => {
    if ((req as any).user?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    try {
      const { startNightlyDiscovery } = await import("../services/sdr/lead-finder");
      startNightlyDiscovery();
      res.json({ message: "Nightly discovery scheduler started" });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.post("/api/sdr/discovery/nightly/stop", isAuthenticated, async (req, res) => {
    if ((req as any).user?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    try {
      const { stopNightlyDiscovery } = await import("../services/sdr/lead-finder");
      stopNightlyDiscovery();
      res.json({ message: "Nightly discovery scheduler stopped" });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.get("/api/sdr/discovery/jobs", isAuthenticated, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 20;
      const jobs = await storage.getLeadDiscoveryJobs(limit);
      res.json(jobs);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.get("/api/sdr/discovery/jobs/:id", isAuthenticated, async (req, res) => {
    try {
      const job = await storage.getLeadDiscoveryJob(Number(req.params.id));
      if (!job) return res.status(404).json({ message: "Job not found" });
      const results = await storage.getLeadDiscoveryResults(job.id);
      res.json({ ...job, results });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.get("/api/sdr/discovery/stats", isAuthenticated, async (_req, res) => {
    try {
      const stats = await storage.getLeadDiscoveryStats();
      res.json(stats);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.get("/api/sdr/discovery/owner-coverage", isAuthenticated, async (_req, res) => {
    try {
      const { getOwnerEmailCoverage } = await import("../services/sdr/contactpage-enrichment");
      const coverage = await getOwnerEmailCoverage();
      res.json(coverage);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.get("/api/sdr/discovery/source-status", isAuthenticated, async (_req, res) => {
    try {
      const { isOutscraperConfigured, getOutscraperUsage } = await import("../services/sdr/outscraper");
      const { isApifyConfigured, getApifyUsage } = await import("../services/sdr/apify");
      const { isApolloConfigured, getApolloUsage } = await import("../services/sdr/apollo");
      const serperConfigured = isSerperConfigured();
      const serperUsage = await getSerperUsage();
      const outscrConfigured = isOutscraperConfigured();
      const outscrUsage = outscrConfigured ? await getOutscraperUsage() : null;
      const apifyConfigured = isApifyConfigured();
      const apifyUsage = apifyConfigured ? await getApifyUsage() : null;
      const apolloConfigured = isApolloConfigured();
      const apolloUsage = await getApolloUsage();

      res.json({
        serper: { configured: serperConfigured, usage: serperUsage },
        outscraper: { configured: outscrConfigured, usage: outscrUsage },
        apify: { configured: apifyConfigured, usage: apifyUsage },
        apollo: { configured: apolloConfigured, usage: apolloUsage },
        osm: { configured: true, free: true, description: "OpenStreetMap Overpass — no key required" },
        yellowpages: { configured: true, free: true, description: "YP.com scraper — no key required" },
        bbb: { configured: true, free: true, description: "BBB.org accreditation listings — no key required" },
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.post("/api/sdr/discovery/test-source", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin only" });
    const { source } = req.body;
    try {
      if (source === "apollo") {
        const { testApolloConnection } = await import("../services/sdr/apollo");
        const result = await testApolloConnection();
        return res.json(result);
      }
      return res.status(400).json({ success: false, message: `Test not supported for source: ${source}` });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ success: false, message: errMsg });
    }
  });

  app.get("/api/sdr/bot-contexts", isAuthenticated, async (_req, res) => {
    const { getAllBotContexts } = await import("../services/sdr/conversation-ai");
    const contexts = getAllBotContexts().map(c => ({
      contextId: c.contextId,
      name: c.name,
      verticalKey: c.verticalKey || null,
    }));
    res.json(contexts);
  });

  app.post("/api/sdr/bot-context/resolve", isAuthenticated, async (req, res) => {
    try {
      const { getBotContextForContact } = await import("../services/sdr/chat-handlers");
      const { ghlContactId, pageUrl } = req.body;
      if (!ghlContactId) return res.status(400).json({ message: "ghlContactId required" });
      const result = await getBotContextForContact(ghlContactId, pageUrl);
      res.json(result);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.get("/api/sdr/config", isAuthenticated, async (_req, res) => {
    const { getSdrGhlConfig } = await import("../services/sdr/ghl-client");
    res.json(getSdrGhlConfig());
  });

  app.post("/api/sdr/bootstrap-ghl", isAuthenticated, async (req, res) => {
    if ((req.user as { role?: string })?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    try {
      const { bootstrapGhlCustomFieldsAndTags } = await import("../services/sdr/ghl-client");
      const result = await bootstrapGhlCustomFieldsAndTags();
      res.json(result);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.post("/api/sdr/sync-lead-state/:merchantId", isAuthenticated, async (req, res) => {
    try {
      const merchantId = Number(req.params.merchantId);
      const { syncLeadStateToGhl } = await import("../services/sdr/ghl-sync-rules");
      await syncLeadStateToGhl(merchantId);
      res.json({ success: true });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.post("/api/sdr/classify-intent", isAuthenticated, async (req, res) => {
    try {
      const { classifyIntent } = await import("../services/sdr/reply-intelligence");
      const { messageText, context } = req.body;
      if (!messageText) return res.status(400).json({ message: "messageText is required" });
      const result = await classifyIntent(messageText, context || {});
      res.json(result);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.post("/api/sdr/trigger-call/:merchantId", isAuthenticated, async (req, res) => {
    try {
      const merchantId = Number(req.params.merchantId);
      if (!Number.isFinite(merchantId) || merchantId <= 0) return res.status(400).json({ message: "Invalid merchantId" });
      const { botMode } = req.body;
      if (!botMode) return res.status(400).json({ message: "botMode is required" });
      const { triggerAiCall, VOICE_BOT_MODES } = await import("../services/sdr/voice-orchestrator");
      if (!(VOICE_BOT_MODES as readonly string[]).includes(botMode)) {
        return res.status(400).json({ message: `Invalid botMode. Valid modes: ${VOICE_BOT_MODES.join(", ")}` });
      }
      const result = await triggerAiCall(merchantId, botMode);
      res.json(result);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.post("/api/sdr/send-booking-link/:merchantId", isAuthenticated, async (req, res) => {
    try {
      const merchantId = Number(req.params.merchantId);
      if (!Number.isFinite(merchantId) || merchantId <= 0) return res.status(400).json({ message: "Invalid merchantId" });
      const channel = req.body.channel || "sms";
      if (!["sms", "email", "chat"].includes(channel)) return res.status(400).json({ message: "Channel must be sms, email, or chat" });
      const { sendBookingLink } = await import("../services/sdr/scheduling");
      const result = await sendBookingLink(merchantId, channel);
      res.json(result);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.get("/api/sdr/compliance-check/:merchantId/:channel", isAuthenticated, async (req, res) => {
    try {
      const merchantId = Number(req.params.merchantId);
      if (!Number.isFinite(merchantId) || merchantId <= 0) return res.status(400).json({ message: "Invalid merchantId" });
      const channel = req.params.channel as "sms" | "email" | "call";
      if (!["sms", "email", "call"].includes(channel)) {
        return res.status(400).json({ message: "Channel must be sms, email, or call" });
      }
      const { checkBeforeSend } = await import("../services/sdr/compliance-engine");
      const result = await checkBeforeSend(merchantId, channel);
      res.json(result);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.get("/api/sdr/compliance/dashboard", isAuthenticated, async (_req, res) => {
    try {
      const { getComplianceDashboard } = await import("../services/sdr/compliance-engine");
      const dashboard = await getComplianceDashboard();
      res.json(dashboard);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.get("/api/sdr/compliance/blocked-sends", isAuthenticated, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string || "100", 10);
      const { getBlockedSends } = await import("../services/sdr/compliance-engine");
      const blocked = await getBlockedSends(limit);
      res.json(blocked);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.post("/api/sdr/leads/:id/handoff", isAuthenticated, async (req, res) => {
    try {
      const leadId = Number(req.params.id);
      if (!Number.isInteger(leadId) || leadId <= 0) return res.status(400).json({ message: "Invalid lead ID" });
      const { assignedUserId, note } = req.body;
      if (!assignedUserId || typeof assignedUserId !== "string") return res.status(400).json({ message: "assignedUserId required" });
      if ((req.user as { role?: string })?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
      const { handoffToHuman } = await import("../services/sdr/human-handoff");
      const result = await handoffToHuman(leadId, assignedUserId, note);
      if (!result.success) return res.status(400).json({ message: result.error });
      res.json({ success: true });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.post("/api/sdr/leads/:id/return-to-ai", isAuthenticated, async (req, res) => {
    try {
      const leadId = Number(req.params.id);
      if (!Number.isInteger(leadId) || leadId <= 0) return res.status(400).json({ message: "Invalid lead ID" });
      if ((req.user as { role?: string })?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
      const { note } = req.body;
      const { returnToAi } = await import("../services/sdr/human-handoff");
      const result = await returnToAi(leadId, note);
      if (!result.success) return res.status(400).json({ message: result.error });
      res.json({ success: true });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.post("/api/sdr/leads/:id/block-automation", isAuthenticated, async (req, res) => {
    try {
      const leadId = Number(req.params.id);
      if (!Number.isInteger(leadId) || leadId <= 0) return res.status(400).json({ message: "Invalid lead ID" });
      if ((req.user as { role?: string })?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
      const { reason } = req.body;
      const { blockAutomation } = await import("../services/sdr/human-handoff");
      const result = await blockAutomation(leadId, reason);
      if (!result.success) return res.status(400).json({ message: result.error });
      res.json({ success: true });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.post("/api/proposals/:trackingId/mark-viewed", async (req, res) => {
    try {
      const trackingId = req.params.trackingId;
      if (!trackingId || trackingId.length < 16) return res.status(400).json({ message: "Invalid tracking ID" });
      const { markProposalViewedByTrackingId } = await import("../services/sdr/proposal-tracking");
      const result = await markProposalViewedByTrackingId(trackingId);
      res.json({ success: result });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.post("/api/proposals/:trackingId/mark-clicked", async (req, res) => {
    try {
      const trackingId = req.params.trackingId;
      if (!trackingId || trackingId.length < 16) return res.status(400).json({ message: "Invalid tracking ID" });
      const { markProposalClickedByTrackingId } = await import("../services/sdr/proposal-tracking");
      const result = await markProposalClickedByTrackingId(trackingId);
      res.json({ success: result });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.post("/api/sdr/leads/:id/terminal-shipped", isAuthenticated, async (req, res) => {
    try {
      const leadId = Number(req.params.id);
      if (!Number.isInteger(leadId) || leadId <= 0) return res.status(400).json({ message: "Invalid lead ID" });
      if ((req.user as { role?: string })?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
      const { trackingNumber } = req.body;
      if (!trackingNumber || typeof trackingNumber !== "string") return res.status(400).json({ message: "trackingNumber required" });
      const { handleTerminalShipped } = await import("../services/sdr/terminal-shipping");
      const result = await handleTerminalShipped(leadId, trackingNumber);
      res.json({ success: result });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.get("/api/statement-upload/:token", async (req, res) => {
    try {
      const { findLeadByUploadToken } = await import("../services/sdr/statement-flow");
      const lead = await findLeadByUploadToken(req.params.token);
      if (!lead) return res.status(404).json({ message: "Invalid or expired upload link" });
      res.json({ merchantId: lead.merchantId, companyName: lead.companyName, valid: true });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.post("/api/statement-upload/:token", async (req, res) => {
    try {
      const { findLeadByUploadToken, handleStatementReceived } = await import("../services/sdr/statement-flow");
      const lead = await findLeadByUploadToken(req.params.token);
      if (!lead) return res.status(404).json({ message: "Invalid or expired upload link" });
      const result = await handleStatementReceived(lead.id);
      res.json({ success: result });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  setInterval(async () => {
    try {
      const scheduled = await storage.getScheduledBlogPosts();
      const now = new Date();
      for (const post of scheduled) {
        if (post.scheduledAt && new Date(post.scheduledAt) <= now) {
          await storage.publishBlogPost(post.id);
          console.log(`[Blog Scheduler] Auto-published: ${post.slug}`);
        }
      }
    } catch (err) {
      console.error("[Blog Scheduler] Error:", err);
    }
  }, 60 * 60 * 1000);

  app.get("/api/sdr/dashboard", isAuthenticated, async (req, res) => {
    try {
      const stats = await getSdrDashboardStats();
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/sdr/leads", isAuthenticated, async (req, res) => {
    try {
      const { stage, priorityBucket, limit } = req.query;
      const leads = await storage.getSdrLeadStates({
        stage: stage as string | undefined,
        priorityBucket: priorityBucket as string | undefined,
        limit: limit ? parseInt(limit as string) : undefined,
      });
      res.json(leads);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/sdr/leads/:id", isAuthenticated, async (req, res) => {
    const lead = await storage.getSdrLeadState(Number(req.params.id));
    if (!lead) return res.status(404).json({ message: "Lead not found" });
    const events = await storage.getSdrLeadEvents(lead.id);
    const attempts = await storage.getSdrChannelAttempts(lead.id);
    res.json({ lead, events, attempts });
  });

  app.post("/api/sdr/leads/:id/score", isAuthenticated, async (req, res) => {
    try {
      const lead = await storage.getSdrLeadState(Number(req.params.id));
      if (!lead) return res.status(404).json({ message: "Lead not found" });
      const scores = scoreLeadFull(lead);
      const updated = await storage.updateSdrLeadState(lead.id, {
        fitScore: scores.fitScore,
        revenueScore: scores.revenueScore,
        reachabilityScore: scores.reachabilityScore,
        priorityScore: scores.priorityScore,
        priorityBucket: scores.priorityBucket,
        scoreBreakdown: scores.breakdown,
        lastScoredAt: new Date(),
      });
      res.json({ scores, lead: updated });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/sdr/leads/:id", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin/Manager only" });
    try {
      const allowedFields = ["stage", "consentEmail", "consentSms", "consentCall", "optedOutEmail", "optedOutSms", "pausedUntil", "vertical", "companyName", "ownerName", "ownerEmail", "ownerPhone", "decisionReason"];
      const sanitized: Record<string, any> = {};
      for (const key of allowedFields) {
        if (req.body[key] !== undefined) sanitized[key] = req.body[key];
      }
      if (Object.keys(sanitized).length === 0) return res.status(400).json({ message: "No valid fields provided" });
      const updated = await storage.updateSdrLeadState(Number(req.params.id), sanitized);
      if (!updated) return res.status(404).json({ message: "Lead not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/sdr/orchestrator/sweep", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin/Manager only" });
    try {
      const result = await sweepLeads();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/sdr/orchestrator/start", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    if (!featureFlags.ORCHESTRATOR_ENABLED) {
      return res.status(400).json({ success: false, message: "Orchestrator is disabled via ORCHESTRATOR_ENABLED feature flag" });
    }
    startOrchestrator();
    res.json({ success: true, message: "Orchestrator started" });
  });

  app.post("/api/sdr/orchestrator/stop", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    stopOrchestrator();
    res.json({ success: true, message: "Orchestrator stopped" });
  });

  app.get("/api/sdr/orchestrator/status", isAuthenticated, async (req, res) => {
    res.json({
      running: isOrchestratorRunning(),
      enabled: featureFlags.ORCHESTRATOR_ENABLED,
      webhookFailures: getWebhookFailureCount(),
      dailyLimits: getDailyLimits(),
    });
  });

  app.post("/api/sdr/bridge-contacts", isAuthenticated, async (_req, res) => {
    res.status(410).json({ message: "Deprecated — use POST /api/sdr/bridge with source='contacts' instead" });
  });

  app.get("/api/sdr/daily-limits", isAuthenticated, async (req, res) => {
    res.json(getDailyLimits());
  });

  app.get("/api/sdr/voice-scripts", isAuthenticated, async (_req, res) => {
    res.json(getAllVoiceScripts());
  });

  app.get("/api/sdr/voice-scripts/:verticalKey", isAuthenticated, async (req, res) => {
    const script = getVoiceScript(req.params.verticalKey as string);
    if (!script) return res.status(404).json({ message: "Voice script not found for vertical: " + req.params.verticalKey });
    res.json(script);
  });

  app.post("/api/sdr/voice-scripts/resolve", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager', 'agent'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Insufficient permissions" });
    try {
      const { leadId, agentName } = req.body;
      if (!leadId) return res.status(400).json({ message: "leadId required" });

      const leads = await db.select().from(sdrLeadState).where(eq(sdrLeadState.id, leadId)).limit(1);
      const lead = leads[0];
      if (!lead) return res.status(404).json({ message: "Lead not found" });

      const script = resolveVoiceScriptForLead(lead);
      if (!script) return res.json({ script: null, reason: "No vertical-specific voice script available for this lead" });

      const personalized = personalizeVoiceScript(script, lead, agentName || "a team member");
      const ghlPayload = buildGhlVoicePayload(script, lead, agentName || "a team member");
      res.json({ script: personalized, ghlPayload });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/sdr/sending-identities", isAdmin, async (_req, res) => {
    try {
      const identities = await storage.getSendingIdentities();
      res.json(identities);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/sdr/sending-identities/:id", isAdmin, async (req, res) => {
    try {
      const identity = await storage.getSendingIdentity(Number(req.params.id));
      if (!identity) return res.status(404).json({ message: "Not found" });
      res.json(identity);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/sdr/sending-identities", isAdmin, async (req, res) => {
    try {
      const { insertSendingIdentitySchema } = await import("@shared/schema");
      const { clampDailyLimit } = await import("../services/sdr/inbox-rotation");
      const parsed = insertSendingIdentitySchema.parse(req.body);
      if (parsed.dailyLimit !== undefined && parsed.dailyLimit !== null) {
        parsed.dailyLimit = clampDailyLimit(parsed.dailyLimit);
      }
      const identity = await storage.createSendingIdentity(parsed);
      res.status(201).json(identity);
    } catch (err: unknown) {
      const error = err as { name?: string; message?: string; errors?: unknown[] };
      if (error.name === "ZodError") return res.status(400).json({ message: "Validation error", errors: error.errors });
      res.status(500).json({ message: error.message });
    }
  });

  app.put("/api/sdr/sending-identities/:id", isAdmin, async (req, res) => {
    try {
      const { insertSendingIdentitySchema } = await import("@shared/schema");
      const { clampDailyLimit } = await import("../services/sdr/inbox-rotation");
      const updateSchema = insertSendingIdentitySchema.partial();
      const parsed = updateSchema.parse(req.body);
      if (parsed.dailyLimit !== undefined && parsed.dailyLimit !== null) {
        parsed.dailyLimit = clampDailyLimit(parsed.dailyLimit);
      }
      const identity = await storage.updateSendingIdentity(Number(req.params.id), parsed);
      if (!identity) return res.status(404).json({ message: "Not found" });
      res.json(identity);
    } catch (err: unknown) {
      const error = err as { name?: string; message?: string; errors?: unknown[] };
      if (error.name === "ZodError") return res.status(400).json({ message: "Validation error", errors: error.errors });
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/sdr/sending-identities/:id", isAdmin, async (req, res) => {
    try {
      const deleted = await storage.deleteSendingIdentity(Number(req.params.id));
      if (!deleted) return res.status(404).json({ message: "Not found" });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/sdr/inbox-health", isAdmin, async (_req, res) => {
    try {
      const { getInboxHealthDashboard } = await import("../services/sdr/inbox-rotation");
      const dashboard = await getInboxHealthDashboard();
      res.json(dashboard);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/sdr/inbox-maintenance", isAdmin, async (_req, res) => {
    try {
      const { runDailyMaintenance } = await import("../services/sdr/inbox-rotation");
      const result = await runDailyMaintenance();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/sdr/inbox-health-scores", isAdmin, async (_req, res) => {
    try {
      const { calculateHealthScores } = await import("../services/sdr/inbox-rotation");
      const result = await calculateHealthScores();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/sdr/processor-intelligence", isAuthenticated, async (_req, res) => {
    try {
      const { getProcessorDistribution, getProcessorCoverage, getConversionByProcessor } = await import("../services/sdr/processor-detector");
      const { getAdDistribution } = await import("../services/sdr/ad-detector");
      const [distribution, coverage, adDist, conversionByProcessor] = await Promise.all([
        getProcessorDistribution(),
        getProcessorCoverage(),
        getAdDistribution(),
        getConversionByProcessor(),
      ]);
      res.json({ processorDistribution: distribution, coverage, adDistribution: adDist, conversionByProcessor });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/sdr/processor-signals/:businessId", isAuthenticated, async (req, res) => {
    const businessId = Number(req.params.businessId);
    if (!businessId || isNaN(businessId)) return res.status(400).json({ message: "Invalid business ID" });
    try {
      const { getProcessorSignals } = await import("../services/sdr/processor-detector");
      const signals = await getProcessorSignals(businessId);
      res.json(signals);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/sdr/detect-processors/:businessId", isAuthenticated, async (req, res) => {
    const businessId = Number(req.params.businessId);
    if (!businessId || isNaN(businessId)) return res.status(400).json({ message: "Invalid business ID" });
    try {
      const { detectProcessors } = await import("../services/sdr/processor-detector");
      const results = await detectProcessors(businessId);
      res.json({ detected: results.length, results });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/sdr/ad-signals/:businessId", isAuthenticated, async (req, res) => {
    const businessId = Number(req.params.businessId);
    if (!businessId || isNaN(businessId)) return res.status(400).json({ message: "Invalid business ID" });
    try {
      const { getAdSignals } = await import("../services/sdr/ad-detector");
      const signals = await getAdSignals(businessId);
      res.json(signals);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/sdr/detect-ads/:businessId", isAuthenticated, async (req, res) => {
    const businessId = Number(req.params.businessId);
    if (!businessId || isNaN(businessId)) return res.status(400).json({ message: "Invalid business ID" });
    try {
      const { detectAds } = await import("../services/sdr/ad-detector");
      const results = await detectAds(businessId);
      res.json({ detected: results.length, results });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/businesses", isAuthenticated, async (req, res) => {
    try {
      const { status, vertical, limit } = req.query;
      const result = await storage.getBusinesses({
        status: status as string | undefined,
        vertical: vertical as string | undefined,
        limit: limit ? Number(limit) : undefined,
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/businesses", isAuthenticated, async (req, res) => {
    try {
      const input = insertBusinessSchema.parse(req.body);
      const biz = await storage.createBusiness(input);
      res.status(201).json(biz);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/businesses/ingest", isAuthenticated, async (req, res) => {
    try {
      const result = await ingestBusiness(req.body);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/businesses/bridge-contacts", isAuthenticated, async (_req, res) => {
    res.status(410).json({ message: "Deprecated — use POST /api/sdr/bridge with source='contacts' instead" });
  });

  app.get("/api/businesses/dedupe/stats", isAuthenticated, async (_req, res) => {
    try {
      const stats = await getDedupeStats();
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/businesses/:id", isAuthenticated, async (req, res) => {
    try {
      const biz = await storage.getBusiness(Number(req.params.id));
      if (!biz) return res.status(404).json({ message: "Business not found" });
      res.json(biz);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/businesses/:id", isAuthenticated, async (req, res) => {
    try {
      const partial = insertBusinessSchema.partial().parse(req.body);
      const biz = await storage.updateBusiness(Number(req.params.id), partial);
      if (!biz) return res.status(404).json({ message: "Business not found" });
      res.json(biz);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/businesses/:id/aliases", isAuthenticated, async (req, res) => {
    try {
      const aliases = await storage.getBusinessAliases(Number(req.params.id));
      res.json(aliases);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/businesses/:id/aliases", isAuthenticated, async (req, res) => {
    try {
      const input = insertBusinessAliasSchema.parse({ ...req.body, businessId: Number(req.params.id) });
      const alias = await storage.createBusinessAlias(input);
      res.status(201).json(alias);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/businesses/:id/locations", isAuthenticated, async (req, res) => {
    try {
      const locations = await storage.getBusinessLocations(Number(req.params.id));
      res.json(locations);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/businesses/:id/locations", isAuthenticated, async (req, res) => {
    try {
      const input = insertBusinessLocationSchema.parse({ ...req.body, businessId: Number(req.params.id) });
      const loc = await storage.createBusinessLocation(input);
      res.status(201).json(loc);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/businesses/:id/sources", isAuthenticated, async (req, res) => {
    try {
      const sources = await storage.getLeadSources(Number(req.params.id));
      res.json(sources);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/businesses/:id/enrichment-runs", isAuthenticated, async (req, res) => {
    try {
      const runs = await storage.getEnrichmentRuns(Number(req.params.id));
      res.json(runs);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/lead-sources", isAuthenticated, async (req, res) => {
    try {
      const sources = await storage.getLeadSources();
      res.json(sources);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/lead-sources", isAuthenticated, async (req, res) => {
    try {
      const input = insertLeadSourceSchema.parse(req.body);
      const source = await storage.createLeadSource(input);
      res.status(201).json(source);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/lead-sources/by-batch/:batchId", isAuthenticated, async (req, res) => {
    try {
      const sources = await storage.getLeadSourcesByBatch(req.params.batchId as string);
      res.json(sources);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/sdr/lookalike/profile", isAuthenticated, async (_req, res) => {
    try {
      const { getLookalikeProfile } = await import("../services/sdr/lookalike");
      const profile = await getLookalikeProfile();
      res.json(profile);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.get("/api/sdr/lookalike/top", isAuthenticated, async (req, res) => {
    try {
      const { getTopLookalikes } = await import("../services/sdr/lookalike");
      const limit = parseInt(req.query.limit as string) || 20;
      const top = await getTopLookalikes(limit);
      res.json(top);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.post("/api/sdr/lookalike/apply", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin only" });
    try {
      const { applyLookalikeBoosts } = await import("../services/sdr/lookalike");
      const result = await applyLookalikeBoosts();
      res.json(result);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.get("/api/sdr/re-enrichment/stats", isAuthenticated, async (_req, res) => {
    try {
      const { getReEnrichmentStats } = await import("../services/sdr/re-enrichment");
      const stats = await getReEnrichmentStats();
      res.json(stats);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.post("/api/sdr/re-enrichment/run", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin only" });
    try {
      const { runReEnrichmentCycle, isReEnrichmentRunning } = await import("../services/sdr/re-enrichment");
      if (isReEnrichmentRunning()) {
        return res.status(409).json({ message: "Re-enrichment is already running" });
      }
      res.json({ message: "Re-enrichment cycle started", started: true });
      runReEnrichmentCycle().catch(err => console.error("[ReEnrich API] Error:", err));
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.get("/api/sdr/funnel-metrics", isAuthenticated, async (req, res) => {
    try {
      const { getFunnelMetrics } = await import("../services/sdr/funnel-metrics");
      const metrics = await getFunnelMetrics({
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        vertical: req.query.vertical as string,
        state: req.query.state as string,
        sourceType: req.query.sourceType as string,
      });
      res.json(metrics);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.post("/api/sdr/funnel-metrics/aggregate", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin only" });
    try {
      const { aggregateDailyMetrics } = await import("../services/sdr/funnel-metrics");
      const dateStr = req.body.date as string | undefined;
      await aggregateDailyMetrics(dateStr);
      res.json({ message: "Aggregation complete" });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.get("/api/sdr/source-quality", isAuthenticated, async (_req, res) => {
    try {
      const { getSourceQualityReport } = await import("../services/sdr/funnel-metrics");
      const report = await getSourceQualityReport();
      res.json(report);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.get("/api/sdr/identity-health", isAuthenticated, async (_req, res) => {
    try {
      const { getIdentityHealthReport } = await import("../services/sdr/funnel-metrics");
      const report = await getIdentityHealthReport();
      res.json(report);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.get("/api/sdr/market-expansion", isAuthenticated, async (_req, res) => {
    try {
      const { getMarketExpansionData } = await import("../services/sdr/funnel-metrics");
      const data = await getMarketExpansionData();
      res.json(data);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.get("/api/sdr/weekly-kpi", isAuthenticated, async (_req, res) => {
    try {
      const { getWeeklyKpiDigestData } = await import("../services/sdr/funnel-metrics");
      const data = await getWeeklyKpiDigestData();
      res.json(data);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.get("/api/sdr/operator/kpis", isAdmin, async (req, res) => {
    try {
      const { getOperatorKpis } = await import("../services/sdr/funnel-metrics");
      const range = (req.query.range as string) || "today";
      const data = await getOperatorKpis(range);
      res.json(data);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.get("/api/sdr/operator/send-monitoring", isAdmin, async (_req, res) => {
    try {
      const { getSendMonitoringData } = await import("../services/sdr/funnel-metrics");
      const data = await getSendMonitoringData();
      res.json(data);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.get("/api/sdr/operator/webhook-events", isAdmin, async (req, res) => {
    try {
      const { getWebhookEventLog } = await import("../services/sdr/funnel-metrics");
      const eventType = req.query.eventType as string | undefined;
      const limit = parseInt(req.query.limit as string) || 50;
      const data = await getWebhookEventLog({ eventType, limit });
      res.json(data);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.get("/api/sdr/operator/low-confidence", isAdmin, async (_req, res) => {
    try {
      const { getLowConfidenceClassifications } = await import("../services/sdr/funnel-metrics");
      const data = await getLowConfidenceClassifications();
      res.json(data);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.get("/api/sdr/operator/bounce-feedback-summary", isAdmin, async (_req, res) => {
    try {
      const { getBounceFeedbackSummary } = await import("../services/bounce-feedback");
      const data = await getBounceFeedbackSummary();
      res.json(data);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.post("/api/sdr/operator/send-daily-digest", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin only" });
    try {
      const { buildSdrDailyDigest, sendSdrDailyDigest } = await import("../services/sdr/operator-digest");
      const digest = await buildSdrDailyDigest();
      await sendSdrDailyDigest(digest);
      res.json({ message: "Daily digest sent", summary: digest.summary });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.get("/api/sdr/anomaly-alerts", isAuthenticated, async (_req, res) => {
    try {
      const { getAnomalyAlertsSummary } = await import("../services/sdr/anomaly-detection");
      const data = await getAnomalyAlertsSummary();
      res.json(data);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.get("/api/operator/job-status", isAdmin, async (_req, res) => {
    try {
      const { getJobStatuses } = await import("../services/job-registry");
      const jobs = await getJobStatuses();
      res.json({ jobs });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.get("/api/sdr/serper-enrichment/metrics", isAuthenticated, async (_req, res) => {
    try {
      const { getSerperEnrichmentMetrics } = await import("../services/sdr/serper-enrichment");
      const metrics = await getSerperEnrichmentMetrics();
      res.json(metrics);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.post("/api/sdr/serper-enrichment/run", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin only" });
    try {
      const { runSerperEnrichmentBatch } = await import("../services/sdr/serper-enrichment");
      const limit = parseInt(req.body.limit as string || "50", 10);
      const stats = await runSerperEnrichmentBatch(limit);
      res.json(stats);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.post("/api/sdr/serper-enrichment/merchant/:id", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin only" });
    try {
      const { enrichMerchantWithSerper } = await import("../services/sdr/serper-enrichment");
      const merchantId = parseInt(req.params.id, 10);
      const result = await enrichMerchantWithSerper(merchantId);
      res.json(result);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.post("/api/sdr/sending-identities/bulk-action", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin only" });
    try {
      const { action, identityIds } = req.body as { action: "pause" | "resume"; identityIds: number[] };
      if (!action || !["pause", "resume"].includes(action) || !identityIds || !Array.isArray(identityIds) || identityIds.length === 0) {
        return res.status(400).json({ message: "action must be 'pause' or 'resume', identityIds must be a non-empty array" });
      }

      const { sendingIdentities } = await import("@shared/schema");
      const { inArray } = await import("drizzle-orm");

      if (action === "pause") {
        await db.update(sendingIdentities).set({
          isActive: false,
          warmupStatus: "paused",
          updatedAt: new Date(),
        }).where(inArray(sendingIdentities.id, identityIds));
      } else if (action === "resume") {
        await db.update(sendingIdentities).set({
          isActive: true,
          warmupStatus: "warming",
          warmupStartedAt: new Date(),
          updatedAt: new Date(),
        }).where(inArray(sendingIdentities.id, identityIds));
      }

      res.json({ message: `${action}d ${identityIds.length} identities`, count: identityIds.length });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.get("/api/sdr/discovery-controls", isAuthenticated, async (_req, res) => {
    try {
      const { getSearchMatrix, isNightlyDiscoveryRunning, isDiscoveryRunning } = await import("../services/sdr/lead-finder");
      const matrix = await getSearchMatrix();
      res.json({
        ...matrix,
        nightlySchedulerRunning: isNightlyDiscoveryRunning(),
        discoveryInProgress: isDiscoveryRunning(),
        nightlyDiscoveryEnabled: featureFlags.NIGHTLY_DISCOVERY_ENABLED,
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.put("/api/sdr/discovery-controls", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin only" });
    try {
      const { updateSearchMatrix } = await import("../services/sdr/lead-finder");
      const updated = await updateSearchMatrix(req.body);
      res.json(updated);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.get("/api/sdr/voice-ai/status", isAuthenticated, async (_req, res) => {
    try {
      const { getAllVoiceScripts } = await import("../services/sdr/voice-orchestrator");
      const scripts = getAllVoiceScripts();
      res.json({
        voiceAiEnabled: featureFlags.VOICE_AI_ENABLED,
        configuredScripts: scripts.map(s => ({
          verticalKey: s.verticalKey,
          verticalLabel: s.verticalLabel,
          hasOpening: !!s.opening,
          hasQualifyingQuestions: s.qualifyingQuestions.length > 0,
          hasObjectionHandlers: Object.keys(s.objectionHandlers).length > 0,
          hasComplianceDisclosure: !!s.complianceDisclosure,
        })),
        totalScripts: scripts.length,
        readyForActivation: scripts.length > 0 && scripts.every(s =>
          s.opening && s.qualifyingQuestions.length > 0 && s.complianceDisclosure
        ),
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.get("/api/sdr/sms-metrics", isAuthenticated, async (_req, res) => {
    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const smsAttempts = await db.select({
        total: sql<number>`count(*)`,
        sent: sql<number>`count(case when ${sdrChannelAttempts.status} = 'sent' then 1 end)`,
        failed: sql<number>`count(case when ${sdrChannelAttempts.status} = 'failed' then 1 end)`,
        replied: sql<number>`count(case when ${sdrChannelAttempts.repliedAt} is not null then 1 end)`,
      }).from(sdrChannelAttempts).where(
        sql`${sdrChannelAttempts.channel} = 'sms' AND ${sdrChannelAttempts.sentAt} >= ${todayStart}`
      );

      const stats = smsAttempts[0] || { total: 0, sent: 0, failed: 0, replied: 0 };

      res.json({
        smsEnabled: featureFlags.SMS_ENABLED,
        today: {
          total: Number(stats.total),
          sent: Number(stats.sent),
          failed: Number(stats.failed),
          replied: Number(stats.replied),
          replyRate: Number(stats.sent) > 0 ? Math.round((Number(stats.replied) / Number(stats.sent)) * 100) : 0,
        },
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.get("/api/sdr/ghl-enrollment/status", isAuthenticated, async (_req, res) => {
    try {
      const status = getEnrollmentStatus();
      res.json(status);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.get("/api/sdr/ghl-enrollment/mappings", isAuthenticated, async (_req, res) => {
    try {
      const mappings = getWorkflowMappings();
      const smartListTags = getInboxSmartListTags();
      res.json({ mappings, smartListTags });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.get("/api/sdr/merchants/:id/contacts", isAuthenticated, async (req, res) => {
    try {
      const merchantId = parseInt(req.params.id, 10);
      if (isNaN(merchantId)) {
        return res.status(400).json({ message: "Invalid merchant ID" });
      }
      const { sdrMerchants: merchants, sdrMerchantContacts: contactsTable } = await import("@shared/schema");
      const rows = await db
        .select({
          id: contactsTable.id,
          merchantId: contactsTable.merchantId,
          merchantSource: merchants.source,
          contactName: contactsTable.contactName,
          title: contactsTable.title,
          email: contactsTable.email,
          mobile: contactsTable.mobile,
          directPhone: contactsTable.directPhone,
          primaryContactFlag: contactsTable.primaryContactFlag,
          roleGuess: contactsTable.roleGuess,
          bestContactChannel: contactsTable.bestContactChannel,
          createdAt: contactsTable.createdAt,
        })
        .from(contactsTable)
        .leftJoin(merchants, eq(contactsTable.merchantId, merchants.id))
        .where(eq(contactsTable.merchantId, merchantId));
      res.json(rows);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.get("/api/sdr/merchant-contacts", isAuthenticated, async (_req, res) => {
    try {
      const { sdrMerchants: merchants, sdrMerchantContacts: contactsTable } = await import("@shared/schema");
      const rows = await db
        .select({
          contactId: contactsTable.id,
          merchantId: contactsTable.merchantId,
          businessName: merchants.businessName,
          source: merchants.source,
          contactName: contactsTable.contactName,
          title: contactsTable.title,
          email: contactsTable.email,
          mobile: contactsTable.mobile,
          directPhone: contactsTable.directPhone,
          primaryContactFlag: contactsTable.primaryContactFlag,
          roleGuess: contactsTable.roleGuess,
          bestContactChannel: contactsTable.bestContactChannel,
          createdAt: contactsTable.createdAt,
        })
        .from(contactsTable)
        .innerJoin(merchants, eq(contactsTable.merchantId, merchants.id))
        .orderBy(desc(contactsTable.createdAt));
      res.json(rows);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  // ── Enrollment Subject Audit ──────────────────────────────────────────────

  app.get("/api/operator/enrollment-subject-audit", isAdmin, async (_req, res) => {
    try {
      const { sequenceEnrollments, followUpSequences, sequenceSteps } = await import("@shared/schema");
      const { and, gt, inArray } = await import("drizzle-orm");

      const activeEnrollments = await db
        .select({
          id: sequenceEnrollments.id,
          contactId: sequenceEnrollments.contactId,
          dealId: sequenceEnrollments.dealId,
          sequenceId: sequenceEnrollments.sequenceId,
          currentStep: sequenceEnrollments.currentStep,
          status: sequenceEnrollments.status,
          nextActionAt: sequenceEnrollments.nextActionAt,
          updatedAt: sequenceEnrollments.updatedAt,
          sequenceName: followUpSequences.name,
        })
        .from(sequenceEnrollments)
        .leftJoin(followUpSequences, eq(sequenceEnrollments.sequenceId, followUpSequences.id))
        .where(eq(sequenceEnrollments.status, "active"));

      const midSequence = activeEnrollments.filter(e => (e.currentStep ?? 0) > 0);

      const nextSteps = midSequence.length > 0
        ? await db
            .select({
              sequenceId: sequenceSteps.sequenceId,
              stepOrder: sequenceSteps.stepOrder,
              subject: sequenceSteps.subject,
              actionType: sequenceSteps.actionType,
            })
            .from(sequenceSteps)
            .where(
              inArray(
                sequenceSteps.sequenceId,
                [...new Set(midSequence.map(e => e.sequenceId).filter((id): id is number => id != null))]
              )
            )
        : [];

      const items = midSequence.map(e => {
        const nextStep = nextSteps.find(
          s => s.sequenceId === e.sequenceId && s.stepOrder === (e.currentStep ?? 0)
        );
        return {
          ...e,
          nextStepSubject: nextStep?.subject ?? null,
          nextStepType: nextStep?.actionType ?? null,
        };
      });

      res.json({
        totalActive: activeEnrollments.length,
        midSequenceCount: midSequence.length,
        items,
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.post("/api/operator/enrollment-subject-audit/retrigger", isAdmin, async (_req, res) => {
    try {
      const { sequenceEnrollments } = await import("@shared/schema");
      const { and, gt } = await import("drizzle-orm");

      const now = new Date();
      const result = await db
        .update(sequenceEnrollments)
        .set({ nextActionAt: now, updatedAt: now })
        .where(
          and(
            eq(sequenceEnrollments.status, "active"),
            gt(sequenceEnrollments.currentStep, 0)
          )
        )
        .returning({ id: sequenceEnrollments.id });

      res.json({
        message: `Re-triggered ${result.length} mid-sequence enrollment(s). The next step for each will be sent on the next sequence-worker tick using updated subject lines.`,
        count: result.length,
        retriggeredIds: result.map(r => r.id),
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  // ── Sync Conflicts ────────────────────────────────────────────────────────

  app.get("/api/operator/sync-conflicts", isAdmin, async (req, res) => {
    try {
      const resolution = req.query.resolution as string | undefined;
      const conflicts = await storage.getSyncConflicts(resolution);
      res.json(conflicts);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.patch("/api/operator/sync-conflicts/:id/resolve", isAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { resolution } = req.body as { resolution: "kept-internal" | "kept-ghl" | "manual" };
      if (!["kept-internal", "kept-ghl", "manual"].includes(resolution)) {
        return res.status(400).json({ message: "Invalid resolution value" });
      }

      const conflicts = await storage.getSyncConflicts();
      const conflict = conflicts.find(c => c.id === id);
      if (!conflict) return res.status(404).json({ message: "Conflict not found" });

      const { upsertGhlContact } = await import("../services/ghl");

      if (resolution === "kept-ghl") {
        const ghlVal = conflict.ghlValue ?? "";
        const updatePayload: import("@shared/schema").UpdateContactRequest = {};
        switch (conflict.fieldName) {
          case "firstName":   updatePayload.firstName   = ghlVal; break;
          case "lastName":    updatePayload.lastName    = ghlVal; break;
          case "email":       updatePayload.email       = ghlVal; break;
          case "phone":       updatePayload.phone       = ghlVal; break;
          case "companyName": updatePayload.companyName = ghlVal; break;
          default:
            return res.status(400).json({ message: `Field '${conflict.fieldName}' cannot be resolved via this endpoint` });
        }
        await storage.updateContact(conflict.contactId, updatePayload);
        const contact = await storage.getContact(conflict.contactId);
        if (contact?.ghlContactId) {
          try {
            await upsertGhlContact(contact);
          } catch (ghlErr: unknown) {
            const msg = ghlErr instanceof Error ? ghlErr.message : String(ghlErr);
            console.error(`[Sync Conflict] GHL write failed for kept-ghl resolution #${id}: ${msg}`);
            return res.status(502).json({ message: `DB updated but GHL sync failed: ${msg}` });
          }
        }
      } else if (resolution === "kept-internal") {
        const contact = await storage.getContact(conflict.contactId);
        if (contact?.ghlContactId) {
          try {
            await upsertGhlContact(contact);
          } catch (ghlErr: unknown) {
            const msg = ghlErr instanceof Error ? ghlErr.message : String(ghlErr);
            console.error(`[Sync Conflict] GHL write failed for kept-internal resolution #${id}: ${msg}`);
            return res.status(502).json({ message: `GHL sync failed — conflict remains pending: ${msg}` });
          }
        }
      }
      // resolution === "manual" requires no system writes — admin has handled it externally

      const updated = await storage.resolveSyncConflict(id, resolution);
      res.json(updated);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

  app.get("/api/operator/bounce-stats", isAdmin, async (req, res) => {
    try {
      const { db } = await import("../db");
      const { contacts, auditLogs } = await import("@shared/schema");
      const { gte, eq, like, and, count, inArray, sql } = await import("drizzle-orm");

      const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 90);
      const windowStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const FAILURE_EVENT_TYPES = [
        "comm_event_email_bounce",
        "comm_event_sms_undeliverable",
        "comm_event_call_no_answer",
        "comm_event_call_busy",
        "comm_event_voicemail_left",
      ];

      const [unreachableCount] = await db
        .select({ count: count() })
        .from(contacts)
        .where(eq(contacts.doNotAutoContact, true));

      const [emailBouncedTotal] = await db
        .select({ count: count() })
        .from(contacts)
        .where(eq(contacts.emailStatus, "bounced"));

      const [smsUndeliverableTotal] = await db
        .select({ count: count() })
        .from(contacts)
        .where(eq(contacts.smsStatus, "undeliverable"));

      const [emailBounceEvents7d] = await db
        .select({ count: count() })
        .from(auditLogs)
        .where(and(eq(auditLogs.action, "comm_event_email_bounce"), gte(auditLogs.createdAt, windowStart)));

      const [emailTotalEvents7d] = await db
        .select({ count: count() })
        .from(auditLogs)
        .where(and(like(auditLogs.action, "comm_event_email_%"), gte(auditLogs.createdAt, windowStart)));

      const [smsFailEvents7d] = await db
        .select({ count: count() })
        .from(auditLogs)
        .where(and(eq(auditLogs.action, "comm_event_sms_undeliverable"), gte(auditLogs.createdAt, windowStart)));

      const [smsTotalEvents7d] = await db
        .select({ count: count() })
        .from(auditLogs)
        .where(and(like(auditLogs.action, "comm_event_sms_%"), gte(auditLogs.createdAt, windowStart)));

      const [todayFailureEvents] = await db
        .select({ count: count() })
        .from(auditLogs)
        .where(and(inArray(auditLogs.action, FAILURE_EVENT_TYPES), gte(auditLogs.createdAt, todayStart)));

      const recentFailureRows = await db
        .select({ action: auditLogs.action })
        .from(auditLogs)
        .where(and(inArray(auditLogs.action, FAILURE_EVENT_TYPES), gte(auditLogs.createdAt, windowStart)))
        .orderBy(sql`${auditLogs.createdAt} DESC`)
        .limit(500);

      const failureReasonMap: Record<string, number> = {};
      for (const row of recentFailureRows) {
        const label = row.action.replace("comm_event_", "");
        failureReasonMap[label] = (failureReasonMap[label] ?? 0) + 1;
      }
      const topFailureReasons = Object.entries(failureReasonMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([reason, count]) => ({ reason, count }));

      const emailBounceRate = (emailTotalEvents7d.count || 0) > 0
        ? Number(((emailBounceEvents7d.count / emailTotalEvents7d.count) * 100).toFixed(1))
        : 0;
      const smsFailureRate = (smsTotalEvents7d.count || 0) > 0
        ? Number(((smsFailEvents7d.count / smsTotalEvents7d.count) * 100).toFixed(1))
        : 0;

      res.json({
        windowDays: days,
        emailBounceRate,
        smsFailureRate,
        emailBouncedTotal: emailBouncedTotal.count,
        smsUndeliverableTotal: smsUndeliverableTotal.count,
        unreachableContactCount: unreachableCount.count,
        todayFailureEvents: todayFailureEvents.count,
        topFailureReasons,
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
    }
  });

}
