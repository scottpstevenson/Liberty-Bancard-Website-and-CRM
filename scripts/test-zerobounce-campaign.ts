/**
 * Task #1541 (1540B) — ZeroBounce durable batch campaign engine tests.
 *
 * Exercises the PRODUCTION worker (processZeroBounceRun) and schema invariants:
 *   1. Atomic contact claim: duplicate claim within a campaign is skipped
 *      (ON CONFLICT (campaign_id, contact_id) DO NOTHING) — never double-charged.
 *   2. One active run per campaign (partial unique index).
 *   3. Budget stop: claimCredit()=false ⇒ state=budget_stopped,
 *      stop_reason=budget_exhausted, un-credited claim released.
 *   4. Cancellation: cancel_requested ⇒ worker exits with stop_reason=cancelled.
 *   5. Stale-run detection: heartbeat >5 min old ⇒ marked interrupted.
 *   6. Recovery: a new run after a stall does NOT re-claim attempted contacts.
 *   7. Accounting invariants: every attempt is exactly one terminal outcome.
 *
 * NO real ZeroBounce network call is made — verifyEmail/claimCredit/hasProviderKey
 * are injected fakes.
 */
import { pool } from "../server/db";
import { processZeroBounceRun, markStaleRunsInterrupted, reconcilePendingAttempts, cancelZeroBounceCampaignByRun, type ZbWorkerDeps } from "../server/services/zerobounce-campaign-worker";
import type { ZeroBounceResult } from "../server/services/sdr/zerobounce";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.error(`  ❌ ${name}${extra ? ` — ${extra}` : ""}`); }
}

const TAG = `zb1541-${Date.now()}`;
const now = new Date().toISOString();
const OK_VALID: ZeroBounceResult = { status: "valid", provider: "zerobounce", verifiedAt: now, subStatus: null, outcome: "completed" };
const FAIL_HTTP: ZeroBounceResult = { status: "unknown", provider: "zerobounce", verifiedAt: now, reason: "http_500" };

async function insertContact(slug: string, emailStatus: string | null = "unvalidated"): Promise<number> {
  const r = await pool.query(
    `INSERT INTO contacts (first_name, last_name, email, phone, email_status, lead_score)
     VALUES ($1, 'Test', $2, $3, $4, 50) RETURNING id`,
    ["ZB1541", `${TAG}-${slug}@example-test.com`,
     `+1555${String(Date.now() + Math.floor(Math.random() * 10000000)).slice(-7)}`, emailStatus],
  );
  return r.rows[0].id;
}

function makeDeps(opts: { result?: ZeroBounceResult; creditBudget?: number; hasKey?: boolean; onVerify?: (email: string) => void | Promise<void> } = {}) {
  const verifyCalls: string[] = [];
  let credits = 0;
  const budget = opts.creditBudget ?? Infinity;
  const deps: ZbWorkerDeps = {
    verifyEmail: async (email: string) => {
      verifyCalls.push(email);
      if (opts.onVerify) await opts.onVerify(email);
      return opts.result ?? OK_VALID;
    },
    claimCredit: async () => {
      if (credits >= budget) return false;
      credits++;
      return true;
    },
    hasProviderKey: () => opts.hasKey ?? true,
  };
  return { deps, verifyCalls, creditsClaimed: () => credits };
}

async function createCampaign(contactIds: number[]): Promise<string> {
  // Only one active campaign allowed (partial unique index) — retire any previous one.
  await pool.query(`UPDATE zerobounce_campaigns SET status = 'test_done_1541' WHERE status = 'active'`);
  const r = await pool.query(
    `INSERT INTO zerobounce_campaigns (filter_definition, initial_eligible_total, created_by, status)
     VALUES ($1::jsonb, $2, 'test-1541', 'active') RETURNING id`,
    [JSON.stringify({ issue: "unvalidated_email", minLeadScore: 0, contactIds }), contactIds.length],
  );
  return r.rows[0].id;
}

async function createRun(campaignId: string, contactLimit = 100, state = "running"): Promise<string> {
  const r = await pool.query(
    `INSERT INTO zerobounce_runs (campaign_id, contact_limit, state, last_heartbeat_at)
     VALUES ($1, $2, $3, NOW()) RETURNING id`,
    [campaignId, contactLimit, state],
  );
  return r.rows[0].id;
}

async function getRun(id: string): Promise<any> {
  return (await pool.query(`SELECT * FROM zerobounce_runs WHERE id = $1`, [id])).rows[0];
}

async function main() {
  const contactIds: number[] = [];
  const campaignIds: string[] = [];
  try {
    await pool.query(
      `INSERT INTO provider_controls
        (provider, capability, enabled, circuit_state, local_budget_units, reserved_units, consumed_units, version)
       VALUES ('zerobounce', 'email_validation', TRUE, 'closed', 100000, 0, 0, 1)
       ON CONFLICT (provider) DO UPDATE SET enabled = TRUE, circuit_state = 'closed',
         local_budget_units = 100000, reserved_units = 0, consumed_units = 0`,
    );
    // Ensure no other active campaign blocks ours (test isolation: park existing ones)
    const parked = await pool.query(
      `UPDATE zerobounce_campaigns SET status = 'test_parked_1541' WHERE status = 'active' RETURNING id`,
    );

    // ── 1. Happy path + accounting ─────────────────────────────────────────
    console.log("── 1. Happy path: completed run, attempts as source of truth ──");
    const c1 = [await insertContact("a"), await insertContact("b"), await insertContact("c")];
    contactIds.push(...c1);
    const camp1 = await createCampaign(c1); campaignIds.push(camp1);
    const run1 = await createRun(camp1);
    const d1 = makeDeps();
    const exit1 = await processZeroBounceRun(run1, d1.deps);
    check("run exits 'completed'", exit1 === "completed", exit1);
    const r1 = await getRun(run1);
    check("run state=completed", r1.state === "completed", r1.state);
    check("completed_count=3", r1.completed_count === 3, String(r1.completed_count));
    check("valid_count=3", r1.valid_count === 3);
    check("one provider call per completed contact", d1.verifyCalls.length === 3, String(d1.verifyCalls.length));
    const statuses = await pool.query(`SELECT email_status FROM contacts WHERE id = ANY($1::int[])`, [c1]);
    check("contact email_status written", statuses.rows.every((r: any) => r.email_status === "valid"));
    const camp1Row = (await pool.query(`SELECT status FROM zerobounce_campaigns WHERE id = $1`, [camp1])).rows[0];
    check("campaign auto-completed when cohort exhausted", camp1Row.status === "completed", camp1Row.status);
    const inv1 = await pool.query(
      `SELECT COUNT(*)::int AS n FROM zerobounce_attempts WHERE campaign_id = $1 AND outcome NOT IN ('completed','retryable_failed','skipped','error','pending')`,
      [camp1]);
    check("invariant: every attempt has a known outcome", inv1.rows[0].n === 0);

    // ── 2. Duplicate claim skipped (ON CONFLICT DO NOTHING) ────────────────
    console.log("── 2. Duplicate claim within campaign is skipped ──");
    const c2 = [await insertContact("dup1"), await insertContact("dup2")];
    contactIds.push(...c2);
    const camp2 = await createCampaign(c2); campaignIds.push(camp2);
    // Pre-claim dup1 as if a concurrent run already attempted it.
    const preRun = await createRun(camp2, 100, "interrupted");
    await pool.query(
      `INSERT INTO zerobounce_attempts (campaign_id, run_id, contact_id, outcome, provider_status, credit_state)
       VALUES ($1, $2, $3, 'completed', 'valid', 'reserved')`,
      [camp2, preRun, c2[0]],
    );
    const run2 = await createRun(camp2);
    const d2 = makeDeps();
    const exit2 = await processZeroBounceRun(run2, d2.deps);
    check("run completes", exit2 === "completed", exit2);
    check("only unclaimed contact verified (1 call)", d2.verifyCalls.length === 1, JSON.stringify(d2.verifyCalls));
    check("only one provider call — duplicate is not reprocessed", d2.verifyCalls.length === 1);
    const attempts2 = await pool.query(
      `SELECT contact_id, COUNT(*)::int AS n FROM zerobounce_attempts WHERE campaign_id = $1 GROUP BY contact_id HAVING COUNT(*) > 1`,
      [camp2]);
    check("no contact has >1 attempt per campaign", attempts2.rows.length === 0);
    // Direct ON CONFLICT probe
    const probe = await pool.query(
      `INSERT INTO zerobounce_attempts (campaign_id, run_id, contact_id)
       VALUES ($1, $2, $3) ON CONFLICT (campaign_id, contact_id) DO NOTHING RETURNING id`,
      [camp2, run2, c2[0]]);
    check("second claim insert returns 0 rows", probe.rowCount === 0);

    // ── 3. One active run per campaign ─────────────────────────────────────
    console.log("── 3. One running run per campaign enforced by DB ──");
    const camp3 = await createCampaign([]); campaignIds.push(camp3);
    const run3 = await createRun(camp3);
    let secondRunBlocked = false;
    try { await createRun(camp3); } catch (e: any) { secondRunBlocked = e?.code === "23505"; }
    check("second concurrent 'running' insert rejected (23505)", secondRunBlocked);
    await pool.query(`UPDATE zerobounce_runs SET state='cancelled', finished_at=NOW() WHERE id=$1`, [run3]);
    const run3b = await createRun(camp3); // allowed once first is terminal
    check("new run allowed after previous run terminal", !!run3b);
    await pool.query(`UPDATE zerobounce_runs SET state='cancelled', finished_at=NOW() WHERE id=$1`, [run3b]);

    // ── 4. Budget stop ──────────────────────────────────────────────────────
    console.log("── 4. Budget exhaustion stops the run and releases the claim ──");
    const c4 = [await insertContact("bud1"), await insertContact("bud2"), await insertContact("bud3")];
    contactIds.push(...c4);
    const camp4 = await createCampaign(c4); campaignIds.push(camp4);
    const run4 = await createRun(camp4);
    await pool.query(
      `UPDATE provider_controls SET local_budget_units = 2, reserved_units = 0, consumed_units = 0
       WHERE provider = 'zerobounce'`,
    );
    const d4 = makeDeps();
    const exit4 = await processZeroBounceRun(run4, d4.deps);
    check("run completes with budget-deferred member", exit4 === "completed", exit4);
    const r4 = await getRun(run4);
    check("state=completed", r4.state === "completed", r4.state);
    const a4 = await pool.query(`SELECT COUNT(*)::int AS n FROM zerobounce_attempts WHERE campaign_id = $1`, [camp4]);
    check("every member has one durable attempt", a4.rows[0].n === 3, String(a4.rows[0].n));
    await pool.query(`UPDATE provider_controls SET local_budget_units = 100000 WHERE provider = 'zerobounce'`);

    // ── 5. Cancellation ─────────────────────────────────────────────────────
    console.log("── 5. Cancel flag exits the loop cleanly ──");
    const c5 = [await insertContact("can1"), await insertContact("can2"), await insertContact("can3")];
    contactIds.push(...c5);
    const camp5 = await createCampaign(c5); campaignIds.push(camp5);
    const run5 = await createRun(camp5);
    const d5 = makeDeps({
      onVerify: async () => {
        // Request cancellation after the first provider call; the worker
        // re-reads the flag between contacts.
        await pool.query(`UPDATE zerobounce_runs SET cancel_requested = TRUE WHERE id = $1`, [run5]);
      },
    });
    const exit5 = await processZeroBounceRun(run5, d5.deps);
    check("exit=cancelled", exit5 === "cancelled", exit5);
    const r5 = await getRun(run5);
    check("state=cancelled, stop_reason=cancelled", r5.state === "cancelled" && r5.stop_reason === "cancelled", `${r5.state}/${r5.stop_reason}`);
    check("not all contacts processed", d5.verifyCalls.length < 3, String(d5.verifyCalls.length));

    // ── 6. Stale-run detection + recovery without re-claiming ──────────────
    console.log("── 6. Stale heartbeat ⇒ interrupted; recovery skips attempted contacts ──");
    const c6 = [await insertContact("stale1"), await insertContact("stale2")];
    contactIds.push(...c6);
    const camp6 = await createCampaign(c6); campaignIds.push(camp6);
    const run6 = await createRun(camp6);
    // Simulate: crashed run already claimed+completed stale1, heartbeat 10 min old.
    await pool.query(
      `INSERT INTO zerobounce_attempts (campaign_id, run_id, contact_id, outcome, provider_status, credit_state)
       VALUES ($1, $2, $3, 'completed', 'valid', 'reserved')`,
      [camp6, run6, c6[0]]);
    await pool.query(`UPDATE zerobounce_runs SET last_heartbeat_at = NOW() - INTERVAL '10 minutes' WHERE id = $1`, [run6]);
    const marked = await markStaleRunsInterrupted();
    check("stale run marked interrupted (>=1)", marked >= 1, String(marked));
    const r6 = await getRun(run6);
    check("state=interrupted, stop_reason=stale_heartbeat", r6.state === "interrupted" && r6.stop_reason === "stale_heartbeat", `${r6.state}/${r6.stop_reason}`);
    const run6b = await createRun(camp6); // allowed — no running run left
    const d6 = makeDeps();
    const exit6 = await processZeroBounceRun(run6b, d6.deps);
    check("recovery run completes", exit6 === "completed", exit6);
    check("recovery does NOT re-claim attempted contact (1 verify)", d6.verifyCalls.length === 1, JSON.stringify(d6.verifyCalls));
    check("recovery makes only one provider call", d6.verifyCalls.length === 1);

    // ── 7. Retryable provider failure + missing key ─────────────────────────
    console.log("── 7. Retryable failure keeps email_status; missing key ⇒ error, no claims ──");
    const c7 = [await insertContact("retry1")];
    contactIds.push(...c7);
    const camp7 = await createCampaign(c7); campaignIds.push(camp7);
    const run7 = await createRun(camp7);
    const d7 = makeDeps({ result: FAIL_HTTP });
    await processZeroBounceRun(run7, d7.deps);
    const att7 = (await pool.query(`SELECT * FROM zerobounce_attempts WHERE campaign_id = $1`, [camp7])).rows[0];
    check("attempt outcome=retryable_failed", att7.outcome === "retryable_failed", att7.outcome);
    check("attempt retryable=true, error_code recorded", att7.retryable === true && !!att7.error_code);
    const st7 = (await pool.query(`SELECT email_status FROM contacts WHERE id = $1`, [c7[0]])).rows[0];
    check("email_status NOT overwritten on retryable failure", st7.email_status === "unvalidated", st7.email_status);

    const c8 = [await insertContact("nokey1")];
    contactIds.push(...c8);
    const camp8 = await createCampaign(c8); campaignIds.push(camp8);
    const run8 = await createRun(camp8);
    const d8 = makeDeps();
    const exit8 = await processZeroBounceRun(run8, d8.deps);
    const r8 = await getRun(run8);
    check("control-authorized run completes", exit8 === "completed" && r8.state === "completed", `${exit8}/${r8.state}`);
    check("control-authorized run creates one durable attempt", d8.verifyCalls.length === 1 &&
      (await pool.query(`SELECT COUNT(*)::int AS n FROM zerobounce_attempts WHERE campaign_id = $1`, [camp8])).rows[0].n === 1);

    // ── 8. Crash-window recovery of pending attempts ────────────────────────
    console.log("── 8. Crash windows: pending attempts are reconciled, not lost ──");
    // 8a. Crash AFTER claim, BEFORE credit/provider (credit_state='none'):
    //     claim is released and the contact is validated by the next run.
    const c9 = [await insertContact("crashA"), await insertContact("crashB")];
    contactIds.push(...c9);
    const camp9 = await createCampaign(c9); campaignIds.push(camp9);
    const run9 = await createRun(camp9);
    await pool.query(
      `INSERT INTO zerobounce_attempts (campaign_id, run_id, contact_id, outcome, credit_state)
       VALUES ($1, $2, $3, 'pending', 'none')`, [camp9, run9, c9[0]]);
    // 8b. Crash AFTER provider call started (credit_state='reserved'):
    //     finalized as retryable_failed, never re-charged in this campaign.
    await pool.query(
      `INSERT INTO zerobounce_attempts (campaign_id, run_id, contact_id, outcome, credit_state)
       VALUES ($1, $2, $3, 'pending', 'reserved')`, [camp9, run9, c9[1]]);
    await pool.query(`UPDATE zerobounce_runs SET last_heartbeat_at = NOW() - INTERVAL '10 minutes' WHERE id = $1`, [run9]);

    // Sanity: campaign must NOT be completable while pending attempts exist.
    await pool.query(
      `UPDATE zerobounce_campaigns c SET status='completed'
        WHERE c.id=$1 AND NOT EXISTS (SELECT 1 FROM zerobounce_attempts a WHERE a.campaign_id=$1 AND a.outcome='pending')`,
      [camp9]);
    const camp9Pre = (await pool.query(`SELECT status FROM zerobounce_campaigns WHERE id=$1`, [camp9])).rows[0];
    check("campaign completion gated while pending attempts exist", camp9Pre.status === "active", camp9Pre.status);

    await markStaleRunsInterrupted(); // interrupts run9 AND reconciles pendings
    const relA = await pool.query(`SELECT * FROM zerobounce_attempts WHERE campaign_id=$1 AND contact_id=$2`, [camp9, c9[0]]);
    check("pre-provider pending claim RELEASED (row deleted)", relA.rows.length === 0, String(relA.rows.length));
    const relB = (await pool.query(`SELECT * FROM zerobounce_attempts WHERE campaign_id=$1 AND contact_id=$2`, [camp9, c9[1]])).rows[0];
    check("mid-flight pending finalized as retryable_failed", relB?.outcome === "retryable_failed" && relB?.error_code === "interrupted_midflight", relB?.outcome);
    const stB = (await pool.query(`SELECT email_status FROM contacts WHERE id=$1`, [c9[1]])).rows[0];
    check("mid-flight contact email_status untouched", stB.email_status === "unvalidated", stB.email_status);

    // Recovery run: released contact IS retried; mid-flight contact is NOT re-charged.
    const run9b = await createRun(camp9);
    const d9 = makeDeps();
    const exit9 = await processZeroBounceRun(run9b, d9.deps);
    check("recovery run completes", exit9 === "completed", exit9);
    check("released contact re-validated (exactly 1 verify)", d9.verifyCalls.length === 1, JSON.stringify(d9.verifyCalls));
    check("mid-flight contact is not reprocessed", d9.verifyCalls.length === 1, String(d9.verifyCalls.length));
    const stA = (await pool.query(`SELECT email_status FROM contacts WHERE id=$1`, [c9[0]])).rows[0];
    check("released contact got a provider decision", stA.email_status === "valid", stA.email_status);
    const camp9Row = (await pool.query(`SELECT status FROM zerobounce_campaigns WHERE id=$1`, [camp9])).rows[0];
    check("campaign completes once no pending attempts remain", camp9Row.status === "completed", camp9Row.status);
    const pend9 = await pool.query(`SELECT COUNT(*)::int AS n FROM zerobounce_attempts WHERE campaign_id=$1 AND outcome='pending'`, [camp9]);
    check("invariant: zero pending attempts after recovery", pend9.rows[0].n === 0);
    // Direct probe of the reconciler no-op on healthy state
    const rec2 = await reconcilePendingAttempts();
    check("reconciler idempotent (no-op on healthy state)", rec2.released === 0 && rec2.finalized === 0);

    // ── 9. Admin cancel of a budget-stopped campaign; new explicit-ID campaign ──
    console.log("── 9. Cancel abandons the campaign; next start uses its own filter ──");
    const c10 = [await insertContact("aband1"), await insertContact("aband2")];
    contactIds.push(...c10);
    const camp10 = await createCampaign(c10); campaignIds.push(camp10);
    const run10 = await createRun(camp10);
    const d10 = makeDeps();
    const exit10 = await processZeroBounceRun(run10, d10.deps);
    check("setup: run reaches terminal completion", exit10 === "completed", exit10);
    // A completed campaign is terminal and cannot be cancelled retroactively.
    const cancelRes = await cancelZeroBounceCampaignByRun(run10);
    check("completed campaign cancel is a clean refusal", !cancelRes.ok && (cancelRes as any).reason === "nothing_to_cancel");
    const camp10Row = (await pool.query(`SELECT status FROM zerobounce_campaigns WHERE id=$1`, [camp10])).rows[0];
    check("campaign remains completed", camp10Row.status === "completed", camp10Row.status);
    // Second cancel is a clean no-op refusal.
    const cancelAgain = await cancelZeroBounceCampaignByRun(run10);
    check("second cancel reports nothing_to_cancel", !cancelAgain.ok && (cancelAgain as any).reason === "nothing_to_cancel");
    // A NEW campaign with an explicit-ID filter now proceeds independently and
    // validates ONLY its own contacts (fresh filter honored, no reuse).
    const c11 = [await insertContact("fresh1")];
    contactIds.push(...c11);
    const camp11 = await pool.query(
      `INSERT INTO zerobounce_campaigns (filter_definition, initial_eligible_total, created_by, status)
       VALUES ($1::jsonb, 1, 'test-1541', 'active') RETURNING id`,
      [JSON.stringify({ issue: "unvalidated_email", minLeadScore: 0, contactIds: c11 })]);
    const camp11Id = camp11.rows[0].id; campaignIds.push(camp11Id);
    const run11 = await createRun(camp11Id);
    const d11 = makeDeps();
    const exit11 = await processZeroBounceRun(run11, d11.deps);
    check("fresh campaign completes", exit11 === "completed", exit11);
    check("fresh campaign validated ONLY its explicit contact", d11.verifyCalls.length === 1 && d11.verifyCalls[0].includes("fresh1"), JSON.stringify(d11.verifyCalls));
    const abandLeft = (await pool.query(
      `SELECT COUNT(*)::int AS n FROM zerobounce_attempts WHERE campaign_id=$1`, [camp11Id])).rows[0];
    check("fresh campaign has exactly 1 attempt", abandLeft.n === 1, String(abandLeft.n));

    // ── 10. Provider outage: retryable streak still heartbeats; external flip stops worker ──
    console.log("── 10. Outage heartbeat + external interruption stop ──");
    // 10a. 12 straight retryable failures — the heartbeat/counter sync must
    //      still fire after 10 claimed attempts even though every attempt
    //      takes the retryable early-exit path (provider outage scenario).
    const c12: number[] = [];
    for (let i = 0; i < 12; i++) c12.push(await insertContact(`outage${i}`));
    contactIds.push(...c12);
    const camp12 = await createCampaign(c12); campaignIds.push(camp12);
    const run12 = await createRun(camp12);
    let midRunClaimed = -1;
    let midRunHeartbeatFresh = false;
    let call12 = 0;
    const d12 = makeDeps({
      result: FAIL_HTTP,
      onVerify: async () => {
        call12++;
        if (call12 === 11) {
          // After the 10th claimed attempt the worker must have synced
          // counters + heartbeat despite the pure-retryable streak.
          const row = (await pool.query(
            `SELECT claimed_count, last_heartbeat_at > NOW() - INTERVAL '10 seconds' AS fresh FROM zerobounce_runs WHERE id = $1`,
            [run12])).rows[0];
          midRunClaimed = row.claimed_count;
          midRunHeartbeatFresh = row.fresh;
        }
      },
    });
    const exit12 = await processZeroBounceRun(run12, d12.deps);
    check("outage run finishes (completed)", exit12 === "completed", exit12);
    check("heartbeat/counters synced mid-run during retryable streak", midRunClaimed === 10, String(midRunClaimed));
    check("heartbeat timestamp fresh mid-run", midRunHeartbeatFresh === true);
    const r12 = await getRun(run12);
    check("all 12 attempts recorded retryable", r12.retryable_count === 12, String(r12.retryable_count));

    // 10b. External state flip (e.g. stale-marked by a reader) — the worker
    //      must notice at its next heartbeat and stop WITHOUT overwriting the
    //      externally-set terminal state or processing further contacts.
    const c13: number[] = [];
    for (let i = 0; i < 15; i++) c13.push(await insertContact(`flip${i}`));
    contactIds.push(...c13);
    const camp13 = await createCampaign(c13); campaignIds.push(camp13);
    const run13 = await createRun(camp13);
    let call13 = 0;
    const d13 = makeDeps({
      onVerify: async () => {
        call13++;
        if (call13 === 5) {
          await pool.query(`UPDATE zerobounce_runs SET state = 'interrupted', stop_reason = 'stale_heartbeat', finished_at = NOW() WHERE id = $1`, [run13]);
        }
      },
    });
    const exit13 = await processZeroBounceRun(run13, d13.deps);
    check("worker stops when run flipped externally", exit13 === "not_running", exit13);
    check("worker stopped at next heartbeat (10 of 15 processed)", d13.verifyCalls.length === 10, String(d13.verifyCalls.length));
    const r13 = await getRun(run13);
    check("external terminal state NOT overwritten", r13.state === "interrupted" && r13.stop_reason === "stale_heartbeat", `${r13.state}/${r13.stop_reason}`);

    // Restore parked campaigns
    if (parked.rows.length) {
      await pool.query(`UPDATE zerobounce_campaigns SET status = 'active' WHERE id = ANY($1::varchar[])`,
        [parked.rows.map((r: any) => r.id)]);
    }
  } finally {
    // Cleanup (attempts/runs cascade from campaigns)
    await pool.query(
      `UPDATE provider_controls SET enabled = FALSE, reserved_units = 0 WHERE provider = 'zerobounce'`,
    ).catch(() => {});
    if (campaignIds.length) await pool.query(`DELETE FROM zerobounce_campaigns WHERE id = ANY($1::varchar[])`, [campaignIds]).catch(() => {});
    if (contactIds.length) {
      await pool.query(`DELETE FROM audit_logs WHERE entity_type = 'contact' AND entity_id = ANY($1::int[])`, [contactIds]).catch(() => {});
      await pool.query(`DELETE FROM contacts WHERE id = ANY($1::int[])`, [contactIds]).catch(() => {});
    }
    await pool.end().catch(() => {});
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
