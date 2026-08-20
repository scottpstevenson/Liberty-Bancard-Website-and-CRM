/**
 * scripts/test-merchant-protected-data.ts
 *
 * Offline unit tests for the merchant-protected-data service.
 * Runs entirely in-process without a database.
 *
 * Run with:  npx tsx scripts/test-merchant-protected-data.ts
 *
 * Security constraints:
 *  - Uses only synthetic test data; never reads/logs real secrets.
 *  - Restores MERCHANT_DATA_ENCRYPTION_KEY from the environment after each test group.
 *  - Never prints decrypted values, ciphertext, or key material.
 */

import { randomBytes } from "crypto";

// ── Capture original env before any mutations ──────────────────────────────
const ORIGINAL_KEY = process.env.MERCHANT_DATA_ENCRYPTION_KEY;

function setTestKey(keyHex: string): void {
  process.env.MERCHANT_DATA_ENCRYPTION_KEY = keyHex;
  // Force module re-evaluation isn't possible in TS; the service reads env
  // at call time via resolveKeyBuffer(), so setting it here is sufficient.
}

function clearKey(): void {
  delete process.env.MERCHANT_DATA_ENCRYPTION_KEY;
}

function restoreKey(): void {
  if (ORIGINAL_KEY !== undefined) {
    process.env.MERCHANT_DATA_ENCRYPTION_KEY = ORIGINAL_KEY;
  } else {
    clearKey();
  }
}

function makeTestKey(): string {
  return randomBytes(32).toString("hex");
}

// ── Lazy import helper (re-imports after env change by reloading cache) ──────
// Because Node caches modules, we import once and rely on the service reading
// process.env at call time (which it does — resolveKeyBuffer() is called per invocation).
import * as mpd from "../server/services/merchant-protected-data";

// ── Test harness ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, testName: string, detail = ""): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${testName}`);
  } else {
    failed++;
    failures.push(`${testName}${detail ? ": " + detail : ""}`);
    console.error(`  ✗ ${testName}${detail ? " — " + detail : ""}`);
  }
}

function assertThrows(fn: () => unknown, testName: string, expectFragment?: string): void {
  try {
    fn();
    failed++;
    failures.push(`${testName} — expected throw but none occurred`);
    console.error(`  ✗ ${testName} — expected throw but none occurred`);
  } catch (err: any) {
    if (expectFragment && !String(err?.message ?? err).includes(expectFragment)) {
      failed++;
      failures.push(`${testName} — thrown but wrong message (fragment not found)`);
      console.error(`  ✗ ${testName} — thrown but wrong message (expected fragment not found)`);
    } else {
      passed++;
      console.log(`  ✓ ${testName}`);
    }
  }
}

async function assertAsyncThrows(fn: () => Promise<unknown>, testName: string, expectFragment?: string): Promise<void> {
  try {
    await fn();
    failed++;
    failures.push(`${testName} — expected throw but none occurred`);
    console.error(`  ✗ ${testName} — expected throw but none occurred`);
  } catch (err: any) {
    if (expectFragment && !String(err?.message ?? err).includes(expectFragment)) {
      failed++;
      failures.push(`${testName} — thrown but wrong message`);
      console.error(`  ✗ ${testName} — thrown but wrong message`);
    } else {
      passed++;
      console.log(`  ✓ ${testName}`);
    }
  }
}

// ── Test groups ───────────────────────────────────────────────────────────────

function testEncryptDecryptRoundtrip(): void {
  console.log("\n[Group] Encrypt/decrypt roundtrip");
  const key = makeTestKey();
  setTestKey(key);

  const appId = 42;
  const ct = mpd.encryptField(appId, "ein", "123456789");
  assert(mpd.isEncryptedEnvelope(ct), "ciphertext recognised as envelope");

  const plaintext = mpd.decryptField(appId, "ein", ct);
  assert(plaintext === "123456789", "roundtrip produces correct plaintext");
  // Never print the plaintext value in the assertion message.

  // Randomized ciphertext: two encryptions of the same value must differ (random IV).
  const ct2 = mpd.encryptField(appId, "ein", "123456789");
  assert(ct !== ct2, "two encryptions of same value produce different ciphertext (random IV)");

  // Equal fingerprints for equal values.
  const fp1 = mpd.fingerprint("ein:123456789");
  const fp2 = mpd.fingerprint("ein:123456789");
  assert(fp1 === fp2, "equal values produce equal fingerprints");
  assert(mpd.fingerprintsEqual(fp1, fp2), "fingerprintsEqual returns true for equal fingerprints");

  // Different values produce different fingerprints.
  const fp3 = mpd.fingerprint("ein:987654321");
  assert(fp1 !== fp3, "different values produce different fingerprints");
}

function testBindingMismatch(): void {
  console.log("\n[Group] Binding mismatch");
  const key = makeTestKey();
  setTestKey(key);

  const ct = mpd.encryptField(100, "ein", "123456789");

  // Wrong applicationId.
  assertThrows(
    () => mpd.decryptField(999, "ein", ct),
    "wrong applicationId rejects (binding mismatch)",
    "binding mismatch",
  );

  // Wrong fieldPath.
  assertThrows(
    () => mpd.decryptField(100, "ownerSsn", ct),
    "wrong fieldPath rejects (binding mismatch)",
    "binding mismatch",
  );
}

function testTamperDetection(): void {
  console.log("\n[Group] Tamper detection");
  const key = makeTestKey();
  setTestKey(key);

  const ct = mpd.encryptField(1, "ownerSsn", "123456789");
  // Corrupt the last few characters of the base64 ciphertext.
  const parts = ct.split(":");
  parts[parts.length - 1] = parts[parts.length - 1].slice(0, -4) + "AAAA";
  const tampered = parts.join(":");

  assertThrows(
    () => mpd.decryptField(1, "ownerSsn", tampered),
    "tampered ciphertext throws on decrypt",
    "Decryption failed",
  );
}

function testStrictPlaintextRejection(): void {
  console.log("\n[Group] Strict plaintext rejection");
  const key = makeTestKey();
  setTestKey(key);

  assertThrows(
    () => mpd.decryptField(1, "ein", "123456789"),
    "raw plaintext rejected by decryptField",
    "not a recognised protected-data envelope",
  );

  assertThrows(
    () => mpd.decryptField(1, "bankRoutingNumber", ""),
    "empty string rejected by decryptField",
    "not a recognised protected-data envelope",
  );
}

function testValidation(): void {
  console.log("\n[Group] Normalization & validation");
  const key = makeTestKey();
  setTestKey(key);

  // EIN
  assert(mpd.normalizeEin("12-3456789") === "123456789", "normalizeEin strips hyphen");
  assertThrows(() => mpd.normalizeEin("1234"), "normalizeEin rejects too-short EIN");

  // SSN
  assert(mpd.normalizeSsn("123-45-6789") === "123456789", "normalizeSsn strips dashes");
  assertThrows(() => mpd.normalizeSsn("000-12-3456"), "normalizeSsn rejects area 000");
  assertThrows(() => mpd.normalizeSsn("666-12-3456"), "normalizeSsn rejects area 666");
  assertThrows(() => mpd.normalizeSsn("900-12-3456"), "normalizeSsn rejects area >= 900");
  assertThrows(() => mpd.normalizeSsn("123-00-3456"), "normalizeSsn rejects group 00");
  assertThrows(() => mpd.normalizeSsn("123-45-0000"), "normalizeSsn rejects serial 0000");

  // DOB
  assert(mpd.normalizeDob("1980-06-15") === "1980-06-15", "normalizeDob accepts ISO");
  assert(mpd.normalizeDob("6/15/1980") === "1980-06-15", "normalizeDob accepts US format");
  assertThrows(() => mpd.normalizeDob("2099-01-01"), "normalizeDob rejects future date");
  assertThrows(() => mpd.normalizeDob("not-a-date"), "normalizeDob rejects non-date");

  // Routing (valid ABA)
  assert(mpd.normalizeRouting("021000021") === "021000021", "normalizeRouting accepts valid ABA");
  assertThrows(() => mpd.normalizeRouting("123456789"), "normalizeRouting rejects bad checksum");

  // Account
  assert(mpd.normalizeAccount("12345678") === "12345678", "normalizeAccount accepts valid");
  assertThrows(() => mpd.normalizeAccount("12"), "normalizeAccount rejects too short");
}

function testMasks(): void {
  console.log("\n[Group] Masks");
  const key = makeTestKey();
  setTestKey(key);

  // EIN mask: ••-•••XXXX
  const einMask = mpd.maskEin("123456789");
  assert(einMask.includes("6789"), "EIN mask shows last 4");
  assert(!einMask.includes("1234"), "EIN mask hides first digits");

  // SSN mask: •••-••-XXXX
  const ssnMask = mpd.maskSsn("123456789");
  assert(ssnMask.includes("6789"), "SSN mask shows last 4");
  assert(!ssnMask.includes("123"), "SSN mask hides first digits");

  // Account mask
  const acctMask = mpd.maskAccount("123456789012");
  assert(acctMask.endsWith("9012"), "account mask shows last 4");

  // Routing mask
  const routingMask = mpd.maskRouting("021000021");
  assert(routingMask.endsWith("0021"), "routing mask shows last 4");
}

function testProcessProtectedData(): void {
  console.log("\n[Group] processProtectedData");
  const key = makeTestKey();
  setTestKey(key);

  const result = mpd.processProtectedData(5, {
    ein: "12-3456789",
    ssn: "123-45-6789",
    dob: "1985-03-22",
    routing: "021000021",
    account: "9876543210",
    additionalOwners: [
      { firstName: "Jane", lastName: "Doe", ssn: "234-56-7890", dob: "1990-07-04" },
    ],
  });

  assert(mpd.isEncryptedEnvelope(result.ein!.ciphertext), "EIN ciphertext is envelope");
  assert(mpd.isEncryptedEnvelope(result.ssn!.ciphertext), "SSN ciphertext is envelope");
  assert(mpd.isEncryptedEnvelope(result.dob!.ciphertext), "DOB ciphertext is envelope");
  assert(mpd.isEncryptedEnvelope(result.routing!.ciphertext), "routing ciphertext is envelope");
  assert(mpd.isEncryptedEnvelope(result.account!.ciphertext), "account ciphertext is envelope");
  assert(mpd.isEncryptedEnvelope(result.additionalOwners!.ciphertext), "additionalOwners ciphertext is envelope");

  // Masks present
  assert(typeof result.ein!.mask === "string" && result.ein!.mask.length > 0, "EIN mask present");
  assert(typeof result.ssn!.mask === "string" && result.ssn!.mask.length > 0, "SSN mask present");
  assert(typeof result.account!.mask === "string" && result.account!.mask.length > 0, "account mask present");

  // Fingerprints present
  assert(typeof result.ein!.fingerprint === "string" && result.ein!.fingerprint.length === 64, "EIN fingerprint 64-char hex");
  assert(typeof result.ssn!.fingerprint === "string" && result.ssn!.fingerprint.length === 64, "SSN fingerprint 64-char hex");
  assert(typeof result.account!.fingerprint === "string" && result.account!.fingerprint.length === 64, "account fingerprint 64-char hex");

  // additionalOwners count
  assert(result.additionalOwners!.count === 1, "additionalOwners count = 1");
}

function testNestedOwners(): void {
  console.log("\n[Group] Nested owners decrypt");
  const key = makeTestKey();
  setTestKey(key);

  const result = mpd.processProtectedData(7, {
    additionalOwners: [
      { firstName: "A", lastName: "B", ssn: "345-67-8901", dob: "1975-11-30" },
      { firstName: "C", lastName: "D", ssn: "456-78-9012", dob: "1968-02-14" },
    ],
  });

  assert(result.additionalOwners!.count === 2, "two additional owners counted");
  const decrypted = mpd.decryptAdditionalOwners(7, result.additionalOwners!.ciphertext);
  assert(Array.isArray(decrypted), "decrypted additionalOwners is array");
  const arr = decrypted as any[];
  assert(arr.length === 2, "decrypted array has 2 entries");
  assert(arr[0].ssn === "345678901", "nested SSN normalized on encrypt");
  assert(arr[1].dob === "1968-02-14", "nested DOB normalized on encrypt");
}

function testDecryptProtectedFields(): void {
  console.log("\n[Group] decryptProtectedFields");
  const key = makeTestKey();
  setTestKey(key);

  // Build a minimal application row with encrypted fields.
  const appId = 99;
  const result = mpd.processProtectedData(appId, {
    ein: "12-3456789",
    ssn: "123-45-6789",
    dob: "1980-01-01",
    routing: "021000021",
    account: "9876543210",
  });

  const fakeApp: mpd.ApplicationRecord = {
    id: appId,
    ein: result.ein!.ciphertext,
    ownerSsn: result.ssn!.ciphertext,
    ownerDob: result.dob!.ciphertext,
    bankRoutingNumber: result.routing!.ciphertext,
    bankAccountNumber: result.account!.ciphertext,
    einFingerprint: result.ein!.fingerprint,
    ssnFingerprint: result.ssn!.fingerprint,
    bankAccountFingerprint: result.account!.fingerprint,
    einMask: result.ein!.mask,
    ssnMask: result.ssn!.mask,
    bankAccountMask: result.account!.mask,
    bankRoutingMask: result.routing!.mask,
  };

  // Admin role succeeds.
  const decrypted = mpd.decryptProtectedFields(fakeApp, { role: "admin", purpose: "test" });
  assert(decrypted.ein === "123456789", "admin can decrypt EIN");
  assert(decrypted.ownerDob === "1980-01-01", "admin gets ownerDob decrypted");
  assert(decrypted.ownerSsn === "123456789", "admin gets ownerSsn decrypted");
  assert(decrypted.bankRoutingNumber === "021000021", "admin gets routing decrypted");
  assert(decrypted.bankAccountNumber === "9876543210", "admin gets account decrypted");

  // Manager role succeeds.
  const decryptedMgr = mpd.decryptProtectedFields(fakeApp, { role: "manager", purpose: "test" });
  assert(decryptedMgr.ein === "123456789", "manager can decrypt EIN");

  // Other roles fail closed.
  assertThrows(
    () => mpd.decryptProtectedFields(fakeApp, { role: "rep" }),
    "rep role denied",
    "access denied",
  );
  assertThrows(
    () => mpd.decryptProtectedFields(fakeApp, { role: undefined }),
    "no role denied",
    "access denied",
  );
  assertThrows(
    () => mpd.decryptProtectedFields(fakeApp, { role: "viewer" }),
    "viewer role denied",
    "access denied",
  );
}

function testPlaintextLegacyRowRejection(): void {
  console.log("\n[Group] Legacy plaintext row rejection (fail-closed)");
  const key = makeTestKey();
  setTestKey(key);

  // A row that has plaintext (un-encrypted) EIN — must be rejected.
  const legacyApp: mpd.ApplicationRecord = {
    id: 200,
    ein: "123456789", // plaintext, not envelope
    ownerSsn: null,
    ownerDob: null,
  };

  assertThrows(
    () => mpd.decryptProtectedFields(legacyApp, { role: "admin" }),
    "plaintext EIN in legacy row throws (fail-closed)",
    "not a recognised protected-data envelope",
  );
}

function testDecryptAdditionalOwnersEnvelopeStrictness(): void {
  console.log("\n[Group] decryptProtectedFields — additionalOwners must be string mpd_v1 envelope");
  const key = makeTestKey();
  setTestKey(key);

  const appId = 321;
  const owners = [{ firstName: "Jane", lastName: "Doe", ssn: "234-56-7890", dob: "1990-07-04" }];
  const processed = mpd.processProtectedData(appId, { additionalOwners: owners });

  // A proper string envelope decrypts fine.
  const okApp: mpd.ApplicationRecord = {
    id: appId,
    additionalOwners: processed.additionalOwners!.ciphertext,
  };
  const decrypted = mpd.decryptProtectedFields(okApp, { role: "admin" });
  assert(Array.isArray(decrypted.additionalOwners), "string mpd_v1 envelope additionalOwners decrypts to array");

  // Legacy JSON ARRAY object (JSONB from DB) must be rejected.
  const legacyArrayApp: mpd.ApplicationRecord = {
    id: appId,
    additionalOwners: [{ firstName: "Jane", ssn: "234567890" }],
  };
  assertThrows(
    () => mpd.decryptProtectedFields(legacyArrayApp, { role: "admin" }),
    "legacy JSON array additionalOwners rejected",
    "legacy JSON object/array",
  );

  // Legacy JSON OBJECT must be rejected.
  const legacyObjApp: mpd.ApplicationRecord = {
    id: appId,
    additionalOwners: { firstName: "Jane", ssn: "234567890" },
  };
  assertThrows(
    () => mpd.decryptProtectedFields(legacyObjApp, { role: "admin" }),
    "legacy JSON object additionalOwners rejected",
    "legacy JSON object/array",
  );

  // Plaintext string (non-envelope) must be rejected.
  const legacyStrApp: mpd.ApplicationRecord = {
    id: appId,
    additionalOwners: "some plaintext",
  };
  assertThrows(
    () => mpd.decryptProtectedFields(legacyStrApp, { role: "admin" }),
    "plaintext string additionalOwners rejected",
    "plaintext",
  );
}

function testSystemRolePurposeGating(): void {
  console.log("\n[Group] decryptProtectedFields — system role gated to exact boarding purpose");
  const key = makeTestKey();
  setTestKey(key);

  const appId = 654;
  const processed = mpd.processProtectedData(appId, { ein: "12-3456789" });
  const fakeApp: mpd.ApplicationRecord = {
    id: appId,
    ein: processed.ein!.ciphertext,
  };

  // system + EXACT boarding_processor_submission → allowed.
  const okSystem = mpd.decryptProtectedFields(fakeApp, {
    role: "system",
    purpose: mpd.BOARDING_PROCESSOR_SUBMISSION_PURPOSE,
  });
  assert(okSystem.ein === "123456789", "system role allowed for exact boarding_processor_submission purpose");
  assert(mpd.BOARDING_PROCESSOR_SUBMISSION_PURPOSE === "boarding_processor_submission", "boarding purpose constant is exact string");

  // system + other purpose → denied.
  assertThrows(
    () => mpd.decryptProtectedFields(fakeApp, { role: "system", purpose: "other" }),
    "system role denied for non-boarding purpose",
    "access denied",
  );
  // system + no purpose → denied.
  assertThrows(
    () => mpd.decryptProtectedFields(fakeApp, { role: "system" }),
    "system role denied with no purpose",
    "access denied",
  );
  // system + near-miss purpose (whitespace/case) → denied (exact match only).
  assertThrows(
    () => mpd.decryptProtectedFields(fakeApp, { role: "system", purpose: "boarding_processor_submission " }),
    "system role denied for near-miss purpose (trailing space)",
    "access denied",
  );
  assertThrows(
    () => mpd.decryptProtectedFields(fakeApp, { role: "system", purpose: "BOARDING_PROCESSOR_SUBMISSION" }),
    "system role denied for wrong-case purpose",
    "access denied",
  );

  // admin/manager remain allowed regardless of purpose.
  assert(
    mpd.decryptProtectedFields(fakeApp, { role: "admin" }).ein === "123456789",
    "admin remains allowed (no purpose required)",
  );
  assert(
    mpd.decryptProtectedFields(fakeApp, { role: "manager", purpose: "anything" }).ein === "123456789",
    "manager remains allowed for any purpose",
  );
}

function testSafeApplicationMasks(): void {
  console.log("\n[Group] getSafeApplicationMasks");
  const key = makeTestKey();
  setTestKey(key);

  const app: mpd.ApplicationRecord = {
    id: 1,
    einMask: "••-•••6789",
    ssnMask: "•••-••-6789",
    bankAccountMask: "••••••1234",
    bankRoutingMask: "•••••0021",
  };

  const masks = mpd.getSafeApplicationMasks(app);
  assert(masks.einMasked === "••-•••6789", "einMasked from persisted column");
  assert(masks.einLast4 === "6789", "einLast4 extracted from mask");
  assert(masks.ssnMasked === "•••-••-6789", "ssnMasked from persisted column");
  assert(masks.bankAccountMasked === "••••••1234", "bankAccountMasked from persisted column");
  assert(masks.bankRoutingMasked === "•••••0021", "bankRoutingMasked from persisted column");

  // Empty app — no masks present.
  const emptyMasks = mpd.getSafeApplicationMasks({ id: 2 });
  assert(Object.keys(emptyMasks).length === 0, "empty app yields no mask keys");
}

function testComputeApplicationFingerprints(): void {
  console.log("\n[Group] computeApplicationFingerprints (persisted columns only)");
  const key = makeTestKey();
  setTestKey(key);

  const fp = "a".repeat(64);
  const app: mpd.ApplicationRecord = {
    id: 1,
    einFingerprint: fp,
    ssnFingerprint: "b".repeat(64),
    bankAccountFingerprint: "c".repeat(64),
    // Intentionally include plaintext fields — must NOT be used.
    ein: "123456789",
  };

  const prints = mpd.computeApplicationFingerprints(app);
  assert(prints.einFingerprint === fp, "einFingerprint from persisted column");
  assert(prints.ssnFingerprint === "b".repeat(64), "ssnFingerprint from persisted column");
  assert(prints.bankAccountFingerprint === "c".repeat(64), "bankAccountFingerprint from persisted column");
  // Routing fingerprint is always null (routing = institution, not identity).
  assert(prints.routingFingerprint === null, "routingFingerprint is always null");

  // NULL columns → null.
  const empty = mpd.computeApplicationFingerprints({ id: 2 });
  assert(empty.einFingerprint === null, "null einFingerprint when column absent");
  assert(empty.routingFingerprint === null, "null routingFingerprint when column absent");
}

function testMissingKey(): void {
  console.log("\n[Group] Missing/invalid key behaviour");
  clearKey();

  assert(!mpd.isMerchantEncryptionAvailable(), "isMerchantEncryptionAvailable false when key absent");

  const status = mpd.getMerchantEncryptionStatus();
  assert(status.available === false, "getMerchantEncryptionStatus.available false when key absent");

  assertThrows(
    () => mpd.encryptField(1, "ein", "123456789"),
    "encryptField throws when key absent",
    "not set",
  );

  assertThrows(
    () => mpd.fingerprint("test"),
    "fingerprint throws when key absent",
    "not set",
  );

  // Invalid key (wrong length).
  setTestKey("tooshort");
  assert(!mpd.isMerchantEncryptionAvailable(), "isMerchantEncryptionAvailable false for invalid key");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("=== Merchant Protected Data — Unit Tests ===\n");

  testEncryptDecryptRoundtrip();
  testBindingMismatch();
  testTamperDetection();
  testStrictPlaintextRejection();
  testValidation();
  testMasks();
  testProcessProtectedData();
  testNestedOwners();
  testDecryptProtectedFields();
  testPlaintextLegacyRowRejection();
  testDecryptAdditionalOwnersEnvelopeStrictness();
  testSystemRolePurposeGating();
  testSafeApplicationMasks();
  testComputeApplicationFingerprints();
  testMissingKey();

  // Always restore original key before exit.
  restoreKey();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failures.length > 0) {
    console.error("\nFailed tests:");
    for (const f of failures) {
      console.error(`  ✗ ${f}`);
    }
    process.exit(1);
  } else {
    console.log("All tests passed.");
    process.exit(0);
  }
}

main().catch((err) => {
  // Restore key even on unexpected crash.
  restoreKey();
  console.error("Test runner crashed:", err);
  process.exit(2);
});
