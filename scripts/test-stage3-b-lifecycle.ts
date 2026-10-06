import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {stage3BHttpFixture} from "./fixtures/stage3-b-http";
const h=await stage3BHttpFixture(async app=>{
  const {registerCrmOperationsRoutes}=await import("../server/routes/crm-operations");
  const {registerAdminRoutes}=await import("../server/routes/admin");
  const {registerContactDeletionRoutes}=await import("../server/routes/contact-deletion");
  registerCrmOperationsRoutes(app);registerAdminRoutes(app);registerContactDeletionRoutes(app);
});
try {
  const contact=async(owner="agent")=>(await h.pool.query(`INSERT INTO contacts(first_name,last_name,email,phone,assigned_to,record_class)
    VALUES('Lifecycle','Fixture',$1,$2,$3,'production') RETURNING *`,
    [`${randomUUID()}@example.test`,`+1${String(Date.now()+Math.floor(Math.random()*999999)).slice(-10)}`,h.email(owner)])).rows[0];
  const a=await contact(),b=await contact("other");
  const body=(rows:any[],role="manager")=>({commandId:randomUUID(),expectedActorId:h.userId(role),expectedAccountVersion:1,
    items:rows.map(row=>({id:row.id,expectedVersion:row.lifecycle_version,expectedOwner:row.assigned_to,expectedRecordClass:row.record_class}))});
  const send=(id:number,operation:string,payload:any,role="manager",csrf=true)=>
    h.request(role,"POST",`/api/contacts/${id}/${operation}`,payload,csrf);
  const archive=body([a]);
  assert.equal((await send(a.id,"archive",archive,"anonymous")).status,401);
  for(const role of ["agent","merchant","partner","affiliate"]) assert.equal((await send(a.id,"archive",archive,role)).status,403);
  assert.equal((await send(a.id,"archive",archive,"manager",false)).status,403);
  assert.equal((await h.request("manager","POST",`/api/contacts/${a.id}junk/archive`,archive)).status,400);
  assert.equal((await send(b.id,"archive",archive)).status,400);
  const saved=await send(a.id,"archive",archive);assert.equal(saved.status,200,JSON.stringify(saved.body));
  assert.equal(saved.body.lifecycleVersion,2);assert.ok(saved.body.archivedAt);
  const retried=await send(a.id,"archive",archive);assert.equal(retried.status,200);assert.equal(retried.body.replayed,true);
  assert.equal((await send(a.id,"archive",{...archive,items:[{...archive.items[0],expectedOwner:"changed"}]})).status,409);
  assert.equal((await send(a.id,"restore",body([a]))).status,409,"stale version refused");
  const archived=(await h.pool.query("SELECT * FROM contacts WHERE id=$1",[a.id])).rows[0];
  const restore=body([archived]);const restored=await send(a.id,"restore",restore);
  assert.equal(restored.status,200);assert.equal(restored.body.archivedAt,null);assert.equal(restored.body.lifecycleVersion,3);
  assert.equal((await send(a.id,"archive",archive)).body.replayed,true);
  assert.equal((await h.pool.query("SELECT archived_at FROM contacts WHERE id=$1",[a.id])).rows[0].archived_at,null,"accepted retry never rewinds a later restore");
  const current=(await h.pool.query("SELECT * FROM contacts WHERE id=$1",[a.id])).rows[0];
  const missing=body([current,{...b,id:2147483647}]);
  assert.equal((await h.request("manager","POST","/api/contacts/bulk-archive",missing)).status,404);
  assert.equal((await h.pool.query("SELECT count(*)::int n FROM contacts WHERE id IN ($1,$2) AND archived_at IS NOT NULL",[a.id,b.id])).rows[0].n,0);
  const stale=body([current,b]);stale.items[1].expectedRecordClass="synthetic_qa";
  assert.equal((await h.request("manager","POST","/api/contacts/bulk-archive",stale)).status,409);
  assert.equal((await h.pool.query("SELECT count(*)::int n FROM contacts WHERE id IN ($1,$2) AND archived_at IS NOT NULL",[a.id,b.id])).rows[0].n,0);
  const bulk=body([current,b]);const pair=await Promise.all([h.request("manager","POST","/api/contacts/bulk-archive",bulk),
    h.request("manager","POST","/api/contacts/bulk-archive",bulk)]);
  assert.ok(pair.every(response=>response.status===200));assert.equal(pair[0].body.changed,2);
  assert.equal((await h.pool.query("SELECT count(*)::int n FROM audit_logs WHERE action='contact_archived' AND entity_id IN ($1,$2)",[a.id,b.id])).rows[0].n,3);
  const request=await h.request("anonymous","POST","/api/data-requests",{email:a.email,fullName:"Fixture Subject",requestType:"delete",
    status:"completed",processedBy:"forged",processedAt:"2026-01-01",executionState:"erased",version:99});
  assert.equal(request.status,201,JSON.stringify(request.body));
  assert.equal(request.body.status,"pending");assert.equal(request.body.processedBy,null);
  assert.equal(request.body.executionState,"not_executed");assert.equal(request.body.version,1);
  const path=`/api/data-requests/${request.body.id}`;
  const review={status:"processing",expectedVersion:1,subjectContactId:a.id,reviewEvidence:"Fixture record-match review",
    retentionReason:"Consent, audit, intake and send evidence retained; no erasure executed.",
    expectedActorId:h.userId("admin"),expectedAccountVersion:1};
  assert.equal((await h.request("manager","PUT",path,review)).status,403);
  assert.equal((await h.request("admin","PUT",path,review,false)).status,403);
  assert.equal((await h.request("admin","PUT",path,{...review,processedBy:"forged"})).status,400);
  assert.equal((await h.request("admin","PUT",path,{...review,subjectContactId:b.id})).status,409);
  assert.equal((await h.request("admin","PUT",path,{...review,status:"completed"})).status,409);
  const reviewed=await h.request("admin","PUT",path,review);assert.equal(reviewed.status,200,JSON.stringify(reviewed.body));
  assert.equal(reviewed.body.processedBy,h.userId("admin"));assert.ok(reviewed.body.processedAt);
  assert.equal((await h.request("admin","PUT",path,review)).body.replayed,true);
  assert.equal((await h.request("admin","PUT",path,{...review,reviewEvidence:"different retry"})).status,409);
  const complete=await h.request("admin","PUT",path,{...review,status:"completed",expectedVersion:2});
  assert.equal(complete.status,200);assert.equal(complete.body.executionState,"not_executed");
  assert.equal((await h.pool.query("SELECT count(*)::int n FROM contacts WHERE id IN ($1,$2)",[a.id,b.id])).rows[0].n,2);
  assert.equal((await h.pool.query("SELECT count(*)::int n FROM audit_logs WHERE action='privacy_review_updated' AND entity_type='data_request' AND entity_id=$1",[request.body.id])).rows[0].n,2);
  // Canonically installed trigger and both canonical/legacy evidence stay
  // present independently of the disposable label on the parent.
  await h.pool.query("UPDATE contacts SET record_class='synthetic' WHERE id=$1",[a.id]);
  const evidence=(await h.pool.query(`INSERT INTO consent_audit_logs(contact_id,channel,action,consented,record_kind,event_namespace,event_key)
    VALUES($1,'email','opt_in',true,'canonical_fact',$2,$3),($1,'email','unchecked',false,'legacy_trace',NULL,NULL) RETURNING id`,
    [a.id,h.prefix,randomUUID()])).rows;
  await h.pool.query(`INSERT INTO contact_source_events(contact_id,event_key,source_category,source_type,actor_type)
    VALUES($1,$2,'manual_crm','fixture','user')`,[a.id,randomUUID()]);
  const child=(await h.pool.query("INSERT INTO deals(contact_id,name,record_class) VALUES($1,'Protected child','unknown') RETURNING id",[a.id])).rows[0];
  assert.equal((await h.pool.query("SELECT tgenabled FROM pg_trigger WHERE tgname='consent_audit_append_only_guard'")).rows[0].tgenabled,"O");
  await assert.rejects(h.pool.query("UPDATE consent_audit_logs SET action='opt_out' WHERE id=$1",[evidence[0].id]),
    (e:any)=>e.code==="42501","the real installed append-only trigger denies mutation");
  const frozen=await h.request("admin","POST","/api/admin/contacts/bulk-delete-snapshot",{contactIds:[a.id]});
  assert.equal(frozen.status,200);
  const preview=await h.request("admin","POST","/api/admin/contacts/bulk-hard-delete/preview",{snapshotId:frozen.body.snapshotId});
  assert.equal(preview.status,200,JSON.stringify(preview.body));
  assert.equal(preview.body.eligible.length,0);
  assert.equal(preview.body.blocked[0].reason,"retention_contract_unverified");
  const {executeDeleteBatch}=await import("../server/services/contact-deletion-service");
  const attempt=await executeDeleteBatch([a.id],randomUUID());
  assert.equal(attempt.deleted,0);assert.equal(attempt.failed.length,1);
  assert.equal((await h.pool.query("SELECT count(*)::int n FROM consent_audit_logs WHERE contact_id=$1",[a.id])).rows[0].n,2);
  assert.equal((await h.pool.query("SELECT count(*)::int n FROM contact_source_events WHERE contact_id=$1",[a.id])).rows[0].n,1);
  assert.ok((await h.pool.query("SELECT id FROM deals WHERE id=$1",[child.id])).rows[0]);
  assert.equal((await h.pool.query("SELECT count(*)::int n FROM audit_logs WHERE action='privacy_review_updated' AND entity_type='data_request' AND entity_id=$1",[request.body.id])).rows[0].n,2);
  assert.equal(h.externalCalls(),0);
  console.log("PASS actual contact/privacy handlers: strict IDs, sessions/CSRF, privileged manager scope, version/owner/class/set fences, atomic bulk, concurrency/retry/restore preservation, append-only audits, public controlled-field rejection, explicit email record match, whitelisted review transitions/operator/timestamp, administrative completion not erasure; actual installed canonical consent trigger, retained legacy/canonical/provenance/unknown child and blocked synthetic parent preview/direct execute; zero external effects. Permanent erasure remains unsupported, not certified eligible.");
} finally {await h.close();}
