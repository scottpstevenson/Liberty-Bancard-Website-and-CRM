/**
 * Phase 6 CRM-10 / CRM-11: record-class scope and website-source provenance.
 *
 * Source/fixture proof only. Runs against the disposable test database, writes only uniquely tagged fixtures and
 * removes them. It does not claim production counts: production class distribution is read from live data only
 * through the read-only review cohorts after an owner Publish.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../server/db";
import {
  classifyWebsiteSourceDomain, hasIndependentOwnershipEvidence, hostFromWebsite, isDirectoryOrGovernmentDomain,
  websiteSourceNeedsOwnershipReview,
} from "../shared/source-domain-provenance";
import { dealReadPredicate } from "../server/services/revenue-read-authority";
import { countPendingMerchantApplications, listMerchantApplicationsPage } from "../server/services/merchant-application-read-model";
import { getRecordClassReviewCohorts, sourceDomainMatchSql } from "../server/services/record-class-review-cohorts";
import { WEBSITE_NOT_CONFIRMED_SUFFIX, websiteOwnershipSourceTypesSql } from "../server/services/website-ownership-evidence-sql";
import { recordClassBadge } from "../client/src/lib/record-class";

let checks = 0;
const ok = (value: unknown, message: string) => { assert.ok(value, message); checks++; };
const eq = <T>(actual: T, expected: T, message: string) => { assert.deepEqual(actual, expected, message); checks++; };
const rows = (result: any): any[] => (Array.isArray(result) ? result : result?.rows ?? []);

// ── Shared domain rule ───────────────────────────────────────────────────────
eq(hostFromWebsite("https://www.Yelp.com/biz/x"), "yelp.com", "scheme, www and case are normalized");
eq(hostFromWebsite("localhost"), null, "a bare word is not a host");
eq(hostFromWebsite(null), null, "null is not a host");
const matrix: Array<[string, "government" | "directory" | null]> = [
  ["yelp.com", "directory"], ["m.facebook.com", "directory"], ["https://www.bbb.org/us/fl", "directory"],
  ["miamidade.gov", "government"], ["floridahealth.gov", "government"], ["army.mil", "government"],
  ["agency.gov.uk", "government"], ["dos.state.fl.us", "government"], ["state.fl.us", "government"], ["gov.uk", "government"],
  ["joesplumbing.com", null], ["box.com", null], ["notyelp.com", null], ["government.com", null], ["bestdinerpizza.net", null],
];
for (const [host, kind] of matrix) eq(classifyWebsiteSourceDomain(host), kind, `${host} classifies as ${kind ?? "an ordinary site"}`);
ok(isDirectoryOrGovernmentDomain("yelp.com") && !isDirectoryOrGovernmentDomain("joesplumbing.com"), "boolean helper agrees");
eq(websiteSourceNeedsOwnershipReview("yelp.com", []), true, "a directory site with no evidence needs review");
eq(websiteSourceNeedsOwnershipReview("yelp.com", ["provider_import"]), true, "a provider import is the same observation, not independent evidence");
eq(websiteSourceNeedsOwnershipReview("yelp.com", ["organization"]), false, "a registry organization link is independent evidence");
eq(websiteSourceNeedsOwnershipReview("miamidade.gov", ["crm_organization"]), false, "a CRM organization link is independent evidence");
eq(websiteSourceNeedsOwnershipReview("joesplumbing.com", []), false, "an ordinary website never needs this review");
eq(hasIndependentOwnershipEvidence([null, undefined]), false, "empty evidence is not evidence");

// ── One list: no duplicated local copies, and every gate imports the rule ────
const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
for (const file of ["server/services/serper.ts", "server/services/serper-business-identity.ts"]) {
  const text = read(file);
  ok(!/const DIRECTORY_DOMAINS\b/.test(text), `${file} no longer keeps its own directory list`);
  ok(text.includes("@shared/source-domain-provenance"), `${file} uses the shared rule`);
}
for (const file of ["server/services/canonical-recipient-preparation.ts", "server/services/canonical-recipient-preparation-worker.ts", "server/services/sfp-launch-inventory.ts"]) {
  ok(read(file).includes("websiteSourceNeedsOwnershipReview"), `${file} applies the website ownership gate`);
}
ok(read("server/services/canonical-recipient-preparation.ts").includes("WEBSITE_SOURCE_OWNERSHIP_REVIEW_REQUIRED"), "the writer holds with a named reason");
for (const file of ["server/services/canonical-recipient-preparation.ts", "server/services/canonical-recipient-preparation-worker.ts", "server/services/sfp-launch-inventory.ts", "server/services/record-class-review-cohorts.ts"]) {
  const text = read(file);
  ok(text.includes("website-ownership-evidence-sql"), `${file} reads source types through the evidence-qualified helper`);
  ok(!/array_agg\(DISTINCT (s|sl)\.source_type\) FROM canonical_source_links/.test(text), `${file} no longer offers raw source types to the website gate`);
}
ok(read("server/services/revenue-read-authority.ts").includes("syntheticQaIdentitySql(`${alias}_qa`)"), "deal reads use the same QA signature as People");

// ── SQL parity: the review read classifies hosts exactly like the TypeScript rule ──
const hosts = matrix.map(([host]) => hostFromWebsite(host)!);
const matched = rows(await db.execute(sql`SELECT h FROM unnest(${sql.raw(`ARRAY[${hosts.map(h => `'${h}'`).join(",")}]::text[]`)}) AS t(h)
  WHERE ${sourceDomainMatchSql("t.h")}`)).map(r => String(r.h)).sort();
eq(matched, hosts.filter(h => classifyWebsiteSourceDomain(h) !== null).sort(), "SQL host match equals the shared TypeScript rule");

// ── Record-class presentation ────────────────────────────────────────────────
eq(recordClassBadge("production"), null, "production records carry no badge");
eq(recordClassBadge(null), null, "no class carries no badge");
eq(recordClassBadge("test")?.label, "Test record", "test records are labelled");
eq(recordClassBadge("unknown")?.label, "Class not reviewed", "unreviewed records are labelled, not called test");

// ── Fixtures: one production, one legacy-QA-signature, one test contact; deals and applications for each ──
const tag = `P6RC${randomUUID().slice(0, 8)}`;
const insertContact = async (first: string, last: string, email: string, phone: string, recordClass: string) =>
  Number(rows(await db.execute(sql`INSERT INTO contacts (first_name,last_name,email,phone,record_class)
    VALUES (${first},${last},${email},${phone},${recordClass}) RETURNING id`))[0].id);
const productionContact = await insertContact(tag, "Prod", `${tag.toLowerCase()}-prod@example.test`, "5550199", "production");
const qaContact = await insertContact("Liberty", "QaTest", `no-email-${randomUUID()}@no-email.libertybancard.internal`, "5550142", "production");
const testContact = await insertContact(tag, "Test", `${tag.toLowerCase()}-test@example.test`, "5550198", "test");
const insertDeal = async (contactId: number, recordClass: string) =>
  String(rows(await db.execute(sql`INSERT INTO deals (contact_id,record_class,pipeline,stage,name) VALUES (${contactId},${recordClass},'sales','new',${tag}) RETURNING id`))[0].id);
const dealProd = await insertDeal(productionContact, "production");
const dealQa = await insertDeal(qaContact, "production");
const dealTest = await insertDeal(testContact, "test");
const insertApplication = async (contactId: number | null) =>
  String(rows(await db.execute(sql`INSERT INTO merchant_applications (contact_id,legal_business_name,status)
    VALUES (${contactId},${`${tag} Co`},'submitted') RETURNING id`))[0].id);

// Website-ownership fixtures: one directory-host business per case, so each case is judged independently.
const insertBusiness = async (label: string, website: string | null) =>
  Number(rows(await db.execute(sql`INSERT INTO businesses (canonical_name,normalized_name,website_domain,record_class)
    VALUES (${`${tag} ${label}`},${`${tag.toLowerCase()} ${label.toLowerCase()}`},${website},'canonical') RETURNING id`))[0].id);
const insertLink = async (businessId: number, sourceSystem: string, sourceType: string, evidenceHost: string | null | undefined) =>
  db.execute(sql`INSERT INTO canonical_source_links (business_id,source_system,source_type,stable_key,raw_evidence)
    VALUES (${businessId},${sourceSystem},${sourceType},${`${tag}-${randomUUID()}`},
      ${evidenceHost === undefined ? null : JSON.stringify({ representation: "source_family_identity_v1", businessEvidence: evidenceHost === null ? {} : { websiteDomain: evidenceHost } })}::jsonb)`);
const bUnrelated = await insertBusiness("Unrelated", "yelp.com");
const bSilent = await insertBusiness("Silent", "yelp.com");
const bNoEvidence = await insertBusiness("NoEvidence", "yelp.com");
const bMatched = await insertBusiness("Matched", "www.Yelp.com");
const bMatchedUrl = await insertBusiness("MatchedUrl", "https://www.Yelp.com/biz/example/");
const bMatchedGov = await insertBusiness("MatchedGov", "miamidade.gov");
const bProviderOnly = await insertBusiness("ProviderOnly", "yelp.com");
const bNoSource = await insertBusiness("NoSource", "yelp.com");
const bOrdinary = await insertBusiness("Ordinary", "joesplumbing.example");
await insertLink(bUnrelated, "crm", "organization_location", "someone-elses-plumbing.com");
await insertLink(bUnrelated, "crm", "crm_organization", "another-unrelated-site.org");
await insertLink(bSilent, "crm", "organization_location", null);
await insertLink(bNoEvidence, "registry", "organization", undefined);
await insertLink(bMatched, "crm", "organization_location", "yelp.com");
await insertLink(bMatchedUrl, "crm", "organization_location", "yelp.com");
await insertLink(bMatchedGov, "crm", "crm_organization", "WWW.MiamiDade.gov/");
await insertLink(bProviderOnly, "outscraper", "place", "yelp.com");
const gateTypes = async (businessId: number): Promise<string[]> =>
  rows(await db.execute(sql`SELECT ${sql.raw(websiteOwnershipSourceTypesSql("sl", "b"))} AS types FROM businesses b WHERE b.id=${businessId}`))[0].types.slice().sort();
const gateHeld = async (businessId: number, website: string | null) => websiteSourceNeedsOwnershipReview(website, await gateTypes(businessId));

try {
  // Website ownership (CRM-10): an independent type clears a directory/government hold only when its recorded evidence names
  // this business's website host. Recorded policy: domain ownership as recorded by an independent source.
  eq(await gateTypes(bUnrelated), [`crm_organization${WEBSITE_NOT_CONFIRMED_SUFFIX}`, `organization_location${WEBSITE_NOT_CONFIRMED_SUFFIX}`],
    "unrelated organization links are offered as not confirming this website");
  eq(await gateHeld(bUnrelated, "yelp.com"), true, "NEGATIVE: unrelated organization sources do not clear the directory-host hold");
  eq(await gateHeld(bSilent, "yelp.com"), true, "NEGATIVE: an organization link whose evidence records no website does not clear the hold");
  eq(await gateHeld(bNoEvidence, "yelp.com"), true, "NEGATIVE: an organization link with no evidence at all does not clear the hold");
  eq(await gateHeld(bProviderOnly, "yelp.com"), true, "a provider place link never clears the hold");
  eq(await gateHeld(bNoSource, "yelp.com"), true, "a directory host with no source links is held");
  eq(await gateHeld(bMatched, "www.Yelp.com"), false, "POSITIVE: an organization link recording the same host (www and case ignored) clears it");
  eq(await gateHeld(bMatchedUrl, "https://www.Yelp.com/biz/example/"), false, "POSITIVE: scheme, www, case and path are ignored when comparing hosts");
  eq(await gateHeld(bMatchedGov, "miamidade.gov"), false, "POSITIVE: a CRM organization link recording the same government host clears it");
  eq(await gateHeld(bOrdinary, "joesplumbing.example"), false, "an ordinary website is never held by this rule");
  ok((await gateTypes(bProviderOnly)).join() === "place", "other source types pass through unchanged");

  // The review cohort uses the same rule: held businesses stay listed, a confirmed one leaves the list.
  const directory = (await getRecordClassReviewCohorts()).directoryDomainBusinesses as any;
  ok(directory.available === true, "the directory-host review cohort is available");
  const listed = new Set<number>(directory.sample.map((r: any) => r.businessId));
  // The sample is bounded (newest first); fixtures are the newest rows, so the held ones must be listed and the cleared must not.
  for (const id of [bUnrelated, bSilent, bNoEvidence, bProviderOnly, bNoSource]) ok(listed.has(id), `held business ${id} stays in the review cohort`);
  for (const id of [bMatched, bMatchedGov, bOrdinary]) ok(!listed.has(id), `business ${id} is not in the review cohort`);
  ok(directory.sample.find((r: any) => r.businessId === bUnrelated).sourceTypes.every((t: string) => t.endsWith(WEBSITE_NOT_CONFIRMED_SUFFIX)), "the cohort shows the unrelated links as not confirming");

  // Deals: the shared predicate keeps production deals of production contacts only.
  const values: unknown[] = [];
  const predicate = dealReadPredicate({ role: "admin", email: "admin@example.test" }, {}, values);
  const visible = rows(await db.execute(sql.raw(`SELECT d.id::text AS id FROM deals d WHERE d.name='${tag}' AND ${predicate}`))).map(r => String(r.id));
  eq(visible, [dealProd], "the Pipeline predicate shows only the production deal of a production contact");
  ok(!visible.includes(dealQa), "a production-class deal on a legacy QA-signature contact is excluded from production reads");
  ok(!visible.includes(dealTest), "a test-class deal is excluded from production reads");

  // Applications: production scope hides only authoritative non-production links; unlinked stays visible; all shows everything labelled.
  const pendingBefore = await countPendingMerchantApplications();
  const appProd = await insertApplication(productionContact);
  const appTest = await insertApplication(testContact);
  const appUnlinked = await insertApplication(null);
  const scoped = await listMerchantApplicationsPage({ search: tag, recordScope: "production" });
  eq(scoped.rows.map(r => String(r.id)).sort(), [appProd, appUnlinked].sort(), "production scope lists production-linked and unlinked applications");
  eq([scoped.total, scoped.hiddenByRecordClass], [2, 1], "the hidden count is the exact number the class rule removed");
  const everything = await listMerchantApplicationsPage({ search: tag, recordScope: "all" });
  eq([everything.total, everything.hiddenByRecordClass], [3, 0], "the all scope shows every application and hides none");
  eq(everything.rows.find(r => String(r.id) === appTest)?.contactRecordClass, "test", "a test-linked application carries its authoritative class");
  eq(everything.rows.find(r => String(r.id) === appUnlinked)?.contactRecordClass, null, "an unlinked application has no class and is not called test");
  eq((await listMerchantApplicationsPage({ search: tag })).total, 2, "production is the default scope");
  eq(await countPendingMerchantApplications(), pendingBefore + 2, "the pending count uses the same production rule as the list");

  // Review cohorts: read-only, bounded, each section available, and the fixtures are found.
  const cohorts = await getRecordClassReviewCohorts();
  eq(cohorts.readOnly, true, "the review cohorts declare themselves read-only");
  for (const [name, section] of Object.entries({
    nonProduction: cohorts.nonProductionRecords, legacyQa: cohorts.legacyQaSignatureInProduction, directory: cohorts.directoryDomainBusinesses,
  })) ok((section as any).available === true, `${name} cohort is available`);
  const qa = cohorts.legacyQaSignatureInProduction as any;
  ok(qa.contactCount >= 1 && qa.sample.some((r: any) => r.contactId === qaContact), "the legacy QA signature contact is listed for review");
  ok(!qa.sample.some((r: any) => r.contactId === productionContact), "an ordinary production contact is not listed");
  ok(qa.dealsExcludedFromProductionReads >= 1, "the QA contact's deal is counted as excluded");
  ok(qa.sample.length <= cohorts.sampleLimit, "the sample is bounded");
  const nonProd = cohorts.nonProductionRecords as any;
  ok(nonProd.dealSample.some((r: any) => r.dealId === dealTest), "the test-class deal is listed");
  ok(nonProd.applicationSample.some((r: any) => r.applicationId === appTest), "the test-linked application is listed");
  ok(!JSON.stringify(cohorts).includes("@"), "no email address appears in the cohort payload");
} finally {
  await db.execute(sql`DELETE FROM merchant_applications WHERE legal_business_name=${`${tag} Co`}`);
  await db.execute(sql`DELETE FROM deals WHERE name=${tag}`);
  await db.execute(sql`DELETE FROM contacts WHERE id IN (${productionContact},${qaContact},${testContact})`);
  await db.execute(sql`DELETE FROM canonical_source_links WHERE stable_key LIKE ${`${tag}-%`}`);
  await db.execute(sql`DELETE FROM businesses WHERE canonical_name LIKE ${`${tag} %`}`);
}

console.log(`PHASE6_PROVENANCE_RECORD_CLASS_PASS (${checks} checks)`);
process.exit(0);
