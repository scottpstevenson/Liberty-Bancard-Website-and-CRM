/** Full public route residual layout audit of compiled artifacts. Local server only; never submits a form. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import { PUBLIC_ROUTE_PATHS } from "../shared/seo-routes";
import { privateStage3Browser } from "./fixtures/private-stage3-browser";
import { verifyCandidateIdentity } from "./fixtures/candidate-build-identity";
const identity = await verifyCandidateIdentity(),
  root = path.resolve("dist/public"),
  dir = "docs/certification/phase7/evidence/public-mobile";
await fs.mkdir(dir, { recursive: true });
const app = express();
app.use("/api", (_req, res) =>
  res
    .status(503)
    .json({ message: "No live service in static public layout certification" }),
);
app.use(express.static(root));
app.use((_req, res) => res.sendFile("index.html", { root }));
const server = await new Promise<ReturnType<typeof app.listen>>((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  }),
  base = `http://127.0.0.1:${(server.address() as any).port}`;
let browser: Awaited<ReturnType<typeof privateStage3Browser>> | undefined;
const rows: any[] = [];
try {
  browser = await privateStage3Browser(base, "", fetch, dir, {
    realInput: true,
  });
  for (const route of PUBLIC_ROUTE_PATHS) {
    await browser.call("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await browser.navigate(route);
    for (let i = 0; i < 50; i++) {
      if (await browser.evaluate("!!document.querySelector('main h1')")) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    // Load lazy derivatives through actual scrolling before declaring an image broken.
    await browser.evaluate(
      `(async()=>{for(const e of document.images){if(e.getClientRects().length){e.scrollIntoView({block:'center'});await new Promise(r=>setTimeout(r,60));}}scrollTo(0,0);await new Promise(r=>setTimeout(r,300));})()`,
    );
    for (const width of [320, 390, 454, 768, 1280])
      for (const theme of ["light", "dark"]) {
        await browser.call("Emulation.setDeviceMetricsOverride", {
          width,
          height: 900,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await browser.evaluate(
          `document.documentElement.classList.toggle('dark',${theme === "dark"})`,
        );
        await new Promise((r) => setTimeout(r, 60));
        // Radix Select retains an aria-hidden, tabIndex=-1, clipped native select for form serialization.
        // Its visible combobox button remains in the touch-target measurements.
        const measured = await browser.evaluate(
          `(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,h1:document.querySelectorAll('main h1').length,brokenImages:[...document.images].filter(e=>e.getClientRects().length&&e.complete&&e.naturalWidth===0).map(e=>new URL(e.currentSrc||e.src,location.href).pathname),smallControls:[...document.querySelectorAll('button:not([role=checkbox]):not([role=radio]):not([role=switch]),input:not([type=checkbox]):not([type=radio]):not([type=hidden]),select,textarea')].filter(e=>{const r=e.getBoundingClientRect();return !e.classList.contains('sr-only')&&!(e.matches('select[aria-hidden="true"][tabindex="-1"]')&&getComputedStyle(e).position==='absolute'&&getComputedStyle(e).overflow==='hidden')&&r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'&&(r.height<43||r.width<43)}).map(e=>({tag:e.tagName,text:(e.getAttribute('aria-label')||e.textContent||'').trim().slice(0,80),height:Math.round(e.getBoundingClientRect().height),width:Math.round(e.getBoundingClientRect().width)})),smallFormFonts:[...document.querySelectorAll('input,textarea,select')].filter(e=>!e.classList.contains('sr-only')&&!(e.matches('select[aria-hidden="true"][tabindex="-1"]')&&getComputedStyle(e).position==='absolute'&&getComputedStyle(e).overflow==='hidden')&&e.getClientRects().length&&parseFloat(getComputedStyle(e).fontSize)<16).length,images:[...document.images].filter(e=>e.getClientRects().length).map(e=>({path:new URL(e.currentSrc||e.src,location.href).pathname,width:Math.round(e.getBoundingClientRect().width),natural:e.naturalWidth})),transferBytes:performance.getEntriesByType('resource').reduce((s,e)=>s+(e.transferSize||0),0)}))()`,
        );
        rows.push({ route, width, theme, ...measured });
        if (width === 320 && theme === "light")
          await browser.screenshot(
            "route-" + (route.replace(/[^a-z0-9]/gi, "-") || "home"),
          );
      }
    console.log("Audited " + route + " at ten width/theme combinations.");
  }
  // Separate real Chromium browser zoom profile. CSS transform is not accepted as zoom proof.
  await browser.close();
  browser = await privateStage3Browser(base, "", fetch, dir, {
    realInput: true,
    zoom: 2,
  });
  await browser.call("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await browser.navigate("/");
  const zoom = await browser.evaluate(
    "({innerWidth,devicePixelRatio,overflow:document.documentElement.scrollWidth>innerWidth+1})",
  );
  await browser.screenshot("home-200-percent-zoom");
  const findings = rows.filter(
    (r) =>
      r.overflow ||
      r.h1 !== 1 ||
      r.brokenImages.length ||
      r.smallControls.length ||
      r.smallFormFonts,
  );
  await fs.writeFile(
    path.join(dir, "results.json"),
    JSON.stringify(
      {
        identity: {
          sourceHead: identity.sourceHead,
          inputHash: identity.inputHash,
          outputHash: identity.outputHash,
        },
        routes: PUBLIC_ROUTE_PATHS.length,
        cells: rows.length,
        rows,
        zoom,
        findings,
        qualification:
          "Compiled local layouts only; static server deliberately exposes service-unavailable APIs. No form submissions, production requests, real-phone or WebKit acceptance. Transfer bytes are local diagnostics, not production performance budgets.",
      },
      null,
      2,
    ),
  );
  assert.equal(rows.length, PUBLIC_ROUTE_PATHS.length * 10);
  assert.ok(
    rows.every((r) => !r.overflow),
    "Public document overflow must be resolved",
  );
  assert.ok(
    rows.every((r) => r.h1 === 1),
    "Every public page must mount its single main heading",
  );
  assert.ok(
    rows.every((r) => !r.brokenImages.length),
    "Visible images must load after lazy scrolling",
  );
  assert.ok(
    rows
      .filter((r) => r.width < 768)
      .every((r) => r.smallControls.length === 0 && r.smallFormFonts === 0),
    "Mobile visible controls require 44px targets and 16px form text",
  );
  console.log(
    `Phase 7 public mobile layout PASS: ${rows.length} route/width/theme cells; ${findings.length} cells carry recorded tap/font diagnostics for review. WebKit and actual phones NOT EXERCISED.`,
  );
} finally {
  await browser?.close();
  await new Promise<void>((r) => server.close(() => r()));
}
