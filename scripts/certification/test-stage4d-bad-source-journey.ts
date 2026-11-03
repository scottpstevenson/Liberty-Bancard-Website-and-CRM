/**
 * Stage 4D bad-source / identity exclusion journey — disposable database only, no provider, no message.
 *
 * One population (> 500 fixtures across seven classes, plus a clean control class) is pushed through the REAL authorities:
 *   - evaluateContactDecisions / evaluateBusinessPromotionEligibility (DBPR-family lineage, any spelling)
 *   - the domain/location contact-to-business policy (QA/test/archive contacts, directory/person domains,
 *     unverifiable affiliation, ambiguous shared domain / competing identity at one address)
 *   - the geography resolver (out-of-county, out-of-state, unresolved)
 * Each class records WHICH authority excluded it. Nothing here forces equal counts between different units: contacts,
 * businesses and candidates are counted separately. A class that no authority excluded fails the run, and the clean
 * control class must stay eligible through every authority (negative control for over-blocking).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertDisposableTestInfrastructure } from "../test-infrastructure-guard";

await assertDisposableTestInfrastructure({ operation: "Stage 4D bad-source journey" });
const { db, pool } = await import("../../server/db");
const { sql } = await import("drizzle-orm");
const { evaluateContactDecisions, evaluateBusinessPromotionEligibility } = await import("../../server/services/contactability");
const { evaluateDomainLocationPolicy } = await import("../../server/services/contact-business-domain-location-links");
const { resolveGeographyFromCandidates } = await import("../../server/services/cro03/sfp-geography-resolver");

let checks = 0;
const check = (v: unknown, message: string) => { assert(v, message); checks++; console.log(`✓ [BS-${String(checks).padStart(2, "0")}] ${message}`); };
const tag = `bs${randomUUID().replaceAll("-", "").slice(0, 8)}`;

type Fx = { cls: string; contactId: number; businessId: number | null; domain: string | null };
const fixtures: Fx[] = [];
let seq = 0;
const word = (n: number) => { const letters = "abcdefghijklmnopqrstuvwxyz"; let s = ""; let v = n + 1; while (v > 0) { s = letters[(v - 1) % 26] + s; v = Math.floor((v - 1) / 26); } return s; };

async function business(opts: { name: string; domain: string | null; city?: string | null; state?: string | null; source?: string | null; links?: string[] }) {
  const norm = opts.name.toLowerCase();
  const id = Number((await pool.query(
    `INSERT INTO businesses (canonical_name, normalized_name, record_class, city, state, website_domain, last_source_type)
     VALUES ($1,$2,'canonical',$3,$4,$5,$6) RETURNING id`,
    [opts.name, norm, opts.city === undefined ? "Miami" : opts.city, opts.state === undefined ? "FL" : opts.state, opts.domain, opts.source === undefined ? "sunbiz" : opts.source])).rows[0].id);
  for (const system of opts.links ?? []) {
    await pool.query(`INSERT INTO canonical_source_links (business_id, source_system, source_type, stable_key) VALUES ($1,$2,'entity',$3)`, [id, system, `${tag}-${id}-${system}`]);
  }
  return id;
}
async function contact(cls: string, opts: { company: string; email: string | null; website?: string | null; city?: string | null; state?: string | null;
  recordClass?: string; archived?: boolean; businessId?: number | null; domain: string | null }) {
  seq++;
  const id = Number((await pool.query(
    `INSERT INTO contacts (first_name,last_name,email,phone,company_name,website,city,state,record_class,archived_at,lead_source,email_status,business_id)
     VALUES ('Fx',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'valid',$11) RETURNING id`,
    [`${cls}${seq}`, opts.email, `+1305${String(7000000 + seq).padStart(7, "0")}`, opts.company, opts.website ?? null,
      opts.city === undefined ? "Miami" : opts.city, opts.state === undefined ? "FL" : opts.state, opts.recordClass ?? "production",
      opts.archived ? new Date() : null, tag, opts.businessId ?? null])).rows[0].id);
  fixtures.push({ cls, contactId: id, businessId: opts.businessId ?? null, domain: opts.domain });
  return id;
}
const dom = (cls: string, i: number) => `${cls}-${word(i)}-${tag}.example.test`;

// ── Fixtures ─────────────────────────────────────────────────────────────────────────────────────────────────────
// CLEAN control: matching name, independent source, affirmed location, own domain.
for (let i = 0; i < 100; i++) {
  const d = dom("clean", i), name = `Alpha ${word(i)} Cleanco`;
  const b = await business({ name: `${name} Inc`, domain: d, links: ["sunbiz"] });
  await contact("clean", { company: `${name} LLC`, email: `owner@${d}`, website: `https://www.${d}`, domain: d, businessId: null });
  fixtures[fixtures.length - 1].businessId = b;
}
// DBPR lineage in four spellings; the contact is otherwise clean.
const DBPR_SPELLINGS = ["dbpr_hr", "DBPR-ABT", "dbpr/cos", "Dbpr_Bar"];
for (let i = 0; i < 100; i++) {
  const d = dom("dbpr", i), name = `Bravo ${word(i)} Dbprco`;
  const b = await business({ name: `${name} Inc`, domain: d, links: [DBPR_SPELLINGS[i % 4]] });
  await contact("dbpr", { company: `${name} LLC`, email: `owner@${d}`, website: `https://${d}`, domain: d });
  fixtures[fixtures.length - 1].businessId = b;
}
// QA / test / archive contacts that would otherwise match a clean business exactly.
const QA = [{ recordClass: "test" }, { recordClass: "demo" }, { recordClass: "synthetic" }, { recordClass: "production", archived: true }];
for (let i = 0; i < 100; i++) {
  const d = dom("qa", i), name = `Charlie ${word(i)} Qaco`;
  await business({ name: `${name} Inc`, domain: d, links: ["sunbiz"] });
  await contact("qa", { company: `${name} LLC`, email: `owner@${d}`, website: `https://${d}`, domain: d, ...QA[i % 4] });
}
// Directory and personal-mailbox domains: the only "domain" is a shared one, which can never identify a business.
const SHARED = ["gmail.com", "yelp.com", "facebook.com", "linktr.ee"];
for (let i = 0; i < 100; i++) {
  const shared = SHARED[i % 4], name = `Delta ${word(i)} Directoryco`;
  await business({ name: `${name} Inc`, domain: shared, links: ["sunbiz"] });
  await contact("directory", { company: `${name} LLC`, email: i % 2 ? `someone${i}@${shared}` : null, website: i % 2 ? null : `https://${shared}/${word(i)}`, domain: shared });
}
// Unverifiable affiliation: name mismatch, location not affirmed, business is only contact-derived (no independent source).
for (let i = 0; i < 120; i++) {
  const d = dom("affil", i), kind = i % 3, name = `Echo ${word(i)} Affilco`;
  if (kind === 0) { await business({ name: `${name} Inc`, domain: d, links: ["sunbiz"] }); await contact("affil", { company: `Totally Different ${word(i)} Name`, email: `a@${d}`, website: `https://${d}`, domain: d }); }
  if (kind === 1) { await business({ name: `${name} Inc`, domain: d, links: ["sunbiz"] }); await contact("affil", { company: `${name} LLC`, email: `a@${d}`, website: `https://${d}`, city: "Orlando", domain: d }); }
  if (kind === 2) { await business({ name: `${name} Inc`, domain: d, source: "crm", links: ["crm"] }); await contact("affil", { company: `${name} LLC`, email: `a@${d}`, website: `https://${d}`, domain: d }); }
}
// Ambiguous shared address / domain: two businesses on one domain; two competing identities at the same address; two brands on one domain.
for (let i = 0; i < 110; i++) {
  const d = dom("shared", i), kind = i % 3, name = `Foxtrot ${word(i)} Sharedco`;
  if (kind === 0) { await business({ name: `${name} Inc`, domain: d, links: ["sunbiz"] }); await business({ name: `${name} Two Inc`, domain: d, links: ["sunbiz"] }); await contact("shared", { company: `${name} LLC`, email: `a@${d}`, website: `https://${d}`, domain: d }); }
  if (kind === 1) { await business({ name: `${name} Inc`, domain: d, links: ["sunbiz"] }); await business({ name: `${name} LLC`, domain: d, links: ["sunbiz"] }); await contact("shared", { company: `${name} Corp`, email: `a@${d}`, website: `https://${d}`, domain: d }); }
  if (kind === 2) { await business({ name: `${name} Inc`, domain: d, links: ["sunbiz"] }); await contact("shared", { company: `${name} LLC`, email: `a@${d}`, website: `https://${d}`, domain: d }); await contact("shared", { company: `Another Brand ${word(i)} Studio`, email: `b@${d}`, website: `https://${d}`, domain: d }); }
}
// Out-of-county / out-of-state / unresolved candidates go through the geography resolver (no database needed for the rule).
const geoCases: Array<{ fips: string | null; state: string; city: string | null }> = [];
for (let i = 0; i < 60; i++) geoCases.push(i % 3 === 0 ? { fips: "12057", state: "FL", city: "Tampa" } : i % 3 === 1 ? { fips: "13121", state: "GA", city: "Atlanta" } : { fips: null, state: "FL", city: null });

const total = fixtures.length + geoCases.length;
check(total > 500, `the journey holds ${total} fixtures (> 500): ${[...new Set(fixtures.map(f => f.cls))].map(c => `${c} ${fixtures.filter(f => f.cls === c).length}`).join(", ")}, geography ${geoCases.length}`);

// ── Authorities ──────────────────────────────────────────────────────────────────────────────────────────────────
const filter = sql`c.lead_source = ${tag}`;
const policyRows = await evaluateDomainLocationPolicy(db, filter);
const byContact = new Map<number, typeof policyRows>();
for (const r of policyRows) byContact.set(r.contactId, [...(byContact.get(r.contactId) ?? []), r]);
const policyEligible = (id: number) => (byContact.get(id) ?? []).filter(r => r.eligible).length === 1 && (byContact.get(id) ?? []).length === 1;
const policyReasons = (id: number) => new Set((byContact.get(id) ?? []).flatMap(r => r.reasons));

// The decision authority is evaluated for the business each contact would be attached to.
const decisions = new Map<number, Awaited<ReturnType<typeof evaluateContactDecisions>>>();
const promotion = new Map<number, Awaited<ReturnType<typeof evaluateBusinessPromotionEligibility>>>();
for (const f of fixtures) {
  if (f.businessId == null) continue;
  decisions.set(f.contactId, await evaluateContactDecisions({ contactId: f.contactId, businessId: f.businessId }));
  promotion.set(f.contactId, await evaluateBusinessPromotionEligibility(f.businessId));
}
const of = (cls: string) => fixtures.filter(f => f.cls === cls);

// CLEAN control
{
  const rows = of("clean");
  check(rows.every(f => policyEligible(f.contactId)), `control: all ${rows.length} clean contacts are eligible through the domain/location policy (the policy does not over-block)`);
  check(rows.every(f => { const d = decisions.get(f.contactId)!; return d.dataHygiene.status === "eligible" && d.enrichment.status === "eligible" && d.promotion.status === "eligible"; }),
    "control: the same clean contacts are eligible on hygiene, enrichment and promotion");
}
// DBPR
{
  const rows = of("dbpr");
  const blocked = rows.filter(f => { const d = decisions.get(f.contactId)!; return [d.dataHygiene, d.enrichment, d.promotion].every(x => x.status === "blocked" && x.reasonCodes.includes("DBPR_LINEAGE")) && promotion.get(f.contactId)!.status === "blocked"; });
  check(blocked.length === rows.length, `DBPR lineage: all ${rows.length} contacts (four link spellings) are blocked on hygiene, enrichment and promotion with DBPR_LINEAGE`);
  const passedPolicy = rows.filter(f => policyEligible(f.contactId)).length;
  check(passedPolicy > 0, `DBPR lineage is NOT the domain policy's job: ${passedPolicy} DBPR contacts pass it, so the decision authority is the only exclusion (documented boundary, not a gap)`);
}
// QA / test / archive
{
  const rows = of("qa");
  check(rows.every(f => !byContact.has(f.contactId)), `QA/test/demo/synthetic/archived: all ${rows.length} contacts produce no candidate link, even though each matches its business exactly`);
}
// Directory / person domains
{
  const rows = of("directory");
  check(rows.every(f => !byContact.has(f.contactId)), `directory and personal-mailbox domains: all ${rows.length} contacts (gmail, yelp, facebook, linktr.ee) can never become a candidate link`);
}
// Unverifiable affiliation
{
  const rows = of("affil");
  const reasons = new Set(rows.flatMap(f => [...policyReasons(f.contactId)]));
  check(rows.every(f => !policyEligible(f.contactId)), `unverifiable affiliation: none of ${rows.length} contacts is eligible`);
  check(["company_name_mismatch", "location_not_affirmed", "business_not_independent"].every(r => reasons.has(r)), `each unverifiable kind is named (${[...reasons].sort().join(", ")})`);
}
// Ambiguous shared address / domain
{
  const rows = of("shared");
  const reasons = new Set(rows.flatMap(f => [...policyReasons(f.contactId)]));
  check(rows.every(f => !policyEligible(f.contactId)), `ambiguous shared address/domain: none of ${rows.length} contacts is eligible`);
  check(["multiple_businesses_on_domain", "shared_brand_domain"].every(r => reasons.has(r)), `ambiguity is named (${[...reasons].sort().join(", ")})`);
}
// Geography
{
  const eligible = geoCases.filter(c => resolveGeographyFromCandidates([{ locationId: 1, isPrimary: true, city: c.city, state: c.state, postalCode: null, countyFips: c.fips }]).eligible);
  check(eligible.length === 0, `out-of-county / out-of-state / unresolved: none of ${geoCases.length} candidates is eligible for the three-county program`);
  const inCounty = resolveGeographyFromCandidates([{ locationId: 1, isPrimary: true, city: "Miami", state: "FL", postalCode: null, countyFips: "12086" }]);
  check(inCounty.eligible, "control: a Miami-Dade candidate is eligible through the same resolver");
}

// ── Journey gate: exclusion by exactly the authority that owns each class; no class escapes all authorities ─────
const journeyEligible = (f: Fx) => {
  const d = f.businessId != null ? decisions.get(f.contactId) : undefined;
  const decisionsOk = !!d && d.dataHygiene.status === "eligible" && d.enrichment.status === "eligible" && d.promotion.status === "eligible";
  return policyEligible(f.contactId) && decisionsOk;
};
const survivors = fixtures.filter(journeyEligible);
check(survivors.length === of("clean").length && survivors.every(f => f.cls === "clean"),
  `end to end: ${survivors.length} of ${fixtures.length} contact fixtures survive every authority, and every survivor is from the clean control class`);
const distinctBusinesses = new Set(survivors.map(f => f.businessId)).size;
check(distinctBusinesses === survivors.length, `unit check: ${survivors.length} eligible contacts map to ${distinctBusinesses} distinct businesses (contacts and businesses are counted separately)`);

// Negative control: removing the DBPR authority would let DBPR contacts through the policy alone.
check(of("dbpr").some(f => policyEligible(f.contactId)), "negative control: judged by the domain policy alone, DBPR contacts would survive; the decision authority is what stops them");

await pool.query(`DELETE FROM contacts WHERE lead_source = $1`, [tag]);
console.log(`\nStage 4D bad-source journey: ${checks} checks passed.`);
await pool.end();
