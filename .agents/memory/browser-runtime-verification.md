---
name: Browser runtime verification
description: Use the environment's Chromium wrapper rather than cached browser downloads for local browser checks.
---
Prefer the environment-supported browser runtime over cached executables.

**Why:** Cached binaries can be incompatible with the current Nix runtime.

**How to apply:** Verify an actual isolated browser connection before relying
on the runtime; an executable's version response is not provision proof.

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
