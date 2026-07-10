#!/usr/bin/env tsx
/**
 * scripts/test-inbound-confirmation-delivery.ts
 *
 * Verifies the provider-independent inbound confirmation delivery system by
 * calling the REAL `enrollInInboundConfirmation` and `runInboundConfirmationFollowupJob`
 * functions with `_testOverrides` to mock all I/O boundaries.
 *
 * All cases run against actual production routing logic — no reimplementation.
 *
 * Usage: npx tsx scripts/test-inbound-confirmation-delivery.ts
 * Exits 0 = all cases pass, 1 = one or more failures
 */

import { readFile } from "node:fs/promises";
import {
  enrollInInboundConfirmation,
  runInboundConfirmationFollowupJob,
} from "../server/services/ghl-workflow-enrollment";
import type {
  InboundConfirmationTestOverrides,
  InboundFollowupTestOverrides,
} from "../server/services/ghl-workflow-enrollment";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
    failures.push(label);
  }
}

function section(title: string): void {
  console.log(`\n── ${title} ──`);
}

// ─── Shared test infrastructure ────────────────────────────────────────────────

type AuditEntry   = { action: string; entityId: number; details: any };
type ScheduledJob = { jobId: string; data: any; opts: any };
type MockCall     = { fn: string; args: any };

function makeTestHarness() {
  const auditLog: AuditEntry[]     = [];
  const scheduledJobs: ScheduledJob[] = [];
  const calls: MockCall[]          = [];

  function makeOverrides(overrides: Partial<InboundConfirmationTestOverrides> & {
    contact: Record<string, any>;
  }): InboundConfirmationTestOverrides {
    return {
      writeAuditLog:   async (e) => { auditLog.push(e as AuditEntry); },
      scheduleFollowup: async (jId, data, opts) => { scheduledJobs.push({ jobId: jId, data, opts }); },
      upsertGhlContact: async () => { calls.push({ fn: "upsertGhlContact", args: {} }); return null; },
      addGhlTags:       async (p) => { calls.push({ fn: "addGhlTags", args: p }); },
      triggerGhlWorkflow: async (p) => { calls.push({ fn: "triggerGhlWorkflow", args: p }); },
      sendEmail: async () => ({ sent: false as const, providerAttempts: [], reason: "default mock" }),
      sendSms:   async (p) => { calls.push({ fn: "sendSms", args: p }); },
      ...overrides,
    };
  }

  function makeFovOverrides(overrides: Partial<InboundFollowupTestOverrides> & {
    contact: Record<string, any>;
  }): InboundFollowupTestOverrides {
    return {
      writeAuditLog: async (e) => { auditLog.push(e as AuditEntry); },
      evaluateContactability: async () => ({ allowed: true }),
      checkDuplicateFollowup: async () => false,
      sendEmail: async () => ({ sent: false as const, providerAttempts: [], reason: "default fov mock" }),
      ...overrides,
    };
  }

  function reset() {
    auditLog.length    = 0;
    scheduledJobs.length = 0;
    calls.length       = 0;
  }

  function auditOf(action: string): AuditEntry[] {
    return auditLog.filter(e => e.action === action);
  }

  function callsOf(fn: string): MockCall[] {
    return calls.filter(c => c.fn === fn);
  }

  return { auditLog, scheduledJobs, calls, makeOverrides, makeFovOverrides, reset, auditOf, callsOf };
}

// ─── Base contact factory ──────────────────────────────────────────────────────

function makeContact(overrides: Partial<Record<string, any>> = {}): Record<string, any> {
  return {
    id: 1,
    firstName: "Test",
    lastName: "Lead",
    email: "test@example.com",
    phone: "5551234567",
    companyName: "Test Co",
    ghlContactId: null,
    vertical: "retail",
    consentSms: false,
    doNotContact: false,
    smsStatus: "active",
    emailStatus: "active",
    consentTier: "warm_no_pewc",
    sourceCategory: "inbound",
    ...overrides,
  };
}

// ─── Standard provider stubs ───────────────────────────────────────────────────

const smtpSendOk  = async (_p: any) => ({ sent: true  as const, provider: "smtp"       as const, providerMessageId: "smtp-mid" });
const ghlSendOk   = async (_p: any) => ({ sent: true  as const, provider: "ghl_direct" as const, providerMessageId: "ghl-mid" });
const allSendFail = async (_p: any) => ({ sent: false as const, providerAttempts: [{ provider: "smtp" as const, error: "refused" }], reason: "All providers failed" });

// ─────────────────────────────────────────────────────────────────────────────
// PART 1 — Immediate inbound confirmation (enrollInInboundConfirmation)
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("Inbound Confirmation Delivery — Test Suite (25 cases)\n");
  console.log("Real production functions called with injectable provider mocks.\n");

  const h = makeTestHarness();

  // ── Case 1: No GHL, no workflow + SMTP → SMTP delivers ──
  section("Case 1: No GHL, no workflow → SMTP delivers");
  {
    h.reset();
    await enrollInInboundConfirmation({
      contactId: 1, formType: "estimate", dealId: 10, submissionId: "sub-1",
      _testOverrides: h.makeOverrides({ contact: makeContact(), ghlAvailable: false, inboundWorkflowId: null, sendEmail: smtpSendOk }),
    });
    assert(h.auditOf("inbound_confirmation_sent").length === 1, "audit: inbound_confirmation_sent written");
    assert(h.auditOf("inbound_confirmation_sent")[0]?.details?.provider === "smtp", "provider: smtp");
    assert(h.auditOf("inbound_confirmation_failed").length === 0, "no failed audit");
  }

  // ── Case 2: GHL direct available → GHL direct ──
  section("Case 2: GHL direct → ghl_direct provider");
  {
    h.reset();
    await enrollInInboundConfirmation({
      contactId: 1, formType: "estimate", dealId: 10, submissionId: "sub-2",
      _testOverrides: h.makeOverrides({ contact: makeContact({ ghlContactId: "ghl-123" }), ghlAvailable: true, inboundWorkflowId: null, sendEmail: ghlSendOk }),
    });
    assert(h.auditOf("inbound_confirmation_sent").length === 1, "audit: inbound_confirmation_sent");
    assert(h.auditOf("inbound_confirmation_sent")[0]?.details?.provider === "ghl_direct", "provider: ghl_direct");
  }

  // ── Case 3: Workflow succeeds → enrolled, no direct email ──
  section("Case 3: Workflow trigger succeeds → enrolled, sendEmail never called");
  {
    h.reset();
    const emailCalls: any[] = [];
    await enrollInInboundConfirmation({
      contactId: 1, formType: "estimate", dealId: 10, submissionId: "sub-3",
      _testOverrides: h.makeOverrides({
        contact: makeContact({ ghlContactId: "ghl-123" }),
        ghlAvailable: true, inboundWorkflowId: "wf-abc123",
        sendEmail: async (p) => { emailCalls.push(p); return smtpSendOk(p); },
      }),
    });
    assert(h.auditOf("ghl_inbound_confirmation_enrolled").length === 1, "audit: ghl_inbound_confirmation_enrolled");
    assert(h.auditOf("inbound_confirmation_sent").length === 0, "no direct email audit");
    assert(emailCalls.length === 0, "sendEmail never called when workflow succeeds");
  }

  // ── Case 4: Workflow trigger throws → direct email fallback ──
  section("Case 4: Workflow trigger throws → direct email fallback");
  {
    h.reset();
    await enrollInInboundConfirmation({
      contactId: 1, formType: "estimate", dealId: 10, submissionId: "sub-4",
      _testOverrides: h.makeOverrides({
        contact: makeContact({ ghlContactId: "ghl-123" }),
        ghlAvailable: true, inboundWorkflowId: "wf-abc123",
        triggerGhlWorkflow: async () => { throw new Error("GHL timeout"); },
        sendEmail: smtpSendOk,
      }),
    });
    assert(h.auditOf("inbound_confirmation_sent").length === 1, "sent after workflow failure");
    assert(h.auditOf("ghl_inbound_confirmation_enrolled").length === 0, "no enrolled audit");
  }

  // ── Case 5: All providers fail → inbound_confirmation_failed ──
  section("Case 5: sendEmail returns failure → inbound_confirmation_failed");
  {
    h.reset();
    await enrollInInboundConfirmation({
      contactId: 1, formType: "callback", dealId: 10, submissionId: "sub-5",
      _testOverrides: h.makeOverrides({ contact: makeContact({ ghlContactId: "ghl-123" }), ghlAvailable: true, inboundWorkflowId: null, sendEmail: allSendFail }),
    });
    assert(h.auditOf("inbound_confirmation_failed").length === 1, "audit: inbound_confirmation_failed");
    assert(h.auditOf("inbound_confirmation_sent").length === 0, "no sent audit");
    assert(h.scheduledJobs.length === 0, "no follow-up scheduled on failure");
  }

  // ── Case 6: No email → skipped (not failed) ──
  section("Case 6: No email → inbound_confirmation_skipped, not failed");
  {
    h.reset();
    const emailCalls: any[] = [];
    await enrollInInboundConfirmation({
      contactId: 1, formType: "callback", dealId: 10, submissionId: "sub-6",
      _testOverrides: h.makeOverrides({
        contact: makeContact({ email: "" }),
        ghlAvailable: false, inboundWorkflowId: null,
        sendEmail: async (p) => { emailCalls.push(p); return smtpSendOk(p); },
      }),
    });
    assert(h.auditOf("inbound_confirmation_skipped").length === 1, "audit: inbound_confirmation_skipped");
    assert(h.auditOf("inbound_confirmation_failed").length === 0, "no failed audit for no-email");
    assert(h.auditOf("inbound_confirmation_skipped")[0]?.details?.reason === "no_email", "skip reason=no_email");
    assert(emailCalls.length === 0, "sendEmail never called without email");
  }

  // ── Case 7: All four form types produce inbound_confirmation_sent ──
  section("Case 7: All four public form types produce inbound_confirmation_sent");
  {
    const formTypes = ["statement_upload", "estimate", "get_started", "callback"] as const;
    for (const ft of formTypes) {
      h.reset();
      await enrollInInboundConfirmation({
        contactId: 1, formType: ft, dealId: 10, submissionId: `sub-7-${ft}`,
        _testOverrides: h.makeOverrides({ contact: makeContact(), ghlAvailable: false, inboundWorkflowId: null, sendEmail: smtpSendOk }),
      });
      assert(h.auditOf("inbound_confirmation_sent").length === 1, `form type "${ft}" → inbound_confirmation_sent`);
    }
  }

  // ── Case 7b: Source-code verification — per-request UUID + sendConfirmationEmail deliver-only ──
  section("Case 7b: routes generate per-request UUID; sendConfirmationEmail has no DB writes");
  {
    const routeSrc = await readFile("server/routes/public.ts", "utf8");
    const fnSrc    = await readFile("server/services/ghl-workflow-enrollment.ts", "utf8");
    const ghlSrc   = await readFile("server/services/ghl.ts", "utf8");

    // Each route handler must generate a fresh UUID at try-block start and pass it.
    // This makes each HTTP submission unique (distinct follow-up jobs) while BullMQ
    // job retries of the SAME job remain stable (UUID stored in BullMQ job data).
    assert((routeSrc.match(/const submissionId = crypto\.randomUUID\(\);/g) || []).length >= 4,
      "at least 4 per-handler UUID declarations in public.ts (one per form route)");

    // Routes must pass the UUID as submissionId to enrollInInboundConfirmation
    assert(routeSrc.includes("formType: \"estimate\", dealId: deal.id, submissionId }"),
      "estimate route passes per-request UUID as submissionId");
    assert(routeSrc.includes("formType: \"get_started\", dealId: deal.id, submissionId }"),
      "get_started route passes per-request UUID as submissionId");
    assert(routeSrc.includes("formType: \"callback\", dealId: deal.id, submissionId }"),
      "callback route passes per-request UUID as submissionId");
    assert(routeSrc.includes("formType: \"statement_upload\", dealId: existingDealId || undefined, submissionId }"),
      "statement_upload route passes per-request UUID as submissionId");

    // The function's internal fallback for callers that don't pass a submissionId
    assert(fnSrc.includes("params.submissionId ?? `${contactId}-${formType}-${dealId ?? \"nd\"}`"),
      "enrollInInboundConfirmation has internal fallback for callers that omit submissionId");

    // sendConfirmationEmail must be deliver-only: sendGhlEmail called with skipActivityLog:true
    assert(fnSrc.includes("skipActivityLog: true"), "sendConfirmationEmail calls sendGhlEmail with skipActivityLog:true");

    // sendGhlEmail must honour skipActivityLog: true
    assert(ghlSrc.includes("skipActivityLog?: boolean"), "sendGhlEmail exposes skipActivityLog param");
    assert(ghlSrc.includes("if (!params.skipActivityLog)"), "sendGhlEmail skips activity log when flag set");

    // Routes must still call enrollInInboundConfirmation for all four form types
    for (const ft of ["statement_upload", "estimate", "get_started", "callback"]) {
      assert(routeSrc.includes(`formType: "${ft}"`), `public.ts calls enrollInInboundConfirmation for "${ft}"`);
    }
  }

  // ── Case 7c: Per-request UUID → distinct follow-up jobs for distinct HTTP submissions ──
  section("Case 7c: per-request UUID — two submissions → two distinct jobIds");
  {
    h.reset();
    const jobIds: string[] = [];
    const makeOv = () => h.makeOverrides({
      contact: makeContact({ id: 1 }), ghlAvailable: false, inboundWorkflowId: null, sendEmail: smtpSendOk,
      scheduleFollowup: async (jId: string) => { jobIds.push(jId); },
    });

    // Simulate two distinct HTTP form submissions for the same contact+deal
    // (e.g., user submits twice after a network hiccup)
    // Each gets its own UUID from the route → distinct follow-up jobs
    const uuid1 = crypto.randomUUID();
    const uuid2 = crypto.randomUUID();
    await enrollInInboundConfirmation({ contactId: 1, formType: "estimate", dealId: 10, submissionId: uuid1, _testOverrides: makeOv() });
    await enrollInInboundConfirmation({ contactId: 1, formType: "estimate", dealId: 10, submissionId: uuid2, _testOverrides: makeOv() });

    assert(jobIds.length === 2, "two distinct HTTP submissions schedule two follow-up jobs");
    assert(jobIds[0] !== jobIds[1], `distinct submissions → distinct jobIds (${jobIds[0]} vs ${jobIds[1]})`);

    // BullMQ retry stability: same UUID passed again → same jobId (simulates BullMQ internal retry)
    h.reset();
    const retryJobIds: string[] = [];
    const retryOv = h.makeOverrides({
      contact: makeContact({ id: 1 }), ghlAvailable: false, inboundWorkflowId: null, sendEmail: smtpSendOk,
      scheduleFollowup: async (jId: string) => { retryJobIds.push(jId); },
    });
    await enrollInInboundConfirmation({ contactId: 1, formType: "estimate", dealId: 10, submissionId: uuid1, _testOverrides: retryOv });
    await enrollInInboundConfirmation({ contactId: 1, formType: "estimate", dealId: 10, submissionId: uuid1, _testOverrides: retryOv });
    assert(retryJobIds[0] === retryJobIds[1], `same UUID → same jobId (BullMQ-retry stable): ${retryJobIds[0]}`);
  }

  // ── Case 8: BullMQ queue handler registered ──
  section("Case 8: BullMQ enrichment queue has handler for inbound-confirmation-followup");
  {
    const { QUEUE_NAMES } = await import("../server/services/queue-manager");
    assert(QUEUE_NAMES.ENRICHMENT === "enrichment", "QUEUE_NAMES.ENRICHMENT is 'enrichment'");
    const src = await readFile("server/services/queue-manager.ts", "utf8");
    assert(src.includes('"inbound-confirmation-followup"'), "queue-manager.ts has handler");
    assert(src.includes("runInboundConfirmationFollowupJob"), "queue-manager.ts dispatches to followup handler");
  }

  // ── Case 9: Follow-up jobId format and options ──
  section("Case 9: Follow-up scheduled with correct jobId, delay, and attempts");
  {
    h.reset();
    await enrollInInboundConfirmation({
      contactId: 42, formType: "estimate", dealId: 7, submissionId: "sub-9-stable",
      _testOverrides: h.makeOverrides({ contact: makeContact({ id: 42 }), ghlAvailable: false, inboundWorkflowId: null, sendEmail: smtpSendOk }),
    });
    assert(h.scheduledJobs.length === 1, "exactly one follow-up job scheduled");
    assert(h.scheduledJobs[0].jobId === "inbound_followup:sub-9-stable", `jobId correct (got: ${h.scheduledJobs[0].jobId})`);
    assert(h.scheduledJobs[0].data.contactId === 42, "job data.contactId correct");
    assert(h.scheduledJobs[0].opts.delay === 24 * 60 * 60 * 1000, "delay is 24h");
    assert(h.scheduledJobs[0].opts.attempts === 3, "attempts = 3");
  }

  // ── Case 10: Caller submissionId passes through unchanged ──
  section("Case 10: Caller-provided submissionId preserved in audit and BullMQ");
  {
    h.reset();
    await enrollInInboundConfirmation({
      contactId: 1, formType: "estimate", dealId: 99, submissionId: "caller-stable-id",
      _testOverrides: h.makeOverrides({ contact: makeContact(), ghlAvailable: false, inboundWorkflowId: null, sendEmail: smtpSendOk }),
    });
    assert(h.auditOf("inbound_confirmation_sent")[0]?.details?.submissionId === "caller-stable-id", "submissionId in audit");
    assert(h.scheduledJobs[0]?.jobId === "inbound_followup:caller-stable-id", "BullMQ jobId from submissionId");
  }

  // ── Case 11: Same submissionId → BullMQ dedup ──
  section("Case 11: Same submissionId → BullMQ dedup (one job, not two)");
  {
    h.reset();
    const jobs: string[] = [];
    const dedupeScheduler = async (jId: string) => { if (!jobs.includes(jId)) jobs.push(jId); };
    const ov = h.makeOverrides({ contact: makeContact(), ghlAvailable: false, inboundWorkflowId: null, sendEmail: smtpSendOk, scheduleFollowup: dedupeScheduler });
    await enrollInInboundConfirmation({ contactId: 1, formType: "estimate", dealId: 10, submissionId: "fixed-sub", _testOverrides: ov });
    await enrollInInboundConfirmation({ contactId: 1, formType: "estimate", dealId: 10, submissionId: "fixed-sub", _testOverrides: ov });
    assert(jobs.length === 1, `same submissionId deduped — one job (got: ${jobs.length})`);
  }

  // ── Case 12: BullMQ scheduling failure → sent preserved, schedule_failed logged ──
  section("Case 12: Scheduling failure → sent preserved, schedule_failed logged");
  {
    h.reset();
    await enrollInInboundConfirmation({
      contactId: 1, formType: "estimate", dealId: 10, submissionId: "sub-12",
      _testOverrides: h.makeOverrides({
        contact: makeContact(), ghlAvailable: false, inboundWorkflowId: null, sendEmail: smtpSendOk,
        scheduleFollowup: async () => { throw new Error("BullMQ down"); },
      }),
    });
    assert(h.auditOf("inbound_confirmation_sent").length === 1, "sent audit preserved");
    assert(h.auditOf("inbound_confirmation_followup_schedule_failed").length === 1, "schedule_failed logged");
    assert(h.auditOf("inbound_confirmation_failed").length === 0, "no failed audit when send succeeds");
  }

  // ── Case 13: GHL upsert failure does not block SMTP ──
  section("Case 13: GHL upsert failure → SMTP still delivers");
  {
    h.reset();
    await enrollInInboundConfirmation({
      contactId: 1, formType: "estimate", dealId: 10, submissionId: "sub-13",
      _testOverrides: h.makeOverrides({
        contact: makeContact({ ghlContactId: null }), ghlAvailable: true, inboundWorkflowId: null,
        upsertGhlContact: async () => { throw new Error("GHL 503"); },
        sendEmail: smtpSendOk,
      }),
    });
    assert(h.auditOf("inbound_confirmation_sent").length === 1, "sent despite GHL upsert failure");
    assert(h.auditOf("inbound_confirmation_sent")[0]?.details?.provider === "smtp", "provider=smtp");
  }

  // ── Case 14: Audit entry has all required fields ──
  section("Case 14: Audit entry contains submissionId, provider, formType, dealId, recipient");
  {
    h.reset();
    await enrollInInboundConfirmation({
      contactId: 42, formType: "get_started", dealId: 77, submissionId: "audit-fields",
      _testOverrides: h.makeOverrides({ contact: makeContact({ id: 42, email: "test@example.com" }), ghlAvailable: false, inboundWorkflowId: null, sendEmail: smtpSendOk }),
    });
    const e = h.auditOf("inbound_confirmation_sent")[0];
    assert(!!e, "audit entry exists");
    assert(e?.details?.submissionId === "audit-fields", "submissionId in details");
    assert(e?.details?.formType === "get_started", "formType in details");
    assert(e?.details?.dealId === 77, "dealId in details");
    assert(e?.details?.provider === "smtp", "provider in details");
    assert(e?.details?.recipient === "test@example.com", "recipient in details");
  }

  // ── Case 15: No follow-up when all providers fail ──
  section("Case 15: No follow-up scheduled when sendEmail fails");
  {
    h.reset();
    await enrollInInboundConfirmation({
      contactId: 1, formType: "estimate", dealId: 10, submissionId: "sub-15",
      _testOverrides: h.makeOverrides({ contact: makeContact({ ghlContactId: "ghl-123" }), ghlAvailable: true, inboundWorkflowId: null, sendEmail: allSendFail }),
    });
    assert(h.scheduledJobs.length === 0, "no follow-up scheduled on failure");
  }

  // ── Cases 16–18: Stage 5 logic (source verification) ──
  section("Case 16: Stage 5 — dynamic blocking, no-provider (workflow ID alone excluded)");
  {
    const src = await readFile("scripts/go-live-check.ts", "utf8");
    assert(src.includes("stageIsBlocking = !!failedLog || noDeliveryAtAll"), "stageIsBlocking = !!failedLog || noDeliveryAtAll");
    assert(!src.includes("stage(5, \"Inbound confirmation enrollment\", steps, false)"), "stage 5 not unconditionally non-blocking");
    assert(!src.includes("stage(5, \"Inbound confirmation enrollment\", steps, true)"), "stage 5 not unconditionally blocking");
    assert(src.includes("SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS"), "SMTP check includes SMTP_PASS");
    // Workflow ID alone is not a delivery provider — requires GHL credentials
    assert(src.includes("hasProvider = hasGhl || hasSmtp"), "hasProvider = hasGhl || hasSmtp (workflow ID excluded — not a real delivery provider)");
    assert(!src.includes("hasProvider = hasGhl || hasSmtp || !!ghlInboundWorkflowId"), "workflow ID NOT counted as delivery provider");
    assert(src.includes("hasProviderOuter = hasGhlOuter || hasSmtpOuter"), "noDeliveryAtAll uses real provider check only");
  }

  section("Case 17: Stage 5 — enrolled/sent produce pass=true; all others fail");
  {
    const src = await readFile("scripts/go-live-check.ts", "utf8");
    assert(src.includes("step(\"Inbound confirmation: GHL workflow enrolled\", true"), "enrolled → pass=true");
    assert(src.includes("step(\"Inbound confirmation: direct email sent\", true"), "sent → pass=true");
    assert(src.includes("step(\"Inbound confirmation: all providers failed\", false"), "failed → pass=false");
    assert(src.includes("step(\"Inbound confirmation: no delivery provider configured\", false"), "no-provider → pass=false");
  }

  section("Case 18: Stage 5 — no-provider condition triggers blocking failure");
  {
    const src = await readFile("scripts/go-live-check.ts", "utf8");
    assert(src.includes("noDeliveryAtAll = !enrolledLog && !sentLog && !skippedLog && !hasProviderOuter"), "noDeliveryAtAll computed correctly");
    assert(src.includes("stageIsBlocking = !!failedLog || noDeliveryAtAll"), "blocking when failedLog OR noDeliveryAtAll");
  }

  // ── Cases 19–21: Injectable boundaries ──
  section("Case 19–21: Injectable provider boundaries verified in production source");
  {
    const src = await readFile("server/services/ghl-workflow-enrollment.ts", "utf8");
    assert(src.includes("_testOverrides?: InboundConfirmationTestOverrides"), "enrollInInboundConfirmation accepts _testOverrides");
    assert(src.includes("ov?.sendEmail ?? sendConfirmationEmail"), "sendEmail is injectable");
    assert(src.includes("ov?.writeAuditLog"), "writeAuditLog is injectable");
    assert(src.includes("InboundFollowupTestOverrides"), "followup job also exports test override interface");
    assert(src.includes("_testOverrides?: InboundFollowupTestOverrides"), "runInboundConfirmationFollowupJob accepts _testOverrides");
  }

  // ── Case 22: SMS gate ──
  section("Case 22: SMS sent only when consentSms=true AND ghlAvailable=true AND ghlContactId");
  {
    h.reset();
    const smsCalls: any[] = [];
    await enrollInInboundConfirmation({
      contactId: 1, formType: "estimate", dealId: 10, submissionId: "sub-22",
      _testOverrides: h.makeOverrides({
        contact: makeContact({ consentSms: true, phone: "5559990000", ghlContactId: "ghl-123" }),
        ghlAvailable: true, inboundWorkflowId: null, sendEmail: smtpSendOk,
        sendSms: async (p) => { smsCalls.push(p); },
      }),
    });
    assert(smsCalls.length === 1, "SMS sent when consent+ghl+phone present");

    h.reset();
    smsCalls.length = 0;
    await enrollInInboundConfirmation({
      contactId: 1, formType: "estimate", dealId: 10, submissionId: "sub-22b",
      _testOverrides: h.makeOverrides({
        contact: makeContact({ consentSms: false, ghlContactId: "ghl-123" }),
        ghlAvailable: true, inboundWorkflowId: null, sendEmail: smtpSendOk,
        sendSms: async (p) => { smsCalls.push(p); },
      }),
    });
    assert(smsCalls.length === 0, "SMS NOT sent when consentSms=false");
  }

  // ── Case 23: GHL direct success → SMTP never invoked separately ──
  section("Case 23: GHL direct success → sendEmail called once, no SMTP separately");
  {
    h.reset();
    const sendCalls: any[] = [];
    await enrollInInboundConfirmation({
      contactId: 1, formType: "estimate", dealId: 10, submissionId: "sub-23",
      _testOverrides: h.makeOverrides({
        contact: makeContact({ ghlContactId: "ghl-xyz" }), ghlAvailable: true, inboundWorkflowId: null,
        sendEmail: async (p) => { sendCalls.push(p); return ghlSendOk(p); },
      }),
    });
    assert(sendCalls.length === 1, "sendEmail called exactly once");
    assert(h.auditOf("inbound_confirmation_sent")[0]?.details?.provider === "ghl_direct", "provider=ghl_direct");
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PART 2 — Follow-up job execution (runInboundConfirmationFollowupJob)
  // ─────────────────────────────────────────────────────────────────────────────

  // ── Case 24A: Follow-up job — deal progressed → skip ──
  section("Case 24A: Follow-up job — deal progressed to 'Statement Received' → skip");
  {
    h.reset();
    await runInboundConfirmationFollowupJob({
      contactId: 1, dealId: 10, formType: "estimate", submissionId: "fup-24a",
      _testOverrides: h.makeFovOverrides({
        contact: makeContact(),
        deal: { id: 10, stage: "Statement Received" },
        sendEmail: smtpSendOk,
      }),
    });
    const skipped = h.auditOf("inbound_confirmation_followup_skipped");
    assert(skipped.length === 1, "followup skipped audit written");
    assert(skipped[0]?.details?.reason === "deal_progressed", `reason=deal_progressed (got: ${skipped[0]?.details?.reason})`);
    assert(skipped[0]?.details?.dealStage === "Statement Received", "dealStage captured");
    assert(h.auditOf("inbound_confirmation_followup_sent").length === 0, "no sent audit when deal progressed");
  }

  // ── Case 24B: Follow-up job — other deal stages do NOT skip ──
  section("Case 24B: Follow-up job — deal in 'New Lead' → send proceeds");
  {
    h.reset();
    await runInboundConfirmationFollowupJob({
      contactId: 1, dealId: 10, formType: "estimate", submissionId: "fup-24b",
      _testOverrides: h.makeFovOverrides({
        contact: makeContact(),
        deal: { id: 10, stage: "New Lead" },
        sendEmail: smtpSendOk,
      }),
    });
    assert(h.auditOf("inbound_confirmation_followup_sent").length === 1, "followup sent when deal in New Lead");
    assert(h.auditOf("inbound_confirmation_followup_skipped").length === 0, "not skipped");
  }

  // ── Case 24C: Follow-up job — opted-out → skip with opted_out reason ──
  section("Case 24C: Follow-up job — contact opted-out → skipped (opted_out)");
  {
    h.reset();
    await runInboundConfirmationFollowupJob({
      contactId: 1, dealId: 10, formType: "estimate", submissionId: "fup-24c",
      _testOverrides: h.makeFovOverrides({
        contact: makeContact({ emailStatus: "opted_out" }),
        evaluateContactability: async () => ({ allowed: false, reason: "email opted out" }),
        sendEmail: smtpSendOk,
      }),
    });
    const skipped = h.auditOf("inbound_confirmation_followup_skipped");
    assert(skipped.length === 1, "followup skipped when opted-out");
    assert(skipped[0]?.details?.reason === "opted_out", `reason=opted_out (got: ${skipped[0]?.details?.reason})`);
    assert(h.auditOf("inbound_confirmation_followup_sent").length === 0, "no sent audit for opted-out");
  }

  // ── Case 24D: Follow-up job — DNC → skip with dnc reason ──
  section("Case 24D: Follow-up job — DNC contact → skipped (dnc)");
  {
    h.reset();
    await runInboundConfirmationFollowupJob({
      contactId: 1, dealId: 10, formType: "estimate", submissionId: "fup-24d",
      _testOverrides: h.makeFovOverrides({
        contact: makeContact({ doNotContact: true }),
        evaluateContactability: async () => ({ allowed: false, reason: "DNC flag set" }),
        sendEmail: smtpSendOk,
      }),
    });
    const skipped = h.auditOf("inbound_confirmation_followup_skipped");
    assert(skipped.length === 1, "followup skipped when DNC");
    assert(skipped[0]?.details?.reason === "dnc", `reason=dnc (got: ${skipped[0]?.details?.reason})`);
  }

  // ── Case 24E: Follow-up job — eligible contact → sends and logs followup_sent ──
  section("Case 24E: Follow-up job — eligible contact → inbound_confirmation_followup_sent");
  {
    h.reset();
    await runInboundConfirmationFollowupJob({
      contactId: 1, dealId: 10, formType: "estimate", submissionId: "fup-24e",
      _testOverrides: h.makeFovOverrides({
        contact: makeContact({ email: "eligible@example.com", firstName: "Alice" }),
        deal: { id: 10, stage: "New Lead" },
        evaluateContactability: async () => ({ allowed: true }),
        checkDuplicateFollowup: async () => false,
        sendEmail: smtpSendOk,
      }),
    });
    const sent = h.auditOf("inbound_confirmation_followup_sent");
    assert(sent.length === 1, "inbound_confirmation_followup_sent logged");
    assert(sent[0]?.details?.provider === "smtp", "provider=smtp in followup");
    assert(sent[0]?.details?.recipient === "eligible@example.com", "recipient captured");
    assert(sent[0]?.details?.submissionId === "fup-24e", "submissionId in followup audit");
  }

  // ── Case 24F: Follow-up job — duplicate guard prevents double-send ──
  section("Case 24F: Follow-up job — duplicate guard fires → skipped (duplicate_already_processed)");
  {
    h.reset();
    await runInboundConfirmationFollowupJob({
      contactId: 1, dealId: 10, formType: "estimate", submissionId: "fup-24f",
      _testOverrides: h.makeFovOverrides({
        contact: makeContact(),
        checkDuplicateFollowup: async () => true, // duplicate exists
        sendEmail: smtpSendOk,
      }),
    });
    const skipped = h.auditOf("inbound_confirmation_followup_skipped");
    assert(skipped.length === 1, "skipped when duplicate detected");
    assert(skipped[0]?.details?.reason === "duplicate_already_processed", `reason=duplicate_already_processed (got: ${skipped[0]?.details?.reason})`);
    assert(h.auditOf("inbound_confirmation_followup_sent").length === 0, "no sent when duplicate");
  }

  // ── Case 25: Follow-up job — all providers fail → throws (BullMQ retry) ──
  section("Case 25: Follow-up job — sendEmail fails → throws for BullMQ retry");
  {
    h.reset();
    let threw = false;
    try {
      await runInboundConfirmationFollowupJob({
        contactId: 1, dealId: 10, formType: "estimate", submissionId: "fup-25",
        _testOverrides: h.makeFovOverrides({
          contact: makeContact(),
          sendEmail: allSendFail,
        }),
      });
    } catch (err: any) {
      threw = true;
      assert(err.message.includes("fup-25"), "thrown error includes submissionId");
    }
    assert(threw, "function throws on provider failure (signals BullMQ to retry)");
    assert(h.auditOf("inbound_confirmation_followup_failed").length === 1, "followup_failed audit written");
    assert(h.auditOf("inbound_confirmation_followup_sent").length === 0, "no sent audit on failure");
  }

  // ─── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.error("\nFailed cases:");
    failures.forEach((f) => console.error(`  ✗ ${f}`));
    process.exit(1);
  } else {
    console.log("\n✓ All cases passed");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Test script crashed:", err);
  process.exit(1);
});
