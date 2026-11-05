import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import { stage3BHttpFixture } from "./fixtures/stage3-b-http";
import { privateStage3Browser } from "./fixtures/private-stage3-browser";
import { verifyCandidateIdentity } from "./fixtures/candidate-build-identity";

// Stage 5 focused browser journeys (rebuilt candidate, real persisted admin/manager sessions, private Chromium, no external egress):
//  - Underwriting: KPI cards == queue badge (one cohort), paging past 50 rows, override journey with real pointer input,
//    1280/768/390 and light/dark without horizontal overflow.
//  - MID registry (admin): masked MIDs, multi-MID count, status filter, Close MID dialog; agent/merchant/partner denials.
//  - BoardingPanel (admin) on the contact Deals tab: blockers, disabled submit, one queued outbox row.
//  - Public application wizard: missing-field guidance, full six-step submission accepted by the real finalize route.
//  - Merchant Applications: list renders from the SQL read model; the detail view shows e-sign state and the scoped document reader state.
// Qualification: focused fixture-level browser evidence; not production/native/release acceptance. Operator edit/conflict UI, conditions UI and manager role are covered at the handler layer.
const identity = await verifyCandidateIdentity();
const dir = "docs/certification/stage5/browser";
process.env.MERCHANT_DATA_ENCRYPTION_KEY ||= crypto.randomBytes(32).toString("hex");
const h = await stage3BHttpFixture(async app => {
  const { registerUnderwritingRoutes } = await import("../server/routes/underwriting");
  const { registerMerchantsRoutes } = await import("../server/routes/merchants");
  const { registerBoardingRoutes } = await import("../server/routes/boarding");
  const { registerAdminRoutes } = await import("../server/routes/admin");
  registerUnderwritingRoutes(app);
  registerMerchantsRoutes(app);
  registerBoardingRoutes(app);
  const { registerCrmOperationsRoutes } = await import("../server/routes/crm-operations");
  registerCrmOperationsRoutes(app);
  registerAdminRoutes(app);
  app.get("/api/boarding/enabled-processors", (_req, res) => res.json({ processors: [] }));
  app.use("/api", (req, res, next) => {
    if (req.path.startsWith("/merchant-documents/contact/")) return res.json([]);
    next();
  });
  app.use("/api", (_req, res) => res.status(501).json({ message: "Unregistered isolated service" }));
  const { static: serveStatic } = await import("express");
  app.use(serveStatic("dist/public"));
  app.use((_req, res) => res.sendFile("index.html", { root: `${process.cwd()}/dist/public` }));
}, undefined, { backgroundProfile: "off" });
let b: Awaited<ReturnType<typeof privateStage3Browser>> | undefined;
const checks: string[] = [];
const until = async (expr: string, label = expr) => {
  for (let n = 0; n < 400; n++) { if (await b!.evaluate(expr)) return; await new Promise(r => setTimeout(r, 50)); }
  throw new Error(`UI condition not reached: ${label}`);
};
const num = (id: string) => b!.evaluate(`Number((document.querySelector('[data-testid="${id}"]')?.textContent||'').replace(/[^0-9]/g,''))`) as Promise<number>;
const noOverflow = async (label: string) => {
  const o = await b!.evaluate("({sw:document.documentElement.scrollWidth,iw:innerWidth})") as { sw: number; iw: number };
  assert.ok(o.sw <= o.iw + 1, `${label}: horizontal overflow ${o.sw}>${o.iw}`);
};
try {
  await mkdir(dir, { recursive: true });
  const tag = h.prefix.slice(-8);
  const deals = (await h.pool.query(`INSERT INTO deals (pipeline,stage,name) SELECT 'sales','Review In Progress',$1||g FROM generate_series(1,123) g RETURNING id`, [`S5BR ${tag} `])).rows.map((r: any) => r.id);
  for (let i = 0; i < deals.length; i++) await h.pool.query(`INSERT INTO underwriting_decisions (deal_id,decision,score,created_at) VALUES ($1,$2,$3,now() - ($4||' seconds')::interval)`, [deals[i], i < 3 ? "hold" : "review", 20, i]);
  await h.pool.query("UPDATE users SET tour_completed_at=NOW() WHERE id LIKE $1", [h.prefix + "%"]);
  b = await privateStage3Browser(h.base, "", h.originalFetch, dir, { realInput: true, startupTimeoutMs: 30000 });
  await b.navigate("/login"); await b.waitFor(/Sign In/);
  await b.set('[data-testid="input-email"]', h.email("admin")); await b.set('[data-testid="input-password"]', h.password);
  await b.click('[data-testid="button-login"]'); await b.waitFor(/Dashboard|Today|My Day/);
  await b.evaluate("localStorage.setItem('liberty_setup_notice_hidden','true');localStorage.setItem('libertycrm_tour_completed','true');localStorage.setItem('prefer_desktop','true');localStorage.setItem('liberty-theme','light')");

  for (const [w, hgt, theme] of [[1280, 900, "light"], [768, 900, "dark"], [390, 900, "light"], [1280, 900, "dark"]] as const) {
    await b.evaluate(`localStorage.setItem('liberty-theme','${theme}')`);
    await b.call("Emulation.setDeviceMetricsOverride", { width: w, height: hgt, deviceScaleFactor: 1, mobile: false });
    await b.navigate("/dashboard/underwriting");
    await until(`!!document.querySelector('[data-testid="badge-queue-total"]')`, "queue badge");
    await until(`/Page 1 of/.test(document.body.innerText)`, "pager");
    assert.equal(await b.evaluate("document.documentElement.classList.contains('dark')"), theme === "dark", `theme ${theme} applied`);
    const total = await num("badge-queue-total");
    assert.ok(total >= 123, `badge shows the uncapped total (${total})`);
    assert.equal(await num("text-pending-review") + await num("text-pending-hold"), total, "KPI review+hold equals the queue badge (one cohort)");
    await noOverflow(`underwriting ${w}/${theme}`);
    await b.screenshot(`underwriting-${w}-${theme}`);
    checks.push(`Underwriting ${w}px ${theme}: badge=${total} == KPI review+hold; pager present; no horizontal overflow`);
  }

  await b.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await b.evaluate("localStorage.setItem('liberty-theme','light')");
  await b.navigate("/dashboard/underwriting");
  await until(`/Page 1 of/.test(document.body.innerText)`);
  const total0 = await num("badge-queue-total");
  await b.evaluate(`document.querySelector('[data-testid="pager-queue-next"]').scrollIntoView({block:'center'})`);
  await new Promise(r => setTimeout(r, 400));
  await b.click('[data-testid="pager-queue-next"]');
  await until(`/Page 2 of/.test(document.body.innerText)`, "page 2");
  const ids2 = await b.evaluate(`[...document.querySelectorAll('[data-testid^="card-queue-"]')].map(e=>e.getAttribute('data-testid'))`) as string[];
  await b.evaluate(`document.querySelector('[data-testid="pager-queue-prev"]').scrollIntoView({block:'center'})`);
  await new Promise(r => setTimeout(r, 400));
  await b.click('[data-testid="pager-queue-prev"]');
  await until(`/Page 1 of/.test(document.body.innerText)`);
  const ids1 = await b.evaluate(`[...document.querySelectorAll('[data-testid^="card-queue-"]')].map(e=>e.getAttribute('data-testid'))`) as string[];
  assert.ok(ids1.length > 0 && ids2.length > 0 && !ids2.some(i => ids1.includes(i)), "page 1 and page 2 show different deals");
  checks.push(`Paging: page 1 (${ids1.length}) and page 2 (${ids2.length}) are disjoint`);

  // Override journey with real pointer input.
  const first = ids1[0].replace("card-queue-", "");
  await b.evaluate(`document.querySelector('[data-testid="button-approve-${first}"]').scrollIntoView({block:'center'})`);
  await new Promise(r => setTimeout(r, 400));
  await b.click(`[data-testid="button-approve-${first}"]`);
  await until(`!!document.querySelector('[data-testid="button-override-confirm"]')`, "dialog");
  await new Promise(r => setTimeout(r, 500));
  await b.set('[data-testid="input-override-note"]', "browser journey");
  await b.click('[data-testid="button-override-confirm"]');
  await until(`Number((document.querySelector('[data-testid="badge-queue-total"]')?.textContent||'').replace(/[^0-9]/g,''))===${total0 - 1}`, "badge decrements");
  assert.equal(await num("text-pending-review") + await num("text-pending-hold"), total0 - 1, "KPI and badge both drop after the override");
  await b.screenshot("underwriting-after-override");
  checks.push(`Approve override: badge and KPI both ${total0} -> ${total0 - 1}`);

  // Merchant Applications (admin).
  const appId = (await h.pool.query(`INSERT INTO merchant_applications (status, legal_business_name, owner_first_name, owner_last_name, owner_email, business_email)
    VALUES ('submitted',$1,'Fixie','Tester',$2,$2) RETURNING id`, [`S5BR ${tag} Bistro`, `s5br-${tag}@example.test`])).rows[0].id;
  for (const [w, theme] of [[1280, "light"], [768, "dark"], [390, "light"]] as const) {
    await b.evaluate(`localStorage.setItem('liberty-theme','${theme}')`);
    await b.call("Emulation.setDeviceMetricsOverride", { width: w, height: 900, deviceScaleFactor: 1, mobile: false });
    await b.navigate("/dashboard/merchant-applications");
    await until(`document.body.innerText.includes('S5BR ${tag} Bistro')`, "application row");
    await noOverflow(`applications ${w}/${theme}`);
    await b.screenshot(`applications-${w}-${theme}`);
    checks.push(`Merchant Applications ${w}px ${theme}: list renders from the read model; no horizontal overflow`);
  }
  await b.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await b.evaluate("localStorage.setItem('liberty-theme','light')");
  await b.navigate("/dashboard/merchant-applications");
  await until(`document.body.innerText.includes('S5BR ${tag} Bistro')`);
  await b.evaluate(`(()=>{const r=[...document.querySelectorAll('tr')].find(t=>t.innerText.includes('S5BR ${tag} Bistro'));r.click();return true})()`);
  await until(`!!document.querySelector('[data-testid="application-detail-view"]')`, "detail view");
  await until(`!!document.querySelector('[data-testid="text-esign-state"]')||!!document.querySelector('[data-testid="button-send-esign"]')`, "e-sign controls");
  const detail = await b.evaluate("document.body.innerText") as string;
  assert.ok(!/notified the merchant|merchant has been notified/i.test(detail), "no unverified notification claim");
  await b.screenshot("application-detail");
  checks.push(`Application detail (id ${appId}): e-sign controls and scoped document state render`);


  // ── Boarding: MID registry (admin) ─────────────────────────────────────────
  const regTag = tag.replace(/[^a-z0-9]/gi, "");
  const mkRegDeal = async (label: string, stage: string, mids: string[]) => {
    const c = (await h.pool.query(`INSERT INTO contacts (first_name,last_name,email,phone,company_name) VALUES ('Reg',$1,$2,$3,$4) RETURNING id`,
      [label, `s5br-reg-${regTag}-${label}@example.test`, `+1305555${crypto.randomInt(1000, 9999)}`, `S5BR ${tag} Reg${label}`])).rows[0].id;
    const d = (await h.pool.query(`INSERT INTO deals (pipeline,stage,name,contact_id,mid) VALUES ('onboarding',$1,$2,$3,$4) RETURNING id`,
      [stage, `S5BR ${tag} reg-${label}`, c, mids[0] ?? null])).rows[0].id;
    for (const m of mids) await h.pool.query(`INSERT INTO merchant_mids (contact_id,deal_id,mid,status) VALUES ($1,$2,$3,'assigned')`, [c, d, m]);
    return d as number;
  };
  const rnd = () => String(crypto.randomInt(10 ** 9, 10 ** 10 - 1)) + String(crypto.randomInt(1000, 9999));
  const liveMids = [rnd(), rnd()], schedMid = rnd(), assignedMid = rnd();
  const dLive = await mkRegDeal("Live", "Live", liveMids);
  const dSched = await mkRegDeal("Sched", "Go-Live Scheduled", [schedMid]);
  const dAssigned = await mkRegDeal("Assigned", "Approved", [assignedMid]);
  const dPending = await mkRegDeal("Pending", "Underwriting", []);
  const allMids = [...liveMids, schedMid, assignedMid];
  const masked = (m: string) => "*".repeat(m.length - 4) + m.slice(-4);
  const dealText = (id: number, kind: string) => b!.evaluate(`document.querySelector('[data-testid="text-reg-${kind}-${id}"]')?.textContent||''`) as Promise<string>;
  for (const [w, theme] of [[1280, "light"], [768, "dark"], [390, "light"]] as const) {
    await b.evaluate(`localStorage.setItem('liberty-theme','${theme}')`);
    await b.call("Emulation.setDeviceMetricsOverride", { width: w, height: 900, deviceScaleFactor: 1, mobile: false });
    await b.navigate("/dashboard/boarding?view=mid-registry");
    await until(`!!document.querySelector('[data-testid="view-mid-registry"]') && document.body.innerText.includes('S5BR ${tag} RegLive')`, "registry rows");
    const bodyText = await b.evaluate("document.body.innerText") as string;
    for (const m of allMids) assert.ok(!bodyText.includes(m), `registry ${w}/${theme} never shows a full MID`);
    assert.ok(bodyText.includes(masked(liveMids[0])) || bodyText.includes(masked(liveMids[1])), "registry shows a masked MID for the multi-MID deal");
    await noOverflow(`registry ${w}/${theme}`);
    await b.screenshot(`mid-registry-${w}-${theme}`);
    checks.push(`MID registry ${w}px ${theme}: rows render, MIDs masked, no horizontal overflow`);
  }
  await b.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await b.evaluate("localStorage.setItem('liberty-theme','light')");
  await b.navigate("/dashboard/boarding?view=mid-registry");
  await until(`!!document.querySelector('[data-testid="text-reg-mid-${dLive}"]')`, "live row");
  assert.equal((await dealText(dLive, "count")).trim(), "2", "a deal with two open MIDs reports mid_count 2 (one row per deal)");
  assert.ok([masked(liveMids[0]), masked(liveMids[1])].includes((await dealText(dLive, "mid")).trim()), "the primary MID is masked");
  await b.click('[data-testid="filter-mid-scheduled"]');
  await until(`!!document.querySelector('[data-testid="text-reg-mid-${dSched}"]') && !document.querySelector('[data-testid="text-reg-mid-${dLive}"]')`, "scheduled filter");
  assert.equal((await dealText(dSched, "mid")).trim(), masked(schedMid));
  assert.match(await b.evaluate(`document.querySelector('[data-testid="text-mid-registry-scope"]')?.textContent||''`) as string, /deal/i, "scope text states the unit");
  checks.push("MID registry: multi-MID row count, status filter, masked values, deals-unit scope text");
  // Close a MID through the real dialog (admin).
  await b.evaluate(`document.querySelector('[data-testid="button-close-mid-${dSched}"]').scrollIntoView({block:'center'})`);
  await new Promise(r => setTimeout(r, 400));
  await b.click(`[data-testid="button-close-mid-${dSched}"]`);
  await until(`!!document.querySelector('[data-testid="dialog-close-mid"]')`, "close dialog");
  await new Promise(r => setTimeout(r, 500));
  await b.screenshot("mid-registry-close-dialog");
  await b.click('[data-testid="button-close-mid-confirm"]');
  await until(`(document.querySelector('[data-testid="text-reg-mid-${dSched}"]')?.textContent||'').trim()==='—'`, "closed MID leaves the registry row");
  const closedRow = (await h.pool.query(`SELECT status, closed_at FROM merchant_mids WHERE mid=$1`, [schedMid])).rows[0];
  const aliasRow = (await h.pool.query(`SELECT mid FROM deals WHERE id=$1`, [dSched])).rows[0];
  assert.ok(closedRow.status === "closed" && closedRow.closed_at && !aliasRow.mid, "the closed MID is history and the deal alias is cleared");
  checks.push("MID registry: Close MID dialog closes the MID, clears the alias and the row shows no MID");

  // Role denials (admin/manager only), separate real sessions.
  const roleSession = async (role: string) => {
    const rb = await privateStage3Browser(h.base, "", h.originalFetch, dir, { realInput: true, startupTimeoutMs: 30000 });
    await rb.navigate("/login"); await rb.waitFor(/Sign In/);
    await rb.set('[data-testid="input-email"]', h.email(role)); await rb.set('[data-testid="input-password"]', h.password);
    await rb.click('[data-testid="button-login"]');
    for (let n = 0; n < 200; n++) { if (await rb.evaluate("location.pathname !== '/login'")) break; await new Promise(r => setTimeout(r, 100)); }
    await rb.evaluate("localStorage.setItem('liberty_setup_notice_hidden','true');localStorage.setItem('libertycrm_tour_completed','true');localStorage.setItem('prefer_desktop','true')");
    return rb;
  };
  const rbUntil = async (rb: Awaited<ReturnType<typeof privateStage3Browser>>, expr: string, label: string) => {
    for (let n = 0; n < 160; n++) { if (await rb.evaluate(expr)) return; await new Promise(r => setTimeout(r, 50)); }
    throw new Error(`UI condition not reached: ${label}`);
  };
  {
    const rb = await roleSession("agent");
    try {
      await rb.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
      await rb.navigate("/dashboard/boarding?view=mid-registry");
      await rbUntil(rb, `document.body.innerText.includes('MID registry unavailable') || location.pathname !== '/dashboard/boarding'`, "agent denied/redirected");
      const t = await rb.evaluate("document.body.innerText") as string;
      for (const m of allMids) assert.ok(!t.includes(m) && !t.includes(masked(m)), "agent never sees any MID value");
      assert.ok(!(await rb.evaluate(`!!document.querySelector('[data-testid^="button-close-mid-"]')`)), "agent has no Close MID action");
      assert.ok(!/Total unavailable.*\b0 deals\b/.test(t), "denied state does not render a zero total");
      await rb.screenshot("mid-registry-agent");
      checks.push("MID registry: agent sees a named unavailable/denied state (or is redirected), no MID values, no Close action");
    } finally { await rb.close(); }
  }
  for (const role of ["merchant", "partner"] as const) {
    const rb = await roleSession(role);
    try {
      await rb.navigate("/dashboard/boarding?view=mid-registry");
      await new Promise(r => setTimeout(r, 1500));
      const t = await rb.evaluate("document.body.innerText") as string;
      assert.ok(!(await rb.evaluate(`!!document.querySelector('[data-testid="view-mid-registry"]')`)), `${role} cannot mount the registry`);
      for (const m of allMids) assert.ok(!t.includes(m) && !t.includes(masked(m)), `${role} never sees a MID`);
      checks.push(`MID registry: ${role} cannot mount the registry or see MID values`);
    } finally { await rb.close(); }
  }


  // ── BoardingPanel (admin) on the real contact Deals tab ───────────────────
  {
    const { sql } = await import("drizzle-orm");
    const { recordCertPolicy, CERT_PROGRAM } = await import("./certification/stage5-boarding-fixture");
    await recordCertPolicy(h.db, sql);
    const mkPanelDeal = async (label: string, complete: boolean) => {
      const c = (await h.pool.query(`INSERT INTO contacts (first_name,last_name,email,phone,company_name) VALUES ('Panel',$1,$2,$3,$4) RETURNING id`,
        [label, `s5br-panel-${regTag}-${label}@example.test`, `+1305556${crypto.randomInt(1000, 9999)}`, `S5BR ${tag} Panel${label}`])).rows[0].id;
      const d = (await h.pool.query(`INSERT INTO deals (pipeline,stage,name,contact_id) VALUES ('onboarding','Underwriting',$1,$2) RETURNING id`, [`S5BR ${tag} panel-${label}`, c])).rows[0].id;
      if (complete) {
        await h.pool.query(`INSERT INTO merchant_applications (deal_id,contact_id,legal_business_name,business_address,business_city,business_state,business_zip,owner_first_name,owner_last_name,ein,owner_ssn,owner_dob,bank_routing_number,bank_account_number,status,preferred_program)
          VALUES ($1,$2,$3,'1 Fixture Way','Miami','FL','33101','Fixie','Tester','enc','enc','enc','enc','enc','submitted',$4)`, [d, c, `S5BR ${tag} Panel${label}`, CERT_PROGRAM]);
      } else {
        await h.pool.query(`INSERT INTO merchant_applications (deal_id,contact_id,legal_business_name,status) VALUES ($1,$2,$3,'submitted')`, [d, c, `S5BR ${tag} Panel${label}`]);
      }
      return { c: c as number, d: d as number };
    };
    const ready = await mkPanelDeal("Ready", true), notReady = await mkPanelDeal("NotReady", false);
    for (const [w, theme] of [[1280, "light"], [390, "dark"]] as const) {
      await b.evaluate(`localStorage.setItem('liberty-theme','${theme}')`);
      await b.call("Emulation.setDeviceMetricsOverride", { width: w, height: 900, deviceScaleFactor: 1, mobile: false });
      await b.navigate(`/dashboard/contacts/${notReady.c}?section=deals`);
      await until(`!!document.querySelector('[data-testid="boarding-panel"]')`, "boarding panel (not ready)");
      await until(`!!document.querySelector('[data-testid="boarding-blockers"]')`, "blocker list");
      assert.ok(await b.evaluate(`document.querySelector('[data-testid="button-submit-to-processor"]')?.disabled===true`), "submit is disabled while readiness blockers exist");
      await noOverflow(`boarding panel not-ready ${w}/${theme}`);
      await b.screenshot(`boarding-panel-notready-${w}-${theme}`);
      checks.push(`BoardingPanel ${w}px ${theme}: readiness blockers listed, submit disabled, no horizontal overflow`);
    }
    await b.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await b.evaluate("localStorage.setItem('liberty-theme','light')");
    await b.navigate(`/dashboard/contacts/${ready.c}?section=deals`);
    await until(`!!document.querySelector('[data-testid="boarding-panel"]')`, "boarding panel (ready)");
    await until(`document.querySelector('[data-testid="button-submit-to-processor"]')?.disabled===false`, "submit enabled when ready");
    await b.evaluate(`document.querySelector('[data-testid="button-submit-to-processor"]').scrollIntoView({block:'center'})`);
    await new Promise(r => setTimeout(r, 400));
    await b.click('[data-testid="button-submit-to-processor"]');
    await until(`/Queued/.test(document.querySelector('[data-testid="badge-boarding-status"]')?.textContent||'')`, "queued badge");
    const outbox = (await h.pool.query(`SELECT count(*)::int n FROM deal_boarding_outbox WHERE deal_id=$1`, [ready.d])).rows[0].n;
    assert.equal(outbox, 1, "exactly one durable outbox row from one click");
    assert.ok(!/Status: undefined/.test(await b.evaluate("document.body.innerText") as string) && !(await b.evaluate(`!!document.querySelector('[data-testid="text-processor-app-id"]')`)), "no fabricated application id or undefined status");
    await b.screenshot("boarding-panel-queued");
    checks.push("BoardingPanel: ready deal submits through the real route; one outbox row; panel shows Queued (nothing sent)");
  }

  // ── Public application wizard (anonymous) ─────────────────────────────────
  {
    const fill = async (id: string, v: string) => { await b!.set(`[data-testid="${id}"]`, v); };
    const pick = async (id: string) => {
      await b!.evaluate(`document.querySelector('[data-testid="${id}"]').scrollIntoView({block:'center'})`);
      await new Promise(r => setTimeout(r, 250));
      await b!.click(`[data-testid="${id}"]`);
      await until(`!!document.querySelector('[role="option"]')`, `options for ${id}`);
      await b!.click('[role="option"]');
      await new Promise(r => setTimeout(r, 250));
    };
    const next = async () => { await b!.evaluate(`document.querySelector('[data-testid="button-next"]').scrollIntoView({block:'center'})`); await new Promise(r => setTimeout(r, 250)); await b!.click('[data-testid="button-next"]'); await new Promise(r => setTimeout(r, 400)); };
    await b.evaluate("localStorage.clear();localStorage.setItem('prefer_desktop','true')");
    // Record non-OK application responses so a failed journey names the server's reason.
    const installFailureRecorder = `(()=>{if(window.__s5Failures)return;window.__s5Failures=[];const f=window.fetch;window.fetch=async(...a)=>{const r=await f(...a);try{const u=String(a[0]?.url||a[0]);if(!r.ok&&u.includes('merchant-applications'))r.clone().text().then(t=>window.__s5Failures.push(u.split('?')[0]+' '+r.status+' '+t.slice(0,300)));}catch{}return r;};})()`;
    // Missing-fields guidance at a phone width, dark.
    await b.evaluate("localStorage.setItem('liberty-theme','dark')");
    await b.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 900, deviceScaleFactor: 1, mobile: false });
    await b.navigate("/merchant-application");
    await until(`!!document.querySelector('[data-testid="input-legal-business-name"]')`, "wizard step 1");
    await until(`!!document.querySelector('[data-testid="text-step-missing"]')`, "missing-fields guidance");
    assert.ok(await b.evaluate(`document.querySelector('[data-testid="button-next"]').disabled===true`), "Next is disabled with required fields missing");
    await b.click('[data-testid="button-focus-first-missing"]');
    await until(`document.activeElement && document.activeElement.id==='app-input-legal-business-name'`, "focus moved to the first missing field");
    await noOverflow("public wizard 390/dark");
    await b.screenshot("public-wizard-390-dark");
    checks.push("Public wizard 390px dark: missing-field guidance announced, Next disabled, 'Go to' focuses the first missing field, no horizontal overflow");
    // Full journey at desktop light with real pointer/keyboard input.
    await b.evaluate("localStorage.setItem('liberty-theme','light')");
    await b.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await b.navigate("/merchant-application");
    await until(`!!document.querySelector('[data-testid="input-legal-business-name"]')`, "wizard step 1 desktop");
    await b.evaluate(installFailureRecorder);
    const legal = `S5BR ${tag} Wizard Co`;
    await fill("input-legal-business-name", legal); await pick("select-business-type");
    await fill("input-ein", `${crypto.randomInt(10, 99)}-${crypto.randomInt(1000000, 9999999)}`);
    await fill("input-business-address", "1 Wizard Way"); await fill("input-business-city", "Miami"); await fill("input-business-state", "FL"); await fill("input-business-zip", "33101");
    await fill("input-business-phone", "3055550123"); await fill("input-business-email", `s5br-wiz-${regTag}@example.test`); await pick("select-vertical");
    await next();
    await until(`!!document.querySelector('[data-testid="input-owner-first-name"]')`, "step 2");
    await fill("input-owner-first-name", "Wanda"); await fill("input-owner-last-name", "Wizard"); await fill("input-owner-email", `s5br-wiz-o-${regTag}@example.test`);
    await fill("input-owner-phone", "3055550124"); await fill("input-owner-dob", "1980-01-02"); await fill("input-owner-ssn", "123-45-6789");
    await fill("input-owner-address", "2 Wizard Way"); await fill("input-owner-city", "Miami"); await fill("input-owner-state", "FL"); await fill("input-owner-zip", "33101"); await fill("input-ownership-percent", "100");
    await next();
    await until(`!!document.querySelector('[data-testid="input-bank-name"]')`, "step 3");
    await fill("input-bank-name", "Fixture Bank"); await fill("input-routing-number", "021000021"); await fill("input-account-number", "123456789"); await pick("select-account-type");
    await next();
    await until(`!!document.querySelector('[data-testid="input-monthly-volume"]')`, "step 4");
    await fill("input-monthly-volume", "50000"); await fill("input-avg-ticket", "50"); await fill("input-highest-ticket", "500");
    await b.click('[data-testid="checkbox-card-type-visa"]');
    await next();
    await until(`!!document.querySelector('[data-testid="button-terminal-no"]')`, "step 5");
    await b.click('[data-testid="button-terminal-no"]'); await b.click('[data-testid="button-ecommerce-no"]'); await pick("select-preferred-program");
    await next();
    await until(`!!document.querySelector('[data-testid="step-review-submit"]')`, "review step");
    assert.ok(await b.evaluate(`document.querySelector('[data-testid="button-submit-application"]').disabled===true`), "Submit is disabled until the review is confirmed");
    await b.evaluate(`document.querySelector('[data-testid="checkbox-review-confirm"]').scrollIntoView({block:'center'})`);
    await new Promise(r => setTimeout(r, 300));
    await b.click('[data-testid="checkbox-review-confirm"]');
    await until(`document.querySelector('[data-testid="button-submit-application"]').disabled===false`, "Submit enabled after confirming");
    await b.screenshot("public-wizard-review");
    await b.click('[data-testid="button-submit-application"]');
    try { await until(`!!document.querySelector('[data-testid="text-thanks-application-id"]')`, "confirmation page"); }
    catch (e) {
      const toast = await b.evaluate(`[...document.querySelectorAll('[role="alert"],[role="status"],li[data-state],[data-radix-toast-announce-exclude]')].map(x=>x.innerText).join(' | ')`);
      const calls = b.requests.filter(r => r.url.includes("merchant-applications")).slice(-8).map(r => `${r.method} ${r.url} -> ${r.status ?? r.failed}`);
      const rows = (await h.pool.query(`SELECT id,status FROM merchant_applications WHERE legal_business_name=$1`, [legal])).rows;
      const failures = await b.evaluate("window.__s5Failures||[]");
      throw new Error(`${String(e)}; server responses: ${JSON.stringify(failures)}; visible status text: ${JSON.stringify(toast)}; requests: ${JSON.stringify(calls)}; rows: ${JSON.stringify(rows)}`);
    }
    assert.deepEqual(await b.evaluate("window.__s5Failures||[]"), [], "no application request failed during the journey (autosave included)");
    const saved = (await h.pool.query(`SELECT id,status,ein,owner_ssn FROM merchant_applications WHERE legal_business_name=$1`, [legal])).rows;
    assert.equal(saved.length, 1, "one saved application");
    assert.equal(saved[0].status, "submitted", "the real wizard payload was accepted by the real finalize route");
    assert.ok(saved[0].ein && !String(saved[0].ein).includes("-") && !/^\d{9}$/.test(String(saved[0].ein)) && !String(saved[0].owner_ssn).includes("123456789"), "EIN and SSN are stored protected");
    assert.ok(((await b.evaluate(`document.querySelector('[data-testid="text-thanks-application-id"]')?.textContent||''`)) as string).includes(String(saved[0].id)), "the confirmation page shows the saved application's reference");
    await b.screenshot("public-wizard-success");
    checks.push("Public wizard 1280px light: six steps with real input, review confirmation gates Submit, finalize accepted (status submitted, protected values stored encrypted), success page shown");
  }

  assert.equal(b.exceptions.length, 0, `browser exceptions: ${JSON.stringify(b.exceptions)}`);
  assert.equal(h.externalCalls(), 0);
  await writeFile(`${dir}/receipt.json`, JSON.stringify({ status: "passed", identity, fixture: h.prefix, checks, requests: b.requests.length, exceptions: b.exceptions, externalEgress: 0,
    qualification: "Focused Stage 5 admin journeys on a disposable fixture. Not native, production or release acceptance." }, null, 2));
  console.log(`Stage 5 browser journeys PASS (${checks.length} checks)`);
} catch (error) {
  await b?.screenshot("failure");
  await writeFile(`${dir}/failed-receipt.json`, JSON.stringify({ status: "failed", identity, error: String(error), checks, exceptions: b?.exceptions }, null, 2));
  throw error;
} finally { await b?.close(); await h.close(); }
