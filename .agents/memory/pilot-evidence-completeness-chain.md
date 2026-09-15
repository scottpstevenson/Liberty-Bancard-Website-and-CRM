---
name: Pilot/run evidence-completeness checks must validate the full downstream write chain
description: Why a terminal state flag on an originating operation is not proof of a durable outcome, and how "which providers are required" should be derived.
---

## The lesson

A completion gate that proves a paid/consequential operation actually
produced its intended effect must walk the **entire** downstream write chain,
not just the upstream terminal-state flag on the operation that kicked it
off:

1. terminal state on the operation itself (e.g. `completed` + a non-null
   disposition — a `completed` state with a null disposition must still count
   as non-terminal, since some code paths flip state without setting
   disposition),
2. a durable settlement/receipt row keyed to that operation (a state flip
   alone is not proof the settlement path ran),
3. if the operation type implies a further resolution step (e.g. a
   validation request), a terminal row in that resolution table — and
   critically, if there are **zero** rows in the intermediate
   linking/checkpoint table for that operation, that must itself count as
   "unresolved," not silently match zero rows and pass. A `FROM checkpoint_table
   LEFT JOIN outcome_table` query that never anchors on the *operation* will
   silently pass whenever the checkpoint itself is missing — anchor `FROM` on
   the operation, not on a table that's supposed to exist but might not,
   and `LEFT JOIN` everything downstream of it,
4. a final durable business-outcome row for whatever the whole run touched
   (e.g. a staging/master-record disposition), proving the spend produced a
   recorded result for the business it enriched.

**Why:** a review found that a Level 2/3 pilot could be marked "completed"
after every relevant stage operation merely reached a terminal `state`
column, without any receipt, resolved validation, or final business outcome
existing — this is a real gap, not a false positive, because each of those
downstream tables is written by a separate worker/service and can fail
independently after the state flip.

## Deriving "which providers/paths are required"

Do not require evidence for every capability a definition/config *allows*.
Derive the required set from what the run **actually exercised** (e.g. via a
`*_effect_links` join to real recorded operations). An allowed-but-unused
capability is legitimate when at least one other allowed capability proves
the phase executed — but if the run recorded **zero** operations for *every*
allowed capability, that must still fail (proves the phase never ran at
all). Otherwise you get an "impossible to complete" bug: a definition that
permissively allows a provider the frozen cohort never needed makes every
correct pilot un-completable.

## Testing this shape of check

If checks are evaluated in a loop over multiple "required" identifiers
pulled from a jsonb column, don't assert on *which* identifier's error
surfaces first in tests that leave multiple identifiers simultaneously
unresolved — jsonb does not preserve object key insertion order in Postgres,
so the iteration order (and thus which one's error fires first) is
nondeterministic. Use a single-required-identifier fixture to test the
step-by-step chain deterministically, and a second, separate fixture with
multiple identifiers (only one of which ran) to test the "no gap" behavior
in isolation.
