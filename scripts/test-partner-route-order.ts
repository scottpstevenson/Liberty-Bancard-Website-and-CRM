import assert from "node:assert/strict";
import express from "express";
const {registerPartnersRoutes,numericPartnerIdOnly}=await import("../server/routes/partners");
const {registerOnboardingStagesRoutes}=await import("../server/routes/onboarding-stages");
const {registerPartnerProgramRoutes}=await import("../server/routes/partner-program");
// Production order (server/routes.ts): Partners are registered long before Onboarding Stages.
const app=express();
registerPartnersRoutes(app);
registerPartnerProgramRoutes(app);
registerOnboardingStagesRoutes(app);
const layers=((app as any).router.stack as any[]).filter(l=>l.route);
let checks=0;
const run=(handler:any,id:string)=>new Promise<{next?:any;status?:number}>(resolve=>{
  const res:any={status(c:number){this.code=c;return this;},json(){resolve({status:this.code});return this;}};
  Promise.resolve(handler({params:{id}},res,(arg?:any)=>resolve({next:arg}))).catch(()=>resolve({status:500}));
});
// Every GET/PATCH layer that could shadow a fixed sibling must pass non-numeric segments through.
for(const fixed of ["referral-pipeline","leaderboard","me"]){
  const path=`/api/partners/${fixed}`;
  const matching=layers.filter(l=>l.route.methods.get && l.matchers?.some((m:any)=>m(path)));
  assert(matching.length>=2,`${fixed}: expected the :id route and the fixed route, got ${matching.length}`);
  const fixedIndex=matching.findIndex(l=>l.route.path===path);
  assert(fixedIndex>=0,`${fixed}: fixed route is not registered`);
  for(const shadow of matching.slice(0,fixedIndex)){
    assert.equal(shadow.route.stack[0].handle,numericPartnerIdOnly,`${fixed}: ${shadow.route.path} is not guarded`);
    const out=await run(shadow.route.stack[0].handle,fixed);
    assert.equal(out.next,"route",`${fixed}: shadow route did not fall through`);checks+=2;
  }
  checks++;
}
const patchShadow=layers.find(l=>l.route.path==="/api/partners/:id"&&l.route.methods.patch)!;
assert.equal(patchShadow.route.stack[0].handle,numericPartnerIdOnly);checks++;
// Numeric IDs still proceed; invalid IDs never reach an integer lookup.
assert.equal((await run(numericPartnerIdOnly,"42")).next,undefined);checks++;
for(const bad of ["0","99999999999","-1","1e3","12abc","1.5"]){
  const out=await run(numericPartnerIdOnly,bad);
  assert(out.status===400||out.next==="route",`${bad} reached the handler`);checks++;
}
// The partner introduction routes sit under /api/partners/me/...; no parameterised sibling may match them first.
for(const method of ["get","post"] as const){
  const path="/api/partners/me/introductions";
  const matching=layers.filter(l=>l.route.methods[method] && l.matchers?.some((m:any)=>m(path)));
  assert.equal(matching.length,1,`${method} ${path}: expected exactly one matching route, got ${matching.map(l=>l.route.path).join(", ")}`);
  assert.equal(matching[0].route.path,path);checks++;
}
console.log(`Partner route order: ${checks} checks passed`);
process.exit(0);
