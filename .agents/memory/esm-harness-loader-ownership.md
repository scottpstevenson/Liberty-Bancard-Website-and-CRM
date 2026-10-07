---
name: ESM harness loader ownership
description: Avoid stacking an automatic tsx loader around programmatic tsImport harnesses.
---
Use one owner for module loading in programmatic-import harnesses.

**Why:** Stacking an external transpilation loader around a harness that already
owns loading can prevent process completion without indicating a component defect.

**How to apply:** Preserve the registered runner's loading model and require
successful process exit, not just a printed assertion summary.
