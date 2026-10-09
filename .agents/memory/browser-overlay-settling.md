---
name: Browser overlay transition evidence
description: Avoid confusing asynchronous Radix transitions with genuine accessibility/layout failures.
---

Wait for overlay transitions and real focus restoration in browser tests, not
only the presence or absence of a DOM node.

An overlay-covered screenshot is not visible-state evidence even when earlier
pointer actions and DOM assertions passed.

**Why:** Delayed welcome overlays can open after successful actions, covering the
final readback while background DOM text still satisfies an assertion.

**How to apply:** Dismiss overlays through their real controls and verify their
absence before capturing final visible-state evidence. Account for persisted
dismissal across document navigation instead of assuming the overlay will reopen.

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

Wait for the real action's busy lock to release after a readback becomes visible.

**Why:** React can display the accepted state before a mutation's final pending
flag clears. The text is not proof that the next physical action is enabled.

**How to apply:** Assert the button is enabled and is a real pointer target before
retrying. Keep disabled controls and the application's pending protection intact.

Wait for destination commitment after controls that perform document navigation,
and for hydration-dependent layout before measuring a real pointer target.

**Why:** A label shared by the old and new pages can match before navigation
commits, while independent read failures can move a footer control. This can
misattribute dedicated mobile branding to a failed narrow employee layout.

**How to apply:** Assert the actual destination and user-selected view state,
then measure the intended allocated container. Keep product redirects and auth
boundaries intact; do not inject a preference or bypass to manufacture proof.

For consecutive native Escape checks, wait for the closed top overlay to actually
unmount before expecting the next dismissal owner to handle the second key.

**Why:** A toast reached `data-state="closed"` while its exiting Radix
DismissableLayer still consumed another Escape. Waiting for Presence unmount
established separate toast/dialog dismissal without altering application focus.

**How to apply:** Assert the first owner closes and the underlying dialog remains;
wait for actual unmount, then exercise the next Escape and connected focus return.
