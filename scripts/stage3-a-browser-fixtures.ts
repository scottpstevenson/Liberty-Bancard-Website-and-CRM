import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** Optional real Chromium proof, separate from static render and HTTP gates.
 * Browser authenticates with the handler fixture's real local session.
 */
export async function certifyStage3Browser(ctx: {
  base: string; cookie: string; managerCookie: string; fetch: typeof fetch; chromium: string;
}) {
  const profile = await mkdtemp(path.join(tmpdir(), "stage3-browser-"));
  const browser = spawn(ctx.chromium, ["--headless", "--no-sandbox", "--disable-gpu",
    "--disable-background-networking", "--disable-extensions", "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"],
  { stdio: "ignore", detached: true, env: { PATH: process.env.PATH, HOME: profile } });
  let socket: WebSocket | undefined;
  let serial = 0;
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  try {
    let debuggingPort = "";
    for (let attempt = 0; attempt < 100; attempt++) {
      debuggingPort = (await readFile(path.join(profile, "DevToolsActivePort"), "utf8").catch(() => "")).split("\n")[0];
      if (debuggingPort) break;
      if (browser.exitCode !== null) throw new Error("FIXTURE_CHROMIUM_EXITED");
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.match(debuggingPort, /^[0-9]+$/);
    const pages = await (await ctx.fetch(`http://127.0.0.1:${debuggingPort}/json/list`)).json();
    const page = pages.find((target: any) => target.type === "page" && target.url === "about:blank");
    assert.ok(page, "attach to the dedicated application page, not a Chromium extension target");
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      socket!.addEventListener("open", () => resolve(), { once: true });
      socket!.addEventListener("error", () => reject(new Error("FIXTURE_CHROMIUM_CONNECT_FAILED")), { once: true });
    });
    const call = (method: string, params: Record<string, unknown> = {}) => new Promise<any>((resolve, reject) => {
      const id = ++serial;
      const timer = setTimeout(() => {
        pending.delete(id); reject(new Error(`FIXTURE_BROWSER_COMMAND_TIMEOUT:${method}`));
      }, 15000);
      pending.set(id, {
        resolve: result => { clearTimeout(timer); resolve(result); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      socket!.send(JSON.stringify({ id, method, params }));
    });
    const errors: string[] = [];
    let failEnrollmentRead = false;
    socket.addEventListener("message", async event => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const p = pending.get(message.id); pending.delete(message.id);
        if (message.error) p?.reject(new Error("FIXTURE_BROWSER_COMMAND_FAILED"));
        else p?.resolve(message.result);
      }
      if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text);
      if (message.method === "Fetch.requestPaused") {
        const { requestId, request } = message.params;
        if (failEnrollmentRead && request.url.startsWith(`${ctx.base}/api/sequence-enrollments/owned`)) {
          await call("Fetch.fulfillRequest", { requestId, responseCode: 503,
            responseHeaders: [{ name: "Content-Type", value: "application/json" }],
            body: Buffer.from('{"message":"Fixture read unavailable"}').toString("base64") });
          return;
        }
        await call(request.url.startsWith(`${ctx.base}/`) ? "Fetch.continueRequest" : "Fetch.failRequest",
          request.url.startsWith(`${ctx.base}/`) ? { requestId } : { requestId, errorReason: "BlockedByClient" });
      }
    });
    await call("Page.enable"); await call("Runtime.enable"); await call("Network.enable");
    await call("Fetch.enable", { patterns: [{ urlPattern: "http*" }] });
    for (const entry of ctx.cookie.split("; ")) {
      const index = entry.indexOf("=");
      await call("Network.setCookie", { name: entry.slice(0, index), value: entry.slice(index + 1), url: ctx.base });
    }
    const text = async () => (await call("Runtime.evaluate", { expression: "document.body.innerText", returnByValue: true })).result.value as string;
    const waitFor = async (pattern: RegExp) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const current = await text();
        if (pattern.test(current)) return current;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      await mkdir(".local/tasks/stage3-a-browser", { recursive: true });
      await writeFile(".local/tasks/stage3-a-browser/failed-render.txt", await text());
      const failedScreen = await call("Page.captureScreenshot", { format: "jpeg", quality: 70 });
      await writeFile(".local/tasks/stage3-a-browser/failed-render.jpg", Buffer.from(failedScreen.data, "base64"));
      await new Promise(resolve => setTimeout(resolve, Number(process.env.STAGE3_BROWSER_PAUSE_MS ?? 0)));
      throw new Error(`FIXTURE_BROWSER_TEXT_TIMEOUT:${pattern.source}`);
    };
    await mkdir(".local/tasks/stage3-a-browser", { recursive: true });
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 402, height: 874 }]) {
      await call("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1, mobile: viewport.width < 500 });
      await call("Page.navigate", { url: `${ctx.base}/` });
      await waitFor(/Credit Card Processing\s+Without the Rate Games/);
      // Let the existing entrance animation settle before measuring it.
      await new Promise(resolve => setTimeout(resolve, 1200));
      const publicLayout = (await call("Runtime.evaluate", { returnByValue: true, expression: `(() => {
        const hero = document.querySelector('[data-testid="text-hero-heading"]');
        const style = getComputedStyle(hero);
        return { fontSize: style.fontSize, color: style.color, width: hero.getBoundingClientRect().width,
          overflow: document.documentElement.scrollWidth > innerWidth + 1 };
      })()` })).result.value;
      assert.equal(publicLayout.fontSize, viewport.width === 1440 ? "68px" : "28px");
      assert.equal(publicLayout.color, "rgb(15, 23, 41)");
      assert.ok(publicLayout.width > 200);
      assert.equal(publicLayout.overflow, false, "public page has no horizontal overflow");
      const publicScreen = await call("Page.captureScreenshot", { format: "jpeg", quality: 70 });
      await writeFile(`.local/tasks/stage3-a-browser/public-${viewport.width}.jpg`, Buffer.from(publicScreen.data, "base64"));
      await call("Page.navigate", { url: `${ctx.base}/dashboard/sequence-report` });
      if (viewport.width < 500) {
        // The existing native mobile shell routes to its own work queue.
        // Use its real, supported desktop-view action; do not bypass routing.
        await waitFor(/Switch to desktop view/);
        await call("Runtime.evaluate", {
          expression: `Array.from(document.querySelectorAll("button"))
            .find(button => button.textContent?.includes("Switch to desktop view"))?.click()`,
        });
        await call("Page.navigate", { url: `${ctx.base}/dashboard/sequence-report` });
      }
      const report = await waitFor(/verified delivery: not observed/i);
      assert.ok(!report.includes("all email goes through"));
      assert.ok(!report.includes("blocked by compliance gate"));
      assert.match(report, /SMTP: not configured/);
      const screenshot = await call("Page.captureScreenshot", { format: "jpeg", quality: 70 });
      await writeFile(`.local/tasks/stage3-a-browser/sequence-${viewport.width}.jpg`, Buffer.from(screenshot.data, "base64"));
      await call("Page.navigate", { url: `${ctx.base}/dashboard/cold-leads` });
      const cold = await waitFor(/Cold Lead Re-engagement/);
      assert.ok(!/Estimated (Audience )?Value|\$15,000/.test(cold));
      const coldScreen = await call("Page.captureScreenshot", { format: "jpeg", quality: 70 });
      await writeFile(`.local/tasks/stage3-a-browser/cold-${viewport.width}.jpg`, Buffer.from(coldScreen.data, "base64"));
      await call("Page.navigate", { url: `${ctx.base}/dashboard/financial-hub?financialTab=terminal-roi` });
      const finance = await waitFor(/Terminal Recommendation Forecasts/);
      assert.match(finance, /verified deployment and actual cash recovery are unavailable/);
      await waitFor(/Production recommendations/);
      const financeScreen = await call("Page.captureScreenshot", { format: "jpeg", quality: 70 });
      await writeFile(`.local/tasks/stage3-a-browser/finance-${viewport.width}.jpg`, Buffer.from(financeScreen.data, "base64"));
    }
    for (const entry of ctx.managerCookie.split("; ")) {
      const index = entry.indexOf("=");
      await call("Network.setCookie", { name: entry.slice(0, index), value: entry.slice(index + 1), url: ctx.base });
    }
    failEnrollmentRead = true;
    await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await call("Page.navigate", { url: `${ctx.base}/dashboard/sequences` });
    await waitFor(/Enrollment counts unavailable; no zero-result assertion/);
    assert.deepEqual(errors, [], "no uncaught browser exceptions on changed real signed-in pages");
    console.log("PASS Chromium public website desktop/phone preservation; signed-in SequenceReport/cold/finance desktop and phone desktop-view mode; manager read-error is unavailable, not zero; external requests denied; no native mobile-workqueue claim");
  } finally {
    socket?.close();
    // Chromium's utility children can still write after its main process exits.
    // Kill only this dedicated process group before removing its private profile.
    if (browser.pid) {
      try { process.kill(-browser.pid, "SIGKILL"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
    }
    await new Promise<void>(resolve => {
      if (browser.exitCode !== null) resolve();
      else browser.once("exit", () => resolve());
    });
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}