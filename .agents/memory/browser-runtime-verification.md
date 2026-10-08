---
name: Browser runtime verification
description: Use the environment's Chromium wrapper rather than cached browser downloads for local browser checks.
---
Prefer the environment-supported browser runtime over cached executables.

**Why:** Cached binaries can be incompatible with the current Nix runtime.

**How to apply:** Verify an actual isolated browser connection before relying
on the runtime; an executable's version response is not provision proof.

Chromium native date/time controls need segmented keyboard entry rather than
a single CDP `Input.insertText` call.

**Why:** Bulk insertion silently left date/time values unchanged in an actual
browser, while segment navigation and individual key events updated them.

**How to apply:** Use real pointer focus and ArrowLeft/ArrowRight plus key events
in the browser's declared locale; assert the resulting input value before saving.
Do not misclassify an automation input failure as an application defect.

For real pointer input, wait for the modal's opening transition and verify
hit testing; visible title text or an existing input is not enough.

**Why:** A newly opened protected dialog had its input present and focused but
coordinate-based clicks failed until the opening transition settled.

**How to apply:** Retain real pointer/keyboard input and capture the intended
rectangle and actual hit target on failure, rather than replacing it with a
programmatic DOM click.

For responsive acceptance, inspect the captured image and explicitly verify
fixed dialog bounds, not only page text and document scroll width.

Use a frontend-only Vite configuration without injected development tooling
for virtual-module component fixtures.

**Why:** Injected runtime tooling produced an “Invalid or unexpected token”
overlay in a synthetic entry, covering the test controls despite the component
rendering correctly. Production component behavior was not the cause.

**How to apply:** Keep the real CSS, React transform, and module aliases, but
omit unrelated development banners and runtime-overlay plugins. Wait for toast
opening animations before coordinate-based dismissal checks.

**Why:** Fixed or translated overlays can be clipped without increasing document
scroll width, so page overflow alone can give a false accessibility pass.

**How to apply:** Check that the current-source overlay fits the viewport after
its opening animation and that serving assets match the source being certified.

Chromium blocks reserved ports such as 6000 before making a page request.

**Why:** The screenshot browser returned `ERR_UNSAFE_PORT` for a running
isolated preview on 6000; that error is not evidence of an application crash.

**How to apply:** Use an allowed serving port (the fixture's actual private
port is suitable for unauthenticated captures) without bypassing login or
changing the normal application Run.
