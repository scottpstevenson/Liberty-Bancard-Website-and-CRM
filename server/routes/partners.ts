import type { Express } from "express";
import { isAuthenticated, isDashboardUser, requireRole, isAffiliate, isPartnerAuthenticated } from "../replit_integrations/auth";
import rateLimit from "express-rate-limit";
import { getEmailSignatureHtml } from "../services/email-signatures";
import { storage } from "../storage";
import { publicLeadRateLimit } from "../middleware/public-rate-limit";
import { authStorage } from "../replit_integrations/auth/storage";
import { db } from "../db";
import { partners, users, userSessions } from "@shared/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { DateValidationError } from "../utils/date-coerce";
import { insertPartnerSchema, insertReferralSchema } from "@shared/schema";
import type { InsertPartner } from "@shared/schema";
import bcrypt from "bcryptjs";
import { createPartnerAccount, partnerMayHoldCredential, PARTNER_EMAIL_IN_USE } from "../services/partner-account";
import { updatePartnerWithApproval, listPartnerDeliveries, resendPartnerDelivery } from "../services/partner-approval-delivery";
import { getApplicationForPartner } from "../services/partner-application";
import { isGhlConfigured, sendGhlPartnerTransactionalEmail } from "../services/ghl";
import { sendSmtpEmail, isSmtpConfigured } from "../services/smtp-email";
import { logOperationalDiagnostic, serverError } from "../utils/server-error";
import { privatePartnerResponse, toPartnerOperatorRecord } from "../utils/partner-response";
import { consumeAuthAction, issueAuthAction, setAuthActionDelivery } from "../services/auth-actions";
import { authorizeGhlRouteMutation, requireGhlRouteMutationAllowed } from "./ghl-mutation-pause";

const partnerForgotPasswordRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many password reset requests, please try again later." },
});

const partnerLoginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many login attempts, please try again later." },
});
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]!));
function authActionHeaders(res: any) {
  res.setHeader("Cache-Control", "no-store"); res.setHeader("Pragma", "no-cache"); res.setHeader("Referrer-Policy", "no-referrer");
}
async function consumePartnerPassword(token: string, purpose: "partner_password_reset" | "partner_invite", passwordHash: string) {
  return consumeAuthAction({
    token, purpose,
    mutate: async (subject, tx) => {
      if (subject.type !== "partner") return false;
      const [partner] = await tx.select().from(partners).where(eq(partners.id, Number(subject.id)));
      if (!partner) return false;
      // An invitation is only usable while the partner is still approved: a declined, suspended or deactivated partner
      // cannot complete one that was issued earlier.
      if (purpose === "partner_invite" && partner.status !== "active") return false;
      // Neither an invitation nor a reset may create the first credential for an application that is not accepted.
      if (!(await partnerMayHoldCredential(partner, tx))) return false;
      // Validate all ownership/role invariants before changing either
      // credential record; a false result rolls back the claimed action too.
      const normalizedEmail = partner.email?.toLowerCase();
      const [user] = normalizedEmail
        ? await tx.select().from(users).where(eq(users.email, normalizedEmail))
        : [undefined];
      if (user && user.role !== "partner") return false;
      await tx.update(partners).set({ passwordHash, passwordResetToken: null, passwordResetExpiresAt: null,
        inviteToken: null, inviteTokenExpiresAt: null, updatedAt: new Date() }).where(eq(partners.id, partner.id));
      if (!partner.email) return true;
      if (user) {
        await tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, user.id));
        await tx.update(userSessions).set({ isInvalidated: true, invalidatedAt: new Date() })
          .where(eq(userSessions.userId, user.id));
      } else {
        const names = (partner.contactName || "").split(" ");
        await tx.insert(users).values({ email: partner.email.toLowerCase(), firstName: names[0] || "Partner",
          lastName: names.slice(1).join(" "), passwordHash, role: "partner", authProvider: "local" });
      }
      return true;
    },
  });
}
async function createPartnerWithCredential(input: InsertPartner, inboundRequestId?: string) {
  return createPartnerAccount(input, { role: "partner", inboundRequestId });
}
async function registerPartnerLoginSession(req: any, userId: string): Promise<void> {
  const sessionId = req.sessionID;
  if (!sessionId) throw new Error("Missing authenticated session");
  await authStorage.invalidateOldestSessionsForUser(userId, 4);
  if (!await authStorage.getUserSession(sessionId)) {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket?.remoteAddress;
    await authStorage.createUserSession({ userId, sessionId, ip, userAgent: req.headers["user-agent"] });
  }
}
async function failPartnerLoginClosed(req: any, res: any): Promise<void> {
  await new Promise<void>(resolve => req.logout(() => resolve()));
  await new Promise<void>(resolve => {
    if (!req.session) return resolve();
    req.session.destroy(() => resolve());
  });
  res.clearCookie("connect.sid");
}

/**
 * `/api/partners/:id` is registered before several fixed sibling paths (`me`, `leaderboard`,
 * `referral-pipeline`, registered later or in other modules). A non-numeric segment must fall through
 * to those routes instead of reaching an integer lookup, and a numeric ID must be a safe integer.
 */
export function numericPartnerIdOnly(req: any, res: any, next: (arg?: any) => void) {
  const raw = String(req.params.id ?? "");
  if (!/^\d+$/.test(raw)) return next("route");
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647) {
    return res.status(400).json({ message: "Invalid partner id" });
  }
  next();
}

/** A recorded commission term is a whole number 1-100. Absent/null means "no terms"; anything else is invalid, never coerced. */
export function parseCommissionTerms(value: unknown): { ok: true; value: number | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 100) return { ok: false };
  return { ok: true, value };
}

export function registerPartnersRoutes(app: Express) {
  // === PARTNERS (admin) ===
  app.get("/api/partners", isDashboardUser, async (req, res) => {
    try {
      const partnersList = await storage.getPartners();
      privatePartnerResponse(res);
      res.json(partnersList.map(toPartnerOperatorRecord));
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/partners/:id", numericPartnerIdOnly, isDashboardUser, async (req, res) => {
    try {
      const partner = await storage.getPartner(Number(req.params.id));
      if (!partner) return res.status(404).json({ message: "Not found" });
      privatePartnerResponse(res);
      res.json(toPartnerOperatorRecord(partner));
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/partners", requireRole("admin"), async (req, res) => {
    try {
      const input = insertPartnerSchema.parse(req.body);
      // No default terms: the column default (10) is never applied to a partner an administrator creates. Terms are either
      // explicit (1-100) or absent, and an active partner must have them.
      const terms = parseCommissionTerms(req.body?.commissionPercent);
      if (!terms.ok) return res.status(400).json({ message: "Commission terms must be a whole number from 1 to 100.", field: "commissionPercent", code: "INVALID_COMMISSION_PERCENT" });
      input.commissionPercent = terms.value;
      if (input.status === "active" && terms.value === null) {
        return res.status(400).json({ message: "Record the commission terms from the written agreement before creating an active partner.", field: "commissionPercent", code: "TERMS_REQUIRED" });
      }
      const partner = await createPartnerWithCredential(input);
      privatePartnerResponse(res);
      res.status(201).json(toPartnerOperatorRecord(partner));
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join(".") });
      // Never echo a database error: its text can include the failed statement and its bound values.
      if (err?.message === PARTNER_EMAIL_IN_USE) return res.status(400).json({ message: PARTNER_EMAIL_IN_USE });
      if (err?.code === "23505" || err?.cause?.code === "23505") return res.status(409).json({ message: "A partner with these details already exists." });
      logOperationalDiagnostic("partner_create", err, "unexpected_failure", {});
      res.status(400).json({ message: "The partner could not be created." });
    }
  });

  app.patch("/api/partners/:id", numericPartnerIdOnly, requireRole("admin"), async (req, res) => {
    try {
      const { status, commissionPercent, notes } = req.body ?? {};
      const updates: Partial<InsertPartner> = {};
      if (status && ["active", "pending", "suspended", "inactive"].includes(status)) updates.status = status;
      if (commissionPercent !== undefined) {
        // Never coerce: "abc" or "" must not become 0% terms. Only a whole number 1-100 is a recorded term.
        const terms = parseCommissionTerms(commissionPercent);
        if (!terms.ok || terms.value === null) {
          return res.status(400).json({ message: "Commission terms must be a whole number from 1 to 100.", field: "commissionPercent", code: "INVALID_COMMISSION_PERCENT" });
        }
        updates.commissionPercent = terms.value;
      }
      if (notes !== undefined) updates.notes = String(notes).slice(0, 2000);

      const partnerId = Number(req.params.id);
      const existing = await storage.getPartner(partnerId);
      if (!existing) return res.status(404).json({ message: "Not found" });

      if (updates.status === "active" && existing.status !== "active") {
        // An application-backed partner is approved only through the application decision, which records the terms, the
        // schedule reference and the decision together. A direct status change would skip that review.
        const application = await getApplicationForPartner(partnerId);
        if (application && (application.reviewStatus === "pending_review" || application.reviewStatus === "needs_info")) {
          return res.status(409).json({ message: "Approve this partner from the application review.", code: "USE_APPLICATION_DECISION" });
        }
        // Approving a pending partner requires terms stated in this request; a stored default is not an agreement.
        if (existing.status === "pending" && updates.commissionPercent === undefined) {
          return res.status(400).json({ message: "Record the commission terms from the written agreement to approve this partner.", field: "commissionPercent", code: "TERMS_REQUIRED" });
        }
        const effectiveTerms = updates.commissionPercent ?? existing.commissionPercent;
        if (effectiveTerms === null || effectiveTerms === undefined) {
          return res.status(400).json({ message: "Record the commission terms from the written agreement to activate this partner.", field: "commissionPercent", code: "TERMS_REQUIRED" });
        }
      }

      // Status change and, on approval, the durable invite/welcome intent commit together; the delivery worker executes it.
      const applied = await updatePartnerWithApproval(partnerId, updates);
      if (!applied) return res.status(404).json({ message: "Not found" });
      const updated = applied.updated;

      if (updates.status === "active" && existing.status !== "active") {
        (async () => {
          try {
            const partnerEmail = updated.email?.trim().toLowerCase();
            if (!partnerEmail) {
              logOperationalDiagnostic("partner_approval_enrollment", new Error("missing partner email"), "no_email", { partnerId });
              return;
            }

            // Fail closed: a sequence follows an approval only when the partner's own application recorded the optional
            // marketing opt-in. Acceptance of an application is not marketing consent.
            const application = await getApplicationForPartner(partnerId);
            if (!application?.marketingOptIn) {
              await (storage as any).createAuditLog({
                action: "partner_approved_sequence_skip",
                entityType: "partner",
                entityId: partnerId,
                details: { reason: application ? "no_marketing_opt_in" : "no_application_marketing_evidence" },
                type: "info",
              });
              return;
            }

            const contact = await storage.getContactByEmail(partnerEmail);

            if (!contact) {
              await (storage as any).createAuditLog({
                action: "partner_approved_sequence_skip",
                entityType: "partner",
                entityId: partnerId,
                details: { reason: "no_contact_found" },
                type: "info",
              });
              return;
            }

            if (contact.email?.trim().toLowerCase() !== partnerEmail) {
              logOperationalDiagnostic("partner_approval_enrollment", new Error("partner contact mismatch"), "email_mismatch", { partnerId, contactId: contact.id });
              await (storage as any).createAuditLog({
                action: "partner_approved_sequence_skip",
                entityType: "partner",
                entityId: partnerId,
                details: { reason: "email_mismatch", contactId: contact.id },
                type: "warning",
              });
              return;
            }

            const { autoEnrollFromTrigger } = await import("../services/sequence-worker");
            const enrollResult = await autoEnrollFromTrigger("partner_approved", { contactId: contact.id });

            await (storage as any).createAuditLog({
              action: "partner_approved_sequence_enrolled",
              entityType: "partner",
              entityId: partnerId,
              details: { contactId: contact.id, sequencesEnrolled: enrollResult.count },
              type: "info",
            });
          } catch (e) {
            logOperationalDiagnostic("partner_approval_enrollment", e, "enrollment_failed", { partnerId });
          }
        })();
      }

      privatePartnerResponse(res);
      res.json(toPartnerOperatorRecord(updated));
    } catch (err: any) {
      serverError(res, err, "partner_update");
    }
  });

  // Durable invite/welcome work for a partner: state only (never a token), plus an explicit operator resend.
  app.get("/api/partners/:id/approval-deliveries", numericPartnerIdOnly, requireRole("admin"), async (req, res) => {
    try {
      privatePartnerResponse(res);
      res.json({ deliveries: await listPartnerDeliveries(Number(req.params.id)) });
    } catch (err: any) {
      serverError(res, err, "partner_deliveries");
    }
  });

  app.post("/api/partners/:id/approval-deliveries/:deliveryId/resend", numericPartnerIdOnly, requireRole("admin"), async (req, res) => {
    try {
      const actorId = String((req as any).user?.id ?? (req as any).user?.claims?.sub ?? "admin");
      const row = await resendPartnerDelivery(Number(req.params.id), String(req.params.deliveryId), actorId);
      if (!row) return res.status(409).json({ message: "Only a failed or unconfirmed delivery can be sent again." });
      privatePartnerResponse(res);
      res.json({ id: row.id, state: row.state });
    } catch (err: any) {
      serverError(res, err, "partner_delivery_resend");
    }
  });

  // The public application (POST /api/partner-apply) lives in routes/partner-program.ts: it is a reviewed request with no
  // password, login or commission terms.

  app.post("/api/partner/login", partnerLoginRateLimit, async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required." });
      }
      const partner = await storage.getPartnerByEmail(email.toLowerCase());
      if (!partner || !partner.passwordHash) {
        return res.status(401).json({ message: "Invalid email or password." });
      }
      const valid = await bcrypt.compare(password, partner.passwordHash);
      if (!valid) {
        return res.status(401).json({ message: "Invalid email or password." });
      }
      // Defense in depth: an application that is not accepted never opens a session, even if a credential somehow exists.
      if (!(await partnerMayHoldCredential(partner))) {
        return res.status(401).json({ message: "Invalid email or password." });
      }
      if (partner.partnerType === "affiliate") {
        return res.status(403).json({ message: "Please use the affiliate login." });
      }

      let user = await authStorage.getUserByEmail(email.toLowerCase());
      if (!user) {
        const nameParts = (partner.contactName || "").split(" ");
        user = await authStorage.upsertUser({
          email: email.toLowerCase(),
          firstName: nameParts[0] || "Partner",
          lastName: nameParts.slice(1).join(" ") || "",
          passwordHash: partner.passwordHash,
          role: "partner",
          authProvider: "local",
        });
      } else if (user.role !== "partner") {
        return res.status(403).json({ message: "This email belongs to an existing account. Please contact support." });
      }
      req.logIn(user, async (loginErr) => {
        if (loginErr) return res.status(500).json({ message: "Login failed." });
        try { await registerPartnerLoginSession(req, user!.id); }
        catch {
          await failPartnerLoginClosed(req, res);
          return res.status(500).json({ message: "Login failed." });
        }
        return res.json({
          affiliateCode: partner.affiliateCode,
          name: partner.contactName,
          email: partner.email,
          status: partner.status,
          partnerType: partner.partnerType,
        });
      });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/partner/session", isPartnerAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      const partner = await storage.getPartnerByEmail(user.email);
      if (!partner) return res.status(404).json({ message: "Partner account not found." });
      return res.json({
        affiliateCode: partner.affiliateCode,
        name: partner.contactName,
        email: partner.email,
        status: partner.status,
        partnerType: partner.partnerType,
      });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // === PASSWORD RESET (legacy routes kept for backward compat, now rate-limited) ===
  app.post("/api/partner/reset-password-request", partnerForgotPasswordRateLimit, async (req, res) => {
    let issuedActionId: string | undefined;
    try {
      const { email } = req.body;
      if (!email || typeof email !== "string") {
        return res.status(400).json({ message: "Email is required." });
      }
      const partner = await storage.getPartnerByEmail(email.toLowerCase());
      // The answer is identical for an unknown address and for a partner who may not hold a credential (an application
      // that is not accepted): no token is issued and nothing reveals which case applied.
      if (partner && await partnerMayHoldCredential(partner)) {
         const resetAction = await issueAuthAction({
           purpose: "partner_password_reset", subject: { type: "partner", id: partner.id }, ttlMs: 60 * 60 * 1000,
         });
         issuedActionId = resetAction.id;

        const replitDomain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
        const baseUrl = process.env.APP_URL ||
          (replitDomain ? `https://${replitDomain}` : "https://libertybancard.com");
         const resetUrl = `${baseUrl}/partner-portal#action=reset&token=${encodeURIComponent(resetAction.token)}`;

        if (partner.email) {
          const displayName = partner.contactName || "there";
          const safeResetUrl = escapeHtml(resetUrl);
          const subject = "Reset your Liberty Bancard partner password";
          const html = `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;max-width:600px;">
   <p>Hi ${escapeHtml(displayName)},</p>
  <p>We received a request to reset the password for your Liberty Bancard partner account.</p>
  <p><a href="${safeResetUrl}" style="display:inline-block;background-color:#1e3a5f;color:#ffffff;padding:10px 20px;border-radius:4px;text-decoration:none;font-size:13px;font-weight:bold;">Reset Your Password</a></p>
  <p>Or copy and paste this link into your browser:<br/><span style="font-family:monospace;font-size:12px;color:#555;">${safeResetUrl}</span></p>
  <p>This link will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email.</p>
${getEmailSignatureHtml("partners")}
</div>`;
          if (isGhlConfigured()) {
            sendGhlPartnerTransactionalEmail({ email: partner.email, subject, body: html, fromEmail: "partners@libertybancard.com", fromName: "Liberty Bancard Partner Program" })
              .then(result => setAuthActionDelivery(resetAction.id, result.success ? "sent" : "definite_failure"))
              .catch(() => setAuthActionDelivery(resetAction.id, "ambiguous"));
          } else if (isSmtpConfigured()) {
            sendSmtpEmail({ to: partner.email, subject, html, category: "partners" })
              .then(result => setAuthActionDelivery(resetAction.id, result.success ? "sent" : "definite_failure"))
              .catch(() => setAuthActionDelivery(resetAction.id, "ambiguous"));
          } else {
             logOperationalDiagnostic("partner_password_reset_delivery", new Error("transport unavailable"), "transport_unavailable", { partnerId: partner.id });
             await setAuthActionDelivery(resetAction.id, "definite_failure");
          }
        } else {
          await setAuthActionDelivery(resetAction.id, "definite_failure");
        }
      }
      return res.json({ message: "If an account with that email exists, a reset link has been sent." });
    } catch (err: any) {
      if (issuedActionId) await setAuthActionDelivery(issuedActionId, "ambiguous").catch(() => {});
      logOperationalDiagnostic("partner_password_reset", err, "reset_request_failed");
      return res.status(500).json({ message: "Something went wrong" });
    }
  });

  app.post("/api/partner/reset-password", publicLeadRateLimit, async (req, res) => {
    authActionHeaders(res);
    try {
      const { token, password } = req.body;
      if (!token || !password || typeof token !== "string" || typeof password !== "string") {
        return res.status(400).json({ message: "Token and password are required." });
      }
      if (password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters." });
      }
      const passwordHash = await bcrypt.hash(password, 12);
      const consumed = await consumePartnerPassword(token, "partner_password_reset", passwordHash);
      return res.status(consumed.ok && consumed.value ? 200 : 400)
        .json({ message: consumed.ok && consumed.value ? "Your password has been reset. You can now log in." : "This link is invalid or expired." });
    } catch (err: any) {
      logOperationalDiagnostic("partner_password_reset", err, "password_reset_failed");
      return res.status(500).json({ message: "Something went wrong" });
    }
  });

  // === /api/partners/* CANONICAL AUTH ROUTES ===

  app.post("/api/partners/login", partnerLoginRateLimit, async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required." });
      }
      const partner = await storage.getPartnerByEmail(email.toLowerCase());
      if (!partner || !partner.passwordHash) {
        return res.status(401).json({ message: "Invalid email or password." });
      }
      const valid = await bcrypt.compare(password, partner.passwordHash);
      if (!valid) {
        return res.status(401).json({ message: "Invalid email or password." });
      }
      // Defense in depth: an application that is not accepted never opens a session, even if a credential somehow exists.
      if (!(await partnerMayHoldCredential(partner))) {
        return res.status(401).json({ message: "Invalid email or password." });
      }

      let user = await authStorage.getUserByEmail(email.toLowerCase());
      if (!user) {
        const nameParts = (partner.contactName || "").split(" ");
        user = await authStorage.upsertUser({
          email: email.toLowerCase(),
          firstName: nameParts[0] || "Partner",
          lastName: nameParts.slice(1).join(" ") || "",
          passwordHash: partner.passwordHash,
          role: "partner",
          authProvider: "local",
        });
      } else if (user.role !== "partner") {
        return res.status(403).json({ message: "This email belongs to an existing account. Please contact support." });
      }
      req.logIn(user, async (loginErr) => {
        if (loginErr) return res.status(500).json({ message: "Login failed." });
        try { await registerPartnerLoginSession(req, user!.id); }
        catch {
          await failPartnerLoginClosed(req, res);
          return res.status(500).json({ message: "Login failed." });
        }
        return res.json({
          affiliateCode: partner.affiliateCode,
          name: partner.contactName,
          email: partner.email,
          status: partner.status,
          partnerType: partner.partnerType,
        });
      });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/partners/me", isPartnerAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      const partner = await storage.getPartnerByEmail(user.email);
      if (!partner) return res.status(404).json({ message: "Partner account not found." });
      return res.json({
        id: partner.id,
        affiliateCode: partner.affiliateCode,
        name: partner.contactName,
        email: partner.email,
        status: partner.status,
        partnerType: partner.partnerType,
        commissionPercent: partner.commissionPercent,
        companyName: partner.companyName,
      });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/partners/forgot-password", partnerForgotPasswordRateLimit, async (req, res) => {
    let issuedActionId: string | undefined;
    try {
      const { email } = req.body;
      if (!email || typeof email !== "string") {
        return res.status(400).json({ message: "Email is required." });
      }
      const partner = await storage.getPartnerByEmail(email.toLowerCase());
      // The answer is identical for an unknown address and for a partner who may not hold a credential (an application
      // that is not accepted): no token is issued and nothing reveals which case applied.
      if (partner && await partnerMayHoldCredential(partner)) {
         const resetAction = await issueAuthAction({
           purpose: "partner_password_reset", subject: { type: "partner", id: partner.id }, ttlMs: 60 * 60 * 1000,
         });
         issuedActionId = resetAction.id;

        const replitDomain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
        const baseUrl = process.env.APP_URL ||
          (replitDomain ? `https://${replitDomain}` : "https://libertybancard.com");
         const resetUrl = `${baseUrl}/partner-login#action=reset&token=${encodeURIComponent(resetAction.token)}`;

        if (partner.email) {
          const displayName = partner.contactName || "there";
          const safeResetUrl = escapeHtml(resetUrl);
          const subject = "Reset your Liberty Bancard partner password";
          const html = `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;max-width:600px;">
   <p>Hi ${escapeHtml(displayName)},</p>
  <p>We received a request to reset the password for your Liberty Bancard partner account.</p>
  <p><a href="${safeResetUrl}" style="display:inline-block;background-color:#1e3a5f;color:#ffffff;padding:10px 20px;border-radius:4px;text-decoration:none;font-size:13px;font-weight:bold;">Reset Your Password</a></p>
  <p>Or copy and paste this link into your browser:<br/><span style="font-family:monospace;font-size:12px;color:#555;">${safeResetUrl}</span></p>
  <p>This link will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email.</p>
${getEmailSignatureHtml("partners")}
</div>`;
          if (isGhlConfigured()) {
            sendGhlPartnerTransactionalEmail({ email: partner.email, subject, body: html, fromEmail: "partners@libertybancard.com", fromName: "Liberty Bancard Partner Program" })
              .then(result => setAuthActionDelivery(resetAction.id, result.success ? "sent" : "definite_failure"))
              .catch(() => setAuthActionDelivery(resetAction.id, "ambiguous"));
          } else if (isSmtpConfigured()) {
            sendSmtpEmail({ to: partner.email, subject, html, category: "partners" })
              .then(result => setAuthActionDelivery(resetAction.id, result.success ? "sent" : "definite_failure"))
              .catch(() => setAuthActionDelivery(resetAction.id, "ambiguous"));
          } else {
             logOperationalDiagnostic("partner_password_reset_delivery", new Error("transport unavailable"), "transport_unavailable", { partnerId: partner.id });
             await setAuthActionDelivery(resetAction.id, "definite_failure");
          }
        }
      }
      return res.json({ message: "If an account with that email exists, a reset link has been sent." });
    } catch (err: any) {
      if (issuedActionId) await setAuthActionDelivery(issuedActionId, "ambiguous").catch(() => {});
      logOperationalDiagnostic("partner_password_reset", err, "reset_request_failed");
      return res.status(500).json({ message: "Something went wrong" });
    }
  });

  app.post("/api/partners/reset-password", publicLeadRateLimit, async (req, res) => {
    authActionHeaders(res);
    try {
      const { token, password } = req.body;
      if (!token || !password || typeof token !== "string" || typeof password !== "string") {
        return res.status(400).json({ message: "Token and password are required." });
      }
      if (password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters." });
      }
      const passwordHash = await bcrypt.hash(password, 12);
      const consumed = await consumePartnerPassword(token, "partner_password_reset", passwordHash);
      return res.status(consumed.ok && consumed.value ? 200 : 400)
        .json({ message: consumed.ok && consumed.value ? "Your password has been reset. You can now log in." : "This link is invalid or expired." });
    } catch (err: any) {
      logOperationalDiagnostic("partner_password_reset", err, "password_reset_failed");
      return res.status(500).json({ message: "Something went wrong" });
    }
  });

  app.post("/api/partners/set-password", publicLeadRateLimit, async (req, res) => {
    authActionHeaders(res);
    try {
      const { token, password } = req.body;
      if (!token || !password || typeof token !== "string" || typeof password !== "string") {
        return res.status(400).json({ message: "Token and password are required." });
      }
      if (password.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters." });
      }
      const passwordHash = await bcrypt.hash(password, 12);
      const consumed = await consumePartnerPassword(token, "partner_invite", passwordHash);
      return res.status(consumed.ok && consumed.value ? 200 : 400)
        .json({ message: consumed.ok && consumed.value ? "Password set successfully. You can now log in to your partner portal." : "This link is invalid or expired." });
    } catch (err: any) {
      logOperationalDiagnostic("partner_invite_activation", err, "password_set_failed");
      return res.status(500).json({ message: "Something went wrong" });
    }
  });

  app.post("/api/partners/logout", (req, res) => {
    req.logout(() => {
      req.session.destroy(() => {
        res.clearCookie("connect.sid");
        res.json({ message: "Logged out" });
      });
    });
  });

  app.post("/api/partner/logout", (req, res) => {
    req.logout(() => {
      req.session.destroy(() => {
        res.clearCookie("connect.sid");
        res.json({ message: "Logged out" });
      });
    });
  });

  // === PARTNER EMBED CODE ===
  app.get("/api/partner/embed-code", isPartnerAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      const partner = await storage.getPartnerByEmail(user.email);
      if (!partner) return res.status(404).json({ message: "Partner not found." });

      const replitDomain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
      const baseUrl = process.env.APP_URL ||
        (replitDomain ? `https://${replitDomain}` : "https://libertybancard.com");

      const refCode = partner.affiliateCode || "";
      const applicationUrl = `${baseUrl}/merchant-application?ref=${refCode}`;
      const analysisUrl = `${baseUrl}/free-analysis?ref=${refCode}`;

      const embedSnippet = `<!-- Liberty Bancard Partner Widget -->
<a href="${applicationUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:#1e3a5f;color:#fff;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none;">
  Apply for Payment Processing &rarr;
</a>`;

      res.json({
        refCode,
        applicationUrl,
        analysisUrl,
        embedSnippet,
      });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // === REFERRAL CLICK TRACKING ===
  app.get("/api/partner/track/:code", publicLeadRateLimit, async (req, res) => {
    try {
      const code = req.params.code as string;
      if (!code || code.length > 50) return res.status(400).json({ message: "Invalid code." });
      await storage.incrementPartnerClicks(code);
      res.json({ ok: true });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // === PARTNER DASHBOARD DATA ===
  app.get("/api/partner/dashboard/:code", isPartnerAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;

      const partner = await storage.getPartnerByCode(req.params.code as string);
      if (!partner) return res.status(404).json({ message: "Partner not found." });

      if (partner.email !== user.email) {
        return res.status(403).json({ message: "Access denied." });
      }

      const referralsList = await storage.getReferralsByPartner(partner.id);
      const now = new Date();
      const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const convertedReferrals = referralsList.filter(r => r.status === "converted" || r.status === "paid");
      const paidReferrals = referralsList.filter(r => r.status === "paid");
      const mtdReferrals = referralsList.filter(r => r.createdAt && new Date(r.createdAt) >= mtdStart);
      const mtdConverted = mtdReferrals.filter(r => r.status === "converted" || r.status === "paid");

      const totalCommissionLifetime = paidReferrals.reduce((sum, r) => sum + parseFloat(r.incentiveAmount || "0"), 0);
      const commissionMTD = mtdConverted.reduce((sum, r) => sum + parseFloat(r.incentiveAmount || "0"), 0);

      const nextPaymentDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);

      const merchantList = referralsList.slice(0, 50).map(r => ({
        id: r.id,
        name: r.referredCompany || r.referredName || "Unknown Merchant",
        status: r.status,
        commissionEarned: parseFloat(r.incentiveAmount || "0"),
        monthlyVolume: null as number | null,
        createdAt: r.createdAt,
      }));

      const replitDomain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
      const baseUrl = process.env.APP_URL ||
        (replitDomain ? `https://${replitDomain}` : "https://libertybancard.com");
      const referralLink = `${baseUrl}/get-started?ref=${partner.affiliateCode}`;

      const tiers = await storage.getCommissionTiers().catch(() => []);
      const conversionCount = convertedReferrals.length;
      const totalReferralCount = referralsList.length;
      const activeTier = tiers
        .filter(t => conversionCount >= (t.minReferrals ?? 0))
        .sort((a, b) => (b.minReferrals ?? 0) - (a.minReferrals ?? 0))[0] ?? null;
      const nextTier = tiers
        .filter(t => conversionCount < (t.minReferrals ?? 0))
        .sort((a, b) => (a.minReferrals ?? 0) - (b.minReferrals ?? 0))[0] ?? null;

      res.json({
        partner: {
          name: partner.contactName,
          code: partner.affiliateCode,
          email: partner.email,
          status: partner.status,
          partnerType: partner.partnerType,
          commissionPercent: partner.commissionPercent,
          totalPayouts: partner.totalPayouts ?? null,
        },
        kpis: {
          totalMerchants: conversionCount,
          totalReferrals: totalReferralCount,
          commissionMTD,
          totalCommissionLifetime,
          nextPaymentDate: nextPaymentDate.toISOString(),
          pendingReferrals: referralsList.filter(r => r.status === "pending" || r.status === "contacted").length,
          totalClicks: partner.totalClicks ?? 0,
          conversionRate: totalReferralCount > 0 ? Math.round((conversionCount / totalReferralCount) * 100) : 0,
        },
        tier: activeTier ? { name: (activeTier as any).name, commissionPercent: (activeTier as any).commissionPercent } : null,
        nextTier: nextTier ? { name: (nextTier as any).name, minReferrals: nextTier.minReferrals, commissionPercent: (nextTier as any).commissionPercent } : null,
        merchants: merchantList,
        referralLink,
      });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // === REFERRALS ===
  app.get("/api/referrals", isDashboardUser, async (req, res) => {
    try {
      const partnerId = req.query.partnerId ? Number(req.query.partnerId) : undefined;
      const referralsList = partnerId ? await storage.getReferralsByPartner(partnerId) : await storage.getReferrals();
      res.json(referralsList);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/referrals", isDashboardUser, async (req, res) => {
    try {
      const input = insertReferralSchema.parse(req.body);
      if (input.referredEmail && isGhlConfigured() && !(await requireGhlRouteMutationAllowed(res))) return;
      const referral = await storage.createReferral(input);
      res.status(201).json(referral);

      // ── Auto-enroll referred prospect in GHL partner-referral workflow ─────
      if (referral.referredEmail) {
        autoEnrollPartnerReferral(referral).catch(err =>
          logOperationalDiagnostic("partner_referral_enrollment", err, "referral_auto_enroll_failed", { referralId: referral.id })
        );
      }
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join(".") });
      serverError(res, err, "referral_create");
    }
  });

  app.patch("/api/referrals/:id", isDashboardUser, async (req, res) => {
    try {
      const referralDateSchema = z.object({
        paidAt: z.coerce.date().optional().nullable(),
        convertedAt: z.coerce.date().optional().nullable(),
      }).passthrough();
      const body = referralDateSchema.parse(req.body);
      const updated = await storage.updateReferral(Number(req.params.id), body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join(".") });
      if (err instanceof DateValidationError) return res.status(400).json({ message: err.message, field: err.field });
      serverError(res, err, "referral_update");
    }
  });

  // === COMMISSION TIERS ===
  app.get("/api/commission-tiers", isDashboardUser, async (_req, res) => {
    try {
      const tiers = await storage.getCommissionTiers();
      res.json(tiers);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/commission-tiers", requireRole("admin"), async (req, res) => {
    try {
      const tier = await storage.createCommissionTier(req.body);
      res.status(201).json(tier);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/commission-tiers/:id", requireRole("admin"), async (req, res) => {
    try {
      await storage.deleteCommissionTier(Number(req.params.id), { actorType: "user", userId: (req.user as any)?.id ?? null });
      res.json({ message: "Deleted" });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // === AFFILIATE LEADERBOARD ===
  app.get("/api/partners/leaderboard", isDashboardUser, async (req, res) => {
    try {
      const period = (req.query.period as string) === "monthly" ? "monthly" : "alltime";

      const now = new Date();
      const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthEnd = thisMonthStart;

      const allPartners = await storage.getPartners();
      const allReferrals = await storage.getReferrals();

      const CONVERTED_STATUSES = ["converted", "qualified", "paid", "closed"];

      // For monthly views, filter by convertedAt (when the referral was converted).
      // Fall back to updatedAt for legacy rows that predate the convertedAt column.
      const conversionDate = (r: (typeof allReferrals)[0]): Date | null => {
        if (r.convertedAt) return new Date(r.convertedAt);
        if (CONVERTED_STATUSES.includes(r.status ?? "") && r.updatedAt) return new Date(r.updatedAt);
        return null;
      };

      // Date-range helpers (operate on the resolved conversion date)
      const isThisMonth = (d: Date | null) => d != null && d >= thisMonthStart && d < nextMonthStart;
      const isLastMonth = (d: Date | null) => d != null && d >= lastMonthStart && d < lastMonthEnd;

      const partnerMap = new Map(allPartners.map((p) => [p.id, p]));

      // Aggregate per partner using referral counts (all) and conversion date (for monthly windows).
      // For alltime: count every referral regardless of date.
      // For monthly windows: only count referrals whose conversion date falls in the window.
      const aggregate = (
        includeReferral: (r: (typeof allReferrals)[0]) => boolean
      ) => {
        const counts = new Map<number, { referrals: number; conversions: number; earnings: number }>();
        for (const r of allReferrals) {
          if (!r.partnerId) continue;
          if (!includeReferral(r)) continue;
          const cur = counts.get(r.partnerId) ?? { referrals: 0, conversions: 0, earnings: 0 };
          cur.referrals += 1;
          if (CONVERTED_STATUSES.includes(r.status ?? "")) cur.conversions += 1;
          cur.earnings += parseFloat(r.commissionAmount || "0");
          counts.set(r.partnerId, cur);
        }
        return counts;
      };

      // For alltime: include every referral.
      // For monthly: include only referrals converted this month (by convertedAt or updatedAt fallback).
      const primaryFilter =
        period === "monthly"
          ? (r: (typeof allReferrals)[0]) => isThisMonth(conversionDate(r))
          : (_r: (typeof allReferrals)[0]) => true;

      const lastMonthFilter = (r: (typeof allReferrals)[0]) => isLastMonth(conversionDate(r));

      const primary = aggregate(primaryFilter);
      const lastMonth = aggregate(lastMonthFilter);

      const toEntry = (counts: Map<number, { referrals: number; conversions: number; earnings: number }>) => {
        return Array.from(counts.entries())
          .filter(([, c]) => c.referrals > 0)
          // Primary sort: referral count this period; secondary: conversions
          .sort((a, b) => b[1].referrals - a[1].referrals || b[1].conversions - a[1].conversions)
          .slice(0, 10)
          .map(([partnerId, c], i) => {
            const p = partnerMap.get(partnerId);
            const name = p?.contactName || p?.companyName || "Anonymous";
            const parts = name.trim().split(/\s+/);
            const displayName = parts.length >= 2
              ? `${parts[0]} ${parts[parts.length - 1][0]}.`
              : parts[0] || "Anonymous";
            // Badge tier based on all-time referral count
            const allTimeReferrals = p?.totalReferrals ?? 0;
            const badge =
              allTimeReferrals >= 25 ? "Platinum" :
              allTimeReferrals >= 10 ? "Gold" :
              allTimeReferrals >= 5  ? "Silver" : "Bronze";
            return {
              rank: i + 1,
              displayName,
              referrals: c.referrals,
              conversions: c.conversions,
              earnings: Math.round(c.earnings * 100) / 100,
              badge,
              partnerId,
            };
          });
      };

      // Determine the current user's partner ID (if any) — by email match
      const reqUser = req.user as any;
      let currentPartnerId: number | null = null;
      if (reqUser?.email) {
        const match = allPartners.find(
          (p) => p.email?.toLowerCase() === reqUser.email.toLowerCase()
        );
        if (match) currentPartnerId = match.id;
      }

      res.json({
        period,
        leaderboard: toEntry(primary),
        lastMonth: toEntry(lastMonth),
        month: thisMonthStart.toISOString(),
        lastMonthDate: lastMonthStart.toISOString(),
        currentPartnerId,
      });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ── Partner pipeline view (partner-authenticated) ──────────────────────────
  // Returns the partner's referrals enriched with pipeline stage so the
  // partner portal can show pending → boarded → earning lifecycle.
  app.get("/api/partner/pipeline", isPartnerAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      const partner = await storage.getPartnerByEmail(user.email);
      if (!partner) return res.status(404).json({ message: "Partner not found." });

      const referralsList = await storage.getReferralsByPartner(partner.id);

      // Enrich with pipeline stage label
      const pipeline = referralsList.map(r => {
        let pipelineStage: "pending" | "contacted" | "boarded" | "earning";
        if (r.status === "paid") pipelineStage = "earning";
        else if (r.status === "converted") pipelineStage = "boarded";
        else if (r.status === "contacted") pipelineStage = "contacted";
        else pipelineStage = "pending";

        return {
          id: r.id,
          merchantName: r.referredCompany || r.referredName || "—",
          merchantEmail: r.referredEmail || null,
          status: r.status,
          pipelineStage,
          commissionEarned: parseFloat(r.commissionAmount || r.incentiveAmount || "0"),
          convertedAt: r.convertedAt,
          paidAt: r.paidAt,
          createdAt: r.createdAt,
          dealId: r.dealId,
        };
      });

      res.json(pipeline);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ── Partner earnings view (partner-authenticated) ──────────────────────────
  // Returns residual data for the partner's live merchants grouped by month.
  app.get("/api/partner/earnings", isPartnerAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      const partner = await storage.getPartnerByEmail(user.email);
      if (!partner) return res.status(404).json({ message: "Partner not found." });

      const referralsList = await storage.getReferralsByPartner(partner.id);
      const dealIds = referralsList
        .map(r => r.dealId)
        .filter((id): id is number => id !== null && id !== undefined);

      if (dealIds.length === 0) {
        return res.json({ months: [], totalLifetime: 0 });
      }

      // Fetch all residuals for this partner's deals (last 12 months)
      const { db: earnDb } = await import("../db");
      const { merchantResiduals, deals: dealsTable } = await import("@shared/schema");
      const { inArray, desc } = await import("drizzle-orm");

      const residuals = await earnDb
        .select()
        .from(merchantResiduals)
        .where(inArray(merchantResiduals.dealId, dealIds))
        .orderBy(desc(merchantResiduals.month))
        .limit(200);

      // Group by month
      const byMonth: Record<string, {
        month: string;
        merchants: Array<{ name: string; volume: string; commission: string }>;
        totalCommission: number;
      }> = {};

      for (const r of residuals) {
        if (!byMonth[r.month]) {
          byMonth[r.month] = { month: r.month, merchants: [], totalCommission: 0 };
        }
        const commission = parseFloat(r.partnerCommission || "0");
        byMonth[r.month].merchants.push({
          name: r.merchantName || r.merchantMid || "—",
          volume: r.volume || "0",
          commission: r.partnerCommission || "0",
        });
        byMonth[r.month].totalCommission += commission;
      }

      const months = Object.values(byMonth).sort((a, b) => b.month.localeCompare(a.month));
      const totalLifetime = months.reduce((s, m) => s + m.totalCommission, 0);

      res.json({ months, totalLifetime });
    } catch (err: any) {
      serverError(res, err);
    }
  });
}

// ── Partner referral auto-enrollment helper ────────────────────────────────────
// Fires fire-and-forget after POST /api/referrals when referredEmail is present.
// Finds or creates the prospect contact, tags them LB-PARTNER-REFERRAL in GHL,
// adds a note with the referring partner's name, and enrolls in SDR: Reply Engaged.
async function autoEnrollPartnerReferral(referral: {
  id: number;
  partnerId?: number | null;
  referredEmail?: string | null;
  referredName?: string | null;
  referredPhone?: string | null;
  referredCompany?: string | null;
}): Promise<void> {
  if (!referral.referredEmail) return;

  const email = referral.referredEmail.toLowerCase();
  const nameParts = (referral.referredName || "Prospect").split(" ");
  const firstName = nameParts[0] || "Prospect";
  const lastName = nameParts.slice(1).join(" ") || "";

  let contact = await storage.getContactByEmail(email);

  if (!contact) {
    const { createContactLocalFirst } = await import("../services/contact-writer");
    const created = await createContactLocalFirst({
      firstName,
      lastName,
      email,
      phone: referral.referredPhone || "",
      companyName: referral.referredCompany || undefined,
      status: "Active",
      tags: ["LB-PARTNER-REFERRAL", "src_partner_referral"],
    });
    if (!created) {
      logOperationalDiagnostic("partner_referral_enrollment", new Error("contact creation failed"), "referral_contact_create_failed", { referralId: referral.id });
      return;
    }
    contact = created;
  }

  if (contact.doNotContact) {
    logOperationalDiagnostic("partner_referral_enrollment", new Error("contact blocked"), "referral_dnc_blocked", { referralId: referral.id, contactId: contact.id });
    return;
  }

  // The route checks before scheduling this helper; authorize again because
  // the fire-and-forget task may start after the pause epoch changes.
  const pauseDecision = await authorizeGhlRouteMutation();
  if (!pauseDecision.allowed) {
    logOperationalDiagnostic("partner_referral_enrollment", new Error("provider mutation paused"), "referral_mutation_paused", { referralId: referral.id, contactId: contact.id });
    return;
  }

  const { isSdrGhlConfigured, addTag, addNote } = await import("../services/sdr/ghl-client");

  if (contact.ghlContactId && isSdrGhlConfigured()) {
    let referrerName = "a partner";
    if (referral.partnerId) {
      try {
        const partner = await storage.getPartner(referral.partnerId);
        if (partner) referrerName = partner.contactName || partner.companyName || partner.email || referrerName;
      } catch (_) {}
    }

    await addTag({ contactId: contact.ghlContactId, tags: ["LB-PARTNER-REFERRAL", "LB-SDR", "src_partner_referral"] }).catch(() => {});
    await addNote({
      contactId: contact.ghlContactId,
      body: `Partner referral received from: ${referrerName}\nReferred contact: ${referral.referredName || email}\nCompany: ${referral.referredCompany || "Unknown"}\nSource: Liberty Bancard Partner Program\nReferral ID: ${referral.id}`,
    }).catch(() => {});
  }

  const sequences = await (storage as any).getSequences();
  const seq = sequences.find((s: { name: string }) =>
    s.name === "SDR: Reply Engaged" || s.name === "1. Switch & Save — Statement Audit"
  );
  if (!seq) {
    logOperationalDiagnostic("partner_referral_enrollment", new Error("sequence unavailable"), "referral_sequence_missing", { referralId: referral.id, contactId: contact.id });
    return;
  }

  const { enrollContactInGhlWorkflow } = await import("../services/ghl-workflow-enrollment");
  const result = await enrollContactInGhlWorkflow({
    contactId: contact.id,
    sequenceName: seq.name,
    sequenceId: seq.id,
  });

  void result;
}
