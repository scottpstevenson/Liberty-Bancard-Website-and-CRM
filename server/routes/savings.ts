import type { Express } from "express";
import { isAuthenticated, requireRole } from "../replit_integrations/auth";
import { storage } from "../storage";
import crypto from "crypto";
import { db } from "../db";
import { deals, contacts, partners } from "@shared/schema";
import { eq } from "drizzle-orm";

function getBaseUrl(req: any): string {
  const replitDomain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  return process.env.APP_URL ||
    (replitDomain ? `https://${replitDomain}` : `${req.protocol}://${req.get("host")}`);
}

export function registerSavingsRoutes(app: Express) {
  app.post(
    "/api/deals/:id/generate-share-link",
    isAuthenticated,
    requireRole("admin", "manager"),
    async (req, res) => {
      try {
        const dealId = Number(req.params.id);
        const deal = await storage.getDeal(dealId);
        if (!deal) return res.status(404).json({ message: "Deal not found" });

        const proposal = deal.savingsProposal as any;
        if (!proposal) {
          return res.status(400).json({ message: "No savings proposal found. Generate a proposal first." });
        }

        const token = crypto.randomBytes(32).toString("hex");

        const recommended = proposal.plans?.find((p: any) => p.shortName === proposal.recommendedPlan) || proposal.plans?.[0];
        const current = proposal.currentState;

        const shareData = {
          merchantName: proposal.merchantName || "Your Business",
          generatedAt: new Date().toISOString(),
          dealId,
          current: {
            effectiveRate: current?.effectiveRate ?? "N/A",
            monthlyFees: current?.monthlyFees ?? 0,
          },
          liberty: {
            effectiveRate: recommended?.effectiveRate ?? "N/A",
            monthlyFees: (current?.monthlyFees ?? 0) - (recommended?.monthlySavings ?? 0),
          },
          monthlySavings: recommended?.monthlySavings ?? 0,
          annualSavings: recommended?.annualSavings ?? 0,
          threeYearSavings: (recommended?.annualSavings ?? 0) * 3,
          savingsPercent: recommended?.savingsPercent ?? 0,
          recommendedPlan: recommended?.name ?? "",
        };

        await storage.updateDeal(dealId, {
          shareToken: token,
          shareData: shareData as any,
        } as any);

        const baseUrl = getBaseUrl(req);
        const shareUrl = `${baseUrl}/savings/${token}`;

        res.json({ token, shareUrl });
      } catch (err: any) {
        console.error("generate-share-link error:", err);
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.get("/api/savings/:token", async (req, res) => {
    try {
      const token = req.params.token;
      if (!token || token.length !== 64) {
        return res.status(400).json({ message: "Invalid token" });
      }

      const [deal] = await db.select().from(deals).where(eq(deals.shareToken, token));
      if (!deal) return res.status(404).json({ message: "Results page not found" });

      const shareData = deal.shareData as any;
      if (!shareData) return res.status(404).json({ message: "Results page not found" });

      let affiliateCode: string | null = null;
      if (deal.contactId) {
        const [contact] = await db.select().from(contacts).where(eq(contacts.id, deal.contactId));
        if (contact?.email) {
          const [partner] = await db.select().from(partners).where(eq(partners.email, contact.email.toLowerCase()));
          if (partner?.affiliateCode && partner.status === "approved") {
            affiliateCode = partner.affiliateCode;
          }
        }
      }

      const replitDomain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
      const baseUrl = process.env.APP_URL ||
        (replitDomain ? `https://${replitDomain}` : `${req.protocol}://${req.get("host")}`);

      const referralLink = affiliateCode
        ? `${baseUrl}/upload-statement?ref=${affiliateCode}`
        : `${baseUrl}/upload-statement`;

      res.json({
        ...shareData,
        affiliateCode,
        referralLink,
        shareUrl: `${baseUrl}/savings/${token}`,
      });
    } catch (err: any) {
      console.error("savings token lookup error:", err);
      res.status(500).json({ message: err.message });
    }
  });
}
