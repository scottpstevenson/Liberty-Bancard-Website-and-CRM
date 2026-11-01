/**
 * Stage 4C1 paired package publication certification (disposable database; no network, no sends).
 * Real writers set up the five v2 packages (convergence + launch population); then the operator publication command is
 * exercised: 5-touch and 3-touch versions, stale-hash 409, replay, started-journey and active refusals, invalid content,
 * atomic rollback, concurrent publishes, and the generic single-sided mutation fence.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertDisposableTestInfrastructure } from "../test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary, getBlockedCertificationNetworkAttemptCount } from "../certification-provider-deny";

await assertDisposableTestInfrastructure({ operation: "Stage 4C1 package publication certification" });
process.env.VG_PROVIDER_DENY_MODE = "1";
applyCertificationProviderDenyBoundary({ fatal: true });

const { pool } = await import("../../server/db");
const packages = await import("../../server/services/cro03/sfp-campaign-packages");
const content = await import("../../server/services/cro03/sfp-launch-content");
const pub = await import("../../server/services/cro03/sfp-package-content-publish");

let checks = 0;
const check = (v: unknown, message: string) => { assert(v, message); checks++; console.log(`✓ [PKG-${String(checks).padStart(2, "0")}] ${message}`); };
const refuses = async (fn: () => Promise<unknown>, status: number, code: string, message: string) => {
  try { await fn(); } catch (e: any) { check(e?.status === status && e?.code === code, `${message} (${e?.status} ${e?.code})`); return e; }
  assert.fail(`${message}: expected ${status} ${code}`);
};

const tag = randomUUID().slice(0, 8);
const KEY = "sfp.automotive.v2";
const ACTOR = `cert:${tag}`;
const TOUCH5: Array<{ subject: string; body: string; delayDays: number }> = [
  { subject: "A quick look at your card processing", delayDays: 0, body: "Hi {{firstName}},\n\nWe help businesses like {{companyName}} read their processing statement line by line.\n\nWould a free statement review be useful? A quick reply is all I need." },
  { subject: "What a statement review shows", delayDays: 3, body: "Hello,\n\nA review separates network costs, processor markup and fixed fees for {{companyName}}.\n\nIf you want it, the secure upload page is [secure_statement_upload]." },
  { subject: "One more way to compare", delayDays: 4, body: "Hello,\n\nIf the timing is better now, you can upload a statement at [secure_statement_upload] and we will walk through it with you." },
  { subject: "Still open to a review?", delayDays: 5, body: "Hello,\n\nI am keeping this offer open for {{companyName}}. Reply with a good time to talk, or use [secure_statement_upload]." },
  { subject: "Closing the loop", delayDays: 6, body: "Hello,\n\nThis is my last note about a statement review for {{companyName}}. No reply needed if the timing is not right." },
];

try {
  await pool.query(`INSERT INTO follow_up_sequences (name,status,trigger_type,trigger_config,total_steps,sequence_family)
    VALUES ($1,'paused','contact_created','{}'::jsonb,5,'cold-email-manual-call')`, [`W6 fixture ${tag}`]);
  for (const name of ["SDR-01: Statement Review Cold Outreach", "SDR-05: Medical / Dental / Medspa", "SDR-07: Auto / Service / Trades", "SDR-10: Salon / Spa / Beauty"]) {
    const c = (await pool.query(`INSERT INTO campaigns (name,status,total_steps,created_by) VALUES ($1,'draft',5,'cert') RETURNING id`, [name])).rows[0];
    for (let i = 1; i <= 5; i++) await pool.query(`INSERT INTO campaign_steps (campaign_id,step_order,step_type,delay_days,subject,body_template,channel) VALUES ($1,$2,'follow_up',$3,$4,$5,'email')`, [c.id, i, i * 2, `S ${name} ${i}`, `B ${name} ${i}`]);
  }
  await packages.applyPackageConvergenceV2({ actorId: ACTOR });
  const populated = await content.populateSfpLaunchContentV2({ actorId: ACTOR });
  check(populated.every((r) => r.status === "populated"), "Setup: five packages populated with the three-touch launch content through the real writers");

  const state0 = (await pub.getPackageEditState(KEY))!;
  check(state0.editable && state0.steps.length === 3 && state0.steps.map((s) => s.cumulativeDay).join(",") === "0,3,8", "Edit state is editable and reports relative delay and cumulative day separately (0,3,8)");
  check(JSON.stringify(pub.cumulativeDays([0, 3, 4, 5, 6])) === "[0,3,7,12,18]", "Five-touch relative delays 0,3,4,5,6 are cumulative days 0,3,7,12,18");
  const seqId = state0.sequenceId, campId = state0.campaignId;
  const idsBefore = (await pool.query(`SELECT string_agg(id::text,',' ORDER BY step_order) ids FROM sequence_steps WHERE sequence_id=$1`, [seqId])).rows[0].ids as string;
  const revBefore = Number((await pool.query(`SELECT content_revision FROM campaigns WHERE id=$1`, [campId])).rows[0].content_revision);
  await pool.query(`UPDATE campaigns SET approved_revision=content_revision WHERE id=$1`, [campId]);

  // ── invalid drafts are refused before any write ────────────────────────────
  const base = { packageKey: KEY, expectedVersionId: state0.versionId, expectedContentHash: state0.contentHash, actorId: ACTOR };
  const invalid = async (touches: any[], needle: string, label: string) => {
    const e = await refuses(() => pub.publishPackageContent({ ...base, touches }), 422, "PACKAGE_CONTENT_INVALID", label);
    check(JSON.stringify(e.detail).includes(needle), `${label}: reason names "${needle}"`);
  };
  await invalid(TOUCH5.slice(0, 4), "3 or 5", "Four touches");
  await invalid(TOUCH5.map((t, i) => (i === 1 ? { ...t, body: "Hello,\n\nBook a 10 minute call." } : t)), "unverified_duration", "A duration claim");
  await invalid(TOUCH5.map((t, i) => (i === 1 ? { ...t, body: "Hello,\n\nSee https://evil.example.com/x now." } : t)), "unsafe_link", "A foreign link");
  await invalid(TOUCH5.map((t, i) => (i === 1 ? { ...t, body: "Hello,\n\nWe will save you $500 a month." } : t)), "unsupported claim", "A savings figure");
  await invalid(TOUCH5.map((t, i) => (i === 0 ? { ...t, body: t.body + "\n[secure_statement_upload]" } : t)), "first touch", "An upload link in the first touch");
  await invalid(TOUCH5.map((t, i) => (i === 2 ? { ...t, delayDays: 0 } : t)), "at least one day", "A follow-up with no delay");
  await refuses(() => pub.publishPackageContent({ ...base, touches: TOUCH5.map((t, i) => (i === 2 ? { ...t, body: "Hello {{estimatedSavings}}" } : t)) }), 422, "PACKAGE_NOT_READY", "An unsupported token passes text checks but the readiness guard rolls the whole write back");
  check(Number((await pool.query(`SELECT count(*) c FROM sequence_steps WHERE sequence_id=$1`, [seqId])).rows[0].c) === 3, "Every refused draft left the three live steps untouched");

  // ── five-touch publication ─────────────────────────────────────────────────
  const r1 = await pub.publishPackageContent({ ...base, touches: TOUCH5 });
  check(r1.status === "published" && r1.touches === 5, "A valid five-touch draft publishes");
  const s5 = (await pool.query(`SELECT step_order,delay_days,action_type,body FROM sequence_steps WHERE sequence_id=$1 ORDER BY step_order`, [seqId])).rows;
  const c5 = (await pool.query(`SELECT step_order,delay_days,body_template,channel FROM campaign_steps WHERE campaign_id=$1 ORDER BY step_order`, [campId])).rows;
  check(s5.length === 5 && c5.length === 5 && s5.every((s: any, i: number) => s.body === c5[i].body_template && Number(s.delay_days) === Number(c5[i].delay_days) && s.action_type === "email" && c5[i].channel === "email"), "Campaign and sequence carry identical five steps (paired write)");
  check(s5[1].body.includes("https://libertybancard.com/upload-statement") && !/\[secure_statement_upload\]/.test(s5[1].body), "The marker resolved to the approved secure-upload link");
  check((await pool.query(`SELECT string_agg(id::text,',' ORDER BY step_order) ids FROM sequence_steps WHERE sequence_id=$1`, [seqId])).rows[0].ids.startsWith(idsBefore), "Existing step identities were rewritten in place (new steps appended)");
  const camp = (await pool.query(`SELECT total_steps,content_revision,approved_revision,status FROM campaigns WHERE id=$1`, [campId])).rows[0];
  check(Number(camp.total_steps) === 5 && Number(camp.content_revision) === revBefore + 1 && camp.approved_revision === null && camp.status === "draft", "Content approval was invalidated and the campaign stays draft");
  check((await pool.query(`SELECT status,total_steps FROM follow_up_sequences WHERE id=$1`, [seqId])).rows[0].status === "paused", "The sequence stays paused");
  const cur = (await pool.query(`SELECT id::text id,content_hash,notes FROM sfp_campaign_package_versions WHERE package_key=$1 AND lifecycle_state='current'`, [KEY])).rows;
  check(cur.length === 1 && cur[0].id === r1.packageVersionId && cur[0].content_hash === r1.contentHash && cur[0].content_hash !== state0.contentHash, "Exactly one current version, new immutable identity and hash");
  check((await pool.query(`SELECT lifecycle_state FROM sfp_campaign_package_versions WHERE id=$1::uuid`, [state0.versionId])).rows[0].lifecycle_state === "superseded", "The previous version is superseded, not mutated");
  const audit = (await pool.query(`SELECT details FROM audit_logs WHERE action='sfp_package_content_published' AND entity_key=$1 ORDER BY id DESC LIMIT 1`, [KEY])).rows[0];
  check(audit && audit.details.sendOrActivationEffect === false, "The publication was audited in the same transaction");

  // ── stale hash, replay, concurrency ────────────────────────────────────────
  await refuses(() => pub.publishPackageContent({ ...base, touches: TOUCH5 }), 409, "PACKAGE_STALE", "A draft started from the previous version is refused");
  const fresh = { ...base, expectedVersionId: r1.packageVersionId, expectedContentHash: r1.contentHash };
  const replay = await pub.publishPackageContent({ ...fresh, touches: TOUCH5 });
  check(replay.status === "replayed" && replay.packageVersionId === r1.packageVersionId, "Re-sending the same content against the matching version replays and writes nothing");
  check(Number((await pool.query(`SELECT count(*) c FROM sfp_campaign_package_versions WHERE package_key=$1`, [KEY])).rows[0].c) === 3, "Replay created no extra version");
  const three = TOUCH5.slice(0, 3).map((t, i) => ({ ...t, delayDays: [0, 3, 5][i], subject: `${t.subject} (3)` }));
  const settled = await Promise.allSettled([pub.publishPackageContent({ ...fresh, touches: three }), pub.publishPackageContent({ ...fresh, touches: three.map((t) => ({ ...t, subject: `${t.subject} B` })) })]);
  const won = settled.filter((s) => s.status === "fulfilled").length;
  const lost = settled.filter((s): s is PromiseRejectedResult => s.status === "rejected").map((s) => s.reason);
  check(won === 1 && lost.length === 1 && lost[0].code === "PACKAGE_STALE", "Two concurrent publishes from the same version: one wins, the other gets PACKAGE_STALE");
  const s3 = (await pool.query(`SELECT count(*) c FROM sequence_steps WHERE sequence_id=$1`, [seqId])).rows[0].c;
  const c3 = (await pool.query(`SELECT count(*) c FROM campaign_steps WHERE campaign_id=$1`, [campId])).rows[0].c;
  check(Number(s3) === 3 && Number(c3) === 3, "Shortening five to three touches removed the extra steps from both sides");
  check(Number((await pool.query(`SELECT count(*) c FROM sfp_campaign_package_versions WHERE package_key=$1 AND lifecycle_state='current'`, [KEY])).rows[0].c) === 1, "Still exactly one current version after the race");

  // ── started and active journeys ────────────────────────────────────────────
  const st = (await pub.getPackageEditState(KEY))!;
  const contact = Number((await pool.query(`INSERT INTO contacts(first_name,last_name,email,phone,record_class) VALUES ('Pkg','Held',$1,'+13055550177','production') RETURNING id`, [`pkg-${tag}@example-business.test`])).rows[0].id);
  const enr = Number((await pool.query(`INSERT INTO sequence_enrollments(sequence_id,contact_id,current_step,status) VALUES ($1,$2,0,'paused') RETURNING id`, [seqId, contact])).rows[0].id);
  const heldOk = await pub.publishPackageContent({ packageKey: KEY, expectedVersionId: st.versionId, expectedContentHash: st.contentHash, actorId: ACTOR, touches: TOUCH5 });
  check(heldOk.status === "published", "A paused never-started held enrollment does not block publication");
  await pool.query(`UPDATE sequence_enrollments SET current_step=1 WHERE id=$1`, [enr]);
  const st2 = (await pub.getPackageEditState(KEY))!;
  check(!st2.editable && st2.refusals.some((r) => r.includes("started")), "Edit state reports started journeys as a refusal");
  const stepsBeforeRefusal = (await pool.query(`SELECT md5(string_agg(subject||body||delay_days::text,'|' ORDER BY step_order)) h FROM sequence_steps WHERE sequence_id=$1`, [seqId])).rows[0].h;
  await refuses(() => pub.publishPackageContent({ packageKey: KEY, expectedVersionId: st2.versionId, expectedContentHash: st2.contentHash, actorId: ACTOR, touches: three }), 409, "PACKAGE_HAS_STARTED_JOURNEYS", "A started journey refuses publication");
  check((await pool.query(`SELECT md5(string_agg(subject||body||delay_days::text,'|' ORDER BY step_order)) h FROM sequence_steps WHERE sequence_id=$1`, [seqId])).rows[0].h === stepsBeforeRefusal, "The refusal changed nothing");
  await pool.query(`UPDATE sequence_enrollments SET current_step=0 WHERE id=$1`, [enr]);

  // ── drift and status ───────────────────────────────────────────────────────
  const st3 = (await pub.getPackageEditState(KEY))!;
  await pool.query(`UPDATE sequence_steps SET body=body||' edited' WHERE sequence_id=$1 AND step_order=2`, [seqId]);
  await refuses(() => pub.publishPackageContent({ packageKey: KEY, expectedVersionId: st3.versionId, expectedContentHash: st3.contentHash, actorId: ACTOR, touches: three }), 409, "PACKAGE_LIVE_DRIFT", "Live content that differs from the pinned version is refused");
  await pool.query(`UPDATE sequence_steps SET body=replace(body,' edited','') WHERE sequence_id=$1 AND step_order=2`, [seqId]);
  await pool.query(`UPDATE follow_up_sequences SET status='active' WHERE id=$1`, [seqId]);
  await refuses(() => pub.publishPackageContent({ packageKey: KEY, expectedVersionId: st3.versionId, expectedContentHash: st3.contentHash, actorId: ACTOR, touches: three }), 409, "SEQUENCE_NOT_PAUSED", "A non-paused sequence refuses publication");
  await pool.query(`UPDATE follow_up_sequences SET status='paused' WHERE id=$1`, [seqId]);

  check(getBlockedCertificationNetworkAttemptCount() === 0, "No provider or network call was attempted");
  console.log(`STAGE4C1_PACKAGE_PUBLICATION_PASS (${checks} checks)`);
} finally {
  await pool.end();
}
process.exit(0);
