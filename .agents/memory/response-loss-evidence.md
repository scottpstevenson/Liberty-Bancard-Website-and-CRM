---
name: Response-loss evidence
description: Require executed-fault evidence for response-loss and read-failure acceptance, including worker interception boundaries.
---
Persisted row counts alone cannot certify a response-loss test.

**Why:** A browser run persisted one task and showed success despite an
intended lost-reply scenario. That did not distinguish an unexecuted fault
from transparent transport recovery. Explicit fault-execution evidence and
an unreadable post-commit confirmation established the manual retry case.

**How to apply:** Count actual injected faults, bind them to the intended
method/path and candidate, and assert durable row/audit deltas separately.
Choose socket loss versus truncated confirmation according to the behavior
being certified; do not call a normal success response an unresolved save.

An idempotent PUT connection-loss scenario can display a confirmed save even
when the fault counter advances. Do not assume that a connection drop must
produce the UI's explicit retry state.

**Why:** A draft connection-loss fixture advanced its counter but the browser
displayed a saved timestamp with only one persisted revision. That result did
not prove an unresolved confirmation or a manual retry.

**How to apply:** Separate transparent recovery from explicit user retry.
For the latter, inject an unreadable committed response body, require the
actual fault and error state, then verify the same command's durable replay.

Page-target browser interception does not cover a service worker's own fetch context.

**Why:** A contact read returned a legitimate 200/empty array despite a configured
page-level 503 fault; another non-worker read was intercepted successfully. Without
fault-execution receipts, this looked like an application false-empty regression.

**How to apply:** Verify the exact target's fault executed and its returned status.
For deterministic component failure tests, explicitly bypass the worker only for
that test and restore it afterward. This is not service-worker acceptance; test the
worker path separately when that behavior is required.
