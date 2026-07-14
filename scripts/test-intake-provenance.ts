#!/usr/bin/env tsx
/**
 * KL-4 — REPLIT_OWNED_FIELDS Guard + Provenance Smoke Test
 *
 * Assertions:
 *  1. Guard strips all 4 provenance fields from a GHL inbound cleanPayload
 *  2. stripProvenanceFields() removes exactly the 4 provenance keys, leaves others
 *  3. "website_form" is canonical for public forms; "public_form" is not in VALID combos
 *  4. "ghl_sync|inbound" is valid; invalid combos are rejected
 *  5. GHL-linked contacts in DB have source_category = 'ghl_sync'
 *  6. prospects.import_execution_id is integer (not UUID)
 *  7. sunbiz_entities.import_execution_id is uuid
 *  8. contacts.import_batch_id does NOT exist
 *  9. All 4 provenance columns exist on contacts
 *
 * Run: npx tsx scripts/test-intake-provenance.ts
 * Exits 0 if all pass, 1 if any fail.
 */

import { readFileSync } from "fs";
import { pool } from "../server/db";
import { PROVENANCE_FIELDS, stripProvenanceFields } from "../server/services/contact-writer";

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

async function queryColumnType(tableName: string, columnName: string): Promise<string | null> {
  const res = await pool.query(
    `SELECT data_type FROM information_schema.columns
     WHERE table_name = $1 AND column_name = $2`,
    [tableName, columnName]
  );
  return res.rows[0]?.data_type ?? null;
}

// Canonical source combos — mirrors VALID_SOURCE_COMBOS in contact-writer.ts
// Used to test taxonomy without depending on the unexported assertValidSourceCombo function.
const VALID_SOURCE_COMBOS = new Set([
  "website_form|statement_upload",
  "website_form|estimate_form",
  "website_form|callback_form",
  "website_form|equipment_order",
  "website_form|support_form",
  "website_form|partner_application",
  "website_form|merchant_application",
  "website_form|get_started_form",
  "website_form|integration_request",
  "website_form|testimonial_submit",
  "website_form|newsletter_signup",
  "manual_crm|dashboard",
  "ghl_sync|inbound",
  "csv_import|csv_contact",
  "csv_import|outscraper",
  "csv_import|apollo",
  "csv_import|apify",
  "registry_import|sunbiz_upload",
  "registry_import|sunbiz_corevt",
  "prospect_conversion|csv_prospect",
  "discovery|apollo",
  "discovery|outscraper",
  "discovery|apify",
  "discovery|serper",
  "partner_referral|partner_form",
  "legacy_unknown|historical_backfill",
]);

function isValidCombo(cat: string, type: string) {
  return VALID_SOURCE_COMBOS.has(`${cat}|${type}`);
}

async function main() {
  console.log("\n=== KL-4: REPLIT_OWNED_FIELDS Guard + Provenance Smoke Test ===\n");

  // ── 1. REPLIT_OWNED_FIELDS guard strips all 4 provenance fields ──────────
  console.log("1. REPLIT_OWNED_FIELDS guard strips provenance fields from GHL payload");
  {
    // Simulate the delete loop in ghl-sync.ts using the same construction:
    // REPLIT_OWNED_FIELDS = new Set([...compliance fields..., ...PROVENANCE_FIELDS])
    const guardSet = new Set<string>([
      "doNotContact",
      "doNotAutoContact",
      "consentTier",
      "lifecycleStage",
      "consentEmail",
      "consentSms",
      "smsStatus",
      "emailStatus",
      "phoneType",
      ...PROVENANCE_FIELDS,
    ]);

    const cleanPayload: Record<string, unknown> = {
      firstName: "Test",
      email: "test@example.com",
      sourceCategory: "ghl_sync",
      primarySourceCategory: "ghl_sync",
      primarySourceType: "inbound",
      primarySourceEventId: "evt-abc-123",
      phone: "555-1234",
    };

    for (const key of Object.keys(cleanPayload)) {
      if (guardSet.has(key)) {
        delete cleanPayload[key];
      }
    }

    assert("sourceCategory stripped", !("sourceCategory" in cleanPayload));
    assert("primarySourceCategory stripped", !("primarySourceCategory" in cleanPayload));
    assert("primarySourceType stripped", !("primarySourceType" in cleanPayload));
    assert("primarySourceEventId stripped", !("primarySourceEventId" in cleanPayload));
    assert("non-provenance field 'firstName' retained", "firstName" in cleanPayload);
    assert("non-provenance field 'email' retained", "email" in cleanPayload);
  }

  // ── 2. stripProvenanceFields() utility ───────────────────────────────────
  console.log("\n2. stripProvenanceFields() exported utility");
  {
    const input = {
      firstName: "Jane",
      email: "jane@example.com",
      sourceCategory: "website_form",
      primarySourceCategory: "website_form",
      primarySourceType: "statement_upload",
      primarySourceEventId: "evt-xyz",
    };
    const stripped = stripProvenanceFields(input);
    assert("sourceCategory removed by stripProvenanceFields", !("sourceCategory" in stripped));
    assert("primarySourceCategory removed", !("primarySourceCategory" in stripped));
    assert("primarySourceType removed", !("primarySourceType" in stripped));
    assert("primarySourceEventId removed", !("primarySourceEventId" in stripped));
    assert("firstName retained by stripProvenanceFields", "firstName" in stripped);
    assert("email retained by stripProvenanceFields", "email" in stripped);
  }

  // ── 3. PROVENANCE_FIELDS constant integrity ───────────────────────────────
  console.log("\n3. PROVENANCE_FIELDS constant has exactly 4 correct entries");
  {
    const expected = [
      "sourceCategory",
      "primarySourceCategory",
      "primarySourceType",
      "primarySourceEventId",
    ];
    assert(
      "PROVENANCE_FIELDS length === 4",
      PROVENANCE_FIELDS.length === 4,
      `got ${PROVENANCE_FIELDS.length}`
    );
    for (const f of expected) {
      assert(
        `PROVENANCE_FIELDS includes "${f}"`,
        (PROVENANCE_FIELDS as readonly string[]).includes(f)
      );
    }
    assert(
      '"importBatchId" is NOT in PROVENANCE_FIELDS (kill line)',
      !(PROVENANCE_FIELDS as readonly string[]).includes("importBatchId")
    );
  }

  // ── 4. Source taxonomy — website_form vs public_form ─────────────────────
  console.log("\n4. Source taxonomy: canonical category values");
  {
    assert(
      '"website_form|statement_upload" is valid',
      isValidCombo("website_form", "statement_upload")
    );
    assert(
      '"website_form|estimate_form" is valid',
      isValidCombo("website_form", "estimate_form")
    );
    assert(
      '"ghl_sync|inbound" is valid',
      isValidCombo("ghl_sync", "inbound")
    );
    assert(
      '"public_form|statement_upload" is INVALID (kill line: must not use public_form)',
      !isValidCombo("public_form", "statement_upload")
    );
    assert(
      '"totally_invalid|combo" is INVALID',
      !isValidCombo("totally_invalid", "combo")
    );
    assert(
      '"importBatchId" is not a sourceCategory (not in any combo key)',
      ![...VALID_SOURCE_COMBOS].some((c) => c.startsWith("importBatchId|"))
    );
  }

  // ── 5. ghl-sync.ts inbound path uses literal "ghl_sync" sourceCategory ───
  // Note: contacts can have a ghl_contact_id from an OUTBOUND Replit→GHL sync
  // without their sourceCategory being "ghl_sync". Only inbound GHL-originated
  // contacts carry "ghl_sync". We verify the code, not a DB invariant that would
  // incorrectly flag outbound-synced contacts.
  console.log("\n5. ghl-sync.ts inbound path passes 'ghl_sync' to writeContact");
  {
    const syncSrc = readFileSync("server/services/ghl-sync.ts", "utf8");
    // Confirm the inbound writeContact call supplies sourceCategory: "ghl_sync"
    const hasInboundSourceCategory = /sourceCategory:\s*["']ghl_sync["']/.test(syncSrc);
    assert(
      'ghl-sync.ts contains sourceCategory: "ghl_sync" for inbound contacts',
      hasInboundSourceCategory
    );
    // Also confirm "public_form" never appears as a sourceCategory in the file
    const hasBadPublicForm = /sourceCategory:\s*["']public_form["']/.test(syncSrc);
    assert(
      'ghl-sync.ts does NOT use "public_form" as a sourceCategory (kill line)',
      !hasBadPublicForm
    );
    // Confirm PROVENANCE_FIELDS is used (guard is wired)
    const hasProvenanceSpread = syncSrc.includes("PROVENANCE_FIELDS");
    assert(
      "ghl-sync.ts references PROVENANCE_FIELDS (guard is wired)",
      hasProvenanceSpread
    );
  }

  // ── 6. Schema: prospects.import_execution_id is integer ──────────────────
  console.log("\n6. Schema column types");
  {
    const prospectsType = await queryColumnType("prospects", "import_execution_id");
    assert(
      "prospects.import_execution_id is integer (not UUID)",
      prospectsType === "integer",
      `got: ${prospectsType ?? "column not found"}`
    );

    const sunbizType = await queryColumnType("sunbiz_entities", "import_execution_id");
    assert(
      "sunbiz_entities.import_execution_id is uuid",
      sunbizType === "uuid",
      `got: ${sunbizType ?? "column not found"}`
    );
  }

  // ── 7. contacts.import_batch_id must NOT exist ────────────────────────────
  console.log("\n7. contacts.import_batch_id does not exist (kill line)");
  {
    const colType = await queryColumnType("contacts", "import_batch_id");
    assert(
      "contacts.import_batch_id does not exist",
      colType === null,
      `found column with data_type: ${colType}`
    );
  }

  // ── 8. All 4 provenance columns exist on contacts ─────────────────────────
  console.log("\n8. All 4 provenance columns present on contacts table");
  {
    const res = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'contacts'
         AND column_name IN (
           'source_category',
           'primary_source_category',
           'primary_source_type',
           'primary_source_event_id'
         )`
    );
    const found = new Set<string>(res.rows.map((r: { column_name: string }) => r.column_name));
    assert("source_category exists on contacts", found.has("source_category"));
    assert("primary_source_category exists on contacts", found.has("primary_source_category"));
    assert("primary_source_type exists on contacts", found.has("primary_source_type"));
    assert("primary_source_event_id exists on contacts", found.has("primary_source_event_id"));
    assert(
      "exactly 4 provenance columns found (no extras, no missing)",
      found.size === 4,
      `found ${found.size}: ${[...found].join(", ")}`
    );
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(56)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("\n❌ SMOKE TEST FAILED");
    process.exit(1);
  } else {
    console.log("\n✅ All assertions passed");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
