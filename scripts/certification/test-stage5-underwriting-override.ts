/**
 * Stage 5 (S5-08 remainder) — atomic manual underwriting override. Disposable DB; REAL route handlers
 * (middleware chain included). Negative controls: illegal transition, injected audit failure, concurrent calls.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { assertDisposableTestInfrastructure } from "../test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary } from "../certification-provider-deny";

await assertDisposableTestInfrastructure({ operation: "Stage 5 underwriting override certification" });
process.env.VG_PROVIDER_DENY_MODE = "1";
process.env.BACKGROUND_JOB_PROFILE = "off";
applyCertificationProviderDenyBoundary({ fatal: true });
// A configured (dummy) GHL so the pause gate, not "not configured", decides the task outcome. No network is reachable.
process.env.GHL_PRIVATE_INTEGRATION_TOKEN = "cert-dummy-token";
process.env.GHL_LOCATION_ID = "cert-dummy-location";

const { db, pool } = await import("../../server/db");
const { sql } = await import("drizzle-orm");
const { registerUnderwritingRoutes } = await import("../../server/routes/underwriting");
const { decisionRevisionSql } = await import("../../server/services/underwriting-read-model");
const { dispatchDealStageEffectIntents } = await import("../../server/services/deal-stage-effect-worker");

let checks = 0;
const check = (v: unknown, message: string) => { assert(v, message); checks++; console.log(`✓ [S5-OV-${String(checks).padStart(2, "0")}] ${message}`); };
const tag = crypto.randomBytes(4).toString("hex");
const q = async (s: any) => ((await db.execute(s)) as any).rows as any[];

type H = (req: any, res: any, next?: any) => unknown;
const routes = new Map<string, H[]>();
const cap = (m: string) => (path: string, ...hs: H[]) => { routes.set(`${m} ${path}`, hs); };
registerUnderwritingRoutes({ get: cap("GET"), post: cap("POST"), patch: cap("PATCH"), put: cap("PUT"), delete: cap("DELETE") } as any);
/** What a reviewer saw: the latest decision id + revision. Autofilled unless the test supplies its own. */
const seen = async (deal: number) => {
  const r = (await q(sql.raw(`SELECT latest.id, ${decisionRevisionSql("latest")} AS revision FROM underwriting_decisions latest WHERE latest.deal_id = ${Number(deal)} ORDER BY latest.created_at DESC NULLS LAST, latest.id DESC LIMIT 1`))) [0];
  return r ? { expectedDecisionId: Number(r.id), expectedRevision: String(r.revision) } : { expectedDecisionId: 1, expectedRevision: "x".repeat(8) };
};
async function post(action: "approve" | "reject", id: any, rawBody: any, user: any) {
  const body = { ...(Number.isInteger(Number(id)) ? await seen(Number(id)) : {}), reason: "reviewed", commandId: crypto.randomUUID(), ...rawBody };
  const chain = routes.get(`POST /api/underwriting/deals/:id/${action}`); assert(chain);
  const res: any = { code: 200, body: undefined, status(c: number) { this.code = c; return this; }, setHeader() { return this; }, json(b: unknown) { this.body = b; return this; }, send(b: unknown) { this.body = b; return this; } };
  const req: any = { params: { id: String(id) }, body, query: {}, headers: {}, user, isAuthenticated: () => !!user, session: {} };
  for (const h of chain) { let adv = false; await h(req, res, () => { adv = true; }); if (!adv) break; }
  return res as { code: number; body: any };
}
const admin = { id: crypto.randomUUID(), role: "admin" };
const agent = { id: crypto.randomUUID(), role: "agent" };

const mkDeal = async (l: string, stage: string, pipeline = "sales") =>
  Number((await q(sql`INSERT INTO deals (pipeline,stage,name) VALUES (${pipeline},${stage},${`S5OV ${tag} ${l}`}) RETURNING id`))[0].id);
const mkDec = async (deal: number, decision: string, at = "2020-01-01T00:00:00Z") =>
  Number((await q(sql`INSERT INTO underwriting_decisions (deal_id,decision,score,created_at) VALUES (${deal},${decision},10,${at}::timestamp) RETURNING id`))[0].id);
const stageOf = async (d: number) => String((await q(sql`SELECT stage FROM deals WHERE id=${d}`))[0].stage);
const decRow = async (id: number) => (await q(sql`SELECT * FROM underwriting_decisions WHERE id=${id}`))[0];
const audits = async (d: number, action: string) => Number((await q(sql`SELECT count(*)::int n FROM audit_logs WHERE entity_type='deal' AND entity_id=${d} AND action=${action}`))[0].n);
const intents = async (d: number) => Number((await q(sql`SELECT count(*)::int n FROM deal_stage_effect_intents WHERE deal_id=${d}`))[0].n);

// Access / validation
const dv = await mkDeal("val", "Review In Progress"); const dvDec = await mkDec(dv, "hold");
check((await post("approve", dv, {}, agent)).code === 403, "an agent cannot approve");
check((await post("approve", dv, {}, null)).code === 401, "an unauthenticated caller cannot approve");
check((await post("approve", "abc", {}, admin)).code === 400, "a non-numeric deal id is a 400");
check((await post("approve", dv, { reason: "x".repeat(2001) }, admin)).code === 400, "an oversized reason is a 400");
check((await post("approve", dv, { reason: "ok", overriddenBy: "forged" }, admin)).code === 400, "unknown body fields are rejected (no actor forgery)");
check((await decRow(dvDec)).override_action === null && await stageOf(dv) === "Review In Progress", "rejected requests change nothing");
check((await post("approve", 2147480000, {}, admin)).code === 404, "an unknown deal is a 404");
const dNone = await mkDeal("nodec", "Review In Progress");
check((await post("approve", dNone, {}, admin)).code === 404 && await stageOf(dNone) === "Review In Progress", "a deal without a decision is a 404 and is not moved");

// Happy path: all-or-nothing together
const intentsBefore = await intents(dv);
const ok = await post("approve", dv, { reason: "looks fine" }, admin);
const d1 = await decRow(dvDec);
check(ok.code === 200 && ok.body.stageMoved === true, "approve succeeds and reports the stage move");
check(d1.override_action === "approve" && d1.overridden_by === admin.id && d1.override_note === "looks fine" && d1.overridden_at, "the decision records the server-derived actor, note and time");
check(await stageOf(dv) === "Proposal Sent", "the deal moved to Proposal Sent");
check(await audits(dv, "underwriting_manual_approve") === 1, "exactly one approve audit row was written");
check(await intents(dv) > intentsBefore, "the stage move recorded its durable effect intents in the same commit");

// Replay
const again = await post("approve", dv, {}, admin);
check(again.code === 409 && again.body.code === "already_overridden", "a second override of the same decision is a 409");
check((await post("reject", dv, {}, admin)).code === 409 && await stageOf(dv) === "Proposal Sent" && await audits(dv, "underwriting_manual_reject") === 0, "a reject after an approve does not flip the stage or audit");

// Negative control: illegal transition rolls EVERYTHING back (old code left the decision overridden)
const dIll = await mkDeal("illegal", "Closed Won"); const dIllDec = await mkDec(dIll, "review");
const ill = await post("approve", dIll, {}, admin);
check(ill.code === 409 && ill.body.code === "illegal_stage_transition", "an illegal stage move is a clear 409");
check((await decRow(dIllDec)).override_action === null && await stageOf(dIll) === "Closed Won" && await audits(dIll, "underwriting_manual_approve") === 0, "the decision is NOT left overridden when the stage cannot move (atomic rollback)");

// Negative control: injected failure on the audit insert rolls back decision + stage
const dFail = await mkDeal("fault", "Review In Progress"); const dFailDec = await mkDec(dFail, "hold");
await db.execute(sql.raw(`CREATE OR REPLACE FUNCTION s5ov_fail_${tag}() RETURNS trigger AS $$ BEGIN IF NEW.entity_id = ${dFail} AND NEW.action = 'underwriting_manual_approve' THEN RAISE EXCEPTION 's5ov injected'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`));
await db.execute(sql.raw(`CREATE TRIGGER s5ov_fail_${tag} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION s5ov_fail_${tag}()`));
const origErr = console.error; console.error = () => {};
let fault: { code: number; body: any };
try { fault = await post("approve", dFail, {}, admin); } finally { console.error = origErr; await db.execute(sql.raw(`DROP TRIGGER IF EXISTS s5ov_fail_${tag} ON audit_logs`)); await db.execute(sql.raw(`DROP FUNCTION IF EXISTS s5ov_fail_${tag}()`)); }
check(fault!.code >= 500, "an injected audit failure surfaces as a server error");
check((await decRow(dFailDec)).override_action === null && await stageOf(dFail) === "Review In Progress" && await intents(dFail) === 0, "decision, stage and effect intents all rolled back together");
check((await post("approve", dFail, {}, admin)).code === 200 && await stageOf(dFail) === "Proposal Sent", "the same override succeeds once the fault is removed (nothing was half-applied)");

// Concurrency: barrier of approve/reject/approve on one deal → exactly one winner
const dRace = await mkDeal("race", "Review In Progress"); const dRaceDec = await mkDec(dRace, "hold");
const results = await Promise.all([post("approve", dRace, {}, admin), post("reject", dRace, {}, admin), post("approve", dRace, {}, admin), post("approve", dRace, {}, admin)]);
const wins = results.filter((r) => r.code === 200), losses = results.filter((r) => r.code === 409);
check(wins.length === 1 && losses.length === 3, "concurrent overrides produce exactly one winner and 409 for the rest");
const total = (await audits(dRace, "underwriting_manual_approve")) + (await audits(dRace, "underwriting_manual_reject"));
check(total === 1 && (await decRow(dRaceDec)).override_action !== null, "exactly one audit row and one recorded override for the contested decision");

// Reject path
const dRej = await mkDeal("reject", "Proposal Sent"); const dRejDec = await mkDec(dRej, "approve");
const rj = await post("reject", dRej, { reason: "rescind" }, admin);
check(rj.code === 200 && await stageOf(dRej) === "Review In Progress" && (await decRow(dRejDec)).override_action === "reject" && await audits(dRej, "underwriting_manual_reject") === 1, "reject rescinds an approval: decision, stage and audit move together");

// Deterministic latest: equal timestamps → the higher id is overridden
const dTie = await mkDeal("tie", "Review In Progress");
const lo = await mkDec(dTie, "review"), hi = await mkDec(dTie, "hold");
check((await post("approve", dTie, {}, admin)).code === 200 && (await decRow(hi)).override_action === "approve" && (await decRow(lo)).override_action === null, "with equal timestamps the override targets the highest-id decision deterministically");

// Latest, not stale: an older decision with an earlier timestamp is never touched.
const dOld = await mkDeal("older", "Review In Progress");
const oldDec = await mkDec(dOld, "review", "2020-01-01T00:00:00Z"), newDec = await mkDec(dOld, "hold", "2021-01-01T00:00:00Z");
check((await post("approve", dOld, {}, admin)).code === 200 && (await decRow(newDec)).override_action === "approve" && (await decRow(oldDec)).override_action === null, "the override targets the latest decision and leaves the older one untouched");
check((await post("reject", dOld, {}, admin)).code === 409 && (await decRow(newDec)).override_action === "approve" && await stageOf(dOld) === "Proposal Sent", "a repeat or opposite command on the same decision is a 409 and changes nothing");

// Negative control: the original shape (unlocked read, then unconditional write) lets two reviewers both act
// when released together, proving the barrier exposes the race the transaction closes.
{
  const dNaive = await mkDeal("naive", "Review In Progress"); const dNaiveDec = await mkDec(dNaive, "hold");
  let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
  const naive = [0, 1].map(async (i) => {
    await gate;
    const row = (await q(sql`SELECT id, override_action FROM underwriting_decisions WHERE deal_id=${dNaive} ORDER BY created_at DESC LIMIT 1`))[0];
    await new Promise((r) => setTimeout(r, 150));
    if (row.override_action) return false;
    await db.execute(sql`UPDATE underwriting_decisions SET override_action='approve', overridden_by=${`naive-${i}`} WHERE id=${row.id}`);
    return true;
  });
  release();
  check((await Promise.all(naive)).every(Boolean) && (await decRow(dNaiveDec)).override_action === "approve", "negative control: an unlocked read-then-write lets two reviewers both act on one decision");
}

// ── R06: expected decision/revision, reason, command identity, durable follow-ons, scope ────────────────────
{
  const dS = await mkDeal("stale", "Review In Progress"); const decS = await mkDec(dS, "hold");
  const was = await seen(dS);
  const newer = await mkDec(dS, "review", "2021-06-01T00:00:00Z");
  const st = await post("approve", dS, { ...was }, admin);
  check(st.code === 409 && st.body.code === "stale_review" && (await decRow(decS)).override_action === null && (await decRow(newer)).override_action === null && await stageOf(dS) === "Review In Progress" && await audits(dS, "underwriting_manual_approve") === 0 && await intents(dS) === 0,
    "an override of a decision that is no longer the latest is a stale_review 409 with no local change");
  const dR = await mkDeal("rule", "Review In Progress"); await mkDec(dR, "hold");
  const seenR = await seen(dR);
  await db.execute(sql`UPDATE underwriting_decisions SET rules_snapshot = '{"minMonthlyVolume":1}'::jsonb WHERE deal_id = ${dR}`);
  const sr = await post("approve", dR, { ...seenR }, admin);
  check(sr.code === 409 && sr.body.code === "stale_review" && await stageOf(dR) === "Review In Progress", "a changed rules/input revision is a stale_review 409 even for the same decision id");
  check((await post("approve", dR, {}, admin)).code === 200, "reviewing again with the current revision succeeds");

  const dM = await mkDeal("missing", "Review In Progress"); await mkDec(dM, "hold");
  check((await post("approve", dM, { reason: "" }, admin)).code === 400 && (await post("approve", dM, { reason: "ab" }, admin)).code === 400, "an override without a real reason is a 400");
  const raw = { ...(await seen(dM)), commandId: crypto.randomUUID() };
  check((await post("approve", dM, { expectedDecisionId: undefined, expectedRevision: undefined }, admin)).code === 400 && (await post("approve", dM, { commandId: "not-a-uuid" }, admin)).code === 400, "a missing decision/revision or a non-UUID command id is a 400");
  check(await stageOf(dM) === "Review In Progress", "invalid requests change nothing");

  // Command identity / replay
  const dC = await mkDeal("replay", "Review In Progress"); const decC = await mkDec(dC, "hold");
  const cid = crypto.randomUUID(); const exp = await seen(dC);
  const first = await post("approve", dC, { ...exp, commandId: cid }, admin);
  const intAfter = await intents(dC);
  const replay = await post("approve", dC, { ...exp, commandId: cid }, admin);
  check(first.code === 200 && first.body.replayed === false && replay.code === 200 && replay.body.replayed === true && replay.body.decision.id === decC, "the same command id replays the saved outcome (200, replayed)");
  check(await audits(dC, "underwriting_manual_approve") === 1 && await intents(dC) === intAfter && await stageOf(dC) === "Proposal Sent", "a replay adds no audit row, no effect intent and no stage move");
  const reuse = await post("reject", dC, { ...exp, commandId: cid }, admin);
  check(reuse.code === 409 && reuse.body.code === "command_id_reused", "a command id cannot be reused for a different override");

  // Durable follow-ons
  const fo = (await q(sql`SELECT effect_type, state FROM deal_stage_effect_intents WHERE deal_id = ${dC} AND transition_key = ${`underwriting_override:${decC}:approve`}`));
  check(fo.length === 1 && fo[0].effect_type === "underwriting_override_ghl_task" && fo[0].state === "pending" && first.body.followOns.state === "queued", "approval records a durable GHL-task intent in the override commit and reports it queued (not done)");
  const ct = Number((await q(sql`INSERT INTO contacts (first_name,last_name,email,phone) VALUES ('S5OV','Rej',${`s5ov-${tag}@example.invalid`},${`+1305559${String(Math.floor(1000 + Math.random() * 8999))}`}) RETURNING id`))[0].id);
  await db.execute(sql`UPDATE contacts SET ghl_contact_id = ${`ghl-s5ov-${tag}`} WHERE id = ${ct}`);
  const dJ = await mkDeal("reject-fo", "Proposal Sent"); await db.execute(sql`UPDATE deals SET contact_id = ${ct} WHERE id = ${dJ}`); const decJ = await mkDec(dJ, "approve");
  const rj2 = await post("reject", dJ, { reason: "rescind it" }, admin);
  const types = (await q(sql`SELECT effect_type FROM deal_stage_effect_intents WHERE deal_id = ${dJ} AND transition_key = ${`underwriting_override:${decJ}:reject`} ORDER BY effect_type`)).map((r) => r.effect_type);
  check(rj2.code === 200 && types.join() === "underwriting_override_ghl_task,underwriting_reject_notification", "a rejection records both the notification and the GHL-task intents");
  // Park unrelated intents so the cert never reaches a provider, then run the worker under the (persisted) pause.
  await db.execute(sql`UPDATE deal_stage_effect_intents SET state = 'cert_parked' WHERE state IN ('pending','retryable') AND effect_type NOT IN ('underwriting_override_ghl_task','underwriting_reject_notification')`);
  await dispatchDealStageEffectIntents(200);
  const after = await q(sql`SELECT effect_type, state, attempts, last_error, result FROM deal_stage_effect_intents WHERE deal_id = ${dJ} AND transition_key = ${`underwriting_override:${decJ}:reject`}`);
  const ghl = after.find((r) => r.effect_type === "underwriting_override_ghl_task"), note = after.find((r) => r.effect_type === "underwriting_reject_notification");
  check(note.state === "succeeded" && Number((await q(sql`SELECT count(*)::int n FROM notifications WHERE recipient_id = ${admin.id} AND metadata->>'decisionId' = ${String(decJ)}`))[0].n) === 1, "the reject notification is delivered by the worker exactly once, to the real actor");
  check(ghl.state === "retryable" && Number(ghl.attempts) === 0 && String(ghl.last_error).startsWith("effect_deferred:") , "under the persisted pause the GHL task is deferred without burning an attempt or claiming a receipt");
  check(Number((await q(sql`SELECT count(*)::int n FROM deal_stage_effect_receipts r JOIN deal_stage_effect_intents i ON i.id = r.effect_intent_id WHERE i.deal_id = ${dJ} AND i.effect_type = 'underwriting_override_ghl_task'`))[0].n) === 0, "no receipt exists for the deferred GHL task (nothing crossed the provider boundary)");

  // Scope: archived / QA / closed-lost deals are not underwriting work
  const dA = await mkDeal("arch", "Review In Progress"); const decA = await mkDec(dA, "hold");
  await db.execute(sql`UPDATE deals SET archived_at = now() WHERE id = ${dA}`);
  const ar = await post("approve", dA, {}, admin);
  check(ar.code === 409 && ar.body.code === "deal_out_of_scope" && (await decRow(decA)).override_action === null, "an archived deal cannot be overridden");
  const dQ = await mkDeal("qa", "Review In Progress"); await mkDec(dQ, "hold");
  await db.execute(sql`UPDATE deals SET record_class = 'test' WHERE id = ${dQ}`);
  check((await post("approve", dQ, {}, admin)).body?.code === "deal_out_of_scope", "a QA deal cannot be overridden");

  // Retired evaluate route: stable, authenticated, performs nothing
  const ev = routes.get("POST /api/underwriting/deals/:id/evaluate"); assert(ev, "evaluate route stays registered");
  const evRes: any = { code: 200, body: undefined, status(c: number) { this.code = c; return this; }, json(b: unknown) { this.body = b; return this; } };
  for (const h of ev) { let adv = false; await h({ params: { id: String(dS) }, body: {}, query: {}, headers: {}, user: admin, isAuthenticated: () => true, session: {} }, evRes, () => { adv = true; }); if (!adv) break; }
  check(evRes.code === 410 && evRes.body.code === "UNDERWRITING_EVALUATE_RETIRED" && evRes.body.performed === false, "the retired evaluate route returns a stable 410 and performs nothing");
  const evAgent: any = { code: 200, body: undefined, status(c: number) { this.code = c; return this; }, json(b: unknown) { this.body = b; return this; }, send(b: unknown) { this.body = b; return this; } };
  for (const h of ev) { let adv = false; await h({ params: { id: String(dS) }, body: {}, query: {}, headers: {}, user: agent, isAuthenticated: () => true, session: {} }, evAgent, () => { adv = true; }); if (!adv) break; }
  check(evAgent.code === 403, "an agent gets 403 from the retired evaluate route");
}

const src = readFileSync("server/routes/underwriting.ts", "utf8");
check(!/overrideUnderwritingDecision/.test(src), "the route no longer performs the non-atomic override + separate stage advance (source-checked)");
console.log(`\nStage 5 underwriting override certification: ${checks} checks passed`);
await pool.end();
process.exit(0);
