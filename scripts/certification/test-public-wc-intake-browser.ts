/**
 * W-C public forms and CRM handoff: mounted-browser acceptance.
 *
 * The compiled production client (dist/public) is driven like a visitor and like staff, against the real public, Lead Ops and
 * statement-handoff route handlers on a disposable database with deny-by-default egress and the global outbound pause in force.
 * There is no queue consumer in this process, so every accepted statement is retained and deferred, and every surface must
 * say so truthfully. Unregistered APIs answer 501.
 *
 * Fault injection is browser-side only (a fetch/XHR wrapper that runs the REAL request and then loses or rewrites the answer,
 * or a status-read failure), so every ambiguous-response case is a request the server really processed. Nothing is sent: no
 * provider is configured, transports are denied and no worker runs.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { stage3BHttpFixture } from "../fixtures/stage3-b-http";
import { privateStage3Browser } from "../fixtures/private-stage3-browser";
import { verifyCandidateIdentity } from "../fixtures/candidate-build-identity";

await verifyCandidateIdentity();
const dir = "generated-artifacts/public-wc-intake-browser";
const clientRoot = path.resolve("dist/public");
await mkdir(dir, { recursive: true });

process.env.APP_URL = "https://libertybancard.com";
const h = await stage3BHttpFixture(async (app) => {
  (await import("../../server/routes/public")).registerPublicRoutes(app);
  (await import("../../server/routes/lead-ops")).registerLeadOpsRoutes(app);
  (await import("../../server/routes/boarding")).registerBoardingRoutes(app);
  (await import("../../server/routes/analytics")).registerAnalyticsRoutes(app);
  app.use("/api", (_req, res) => res.status(501).json({ message: "Source not registered in this isolated intake fixture" }));
  const { static: serveStatic } = await import("express");
  app.use((req, res, next) => serveStatic(clientRoot)(req, res, next));
  app.use((_req, res) => res.sendFile("index.html", { root: clientRoot }));
}, undefined, { backgroundProfile: "off" });

const checks: string[] = [];
const check = (value: unknown, message: string) => { assert.ok(value, message); checks.push(message); console.log(`✓ [WCB-${String(checks.length).padStart(2, "0")}] ${message}`); };
const settle = (ms = 200) => new Promise((resolve) => setTimeout(resolve, ms));
const exceptionsByActor: Record<string, string[]> = {};
let b: Awaited<ReturnType<typeof privateStage3Browser>> | undefined;
let actor = "";
const count = async (sql: string, params: unknown[] = []) => Number((await h.pool.query(sql, params)).rows[0].n);

const failures: string[] = [];
const step = async (name: string, fn: () => Promise<void>) => {
  try { await fn(); } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).split("\n")[0].slice(0, 400);
    failures.push(`${name}: ${message}`);
    console.log(`✗ [${name}] ${message}`);
    await b?.screenshot(`failed-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`).catch(() => {});
  }
};
const until = async (fn: () => Promise<boolean>, label: string, tries = 80) => {
  for (let i = 0; i < tries; i++) { if (await fn()) return; await settle(250); }
  await b?.screenshot("failure").catch(() => {});
  throw new Error(`Timed out: ${label}`);
};
const present = (selector: string) => b!.evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].some(e=>e.getClientRects().length>0)`) as Promise<boolean>;
const text = (selector: string) => b!.evaluate(`document.querySelector(${JSON.stringify(selector)})?.innerText ?? ''`) as Promise<string>;
const tid = (id: string) => `[data-testid="${id}"]`;

/** Browser-side fault injection. The wrapper always performs the REAL request first, so the server really processed it. */
const FAULT_SCRIPT = `(() => {
  const realFetch = window.fetch.bind(window);
  const fault = () => sessionStorage.getItem('__wc_fault') || '';
  window.fetch = async (input, init) => {
    const mode = fault();
    const raw = typeof input === 'string' ? input : input.url;
    const pathname = new URL(raw, location.href).pathname;
    const method = String((init && init.method) || (typeof input !== 'string' && input.method) || 'GET').toUpperCase();
    if (mode && method === 'POST' && /\\/api\\/public\\/(get-started|support)$/.test(pathname)) {
      if (mode === 'lose-post') { await realFetch(input, init); throw new TypeError('Failed to fetch'); }
      if (mode === 'mangle-post') {
        const real = await realFetch(input, init);
        const body = await real.clone().json();
        return new Response(JSON.stringify({ success: true, requestReceipt: body.requestReceipt, status: 'processing' }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
    }
    const status = /^status-(\\d{3})$/.exec(mode);
    if (status && method === 'GET' && /\\/api\\/public\\/inbound-requests\\/[^/]+\\/status$/.test(pathname)) {
      return new Response('{"message":"fixture"}', { status: Number(status[1]), headers: { 'content-type': 'application/json' } });
    }
    return realFetch(input, init);
  };
  const realAdd = XMLHttpRequest.prototype.addEventListener;
  XMLHttpRequest.prototype.addEventListener = function (type, listener, options) {
    if (type === 'load' && fault() === 'lose-upload') {
      return realAdd.call(this, 'load', () => { this.dispatchEvent(new Event('error')); }, options);
    }
    return realAdd.call(this, type, listener, options);
  };
  const realSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body) {
    if (fault() === 'fail-upload' || fault() === 'conflict-upload') {
      // The real request still runs and the server really saves; only the answer the page sees is replaced.
      const failing = fault() === 'fail-upload';
      Object.defineProperty(this, 'status', { configurable: true, get() { return failing ? 400 : 409; } });
      Object.defineProperty(this, 'responseText', { configurable: true, get() { return failing ? '{"error":"STATEMENT_UPLOAD_FAILED"}' : '{"error":"IDEMPOTENCY_KEY_CONFLICT"}'; } });
    }
    if (fault() === 'mangle-upload') {
      const xhr = this;
      const getter = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseText').get;
      Object.defineProperty(xhr, 'responseText', { configurable: true, get() {
        try { const json = JSON.parse(getter.call(xhr)); delete json.reference; delete json.statementProcessing; return JSON.stringify(json); } catch { return ''; }
      } });
    }
    return realSend.call(this, body);
  };
})();`;

const open = async (role: "admin" | "manager" | "agent" | "anonymous", nativeZoom?: number) => {
  if (b) { exceptionsByActor[actor] = [...(exceptionsByActor[actor] ?? []), ...b.exceptions]; await b.close(); }
  actor = role;
  const cookie = role === "anonymous" ? "" : h.sessions.get(role)!.cookie;
  b = await privateStage3Browser(h.base, cookie, h.originalFetch, dir, { realInput: true, startupTimeoutMs: 40000, ...(nativeZoom ? { zoom: nativeZoom } : {}) });
  await b.call("Network.setBypassServiceWorker", { bypass: true });
  await b.call("Page.addScriptToEvaluateOnNewDocument", { source: FAULT_SCRIPT });
  // A native browser-zoom run keeps the real window and persisted zoom; a metrics override would replace exactly what is being proven.
  if (!nativeZoom) await b.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await b.navigate("/upload-statement");
  if (role === "anonymous") {
    // A visitor's first act on a public page: answer the consent banner (declining non-essential cookies), which otherwise covers form controls.
    try { await until(async () => await present(tid("button-cookie-reject")), "consent banner", 40); await b.click(tid("button-cookie-reject")); await settle(300); } catch { /* banner already answered */ }
  }
  await b.evaluate(`localStorage.setItem('liberty_setup_notice_hidden','true');localStorage.setItem('libertycrm_tour_completed','true');localStorage.setItem('prefer_desktop','true')`);
};
const view = async (width: number, theme: "light" | "dark" = "light") => {
  await b!.call("Emulation.setDeviceMetricsOverride", { width, height: width < 500 ? 844 : 900, deviceScaleFactor: 1, mobile: false });
  await b!.evaluate(`localStorage.setItem('liberty-theme',${JSON.stringify(theme)})`);
};
const noPageOverflow = (label: string) => b!.evaluate("document.documentElement.scrollWidth<=window.innerWidth+1").then((ok) => check(ok, `${label}: no horizontal page overflow`));
const fault = (mode: string | null) => b!.evaluate(mode ? `sessionStorage.setItem('__wc_fault',${JSON.stringify(mode)})` : `sessionStorage.removeItem('__wc_fault')`);
const freshForm = async (route: string, readyTestId: string) => {
  await b!.navigate(route);
  await b!.evaluate(`Object.keys(sessionStorage).filter(k=>k.startsWith('lb:public-intake:')).forEach(k=>sessionStorage.removeItem(k))`);
  await b!.navigate(route);
  await until(async () => await present(tid(readyTestId)), `${route} form ready`);
};
const storedIntent = (form: string) => b!.evaluate(`JSON.parse(sessionStorage.getItem('lb:public-intake:${form}')||'null')`) as Promise<{ key: string; receipt: string | null; state: string } | null>;
const pick = (testId: string, value: string) => b!.evaluate(`(()=>{const s=document.querySelector(${JSON.stringify(tid(testId))});const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(s,${JSON.stringify(value)});s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
const scrollTo = (selector: string) => b!.evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center'})`);
const press = async (key: string, code: string, vk: number) => {
  await b!.call("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk });
  await b!.call("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk });
};
const activeId = () => b!.evaluate("document.activeElement?.id || document.activeElement?.getAttribute('data-testid') || document.activeElement?.tagName || ''") as Promise<string>;
const contactByEmail = async (email: string) => (await h.pool.query(`SELECT * FROM contacts WHERE lower(email)=lower($1)`, [email])).rows[0];
const requestsFor = async (email: string) => (await h.pool.query(`SELECT r.* FROM inbound_requests r JOIN contacts c ON c.id=r.contact_id WHERE lower(c.email)=lower($1) ORDER BY r.created_at`, [email])).rows;
const shortRef = (id: string) => id.replace(/-/g, "").slice(0, 8).toUpperCase();

const tag = randomUUID().replaceAll("-", "").slice(0, 8);
const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"), Buffer.alloc(2048, 0x20)]);
const goodPath = path.join(tmpdir(), `wcb-${tag}-statement.pdf`);
await writeFile(goodPath, PDF);
const otherPath = path.join(tmpdir(), `wcb-${tag}-statement-other.pdf`);
await writeFile(otherPath, Buffer.concat([PDF, Buffer.from("different statement\n")]));
const chooseFile = async (filePath: string) => {
  const { root } = await b!.call("DOM.getDocument", { depth: 1 });
  const { nodeId } = await b!.call("DOM.querySelector", { nodeId: root.nodeId, selector: tid("input-file") });
  assert(nodeId, "File input must exist");
  await b!.call("DOM.setFileInputFiles", { files: [filePath], nodeId });
};
const fillStatement = async (input: { business: string; name: string | null; email: string; phone?: string }) => {
  // Bring the first field into view and let the page's reveal/scroll motion finish so a real pointer lands on a stationary target.
  await scrollTo(tid("input-business-name"));
  await settle(600);
  await b!.set(tid("input-business-name"), input.business);
  if (input.name !== null) await b!.set(tid("input-contact-name"), input.name);
  await b!.set(tid("input-email"), input.email);
  if (input.phone) await b!.set(tid("input-mobile"), input.phone);
};

const outboundEvidence = async () => ({
  sent: await count(`SELECT count(*) n FROM outbound_send_log WHERE status IN ('sent','delivered')`),
  receipts: await count(`SELECT count(*) n FROM inbound_acknowledgements WHERE state IN ('sent','delivered')`),
});

try {
  await h.pool.query("UPDATE users SET tour_completed_at=NOW() WHERE id LIKE $1", [`${h.prefix}%`]);
  const terminalEmail = `wcb-${tag}-terminal@example.com`;
  const generalEmail = `wcb-${tag}-general@example.com`;
  const supportEmail = `wcb-${tag}-support@example.com`;
  const statementEmail = `wcb-${tag}-statement@example.com`;
  const terminalBusiness = `Terminal Cafe ${tag}`;
  const refs: Record<string, string> = {};

  await open("anonymous");

  // ═══ Layout matrix: every public form at every target width ═════════════════════════════════
  await step("Layout", async () => {
    const pages: Array<[string, string, string]> = [
      ["Terminal inquiry", "/get-started?offer=free-terminal", "form-terminal-inquiry"],
      ["General inquiry", "/about-contact", "form-general-inquiry"],
      ["Support", "/support", "form-support"],
      ["Statement review", "/upload-statement", "form-upload-statement"],
    ];
    for (const width of [320, 390, 768, 1024, 1440]) {
      await view(width);
      for (const [label, route, formId] of pages) {
        await b!.navigate(route);
        await until(async () => await present(tid(formId)), `${label} form at ${width}`);
        await settle(250);
        await noPageOverflow(`${label} ${width}px`);
        check(await b!.evaluate(`(()=>{const f=document.querySelector(${JSON.stringify(tid(formId))});const r=f.getBoundingClientRect();return r.left>=-1&&r.right<=window.innerWidth+1})()`), `${label} ${width}px: the form fits inside the viewport`);
        check(await b!.evaluate("document.querySelectorAll('h1').length") === 1, `${label} ${width}px: exactly one page heading`);
      }
    }
    await view(390);
    await b!.navigate("/upload-statement");
    await until(async () => await present(tid("section-upload-form")), "statement form");
    check(await b!.evaluate(`document.querySelector('[data-testid="section-upload-form"]').getBoundingClientRect().top + window.scrollY < window.innerHeight * 2.2`), "Statement review at 390px: the form is reached within two screens (form first, not after the explainer)");
    check(await present(tid("input-mobile")) && /optional/i.test(await b!.evaluate(`document.querySelector('label[for="statement-mobile"]')?.innerText || ''`) as string), "Statement review: the phone field is labelled optional");
    await b!.screenshot("statement-390");
  });

  // ═══ Terminal inquiry: no statement, no phone, no generic quiz ═══════════════════════════════
  await step("Terminal inquiry", async () => {
    for (const width of [1280, 768, 390, 320]) {
      await view(width);
      await freshForm("/get-started?offer=free-terminal", "form-terminal-inquiry");
      check(!(await present(tid("button-next"))) && !(await present('[data-testid^="card-goal-"]')), `Terminal ${width}px: the six-step goal quiz is not shown`);
      check(await b!.evaluate(`document.querySelector('[data-testid="checkbox-pewc-consent"]').getAttribute('aria-checked')`) === "false", `Terminal ${width}px: text permission starts unchecked`);
      await scrollTo(tid("button-terminal-submit"));
      await b!.click(tid("button-terminal-submit"));
      await until(async () => await present("#terminal-businessName-error"), "required errors");
      for (const field of ["businessName", "name", "email", "businessType", "volumeBand", "currentlyLeasing"]) {
        check(await present(`#terminal-${field}-error`), `Terminal ${width}px: an empty ${field} is named in an inline error`);
      }
      check(!(await present("#terminal-phone-error")), `Terminal ${width}px: the phone is optional, so leaving it blank is no error`);
      check(await activeId() === "terminal-businessName", `Terminal ${width}px: focus moves to the first field with an error`);
      check(await count(`SELECT count(*) n FROM contacts WHERE lower(email)=lower($1)`, [terminalEmail]) === 0, `Terminal ${width}px: a refused submit saves nothing`);
      await noPageOverflow(`Terminal errors ${width}px`);
    }
    await view(1280);
    await freshForm("/get-started?offer=free-terminal", "form-terminal-inquiry");
    await b!.set("#terminal-businessName", terminalBusiness);
    await b!.set("#terminal-name", "Tara Terminal");
    await b!.set("#terminal-email", terminalEmail);
    await pick("terminal-select-businessType", "Restaurant");
    await pick("terminal-select-volumeBand", "5000_24999");
    await pick("terminal-select-currentlyLeasing", "yes");
    await scrollTo('[data-testid="checkbox-pewc-consent"]');
    await b!.click('[data-testid="checkbox-pewc-consent"]');
    await scrollTo(tid("button-terminal-submit"));
    await b!.click(tid("button-terminal-submit"));
    await until(async () => await present(tid("terminal-pewcConsent-error")), "text permission needs a phone");
    check(await count(`SELECT count(*) n FROM contacts WHERE lower(email)=lower($1)`, [terminalEmail]) === 0, "Text permission without a phone is refused inline and saves nothing");
    await b!.click('[data-testid="checkbox-pewc-consent"]');
    await scrollTo(tid("button-terminal-submit"));
    await b!.click(tid("button-terminal-submit"));
    await until(async () => await present(tid("terminal-success")), "terminal inquiry accepted", 120);
    const shown = (await text(tid("terminal-success-reference"))).match(/[0-9A-F]{8}/)?.[0] ?? "";
    refs.terminal = shown;
    check(/^[0-9A-F]{8}$/.test(shown), `The visitor is shown a short reference (${shown})`);
    const rows = await requestsFor(terminalEmail);
    check(rows.length === 1 && shortRef(rows[0].id) === shown && rows[0].source_type === "equipment_inquiry", "The reference maps to exactly one stored equipment-inquiry occurrence");
    check(rows[0].attribution_refs?.schema === "wc-inquiry-v1" && rows[0].attribution_refs.volumeBand === "5000_24999" && rows[0].attribution_refs.currentlyLeasing === "yes"
      && rows[0].attribution_refs.phoneProvided === false && rows[0].attribution_refs.smsPermissionRequested === false, "The frozen context holds the volume band and lease answer, with no phone and no text permission");
    check((await contactByEmail(terminalEmail)).phone === "", "The contact was saved with an empty phone, never an invented one");
    check(await count(`SELECT count(*) n FROM inbound_request_work_links WHERE request_id=$1 AND work_type='task'`, [rows[0].id]) === 1
      && await count(`SELECT count(*) n FROM notifications WHERE inbound_request_id=$1`, [rows[0].id]) === 1, "That occurrence has exactly one review task and one internal notification");
    check(await count(`SELECT count(*) n FROM sequence_enrollments WHERE contact_id=$1`, [rows[0].contact_id]) === 0, "The contact is not enrolled in any sequence");
    check(!/approved|you qualify|savings|within \d|hours|same day/i.test(await text(tid("terminal-success"))) && /not an application or an approval/i.test(await text(tid("terminal-success"))), "The confirmation makes no approval, savings or response-time claim and says it is not an application or approval");
    await noPageOverflow("Terminal confirmation");
    await b!.click(tid("terminal-start-another"));
    await until(async () => await present(tid("form-terminal-inquiry")), "empty form after starting another");
    check(await storedIntent("equipment_inquiry") === null, "Starting another inquiry shows an empty form and keeps no stored intent for the confirmed one");
    await b!.navigate("/get-started?offer=free-terminal");
    await until(async () => await present(tid("form-terminal-inquiry")), "empty form after reload");
    check(await count(`SELECT count(*) n FROM inbound_requests r JOIN contacts c ON c.id=r.contact_id WHERE lower(c.email)=lower($1)`, [terminalEmail]) === 1, "Reloading after a confirmed save created no second request");
  });

  // ═══ General inquiry on /about-contact ════════════════════════════════════════════════════════
  await step("General inquiry", async () => {
    await view(390);
    await freshForm("/about-contact", "form-general-inquiry");
    await scrollTo(tid("button-inquiry-submit"));
    await b!.click(tid("button-inquiry-submit"));
    await until(async () => await present("#inquiry-intent-error"), "intent required");
    check(await present("#inquiry-businessName-error") && await present("#inquiry-email-error"), "An empty general inquiry names the missing fields inline");
    await b!.set("#inquiry-businessName", `General Cafe ${tag}`);
    await b!.set("#inquiry-name", "Gina General");
    await b!.set("#inquiry-email", generalEmail);
    await pick("inquiry-select-intent", "new_business");
    await b!.set(tid("inquiry-input-note"), "Opening in the spring.");
    await scrollTo(tid("button-inquiry-submit"));
    await b!.click(tid("button-inquiry-submit"));
    await until(async () => await present(tid("inquiry-success")), "general inquiry accepted", 120);
    const shown = (await text(tid("inquiry-success-reference"))).match(/[0-9A-F]{8}/)?.[0] ?? "";
    refs.general = shown;
    const rows = await requestsFor(generalEmail);
    check(rows.length === 1 && shortRef(rows[0].id) === shown && rows[0].source_type === "general_inquiry" && rows[0].attribution_refs?.intent === "new_business", "The general inquiry is one stored occurrence with its intent frozen");
    check((await contactByEmail(generalEmail)).phone === "", "A general inquiry with no phone stores an empty phone");
    check(!/statement|bank|underwriting/i.test(await text(tid("inquiry-success"))), "The confirmation asks for no statement or bank detail");
    await noPageOverflow("General inquiry confirmation 390px");
    await b!.screenshot("general-confirmation-390");
  });

  // ═══ Support ══════════════════════════════════════════════════════════════════════════════════
  await step("Support", async () => {
    await view(390);
    await freshForm("/support", "form-support");
    await b!.set(tid("input-name"), "Sam Support");
    await b!.set(tid("input-business-name"), `Support Cafe ${tag}`);
    await b!.set(tid("input-email"), supportEmail);
    await scrollTo(tid("select-issue-type"));
    await b!.click(tid("select-issue-type"));
    await until(async () => await present(tid("select-item-other")), "issue types");
    await b!.click(tid("select-item-other"));
    await b!.set(tid("textarea-message"), "My deposit has not arrived.");
    await scrollTo(tid("button-support-submit"));
    await b!.click(tid("button-support-submit"));
    await until(async () => (await b!.evaluate("location.pathname")) === "/thanks-support", "support confirmation page", 120);
    const shown = new URL(String(await b!.evaluate("location.href"))).searchParams.get("ref") ?? "";
    refs.support = shown;
    const contact = await contactByEmail(supportEmail);
    const ticketCount = await count(`SELECT count(*) n FROM tickets WHERE contact_id=$1`, [contact.id]);
    const request = (await h.pool.query(`SELECT * FROM inbound_requests WHERE source_type='support_form' AND upper(substr(id::text,1,8))=$1`, [shown])).rows[0];
    check(ticketCount === 1 && request && await count(`SELECT count(*) n FROM notifications WHERE inbound_request_id=$1`, [request.id]) === 1, "A support request with no phone creates exactly one ticket and one internal notification");
    await until(async () => await present(tid("text-thanks-support-reference")), "reference on the confirmation page");
    check((await text(tid("text-thanks-support-reference"))).includes(shown), "The confirmation page shows the same reference the server issued");
    await noPageOverflow("Support confirmation 390px");
  });

  // ═══ Statement upload ═════════════════════════════════════════════════════════════════════════
  await step("Statement upload", async () => {
    await view(390);
    await freshForm("/upload-statement", "form-upload-statement");
    // Your name is required; the phone is not.
    await fillStatement({ business: `Statement Cafe ${tag}`, name: null, email: statementEmail });
    await chooseFile(goodPath);
    await scrollTo(tid("button-upload-submit"));
    await b!.click(tid("button-upload-submit"));
    await until(async () => await present("#statement-contactName-error"), "name required");
    check(await count(`SELECT count(*) n FROM contacts WHERE lower(email)=lower($1)`, [statementEmail]) === 0, "A statement request without your name is refused inline and saves nothing");
    // Text permission needs a real number.
    await b!.set(tid("input-contact-name"), "Stan Statement");
    await scrollTo('[data-testid="checkbox-pewc-consent"]');
    await b!.click('[data-testid="checkbox-pewc-consent"]');
    await scrollTo(tid("button-upload-submit"));
    await b!.click(tid("button-upload-submit"));
    await until(async () => await present(tid("statement-pewcConsent-error")), "text permission needs a phone");
    check(await count(`SELECT count(*) n FROM contacts WHERE lower(email)=lower($1)`, [statementEmail]) === 0, "Text permission without a phone is refused inline and saves nothing");
    await b!.click('[data-testid="checkbox-pewc-consent"]');
    await scrollTo(tid("button-upload-submit"));
    await b!.click(tid("button-upload-submit"));
    await until(async () => await present(tid("section-upload-success")), "statement accepted", 120);
    const shown = (await text(tid("text-upload-reference"))).trim();
    refs.statement = shown;
    const rows = await requestsFor(statementEmail);
    check(rows.length === 1 && shortRef(rows[0].id) === shown && rows[0].source_type === "statement_upload", "The reference maps to exactly one stored statement occurrence");
    check(/^[0-9a-f]{64}$/.test(rows[0].request_fingerprint), "The occurrence is stored under a valid request fingerprint");
    check((await contactByEmail(statementEmail)).phone === "", "A statement request with no phone stores an empty phone");
    refs.statementKey = (await storedIntent("statement_upload"))?.key ?? "";
    check(await present(tid("text-processing-deferred")), "The visitor is told truthfully that automatic processing is behind and an advisor will handle it");
    check(!/approved|savings|\$\d/i.test(await text(tid("section-upload-success"))), "The confirmation makes no approval or financial claim");
    await noPageOverflow("Statement confirmation 390px");
    // Reload keeps the same reference.
    await b!.navigate("/upload-statement");
    await until(async () => await present(tid("section-upload-success")), "saved statement restored after reload");
    check((await text(tid("text-upload-reference"))).trim() === shown, "After a reload the same statement reference is still shown");
  });

  // ═══ Ambiguous answers: general inquiry (lost answer, changed details, reload, check, failed reads) ═══
  await step("Ambiguous general inquiry", async () => {
    await view(1280);
    const email = `wcb-${tag}-lost@example.com`;
    const business = `Lost Answer Cafe ${tag}`;
    const fill = async (address: string) => {
      await b!.set("#inquiry-businessName", business);
      await b!.set("#inquiry-name", "Lou Lost");
      await b!.set("#inquiry-email", address);
      await pick("inquiry-select-intent", "processing");
    };
    // 1. The server saves the request but the answer is lost.
    await freshForm("/about-contact", "form-general-inquiry");
    await fault("lose-post");
    await fill(email);
    await scrollTo(tid("button-inquiry-submit"));
    await b!.click(tid("button-inquiry-submit"));
    await until(async () => await present(tid("inquiry-intake-notice")), "unresolved notice");
    check(await b!.evaluate(`document.querySelector('[data-testid="inquiry-intake-notice"]').getAttribute('data-intake-phase')`) === "unresolved" && !(await present(tid("inquiry-success"))), "A lost answer is shown as unconfirmed, never as success");
    check((await requestsFor(email)).length === 1, "The server really saved exactly one request");
    const lost = await storedIntent("general_inquiry");
    check(lost?.state === "unresolved" && lost.receipt === null && Boolean(lost.key), "The unconfirmed intent keeps its idempotency key");
    // 2. Different details after an ambiguous answer are blocked, never sent under a new key.
    await fault(null);
    await b!.set("#inquiry-email", `wcb-${tag}-other@example.com`);
    await scrollTo(tid("button-inquiry-submit"));
    await b!.click(tid("button-inquiry-submit"));
    await until(async () => /changed details were not sent/i.test(await text(tid("inquiry-intake-notice"))), "blocked message");
    check(!(await present(tid("inquiry-intake-retry"))), "While blocked there is no one-click retry that could send different details");
    check(await count(`SELECT count(*) n FROM contacts WHERE lower(email)=lower($1)`, [`wcb-${tag}-other@example.com`]) === 0 && (await requestsFor(email)).length === 1, "The changed details created nothing and the key was not rotated");
    check((await storedIntent("general_inquiry"))?.key === lost!.key, "The stored key is unchanged after the blocked attempt");
    // Back and Forward keep the unconfirmed state: it lives in the browser session, not in the page.
    await b!.navigate("/support");
    await until(async () => await present(tid("form-support")), "support page");
    await b!.evaluate("history.back()");
    await until(async () => await present(tid("inquiry-intake-notice")), "Back restores the unconfirmed notice");
    check(await b!.evaluate(`document.querySelector('[data-testid="inquiry-intake-notice"]').getAttribute('data-intake-phase')`) === "unresolved" && !(await present(tid("inquiry-success"))), "Back to the form shows the request as still unconfirmed, never as saved");
    await b!.evaluate("history.forward()");
    await until(async () => await present(tid("form-support")), "Forward to support");
    check(!(await present(tid("inquiry-intake-notice"))), "Forward leaves the unconfirmed notice off the support page (storage slots are per form)");
    await b!.evaluate("history.back()");
    await until(async () => await present(tid("inquiry-intake-notice")), "Back again restores the notice");
    // 3. Reload: the unconfirmed intent is restored, and re-entering the same details finishes it without a duplicate.
    await b!.navigate("/about-contact");
    await until(async () => await present(tid("inquiry-intake-notice")), "restored notice after reload");
    check(await b!.evaluate(`document.querySelector('[data-testid="inquiry-intake-notice"]').getAttribute('data-intake-phase')`) === "unresolved", "After a reload the unconfirmed request is still shown as unconfirmed");
    await fill(email);
    await scrollTo(tid("button-inquiry-submit"));
    await b!.click(tid("button-inquiry-submit"));
    await until(async () => await present(tid("inquiry-success")), "same details finish the request", 120);
    const rows = await requestsFor(email);
    check(rows.length === 1 && (await text(tid("inquiry-success-reference"))).includes(shortRef(rows[0].id)), "Re-entering the same details finished the request: one occurrence, same reference");
    check(await count(`SELECT count(*) n FROM inbound_request_work_links WHERE request_id=$1 AND work_type='task'`, [rows[0].id]) === 1
      && await count(`SELECT count(*) n FROM notifications WHERE inbound_request_id=$1`, [rows[0].id]) === 1, "The replay left exactly one task and one notification");
  });

  // ═══ WC-09: the status read keeps the original receipt through reload, failure and success ═════
  await step("Status read keeps the receipt", async () => {
    await view(1280);
    const email = `wcb-${tag}-check@example.com`;
    await freshForm("/about-contact", "form-general-inquiry");
    await fault("mangle-post");
    await b!.set("#inquiry-businessName", `Check Cafe ${tag}`);
    await b!.set("#inquiry-name", "Cora Check");
    await b!.set("#inquiry-email", email);
    await pick("inquiry-select-intent", "equipment");
    await scrollTo(tid("button-inquiry-submit"));
    await b!.click(tid("button-inquiry-submit"));
    await until(async () => await present(tid("inquiry-intake-receipt")), "unresolved with a receipt");
    const stored = await storedIntent("general_inquiry");
    check(stored?.state === "unresolved" && Boolean(stored.receipt) && stored.receipt === (await requestsFor(email))[0]?.id, "An answer that does not confirm the save still carries the real receipt, and it is stored");
    await fault(null);
    await b!.navigate("/about-contact");
    await until(async () => await present(tid("inquiry-intake-receipt")), "receipt after reload");
    check((await text(tid("inquiry-intake-receipt"))).trim() === stored!.receipt, "After a reload the original, non-empty receipt is shown");
    for (const status of [404, 409, 500]) {
      await fault(`status-${status}`);
      await b!.click(tid("inquiry-intake-check"));
      await until(async () => await present(tid("inquiry-intake-check-note")), `check note after ${status}`);
      const after = await storedIntent("general_inquiry");
      check(after?.receipt === stored!.receipt && after.key === stored!.key && after.state === "unresolved" && (await text(tid("inquiry-intake-receipt"))).trim() === stored!.receipt,
        `A ${status} from the status read never clears the key or the receipt`);
      check(!(await present(tid("inquiry-success"))), `A ${status} from the status read is never shown as success`);
      await b!.navigate("/about-contact");
      await until(async () => await present(tid("inquiry-intake-receipt")), `receipt after ${status} and reload`);
    }
    await fault(null);
    await b!.click(tid("inquiry-intake-check"));
    await until(async () => await present(tid("inquiry-success")), "status read confirms the save", 60);
    const row = (await requestsFor(email))[0];
    check((await text(tid("inquiry-success-reference"))).includes(shortRef(row.id)), "A read-only status success shows the reference of the original request");
    const after = await storedIntent("general_inquiry");
    check(after?.receipt === row.id && after.state === "saved", "A confirmed read keeps the original receipt (saved), rather than clearing it first");
    await b!.navigate("/about-contact");
    await until(async () => await present(tid("inquiry-success")), "saved after reload");
    check((await text(tid("inquiry-success-reference"))).includes(shortRef(row.id)) && (await requestsFor(email)).length === 1, "After another reload the same reference is shown and still only one request exists");
  });

  // ═══ Statement: confirmed read after an unreadable answer, and a lost answer finished by the same submission ═══
  await step("Ambiguous statement", async () => {
    await view(390);
    const emailA = `wcb-${tag}-stmt-check@example.com`;
    await freshForm("/upload-statement", "form-upload-statement");
    await fault("mangle-upload");
    await fillStatement({ business: `Statement Check ${tag}`, name: "Sue Check", email: emailA });
    await chooseFile(goodPath);
    await scrollTo(tid("button-upload-submit"));
    await b!.click(tid("button-upload-submit"));
    await until(async () => await present(tid("button-check-upload-status")), "unresolved with a status check");
    check(!(await present(tid("section-upload-success"))), "An upload answer that cannot be read is never shown as received");
    const rowA = (await requestsFor(emailA))[0];
    check(rowA && (await storedIntent("statement_upload"))?.receipt === rowA.id, "The unreadable answer still carried the real receipt");
    await fault(null);
    await b!.navigate("/upload-statement");
    await until(async () => await present(tid("button-check-upload-status")), "check available after reload");
    await fault("status-404");
    await b!.click(tid("button-check-upload-status"));
    await until(async () => await present(tid("text-upload-check-note")), "check note after a failed read");
    check((await storedIntent("statement_upload"))?.receipt === rowA.id && !(await present(tid("section-upload-success"))), "A failed status read keeps the receipt and is not shown as received");
    await fault(null);
    await b!.click(tid("button-check-upload-status"));
    await until(async () => await present(tid("section-upload-success")), "status read confirms the upload", 60);
    check((await text(tid("text-upload-reference"))).trim() === shortRef(rowA.id), "The status read shows the reference of the original upload");
    await b!.navigate("/upload-statement");
    await until(async () => await present(tid("section-upload-success")), "confirmed upload restored after reload");
    check((await text(tid("text-upload-reference"))).trim() === shortRef(rowA.id) && (await requestsFor(emailA)).length === 1, "After a reload the same reference is shown and only one occurrence exists");

    // The answer is lost entirely; the same submission finishes it without a second occurrence.
    const emailB = `wcb-${tag}-stmt-lost@example.com`;
    await freshForm("/upload-statement", "form-upload-statement");
    const objectsBefore = await count(`SELECT count(*) n FROM protected_objects`);
    await fault("lose-upload");
    await fillStatement({ business: `Statement Lost ${tag}`, name: "Len Lost", email: emailB });
    await chooseFile(goodPath);
    await scrollTo(tid("button-upload-submit"));
    await b!.click(tid("button-upload-submit"));
    await until(async () => await present(tid("alert-submit-error")), "unconfirmed banner");
    check(!(await present(tid("section-upload-success"))) && (await requestsFor(emailB)).length === 1, "A lost answer is shown as unconfirmed while the server really saved one occurrence");
    await fault(null);
    await b!.navigate("/upload-statement");
    await until(async () => await present(tid("alert-submit-error")), "unconfirmed banner after reload");
    await fillStatement({ business: `Statement Lost ${tag}`, name: "Len Lost", email: emailB });
    await chooseFile(goodPath);
    await scrollTo(tid("button-upload-submit"));
    await b!.click(tid("button-upload-submit"));
    await until(async () => await present(tid("section-upload-success")), "the same submission finishes the upload", 120);
    const rowsB = await requestsFor(emailB);
    check(rowsB.length === 1 && (await text(tid("text-upload-reference"))).trim() === shortRef(rowsB[0].id), "The identical resubmission replayed the stored occurrence: one request, the original reference");
    check(await count(`SELECT count(*) n FROM protected_objects`) - objectsBefore === 1 && await count(`SELECT count(*) n FROM statement_upload_commands WHERE request_id=$1`, [String((await storedIntent("statement_upload"))?.key)]) === 1, "The lost answer and its replay stored the file once and recorded one command");

    // A lost answer, then a changed detail or a different file: nothing is sent, the original key is kept, and only an
    // explicit "Start a new request" lets the visitor begin another one.
    const emailC = `wcb-${tag}-stmt-changed@example.com`;
    await freshForm("/upload-statement", "form-upload-statement");
    await fault("lose-upload");
    await fillStatement({ business: `Statement Changed ${tag}`, name: "Cy Changed", email: emailC });
    await chooseFile(goodPath);
    await scrollTo(tid("button-upload-submit"));
    await b!.click(tid("button-upload-submit"));
    await until(async () => await present(tid("alert-submit-error")), "unconfirmed banner before the change");
    const lostIntent = await storedIntent("statement_upload");
    check((await requestsFor(emailC)).length === 1 && lostIntent?.state === "unresolved" && Boolean(lostIntent.key), "The lost answer left one saved request and an unresolved intent that holds its key");
    await fault(null);
    const objectsC = await count(`SELECT count(*) n FROM protected_objects`);
    const bannerText = () => text(tid("text-submit-error"));
    const heldBack = async (label: string) => {
      await scrollTo(tid("button-upload-submit"));
      await b!.click(tid("button-upload-submit"));
      await settle(900);
      await until(async () => (await bannerText()).includes("were not sent"), `${label}: held-back notice`);
      const kept = await storedIntent("statement_upload");
      check((await requestsFor(emailC)).length === 1 && await count(`SELECT count(*) n FROM protected_objects`) === objectsC, `${label}: nothing was sent, so no second request or stored file exists`);
      check(kept?.key === lostIntent!.key && kept.state === "unresolved", `${label}: the original idempotency key is kept`);
      check(await present(tid("button-start-new-upload")) && !(await present(tid("section-upload-success"))), `${label}: the visitor is offered an explicit new request and is not shown a success`);
    };
    await fillStatement({ business: `Statement Changed ${tag} corrected`, name: "Cy Changed", email: emailC });
    await heldBack("Changed detail after a lost answer");
    await fillStatement({ business: `Statement Changed ${tag}`, name: "Cy Changed", email: emailC });
    await chooseFile(otherPath);
    await heldBack("Different file after a lost answer");
    await b!.click(tid("button-start-new-upload"));
    await until(async () => !(await present(tid("alert-submit-error"))), "banner cleared by the explicit new request");
    check(await storedIntent("statement_upload") === null, "Start a new request clears the unconfirmed intent, and only that action does");
    await scrollTo(tid("button-upload-submit"));
    await b!.click(tid("button-upload-submit"));
    await until(async () => await present(tid("section-upload-success")), "the explicit new request is saved", 120);
    const rowsC = await requestsFor(emailC);
    check(rowsC.length === 2 && (await storedIntent("statement_upload"))?.key !== lostIntent!.key, "The explicit new request is a second request under a new key");

    // The server saved the upload and then reported a fault: the page must keep the key and finish the same request.
    const emailD = `wcb-${tag}-stmt-faulted@example.com`;
    await freshForm("/upload-statement", "form-upload-statement");
    await fault("fail-upload");
    await fillStatement({ business: `Statement Faulted ${tag}`, name: "Fay Faulted", email: emailD });
    await chooseFile(goodPath);
    await scrollTo(tid("button-upload-submit"));
    await b!.click(tid("button-upload-submit"));
    await until(async () => await present(tid("alert-submit-error")), "banner after a failure answer");
    const faulted = await storedIntent("statement_upload");
    check((await requestsFor(emailD)).length === 1 && faulted?.state === "unresolved" && Boolean(faulted.key) && !(await present(tid("section-upload-success"))),
      "A failure answer for an upload the server saved keeps the key as unconfirmed and shows no success");
    check(!(await bannerText()).includes("check your details"), "A failure answer is not worded as a validation problem the visitor must fix");
    await fault(null);
    await scrollTo(tid("button-upload-submit"));
    await b!.click(tid("button-upload-submit"));
    await until(async () => await present(tid("section-upload-success")), "the same key finishes the faulted upload", 120);
    const rowsD = await requestsFor(emailD);
    check(rowsD.length === 1 && (await text(tid("text-upload-reference"))).trim() === shortRef(rowsD[0].id), "Retrying after the failure answer finished the one request with its original reference");

    // The server answers a key conflict: an earlier request exists under this key, so the key is kept and the visitor chooses.
    const emailE = `wcb-${tag}-stmt-conflict@example.com`;
    await freshForm("/upload-statement", "form-upload-statement");
    await fault("conflict-upload");
    await fillStatement({ business: `Statement Conflict ${tag}`, name: "Cora Conflict", email: emailE });
    await chooseFile(goodPath);
    await scrollTo(tid("button-upload-submit"));
    await b!.click(tid("button-upload-submit"));
    await until(async () => await present(tid("alert-submit-error")), "banner after a key conflict");
    const conflicted = await storedIntent("statement_upload");
    check(conflicted?.state === "unresolved" && Boolean(conflicted.key) && await present(tid("button-start-new-upload")) && (await bannerText()).includes("cannot say whether it was saved"),
      "A key conflict keeps the key, says it cannot tell whether the earlier request was saved, and offers an explicit new request");
    await fault(null);
    await scrollTo(tid("button-upload-submit"));
    await b!.click(tid("button-upload-submit"));
    await until(async () => await present(tid("section-upload-success")), "the same key replays after the conflict answer", 120);
    const rowsE = await requestsFor(emailE);
    check(rowsE.length === 1 && (await text(tid("text-upload-reference"))).trim() === shortRef(rowsE[0].id), "Retrying with the kept key replayed the one request instead of creating another");
  });

  // ═══ C0: the mobile menu returns focus to its trigger ═════════════════════════════════════════
  await step("Mobile menu focus", async () => {
    await view(390);
    const trigger = tid("button-mobile-menu");
    const triggerFocused = () => b!.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(trigger)})`) as Promise<boolean>;
    const expanded = () => b!.evaluate(`document.querySelector(${JSON.stringify(trigger)})?.getAttribute('aria-expanded')`) as Promise<string>;
    const openMenu = async () => {
      await b!.navigate("/");
      await until(async () => await present(trigger), "menu button");
      await b!.click(trigger);
      await until(async () => await present(tid("mobile-nav-drawer")), "drawer open");
    };
    const closed = () => until(async () => !(await present(tid("mobile-nav-drawer"))), "drawer unmounted");

    await openMenu();
    check(await expanded() === "true" && await b!.evaluate(`document.querySelector(${JSON.stringify(trigger)}).getAttribute('aria-controls')`) === await b!.evaluate(`document.querySelector('[data-testid="mobile-nav-drawer"]').id`), "Open menu: the button reports expanded and controls the drawer");
    await press("Escape", "Escape", 27);
    await closed(); await settle(400);
    check(await triggerFocused() && await expanded() === "false", "Menu then Escape: focus returns to the Menu button and it reports collapsed");

    await openMenu();
    await b!.click('[data-testid="mobile-nav-drawer"] > button');
    await closed(); await settle(400);
    check(await triggerFocused() && await expanded() === "false", "Menu then the X button: focus returns to the Menu button");

    await openMenu();
    await b!.call("Input.dispatchMouseEvent", { type: "mousePressed", x: 12, y: 420, button: "left", clickCount: 1 });
    await b!.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: 12, y: 420, button: "left", clickCount: 1 });
    await closed(); await settle(400);
    check(await triggerFocused(), "Menu then the overlay: focus returns to the Menu button");

    await openMenu();
    check(String(await b!.evaluate("location.pathname")) === "/", "The drawer opened on the home page");
    await b!.click(tid("link-mobile-talk"));
    await closed(); await settle(500);
    check(String(await b!.evaluate("location.pathname")) === "/about-contact", "A link in the drawer navigates to its page");
    await until(async () => await b!.evaluate("document.activeElement?.tagName") === "MAIN", "focus reaches the destination's main region", 40);
    check(!(await triggerFocused()) && await b!.evaluate("document.querySelector('main')===document.activeElement && !!document.querySelector('[data-testid=\"form-general-inquiry\"]')?.closest('main')"), "After a link navigation focus lands on the destination page's own main region, not on the old Menu button");

    // Negative control: with the trigger gone there is nothing to restore to, and this check must say so.
    await openMenu();
    await b!.evaluate(`window.__detached = document.querySelector(${JSON.stringify(trigger)}); window.__detached.remove();`);
    await press("Escape", "Escape", 27);
    await closed(); await settle(400);
    check(await b!.evaluate("!document.body.contains(window.__detached) && document.activeElement!==window.__detached"), "Negative control: with the trigger removed focus cannot be on it, so the restoration check fails for the intended reason");
  });

  // The file-attach step belongs to the statement worker, which does not run in this fixture. Link a retained document to the
  // occurrence exactly as that step records it (command.document_id), so the staff link is exercised against real rows.
  const statementRequest = (await h.pool.query(`SELECT * FROM inbound_requests WHERE upper(substr(id::text,1,8))=$1`, [refs.statement])).rows[0];
  const statementDocumentId = Number((await h.pool.query(`INSERT INTO documents (contact_id, type, file_name, category, access_scope, status) VALUES ($1,'statement','wcb-statement.pdf','Statements','internal','active') RETURNING id`, [statementRequest.contact_id])).rows[0].id);
  await h.pool.query(`UPDATE statement_upload_commands SET document_id=$2 WHERE request_id=$1`, [refs.statementKey, statementDocumentId]);

  // ═══ Staff: request → task → file, and the statement handoff view ═════════════════════════════
  await open("admin");
  await step("Staff views", async () => {
    await view(1280);
    await b!.navigate(`/dashboard/lead-ops?tab=pipeline&ref=${refs.terminal}`);
    await until(async () => await present(tid(`inbound-row-${refs.terminal}`)), "terminal request in Inbound Operations");
    const detail = await text(tid(`request-details-${refs.terminal}`));
    check(/\$5,000–\$24,999/.test(detail) && /Restaurant/.test(detail) && /Currently leasing a terminal: Yes/.test(detail) && /No phone provided/.test(detail), "Staff see the band, business type, lease answer and that no phone was given");
    check(await present(tid(`link-work-${refs.terminal}`)), "Staff can open the review task from the request");
    await b!.navigate(`/dashboard/lead-ops?tab=pipeline&ref=${refs.general}`);
    await until(async () => await present(tid(`inbound-row-${refs.general}`)), "general request");
    check(/Discuss: /.test(await text(tid(`request-details-${refs.general}`))) && !/Monthly card volume/.test(await text(tid(`request-details-${refs.general}`))), "A general inquiry shows its intent and none of the equipment fields");
    await b!.navigate(`/dashboard/lead-ops?tab=pipeline&ref=${refs.statement}`);
    await until(async () => await present(tid(`inbound-row-${refs.statement}`)), "statement request");
    check(/Automatic analysis held/.test(await text(tid(`statement-analysis-${refs.statement}`))) && !/completed|queued/i.test(await text(tid(`statement-analysis-${refs.statement}`))), "A deferred statement shows analysis as held, never queued or completed");
    check((await b!.evaluate(`document.querySelector(${JSON.stringify(tid(`link-statement-file-${refs.statement}`))})?.getAttribute('href')`)) === `/api/documents/download/${statementDocumentId}`, "Request to protected file with no deal: the request opens the retained file through the protected download");

    await b!.navigate(`/dashboard/lead-ops?tab=pipeline&ref=${refs.terminal}`);
    await until(async () => await present(tid(`inbound-row-${refs.terminal}`)) && !(await present(tid(`inbound-row-${refs.statement}`))), "first reference only");
    await b!.navigate(`/dashboard/lead-ops?tab=pipeline&ref=${refs.statement}`);
    await until(async () => await present(tid(`inbound-row-${refs.statement}`)) && !(await present(tid(`inbound-row-${refs.terminal}`))), "second reference only");
    await b!.evaluate("history.back()");
    await until(async () => await present(tid(`inbound-row-${refs.terminal}`)) && !(await present(tid(`inbound-row-${refs.statement}`))), "Back returns to the first reference");
    check((await b!.evaluate("location.search") as string).includes(`ref=${refs.terminal}`), "Back returns to the first reference and its row (the lookup is URL-backed)");
    await b!.evaluate("history.forward()");
    await until(async () => await present(tid(`inbound-row-${refs.statement}`)) && !(await present(tid(`inbound-row-${refs.terminal}`))), "Forward returns to the second reference");
    check((await b!.evaluate("location.search") as string).includes(`ref=${refs.statement}`), "Forward returns to the second reference and its row");

    for (const [width, theme] of [[1280, "light"], [768, "dark"], [390, "light"]] as const) {
      await view(width, theme);
      await b!.navigate("/dashboard/lead-ops?tab=pipeline");
      await until(async () => await present(tid("statement-chain-panel")) && await present(tid("list-statement-chain")), `statement handoff list at ${width}`);
      await noPageOverflow(`Statement handoff ${width}px ${theme}`);
      check(await b!.evaluate(`(()=>{const c=document.querySelector('[data-testid="statement-chain-panel"]');const r=c.getBoundingClientRect();return r.left>=-1&&r.right<=window.innerWidth+1})()`), `Statement handoff ${width}px ${theme}: the panel fits the viewport`);
    }
    await view(1280, "light");
    await b!.navigate("/dashboard/lead-ops?tab=pipeline");
    await until(async () => await present(tid(`row-chain-${refs.statement}`)), "the statement appears in the handoff view");
    const row = await text(tid(`row-chain-${refs.statement}`));
    check(/manual review/i.test(await text(tid(`badge-chain-status-${refs.statement}`))) && /Automatic analysis held/.test(row), "The handoff view says manual review and analysis held for a deferred statement");
    check(!/Complete/.test(await text(tid(`badge-chain-status-${refs.statement}`))), "No deferred statement is labelled complete");
    check(/held/i.test(await text(tid("text-chain-analysis-setting"))), "The panel states that automatic analysis is held");
    check(await present(tid(`link-chain-file-${refs.statement}`)) && (await b!.evaluate(`document.querySelector(${JSON.stringify(tid(`link-chain-file-${refs.statement}`))}).getAttribute('href')`)) === `/api/documents/download/${statementDocumentId}`, "The retained file link is the protected admin/manager download of that occurrence's document");
    check(/Showing \d+ of the latest \d+ requests as of /.test(await text(tid("text-chain-scope"))), "The panel states its window and as-of time");

    // A failed read is never an all-clear.
    b!.failRead("/api/operator/statement-chain");
    await b!.click(tid("button-refresh-chain"));
    await until(async () => await present(tid("chain-unavailable")), "unavailable state");
    check(!(await present(tid("chain-empty"))) && !(await present(tid("list-statement-chain"))) && /not an all-clear/i.test(await text(tid("chain-unavailable"))), "A failed read says unavailable and 'not an all-clear', never an empty or healthy list");
    check(await present(tid("button-chain-retry")), "The unavailable state offers Retry");
    b!.failRead(null);
    await b!.click(tid("button-chain-retry"));
    await until(async () => await present(tid("list-statement-chain")), "Retry recovers");
    check(true, "Retry loads the list again");
  });

  await open("manager");
  await step("Manager", async () => {
    await view(1280);
    await b!.navigate("/dashboard/lead-ops?tab=pipeline");
    await until(async () => await present(tid("statement-chain-panel")) && await present(tid("list-statement-chain")), "manager statement handoff");
    check(await present(tid(`link-chain-file-${refs.statement}`)), "A manager can open the request and the retained file link");
  });

  await open("agent");
  await step("Agent", async () => {
    await b!.navigate("/dashboard");
    await until(async () => (await b!.text()).length > 200, "agent dashboard");
    check(await b!.evaluate("fetch('/api/operator/statement-chain').then(r=>r.status)") === 403, "An agent's statement handoff request is refused with 403");
    await b!.navigate("/dashboard/lead-ops?tab=pipeline");
    await settle(1500);
    check(!(await present(tid("statement-chain-panel"))), "An agent never sees the statement handoff panel");
  });

  // Real persisted Chromium zoom (200%): the window is not resized or emulated, so the layout viewport is the browser's own.
  await open("anonymous", 2);
  await step("Native 200% browser zoom", async () => {
    const pages: Array<[string, string, string]> = [
      ["Free Smart Terminal", "/free-smart-terminal", ""],
      ["Terminal inquiry", "/get-started?offer=free-terminal", "form-terminal-inquiry"],
      ["General inquiry", "/about-contact", "form-general-inquiry"],
      ["Support", "/support", "form-support"],
      ["Statement review", "/upload-statement", "form-upload-statement"],
    ];
    for (const [label, route, formId] of pages) {
      await b!.navigate(route);
      await until(async () => (formId ? await present(tid(formId)) : await present("h1")), `${label} at 200% zoom`);
      await settle(400);
      const geo = await b!.evaluate(`({ ratio: devicePixelRatio, cssWidth: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1, h1: document.querySelectorAll('h1').length })`) as { ratio: number; cssWidth: number; overflow: boolean; h1: number };
      check(geo.ratio === 2 && geo.cssWidth <= 800, `${label}: the browser really runs at 200% zoom (device pixel ratio ${geo.ratio}, ${geo.cssWidth} CSS px wide)`);
      check(!geo.overflow && geo.h1 === 1, `${label} at 200% zoom: no horizontal page overflow and one page heading`);
      if (formId) {
        const submit = `${tid(formId)} button[type="submit"]`;
        await b!.evaluate(`document.querySelector(${JSON.stringify(submit)})?.scrollIntoView({block:'center'})`);
        await settle(250);
        check(await b!.evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(submit)});if(!el)return false;const r=el.getBoundingClientRect();if(r.width<1||r.left<-1||r.right>innerWidth+1)return false;const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !!hit&&(el===hit||el.contains(hit))})()`), `${label} at 200% zoom: the submit action is reachable and not covered by the header, banner or assistant`);
      }
    }
  });

  await step("Accounting", async () => {
    exceptionsByActor[actor] = [...(exceptionsByActor[actor] ?? []), ...b!.exceptions];
    const all = Object.entries(exceptionsByActor).flatMap(([who, list]) => list.map((e) => `${who}: ${e}`));
    check(all.length === 0, `No uncaught browser exception in any role (${all.slice(0, 2).join(" ; ")})`);
    check(h.externalCalls() === 0, "No external network call was attempted");
    const evidence = await outboundEvidence();
    check(evidence.sent === 0 && evidence.receipts === 0, "No message or receipt was sent or recorded as sent");
  });

  assert.equal(failures.length, 0, `Failed sections:\n${failures.join("\n")}`);
  await writeFile(`${dir}/receipt.json`, JSON.stringify({ checks: checks.length, widths: [320, 390, 768, 1024, 1440], roles: ["anonymous", "admin", "manager", "agent"], productionData: false, providerTransport: "denied" }, null, 2));
  console.log(`\nPublic W-C intake browser acceptance: ${checks.length} checks passed; screenshots in ${dir}`);
} finally {
  if (b) await b.close().catch(() => {});
  await h.close().catch(() => {});
}
process.exit(0);
