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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error("Failures:", failures);
  process.exit(1);
}
