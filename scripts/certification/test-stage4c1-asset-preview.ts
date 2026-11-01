/**
 * Stage 4C1 asset-addressed final preview certification (R06) — disposable database; no network, no sends.
 *
 * The preview of a stored legacy sequence/campaign step is addressed by asset identity. The server, not the caller,
 * resolves transport, signature and substitution, and runs the same interpolation the worker/engine run.
 */
import assert from "node:assert/strict";
import { assertDisposableTestInfrastructure } from "../test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary, getBlockedCertificationNetworkAttemptCount } from "../certification-provider-deny";

await assertDisposableTestInfrastructure({ operation: "Stage 4C1 asset preview certification" });
process.env.VG_PROVIDER_DENY_MODE = "1";
applyCertificationProviderDenyBoundary({ fatal: true });

const { pool } = await import("../../server/db");
const { previewAssetStep } = await import("../../server/services/message-final-preview");
const { getEmailSignatureHtml } = await import("../../server/services/email-signatures");
const { interpolateSequenceText } = await import("../../server/services/sequence-step-interpolation");
const { resolveSalesBooking } = await import("../../server/services/message-cta-contract");
const { SFP_LAUNCH_SEQUENCE_FAMILY_PREFIX } = await import("../../server/services/cro03/sfp-launch-content");

let checks = 0;
const check = (v: unknown, message: string) => { assert(v, message); checks++; console.log(`✓ [AP-${String(checks).padStart(2, "0")}] ${message}`); };

const { storage } = await import("../../server/storage");
await storage.setSystemSetting("compliance_mailing_address", "100 Certification Way, Miami, FL 33101");
const BASE = 910000;
const seq = async (id: number, name: string, family: string | null, trigger: string, category: string, steps: Array<{ order: number; type: string; subject: string | null; body: string; config?: object }>) => {
  await pool.query(`DELETE FROM sequence_steps WHERE sequence_id = $1`, [id]);
  await pool.query(`DELETE FROM follow_up_sequences WHERE id = $1`, [id]);
  await pool.query(`INSERT INTO follow_up_sequences (id,name,status,trigger_type,trigger_config,sequence_family,total_steps) VALUES ($1,$2,'paused',$3,$4::jsonb,$5,$6)`, [id, name, trigger, JSON.stringify({ category }), family, steps.length]);
  const ids: number[] = [];
  for (const s of steps) {
    const r = await pool.query(`INSERT INTO sequence_steps (sequence_id,step_order,action_type,delay_days,subject,body,config) VALUES ($1,$2,$3,0,$4,$5,$6::jsonb) RETURNING id`, [id, s.order, s.type, s.subject, s.body, JSON.stringify(s.config ?? {})]);
    ids.push(r.rows[0].id);
  }
  return ids;
};
const [coldIds] = [await seq(BASE + 1, "AP cold sales", null, "contact_created", "sales", [
  { order: 1, type: "email", subject: "Hi {{firstName}}", body: "<p>Hello {{firstName}} at {{companyName}}.</p><p><a href=\"https://libertybancard.com/upload-statement\">Upload</a></p>" },
  { order: 2, type: "email", subject: "Savings", body: "<p>You could save {{estimatedSavings}}.</p>" },
  { order: 3, type: "email", subject: "Old link", body: "<p><a href=\"https://libertybancard.com/apply\">Apply</a></p>" },
  { order: 4, type: "sms", subject: null, body: "Hi {{firstName}}" },
  { order: 5, type: "email", subject: "Book", body: "<p>Pick a time: {{calendarLink}}</p>" },
])];
const [accIds] = [await seq(BASE + 2, "AP accounts", "closed_won", "manual", "operations", [
  { order: 1, type: "email", subject: "Welcome {{firstName}}", body: "<p>Thanks, {{companyName}}.</p>" },
])];
const [sfpIds] = [await seq(BASE + 3, "AP sfp launch", `${SFP_LAUNCH_SEQUENCE_FAMILY_PREFIX}retail`, "manual", "sales", [
  { order: 1, type: "email", subject: "Quick question", body: "Hello,\n\nShort plain text.", config: { format: "plain_text" } },
])];
await pool.query(`DELETE FROM campaigns WHERE id = $1`, [BASE + 4]);
await pool.query(`DELETE FROM campaign_steps WHERE campaign_id = $1`, [BASE + 4]);
await pool.query(`INSERT INTO campaigns (id,name,status,ai_personalization) VALUES ($1,'AP campaign','draft',true)`, [BASE + 4]);
const campStep = async (order: number, subject: string, body: string, channel = "email") =>
  (await pool.query(`INSERT INTO campaign_steps (campaign_id,step_order,step_type,subject,body_template,channel) VALUES ($1,$2,'email',$3,$4,$5) RETURNING id`, [BASE + 4, order, subject, body, channel])).rows[0].id as number;
const cs1 = await campStep(1, "{{first_name}}, a question", "<p>Hi {{first_name}} at {{company_name}} in {{city}}. {{unknown_token}}</p>");
const cs2 = await campStep(2, "SMS", "text", "sms");

const before = (await pool.query(`SELECT (SELECT count(*) FROM sequence_steps) a, (SELECT count(*) FROM outbound_messages) b, (SELECT count(*) FROM audit_logs) c`)).rows[0];

// Cold legacy sequence: sales signature, SMTP composition, worker substitution.
const cold = await previewAssetStep({ assetType: "sequence", assetId: BASE + 1, stepId: coldIds[0] });
check(cold.ok && cold.final?.transport.name === "legacy_smtp" && cold.asset?.signature === "sales", "A cold legacy sequence step previews through the SMTP composition with the sales signature");
check(cold.final!.subject === "Hi Alex" && cold.final!.html.includes("Hello Alex at Sample Business LLC"), "The worker's {{firstName}}/{{companyName}} substitution is applied to subject and body");
check(cold.final!.text.length > 0 && cold.final!.footer.state === "applied" && cold.final!.signatureCount === 1, "The plain-text part is built and exactly one signature is present");
check(cold.final!.html.includes(getEmailSignatureHtml("sales").slice(0, 80)), "The sales signature is the one the worker appends for this category");
const sav = await previewAssetStep({ assetType: "sequence", assetId: BASE + 1, stepId: coldIds[1] });
check(!sav.ok && sav.error?.code === "WORKER_WOULD_BLOCK" && /estimatedSavings/.test(sav.error.detail) && sav.final === null, "A step that still uses {{estimatedSavings}} is shown as blocked, exactly as the worker would block it");
const old = await previewAssetStep({ assetType: "sequence", assetId: BASE + 1, stepId: coldIds[2] });
check(!old.ok && old.error?.code === "WORKER_WOULD_BLOCK" && /retired|link/i.test(old.error.detail), "A retired first-party link is shown as blocked by the final link gate");
const sms = await previewAssetStep({ assetType: "sequence", assetId: BASE + 1, stepId: coldIds[3] });
check(!sms.ok && sms.error?.code === "UNSUPPORTED_CHANNEL", "An SMS step is refused rather than rendered as an email");
const booking = await previewAssetStep({ assetType: "sequence", assetId: BASE + 1, stepId: coldIds[4] });
const available = resolveSalesBooking(process.env).available;
check(available ? booking.ok && booking.final!.html.includes("/book") : !booking.ok && booking.error?.code === "WORKER_WOULD_BLOCK" && booking.warnings.length === 1, `Booking: ${available ? "resolves to the first-party /book address" : "unconfigured sales booking blocks the step and says why"}`);

// Non-cold sequence: Gmail composition and the category's own signature.
const acc = await previewAssetStep({ assetType: "sequence", assetId: BASE + 2, stepId: accIds[0] });
check(acc.ok && acc.final?.transport.name === "gmail_non_cold" && acc.asset?.signature === "accounts" && acc.final!.text === "", "A non-cold sequence previews through the Gmail composition (HTML only) with the accounts signature");
check(acc.final!.html.includes(getEmailSignatureHtml("accounts").slice(0, 80)) && !acc.final!.html.includes("Get Your Free Savings Analysis"), "The account-management signature carries no cold sales block");

// SFP launch sequence: SFP renderer plus SMTP, no legacy signature.
const sfp = await previewAssetStep({ assetType: "sequence", assetId: BASE + 3, stepId: sfpIds[0] });
check(sfp.ok && sfp.final?.transport.name === "sfp_smtp" && /SFP launch/.test(sfp.asset!.path), "An SFP launch step is previewed with the SFP renderer and SMTP composer");

// Unsaved editor text is previewed, not stored text; the stored row is untouched.
const draft = await previewAssetStep({ assetType: "sequence", assetId: BASE + 1, stepId: coldIds[0], draft: { subject: "Draft {{firstName}}", body: "<p>Draft body</p>" } });
check(draft.ok && draft.final!.subject === "Draft Alex" && draft.final!.html.includes("Draft body") && !draft.final!.html.includes("Hello Alex"), "In-editor draft text is what the preview shows");

// Identity is resolved from the asset: wrong pairings and unknown ids are refused.
check((await previewAssetStep({ assetType: "sequence", assetId: BASE + 2, stepId: coldIds[0] })).error?.code === "STEP_NOT_FOUND", "A step id from another sequence is not accepted");
check((await previewAssetStep({ assetType: "sequence", assetId: BASE + 99, stepId: 1 })).error?.code === "ASSET_NOT_FOUND", "An unknown sequence is refused");

// Same code as the worker: the preview and the worker share the interpolation function.
const values = { firstName: "Alex", lastName: "S", companyName: "C", email: "e@x.example", industry: "i", monthlyVolume: "m", currentProcessor: "p", recommendedProgram: "r", recommendedTerminal: "t", serviceType: "s", estimatedVolume: "v", agentName: "n", agentEmail: "ae@x.example", agentPhone: "1", businessName: "C", calendarLink: null };
let sensitive = ""; try { interpolateSequenceText("{{agentEmail}} {{agentFoo}}", { ...values, agentEmail: "" }, "x"); } catch (e: any) { sensitive = e.message; }
check(/unresolved sensitive placeholder/.test(sensitive) || sensitive === "" && false, "A leftover agent placeholder is a hard block in the shared function");
const workerSrc = (await import("node:fs")).readFileSync(new URL("../../server/services/sequence-worker.ts", import.meta.url), "utf8");
check(/interpolateSequenceText\(text, \{/.test(workerSrc) && !/\.replace\(\/\\\{\\\{firstName\\\}\\\}\/g/.test(workerSrc), "The worker calls the shared interpolation and no longer carries a private copy");

// Campaign: merge fields, sales signature, SMTP; leftover tokens and AI rewrite are disclosed.
const camp = await previewAssetStep({ assetType: "campaign", assetId: BASE + 4, stepId: cs1 });
check(camp.ok && camp.final?.transport.name === "legacy_smtp" && camp.final!.subject === "Alex, a question" && camp.final!.html.includes("Hi Alex at Sample Business LLC in Miami"), "A legacy campaign step applies the engine's merge fields and sales signature");
check(camp.warnings.some((w) => w.includes("{{unknown_token}}") && /literally/.test(w)) && camp.warnings.some((w) => /AI personalization is on/.test(w)) && camp.asset?.aiPersonalization === true, "A token the campaign path would send literally, and the AI rewrite, are both disclosed");
check((await previewAssetStep({ assetType: "campaign", assetId: BASE + 4, stepId: cs2 })).error?.code === "UNSUPPORTED_CHANNEL", "A campaign SMS step is refused");
check((await previewAssetStep({ assetType: "campaign", assetId: BASE + 4, stepId: 2000000000 })).error?.code === "STEP_NOT_FOUND", "A step id that is not in this campaign is not accepted");

const after = (await pool.query(`SELECT (SELECT count(*) FROM sequence_steps) a, (SELECT count(*) FROM outbound_messages) b, (SELECT count(*) FROM audit_logs) c`)).rows[0];
check(JSON.stringify(before) === JSON.stringify(after), "Previewing writes nothing: no step, outbound message or audit row changed");
check(getBlockedCertificationNetworkAttemptCount() === 0, "No network attempt was made");
console.log(`\n✓ Stage 4C1 asset preview: ${checks} checks passed`);
await pool.end();
