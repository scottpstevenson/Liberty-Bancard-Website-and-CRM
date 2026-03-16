import type { Express } from "express";
import { isAuthenticated } from "../replit_integrations/auth";
import { storage } from "../storage";
import { z } from "zod";
import { insertPartnerSchema, insertReferralSchema } from "@shared/schema";
import type { InsertPartner } from "@shared/schema";
import { parse } from "csv-parse/sync";
import path from "path";

export function registerPartnersRoutes(app: Express) {
  // === PARTNERS ===
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
    if ((req.user as any)?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    try {
      const input = insertPartnerSchema.parse(req.body);
      const partner = await storage.createPartner(input);
      res.status(201).json(partner);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/partners/:id", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    try {
      const { status, commissionPercent, notes } = req.body;
      const updates: Partial<InsertPartner> = {};
      if (status && ["active", "pending", "suspended", "inactive"].includes(status)) updates.status = status;
      if (commissionPercent !== undefined) updates.commissionPercent = Math.min(Math.max(0, Number(commissionPercent) || 0), 100);
      if (notes !== undefined) updates.notes = String(notes).slice(0, 2000);
      const updated = await storage.updatePartner(Number(req.params.id), updates);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
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
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
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

}
