import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/test";
const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const links = await import("../services/contact-business-system-links");

const trustedBase = {
  contactId: 12,
  businessId: 34,
  sourceLinkId: "11111111-1111-4111-8111-111111111111",
  sourceEntityId: 56,
  companyName: "Example Clutch and Transmission",
  contactWebsite: "https://www.example-clutch.test/contact",
  contactEmail: "owner@example-clutch.test",
  contactRecordClass: "production",
  emailStatus: "unvalidated",
  archivedAt: null,
  existingMerchantCustomer: false,
  doNotContact: false,
  doNotAutoContact: false,
  optedOutEmail: false,
  optOutStatus: "active",
  unsubscribeStatus: "active",
  bounceStatus: "none",
  complaintStatus: "none",
  suppressionReason: null,
  businessRecordClass: "canonical",
  doNotVisit: false,
  canonicalName: "Example Clutch and Transmission",
  businessDomain: "example-clutch.test",
  sunbizName: "Example Clutch and Transmission",
  sunbizWebsite: "https://example-clutch.test",
  sourceSystem: "sunbiz",
  sourceType: "sunbiz_entity",
  sourceStableKey: "F123456",
  sunbizEntitySource: "cordata",
  filingNumber: "F123456",
  domainBusinessCount: 1,
  currentDecisionId: null,
  currentDecision: null,
  projectedBusinessId: null,
};

assert.equal(links.normalizeSystemBusinessDomain("https://www.Example.test/about"), "example.test");
assert.deepEqual(links.evaluateSystemLinkFacts(trustedBase), []);
assert.deepEqual(links.evaluateSystemLinkFacts({ ...trustedBase, sunbizEntitySource: "corevt" }), []);
assert.ok(links.evaluateSystemLinkFacts({ ...trustedBase, sunbizEntitySource: "contact_form" }).includes("untrusted_sunbiz_entity_ingestion_source"));

const applyItem = {
  contactId: 12, businessId: 34, sourceLinkId: trustedBase.sourceLinkId!,
  sourceEntityId: 56, snapshotHash: "a".repeat(64),
};
const matchingPreview = {
  contactId: 12, businessId: 34, sourceLinkId: applyItem.sourceLinkId,
  sourceEntityId: 56, snapshotHash: applyItem.snapshotHash, eligible: true,
};
assert.equal(links.isCurrentSystemLinkSnapshot(matchingPreview, applyItem), true);
assert.equal(links.isCurrentSystemLinkSnapshot({ ...matchingPreview, snapshotHash: "b".repeat(64) }, applyItem), false,
  "snapshot hash changes reject stale preview");
const replayEvidence = {
  contact_id: 12, business_id: 34, facts_hash: applyItem.snapshotHash,
  source_link_id: applyItem.sourceLinkId, source_entity_id: 56,
};
assert.equal(links.isMatchingSystemLinkReplay(replayEvidence, applyItem), true,
  "exact idempotency replay returns the existing decision");
assert.equal(links.isMatchingSystemLinkReplay({ ...replayEvidence, business_id: 99 }, applyItem), false,
  "divergent replay is rejected");

// Miami Clutch-shaped near miss: matching website is not enough. Exact name,
// independent corporate email domain and retained source link are mandatory.
const miamiClutch = {
  ...trustedBase,
  canonicalName: "Miami Clutch & Transmission",
  businessDomain: "miami-clutch.test",
  contactWebsite: "https://miami-clutch.test",
  sunbizWebsite: "https://miami-clutch.test",
  companyName: "Miami Clutch and Transmission",
  sunbizName: "Different Miami Entity LLC",
  contactEmail: "owner@gmail.com",
  sourceLinkId: null,
  sourceEntityId: null,
  sourceSystem: null,
  sourceType: null,
  sourceStableKey: null,
  filingNumber: null,
};
const miamiReasons = links.evaluateSystemLinkFacts(miamiClutch);
assert.ok(miamiReasons.includes("independent_sunbiz_source_link_missing"));
assert.ok(miamiReasons.includes("exact_company_name_mismatch"));
assert.ok(miamiReasons.includes("email_domain_not_independent_corporate_domain"));
assert.ok(links.evaluateSystemLinkFacts({ ...trustedBase, domainBusinessCount: 2 }).includes("canonical_business_domain_ambiguous"));
assert.ok(links.evaluateSystemLinkFacts({ ...trustedBase, contactEmail: "owner@gmail.com" }).includes("email_domain_not_independent_corporate_domain"));
assert.ok(links.evaluateSystemLinkFacts({ ...trustedBase, suppressionReason: "unsubscribe" }).includes("contact_suppressed_or_ineligible"));
assert.ok(links.evaluateSystemLinkFacts({ ...trustedBase, doNotVisit: true }).includes("business_do_not_visit"));

const serviceSource = read("server/services/contact-business-system-links.ts");
const authoritySource = read("server/services/commercial-link-authority.ts");
const routeSource = read("server/routes/admin.ts");
const migration = read("migrations/0312_contact_business_system_links.sql");
assert.match(serviceSource, /freshPreview, item/);
assert.match(serviceSource, /export function isCurrentSystemLinkSnapshot/);
assert.match(serviceSource, /decisionId: \(decision as any\)\.id/);
assert.match(authoritySource, /COMMERCIAL_LINK_DIVERGENT_REPLAY/);
assert.match(authoritySource, /COMMERCIAL_SYSTEM_LINK_DATABASE_GUARD_MISSING/);
assert.match(authoritySource, /immutable_evidence_trigger/);
assert.match(authoritySource, /lockCommercialGraphMembershipSets/);
assert.match(authoritySource, /UPDATE contacts SET business_id=/);
assert.match(migration, /contact_business_system_link_evidence_append_only/);
assert.match(migration, /reviewed_by IS NOT NULL/);
assert.match(migration, /source_system='sunbiz' AND csl\.source_type='sunbiz_entity'/);
assert.match(migration, /se\.source IN \('cordata','corevt','sunbiz'\)/);
assert.match(serviceSource, /se\.source IN \('cordata','corevt','sunbiz'\)/);
assert.doesNotMatch(migration, /se\.source='sunbiz'/);
assert.match(routeSource, /\/api\/admin\/contact-business-system-links\/preview/);
assert.match(routeSource, /\/api\/admin\/contact-business-system-links\/apply/);
assert.match(serviceSource, /lower\(regexp_replace\(trim\(website_domain\),'\^www\[\.\]'/);
assert.match(serviceSource, /ANY\(ARRAY\[\$\{sql\.join\(domains\.map/);
assert.match(serviceSource, /ANY\(ARRAY\[\$\{sql\.join\(businessIds\.map/);
assert.match(serviceSource, /ORDER BY c\.id[\s\S]*LIMIT \$\{limit\}/);
assert.doesNotMatch(serviceSource, /HOST_SQL|regexp_replace\(.*business/i);
assert.doesNotMatch(serviceSource, /emailValidation|outbound_messages|sendSmtpEmail|validateEmail|enqueueOutreach/i);
assert.doesNotMatch(routeSource.slice(
  routeSource.indexOf("/api/admin/contact-business-system-links/preview"),
  routeSource.indexOf("/api/admin/contact-business-system-links/apply"),
), /emailValidation|validateEmail|sendSmtpEmail|outbound/i);
assert.match(serviceSource, /writes: 0/);
assert.match(serviceSource, /paidProviderCalls: 0/);
assert.doesNotMatch(routeSource, /contact_business_system_link_previewed/);
assert.match(routeSource, /contact_business_system_link_batch_applied/);

console.log("Strict contact/business system-link rules and no-side-effect source checks passed");