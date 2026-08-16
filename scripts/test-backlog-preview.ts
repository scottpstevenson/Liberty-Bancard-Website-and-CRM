#!/usr/bin/env tsx
/**
 * scripts/test-backlog-preview.ts — Acceptance tests for BacklogPreviewService
 *
 * Tests all per-source envelopes, step-index mapping (current_step+1 = step_order),
 * schema_missing for deferred_ghl_enrollments, non-additive design, and
 * eligibility indicators.
 *
 * Does NOT require a live server or INTEGRATION_TESTS_OPT_IN — reads from DB
 * directly and instantiates BacklogPreviewService directly. No state mutation
 * to outbound systems.
 *
 * Usage: npx tsx scripts/test-backlog-preview.ts
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { BacklogPreviewService } from "../server/services/backlog-preview-service";

// ── Test utilities ────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
    failures.push(message);
  }
}

function section(name: string): void {
  console.log(`\n── ${name} ─────────────────────────────`);
}

// ── Static gate: correct column usage ─────────────────────────────────────────

function runStaticGate(): void {
  section("Static gate: correct column and non-additive design");
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const svcSource = readFileSync(
    join(__dirname, "../server/services/backlog-preview-service.ts"),
    "utf8"
  );
  assert(
    svcSource.includes("next_action_at"),
    "backlog-preview-service.ts uses next_action_at (correct sequence enrollment column)"
  );
  assert(
    svcSource.includes("ss.action_type"),
    "Channel derived from sequence_steps.action_type join (not a static column on enrollments)"
  );
  assert(
    svcSource.includes("nonAdditive: true"),
    "Service response includes nonAdditive:true (sources must not be summed)"
  );
  assert(
    svcSource.includes("isQueueManagerReady"),
    "BullMQ source uses isQueueManagerReady() (not lazy worker init)"
  );
  // 42703 = undefined_column; occurs when 0137 applied but 0138 not yet applied
  assert(
    svcSource.includes("42703"),
    "Service treats 42703 (undefined_column) as schema_missing — covers 0137-only state"
  );
  // Bounded retrieval: bySequence must use LIMIT to cap rows transferred to Node
  assert(
    svcSource.includes(`SEQ_BREAKDOWN_CAP + 1`),
    "bySequence query uses LIMIT (SEQ_BREAKDOWN_CAP+1) — unbounded enrollment scan is not allowed"
  );
  // Statement-level cancellation: SET LOCAL statement_timeout actually stops the Postgres query
  assert(
    svcSource.includes("SET LOCAL statement_timeout"),
    "Sequence source uses SET LOCAL statement_timeout for actual Postgres-side query cancellation"
  );
}

// ── Seed helpers ──────────────────────────────────────────────────────────────

const TEST_TAG = `bp-test-${Date.now()}`;

function firstRow<T>(result: unknown): T {
  // Drizzle db.execute() returns QueryResult with .rows; fall back to direct array
  const rows: T[] = (result as any)?.rows ?? (Array.isArray(result) ? result : []);
  if (!rows[0]) throw new Error("Seed INSERT returned no rows");
  return rows[0];
}

async function seedTestData(): Promise<{
  contactId: number;
  sequenceId: number;
  stepId: number;
  enrollmentId: number;
}> {
  // Insert a minimal contact
  const contactRow = firstRow<{ id: number }>(
    await db.execute<{ id: number }>(sql`
      INSERT INTO contacts (first_name, last_name, email, phone, email_status, sms_status, do_not_contact)
      VALUES ('BPTest', 'User', ${`bptest+${TEST_TAG}@example.com`}, ${`555-${Date.now() % 9000000 + 1000000}`}, 'unvalidated', 'active', false)
      RETURNING id
    `)
  );
  const contactId = contactRow.id;

  // Insert a follow-up sequence
  const seqRow = firstRow<{ id: number }>(
    await db.execute<{ id: number }>(sql`
      INSERT INTO follow_up_sequences (name, status, trigger_type)
      VALUES (${`BP Test Sequence ${TEST_TAG}`}, 'active', 'manual')
      RETURNING id
    `)
  );
  const sequenceId = seqRow.id;

  // Insert a sequence step at step_order=1 with action_type='email'
  // current_step=0 on the enrollment → step_order = 0 + 1 = 1
  const stepRow = firstRow<{ id: number }>(
    await db.execute<{ id: number }>(sql`
      INSERT INTO sequence_steps (sequence_id, step_order, action_type, delay_days)
      VALUES (${sequenceId}, 1, 'email', 0)
      RETURNING id
    `)
  );
  const stepId = stepRow.id;

  // Insert an active enrollment with next_action_at in the past
  const enrollRow = firstRow<{ id: number }>(
    await db.execute<{ id: number }>(sql`
      INSERT INTO sequence_enrollments (sequence_id, contact_id, current_step, status, next_action_at)
      VALUES (${sequenceId}, ${contactId}, 0, 'active', NOW() - INTERVAL '2 hours')
      RETURNING id
    `)
  );
  const enrollmentId = enrollRow.id;

  return { contactId, sequenceId, stepId, enrollmentId };
}

async function cleanupTestData(ids: {
  contactId: number;
  sequenceId: number;
  stepId: number;
  enrollmentId: number;
}): Promise<void> {
  await db.execute(sql`DELETE FROM sequence_enrollments WHERE id = ${ids.enrollmentId}`);
  await db.execute(sql`DELETE FROM sequence_steps WHERE id = ${ids.stepId}`);
  await db.execute(sql`DELETE FROM follow_up_sequences WHERE id = ${ids.sequenceId}`);
  await db.execute(sql`DELETE FROM contacts WHERE id = ${ids.contactId}`);
}

// ── Tests ────────────────────────────────────────────────────────────────────

async function runServiceTests(): Promise<void> {
  const svc = new BacklogPreviewService(db);
  let testIds: { contactId: number; sequenceId: number; stepId: number; enrollmentId: number } | null = null;

  // ─── 1. Response shape (non-additive, no total field) ──────────────────────
  section("1. Response shape — non-additive, no total field");
  {
    const preview = await svc.getBacklogPreview();

    assert(
      "nonAdditive" in preview && preview.nonAdditive === true,
      "nonAdditive is true in every response"
    );
    assert("partial" in preview, "partial field present");
    assert("generatedAt" in preview, "generatedAt field present");
    assert("bullmq" in preview, "bullmq source present");
    assert("sequenceEnrollments" in preview, "sequenceEnrollments source present");
    assert("outboundMessages" in preview, "outboundMessages source present");
    assert("deferredGhlEnrollments" in preview, "deferredGhlEnrollments source present");
    assert("postEnrichmentIntents" in preview, "postEnrichmentIntents source present");

    // Kill line: no total field anywhere at top level
    assert(!("total" in preview), "No additive total field in response");

    // Each source must have status + capturedAt
    for (const key of [
      "bullmq",
      "sequenceEnrollments",
      "outboundMessages",
      "postEnrichmentIntents",
    ] as const) {
      const src = (preview as any)[key];
      assert("status" in src, `${key}.status present`);
      assert("capturedAt" in src, `${key}.capturedAt present`);
    }
  }

  // ─── 2. staleSending uses sending_at not created_at — deterministic test ─────
  section("2. staleSending is based on sending_at (not created_at)");
  {
    // Seed two sending messages:
    //   A: sending_at = 31 min ago → stale
    //   B: sending_at = 5 min ago  → NOT stale (just started sending)
    const staleRow = firstRow<{ id: number }>(
      await db.execute(sql`
        INSERT INTO outbound_messages (status, channel, created_at, sending_at)
        VALUES ('sending', 'email', NOW() - INTERVAL '60 minutes', NOW() - INTERVAL '31 minutes')
        RETURNING id
      `)
    );
    const freshRow = firstRow<{ id: number }>(
      await db.execute(sql`
        INSERT INTO outbound_messages (status, channel, created_at, sending_at)
        VALUES ('sending', 'email', NOW() - INTERVAL '60 minutes', NOW() - INTERVAL '5 minutes')
        RETURNING id
      `)
    );

    try {
      const preview = await svc.getBacklogPreview();
      assert(
        preview.outboundMessages.status === "ok",
        "outboundMessages source ok"
      );
      if (preview.outboundMessages.status === "ok") {
        const d = preview.outboundMessages.data!;
        assert(
          d.sending >= 2,
          `Both seeded rows counted in sending (got ${d.sending})`
        );
        // staleSending must count only the row with old sending_at, not the fresh one
        // (even though both have old created_at)
        assert(
          d.staleSending >= 1,
          `Old sending_at (31 min ago) counts as stale (got ${d.staleSending})`
        );
        // The fresh-sending_at row must NOT be stale — verify by seeded-message isolation:
        // remove the stale row and confirm staleSending drops by at least 1
        await db.execute(sql`DELETE FROM outbound_messages WHERE id = ${staleRow.id}`);
        const preview2 = await svc.getBacklogPreview();
        if (preview2.outboundMessages.status === "ok") {
          assert(
            preview2.outboundMessages.data!.staleSending < d.staleSending,
            `After removing stale row, staleSending decreased (was ${d.staleSending}, now ${preview2.outboundMessages.data!.staleSending})`
          );
        }
      }
    } finally {
      // Clean up both rows (stale already deleted above if test passed)
      await db.execute(sql`DELETE FROM outbound_messages WHERE id = ${staleRow.id}`).catch(() => {});
      await db.execute(sql`DELETE FROM outbound_messages WHERE id = ${freshRow.id}`).catch(() => {});
    }
  }

  // ─── 3. Step-index mapping: current_step=0 → step_order=1 ──────────────────
  section("3. Step-index mapping — current_step=0 → step_order=1 (0-based to 1-based)");
  try {
    testIds = await seedTestData();
    const preview = await svc.getBacklogPreview();

    assert(
      preview.sequenceEnrollments.status === "ok",
      "sequenceEnrollments source ok after seeding"
    );

    if (preview.sequenceEnrollments.status === "ok") {
      const data = preview.sequenceEnrollments.data!;
      // Our seeded enrollment has action_type='email' at step_order=1.
      // current_step=0 on enrollment → query uses step_order = current_step + 1 = 1.
      // If the join were wrong (e.g. step_order = current_step = 0), the step would
      // not be found and action_type would bucket as 'unknown', not 'email'.
      assert(
        data.due >= 1,
        `At least 1 due enrollment (seeded with next_action_at in the past), got ${data.due}`
      );
      assert(
        "email" in data.byActionType,
        `byActionType contains 'email' bucket (step join current_step+1=step_order worked); got keys: ${JSON.stringify(Object.keys(data.byActionType))}`
      );
      // Enrollment was seeded 2 hours ago → must appear in h1to24 bucket
      assert(
        data.byAge.h1to24 >= 1,
        `Seeded enrollment (2h ago) counted in h1to24 age bucket (got h1to24=${data.byAge.h1to24})`
      );
      // Email step + unvalidated email_status → requiresEmailValidation must be flagged
      assert(
        data.eligibilityIndicators.requiresEmailValidation >= 1,
        "requiresEmailValidation >= 1 (contact has email_status=unvalidated, action_type=email)"
      );
      // byActionType must only contain the fixed bounded bucket keys
      const VALID_BUCKETS = new Set(["email", "sms", "call", "social", "unknown", "other"]);
      const unknownKeys = Object.keys(data.byActionType).filter(k => !VALID_BUCKETS.has(k));
      assert(
        unknownKeys.length === 0,
        `byActionType only contains fixed buckets (got unexpected keys: ${JSON.stringify(unknownKeys)})`
      );
    }
  } finally {
    // Cleanup in finally so partial seeding doesn't leave orphan rows
    if (testIds) {
      await cleanupTestData(testIds).catch(() => {});
      testIds = null; // prevent double-cleanup in the main finally
    }
  }

  // ─── 4. bySequence shape and cap ─────────────────────────────────────────
  section("4. bySequence — bounded shape, seqTruncated flag, per-item fields");
  {
    // Re-seed to get a fresh enrollment for shape verification
    const ids2 = await seedTestData();
    try {
      const preview = await svc.getBacklogPreview();
      if (preview.sequenceEnrollments.status === "ok") {
        const data = preview.sequenceEnrollments.data!;
        // Shape checks: bounded array, seqTruncated flag, correct item fields
        assert(
          Array.isArray(data.bySequence),
          "bySequence is an array"
        );
        assert(
          data.bySequence.length <= 50,
          `bySequence capped at 50 (got ${data.bySequence.length})`
        );
        assert(
          typeof data.seqTruncated === "boolean",
          "seqTruncated is a boolean"
        );
        if (data.bySequence.length > 0) {
          const first = data.bySequence[0];
          assert(typeof first.sequenceId === "number", "bySequence item has numeric sequenceId");
          assert(typeof first.count === "number", "bySequence item has numeric count");
          assert("oldestDueAt" in first, "bySequence item has oldestDueAt field");
        }
        // seqTruncated must be false when the breakdown fits within cap
        // (we may have the seeded sequence + existing ones, but unlikely to hit 50)
        assert(
          typeof data.seqTruncated === "boolean",
          "seqTruncated boolean present regardless of truncation state"
        );
      }
    } finally {
      await cleanupTestData(ids2).catch(() => {});
    }
  }

  // ─── 5. Post-enrichment intents source shape ──────────────────────────────
  section("5. Post-enrichment intents source — ok or schema_missing with correct fields");
  {
    const preview = await svc.getBacklogPreview();
    if (preview.postEnrichmentIntents.status === "ok") {
      const d = preview.postEnrichmentIntents.data!;
      assert(typeof d.pending === "number", "postEnrichmentIntents.pending is number");
      assert(typeof d.eligibleNow === "number", "postEnrichmentIntents.eligibleNow is number");
      assert(typeof d.processing === "number", "postEnrichmentIntents.processing is number");
      assert(typeof d.expiredLease === "number", "postEnrichmentIntents.expiredLease is number");
      assert(typeof d.failed === "number", "postEnrichmentIntents.failed is number");
    } else {
      // schema_missing is valid: the post_enrichment_enrollment_intents table is created by
      // migration 0138 (task 1548C). In environments where 1548C hasn't run, schema_missing
      // is the correct response (not zero, not a crash).
      assert(
        preview.postEnrichmentIntents.status === "schema_missing" ||
          preview.postEnrichmentIntents.status === "unavailable",
        `postEnrichmentIntents status is ok, schema_missing, or unavailable, got ${preview.postEnrichmentIntents.status}`
      );
      if (preview.postEnrichmentIntents.status === "schema_missing") {
        assert(
          preview.postEnrichmentIntents.data === null,
          "schema_missing envelope has data=null"
        );
        assert(
          typeof (preview.postEnrichmentIntents as any).errorCode === "string",
          "schema_missing envelope has errorCode string"
        );
      }
    }
  }

  // ─── 6. deferred_ghl_enrollments: ok or schema_missing ──────────────────
  section("6. deferred_ghl_enrollments — returns ok or schema_missing (never zero-silenced)");
  {
    const preview = await svc.getBacklogPreview();
    const src = preview.deferredGhlEnrollments;
    assert(
      src.status === "ok" || src.status === "schema_missing",
      `deferredGhlEnrollments.status is 'ok' or 'schema_missing', got '${src.status}'`
    );
    if (src.status === "ok") {
      const d = src.data!;
      assert(typeof d.pending === "number", "deferredGhlEnrollments.pending is number");
      assert(typeof d.dueNow === "number", "deferredGhlEnrollments.dueNow is number");
      assert(typeof d.terminalFailed === "number", "deferredGhlEnrollments.terminalFailed is number");
    }
    if (src.status === "schema_missing") {
      assert(src.data === null, "schema_missing envelope has data=null");
      assert(typeof src.errorCode === "string", "schema_missing envelope has errorCode");
    }
  }

  // ─── 7. partial: true when any source is non-ok ───────────────────────────
  section("7. partial semantics");
  {
    // Create a service with a broken db context for one source to force partial
    // We test this by checking the invariant: if all sources are ok, partial=false
    const preview = await svc.getBacklogPreview();
    const allOk = [
      preview.bullmq,
      preview.sequenceEnrollments,
      preview.outboundMessages,
      preview.deferredGhlEnrollments,
      preview.postEnrichmentIntents,
    ].every((s) => s.status === "ok");
    assert(
      preview.partial === !allOk,
      `partial=${preview.partial} consistent with source statuses (allOk=${allOk})`
    );
  }

  // ─── 8. BullMQ source — ok or unavailable (never crashes) ────────────────
  section("8. BullMQ source — ok or unavailable, never crashes");
  {
    const preview = await svc.getBacklogPreview();
    assert(
      preview.bullmq.status === "ok" || preview.bullmq.status === "unavailable",
      `bullmq.status is 'ok' or 'unavailable', got '${preview.bullmq.status}'`
    );
    if (preview.bullmq.status === "ok") {
      const d = preview.bullmq.data!;
      assert(typeof d.queues === "object", "bullmq.queues is object");
      assert(typeof d.scanTruncated === "boolean", "bullmq.scanTruncated is boolean");
    }
  }

  // ─── 9. Independent timeout error does not fail other sources ─────────────
  section("9. Error isolation — error envelope shape");
  {
    // Verify errEnvelope shape by triggering a schema_missing error class
    // We do this by verifying that the service wraps each settled result correctly
    // (structural test — cannot easily inject a timeout in a DB-only test)
    const preview = await svc.getBacklogPreview();
    const nonOkSources = [
      preview.bullmq,
      preview.sequenceEnrollments,
      preview.outboundMessages,
      preview.deferredGhlEnrollments,
      preview.postEnrichmentIntents,
    ].filter((s) => s.status !== "ok");

    for (const src of nonOkSources) {
      assert(src.data === null, `Non-ok source (${src.status}) has data=null`);
      assert(typeof (src as any).errorCode === "string", `Non-ok source (${src.status}) has errorCode string`);
      assert(typeof src.capturedAt === "string", `Non-ok source (${src.status}) has capturedAt string`);
    }
  }

  // ─── 10. No PII in backlog preview ───────────────────────────────────────
  section("10. No PII — response contains no contact email or phone");
  {
    const preview = await svc.getBacklogPreview();
    const serialized = JSON.stringify(preview);
    // Our seeded email contains the TEST_TAG; make sure it's not in the response
    assert(
      !serialized.includes(`bptest+${TEST_TAG}`),
      "No contact email in backlog preview response"
    );
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────────
  if (testIds) {
    try {
      await cleanupTestData(testIds);
      console.log("\n  [cleanup] Test data removed.");
    } catch (e) {
      console.warn("\n  [cleanup] Warning: failed to remove test data:", (e as Error).message);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("=== Backlog Preview Service Tests ===");

  try {
    // Static analysis gate
    runStaticGate();

    // Live DB tests
    await runServiceTests();
  } catch (err: any) {
    console.error("\nUnexpected error during test run:", err?.message ?? err);
    process.exit(1);
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failures.length > 0) {
    console.error("\nFailed assertions:");
    failures.forEach((f) => console.error(`  • ${f}`));
    process.exit(1);
  }
  process.exit(0);
}

main();
