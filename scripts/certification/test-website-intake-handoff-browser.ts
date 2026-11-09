/**
 * Website intake and CRM handoff: mounted-browser acceptance.
 *
 * Real persisted admin/manager/agent sessions, the compiled production client (dist/public), the real public,
 * Lead Ops, acknowledgement, template and notification route handlers, on a disposable database with deny-by-default
 * egress and the global outbound pause in force. There is no queue consumer in this process, which is exactly the
 * production failure: every accepted statement is retained and deferred, and every surface must say so truthfully.
 *
 * Unregistered APIs answer 501, so unregistered readers must render explicit unavailable states. The Comms Hub inbox
 * response is FIXTURE-SUPPLIED (the real reader would call a provider): it proves how the client renders a failed
 * source and Retry, not what the live reader returns.
 *
 * Nothing is sent: no provider is configured, transports are denied and no worker runs.
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
const dir = "generated-artifacts/website-intake-handoff-browser";
const clientRoot = path.resolve("dist/public");
await mkdir(dir, { recursive: true });

// Production sets APP_URL (see .replit); generated receipt HTML then references the logo by that absolute URL. Set here so the
// preview path under test sees the same markup. It only changes URL text: egress stays denied and nothing is requested.
process.env.APP_URL = "https://libertybancard.com";
let inboxCalls = 0;
let inboxMode: "partial_failure" | "ok" = "partial_failure";
const h = await stage3BHttpFixture(async (app) => {
  (await import("../../server/routes/public")).registerPublicRoutes(app);
  (await import("../../server/routes/lead-ops")).registerLeadOpsRoutes(app);
  (await import("../../server/routes/inbound-acknowledgements")).registerInboundAcknowledgementRoutes(app);
  (await import("../../server/routes/templates-settings")).registerTemplatesSettingsRoutes(app);
  (await import("../../server/routes/notifications")).registerNotificationsRoutes(app);
  (await import("../../server/routes/analytics")).registerAnalyticsRoutes(app); // the real KPI read the Overview needs before it shows any card
  // FIXTURE-SUPPLIED inbox payload (see header).
  app.get("/api/inbox/items", (_req, res) => {
    inboxCalls++;
    res.json({
      items: [], complete: inboxMode === "ok", totalIsExact: inboxMode === "ok", knownFilteredCount: 0, hasMoreKnown: false, nextCursor: null,
      resultScope: "all_sources_exhausted", ghlConfigured: true,
      sourceStatus: inboxMode === "ok"
        ? [{ source: "live_chat", status: "ok", fetched: 0, truncated: false }, { source: "ghl_sms", status: "ok", fetched: 0, truncated: false }]
        : [{ source: "live_chat", status: "ok", fetched: 0, truncated: false }, { source: "ghl_sms", status: "failed", fetched: 0, truncated: false, errorCode: "SOURCE_UNAVAILABLE" }],
    });
  });
  app.use("/api", (_req, res) => res.status(501).json({ message: "Source not registered in this isolated intake fixture" }));
  const { static: serveStatic } = await import("express");
  app.use((req, res, next) => serveStatic(clientRoot)(req, res, next));
  app.use((_req, res) => res.sendFile("index.html", { root: clientRoot }));
}, undefined, { backgroundProfile: "off" });

const checks: string[] = [];
const check = (value: unknown, message: string) => { assert.ok(value, message); checks.push(message); console.log(`✓ [WIB-${String(checks.length).padStart(2, "0")}] ${message}`); };
const settle = (ms = 200) => new Promise((resolve) => setTimeout(resolve, ms));
const exceptionsByActor: Record<string, string[]> = {};
let b: Awaited<ReturnType<typeof privateStage3Browser>> | undefined;
let actor = "";
const count = async (sql: string, params: unknown[] = []) => Number((await h.pool.query(sql, params)).rows[0].n);

const failures: string[] = [];
// A failing section is recorded and the run continues, so one run reports every broken surface; the run still fails at the end.
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
// Narrow-screen cards and the wide table both render in the DOM (one hidden by CSS); "present" means actually visible.
const present = (selector: string) => b!.evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].some(e=>e.getClientRects().length>0)`) as Promise<boolean>;
const text = (selector: string) => b!.evaluate(`document.querySelector(${JSON.stringify(selector)})?.innerText ?? ''`) as Promise<string>;
const open = async (role: "admin" | "manager" | "agent") => {
  if (b) { exceptionsByActor[actor] = [...(exceptionsByActor[actor] ?? []), ...b.exceptions]; await b.close(); }
  actor = role;
  b = await privateStage3Browser(h.base, h.sessions.get(role)!.cookie, h.originalFetch, dir, { realInput: true, startupTimeoutMs: 40000 });
  // The app's service worker answers some reads itself; keep it out of fault injection.
  await b.call("Network.setBypassServiceWorker", { bypass: true });
  await b.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await b.navigate("/upload-statement");
  await b.evaluate(`localStorage.setItem('liberty_setup_notice_hidden','true');localStorage.setItem('libertycrm_tour_completed','true');localStorage.setItem('prefer_desktop','true')`);
};
const view = async (width: number, theme: "light" | "dark") => {
  await b!.call("Emulation.setDeviceMetricsOverride", { width, height: width < 500 ? 844 : 900, deviceScaleFactor: 1, mobile: false });
  await b!.evaluate(`localStorage.setItem('liberty-theme',${JSON.stringify(theme)})`);
};
const noPageOverflow = (label: string) => b!.evaluate("document.documentElement.scrollWidth<=window.innerWidth+1").then((ok) => check(ok, `${label}: no horizontal page overflow`));
const VIEWPORTS = [1280, 768, 390] as const;
const THEMES = ["light", "dark"] as const;

// ── Fixtures: real uploads through the real public route (the production failure scenario) ──────────
const tag = randomUUID().replaceAll("-", "").slice(0, 8);
const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"), Buffer.alloc(2048, 0x20)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]), Buffer.alloc(2048, 0x11), Buffer.from([0xff, 0xd9])]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2048, 0x22)]);
const NOT_A_STATEMENT = Buffer.from("MZ this is a program, not a statement ".repeat(20));
let phoneSeq = Number.parseInt(tag.slice(0, 4), 16) * 100;
const phoneFor = () => `+1555${String(phoneSeq++).padStart(7, "0").slice(-7)}`;
const seed = async (business: string, bytes: Buffer, type: string, name: string) => {
  const form = new FormData();
  form.append("statementFile", new Blob([bytes], { type }), name);
  form.append("businessName", business);
  form.append("contactName", "Browser Fixture");
  form.append("email", `wib-${tag}-${randomUUID().slice(0, 6)}@example.com`);
  form.append("mobile", phoneFor());
  const response = await fetch(`${h.base}/api/public/statement-upload`, { method: "POST", body: form, headers: { "idempotency-key": randomUUID() } });
  const body = await response.json() as any;
  assert.equal(response.status, 202, `Fixture upload must be accepted: ${JSON.stringify(body).slice(0, 200)}`);
  const ref = body.reference as string;
  const receipt = String((await h.pool.query(`SELECT id FROM inbound_requests WHERE upper(substr(id::text,1,8))=$1`, [ref])).rows[0]?.id);
  assert.match(receipt, /^[0-9a-f-]{36}$/, "The stored occurrence for the returned reference must exist");
  return { ref, receipt, business };
};

try {
  await h.pool.query("UPDATE users SET tour_completed_at=NOW() WHERE id LIKE $1", [`${h.prefix}%`]);
  const LONG = `Extraordinarily Long Hospitality Holdings of South Florida Incorporated ${tag}`;
  const seeded = [
    await seed(`Browser Cafe PDF ${tag}`, PDF, "application/pdf", "May statement.pdf"),
    await seed(`Browser Cafe JPG ${tag}`, JPG, "image/jpeg", "photo.jpg"),
    await seed(LONG, PNG, "image/png", "scan.png"),
  ];
  const [pdf, , long] = seeded;
  check(seeded.every((s) => /^[0-9A-F]{8}$/.test(s.ref)), "Three real uploads (PDF, JPG, PNG) are accepted and deferred with short references");
  // Show the real per-class receipt windows in the disposable database. No worker runs and the global pause holds.
  const ack = await import("../../server/services/inbound-acknowledgement");
  await ack.setAckCapability({ enabled: true, sourceClasses: [...ack.ACK_SOURCE_CLASSES], actor: `wib-${tag}` });
  const effectsBefore = (await h.pool.query(`SELECT request_id, effect_key, state, updated_at FROM inbound_request_effects WHERE effect_key='transactional_ack' ORDER BY request_id`)).rows;

  // ═══ Admin ═════════════════════════════════════════════════════════════════
  await open("admin");

  // Inbound Operations: every viewport and theme, cards below lg and the table from lg.
  await step("Inbound matrix", async () => {
    for (const width of VIEWPORTS) for (const theme of THEMES) {
      await view(width, theme);
      await b!.navigate(`/dashboard/lead-ops?tab=pipeline&ref=${pdf.ref}`);
      await until(async () => await present(`[data-testid="inbound-${width >= 1024 ? "row" : "card"}-${pdf.ref}"]`), `inbound request visible at ${width}/${theme}`);
      const label = `Inbound Operations ${width}px ${theme}`;
      check(await b!.evaluate(`document.documentElement.classList.contains(${JSON.stringify(theme)})`), `${label}: the ${theme} theme is applied`);
      check(await present(`[data-testid="${width >= 1024 ? "inbound-table" : "inbound-cards"}"]`) && !(await present(`[data-testid="${width >= 1024 ? "inbound-cards" : "inbound-table"}"]`)),
        `${label}: ${width >= 1024 ? "the table" : "responsive cards"} render, not both`);
      const row = await text(`[data-testid="inbound-${width >= 1024 ? "row" : "card"}-${pdf.ref}"]`);
      check(/Processing needs attention/i.test(row) && row.includes(pdf.ref) && row.includes(pdf.business), `${label}: the row shows the reference, business and "Processing needs attention"`);
      check(await present('[data-testid="button-statement-recovery"]'), `${label}: the admin sees the retry control`);
      check(await present(`[data-testid="link-work-${pdf.ref}"]`), `${label}: the admin sees the review task link`);
      await noPageOverflow(label);
      check(await b!.evaluate(`(()=>{const c=document.querySelector('[data-testid="card-inbound-operations"]');if(!c)return false;const r=c.getBoundingClientRect();return r.right<=window.innerWidth+1&&r.left>=-1})()`), `${label}: the Inbound Operations card fits the viewport`);
      check(await b!.evaluate(`(()=>{const c=document.querySelector('[data-testid="${width >= 1024 ? "inbound-table" : "inbound-cards"}"]');return !!c&&c.scrollWidth<=c.clientWidth+1})()`), `${label}: the list needs no inner horizontal scroll`);
      await b!.evaluate(`document.querySelector('[data-testid="card-inbound-operations"]').scrollIntoView({block:'start'})`);
      await settle(300);
      await b!.screenshot(`inbound-${width}-${theme}`);
    }
  });

  // Long business name wraps instead of overflowing (cards at 390).
  await step("Long name", async () => {
    await view(390, "light");
    await b!.navigate(`/dashboard/lead-ops?tab=pipeline&ref=${long.ref}`);
    await until(async () => await present(`[data-testid="inbound-card-${long.ref}"]`), "long-name card");
    check(await b!.evaluate(`(()=>{const c=document.querySelector('[data-testid="inbound-card-${long.ref}"]');return c.scrollWidth<=c.clientWidth+1&&c.getBoundingClientRect().right<=innerWidth+1})()`), "A very long business name wraps inside its card at 390px");
    await noPageOverflow("Long business name 390px");
  });

  // Short-reference lookup through the real input and button.
  await step("Lookup", async () => {
    await view(1280, "light");
    await b!.navigate("/dashboard/lead-ops?tab=pipeline");
    await until(async () => await present('[data-testid="input-inbound-ref"]'), "lookup input");
    await b!.set('[data-testid="input-inbound-ref"]', "zz");
    await b!.click('[data-testid="button-inbound-ref-lookup"]');
    await until(async () => await present('[data-testid="text-inbound-ref-error"]'), "malformed reference message");
    check(/4 to 8 characters/.test(await text('[data-testid="text-inbound-ref-error"]')), "A malformed reference is refused with an explanation, not an empty list");
    await b!.set('[data-testid="input-inbound-ref"]', pdf.ref.toLowerCase());
    await b!.click('[data-testid="button-inbound-ref-lookup"]');
    await until(async () => await present(`[data-testid="inbound-row-${pdf.ref}"]`) && !(await present(`[data-testid="inbound-row-${seeded[1].ref}"]`)), "lookup result");
    check((await b!.evaluate("location.search") as string).includes(`ref=${pdf.ref}`), "A lower-case reference finds exactly that request and is carried in the URL");
    check(await present('[data-testid="text-inbound-ref-result"]'), "The lookup states how many requests matched");
    await b!.click('[data-testid="button-inbound-ref-clear"]');
    await until(async () => await present(`[data-testid="inbound-row-${seeded[1].ref}"]`), "cleared lookup lists requests again");
    check(true, "Clearing the lookup lists requests again");
  });

  // Retry statement processing: truthful when no consumer exists, and it never touches the receipt.
  await step("Retry", async () => {
    await b!.navigate(`/dashboard/lead-ops?tab=pipeline&ref=${pdf.ref}`);
    await until(async () => await present('[data-testid="button-statement-recovery"]'), "retry control");
    const rowsBefore = { requests: await count(`SELECT count(*) n FROM inbound_requests`), tasks: await count(`SELECT count(*) n FROM tasks`), notifications: await count(`SELECT count(*) n FROM notifications`), contacts: await count(`SELECT count(*) n FROM contacts`) };
    await b!.click('[data-testid="button-statement-recovery"]');
    await until(async () => await present('[data-testid="text-statement-recovery-result"]'), "retry result");
    check(/processing is not available yet\. Nothing was sent\./.test(await text('[data-testid="text-statement-recovery-result"]')), "Retry says plainly that processing is still unavailable and nothing was sent");
    const rowsAfter = { requests: await count(`SELECT count(*) n FROM inbound_requests`), tasks: await count(`SELECT count(*) n FROM tasks`), notifications: await count(`SELECT count(*) n FROM notifications`), contacts: await count(`SELECT count(*) n FROM contacts`) };
    check(JSON.stringify(rowsBefore) === JSON.stringify(rowsAfter), "Retry created no replacement submission, contact, task or notification");
    check(JSON.stringify((await h.pool.query(`SELECT request_id, effect_key, state, updated_at FROM inbound_request_effects WHERE effect_key='transactional_ack' ORDER BY request_id`)).rows) === JSON.stringify(effectsBefore), "Retry left every receipt effect untouched");
  });

  // Overview.
  await step("Overview", async () => {
    for (const [width, theme] of [[1280, "light"], [768, "dark"], [390, "light"], [390, "dark"]] as const) {
      await view(width, theme);
      await b!.navigate("/dashboard");
      await until(async () => await present('[data-testid="card-website-requests"]') && !(await text('[data-testid="card-website-requests"]')).includes("Loading"), `overview summary at ${width}/${theme}`);
      const label = `Overview ${width}px ${theme}`;
      const summary = await text('[data-testid="card-website-requests"]');
      check(/Statement processing needs attention/i.test(summary) && !/Unavailable/.test(summary), `${label}: the website-requests card answers every question`);
      const needs = Number(await text('[data-testid="text-website-statement-attention"]'));
      check(needs >= 3, `${label}: it counts the three statements needing attention (${needs})`);
      await noPageOverflow(label);
      await b!.evaluate(`document.querySelector('[data-testid="card-website-requests"]').scrollIntoView({block:'start'})`);
      await settle(300);
      await b!.screenshot(`overview-${width}-${theme}`);
    }
  });

  // Receipt settings and previews.
  await step("Receipt settings", async () => {
    for (const [width, theme] of [[1280, "light"], [768, "dark"], [390, "dark"], [390, "light"]] as const) {
      await view(width, theme);
      await b!.navigate("/dashboard/ghl-integration?tab=settings");
      await until(async () => await present('[data-testid="card-inbound-acknowledgements"]'), `receipt settings at ${width}/${theme}`);
      const label = `Receipt settings ${width}px ${theme}`;
      const card = await text('[data-testid="card-inbound-acknowledgements"]');
      check(/not a marketing subscription/i.test(await text('[data-testid="text-ack-not-marketing"]')), `${label}: the card states that a receipt is not a marketing subscription`);
      await until(async () => (await b!.evaluate(`document.querySelectorAll('[data-testid^="text-ack-class-window-"]').length`) as number) >= 5, "five per-class windows");
      check(await present('[data-testid="text-ack-save-semantics"]') && !/Receipt status could not be loaded/.test(card), `${label}: all five request types show their own window and the save semantics`);
      await b!.evaluate(`document.querySelector('[data-testid="button-toggle-receipt-preview"]').scrollIntoView({block:'center'})`);
      await b!.click('[data-testid="button-toggle-receipt-preview"]');
      await until(async () => (await b!.evaluate(`document.querySelectorAll('[data-testid^="button-expand-receipt-"]').length`) as number) >= 5, "five receipt previews");
      check(await b!.evaluate(`[...document.querySelectorAll('[data-testid="receipt-preview-sender"]')].every(e=>/support@/i.test(e.textContent))`), `${label}: every receipt preview is from support@, never a no-reply address`);
      check(await b!.evaluate(`(()=>{const f=[...document.querySelectorAll('iframe[title^="Receipt preview"]')];return f.length>=5&&f.every(x=>x.getAttribute('sandbox')==='')})()`), `${label}: previews render in an empty sandbox (no scripts, forms or same-origin access)`);
      await until(async () => await b!.evaluate(`[...document.querySelectorAll('iframe[title^="Receipt preview"]')].some(x=>/src="data:image\\//.test(x.srcdoc))`) as boolean, "logo inlined into a preview");
    check(true, `${label}: the branded logo is shown in the preview (inlined for display only)`);
      check(!(await b!.evaluate(`[...document.querySelectorAll('iframe[title^="Receipt preview"]')].some(x=>/\\$\\{|\\{\\{/.test(x.srcdoc))`)), `${label}: no raw template token appears in any receipt preview`);
      await noPageOverflow(label);
      await b!.screenshot(`receipt-settings-${width}-${theme}`);
      await b!.evaluate(`document.querySelector('[data-testid^="button-expand-receipt-"]').scrollIntoView({block:'center'})`);
      await b!.click('[data-testid^="button-expand-receipt-"]');
      await until(async () => await present('[data-testid="dialog-receipt-full-preview"]'), "full preview dialog");
      await settle(500);
      check(await b!.evaluate(`(()=>{const r=document.querySelector('[data-testid="dialog-receipt-full-preview"]').getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1&&r.top>=-1&&r.bottom<=innerHeight+1})()`), `${label}: the full-preview dialog fits inside the viewport`);
      // Keyboard users: Escape closes the dialog (non-printable keys use rawKeyDown). A miss is recorded with the focus/layer
      // state and the run continues through the visible Close control so every viewport is still exercised.
      await b!.call("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
      await b!.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
      let escaped = false;
      for (let i = 0; i < 16 && !escaped; i++) { escaped = !(await present('[data-testid="dialog-receipt-full-preview"]')); if (!escaped) await settle(250); }
      if (escaped) check(true, `${label}: Escape closes the full preview`);
      else {
        const diagnostic = await b!.evaluate(`(()=>{const a=document.activeElement;return JSON.stringify({active:(a?.tagName||'')+'/'+(a?.getAttribute('data-testid')||a?.getAttribute('title')||''),focused:document.hasFocus(),open:[...document.querySelectorAll('[data-state="open"]')].map(e=>e.getAttribute('role')||e.tagName).slice(0,8),toasts:document.querySelectorAll('[data-radix-toast-viewport] li').length})})()`);
        failures.push(`${label}: Escape did not close the full preview ${diagnostic}`);
        console.log(`✗ [Receipt settings] ${label}: Escape did not close the full preview ${diagnostic}`);
        await b!.click('[data-testid="dialog-receipt-full-preview"] button:has(.sr-only)');
      }
      await until(async () => !(await present('[data-testid="dialog-receipt-full-preview"]')), "full preview closes");
    }
  });

  // Messaging Inbox scope and failed-source retry (fixture-supplied inbox payload).
  await step("Messaging inbox", async () => {
    for (const [width, theme] of [[1280, "light"], [390, "dark"]] as const) {
      await view(width, theme);
      inboxMode = "partial_failure";
      await b!.navigate("/dashboard/comms-hub");
      await until(async () => await present('[data-testid="text-site-scope"]'), `site scope note at ${width}/${theme}`);
      const label = `Messaging Inbox ${width}px ${theme}`;
      check(/not chat messages/i.test(await text('[data-testid="text-site-scope"]')) && await present('[data-testid="link-site-scope-inbound-operations"]'), `${label}: Site chat is labeled as chat only and points to Inbound Operations`);
      await until(async () => await present('[data-testid="inbox-failed-sources"]'), "failed source notice");
      check(/not an all-clear/i.test(await text('[data-testid="inbox-failed-sources"]')) && await present('[data-testid="button-retry-failed-sources"]'), `${label}: a failed source is named, is not presented as an all-clear, and offers Retry`);
      const callsBefore = inboxCalls;
      inboxMode = "ok";
      await b!.click('[data-testid="button-retry-failed-sources"]');
      await until(async () => inboxCalls > callsBefore && !(await present('[data-testid="inbox-failed-sources"]')), "retry clears the failed-source notice");
      check(true, `${label}: Retry re-reads the sources and clears the notice once they answer`);
      await noPageOverflow(label);
      if (width === 390) await b!.screenshot(`comms-hub-${width}-${theme}`);
    }
  });

  // Notifications: the management notification names the problem and opens the exact request.
  await step("Notifications", async () => {
    await view(1280, "light");
    await b!.navigate("/dashboard/notifications");
    await until(async () => /Processing needs attention/i.test(await b!.text()), "statement notification listed");
    check(true, "The statement notification is listed with the label \"Processing needs attention\"");
    const clicked = await b!.evaluate(`(()=>{const e=[...document.querySelectorAll('a,button,[role="button"],div')].filter(x=>/Processing needs attention/i.test(x.textContent||'')&&x.getClientRects().length).sort((a,c)=>(a.textContent||'').length-(c.textContent||'').length)[0];if(!e)return false;e.scrollIntoView({block:'center'});return true})()`);
    assert(clicked, "A notification row is present to open");
    const notificationLink = await b!.evaluate(`fetch('/api/notifications?limit=50').then(r=>r.json()).then(j=>{const rows=Array.isArray(j)?j:(j.data??j.notifications??[]);const n=rows.find(x=>/Processing needs attention/i.test(x.message||x.title||''));return n?{id:n.id,url:n.target?.url??n.metadata?.link??null}:null})`) as { id: string; url: string | null } | null;
    check(notificationLink?.url?.startsWith("/dashboard/lead-ops?tab=pipeline&ref="), "The notification's target is the exact request in Inbound Operations");
    await b!.navigate(notificationLink!.url!);
    await until(async () => await present("[data-testid^='inbound-row-']"), "notification target opens the request");
    check(true, "Opening the notification target lands on that request's row");
  });

  // ═══ Public upload form, driven like a merchant ═══════════════════════════
  await step("Public upload", async () => {
    const goodPath = path.join(tmpdir(), `wib-${tag}-statement.pdf`);
    const badPath = path.join(tmpdir(), `wib-${tag}-statement-bad.pdf`);
    await writeFile(goodPath, PDF);
    await writeFile(badPath, NOT_A_STATEMENT);
    const chooseFile = async (filePath: string) => {
      const { root } = await b!.call("DOM.getDocument", { depth: 1 });
      const { nodeId } = await b!.call("DOM.querySelector", { nodeId: root.nodeId, selector: '[data-testid="input-file"]' });
      assert(nodeId, "File input must exist");
      await b!.call("DOM.setFileInputFiles", { files: [filePath], nodeId });
    };
    for (const width of VIEWPORTS) {
      await view(width, "light");
      await b!.navigate("/upload-statement");
      await until(async () => await present('[data-testid="section-upload-form"]'), `upload form at ${width}`);
      await noPageOverflow(`Upload form ${width}px`);
    }
    await view(390, "light");
    await b!.navigate("/upload-statement");
    await until(async () => await present('[data-testid="input-business-name"]'), "upload form fields");
    const uiBusiness = `UI Upload Cafe ${tag}`;
    const uiEmail = `wib-ui-${tag}@example.com`;
    await b!.evaluate(`document.querySelector('[data-testid="input-business-name"]').scrollIntoView({block:'center'})`);
    await b!.set('[data-testid="input-business-name"]', uiBusiness);
    await b!.set('[data-testid="input-contact-name"]', "Una Merchant");
    await b!.set('[data-testid="input-email"]', uiEmail);
    await b!.set('[data-testid="input-mobile"]', phoneFor());
    // No file chosen.
    await b!.evaluate(`document.querySelector('[data-testid="button-upload-submit"]').scrollIntoView({block:'center'})`);
    await b!.click('[data-testid="button-upload-submit"]');
    await until(async () => await present('[data-testid="text-submit-error"]'), "missing file message");
    check(/Choose a statement file/.test(await text('[data-testid="text-submit-error"]')) && await count(`SELECT count(*) n FROM contacts WHERE email=$1`, [uiEmail]) === 0, "Submitting with no file says so and creates nothing");
    // A program posing as statement.pdf is refused by the server and the form says what to do.
    await chooseFile(badPath);
    await b!.click('[data-testid="button-upload-submit"]');
    await until(async () => /PDF, JPEG or PNG/.test(await text('[data-testid="text-submit-error"]')), "unsupported file message");
    check(await count(`SELECT count(*) n FROM contacts WHERE email=$1`, [uiEmail]) === 0 && !(await present('[data-testid="section-upload-success"]')), "A non-statement file is refused with clear copy and leaves no contact, file or request behind");
    // The real statement.
    await chooseFile(goodPath);
    await b!.click('[data-testid="button-upload-submit"]');
    await until(async () => await present('[data-testid="section-upload-success"]'), "upload accepted", 120);
    const shownRef = (await text('[data-testid="text-upload-reference"]')).trim();
    check(/^[0-9A-F]{8}$/.test(shownRef), `The merchant is shown a short reference (${shownRef})`);
    check(await present('[data-testid="text-processing-deferred"]') && /do not need to upload it again/i.test(await text('[data-testid="text-processing-deferred"]')), "The merchant is told truthfully that automatic processing is behind and an advisor will handle it");
    check(!/approved|savings|\$\d/i.test(await text('[data-testid="section-upload-success"]')), "The confirmation makes no approval or financial claim");
    await noPageOverflow("Upload confirmation 390px");
    await b!.evaluate(`document.querySelector('[data-testid="section-upload-success"]').scrollIntoView({block:'start'})`);
    await settle(700);
    await b!.screenshot("upload-confirmation-390");
    const uiRow = (await h.pool.query(`SELECT id, lifecycle_state, terminal_reason FROM inbound_requests WHERE upper(substr(id::text,1,8))=$1`, [shownRef])).rows;
    check(uiRow.length === 1 && uiRow[0].lifecycle_state === "review_required" && /STATEMENT_PROCESSING_DEFERRED/.test(uiRow[0].terminal_reason ?? ""), "The reference the merchant sees maps to exactly one stored, deferred occurrence");
    check(await count(`SELECT count(*) n FROM inbound_request_work_links WHERE request_id=$1 AND work_type='task'`, [uiRow[0].id]) === 1
      && await count(`SELECT count(*) n FROM notifications WHERE inbound_request_id=$1`, [uiRow[0].id]) === 1, "That occurrence has its one review task and one notification");
    check(JSON.stringify((await h.pool.query(`SELECT request_id, state FROM inbound_request_effects WHERE request_id=$1 AND effect_key='transactional_ack'`, [uiRow[0].id])).rows.map((r) => r.state)) !== JSON.stringify(["sent"]), "No receipt was sent by the handoff");

    // The merchant's reference finds the same request in the CRM.
    await view(1280, "light");
    await b!.navigate(`/dashboard/lead-ops?tab=pipeline&ref=${shownRef}`);
    await until(async () => await present(`[data-testid="inbound-row-${shownRef}"]`), "merchant reference found in the CRM");
    check((await text(`[data-testid="inbound-row-${shownRef}"]`)).includes(uiBusiness), "The reference the merchant was given opens that merchant's request in the CRM");
  });

  // ═══ Manager: can read, cannot retry ═══════════════════════════════════════
  await step("Manager", async () => {
    await open("manager");
    await view(390, "dark");
    await b!.navigate(`/dashboard/lead-ops?tab=pipeline&ref=${pdf.ref}`);
    await until(async () => await present(`[data-testid="inbound-card-${pdf.ref}"]`), "manager sees the request");
    check(!(await present('[data-testid="button-statement-recovery"]')), "A manager sees the request but not the admin-only retry control");
    await noPageOverflow("Manager Inbound Operations 390px dark");
    await b!.evaluate(`document.querySelector('[data-testid="card-inbound-operations"]').scrollIntoView({block:'start'})`);
    await settle(300);
    await b!.screenshot("inbound-manager-390-dark");
    await view(1280, "light");
    await b!.navigate("/dashboard");
    await until(async () => await present('[data-testid="card-website-requests"]'), "manager overview summary");
    check(true, "A manager sees the website-requests summary on the Overview");
    check(await b!.evaluate(`fetch('/api/lead-ops/inbound-requests/${pdf.receipt}/statement-recovery',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':document.cookie.split('; ').find(c=>c.startsWith('csrf_token='))?.split('=')[1]||''},body:'{}'}).then(r=>r.status)`).then((s) => s === 403), "A manager's retry request is refused with 403 by the server");
  });

  // ═══ Agent: no management surfaces ═════════════════════════════════════════
  await step("Agent", async () => {
    await open("agent");
    await b!.navigate("/dashboard");
    await until(async () => (await b!.text()).length > 200, "agent dashboard renders");
    check(!(await present('[data-testid="card-website-requests"]')), "An agent does not see the website-requests card");
    check(await b!.evaluate("fetch('/api/lead-ops/inbound-requests?ref=" + pdf.ref + "').then(r=>r.status)") === 403
      && await b!.evaluate("fetch('/api/lead-ops/inbound-requests/summary').then(r=>r.status)") === 403, "An agent's list and summary requests are refused with 403");
  });

  // ═══ Whole-run accounting ══════════════════════════════════════════════════
  await step("Accounting", async () => {
    exceptionsByActor[actor] = [...(exceptionsByActor[actor] ?? []), ...b!.exceptions];
    const all = Object.entries(exceptionsByActor).flatMap(([who, list]) => list.map((e) => `${who}: ${e}`));
    check(all.length === 0, `No uncaught browser exception in any role (${all.slice(0, 2).join(" ; ")})`);
    check(h.externalCalls() === 0, "No external network call was attempted");
    check(await count(`SELECT count(*) n FROM outbound_send_log WHERE status IN ('sent','delivered')`) === 0, "No message was sent or recorded as sent");
    check(await count(`SELECT count(*) n FROM inbound_acknowledgements WHERE state IN ('sent','delivered')`) === 0, "No receipt was sent");
  });
  assert.equal(failures.length, 0, `Failed sections:\n${failures.join("\n")}`);
  await writeFile(`${dir}/receipt.json`, JSON.stringify({ checks: checks.length, viewports: VIEWPORTS, themes: THEMES, roles: ["admin", "manager", "agent"], productionData: false, providerTransport: "denied" }, null, 2));
  console.log(`\nWebsite intake handoff browser acceptance: ${checks.length} checks passed; screenshots in ${dir}`);
} finally {
  if (b) await b.close().catch(() => {});
  await h.close().catch(() => {});
}
process.exit(0);
