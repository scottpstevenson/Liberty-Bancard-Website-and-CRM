/** Disposable DB/Redis, actual sessions/CSRF, real adapters and workers; provider fetch intercepted. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
process.env.PAYARC_API_KEY = "fixture-partner-key";
process.env.PAYARC_PARTNER_KEY_ENVIRONMENT = "sandbox";
process.env.PAYARC_RATE_LIMIT_BACKOFF_MS = "1";
const { stage3BHttpFixture } = await import("./fixtures/stage3-b-http");
const h = await stage3BHttpFixture(
  async (app) =>
    (await import("../server/routes/boarding")).registerBoardingRoutes(app),
  undefined,
  { backgroundProfile: "off" },
);
const { sql } = await import("drizzle-orm");
const { db } = await import("../server/db");
const { recordCertPolicy, CERT_PROGRAM } = await import(
  "./certification/stage5-boarding-fixture"
);
await recordCertPolicy(db, sql);
const { processProtectedData } = await import(
  "../server/services/merchant-protected-data"
);
const prep = await import("../server/services/payarc-preparation");
const lifecycle = await import("../server/services/payarc-lifecycle");
const worker = await import("../server/services/deal-boarding-outbox-worker");
const status = await import("../server/services/boarding-status-refresh");
let checks = 0;
const eq = (a: unknown, b: unknown, m: string) => {
  assert.deepEqual(a, b, m);
  checks++;
};
const q = async (s: string, p: unknown[] = []) =>
  (await h.pool.query(s, p)).rows;
const originalFetch = globalThis.fetch;
let creates = 0,
  signatures = 0,
  patches = 0,
  polls = 0,
  signatureFailure = false,
  validationFailure = false,
  validationRevisionRace = false,
  revokeDuringValidation = false,
  validations = 0;
let phase = "submitted_to_underwriting";
let holdCreate = false;
globalThis.fetch = (async (input: any, init: any) => {
  const url = String(input);
  if (!url.startsWith("https://testapi.payarc.net/v1/"))
    return originalFetch(input, init);
  const body = init?.body ? JSON.parse(init.body) : {};
  let data: any;
  if (url.endsWith("/add-lead")) {
    creates++;
    if (holdCreate) throw Error("lost");
    data = { MerchantCode: "MC-fixture" };
  } else if (url.endsWith("/submit-for-signature")) {
    if(body.validate === true){
      validations++;
      if(validationRevisionRace) await q("UPDATE merchant_applications SET updated_at=clock_timestamp() WHERE id IN(SELECT application_id FROM payarc_cases WHERE merchant_code=$1)",[body.MerchantCode]);
      if(revokeDuringValidation) await q("UPDATE processor_activation_snapshots SET status='held' WHERE processor_name='payarc'");
      if(validationFailure) return new Response(JSON.stringify({errors:{apply_app_id:["invalid"]}}),{status:422});
    } else {
      signatures++;
      if (signatureFailure) throw Error("lost");
    }
    data = { MerchantCode: body.MerchantCode };
  } else if (url.endsWith("/lead-status")) {
    polls++;
    data = {
      MerchantCode: body.MerchantCode,
      Status: 32,
      LeadStatus: phase,
      LeadModule: "underwriting",
    };
  } else if (init?.method === "PATCH") {
    patches++;
    assert.equal(body.Owners,undefined,"Correction uses documented PATCH schema, not the creation owner array");
    data = { data: { id: "MC-fixture" } };
  } else throw Error("Undocumented provider endpoint");
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "x-ratelimit-remaining": "100" },
  });
}) as any;
try {
  await q(
    "INSERT INTO outbound_pause_control(id,state,epoch) VALUES(1,'paused',55) ON CONFLICT(id) DO UPDATE SET state='paused',epoch=55",
  );
  await q(
    "INSERT INTO processor_activation_snapshots(processor_name,processor_program,status,sandbox_entitlement,production_entitlement,authorized_base_url,supported_operations) VALUES('payarc','traditional','owner_confirmed',true,false,'https://testapi.payarc.net/v1',$1::jsonb)",
    [
      JSON.stringify([
        "board_merchant",
        "get_merchant_status",
        "request_signature",
        "update_merchant",
      ]),
    ],
  );
  const d = (
    await q(
      "INSERT INTO deals(name,pipeline,stage,owner,boarding_status) VALUES('Payarc synthetic','onboarding','Underwriting',$1,'not_submitted') RETURNING id",
      [h.email("admin")],
    )
  )[0];
  const a = (
    await q(
      "INSERT INTO merchant_applications(deal_id,status,preferred_program,legal_business_name,dba,business_start_date,business_address,business_city,business_state,business_zip,business_phone,owner_first_name,owner_last_name,owner_email,owner_phone,owner_address,owner_city,owner_state,owner_zip,ownership_percent) VALUES($1,'submitted',$2,'Fixture Legal','Fixture DBA','2020-01-01','1 Fixture St','Miami','FL','33101','3055550100','Fixture','Owner','fixture@example.invalid','3055550100','1 Fixture St','Miami','FL','33101',100) RETURNING id",
      [d.id, CERT_PROGRAM],
    )
  )[0];
  const p = processProtectedData(a.id, {
    ein: "99-9999999",
    ssn: "512-45-6789",
    dob: "1980-01-01",
    routing: "021000021",
    account: "0001234567",
  });
  await q(
    "UPDATE merchant_applications SET ein=$2,owner_ssn=$3,owner_dob=$4,bank_routing_number=$5,bank_account_number=$6 WHERE id=$1",
    [
      a.id,
      p.ein!.ciphertext,
      p.ssn!.ciphertext,
      p.dob!.ciphertext,
      p.routing!.ciphertext,
      p.account!.ciphertext,
    ],
  );
  const path = `/api/deals/${d.id}/payarc-preparation`;
  eq(
    (await h.request("agent", "GET", path)).status,
    404,
    "Unassigned agent receives no case information",
  );
  eq(
    (await h.request("manager", "GET", path)).status,
    200,
    "Manager sees safe schema",
  );
  const extras = {
    RegisteredAddress: "1 Fixture St",
    RegisteredCity: "Miami",
    RegisteredState: "FL",
    RegisteredZipCode: "33101",
    StateOfIncorporation: "FL",
    DiscountRateProgram: "interchange",
    Industry: "general-retail-rest-low-risk",
    OwnershipType: "llc",
    CustomerSupportNumber: "3055550100",
    BusinessSummary: "Synthetic test",
    OwnerTitle: "Owner",
    Pricing: { PricingPctVS: 0.3, AuthorizationsVS: 0.1 },
  };
  const body = { applicationId: a.id, extras };
  eq(
    (await h.request("admin", "POST", path, body, false)).status,
    403,
    "Preparation requires CSRF",
  );
  eq(
    (
      await h.request("admin", "POST", path, {
        ...body,
        extras: { ...extras, TaxId: "forged" },
      })
    ).status,
    409,
    "Protected identity cannot be overridden",
  );
  eq(
    (await h.request("admin", "POST", path, body)).status,
    200,
    "Reviewed preparation saved",
  );
  const payload: any = await prep.readPayarcPreparation(a.id);
  eq(payload.Lead.TaxId, "999999999", "Tax ID comes from protected source");
  eq(payload.Owners[0].BirthDate,"01/01/1980","Protected ISO birth date maps to Payarc documented format");
  const stored = (
    await q(
      "SELECT payload_ciphertext FROM payarc_preparations WHERE application_id=$1",
      [a.id],
    )
  )[0];
  assert.ok(stored.payload_ciphertext.startsWith("mpd_v1:"));
  checks++;
  assert.ok(!stored.payload_ciphertext.includes("Fixture Legal"));
  checks++;
  const {decryptField}=await import('../server/services/merchant-protected-data');
  const preparedExtras=JSON.parse(decryptField(a.id,prep.PAYARC_PREP_FIELD,stored.payload_ciphertext));
  eq(preparedExtras.Lead,undefined,'Preparation stores supplemental values, never a duplicate protected application payload');

  await q(
    "UPDATE merchant_applications SET updated_at=clock_timestamp() WHERE id=$1",
    [a.id],
  );
  await assert.rejects(() => prep.readPayarcPreparation(a.id), /STALE/);
  checks++;
  eq(
    (await h.request("admin", "POST", path, body)).status,
    200,
    "Reprepare after source revision",
  );
  const submitted = await h.request(
    "admin",
    "POST",
    `/api/deals/${d.id}/submit-to-processor`,
    { processorName: "payarc" },
    true,
    { "Idempotency-Key": randomUUID() },
  );
  eq(submitted.status, 202, "Reviewed application enqueues");
  await worker.__test__.tick();
  eq(creates, 1, "Real outbox creates exactly one lead");
  eq(signatures, 0, "Signature is a separate durable step");
  let c = (await q("SELECT * FROM payarc_cases WHERE deal_id=$1", [d.id]))[0];
  eq(c.merchant_code, "MC-fixture", "MerchantCode committed durably");
  eq(c.signature_state, "pending", "Signature pending after lead acceptance");
  await worker.__test__.tick();
  eq(creates, 1, "Outbox replay does not recreate lead");
  eq(
    (await lifecycle.dispatchPayarcSignature(d.id)).state,
    "disabled",
    "Signature transport closed by default",
  );
  process.env.PAYARC_SIGNATURE_ENABLED = "true";
  await prep.savePayarcPreparation(a.id,{...extras,BusinessSummary:"Changed after creating lead"},h.email("admin"));
  eq((await lifecycle.dispatchPayarcSignature(d.id)).state,"failed","Changed application must be corrected at Payarc before signature");
  eq(validations,0,"Stale provider payload sends no validation or signature request");
  eq((await lifecycle.readPayarcLifecycle(d.id)).last_error,"SIGNATURE_PAYLOAD_CHANGED","Changed payload has a specific CRM hold");
  await prep.savePayarcPreparation(a.id,extras,h.email("admin"));
  await q("UPDATE payarc_cases SET signature_state='pending' WHERE deal_id=$1",[d.id]);
  validationFailure = true;
  eq((await lifecycle.dispatchPayarcSignature(d.id)).state,"failed","Provider validation refusal holds signature step");
  eq(signatures,0,"Failed validation sends no signature email");
  eq((await lifecycle.readPayarcLifecycle(d.id)).last_error,"SIGNATURE_VALIDATION_HTTP_422","Validation failure is visible without provider body");
  eq(creates,1,"Validation failure retains existing lead");
  validationFailure = false;
  await q("UPDATE payarc_cases SET signature_state='pending' WHERE deal_id=$1",[d.id]);
  validationRevisionRace = true;
  eq((await lifecycle.dispatchPayarcSignature(d.id)).state,"failed","Application revision changing during validation blocks delivery");
  eq(signatures,0,"No email when review fence changes after validation");
  eq((await lifecycle.readPayarcLifecycle(d.id)).last_error,"SIGNATURE_REVIEW_CHANGED","Review change is visible");
  validationRevisionRace = false;
  await prep.savePayarcPreparation(a.id,extras,h.email("admin"));
  // Fixture-only reset represents a reviewed correction; correction behavior is exercised below.
  await q("UPDATE payarc_cases SET signature_state='pending' WHERE deal_id=$1",[d.id]);
  await Promise.all([
    lifecycle.dispatchPayarcSignature(d.id),
    lifecycle.dispatchPayarcSignature(d.id),
  ]);
  eq(signatures, 1, "Concurrent signature dispatch sends once");
  eq(validations,3,"One provider validation per claimed attempt, never per concurrent caller");
  c = (await q("SELECT * FROM payarc_cases WHERE deal_id=$1", [d.id]))[0];
  eq(c.signature_state, "sent", "Signature receipt persisted");
  eq(
    (await status.performBoardingStatusRefresh(d.id)).outcome,
    "success",
    "Real documented status adapter applies",
  );
  eq(polls, 1, "One authenticated status call");
  eq(
    (await lifecycle.readPayarcLifecycle(d.id)).phase,
    "under_review",
    "Lifecycle is visible",
  );
  phase = "pending_docs";
  await status.performBoardingStatusRefresh(d.id);
  eq(
    (await lifecycle.readPayarcLifecycle(d.id)).phase,
    "documents_needed",
    "Documents needed retains case",
  );
  eq(
    (await h.request("admin", "POST", path, body)).status,
    200,
    "Corrected preparation retains original MerchantCode",
  );
  const key = randomUUID();
  eq(
    (
      await h.request("admin", "POST", `/api/deals/${d.id}/payarc-correction`, {
        commandKey: key,
      })
    ).status,
    200,
    "Explicit correction queued",
  );
  eq(
    (
      await h.request("admin", "POST", `/api/deals/${d.id}/payarc-correction`, {
        commandKey: key,
      })
    ).body.replayed,
    true,
    "Correction command replay returns receipt",
  );
  await lifecycle.dispatchPayarcCorrections();
  eq(patches, 1, "Correction patches existing lead");
  eq(creates, 1, "Correction never recreates lead");
  signatureFailure = true;
  await lifecycle.dispatchPayarcSignature(d.id);
  eq(
    (await lifecycle.readPayarcLifecycle(d.id)).signature_state,
    "uncertain",
    "Lost signature response held",
  );
  await lifecycle.dispatchPayarcSignature(d.id);
  eq(signatures, 2, "Uncertain signature is never automatically retried");
  eq((await q("SELECT count(*)::int n FROM tasks WHERE source='payarc-lifecycle' AND automation_key=$1",[`payarc-signature:${d.id}:delivery`]))[0].n,1,'Uncertain delivery has its own deduplicated review task');
  await q("UPDATE payarc_cases SET phase='documents_needed',signature_state='sent' WHERE deal_id=$1",[d.id]);
  eq((await h.request('admin','POST',path,{...body,extras:{...extras,OwnerTitle:'President'}})).status,200,'Changed owner title is prepared locally');
  eq((await h.request('admin','POST',`/api/deals/${d.id}/payarc-correction`,{commandKey:randomUUID()})).status,200,'Owner correction enters reviewed command');
  await lifecycle.dispatchPayarcCorrections();eq(patches,1,'Unsupported owner correction sends no PATCH');
  eq((await lifecycle.readPayarcLifecycle(d.id)).last_error,'PAYARC_OWNER_CORRECTION_CONTRACT_REQUIRED','Owner correction needs provider contract clarification');
  await prep.savePayarcPreparation(a.id,extras,h.email("admin"));
  await q("UPDATE payarc_cases SET signature_state='pending',signature_attempts=0 WHERE deal_id=$1",[d.id]);
  signatureFailure = false;
  revokeDuringValidation = true;
  eq((await lifecycle.dispatchPayarcSignature(d.id)).state,"failed","Operation revocation during validation blocks delivery");
  eq(signatures,2,"Revoked authority never sends a signature request");
  eq((await lifecycle.readPayarcLifecycle(d.id)).last_error,"SIGNATURE_AUTHORITY_CHANGED","Authority change is recorded");
  const before = (
    await q("SELECT count(*)::int n FROM payarc_webhook_events")
  )[0].n;
  const response = await h.request(
    "anonymous",
    "POST",
    "/api/webhooks/payarc",
    { MerchantCode: "MC-fixture", Status: 32 },
  );
  eq(response.status, 503, "Unknown webhook authentication is closed");
  eq(
    (await q("SELECT count(*)::int n FROM payarc_webhook_events"))[0].n,
    before,
    "Unauthenticated event not persisted",
  );
  eq(
    (await q("SELECT state FROM outbound_pause_control WHERE id=1"))[0].state,
    "paused",
    "Outbound remains paused",
  );
  eq(
    (await q("SELECT count(*)::int n FROM outscraper_budget_policy"))[0].n,
    0,
    "Budget policy untouched",
  );
  console.log(`Payarc Traditional workflow: ${checks} checks passed`);
} finally {
  globalThis.fetch = originalFetch;
  await h.close();
}
