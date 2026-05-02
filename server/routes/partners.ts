import type { Express } from "express";
import { isAuthenticated, isAffiliate } from "../replit_integrations/auth";
import { storage } from "../storage";
import { authStorage } from "../replit_integrations/auth/storage";
import { db } from "../db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { insertPartnerSchema, insertReferralSchema } from "@shared/schema";
import type { InsertPartner } from "@shared/schema";
import bcrypt from "bcryptjs";
import { createContactGhlFirst } from "../services/contact-writer";
import { syncFormSubmissionToGhl, syncAffiliateSignupToGhl } from "../services/ghl-form-sync";
import { sendPartnerWelcomeEmail } from "../services/partner-welcome";

export function registerPartnersRoutes(app: Express) {
  // === PARTNERS (admin) ===
  app.get("/api/partners", isAuthenticated, async (req, res) => {
    try {
      const partnersList = await storage.getPartners();
      res.json(partnersList);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/partners/:id", isAuthenticated, async (req, res) => {
    try {
      const partner = await storage.getPartner(Number(req.params.id));
      if (!partner) return res.status(404).json({ message: "Not found" });
      res.json(partner);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/partners", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== "admin") return res.status(403).json({ message: "Admin only" });
    try {
      const input = insertPartnerSchema.parse(req.body);
      const partner = await storage.createPartner(input);
      res.status(201).json(partner);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join(".") });
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/partners/:id", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== "admin") return res.status(403).json({ message: "Admin only" });
    try {
      const { status, commissionPercent, notes } = req.body;
      const updates: Partial<InsertPartner> = {};
      if (status && ["active", "pending", "suspended", "inactive"].includes(status)) updates.status = status;
      if (commissionPercent !== undefined) updates.commissionPercent = Math.min(Math.max(0, Number(commissionPercent) || 0), 100);
      if (notes !== undefined) updates.notes = String(notes).slice(0, 2000);

      const partnerId = Number(req.params.id);
      const existing = await storage.getPartner(partnerId);
      if (!existing) return res.status(404).json({ message: "Not found" });

      const updated = await storage.updatePartner(partnerId, updates);
      if (!updated) return res.status(404).json({ message: "Not found" });

      if (updates.status === "active" && existing.status !== "active") {
        sendPartnerWelcomeEmail(updated).catch(err =>
          console.error(`[Partners] Welcome email error for partner #${partnerId}:`, err)
        );
      }

      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // === PUBLIC ISO/PARTNER APPLICATION ===
  app.post("/api/partner-apply", async (req, res) => {
    try {
      const {
        firstName, lastName, email, phone, companyName,
        numberOfClients, referralType, password,
      } = req.body;

      if (!firstName || typeof firstName !== "string" || firstName.length > 100) {
        return res.status(400).json({ message: "Valid first name is required." });
      }
      if (!email || typeof email !== "string" || !email.includes("@") || email.length > 200) {
        return res.status(400).json({ message: "Valid email is required." });
      }
      if (!phone || typeof phone !== "string" || phone.length > 30) {
        return res.status(400).json({ message: "Valid phone number is required." });
      }
      if (!password || typeof password !== "string" || password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters." });
      }

      const existing = await storage.getPartnerByEmail(email.toLowerCase());
      if (existing) {
        return res.status(409).json({ message: "A partner account with this email already exists." });
      }

      const existingAuthUser = await authStorage.getUserByEmail(email.toLowerCase());
      if (existingAuthUser && existingAuthUser.role !== "partner") {
        return res.status(409).json({ message: "An account with this email already exists. Please use a different email address." });
      }

      let code = "";
      for (let attempt = 0; attempt < 5; attempt++) {
        const prefix = (firstName.slice(0, 3) + (lastName?.slice(0, 3) || "") + Math.random().toString(36).slice(2, 6)).toLowerCase().replace(/[^a-z0-9]/g, "");
        const dup = await storage.getPartnerByCode(prefix);
        if (!dup) { code = prefix; break; }
      }

      const passwordHash = await bcrypt.hash(password, 12);

      const partnerTypeMap: Record<string, string> = {
        iso: "iso_agent",
        referral: "referral",
        "white-label": "strategic",
        cpa: "referral",
        bookkeeper: "referral",
        consultant: "referral",
      };
      const mappedType = partnerTypeMap[referralType] || "referral";

      const notesText = [
        numberOfClients ? `Number of clients: ${numberOfClients}` : "",
        referralType ? `Referral type: ${referralType}` : "",
      ].filter(Boolean).join(" | ");

      const partner = await storage.createPartner({
        companyName: (companyName || `${firstName} ${lastName || ""}`.trim()).slice(0, 200),
        contactName: `${firstName} ${lastName || ""}`.trim().slice(0, 200),
        email: email.toLowerCase().slice(0, 200),
        phone: phone.slice(0, 30),
        passwordHash,
        partnerType: mappedType,
        affiliateCode: code,
        status: "pending",
        commissionPercent: mappedType === "iso_agent" ? 50 : 10,
        notes: notesText || null,
      });

      if (existingAuthUser) {
        await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.email, email.toLowerCase()));
      } else {
        await authStorage.upsertUser({
          email: email.toLowerCase(),
          firstName,
          lastName: lastName || "",
          passwordHash,
          role: "partner",
          authProvider: "local",
        });
      }

      createContactGhlFirst({
        firstName,
        lastName: lastName || "",
        email: email.toLowerCase(),
        phone,
        companyName: companyName || undefined,
        status: "Active",
        tags: ["src_website", "iso_partner_application", mappedType],
      }).then(partnerContact => {
        if (partnerContact) {
          syncFormSubmissionToGhl({
            contactId: partnerContact.id,
            leadSource: "iso_partner",
            formData: {
              lb_referral_code: partner.affiliateCode || "",
              partner_type: referralType || mappedType,
              number_of_clients: numberOfClients || "",
            },
          }).catch(err => console.error("GHL partner sync error:", err));
        }
      }).catch(err => console.error("GHL partner contact error:", err));

      syncAffiliateSignupToGhl({
        firstName,
        lastName: lastName || "",
        email,
        phone,
        companyName: companyName || undefined,
        affiliateCode: partner.affiliateCode || code,
      }).catch(err => console.error("GHL partner affiliate sync error:", err));

      return res.status(201).json({
        message: "Application submitted! We will review and contact you within 1 business day.",
        affiliateCode: partner.affiliateCode,
        partnerType: mappedType,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === PARTNER PORTAL AUTH ===
  app.post("/api/partner/login", async (req, res) => {
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
      req.logIn(user, (loginErr) => {
        if (loginErr) return res.status(500).json({ message: "Login failed." });
        return res.json({
          affiliateCode: partner.affiliateCode,
          name: partner.contactName,
          email: partner.email,
          status: partner.status,
          partnerType: partner.partnerType,
        });
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/partner/session", async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ message: "Not authenticated" });
      const user = req.user as any;
      if (user.role !== "partner" && user.role !== "iso_agent" && user.role !== "admin") {
        return res.status(403).json({ message: "Not a partner account." });
      }
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
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/partner/logout", (req, res) => {
    req.logout(() => {
      req.session.destroy(() => {
        res.clearCookie("connect.sid");
        res.json({ message: "Logged out" });
      });
    });
  });

  // === PARTNER DASHBOARD DATA ===
  app.get("/api/partner/dashboard/:code", async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ message: "Please log in." });
      const user = req.user as any;

      const partner = await storage.getPartnerByCode(req.params.code as string);
      if (!partner) return res.status(404).json({ message: "Partner not found." });

      if (user.role !== "admin" && partner.email !== user.email) {
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
      const referralLink = `${baseUrl}?ref=${partner.affiliateCode}`;

      res.json({
        partner: {
          name: partner.contactName,
          code: partner.affiliateCode,
          email: partner.email,
          status: partner.status,
          partnerType: partner.partnerType,
          commissionPercent: partner.commissionPercent,
        },
        kpis: {
          totalMerchants: convertedReferrals.length,
          totalReferrals: referralsList.length,
          commissionMTD,
          totalCommissionLifetime,
          nextPaymentDate: nextPaymentDate.toISOString(),
          pendingReferrals: referralsList.filter(r => r.status === "pending" || r.status === "contacted").length,
        },
        merchants: merchantList,
        referralLink,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === REFERRALS ===
  app.get("/api/referrals", isAuthenticated, async (req, res) => {
    try {
      const partnerId = req.query.partnerId ? Number(req.query.partnerId) : undefined;
      const referralsList = partnerId ? await storage.getReferralsByPartner(partnerId) : await storage.getReferrals();
      res.json(referralsList);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/referrals", isAuthenticated, async (req, res) => {
    try {
      const input = insertReferralSchema.parse(req.body);
      const referral = await storage.createReferral(input);
      res.status(201).json(referral);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join(".") });
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/referrals/:id", isAuthenticated, async (req, res) => {
    try {
      const updated = await storage.updateReferral(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // === COMMISSION TIERS ===
  app.get("/api/commission-tiers", isAuthenticated, async (_req, res) => {
    try {
      const tiers = await storage.getCommissionTiers();
      res.json(tiers);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/commission-tiers", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== "admin") return res.status(403).json({ message: "Admin only" });
    try {
      const tier = await storage.createCommissionTier(req.body);
      res.status(201).json(tier);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/commission-tiers/:id", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== "admin") return res.status(403).json({ message: "Admin only" });
    try {
      await storage.deleteCommissionTier(Number(req.params.id));
      res.json({ message: "Deleted" });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });
}
