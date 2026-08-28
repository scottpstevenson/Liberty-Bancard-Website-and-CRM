---
name: Sequence dispatch linearization
description: Durable concurrency rules for reply-stop decisions and retry-safe sequence sends.
---

Canonical inbound communication writes and the final sequence-send authorization must acquire the same per-contact transaction advisory lock. Authorization must take its reply snapshot only after acquiring that lock.

**Why:** A negative reply read immediately before provider I/O still races with a concurrent inbound commit unless both operations share a database linearization point.

**How to apply:** Route every inbound communication writer through the locked canonical path. Require final dispatch authorization to verify the active enrollment version and absence of inbound events while holding the same lock.

No-response terminalization must acquire this same lock, take a fresh inbound snapshot after lock acquisition, and commit either `reply` or `no_response` while still holding the lock.

**Why:** An unlocked final read followed by an enrollment update can label a real concurrent reply as no-response.

**How to apply:** Treat sequence terminalization as another communication linearization operation, not as a normal conditional enrollment update.

Human-facing sequence routes may reduce risk by pausing or cancelling authorized enrollments, but must not create cohorts, resume sends, activate sequences, or invoke provider-backed test delivery.

**Why:** Provider-capable “test” and enrollment routes bypass the same launch authority even when campaign queue endpoints are disabled.

**How to apply:** Keep human HTTP controls one-way toward safer states; route launch/enrollment execution through server-owned automation only.

Pre-dispatch claims must use expiring owner tokens. Only an expired `pending` claim may be reclaimed; `dispatching`, `failed`, and terminal claims require reconciliation and must never be resent automatically.

**Why:** A crash before provider I/O is safely retryable, but a timeout or crash after dispatch begins may mean the provider accepted the message. Retrying that state can duplicate delivery.

**How to apply:** Fence authorization with the current claim token, clear the lease when transitioning to dispatch, and treat provider-path failures as ambiguous unless provider evidence proves otherwise.

Paid-provider dispatch follows the same rule: the durable run transition is the irrevocable handoff. Cancellation either wins before that transition or becomes post-dispatch; dispatched runs are never lease-reclaimed, and expiry is reconciled as ambiguous under one accounting lock.

**Why:** A final database check cannot revoke HTTP after it returns, and automatic lease takeover can double-spend while the first request is in flight.

**How to apply:** Serialize normal completion and timeout recovery on the same operation lock, gate side effects on one outstanding-ledger transition, and test both cancellation orderings plus crash-after-dispatch recovery.