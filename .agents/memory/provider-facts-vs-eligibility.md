---
name: Provider facts versus eligibility
description: Transaction boundaries for provider authorization, immutable usage evidence, and mutable lead eligibility.
---

Use three distinct boundaries: a short serialized dispatch authorization, network I/O without database locks, and immutable response/accounting persistence followed by separately authorized promotion.

**Why:** Holding source locks across provider I/O caused dispatch lock timeouts. Simply splitting that transaction introduced a check-release race; requiring current execution authority to save the eventual response also discarded known usage after cancellation or ownership transfer.

**How to apply:** Retain current source and policy pins through the governed dispatch marker. After I/O, preserve attributable response and exact usage under the original dispatch proof even when current authority has changed, without granting new I/O or promotion. Recheck current authority, source, restrictive facts, and original receipt expiry at the promotion boundary.

Eligibility freshness must start from the original immutable observation, not the later projection time. A completed validation item must not permanently prevent safe re-evaluation of malformed, otherwise identical eligibility.

**Why:** Legacy eligibility expiry exceeded its genuine receipt TTL by only seconds; the exact staging fence correctly rejected it despite an apparently healthy eligibility status. Network-only fixtures missed the cached-receipt recovery path.

**How to apply:** Certify aged receipt projections and cached receipt reuse through staging, verified linking, and paused enrollment. Preserve the entire original receipt and prove recovery adds no provider call; never relax the commit fence to accommodate projection drift.

All participants must follow one compatible lock order. Existing-row locks do not protect absent restrictive facts or missing unique keys; the corresponding writers need a shared serialization mechanism. Read the real clock after waits and preserve any earlier explicit receipt expiry.

Once eligibility is staged, preserve its accepted source/address/receipt pins instead of projecting a later candidate onto the same business row.

**Why:** Bridging can create a canonical contact that subsequently appears as a new validation candidate for the already-staged business. Replacing the business-level projection detaches the existing intent and verified link from their original proof even if every provider receipt remains immutable.

**How to apply:** Filter staged businesses during selection and fence every final projection write, including negative/pre-provider outcomes and policy-version changes. Address refresh needs a separately versioned review path, not an in-place replacement of staged evidence.

Take the strongest required business-sentinel mode initially; if any write requires an exclusive sentinel, do not upgrade from shared after acquiring address locks.

**Why:** Dispatch evidence readers do not all participate in the global eligibility fence. A reader can retain a shared business sentinel while waiting on a writer's address, making a late exclusive upgrade circular even when eligibility writers are serialized.

**How to apply:** Review implicit trigger lock requests as well as explicit SQL. Check both read-only provider authorization and final projection paths when changing the ordering.

Historical staged-proof restoration is not approval of a new candidate. Require
the original immutable role-address/link/receipt evidence and current safety
gates; leave invalid, unsafe, no-MX, suppressed, or independently reviewed rows
held rather than treating every mismatch as repairable.

**Why:** A detached projection can contain a genuine later negative validation
for a different candidate. Restoring historical pins must not silently override
that restrictive state or fabricate provider facts.

**How to apply:** Use explicit bounded selection and lossless preview CAS, keep
the audit in the repair transaction, never extend original expiry, and check
all selected receipts against one final database-clock observation after waits.

Certify asynchronous provider retrieval against the real database schema, not
only synchronous fake-provider success paths.

**Why:** A production pending-result retrieval failed on a nonexistent column
even though the synchronous integrated pipeline certification passed. The
transport fixture had never exercised the durable retrieval query.

**How to apply:** Include pending, terminal, and expired retrieval cases using
isolated real tables. Verify original submission accounting and ownership pins
survive retrieval; never repair the failure by inventing usage or replaying spend.