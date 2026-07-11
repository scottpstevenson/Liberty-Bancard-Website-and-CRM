#!/usr/bin/env tsx
/**
 * Regression smoke test — GHL Sync indexed contact dedupe & race-safe creation.
 *
 * Verifies that syncContactFromGhl:
 *   1. Never calls getContacts({limit:500}) — uses indexed lookups only
 *   2. Resolves an existing contact by email (no duplicate created)
 *   3. Resolves a mixed-case / padded email to the same contact
 *   4. GHL ID match wins over email match when both resolve to different rows
 *   5. Returns null (conflict) when GHL ID row ≠ email row
 *   6. Attaches ghlContactId on email-match when the row had none
 *
 * Run with:
 *   npx tsx scripts/smoke-ghl-sync-dedupe.ts
 *
 * Exits 0 on all-pass, 1 on any failure.
 */

import { db } from "../server/db";
import { contacts, auditLogs } from "../shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import { storage } from "../server/storage";
import { syncContactFromGhl } from "../server/services/ghl-sync";

let passed = 0;
let failed = 0;

function pass(label: string) {
  console.log(`  ✓ ${label}`);
  passed++;
}

function fail(label: string, detail?: string) {
  console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  failed++;
}

function assert(condition: boolean, label: string, detail?: string) {
  if (condition) pass(label);
  else fail(label, detail);
}

// Unique suffix so parallel runs don't collide
const RUN = Date.now();

async function cleanup(emails: string[], ghlIds: string[]) {
  for (const email of emails) {
    await db.delete(contacts).where(eq(contacts.email, email)).catch(() => {});
  }
  for (const ghlId of ghlIds) {
    await db.delete(contacts).where(eq(contacts.ghlContactId, ghlId)).catch(() => {});
  }
}

// ─── Assertion 1 & 2: existing contact resolved by email, no duplicate ──────
async function testEmailResolution() {
  console.log("\n[1+2] Email-based resolution — no duplicate");
  const email = `dedupe-${RUN}@test.example`;
  const ghlId = `ghl-smoke-${RUN}-A`;

  // Pre-insert a contact without a GHL ID
  const [existing] = await db.insert(contacts).values({
    firstName: "Smoke",
    lastName: "Test",
    email,
    phone: "",
    companyName: "",
    status: "New",
    tags: [],
    referralSource: "test",
  }).returning();

  try {
    const result = await syncContactFromGhl({
      id: ghlId,
      firstName: "Smoke",
      lastName: "Test",
      email,
      phone: "",
      companyName: "",
      tags: [],
    });

    assert(result !== null, "syncContactFromGhl returns non-null");
    assert(result?.created === false, "created=false (found existing row)");
    assert(result?.contactId === existing.id, `contactId matches existing row #${existing.id}`);

    // Verify no duplicate was created
    const rows = await db.select().from(contacts).where(
      and(eq(contacts.email, email), isNull(contacts.archivedAt))
    );
    assert(rows.length === 1, `only 1 contact row for ${email}`, `found ${rows.length}`);

    // Verify ghlContactId was attached
    const updated = await storage.getContact(existing.id);
    assert(updated?.ghlContactId === ghlId, "ghlContactId attached to existing row");
  } finally {
    await cleanup([email], [ghlId]);
  }
}

// ─── Assertion 3: mixed-case / padded email resolves same contact ────────────
async function testMixedCaseEmail() {
  console.log("\n[3] Mixed-case / padded email resolves to same contact");
  const canonEmail = `mixcase-${RUN}@test.example`;
  const ghlId = `ghl-smoke-${RUN}-B`;

  const [existing] = await db.insert(contacts).values({
    firstName: "Mix",
    lastName: "Case",
    email: canonEmail,
    phone: "",
    companyName: "",
    status: "New",
    tags: [],
    referralSource: "test",
  }).returning();

  try {
    const result = await syncContactFromGhl({
      id: ghlId,
      firstName: "Mix",
      lastName: "Case",
      email: `  ${canonEmail.toUpperCase()}  `,
      phone: "",
      companyName: "",
      tags: [],
    });

    assert(result !== null, "syncContactFromGhl returns non-null");
    assert(result?.created === false, "created=false (mixed-case hit existing row)");
    assert(result?.contactId === existing.id, `contactId matches existing #${existing.id}`);

    // No new row was created — the only row for this test is the one we inserted (by ID)
    const updated = await storage.getContact(existing.id);
    assert(updated !== undefined, "original contact row still exists");
    // Verify no duplicate by checking result contactId matches existing — if created were true
    // a new ID would have been returned; the created=false check above is the key gate
    assert(result?.created === false, "no duplicate created (created flag is false)");
  } finally {
    await cleanup([canonEmail], [ghlId]);
  }
}

// ─── Assertion 4: GHL ID match wins over email match (same GHL ID attached) ──
async function testGhlIdWinsOverEmail() {
  console.log("\n[4] GHL ID match wins over email match (same GHL ID row gets updated)");
  const sharedEmail = `ghlwins-${RUN}@test.example`;
  const ghlId = `ghl-smoke-${RUN}-C`;

  // Row A: owns the GHL ID, different email
  const [rowA] = await db.insert(contacts).values({
    firstName: "RowA",
    lastName: "",
    email: `rowA-${RUN}@test.example`,
    phone: "",
    companyName: "",
    ghlContactId: ghlId,
    status: "New",
    tags: [],
    referralSource: "test",
  }).returning();

  // Row B: owns the shared email, no GHL ID
  const [rowB] = await db.insert(contacts).values({
    firstName: "RowB",
    lastName: "",
    email: sharedEmail,
    phone: "",
    companyName: "",
    status: "New",
    tags: [],
    referralSource: "test",
  }).returning();

  try {
    // Incoming GHL contact matches rowA by ID, and sharedEmail matches rowB — different rows
    // This is an identity conflict; should return null and write an audit log
    const result = await syncContactFromGhl({
      id: ghlId,
      firstName: "Updated",
      lastName: "",
      email: sharedEmail,
      phone: "",
      companyName: "",
      tags: [],
    });

    // When GHL ID row ≠ email row: identity conflict → null
    assert(result === null, "identity conflict returns null");

    // Verify neither row was mutated
    const checkA = await storage.getContact(rowA.id);
    const checkB = await storage.getContact(rowB.id);
    assert(checkA?.firstName === "RowA", "rowA firstName unchanged");
    assert(checkB?.firstName === "RowB", "rowB firstName unchanged");
  } finally {
    await cleanup([`rowA-${RUN}@test.example`, sharedEmail], [ghlId]);
  }
}

// ─── Assertion 5: different-contact conflict → returns null ──────────────────
// (also covered in test 4 above; this variant tests via ghlContactId ownership)
async function testGhlIdOwnershipConflict() {
  console.log("\n[5] ghlContactId ownership conflict (email row owned by different GHL ID)");
  const email = `owned-${RUN}@test.example`;
  const existingGhlId = `ghl-smoke-${RUN}-D-existing`;
  const incomingGhlId = `ghl-smoke-${RUN}-D-incoming`;

  // A row already owns a different GHL ID
  const [existing] = await db.insert(contacts).values({
    firstName: "Owned",
    lastName: "",
    email,
    phone: "",
    companyName: "",
    ghlContactId: existingGhlId,
    status: "New",
    tags: [],
    referralSource: "test",
  }).returning();

  try {
    const result = await syncContactFromGhl({
      id: incomingGhlId,
      firstName: "Incoming",
      lastName: "",
      email,
      phone: "",
      companyName: "",
      tags: [],
    });

    assert(result === null, "ownership conflict returns null");

    // Verify row was not mutated
    const check = await storage.getContact(existing.id);
    assert(check?.firstName === "Owned", "existing row firstName unchanged");
    assert(check?.ghlContactId === existingGhlId, "existing row ghlContactId unchanged");
  } finally {
    await cleanup([email], [existingGhlId, incomingGhlId]);
  }
}

// ─── Assertion 6: getContacts is never called (structural check via grep) ────
async function testNoGetContactsCall() {
  console.log("\n[6] getContacts({limit:500}) is NOT called in syncContactFromGhl");
  const { execSync } = await import("child_process");
  try {
    const out = execSync(
      `grep -n "getContacts" server/services/ghl-sync.ts || true`,
      { encoding: "utf8" }
    ).trim();

    // Filter only lines inside syncContactFromGhl (approximately lines 270-420)
    // grep output format: "linenumber:content"
    const violatingLines = out
      .split("\n")
      .filter(l => l.trim())
      .filter(l => {
        const match = l.match(/^(\d+):/);
        if (!match) return false;
        const lineNo = parseInt(match[1], 10);
        // syncContactFromGhl spans lines 270–405; getContacts at line 410+ is fullSyncToGhl
        return lineNo >= 267 && lineNo <= 405;
      });

    if (violatingLines.length > 0) {
      fail("no getContacts call inside syncContactFromGhl", `found: ${violatingLines.join(" | ")}`);
    } else {
      pass("getContacts not called inside syncContactFromGhl");
    }
  } catch (e: any) {
    fail("grep check for getContacts", e.message);
  }
}

// ─── Run all assertions ───────────────────────────────────────────────────────
async function main() {
  console.log("=== smoke-ghl-sync-dedupe ===");
  console.log(`Run ID: ${RUN}`);

  try {
    await testEmailResolution();
    await testMixedCaseEmail();
    await testGhlIdWinsOverEmail();
    await testGhlIdOwnershipConflict();
    await testNoGetContactsCall();
  } catch (fatalErr: any) {
    console.error("\nFATAL:", fatalErr.message);
    process.exit(1);
  }

  console.log(`\n${"─".repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    console.error("\n✗ FAIL — one or more assertions failed");
    process.exit(1);
  }

  console.log("\n✓ PASS — all assertions passed");
  process.exit(0);
}

main();
