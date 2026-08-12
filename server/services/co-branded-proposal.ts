import crypto from "crypto";
import PDFDocument from "pdfkit";
import { db } from "../db";
import { eq, ilike } from "drizzle-orm";
import { storage } from "../storage";
import type { PartnerOrganization, Deal, Contact } from "@shared/schema";
import { contacts } from "@shared/schema";
import { isGhlConfigured, sendGhlEmailForMerchant, upsertGhlContact, sendGhlEmail } from "./ghl";
import { sendSmtpEmail } from "./smtp-email";
import { getEmailSignatureHtml } from "./email-signatures";
import { addNote } from "./sdr/ghl-client";

export interface CoBrandedProposalInput {
  partnerOrgId: number;
  dealId?: number;
  contactId?: number;
  merchantName: string;
  merchantEmail?: string;
  merchantMonthlyVolume?: string;
  merchantEffectiveRate?: string;
  pricingPlan?: string;
  customMessage?: string;
  createdBy?: string;
  proposalData?: any;
}

export function generateProposalToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
    : { r: 37, g: 99, b: 235 };
}

function getLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function getContrastColor(hex: string): string {
  return getLuminance(hex) > 0.5 ? "#1a1a2e" : "#ffffff";
}

function formatCurrency(val: number | string): string {
  const num = typeof val === "string" ? parseFloat(val.replace(/[^0-9.]/g, "")) : val;
  if (isNaN(num)) return "$0";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(num);
}

// ─── Server-side PDF generation via PDFKit ────────────────────────────────────
export async function generateCoBrandedProposalPdf(params: {
  org: PartnerOrganization;
  merchantName: string;
  merchantMonthlyVolume?: string | null;
  merchantEffectiveRate?: string | null;
  pricingPlan?: string | null;
  customMessage?: string | null;
  proposalData?: any;
  token: string;
  baseUrl: string;
}): Promise<Buffer> {
  const { org, merchantName, merchantMonthlyVolume, merchantEffectiveRate, pricingPlan, customMessage, proposalData, token, baseUrl } = params;

  const primaryHex = org.primaryColor || "#2563eb";
  const { r, g, b } = hexToRgb(primaryHex);

  const volume = merchantMonthlyVolume ? parseFloat(merchantMonthlyVolume.replace(/[^0-9.]/g, "")) : 0;
  const effectiveRate = merchantEffectiveRate ? parseFloat(merchantEffectiveRate.replace(/[^0-9.]/g, "")) : 3.0;
  const currentMonthlyFees = volume > 0 ? volume * (effectiveRate / 100) : 0;
  const currentAnnualFees = currentMonthlyFees * 12;

  const plans: any[] = proposalData?.plans || [];
  const recommendedPlanKey = proposalData?.recommendedPlan || pricingPlan;
  const recommendedPlan = plans.find((p: any) => p.shortName === recommendedPlanKey) || plans[0];

  const proposalUrl = `${baseUrl}/co-branded-proposal/${token}`;
  const generatedDate = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 50, info: { Title: `Savings Proposal – ${merchantName}`, Author: org.name } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ── Header band ────────────────────────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, 70).fill(`rgb(${r},${g},${b})`);
    const luminance = getLuminance(primaryHex);
    const headerTextColor = luminance > 0.5 ? "#1a1a2e" : "#ffffff";
    doc.fillColor(headerTextColor).fontSize(20).font("Helvetica-Bold").text(org.name, 50, 22, { width: 350 });
    if (org.tagline) {
      doc.fontSize(9).font("Helvetica").text(org.tagline, 50, 46, { width: 350 });
    }

    // Contact info top-right
    const contactLines: string[] = [];
    if (org.phone) contactLines.push(org.phone);
    if (org.email) contactLines.push(org.email);
    if ((org as any).website) contactLines.push((org as any).website);
    if (contactLines.length > 0) {
      doc.fillColor(headerTextColor).fontSize(8).font("Helvetica")
        .text(contactLines.join("  ·  "), 400, 30, { width: 160, align: "right" });
    }

    // ── Sub-header ─────────────────────────────────────────────────────────────
    doc.moveDown(0).fillColor("#1e293b").fontSize(14).font("Helvetica-Bold")
      .text("MERCHANT SAVINGS PROPOSAL", 50, 85);
    doc.fontSize(9).font("Helvetica").fillColor("#64748b")
      .text(`Prepared for: ${merchantName}   ·   Date: ${generatedDate}`, 50, 103);

    // Divider
    doc.moveTo(50, 120).lineTo(doc.page.width - 50, 120).strokeColor("#e2e8f0").lineWidth(1).stroke();

    let y = 132;

    // ── Custom message ─────────────────────────────────────────────────────────
    if (customMessage) {
      doc.fillColor("#374151").fontSize(10).font("Helvetica").text(customMessage, 50, y, { width: doc.page.width - 100 });
      y += doc.heightOfString(customMessage, { width: doc.page.width - 100 }) + 14;
    }

    // ── Current costs ──────────────────────────────────────────────────────────
    if (volume > 0) {
      doc.fillColor("#1e293b").fontSize(12).font("Helvetica-Bold").text("Current Processing Costs", 50, y);
      y += 18;

      const rows = [
        ["Monthly Processing Volume", formatCurrency(volume)],
        ["Current Effective Rate", `${effectiveRate.toFixed(2)}%`],
        ["Estimated Monthly Fees", formatCurrency(currentMonthlyFees)],
        ["Estimated Annual Fees", formatCurrency(currentAnnualFees)],
      ];

      for (const [label, value] of rows) {
        doc.fillColor("#374151").fontSize(9).font("Helvetica").text(label, 60, y, { width: 260 });
        doc.fillColor("#111827").fontSize(9).font("Helvetica-Bold").text(value, 320, y, { width: 160, align: "right" });
        y += 16;
      }

      y += 8;
      doc.moveTo(50, y).lineTo(doc.page.width - 50, y).strokeColor("#e2e8f0").lineWidth(1).stroke();
      y += 12;
    }

    // ── Plans ──────────────────────────────────────────────────────────────────
    if (plans.length > 0) {
      doc.fillColor("#1e293b").fontSize(12).font("Helvetica-Bold").text("Proposed Pricing Plans", 50, y);
      y += 18;

      for (const plan of plans) {
        const isRec = plan.shortName === recommendedPlanKey;

        // Plan card background
        const cardColor = isRec ? `rgb(${r},${g},${b})` : "#f8fafc";
        const textColor = isRec ? headerTextColor : "#1e293b";
        const subColor = isRec ? (luminance > 0.5 ? "#374151" : "#e2e8f0") : "#64748b";
        const cardH = 72;

        if (y + cardH > doc.page.height - 80) {
          doc.addPage();
          y = 50;
        }

        doc.roundedRect(50, y, doc.page.width - 100, cardH, 5).fill(cardColor);

        if (isRec) {
          doc.fillColor(textColor).fontSize(7).font("Helvetica-Bold")
            .text("★ RECOMMENDED", 55, y + 6, { width: 180 });
        }

        doc.fillColor(textColor).fontSize(11).font("Helvetica-Bold")
          .text(plan.name || plan.shortName, 55, y + (isRec ? 18 : 10), { width: 260 });

        if (plan.description) {
          doc.fillColor(subColor).fontSize(8).font("Helvetica")
            .text(plan.description, 55, y + (isRec ? 31 : 24), { width: 260 });
        }

        // Savings callout
        const savingsMonthly = plan.savingsMonthly ?? (currentMonthlyFees > 0 && plan.effectiveRate
          ? currentMonthlyFees - (volume * (parseFloat(String(plan.effectiveRate).replace(/[^0-9.]/g, "")) / 100))
          : null);
        if (savingsMonthly !== null && savingsMonthly > 0) {
          doc.fillColor(isRec ? (luminance > 0.5 ? "#166534" : "#bbf7d0") : "#16a34a")
            .fontSize(10).font("Helvetica-Bold")
            .text(`Save ${formatCurrency(savingsMonthly)}/mo`, 320, y + 14, { width: 200, align: "right" });
          doc.fillColor(subColor).fontSize(8).font("Helvetica")
            .text(`(${formatCurrency(savingsMonthly * 12)}/yr)`, 320, y + 28, { width: 200, align: "right" });
        } else if (plan.effectiveRate) {
          doc.fillColor(textColor).fontSize(9).font("Helvetica-Bold")
            .text(`Rate: ${plan.effectiveRate}`, 320, y + 14, { width: 200, align: "right" });
        }

        y += cardH + 8;
      }
    } else if (pricingPlan) {
      doc.fillColor("#1e293b").fontSize(12).font("Helvetica-Bold").text("Proposed Plan", 50, y);
      y += 16;
      doc.fillColor("#374151").fontSize(10).font("Helvetica").text(pricingPlan, 60, y);
      y += 20;
    }

    y += 10;

    // ── CTA / Next steps ──────────────────────────────────────────────────────
    if (y + 60 > doc.page.height - 80) { doc.addPage(); y = 50; }
    doc.moveTo(50, y).lineTo(doc.page.width - 50, y).strokeColor("#e2e8f0").lineWidth(1).stroke();
    y += 12;
    doc.fillColor("#1e293b").fontSize(11).font("Helvetica-Bold").text("Ready to Start Saving?", 50, y);
    y += 16;
    doc.fillColor("#374151").fontSize(9).font("Helvetica")
      .text(`View your full interactive proposal online:`, 50, y);
    y += 13;
    doc.fillColor(`rgb(${r},${g},${b})`).fontSize(9).font("Helvetica").text(proposalUrl, 50, y, { link: proposalUrl, underline: true });
    y += 20;

    if (org.contactName || org.phone || org.email) {
      const contactLine = [
        org.contactName ? `Contact: ${org.contactName}` : null,
        org.phone ? org.phone : null,
        org.email ? org.email : null,
      ].filter(Boolean).join("   ·   ");
      doc.fillColor("#64748b").fontSize(8).font("Helvetica").text(contactLine, 50, y);
      y += 16;
    }

    // ── Footer ─────────────────────────────────────────────────────────────────
    const footerY = doc.page.height - 45;
    doc.rect(0, footerY, doc.page.width, 45).fill("#0f172a");
    doc.fillColor("#94a3b8").fontSize(7).font("Helvetica")
      .text("Powered by Liberty Bancard  ·  libertybancard.com  ·  Savings estimates are based on your provided processing information and are not guaranteed.", 50, footerY + 10, {
        width: doc.page.width - 100, align: "center",
      });
    doc.fillColor("#64748b").fontSize(6).font("Helvetica")
      .text("Rates and savings may vary. This proposal is confidential and intended solely for the named merchant.", 50, footerY + 22, {
        width: doc.page.width - 100, align: "center",
      });

    doc.end();
  });
}

export function generateCoBrandedProposalHtml(params: {
  org: PartnerOrganization;
  merchantName: string;
  merchantMonthlyVolume?: string;
  merchantEffectiveRate?: string;
  pricingPlan?: string;
  customMessage?: string;
  proposalData?: any;
  token: string;
  baseUrl: string;
}): string {
  const { org, merchantName, merchantMonthlyVolume, merchantEffectiveRate, pricingPlan, customMessage, proposalData, token, baseUrl } = params;
  const primaryColor = org.primaryColor || "#2563eb";
  const contrastColor = getContrastColor(primaryColor);
  const { r, g, b } = hexToRgb(primaryColor);

  const generatedDate = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const volume = merchantMonthlyVolume
    ? parseFloat(merchantMonthlyVolume.replace(/[^0-9.]/g, ""))
    : 0;
  const effectiveRate = merchantEffectiveRate
    ? parseFloat(merchantEffectiveRate.replace(/[^0-9.]/g, ""))
    : 3.0;
  const currentMonthlyFees = volume > 0 ? volume * (effectiveRate / 100) : 0;
  const currentAnnualFees = currentMonthlyFees * 12;

  const plans = proposalData?.plans || [];
  const recommendedPlanKey = proposalData?.recommendedPlan || pricingPlan;
  const recommendedPlan = plans.find((p: any) => p.shortName === recommendedPlanKey) || plans[0];

  const planNamesMap: Record<string, string> = {
    cashDiscount: "Cash Discount / 0% Processing",
    interchangePlus: "Interchange Plus",
    flatRate: "Flat Rate",
  };
  const planColorsMap: Record<string, string> = {
    cashDiscount: "#059669",
    interchangePlus: "#2563eb",
    flatRate: "#7c3aed",
  };

  const plansHtml = plans.length > 0 ? plans.map((plan: any) => {
    const isRec = plan.shortName === recommendedPlanKey;
    const planColor = planColorsMap[plan.shortName] || primaryColor;
    return `
      <div style="flex:1;min-width:220px;border:${isRec ? `2px solid ${primaryColor}` : "1px solid #e2e8f0"};border-radius:12px;overflow:hidden;background:#fff;${isRec ? `box-shadow:0 4px 20px rgba(${r},${g},${b},0.2);` : ""}">
        ${isRec ? `<div style="background:${primaryColor};color:${contrastColor};text-align:center;padding:8px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">★ Recommended For You</div>` : ""}
        <div style="padding:20px;">
          <div style="font-size:16px;font-weight:700;color:#1e293b;margin-bottom:4px;">${plan.name || planNamesMap[plan.shortName] || plan.shortName}</div>
          <div style="font-size:12px;color:#64748b;font-style:italic;margin-bottom:16px;">"${plan.headline || ""}"</div>
          <div style="background:${planColor}15;border-radius:8px;padding:16px;text-align:center;margin-bottom:16px;">
            <div style="font-size:11px;color:#64748b;margin-bottom:4px;">Your New Effective Rate</div>
            <div style="font-size:32px;font-weight:800;color:${planColor};">${plan.effectiveRate || "—"}</div>
          </div>
          <div style="display:flex;gap:10px;margin-bottom:16px;">
            <div style="flex:1;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:12px;text-align:center;">
              <div style="font-size:10px;color:#64748b;">Monthly Savings</div>
              <div style="font-size:18px;font-weight:700;color:#059669;">${plan.monthlySavings ? formatCurrency(plan.monthlySavings) : "—"}</div>
            </div>
            <div style="flex:1;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:12px;text-align:center;">
              <div style="font-size:10px;color:#64748b;">Annual Savings</div>
              <div style="font-size:18px;font-weight:700;color:#059669;">${plan.annualSavings ? formatCurrency(plan.annualSavings) : "—"}</div>
            </div>
          </div>
          <div style="font-size:12px;color:#475569;margin-bottom:12px;line-height:1.5;">${plan.howItWorks || ""}</div>
          ${plan.pros && plan.pros.length > 0 ? `
            <div style="margin-bottom:10px;">
              <div style="font-size:11px;font-weight:700;color:#1e293b;margin-bottom:6px;">Advantages</div>
              ${plan.pros.map((pro: string) => `<div style="font-size:11px;color:#475569;display:flex;gap:6px;margin-bottom:4px;"><span style="color:#059669;">✓</span>${pro}</div>`).join("")}
            </div>
          ` : ""}
          <div style="border-top:1px solid #f1f5f9;padding-top:10px;">
            <div style="font-size:10px;color:#94a3b8;">Best For</div>
            <div style="font-size:11px;font-weight:600;color:#334155;">${plan.bestFor || ""}</div>
          </div>
        </div>
      </div>`;
  }).join("") : `
    <div style="flex:1;border:2px solid ${primaryColor};border-radius:12px;overflow:hidden;background:#fff;box-shadow:0 4px 20px rgba(${r},${g},${b},0.2);">
      <div style="background:${primaryColor};color:${contrastColor};text-align:center;padding:8px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">★ Recommended Plan</div>
      <div style="padding:20px;">
        <div style="font-size:16px;font-weight:700;color:#1e293b;margin-bottom:16px;">${planNamesMap[pricingPlan || "interchangePlus"] || "Interchange Plus"}</div>
        <div style="font-size:13px;color:#475569;line-height:1.6;">Our team has analyzed your processing profile and will present a custom rate comparison showing your projected savings when you speak with your advisor.</div>
      </div>
    </div>`;

  const trackingPixel = `<img src="${baseUrl}/api/public/co-branded-proposal/${token}/viewed" width="1" height="1" style="display:none;" alt="" />`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Savings Proposal — ${org.name}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; color: #1e293b; }
    @media print {
      body { background: white; }
      .no-print { display: none !important; }
      .page-break { page-break-before: always; }
    }
    @media (max-width: 600px) {
      .plans-grid { flex-direction: column !important; }
    }
  </style>
</head>
<body>
${trackingPixel}

<!-- HEADER: PARTNER BRANDING -->
<div style="background:${primaryColor};color:${contrastColor};padding:32px 40px;">
  <div style="max-width:900px;margin:0 auto;">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;">
      <div style="display:flex;align-items:center;gap:16px;">
        ${org.logoUrl ? `<img src="${org.logoUrl}" alt="${org.name} logo" style="height:48px;width:auto;object-fit:contain;border-radius:6px;background:rgba(255,255,255,0.1);padding:4px;" />` : `<div style="width:48px;height:48px;border-radius:10px;background:rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;">${org.name.charAt(0)}</div>`}
        <div>
          <div style="font-size:22px;font-weight:800;letter-spacing:-0.5px;">${org.name}</div>
          ${org.tagline ? `<div style="font-size:13px;opacity:0.85;margin-top:2px;">${org.tagline}</div>` : ""}
        </div>
      </div>
      <div style="text-align:right;opacity:0.9;font-size:13px;">
        ${org.contactName ? `<div style="font-weight:600;">${org.contactName}</div>` : ""}
        ${org.phone ? `<div>${org.phone}</div>` : ""}
        ${org.email ? `<div>${org.email}</div>` : ""}
      </div>
    </div>
    <div style="margin-top:24px;border-top:1px solid rgba(255,255,255,0.2);padding-top:20px;">
      <div style="font-size:13px;opacity:0.75;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Custom Savings Proposal</div>
      <div style="font-size:28px;font-weight:700;">Prepared for ${merchantName}</div>
      <div style="font-size:13px;opacity:0.75;margin-top:4px;">Generated ${generatedDate}</div>
    </div>
  </div>
</div>

<div style="max-width:900px;margin:0 auto;padding:32px 24px;">

  ${customMessage ? `
  <!-- CUSTOM MESSAGE FROM PARTNER -->
  <div style="background:#fff;border:1px solid #e2e8f0;border-left:4px solid ${primaryColor};border-radius:8px;padding:20px;margin-bottom:28px;">
    <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">A Note From Your Advisor</div>
    <div style="font-size:14px;color:#334155;line-height:1.7;white-space:pre-wrap;">${customMessage}</div>
  </div>
  ` : ""}

  ${volume > 0 ? `
  <!-- CURRENT STATE -->
  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px;margin-bottom:28px;">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:18px;">
      <div style="width:8px;height:8px;border-radius:50%;background:#ef4444;"></div>
      <div style="font-size:16px;font-weight:700;color:#dc2626;">What You're Currently Paying</div>
    </div>
    <div style="display:flex;gap:16px;flex-wrap:wrap;">
      <div style="flex:1;min-width:140px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;text-align:center;">
        <div style="font-size:11px;color:#64748b;margin-bottom:6px;">Monthly Volume</div>
        <div style="font-size:22px;font-weight:700;color:#1e293b;">${formatCurrency(volume)}</div>
      </div>
      <div style="flex:1;min-width:140px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;text-align:center;">
        <div style="font-size:11px;color:#64748b;margin-bottom:6px;">Effective Rate</div>
        <div style="font-size:22px;font-weight:700;color:#dc2626;">${effectiveRate}%</div>
      </div>
      <div style="flex:1;min-width:140px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;text-align:center;">
        <div style="font-size:11px;color:#64748b;margin-bottom:6px;">Monthly Fees</div>
        <div style="font-size:22px;font-weight:700;color:#dc2626;">${formatCurrency(currentMonthlyFees)}</div>
      </div>
      <div style="flex:1;min-width:140px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;text-align:center;">
        <div style="font-size:11px;color:#64748b;margin-bottom:6px;">Annual Fees</div>
        <div style="font-size:22px;font-weight:700;color:#dc2626;">${formatCurrency(currentAnnualFees)}</div>
      </div>
    </div>
    ${proposalData?.currentState?.topIssues?.length > 0 ? `
    <div style="border-top:1px solid #fee2e2;margin-top:16px;padding-top:16px;">
      <div style="font-size:12px;font-weight:700;color:#1e293b;margin-bottom:10px;">Issues Found in Your Statement</div>
      ${proposalData.currentState.topIssues.map((issue: string) => `
        <div style="display:flex;gap:8px;margin-bottom:6px;font-size:12px;color:#475569;"><span style="color:#ef4444;font-size:14px;line-height:1;">✗</span>${issue}</div>
      `).join("")}
    </div>` : ""}
  </div>
  ` : ""}

  <!-- PRICING PLANS -->
  <div style="margin-bottom:28px;">
    <div style="font-size:18px;font-weight:700;color:#1e293b;margin-bottom:6px;">Your Pricing Options</div>
    ${proposalData?.recommendedReason ? `<div style="font-size:13px;color:#64748b;margin-bottom:16px;"><strong>Our recommendation:</strong> ${proposalData.recommendedReason}</div>` : ""}
    <div class="plans-grid" style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;">
      ${plansHtml}
    </div>
  </div>

  <!-- CTA -->
  <div style="background:linear-gradient(135deg, ${primaryColor}, rgba(${r},${g},${b},0.85));color:${contrastColor};border-radius:16px;padding:32px;text-align:center;margin-bottom:28px;">
    <div style="font-size:22px;font-weight:700;margin-bottom:10px;">Ready to Start Saving?</div>
    <div style="font-size:14px;opacity:0.9;margin-bottom:20px;max-width:500px;margin-left:auto;margin-right:auto;">
      Schedule a quick call with your ${org.name} advisor. We'll walk you through your options and answer any questions.
    </div>
    <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">
      ${org.phone ? `<a href="tel:${org.phone.replace(/[^0-9+]/g, "")}" style="display:inline-block;background:rgba(255,255,255,0.2);color:${contrastColor};border:1px solid rgba(255,255,255,0.4);border-radius:8px;padding:12px 24px;text-decoration:none;font-weight:600;font-size:14px;">📞 Call ${org.phone}</a>` : ""}
      ${org.email ? `<a href="mailto:${org.email}" style="display:inline-block;background:rgba(255,255,255,0.2);color:${contrastColor};border:1px solid rgba(255,255,255,0.4);border-radius:8px;padding:12px 24px;text-decoration:none;font-weight:600;font-size:14px;">✉ Email Us</a>` : ""}
      <a href="${baseUrl}/upload-statement" style="display:inline-block;background:rgba(255,255,255,0.95);color:${primaryColor};border-radius:8px;padding:12px 24px;text-decoration:none;font-weight:700;font-size:14px;">Upload Statement for Full Analysis →</a>
    </div>
  </div>

  <!-- COMPLIANCE DISCLAIMER -->
  <div style="font-size:10px;color:#94a3b8;text-align:center;line-height:1.6;padding-bottom:16px;">
    ${proposalData?.complianceDisclaimer || "Eligibility, underwriting, card brand rules, and applicable laws apply. Savings estimates are based on information provided and actual results may vary. This proposal is not a guarantee of rates or approval."}
  </div>

</div>

<!-- FOOTER: POWERED BY LIBERTY BANCARD -->
<div style="background:#0f172a;color:#94a3b8;padding:20px 40px;text-align:center;">
  <div style="max-width:900px;margin:0 auto;">
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Powered by</div>
    <div style="font-size:14px;font-weight:600;color:#e2e8f0;">Liberty Bancard</div>
    <div style="font-size:11px;margin-top:4px;">© ${new Date().getFullYear()} Liberty Bancard. All rights reserved.</div>
  </div>
</div>

</body>
</html>`;
}

/** Find an existing contact by email, or create a new one. Returns the contactId.
 *  Throws if contact cannot be created (so callers can decide whether to propagate). */
async function findOrCreateMerchantContact(params: {
  merchantName: string;
  merchantEmail?: string | null;
  createdBy?: string | null;
}): Promise<number> {
  const { merchantName, merchantEmail, createdBy } = params;

  if (merchantEmail) {
    // Try to find existing contact by email
    const [existing] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.email, merchantEmail.toLowerCase().trim()))
      .limit(1);
    if (existing) return existing.id;
  }

  // Create a new contact record linked to this proposal.
  // contacts.email and contacts.phone are NOT NULL in the schema, so we provide
  // the actual email when available and empty-string placeholders when not.
  const nameParts = merchantName.trim().split(/\s+/);
  const firstName = nameParts[0] || "Merchant";
  const lastName = nameParts.slice(1).join(" ") || "Contact";

  const newContact = await storage.createContact({
    firstName,
    lastName,
    // Use actual email when available; otherwise a unique synthetic placeholder to
    // avoid the partial unique index constraint on contacts.email (active contacts).
    email: merchantEmail?.toLowerCase().trim() || `noemail-${crypto.randomBytes(8).toString("hex")}@partner-proposal.internal`,
    phone: "",
    companyName: merchantName,
    status: "New",
    leadSource: "Partner Proposal",
    notes: `Auto-created from co-branded proposal (created by: ${createdBy || "Partner"})`,
  } as any);

  return newContact.id;
}

export async function createCoBrandedProposal(input: CoBrandedProposalInput) {
  const org = await storage.getPartnerOrg(input.partnerOrgId);
  if (!org) throw new Error("Partner organization not found");

  const token = generateProposalToken();

  let proposalData = input.proposalData;
  if (!proposalData && input.dealId) {
    const deal = await storage.getDeal(input.dealId);
    if (deal?.savingsProposal) {
      proposalData = deal.savingsProposal;
    }
  }

  let resolvedEmail = input.merchantEmail ?? null;
  if (!resolvedEmail && input.contactId) {
    const contact = await storage.getContact(input.contactId);
    resolvedEmail = contact?.email ?? null;
  }

  // ── Enforce merchant contact linkage ────────────────────────────────────────
  // Every proposal MUST be linked to a CRM contact so it appears in the
  // document vault against a real merchant record.  This is non-negotiable:
  // if we cannot find or create a contact, proposal creation is aborted.
  let resolvedContactId = input.contactId ?? null;
  if (!resolvedContactId) {
    // Throws on failure — intentionally propagated to the caller (route returns 500)
    resolvedContactId = await findOrCreateMerchantContact({
      merchantName: input.merchantName,
      merchantEmail: resolvedEmail,
      createdBy: input.createdBy,
    });
  }
  // Resolve email from the linked contact if we still don't have one
  if (!resolvedEmail && resolvedContactId) {
    const linked = await storage.getContact(resolvedContactId);
    resolvedEmail = linked?.email || null;
  }

  const proposal = await storage.createCoBrandedProposal({
    partnerOrgId: input.partnerOrgId,
    dealId: input.dealId ?? null,
    contactId: resolvedContactId,
    token,
    status: "draft",
    pricingPlan: input.pricingPlan ?? null,
    proposalData: proposalData ?? null,
    merchantName: input.merchantName,
    merchantEmail: resolvedEmail,
    merchantMonthlyVolume: input.merchantMonthlyVolume ?? null,
    merchantEffectiveRate: input.merchantEffectiveRate ?? null,
    customMessage: input.customMessage ?? null,
    createdBy: input.createdBy ?? null,
  });

  // Store a record in the document vault so the proposal is accessible from the
  // contact/deal timeline.  Because contact linkage is now enforced above,
  // proposal.contactId will always be set here; the vault write is therefore
  // treated as required and any failure propagates to the caller.
  await storage.createDocument({
    contactId: proposal.contactId ?? null,
    dealId: proposal.dealId ?? null,
    type: "Co-Branded Proposal",
    category: "Proposals",
    fileName: `co-branded-proposal-${proposal.id}-${proposal.token.slice(0, 8)}.pdf`,
    fileSize: null,
    mimeType: "application/pdf",
    uploadedBy: input.createdBy ?? "System",
    storageKey: `co-branded-proposal:${proposal.token}`,
    accessScope: "internal",
  });

  await storage.createAuditLog({
    action: "co_branded_proposal_created",
    entityType: "co_branded_proposal",
    entityId: proposal.id,
    details: {
      partnerOrgId: input.partnerOrgId,
      dealId: input.dealId,
      merchantName: input.merchantName,
      token,
    },
  });

  return proposal;
}

export async function sendCoBrandedProposalEmail(proposalId: number, baseUrl: string): Promise<boolean> {
  const proposal = await storage.getCoBrandedProposal(proposalId);
  if (!proposal) throw new Error("Proposal not found");

  const org = await storage.getPartnerOrg(proposal.partnerOrgId!);
  if (!org) throw new Error("Partner org not found");

  let merchantEmail: string | null = (proposal as any).merchantEmail || null;
  let merchantGhlContactId: string | null = null;
  if (proposal.contactId) {
    const contact = await storage.getContact(proposal.contactId);
    if (!merchantEmail) merchantEmail = contact?.email || null;
    merchantGhlContactId = contact?.ghlContactId || null;
    if (!merchantGhlContactId && contact?.email && isGhlConfigured()) {
      try {
        merchantGhlContactId = await upsertGhlContact({
          firstName: contact.firstName || "",
          lastName: contact.lastName || "",
          email: contact.email,
        } as any);
        if (merchantGhlContactId && contact?.id) {
          await storage.updateContact(contact.id, { ghlContactId: merchantGhlContactId });
          console.log(`[CoBrandedProposal] Upserted GHL contact for contact #${contact.id}`);
        }
      } catch (upsertErr: any) {
        console.warn("[CoBrandedProposal] GHL contact upsert failed:", upsertErr.message);
      }
    }
  }

  if (!merchantEmail) {
    throw new Error("No merchant email found to send proposal to");
  }

  const proposalUrl = `${baseUrl}/co-branded-proposal/${proposal.token}`;

  const subject = `Your Savings Proposal from ${org.name}`;
  const html = `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;max-width:600px;">
  ${org.logoUrl ? `<img src="${org.logoUrl}" alt="${org.name}" style="height:40px;margin-bottom:20px;" />` : `<h2 style="color:#1e293b;">${org.name}</h2>`}
  <p>Hello${proposal.merchantName ? ` ${proposal.merchantName.split(" ")[0]}` : ""},</p>
  <p>Your advisor at <strong>${org.name}</strong> has prepared a custom savings proposal for your payment processing. This analysis shows how much you could save by switching to a better processing program.</p>
  <p style="margin:24px 0;">
    <a href="${proposalUrl}" style="display:inline-block;background:${org.primaryColor || "#2563eb"};color:#ffffff;padding:14px 28px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:700;">View Your Savings Proposal →</a>
  </p>
  <p style="font-size:12px;color:#64748b;">Or copy this link: <a href="${proposalUrl}">${proposalUrl}</a></p>
  ${org.contactName ? `<p>Questions? Reach out to your advisor, <strong>${org.contactName}</strong>${org.phone ? `, at ${org.phone}` : ""}${org.email ? ` or ${org.email}` : ""}.</p>` : ""}
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;" />
  <p style="font-size:11px;color:#94a3b8;">This proposal is powered by Liberty Bancard. ${proposal.merchantName || "Your business"} information is kept confidential.</p>
${getEmailSignatureHtml("accounts")}
</div>`;

  let sent = false;
  let sentChannel = "none";

  if (isGhlConfigured() && proposal.contactId && proposal.dealId && merchantGhlContactId) {
    try {
      const ghlDirectResult = await sendGhlEmail({ contactId: proposal.contactId, dealId: proposal.dealId, subject, body: html, fromEmail: "accounts@libertybancard.com", fromName: "Your Liberty Bancard Account Team" });
      if (ghlDirectResult.success) {
        sent = true;
        sentChannel = "ghl_direct";
      } else {
        console.warn(`[CoBrandedProposal] GHL direct email returned failure: ${ghlDirectResult.error}`);
      }
    } catch (err) {
      console.error("[CoBrandedProposal] GHL direct email failed, trying GHL by-email:", err);
    }
  }

  if (!sent && isGhlConfigured() && merchantEmail) {
    try {
      const ghlEmailResult = await sendGhlEmailForMerchant({ email: merchantEmail, subject, body: html, fromEmail: "accounts@libertybancard.com", fromName: "Your Liberty Bancard Account Team", contactId: proposal.contactId ?? undefined });
      if (ghlEmailResult.success) {
        sent = true;
        sentChannel = "ghl_email";
      } else {
        console.warn(`[CoBrandedProposal] GHL by-email returned failure: ${ghlEmailResult.error}`);
      }
    } catch (err) {
      console.error("[CoBrandedProposal] GHL by-email failed, trying SMTP:", err);
    }
  }

  if (!sent) {
    try {
      const smtpResult = await sendSmtpEmail({ to: merchantEmail!, subject, html, category: "accounts", contactId: proposal.contactId ?? undefined });
      if (smtpResult.success) {
        sent = true;
        sentChannel = "SMTP-Fallback";
      } else {
        console.error(`[CoBrandedProposal] SMTP-Fallback failed for proposal #${proposalId}: ${smtpResult.error}`);
      }
    } catch (err) {
      console.error(`[CoBrandedProposal] SMTP-Fallback threw for proposal #${proposalId}:`, err);
    }
  }

  if (sent) {
    console.log(`[CoBrandedProposal] Proposal delivered via ${sentChannel} for proposal #${proposalId}`);
  }

  if (sent) {
    await storage.updateCoBrandedProposal(proposalId, {
      status: "sent",
      deliveredAt: new Date(),
    });

    if (proposal.contactId) {
      const contact = await storage.getContact(proposal.contactId);
      if (contact && contact.ghlContactId) {
        try {
          await addNote({
            contactId: contact.ghlContactId,
            body: `Sent co-branded savings proposal: ${proposalUrl}`
          });
        } catch (err) {
          console.error("[CoBrandedProposal] addNote failed:", err);
        }
      }
    }

    if (proposal.dealId) {
      await storage.createAuditLog({
        action: "co_branded_proposal_sent",
        entityType: "deal",
        entityId: proposal.dealId,
        details: { proposalId, merchantEmail, partnerOrgId: proposal.partnerOrgId, channel: sentChannel },
      });
    }
  }

  return sent;
}

export async function trackProposalView(token: string): Promise<void> {
  const proposal = await storage.getCoBrandedProposalByToken(token);
  if (!proposal) return;

  const updates: any = {
    viewCount: (proposal.viewCount || 0) + 1,
  };

  if (!proposal.viewedAt) {
    updates.viewedAt = new Date();
    updates.status = "viewed";

    if (proposal.dealId) {
      await storage.createAuditLog({
        action: "co_branded_proposal_viewed",
        entityType: "deal",
        entityId: proposal.dealId,
        details: { proposalId: proposal.id, token },
      });
    }
  }

  await storage.updateCoBrandedProposal(proposal.id, updates);
}
