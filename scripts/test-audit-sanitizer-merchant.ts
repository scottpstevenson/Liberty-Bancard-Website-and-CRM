#!/usr/bin/env tsx
/**
 * test-audit-sanitizer-merchant.ts
 *
 * Focused test for merchant-application protected-field coverage in
 * server/services/audit-sanitizer.ts. Verifies that EIN, tax id, SSN, DOB,
 * bank name/routing/account, ciphertext/fingerprint, and nested owner/bank
 * subtrees are redacted with safe masks and that NO raw sensitive value
 * survives sanitization.
 *
 * Exits 0 if all assertions pass, 1 if any fail.
 */

import { sanitizeAuditPayload } from "../server/services/audit-sanitizer";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push(label + (detail ? ` — ${detail}` : ""));
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Recursively collect every scalar string/number in a payload. */
function collectScalars(value: unknown, acc: string[] = []): string[] {
  if (value == null) return acc;
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    acc.push(String(value));
  } else if (Array.isArray(value)) {
    for (const v of value) collectScalars(v, acc);
  } else if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) collectScalars(v, acc);
  }
  return acc;
}

/** Assert that a raw sensitive value does not appear anywhere in the output. */
function assertNoRaw(label: string, output: unknown, raw: string) {
  const scalars = collectScalars(output);
  const leaked = scalars.some((s) => s.includes(raw));
  assert(label, !leaked, leaked ? `raw value "${raw}" leaked` : undefined);
}

console.log("\n== Flat merchant protected fields ==");
{
  const input = {
    ein: "12-3456789",
    taxId: "987654321",
    federalTaxId: "551234567",
    ownerSsn: "123456789",
    ssn: "999887777",
    ownerDob: "1980-05-14",
    dateOfBirth: "1975-01-02",
    bankName: "First National Bank",
    bankRoutingNumber: "021000021",
    bankAccountNumber: "1234567890",
    bankAccountType: "checking",
    ciphertext: "AAAABBBBCCCCDDDDEEEE",
    fingerprint: "sha256:deadbeefcafebabe",
    legalBusinessName: "Acme LLC",
    estimatedMonthlyVolume: "50000",
  };
  const out = sanitizeAuditPayload(input) as Record<string, unknown>;

  assertNoRaw("EIN not raw", out, "12-3456789");
  assertNoRaw("EIN digits not raw", out, "3456789");
  assertNoRaw("taxId not raw", out, "987654321");
  assertNoRaw("federalTaxId not raw", out, "551234567");
  assertNoRaw("ownerSsn not raw", out, "123456789");
  assertNoRaw("ssn not raw", out, "999887777");
  assertNoRaw("ownerDob not raw", out, "1980-05-14");
  assertNoRaw("dateOfBirth not raw", out, "1975-01-02");
  assertNoRaw("bankName not raw", out, "First National Bank");
  assertNoRaw("routing not raw", out, "021000021");
  assertNoRaw("account not raw", out, "1234567890");
  assertNoRaw("ciphertext not raw", out, "AAAABBBBCCCCDDDDEEEE");
  assertNoRaw("fingerprint not raw", out, "deadbeefcafebabe");

  // Safe-mask shape: redactToken keeps first 3 chars + "***"
  assert("EIN redacted to token mask", out.ein === "12-***" || out.ein === "12-***".slice(0, 6), `got ${JSON.stringify(out.ein)}`);
  assert("routing redacted to token mask", out.bankRoutingNumber === "021***", `got ${JSON.stringify(out.bankRoutingNumber)}`);

  // Non-sensitive keys pass through untouched
  assert("legalBusinessName preserved", out.legalBusinessName === "Acme LLC");
  assert("estimatedMonthlyVolume preserved", out.estimatedMonthlyVolume === "50000");
}

console.log("\n== Nested owner subtree redacted wholesale ==");
{
  const input = {
    legalBusinessName: "Acme LLC",
    owner: {
      firstName: "Jane",
      lastName: "Doe",
      ssn: "123456789",
      dob: "1980-05-14",
      // A not-individually-enumerated child key must still be scrubbed because
      // the whole owner subtree is redacted.
      passportNumber: "X1234567",
      nested: { motherMaidenName: "Smith" },
    },
    owners: [
      { firstName: "Bob", ssn: "555443333", dob: "1990-02-02" },
    ],
  };
  const out = sanitizeAuditPayload(input) as Record<string, unknown>;

  assertNoRaw("owner.ssn not raw", out, "123456789");
  assertNoRaw("owner.dob not raw", out, "1980-05-14");
  assertNoRaw("owner.passportNumber not raw (subtree redacted)", out, "X1234567");
  assertNoRaw("owner.nested.motherMaidenName not raw", out, "Smith");
  assertNoRaw("owners[].ssn not raw", out, "555443333");
  assertNoRaw("owners[].dob not raw", out, "1990-02-02");
  assert("legalBusinessName still preserved alongside owner subtree", out.legalBusinessName === "Acme LLC");
}

console.log("\n== Nested bank subtree redacted wholesale ==");
{
  const input = {
    bankInfo: {
      bankName: "Chase",
      routingNumber: "021000021",
      accountNumber: "9876543210",
      extra: { someUnenumeratedSecret: "topsecretvalue" },
    },
  };
  const out = sanitizeAuditPayload(input) as Record<string, unknown>;
  assertNoRaw("bankInfo.routingNumber not raw", out, "021000021");
  assertNoRaw("bankInfo.accountNumber not raw", out, "9876543210");
  assertNoRaw("bankInfo.extra.someUnenumeratedSecret not raw", out, "topsecretvalue");
}

console.log("\n== Deep recursion under generic containers ==");
{
  const input = {
    payload: {
      application: {
        merchant: {
          ein: "12-3456789",
          ownerSsn: "123456789",
        },
      },
    },
  };
  const out = sanitizeAuditPayload(input);
  assertNoRaw("deeply nested EIN not raw", out, "12-3456789");
  assertNoRaw("deeply nested ownerSsn not raw", out, "123456789");
}

console.log("\n== Null / non-string sensitive values are safe ==");
{
  const input = { ein: null, ownerSsn: undefined, bankRoutingNumber: 21000021, dob: 19800514 };
  const out = sanitizeAuditPayload(input) as Record<string, unknown>;
  assert("null ein preserved as null", out.ein === null);
  assertNoRaw("numeric routing not raw", out, "21000021");
  assertNoRaw("numeric dob not raw", out, "19800514");
}

console.log("\n================================");
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) {
  console.error("\nFailures:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("All audit-sanitizer merchant protected-field assertions passed.");
process.exit(0);
