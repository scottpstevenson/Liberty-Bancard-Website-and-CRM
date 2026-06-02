import type { Express } from "express";
import { isAuthenticated, isDashboardUser, requireRole } from "../replit_integrations/auth";
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
import { extractRelationshipsForContact, extractRelationshipsForContactsBatch, propagateRiskFlagToRelatedEntities } from "../services/relationship-extractor";

function isUniqueEmailViolation(err: any): boolean {
  return err?.code === "23505" && (err?.constraint?.includes("email") || err?.message?.includes("contacts_email_unique_idx"));
}

export function registerContactsRoutes(app: Express) {
  // === CONTACTS ===
  app.get("/api/contacts", isDashboardUser, async (req, res) => {
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

  app.post("/api/contacts", isDashboardUser, async (req, res) => {
    try {
      const input = insertContactSchema.parse(req.body);
      const contact = await createContactGhlFirst(input, { actorType: "user", userId: (req.user as any)?.id ?? null });
      await createPreferenceAwareNotification({ channel: "internal", title: "New Contact Created", message: `${contact.firstName} ${contact.lastName}${contact.companyName ? ` — ${contact.companyName}` : ""} has been added as a new contact.`, type: "info", metadata: { contactId: contact.id, eventType: "contact_created" } }, "contact_created");
      sendPushToAllReps({ title: "New Lead Assigned", body: `${contact.firstName} ${contact.lastName}${contact.companyName ? ` — ${contact.companyName}` : ""} added to CRM`, url: "/mobile/contacts" }).catch(() => {});
      triggerWorkflowsByEvent("contact_created", { entityType: "contact", entityId: contact.id, contactId: contact.id }).catch(err => console.error("Workflow trigger error:", err));
      ingestBusinessFromContact(contact.id, "manual_upload", "crm_contact_create").catch(err => console.warn("[CRM] Business ingest failed:", err));
      scoreContact(contact.id).catch(err => console.error("Lead scoring error:", err));
      extractRelationshipsForContact(contact.id).catch(err => console.warn("[Relationships] Extraction failed:", err));
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

  app.get("/api/contacts/:id", isDashboardUser, async (req, res) => {
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

  app.put("/api/contacts/:id", isDashboardUser, async (req, res) => {
    try {
      const contactId = Number(req.params.id);
      const existing = await storage.getContact(contactId);
      const updated = await updateContactGhlFirst(contactId, req.body, { actorType: "user", userId: (req.user as any)?.id ?? null });
      if (!updated) return res.status(404).json({ message: "Not found" });

      // Re-extract relationships when key identifiers change
      const phoneChanged = req.body?.phone !== undefined && req.body.phone !== existing?.phone;
      const addressChanged = req.body?.address !== undefined && req.body.address !== existing?.address;
      if (phoneChanged || addressChanged) {
        extractRelationshipsForContact(contactId).catch((err) =>
          console.warn("[Relationships] Re-extraction on update failed:", err),
        );
      }

      const newStatus = req.body?.status as string | undefined;
      const newTags = req.body?.tags as string[] | undefined;
      const isTerminatedStatus =
        newStatus &&
        (newStatus.toLowerCase().includes("terminated") ||
          newStatus.toLowerCase().includes("closed lost") ||
          newStatus.toLowerCase().includes("declined"));
      const hasRiskTag =
        newTags &&
        newTags.some(
          (t) =>
            t.toLowerCase().includes("terminated") ||
            t.toLowerCase().includes("high-chargeback") ||
            t.toLowerCase().includes("fraud"),
        );
      const wasAlreadyTerminated =
        existing?.status?.toLowerCase().includes("terminated") ||
        existing?.status?.toLowerCase().includes("closed lost");

      if ((isTerminatedStatus && !wasAlreadyTerminated) || hasRiskTag) {
        const reason = isTerminatedStatus
          ? `Contact marked as ${newStatus}`
          : `Risk tag added: ${(newTags ?? []).filter((t) => t.toLowerCase().includes("terminated") || t.toLowerCase().includes("high-chargeback") || t.toLowerCase().includes("fraud")).join(", ")}`;
        propagateRiskFlagToRelatedEntities(contactId, reason).catch((err) =>
          console.warn("[Relationships] Risk propagation failed:", err),
        );
      }

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

  app.post("/api/contacts/enrich-batch", requireRole("admin", "manager"), async (req, res) => {
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

  app.get("/api/contacts/enrich-progress", isDashboardUser, async (req, res) => {
    try {
      const progress = await storage.getSystemSetting("contact_enrich_batch_progress");
      res.json(progress || { status: "idle" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/serper/status", isDashboardUser, async (req, res) => {
    try {
      const configured = isSerperConfigured();
      const usage = await getSerperUsage();
      res.json({ configured, usage });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/serper/reset-usage", requireRole("admin", "manager"), async (req, res) => {
    try {
      await resetSerperUsage();
      res.json({ success: true, message: "Serper usage stats reset" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === PROXYCURL STATUS ===
  app.get("/api/proxycurl/status", isDashboardUser, async (req, res) => {
    const configured = !!process.env.PROXYCURL_API_KEY;
    res.json({ configured });
  });

  // === LINKEDIN ENRICHMENT ===
  app.post("/api/contacts/:id/enrich-linkedin", isDashboardUser, async (req, res) => {
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

  app.post("/api/contacts/bulk-enrich-linkedin", isDashboardUser, async (req, res) => {
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
  app.get("/api/companies", isDashboardUser, async (req, res) => {
    try {
      const companies = await storage.getCompanies();
      res.json(companies);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/companies", isDashboardUser, async (req, res) => {
    try {
      const input = insertCompanySchema.parse(req.body);
      const company = await storage.createCompany(input);
      res.status(201).json(company);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/companies/:id", isDashboardUser, async (req, res) => {
    try {
      const companyId = Number(req.params.id);
      const input = insertCompanySchema.partial().parse(req.body);
      const company = await storage.updateCompany(companyId, input);
      if (!company) return res.status(404).json({ message: "Not found" });
      // Re-extract relationships for all contacts linked to this company.
      // Uses the batched extractor: 6 total queries regardless of N linked contacts,
      // instead of N*5 queries from calling extractRelationshipsForContact per contact.
      const links = await storage.getContactCompaniesByCompany(companyId).catch(() => []);
      const linkedContactIds = links.map(l => l.contactId).filter((id): id is number => id != null);
      if (linkedContactIds.length > 0) {
        extractRelationshipsForContactsBatch(linkedContactIds).catch((err) =>
          console.warn("[Relationships] Batch re-extraction after company update failed:", err),
        );
      }
      res.json(company);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err.message });
    }
  });

}
