/**
 * Stage 5 (S5-09) — underwriting read model certification. Disposable database; real route handlers
 * (middleware chain included); >500 fixtures; count/drill-through agreement; deterministic tie ordering.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { assertDisposableTestInfrastructure } from "../test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary } from "../certification-provider-deny";

await assertDisposableTestInfrastructure({ operation: "Stage 5 underwriting read model certification" });
process.env.VG_PROVIDER_DENY_MODE = "1";
process.env.BACKGROUND_JOB_PROFILE = "off";
applyCertificationProviderDenyBoundary({ fatal: true });

const { db, pool } = await import("../../server/db");
const { sql } = await import("drizzle-orm");
const { registerUnderwritingRoutes } = await import("../../server/routes/underwriting");
const { storage } = await import("../../server/storage");

let checks = 0;
const check = (v: unknown, message: string) => { assert(v, message); checks++; console.log(`✓ [S5-RM-${String(checks).padStart(2, "0")}] ${message}`); };
const tag = crypto.randomBytes(4).toString("hex");
const q = async (s: any) => ((await db.execute(s)) as any).rows as any[];

type H = (req: any, res: any, next?: any) => unknown;
const routes = new Map<string, H[]>();
const cap = (m: string) => (path: string, ...hs: H[]) => { routes.set(`${m} ${path}`, hs); };
registerUnderwritingRoutes({ get: cap("GET"), post: cap("POST"), patch: cap("PATCH"), put: cap("PUT"), delete: cap("DELETE") } as any);
async function get(path: string, query: Record<string, any>, user: any) {
  const chain = routes.get(`GET ${path}`); assert(chain, `route ${path}`);
  const res: any = { code: 200, body: undefined, status(c: number) { this.code = c; return this; }, json(b: unknown) { this.body = b; return this; }, send(b: unknown) { this.body = b; return this; } };
  const req: any = { params: {}, body: {}, query, headers: {}, user, isAuthenticated: () => !!user, session: {} };
  for (const h of chain) { let adv = false; await h(req, res, () => { adv = true; }); if (!adv) break; }
  return res as { code: number; body: any };
}
const admin = { id: crypto.randomUUID(), role: "admin" };
const agent = { id: crypto.randomUUID(), role: "agent" };
const QUEUE = "/api/underwriting/queue", APPROVED = "/api/underwriting/approved-today", STATS = "/api/underwriting/stats";

const baseQ = (await get(QUEUE, { limit: "1" }, admin)).body.total as number;
const baseHold = (await get(QUEUE, { decision: "hold", limit: "1" }, admin)).body.total as number;
const baseStats = (await get(STATS, {}, admin)).body;
const baseApproved = (await get(APPROVED, { limit: "1" }, admin)).body.total as number;

const N_REVIEW = 530, N_HOLD = 5, N_APPROVE_TODAY = 130;
const T = "2020-01-01T00:00:00Z"; // (past, so these never count as today) identical timestamps to prove the id tiebreak and stable paging
const mkDeals = async (count: number, label: string) => (await q(sql`
  INSERT INTO deals (pipeline,stage,name) SELECT 'onboarding','Underwriting', ${`S5RM ${tag} ${label} `} || g FROM generate_series(1, ${count}) g RETURNING id`)).map((r) => Number(r.id));
const reviewDeals = await mkDeals(N_REVIEW, "rev");
const holdDeals = await mkDeals(N_HOLD, "hold");
await db.execute(sql`INSERT INTO underwriting_decisions (deal_id, decision, score, created_at) SELECT unnest(${sql.raw(`ARRAY[${reviewDeals.join(",")}]::int[]`)}), 'review', 10, ${T}::timestamp`);
await db.execute(sql`INSERT INTO underwriting_decisions (deal_id, decision, score, created_at) SELECT unnest(${sql.raw(`ARRAY[${holdDeals.join(",")}]::int[]`)}), 'hold', 5, ${T}::timestamp`);

// Special latest-decision cases (all share created_at = T so only the id decides).
const [dApproveLater, dReviewLater, dOverridden, dSuperseded] = await mkDeals(4, "special");
const ins = (deal: number, decision: string, over?: string) => db.execute(sql`INSERT INTO underwriting_decisions (deal_id, decision, score, created_at, override_action) VALUES (${deal}, ${decision}, 1, ${T}::timestamp, ${over ?? null})`);
await ins(dApproveLater, "review"); await ins(dApproveLater, "approve");            // latest by id = approve → NOT current work
await ins(dReviewLater, "approve"); await ins(dReviewLater, "review");              // latest by id = review → current work
await ins(dOverridden, "review", "approve");                                         // overridden → not current work
await ins(dSuperseded, "hold"); await ins(dSuperseded, "approve");                   // newer approve supersedes the hold
await db.execute(sql`INSERT INTO underwriting_decisions (deal_id, decision, score, created_at) VALUES (NULL, 'review', 1, ${T}::timestamp)`); // orphan: ignored
const expectQueue = N_REVIEW + N_HOLD + 1;

// ── Access ───────────────────────────────────────────────────────────────────
check((await get(QUEUE, {}, agent)).code === 403 && (await get(STATS, {}, agent)).code === 403 && (await get(APPROVED, {}, agent)).code === 403, "agents are refused on all three readers");
check((await get(QUEUE, { decision: "bogus" }, admin)).code === 400, "an unknown decision filter is a 400, not a silent full list");

// ── Count / drill-through agreement and uncapped totals ─────────────────────
const first = (await get(QUEUE, {}, admin)).body;
check(first.total - baseQ === expectQueue, `the queue total is uncapped and exact (+${expectQueue}, beyond the old 200-row cap)`);
const stats = (await get(STATS, {}, admin)).body;
const curNow = stats.current.pendingReview + stats.current.pendingHold;
check(curNow === first.total, "KPI current-work counts equal the queue list total (count and drill-through agree)");
check(stats.current.pendingHold - baseStats.current.pendingHold === N_HOLD && (await get(QUEUE, { decision: "hold", limit: "1" }, admin)).body.total - baseHold === N_HOLD, "the hold KPI equals the hold-filtered drill-through");
check(stats.current.pendingReview - baseStats.current.pendingReview === N_REVIEW + 1, "the review KPI counts the latest-decision cohort (deals, not events)");

// ── Deterministic latest + paging over identical timestamps ─────────────────
check(first.limit === 50 && first.rows.length === 50 && first.hasMore === true, "the default page is 50 rows with hasMore");
check((await get(QUEUE, { limit: "9999" }, admin)).body.limit === 100, "an oversized limit is clamped to 100");
const seen: number[] = [];
let off = 0;
for (;;) {
  const page = (await get(QUEUE, { limit: "100", offset: String(off) }, admin)).body;
  for (const r of page.rows) seen.push(Number(r.deal_id));
  off += page.rows.length;
  if (!page.hasMore || page.rows.length === 0) break;
}
const mine = new Set([...reviewDeals, ...holdDeals, dReviewLater]);
const seenMine = seen.filter((id) => mine.has(id));
check(seen.length === new Set(seen).size, "paging the whole cohort returns no duplicates despite identical timestamps");
check(seenMine.length === expectQueue && new Set(seenMine).size === expectQueue, "paging returns every fixture deal exactly once (>500 rows)");
check(!seen.includes(dApproveLater) && !seen.includes(dOverridden) && !seen.includes(dSuperseded), "deals whose latest decision is approve, or overridden, are not current work");
check(seen.includes(dReviewLater), "a deal whose later-id decision is review IS current work even with an earlier approve at the same timestamp");
const firstHoldIdx = seen.findIndex((id) => holdDeals.includes(id));
const lastHoldIdx = seen.map((id, i) => (holdDeals.includes(id) ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
const firstReviewIdx = seen.findIndex((id) => reviewDeals.includes(id));
check(firstHoldIdx >= 0 && lastHoldIdx < firstReviewIdx, "holds sort ahead of reviews across the whole paged result");
const again = (await get(QUEUE, { limit: "100", offset: "100" }, admin)).body.rows.map((r: any) => r.id);
const again2 = (await get(QUEUE, { limit: "100", offset: "100" }, admin)).body.rows.map((r: any) => r.id);
check(JSON.stringify(again) === JSON.stringify(again2), "the same page is identical on repeat (deterministic order)");

// ── Decision-event history is separate and exact ────────────────────────────
await db.execute(sql`INSERT INTO underwriting_decisions (deal_id, decision, score, created_at) SELECT d, 'approve', 90, now() FROM unnest(${sql.raw(`ARRAY[${(await mkDeals(N_APPROVE_TODAY, "appr")).join(",")}]::int[]`)}) d`);
const approved = (await get(APPROVED, { limit: "100" }, admin)).body;
check(approved.total - baseApproved === N_APPROVE_TODAY && approved.rows.length === 100 && approved.hasMore === true, "approved-today reports the uncapped event total and pages (old cap was 100)");
const stats2 = (await get(STATS, {}, admin)).body;
check(stats2.today.approvedEvents - baseStats.today.approvedEvents === N_APPROVE_TODAY, "the today approval KPI counts approve EVENTS and matches the approved-today total");
const rowTotal = Number((await q(sql`SELECT count(*)::int AS n FROM underwriting_decisions`))[0].n);
check(stats2.history.total === rowTotal && stats2.history.total - baseStats.history.total === N_REVIEW + N_HOLD + 7 + 1 + N_APPROVE_TODAY, "history totals are event rows (fixture rows + orphan + approvals) straight from SQL aggregates");
const legacy = await storage.getUnderwritingStats();
check(legacy.total === rowTotal && legacy.approved === stats2.history.approved && legacy.hold === stats2.history.hold, "the storage stats helper agrees with the read model (aggregate, not a row load)");
check(!/\.select\(\)\s*\.from\(underwritingDecisions\)\s*\.where\(filter/.test(readFileSync("server/storage/underwriting.ts", "utf8")), "the storage stats helper no longer loads every decision row (source-checked)");

// ── Orders/UI contract (source-checked) ─────────────────────────────────────
const ui = readFileSync("client/src/pages/dashboard/Underwriting.tsx", "utf8");
check(/Promise\.all\(\[refetchQueue\(\), retryStats\(\), retryApproved\(\), retryRules\(\)\]\)/.test(ui), "Refresh refetches every reader on the page (source-checked)");
check(!/All deals have been reviewed or auto-approved/.test(ui) && /text-queue-empty/.test(ui), "the empty queue copy no longer claims all deals are approved (source-checked)");
console.log(`\nStage 5 underwriting read model certification: ${checks} checks passed`);
await pool.end();
process.exit(0);
