#!/usr/bin/env tsx
/**
 * Wave 12 — Mobile Route Check & Screenshots
 *
 * Verifies the /mobile PWA routes serve correct HTTP responses and, if
 * Playwright is available in the environment, captures viewport screenshots
 * at 390×844 (iPhone 14 Pro) to docs/screenshots/.
 *
 * Playwright install strategy (graceful degradation):
 *   1. Try: npx playwright install chromium --with-deps
 *   2. Fallback: npx playwright install chromium (no system deps)
 *   3. If both fail: fall back to HTTP-only checks (exit 2, not 1)
 *
 * Exit codes:
 *   0 — all HTTP checks passed (screenshots optional)
 *   1 — one or more HTTP checks failed
 *   2 — environment limitation (Playwright unavailable); HTTP checks still run
 *
 * Run:
 *   BASE_URL=http://localhost:5000 npx tsx scripts/mobile-screenshots.ts
 */

import { execSync, spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:5000";
const SCREENSHOT_DIR = path.join(process.cwd(), "docs", "screenshots");

// Mobile routes to check
const MOBILE_ROUTES = [
  { path: "/mobile",                 label: "PWA Home" },
  { path: "/mobile/contacts",        label: "Mobile Contacts" },
  { path: "/mobile/pipeline",        label: "Mobile Pipeline" },
  { path: "/mobile/tasks",           label: "Mobile Tasks" },
  { path: "/mobile/settings",        label: "Mobile Settings" },
];

// Additional public routes to check for mobile-friendliness
const PUBLIC_MOBILE_ROUTES = [
  { path: "/",                       label: "Marketing Home" },
  { path: "/get-started",            label: "Get Started" },
  { path: "/upload-statement",       label: "Statement Upload" },
  { path: "/partners",               label: "Partners" },
];

let httpPassed = 0;
let httpFailed = 0;
const httpFailures: string[] = [];
let envLimited = false;

function assertHttp(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    httpPassed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    httpFailed++;
    httpFailures.push(label);
  }
}

async function waitForServer(maxMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(2000) });
      return true;
    } catch {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  return false;
}

async function checkHttpRoutes(): Promise<void> {
  console.log("▶ HTTP route checks (390px mobile user-agent)\n");

  const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

  const allRoutes = [...MOBILE_ROUTES, ...PUBLIC_MOBILE_ROUTES];
  for (const route of allRoutes) {
    try {
      const res = await fetch(`${BASE_URL}${route.path}`, {
        headers: { "User-Agent": MOBILE_UA },
        redirect: "follow",
        signal: AbortSignal.timeout(8000),
      });
      assertHttp(
        `${route.label} (${route.path}) returns 2xx`,
        res.status >= 200 && res.status < 300,
        `status=${res.status}`
      );

      // Check Content-Type includes text/html
      const ct = res.headers.get("content-type") ?? "";
      assertHttp(
        `${route.label} returns HTML`,
        ct.includes("text/html"),
        `content-type=${ct}`
      );

      // Check for viewport meta tag (basic mobile-responsiveness indicator)
      const html = await res.text();
      const hasViewport = /<meta[^>]+name=["']viewport["']/i.test(html);
      assertHttp(
        `${route.label} has viewport meta tag`,
        hasViewport,
        "Missing <meta name=\"viewport\"> — page may not be mobile-responsive"
      );

    } catch (err) {
      assertHttp(`${route.label} reachable`, false, String(err));
    }
  }
}

function tryInstallPlaywright(): boolean {
  console.log("\n▶ Attempting Playwright install (chromium)...\n");

  // Attempt 1: with deps
  const result1 = spawnSync(
    "npx",
    ["playwright", "install", "chromium", "--with-deps"],
    { timeout: 120_000, stdio: "inherit" }
  );
  if (result1.status === 0) {
    console.log("  ✓ Playwright chromium installed (with-deps)\n");
    return true;
  }

  console.log("  ⚠ --with-deps failed, trying without system deps...\n");

  // Attempt 2: chromium only
  const result2 = spawnSync(
    "npx",
    ["playwright", "install", "chromium"],
    { timeout: 120_000, stdio: "inherit" }
  );
  if (result2.status === 0) {
    console.log("  ✓ Playwright chromium installed (no system deps)\n");
    return true;
  }

  console.log("  ⚠ Playwright install failed — screenshots skipped, HTTP checks only.\n");
  return false;
}

async function captureScreenshots(): Promise<void> {
  let playwright: any;
  try {
    playwright = await import("playwright");
  } catch {
    console.log("  ⚠ Playwright module not available — screenshots skipped.\n");
    envLimited = true;
    return;
  }

  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });

  const captureRoutes = [
    { path: "/",               label: "marketing-home" },
    { path: "/mobile",         label: "pwa-home" },
    { path: "/get-started",    label: "get-started" },
    { path: "/partners",       label: "partners" },
    { path: "/upload-statement", label: "upload-statement" },
  ];

  console.log(`▶ Capturing ${captureRoutes.length} mobile screenshots at 390×844...\n`);

  for (const route of captureRoutes) {
    const page = await context.newPage();
    try {
      await page.goto(`${BASE_URL}${route.path}`, { waitUntil: "networkidle", timeout: 15_000 });
      const screenshotPath = path.join(SCREENSHOT_DIR, `mobile-${route.label}.jpg`);
      await page.screenshot({ path: screenshotPath, type: "jpeg", quality: 85, fullPage: false });
      console.log(`  ✓ Screenshot saved: docs/screenshots/mobile-${route.label}.jpg`);
    } catch (err) {
      console.log(`  ⚠ Screenshot failed for ${route.path}: ${err instanceof Error ? err.message : err}`);
    } finally {
      await page.close();
    }
  }

  await browser.close();
  console.log(`\n  Screenshots saved to: ${SCREENSHOT_DIR}\n`);
}

async function main(): Promise<void> {
  console.log("\n=== Wave 12 Mobile Route Check & Screenshots ===\n");
  console.log(`Target: ${BASE_URL}\n`);

  const serverReady = await waitForServer();
  if (!serverReady) {
    console.error("❌ Dev server not reachable at", BASE_URL);
    console.error("   Start it with: npm run dev");
    process.exit(2);
  }
  console.log("✓ Dev server reachable\n");

  // HTTP checks always run
  await checkHttpRoutes();

  // Screenshot capture — optional
  const playwrightInstalled = tryInstallPlaywright();
  if (playwrightInstalled) {
    await captureScreenshots();
  } else {
    envLimited = true;
    console.log("  ℹ Skipping screenshots — Playwright not available in this environment.\n");
  }

  // Summary
  console.log(`\n${"=".repeat(56)}`);
  console.log("Mobile Check Summary:");
  console.log(`  HTTP checks passed: ${httpPassed}`);
  console.log(`  HTTP checks failed: ${httpFailed}`);
  if (envLimited) {
    console.log("  ℹ Screenshots skipped (environment limitation)");
  }
  if (httpFailures.length > 0) {
    console.log("\nFailed HTTP checks:");
    httpFailures.forEach(f => console.log(`  - ${f}`));
  }
  console.log("=".repeat(56));

  if (httpFailed > 0) {
    process.exit(1);
  } else if (envLimited) {
    console.log("\n⚠ HTTP checks passed; screenshots skipped (environment limitation).");
    process.exit(2);
  } else {
    console.log("\n✅ All mobile checks passed.\n");
    process.exit(0);
  }
}

main().catch(err => {
  console.error("Script error:", err);
  process.exit(1);
});
