import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";
import { corroboratedIdentitySignals, identityName, identityPhone } from "../server/services/contact-business-corroborated-policy";
import { sfpAiVerticalResponseSchema, validateSfpAiVerticalResult } from "../server/services/cro03/sfp-ai-vertical-result";

await assertDisposableTestInfrastructure({ operation: "Corroborated company links", requireRedis: false });
const { db, pool } = await import("../server/db");
const { previewCorroboratedContactBusinessLinks: preview, confirmCorroboratedContactBusinessLink: confirm } =
  await import("../server/services/contact-business-corroborated-links");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const nonce = randomUUID();
const adminId = `match-admin-${nonce}`;
const agentId = `match-agent-${nonce}`;
let phoneSerial = 0;
let checks = 0;
function check(value: unknown, label: string) {
  assert.ok(value, label); checks++; console.log(`✓ ${label}`);
}
async function fixture(label: string, options: { website?: boolean; gmail?: boolean; suppressed?: boolean } = {}) {
  const name = `Offline ${label} ${nonce} Roofing LLC`;
  const phone = `305${String(7100000 + phoneSerial++).padStart(7, "0")}`;
  const domain = `${label}-${nonce}.example.test`;
  const business = (await client.query(`INSERT INTO businesses
    (canonical_name,normalized_name,main_phone,website_domain,record_class)
    VALUES ($1,$2,$3,$4,'canonical') RETURNING id`,
  [name, identityName(name), phone, options.website ? domain : null])).rows[0];
  const contact = (await client.query(`INSERT INTO contacts
    (first_name,last_name,email,phone,company_name,website,record_class,do_not_contact,opted_out_email,email_status)
    VALUES ('Offline','Fixture',$1,$2,$3,$4,'production',$5,$5,$6) RETURNING id`,
  [options.gmail ? `${label}@gmail.com` : `owner@${domain}`, `+1${phone}`,
    name.replace(/ LLC$/, ", Inc."), options.website ? `https://${domain}/contact` : null,
    Boolean(options.suppressed), options.suppressed ? "invalid" : "unvalidated"])).rows[0];
  const page = await preview({ afterContactId: contact.id - 1, limit: 1 });
  return { row: page.rows[0], contactId: Number(contact.id), businessId: Number(business.id), phone, name };
}
try {
  await client.query(`INSERT INTO users (id,email,role) VALUES ($1,$2,'admin'),($3,$4,'agent')`,
    [adminId, `${nonce}@admin.example.test`, agentId, `${nonce}@agent.example.test`]);
  check(identityName("Acme, LLC") === identityName("ACME Inc."), "Legal suffixes and punctuation do not block matching");
  check(identityPhone("+1 (305) 777-8899") === identityPhone("3057778899"), "Phone formatting is normalized");
  check(corroboratedIdentitySignals(
    { name: "Acme", website: null, email: "owner@gmail.com", phone: "3057778899" },
    { name: "Acme LLC", website: null, phone: "3057778899" }).includes("matching_phone"),
  "Gmail plus matching company/phone works without a website or Sunbiz");
  check(corroboratedIdentitySignals(
    { name: "Acme", website: "other.example.test", phone: "3057778899" },
    { name: "Acme LLC", website: "acme.example.test", phone: "3057778899" }).length === 0,
  "Contradictory populated domains are not silently ignored");
  const valid = await fixture("valid", { gmail: true });
  check(valid.row.eligible && valid.row.businessId === valid.businessId, "Real SQL finds a unique no-website Gmail match");
  check(valid.row.signals.includes("matching_phone"), "Preview explains the corroboration");
  const before = (await client.query("SELECT COUNT(*) FROM contact_source_events")).rows[0].count;
  await preview({ afterContactId: valid.contactId - 1, limit: 1 });
  check((await client.query("SELECT COUNT(*) FROM contact_source_events")).rows[0].count === before, "Preview writes no evidence or decisions");
  const item = { contactId: valid.contactId, businessId: valid.businessId, snapshotHash: valid.row.snapshotHash! };
  const saved = await confirm(item, adminId);
  check(saved.status === "applied", `Confirmation succeeds through the real authority/trigger: ${JSON.stringify(saved)}`);
  const linked = (await client.query(`SELECT c.business_id,d.reviewed_by,d.actor_id,e.source_type,e.metadata
    FROM contacts c JOIN contact_business_link_decisions d ON d.contact_id=c.id AND d.superseded_at IS NULL
    JOIN contact_source_events e ON e.id=d.evidence_source_event_id WHERE c.id=$1`, [valid.contactId])).rows[0];
  check(linked.business_id === valid.businessId && linked.reviewed_by === adminId && linked.actor_id === adminId,
    "Saved link is explicitly admin-confirmed, not falsely system-verified");
  check(linked.metadata.evidenceKind === "corroborated_crm_identity_match", "Evidence is truthfully software corroboration, not invented registry or provider proof");
  check((await confirm(item, adminId)).status === "replayed", "Retry does not duplicate the relationship");
  const suppressed = await fixture("suppressed", { gmail: true, suppressed: true });
  check(suppressed.row.eligible, "Outreach suppression and invalid email do not veto identity matching");
  check((await confirm({ contactId: suppressed.contactId, businessId: suppressed.businessId,
    snapshotHash: suppressed.row.snapshotHash! }, adminId)).status === "applied", "Suppressed contact can be related to its company");
  const flags = (await client.query("SELECT do_not_contact,opted_out_email,email_status FROM contacts WHERE id=$1", [suppressed.contactId])).rows[0];
  check(flags.do_not_contact && flags.opted_out_email && flags.email_status === "invalid", "Linking does not clear suppression or manufacture validation");
  const stale = await fixture("stale", { website: true });
  await client.query("UPDATE contacts SET phone='3059990000',website=NULL,email='owner@gmail.com' WHERE id=$1", [stale.contactId]);
  check((await confirm({ contactId: stale.contactId, businessId: stale.businessId,
    snapshotHash: stale.row.snapshotHash! }, adminId)).status === "rejected", "Changed matching facts cannot be confirmed");
  const ambiguous = await fixture("ambiguous", { gmail: true });
  await client.query(`INSERT INTO businesses (canonical_name,normalized_name,main_phone,record_class)
    VALUES ($1,$2,$3,'canonical')`, [ambiguous.name, identityName(ambiguous.name), ambiguous.phone]);
  const ambiguousRow = (await preview({ afterContactId: ambiguous.contactId - 1, limit: 1 })).rows[0];
  check(!ambiguousRow.eligible && ambiguousRow.reasons.includes("multiple_corroborated_businesses"), "Competing corroborated companies remain unresolved");
  const noProof = await fixture("name-only", { gmail: true });
  await client.query("UPDATE contacts SET phone='' WHERE id=$1", [noProof.contactId]);
  const nameOnly = (await preview({ afterContactId: noProof.contactId - 1, limit: 1 })).rows[0];
  check(nameOnly.eligible && nameOnly.matchBasis === "unique_company_name",
    "A unique company name can be explicitly confirmed without manufacturing phone/domain evidence");
  check((await client.query("SELECT business_id FROM contacts WHERE id=$1", [noProof.contactId])).rows[0].business_id == null,
    "A name match does not automatically verify or link the contact");
  check((await confirm({ contactId: noProof.contactId, businessId: noProof.businessId,
    snapshotHash: nameOnly.snapshotHash! }, adminId)).status === "applied",
    "Explicit admin confirmation saves a name-only association through the real database guard");
  const denied = await fixture("role-denied", { gmail: true });
  const deniedResult = await confirm({ contactId: denied.contactId, businessId: denied.businessId,
    snapshotHash: denied.row.snapshotHash! }, agentId);
  check(deniedResult.status === "rejected" && deniedResult.code === "COMMERCIAL_LINK_REVIEWER_ROLE_INVALID", "An agent cannot confer admin-reviewed link authority");
  check((await client.query("SELECT business_id FROM contacts WHERE id=$1", [denied.contactId])).rows[0].business_id == null,
    "Role rejection leaves the contact unlinked");
  check((await client.query("SELECT COUNT(*)::int AS n FROM contact_source_events WHERE contact_id=$1", [denied.contactId])).rows[0].n === 0,
    "Role rejection produces no matching observations");
  const taxonomy = ["Automotive", "Healthcare"];
  const modelResult = { outcome: "target", confidence: 0.9, reasonCodes: ["PRIMARY_BUSINESS_ACTIVITY"], resolvedVerticalId: "Healthcare" };
  check(sfpAiVerticalResponseSchema(taxonomy).schema.required.includes("resolvedVerticalId"), "Paid AI schema requires the specific vertical");
  check(validateSfpAiVerticalResult(modelResult, taxonomy)?.resolvedVerticalId === "Healthcare", "Paid target classification retains its actual vertical");
  check(validateSfpAiVerticalResult({ ...modelResult, resolvedVerticalId: null }, taxonomy) === null, "Generic target with no assigned vertical is not a valid AI result");
  check(validateSfpAiVerticalResult({ ...modelResult, resolvedVerticalId: "Invented" }, taxonomy) === null, "AI cannot invent a taxonomy ID");
  check(validateSfpAiVerticalResult({ ...modelResult, outcome: "non_target", resolvedVerticalId: null }, taxonomy)?.resolvedVerticalId === null,
    "Non-target classifications do not claim a target vertical");
  const aiBusiness = (await client.query(`INSERT INTO businesses
    (canonical_name,normalized_name,city,state,postal_code,record_class)
    VALUES ($1,$1,'Miami','FL','33130','canonical') RETURNING id`, [`Cumulus ${nonce}`])).rows[0];
  const program = (await client.query(`INSERT INTO sfp_programs
    (name,county_fips,vertical_ids,max_cohort_size,policy_version,taxonomy_version,is_active,recurring_enabled,created_by)
    VALUES ($1,ARRAY['12086'],ARRAY['Healthcare'],25,1,2,false,false,$2) RETURNING id`, [`offline-${nonce}`, adminId])).rows[0];
  const { runPreCohortClassificationBridge } = await import("../server/services/cro03/sfp-classification-bridge");
  const classificationRun = await runPreCohortClassificationBridge({
    programId: String(program.id), idempotencyKey: `ai-vertical-${nonce}`, actorId: adminId,
    maxBusinesses: 1, targetIds: ["Healthcare"], policyVersion: 1,
    businessIdFilter: [Number(aiBusiness.id)],
  }, { openAiClassify: async () => ({
    outcome: "target", confidence: 0.9, reasonCodes: ["OFFLINE_MODEL_FIXTURE"],
    resolvedVerticalId: "Healthcare", modelVersion: "offline-fixture-model", promptVersion: "offline-v2", costMicros: 0,
  }) });
  const assigned = (await client.query(`SELECT resolved_vertical_id,admission_tier FROM sfp_classification_evidence
    WHERE business_id=$1 ORDER BY created_at DESC LIMIT 1`, [aiBusiness.id])).rows[0];
  check(classificationRun.targetCount === 1 && assigned?.resolved_vertical_id === "Healthcare",
    "Classification bridge persists the AI vertical into real evidence");
  check(assigned.admission_tier === null, "AI output is not falsely relabelled as deterministic admission evidence");
  console.log(`PASS: ${checks} corroborated-link checks; no providers or outbound operations.`);
} finally {
  await client.end();
  await pool.end();
}