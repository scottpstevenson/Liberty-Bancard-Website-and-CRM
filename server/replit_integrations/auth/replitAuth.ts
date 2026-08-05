import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import connectPg from "connect-pg-simple";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { TOTP, generateSecret as totpGenerateSecret } from "otplib";
import QRCode from "qrcode";
import { authStorage, getSessionLimitForRole, IDLE_TIMEOUT_MS, ABSOLUTE_TTL_MS } from "./storage";
import { storage } from "../../storage";
import { isGhlConfigured, sendGhlEmailForMerchant as sendGhlEmail } from "../../services/ghl";
import { getEmailSignatureHtml } from "../../services/email-signatures";
import { sendSmtpEmail, isSmtpConfigured } from "../../services/smtp-email";
import { db } from "../../db";
import { systemSettings, users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { csrfProtection } from "../../middleware/csrf";
import { merchantAuthRateLimit, verifyEmailRateLimit } from "../../middleware/public-rate-limit";

import { getCanonicalUrl } from "../../lib/canonical-url";
import { serverError } from "../../utils/server-error";
const APP_URL = getCanonicalUrl();

function buildPasswordResetEmail(firstName: string, resetUrl: string): string {
  const displayName = firstName || "there";
  return `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;max-width:600px;">
  <div style="background-color:#1e3a5f;padding:20px 24px;border-radius:6px 6px 0 0;">
    <span style="color:#ffffff;font-size:20px;font-weight:bold;letter-spacing:0.5px;">Liberty Bancard</span>
  </div>
  <div style="background-color:#f9fafb;padding:28px 24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 6px 6px;">
    <p style="margin:0 0 16px;">Hi ${displayName},</p>
    <p style="margin:0 0 16px;">We received a request to reset the password for your Liberty Bancard account. Click the button below to set a new password. This link expires in <strong>1 hour</strong>.</p>
    <div style="text-align:center;margin:28px 0;">
      <a href="${resetUrl}" style="display:inline-block;background-color:#1e3a5f;color:#ffffff;padding:14px 28px;border-radius:5px;text-decoration:none;font-size:14px;font-weight:bold;">Reset My Password &rarr;</a>
    </div>
    <p style="margin:0 0 16px;">If the button above doesn't work, copy and paste this link into your browser:</p>
    <p style="margin:0 0 16px;word-break:break-all;font-size:12px;color:#555;">${resetUrl}</p>
    <p style="margin:0 0 8px;">If you did not request a password reset, you can safely ignore this email — your password will not be changed.</p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;"/>
    <p style="margin:0;font-size:12px;color:#6b7280;">Liberty Bancard &bull; <a href="https://libertybancard.com" style="color:#1e3a5f;">libertybancard.com</a> &bull; 954-266-8214</p>
    <p style="margin:4px 0 0;font-size:11px;color:#9ca3af;">This communication is from Liberty Bancard. Eligibility, underwriting, card brand rules, and applicable laws apply.</p>
  </div>
</div>`;
}

function buildVerificationEmail(firstName: string, verifyUrl: string): string {
  const displayName = firstName || "there";
  return `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;max-width:600px;">
  <div style="background-color:#1e3a5f;padding:20px 24px;border-radius:6px 6px 0 0;">
    <span style="color:#ffffff;font-size:20px;font-weight:bold;letter-spacing:0.5px;">Liberty Bancard</span>
  </div>
  <div style="background-color:#f9fafb;padding:28px 24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 6px 6px;">
    <p style="margin:0 0 16px;">Hi ${displayName},</p>
    <p style="margin:0 0 16px;">Thanks for signing up with Liberty Bancard! Please verify your email address to activate your merchant account. This link expires in <strong>24 hours</strong>.</p>
    <div style="text-align:center;margin:28px 0;">
      <a href="${verifyUrl}" style="display:inline-block;background-color:#1e3a5f;color:#ffffff;padding:14px 28px;border-radius:5px;text-decoration:none;font-size:14px;font-weight:bold;">Verify My Email &rarr;</a>
    </div>
    <p style="margin:0 0 16px;">If the button above doesn't work, copy and paste this link into your browser:</p>
    <p style="margin:0 0 16px;word-break:break-all;font-size:12px;color:#555;">${verifyUrl}</p>
    <p style="margin:0 0 8px;">If you did not sign up for a Liberty Bancard account, you can safely ignore this email.</p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;"/>
    <p style="margin:0;font-size:12px;color:#6b7280;">Liberty Bancard &bull; <a href="https://libertybancard.com" style="color:#1e3a5f;">libertybancard.com</a> &bull; 954-266-8214</p>
    <p style="margin:4px 0 0;font-size:11px;color:#9ca3af;">This communication is from Liberty Bancard. Eligibility, underwriting, card brand rules, and applicable laws apply.</p>
  </div>
</div>`;
}

async function sendAuthEmail(params: {
  to: string;
  subject: string;
  html: string;
  label: string;
}): Promise<void> {
  // All account-security / auth messages use security@libertybancard.com per sender policy.
  const SECURITY_FROM = "security@libertybancard.com";
  const SECURITY_NAME = "Liberty Bancard Security";

  if (isSmtpConfigured()) {
    const result = await sendSmtpEmail({
      to: params.to,
      subject: params.subject,
      html: params.html,
      category: "security",
    });
    if (result.success) return;
    console.error(`[Auth] SMTP send failed for ${params.label} to ${params.to}: ${result.error} — attempting GHL fallback`);
    if (isGhlConfigured()) {
      const ghlResult = await sendGhlEmail({
        email: params.to,
        subject: params.subject,
        body: params.html,
        fromEmail: SECURITY_FROM,
        fromName: SECURITY_NAME,
      });
      if (ghlResult.success) return;
      console.error(`[Auth] GHL fallback also failed for ${params.label} to ${params.to}: ${ghlResult.error}`);
    }
    return;
  }

  if (isGhlConfigured()) {
    const result = await sendGhlEmail({
      email: params.to,
      subject: params.subject,
      body: params.html,
      fromEmail: SECURITY_FROM,
      fromName: SECURITY_NAME,
    });
    if (!result.success) {
      console.error(`[Auth] GHL send failed for ${params.label} to ${params.to}: ${result.error}`);
    }
    return;
  }

  console.warn(`[Auth] WARNING: No email transport configured (set SMTP_HOST/SMTP_USER/SMTP_PASS or GHL credentials). ${params.label} email NOT sent to ${params.to}`);
}

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000;
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  const secret =
    process.env.SESSION_SECRET ||
    (process.env.NODE_ENV !== "production"
      ? "dev-insecure-fallback-secret-do-not-use-in-production"
      : (() => { throw new Error("SESSION_SECRET must be set in production"); })());
  return session({
    secret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: sessionTtl,
    },
  });
}

async function isMfaRequiredGlobally(): Promise<boolean> {
  try {
    const [setting] = await db.select().from(systemSettings).where(eq(systemSettings.key, "mfa_required"));
    return setting?.value === true;
  } catch {
    return false;
  }
}

async function seedAdminUser() {
  const adminEmail = process.env.ADMIN_SEED_EMAIL;
  const adminPassword = process.env.ADMIN_SEED_PASSWORD;

  if (!adminEmail || !adminPassword) {
    throw new Error(
      "[Auth] ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD must both be set to seed the admin account. " +
        "Set these environment variables and restart the server."
    );
  }

  const existing = await authStorage.getUserByEmail(adminEmail);
  if (!existing) {
    const passwordHash = await bcrypt.hash(adminPassword, 12);
    await authStorage.upsertUser({
      email: adminEmail,
      firstName: "Scott",
      lastName: "Stevenson",
      passwordHash,
      role: "admin",
      authProvider: "local",
    });
    console.log(`[Auth] Admin user seeded: ${adminEmail}`);
  } else {
    // Safe default: do NOT overwrite an existing admin password from env vars.
    // This prevents an env var leak from silently re-hashing the admin password on every boot.
    // Set ADMIN_SEED_FORCE_UPDATE=true only in controlled dev environments to opt back into sync behavior.
    const forceUpdate = process.env.ADMIN_SEED_FORCE_UPDATE === "true";
    if (!forceUpdate) {
      console.log(`[Auth] Admin seeding skipped — existing admin password preserved (set ADMIN_SEED_FORCE_UPDATE=true to overwrite): ${adminEmail}`);
      return;
    }
    // Only reached when ADMIN_SEED_FORCE_UPDATE=true is explicitly set
    const passwordHash = await bcrypt.hash(adminPassword, 12);
    await db
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.email, adminEmail.toLowerCase()));
    console.log(`[Auth] Admin password force-updated from env (ADMIN_SEED_FORCE_UPDATE=true): ${adminEmail}`);
  }
}

/** Helper to register a new session record after a successful login */
async function registerLoginSession(req: any, userId: string, role: string): Promise<void> {
  try {
    const sessionId = req.sessionID;
    if (!sessionId) return;

    // Enforce concurrent session limit — remove oldest if over limit
    const limit = getSessionLimitForRole(role);
    await authStorage.invalidateOldestSessionsForUser(userId, limit - 1);

    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket?.remoteAddress || undefined;
    const userAgent = req.headers["user-agent"] || undefined;

    // Upsert: if a session record already exists for this sessionId, skip
    const existing = await authStorage.getUserSession(sessionId);
    if (!existing) {
      await authStorage.createUserSession({ userId, sessionId, ip, userAgent });
    }
  } catch (err) {
    console.error("[Auth] Failed to register login session:", err);
  }
}

const signupRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many signup attempts, please try again later." },
});

const forgotPasswordRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many password reset requests, please try again later." },
});

const resetPasswordRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many password reset attempts, please try again later." },
});

const totpRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many verification attempts, please try again later." },
});

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function generateBackupCodes(): { plain: string[]; hashed: Array<{ code: string; used: boolean }> } {
  const plain: string[] = [];
  const hashed: Array<{ code: string; used: boolean }> = [];
  for (let i = 0; i < 8; i++) {
    const code = crypto.randomBytes(5).toString("hex").toUpperCase();
    const formatted = code.slice(0, 5) + "-" + code.slice(5);
    plain.push(formatted);
    hashed.push({ code: hashToken(formatted), used: false });
  }
  return { plain, hashed };
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());
  app.use(csrfProtection);

  passport.use(
    new LocalStrategy(
      { usernameField: "email", passwordField: "password" },
      async (email, password, done) => {
        try {
          const user = await authStorage.getUserByEmail(email.toLowerCase());
          if (!user) {
            return done(null, false, { message: "Invalid email or password" });
          }
          if (!user.passwordHash) {
            return done(null, false, { message: "Please use Google to sign in" });
          }
          const isValid = await bcrypt.compare(password, user.passwordHash);
          if (!isValid) {
            return done(null, false, { message: "Invalid email or password" });
          }
          return done(null, user);
        } catch (err) {
          return done(err);
        }
      }
    )
  );

  passport.serializeUser((user: any, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await authStorage.getUser(id);
      done(null, user || null);
    } catch (err) {
      done(err, null);
    }
  });

  app.post("/api/auth/login", merchantAuthRateLimit, (req, res, next) => {
    passport.authenticate("local", async (err: any, user: any, info: any) => {
      if (err) return res.status(500).json({ message: "Server error" });
      if (!user) return res.status(401).json({ message: info?.message || "Invalid credentials" });

      try {
        const globalMfaRequired = await isMfaRequiredGlobally();

        if (user.totpEnabled) {
          const trustedDeviceCookie = req.cookies?.trusted_device_token;
          if (trustedDeviceCookie) {
            const hashedCookieToken = hashToken(trustedDeviceCookie);
            const devices = await authStorage.getTrustedDevices(user.id);
            const now = new Date();
            const trustedDevice = devices.find(d => d.token === hashedCookieToken && new Date(d.expiresAt) > now);
            if (trustedDevice) {
              return req.logIn(user, async (loginErr) => {
                if (loginErr) return res.status(500).json({ message: "Login failed" });
                await registerLoginSession(req, user.id, user.role || "merchant");
                const { passwordHash, totpSecret, ...safeUser } = user;
                return res.json(safeUser);
              });
            }
          }
          (req.session as any).pendingMfaUserId = user.id;
          return res.status(200).json({ mfa_required: true });
        }

        if (globalMfaRequired && !user.totpEnabled) {
          req.logIn(user, async (loginErr) => {
            if (loginErr) return res.status(500).json({ message: "Login failed" });
            await registerLoginSession(req, user.id, user.role || "merchant");
            const { passwordHash, totpSecret, ...safeUser } = user;
            return res.json({ ...safeUser, mfa_enrollment_required: true });
          });
          return;
        }

        req.logIn(user, async (loginErr) => {
          if (loginErr) return res.status(500).json({ message: "Login failed" });
          await registerLoginSession(req, user.id, user.role || "merchant");
          const { passwordHash, totpSecret, ...safeUser } = user;
          return res.json(safeUser);
        });
      } catch (err) {
        return res.status(500).json({ message: "Server error" });
      }
    })(req, res, next);
  });

  app.post("/api/auth/totp/verify-login", totpRateLimit, async (req, res) => {
    const pendingUserId = (req.session as any).pendingMfaUserId;
    if (!pendingUserId) {
      return res.status(400).json({ message: "No pending MFA verification" });
    }

    const { code, rememberDevice, deviceName } = req.body;
    if (!code) return res.status(400).json({ message: "Verification code is required" });

    try {
      const user = await authStorage.getUser(pendingUserId);
      if (!user) return res.status(400).json({ message: "Invalid session" });

      const totpData = await authStorage.getTotpData(user.id);
      if (!totpData.enabled || !totpData.secret) {
        return res.status(400).json({ message: "2FA not configured" });
      }

      const cleanCode = String(code).replace(/\s/g, "");
      let verified = false;

      if (cleanCode.length === 11 && cleanCode.includes("-")) {
        const backupCodes = totpData.backupCodes || [];
        const codeHash = hashToken(cleanCode.toUpperCase());
        const idx = backupCodes.findIndex(bc => bc.code === codeHash && !bc.used);
        if (idx !== -1) {
          await authStorage.markBackupCodeUsed(user.id, idx);
          verified = true;
        }
      } else {
        try {
          const totp = new TOTP();
          verified = totp.verify({ token: cleanCode, secret: totpData.secret });
        } catch {
          verified = false;
        }
      }

      if (!verified) {
        return res.status(401).json({ message: "Invalid or expired verification code" });
      }

      delete (req.session as any).pendingMfaUserId;

      req.logIn(user, async (loginErr) => {
        if (loginErr) return res.status(500).json({ message: "Login failed" });

        await registerLoginSession(req, user.id, user.role || "merchant");

        if (rememberDevice) {
          const rawToken = crypto.randomBytes(32).toString("hex");
          const hashedToken = hashToken(rawToken);
          const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
          const trustedDeviceName = deviceName || req.headers["user-agent"]?.slice(0, 100) || "Unknown device";
          await authStorage.addTrustedDevice(user.id, {
            token: hashedToken,
            name: trustedDeviceName,
            expiresAt: expiresAt.toISOString(),
          });
          res.cookie("trusted_device_token", rawToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            maxAge: 30 * 24 * 60 * 60 * 1000,
            sameSite: "lax",
          });

          if (isGhlConfigured()) {
            const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "full", timeStyle: "short" });
            sendGhlEmail({
              email: user.email!,
              subject: "New Trusted Device Added – Liberty Bancard",
              body: `<p>Hi ${user.firstName},</p><p>A new device has been added to your list of trusted devices on your Liberty Bancard account.</p><p><strong>Device:</strong> ${trustedDeviceName}<br/><strong>When:</strong> ${timestamp} ET</p><p>If this wasn't you, please contact us immediately at <a href="mailto:security@libertybancard.com">security@libertybancard.com</a> so we can secure your account.</p>${getEmailSignatureHtml("security")}`,
              fromEmail: SECURITY_FROM,
              fromName: "Liberty Bancard Security",
            }).catch(err => console.error("[Auth] Trusted device email error:", err));
          }
        }

        const { passwordHash, totpSecret, ...safeUser } = user;
        return res.json(safeUser);
      });
    } catch (err: any) {
      return serverError(res, err);
    }
  });

  app.post("/api/auth/totp/enroll", isAuthenticated, async (req, res) => {
    const user = req.user as any;
    try {
      const secret = totpGenerateSecret();
      await authStorage.saveTotpSecret(user.id, secret);
      const issuer = "Liberty Bancard";
      const label = encodeURIComponent(`${issuer}:${user.email}`);
      const otpauthUrl = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
      const qrDataUrl = await QRCode.toDataURL(otpauthUrl);
      res.json({ secret, qrDataUrl });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/auth/totp/confirm", isAuthenticated, async (req, res) => {
    const user = req.user as any;
    const { code } = req.body;
    if (!code) return res.status(400).json({ message: "Verification code is required" });

    try {
      const totpData = await authStorage.getTotpData(user.id);
      if (!totpData.secret) return res.status(400).json({ message: "No TOTP secret found. Start enrollment again." });

      const cleanCode = String(code).replace(/\s/g, "");
      let verified = false;
      try {
        const totp = new TOTP();
        verified = totp.verify({ token: cleanCode, secret: totpData.secret });
      } catch {
        verified = false;
      }
      if (!verified) return res.status(401).json({ message: "Invalid code. Please try again." });

      const { plain, hashed } = generateBackupCodes();
      await authStorage.enableTotp(user.id, hashed);

      if (isGhlConfigured()) {
        const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "full", timeStyle: "short" });
        const deviceInfo = req.headers["user-agent"]?.slice(0, 150) || "Unknown device";
        sendGhlEmail({
          email: user.email!,
          subject: "Two-Factor Authentication Enabled – Liberty Bancard",
          body: `<p>Hi ${user.firstName},</p><p>Two-factor authentication (2FA) has been <strong>enabled</strong> on your Liberty Bancard account.</p><p><strong>When:</strong> ${timestamp} ET<br/><strong>Device:</strong> ${deviceInfo}</p><p>If this wasn't you, please contact us immediately at <a href="mailto:security@libertybancard.com">security@libertybancard.com</a> so we can secure your account.</p>${getEmailSignatureHtml("security")}`,
          fromEmail: SECURITY_FROM,
          fromName: "Liberty Bancard Security",
        }).catch(err => console.error("[Auth] 2FA-enabled email error:", err));
      }

      res.json({ success: true, backupCodes: plain });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/auth/totp/disable", isAuthenticated, async (req, res) => {
    const user = req.user as any;
    const { password } = req.body;
    if (!password) return res.status(400).json({ message: "Password is required to disable 2FA" });

    try {
      const fullUser = await authStorage.getUser(user.id);
      if (!fullUser?.passwordHash) return res.status(400).json({ message: "Cannot disable 2FA for this account" });

      const isValid = await bcrypt.compare(password, fullUser.passwordHash);
      if (!isValid) return res.status(401).json({ message: "Incorrect password" });

      await authStorage.disableTotp(user.id);
      res.clearCookie("trusted_device_token");

      if (isGhlConfigured()) {
        const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "full", timeStyle: "short" });
        const deviceInfo = req.headers["user-agent"]?.slice(0, 150) || "Unknown device";
        sendGhlEmail({
          email: user.email!,
          subject: "Two-Factor Authentication Disabled – Liberty Bancard",
          body: `<p>Hi ${fullUser.firstName || user.firstName},</p><p>Two-factor authentication (2FA) has been <strong>disabled</strong> on your Liberty Bancard account.</p><p><strong>When:</strong> ${timestamp} ET<br/><strong>Device:</strong> ${deviceInfo}</p><p>If this wasn't you, please contact us immediately at <a href="mailto:security@libertybancard.com">security@libertybancard.com</a> so we can secure your account.</p>${getEmailSignatureHtml("security")}`,
          fromEmail: SECURITY_FROM,
          fromName: "Liberty Bancard Security",
        }).catch(err => console.error("[Auth] 2FA-disabled email error:", err));
      }

      res.json({ success: true });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/auth/totp/status", isAuthenticated, async (req, res) => {
    const user = req.user as any;
    try {
      const totpData = await authStorage.getTotpData(user.id);
      const devices = await authStorage.getTrustedDevices(user.id);
      const now = new Date();
      const validDevices = devices.filter(d => new Date(d.expiresAt) > now).map(d => ({
        name: d.name,
        expiresAt: d.expiresAt,
      }));
      res.json({
        enabled: totpData.enabled,
        trustedDeviceCount: validDevices.length,
        trustedDevices: validDevices,
        backupCodesRemaining: totpData.backupCodes ? totpData.backupCodes.filter(bc => !bc.used).length : 0,
      });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/auth/totp/regenerate-backup-codes", isAuthenticated, totpRateLimit, async (req, res) => {
    const user = req.user as any;
    const { password } = req.body;
    if (!password) return res.status(400).json({ message: "Password is required to regenerate backup codes" });

    try {
      const fullUser = await authStorage.getUser(user.id);
      if (!fullUser?.passwordHash) return res.status(400).json({ message: "Cannot regenerate backup codes for this account" });

      const isValid = await bcrypt.compare(password, fullUser.passwordHash);
      if (!isValid) return res.status(401).json({ message: "Incorrect password" });

      const totpData = await authStorage.getTotpData(user.id);
      if (!totpData.enabled) return res.status(400).json({ message: "2FA is not enabled on this account" });

      const { plain, hashed } = generateBackupCodes();
      await authStorage.enableTotp(user.id, hashed);

      res.json({ success: true, backupCodes: plain });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.delete("/api/auth/totp/trusted-devices", isAuthenticated, async (req, res) => {
    const user = req.user as any;
    try {
      const { users: usersTable } = await import("@shared/schema");
      const { eq: eqOp } = await import("drizzle-orm");
      await db.update(usersTable).set({ trustedDevices: null, updatedAt: new Date() }).where(eqOp(usersTable.id, user.id));
      res.clearCookie("trusted_device_token");
      res.json({ success: true });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // === CHANGE PASSWORD (authenticated user changing their own password) ===
  app.post("/api/auth/change-password", isAuthenticated, async (req, res) => {
    const user = req.user as any;
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Current and new passwords are required" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: "New password must be at least 6 characters" });
    }
    try {
      const fullUser = await authStorage.getUser(user.id);
      if (!fullUser?.passwordHash) return res.status(400).json({ message: "Cannot change password for this account" });
      const isValid = await bcrypt.compare(currentPassword, fullUser.passwordHash);
      if (!isValid) return res.status(401).json({ message: "Current password is incorrect" });
      const passwordHash = await bcrypt.hash(newPassword, 12);
      await authStorage.updateUserPassword(user.id, passwordHash);
      // Invalidate all other sessions
      const currentSessionId = req.sessionID;
      await authStorage.invalidateAllUserSessions(user.id, currentSessionId);
      res.json({ message: "Password changed successfully. Other sessions have been logged out." });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/auth/signup", signupRateLimit, async (_req, res) => {
    // Public self-registration is disabled for this B2B platform.
    // Merchant accounts are created by admins or via the merchant application flow.
    return res.status(404).json({ message: "Not found" });
  });

  app.post("/api/auth/signup-internal-disabled", signupRateLimit, async (req, res) => {
    try {
      const { email, password, firstName, lastName } = req.body;
      if (!email || !password || !firstName || !lastName) {
        return res.status(400).json({ message: "All fields are required" });
      }
      if (password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      }
      const existing = await authStorage.getUserByEmail(email.toLowerCase());
      if (existing) {
        return res.status(409).json({ message: "An account with this email already exists" });
      }
      const passwordHash = await bcrypt.hash(password, 12);
      const user = await authStorage.upsertUser({
        email: email.toLowerCase(),
        firstName,
        lastName,
        passwordHash,
        role: "merchant",
        authProvider: "local",
      });
      const rawToken = crypto.randomBytes(32).toString("hex");
      const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");
      const verificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await authStorage.updateUserVerificationToken(user.id, hashedToken, verificationExpiresAt);
      const verifyUrl = `${APP_URL}/verify-email?token=${rawToken}`;
      const verifyHtml = buildVerificationEmail(firstName, verifyUrl);
      sendAuthEmail({
        to: email.toLowerCase(),
        subject: "Verify your Liberty Bancard email address",
        html: verifyHtml,
        label: "email-verification",
      }).catch(err => console.error("[Auth] Verification email error:", err));
      req.logIn(user, async (err) => {
        if (err) return res.status(500).json({ message: "Signup succeeded but login failed" });

        await registerLoginSession(req, user.id, user.role || "merchant");

        storage.createNotification({
          channel: "internal",
          recipientId: user.id,
          title: "Welcome to Liberty Bancard!",
          message: "Your account has been created. Visit your Merchant Portal to get started with onboarding.",
          type: "info",
        }).catch(err => console.error("Welcome notification error:", err));

        storage.createAuditLog({
          action: "merchant_signup",
          entityType: "user",
          entityId: 0,
          userId: user.id,
          details: { email: user.email, firstName: user.firstName },
        }).catch(err => console.error("Signup audit error:", err));

        if (isGhlConfigured()) {
          sendGhlEmail({
            email: user.email!,
            subject: "Welcome to Liberty Bancard",
            body: `<p>Hi ${user.firstName},</p><p>Welcome to Liberty Bancard! Your merchant account has been created.</p><p>Next steps:</p><ul><li>Complete your merchant application</li><li>Upload your processing statement for a free savings analysis</li><li>Review your onboarding checklist in the Merchant Portal</li></ul><p>If you have questions, our team is here to help.</p><p>Best regards,<br/>Liberty Bancard Team</p><p style="font-size:11px;color:#888;">This communication is from Liberty Bancard. Eligibility, underwriting, card brand rules, and applicable laws apply.</p>`,
          }).catch(err => console.error("Welcome email error:", err));
        }

        const { passwordHash: _, totpSecret: __, ...safeUser } = user;
        return res.status(201).json(safeUser);
      });
    } catch (error: any) {
      console.error("Signup error:", error);
      return res.status(500).json({ message: "Signup failed" });
    }
  });

  app.get("/api/auth/verify-email", verifyEmailRateLimit, async (req, res) => {
    try {
      const { token } = req.query;
      if (!token || typeof token !== "string") {
        return res.status(400).json({ message: "Verification token is required" });
      }
      const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
      const user = await authStorage.getUserByVerificationToken(hashedToken);
      if (!user) {
        return res.status(400).json({ message: "Invalid or expired verification link" });
      }
      await authStorage.markEmailVerified(user.id);
      return res.json({ message: "Email verified successfully" });
    } catch (error: any) {
      console.error("Email verification error:", error);
      return res.status(500).json({ message: "Something went wrong" });
    }
  });

  app.post("/api/auth/forgot-password", forgotPasswordRateLimit, async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }
      const user = await authStorage.getUserByEmail(email.toLowerCase());
      if (user) {
        const rawToken = crypto.randomBytes(32).toString("hex");
        const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
        await authStorage.updateUserResetToken(email.toLowerCase(), hashedToken, expiresAt);
        const resetUrl = `${APP_URL}/reset-password?token=${rawToken}`;
        const html = buildPasswordResetEmail(user.firstName || "", resetUrl);
        sendAuthEmail({
          to: user.email!,
          subject: "Reset your Liberty Bancard password",
          html,
          label: "password-reset",
        }).catch(err => console.error("[Auth] Password reset email error:", err));
      }
      return res.json({ message: "If an account with that email exists, a reset link has been sent." });
    } catch (error: any) {
      console.error("Forgot password error:", error);
      return res.status(500).json({ message: "Something went wrong" });
    }
  });

  app.post("/api/auth/reset-password", resetPasswordRateLimit, async (req, res) => {
    try {
      const { token, password } = req.body;
      if (!token || !password) {
        return res.status(400).json({ message: "Token and password are required" });
      }
      if (password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      }
      const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
      const user = await authStorage.getUserByResetToken(hashedToken);
      if (!user) {
        return res.status(400).json({ message: "Invalid or expired reset token" });
      }
      const passwordHash = await bcrypt.hash(password, 12);
      await authStorage.updateUserPassword(user.id, passwordHash);
      // Invalidate ALL sessions for this user (password was reset, security event)
      await authStorage.invalidateAllUserSessions(user.id);
      return res.json({ message: "Password has been reset successfully" });
    } catch (error: any) {
      console.error("Reset password error:", error);
      return res.status(500).json({ message: "Something went wrong" });
    }
  });

  app.get("/api/auth/google", (_req, res) => {
    res.redirect("/login?error=Google+sign-in+requires+configuration.+Please+use+email+and+password.");
  });

  app.get("/api/logout", (req, res) => {
    const sessionId = req.sessionID;
    req.logout(() => {
      req.session.destroy(async () => {
        if (sessionId) {
          authStorage.invalidateUserSession(sessionId).catch(() => {});
        }
        res.clearCookie("connect.sid");
        res.clearCookie("trusted_device_token");
        res.redirect("/login");
      });
    });
  });

  app.post("/api/auth/logout", (req, res) => {
    const sessionId = req.sessionID;
    req.logout(() => {
      req.session.destroy(async () => {
        if (sessionId) {
          authStorage.invalidateUserSession(sessionId).catch(() => {});
        }
        res.clearCookie("connect.sid");
        res.clearCookie("trusted_device_token");
        res.json({ message: "Logged out" });
      });
    });
  });

  try {
    await seedAdminUser();
  } catch (err: any) {
    // Log clearly but do not crash the server — the admin may already exist
    // from a prior seed, or will be managed manually. The env vars should be
    // set before the first deployment to ensure the account is created.
    console.error("[Auth] Admin seed error:", err.message);
  }
}

/**
 * A role-aware RequestHandler that carries metadata describing which roles
 * are permitted to invoke it. Exposed so the permissions-audit endpoint can
 * walk the Express router stack and report on it without using `any` casts.
 */
export type RoleAwareRequestHandler = RequestHandler & { _requiredRoles: readonly string[] };

function tagRoles<H extends RequestHandler>(handler: H, roles: readonly string[]): H & { _requiredRoles: readonly string[] } {
  const tagged = handler as H & { _requiredRoles: readonly string[] };
  tagged._requiredRoles = roles;
  return tagged;
}

function getUserRole(req: Parameters<RequestHandler>[0]): string | undefined {
  const user = req.user as { role?: unknown } | undefined;
  return typeof user?.role === "string" ? user.role : undefined;
}

/**
 * Checks session validity (idle timeout, absolute TTL, invalidation).
 * Returns null if valid, or a reason string if the session should be rejected.
 */
async function checkSessionValidity(req: any): Promise<"session_expired" | "session_invalidated" | null> {
  const sessionId = req.sessionID;
  if (!sessionId) return null;

  try {
    const record = await authStorage.getUserSession(sessionId);

    if (!record) {
      // No record yet — create one for backward compatibility (pre-existing sessions)
      const user = req.user as any;
      if (user?.id) {
        const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket?.remoteAddress || undefined;
        const userAgent = req.headers["user-agent"] || undefined;
        await authStorage.createUserSession({ userId: user.id, sessionId, ip, userAgent });
      }
      return null;
    }

    if (record.isInvalidated) {
      return "session_invalidated";
    }

    const now = Date.now();
    const lastActive = record.lastActiveAt ? new Date(record.lastActiveAt).getTime() : 0;
    const createdAt = record.createdAt ? new Date(record.createdAt).getTime() : 0;

    if (now - lastActive > IDLE_TIMEOUT_MS) {
      await authStorage.invalidateUserSession(sessionId);
      return "session_expired";
    }

    if (now - createdAt > ABSOLUTE_TTL_MS) {
      await authStorage.invalidateUserSession(sessionId);
      return "session_expired";
    }

    // Valid — update lastActiveAt in background (no await to avoid blocking requests)
    authStorage.touchUserSession(sessionId).catch(() => {});

    return null;
  } catch (err) {
    console.error("[Auth] Session validity check error:", err);
    // On error, allow through (fail open to avoid breaking the app)
    return null;
  }
}

export const isAuthenticated: RoleAwareRequestHandler = tagRoles<RequestHandler>(async (req, res, next) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Unauthorized", reason: "not_authenticated" });
  }

  const invalidReason = await checkSessionValidity(req);
  if (invalidReason) {
    req.logout(() => {
      req.session?.destroy(() => {
        res.clearCookie("connect.sid");
      });
    });
    return res.status(401).json({
      message: invalidReason === "session_expired"
        ? "Your session has expired. Please log in again."
        : "Your session has been terminated. Please log in again.",
      reason: invalidReason,
    });
  }

  return next();
}, ["any-authenticated"]);

export const isAdmin: RoleAwareRequestHandler = tagRoles<RequestHandler>(async (req, res, next) => {
  if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized", reason: "not_authenticated" });
  const invalidReason = await checkSessionValidity(req);
  if (invalidReason) {
    req.logout(() => req.session?.destroy(() => res.clearCookie("connect.sid")));
    return res.status(401).json({ message: "Session expired. Please log in again.", reason: invalidReason });
  }
  if (getUserRole(req) === "admin") return next();
  return res.status(403).json({ message: "Admin access required" });
}, ["admin"]);

export const isAffiliate: RoleAwareRequestHandler = tagRoles<RequestHandler>(async (req, res, next) => {
  if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized", reason: "not_authenticated" });
  const invalidReason = await checkSessionValidity(req);
  if (invalidReason) {
    req.logout(() => req.session?.destroy(() => res.clearCookie("connect.sid")));
    return res.status(401).json({ message: "Session expired. Please log in again.", reason: invalidReason });
  }
  const role = getUserRole(req);
  if (role === "affiliate" || role === "admin") return next();
  return res.status(403).json({ message: "Affiliate access required" });
}, ["affiliate", "admin"]);

export const isPartnerAuthenticated: RoleAwareRequestHandler = tagRoles<RequestHandler>(async (req, res, next) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Partner authentication required. Please log in to your partner portal.", reason: "not_authenticated" });
  }
  const invalidReason = await checkSessionValidity(req);
  if (invalidReason) {
    req.logout(() => req.session?.destroy(() => res.clearCookie("connect.sid")));
    return res.status(401).json({ message: "Session expired. Please log in again.", reason: invalidReason });
  }
  if (getUserRole(req) === "partner") return next();
  return res.status(401).json({ message: "Partner authentication required. Please log in to your partner portal." });
}, ["partner"]);

export const isDashboardUser: RoleAwareRequestHandler = tagRoles<RequestHandler>(async (req, res, next) => {
  if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized", reason: "not_authenticated" });
  const invalidReason = await checkSessionValidity(req);
  if (invalidReason) {
    req.logout(() => req.session?.destroy(() => res.clearCookie("connect.sid")));
    return res.status(401).json({ message: "Session expired. Please log in again.", reason: invalidReason });
  }
  const role = getUserRole(req);
  if (role === "admin" || role === "manager" || role === "agent") return next();
  return res.status(403).json({ message: "Dashboard access required" });
}, ["admin", "manager", "agent"]);

/**
 * Central role-guard middleware. Returns 401 if not authenticated, 403 if
 * authenticated but role isn't in the allowed set. Tags the handler with
 * _requiredRoles so the permissions-audit endpoint can introspect it without
 * resorting to `any`.
 */
export function requireRole(...roles: string[]): RoleAwareRequestHandler {
  return tagRoles<RequestHandler>(async (req, res, next) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Unauthorized", reason: "not_authenticated" });
    }
    const invalidReason = await checkSessionValidity(req);
    if (invalidReason) {
      req.logout(() => req.session?.destroy(() => res.clearCookie("connect.sid")));
      return res.status(401).json({ message: "Session expired. Please log in again.", reason: invalidReason });
    }
    const role = getUserRole(req);
    if (!role || !roles.includes(role)) {
      return res.status(403).json({ message: `Requires role: ${roles.join(" or ")}` });
    }
    return next();
  }, roles);
}
