import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SequenceRuntimeFacts } from "../client/src/components/dashboard/SequenceRuntimeFacts";
import type { SequenceRuntimeStatus } from "../shared/sequence-runtime-status";
import { GhlRuntimeObservations } from "../client/src/components/dashboard/GhlRuntimeObservations";
import type { GhlInboundSyncStatus } from "../shared/ghl-inbound-sync";

for (const smtp of [true, false, null]) {
  for (const ghl of [true, false, null]) {
    for (const pause of ["paused", "unpaused", "unavailable"] as const) {
      const runtime: SequenceRuntimeStatus = { version: 1, asOf: "2026-10-03T12:00:00Z",
        status: smtp === null || ghl === null ? "error" : "observed",
        globalPause: { state: pause, reason: null },
        smtp: { configured: smtp, enabled: "not_observed" }, ghl: { configured: ghl, enabled: "not_observed" },
        connectivityProbe: "not_observed", verifiedDelivery: "not_observed", sequencePauseReason: "not_recorded" };
      const html = renderToStaticMarkup(<SequenceRuntimeFacts runtime={runtime} />);
      assert.ok(html.includes(`SMTP: ${smtp === null ? "unavailable" : smtp ? "configured" : "not configured"}`));
      assert.ok(html.includes(`GHL: ${ghl === null ? "unavailable" : ghl ? "configured" : "not configured"}`));
      assert.ok(html.includes(`Global outbound: ${pause}`));
      assert.ok(html.includes("not_recorded"));
      assert.ok(html.includes("Active identities are not send permission"));
      assert.ok(!html.includes("all email goes through"));
    }
  }
}
const failedRead = renderToStaticMarkup(<SequenceRuntimeFacts />);
assert.ok(failedRead.includes("SMTP: unavailable"));
assert.ok(failedRead.includes("status read: unavailable"));
assert.ok(!failedRead.includes("SMTP: not configured"));
console.log("PASS 27 typed config/pause/reason permutations plus unavailable read; no probe/send/DB");
for (const mode of ["manual_request", "webhook", "not_observed"] as const) {
  for (const owner of ["lease_observed", "lease_expired", "not_observed"] as const) {
    for (const freshness of ["current", "stale", "not_observed"] as const) {
      const runtime: GhlInboundSyncStatus["runtime"] = { asOf: "2026-10-03T12:00:00Z",
        mode, owner, freshness, freshnessThresholdMs: 20 * 60_000,
        checkpoint: mode === "not_observed" ? null : { phase: "read", pages: 2, planned: 3, applied: 0 },
        lastUpdatedAt: mode === "not_observed" ? null : "2026-10-03T11:55:00Z",
        heartbeat: "not_observed", connectionProbe: "not_observed", backlog: "unavailable" };
      const html = renderToStaticMarkup(<GhlRuntimeObservations runtime={runtime} />);
      assert.ok(html.includes(mode) && html.includes(owner) && html.includes(freshness));
      assert.ok(html.includes("20-minute run-update threshold"));
      assert.ok(html.includes(runtime.asOf));
      for (const lane of ["Legacy GHL queue", "Enrichment", "SLA", "Outbound communications"])
        assert.ok(html.includes(`${lane}: owner, heartbeat, checkpoint and backlog unavailable`));
      assert.ok(html.includes("not verified native inventory or semantic equivalence"));
      assert.ok(!html.includes("healthy"));
    }
  }
}
const missingIncoming = renderToStaticMarkup(<GhlRuntimeObservations />);
assert.ok(missingIncoming.includes("Incoming run mode: unavailable"));
assert.ok(missingIncoming.includes("connection probe: unavailable"));
assert.ok(!missingIncoming.includes("20-minute"));
console.log("PASS 27 incoming mode/lease/freshness diagnostic renders plus unavailable read; separate owner classes and unmapped-native limits, no probes/providers");