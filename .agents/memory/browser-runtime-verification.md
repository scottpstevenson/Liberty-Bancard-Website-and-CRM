---
name: Browser runtime verification
description: Use the environment's Chromium wrapper rather than cached browser downloads for local browser checks.
---
Prefer the available Chromium wrapper when launching a local Playwright browser.

**Why:** Cached Playwright browser executables lacked runtime libraries on Nix.
Assembling an LD_LIBRARY_PATH from the store introduced 32-bit and incompatible
library combinations; the environment-provided wrapper launched successfully.

**How to apply:** Check `command -v chromium` before launching a downloaded
browser or attempting library repairs. Use that executable as Playwright's
executablePath; package caches and their paths are not durable.

For responsive acceptance, inspect the captured image and explicitly verify
fixed dialog bounds, not only page text and document scroll width.

**Why:** A translated fixed dialog can be half outside the viewport while the
document reports no horizontal overflow. That produced a false-positive phone
check until the actual image and dialog geometry were inspected.

**How to apply:** Check that the current-source overlay fits the viewport after
its opening animation. Ensure its assets were rebuilt for the source being
certified; a passing temporary-checkout build does not refresh workspace assets.
