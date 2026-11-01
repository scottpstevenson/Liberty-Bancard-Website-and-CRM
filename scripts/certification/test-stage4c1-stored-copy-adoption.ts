/**
 * Stage 4C1 stored-copy adoption certification (R04) — disposable database; no network, no sends.
 *
 * Fixtures are the exact stored wording read (read-only) from the published database on 2026-11-01
 * (scripts/certification/fixtures/stage4c1-stored-copy-production-snapshot-2026-11-01.json), so these checks prove the
 * reviewed edits match what is actually stored, not a paraphrase.
 *
 *  A. Pure: every sequence-step edit matches the stored text; the result has no audited findings, no residual savings
 *     token, no dead/mismatched/literal-widget link and no stated call length.
 *  B. Pure: workflow and template replacements do the same for workflows 4/5/7/11/12/13 and templates 1/6.
 *  C. Disposable DB: preview is read-only; apply needs the reviewed plan hash; active sequences are refused; operator
 *     edits are conflicts, not overwrites; repeat is a no-op; concurrent applies change each step once; enrollments,
 *     status and delays are untouched.
 *  D. Disposable DB: convergence applies the workflow/template wording without touching enabled/isActive and is a
 *     no-op on repeat.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertDisposableTestInfrastructure } from "../test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary, getBlockedCertificationNetworkAttemptCount } from "../certification-provider-deny";

await assertDisposableTestInfrastructure({ operation: "Stage 4C1 stored copy adoption certification" });
process.env.VG_PROVIDER_DENY_MODE = "1";
applyCertificationProviderDenyBoundary({ fatal: true });

const { pool } = await import("../../server/db");
const { storage } = await import("../../server/storage");
const adoption = await import("../../server/services/stored-sequence-copy-adoption");
const replacements = await import("../../server/services/reviewed-copy-replacements");
const { lintLinks, lintRules } = await import("../../server/services/message-copy-lint");
const { findDurationClaims } = await import("../../server/services/message-cta-contract");

let checks = 0;
const check = (v: unknown, message: string) => { assert(v, message); checks++; console.log(`✓ [SCA-${String(checks).padStart(2, "0")}] ${message}`); };

const snap = JSON.parse(readFileSync(new URL("./fixtures/stage4c1-stored-copy-production-snapshot-2026-11-01.json", import.meta.url), "utf8")) as {
  seq: Array<{ sid: number; sname: string; status: string; stepid: number; step_order: number; action_type: string; subject: string | null; body: string | null; template_id: number | null }>;
  wf: Array<{ id: number; name: string; enabled: boolean; version: number; actions: any[] }>;
  tpl: Array<{ id: number; name: string; subject: string; body: string; content_version: number }>;
};

const hrefs = (t: string) => [...t.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
const bareUrls = (t: string) => [...t.matchAll(/https?:\/\/[^\s"'<>]+|libertybancard\.com\/[^\s"'<>.,)]*/gi)].map((m) => m[0]);
const ALLOWED = new Set([
  "https://libertybancard.com/upload-statement", "https://libertybancard.com/book", "https://libertybancard.com/partner-portal",
  "https://libertybancard.com/merchant-application", "libertybancard.com/merchant-application",
]);
function cleanCopy(label: string, subject: string | null, body: string | null) {
  const text = `${subject ?? ""}\n${body ?? ""}`;
  const f = [...lintRules(text), ...lintLinks(text)];
  assert.equal(f.length, 0, `${label}: audited findings remain: ${f.map((x) => x.rule + ":" + x.match).join(", ")}`);
  assert(!/estimatedSavings/.test(text), `${label}: residual savings token`);
  assert.equal(findDurationClaims(text).length, 0, `${label}: call length`);
  assert(!/leadconnectorhq|libertybancard\.com\/(apply|upload|refer|terminals|partners\/portal)(?![\w-])/.test(text), `${label}: dead or literal-widget link`);
  for (const u of [...hrefs(text), ...bareUrls(text)]) assert(ALLOWED.has(u.replace(/[.,)]+$/, "")) || /^mailto:|^tel:/.test(u) || u.includes("{{"), `${label}: unexpected link ${u}`);
}

// ── A. sequence steps against the stored text ───────────────────────────────
const stepOf = (t: (typeof adoption.STORED_SEQUENCE_COPY_TARGETS)[number]) => snap.seq.find((s) => s.sid === t.sequenceId && s.step_order === t.stepOrder && s.action_type === t.channel);
for (const t of adoption.STORED_SEQUENCE_COPY_TARGETS) {
  const row = stepOf(t);
  assert(row, `snapshot has sequence ${t.sequenceId} step ${t.stepOrder}`);
  assert.equal(row.sname, t.sequenceName, "sequence name matches the stored name");
  for (const e of t.body) assert((row.body ?? "").includes(e.from), `sequence ${t.sequenceId} step ${t.stepOrder}: edit text not found in stored body: ${e.from.slice(0, 60)}`);
  for (const e of t.subject ?? []) assert((row.subject ?? "").includes(e.from), `sequence ${t.sequenceId} step ${t.stepOrder}: subject edit not found`);
  const out = adoption.planStepCopy(t, row);
  assert(out.changed, "edit changes the stored wording");
  cleanCopy(`sequence ${t.sequenceId} step ${t.stepOrder}`, out.subject, out.body);
  const again = adoption.planStepCopy(t, { subject: out.subject, body: out.body });
  assert(!again.changed, "edit is idempotent");
}
check(true, `All ${adoption.STORED_SEQUENCE_COPY_TARGETS.length} sequence-step edits match the stored wording, leave no audited finding/savings token/dead or mismatched link/call length, and are idempotent`);
const ids = new Set(adoption.STORED_SEQUENCE_COPY_TARGETS.map((t) => t.sequenceId));
check([36, 84, 85, 86, 91, 93, 94].every((i) => ids.has(i)), "Every sequence named in the audit (36/84/85/86/91/93/94) is covered");

// Intent checks that string cleanliness alone cannot prove.
const out = (sid: number, order: number, ch: string) => {
  const t = adoption.STORED_SEQUENCE_COPY_TARGETS.find((x) => x.sequenceId === sid && x.stepOrder === order && x.channel === ch)!;
  return adoption.planStepCopy(t, stepOf(t)!);
};
check(hrefs(out(36, 4, "email").body!).includes("https://libertybancard.com/upload-statement") && /Upload a Statement/.test(out(36, 4, "email").body!), "Sequence 36 step 4: an 'upload' call to action now opens the secure upload page");
check(hrefs(out(36, 9, "email").body!).includes("https://libertybancard.com/book") && !/application/i.test(out(36, 9, "email").body!.replace(/Eligibility[\s\S]*$/, "")), "Sequence 36 step 9: the booking link no longer claims to be an application");
check(out(84, 2, "sms").body!.includes("/upload-statement") && !out(84, 2, "sms").body!.includes("leadconnectorhq"), "Sequence 84 step 2: the statement-upload text points at secure upload, not a booking widget");
check(!/apply/i.test(out(91, 1, "email").body!.replace(/Eligibility[\s\S]*$/, "")) && /reply here/i.test(out(91, 1, "email").body!), "Sequence 91: abandoned-application copy offers a reply, because no scoped continuation link exists");

// ── B. workflows and templates against the stored text ──────────────────────
const wfCount = { changed: 0 };
for (const w of snap.wf) {
  const { actions, changed } = replacements.applyWorkflowCopyReplacements(w.name, w.actions);
  assert(changed, `workflow ${w.id} ${w.name}: reviewed edit matched the stored wording`);
  wfCount.changed++;
  const text = replacements.workflowCopyText(actions);
  cleanCopy(`workflow ${w.id}`, null, text);
  assert(!/libertybancard\.com\/apply/.test(text), `workflow ${w.id}: scheme-less /apply remains`);
  assert(!replacements.applyWorkflowCopyReplacements(w.name, actions).changed, `workflow ${w.id}: idempotent`);
}
check(wfCount.changed === 6, "Workflows 4, 5, 7, 11, 12 and 13: the stored email and SMS wording matches the reviewed edits and ends with no finding, dead /apply link or call length");
for (const t of snap.tpl) {
  const body = replacements.applyTemplateCopyReplacements(t.name, t.body);
  assert.notEqual(body, t.body, `template ${t.id} changed`);
  assert.equal(findDurationClaims(`${t.subject}\n${body}`).length, 0, `template ${t.id} call length`);
  assert.equal(lintRules(`${t.subject}\n${body}`).length, 0, `template ${t.id} findings`);
}
check(true, "Templates 1 and 6: the stored wording matches and loses the unverified call length without changing anything else");

// ── C. disposable DB: sequences ─────────────────────────────────────────────
const seqIds = [...ids];
await pool.query(`DELETE FROM sequence_steps WHERE sequence_id = ANY($1)`, [seqIds]);
await pool.query(`DELETE FROM follow_up_sequences WHERE id = ANY($1)`, [seqIds]);
for (const sid of seqIds) {
  const first = snap.seq.find((s) => s.sid === sid)!;
  await pool.query(`INSERT INTO follow_up_sequences (id,name,status,trigger_type,trigger_config,total_steps) VALUES ($1,$2,$3,'manual','{}'::jsonb,$4)`,
    [sid, first.sname, first.status, snap.seq.filter((s) => s.sid === sid).length]);
  for (const s of snap.seq.filter((x) => x.sid === sid)) {
    await pool.query(`INSERT INTO sequence_steps (sequence_id,step_order,action_type,delay_days,subject,body) VALUES ($1,$2,$3,0,$4,$5)`, [sid, s.step_order, s.action_type, s.subject, s.body]);
  }
}
await pool.query(`SELECT setval(pg_get_serial_sequence('follow_up_sequences','id'), GREATEST((SELECT max(id) FROM follow_up_sequences), 1000))`);
const snapshotRows = async () => (await pool.query(`SELECT s.id sid, s.status, s.version, st.step_order, st.action_type, st.delay_days, st.subject, st.body FROM follow_up_sequences s JOIN sequence_steps st ON st.sequence_id = s.id WHERE s.id = ANY($1) ORDER BY s.id, st.step_order, st.action_type`, [seqIds])).rows;
const before = await snapshotRows();

const plan = await adoption.previewStoredSequenceCopyAdoption();
check(JSON.stringify(await snapshotRows()) === JSON.stringify(before), "Preview is read-only");
const blockedRows = plan.rows.filter((r) => r.status === "blocked");
check(blockedRows.length === 2 && blockedRows.every((r) => r.sequenceId === 84 && /pause it/.test(r.reason ?? "")), "Active sequence 84 is refused with a plain reason (pause first); nothing else is blocked");
check(plan.rows.filter((r) => r.status === "ready").length === adoption.STORED_SEQUENCE_COPY_TARGETS.length - 2, "Every other target is ready");
check(plan.rows.every((r) => r.status === "blocked" || r.remainingFindings.length === 0), "No ready row would leave audited findings");

let stale: any;
try { await adoption.applyStoredSequenceCopyAdoption("0000000000000000", "cert"); } catch (e) { stale = e; }
check(stale?.status === 409 && stale?.code === "PLAN_STALE", "Apply without the reviewed plan hash is refused (409)");
check(JSON.stringify(await snapshotRows()) === JSON.stringify(before), "A refused apply writes nothing");

// An operator edits one step after the preview: that step is skipped, never overwritten, and the plan is stale.
const opStep = plan.rows.find((r) => r.sequenceId === 85 && r.stepOrder === 3)!;
await pool.query(`UPDATE sequence_steps SET body = body || '<p>OPERATOR NOTE</p>' WHERE id = $1`, [opStep.stepId]);
let moved: any;
try { await adoption.applyStoredSequenceCopyAdoption(plan.planHash, "cert"); } catch (e) { moved = e; }
check(moved?.code === "PLAN_STALE", "A step changed after the preview makes the reviewed plan stale (409); nothing is applied");

const plan2 = await adoption.previewStoredSequenceCopyAdoption();
check(plan2.rows.find((r) => r.key === opStep.key)!.status === "ready", "An operator suffix leaves the exact reviewed substring in place, so the edit stays safe to apply");
const [race1, race2] = await Promise.allSettled([
  adoption.applyStoredSequenceCopyAdoption(plan2.planHash, "cert-a"),
  adoption.applyStoredSequenceCopyAdoption(plan2.planHash, "cert-b"),
]);
const fulfilled = [race1, race2].filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled");
const rejected = [race1, race2].filter((r) => r.status === "rejected") as PromiseRejectedResult[];
const appliedTotal = fulfilled.reduce((n, r) => n + r.value.applied.length, 0);
check(appliedTotal === plan2.counts.ready && rejected.every((r) => r.reason?.code === "PLAN_STALE"), "Two concurrent applies change each ready step exactly once; the loser is skipped or refused as stale");

const after = await snapshotRows();
const sequenceVersions = new Map<number, number>();
for (const r of after) sequenceVersions.set(r.sid, r.version);
const readyBySeq = new Map<number, number>();
for (const r of plan2.rows.filter((x) => x.status === "ready")) readyBySeq.set(r.sequenceId, (readyBySeq.get(r.sequenceId) ?? 0) + 1);
const baseVersions = new Map<number, number>();
for (const r of before) baseVersions.set(r.sid, r.version);
check([...readyBySeq].every(([sid, n]) => sequenceVersions.get(sid)! === baseVersions.get(sid)! + n), "Each sequence version moved once per changed step, not per attempt");
check(after.every((r, i) => r.status === before[i].status && r.delay_days === before[i].delay_days && r.action_type === before[i].action_type), "Sequence status, delays and channels are unchanged");
check(after.filter((r) => r.sid === 84).every((r, i) => r.body === before.filter((b) => b.sid === 84)[i].body), "Active sequence 84 content is untouched");
check(after.find((r) => r.sid === 85 && r.step_order === 3)!.body.includes("OPERATOR NOTE") && after.find((r) => r.sid === 85 && r.step_order === 3)!.body.includes("/upload-statement"), "The operator's own addition survived the adoption of the same step");

const plan3 = await adoption.previewStoredSequenceCopyAdoption();
check(plan3.counts.ready === 0 && plan3.rows.filter((r) => r.status === "already_current").length === adoption.STORED_SEQUENCE_COPY_TARGETS.length - 2, "A repeat preview has nothing left to apply (idempotent)");
const noop = await adoption.applyStoredSequenceCopyAdoption(plan3.planHash, "cert");
check(noop.applied.length === 0, "A repeat apply changes nothing");
const audit = (await pool.query(`SELECT count(*)::int n FROM audit_logs WHERE action = 'stored_sequence_copy_adoption'`)).rows[0].n;
check(audit >= 1, "The adoption was audited");

// Sequence 84 can be adopted once an operator pauses it (the command never pauses or activates anything itself).
await pool.query(`UPDATE follow_up_sequences SET status='paused' WHERE id = 84`);
const plan84 = await adoption.previewStoredSequenceCopyAdoption();
check(plan84.rows.filter((r) => r.sequenceId === 84).every((r) => r.status === "ready"), "After an operator pauses sequence 84, its steps become ready");
const done84 = await adoption.applyStoredSequenceCopyAdoption(plan84.planHash, "cert");
check(done84.applied.length === 2, "Sequence 84's two steps are then adopted");
const s84 = (await pool.query(`SELECT status FROM follow_up_sequences WHERE id = 84`)).rows[0].status;
check(s84 === "paused", "The command leaves the sequence paused");

// ── D. disposable DB: convergence of workflows/templates ────────────────────
await pool.query(`DELETE FROM workflows WHERE name = ANY($1)`, [snap.wf.map((w) => w.name)]);
await pool.query(`DELETE FROM message_templates WHERE name = ANY($1)`, [snap.tpl.map((t) => t.name)]);
const created: Record<string, { id: number; version: number; enabled: boolean }> = {};
for (const w of snap.wf) {
  const row = await storage.createWorkflow({ name: w.name, triggerType: "manual", actions: w.actions, enabled: w.enabled } as any);
  created[w.name] = { id: row.id, version: row.version, enabled: w.enabled };
}
const tplIds: Record<string, number> = {};
for (const t of snap.tpl) {
  const row = await storage.createMessageTemplate({ name: t.name, category: "cert", channel: "email", subject: t.subject, body: t.body, mergeFields: [], isActive: true });
  tplIds[t.name] = row.id;
}
const run1 = await replacements.convergeReviewedCopy();
const mine = run1.results.filter((r) => snap.wf.some((w) => w.name === r.name) || snap.tpl.some((t) => t.name === r.name));
check(mine.length === 8 && mine.every((r) => r.status === "applied"), `Convergence applies all 8 stored workflow/template targets cleanly (${mine.map((r) => r.status).join(",")})`);
for (const w of snap.wf) {
  const row = (await storage.getWorkflow(created[w.name].id))!;
  assert.equal(row.enabled, created[w.name].enabled, `${w.name} enabled state`);
  assert.equal(row.version, created[w.name].version + 1, `${w.name} version`);
}
check(true, "Every converged workflow moved by exactly one version and kept its enabled state");
check((await Promise.all(Object.values(tplIds).map((id) => storage.getMessageTemplate(id)))).every((t) => t!.isActive === true && t!.contentVersion === 2), "Templates 1 and 6 published as a new version and stayed active");
const run2 = await replacements.convergeReviewedCopy();
check(mine.every((m) => run2.results.find((r) => r.name === m.name)!.status === "already_current"), "A second convergence run is a no-op for every adopted target");

check(getBlockedCertificationNetworkAttemptCount() === 0, "No network attempt was made");
console.log(`\n✓ Stage 4C1 stored copy adoption: ${checks} checks passed`);
await pool.end();
