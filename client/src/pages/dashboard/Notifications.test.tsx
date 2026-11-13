/**
 * Phase 6 R07 mounted behaviour: the notification list.
 *
 * Real page code with an injected fetch (jsdom). Disposable notifications only: estimate, callback, statement, task, support, an
 * older alert with no recorded relationship, and aged digest/SLA reminders. It proves the specific button text, the explicit
 * unresolved wording, the aged group (nothing removed, unread kept), and the destination semantics: a failed or stale target
 * leaves the alert unread and issues no read request, Retry recovers, and an available target marks read exactly once. It does
 * not exercise a real session, route or database (test-phase6-notification-targets.ts covers the server side).
 */
import assert from "node:assert/strict";
import { QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

const jsdomModule = await import(["js", "dom"].join("")) as {
  JSDOM: new (html: string, options: { url: string; pretendToBeVisual: boolean }) => { window: any };
};
const dom = new jsdomModule.JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
  url: "http://localhost/dashboard/notifications", pretendToBeVisual: true,
});
for (const name of ["window", "document", "navigator", "HTMLElement", "Event", "MouseEvent", "KeyboardEvent", "MutationObserver", "Node", "Element", "sessionStorage", "localStorage"]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? dom.window : dom.window[name] });
}
Object.defineProperty(globalThis, "getComputedStyle", { configurable: true, value: dom.window.getComputedStyle.bind(dom.window) });
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).React = React;
for (const name of ["location", "history", "addEventListener", "removeEventListener", "dispatchEvent"]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: typeof dom.window[name] === "function" ? dom.window[name].bind(dom.window) : dom.window[name] });
}
for (const name of ["requestAnimationFrame", "cancelAnimationFrame"]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name].bind(dom.window) });
}
for (const name of ["ResizeObserver", "IntersectionObserver"]) {
  if (!(globalThis as any)[name]) (globalThis as any)[name] = class { observe() {} unobserve() {} disconnect() {} };
}
if (!dom.window.matchMedia) dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
Object.defineProperty(globalThis, "matchMedia", { configurable: true, value: dom.window.matchMedia.bind(dom.window) });

const { default: Notifications } = await import("./Notifications");
const { queryClient, transitionProtectedActor } = await import("@/lib/queryClient");

const admin = { id: "actor-admin", role: "admin", accountVersion: 1, permissions: [] as string[] };
const NOW = Date.now();
const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();
const review = (ref: string) => ({ state: "available", url: `/dashboard/lead-ops?tab=pipeline&ref=${ref}`, context: "inbound_review", label: "Open Inbound Operations review", actionLabel: "Open request" });
const rows = [
  { id: 1, title: "New Estimate Request", message: "Pat Fixture - Volume: 50k", type: "info", read: false, createdAt: hoursAgo(1), metadata: { eventType: "estimate_request_received" }, target: review("AAAA0001") },
  { id: 2, title: "Callback Requested", message: "Sam Fixture - best time anytime", type: "alert", read: false, createdAt: hoursAgo(2), metadata: {}, target: review("AAAA0002") },
  { id: 3, title: "New statement upload", message: "A merchant uploaded a statement", type: "alert", read: false, createdAt: hoursAgo(3), metadata: { eventType: "statement_uploaded" }, target: review("AAAA0003") },
  { id: 4, title: "Task assigned", message: "Call the owner", type: "info", read: false, createdAt: hoursAgo(4), metadata: { eventType: "task_assigned", taskId: 77 },
    target: { state: "available", url: "/dashboard/tasks-appointments?tab=tasks&taskId=77", kind: "task", id: 77, actionLabel: "Open task" } },
  { id: 5, title: "New Urgent Support Request", message: "Help (reference AAAA0005)", type: "urgent", read: false, createdAt: hoursAgo(5), metadata: { eventType: "support_request_received" }, target: review("AAAA0005") },
  { id: 6, title: "Older request alert", message: "Recorded before links were stored", type: "info", read: false, createdAt: hoursAgo(300), metadata: {}, target: { state: "unavailable", url: null } },
  { id: 7, title: "Daily digest", message: "Yesterday's summary", type: "info", read: false, createdAt: hoursAgo(80), metadata: { digestType: "daily" }, target: { state: "available", url: "/dashboard", actionLabel: "Open dashboard" } },
  { id: 8, title: "SLA breach", message: "Deal stuck", type: "warning", read: true, createdAt: hoursAgo(120), metadata: { eventType: "sla_breach", dealId: 9 },
    target: { state: "available", url: "/dashboard/pipeline?id=9", kind: "deal", id: 9, actionLabel: "Open deal" } },
  { id: 9, title: "Daily digest (today)", message: "Today's summary", type: "info", read: false, createdAt: hoursAgo(6), metadata: { digestType: "daily" }, target: { state: "available", url: "/dashboard", actionLabel: "Open dashboard" } },
];

type TargetMode = "ok" | "fail" | "stale" | "denied";
let targetMode: TargetMode = "ok";
const requests: Array<{ method: string; path: string }> = [];
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = new URL(String(input), "http://localhost");
  const method = (init.method ?? "GET").toUpperCase();
  requests.push({ method, path: url.pathname });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (url.pathname === "/api/auth/user") return json(admin);
  if (url.pathname === "/api/notifications") return json({ data: rows, total: rows.length, limit: 25, offset: 0, hasMore: false });
  if (url.pathname === "/api/notifications/count") return json({ unread: rows.filter(r => !r.read).length });
  if (url.pathname === "/api/notification-preferences") return json([]);
  const target = /^\/api\/notifications\/(\d+)\/target$/.exec(url.pathname);
  if (target) {
    if (targetMode === "fail") return json({ message: "boom" }, 500);
    if (targetMode === "denied") return json({ message: "Not found" }, 404);
    const row = rows.find(r => r.id === Number(target[1]))!;
    return json(targetMode === "stale" ? { state: "unavailable", url: null } : row.target);
  }
  if (/^\/api\/notifications\/\d+\/read$/.test(url.pathname) && method === "PUT") return json({ success: true, changed: true });
  return json({}, 404);
}) as any;

const text = () => document.body.textContent ?? "";
async function waitFor(check: () => boolean, label: string) {
  for (let i = 0; i < 300; i++) { if (check()) return; await act(async () => { await new Promise(r => setTimeout(r, 10)); }); }
  throw new Error(`Timed out: ${label}; ${text().slice(0, 700)}`);
}
const byTest = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const readCalls = () => requests.filter(r => r.method === "PUT" && /\/read$/.test(r.path)).length;
const targetCalls = () => requests.filter(r => /\/target$/.test(r.path)).length;

await act(async () => { await transitionProtectedActor(admin); queryClient.setQueryData(["/api/auth/user"], admin); });
const root = createRoot(document.getElementById("root")!);
await act(async () => { root.render(<QueryClientProvider client={queryClient}><Notifications /></QueryClientProvider>); });
await waitFor(() => !!byTest("card-notification-1"), "list renders");

// 1. Specific button text named for what opens; the accessible name carries the alert title.
const label = (id: number) => byTest(`button-open-notification-${id}`);
assert.equal(label(1)?.textContent?.trim(), "Open request", "estimate opens a request");
assert.equal(label(2)?.textContent?.trim(), "Open request", "callback opens a request");
assert.equal(label(3)?.textContent?.trim(), "Open request", "statement opens a request");
assert.equal(label(4)?.textContent?.trim(), "Open task", "task alert opens a task");
assert.equal(label(5)?.textContent?.trim(), "Open request", "support opens a request");
assert.equal(label(1)?.getAttribute("aria-label"), "Open request: New Estimate Request", "accessible name includes the alert");
assert.ok(![1, 2, 3, 4, 5].some(id => label(id)?.textContent?.trim() === "Open"), "no bare 'Open' button remains");
for (const id of [1, 2, 3, 4, 5]) {
  const button = label(id)!;
  assert.equal(button.tagName, "BUTTON", "the action is a native button (Tab and Enter work natively)");
  assert.ok(button.tabIndex >= 0, "the action is in the tab order");
}
assert.ok(!text().includes("No destination"), "the old wording is gone");

// 2. An alert that never recorded its request is explicit, not blank, and has no button.
assert.equal(byTest("text-notification-no-destination-6")?.textContent, "No linked record");
assert.ok(byTest("text-notification-no-destination-6")?.getAttribute("title")?.includes("did not record"), "the reason is available");
assert.ok(!label(6), "an unresolved alert offers no button");

// 3. Aged digest and SLA reminders sit in their own named group, below current work; nothing is removed.
const aged = byTest("notifications-aged-group") as HTMLDetailsElement | null;
assert.ok(aged, "an aged group exists");
assert.equal(aged!.open, false, "the aged group starts collapsed");
assert.ok(byTest("notifications-aged-summary")?.textContent?.includes("Older digests and SLA reminders (2, 1 unread)"), text().slice(0, 300));
assert.ok(aged!.contains(byTest("card-notification-7")) && aged!.contains(byTest("card-notification-8")), "aged digest and SLA are grouped");
for (const id of [1, 2, 3, 4, 5, 6, 9]) assert.ok(!aged!.contains(byTest(`card-notification-${id}`)), `notification ${id} stays with current work`);
assert.ok(byTest("badge-notification-unread-7") && !byTest("badge-notification-unread-8"), "each grouped alert keeps its own unread state");
assert.equal(document.querySelectorAll('[data-testid^="card-notification-"]').length, rows.length, "every notification is still present");
const currentList = byTest("notifications-list")!;
assert.ok(byTest("card-notification-9")!.compareDocumentPosition(aged!) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING, "the aged group comes after current work");
assert.ok(currentList.contains(byTest("card-notification-6")), "an unresolved older alert that is not a digest or SLA reminder stays in the main list");

// 4. A target check that fails leaves the alert unread, issues no read request, announces it, and Retry recovers.
targetMode = "fail";
let beforeTargets = targetCalls();
await act(async () => { label(1)!.click(); });
await waitFor(() => !!byTest("text-notification-target-failure-1"), "failure announced");
assert.equal(targetCalls(), beforeTargets + 1, "exactly one target check");
assert.equal(readCalls(), 0, "a failed check never marks the alert read");
assert.equal(byTest("text-notification-target-failure-1")?.getAttribute("role"), "alert", "the failure is announced");
assert.ok(byTest("text-notification-target-failure-1")?.textContent?.includes("left unread"), "the message says it stayed unread");
assert.ok(byTest("badge-notification-unread-1"), "still unread after the failed check");
assert.ok(byTest("button-notification-retry-1"), "a failed check offers Retry");
targetMode = "ok";
await act(async () => { byTest("button-notification-retry-1")!.click(); });
await waitFor(() => readCalls() === 1, "retry marks read once after resolving");
assert.equal(location.pathname + location.search, "/dashboard/lead-ops?tab=pipeline&ref=AAAA0001", "retry opens the exact request");
assert.equal(requests.filter(r => r.method === "PUT" && r.path === "/api/notifications/1/read").length, 1, "read is for that alert only");

// 5. A stale target (missing, archived or no longer authorized) leaves the alert unread and offers no pointless Retry.
await act(async () => { history.pushState({}, "", "/dashboard/notifications"); window.dispatchEvent(new dom.window.PopStateEvent("popstate")); });
targetMode = "stale";
const readsBefore = readCalls();
await act(async () => { label(4)!.click(); });
await waitFor(() => !!byTest("text-notification-target-failure-4"), "stale target explained");
assert.ok(byTest("text-notification-target-failure-4")?.textContent?.includes("missing, archived, unsupported or no longer authorized"), "stale wording");
assert.equal(readCalls(), readsBefore, "a stale target never marks the alert read");
assert.ok(!byTest("button-notification-retry-4"), "no Retry for a target that is gone");
assert.ok(byTest("badge-notification-unread-4"), "the alert stays unread");

// 6. A denied check (404) behaves like a failed check: unread kept, Retry offered.
targetMode = "denied";
await act(async () => { label(5)!.click(); });
await waitFor(() => !!byTest("text-notification-target-failure-5"), "denied explained");
assert.equal(readCalls(), readsBefore, "a denied check never marks the alert read");
assert.ok(byTest("button-notification-retry-5") && byTest("badge-notification-unread-5"), "unread kept and Retry offered after denial");
assert.ok(!byTest("text-notification-target-failure-4"), "only the most recent failure is shown");

await act(async () => root.unmount());
console.log("NOTIFICATION_LIST_UI_PASS");
process.exit(0);
