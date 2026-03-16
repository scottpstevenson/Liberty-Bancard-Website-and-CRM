import type { Express } from "express";
import { isAuthenticated } from "../replit_integrations/auth";
import { storage } from "../storage";
import { z } from "zod";
import { and } from "drizzle-orm";
import { insertEquipmentOrderSchema, insertMerchantApplicationSchema, insertMerchantProfileSchema, insertOnboardingStepSchema } from "@shared/schema";
import { getDocumentStatus, sendDocumentForEsign } from "../services/ghl";
import { parse } from "csv-parse/sync";
import path from "path";

export function registerMerchantsRoutes(app: Express) {
  // === MERCHANT APPLICATIONS ===
  app.post("/api/merchant-applications", async (req, res) => {
    try {
      const input = insertMerchantApplicationSchema.parse(req.body);
      const application = await storage.createMerchantApplication(input);
      res.status(201).json(application);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/merchant-applications/user/:userId", async (req, res) => {
    try {
      const application = await storage.getMerchantApplicationByUser(req.params.userId);
      if (!application) return res.status(404).json({ message: "Not found" });
      res.json(application);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/merchant-applications/:id", async (req, res) => {
    try {
      const application = await storage.getMerchantApplication(Number(req.params.id));
      if (!application) return res.status(404).json({ message: "Not found" });
      res.json(application);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/merchant-applications/:id", async (req, res) => {
    try {
      const updated = await storage.updateMerchantApplication(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
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
      res.json(profile);
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
