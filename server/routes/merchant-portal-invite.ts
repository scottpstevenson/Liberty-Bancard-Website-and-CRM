/**
 * Merchant Portal Invitation Routes
 *
 * Public (CSRF-exempt) endpoints:
 *   POST /api/auth/portal-invite/validate  — identity-free validity check
 *   POST /api/auth/portal-invite/activate  — set password + create session
 *
 * Dashboard endpoint (requires isDashboardUser):
 *   POST /api/deals/:id/resend-portal-invite
 */

import type { Express } from "express";
import bcrypt from "bcryptjs";
import { users } from "@shared/models/auth";
import { eq } from "drizzle-orm";
import { isDashboardUser, requireRole } from "../replit_integrations/auth";
import { logOperationalDiagnostic, serverError } from "../utils/server-error";
import { parseId } from "./helpers";
import { sendMerchantPortalInvite } from "../services/merchant-portal-invite";
import { storage } from "../storage";
import { consumeAuthAction, isAuthActionValid } from "../services/auth-actions";

function authActionHeaders(res: any) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Referrer-Policy", "no-referrer");
}

export function registerMerchantPortalInviteRoutes(app: Express) {
  // ── Validate invite token (called by the frontend before showing the form) ─
  app.post("/api/auth/portal-invite/validate", async (req, res) => {
    authActionHeaders(res);
    try {
      const valid = await isAuthActionValid(typeof req.body?.token === "string" ? req.body.token : "", "merchant_activation");
      return res.status(valid ? 200 : 400).json({ valid });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ── Activate portal account (set password + auto-login) ───────────────────
  app.post("/api/auth/portal-invite/activate", async (req, res) => {
    authActionHeaders(res);
    try {
      const { token, password } = req.body;

      if (!token || typeof token !== "string") {
        return res.status(400).json({ message: "Token is required" });
      }
      if (!password || typeof password !== "string") {
        return res.status(400).json({ message: "Password is required" });
      }
      if (password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const consumed = await consumeAuthAction({
        token, purpose: "merchant_activation",
        mutate: async (subject, tx) => {
          if (subject.type !== "user") return null;
          const [user] = await tx.select().from(users).where(eq(users.id, String(subject.id)));
          if (!user || user.role !== "merchant") return null;
          await tx.update(users).set({ passwordHash, emailVerified: new Date(), updatedAt: new Date() })
            .where(eq(users.id, user.id));
          return user;
        },
      });
      if (!consumed.ok || !consumed.value) {
        return res.status(400).json({ message: "This link is invalid or expired." });
      }
      const user = consumed.value;

      // Log the activation
      await storage.createAuditLog({
        action: "merchant_portal_activated",
        entityType: "user",
        entityId: user.id as any,
        details: { role: user.role },
      });

      // Auto-login: create a session for the user
      await new Promise<void>((resolve, reject) => {
        req.login(user as any, (err) => (err ? reject(err) : resolve()));
      });

      // Track session in user_sessions table
      try {
        const { authStorage } = await import("../replit_integrations/auth/storage");
        const ip =
          (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
          req.socket?.remoteAddress ||
          undefined;
        const userAgent = req.headers["user-agent"] || undefined;
        await authStorage.createUserSession({
          userId: user.id,
          sessionId: req.sessionID,
          ip,
          userAgent,
        });
      } catch (sessionErr: any) {
        // Non-fatal — session is still established via req.login
        logOperationalDiagnostic("merchant_portal_activation", sessionErr, "session_record_failed", { userId: user.id });
      }

      return res.json({
        message: "Portal account activated. You are now logged in.",
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
        },
      });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ── Resend invite (admin/manager only) ───────────────────────────────────
  // Agents are intentionally excluded: this action consumes merchant activation authority.
  // and sends an activation link, so it must be restricted to staff who have
  // verified deal-ownership authority across all merchants.
  app.post("/api/deals/:id/resend-portal-invite", requireRole("admin", "manager"), async (req, res) => {
    try {
      const dealId = parseId(req.params.id);
      if (dealId === null) return res.status(404).json({ message: "Deal not found" });

      const deal = await storage.getDeal(dealId);
      if (!deal) return res.status(404).json({ message: "Deal not found" });

      const result = await sendMerchantPortalInvite(dealId, { resend: true });

      if (!result.sent) {
        const messages: Record<string, string> = {
          no_contact: "This deal has no linked contact.",
          no_email: "The linked contact has no email address.",
          email_collision_privileged_role: "This contact's email is already used by a staff account. Please use a different email for the merchant portal.",
          smtp_not_configured: "SMTP is not configured — invitation could not be sent.",
          smtp_error: "Email delivery failed. Please try again.",
          unknown_error: "An unexpected error occurred.",
        };
        const message = messages[result.reason ?? "unknown_error"] ?? "Could not send invitation.";
        return res.status(422).json({ message, reason: result.reason });
      }

      return res.json({
        message: "Portal invitation sent.",
        userId: result.userId,
        profileId: result.profileId,
      });
    } catch (err: any) {
      serverError(res, err);
    }
  });
}
