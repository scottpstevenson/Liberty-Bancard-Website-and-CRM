#!/usr/bin/env tsx
/**
 * Task #764 — Dashboard polish follow-ups (Doc Vault, Pipeline, Calendar)
 *
 * Route/integration-level tests for the three fixes:
 *   1. Document Vault bulk-download requires the CSRF token header.
 *   2. Pipeline per-deal proposal fetch supports retry (route hit twice
 *      behaves identically; static check confirms the retry button in
 *      Pipeline.tsx calls the same loadDealProposals()/route as initial load).
 *   3. Calendar bad-date warning row actions (edit-date / delete / clear
 *      follow-up) mutate the underlying calendar-events / deals records via
 *      the exact routes the Calendar.tsx mutations call.
 *
 * Run:
 *   BASE_URL=http://localhost:5000 npx tsx scripts/test-dashboard-polish.ts
 *
 * Exit codes: 0 = all pass, 1 = any fail, 2 = environment not suitable
 */

import { db, pool } from "../server/db";
import { calendarEvents, deals } from "../shared/schema";
import { eq } from "drizzle-orm";
import fs from "fs";
import path from "path";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:5000";
const TEST_EMAIL = "playwright-test@libertybancard.internal";
const TEST_PASSWORD = "PlaywrightTest2024!";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  \u2713 ${label}`);
    passed++;
  } else {
    console.error(`  \u2717 ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
    failures.push(label);
  }
}

async function waitForServer(maxMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  return false;
}

function extractSetCookie(res: Response): string {
  const raw = (res.headers as any).getSetCookie?.() as string[] | undefined;
  if (raw && raw.length) return raw.map(c => c.split(";")[0]).join("; ");
  const single = res.headers.get("set-cookie");
  return single ? single.split(";")[0] : "";
}

async function login(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  return extractSetCookie(res);
}

async function getCsrfToken(cookie: string): Promise<{ token: string; cookie: string }> {
  const res = await fetch(`${BASE_URL}/api/csrf-token`, { headers: { Cookie: cookie } });
  const newCookie = extractSetCookie(res);
  const data = await res.json();
  return { token: data.token, cookie: newCookie || cookie };
}

const cleanupEventIds: number[] = [];
const cleanupDealFollowUps: number[] = [];

async function main() {
  console.log("── Task #764: Dashboard polish follow-ups ─────────────────────");

  const serverUp = await waitForServer();
  if (!serverUp) {
    console.error("Server not reachable at " + BASE_URL);
    process.exit(2);
  }

  const cookie = await login();
  const { token: csrfToken, cookie: cookie2 } = await getCsrfToken(cookie);
  const authCookie = cookie2 || cookie;

  // ── Test 1: Bulk document download requires CSRF token ──────────────────
  console.log("\n[1] Document Vault — bulk download CSRF enforcement");
  {
    const noTokenRes = await fetch(`${BASE_URL}/api/documents/bulk-download`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: authCookie },
      body: JSON.stringify({ ids: [1] }),
    });
    assert(
      "Request WITHOUT x-csrf-token header is rejected (403)",
      noTokenRes.status === 403,
      `got ${noTokenRes.status}`
    );

    const withTokenRes = await fetch(`${BASE_URL}/api/documents/bulk-download`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: authCookie,
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({ ids: [1] }),
    });
    assert(
      "Request WITH x-csrf-token header passes CSRF gate (not 403)",
      withTokenRes.status !== 403,
      `got ${withTokenRes.status}`
    );
    // consume body to avoid dangling stream
    await withTokenRes.arrayBuffer().catch(() => {});

    // Static check: the client always attaches the header at this call site
    const vaultSrc = fs.readFileSync(
      path.join(process.cwd(), "client/src/pages/dashboard/DocumentVault.tsx"),
      "utf-8"
    );
    const bulkDownloadFnMatch = vaultSrc.match(/async function handleBulkDownload[\s\S]*?\n  \}/);
    assert(
      "handleBulkDownload() attaches X-CSRF-Token header",
      !!bulkDownloadFnMatch && /X-CSRF-Token/i.test(bulkDownloadFnMatch[0]) && /getCsrfToken\(\)/.test(bulkDownloadFnMatch[0]),
      "expected getCsrfToken() + X-CSRF-Token header in handleBulkDownload"
    );
  }

  // ── Test 2: Pipeline per-deal proposal detail retry ─────────────────────
  console.log("\n[2] Pipeline — deal detail proposal fetch retry");
  {
    const pipelineSrc = fs.readFileSync(
      path.join(process.cwd(), "client/src/pages/dashboard/Pipeline.tsx"),
      "utf-8"
    );

    // The retry button must call loadDealProposals again (same function used on open)
    const retryBlockMatch = pipelineSrc.match(
      /dealProposalsFailed \?[\s\S]{0,1000}?data-testid="button-retry-deal-proposals"[\s\S]{0,300}?<\/Button>/
    );
    assert(
      "\"Details unavailable\" block renders when dealProposalsFailed is true",
      !!retryBlockMatch
    );
    assert(
      "Retry button calls loadDealProposals(selectedDeal.id)",
      !!retryBlockMatch && /onClick=\{\(\) => loadDealProposals\(selectedDeal\.id\)\}/.test(retryBlockMatch[0])
    );

    // loadDealProposals must set/clear dealProposalsFailed around every fetch (not just initial batch)
    const loadFnMatch = pipelineSrc.match(/const loadDealProposals = async[\s\S]*?\n  \};/);
    assert(
      "loadDealProposals() resets dealProposalsFailed(false) before fetch and sets true on failure",
      !!loadFnMatch &&
        /setDealProposalsFailed\(false\)/.test(loadFnMatch[0]) &&
        /setDealProposalsFailed\(true\)/.test(loadFnMatch[0])
    );

    // Live route check: hitting the underlying endpoint twice (simulating open + retry)
    // behaves identically (idempotent), proving retry re-fires the same fetch successfully.
    const testDeal = await db.query.deals.findFirst();
    if (testDeal) {
      const first = await fetch(`${BASE_URL}/api/deals/${testDeal.id}/co-branded-proposals`, {
        headers: { Cookie: authCookie },
      });
      const second = await fetch(`${BASE_URL}/api/deals/${testDeal.id}/co-branded-proposals`, {
        headers: { Cookie: authCookie },
      });
      assert(
        "GET .../co-branded-proposals succeeds on repeated call (retry-safe)",
        first.status === 200 && second.status === 200,
        `got ${first.status}, ${second.status}`
      );
    } else {
      console.log("  (skipped live retry-safety check — no deals in DB)");
    }
  }

  // ── Test 3: Calendar bad-date row edit/delete actions ────────────────────
  console.log("\n[3] Calendar — bad-date warning row edit/delete actions");
  {
    const calSrc = fs.readFileSync(
      path.join(process.cwd(), "client/src/pages/dashboard/Calendar.tsx"),
      "utf-8"
    );

    // Every invalidDateEvents render path must have a paired edit + delete action
    const cardMatch = calSrc.match(/invalidDateEvents\.length > 0[\s\S]*?\n {10}\)\}/);
    assert("Bad-date warning card block found", !!cardMatch);
    assert(
      "Card wires an edit (\"Fix Date\") action per row",
      !!cardMatch && /button-edit-invalid-date-/.test(cardMatch[0]) && /fixEventDateMutation\.mutate/.test(cardMatch[0])
    );
    assert(
      "Card wires a delete/clear action per row",
      !!cardMatch && /button-delete-invalid-date-/.test(cardMatch[0]) && /removeInvalidDateMutation\.mutate/.test(cardMatch[0])
    );

    // Live route check — exercise the exact mutation routes used by
    // fixEventDateMutation / removeInvalidDateMutation for a calendar event.
    const [evt] = await db
      .insert(calendarEvents)
      .values({
        title: "QA_RELEASE_TEST — bad date row",
        startTime: new Date("2020-01-01T09:00:00Z"),
        endTime: new Date("2020-01-01T10:00:00Z"),
      })
      .returning();
    cleanupEventIds.push(evt.id);

    const newIso = new Date("2026-08-01T09:00:00Z").toISOString();
    const fixRes = await fetch(`${BASE_URL}/api/calendar-events/${evt.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: authCookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({ startTime: newIso, endTime: newIso }),
    });
    const fixed = await fixRes.json();
    assert(
      "Fix-date mutation (PUT /api/calendar-events/:id) updates startTime",
      fixRes.status === 200 && new Date(fixed.startTime).toISOString() === newIso,
      `status=${fixRes.status}`
    );

    const delRes = await fetch(`${BASE_URL}/api/calendar-events/${evt.id}`, {
      method: "DELETE",
      headers: { Cookie: authCookie, "x-csrf-token": csrfToken },
    });
    assert("Delete mutation (DELETE /api/calendar-events/:id) removes the event", delRes.status === 200);
    const stillThere = await db.query.calendarEvents.findFirst({ where: eq(calendarEvents.id, evt.id) });
    assert("Event no longer exists in DB after delete", !stillThere);
    cleanupEventIds.pop();

    // Deal follow-up variant: PUT nextFollowUp to a value, then clear it (null)
    const testDeal = await db.query.deals.findFirst();
    if (testDeal) {
      const originalFollowUp = testDeal.nextFollowUp;
      cleanupDealFollowUps.push(testDeal.id);

      const setRes = await fetch(`${BASE_URL}/api/deals/${testDeal.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: authCookie, "x-csrf-token": csrfToken },
        body: JSON.stringify({ nextFollowUp: newIso }),
      });
      assert("Fix-date mutation on a deal follow-up (PUT /api/deals/:id) succeeds", setRes.status === 200);

      const clearRes = await fetch(`${BASE_URL}/api/deals/${testDeal.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: authCookie, "x-csrf-token": csrfToken },
        body: JSON.stringify({ nextFollowUp: null }),
      });
      const cleared = await clearRes.json();
      assert(
        "Clear-follow-up mutation (PUT /api/deals/:id, nextFollowUp: null) clears the warning source",
        clearRes.status === 200 && cleared.nextFollowUp === null
      );

      // restore original value
      await fetch(`${BASE_URL}/api/deals/${testDeal.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: authCookie, "x-csrf-token": csrfToken },
        body: JSON.stringify({ nextFollowUp: originalFollowUp }),
      });
      cleanupDealFollowUps.pop();
    } else {
      console.log("  (skipped deal follow-up check — no deals in DB)");
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────────────
  for (const id of cleanupEventIds) {
    await db.delete(calendarEvents).where(eq(calendarEvents.id, id)).catch(() => {});
  }

  // ── Summary ───────────────────────────────────────────────────────────
  console.log("\n── Summary ─────────────────────────────────────────────────");
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("\nFailures:");
    failures.forEach(f => console.log(`  - ${f}`));
  }

  await pool.end().catch(() => {});
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("Fatal error running test-dashboard-polish:", err);
  await pool.end().catch(() => {});
  process.exit(2);
});
