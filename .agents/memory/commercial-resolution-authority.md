---
name: Commercial resolution authority
description: Durable authority, graph-lock, and cutover boundaries for commercial classification resolution.
---

Commercial class remains exactly `production | test | demo | synthetic | unknown`. Provenance, identity, organization-link, relationship, readiness, and quarantine reasons are independent axes. Commercial resolution uses typed dependency revisions and deterministic fingerprints, while its shadow decision is observational only; legacy remains the effective decision until a separately approved purpose-specific cutover.

**Why:** Mixing readiness or relationship state into class creates unsafe promotions and denials, while switching all consumers at once would bypass the discrepancy, coverage, and rollback controls needed for a safe migration.

**How to apply:** New commercial consumers must use the shared dual-read adapter and preserve legacy-effective behavior in shadow mode. Future enforcement requires matching policy/schema versions, frozen coverage, an approved discrepancy threshold, a rollback marker, and separate owner approval for each purpose.

All commercial graph readers and trigger-backed writers must use one transaction-level advisory protocol before revision or domain-row locks: typed nodes first, then edge-membership sentinels, then revision/domain rows. Revision triggers maintain counters only and must never discover advisory locks after a row is already held.

**Why:** Mixing advisory hash namespaces or taking contact/business rows before graph revisions permits resolver-versus-link, identity, redirect, or classification deadlocks.

**How to apply:** Any new class, identity, redirect, mapping, business-link, or reviewed-relationship writer must join the shared lock helper and add a controlled concurrent resolver test.

Different actor strings do not prove independent approval. Automated initial
classification must use an explicit, narrowly evidence-checked authority policy
and truthfully attribute a policy decision, without inventing a human or system
reviewer.

**Why:** A bootstrap can satisfy a two-actor string check while persisting an
approval that never happened. Verified source lineage proves evidence, not a
reviewer's authorization.

**How to apply:** Keep human-review paths unchanged; verify automated-policy
eligibility under the same locks/transaction as its projection and receipt.
Test that service labels and policy metadata cannot select that policy through
the public human-review API.