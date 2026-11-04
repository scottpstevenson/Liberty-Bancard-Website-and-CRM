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

const { db, pool } = await import("../../server/db");
const { sql } = await import("drizzle-orm");
const { registerUnderwritingRoutes } = await import("../../server/routes/underwriting");

let checks = 0;
const check = (v: unknown, message: string) => { assert(v, message); checks++; console.log(`✓ [S5-OV-${String(checks).padStart(2, "0")}] ${message}`); };
const tag = crypto.randomBytes(4).toString("hex");
const q = async (s: any) => ((await db.execute(s)) as any).rows as any[];

type H = (req: any, res: any, next?: any) => unknown;
const routes = new Map<string, H[]>();
const cap = (m: string) => (path: string, ...hs: H[]) => { routes.set(`${m} ${path}`, hs); };
registerUnderwritingRoutes({ get: cap("GET"), post: cap("POST"), patch: cap("PATCH"), put: cap("PUT"), delete: cap("DELETE") } as any);
async function post(action: "approve" | "reject", id: any, body: any, user: any) {
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
check((await post("approve", dv, { note: "x".repeat(2001) }, admin)).code === 400, "an oversized note is a 400");
check((await post("approve", dv, { note: "ok", overriddenBy: "forged" }, admin)).code === 400, "unknown body fields are rejected (no actor forgery)");
check((await decRow(dvDec)).override_action === null && await stageOf(dv) === "Review In Progress", "rejected requests change nothing");
check((await post("approve", 2147480000, {}, admin)).code === 404, "an unknown deal is a 404");
const dNone = await mkDeal("nodec", "Review In Progress");
check((await post("approve", dNone, {}, admin)).code === 404 && await stageOf(dNone) === "Review In Progress", "a deal without a decision is a 404 and is not moved");

// Happy path: all-or-nothing together
const intentsBefore = await intents(dv);
const ok = await post("approve", dv, { note: "looks fine" }, admin);
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
const rj = await post("reject", dRej, { note: "rescind" }, admin);
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

const src = readFileSync("server/routes/underwriting.ts", "utf8");
check(!/overrideUnderwritingDecision/.test(src), "the route no longer performs the non-atomic override + separate stage advance (source-checked)");
console.log(`\nStage 5 underwriting override certification: ${checks} checks passed`);
await pool.end();
process.exit(0);
