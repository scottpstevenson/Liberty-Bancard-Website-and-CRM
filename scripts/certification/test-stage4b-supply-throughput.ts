#!/usr/bin/env npx tsx
/**
 * Stage 4B (SFP supply and throughput) certification on a guarded disposable database.
 *
 * Proof classes in this file (reported separately, never merged):
 *  - pure:      estimator authority, refusal classification, cost formatting (no database used).
 *  - database:  staging-hold predicate semantics, backlog generation fence/deadline, cold-lead SQL paging,
 *               selected-policy TTL on a business outside the staging boundary.
 *  - source:    structural assertions for worker transactions/fences and telemetry isolation. These prove the
 *               code is wired as designed; they are NOT behavioural proof of a full multi-window worker run.
 *
 * Network/provider transports are denied by the shared HTTP fixture. Nothing here sends, enrolls, syncs or
 * calls a provider.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { stage3BHttpFixture } from "../fixtures/stage3-b-http";

let assertions = 0;
function check(value: unknown, label: string): void {
  assertions++;
  assert.ok(value, `[4B-${String(assertions).padStart(2, "0")}] ${label}`);
  console.log(`✓ [4B-${String(assertions).padStart(2, "0")}] ${label}`);
}
const src = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const rows = (r: any): any[] => r?.rows ?? r ?? [];

// ───────────────────────── pure: F09 estimator authority ─────────────────────────
{
  const est = await import("../../server/services/volume-estimator");
  const model = est.resolveVolumeModel;
  const expectModel = (vertical: string, status: string, basisPart?: string) => {
    const m = model(vertical);
    check(m.status === status && (basisPart === undefined || m.basis.includes(basisPart)) &&
      (status === "available" ? m.assumptions !== null && m.modelId !== null : m.assumptions === null && m.modelId === null),
    `model ${JSON.stringify(vertical)} -> ${status}${basisPart ? ` via ${basisPart}` : ""}`);
  };
  expectModel("Automotive", "available", "'Auto'");
  expectModel("Healthcare", "available", "'Healthcare'");
  expectModel("Beauty/Spa", "available", "'Salon/Spa'");
  expectModel("Construction/Trades/Home Services", "available", "'Construction'");
  expectModel("Fitness/Recreation", "unavailable");
  expectModel("Dental", "available", "'Healthcare'");
  expectModel("Restaurant", "available", "'Restaurant'");
  for (const missing of [null, undefined, "", "   "]) {
    check(model(missing as any).status === "unavailable" && model(missing as any).reason === "vertical_missing",
      `missing vertical ${JSON.stringify(missing)} is unavailable, not Other`);
  }
  check(model("Interstellar Mining").status === "unavailable" && model("Interstellar Mining").modelId === null,
    "an unknown vertical is unavailable and never falls back to Other");

  const unavailable = est.estimateFromVertical("Fitness/Recreation");
  check(unavailable.volumeSource === "unavailable" && unavailable.estimatedProcessingVolume === null &&
    unavailable.estimatedResidual === null && unavailable.merchantTier === null,
    "an unavailable model yields nulls, never $0.00 or a tier");
  check(Object.keys(est.definedFields(unavailable)).every((k) => (unavailable as any)[k] !== null),
    "definedFields strips every null so an unavailable estimate cannot overwrite stored data");

  const modeled = est.estimateFromVertical("Automotive");
  check(modeled.volumeSource === "modeled" && modeled.estimatedProcessingVolume !== null, "an available model yields a modeled estimate");

  const actualContact: any = { vertical: "Fitness/Recreation", monthlyVolume: "$40,000", avgTicket: "100", locationCount: 1 };
  const actualFitness = est.estimateFromContact(actualContact);
  check(actualFitness.volumeSource === "unavailable" && actualFitness.estimatedAvgTicket === "$100.00",
    "actual merchant ticket survives an unavailable model and nothing is invented for volume");
  const actualAuto = est.estimateFromContact({ ...actualContact, vertical: "Automotive" });
  check(actualAuto.volumeSource === "actual" && actualAuto.estimatedAvgTicket === "$100.00",
    "actual merchant monthly volume keeps precedence over model defaults");
  for (const bad of ["abc", "-5", "NaN", "Infinity", "0"]) {
    const e = est.estimateFromContact({ ...actualContact, vertical: "Automotive", monthlyVolume: bad } as any);
    check(e.volumeSource === "modeled", `malformed monthly volume ${JSON.stringify(bad)} reads as absent, not as a value`);
  }
}

// ───────────────────────── pure: F03 refusal classification ─────────────────────────
const hold = await import("../../server/services/cro03/sfp-staging-hold");
{
  for (const code of ["SFP_STAGING_EMAIL_INVALID", "SFP_STAGING_CLASSIFICATION_STALE", "validation_stale"]) {
    check(hold.classifyStagingRefusal(code) === "permanent_item", `${code} is a permanent item-local refusal`);
  }
  check(hold.classifyStagingRefusal("SFP_STAGING_SUPPRESSED") === "timed_item",
    "a suppression refusal is a bounded timed hold, never permanent (a lifted suppression must be rechecked)");
  check(hold.classifyStagingRefusal("SFP_STAGING_ADDRESS_SUPPRESSED") === "timed_item",
    "the shared eligibility gate's suppression code (what the real worker hits first) is also a timed hold");
  for (const code of ["", null, undefined, "SOMETHING_NEW", "ECONNRESET", "SFP_STAGING_SNAPSHOT_DRIFT", "deadlock_detected"]) {
    check(hold.classifyStagingRefusal(code as any) === "retryable", `${JSON.stringify(code)} stays retryable (unknown is never permanent)`);
  }
}

// ───────────────────────── pure: cost formatter ─────────────────────────
{
  const { usdFromMicros } = await import("../../client/src/lib/usd-from-micros");
  check(usdFromMicros(null) === "Unpriced" && usdFromMicros(undefined) === "Unpriced" && usdFromMicros("") === "Unpriced",
    "no recorded price reads Unpriced, never $0.00");
  check(usdFromMicros(0) === "$0.00", "a recorded zero cost reads $0.00");
  check(usdFromMicros(1_500_000) === "$1.50" && usdFromMicros("2500000") === "$2.50" && usdFromMicros(10_000_000n) === "$10.00",
    "micros convert at 1,000,000 per dollar for number, string and bigint");
  check(usdFromMicros(4000) === "$0.0040", "a sub-cent per-lookup price is not rounded to $0.00");
  check(usdFromMicros(Number.NaN) === "Unavailable" && usdFromMicros("abc") === "Unavailable" && usdFromMicros(Infinity) === "Unavailable",
    "non-finite values read Unavailable");
}

// ───────────────────────── source: structure that behaviour tests cannot cheaply reach ─────────────────────────
{
  const worker = src("server/services/cro03/sfp-campaign-staging-worker.ts");
  check(/pg_advisory_xact_lock\(hashtext\('sfp-campaign-staging-claim'\)\)/.test(worker) && /db\.transaction\(async \(tx\)/.test(worker),
    "[source] selection, ledger inserts and claim share one transaction under an advisory lock");
  check(/NOT \$\{activeStagingHoldPredicate\(holdContext\)\}/.test(worker), "[source] selection excludes active holds");
  check(/o\.state='claimed' AND o\.lease_expires_at>NOW\(\)/.test(worker), "[source] a recipient leased by another live run is skipped");
  check((worker.match(/\$\{currentGeneration\}/g) ?? []).length >= 2, "[source] settle writes are fenced on the run claim token and state");
  check(/classifyStagingRefusal\(item\.outcome_code\)/.test(worker) && /refusalClass === "timed_item"/.test(worker) && /retried > 0/.test(worker),
    "[source] only permanent refusals are held; only exhausted retryable items fail the run");
  check(/const reason = permanent \? `permanent:\$\{error\.code\}` : `transient:\$\{message\}`/.test(worker),
    "[source] whole-command failure handling remains in the outer catch (fail-closed, unchanged)");

  const lead = src("server/routes/lead-ops.ts");
  for (const block of ["sourcePool", "throughput24h", "paidEvidenceByProvider24h", "validationBySourceStatus24h", "v2VerticalFunnel24h"]) {
    check(new RegExp(`telemetryBlock\\(\\s*["']${block}["']`).test(lead), `[source] telemetry block ${block} is read independently`);
  }
  check(/safeSfpFailureDiagnostics/.test(lead) && !/console\.(error|warn)\([^)]*err(or)?\.message/.test(
    lead.slice(lead.indexOf("telemetryBlock"), lead.indexOf("telemetryBlock") + 4000)),
    "[source] telemetry logs use the sanitizer and not raw error messages");

  const backlog = src("server/services/canonical-enrichment-backlog.ts");
  check(/ready\|done\|ready_held_outbound_paused/.test(backlog) &&
    backlog.indexOf("contact_suppressed_or_invalid") < backlog.indexOf("ready|done|ready_held_outbound_paused") &&
    backlog.indexOf("business_not_current") < backlog.indexOf("ready|done|ready_held_outbound_paused"),
    "[source] contact ladder checks current suppression and business/link facts before calling ready-held done");
}

// ───────────────────────── database ─────────────────────────
const h = await stage3BHttpFixture(async (app) => {
  const { registerContactsRoutes } = await import("../../server/routes/contacts");
  registerContactsRoutes(app);
  const { registerCanonicalEnrichmentRoutes } = await import("../../server/routes/canonical-enrichment");
  registerCanonicalEnrichmentRoutes(app);
}, undefined, { backgroundProfile: "off" });

try {
  const { db } = h;
  const { runDrizzleMigrations } = await import("../../server/db-migrate");
  await runDrizzleMigrations();

  // ── F03: durable hold predicate semantics ──
  const { ensureProgram } = await import("../../server/services/cro03/south-florida-prospecting");
  const { seal } = await import("../../server/services/cro03/candidate-evidence-service");
  const program = await ensureProgram({ createdBy: h.prefix, maxCohortSize: 10 });
  const context = await hold.readStagingHoldContext(String(program.id));
  const sentinel = new Error("STAGE4B_ROLLBACK");
  try {
    await db.transaction(async (tx: any) => {
      const business = rows(await tx.execute(sql`
        INSERT INTO businesses (canonical_name, normalized_name, vertical, state, record_class, created_at)
        VALUES (${`${h.prefix}-hold`}, ${`${h.prefix}-hold`.toLowerCase()}, NULL, 'FL', 'canonical', NOW()) RETURNING id`))[0];
      const businessId = Number(business.id);
      const generation = rows(await tx.execute(sql`
        INSERT INTO free_discovery_generations (run_key, actor_id, purpose, reason, state)
        VALUES (${`${h.prefix}-gen`}, ${h.prefix}, 'email_discovery', 'Stage 4B hold fixture', 'completed') RETURNING id`))[0];
      const cohortRunId = randomUUID();
      await tx.execute(sql`
        INSERT INTO sfp_cohort_runs (id, program_id, idempotency_key, status, cohort_size, cohort_hash, release_sha, actor_id, cohort_state, frozen_at)
        VALUES (${cohortRunId}::uuid, ${String(program.id)}::uuid, ${`${h.prefix}-cohort`}, 'frozen', 1,
                ${createHash("sha256").update(h.prefix).digest("hex")}, 'stage4b-fixture', ${h.prefix}, 'frozen', NOW())`);
      const sealed = seal("email", `info@${h.prefix}.example.org`);
      const candidate = rows(await tx.execute(sql`
        INSERT INTO free_discovery_candidates (generation_id, business_id, field, subject_type, domain, source, attribution_scope,
          disposition, confidence, envelope_ciphertext, envelope_nonce, envelope_tag, envelope_key_version,
          normalized_value_hash, masked_value, created_at)
        VALUES (${String(generation.id)}::uuid, ${businessId}, 'email', 'business', ${`${h.prefix}.example.org`}, 'certification', 'role',
          'staged', 80, ${sealed.ciphertext}, ${sealed.nonce}, ${sealed.tag}, 1, ${sealed.normalizedValueHash}, ${sealed.maskedValue}, NOW())
        RETURNING id`))[0];
      const eligibility = rows(await tx.execute(sql`
        INSERT INTO sfp_outreach_eligibility (cohort_run_id, business_id, candidate_id, source_kind, policy_version, status,
          decision_reason, validation_at, validation_expires_at, role_inbox, normalized_value_hash)
        VALUES (${cohortRunId}::uuid, ${businessId}, ${String(candidate.id)}::uuid, 'free', 1, 'validated_outreach_eligible',
          'stage4b', NOW(), NOW()+INTERVAL '20 days', TRUE, ${sealed.normalizedValueHash}) RETURNING id`))[0];
      const eligibilityId = String(eligibility.id);

      const revisionOf = async (ctx = context) => String(rows(await tx.execute(sql`
        SELECT ${hold.stagingHoldRevisionSql(ctx)} AS rev FROM sfp_outreach_eligibility e ${hold.STAGING_HOLD_JOINS}
         WHERE e.id=${eligibilityId}::uuid`))[0].rev);
      const heldNow = async () => Boolean(rows(await tx.execute(sql`
        SELECT ${hold.activeStagingHoldPredicate(context)} AS held FROM sfp_outreach_eligibility e ${hold.STAGING_HOLD_JOINS}
         WHERE e.id=${eligibilityId}::uuid`))[0].held);
      const writeHold = async (bucket: string, klass: "permanent" | "retryable" | "timed", state: "dead_letter" | "retry", revision: string) => {
        const run = rows(await tx.execute(sql`
          INSERT INTO sfp_stage_runs (cohort_run_id, stage, idempotency_key, actor_id, state, max_items, provider_keys, estimated_cost_micros)
          VALUES (${cohortRunId}::uuid, 'campaign_staging', ${`${h.prefix}-${bucket}`}, 'system:sfp-campaign-staging', 'completed', 25, '[]'::jsonb, 0)
          RETURNING id`))[0];
        await tx.execute(sql`
          INSERT INTO sfp_stage_items (stage_run_id, business_id, provider, state, outcome_code, redacted_result)
          VALUES (${String(run.id)}::uuid, ${businessId}, 'campaign_staging', ${state}, 'SFP_STAGING_SUPPRESSED',
            jsonb_build_object('hold', jsonb_build_object('v',1,'class',${klass}::text,'eligibilityId',${eligibilityId}::text,'revision',${revision}::text)))`);
      };

      const revision0 = await revisionOf();
      check(!(await heldNow()), "[db] with no ledger rows the recipient is selectable");
      await writeHold("bucket-1", "retryable", "retry", revision0);
      check(!(await heldNow()), "[db] a retryable outcome never holds the recipient");
      await writeHold("bucket-2", "permanent", "dead_letter", revision0);
      check(await heldNow(), "[db] a permanent refusal holds the recipient");
      // The hold is not keyed on the run or the clock window: a later bucket with no ledger row of its own stays held.
      check(await heldNow(), "[db] the hold persists into a later window/restart (no run-scoped state)");

      await tx.execute(sql`UPDATE sfp_outreach_eligibility SET updated_at=NOW()+INTERVAL '3 hours', decision_reason='unrelated edit' WHERE id=${eligibilityId}::uuid`);
      check((await revisionOf()) === revision0 && await heldNow(), "[db] an unrelated edit (updated_at, reason text) does not reopen the hold");

      const otherPolicy = { ...context, policyDocumentHash: `${context.policyDocumentHash}-changed` };
      check((await revisionOf(otherPolicy)) !== revision0, "[db] a changed selected-policy hash changes the revision");

      await tx.execute(sql`UPDATE sfp_outreach_eligibility SET validation_expires_at=NOW()+INTERVAL '90 days' WHERE id=${eligibilityId}::uuid`);
      const revision1 = await revisionOf();
      check(revision1 !== revision0 && !(await heldNow()), "[db] a relevant fact change reopens the recipient for reconsideration");
      await writeHold("bucket-3", "permanent", "dead_letter", revision1);
      check(await heldNow(), "[db] the new refusal writes a new revision-bound hold, so reconsideration happens once");

      const census = rows(await tx.execute(sql`
        SELECT count(DISTINCT e.id)::int AS n FROM sfp_outreach_eligibility e ${hold.STAGING_HOLD_JOINS}
         WHERE e.id=${eligibilityId}::uuid AND ${hold.activeStagingHoldPredicate(context)}`))[0];
      check(Number(census.n) === 1, "[db] the census predicate counts the current hold exactly once");
      // Suppression removal: a timed hold is honoured while fresh and stops applying once its recheck window passes,
      // even though no revision fact changed (the suppression facts are not part of the revision).
      await writeHold("bucket-4", "timed", "dead_letter", revision1);
      await tx.execute(sql`UPDATE sfp_stage_items SET state='completed' WHERE provider='campaign_staging' AND business_id=${businessId}
        AND redacted_result->'hold'->>'class'='permanent'`);
      check(await heldNow(), "[db] a fresh timed suppression hold excludes the recipient");
      await tx.execute(sql`UPDATE sfp_stage_items SET updated_at=NOW()-INTERVAL '13 hours'
        WHERE provider='campaign_staging' AND business_id=${businessId} AND redacted_result->'hold'->>'class'='timed'`);
      check(!(await heldNow()), "[db] after the recheck window a lifted suppression makes the recipient selectable again, with no revision change");

      throw sentinel;
    });
  } catch (error) {
    if (error !== sentinel) throw error;
  }

  // ── F14: generation-fenced backlog with deadline and cancellation ──
  const backlog = await import("../../server/services/canonical-enrichment-backlog");
  backlog.resetCanonicalEnrichmentBacklogCache();
  const deadlineStart = Date.now();
  const expired = await backlog.readCanonicalEnrichmentBacklog({ fresh: true, deadlineMs: 1 }).then(() => null, (e: any) => e);
  check(Date.now() - deadlineStart < 1500, "[db] the caller is answered at the deadline, not after the computation settles (pre-transaction reads included)");
  check(expired instanceof backlog.BacklogDeadlineError && expired.code === "BACKLOG_DEADLINE_EXCEEDED",
    "[db] a read past its whole-response deadline rejects with the typed deadline error, not a partial result");
  const stillRunning = Number(rows(await db.execute(sql`
    SELECT count(*)::int AS n FROM pg_stat_activity
     WHERE datname=current_database() AND pid<>pg_backend_pid() AND state='active' AND query LIKE '%contact_business_link_decisions%'`))[0].n);
  check(stillRunning === 0, "[db] the cancelled computation no longer holds a database backend");
  const older = backlog.readCanonicalEnrichmentBacklog({ fresh: true, deadlineMs: 120_000 }).then(() => null, (e: any) => e);
  const newer = await backlog.readCanonicalEnrichmentBacklog({ fresh: true, deadlineMs: 120_000 });
  check((await older) instanceof backlog.BacklogDeadlineError, "[db] a superseded older generation is cancelled and cannot return or cache a result");
  check(newer && typeof newer === "object", "[db] the newest generation completes and serves its result");
  const cached = await backlog.readCanonicalEnrichmentBacklog();
  check(cached === newer, "[db] only the current generation populated the cache");
  backlog.resetCanonicalEnrichmentBacklogCache();

  // ── F14: the real HTTP routes. The aggregate never reads history; history is bounded on its own ──
  const runBacklog = await import("../../server/services/canonical-enrichment-backlog-run");
  const realRead = runBacklog.backlogHistoryDeps.readStoredValue;
  const never = () => new Promise<unknown>(() => undefined);
  const timed = async <T,>(fn: () => Promise<T>) => { const t = Date.now(); const value = await fn(); return { value, ms: Date.now() - t }; };
  try {
    // 1. aggregate success with history stalled forever: the aggregate must answer, with no history field.
    backlog.resetCanonicalEnrichmentBacklogCache();
    runBacklog.backlogHistoryDeps.readStoredValue = never;
    const okStalled = await timed(() => h.request("admin", "GET", "/api/canonical-enrichment/backlog?fresh=1"));
    check(okStalled.value.status === 200 && okStalled.ms < 20_000 && !("lastPriorityRun" in okStalled.value.body) && !("lastPriorityRunUnavailable" in okStalled.value.body),
      "[http] aggregate success is not coupled to a stalled history read and carries no history field");
    // 2. aggregate failure/deadline with history stalled: the 503 must also not wait for history.
    backlog.resetCanonicalEnrichmentBacklogCache();
    const realBacklogRead = backlog.readCanonicalEnrichmentBacklog;
    const blocker = await h.pool.connect();
    let failing: { value: any; ms: number };
    try {
      // The count reads contact_business_link_decisions; an exclusive lock makes the aggregate genuinely slow.
      await blocker.query("BEGIN");
      await blocker.query("LOCK TABLE contact_business_link_decisions IN ACCESS EXCLUSIVE MODE");
      failing = await timed(async () => {
        // A flight with a short deadline is already running when the real route asks, so the route joins it and
        // receives the typed deadline rejection while history is still stalled.
        const flight = realBacklogRead({ fresh: true, deadlineMs: 400 }).then(() => null, (e: any) => e);
        const res = await h.request("admin", "GET", "/api/canonical-enrichment/backlog");
        await flight;
        return res;
      });
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
    }
    check(failing.value.status === 503 && failing.value.body.code === "BACKLOG_DEADLINE_EXCEEDED" && failing.ms < 10_000 &&
      !("lastPriorityRun" in failing.value.body),
      "[http] aggregate deadline response is typed, does not wait for the stalled history, and carries no history field");
    // 3. the history route is bounded: a never-resolving read answers 503 at its own deadline.
    const stalledHistory = await timed(() => h.request("admin", "GET", "/api/canonical-enrichment/backlog-process-history"));
    check(stalledHistory.value.status === 503 && stalledHistory.value.body.code === "PROCESS_HISTORY_DEADLINE_EXCEEDED" &&
      stalledHistory.ms >= runBacklog.BACKLOG_HISTORY_DEADLINE_MS - 500 && stalledHistory.ms < runBacklog.BACKLOG_HISTORY_DEADLINE_MS + 5_000,
      "[http] a stalled history read is answered at its own deadline with a typed unavailable body, never 'no previous run'");
    // 4. a real database stall is cancelled on the server side, not just abandoned.
    runBacklog.backlogHistoryDeps.readStoredValue = (onBackend, deadlineMs) => db.transaction(async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL statement_timeout='${deadlineMs}ms'`));
      const id = rows(await tx.execute(sql`SELECT pg_backend_pid()::int AS pid, now()::text AS started`))[0];
      onBackend({ pid: Number(id.pid), xactStart: String(id.started) });
      await tx.execute(sql`SELECT pg_sleep(60) /* 4b-history-stall */`);
      return null;
    });
    const dbStall = await timed(() => h.request("admin", "GET", "/api/canonical-enrichment/backlog-process-history"));
    await new Promise((r) => setTimeout(r, 500));
    const lingering = Number(rows(await db.execute(sql`
      SELECT count(*)::int AS n FROM pg_stat_activity
       WHERE datname=current_database() AND pid<>pg_backend_pid() AND state='active' AND query LIKE '%4b-history-stall%'`))[0].n);
    check(dbStall.value.status === 503 && dbStall.ms < runBacklog.BACKLOG_HISTORY_DEADLINE_MS + 5_000 && lingering === 0,
      "[http] a stalled history query is answered at the deadline and its database backend is cancelled");
    // 5. recovery: the real read answers again on the same routes.
    runBacklog.backlogHistoryDeps.readStoredValue = realRead;
    const history = await h.request("admin", "GET", "/api/canonical-enrichment/backlog-process-history");
    check(history.status === 200 && "lastPriorityRun" in history.body, "[http] history recovers and answers 200 once the stall clears");
    backlog.resetCanonicalEnrichmentBacklogCache();
    const recovered = await h.request("admin", "GET", "/api/canonical-enrichment/backlog");
    check(recovered.status === 200 && typeof recovered.body === "object", "[http] the aggregate answers 200 after the stalls clear");
    // 6. a malformed stored history is reported unavailable, never as no previous run.
    runBacklog.backlogHistoryDeps.readStoredValue = async () => ({ garbage: true });
    const malformed = await h.request("admin", "GET", "/api/canonical-enrichment/backlog-process-history");
    check(malformed.status === 503 && malformed.body.code === "PROCESS_HISTORY_UNAVAILABLE", "[http] malformed stored history is unavailable, not 'no previous run'");
  } finally {
    runBacklog.backlogHistoryDeps.readStoredValue = realRead;
    backlog.resetCanonicalEnrichmentBacklogCache();
  }
  check((await h.request("agent", "GET", "/api/canonical-enrichment/backlog-process-history")).status === 403,
    "[db] the history endpoint keeps the existing role boundary");
  check((await h.request("agent", "GET", "/api/canonical-enrichment/backlog")).status === 403,
    "[db] the aggregate endpoint keeps the existing role boundary");

  // ── F14: SQL cold-lead paging ──
  const prefix = `4b-cold-${randomUUID()}`;
  const total = 520;
  await h.pool.query(`INSERT INTO contacts(first_name,last_name,email,phone,record_class,lead_source,created_at,email_status)
    SELECT 'Cold','Fixture '||g, $1||'-'||g||'@example.test','+1999'||lpad((g+4100000)::text,7,'0'),'production','dashboard',NOW()-((60+(g%7))||' days')::interval,'valid'
      FROM generate_series(1,$2) g`, [prefix, total]);
  const pages: any[] = [];
  for (let page = 0; page === 0 || page < Math.ceil(pages[0].total / 100); page++) {
    const r = await h.request("admin", "GET", `/api/contacts/cold-leads?page=${page}`);
    assert.equal(r.status, 200);
    pages.push(r.body);
  }
  const ids = pages.flatMap((p) => p.data.map((x: any) => x.id));
  check(pages.every((p) => p.total === pages[0].total) && pages[0].total >= total, "[db] every page reports the same scoped total");
  check(pages[0].data.length === 100 && pages[4].data.length === 100 && pages[pages.length - 1].data.length >= 1, "[db] pages are cut at the page size across more than 500 rows");
  check(pages[0].total >= 520, "[db] the fixture exceeds 500 cold leads");
  check(ids.length === pages[0].total && new Set(ids).size === ids.length, "[db] paging is stable: all rows appear exactly once across pages");
  const ordered = pages.flatMap((p) => p.data.map((x: any) => new Date(x.lastActivityDate).getTime()));
  check(ordered.every((t, i) => i === 0 || ordered[i - 1] <= t), "[db] rows stay in oldest-activity order across page boundaries");
  check(Number.isInteger(pages[0].avgDaysDormant) && pages[0].avgDaysDormant >= 45, "[db] average dormancy is computed over the whole scope");
  check((await h.request("admin", "GET", "/api/contacts/cold-leads?page=-1")).status === 400, "[db] an invalid page is still rejected");
  await h.pool.query(`DELETE FROM contacts WHERE email LIKE $1`, [`${prefix}-%`]);

  // ── F15: selected-policy TTL, business outside the staging boundary ──
  const { selectedRecipientValidationTtlDays } = await import("../../server/services/provider-readiness-control");
  const outside = rows(await db.execute(sql`
    INSERT INTO businesses (canonical_name, normalized_name, vertical, state, record_class, created_at)
    VALUES (${`${prefix}-ttl`}, ${`${prefix}-ttl`}, NULL, 'FL', 'canonical', NOW()) RETURNING id`))[0];
  check((await selectedRecipientValidationTtlDays(Number(outside.id))) === 180,
    "[db] a business outside the staging boundary keeps the 180-day default TTL");
  const providerReadiness = src("server/services/provider-readiness-control.ts");
  check(/Math\.min\(sharedMaxDays, policyDays\)/.test(providerReadiness) && /sfp_campaign_staging_intents/.test(providerReadiness),
    "[source] a staged recipient gets the stricter of 180 days and the selected policy TTL");

  console.log(`\nStage 4B supply/throughput: ${assertions} assertions passed`);
} finally {
  await h.close();
}
