import type { Express } from "express";
import { isAuthenticated } from "../replit_integrations/auth";
import { storage } from "../storage";
import { z } from "zod";
import { randomBytes } from "crypto";
import { publicLeadRateLimit } from "../middleware/public-rate-limit";

function generateReferralCode(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}

export function registerLifecycleRoutes(app: Express) {

  // ── NPS Admin: stats endpoint MUST be registered BEFORE /:token to avoid token match ──
  app.get("/api/nps/stats", isAuthenticated, async (req, res) => {
    try {
      const stats = await storage.getNpsStats();
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── NPS Survey (public — accessed via token) ────────────────────────────────
  app.get("/api/nps/:token", publicLeadRateLimit, async (req, res) => {
    try {
      const survey = await storage.getNpsResponseByToken(req.params.token);
      if (!survey) return res.status(404).json({ message: "Survey not found or expired" });
      if (survey.submittedAt) return res.json({ status: "already_submitted", dayTrigger: survey.dayTrigger });
      res.json({ status: "pending", dayTrigger: survey.dayTrigger, token: survey.token });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/nps/:token/submit", publicLeadRateLimit, async (req, res) => {
    try {
      const survey = await storage.getNpsResponseByToken(req.params.token);
      if (!survey) return res.status(404).json({ message: "Survey not found" });
      if (survey.submittedAt) return res.status(409).json({ message: "Survey already submitted" });

      const { score, comment } = req.body;
      if (typeof score !== "number" || score < 0 || score > 10) {
        return res.status(400).json({ message: "Score must be 0–10" });
      }

      const updated = await storage.updateNpsResponse(survey.id, {
        score,
        comment: comment || null,
        submittedAt: new Date(),
      });

      // Detractor (0-6) → create health alert
      if (score <= 6 && !survey.healthAlertCreated && survey.contactId) {
        try {
          await storage.createHealthAlert({
            contactId: survey.contactId,
            dealId: survey.dealId || undefined,
            alertType: "volume_decline",
            severity: score <= 3 ? "critical" : "warning",
            title: `NPS Detractor: Day ${survey.dayTrigger} Score ${score}/10`,
            description: `Merchant submitted a Day-${survey.dayTrigger} NPS score of ${score}. Follow up required.${comment ? ` Comment: "${comment}"` : ""}`,
            metric: "nps_score",
            currentValue: String(score),
            threshold: "7",
            status: "active",
          });
          await storage.updateNpsResponse(survey.id, { healthAlertCreated: true });
        } catch (alertErr) {
          console.error("NPS health alert creation error:", alertErr);
        }
      }

      // Promoter (9-10) → queue review request
      if (score >= 9 && !survey.reviewRequestQueued) {
        try {
          await storage.createReviewRequest({
            contactId: survey.contactId || undefined,
            dealId: survey.dealId || undefined,
            channel: "email",
            status: "queued",
            npsResponseId: survey.id,
          });
          await storage.updateNpsResponse(survey.id, { reviewRequestQueued: true });
        } catch (reviewErr) {
          console.error("NPS review request queue error:", reviewErr);
        }
      }

      res.json({ status: "submitted", score, isPromoter: score >= 9, isDetractor: score <= 6 });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── NPS Admin Endpoints ─────────────────────────────────────────────────────
  app.get("/api/nps", isAuthenticated, async (req, res) => {
    try {
      const responses = await storage.getNpsResponses();
      res.json(responses);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/nps", isAuthenticated, async (req, res) => {
    try {
      const token = randomBytes(16).toString("hex");
      const { contactId, dealId, merchantProfileId, dayTrigger } = req.body;
      if (!dayTrigger || ![30, 90].includes(Number(dayTrigger))) {
        return res.status(400).json({ message: "dayTrigger must be 30 or 90" });
      }
      const survey = await storage.createNpsResponse({
        token,
        contactId: contactId || null,
        dealId: dealId || null,
        merchantProfileId: merchantProfileId || null,
        dayTrigger: Number(dayTrigger),
        emailSentAt: new Date(),
      });
      res.status(201).json(survey);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ── Review Collection ────────────────────────────────────────────────────────
  app.get("/api/review-requests", isAuthenticated, async (req, res) => {
    try {
      const dealId = req.query.dealId ? Number(req.query.dealId) : undefined;
      const requests = await storage.getReviewRequests(dealId);
      res.json(requests);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/review-requests/stats", isAuthenticated, async (req, res) => {
    try {
      const all = await storage.getReviewRequests();
      const sent = all.filter(r => r.sentAt).length;
      const googleClicked = all.filter(r => (r as any).googleClickedAt).length;
      const trustpilotClicked = all.filter(r => (r as any).trustpilotClickedAt).length;
      res.json({ total: all.length, sent, googleClicked, trustpilotClicked });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/review-requests/:id/track-click", publicLeadRateLimit, async (req, res) => {
    try {
      const { platform } = req.body;
      const id = Number(req.params.id);
      const updateData: Record<string, any> = {};
      if (platform === "google") updateData.googleClickedAt = new Date();
      if (platform === "trustpilot") updateData.trustpilotClickedAt = new Date();
      await storage.updateReviewRequest(id, updateData);
      res.json({ tracked: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/review-requests/:id", isAuthenticated, async (req, res) => {
    try {
      const updated = await storage.updateReviewRequest(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ── Merchant Referrals ───────────────────────────────────────────────────────
  app.get("/api/merchant-referrals", isAuthenticated, async (req, res) => {
    try {
      const profileId = req.query.profileId ? Number(req.query.profileId) : undefined;
      const referrals = await storage.getMerchantReferrals(profileId);
      res.json(referrals);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/merchant-referrals", publicLeadRateLimit, async (req, res) => {
    try {
      const { referralCode, referredEmail, referredName, referredCompany } = req.body;
      if (!referralCode || !referredEmail) {
        return res.status(400).json({ message: "referralCode and referredEmail required" });
      }
      const [emailUser, emailDomain] = referredEmail.split("@");
      if (!emailDomain) return res.status(400).json({ message: "Invalid email" });

      const profiles = await storage.getMerchantProfiles();
      const referrer = profiles.find(p => p.referralCode === referralCode);
      if (!referrer) return res.status(404).json({ message: "Invalid referral code" });

      const referral = await storage.createMerchantReferral({
        referrerProfileId: referrer.id,
        referredEmail,
        referredName: referredName || null,
        referredCompany: referredCompany || null,
        referralCode,
        status: "pending",
        creditAmount: "50",
      });

      res.status(201).json(referral);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/merchant-referrals/:id", isAuthenticated, async (req, res) => {
    try {
      const updated = await storage.updateMerchantReferral(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });

      // If activating, credit the referrer
      if (req.body.status === "activated" && updated.referrerProfileId) {
        const profile = await storage.getMerchantProfile(updated.referrerProfileId);
        if (profile) {
          const currentCredits = parseFloat(profile.referralCredits || "0");
          const creditAmt = parseFloat(updated.creditAmount || "50");
          await storage.updateMerchantProfile(profile.id, {
            referralCredits: String(currentCredits + creditAmt),
            referralCount: (profile.referralCount || 0) + 1,
          });
          await storage.updateMerchantReferral(updated.id, { status: "credited", creditPaidAt: new Date() });
        }
      }

      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // Generate/refresh referral code for a merchant profile
  app.post("/api/merchant-portal/referral-code", isAuthenticated, async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ message: "Not authenticated" });
      const profile = await storage.getMerchantProfileByUser(userId);
      if (!profile) return res.status(404).json({ message: "No merchant profile found" });

      if (profile.referralCode) {
        return res.json({ referralCode: profile.referralCode });
      }

      let code = generateReferralCode();
      const profiles = await storage.getMerchantProfiles();
      while (profiles.some(p => p.referralCode === code)) {
        code = generateReferralCode();
      }

      const updated = await storage.updateMerchantProfile(profile.id, { referralCode: code });
      res.json({ referralCode: updated?.referralCode });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/merchant-portal/referrals", isAuthenticated, async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ message: "Not authenticated" });
      const profile = await storage.getMerchantProfileByUser(userId);
      if (!profile) return res.status(404).json({ message: "No merchant profile found" });
      const referrals = await storage.getMerchantReferrals(profile.id);
      res.json({ profile: { referralCode: profile.referralCode, referralCredits: profile.referralCredits, referralCount: profile.referralCount }, referrals });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Retention Campaign Configs ───────────────────────────────────────────────
  app.get("/api/retention-campaign-configs", isAuthenticated, async (req, res) => {
    try {
      const configs = await storage.getRetentionCampaignConfigs();
      res.json(configs);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/retention-campaign-configs", isAuthenticated, async (req, res) => {
    try {
      const { alertType, campaignName, enabled, suggestedMessage, taskPriority, taskDueDays } = req.body;
      if (!alertType || !campaignName) {
        return res.status(400).json({ message: "alertType and campaignName required" });
      }
      const config = await storage.createRetentionCampaignConfig({
        alertType,
        campaignName,
        enabled: enabled !== false,
        suggestedMessage: suggestedMessage || null,
        taskPriority: taskPriority || "high",
        taskDueDays: taskDueDays || 1,
      });
      res.status(201).json(config);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/retention-campaign-configs/:id", isAuthenticated, async (req, res) => {
    try {
      const updated = await storage.updateRetentionCampaignConfig(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/retention-campaign-configs/:id", isAuthenticated, async (req, res) => {
    try {
      const deleted = await storage.deleteRetentionCampaignConfig(Number(req.params.id));
      if (!deleted) return res.status(404).json({ message: "Not found" });
      res.json({ deleted: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
