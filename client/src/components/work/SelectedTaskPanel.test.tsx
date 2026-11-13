/**
 * Phase 6 R01 mounted behaviour: the selected-task panel's request/file evidence.
 *
 * Real component code with an injected fetch (jsdom). It proves the visible states, the Work return carried as a validated
 * `from`, actor separation, late responses for a task that is no longer selected, permission revocation and a retry that
 * recovers. It does not exercise a real session, route handler or database (those are in test-phase6-task-evidence.ts).
 */
import assert from "node:assert/strict";
import { QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

const jsdomModule = await import(["js", "dom"].join("")) as {
  JSDOM: new (html: string, options: { url: string; pretendToBeVisual: boolean }) => { window: any };
};
const WORK = "/dashboard/tasks-appointments?tab=tasks&due=overdue&taskId=7072";
const dom = new jsdomModule.JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
  url: `http://localhost${WORK}`, pretendToBeVisual: true,
});
for (const name of ["window", "document", "navigator", "HTMLElement", "Event", "MouseEvent", "MutationObserver", "Node", "Element", "sessionStorage", "localStorage"]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? dom.window : dom.window[name] });
}
Object.defineProperty(globalThis, "getComputedStyle", { configurable: true, value: dom.window.getComputedStyle.bind(dom.window) });
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).React = React;
for (const name of ["location", "history", "addEventListener", "removeEventListener", "dispatchEvent"]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: typeof dom.window[name] === "function" ? dom.window[name].bind(dom.window) : dom.window[name] });
}

const { SelectedTaskPanel, TaskEvidenceSection } = await import("./SelectedTaskPanel");
const { queryClient, transitionProtectedActor } = await import("@/lib/queryClient");

const actorA = { id: "actor-a", role: "admin", accountVersion: 1, permissions: [] as string[] };
const actorB = { id: "actor-b", role: "agent", accountVersion: 1, permissions: [] as string[] };
let currentActor: any = actorA;
type Mode = "linked" | "none" | "restricted" | "fail" | "denied" | "retry";
let mode: Mode = "linked";
let retryFailures = 1;
const requests: Array<{ method: string; path: string }> = [];
let delayed: Record<number, Promise<void>> = {};
const request = (ref: string) => ({
  requestReceipt: `${ref.toLowerCase()}-0000-4000-8000-000000000000`, shortRef: ref, sourceType: "statement_upload", lifecycleState: "accepted",
  createdAt: "2026-11-12T12:00:00.000Z", contactId: 166168,
});
const evidenceFor = (taskId: number, kind: Mode) => {
  if (kind === "none") return { taskId, state: "none_recorded", request: null, file: null, reason: "no_work_link" };
  if (kind === "restricted") return { taskId, state: "restricted", request: null, file: null, reason: "role" };
  return {
    taskId, state: "linked", reason: null, request: request(taskId === 7072 ? "269B66AF" : "AAAA1111"),
    file: { state: "retained", documentId: 1077, fileName: "march-statement.pdf", fileSize: 2048, mimeType: "application/pdf",
      review: { state: "present", reviewId: 31, status: "received" }, analysis: "held" },
  };
};
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = new URL(String(input), "http://localhost");
  requests.push({ method: (init.method ?? "GET").toUpperCase(), path: url.pathname });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (url.pathname === "/api/auth/user") return json(currentActor);
  const match = /^\/api\/tasks\/(\d+)\/evidence$/.exec(url.pathname);
  if (match) {
    const taskId = Number(match[1]);
    if (delayed[taskId]) await delayed[taskId];
    if (mode === "fail") return json({ message: "boom" }, 500);
    if (mode === "denied") return json({ message: "Not found" }, 404);
    if (mode === "retry" && retryFailures-- > 0) return json({ message: "boom" }, 500);
    return json(evidenceFor(taskId, mode === "retry" ? "linked" : mode));
  }
  return json({}, 404);
}) as any;

const text = () => document.body.textContent ?? "";
async function waitFor(check: () => boolean, label: string) {
  for (let i = 0; i < 300; i++) { if (check()) return; await act(async () => { await new Promise(r => setTimeout(r, 10)); }); }
  throw new Error(`Timed out: ${label}; ${text().slice(0, 600)}`);
}
const byTest = (id: string) => document.querySelector(`[data-testid="${id}"]`);
const evidenceCalls = () => requests.filter(r => /\/evidence$/.test(r.path)).length;
async function setActor(actor: any) {
  currentActor = actor;
  await act(async () => {
    await transitionProtectedActor(actor);
    queryClient.setQueryData(["/api/auth/user"], actor);
  });
}

const task = { id: 7072, title: "Review statement", description: "Customer named request 0BADBEEF in text", status: "pending", priority: "high",
  dueDate: null, assignedTo: "admin", contactId: 166168, dealId: null, ticketId: null } as any;
const selection = { id: 7072, invalid: false, isLoading: false, isError: false, error: null, data: task, refetch: () => undefined };
const panel = (sel = selection) => <QueryClientProvider client={queryClient}>
  <SelectedTaskPanel selection={sel as any} statusLabel={s => s ?? ""} priorityLabel={p => p ?? ""} onClear={() => undefined} onEdit={() => undefined} onAdvance={() => undefined} busy={false} />
</QueryClientProvider>;

await setActor(actorA);
const root = createRoot(document.getElementById("root")!);

// 1. Linked: exact request reference, retained file, review link; every link carries the validated Work return.
await act(async () => { root.render(panel()); });
await waitFor(() => byTest("task-evidence")?.getAttribute("data-evidence-state") === "linked", "linked evidence");
const requestLink = byTest("task-evidence-action-request") as HTMLAnchorElement;
const reviewLink = byTest("task-evidence-action-review") as HTMLAnchorElement;
assert.equal(requestLink.textContent?.trim(), "Open request 269B66AF", "specific request button text");
assert.equal(reviewLink.textContent?.trim(), "Open statement review for file #1077", "specific review button text");
const requestHref = new URL(requestLink.getAttribute("href")!, "http://localhost");
assert.equal(requestHref.pathname, "/dashboard/lead-ops");
assert.equal(requestHref.searchParams.get("ref"), "269B66AF", "exact recorded reference, never a description reference");
assert.equal(requestHref.searchParams.get("from"), WORK, "the Work list with its filters rides along as `from`");
assert.equal(new URL(reviewLink.getAttribute("href")!, "http://localhost").searchParams.get("documentId"), "1077");
assert.ok(!document.body.innerHTML.includes("0BADBEEF=") && !requestLink.getAttribute("href")!.includes("0BADBEEF"), "a reference typed in the description is never linked");
assert.ok(text().includes("march-statement.pdf") && text().includes("2.0 KB"), "retained file name and size are shown");
const contactLink = byTest("selected-task-link-contact") as HTMLAnchorElement | null;
if (contactLink) assert.equal(new URL(contactLink.getAttribute("href")!, "http://localhost").searchParams.get("from"), WORK, "the contact link returns to Work too");
assert.ok(!byTest("task-evidence-notice"), "a fully resolved evidence needs no notice");
assert.ok(requests.every(r => r.method === "GET"), "evidence reads are GET only");

// 2. Actor change: the previous actor's evidence is not shown for the new actor while its own read is pending.
let releaseB: () => void = () => undefined;
delayed = { 7072: new Promise<void>(resolve => { releaseB = resolve; }) };
mode = "restricted";
const before = evidenceCalls();
await setActor(actorB);
await waitFor(() => evidenceCalls() > before, "new actor reads its own evidence");
assert.ok(!text().includes("269B66AF"), "actor A's request reference is not visible to actor B while B's read is pending");
releaseB();
delayed = {};
await waitFor(() => byTest("task-evidence")?.getAttribute("data-evidence-state") === "restricted", "restricted evidence for actor B");
assert.ok(!byTest("task-evidence-action-request") && text().includes("Request and file details are available to administrators and managers."), "a restricted actor sees the reason, not a link");

// 3. Permission revoked mid-session (the exact read now answers 404): no stale link remains, and Retry is honest.
mode = "denied";
await setActor({ ...actorB, accountVersion: 2 });
await waitFor(() => !!byTest("task-evidence-unavailable"), "revoked permission shows unavailable");
assert.ok(!byTest("task-evidence-action-request") && !text().includes("269B66AF"), "no request identity after revocation");
assert.ok(text().includes("Nothing is guessed."), "unavailable is explicit");

// 4. A failed read recovers through Retry without any other action.
mode = "retry"; retryFailures = 1;
await setActor({ ...actorA, accountVersion: 3 });
await waitFor(() => !!byTest("task-evidence-unavailable"), "first read fails");
await act(async () => { (byTest("button-retry-task-evidence") as HTMLButtonElement).click(); });
await waitFor(() => !!byTest("task-evidence-action-request"), "retry recovers the exact request");
assert.equal(byTest("task-evidence")?.getAttribute("data-evidence-state"), "linked");

// 5. None recorded: a plain sentence, no link, never a guess from the description.
mode = "none";
await setActor({ ...actorA, accountVersion: 4 });
await waitFor(() => byTest("task-evidence")?.getAttribute("data-evidence-state") === "none_recorded", "none recorded");
assert.ok(text().includes("No website request is recorded for this task."), "none-recorded sentence");
assert.ok(!byTest("task-evidence-action-request") && !byTest("task-evidence-action-review"), "no links without a recorded relationship");

// 6. Late response for a task that is no longer selected never renders on the newly selected task.
mode = "linked";
await setActor({ ...actorA, accountVersion: 5 });
await waitFor(() => byTest("task-evidence")?.getAttribute("data-evidence-state") === "linked", "settled before switch");
let releaseOld: () => void = () => undefined;
delayed = { 8001: new Promise<void>(resolve => { releaseOld = resolve; }) };
await act(async () => { root.render(<QueryClientProvider client={queryClient}><TaskEvidenceSection taskId={8001} workReturn={null} /></QueryClientProvider>); });
await waitFor(() => !!byTest("task-evidence-loading"), "loading for the newly selected task");
await act(async () => { root.render(<QueryClientProvider client={queryClient}><TaskEvidenceSection taskId={8002} workReturn={null} /></QueryClientProvider>); });
await waitFor(() => text().includes("AAAA1111"), "task 8002 shows its own evidence");
releaseOld();
await act(async () => { await new Promise(r => setTimeout(r, 50)); });
assert.equal(document.querySelectorAll('[data-testid="task-evidence-request"]').length, 1, "only the selected task's evidence is rendered");
assert.ok(text().includes("AAAA1111") && !text().includes("269B66AF"), "the late answer for task 8001 never replaces task 8002's evidence");
assert.ok(!(byTest("task-evidence-action-request") as HTMLAnchorElement).getAttribute("href")!.includes("from="), "no Work return is invented when there is none");

await act(async () => root.unmount());
console.log("SELECTED_TASK_EVIDENCE_UI_PASS");
process.exit(0);
