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
function installFake(mode: "ok" | "ambiguous", calls: Calls) {
  worker.__test__.setProcessorOverride(() => ({
    name: "mock",
    boardMerchant: async (profile: any) => {
      calls.payloads.push(JSON.parse(JSON.stringify(profile)));
      if (mode === "ambiguous") return { success: false, ambiguous: true, error: "fixture ambiguous" };
      return { success: true, processorApplicationId: `FAKE-APP-${tag}-${calls.payloads.length}`, status: "submitted", message: "fixture" };
    },
  } as any));
}

async function fixture(label: string, opts: { omitAccount?: boolean } = {}) {
  const dealRes = await db.execute(sql`
    INSERT INTO deals (pipeline, stage, name, boarding_status)
    VALUES ('onboarding', 'Underwriting', ${`S5BW ${tag} ${label}`}, 'queued') RETURNING id`);
  const dealId = Number(((dealRes as any).rows ?? dealRes)[0].id);
  const appRes = await db.execute(sql`
    INSERT INTO merchant_applications (deal_id, legal_business_name, dba, business_address, business_city, business_state,
      business_zip, owner_first_name, owner_last_name, owner_email, business_phone)
    VALUES (${dealId}, ${`Fixture Legal ${tag} ${label}`}, 'Fixture DBA', '1 Fixture Way', 'Miami', 'FL', '33101',
      'Fixie', 'Tester', 'fixie@example.invalid', '3055550100') RETURNING id`);
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
  const outRes = await db.execute(sql`
    INSERT INTO deal_boarding_outbox (deal_id, application_id, event_type, idempotency_key, processor_name, payload, status)
    VALUES (${dealId}, ${appId}, 'processor_submit', ${`s5bw-${tag}-${label}`}, 'mock',
      ${JSON.stringify({ dealId, applicationId: appId, providerIdempotencyKey: `pik-${label}`, applicationLinkageVersion: v })}::jsonb, 'pending')
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

  // Negative control for the fence: the delivery settlement cannot overwrite a terminal row.
  const settled = await worker.__test__.markDelivered(f.outboxId, Number(o.attempts));
  check(settled === false, "negative control: fenced delivery settlement refuses a terminal dead_letter row");
  check((await outbox(f.outboxId)).status === "dead_letter", "negative control: row unchanged after refused delivery settlement");
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
  const stale = await worker.__test__.markDelivered(f.outboxId, got[0].attempts + 1);
  check(stale === false, "a settlement carrying a stale attempt counter cannot settle the claimed row");
  check(await worker.__test__.markDelivered(f.outboxId, got[0].attempts) === true, "the owning claim can settle delivered");
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
  check(calls.payloads.length === 1, "stale claim reached the adapter (negative control: the ambiguous path actually ran)");
  check(d.boarding_status === "submitted" && !d.boarding_ambiguous_at, "stale ambiguous result does not flip a newer submitted deal back to ambiguous");
  check((await outbox(f.outboxId)).status === "delivered", "stale ambiguous result leaves the newer delivered outbox row alone");
  check(!(await auditFor(f.dealId)).some((a) => a.action === "deal_boarding_ambiguous"), "stale ambiguous result writes no ambiguous audit");
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
