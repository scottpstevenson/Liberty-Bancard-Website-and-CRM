#!/usr/bin/env tsx
/**
 * Source-contract checks for task #2056's Sunbiz projection/read corrections.
 * These checks intentionally do not run bootstrap or enqueue a real crawl.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const bootstrap = readFileSync(resolve(root, "server/services/sunbiz-bootstrap.ts"), "utf8");
const backfill = readFileSync(resolve(root, "server/services/sunbiz-full-backfill.ts"), "utf8");
const leadOps = readFileSync(resolve(root, "server/routes/lead-ops.ts"), "utf8");
const analytics = readFileSync(resolve(root, "server/routes/analytics.ts"), "utf8");

let failures = 0;
function check(label: string, condition: boolean): void {
  if (condition) console.log(`✓ ${label}`);
  else {
    failures++;
    console.error(`✗ ${label}`);
  }
}

const projection = bootstrap.slice(
  bootstrap.indexOf("async function attachLineageAndProjectMissingFields"),
  bootstrap.indexOf("/**\n * Executes a bounded batch", bootstrap.indexOf("async function attachLineageAndProjectMissingFields")),
);
const recrawl = bootstrap.slice(
  bootstrap.indexOf("async function enqueueProjectedDomainRecrawl"),
  bootstrap.indexOf("function toResolverInput", bootstrap.indexOf("async function enqueueProjectedDomainRecrawl")),
);

check("filing lineage is locked and verified against the matched business", /FOR UPDATE/.test(projection) && /Number\(verifiedLineage\.business_id\) !== businessId/.test(projection));
check("lineage conflict returns before any business-field projection", /if \(!verifiedLineage[\s\S]*?return \{ lineageConflict: true/.test(projection));
check("domain and phone are filled only when absent, with cross-business conflict checks", /!currentDomain && !domainConflict/.test(projection) && /!currentPhoneDigits && !phoneConflict/.test(projection) && /id <> \$\{businessId\}/.test(projection));
check("projection is restricted to canonical businesses", /business\.record_class !== "canonical"/.test(projection) && /WHERE id = \$\{businessId\} AND record_class = 'canonical'/.test(projection));
check("a projected domain queues the existing free-only handler, not a paid provider", /free-contact-enrichment/.test(recrawl) && /QUEUE_NAMES\.ENRICHMENT/.test(recrawl) && !/Serper|Apollo|Outscraper|ZeroBounce/.test(recrawl));
check("recrawl enqueue failure is explicit and does not run inline", /"queue_unavailable" \| "enqueue_failed"/.test(recrawl) && /return "enqueue_failed"/.test(recrawl));
check("full-backfill status uses a bounded sample and exposes floor/unavailable states", /REMAINING_COUNT_SAMPLE_CAP = 5000/.test(backfill) && /statement_timeout = '2500ms'/.test(backfill) && /remainingEligibleIsFloor/.test(backfill) && /remainingEligibleAvailable/.test(backfill));
check("Lead Ops aggregate stats time out explicitly rather than returning fabricated zero", /statement_timeout = '2500ms'/.test(leadOps) && /statsAvailable: stats !== null/.test(leadOps) && /verticalsAvailable: verticals !== null/.test(leadOps));
check("bootstrap status uses bounded candidate selection instead of a global anti-join MIN", /selectSunbizBootstrapCandidateWindow\(1, \{ geography: "any" \}\)/.test(leadOps) && !/SELECT MIN\(se\.id\)::int AS next_entity_id/.test(leadOps));
check("lifecycle ordering avoids integer-casting the aggregate alias and unavailable is distinct from zero", /ORDER BY COUNT\(\*\) DESC, lifecycle_state NULLS LAST/.test(analytics) && /distribution: null,[\s\S]*available: false/.test(analytics));

if (failures) process.exitCode = 1;
else console.log("Sunbiz projection/read source-contract checks passed.");