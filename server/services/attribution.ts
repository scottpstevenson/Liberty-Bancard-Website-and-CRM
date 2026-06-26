import { storage } from "../storage";

/**
 * Describes HOW the attribution was resolved.
 *
 * Precedence (highest → lowest priority):
 *   1. co_branded_session  — existingPartnerOrgId already set on the contact record
 *      (co-branded portal or manually-linked session; no code lookup needed)
 *   2. partner_org_slug    — inbound code matched an ACTIVE partner_organizations.slug
 *      (org-level partner takes priority over individual affiliate when both are active)
 *   3. affiliate_code      — inbound code matched an ACTIVE partners.affiliateCode
 *   4. direct              — no code supplied, no active match, or all matches inactive
 *
 * Transport note: URL ?ref= and cookie lb_ref are both resolved to a single `code`
 * string before this function is called. Merchant-referral attribution is handled
 * separately via the referrals table (trackReferral()).
 *
 * Ambiguity: when a code matches an active org AND an active affiliate, both are
 * detected and the collision is logged explicitly. Org wins per precedence model.
 *
 * Preserve-existing: callers guard contact.partnerOrgId / contact.promoCode before
 * writing. When attribution is intentionally preserved (not overwritten), an audit
 * log event is emitted for observability.
 */
export type AttributionSource =
  | "co_branded_session"
  | "partner_org_slug"
  | "affiliate_code"
  | "direct";

export type ReferralAttributionResult = {
  /** Discriminant for the winning attribution path */
  partnerType: "partner_org" | "affiliate_partner" | "none";
  source: AttributionSource;
  partnerId?: number;
  partnerOrgId?: number;
  /** Human-readable source tag written to contact.referralSource */
  referralSource: string;
  /** The raw referral code — set for org (slug value) and affiliate (affiliateCode) */
  promoCode?: string;
};

/**
 * Resolve referral attribution from a code string.
 *
 * @param code               The referral code from URL ?ref= or form field
 * @param existingPartnerOrgId  Already-resolved org id from session/contact (highest priority)
 */
export async function resolveReferralAttribution(
  code: string | undefined | null,
  existingPartnerOrgId?: number | null,
): Promise<ReferralAttributionResult> {
  // Level 1: co-branded session — existingPartnerOrgId already on contact
  if (existingPartnerOrgId) {
    return {
      partnerType: "partner_org",
      source: "co_branded_session",
      partnerOrgId: existingPartnerOrgId,
      referralSource: "partner_org",
    };
  }

  if (!code || typeof code !== "string") {
    return { partnerType: "none", source: "direct", referralSource: "direct" };
  }

  const normalized = code.trim().toLowerCase();

  let resolvedOrg: Awaited<ReturnType<typeof storage.getPartnerOrgBySlug>> | null = null;
  let resolvedAffiliate: Awaited<ReturnType<typeof storage.getPartnerByCode>> | null = null;

  // Level 2: check partner_organizations by slug
  try {
    const org = await storage.getPartnerOrgBySlug(normalized);
    if (org) {
      if (org.status === "active") {
        resolvedOrg = org;
      } else {
        console.warn(
          `[Attribution] Code "${normalized}" matched partner_org id=${org.id} status="${org.status}" — inactive, checking affiliate fallback.`,
        );
      }
    }
  } catch (err) {
    console.error("[Attribution] getPartnerOrgBySlug error:", err);
  }

  // Level 3: check partners by affiliateCode (always run — needed for ambiguity detection)
  try {
    const affiliate = await storage.getPartnerByCode(normalized);
    if (affiliate) {
      if (affiliate.status === "active") {
        resolvedAffiliate = affiliate;
      } else {
        console.warn(
          `[Attribution] Code "${normalized}" matched partner id=${affiliate.id} status="${affiliate.status}" — inactive, skipping.`,
        );
      }
    }
  } catch (err) {
    console.error("[Attribution] getPartnerByCode error:", err);
  }

  // Explicit ambiguity logging: same code resolves to BOTH an active org AND an active affiliate
  if (resolvedOrg && resolvedAffiliate) {
    console.info(
      `[Attribution] COLLISION: code "${normalized}" matches active org "${resolvedOrg.slug}" (id=${resolvedOrg.id}) ` +
      `AND active affiliate "${resolvedAffiliate.affiliateCode}" (id=${resolvedAffiliate.id}). ` +
      `Org attribution wins per precedence model.`,
    );
  }

  // Resolve per precedence: org > affiliate > direct
  if (resolvedOrg) {
    return {
      partnerType: "partner_org",
      source: "partner_org_slug",
      partnerOrgId: resolvedOrg.id,
      referralSource: `partner_org:${resolvedOrg.slug}`,
      promoCode: normalized,
    };
  }

  if (resolvedAffiliate) {
    return {
      partnerType: "affiliate_partner",
      source: "affiliate_code",
      partnerId: resolvedAffiliate.id,
      referralSource: `affiliate:${resolvedAffiliate.affiliateCode}`,
      promoCode: resolvedAffiliate.affiliateCode ?? undefined,
    };
  }

  return { partnerType: "none", source: "direct", referralSource: "direct" };
}
