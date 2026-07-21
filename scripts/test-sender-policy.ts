#!/usr/bin/env npx tsx
/**
 * scripts/test-sender-policy.ts
 *
 * Validates the central Sender Policy Registry and spot-checks that every
 * major send-site correctly resolves its From/Reply-To identity.
 *
 * Run:  npx tsx scripts/test-sender-policy.ts
 * Exit: 0 = all checks passed, 1 = at least one failure
 */

import {
  resolvePolicy,
  resolveSender,
  resolveGhlEmailFrom,
  isProhibitedAddress,
  assertNotProhibitedSync,
  getAllSenderReadiness,
  buildSenderMatrix,
  COLD_OUTREACH_FROM,
  APPROVED_SENDER_SET,
  type MessageCategory,
  type SenderPolicy,
} from "../server/services/sender-policy";

// ── ANSI helpers ──────────────────────────────────────────────────────────────

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red   = (s: string) => `\x1b[31m${s}\x1b[0m`;
const bold  = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim   = (s: string) => `\x1b[2m${s}\x1b[0m`;

let passed = 0;
let failed = 0;
const failures: string[] = [];

function pass(name: string) {
  console.log(`  ${green("✓")} ${name}`);
  passed++;
}

function fail(name: string, detail?: string) {
  const msg = detail ? `${name} — ${detail}` : name;
  console.log(`  ${red("✗")} ${msg}`);
  failures.push(msg);
  failed++;
}

function section(title: string) {
  console.log(`\n${bold(title)}`);
}

function expect<T>(actual: T, expected: T, label: string) {
  if (actual === expected) {
    pass(label);
  } else {
    fail(label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function expectContains(haystack: string, needle: string, label: string) {
  if (haystack.includes(needle)) {
    pass(label);
  } else {
    fail(label, `"${needle}" not found in "${haystack}"`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: Policy registry completeness
// ─────────────────────────────────────────────────────────────────────────────

section("1. Policy registry — all 7 categories registered");

const EXPECTED_CATEGORIES: MessageCategory[] = [
  "cold_outreach", "support", "onboarding",
  "security", "partners", "accounts", "internal_ops",
];

for (const cat of EXPECTED_CATEGORIES) {
  try {
    const p = resolvePolicy(cat);
    pass(`${cat} → ${p.from}`);
  } catch (err: any) {
    fail(`resolvePolicy("${cat}")`, err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: Cold-outreach is the dedicated mailbox (not a Google Workspace alias)
// ─────────────────────────────────────────────────────────────────────────────

section("2. Cold-outreach identity");

const coldPolicy = resolvePolicy("cold_outreach");
expect(coldPolicy.from, "Scott@mail.libertybancard.com", "cold_outreach.from = Scott@mail.libertybancard.com");
expect(coldPolicy.replyTo, "Scott@mail.libertybancard.com", "cold_outreach.replyTo = Scott@mail.libertybancard.com");
expect(coldPolicy.signatureType, "sales", "cold_outreach.signatureType = sales");
expect(COLD_OUTREACH_FROM, "Scott@mail.libertybancard.com", "COLD_OUTREACH_FROM constant correct");

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: Google Workspace aliases (5 on scott@libertybancard.com)
// ─────────────────────────────────────────────────────────────────────────────

section("3. Google Workspace aliases — 5 aliases all on libertybancard.com");

const GWS_ALIASES: Array<[MessageCategory, string]> = [
  ["support",      "support@libertybancard.com"],
  ["onboarding",   "onboarding@libertybancard.com"],
  ["security",     "security@libertybancard.com"],
  ["partners",     "partners@libertybancard.com"],
  ["accounts",     "accounts@libertybancard.com"],
];

for (const [cat, expectedFrom] of GWS_ALIASES) {
  const { from } = resolveSender(cat);
  expect(from, expectedFrom, `${cat}.from = ${expectedFrom}`);
  if (!from.endsWith("@libertybancard.com")) {
    fail(`${cat}.from must end with @libertybancard.com`, `got ${from}`);
  } else {
    pass(`${cat}.from is on @libertybancard.com`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: internal_ops maps to accounts@
// ─────────────────────────────────────────────────────────────────────────────

section("4. internal_ops → accounts@ (decision: accounts owns operational comms)");

const intOps = resolvePolicy("internal_ops");
expect(intOps.from, "accounts@libertybancard.com", "internal_ops.from = accounts@libertybancard.com");
expect(intOps.replyTo, "accounts@libertybancard.com", "internal_ops.replyTo = accounts@libertybancard.com");

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5: Prohibition guard
// ─────────────────────────────────────────────────────────────────────────────

section("5. Prohibition guard — no-reply variants on LB domains blocked");

const PROHIBITED_ADDRS = [
  "noreply@libertybancard.com",
  "no-reply@libertybancard.com",
  "no_reply@libertybancard.com",
  "donotreply@libertybancard.com",
  "do-not-reply@libertybancard.com",
  "NoReply@libertybancard.com",         // case-insensitive
  "noreply@mail.libertybancard.com",    // also blocked on mail subdomain
];

for (const addr of PROHIBITED_ADDRS) {
  if (isProhibitedAddress(addr)) {
    pass(`isProhibitedAddress("${addr}") = true`);
  } else {
    fail(`isProhibitedAddress("${addr}")`, "expected true, got false");
  }
}

const ALLOWED_ADDRS = [
  "support@libertybancard.com",
  "Scott@mail.libertybancard.com",
  "noreply@gmail.com",                  // not an LB domain
  "noreply@competitor.com",             // not an LB domain
];

for (const addr of ALLOWED_ADDRS) {
  if (!isProhibitedAddress(addr)) {
    pass(`isProhibitedAddress("${addr}") = false (allowed)`);
  } else {
    fail(`isProhibitedAddress("${addr}")`, "expected false (allowed), got true (blocked)");
  }
}

section("5b. assertNotProhibitedSync — throws on prohibited, passes on allowed");

try {
  assertNotProhibitedSync("noreply@libertybancard.com", "test");
  fail("assertNotProhibitedSync should have thrown for noreply@libertybancard.com");
} catch {
  pass("assertNotProhibitedSync throws for noreply@libertybancard.com");
}

try {
  assertNotProhibitedSync("support@libertybancard.com", "test");
  pass("assertNotProhibitedSync passes for support@libertybancard.com");
} catch (err: any) {
  fail("assertNotProhibitedSync should NOT throw for support@libertybancard.com", err.message);
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6: resolveGhlEmailFrom formatting
// ─────────────────────────────────────────────────────────────────────────────

section("6. resolveGhlEmailFrom — GHL 'Name <email>' formatting");

const ghlFormatted = resolveGhlEmailFrom("security");
expectContains(ghlFormatted, "security@libertybancard.com", "security GHL from contains email");
expectContains(ghlFormatted, "<", "security GHL from is 'Name <email>' format");

const ghlCold = resolveGhlEmailFrom("cold_outreach");
expectContains(ghlCold, "Scott@mail.libertybancard.com", "cold_outreach GHL from contains email");
expectContains(ghlCold, "Scott Stevenson", "cold_outreach GHL from contains display name");

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7: APPROVED_SENDER_SET
// ─────────────────────────────────────────────────────────────────────────────

section("7. APPROVED_SENDER_SET — all From addresses in set");

const EXPECTED_APPROVED = [
  "scott@mail.libertybancard.com",    // cold_outreach (normalised to lowercase)
  "support@libertybancard.com",
  "onboarding@libertybancard.com",
  "security@libertybancard.com",
  "partners@libertybancard.com",
  "accounts@libertybancard.com",
];

for (const addr of EXPECTED_APPROVED) {
  if (APPROVED_SENDER_SET.has(addr)) {
    pass(`APPROVED_SENDER_SET has "${addr}"`);
  } else {
    fail(`APPROVED_SENDER_SET missing "${addr}"`);
  }
}

// Ensure prohibited addresses are NOT in the approved set
const PROHIBITED_NOT_APPROVED = [
  "noreply@libertybancard.com",
  "no-reply@libertybancard.com",
];
for (const addr of PROHIBITED_NOT_APPROVED) {
  if (!APPROVED_SENDER_SET.has(addr)) {
    pass(`APPROVED_SENDER_SET does NOT contain prohibited "${addr}"`);
  } else {
    fail(`APPROVED_SENDER_SET incorrectly contains "${addr}"`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8: getAllSenderReadiness — no entry is prohibited or unapproved
// ─────────────────────────────────────────────────────────────────────────────

section("8. getAllSenderReadiness — policy health check");

const readiness = getAllSenderReadiness();
if (readiness.length === EXPECTED_CATEGORIES.length) {
  pass(`getAllSenderReadiness returns ${readiness.length} entries (correct)`);
} else {
  fail("getAllSenderReadiness count mismatch", `expected ${EXPECTED_CATEGORIES.length}, got ${readiness.length}`);
}

for (const entry of readiness) {
  if (!entry.isProhibited) {
    pass(`${entry.category} — From/ReplyTo not prohibited`);
  } else {
    fail(`${entry.category} — isProhibited = true (critical: From or ReplyTo is a no-reply variant)`);
  }
  if (entry.approved) {
    pass(`${entry.category} — from address in APPROVED_SENDER_SET`);
  } else {
    fail(`${entry.category} — from address NOT in APPROVED_SENDER_SET`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9: buildSenderMatrix — output
// ─────────────────────────────────────────────────────────────────────────────

section("9. buildSenderMatrix — formatted output");

const matrix = buildSenderMatrix();
if (matrix.includes("cold_outreach") && matrix.includes("Scott@mail.libertybancard.com")) {
  pass("buildSenderMatrix includes cold_outreach row");
} else {
  fail("buildSenderMatrix missing cold_outreach row");
}
if (matrix.includes("security") && matrix.includes("security@libertybancard.com")) {
  pass("buildSenderMatrix includes security row");
} else {
  fail("buildSenderMatrix missing security row");
}

console.log(`\n${dim("--- Sender Matrix ---")}`);
console.log(dim(matrix));

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 10: Known send-site category assignments (regression guard)
// ─────────────────────────────────────────────────────────────────────────────

section("10. Send-site category regression guard");

// Enumerate expected assignments. We can't call the actual send functions here
// (no DB, no SMTP), but we can verify the policy registry returns the right
// identity so that when the caller passes category: "X", it resolves correctly.
const SITE_ASSERTIONS: Array<{ site: string; category: MessageCategory; expectedFrom: string }> = [
  { site: "sequence-worker (SMTP cold)",     category: "cold_outreach", expectedFrom: "Scott@mail.libertybancard.com" },
  { site: "campaign-engine (SMTP cold)",     category: "cold_outreach", expectedFrom: "Scott@mail.libertybancard.com" },
  { site: "merchant-welcome",                category: "onboarding",    expectedFrom: "onboarding@libertybancard.com" },
  { site: "partner-welcome",                 category: "partners",      expectedFrom: "partners@libertybancard.com" },
  { site: "replitAuth security emails",      category: "security",      expectedFrom: "security@libertybancard.com" },
  { site: "partners.ts password reset",      category: "partners",      expectedFrom: "partners@libertybancard.com" },
  { site: "statement-chain step6 (rep)",     category: "internal_ops",  expectedFrom: "accounts@libertybancard.com" },
  { site: "statement-chain step9 (merchant)",category: "accounts",      expectedFrom: "accounts@libertybancard.com" },
  { site: "proposal-engine",                 category: "accounts",      expectedFrom: "accounts@libertybancard.com" },
  { site: "co-branded-proposal",             category: "accounts",      expectedFrom: "accounts@libertybancard.com" },
  { site: "savings route",                   category: "accounts",      expectedFrom: "accounts@libertybancard.com" },
  { site: "rate-review confirmation",        category: "accounts",      expectedFrom: "accounts@libertybancard.com" },
  { site: "operator-digest",                 category: "internal_ops",  expectedFrom: "accounts@libertybancard.com" },
  { site: "digest-service",                  category: "internal_ops",  expectedFrom: "accounts@libertybancard.com" },
  { site: "admin SMTP test",                 category: "internal_ops",  expectedFrom: "accounts@libertybancard.com" },
  { site: "ghl-workflow-enrollment (SMTP fallback)", category: "accounts", expectedFrom: "accounts@libertybancard.com" },
];

for (const { site, category, expectedFrom } of SITE_ASSERTIONS) {
  const { from } = resolveSender(category);
  if (from === expectedFrom) {
    pass(`${site} — category "${category}" → ${from}`);
  } else {
    fail(`${site} — category "${category}"`, `expected from=${expectedFrom}, policy says ${from}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 11: outboundGlobalPaused — architecture note
// ─────────────────────────────────────────────────────────────────────────────

section("11. outboundGlobalPaused — DB-controlled system setting");

// outboundGlobalPaused is stored in system_settings (not in featureFlags).
// The sequence-worker reads it via: storage.getSystemSetting("outboundGlobalPaused")
// The value is controlled via the Activation Panel at /dashboard/activation.
// This test script cannot safely query the DB without full server bootstrap,
// so we just document the correct check path and mark it informational.
console.log(dim("  ℹ  outboundGlobalPaused is controlled via the Admin Activation Panel"));
console.log(dim("  ℹ  (/dashboard/activation → Global Pause toggle)"));
console.log(dim("  ℹ  DB: system_settings WHERE key = 'outboundGlobalPaused'"));
console.log(dim("  ℹ  Verify manually before enabling any outbound send channel."));
pass("outboundGlobalPaused architecture documented (manual verification required)");

// ─────────────────────────────────────────────────────────────────────────────
// Final summary
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
const total = passed + failed;
if (failed === 0) {
  console.log(`${green(bold("ALL CHECKS PASSED"))} — ${passed}/${total} checks`);
} else {
  console.log(`${red(bold(`${failed} CHECKS FAILED`))} — ${passed}/${total} passed`);
  console.log(`\nFailed checks:`);
  for (const f of failures) {
    console.log(`  ${red("✗")} ${f}`);
  }
}
console.log("");

process.exit(failed > 0 ? 1 : 0);
