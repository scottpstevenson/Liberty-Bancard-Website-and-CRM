import type { Express, RequestHandler } from "express";
import { isAuthenticated, isDashboardUser, requireRole } from "../replit_integrations/auth";
import { storage } from "../storage";
import { z } from "zod";
import { DateValidationError } from "../utils/date-coerce";
import { and, eq, or, sql as drizzleSql } from "drizzle-orm";
import { insertEquipmentOrderSchema, insertMerchantApplicationSchema, insertMerchantProfileSchema, insertOnboardingStepSchema, contacts, deals, merchantApplications } from "@shared/schema";
import { db } from "../db";
import crypto from "crypto";
import { getDocumentStatus, sendDocumentForEsign } from "../services/ghl";
import { computeOrderEconomics } from "../services/terminal-economics";
import { syncMerchantApplicationToGhl } from "../services/ghl-form-sync";
import { enrollInGhlWorkflow } from "../services/ghl-workflows";
import { createContactGhlFirst } from "../services/contact-writer";
import { sendMerchantWelcomeEmail, sendMerchantPortalWelcomeEmail } from "../services/merchant-welcome";
import { sendApplicationApprovedEmail, sendApplicationDeclinedEmail } from "../services/merchant-application-status";
import { scanApplicationRisk } from "../services/relationship-extractor";
import { recordPewcDecision } from "../services/consent-evidence";
import { parse } from "csv-parse/sync";
import path from "path";
import { publicLeadRateLimit, webhookRateLimit } from "../middleware/public-rate-limit";
import { serverError, safeMessage } from "../utils/server-error";

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

// In-memory prefill token store (24h TTL)
interface PrefillTokenData {
  legalBusinessName?: string;
  dba?: string;
  businessType?: string;
  businessPhone?: string;
  businessEmail?: string;
  businessAddress?: string;
  businessCity?: string;
  businessState?: string;
  businessZip?: string;
  website?: string;
  vertical?: string;
  ownerFirstName?: string;
  ownerLastName?: string;
  ownerEmail?: string;
  ownerPhone?: string;
  estimatedMonthlyVolume?: string;
  currentProcessor?: string;
  dealId?: number;
  expiresAt: number;
}
const prefillTokenMap = new Map<string, PrefillTokenData>();
const PREFILL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function cleanExpiredPrefillTokens() {
  const now = Date.now();
  for (const [k, v] of prefillTokenMap) {
    if (v.expiresAt < now) prefillTokenMap.delete(k);
  }
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

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
  // === DRAFT PERSISTENCE (server-side, public endpoints) ===

  // Create a server-side draft — returns {id, draftToken}
  app.post("/api/merchant-applications/draft", publicLeadRateLimit, async (req, res) => {
    if (req.query.probe === "1") return res.json({ probe: true, endpoint: "/api/merchant-applications/draft" });
    try {
      const draftToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = hashToken(draftToken);
      const { legalBusinessName, businessEmail, ownerEmail, vertical } = req.body;
      const application = await storage.createMerchantApplication(
        {
          status: "in_progress",
          currentStep: 1,
          totalSteps: 6,
          legalBusinessName: legalBusinessName || null,
          businessEmail: businessEmail || null,
          ownerEmail: ownerEmail || null,
          vertical: vertical || null,
          draftTokenHash: tokenHash,
        },
        { actorType: "user", userId: null },
      );
      res.json({ id: application.id, draftToken });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // EIN-only duplicate check (public, rate-limited, generic boolean — no enumeration risk)
  app.post("/api/merchant-applications/check-duplicate", publicLeadRateLimit, async (req, res) => {
    try {
      const { ein } = req.body;
      if (!ein || typeof ein !== "string" || ein.replace(/\D/g, "").length < 9) {
        return res.json({ exists: false });
      }
      const [dup] = await db
        .select({ id: merchantApplications.id })
        .from(merchantApplications)
        .where(
          and(
            eq(merchantApplications.ein, ein.replace(/\D/g, "")),
            or(
              eq(merchantApplications.status, "submitted"),
              eq(merchantApplications.status, "under_review"),
              eq(merchantApplications.status, "approved"),
            ),
          ),
        )
        .limit(1);
      res.json({ exists: !!dup });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // Autosave non-sensitive draft fields (verified by draftToken)
  const AUTOSAVE_ALLOWED_FIELDS = new Set([
    "legalBusinessName", "dba", "businessType", "businessStartDate",
    "businessAddress", "businessCity", "businessState", "businessZip",
    "businessPhone", "businessEmail", "website", "vertical",
    "ownerFirstName", "ownerLastName", "ownerEmail", "ownerPhone",
    "ownerAddress", "ownerCity", "ownerState", "ownerZip", "ownershipPercent",
    "estimatedMonthlyVolume", "estimatedAvgTicket", "highestTicket",
    "currentProcessor", "currentRate", "acceptedCardTypes",
    "terminalNeeded", "terminalType", "terminalQuantity", "ecommerceNeeded",
    "preferredProgram", "currentStep",
  ]);

  app.patch("/api/merchant-applications/:id/autosave", async (req, res) => {
    try {
      const appId = Number(req.params.id);
      const draftToken = (req.headers["x-draft-token"] as string) || req.body._draftToken;
      if (!draftToken) return res.status(401).json({ message: "Draft token required" });

      const [existing] = await db
        .select({ id: merchantApplications.id, draftTokenHash: merchantApplications.draftTokenHash, status: merchantApplications.status })
        .from(merchantApplications)
        .where(eq(merchantApplications.id, appId))
        .limit(1);
      if (!existing) return res.status(404).json({ message: "Application not found" });
      if (!existing.draftTokenHash || hashToken(draftToken) !== existing.draftTokenHash) {
        return res.status(403).json({ message: "Invalid draft token" });
      }
      if (existing.status === "submitted" || existing.status === "under_review" || existing.status === "approved") {
        return res.status(409).json({ message: "Application already submitted" });
      }

      const safeUpdate: Record<string, any> = { status: "in_progress", updatedAt: new Date() };
      for (const [key, val] of Object.entries(req.body)) {
        if (AUTOSAVE_ALLOWED_FIELDS.has(key)) safeUpdate[key] = val;
      }

      await db.update(merchantApplications).set(safeUpdate).where(eq(merchantApplications.id, appId));
      res.json({ ok: true });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // Read draft non-sensitive fields — public, verified by draftToken header or ?token= param
  app.get("/api/merchant-applications/:id/autosave", publicLeadRateLimit, async (req, res) => {
    try {
      const appId = Number(req.params.id);
      const draftToken = (req.headers["x-draft-token"] as string) || (req.query.token as string);
      if (!draftToken) return res.status(401).json({ message: "Draft token required" });

      const [existing] = await db
        .select({ id: merchantApplications.id, draftTokenHash: merchantApplications.draftTokenHash, status: merchantApplications.status })
        .from(merchantApplications)
        .where(eq(merchantApplications.id, appId))
        .limit(1);
      if (!existing) return res.status(404).json({ message: "Not found" });
      if (!existing.draftTokenHash || hashToken(draftToken) !== existing.draftTokenHash) {
        return res.status(403).json({ message: "Invalid draft token" });
      }

      const application = await storage.getMerchantApplication(appId);
      if (!application) return res.status(404).json({ message: "Not found" });

      // Return only autosave-allowed fields (never SSN, EIN, bank account numbers)
      const safe: Record<string, any> = {};
      for (const field of AUTOSAVE_ALLOWED_FIELDS) {
        if (field in application) safe[field] = (application as any)[field];
      }
      res.json(safe);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // Finalize: full submission with EIN-only duplicate check
  app.patch("/api/merchant-applications/:id/finalize", publicLeadRateLimit, async (req, res) => {
    try {
      const appId = Number(req.params.id);
      const draftToken = (req.headers["x-draft-token"] as string) || req.body._draftToken;
      if (!draftToken) return res.status(401).json({ message: "Draft token required" });

      const [existing] = await db
        .select({ id: merchantApplications.id, draftTokenHash: merchantApplications.draftTokenHash, status: merchantApplications.status })
        .from(merchantApplications)
        .where(eq(merchantApplications.id, appId))
        .limit(1);
      if (!existing) return res.status(404).json({ message: "Application not found" });
      if (!existing.draftTokenHash || hashToken(draftToken) !== existing.draftTokenHash) {
        return res.status(403).json({ message: "Invalid draft token" });
      }
      if (existing.status === "submitted") {
        return res.status(409).json({ message: "Application already submitted" });
      }

      // EIN-only duplicate check (not email — avoids user enumeration; generic response only)
      const { ein } = req.body;
      if (ein) {
        const [dup] = await db
          .select({ id: merchantApplications.id, status: merchantApplications.status })
          .from(merchantApplications)
          .where(and(eq(merchantApplications.ein, ein), drizzleSql`${merchantApplications.id} != ${appId}`))
          .limit(1);
        if (dup && dup.status !== "draft" && dup.status !== "in_progress") {
          return res.status(409).json({ message: "An application for this business already exists. Please contact us if you need assistance." });
        }
      }

      // Strip all meta/token keys — never write unknown keys to the DB
      const { _draftToken: _dt, _shareToken, ...bodyRaw } = req.body;

      // Resolve dealId from shareToken (mirrors the POST handler logic)
      let resolvedDealId: number | undefined;
      if (_shareToken && typeof _shareToken === "string") {
        const [matchedDeal] = await db.select({ id: deals.id }).from(deals).where(eq(deals.shareToken, _shareToken)).limit(1);
        if (matchedDeal) resolvedDealId = matchedDeal.id;
      }

      // Whitelist only known merchantApplications column keys — prevents unknown-key DB errors
      const FINALIZE_ALLOWED_FIELDS = new Set([
        ...AUTOSAVE_ALLOWED_FIELDS,
        "ein", "ownerSsn", "bankRoutingNumber", "bankAccountNumber", "bankAccountType",
        "pewcConsent", "reviewConfirmed",
      ]);
      const updatePayload: Record<string, any> = {
        status: "submitted",
        submittedAt: new Date(),
        updatedAt: new Date(),
      };
      for (const [key, val] of Object.entries(bodyRaw)) {
        if (FINALIZE_ALLOWED_FIELDS.has(key)) updatePayload[key] = val;
      }
      if (resolvedDealId) updatePayload.dealId = resolvedDealId;

      await db.update(merchantApplications).set(updatePayload).where(eq(merchantApplications.id, appId));
      const updated = await storage.getMerchantApplication(appId);

      // Run GHL sync and workflows async (same as the existing POST handler)
      if (updated) {
        const pewcConsent = req.body.pewcConsent === true;
        // Capture request metadata now — req may not be accessible inside the IIFE after response is sent
        const reqIpAddress = req.ip || "unknown";
        const reqUserAgent = req.get("user-agent") || "unknown";

        // Resolve or create CRM contact — required for GHL sync call signature
        (async () => {
          try {
            const contactEmail = updated.ownerEmail || updated.businessEmail;
            let resolvedContactId: number | null = null;
            if (contactEmail) {
              // Use indexed email lookup — storage.getContacts({limit:1000}) misses contacts
              // in large DBs (>1000 rows) since it doesn't filter by email.
              const [existing] = await db
                .select({ id: contacts.id })
                .from(contacts)
                .where(eq(contacts.email, contactEmail.toLowerCase()))
                .limit(1);
              if (existing) {
                resolvedContactId = existing.id;
              } else {
                const created = await storage.createContact({
                  firstName: updated.ownerFirstName || "",
                  lastName: updated.ownerLastName || "",
                  email: contactEmail,
                  phone: updated.businessPhone || updated.ownerPhone || undefined,
                  companyName: updated.legalBusinessName || updated.dba || "",
                  status: "New",
                  tags: ["src_merchant_app"],
                }).catch(() => null);
                if (created) resolvedContactId = created.id;
              }
            }
            if (resolvedContactId) {
              // Record PEWC consent evidence with the resolved CRM contact ID
              if (pewcConsent) {
                await recordPewcDecision({
                  contactId: resolvedContactId,
                  checked: true,
                  source: "merchant_application_finalize",
                  ipAddress: reqIpAddress,
                  userAgent: reqUserAgent,
                  details: { applicationId: updated.id },
                }).catch(() => {});
              }
              await syncMerchantApplicationToGhl(updated.id, resolvedContactId).catch(err =>
                console.error("[Finalize] GHL sync error:", err)
              );
            }
            const resolvedGhlId = resolvedContactId
              ? (await storage.getContact(resolvedContactId).catch(() => null))?.ghlContactId ?? null
              : null;
            enrollInGhlWorkflow({
              workflowKey: "merchant_app",
              ghlContactId: resolvedGhlId,
              email: contactEmail || undefined,
              metadata: { applicationId: updated.id },
            }).catch(() => {});
          } catch (sideEffectErr) {
            console.error("[Finalize] Side-effect chain error:", sideEffectErr);
          }
        })();
      }

      res.json(updated || { id: appId, status: "submitted" });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // === PREFILL TOKENS (dashboard → share application form link) ===

  app.post("/api/merchant-applications/prefill-token", isDashboardUser, async (req, res) => {
    try {
      cleanExpiredPrefillTokens();
      const token = crypto.randomBytes(20).toString("hex");
      const {
        legalBusinessName, dba, businessType, businessPhone, businessEmail,
        businessAddress, businessCity, businessState, businessZip, website,
        ownerFirstName, ownerLastName, ownerEmail, ownerPhone,
        estimatedMonthlyVolume, vertical, currentProcessor, dealId, contactId,
      } = req.body;

      // Auto-populate from contact record if contactId provided
      let contact: Awaited<ReturnType<typeof storage.getContact>> | null = null;
      if (contactId) {
        contact = await storage.getContact(Number(contactId)).catch(() => null);
      }

      // Enforce contact↔deal linkage when both are provided
      if (dealId && contactId) {
        const deal = await storage.getDeal(Number(dealId)).catch(() => null);
        if (!deal || deal.contactId !== Number(contactId)) {
          return res.status(400).json({ message: "Deal is not linked to this contact — cannot generate prefill token" });
        }
      }

      prefillTokenMap.set(token, {
        legalBusinessName: legalBusinessName || contact?.companyName || undefined,
        dba: dba || undefined,
        businessType: businessType || undefined,
        businessPhone: businessPhone || contact?.phone || undefined,
        businessEmail: businessEmail || contact?.email || undefined,
        businessAddress: businessAddress || undefined,
        businessCity: businessCity || undefined,
        businessState: businessState || undefined,
        businessZip: businessZip || undefined,
        website: website || contact?.website || undefined,
        ownerFirstName: ownerFirstName || contact?.firstName || undefined,
        ownerLastName: ownerLastName || contact?.lastName || undefined,
        ownerEmail: ownerEmail || contact?.email || undefined,
        ownerPhone: ownerPhone || contact?.phone || undefined,
        estimatedMonthlyVolume: estimatedMonthlyVolume || undefined,
        vertical: vertical || undefined,
        currentProcessor: currentProcessor || undefined,
        dealId: dealId ? Number(dealId) : undefined,
        expiresAt: Date.now() + PREFILL_TOKEN_TTL_MS,
      });
      const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get("host")}`;
      res.json({ token, url: `${baseUrl}/merchant-application?prefillToken=${token}` });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/merchant-applications/prefill-token/:token", publicLeadRateLimit, (req, res) => {
    cleanExpiredPrefillTokens();
    const data = prefillTokenMap.get(req.params.token);
    if (!data || data.expiresAt < Date.now()) {
      return res.status(404).json({ message: "Token not found or expired" });
    }
    // Strict whitelist — never expose internal IDs, EIN, SSN, DOB, or bank data
    res.json({
      legalBusinessName: data.legalBusinessName,
      dba: data.dba,
      businessType: data.businessType,
      businessPhone: data.businessPhone,
      businessEmail: data.businessEmail,
      businessAddress: data.businessAddress,
      businessCity: data.businessCity,
      businessState: data.businessState,
      businessZip: data.businessZip,
      website: data.website,
      ownerFirstName: data.ownerFirstName,
      ownerLastName: data.ownerLastName,
      ownerEmail: data.ownerEmail,
      ownerPhone: data.ownerPhone,
      estimatedMonthlyVolume: data.estimatedMonthlyVolume,
      currentProcessor: data.currentProcessor,
      vertical: data.vertical,
    });
  });

  // === MERCHANT APPLICATIONS ===
  app.post("/api/merchant-applications", isAuthenticated, async (req, res) => {
    try {
      const { _shareToken, ...bodyWithoutToken } = req.body;
      const input = insertMerchantApplicationSchema.parse(bodyWithoutToken);

      let resolvedDealId: number | undefined;
      if (_shareToken && typeof _shareToken === "string" && !input.dealId) {
        const [matchedDeal] = await db.select({ id: deals.id }).from(deals).where(eq(deals.shareToken, _shareToken));
        if (matchedDeal) resolvedDealId = matchedDeal.id;
      }

      const emailToCheck = input.ownerEmail || input.businessEmail;
      const einToCheck = input.ein;
      if (emailToCheck || einToCheck) {
        const conditions = [];
        if (emailToCheck) {
          conditions.push(eq(merchantApplications.ownerEmail, emailToCheck));
          conditions.push(eq(merchantApplications.businessEmail, emailToCheck));
        }
        if (einToCheck) conditions.push(eq(merchantApplications.ein, einToCheck));
        const [existing] = await db
          .select({ id: merchantApplications.id, status: merchantApplications.status })
          .from(merchantApplications)
          .where(or(...conditions))
          .limit(1);
        if (existing) {
          return res.status(409).json({
            message: "An application for this business already exists.",
            existingApplicationId: existing.id,
            existingStatus: existing.status,
          });
        }
      }

      const application = await storage.createMerchantApplication(
        resolvedDealId ? { ...input, dealId: resolvedDealId } : input,
        { actorType: "user", userId: (req.user as any)?.id ?? null },
      );

      const pewcConsent = req.body.pewcConsent === true;

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
          if (pewcConsent) {
            recordPewcDecision({
              contactId: contact.id,
              checked: true,
              source: "merchant_application",
              ipAddress: req.ip || req.socket.remoteAddress || "unknown",
              userAgent: req.headers["user-agent"] || "unknown",
              details: {
                formType: "merchant_application",
                applicationId: application.id,
                channelsCovered: ["sms", "calls_and_prerecorded_artificial_voice"],
              },
            }).catch(err => console.error("[MerchantApp] PEWC record error:", err));
          }
          syncMerchantApplicationToGhl(application.id, contact.id).catch(err =>
            console.error("GHL merchant app sync error:", err)
          );
          if (contact.ghlContactId) {
            enrollInGhlWorkflow({ workflowKey: "merchant_app", ghlContactId: contact.ghlContactId, metadata: { applicationId: application.id } }).catch(err =>
              console.error("[MerchantApp] GHL workflow enrollment error:", err)
            );
          }
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
      serverError(res, err);
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
      serverError(res, err);
    }
  });

  app.get("/api/merchant-applications/user/:userId", isAuthenticated, async (req, res) => {
    try {
      const application = await storage.getMerchantApplicationByUser(req.params.userId);
      if (!application) return res.status(404).json({ message: "Not found" });
      res.json(application);
    } catch (err: any) {
      serverError(res, err);
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
      serverError(res, err);
    }
  });

  app.patch("/api/merchant-applications/:id", isAdminOrManager, async (req, res) => {
    try {
      const appId = Number(req.params.id);
      const existing = await storage.getMerchantApplication(appId);
      if (!existing) return res.status(404).json({ message: "Not found" });

      const merchantAppDateSchema = z.object({
        esignedAt: z.coerce.date().optional().nullable(),
        approvedAt: z.coerce.date().optional().nullable(),
        declinedAt: z.coerce.date().optional().nullable(),
        submittedAt: z.coerce.date().optional().nullable(),
        completedAt: z.coerce.date().optional().nullable(),
      }).passthrough();
      const updates = { ...merchantAppDateSchema.parse(req.body) } as Record<string, any>;
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
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join(".") });
      if (err instanceof DateValidationError) return res.status(400).json({ message: err.message, field: err.field });
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
        console.error("[Merchants] E-signature send failed:", result.error);
        return res.status(500).json({ message: safeMessage(result.error, "Failed to send document for e-signature") });
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
      serverError(res, err);
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
      serverError(res, err);
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
      serverError(res, err);
    }
  });

  app.post("/api/webhooks/ghl-document", webhookRateLimit, async (req, res) => {
    try {
      const webhookSecret = process.env.GHL_WEBHOOK_SECRET;
      if (!webhookSecret && process.env.NODE_ENV === "production") {
        console.error("[GHL Document Webhook] GHL_WEBHOOK_SECRET not configured — rejecting webhook in production");
        return res.status(503).json({ received: false, error: "Webhook signing not configured" });
      }
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
      serverError(res, err);
    }
  });

  app.post("/api/merchant-profiles", requireRole('admin', 'manager', 'agent'), async (req, res) => {
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
      serverError(res, err);
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
      serverError(res, err);
    }
  });

  app.get("/api/merchant-profiles", isAdminOrManager, async (req, res) => {
    try {
      const profiles = await storage.getMerchantProfiles();
      res.json(profiles);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/merchant-profiles/:id", isAdminOrManager, async (req, res) => {
    try {
      const profile = await storage.getMerchantProfile(Number(req.params.id));
      if (!profile) return res.status(404).json({ message: "Not found" });
      res.json(profile);
    } catch (err: any) {
      serverError(res, err);
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
      serverError(res, err);
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
      serverError(res, err);
    }
  });

  // === EQUIPMENT ORDERS ===
  app.get("/api/equipment-orders", isDashboardUser, async (req, res) => {
    try {
      const dealId = req.query.dealId ? Number(req.query.dealId) : undefined;
      const orders = dealId ? await storage.getEquipmentOrdersByDeal(dealId) : await storage.getEquipmentOrders();
      res.json(orders);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/equipment-orders/:id", isDashboardUser, async (req, res) => {
    try {
      const order = await storage.getEquipmentOrder(Number(req.params.id));
      if (!order) return res.status(404).json({ message: "Not found" });
      res.json(order);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/equipment-orders", isDashboardUser, async (req, res) => {
    try {
      const input = insertEquipmentOrderSchema.parse(req.body);

      const adminOverride = req.body.adminOverride === true;
      const userRole = (req.user as any)?.role as string | undefined;
      const isAdminOrManager = userRole === "admin" || userRole === "manager";

      let economicsFields: Record<string, unknown> = {};
      if (input.dealId) {
        const deal = await storage.getDeal(input.dealId);
        const terminalStatus = (deal as any)?.terminalApprovalStatus as string | undefined;

        if (terminalStatus === "pending_approval" || terminalStatus === "rejected") {
          if (!adminOverride || !isAdminOrManager) {
            return res.status(403).json({
              message: terminalStatus === "pending_approval"
                ? "Equipment order blocked: this deal has a terminal recommendation pending manager approval. Wait for approval, or an admin/manager can pass adminOverride=true."
                : "Equipment order blocked: the terminal recommendation on this deal was rejected. Update the terminal selection or a manager can override.",
              code: terminalStatus === "pending_approval" ? "terminal_approval_pending" : "terminal_approval_rejected",
              canOverride: isAdminOrManager,
            });
          }
          await storage.createAuditLog({
            action: "terminal_approval_order_override",
            entityType: "deal",
            entityId: input.dealId,
            userId: (req.user as any)?.id ?? null,
            details: {
              overriddenStatus: terminalStatus,
              overriddenBy: (req.user as any)?.email,
              role: userRole,
            },
          });
        }

        if (!req.body.libertyCost) {
          const vol = deal?.totalVolume ? Number(String(deal.totalVolume).replace(/[^0-9.]/g, "")) : null;
          const eco = computeOrderEconomics(input.equipmentType, vol);
          economicsFields = {
            libertyCost: String(eco.libertyCost),
            estimatedMonthlyGp: String(eco.estimatedMonthlyGp),
            ...(eco.paybackMonths != null ? { paybackMonths: String(eco.paybackMonths) } : {}),
            approvalTier: eco.approvalTier,
          };
        }


        if (deal?.terminalRecommendation && !(deal as any).terminalCostAtOrder) {
          const models = await storage.getEquipmentModels();
          const rec = deal.terminalRecommendation.toLowerCase();
          const model = models.find(m =>
            m.name.toLowerCase() === rec ||
            rec.includes(m.name.toLowerCase().split(" ")[0])
          );
          if (model) {
            await storage.updateDeal(input.dealId, { terminalCostAtOrder: model.libertyCost } as any);
          }
        }
      }

      const order = await storage.createEquipmentOrder({ ...input, ...economicsFields } as any);
      res.status(201).json(order);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/equipment-orders/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const equipmentDateSchema = z.object({
        orderedAt: z.coerce.date().optional().nullable(),
        shippedAt: z.coerce.date().optional().nullable(),
        deliveredAt: z.coerce.date().optional().nullable(),
        approvedAt: z.coerce.date().optional().nullable(),
      }).passthrough();
      const body = equipmentDateSchema.parse(req.body);
      const updated = await storage.updateEquipmentOrder(Number(req.params.id), body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join(".") });
      if (err instanceof DateValidationError) return res.status(400).json({ message: err.message, field: err.field });
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/equipment-orders/:id/approve", requireRole("admin", "manager"), async (req, res) => {
    try {
      const user = req.user as any;
      const updated = await storage.updateEquipmentOrder(Number(req.params.id), {
        managerApproved: true,
        approvedAt: new Date(),
        approvedByUserId: user?.id ?? null,
      } as any);
      if (!updated) return res.status(404).json({ message: "Order not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });


  // === ONBOARDING STEPS ===
  app.get("/api/onboarding-steps/deal/:dealId", isAuthenticated, async (req, res) => {
    try {
      const dealId = Number(req.params.dealId);
      const user = req.user as any;
      // Merchants may only read onboarding steps for their own deal.
      if (user.role === "merchant") {
        const profile = await storage.getMerchantProfileByUser(user.id);
        if (!profile || profile.dealId !== dealId) {
          return res.status(403).json({ message: "Forbidden" });
        }
      } else if (user.role !== "admin" && user.role !== "manager" && user.role !== "agent") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const steps = await storage.getOnboardingStepsByDeal(dealId);
      res.json(steps);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/onboarding-steps/application/:applicationId", isDashboardUser, async (req, res) => {
    try {
      const steps = await storage.getOnboardingStepsByApplication(Number(req.params.applicationId));
      res.json(steps);
    } catch (err: any) {
      serverError(res, err);
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
      const onboardingDateSchema = z.object({
        completedAt: z.coerce.date().optional().nullable(),
        dueDate: z.coerce.date().optional().nullable(),
      }).passthrough();
      const body = onboardingDateSchema.parse(req.body);
      const updated = await storage.updateOnboardingStep(Number(req.params.id), body, { userId: (req.user as any)?.id ?? null });
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join(".") });
      if (err instanceof DateValidationError) return res.status(400).json({ message: err.message, field: err.field });
      res.status(400).json({ message: err.message });
    }
  });

}
