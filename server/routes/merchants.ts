import type { Express, RequestHandler } from "express";
import { isAuthenticated, isDashboardUser } from "../replit_integrations/auth";
import { storage } from "../storage";
import { z } from "zod";
import { and } from "drizzle-orm";
import { insertEquipmentOrderSchema, insertMerchantApplicationSchema, insertMerchantProfileSchema, insertOnboardingStepSchema } from "@shared/schema";
import { getDocumentStatus, sendDocumentForEsign } from "../services/ghl";
import { syncMerchantApplicationToGhl } from "../services/ghl-form-sync";
import { createContactGhlFirst } from "../services/contact-writer";
import { sendMerchantWelcomeEmail } from "../services/merchant-welcome";
import { sendApplicationApprovedEmail, sendApplicationDeclinedEmail } from "../services/merchant-application-status";
import { parse } from "csv-parse/sync";
import path from "path";

const isAdminOrManager: RequestHandler = (req, res, next) => {
  const role = (req.user as any)?.role;
  if (req.isAuthenticated() && (role === "admin" || role === "manager")) {
    return next();
  }
  return res.status(403).json({ message: "Admin or manager access required" });
};

export function registerMerchantsRoutes(app: Express) {
  // === MERCHANT APPLICATIONS ===
  app.post("/api/merchant-applications", isAuthenticated, async (req, res) => {
    try {
      const input = insertMerchantApplicationSchema.parse(req.body);
      const application = await storage.createMerchantApplication(input);

      const contactEmail = application.ownerEmail || application.businessEmail;
      if (contactEmail) {
        const contact = await createContactGhlFirst({
          firstName: application.ownerFirstName || "",
          lastName: application.ownerLastName || "",
          email: contactEmail,
          phone: application.businessPhone || application.ownerPhone || "",
          companyName: application.legalBusinessName || application.dba || "",
          vertical: application.vertical || undefined,
          status: "New",
          tags: ["src_merchant_app", "merchant_application"],
        }).catch(() => null);

        if (contact) {
          syncMerchantApplicationToGhl(application.id, contact.id).catch(err =>
            console.error("GHL merchant app sync error:", err)
          );
        }
      }

      res.status(201).json(application);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/merchant-applications", isAdminOrManager, async (req, res) => {
    try {
      const { status, search, limit = "50", offset = "0" } = req.query as Record<string, string>;
      let applications = await storage.getMerchantApplications();

      if (status && status !== "all") {
        applications = applications.filter((a) => a.status === status);
      }

      if (search) {
        const q = search.toLowerCase();
        applications = applications.filter(
          (a) =>
            (a.legalBusinessName || "").toLowerCase().includes(q) ||
            (a.dba || "").toLowerCase().includes(q) ||
            (a.businessEmail || "").toLowerCase().includes(q) ||
            (a.ownerEmail || "").toLowerCase().includes(q) ||
            (a.ownerFirstName || "").toLowerCase().includes(q) ||
            (a.ownerLastName || "").toLowerCase().includes(q)
        );
      }

      const total = applications.length;
      const paginated = applications.slice(Number(offset), Number(offset) + Number(limit));

      res.json({ applications: paginated, total, limit: Number(limit), offset: Number(offset) });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/merchant-applications/pending-count", isAdminOrManager, async (_req, res) => {
    try {
      const applications = await storage.getMerchantApplications();
      const count = applications.filter(
        (a) => a.status === "submitted" || a.status === "under_review"
      ).length;
      res.json({ count });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/merchant-applications/user/:userId", isAuthenticated, async (req, res) => {
    try {
      const application = await storage.getMerchantApplicationByUser(req.params.userId);
      if (!application) return res.status(404).json({ message: "Not found" });
      res.json(application);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/merchant-applications/:id", isAuthenticated, async (req, res) => {
    try {
      const application = await storage.getMerchantApplication(Number(req.params.id));
      if (!application) return res.status(404).json({ message: "Not found" });
      res.json(application);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/merchant-applications/:id", isAdminOrManager, async (req, res) => {
    try {
      const appId = Number(req.params.id);
      const existing = await storage.getMerchantApplication(appId);
      if (!existing) return res.status(404).json({ message: "Not found" });

      const updates = { ...req.body } as Record<string, any>;
      const incomingNote = typeof updates.underwritingNotes === "string"
        ? updates.underwritingNotes.trim()
        : "";
      if (incomingNote) {
        const user = (req.user as any) || {};
        const authorName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim()
          || user.email
          || user.id
          || "Unknown";
        const prevLog = Array.isArray(existing.underwritingNotesLog)
          ? existing.underwritingNotesLog
          : [];
        updates.underwritingNotesLog = [
          ...prevLog,
          {
            note: incomingNote,
            author: authorName,
            authorId: user.id ?? null,
            createdAt: new Date().toISOString(),
          },
        ];
      } else if ("underwritingNotes" in updates && !incomingNote) {
        // Don't overwrite existing notes with an empty string
        delete updates.underwritingNotes;
      }

      const updated = await storage.updateMerchantApplication(appId, updates);
      if (!updated) return res.status(404).json({ message: "Not found" });

      const wasApproved = existing.status !== "approved" && updated.status === "approved";
      const wasDeclined = existing.status !== "declined" && updated.status === "declined";

      if (wasApproved) {
        sendApplicationApprovedEmail(updated).catch((err) =>
          console.error("[Application Approval] Approval email error:", err)
        );
      }

      if (wasDeclined) {
        sendApplicationDeclinedEmail(updated).catch((err) =>
          console.error("[Application Decline] Decline email error:", err)
        );
      }

      if (wasApproved && updated.dealId) {
        (async () => {
          try {
            const deal = await storage.getDeal(updated.dealId!);
            if (deal && deal.stage !== "Closed Won") {
              const closedDeal = await storage.updateDeal(updated.dealId!, { stage: "Closed Won" });
              if (closedDeal && closedDeal.contactId) {
                const contact = await storage.getContact(closedDeal.contactId);
                if (contact?.ghlContactId) {
                  sendMerchantWelcomeEmail(contact, closedDeal).catch((err) =>
                    console.error("[Application Approval] Merchant welcome email error:", err)
                  );
                }
              }
            }
          } catch (err) {
            console.error("[Application Approval] Deal advancement error:", err);
          }
        })();
      }

      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/merchant-applications/:id/send-esign", isAuthenticated, async (req, res) => {
    try {
      const appId = Number(req.params.id);
      const application = await storage.getMerchantApplication(appId);
      if (!application) return res.status(404).json({ message: "Application not found" });

      const templateId = process.env.GHL_MERCHANT_AGREEMENT_TEMPLATE_ID;
      if (!templateId) {
        return res.status(400).json({
          message: "GHL document template not configured. Set GHL_MERCHANT_AGREEMENT_TEMPLATE_ID.",
          requiresConfig: true,
        });
      }

      const recipientName = `${application.ownerFirstName || ""} ${application.ownerLastName || ""}`.trim() || application.legalBusinessName || "Merchant";
      const recipientEmail = application.ownerEmail || application.businessEmail || "";
      if (!recipientEmail) {
        return res.status(400).json({ message: "No email address found on application" });
      }

      const result = await sendDocumentForEsign({
        documentTemplateId: templateId,
        recipientName,
        recipientEmail,
        applicationId: appId,
      });

      if (!result.success) {
        return res.status(500).json({ message: result.error || "Failed to send document for e-signature" });
      }

      await storage.updateMerchantApplication(appId, {
        esignStatus: "sent",
        esignDocumentId: result.documentId || null,
        esignSigningUrl: result.signingUrl || null,
      });

      res.json({
        success: true,
        message: "E-signature document sent via GoHighLevel",
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/merchant-applications/request-esign", async (req, res) => {
    try {
      const { applicationId, email } = req.body;
      if (!applicationId || !email) {
        return res.status(400).json({ message: "Application ID and email are required" });
      }
      const application = await storage.getMerchantApplication(Number(applicationId));
      if (!application) return res.status(404).json({ message: "Application not found" });

      if (application.businessEmail !== email && application.ownerEmail !== email) {
        return res.status(403).json({ message: "Email does not match application" });
      }

      if (application.esignStatus === "sent" && application.esignDocumentId) {
        return res.json({ status: "sent", message: "E-signature document already sent to your email" });
      }

      const templateId = process.env.GHL_MERCHANT_AGREEMENT_TEMPLATE_ID;
      if (!templateId) {
        return res.json({ status: "pending", message: "Your agreement will be sent for signature shortly" });
      }

      const recipientName = `${application.ownerFirstName || ""} ${application.ownerLastName || ""}`.trim() || application.legalBusinessName || "Merchant";
      const recipientEmail = application.ownerEmail || application.businessEmail || "";

      const result = await sendDocumentForEsign({
        documentTemplateId: templateId,
        recipientName,
        recipientEmail,
        applicationId: Number(applicationId),
      });

      if (result.success) {
        await storage.updateMerchantApplication(Number(applicationId), {
          esignStatus: "sent",
          esignDocumentId: result.documentId || null,
          esignSigningUrl: result.signingUrl || null,
        });
        return res.json({ status: "sent", message: "E-signature document sent to your email" });
      }

      res.json({ status: "pending", message: "Your agreement will be sent for signature shortly" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/merchant-applications/:id/esign-status", isAuthenticated, async (req, res) => {
    try {
      const appId = Number(req.params.id);
      const application = await storage.getMerchantApplication(appId);
      if (!application) return res.status(404).json({ message: "Application not found" });

      if (!application.esignDocumentId) {
        return res.json({ status: application.esignStatus || "pending" });
      }

      const docStatus = await getDocumentStatus(application.esignDocumentId);

      if (docStatus.status === "completed" || docStatus.status === "signed") {
        await storage.updateMerchantApplication(appId, {
          esignStatus: "signed",
          esignedAt: new Date(),
        });
      }

      res.json({
        status: docStatus.status === "completed" || docStatus.status === "signed" ? "signed" : application.esignStatus,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/webhooks/ghl-document", async (req, res) => {
    try {
      const webhookSecret = process.env.GHL_WEBHOOK_SECRET;
      if (webhookSecret) {
        const signature = req.headers["x-ghl-signature"] || req.headers["x-webhook-signature"];
        if (!signature || signature !== webhookSecret) {
          console.warn("[GHL Document Webhook] Invalid signature, rejecting");
          return res.status(401).json({ received: false });
        }
      }

      const { documentId, status, contactId } = req.body;
      console.log("[GHL Document Webhook] Received:", { documentId, status, contactId });

      if (documentId && (status === "completed" || status === "signed")) {
        const applications = await storage.getMerchantApplications();
        const app = applications.find((a: any) => a.esignDocumentId === documentId);
        if (app) {
          await storage.updateMerchantApplication(app.id, {
            esignStatus: "signed",
            esignedAt: new Date(),
          });
          console.log(`[GHL Document Webhook] Application #${app.id} e-sign completed`);
        }
      }

      res.json({ received: true });
    } catch (err: any) {
      console.error("[GHL Document Webhook] Error:", err.message);
      res.json({ received: true });
    }
  });


  // === MERCHANT PROFILES ===
  app.get("/api/merchant-profile", isAuthenticated, async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ message: "Not authenticated" });
      const profile = await storage.getMerchantProfileByUser(userId);
      if (!profile) return res.status(404).json({ message: "Not found" });
      // Enrich response with business name from associated contact
      let businessName: string | null = null;
      if (profile.contactId) {
        try {
          const contact = await storage.getContact(profile.contactId);
          businessName = contact?.companyName || null;
        } catch {}
      }
      res.json({ ...profile, businessName });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/merchant-profiles", isAuthenticated, async (req, res) => {
    try {
      const input = insertMerchantProfileSchema.parse(req.body);
      const profile = await storage.createMerchantProfile(input);
      res.status(201).json(profile);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/merchant-profiles/:id", isAuthenticated, async (req, res) => {
    try {
      const user = (req as any).user;
      if (user?.role !== "admin" && user?.role !== "manager") {
        return res.status(403).json({ message: "Admin or manager role required" });
      }
      const id = Number(req.params.id);
      const allowed = ["merchantMid", "accountStatus", "programType", "currentMonthlyVolume"] as const;
      const updates: Record<string, unknown> = {};
      for (const k of allowed) {
        if (req.body[k] !== undefined) {
          updates[k] = req.body[k] === "" ? null : req.body[k];
        }
      }
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "No editable fields supplied" });
      }
      const updated = await storage.updateMerchantProfile(id, updates as any);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });


  // === EQUIPMENT ORDERS ===
  app.get("/api/equipment-orders", isAuthenticated, async (req, res) => {
    try {
      const dealId = req.query.dealId ? Number(req.query.dealId) : undefined;
      const orders = dealId ? await storage.getEquipmentOrdersByDeal(dealId) : await storage.getEquipmentOrders();
      res.json(orders);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/equipment-orders/:id", isAuthenticated, async (req, res) => {
    try {
      const order = await storage.getEquipmentOrder(Number(req.params.id));
      if (!order) return res.status(404).json({ message: "Not found" });
      res.json(order);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/equipment-orders", isAuthenticated, async (req, res) => {
    try {
      const input = insertEquipmentOrderSchema.parse(req.body);
      const order = await storage.createEquipmentOrder(input);
      res.status(201).json(order);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/equipment-orders/:id", isAuthenticated, async (req, res) => {
    try {
      const updated = await storage.updateEquipmentOrder(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });


  // === ONBOARDING STEPS ===
  app.get("/api/onboarding-steps/deal/:dealId", isAuthenticated, async (req, res) => {
    try {
      const steps = await storage.getOnboardingStepsByDeal(Number(req.params.dealId));
      res.json(steps);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/onboarding-steps/application/:applicationId", isAuthenticated, async (req, res) => {
    try {
      const steps = await storage.getOnboardingStepsByApplication(Number(req.params.applicationId));
      res.json(steps);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/onboarding-steps", isAuthenticated, async (req, res) => {
    try {
      const input = insertOnboardingStepSchema.parse(req.body);
      const step = await storage.createOnboardingStep(input);
      res.status(201).json(step);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/onboarding-steps/:id", isAuthenticated, async (req, res) => {
    try {
      const updated = await storage.updateOnboardingStep(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

}
