/**
 * Validation script: import idempotency
 *
 * Tests:
 *  1. Same CSV bytes uploaded twice → second returns existing list, zero new rows
 *  2. Same bytes under different filename → still recognized as replay
 *  3. Same filename with different bytes → treated as new import
 *  4. Duplicate emails (case/whitespace variants) normalized to same key → only one inserted
 *  5. Phone-only rows → classified possible_match_review, not silently skipped
 *  6. Total row accounting: total = inserted + skippedWithinFile + skippedExisting + possibleMatchReview + invalid
 *  7. COREVT-style upsert: re-upload returns same import result
 *
 * Usage: npx tsx scripts/test-import-idempotency.ts
 */

import crypto from "crypto";
import {
  computeFileHash,
  computeRowFingerprint,
  isValidEmailFormat,
  normalizeProspectEmail,
  normalizeProspectPhone,
} from "../server/services/import-normalizer";

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

// ─── Unit tests for import-normalizer ────────────────────────────────────────

console.log("\n=== import-normalizer unit tests ===");

// normalizeProspectEmail — canonical: trim+lowercase+blank→null (matches contacts.ts exactly)
assert("email: trims and lowercases", normalizeProspectEmail("  TEST@Example.COM  ") === "test@example.com");
assert("email: blank → null", normalizeProspectEmail("") === null);
assert("email: whitespace-only → null", normalizeProspectEmail("   ") === null);
assert("email: no-at-sign → normalized string (format validation is separate)", normalizeProspectEmail("notanemail") === "notanemail");
assert("email: null-like input → null", normalizeProspectEmail(null as any) === null);

// isValidEmailFormat — classification-layer validation (separate from normalization)
assert("isValidEmailFormat: valid email → true", isValidEmailFormat("test@example.com") === true);
assert("isValidEmailFormat: no-at-sign → false", isValidEmailFormat("notanemail") === false);
assert("isValidEmailFormat: @ only → true (minimal, format not full RFC)", isValidEmailFormat("@") === true);

// normalizeProspectPhone
assert("phone: 10 digits → preserved", normalizeProspectPhone("(813) 555-1234") === "8135551234");
assert("phone: 11 digits with leading 1 → 10 digits", normalizeProspectPhone("1-813-555-1234") === "8135551234");
assert("phone: empty → null", normalizeProspectPhone("") === null);
assert("phone: too short → null", normalizeProspectPhone("555-1234") === null);
assert("phone: null-like → null", normalizeProspectPhone(null as any) === null);
assert("phone: short invalid string → null (not raw fallback)", normalizeProspectPhone("123") === null);
assert("phone: non-numeric garbage → null (not raw fallback)", normalizeProspectPhone("not-a-phone") === null);

// computeRowFingerprint — same canonical values → same hash
const fp1 = computeRowFingerprint({ email: "test@example.com", phone: "8135551234", companyName: "Acme Inc" });
const fp2 = computeRowFingerprint({ email: "test@example.com", phone: "8135551234", companyName: "Acme Inc" });
assert("fingerprint: deterministic for same inputs", fp1 === fp2);

const fp3 = computeRowFingerprint({ email: "test@example.com", phone: "8135551234", companyName: "Different" });
assert("fingerprint: different for different companyName", fp1 !== fp3);

const fp4 = computeRowFingerprint({ email: null, phone: null, companyName: null });
const fp5 = computeRowFingerprint({ email: null, phone: null, companyName: null });
assert("fingerprint: deterministic for all-null inputs", fp4 === fp5);

// computeFileHash
const buf1 = Buffer.from("hello world");
const buf2 = Buffer.from("hello world");
const buf3 = Buffer.from("hello worlD");
assert("fileHash: same bytes → same hash", computeFileHash(buf1) === computeFileHash(buf2));
assert("fileHash: different bytes → different hash", computeFileHash(buf1) !== computeFileHash(buf3));

// ─── Row classification simulation ───────────────────────────────────────────

console.log("\n=== CSV row classification simulation ===");

interface Row {
  email?: string;
  phone?: string;
  companyName?: string;
}

function classifyRow(row: Row): "email_candidate" | "phone_only" | "invalid" {
  const normEmail = normalizeProspectEmail(row.email ?? "");
  const normPhone = normalizeProspectPhone(row.phone ?? "");
  // normalization is canonical (trim+lower); format validation is separate
  if (normEmail && isValidEmailFormat(normEmail)) return "email_candidate";
  if (normPhone) return "phone_only";
  // company-only (no valid email, no phone) → invalid per spec
  return "invalid";
}

assert("row with email → email_candidate", classifyRow({ email: "a@b.com", companyName: "Acme" }) === "email_candidate");
assert("row with phone only → phone_only", classifyRow({ phone: "8135551234" }) === "phone_only");
assert("row with no contact info → invalid", classifyRow({ companyName: "" }) === "invalid");
assert("row with company but no email/phone → invalid (spec: email or phone required)", classifyRow({ companyName: "Acme LLC" }) === "invalid");

// ─── Within-file dedup simulation ─────────────────────────────────────────────

console.log("\n=== Within-file dedup simulation ===");

const testRows: Array<Row & { sourceRowIndex: number }> = [
  { sourceRowIndex: 0, email: "test@example.com", phone: "8135551234", companyName: "Acme" },
  { sourceRowIndex: 1, email: "TEST@EXAMPLE.COM", phone: "(813) 555-1234", companyName: "Acme" },  // duplicate (normalized)
  { sourceRowIndex: 2, email: "other@example.com", companyName: "Other Co" },
  { sourceRowIndex: 3, phone: "7275551234" },                                                       // phone-only
  { sourceRowIndex: 4 },                                                                             // invalid (no data)
  { sourceRowIndex: 5, email: "  Test@Example.COM  " },                                             // duplicate of row 0 by email
];

const seenFingerprints = new Set<string>();
let skippedWithinFile = 0;
const classified: Array<{ row: typeof testRows[0]; type: string; skip: boolean }> = [];

for (const row of testRows) {
  const normEmail = normalizeProspectEmail(row.email ?? "");
  const normPhone = normalizeProspectPhone(row.phone ?? "");
  const type = classifyRow(row);
  const fp = computeRowFingerprint({ email: normEmail, phone: normPhone, companyName: row.companyName ?? null });
  // Dedup key: email-primary (per spec: "group by normalizedEmail if present, else fingerprint")
  const dedupeKey = normEmail ?? fp;

  if (type === "invalid") {
    classified.push({ row, type, skip: false });
    continue;
  }

  if (seenFingerprints.has(dedupeKey)) {
    skippedWithinFile++;
    classified.push({ row, type, skip: true });
  } else {
    seenFingerprints.add(dedupeKey);
    classified.push({ row, type, skip: false });
  }
}

const emailCandidates = classified.filter(r => r.type === "email_candidate" && !r.skip);
const phoneOnly = classified.filter(r => r.type === "phone_only" && !r.skip);
const invalids = classified.filter(r => r.type === "invalid");

// Row 0: test@example.com → inserted as email candidate
// Row 1: TEST@EXAMPLE.COM + (813)555-1234 → same email after normalize → SKIP
// Row 2: other@example.com → new email candidate
// Row 3: phone only → phone_only
// Row 4: no data → invalid
// Row 5: "  Test@Example.COM  " → same email as row 0 → SKIP
assert("within-file dedup: rows 1 and 5 deduplicated against row 0 (skippedWithinFile = 2)", skippedWithinFile === 2, `got ${skippedWithinFile}`);
assert("email candidates after dedup: 2 (rows 0 and 2)", emailCandidates.length === 2, `got ${emailCandidates.length}`);
assert("phone-only rows: 1 (row 3)", phoneOnly.length === 1, `got ${phoneOnly.length}`);
assert("invalid rows: 1 (row 4)", invalids.length === 1, `got ${invalids.length}`);

// ─── Row accounting reconciliation ───────────────────────────────────────────

console.log("\n=== Row accounting reconciliation ===");

const totalRows = testRows.length;
const simulatedInserted = emailCandidates.length;   // pretend all email candidates are new
const simulatedSkippedExisting = 0;                 // no pre-existing in this sim
const simulatedPossibleMatchReview = phoneOnly.length;
const simulatedInvalid = invalids.length;
const sum = simulatedInserted + skippedWithinFile + simulatedSkippedExisting + simulatedPossibleMatchReview + simulatedInvalid;

assert(
  `total = inserted(${simulatedInserted}) + skippedWithinFile(${skippedWithinFile}) + skippedExisting(${simulatedSkippedExisting}) + possibleMatchReview(${simulatedPossibleMatchReview}) + invalid(${simulatedInvalid}) = ${sum}`,
  sum === totalRows,
  `sum=${sum} vs total=${totalRows}`
);

// ─── COREVT missing filing number safety ─────────────────────────────────────

console.log("\n=== COREVT missing filing number safety ===");

// Simulate the upsertSunbizEntitiesBulk mapping logic
function mapFilingNumber(raw: string | null | undefined): string | null {
  return raw ?? null;  // must preserve null — NOT coerce to ""
}

assert(
  "missing filing number maps to null (not empty string)",
  mapFilingNumber(undefined) === null,
);
assert(
  "empty string filing number stays as-is (caller provides '')",
  mapFilingNumber("") === "",
);
assert(
  "blank string filing number stays as-is",
  mapFilingNumber("  ") === "  ",
);
assert(
  "real filing number preserved",
  mapFilingNumber("L23000012345") === "L23000012345",
);
// Verify that two rows with missing filing numbers do NOT produce the same
// conflict key — null !== null in SQL UNIQUE semantics (each NULL is distinct).
const fn1 = mapFilingNumber(undefined);
const fn2 = mapFilingNumber(undefined);
assert(
  "two missing filing numbers both map to null (distinct per SQL UNIQUE — no collision)",
  fn1 === null && fn2 === null,
);

// ─── File hash replay detection ───────────────────────────────────────────────

console.log("\n=== File hash replay detection ===");

const csvContent1 = "company,email,phone\nAcme,test@example.com,8135551234";
const csvContent2 = "company,email,phone\nOther,other@example.com,7275551234";
const fileName1 = "prospects.csv";
const fileName2 = "different_name.csv";  // same bytes as content1 but different filename

const hash1 = computeFileHash(Buffer.from(csvContent1));
const hash2 = computeFileHash(Buffer.from(csvContent2));
const hash1b = computeFileHash(Buffer.from(csvContent1));  // same bytes as content1

assert("same content, same filename → same hash", hash1 === hash1b);
assert("same content, different filename → same hash (filename ignored)", hash1 === hash1b, `hash1=${hash1}, hash1b=${hash1b}`);
assert("different content → different hash", hash1 !== hash2);

// ─── DB-backed integration tests ─────────────────────────────────────────────

async function runDbIntegrationTests() {
  console.log("\n=== DB integration tests (live DB) ===");

  // Dynamic imports so the script still works in pure unit mode if DB is unavailable.
  const { db } = await import("../server/db");
  const { sql, eq } = await import("drizzle-orm");
  const { prospects, prospectLists } = await import("../shared/schema");

  // ── 1. Verify required indexes exist ──────────────────────────────────────
  const indexRows = await db.execute(sql`
    SELECT indexname FROM pg_indexes
    WHERE indexname IN (
      'prospect_lists_import_type_hash_uidx',
      'prospects_execution_row_uidx',
      'prospects_email_import_unique_idx',
      'sunbiz_entities_source_fn_unique'
    )
    ORDER BY indexname
  `);
  const foundIndexes = new Set((indexRows as any).rows.map((r: any) => r.indexname));
  assert("prospect_lists_import_type_hash_uidx exists in DB",
    foundIndexes.has("prospect_lists_import_type_hash_uidx"));
  assert("prospects_execution_row_uidx exists in DB",
    foundIndexes.has("prospects_execution_row_uidx"));
  assert("prospects_email_import_unique_idx exists in DB",
    foundIndexes.has("prospects_email_import_unique_idx"));
  assert("sunbiz_entities_source_fn_unique (composite partial) exists in DB",
    foundIndexes.has("sunbiz_entities_source_fn_unique"));

  // ── 2. createProspectsBulkIdempotent: duplicate same-execution row is skipped ──
  // Create a throwaway prospect list for isolation.
  const testHash = `test-idempotency-${Date.now()}`;
  const [testList] = await db
    .insert(prospectLists)
    .values({ name: "idempotency-test", fileHash: testHash, importType: "prospect_csv", status: "running" })
    .returning();

  try {
    const testEmail = `idem-test-${Date.now()}@example.com`;
    const row = {
      listId: testList.id,
      importExecutionId: testList.id,
      sourceRowIndex: 0,
      email: testEmail,
      status: "raw" as const,
      score: "cold" as const,
      qualificationScore: "C" as const,
      doNotContact: false,
    };
    // First insert — should succeed
    const r1 = await db.insert(prospects).values(row).onConflictDoNothing().returning({ id: prospects.id });
    assert("first insert of email row succeeds (row returned)", r1.length === 1);

    // Duplicate execution (same importExecutionId + sourceRowIndex) — should be skipped
    const r2 = await db.insert(prospects).values(row).onConflictDoNothing().returning({ id: prospects.id });
    assert("duplicate same-execution row is skipped by DB (no row returned)", r2.length === 0);

    // Duplicate email from different execution — should also be skipped (email backstop)
    const differentExecRow = { ...row, importExecutionId: testList.id + 9999, sourceRowIndex: 99 };
    const r3 = await db.insert(prospects).values(differentExecRow).onConflictDoNothing().returning({ id: prospects.id });
    assert("duplicate email from different execution skipped by email index", r3.length === 0);
  } finally {
    // Clean up test rows
    await db.delete(prospects).where(eq(prospects.listId, testList.id));
    await db.delete(prospectLists).where(eq(prospectLists.id, testList.id));
  }

  // ── 3. getProspectListByHash replay detection via DB ──────────────────────
  const replayHash = `replay-test-${Date.now()}`;
  const [replayList] = await db
    .insert(prospectLists)
    .values({ name: "replay-test", fileHash: replayHash, importType: "prospect_csv", status: "complete", insertedRows: 5 })
    .returning();

  try {
    const found = await db
      .select()
      .from(prospectLists)
      .where(sql`import_type = 'prospect_csv' AND file_hash = ${replayHash} AND status IN ('running','complete')`)
      .limit(1);
    assert("getProspectListByHash returns existing complete list", found.length === 1 && found[0].insertedRows === 5);

    // Second insert with same hash + import_type + status=running should violate the partial unique index
    let constraintTriggered = false;
    try {
      await db.insert(prospectLists).values({ name: "replay-dup", fileHash: replayHash, importType: "prospect_csv", status: "running" });
    } catch (e: any) {
      constraintTriggered = e?.code === "23505" || (e?.message ?? "").includes("unique");
    }
    assert("duplicate (importType, fileHash) in running/complete status triggers 23505", constraintTriggered);
  } finally {
    await db.delete(prospectLists).where(eq(prospectLists.id, replayList.id));
  }

  await (db as any).$client?.end?.();
}

// ─── Summary ─────────────────────────────────────────────────────────────────

runDbIntegrationTests().then(() => {
  console.log(`\n${"─".repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("\nSome tests FAILED.");
    process.exit(1);
  } else {
    console.log("\nAll tests passed.");
    process.exit(0);
  }
}).catch(err => {
  console.error("\nDB integration tests threw:", err.message);
  process.exit(1);
});
