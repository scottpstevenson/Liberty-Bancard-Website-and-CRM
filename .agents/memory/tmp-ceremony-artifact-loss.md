---
name: /tmp ceremony artifact loss
description: Ephemeral signing keys and pre-signed approval artifacts staged in /tmp for a multi-step production ceremony (e.g. CRO-03D) can be silently wiped between sessions/restarts, destroying already-completed stakeholder sign-off work with no recovery path.
---

/tmp is not durable across container restarts. Mid-ceremony artifacts (ephemeral signing keypair, pre-signed JSON approval payloads from operator/data/finance/legal) written only to /tmp were lost this way, forcing the entire signature-collection process to restart from zero — confirmed lost by re-querying the target DB tables (e.g. cro03c_approval_receipts) and finding zero rows, i.e. nothing had actually been imported yet either.

**Why:** A workspace/container restart (can be triggered by unrelated troubleshooting, e.g. secret changes forcing a workflow restart) clears /tmp. Any multi-step ceremony that pauses between steps (waiting on human signers) is at risk if its intermediate state lives only there.

**How to apply:** Before relying on /tmp artifacts across more than one turn/session boundary in a long-running ceremony or approval workflow, either (a) persist them to durable storage (DB staging table, object storage) instead, or (b) explicitly warn the user this session's /tmp state is fragile and get pre-signed artifacts imported into their durable destination table as soon as they're available rather than batching multiple signers before import. Always re-verify by querying the actual durable destination table before assuming prior-session ceremony progress still exists — don't trust conversation history/memory summaries alone.
