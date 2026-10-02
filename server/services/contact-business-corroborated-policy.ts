/** Identity matching only. Email deliverability/consent never establish or veto an identity. */
const LEGAL_WORDS = /\b(inc|incorporated|llc|llp|ltd|limited|corp|corporation|company|co)\b/g;
const SHARED_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "outlook.com", "hotmail.com",
  "live.com", "aol.com", "icloud.com", "me.com", "msn.com", "proton.me",
  "protonmail.com", "mail.com", "comcast.net", "att.net",
  "facebook.com", "instagram.com", "linkedin.com", "twitter.com", "x.com",
  "yelp.com", "business.site", "sites.google.com",
]);
export const CORROBORATED_MATCH_RULE = "company_contact_corroboration_v2";

export function identityName(value: unknown): string {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ")
    .replace(LEGAL_WORDS, " ").trim().replace(/\s+/g, " ");
}
export function identityDomain(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  try {
    const host = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname
      .toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    return host.includes(".") && !SHARED_DOMAINS.has(host) ? host : null;
  } catch { return null; }
}
export function identityPhone(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return national.length === 10 && !/^(\d)\1+$/.test(national) ? national : null;
}
export interface CompanyIdentity {
  name: string | null;
  website: string | null;
  phone: string | null;
  email?: string | null;
}
export function corroboratedIdentitySignals(contact: CompanyIdentity, business: CompanyIdentity): string[] {
  const name = identityName(contact.name);
  if (!name || name !== identityName(business.name)) return [];
  const domain = identityDomain(business.website);
  const contactDomain = identityDomain(contact.website);
  const email = String(contact.email ?? "").trim().toLowerCase().split("@");
  const emailDomain = email.length === 2 ? identityDomain(email[1]) : null;
  const phone = identityPhone(business.phone);
  const phoneMatches = Boolean(phone && phone === identityPhone(contact.phone));
  // A contradictory populated corporate domain is a conflict, not a missing field.
  if ((domain && contactDomain && domain !== contactDomain)
      || (domain && emailDomain && domain !== emailDomain)) return [];
  const signals = ["matching_company_name"];
  if (domain && contactDomain === domain) signals.push("matching_website");
  if (domain && emailDomain === domain) signals.push("matching_company_email_domain");
  if (phoneMatches) signals.push("matching_phone");
  // This is an operator-confirmation workflow, not automatic system
  // verification. A unique name match can be presented for confirmation;
  // missing phone/domain data must not force users to manufacture evidence.
  return signals;
}