/**
 * Merchant Portal Invitation Service
 *
 * Sends a time-limited (72 h) invitation email to a newly-approved merchant.
 * The email contains a one-time token that lets the merchant set a password
 * and activate their portal account.
 *
 * Token mechanism: re-uses the `users.resetToken` / `users.resetExpiresAt`
 * columns so no schema migration is needed. The activation page uses the
 * same `/api/auth/portal-invite/activate` endpoint rather than the regular
 * reset-password endpoint, which also creates a session on success.
 */

import { db } from "../db";
import { users } from "@shared/models/auth";
import { merchantProfiles, deals, contacts } from "@shared/schema";
import { eq } from "drizzle-orm";
import { storage } from "../storage";
import { getCanonicalUrl } from "../lib/canonical-url";
import { isSmtpConfigured, sendSmtpEmail } from "./smtp-email";
import { getEmailSignatureHtml } from "./email-signatures";
import { issueAuthAction, setAuthActionDelivery } from "./auth-actions";
import { logOperationalDiagnostic } from "../utils/server-error";

const INVITE_TTL_MS = 72 * 60 * 60 * 1000; // 72 hours
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]!));

function buildPortalInviteEmail(
  firstName: string,
  businessName: string,
  activateUrl: string,
): string {
  const displayName = escapeHtml(firstName || "there");
  const displayBiz = businessName ? ` for <strong>${escapeHtml(businessName)}</strong>` : "";
  const safeActivateUrl = escapeHtml(activateUrl);
  const signature = getEmailSignatureHtml("onboarding", undefined, null);

  return `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;max-width:600px;">
  <p>Hi ${displayName},</p>

  <p>Great news — your Liberty Bancard merchant portal${displayBiz} is ready. You can now log in to view your account, track your processing activity, and access your documents.</p>

  <p>Click the button below to set your password and activate your account. This link expires in <strong>72 hours</strong>.</p>

  <p style="text-align:center;margin:28px 0;">
    <a href="${safeActivateUrl}"
       style="display:inline-block;background-color:#1e3a5f;color:#ffffff;padding:12px 28px;border-radius:4px;text-decoration:none;font-size:14px;font-weight:bold;">
      Activate My Portal Account &rarr;
    </a>
  </p>

  <p>If the button doesn't work, paste this link into your browser:</p>
  <p style="word-break:break-all;font-size:12px;color:#555;">${safeActivateUrl}</p>

  <p>If you weren't expecting this email or don't recognise Liberty Bancard, you can safely ignore it.</p>

  <p>Questions? Reply to this email or call 954-266-8214.</p>

  ${signature}
</div>
`;
}

export interface InviteResult {
  sent: boolean;
  reason?: "no_contact" | "no_email" | "already_activated" | "smtp_not_configured" | "smtp_error" | "unknown_error" | "email_collision_privileged_role";
  userId?: string;
  profileId?: number;
}

/**
 * Send (or resend) a portal invitation for the given onboarding deal.
 *
 * - Creates a merchant user account if one doesn't already exist for that email.
 * - Creates/links a merchantProfile row for the deal.
 * - Issues a new reset token and sends the invite email.
 *
 * On resend=true, skips the "already_activated" check and always re-issues a
 * fresh token so the rep can unlock a merchant who forgot to activate.
 */
export async function sendMerchantPortalInvite(
  dealId: number,
  opts: { resend?: boolean } = {},
): Promise<InviteResult> {
  let issuedActionId: string | undefined;
  let definiteFailure = false;
  try {
    // 1. Load deal
    const deal = await storage.getDeal(dealId);
    if (!deal || !deal.contactId) {
      logOperationalDiagnostic("merchant_portal_invite", new Error("missing deal contact"), "no_contact", { dealId });
      return { sent: false, reason: "no_contact" };
    }

    // 2. Load contact → get email
    const contact = await storage.getContact(deal.contactId);
    if (!contact?.email) {
      logOperationalDiagnostic("merchant_portal_invite", new Error("missing contact email"), "no_email", { dealId, contactId: deal.contactId });
      return { sent: false, reason: "no_email" };
    }

    const email = contact.email.toLowerCase();

    // 3. Find or create the merchant user.
    //    SECURITY: If a non-merchant account (admin/manager/agent/affiliate/partner)
    //    shares the contact's email we must NOT issue a reset token against it — doing
    //    so would let anyone with the invite link take over a privileged account.
    //    Instead we surface a clear error so the rep can resolve the conflict manually.
    const [existingUser] = await db.select().from(users).where(eq(users.email, email));
    let merchantUser = existingUser;

    if (!merchantUser) {
      // No user at all — create a fresh merchant account.
      const [created] = await db
        .insert(users)
        .values({
          email,
          firstName: contact.firstName ?? undefined,
          lastName: contact.lastName ?? undefined,
          role: "merchant",
          authProvider: "local",
        })
        .returning();
      merchantUser = created;
    } else {
      // A user with this email already exists — only proceed if it is a merchant account.
      if (existingUser.role !== "merchant") {
        logOperationalDiagnostic("merchant_portal_invite", new Error("privileged email collision"), "email_collision_privileged_role", { dealId });
        return { sent: false, reason: "email_collision_privileged_role" };
      }

      // Resend is always allowed; on initial send, skip if already fully activated.
      if (!opts.resend && merchantUser.passwordHash) {
        return { sent: false, reason: "already_activated", userId: merchantUser.id };
      }
    }

    // 4. Find or create merchantProfile linking the user → deal
    const [existingProfile] = await db
      .select()
      .from(merchantProfiles)
      .where(eq(merchantProfiles.dealId, dealId));

    let profileId: number;
    if (!existingProfile) {
      const [created] = await db
        .insert(merchantProfiles)
        .values({
          userId: merchantUser.id,
          dealId,
          contactId: deal.contactId,
          accountStatus: "pending",
        })
        .returning();
      profileId = created.id;
    } else {
      profileId = existingProfile.id;
      // If the profile isn't linked to the correct user yet, update it
      if (existingProfile.userId !== merchantUser.id) {
        await db
          .update(merchantProfiles)
          .set({ userId: merchantUser.id, updatedAt: new Date() })
          .where(eq(merchantProfiles.id, existingProfile.id));
      }
    }

    // The canonical authority revokes older deliveries before issuing this one.
    const action = await issueAuthAction({
      purpose: "merchant_activation", subject: { type: "user", id: merchantUser.id }, ttlMs: INVITE_TTL_MS,
    });
    issuedActionId = action.id;

    // 6. Build and send email
    const appUrl = getCanonicalUrl();
    const activateUrl = `${appUrl}/activate-portal#token=${encodeURIComponent(action.token)}`;

    const html = buildPortalInviteEmail(
      contact.firstName ?? "",
      contact.companyName ?? "",
      activateUrl,
    );

    if (!isSmtpConfigured()) {
      // SECURITY: never log the raw token or activation URL — it is a bearer credential.
      logOperationalDiagnostic("merchant_portal_invite_delivery", new Error("mail transport unavailable"), "smtp_not_configured", { dealId, profileId });
      await setAuthActionDelivery(action.id, "definite_failure");
      definiteFailure = true;
      return { sent: false, reason: "smtp_not_configured", userId: merchantUser.id, profileId };
    }

    const result = await sendSmtpEmail({
      to: contact.email,
      subject: "Your Liberty Bancard merchant portal is ready",
      html,
      category: "onboarding",
      contactId: contact.id,
    });

    if (!result.success) {
      logOperationalDiagnostic("merchant_portal_invite_delivery", new Error("mail delivery failed"), "smtp_error", { dealId, profileId });
      await setAuthActionDelivery(action.id, "definite_failure");
      definiteFailure = true;
      return { sent: false, reason: "smtp_error", userId: merchantUser.id, profileId };
    }
    await setAuthActionDelivery(action.id, "sent");

    await storage.createAuditLog({
      action: opts.resend ? "merchant_portal_invite_resent" : "merchant_portal_invite_sent",
      entityType: "deal",
      entityId: dealId,
      details: {
        contactId: deal.contactId,
        userId: merchantUser.id,
        profileId,
      },
    });

    return { sent: true, userId: merchantUser.id, profileId };
  } catch (err: any) {
    if (issuedActionId && !definiteFailure) {
      await setAuthActionDelivery(issuedActionId, "ambiguous").catch(() => {});
    }
    logOperationalDiagnostic("merchant_portal_invite", err, "unexpected_failure", { dealId });
    return { sent: false, reason: "unknown_error" };
  }
}
