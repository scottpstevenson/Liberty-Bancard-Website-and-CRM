import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { assertDisposableTestInfrastructure } from "../test-infrastructure-guard";
import {
  applyCertificationProviderDenyBoundary, getBlockedCertificationNetworkAttemptCount,
} from "../certification-provider-deny";

await assertDisposableTestInfrastructure({ operation: "Canonical promotional flow progression" });
applyCertificationProviderDenyBoundary({ fatal: true });
const { db, pool } = await import("../../server/db");
const { previewContactBusinessSystemLinks, applyContactBusinessSystemLink } =
  await import("../../server/services/contact-business-system-links");
const { processEffectiveVerticalProjectionTick } =
  await import("../../server/services/crm-effective-vertical-projection");
const { prepareCanonicalRecipient, currentCanonicalValidationSelection } =
  await import("../../server/services/canonical-recipient-preparation");
const { processValidationIntent, evaluateMarketingEmailEligibility } =
  await import("../../server/services/provider-readiness-control");
const { processCanonicalRecipientPreparationTick } =
  await import("../../server/services/canonical-recipient-preparation-worker");
const { claimSfpRuntimeDeploymentOwner } =
  await import("../../server/services/cro03/sfp-provider-operations");
const { lockCurrentSfpRuntimeOwner } =
  await import("../../server/services/cro03/sfp-provider-operations");
const { sql } = await import("drizzle-orm");
const prefix = `flow_${randomUUID().replaceAll("-", "")}`;
const programId = randomUUID();
const actor = { role: "admin" as const, actorId: `system:${prefix}`, email: null };
let checks = 0, fakeDispatches = 0;
function check(value: unknown, message: string) { assert(value, message); checks++; }
const count = async (table: string) => Number((await pool.query(`SELECT count(*) n FROM ${table}`)).rows[0].n);

try {
  // Private disposable published identity. Never modifies workspace environment,
  // authority tables, deployed data, provider credentials, or production code.
  process.env.NODE_ENV = "production";
  process.env.REPLIT_DEPLOYMENT = "1";
  process.env.RELEASE_SHA = "f".repeat(40);
  process.env.SFP_PUBLISH_ARTIFACT_SHA = process.env.RELEASE_SHA;
  process.env.SFP_PUBLISH_BUILD_ID = randomUUID();
  process.env.SFP_PUBLISH_BUILT_AT = new Date().toISOString();
  await claimSfpRuntimeDeploymentOwner();
  const baseline = {
    cohorts: await count("sfp_cohort_runs"), members: await count("sfp_cohort_members"),
    communications: await count("communication_events"), operations: await count("provider_operations"),
  };
  await pool.query(`INSERT INTO sfp_programs
    (id,name,county_fips,vertical_ids,taxonomy_version,is_active,created_by)
    VALUES($1,$2,ARRAY['12086'],ARRAY['Healthcare'],2,TRUE,$3)`,
  [programId, prefix, actor.actorId]);
  const sequenceId = Number((await pool.query(`INSERT INTO follow_up_sequences
    (name,status,trigger_type,trigger_config) VALUES($1,'paused','contact_created',$2) RETURNING id`,
  [prefix, { canonicalProgramId: programId, canonicalVerticals: ["Healthcare"] }])).rows[0].id);
  const placeId = `${prefix}_place`;
  const businessId = Number((await pool.query(`INSERT INTO businesses
    (canonical_name,normalized_name,record_class,google_place_id,vertical,city,state,postal_code,street_address)
    VALUES($1,$2,'canonical',$3,'Dental','Miami','FL','33130','101 Fixture Avenue') RETURNING id`,
  [`${prefix} Dental`, `${prefix} dental`, placeId])).rows[0].id);
  await pool.query(`INSERT INTO canonical_source_links(business_id,source_system,source_type,stable_key)
    VALUES($1,'google_maps','place',$2)`, [businessId, placeId]);
  const contactId = Number((await pool.query(`INSERT INTO contacts
    (first_name,last_name,email,phone,company_name,record_class,title)
    VALUES('Named','Owner',$1,'',$2,'production','Owner') RETURNING id`,
  [`${prefix}@gmail.com`, `${prefix} Dental LLC`])).rows[0].id);
  await pool.query(`INSERT INTO contact_source_events
    (contact_id,event_key,source_category,source_type,source_external_id,actor_type,actor_id,metadata)
    VALUES($1,$2,'import','google_maps_outscraper',$2,'system',$3,$4)`,
  [contactId, `${prefix}_event`, actor.actorId, { place_id: placeId }]);
  const preview = await previewContactBusinessSystemLinks({ afterContactId: contactId - 1, limit: 1 });
  const candidate = preview.rows.find(row => row.contactId === contactId);
  check(candidate?.eligible, "Independent source identity admits a personal email without a website");
  const linked = await applyContactBusinessSystemLink({
    contactId, businessId, sourceLinkId: candidate!.sourceLinkId!,
    sourceEntityId: candidate!.sourceEntityId, snapshotHash: candidate!.snapshotHash,
  });
  check(linked.status === "applied", "Actual native relationship commits");
  await processEffectiveVerticalProjectionTick();
  const prepare = () => prepareCanonicalRecipient({
    contactId, businessId, sequenceId, programId, actor, source: "canonical_flow_certification",
  });
  const pending = await prepare();
  check(pending.preparationState === "pending_validation" && pending.enrollmentId != null,
    "Actual promotional binding prepares a selected retained email into paused membership");
  const contact = (await pool.query("SELECT email_token_hash FROM contacts WHERE id=$1", [contactId])).rows[0];
  check(await currentCanonicalValidationSelection(contactId, contact.email_token_hash),
    "Current native preparation selects the mailbox, not merely candidate evidence");
  const intent = (await pool.query("SELECT * FROM validation_intents WHERE contact_id=$1", [contactId])).rows[0];
  check(intent?.state === "pending", "Selected address has a durable pending intent");
  await pool.query("UPDATE provider_controls SET enabled=TRUE,circuit_state='closed' WHERE provider='zerobounce'");
  const validation = await processValidationIntent(intent.id, {
    verifyEmail: async () => {
      fakeDispatches++;
      return { provider: "zerobounce", status: "valid", verifiedAt: new Date().toISOString(), outcome: "completed" };
    },
  });
  const persisted = (await pool.query("SELECT state,terminal_code FROM validation_intents WHERE id=$1", [intent.id])).rows[0];
  check(validation === "completed", `Validation must finish; actual=${validation}, state=${persisted?.state}, reason=${persisted?.terminal_code}`);
  check(fakeDispatches === 1, "One injected dispatch through the real validation owner");
  const ready = await prepare();
  check(ready.preparationState === "ready_held" && ready.enrollmentId === pending.enrollmentId,
    "Original receipt advances the same actual paused membership");
  check((await evaluateMarketingEmailEligibility(contactId)).allowed,
    "Shared marketing readiness agrees with the original receipt");
  const receipt = (await pool.query(`SELECT operation_id,outcome,observed_at::text observed_at
    FROM provider_observations WHERE subject_type='contact' AND subject_id=$1 ORDER BY observed_at DESC LIMIT 1`,
  [contactId])).rows[0];
  check(receipt?.outcome === "valid", "Immutable original receipt exists");
  await pool.query("UPDATE contacts SET email_status='unvalidated',email_validation_updated_at=NULL WHERE id=$1",[contactId]);
  const reused=await prepare();
  check(reused.preparationState==="ready_held",
    "A retained fresh receipt remains locally preparable when compatibility hygiene is unvalidated");
  assert.deepEqual("decision" in reused ? reused.decision.reasonCodes : null,
    "decision" in ready ? ready.decision.reasonCodes : null);checks++;
  const projected=(await pool.query(`SELECT email_status,email_validation_updated_at::text validated_at
    FROM contacts WHERE id=$1`,[contactId])).rows[0];
  check(projected.email_status==="valid" && projected.validated_at===receipt.observed_at,
    "Fresh selected receipt projects actual contact hygiene with its original observation time");
  check((await evaluateMarketingEmailEligibility(contactId)).allowed,
    "Receipt reuse restores shared readiness rather than leaving the contact permanently unvalidated");
  check(await count("provider_operations")===baseline.operations+1 && fakeDispatches===1,
    "Projection of retained evidence neither enqueues replacement validation nor dispatches again");
  // A real PostgreSQL cycle, not a thrown fake error: the main transaction
  // holds A and waits for B; the peer holds B and waits for A. Only the main
  // connection detects the cycle first, so PostgreSQL aborts that transaction.
  const peer=await pool.connect();
  const lockA=`${prefix}:deadlock:a`,lockB=`${prefix}:deadlock:b`;
  let attempts=0,peerCompletion:Promise<unknown>=Promise.resolve();
  try {
    await peer.query("BEGIN");
    await peer.query("SET LOCAL deadlock_timeout='10s'");
    await peer.query("SET LOCAL statement_timeout='15s'");
    await peer.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[lockB]);
    const recovered=await prepareCanonicalRecipient({
      contactId,sequenceId,programId,actor,source:"canonical_native_deadlock_recovery",
      beforeWrite:async tx=>{
        attempts++;
        await lockCurrentSfpRuntimeOwner(tx);
        if (attempts!==1) return;
        await tx.execute(sql`SET LOCAL deadlock_timeout='100ms'`);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockA},0))`);
        await tx.execute(sql`UPDATE sequence_enrollments SET metadata=metadata||
          '{"deadlockFixtureMarker":true}'::jsonb WHERE id=${pending.enrollmentId}`);
        peerCompletion=peer.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[lockA])
          .then(()=>peer.query("COMMIT"));
        void peerCompletion.catch(()=>{});
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockB},0))`);
      },
    });
    await peerCompletion;
    check(attempts===2,"Real native PostgreSQL deadlock retries exactly once with fresh owner guards");
    check(recovered.preparationState==="ready_held" && recovered.enrollmentId===pending.enrollmentId,
      "Recovered native preparation reuses the same actual paused membership");
    check(!(await pool.query("SELECT metadata FROM sequence_enrollments WHERE id=$1",
      [pending.enrollmentId])).rows[0].metadata.deadlockFixtureMarker,
      "The aborted transaction's membership write was rolled back, not partly committed");
    check(await count("provider_operations")===baseline.operations+1 && fakeDispatches===1,
      "Native deadlock recovery neither buys validation nor repeats a dispatch");
  } finally {
    await peerCompletion;
    await peer.query("ROLLBACK");
    peer.release();
  }
  const firstCycle = await processCanonicalRecipientPreparationTick();
  const secondCycle = await processCanonicalRecipientPreparationTick();
  check(firstCycle.ran && secondCycle.ran && secondCycle.cycles >= 2,
    "Two real isolated worker passes complete with no historical cohort");
  const member = (await pool.query("SELECT status,next_action_at,metadata FROM sequence_enrollments WHERE id=$1",
    [pending.enrollmentId])).rows[0];
  check(member.status === "paused" && member.next_action_at == null && member.metadata.outboundAuthorized === false,
    "Local progression does not authorize or schedule sending");
  check(await count("sfp_cohort_runs") === baseline.cohorts && await count("sfp_cohort_members") === baseline.members,
    "Never-in-cohort business remains cohort-free");
  check(await count("communication_events") === baseline.communications,
    "No communications are created");
  check(await count("provider_operations") === baseline.operations + 1 && fakeDispatches === 1,
    "Replay does not create another provider operation or dispatch");
  // Actual retained contacts with no business/binding must be accounted for
  // without opening 250 owner-locked retirement transactions or buying hygiene.
  await pool.query(`INSERT INTO contacts(first_name,last_name,email,phone,record_class)
    SELECT 'Unbound','Retained',$1||n::text||'@gmail.com','','production'
    FROM generate_series(1,5000) n`, [`${prefix}.unbound.`]);
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const dialect=new PgDialect(),originalExecute=db.execute.bind(db);
  let bulkBindingQueries=0;
  (db as any).execute=(query:any)=>{
    const text=dialect.sqlToQuery(query).sql;
     if (/FROM contacts c\s+JOIN businesses b/.test(text) && text.includes("AS contact_id")) bulkBindingQueries++;
    return originalExecute(query);
  };
  let bulkPage;
  const bulkStarted=Date.now();
  try { bulkPage=await processCanonicalRecipientPreparationTick(); }
  finally { (db as any).execute=originalExecute; }
  const bulkElapsedMs=Date.now()-bulkStarted;
  check(bulkPage.ran && bulkPage.examined===5000 && bulkPage.populationPages===20,
    "A real tick advances twenty bounded pages instead of idling after the first 250 contacts");
   check(bulkBindingQueries===21,"One binding retrieval per population/priority page, not per contact");
  const lastPage=await processCanonicalRecipientPreparationTick();
  check(lastPage.ran && lastPage.examined===1 && lastPage.cycles>=3,"Keyset tail is retained and the full scan completes");
  check(await count("provider_operations")===baseline.operations+1 && fakeDispatches===1,
    "Population accounting does not admit unselected addresses to paid work");
  const {createHash}=await import("node:crypto");
  const {claimCsvExecution,completeImportExecution}=await import("../../server/services/import-execution");
  const {materializeCanonicalProviderImportRow}=await import("../../server/services/canonical-provider-import");
  const retainedEmail=(await pool.query("SELECT email FROM contacts WHERE id=$1",[contactId])).rows[0].email;
  const importRows=[
    {name:`${prefix} Dental`,place_id:placeId,category:"Dental",city:"Miami",state:"FL",zip:"33130",email_1:retainedEmail},
    {name:`${prefix} New Dental`,place_id:`${prefix}_new_place`,category:"Dental",city:"Miami",state:"FL",zip:"33130",
      email_1:`${prefix}.new-owner@gmail.com`},
  ];
  const imported=await claimCsvExecution({fileHash:createHash("sha256").update(JSON.stringify(importRows)).digest("hex"),
    totalRows:2,actorType:"import",actorId:actor.actorId,sourcePayload:importRows});
  const outcomes=[];
  for(const [index,rawRow] of importRows.entries()) outcomes.push(await materializeCanonicalProviderImportRow({
    executionId:imported.execution.id,claimToken:imported.claimToken!,sourceRowNumber:index+1,
    sourceFormat:"google_maps_outscraper",actorId:actor.actorId,rawRow,
  }));
  await completeImportExecution({executionId:imported.execution.id,claimToken:imported.claimToken!,expectedRows:2});
  check(outcomes[0].businessId===businessId && outcomes[0].contactIds.includes(contactId),
    "Actual import reuses the existing canonical business/contact");
  check(outcomes[1].businessId!=null && outcomes[1].businessId!==businessId && outcomes[1].contactIds.length===1,
    "Actual new import commits a distinct real business/contact");
  check((await prepare()).preparationState==="ready_held",
    "Imported existing identity reuses its original receipt through preparation");
  const newContactId=outcomes[1].contactIds[0];
  const prepareImported=()=>prepareCanonicalRecipient({contactId:newContactId,sequenceId,programId,
    actor,source:"canonical_import_flow_certification"});
   const prioritized=await processCanonicalRecipientPreparationTick({maxPopulationPages:1});
   const newPendingRow=(await pool.query(`SELECT preparation_state,enrollment_id FROM cr04_enrollment_intents
     WHERE contact_id=$1 AND program_id=$2`,[newContactId,programId])).rows[0];
   const newPending={preparationState:newPendingRow?.preparation_state,enrollmentId:newPendingRow?.enrollment_id};
   const workerCursor=(await pool.query(`SELECT value FROM system_settings
     WHERE key='canonical_recipient_preparation_cursor'`)).rows[0].value;
   check(newContactId>workerCursor.afterContactId && workerCursor.afterContactId>0,
     "New bound recipient lies beyond the current full-population page");
   check(prioritized.ran && prioritized.priority?.prepared!>=1,
     "Existing worker's bounded priority pass reaches the late-ID recipient now");
   check(newPending.preparationState==="pending_validation" && newPending.enrollmentId!=null,
     "Automatic high-ID selection commits actual pending/paused preparation without manual prepare");
  const newIntent=(await pool.query("SELECT id FROM validation_intents WHERE contact_id=$1",[newContactId])).rows[0];
  check(await processValidationIntent(newIntent.id,{verifyEmail:async()=>{
    fakeDispatches++;
    return {provider:"zerobounce",status:"valid",verifiedAt:new Date().toISOString(),outcome:"completed"};
  }})==="completed","Imported selected address receives an actual immutable injected-provider receipt");
  check((await prepareImported()).preparationState==="ready_held",
    "New import completes the full canonical receipt to paused-membership chain");
  const beforeReplay=await count("contacts"),beforeBusinesses=await count("businesses");
  const replayedImport=await claimCsvExecution({
    fileHash:createHash("sha256").update(JSON.stringify(importRows)).digest("hex"),
    totalRows:2,actorType:"import",actorId:actor.actorId,sourcePayload:importRows,
  });
  check(replayedImport.execution.id===imported.execution.id && replayedImport.replay,
    "Completed-file replay returns its original execution rather than bypassing the claim fence");
  check(await count("contacts")===beforeReplay && await count("businesses")===beforeBusinesses,
    "Original source-row replay does not duplicate entities");
  check(await count("provider_operations")===baseline.operations+2 && fakeDispatches===2,
    "Existing receipt reuse and source replay do not repurchase validation");
  check(await count("communication_events")===baseline.communications && await count("sfp_cohort_runs")===baseline.cohorts,
    "Both actual import paths remain cohort-free and create no messages");
  const {readCanonicalEnrichmentStatus}=await import("../../server/services/canonical-enrichment-status");
  const operatingStatus=await readCanonicalEnrichmentStatus();
  const importedCurrent=operatingStatus.recentImportOutcomes.find(row=>
    row.executionId===imported.execution.id && row.sourceRowNumber===2);
  check(importedCurrent?.businessId===null && importedCurrent.currentBusinessId===outcomes[1].businessId,
    "Operating status separates original row accounting from current verified CRM affiliation");
   check(operatingStatus.automaticProgress.preparation.priority?.scanned!>0,
     "Operating status exposes separate priority transitions without fabricating population coverage");
  await pool.query("UPDATE contacts SET do_not_contact=TRUE WHERE id=$1",[contactId]);
  await processCanonicalRecipientPreparationTick();
  check((await pool.query("SELECT status FROM sequence_enrollments WHERE id=$1",[pending.enrollmentId])).rows[0].status==="cancelled",
    "Batch retrieval preserves fenced retirement of genuine suppressed memberships");
  check(getBlockedCertificationNetworkAttemptCount() === 0, "No actual network attempts");
  fs.writeFileSync("docs/certification/canonical-enrichment-flow-progression.json", JSON.stringify({
    observedAt: new Date().toISOString(), checks, scope: "Disposable real promotional pipeline, not production acceptance",
    nativeRelationshipCommitted: true, personalEmailWithoutWebsite: true,
    retainedSelectedAddressValidated: true, originalReceipt: receipt, pausedEnrollment: true,
    workerCycles: secondCycle.cycles, fakeDispatches, physicalNetworkAttempts: 0,
     unboundPage:{examined:bulkPage.examined,bulkBindingQueries,elapsedMs:bulkElapsedMs},
     priorityPass:{lateIdReachedBeforePopulationCursor:true,automaticPendingPausedMembership:true,
       examined:prioritized.priority?.examined,prepared:prioritized.priority?.prepared},
    importFlow:{existingContactReused:true,newContactCommitted:true,bothReadyHeld:true,replayedWithoutDuplicates:true},
    cohortsCreated: 0, communicationsCreated: 0, productionExecution: false, taskComplete: false,
  }, null, 2) + "\n");
  console.log(`PASS: ${checks} canonical promotional flow checks`);
} finally { await pool.end(); }
