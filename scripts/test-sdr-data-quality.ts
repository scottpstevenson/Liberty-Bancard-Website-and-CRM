#!/usr/bin/env npx tsx
/**
 * Smoke test for SDR Data Quality + Processor Detector hardening.
 * Zero live HTTP calls — all assertions use in-memory fixture data or a real DB.
 * Exit 0 = pass, Exit 1 = fail.
 */

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// 1. PROCESSOR_FINGERPRINTS count >= 24
// ---------------------------------------------------------------------------
async function testFingerprintCount() {
  console.log("\n[1] PROCESSOR_FINGERPRINTS count");

  const mod = await import("../server/services/sdr/processor-detector");
  const { detectFromHtml } = mod;

  assert(typeof detectFromHtml === "function", "detectFromHtml is exported");

  const { readFileSync } = await import("fs");
  const src = readFileSync("server/services/sdr/processor-detector.ts", "utf8");
  const vendorCount = (src.match(/vendor:/g) || []).length;
  assert(vendorCount >= 24, `PROCESSOR_FINGERPRINTS has >= 24 entries (found ${vendorCount})`);
}

// ---------------------------------------------------------------------------
// 2. detectFromHtml with Square + Stripe fixture
// ---------------------------------------------------------------------------
async function testDetectFromHtmlSquareStripe() {
  console.log("\n[2] detectFromHtml — Square + Stripe fixture");

  const { detectFromHtml } = await import("../server/services/sdr/processor-detector");

  const cannedHtml = `
    <html>
      <head>
        <script src="https://js.stripe.com/v3/"></script>
        <script src="https://squarecdn.com/square-payment-flow.js"></script>
      </head>
      <body>
        <div class="sq-payment-form">Pay with Square</div>
        <div class="stripe-elements">Powered by Stripe</div>
      </body>
    </html>
  `;

  const results = detectFromHtml(cannedHtml);
  const vendors = results.map(r => r.vendor);
  assert(vendors.includes("Square"), "Square detected from canned HTML", `vendors=${vendors.join(",")}`);
  assert(vendors.includes("Stripe"), "Stripe detected from canned HTML", `vendors=${vendors.join(",")}`);
  assert(results.length >= 2, `At least 2 detections (got ${results.length})`);
}

// ---------------------------------------------------------------------------
// 3. detectFromHtml with Toast fixture
// ---------------------------------------------------------------------------
async function testDetectFromHtmlToast() {
  console.log("\n[3] detectFromHtml — Toast Go fixture");

  const { detectFromHtml } = await import("../server/services/sdr/processor-detector");

  const toastHtml = `
    <html>
      <head>
        <script src="https://pos.toasttab.com/static/js/app.js"></script>
      </head>
      <body>
        <p>Order on Toast</p>
        <a href="https://www.toasttab.com/order">Toast Online Ordering</a>
        <span>Toast Go</span>
      </body>
    </html>
  `;

  const results = detectFromHtml(toastHtml);
  const vendors = results.map(r => r.vendor);
  assert(
    vendors.includes("Toast") || vendors.includes("Toast Go"),
    "Toast detected from canned HTML",
    `vendors=${vendors.join(",")}`
  );
}

// ---------------------------------------------------------------------------
// 4. Suppression guard — stage=SUPPRESSED — via actual dedupeAndInsertFree
// ---------------------------------------------------------------------------
async function testSuppressionGuardSuppressed() {
  console.log("\n[4] Suppression guard — SUPPRESSED stage (via dedupeAndInsertFree)");

  const { db } = await import("../server/db");
  const { sdrMerchants, sdrLeadState } = await import("@shared/schema");
  const { sql } = await import("drizzle-orm");

  const ts = Date.now();
  const suppName = `SmokeTest_Suppressed_${ts}`;

  const [m] = await db.insert(sdrMerchants).values({
    businessName: suppName,
    doNotContactFlag: false,
    source: "smoke_test",
    city: "Miami",
    state: "FL",
  }).returning();

  const [ls] = await db.insert(sdrLeadState).values({
    merchantId: m.id,
    stage: "SUPPRESSED",
    currentStage: "SUPPRESSED",
    companyName: suppName,
    statusReason: "human_suppressed",
  }).returning();

  const { dedupeAndInsertFree } = await import("../server/services/sdr/lead-finder");

  const result = await dedupeAndInsertFree([{
    businessName: suppName,
    phone: null,
    email: null,
    website: null,
    address: null,
    city: "Miami",
    state: "FL",
    zip: null,
    vertical: "restaurant",
    metro: "Miami",
    source: "smoke_test_rerun",
    rawData: {},
    rating: null,
    reviewCount: null,
    placeId: null,
  }]);

  assert(
    result.duplicatesSkipped >= 1,
    "SUPPRESSED merchant causes duplicate skip (suppressed_skip)",
    `duplicatesSkipped=${result.duplicatesSkipped}, newInserted=${result.newInserted}`
  );
  assert(result.newInserted === 0, "No new merchant inserted for SUPPRESSED match");

  await db.delete(sdrLeadState).where(sql`${sdrLeadState.id} = ${ls.id}`);
  await db.delete(sdrMerchants).where(sql`${sdrMerchants.id} = ${m.id}`);
}

// ---------------------------------------------------------------------------
// 5. Suppression guard — stage=DEAD — via actual dedupeAndInsertFree
// ---------------------------------------------------------------------------
async function testSuppressionGuardDead() {
  console.log("\n[5] Suppression guard — DEAD stage (via dedupeAndInsertFree)");

  const { db } = await import("../server/db");
  const { sdrMerchants, sdrLeadState } = await import("@shared/schema");
  const { sql } = await import("drizzle-orm");

  const ts = Date.now();
  const deadName = `SmokeTest_Dead_${ts}`;

  const [m] = await db.insert(sdrMerchants).values({
    businessName: deadName,
    doNotContactFlag: false,
    source: "smoke_test",
    city: "Tampa",
    state: "FL",
  }).returning();

  const [ls] = await db.insert(sdrLeadState).values({
    merchantId: m.id,
    stage: "DEAD",
    currentStage: "DEAD",
    companyName: deadName,
  }).returning();

  const { dedupeAndInsertFree } = await import("../server/services/sdr/lead-finder");

  const result = await dedupeAndInsertFree([{
    businessName: deadName,
    phone: null,
    email: null,
    website: null,
    address: null,
    city: "Tampa",
    state: "FL",
    zip: null,
    vertical: "restaurant",
    metro: "Tampa",
    source: "smoke_test_rerun",
    rawData: {},
    rating: null,
    reviewCount: null,
    placeId: null,
  }]);

  assert(
    result.duplicatesSkipped >= 1,
    "DEAD merchant causes duplicate skip (suppressed_skip)",
    `duplicatesSkipped=${result.duplicatesSkipped}, newInserted=${result.newInserted}`
  );
  assert(result.newInserted === 0, "No new merchant inserted for DEAD match");

  await db.delete(sdrLeadState).where(sql`${sdrLeadState.id} = ${ls.id}`);
  await db.delete(sdrMerchants).where(sql`${sdrMerchants.id} = ${m.id}`);
}

// ---------------------------------------------------------------------------
// 6. getContactByPhone — positive match
// ---------------------------------------------------------------------------
async function testGetContactByPhoneMatch() {
  console.log("\n[6] getContactByPhone — positive match");

  const { db } = await import("../server/db");
  const { contacts } = await import("@shared/schema");
  const { sql } = await import("drizzle-orm");

  const [c] = await db.insert(contacts).values({
    firstName: "SmokeTest",
    lastName: "PhoneMatch",
    email: `smoke_phone_${Date.now()}@test.invalid`,
    phone: "(954) 555-0100",
  }).returning();

  const { storage } = await import("../server/storage");

  const found = await storage.getContactByPhone("+1 954 555 0100");
  assert(found !== null && found?.id === c.id, "getContactByPhone finds contact by +1 954 555 0100", `found=${JSON.stringify(found?.id)}`);

  const found2 = await storage.getContactByPhone("9545550100");
  assert(found2 !== null && found2?.id === c.id, "getContactByPhone finds contact by raw 10-digit", `found=${JSON.stringify(found2?.id)}`);

  await db.delete(contacts).where(sql`${contacts.id} = ${c.id}`);
}

// ---------------------------------------------------------------------------
// 7. getContactByPhone — no match, returns null (no throw)
// ---------------------------------------------------------------------------
async function testGetContactByPhoneNoMatch() {
  console.log("\n[7] getContactByPhone — no match returns null");

  const { storage } = await import("../server/storage");

  let result: unknown = "NOT_RUN";
  let threw = false;
  try {
    result = await storage.getContactByPhone("0000000000");
  } catch {
    threw = true;
  }
  assert(!threw, "getContactByPhone does not throw on no match");
  assert(result === null, `getContactByPhone returns null for unknown phone (got ${JSON.stringify(result)})`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("=== SDR Data Quality Smoke Test ===");

  await testFingerprintCount();
  await testDetectFromHtmlSquareStripe();
  await testDetectFromHtmlToast();
  await testSuppressionGuardSuppressed();
  await testSuppressionGuardDead();
  await testGetContactByPhoneMatch();
  await testGetContactByPhoneNoMatch();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch(err => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});
