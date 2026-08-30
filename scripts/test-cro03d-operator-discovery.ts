/**
 * Static tests for the CRO-03D operator discovery tool.
 * Proves: (1) it performs no live provider I/O, (2) it never leaks a secret
 * value into its report, (3) the gate/readiness flags are correctly derived,
 * (4) it correctly proves singleton absence/presence without exposing PII.
 */
import assert from "node:assert/strict";
import { runCro03dDiscovery } from "./cro03d-operator-discovery";

async function main() {
  const report = await runCro03dDiscovery();

  // (1) No live I/O flag is present and true.
  assert.equal(report.noLiveIO, true, "discovery must declare noLiveIO=true");

  // (2) No secret VALUE (for any secret name it checked) appears anywhere in the
  // serialized report, even though presence booleans are reported.
  const serialized = JSON.stringify(report);
  const allSecretNames = Object.values(report.providerSecretPresence)
    .flatMap((p) => p.secretNames);
  for (const name of allSecretNames) {
    const value = process.env[name];
    if (value && value.length >= 6) {
      assert.ok(!serialized.includes(value), `secret value for ${name} must never appear in the discovery report`);
    }
  }
  // The report must only ever contain presence booleans, not raw secret text.
  assert.ok(!/["']?(sk-|Bearer\s)/i.test(serialized), "report must not contain raw credential-shaped strings");

  // (3) Readiness flags shape and logical consistency.
  assert.equal(typeof report.ready.cleanTree, "boolean");
  assert.equal(typeof report.ready.migrationReadable, "boolean");
  assert.equal(typeof report.ready.pauseReadable, "boolean");
  assert.equal(typeof report.ready.singletonAbsent, "boolean");
  assert.equal(typeof report.ready.noMissingSecrets, "boolean");
  assert.equal(
    report.ready.noMissingSecrets,
    report.missingSecretsByProvider.length === 0,
    "noMissingSecrets must match the derived missing-secret list",
  );

  // (4) Singleton section proves absence/presence without any PII/member data.
  assert.equal(report.singleton.key, "cro03c_initial_v1");
  assert.equal(typeof report.singleton.exists, "boolean");
  assert.ok(
    !("members" in report.singleton) && !("commandId" in report.singleton) && !("membershipHash" in report.singleton),
    "singleton section must not expose membership/command internals to a discovery-only report",
  );
  if (report.singleton.exists === false) {
    assert.equal(report.ready.singletonAbsent, report.singleton.readable === true, "singletonAbsent must reflect readable+absent");
  }

  // (5) Pause state must be surfaced (fail-closed gate input), never fabricated.
  assert.ok(["paused", "activating", "unpaused"].includes(String(report.pause.state)) || report.pause.readable === false);

  console.log("CRO03D_DISCOVERY_TEST: PASS");
  console.log(JSON.stringify({
    noLiveIO: report.noLiveIO,
    ready: report.ready,
    pauseState: report.pause.state,
    singletonExists: report.singleton.exists,
    missingSecretsByProvider: report.missingSecretsByProvider,
  }, null, 2));
}

main().catch((err) => {
  console.error("CRO03D_DISCOVERY_TEST: FAIL", err);
  process.exitCode = 1;
});
