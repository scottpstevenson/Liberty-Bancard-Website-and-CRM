---
name: Browser runtime verification
description: Use the environment's Chromium wrapper rather than cached browser downloads for local browser checks.
---
Prefer the environment-supported browser runtime over cached executables.

Preserve request and exception journals before closing or replacing an actor's
browser context; aggregate them with explicit actor labels.

**Why:** A multi-role receipt previously retained only the final context's journal,
so its zero-exception count did not establish coverage of earlier role phases.

**How to apply:** Keep per-context journals and aggregate counts separately from
phase assertions. Never infer whole-session coverage from the last context.

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

Verify the character payload before treating failed native Enter activation
as an application focus or overlay defect.

**Why:** In Chromium CDP, a key-code-only Enter sequence did not activate a
focused native button; adding `text` and `unmodifiedText` as `"\r"` did.

**How to apply:** Retain native keyboard input, include the character on
keyDown with a corresponding keyUp, and assert the resulting activation.
Do not replace the interaction with a programmatic click.

Keep named failure archives immutable; never copy the latest generic failure
over a historical archive at the start of another run.

**Why:** Recopying a generic failure under a prior case name can silently change
its contents and falsely attribute a newer failure to that historical case.

**How to apply:** Capture each actual failure with its source/run attribution.
An archive name alone does not establish the event or its cause.

**How to apply:** Also verify which failure filename the current harness actually
writes and bind its candidate/timestamp before copying. A still-present generic
image can be stale even though the latest run really failed; qualify a mistaken
copy explicitly instead of silently presenting it as that run's image.
