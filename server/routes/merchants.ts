import type { Express, RequestHandler } from "express";
import { isAuthenticated, isDashboardUser, requireRole } from "../replit_integrations/auth";
import { storage } from "../storage";
import { z } from "zod";
import { DateValidationError } from "../utils/date-coerce";
import { and, eq, or } from "drizzle-orm";
import { insertEquipmentOrderSchema, insertMerchantProfileSchema, insertOnboardingStepSchema, deals, merchantApplications } from "@shared/schema";
import { db } from "../db";
import crypto from "crypto";
import { getDocumentStatus } from "../services/ghl";
import { computeOrderEconomics } from "../services/terminal-economics";
import { enrollInGhlWorkflow } from "../services/ghl-workflows";
import { sendMerchantPortalWelcomeEmail } from "../services/merchant-welcome";
import { parse } from "csv-parse/sync";
import path from "path";
import { publicLeadRateLimit, webhookRateLimit } from "../middleware/public-rate-limit";
import { serverError, safeMessage } from "../utils/server-error";
import { LifecycleService } from "../services/lifecycle-service";
import { observeCommercialReportingPopulation } from "../services/commercial-resolution";
import * as merchantAppService from "../services/merchant-application-service";
import {
  NotFoundError,
  ConflictError,
  ValidationError,
  ServiceUnavailableError,
  ForbiddenError,
} from "../services/merchant-application-service";
import { ProtectedDataValidationError } from "../services/merchant-protected-data";
import { startMerchantApplicationOutboxWorker, triggerOutboxTick } from "../services/merchant-application-outbox-worker";
import { getBackgroundProfile } from "../services/background-profile";

/**
 * Map service/domain errors to HTTP responses. Generic 404 for capability
 * failures (NotFoundError) to avoid existence leaks.
 */
function respondServiceError(res: any, err: unknown): void {
  if (err instanceof z.ZodError) {
    return void res.status(400).json({ message: "Invalid request", field: err.errors[0]?.path?.join(".") });
  }
  if (err instanceof ProtectedDataValidationError) {
    return void res.status(400).json({ message: err.message, field: err.field });
  }
  if (err instanceof ValidationError) {
    return void res.status(400).json({ message: err.message, field: err.field });
  }
  if (err instanceof NotFoundError) {
    return void res.status(404).json({ message: "Not found" });
  }
  if (err instanceof ForbiddenError) {
    return void res.status(403).json({ message: "Forbidden" });
  }
  if (err instanceof ConflictError) {
    return void res.status(409).json({ message: err.message });
  }
  if (err instanceof ServiceUnavailableError) {
    return void res.status(503).json({ message: "Service temporarily unavailable" });
  }
  serverError(res, err);
}

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
  app.use("/api/merchants", async (req, _res, next) => {
    if (req.user) await Promise.all([
      observeCommercialReportingPopulation({ subjectType: "contact", actor: req.user as any }),
      observeCommercialReportingPopulation({ subjectType: "deal", actor: req.user as any }),
    ]).catch((error) => console.error("[CRO02_MERCHANT_OBSERVATION_FAILED]", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    }));
    next();
  });
  // Start the durable outbox worker only when background workers are enabled.
  // Off mode = HTTP/API only, no background processing.
  if (getBackgroundProfile() !== "off") {
    startMerchantApplicationOutboxWorker();
  } else {
    console.log("[BackgroundProfile] off — MerchantApplicationOutboxWorker not started");
  }

  // === DRAFT PERSISTENCE (server-side, public endpoints) ===

  // Create a server-side draft — returns {id, draftToken}
  app.post("/api/merchant-applications/draft", publicLeadRateLimit, async (req, res) => {
    if (req.query.probe === "1") return res.json({ probe: true, endpoint: "/api/merchant-applications/draft" });
    try {
      const result = await merchantAppService.createDraft(req.body);
      res.json(result);
    } catch (err: any) {
      respondServiceError(res, err);
    }
  });

  // EIN duplicate check (public, rate-limited, fingerprint-only, fail-closed 503)
  app.post("/api/merchant-applications/check-duplicate", publicLeadRateLimit, async (req, res) => {
    try {
      const { ein } = req.body ?? {};
      if (!ein || typeof ein !== "string") {
        return res.json({ exists: false });
      }
      const exists = await merchantAppService.checkDuplicateEin(ein);
      res.json({ exists });
    } catch (err: any) {
      respondServiceError(res, err);
    }
  });

  // Autosave non-sensitive draft fields — header-only x-draft-token, strict DTO.
  app.patch("/api/merchant-applications/:id/autosave", publicLeadRateLimit, async (req, res) => {
    try {
      const appId = Number(req.params.id);
      const draftToken = (req.headers["x-draft-token"] as string) || "";
      if (!draftToken) return res.status(404).json({ message: "Not found" });
      await merchantAppService.autosaveDraft(appId, draftToken, req.body);
      res.json({ ok: true });
    } catch (err: any) {
      respondServiceError(res, err);
    }
  });

  // Read draft non-sensitive fields — public, header-only x-draft-token.
  app.get("/api/merchant-applications/:id/autosave", publicLeadRateLimit, async (req, res) => {
    try {
      const appId = Number(req.params.id);
      const draftToken = (req.headers["x-draft-token"] as string) || "";
      if (!draftToken) return res.status(404).json({ message: "Not found" });
      const safe = await merchantAppService.getDraftForToken(appId, draftToken);
      res.json(safe);
    } catch (err: any) {
      respondServiceError(res, err);
    }
  });

  // Finalize: full submission — header-only draft token, Idempotency-Key required.
  app.patch("/api/merchant-applications/:id/finalize", publicLeadRateLimit, async (req, res) => {
    try {
      const appId = Number(req.params.id);
      const draftToken = (req.headers["x-draft-token"] as string) || "";
      if (!draftToken) return res.status(404).json({ message: "Not found" });
      const idempotencyKey = (req.headers["idempotency-key"] as string) || "";
      if (!idempotencyKey) {
        return res.status(400).json({ message: "Idempotency-Key header required" });
      }

      // Resolve dealId from shareToken (non-sensitive) before delegating.
      const { _shareToken } = req.body ?? {};
      let resolvedDealId: number | undefined;
      if (_shareToken && typeof _shareToken === "string") {
        const [matchedDeal] = await db.select({ id: deals.id }).from(deals).where(eq(deals.shareToken, _shareToken)).limit(1);
        if (matchedDeal) resolvedDealId = matchedDeal.id;
      }

      const result = await merchantAppService.finalizeApplication({
        appId,
        draftToken,
        idempotencyKey,
        body: req.body,
        resolvedDealId,
      });
      // Schedule an immediate outbox tick so contact_link and consent_record rows
      // are processed promptly (otherwise the poller waits up to 15 s).
      triggerOutboxTick();
      // Return safe ack with a fresh e-sign capability plaintext (once).
      res.json({ ...result.ack, ...(result.esignCapability ? { esignCapability: result.esignCapability } : {}) });
    } catch (err: any) {
      respondServiceError(res, err);
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
    const data = prefillTokenMap.get(req.params.token as string);
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
  // POST is an operator-only endpoint (admin/manager) for creating applications
  // on behalf of a contact. Public applicants use /draft + /finalize instead.
  app.post("/api/merchant-applications", isAdminOrManager, async (req, res) => {
    try {
      // Resolve dealId from shareToken (non-sensitive) before delegating.
      const { _shareToken } = req.body ?? {};
      let resolvedDealId: number | undefined;
      if (_shareToken && typeof _shareToken === "string") {
        const [matchedDeal] = await db.select({ id: deals.id }).from(deals).where(eq(deals.shareToken, _shareToken));
        if (matchedDeal) resolvedDealId = matchedDeal.id;
      }

      // Canonical strict create: non-sensitive shell + encrypted protected update
      // in one transaction; all side effects go through the durable outbox.
      const { dto } = await merchantAppService.operatorCreate({
        body: req.body,
        userId: (req.user as any)?.id ?? null,
        resolvedDealId,
      });
      res.status(201).json(dto);
    } catch (err: any) {
      respondServiceError(res, err);
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
      const paginated = applications
        .slice(Number(offset), Number(offset) + Number(limit))
        .map((a) => merchantAppService.toOperatorDto(a as any));

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
      const currentUser = req.user as any;
      const targetUserId = req.params.userId as string;
      // Only allow users to fetch their own application, unless they are admin/manager
      const isPrivileged = currentUser?.role === "admin" || currentUser?.role === "manager";
      if (!isPrivileged && currentUser?.id !== targetUserId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const application = await storage.getMerchantApplicationByUser(targetUserId);
      if (!application) return res.status(404).json({ message: "Not found" });
      const isPrivilegedRole = currentUser?.role === "admin" || currentUser?.role === "manager";
      res.json(isPrivilegedRole ? merchantAppService.toOperatorDto(application as any) : merchantAppService.toUserDto(application as any));
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
      const role = (req.user as any)?.role;
      res.json(role === "admin" || role === "manager"
        ? merchantAppService.toOperatorDto(application as any)
        : merchantAppService.toUserDto(application as any));
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.patch("/api/merchant-applications/:id", isAdminOrManager, async (req, res) => {
    try {
      const appId = Number(req.params.id);
      // Canonical operator update: strict allowlist DTO, expected-state/version
      // transition, redacted audit, and status side effects via durable outbox.
      const dto = await merchantAppService.operatorUpdate({
        appId,
        body: req.body,
        user: (req.user as any) || {},
      });
      res.json(dto);
    } catch (err: any) {
      respondServiceError(res, err);
    }
  });

  // Authenticated e-sign send — owner/admin/manager only. Atomic queue via
  // outbox; the provider send happens worker-side. Returns generic status.
  app.post("/api/merchant-applications/:id/send-esign", isAuthenticated, async (req, res) => {
    try {
      const appId = Number(req.params.id);
      const application = await storage.getMerchantApplication(appId);
      if (!application) return res.status(404).json({ message: "Application not found" });
      if (!canAccessApplication(req, application)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const result = await merchantAppService.requestEsignSend({
        appId,
        actor: "authenticated",
        userId: (req.user as any)?.id ?? null,
      });
      res.json(result);
    } catch (err: any) {
      respondServiceError(res, err);
    }
  });

  // Public e-sign request — requires x-esign-capability header + applicationId.
  // NO email authorization. Constant-time verify; generic response.
  app.post("/api/merchant-applications/request-esign", publicLeadRateLimit, async (req, res) => {
    try {
      const { applicationId } = req.body ?? {};
      const capability = (req.headers["x-esign-capability"] as string) || "";
      if (!applicationId || !capability) {
        return res.status(404).json({ message: "Not found" });
      }
      const appId = Number(applicationId);
      const [row] = await db
        .select({
          id: merchantApplications.id,
          esignCapabilityHash: merchantApplications.esignCapabilityHash,
          esignCapabilityExpiresAt: merchantApplications.esignCapabilityExpiresAt,
          esignCapabilityRevokedAt: merchantApplications.esignCapabilityRevokedAt,
        })
        .from(merchantApplications)
        .where(eq(merchantApplications.id, appId))
        .limit(1);
      if (!row || !merchantAppService.verifyEsignCapability(capability, row as any)) {
        // Generic 404 — no existence leak.
        return res.status(404).json({ message: "Not found" });
      }
      const result = await merchantAppService.requestEsignSend({ appId, actor: "public" });
      res.json(result);
    } catch (err: any) {
      respondServiceError(res, err);
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

      // Poll external document status and reflect via canonical conditional updater.
      if (application.esignDocumentId) {
        const docStatus = await getDocumentStatus(application.esignDocumentId);
        if (docStatus.status === "completed" || docStatus.status === "signed") {
          await merchantAppService.applyEsignDocumentState({
            applicationId: appId,
            esignStatus: "signed",
            esignedAt: docStatus.signedAt ? new Date(docStatus.signedAt) : new Date(),
          });
          return res.json({ status: "signed" });
        }
      }

      res.json({ status: application.esignStatus || "pending" });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // GHL document webhook — signature validated constant-time; indexed lookup;
  // returns non-2xx on internal failure; replay-safe canonical local update.
  app.post("/api/webhooks/ghl-document", webhookRateLimit, async (req, res) => {
    try {
      const webhookSecret = process.env.GHL_WEBHOOK_SECRET;
      if (!webhookSecret && process.env.NODE_ENV === "production") {
        console.error("[GHL Document Webhook] GHL_WEBHOOK_SECRET not configured — rejecting webhook in production");
        return res.status(503).json({ received: false, error: "Webhook signing not configured" });
      }
      if (webhookSecret) {
        const signature = (req.headers["x-ghl-signature"] || req.headers["x-webhook-signature"]) as string | undefined;
        const provided = Buffer.from(String(signature ?? ""), "utf8");
        const expected = Buffer.from(webhookSecret, "utf8");
        const valid = provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
        if (!valid) {
          console.warn("[GHL Document Webhook] Invalid signature, rejecting");
          return res.status(401).json({ received: false });
        }
      }

      const { documentId, status } = req.body ?? {};

      if (documentId && (status === "completed" || status === "signed")) {
        // Indexed lookup by esignDocumentId — no full table scan.
        const [app] = await db
          .select({ id: merchantApplications.id })
          .from(merchantApplications)
          .where(eq(merchantApplications.esignDocumentId, documentId))
          .limit(1);
        if (app) {
          await merchantAppService.applyEsignDocumentState({
            documentId,
            esignStatus: "signed",
            esignedAt: new Date(),
          });
        }
      }

      res.json({ received: true });
    } catch (err: any) {
      // Non-2xx on internal failure so the provider retries (replay-safe).
      console.error("[GHL Document Webhook] Error:", err?.message);
      res.status(500).json({ received: false });
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

        // ── Lifecycle side-effect: merchant profile activated → ACTIVE_PROCESSING
        if (updated.contactId) {
          LifecycleService.transition(updated.contactId, "ACTIVE_PROCESSING", {
            trigger: "merchant_profile_activated",
            source: "merchants-route",
            metadata: { profileId: id },
          }).catch((err: Error) =>
            console.warn(`[Lifecycle] Side-effect transition failed for contact #${updated.contactId}:`, err.message),
          );
        }
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

      // #220 — record actor who triggered the resend so history shows who sent it
      const actor = (req as any).user;
      await storage.createAuditLog({
        action: "merchant_portal_welcome_sent",
        entityType: "merchant_profile",
        entityId: id,
        actorType: actor ? "user" : "system",
        actorId: actor?.id ?? null,
        details: {
          triggeredBy: actor?.email ?? "system",
          triggeredByRole: actor?.role ?? null,
          recipientEmail: null, // merchantProfiles does not carry email; contact email is on the contacts table
          merchantId: profile.id,
        },
      });

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

      // #226 — support load-older via ?offset= param
      const limit = Math.min(parseInt(String(req.query.limit ?? "20"), 10), 100);
      const offset = Math.max(parseInt(String(req.query.offset ?? "0"), 10), 0);
      const allLogs = await storage.getAuditLogsByEntity("merchant_profile", id, limit + offset);
      const welcomeLogs = allLogs
        .filter(l => l.action === "merchant_portal_welcome_sent")
        .slice(offset, offset + limit);
      res.json({ logs: welcomeLogs, total: welcomeLogs.length, offset, limit });
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

      // REV-05A: Raw MID must not be returned to the merchant portal.
      // hasMid lets the UI know a MID is assigned without exposing the value.
      const { maskMid: _maskMidOverview } = await import("../utils/mask-mid");
      res.json({
        hasData: allStats.length > 0,
        midMasked: _maskMidOverview(mid),
        hasMid: !!mid,
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
