---
name: Multi-mailbox restart proof
description: Why shared importer certification must cover both ordinary execution and deferred-item recovery protocols.
---

Certify ordinary upload restart separately from deferred-source recovery,
including both originally created and matched primary contacts.

**Why:** A deferred-item crash test bypassed an ordinary-upload early return.
The first mailbox's immutable row receipt made its row appear accounted even
though other mailboxes were missing; the deferred-only worker could not select
that created/matched row to repair it.

**How to apply:** After splitting one source row into atomic units, crash after
the first real unit commits. Reclaim through the actual ordinary execution
processor and prove completion remains false until all retained units have
stable source evidence. Preserve original accounting and atomic restrictive
consent; do not manufacture a deferred disposition to fit another worker.

An immutable mailbox/source receipt does not certify the mailbox's approved
business affiliation. A shared address on another business must remain a native
affiliation hold, not successful fulfillment or an automatic ownership transfer.

**Why:** Full retained-workload reconciliation found completed rows whose
mailboxes projected a different business; read-only production evidence
confirmed the same defect. Original accounting cannot be rewritten afterward
merely to make the qualification status consistent.

**How to apply:** Reconcile actual mailbox, business and fingerprint-bound
provenance before certifying recovery. Reverify older completion claims when the
qualification contract strengthens, preserve their historical receipts, and
keep the mutable work outcome separate from immutable intake accounting.
