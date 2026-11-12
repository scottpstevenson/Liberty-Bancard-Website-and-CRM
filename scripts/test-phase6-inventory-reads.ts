import assert from "node:assert/strict";
import fs from "node:fs";
import { formatElapsed, describeInventoryProgress } from "../client/src/lib/read-progress";
import {
  LaunchInventoryDeadlineError, launchInventoryDeps, readLaunchInventoryProgress, readSfpLaunchInventory, resetLaunchInventoryForTests,
} from "../server/services/sfp-launch-inventory";

let checks = 0;
const ok = (value: unknown, message: string) => { assert.ok(value, message); checks++; };
const eq = <T>(actual: T, expected: T, message: string) => { assert.deepEqual(actual, expected, message); checks++; };

// CRM-09: an operator waiting on a read sees elapsed time and the server's reported phase; the report restates facts only.
eq(formatElapsed(0), "0 s", "zero elapsed");
eq(formatElapsed(12_900), "12 s", "whole seconds");
eq(formatElapsed(65_000), "1 min 5 s", "minutes and seconds");
eq(formatElapsed(-5), "0 s", "never negative");
eq(describeInventoryProgress(undefined), null, "no report says nothing");
eq(describeInventoryProgress({ state: "idle", elapsedMs: null, deadlineMs: 25000, phase: null, evaluated: null, total: null }), null, "idle says nothing about a count");
eq(describeInventoryProgress({ state: "running", elapsedMs: 4000, deadlineMs: 25000, phase: "recorded_facts", evaluated: null, total: null }),
  "Reading recorded recipient facts.", "phase without fabricated progress");
eq(describeInventoryProgress({ state: "running", elapsedMs: 9000, deadlineMs: 25000, phase: "contact_policy", evaluated: 1240, total: 1609 }),
  "Re-checking each contact against current rules: 1,240 of 1,609 done.", "evaluated of total is shown only when reported");

// Server: the progress report is in-memory, tracks the running flight, and never starts a read.
resetLaunchInventoryForTests();
eq(readLaunchInventoryProgress().state, "idle", "no flight, no progress claim");
const fake = (label: string) => ({ observedAt: label, maxAgeSeconds: 600, readyHeld: {}, pendingValidation: {}, byCountyAndVertical: [], sender: {}, releaseBlockers: [], notes: [] }) as any;
let releaseFirst: (value: any) => void = () => undefined;
let computations = 0;
launchInventoryDeps.compute = (ctx) => {
  computations++;
  ctx.phases.current = "contact_policy"; ctx.phases.policyTotal = 10; ctx.phases.policyEvaluated = 3; ctx.phases.policyReused = 2;
  if (computations === 1) return new Promise((resolve) => { releaseFirst = resolve; });
  return Promise.resolve(fake("second"));
};
const first = readSfpLaunchInventory({ deadlineMs: 5000 });
first.catch(() => undefined);
const running = readLaunchInventoryProgress();
eq([running.state, running.phase, running.evaluated, running.total], ["running", "contact_policy", 5, 10], "running flight reports its phase and progress");
ok(running.elapsedMs !== null && running.elapsedMs >= 0, "elapsed is reported");
eq(readLaunchInventoryProgress().state, "running", "reading progress twice does not change the flight");
eq(computations, 1, "watching progress never starts another read");
const joined = readSfpLaunchInventory({ deadlineMs: 5000 });
joined.catch(() => undefined);
eq(computations, 1, "a second caller joins the single flight (no repeated heavy work)");

// A fresh recount opens a new generation: the older flight is stopped, and its late result cannot become the cached answer.
const fresh = await readSfpLaunchInventory({ fresh: true, deadlineMs: 5000 });
eq(fresh.observedAt, "second", "fresh read returns its own result");
await assert.rejects(first, (error: unknown) => error instanceof LaunchInventoryDeadlineError, "the superseded flight is reported as stopped, not as a count");
checks++;
releaseFirst(fake("late-old"));
await new Promise((resolve) => setTimeout(resolve, 20));
const cached = await readSfpLaunchInventory({});
eq(cached.observedAt, "second", "a late result from an older generation never overwrites the newer cached answer");
eq(computations, 2, "the cached answer is served without another recount");
eq(readLaunchInventoryProgress().state, "idle", "a settled read reports idle");

// A timed-out read is an error with its phase, never a zero-filled inventory.
resetLaunchInventoryForTests();
const keepAlive = setInterval(() => undefined, 10); // the read's deadline timer is unref'd, as in production
launchInventoryDeps.compute = (ctx) => { ctx.phases.current = "contact_policy"; ctx.phases.policyTotal = 8; ctx.phases.policyEvaluated = 1; return new Promise(() => undefined); };
await assert.rejects(readSfpLaunchInventory({ deadlineMs: 30 }), (error: unknown) =>
  error instanceof LaunchInventoryDeadlineError && error.phase === "contact_policy" && error.progress?.total === 8);
checks++;
clearInterval(keepAlive);
resetLaunchInventoryForTests();

// Source guards: no timeout was raised, no background recount loop was added, and failure is not zero.
const backlogService = fs.readFileSync("server/services/canonical-enrichment-backlog.ts", "utf8");
const inventoryService = fs.readFileSync("server/services/sfp-launch-inventory.ts", "utf8");
ok(/BACKLOG_DEADLINE_MS = 25_000/.test(backlogService) && /LAUNCH_INVENTORY_DEADLINE_MS = 25_000/.test(inventoryService), "deadlines are unchanged at 25 s");
const client = fs.readFileSync("client/src/pages/dashboard/CanonicalBacklog.tsx", "utf8");
const intervals = [...client.matchAll(/refetchInterval:\s*([^,}]+)/g)].map((m) => m[1].trim());
eq(intervals, ["busy ? 3000 : false"], "the only interval in the backlog page is the in-memory progress report, and only while a read is busy");
ok(/staleTime: Infinity/.test(client), "aggregate reads still refresh only on entry or explicit refresh");
ok(/launch-inventory\/progress/.test(client) && /enabled: busy/.test(client), "progress is read only while the inventory read is busy");

console.log(`phase6 inventory reads: ok (${checks} checks)`);
process.exit(0);
