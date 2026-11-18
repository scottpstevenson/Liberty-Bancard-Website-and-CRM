/** Compiled CRM, real persisted sessions and local Chromium; providers denied by the shared owned fixture. */
import { generateKeyPairSync, sign } from "node:crypto";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import { stage3BHttpFixture } from "./fixtures/stage3-b-http";
import { privateStage3Browser } from "./fixtures/private-stage3-browser";
import { verifyCandidateIdentity } from "./fixtures/candidate-build-identity";
import { funnelResponseSchema } from "../shared/conversion-funnel";
const identity = await verifyCandidateIdentity();
const root = path.resolve("dist/public");
const h = await stage3BHttpFixture(
  async (app) => {
    const { registerAnalyticsRoutes } =
      await import("../server/routes/analytics");
    registerAnalyticsRoutes(app);
    const { registerCro07Routes } = await import("../server/routes/cro07");
    registerCro07Routes(app);
    const { registerCampaignsRoutes } =
      await import("../server/routes/campaigns");
    registerCampaignsRoutes(app);
    app.use("/api", (_req, res) =>
      res.status(501).json({
        message:
          "Unrelated source is not registered in this isolated Phase 7 fixture",
      }),
    );
    const { static: serveStatic } = await import("express");
    app.use(serveStatic(root));
    app.use((_req, res) => res.sendFile("index.html", { root }));
  },
  undefined,
  { backgroundProfile: "off" },
);
const results: any[] = [];
let checks = 0;
const ok = (v: unknown, s: string) => {
  assert.ok(v, s);
  checks++;
  console.log("✓ " + s);
};
let browser: Awaited<ReturnType<typeof privateStage3Browser>> | undefined;
try {
  const schemaStatus = await h.request(
    "admin",
    "GET",
    "/api/admin/cro07/phase7/schema",
  );
  ok(
    schemaStatus.status === 200 && schemaStatus.body.schemaVerified,
    "actual schema read verifies native guards and additive columns without writing",
  );
  const copyInventory = await h.request(
    "admin",
    "GET",
    "/api/admin/cro07/phase7/inventory",
  );
  ok(
    copyInventory.status === 200 &&
      copyInventory.body.complete &&
      Array.isArray(copyInventory.body.rows),
    "installed-copy read covers sequence, campaign, template and workflow owners",
  );
  ok(
    (await h.request("manager", "GET", "/api/admin/cro07/phase7/inventory"))
      .status === 403,
    "full installed-copy audit remains admin scoped",
  );
  const feedbackStatus = await h.request(
    "admin",
    "GET",
    "/api/admin/cro07/phase7/feedback-status",
  );
  ok(
    feedbackStatus.status === 200 && feedbackStatus.body.ready === false,
    "feedback readiness read is truthful while measurement is disabled",
  );
  ok(
    (
      await h.request(
        "manager",
        "GET",
        "/api/admin/cro07/phase7/feedback-status",
      )
    ).status === 403,
    "provider configuration readiness remains admin scoped",
  );
  ok(
    (await h.request("anonymous", "POST", "/api/webhooks/cro07/sendgrid", []))
      .status === 401,
    "public SendGrid ingress refuses unsigned requests",
  );
  const sgKeys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  process.env.SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY = sgKeys.publicKey
    .export({ format: "der", type: "spki" })
    .toString("base64");
  const sgEvents = [
    {
      sg_event_id: "browser-fixture-processed",
      event: "processed",
      email: "fixture@example.test",
      "smtp-id": "<browser-fixture@example.test>",
      sg_message_id: "browser-fixture-provider",
      timestamp: Math.floor(Date.now() / 1000),
    },
  ];
  const sgStamp = String(Math.floor(Date.now() / 1000)),
    sgSignature = sign(
      "sha256",
      Buffer.concat([
        Buffer.from(sgStamp),
        Buffer.from(JSON.stringify(sgEvents)),
      ]),
      sgKeys.privateKey,
    ).toString("base64"),
    sgHeaders = {
      "X-Twilio-Email-Event-Webhook-Timestamp": sgStamp,
      "X-Twilio-Email-Event-Webhook-Signature": sgSignature,
    };
  const sgReceived = await h.request(
    "anonymous",
    "POST",
    "/api/webhooks/cro07/sendgrid",
    sgEvents,
    false,
    sgHeaders,
  );
  ok(
    sgReceived.status === 200 && sgReceived.body.applied === 0,
    "actual public raw-body ingress verifies SendGrid ECDSA without a browser session or fabricated exposure",
  );
  ok(
    (
      await h.request(
        "anonymous",
        "POST",
        "/api/webhooks/cro07/sendgrid",
        sgEvents,
        false,
        sgHeaders,
      )
    ).status === 200,
    "signed HTTP retries are idempotently acknowledged",
  );
  ok(
    (
      await h.request(
        "anonymous",
        "POST",
        "/api/webhooks/cro07/sendgrid",
        [{ ...sgEvents[0], event: "bounce" }],
        false,
        sgHeaders,
      )
    ).status === 401,
    "HTTP payload tampering cannot reuse a valid signature",
  );
  ok(
    h.externalCalls() === 0,
    "read-only readiness and signed ingress make no provider calls",
  );
  const query = "start=2026-11-01&end=2026-11-17";
  for (const role of ["admin", "manager"]) {
    const r = await h.request(
      role,
      "GET",
      "/api/analytics/conversion-cohort?" + query,
    );
    ok(
      r.status === 200 && funnelResponseSchema.safeParse(r.body).success,
      role + " receives a validated complete-scope empty report",
    );
  }
  for (const role of [
    "agent",
    "merchant",
    "affiliate",
    "partner",
    "anonymous",
  ]) {
    const r = await h.request(
      role,
      "GET",
      "/api/analytics/conversion-cohort?" + query,
    );
    ok([401, 403].includes(r.status), role + " cannot read cohort aggregates");
    const x = await h.request(
      role,
      "GET",
      "/api/analytics/conversion-cohort/export?" + query,
    );
    ok([401, 403].includes(x.status), role + " cannot export cohort evidence");
  }
  for (const bad of [
    "start=2026-02-30&end=2026-03-01",
    "start=2026-11-01&end=2026-11-17&forgedScope=all",
    "start=2020-01-01&end=2026-11-17",
  ])
    ok(
      (
        await h.request(
          "admin",
          "GET",
          "/api/analytics/conversion-cohort?" + bad,
        )
      ).status === 400,
      "malformed or unbounded filter rejects instead of broadening",
    );
  ok(
    (
      await h.request(
        "manager",
        "POST",
        "/api/admin/cro07/experiments/00000000-0000-4000-8000-000000000001/evaluate",
        {},
      )
    ).status === 403,
    "manager cannot mutate evaluation",
  );
  ok(
    (
      await h.request(
        "admin",
        "POST",
        "/api/admin/cro07/experiments/00000000-0000-4000-8000-000000000001/samples",
        { success: true },
      )
    ).status === 410,
    "arbitrary sample injection is retired at actual route",
  );
  browser = await privateStage3Browser(
    h.base,
    h.sessions.get("admin")!.cookie,
    h.originalFetch,
    "docs/certification/phase7/evidence/browser",
    { realInput: true },
  );
  for (const width of [320, 390, 454, 768, 1023, 1024, 1280])
    for (const theme of ["light", "dark"]) {
      await browser.call("Emulation.setDeviceMetricsOverride", {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await browser.navigate(
        "/dashboard/reporting?tab=growth&growthView=conversion-funnel&funnelStart=2026-11-01&funnelEnd=2026-11-17",
      );
      await browser.waitFor(
        /Open this page in the desktop layout|Seven-stage cohort/,
      );
      if ((await browser.text()).includes("Skip tour"))
        await browser.click('button[aria-label="Skip tour"]');
      if (
        (await browser.text()).includes("Open this page in the desktop layout")
      )
        await browser.click('[data-testid="button-open-desktop-layout"]');
      await browser.waitFor(/Seven-stage cohort/);
      await browser.evaluate(
        `document.documentElement.classList.toggle('dark',${theme === "dark"})`,
      );
      const mounted = await browser.evaluate(
        `!!document.querySelector('[data-testid="conversion-funnel-report"]')`,
      );
      ok(mounted, "actual funnel mounted at " + width + " " + theme);
      const overflow = await browser.evaluate(
        "document.documentElement.scrollWidth>innerWidth+1",
      );
      ok(!overflow, "no document overflow at " + width + " " + theme);
      const geometry = await browser.evaluate(`(() => {
        const rect = element => element.getBoundingClientRect();
        const overlap = (a,b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        const tabs = [...document.querySelectorAll('[role="tablist"][aria-label="Sales and growth views"] [role="tab"]')].map(rect);
        const assistant = document.querySelector('[data-testid="dashboard-data-agent"]');
        const vertical = document.querySelector('#funnel-vertical');
        const headerControls=[...document.querySelectorAll('header button,header a,header input')].map(rect).filter(r=>r.width>0&&r.height>0);
        return {headerOverlap:headerControls.some((a,i)=>headerControls.slice(i+1).some(b=>overlap(a,b))),tabsPresent:tabs.length===4,tabsOverlap:tabs.some((a,i)=>tabs.slice(i+1).some(b=>overlap(a,b))),
          assistantPresent:!!assistant,verticalPresent:!!vertical,
          assistantCoversVertical:!!assistant&&!!vertical&&overlap(rect(assistant),rect(vertical))};
      })()`);
      ok(!geometry.headerOverlap,"header controls do not overlap at " + width + " " + theme);
      ok(geometry.tabsPresent&&!geometry.tabsOverlap, "report tabs remain separate at " + width + " " + theme);
      ok(geometry.assistantPresent&&geometry.verticalPresent&&!geometry.assistantCoversVertical,
        "closed reporting assistant leaves Vertical usable at " + width + " " + theme);
      const requestsBefore = browser.requests.length;
      await browser.click('[data-testid="funnel-refresh"]');
      results.push({
        view: "funnel",
        width,
        theme,
        mounted,
        overflow,
        requestCount: browser.requests.length - requestsBefore,
      });
      await browser.screenshot("funnel-" + width + "-" + theme);
    }
  await browser.navigate(
    "/dashboard/reporting?tab=outreach-analytics&outreachView=ab-testing",
  );
  await browser.waitFor(/No governed experiments/);
  const count = browser.requests.length;
  await browser.click('[data-testid="button-refresh-ab"]');
  await new Promise((r) => setTimeout(r, 500));
  const refreshReads = browser.requests
    .slice(count)
    .filter((r) => r.url.startsWith("/api/admin/cro07/"));
  ok(
    refreshReads.length > 0 && refreshReads.every((r) => r.method === "GET"),
    "normal A/B Refresh performs an actual GET and no experiment mutations",
  );

  browser.failRead("/api/admin/cro07/experiments", { exact: true });
  await browser.click('[data-testid="button-refresh-ab"]');
  await browser.waitFor(/Experiment evidence unavailable/);
  ok(
    !(await browser.text()).includes("No governed experiments"),
    "failed A/B read is not rendered as no experiments",
  );
  browser.failRead(null);
  const invalidStart = browser.requests.length;
  await browser.navigate(
    "/dashboard/reporting?tab=growth&growthView=conversion-funnel&funnelStart=bad&funnelEnd=2026-11-17",
  );
  await browser.waitFor(/Invalid or conflicting URL filters/);
  ok(
    !browser.requests
      .slice(invalidStart)
      .some((r) => r.url.startsWith("/api/analytics/conversion-cohort")),
    "invalid URL never requests a broader report",
  );
  const frozen = await h.pool.query(
    "SELECT count(*)::int AS n FROM cro07_experiments",
  );
  ok(
    frozen.rows[0].n === 0,
    "read-only browser exercises create no experiments or admissions",
  );
  await fs.writeFile(
    "docs/certification/phase7/evidence/browser/results.json",
    JSON.stringify(
      {
        identity: {
          sourceHead: identity.sourceHead,
          inputHash: identity.inputHash,
          outputHash: identity.outputHash,
        },
        checks,
        results,
        webkit: "not_exercised",
        phone: "not_exercised",
        limits:
          "Disposable fixture scale, empty real reporting scope. Unrelated report sources explicitly unavailable.",
      },
      null,
      2,
    ),
  );
  console.log(`Phase 7 browser PASS: ${checks} checks.`);
} finally {
  await browser?.close();
  await h.close();
}
