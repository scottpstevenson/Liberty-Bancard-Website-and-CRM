---
name: Partial patch results
description: Multi-file patch failures can retain successful edits to other files.
---
Treat a failed multi-file patch result as potentially partially applied.

**Why:** The workspace patch tool reports per-file outcomes and can preserve successful file changes even when another file fails and the overall call returns a failure.

**How to apply:** Check the per-file results and current diff before retrying; never assume every edit was rolled back.