import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { assertSystemLinkDatabaseGuard, decideSystemContactBusinessLink } from "./commercial-link-authority";

export const CONTACT_BUSINESS_SYSTEM_LINK_RULE = "sfp_sunbiz_exact_identity_v1";
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

export interface SystemLinkFacts {
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

export function evaluateSystemLinkFacts(f: SystemLinkFacts): string[] {
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

function snapshotHash(facts: SystemLinkFacts): string {
  return crypto.createHash("sha256").update(JSON.stringify(minimizedEvidenceFacts(facts))).digest("hex");
}

function minimizedEvidenceFacts(f: SystemLinkFacts) {
  const email = String(f.contactEmail ?? "").trim().toLowerCase().split("@");
  return {
    ruleVersion: CONTACT_BUSINESS_SYSTEM_LINK_RULE,
    contactId: f.contactId,
    businessId: f.businessId,
    sourceLinkId: f.sourceLinkId,
    sourceEntityId: f.sourceEntityId,
    companyNameNormalized: normalizeSystemBusinessName(f.companyName),
    canonicalNameNormalized: normalizeSystemBusinessName(f.canonicalName),
    sunbizNameNormalized: normalizeSystemBusinessName(f.sunbizName),
    contactWebsiteDomain: normalizeSystemBusinessDomain(f.contactWebsite),
    businessDomain: normalizeSystemBusinessDomain(f.businessDomain),
    sunbizWebsiteDomain: normalizeSystemBusinessDomain(f.sunbizWebsite),
    contactEmailDomain: email.length === 2 ? email[1] : null,
    contactRecordClass: f.contactRecordClass,
    emailStatus: f.emailStatus,
    archived: f.archivedAt != null,
    existingMerchantCustomer: f.existingMerchantCustomer,
    doNotContact: f.doNotContact,
    doNotAutoContact: f.doNotAutoContact,
    optedOutEmail: f.optedOutEmail,
    optOutStatus: f.optOutStatus,
    unsubscribeStatus: f.unsubscribeStatus,
    bounceStatus: f.bounceStatus,
    complaintStatus: f.complaintStatus,
    suppressed: Boolean(f.suppressionReason),
    businessRecordClass: f.businessRecordClass,
    doNotVisit: f.doNotVisit,
    sourceSystem: f.sourceSystem,
    sourceType: f.sourceType,
    sourceStableKey: f.sourceStableKey,
    sunbizEntitySource: f.sunbizEntitySource,
    filingNumber: f.filingNumber,
    domainBusinessCount: f.domainBusinessCount,
    currentDecisionId: f.currentDecisionId,
    currentDecision: f.currentDecision,
    projectedBusinessId: f.projectedBusinessId,
  };
}

function factsFromRows(contact: any, business: any, source: any, domainBusinessCount: number): SystemLinkFacts {
  return {
    contactId: Number(contact.contact_id), businessId: Number(business.business_id),
    sourceLinkId: source?.source_link_id ? String(source.source_link_id) : null,
    sourceEntityId: source?.source_entity_id == null ? null : Number(source.source_entity_id),
    companyName: contact.company_name ?? null, contactWebsite: contact.contact_website ?? null,
    contactEmail: contact.contact_email ?? null, contactRecordClass: contact.contact_record_class ?? null,
    emailStatus: contact.email_status ?? null,
    archivedAt: contact.archived_at ?? null, existingMerchantCustomer: Boolean(contact.existing_merchant_customer),
    doNotContact: Boolean(contact.do_not_contact), doNotAutoContact: Boolean(contact.do_not_auto_contact),
    optedOutEmail: Boolean(contact.opted_out_email), optOutStatus: contact.opt_out_status ?? null,
    unsubscribeStatus: contact.unsubscribe_status ?? null, bounceStatus: contact.bounce_status ?? null,
    complaintStatus: contact.complaint_status ?? null, suppressionReason: contact.suppression_reason ?? null,
    businessRecordClass: business.business_record_class ?? null, doNotVisit: Boolean(business.do_not_visit),
    canonicalName: String(business.canonical_name ?? ""), businessDomain: business.business_domain ?? null,
    sunbizName: source?.sunbiz_name ?? null, sunbizWebsite: source?.sunbiz_website ?? null,
    sourceSystem: source?.source_system ?? null, sourceType: source?.source_type ?? null,
    sourceStableKey: source?.source_stable_key ?? null,
    sunbizEntitySource: source?.sunbiz_entity_source ?? null,
    filingNumber: source?.filing_number ?? null,
    domainBusinessCount,
    currentDecisionId: contact.current_decision_id ?? null, currentDecision: contact.current_decision ?? null,
    projectedBusinessId: contact.projected_business_id == null ? null : Number(contact.projected_business_id),
  };
}

async function loadPage(executor: any, afterContactId: number, limit: number, onlyContactId?: number) {
  const contactResult = await executor.execute(sql`
    SELECT c.id contact_id,c.company_name,c.website contact_website,c.email contact_email,
           c.record_class contact_record_class,c.email_status,c.archived_at,
           COALESCE(c.existing_merchant_customer,false) existing_merchant_customer,
           COALESCE(c.do_not_contact,false) do_not_contact,
           COALESCE(c.do_not_auto_contact,false) do_not_auto_contact,
           COALESCE(c.opted_out_email,false) opted_out_email,c.opt_out_status,c.unsubscribe_status,
           c.bounce_status,c.complaint_status,c.suppression_reason,c.business_id projected_business_id,
           d.id current_decision_id,d.decision current_decision
      FROM contacts c
      LEFT JOIN contact_business_link_decisions d
        ON d.contact_id=c.id AND d.superseded_at IS NULL
     WHERE ${onlyContactId === undefined ? sql`c.id > ${afterContactId}` : sql`c.id = ${onlyContactId}`}
       AND c.website IS NOT NULL AND trim(c.website) <> ''
     ORDER BY c.id
     LIMIT ${limit}
  `);
  const contacts = ((contactResult as any).rows ?? contactResult ?? []) as any[];
  const pageContacts = onlyContactId === undefined ? contacts.slice(0, limit) : contacts;
  let hasMore = false;
  if (onlyContactId === undefined && pageContacts.length === limit && pageContacts.length) {
    const moreResult = await executor.execute(sql`SELECT EXISTS (
      SELECT 1 FROM contacts
       WHERE id > ${Number(pageContacts[pageContacts.length - 1].contact_id)}
         AND website IS NOT NULL AND trim(website) <> ''
    ) AS more`);
    hasMore = Boolean(((moreResult as any).rows ?? moreResult ?? [])[0]?.more);
  }
  const domains = [...new Set(pageContacts
    .map(contact => normalizeSystemBusinessDomain(contact.contact_website))
    .filter((domain): domain is string => Boolean(domain)))];
  const businessByDomain = new Map<string, any[]>();
  const sourcesByBusiness = new Map<number, any[]>();
  if (domains.length) {
    const businessResult = await executor.execute(sql`
      SELECT id business_id,canonical_name,website_domain business_domain,record_class business_record_class,
             COALESCE(do_not_visit,false) do_not_visit
        FROM businesses
       WHERE record_class='canonical'
         AND lower(regexp_replace(trim(website_domain),'^www[.]','','i')) =
             ANY(ARRAY[${sql.join(domains.map(domain => sql`${domain}`), sql`, `)}]::text[])
    `);
    const businesses = ((businessResult as any).rows ?? businessResult ?? []) as any[];
    for (const business of businesses) {
      const domain = normalizeSystemBusinessDomain(business.business_domain);
      if (!domain || !domains.includes(domain)) continue;
      const bucket = businessByDomain.get(domain) ?? [];
      bucket.push(business);
      businessByDomain.set(domain, bucket);
    }
    const businessIds = businesses.map(b => Number(b.business_id));
    if (businessIds.length) {
      const sourceResult = await executor.execute(sql`
        SELECT csl.business_id,csl.id source_link_id,csl.source_system,csl.source_type,
               csl.stable_key source_stable_key,se.id source_entity_id,se.entity_name sunbiz_name,
               se.website sunbiz_website,se.filing_number,se.source sunbiz_entity_source
          FROM canonical_source_links csl
          LEFT JOIN sunbiz_entities se
            ON se.source IN ('cordata','corevt','sunbiz') AND se.filing_number=csl.stable_key
          WHERE csl.business_id = ANY(ARRAY[${sql.join(businessIds.map(id => sql`${id}`), sql`, `)}]::integer[])
           AND csl.source_system='sunbiz' AND csl.source_type='sunbiz_entity'
      `);
      for (const source of ((sourceResult as any).rows ?? sourceResult ?? []) as any[]) {
        const bucket = sourcesByBusiness.get(Number(source.business_id)) ?? [];
        bucket.push(source);
        sourcesByBusiness.set(Number(source.business_id), bucket);
      }
    }
  }
  const selectedFactsForPage: SystemLinkFacts[] = [];
  const previews = pageContacts.map(contact => {
    const contactDomain = normalizeSystemBusinessDomain(contact.contact_website);
    const businesses = contactDomain ? (businessByDomain.get(contactDomain) ?? []) : [];
    if (!businesses.length) {
      const reasons = ["canonical_business_domain_not_found"];
      return {
        contactId: Number(contact.contact_id), businessId: null, companyName: contact.company_name ?? null,
        sourceLinkId: null, sourceEntityId: null,
        snapshotHash: crypto.createHash("sha256").update(JSON.stringify({
          contactId: Number(contact.contact_id), contactWebsiteDomain: contactDomain,
          companyNameNormalized: normalizeSystemBusinessName(contact.company_name),
          reason: reasons[0],
        })).digest("hex"),
        reasons, eligible: false,
      };
    }
    const alternatives: Array<{ facts: SystemLinkFacts; reasons: string[] }> = [];
    for (const business of businesses) {
      const sources = sourcesByBusiness.get(Number(business.business_id)) ?? [null];
      for (const source of sources) {
        const facts = factsFromRows(contact, business, source, businesses.length);
        alternatives.push({ facts, reasons: evaluateSystemLinkFacts(facts) });
      }
    }
    const eligibleAlternatives = alternatives.filter(alternative => alternative.reasons.length === 0);
    const uniquelyEligible = businesses.length === 1 && eligibleAlternatives.length === 1;
    const reasons = uniquelyEligible ? [] : [...new Set(alternatives.flatMap(alternative => alternative.reasons))];
    if (businesses.length !== 1 && !reasons.includes("canonical_business_domain_ambiguous")) {
      reasons.push("canonical_business_domain_ambiguous");
    }
    if (eligibleAlternatives.length > 1) reasons.push("independent_sunbiz_source_ambiguous");
    const chosenFacts = uniquelyEligible ? eligibleAlternatives[0].facts : null;
    if (chosenFacts) selectedFactsForPage.push(chosenFacts);
    const hashFacts = chosenFacts
      ? minimizedEvidenceFacts(chosenFacts)
      : alternatives.map(alternative => minimizedEvidenceFacts(alternative.facts));
    return {
      contactId: Number(contact.contact_id),
      businessId: businesses.length === 1 ? Number(businesses[0].business_id) : null,
      companyName: contact.company_name ?? null,
      sourceLinkId: uniquelyEligible ? chosenFacts!.sourceLinkId : null,
      sourceEntityId: uniquelyEligible ? chosenFacts!.sourceEntityId : null,
      snapshotHash: crypto.createHash("sha256").update(JSON.stringify(hashFacts)).digest("hex"),
      reasons,
      eligible: uniquelyEligible,
    };
  });
  return {
    previews, hasMore,
    lastContactId: pageContacts.length ? Number(pageContacts[pageContacts.length - 1].contact_id) : null,
    selectedFacts: selectedFactsForPage[0],
  };
}

export async function previewContactBusinessSystemLinks(input: { afterContactId: number; limit: number }) {
  const limit = Math.max(1, Math.min(25, Math.floor(input.limit)));
  // The read-only inventory remains useful before the production SQL contracts
  // are installed. Only the write path is gated on those contracts.
  let schemaReady = true;
  try {
    await assertSystemLinkDatabaseGuard(db);
  } catch (error: any) {
    if (error?.message !== "COMMERCIAL_SYSTEM_LINK_DATABASE_GUARD_MISSING") throw error;
    schemaReady = false;
  }
  const page = await loadPage(db, input.afterContactId, limit);
  return {
    rows: page.previews,
    nextCursor: page.hasMore ? page.lastContactId : null,
    schemaReady,
    writes: 0,
    paidProviderCalls: 0,
  };
}

export interface SystemLinkApplyItem {
  contactId: number; businessId: number; sourceLinkId: string; sourceEntityId: number; snapshotHash: string;
}

export function isCurrentSystemLinkSnapshot(
  preview: { contactId: number; businessId: number | null; sourceLinkId: string | null; sourceEntityId: number | null; snapshotHash: string; eligible: boolean } | undefined,
  item: SystemLinkApplyItem,
): boolean {
  return Boolean(preview?.eligible && preview.contactId === item.contactId && preview.businessId === item.businessId
    && preview.sourceLinkId === item.sourceLinkId && preview.sourceEntityId === item.sourceEntityId
    && preview.snapshotHash === item.snapshotHash);
}

export function isMatchingSystemLinkReplay(
  replay: { contact_id: unknown; business_id: unknown; facts_hash: unknown; source_link_id: unknown; source_entity_id: unknown },
  item: SystemLinkApplyItem,
): boolean {
  return Number(replay.contact_id) === item.contactId && Number(replay.business_id) === item.businessId
    && replay.facts_hash === item.snapshotHash && String(replay.source_link_id) === item.sourceLinkId
    && Number(replay.source_entity_id) === item.sourceEntityId;
}

export async function applyContactBusinessSystemLink(item: SystemLinkApplyItem) {
  try {
    await assertSystemLinkDatabaseGuard(db);
    const key = `sfp-system-link-v1:${item.contactId}:${item.businessId}:${item.sourceLinkId}:${item.sourceEntityId}:${item.snapshotHash}`;
    const replay = (await db.execute(sql`SELECT d.id,d.contact_id,d.business_id,e.facts_hash,
        e.source_link_id,e.source_entity_id
      FROM contact_business_link_decisions d
      JOIN contact_business_system_link_evidence e ON e.id=d.system_evidence_id
      WHERE d.decision_key=${key}`) as any).rows?.[0];
    if (replay) {
      if (isMatchingSystemLinkReplay(replay, item)) {
        return { contactId: item.contactId, businessId: item.businessId, status: "replayed", decisionId: replay.id };
      }
      return { contactId: item.contactId, status: "rejected", code: "COMMERCIAL_LINK_DIVERGENT_REPLAY" };
    }
    const page = await loadPage(db, 0, 1, item.contactId);
    const preview = page.previews[0];
    if (!isCurrentSystemLinkSnapshot(preview, item)) {
      return { contactId: item.contactId, status: "rejected", code: "SYSTEM_LINK_SNAPSHOT_STALE" };
    }
    // The hash has no contact email/local-part or raw website values, and the
    // evidence JSON stores only minimized normalized facts.
    const facts = page.selectedFacts as SystemLinkFacts | undefined;
    if (!facts) return { contactId: item.contactId, status: "rejected", code: "SYSTEM_LINK_SNAPSHOT_STALE" };
    const decision = await decideSystemContactBusinessLink({
      contactId: item.contactId,
      businessId: item.businessId,
      sourceLinkId: item.sourceLinkId,
      sourceEntityId: item.sourceEntityId,
      decisionKey: key,
      ruleVersion: CONTACT_BUSINESS_SYSTEM_LINK_RULE,
      factsHash: item.snapshotHash,
      facts: minimizedEvidenceFacts(facts) as unknown as Record<string, unknown>,
      authorityCheck: async (tx: any) => {
        const freshPage = await loadPage(tx, 0, 1, item.contactId);
        const freshPreview = freshPage.previews[0];
        return isCurrentSystemLinkSnapshot(freshPreview, item);
      },
    });
    return {
      contactId: item.contactId, businessId: item.businessId,
      status: (decision as any).replayed ? "replayed" : "applied",
      decisionId: (decision as any).id, revision: (decision as any).revision,
    };
  } catch (error: any) {
    const code = String(error?.message ?? "SYSTEM_LINK_APPLY_FAILED").split("\n")[0].slice(0, 160);
    return { contactId: item.contactId, status: "rejected", code };
  }
}