import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import connectPg from "connect-pg-simple";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { authStorage } from "./storage";
import { storage } from "../../storage";
import { isGhlConfigured, sendGhlEmailForMerchant as sendGhlEmail } from "../../services/ghl";

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000;
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: sessionTtl,
    },
  });
}

// Role system:
// - admin: full access to all dashboard features
// - manager: can view all dashboard features + manage agents
// - agent: can view their own pipeline, contacts, and tasks
// - merchant: can only access the merchant portal

async function seedAdminUser() {
  const adminEmail = "scott@libertybancard.com";
  const existing = await authStorage.getUserByEmail(adminEmail);
  if (!existing) {
    const passwordHash = await bcrypt.hash("miami33137!", 12);
    await authStorage.upsertUser({
      email: adminEmail,
      firstName: "Scott",
      lastName: "Stevenson",
      passwordHash,
      role: "admin",
      authProvider: "local",
    });
    console.log("[Auth] Admin user seeded: scott@libertybancard.com");
  }
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

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

  app.post("/api/auth/login", (req, res, next) => {
    passport.authenticate("local", (err: any, user: any, info: any) => {
      if (err) return res.status(500).json({ message: "Server error" });
      if (!user) return res.status(401).json({ message: info?.message || "Invalid credentials" });
      req.logIn(user, (loginErr) => {
        if (loginErr) return res.status(500).json({ message: "Login failed" });
        const { passwordHash, ...safeUser } = user;
        return res.json(safeUser);
      });
    })(req, res, next);
  });

  app.post("/api/auth/signup", async (req, res) => {
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
      console.log("[Auth] Email verification URL: /verify-email?token=" + rawToken);
      req.logIn(user, (err) => {
        if (err) return res.status(500).json({ message: "Signup succeeded but login failed" });

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

        const { passwordHash: _, ...safeUser } = user;
        return res.status(201).json(safeUser);
      });
    } catch (error: any) {
      console.error("Signup error:", error);
      return res.status(500).json({ message: "Signup failed" });
    }
  });

  app.get("/api/auth/verify-email", async (req, res) => {
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

  app.post("/api/auth/forgot-password", async (req, res) => {
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
        console.log("[Auth] Password reset URL: /reset-password?token=" + rawToken);
      }
      return res.json({ message: "If an account with that email exists, a reset link has been sent." });
    } catch (error: any) {
      console.error("Forgot password error:", error);
      return res.status(500).json({ message: "Something went wrong" });
    }
  });

  app.post("/api/auth/reset-password", async (req, res) => {
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
    req.logout(() => {
      req.session.destroy(() => {
        res.clearCookie("connect.sid");
        res.redirect("/login");
      });
    });
  });

  app.post("/api/auth/logout", (req, res) => {
    req.logout(() => {
      req.session.destroy(() => {
        res.clearCookie("connect.sid");
        res.json({ message: "Logged out" });
      });
    });
  });

  await seedAdminUser();
}

export const isAuthenticated: RequestHandler = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  return res.status(401).json({ message: "Unauthorized" });
};

export const isAdmin: RequestHandler = (req, res, next) => {
  if (req.isAuthenticated() && (req.user as any)?.role === 'admin') {
    return next();
  }
  return res.status(403).json({ message: "Admin access required" });
};

export const isDashboardUser: RequestHandler = (req, res, next) => {
  if (req.isAuthenticated()) {
    const role = (req.user as any)?.role;
    if (role === 'admin' || role === 'manager' || role === 'agent') {
      return next();
    }
  }
  return res.status(403).json({ message: "Dashboard access required" });
};
