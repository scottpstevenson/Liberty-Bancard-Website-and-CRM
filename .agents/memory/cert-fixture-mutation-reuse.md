---
name: Certification fixture reuse after lifecycle mutation
description: Reusing the same seeded business/run/idempotency-key fixture across sequential lifecycle-mutating checks in a certification script causes later checks to observe the mutated state, not the originally-intended one.
---

In disposable-DB certification scripts that walk a state machine (freeze → void →
supersede → mark-as-existing-customer, etc.), a fixture created early (a business
row, a cohort run, an idempotency key) is often reused later in the script to
avoid fixture sprawl. If an earlier check step *mutates* that fixture's state
(voids a run, marks a business as an existing customer via a join table, etc.),
every later check that reads the same fixture id sees the *mutated* state, not
the state the fixture had when it was created — even though the mutating step
and the reading step look unrelated at a glance (different VFC/test IDs, far
apart in the file).

**Why:** exclusion/eligibility pipelines typically check several disjoint
conditions in a fixed priority order (e.g. dbpr → existing_customer →
suppressed → bounced → inactive → geography → vertical). Once a fixture trips
an earlier-priority condition (e.g. an unrelated "make the cohort empty"
fixture step flags it as `existing_customer`), it can never again exercise a
later-priority condition (e.g. `suppressed`) in any run frozen after that
point — the earlier condition wins every time, no code bug required.

**How to apply:** when a later check's actual result doesn't match its
asserted expectation, and the check reuses an id/key created much earlier in
the script, check for any intervening line that mutates *that same fixture*
(state transition, membership in a join/exclusion table, terminal-state flag)
before assuming the application code is wrong. Fix by either (a) pointing the
later check at an *earlier* snapshot/run that predates the mutation, or (b)
minting a fresh, dedicated fixture for the later check. Don't assume a fixture
id is stable in meaning just because its variable name didn't change.
