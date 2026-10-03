---
name: Shared disposable SFP certification fixtures
description: Why isolated SFP certification suites can fail only when composed in the multi-suite runner
---

The multi-suite SFP certification runner uses one private database across successive suites. Each suite is isolated from real data but **not** from prior suites in the same run. Fixture names and current-version package keys must be run-unique or safely reuse the prior valid row; a later fixture cannot assume migrations left a pristine database.

**Why:** A suite passed alone but failed in the full runner because an earlier suite already created the named program and current v2 package. Other fixtures also assumed legacy v1 vertical/package admission after the production staging gate required frozen v2 evidence.

**How to apply:** Verify the complete runner as well as focused suites after changing SFP certification. Seed genuine frozen classifier evidence/decisions and policy-compatible packages instead of relaxing production gates to make an old fixture pass. Keep all test work on the runner's private disposable database.

For zero-call drain certification, assert the actual decision reason and prove that a later viable address reaches the test transport. Eligibility-row counts and changed snapshots alone are insufficient.

**Why:** An authority-held fixture produced both rows and changed selections, resembling a successful DNS-rejection drain without ever reaching DNS or validation.

**How to apply:** Distinguish completed prechecks from authority refusals explicitly. Keep production fences intact and correct the fixture's evidence instead.