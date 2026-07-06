#!/usr/bin/env tsx
/**
 * Task #767 — Truthful-State Follow-ups: Ticket Reply Draft Component Test
 *
 * Real React component render test (jsdom + react-dom/client, no vitest/jest)
 * for client/src/hooks/use-ticket-draft.ts — the hook that backs the reply
 * textarea in Tickets.tsx's TicketConversation. Mounts a minimal wrapper
 * component (real <textarea> bound to the hook, real jsdom `window.localStorage`)
 * and simulates navigation by unmounting and remounting a fresh component tree
 * with the same ticketId, verifying:
 *   - typed text persists across unmount/remount ("navigate away and back")
 *   - a different ticket's draft is isolated (no cross-contamination)
 *   - AI-inserted draft text populates the box and is itself persisted
 *   - discard clears the draft immediately
 *   - a successful send (clearAfterSend) clears the draft
 *
 * No network calls, no DB, no outbound sends.
 *
 * Run: npx tsx scripts/test-ticket-reply-box.tsx
 * Exits 0 if all assertions pass, 1 if any fail.
 */

import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).navigator = dom.window.navigator;
(globalThis as any).HTMLElement = dom.window.HTMLElement;
(globalThis as any).Element = dom.window.Element;
(globalThis as any).Node = dom.window.Node;
(globalThis as any).localStorage = dom.window.localStorage;
(globalThis as any).requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 0);
(globalThis as any).cancelAnimationFrame = (id: any) => clearTimeout(id);
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
    failures.push(label);
  }
}

async function main() {
  console.log(`▶ Testing ticket reply draft persistence (jsdom + react-dom/client)\n`);

  const React = await import("react");
  (globalThis as any).React = React;
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react-dom/test-utils");
  const { useTicketDraft } = await import("../client/src/hooks/use-ticket-draft");
  const { loadTicketDraft } = await import("../client/src/lib/ticket-draft");

  window.localStorage.clear();

  // Minimal reply-box wrapper mirroring the real integration in Tickets.tsx's
  // TicketConversation: a controlled <textarea> bound to useTicketDraft, plus
  // buttons that call discard()/clearAfterSend() so we can drive them via the DOM.
  function ReplyBox({
    ticketId,
    draftToInsert,
    onDraftInserted,
  }: {
    ticketId: number;
    draftToInsert?: { text: string; nonce: number } | null;
    onDraftInserted?: () => void;
  }) {
    const { replyContent, setReplyContent, discard, clearAfterSend } = useTicketDraft(
      ticketId,
      draftToInsert,
      onDraftInserted
    );
    return React.createElement(
      "div",
      null,
      React.createElement("textarea", {
        "data-testid": "textarea-reply",
        value: replyContent,
        onChange: (e: any) => setReplyContent(e.target.value),
      }),
      React.createElement(
        "button",
        { "data-testid": "button-discard", onClick: () => discard() },
        "Discard"
      ),
      React.createElement(
        "button",
        { "data-testid": "button-send", onClick: () => clearAfterSend() },
        "Send"
      )
    );
  }

  function mount(container: HTMLElement, props: Parameters<typeof ReplyBox>[0]) {
    const root = createRoot(container);
    act(() => {
      root.render(React.createElement(ReplyBox, props));
    });
    return root;
  }

  function typeInto(container: HTMLElement, text: string) {
    const textarea = container.querySelector('[data-testid="textarea-reply"]') as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => {
      setter.call(textarea, text);
      textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
  }

  function click(container: HTMLElement, testId: string) {
    const btn = container.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement;
    act(() => {
      btn.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
    });
  }

  function getTextarea(container: HTMLElement): HTMLTextAreaElement {
    return container.querySelector('[data-testid="textarea-reply"]') as HTMLTextAreaElement;
  }

  // --- Scenario 1: type a reply, "navigate away" (unmount), "navigate back" (remount) ---
  let container = document.createElement("div");
  document.body.appendChild(container);
  let root = mount(container, { ticketId: 101 });

  assert("Ticket 101 starts with an empty draft", getTextarea(container).value === "");

  typeInto(container, "Thanks for reaching out, we'll review your statement today.");
  assert(
    "Typed reply reflected in textarea immediately",
    getTextarea(container).value === "Thanks for reaching out, we'll review your statement today."
  );
  assert(
    "Typed reply persisted to localStorage as it's typed",
    loadTicketDraft(101) === "Thanks for reaching out, we'll review your statement today."
  );

  // Simulate navigating away: unmount the component entirely.
  act(() => root.unmount());
  document.body.removeChild(container);

  // Simulate navigating back to the same ticket: fresh container, fresh mount.
  container = document.createElement("div");
  document.body.appendChild(container);
  root = mount(container, { ticketId: 101 });

  assert(
    "Draft survives unmount/remount (navigate away and back) for the same ticket",
    getTextarea(container).value === "Thanks for reaching out, we'll review your statement today.",
    getTextarea(container).value
  );

  act(() => root.unmount());
  document.body.removeChild(container);

  // --- Scenario 2: a different ticket does not see ticket 101's draft ---
  container = document.createElement("div");
  document.body.appendChild(container);
  root = mount(container, { ticketId: 202 });
  assert(
    "A different ticket (202) does not inherit ticket 101's draft",
    getTextarea(container).value === ""
  );
  act(() => root.unmount());
  document.body.removeChild(container);

  // --- Scenario 3: AI-inserted draft populates the box and persists ---
  container = document.createElement("div");
  document.body.appendChild(container);
  let insertedCallbackFired = false;
  root = mount(container, {
    ticketId: 303,
    draftToInsert: { text: "AI suggested reply: your statement looks great!", nonce: 1 },
    onDraftInserted: () => {
      insertedCallbackFired = true;
    },
  });
  assert(
    "AI-inserted draft text appears in the textarea",
    getTextarea(container).value === "AI suggested reply: your statement looks great!"
  );
  assert("AI insertion invokes onDraftInserted callback", insertedCallbackFired === true);
  assert(
    "AI-inserted draft is persisted to localStorage",
    loadTicketDraft(303) === "AI suggested reply: your statement looks great!"
  );

  // --- Scenario 4: discard clears the draft immediately (in-memory and storage) ---
  click(container, "button-discard");
  assert("Discard clears the textarea", getTextarea(container).value === "");
  assert("Discard clears the persisted draft from storage", loadTicketDraft(303) === "");
  act(() => root.unmount());
  document.body.removeChild(container);

  // --- Scenario 5: clearAfterSend (successful comment submission) clears the draft ---
  container = document.createElement("div");
  document.body.appendChild(container);
  root = mount(container, { ticketId: 404 });
  typeInto(container, "Draft to be sent");
  assert("Pre-send: draft persisted", loadTicketDraft(404) === "Draft to be sent");
  click(container, "button-send");
  assert("Post-send: textarea cleared", getTextarea(container).value === "");
  assert("Post-send: persisted draft cleared", loadTicketDraft(404) === "");
  act(() => root.unmount());
  document.body.removeChild(container);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("\nFailures:", failures.join(", "));
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test script crashed:", err);
  process.exit(1);
});
