#!/usr/bin/env tsx
/**
 * Task #767 — Truthful-State Follow-ups: SMS Follow-Up Section Component Test
 *
 * Real React component render test (jsdom + react-dom/client, no vitest/jest)
 * for client/src/components/call-outcome/SmsFollowUpSection.tsx — the
 * presentational SMS gating section used inside CallOutcome.tsx's review
 * step. Verifies the checkbox/textarea are actually disabled in the DOM and
 * the correct reason text renders for each eligibility state produced by
 * computeSmsEligibility().
 *
 * No network calls, no DB, no outbound sends.
 *
 * Run: npx tsx scripts/test-sms-follow-up-section.tsx
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
(globalThis as any).SVGElement = dom.window.SVGElement;
(globalThis as any).requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 0);
(globalThis as any).cancelAnimationFrame = (id: any) => clearTimeout(id);
(globalThis as any).getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
(globalThis as any).DocumentFragment = dom.window.DocumentFragment;
(globalThis as any).MutationObserver = dom.window.MutationObserver;
(globalThis as any).CustomEvent = dom.window.CustomEvent;
(globalThis as any).Event = dom.window.Event;
(globalThis as any).ResizeObserver =
  (dom.window as any).ResizeObserver ||
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
(dom.window as any).matchMedia =
  (dom.window as any).matchMedia ||
  ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
(globalThis as any).matchMedia = (dom.window as any).matchMedia;

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
  console.log(`▶ Testing SmsFollowUpSection component rendering (jsdom + react-dom/client)\n`);

  const React = await import("react");
  (globalThis as any).React = React;
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react-dom/test-utils");
  const { SmsFollowUpSection } = await import("../client/src/components/call-outcome/SmsFollowUpSection");
  const { computeSmsEligibility } = await import("../shared/sms-eligibility");

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  function render(props: {
    eligibility: ReturnType<typeof computeSmsEligibility>;
    sendSms: boolean;
    smsBody: string;
    onSendSmsChange?: (v: boolean) => void;
    onSmsBodyChange?: (v: string) => void;
  }) {
    act(() => {
      root.render(
        React.createElement(SmsFollowUpSection, {
          eligibility: props.eligibility,
          sendSms: props.sendSms,
          onSendSmsChange: props.onSendSmsChange ?? (() => {}),
          smsBody: props.smsBody,
          onSmsBodyChange: props.onSmsBodyChange ?? (() => {}),
        })
      );
    });
  }

  function getCheckbox(): HTMLElement | null {
    return container.querySelector('[data-testid="checkbox-send-sms"]');
  }
  function getTextarea(): HTMLTextAreaElement | null {
    return container.querySelector('[data-testid="input-sms-body"]');
  }
  function getReasonText(): HTMLElement | null {
    return container.querySelector('[data-testid="text-sms-eligibility-reason"]');
  }

  // 1. No contact selected → disabled, "Select a contact first."
  render({
    eligibility: computeSmsEligibility({ selectedContactId: "", contactsLoading: false, contact: undefined }),
    sendSms: true,
    smsBody: "",
  });
  assert(
    "No contact selected → checkbox rendered with disabled attribute",
    getCheckbox()?.getAttribute("aria-disabled") === "true" || getCheckbox()?.hasAttribute("disabled"),
    getCheckbox()?.outerHTML
  );
  assert("No contact selected → textarea is disabled", getTextarea()?.disabled === true);
  assert(
    "No contact selected → reason text reads 'Select a contact first.'",
    getReasonText()?.textContent === "Select a contact first.",
    getReasonText()?.textContent ?? "null"
  );

  // 2. Contacts still loading → disabled, checking reason.
  render({
    eligibility: computeSmsEligibility({ selectedContactId: "5", contactsLoading: true, contact: undefined }),
    sendSms: true,
    smsBody: "",
  });
  assert("Loading → textarea is disabled", getTextarea()?.disabled === true);
  assert(
    "Loading → reason text reads 'Checking SMS eligibility…'",
    getReasonText()?.textContent === "Checking SMS eligibility…",
    getReasonText()?.textContent ?? "null"
  );

  // 3. Contact has no phone → disabled, specific reason.
  render({
    eligibility: computeSmsEligibility({
      selectedContactId: "5",
      contactsLoading: false,
      contact: { phone: "", consentSms: true },
    }),
    sendSms: true,
    smsBody: "",
  });
  assert("No phone → textarea is disabled", getTextarea()?.disabled === true);
  assert(
    "No phone → reason text mentions phone number",
    getReasonText()?.textContent === "SMS unavailable — no phone number on file.",
    getReasonText()?.textContent ?? "null"
  );

  // 4. Contact has phone but no consent → disabled, specific reason.
  render({
    eligibility: computeSmsEligibility({
      selectedContactId: "5",
      contactsLoading: false,
      contact: { phone: "3055551234", consentSms: false },
    }),
    sendSms: true,
    smsBody: "",
  });
  assert("No consent → textarea is disabled", getTextarea()?.disabled === true);
  assert(
    "No consent → reason text mentions consent",
    getReasonText()?.textContent === "SMS unavailable — SMS consent is not recorded.",
    getReasonText()?.textContent ?? "null"
  );

  // 5. Fully eligible contact → checkbox/textarea enabled, no reason text rendered.
  render({
    eligibility: computeSmsEligibility({
      selectedContactId: "5",
      contactsLoading: false,
      contact: { phone: "3055551234", consentSms: true },
    }),
    sendSms: true,
    smsBody: "Hi there!",
  });
  assert("Eligible → textarea is enabled (not disabled)", getTextarea()?.disabled === false);
  assert(
    "Eligible → checkbox has no disabled attribute",
    !getCheckbox()?.hasAttribute("disabled") && getCheckbox()?.getAttribute("aria-disabled") !== "true"
  );
  assert("Eligible → no reason text rendered", getReasonText() === null);
  assert("Eligible → textarea reflects passed smsBody value", getTextarea()?.value === "Hi there!");

  act(() => root.unmount());

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
