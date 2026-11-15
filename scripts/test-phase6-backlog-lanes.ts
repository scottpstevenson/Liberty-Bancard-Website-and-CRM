/**
 * Phase 6 / C01: the canonical enrichment backlog reads its independent statements as three concurrent lanes (one
 * connection each) instead of one long sequential transaction, so the whole read fits its unchanged 25 s deadline at
 * production scale. This suite proves, on disposable infrastructure only:
 *   1. parity: the lane read and the one-lane sequential reference return the identical backlog (every family, priority
 *      item, funnel count and separate count) over fixtures that populate several families, and the lane read really used
 *      three distinct database backends while the reference used one;
 *   2. failure injection: a statement that fails in one lane is reported as itself (not as a sibling abort), the other lanes'
 *      exact backends are cancelled, nothing is cached, no statement is retried, and the next read recovers;
 *   3. cancellation: an expired flight cancels every lane's backend (a stalled statement in each of two lanes), answers at
 *      the deadline with the typed error, and a read that is already expired starts no statement at all;
 *   4. fences: a fresh read supersedes an older lane read, which can neither return nor populate the cache.
 * Runs only against disposable infrastructure; provider egress is denied.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary, getBlockedCertificationNetworkAttemptCount } from "./certification-provider-deny";

await assertDisposableTestInfrastructure({ operation: "phase 6 backlog lane parity and cancellation" });
process.env.VG_PROVIDER_DENY_MODE = "1";
applyCertificationProviderDenyBoundary({ fatal: true });

const { db, pool } = await import("../server/db");
const backlog = await import("../server/services/canonical-enrichment-backlog");
type BacklogLaneProgress = import("../server/services/canonical-enrichment-backlog").BacklogLaneProgress;
type BacklogBackendHandle = import("../server/services/canonical-enrichment-backlog").BacklogBackendHandle;

const prefix = `p6_lanes_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
let checks = 0;
const check = (value: unknown, message: string) => { assert.ok(value, message); checks++; };
const same = (actual: unknown, expected: unknown, message: string) => { assert.deepEqual(actual, expected, message); checks++; };
const rows = (result: any): any[] => result?.rows ?? result ?? [];
const strip = (value: any) => { const { observedAt, ...rest } = value; void observedAt; return rest; };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const activeWith = async (tag: string) => Number(rows(await db.execute(sql.raw(`
  SELECT count(*)::int AS n FROM pg_stat_activity
   WHERE datname=current_database() AND pid<>pg_backend_pid() AND state='active' AND query LIKE '%${tag}%'`)))[0].n);
async function waitUntilNoneActive(tag: string, withinMs: number) {
  const until = Date.now() + withinMs;
  while (Date.now() < until) { if ((await activeWith(tag)) === 0) return true; await sleep(100); }
  return (await activeWith(tag)) === 0;
}

/** A statement that sleeps until cancelled, tagged so the suite can see whether its backend is still working. */
const stall = (tag: string) => sql.raw(`SELECT pg_sleep(60) /* ${tag} */`);

try {
  // ───────────────────────────── Fixtures: several families populated ─────────────────────────────
  for (let i = 0; i < 6; i++) {
    const label = `${prefix}_${i}`;
    const business = (await pool.query(`INSERT INTO businesses
      (canonical_name,normalized_name,record_class,vertical,city,state,postal_code,website_domain,main_email)
      VALUES($1,$1,'canonical',$2,'Miami','FL','33130',$3,$4) RETURNING id`,
    [label, i % 2 ? "Automotive" : "Gym", i < 4 ? `${label}.example.com` : null, i % 3 === 0 ? `${label}@gmail.com` : null])).rows[0];
    await pool.query(`INSERT INTO canonical_source_links (business_id,source_system,source_type,stable_key)
      VALUES($1,$2,'place',$3)`, [business.id, i % 2 ? "outscraper" : "crm", `${label}-key`]);
    const contact = (await pool.query(`INSERT INTO contacts (first_name,last_name,email,phone,company_name,record_class,business_id)
      VALUES('Lane','Fixture',$1,'',$2,'production',$3) RETURNING id`,
    [`${label}.c@gmail.com`, label, i < 3 ? business.id : null])).rows[0];
    void contact;
  }
  for (let i = 0; i < 3; i++) {
    await pool.query(`INSERT INTO sunbiz_entities (filing_number,entity_name,source,principal_state,website,email)
      VALUES($1,$2,'sunbiz','FL',$3,$4)`, [`${prefix}-F${i}`, `${prefix} registry ${i}`, i < 2 ? `https://${prefix}-${i}.example.com` : null, i === 2 ? `${prefix}@gmail.com` : null]);
  }

  // ───────────────────────────── 1. Parity with the sequential reference, and real concurrency ─────────────────────────────
  const read = async (layout: "parallel" | "sequential") => {
    backlog.backlogReadDeps.layout = layout;
    const progress = new Map<string, BacklogLaneProgress>();
    const backends: BacklogBackendHandle[] = [];
    const value = await backlog.computeCanonicalEnrichmentBacklog({ onBackend: (b) => backends.push(b), progress });
    return { value, progress, backends };
  };
  const reference = await read("sequential");
  const lanes = await read("parallel");
  backlog.backlogReadDeps.layout = "parallel";
  same(strip(lanes.value), strip(reference.value), "the lane read equals the sequential reference in every family, priority item and count");
  check(reference.backends.length === 1 && new Set(reference.backends.map((b) => b.pid)).size === 1, "the reference used one backend");
  check(lanes.backends.length === 3 && new Set(lanes.backends.map((b) => b.pid)).size === 3,
    `the lane read used three distinct database backends (${lanes.backends.map((b) => b.pid)})`);
  same([...lanes.progress.keys()].sort(), ["businesses", "contacts", "registry"], "each lane reports its own progress");
  same([...lanes.progress.values()].map((l) => l.queries).sort(), [1, 3, 6], "lanes ran 6 + 3 + 1 statements, one aggregate read, no repeats");
  check([...lanes.progress.values()].every((l) => l.state === "done" && Object.keys(l.stepMs).length === l.queries), "every statement's duration is recorded");
  const families = (lanes.value as any).families as Array<{ key?: string; total?: number }>;
  check(families.length >= 3 && families.every((f) => Number(f.total ?? 1) > 0),
    `parity is not trivially empty: ${families.length} families carry counts (${families.map((f) => f.key).join(", ")})`);

  // ───────────────────────────── 2. Failure injection: one lane fails, siblings are cancelled, nothing is retried ─────────────────────────────
  // Each injected statement bumps its own sequence first (sequences are not rolled back), so "started once" is observable.
  const counters = ["contacts", "businesses", "registry"].map((lane) => ({ lane, name: `${prefix}_seq_${lane}` }));
  for (const c of counters) await pool.query(`CREATE SEQUENCE ${c.name}`);
  const started = async () => Object.fromEntries(await Promise.all(counters.map(async (c) => [c.lane,
    Number((await pool.query(`SELECT CASE WHEN is_called THEN last_value ELSE 0 END AS n FROM ${c.name}`)).rows[0].n)])));
  backlog.resetCanonicalEnrichmentBacklogCache();
  backlog.backlogReadDeps.stepQuery = (lane, key, query) => {
    if (lane === "registry") // fails after the siblings are already inside their stalled statements
      return sql.raw(`SELECT nextval('${prefix}_seq_registry'), pg_sleep(1.5), 1/((random()*0)::int) /* ${prefix}-injected */`);
    if (lane === "contacts" && key === "contact") return sql.raw(`SELECT nextval('${prefix}_seq_contacts'), pg_sleep(60) /* ${prefix}-contacts-stall */`);
    if (lane === "businesses" && key === "business") return sql.raw(`SELECT nextval('${prefix}_seq_businesses'), pg_sleep(60) /* ${prefix}-businesses-stall */`);
    return query;
  };
  const failStarted = Date.now();
  const failed = await backlog.readCanonicalEnrichmentBacklog({ fresh: true, deadlineMs: 20_000 }).then(() => null, (e: any) => e);
  const failMs = Date.now() - failStarted;
  check(failed instanceof Error && !(failed instanceof backlog.BacklogDeadlineError) && failed.message !== "BACKLOG_LANE_ABORTED",
    `a failing lane is reported as a failure, not as a deadline or a sibling abort (${failed?.message})`);
  check(String(failed?.cause?.code ?? failed?.code ?? "") === "22012" || /division by zero/i.test(String(failed?.cause?.message ?? failed?.message ?? "")),
    "the reported error is the injected statement's own failure");
  check(failMs >= 1_400 && failMs < 8_000, `the read ended promptly once a lane failed instead of waiting for stalled siblings (${failMs} ms)`);
  check(await waitUntilNoneActive(`${prefix}-contacts-stall`, 4_000) && await waitUntilNoneActive(`${prefix}-businesses-stall`, 4_000),
    "the failed read's sibling backends were cancelled, not abandoned");
  await sleep(2_500); // longer than the repeat-cancel interval: a restarted sibling would show here
  same(await started(), { contacts: 1, businesses: 1, registry: 1 },
    "each injected statement started exactly once: nothing was retried and no sibling restarted another");
  backlog.backlogReadDeps.stepQuery = (_lane, _key, query) => query;
  const recovered = await backlog.readCanonicalEnrichmentBacklog({ fresh: true, deadlineMs: 20_000 });
  same(strip(recovered), strip(reference.value), "after a failure the next read recovers the same answer (the failure was not cached)");
  check(await backlog.readCanonicalEnrichmentBacklog() === recovered, "only the successful read populated the cache");

  // ───────────────────────────── 3. Cancellation at the deadline ─────────────────────────────
  backlog.resetCanonicalEnrichmentBacklogCache();
  backlog.backlogReadDeps.stepQuery = (lane, key, query) => {
    if (lane === "contacts" && key === "contact") return stall(`${prefix}-deadline-contacts`);
    if (lane === "registry") return stall(`${prefix}-deadline-registry`);
    return query;
  };
  const expiryStarted = Date.now();
  const expired = await backlog.readCanonicalEnrichmentBacklog({ fresh: true, deadlineMs: 600 }).then(() => null, (e: any) => e);
  check(Date.now() - expiryStarted < 2_500, "the caller is answered at the deadline");
  check(expired instanceof backlog.BacklogDeadlineError && expired.code === "BACKLOG_DEADLINE_EXCEEDED",
    "an expired read rejects with the typed deadline error, never a partial or zero-filled backlog");
  check(await waitUntilNoneActive(`${prefix}-deadline-contacts`, 5_000) && await waitUntilNoneActive(`${prefix}-deadline-registry`, 5_000),
    "the expired flight cancelled every lane's database backend");
  backlog.backlogReadDeps.stepQuery = (_lane, _key, query) => query;

  // An already-expired read starts no transaction and no statement.
  const opened: BacklogBackendHandle[] = [];
  const refused = await backlog.computeCanonicalEnrichmentBacklog({ isExpired: () => true, onBackend: (b) => opened.push(b) })
    .then(() => null, (e: any) => e);
  check(refused instanceof backlog.BacklogDeadlineError, "a read that is already expired is refused with the deadline error");
  check(opened.length === 0, "an already-expired read opened no transaction and started no statement");

  // ───────────────────────────── 4. Generation fence ─────────────────────────────
  backlog.resetCanonicalEnrichmentBacklogCache();
  backlog.backlogReadDeps.stepQuery = (lane, key, query) => lane === "registry" ? stall(`${prefix}-older-generation`) : query;
  const older = backlog.readCanonicalEnrichmentBacklog({ fresh: true, deadlineMs: 20_000 }).then(() => null, (e: any) => e);
  await sleep(300);
  backlog.backlogReadDeps.stepQuery = (_lane, _key, query) => query;
  const newer = await backlog.readCanonicalEnrichmentBacklog({ fresh: true, deadlineMs: 20_000 });
  check((await older) instanceof backlog.BacklogDeadlineError, "a superseded older lane read is stopped and cannot return a result");
  check(await waitUntilNoneActive(`${prefix}-older-generation`, 5_000), "the superseded read's backends were cancelled");
  check(await backlog.readCanonicalEnrichmentBacklog() === newer, "only the newest generation populated the cache");
  same(strip(newer), strip(reference.value), "the newest generation serves the same answer");

  check(getBlockedCertificationNetworkAttemptCount() === 0, "no provider network attempt was made");
  console.log(`phase6 backlog lanes: ok (${checks} checks)`);
} finally {
  backlog.backlogReadDeps.stepQuery = (_lane, _key, query) => query;
  backlog.backlogReadDeps.layout = "parallel";
  await pool.query("DELETE FROM sunbiz_entities WHERE filing_number LIKE $1", [`${prefix}%`]).catch(() => undefined);
  for (const lane of ["contacts", "businesses", "registry"]) await pool.query(`DROP SEQUENCE IF EXISTS ${prefix}_seq_${lane}`).catch(() => undefined);
  await pool.end().catch(() => undefined);
}
process.exit(0);
