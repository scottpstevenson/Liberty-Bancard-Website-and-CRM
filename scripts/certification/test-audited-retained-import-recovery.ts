import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {writeFileSync,mkdtempSync,rmSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {assertDisposableTestInfrastructure} from "../test-infrastructure-guard";
import {applyCertificationProviderDenyBoundary,getBlockedCertificationNetworkAttemptCount} from "../certification-provider-deny";
import {legacyRetainedSelectorSql} from "./legacy-retained-selector";

await assertDisposableTestInfrastructure({operation:"audited retained recovery",requireRedis:false});
// Earlier release suites intentionally replace native guard definitions in
// their shared database. Never repair that database or weaken exact guard
// fingerprints here: exercise this suite on real, freshly applied migrations.
if(!process.argv.includes("--native-fixture-child") && process.argv[2]!=="private") {
  assert.equal(process.env.VG_PROVIDER_DENY_MODE,"1");
  const directory=mkdtempSync("/tmp/audited-retained-native-");
  try {
    const child=spawnSync("npx",["tsx","scripts/run-retained-import-recovery-disposable.ts",
      directory,"--audited-only"],{env:process.env,stdio:"inherit"});
    if(child.error)throw child.error;
    process.exitCode=child.status ?? 1;
  } finally {
    rmSync(directory,{recursive:true,force:true});
  }
  process.exit(process.exitCode ?? 0);
}
applyCertificationProviderDenyBoundary({fatal:true});
// The release launcher does not impersonate a published deployment. This child
// needs a complete private build identity to exercise (not bypass) the live-owner
// fence. Only mint it after disposable infrastructure and denied egress checks.
assert.match(process.env.RELEASE_SHA ?? "",/^[a-f0-9]{40}$/);
process.env.SFP_PUBLISH_BUILD_ID ??=randomUUID();
process.env.SFP_PUBLISH_ARTIFACT_SHA ??=process.env.RELEASE_SHA;
process.env.SFP_PUBLISH_BUILT_AT ??=new Date().toISOString();
process.env.NODE_ENV="production";process.env.REPLIT_DEPLOYMENT="1";
const {pool,db}=await import("../../server/db");
const {sql}=await import("drizzle-orm");
const {canonicalImportRecoveryClaimSql,processCanonicalImportRecoveryTick}=await import("../../server/services/canonical-import-recovery-worker");
const {hasCanonicalImportRecoveryClaim}=await import("../../server/services/canonical-import-recovery-contract");
const {verifyProviderImportIdentity,retainedIdentityBridgeProof,loadProviderImportIdentity}=await import("../../server/services/provider-import-identity");
const {providerImportRowFingerprint,retainProviderImportRow}=await import("../../server/services/provider-import-evidence");
const {providerImportEmails}=await import("../../server/services/canonical-provider-import");
const {hashCro03Evidence}=await import("../../server/services/cro03/source-staging");
const {mapProviderCsvRow}=await import("../../server/services/provider-import-columns");
const {seedExecution,syntheticRows,inputRows}=await import("./retained-recovery-fixtures");
let checks=0;
const check=(value:unknown,label:string)=>{assert(value,label);checks++;console.log(`PASS ${label}`);};
const fingerprint=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const itemFor=async(executionId:string,row=1)=>(await pool.query(`SELECT item.*,observation.payload,
    observation.payload_hash,observation.id observation_id
  FROM cro03_enrichment_items item JOIN cro03_enrichment_batches batch ON batch.id=item.batch_id
  JOIN cro03_batch_memberships member ON member.id=item.membership_id
  JOIN cro03_source_observations observation ON observation.id=member.source_observation_id
  WHERE batch.idempotency_key=$1`,[`csv-source:${executionId}:${row}`])).rows[0];
const safety=async()=>(await pool.query(`SELECT
  (SELECT count(*)::int FROM provider_operations) paid,
  (SELECT count(*)::int FROM communication_events) communication,
  (SELECT count(*)::int FROM validation_intents) validation,
  (SELECT count(*)::int FROM cro03_normalized_candidates) candidates`)).rows[0];
const selected=async(lane:"ordinary"|"legacy"|"hold"="ordinary")=>db.transaction(async tx=>{
  const records=(await tx.execute(canonicalImportRecoveryClaimSql(lane)) as any).rows;
  return records[0];
});
const rawIdentity=async(executionId:string,row:number,rawRow:Record<string,string>)=>
  loadProviderImportIdentity(db,{executionId,sourceRowNumber:row,rawRow});
let status=0;
try {
  if(process.argv[2]==="private"){
    const retained=inputRows();
    assert.equal(retained.reduce((sum,row)=>sum+providerImportEmails(row.rawRow).length,0),1277);
    assert.equal(retained.filter(row=>providerImportEmails(row.rawRow).length===0).length,195);
    check(true,"Private input preserves all 1,472 original rows, 1,277 mailbox occurrences and 195 business-only rows");
    const execution=await seedExecution(retained,"retained_original_identity");
    const mismatch=retained.filter(row=>row.rowFingerprint!==row.originalObservation!.payload.rowFingerprint);
    assert.equal(mismatch.length,1);
    const row=mismatch[0],before=await itemFor(execution,row.sourceRowNumber);
    check(row.sourceRowNumber===495 && before.attempt_count===0 &&
      before.terminal_code==="STAGING_RECIPE_DISABLED" && before.payload.rowFingerprint!==row.rowFingerprint,
      "Actual original row 495 retains distinct identities, zero attempts and its original failed topology");
    // Restrict scheduling ONLY in this isolated certification DB. Preserve the
    // target's original state/token/lease/fence; no fabricated deferred receipt.
    await pool.query(`UPDATE cro03_enrichment_items item SET next_attempt_at=clock_timestamp()+interval '1 day'
      FROM cro03_enrichment_batches batch WHERE batch.id=item.batch_id AND batch.idempotency_key LIKE $1
      AND item.id<>$2::uuid`,[`csv-source:${execution}:%`,before.id]);
    check((await db.execute(legacyRetainedSelectorSql()) as any).rows.length===0,
      "RED: the actual baseline locking/payload selector omits real original row 495");
    check((await selected())?.id===before.id,"The real mismatched source item is reachable without normalizing either fingerprint");
    const result=await processCanonicalImportRecoveryTick({maxItems:1});
    check(result.fulfilled+result.held===1 && result.failed===0,
      "Real row-495 identity/item evidence reaches the native fenced path; original CRM graph is not certified");
    const after=await itemFor(execution,row.sourceRowNumber);
    assert.deepEqual(after.payload,before.payload);
    assert.equal((await pool.query("SELECT row_fingerprint FROM import_row_dispositions WHERE execution_id=$1 AND source_row_number=$2",
      [execution,row.sourceRowNumber])).rows[0].row_fingerprint,row.rowFingerprint);
    check(true,"Both actual upstream identities remain immutable");
  } else {
    const fixtures=syntheticRows(1);
    fixtures[0].rawRow=(await pool.query("SELECT $1::jsonb raw",[JSON.stringify(fixtures[0].rawRow)])).rows[0].raw;
    const row=fixtures[0];row.rowFingerprint=fingerprint(row.rawRow);
    row.disposition="failed";row.reasonCode="RECOVERY_PROVIDER_STAGING_FAILED";
    row.diagnostic={error:"CRO03_IDEMPOTENCY_PAYLOAD_MISMATCH"};
    const mapped=mapProviderCsvRow(row.rawRow,row.sourceFormat);
    row.originalObservation={id:randomUUID(),subjectId:randomUUID(),
      payload:{...mapped,sourceFormat:row.sourceFormat,sourceRowNumber:1,rowFingerprint:"a".repeat(64)},
      provenance:{importExecutionId:"fixture-original",sourceRowNumber:1,rowFingerprint:"a".repeat(64)},
      payloadHash:""};
    row.originalObservation.payloadHash=hashCro03Evidence(row.originalObservation.payload);
    const execution=await seedExecution(fixtures,"identity");
    const input={executionId:execution,sourceRowNumber:1,rawRow:row.rawRow};
    const original=await itemFor(execution);
    check((await db.execute(legacyRetainedSelectorSql()) as any).rows.length===0,
      "RED: actual baseline locking/payload selection omits the preserved mismatch");
    await assert.rejects(()=>providerImportRowFingerprint(input),/IDENTITY_BRIDGE_REQUIRED/);checks++;
    const identity=await rawIdentity(execution,1,row.rawRow);
    const proof=retainedIdentityBridgeProof(identity,input);
    for(const bad of [
      {...input,executionId:randomUUID()},{...input,sourceRowNumber:2},
      {...input,sourceCoordinate:{format:"xlsx",worksheetRow:999}},
      {...input,rawRow:{...row.rawRow,unrecognized_column:"different raw"}},
    ])assert.throws(()=>retainedIdentityBridgeProof(identity,bad),/UNPROVED/);
    for(const bad of [
      {...identity,payload_hash:"b".repeat(64)},
      {...identity,fingerprint:"b".repeat(64)},
      {...identity,reason_code:"IMPORT_ROW_FAILED"},
      {...identity,diagnostic:{error:"IDENTITY_SAFETY_DENIED"}},
      {...identity,provenance:{...identity.provenance,rowFingerprint:"b".repeat(64)}},
      {...identity,retained_row:{...row.rawRow,name:"unrelated"}},
      {...identity,payload:{...identity.payload,unprovedField:"unrelated"}},
    ])assert.throws(()=>retainedIdentityBridgeProof(bad,input),/UNPROVED/);
    check(proof.rawEvidenceHash===hashCro03Evidence(row.rawRow),"Wrong row, execution, raw, mapped identity and unsupported failure proofs are refused");
    const before=await safety();
    check((await selected())?.id===original.id,"Corrected bounded selection reaches the original mismatched item");
    const recovered=await processCanonicalImportRecoveryTick({maxItems:1});
    check(recovered.fulfilled===1 && recovered.failed===0,"Mismatch reaches real native claim, bridge, retention, contact provenance and final qualification");
    assert.equal(await providerImportRowFingerprint(input),row.rowFingerprint);
    assert.deepEqual((await itemFor(execution)).payload,original.payload);
    check((await pool.query(`SELECT count(*)::int n FROM contact_source_events
      WHERE import_execution_id=$1 AND source_row_number=1 AND row_fingerprint=$2`,
    [execution,row.rowFingerprint])).rows[0].n===3,"All expected mailboxes retain accounting-bound provenance without altering original observation");
    const bridgeCount=async()=>Number((await pool.query(`SELECT count(*) n FROM cro03_source_observations
      WHERE payload->>'representation'='original_row_identity_v1' AND payload->>'executionId'=$1`,[execution])).rows[0].n);
    assert.equal(await bridgeCount(),1);
    await verifyProviderImportIdentity(db,input);
    assert.equal(await bridgeCount(),1);
    check(true,"Repeated verified bridge reads are no-ops on the same source subject");
    try {
      await db.transaction(async tx=>{
        await tx.execute(sql`ALTER TABLE cro03_source_observations DISABLE TRIGGER cro03_source_observation_immutable`);
        await assert.rejects(()=>verifyProviderImportIdentity(tx,input),/NATIVE_GUARD_MISSING/);
        throw new Error("FIXTURE_ROLLBACK_NATIVE_GUARD");
      });
    }catch(error:any){assert.equal(error.message,"FIXTURE_ROLLBACK_NATIVE_GUARD");}
    check(true,"A missing/disabled real append-only bridge guard fails closed");
    assert.equal((await safety()).candidates,before.candidates);
    check(true,"Bridge/raw representations add no candidates or provider work");
    const token=randomUUID();
    await pool.query(`UPDATE cro03_enrichment_items SET state='running',current_provider='canonical_local_import',
      claim_token=$2::uuid,lease_expires_at=clock_timestamp()+interval '1 minute' WHERE id=$1`,
    [original.id,token]);
    check(await db.transaction(tx=>hasCanonicalImportRecoveryClaim(tx,{...input,rowFingerprint:row.rowFingerprint,
      recoveryClaim:{itemId:original.id,claimToken:token},renew:true})),
      "The shared identity proof reaches live-token renewal");
    check(!await db.transaction(tx=>hasCanonicalImportRecoveryClaim(tx,{...input,rowFingerprint:row.rowFingerprint,
      recoveryClaim:{itemId:original.id,claimToken:randomUUID()},renew:true})),
      "Replacement/wrong tokens cannot renew a bridged claim");
    await pool.query("UPDATE cro03_enrichment_items SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[original.id]);
    check(!await db.transaction(tx=>hasCanonicalImportRecoveryClaim(tx,{...input,rowFingerprint:row.rowFingerprint,
      recoveryClaim:{itemId:original.id,claimToken:token},renew:true})),
      "Expired bridged tokens cannot revive their lease");
    await pool.query(`UPDATE cro03_enrichment_items SET state='completed',claim_token=NULL,
      current_provider=NULL,lease_expires_at=NULL WHERE id=$1`,[original.id]);
    // Mixed due backlog: repeated one-item ticks must give both lanes committed
    // opportunities, including after fresh process restarts (durable receipt).
    const mixed=syntheticRows(9),mixedExecution=await seedExecution(mixed,"fairness");
    await pool.query(`UPDATE cro03_enrichment_items item SET state='completed',
      terminal_code='CANONICAL_LOCAL_IMPORT_FULFILLED',next_attempt_at=clock_timestamp()-interval '1 minute'
      FROM cro03_enrichment_batches batch WHERE batch.id=item.batch_id AND batch.idempotency_key=$1`,
    [`csv-source:${mixedExecution}:9`]);
    let baselineLegacy=0;
    try {
      await db.transaction(async tx=>{
        for(let index=0;index<3;index++){
          const candidate=(await tx.execute(legacyRetainedSelectorSql()) as any).rows[0];
          if(Number(candidate.source_row_number)===9)baselineLegacy++;
          await tx.execute(sql`UPDATE cro03_enrichment_items SET next_attempt_at=clock_timestamp()+interval '1 day'
            WHERE id=${candidate.id}::uuid`);
        }
        throw new Error("FIXTURE_ROLLBACK_BASELINE_SELECTION");
      });
    }catch(error:any){assert.equal(error.message,"FIXTURE_ROLLBACK_BASELINE_SELECTION");}
    check(baselineLegacy===0,"RED: baseline ordering gives the late legacy completion no opportunity within three claims");
    const classes=[];
    for(let index=0;index<3;index++){
      await processCanonicalImportRecoveryTick({maxItems:1});
      classes.push((await pool.query("SELECT details->>'workClass' lane FROM audit_logs WHERE action='canonical_import_row_claimed' ORDER BY id DESC LIMIT 1")).rows[0].lane);
    }
    check(classes.includes("legacy") && classes.includes("ordinary"),
      "Short mixed-backlog ticks give legacy and ordinary rows a finite three-claim bound");
    const heldRows=syntheticRows(58),heldDomain=`held-${randomUUID()}.example.test`;
    for(const row of heldRows){
      row.rawRow.website=`https://${heldDomain}`;
      row.rowFingerprint=fingerprint(row.rawRow);
    }
    for(let index=0;index<2;index++)await pool.query(`INSERT INTO businesses
      (canonical_name,normalized_name,website_domain,google_place_id,record_class)
      VALUES($1,$2,$3,$4,'canonical')`,[`Native hold candidate ${index}`,`native hold candidate ${index}`,
        heldDomain,`hold_candidate_${randomUUID()}`]);
    const heldExecution=await seedExecution(heldRows,"missing_hold_receipts");
    await pool.query(`UPDATE cro03_enrichment_items item SET state='blocked',
      terminal_code='CANONICAL_IMPORT_AMBIGUOUS_ORGANIZATION_MATCH'
      FROM cro03_enrichment_batches batch WHERE batch.id=item.batch_id AND batch.idempotency_key LIKE $1`,
    [`csv-source:${heldExecution}:%`]);
    for(let row=1;row<=2;row++)await pool.query(`INSERT INTO audit_logs
      (action,entity_type,entity_key,details,actor_type,actor_id)
      SELECT 'canonical_import_row_held','cro03_enrichment_item',item.id::text,$2::jsonb,
        'system','system:canonical-import-recovery'
      FROM cro03_enrichment_items item JOIN cro03_enrichment_batches batch ON batch.id=item.batch_id
      WHERE batch.idempotency_key=$1`,[`csv-source:${heldExecution}:${row}`,JSON.stringify({
        executionId:heldExecution,sourceRowNumber:row,rowFingerprint:heldRows[row-1].rowFingerprint,
        reasonCode:"CANONICAL_IMPORT_AMBIGUOUS_ORGANIZATION_MATCH",diagnostic:{candidateIds:[999999]}})]);
    const holdCount=async()=>Number((await pool.query(`SELECT count(*) n FROM audit_logs
      WHERE action='canonical_import_hold_evidence' AND details->>'executionId'=$1`,[heldExecution])).rows[0].n);
    assert.equal(await holdCount(),0);
    for(let tick=0;tick<8 && await holdCount()<58;tick++)await processCanonicalImportRecoveryTick();
    assert.equal(await holdCount(),58);
    const strong=(await pool.query(`SELECT details FROM audit_logs
      WHERE action='canonical_import_hold_evidence' AND details->>'executionId'=$1`,[heldExecution])).rows;
    check(strong.every(({details})=>details.holdEvidenceVersion==="native_revision_bound_v1" &&
      details.rawEvidenceHash && details.originalPayloadHash &&
      details.diagnostic.candidateIds.length===2 &&
      !details.diagnostic.candidateIds.includes(999999) &&
      details.diagnostic.candidateRevisions.length===2),
      "All 58 receipt gaps receive source/revision-bound native holds; both stale candidate snapshots refresh without guessed ambiguity resolution");
    const historical=(await pool.query(`SELECT count(*)::int n FROM audit_logs WHERE action='canonical_import_row_held'
      AND details->>'executionId'=$1 AND details->'diagnostic'->'candidateIds'='[999999]'::jsonb`,
    [heldExecution])).rows[0].n;
    assert.equal(historical,2);
    await processCanonicalImportRecoveryTick({maxItems:1});
    assert.equal(await holdCount(),58);
    check(true,"Historical stale receipts survive append-only refresh and unchanged holds do not immediately monopolize the cursor");
    const after=await safety();assert.equal(after.paid,before.paid);assert.equal(after.communication,before.communication);
    assert.equal(after.validation,before.validation);
    await assert.rejects(()=>providerImportRowFingerprint({...input,rawRow:{...row.rawRow,name:"changed"}}),/EVIDENCE_MISMATCH/);checks++;
    const compiled=new (await import("drizzle-orm/pg-core")).PgDialect().sqlToQuery(canonicalImportRecoveryClaimSql());
    const plan=(await pool.query(`EXPLAIN (VERBOSE,FORMAT JSON) ${compiled.sql}`,compiled.params)).rows[0]["QUERY PLAN"];
    writeFileSync("/tmp/audited-retained-claim-plan.json",JSON.stringify(plan,null,2));
    const nodes=(node:any):any[]=>[node,...(node.Plans ?? []).flatMap(nodes)];
    const selectedScope=nodes(plan[0].Plan).find((node:any)=>node["Subplan Name"]==="CTE selected_import");
    check(selectedScope?.["Node Type"]==="Limit" &&
      selectedScope.Output.every((field:string)=>!field.includes("source_payload") && !field.includes("rawSourceRow")),
      "EXPLAIN proves bounded scalar locking selection before original workbook/raw JSON extraction");
    const {createCro03SourceBatch}=await import("../../server/services/cro03/source-staging");
    const {providerCsvSourceSubject}=await import("../../server/services/cro03a/adapters");
    const alienRows=syntheticRows(1),alienRow=alienRows[0];
    const alienExecution=await seedExecution(alienRows,"wrong_raw_subject");
    const alien=providerCsvSourceSubject({importExecutionId:randomUUID(),sourceRowNumber:2,
      sourceSystem:"outscraper",row:mapProviderCsvRow(alienRow.rawRow,alienRow.sourceFormat as any)});
    await createCro03SourceBatch({idempotencyKey:`csv-source-raw-v3:${alienExecution}:1`,
      actorType:"import",actorId:"isolated-negative-proof",purpose:"staging_review",
      subjects:[{...alien,candidateValues:{},payload:{rawSourceRow:alienRow.rawRow,sourceRowNumber:1,
        rowFingerprint:alienRow.rowFingerprint,sourceFormat:alienRow.sourceFormat}}]});
    await assert.rejects(()=>verifyProviderImportIdentity(db,{executionId:alienExecution,sourceRowNumber:1,
      rawRow:alienRow.rawRow}),/ORIGINAL_EVIDENCE_MISMATCH/);
    check(true,"Even identical raw values from another original source subject/row are refused");
  }
  check(getBlockedCertificationNetworkAttemptCount()===0,"Zero certification network/provider/send attempts");
  console.log(`AUDITED_RETAINED_RECOVERY_PASS checks=${checks}`);
}catch(error:any){
  status=1;
  console.error("AUDITED_RETAINED_RECOVERY_FAILED",error?.message,String(error?.stack).split("\n").slice(0,3).join("\n"));
}finally{await pool.end();}
process.exit(status);
