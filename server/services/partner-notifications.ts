/**
 * Partner Notifications Service
 *
 * Handles two automation flows:
 * 1. Go-live notification — fires when a deal reaches "Closed Won" and the deal/contact has a
 *    linked partner referral. Sends the referring partner a "Your referral went live!" email
 *    and marks the referral as converted.
 * 2. Monthly residuals digest — aggregates each active partner's live merchants and their
 *    residual earnings for the month, then sends a per-partner summary email.
 */

import { db } from "../db";
import { deals, referrals, partners, merchantResiduals, contacts } from "@shared/schema";
import { eq, and, isNotNull, inArray, sql } from "drizzle-orm";
import { sendSmtpEmail, isSmtpConfigured } from "./smtp-email";
import { getEmailSignatureHtml } from "./email-signatures";
import { storage } from "../storage";

// ─── helpers ───────────────────────────────────────────────────────────────

function getBaseUrl(): string {
  const replitDomain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  return (
    process.env.APP_URL ||
    (replitDomain ? `https://${replitDomain}` : "https://libertybancard.com")
  );
}

function fmtCurrency(value: string | number | null | undefined): string {
  const num = typeof value === "number" ? value : parseFloat(String(value ?? "0"));
  if (isNaN(num)) return "$0.00";
  return num.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function currentMonthLabel(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// ─── 1. Go-live notification ────────────────────────────────────────────────

interface DealContext {
  id: number;
  contactId: number | null;
  referredBy?: string | null;
  partnerOrgId?: number | null;
  owner?: string | null;
}

/**
 * Called when a deal transitions to "Closed Won".
 * Finds any partner linked via the referrals table (by dealId or contactId) and sends
 * a "Your referral went live!" email. Also marks the referral record as "converted".
 *
 * Fails silently (console.error) so the deal stage update itself is never blocked.
 */
export async function notifyPartnerMerchantWentLive(deal: DealContext): Promise<void> {
  try {
    // 1. Find referral record linked to this deal or contact
    const referralRows = await db
      .select()
      .from(referrals)
      .where(
        deal.contactId
          ? sql`(${referrals.dealId} = ${deal.id} OR ${referrals.contactId} = ${deal.contactId})`
          : eq(referrals.dealId, deal.id),
      )
      .limit(5);

    if (referralRows.length === 0) {
      // No linked referral — nothing to notify
      return;
    }

    // 2. Load the contact for merchant name
    const contact = deal.contactId ? await storage.getContact(deal.contactId) : null;
    const merchantName =
      contact?.companyName ||
      (contact ? `${contact.firstName} ${contact.lastName}`.trim() : null) ||
      `Deal #${deal.id}`;

    // 3. Estimate first-month residual from estimatedResidual on the contact
    const estimatedResidual = contact?.estimatedResidual ?? null;

    // Deduplicate by partnerId so we only send one email per partner even if there are
    // multiple referral rows pointing at the same partner.
    const notifiedPartnerIds = new Set<number>();

    for (const referral of referralRows) {
      if (!referral.partnerId) continue;
      if (notifiedPartnerIds.has(referral.partnerId)) continue;

      const partner = await storage.getPartner(referral.partnerId);
      if (!partner || !partner.email) continue;

      notifiedPartnerIds.add(referral.partnerId);

      // Send email
      await sendPartnerGoLiveEmail(partner, merchantName, estimatedResidual, deal.id);

      // Mark referral as converted (idempotent)
      if (referral.status !== "converted" && referral.status !== "paid") {
        await storage.updateReferral(referral.id, {
          status: "converted",
          convertedAt: new Date(),
        } as any);
      }

      // Audit log
      await storage.createAuditLog({
        action: "partner_go_live_notification_sent",
        entityType: "deal",
        entityId: deal.id,
        details: {
          partnerId: partner.id,
          partnerEmail: partner.email,
          referralId: referral.id,
          merchantName,
        },
      });

      console.log(
        `[PartnerNotifications] Go-live email sent to partner #${partner.id} (${partner.email}) for deal #${deal.id} — merchant: ${merchantName}`,
      );
    }
  } catch (err: any) {
    console.error(
      `[PartnerNotifications] Failed to send go-live notification for deal #${deal.id}:`,
      err.message,
    );
  }
}

async function sendPartnerGoLiveEmail(
  partner: Awaited<ReturnType<typeof storage.getPartner>>,
  merchantName: string,
  estimatedResidual: string | null,
  dealId: number,
): Promise<void> {
  if (!partner || !partner.email) return;

  if (!isSmtpConfigured()) {
    console.warn(
      `[PartnerNotifications] SMTP not configured — skipping go-live email for partner #${partner.id}`,
    );
    return;
  }

  const firstName = (partner.contactName || "").split(" ")[0] || "Partner";
  const portalUrl = `${getBaseUrl()}/partner-portal`;
  const commissionPercent = partner.commissionPercent ?? 10;
  const signature = getEmailSignatureHtml("partners", undefined, null);

  const residualNote = estimatedResidual
    ? `<p>Based on this merchant's estimated processing volume, your first-month residual commission is approximately <strong>${fmtCurrency(estimatedResidual)}</strong> — and it compounds every month they process.</p>`
    : `<p>Once this merchant begins processing, you'll start earning residual commissions at your ${commissionPercent}% rate each month.</p>`;

  const html = `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;max-width:600px;">
  <p>Hi ${firstName},</p>

  <p>Great news — <strong>${merchantName}</strong>, a merchant you referred, has just gone live with Liberty Bancard! 🎉</p>

  <p>They're now actively processing payments and your residual commission clock has started.</p>

  ${residualNote}

  <p><strong>What happens next:</strong></p>
  <ul>
    <li>Commissions accrue monthly as the merchant processes</li>
    <li>You'll receive a monthly earnings summary by email</li>
    <li>Payouts are processed on the 1st of each month via your preferred payment method</li>
  </ul>

  <p>
    <a href="${portalUrl}"
       style="display:inline-block;background-color:#1e3a5f;color:#ffffff;padding:10px 20px;border-radius:4px;text-decoration:none;font-size:13px;font-weight:bold;">
      View Your Partner Portal &rarr;
    </a>
  </p>

  <p>Thank you for growing with us. Keep referring and keep earning!</p>

  ${signature}
</div>
`;

  const result = await sendSmtpEmail({
    to: partner.email,
    subject: `🎉 Your referral ${merchantName} just went live — you're earning!`,
    html,
    category: "partners",
  });

  if (!result.success) {
    console.error(
      `[PartnerNotifications] Go-live email failed for partner #${partner.id}: ${result.error}`,
    );
  }
}

// ─── 2. Monthly residuals digest ─────────────────────────────────────────────

/**
 * Sends a monthly residuals summary email to every active partner who has at least one
 * live merchant with residual data for the current month.
 *
 * Called by the PARTNER_MONTHLY_DIGEST BullMQ queue on the 1st of each month.
 */
export async function sendMonthlyPartnerResidualsSummary(): Promise<{
  processed: number;
  sent: number;
  skipped: number;
  errors: number;
}> {
  const month = currentMonthLabel();
  console.log(`[PartnerNotifications] Running monthly residuals digest for ${month}`);

  const stats = { processed: 0, sent: 0, skipped: 0, errors: 0 };

  try {
    // Fetch all active partners
    const allPartners = await storage.getPartners();
    const activePartners = allPartners.filter(p => p.status === "active" && p.email);

    if (activePartners.length === 0) {
      console.log("[PartnerNotifications] No active partners with emails — digest skipped");
      return stats;
    }

    // Fetch residuals for the month in one query; we'll group by deal partnerOrgId
    // and also by referral.partnerId via deals.
    // Strategy: for each partner, get their referral deal IDs, then look up residuals for those deals.
    const allResidualsThisMonth = await storage.getMerchantResidualsByMonth(month);

    for (const partner of activePartners) {
      stats.processed++;
      try {
        // Find deals referred by this partner
        const partnerReferrals = await storage.getReferralsByPartner(partner.id);
        const dealIds = partnerReferrals
          .map(r => r.dealId)
          .filter((id): id is number => id !== null && id !== undefined);

        // Filter residuals for this partner's deals
        const partnerResiduals = allResidualsThisMonth.filter(
          r => r.dealId !== null && dealIds.includes(r.dealId as number),
        );

        if (partnerResiduals.length === 0) {
          stats.skipped++;
          continue;
        }

        // Compute totals
        const totalPartnerCommission = partnerResiduals.reduce(
          (sum, r) => sum + parseFloat(r.partnerCommission || "0"),
          0,
        );

        await sendMonthlyDigestEmail(partner, month, partnerResiduals, totalPartnerCommission);
        stats.sent++;

        await storage.createAuditLog({
          action: "partner_monthly_digest_sent",
          entityType: "partner",
          entityId: partner.id,
          details: {
            month,
            merchantCount: partnerResiduals.length,
            totalPartnerCommission,
            partnerEmail: partner.email,
          },
        });
      } catch (partnerErr: any) {
        stats.errors++;
        console.error(
          `[PartnerNotifications] Monthly digest error for partner #${partner.id}: ${partnerErr.message}`,
        );
      }
    }
  } catch (err: any) {
    console.error("[PartnerNotifications] Monthly digest fatal error:", err.message);
    stats.errors++;
  }

  console.log(
    `[PartnerNotifications] Monthly digest complete — processed=${stats.processed} sent=${stats.sent} skipped=${stats.skipped} errors=${stats.errors}`,
  );
  return stats;
}

async function sendMonthlyDigestEmail(
  partner: Awaited<ReturnType<typeof storage.getPartner>>,
  month: string,
  residuals: Awaited<ReturnType<typeof storage.getMerchantResidualsByMonth>>,
  totalCommission: number,
): Promise<void> {
  if (!partner || !partner.email) return;

  if (!isSmtpConfigured()) {
    console.warn(
      `[PartnerNotifications] SMTP not configured — skipping monthly digest for partner #${partner.id}`,
    );
    return;
  }

  const firstName = (partner.contactName || "").split(" ")[0] || "Partner";
  const [year, monthNum] = month.split("-");
  const monthLabel = new Date(
    parseInt(year, 10),
    parseInt(monthNum, 10) - 1,
    1,
  ).toLocaleString("en-US", { month: "long", year: "numeric" });

  const portalUrl = `${getBaseUrl()}/partner-portal`;
  const signature = getEmailSignatureHtml("partners", undefined, null);

  const rows = residuals
    .map(r => {
      const commission = parseFloat(r.partnerCommission || "0");
      const volume = parseFloat(r.volume || "0");
      return `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${r.merchantName || r.merchantMid || "—"}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${fmtCurrency(volume)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600;color:#1e3a5f;">${fmtCurrency(commission)}</td>
        </tr>`;
    })
    .join("");

  const html = `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;max-width:640px;">
  <p>Hi ${firstName},</p>

  <p>Here's your <strong>${monthLabel}</strong> residuals summary — a recap of your live merchants and the commissions you've earned this month.</p>

  <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px;">
    <thead>
      <tr style="background:#1e3a5f;color:#fff;">
        <th style="padding:10px 12px;text-align:left;">Merchant</th>
        <th style="padding:10px 12px;text-align:right;">Processing Volume</th>
        <th style="padding:10px 12px;text-align:right;">Your Commission</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
    <tfoot>
      <tr style="background:#f3f4f6;">
        <td colspan="2" style="padding:10px 12px;font-weight:700;">Total Earnings — ${monthLabel}</td>
        <td style="padding:10px 12px;text-align:right;font-weight:700;color:#1e3a5f;">${fmtCurrency(totalCommission)}</td>
      </tr>
    </tfoot>
  </table>

  <p>Commissions are paid out on the 1st of next month. Keep referring merchants to grow your passive income!</p>

  <p>
    <a href="${portalUrl}"
       style="display:inline-block;background-color:#1e3a5f;color:#ffffff;padding:10px 20px;border-radius:4px;text-decoration:none;font-size:13px;font-weight:bold;">
      View Your Full Dashboard &rarr;
    </a>
  </p>

  ${signature}
</div>
`;

  const result = await sendSmtpEmail({
    to: partner.email,
    subject: `Your ${monthLabel} residuals summary — ${fmtCurrency(totalCommission)} earned`,
    html,
    category: "partners",
  });

  if (!result.success) {
    console.error(
      `[PartnerNotifications] Monthly digest email failed for partner #${partner.id}: ${result.error}`,
    );
  }
}
