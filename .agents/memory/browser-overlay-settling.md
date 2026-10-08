---
name: Browser overlay transition evidence
description: Avoid confusing asynchronous Radix transitions with genuine accessibility/layout failures.
---

Wait for overlay transitions and real focus restoration in browser tests, not
only the presence or absence of a DOM node.

**Why:** Private Chromium CDP command completion can precede Radix finite opening/
closing animations and deferred focus restoration. Immediate checks can report
an absent menu item, a temporarily offscreen Sheet input, or body focus while the
legitimate transition is still running.

**How to apply:** Wait for relevant finite animations to settle, then verify the
actual hit target/focus. Keep real keyboard/pointer events; never programmatically
focus an element to manufacture a passing focus-return assertion.

Stabilize exploratory browser assertions before freezing a source-pinned
acceptance candidate.

**Why:** Rebuilding for every harness correction is costly and obscures real
UI defects with wrong endpoint, storage-field or authority assumptions.

**How to apply:** Read the actual handler/DTO contracts first and separate
provisional debugging from final acceptance evidence. Freeze application and
harness inputs, then build and certify once the assertions are coherent.
Never relabel provisional results as a final passing receipt.
