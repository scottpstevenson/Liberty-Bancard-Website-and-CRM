# Publication and verdicts

Nothing in Stage 4D was published, released, approved or sent. The changes are in the working tree for the owner's normal Publish. Because Publish deploys from the app's own head, the repairs take effect only after that Publish; no schema change or startup DDL is involved, so rollback is a code rollback only.

| Verdict | Result |
|---|---|
| Implementation | passed (disposable DB, denied providers) |
| Data / counts | unchanged, no claim |
| SFP prep / staging | unchanged; pins draft/paused/unapproved |
| Content / CTA | unchanged except booking-confirmation description |
| Native GHL / calendar | BLOCKED (no authorized protected path) |
| Roles / UI / performance | source-verified only; browser pass open |
| Publication / schema / rollback | no migration; owner SQL repair for `no_show` pending; scanner baselines open |

Projection-authority regression run (uses retryDeferredEnrollments): **fails identically on an untouched export of HEAD `e112d19e`** at GPA-99 ("A booked event after updates owns the one-time booked effect exactly once"; 98 checks pass before it). Pre-existing baseline failure in appointment-event handling, unrelated to Stage 4D changes and not repaired here. The hold-expiry and deferred-enrollment sections of that suite (GPA-1..98) pass with the Stage 4D changes.
