---
name: jsdom component render testing without vitest/jest
description: How to real-render a React/Radix component tree in a plain scripts/test-*.tsx file (npx tsx), when the project forbids test frameworks.
---

This project's testing convention forbids vitest/jest — regression tests are standalone `scripts/test-*.ts`
files run via `npx tsx`. When a change needs an actual DOM-level assertion (e.g. "is this checkbox really
disabled", "does this draft survive unmount/remount") rather than a pure-function/API test, you can still get
a real React render without a test framework.

**Why this matters:** `npx tsx` uses esbuild's classic JSX transform by default (not the automatic runtime),
and jsdom must be wired up manually — several assertions will otherwise fail with confusing runtime errors
rather than real component-behavior failures.

**How to apply:**
1. Create a `JSDOM` instance and assign `window`, `document`, `navigator`, `HTMLElement`, `Element`, `Node`,
   `localStorage` onto `globalThis` before any React/component import.
2. Radix UI components need extra globals jsdom doesn't provide: `getComputedStyle`, `MutationObserver`,
   `ResizeObserver` (stub with a no-op class if absent), `matchMedia` (stub returning `matches: false`),
   `CustomEvent`/`Event`.
3. esbuild's classic JSX transform emits bare `React.createElement(...)` calls with no import — set
   `(globalThis as any).React = await import("react")` before importing any `.tsx` component under test, or
   you'll get `ReferenceError: React is not defined`.
4. Set `(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true` to silence (not just cosmetic-ignore) React 18's
   "current testing environment is not configured to support act()" warnings when using `act` from
   `react-dom/test-utils` with `react-dom/client`'s `createRoot`.
5. To simulate real user input on controlled inputs, use the native value setter
   (`Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set`) then dispatch a real
   `input`/`click` event — directly setting `.value` does not trigger React's onChange.
6. To test "does state survive navigation," literally `root.unmount()` a real DOM container and mount a fresh
   `createRoot` on a new container with the same props — don't fake it by just re-rendering the same root.
