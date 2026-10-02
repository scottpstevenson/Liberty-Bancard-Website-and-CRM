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

Take the strongest required business-sentinel mode initially; if any write requires an exclusive sentinel, do not upgrade from shared after acquiring address locks.

**Why:** Dispatch evidence readers do not all participate in the global eligibility fence. A reader can retain a shared business sentinel while waiting on a writer's address, making a late exclusive upgrade circular even when eligibility writers are serialized.

**How to apply:** Review implicit trigger lock requests as well as explicit SQL. Check both read-only provider authorization and final projection paths when changing the ordering.