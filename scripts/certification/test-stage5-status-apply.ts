/**
 * Stage 5 CP4 — versioned atomic status-observation apply (S5-18).
 * Disposable database; real performBoardingStatusRefresh; counting fake adapter (name "mock", NODE_ENV=test seam).
 * No provider contact, no real MID.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { assertDisposableTestInfrastructure } from "../test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary } from "../certification-provider-deny";

await assertDisposableTestInfrastructure({ operation: "Stage 5 status apply certification" });
process.env.NODE_ENV = "test";
process.env.VG_PROVIDER_DENY_MODE = "1";
process.env.BACKGROUND_JOB_PROFILE = "off";
applyCertificationProviderDenyBoundary({ fatal: true });

const { pool, db } = await import("../../server/db");
const { sql } = await import("drizzle-orm");
const boarding = await import("../../server/routes/boarding");

let checks = 0;
const check = (v: unknown, message: string) => { assert(v, message); checks++; console.log(`✓ [S5-SA-${String(checks).padStart(2, "0")}] ${message}`); };
const tag = crypto.randomBytes(4).toString("hex");
const RAW_MID = "889900112233";

let fake: (appId: string) => Promise<any> = async () => { throw new Error("fake not set"); };
let polls = 0;
boarding.__boardingTest__.setStatusProcessorOverride(() => ({
  name: "mock",
  getMerchantStatus: async (appId: string) => { polls++; return fake(appId); },
}));

async function contact(label: string) {
  const r = await db.execute(sql`INSERT INTO contacts (first_name, last_name, email, phone) VALUES ('S5SA', ${label}, ${`s5sa-${tag}-${label}@example.invalid`}, ${`+1305555${String(Math.floor(1000 + Math.random() * 8999))}`}) RETURNING id`);
  return Number(((r as any).rows ?? r)[0].id);
}
async function deal(label: string, o: { status?: string | null; withProcessor?: boolean; withContact?: boolean; pipeline?: string; stage?: string } = {}) {
  const cid = o.withContact === false ? null : await contact(label);
  const logJson = JSON.stringify(o.withProcessor === false ? [] : [{ event: "submitted", processor: "mock", processorApplicationId: `APP-${label}` }]);
  const r = await db.execute(sql`
    INSERT INTO deals (pipeline, stage, name, contact_id, boarding_status, processor_application_id, boarding_log)
    VALUES (${o.pipeline ?? "sales"}, ${o.stage ?? "Underwriting"}, ${`S5SA ${tag} ${label}`}, ${cid}, ${o.status === undefined ? "submitted" : o.status}, ${`APP-${label}`}, ${logJson}::jsonb)
    RETURNING id`);
  return Number(((r as any).rows ?? r)[0].id);
}
const row = async (id: number) => (((await db.execute(sql`SELECT boarding_status, mid, jsonb_array_length(boarding_log) AS n FROM deals WHERE id = ${id}`)) as any).rows)[0];
const audits = async (id: number) => (((await db.execute(sql`SELECT action, details FROM audit_logs WHERE entity_type='deal' AND entity_id=${id} AND action IN ('boarding_status_refreshed','mid_assigned')`)) as any).rows) as any[];
const midRows = async (id: number) => Number((((await db.execute(sql`SELECT count(*)::int AS n FROM merchant_mids WHERE deal_id = ${id}`)) as any).rows)[0].n);

// 1. Plain apply.
{
  const d = await deal("plain");
  fake = async () => ({ success: true, processorApplicationId: "APP-plain", status: "under_review", message: "ok" });
  const r = await boarding.performBoardingStatusRefresh(d);
  const cur = await row(d);
  check(r.outcome === "success" && cur.boarding_status === "under_review" && cur.n === 2, "an observation for the recorded processor applies status and log together");
  check((await audits(d)).filter((a) => a.action === "boarding_status_refreshed").length === 1, "exactly one status audit is written in the same transaction");
}

// 2. Approved with MID: canonical MID + alias + status + audit in one commit.
{
  const d = await deal("approved");
  fake = async () => ({ success: true, processorApplicationId: "APP-approved", status: "approved", mid: RAW_MID });
  await boarding.performBoardingStatusRefresh(d);
  const cur = await row(d);
  check(cur.boarding_status === "approved" && cur.mid === RAW_MID && await midRows(d) === 1, "approved observation commits canonical MID, alias and status together");
  const haystack = JSON.stringify(await audits(d)) + JSON.stringify((((await db.execute(sql`SELECT boarding_log FROM deals WHERE id=${d}`)) as any).rows));
  check(!haystack.includes(RAW_MID), "raw MID never appears in audit or boarding log");
}

// 3. Atomicity: MID assignment fails (no contact) => nothing is applied.
{
  const d = await deal("atomic", { withContact: false });
  fake = async () => ({ success: true, processorApplicationId: "APP-atomic", status: "approved", mid: RAW_MID });
  const before = await row(d);
  const r = await boarding.performBoardingStatusRefresh(d);
  const after = await row(d);
  check(r.outcome === "failed", "a failure inside the apply transaction is reported as failed");
  check(after.boarding_status === before.boarding_status && after.mid === null && await midRows(d) === 0, "negative control: status was NOT moved to approved and no MID exists after the failure");
  check((await audits(d)).length === 0, "no status or MID audit survives the rolled-back apply");
}

// 4. Stale observation: the deal changes between the provider read and the apply.
{
  const d = await deal("stale");
  fake = async () => {
    await db.execute(sql`UPDATE deals SET boarding_status='more_info_needed', boarding_log = boarding_log || '[{"event":"status_check","status":"more_info_needed"}]'::jsonb WHERE id = ${d}`);
    return { success: true, processorApplicationId: "APP-stale", status: "under_review" };
  };
  const r = await boarding.performBoardingStatusRefresh(d);
  const cur = await row(d);
  check(r.outcome === "skipped" && /stale/i.test(r.error ?? ""), "an observation made against an older deal version is ignored");
  check(cur.boarding_status === "more_info_needed" && cur.n === 2 && (await audits(d)).length === 0, "the newer state is untouched and no audit is written");
}

// 5. Terminal truth is preserved.
{
  const d = await deal("terminal", { status: "declined" });
  fake = async () => ({ success: true, processorApplicationId: "APP-terminal", status: "under_review" });
  const r = await boarding.performBoardingStatusRefresh(d);
  check(r.outcome === "skipped" && (await row(d)).boarding_status === "declined" && (await audits(d)).length === 0, "a different observed status never replaces recorded terminal truth");
  fake = async () => ({ success: true, processorApplicationId: "APP-terminal", status: "declined" });
  check((await boarding.performBoardingStatusRefresh(d)).outcome === "success", "control: re-observing the same terminal status is accepted");
}

// 6. Processor identity is never inferred.
{
  const d = await deal("noproc", { withProcessor: false });
  const before = polls;
  const r = await boarding.performBoardingStatusRefresh(d);
  check(r.outcome === "skipped" && polls === before, "a deal with no recorded processor is skipped without calling any adapter (negative control: original defaulted to payarc)");
}

// 7. Barrier: two refreshes read the same version; exactly one applies.
{
  const d = await deal("race");
  let entered = 0;
  let release!: () => void;
  const gate = new Promise<void>((res) => { release = res; });
  fake = async () => { entered++; if (entered === 2) release(); await gate; return { success: true, processorApplicationId: "APP-race", status: "under_review" }; };
  const [a, b] = await Promise.all([boarding.performBoardingStatusRefresh(d), boarding.performBoardingStatusRefresh(d)]);
  const outcomes = [a.outcome, b.outcome].sort();
  check(outcomes[0] === "skipped" && outcomes[1] === "success", "two concurrent refreshes of one version: exactly one applies, the other is ignored as stale");
  const cur = await row(d);
  check(cur.n === 2 && (await audits(d)).filter((x) => x.action === "boarding_status_refreshed").length === 1, "the loser wrote neither a log entry nor an audit");
}

boarding.__boardingTest__.setStatusProcessorOverride(null);
console.log(`\nStage 5 status apply certification: ${checks} checks passed`);
await pool.end();
process.exit(0);
