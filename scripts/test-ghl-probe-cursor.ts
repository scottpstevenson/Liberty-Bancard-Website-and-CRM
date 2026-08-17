/**
 * Smoke test for the GHL half-open probe deterministic cursor (task #1593).
 * No live GHL calls — exercises runHalfOpenProbeTick() with stubbed
 * candidate-fetch and sync functions via its `deps` parameter, plus
 * __ghlCircuitTestHooks for state setup/inspection.
 *
 * Run: npx tsx scripts/test-ghl-probe-cursor.ts
 */
import {
  runHalfOpenProbeTick,
  resetGhlCircuit,
  __ghlCircuitTestHooks as hooks,
} from "../server/services/ghl-sync";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

type Candidate = { id: number };
type SyncResult = { success: boolean; error?: string };

/** Build a getCandidates stub over a fixed id-ascending dataset. */
function candidatesFrom(ids: number[]) {
  return async (limit: number, afterId: number): Promise<Candidate[]> =>
    ids.filter(id => id > afterId).slice(0, limit).map(id => ({ id }));
}

/** Build a syncFn stub from a per-id outcome map. */
function syncFrom(outcomes: Record<number, "success" | "skip" | "auth" | "failure">) {
  return async (contactId: number): Promise<SyncResult> => {
    switch (outcomes[contactId] ?? "success") {
      case "success": return { success: true };
      case "skip":    return { success: false, error: "ghl_identity_conflict" };
      case "auth":    return { success: false, error: "GHL API error 401: unauthorized" };
      case "failure": return { success: false, error: "GHL API error 500: boom" };
    }
  };
}

function freshHalfOpen(cursor = 0, probeSuccesses = 0) {
  hooks.setState({
    state: "half-open",
    consecutiveFailures: hooks.constants.threshold,
    halfOpenProbeSuccesses: probeSuccesses,
    halfOpenProbeCursorId: cursor,
    lastFullSuccessTickAt: Date.now(),
    restored: true,
  });
}

async function main() {
  const { probesRequired } = hooks.constants;

  console.log("\n[1] Lowest-id contact skips; second candidate succeeds — circuit advances");
  freshHalfOpen();
  await runHalfOpenProbeTick({
    getCandidates: candidatesFrom([32, 40, 41]),
    syncFn: syncFrom({ 32: "skip", 40: "success" }),
  });
  let s = hooks.getState();
  check("probe success recorded", s.halfOpenProbeSuccesses === 1, `got ${s.halfOpenProbeSuccesses}`);
  check("cursor advanced to succeeding candidate id", s.halfOpenProbeCursorId === 40, `got ${s.halfOpenProbeCursorId}`);
  check("circuit still half-open (1/" + probesRequired + " probes)", s.state === "half-open");

  console.log("\n[2] Consecutive skips advance within the page without changing counters");
  freshHalfOpen();
  await runHalfOpenProbeTick({
    getCandidates: candidatesFrom([10, 11, 12, 13]),
    syncFn: syncFrom({ 10: "skip", 11: "skip", 12: "skip", 13: "success" }),
  });
  s = hooks.getState();
  check("success after 3 skips", s.halfOpenProbeSuccesses === 1);
  check("consecutiveFailures unchanged", s.consecutiveFailures === hooks.constants.threshold);
  check("cursor at succeeding id 13", s.halfOpenProbeCursorId === 13);

  console.log("\n[3] All-skipped page: circuit stays half-open, cursor at last examined id");
  freshHalfOpen();
  const pageIds = Array.from({ length: 10 }, (_, i) => 100 + i); // 100..109
  const allSkip: Record<number, "skip"> = Object.fromEntries(pageIds.map(id => [id, "skip"])) as any;
  await runHalfOpenProbeTick({
    getCandidates: candidatesFrom([...pageIds, 200]),
    syncFn: syncFrom(allSkip),
  });
  s = hooks.getState();
  check("circuit remains half-open", s.state === "half-open");
  check("cursor at last examined id (109)", s.halfOpenProbeCursorId === 109, `got ${s.halfOpenProbeCursorId}`);
  check("no probe successes recorded", s.halfOpenProbeSuccesses === 0);
  // next tick resumes after cursor
  await runHalfOpenProbeTick({
    getCandidates: candidatesFrom([...pageIds, 200]),
    syncFn: syncFrom({ ...allSkip, 200: "success" }),
  });
  s = hooks.getState();
  check("next tick resumes after cursor and succeeds on 200", s.halfOpenProbeSuccesses === 1 && s.halfOpenProbeCursorId === 200);

  console.log("\n[4] Auth failure on any candidate immediately reopens the circuit");
  freshHalfOpen();
  let examined: number[] = [];
  await runHalfOpenProbeTick({
    getCandidates: candidatesFrom([1, 2, 3]),
    syncFn: async (id) => { examined.push(id); return syncFrom({ 1: "skip", 2: "auth" })(id); },
  });
  s = hooks.getState();
  check("circuit reopened (open)", s.state === "open");
  check("iteration stopped at auth failure", examined.length === 2, `examined ${examined.join(",")}`);

  console.log("\n[5] Provider failure reopens the circuit");
  freshHalfOpen();
  examined = [];
  await runHalfOpenProbeTick({
    getCandidates: candidatesFrom([1, 2, 3]),
    syncFn: async (id) => { examined.push(id); return syncFrom({ 1: "skip", 2: "failure" })(id); },
  });
  s = hooks.getState();
  check("circuit reopened (open)", s.state === "open");
  check("probe successes reset", s.halfOpenProbeSuccesses === 0);
  check("iteration stopped at provider failure", examined.length === 2, `examined ${examined.join(",")}`);

  console.log("\n[6] Skips never increment halfOpenProbeSuccesses or consecutiveGhlFailures");
  freshHalfOpen();
  hooks.setState({ consecutiveFailures: 2 });
  await runHalfOpenProbeTick({
    getCandidates: candidatesFrom([5, 6]),
    syncFn: syncFrom({ 5: "skip", 6: "skip" }),
  });
  s = hooks.getState();
  check("halfOpenProbeSuccesses stays 0", s.halfOpenProbeSuccesses === 0);
  check("consecutiveGhlFailures unchanged", s.consecutiveFailures === 2);
  check("circuit still half-open", s.state === "half-open");

  console.log("\n[7] Accumulating the required number of successful probes closes the circuit");
  freshHalfOpen();
  for (let i = 0; i < probesRequired; i++) {
    await runHalfOpenProbeTick({
      getCandidates: candidatesFrom([1000, 1001, 1002, 1003]),
      syncFn: syncFrom({}), // everything succeeds
    });
  }
  s = hooks.getState();
  check("circuit closed after " + probesRequired + " probe successes", s.state === "closed");
  check("cursor reset to 0 on close", s.halfOpenProbeCursorId === 0, `got ${s.halfOpenProbeCursorId}`);
  check("failures reset", s.consecutiveFailures === 0);

  console.log("\n[8] Empty page (cursor past end) wraps cursor to 0, circuit stays half-open");
  freshHalfOpen(9999, 1);
  await runHalfOpenProbeTick({
    getCandidates: candidatesFrom([1, 2, 3]), // nothing after 9999
    syncFn: syncFrom({}),
  });
  s = hooks.getState();
  check("cursor wrapped to 0", s.halfOpenProbeCursorId === 0);
  check("circuit remains half-open (not reopened)", s.state === "half-open");
  check("probe successes untouched by wrap", s.halfOpenProbeSuccesses === 1);

  console.log("\n[extra] manual reset clears the cursor");
  freshHalfOpen(555, 1);
  resetGhlCircuit();
  s = hooks.getState();
  check("resetGhlCircuit sets cursor to 0", s.halfOpenProbeCursorId === 0);
  check("resetGhlCircuit closes circuit", s.state === "closed");

  console.log(`\n${pass} passed, ${fail} failed`);
}

main().then(() => process.exit(fail === 0 ? 0 : 1)).catch((e) => {
  console.error("Test runner crashed:", e);
  process.exit(1);
});
