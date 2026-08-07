/**
 * Merchant Portal Invitation Routes
 *
 * Public (CSRF-exempt) endpoints:
 *   GET  /api/auth/portal-invite/validate  — check token, return name
 *   POST /api/auth/portal-invite/activate  — set password + create session
 *
 * Dashboard endpoint (requires isDashboardUser):
 *   POST /api/deals/:id/resend-portal-invite
 */

import type { Express } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { db } from "../db";
import { users } from "@shared/models/auth";
import { eq, and, gt } from "drizzle-orm";
import { isDashboardUser, requireRole } from "../replit_integrations/auth";
import { serverError } from "../utils/server-error";
import { parseId } from "./helpers";
import { sendMerchantPortalInvite } from "../services/merchant-portal-invite";
import { storage } from "../storage";

export function registerMerchantPortalInviteRoutes(app: Express) {
  // ── Validate invite token (called by the frontend before showing the form) ─
  app.get("/api/auth/portal-invite/validate", async (req, res) => {
    try {
      const { token } = req.query as { token?: string };
      if (!token) return res.status(400).json({ valid: false, message: "Token is required" });

      const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

      const [user] = await db
        .select()
        .from(users)
        .where(
          and(
            eq(users.resetToken, hashedToken),
            gt(users.resetExpiresAt!, new Date()),
          ),
        );

      if (!user) {
        return res.status(400).json({ valid: false, message: "Invalid or expired invitation link" });
      }

      return res.json({
        valid: true,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ── Activate portal account (set password + auto-login) ───────────────────
  app.post("/api/auth/portal-invite/activate", async (req, res) => {
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

      const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

      const [user] = await db
        .select()
        .from(users)
        .where(
          and(
            eq(users.resetToken, hashedToken),
            gt(users.resetExpiresAt!, new Date()),
          ),
        );

      if (!user) {
        return res.status(400).json({ message: "Invalid or expired invitation link. Please request a new invitation from your account manager." });
      }

      // SECURITY: Only permit activation for merchant accounts.
      // This is a belt-and-suspenders guard — the invite service already refuses
      // to issue tokens against non-merchant users, but this ensures the activation
      // path cannot be used to reset credentials on a privileged account even if a
      // token somehow ended up on one.
      if (user.role !== "merchant") {
        console.error(
          `[PortalActivate] Blocked activation attempt on non-merchant user ` +
          `(id=${user.id}, role=${user.role})`,
        );
        return res.status(403).json({ message: "This activation link is not valid for this account type." });
      }

      // Hash the new password and clear the invite token
      const passwordHash = await bcrypt.hash(password, 12);
      await db
        .update(users)
        .set({
          passwordHash,
          resetToken: null,
          resetExpiresAt: null,
          emailVerified: new Date(), // treat invitation as email verification
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));

      // Log the activation
      await storage.createAuditLog({
        action: "merchant_portal_activated",
        entityType: "user",
        entityId: user.id as any,
        details: { email: user.email, role: user.role },
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
        console.warn("[PortalActivate] Could not record user_session row:", sessionErr.message);
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
  // Agents are intentionally excluded: this action rotates a valid invite token
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
