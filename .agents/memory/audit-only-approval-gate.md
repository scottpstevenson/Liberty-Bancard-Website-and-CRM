---
name: Audit-only approval-gate pattern
description: How to build a compliance approval gate that records decisions without ever flipping the actual feature flag/env var itself.
---

When a task asks for an "approval gate" or "go-live audit" for a risky channel (SMS/voice/etc.) that is controlled by an env var or Replit Secret, the gate must be strictly read/audit-only:

- Never write to `process.env.<FLAG>` and never call any Secrets create/update/delete API from route handlers, even on a successful approval. Actually flipping the flag stays a manual operator action (edit the Secret + restart).
- The "enable" endpoint should re-evaluate the checklist server-side using real signals (DB state, config presence) rather than trusting a client-submitted "passed" boolean — this prevents a compromised or buggy frontend from recording a false approval.
- Every checklist view, approval, and any dry-run/test action should append to an audit-log table (actor identity + timestamp + snapshot of the checklist at that moment), not overwrite state.
- Verify compliance with a static source-code assertion test (regex-scan the route file for forbidden `process.env.X =` / `setSecret(` patterns) in addition to behavioral tests — this catches regressions where a future edit accidentally wires the gate directly to the flag.

**Why:** these gates exist specifically so that an automated/AI-touched code path is never the one that turns on live outbound SMS/voice/ringless-voicemail sending; only a human editing a Secret and restarting the app can do that.

**How to apply:** any task described as an "audit"/"approval gate" (not "activation") for a comms channel — implement the 4 points above; do not shortcut by writing to the env var directly even behind a feature check.
