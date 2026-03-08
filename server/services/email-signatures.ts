import { storage } from "../storage";

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
const SHOP_PATH = "/terminals";

const DEFAULT_PROMO: PromoOffer = {
  headline: "Free Terminal with Signup",
  description: "Sign up this month and receive a free Clover terminal — no hidden fees, no long-term contract.",
};

const DEFAULT_SIGNATURES: Record<string, EmailSignature> = {
  sales: {
    name: "Liberty Bancard Sales Team",
    title: "Business Development",
    phone: "(888) 555-0100",
    email: "sales@libertybancard.com",
    calendlyLink: "https://libertybancard.com/schedule",
  },
  support: {
    name: "Liberty Bancard Support",
    title: "Merchant Support",
    phone: "(888) 555-0101",
    email: "support@libertybancard.com",
  },
  onboarding: {
    name: "Liberty Bancard Onboarding",
    title: "New Merchant Activation",
    phone: "(888) 555-0102",
    email: "onboarding@libertybancard.com",
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

  return `
<br/><br/>
<table style="font-family:Arial,sans-serif;font-size:13px;color:#333;border-collapse:collapse;">
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

  let text = `\n\n--\n${sig.name}\n${sig.title} | Liberty Bancard\n${sig.phone} | ${sig.email}`;
  if (sig.calendlyLink) text += `\nSchedule a Review: ${sig.calendlyLink}`;
  text += `\n\nGet Your Free Savings Analysis: ${quizUrl}`;
  text += `\nBrowse Terminals & Equipment: ${shopUrl}`;
  if (activePromo) text += `\n\nP.S. ${activePromo.headline} — ${activePromo.description}`;
  text += `\nEligibility, underwriting, card brand rules, and applicable laws apply.`;
  return text;
}

export async function getStoredSignature(type: string): Promise<EmailSignature> {
  const stored = await storage.getSystemSetting(`email_signature_${type}`);
  if (stored) return { ...DEFAULT_SIGNATURES[type] || DEFAULT_SIGNATURES.sales, ...stored };
  return DEFAULT_SIGNATURES[type] || DEFAULT_SIGNATURES.sales;
}

export async function saveSignature(type: string, sig: Partial<EmailSignature>): Promise<void> {
  await storage.setSystemSetting(`email_signature_${type}`, sig);
}
