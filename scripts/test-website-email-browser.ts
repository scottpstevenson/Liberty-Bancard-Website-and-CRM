import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { randomInt, randomUUID } from "node:crypto";
import { stage3BHttpFixture } from "./fixtures/stage3-b-http";
import { privateStage3Browser } from "./fixtures/private-stage3-browser";
import { verifyCandidateIdentity } from "./fixtures/candidate-build-identity";

// Website email lifecycle lane, real private Chromium against the REAL handlers on a disposable database.
// Covers: Sequences warm-content panel (create frozen copy, unsupported-step blocking, HTML/plain/link preview, approve),
// Outbound readiness lane card (read facts, blocked open preview with reasons, closed configuration save, reload),
// Activation panel summary, role matrix (admin/manager/agent plus merchant, partner and affiliate negatives) at 1280, 768 and 390
// in light and dark, and the public Estimate, Get Started, Free Analysis and newsletter consent surfaces (checked, unchecked, request failure).
// Nothing here opens the lane, sends mail, probes a provider, unpauses outbound, activates a sequence or enrolls a contact.
// NOT EXERCISED: ContactBubble and the HelpCenter callback panel (a callback without an email address writes no consent; covered by the disposable-database certification);
// a login-to-different-login switch (the live demotion of one session is exercised in B2).
const identity = await verifyCandidateIdentity();
const dir = "docs/certification/website-email/browser";
const h = await stage3BHttpFixture(async app => {
  const { registerPublicRoutes } = await import("../server/routes/public");
  registerPublicRoutes(app);
  const { registerImportsRoutes } = await import("../server/routes/imports");
  registerImportsRoutes(app);
  const { registerWebsiteEmailRoutes } = await import("../server/routes/website-email");
  registerWebsiteEmailRoutes(app);
  const { registerCampaignsRoutes } = await import("../server/routes/campaigns");
  registerCampaignsRoutes(app);
  app.use("/api", (_req, res) => res.status(501).json({ message: "Unregistered isolated service" }));
  const { static: serveStatic } = await import("express");
  app.use(serveStatic("dist/public"));
  app.use((_req, res) => res.sendFile("index.html", { root: `${process.cwd()}/dist/public` }));
}, undefined, { backgroundProfile: "off" });

// The fixture denies every non-loopback request and counts it. Record where each attempt was aimed so the final proof can
// name what was attempted instead of only counting: the existing public handlers start a deal-blueprint AI call that the
// fixture denies, and nothing of the website lane may reach Gmail or any other provider.
const attemptedHosts: string[] = [];
const fixtureFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init: any) => {
  const target = String(input);
  if (!target.startsWith(`${h.base}/`)) { try { attemptedHosts.push(new URL(target).hostname); } catch { attemptedHosts.push("unparseable"); } }
  return fixtureFetch(input, init);
}) as typeof fetch;

type B = Awaited<ReturnType<typeof privateStage3Browser>>;
let b: B | undefined;
const checks: string[] = [];
const check = (ok: unknown, label: string) => { assert.ok(ok, label); checks.push(label); };
const q = async (text: string, params: unknown[] = []) => (await h.pool.query(text, params)).rows;
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const tid = (id: string) => `[data-testid="${id}"]`;
const until = async (expr: string, label = expr, tries = 300) => {
  for (let n = 0; n < tries; n++) { if (await b!.evaluate(expr)) return; await wait(50); }
  const text = String(await b!.evaluate("document.body.innerText.slice(0,600)").catch(() => ""));
  throw new Error(`UI condition not reached: ${label}; page: ${JSON.stringify(text)}; path ${await b!.evaluate("location.pathname")}`);
};
const has = (id: string) => `!!document.querySelector('[data-testid="${id}"]')`;
const count = (selector: string) => b!.evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`) as Promise<number>;
const textOf = (id: string) => b!.evaluate(`document.querySelector('[data-testid="${id}"]')?.textContent ?? ''`) as Promise<string>;
const scrollClick = async (selector: string) => {
  await b!.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
  await wait(250);
  await b!.click(selector);
};
const setv = async (selector: string, value: string) => {
  await until(`!!document.querySelector(${JSON.stringify(selector)})`, `field ${selector}`);
  await b!.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
  await wait(200);
  await b!.set(selector, value);
};
/** Opens a Radix select and chooses the option whose visible text matches; real pointer input only. */
const pick = async (trigger: string, option: RegExp) => {
  await scrollClick(trigger);
  await until(`!!document.querySelector('[role="option"]')`, `options for ${trigger}`);
  const tagged = await b!.evaluate(`(()=>{const re=new RegExp(${JSON.stringify(option.source)},${JSON.stringify(option.flags)});
    const o=[...document.querySelectorAll('[role="option"]')].find(e=>re.test(e.textContent||''));
    if(!o)return false;o.setAttribute('data-e2e-pick','1');return true})()`);
  assert.equal(tagged, true, `option ${option} present for ${trigger}`);
  await b!.click('[data-e2e-pick="1"]');
  await wait(250);
};
const noOverflow = async (label: string) => {
  const o = await b!.evaluate("({sw:document.documentElement.scrollWidth,iw:innerWidth})") as { sw: number; iw: number };
  assert.ok(o.sw <= o.iw + 1, `${label}: horizontal overflow ${o.sw}>${o.iw}`);
};
const openAs = (role: string | null) => privateStage3Browser(h.base, role ? h.sessions.get(role)!.cookie : "", h.originalFetch, dir, { realInput: true, startupTimeoutMs: 30000 });
const prime = async (width: number, theme: "light" | "dark") => {
  await b!.call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
  await b!.evaluate(`localStorage.setItem('libertycrm_tour_completed','true');localStorage.setItem('prefer_desktop','true');localStorage.setItem('liberty-theme','${theme}')`);
};
const nonce = randomUUID().slice(0, 8);
const SEQ_ROUTE = "/dashboard/outbound-center?tab=sequences";
const SOURCE_KEY = "website_form|estimate_form";

const seedSequence = async (name: string, steps: Array<{ type: string; delayDays?: number; subject?: string | null; body?: string | null }>) => {
  const [s] = await q(`INSERT INTO follow_up_sequences(name,status,trigger_type,total_steps) VALUES($1,'paused','manual',$2) RETURNING id`, [name, steps.length]);
  let order = 1;
  for (const st of steps) {
    await q(`INSERT INTO sequence_steps(sequence_id,step_order,action_type,delay_days,delay_hours,subject,body) VALUES($1,$2,$3,$4,0,$5,$6)`,
      [s.id, order++, st.type, st.delayDays ?? 0, st.subject ?? null, st.body ?? null]);
  }
  return Number(s.id);
};

try {
  await mkdir(dir, { recursive: true });
  await q(`UPDATE users SET tour_completed_at=NOW() WHERE id LIKE $1`, [`${h.prefix}-%`]);
  const emailSeqName = `we-browser-email-${nonce}`;
  const smsSeqName = `we-browser-sms-${nonce}`;
  const emailSeq = await seedSequence(emailSeqName, [
    { type: "email", subject: "Thanks {{firstName}}", body: `<p>Hello {{firstName}}, <a href="https://libertybancard.com/upload-statement?a=1&b=2">upload a statement</a>.</p>` },
    { type: "wait", delayDays: 2 },
    { type: "email", subject: "Checking in", body: "<p>Any questions about your request?</p>" },
  ]);
  const smsSeq = await seedSequence(smsSeqName, [
    { type: "email", subject: "Hi", body: "<p>Hello</p>" },
    { type: "sms", delayDays: 1, subject: null, body: "Text step" },
  ]);
  const baselineLaneRows = Number((await q(`SELECT count(*)::int n FROM website_lifecycle_config_revisions`))[0].n);
  const baselineEnrollments = Number((await q(`SELECT count(*)::int n FROM sequence_enrollments`))[0].n);

  // ═══ A. Sequences page: frozen copies (admin) ═══
  b = await openAs("admin");
  await b.navigate("/");
  await prime(1280, "light");
  await b.navigate(SEQ_ROUTE);
  await until(has("card-website-warm-revisions"), "warm revisions panel");
  await until(has("text-no-warm-revisions"), "empty revisions state");
  check(await count(tid("section-create-warm-revision")) === 1, "admin sees the create-frozen-copy controls");
  check(/No form is mapped/.test(await textOf("list-website-source-mapping")), "an unmapped lane is stated as sending nothing");

  // Unsupported step: the SMS sequence is copied but cannot be approved.
  await pick(tid("select-warm-source-sequence"), new RegExp(smsSeqName));
  await pick(tid("select-warm-program"), /^Nurture$/);
  await scrollClick(tid("button-create-warm-revision"));
  await until(`!!document.querySelector('[data-testid^="row-warm-revision-"]')`, "first revision row");
  const smsRev = (await q(`SELECT id,state,unsupported_steps,source_sequence_id FROM website_warm_revisions WHERE source_sequence_id=$1`, [smsSeq]))[0];
  check(smsRev && smsRev.state === "inactive" && Array.isArray(smsRev.unsupported_steps) && smsRev.unsupported_steps.length === 1, "SMS step is recorded as unsupported on an inactive revision");
  check(/unsupported/.test(await textOf(`text-unsupported-${smsRev.id}`)), "UI flags the unsupported step count");
  check(await b.evaluate(`document.querySelector('[data-testid="button-approve-revision-${smsRev.id}"]').disabled`) === true, "Approve is disabled for a revision with unsupported steps");

  // Email-only sequence: copy, preview, approve.
  await pick(tid("select-warm-source-sequence"), new RegExp(emailSeqName));
  await pick(tid("select-warm-program"), /^Nurture$/);
  await scrollClick(tid("button-create-warm-revision"));
  await until(`!!document.querySelector('[data-testid^="button-preview-revision-"]') && document.querySelectorAll('[data-testid^="row-warm-revision-"]').length===2`, "second revision row");
  const nurtureRev = (await q(`SELECT id,state,program,unsupported_steps,snapshot FROM website_warm_revisions WHERE source_sequence_id=$1 AND program='nurture'`, [emailSeq]))[0];
  check(nurtureRev && nurtureRev.state === "inactive" && nurtureRev.unsupported_steps.length === 0 && nurtureRev.snapshot.steps.length === 2, "email sequence becomes two email steps (wait folded into delay) with no unsupported steps");
  check(nurtureRev.snapshot.steps[1].delayMinutes === 2 * 1440, "wait step delay is carried onto the next email");

  // Keyboard path: focus Preview and activate with Enter, then close with Escape.
  await b.evaluate(`document.querySelector('[data-testid="button-preview-revision-${nurtureRev.id}"]').scrollIntoView({block:'center'});document.querySelector('[data-testid="button-preview-revision-${nurtureRev.id}"]').focus()`);
  await b.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" });
  await b.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await until(has("dialog-warm-revision-preview") + `&&!!document.querySelector('[data-testid="section-warm-step-1"]')`, "preview dialog with both steps");
  const iframeDoc = await b.evaluate(`document.querySelector('[data-testid="iframe-warm-step-0"]').getAttribute('srcdoc')`) as string;
  check(/Hello Alex/.test(iframeDoc) && /upload a statement/.test(iframeDoc), "HTML preview renders tokens with the sample contact, not a real person");
  check(await b.evaluate(`document.querySelector('[data-testid="iframe-warm-step-0"]').getAttribute('sandbox')`) === "", "HTML preview is a fully sandboxed frame");
  const plain = await textOf("text-warm-plain-0");
  check(/Hello Alex/.test(plain) && /upload a statement \(https:\/\/libertybancard\.com\/upload-statement\?a=1&b=2\)/.test(plain), "plain-text version keeps the link destination with its equals sign intact");
  check(/libertybancard\.com\/upload-statement\?a=1&b=2/.test(await textOf("list-warm-links-0")), "links are listed for review");
  check(/after 2 days/.test(await textOf("section-warm-step-1")), "cadence is shown in days");
  await b.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await b.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await until(`!document.querySelector('[data-testid="dialog-warm-revision-preview"]')`, "preview dialog closed by Escape");

  await scrollClick(tid(`button-approve-revision-${nurtureRev.id}`));
  await until(`!document.querySelector('[data-testid="button-approve-revision-${nurtureRev.id}"]')`, "approve button gone after approval");
  check((await q(`SELECT state FROM website_warm_revisions WHERE id=$1`, [nurtureRev.id]))[0].state === "approved", "approval is durable");
  check((await q(`SELECT status FROM follow_up_sequences WHERE id=$1`, [emailSeq]))[0].status === "paused", "the source sequence stays paused");
  check(Number((await q(`SELECT count(*)::int n FROM sequence_enrollments`))[0].n) === baselineEnrollments, "no enrollment was created");
  check(Number((await q(`SELECT count(*)::int n FROM website_email_send_receipts`))[0].n) === 0, "no send attempt exists");
  check(b.exceptions.length === 0, `no uncaught browser exceptions (sequences): ${b.exceptions.slice(0, 2).join(" || ")}`);
  await b.screenshot("sequences-admin-1280-light");
  await b.close(); b = undefined;

  // ═══ B. Outbound readiness lane card (admin) ═══
  b = await openAs("admin");
  await b.navigate("/");
  await prime(1280, "light");
  await b.navigate("/dashboard/outbound-readiness");
  await until(has("card-website-email-lane") + `&&!!document.querySelector('[data-testid="list-website-lane-facts"]')`, "lane card with facts");
  check(/Closed/.test(await textOf("badge-website-lane-state")), "a lane with no configuration reads Closed");
  check(/none \(default closed\)/.test(await textOf("list-website-lane-facts")), "no configuration revision is stated, not invented");
  check(/not proven|unavailable/.test(await textOf("text-website-lane-reply-path")), "reply path is not shown as proven without evidence");
  check(/no success yet/.test(await textOf("text-website-lane-reader")), "the reader is not reported as having succeeded");
  check(/^0/.test(await textOf("text-website-lane-capacity")), "no capacity is used or reserved");

  // Open is blocked with real reasons, and nothing is stored by previewing.
  await pick(tid("select-website-lane-status"), /^Open$/);
  await scrollClick(tid("button-website-lane-preview"));
  await until(has("section-website-lane-review"), "review result");
  check(await count(tid("list-website-lane-problems")) === 1, "an open preview with no sender, limit or revision lists blocking problems");
  const problems = await textOf("list-website-lane-problems");
  check(/sender account|connected Gmail/i.test(problems) && /daily limit/i.test(problems) && /approved revision/i.test(problems), "problems name the sender, limit and mapping in plain words");
  check(await b.evaluate(`document.querySelector('[data-testid="button-website-lane-save"]').disabled`) === true, "Save stays disabled after a blocked preview");
  check(Number((await q(`SELECT count(*)::int n FROM website_lifecycle_config_revisions`))[0].n) === baselineLaneRows, "previewing stored nothing");
  check(await count(tid("checkbox-website-lane-ack")) === 1, "opening requires an explicit acknowledgement control");

  // A closed configuration with an approved mapping can be previewed and saved; it sends nothing and stays closed.
  await pick(tid("select-website-lane-status"), /^Closed$/);
  await pick(tid("select-map-estimate_form-nurture"), new RegExp(`Revision ${nurtureRev.id}\\b`));
  await scrollClick(tid("button-website-lane-preview"));
  await until(`/passes every check/.test(document.querySelector('[data-testid="section-website-lane-review"]')?.textContent||'')`, "closed configuration passes");
  check(await b.evaluate(`document.querySelector('[data-testid="button-website-lane-save"]').disabled`) === false, "Save is enabled only after an ok preview of this exact input");
  // The review belongs to the exact input: changing the mapping removes the review and disables Save.
  await pick(tid("select-map-estimate_form-nurture"), /No nurture/);
  check(await count(tid("section-website-lane-review")) === 0, "changing the input discards the previous review");
  check(await b.evaluate(`document.querySelector('[data-testid="button-website-lane-save"]').disabled`) === true, "Save is disabled again once the input differs from the previewed one");
  await pick(tid("select-map-estimate_form-nurture"), new RegExp(`Revision ${nurtureRev.id}\\b`));
  await scrollClick(tid("button-website-lane-preview"));
  await until(`/passes every check/.test(document.querySelector('[data-testid="section-website-lane-review"]')?.textContent||'')`, "closed configuration passes again");
  await scrollClick(tid("button-website-lane-save"));
  await until(`!/none \\(default closed\\)/.test(document.querySelector('[data-testid="list-website-lane-facts"]')?.textContent||'')`, "revision appears in facts after save");
  const lane = (await q(`SELECT revision,status,source_program_map,daily_limit FROM website_lifecycle_config_revisions ORDER BY revision DESC LIMIT 1`))[0];
  check(lane && lane.status === "closed" && Number(lane.revision) === 1 && Number(lane.source_program_map[SOURCE_KEY].nurture) === Number(nurtureRev.id), "closed configuration revision 1 is appended with the mapping");
  check(/Closed/.test(await textOf("badge-website-lane-state")), "the lane is still Closed after the save");
  await b.navigate("/dashboard/outbound-readiness");
  await until(has("list-website-lane-facts"), "facts after reload");
  check(!/none \(default closed\)/.test(await textOf("list-website-lane-facts")), "revision survives a reload");
  await b.navigate(SEQ_ROUTE);
  await until(has("list-website-source-mapping"), "mapping view");
  await until(`/uses revision ${nurtureRev.id}/.test(document.querySelector('[data-testid="list-website-source-mapping"]')?.textContent||'')`, "Sequences page shows the mapping");
  check(Number((await q(`SELECT count(*)::int n FROM website_email_send_receipts`))[0].n) === 0 && Number((await q(`SELECT count(*)::int n FROM sequence_enrollments`))[0].n) === baselineEnrollments, "saving the configuration created no send attempt or enrollment");
  check((await q(`SELECT count(*)::int n FROM audit_logs WHERE action='website_email_lane_config_appended'`))[0].n === 1, "the save left one audit row");

  // Browser Back returns to the lane card with its saved state.
  await b.evaluate("history.back()");
  await until(`location.pathname==='/dashboard/outbound-readiness'&&!!document.querySelector('[data-testid="list-website-lane-facts"]')`, "Back returns to Outbound readiness");
  check(!/none \(default closed\)/.test(await textOf("list-website-lane-facts")), "Back shows the saved revision, not a blank lane");

  // Activation panel: a status summary and a link, with no enabling control of its own.
  await b.navigate("/dashboard/activation");
  await until(has("tab-kill-switch"), "activation tabs");
  await scrollClick(tid("tab-kill-switch"));
  await until(has("card-website-email-lane-summary"), "lane summary on the activation panel");
  await until(has("badge-website-lane-summary-state"), "lane summary state loaded");
  check(/Closed/.test(await textOf("badge-website-lane-summary-state")), "Activation panel summary reads Closed");
  check(await count(`${tid("card-website-email-lane-summary")} button`) === 0, "the summary has no enabling control");
  check(await count(tid("link-website-lane-outbound-readiness")) === 1, "the summary links to the single configuration page");
  check(b.exceptions.length === 0, `no uncaught browser exceptions (admin pages): ${b.exceptions.slice(0, 2).join(" || ")}`);
  await b.close(); b = undefined;

  // ═══ B2. Actor switch: the admin is demoted while the session is live ═══
  b = await openAs("admin");
  await b.navigate("/");
  await prime(1280, "light");
  await b.navigate("/dashboard/outbound-readiness");
  await until(has("section-website-lane-controls"), "admin controls before the demotion");
  const adminId = `${h.prefix}-admin`;
  await q(`UPDATE users SET role='manager' WHERE id=$1`, [adminId]);
  try {
    await b.navigate("/dashboard/outbound-readiness");
    await until(has("card-website-email-lane") + `&&!!document.querySelector('[data-testid="list-website-lane-facts"]')`, "card after the demotion");
    check(await count(tid("section-website-lane-controls")) === 0, "after the demotion the same session no longer gets lane controls");
    const session = h.sessions.get("admin")!;
    const send = (path: string, body: unknown) => h.originalFetch(`${h.base}${path}`, { method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.cookie, "X-CSRF-Token": session.token }, body: JSON.stringify(body) });
    check((await send("/api/admin/website-email/config/preview", { status: "closed", sourceProgramMap: {}, senderAccount: null, dailyLimit: 0 })).status === 403, "a direct preview from the demoted session is refused with 403");
    check((await send(`/api/admin/website-email/revisions/${nurtureRev.id}/retire`, {})).status === 403, "a direct retire from the demoted session is refused with 403");
    check((await q(`SELECT state FROM website_warm_revisions WHERE id=$1`, [nurtureRev.id]))[0].state === "approved", "the demoted session changed nothing");
  } finally {
    await q(`UPDATE users SET role='admin' WHERE id=$1`, [adminId]);
    await b.close(); b = undefined;
  }

  // ═══ C. Role matrix at 1280 / 768 / 390, light and dark ═══
  const matrix: Array<Record<string, unknown>> = [];
  for (const role of ["admin", "manager", "agent"] as const) {
    b = await openAs(role);
    await b.navigate("/");
    for (const [width, theme] of [[1280, "light"], [1280, "dark"], [768, "light"], [768, "dark"], [390, "light"], [390, "dark"]] as const) {
      await prime(width, theme);
      await b.navigate("/dashboard/outbound-readiness");
      if (role === "agent") {
        await wait(1800);
        const status = await b.evaluate(`fetch('/api/admin/website-email/status').then(r=>r.status)`) as number;
        check(await count(tid("card-website-email-lane")) === 0, `agent ${width} ${theme}: the lane card is not mounted`);
        check(status === 401 || status === 403, `agent ${width} ${theme}: status API refuses the agent (${status})`);
        matrix.push({ role, width, theme, card: false, status });
        continue;
      }
      await until(has("card-website-email-lane") + `&&!!document.querySelector('[data-testid="list-website-lane-facts"]')`, `${role} ${width} ${theme} card`);
      const controls = await count(tid("section-website-lane-controls"));
      check(role === "admin" ? controls === 1 : controls === 0, `${role} ${width} ${theme}: controls are ${role === "admin" ? "present" : "absent"}`);
      const dark = await b.evaluate(`document.documentElement.classList.contains('dark')`) as boolean;
      check(dark === (theme === "dark"), `${role} ${width} ${theme}: theme applied`);
      await noOverflow(`${role} ${width} ${theme}`);
      const smallTargets = await b.evaluate(`[...document.querySelectorAll('[data-testid="section-website-lane-controls"] button, [data-testid="section-website-lane-controls"] input')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.height<40&&e.getAttribute('role')!=='checkbox'&&e.type!=='checkbox'}).length`) as number;
      check(smallTargets === 0, `${role} ${width} ${theme}: lane controls meet the touch target height`);
      matrix.push({ role, width, theme, card: true, controls });
      if (role === "admin" && ((width === 390 && theme === "dark") || (width === 768 && theme === "light"))) await b.screenshot(`outbound-readiness-admin-${width}-${theme}`);
    }
    // Sequences panel for the role.
    await prime(1280, "light");
    await b.navigate(SEQ_ROUTE);
    if (role === "agent") {
      await wait(1800);
      check(await count(tid("card-website-warm-revisions")) === 0, "agent: warm content panel is not mounted");
    } else {
      await until(has("card-website-warm-revisions"), `${role}: warm content panel`);
      await until(has("table-warm-revisions"), `${role}: revisions table`);
      const create = await count(tid("section-create-warm-revision"));
      const approveButtons = await count('[data-testid^="button-approve-revision-"], [data-testid^="button-retire-revision-"]');
      check(role === "admin" ? create === 1 : create === 0 && approveButtons === 0, `${role}: create/approve/retire controls ${role === "admin" ? "present" : "absent"}`);
      check(await count('[data-testid^="button-preview-revision-"]') >= 1, `${role}: preview is available`);
    }
    check(b.exceptions.length === 0, `no uncaught browser exceptions (${role} matrix): ${b.exceptions.slice(0, 2).join(" || ")}`);
    await b.close(); b = undefined;
  }
  for (const role of ["merchant", "partner", "affiliate"] as const) {
    b = await openAs(role);
    await b.navigate("/");
    await prime(1280, "light");
    await b.navigate("/dashboard/outbound-readiness");
    await wait(1800);
    const status = await b.evaluate(`fetch('/api/admin/website-email/status').then(r=>r.status)`) as number;
    const write = await b.evaluate(`fetch('/api/admin/website-email/reader/open',{method:'POST'}).then(r=>r.status)`) as number;
    check(await count(tid("card-website-email-lane")) === 0, `${role}: the lane card is not mounted`);
    check([401, 403].includes(status) && [401, 403].includes(write), `${role}: status and reader writes are refused (${status}, ${write})`);
    matrix.push({ role, card: false, status, write });
    await b.close(); b = undefined;
  }

  // ═══ D. Public consent surfaces (anonymous) ═══
  await q(`UPDATE users SET tour_completed_at=NOW() WHERE id LIKE $1`, [`${h.prefix}-%`]);
  b = await openAs(null);
  await b.navigate("/");
  await prime(1280, "light");
  const emailOf = () => `we-browser-${randomUUID()}@example.test`;
  const phoneOf = () => `30555${randomInt(10000, 99999)}`;
  const consentFor = async (address: string) => q(`
    SELECT l.id FROM inbound_requests r
    JOIN contact_source_events e ON e.event_key = 'form:' || r.source_type || ':' || r.id
    JOIN contacts c ON c.id = e.contact_id
    JOIN consent_audit_logs l ON l.event_namespace='public_form' AND l.event_key = 'website_email:' || r.id AND l.record_kind='canonical_fact'
    WHERE lower(c.email) = lower($1)`, [address]);
  const requestsFor = async (address: string) => q(`
    SELECT DISTINCT r.id FROM inbound_requests r
    JOIN contact_source_events e ON e.event_key = 'form:' || r.source_type || ':' || r.id
    JOIN contacts c ON c.id = e.contact_id WHERE lower(c.email) = lower($1)`, [address]);
  const fillEstimate = async (address: string) => {
    await setv(tid("input-contact-name"), "Browser Consent"); await setv(tid("input-business-name"), "Consent Biz");
    await setv(tid("input-email"), address); await setv(tid("input-phone"), phoneOf());
    await scrollClick(tid("select-vertical")); await until(`!!document.querySelector('[role="option"]')`, "vertical options");
    await b!.click(tid("select-vertical-retail")); await wait(250);
    await setv(tid("input-monthly-volume"), "50000"); await setv(tid("input-total-fees"), "1500");
  };

  for (const [width, label] of [[1280, "desktop"], [390, "mobile"]] as const) {
    await prime(width, "light");
    // Estimate: optional box unchecked records nothing.
    await b.navigate("/estimate"); await b.evaluate("sessionStorage.clear()"); await b.navigate("/estimate");
    await until(has("checkbox-email-marketing-consent"), `estimate email box (${label})`);
    const wording = await b.evaluate(`document.querySelector('[data-testid="container-email-marketing-consent"]').innerText`) as string;
    check(/email/i.test(wording) && !/text message|sms/i.test(wording), `Estimate ${label}: the email box names email only, not texts`);
    check(/optional/i.test(wording), `Estimate ${label}: the email box is labelled optional`);
    check(await b.evaluate(`document.querySelector('[data-testid="checkbox-email-marketing-consent"]').getAttribute('aria-checked')`) === "false", `Estimate ${label}: the email box starts unchecked`);
    const unchecked = emailOf();
    await fillEstimate(unchecked);
    await scrollClick(tid("button-estimate-submit"));
    await until(`location.pathname==='/thanks-estimate'`, `estimate saved (${label}, unchecked)`);
    check((await requestsFor(unchecked)).length === 1, `Estimate ${label}: the request was saved`);
    check((await consentFor(unchecked)).length === 0, `Estimate ${label}: an unchecked box wrote no email consent event`);

    // Estimate: checked box records one canonical consent event and the page does not claim a send.
    await b.navigate("/estimate"); await b.evaluate("sessionStorage.clear()"); await b.navigate("/estimate");
    await until(has("checkbox-email-marketing-consent"), `estimate email box again (${label})`);
    const granted = emailOf();
    await fillEstimate(granted);
    await scrollClick(tid("checkbox-email-marketing-consent"));
    check(await b.evaluate(`document.querySelector('[data-testid="checkbox-email-marketing-consent"]').getAttribute('aria-checked')`) === "true", `Estimate ${label}: the box can be checked`);
    await scrollClick(tid("button-estimate-submit"));
    await until(`location.pathname==='/thanks-estimate'`, `estimate saved (${label}, checked)`);
    check((await consentFor(granted)).length === 1, `Estimate ${label}: a checked box wrote exactly one canonical email consent event`);
    check(!/not recorded|could not record/i.test(String(await b.evaluate("document.body.innerText"))), `Estimate ${label}: no failure notice when consent was recorded`);
    await noOverflow(`estimate ${label}`);
  }

  // Get Started (desktop): checked box.
  await prime(1280, "light");
  await b.navigate("/get-started"); await b.evaluate("sessionStorage.clear()"); await b.navigate("/get-started");
  for (const sel of ['[data-testid^="card-goal-"]', '[data-testid^="card-vertical-"]', '[data-testid^="card-volume-"]']) {
    await until(`!!document.querySelector('${sel}')`, sel); await scrollClick(sel); await scrollClick(tid("button-next")); await wait(300);
  }
  await until(has("button-terminal-no"), "terminal step"); await scrollClick(tid("button-terminal-no")); await scrollClick(tid("button-next")); await wait(300);
  await until(has("button-zero-no"), "zero step"); await scrollClick(tid("button-zero-no")); await scrollClick(tid("button-next")); await wait(300);
  await until(has("input-first-name"), "contact step");
  const gsEmail = emailOf();
  await setv(tid("input-first-name"), "Quiz"); await setv(tid("input-last-name"), "Consent");
  await setv(tid("input-email"), gsEmail); await setv(tid("input-phone"), phoneOf());
  await until(has("checkbox-email-marketing-consent"), "get started email box");
  await scrollClick(tid("checkbox-email-marketing-consent"));
  await scrollClick(tid("button-submit"));
  await until(has("text-results-heading"), "get started saved");
  check((await consentFor(gsEmail)).length === 1, "Get Started: a checked box wrote exactly one canonical email consent event");

  // Free Analysis: the optional email box is separate from the call/text sentence; unchecked records nothing, checked records one event.
  for (const [width, label, tick] of [[390, "mobile", false], [1280, "desktop", true]] as const) {
    await prime(width, "light");
    await b.navigate("/free-analysis"); await b.evaluate("sessionStorage.clear()"); await b.navigate("/free-analysis");
    for (const sel of ['[data-testid^="card-industry-"]', '[data-testid^="card-volume-"]', '[data-testid^="card-processor-"]', '[data-testid^="card-pain-"]']) {
      await until(`!!document.querySelector('${sel}')`, `${label} ${sel}`); await scrollClick(sel); await scrollClick(tid("button-next")); await wait(300);
    }
    await until(has("input-first-name"), `free analysis contact step (${label})`);
    const faEmail = emailOf();
    await setv(tid("input-first-name"), "Free"); await setv(tid("input-last-name"), "Analysis");
    await setv(tid("input-email"), faEmail); await setv(tid("input-phone"), phoneOf());
    await until(has("checkbox-email-marketing-consent"), `free analysis email box (${label})`);
    const faWording = await b.evaluate(`document.querySelector('[data-testid="container-email-marketing-consent"]').innerText`) as string;
    check(/email/i.test(faWording) && !/text message|sms/i.test(faWording) && /optional/i.test(faWording), `Free Analysis ${label}: the email box names email only and is labelled optional`);
    const phoneSentence = String(await b.evaluate(`document.querySelector('label[for="consent"]').innerText`));
    check(/calls and texts/i.test(phoneSentence) && !/email/i.test(phoneSentence), `Free Analysis ${label}: the call and text sentence no longer claims email marketing`);
    check(await b.evaluate(`document.querySelector('[data-testid="checkbox-email-marketing-consent"]').getAttribute('aria-checked')`) === "false", `Free Analysis ${label}: the email box starts unchecked`);
    if (tick) await scrollClick(tid("checkbox-email-marketing-consent"));
    const faRequestsBefore = Number((await q(`SELECT count(*)::int n FROM inbound_requests WHERE source_type='free_analysis'`))[0].n);
    await scrollClick(tid("button-submit"));
    await until(has("text-results-heading"), `free analysis saved (${label})`);
    check(Number((await q(`SELECT count(*)::int n FROM inbound_requests WHERE source_type='free_analysis'`))[0].n) === faRequestsBefore + 1, `Free Analysis ${label}: exactly one request was recorded`);
    check((await q(`SELECT id FROM contacts WHERE lower(email)=lower($1)`, [faEmail])).length === 1, `Free Analysis ${label}: the contact was saved`);
    const faConsent = await q(`SELECT l.id FROM consent_audit_logs l JOIN contacts c ON c.id = l.contact_id
      WHERE lower(c.email) = lower($1) AND l.event_namespace='public_form' AND l.event_key LIKE 'website_email:%' AND l.record_kind='canonical_fact'`, [faEmail]);
    check(faConsent.length === (tick ? 1 : 0), `Free Analysis ${label}: ${tick ? "a checked box wrote exactly one canonical email consent event" : "an unchecked box wrote no email consent event"}`);
    await noOverflow(`free analysis ${label}`);
  }

  // Newsletter on a static blog article.
  const slug = "payment-processing-ecommerce-complete-guide";
  await b.navigate(`/blog/${slug}`);
  await until(has("form-newsletter-signup"), "newsletter form");
  const pdfText = await textOf("text-newsletter-pdf-unavailable");
  check(/not available/i.test(pdfText), "newsletter form says the PDF is not available instead of promising it");
  check(!/free pdf|download the (pdf|guide)|we.?ll send you the pdf/i.test(String(await b.evaluate("document.querySelector('[data-testid=\"newsletter-signup-inline\"]').innerText"))), "newsletter form makes no PDF delivery promise");
  const nlEmail = emailOf();
  await setv(tid("input-newsletter-first-name"), "News");
  await setv(tid("input-newsletter-email"), nlEmail);
  // Without the required box nothing is submitted.
  const before = b.requests.filter(r => r.url.startsWith("/api/newsletter/subscribe")).length;
  await b.evaluate(`document.querySelector('[data-testid="form-newsletter-signup"]').requestSubmit()`);
  await wait(600);
  check(b.requests.filter(r => r.url.startsWith("/api/newsletter/subscribe")).length === before, "the newsletter form submits nothing until its required box is checked");
  check(await count(tid("newsletter-signup-confirmed")) === 0, "no subscription is claimed before the box is checked");

  // A failed request is not a subscription.
  await scrollClick(tid("checkbox-email-marketing-consent"));
  b.failRead("/api/newsletter/subscribe", { exact: true });
  await scrollClick(tid("button-newsletter-subscribe"));
  await until(has("text-newsletter-error"), "request failure shown");
  check(await count(tid("newsletter-signup-confirmed")) === 0, "a failed request never shows the subscribed card");
  b.failRead(null);
  check((await consentFor(nlEmail)).length === 0, "the failed request recorded no consent");

  // The retry records consent and only then shows the confirmed card.
  await scrollClick(tid("button-newsletter-subscribe"));
  await until(has("newsletter-signup-confirmed"), "confirmed card after a recorded subscription");
  check((await consentFor(nlEmail)).length === 1, "the confirmed card appears only with a recorded canonical consent event");
  check(!/PDF (is|has been) (on its way|sent)|check your inbox for the (pdf|guide)/i.test(String(await b.evaluate("document.querySelector('[data-testid=\"newsletter-signup-confirmed\"]').innerText"))), "confirmed card promises no PDF");
  check(b.exceptions.length === 0, `no uncaught browser exceptions (public): ${b.exceptions.slice(0, 2).join(" || ")}`);
  await b.close(); b = undefined;

  const aiHost = (() => { try { return new URL(process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ?? "https://api.openai.com").hostname; } catch { return "api.openai.com"; } })();
  const hosts = [...new Set(attemptedHosts)];
  check(hosts.every(host => host === aiHost || host === "api.openai.com"), `every denied egress attempt was the existing deal-blueprint AI call, none aimed at Gmail or another provider (${hosts.length} host${hosts.length === 1 ? "" : "s"})`);
  check(!hosts.some(host => /google|gmail|smtp|gohighlevel|leadconnector|zerobounce|serper|outscraper|apollo/i.test(host)), "no attempt reached a mail, GHL or enrichment provider");
  check(Number((await q(`SELECT count(*)::int n FROM communication_events WHERE direction='outbound' AND provider='gmail'`))[0].n) === 0, "no Gmail outbound communication event was recorded");
  check(Number((await q(`SELECT count(*)::int n FROM website_email_send_receipts`))[0].n) === 0, "no website email send attempt exists after the whole run");
  check(Number((await q(`SELECT count(*)::int n FROM website_lifecycle_config_revisions WHERE status='open'`))[0].n) === 0, "the lane was never opened");
  check((await q(`SELECT status FROM follow_up_sequences WHERE id = ANY($1::int[])`, [[emailSeq, smsSeq]])).every(r => r.status === "paused"), "both source sequences are still paused");
  await writeFile(`${dir}/receipt.json`, JSON.stringify({ status: "passed", identity, fixture: h.prefix, checks, matrix,
    scope: "mounted Sequences/Outbound readiness/Activation/public forms against real handlers on a disposable database; no lane opening, send, provider probe, unpause, activation or enrollment" }, null, 2));
  console.log(`Website email lifecycle browser: PASS (${checks.length} checks)`);
} catch (error) {
  await b?.screenshot("failure").catch(() => undefined);
  await writeFile(`${dir}/failed-receipt.json`, JSON.stringify({ status: "failed", identity, error: String(error), checks }, null, 2)).catch(() => undefined);
  throw error;
} finally {
  if (b) await b.close().catch(() => undefined);
  await h.close();
}

