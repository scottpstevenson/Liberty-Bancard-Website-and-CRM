import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {stage3BHttpFixture} from "./fixtures/stage3-b-http";
const securityMail:Array<{html:string;label:string}>=[];
const deviceMail:any[]=[];
const h=await stage3BHttpFixture(async app=>{
  const {registerAdminRoutes}=await import("../server/routes/admin");
  registerAdminRoutes(app);
},{authMail:{
  sendAuthEmail:async(input)=>{securityMail.push(input);return "sent";},
  isGhlConfigured:()=>true,
  sendGhlEmail:async(input:any)=>{deviceMail.push(input);return {success:true} as any;},
}});
try {
  const {issueAuthAction}=await import("../server/services/auth-actions");
  const {authStorage}=await import("../server/replit_integrations/auth/storage");
  const {generateSync}=await import("otplib");
  const target=h.userId("other");
  const verify=await issueAuthAction({purpose:"user_email_verification",subject:{type:"user",id:target},ttlMs:60000});
  const verified=await h.request("anonymous","POST","/api/auth/verify-email",{token:verify.token});
  assert.equal(verified.status,200);
  assert.equal((await h.request("anonymous","POST","/api/auth/verify-email",{token:verify.token})).status,400);
  assert.equal((await h.request("anonymous","POST","/api/auth/forgot-password",{email:h.email("other")})).status,200);
  assert.equal(securityMail.length,1);
  const token=decodeURIComponent(securityMail[0].html.match(/reset-password#token=([^"&<]+)/)![1]);
  const resetPassword=`fixture-reset-${randomUUID()}`;
  const reset=await h.request("anonymous","POST","/api/auth/reset-password",{token,password:resetPassword});
  assert.equal(reset.status,200,JSON.stringify(reset.body));
  assert.equal(securityMail.length,2,"confirmation uses fake security transport");
  assert.equal((await h.request("other","GET","/api/auth/user")).status,401,"real reset invalidates old session");
  assert.equal((await h.request("anonymous","POST","/api/auth/reset-password",{token,password:resetPassword})).status,400);
  const resetLogin=await h.originalFetch(h.base+"/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({email:h.email("other"),password:resetPassword})});
  assert.equal(resetLogin.status,200);
  // MFA for a different active fixture uses the actual enrollment/confirmation
  // and pending-login routes, including fake trusted-device notification.
  const enrollment=await h.request("agent","POST","/api/auth/totp/enroll",{});
  assert.equal(enrollment.status,200);
  const code=generateSync({secret:enrollment.body.secret});
  const bad=code==="000000"?"111111":"000000";
  assert.equal((await h.request("agent","POST","/api/auth/totp/confirm",{code:bad})).status,401);
  const confirm=await h.request("agent","POST","/api/auth/totp/confirm",{code});
  assert.equal(confirm.status,200,JSON.stringify(confirm.body));
  const pending=await h.login("agent");
  assert.equal(pending.body.mfa_required,true);
  assert.equal((await h.request("agent","POST","/api/auth/totp/verify-login",{code:bad})).status,401);
  const login=await h.request("agent","POST","/api/auth/totp/verify-login",{code,rememberDevice:true,deviceName:"Fixture only"});
  assert.equal(login.status,200,JSON.stringify(login.body));
  const trusted=login.headers.getSetCookie().find(v=>v.startsWith("trusted_device_token="));
  assert.ok(trusted);
  assert.ok(deviceMail.length>=2,"MFA enabled and trusted-device messages are explicitly fake");
  const current=(await h.pool.query("SELECT account_version FROM users WHERE id=$1",[h.userId("agent")])).rows[0];
  const oldVerify=await issueAuthAction({purpose:"user_email_verification",subject:{type:"user",id:h.userId("agent")},ttlMs:60000});
  const oldReset=await issueAuthAction({purpose:"user_password_reset",subject:{type:"user",id:h.userId("agent")},ttlMs:60000});
  const deactivated=await h.request("admin","POST",`/api/admin/users/${h.userId("agent")}/lifecycle`,
    {action:"deactivate",expectedVersion:current.account_version});
  assert.equal(deactivated.status,200);
  assert.equal((await h.request("anonymous","POST","/api/auth/verify-email",{token:oldVerify.token})).status,400);
  assert.equal((await h.request("anonymous","POST","/api/auth/reset-password",{token:oldReset.token,password:resetPassword})).status,400);
  const before=securityMail.length;
  assert.equal((await h.request("anonymous","POST","/api/auth/forgot-password",{email:h.email("agent")})).status,200);
  assert.equal(securityMail.length,before,"inactive request reveals nothing and sends no recovery mail");
  const trustedLogin=await h.originalFetch(h.base+"/api/auth/login",{method:"POST",
    headers:{"Content-Type":"application/json",Cookie:trusted!.split(";")[0]},
    body:JSON.stringify({email:h.email("agent"),password:h.password})});
  assert.equal(trustedLogin.status,401,"inactive account cannot resume with a real trusted-device cookie");
  assert.equal((await authStorage.getTrustedDevices(h.userId("agent"))).length,0);
  assert.equal(h.externalCalls(),0);
  console.log("PASS actual verification/reset/replay and mail confirmation, MFA enrollment/confirmation/continuation/trusted device; inactive recovery/session/device fences, all security/GHL notifications explicitly fake, zero external calls.");
} finally {await h.close();}
