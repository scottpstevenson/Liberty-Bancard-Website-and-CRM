/** Disposable-only prerequisites through real affiliation and canonical preparation owners. No transport or outbound authority. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
let program: {id:string;sequenceId:number}|undefined;
export async function prepareSelectedTargets(cohortRunId:string,actorId:string) {
 const {assertDisposableTestInfrastructure}=await import("../test-infrastructure-guard");
 await assertDisposableTestInfrastructure({operation:'current selected-recipient fixture prerequisites'});
 const {db,pool}=await import("../../server/db");
 const {SFP_CONTACT_VERTICAL_IDS}=await import("../../shared/contact-vertical-taxonomy");
 const {previewSfpValidation}=await import("../../server/services/cro03/sfp-validation");
 const {getUnifiedSfpCandidates,openSfpCandidatePlaintext}=await import("../../server/services/cro03/sfp-paid-evidence-writer");
 const {previewContactBusinessSystemLinks,applyContactBusinessSystemLink}=await import("../../server/services/contact-business-system-links");
 const {prepareCanonicalRecipient,currentCanonicalValidationSelection}=await import("../../server/services/canonical-recipient-preparation");
 const {hashEmailToken}=await import("../../server/services/provider-readiness-decision");
 const preview=await previewSfpValidation(cohortRunId);
 const candidates=await getUnifiedSfpCandidates(preview.selectedCandidates.map(c=>c.businessId));
 if(!program) {
  const id=(await pool.query(`INSERT INTO sfp_programs(name,county_fips,vertical_ids,taxonomy_version,is_active,created_by)
   VALUES($1,ARRAY['12086','12011','12099'],$2,2,true,$1) RETURNING id`,['selected-fixture-'+randomUUID(),[...SFP_CONTACT_VERTICAL_IDS]])).rows[0].id;
  const sequenceId=Number((await pool.query(`INSERT INTO follow_up_sequences(name,status,trigger_config) VALUES($1,'paused',$2::jsonb) RETURNING id`,['Selected recipient fixture',JSON.stringify({canonicalProgramId:id,canonicalVerticals:[...SFP_CONTACT_VERTICAL_IDS]})])).rows[0].id);
  program={id,sequenceId};
 }
 for(const selected of preview.selectedCandidates) {
  const source=candidates.find(c=>c.businessId===selected.businessId&&c.evidenceId===selected.candidateId);assert(source,'Selected source fixture must exist');
  const reference=source.sourceKind==='free'?{sourceKind:'free' as const,freeDiscoveryCandidateId:source.evidenceId}
   :source.sourceKind==='paid'?{sourceKind:'paid' as const,paidCandidateEvidenceId:source.evidenceId}
   :{sourceKind:'contact' as const,contactId:Number(source.evidenceId.replace(/^contact:/,''))};
  await openSfpCandidatePlaintext({reference,cohortRunId,actorId,purpose:'synthetic_selected_recipient_preparation'},async(email)=>{
   const b=(await pool.query('SELECT * FROM businesses WHERE id=$1',[selected.businessId])).rows[0];assert.equal(b.record_class,'canonical');
   const key='selected_'+randomUUID().replaceAll('-','');
   const place=b.google_place_id||`selected-fixture-place-${b.id}`;
   if(!b.google_place_id)await pool.query('UPDATE businesses SET google_place_id=$2 WHERE id=$1',[b.id,place]);
   await pool.query(`INSERT INTO canonical_source_links(business_id,source_system,source_type,stable_key)
    SELECT $1,'google_maps','place',$2 WHERE NOT EXISTS(SELECT 1 FROM canonical_source_links WHERE business_id=$1 AND source_system='google_maps' AND source_type='place' AND stable_key=$2)`,[b.id,place]);
   let contact=(await pool.query('SELECT * FROM contacts WHERE lower(email)=lower($1) AND (business_id=$2 OR business_id IS NULL) ORDER BY id LIMIT 1',[email,b.id])).rows[0];
   if(!contact)contact=(await pool.query(`INSERT INTO contacts(first_name,last_name,email,phone,company_name,record_class)
    VALUES('','',$1,'',$2,'production') RETURNING *`,[email,b.canonical_name])).rows[0];
   const linked=(await pool.query(`SELECT 1 FROM contact_business_link_decisions WHERE contact_id=$1 AND business_id=$2 AND decision='verified' AND superseded_at IS NULL`,[contact.id,b.id])).rows.length>0;
   if(!linked) {
    await pool.query(`INSERT INTO contact_source_events(contact_id,event_key,source_category,source_type,source_external_id,actor_type,actor_id,metadata)
     VALUES($1,$2,'import','google_maps_outscraper',$2,'system',$3,$4::jsonb)`,[contact.id,key,actorId,JSON.stringify({place_id:place})]);
    const links=await previewContactBusinessSystemLinks({afterContactId:Number(contact.id)-1,limit:1});const link=links.rows[0];assert(link?.eligible,'Independent fixture Maps evidence must qualify');
    const outcome=await applyContactBusinessSystemLink({contactId:Number(contact.id),businessId:Number(b.id),sourceLinkId:link.sourceLinkId!,sourceEntityId:link.sourceEntityId,snapshotHash:link.snapshotHash});assert.equal(outcome.status,'applied');
   }
   const prepared=await prepareCanonicalRecipient({contactId:Number(contact.id),businessId:Number(b.id),programId:program!.id,sequenceId:program!.sequenceId,actor:{role:'admin',actorId,email:null},source:'synthetic_selected_prerequisite'});
   assert(await currentCanonicalValidationSelection(Number(contact.id),hashEmailToken(email)!),`Fixture target not current: ${prepared.preparationState}/${prepared.reasonCode}`);
   return {contactId:Number(contact.id)};
  },db);
 }
}
