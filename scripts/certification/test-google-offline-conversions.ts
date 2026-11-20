import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { stage3BHttpFixture } from "../fixtures/stage3-b-http";
import {
  applyCertificationProviderDenyBoundary,
  getBlockedCertificationNetworkAttemptCount,
} from "../certification-provider-deny";
applyCertificationProviderDenyBoundary({ fatal: true });
process.env.GOOGLE_OFFLINE_QUALIFIED_ACTION_ID = "1111111111";
process.env.GOOGLE_OFFLINE_WON_ACTION_ID = "2222222222";
const h = await stage3BHttpFixture(
  async (app) => {
    (await import("../../server/routes/public")).registerPublicRoutes(app);
    (await import("../../server/routes/acquisition")).registerAcquisitionRoutes(
      app,
    );
  },
  undefined,
  { backgroundProfile: "off" },
);
const service = await import(
  "../../server/services/google-offline-conversions"
);
let checks = 0;
const check = (v: unknown, label: string) => {
  assert(v, label);
  checks++;
  console.log("PASS " + label);
};
const key = randomBytes(32).toString("hex");
const body = {
  mode: "general_inquiry",
  businessName: "Synthetic offline fixture",
  name: "Offline Fixture",
  email: `offline-${randomUUID()}@example.test`,
  intent: "processing",
  gclid: "frozen-original-click",
  wbraid: "frozen-ios-click",
  gbraid: "frozen-app-click",
  adsMeasurementConsent: true,
  adsMeasurementVersion: "ads-measurement-v1",
  adsMeasurementKey: key,
};
const requestKey = randomUUID();
let uploads: any[] = [],
  polls = 0;
const transport: typeof service.googleOfflineTransport = {
  ingest: async (b) => {
    uploads.push(b);
    return b.validateOnly
      ? {}
      : { requestId: "fixture-request-" + uploads.length };
  },
  status: async () => {
    polls++;
    return {
      requestStatusPerDestination: [
        {
          destination: {
            operatingAccount: { accountId: "3455118578" },
            productDestinationId: "1111111111",
          },
          requestStatus: "SUCCESS",
        },
      ],
    };
  },
};
const due = () =>
  h.pool.query(
    "UPDATE ads_offline_conversions SET next_attempt_at=now()-interval '1 second' WHERE state IN ('pending','submitted')",
  );
try {
  await h.pool.query(
    "INSERT INTO outbound_pause_control(id,state,epoch,reason) VALUES(1,'paused',9,'private offline conversion acceptance') ON CONFLICT(id) DO UPDATE SET state='paused',epoch=9",
  );
  const budget = (await h.pool.query("SELECT * FROM outscraper_budget_policy"))
    .rows;
  const send = () =>
    fetch(h.base + "/api/public/get-started", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": requestKey,
      },
      body: JSON.stringify(body),
    });
  const result = await send(),
    accepted = await result.json();
  check(
    result.status === 201,
    "Real public intake accepts a consented measurement occurrence: " +
      JSON.stringify(accepted),
  );
  const requestId = accepted.requestReceipt;
  const snap = (
    await h.pool.query(
      "SELECT * FROM ads_attribution_snapshots WHERE request_id=$1",
      [requestId],
    )
  ).rows[0];
  check(
    snap?.click_ids_ciphertext.startsWith("enc_v1:") &&
      !JSON.stringify(snap).includes("frozen-original-click"),
    "Accepted occurrence freezes encrypted click ID without a plaintext copy",
  );
  const replay = await send();
  check(
    replay.ok,
    "Accepted intake replays through its real idempotency owner",
  );
  check(
    (
      await h.pool.query(
        "SELECT count(*)::int n FROM ads_attribution_snapshots WHERE request_id=$1",
        [requestId],
      )
    ).rows[0].n === 1,
    "A replay cannot create a second attribution snapshot",
  );
  const deal = (
    await h.pool.query("SELECT * FROM deals WHERE inbound_request_id=$1", [
      requestId,
    ])
  ).rows[0];
  assert(deal);
  await h.pool.query("UPDATE deals SET record_class='production' WHERE id=$1", [
    deal.id,
  ]);
  await h.pool.query(
    "UPDATE contacts SET record_class='production',gclid='changed-latest-contact-click' WHERE id=$1",
    [deal.contact_id],
  );
  const command = {
    dealId: deal.id,
    expectedStage: deal.stage,
    reason:
      "Reviewed real processing need and sales opportunity in synthetic fixture",
    confirm: "RECORD REVIEWED QUALIFIED LEAD",
  };
  check(
    (
      await h.request(
        "agent",
        "POST",
        "/api/acquisition/offline-conversions/qualify",
        command,
      )
    ).status === 403,
    "Agent cannot attest an administrative qualification",
  );
  check(
    (
      await h.request(
        "admin",
        "POST",
        "/api/acquisition/offline-conversions/qualify",
        { ...command, expectedStage: "Wrong stage" },
      )
    ).status === 409,
    "A stale deal stage cannot qualify a different current state",
  );
  const qualifications = await Promise.all([
    h.request(
      "admin",
      "POST",
      "/api/acquisition/offline-conversions/qualify",
      command,
    ),
    h.request(
      "manager",
      "POST",
      "/api/acquisition/offline-conversions/qualify",
      command,
    ),
  ]);
  check(
    qualifications.every((r) => r.status === 200) &&
      qualifications[0].body.id === qualifications[1].body.id,
    "Concurrent real-session qualification commands retain one durable outcome",
  );
  check(
    (
      await h.pool.query(
        "SELECT count(*)::int n FROM ads_offline_conversions WHERE kind='qualified_lead'",
      )
    ).rows[0].n === 1,
    "One deal has one qualification even after duplicate operator actions",
  );
  delete process.env.GOOGLE_OFFLINE_UPLOAD_ENABLED;
  check(
    (await service.processOfflineConversions({ transport })).held ===
      "UPLOADS_DISABLED" && uploads.length === 0,
    "Default upload switch sends nothing while retaining the outcome",
  );
  await service.processOfflineConversions({ transport, validateOnly: true });
  let row = (
    await h.pool.query(
      "SELECT * FROM ads_offline_conversions WHERE kind='qualified_lead'",
    )
  ).rows[0];
  check(
    uploads.length === 1 &&
      uploads[0].validateOnly === true &&
      row.validated_at &&
      row.state === "pending" &&
      row.attempt_count === 0 &&
      !row.provider_request_id,
    "Validate-only never marks upload, consumes a send attempt or claims a provider receipt",
  );
  const payload = uploads[0];
  check(
    payload.events[0].adIdentifiers.gclid === "frozen-original-click" &&
      !JSON.stringify(payload).includes("changed-latest-contact-click"),
    "Upload is pinned to the deal occurrence, never the mutable latest contact click",
  );
  check(
    !JSON.stringify(payload).includes(body.email) &&
      !("conversionValue" in payload.events[0]) &&
      !("currency" in payload.events[0]) &&
      !("userData" in payload.events[0]),
    "Provider payload excludes contact details and invented monetary values",
  );
  check(
    payload.events[0].adIdentifiers.wbraid === "frozen-ios-click" &&
      payload.events[0].adIdentifiers.gbraid === "frozen-app-click",
    "Consented mobile Google click identifiers retain the same immutable occurrence lineage",
  );
  check(
    payload.events[0].consent.adUserData === "CONSENT_GRANTED" &&
      payload.events[0].consent.adPersonalization === "CONSENT_DENIED",
    "Only explicit versioned measurement consent grants click sharing; personalization remains denied",
  );
  process.env.GOOGLE_OFFLINE_UPLOAD_ENABLED = "true";
  await due();
  await Promise.all([
    service.processOfflineConversions({ transport }),
    service.processOfflineConversions({ transport }),
  ]);
  row = (
    await h.pool.query("SELECT * FROM ads_offline_conversions WHERE id=$1", [
      row.id,
    ])
  ).rows[0];
  check(
    uploads.filter((v) => !v.validateOnly).length === 1 &&
      row.state === "submitted" &&
      row.provider_request_id,
    "Concurrent workers dispatch one provider request and persist accepted-for-processing separately",
  );
  check(
    payload.events[0].transactionId === uploads[1].events[0].transactionId,
    "Validation and dispatch retain one stable event deduplication ID",
  );
  await due();
  await service.processOfflineConversions({ transport });
  row = (
    await h.pool.query("SELECT * FROM ads_offline_conversions WHERE id=$1", [
      row.id,
    ])
  ).rows[0];
  check(
    row.state === "processed" && polls === 1 && uploads.length === 2,
    "Retained provider request is polled to processing success without a resend",
  );
  const status = await h.request(
    "manager",
    "GET",
    "/api/acquisition/offline-conversions/status",
  );
  check(
    status.headers.get("cache-control") === "private, no-store",
    "Staff outcome readback cannot enter a shared HTTP cache",
  );
  check(
    status.status === 200 &&
      status.body.implemented === true &&
      !JSON.stringify(status.body).includes("frozen-original-click") &&
      !JSON.stringify(status.body).includes(key),
    "Operator readback exposes durable status without click IDs or revocation capabilities",
  );
  check(
    (
      await h.request(
        "manager",
        "POST",
        "/api/acquisition/offline-conversions/process",
        { mode: "send", confirm: "UPLOAD CONSENTED CRM OUTCOMES" },
      )
    ).status === 403,
    "Only administrators can invoke external processing",
  );
  const denied = await service.captureOfflineAttribution(
    requestId,
    deal.contact_id,
    { ...body, adsMeasurementConsent: false },
  );
  check(
    !denied.captured,
    "An unconsented request never acquires measurement authority",
  );
  // Canonical Closed Won evidence is generated by the real retained source trigger, not browser analytics.
  await h.pool.query("UPDATE deals SET stage='Closed Won' WHERE id=$1", [
    deal.id,
  ]);
  check(
    (await service.reconcileOfflineClosedWon()) === 1,
    "Actual canonical Closed Won evidence recovers into the durable outbox",
  );
  check(
    (await service.reconcileOfflineClosedWon()) === 0,
    "Canonical reconciliation is idempotent",
  );
  await h.pool.query("UPDATE deals SET stage='New Lead' WHERE id=$1", [
    deal.id,
  ]);
  await h.pool.query("UPDATE deals SET stage='Closed Won' WHERE id=$1", [
    deal.id,
  ]);
  check(
    (await service.reconcileOfflineClosedWon()) === 0,
    "Reopening and closing a deal cannot mint another converted lead for the same action",
  );
  const revoke = await fetch(h.base + "/api/public/ads-measurement/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
  });
  check(
    revoke.status === 204,
    "Original anonymous consent capability can revoke its own future uploads",
  );
  const won = (
    await h.pool.query(
      "SELECT * FROM ads_offline_conversions WHERE kind='closed_won'",
    )
  ).rows[0];
  check(
    won.state === "revoked" &&
      (
        await h.pool.query(
          "SELECT revoked_at FROM ads_attribution_snapshots WHERE request_id=$1",
          [requestId],
        )
      ).rows[0].revoked_at,
    "Revocation persists on attribution and cancels pending outcomes",
  );
  const before = uploads.length;
  await due();
  await service.processOfflineConversions({ transport });
  check(
    uploads.length === before,
    "A revoked pending conversion never reaches transport",
  );
  check(
    (
      await fetch(h.base + "/api/public/ads-measurement/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "bad" }),
      })
    ).status === 400,
    "Malformed anonymous revocation is rejected",
  );
  let quotaObserved = false;
  await service
    .createGoogleOfflineTransport(
      "synthetic-token",
      async (_url, init) => {
        quotaObserved =
          (init?.headers as any)["x-goog-user-project"] ===
          "liberty-fixture-project";
        return new Response("{}", { status: 200 });
      },
      "liberty-fixture-project",
    )
    .status("synthetic-request");
  check(
    quotaObserved,
    "User ADC quota-project context reaches the fixed Google endpoint without exposing credentials",
  );
  const sample = { customer_id: "3455118578", action_id: "1111111111" };
  const dm = (requestStatus: string, extra = {}) => ({
    requestStatusPerDestination: [
      {
        destination: {
          operatingAccount: { accountId: sample.customer_id },
          productDestinationId: sample.action_id,
        },
        requestStatus,
        ...extra,
      },
    ],
  });
  check(
    service.classifyOfflineStatus(dm("PROCESSING"), sample).state ===
      "submitted",
    "Asynchronous processing is never reported as delivered",
  );
  check(
    service.classifyOfflineStatus(dm("PARTIAL_SUCCESS"), sample).state ===
      "failed",
    "Partial success is held for review rather than claimed as complete",
  );
  check(
    service.classifyOfflineStatus(
      dm("FAILED", {
        errorInfo: {
          errorCounts: [
            {
              reason: "PROCESSING_ERROR_REASON_INVALID_GCLID",
              recordCount: "1",
            },
          ],
        },
      }),
      sample,
    ).state === "failed",
    "Provider rejection remains failed",
  );
  check(
    service.classifyOfflineStatus(
      dm("SUCCESS", {
        warningInfo: {
          warningCounts: [{ reason: "UNMATCHED", recordCount: "1" }],
        },
      }),
      sample,
    ).state === "processed_with_warnings",
    "Processing warnings remain visible and distinct from clean success",
  );
  check(
    service.classifyOfflineStatus({ requestStatusPerDestination: [] }, sample)
      .state === "submitted",
    "Missing destination status never counts as success",
  );
  // Recovery: interrupted dispatch is uncertain; interrupted polling resumes polling only.
  await h.pool.query(
    "UPDATE ads_offline_conversions SET state='attempting',claim_token=gen_random_uuid(),lease_expires_at=now()-interval '1 second' WHERE id=$1",
    [won.id],
  );
  await service.processOfflineConversions({ transport });
  check(
    (
      await h.pool.query(
        "SELECT state FROM ads_offline_conversions WHERE id=$1",
        [won.id],
      )
    ).rows[0].state === "uncertain",
    "Expired dispatch lease becomes uncertain and is not blindly resent",
  );
  check(
    uploads.length === before,
    "Recovery never invents another provider upload",
  );
  // Additional forward occurrences use the same schema and capture owner, with private fixture identities.
  const next = async (
    label: string,
    capabilityOverride?: string,
    skipQualify = false,
  ) => {
    const cid = (
      await h.pool.query(
        "INSERT INTO contacts(first_name,last_name,email,phone,record_class) VALUES('Offline',$1,$2,'','production') RETURNING id",
        [label, `${label}-${randomUUID()}@example.test`],
      )
    ).rows[0].id;
    const occurrence = randomUUID();
    const rid = (
      await h.pool.query(
        `INSERT INTO inbound_requests(idempotency_key,occurrence_key,request_fingerprint,source_category,source_type,source_class,caller_scope,actor_type,contact_id,manifest_version,manifest_hash,lifecycle_state)
      VALUES($1,$1,$2,'website_form','general_inquiry','sales_request','public','visitor',$3,'v1',$2,'accepted') RETURNING id`,
        [occurrence, "a".repeat(64), cid],
      )
    ).rows[0].id;
    const did = (
      await h.pool.query(
        "INSERT INTO deals(contact_id,pipeline,stage,record_class,inbound_request_id) VALUES($1,'sales','New Lead','production',$2) RETURNING id",
        [cid, rid],
      )
    ).rows[0].id;
    const capability = capabilityOverride ?? randomBytes(32).toString("hex");
    const capture = await service.captureOfflineAttribution(rid, cid, {
      ...body,
      adsMeasurementKey: capability,
    });
    if (skipQualify) return { cid, rid, did, capability, id: "", capture };
    const outcome = await service.qualifyOfflineLead({
      dealId: did,
      expectedStage: "New Lead",
      actorId: h.userId("admin"),
      reason: "Explicit synthetic sales qualification for recovery test",
    });
    return { cid, rid, did, capability, id: outcome.id, capture };
  };
  const timeout = await next("timeout");
  const timed = service.createGoogleOfflineTransport(
    "synthetic-token",
    async (url, init) => {
      check(
        String(url) === "https://datamanager.googleapis.com/v1/events:ingest" &&
          init?.method === "POST" &&
          init.redirect === "error",
        "Production transport uses the fixed Data Manager v1 endpoint without redirects",
      );
      check(
        (init?.headers as any).Authorization === "Bearer synthetic-token" &&
          JSON.parse(String(init?.body)).events[0].transactionId ===
            `lb-${timeout.id}`,
        "Production HTTP adapter serializes the stable payload and bearer header",
      );
      throw new Error("simulated socket loss after dispatch");
    },
  );
  await service.processOfflineConversions({ transport: timed });
  check(
    (
      await h.pool.query(
        "SELECT state FROM ads_offline_conversions WHERE id=$1",
        [timeout.id],
      )
    ).rows[0].state === "uncertain",
    "Actual HTTP-adapter socket failure persists uncertain without leaking provider payload",
  );
  await service.processOfflineConversions({ transport });
  check(
    (
      await h.pool.query(
        "SELECT attempt_count FROM ads_offline_conversions WHERE id=$1",
        [timeout.id],
      )
    ).rows[0].attempt_count === 1,
    "Uncertain network dispatch is not retried by later ticks",
  );
  const throttled = await next("throttled");
  await h.pool.query(
    "UPDATE ads_offline_conversions SET attempt_count=4 WHERE id=$1",
    [throttled.id],
  );
  await service.processOfflineConversions({
    transport: service.createGoogleOfflineTransport(
      "synthetic-token",
      async () => new Response("{}", { status: 429 }),
    ),
  });
  check(
    (
      await h.pool.query(
        "SELECT state,attempt_count FROM ads_offline_conversions WHERE id=$1",
        [throttled.id],
      )
    ).rows[0].state === "failed",
    "Retry exhaustion ends in failed, not a forever-pending row",
  );
  const serverError = await next("servererror");
  await service.processOfflineConversions({
    transport: service.createGoogleOfflineTransport(
      "synthetic-token",
      async () => new Response("{}", { status: 503 }),
    ),
  });
  check(
    (
      await h.pool.query(
        "SELECT state FROM ads_offline_conversions WHERE id=$1",
        [serverError.id],
      )
    ).rows[0].state === "uncertain",
    "A provider 5xx is held as uncertain rather than assumed safe to resend",
  );
  const poll = await next("poll");
  await service.processOfflineConversions({ transport });
  await due();
  const countBeforePoll = uploads.length;
  await service.processOfflineConversions({
    transport: {
      ...transport,
      status: async () => {
        throw new Error("poll offline");
      },
    },
  });
  check(
    (
      await h.pool.query(
        "SELECT state,provider_request_id FROM ads_offline_conversions WHERE id=$1",
        [poll.id],
      )
    ).rows[0].state === "submitted" && uploads.length === countBeforePoll,
    "A failed status poll retains the original receipt and never re-ingests the event",
  );
  await h.pool.query(
    "UPDATE ads_offline_conversions SET lease_expires_at=now()-interval '1 second',claim_token=gen_random_uuid(),next_attempt_at=now() WHERE id=$1",
    [poll.id],
  );
  await service.processOfflineConversions({ transport });
  check(
    (
      await h.pool.query(
        "SELECT state FROM ads_offline_conversions WHERE id=$1",
        [poll.id],
      )
    ).rows[0].state === "processed",
    "Interrupted polling recovers through the retained request ID",
  );
  const revokedEarly = randomBytes(32).toString("hex");
  await service.revokeOfflineAttribution(revokedEarly);
  const noRevival = await next("tombstone", revokedEarly, true);
  check(
    !noRevival.capture.captured &&
      !(
        await h.pool.query(
          "SELECT 1 FROM ads_attribution_snapshots WHERE request_id=$1",
          [noRevival.rid],
        )
      ).rowCount,
    "A retained revocation tombstone prevents delayed capture from regranting old consent",
  );
  const negative = await service.captureOfflineAttribution(poll.rid, poll.cid, {
    ...body,
    gclid: "replacement-click",
    adsMeasurementKey: poll.capability,
  });
  check(
    !negative.captured,
    "A later request cannot overwrite an existing occurrence click snapshot",
  );
  const diag = service.classifyOfflineStatus(
    dm("SUCCESS", {
      errorInfo: {
        errorCounts: [
          { reason: "PROCESSING_ERROR_REASON_INVALID_EVENT", recordCount: "1" },
        ],
      },
    }),
    sample,
  );
  check(
    diag.state === "failed",
    "Contradictory provider success with explicit errors fails closed",
  );
  assert.deepEqual(
    (await h.pool.query("SELECT * FROM outscraper_budget_policy")).rows,
    budget,
  );
  check(
    (
      await h.pool.query("SELECT state,epoch FROM outbound_pause_control")
    ).rows.every((r) => r.state === "paused" && Number(r.epoch) === 9),
    "Pause epoch and $50 policy remain unchanged",
  );
  check(
    Number(
      (await h.pool.query("SELECT count(*) n FROM outbound_messages")).rows[0]
        .n,
    ) === 0 &&
      h.externalCalls() === 0 &&
      getBlockedCertificationNetworkAttemptCount() === 0,
    "No real provider calls, paid searches or outbound messages during private acceptance",
  );
  console.log(`GOOGLE_OFFLINE_CONVERSIONS_PASS ${checks}`);
} finally {
  delete process.env.GOOGLE_OFFLINE_UPLOAD_ENABLED;
  await h.close();
}
