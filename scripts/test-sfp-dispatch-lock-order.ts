import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdtempSync,readFileSync,rmSync} from "node:fs";
import {tmpdir,userInfo} from "node:os";
import {join} from "node:path";
import net from "node:net";
import pg from "pg";
import ts from "typescript";
import {PgDialect} from "drizzle-orm/pg-core";
import {sql} from "drizzle-orm";
import {assertDisposableTestInfrastructure} from "./test-infrastructure-guard";
import {sameSfpRuntimeRelease,SFP_RUNTIME_OWNER_LEASE_MS} from "../server/services/cro03/sfp-runtime-fence";
import {boundCanonicalWriteTransaction} from "../server/services/canonical-transaction-retry";

// Execute the actual private production helpers, extracted by the TS parser.
// Do not import the application DB, workers, credentials or provider adapters.
// The only substituted authority is this test cluster's fixture release.
const source=readFileSync("server/services/cro03/sfp-provider-operations.ts","utf8");
const ast=ts.createSourceFile("sfp-provider-operations.ts",source,ts.ScriptTarget.Latest,true);
const names=[
  "rowMatchesSfpRuntimeRelease","lockSelectedSfpRuntimeRelease","lockCurrentSfpRuntimeOwner","lockMatchingLiveSfpRuntimeOwner",
  "renewSfpRuntimeOwnerLease","renewSfpRuntimeJobLease","advanceSfpPublishedRelease",
  "claimOrRenewSfpRuntimeOwner","claimSfpRuntimeDeploymentOwner","markSfpProviderOperationDispatchBoundary",
];
const functions=new Map(ast.statements.filter(ts.isFunctionDeclaration)
  .filter(node=>node.name && names.includes(node.name.text))
  .map(node=>[node.name!.text,node.getText(ast).replace(/^export /,"")]));
assert.equal(functions.size,names.length);
const renewal=functions.get("renewSfpRuntimeOwnerLease")!;
const selectorPin=/\s*const selected = await lockSelectedSfpRuntimeRelease\(executor, fence\);\s*if \(!selected\) throw new Error\("SFP_RUNTIME_OWNER_BLOCKED:CURRENT_RELEASE_NOT_SELECTED"\);/;
assert(selectorPin.test(renewal),"Dispatch must pin the selected release before its exclusive owner update");
const marker=ast.statements.filter(ts.isFunctionDeclaration)
  .find(node=>node.name?.text==="markSfpProviderOperationDispatchBoundary")!.getText(ast);
const independentRenewal="await db.transaction(tx => renewSfpRuntimeOwnerLease(tx, reservation, fence));";
assert(marker.includes(independentRenewal));
assert(marker.indexOf(independentRenewal)<marker.indexOf("await renewSfpRuntimeJobLease"));
assert(!functions.get("renewSfpRuntimeJobLease")!.includes("UPDATE sfp_runtime_owner_authority"),
  "Job renewal must not take a second exclusive owner lock in the effect transaction");
assert(marker.indexOf("await renewSfpRuntimeJobLease")<marker.indexOf("UPDATE provider_attempts"));

const fence={
  deploymentIdentity:"fixture-deployment",environmentIdentity:"fixture-environment",
  artifactSha:"a".repeat(40),queueTopologyHash:"b".repeat(64),processIdentity:"fixture-process",
};
const token="00000000-0000-4000-8000-000000000001";
const operationId="00000000-0000-4000-8000-000000000002";
const claimToken="00000000-0000-4000-8000-000000000003";
const selectionId="00000000-0000-4000-8000-000000000004";
const reservation={operationId,claimToken,runtimeOwnerEpoch:1,runtimeOwnerToken:token};
const dialect=new PgDialect();
const executor=(client:pg.Client)=>({
  execute(query:any){const rendered=dialect.sqlToQuery(query);return client.query(rendered.sql,rendered.params);},
});
function helpers(client:pg.Client,legacy=false,options:{
  managedTransactions?:boolean;
  historicalClaim?:boolean;
  afterRenewal?:()=>Promise<void>;
  budgetLock?:(tx:ReturnType<typeof executor>)=>Promise<void>;
}={}) {
  const texts=names.map(name=>{
    if(name==="claimSfpRuntimeDeploymentOwner" && options.historicalClaim){
      const declaration=ast.statements.filter(ts.isFunctionDeclaration)
        .find(node=>node.name?.text===name)!;
      const statements=declaration.body!.statements;
      return `async function claimSfpRuntimeDeploymentOwner(options={}) {
        ${statements[0].getText(ast)} ${statements[1].getText(ast)}
        ${statements[statements.length-1].getText(ast)}
      }`;
    }
    if(name==="renewSfpRuntimeOwnerLease" && legacy)return renewal.replace(selectorPin,"");
    if(name==="markSfpProviderOperationDispatchBoundary" && legacy)return functions.get(name)!
      .replace(independentRenewal,"")
      .replace("await db.transaction(async (tx) => {",
        "await db.transaction(async (tx) => { await renewSfpRuntimeOwnerLease(tx, reservation, fence);");
    return functions.get(name)!;
  });
  const compiled=ts.transpileModule(texts.join("\n"),{
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None},
  }).outputText;
  return new Function("sql","rows","getCurrentRoutineSfpRuntimeFence","sameSfpRuntimeRelease",
    "SFP_RUNTIME_OWNER_LEASE_MS","readSfpAutomaticPublish","db","acquireLadderBudgetLock","boundCanonicalWriteTransaction",
    `${compiled}\nreturn {renewSfpRuntimeOwnerLease,renewSfpRuntimeJobLease,lockCurrentSfpRuntimeOwner,claimSfpRuntimeDeploymentOwner,markSfpProviderOperationDispatchBoundary};`
  )(sql,(value:any)=>value.rows ?? value,async()=>fence,sameSfpRuntimeRelease,SFP_RUNTIME_OWNER_LEASE_MS,
    ()=>({...fence,buildId:"fixture-publish",builtAt:"2026-10-05T21:29:38.363Z"}),
    {transaction:async(callback:any)=>{
      if(!options.managedTransactions)return callback(executor(client));
      await client.query("BEGIN");
      let result:any;
      try {result=await callback(executor(client));await client.query("COMMIT");}
      catch(error){await client.query("ROLLBACK");throw error;}
      if(options.afterRenewal){const hook=options.afterRenewal;options.afterRenewal=undefined;await hook();}
      return result;
    }},options.budgetLock ?? (async()=>{throw new Error("FIXTURE_STOP_BEFORE_PROVIDER");}),boundCanonicalWriteTransaction);
}

const root=mkdtempSync(join(tmpdir(),"test-sfp-dispatch-lock-"));
const socket=net.createServer();
await new Promise<void>(resolve=>socket.listen(0,"127.0.0.1",resolve));
const port=(socket.address() as net.AddressInfo).port;
await new Promise<void>(resolve=>socket.close(()=>resolve()));
const url=`postgresql://${userInfo().username}@127.0.0.1:${port}/test_sfp_dispatch_lock`;
let started=false;
const clients:pg.Client[]=[];
let checks=0;
const check=(value:unknown,label:string)=>{assert(value,label);checks++;console.log(`PASS ${label}`);};
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
try {
  execFileSync("initdb",["-D",join(root,"data"),"-A","trust","--no-locale"],{stdio:"pipe"});
  execFileSync("pg_ctl",["-D",join(root,"data"),"-l",join(root,"postgres.log"),
    "-o",`-h 127.0.0.1 -p ${port} -k ${root} -F`,"-w","start"],{stdio:"pipe"});
  started=true;
  const bootstrap=new pg.Client({connectionString:url.replace("/test_sfp_dispatch_lock","/postgres")});
  await bootstrap.connect();await bootstrap.query("CREATE DATABASE test_sfp_dispatch_lock");await bootstrap.end();
  await assertDisposableTestInfrastructure({operation:"SFP dispatch lock-order certification",
    env:{NODE_ENV:"test",DATABASE_URL:url,TEST_DATABASE_URL:url},requireRedis:false});
  for(let i=0;i<4;i++){
    const client=new pg.Client({connectionString:url});await client.connect();clients.push(client);
    // Bounds apply only to disposable tests, never the application's settings.
    await client.query("SET statement_timeout='5s'; SET deadlock_timeout='100ms'");
  }
  const [admin,classification,recovery,second]=clients;
  await admin.query(`
    CREATE TABLE sfp_runtime_release_selection_events(id uuid PRIMARY KEY,selected_release jsonb);
    CREATE TABLE sfp_runtime_release_selectors(
      authority_key text PRIMARY KEY,deployment_identity text,environment_identity text,
      artifact_sha text,queue_topology_hash text,publisher_verified_artifact_sha text,
      publisher_verified_deployment_identity text,verification_reference text,
      selected_by text,selected_at timestamptz,selection_event_id uuid);
    CREATE TABLE sfp_runtime_owner_authority(
      authority_key text PRIMARY KEY,deployment_identity text,environment_identity text,
      artifact_sha text,queue_topology_hash text,owner_epoch integer,owner_token uuid,
      lease_expires_at timestamptz,revoked_at timestamptz,updated_at timestamptz);
    CREATE TABLE sfp_runtime_job_leases(
      operation_id uuid PRIMARY KEY,deployment_identity text,environment_identity text,
      artifact_sha text,process_identity text,owner_epoch integer,owner_token uuid,
      operation_claim_token uuid,lease_expires_at timestamptz,revoked_at timestamptz,updated_at timestamptz);
    CREATE TABLE provider_operations(
      id uuid PRIMARY KEY,claim_token uuid,state text,cancel_requested_at timestamptz,
      lease_expires_at timestamptz,updated_at timestamptz);
  `);
  const reset=async()=>{
    await admin.query("TRUNCATE sfp_runtime_owner_authority,sfp_runtime_release_selectors,sfp_runtime_release_selection_events,sfp_runtime_job_leases,provider_operations");
    await admin.query("INSERT INTO sfp_runtime_release_selection_events VALUES($1,'{}')",[selectionId]);
    await admin.query(`INSERT INTO sfp_runtime_release_selectors(
      authority_key,deployment_identity,environment_identity,artifact_sha,queue_topology_hash,selection_event_id)
      VALUES('routine_sfp',$1,$2,$3,$4,$5)`,
    [fence.deploymentIdentity,fence.environmentIdentity,fence.artifactSha,fence.queueTopologyHash,selectionId]);
    await admin.query(`INSERT INTO sfp_runtime_owner_authority VALUES(
      'routine_sfp',$1,$2,$3,$4,1,$5,clock_timestamp()+interval '2 minutes',NULL,clock_timestamp())`,
    [fence.deploymentIdentity,fence.environmentIdentity,fence.artifactSha,fence.queueTopologyHash,token]);
    await admin.query(`INSERT INTO sfp_runtime_job_leases VALUES(
      $1,$2,$3,$4,$5,1,$6,$7,clock_timestamp()+interval '5 minutes',NULL,clock_timestamp())`,
    [operationId,fence.deploymentIdentity,fence.environmentIdentity,fence.artifactSha,fence.processIdentity,token,claimToken]);
    await admin.query(`INSERT INTO provider_operations VALUES(
      $1,$2,'running',NULL,clock_timestamp()+interval '5 minutes',clock_timestamp())`,[operationId,claimToken]);
  };
  const blockedBy=async(waiter:pg.Client,blocker:pg.Client)=>{
    const waiterPid=(waiter as any).processID,blockerPid=(blocker as any).processID;
    for(let i=0;i<100;i++){
      const result=await admin.query("SELECT $2::int=ANY(pg_blocking_pids($1::int)) AS blocked",[waiterPid,blockerPid]);
      if(result.rows[0].blocked)return;
      await sleep(5);
    }
    throw new Error("Expected native blocking edge did not appear");
  };
  // Historical dispatch owns the owner row, while real recovery owns selector.
  // Its subsequent job-lease pin creates exactly the published two-way cycle.
  await reset();
  await classification.query("BEGIN");await recovery.query("BEGIN");
  const legacy=helpers(classification,true),claim=helpers(recovery);
  const historicalClaim=helpers(recovery,false,{historicalClaim:true});
  await legacy.renewSfpRuntimeOwnerLease(executor(classification),reservation,fence);
  const oldRecovery=historicalClaim.claimSfpRuntimeDeploymentOwner().then(()=>null,(error:any)=>error);
  await blockedBy(recovery,classification);
  const oldClassification=legacy.renewSfpRuntimeJobLease(executor(classification),reservation,fence)
    .then(()=>null,(error:any)=>error);
  // PostgreSQL aborts either victim; releasing it allows its peer to finish.
  const victim=await Promise.race([
    oldRecovery.then((error:any)=>({client:recovery,error})),
    oldClassification.then((error:any)=>({client:classification,error})),
  ]);
  check(victim.error?.code==="40P01","Old production dispatch and recovery reproduce the native 40P01 cycle");
  await victim.client.query("ROLLBACK");
  await Promise.all([oldRecovery,oldClassification]);
  await classification.query("ROLLBACK");await recovery.query("ROLLBACK");

  // Same schedule, corrected code: recovery waits on selector, not vice versa.
  await reset();
  await classification.query("BEGIN");await recovery.query("BEGIN");
  const fixed=helpers(classification);
  await fixed.renewSfpRuntimeOwnerLease(executor(classification),reservation,fence);
  const newRecovery=claim.claimSfpRuntimeDeploymentOwner().then((value:any)=>({value}),(error:any)=>({error}));
  await blockedBy(recovery,classification).catch(async error=>{
    const result=await newRecovery;
    console.error("FIXTURE_RECOVERY_BLOCK_DIAGNOSTIC",result.error?.name,result.error?.code,
      result.error?.message?.slice(0,180),result.value ? "completed_without_wait" : "no_value");
    throw error;
  });
  await fixed.renewSfpRuntimeJobLease(executor(classification),reservation,fence);
  await classification.query("COMMIT");
  const recovered=await newRecovery;await recovery.query("COMMIT");
  check(!recovered.error && recovered.value.ownerToken===token,
    "Corrected dispatch and real recovery both commit under the identical contention schedule");

  // Both dispatchers share selector, but only one takes owner UPDATE.
  await reset();await classification.query("BEGIN");await second.query("BEGIN");
  await fixed.renewSfpRuntimeOwnerLease(executor(classification),reservation,fence);
  const parallel=helpers(second).renewSfpRuntimeOwnerLease(executor(second),reservation,fence)
    .then(()=>null,(error:any)=>error);
  await blockedBy(second,classification);
  await classification.query("COMMIT");
  check(await parallel===null,"Concurrent dispatch renewals serialize without SHARE-to-UPDATE deadlock");
  await second.query("COMMIT");

  async function denied(label:string,setup:()=>Promise<unknown>,expected:string,input:any=reservation){
    await reset();await setup();
    const before=(await admin.query("SELECT lease_expires_at::text AS expiry FROM sfp_runtime_owner_authority")).rows[0].expiry;
    await classification.query("BEGIN");
    await assert.rejects(()=>fixed.renewSfpRuntimeOwnerLease(executor(classification),input,fence),
      (error:any)=>error.message===expected);
    await classification.query("ROLLBACK");
    const after=(await admin.query("SELECT lease_expires_at::text AS expiry FROM sfp_runtime_owner_authority")).rows[0].expiry;
    check(before===after,label);
  }
  await denied("Unselected releases cannot renew or dispatch",()=>
    admin.query("UPDATE sfp_runtime_release_selectors SET artifact_sha=$1",["c".repeat(40)]),
    "SFP_RUNTIME_OWNER_BLOCKED:CURRENT_RELEASE_NOT_SELECTED");
  await denied("Revoked owners remain rejected without lease revival",()=>
    admin.query("UPDATE sfp_runtime_owner_authority SET revoked_at=clock_timestamp()"),
    "SFP_RUNTIME_OWNER_FENCE_LOST");
  await denied("Expired owners remain rejected without lease revival",()=>
    admin.query("UPDATE sfp_runtime_owner_authority SET lease_expires_at=clock_timestamp()-interval '1 second'"),
    "SFP_RUNTIME_OWNER_FENCE_LOST");
  await denied("Stale owner tokens cannot renew authority",async()=>{},
    "SFP_RUNTIME_OWNER_FENCE_LOST",{...reservation,runtimeOwnerToken:claimToken});
  await denied("Stale owner epochs cannot renew authority",async()=>{},
    "SFP_RUNTIME_OWNER_FENCE_LOST",{...reservation,runtimeOwnerEpoch:2});

  // A lease that was valid before waiting must still be invalid afterward.
  await reset();
  await admin.query("UPDATE sfp_runtime_owner_authority SET lease_expires_at=clock_timestamp()+interval '250 milliseconds'");
  await recovery.query("BEGIN");
  await recovery.query("SELECT * FROM sfp_runtime_release_selectors FOR UPDATE");
  await classification.query("BEGIN");
  const expiryWait=fixed.renewSfpRuntimeOwnerLease(executor(classification),reservation,fence)
    .then(()=>null,(error:any)=>error);
  await blockedBy(classification,recovery);await sleep(300);await recovery.query("COMMIT");
  const expired=await expiryWait;await classification.query("ROLLBACK");
  check(expired?.message==="SFP_RUNTIME_OWNER_FENCE_LOST","Wall-clock expiry is rechecked after the selector lock wait");

  await reset();await classification.query("BEGIN");
  await fixed.renewSfpRuntimeOwnerLease(executor(classification),reservation,fence);
  await assert.rejects(()=>fixed.renewSfpRuntimeJobLease(executor(classification),
    {...reservation,claimToken:selectionId},fence),/SFP_RUNTIME_JOB_LEASE_FENCE_LOST/);
  await classification.query("ROLLBACK");
  check(true,"Job claim-token fencing is retained and the failed effect transaction rolls back");
  for(const change of [
    "UPDATE provider_operations SET cancel_requested_at=clock_timestamp()",
    "UPDATE provider_operations SET lease_expires_at=clock_timestamp()-interval '1 second'",
  ]){
    await reset();await admin.query(change);await classification.query("BEGIN");
    await fixed.renewSfpRuntimeOwnerLease(executor(classification),reservation,fence);
    await assert.rejects(()=>fixed.renewSfpRuntimeJobLease(executor(classification),reservation,fence),
      /SFP_PROVIDER_RESERVATION_INVALID/);
    await classification.query("ROLLBACK");
    check(true,change.includes("cancel_requested_at")
      ? "Cancelled provider operations still cannot dispatch" : "Expired operation claims still cannot dispatch");
  }
  check(marker.includes("lease_expires_at>clock_timestamp()") && marker.includes("dispatch_marked_at"),
    "Final live-lease checks and durable dispatch marker remain in the production boundary");

  // Execute the real dispatch boundary up to a deliberately blocked budget
  // lock. The injected stop prevents any parent/provider marker or transport
  // from running; native owner contention and transaction commits are real.
  const budgetKey="fixture-dispatch-budget-hold";
  for(const legacy of [true,false]){
    await reset();await second.query("BEGIN");
    await second.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[budgetKey]);
    let reachedBudget=false;
    const dispatch=helpers(classification,legacy,{managedTransactions:true,budgetLock:async(tx)=>{
      reachedBudget=true;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${budgetKey},0))`);
      throw new Error("FIXTURE_STOP_BEFORE_PROVIDER");
    }}).markSfpProviderOperationDispatchBoundary(reservation).then(()=>null,(error:any)=>error);
    await blockedBy(classification,second);
    check(reachedBudget,legacy?"Historical dispatch reached the held budget lock":"Corrected dispatch reached the same held budget lock");
    const reader=helpers(recovery,false,{managedTransactions:true,historicalClaim:legacy})
      .claimSfpRuntimeDeploymentOwner()
      .then((value:any)=>({value}),(error:any)=>({error}));
    if(legacy){
      await blockedBy(recovery,classification);
      check(true,"Historical held-budget dispatch blocks recovery's actual initial claim");
    }else{
      const result=await reader;
      check(!result.error && result.value.ownerToken===token,
        "Corrected held-budget dispatch allows recovery's actual initial claim to complete");
    }
    await second.query("COMMIT");
    check((await dispatch)?.message==="FIXTURE_STOP_BEFORE_PROVIDER",
      "Budget control stops before provider dispatch and rolls back effect writes");
    const result=await reader;
    if(legacy)check(!result.error,"Historical blocked claim resumes after dispatch rollback");
  }
  // Renewal may commit, but no subsequent authority drift is permission to
  // enter budget checks or dispatch. The actual boundary must re-pin first.
  for(const [label,change] of [
    ["revocation","UPDATE sfp_runtime_owner_authority SET revoked_at=clock_timestamp()"],
    ["expiry","UPDATE sfp_runtime_owner_authority SET lease_expires_at=clock_timestamp()-interval '1 second'"],
    ["owner epoch","UPDATE sfp_runtime_owner_authority SET owner_epoch=owner_epoch+1"],
    ["owner token",`UPDATE sfp_runtime_owner_authority SET owner_token='${selectionId}'`],
    ["release selection",`UPDATE sfp_runtime_release_selectors SET artifact_sha='${"c".repeat(40)}'`],
  ]){
    await reset();let budgetCalls=0;
    const guarded=helpers(classification,false,{managedTransactions:true,
      afterRenewal:async()=>{await admin.query(change);},
      budgetLock:async()=>{budgetCalls++;throw new Error("FIXTURE_UNEXPECTED_BUDGET");}});
    await assert.rejects(()=>guarded.markSfpProviderOperationDispatchBoundary(reservation),
      /SFP_RUNTIME_OWNER_FENCE_LOST/);
    check(budgetCalls===0,`Post-renewal ${label} is rejected before budget or dispatch effects`);
  }
  await reset();
  await admin.query("UPDATE sfp_runtime_owner_authority SET lease_expires_at=clock_timestamp()+interval '20 seconds'");
  const upkeep=helpers(classification,false,{managedTransactions:true});
  await assert.rejects(()=>upkeep.markSfpProviderOperationDispatchBoundary(reservation),/FIXTURE_STOP_BEFORE_PROVIDER/);
  const lease=(await admin.query(`SELECT lease_expires_at>clock_timestamp()+interval '100 seconds' AS renewed
    FROM sfp_runtime_owner_authority`)).rows[0];
  check(lease.renewed,"Operational renewal remains committed after effect rollback, without granting dispatch");
  console.log(`SFP dispatch lock ordering: ${checks} regression checks passed; native PostgreSQL, zero app-DB or provider calls`);
} finally {
  for(const client of clients){try{await client.query("ROLLBACK");await client.end();}catch{}}
  if(started)execFileSync("pg_ctl",["-D",join(root,"data"),"-m","immediate","-w","stop"],{stdio:"pipe"});
  rmSync(root,{recursive:true,force:true});
}
