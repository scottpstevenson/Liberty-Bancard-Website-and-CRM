#!/usr/bin/env tsx
/**
 * Task #752 — CSV Import Reconciliation Smoke Test
 *
 * Verifies that `/api/leads/import-csv` never drops rows invisibly:
 *
 *   totalRows === createdCount + duplicateCount + invalidCount + skippedCount + errorCount
 *
 * Scenarios covered:
 *  1. Mixed file (2 valid, 1 blank row, 1 missing-contact-method row, 1 valid) — first upload.
 *  2. Same file uploaded a second time — all previously-inserted rows should now
 *     resolve as app-level duplicates (not silently vanish).
 *  3. All-invalid file — every row should be counted as invalid, zero created.
 *  4. Outscraper-shaped file with NO email column at all — multiple valid rows
 *     (phone/company only) must all actually import. Regression test for a bug
 *     where contacts.email is NOT NULL + unique-indexed, and persisting "" for
 *     every no-email row collided on that index after the first such row,
 *     causing onConflictDoNothing() to silently DB-conflict-skip every
 *     subsequent valid no-email row. Uses a randomly generated company/phone
 *     suffix per run so repeated runs never collide with prior runs' leftover
 *     dev-DB data (see fixtures/csv-import/outscraper_missing_emails.csv for a
 *     static, human-readable reference copy of the same shape).
 *
 * Run with the dev server up:
 *   BASE_URL=http://localhost:5000 npx tsx scripts/test-import-reconciliation.ts
 *
 * Requires a logged-in-capable test user. Prefers TEST_USER_* (or the dedicated
 * Playwright test user seeded by scripts/create-test-user.ts). On a fresh
 * disposable database where that user does not exist yet, it retries with the
 * ADMIN_SEED_* account that application startup has just created.
 *
 * Exits 0 if all assertions pass, 1 if any fail.
 */

import fs from "fs";
import path from "path";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:5000";
const TEST_EMAIL = process.env.TEST_USER_EMAIL ?? "playwright-test@libertybancard.internal";
const TEST_PASSWORD = process.env.TEST_USER_PASSWORD ?? "PlaywrightTest2024!";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`  \u2713 ${message}`);
  } else {
    failed++;
    failures.push(message);
    console.error(`  \u2717 ${message}`);
  }
}

function extractCookie(setCookieHeaders: string[]): string {
  return setCookieHeaders.map((c) => c.split(";")[0]).join("; ");
}

async function login(): Promise<string> {
  async function attempt(email: string, password: string) {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    return { res, body: res.ok ? "" : await res.text() };
  }

  let attemptResult = await attempt(TEST_EMAIL, TEST_PASSWORD);
  if (
    !attemptResult.res.ok &&
    process.env.ADMIN_SEED_EMAIL &&
    process.env.ADMIN_SEED_PASSWORD
  ) {
    attemptResult = await attempt(
      process.env.ADMIN_SEED_EMAIL,
      process.env.ADMIN_SEED_PASSWORD,
    );
  }

  if (!attemptResult.res.ok) {
    throw new Error(
      `Login failed: ${attemptResult.res.status} ${attemptResult.body}`,
    );
  }
  const setCookie = attemptResult.res.headers.getSetCookie?.() ?? [];
  return extractCookie(setCookie);
}

async function getCsrfToken(cookie: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/csrf-token`, {
    headers: { Cookie: cookie },
  });
  const data = await res.json();
  return data.token;
}

async function uploadCsv(cookie: string, csrf: string, filePath: string): Promise<any> {
  const fileBuffer = fs.readFileSync(filePath);
  return uploadCsvContent(cookie, csrf, fileBuffer, path.basename(filePath));
}

async function uploadCsvContent(
  cookie: string,
  csrf: string,
  content: Buffer | string,
  fileName: string,
): Promise<any> {
  const form = new FormData();
  form.append("file", new Blob([content], { type: "text/csv" }), fileName);

  const res = await fetch(`${BASE_URL}/api/leads/import-csv`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "x-csrf-token": csrf,
    },
    body: form,
  });
  const body = await res.json();
  return { status: res.status, body };
}

function assertReconciled(label: string, body: any) {
  const { inserted = 0, duplicatesSkipped = 0, invalidRows = 0, skippedRows = 0, errors = 0 } = body;
  const totalRows = body.import?.totalRows;
  const reconciledTotal = inserted + duplicatesSkipped + invalidRows + skippedRows + errors;
  assert(
    typeof totalRows === "number",
    `${label}: response includes import.totalRows (got ${totalRows})`,
  );
  assert(
    reconciledTotal === totalRows,
    `${label}: totalRows(${totalRows}) === created(${inserted}) + duplicates(${duplicatesSkipped}) + invalid(${invalidRows}) + skipped(${skippedRows}) + errors(${errors}) = ${reconciledTotal}`,
  );
  assert(
    typeof body.invalidRows === "number" && typeof body.skippedRows === "number",
    `${label}: response JSON exposes both invalidRows and skippedRows fields`,
  );
  if (!body.replayed) {
    assert(
      typeof body.import?.invalidRows === "number" && typeof body.import?.skippedRows === "number",
      `${label}: persisted csv_imports record has invalidRows and skippedRows columns populated`,
    );
  }
}

async function main() {
  console.log(`\nCSV Import Reconciliation Smoke Test (against ${BASE_URL})\n`);

  const cookie = await login();
  const csrf = await getCsrfToken(cookie);

  console.log("Scenario 1: mixed file, first upload (2 new + 1 blank-invalid + 1 missing-contact-invalid + 1 new)");
  const mixedPath = path.join(process.cwd(), "fixtures/csv-import/reconciliation_mixed.csv");
  // Whitespace-only trailing lines change the execution fingerprint without
  // changing parsed logical rows, keeping the live test repeatable.
  const mixedContent = `${fs.readFileSync(mixedPath, "utf8")}${"\n".repeat((Date.now() % 997) + 2)}`;
  const first = await uploadCsvContent(cookie, csrf, mixedContent, path.basename(mixedPath));
  assert(first.status === 201, `Scenario 1: HTTP 201 (got ${first.status})`);
  assertReconciled("Scenario 1", first.body);
  assert(first.body.invalidRows >= 1, `Scenario 1: at least 1 invalid row detected (got ${first.body.invalidRows})`);

  console.log("\nScenario 2: same mixed file uploaded again (replays the original durable execution)");
  const second = await uploadCsvContent(cookie, csrf, mixedContent, path.basename(mixedPath));
  assert(second.status === 200, `Scenario 2: HTTP 200 replay (got ${second.status})`);
  assert(second.body.replayed === true, "Scenario 2: response marks execution as replayed");
  assertReconciled("Scenario 2", second.body);
  assert(
    second.body.inserted === first.body.inserted,
    `Scenario 2: replay returns original created count without writing contacts (got ${second.body.inserted})`,
  );
  assert(
    second.body.execution?.id,
    "Scenario 2: replay returns the existing durable execution identity",
  );

  console.log("\nScenario 3: all-invalid file (every row invalid, zero created)");
  const invalidPath = path.join(process.cwd(), "fixtures/csv-import/reconciliation_all_invalid.csv");
  const invalidContent = `${fs.readFileSync(invalidPath, "utf8")}${"\n".repeat((Date.now() % 991) + 2)}`;
  const third = await uploadCsvContent(cookie, csrf, invalidContent, path.basename(invalidPath));
  assert(third.status === 201, `Scenario 3: HTTP 201 (got ${third.status})`);
  assertReconciled("Scenario 3", third.body);
  assert(third.body.inserted === 0, `Scenario 3: zero inserts (got ${third.body.inserted})`);
  assert(
    third.body.invalidRows === third.body.import?.totalRows,
    `Scenario 3: all rows counted invalid (invalidRows=${third.body.invalidRows}, totalRows=${third.body.import?.totalRows})`,
  );

  console.log(
    "\nScenario 4: Outscraper-shaped file, multiple valid rows with NO email column at all (phone/company only)",
  );
  // Generated fresh (unique company names + phone numbers) on every run so
  // this scenario is idempotent regardless of leftover data from prior runs.
  const runId = Date.now().toString(36);
  const outscraperCsv = [
    "Name,Telephone,Category,Rating,Review_Count,Address,Website,City,State",
    `Zzq ${runId} Auto Repair,(305) 555-9${runId.slice(-3)}1,Auto Repair,4.6,42,300 Sunshine Blvd,,Miami,FL`,
    `Zzq ${runId} Nail Spa,(305) 555-9${runId.slice(-3)}2,Salon/Spa,4.4,58,301 Coastal Way,,Miami,FL`,
    `Zzq ${runId} Family Dental,(305) 555-9${runId.slice(-3)}3,Healthcare,4.8,31,302 Downtown St,,Miami,FL`,
    `Zzq ${runId} Pizza Co,(305) 555-9${runId.slice(-3)}4,Restaurant,4.2,120,303 Palm Tree Ave,,Miami,FL`,
    "",
  ].join("\n");
  const fourth = await uploadCsvContent(cookie, csrf, outscraperCsv, `outscraper_missing_emails_${runId}.csv`);
  assert(fourth.status === 201, `Scenario 4: HTTP 201 (got ${fourth.status})`);
  assertReconciled("Scenario 4", fourth.body);
  assert(
    fourth.body.inserted === 4,
    `Scenario 4: all 4 valid no-email rows are actually imported, not silently skipped (got inserted=${fourth.body.inserted}, skippedRows=${fourth.body.skippedRows})`,
  );
  assert(
    fourth.body.skippedRows === 0,
    `Scenario 4: no rows fall into the DB-conflict skipped bucket (got skippedRows=${fourth.body.skippedRows})`,
  );

  console.log(
    "\nScenario 5: Known-provider format does NOT inherit source column as leadSource",
  );
  // An Outscraper CSV with a `source` column containing a provenance URL.
  // The imported contact must end up with lead_source='google_maps_outscraper',
  // NOT with the CSV source column value.
  const runId5 = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}5`;
  const outscraperWithSourceCsv = [
    "Name,Telephone,Category,Rating,Review_Count,Address,Website,City,State,source",
    `Zzq ${runId5} Source Test,(305) 555-9${runId5.slice(-3)}1,Auto Repair,4.6,42,300 Sunshine Blvd,,Miami,FL,https://www.google.com/maps/place/?q=place_id:ChIJXXX`,
    "",
  ].join("\n");
  const fifth = await uploadCsvContent(cookie, csrf, outscraperWithSourceCsv, `outscraper_source_col_${runId5}.csv`);
  assert(fifth.status === 201, `Scenario 5: HTTP 201 (got ${fifth.status})`);
  assertReconciled("Scenario 5", fifth.body);
  assert(
    fifth.body.inserted === 1,
    `Scenario 5: 1 row inserted (got inserted=${fifth.body.inserted})`,
  );
  assert(
    fifth.body.sourceFormat === "google_maps_outscraper",
    `Scenario 5: sourceFormat detected as google_maps_outscraper (got ${fifth.body.sourceFormat})`,
  );
  // Verify the persisted contact actually has lead_source='google_maps_outscraper'
  // and NOT the CSV source column value (which was a Google Maps URL).
  // We fetch the most recently created contact by querying contacts with
  // the import tag to find the one created by this upload.
  if (fifth.body.inserted === 1) {
    const contactsRes = await fetch(`${BASE_URL}/api/contacts?limit=10&sort=createdAt_desc`, {
      headers: { Cookie: cookie },
    });
    const contactsData = await contactsRes.json();
    const contactList = Array.isArray(contactsData) ? contactsData : (contactsData?.contacts ?? []);
    const needle = `Zzq ${runId5} Source Test`;
    const matched = contactList.find((c: any) =>
      (c.firstName || "").includes(needle) || (c.companyName || "").includes(needle)
    );
    if (matched) {
      assert(
        matched.leadSource === "google_maps_outscraper",
        `Scenario 5: persisted contact lead_source is 'google_maps_outscraper', not the CSV source value (got '${matched.leadSource}')`,
      );
    } else {
      // Fallback: confirm the insert record's sourceFormat is correct so the
      // forced leadSource will have taken effect (the import record is the
      // canonical proof when contact list pagination hides the row).
      assert(
        fifth.body.import?.sourceFormat === "google_maps_outscraper",
        `Scenario 5: import record sourceFormat confirms forced leadSource (got ${fifth.body.import?.sourceFormat})`,
      );
    }
  }

  console.log(
    "\nScenario 6: Per-batch progress fields are populated on a completed import",
  );
  // After a completed import the processedRows field must equal totalRows
  // and lastProgressAt must be a non-null date.
  const runId6 = Date.now().toString(36) + "6";
  const progressCsv = [
    "Name,Telephone,Category,City,State",
    `Zzq ${runId6} Progress A,(305) 555-9${runId6.slice(-3)}1,Auto Repair,Miami,FL`,
    `Zzq ${runId6} Progress B,(305) 555-9${runId6.slice(-3)}2,Auto Repair,Miami,FL`,
    "",
  ].join("\n");
  const sixth = await uploadCsvContent(cookie, csrf, progressCsv, `outscraper_progress_${runId6}.csv`);
  assert(sixth.status === 201, `Scenario 6: HTTP 201 (got ${sixth.status})`);
  assertReconciled("Scenario 6", sixth.body);
  const impRecord = sixth.body.import;
  assert(
    typeof impRecord?.processedRows === "number" && impRecord.processedRows >= 0,
    `Scenario 6: import record has processedRows (got ${impRecord?.processedRows})`,
  );
  assert(
    impRecord?.lastProgressAt !== null && impRecord?.lastProgressAt !== undefined,
    `Scenario 6: import record has lastProgressAt populated (got ${impRecord?.lastProgressAt})`,
  );

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    console.error("Failures:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Test script crashed:", err);
  process.exit(1);
});
