import type { Express } from "express";
import { isAuthenticated } from "../replit_integrations/auth";
import { storage } from "../storage";
import { z } from "zod";
import { contacts, insertCompanySchema, insertContactSchema } from "@shared/schema";
import { enrichContactBatch, isContactEnrichRunning } from "../services/enrichment";
import { getSerperUsage, isSerperConfigured, resetSerperUsage } from "../services/serper";
import { autoEnrollFromTrigger } from "../services/sequence-worker";
import { triggerWorkflowsByEvent } from "../services/workflow-executor";
import { scoreContact } from "../services/lead-scoring";
import { routeContact } from "../services/smart-router";
import { createPreferenceAwareNotification, sendCriticalEmailNotification } from "../services/digest-service";
import { ingestBusinessFromContact } from "../services/sdr/dedupe";
import { parse } from "csv-parse/sync";
import path from "path";

export function registerContactsRoutes(app: Express) {
  // === CONTACTS ===
  app.get("/api/contacts", async (req, res) => {
    const contacts = await storage.getContacts();
    res.json(contacts);
  });

  app.post("/api/contacts", async (req, res) => {
    try {
      const input = insertContactSchema.parse(req.body);
      const contact = await storage.createContact(input);
      await storage.createAuditLog({ action: "contact_created", entityType: "contact", entityId: contact.id, details: { name: `${contact.firstName} ${contact.lastName}` } });
      await createPreferenceAwareNotification({ channel: "internal", title: "New Contact Created", message: `${contact.firstName} ${contact.lastName}${contact.companyName ? ` — ${contact.companyName}` : ""} has been added as a new contact.`, type: "info", metadata: { contactId: contact.id, eventType: "contact_created" } }, "contact_created");
      triggerWorkflowsByEvent("contact_created", { entityType: "contact", entityId: contact.id, contactId: contact.id }).catch(err => console.error("Workflow trigger error:", err));
      ingestBusinessFromContact(contact.id, "manual_upload", "crm_contact_create").catch(err => console.warn("[CRM] Business ingest failed:", err));
      scoreContact(contact.id).catch(err => console.error("Lead scoring error:", err));
      autoEnrollFromTrigger("contact_created", { contactId: contact.id }).catch(err => console.error("Auto-enroll error:", err));
      routeContact(contact.id).catch(err => console.error("Smart routing error:", err));
      if (contact.leadScore && contact.leadScore >= 80) {
        sendCriticalEmailNotification({ eventType: "hot_lead", subject: `Hot Lead Alert: ${contact.firstName} ${contact.lastName}`, body: `<h3>Hot Lead Alert</h3><p><strong>${contact.firstName} ${contact.lastName}</strong>${contact.companyName ? ` (${contact.companyName})` : ""} has a lead score of ${contact.leadScore}.</p><p>Email: ${contact.email || "N/A"}<br/>Phone: ${contact.phone || "N/A"}</p><p>Take action immediately.</p>` }).catch(err => console.error("Hot lead email error:", err));
      }
      res.status(201).json(contact);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      throw err;
    }
  });

  app.get("/api/contacts/:id", async (req, res) => {
    const contact = await storage.getContact(Number(req.params.id));
    if (!contact) return res.status(404).json({ message: "Not found" });
    res.json(contact);
  });

  app.put("/api/contacts/:id", async (req, res) => {
    const updated = await storage.updateContact(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
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
        const allContacts = await storage.getContacts();
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
    const progress = await storage.getSystemSetting("contact_enrich_batch_progress");
    res.json(progress || { status: "idle" });
  });

  app.get("/api/serper/status", isAuthenticated, async (req, res) => {
    const configured = isSerperConfigured();
    const usage = await getSerperUsage();
    res.json({ configured, usage });
  });

  app.post("/api/serper/reset-usage", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    await resetSerperUsage();
    res.json({ success: true, message: "Serper usage stats reset" });
  });


  // === COMPANIES ===
  app.get("/api/companies", async (req, res) => {
    const companies = await storage.getCompanies();
    res.json(companies);
  });

  app.post("/api/companies", async (req, res) => {
    try {
      const input = insertCompanySchema.parse(req.body);
      const company = await storage.createCompany(input);
      res.status(201).json(company);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

}
