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

const linkFixture = JSON.parse(readFileSync(new URL("./fixtures/stage4c1-link-targets-production-2026-11-01.json", import.meta.url), "utf8")) as {
  steps: Array<{ sid: number; sname: string; status: string; step_order: number; action_type: string; subject: string | null; body: string | null }>;
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
  for (const e of t.body.filter((x) => !x.layered)) assert((row.body ?? "").includes(e.from), `sequence ${t.sequenceId} step ${t.stepOrder}: edit text not found in stored body: ${e.from.slice(0, 60)}`);
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

// ── A2. widget links reconciled by step purpose (stored production wording; address-only edits) ───────────────────────
const SALES = "https://api.leadconnectorhq.com/widget/bookings/libertybancard";
const AM = "https://api.leadconnectorhq.com/widget/booking/kBRoNz5XoTpddupMQg0c";
const anchors = (t: string) => [...t.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([^<]*)<\/a>/g)].map((m) => ({ href: m[1], label: m[2] }));
const BOOKING_LABEL = /\b(book|schedule|reschedule|rebook)\b|grab a quick call|let'?s (talk|chat)|talk to someone/i;
let linkSteps = 0, bookLinks = 0, uploadLinks = 0, smsLinks = 0, leftOnWidget = 0;
for (const t of adoption.STORED_SEQUENCE_LINK_TARGETS) {
  const row = linkFixture.steps.find((x) => x.sid === t.sequenceId && x.step_order === t.stepOrder && x.action_type === t.channel);
  assert(row && row.sname === t.sequenceName, `link fixture has sequence ${t.sequenceId} step ${t.stepOrder} under the stored name`);
  const res = adoption.planStepCopy(t, row);
  assert(res.changed, `sequence ${t.sequenceId} step ${t.stepOrder}: a link is retargeted`);
  assert.equal(res.subject, row.subject, "subject untouched");
  const reverted = t.channel === "sms" ? res.body!.split("https://libertybancard.com/book").join(SALES) : res.body!;
  if (t.channel === "sms") assert.equal(reverted, row.body, `sequence ${t.sequenceId} step ${t.stepOrder}: only the link address changed`);
  assert(!res.body!.includes("[object") , "no corruption");
  assert(!adoption.planStepCopy(t, { subject: res.subject, body: res.body }).changed, "idempotent");
  if (t.channel === "sms") { assert(!res.body!.includes(SALES) && res.body!.includes("https://libertybancard.com/book")); smsLinks++; }
  else {
    const was = anchors(row.body!), now = anchors(res.body!);
    assert.equal(was.length, now.length, "anchor count unchanged");
    was.forEach((w, i) => {
      assert.equal(now[i].label, w.label, "anchor label unchanged");
      const wanted = t.retarget === "book" ? (w.href === SALES && BOOKING_LABEL.test(w.label)) : (w.href === SALES && /\bupload\b/i.test(w.label));
      const dest = t.retarget === "book" ? "https://libertybancard.com/book" : "https://libertybancard.com/upload-statement";
      assert.equal(now[i].href, wanted ? dest : w.href, `sequence ${t.sequenceId} step ${t.stepOrder}: ${w.label}`);
      if (wanted) (t.retarget === "book" ? bookLinks++ : uploadLinks++); else if (w.href === SALES) leftOnWidget++;
    });
    assert.equal(res.body!.replace(/https:\/\/libertybancard\.com\/(book|upload-statement)/g, "X"), row.body!.replace(new RegExp(SALES.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "X").replace(/https:\/\/libertybancard\.com\/(book|upload-statement)/g, "X"), "nothing but link addresses changed");
  }
  linkSteps++;
}
check(linkSteps === adoption.STORED_SEQUENCE_LINK_TARGETS.length && bookLinks > 0 && uploadLinks > 0 && smsLinks > 0,
  `Link reconciliation against stored wording: ${linkSteps} steps (${bookLinks} booking links to /book, ${uploadLinks} upload links to secure upload, ${smsLinks} SMS), labels and surrounding wording unchanged, idempotent`);
check(adoption.STORED_SEQUENCE_LINK_TARGETS.every((t) => ![23, 37, 57, 60, 63, 66, 69, 72, 75, 78, 81, 1150, 1151].includes(t.sequenceId)) && adoption.STORED_SEQUENCE_LINK_TARGETS.every((t) => !(t.retarget === "upload" && /\/book\b/.test(t.intent))),
  "Account Management sequences, existing-merchant review sequences and referral sequences are not link targets; upload steps never become booking steps");
const amStep = `<p><a href="${AM}" style="x">Contact Your AM</a> <a href="${SALES}">Book a Call</a> <a href="${SALES}">Submit a Referral</a> <a href="${SALES}">Upload a Statement</a> <a href="${SALES}">Finish Your Application</a></p>`;
const lt = (retarget: "book" | "upload") => ({ ...adoption.STORED_SEQUENCE_LINK_TARGETS[0], retarget, body: [], channel: "email" as const });
const bookOut = adoption.planStepCopy(lt("book") as any, { subject: null, body: amStep }).body!;
const upOut = adoption.planStepCopy(lt("upload") as any, { subject: null, body: amStep }).body!;
check(bookOut.includes(AM) && anchors(bookOut).map((a) => a.href).join() === [AM, "https://libertybancard.com/book", SALES, SALES, SALES].join(), "A booking edit leaves the Account Management calendar and referral, upload and application links alone");
check(upOut.includes(AM) && anchors(upOut).map((a) => a.href).join() === [AM, SALES, SALES, "https://libertybancard.com/upload-statement", SALES].join(), "An upload edit changes only the upload-labelled link");
console.log(`  (left on the sales widget by label: ${leftOnWidget} anchors in link-target steps)`);

// Review revision: the three previously review-only claims are replaced with neutral wording, from the original wording
// (fresh install) and from the wording already adopted in production on 2026-11-01 (layered state).
const adopted = JSON.parse(readFileSync(new URL("./fixtures/stage4c1-adopted-state-production-2026-11-01.json", import.meta.url), "utf8")) as {
  steps: Array<{ sid: number; step_order: number; action_type: string; subject: string | null; body: string | null }>;
};
const targetOf = (sid: number, order: number) => adoption.STORED_SEQUENCE_COPY_TARGETS.find((x) => x.sequenceId === sid && x.stepOrder === order)!;
for (const [sid, order] of [[36, 8], [93, 1]] as const) {
  const state = adopted.steps.find((x) => x.sid === sid && x.step_order === order)!;
  const t = targetOf(sid, order);
  const layered = adoption.planStepCopy(t, state);
  assert(layered.changed, `sequence ${sid} step ${order}: the review revision applies to the already-adopted production wording`);
  cleanCopy(`sequence ${sid} step ${order} (adopted state)`, layered.subject, layered.body);
  const fresh = out(sid, order, "email");
  assert.equal(`${layered.subject}\n${layered.body}`, `${fresh.subject}\n${fresh.body}`, `sequence ${sid} step ${order}: fresh and already-adopted rows converge on identical wording`);
  assert(!adoption.planStepCopy(t, { subject: layered.subject, body: layered.body }).changed, "idempotent after the revision");
}
check(true, "Sequence 36 step 8 and sequence 93 step 1: the review revision applies to the stored production wording and fresh rows converge on identical text");
const c36 = out(36, 8, "email"), c84 = out(84, 3, "email"), c93 = out(93, 1, "email");
check(!/recommend|recommendedTerminal|great fit|Optimized for|tap, chip|receipt printing|free terminal|under an hour/i.test(`${c36.subject}${c36.body}`) && /equipment options that fit your requirements/.test(c36.body!) && /confirmed during your review, before you decide/.test(c36.body!),
  "Sequence 36 step 8: no automatic terminal recommendation, feature or fit claim; equipment options are confirmed during the review");
check(!/3.5 business|live within|within \d/i.test(c84.body!) && /Timing depends on the application, underwriting, processor and setup requirements/.test(c84.body!) && hrefs(c84.body!).includes("https://libertybancard.com/book"),
  "Sequence 84 step 3: no go-live promise; timing depends on application, underwriting and setup; booking still goes to /book");
check(!/referral credit|thank-you|credit/i.test(c93.body!) && /eligibility and terms before a referral is submitted/.test(c93.body!) && !/their name/i.test(c93.body!),
  "Sequence 93 step 1: no referral-credit promise and no request for another person's details; eligibility and terms are explained before submission");

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
const seqIds = [...new Set(adoption.ALL_STORED_SEQUENCE_TARGETS.map((t) => t.sequenceId))];
async function seed() {
  await pool.query(`DELETE FROM sfp_campaign_package_versions WHERE sequence_id = ANY($1)`, [seqIds]);
  await pool.query(`DELETE FROM sequence_steps WHERE sequence_id = ANY($1)`, [seqIds]);
  await pool.query(`DELETE FROM follow_up_sequences WHERE id = ANY($1)`, [seqIds]);
  for (const sid of seqIds) {
    const mine = snap.seq.filter((s) => s.sid === sid).map((s) => ({ sid, sname: s.sname, status: s.status, step_order: s.step_order, action_type: s.action_type, subject: s.subject, body: s.body }));
    for (const l of linkFixture.steps.filter((x) => x.sid === sid)) if (!mine.some((m) => m.step_order === l.step_order && m.action_type === l.action_type)) mine.push(l);
    await pool.query(`INSERT INTO follow_up_sequences (id,name,status,trigger_type,trigger_config,total_steps) VALUES ($1,$2,$3,'manual','{}'::jsonb,$4)`, [sid, mine[0].sname, mine[0].status, mine.length]);
    for (const s of mine) {
      await pool.query(`INSERT INTO sequence_steps (sequence_id,step_order,action_type,delay_days,subject,body) VALUES ($1,$2,$3,0,$4,$5)`, [sid, s.step_order, s.action_type, s.subject, s.body]);
    }
  }
  await pool.query(`SELECT setval(pg_get_serial_sequence('follow_up_sequences','id'), GREATEST((SELECT max(id) FROM follow_up_sequences), 1000))`);
}
await seed();
const snapshotRows = async () => (await pool.query(`SELECT s.id sid, s.status, s.version, st.step_order, st.action_type, st.delay_days, st.subject, st.body FROM follow_up_sequences s JOIN sequence_steps st ON st.sequence_id = s.id WHERE s.id = ANY($1) ORDER BY s.id, st.step_order, st.action_type`, [seqIds])).rows;
const before = await snapshotRows();

const plan = await adoption.previewStoredSequenceCopyAdoption();
check(JSON.stringify(await snapshotRows()) === JSON.stringify(before), "Preview is read-only");
const blockedRows = plan.rows.filter((r) => r.status === "blocked");
check(blockedRows.length === 2 && blockedRows.every((r) => r.sequenceId === 84 && /pause it/.test(r.reason ?? "")), "Active sequence 84 is refused with a plain reason (pause first); nothing else is blocked");
check(plan.rows.filter((r) => r.status === "ready").length === adoption.ALL_STORED_SEQUENCE_TARGETS.length - 2, "Every other target is ready");
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
check(plan3.counts.ready === 0 && plan3.rows.filter((r) => r.status === "already_current").length === adoption.ALL_STORED_SEQUENCE_TARGETS.length - 2, "A repeat preview has nothing left to apply (idempotent)");
const noop = await adoption.applyStoredSequenceCopyAdoption(plan3.planHash, "cert");
check(noop.applied.length === 0, "A repeat apply changes nothing");
const audit = (await pool.query(`SELECT count(*)::int n FROM audit_logs WHERE action = 'stored_sequence_copy_adoption'`)).rows[0].n;
check(audit >= 1, "The adoption was audited");
const stepReceipts = (await pool.query(`SELECT entity_id, actor_id, details, before_state, after_state FROM audit_logs WHERE action = 'stored_sequence_step_copy_adopted'`)).rows;
check(stepReceipts.length === plan2.counts.ready && new Set(stepReceipts.map((r) => r.entity_id)).size === plan2.counts.ready,
  `Every adopted step has exactly one durable per-step receipt (${stepReceipts.length}), including after the concurrent race`);
const sampleReceipt = stepReceipts.find((r) => r.details?.key === "85:1:email")!;
const sampleRow = plan2.rows.find((r) => r.key === "85:1:email")!;
check(sampleReceipt.details.planHash === plan2.planHash && sampleReceipt.before_state.wordingDigest === sampleRow.oldHash && sampleReceipt.after_state.wordingDigest === sampleRow.newHash && /^cert-/.test(sampleReceipt.actor_id),
  "A per-step receipt records actor, plan hash, sequence/step identity and the old and new wording hashes");

// Sequence 84 can be adopted once an operator pauses it (the command never pauses or activates anything itself).
await pool.query(`UPDATE follow_up_sequences SET status='paused' WHERE id = 84`);
const plan84 = await adoption.previewStoredSequenceCopyAdoption();
check(plan84.rows.filter((r) => r.sequenceId === 84).every((r) => r.status === "ready"), "After an operator pauses sequence 84, its steps become ready");
const done84 = await adoption.applyStoredSequenceCopyAdoption(plan84.planHash, "cert");
check(done84.applied.length === 2, "Sequence 84's two steps are then adopted");
const s84 = (await pool.query(`SELECT status FROM follow_up_sequences WHERE id = 84`)).rows[0].status;
check(s84 === "paused", "The command leaves the sequence paused");

// ── C2. receipt failure rolls the step back (fault injected in the disposable database only) ─────────────────────────
await seed();
await pool.query(`UPDATE follow_up_sequences SET status='paused' WHERE id = 84`);
const faultPlan = await adoption.previewStoredSequenceCopyAdoption();
check(faultPlan.counts.ready === adoption.ALL_STORED_SEQUENCE_TARGETS.length, "Fault test starts from a clean seed with every target ready");
const faultRow = faultPlan.rows.find((r) => r.key === "91:2:sms")!;
const readyOrder = faultPlan.rows.filter((r) => r.status === "ready").map((r) => r.key);
const beforeFault = await snapshotRows();
await pool.query(`CREATE OR REPLACE FUNCTION cert_fail_step_receipt() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN
  IF NEW.action = 'stored_sequence_step_copy_adopted' AND NEW.entity_id = ${Number(faultRow.stepId)} THEN RAISE EXCEPTION 'cert injected receipt failure'; END IF; RETURN NEW; END $f$`);
await pool.query(`CREATE TRIGGER cert_fail_step_receipt BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION cert_fail_step_receipt()`);
let faulted: any;
try { await adoption.applyStoredSequenceCopyAdoption(faultPlan.planHash, "cert-fault"); } catch (e) { faulted = e; }
check(faulted && !(faulted instanceof adoption.SequenceCopyAdoptionError) && /cert injected receipt failure|Failed query/.test(`${faulted.message} ${faulted.cause?.message ?? ""}`), "A receipt that cannot be written fails the apply loudly (not a silent skip)");
const faultAfter = await snapshotRows();
const rowFor = (rows: any[], key: string) => { const [sid, order, ch] = key.split(":"); const { version: _sequenceVersion, ...step } = rows.find((r) => r.sid === Number(sid) && r.step_order === Number(order) && r.action_type === ch); return step; };
check(JSON.stringify(rowFor(faultAfter, faultRow.key)) === JSON.stringify(rowFor(beforeFault, faultRow.key)), "The step whose receipt failed is byte-identical to before (wording rolled back)");
const faultSeqBefore = beforeFault.find((r) => r.sid === faultRow.sequenceId)!.version, faultSeqAfter = faultAfter.find((r) => r.sid === faultRow.sequenceId)!.version;
const committedBefore = readyOrder.slice(0, readyOrder.indexOf(faultRow.key));
check(faultSeqAfter === faultSeqBefore + committedBefore.filter((k) => k.startsWith(`${faultRow.sequenceId}:`)).length, "The failed step did not advance its sequence version");
const faultReceipts = (await pool.query(`SELECT entity_id FROM audit_logs WHERE action = 'stored_sequence_step_copy_adopted' AND actor_id = 'cert-fault'`)).rows.map((r) => r.entity_id);
check(committedBefore.length > 0 && faultReceipts.length === committedBefore.length && committedBefore.every((k) => faultReceipts.includes(faultPlan.rows.find((r) => r.key === k)!.stepId)),
  `Steps committed before the failure (${committedBefore.length}) each have a durable receipt; none exists for the failed step`);
check(!faultReceipts.includes(faultRow.stepId), "No receipt row exists for the rolled-back step");
check((await pool.query(`SELECT details FROM audit_logs WHERE action = 'stored_sequence_copy_adoption' AND actor_id = 'cert-fault'`)).rows[0]?.details?.interrupted === true, "The batch summary truthfully records that the run was interrupted");
const unreached = readyOrder.slice(readyOrder.indexOf(faultRow.key));
check(unreached.every((k) => JSON.stringify(rowFor(faultAfter, k)) === JSON.stringify(rowFor(beforeFault, k))), "The failed step and every step after it are untouched");
let replay: any;
try { await adoption.applyStoredSequenceCopyAdoption(faultPlan.planHash, "cert-replay"); } catch (e) { replay = e; }
check(replay?.code === "PLAN_STALE", "Replaying the old plan is refused (409): committed steps cannot be applied a second time");
await pool.query(`DROP TRIGGER cert_fail_step_receipt ON audit_logs`);
await pool.query(`DROP FUNCTION cert_fail_step_receipt()`);
const retryPlan = await adoption.previewStoredSequenceCopyAdoption();
check(retryPlan.rows.filter((r) => r.status === "already_current").length === committedBefore.length && retryPlan.counts.ready === unreached.length, "After the fault is cleared the fresh preview reports committed steps as already current and the rest as ready");
const retry = await adoption.applyStoredSequenceCopyAdoption(retryPlan.planHash, "cert-retry");
check(retry.applied.length === unreached.length && retry.applied.every((k) => unreached.includes(k)), "The retry applies only the unfinished steps");
const allReceipts = (await pool.query(`SELECT entity_id, count(*)::int n FROM audit_logs WHERE action = 'stored_sequence_step_copy_adopted' AND actor_id IN ('cert-fault','cert-retry') GROUP BY entity_id`)).rows;
check(allReceipts.length === adoption.ALL_STORED_SEQUENCE_TARGETS.length && allReceipts.every((r) => r.n === 1), "Across the failed run and the retry every step has exactly one receipt and was changed exactly once");

// ── C3. a current SFP pin blocks adoption (the admin adoption writer, not the generic route) ────────────────────────
await seed();
const PIN_CAMPAIGN = 920101;
await pool.query(`DELETE FROM sfp_campaign_package_versions WHERE campaign_id = $1`, [PIN_CAMPAIGN]);
await pool.query(`DELETE FROM campaigns WHERE id = $1`, [PIN_CAMPAIGN]);
await pool.query(`INSERT INTO campaigns (id,name,status,created_by) VALUES ($1,'SCA pin campaign','paused','cert-admin')`, [PIN_CAMPAIGN]);
const pinSeq = 85;
const pinPlanBefore = await adoption.previewStoredSequenceCopyAdoption();
check(pinPlanBefore.rows.filter((r) => r.sequenceId === pinSeq).every((r) => r.status === "ready"), "Before the pin, the paused sequence's steps are ready");
await pool.query(`INSERT INTO sfp_campaign_package_versions (package_key,vertical,campaign_id,campaign_name,sequence_id,sequence_name,sequence_family,content_hash,lifecycle_state,effective_at,actor_id)
  VALUES ('sfp.retail.v1','retail',$1,'SCA pin campaign',$2,'pinned','sfp-v2-cold-retail','hash','current',now(),'cert')`, [PIN_CAMPAIGN, pinSeq]);
const pinnedStateBefore = await snapshotRows();
const receiptsBeforePin = Number((await pool.query(`SELECT count(*)::int n FROM audit_logs WHERE action LIKE 'stored_sequence_%copy%adopt%'`)).rows[0].n);
let replayPin: any;
try { await adoption.applyStoredSequenceCopyAdoption(pinPlanBefore.planHash, "cert-pin"); } catch (e) { replayPin = e; }
check(replayPin?.code === "PLAN_STALE", "A plan previewed before the pin cannot be replayed to bypass it (409)");
check(JSON.stringify(await snapshotRows()) === JSON.stringify(pinnedStateBefore) && Number((await pool.query(`SELECT count(*)::int n FROM audit_logs WHERE action LIKE 'stored_sequence_%copy%adopt%'`)).rows[0].n) === receiptsBeforePin,
  "The refused replay changed no step, version or audit row");
const pinPlan = await adoption.previewStoredSequenceCopyAdoption();
const pinRows = pinPlan.rows.filter((r) => r.sequenceId === pinSeq);
check(pinRows.length === 3 && pinRows.every((r) => r.status === "blocked" && /current SFP package/.test(r.reason ?? "")), "A paused sequence in a current SFP package is blocked with the package-publication reason");
const pinApply = await adoption.applyStoredSequenceCopyAdoption(pinPlan.planHash, "cert-pin");
const pinAfter = await snapshotRows();
check(pinApply.skipped.filter((x) => x.key.startsWith(`${pinSeq}:`)).length === 3 && !pinApply.applied.some((k) => k.startsWith(`${pinSeq}:`)), "Apply reports the pinned steps as skipped, not applied");
check(JSON.stringify(pinAfter.filter((r) => r.sid === pinSeq)) === JSON.stringify(pinnedStateBefore.filter((r) => r.sid === pinSeq)), "Zero step or version mutation on the pinned sequence");
const pinReceipts = (await pool.query(`SELECT count(*)::int n FROM audit_logs WHERE action = 'stored_sequence_step_copy_adopted' AND actor_id = 'cert-pin' AND details->>'sequenceId' = $1`, [String(pinSeq)])).rows[0].n;
check(pinReceipts === 0, "Zero audit receipts exist for the pinned sequence");
const unpinnedApplied = pinPlan.rows.filter((r) => r.sequenceId !== pinSeq && r.status === "ready").map((r) => r.key);
check(unpinnedApplied.length > 0 && unpinnedApplied.every((k) => pinApply.applied.includes(k)) && pinApply.applied.length === unpinnedApplied.length, "Unpinned sequences still adopt in the same run");
// Superseding the pin releases it.
await pool.query(`UPDATE sfp_campaign_package_versions SET lifecycle_state='superseded', superseded_at=now() WHERE campaign_id=$1`, [PIN_CAMPAIGN]);
const released = await adoption.previewStoredSequenceCopyAdoption();
check(released.rows.filter((r) => r.sequenceId === pinSeq).every((r) => r.status === "ready"), "A superseded pin no longer blocks the sequence");
await pool.query(`DELETE FROM sfp_campaign_package_versions WHERE campaign_id = $1`, [PIN_CAMPAIGN]);
await pool.query(`DELETE FROM campaigns WHERE id = $1`, [PIN_CAMPAIGN]);

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
