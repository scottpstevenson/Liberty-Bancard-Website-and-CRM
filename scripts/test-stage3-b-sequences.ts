import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {stage3BHttpFixture} from "./fixtures/stage3-b-http";
const h=await stage3BHttpFixture(async app=>{
  const module=await import("../server/routes/campaigns");
  module.registerCampaignsRoutes(app);
});
try {
  const sequence=(await h.pool.query(`INSERT INTO follow_up_sequences(name,status,created_by) VALUES('Retained fixture','paused',$1) RETURNING *`,[h.email("manager")])).rows[0];
  const step=(await h.pool.query(`INSERT INTO sequence_steps(sequence_id,step_order,action_type,body) VALUES($1,1,'email','original fixture body') RETURNING id`,[sequence.id])).rows[0];
  const fields=(version=1,role="manager")=>({commandId:randomUUID(),expectedVersion:version,
    expectedActorId:h.userId(role),expectedAccountVersion:1});
  const payload=fields();
  for(const role of ["agent","merchant","affiliate","partner"]) assert.equal((await h.request(role,"DELETE",`/api/sequences/${sequence.id}`,payload)).status,403);
  assert.equal((await h.request("manager","DELETE",`/api/sequences/${sequence.id}`,payload,false)).status,403);
  const result=await h.request("manager","DELETE",`/api/sequences/${sequence.id}`,payload);
  assert.equal(result.status,200,JSON.stringify(result.body));assert.ok(result.body.retiredAt);assert.equal(result.body.status,"paused");
  assert.equal((await h.request("manager","DELETE",`/api/sequences/${sequence.id}`,payload)).body.replayed,true);
  assert.equal((await h.pool.query("SELECT count(*)::int n FROM sequence_steps WHERE id=$1",[step.id])).rows[0].n,1);
  assert.equal((await h.request("manager","PUT",`/api/sequences/${sequence.id}/toggle-status`,fields(2))).status,409);
  const restored=await h.request("manager","POST",`/api/sequences/${sequence.id}/restore`,fields(2));
  assert.equal(restored.status,200);assert.equal(restored.body.status,"paused");assert.equal(restored.body.retiredAt,null);
  assert.equal((await h.request("manager","DELETE",`/api/sequences/${sequence.id}`,payload)).body.replayed,true);
  assert.equal((await h.pool.query("SELECT retired_at FROM follow_up_sequences WHERE id=$1",[sequence.id])).rows[0].retired_at,null,"retry never rewinds restore");
  const edit={...fields(3),name:"Retained edited fixture",steps:[{id:step.id,stepOrder:1,actionType:"email",body:"edited fixture body"}]};
  const concurrent=await Promise.all([h.request("manager","PUT",`/api/sequences/${sequence.id}`,edit),
    h.request("manager","PUT",`/api/sequences/${sequence.id}`,edit)]);
  assert.ok(concurrent.every(response=>response.status===200),JSON.stringify(concurrent));
  assert.equal((await h.pool.query("SELECT body FROM sequence_steps WHERE id=$1",[step.id])).rows[0].body,"edited fixture body");
  const refused=await h.request("manager","PUT",`/api/sequences/${sequence.id}`,{...fields(4),name:"must roll back",steps:[]});
  assert.equal(refused.status,409);assert.equal((await h.pool.query("SELECT name FROM follow_up_sequences WHERE id=$1",[sequence.id])).rows[0].name,"Retained edited fixture");
  assert.equal((await h.request("manager","PUT",`/api/sequences/${sequence.id}`,{...fields(3),name:"stale"})).status,409);
  await h.pool.query("UPDATE follow_up_sequences SET retired_at=NOW(),status='active' WHERE id=$1",[sequence.id]);
  const {storage}=await import("../server/storage");
  await assert.rejects(storage.createSequenceEnrollment({sequenceId:sequence.id,contactId:null,status:"paused"} as any),/not found|blocked/);
  assert.equal((await h.request("manager","PUT",`/api/sequences/${sequence.id}/toggle-status`,fields(4))).status,409);
  assert.equal((await h.pool.query("SELECT count(*)::int n FROM sequence_command_receipts WHERE sequence_id=$1",[sequence.id])).rows[0].n,3);
  assert.equal(h.externalCalls(),0);
  console.log("PASS registered sequence retirement/restore/edit: session/role/CSRF/version/replay, atomic retained step IDs, concurrent save, step-removal denial before any writes, legacy-active retired enrollment denial, zero external effects. Canonical preparer and browser certification remain separate.");
} finally {await h.close();}
