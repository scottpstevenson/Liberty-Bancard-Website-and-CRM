#!/usr/bin/env npx tsx
/**
 * ci-suite-manifest.ts — Capability-classified CI suite manifest
 *
 * Classifies every suite registered in pre-deploy.ts MANDATORY_SUITES into
 * one of four capability tiers. CI jobs must only run suites appropriate for
 * their tier — required suites cannot be omitted, skipped, or substituted
 * without a documented capability gate change here.
 *
 * Capability tiers:
 *   deterministic-static      — pure-function / AST scan; no server, no DB,
 *                               no network. Always deterministic. Runs in the
 *                               CI `static` job.
 *   deterministic-integration — requires disposable PostgreSQL and/or Redis;
 *                               no live provider calls. GHL is blocked via
 *                               GHL_TRANSPORT_FAILFAST=true. Runs in the CI
 *                               `integration` job.
 *   server-required           — needs a running dev server at localhost:5000
 *                               AND a live database. Hard-fails if server is
 *                               not reachable. Runs in CI `integration` job
 *                               after server startup.
 *   server-optional           — needs a running server but is skipped (not
 *                               failed) when the server is absent. These suites
 *                               test live-mode provider integrations (OpenAI,
 *                               GHL, etc.) that require real credentials. NOT
 *                               run in automated CI; must be run by an operator
 *                               with live credentials before each production deploy.
 *
 * Provider denial controls (deterministic suites only):
 *   GHL         — GHL_TRANSPORT_FAILFAST=true installs the server-level fail-fast
 *                 transport; any real GHL call throws TestTransportError.
 *                 Verified by test-forms.ts via /api/health.
 *   Serper      — Covered by SERPER_GATEWAY_ENABLED flag and scan-serper-raw-fetch.ts.
 *   OpenAI      — Not called in deterministic suites (AI boundaries are server-optional).
 *   SMTP        — Not called by suites (SMTP sends go through gated compliance paths
 *                 which are themselves gated by outboundGlobalPaused=true).
 *   Sunbiz      — Blocked by SUNBIZ_ENRICHMENT_ENABLED=false default in test env.
 *
 * Runner guarantees:
 *   - pre-deploy.ts verifies outboundGlobalPaused=true before and after every suite.
 *   - All suites are run as child processes (spawnSync) — no shared in-process state.
 *   - Required suites exit nonzero to fail the parent gate; cannot be silently skipped.
 *
 * Usage (self-validation):
 *   npx tsx scripts/ci-suite-manifest.ts [--check]
 *   --check: exits nonzero if the manifest is inconsistent.
 */

import fs from "fs";
import path from "path";

export type SuiteCapability =
  | "deterministic-static"
  | "deterministic-integration"
  | "server-required"
  | "server-optional";

export interface SuiteManifestEntry {
  name: string;
  script: string;
  capability: SuiteCapability;
  /** For server-optional: why real credentials are needed */
  providerNote?: string;
  /** For deterministic suites: which providers are denied and how */
  providerDenial?: string;
}

export const SUITE_MANIFEST: SuiteManifestEntry[] = [
  // ── deterministic-static ─────────────────────────────────────────────────
  {
    name: "BT-12 Revenue State Reconciliation Authority Guard",
    script: "scripts/test-bt12-revenue-state-reconciliation.ts",
    capability: "deterministic-static",
    providerDenial: "source-backed authority guard; no providers",
  },
  {
    name: "Fresh Snapshot Completion Guard",
    script: "scripts/test-fresh-snapshot-completion.ts",
    capability: "deterministic-static",
    providerDenial: "pure migration-boundary behavior with a fake SQL client; no providers or database",
  },
  {
    name: "BT-12 Revenue State Reconciliation Integration",
    script: "scripts/test-bt12-revenue-state-reconciliation-integration.ts",
    capability: "deterministic-integration",
    providerDenial: "requires TEST_DATABASE_URL disposable database; no provider transports are constructed",
  },
  {
    name: "Canonical Identity Writer Guard",
    script: "scripts/check-contact-identity-writers.ts",
    capability: "deterministic-static",
    providerDenial: "source-only transactional writer ownership scan",
  },
  {
    name: "Canonical Intake Authority",
    script: "scripts/test-canonical-intake-authority.ts",
    capability: "deterministic-static",
    providerDenial: "source-backed authority boundary checks; no providers",
  },
  {
    name: "CSV Import Reconciliation",
    script: "scripts/test-import-reconciliation.ts",
    capability: "server-required",
    providerDenial: "server-backed import fixtures; outbound providers are fail-closed",
  },
  {
    name: "Canonical Merge Manifest Guard",
    script: "scripts/check-contact-merge-manifest.ts",
    capability: "deterministic-integration",
    providerDenial: "PostgreSQL catalog inspection only; no providers",
  },
  {
    name: "Canonical Identity Merge Contract",
    script: "scripts/test-canonical-identity-merge.ts",
    capability: "deterministic-integration",
    providerDenial: "GHL_TRANSPORT_FAILFAST=true; no provider calls",
  },
  {
    name: "Migration Integrity Check",
    script: "scripts/check-migration-integrity.ts",
    capability: "deterministic-static",
    providerDenial: "none (pure file scan)",
  },
  {
    name: "Root Dependency Policy",
    script: "scripts/check-dependency-policy.ts",
    capability: "deterministic-static",
    providerDenial: "offline root lock/source/integrity scan; no providers",
  },
  {
    name: "Dependency Policy Negative Fixtures",
    script: "scripts/test-dependency-policy-evidence.ts",
    capability: "deterministic-static",
    providerDenial: "synthetic lock fixtures only; no network or providers",
  },
  {
    name: "Dependency Lifecycle and Native Probes",
    script: "scripts/test-dependency-lifecycle.ts",
    capability: "deterministic-static",
    providerDenial: "loads local installed modules only; no network or providers",
  },
  {
    name: "Artifact Dependency Inventory Fixtures",
    script: "scripts/test-inventory-artifact-dependencies.ts",
    capability: "deterministic-static",
    providerDenial: "synthetic bundle source only; no network or providers",
  },
  {
    name: "Dependency Audit Policy",
    script: "scripts/dependency-audit-policy.ts",
    capability: "deterministic-integration",
    providerDenial: "public npm advisory registry only; no application providers",
  },
  {
    name: "Dependency Audit Policy Fixtures",
    script: "scripts/test-dependency-audit-policy.ts",
    capability: "deterministic-static",
    providerDenial: "synthetic audit JSON only; no network or providers",
  },
  {
    name: "Provider Manifest and Readiness Kill Lines",
    script: "scripts/test-provider-readiness-controls.ts",
    capability: "deterministic-static",
    providerDenial: "pure manifest and eligibility decisions; no transport is constructed",
  },
  {
    name: "Paid Provider Adapter Scan",
    script: "scripts/scan-paid-provider-adapters.ts",
    capability: "deterministic-static",
    providerDenial: "source-only URL/import scanner; no providers",
  },
  {
    name: "Tracked-File Exposure Scan",
    script: "scripts/scan-tracked-files.ts",
    capability: "deterministic-static",
    providerDenial: "none (pure file scan)",
  },
  {
    name: "Tracked-File Exposure Scanner Regression",
    script: "scripts/test-scan-tracked-files.ts",
    capability: "deterministic-static",
    providerDenial: "synthetic local Git repositories only; no database, network, or provider transports",
  },
  {
    name: "CSP, CORS, JSON-LD Security Controls",
    script: "scripts/test-security-controls.ts",
    capability: "deterministic-static",
    providerDenial: "isolated Express fixture and pure renderer/source checks; no providers",
  },
  {
    name: "Release Artifact Gate",
    script: "scripts/release-artifact-gate.ts",
    capability: "deterministic-static",
    providerDenial: "local typecheck/build/artifact scan only; no provider calls",
  },
  {
    name: "Merchant Migration Safety",
    script: "scripts/test-merchant-migration-safety.ts",
    capability: "deterministic-static",
    providerDenial: "none (pure AST/file check)",
  },
  {
    name: "Compliance Scan",
    script: "scripts/compliance-scan.ts",
    capability: "deterministic-static",
    providerDenial: "none (pure AST/file scan)",
  },
  {
    name: "CSRF Fetch Scanner",
    script: "scripts/scan-csrf-fetch.ts",
    capability: "deterministic-static",
    providerDenial: "none (pure file scan)",
  },
  {
    name: "GHL Route Pause Gates",
    script: "scripts/test-ghl-route-pause-gates-1629.ts",
    capability: "deterministic-static",
    providerDenial: "none (pure code scan — no runtime calls)",
  },
  {
    name: "Sender Policy",
    script: "scripts/test-sender-policy.ts",
    capability: "deterministic-static",
    providerDenial: "none (pure code scan — no runtime calls)",
  },
  {
    name: "Serper Raw-Fetch Scan",
    script: "scripts/scan-serper-raw-fetch.ts",
    capability: "deterministic-static",
    providerDenial: "none (pure AST scan)",
  },
  {
    name: "API Coverage",
    script: "scripts/check-api-coverage.ts",
    capability: "deterministic-static",
    providerDenial: "none (pure file scan)",
  },
  {
    name: "Commercial Classification Static Gates",
    script: "scripts/test-commercial-classification-static.ts",
    capability: "deterministic-static",
    providerDenial: "none (pure authority, route, schema, and migration scan)",
  },
  {
    name: "Commercial Cleanup Guard",
    script: "scripts/test-cleanup-guard.ts",
    capability: "deterministic-static",
    providerDenial: "child processes refuse before any database mutation",
  },
  {
    name: "CRO-01 Revenue Contract Static",
    script: "scripts/test-cro01-revenue-contract-static.ts",
    capability: "deterministic-static",
    providerDenial: "source-only revenue authority contract; no provider transports",
  },

  // ── deterministic-integration (DB + optional Redis, no live providers) ───
  {
    name: "Serper Gateway",
    script: "scripts/test-serper-gateway.ts",
    capability: "deterministic-integration",
    providerDenial: "Serper: fake transports injected by test",
  },
  {
    name: "Sunbiz Timeout & Recovery",
    script: "scripts/test-sunbiz-timeout.ts",
    capability: "deterministic-integration",
    providerDenial: "Sunbiz: disposable PostgreSQL only; no real network",
  },
  {
    name: "Contactability Engine",
    script: "scripts/test-contactability.ts",
    capability: "deterministic-integration",
    providerDenial: "GHL: GHL_TRANSPORT_FAILFAST=true; SMTP: outboundGlobalPaused=true",
  },
  {
    name: "Commercial Classification",
    script: "scripts/test-commercial-classification.ts",
    capability: "deterministic-integration",
    providerDenial: "no provider calls; isolated Postgres only",
  },
  {
    name: "Intake Provenance",
    script: "scripts/test-intake-provenance.ts",
    capability: "deterministic-integration",
    providerDenial: "GHL: GHL_TRANSPORT_FAILFAST=true",
  },
  {
    name: "Speed-to-Lead Pipeline",
    script: "scripts/test-speed-to-lead.ts",
    capability: "deterministic-integration",
    providerDenial: "GHL: GHL_TRANSPORT_FAILFAST=true; outboundGlobalPaused=true",
  },
  {
    name: "Lifecycle State Machine",
    script: "scripts/test-lifecycle.ts",
    capability: "deterministic-integration",
    providerDenial: "no provider calls (lifecycle state transitions only)",
  },
  {
    name: "Transport Dispatch",
    script: "scripts/test-transport-dispatch.ts",
    capability: "deterministic-integration",
    providerDenial: "GHL: GHL_TRANSPORT_FAILFAST=true; SMTP: outboundGlobalPaused=true",
  },
  {
    name: "GHL Inbound Webhooks",
    script: "scripts/test-ghl-webhooks.ts",
    capability: "deterministic-integration",
    providerDenial: "GHL: no outbound calls (inbound webhook parsing only)",
  },
  {
    name: "GHL CRM Decoupling",
    script: "scripts/test-ghl-decoupling.ts",
    capability: "deterministic-integration",
    providerDenial: "GHL: shadow-mode test; GHL_TRANSPORT_FAILFAST=true",
  },
  {
    name: "Appointment-to-Statement",
    script: "scripts/test-appointment-statement.ts",
    capability: "deterministic-integration",
    providerDenial: "GHL: GHL_TRANSPORT_FAILFAST=true; SMTP: outboundGlobalPaused=true",
  },
  {
    name: "BullMQ Resilience",
    script: "scripts/test-bullmq-resilience.ts",
    capability: "deterministic-integration",
    providerDenial: "Redis: uses test prefix; no provider calls",
  },
  {
    name: "Queue Lease Fencing",
    script: "scripts/test-stale-job-lock.ts",
    capability: "deterministic-integration",
    providerDenial: "PostgreSQL registry rows use unique test job names; no providers",
  },
  {
    name: "Statement Command Durability",
    script: "server/tests/statement-command-worker.test.ts",
    capability: "deterministic-integration",
    providerDenial: "intentionally missing local files; statement chain and all providers are unreachable",
  },
  {
    name: "Redis Queue Topology",
    script: "scripts/test-redis-topology.ts",
    capability: "deterministic-integration",
    providerDenial: "Redis topology is inspected through an isolated test run; no providers",
  },
  {
    name: "Email Signature Coverage",
    script: "scripts/test-email-signatures.ts",
    capability: "deterministic-integration",
    providerDenial: "SMTP: outboundGlobalPaused=true (no real sends)",
  },
  {
    name: "Communication Arbitration",
    script: "scripts/test-arbitration.ts",
    capability: "deterministic-integration",
    providerDenial: "no provider calls (arbitration decision logic only)",
  },
  {
    name: "Channel Orchestrator",
    script: "scripts/test-channel-orchestrator.ts",
    capability: "deterministic-integration",
    providerDenial: "GHL: GHL_TRANSPORT_FAILFAST=true; transport: fake adapters",
  },
  {
    name: "Attrition Monitor Cooldown",
    script: "scripts/smoke-attrition-cooldown.ts",
    capability: "deterministic-integration",
    providerDenial: "no provider calls (DB suppression logic only)",
  },
  {
    name: "Backlog Preview",
    script: "scripts/test-backlog-preview.ts",
    capability: "deterministic-integration",
    providerDenial: "disposable PostgreSQL fixtures and injected source failures; no providers",
  },
  {
    name: "CRO-01 Revenue Contract Integration",
    script: "scripts/test-cro01-revenue-contract-integration.ts",
    capability: "deterministic-integration",
    providerDenial: "TEST_DATABASE_URL disposable PostgreSQL TEMP tables with rollback; no providers",
  },
  {
    name: "CRO-02 Classification Authority",
    script: "scripts/check-cro02-authority.ts",
    capability: "deterministic-static",
    providerDenial: "source-backed shadow authority check; no providers",
  },
  {
    name: "CRO-02 Graph and Import Integration",
    script: "scripts/test-cro02-integration.ts",
    capability: "deterministic-integration",
    providerDenial: "disposable database graph/import contract only; no providers",
  },
  {
    name: "CRO-02 HTTP Privacy and Provider Denial",
    script: "scripts/test-cro02-http.ts",
    capability: "server-required",
    providerDenial: "localhost contract only; no provider transport is invoked",
  },
  {
    name: "CRO-03 Durable Enrichment Factory",
    script: "scripts/test-cro03-static.ts",
    capability: "deterministic-static",
    providerDenial: "injected transports and source checks only; live provider/network transport denied",
  },
  {
    name: "CRO-03 Durable Enrichment Factory Concurrency and Recovery",
    script: "scripts/test-cro03-integration.ts",
    capability: "deterministic-integration",
    providerDenial: "disposable PostgreSQL and isolated Redis; provider and public-network transport denied by certification wrapper",
  },
  // ── server-required (live server + DB; hard-fails if server absent) ──────
  {
    name: "CRM Operator Experience",
    script: "scripts/test-crm-operator-experience.ts",
    capability: "server-required",
    providerDenial: "no provider calls (two-agent ownership fixture and response-contract regression scan)",
  },
  {
    name: "Sequence Compliance",
    script: "scripts/test-sequence-compliance.ts",
    capability: "server-required",
    providerDenial: "GHL: GHL_TRANSPORT_FAILFAST=true; SMTP: outboundGlobalPaused=true",
  },
  {
    name: "Sequence Terminalization Advisory-Lock Race",
    script: "scripts/test-sequence-terminalization-race.ts",
    capability: "deterministic-integration",
    providerDenial: "no provider calls (disposable DB race only)",
  },
  {
    name: "New-Lead Enrollment Policy",
    script: "scripts/test-new-lead-enrollment-policy.ts",
    capability: "server-required",
    providerDenial: "GHL: GHL_TRANSPORT_FAILFAST=true",
  },
  {
    name: "Role Guards",
    script: "scripts/smoke-role-guards.ts",
    capability: "server-required",
    providerDenial: "none (HTTP role-gate testing only)",
  },
  {
    name: "SEO Audit",
    script: "scripts/seo-audit.ts",
    capability: "server-required",
    providerDenial: "none (HTML crawl only)",
  },
  {
    name: "Statement Acquisition",
    script: "scripts/test-statement-acquisition.ts",
    capability: "server-required",
    providerDenial: "GHL: GHL_TRANSPORT_FAILFAST=true; SMTP: persisted pause",
  },
  {
    name: "NBA Engine",
    script: "scripts/test-nba.ts",
    capability: "server-required",
    providerDenial: "no provider calls (startup-initialized pause state + NBA decision engine only)",
  },
  {
    name: "Outbound Pause Authority",
    script: "scripts/test-outbound-pause-authority.ts",
    capability: "server-required",
    providerDenial: "no provider calls (startup-seeded pause-authority state machine only)",
  },
  {
    name: "Outbound Boundary Denial",
    script: "scripts/test-outbound-boundary-1626.ts",
    capability: "server-required",
    providerDenial: "GHL: dummy in-process config + rejecting fetch spy; SMTP: persisted pause",
  },
  {
    name: "Outbound Pause Fence",
    script: "scripts/test-pause-fence.ts",
    capability: "server-required",
    providerDenial: "no provider calls (startup-seeded pause-control rows only)",
  },
  {
    name: "CRO-01 Provider/Staging Denial",
    script: "scripts/test-cro01-provider-denial.ts",
    capability: "server-required",
    providerDenial: "localhost isolated-test-auth requests only; denied PUT returns before provider or queue work",
  },

  // ── server-optional (skipped when server absent; requires live credentials) ─
  {
    name: "Live Health Monitor",
    script: "scripts/test-live-health.ts",
    capability: "server-optional",
    providerNote: "Requires OpenAI key (AI probe) and live Redis; skip in CI",
  },
  {
    name: "Chat Business Hours",
    script: "scripts/test-chat-business-hours.ts",
    capability: "server-optional",
    providerNote: "Tests live-mode AI handoff timing; requires real server config",
  },
  {
    name: "AI Assistant Boundaries",
    script: "scripts/test-ai-assistant-boundaries.ts",
    capability: "server-optional",
    providerNote: "Tests live AI provider responses; requires OpenAI key",
  },
  {
    name: "Public Forms",
    script: "scripts/test-forms.ts",
    capability: "server-optional",
    providerNote: "GHL isolated via GHL_TRANSPORT_FAILFAST; requires ADMIN credentials",
  },
  {
    name: "Portfolio Scoping",
    script: "scripts/smoke-portfolio.ts",
    capability: "server-optional",
    providerNote: "Ownership boundary tests; requires ADMIN + agent credentials",
  },
  {
    name: "Go-Live Gate",
    script: "scripts/smoke-golive-gate.ts",
    capability: "server-optional",
    providerNote: "422 gate and admin override tests; requires ADMIN credentials",
  },
];

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Extract script paths from MANDATORY_SUITES in pre-deploy.ts.
 * Uses a simple regex over the source text; this avoids importing pre-deploy.ts
 * (which has side effects) while staying accurate for the `script: "..."` pattern
 * that every suite entry uses.
 */
function extractPreDeployScripts(): string[] {
  const preDeployPath = path.join(process.cwd(), "scripts", "pre-deploy.ts");
  if (!fs.existsSync(preDeployPath)) {
    throw new Error("scripts/pre-deploy.ts not found — cannot compare against MANDATORY_SUITES");
  }
  const src = fs.readFileSync(preDeployPath, "utf8");
  // Extract all `script: "..."` values within the MANDATORY_SUITES array.
  // Start extraction from MANDATORY_SUITES declaration; stop at the first `];`.
  const start = src.indexOf("MANDATORY_SUITES");
  if (start === -1) throw new Error("MANDATORY_SUITES not found in pre-deploy.ts");
  const end = src.indexOf("];", start);
  const suiteBlock = end !== -1 ? src.slice(start, end) : src.slice(start);
  const matches = [...suiteBlock.matchAll(/\bscript\s*:\s*"([^"]+)"/g)];
  return matches.map(m => m[1]);
}

function main() {
  const args = process.argv.slice(2);
  const checkMode = args.includes("--check");

  const byCapability = new Map<SuiteCapability, SuiteManifestEntry[]>();
  for (const suite of SUITE_MANIFEST) {
    const bucket = byCapability.get(suite.capability) ?? [];
    bucket.push(suite);
    byCapability.set(suite.capability, bucket);
  }

  console.log("\n── CI Suite Capability Manifest ────────────────────────────────\n");
  const tiers: SuiteCapability[] = [
    "deterministic-static",
    "deterministic-integration",
    "server-required",
    "server-optional",
  ];

  for (const tier of tiers) {
    const suites = byCapability.get(tier) ?? [];
    console.log(`\n  ${tier.toUpperCase()} (${suites.length} suite${suites.length !== 1 ? "s" : ""}):`);
    for (const s of suites) {
      console.log(`    ${s.script}`);
      if (s.providerDenial) console.log(`      providers: ${s.providerDenial}`);
      if (s.providerNote) console.log(`      note: ${s.providerNote}`);
    }
  }

  console.log(`\n  Total: ${SUITE_MANIFEST.length} suites classified`);

  // ── Internal manifest integrity checks ──
  let errors = 0;

  // No suite should appear twice in the manifest.
  const manifestScripts = SUITE_MANIFEST.map(s => s.script);
  const manifestScriptSet = new Set(manifestScripts);
  if (manifestScriptSet.size !== manifestScripts.length) {
    console.error("  ✗ MANIFEST ERROR: duplicate script entries in SUITE_MANIFEST");
    errors++;
  } else {
    console.log("  ✓ No duplicate script entries in manifest");
  }

  // server-optional suites must not also be in server-required.
  const serverOptionalSet = new Set(
    SUITE_MANIFEST.filter(s => s.capability === "server-optional").map(s => s.script)
  );
  const serverRequiredSet = new Set(
    SUITE_MANIFEST.filter(s => s.capability === "server-required").map(s => s.script)
  );
  const overlap = [...serverOptionalSet].filter(s => serverRequiredSet.has(s));
  if (overlap.length > 0) {
    console.error(`  ✗ MANIFEST ERROR: suites in both server-optional and server-required: ${overlap.join(", ")}`);
    errors++;
  } else {
    console.log("  ✓ No server-optional/server-required overlap");
  }

  // All deterministic suites must have a providerDenial entry.
  const deterministicMissingDenial = SUITE_MANIFEST.filter(
    s =>
      (s.capability === "deterministic-static" ||
        s.capability === "deterministic-integration") &&
      !s.providerDenial
  );
  if (deterministicMissingDenial.length > 0) {
    console.error(
      `  ✗ MANIFEST ERROR: deterministic suites missing providerDenial: ${deterministicMissingDenial.map(s => s.script).join(", ")}`
    );
    errors++;
  } else {
    console.log("  ✓ All deterministic suites have provider denial documentation");
  }

  // ── Registry comparison: manifest vs. pre-deploy.ts MANDATORY_SUITES ──
  // Every script in pre-deploy.ts MANDATORY_SUITES must be classified in the
  // manifest; any unclassified script is a coverage gap.
  console.log("\n  Comparing manifest against scripts/pre-deploy.ts MANDATORY_SUITES:");
  let preDeployScripts: string[];
  try {
    preDeployScripts = extractPreDeployScripts();
  } catch (err: any) {
    console.error(`  ✗ MANIFEST ERROR: could not read pre-deploy.ts — ${err.message}`);
    errors++;
    preDeployScripts = [];
  }

  if (preDeployScripts.length > 0) {
    // Suites in pre-deploy but not in manifest (need classification)
    const unclassified = preDeployScripts.filter(s => !manifestScriptSet.has(s));
    if (unclassified.length > 0) {
      for (const s of unclassified) {
        console.error(`  ✗ MANIFEST GAP: '${s}' is in MANDATORY_SUITES but not classified in SUITE_MANIFEST`);
      }
      errors++;
    } else {
      console.log(
        `  ✓ All ${preDeployScripts.length} MANDATORY_SUITES scripts are classified in the manifest`
      );
    }

    // Suites in manifest but not in pre-deploy (stale / not registered)
    const stale = manifestScripts.filter(s => !preDeployScripts.includes(s));
    if (stale.length > 0) {
      for (const s of stale) {
        // Warn only — a manifest can document suites that have been removed from
        // pre-deploy for deprecation tracking purposes.
        console.log(`  ⚠ STALE: '${s}' is in SUITE_MANIFEST but not in MANDATORY_SUITES (deprecated or upcoming?)`);
      }
    } else {
      console.log("  ✓ No stale manifest entries (all manifest scripts are in MANDATORY_SUITES)");
    }
  }

  if (errors > 0) {
    console.error(`\n✗ Suite manifest INVALID: ${errors} error(s)`);
    if (checkMode) process.exit(1);
    // In non-check mode just report
  } else {
    console.log("\n✅ Suite manifest valid\n");
  }
}

// The manifest is also imported by scripts/run-ci-suites.ts. Avoid executing
// validation/reporting as an import side effect; CI invokes --check explicitly.
if (process.argv[1]?.endsWith("ci-suite-manifest.ts")) {
  main();
}
