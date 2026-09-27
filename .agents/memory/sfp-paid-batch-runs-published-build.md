---
name: Paid-batch runs execute the published build, not workspace edits
description: Any admin-route-triggered paid-provider batch (e.g. SFP classification snapshot run) against the production URL executes the last PUBLISHED build's code, not the current workspace edits.
---

The production URL (from `getDeploymentInfo().primaryUrl`) is an autoscale
deployment with its own build, separate from the dev workflow. Editing
server code in the workspace has zero effect on that deployment until the
user publishes.

**Why this bit us:** A classification-evidence bug fix (adding a free
name-derived vertical signal before paid OpenAI escalation) was implemented
and verified offline, then a real paid batch was run against production to
validate it. The batch still hit the *old* code (evidence rows carried
`EMPTY_VERTICAL_LABEL`, the pre-fix reason code), spending real provider
budget for zero behavioral change, because the fix had not been published.

**How to apply:** Before running any real (non-dry-run) paid-provider batch
against production to validate a code change, confirm the change is live —
either by publishing first (user-initiated; the agent cannot publish itself)
or by proving via a harmless probe that the new code path is active. Never
assume a same-session edit is live in the production deployment.
