/**
 * Smoke test: SDR canonical business linking logic.
 *
 * Usage:
 *   npx tsx scripts/test-sdr-canonical-linking.ts
 */

import { storage } from "../server/storage";
import { db } from "../server/db";
import { businesses } from "../shared/schema";
import { eq, sql } from "drizzle-orm";

const TEST_DOMAIN = "test-domain-xyz-699.com";
const TEST_NAME = "Test Biz";
const TEST_CITY = "Miami";
const TEST_STATE = "FL";
const TEST_NORMALIZED = "test biz";

let pass = 0;
let fail = 0;

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    pass++;
  } else {
    console.error(`  ✗ ${label}${detail ? `: ${detail}` : ""}`);
    fail++;
  }
}

async function cleanup() {
  await db.delete(businesses).where(eq(businesses.websiteDomain, TEST_DOMAIN));
}

async function main() {
  console.log("=== SDR Canonical Business Linking Smoke Test ===\n");

  await cleanup();

  console.log("(a) findOrCreateBusinessForMerchant with domain (new):");
  const biz1 = await storage.findOrCreateBusinessForMerchant(TEST_DOMAIN, TEST_NAME, TEST_CITY, TEST_STATE);
  assert("returns a businesses row", biz1 !== null);
  assert("has correct websiteDomain", biz1?.websiteDomain === TEST_DOMAIN);
  assert("has correct canonicalName", biz1?.canonicalName === TEST_NAME);
  const id1 = biz1?.id;

  console.log("\n(b) findOrCreateBusinessForMerchant with same domain (idempotent):");
  const biz2 = await storage.findOrCreateBusinessForMerchant(TEST_DOMAIN, TEST_NAME, TEST_CITY, TEST_STATE);
  assert("returns same id (no new row)", biz2?.id === id1, `expected ${id1}, got ${biz2?.id}`);

  console.log("\n(c) findOrCreateBusinessForMerchant with null domain + no pre-existing match:");
  await db.delete(businesses).where(eq(businesses.websiteDomain, "does-not-exist-xyz-699.com"));
  const biz3 = await storage.findOrCreateBusinessForMerchant(null, "Test Biz No Domain", TEST_CITY, TEST_STATE);
  assert("returns null (no row created)", biz3 === null);

  const countNoDomain = await db.execute(sql`SELECT COUNT(*) FROM businesses WHERE canonical_name = 'Test Biz No Domain'`);
  assert("no row inserted for null-domain + no match", Number((countNoDomain.rows[0] as any).count) === 0);

  console.log("\n(d) getBusinessByNormalizedNameCity returns the row created in (a):");
  const byName = await storage.getBusinessByNormalizedNameCity(TEST_NORMALIZED, TEST_CITY, TEST_STATE);
  assert("found by normalizedName + city + state", byName !== undefined);
  assert("matches correct id", byName?.id === id1);

  console.log("\n(e) Unique domain count in DB:");
  const domainCount = await db.execute(sql`SELECT COUNT(*) FROM businesses WHERE website_domain = ${TEST_DOMAIN}`);
  assert("exactly 1 row for test domain", Number((domainCount.rows[0] as any).count) === 1);

  await cleanup();

  console.log(`\n=== Results: ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
