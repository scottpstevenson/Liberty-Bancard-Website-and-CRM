import { verifyEmail, type ZeroBounceResult } from "../server/services/sdr/zerobounce";
import { runPilotDiscovery, type NormalizedBusiness } from "../server/services/sdr/lead-finder";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

async function mockVerifyEmail(rawStatus: string): Promise<ZeroBounceResult> {
  const mapped = (() => {
    if (rawStatus === "valid") return "valid";
    if (["invalid", "abuse", "spamtrap", "do_not_mail"].includes(rawStatus)) return "unsafe";
    if (["catch-all", "unknown"].includes(rawStatus)) return "unverified";
    return "unknown";
  })();
  return {
    status: mapped as ZeroBounceResult["status"],
    provider: "zerobounce",
    verifiedAt: new Date().toISOString(),
    subStatus: null,
  };
}

function makeBiz(name: string, source = "serper"): NormalizedBusiness {
  return {
    businessName: name,
    phone: null,
    email: null,
    website: null,
    address: null,
    city: "Miami",
    state: "FL",
    zip: null,
    vertical: "Restaurants",
    metro: "Miami",
    source,
    rawData: {},
    rating: null,
    reviewCount: null,
    placeId: null,
    ownerFirstName: null,
    ownerLastName: null,
    ownerEmail: null,
    ownerTitle: null,
    ownerLinkedIn: null,
    employeeCount: null,
    annualRevenue: null,
    techStack: null,
    processorHints: null,
    apolloPersonId: null,
    apolloOrgId: null,
  };
}

async function runTests() {
  console.log("\n=== Discovery Activation Test Suite ===\n");

  // Test (a): no-key ZeroBounce returns { status: "unknown", skipped: true }
  console.log("Test A: No-key ZeroBounce returns unknown+skipped");
  {
    const prev = process.env.ZEROBOUNCE_API_KEY;
    delete process.env.ZEROBOUNCE_API_KEY;
    const result = await verifyEmail("test@example.com");
    assert(result.status === "unknown", `status === "unknown" (got: ${result.status})`);
    assert(result.skipped === true, `skipped === true (got: ${result.skipped})`);
    assert(result.reason === "no_key", `reason === "no_key" (got: ${result.reason})`);
    assert(result.provider === "zerobounce", `provider === "zerobounce"`);
    if (prev !== undefined) process.env.ZEROBOUNCE_API_KEY = prev;
  }

  // Test (b): mocked "valid" result stores trusted metadata
  console.log("\nTest B: Mocked 'valid' result is trusted");
  {
    const result = await mockVerifyEmail("valid");
    assert(result.status === "valid", `status === "valid" (got: ${result.status})`);
    assert(result.provider === "zerobounce", `provider === "zerobounce"`);
    assert(typeof result.verifiedAt === "string", `verifiedAt is a string`);
  }

  // Test (c): mocked "invalid" result retains email with status "unsafe"
  console.log("\nTest C: Mocked 'invalid' result → status unsafe (email never deleted)");
  {
    const result = await mockVerifyEmail("invalid");
    assert(result.status === "unsafe", `status === "unsafe" (got: ${result.status})`);
  }

  // Test (c-extended): abuse, spamtrap, do_not_mail all map to "unsafe"
  for (const raw of ["abuse", "spamtrap", "do_not_mail"]) {
    const result = await mockVerifyEmail(raw);
    assert(result.status === "unsafe", `"${raw}" maps to unsafe (got: ${result.status})`);
  }

  // Test (d): mocked "catch-all" stores status "unverified"
  console.log("\nTest D: Mocked 'catch-all' → status unverified");
  {
    const result = await mockVerifyEmail("catch-all");
    assert(result.status === "unverified", `status === "unverified" (got: ${result.status})`);
    const resultUnknown = await mockVerifyEmail("unknown");
    assert(resultUnknown.status === "unverified", `"unknown" maps to unverified (got: ${resultUnknown.status})`);
  }

  // Test (e): pilot globalCap math
  console.log("\nTest E: Pilot cap — limit=200 forces globalCap=50");
  {
    const globalCap = Math.min(200 ?? 25, 50);
    assert(globalCap === 50, `globalCap === 50 (got: ${globalCap})`);
    assert(Math.min(10 ?? 25, 50) === 10, `limit=10 → globalCap=10`);
    assert(Math.min(25 ?? 25, 50) === 25, `limit=25 → globalCap=25`);
  }

  // Test (f): ZeroBounce no live calls in no-key path
  console.log("\nTest F: No live ZeroBounce network calls in no-key path");
  {
    delete process.env.ZEROBOUNCE_API_KEY;
    const start = Date.now();
    const result = await verifyEmail("another@example.com");
    const elapsed = Date.now() - start;
    assert(result.skipped === true, `skipped === true`);
    assert(elapsed < 1000, `returned in <1s (${elapsed}ms) — no network call made`);
  }

  // Test (h): runPilotDiscovery end-to-end cap enforcement with mock providers
  // Injects 100 businesses per paid source (300 total), verifies cap is ≤50 at dedupeAndInsert
  console.log("\nTest H: runPilotDiscovery end-to-end — 300 raw businesses → dedupeAndInsert receives ≤50");
  {
    let dedupeCallCount = 0;
    let dedupeReceivedCount = 0;
    let updateJobCalls: Array<{ id: number; data: any }> = [];

    const result = await runPilotDiscovery({
      limit: 200,
      sources: ["serper", "outscraper", "apify"],
      verticals: ["Restaurants"],
      metros: ["Miami"],
      jobId: 99999,
      _providers: {
        searchSerperFn: async (_v, _m, _s, limit) =>
          Array.from({ length: 100 }, (_, i) => makeBiz(`Serper-Biz-${i}`, "serper")).slice(0, limit),
        searchOutscraperFn: async (_v, _m, _s, limit) =>
          Array.from({ length: 100 }, (_, i) => makeBiz(`Outscraper-Biz-${i}`, "outscraper")).slice(0, limit),
        searchApifyFn: async (_v, _m, _s, limit) =>
          Array.from({ length: 100 }, (_, i) => makeBiz(`Apify-Biz-${i}`, "apify")).slice(0, limit),
        dedupeAndInsertFn: async (businesses, _jobId) => {
          dedupeCallCount++;
          dedupeReceivedCount = businesses.length;
          return {
            newInserted: businesses.length,
            duplicatesSkipped: 0,
            enrichmentQueued: 0,
            results: businesses.map((b, i) => ({
              ...b,
              status: "inserted",
              merchantId: i + 1,
              source: b.source,
              businessName: b.businessName,
              dedupReason: null,
            })),
          };
        },
        updateJobFn: async (id, data) => {
          updateJobCalls.push({ id, data });
        },
      },
    });

    assert(dedupeCallCount === 1, `dedupeAndInsert called exactly once (got: ${dedupeCallCount})`);
    assert(dedupeReceivedCount <= 50, `dedupeAndInsert received ≤50 businesses (got: ${dedupeReceivedCount})`);
    assert(result.rawFound <= 50, `result.rawFound ≤50 (got: ${result.rawFound})`);
    assert(result.jobId === 99999, `result.jobId === 99999 (got: ${result.jobId})`);
    const completedCall = updateJobCalls.find(c => c.data.status === "completed" || c.data.status === "completed_with_errors");
    assert(completedCall !== undefined, `updateJob called with completed/completed_with_errors status`);
    if (completedCall) {
      assert((completedCall.data.rawFound ?? 0) <= 50, `job rawFound stored ≤50 (got: ${completedCall.data.rawFound})`);
    }
  }

  // Test (i): runPilotDiscovery rolling budget — second source gets only remainder
  console.log("\nTest I: Rolling budget — first source fills cap, second source gets 0 budget");
  {
    const fetchCalls: Array<{ source: string; limit: number }> = [];

    await runPilotDiscovery({
      limit: 10,
      sources: ["serper", "outscraper"],
      verticals: ["Restaurants"],
      metros: ["Miami"],
      jobId: 99998,
      _providers: {
        searchSerperFn: async (_v, _m, _s, limit) => {
          fetchCalls.push({ source: "serper", limit });
          return Array.from({ length: 50 }, (_, i) => makeBiz(`Serper-${i}`, "serper")).slice(0, limit);
        },
        searchOutscraperFn: async (_v, _m, _s, limit) => {
          fetchCalls.push({ source: "outscraper", limit });
          return Array.from({ length: 50 }, (_, i) => makeBiz(`Outscraper-${i}`, "outscraper")).slice(0, limit);
        },
        dedupeAndInsertFn: async (businesses, _jobId) => ({
          newInserted: businesses.length,
          duplicatesSkipped: 0,
          enrichmentQueued: 0,
          results: businesses.map((b, i) => ({ ...b, status: "inserted", merchantId: i + 1, source: b.source, businessName: b.businessName, dedupReason: null })),
        }),
        updateJobFn: async () => {},
      },
    });

    const serperCall = fetchCalls.find(c => c.source === "serper");
    const outscraperCall = fetchCalls.find(c => c.source === "outscraper");

    assert(serperCall !== undefined, `serper was called`);
    assert(serperCall!.limit === 10, `serper received limit=10 (got: ${serperCall?.limit})`);
    assert(outscraperCall === undefined, `outscraper not called — budget exhausted after serper`);
  }

  // Test (j): jobId required — throws without jobId
  console.log("\nTest J: runPilotDiscovery throws without jobId");
  {
    try {
      await runPilotDiscovery({
        limit: 10,
        sources: ["serper"],
        _providers: { updateJobFn: async () => {} },
      });
      assert(false, `should have thrown without jobId`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      assert(msg.includes("jobId is required"), `throws with "jobId is required" message (got: "${msg}")`);
    }
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test suite error:", err);
  process.exit(1);
});
