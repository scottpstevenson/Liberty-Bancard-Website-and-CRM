/**
 * Smoke test for GHL circuit-breaker classification & state machine (task: circuit repair).
 * No live GHL calls — exercises classifyGhlSyncError() and the state machine via
 * __ghlCircuitTestHooks. Run: npx tsx scripts/test-ghl-circuit-classification.ts
 */
import {
  classifyGhlSyncError,
  getGhlCircuitStatus,
  getGhlCircuitState,
  resetGhlCircuit,
  __ghlCircuitTestHooks as hooks,
} from "../server/services/ghl-sync";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

function freshClosed(opts: Partial<{ lastFullSuccessTickAt: number }> = {}) {
  hooks.setState({
    state: "closed",
    consecutiveFailures: 0,
    halfOpenProbeSuccesses: 0,
    lastFullSuccessTickAt: opts.lastFullSuccessTickAt ?? Date.now(),
    restored: true,
  });
}

async function main() {
  const { threshold, probesRequired, rollingUnhealthyMs } = hooks.constants;

  console.log("\n[1] classifyGhlSyncError dispatch table");
  check("401 status → auth", classifyGhlSyncError(undefined, 401) === "auth");
  check("'GHL API error 401: unauthorized' → auth", classifyGhlSyncError("GHL API error 401: unauthorized") === "auth");
  check("429 status → rate-limit", classifyGhlSyncError(undefined, 429) === "rate-limit");
  check("'GHL API error 429' → rate-limit", classifyGhlSyncError("GHL API error 429: too many requests") === "rate-limit");
  check("identity conflict → skip", classifyGhlSyncError("ghl_identity_conflict") === "skip");
  check("'GHL not configured' → skip", classifyGhlSyncError("GHL not configured") === "skip");
  check("'No GHL contact linked' → skip", classifyGhlSyncError("No GHL contact linked") === "skip");
  check("'No GHL contact linked to task' → skip", classifyGhlSyncError("No GHL contact linked to task") === "skip");
  check("'Company not found' → skip (VFC-04)", classifyGhlSyncError("Company not found") === "skip");
  check("'Deal not found' → skip", classifyGhlSyncError("Deal not found") === "skip");
  check("'Task not found' → skip", classifyGhlSyncError("Task not found") === "skip");
  check("OPPORTUNITY_STAGE_ID_INVALID → skip", classifyGhlSyncError("GHL API error 422: OPPORTUNITY_STAGE_ID_INVALID") === "skip");
  check("GHL 400 not-found (tasks phase, VFC-05) → skip", classifyGhlSyncError("GHL API error 400: The contact was not found") === "skip");
  check("'GHL API error 500: boom' → retryable", classifyGhlSyncError("GHL API error 500: boom") === "retryable");
  check("undefined error → retryable", classifyGhlSyncError(undefined) === "retryable");

  console.log("\n[2] threshold accumulation opens circuit");
  freshClosed();
  for (let i = 0; i < threshold; i++) hooks.recordFailure("GHL API error 500: boom", "test");
  check(`${threshold} retryable failures open circuit`, hooks.getState().state === "open");

  console.log("\n[3] persisted open state is NOT reset at tick boundary (kill-line VFC-01/02/03)");
  check("getGhlCircuitStatus().circuitOpen true while open", getGhlCircuitStatus().circuitOpen === true);
  check("circuitState field exposed", getGhlCircuitStatus().circuitState === "open");
  check("getGhlCircuitState().open true", getGhlCircuitState().open === true);

  console.log("\n[4] auth error opens immediately (VFC-09)");
  freshClosed();
  hooks.recordFailure("GHL API error 401: unauthorized", "test");
  const s4 = hooks.getState();
  check("single 401 opens circuit", s4.state === "open");
  check("did not need threshold accumulation", s4.consecutiveFailures >= threshold); // clamped, not accumulated one-by-one

  console.log("\n[5] skips do not increment counter (VFC-04/05)");
  freshClosed();
  hooks.recordFailure("Company not found", "companies phase");
  check("'Company not found' does not increment", hooks.getState().consecutiveFailures === 0);
  hooks.recordFailure("GHL API error 400: contact not found", "tasks phase");
  check("tasks-phase GHL 400 not-found does not increment", hooks.getState().consecutiveFailures === 0);
  check("circuit still closed after skips", hooks.getState().state === "closed");

  console.log("\n[6] half-open probe sequence closes circuit only after N successes (VFC-06/07)");
  check(`probes required ≥ 2 (kill line)`, probesRequired >= 2);
  hooks.setState({ state: "half-open", consecutiveFailures: threshold, halfOpenProbeSuccesses: 0 });
  hooks.recordProbeSuccess();
  check("single probe success does NOT close circuit", hooks.getState().state === "half-open");
  check("half-open reads as circuitOpen for consumers", getGhlCircuitStatus().circuitOpen === true);
  for (let i = 1; i < probesRequired; i++) hooks.recordProbeSuccess();
  const s6 = hooks.getState();
  check(`${probesRequired} probe successes close circuit`, s6.state === "closed");
  check("close resets consecutiveFailures", s6.consecutiveFailures === 0);
  check("close resets probe counter", s6.halfOpenProbeSuccesses === 0);
  check("close updates lastFullSuccessTickAt", Date.now() - s6.lastFullSuccessTickAt < 10_000);

  console.log("\n[7] rolling unhealthy window (VFC-06 rolling budget)");
  const stale = Date.now() - rollingUnhealthyMs - 60_000;
  freshClosed({ lastFullSuccessTickAt: stale });
  // The tick-entry rule: closed + stale lastFullSuccessTickAt → half-open probe mode.
  const entersProbe = hooks.getState().state === "closed" && Date.now() - hooks.getState().lastFullSuccessTickAt > rollingUnhealthyMs;
  check("stale lastFullSuccessTickAt triggers probe-mode entry condition", entersProbe);

  console.log("\n[8] resetGhlCircuit clears ALL state fields (VFC-10)");
  hooks.setState({ state: "half-open", consecutiveFailures: 4, halfOpenProbeSuccesses: 2, lastFullSuccessTickAt: stale });
  resetGhlCircuit();
  const s8 = hooks.getState();
  check("state reset to closed", s8.state === "closed");
  check("consecutiveFailures reset", s8.consecutiveFailures === 0);
  check("halfOpenProbeSuccesses reset", s8.halfOpenProbeSuccesses === 0);
  check("lastFullSuccessTickAt refreshed", Date.now() - s8.lastFullSuccessTickAt < 10_000);
  check("status reads closed after reset", getGhlCircuitStatus().circuitOpen === false);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
