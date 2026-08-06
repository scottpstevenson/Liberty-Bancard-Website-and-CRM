#!/usr/bin/env tsx
/**
 * test-phone-call-click.ts
 *
 * Smoke test for phone_call_click analytics tracking across public pages.
 *
 * Verifies:
 *  1. POST /api/analytics/phone-call-click returns { ok: true }
 *  2. A row with event_name = "phone_call_click" appears in analytics_events
 *  3. The page_path column matches the supplied sourcePage
 *  4. Static analysis: every public file that contains a tel: link also
 *     imports and calls trackPhoneCallClick (not trackPhoneCtaClick)
 *
 * Run with the dev server up:
 *   npx tsx scripts/test-phone-call-click.ts
 *
 * Exits 0 if all assertions pass, 1 if any fail.
 */

import fs from "fs";
import path from "path";
import { db } from "../server/db";
import { analyticsEvents } from "../shared/schema";
import { eq, desc, and } from "drizzle-orm";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:5000";
const CLIENT_SRC = path.resolve(process.cwd(), "client/src");

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
    failures.push(detail ? `${label} — ${detail}` : label);
  }
}

async function postPhoneCallClick(sourcePage: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE_URL}/api/analytics/phone-call-click`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourcePage }),
    redirect: "manual",
  });
  let body: any = null;
  try { body = await res.json(); } catch {}
  return { status: res.status, body };
}

// Source pages that have dedicated tel: links wired to trackPhoneCallClick
const SOURCE_PAGES = [
  "/proposal",
  "/thanks-call",
  "/thanks-statement",
  "/thanks-estimate",
  "/thanks-support",
  "/help-center",
  "/upload-statement",
  "/accessibility-statement",
  "/ada-compliance",
  "/advertising-disclosure",
  "/california-privacy",
  "/cookie-policy",
  "/data-processing-agreement",
  "/data-retention",
  "/dispute-resolution",
  "/do-not-sell",
  "/e-sign-consent",
  "/law-enforcement-guidelines",
  "/merchant-policies",
  "/privacy-policy",
  "/refund-policy",
  "/regulatory-notices",
  "/responsible-ai",
  "/security-compliance",
  "/sms-terms",
  "/surcharging-disclosure",
  "/tcpa-consent",
  "/terms",
  "/testimonials-disclosure",
  "/thanks-application",
  "/merchant-application",
  "/integrations",
  "/free-analysis",
  "/0-percent-processing",
  "/free-smart-terminal",
  "/beat-square-stripe",
  "/sales/cost-quiz",
  "/",
];

async function testEndpointReturnsOk(sourcePage: string) {
  const { status, body } = await postPhoneCallClick(sourcePage);
  assert(
    `POST /api/analytics/phone-call-click (${sourcePage}) → 200`,
    status === 200,
    `got ${status}`
  );
  assert(
    `Response body.ok = true (${sourcePage})`,
    body?.ok === true,
    `got ${JSON.stringify(body)}`
  );
}

async function testRowWrittenToDb(sourcePage: string) {
  await new Promise(r => setTimeout(r, 300));
  const rows = await db
    .select({ id: analyticsEvents.id, eventName: analyticsEvents.eventName, pagePath: analyticsEvents.pagePath })
    .from(analyticsEvents)
    .where(
      and(
        eq(analyticsEvents.eventName, "phone_call_click"),
        eq(analyticsEvents.pagePath, sourcePage)
      )
    )
    .orderBy(desc(analyticsEvents.occurredAt))
    .limit(1);

  assert(
    `analytics_events row written for ${sourcePage}`,
    rows.length > 0,
    rows.length === 0 ? "no row found" : undefined
  );
  if (rows.length > 0) {
    assert(`event_name = "phone_call_click" (${sourcePage})`, rows[0].eventName === "phone_call_click");
    assert(`page_path = "${sourcePage}"`, rows[0].pagePath === sourcePage);
  }
}

// ── Static analysis: find all public TSX files with tel: links, verify instrumented ──

function readFileSafe(filePath: string): string {
  try { return fs.readFileSync(filePath, "utf-8"); } catch { return ""; }
}

function getAllTsxFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip dashboard/ and mobile/ — those are already wired separately
      if (entry.name !== "dashboard" && entry.name !== "mobile") {
        results.push(...getAllTsxFiles(full));
      }
    } else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) {
      results.push(full);
    }
  }
  return results;
}

function staticAnalysis() {
  const files = getAllTsxFiles(CLIENT_SRC);
  let checks = 0;
  for (const filePath of files) {
    const content = readFileSafe(filePath);
    const hasTelLink = /href=["'`]tel:|href=\{PHONE_TEL\}/.test(content);
    if (!hasTelLink) continue;

    const rel = path.relative(CLIENT_SRC, filePath);
    checks++;

    // Must import trackPhoneCallClick
    const hasImport = /trackPhoneCallClick/.test(content);
    assert(
      `${rel} imports trackPhoneCallClick`,
      hasImport,
      "missing import"
    );

    // Must not use trackPhoneCtaClick on tel: anchor onClick (the function definition in tracking.ts is OK)
    const hasCtaClickOnAnchor = /href=["'`{][^"'`}]*tel:[^>]*onClick[^)]*trackPhoneCtaClick/.test(content) ||
      // check multiline: href=tel: then onClick=trackPhoneCtaClick within 5 lines
      (() => {
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (/href=["'`]tel:|href=\{PHONE_TEL\}/.test(lines[i])) {
            const window = lines.slice(i, Math.min(i + 6, lines.length)).join("\n");
            if (/trackPhoneCtaClick/.test(window)) return true;
          }
        }
        return false;
      })();
    assert(
      `${rel} tel: anchors do not use trackPhoneCtaClick`,
      !hasCtaClickOnAnchor,
      "still uses trackPhoneCtaClick on a tel: anchor"
    );
  }
  if (checks === 0) {
    assert("Static analysis found files to check", false, "no TSX files with tel: links found");
  }
  console.log(`    (${checks} files with tel: links checked)`);
}

async function main() {
  console.log("═".repeat(65));
  console.log(" Phone-Call Click Analytics — Smoke Test");
  console.log("═".repeat(65));

  console.log("\n1. Static analysis — every tel: link is wired to trackPhoneCallClick");
  staticAnalysis();

  console.log("\n2. Endpoint availability and response shape");
  for (const page of SOURCE_PAGES) {
    await testEndpointReturnsOk(page);
  }

  console.log("\n3. Database row verification (spot-check key pages)");
  const SPOT_CHECK = [
    "/proposal", "/thanks-call", "/upload-statement",
    "/privacy-policy", "/thanks-application", "/integrations",
    "/free-smart-terminal", "/0-percent-processing", "/",
  ];
  for (const page of SPOT_CHECK) {
    await testRowWrittenToDb(page);
  }

  console.log("\n4. Missing sourcePage defaults to window.location.pathname (server-side: empty string maps to null)");
  {
    const { status, body } = await postPhoneCallClick("");
    assert("POST without sourcePage still returns 200", status === 200, `got ${status}`);
    assert("Response body.ok = true (no sourcePage)", body?.ok === true);
  }

  console.log(`\n${"═".repeat(65)}`);
  console.log(` Results: ${passed} passed, ${failed} failed`);
  console.log("═".repeat(65));
  if (failures.length) {
    console.error("\nFailures:");
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("\n✅ All phone-call click smoke tests passed.");
  process.exit(0);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
