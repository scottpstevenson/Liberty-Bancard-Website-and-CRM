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
