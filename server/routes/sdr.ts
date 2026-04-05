import type { Express, Request as ExpressRequest } from "express";
import { isAuthenticated, isAdmin } from "../replit_integrations/auth";
import { storage } from "../storage";
import { db, pool } from "../db";
import { z } from "zod";
import { contacts, insertBusinessAliasSchema, insertBusinessLocationSchema, insertBusinessSchema, insertLeadSourceSchema, sdrLeadState, sdrChannelAttempts, sdrLeadEvents, sdrMerchants } from "@shared/schema";
import { eq, sql, desc } from "drizzle-orm";
import { getSerperUsage, isSerperConfigured } from "../services/serper";
import { scoreLeadFull } from "../services/sdr/scoring";
import { bridgeContactsToSdr, getDailyLimits, getSdrDashboardStats, isOrchestratorRunning, startOrchestrator, stopOrchestrator, sweepLeads, pauseAll, resumeAll, isGloballyPaused, getGlobalPauseReason, getLastSweepTime, getLastSweepErrors, trackWebhookFailure, getWebhookFailureCount } from "../services/sdr/orchestrator";
import { buildGhlVoicePayload, getAllVoiceScripts, getVoiceScript, personalizeVoiceScript, resolveVoiceScriptForLead } from "../services/sdr/voice-orchestrator";
import { bridgeContactsToBusinesses, getDedupeStats, ingestBusiness } from "../services/sdr/dedupe";
import { getAllFlags, featureFlags } from "../services/feature-flags";
import { parse } from "csv-parse/sync";

export function registerSdrRoutes(app: Express) {
  // === HEALTH ENDPOINTS ===
  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/health", async (_req, res) => {
    const uptime = process.uptime();
    let dbOk = false;
    let sessionOk = false;
    try {
      const result = await pool.query("SELECT 1 AS check");
      dbOk = result.rows.length > 0;
    } catch {}
    try {
      const sessResult = await pool.query("SELECT COUNT(*) FROM sessions");
      sessionOk = sessResult.rows.length > 0;
    } catch {}
    res.json({
      ok: dbOk && sessionOk,
      uptime: Math.floor(uptime),
      db: dbOk ? "connected" : "error",
      session: sessionOk ? "connected" : "error",
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/api/ghl/health", isAuthenticated, async (_req, res) => {
    try {
      const { getSdrGhlConfig, isSdrGhlConfigured } = await import("../services/sdr/ghl-client");
      const config = getSdrGhlConfig();
      let authTest = false;
      if (isSdrGhlConfigured()) {
        try {
          const { fetchCalendars } = await import("../services/sdr/ghl-client");
          await fetchCalendars();
          authTest = true;
        } catch {}
      }
      res.json({ ...config, authTest });
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
  app.post("/api/sdr/pause-all", isAuthenticated, (req, res) => {
    if ((req.user as any)?.role !== "admin") return res.status(403).json({ message: "Admin only" });
    const reason = req.body?.reason || "Manual pause from admin panel";
    pauseAll(reason);
    res.json({ success: true, paused: true, reason });
  });

  app.post("/api/sdr/resume-all", isAuthenticated, (req, res) => {
    if ((req.user as any)?.role !== "admin") return res.status(403).json({ message: "Admin only" });
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
        const allContacts = await storage.getContacts();
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
  function getSdrWebhookRawBody(req: ExpressRequest): string {
    const rawBody = (req as ExpressRequest & { rawBody?: Buffer }).rawBody;
    if (rawBody && Buffer.isBuffer(rawBody)) {
      return rawBody.toString("utf8");
    }
    return JSON.stringify(req.body);
  }

  app.post("/api/webhooks/ghl/contact-updated", async (req, res) => {
    try {
      const { validateWebhookSignature } = await import("../services/sdr/ghl-client");
      const signature = req.headers["x-ghl-signature"] as string || "";
      if (!validateWebhookSignature(getSdrWebhookRawBody(req), signature)) {
        return res.status(401).json({ message: "Invalid webhook signature" });
      }

      const { handleContactUpdated } = await import("../services/sdr/webhook-handlers");
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
      const { validateWebhookSignature } = await import("../services/sdr/ghl-client");
      const signature = req.headers["x-ghl-signature"] as string || "";
      if (!validateWebhookSignature(getSdrWebhookRawBody(req), signature)) {
        return res.status(401).json({ message: "Invalid webhook signature" });
      }

      const { handleMessageReceived } = await import("../services/sdr/webhook-handlers");
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
      const { validateWebhookSignature } = await import("../services/sdr/ghl-client");
      const signature = req.headers["x-ghl-signature"] as string || "";
      if (!validateWebhookSignature(getSdrWebhookRawBody(req), signature)) {
        return res.status(401).json({ message: "Invalid webhook signature" });
      }

      const { handleCallOutcome } = await import("../services/sdr/webhook-handlers");
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
      const { validateWebhookSignature } = await import("../services/sdr/ghl-client");
      const signature = req.headers["x-ghl-signature"] as string || "";
      if (!validateWebhookSignature(getSdrWebhookRawBody(req), signature)) {
        return res.status(401).json({ message: "Invalid webhook signature" });
      }

      const { handleAppointmentBooked } = await import("../services/sdr/webhook-handlers");
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
      const { validateWebhookSignature } = await import("../services/sdr/ghl-client");
      const signature = req.headers["x-ghl-signature"] as string || "";
      if (!validateWebhookSignature(getSdrWebhookRawBody(req), signature)) {
        return res.status(401).json({ message: "Invalid webhook signature" });
      }

      const { handleAppointmentCanceled } = await import("../services/sdr/webhook-handlers");
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
      const { validateWebhookSignature } = await import("../services/sdr/ghl-client");
      const signature = req.headers["x-ghl-signature"] as string || "";
      if (!validateWebhookSignature(getSdrWebhookRawBody(req), signature)) {
        return res.status(401).json({ message: "Invalid webhook signature" });
      }

      const { handleOptOut } = await import("../services/sdr/webhook-handlers");
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
      const { validateWebhookSignature } = await import("../services/sdr/ghl-client");
      const signature = req.headers["x-ghl-signature"] as string || "";
      if (!validateWebhookSignature(getSdrWebhookRawBody(req), signature)) {
        return res.status(401).json({ message: "Invalid webhook signature" });
      }

      const { handleConversationCreated } = await import("../services/sdr/chat-handlers");
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
      const { validateWebhookSignature } = await import("../services/sdr/ghl-client");
      const signature = req.headers["x-ghl-signature"] as string || "";
      if (!validateWebhookSignature(getSdrWebhookRawBody(req), signature)) {
        return res.status(401).json({ message: "Invalid webhook signature" });
      }

      const { handleChatMessage } = await import("../services/sdr/chat-handlers");
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
      const { validateWebhookSignature } = await import("../services/sdr/ghl-client");
      const signature = req.headers["x-ghl-signature"] as string || "";
      if (!validateWebhookSignature(getSdrWebhookRawBody(req), signature)) {
        return res.status(401).json({ message: "Invalid webhook signature" });
      }

      const { handleSmsThread } = await import("../services/sdr/chat-handlers");
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
      const { validateWebhookSignature } = await import("../services/sdr/ghl-client");
      const signature = req.headers["x-ghl-signature"] as string || "";
      if (!validateWebhookSignature(getSdrWebhookRawBody(req), signature)) {
        return res.status(401).json({ message: "Invalid webhook signature" });
      }

      const { handleEmailThread } = await import("../services/sdr/chat-handlers");
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
      const { validateWebhookSignature } = await import("../services/sdr/ghl-client");
      const signature = req.headers["x-ghl-signature"] as string || "";
      if (!validateWebhookSignature(getSdrWebhookRawBody(req), signature)) {
        return res.status(401).json({ message: "Invalid webhook signature" });
      }

      const { handleChatBooking } = await import("../services/sdr/chat-handlers");
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

  app.get("/api/sdr/discovery/source-status", isAuthenticated, async (_req, res) => {
    try {
      const { isOutscraperConfigured, getOutscraperUsage } = await import("../services/sdr/outscraper");
      const { isApifyConfigured, getApifyUsage } = await import("../services/sdr/apify");
      const serperConfigured = isSerperConfigured();
      const serperUsage = await getSerperUsage();
      const outscrConfigured = isOutscraperConfigured();
      const outscrUsage = outscrConfigured ? await getOutscraperUsage() : null;
      const apifyConfigured = isApifyConfigured();
      const apifyUsage = apifyConfigured ? await getApifyUsage() : null;

      res.json({
        serper: { configured: serperConfigured, usage: serperUsage },
        outscraper: { configured: outscrConfigured, usage: outscrUsage },
        apify: { configured: apifyConfigured, usage: apifyUsage },
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message: errMsg });
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

  app.post("/api/sdr/bridge-contacts", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin/Manager only" });
    try {
      const { limit, contactIds } = req.body || {};
      const result = await bridgeContactsToSdr({ limit, contactIds });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
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

  app.post("/api/businesses/bridge-contacts", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin/Manager only" });
    try {
      const { limit, contactIds } = req.body || {};
      const result = await bridgeContactsToBusinesses({ limit, contactIds });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
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

}
