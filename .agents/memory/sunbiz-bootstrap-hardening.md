---
name: Sunbiz bootstrap engine hardening
description: How the guarded Sunbiz-to-canonical-business writer interlocks with a legacy promotion path and applies identity-match gating.
---

This codebase had (has) more than one writer capable of turning a Sunbiz filing into CRM/canonical data: a guarded claim-based engine and a legacy direct-promotion path (including a separate admin-triggered canary entry point) that both act on `sunbiz_entities`. A batch-level pre-filter (excluding filings already claimed elsewhere) is not sufficient to prevent both paths from acting on the same filing — it is not atomic with the write. The real fix is a fencing claim taken immediately before *every* write in every writer — including a "link prospect to an already-existing contact" write, not just new-record creation — using the exact lease-token compare-and-swap pattern (claim, capture its token, re-lock+verify the token before any terminal status update) so a reclaim by another writer can never be silently overwritten.

**Why:** a pre-loop SELECT-time filter and the actual write can be arbitrarily far apart in a long-running batch; another writer can act on the same row in between (TOCTOU). A claim taken but finalized with a plain filing_number-keyed UPDATE (no token check) is still vulnerable to a second writer reclaiming the row mid-processing and having its result silently clobbered. Every entry point that performs a write — including one-off/admin-triggered canary or backfill entry points, and every branch of that entry point (existing-match link, not just new-record creation) — needs the same interlock and the same token-fenced finalize.

**How to apply:** when two independent processes can both materialize the same external record into an internal entity, (1) acquire the shared claim/lock at the actual write boundary of every writer and every branch of every writer, before any write in that branch, and (2) finalize every terminal status update by re-verifying the exact lease token the claim call returned, not just the row's identity.

Weak-identity matching (domain-only or phone-only, or even both together) must not auto-link to an existing record when a corroborating signal (name or location) is absent or conflicting — and a *coincidental* secondary match (e.g. same city/state) must not override an outright conflicting name. Route ambiguous cases to manual review instead of guessing.

**Why:** shared registered-agent phone numbers, franchise/shared domains, and same-city coincidences are common in large public-record corpora (e.g. Sunbiz); auto-linking on a single weak signal risks attaching one business's data to an unrelated one.

**How to apply:** require a real corroborating identity signal for every match regardless of how many weak signals resolved it, and treat a clearly conflicting name as disqualifying even when a secondary signal (city/state) matches.

Generic legal-form/entity-type tokens ("llc", "inc", "corp", "co", "group", etc.) must be stripped before comparing business-name token overlap for identity corroboration. Two entirely unrelated "... LLC" businesses trivially share that token, which can otherwise satisfy an overlap-ratio or substring check and defeat a conflicting-name safeguard entirely.

**Why:** these tokens appear on a huge fraction of filings in a corpus like Sunbiz and carry no distinguishing signal; leaving them in the token set understates how different two names really are.

**How to apply:** build a stopword set of legal-form/entity-type words and filter it out of both sides before any name-similarity or name-conflict comparison used for identity gating.
