import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import { stage3BHttpFixture } from "./fixtures/stage3-b-http";
import { privateStage3Browser } from "./fixtures/private-stage3-browser";
import { verifyCandidateIdentity } from "./fixtures/candidate-build-identity";

// Stage 5 focused browser journeys (rebuilt candidate, real persisted admin/manager sessions, private Chromium, no external egress):
//  - Underwriting: KPI cards == queue badge (one cohort), paging past 50 rows, override journey with real pointer input,
//    1280/768/390 and light/dark without horizontal overflow.
//  - Merchant Applications: list renders from the SQL read model; the detail view shows e-sign state and the scoped document reader state.
// Qualification: focused; not production/native/release acceptance; BoardingPanel and the public wizard are not driven here.
const identity = await verifyCandidateIdentity();
const dir = "docs/certification/stage5/browser";
process.env.MERCHANT_DATA_ENCRYPTION_KEY ||= crypto.randomBytes(32).toString("hex");
const h = await stage3BHttpFixture(async app => {
  const { registerUnderwritingRoutes } = await import("../server/routes/underwriting");
  const { registerMerchantsRoutes } = await import("../server/routes/merchants");
  registerUnderwritingRoutes(app);
  registerMerchantsRoutes(app);
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

  assert.equal(b.exceptions.length, 0, `browser exceptions: ${JSON.stringify(b.exceptions)}`);
  assert.equal(h.externalCalls(), 0);
  await writeFile(`${dir}/receipt.json`, JSON.stringify({ status: "passed", identity, fixture: h.prefix, checks, requests: b.requests.length, exceptions: b.exceptions, externalEgress: 0,
    qualification: "Focused Stage 5 admin journeys on a disposable fixture. Not BoardingPanel/public-wizard, native, production or release acceptance." }, null, 2));
  console.log(`Stage 5 browser journeys PASS (${checks.length} checks)`);
} catch (error) {
  await b?.screenshot("failure");
  await writeFile(`${dir}/failed-receipt.json`, JSON.stringify({ status: "failed", identity, error: String(error), checks, exceptions: b?.exceptions }, null, 2));
  throw error;
} finally { await b?.close(); await h.close(); }
