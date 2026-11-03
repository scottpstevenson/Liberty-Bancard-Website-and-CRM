# Integrated journey matrix (spec section 21)

Honest status of each scenario. "Certified" means a test capable of failing ran green this pass; "partial" and "open" are not passes.

| Scenario | Status | Evidence / gap |
|---|---|---|
| Five verticals x three counties | Certified for classification, geography, package plan, selector (516 rows) | `test-stage4d-vertical-county-matrix.ts`. Not covered: per-cell ineligible reasons that need database predicates (DBPR, QA/test/archive, directory/person domain, affiliation, shared address). |
| Bad source / identity | Partial | Geography/out-of-territory/unresolved certified in the matrix. DBPR/QA/archive/directory/affiliation exclusions were not re-run as one journey; they have their own earlier certifications that were not in this roster. **Open.** |
| Supply progression | Certified by existing suites | `stage4b-supply-throughput`, `stage4b-staging-worker` passed. No new multi-window restart journey was written. |
| Package publication | Certified by existing suites | `stage4c1-package-publication`, `stage4c1-generic-route-fence`, `stage4c1-stored-copy-adoption`, `stage4c1-premium-drafts` passed. Five-touch drafts were verified, not adopted or approved. |
| Final content | Certified by existing suites | `sfp-launch-content` (632), `stage4c1-asset-preview`, `stage4c1-cta-contract`. Real transport payload in `sfp-launch-lifecycle-e2e` (fake SMTP). |
| Cold-email infrastructure | Partial | Fake-SMTP lifecycle and seed certification passed (84). Actual production sender/mailbox/bounce intake was not exercised and cannot be without a send. |
| Genuine reply / STOP / bounce | Partial | `ghl-webhooks` passed (STOP/DND/unsubscribe); D02 alias convergence and atomicity certified. Specialized-only versus generic-only signed HTTP fixtures through both aliases were **not** written as HTTP tests. |
| Recipient retry race | Certified | `sms-recipient-authority` (42), D05 identity cases in the Stage 4D certification. |
| Appointments | Partial | `appointment-statement` and `stage4c2-journey-authority` (71) passed. `ghl-projection-authority` GPA-99 (booked-event one-time effect) fails on an untouched export as well. **Known baseline failure, not repaired.** |
| Create / change command | Certified for roles and authority | Role-guard smoke: merchant/agent/manager/admin/anonymous, raw provider id injection, unmapped and nonexistent contact, writer disabled, no receipt written by a denied request, status read guards. Partner role not exercised on these routes. Stale version, wrong readback and reload recovery: `stage4c2-calendar-contract` (67) and completion pass (65). |
| Held work | Certified | D04 sweep (concurrent, exactly once), D03, D06 in the Stage 4D certification; `stage4c2-completion-pass`. |
| Browser / operator | Certified for the Calendar console | 173 checks at 1280/768/390 x light/dark on a disposable database. The Campaigns ownership filter and the Program Health held-expiry note were **not** browser-verified. |
| Native effect | **BLOCKED** | No authorized protected path (see owner-and-native-matrix.md). Not passed by a fake provider. |
