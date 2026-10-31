/**
 * Stage 4C1 content workspace certification (disposable database; no network, no sends).
 * Proves: draft compare-and-swap with 409 recovery metadata for save / discard / publish, expect-absent create, retry
 * receipts, system callers untouched; transport-aware final previews (SFP SMTP, non-cold Gmail) run the real composers;
 * the first-party /book adapter fails closed and redirects only to the validated sales calendar; publishing never
 * changes activation.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { assertDisposableTestInfrastructure } from "../test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary } from "../certification-provider-deny";

await assertDisposableTestInfrastructure({ operation: "Stage 4C1 content workspace certification" });
applyCertificationProviderDenyBoundary({ fatal: true });

const { pool } = await import("../../server/db");
const { storage } = await import("../../server/storage");
const versions = await import("../../server/services/message-template-versions");
const { previewStepForTransport } = await import("../../server/services/message-final-preview");

let checks = 0;
const check = (v: unknown, message: string) => { assert(v, message); checks++; console.log(`✓ [4C1-${String(checks).padStart(2, "0")}] ${message}`); };
const rejects = async (fn: () => Promise<unknown>, status: number, message: string) => {
  try { await fn(); } catch (e: any) { check(e?.status === status, message); return e as any; }
  assert.fail(`${message}: expected rejection`);
};
const id = randomUUID().slice(0, 8);

// ── Draft compare-and-swap ──────────────────────────────────────────────────
const t = await storage.createMessageTemplate({
  name: `4C1 ${id}`, category: "cert", channel: "email", subject: "Subject", body: "<p>Hi {{contact.firstName}}, original.</p>",
  mergeFields: ["contact.firstName"], isActive: false,
});
const A = "admin-a", B = "admin-b";
const first = await versions.saveDraft(t.id, { subject: "S1", body: "<p>One {{contact.firstName}}</p>", baseVersion: 1, expectedDraftToken: null }, A);
check(typeof first.draftToken === "string" && first.draftToken.length > 8, "Creating a draft expecting none returns the draft identity");
const e1 = await rejects(() => versions.saveDraft(t.id, { subject: "S1b", body: "<p>Other</p>", baseVersion: 1, expectedDraftToken: null }, B), 409, "A second create that still expects no draft is refused");
check(e1.conflict?.hasDraft === true && e1.conflict.draftToken === first.draftToken && e1.conflict.liveVersion === 1, "The 409 carries recovery metadata (current identity, live version) and no wording");
check(!JSON.stringify(e1.conflict).includes("One"), "The conflict metadata never includes the other operator's wording");
const second = await versions.saveDraft(t.id, { subject: "S2", body: "<p>Two {{contact.firstName}}</p>", baseVersion: 1, expectedDraftToken: first.draftToken }, A);
check(second.draftToken !== first.draftToken, "Saving with the current identity succeeds and changes the identity");
await rejects(() => versions.saveDraft(t.id, { subject: "S3", body: "<p>Stale</p>", baseVersion: 1, expectedDraftToken: first.draftToken }, B), 409, "Saving with a stale identity is refused");
await rejects(() => versions.discardDraft(t.id, B, { expectedDraftToken: first.draftToken }), 409, "Discarding with a stale identity is refused");
await rejects(() => versions.publishDraft(t.id, { expectedVersion: 1, expectedDraftToken: first.draftToken }, B), 409, "Publishing with a stale identity is refused");
const afterRefusals = await versions.getTemplateWorkspace(t.id);
check(afterRefusals.draft?.body.includes("Two") && afterRefusals.draftToken === second.draftToken && afterRefusals.template.contentVersion === 1, "Refused commands changed nothing");

const published = await versions.publishDraft(t.id, { expectedVersion: 1, expectedDraftToken: second.draftToken }, A);
check(published.contentVersion === 2 && published.replayed === false && published.isActive === false, "Publishing the exact draft the operator saw creates version 2 and leaves activation unchanged");
const replay = await versions.publishDraft(t.id, { expectedVersion: 1, expectedDraftToken: second.draftToken }, A);
check(replay.contentVersion === 2 && replay.replayed === true, "A retried publish after a lost response returns its own receipt and publishes nothing new");
await rejects(() => versions.publishDraft(t.id, { expectedVersion: 1, expectedDraftToken: "0".repeat(24) }, A), 409, "A different token cannot claim the receipt");
const nodraft = await rejects(() => versions.publishDraft(t.id, { expectedVersion: 2, expectedDraftToken: second.draftToken }, A), 409, "Publishing with no draft is a 409 with metadata");
check(nodraft.conflict?.hasDraft === false && nodraft.conflict.liveVersion === 2, "The no-draft conflict says there is no draft");

const third = await versions.saveDraft(t.id, { subject: "S4", body: "<p>Four {{contact.firstName}}</p>", baseVersion: 2, expectedDraftToken: null }, A);
const discarded = await versions.discardDraft(t.id, A, { expectedDraftToken: third.draftToken });
check(discarded.discarded === 1 && (await versions.getTemplateWorkspace(t.id)).draftToken === null, "Discarding with the current identity removes the draft");
const unchecked = await versions.saveDraft(t.id, { subject: "S5", body: "<p>Five {{contact.firstName}}</p>", baseVersion: 2 }, "system");
check(!!unchecked.draftToken, "In-process system callers that pass no expectation stay unchecked (convergence and legacy callers unchanged)");
await versions.discardDraft(t.id, "system");

const audits = await pool.query(`SELECT action FROM audit_logs WHERE entity_type='message_template' AND entity_id=$1 ORDER BY id`, [t.id]);
check(audits.rows.some((r: any) => r.action === "message_template_content_published"), "Publication is audited");

// ── Transport-aware final previews ──────────────────────────────────────────
const stepBody = "Hi {{firstName}}, send your last statement here: https://libertybancard.com/upload-statement";
const smtp = await previewStepForTransport({ subject: "Question for {{companyName}}", body: stepBody, transport: "sfp_smtp" });
check(smtp.ok && smtp.final?.transport.name === "sfp_smtp" && smtp.final.transport.textTransmitted === true && smtp.final.simulation === true, "SFP SMTP preview names its transport, carries a text part and is labelled a simulation");
check(smtp.final?.subject === "Question for Sample Business LLC" && smtp.final.html.includes("Alex"), "SFP SMTP preview renders with the real SFP launch renderer on a sample recipient");
check(smtp.final?.sender.mode === "sender_policy" && !!smtp.final.sender.address && smtp.final.replyTo.mode === "sender_policy", "SFP SMTP preview shows sender-policy From and Reply-To");
check(smtp.final?.signatureCount === 1 && smtp.final.footerCount <= 1, "SFP SMTP preview has exactly one signature and at most one footer");
check(smtp.final?.htmlImagesOff !== undefined && !/<img\b/i.test(smtp.final.htmlImagesOff), "Images-off view contains no image elements");
const badSmtp = await previewStepForTransport({ subject: "Hi", body: "Hello {{estimatedSavings}}", transport: "sfp_smtp" });
check(!badSmtp.ok && !!badSmtp.error && badSmtp.final === null, "A token the real renderer refuses is reported as an error, not previewed");
const gmail = await previewStepForTransport({ subject: "Hello {{contact.firstName}}", body: "<p>Hello {{contact.firstName}}</p>", transport: "gmail_non_cold" });
check(gmail.ok && gmail.final?.transport.name === "gmail_non_cold" && gmail.final.transport.textTransmitted === false && gmail.final.sender.mode === "unknown", "Non-cold Gmail preview is HTML-only and does not invent a sender address");

// ── First-party /book adapter ───────────────────────────────────────────────
const express = (await import("express")).default;
const { registerPublicRoutes } = await import("../../server/routes/public");
const app = express();
app.use(express.json());
await (registerPublicRoutes as any)(app);
const server = http.createServer(app);
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const port = (server.address() as any).port;
const get = (path: string) => new Promise<{ status: number; location?: string; cache?: string; body: string }>((resolve, reject) => {
  http.get({ host: "127.0.0.1", port, path }, (res) => {
    let body = ""; res.on("data", (c) => (body += c));
    res.on("end", () => resolve({ status: res.statusCode ?? 0, location: res.headers.location as string | undefined, cache: res.headers["cache-control"] as string | undefined, body }));
  }).on("error", reject);
});
const KEEP = { u: process.env.GHL_CALENDAR_BOOKING_URL, i: process.env.GHL_DEFAULT_CALENDAR_ID, l: process.env.GHL_DEFAULT_BOOKING_LINK };
const CAL = "CertCalendarId0123456";
process.env.GHL_CALENDAR_BOOKING_URL = `https://api.leadconnectorhq.com/widget/booking/${CAL}`;
process.env.GHL_DEFAULT_CALENDAR_ID = CAL;
delete process.env.GHL_DEFAULT_BOOKING_LINK;
const ok = await get("/book?email=a@b.example&name=Alex");
check(ok.status === 302 && ok.location === `https://api.leadconnectorhq.com/widget/booking/${CAL}` && /no-store/.test(ok.cache ?? ""), "/book redirects to the validated widget URL with no-store");
check(!/a@b\.example|Alex/.test(ok.location ?? ""), "/book never forwards visitor query parameters to the calendar");
process.env.GHL_DEFAULT_CALENDAR_ID = CAL.replace("C", "c");
const disagree = await get("/book");
check(disagree.status === 503 && !disagree.location, "/book fails closed when sources disagree");
delete process.env.GHL_CALENDAR_BOOKING_URL; delete process.env.GHL_DEFAULT_CALENDAR_ID;
const none = await get("/book");
check(none.status === 503 && !none.location, "/book fails closed when nothing is configured (no hardcoded fallback)");
for (const [k, v] of [["GHL_CALENDAR_BOOKING_URL", KEEP.u], ["GHL_DEFAULT_CALENDAR_ID", KEEP.i], ["GHL_DEFAULT_BOOKING_LINK", KEEP.l]] as const) {
  if (v === undefined) delete process.env[k]; else process.env[k] = v;
}
await new Promise<void>((r) => server.close(() => r()));

// ── Grouped workspace overview (read-only; pins resolved at runtime) ─────────
const ws = await import("../../server/services/content-workspace");
check(ws.classify({ assetType: "sequence", name: "SFP Cold Outreach" }, { current: true, nonCurrent: false }).group === "current_sfp", "A current package member is Current SFP regardless of its name");
check(ws.classify({ assetType: "campaign", name: "Cert test campaign" }, { current: false, nonCurrent: false }).group === "diagnostics", "A test-labelled row is Diagnostics, not deleted or retired");
check(ws.classify({ assetType: "sequence", name: "Old", retiredAt: new Date() }, { current: false, nonCurrent: false }).group === "history", "A retired sequence is History");
check(ws.classify({ assetType: "sequence", name: "Merchant onboarding series" }, { current: false, nonCurrent: false }).group === "merchant_lifecycle", "A merchant/onboarding row is Merchant lifecycle");
check(ws.classify({ assetType: "campaign", name: "Education series" }, { current: false, nonCurrent: false }).group === "sales_library", "Everything else is Sales library");
const tag = `4c1ws${id}`;
const mk = async (table: string, name: string, extra = "") => (await pool.query(`INSERT INTO ${table} (name${extra ? ", " + extra.split("=")[0] : ""}) VALUES ($1${extra ? ", " + extra.split("=")[1] : ""}) RETURNING id`, [name])).rows[0].id as number;
const campCur = await mk("campaigns", `Pkg ${tag} current`);
const seqCur = await mk("follow_up_sequences", `Pkg ${tag} current seq`);
const campOld = await mk("campaigns", `Pkg ${tag} old`);
const seqOld = await mk("follow_up_sequences", `Pkg ${tag} old seq`);
for (const [d, n] of [[0, 1], [3, 2], [5, 3]] as const) await pool.query(`INSERT INTO sequence_steps (sequence_id, step_order, action_type, delay_days, subject, body) VALUES ($1,$2,'email',$3,'s','b')`, [seqCur, n, d]);
await pool.query(`INSERT INTO sfp_campaign_package_versions (package_key, vertical, campaign_id, campaign_name, sequence_id, sequence_name, sequence_family, content_hash, lifecycle_state, actor_id) VALUES
  ($1,'Automotive',$2,'c','${seqCur}','s','fam','hash-current-0001','current','cert'), ($3,'Automotive',$4,'c','${seqOld}','s','fam','hash-old-0001','superseded','cert')`, ["sfp.fitness_recreation.v2", campCur, "sfp.fitness_recreation.v2", campOld]);
const before = (await pool.query(`SELECT (SELECT count(*) FROM campaigns) c, (SELECT count(*) FROM follow_up_sequences) s, (SELECT count(*) FROM sequence_enrollments) e, (SELECT count(*) FROM sequence_steps) t`)).rows[0];
const ov = await ws.getContentWorkspaceOverview();
const cur = ov.currentPackages.find((p) => p.campaignId === campCur);
check(!!cur && cur.campaignId === campCur && cur.sequenceId === seqCur && cur.steps === 3 && cur.stepDays.join("/") === "0/3/5", "Current packages are resolved from the package record at request time, with their cadence");
check(ov.groups.history.some((r) => r.id === campOld && r.assetType === "campaign") && ov.groups.history.some((r) => r.id === seqOld), "Superseded package members appear under History");
check(ov.groups.current_sfp.some((r) => r.id === seqCur && r.steps === 3) && !ov.groups.history.some((r) => r.id === seqCur), "Current package members appear only under Current SFP");
check(Object.values(ov.groups).flat().every((r) => r.reason.length > 0), "Every row says why it is in its group");
const after = (await pool.query(`SELECT (SELECT count(*) FROM campaigns) c, (SELECT count(*) FROM follow_up_sequences) s, (SELECT count(*) FROM sequence_enrollments) e, (SELECT count(*) FROM sequence_steps) t`)).rows[0];
check(JSON.stringify(before) === JSON.stringify(after), "Reading the overview changes no campaign, sequence, step or enrollment");

console.log(`STAGE4C1_CONTENT_WORKSPACE_PASS (${checks} checks)`);
await pool.end();
process.exit(0);
