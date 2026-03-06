import { storage } from "../storage";

export interface EmailSignature {
  name: string;
  title: string;
  phone: string;
  email: string;
  calendlyLink?: string;
}

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

export function getEmailSignatureHtml(type: "sales" | "support" | "onboarding" = "sales", customSig?: Partial<EmailSignature>): string {
  const sig = { ...DEFAULT_SIGNATURES[type], ...customSig };
  const name = escapeHtml(sig.name);
  const title = escapeHtml(sig.title);
  const phone = escapeHtml(sig.phone);
  const email = escapeHtml(sig.email);
  const link = sig.calendlyLink ? escapeHtml(sig.calendlyLink) : "";
  return `
<br/><br/>
<table style="font-family:Arial,sans-serif;font-size:13px;color:#333;border-collapse:collapse;">
  <tr>
    <td style="border-left:3px solid #1e3a5f;padding-left:12px;">
      <strong style="font-size:14px;color:#1e3a5f;">${name}</strong><br/>
      <span style="color:#666;">${title} | Liberty Bancard</span><br/>
      <span style="color:#666;">📞 ${phone} | ✉️ ${email}</span><br/>
      ${link ? `<a href="${link}" style="color:#1e3a5f;text-decoration:none;">📅 Schedule a Free Statement Review</a><br/>` : ""}
      <span style="font-size:11px;color:#999;margin-top:4px;display:inline-block;">Eligibility, underwriting, card brand rules, and applicable laws apply.</span>
    </td>
  </tr>
</table>`;
}

export function getEmailSignaturePlainText(type: "sales" | "support" | "onboarding" = "sales", customSig?: Partial<EmailSignature>): string {
  const sig = { ...DEFAULT_SIGNATURES[type], ...customSig };
  return `\n\n--\n${sig.name}\n${sig.title} | Liberty Bancard\n${sig.phone} | ${sig.email}${sig.calendlyLink ? `\nSchedule a Review: ${sig.calendlyLink}` : ""}\nEligibility, underwriting, card brand rules, and applicable laws apply.`;
}

export async function getStoredSignature(type: string): Promise<EmailSignature> {
  const stored = await storage.getSystemSetting(`email_signature_${type}`);
  if (stored) return { ...DEFAULT_SIGNATURES[type] || DEFAULT_SIGNATURES.sales, ...stored };
  return DEFAULT_SIGNATURES[type] || DEFAULT_SIGNATURES.sales;
}

export async function saveSignature(type: string, sig: Partial<EmailSignature>): Promise<void> {
  await storage.setSystemSetting(`email_signature_${type}`, sig);
}
