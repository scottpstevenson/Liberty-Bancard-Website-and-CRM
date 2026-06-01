import type { Express, RequestHandler } from "express";
import { isAuthenticated, isDashboardUser, requireRole } from "../replit_integrations/auth";
import { storage } from "../storage";
import { z } from "zod";
import { and } from "drizzle-orm";
import { insertEquipmentOrderSchema, insertMerchantApplicationSchema, insertMerchantProfileSchema, insertOnboardingStepSchema } from "@shared/schema";
import { getDocumentStatus, sendDocumentForEsign } from "../services/ghl";
import { syncMerchantApplicationToGhl } from "../services/ghl-form-sync";
import { createContactGhlFirst } from "../services/contact-writer";
import { sendMerchantWelcomeEmail, sendMerchantPortalWelcomeEmail } from "../services/merchant-welcome";
import { sendApplicationApprovedEmail, sendApplicationDeclinedEmail } from "../services/merchant-application-status";
import { scanApplicationRisk } from "../services/relationship-extractor";
import { parse } from "csv-parse/sync";
import path from "path";
import { publicLeadRateLimit, webhookRateLimit } from "../middleware/public-rate-limit";

const EMAIL_COOLDOWN_MS = 5 * 60 * 1000;

function createEmailCooldown(cooldownMs: number) {
  const cooldowns = new Map<number, Date>();

  function checkCooldown(key: number): { inCooldown: boolean; retryAfter: number; lastSentAt: Date | null } {
    const lastSentAt = cooldowns.get(key) ?? null;
    if (!lastSentAt) return { inCooldown: false, retryAfter: 0, lastSentAt: null };
    const elapsed = Date.now() - lastSentAt.getTime();
    if (elapsed < cooldownMs) {
      const retryAfter = Math.ceil((cooldownMs - elapsed) / 1000);
      return { inCooldown: true, retryAfter, lastSentAt };
    }
    return { inCooldown: false, retryAfter: 0, lastSentAt };
  }

  function recordSend(key: number): Date {
    const sentAt = new Date();
    cooldowns.set(key, sentAt);
    return sentAt;
  }

  async function hydrateFromAuditLog(key: number, action: string, entityType: string): Promise<void> {
    if (cooldowns.has(key)) return;
    try {
      const lastLog = await storage.getLastAuditLogByAction(action, entityType, key);
      if (lastLog?.createdAt) {
        cooldowns.set(key, new Date(lastLog.createdAt));
      }
    } catch {}
  }

  return { checkCooldown, recordSend, hydrateFromAuditLog };
}

const welcomeEmailCooldown = createEmailCooldown(EMAIL_COOLDOWN_MS);
const esignEmailCooldown = createEmailCooldown(EMAIL_COOLDOWN_MS);
const approvedEmailCooldown = createEmailCooldown(EMAIL_COOLDOWN_MS);
const declinedEmailCooldown = createEmailCooldown(EMAIL_COOLDOWN_MS);

const isAdminOrManager: RequestHandler = (req, res, next) => {
  const role = (req.user as any)?.role;
  if (req.isAuthenticated() && (role === "admin" || role === "manager")) {
    return next();
  }
  return res.status(403).json({ message: "Admin or manager access required" });
};

function canAccessApplication(req: any, application: { userId?: string | null }): boolean {
  const user = req.user as any;
  if (!user) return false;
  const role = user.role;
  if (role === "admin" || role === "manager") return true;
  if (application.userId && user.id && application.userId === user.id) return true;
  return false;
}

export function registerMerchantsRoutes(app: Express) {
  // === MERCHANT APPLICATIONS ===
  app.post("/api/merchant-applications", isAuthenticated, async (req, res) => {
    try {
      const input = insertMerchantApplicationSchema.parse(req.body);
      const application = await storage.createMerchantApplication(input, { actorType: "user", userId: (req.user as any)?.id ?? null });

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
          scanApplicationRisk(contact.id, application.id).then((result) => {
            if (result.hasRisk) {
              console.warn(
                `[Relationships] Application risk detected for contact ${contact.id}: ${result.relationships.length} flagged relationship(s) — persisted to app #${application.id}`,
              );
            }
          }).catch(err => console.warn("[Relationships] Application risk scan failed:", err));
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
      if (!canAccessApplication(req, application)) {
        return res.status(403).json({ message: "Forbidden" });
      }
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

      const updated = await storage.updateMerchantApplication(appId, updates, { userId: (req.user as any)?.id ?? null });
      if (!updated) return res.status(404).json({ message: "Not found" });

      const wasApproved = existing.status !== "approved" && updated.status === "approved";
      const wasDeclined = existing.status !== "declined" && updated.status === "declined";

      if (wasApproved) {
        approvedEmailCooldown.hydrateFromAuditLog(appId, "merchant_application_approved_email_sent", "merchant_application").then(() => {
          const { inCooldown } = approvedEmailCooldown.checkCooldown(appId);
          if (inCooldown) {
            console.warn(`[Application Approval] Skipping approval email for application #${appId} — cooldown active`);
            return;
          }
          approvedEmailCooldown.recordSend(appId);
          sendApplicationApprovedEmail(updated).catch((err) =>
            console.error("[Application Approval] Approval email error:", err)
          );
        }).catch((err) => console.error("[Application Approval] Cooldown hydration error:", err));
      }

      if (wasDeclined) {
        declinedEmailCooldown.hydrateFromAuditLog(appId, "merchant_application_declined_email_sent", "merchant_application").then(() => {
          const { inCooldown } = declinedEmailCooldown.checkCooldown(appId);
          if (inCooldown) {
            console.warn(`[Application Decline] Skipping decline email for application #${appId} — cooldown active`);
            return;
          }
          declinedEmailCooldown.recordSend(appId);
          sendApplicationDeclinedEmail(updated).catch((err) =>
            console.error("[Application Decline] Decline email error:", err)
          );
        }).catch((err) => console.error("[Application Decline] Cooldown hydration error:", err));
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

      await esignEmailCooldown.hydrateFromAuditLog(appId, "merchant_application_esign_sent", "merchant_application");
      const { inCooldown, retryAfter, lastSentAt } = esignEmailCooldown.checkCooldown(appId);
      if (inCooldown) {
        return res.status(429).json({
          message: `Please wait ${Math.ceil(retryAfter / 60)} minute(s) before resending the e-signature document.`,
          retryAfter,
          lastSentAt: lastSentAt!.toISOString(),
        });
      }

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

      esignEmailCooldown.recordSend(appId);
      await storage.createAuditLog({
        action: "merchant_application_esign_sent",
        entityType: "merchant_application",
        entityId: appId,
        details: { recipientEmail },
      });

      res.json({
        success: true,
        message: "E-signature document sent via GoHighLevel",
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/merchant-applications/request-esign", publicLeadRateLimit, async (req, res) => {
    try {
      const { applicationId, email } = req.body;
      if (!applicationId || !email) {
        return res.status(400).json({ message: "Application ID and email are required" });
      }
      const appId = Number(applicationId);
      const application = await storage.getMerchantApplication(appId);
      if (!application) return res.status(404).json({ message: "Application not found" });

      if (application.businessEmail !== email && application.ownerEmail !== email) {
        return res.status(403).json({ message: "Email does not match application" });
      }

      if (application.esignStatus === "sent" && application.esignDocumentId) {
        return res.json({ status: "sent", message: "E-signature document already sent to your email" });
      }

      await esignEmailCooldown.hydrateFromAuditLog(appId, "merchant_application_esign_sent", "merchant_application");
      const { inCooldown, retryAfter } = esignEmailCooldown.checkCooldown(appId);
      if (inCooldown) {
        return res.status(429).json({
          message: `Please wait ${Math.ceil(retryAfter / 60)} minute(s) before requesting another e-signature document.`,
          retryAfter,
        });
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
        applicationId: appId,
      });

      if (result.success) {
        await storage.updateMerchantApplication(appId, {
          esignStatus: "sent",
          esignDocumentId: result.documentId || null,
          esignSigningUrl: result.signingUrl || null,
        });
        esignEmailCooldown.recordSend(appId);
        await storage.createAuditLog({
          action: "merchant_application_esign_sent",
          entityType: "merchant_application",
          entityId: appId,
          details: { recipientEmail },
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
      if (!canAccessApplication(req, application)) {
        return res.status(403).json({ message: "Forbidden" });
      }

      await esignEmailCooldown.hydrateFromAuditLog(appId, "merchant_application_esign_sent", "merchant_application");
      const { retryAfter: cooldownRemaining, lastSentAt } = esignEmailCooldown.checkCooldown(appId);

      if (!application.esignDocumentId) {
        return res.json({
          status: application.esignStatus || "pending",
          cooldownRemaining,
          lastSentAt: lastSentAt?.toISOString() ?? null,
        });
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
        cooldownRemaining,
        lastSentAt: lastSentAt?.toISOString() ?? null,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/webhooks/ghl-document", webhookRateLimit, async (req, res) => {
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
      const existing = await storage.getMerchantProfile(id);
      if (!existing) return res.status(404).json({ message: "Not found" });

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

      const wasActivated =
        existing.accountStatus !== "active" && updated.accountStatus === "active";

      if (wasActivated) {
        welcomeEmailCooldown.hydrateFromAuditLog(id, "merchant_portal_welcome_sent", "merchant_profile").then(() => {
          const { inCooldown } = welcomeEmailCooldown.checkCooldown(id);
          if (inCooldown) {
            console.warn(`[Merchant Profile] Skipping portal welcome email for profile #${id} — cooldown active`);
            return;
          }
          welcomeEmailCooldown.recordSend(id);
          sendMerchantPortalWelcomeEmail(updated).catch(err =>
            console.error("[Merchant Profile] Portal welcome email error:", err)
          );
        }).catch(err => console.error("[Merchant Profile] Cooldown hydration error:", err));
      }

      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/merchant-profiles/:id/welcome-email-status", isAdminOrManager, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const profile = await storage.getMerchantProfile(id);
      if (!profile) return res.status(404).json({ message: "Merchant profile not found" });

      await welcomeEmailCooldown.hydrateFromAuditLog(id, "merchant_portal_welcome_sent", "merchant_profile");
      const { retryAfter: cooldownRemaining, lastSentAt } = welcomeEmailCooldown.checkCooldown(id);

      res.json({
        lastSentAt: lastSentAt?.toISOString() ?? null,
        cooldownRemaining,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/merchant-profiles/:id/send-welcome", isAdminOrManager, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const profile = await storage.getMerchantProfile(id);
      if (!profile) return res.status(404).json({ message: "Merchant profile not found" });

      if (profile.accountStatus !== "active") {
        return res.status(400).json({ message: "Welcome email can only be sent to active merchant accounts" });
      }

      await welcomeEmailCooldown.hydrateFromAuditLog(id, "merchant_portal_welcome_sent", "merchant_profile");
      const { inCooldown, retryAfter, lastSentAt } = welcomeEmailCooldown.checkCooldown(id);

      if (inCooldown) {
        return res.status(429).json({
          message: `Please wait ${Math.ceil(retryAfter / 60)} minute(s) before resending the welcome email.`,
          retryAfter,
          lastSentAt: lastSentAt!.toISOString(),
        });
      }

      await sendMerchantPortalWelcomeEmail(profile);
      const sentAt = welcomeEmailCooldown.recordSend(id);
      res.json({ success: true, message: "Welcome email has been resent", lastSentAt: sentAt.toISOString() });
    } catch (err: any) {
      console.error(`[Resend Welcome] Error for profile #${req.params.id}:`, err);
      res.status(500).json({ message: err.message || "Failed to send welcome email" });
    }
  });

  app.get("/api/merchant-profiles", isAdminOrManager, async (req, res) => {
    try {
      const profiles = await storage.getMerchantProfiles();
      res.json(profiles);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/merchant-profiles/:id", isAdminOrManager, async (req, res) => {
    try {
      const profile = await storage.getMerchantProfile(Number(req.params.id));
      if (!profile) return res.status(404).json({ message: "Not found" });
      res.json(profile);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/merchant-profiles/:id/welcome-email-history", isAdminOrManager, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const profile = await storage.getMerchantProfile(id);
      if (!profile) return res.status(404).json({ message: "Merchant profile not found" });

      const logs = await storage.getAuditLogsByEntity("merchant_profile", id, 20);
      const welcomeLogs = logs.filter(l => l.action === "merchant_portal_welcome_sent");
      res.json(welcomeLogs);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === MERCHANT FINANCIAL OVERVIEW ===
  app.get("/api/merchant/financial-overview", isAuthenticated, async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ message: "Not authenticated" });

      const profile = await storage.getMerchantProfileByUser(userId);
      if (!profile) return res.status(404).json({ message: "No merchant profile found" });

      const dealId = profile.dealId;
      let deal = dealId ? await storage.getDeal(dealId) : null;

      // Determine the MID to use
      const mid = profile.merchantMid || deal?.mid || null;

      // Pull up to 13 months of daily stats
      let allStats: any[] = [];
      if (mid) {
        allStats = await storage.getMidDailyStats(mid);
      } else if (dealId) {
        allStats = await storage.getMidDailyStatsByDeal(dealId, 400);
      }

      // Sort ascending by date
      allStats.sort((a: any, b: any) => a.date.localeCompare(b.date));

      // Helper: get stats within last N days
      const now = new Date();
      const statsInDays = (days: number) => {
        const cutoff = new Date(now);
        cutoff.setDate(cutoff.getDate() - days);
        const cutoffStr = cutoff.toISOString().split("T")[0];
        return allStats.filter((s: any) => s.date >= cutoffStr);
      };

      const stats30 = statsInDays(30);
      const stats60 = statsInDays(60);
      const stats90 = statsInDays(90);

      const sumVolume = (arr: any[]) => arr.reduce((s, r) => s + (Number(r.volume) || 0), 0);
      const sumTx = (arr: any[]) => arr.reduce((s, r) => s + (r.txCount || 0), 0);
      const sumCb = (arr: any[]) => arr.reduce((s, r) => s + (r.chargebackCount || 0), 0);
      const sumCbAmt = (arr: any[]) => arr.reduce((s, r) => s + (Number(r.chargebackAmount) || 0), 0);

      const vol30 = sumVolume(stats30);
      const vol60 = sumVolume(stats60);
      const vol90 = sumVolume(stats90);
      const tx30 = sumTx(stats30);
      const cb30 = sumCb(stats30);
      const cbAmt30 = sumCbAmt(stats30);

      // Approval rate: approvals / (approvals + declines) approximated from txCount/chargebackCount
      // We'll use a simple model: approvalRate = txCount / (txCount + chargebackCount + refundCount * 0.3)
      const refunds30 = stats30.reduce((s: number, r: any) => s + (r.refundCount || 0), 0);
      const estDeclines30 = cb30 + Math.round(refunds30 * 0.3);
      const approvalRate30 = tx30 > 0 ? Math.min(99.9, (tx30 / (tx30 + estDeclines30)) * 100) : null;

      // Chargeback ratio (chargebacks / transactions * 100)
      const cbRatio30 = tx30 > 0 ? (cb30 / tx30) * 100 : null;

      // Previous 30-day period for trend arrows
      const stats30Prev = allStats.filter((s: any) => {
        const d60cutoff = new Date(now); d60cutoff.setDate(d60cutoff.getDate() - 60);
        const d30cutoff = new Date(now); d30cutoff.setDate(d30cutoff.getDate() - 30);
        return s.date >= d60cutoff.toISOString().split("T")[0] && s.date < d30cutoff.toISOString().split("T")[0];
      });
      const volPrev30 = sumVolume(stats30Prev);
      const txPrev30 = sumTx(stats30Prev);
      const cbPrev30 = sumCb(stats30Prev);
      const cbRatioPrev30 = txPrev30 > 0 ? (cbPrev30 / txPrev30) * 100 : null;

      const trendPct = (curr: number, prev: number) => prev > 0 ? ((curr - prev) / prev) * 100 : null;
      const volTrend = trendPct(vol30, volPrev30);
      const cbRatioTrend = cbRatio30 !== null && cbRatioPrev30 !== null ? cbRatio30 - cbRatioPrev30 : null;

      // === MONTHLY CASH FLOW ===
      // Bucket daily stats into YYYY-MM months
      const monthlyMap: Record<string, { month: string; grossVolume: number; txCount: number; chargebackAmount: number }> = {};
      for (const s of allStats) {
        const month = s.date.slice(0, 7); // YYYY-MM
        if (!monthlyMap[month]) monthlyMap[month] = { month, grossVolume: 0, txCount: 0, chargebackAmount: 0 };
        monthlyMap[month].grossVolume += Number(s.volume) || 0;
        monthlyMap[month].txCount += s.txCount || 0;
        monthlyMap[month].chargebackAmount += Number(s.chargebackAmount) || 0;
      }

      // Effective rate from deal or average of daily stats
      const avgEffRate = allStats.length > 0
        ? allStats.reduce((s: number, r: any) => s + (Number(r.effectiveRate) || 0), 0) / allStats.length
        : (deal?.effectiveRate ? parseFloat(deal.effectiveRate) / 100 : 0.025);

      const monthlyCashFlow = Object.values(monthlyMap)
        .sort((a, b) => a.month.localeCompare(b.month))
        .slice(-13)
        .map(m => ({
          month: m.month,
          label: new Date(m.month + "-15").toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
          grossVolume: Math.round(m.grossVolume),
          netPayout: Math.round(m.grossVolume * (1 - avgEffRate) - m.chargebackAmount),
          fees: Math.round(m.grossVolume * avgEffRate + m.chargebackAmount),
        }));

      // === FEE BREAKDOWN ===
      const programType = profile.programType || deal?.offerPath || "standard";
      const isCashDiscount = programType?.toLowerCase().includes("cash") || programType?.toLowerCase().includes("discount");
      const isInterchangePlus = programType?.toLowerCase().includes("interchange") || programType?.toLowerCase().includes("ip");

      // Estimate monthly fees from 30-day data
      const monthlyVolEst = vol30;
      const interchange = monthlyVolEst * 0.0175; // avg interchange ~1.75%
      const processingFee = isCashDiscount ? 0 : monthlyVolEst * (avgEffRate - 0.0175); // markup above interchange
      const monthlyFee = 15; // typical monthly fee
      const cbFee = cb30 * 25; // $25/chargeback typical
      const totalFees = interchange + processingFee + monthlyFee + cbFee;
      const competitorRate = 0.0285; // typical competitor blended rate
      const competitorTotal = monthlyVolEst * competitorRate + monthlyFee + cbFee;
      const feeBreakdown = {
        interchange: Math.round(interchange * 100) / 100,
        processingFee: Math.round(processingFee * 100) / 100,
        monthlyFee,
        chargebackFees: Math.round(cbFee * 100) / 100,
        totalFees: Math.round(totalFees * 100) / 100,
        competitorEstimate: Math.round(competitorTotal * 100) / 100,
        savingsVsCompetitor: Math.round((competitorTotal - totalFees) * 100) / 100,
        effectiveRate: Math.round(avgEffRate * 10000) / 100, // as percentage
        competitorRate: 2.85,
        programType: isCashDiscount ? "Cash Discount" : isInterchangePlus ? "Interchange Plus" : "Standard",
      };

      // === DECLINE ANALYSIS ===
      // Without a dedicated declines table, we synthesize realistic breakdown
      // using refund and chargeback ratios as proxies for decline indicators
      const estTotalDeclines = estDeclines30;
      const declineCategories = [
        {
          code: "insufficient_funds",
          label: "Insufficient Funds",
          count: Math.round(estTotalDeclines * 0.38),
          pct: 38,
          color: "#ef4444",
          tip: "Consider offering split payments or installment options for larger ticket items.",
        },
        {
          code: "do_not_honor",
          label: "Do Not Honor",
          count: Math.round(estTotalDeclines * 0.27),
          pct: 27,
          color: "#f97316",
          tip: "Ask customers to contact their bank to authorize the transaction, or try a different card.",
        },
        {
          code: "card_expired",
          label: "Expired Card",
          count: Math.round(estTotalDeclines * 0.18),
          pct: 18,
          color: "#eab308",
          tip: "Remind customers to check their card expiration date before completing a purchase.",
        },
        {
          code: "incorrect_cvv",
          label: "CVV / Security Mismatch",
          count: Math.round(estTotalDeclines * 0.11),
          pct: 11,
          color: "#8b5cf6",
          tip: "Ensure customers enter the 3-4 digit security code on the back of their card.",
        },
        {
          code: "other",
          label: "Other",
          count: Math.round(estTotalDeclines * 0.06),
          pct: 6,
          color: "#6b7280",
          tip: "Contact Liberty Bancard support for transaction-level analysis on unusual declines.",
        },
      ];

      // === REVENUE TREND & PROJECTION ===
      // Build 12-month trend and project next month
      const revenueMonths = monthlyCashFlow.slice(-12);
      const last3Avg = revenueMonths.length > 0
        ? revenueMonths.slice(-3).reduce((s, m) => s + m.grossVolume, 0) / Math.min(3, revenueMonths.length)
        : 0;

      // Next month label
      const lastMonth = revenueMonths[revenueMonths.length - 1]?.month;
      let projMonthLabel = "Next Mo.";
      if (lastMonth) {
        const d = new Date(lastMonth + "-15");
        d.setMonth(d.getMonth() + 1);
        projMonthLabel = d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
      }

      const revenueTrend = [
        ...revenueMonths.map(m => ({ month: m.label, volume: m.grossVolume, projected: false })),
        { month: projMonthLabel, volume: Math.round(last3Avg), projected: true },
      ];

      // === INDUSTRY BENCHMARKS ===
      const vertical = (deal as any)?.offerPath || profile.programType || "retail";
      const benchmarks: Record<string, { cbRatio: number; approvalRate: number; avgTicket: number; label: string }> = {
        restaurant: { cbRatio: 0.6, approvalRate: 96.8, avgTicket: 42, label: "Restaurants" },
        retail: { cbRatio: 0.4, approvalRate: 97.2, avgTicket: 65, label: "Retail" },
        salon: { cbRatio: 0.3, approvalRate: 97.8, avgTicket: 75, label: "Beauty / Salon" },
        medical: { cbRatio: 0.2, approvalRate: 98.1, avgTicket: 185, label: "Medical / Healthcare" },
        automotive: { cbRatio: 0.5, approvalRate: 96.5, avgTicket: 320, label: "Auto / Repair" },
        ecommerce: { cbRatio: 1.2, approvalRate: 94.5, avgTicket: 95, label: "E-Commerce" },
        default: { cbRatio: 0.5, approvalRate: 97.0, avgTicket: 80, label: "Industry Average" },
      };

      const vertKey = Object.keys(benchmarks).find(k => vertical?.toLowerCase().includes(k)) || "default";
      const industryBench = benchmarks[vertKey];

      const avgTicket30 = tx30 > 0 ? vol30 / tx30 : null;

      const industryBenchmarking = {
        vertical: industryBench.label,
        merchantCbRatio: cbRatio30 !== null ? Math.round(cbRatio30 * 100) / 100 : null,
        industryCbRatio: industryBench.cbRatio,
        merchantApprovalRate: approvalRate30 !== null ? Math.round(approvalRate30 * 10) / 10 : null,
        industryApprovalRate: industryBench.approvalRate,
        merchantAvgTicket: avgTicket30 !== null ? Math.round(avgTicket30 * 100) / 100 : null,
        industryAvgTicket: industryBench.avgTicket,
      };

      const avgDailyVol30 = stats30.length > 0 ? vol30 / stats30.length : 0;

      res.json({
        hasData: allStats.length > 0,
        mid,
        overview: {
          vol30: Math.round(vol30),
          vol60: Math.round(vol60),
          vol90: Math.round(vol90),
          netRevenue30: Math.round(vol30 * (1 - avgEffRate) - cbAmt30),
          cbRatio30: cbRatio30 !== null ? Math.round(cbRatio30 * 1000) / 1000 : null,
          cbRatioTrend,
          approvalRate30: approvalRate30 !== null ? Math.round(approvalRate30 * 10) / 10 : null,
          volTrend,
          avgDailyVol30: Math.round(avgDailyVol30),
          tx30,
        },
        monthlyCashFlow,
        feeBreakdown,
        declineCategories,
        revenueTrend,
        industryBenchmarking,
      });
    } catch (err: any) {
      console.error("[Financial Overview] Error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // === EQUIPMENT ORDERS ===
  app.get("/api/equipment-orders", isDashboardUser, async (req, res) => {
    try {
      const dealId = req.query.dealId ? Number(req.query.dealId) : undefined;
      const orders = dealId ? await storage.getEquipmentOrdersByDeal(dealId) : await storage.getEquipmentOrders();
      res.json(orders);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/equipment-orders/:id", isDashboardUser, async (req, res) => {
    try {
      const order = await storage.getEquipmentOrder(Number(req.params.id));
      if (!order) return res.status(404).json({ message: "Not found" });
      res.json(order);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/equipment-orders", isDashboardUser, async (req, res) => {
    try {
      const input = insertEquipmentOrderSchema.parse(req.body);
      const order = await storage.createEquipmentOrder(input);
      res.status(201).json(order);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/equipment-orders/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const updated = await storage.updateEquipmentOrder(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });


  // === ONBOARDING STEPS ===
  app.get("/api/onboarding-steps/deal/:dealId", isDashboardUser, async (req, res) => {
    try {
      const steps = await storage.getOnboardingStepsByDeal(Number(req.params.dealId));
      res.json(steps);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/onboarding-steps/application/:applicationId", isDashboardUser, async (req, res) => {
    try {
      const steps = await storage.getOnboardingStepsByApplication(Number(req.params.applicationId));
      res.json(steps);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/onboarding-steps", requireRole("admin", "manager"), async (req, res) => {
    try {
      const input = insertOnboardingStepSchema.parse(req.body);
      const step = await storage.createOnboardingStep(input, { actorType: "user", userId: (req.user as any)?.id ?? null });
      res.status(201).json(step);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/onboarding-steps/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const updated = await storage.updateOnboardingStep(Number(req.params.id), req.body, { userId: (req.user as any)?.id ?? null });
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

}
