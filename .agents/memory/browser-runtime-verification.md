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
