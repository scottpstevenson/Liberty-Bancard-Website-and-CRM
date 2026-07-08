import { storage } from "../storage";
import { generateUnsubscribeToken } from "./unsubscribe-token";
import type { FollowUpSequence } from "@shared/schema";

export interface EmailSignature {
  name: string;
  title: string;
  phone: string;
  email: string;
  calendlyLink?: string;
  refCode?: string;
}

export interface PromoOffer {
  headline: string;
  description: string;
  expiry?: string;
}

const BASE_URL = "https://libertybancard.com";
const QUIZ_PATH = "/free-analysis";
const SHOP_PATH = "/shop";

const DEFAULT_PROMO: PromoOffer = {
  headline: "Free Terminal with Signup",
  description: "Sign up this month and receive a free Clover terminal — no hidden fees, no long-term contract.",
};

const DEFAULT_SIGNATURES: Record<string, EmailSignature> = {
  sales: {
    name: "Scott Stevenson",
    title: "Business Development",
    phone: "954-266-8214",
    email: "scott@libertybancard.com",
    calendlyLink: "https://api.leadconnectorhq.com/widget/booking/liberty-bancard",
  },
  support: {
    name: "Liberty Bancard Support",
    title: "Merchant Support",
    phone: "954-266-8214",
    email: "support@libertybancard.com",
  },
  onboarding: {
    name: "Scott Stevenson",
    title: "New Merchant Activation",
    phone: "954-266-8214",
    email: "scott@libertybancard.com",
  },
};

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function buildLink(path: string, refCode?: string): string {
  const url = `${BASE_URL}${path}`;
  if (refCode) return `${url}?ref=${encodeURIComponent(refCode)}`;
  return url;
}

export function getCurrentPromo(): PromoOffer {
  return DEFAULT_PROMO;
}

export function getEmailSignatureHtml(
  type: "sales" | "support" | "onboarding" = "sales",
  customSig?: Partial<EmailSignature>,
  promo?: PromoOffer | null,
): string {
  const sig = { ...DEFAULT_SIGNATURES[type], ...customSig };
  const activePromo = promo === null ? null : promo || DEFAULT_PROMO;
  const name = escapeHtml(sig.name);
  const title = escapeHtml(sig.title);
  const phone = escapeHtml(sig.phone);
  const email = escapeHtml(sig.email);
  const link = sig.calendlyLink ? escapeHtml(sig.calendlyLink) : "";
  const quizUrl = escapeHtml(buildLink(QUIZ_PATH, sig.refCode));
  const shopUrl = escapeHtml(buildLink(SHOP_PATH, sig.refCode));

  const promoLine = activePromo
    ? `<tr><td style="padding-top:8px;font-size:12px;color:#1e3a5f;"><strong>P.S.</strong> ${escapeHtml(activePromo.headline)} — ${escapeHtml(activePromo.description)}</td></tr>`
    : "";

  const appUrl = process.env.APP_URL;
  let logoBlock = "";
  if (appUrl) {
    const logoUrl = escapeHtml(`${appUrl}/logo-blue.png`);
    logoBlock = `<img src="${logoUrl}" alt="Liberty Bancard" width="200" style="max-width:200px;height:auto;display:block;margin-bottom:8px;border:none;outline:none;text-decoration:none;" />\n`;
  } else {
    console.warn("[email-signatures] APP_URL is not set — logo omitted from email signature");
  }

  return `
<br/><br/>
${logoBlock}<table style="font-family:Arial,sans-serif;font-size:13px;color:#333;border-collapse:collapse;">
  <tr>
    <td style="border-left:3px solid #1e3a5f;padding-left:12px;">
      <strong style="font-size:14px;color:#1e3a5f;">${name}</strong><br/>
      <span style="color:#666;">${title} | Liberty Bancard</span><br/>
      <span style="color:#666;">${phone} | ${email}</span><br/>
      ${link ? `<a href="${link}" style="color:#1e3a5f;text-decoration:none;">Schedule a Free Statement Review</a><br/>` : ""}
      <a href="${shopUrl}" style="color:#1e3a5f;text-decoration:none;">Browse Terminals &amp; Equipment</a><br/>
      <span style="font-size:11px;color:#999;margin-top:4px;display:inline-block;">Eligibility, underwriting, card brand rules, and applicable laws apply.</span>
    </td>
  </tr>
  <tr>
    <td style="padding-top:10px;">
      <a href="${quizUrl}" style="display:inline-block;background-color:#1e3a5f;color:#ffffff;padding:10px 20px;border-radius:4px;text-decoration:none;font-size:13px;font-weight:bold;">Get Your Free Savings Analysis</a>
    </td>
  </tr>
  ${promoLine}
</table>`;
}

export function getEmailSignaturePlainText(
  type: "sales" | "support" | "onboarding" = "sales",
  customSig?: Partial<EmailSignature>,
  promo?: PromoOffer | null,
): string {
  const sig = { ...DEFAULT_SIGNATURES[type], ...customSig };
  const activePromo = promo === null ? null : promo || DEFAULT_PROMO;
  const quizUrl = buildLink(QUIZ_PATH, sig.refCode);
  const shopUrl = buildLink(SHOP_PATH, sig.refCode);

  let text = `\n\nLiberty Bancard — https://libertybancard.com\n--\n${sig.name}\n${sig.title} | Liberty Bancard\n${sig.phone} | ${sig.email}`;
  if (sig.calendlyLink) text += `\nSchedule a Review: ${sig.calendlyLink}`;
  text += `\n\nGet Your Free Savings Analysis: ${quizUrl}`;
  text += `\nBrowse Terminals & Equipment: ${shopUrl}`;
  if (activePromo) text += `\n\nP.S. ${activePromo.headline} — ${activePromo.description}`;
  text += `\nEligibility, underwriting, card brand rules, and applicable laws apply.`;
  return text;
}

const TRANSACTIONAL_FAMILIES = new Set([
  "closed_won",
  "closed-won-onboarding",
  "onboarding_step",
  "merchant_welcome",
  "no_show",
  "no-show-recovery",
  "booked-appointment",
  "support",
  "ticket",
]);

const TRANSACTIONAL_TRIGGER_TYPES = new Set([
  "deal_stage_changed",
  "merchant_approved",
  "application_submitted",
  "onboarding_complete",
  "ticket_created",
  "support_submitted",
]);

export function isColdOutreachSequence(sequence: Pick<FollowUpSequence, "sequenceFamily" | "triggerType">): boolean {
  const family = sequence.sequenceFamily ?? "";
  const trigger = sequence.triggerType ?? "";

  if (family === "cold-email-manual-call" || family === "cold_email_manual_call") return true;
  if (trigger === "contact_created" || trigger === "form_submitted") return true;

  if (TRANSACTIONAL_FAMILIES.has(family)) return false;
  if (TRANSACTIONAL_TRIGGER_TYPES.has(trigger)) return false;

  return true;
}

export function getComplianceFooterHtml(contactId: number, mailingAddress: string, baseUrl: string): string {
  const token = generateUnsubscribeToken(contactId);
  const unsubscribeUrl = `${baseUrl}/unsubscribe?t=${encodeURIComponent(token)}`;
  const safeAddress = escapeHtml(mailingAddress);
  const safeUrl = escapeHtml(unsubscribeUrl);

  return `
<br/>
<table style="font-family:Arial,sans-serif;font-size:11px;color:#999;border-collapse:collapse;margin-top:16px;border-top:1px solid #eee;padding-top:12px;" width="100%">
  <tr>
    <td style="padding-top:10px;font-size:11px;color:#999;line-height:1.5;">
      Liberty Bancard | ${safeAddress}<br/>
      You are receiving this email because you expressed interest in merchant payment processing services.<br/>
      To opt out of future marketing emails, <a href="${safeUrl}" style="color:#999;text-decoration:underline;">click here to unsubscribe</a>.
    </td>
  </tr>
</table>`;
}

export async function getStoredSignature(type: string): Promise<EmailSignature> {
  const stored = await storage.getSystemSetting(`email_signature_${type}`);
  if (stored) return { ...DEFAULT_SIGNATURES[type] || DEFAULT_SIGNATURES.sales, ...stored };
  return DEFAULT_SIGNATURES[type] || DEFAULT_SIGNATURES.sales;
}

export async function saveSignature(type: string, sig: Partial<EmailSignature>): Promise<void> {
  await storage.setSystemSetting(`email_signature_${type}`, sig);
}
