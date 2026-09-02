#!/usr/bin/env npx tsx
/**
 * stage-bounded-selection.ts
 *
 * Manual, operator-supervised bounded candidate-selection command for CRO-03A.
 *
 * PURPOSE
 * -------
 * Provides a controlled, auditable path to stage and qualify a specific bounded
 * population of source records for the CRO-03 canary and initial-batch phases.
 * This tool is the ONLY approved alternative to the global census endpoint when
 * a targeted, operator-confirmed canary population is required.
 *
 * SAFETY GUARANTEES
 * -----------------
 *  1. Dry-run by default — no writes until --apply is passed.
 *  2. Source-specific — never advances unrelated cursors.
 *  3. Uses the real source adapter (prospectSourceSubject / sunbizSourceSubject).
 *  4. Uses the real qualification evaluator (evaluateCro03aCandidate).
 *  5. Requires explicit operator confirmation of the frozen population hash before apply.
 *  6. Stages rows through the existing canonical CRO-03 source-staging authority.
 *  7. Creates ONE qualification run through the corrected batch processor.
 *  8. Does NOT directly insert decisions or handoffs.
 *  9. Does NOT create recurring schedules or activate providers.
 * 10. Idempotent — re-run with the same idempotency key replays without side effects.
 *
 * USAGE
 * -----
 *   # Dry-run preview — no writes
 *   npx tsx scripts/stage-bounded-selection.ts \
 *     --source sunbiz \
 *     --min-id 1 --max-id 50000 \
 *     --max-inspect 500 --max-stage 100 \
 *     --policy-version 1 \
 *     --geo-ref-version south-florida-fips-v2 \
 *     --reason "Phase 5 canary population — operator: scott" \
 *     --operator-id "<actor-uuid>" \
 *     --idempotency-key "bounded-sel-2026-09-02-001"
 *
 *   # Apply after reviewing the preview hash
 *   npx tsx scripts/stage-bounded-selection.ts \
 *     [same flags] \
 *     --apply \
 *     --confirm-population-hash "<hash from dry-run output>"
 *
 * FLAGS
 * -----
 *   --source          sunbiz | prospects   (required)
 *   --min-id          Minimum source entity ID (inclusive)
 *   --max-id          Maximum source entity ID (inclusive)
 *   --max-inspect     Maximum rows to read from DB (default 500, max 2000)
 *   --max-stage       Maximum new rows to stage (default 50, max 200)
 *   --policy-version  Required active policy version (integer, required)
 *   --geo-ref-version Required geography reference version (required)
 *   --reason          Operator-supplied reason string (required)
 *   --operator-id     Actor UUID for audit trail (required)
 *   --idempotency-key Unique key for this operation (required)
 *   --apply           Actually write staging + qualification run
 *   --confirm-population-hash  Required with --apply; must match dry-run output
 */

import crypto from "node:crypto";
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { prospects } from "../server/db/schema";
import {
  evaluateCro03aCandidate,
  CRO03A_FIT_V2_POLICY_IDENTITY,
} from "../server/services/cro03a/fit";
import {
  evaluateSouthFloridaGeography,
  CRO03A_GEOGRAPHY_REFERENCE_VERSION,
} from "../server/services/cro03a/geography";
import { prospectSourceSubject, sunbizSourceSubject } from "../server/services/cro03a/adapters";
import { createCro03SourceBatch } from "../server/services/cro03/source-staging";
import {
  createCro03aQualificationRun,
  processCro03aQualificationRunBatch,
} from "../server/services/cro03a/qualification-service";
import type { Cro03aSourceDraft } from "../server/services/cro03a/qualification-service";

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------
function arg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
}
function flag(f: string): boolean { return process.argv.includes(f); }

const SOURCE = arg("--source");
const MIN_ID = Number(arg("--min-id") ?? "1");
const MAX_ID = Number(arg("--max-id") ?? "999999999");
const MAX_INSPECT = Math.min(2000, Math.max(1, Number(arg("--max-inspect") ?? "500")));
const MAX_STAGE = Math.min(200, Math.max(1, Number(arg("--max-stage") ?? "50")));
const POLICY_VERSION = arg("--policy-version");
const GEO_REF_VERSION = arg("--geo-ref-version") ?? CRO03A_GEOGRAPHY_REFERENCE_VERSION;
const REASON = arg("--reason");
const OPERATOR_ID = arg("--operator-id");
const IDEMPOTENCY_KEY = arg("--idempotency-key");
const APPLY = flag("--apply");
const CONFIRM_HASH = arg("--confirm-population-hash");

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
function exitWith(msg: string): never {
  console.error(`\nERROR: ${msg}\n`);
  process.exit(1);
}

if (!SOURCE || !["sunbiz", "prospects"].includes(SOURCE))
  exitWith("--source must be 'sunbiz' or 'prospects'");
if (!POLICY_VERSION) exitWith("--policy-version is required");
if (!REASON) exitWith("--reason is required");
if (!OPERATOR_ID) exitWith("--operator-id is required");
if (!IDEMPOTENCY_KEY) exitWith("--idempotency-key is required");
if (GEO_REF_VERSION !== CRO03A_GEOGRAPHY_REFERENCE_VERSION)
  exitWith(`--geo-ref-version must match active version "${CRO03A_GEOGRAPHY_REFERENCE_VERSION}"`);
if (APPLY && !CONFIRM_HASH)
  exitWith("--apply requires --confirm-population-hash (value from dry-run output)");

// Helper to read raw SQL rows
function rows(result: any): Record<string, unknown>[] {
  return Array.isArray(result.rows) ? result.rows : (result as any);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("\n=== CRO-03A Bounded Candidate Selection ===");
  console.log(`  Mode:           ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log(`  Source:         ${SOURCE}`);
  console.log(`  ID range:       ${MIN_ID}–${MAX_ID}`);
  console.log(`  Max inspect:    ${MAX_INSPECT}`);
  console.log(`  Max stage:      ${MAX_STAGE}`);
  console.log(`  Policy version: ${POLICY_VERSION}`);
  console.log(`  Geo ref:        ${GEO_REF_VERSION}`);
  console.log(`  Reason:         ${REASON}`);
  console.log(`  Operator:       ${OPERATOR_ID}`);
  console.log(`  Idem key:       ${IDEMPOTENCY_KEY}`);

  // ── 1. Verify active policy ─────────────────────────────────────────────
  const policyRows = rows(await db.execute(sql`
    SELECT id, version, policy_hash, is_active
    FROM cro03a_qualification_policies
    WHERE is_active = true
    ORDER BY version DESC LIMIT 1
  `));
  if (!policyRows.length) exitWith("No active qualification policy found.");
  const policy = policyRows[0];
  if (String(policy.version) !== POLICY_VERSION)
    exitWith(`Active policy version is ${policy.version}, but --policy-version=${POLICY_VERSION} was required.`);
  console.log(`\n  Active policy: ${policy.id} v${policy.version} (hash: ${String(policy.policy_hash).slice(0, 16)}…)`);

  // ── 2. Fetch candidate rows from source ─────────────────────────────────
  console.log(`\n── Step 1: Inspect source rows (${SOURCE}, IDs ${MIN_ID}–${MAX_ID}, limit ${MAX_INSPECT}) ──`);

  let sourceRows: Record<string, unknown>[] = [];
  if (SOURCE === "sunbiz") {
    sourceRows = rows(await db.execute(sql`
      SELECT id, filing_number AS "filingNumber", entity_name AS "entityName",
             entity_status AS "entityStatus", principal_city AS "principalCity",
             principal_state AS "principalState", principal_zip AS "principalZip",
             principal_address AS "principalAddress",
             email, phone, website, updated_at AS "updatedAt"
      FROM sunbiz_entities
      WHERE id >= ${MIN_ID} AND id <= ${MAX_ID}
        AND entity_status = 'Active'
      ORDER BY id
      LIMIT ${MAX_INSPECT}
    `));
  } else {
    sourceRows = rows(await db.execute(sql`
      SELECT id, company_name AS "companyName", email,
             owner_email AS "ownerEmail", phone, owner_phone AS "ownerPhone",
             website, city, state, zip, vertical, status, updated_at AS "updatedAt",
             list_id AS "listId", contact_id AS "contactId",
             conversion_contact_id AS "conversionContactId",
             do_not_contact AS "doNotContact"
      FROM prospects
      WHERE id >= ${MIN_ID} AND id <= ${MAX_ID}
      ORDER BY id
      LIMIT ${MAX_INSPECT}
    `));
  }
  console.log(`  Rows fetched:   ${sourceRows.length}`);

  // ── 3. Convert to source drafts using real adapter ──────────────────────
  const drafts: Array<{ draft: Cro03aSourceDraft; sourceId: number | string }> = sourceRows.map(row => ({
    draft: SOURCE === "sunbiz" ? sunbizSourceSubject(row) : prospectSourceSubject(row),
    sourceId: row.id as number,
  }));

  // ── 4. Check already-staged and already-qualified ───────────────────────
  const idempotencyKeys = drafts.map(d =>
    `cro03a-census:${d.draft.subjectType}:${d.draft.sourceSystem}:${d.draft.sourceEventKey}`
  );

  const alreadyStagedRows = rows(await db.execute(sql`
    SELECT idempotency_key FROM cro03_source_staging_log
    WHERE idempotency_key = ANY(${idempotencyKeys}::text[])
  `));
  const alreadyStagedKeys = new Set(alreadyStagedRows.map((r: any) => String(r.idempotency_key)));

  const subjectKeys = drafts.map(d => d.draft.sourceEventKey);
  const alreadyQualifiedRows = rows(await db.execute(sql`
    SELECT s.subject_key FROM cro03_source_subjects s
    JOIN cro03_source_occurrences o ON o.source_subject_id = s.id
    JOIN cro03a_qualification_items qi ON qi.occurrence_id = o.id
    WHERE s.source_system = ${SOURCE === "sunbiz" ? "sunbiz" : "prospects"}
    AND s.subject_key = ANY(${subjectKeys}::text[])
  `));
  const alreadyQualifiedKeys = new Set(alreadyQualifiedRows.map((r: any) => String(r.subject_key)));

  // Check existing relationships
  const draftSubjectKeys = drafts.map(d => d.draft.subjectKey);
  const existingRelRows = rows(await db.execute(sql`
    SELECT s.subject_key FROM cro03_source_subjects s
    JOIN cro03a_qualification_decisions d ON d.occurrence_id IN (
      SELECT o.id FROM cro03_source_occurrences o WHERE o.source_subject_id = s.id
    )
    WHERE s.subject_key = ANY(${draftSubjectKeys}::text[])
      AND d.disposition IN ('selected','existing_relationship')
  `));
  const existingRelKeys = new Set(existingRelRows.map((r: any) => String(r.subject_key)));

  console.log(`  Already staged: ${alreadyStagedKeys.size}`);
  console.log(`  Already qualified: ${alreadyQualifiedKeys.size}`);
  console.log(`  Existing relationships: ${existingRelKeys.size}`);

  // ── 5. Preview: run the real evaluator in memory ─────────────────────────
  console.log(`\n── Step 2: Preview qualification (real adapter + evaluator) ──`);

  const policyObj = {
    id: String(policy.id),
    version: Number(policy.version),
    hash: String(policy.policy_hash),
    fitVersion: "fit-v2" as const,
    ...CRO03A_FIT_V2_POLICY_IDENTITY,
  };

  type PreviewRow = {
    sourceId: number | string;
    subjectKey: string;
    idemKey: string;
    alreadyStaged: boolean;
    alreadyQualified: boolean;
    existingRelationship: boolean;
    disposition: string;
    score: number;
    reasonCodes: string[];
    geographyClass: string;
    geoEligible: boolean;
    targetVertical: boolean;
    active: boolean;
    missingFieldClasses: string[];
  };

  const previewRows: PreviewRow[] = [];
  for (const { draft, sourceId } of drafts) {
    const idemKey = `cro03a-census:${draft.subjectType}:${draft.sourceSystem}:${draft.sourceEventKey}`;
    const alreadyStaged = alreadyStagedKeys.has(idemKey);
    const alreadyQualified = alreadyQualifiedKeys.has(draft.sourceEventKey);
    const existingRelationship = existingRelKeys.has(draft.subjectKey);

    // Run the real evaluator against the draft payload
    const candidate = {
      subjectType: draft.subjectType,
      sourceSystem: draft.sourceSystem,
      subjectKey: draft.subjectKey,
      payload: draft.payload,
      provenance: draft.provenance,
      priorHandoffBySourceKey: existingRelationship,
      priorHandoffBySubjectKey: existingRelationship,
      priorSelectedBySubjectKey: existingRelationship,
    };
    const result = evaluateCro03aCandidate(candidate, policyObj);

    previewRows.push({
      sourceId,
      subjectKey: draft.subjectKey,
      idemKey,
      alreadyStaged,
      alreadyQualified,
      existingRelationship,
      disposition: result.disposition,
      score: result.score,
      reasonCodes: result.reasonCodes,
      geographyClass: result.geographyResult.evidenceClass,
      geoEligible: result.geographyResult.eligible,
      targetVertical: result.verticalResult.targetVertical && !result.verticalResult.needsReview,
      active: result.activeStateEvidence.active && !result.activeStateEvidence.synthetic,
      missingFieldClasses: result.missingFieldClasses,
    });
  }

  // ── 6. Compute disposition census and identify selected ─────────────────
  const dispositionCounts: Record<string, number> = {};
  const reasonCodeCounts: Record<string, number> = {};
  for (const row of previewRows) {
    dispositionCounts[row.disposition] = (dispositionCounts[row.disposition] ?? 0) + 1;
    for (const rc of row.reasonCodes) {
      reasonCodeCounts[rc] = (reasonCodeCounts[rc] ?? 0) + 1;
    }
  }

  const selectedRows = previewRows.filter(r => r.disposition === "selected" && !r.alreadyStaged && !r.alreadyQualified);
  const toStage = selectedRows.slice(0, MAX_STAGE);

  // Population hash = deterministic hash of the selected subject keys + policy + geo ref
  const populationInput = JSON.stringify({
    source: SOURCE,
    idempotencyKey: IDEMPOTENCY_KEY,
    policyId: String(policy.id),
    policyVersion: Number(policy.version),
    geoRefVersion: GEO_REF_VERSION,
    selectedSubjectKeys: toStage.map(r => r.subjectKey).sort(),
  });
  const populationHash = crypto.createHash("sha256").update(populationInput).digest("hex");

  // ── 7. Print preview report ──────────────────────────────────────────────
  console.log(`\n  Rows inspected:        ${previewRows.length}`);
  console.log(`  Already staged:        ${previewRows.filter(r => r.alreadyStaged).length}`);
  console.log(`  Already qualified:     ${previewRows.filter(r => r.alreadyQualified).length}`);
  console.log(`  Existing relationship: ${previewRows.filter(r => r.existingRelationship).length}`);

  console.log("\n  Predicted disposition breakdown:");
  for (const [disp, cnt] of Object.entries(dispositionCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${disp.padEnd(24)} ${cnt}`);
  }

  console.log("\n  Top reason codes:");
  for (const [rc, cnt] of Object.entries(reasonCodeCounts).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`    ${rc.padEnd(40)} ${cnt}`);
  }

  console.log(`\n  New 'selected' candidates: ${selectedRows.length}`);
  console.log(`  Will stage (capped at ${MAX_STAGE}): ${toStage.length}`);

  if (toStage.length > 0) {
    console.log("\n  Selected candidates to stage:");
    for (const r of toStage) {
      console.log(`    sourceId=${r.sourceId} subjectKey=${r.subjectKey} score=${r.score} geo=${r.geographyClass}`);
    }
  }

  console.log(`\n  Population hash: ${populationHash}`);

  if (!APPLY) {
    console.log("\n  ── DRY-RUN COMPLETE (no writes performed) ──");
    console.log("  To apply, re-run with: --apply --confirm-population-hash " + populationHash);
    process.exit(0);
  }

  // ── 8. Apply — verify population hash ──────────────────────────────────
  if (CONFIRM_HASH !== populationHash)
    exitWith(`Population hash mismatch.\n  Expected: ${populationHash}\n  Provided: ${CONFIRM_HASH}`);

  if (toStage.length === 0) {
    console.log("\n  No new selected candidates to stage. Nothing to do.");
    process.exit(0);
  }

  // ── 9. Stage selected rows via canonical source-staging ─────────────────
  console.log("\n── Step 3: Staging selected rows ──");
  let createdCount = 0;
  let replayedCount = 0;
  const stagedOccurrenceIds: string[] = [];

  for (const row of toStage) {
    const draft = SOURCE === "sunbiz"
      ? sunbizSourceSubject(sourceRows.find(r => String(r.id) === String(row.sourceId))!)
      : prospectSourceSubject(sourceRows.find(r => String(r.id) === String(row.sourceId))!);

    const batchResult = await createCro03SourceBatch({
      idempotencyKey: row.idemKey,
      actorId: OPERATOR_ID!,
      drafts: [draft],
      reason: REASON!,
    });

    const staged = batchResult[0];
    if (staged.created) { createdCount++; } else { replayedCount++; }
    if (staged.occurrenceId) stagedOccurrenceIds.push(staged.occurrenceId);
  }

  console.log(`  Created:  ${createdCount}`);
  console.log(`  Replayed: ${replayedCount}`);
  console.log(`  Occurrence IDs: ${stagedOccurrenceIds.join(", ")}`);

  if (stagedOccurrenceIds.length === 0) {
    console.log("\n  No occurrence IDs returned — nothing to qualify.");
    process.exit(0);
  }

  // ── 10. Create and run one qualification run ─────────────────────────────
  console.log("\n── Step 4: Creating qualification run ──");
  const run = await createCro03aQualificationRun({
    actorId: OPERATOR_ID!,
    occurrenceIds: stagedOccurrenceIds,
    reason: `${REASON} [bounded-sel:${IDEMPOTENCY_KEY}]`,
  });
  console.log(`  Run ID: ${run.id}  total=${run.totalCount}`);

  console.log("\n── Step 5: Running batch processor ──");
  const start = Date.now();
  const result = await processCro03aQualificationRunBatch(run.id);
  const ms = Date.now() - start;

  if (result) {
    console.log(`  Completed in ${ms}ms`);
    console.log(`  selected=${result.selectedCount}  review=${result.reviewCount}  terminal=${result.terminalCount}`);
  } else {
    console.log(`  Batch processor returned null (cancelled or already complete)`);
  }

  // ── 11. Summary ──────────────────────────────────────────────────────────
  const handoffRows = rows(await db.execute(sql`
    SELECT id, source_key FROM cro03a_handoffs WHERE run_id = ${run.id}::uuid
  `));
  console.log(`\n  Handoffs written for this run: ${handoffRows.length}`);
  handoffRows.forEach((h: any) => console.log(`    ${h.id} → ${h.source_key}`));

  const totalHandoffs = rows(await db.execute(sql`
    SELECT COUNT(*) AS cnt FROM cro03a_handoffs WHERE effect_authorized = false
  `));
  console.log(`\n  Total unconsumed handoffs (all runs): ${(totalHandoffs[0] as any).cnt}`);

  console.log("\n=== BOUNDED SELECTION COMPLETE ===");
}

main().catch(err => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
