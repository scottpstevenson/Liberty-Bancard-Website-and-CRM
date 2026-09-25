#!/usr/bin/env npx tsx
/**
 * test-2002-fix-sunbiz-backfill-capability.ts
 *
 * Corrective patch to Task #2002: the `sunbiz-full-backfill` BullMQ queue had
 * no capability-group owner, so an admin Resume click could mark the run
 * 'running' in the DB while no selective worker profile actually executed
 * its recurring tick. This suite verifies the fix is pure logic over exported
 * constants/functions — no Redis or live DB required.
 *
 * Scenarios verified:
 *  1. `selective:sunbiz-backfill` selects exactly the `sunbiz-full-backfill` queue.
 *  2. No pre-existing selective group accidentally selects it.
 *  3. Enabling `sunbiz-backfill` never also selects outreach/sequences/GHL/SMS/voice queues.
 *  4. `enrichment,free-enrichment-lane,provider-live,email-validation,sunbiz-backfill`
 *     includes the backfill queue alongside the normal production enrichment set.
 *  5. getWorkerCapabilityStatus() reports selected=false for off/other profiles and
 *     selected=true only when `sunbiz-backfill` (or `full`) is active — pure profile logic,
 *     independent of whether a live QueueManager/Redis exists.
 */
import assert from "node:assert/strict";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓  ${label}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗  ${label}`);
    console.error(`     ${err.message}`);
    failed++;
    failures.push(label);
  }
}

function withEnv<T>(value: string | undefined, fn: () => T): T {
  const prev = process.env.BACKGROUND_JOB_PROFILE;
  if (value === undefined) delete process.env.BACKGROUND_JOB_PROFILE;
  else process.env.BACKGROUND_JOB_PROFILE = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.BACKGROUND_JOB_PROFILE;
    else process.env.BACKGROUND_JOB_PROFILE = prev;
  }
}

const {
  WORKER_CAPABILITY_GROUPS,
  getQueuesForCapabilityGroups,
  getSelectiveGroups,
} = await import("../server/services/background-profile.js");

const { getWorkerCapabilityStatus, QUEUE_NAMES } = await import("../server/services/queue-manager.js");

const BACKFILL_QUEUE = QUEUE_NAMES.SUNBIZ_FULL_BACKFILL;

test("1. WORKER_CAPABILITY_GROUPS['sunbiz-backfill'] exists and contains only sunbiz-full-backfill", () => {
  const queues = WORKER_CAPABILITY_GROUPS["sunbiz-backfill" as keyof typeof WORKER_CAPABILITY_GROUPS];
  assert.ok(queues, "'sunbiz-backfill' group must exist");
  assert.deepEqual([...queues], [BACKFILL_QUEUE], "group must contain exactly the sunbiz-full-backfill queue");
});

test("1b. selective:sunbiz-backfill selects exactly {sunbiz-full-backfill}", () => {
  withEnv("selective:sunbiz-backfill", () => {
    const groups = getSelectiveGroups();
    assert.deepEqual(groups, ["sunbiz-backfill"]);
    const queues = getQueuesForCapabilityGroups(groups);
    assert.deepEqual([...queues], [BACKFILL_QUEUE]);
  });
});

test("2. No pre-existing group other than sunbiz-backfill selects sunbiz-full-backfill", () => {
  for (const [group, queues] of Object.entries(WORKER_CAPABILITY_GROUPS)) {
    if (group === "sunbiz-backfill") continue;
    assert.ok(
      !(queues as readonly string[]).includes(BACKFILL_QUEUE),
      `group '${group}' must NOT include sunbiz-full-backfill`,
    );
  }
});

test("3. Enabling sunbiz-backfill never selects outreach/GHL/SMS/voice queues", () => {
  const forbidden = new Set([
    ...WORKER_CAPABILITY_GROUPS["outreach"],
    ...WORKER_CAPABILITY_GROUPS["ghl-integration"],
  ]);
  withEnv("selective:sunbiz-backfill", () => {
    const queues = getQueuesForCapabilityGroups(getSelectiveGroups());
    for (const q of queues) {
      assert.ok(!forbidden.has(q as any), `sunbiz-backfill must not select forbidden queue '${q}'`);
    }
  });
});

test("4. Normal production enrichment profile can include sunbiz-backfill alongside the standard groups", () => {
  withEnv(
    "selective:enrichment,free-enrichment-lane,provider-live,email-validation,sunbiz-backfill",
    () => {
      const queues = new Set(getQueuesForCapabilityGroups(getSelectiveGroups()));
      assert.ok(queues.has(BACKFILL_QUEUE), "backfill queue must be selected");
      assert.ok(queues.has("enrichment"), "enrichment queue must still be selected");
      assert.ok(queues.has("free-enrichment-lane"), "free-enrichment-lane queue must still be selected");
      assert.ok(queues.has("cro03c-live"), "provider-live queue must still be selected");
      assert.ok(queues.has("zerobounce-batch-validate"), "email-validation queue must still be selected");
    },
  );
});

test("5a. getWorkerCapabilityStatus reports selected=false when profile is off", () => {
  withEnv(undefined, () => {
    const status = getWorkerCapabilityStatus(BACKFILL_QUEUE);
    assert.equal(status.selected, false);
    assert.equal(status.activeProfile, "off");
  });
});

test("5b. getWorkerCapabilityStatus reports selected=false for an unrelated selective profile", () => {
  withEnv("selective:enrichment", () => {
    const status = getWorkerCapabilityStatus(BACKFILL_QUEUE);
    assert.equal(status.selected, false);
  });
});

test("5c. getWorkerCapabilityStatus reports selected=true when sunbiz-backfill is selected", () => {
  withEnv("selective:sunbiz-backfill", () => {
    const status = getWorkerCapabilityStatus(BACKFILL_QUEUE);
    assert.equal(status.selected, true);
    assert.deepEqual(status.selectedGroups, ["sunbiz-backfill"]);
  });
});

test("5d. getWorkerCapabilityStatus reports selected=true under profile=full", () => {
  withEnv("full", () => {
    const status = getWorkerCapabilityStatus(BACKFILL_QUEUE);
    assert.equal(status.selected, true);
  });
});

test("5e. getWorkerCapabilityStatus never throws before QueueManager initializes (queueManagerReady=false, workerActive=false)", () => {
  withEnv("selective:sunbiz-backfill", () => {
    const status = getWorkerCapabilityStatus(BACKFILL_QUEUE);
    // In this CLI process no QueueManager singleton has been constructed.
    assert.equal(status.queueManagerReady, false);
    assert.equal(status.workerActive, false);
  });
});

const { computeNextHighWaterEntityId } = await import("../server/services/sunbiz-full-backfill.js");

test("6a. cursor does not skip a retryable-failed row (reported regression)", () => {
  // afterId=0; batch examines ids 5 (fails, retryable) and 9 (succeeds).
  // Before the fix, maxIdSeen = max(0,5,9) = 9, permanently burying id 5.
  const next = computeNextHighWaterEntityId(
    0,
    [{ id: 5, filingNumber: "A" }, { id: 9, filingNumber: "B" }],
    [{ filingNumber: "A", outcome: "failed" }, { filingNumber: "B", outcome: "created" }],
  );
  assert.equal(next, 4, "cursor must stop just before the retryable-failed row's id (5), not advance to 9");
});

test("6b. cursor advances fully when no retryable failure occurred", () => {
  const next = computeNextHighWaterEntityId(
    0,
    [{ id: 5, filingNumber: "A" }, { id: 9, filingNumber: "B" }],
    [{ filingNumber: "A", outcome: "created" }, { filingNumber: "B", outcome: "matched_existing" }],
  );
  assert.equal(next, 9, "cursor advances to the batch max id when nothing is retryable");
});

test("6c. dead_letter (terminal, no more retries) does not block the cursor", () => {
  const next = computeNextHighWaterEntityId(
    0,
    [{ id: 5, filingNumber: "A" }, { id: 9, filingNumber: "B" }],
    [{ filingNumber: "A", outcome: "dead_letter" }, { filingNumber: "B", outcome: "created" }],
  );
  assert.equal(next, 9, "dead_letter is terminal, so the cursor may advance past it");
});

test("6d. multiple retryable failures: cursor stops before the lowest one", () => {
  const next = computeNextHighWaterEntityId(
    0,
    [{ id: 5, filingNumber: "A" }, { id: 7, filingNumber: "B" }, { id: 9, filingNumber: "C" }],
    [{ filingNumber: "A", outcome: "created" }, { filingNumber: "B", outcome: "failed" }, { filingNumber: "C", outcome: "failed" }],
  );
  assert.equal(next, 6, "cursor stops before the lowest still-retryable id (7)");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error("Failures:", failures);
  process.exit(1);
}
