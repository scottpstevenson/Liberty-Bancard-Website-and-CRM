import type { Express } from "express";
import { isAuthenticated, requireRole } from "../replit_integrations/auth";
import { parseId } from "./helpers";
import { storage } from "../storage";
import crypto from "crypto";
import { db } from "../db";
import { deals, contacts, partners } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { sendSmtpEmail, isSmtpConfigured } from "../services/smtp-email";
import { getEmailSignatureHtml } from "../services/email-signatures";

function getBaseUrl(req: any): string {
  const replitDomain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  return process.env.APP_URL ||
    (replitDomain ? `https://${replitDomain}` : `${req.protocol}://${req.get("host")}`);
}

function buildShareLinkEmailHtml(params: {
  firstName: string;
  companyName: string;
  shareUrl: string;
  merchantName: string;
  currentEffectiveRate: string;
  currentMonthlyFees: number;
  monthlySavings: number;
  annualSavings: number;
  recommendedPlan: string;
  savingsPercent: number;
  complianceDisclaimer?: string;
}): string {
  const {
    firstName, companyName, shareUrl, merchantName,
    currentEffectiveRate, currentMonthlyFees,
    monthlySavings, annualSavings, recommendedPlan,
    savingsPercent, complianceDisclaimer,
  } = params;

  const greeting = firstName || companyName || merchantName || "there";
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

  return `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
<div style="background: #0f172a; padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
  <h1 style="color: #ffffff; font-size: 24px; margin: 0;">Liberty Bancard</h1>
  <p style="color: #94a3b8; margin: 8px 0 0;">Your Personalized Savings Results</p>
</div>

<div style="padding: 30px; background: #ffffff; border: 1px solid #e2e8f0;">
  <p style="font-size: 16px; color: #1e293b;">Hi ${greeting},</p>

  <p style="font-size: 15px; color: #475569; line-height: 1.6;">
    We've completed a detailed review of your processing statement and prepared a personalized savings breakdown just for you. Here's a quick summary:
  </p>

  <div style="background: #fef2f2; border-left: 4px solid #ef4444; padding: 16px; margin: 20px 0; border-radius: 4px;">
    <p style="font-size: 14px; color: #991b1b; margin: 0; font-weight: 600;">Current Effective Rate: ${currentEffectiveRate}</p>
    <p style="font-size: 14px; color: #991b1b; margin: 4px 0 0;">Current Monthly Processing Fees: ${fmt(currentMonthlyFees)}</p>
  </div>

  <div style="background: #f0fdf4; border-left: 4px solid #22c55e; padding: 16px; margin: 20px 0; border-radius: 4px;">
    <p style="font-size: 14px; color: #166534; margin: 0; font-weight: 600;">
      With ${recommendedPlan}: Save ${fmt(monthlySavings)}/month (${savingsPercent}% less)
    </p>
    <p style="font-size: 14px; color: #166534; margin: 4px 0 0;">
      That's ${fmt(annualSavings)} back in your pocket every year.
    </p>
  </div>

  <div style="text-align: center; margin: 30px 0;">
    <a href="${shareUrl}" style="display: inline-block; background: #0ea5e9; color: #ffffff; padding: 14px 32px; font-size: 16px; font-weight: 600; text-decoration: none; border-radius: 6px;">
      View My Full Savings Breakdown
    </a>
  </div>

  <p style="font-size: 14px; color: #64748b; line-height: 1.5;">
    Your results page includes a side-by-side comparison of all available pricing plans, a full fee analysis, and your projected savings over 1, 2, and 3 years.
  </p>

  <div style="border-top: 1px solid #e2e8f0; margin-top: 24px; padding-top: 16px;">
    <p style="font-size: 14px; color: #475569; margin: 0;">
      <strong>Ready to discuss?</strong> Schedule a free 10-minute walkthrough call:
    </p>
    <p style="font-size: 14px; color: #475569; margin: 4px 0;">
      📞 <a href="tel:9542668214" style="color: #0ea5e9;">954-266-8214</a> |
      📧 <a href="mailto:scott@libertybancard.com" style="color: #0ea5e9;">scott@libertybancard.com</a>
    </p>
  </div>
</div>

<div style="padding: 16px 30px; background: #f8fafc; border-radius: 0 0 8px 8px; border: 1px solid #e2e8f0; border-top: none;">
  <p style="font-size: 11px; color: #94a3b8; margin: 0; line-height: 1.5;">
    ${complianceDisclaimer || "Eligibility, underwriting, card brand rules, and applicable laws apply. Savings estimates are based on the statement data provided. Actual results may vary. Liberty Bancard is a registered ISO of Evolent/Merrick Bank."}
  </p>
</div>
</div>`;
}

async function generateShareTokenForDeal(dealId: number, req: any): Promise<{ token: string; shareUrl: string; shareData: any }> {
  const deal = await storage.getDeal(dealId);
  if (!deal) throw new Error("Deal not found");

  const proposal = deal.savingsProposal as any;
  if (!proposal) throw new Error("No savings proposal found. Generate a proposal first.");

  const token = crypto.randomBytes(32).toString("hex");
  const recommended = proposal.plans?.find((p: any) => p.shortName === proposal.recommendedPlan) || proposal.plans?.[0];
  const current = proposal.currentState;

  const shareData = {
    merchantName: proposal.merchantName || "Your Business",
    generatedAt: new Date().toISOString(),
    dealId,
    monthlyVolume: current?.monthlyVolume ?? 0,
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
    complianceDisclaimer: proposal.complianceDisclaimer,
  };

  await storage.updateDeal(dealId, {
    shareToken: token,
    shareData: shareData as any,
  } as any);

  const baseUrl = getBaseUrl(req);
  const shareUrl = `${baseUrl}/savings/${token}`;

  return { token, shareUrl, shareData };
}

export function registerSavingsRoutes(app: Express) {
  app.post(
    "/api/deals/:id/generate-share-link",
    isAuthenticated,
    requireRole("admin", "manager"),
    async (req, res) => {
      try {
        const dealId = parseId(req.params.id);
        if (dealId === null) return res.status(404).json({ message: "Deal not found" });
        const { token, shareUrl } = await generateShareTokenForDeal(dealId, req);
        res.json({ token, shareUrl });
      } catch (err: any) {
        console.error("generate-share-link error:", err);
        res.status(err.message === "Deal not found" ? 404 : 400).json({ message: err.message });
      }
    }
  );

  app.post(
    "/api/deals/:id/email-share-link",
    isAuthenticated,
    requireRole("admin", "manager"),
    async (req, res) => {
      try {
        const dealId = parseId(req.params.id);
        if (dealId === null) return res.status(404).json({ message: "Deal not found" });
        const deal = await storage.getDeal(dealId);
        if (!deal) return res.status(404).json({ message: "Deal not found" });

        if (!deal.savingsProposal) {
          return res.status(400).json({ message: "No savings proposal found. Generate a proposal first." });
        }

        const contact = deal.contactId ? await storage.getContact(deal.contactId) : null;
        if (!contact?.email) {
          return res.status(400).json({ message: "No email address on file for this contact. Add an email and try again." });
        }

        const { shareUrl, shareData } = await generateShareTokenForDeal(dealId, req);
        const proposal = deal.savingsProposal as any;

        const subject = `Your Savings Results Are Ready — ${shareData.merchantName}`;
        const html = buildShareLinkEmailHtml({
          firstName: contact.firstName || "",
          companyName: contact.companyName || "",
          shareUrl,
          merchantName: shareData.merchantName,
          currentEffectiveRate: shareData.current?.effectiveRate ?? "N/A",
          currentMonthlyFees: shareData.current?.monthlyFees ?? 0,
          monthlySavings: shareData.monthlySavings ?? 0,
          annualSavings: shareData.annualSavings ?? 0,
          recommendedPlan: shareData.recommendedPlan || "our recommended plan",
          savingsPercent: shareData.savingsPercent ?? 0,
          complianceDisclaimer: proposal.complianceDisclaimer,
        }) + getEmailSignatureHtml("accounts");

        let emailSent = false;
        let deliveryMethod = "none";

        const { isGhlConfigured, sendGhlEmail } = await import("../services/ghl");
        if (isGhlConfigured()) {
          try {
            const result = await sendGhlEmail({
              contactId: contact.id,
              dealId,
              subject,
              body: html,
              fromEmail: "accounts@libertybancard.com",
              fromName: "Your Liberty Bancard Account Team",
            });
            if (result.success) {
              emailSent = true;
              deliveryMethod = "ghl";
            }
          } catch (ghlErr: any) {
            console.warn("[savings] GHL email failed, trying SMTP:", ghlErr.message);
          }
        }

        if (!emailSent && isSmtpConfigured()) {
          const result = await sendSmtpEmail({ to: contact.email, subject, html, category: "accounts" });
          if (result.success) {
            emailSent = true;
            deliveryMethod = "smtp";
          }
        }

        if (!emailSent) {
          await storage.createAuditLog({
            action: "savings_share_link_email_failed",
            entityType: "deal",
            entityId: dealId,
            details: {
              email: contact.email,
              shareUrl,
              reason: "No email delivery provider configured (GHL or SMTP required)",
            },
          });
          return res.status(500).json({ message: "Email delivery failed. Configure GHL or SMTP to send emails." });
        }

        await storage.createAuditLog({
          action: "savings_share_link_emailed",
          entityType: "deal",
          entityId: dealId,
          details: {
            email: contact.email,
            shareUrl,
            deliveryMethod,
          },
        });

        console.log(`[savings] Share link emailed to ${contact.email} for deal ${dealId} via ${deliveryMethod}`);
        res.json({ success: true, email: contact.email, shareUrl, deliveryMethod });
      } catch (err: any) {
        console.error("email-share-link error:", err);
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

      await db
        .update(deals)
        .set({
          shareViewCount: sql`COALESCE(share_view_count, 0) + 1`,
          shareLastViewedAt: new Date(),
        })
        .where(eq(deals.shareToken, token));

      let affiliateCode: string | null = null;
      let contactEmail: string | null = null;
      if (deal.contactId) {
        const [contact] = await db.select().from(contacts).where(eq(contacts.id, deal.contactId));
        if (contact?.email) {
          contactEmail = contact.email;
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
        contactEmail,
        referralLink,
        shareUrl: `${baseUrl}/savings/${token}`,
      });
    } catch (err: any) {
      console.error("savings token lookup error:", err);
      res.status(500).json({ message: err.message });
    }
  });
}
