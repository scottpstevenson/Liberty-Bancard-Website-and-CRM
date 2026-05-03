import type { Express } from "express";
import { isAuthenticated } from "../replit_integrations/auth";
import { storage } from "../storage";
import { z } from "zod";
import { insertCompanySchema, insertContactSchema } from "@shared/schema";
import { enrichContactBatch, isContactEnrichRunning } from "../services/enrichment";
import { enrichContactFromLinkedIn, bulkEnrichFromLinkedIn } from "../services/linkedin-enrichment";
import { getSerperUsage, isSerperConfigured, resetSerperUsage } from "../services/serper";
import { autoEnrollFromTrigger } from "../services/sequence-worker";
import { triggerWorkflowsByEvent } from "../services/workflow-executor";
import { scoreContact } from "../services/lead-scoring";
import { routeContact } from "../services/smart-router";
import { createPreferenceAwareNotification, sendCriticalEmailNotification } from "../services/digest-service";
import { ingestBusinessFromContact } from "../services/sdr/dedupe";
import { isGhlConfigured } from "../services/ghl";
import { syncContactToGhl } from "../services/ghl-sync";
import { createContactGhlFirst, updateContactGhlFirst } from "../services/contact-writer";
import { assignNextRep } from "./toolkit";
import { parse } from "csv-parse/sync";
import path from "path";
import { sendPushToAllReps } from "../services/push-service";

function isUniqueEmailViolation(err: any): boolean {
  return err?.code === "23505" && (err?.constraint?.includes("email") || err?.message?.includes("contacts_email_unique_idx"));
}

export function registerContactsRoutes(app: Express) {
  // === CONTACTS ===
  app.get("/api/contacts", isAuthenticated, async (req, res) => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const offset = req.query.offset ? Number(req.query.offset) : undefined;
      const result = await storage.getContacts({ limit, offset });
      res.json(result);
    } catch (err: any) {
      console.error("Get contacts error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/contacts", isAuthenticated, async (req, res) => {
    try {
      const input = insertContactSchema.parse(req.body);
      const contact = await createContactGhlFirst(input);

      await storage.createAuditLog({ action: "contact_created", entityType: "contact", entityId: contact.id, details: { name: `${contact.firstName} ${contact.lastName}` } });
      await createPreferenceAwareNotification({ channel: "internal", title: "New Contact Created", message: `${contact.firstName} ${contact.lastName}${contact.companyName ? ` — ${contact.companyName}` : ""} has been added as a new contact.`, type: "info", metadata: { contactId: contact.id, eventType: "contact_created" } }, "contact_created");
      sendPushToAllReps({ title: "New Lead Assigned", body: `${contact.firstName} ${contact.lastName}${contact.companyName ? ` — ${contact.companyName}` : ""} added to CRM`, url: "/mobile/contacts" }).catch(() => {});
      triggerWorkflowsByEvent("contact_created", { entityType: "contact", entityId: contact.id, contactId: contact.id }).catch(err => console.error("Workflow trigger error:", err));
      ingestBusinessFromContact(contact.id, "manual_upload", "crm_contact_create").catch(err => console.warn("[CRM] Business ingest failed:", err));
      scoreContact(contact.id).catch(err => console.error("Lead scoring error:", err));
      autoEnrollFromTrigger("contact_created", { contactId: contact.id }).catch(err => console.error("Auto-enroll error:", err));
      routeContact(contact.id).catch(err => console.error("Smart routing error:", err));
      assignNextRep(contact.id, `${contact.firstName} ${contact.lastName}`.trim()).catch(err => console.error("Round-robin assignment error:", err));
      if (contact.leadScore && contact.leadScore >= 80) {
        sendCriticalEmailNotification({ eventType: "hot_lead", subject: `Hot Lead Alert: ${contact.firstName} ${contact.lastName}`, body: `<h3>Hot Lead Alert</h3><p><strong>${contact.firstName} ${contact.lastName}</strong>${contact.companyName ? ` (${contact.companyName})` : ""} has a lead score of ${contact.leadScore}.</p><p>Email: ${contact.email || "N/A"}<br/>Phone: ${contact.phone || "N/A"}</p><p>Take action immediately.</p>` }).catch(err => console.error("Hot lead email error:", err));
      }

      const statusCode = contact._ghlSyncPending ? 202 : 201;
      res.status(statusCode).json(contact);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      if (isUniqueEmailViolation(err)) {
        const existing = await storage.getContactByEmail(req.body?.email || "").catch(() => undefined);
        return res.status(409).json({
          message: "A contact with this email address already exists.",
          existingContactId: existing?.id ?? null,
        });
      }
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/contacts/:id", isAuthenticated, async (req, res) => {
    try {
      const contact = await storage.getContact(Number(req.params.id));
      if (!contact) return res.status(404).json({ message: "Not found" });
      if (!contact.ghlContactId && isGhlConfigured()) {
        syncContactToGhl(contact.id).then(result => {
          if (result.success) {
            console.log(`[GHL Read-Touch] Auto-upserted contact ${contact.id} to GHL: ${result.ghlContactId}`);
          }
        }).catch((err: Error) => {
          console.warn(`[GHL Read-Touch] Auto-upsert failed for contact ${contact.id}:`, err.message);
        });
      }
      res.json(contact);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/contacts/:id", isAuthenticated, async (req, res) => {
    try {
      const contactId = Number(req.params.id);
      const updated = await updateContactGhlFirst(contactId, req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      const statusCode = updated._ghlSyncFailed ? 202 : 200;
      res.status(statusCode).json(updated);
    } catch (err: any) {
      if (isUniqueEmailViolation(err)) {
        const existing = await storage.getContactByEmail(req.body?.email || "").catch(() => undefined);
        return res.status(409).json({
          message: "A contact with this email address already exists.",
          existingContactId: existing?.id ?? null,
        });
      }
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/contacts/enrich-batch", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin/Manager only" });
    try {
      const schema = z.object({
        contactIds: z.array(z.number().int().positive()).optional().default([]),
        limit: z.number().int().min(1).max(1000).optional().default(100),
      });

      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message, errors: parsed.error.errors });
      }

      if (isContactEnrichRunning()) {
        return res.status(409).json({ message: "Contact enrichment is already running. Check progress at /api/contacts/enrich-progress." });
      }

      if (!isSerperConfigured()) {
        return res.status(400).json({ message: "Serper API key not configured. Set SERPER_API_KEY environment variable." });
      }

      let contactIds = parsed.data.contactIds;
      const limit = parsed.data.limit;

      if (contactIds.length === 0) {
        const { data: allContacts } = await storage.getContacts({ limit: 500 });
        contactIds = allContacts
          .filter(c => !c.email || !c.phone)
          .slice(0, limit)
          .map(c => c.id);
      }

      if (contactIds.length === 0) {
        return res.json({ message: "No contacts need enrichment", processed: 0 });
      }

      res.json({
        message: `Enrichment started for ${contactIds.length} contacts`,
        total: contactIds.length,
        started: true,
      });

      enrichContactBatch(contactIds).catch(err =>
        console.error("[ContactEnrich API] Error:", err)
      );
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/contacts/enrich-progress", isAuthenticated, async (req, res) => {
    try {
      const progress = await storage.getSystemSetting("contact_enrich_batch_progress");
      res.json(progress || { status: "idle" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/serper/status", isAuthenticated, async (req, res) => {
    try {
      const configured = isSerperConfigured();
      const usage = await getSerperUsage();
      res.json({ configured, usage });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/serper/reset-usage", isAuthenticated, async (req, res) => {
    try {
      if ((req.user as any)?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
      await resetSerperUsage();
      res.json({ success: true, message: "Serper usage stats reset" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === PROXYCURL STATUS ===
  app.get("/api/proxycurl/status", isAuthenticated, async (req, res) => {
    const configured = !!process.env.PROXYCURL_API_KEY;
    res.json({ configured });
  });

  // === LINKEDIN ENRICHMENT ===
  app.post("/api/contacts/:id/enrich-linkedin", isAuthenticated, async (req, res) => {
    try {
      const contactId = Number(req.params.id);
      const result = await enrichContactFromLinkedIn(contactId);
      if (!result.success) {
        return res.status(400).json({ message: result.error, provider: result.provider });
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/contacts/bulk-enrich-linkedin", isAuthenticated, async (req, res) => {
    try {
      const schema = z.object({
        contactIds: z.array(z.number().int().positive()).min(1).max(100),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }
      res.json({ message: `LinkedIn enrichment started for ${parsed.data.contactIds.length} contacts`, started: true });
      bulkEnrichFromLinkedIn(parsed.data.contactIds).catch(err =>
        console.error("[LinkedIn Bulk Enrich] Error:", err)
      );
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === COMPANIES ===
  app.get("/api/companies", isAuthenticated, async (req, res) => {
    try {
      const companies = await storage.getCompanies();
      res.json(companies);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/companies", isAuthenticated, async (req, res) => {
    try {
      const input = insertCompanySchema.parse(req.body);
      const company = await storage.createCompany(input);
      res.status(201).json(company);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err.message });
    }
  });

}
