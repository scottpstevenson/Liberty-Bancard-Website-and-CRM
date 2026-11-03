import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile, access, readFile } from "node:fs/promises";
import path from "node:path";
import { stage3BHttpFixture } from "./fixtures/stage3-b-http";
import { privateStage3Browser } from "./fixtures/private-stage3-browser";
import { verifyCandidateIdentity } from "./fixtures/candidate-build-identity";

// Stage 4D matched Calendar performance (manual certification, not a mandatory suite). The SAME disposable API, database, machine and
// session serve two production client builds: the pre-4D client (git e112d19e, built into generated-artifacts/s4d-baseline-client)
// and the candidate in dist/public. Only client assets vary. Cold navigations with the HTTP cache disabled, at 1280 and 390.
// Fixture volumes: 321 production contacts, 4 provider-read events. This is NOT a production or network measurement.
const baselineRoot = path.resolve("generated-artifacts/s4d-baseline-client");
await access(path.join(baselineRoot, "index.html")).catch(() => { throw new Error("Build the pre-4D client into generated-artifacts/s4d-baseline-client first (git archive e112d19e, vite build)"); });
const identity = await verifyCandidateIdentity();
const baselineIndexSha = createHash("sha256").update(await readFile(path.join(baselineRoot, "index.html"))).digest("hex");
const dir = "generated-artifacts/stage4d-performance";
let clientRoot = path.resolve("dist/public");
const SALES_ID = "AbCdEfGhIjKlMnOpQrSt";
process.env.GHL_DEFAULT_CALENDAR_ID = SALES_ID;
process.env.GHL_LOCATION_ID = `loc-perf${randomUUID().replaceAll("-", "").slice(0, 8)}`;
delete process.env.GHL_CALENDAR_BOOKING_URL;
delete process.env.GHL_DEFAULT_BOOKING_LINK;
const tag = randomUUID().replaceAll("-", "").slice(0, 8);
const dayStart = new Date(); dayStart.setUTCHours(12, 0, 0, 0);
const hour = (n: number) => new Date(dayStart.getTime() + n * 3600_000).toISOString();
const events = [0, 2, 4, 6].map(n => ({ id: `appt-p${n}-${tag}`, title: `Perf ${n}`, contactId: `ghl-perf-${tag}`, contactName: "Perf Person", startTime: hour(n), endTime: hour(n + 1), status: "confirmed" }));

const h = await stage3BHttpFixture(async app => {
  (await import("../server/routes/contacts.ts")).registerContactsRoutes(app);
  (await import("../server/routes/activity.ts")).registerActivityRoutes(app);
  (await import("../server/routes/deals.ts")).registerDealsRoutes(app);
  (await import("../server/routes/workflows.ts")).registerWorkflowsRoutes(app);
  (await import("../server/routes/toolkit.ts")).registerToolkitRoutes(app, {
    appointments: { config: () => ({ locationId: process.env.GHL_LOCATION_ID! }) as any, read: async () => ({ events }) },
  });
  app.use("/api", (_req, res) => res.status(501).json({ message: "Source not registered in this isolated performance fixture" }));
  const { static: serveStatic } = await import("express");
  app.use((req, res, next) => serveStatic(clientRoot)(req, res, next));
  app.use((_req, res) => res.sendFile("index.html", { root: clientRoot }));
}, undefined, { backgroundProfile: "off" });

const N = 7;
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
type Row = { medianMs: number; samples: number[]; shellMedianMs: number; shellSamples: number[]; jsBytes: number };
const results: Record<string, Record<string, Row>> = { baseline: {}, candidate: {} };
try {
  await mkdir(dir, { recursive: true });
  await h.pool.query(`UPDATE users SET tour_completed_at=NOW() WHERE id LIKE $1`, [`${h.prefix}-%`]);
  await h.pool.query(`INSERT INTO contacts(first_name,last_name,email,phone,record_class,lead_source,created_at,email_status)
    SELECT 'Filler','Person '||g, $1||'-f'||g||'@example.test','+1996'||lpad((g+4200000)::text,7,'0'),'production','dashboard',NOW()-INTERVAL '1 day','valid' FROM generate_series(1,320) g`, [tag]);
  await h.pool.query(`INSERT INTO contacts(first_name,last_name,email,phone,record_class,lead_source,ghl_contact_id,created_at,email_status)
    VALUES('Perf','Person',$1,'+19950000099','production','dashboard',$2,NOW()-INTERVAL '1 day','valid')`, [`${tag}-perf@example.test`, `ghl-perf-${tag}`]);
  const b = await privateStage3Browser(h.base, h.sessions.get("admin")!.cookie, h.originalFetch, dir, { realInput: true, startupTimeoutMs: 30000 });
  await b.call("Network.setBypassServiceWorker", { bypass: true });
  await b.navigate("/favicon.png");
  await b.evaluate(`localStorage.setItem('prefer_desktop','true');localStorage.setItem('liberty-theme','light')`);
  await b.call("Network.setCacheDisabled", { cacheDisabled: true });
  // Readiness contract (same as the Stage 3 C5 performance contract), asserted for EVERY sample; a timeout is a failure, never a sample.
  //   shell ready = the page's landmark exists; data ready = shell ready AND no loading indicator for two consecutive polls.
  const loadingProbe = `(()=>{const q=s=>document.querySelector(s);return !!(q('[aria-busy="true"]')||q('.animate-pulse')||q('[role=progressbar]')||q('.animate-spin')||[...document.querySelectorAll('[role=status]')].some(e=>/loading/i.test(e.textContent||'')));})()`;
  const READY_TIMEOUT_MS = 15000;
  const visit = async (url: string, sel: string) => {
    const t0 = Date.now(); await b.navigate(url);
    let shellMs = -1, dataMs = -1, quiet = 0;
    while (Date.now() - t0 < READY_TIMEOUT_MS) {
      if (shellMs < 0 && await b.evaluate(`!!document.querySelector(${JSON.stringify(sel)})`)) shellMs = Date.now() - t0;
      if (shellMs >= 0) { const loading = await b.evaluate(loadingProbe); quiet = loading ? 0 : quiet + 1; if (quiet >= 2) { dataMs = Date.now() - t0; break; } }
      await new Promise(r => setTimeout(r, 25));
    }
    assert.ok(shellMs >= 0, `${url}: shell element ${sel} not ready within ${READY_TIMEOUT_MS}ms (a timeout is not a sample)`);
    assert.ok(dataMs >= 0, `${url}: still loading ${READY_TIMEOUT_MS}ms after the shell was ready (a timeout is not a sample)`);
    const jsBytes = await b.evaluate(`performance.getEntriesByType('resource').filter(e=>e.name.endsWith('.js')).reduce((n,e)=>n+(e.transferSize||e.encodedBodySize||0),0)`) as number;
    return { ms: dataMs, shellMs, jsBytes };
  };
  const url = "/dashboard/tasks-appointments?tab=calendar";
  const sel = '[data-testid="calendar-page"]';
  for (const [label, width, height] of [["1280", 1280, 900], ["390", 390, 844]] as const) {
    await b.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 700 });
    const samples: Record<string, number[]> = { baseline: [], candidate: [] }, shell: Record<string, number[]> = { baseline: [], candidate: [] }, bytes: Record<string, number> = { baseline: 0, candidate: 0 };
    clientRoot = path.resolve("dist/public"); await visit(url, sel); // warm the server once
    for (let i = 0; i < N; i++) for (const which of ["baseline", "candidate"] as const) {
      clientRoot = which === "baseline" ? baselineRoot : path.resolve("dist/public");
      const r = await visit(url, sel); samples[which].push(r.ms); shell[which].push(r.shellMs); bytes[which] = r.jsBytes;
    }
    for (const which of ["baseline", "candidate"] as const) results[which][`${url} @${label}`] = { medianMs: median(samples[which]), samples: samples[which], shellMedianMs: median(shell[which]), shellSamples: shell[which], jsBytes: bytes[which] };
  }
  await b.close();
  const verdict = Object.keys(results.baseline).map(k => { const a = results.baseline[k].medianMs, c = results.candidate[k].medianMs; return { route: k, baselineMedianMs: a, candidateMedianMs: c, deltaMs: c - a, withinBound: c <= a * 1.25 + 150 }; });
  await writeFile(`${dir}/performance-receipt.json`, JSON.stringify({ status: verdict.every(v => v.withinBound) ? "passed" : "failed", runs: N, machine: "disposable local fixture", baseline: "e112d19e pre-4D client",
    verdict, results, fixtureVolume: { productionContacts: 321, providerReadEvents: events.length },
    readiness: "every sample asserted shell-ready then data-ready (no loading indicator for two consecutive polls); timeouts fail the run; timed value is data-ready; shell-ready recorded separately",
    candidateIdentity: identity, baselineInput: { commit: "e112d19e", root: "generated-artifacts/s4d-baseline-client", indexSha256: baselineIndexSha },
    scope: "Calendar route only, cold navigation to data-ready, cache disabled, same API/DB/machine; client assets only vary; fixture volumes above; not a production or network measurement. Campaigns and Program Health were not measured (their sources are not registered in this isolated fixture)." }, null, 2));
  console.log(JSON.stringify(verdict, null, 1));
  for (const v of verdict) assert.ok(v.withinBound, `${v.route}: candidate median ${v.candidateMedianMs}ms exceeds baseline ${v.baselineMedianMs}ms by more than 25% + 150ms`);
  console.log("Stage 4D Calendar performance: PASS");
} finally { await h.close(); }
