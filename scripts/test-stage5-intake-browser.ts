import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { randomInt, randomUUID } from "node:crypto";
import { stage3BHttpFixture } from "./fixtures/stage3-b-http";
import { privateStage3Browser } from "./fixtures/private-stage3-browser";
import { verifyCandidateIdentity } from "./fixtures/candidate-build-identity";

// Stage 5 F01-C: public sales forms in a real private Chromium against the REAL public handlers on a disposable database.
// Server faults are real (database triggers armed around a click; response truncation/loss in the HTTP fixture). Verifies for
// Estimate, Get Started and the Home callback adapter, at desktop (1280) and mobile (390) widths:
//   saved (201 review_required), recoverable 202, truncated/lost response, replay on retry, reload restore + status check,
//   real validation 400, and that conversion events (gtag) fire ONLY for a confirmed save.
// NOT EXERCISED here: ContactBubble (not mounted by any route), HelpCenter callback panel (authenticated dashboard widget,
// covered by the shared hook/notice only), a browser-driven 201 "accepted" (public submissions always begin as class review).
const identity = await verifyCandidateIdentity();
const dir = "docs/certification/stage5/intake-browser";
const h = await stage3BHttpFixture(async app => {
  const { registerPublicRoutes } = await import("../server/routes/public");
  registerPublicRoutes(app);
  app.use("/api", (_req, res) => res.status(501).json({ message: "Unregistered isolated service" }));
  const { static: serveStatic } = await import("express");
  app.use(serveStatic("dist/public"));
  app.use((_req, res) => res.sendFile("index.html", { root: `${process.cwd()}/dist/public` }));
}, undefined, { backgroundProfile: "off" });
let b: Awaited<ReturnType<typeof privateStage3Browser>> | undefined;
const checks: string[] = [];
const q = async (text: string, params: unknown[] = []) => (await h.pool.query(text, params)).rows;
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const until = async (expr: string, label = expr) => {
  for (let n = 0; n < 300; n++) { if (await b!.evaluate(expr)) return; await wait(50); }
  const text = String(await b!.evaluate("document.body.innerText.slice(0,600)").catch(() => ""));
  throw new Error(`UI condition not reached: ${label}; page: ${JSON.stringify(text)}; path ${await b!.evaluate("location.pathname")}`);
};
const has = (id: string) => `!!document.querySelector('[data-testid="${id}"]')`;
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
const tid = (id: string) => `[data-testid="${id}"]`;
const events = () => b!.evaluate("JSON.parse(sessionStorage.getItem('__ev')||'[]').filter(e=>e[0]==='event'&&['generate_lead','conversion','form_submission','estimate_request'].includes(e[1])).length") as Promise<number>;
const noOverflow = async (label: string) => {
  const o = await b!.evaluate("({sw:document.documentElement.scrollWidth,iw:innerWidth})") as { sw: number; iw: number };
  assert.ok(o.sw <= o.iw + 1, `${label}: horizontal overflow ${o.sw}>${o.iw}`);
};

type Adapter = {
  name: string; page: string; api: string; prefix: string; sourceType: string; by: "email" | "phone";
  fill: (id: string) => Promise<void>; submit: string; saved: string; retryTarget?: string;
};
const email = () => `s5ib-${randomUUID()}@example.test`;
const phone = () => `30555${randomInt(10000, 99999)}`;
const adapters: Adapter[] = [
  {
    name: "Estimate", page: "/estimate", api: "/api/public/estimate", prefix: "estimate-intake", sourceType: "estimate_form", by: "email",
    submit: tid("button-estimate-submit"), saved: `location.pathname==='/thanks-estimate'`,
    fill: async (id) => {
      await setv(tid("input-contact-name"), "Browser Recover"); await setv(tid("input-business-name"), "Recover Biz");
      await setv(tid("input-email"), id); await setv(tid("input-phone"), "3055550177");
      await scrollClick(tid("select-vertical")); await until(`!!document.querySelector('[role="option"]')`, "vertical options");
      await b!.click(tid("select-vertical-retail")); await wait(250);
      await setv(tid("input-monthly-volume"), "50000"); await setv(tid("input-total-fees"), "1500");
    },
  },
  {
    name: "Get Started", page: "/get-started", api: "/api/public/get-started", prefix: "get-started-intake", sourceType: "get_started_form", by: "email",
    submit: tid("button-submit"), saved: has("text-results-heading"),
    fill: async (id) => {
      for (const sel of ['[data-testid^="card-goal-"]', '[data-testid^="card-vertical-"]', '[data-testid^="card-volume-"]']) {
        await until(`!!document.querySelector('${sel}')`, sel); await scrollClick(sel); await scrollClick(tid("button-next")); await wait(300);
      }
      await until(has("button-terminal-no"), "terminal step"); await scrollClick(tid("button-terminal-no")); await scrollClick(tid("button-next")); await wait(300);
      await until(has("button-zero-no"), "zero step"); await scrollClick(tid("button-zero-no")); await scrollClick(tid("button-next")); await wait(300);
      await until(has("input-first-name"), "contact step");
      await setv(tid("input-first-name"), "Quiz"); await setv(tid("input-last-name"), "Recover");
      await setv(tid("input-email"), id); await setv(tid("input-phone"), "3055550178");
    },
  },
  {
    name: "Home callback", page: "/", api: "/api/public/callback", prefix: "callback-home-intake", sourceType: "callback_form", by: "phone",
    submit: tid("button-callback-submit"), saved: has("text-callback-success"),
    fill: async (id) => {
      await until(has("input-callback-name"), "callback form");
      await b!.evaluate(`document.querySelector('[data-testid="input-callback-name"]').scrollIntoView({block:'center'})`); await wait(300);
      await setv(tid("input-callback-name"), "Call Recover"); await setv(tid("input-callback-phone"), id);
      await scrollClick(tid("button-callback-time-morning"));
    },
  },
];

const rowsFor = async (a: Adapter, id: string) => q(`
  SELECT DISTINCT r.id, r.lifecycle_state, r.terminal_reason, r.contact_id FROM inbound_requests r
  JOIN contact_source_events e ON e.event_key = 'form:' || r.source_type || ':' || r.id
  JOIN contacts c ON c.id = e.contact_id
  WHERE r.source_type = $1 AND ${a.by === "email" ? "lower(c.email) = lower($2)" : "c.phone LIKE '%' || $2"}`, [a.sourceType, id]);
const dealsFor = async (requestId: string) => (await q("SELECT count(*)::int n FROM deals WHERE inbound_request_id=$1", [requestId]))[0].n;
const contactsFor = async (a: Adapter, id: string) => (await q(a.by === "email"
  ? "SELECT count(*)::int n FROM contacts WHERE lower(email)=lower($1)" : "SELECT count(*)::int n FROM contacts WHERE phone LIKE '%' || $1", [id]))[0].n;
const arm = (armed: boolean) => q("UPDATE stage5_fault SET armed=$1 WHERE kind='deal'", [armed]);
const open = async (a: Adapter) => {
  await b!.navigate(a.page);
  await b!.evaluate("sessionStorage.clear()");
  await b!.navigate(a.page);
};
const ident = () => (a: Adapter) => (a.by === "email" ? email() : phone());
const pewc = async (a: Adapter) => { if (a.name === "Home callback") { await scrollClick(tid("checkbox-pewc-consent")); } };

try {
  await mkdir(dir, { recursive: true });
  await q("CREATE TABLE stage5_fault(kind text primary key, armed boolean not null default false)");
  await q("INSERT INTO stage5_fault(kind) VALUES('deal')");
  await q(`CREATE FUNCTION stage5_fault_trip() RETURNS trigger AS $$ BEGIN
    IF EXISTS (SELECT 1 FROM stage5_fault WHERE kind = TG_ARGV[0] AND armed) THEN RAISE EXCEPTION 'STAGE5_FAULT_%', TG_ARGV[0]; END IF;
    RETURN NEW; END $$ LANGUAGE plpgsql`);
  await q("CREATE TRIGGER stage5_fault_deal BEFORE INSERT ON deals FOR EACH ROW EXECUTE FUNCTION stage5_fault_trip('deal')");

  b = await privateStage3Browser(h.base, "", h.originalFetch, dir, { realInput: true, startupTimeoutMs: 30000 });
  // Conversion spy: every gtag call is recorded in sessionStorage (survives SPA route changes and reloads).
  await b.call("Page.addScriptToEvaluateOnNewDocument", { source: `
    window.gtag = function(){ try { const e = JSON.parse(sessionStorage.getItem('__ev')||'[]'); e.push([].slice.call(arguments).slice(0,2)); sessionStorage.setItem('__ev', JSON.stringify(e)); } catch(_) {} };
    try { localStorage.setItem('prefer_desktop','true'); } catch(_) {}` });
  await b.navigate("/");
  await b.evaluate("localStorage.setItem('libertycrm_tour_completed','true');localStorage.setItem('liberty-theme','light')");

  for (const [width, height, label] of [[1280, 900, "desktop"], [390, 900, "mobile"]] as const) {
    await b.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    for (const a of adapters) {
      const tag = `${a.name} ${label}`;
      const conv = a.name !== "Home callback"; // the callback form has never fired a conversion event; it must still fire none on non-saves

      // S1: confirmed save (201 review_required) -> success surface, receipt, one conversion.
      {
        await open(a); const id = ident()(a); await a.fill(id); await pewc(a);
        assert.equal(await events(), 0, `${tag}: no conversion before submit`);
        await scrollClick(a.submit);
        await until(a.saved, `${tag}: saved surface`);
        const rows = await rowsFor(a, id);
        assert.equal(rows.length, 1, `${tag}: exactly one request saved`);
        assert.equal(rows[0].lifecycle_state, "review_required", `${tag}: truthful class-review state`);
        assert.ok(!conv || (await events()) > 0, `${tag}: conversion fired for the confirmed save`);
        if (a.name === "Home callback") {
          assert.equal(await b.evaluate(`document.querySelector('[data-testid="callback-home-receipt"]')?.textContent`), rows[0].id, `${tag}: receipt shown and copyable`);
          assert.ok(await b.evaluate(has("callback-home-copy-receipt")), `${tag}: copy-receipt control`);
          const text = String(await b.evaluate("document.body.innerText"));
          assert.ok(!/30[- ]?minutes|within \d+ (minutes|hours)/i.test(text.split("Request Saved")[1] || ""), `${tag}: no callback deadline promised`);
        }
        await noOverflow(`${tag} saved`); await b.screenshot(`${a.name.replace(/ /g, "-")}-${label}-saved`);
        checks.push(`${tag}: 201 review_required -> success surface; one request; one conversion`);
      }

      // S2: recoverable 202 -> pending notice, no success, no conversion; same-key retry finishes the SAME request.
      {
        await open(a); const id = ident()(a); await a.fill(id); await pewc(a);
        await arm(true); await scrollClick(a.submit);
        await until(has(`${a.prefix}-notice`), `${tag}: recoverable notice`); await arm(false);
        assert.equal(await b.evaluate(`document.querySelector('${tid(a.prefix + "-notice")}').getAttribute('data-intake-phase')`), "recoverable", `${tag}: recoverable phase`);
        const rows = await rowsFor(a, id);
        assert.equal(rows.length, 1, `${tag}: one committed request behind the notice`);
        assert.equal(rows[0].terminal_reason, "INBOUND_HANDOFF_RECOVERABLE", `${tag}: server marks it recoverable`);
        assert.equal(await b.evaluate(`document.querySelector('${tid(a.prefix.replace("-intake", "") .replace("callback-home", "callback-home-intake"))}')?.textContent||document.querySelector('${tid(a.prefix + "-receipt")}')?.textContent`), rows[0].id, `${tag}: receipt displayed`);
        for (const part of ["copy-receipt", "check", "retry", "call", "book"]) assert.ok(await b.evaluate(has(`${a.prefix}-${part}`)), `${tag}: notice has ${part}`);
        assert.equal(await b.evaluate(`document.querySelector('${tid(a.prefix + "-call")}').getAttribute('href').startsWith('tel:')`), true, `${tag}: phone option`);
        assert.equal(await b.evaluate(a.saved), false, `${tag}: not shown as saved`);
        assert.equal(await events(), 0, `${tag}: no conversion on a recoverable response`);
        assert.ok(!/we'?ll call you back|within 30/i.test(String(await b.evaluate(`document.querySelector('${tid(a.prefix + "-notice")}').innerText`))), `${tag}: notice promises no callback time`);
        await noOverflow(`${tag} recoverable`); await b.screenshot(`${a.name.replace(/ /g, "-")}-${label}-recoverable`);
        await scrollClick(tid(`${a.prefix}-check`));
        await until(has(`${a.prefix}-check-note`), `${tag}: status check note`);
        assert.ok(/Still pending/.test(String(await b.evaluate(`document.querySelector('${tid(a.prefix + "-check-note")}').innerText`))), `${tag}: status check reports still pending`);
        await scrollClick(tid(`${a.prefix}-retry`));
        await until(a.saved, `${tag}: retry completes`);
        const after = await rowsFor(a, id);
        assert.deepEqual([after.length, after[0].id, after[0].lifecycle_state], [1, rows[0].id, "review_required"], `${tag}: the SAME request completed`);
        assert.equal(await dealsFor(rows[0].id), 1, `${tag}: one deal`); assert.equal(await contactsFor(a, id), 1, `${tag}: one contact`);
        assert.ok(!conv || (await events()) > 0, `${tag}: conversion only after the confirmed save`);
        checks.push(`${tag}: 202 recoverable -> truthful notice with receipt/phone/book/check/retry, no conversion; retry completes the same request without duplicates`);
      }

      // S3: truncated and lost responses -> unresolved (never success); retry replays the committed request.
      for (const mode of ["truncate", "socket"] as const) {
        await open(a); const id = ident()(a); await a.fill(id); await pewc(a);
        h.loseNextSuccessfulResponse("POST", a.api, mode);
        await scrollClick(a.submit);
        await until(`${has(`${a.prefix}-notice`)} || ${a.saved}`, `${tag}/${mode}: unresolved notice or confirmed replay`);
        const rows = await rowsFor(a, id);
        assert.equal(rows.length, 1, `${tag}/${mode}: the request really committed exactly once`);
        if (await b.evaluate(a.saved)) {
          // Chromium transparently re-sends a POST whose reused connection was reset. The SAME Idempotency-Key makes that a
          // server replay (200), which is a confirmed save; nothing was duplicated.
          assert.equal(mode, "socket", `${tag}/${mode}: only a reset connection may be resolved by the browser's own retry`);
          assert.equal(await contactsFor(a, id), 1, `${tag}/${mode}: one contact after the browser's same-key retry`);
          assert.ok(!conv || (await events()) > 0, `${tag}/${mode}: conversion after the confirmed replay`);
          checks.push(`${tag}: lost response (socket reset) -> browser re-sent the same key, server replayed (200), saved once, no duplicate`);
          continue;
        }
        assert.equal(await b.evaluate(`document.querySelector('${tid(a.prefix + "-notice")}').getAttribute('data-intake-phase')`), "unresolved", `${tag}/${mode}: unresolved phase`);
        assert.equal(await b.evaluate(a.saved), false, `${tag}/${mode}: never shown as saved`);
        assert.equal(await events(), 0, `${tag}/${mode}: no conversion for an unreadable response`);
        await scrollClick(tid(`${a.prefix}-retry`));
        await until(a.saved, `${tag}/${mode}: retry replays to a confirmed save`);
        const after = await rowsFor(a, id);
        assert.deepEqual([after.length, after[0].id], [1, rows[0].id], `${tag}/${mode}: replay returned the same request, no duplicate`);
        assert.equal(await contactsFor(a, id), 1, `${tag}/${mode}: one contact`);
        assert.ok(!conv || (await events()) > 0, `${tag}/${mode}: conversion after the confirmed replay`);
        checks.push(`${tag}: ${mode === "truncate" ? "truncated 2xx body" : "lost response"} -> unresolved notice, no conversion; Try again replays the same key (200) -> saved, no duplicate`);
      }
      assert.ok(h.responseLossCount() >= 2, "response-loss faults executed");

      // S4: reload while recoverable -> notice restored from key+receipt only; status check; re-entry finishes it.
      {
        await open(a); const id = ident()(a); await a.fill(id); await pewc(a);
        await arm(true); await scrollClick(a.submit);
        await until(has(`${a.prefix}-notice`), `${tag}: notice before reload`); await arm(false);
        const rows = await rowsFor(a, id);
        const stored = String(await b.evaluate("JSON.stringify(Object.entries(sessionStorage).filter(([k])=>k.startsWith('lb:public-intake:')))"));
        assert.ok(!stored.includes(id) && !/Recover/.test(stored), `${tag}: no submitted details persisted in storage`);
        await b.navigate(a.page);
        await until(has(`${a.prefix}-notice`), `${tag}: notice restored after reload`);
        assert.equal(await b.evaluate(`document.querySelector('${tid(a.prefix + "-receipt")}').textContent`), rows[0].id, `${tag}: same receipt after reload`);
        assert.equal(await b.evaluate(has(`${a.prefix}-retry`)), false, `${tag}: no blind retry without the details`);
        assert.equal(await events(), 0, `${tag}: reload fires no conversion`);
        await scrollClick(tid(`${a.prefix}-check`)); await until(has(`${a.prefix}-check-note`), `${tag}: status note after reload`);
        assert.ok(/Still pending/.test(String(await b.evaluate(`document.querySelector('${tid(a.prefix + "-check-note")}').innerText`))), `${tag}: status still pending after reload`);
        await a.fill(id); await pewc(a);
        await scrollClick(a.submit); await until(a.saved, `${tag}: re-entry completes the restored request`);
        const after = await rowsFor(a, id);
        assert.deepEqual([after.length, after[0].id, after[0].lifecycle_state], [1, rows[0].id, "review_required"], `${tag}: restored request completed, same receipt`);
        assert.equal(await contactsFor(a, id), 1, `${tag}: one contact after reload recovery`);
        checks.push(`${tag}: reload keeps the pending notice + receipt (no PII stored), Check status reports pending, re-entering the same details completes the same request`);
      }

      // S5: real server 400 -> rejected message, no notice, no rows, no conversion.
      if (a.name !== "Home callback") {
        await open(a); const id = ident()(a); await a.fill(id); await pewc(a);
        if (a.name === "Estimate") await setv(tid("input-monthly-volume"), "9".repeat(45));
        else await setv(tid("input-email"), "not-an-email");
        const before = (await q("SELECT count(*)::int n FROM inbound_requests"))[0].n;
        await scrollClick(a.submit);
        await until(`/check your details|could not be matched|try again/i.test(document.body.innerText)`, `${tag}: rejection message`);
        assert.equal(await b.evaluate(has(`${a.prefix}-notice`)), false, `${tag}: a real 400 is not a recoverable notice`);
        assert.equal(await b.evaluate(a.saved), false, `${tag}: 400 is not success`);
        assert.equal(await events(), 0, `${tag}: no conversion on 400`);
        assert.equal((await q("SELECT count(*)::int n FROM contacts WHERE lower(email)=lower($1)", [id]))[0].n, 0, `${tag}: nothing created`);
        assert.ok((await q("SELECT count(*)::int n FROM inbound_requests"))[0].n >= before, `${tag}: request rows never deleted`);
        checks.push(`${tag}: real server 400 -> rejection message, no pending notice, no conversion, no contact created`);
      }
    }
  }

  assert.equal(b.exceptions.length, 0, `browser exceptions: ${JSON.stringify(b.exceptions)}`);
  const denied = h.externalCalls(); // Get Started's fire-and-forget deal-blueprint step attempts a provider; the fixture refuses every attempt.
  assert.ok(denied <= 100, `provider attempts stay bounded (${denied}), all refused by the fixture`);
  await writeFile(`${dir}/receipt.json`, JSON.stringify({ status: "passed", identity, fixture: h.prefix, checks, requests: b.requests.length, exceptions: b.exceptions, providerAttemptsRefusedByFixture: denied, providerCallsCompleted: 0,
    notExercised: ["ContactBubble (not mounted by any route)", "HelpCenter callback panel (authenticated dashboard widget)", "browser-driven 201 accepted (public submissions begin as class review)", "Home callback server 400 (the callback handler has no server validation)"],
    qualification: "Focused fixture-level browser evidence for Estimate, Get Started and Home callback at 1280 and 390 px. Not production, native or release acceptance." }, null, 2));
  console.log(`Stage 5 intake browser PASS (${checks.length} scenario groups)`);
} catch (error) {
  await b?.screenshot("failure");
  await writeFile(`${dir}/failed-receipt.json`, JSON.stringify({ status: "failed", identity, error: String(error), checks, exceptions: b?.exceptions }, null, 2));
  throw error;
} finally { await b?.close(); await h.close(); }
