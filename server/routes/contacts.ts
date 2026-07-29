import type { Express } from "express";
import { isAuthenticated, isDashboardUser, requireRole } from "../replit_integrations/auth";
import { storage } from "../storage";
import { z } from "zod";
import { DateValidationError } from "../utils/date-coerce";
import { pool, db } from "../db";
import { sdrLeadState, insertCompanySchema, insertContactSchema } from "@shared/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import { enrollContactInGhlWorkflow } from "../services/ghl-workflow-enrollment";
import { enrichContactBatch, isContactEnrichRunning } from "../services/enrichment";
import { enrichContactFromLinkedIn, bulkEnrichFromLinkedIn } from "../services/linkedin-enrichment";
import { getSerperUsage, isSerperConfigured, resetSerperUsage } from "../services/serper";
import { enqueuePromotionalEnrollment } from "../services/promotional-enrollment-eligibility";
import { triggerWorkflowsByEvent } from "../services/workflow-executor";
import { scoreContact } from "../services/lead-scoring";
import { routeContact } from "../services/smart-router";
import { createPreferenceAwareNotification, sendCriticalEmailNotification } from "../services/digest-service";
import { ingestBusinessFromContact } from "../services/sdr/dedupe";
import { isGhlConfigured } from "../services/ghl";
import { normalizeGhlId } from "../utils/normalize";
import { syncContactToGhl } from "../services/ghl-sync";
import { writeContact, updateContactGhlFirst, stripProvenanceFields } from "../services/contact-writer";
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
      const emailStatus = req.query.emailStatus ? String(req.query.emailStatus) : undefined;
      const result = await storage.getContacts({ limit, offset, emailStatus });
      res.json(result);
    } catch (err: any) {
      console.error("Get contacts error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/contacts", isDashboardUser, async (req, res) => {
    try {
      const input = insertContactSchema.parse(req.body);
      const userId = (req.user as any)?.id ?? null;
      const contact = await writeContact({
        mode: "ghl_upsert_first",
        mutation: input as any,
        provenance: {
          sourceCategory: "manual_crm",
          sourceType: "dashboard",
          eventKey: `manual:${crypto.randomUUID()}`,
          actorType: "user",
          actorId: userId ? String(userId) : undefined,
        },
        actor: { actorType: "user", actorId: userId ? String(userId) : null, userId },
      });
      await createPreferenceAwareNotification({ channel: "internal", title: "New Contact Created", message: `${contact.firstName} ${contact.lastName}${contact.companyName ? ` — ${contact.companyName}` : ""} has been added as a new contact.`, type: "info", metadata: { contactId: contact.id, eventType: "contact_created" } }, "contact_created");
      sendPushToAllReps({ title: "New Lead Assigned", body: `${contact.firstName} ${contact.lastName}${contact.companyName ? ` — ${contact.companyName}` : ""} added to CRM`, url: "/mobile/contacts" }).catch(() => {});
      triggerWorkflowsByEvent("contact_created", { entityType: "contact", entityId: contact.id, contactId: contact.id }).catch(err => console.error("Workflow trigger error:", err));
      ingestBusinessFromContact(contact.id, "manual_upload", "crm_contact_create").catch(err => console.warn("[CRM] Business ingest failed:", err));
      scoreContact(contact.id).catch(err => console.error("Lead scoring error:", err));
      extractRelationshipsForContact(contact.id).catch(err => console.warn("[Relationships] Extraction failed:", err));
      enqueuePromotionalEnrollment({ contactId: contact.id, triggerType: "contact_created", sourceEventId: crypto.randomUUID() }).catch(err => console.error("Enqueue error:", err));
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

  // === COLD LEADS (Re-engagement segment) ===
  app.get("/api/contacts/cold-leads", isDashboardUser, async (req, res) => {
    try {
      const page = req.query.page ? Number(req.query.page) : 0;
      const pageSize = 100;

      // Single efficient query: all cold leads across full dataset.
      // Uses NOT EXISTS to exclude contacts with any active (non-closed) deal.
      // Bypasses storage pagination cap (500 rows) by querying DB directly.
      const result = await pool.query(`
        SELECT
          c.id,
          c.first_name AS "firstName",
          c.last_name  AS "lastName",
          c.email,
          c.phone,
          c.company_name  AS "companyName",
          c.lead_source   AS "leadSource",
          c.utm_source    AS "utmSource",
          c.referral_source AS "referralSource",
          c.vertical,
          c.status,
          c.tags,
          c.ghl_contact_id AS "ghlContactId",
          c.assigned_to    AS "assignedTo",
          COALESCE(c.last_contacted_at, c.created_at) AS "lastActivityDate",
          EXTRACT(DAY FROM NOW() - COALESCE(c.last_contacted_at, c.created_at))::int AS "daysDormant"
        FROM contacts c
        WHERE c.archived_at IS NULL
          AND (c.do_not_contact IS NULL OR c.do_not_contact = FALSE)
          AND c.status IS DISTINCT FROM 'Won'
          AND (
            c.lead_source   IS NOT NULL OR
            c.utm_source    IS NOT NULL OR
            c.referral_source IS NOT NULL
          )
          AND COALESCE(c.last_contacted_at, c.created_at) < NOW() - INTERVAL '45 days'
          AND NOT EXISTS (
            SELECT 1 FROM deals d
            WHERE d.contact_id = c.id
              AND d.archived_at IS NULL
              AND d.stage NOT IN ('Closed Lost', 'Nurture / Not Now')
          )
        ORDER BY COALESCE(c.last_contacted_at, c.created_at) ASC
      `);

      const allColdLeads = result.rows;
      const total = allColdLeads.length;
      const avgDaysDormant = total > 0
        ? Math.round(allColdLeads.reduce((s: number, c: any) => s + (Number(c.daysDormant) || 0), 0) / total)
        : 0;
      const estimatedValue = total * 15000;

      res.json({
        data: allColdLeads.slice(page * pageSize, (page + 1) * pageSize),
        total,
        avgDaysDormant,
        estimatedValue,
        page,
        pageSize,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/contacts/email-health-summary", isDashboardUser, async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE COALESCE(email_status, 'active') = 'active')::int   AS active,
          COUNT(*) FILTER (WHERE email_status = 'bounced')::int                       AS bounced,
          COUNT(*) FILTER (WHERE email_status = 'invalid')::int                       AS invalid,
          COUNT(*) FILTER (WHERE email_status = 'opted_out')::int                     AS opted_out
        FROM contacts
        WHERE archived_at IS NULL
      `);
      res.json(result.rows[0]);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Confirmation Status Batch ──────────────────────────────────────────────
  // POST /api/contacts/confirmation-status/batch
  // Registered BEFORE /:id wildcards so "confirmation-status" is not captured
  // as an :id parameter.
  //
  // Accepts up to 200 contactIds; deduplicates before querying.
  // Returns: { statuses: { [contactId]: { status:"failed", ... } | null } }
  // Only contacts with a current "failed" latest submission appear in statuses.
  app.post("/api/contacts/confirmation-status/batch", isDashboardUser, async (req, res) => {
    try {
      const schema = z.object({
        contactIds: z.array(z.number().int().positive()).min(1).max(200),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }
      // Deduplicate before querying
      const unique = Array.from(new Set(parsed.data.contactIds));
      const { getContactConfirmationStatusBatch } = await import("../services/confirmation-status");
      const result = await getContactConfirmationStatusBatch(unique);
      res.json(result);
    } catch (err: any) {
      console.error("[confirmation-status batch POST]", err.message);
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
      const contactDateSchema = z.object({
        lastScoredAt: z.coerce.date().optional().nullable(),
        smsOptInAt: z.coerce.date().optional().nullable(),
        emailOptInAt: z.coerce.date().optional().nullable(),
        lastContactedAt: z.coerce.date().optional().nullable(),
        coolingUntil: z.coerce.date().optional().nullable(),
        linkedinEnrichedAt: z.coerce.date().optional().nullable(),
        archivedAt: z.coerce.date().optional().nullable(),
        lastSyncedAt: z.coerce.date().optional().nullable(),
        bouncedAt: z.coerce.date().optional().nullable(),
        lastVoicemailAt: z.coerce.date().optional().nullable(),
        offerRoutedAt: z.coerce.date().optional().nullable(),
      }).passthrough();
      const rawBody = contactDateSchema.parse(req.body);
      // Strip provenance fields — they are immutable after first set and must never be
      // overwritten via the PUT route (defense layer 1; storage.updateContact is layer 2).
      const strippedBody = stripProvenanceFields(rawBody as Record<string, unknown>) as typeof rawBody;
      // Normalize ghlContactId from passthrough body before it reaches any write path.
      if ((strippedBody as any).ghlContactId !== undefined) {
        (strippedBody as any).ghlContactId = normalizeGhlId((strippedBody as any).ghlContactId);
      }
      const body = strippedBody;
      const updated = await updateContactGhlFirst(contactId, body, { actorType: "user", userId: (req.user as any)?.id ?? null });
      if (!updated) return res.status(404).json({ message: "Not found" });

      // If this update sets an opt-out signal, suppress New Lead auto-enrollment
      const isOptOut =
        body.consentTier === "opted_out" ||
        body.emailStatus === "opted_out" || body.emailStatus === "unsubscribed" ||
        body.optedOutEmail === true ||
        body.doNotContact === true;
      if (isOptOut) {
        const reason = body.doNotContact
          ? "admin_do_not_contact"
          : body.consentTier === "opted_out"
          ? "admin_consent_tier_opted_out"
          : body.emailStatus === "opted_out" || body.emailStatus === "unsubscribed"
          ? "admin_email_status_opted_out"
          : "admin_opted_out_email_flag";
        const { suppressNewLeadAutoEnrollmentForContact } = await import("../services/new-lead-enrollment-job");
        suppressNewLeadAutoEnrollmentForContact(contactId, reason).catch((err: any) =>
          console.error("[contacts PUT] suppression error:", err?.message)
        );
      }

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
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join(".") });
      if (err instanceof DateValidationError) return res.status(400).json({ message: err.message, field: err.field });
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

  // === RE-ENGAGE (Cold Lead Re-engagement) ===
  app.post("/api/contacts/bulk-re-engage", isDashboardUser, async (req, res) => {
    try {
      const schema = z.object({
        contactIds: z.array(z.number().int().positive()).min(1).max(200),
      });
      const { contactIds } = schema.parse(req.body);
      const sequenceName = "19. Reactivation — Cold Lead Revival";

      let enrolled = 0;
      let skipped = 0;
      let errors = 0;

      for (const contactId of contactIds) {
        try {
          const contact = await storage.getContact(contactId);
          if (!contact) { skipped++; continue; }
          const existingTags = contact.tags || [];
          const newTags = [...new Set([...existingTags, "COLD-NO-DEAL", "RE-ENGAGE-60"])];
          await storage.updateContact(contactId, { tags: newTags });
          const result = await enrollContactInGhlWorkflow({
            contactId,
            sequenceName,
            sequenceId: 0,
            vertical: contact.vertical || undefined,
          });
          if (result.enrolled || result.method === "replit_direct") enrolled++;
          else skipped++;
        } catch {
          errors++;
        }
      }

      res.json({ enrolled, skipped, errors, total: contactIds.length });
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/contacts/:id/re-engage", isDashboardUser, async (req, res) => {
    try {
      const contactId = Number(req.params.id);
      const contact = await storage.getContact(contactId);
      if (!contact) return res.status(404).json({ message: "Contact not found" });

      const existingTags = contact.tags || [];
      const newTags = [...new Set([...existingTags, "COLD-NO-DEAL", "RE-ENGAGE-60"])];
      await storage.updateContact(contactId, { tags: newTags });

      const sequenceName = "19. Reactivation — Cold Lead Revival";
      const result = await enrollContactInGhlWorkflow({
        contactId,
        sequenceName,
        sequenceId: 0,
        vertical: contact.vertical || undefined,
      });

      await storage.createAuditLog({
        action: "re_engage_enrolled",
        entityType: "contact",
        entityId: contactId,
        details: { sequenceName, enrolled: result.enrolled, method: result.method },
      });

      res.json({ success: true, enrolled: result.enrolled, method: result.method, reason: result.reason });
    } catch (err: any) {
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

  // === OFFER ROUTING ===

  app.post("/api/contacts/:id/enrich", isDashboardUser, async (req, res) => {
    try {
      const contactId = Number(req.params.id);
      const contact = await storage.getContact(contactId);
      if (!contact) return res.status(404).json({ message: "Contact not found" });

      await enrichContactBatch([contactId]);

      const enriched = await storage.getContact(contactId);
      if (!enriched) return res.status(404).json({ message: "Contact not found after enrichment" });

      const { routeOffer } = await import("../services/offer-router");
      const result = await routeOffer(enriched);

      let updated = enriched;
      if (result.shouldUpdateContact) {
        const persisted = await updateContactGhlFirst(contactId, {
          primaryOfferPath: result.offerRoute,
          offerConfidence: result.offerConfidence,
          recommendedNextAction: result.recommendedNextAction,
          offerReasoning: result.offerReasoning,
          offerRoutingSource: result.routingSource,
          processorDetected: result.processorDetected ?? null,
          offerRoutedAt: new Date(),
          offerMatchedSignals: result.matchedSignals,
        }, { actorType: "system", userId: (req.user as any)?.id ?? null });
        if (persisted) updated = persisted;
      }

      res.json({ contact: updated, offerRouting: result });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/contacts/:id/route-offer", isDashboardUser, async (req, res) => {
    try {
      const contactId = Number(req.params.id);
      const { routeOfferBodySchema } = await import("@shared/offer-router-types");
      const parsed = routeOfferBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }
      const { dryRun, forceAi, updateContact } = parsed.data;

      const contact = await storage.getContact(contactId);
      if (!contact) return res.status(404).json({ message: "Contact not found" });

      const { routeOffer } = await import("../services/offer-router");
      const result = await routeOffer(contact, { forceAi: forceAi ?? false });

      if (updateContact === true && dryRun !== true && result.shouldUpdateContact) {
        const updated = await updateContactGhlFirst(contactId, {
          primaryOfferPath: result.offerRoute,
          offerConfidence: result.offerConfidence,
          recommendedNextAction: result.recommendedNextAction,
          offerReasoning: result.offerReasoning,
          offerRoutingSource: result.routingSource,
          processorDetected: result.processorDetected ?? null,
          offerRoutedAt: new Date(),
          offerMatchedSignals: result.matchedSignals,
        }, { actorType: "system", userId: (req.user as any)?.id ?? null });
        return res.json({ contact: updated, offerRouting: result, updated: true });
      }

      const wasBlocked = updateContact === true && dryRun !== true && !result.shouldUpdateContact;
      res.json({ offerRouting: result, updated: false, dryRun: dryRun === true || updateContact !== true, skippedManualOverride: wasBlocked });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/contacts/:id/offer-route", requireRole("admin", "manager"), async (req, res) => {
    try {
      const contactId = Number(req.params.id);
      const { manualOverrideBodySchema } = await import("@shared/offer-router-types");
      const parsed = manualOverrideBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message, errors: parsed.error.errors });
      }
      const { offerRoute, recommendedNextAction, reason } = parsed.data;

      const contact = await storage.getContact(contactId);
      if (!contact) return res.status(404).json({ message: "Contact not found" });

      const prevOfferPath = contact.primaryOfferPath;

      const updated = await storage.updateContact(contactId, {
        primaryOfferPath: offerRoute,
        offerRoutingSource: "manual_override",
        offerRoutedAt: new Date(),
        recommendedNextAction: recommendedNextAction ?? null,
        offerConfidence: null,
        processorDetected: null,
        offerMatchedSignals: null,
      }, { actorType: "user", userId: (req.user as any)?.id ?? null });

      if (!updated) return res.status(404).json({ message: "Contact not found" });

      const { auditChange } = await import("../services/audit-change");
      await auditChange({
        action: "offer_route_manual_override",
        entityType: "contact",
        entityId: contactId,
        before: { primaryOfferPath: prevOfferPath },
        after: { primaryOfferPath: offerRoute },
        details: { reason, role: (req.user as any)?.role },
        userId: String((req.user as any)?.id ?? ""),
        actorType: "user",
      });

      res.json(updated);
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

  // === MULTI-LOCATION / PARENT ACCOUNT ===

  app.get("/api/contacts/:id/locations", isDashboardUser, async (req, res) => {
    try {
      const contactId = Number(req.params.id);
      const locations = await storage.getChildLocations(contactId);
      res.json(locations);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/contacts/:id/locations", isDashboardUser, async (req, res) => {
    try {
      const parentId = Number(req.params.id);
      const schema = z.object({
        contactId: z.number().int().positive(),
        locationName: z.string().optional(),
      });
      const { contactId: childId, locationName } = schema.parse(req.body);

      if (childId === parentId) {
        return res.status(400).json({ message: "A contact cannot be linked to itself" });
      }

      const parent = await storage.getContact(parentId);
      if (!parent) return res.status(404).json({ message: "Parent contact not found" });

      // Prevent parent from being a child itself (no grandparent hierarchies)
      if (parent.parentContactId) {
        return res.status(400).json({ message: "The parent contact is already a child location of another account. Nested hierarchies are not supported." });
      }

      const child = await storage.getContact(childId);
      if (!child) return res.status(404).json({ message: "Child contact not found" });

      // Prevent child that is itself a parent (would create a fan-out hierarchy)
      const existingChildren = await storage.getChildLocations(childId);
      if (existingChildren.length > 0) {
        return res.status(400).json({ message: "This contact already manages child locations. Move its locations first before linking it as a child." });
      }

      const updates: any = { parentContactId: parentId };
      if (locationName !== undefined) updates.locationName = locationName;

      const updated = await storage.updateContact(childId, updates, { actorType: "user", userId: (req.user as any)?.id ?? null });

      if (!parent.isParentAccount) {
        await storage.updateContact(parentId, { isParentAccount: true }, { actorType: "user", userId: (req.user as any)?.id ?? null });
      }

      // Rep inheritance: propagate parent's agent assignment to child's unassigned deals
      try {
        const parentDeals = await storage.getDealsByContact(parentId);
        const childDeals = await storage.getDealsByContact(childId);
        for (const parentDeal of parentDeals) {
          const parentAgentRows = await storage.getAgentMerchantsByDeal(parentDeal.id);
          if (parentAgentRows.length === 0) continue;
          const parentAgent = parentAgentRows[0];
          for (const childDeal of childDeals) {
            const childAgentRows = await storage.getAgentMerchantsByDeal(childDeal.id);
            if (childAgentRows.length === 0) {
              await storage.assignMerchantToAgent({
                agentId: parentAgent.agentId,
                dealId: childDeal.id,
                contactId: childId,
                assignedAt: new Date(),
                notes: `Inherited from parent account (contact #${parentId})`,
              });
            }
          }
        }
      } catch (repErr: any) {
        console.error(`[Location Link] Rep inheritance failed for child ${childId}:`, repErr.message);
      }

      await storage.createAuditLog({
        action: "location_linked",
        entityType: "contact",
        entityId: childId,
        details: { parentContactId: parentId, locationName: locationName ?? null },
      });

      res.status(201).json(updated);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/contacts/:id/locations/:locationId", isDashboardUser, async (req, res) => {
    try {
      const parentId = Number(req.params.id);
      const locationId = Number(req.params.locationId);

      const child = await storage.getContact(locationId);
      if (!child || child.parentContactId !== parentId) {
        return res.status(404).json({ message: "Location not linked to this parent" });
      }

      await storage.updateContact(locationId, { parentContactId: null, locationName: null }, { actorType: "user", userId: (req.user as any)?.id ?? null });

      const remaining = await storage.getChildLocations(parentId);
      if (remaining.length === 0) {
        await storage.updateContact(parentId, { isParentAccount: false }, { actorType: "user", userId: (req.user as any)?.id ?? null });
      }

      await storage.createAuditLog({
        action: "location_unlinked",
        entityType: "contact",
        entityId: locationId,
        details: { parentContactId: parentId },
      });

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/contacts/:id/group-kpis", isDashboardUser, async (req, res) => {
    try {
      const contactId = Number(req.params.id);
      const kpis = await storage.getGroupKpis(contactId);
      res.json(kpis);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/contacts/:id/parent", isDashboardUser, async (req, res) => {
    try {
      const contactId = Number(req.params.id);
      const parent = await storage.getParentAccount(contactId);
      res.json(parent ?? null);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/companies/:id", isDashboardUser, async (req, res) => {
    try {
      const companyId = Number(req.params.id);
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ message: "Not found" });
      res.json(company);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/companies/:id/contacts", isDashboardUser, async (req, res) => {
    try {
      const companyId = Number(req.params.id);
      const { db } = await import("../db");
      const { contactCompanies, contacts: contactsTable } = await import("@shared/schema");
      const { eq, isNull } = await import("drizzle-orm");
      const rows = await db
        .select({
          id: contactsTable.id,
          firstName: contactsTable.firstName,
          lastName: contactsTable.lastName,
          email: contactsTable.email,
          emailStatus: contactsTable.emailStatus,
          isDecisionMaker: contactsTable.isDecisionMaker,
          decisionMakerConfidence: contactsTable.decisionMakerConfidence,
          title: contactsTable.title,
          companyName: contactsTable.companyName,
          bouncedAt: contactsTable.bouncedAt,
        })
        .from(contactsTable)
        .innerJoin(contactCompanies, eq(contactCompanies.contactId, contactsTable.id))
        .where(eq(contactCompanies.companyId, companyId));
      res.json(rows);
    } catch (err: any) {
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

  // === DECISION MAKER MANUAL OVERRIDE ===
  app.patch("/api/contacts/:id/decision-maker", isDashboardUser, async (req, res) => {
    try {
      const contactId = Number(req.params.id);
      const { isDecisionMaker } = z.object({ isDecisionMaker: z.boolean() }).parse(req.body);
      const contact = await storage.getContact(contactId);
      if (!contact) return res.status(404).json({ message: "Contact not found" });
      const updated = await storage.updateContact(contactId, {
        isDecisionMaker,
        decisionMakerConfidence: isDecisionMaker ? 100 : 0,
      }, { actorType: "user", userId: (req.user as any)?.id ?? null });
      res.json(updated);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err.message });
    }
  });

  // === MANAGEMENT TYPE ===
  app.patch("/api/contacts/:id/management-type", isDashboardUser, async (req, res) => {
    try {
      const contactId = Number(req.params.id);
      const { managementType } = z.object({ managementType: z.enum(["unified", "per_location", "unknown"]) }).parse(req.body);
      const contact = await storage.getContact(contactId);
      if (!contact) return res.status(404).json({ message: "Contact not found" });
      const updated = await storage.updateContact(contactId, { managementType }, { actorType: "user", userId: (req.user as any)?.id ?? null });
      res.json(updated);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/companies/:id/management-type", isDashboardUser, async (req, res) => {
    try {
      const companyId = Number(req.params.id);
      const { managementType } = z.object({ managementType: z.enum(["unified", "per_location", "unknown"]) }).parse(req.body);
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ message: "Company not found" });
      const updated = await storage.updateCompany(companyId, { managementType } as any);
      res.json(updated);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err.message });
    }
  });

  // === M&A EVENTS ===
  app.get("/api/ma-events", isDashboardUser, async (req, res) => {
    try {
      const entityType = req.query.entityType as string | undefined;
      const entityId = req.query.entityId ? Number(req.query.entityId) : undefined;
      const { db } = await import("../db");
      const { maEvents } = await import("@shared/schema");
      const { eq, and, desc } = await import("drizzle-orm");

      let rows;
      if (entityType && entityId) {
        rows = await db.select().from(maEvents).where(
          and(eq(maEvents.entityType, entityType), eq(maEvents.entityId, entityId))
        ).orderBy(desc(maEvents.eventDate));
      } else {
        rows = await db.select().from(maEvents).orderBy(desc(maEvents.eventDate));
      }
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/ma-events", isDashboardUser, async (req, res) => {
    try {
      const { maEvents, insertMaEventSchema, entityRelationships } = await import("@shared/schema");
      const { db } = await import("../db");
      const input = insertMaEventSchema.parse({
        ...req.body,
        eventDate: req.body.eventDate ? new Date(req.body.eventDate) : new Date(),
        createdBy: (req.user as any)?.username ?? "system",
      });

      const [event] = await db.insert(maEvents).values(input).returning();

      const relTypeMap: Record<string, string> = {
        acquired: "acquired_by",
        merged_into: "merged_into",
        rebranded: "rebranded_as",
        closed: "closed",
      };
      const relType = relTypeMap[input.eventType] ?? input.eventType;

      if (input.counterpartyContactId) {
        const { sql } = await import("drizzle-orm");
        await db.insert(entityRelationships).values({
          sourceEntityType: input.entityType,
          sourceEntityId: input.entityId,
          targetEntityType: "contact",
          targetEntityId: input.counterpartyContactId,
          relationshipType: relType,
          source: "ma_event",
          note: input.note ?? undefined,
        }).onConflictDoNothing();
      }

      await storage.createAuditLog({
        userId: (req.user as any)?.id ?? null,
        actorType: "user",
        action: "ma_event_created",
        entityType: input.entityType,
        entityId: input.entityId,
        details: { eventType: input.eventType, counterpartyName: input.counterpartyName, eventDate: input.eventDate },
      });

      res.json(event);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/ma-events/:id", isDashboardUser, async (req, res) => {
    try {
      const eventId = Number(req.params.id);
      const { maEvents } = await import("@shared/schema");
      const { db } = await import("../db");
      const { eq } = await import("drizzle-orm");
      await db.delete(maEvents).where(eq(maEvents.id, eventId));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === COMPANY INTELLIGENCE EMAIL HEALTH ===
  app.get("/api/contacts/:id/email-health", isDashboardUser, async (req, res) => {
    try {
      const parentId = Number(req.params.id);
      const children = await storage.getChildLocations(parentId);
      const allIds = [parentId, ...children.map(c => c.id)];
      const { db } = await import("../db");
      const { contacts: contactsTable } = await import("@shared/schema");
      const { inArray, isNull, and } = await import("drizzle-orm");
      const allContacts = await db.select({
        id: contactsTable.id,
        email: contactsTable.email,
        emailStatus: contactsTable.emailStatus,
        firstName: contactsTable.firstName,
        lastName: contactsTable.lastName,
        companyName: contactsTable.companyName,
      }).from(contactsTable).where(
        and(inArray(contactsTable.id, allIds), isNull(contactsTable.archivedAt))
      );

      const summary = {
        total: allContacts.length,
        active: allContacts.filter(c => c.emailStatus === "active").length,
        bounced: allContacts.filter(c => c.emailStatus === "bounced").length,
        invalid: allContacts.filter(c => c.emailStatus === "invalid").length,
        optedOut: allContacts.filter(c => c.emailStatus === "opted-out").length,
        roleBased: allContacts.filter(c => c.emailStatus === "role-based").length,
        contacts: allContacts,
      };
      res.json(summary);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === CONTACTABILITY — Wave 1A ===
  // dryRun mode: no outreach audit logs written; safe to call from dashboards and contact detail pages
  app.get("/api/contacts/:id/contactability", requireRole("admin", "manager"), async (req, res) => {
    try {
      const contactId = Number(req.params.id);
      if (isNaN(contactId)) return res.status(400).json({ message: "Invalid contact ID" });

      const { evaluateAllChannels } = await import("../services/contactability");
      const result = await evaluateAllChannels(contactId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/contacts/:id/communication-health", isDashboardUser, async (req, res) => {
    try {
      const contactId = parseInt(req.params.id);
      if (isNaN(contactId)) return res.status(400).json({ message: "Invalid contact ID" });

      const contact = await storage.getContact(contactId);
      if (!contact) return res.status(404).json({ message: "Contact not found" });

      const { db } = await import("../db");
      const { auditLogs } = await import("@shared/schema");
      const { desc, eq, and, like } = await import("drizzle-orm");

      const recentEvents = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityType, "contact"),
            eq(auditLogs.entityId, contactId),
            like(auditLogs.action, "comm_event_%")
          )
        )
        .orderBy(desc(auditLogs.createdAt))
        .limit(10);

      const emailFailed = contact.emailStatus === "bounced";
      const smsFailed = contact.smsStatus === "undeliverable";
      const callFailed = (contact.callAttempts ?? 0) >= 5;
      const allChannelsFailed = emailFailed && smsFailed && callFailed;

      let nextRecommendedAction = "Continue outreach";
      if (contact.doNotAutoContact) {
        nextRecommendedAction = "Manual review — all channels failed";
      } else if (emailFailed && !smsFailed) {
        nextRecommendedAction = "Escalate to SMS";
      } else if (smsFailed && !emailFailed) {
        nextRecommendedAction = "Escalate to email";
      } else if ((contact.callAttempts ?? 0) >= 3) {
        nextRecommendedAction = "Switch to email-first strategy";
      } else if (contact.preferredChannel) {
        nextRecommendedAction = `Prioritize ${contact.preferredChannel} (preferred channel)`;
      }

      res.json({
        contactId,
        email: {
          status: contact.emailStatus ?? "active",
          bouncedAt: contact.bouncedAt ?? null,
        },
        sms: {
          status: contact.smsStatus ?? "active",
        },
        call: {
          attempts: contact.callAttempts ?? 0,
          lastVoicemailAt: contact.lastVoicemailAt ?? null,
        },
        engagementScore: contact.engagementScore ?? 50,
        reachabilityScore: contact.reachabilityScore ?? 100,
        preferredChannel: contact.preferredChannel ?? null,
        doNotAutoContact: contact.doNotAutoContact ?? false,
        allChannelsFailed,
        nextRecommendedAction,
        recentEvents: recentEvents.map(e => ({
          id: e.id,
          action: e.action,
          details: e.details,
          createdAt: e.createdAt,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Statement Request ────────────────────────────────────────────────────────

  app.post("/api/contacts/:id/request-statement", isDashboardUser, async (req, res) => {
    try {
      const contactId = parseInt(req.params.id);
      if (isNaN(contactId)) return res.status(400).json({ message: "Invalid contact id" });

      const contact = await storage.getContact(contactId);
      if (!contact) return res.status(404).json({ message: "Contact not found" });

      const token = crypto.randomBytes(24).toString("hex");
      const baseUrl = process.env.APP_URL
        || (process.env.REPLIT_DOMAINS ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}` : null)
        || (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : null)
        || "https://libertybancard.com";
      const uploadUrl = `${baseUrl}/statement-upload/${token}`;

      const sdrRows = await db.select({ id: sdrLeadState.id }).from(sdrLeadState)
        .where(eq(sdrLeadState.contactId, contactId)).limit(1);
      const sdrLeadStateId = sdrRows[0]?.id ?? null;

      const statementRequest = await storage.createStatementRequest({
        contactId,
        sdrLeadStateId,
        status: "requested",
        uploadToken: token,
        uploadUrl,
        requestedAt: new Date(),
        createdBy: (req.user as any)?.id ?? null,
      });

      await storage.createAuditLog({
        action: "statement_request_created",
        entityType: "contact",
        entityId: contactId,
        actorType: "user",
        actorId: (req.user as any)?.id ?? null,
        details: { statementRequestId: statementRequest.id, uploadUrl },
      });

      if (req.query.createTask === "true") {
        const marker = `statement_request_id:${statementRequest.id}`;
        await storage.createTask({
          contactId,
          title: "Request statement from merchant",
          description: `Statement request created. Upload URL sent. ${marker}`,
          priority: "normal",
          status: "pending",
          assignedTo: (req.user as any)?.id ?? undefined,
        });
      }

      res.json({ statementRequest, uploadUrl });
    } catch (err: any) {
      console.error("[RequestStatement]", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Sales Prep ───────────────────────────────────────────────────────────────

  app.get("/api/contacts/:id/sales-prep", isDashboardUser, async (req, res) => {
    try {
      const contactId = parseInt(req.params.id);
      if (isNaN(contactId)) return res.status(400).json({ message: "Invalid contact id" });

      const contact = await storage.getContact(contactId);
      if (!contact) return res.status(404).json({ message: "Contact not found" });

      const sdrRows = await db.select({ id: sdrLeadState.id }).from(sdrLeadState)
        .where(eq(sdrLeadState.contactId, contactId)).limit(1);
      const sdrSourced = sdrRows.length > 0;

      if (!sdrSourced) {
        return res.json({ sdrSourced: false, cached: null, cacheKey: null, generatedAt: null, canGenerate: false });
      }

      const { checkSalesPrepCache } = await import("../services/sales-prep");
      const cached = await checkSalesPrepCache(contactId);

      res.json({
        sdrSourced: true,
        cached: cached ? cached.output : null,
        cacheKey: cached ? cached.cacheKey : null,
        generatedAt: cached ? cached.generatedAt : null,
        canGenerate: true,
      });
    } catch (err: any) {
      console.error("[SalesPrep GET]", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/contacts/:id/sales-prep/generate", isDashboardUser, async (req, res) => {
    try {
      const contactId = parseInt(req.params.id);
      if (isNaN(contactId)) return res.status(400).json({ message: "Invalid contact id" });

      const contact = await storage.getContact(contactId);
      if (!contact) return res.status(404).json({ message: "Contact not found" });

      const sdrRows = await db.select({ id: sdrLeadState.id }).from(sdrLeadState)
        .where(eq(sdrLeadState.contactId, contactId)).limit(1);
      if (sdrRows.length === 0) {
        return res.status(400).json({ message: "Contact is not SDR-sourced; sales prep not available" });
      }

      const { generateSalesPrepAi } = await import("../services/sales-prep");
      const result = await generateSalesPrepAi(contactId);

      res.json(result);
    } catch (err: any) {
      console.error("[SalesPrep POST generate]", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // ─── SDR Contactability Status (read-only, dryRun) ────────────────────────
  app.get("/api/contacts/:id/contactability-status", isDashboardUser, async (req, res) => {
    try {
      const contactId = parseInt(req.params.id);
      if (isNaN(contactId)) return res.status(400).json({ message: "Invalid contact id" });

      const sdrRows = await db.select({ id: sdrLeadState.id }).from(sdrLeadState)
        .where(eq(sdrLeadState.contactId, contactId)).limit(1);
      if (sdrRows.length === 0) {
        return res.json({ sdrSourced: false });
      }

      const { evaluateContactability } = await import("../services/contactability");
      const result = await evaluateContactability({
        contactId,
        channel: "email",
        mode: "dryRun",
        campaignType: "sdr_outreach",
      });

      return res.json({
        sdrSourced: true,
        allowed: result.allowed,
        reason: result.reason,
        channel: "email",
      });
    } catch (err: any) {
      console.error("[SDR contactability-status GET]", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // ─── SDR Manual Email Enrollment ──────────────────────────────────────────
  app.post("/api/contacts/:id/sdr-enroll", isDashboardUser, async (req, res) => {
    try {
      const contactId = parseInt(req.params.id);
      if (isNaN(contactId)) return res.status(400).json({ message: "Invalid contact id" });

      // Gate 1: parse and validate body
      const bodySchema = z.object({
        sequenceId: z.number().int().positive(),
        confirmed: z.boolean(),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid request body", errors: parsed.error.errors });
      const { sequenceId, confirmed } = parsed.data;

      if (!confirmed) {
        return res.status(400).json({ message: "Explicit confirmation required" });
      }

      // Gate 2: contact must exist
      const contact = await storage.getContact(contactId);
      if (!contact) return res.status(404).json({ message: "Contact not found" });

      // Gate 3: must be SDR-sourced
      const sdrRows = await db.select({ id: sdrLeadState.id }).from(sdrLeadState)
        .where(eq(sdrLeadState.contactId, contactId)).limit(1);
      if (sdrRows.length === 0) {
        return res.status(403).json({ message: "Contact is not SDR-sourced" });
      }

      // Gate 4: sequence must exist and be active
      const sequence = await storage.getFollowUpSequence(sequenceId);
      if (!sequence || sequence.status !== "active") {
        return res.status(422).json({ message: "Sequence not found or not active" });
      }

      // Gate 5: sequence must be email-only
      const emailOnlyViolation = await checkEmailOnlyViolation(sequenceId, sequence);
      if (emailOnlyViolation) {
        return res.status(422).json({ message: "Sequence is not email-only — SMS, voice, and ringless are not permitted for SDR contacts" });
      }

      // Gate 6: sequence eligibility check
      const { canEnrollContactInSequence } = await import("../services/sequence-eligibility");
      const eligibility = await canEnrollContactInSequence(contactId, sequence);
      if (!eligibility.allowed) {
        return res.status(422).json({ message: eligibility.reason ?? "Contact is not eligible for this sequence" });
      }

      // Gate 7: contactability gate (enforcement mode — writes audit log internally on block)
      const { evaluateContactability } = await import("../services/contactability");
      const contactability = await evaluateContactability({
        contactId,
        channel: "email",
        mode: "enforcement",
        campaignType: "sdr_outreach",
      });
      if (!contactability.allowed) {
        return res.status(403).json({ message: contactability.reason });
      }

      // Gate 8: duplicate active enrollment guard (after contactability, before insert)
      const existingEnrollments = await storage.getContactEnrollments(contactId);
      const alreadyEnrolled = existingEnrollments.some(
        e => e.sequenceId === sequenceId && e.status === "active"
      );
      if (alreadyEnrolled) {
        return res.status(409).json({ alreadyEnrolled: true, message: "Already enrolled in this sequence" });
      }

      // Compute nextActionAt from first step delay (mirrors smart-router.ts pattern)
      const steps = await storage.getSequenceSteps(sequenceId);
      const firstStep = steps.find(s => s.stepOrder === 1) || steps[0];
      const delayMs = firstStep
        ? ((firstStep.delayDays || 0) * 86400000) + ((firstStep.delayHours || 0) * 3600000)
        : 0;
      const nextActionAt = new Date(Date.now() + Math.max(delayMs, 1000));

      // Enroll
      await storage.createSequenceEnrollment({
        sequenceId,
        contactId,
        status: "active",
        currentStep: 0,
        nextActionAt,
      });

      // Write manual enrollment audit log (distinct from contactability audit in consentAuditLogs)
      await storage.createAuditLog({
        action: "sdr_manual_enrollment",
        entityType: "contact",
        entityId: contactId,
        details: {
          sequenceId,
          sequenceName: sequence.name,
          confirmedBy: (req.user as any)?.id ?? "unknown",
        },
      });

      return res.json({ enrolled: true, sequenceId, sequenceName: sequence.name });
    } catch (err: any) {
      console.error("[SDR sdr-enroll POST]", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // ── Confirmation Status ────────────────────────────────────────────────────
  // GET /api/contacts/:id/confirmation-status
  // Returns inbound confirmation delivery status for a contact.
  //
  // Liberty is single-tenant; all dashboard users may access all contacts.
  // Update with a tenant predicate if multi-tenant support is added.
  app.get("/api/contacts/:id/confirmation-status", isDashboardUser, async (req, res) => {
    try {
      const contactId = Number(req.params.id);
      if (isNaN(contactId) || contactId <= 0) {
        return res.status(400).json({ message: "Invalid contact ID" });
      }
      const { getContactConfirmationStatuses } = await import("../services/confirmation-status");
      const result = await getContactConfirmationStatuses(contactId);
      res.json(result);
    } catch (err: any) {
      console.error("[confirmation-status GET]", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // ── Mark Do Not Contact ────────────────────────────────────────────────────
  // POST /api/contacts/:id/mark-dnc
  // Requires a reason. Records to audit_logs and updates suppression fields.
  app.post("/api/contacts/:id/mark-dnc", isDashboardUser, async (req, res) => {
    try {
      const contactId = Number(req.params.id);
      const schema = z.object({
        reason: z.string().min(3).max(500),
        source: z.string().optional().default("manual_crm"),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }
      const { reason, source } = parsed.data;

      const contact = await storage.getContact(contactId);
      if (!contact) return res.status(404).json({ message: "Contact not found" });

      const now = new Date();
      const suppressionEvent = { reason, source, date: now.toISOString() };
      const existingHistory: unknown[] = Array.isArray((contact as any).suppressionHistory) ? (contact as any).suppressionHistory : [];
      const newHistory = [...existingHistory, suppressionEvent];

      const { db: dncDb } = await import("../db");
      const { sql: dncSql } = await import("drizzle-orm");
      await dncDb.execute(dncSql`
        UPDATE contacts SET
          do_not_contact       = true,
          dnc_reason           = ${reason},
          dnc_date             = ${now},
          dnc_source           = ${source},
          suppression_reason   = ${"do_not_contact:" + reason},
          suppression_history  = ${JSON.stringify(newHistory)}::jsonb,
          opt_out_status       = 'opted_out',
          opt_out_date         = ${now},
          opt_out_channel      = ${source},
          updated_at           = ${now}
        WHERE id = ${contactId}
      `);

      await storage.createAuditLog({
        action: "contact_marked_dnc",
        entityType: "contact",
        entityId: contactId,
        actorType: "user",
        actorId: String((req.user as any)?.id ?? "unknown"),
        details: { reason, source, suppressionEvent },
      });

      // Suppress any active auto-enrollments
      const { suppressNewLeadAutoEnrollmentForContact } = await import("../services/new-lead-enrollment-job");
      suppressNewLeadAutoEnrollmentForContact(contactId, `dnc:${reason}`).catch((err: any) =>
        console.error("[contacts/mark-dnc] suppression error:", err?.message)
      );

      res.json({ success: true, contactId, reason, markedAt: now.toISOString() });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Get suppression status ──────────────────────────────────────────────────
  // GET /api/contacts/:id/suppression-status
  app.get("/api/contacts/:id/suppression-status", isDashboardUser, async (req, res) => {
    try {
      const contactId = Number(req.params.id);
      const contact = await storage.getContact(contactId) as any;
      if (!contact) return res.status(404).json({ message: "Contact not found" });

      const suppressionReasons: string[] = [];
      if (contact.doNotContact) suppressionReasons.push("do_not_contact");
      if (contact.optOutStatus === "opted_out") suppressionReasons.push("opt_out_status=opted_out");
      if (contact.unsubscribeStatus === "unsubscribed") suppressionReasons.push("unsubscribed");
      if (contact.bounceStatus === "hard") suppressionReasons.push("hard_bounce");
      if (contact.complaintStatus === "reported") suppressionReasons.push("complaint_reported");
      if (contact.emailStatus === "bounced" || contact.emailStatus === "invalid") suppressionReasons.push(`email_status=${contact.emailStatus}`);

      res.json({
        contactId,
        isSuppressed: suppressionReasons.length > 0,
        suppressionReasons,
        suppressionReason: contact.suppressionReason || null,
        doNotContact: contact.doNotContact,
        dncReason: contact.dncReason,
        dncDate: contact.dncDate,
        dncSource: contact.dncSource,
        optOutStatus: contact.optOutStatus || "active",
        optOutDate: contact.optOutDate,
        optOutChannel: contact.optOutChannel,
        unsubscribeStatus: contact.unsubscribeStatus || "active",
        unsubscribeDate: contact.unsubscribeDate,
        bounceStatus: contact.bounceStatus || "none",
        bounceDate: contact.bounceDate,
        bounceReason: contact.bounceReason,
        complaintStatus: contact.complaintStatus || "none",
        complaintDate: contact.complaintDate,
        emailStatus: contact.emailStatus,
        smsConsentStatus: contact.smsConsentStatus || "not_collected",
        suppressionHistory: contact.suppressionHistory || [],
        nextAllowedContactDate: contact.nextAllowedContactDate || null,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/contacts/:id/delivery-log — outbound send log for a contact
  app.get("/api/contacts/:id/delivery-log", isDashboardUser, async (req, res) => {
    try {
      const contactId = Number(req.params.id);
      if (isNaN(contactId)) return res.status(400).json({ message: "Invalid contact ID" });

      const { db } = await import("../db");
      const { sql } = await import("drizzle-orm");

      const result = await db.execute(sql`
        SELECT
          l.id,
          s.name            AS sequence_name,
          l.step_order,
          l.channel,
          l.from_address,
          l.to_address,
          l.subject,
          l.status,
          l.failure_reason,
          l.sent_at,
          l.failed_at,
          l.created_at
        FROM outbound_send_log l
        LEFT JOIN follow_up_sequences s ON s.id = l.sequence_id
        WHERE l.contact_id = ${contactId}
        ORDER BY l.created_at DESC
        LIMIT 200
      `);

      const rows = (result.rows as any[]).map(r => ({
        id:            r.id,
        sequenceName:  r.sequence_name ?? null,
        stepOrder:     r.step_order != null ? Number(r.step_order) : null,
        channel:       r.channel,
        fromAddress:   r.from_address ?? null,
        toAddress:     r.to_address,
        subject:       r.subject ?? null,
        status:        r.status,
        failureReason: r.failure_reason ?? null,
        sentAt:        r.sent_at ? new Date(r.sent_at).toISOString() : null,
        failedAt:      r.failed_at ? new Date(r.failed_at).toISOString() : null,
        createdAt:     new Date(r.created_at).toISOString(),
      }));

      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Data Quality Scanner ──────────────────────────────────────────────────
  // GET /api/contacts/quality-summary
  // Returns aggregate counts for the quality health dashboard.
  app.get("/api/contacts/quality-summary", requireRole("admin", "manager"), async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          COUNT(*)::int                                                                          AS total_contacts,
          COUNT(*) FILTER (WHERE COALESCE(TRIM(first_name), '') = '')::int                      AS blank_first_name,
          COUNT(*) FILTER (WHERE email_status IS NULL OR email_status = 'active')::int          AS unvalidated_email,
          COUNT(*) FILTER (WHERE email_status IN ('bounced', 'invalid', 'unsafe'))::int         AS bad_email,
          COUNT(*) FILTER (WHERE COALESCE(TRIM(vertical), '') = '')::int                       AS missing_vertical,
          COUNT(*) FILTER (WHERE COALESCE(TRIM(phone), '') = '')::int                          AS missing_phone,
          COUNT(*) FILTER (WHERE email_status = 'valid')::int                                  AS verified_valid,
          COUNT(*) FILTER (WHERE email_status = 'unverified')::int                             AS catch_all
        FROM contacts
        WHERE archived_at IS NULL
      `);
      const { data: zbData } = await import("../services/zerobounce-daily-limiter").then(m =>
        m.checkZeroBounceBudget().then(b => ({ data: b }))
      );
      res.json({
        ...result.rows[0],
        zerobounce: {
          usedToday: zbData.used,
          dailyLimit: zbData.limit,
          remainingToday: Math.max(0, zbData.limit - zbData.used),
        },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/contacts/quality-scan?issue=blank_name|unvalidated_email|bad_email|missing_vertical|missing_phone&page=1&limit=50
  app.get("/api/contacts/quality-scan", requireRole("admin", "manager"), async (req, res) => {
    try {
      const issue = req.query.issue as string | undefined;
      const page  = Math.max(1, parseInt(String(req.query.page  ?? "1"),  10));
      const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10)));
      const offset = (page - 1) * limit;
      const minLeadScore = parseInt(String(req.query.minLeadScore ?? "0"), 10) || 0;

      const issueFilters: Record<string, string> = {
        blank_name:        `COALESCE(TRIM(first_name), '') = ''`,
        unvalidated_email: `(email_status IS NULL OR email_status = 'active')`,
        bad_email:         `email_status IN ('bounced', 'invalid', 'unsafe')`,
        missing_vertical:  `COALESCE(TRIM(vertical), '') = ''`,
        missing_phone:     `COALESCE(TRIM(phone), '') = ''`,
      };

      const whereClause = issue && issueFilters[issue]
        ? `archived_at IS NULL AND (${issueFilters[issue]}) AND COALESCE(lead_score, 0) >= ${minLeadScore}`
        : `archived_at IS NULL AND COALESCE(lead_score, 0) >= ${minLeadScore}`;

      const countResult = await pool.query(
        `SELECT COUNT(*)::int AS total FROM contacts WHERE ${whereClause}`,
      );

      const rowsResult = await pool.query(`
        SELECT
          id, first_name, last_name, email, email_status,
          phone, vertical, company_name, lead_score,
          created_at
        FROM contacts
        WHERE ${whereClause}
        ORDER BY COALESCE(lead_score, 0) DESC, id DESC
        LIMIT ${limit} OFFSET ${offset}
      `);

      res.json({
        total: countResult.rows[0]?.total ?? 0,
        page,
        limit,
        data: rowsResult.rows,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/contacts/validate-emails-batch
  // Runs ZeroBounce on a filtered set of contacts, respecting the daily cap.
  app.post("/api/contacts/validate-emails-batch", requireRole("admin", "manager"), async (req, res) => {
    try {
      const schema = z.object({
        issue:        z.string().optional().default("unvalidated_email"),
        minLeadScore: z.number().int().min(0).max(100).optional().default(0),
        limit:        z.number().int().min(1).max(500).optional().default(100),
        contactIds:   z.array(z.number().int().positive()).optional().default([]),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }
      const { issue, minLeadScore, limit: batchLimit, contactIds: explicitIds } = parsed.data;

      const { checkZeroBounceBudget, claimZeroBounceCredit } = await import("../services/zerobounce-daily-limiter");
      const { verifyEmail } = await import("../services/sdr/zerobounce");

      const budget = await checkZeroBounceBudget();
      if (!budget.allowed) {
        return res.status(429).json({
          message: `ZeroBounce daily cap reached (${budget.used}/${budget.limit}). Resets tomorrow.`,
        });
      }

      // Determine candidate contact IDs
      let candidateIds: number[];
      if (explicitIds.length > 0) {
        candidateIds = explicitIds.slice(0, batchLimit);
      } else {
        const issueFilters: Record<string, string> = {
          blank_name:        `COALESCE(TRIM(first_name), '') = ''`,
          unvalidated_email: `(email_status IS NULL OR email_status = 'active')`,
          bad_email:         `email_status IN ('bounced', 'invalid', 'unsafe')`,
          missing_vertical:  `COALESCE(TRIM(vertical), '') = ''`,
          missing_phone:     `COALESCE(TRIM(phone), '') = ''`,
        };
        const whereClause = issueFilters[issue] ?? `(email_status IS NULL OR email_status = 'active')`;
        const rows = await pool.query(`
          SELECT id FROM contacts
          WHERE archived_at IS NULL
            AND COALESCE(TRIM(email), '') != ''
            AND COALESCE(lead_score, 0) >= ${minLeadScore}
            AND (${whereClause})
          ORDER BY COALESCE(lead_score, 0) DESC
          LIMIT ${batchLimit}
        `);
        candidateIds = rows.rows.map((r: any) => r.id);
      }

      const maxToProcess = Math.min(candidateIds.length, budget.limit - budget.used);
      const toProcess = candidateIds.slice(0, maxToProcess);

      // Fire-and-forget: process in background, return job handle immediately.
      // Write initial state BEFORE setImmediate so the first poll never 404s.
      const jobId = crypto.randomUUID();
      const actorId = String((req.user as any)?.id ?? "system");

      await storage.setSystemSetting(`zerobounce_batch_job_${jobId}`, {
        done: false, processed: 0, valid: 0, blocked: 0, errors: 0,
        queued: toProcess.length, startedAt: new Date().toISOString(),
      });

      setImmediate(async () => {
        let processed = 0, valid = 0, blocked = 0, errors = 0;
        for (const contactId of toProcess) {
          try {
            const contact = await storage.getContact(contactId);
            if (!contact?.email) continue;
            const credited = await claimZeroBounceCredit();
            if (!credited) break;

            const zbResult = await verifyEmail(contact.email);
            await pool.query(`UPDATE contacts SET email_status = $1 WHERE id = $2`, [zbResult.status, contactId]);
            await storage.createAuditLog({
              action: "zerobounce_email_validated",
              entityType: "contact",
              entityId: contactId,
              actorType: "admin",
              actorId,
              details: { email: contact.email, zbStatus: zbResult.status, zbSubStatus: zbResult.subStatus ?? null, source: "batch" },
            });
            processed++;
            if (zbResult.status === "valid") valid++;
            else if (zbResult.status === "unsafe") blocked++;
          } catch (e) {
            errors++;
          }
        }
        // Overwrite with final done state
        await storage.setSystemSetting(`zerobounce_batch_job_${jobId}`, {
          done: true, processed, valid, blocked, errors,
          queued: toProcess.length, completedAt: new Date().toISOString(),
        });
      });

      res.json({
        jobId,
        queued: toProcess.length,
        budgetRemaining: budget.limit - budget.used,
        message: `Validating ${toProcess.length} email(s) in the background. Poll /api/contacts/validate-emails-batch/${jobId} for status.`,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/contacts/validate-emails-batch/:jobId — poll batch job status
  app.get("/api/contacts/validate-emails-batch/:jobId", requireRole("admin", "manager"), async (req, res) => {
    try {
      const jobId = req.params.jobId;
      const status = await storage.getSystemSetting(`zerobounce_batch_job_${jobId}`);
      if (!status) return res.status(404).json({ message: "Job not found or still starting" });
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/contacts/:id/validate-email — validate a single contact's email via ZeroBounce
  app.post("/api/contacts/:id/validate-email", requireRole("admin", "manager"), async (req, res) => {
    try {
      const contactId = Number(req.params.id);
      if (!Number.isFinite(contactId)) return res.status(400).json({ message: "Invalid contact ID" });

      const contact = await storage.getContact(contactId);
      if (!contact) return res.status(404).json({ message: "Contact not found" });
      if (!contact.email) return res.status(400).json({ message: "Contact has no email address" });

      const { checkZeroBounceBudget, claimZeroBounceCredit } = await import("../services/zerobounce-daily-limiter");
      const { verifyEmail } = await import("../services/sdr/zerobounce");

      const budget = await checkZeroBounceBudget();
      if (!budget.allowed) {
        return res.status(429).json({ message: `ZeroBounce daily cap reached (${budget.used}/${budget.limit})` });
      }

      const credited = await claimZeroBounceCredit();
      if (!credited) return res.status(429).json({ message: "Could not claim ZeroBounce credit" });

      const zbResult = await verifyEmail(contact.email);
      await pool.query(`UPDATE contacts SET email_status = $1 WHERE id = $2`, [zbResult.status, contactId]);
      await storage.createAuditLog({
        action: "zerobounce_email_validated",
        entityType: "contact",
        entityId: contactId,
        actorType: "admin",
        actorId: String((req.user as any)?.id ?? "system"),
        details: { email: contact.email, zbStatus: zbResult.status, zbSubStatus: zbResult.subStatus ?? null, source: "manual" },
      });

      res.json({ success: true, email: contact.email, status: zbResult.status, subStatus: zbResult.subStatus ?? null });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/contacts/:id/send-email — send a composed email via GHL
  app.post("/api/contacts/:id/send-email", isDashboardUser, async (req, res) => {
    try {
      const contactId = Number(req.params.id);
      const schema = z.object({
        subject: z.string().min(1, "Subject is required"),
        body: z.string().min(1, "Body is required"),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }
      const { subject, body } = parsed.data;

      const contact = await storage.getContact(contactId);
      if (!contact) return res.status(404).json({ message: "Contact not found" });
      if (!contact.email) return res.status(400).json({ message: "Contact has no email address" });
      if (!isGhlConfigured()) return res.status(503).json({ message: "GHL is not configured" });

      const { sendGhlEmail } = await import("../services/ghl");
      const result = await sendGhlEmail({ contactId, subject, body });

      if (!result.success) {
        return res.status(502).json({ message: result.error ?? "GHL send failed" });
      }

      await storage.createAuditLog({
        action: "email_sent_via_composer",
        entityType: "contact",
        entityId: contactId,
        actorType: "admin",
        actorId: String((req.user as any)?.id ?? "unknown"),
        details: { subject, toEmail: contact.email, messageId: result.messageId ?? null },
      });

      res.json({ success: true, messageId: result.messageId ?? null });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

}

/**
 * Returns true if the sequence violates email-only constraints.
 * A sequence is email-only if:
 *  - channelsAllowed is null/empty OR equals ["email"]
 *  - No steps have actionType of "sms", "call", or "voicemail_drop"
 */
async function checkEmailOnlyViolation(
  sequenceId: number,
  sequence: { channelsAllowed?: string[] | null }
): Promise<boolean> {
  const blocked_step_types = ["sms", "call", "voicemail_drop"];

  // If channelsAllowed is explicitly set and not ["email"], it's a violation
  const channels = sequence.channelsAllowed;
  if (channels && channels.length > 0) {
    if (channels.length !== 1 || channels[0] !== "email") {
      return true;
    }
  }

  // Also inspect steps for non-email outbound actions
  const steps = await storage.getSequenceSteps(sequenceId);
  for (const step of steps) {
    if (blocked_step_types.includes(step.actionType)) {
      return true;
    }
  }

  return false;
}
