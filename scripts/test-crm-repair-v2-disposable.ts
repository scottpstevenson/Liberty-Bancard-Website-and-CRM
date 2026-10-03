import assert from "node:assert/strict";
import crypto from "node:crypto";
import { pool,db } from "../server/db";
import { previewContactBusinessSystemLinks,applyContactBusinessSystemLink } from "../server/services/contact-business-system-links";
import { convergeSfpRecipientPolicyV2 } from "../server/services/cro03/sfp-recipient-policy-convergence";
import { getActiveSfpOutreachPolicy,evaluateSfpEmailTypePolicy } from "../server/services/cro03/sfp-outreach-policy";
import { getUnifiedSfpCandidates } from "../server/services/cro03/sfp-paid-evidence-writer";
import { classifySfpRecipientFacts } from "../server/services/cro03/sfp-recipient-classification";
import { processEffectiveVerticalProjectionTick } from "../server/services/crm-effective-vertical-projection";
import { effectiveContactVerticalSql,effectiveBusinessVerticalSql } from "../shared/effective-vertical";

const prefix = `crm-v2-${crypto.randomUUID()}`;
let checks = 0;
function check(value: unknown,message: string) { assert.ok(value,message); checks++; }
async function fixture(suffix: string,corroborated = true) {
  const name = `${prefix}-${suffix}`;
  const b = (await pool.query(`INSERT INTO businesses
    (canonical_name,normalized_name,record_class,street_address,city,state,vertical)
    VALUES($1,$1,'canonical','123 Fixture St','Miami','FL','Gym') RETURNING id`,[name])).rows[0];
  const e = (await pool.query(`INSERT INTO sunbiz_entities
    (filing_number,entity_name,source,principal_address,principal_city,principal_state,dba)
    VALUES($1,$2,'sunbiz','123 Fixture St','Miami','FL',$3) RETURNING id`,
  [name,`${name} LLC`,`${name} Trade`])).rows[0];
  const sl = (await pool.query(`INSERT INTO canonical_source_links
    (business_id,source_system,source_type,stable_key)
    VALUES($1,'sunbiz','sunbiz_entity',$2) RETURNING id`,[b.id,name])).rows[0];
  const c = (await pool.query(`INSERT INTO contacts
    (first_name,last_name,email,phone,company_name,record_class,address,city,state,email_status,do_not_contact)
    VALUES('Fixture','Person',$1,'',$2,'production',$3,'Miami','FL','invalid',TRUE) RETURNING id`,
  [`${suffix}@gmail.com`,`${name} Trade`,corroborated ? '123 Fixture St' : null])).rows[0];
  return { businessId: Number(b.id),entityId: Number(e.id),sourceId: sl.id,contactId: Number(c.id) };
}
async function main() {
  const safe = (await pool.query(`SELECT current_database() LIKE 'test_sfp2060_crm_repair_v2_%' AS safe`)).rows[0]?.safe;
  assert.equal(safe,true,"must run through the private disposable launcher");
  const good = await fixture("corroborated");
  const preview = await previewContactBusinessSystemLinks({afterContactId: good.contactId-1,limit: 1});
  check(preview.schemaReady,"matching native relationship evaluator is installed");
  check(preview.rows[0]?.eligible,"trusted DBA + address establishes a relationship without a website/corporate email");
  const result = await applyContactBusinessSystemLink(preview.rows[0] as any);
  check(result.status==="applied",`real writer and trigger agree: ${JSON.stringify(result)}`);
  const decision = (await pool.query(`SELECT d.actor_id,d.reviewed_by,d.reviewed_at,e.rule_version
    FROM contact_business_link_decisions d JOIN contact_business_system_link_evidence e
      ON e.id=d.system_evidence_id WHERE d.contact_id=$1`,[good.contactId])).rows[0];
  check(decision.actor_id==="system" && decision.reviewed_by===null && decision.reviewed_at===null,
    "automatic relationship does not manufacture human approval");
  check(decision.rule_version==="crm_evidence_identity_v2","evidence identifies the current rule");
  check((await applyContactBusinessSystemLink(preview.rows[0] as any)).status==="replayed","repeat is idempotent");
  const weak = await fixture("name-only",false);
  const weakPreview = await previewContactBusinessSystemLinks({afterContactId:weak.contactId-1,limit:1});
  check(!weakPreview.rows[0]?.eligible,"name-only remains unresolved including SQL NULL domain values");
  const capacity = await pool.query(`SELECT conname FROM pg_constraint
    WHERE conrelid='sfp_global_recipient_slots'::regclass AND contype IN ('c','u')`);
  check(capacity.rows.length===4,"range and three native uniqueness contracts exist");
  for (let i=1;i<=3;i++) await pool.query(`INSERT INTO sfp_global_recipient_slots
    (business_id,recipient_identity_hash,slot) VALUES($1,$2,$3)`,
  [good.businessId,crypto.createHash("sha256").update(`${prefix}-${i}`).digest("hex"),i]);
  await assert.rejects(pool.query(`INSERT INTO sfp_global_recipient_slots
    (business_id,recipient_identity_hash,slot) VALUES($1,$2,4)`,
  [good.businessId,crypto.createHash("sha256").update(`${prefix}-four`).digest("hex")]),/check constraint/i); checks++;
  await assert.rejects(pool.query(`INSERT INTO sfp_global_recipient_slots
    (business_id,recipient_identity_hash,slot) VALUES($1,$2,1)`,
  [weak.businessId,crypto.createHash("sha256").update(`${prefix}-1`).digest("hex")]),/unique constraint/i); checks++;
  await pool.query(`UPDATE contacts SET email_status='valid',do_not_contact=FALSE WHERE id=$1`,[good.contactId]);
  const candidates = await getUnifiedSfpCandidates([good.businessId]);
  const contact = candidates.find(c=>c.sourceKind==="contact");
  check(contact?.verifiedBusinessAssociation===true,"recipient association is backed by a real verified relationship");
  check((await convergeSfpRecipientPolicyV2(db)).activated,"known immutable seed activates the repaired policy once");
  check(!(await convergeSfpRecipientPolicyV2(db)).activated,"activation is idempotent");
  const policy = await getActiveSfpOutreachPolicy({bypassCache:true});
  assert.ok(policy);
  const facts = classifySfpRecipientFacts({address:"person@gmail.com",subjectType:"person",
    personNameEvidence:contact?.recipientPersonNameEvidence,verifiedBusinessAssociation:true});
  check(evaluateSfpEmailTypePolicy({...facts,policy}).status==="eligible_for_staging_review",
    "corroborated named business recipient is eligible, not blanket-held");
  const unknown = classifySfpRecipientFacts({address:"unknown@example.test",subjectType:"business",
    verifiedBusinessAssociation:false});
  check(!unknown.roleInbox && !unknown.namedContact,"a business container is not role/name evidence");
  check(evaluateSfpEmailTypePolicy({...unknown,policy}).status==="eligibility_review_required","unresolved identity remains held");
  const role = classifySfpRecipientFacts({address:"office@example.test",subjectType:"person",
    personNameEvidence:"Copied Source Person",verifiedBusinessAssociation:true});
  check(role.roleInbox && !role.namedContact,"factual role mailbox does not depend on a source label");
  check((await processEffectiveVerticalProjectionTick()).ran,"resumable projection executes");
  const vertical = (await pool.query(`SELECT ${effectiveContactVerticalSql("c")} contact_vertical,
    ${effectiveBusinessVerticalSql("b")} business_vertical,c.vertical raw_contact_vertical,b.vertical raw_business_vertical
    FROM contacts c JOIN businesses b ON b.id=c.business_id WHERE c.id=$1`,[good.contactId])).rows[0];
  check(vertical.contact_vertical==="Fitness/Recreation" && vertical.business_vertical==="Fitness/Recreation",
    "contact and business use the same canonical inherited vertical");
  check(vertical.raw_business_vertical==="Gym" && vertical.raw_contact_vertical===null,"raw labels are preserved");
  console.log(`CRM repair v2: ${checks} checks passed; provider calls=0; outbound changes=0`);
}
main().then(()=>pool.end()).catch(async err=>{console.error(err);await pool.end();process.exitCode=1});