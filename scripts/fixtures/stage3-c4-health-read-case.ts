import assert from "node:assert/strict";
import type {stage3BHttpFixture} from "./stage3-b-http";
import type {privateStage3Browser} from "./private-stage3-browser";

export async function runC4HealthReadCase(
  h:Awaited<ReturnType<typeof stage3BHttpFixture>>,
  b:Awaited<ReturnType<typeof privateStage3Browser>>,
) {
  const {contacts,merchantHealthScores,churnScoreWeights}=await import("../../shared/schema");
  const [contact]=await h.db.insert(contacts).values({firstName:h.prefix,lastName:"Stored Churn Observation",
    email:`${h.prefix}-health-observed@example.test`,phone:"",recordClass:"production",assignedTo:h.email("admin")}).returning();
  const [observation]=await h.db.insert(merchantHealthScores).values({contactId:contact.id,
    churnScore:80,riskTier:"High",computedAt:new Date("2026-10-01T00:00:00Z")}).returning();
  await h.db.delete(churnScoreWeights); // owned private config case only
  await b.navigate("/dashboard/merchant-risk?tab=health&healthView=churn-risk");
  await b.waitFor(/Stored Churn Observation/);await b.waitFor(/Signal weights are not configured/);
  const count=()=>b.evaluate('document.querySelector("[data-testid=text-churn-risk-count]").innerText');
  assert.equal(await count(),"1");
  assert.match(await b.evaluate('document.querySelector("[data-testid=churn-summary-provenance]").innerText'),/merchant_health_scores.*UTC/s);
  assert.match(await b.evaluate('document.querySelector("[data-testid=churn-record-provenance]").innerText'),/1 stored model score records/);
  assert.equal(Number((await h.pool.query("SELECT count(*) FROM churn_score_weights")).rows[0].count),0);
  b.failRead("/api/churn-scores/summary",{exact:true});await b.call("Page.reload");
  await b.waitFor(/Independent churn tier summary unavailable/);assert.equal(await count(),"Unavailable");
  await b.waitFor(/Stored Churn Observation/);
  await b.click('[data-testid="button-churn-filter-low"]');
  await b.waitFor(/No stored model score records in this authorized selection/);
  assert.equal((await b.text()).includes("No churn scores computed yet"),false);
  assert.equal(await count(),"Unavailable");
  await b.click('[data-testid="button-churn-filter-all"]');await b.waitFor(/Stored Churn Observation/);
  b.failRead(null);b.failRead("/api/churn-scores",{exact:true});await b.call("Page.reload");
  await b.waitFor(/Churn worklist unavailable/);await b.waitFor(/0 critical · 1 high/);assert.equal(await count(),"1");
  b.failRead(null);b.failRead("/api/churn-score-weights",{exact:true});await b.call("Page.reload");
  await b.waitFor(/Signal weights unavailable; no default multiplier/);await b.waitFor(/Stored Churn Observation/);
  await b.screenshot("health-independent-score-config-fault");b.failRead(null);
  for(const path of ["/api/churn-scores/summary","/api/churn-scores","/api/churn-score-weights"]){
    assert.ok(b.readFaults.some(f=>f.path===path&&f.status===503),`Actual fault interception: ${path}`);
  }
  assert.equal(h.externalCalls(),0);
  return {phase:"Health actual scoped model records, observed provenance and independent faults",
    contactId:contact.id,scoreId:observation.id,configGetWrites:0,
    faults:["summary503","scoreCollection503","weightConfig503"],
    outcome:"Unavailable source never becomes zero; unrelated authorized facts remain",
    qualification:"Admin compiled UI/source read handlers; not eligible-merchant denominator, alerts/NPS/threshold/roster/config-write/computation/native or full role/state matrix."};
}
