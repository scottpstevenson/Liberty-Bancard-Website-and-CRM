---
name: SFP freezeCohort vertical selection is decoupled from program.verticalIds
description: selectRoiCohort's "in target vertical" eligibility does not gate on program.verticalIds even though that value is passed in; a fixture business given a custom/unique vertical string is never actually eligible for cohort freezing, and freezeCohort silently selects whatever OTHER canonical-vertical business scores highest.
---

`server/services/cro03/south-florida-prospecting.ts` `freezeCohortLocked()` calls
`selectRoiCohort({ verticalIds: program.verticalIds, ... })`, but the actual
"in target vertical" gate inside the ROI selector matches against a fixed set
of real canonical verticals (e.g. "Healthcare", "Med Spa", "Dental" — see
`roi-cohort-selector.ts`'s "five configured canonical verticals" docstring),
not against whatever string is stored in `program.verticalIds`. Setting
`sfp_programs.vertical_ids` to an arbitrary/unique string does NOT make a
business with that vertical eligible, and does NOT exclude businesses with a
real canonical vertical from being selected.

**Why this matters:** a test/fixture that creates a business with a unique
vertical string (to try to force `freezeCohort` to select exactly that
business) will silently get a DIFFERENT business frozen into the cohort
instead — whichever pre-existing canonical-vertical business scores highest.
Any assertion that assumes "the business I just created is the one in the
frozen cohort" will pass or fail based on ROI-scoring order across every
canonical business in the DB, not on the fixture's own setup. This produced a
real, deterministic (not flaky) test failure in a Task #1999 closeout patch:
Apollo evidence was written for the fixture's own businessId, but the frozen
cohort actually contained a different, unrelated businessId, so the
before/after gap snapshots were for different businesses and never changed.

**How to apply:** when writing a cohort-freeze test that needs a specific
business in the frozen cohort, either (a) look up which businessId
`freezeCohort()` actually selected (`frozen` result / `sfp_cohort_members`)
before asserting on it, rather than assuming it matches a just-created
fixture id, or (b) give the fixture business one of the real recognized
canonical verticals and make sure no other eligible business in the disposable
DB would outrank it, or (c) treat `program.verticalIds` as inert for
eligibility purposes and confirm the actual fixed vertical list in
`roi-cohort-selector.ts` before relying on it in a new test.
