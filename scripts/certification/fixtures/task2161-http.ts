import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import type {Pool} from 'pg';
/** Full Express/auth/CSRF route registration, independent of test-only middleware mocks. */
export async function verifyDiscoveryHttp(pool:Pool){
 const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=(probe.address() as any).port;await new Promise<void>(r=>probe.close(()=>r()));
 const origin=`http://127.0.0.1:${port}`;const nonce=randomBytes(32).toString('hex');const password=`synthetic-${randomBytes(20).toString('hex')}`;
 const target=new URL(process.env.DATABASE_URL!);const root=await realpath(os.tmpdir()),socket=await realpath(target.searchParams.get('host')!);if(!socket.startsWith(root+path.sep))throw new Error('HTTP_PRIVATE_SOCKET_REQUIRED');target.searchParams.set('host',path.join(os.tmpdir(),path.relative(root,socket)));
 const env={...process.env,DATABASE_URL:target.href,TEST_DATABASE_URL:target.href,PORT:String(port),APP_URL:origin,BACKGROUND_JOB_PROFILE:'off',CRO03_PROVIDER_TRANSPORT_ENABLED:'false',CERTIFICATION_HTTP_HOST:'127.0.0.1',CERTIFICATION_HTTP_NONCE:nonce,ADMIN_SEED_EMAIL:'task2161-http-admin@liberty.test',ADMIN_SEED_PASSWORD:password};
 const hash=await bcrypt.hash(password,12);
 for(const role of ['manager','agent'])await pool.query("INSERT INTO users(id,email,first_name,last_name,role,password_hash,auth_provider) VALUES($1,$2,'Private','Acceptance',$3,$4,'local')",[`task2161-http-${role}`,`task2161-http-${role}@liberty.test`,role,hash]);
 const child=spawn(process.execPath,['node_modules/tsx/dist/cli.mjs','scripts/task2161-preview-entry.ts'],{env,stdio:['ignore','ignore','pipe']});
 let stderr='';child.stderr.on('data',b=>{stderr=(stderr+String(b)).slice(-4000);});
 const request=async(path:string,init:RequestInit={},jar?:Map<string,string>)=>{
  const headers=new Headers(init.headers);if(jar?.size)headers.set('cookie',[...jar].map(([k,v])=>`${k}=${v}`).join('; '));
  const response=await fetch(origin+path,{...init,headers});for(const cookie of response.headers.getSetCookie()){const pair=cookie.split(';')[0],i=pair.indexOf('=');jar?.set(pair.slice(0,i),pair.slice(i+1));}
  return response;
 };
 const login=async(email:string)=>{const jar=new Map<string,string>();const response=await request('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password})},jar);assert.equal(response.status,200,`Local login: ${email}`);const csrf=await (await request('/api/csrf-token',{},jar)).json();return {jar,token:csrf.token};};
 let checks=0;const check=(actual:number,expected:number,label:string)=>{assert.equal(actual,expected,label);checks++;};
 try{
  let ready=false;for(let n=0;n<90;n++){try{const health=await (await request('/api/health')).json();if(health.certificationHttpNonce===nonce){ready=true;break;}}catch{}if(child.exitCode!==null)throw new Error(`HTTP_CHILD_FAILED:${stderr}`);await new Promise(r=>setTimeout(r,500));}
  assert(ready,`Private HTTP listener readiness: ${stderr}`);
  check((await request('/api/scheduled-discovery')).status,401,'Anonymous read denied');
  const admin=await login(env.ADMIN_SEED_EMAIL);const manager=await login('task2161-http-manager@liberty.test');const agent=await login('task2161-http-agent@liberty.test');
  for(const who of [admin,manager])check((await request('/api/scheduled-discovery',{},who.jar)).status,200,'Allowed dashboard read');
  check((await request('/api/scheduled-discovery',{},agent.jar)).status,403,'Agent read denied');
  const definition=(await pool.query('SELECT id FROM discovery_definitions ORDER BY created_at LIMIT 1')).rows[0];
  const mutations=[['POST','/initialize',{}],['PUT','/schedule',{enabled:false,dailyDispatchCount:1,repeatDays:30,timezone:'America/New_York'}],['PUT',`/definitions/${definition.id}`,{enabled:true}],['POST',`/definitions/${definition.id}/coverage`,{coveredThrough:new Date(Date.now()+86400000).toISOString()}],['POST',`/definitions/${definition.id}/preview`,{}],['POST',`/runs/${randomUUID()}/import`,{}],['POST',`/runs/${randomUUID()}/reconcile`,{taskId:'fixture',evidence:'Synthetic local task-ID evidence only.'}]] as const;
  for(const [method,path,body] of mutations){
   for(const who of [manager,agent])check((await request('/api/scheduled-discovery'+path,{method,headers:{'content-type':'application/json','x-csrf-token':who.token,'Idempotency-Key':randomUUID()},body:JSON.stringify(body)},who.jar)).status,403,`Role denied ${method} ${path}`);
   check((await request('/api/scheduled-discovery'+path,{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)},admin.jar)).status,403,`Admin missing CSRF denied ${path}`);
  }
  check((await request('/api/scheduled-discovery/initialize',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':'wrong'},body:'{}'},admin.jar)).status,403,'Mismatched CSRF denied');
  check((await request('/api/outscraper-budget')).status,401,'Anonymous financial status denied');
  check((await request('/api/outscraper-budget',{},manager.jar)).status,200,'Manager can read shared budget');
  check((await request('/api/outscraper-budget',{},agent.jar)).status,403,'Agent cannot read privileged financial status');
  const budgetPut=(who:typeof admin,body:any,csrf=who.token)=>request('/api/outscraper-budget',{method:'PUT',headers:{'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify(body)},who.jar);
  check((await budgetPut(manager,{monthlyBudgetUsd:50})).status,403,'Manager cannot change shared financial authority');
  check((await budgetPut(admin,{monthlyBudgetUsd:50},'wrong')).status,403,'Financial change requires real CSRF');
  check((await budgetPut(admin,{monthlyBudgetUsd:50.01})).status,400,'Authorized monthly maximum cannot be raised above $50');
  check((await budgetPut(admin,{monthlyBudgetUsd:50,enabled:true})).status,400,'Budget mutation cannot activate searches');
  check((await budgetPut(admin,{monthlyBudgetUsd:50})).status,200,'Admin can prepare the shared cap without starting searches');
  const send=(path:string,method:string,body:any)=>request('/api/scheduled-discovery'+path,{method,headers:{'content-type':'application/json','x-csrf-token':admin.token,'Idempotency-Key':randomUUID()},body:JSON.stringify(body)},admin.jar);
  check((await send('/initialize','POST',{})).status,200,'Admin valid CSRF mutation accepted');
  check((await send('/schedule','PUT',{enabled:false,dailyDispatchCount:1,repeatDays:30,timezone:'invalid/zone'})).status,400,'Strict timezone rejected');
  check((await send(`/definitions/${definition.id}`,'PUT',{enabled:true,actorId:'spoof',programId:randomUUID()})).status,400,'Actor/program spoof rejected');
  check((await send(`/definitions/${randomUUID()}`,'PUT',{enabled:true})).status,404,'Unknown definition object denied');
  check((await request(`/api/scheduled-discovery/runs/${randomUUID()}`,{},admin.jar)).status,404,'Unknown run object denied');
  check((await request('/api/scheduled-discovery/runs/not-a-uuid',{},admin.jar)).status,400,'Invalid object rejected');
  const foreignProgram=(await pool.query("INSERT INTO sfp_programs(name,county_fips,vertical_ids,taxonomy_version,is_active,created_by) VALUES('Private foreign program',ARRAY['12011'],ARRAY['Healthcare'],2,false,'task2161-http') RETURNING id")).rows[0];
  const foreign=(await pool.query(`INSERT INTO discovery_definitions(program_id,program_pin,vertical,county_fips,area_type,area_key,query)
   VALUES($1,'private-foreign-pin','Healthcare','12011','county','12011','Foreign program synthetic query') RETURNING id`,[foreignProgram.id])).rows[0];
  check((await send(`/definitions/${foreign.id}`,'PUT',{enabled:true})).status,404,'Foreign program definition mutation denied');
  check((await send(`/definitions/${foreign.id}/coverage`,'POST',{coveredThrough:new Date(Date.now()+86400000).toISOString()})).status,404,'Foreign program coverage mutation denied');
  check((await send(`/definitions/${foreign.id}/preview`,'POST',{})).status,404,'Foreign program paid occurrence denied');
  console.log('TASK2161_HTTP_PASS',JSON.stringify({checks,realAuth:true,realCsrf:true,fullRouteRegistry:true,privateListener:true,providerCalls:0}));
 }finally{
  child.kill('SIGTERM');await Promise.race([once(child,'exit'),new Promise(r=>setTimeout(r,5000)).then(()=>child.kill('SIGKILL'))]);
 }
}
