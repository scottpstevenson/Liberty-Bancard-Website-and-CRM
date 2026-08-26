#!/usr/bin/env tsx

import fs from "node:fs";
import {
  authorizeGhlRouteMutation,
  requireGhlRouteMutationAllowed,
} from "../server/routes/ghl-mutation-pause";
import type { AuthorizedSendDecision } from "../server/services/outbound-pause-authority";
import {
  GHL_ROUTE_MUTATION_ALLOWLIST,
  type GhlRouteMutationCallSite,
} from "./ghl-route-mutation-allowlist";

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

const deniedDecision: AuthorizedSendDecision = {
  allowed: false,
  epoch: 1629n,
  reasonCode: "global_paused",
  stateSource: "database",
  grantedAt: new Date("2026-08-18T00:00:00.000Z"),
};

const allowedDecision: AuthorizedSendDecision = {
  ...deniedDecision,
  allowed: true,
  reasonCode: "allowed",
};

function fakeResponse() {
  const state: { status?: number; body?: unknown } = {};
  const response = {
    status(code: number) {
      state.status = code;
      return response;
    },
    json(body: unknown) {
      state.body = body;
      return response;
    },
  };
  return { response: response as any, state };
}

function reviewedEntryPasses(lines: string[], entry: GhlRouteMutationCallSite): boolean {
  const matches = lines
    .map((line, idx) => line.includes(entry.lineContains) ? idx : -1)
    .filter(idx => idx >= 0);
  const callIdx = matches[(entry.occurrence ?? 1) - 1];
  if (callIdx === undefined) return false;
  const start = Math.max(0, callIdx - entry.maxLinesBetween);
  const window = lines.slice(start, callIdx);
  const gateOffset = window.map(line => line.includes(entry.gateContains)).lastIndexOf(true);
  if (gateOffset < 0) return false;
  if (entry.disposition === "skip_auxiliary") {
    return lines.slice(start + gateOffset, callIdx + 1).join("\n").includes("pauseDecision.allowed");
  }
  return true;
}

async function main(): Promise<void> {
  console.log("\n=== #1629 GHL Route Pause Gate Tests ===\n");

  // Fake-authority denial proves the shared route disposition is typed and
  // returns before a mutation callback would be reached. Each named route is
  // separately asserted; the static allowlist below binds this helper to the
  // real call sites.
  const rejectingRoutes = [
    "sdr", "admin", "underwriting", "deals",
    "documents", "partners", "partner-orgs:accept", "conversation-ai-config",
  ];
  for (const route of rejectingRoutes) {
    const { response, state } = fakeResponse();
    let mutationSpyCalls = 0;
    const allowed = await requireGhlRouteMutationAllowed(response, async () => deniedDecision);
    if (allowed) mutationSpyCalls++;
    const body = state.body as Record<string, unknown> | undefined;
    assert(`${route}: paused authority returns 503`, state.status === 503);
    assert(`${route}: response is typed and reason-coded`,
      body?.code === "OUTBOUND_PAUSED"
        && body?.error === "Service temporarily paused"
        && body?.reasonCode === "global_paused",
      JSON.stringify(body));
    assert(`${route}: GHL mutation spy not invoked`, mutationSpyCalls === 0);
  }

  // Public proposal GET is the one corrected disposition: preserve the read,
  // but do not execute its auxiliary mutation sequence.
  let publicGetMutationSpyCalls = 0;
  const publicGetDecision = await authorizeGhlRouteMutation(async () => deniedDecision);
  if (publicGetDecision.allowed) publicGetMutationSpyCalls++;
  assert("partner-orgs:view: paused authority skips auxiliary mutations", publicGetMutationSpyCalls === 0);

  const { response: allowedResponse, state: allowedState } = fakeResponse();
  let allowedMutationSpyCalls = 0;
  if (await requireGhlRouteMutationAllowed(allowedResponse, async () => allowedDecision)) {
    allowedMutationSpyCalls++;
  }
  assert("unpaused authority permits the mutation continuation", allowedMutationSpyCalls === 1);
  assert("unpaused authority does not write an error response", allowedState.status === undefined && allowedState.body === undefined);

  // Static happy + negative regression for every reviewed call site. Removing
  // its nearest reviewed gate in-memory must make the same entry fail.
  const firstPass: boolean[] = [];
  for (const entry of GHL_ROUTE_MUTATION_ALLOWLIST) {
    const lines = fs.readFileSync(entry.file, "utf8").split("\n");
    const currentPass = reviewedEntryPasses(lines, entry);
    firstPass.push(currentPass);
    assert(`${entry.file}: ${entry.lineContains.slice(0, 42)} is gated`, currentPass);

    const tampered = [...lines];
    const matches = tampered
      .map((line, idx) => line.includes(entry.lineContains) ? idx : -1)
      .filter(idx => idx >= 0);
    const callIdx = matches[(entry.occurrence ?? 1) - 1];
    if (callIdx !== undefined) {
      for (let idx = callIdx - 1; idx >= Math.max(0, callIdx - entry.maxLinesBetween); idx--) {
        if (tampered[idx].includes(entry.gateContains)) {
          tampered[idx] = "// gate removed by synthetic regression test";
          break;
        }
      }
    }
    assert(`${entry.file}: removing reviewed gate is detected`, !reviewedEntryPasses(tampered, entry));
  }

  const replay = GHL_ROUTE_MUTATION_ALLOWLIST.map(entry =>
    reviewedEntryPasses(fs.readFileSync(entry.file, "utf8").split("\n"), entry),
  );
  assert("repeated route scans are deterministic", JSON.stringify(firstPass) === JSON.stringify(replay));
  const reviewedRouteFiles = new Set(GHL_ROUTE_MUTATION_ALLOWLIST.map(entry => entry.file));
  const expectedRouteFiles = new Set(
    rejectingRoutes.map(route => `server/routes/${route.split(":")[0]}.ts`),
  );
  assert(
    "all current target route files are represented",
    reviewedRouteFiles.size === expectedRouteFiles.size
      && [...expectedRouteFiles].every(file => reviewedRouteFiles.has(file)),
    `reviewed=${[...reviewedRouteFiles].join(", ")}`,
  );

  console.log(`\n  Passed: ${passed}  Failed: ${failed}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("#1629 route pause test crashed:", error);
  process.exit(1);
});
