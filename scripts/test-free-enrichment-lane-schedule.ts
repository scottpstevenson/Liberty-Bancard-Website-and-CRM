import assert from "node:assert/strict";
import {
  getFreeEnrichmentLaneStatus,
  getRepeatableNextRunAt,
} from "../server/services/free-enrichment-lane";

const now = Date.UTC(2026, 0, 1, 12, 7);
const intervalMs = 15 * 60 * 1000;

// BullMQ's own next timestamp takes precedence over fallback cadence math.
assert.equal(
  getRepeatableNextRunAt({ every: intervalMs, next: Date.UTC(2026, 0, 1, 12, 15) }, null, now),
  new Date(Date.UTC(2026, 0, 1, 12, 15)).toISOString(),
);

// The fallback uses the last completed run as its cadence anchor and always
// reports a future timestamp.
assert.equal(
  getRepeatableNextRunAt({ every: String(intervalMs) }, new Date(Date.UTC(2026, 0, 1, 12, 0)), now),
  new Date(Date.UTC(2026, 0, 1, 12, 15)).toISOString(),
);

// Without a last-run timestamp, BullMQ's every cadence is anchored at epoch.
assert.equal(
  getRepeatableNextRunAt({ every: intervalMs }, null, now),
  new Date(Date.UTC(2026, 0, 1, 12, 15)).toISOString(),
);
assert.equal(getRepeatableNextRunAt(undefined, null, now), null);

// Exercise the status service itself with a read-only mocked BullMQ queue and
// lightweight database reader. The queue's real repeatable metadata is the
// source of nextRunAt; no queue, worker, Redis connection, or scheduler starts.
let queryIndex = 0;
const db = {
  async execute() {
    const responses = [
      { rows: [{ value: { status: "idle", lastRunAt: null } }] },
      { rows: [{ examined: 0, enriched: 0, skipped: 0, failed: 0, running: 0 }] },
      { rows: [{ count: 3 }] },
    ];
    return responses[queryIndex++];
  },
};
const queue = {
  async getRepeatableJobs() {
    return [{
      id: "free-enrichment-lane-repeatable",
      every: intervalMs,
      next: Date.UTC(2026, 0, 1, 12, 15),
    }];
  },
  async getJobCounts() {
    return { active: 0 };
  },
};
const status = await getFreeEnrichmentLaneStatus({
  db,
  queueManager: {
    getQueue: () => queue,
    workers: new Map([["free-enrichment-lane", { isRunning: () => true }]]),
  },
});
assert.equal(status.nextRunAt, new Date(Date.UTC(2026, 0, 1, 12, 15)).toISOString());
assert.equal(status.queueRegistered, true);
assert.equal(status.workerRunning, true);
assert.equal(status.running, false);
assert.equal(status.status, "idle");

console.log("PASS free-enrichment status reads BullMQ nextRunAt and reports idle worker state");