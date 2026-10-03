/** Pure strict auto-link predicate shared by the system-link writer and census. */
const SHARED_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "outlook.com",
  "hotmail.com", "live.com", "aol.com", "icloud.com", "me.com", "msn.com",
  "proton.me", "protonmail.com", "mail.com", "comcast.net", "att.net",
]);
const TRUSTED_SUNBIZ_INGESTION_SOURCES = new Set(["cordata", "corevt", "sunbiz"]);

export function normalizeSystemBusinessDomain(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  try {
    const host = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname
      .toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    return host && !host.includes(" ") ? host : null;
  } catch {
    return null;
  }
}

export function normalizeSystemBusinessName(value: unknown): string {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function normalizeDatabaseGuardWebsite(value: unknown): string {
  return String(value ?? "").trim()
    .replace(/^[a-zA-Z]+:\/\//, "")
    .split("/", 1)[0]
    .replace(/^www[.]/i, "")
    .toLowerCase();
}

function normalizeDatabaseGuardDomain(value: unknown): string {
  return String(value ?? "").trim().replace(/^www[.]/i, "").toLowerCase();
}

export function matchesSystemLinkDatabaseGuardIdentity(facts: SystemLinkFacts): boolean {
  if (facts.relationshipReasons) return facts.relationshipReasons.length === 0;
  const businessDomain = normalizeDatabaseGuardDomain(facts.businessDomain);
  const contactDomain = normalizeDatabaseGuardWebsite(facts.contactWebsite);
  const sourceDomain = normalizeDatabaseGuardWebsite(facts.sunbizWebsite);
  if (!businessDomain || contactDomain !== businessDomain || sourceDomain !== businessDomain) return false;

  const guardedName = (value: unknown) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const businessName = guardedName(facts.canonicalName);
  return Boolean(
    businessName
    && guardedName(facts.companyName) === businessName
    && guardedName(facts.sunbizName) === businessName,
  );
}

export interface SystemLinkFacts {
  relationshipReasons?: string[];
  identityRevision?: string;
  contactId: number;
  businessId: number;
  sourceLinkId: string | null;
  sourceEntityId: number | null;
  companyName: string | null;
  contactWebsite: string | null;
  contactEmail: string | null;
  contactRecordClass: string | null;
  emailStatus: string | null;
  archivedAt: unknown;
  existingMerchantCustomer: boolean;
  doNotContact: boolean;
  doNotAutoContact: boolean;
  optedOutEmail: boolean;
  optOutStatus: string | null;
  unsubscribeStatus: string | null;
  bounceStatus: string | null;
  complaintStatus: string | null;
  suppressionReason: string | null;
  businessRecordClass: string | null;
  doNotVisit: boolean;
  canonicalName: string;
  businessDomain: string | null;
  sunbizName: string | null;
  sunbizWebsite: string | null;
  sourceSystem: string | null;
  sourceType: string | null;
  sourceStableKey: string | null;
  sunbizEntitySource: string | null;
  filingNumber: string | null;
  domainBusinessCount: number;
  currentDecisionId: string | null;
  currentDecision: string | null;
  projectedBusinessId: number | null;
}

/** Predicate intentionally identical to the existing strict system writer. */
export function evaluateSystemLinkFacts(f: SystemLinkFacts): string[] {
  if (f.relationshipReasons) return [...f.relationshipReasons];
  const reasons: string[] = [];
  const domain = normalizeSystemBusinessDomain(f.businessDomain);
  const contactDomain = normalizeSystemBusinessDomain(f.contactWebsite);
  const sourceDomain = normalizeSystemBusinessDomain(f.sunbizWebsite);
  const emailParts = String(f.contactEmail ?? "").trim().toLowerCase().split("@");
  const emailDomain = emailParts.length === 2 ? emailParts[1] : "";
  const normalizedName = normalizeSystemBusinessName(f.canonicalName);
  if (!f.sourceLinkId || !f.sourceEntityId || f.sourceSystem !== "sunbiz"
      || f.sourceType !== "sunbiz_entity" || !f.sourceStableKey || f.sourceStableKey !== f.filingNumber) {
    reasons.push("independent_sunbiz_source_link_missing");
  }
  if (!f.sunbizEntitySource || !TRUSTED_SUNBIZ_INGESTION_SOURCES.has(f.sunbizEntitySource)) {
    reasons.push("untrusted_sunbiz_entity_ingestion_source");
  }
  if (!domain || contactDomain !== domain || sourceDomain !== domain) reasons.push("website_domain_mismatch");
  if (!normalizedName || normalizeSystemBusinessName(f.companyName) !== normalizedName
      || normalizeSystemBusinessName(f.sunbizName) !== normalizedName) reasons.push("exact_company_name_mismatch");
  if (!emailDomain || emailDomain !== domain || SHARED_EMAIL_DOMAINS.has(emailDomain)) {
    reasons.push("email_domain_not_independent_corporate_domain");
  }
  if (f.domainBusinessCount !== 1) reasons.push("canonical_business_domain_ambiguous");
  if (f.contactRecordClass == null || ["test", "demo", "synthetic"].includes(f.contactRecordClass)
      || f.businessRecordClass !== "canonical") reasons.push("non_production_record_class");
  if (f.archivedAt != null || f.existingMerchantCustomer || f.doNotContact || f.doNotAutoContact
      || f.optedOutEmail || f.optOutStatus === "opted_out" || f.unsubscribeStatus === "unsubscribed"
      || f.bounceStatus === "hard" || f.complaintStatus === "reported"
      || f.emailStatus === "bounced" || f.emailStatus === "invalid" || f.suppressionReason) {
    reasons.push("contact_suppressed_or_ineligible");
  }
  if (f.doNotVisit) reasons.push("business_do_not_visit");
  if (f.currentDecisionId || f.currentDecision) reasons.push("current_link_decision_exists");
  if (f.projectedBusinessId != null) reasons.push("existing_contact_business_projection");
  return reasons;
}