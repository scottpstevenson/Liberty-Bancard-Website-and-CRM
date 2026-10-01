import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CONTACT_LINK_UNLINKED_SUNBIZ_NAME_MATCH_SQL } from "../services/contact-link-coverage-query";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/test";
const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const reconciliation = await import("../services/contact-business-reconciliation");

assert.equal(reconciliation.normalizeBusinessDomain("https://www.Example.com/about"), "example.com");
assert.equal(reconciliation.normalizeBusinessDomain("not a domain"), null);
assert.equal(reconciliation.contactBusinessNameCorroborates("Sunshine Dental LLC", "Sunshine Dental"), true);
assert.equal(reconciliation.contactBusinessNameCorroborates("Acme", "Acme Dental"), false);
assert.equal(reconciliation.normalizeBusinessName("Café & Sons, Ltd."), "caf sons",
  "raw-source comparison uses the same ASCII/legal-suffix normalization as indexed retrieval");
assert.equal(reconciliation.normalizeBusinessName("Sunshine Dental Incorporated"), "sunshine dental");

const singleDomain = reconciliation.matchContactToBusinesses({
  companyName: "Sunshine Dental LLC",
  email: "owner@sunshine-dental.example",
  website: null,
}, [{
  businessId: 10,
  canonicalName: "Sunshine Dental",
  normalizedName: "sunshine dental",
  websiteDomain: "sunshine-dental.example",
}]);
assert.equal(singleDomain.matches.length, 1);
assert.equal(singleDomain.matches[0].confidence, 90);
assert.equal(singleDomain.ambiguous, false);

const sharedDomain = reconciliation.matchContactToBusinesses({
  companyName: "Sunshine Dental",
  email: "owner@sunshine-dental.example",
  website: null,
}, [
  { businessId: 10, canonicalName: "Sunshine Dental", normalizedName: "sunshine dental", websiteDomain: "sunshine-dental.example" },
  { businessId: 11, canonicalName: "Sunshine Dental North", normalizedName: "sunshine dental north", websiteDomain: "sunshine-dental.example" },
]);
assert.equal(sharedDomain.matches.length, 2);
assert.equal(sharedDomain.ambiguous, true);
assert.ok(sharedDomain.matches.some(match => match.confidence < 90));

const freeEmail = reconciliation.matchContactToBusinesses({
  companyName: "Sunshine Dental",
  email: "owner@gmail.com",
  website: null,
}, [{ businessId: 10, canonicalName: "Sunshine Dental", normalizedName: "sunshine dental", websiteDomain: "gmail.com" }]);
assert.equal(freeEmail.matches.length, 0);

const legalToDbaVariant = reconciliation.matchContactToBusinesses({
  companyName: "Sunrise Family Dentistry",
  email: null,
  website: null,
  sourceDomains: ["sunrise-dental.example"],
}, [{
  businessId: 12,
  canonicalName: "Sunrise Dental LLC",
  normalizedName: "sunrise dental",
  websiteDomain: "sunrise-dental.example",
  sourceNames: ["Sunrise Dental LLC", "Sunrise Family Dentistry"],
}]);
assert.equal(legalToDbaVariant.matches.length, 1,
  "a retrieved DBA can bridge an exact contact DBA to the canonical legal name");

assert.match(CONTACT_LINK_UNLINKED_SUNBIZ_NAME_MATCH_SQL, /sunbiz_entities_contact_identity_name_key_idx|regexp_replace/);
assert.match(CONTACT_LINK_UNLINKED_SUNBIZ_NAME_MATCH_SQL, /coalesce\(se\.dba/);
assert.match(CONTACT_LINK_UNLINKED_SUNBIZ_NAME_MATCH_SQL, /NOT EXISTS[\s\S]*canonical_source_links/);
assert.match(CONTACT_LINK_UNLINKED_SUNBIZ_NAME_MATCH_SQL, /sunbiz_entities' AND csl\.source_type = 'sunbiz_filing'/);
assert.match(CONTACT_LINK_UNLINKED_SUNBIZ_NAME_MATCH_SQL, /LIMIT \$2::integer/);
assert.doesNotMatch(CONTACT_LINK_UNLINKED_SUNBIZ_NAME_MATCH_SQL, /JOIN\s+contacts\s+ON\s+TRUE/i);

const serviceSource = read("server/services/contact-business-reconciliation.ts");
const routesSource = read("server/routes/admin.ts");
const linkAuthoritySource = read("server/services/commercial-link-authority.ts");
assert.match(serviceSource, /id > \$1[\s\S]*ORDER BY id[\s\S]*LIMIT \$2/);
assert.match(serviceSource, /website_domain = ANY\(\$1::text\[\]\)/);
assert.match(serviceSource, /findUnlinkedSunbizNameMatches\(contact\.company_name\)/);
assert.match(serviceSource, /rawCandidateCount/);
assert.match(serviceSource, /recordContactBusinessLinkCandidate/);
assert.match(serviceSource, /pg_try_advisory_lock/);
assert.match(serviceSource, /CONTACT_BUSINESS_RECONCILIATION_ALREADY_RUNNING/);
assert.match(serviceSource, /paidProviderCalls: 0/);
assert.doesNotMatch(serviceSource, /UPDATE\s+contacts\s+SET\s+business_id/i);
assert.doesNotMatch(serviceSource, /INSERT\s+INTO\s+contact_business_link_decisions/i);

for (const pathName of [
  "/api/admin/contact-business-reconciliation/preview",
  "/api/admin/contact-business-reconciliation/start",
  "/api/admin/contact-business-reconciliation/pause",
  "/api/admin/contact-business-reconciliation/resume",
  "/api/admin/contact-business-reconciliation/progress",
  "/api/admin/contact-business-suggestions",
  "/api/admin/contact-business-suggestions/review-batch",
]) {
  assert.ok(routesSource.includes(pathName), `admin route exists: ${pathName}`);
}
assert.match(routesSource, /contact-business-suggestions\/review-batch[\s\S]*requireRole\("admin"\)/);
assert.match(routesSource, /decideContactBusinessLink\(\{/);
assert.match(routesSource, /evidenceSourceEventId: item\.evidenceSourceEventId/);
assert.match(routesSource, /expectedRevision: item\.expectedRevision/);
assert.match(routesSource, /assertCurrentContactBusinessSuggestion/);
assert.match(routesSource, /authorityCheck: item\.decision === "verified"/);
assert.match(routesSource, /contact\.suppression_reason IS NULL/);
assert.match(routesSource, /contact\.existing_merchant_customer/);
const inTransactionReviewFence = routesSource.slice(
  routesSource.indexOf("authorityCheck: item.decision === \"verified\""),
  routesSource.indexOf(": undefined,", routesSource.indexOf("authorityCheck: item.decision === \"verified\"")),
);
assert.match(inTransactionReviewFence, /candidate\.id = \$\{item\.candidateId\}::uuid/);
assert.match(inTransactionReviewFence, /successor\.supersedes_candidate_id = candidate\.id/);
assert.match(inTransactionReviewFence, /contact\.suppression_reason IS NULL/);
assert.match(linkAuthoritySource, /COMMERCIAL_LINK_REVIEWER_MUST_BE_INDEPENDENT/);
assert.match(linkAuthoritySource, /input\.expectedRevision !== undefined[\s\S]*CommercialRevisionConflict/);

console.log("Contact/business reconciliation workflow source checks passed");