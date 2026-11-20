import assert from "node:assert/strict";
import { stage3BHttpFixture } from "../fixtures/stage3-b-http";
import { applyCertificationProviderDenyBoundary, getBlockedCertificationNetworkAttemptCount } from "../certification-provider-deny";
applyCertificationProviderDenyBoundary({ fatal: true });
const h = await stage3BHttpFixture(async app => {
  (await import("../../server/routes/campaigns")).registerCampaignsRoutes(app);
  (await import("../../server/routes/activation")).registerActivationRoutes(app);
  (await import("../../server/routes/acquisition")).registerAcquisitionRoutes(app);
}, undefined, { backgroundProfile: "off" });
let checks = 0;
const check = (condition: unknown, label: string) => { assert(condition, label); checks++; console.log("PASS " + label); };
try {
  await h.pool.query("INSERT INTO outbound_pause_control(id,state,epoch,reason) VALUES(1,'paused',4,'private launch repair fixture') ON CONFLICT(id) DO UPDATE SET state='paused',epoch=4");
  const beforeBudget = (await h.pool.query("SELECT * FROM outscraper_budget_policy")).rows;
  const campaign = (await h.pool.query("INSERT INTO campaigns(name,status,ai_personalization) VALUES('Launch repair fixture','draft',false) RETURNING id")).rows[0].id;
  await h.pool.query("INSERT INTO campaign_steps(campaign_id,step_order,step_type,subject,body_template,channel) VALUES($1,1,'email','Hi {{unknownField}}','Hello {{companyName}}','email')", [campaign]);
  const approve = () => h.request("admin", "POST", `/api/campaigns/${campaign}/approve`, { confirm: "APPROVE CAMPAIGN LAUNCH" });
  check((await approve()).status === 409, "Real approval route refuses unsupported merge fields");
  check(Number((await h.pool.query("SELECT count(*) FROM campaign_approvals WHERE campaign_id=$1", [campaign])).rows[0].count) === 0, "Rejected content records no approval");
  await h.pool.query("UPDATE campaign_steps SET subject='Hi {{firstName}}' WHERE campaign_id=$1", [campaign]);
  check((await approve()).status === 200, "Supported camelCase campaign content can be reviewed through existing approval owner");
  const seq = (await h.pool.query("INSERT INTO follow_up_sequences(name,status,trigger_type) VALUES('Pinned launch fixture','paused','manual') RETURNING id")).rows[0].id;
  await h.pool.query("INSERT INTO sfp_campaign_package_versions(package_key,vertical,campaign_id,campaign_name,sequence_id,sequence_name,sequence_family,content_hash,lifecycle_state,actor_id) VALUES('sfp.auto_repair.v1','Automotive',$1,'Launch repair fixture',$2,'Pinned launch fixture','sfp-launch-fixture',$3,'current',$4)", [campaign, seq, "a".repeat(64), h.userId("admin")]);
  check((await approve()).status === 409, "Current SFP package cannot acquire generic campaign approval");
  check((await h.request("admin", "PUT", `/api/campaigns/${campaign}/toggle-status`, {})).status === 409, "Previously approved campaign cannot bypass canonical release after becoming a current SFP projection");
  await h.pool.query("UPDATE campaigns SET status='active' WHERE id=$1", [campaign]);
  check((await h.request("admin", "PUT", `/api/campaigns/${campaign}/toggle-status`, {})).status === 200, "Narrow guard preserves emergency pause of an already-active current campaign");
  check((await h.request("manager", "POST", `/api/campaigns/${campaign}/approve`, { confirm: "APPROVE CAMPAIGN LAUNCH" })).status === 403, "Manager cannot approve campaign content");
  for (const role of ["admin", "manager"]) {
    const readiness = await h.request(role, "GET", "/api/activation/readiness");
    assert.equal(readiness.status, 200, JSON.stringify(readiness.body));
    const consent = readiness.body.items.find((item: any) => item.key === "consent_tier_migration");
    check(consent.status === "green" && consent.value === "Column present" && consent.remediation === null, `${role}: actual pg QueryResult proves the existing consent column`);
  }
  await h.pool.query("ALTER TABLE contacts RENAME COLUMN consent_tier TO launch_fixture_consent_tier");
  try {
    const missing = await h.request("admin", "GET", "/api/activation/readiness");
    assert.equal(missing.status, 200);
    const item = missing.body.items.find((row: any) => row.key === "consent_tier_migration");
    check(item.status === "red" && item.value === "Column missing", "Actually missing schema is distinct from unavailable lookup and existing column");
  } finally { await h.pool.query("ALTER TABLE contacts RENAME COLUMN launch_fixture_consent_tier TO consent_tier"); }
  const acquisition = await h.request("admin", "GET", "/api/acquisition/offline-conversions/export?days=30");
  assert.equal(acquisition.status, 200, JSON.stringify(acquisition.body));
  check(acquisition.body.gclidCaptureWired === true && acquisition.body.observedExportRowsWithGclid === 0 && acquisition.body.gclidCaptureActive === false, "Actual export reports wired capture separately from absent observed click IDs");
  check(acquisition.body.clientTracking?.available === false || acquisition.body.clientTracking?.version === 1, "Export exposes artifact-derived tracking readiness or explicit unavailable state");
  check((await h.request("agent", "GET", "/api/activation/readiness")).status === 403, "Readiness remains restricted to administrator/manager");
  const afterBudget = (await h.pool.query("SELECT * FROM outscraper_budget_policy")).rows;
  assert.deepEqual(beforeBudget, afterBudget);
  check((await h.pool.query("SELECT state,epoch FROM outbound_pause_control")).rows.every(r => r.state === "paused" && Number(r.epoch) === 4), "HTTP fixture preserves pause/epoch and Outscraper budget");
  check(h.externalCalls() === 0 && getBlockedCertificationNetworkAttemptCount() === 0, "No provider calls, emails or paid requests during acceptance");
  check(Number((await h.pool.query("SELECT count(*) FROM outbound_messages")).rows[0].count) === 0, "No outbound messages queued or sent");
  console.log(`LAUNCH_READINESS_HTTP_PASS ${checks}`);
} finally { await h.close(); }
