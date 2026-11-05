/**
 * Stage 5 CP4 — boarding outbox worker certification (S5-11, S5-12).
 * Disposable database; fake processor adapter; no provider network, no real MID, no real boarding.
 *
 * The REAL worker (claim → handleProcessorSubmit → typed settlement → tick) runs against a migrated disposable
 * database. The adapter is a counting fake registered through the worker's NODE_ENV=test seam and named "mock" so the
 * worker's non-production synthetic-snapshot exemption applies (no owner activation snapshot is created or read).
 *
 * S5-11: the fake adapter asserts the exact synthetic protected + business fields (EIN/SSN/DOB/routing/account) in
 *        memory; a raw snake-case row cast (the original behaviour) is shown to lose them (negative control); an
 *        incomplete application is refused before transport with field NAMES only; no secret reaches logs, the outbox
 *        row, audit rows or the deal row.
 * S5-12: an ambiguous provider outcome stays dead_letter/reconciliation-required and is never delivered or resent;
 *        the delivery settlement is fenced so it cannot overwrite a terminal row (negative control).
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { assertDisposableTestInfrastructure } from "../test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary } from "../certification-provider-deny";

await assertDisposableTestInfrastructure({ operation: "Stage 5 boarding worker certification" });
// The launcher's fixed disposable key is not a valid 32-byte key; use a fresh random one for this process only.
process.env.MERCHANT_DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
process.env.VG_PROVIDER_DENY_MODE = "1";
applyCertificationProviderDenyBoundary({ fatal: true });

const { pool, db } = await import("../../server/db");
const { sql } = await import("drizzle-orm");
const worker = await import("../../server/services/deal-boarding-outbox-worker");
const appWorker = await import("../../server/services/merchant-application-outbox-worker");
const { processProtectedData, decryptProtectedFields } = await import("../../server/services/merchant-protected-data");
const { evaluateBoardingReadiness } = await import("../../server/services/boarding-readiness");
const { recordCertPolicy, removeCertPolicy, CERT_PROGRAM } = await import("./stage5-boarding-fixture");
await recordCertPolicy(db, sql);

let checks = 0;
const check = (v: unknown, message: string) => { assert(v, message); checks++; console.log(`✓ [S5-BW-${String(checks).padStart(2, "0")}] ${message}`); };
const tag = crypto.randomBytes(4).toString("hex");

// Capture every byte written to stderr/stdout so secrets-in-logs can be asserted.
const captured: string[] = [];
const origErr = process.stderr.write.bind(process.stderr);
const origOut = process.stdout.write.bind(process.stdout);
(process.stderr as any).write = (c: any, ...r: any[]) => { captured.push(String(c)); return (origErr as any)(c, ...r); };
(process.stdout as any).write = (c: any, ...r: any[]) => { captured.push(String(c)); return (origOut as any)(c, ...r); };

const SECRETS = { ein: "123456789", ssn: "512456789", dob: "1980-02-03", routing: "021000021", account: "000123456789" };

type Calls = { payloads: any[] };
function installFake(mode: "ok" | "ambiguous", calls: Calls, hook?: () => Promise<void>) {
  worker.__test__.setProcessorOverride(() => ({
    name: "mock",
    boardMerchant: async (profile: any) => {
      calls.payloads.push(JSON.parse(JSON.stringify(profile)));
      if (hook) await hook();
      if (mode === "ambiguous") return { success: false, ambiguous: true, error: "fixture ambiguous" };
      return { success: true, processorApplicationId: `FAKE-APP-${tag}-${calls.payloads.length}`, status: "submitted", message: "fixture" };
    },
  } as any));
}

async function fixture(label: string, opts: { omitAccount?: boolean; omitCaseVersion?: boolean } = {}) {
  const dealRes = await db.execute(sql`
    INSERT INTO deals (pipeline, stage, name, boarding_status)
    VALUES ('onboarding', 'Underwriting', ${`S5BW ${tag} ${label}`}, 'queued') RETURNING id`);
  const dealId = Number(((dealRes as any).rows ?? dealRes)[0].id);
  const appRes = await db.execute(sql`
    INSERT INTO merchant_applications (deal_id, legal_business_name, dba, business_address, business_city, business_state,
      business_zip, owner_first_name, owner_last_name, owner_email, business_phone, status, preferred_program)
    VALUES (${dealId}, ${`Fixture Legal ${tag} ${label}`}, 'Fixture DBA', '1 Fixture Way', 'Miami', 'FL', '33101',
      'Fixie', 'Tester', 'fixie@example.invalid', '3055550100', 'submitted', ${CERT_PROGRAM}) RETURNING id`);
  const appId = Number(((appRes as any).rows ?? appRes)[0].id);
  const enc = processProtectedData(appId, {
    ein: SECRETS.ein, ssn: SECRETS.ssn, dob: SECRETS.dob, routing: SECRETS.routing,
    account: opts.omitAccount ? undefined : SECRETS.account,
  });
  await db.execute(sql`
    UPDATE merchant_applications SET ein = ${enc.ein!.ciphertext}, owner_ssn = ${enc.ssn!.ciphertext},
      owner_dob = ${enc.dob!.ciphertext}, bank_routing_number = ${enc.routing!.ciphertext},
      bank_account_number = ${enc.account?.ciphertext ?? null}
    WHERE id = ${appId}`);
  const [{ v }] = (((await db.execute(sql`SELECT updated_at::text AS v FROM merchant_applications WHERE id = ${appId}`)) as any).rows) as any[];
  const readinessCaseVersion = opts.omitCaseVersion ? undefined : (await evaluateBoardingReadiness(dealId, { includeFieldCompleteness: false })).caseVersion;
  const outRes = await db.execute(sql`
    INSERT INTO deal_boarding_outbox (deal_id, application_id, event_type, idempotency_key, processor_name, payload, status)
    VALUES (${dealId}, ${appId}, 'processor_submit', ${`s5bw-${tag}-${label}`}, 'mock',
      ${JSON.stringify({ dealId, applicationId: appId, providerIdempotencyKey: `pik-${label}`, applicationLinkageVersion: v, readinessCaseVersion })}::jsonb, 'pending')
    RETURNING id`);
  const outboxId = String(((outRes as any).rows ?? outRes)[0].id);
  return { dealId, appId, outboxId };
}
const outbox = async (id: string) => (((await db.execute(sql`SELECT status, attempts, last_error, payload FROM deal_boarding_outbox WHERE id = ${id}`)) as any).rows)[0];
const dealRow = async (id: number) => (((await db.execute(sql`SELECT * FROM deals WHERE id = ${id}`)) as any).rows)[0];
const auditFor = async (dealId: number) => (((await db.execute(sql`SELECT action, details FROM audit_logs WHERE entity_type='deal' AND entity_id = ${dealId}`)) as any).rows) as any[];

// ── S5-11: payload fidelity ──────────────────────────────────────────────────
{
  const calls: Calls = { payloads: [] };
  installFake("ok", calls);
  const f = await fixture("ok");
  await worker.__test__.tick();
  check(calls.payloads.length === 1, "complete application reaches the adapter exactly once");
  const p = calls.payloads[0];
  check(p.legalBusinessName === `Fixture Legal ${tag} ok` && p.dba === "Fixture DBA", "business names survive the typed decode");
  check(p.businessAddress === "1 Fixture Way" && p.businessCity === "Miami" && p.businessState === "FL" && p.businessZip === "33101", "multi-word business address columns survive");
  check(p.ownerFirstName === "Fixie" && p.ownerLastName === "Tester" && p.ownerEmail === "fixie@example.invalid", "multi-word owner columns survive");
  check(p.ein === SECRETS.ein && p.ownerSsn === SECRETS.ssn && p.ownerDob === SECRETS.dob, "EIN, SSN and DOB are decrypted in memory for the adapter");
  check(p.bankRoutingNumber === SECRETS.routing && p.bankAccountNumber === SECRETS.account, "routing and account are decrypted in memory for the adapter");
  const o = await outbox(f.outboxId);
  check(o.status === "delivered", "successful submission settles delivered");
  const d = await dealRow(f.dealId);
  check(d.boarding_status === "submitted" && String(d.processor_application_id).startsWith("FAKE-APP-"), "deal records the provider application id");
  check(d.processor_program === "traditional", "processor_program is committed with the success state (not as a pre-I/O write)");

  // Negative control: the original raw snake-case row cast loses the protected fields.
  const raw = (((await db.execute(sql`SELECT * FROM merchant_applications WHERE id = ${f.appId}`)) as any).rows)[0];
  const lossy = decryptProtectedFields(raw as any, { role: "system", purpose: "boarding_processor_submission" });
  check(lossy.ein === SECRETS.ein && lossy.ownerSsn === undefined && lossy.ownerDob === undefined
    && lossy.bankRoutingNumber === undefined && lossy.bankAccountNumber === undefined,
    "negative control: the original raw-row cast keeps only EIN and loses SSN/DOB/routing/account");
}

// ── S5-11: incomplete application is refused before transport ───────────────
{
  const calls: Calls = { payloads: [] };
  installFake("ok", calls);
  const f = await fixture("incomplete", { omitAccount: true });
  await worker.__test__.tick();
  check(calls.payloads.length === 0, "incomplete application never reaches the adapter");
  const o = await outbox(f.outboxId);
  check(o.status === "dead_letter" && o.last_error === "BOARDING_PAYLOAD_INCOMPLETE", "incomplete application is dead-lettered with a safe code");
  const d = await dealRow(f.dealId);
  check(d.boarding_status === "dead_letter" && !d.processor_application_id, "deal is dead_letter with no provider id");
  const audit = (await auditFor(f.dealId)).find((a) => a.action === "deal_boarding_blocked_incomplete_payload");
  check(audit && JSON.stringify(audit.details).includes("bankAccountNumber"), "audit names the missing field");
  check(!JSON.stringify(audit.details).includes(SECRETS.routing), "audit carries field names only, never values");
  check(!JSON.stringify(worker.__test__.missingProviderFields({ legalBusinessName: "x" })).includes("legalBusinessName"), "validator reports only absent fields");
}

// ── S5-12: ambiguous settlement ─────────────────────────────────────────────
{
  const calls: Calls = { payloads: [] };
  installFake("ambiguous", calls);
  const f = await fixture("ambiguous");
  await worker.__test__.tick();
  check(calls.payloads.length === 1, "ambiguous fixture reached the adapter once");
  let o = await outbox(f.outboxId);
  check(o.status === "dead_letter" && o.last_error === "ambiguous_reconciliation_required", "ambiguous outcome remains dead_letter/reconciliation-required (never delivered)");
  const d = await dealRow(f.dealId);
  check(d.boarding_status === "ambiguous_reconciliation_required" && d.boarding_ambiguous_at, "deal records ambiguous_reconciliation_required with a timestamp");
  check(!d.processor_application_id, "no processor application id is invented for an ambiguous outcome");
  await worker.__test__.tick();
  await worker.__test__.tick();
  check(calls.payloads.length === 1, "no automatic resubmit after an ambiguous outcome");
  o = await outbox(f.outboxId);
  check(o.status === "dead_letter", "ambiguous row is still not delivered after further ticks");
}

// ── Barrier-driven concurrent claim ─────────────────────────────────────────
{
  const calls: Calls = { payloads: [] };
  installFake("ok", calls);
  const f = await fixture("claim");
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const claimers = [0, 1, 2, 3].map(async () => { await gate; return worker.__test__.claimOne(); });
  release();
  const got = (await Promise.all(claimers)).filter(Boolean) as any[];
  check(got.length === 1 && got[0].id === f.outboxId, "four concurrent claimers: exactly one claims the row");
  // Late SUCCESS from a stale claim (S5-12/14): the newer claim owns the row; the stale
  // provider response must change nothing. Then the owning claim commits everything together.
  const claimRow = { id: f.outboxId, dealId: f.dealId, applicationId: f.appId, processorName: "mock", attempts: got[0].attempts, payload: got[0].payload };
  const staleRes = await worker.__test__.handleProcessorSubmit({ ...claimRow, attempts: got[0].attempts + 1 });
  check(staleRes.settlement === "stale_claim", "a late successful result from a stale claim is discarded");
  const d0 = await dealRow(f.dealId);
  check(d0.boarding_status === "queued" && !d0.processor_application_id, "negative control: stale success wrote no deal state or application id");
  check((await outbox(f.outboxId)).status === "processing", "stale success left the outbox row with its owner");
  check(!(await auditFor(f.dealId)).some((a) => a.action === "deal_submitted_to_processor"), "stale success wrote no submission audit");
  check(((await db.execute(sql`SELECT count(*)::int AS n FROM tasks WHERE deal_id = ${f.dealId}`)) as any).rows[0].n === 0, "stale success created no monitoring task");
  const ownRes = await worker.__test__.handleProcessorSubmit(claimRow);
  const d1 = await dealRow(f.dealId);
  check(ownRes.settlement === "delivered" && d1.boarding_status === "submitted" && !!d1.processor_application_id, "the owning claim commits the submitted deal");
  check((await outbox(f.outboxId)).status === "delivered", "the owning claim settles delivered in the same transaction");
}

// ── S5-12: a stale claim cannot overwrite a newer settlement ────────────────
{
  const asRow = (f: { dealId: number; appId: number; outboxId: string }, o: any, attempts: number) =>
    ({ id: f.outboxId, dealId: f.dealId, applicationId: f.appId, processorName: "mock", attempts, payload: o.payload });
  // Newer claim already settled: outbox delivered (attempt 2), deal submitted.
  const calls: Calls = { payloads: [] };
  installFake("ambiguous", calls);
  const f = await fixture("stale-ambiguous");
  await db.execute(sql`UPDATE deal_boarding_outbox SET status='delivered', attempts=2 WHERE id = ${f.outboxId}`);
  await db.execute(sql`UPDATE deals SET boarding_status='submitted' WHERE id = ${f.dealId}`);
  const o0 = await outbox(f.outboxId);
  await worker.__test__.handleProcessorSubmit(asRow(f, o0, 1));
  const d = await dealRow(f.dealId);
  check(calls.payloads.length === 0, "a claim that no longer owns the row is fenced BEFORE provider I/O (no dispatch)");
  check(d.boarding_status === "submitted" && !d.boarding_ambiguous_at, "stale ambiguous result does not flip a newer submitted deal back to ambiguous");
  check((await outbox(f.outboxId)).status === "delivered", "stale ambiguous result leaves the newer delivered outbox row alone");
  check(!(await auditFor(f.dealId)).some((a) => a.action === "deal_boarding_ambiguous"), "stale ambiguous result writes no ambiguous audit");
  // Takeover DURING the provider call (the marker was written while the claim was still owned).
  for (const mode of ["ambiguous", "ok"] as const) {
    const mid: Calls = { payloads: [] };
    const m = await fixture(`takeover-${mode}`);
    await db.execute(sql`UPDATE deal_boarding_outbox SET status='processing', attempts=1 WHERE id = ${m.outboxId}`);
    installFake(mode, mid, async () => {
      await db.execute(sql`UPDATE deal_boarding_outbox SET status='delivered', attempts=2, last_error=NULL WHERE id = ${m.outboxId}`);
      await db.execute(sql`UPDATE deals SET boarding_status='submitted', processor_application_id='NEWER-OWNER-APP' WHERE id = ${m.dealId}`);
    });
    const res = await worker.__test__.handleProcessorSubmit(asRow(m, await outbox(m.outboxId), 1));
    const dm = await dealRow(m.dealId);
    check(mid.payloads.length === 1 && res.settlement === "stale_claim", `late ${mode} result after takeover: provider was reached and the result is discarded`);
    check(dm.processor_application_id === "NEWER-OWNER-APP" && dm.boarding_status === "submitted" && !dm.boarding_ambiguous_at, `late ${mode} result leaves the newer owner's deal state untouched`);
    const am = await auditFor(m.dealId);
    check(!am.some((a) => a.action === "deal_boarding_ambiguous" || a.action === "deal_submitted_to_processor"), `late ${mode} result writes no audit`);
    check(((await db.execute(sql`SELECT count(*)::int AS n FROM tasks WHERE deal_id = ${m.dealId}`)) as any).rows[0].n === 0, `late ${mode} result creates no task`);
  }
  installFake("ambiguous", calls);
  // Control: the owning claim (matching attempt) still settles ambiguous.
  const g = await fixture("owner-ambiguous");
  await db.execute(sql`UPDATE deal_boarding_outbox SET status='processing', attempts=1 WHERE id = ${g.outboxId}`);
  await worker.__test__.handleProcessorSubmit(asRow(g, await outbox(g.outboxId), 1));
  check((await dealRow(g.dealId)).boarding_status === "ambiguous_reconciliation_required", "control: the owning claim still records ambiguous");

  // No-snapshot branch with a stale claim.
  worker.__test__.setProcessorOverride(() => ({ name: "payarc", boardMerchant: async () => { throw new Error("must not be called"); } } as any));
  const h = await fixture("stale-nosnapshot");
  await db.execute(sql`UPDATE deal_boarding_outbox SET status='delivered', attempts=2, processor_name='payarc' WHERE id = ${h.outboxId}`);
  await db.execute(sql`UPDATE deals SET boarding_status='submitted' WHERE id = ${h.dealId}`);
  let threw = false;
  try { await worker.__test__.handleProcessorSubmit({ ...asRow(h, await outbox(h.outboxId), 1), processorName: "payarc" }); } catch (e: any) { threw = !!e?.alreadyHandled; }
  check(threw, "no-snapshot refusal still stops the stale claim before transport");
  check((await outbox(h.outboxId)).status === "delivered" && (await outbox(h.outboxId)).last_error === null, "stale no-snapshot refusal cannot dead-letter a newer delivered row");
  check(!(await auditFor(h.dealId)).some((a) => a.action === "deal_boarding_blocked_no_snapshot"), "stale no-snapshot refusal writes no audit");
  const k = await fixture("owner-nosnapshot");
  await db.execute(sql`UPDATE deal_boarding_outbox SET status='processing', attempts=1, processor_name='payarc' WHERE id = ${k.outboxId}`);
  try { await worker.__test__.handleProcessorSubmit({ ...asRow(k, await outbox(k.outboxId), 1), processorName: "payarc" }); } catch { /* AlreadyTerminalError expected */ }
  check((await outbox(k.outboxId)).last_error === "ACTIVATION_SNAPSHOT_REQUIRED", "control: the owning claim still dead-letters without a snapshot");
  worker.__test__.setProcessorOverride(null);
}

// ── S5-15: dispatch re-evaluates readiness before any protected read or transport ──
{
  const calls: Calls = { payloads: [] };
  installFake("ok", calls);
  const f = await fixture("notready");
  await db.execute(sql`UPDATE deals SET pipeline='sales' WHERE id = ${f.dealId}`);
  await worker.__test__.tick();
  const o = await outbox(f.outboxId);
  check(calls.payloads.length === 0 && o.status === "dead_letter" && o.last_error === "BOARDING_NOT_READY", "a deal that is no longer ready is dead-lettered at dispatch with no transport");
  const a = (await auditFor(f.dealId)).find((x) => x.action === "deal_boarding_blocked_not_ready");
  check(a && JSON.stringify(a.details).includes("deal_not_in_onboarding_pipeline"), "the blocker code is audited");
}

// ── S5-14: crash after provider dispatch is never re-sent ──────────────────
{
  const calls: Calls = { payloads: [] };
  const c = await fixture("crash");
  // The provider "accepts" the request, then the process dies before any local settlement:
  // the stale reclaim returns the row to pending and the in-flight handler's failure is fenced out.
  installFake("ok", calls, async () => {
    await db.execute(sql`UPDATE deal_boarding_outbox SET status='pending', locked_at=NULL, available_at=NULL WHERE id = ${c.outboxId}`);
    throw new Error("simulated crash after provider accepted");
  });
  await worker.__test__.tick(); // same tick re-claims the reclaimed row (loop of up to 5 claims)
  await worker.__test__.tick();
  const oc = await outbox(c.outboxId);
  const dc = await dealRow(c.dealId);
  check(calls.payloads.length === 1, "the reclaimed row is NOT re-sent to the provider (negative control: the original retried with no local application id)");
  check(oc.status === "dead_letter" && dc.boarding_status === "ambiguous_reconciliation_required" && !dc.processor_application_id, "the unknown outcome is held for reconciliation, not delivered");
  check((await auditFor(c.dealId)).some((a) => a.action === "deal_boarding_ambiguous" && /never settled/.test(JSON.stringify(a.details))), "the hold is audited with the earlier-unsettled-dispatch reason");
  // A definite local/provider failure (no dispatch outcome unknown) clears the marker and stays retryable.
  const calls2: Calls = { payloads: [] };
  const r = await fixture("definite-failure");
  worker.__test__.setProcessorOverride(() => ({ name: "mock", boardMerchant: async () => { calls2.payloads.push({}); return { success: false, error: "rejected" }; } } as any));
  await worker.__test__.tick();
  const orr = await outbox(r.outboxId);
  check(orr.status === "pending" && orr.last_error !== "DISPATCH_STARTED", "a definite provider rejection overwrites the marker and remains retryable");
  // R05: a permanent 4xx is terminal at once (with adapter/program/operation identity); a 429 stays retryable.
  const perm = await fixture("permanent-4xx");
  worker.__test__.setProcessorOverride(() => ({ name: "mock", boardMerchant: async () => ({ success: false, permanent: true, httpStatus: 422, error: "rejected" }) } as any));
  await worker.__test__.tick();
  const op = await outbox(perm.outboxId);
  const permAudit = (await auditFor(perm.dealId)).find((a) => a.action === "deal_boarding_dead_letter");
  check(op.status === "dead_letter" && op.attempts === 1 && (await dealRow(perm.dealId)).boarding_status === "dead_letter", "a permanent provider rejection is dead-lettered on the first attempt, not retried six times");
  check(permAudit && permAudit.details.permanent === true && permAudit.details.httpStatus === 422 && permAudit.details.adapter === "mock" && permAudit.details.operation === "board_merchant" && permAudit.details.program, "the dead-letter audit records permanence, HTTP status, adapter, program and operation");
  const rate = await fixture("rate-limited");
  worker.__test__.setProcessorOverride(() => ({ name: "mock", boardMerchant: async () => ({ success: false, retryable: true, httpStatus: 429, error: "slow down" }) } as any));
  await worker.__test__.tick();
  check((await outbox(rate.outboxId)).status === "pending", "a 429 refusal is retryable and the row stays pending");
  worker.__test__.setProcessorOverride(null);
}

// ── R03/R04: case-version fence, policy fail-closed, post-provider uncertainty, provider status ──
{
  // (1) A decision recorded after enqueue changes the case tuple → refused before transport.
  const calls: Calls = { payloads: [] };
  installFake("ok", calls);
  const a = await fixture("case-changed");
  await db.execute(sql`INSERT INTO underwriting_decisions (deal_id, decision, score, decided_at) VALUES (${a.dealId}, 'approve', 80, now() - interval '1 minute')`);
  await worker.__test__.tick();
  let o = await outbox(a.outboxId);
  check(calls.payloads.length === 0 && o.status === "dead_letter" && o.last_error === "BOARDING_CASE_CHANGED", "a decision recorded after enqueue changes the case version and blocks transport");
  // (2) Legacy rows without a captured version fail closed.
  const b = await fixture("case-missing", { omitCaseVersion: true });
  await worker.__test__.tick();
  o = await outbox(b.outboxId);
  check(calls.payloads.length === 0 && o.last_error === "BOARDING_CASE_VERSION_MISSING", "an outbox row without a captured case version is refused (fail closed)");
  // (3) The owner policy is part of the verdict: removing it makes the case not ready at dispatch.
  const c = await fixture("policy-removed");
  await removeCertPolicy(db, sql);
  await worker.__test__.tick();
  o = await outbox(c.outboxId);
  check(calls.payloads.length === 0 && o.last_error === "BOARDING_NOT_READY", "negative control: with no recorded owner policy the gates stay unresolved and dispatch is refused");
  const ra = (await auditFor(c.dealId)).find((x) => x.action === "deal_boarding_blocked_not_ready");
  check(ra && JSON.stringify(ra.details).includes("policy_unresolved"), "the unresolved policy gate is the audited blocker");
  await recordCertPolicy(db, sql);

  // (3b) Final-consumption fence: a required condition is reversed AFTER the first dispatch readiness check passed
  //      and BEFORE the pre-dispatch marker. The fence re-evaluates the case under the application lock and refuses.
  await recordCertPolicy(db, sql, { [CERT_PROGRAM]: { requiredDocuments: ["voided_check"], esignRequired: false } }, "cert-policy-fence");
  const fz = await fixture("final-fence");
  await db.execute(sql`INSERT INTO underwriting_conditions (deal_id, condition_type, description, status) VALUES (${fz.dealId}, 'voided_check', 'v', 'approved')`);
  // The case version captured at enqueue must include the approved condition, so re-capture it now.
  const fzVersion = (await evaluateBoardingReadiness(fz.dealId, { includeFieldCompleteness: false })).caseVersion;
  await db.execute(sql`UPDATE deal_boarding_outbox SET payload = jsonb_set(payload, '{readinessCaseVersion}', to_jsonb(${fzVersion}::text)) WHERE id = ${fz.outboxId}`);
  const fenceCalls: Calls = { payloads: [] };
  worker.__test__.setProcessorOverride(() => ({ name: "mock", boardMerchant: async (profile: any) => { fenceCalls.payloads.push(profile); return { success: true, processorApplicationId: "x" }; } } as any));
  // Runs after the dispatch readiness check passed and before the pre-dispatch marker: deterministic, no timing race.
  worker.__test__.setBeforeFinalFence(async () => {
    await db.execute(sql`UPDATE underwriting_conditions SET status = 'pending', reversed_at = now(), updated_at = now() WHERE deal_id = ${fz.dealId}`);
  });
  await worker.__test__.tick();
  worker.__test__.setBeforeFinalFence(null);
  worker.__test__.setProcessorOverride(null);
  o = await outbox(fz.outboxId);
  const fenceAudit = (await auditFor(fz.dealId)).find((x) => x.action === "deal_boarding_blocked_case_changed");
  check(fenceCalls.payloads.length === 0 && o.status === "dead_letter" && o.last_error === "BOARDING_CASE_CHANGED" && fenceAudit?.details?.stage === "final_consumption_fence",
    "a required condition reversed between the readiness check and dispatch is refused at the final fence with no transport");
  await recordCertPolicy(db, sql);

  // (4) Post-provider local failure: the provider accepted, then the local commit fails. The claim must stay
  //     ambiguous (never cleared to a retry) and the provider must not be called again.
  const calls2: Calls = { payloads: [] };
  let markerAtCall: string | null = null;
  const d = await fixture("post-provider-failure");
  worker.__test__.setProcessorOverride(() => ({
    name: "mock",
    boardMerchant: async (profile: any) => {
      calls2.payloads.push(JSON.parse(JSON.stringify(profile)));
      // Real-tick negative control: the fake provider does NOT pre-clear the claim; the durable marker is already set.
      markerAtCall = (await outbox(d.outboxId)).last_error;
      await db.execute(sql`CREATE OR REPLACE FUNCTION s5bw_block_commit() RETURNS trigger AS $$ BEGIN
        IF NEW.processor_application_id IS NOT NULL THEN RAISE EXCEPTION 's5bw simulated local commit failure'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
      await db.execute(sql`CREATE TRIGGER s5bw_block_commit_trg BEFORE UPDATE ON deals FOR EACH ROW WHEN (NEW.id = ${sql.raw(String(d.dealId))}) EXECUTE FUNCTION s5bw_block_commit()`);
      return { success: true, processorApplicationId: `FAKE-APP-${tag}-pf`, status: "submitted", message: "fixture" };
    },
  } as any));
  await worker.__test__.tick();
  await db.execute(sql`DROP TRIGGER IF EXISTS s5bw_block_commit_trg ON deals`);
  await worker.__test__.tick();
  await worker.__test__.tick();
  o = await outbox(d.outboxId);
  const dd = await dealRow(d.dealId);
  check(markerAtCall === "DISPATCH_STARTED", "the dispatch marker was durably set BEFORE the provider call (fake provider did not pre-clear it)");
  check(calls2.payloads.length === 1, "provider called exactly once despite the local commit failure");
  check(o.status === "dead_letter" && o.last_error === "ambiguous_reconciliation_required" && dd.boarding_status === "ambiguous_reconciliation_required",
    "a failure after provider dispatch settles ambiguous (reconciliation required), not a clean retry");
  check(!(await auditFor(d.dealId)).some((x) => x.action === "deal_submitted_to_processor"), "no submitted audit was written for the unsettled outcome");

  // (5) The provider's own acceptance status is persisted (not always 'submitted').
  worker.__test__.setProcessorOverride(() => ({
    name: "mock",
    boardMerchant: async () => ({ success: true, processorApplicationId: `FAKE-APP-${tag}-ur`, status: "under_review", message: "fixture" }),
  } as any));
  const e = await fixture("provider-status");
  await worker.__test__.tick();
  const de = await dealRow(e.dealId);
  check(de.boarding_status === "under_review", "the provider's acceptance status (under_review) is persisted");
  check(JSON.stringify(de.boarding_log).includes('"providerStatus":"under_review"'), "the raw provider status is kept in the submission log");
  worker.__test__.setProcessorOverride(null);
}

// ── S5-06: merchant-application outbox settlement is claim-fenced ──────────
{
  const f = await fixture("appoutbox");
  await db.execute(sql`
    INSERT INTO merchant_application_protected_outbox (application_id, event_type, idempotency_key, payload, status)
    VALUES (${f.appId}, 'risk_scan', ${`s5ao-${tag}`}, '{}'::jsonb, 'pending')`);
  // Isolate this row: drain any other pending rows from earlier fixtures is unnecessary — only this row exists.
  const first = await appWorker.__test__.claimOne();
  check(first && first.applicationId === f.appId, "application outbox row claimed once");
  // Simulate a stale reclaim + takeover: a newer claim owns the row (attempt counter advanced).
  await db.execute(sql`UPDATE merchant_application_protected_outbox SET attempts = attempts + 1 WHERE idempotency_key = ${`s5ao-${tag}`}`);
  check(await appWorker.__test__.markDelivered(first!.id, first!.attempts) === false, "negative control: a stale claim cannot settle delivered over a newer claim");
  await appWorker.__test__.markRetryOrDeadLetter(first!.id, first!.attempts, new Error("late"));
  const row = (((await db.execute(sql`SELECT status, last_error FROM merchant_application_protected_outbox WHERE idempotency_key = ${`s5ao-${tag}`}`)) as any).rows)[0];
  check(row.status === "processing" && row.last_error === null, "a stale claim's late failure cannot reset the newer claim");
  check(await appWorker.__test__.markDelivered(first!.id, first!.attempts + 1) === true, "the current claim settles delivered");
  await db.execute(sql`UPDATE merchant_application_protected_outbox SET status='delivered' WHERE idempotency_key = ${`s5ao-${tag}`}`);
}

// ── No secret in logs, outbox, audit or deal rows ──────────────────────────
{
  const haystack = captured.join("\n")
    + JSON.stringify((((await db.execute(sql`SELECT payload, last_error FROM deal_boarding_outbox WHERE idempotency_key LIKE ${`s5bw-${tag}-%`}`)) as any).rows))
    + JSON.stringify((((await db.execute(sql`SELECT details FROM audit_logs WHERE entity_type='deal' AND entity_id IN (SELECT id FROM deals WHERE name LIKE ${`S5BW ${tag} %`})`)) as any).rows))
    + JSON.stringify((((await db.execute(sql`SELECT boarding_log, boarding_status FROM deals WHERE name LIKE ${`S5BW ${tag} %`}`)) as any).rows));
  for (const [k, v] of Object.entries(SECRETS)) {
    check(!haystack.includes(v), `${k} value never appears in logs, outbox, audit or deal rows`);
  }
}

worker.__test__.setProcessorOverride(null);
(process.stderr as any).write = origErr;
(process.stdout as any).write = origOut;
console.log(`\nStage 5 boarding worker certification: ${checks} checks passed`);
await pool.end();
