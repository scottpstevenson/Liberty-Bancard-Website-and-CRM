#!/usr/bin/env tsx
/**
 * South Florida Prospecting panel — freeze idempotency key UI persistence.
 *
 * The correction prompt for Task #1998 (section 6) requires proof that the
 * operator's freeze idempotency key survives a page reload instead of
 * silently minting a new one, and that only an explicit "Start new cohort"
 * action rotates it. Prior to this test, that behavior was implemented in
 * SouthFloridaProspectingPanel.tsx (localStorage-backed useState initializer)
 * but had NO automated regression coverage — only code inspection. This
 * real-renders the actual component in jsdom (no vitest/jest, per this
 * project's testing convention) and asserts against real localStorage and a
 * real unmount/remount cycle, which is the only way to prove "survives
 * reload" rather than just "the code looks right".
 *
 * Covers:
 *   - first mount with empty storage mints and persists a fresh UUID
 *   - unmount + fresh mount (simulated reload) reuses the SAME persisted key
 *   - clicking "Start new cohort" immediately persists a NEW key to storage
 *   - a subsequent reload after that click reuses the ROTATED key, not the
 *     original one
 *
 * Makes no real network calls that matter to the assertions: fetch is
 * stubbed to reject immediately so react-query's queries fail fast
 * (retry: false) without needing a live server.
 */
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
(globalThis as any).HTMLElement = dom.window.HTMLElement;
(globalThis as any).Element = dom.window.Element;
(globalThis as any).Node = dom.window.Node;
(globalThis as any).localStorage = dom.window.localStorage;
(globalThis as any).getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
(globalThis as any).MutationObserver = dom.window.MutationObserver;
(globalThis as any).ResizeObserver = (dom.window as any).ResizeObserver ?? class { observe() {} unobserve() {} disconnect() {} };
(globalThis as any).matchMedia = (dom.window as any).matchMedia ?? ((query: string) => ({
  matches: false, media: query, onchange: null,
  addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
}));
(globalThis as any).CustomEvent = dom.window.CustomEvent;
(globalThis as any).Event = dom.window.Event;
if (!(dom.window as any).crypto?.randomUUID) {
  Object.defineProperty(dom.window, "crypto", { value: (globalThis as any).crypto, configurable: true });
}
Object.defineProperty(globalThis, "crypto", { value: (dom.window as any).crypto ?? (globalThis as any).crypto, configurable: true });
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Stub fetch BEFORE importing the component so its react-query calls fail
// fast and deterministically instead of hitting the network.
(globalThis as any).fetch = async () => { throw new Error("network disabled in jsdom test"); };

(globalThis as any).React = await import("react");
const { act } = await import("react-dom/test-utils");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");

let assertions = 0;
function check(value: unknown, label: string): asserts value {
  assertions++;
  if (!value) { console.error(`✗ ${label}`); process.exit(1); }
  console.log(`✓ ${label}`);
}

const STORAGE_KEY = "sfp:freeze-idempotency-key";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function mountPanel(): Promise<{ container: HTMLDivElement; unmount: () => void }> {
  const { SouthFloridaProspectingPanel } = await import("../client/src/components/lead-ops/SouthFloridaProspectingPanel");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(QueryClientProvider, { client: queryClient },
        React.createElement(SouthFloridaProspectingPanel)),
    );
    // Let the failing fetch-backed queries settle.
    await new Promise((r) => setTimeout(r, 50));
  });
  return {
    container,
    unmount: () => { act(() => { root.unmount(); }); container.remove(); },
  };
}

try {
  check(window.localStorage.getItem(STORAGE_KEY) === null, "starts with no persisted idempotency key");

  // ── First mount: mints and persists a fresh key ───────────────────────────
  const first = await mountPanel();
  const keyAfterFirstMount = window.localStorage.getItem(STORAGE_KEY);
  check(!!keyAfterFirstMount && UUID_RE.test(keyAfterFirstMount), "first mount mints a valid UUID and persists it to localStorage immediately");
  first.unmount();

  // ── Simulated reload: a fresh mount must reuse the SAME persisted key ────
  const second = await mountPanel();
  const keyAfterReload = window.localStorage.getItem(STORAGE_KEY);
  check(keyAfterReload === keyAfterFirstMount, "a fresh mount (simulated page reload) reuses the SAME idempotency key from localStorage rather than minting a new one");

  // ── "Start new cohort" rotates the key immediately ────────────────────────
  const startNewButton = Array.from(second.container.querySelectorAll("button"))
    .find((b) => (b.textContent || "").includes("Start new cohort")) as HTMLButtonElement | undefined;
  check(!!startNewButton, "the 'Start new cohort' button is present in the rendered panel");
  await act(async () => { startNewButton!.click(); });
  const keyAfterRotate = window.localStorage.getItem(STORAGE_KEY);
  check(!!keyAfterRotate && UUID_RE.test(keyAfterRotate) && keyAfterRotate !== keyAfterFirstMount,
    "clicking 'Start new cohort' immediately persists a NEW, different key to localStorage");
  second.unmount();

  // ── Reload after rotation reuses the ROTATED key, not the original ───────
  const third = await mountPanel();
  const keyAfterSecondReload = window.localStorage.getItem(STORAGE_KEY);
  check(keyAfterSecondReload === keyAfterRotate, "a reload after rotation reuses the ROTATED key");
  check(keyAfterSecondReload !== keyAfterFirstMount, "the rotated key is durably different from the original pre-rotation key across reload");
  third.unmount();

  console.log(`\nSFP UI idempotency persistence: ${assertions} assertions passed.`);
  process.exit(0);
} catch (err) {
  console.error("SFP UI idempotency persistence test FAILED:", err);
  process.exit(1);
}
