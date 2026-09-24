---
name: pre-deploy workflow port conflict with the dev server
description: Why the pre-deploy workflow fails with "port 5000 already owned" even when the app is otherwise healthy.
---

The `pre-deploy` workflow starts its own server instance bound to the configured port (5000) and refuses to evict a pid it doesn't own. If the `Start application` (dev) workflow is already running and holding port 5000, `pre-deploy` fails immediately with "Configured port 5000 is already owned by another process" before running any of its real checks.

**Why:** pre-deploy is designed to boot a clean, isolated server process for its checks (including a RELEASE_SHA/version-drift check against the live server), not to share the already-running dev server.

**How to apply:** This is not a regression to chase in app code. If you need a clean pre-deploy run, expect it to conflict with a live `Start application` workflow on the same port; treat this specific failure mode as an execution-order issue, not evidence of a code defect, when other independent verification (unit/certification scripts, tsc, migration integrity) already passed.
