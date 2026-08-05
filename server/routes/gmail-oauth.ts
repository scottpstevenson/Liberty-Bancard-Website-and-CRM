/**
 * Gmail OAuth admin routes + GHL channel probe/attestation routes.
 *
 * All routes require admin or manager role.  No secret values are ever returned in responses.
 *
 * Gmail OAuth:
 *   GET    /api/admin/gmail-oauth/status          — connection state, email, aliases (no secrets)
 *   GET    /api/admin/gmail-oauth/authorize        — returns the authorization URL for the OAuth flow
 *   GET    /api/admin/gmail-oauth/callback         — OAuth2 redirect target; exchanges code for tokens
 *   POST   /api/admin/gmail-oauth/verify           — live probe: token → Google userinfo
 *   POST   /api/admin/gmail-oauth/refresh-aliases  — re-fetches send-as aliases from Gmail
 *   POST   /api/admin/gmail-oauth/test-send        — sends a test email to an explicit internal address
 *   DELETE /api/admin/gmail-oauth/revoke           — revokes token and clears DB entry
 *
 * GHL Channel Probes & Attestations:
 *   GET  /api/admin/ghl-probes/cold-email          — live GHL probe: sending domain + sender address
 *   GET  /api/admin/ghl-probes/sms                 — live GHL probe: phone numbers + A2P attestation
 *   POST /api/admin/ghl-probes/attest              — record admin attestation for a gate
 *   GET  /api/admin/ghl-probes/attestation/:key    — retrieve latest attestation for a gate key
 */

import type { Express, Request, Response } from "express";
import { requireRole } from "../replit_integrations/auth";
import { getCanonicalUrl } from "../lib/canonical-url";
import {
  getGmailOAuthStatus,
  getGmailAuthorizationUrl,
  exchangeCodeForTokens,
  verifyGmailConnection,
  revokeGmailAccess,
  refreshSendAsAliases,
  sendGmailEmail,
  isGmailOAuthSecretsPresent,
} from "../services/gmail-oauth";
import {
  probeGhlColdEmail,
  probeGhlSms,
  recordAdminAttestation,
  getLatestAttestation,
} from "../services/ghl-channel-probes";
import { serverError } from "../utils/server-error";

export function registerGmailOAuthRoutes(app: Express): void {
  // ── Status ──────────────────────────────────────────────────────────────────
  app.get("/api/admin/gmail-oauth/status", requireRole("admin", "manager"), async (_req: Request, res: Response) => {
    try {
      const status = await getGmailOAuthStatus();
      res.json(status);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ── Authorize (get OAuth URL) ───────────────────────────────────────────────
  app.get("/api/admin/gmail-oauth/authorize", requireRole("admin"), (_req: Request, res: Response) => {
    try {
      if (!isGmailOAuthSecretsPresent()) {
        return res.status(400).json({
          message: "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in Replit Secrets before starting the OAuth flow.",
          missingSecrets: [
            !process.env.GOOGLE_CLIENT_ID     ? "GOOGLE_CLIENT_ID"     : null,
            !process.env.GOOGLE_CLIENT_SECRET ? "GOOGLE_CLIENT_SECRET" : null,
          ].filter(Boolean),
        });
      }
      const redirectUri = `${getCanonicalUrl()}/api/admin/gmail-oauth/callback`;
      const authUrl = getGmailAuthorizationUrl(redirectUri);
      if (!authUrl) return res.status(500).json({ message: "Could not generate authorization URL" });
      res.json({ authUrl, redirectUri });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ── Callback (exchange code) ────────────────────────────────────────────────
  // NOTE: This endpoint is hit by the Google OAuth redirect.
  // For the admin flow, the admin will be directed to this URL in a new browser window.
  // After success, they are redirected to the readiness dashboard.
  app.get("/api/admin/gmail-oauth/callback", async (req: Request, res: Response) => {
    const { code, error: oauthError } = req.query as Record<string, string>;

    const canonicalBase = getCanonicalUrl();

    if (oauthError) {
      console.error("[Gmail OAuth] Callback error:", oauthError);
      return res.redirect(`${canonicalBase}/dashboard/outbound-readiness?gmail_error=${encodeURIComponent(oauthError)}`);
    }

    if (!code) {
      return res.redirect(`${canonicalBase}/dashboard/outbound-readiness?gmail_error=missing_code`);
    }

    const redirectUri = `${canonicalBase}/api/admin/gmail-oauth/callback`;
    const result = await exchangeCodeForTokens(code, redirectUri);

    if (result.success) {
      return res.redirect(`${canonicalBase}/dashboard/outbound-readiness?gmail_connected=${encodeURIComponent(result.email || "")}`);
    } else {
      return res.redirect(`${canonicalBase}/dashboard/outbound-readiness?gmail_error=${encodeURIComponent(result.error || "unknown")}`);
    }
  });

  // ── Live verify ─────────────────────────────────────────────────────────────
  app.post("/api/admin/gmail-oauth/verify", requireRole("admin", "manager"), async (_req: Request, res: Response) => {
    try {
      const result = await verifyGmailConnection();
      res.json(result);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ── Refresh aliases ─────────────────────────────────────────────────────────
  app.post("/api/admin/gmail-oauth/refresh-aliases", requireRole("admin"), async (_req: Request, res: Response) => {
    try {
      const aliases = await refreshSendAsAliases();
      res.json({ aliases });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ── Test send ───────────────────────────────────────────────────────────────
  app.post("/api/admin/gmail-oauth/test-send", requireRole("admin"), async (req: Request, res: Response) => {
    const { to, fromCategory } = req.body ?? {};

    if (!to || typeof to !== "string" || !to.includes("@")) {
      return res.status(400).json({ message: "to must be a valid email address" });
    }

    // Safety: only permit sends to @libertybancard.com in production
    const isProd = process.env.NODE_ENV === "production";
    const isInternalRecipient = to.endsWith("@libertybancard.com");
    if (isProd && !isInternalRecipient) {
      return res.status(403).json({
        message: "Test sends are restricted to @libertybancard.com addresses in production",
      });
    }

    const category = fromCategory || "department_onboarding";
    const html = `
      <div style="font-family: sans-serif; max-width: 600px;">
        <h2 style="color: #1a3a5c;">Gmail OAuth Test Send ✓</h2>
        <p>This is a controlled test send from the Liberty Bancard outbound system.</p>
        <p><strong>Sent at:</strong> ${new Date().toISOString()}</p>
        <p><strong>Category:</strong> ${category}</p>
        <p style="color: #666; font-size: 12px;">This email confirms that Gmail OAuth is connected and the sender policy is resolving correctly.</p>
      </div>
    `;

    try {
      const result = await sendGmailEmail({
        to,
        subject: `[Test] Liberty Bancard Gmail OAuth — ${new Date().toLocaleTimeString()}`,
        html,
        category: category as any,
      });
      res.json(result);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ── Revoke ──────────────────────────────────────────────────────────────────
  app.delete("/api/admin/gmail-oauth/revoke", requireRole("admin"), async (_req: Request, res: Response) => {
    try {
      await revokeGmailAccess();
      res.json({ ok: true, message: "Gmail access revoked and tokens cleared" });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ════════════════════════════════════════════════════════════════════════════
  // GHL Channel Probes & Admin Attestations
  // ════════════════════════════════════════════════════════════════════════════

  // ── Cold email domain + sender live probe ───────────────────────────────────
  app.get("/api/admin/ghl-probes/cold-email", requireRole("admin", "manager"), async (_req: Request, res: Response) => {
    try {
      const result = await probeGhlColdEmail();
      res.json(result);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ── SMS number + A2P live probe ─────────────────────────────────────────────
  app.get("/api/admin/ghl-probes/sms", requireRole("admin", "manager"), async (_req: Request, res: Response) => {
    try {
      const result = await probeGhlSms();
      res.json(result);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ── Record admin attestation ────────────────────────────────────────────────
  app.post("/api/admin/ghl-probes/attest", requireRole("admin"), async (req: Request, res: Response) => {
    const { gateKey, attestationNote, expiresAt } = req.body ?? {};
    if (!gateKey || typeof gateKey !== "string") {
      return res.status(400).json({ message: "gateKey is required" });
    }
    if (!attestationNote || typeof attestationNote !== "string") {
      return res.status(400).json({ message: "attestationNote is required" });
    }
    const userEmail = (req.user as any)?.email ?? (req.user as any)?.username ?? "admin";
    try {
      const row = await recordAdminAttestation({
        gateKey,
        attestedBy:      userEmail,
        attestationNote,
        expiresAt:       expiresAt ? new Date(expiresAt) : undefined,
      });
      res.json({ ok: true, id: row.id, attestedBy: row.attestedBy, attestedAt: row.attestedAt });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ── Get latest attestation for a gate key ───────────────────────────────────
  app.get("/api/admin/ghl-probes/attestation/:key", requireRole("admin", "manager"), async (req: Request, res: Response) => {
    const { key } = req.params;
    try {
      const attestation = await getLatestAttestation(key);
      if (!attestation) return res.json({ found: false });
      res.json({ found: true, ...attestation });
    } catch (err: any) {
      serverError(res, err);
    }
  });
}
