import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertDisposableTestInfrastructure } from "../test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary,
  getBlockedCertificationNetworkAttemptCount } from "../certification-provider-deny";
await assertDisposableTestInfrastructure({ operation: "cohort-free recipient preparation certification" });
process.env.VG_PROVIDER_DENY_MODE = "1";
applyCertificationProviderDenyBoundary({ fatal: true });
const { pool } = await import("../../server/db");
const { prepareCanonicalRecipient,currentCanonicalValidationSelection } =
  await import("../../server/services/canonical-recipient-preparation");
const {processValidationIntent,evaluateMarketingEmailEligibility,delegateSelectedAddressValidation} =
  await import("../../server/services/provider-readiness-control");
const { previewContactBusinessSystemLinks, applyContactBusinessSystemLink } =
  await import("../../server/services/contact-business-system-links");
const prefix = `cert_canonical_preparation_${randomUUID().replaceAll("-","")}`;
const actor = { role: "admin" as const, actorId: `system:${prefix}`, email: null };
let checks = 0;
const check = (value: unknown, message: string) => { assert(value,message); checks++; };
async function fixture(businessId?: number) {
  const label = randomUUID().replaceAll("-","");
  const place = `${prefix}_${businessId ?? label}_place`;
  let business;
  if (businessId) business = (await pool.query("SELECT * FROM businesses WHERE id=$1",[businessId])).rows[0];
  else {
    business = (await pool.query(`INSERT INTO businesses
      (canonical_name,normalized_name,record_class,google_place_id,vertical,city,state,postal_code)
      VALUES($1,$2,'canonical',$3,'Automotive','Miami','FL','33130') RETURNING *`,
      [`${prefix} ${label}`, `${prefix}${label}`, place])).rows[0];
    await pool.query(`INSERT INTO canonical_source_links
      (business_id,source_system,source_type,stable_key)
      VALUES($1,'google_maps','place',$2)`, [business.id,place]);
  }
  const contact = (await pool.query(`INSERT INTO contacts
    (first_name,last_name,email,phone,company_name,record_class)
    VALUES('Canonical','Fixture',$1,'',$2,'production') RETURNING id`,
    [`${prefix.slice(0,30)}.${label.slice(0,24)}@gmail.com`, `${business.canonical_name} LLC`])).rows[0];
  await pool.query(`INSERT INTO contact_source_events
    (contact_id,event_key,source_category,source_type,source_external_id,actor_type,actor_id,metadata)
    VALUES($1,$2,'import','google_maps_outscraper',$2,'system',$3,$4::jsonb)`,
    [contact.id,`${prefix}_${label}_event`,actor.actorId,JSON.stringify({ place_id: business.google_place_id })]);
  const preview = await previewContactBusinessSystemLinks({ afterContactId: Number(contact.id)-1,limit: 1 });
  const candidate = preview.rows[0];
  check(candidate?.eligible, "Independent stable Maps evidence supports affiliation without a website/corporate email");
  const outcome = await applyContactBusinessSystemLink({
    contactId: Number(contact.id), businessId: Number(business.id),
    sourceLinkId: candidate.sourceLinkId!,sourceEntityId: candidate.sourceEntityId,
    snapshotHash: candidate.snapshotHash,
  });
  check(outcome.status === "applied", "Use the real reviewed native relationship writer");
  return { contactId: Number(contact.id), businessId: Number(business.id) };
}
try {
  const before = (await pool.query(`SELECT
    (SELECT count(*) FROM sfp_cohort_runs)::int cohorts,
    (SELECT count(*) FROM provider_operations)::int operations,
    (SELECT count(*) FROM communication_events)::int communications`)).rows[0];
  const programId = randomUUID();
  await pool.query(`INSERT INTO sfp_programs
    (id,name,county_fips,vertical_ids,taxonomy_version,is_active,created_by)
    VALUES($1,$2,ARRAY['12086'],ARRAY['Automotive'],2,TRUE,$3)`,[programId,prefix,actor.actorId]);
  const sequenceId = Number((await pool.query(`INSERT INTO follow_up_sequences
    (name,status,trigger_type,trigger_config) VALUES($1,'paused','contact_created',$2::jsonb) RETURNING id`,
    [prefix,JSON.stringify({canonicalProgramId:programId,canonicalVerticals:["Automotive"]})])).rows[0].id);
  const first = await fixture();
  const call = (contactId: number) => prepareCanonicalRecipient({
    contactId,sequenceId,programId,actor,source:prefix,
  });
  const prepared = await call(first.contactId);
  check(prepared.preparationState === "pending_validation", "Available unvalidated email prepares immediately");
  check(prepared.enrollmentId != null, "Persist actual membership, not only a capability or counter");
  const member = (await pool.query("SELECT status,next_action_at,metadata FROM sequence_enrollments WHERE id=$1",
    [prepared.enrollmentId])).rows[0];
  check(member.status === "paused" && member.next_action_at == null, "No active dispatch or scheduled send");
  check(member.metadata.outboundAuthorized === false, "Preparation explicitly carries no send authority");
  const replay = await call(first.contactId);
  check(replay.replayed && replay.enrollmentId === prepared.enrollmentId, "Replay reuses the same intent and membership");
  const intent = (await pool.query("SELECT * FROM cr04_enrollment_intents WHERE id=$1",[prepared.intentId])).rows[0];
  check(intent.cohort_run_id === null && intent.status === "blocked", "No synthetic cohort or legacy send approval");
  const second = await fixture(first.businessId);
  const third = await fixture(first.businessId);
  check((await call(second.contactId)).enrollmentId != null, "A useful second address is admitted");
  check((await call(third.contactId)).enrollmentId != null, "A useful third address is admitted");
  const fourth = await fixture(first.businessId);
  check((await call(fourth.contactId)).reasonCode==="NOT_SELECTED_MORE_USEFUL_RECIPIENTS_OR_HYGIENE_HOLD",
    "A filled useful allowance does not create a fourth validation backlog row");
  await pool.query(`UPDATE contacts SET email_mutation_generation=1,
    email_token_hash=encode(sha256(convert_to(lower(trim(email)),'UTF8')),'hex') WHERE id=$1`,[fourth.contactId]);
  await assert.rejects(pool.query(`INSERT INTO cr04_enrollment_intents
    (idempotency_key,contact_id,sequence_id,channel,source,actor_id,decision_id,status,reason_code,
      program_id,business_id,normalized_email_hash,preparation_state,preparation_snapshot)
    SELECT $1,c.id,i.sequence_id,i.channel,i.source,i.actor_id,i.decision_id,'blocked','native_capacity_test',
      i.program_id,i.business_id,c.email_token_hash,'pending_validation',
      i.preparation_snapshot||jsonb_build_object('contactId',c.id,'emailMutationGeneration',1)
    FROM cr04_enrollment_intents i JOIN contacts c ON c.id=$2 WHERE i.id=$3`,
    [`${prefix}:fourth-native`,fourth.contactId,prepared.intentId]),/CANONICAL_PREPARATION_RECIPIENT_CAPACITY/);checks++;
  await pool.query("UPDATE contacts SET do_not_contact=TRUE WHERE id=$1",[second.contactId]);
  const suppressed = await call(second.contactId);
  check(suppressed.preparationState === "suppressed", "Current suppression overrides preparation and receipt readiness");
  check((await call(fourth.contactId)).enrollmentId != null, "Rejected/suppressed slots replenish without resetting usage");
  const unrelated = await fixture();
  check((await call(unrelated.contactId)).enrollmentId != null, "An independent business owns its own allowance");
  const badSequence = Number((await pool.query(`INSERT INTO follow_up_sequences(name,status)
    VALUES($1,'active') RETURNING id`,[`${prefix}_unbound`])).rows[0].id);
  const unbound = await prepareCanonicalRecipient({
    contactId:first.contactId,sequenceId:badSequence,programId,actor,source:prefix,
  });
  check(unbound.blocked && unbound.enrollmentId == null, "Never fall back to an arbitrary active sequence");
  const after = (await pool.query(`SELECT
    (SELECT count(*) FROM sfp_cohort_runs)::int cohorts,
    (SELECT count(*) FROM provider_operations)::int operations,
    (SELECT count(*) FROM communication_events)::int communications`)).rows[0];
  assert.deepEqual(after,before); checks++;
  const firstContact=(await pool.query("SELECT * FROM contacts WHERE id=$1",[first.contactId])).rows[0];
  check(firstContact.email_mutation_generation===1,"Bootstrap the legacy mailbox without fabricating a receipt");
  check(await currentCanonicalValidationSelection(first.contactId,firstContact.email_token_hash),
    "The real paused, current preparation admits validation");
  const firstValidation=(await pool.query("SELECT * FROM validation_intents WHERE contact_id=$1",
    [first.contactId])).rows[0];
  check(firstValidation?.state==="pending","Preparation atomically creates the durable selected validation intent");
  await pool.query("UPDATE provider_controls SET enabled=TRUE,circuit_state='closed' WHERE provider='zerobounce'");
  let fakeRequests=0;
  const fake={verifyEmail:async()=>{
    fakeRequests++;
    return {provider:"zerobounce" as const,status:"valid" as const,
      verifiedAt:new Date().toISOString(),outcome:"completed" as const};
  }};
  check(await processValidationIntent(firstValidation.id,fake)==="completed","Selected validation uses the shared owner");
  check(fakeRequests===1,"Exactly one injected validation, not any physical network request");
  const original=(await pool.query(`SELECT o.*,o.observed_at::text original_time FROM provider_observations o
    WHERE subject_id=$1 AND subject_type='contact' ORDER BY observed_at DESC LIMIT 1`,
    [first.contactId])).rows[0];
  check(original.outcome==="valid" && original.retryable===false,"Durable valid outcome is non-retryable");
  const claim=(await pool.query(`SELECT * FROM canonical_address_validation_claims
    WHERE email_token_hash=$1`,[firstContact.email_token_hash])).rows[0];
  check(claim.claim_token===null && claim.operation_id===original.operation_id,
    "Settled original operation is retained while exclusive ownership is released");
  const ready=await call(first.contactId);
  check(ready.preparationState==="ready_held" && ready.enrollmentId===prepared.enrollmentId,
    "The canonical owner, not the retired cohort/channel ladder, advances paused preparation");
  check((await evaluateMarketingEmailEligibility(first.contactId)).allowed,
    "Marketing readers use the same real original normalized-address receipt");
  const other=await fixture();
  // Existing storage is raw-email unique, not normalized-address unique. Use
  // genuine casing variance to prove the global normalized-address fence.
  await pool.query("UPDATE contacts SET email=$1 WHERE id=$2",[firstContact.email.toUpperCase(),other.contactId]);
  const reused=await call(other.contactId);
  check(reused.preparationState==="ready_held","Independent business reuses the address fact, not the original affiliation");
  await pool.query("UPDATE provider_controls SET enabled=FALSE WHERE provider='zerobounce'");
  const delegated=await delegateSelectedAddressValidation({
    businessId:other.businessId,email:firstContact.email,deps:fake,
  });
  check(delegated.receipt?.operationId===original.operation_id && fakeRequests===1,
    "Compatibility delegate reuses the original receipt even while the provider is disabled");
  const projected=(await pool.query(`SELECT email_validation_updated_at::timestamptz::text time FROM contacts
    WHERE id=$1`,[other.contactId])).rows[0];
  check(projected.time===original.original_time,"Reused observation time is not refreshed");
  check((await evaluateMarketingEmailEligibility(other.contactId)).allowed,
    "Shared-address reader does not require a fabricated contact-scoped observation");
  check(Number((await pool.query("SELECT count(*) n FROM provider_operations")).rows[0].n)===before.operations+1,
    "Shared reuse creates no duplicate operation or billing allocation");
  check(Number((await pool.query("SELECT count(*) n FROM provider_observations")).rows[0].n)===1,
    "Cross-business projection does not clone an immutable observation");
  await pool.query("UPDATE businesses SET city='Orlando' WHERE id=$1",[other.businessId]);
  const otherContact=(await pool.query("SELECT email_token_hash FROM contacts WHERE id=$1",[other.contactId])).rows[0];
  check(!await currentCanonicalValidationSelection(other.contactId,otherContact.email_token_hash),
    "Business/geography drift invalidates the exact current selection");
  check(Number((await pool.query("SELECT count(*) n FROM communication_events")).rows[0].n)===before.communications,
    "Validation, reuse and ready-held preparation do not send messages");
  // Private disposable deployment identity, using the same real published-owner
  // ceremony as the cohort-free linking certificate. Never changes workspace env.
  process.env.NODE_ENV="production";
  process.env.REPLIT_DEPLOYMENT="1";
  process.env.RELEASE_SHA="e".repeat(40);
  process.env.SFP_PUBLISH_ARTIFACT_SHA=process.env.RELEASE_SHA;
  process.env.SFP_PUBLISH_BUILD_ID=randomUUID();
  process.env.SFP_PUBLISH_BUILT_AT=new Date().toISOString();
  const {processCanonicalRecipientPreparationTick}=await import("../../server/services/canonical-recipient-preparation-worker");
  const auto=await fixture();
  const automatic=await processCanonicalRecipientPreparationTick();
  check(automatic.ran && automatic.examined>0,"Existing tick selects available recipients without any frozen cohort");
  const automaticallyPrepared=(await pool.query(`SELECT i.*,se.status member_status
    FROM cr04_enrollment_intents i JOIN sequence_enrollments se ON se.id=i.enrollment_id
    WHERE i.contact_id=$1 AND i.program_id=$2`,[auto.contactId,programId])).rows[0];
  check(automaticallyPrepared?.preparation_state==="pending_validation"
    && automaticallyPrepared.member_status==="paused","Automatic selection persists actual pending paused membership");
  const cycle=(await pool.query("SELECT value FROM system_settings WHERE key='canonical_recipient_preparation_cursor'")).rows[0].value;
  check(cycle.cycles===1 && cycle.afterContactId===0,"Completed local scan has a durable cycle receipt, not a heartbeat");
  const secondCycle=await processCanonicalRecipientPreparationTick();
  check(secondCycle.ran && secondCycle.cycles===2,"A second scheduled pass replays safely");
  check(Number((await pool.query("SELECT count(*) n FROM provider_operations")).rows[0].n)===before.operations+1,
    "Automatic selection remains local while the provider is disabled");
  check(Number((await pool.query("SELECT count(*) n FROM sfp_cohort_runs")).rows[0].n)===before.cohorts,
    "No fake cohort is created for either automatic cycle");
  await pool.query("UPDATE provider_controls SET enabled=TRUE,circuit_state='closed' WHERE provider='zerobounce'");
  const retryFixture=await fixture();
  await call(retryFixture.contactId);
  const retryIntent=(await pool.query("SELECT id FROM validation_intents WHERE contact_id=$1",
    [retryFixture.contactId])).rows[0];
  check(await processValidationIntent(retryIntent.id,{verifyEmail:async()=>({
    provider:"zerobounce",status:"unknown",verifiedAt:new Date().toISOString(),outcome:"completed",
  })})==="deferred","Definitive unknown result retains billing facts but allows bounded retry");
  const unknownOperation=(await pool.query(`SELECT op.*,a.dispatch_marked_at FROM provider_operations op
    JOIN provider_attempts a ON a.operation_id=op.id WHERE op.idempotency_key LIKE $1
    ORDER BY op.started_at DESC LIMIT 1`,[`validation-intent:${retryIntent.id}:attempt:%`])).rows[0];
  check(unknownOperation.provider_usage_status==="known" && unknownOperation.dispatch_marked_at,
    "Known response and real dispatch marker are recorded, not inferred from failed status");
  check(await processValidationIntent(retryIntent.id,fake)==="completed",
    "Retry has a distinct operation rather than overwriting immutable original facts");
  check(Number((await pool.query("SELECT count(*) n FROM provider_operations WHERE idempotency_key LIKE $1",
    [`validation-intent:${retryIntent.id}:attempt:%`])).rows[0].n)===2,"Both original and retry operations remain");
  const bad=await fixture();
  const badPrepared=await call(bad.contactId);
  const badIntent=(await pool.query("SELECT id FROM validation_intents WHERE contact_id=$1",[bad.contactId])).rows[0];
  check(await processValidationIntent(badIntent.id,{verifyEmail:async()=>({
    provider:"zerobounce",status:"invalid",verifiedAt:new Date().toISOString(),outcome:"completed",
  })})==="completed","Completed negative validation is a real terminal outcome, not a retryable transport failure");
  const badOutcome=(await pool.query(`SELECT o.* FROM provider_observations o
    WHERE o.subject_type='contact' AND o.subject_id=$1`,[bad.contactId])).rows[0];
  check(badOutcome.outcome==="invalid" && badOutcome.retryable===false,"Fresh negative address receipt is reusable");
  check((await call(bad.contactId)).preparationState==="rejected","Rejected address releases its useful slot");
  check((await pool.query("SELECT status FROM sequence_enrollments WHERE id=$1",[badPrepared.enrollmentId])).rows[0].status==="cancelled",
    "Rejected address no longer retains this owner's paused membership");
  const nextAddress=await fixture(bad.businessId);
  check((await call(nextAddress.contactId)).enrollmentId!=null,"Eligible alternative replenishes without resetting usage");
  const noOwner=await fixture();
  const noOwnerContact=(await pool.query("SELECT email_mutation_generation FROM contacts WHERE id=$1",
    [noOwner.contactId])).rows[0];
  await pool.query(`INSERT INTO validation_intents(contact_id,normalized_email_token_hash,subject_generation,policy_version,purpose)
    SELECT id,encode(sha256(convert_to(lower(trim(email)),'UTF8')),'hex'),1,1,'marketing_outreach'
    FROM contacts WHERE id=$1`,[noOwner.contactId]);
  const unselectedIntent=(await pool.query("SELECT id FROM validation_intents WHERE contact_id=$1",[noOwner.contactId])).rows[0];
  const beforeDenied=fakeRequests;
  check(await processValidationIntent(unselectedIntent.id,fake)==="failed" && fakeRequests===beforeDenied,
    "A legacy direct producer cannot buy validation without canonical selection");
  check(noOwnerContact.email_mutation_generation===0,"Selection denial does not fabricate a mailbox generation");
  const general=await fixture();
  await pool.query("UPDATE contacts SET email=$1,first_name=company_name WHERE id=$2",
    [`info.${randomUUID().slice(0,8)}@example.com`,general.contactId]);
  const people=await Promise.all([fixture(general.businessId),fixture(general.businessId),fixture(general.businessId)]);
  await pool.query("UPDATE contacts SET title='Owner' WHERE id=$1",[people[2].contactId]);
  check((await call(general.contactId)).enrollmentId===null,
    "Earlier general mailbox does not precede three available people/decision-makers");
  check((await call(people[2].contactId)).enrollmentId!=null,
    "Decision-maker address is selected without deal or first-info dependencies");
  await pool.query("UPDATE contacts SET record_class='test' WHERE id=$1",[people[2].contactId]);
  await processCanonicalRecipientPreparationTick();
  check((await pool.query(`SELECT i.preparation_state,se.status FROM cr04_enrollment_intents i
    JOIN sequence_enrollments se ON se.metadata->>'canonicalPreparationId'=i.id::text
    WHERE i.contact_id=$1`,[people[2].contactId])).rows[0].status==="cancelled",
    "Reclassified non-production recipient is still scanned to retire its paused commitment");
  check(getBlockedCertificationNetworkAttemptCount() === 0, "No attempted provider/network transport");
  console.log(`PASS: ${checks} cohort-free preparation/shared validation checks; injected transport only, no cohorts or messages`);
} finally { await pool.end(); }