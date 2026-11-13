/**
 * Phase 6 R08 mounted behaviour: unavailable states say it plainly and keep raw failure text in a named, closed disclosure.
 * Program Health and the paid-provider panel are mounted with an injected fetch that fails with raw database text. Proves the
 * sentence an operator reads has no raw text, Retry issues exactly one request, the raw text is reachable under "Technical
 * details", the emergency stop stays visible outside every disclosure, and telemetry sits in the named provider disclosure.
 * No real session, route, database or provider; no stop is ever pressed.
 */
import assert from "node:assert/strict";
import { QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

const jsdomModule = await import(["js", "dom"].join("")) as {
  JSDOM: new (html: string, options: { url: string; pretendToBeVisual: boolean }) => { window: any };
};
const dom = new jsdomModule.JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
  url: "http://localhost/dashboard/lead-ops?tab=health", pretendToBeVisual: true,
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

const { ProgramHealthPanel } = await import("./ProgramHealthPanel");
const { PaidProviderControlsPanel } = await import("./PaidProviderControlsPanel");
const { queryClient, transitionProtectedActor } = await import("@/lib/queryClient");

const admin = { id: "actor-admin", role: "admin", accountVersion: 1, permissions: [] as string[] };
const RAW = 'ERROR: relation "provider_controls" does not exist at character 42 (SQLSTATE 42P01)';
let failing = true;
const calls: string[] = [];
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = new URL(String(input), "http://localhost");
  const method = (init.method ?? "GET").toUpperCase();
  calls.push(`${method} ${url.pathname}`);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (url.pathname === "/api/auth/user") return json(admin);
  if (failing) return new Response(RAW, { status: 500 });
  return json({});
}) as any;

const text = () => document.body.textContent ?? "";
async function waitFor(check: () => boolean, label: string) {
  for (let i = 0; i < 300; i++) { if (check()) return; await act(async () => { await new Promise(r => setTimeout(r, 10)); }); }
  throw new Error(`Timed out: ${label}; ${text().slice(0, 600)}`);
}
const byTest = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const count = (call: string) => calls.filter(c => c === call).length;
/** Visible text outside every closed <details>. */
function visibleText(): string {
  const clone = document.body.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("details:not([open])").forEach(d => { const summary = d.querySelector("summary"); d.replaceChildren(...(summary ? [summary] : [])); });
  return clone.textContent ?? "";
}

await act(async () => { await transitionProtectedActor(admin); queryClient.setQueryData(["/api/auth/user"], admin); });
const root = createRoot(document.getElementById("root")!);

// 1. Program Health unavailable: plain sentence, Retry, raw text only in a closed named disclosure.
await act(async () => { root.render(<QueryClientProvider client={queryClient}><ProgramHealthPanel /></QueryClientProvider>); });
await waitFor(() => !!byTest("program-health-unavailable"), "health unavailable state");
assert.ok(byTest("program-health-unavailable")!.textContent!.includes("Program Health could not be read right now"), "plain unavailable sentence");
assert.ok(!visibleText().includes("provider_controls") && !visibleText().includes("SQLSTATE"), "no raw database text outside the disclosure");
const technical = byTest("program-health-technical-details") as HTMLDetailsElement | null;
assert.ok(technical, "raw text has a named disclosure");
assert.equal(technical!.open, false, "the technical disclosure starts closed");
assert.equal(technical!.querySelector("summary")?.textContent, "Technical details");
assert.ok(technical!.textContent!.includes(RAW), "the raw text is available inside it");
const healthBefore = count("GET /api/lead-ops/health");
assert.ok(healthBefore >= 1, "the aggregate read was requested");
await act(async () => { byTest("program-health-retry")!.click(); });
await waitFor(() => count("GET /api/lead-ops/health") === healthBefore + 1, "retry request");
assert.equal(count("GET /api/lead-ops/health"), healthBefore + 1, "Retry issues exactly one aggregate request");
await act(async () => { await new Promise(r => setTimeout(r, 50)); });
assert.equal(count("GET /api/lead-ops/health"), healthBefore + 1, "no recount loop follows");
await act(async () => root.unmount());

// 2. Paid provider panel unavailable: the stop stays visible outside any disclosure; plain error, Retry, raw text disclosure.
calls.length = 0;
queryClient.clear();
await act(async () => { await transitionProtectedActor(admin); queryClient.setQueryData(["/api/auth/user"], admin); });
const root2 = createRoot(document.getElementById("root")!);
await act(async () => { root2.render(<QueryClientProvider client={queryClient}><PaidProviderControlsPanel /></QueryClientProvider>); });
await waitFor(() => !!byTest("paid-provider-controls-error"), "provider panel error state");
const stop = byTest("button-paid-provider-emergency-stop")!;
assert.ok(stop, "the emergency stop is rendered");
assert.equal(stop.closest("details"), null, "the emergency stop is not inside any disclosure");
assert.equal((stop as HTMLButtonElement).disabled, false, "the stop is usable while provider state is unreadable");
assert.ok(byTest("paid-provider-controls-error")!.textContent!.includes("Provider control state could not be read"), "plain unavailable sentence");
assert.ok(!visibleText().includes("provider_controls") && !visibleText().includes("SQLSTATE"), "no raw database text outside the disclosure");
const providerTechnical = byTest("paid-provider-controls-technical-details") as HTMLDetailsElement | null;
assert.ok(providerTechnical && providerTechnical.open === false && providerTechnical.textContent!.includes(RAW), "raw text sits in a closed Technical details disclosure");
const providerDisclosure = byTest("disclosure-provider-controls");
assert.ok(providerDisclosure, "the detailed provider state has its own named disclosure");
assert.ok(providerDisclosure!.textContent!.includes("Provider controls and state (administrators)"), "named for administrators");
const statusBefore = count("GET /api/lead-ops/pilot/status-overview");
await act(async () => { byTest("button-paid-provider-controls-retry")!.click(); });
await waitFor(() => count("GET /api/lead-ops/pilot/status-overview") === statusBefore + 1, "provider retry request");
assert.equal(count("POST /api/lead-ops/pilot/emergency-stop-paid"), 0, "nothing in this test presses the emergency stop");
assert.equal(calls.filter(c => c.startsWith("POST")).length, 0, "no write request was made");
await act(async () => root2.unmount());

console.log("MAINTENANCE_DISCLOSURES_UI_PASS");
process.exit(0);
