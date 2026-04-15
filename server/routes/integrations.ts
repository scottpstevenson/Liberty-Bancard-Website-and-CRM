import type { Express } from "express";
import { isAuthenticated, isAdmin } from "../replit_integrations/auth";
import { storage } from "../storage";
import { contacts } from "@shared/schema";
import { and } from "drizzle-orm";
import { checkGhlHealth, getCalendarBookingUrl, getGhlStatus, handleGhlWebhook, isGhlConfigured, sendGhlEmail, sendGhlSms, sendTemplatedMessage, upsertGhlContact, validateGhlWebhookSignature } from "../services/ghl";
import { routeContact } from "../services/smart-router";
import { fullSyncFromGhl, fullSyncToGhl, getGhlSyncStatus, getFullSyncDashboard, syncContactToGhl, syncDealToGhl, syncCompanyToGhl, syncTaskToGhl, syncTicketToGhl, syncNoteToGhl, syncTagsToGhl } from "../services/ghl-sync";
import { getWorkflowStatus, GHL_WORKFLOW_REGISTRY, getPlatformEmailConfig } from "../services/ghl-workflows";
import { buildSequenceList } from "../services/sequence-blueprints";

export function registerIntegrationsRoutes(app: Express) {
  // === GHL INTEGRATION ===
  app.get("/api/ghl/status", async (req, res) => {
    res.json(getGhlStatus());
  });

  app.get("/api/ghl/health-check", isAuthenticated, async (req, res) => {
    try {
      const result = await checkGhlHealth();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ connected: false, latencyMs: 0, error: err.message });
    }
  });

  app.post("/api/ghl/send-email", isAuthenticated, async (req, res) => {
    try {
      const { contactId, dealId, subject, body } = req.body;
      if (!contactId || !subject || !body) return res.status(400).json({ message: "contactId, subject, and body required" });
      const result = await sendGhlEmail({ contactId, dealId, subject, body });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/ghl/send-sms", isAuthenticated, async (req, res) => {
    try {
      const { contactId, dealId, body } = req.body;
      if (!contactId || !body) return res.status(400).json({ message: "contactId and body required" });
      const result = await sendGhlSms({ contactId, dealId, body });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/ghl/send-template", isAuthenticated, async (req, res) => {
    try {
      const { templateId, contactId, dealId, extraData } = req.body;
      if (!templateId || !contactId) return res.status(400).json({ message: "templateId and contactId required" });
      const result = await sendTemplatedMessage({ templateId, contactId, dealId, extraData });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/ghl/sync-contact", isAuthenticated, async (req, res) => {
    try {
      const { contactId } = req.body;
      if (!contactId) return res.status(400).json({ message: "contactId required" });
      const contact = await storage.getContact(contactId);
      if (!contact) return res.status(404).json({ message: "Contact not found" });
      const ghlId = await upsertGhlContact(contact);
      res.json({ success: true, ghlContactId: ghlId });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/ghl/calendar-url", (req, res) => {
    const url = getCalendarBookingUrl({
      contactEmail: req.query.email as string,
      contactName: req.query.name as string,
      source: req.query.source as string,
    });
    res.json({ url });
  });

  app.get("/api/ghl/activity", isAuthenticated, async (req, res) => {
    const contactId = req.query.contactId ? Number(req.query.contactId) : undefined;
    const logs = await storage.getGhlActivityLogs(contactId);
    res.json(logs);
  });

  app.post("/api/webhooks/ghl", async (req, res) => {
    try {
      const signature = (req.headers["x-ghl-signature"] || req.headers["x-hub-signature-256"] || "") as string;
      const rawBody = req.rawBody instanceof Buffer ? req.rawBody.toString("utf8") : JSON.stringify(req.body);

      if (!validateGhlWebhookSignature(rawBody, signature)) {
        console.error("[GHL Webhook] Signature verification failed");
        return res.status(401).json({ message: "Invalid webhook signature" });
      }

      await handleGhlWebhook(req.body);
      res.json({ success: true });
    } catch (err: any) {
      console.error("GHL webhook error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });


  // === GHL 2-WAY SYNC ===
  app.get("/api/ghl/sync-status", isAuthenticated, async (req, res) => {
    const [status, hotLeadSync, hotLeadEnrollment] = await Promise.all([
      getGhlSyncStatus(),
      storage.getSystemSetting("ghl_hot_lead_sync"),
      storage.getSystemSetting("hot_lead_enrollment"),
    ]);
    res.json({ ...status, hotLeadSync, hotLeadEnrollment });
  });

  app.post("/api/ghl/sync-all-to-ghl", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin/Manager only" });
    res.json({ message: "Syncing all contacts to GHL...", started: true });
    fullSyncToGhl().catch(err => console.error("[GHL Sync API] Error:", err));
  });

  app.post("/api/ghl/sync-all-from-ghl", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin/Manager only" });
    res.json({ message: "Syncing contacts from GHL...", started: true });
    fullSyncFromGhl().catch(err => console.error("[GHL Sync API] Error:", err));
  });

  app.get("/api/ghl/sync-status/contact/:id", isAuthenticated, async (req, res) => {
    try {
      const contactId = Number(req.params.id);
      const contact = await storage.getContact(contactId);
      if (!contact) return res.status(404).json({ message: "Not found" });
      const logs = await storage.getGhlActivityLogs(contactId);
      const lastOutboundSync = logs.find(l => l.direction === "outbound" && l.channel === "sync");
      const lastSyncedAt = lastOutboundSync?.createdAt || null;
      const isSynced = !!contact.ghlContactId && !!lastSyncedAt;
      const syncAge = lastSyncedAt ? Date.now() - new Date(lastSyncedAt).getTime() : null;
      const isRecent = syncAge !== null && syncAge < 24 * 60 * 60 * 1000;
      res.json({
        ghlContactId: contact.ghlContactId || null,
        isSynced,
        isRecent,
        lastSyncedAt: lastSyncedAt ? new Date(lastSyncedAt).toISOString() : null,
        syncAgeMs: syncAge,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/ghl/sync-contact/:id", isAuthenticated, async (req, res) => {
    const userRole = (req.user as { role?: string } | undefined)?.role;
    if (!userRole || !['admin', 'manager', 'agent'].includes(userRole)) {
      return res.status(403).json({ message: "Insufficient permissions to trigger GHL sync" });
    }
    const result = await syncContactToGhl(Number(req.params.id));
    res.json(result);
  });

  app.post("/api/ghl/sync-deal/:id", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin/Manager only" });
    const result = await syncDealToGhl(Number(req.params.id));
    res.json(result);
  });

  app.post("/api/ghl/sync-company/:id", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin/Manager only" });
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid company ID" });
    try {
      const result = await syncCompanyToGhl(id);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/ghl/sync-task/:id", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin/Manager only" });
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid task ID" });
    try {
      const result = await syncTaskToGhl(id);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/ghl/sync-ticket/:id", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin/Manager only" });
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ticket ID" });
    try {
      const result = await syncTicketToGhl(id);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/ghl/sync-note/:id", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin/Manager only" });
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid note ID" });
    try {
      const result = await syncNoteToGhl(id);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/ghl/sync-tags/:contactId", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin/Manager only" });
    const id = Number(req.params.contactId);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid contact ID" });
    try {
      const result = await syncTagsToGhl(id);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/ghl/sync-dashboard", isAuthenticated, async (req, res) => {
    try {
      const dashboard = await getFullSyncDashboard();
      res.json(dashboard);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/ghl/sync-hot-leads", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin/Manager only" });
    const maxContacts = Number(req.body.limit) || 100;
    res.json({ message: `Syncing up to ${maxContacts} hot lead contacts to GHL...`, started: true });

    (async () => {
      try {
        const { data: deals } = await storage.getDeals({ limit: 500 });
        const newLeadDeals = deals.filter(d => d.stage === "New Lead" && d.contactId);
        const contactIds = [...new Set(newLeadDeals.map(d => d.contactId!))].slice(0, maxContacts);

        let synced = 0;
        let failed = 0;
        for (const contactId of contactIds) {
          try {
            const result = await syncContactToGhl(contactId);
            if (result.success) synced++;
            else failed++;
          } catch { failed++; }
          await new Promise(r => setTimeout(r, 300));
        }

        await storage.setSystemSetting("ghl_hot_lead_sync", {
          timestamp: new Date().toISOString(),
          synced,
          failed,
          total: contactIds.length,
        });
        console.log(`[GHL Hot Lead Sync] Complete: ${synced} synced, ${failed} failed out of ${contactIds.length}`);
      } catch (err) {
        console.error("[GHL Hot Lead Sync] Error:", err);
      }
    })();
  });

  app.post("/api/ghl/test-connection", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin/Manager only" });
    try {
      const health = await checkGhlHealth();
      res.json(health);
    } catch (err: any) {
      res.status(500).json({ connected: false, latencyMs: 0, error: err.message });
    }
  });

  app.post("/api/ghl/test-send-email", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin/Manager only" });
    try {
      const { contactId, subject, body } = req.body;
      if (!contactId) return res.status(400).json({ message: "contactId required" });
      const result = await sendGhlEmail({
        contactId: Number(contactId),
        subject: subject || "Test Email from Liberty Bancard CRM",
        body: body || "<p>This is a test email sent through the GHL integration to verify connectivity.</p>",
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/api/outreach/enroll-hot-leads", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin/Manager only" });
    const maxLeads = Number(req.body.limit) || 100;
    res.json({ message: `Enrolling up to ${maxLeads} hot leads into sequences...`, started: true });

    (async () => {
      try {
        const { routeContact } = await import("../services/smart-router");
        const { data: deals } = await storage.getDeals({ limit: 500 });
        const hotDeals = deals.filter(d => d.stage === "New Lead" && d.contactId);
        const contactIds = [...new Set(hotDeals.map(d => d.contactId!))].slice(0, maxLeads);

        let enrolled = 0;
        let skipped = 0;
        let blocked = 0;
        for (const contactId of contactIds) {
          try {
            const result = await routeContact(contactId);
            if (result.complianceBlocked) { blocked++; continue; }
            if (result.sequenceIds.length > 0) enrolled++;
            else skipped++;
          } catch { skipped++; }
        }

        await storage.setSystemSetting("hot_lead_enrollment", {
          timestamp: new Date().toISOString(),
          enrolled,
          skipped,
          blocked,
          total: contactIds.length,
        });
        console.log(`[Hot Lead Enrollment] Complete: ${enrolled} enrolled, ${skipped} skipped, ${blocked} compliance-blocked`);
      } catch (err) {
        console.error("[Hot Lead Enrollment] Error:", err);
      }
    })();
  });


  // === BULK MESSAGING ===
  app.post("/api/bulk-message", isAuthenticated, async (req, res) => {
    try {
      const { contactIds, channel, subject, message: msgBody, templateId } = req.body;

      if (!contactIds?.length || !channel || !msgBody) {
        return res.status(400).json({ message: "contactIds, channel, and message are required" });
      }

      if (!["email", "sms"].includes(channel)) {
        return res.status(400).json({ message: "Channel must be email or sms" });
      }

      const results: { contactId: number; status: string; error?: string }[] = [];

      for (const contactId of contactIds) {
        try {
          const contact = await storage.getContact(contactId);
          if (!contact) {
            results.push({ contactId, status: "error", error: "Contact not found" });
            continue;
          }

          if (contact.doNotContact) {
            results.push({ contactId, status: "skipped", error: "Do Not Contact" });
            continue;
          }

          if (channel === "sms" && !contact.consentSms) {
            results.push({ contactId, status: "skipped", error: "No SMS consent" });
            continue;
          }

          const personalizedMsg = msgBody
            .replace(/\{\{firstName\}\}/g, contact.firstName || "")
            .replace(/\{\{lastName\}\}/g, contact.lastName || "")
            .replace(/\{\{companyName\}\}/g, contact.companyName || "")
            .replace(/\{\{email\}\}/g, contact.email || "");

          if (channel === "email") {
            if (isGhlConfigured() && contact.email) {
              await sendGhlEmail({ contactId, subject: subject || "Message from Liberty Bancard", body: personalizedMsg });
              results.push({ contactId, status: "sent" });
            } else {
              results.push({ contactId, status: "queued", error: "GHL not configured" });
            }
          } else {
            if (isGhlConfigured() && contact.phone) {
              await sendGhlSms({ contactId, body: personalizedMsg });
              results.push({ contactId, status: "sent" });
            } else {
              results.push({ contactId, status: "queued", error: "GHL not configured" });
            }
          }

          await storage.createAuditLog({
            action: `bulk_${channel}_sent`,
            entityType: "contact",
            entityId: contactId,
            details: { channel, subject },
          });
        } catch (err: any) {
          results.push({ contactId, status: "error", error: err.message });
        }
      }

      const sent = results.filter(r => r.status === "sent").length;
      const skipped = results.filter(r => r.status === "skipped").length;
      const errors = results.filter(r => r.status === "error").length;

      res.json({ sent, skipped, errors, total: contactIds.length, results });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === BLAZE.AI INTEGRATION ===
  const BLAZE_SETTINGS_KEY = "blaze_integration";
  const defaultBlazeSettings = { enabled: false, webhookUrl: "", zapierConnected: false, lastSyncAt: null, contentTypes: ["email", "social", "blog", "newsletter"], workspaceId: "" };

  app.get("/api/integrations/blaze", isAuthenticated, async (req, res) => {
    const saved = await storage.getSystemSetting(BLAZE_SETTINGS_KEY);
    res.json(saved || defaultBlazeSettings);
  });

  app.post("/api/integrations/blaze", isAuthenticated, async (req, res) => {
    const { webhookUrl, workspaceId } = req.body;
    const current = (await storage.getSystemSetting(BLAZE_SETTINGS_KEY)) || { ...defaultBlazeSettings };
    const updated = {
      ...current,
      webhookUrl: webhookUrl || current.webhookUrl,
      workspaceId: workspaceId || current.workspaceId,
      enabled: !!(webhookUrl || workspaceId || current.webhookUrl || current.workspaceId),
    };
    await storage.setSystemSetting(BLAZE_SETTINGS_KEY, updated);
    await storage.createAuditLog({
      action: "blaze_settings_updated",
      entityType: "integration",
      details: { webhookUrl: !!webhookUrl, workspaceId: !!workspaceId },
    });
    res.json({ success: true, settings: updated });
  });

  app.post("/api/integrations/blaze/test", isAuthenticated, async (req, res) => {
    const saved = (await storage.getSystemSetting(BLAZE_SETTINGS_KEY)) || defaultBlazeSettings;
    if (!saved.webhookUrl && !saved.workspaceId) {
      return res.json({ success: false, message: "No Blaze.ai webhook URL or workspace ID configured. Use Zapier integration as the recommended approach." });
    }
    res.json({ success: true, message: "Settings saved. Connect via Zapier for the most reliable integration with Blaze.ai." });
  });

  app.post("/api/webhooks/blaze", async (req, res) => {
    try {
      const { type, content, metadata } = req.body;
      console.log(`[Blaze Webhook] Received: ${type}`, metadata);

      await storage.createAuditLog({
        action: "blaze_webhook_received",
        entityType: "integration",
        details: { type, metadata },
      });

      const current = (await storage.getSystemSetting(BLAZE_SETTINGS_KEY)) || { ...defaultBlazeSettings };
      current.lastSyncAt = new Date().toISOString();
      await storage.setSystemSetting(BLAZE_SETTINGS_KEY, current);

      if (type === "content_published" && content) {
        await storage.createNotification({
          channel: "internal",
          title: "Blaze.ai Content Published",
          message: `New ${metadata?.contentType || "content"}: ${content?.title || "Untitled"}`,
          type: "info",
          metadata: { source: "blaze", contentType: metadata?.contentType },
        });
      }

      res.json({ success: true, received: true });
    } catch (err: any) {
      console.error("Blaze webhook error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/ghl/workflows", isAuthenticated, async (req, res) => {
    try {
      const status = getWorkflowStatus();
      res.json({
        ...status,
        registry: GHL_WORKFLOW_REGISTRY.map(w => ({
          id: w.id,
          name: w.name,
          category: w.category,
          envKey: w.envKey,
          configured: !!process.env[w.envKey],
          description: w.description,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/ghl/email-config", isAuthenticated, async (req, res) => {
    try {
      res.json(getPlatformEmailConfig());
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GHL Sequences List
  app.get("/api/sequences/list", isAuthenticated, async (req, res) => {
    try {
      const sequences = buildSequenceList();
      res.json({ sequences, total: sequences.length });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GHL Workflow ID Manager
  app.get("/api/ghl/workflow-mappings", isAuthenticated, async (req, res) => {
    try {
      const mappings = await storage.getGhlWorkflowMappings();
      res.json(mappings);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/ghl/workflow-mappings/:sequenceName", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const sequenceName = decodeURIComponent(req.params.sequenceName);
      const { ghlWorkflowId, category, description } = req.body;
      const mapping = await storage.upsertGhlWorkflowMapping(sequenceName, ghlWorkflowId || null, category, description);
      res.json(mapping);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

}
