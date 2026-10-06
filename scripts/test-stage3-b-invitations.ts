import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {stage3BHttpFixture} from "./fixtures/stage3-b-http";
let configured=true, fail=false;
const mails:Array<{to:string;html:string}>=[];
const h=await stage3BHttpFixture(async app=>{
  const {registerActivationRoutes}=await import("../server/routes/activation");
  const {registerAdminRoutes}=await import("../server/routes/admin");
  registerActivationRoutes(app,{invitationMail:{isSmtpConfigured:()=>configured,sendSmtpEmail:async(input:any)=>{
    mails.push(input);
    return fail?{success:false,error:"fixture delivery failure"}:{success:true,messageId:"fake-accepted"};
  }}});
  registerAdminRoutes(app);
});
try {
  const input={email:`rep-${randomUUID()}@example.test`,firstName:"Invited",lastName:"Fixture"};
  const provision="/api/activation/provision-rep";
  for(const role of ["anonymous","manager","agent","merchant","affiliate","partner"]) {
    const denied=await h.request(role,"POST",provision,input);
    assert.ok([401,403].includes(denied.status));
  }
  assert.equal(mails.length,0);
  assert.equal((await h.request("admin","POST",provision,input,false)).status,403);
  const created=await h.request("admin","POST",provision,input);
  assert.equal(created.status,200,JSON.stringify(created.body));assert.equal(mails.length,1);
  assert.equal((await h.request("admin","POST",provision,input)).status,409);
  assert.equal(mails.length,1,"duplicate provision never sends another invite");
  const [user]=(await h.pool.query("SELECT id,account_version FROM users WHERE email=$1",[input.email])).rows;
  assert.ok(user.id);
  const resend="/api/activation/resend-rep-invite";
  const resent=await h.request("admin","POST",resend,{userId:user.id});
  assert.equal(resent.status,200,JSON.stringify(resent.body));assert.equal(mails.length,2);
  const {isAuthActionValid}=await import("../server/services/auth-actions");
  const token=(html:string)=>decodeURIComponent(html.match(/activate-rep#token=([^"&<]+)/)![1]);
  assert.equal(await isAuthActionValid(token(mails[0].html),"agent_rep_invite"),false,"resend revokes the first continuation");
  assert.equal(await isAuthActionValid(token(mails[1].html),"agent_rep_invite"),true);
  const deactivated=await h.request("admin","POST",`/api/admin/users/${user.id}/lifecycle`,{action:"deactivate",expectedVersion:1});
  assert.equal(deactivated.status,200);
  assert.equal(await isAuthActionValid(token(mails[1].html),"agent_rep_invite"),false);
  const blocked=await h.request("admin","POST",resend,{userId:user.id});
  assert.ok([401,404,409].includes(blocked.status),JSON.stringify(blocked));
  assert.equal(mails.length,2,"inactive invite continuation cannot send");
  configured=false;
  const unconfigured=await h.request("admin","POST",provision,{...input,email:`rep-${randomUUID()}@example.test`});
  assert.equal(unconfigured.status,200);assert.equal(unconfigured.body.inviteDisposition,"skipped_no_smtp");assert.equal(mails.length,2);
  configured=true;fail=true;
  const failed=await h.request("admin","POST",provision,{...input,email:`rep-${randomUUID()}@example.test`});
  assert.equal(failed.status,200);assert.equal(mails.length,3);
  assert.equal(failed.body.inviteDisposition,"failed");
  const google=await h.originalFetch(`${h.base}/api/auth/google`,{redirect:"manual"});
  assert.equal(google.status,302);assert.match(google.headers.get("location") ?? "",/disabled|login/);
  assert.equal(h.externalCalls(),0);
  console.log("PASS actual existing provision/collision/resend, invalidated invite, inactive recovery fence, unconfigured/fake failed transport, role/CSRF and disabled Google redirect; all invitation transport explicitly fake, zero real external calls.");
} finally {await h.close();}
