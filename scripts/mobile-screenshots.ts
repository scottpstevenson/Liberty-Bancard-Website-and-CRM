#!/usr/bin/env tsx
/**
 * Wave 12 — Mobile Screenshots
 *
 * Captures 5 full-page screenshots at 390px viewport width (iPhone 14 Pro).
 * Screenshots saved to attached_assets/screenshots/ per Wave 12 spec.
 *
 * Routes and output files:
 *   /                    → attached_assets/screenshots/home-mobile-390.jpg
 *   /upload-statement    → attached_assets/screenshots/upload-statement-mobile-390.jpg
 *   /free-smart-terminal → attached_assets/screenshots/free-smart-terminal-mobile-390.jpg
 *   /beat-square-stripe  → attached_assets/screenshots/beat-square-stripe-mobile-390.jpg
 *   /get-started         → attached_assets/screenshots/get-started-mobile-390.jpg
 *
 * Playwright install strategy (graceful degradation):
 *   1. Try: npx playwright install chromium --with-deps
 *   2. Fallback: npx playwright install chromium (no system deps)
 *   3. If both fail: log environment limitation, exit 2 (not 1)
 *
 * Exit codes:
 *   0 — all 5 screenshots captured
 *   1 — assertion failure (route returned non-200)
 *   2 — environment/install failure (Playwright unavailable)
 *
 * Run:
 *   BASE_URL=http://localhost:5000 npx tsx scripts/mobile-screenshots.ts
 */

import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:5000";
const SCREENSHOT_DIR = path.join(process.cwd(), "attached_assets", "screenshots");

const CAPTURE_TARGETS = [
  { path: "/",                   file: "home-mobile-390.jpg",                label: "Home" },
  { path: "/upload-statement",   file: "upload-statement-mobile-390.jpg",    label: "Upload Statement" },
  { path: "/free-smart-terminal", file: "free-smart-terminal-mobile-390.jpg", label: "Free Smart Terminal" },
  { path: "/beat-square-stripe", file: "beat-square-stripe-mobile-390.jpg",  label: "Beat Square/Stripe" },
  { path: "/get-started",        file: "get-started-mobile-390.jpg",         label: "Get Started" },
];

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

function tryInstallPlaywright(): boolean {
  console.log("▶ Attempting Playwright chromium install...\n");

  const r1 = spawnSync("npx", ["playwright", "install", "chromium", "--with-deps"], {
    timeout: 120_000,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r1.status === 0) {
    console.log("  ✓ Playwright chromium installed (with-deps)\n");
    return true;
  }

  console.log("  ⚠ --with-deps failed, retrying without system deps...\n");

  const r2 = spawnSync("npx", ["playwright", "install", "chromium"], {
    timeout: 120_000,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r2.status === 0) {
    console.log("  ✓ Playwright chromium installed (without system deps)\n");
    return true;
  }

  console.log("  ⚠ Playwright chromium install failed — screenshots cannot be captured.\n");
  console.log("  Environment limitation: OS-level Chromium dependencies unavailable.\n");
  return false;
}

async function captureScreenshots(): Promise<{ captured: string[]; failed: string[] }> {
  let playwright: any;
  try {
    playwright = await import("playwright");
  } catch {
    throw new Error("Playwright module not found after install attempt");
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

  console.log(`▶ Capturing ${CAPTURE_TARGETS.length} screenshots at 390×844 (full-page)...\n`);

  const captured: string[] = [];
  const failed: string[] = [];

  for (const target of CAPTURE_TARGETS) {
    const page = await context.newPage();
    const outPath = path.join(SCREENSHOT_DIR, target.file);
    try {
      const response = await page.goto(`${BASE_URL}${target.path}`, {
        waitUntil: "networkidle",
        timeout: 20_000,
      });

      const status = response?.status() ?? 0;
      if (status !== 200) {
        console.log(`  ⚠ ${target.label} (${target.path}) returned HTTP ${status} — screenshot skipped.`);
        failed.push(target.path);
      } else {
        await page.screenshot({ path: outPath, type: "jpeg", quality: 85, fullPage: true });
        console.log(`  ✓ ${target.label} → ${path.relative(process.cwd(), outPath)}`);
        captured.push(target.file);
      }
    } catch (err) {
      console.log(`  ⚠ ${target.label} (${target.path}) error: ${err instanceof Error ? err.message : err}`);
      failed.push(target.path);
    } finally {
      await page.close();
    }
  }

  await browser.close();
  return { captured, failed };
}

async function main(): Promise<void> {
  console.log("=== Wave 12 Mobile Screenshots ===\n");
  console.log(`Target: ${BASE_URL}`);
  console.log(`Output: ${path.relative(process.cwd(), SCREENSHOT_DIR)}/\n`);

  const serverReady = await waitForServer();
  if (!serverReady) {
    console.error("❌ Dev server not reachable at", BASE_URL);
    console.error("   Start it first: npm run dev");
    process.exit(2);
  }
  console.log("✓ Dev server reachable\n");

  const playwrightInstalled = tryInstallPlaywright();
  if (!playwrightInstalled) {
    console.log("── Environment Limitation ──────────────────────────────────");
    console.log("  Playwright unavailable in this environment.");
    console.log("  Screenshots cannot be captured automatically.");
    console.log("  To capture manually: load each route in a browser at 390px and save as JPEG.\n");
    console.log("  Expected output files:");
    for (const t of CAPTURE_TARGETS) {
      console.log(`    attached_assets/screenshots/${t.file}`);
    }
    console.log();
    process.exit(2);
  }

  try {
    const { captured, failed } = await captureScreenshots();

    console.log(`\n── Summary ──────────────────────────────────────────────────`);
    console.log(`  Captured: ${captured.length} / ${CAPTURE_TARGETS.length}`);
    if (failed.length > 0) {
      console.log(`  Failed:   ${failed.length} routes returned non-200`);
      failed.forEach(r => console.log(`    - ${r}`));
    }
    console.log();

    if (captured.length === CAPTURE_TARGETS.length) {
      console.log("✅ All 5 mobile screenshots captured.\n");
      process.exit(0);
    } else {
      console.error(`✗ Only ${captured.length}/5 screenshots captured — ${failed.length} route(s) returned non-200.`);
      process.exit(1);
    }
  } catch (err) {
    console.error("Screenshot capture error:", err instanceof Error ? err.message : err);
    console.log("\nEnvironment limitation: Playwright installed but launch failed.");
    process.exit(2);
  }
}

main().catch(err => {
  console.error("Script error:", err);
  process.exit(1);
});
