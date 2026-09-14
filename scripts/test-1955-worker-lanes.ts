/**
 * scripts/test-1955-worker-lanes.ts
 *
 * Task #1955 — regression test for the WORKER_CAPABILITY_GROUPS lane split.
 *
 * Confirms:
 *   1. `heavy-maintenance` and the old 10-job `operations` group no longer exist.
 *   2. `db-backup` is selectable as its own group, independent of `system-audit`.
 *   3. `system-audit` is selectable as its own group, independent of `db-backup`.
 *   4. `health-monitor` is selectable independent of the other 9 `operations` jobs.
 *   5. `operations` no longer includes `health-monitor`.
 *   6. Every job that existed in the old `operations`/`heavy-maintenance` groups
 *      is still present in the new group set (no job silently dropped).
 *
 * Plain assertions, no test framework (per project convention).
 * Usage: npx tsx scripts/test-1955-worker-lanes.ts
 */
import { WORKER_CAPABILITY_GROUPS, getQueuesForCapabilityGroups } from "../server/services/background-profile";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`OK: ${msg}`);
  }
}

const groupNames = Object.keys(WORKER_CAPABILITY_GROUPS);

assert(!groupNames.includes("heavy-maintenance"), "'heavy-maintenance' group no longer exists");
assert(groupNames.includes("db-backup"), "'db-backup' group exists standalone");
assert(groupNames.includes("system-audit"), "'system-audit' group exists standalone");
assert(groupNames.includes("health-monitor"), "'health-monitor' group exists standalone");

const dbBackupQueues = getQueuesForCapabilityGroups(["db-backup"]);
assert(
  dbBackupQueues.includes("db-backup") && !dbBackupQueues.includes("system-audit"),
  "selecting only 'db-backup' does not also enable 'system-audit'",
);

const systemAuditQueues = getQueuesForCapabilityGroups(["system-audit"]);
assert(
  systemAuditQueues.includes("system-audit") && !systemAuditQueues.includes("db-backup"),
  "selecting only 'system-audit' does not also enable 'db-backup'",
);

const healthMonitorQueues = getQueuesForCapabilityGroups(["health-monitor"]);
const operationsQueues = getQueuesForCapabilityGroups(["operations"]);
assert(
  healthMonitorQueues.includes("health-monitor") && !healthMonitorQueues.includes("sla-checks"),
  "selecting only 'health-monitor' does not also enable the other 9 'operations' jobs",
);
assert(
  !operationsQueues.includes("health-monitor"),
  "'operations' group no longer includes 'health-monitor'",
);
assert(operationsQueues.length === 9, `'operations' group has exactly 9 jobs (found ${operationsQueues.length})`);

// No job silently dropped in the split: union of the 3 new groups must equal
// the old heavy-maintenance (db-backup, system-audit) + old 10-job operations
// (9 remaining + health-monitor) job sets.
const OLD_HEAVY_MAINTENANCE = ["db-backup", "system-audit"];
const OLD_OPERATIONS_10 = [
  "sla-checks", "digests", "mid-ingestion", "onboarding-reminder", "activation-monitor",
  "merchant-success", "executive-snapshot", "health-monitor", "pipeline-silence-check", "partner-monthly-digest",
];
const newUnion = [
  ...WORKER_CAPABILITY_GROUPS["db-backup"],
  ...WORKER_CAPABILITY_GROUPS["system-audit"],
  ...WORKER_CAPABILITY_GROUPS["health-monitor"],
  ...WORKER_CAPABILITY_GROUPS["operations"],
].sort();
const oldUnion = [...OLD_HEAVY_MAINTENANCE, ...OLD_OPERATIONS_10].sort();
assert(
  JSON.stringify(newUnion) === JSON.stringify(oldUnion),
  `no job silently dropped by the split (new: [${newUnion.join(",")}], old: [${oldUnion.join(",")}])`,
);

console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
