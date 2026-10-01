import assert from "node:assert/strict";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";

const jsdomModule = await import(["js", "dom"].join("")) as {
  JSDOM: new (html: string, options: { url: string; pretendToBeVisual: boolean }) => { window: any };
};
const dom = new jsdomModule.JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: dom.window.HTMLElement });
Object.defineProperty(globalThis, "Event", { configurable: true, value: dom.window.Event });
Object.defineProperty(globalThis, "CustomEvent", { configurable: true, value: dom.window.CustomEvent });
Object.defineProperty(globalThis, "MouseEvent", { configurable: true, value: dom.window.MouseEvent });
Object.defineProperty(globalThis, "KeyboardEvent", { configurable: true, value: dom.window.KeyboardEvent });
Object.defineProperty(globalThis, "MutationObserver", { configurable: true, value: dom.window.MutationObserver });
Object.defineProperty(globalThis, "Node", { configurable: true, value: dom.window.Node });
Object.defineProperty(globalThis, "Element", { configurable: true, value: dom.window.Element });
Object.defineProperty(globalThis, "getComputedStyle", { configurable: true, value: dom.window.getComputedStyle.bind(dom.window) });
Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: dom.window.requestAnimationFrame.bind(dom.window) });
Object.defineProperty(globalThis, "cancelAnimationFrame", { configurable: true, value: dom.window.cancelAnimationFrame.bind(dom.window) });
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { SouthFloridaProspectingPanel } = await import("./SouthFloridaProspectingPanel");
const container = document.getElementById("root");
assert.ok(container);
const root = createRoot(container);
const requests: Array<{ url: URL; method: string; body?: unknown; csrf?: string }> = [];
const program = {
  id: "program-test",
  name: "south-florida-v1",
  countyFips: ["12011"],
  verticalIds: ["automotive"],
  maxCohortSize: 25,
  isActive: true,
  recurringEnabled: false,
  campaignStagingBatchSize: 10,
  activatedAt: "2026-01-01T00:00:00.000Z",
  taxonomyVersion: 2 as const,
};
const existingRun = {
  id: "runtime-test-run",
  status: "frozen",
  cohortState: "frozen" as const,
  cohortSize: 1,
  cohortHash: "b".repeat(64),
  frozenAt: "2026-01-01T00:00:00.000Z",
  actorId: "admin-9",
  createdAt: "2026-01-01T00:00:00.000Z",
  requestHash: "c".repeat(64),
  configHash: "d".repeat(64),
  voidedAt: null,
  voidReason: null,
  supersededAt: null,
  supersededByRunId: null,
};
let telemetry: any = {
  capability: { profile: "full", selectiveGroups: [], active: true },
  program: { name: program.name, isActive: true, recurringEnabled: false, campaignStagingBatchSize: 10 },
  effectiveEnablement: false,
  outbound: { globalState: "unpaused", globalPaused: false, pauseEpoch: "9", stateSource: "test-fixture" },
  packageControls: { ok: true, issues: [] },
  lastRun: null,
  lastCompletedRun: null,
  currentlyRunning: null,
  cancellableRun: null,
  backlog: {
    eligibleAwaitingStaging: 18,
    freshAwaitingStaging: 12,
    meaning: "Eligibility readiness count; not a per-tick or hourly throughput promise.",
    configuredBatchSize: 10,
  },
  readyHeldConsumer: {
    unqueuedReadyHeld: 3, pending: 0, claimed: 0, staleClaims: 0, retrying: 0,
    held: 0, completed: 0, deadLettered: 0, completedLast24h: 0,
    lastProgressAt: null, batchLimit: 25, scheduleActive: false, heldSample: [],
  },
  throughput: { completedLast24h: 0, deadLetteredLast24h: 0 },
  retries: { currentlyRetrying: 0, staleLeases: 0 },
  deadLetters: { total: 0, sample: [] },
  cost: { reportedCostMicros: 0, note: "No billing data in UI fixture." },
  workerHealth: { queueManagerReady: true, repeatableJobRegistered: true, nextRunEstimateAt: null, intervalMs: 900000 },
  capturedAt: "2026-01-01T00:00:00.000Z",
};
let runtimeSelection: any = {
  selectedRelease: null,
  currentRelease: {
    artifactSha: "a".repeat(40), deploymentIdentity: "deployment-current",
    environmentIdentity: "production", queueTopologyHash: "b".repeat(64),
  },
  currentReleaseSelected: false,
  ownerLeaseExpiresAt: null,
  ownerLive: false,
  ready: false,
  reason: "current_release_not_selected",
};

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = new URL(String(input), "http://localhost");
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
  requests.push({ url, method, body, csrf: headers.get("x-csrf-token") ?? undefined });
  if (method !== "GET" && headers.get("x-csrf-token") !== "panel-csrf-token") {
    return new Response(JSON.stringify({ message: "CSRF token missing" }), { status: 403 });
  }
  if (method === "GET" && url.pathname === "/api/lead-ops/sfp/program") {
    return Response.json(program);
  }
  if (method === "GET" && url.pathname === "/api/lead-ops/sfp/runs") {
    return Response.json({ runs: [existingRun] });
  }
  if (method === "GET" && url.pathname === "/api/lead-ops/sfp/campaign-packages-v2/verify") {
    return Response.json({ ok: true, issues: [] });
  }
  if (method === "GET" && url.pathname === "/api/lead-ops/sfp/campaign-staging/telemetry") {
    return Response.json(telemetry);
  }
  if (method === "GET" && url.pathname === "/api/lead-ops/sfp/runtime-release-selection") {
    return Response.json(runtimeSelection);
  }
  if (method === "GET" && url.pathname === `/api/lead-ops/sfp/programs/${program.id}/classification-preview`) {
    return Response.json({ candidateCount: 0, snapshotHash: "a".repeat(64), currentPolicyEvidenceCounts: { target: 0, nonTarget: 0, reviewRequired: 0 } });
  }
  if (method === "GET" && url.pathname === `/api/lead-ops/sfp/programs/${program.id}/free-classification-continuation`) {
    return Response.json({ continuation: null });
  }
  if (method === "GET" && url.pathname.startsWith(`/api/lead-ops/sfp/runs/${existingRun.id}/`)) {
    if (url.pathname.endsWith("/free-evidence")) return Response.json({ cohortRunId: existingRun.id, cohortSize: 1, businessesWithCandidates: 0, businessesWithoutCandidates: 1, totalCandidates: 0, perBusiness: [], capturedAt: new Date().toISOString() });
    if (url.pathname.endsWith("/reconciliation")) return Response.json({ byDisposition: [], totalDecisions: 0, totalScannedCanonical: 1, reconciles: true });
    if (url.pathname.endsWith("/validation-preview")) return Response.json({ cohortRunId: existingRun.id, cohortSize: 1, addressesForValidation: 0, maxValidations: 0, gateOpen: false, selectedCandidates: [] });
    if (url.pathname.endsWith("/campaign-staging-preview")) return Response.json({ eligibleCount: 0, alreadyStagedCount: 0, willStageCount: 0, ineligibleCount: 0, ineligibleReasons: {} });
    if (url.pathname.endsWith("/paid-waterfall-preview")) return Response.json({ businessesNeedingPaidDiscovery: 0, serperEligibleNow: 0, providers: [], note: "Test response only" });
  }
  if (method === "POST" && url.pathname === "/api/lead-ops/sfp/program/campaign-staging-schedule") {
    return Response.json({ program: { ...program, recurringEnabled: body.recurringEnabled, campaignStagingBatchSize: body.batchSize } });
  }
  if (method === "POST" && url.pathname === "/api/lead-ops/sfp/runtime-release-selection/select") {
    runtimeSelection = {
      ...runtimeSelection,
      selectedRelease: {
        artifactSha: runtimeSelection.currentRelease.artifactSha,
        deploymentIdentity: runtimeSelection.currentRelease.deploymentIdentity,
        environmentIdentity: runtimeSelection.currentRelease.environmentIdentity,
        queueTopologyHash: runtimeSelection.currentRelease.queueTopologyHash,
        selectedBy: "admin-9", selectedAt: "2026-01-01T00:00:00.000Z",
        selectionVersion: 1, selectionEventId: "selection-event-1",
        publisherVerifiedArtifactSha: body.publisherVerifiedArtifactSha,
        publisherVerifiedDeploymentIdentity: body.publisherVerifiedDeploymentIdentity,
        verificationReference: body.verificationReference,
      },
      currentReleaseSelected: true,
      ownerLeaseExpiresAt: "2026-01-01T00:02:00.000Z",
      ownerLive: true,
      ready: true,
      reason: null,
    };
    return Response.json({
      selection: { action: "bootstrap", eventId: "selection-event-1" },
      status: runtimeSelection,
    });
  }
  if (method === "POST" && url.pathname === "/api/lead-ops/sfp/ready-held-consumer/run") {
    return Response.json({ attempted: 0, completed: 0, held: 0, retrying: 0, deadLettered: 0 });
  }
  return new Response(JSON.stringify({ message: `Unexpected test request ${method} ${url.pathname}` }), { status: 404 });
};

async function waitFor(assertion: () => boolean, description: string, timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (assertion()) return;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
  throw new Error(`Timed out waiting for ${description}; rendered: ${document.body.textContent}`);
}

function button(label: string) {
  const found = [...document.querySelectorAll("button")].find((element) => element.textContent?.includes(label));
  assert.ok(found, `expected button containing "${label}"`);
  return found as HTMLButtonElement;
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function fillInput(label: string, value: string) {
  const input = [...document.querySelectorAll("input")]
    .find((element) => element.getAttribute("aria-label") === label) as HTMLInputElement | undefined;
  assert.ok(input, `expected input "${label}"`);
  await act(async () => {
    input.value = value;
    Simulate.change(input, { target: { value } } as any);
  });
}

try {
  document.cookie = "csrf_token=panel-csrf-token; path=/";
  queryClient.clear();
  await act(async () => {
    queryClient.setQueryData(["/api/auth/user"], { id: "manager-1", role: "manager" });
    root.render(<QueryClientProvider client={queryClient}><SouthFloridaProspectingPanel /></QueryClientProvider>);
  });
  await waitFor(() => document.querySelector(`[aria-label="Select cohort run ${existingRun.id}"]`) !== null, "existing cohort renders");
  await click(document.querySelector(`[aria-label="Select cohort run ${existingRun.id}"]`)!);
  await waitFor(() => document.body.textContent?.includes("SFP staging worker telemetry") === true, "SFP staging telemetry renders");
  assert.equal([...document.querySelectorAll("button")].some((item) => item.textContent?.includes("Enable recurrence")), false, "non-admin role does not see schedule activation controls");
  assert.equal([...document.querySelectorAll("button")].some((item) => item.textContent?.includes("Process up to 25 ready-held intents")), false, "non-admin role does not see the consumer action");
  assert.equal(requests.some((request) => request.url.pathname === "/api/lead-ops/sfp/runtime-release-selection"), false, "non-admin role does not query the private runtime owner status");

  await act(async () => {
    queryClient.setQueryData(["/api/auth/user"], { id: "admin-9", role: "admin" });
  });
  await waitFor(() => [...document.querySelectorAll("button")].some((item) => item.textContent?.includes("Enable recurrence")), "admin schedule controls render");
  await waitFor(() => document.body.textContent?.includes("Queue work held · current_release_not_selected") === true, "unselected release is shown as a held queue reason");
  assert.equal(button("Enable recurrence").disabled, true, "recurrence cannot be enabled before the published release is selected");
  const selectReleaseButton = button("Bootstrap current published release selection");
  assert.equal(selectReleaseButton.disabled, true, "publisher evidence is required before bootstrap");
  assert.equal((document.querySelector('[aria-label="Publisher-verified artifact SHA"]') as HTMLInputElement).value, "", "publisher artifact proof is never copied from this worker's own release SHA");
  assert.equal(button("Process up to 25 ready-held intents").disabled, true, "consumer action remains disabled while global outbound is unpaused");
  await act(async () => {
    telemetry = { ...telemetry, outbound: { ...telemetry.outbound, globalState: "paused", globalPaused: true } };
    queryClient.setQueryData(["/api/lead-ops/sfp/campaign-staging/telemetry"], telemetry);
  });
  assert.equal(button("Process up to 25 ready-held intents").disabled, true, "consumer remains disabled until runtime release ownership is ready");
  await fillInput("Publisher-verified artifact SHA", "a".repeat(40));
  await fillInput("Publisher-verified deployment identity", "deployment-current");
  await fillInput("HTTPS publisher verification evidence URL", "https://deployments.example.test/release/current");
  const evidenceCheckbox = document.querySelector('[aria-label="Confirm independently verified published release evidence"]') as HTMLInputElement;
  await act(async () => {
    evidenceCheckbox.checked = true;
    Simulate.change(evidenceCheckbox, { target: { checked: true } } as any);
  });
  assert.equal(button("Bootstrap current published release selection").disabled, false);
  await click(button("Bootstrap current published release selection"));
  await waitFor(() => requests.some((request) => request.url.pathname === "/api/lead-ops/sfp/runtime-release-selection/select"), "admin runtime selection form reaches audited selector API");
  const selectionRequest = requests.find((request) => request.url.pathname === "/api/lead-ops/sfp/runtime-release-selection/select");
  assert.equal(selectionRequest?.csrf, "panel-csrf-token", "runtime bootstrap uses the cookie-matched CSRF token");
  assert.deepEqual(selectionRequest?.body, {
    expectedPreviousSelectionVersion: null,
    expectedPreviousArtifactSha: null,
    publisherVerifiedArtifactSha: "a".repeat(40),
    publisherVerifiedDeploymentIdentity: "deployment-current",
    verificationReference: "https://deployments.example.test/release/current",
  }, "bootstrap sends publisher evidence and the explicit initial selector CAS only");
  await waitFor(() => document.body.textContent?.includes("Selected published release has a live runtime owner.") === true, "selected release readiness updates from server status");
  await act(async () => {
    queryClient.setQueryData(["/api/lead-ops/sfp/runtime-release-selection"], runtimeSelection);
  });
  await waitFor(() => button("Process up to 25 ready-held intents").disabled === false, "paused-only consumer action is enabled");

  await click(button("Enable recurrence"));
  await waitFor(() => requests.some((request) => request.url.pathname === "/api/lead-ops/sfp/program/campaign-staging-schedule"), "rendered recurrence handler reaches the schedule API");
  const scheduleRequest = requests.find((request) => request.url.pathname === "/api/lead-ops/sfp/program/campaign-staging-schedule");
  assert.equal(scheduleRequest?.csrf, "panel-csrf-token", "rendered schedule handler sends the cookie-matched CSRF token");
  assert.deepEqual(scheduleRequest?.body, { recurringEnabled: true, batchSize: 10 });

  await click(button("Process up to 25 ready-held intents"));
  await waitFor(() => requests.some((request) => request.url.pathname === "/api/lead-ops/sfp/ready-held-consumer/run"), "rendered bounded consumer handler reaches the batch API");
  const consumerRequest = requests.find((request) => request.url.pathname === "/api/lead-ops/sfp/ready-held-consumer/run");
  assert.equal(consumerRequest?.csrf, "panel-csrf-token");
  assert.deepEqual(consumerRequest?.body, { limit: 25 });
  assert.ok(document.body.textContent?.includes("not a per-tick or hourly throughput promise"), "readiness count is not misrepresented as throughput");
  await act(async () => {
    runtimeSelection = {
      ...runtimeSelection,
      selectedRelease: {
        ...runtimeSelection.selectedRelease,
        artifactSha: "c".repeat(40),
        deploymentIdentity: "deployment-previous",
        selectionVersion: 7,
        selectionEventId: "selection-event-previous",
      },
      currentReleaseSelected: false,
      ownerLive: false,
      ready: false,
      reason: "different_release_selected",
    };
    queryClient.setQueryData(["/api/lead-ops/sfp/runtime-release-selection"], runtimeSelection);
  });
  await waitFor(
    () => [...document.querySelectorAll("button")].some((item) => item.textContent?.includes("Transfer selection to this published release")),
    "transfer control renders with current selector evidence",
  );
  const transferButton = button("Transfer selection to this published release");
  assert.equal(transferButton.disabled, true, "transfer requires a fresh admin evidence attestation");
  const transferEvidenceCheckbox = document.querySelector('[aria-label="Confirm independently verified published release evidence"]') as HTMLInputElement;
  await act(async () => {
    transferEvidenceCheckbox.checked = true;
    Simulate.change(transferEvidenceCheckbox, { target: { checked: true } } as any);
  });
  await click(transferButton);
  await waitFor(() => requests.filter((request) => request.url.pathname === "/api/lead-ops/sfp/runtime-release-selection/select").length === 2, "transfer control reaches audited selector API");
  const transferRequest = requests.filter((request) => request.url.pathname === "/api/lead-ops/sfp/runtime-release-selection/select")[1];
  assert.deepEqual(transferRequest.body, {
    expectedPreviousSelectionVersion: 7,
    expectedPreviousArtifactSha: "c".repeat(40),
    publisherVerifiedArtifactSha: "a".repeat(40),
    publisherVerifiedDeploymentIdentity: "deployment-current",
    verificationReference: "https://deployments.example.test/release/current",
  }, "transfer is compare-and-set against both the previous selection version and SHA");
  console.log("SFP operator panel role/render/CSRF handler tests passed");
} finally {
  await act(async () => root.unmount());
  queryClient.clear();
  globalThis.fetch = originalFetch;
  dom.window.close();
}