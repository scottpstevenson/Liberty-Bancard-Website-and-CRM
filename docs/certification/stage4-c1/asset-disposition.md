# Stage 4C1 asset disposition

Generated from Appendix A of the Stage 4C1 specification (`scripts/generate-stage4c1-inventory.ts`). The machine-readable
register is `asset-inventory.json`. Appendix A is the October 31 production snapshot recorded in the specification; this
register was **not** re-read from production, and the development database holds different counts (see the preflight report).

No asset is deleted, retired, activated or renamed by this register. A "test-labelled" row is a diagnostic-review item until its
dependencies are traced.

| Disposition | Rows |
| --- | ---: |
| keep_current | 10 |
| reuse_reviewed_library | 96 |
| service_lifecycle | 38 |
| historical_read_only | 10 |
| diagnostic_review | 21 |
| unresolved | 0 |
| **Total** | **175** |

Totals: 23 campaigns (80 steps), 127 sequences (517 steps), 8 stored templates, 17 workflows.

## Rules by class

- **keep_current**: Primary experience. Pins are resolved at runtime from the live package authority; content changes only through a versioned draft and an explicit package publication.
- **reuse_reviewed_library**: Sales/education library candidate. Reuse only after the reviewed draft process; no activation, retirement or deletion by name.
- **service_lifecycle**: Merchant/service lifecycle content. Keep its event, purpose and account-relationship CTA; no cold-sales wording.
- **historical_read_only**: Retired package history. Read-only; not offered for selection, enrollment or edit.
- **diagnostic_review**: Test-labelled. Trace dependencies (enrollments, sends, references) first; nothing is deleted or retired by name.
- **unresolved**: none after this pass.

## Template and workflow classes

| Asset | Class |
| --- | --- |
| Template 1: Proposal Email | reuse_reviewed_library |
| Template 2: Follow-Up SMS | reuse_reviewed_library |
| Template 3: Welcome Onboarding Email | service_lifecycle |
| Template 4: Day 7 Review Request | service_lifecycle |
| Template 5: 30-Day Nurture Email | reuse_reviewed_library |
| Template 6: 90-Day Reactivation Email | reuse_reviewed_library |
| Template 7: Nurture SMS | reuse_reviewed_library |
| Template 8: Support Acknowledgment | service_lifecycle |
| Workflow 17: Inbound: Unsubscribe | service_lifecycle |
| Workflow 16: Inbound: Objection | service_lifecycle |
| Workflow 15: Inbound: Positive Reply | service_lifecycle |
| Workflow 14: Inbound: Booking Intent | service_lifecycle |
| Workflow 13: F4. Application Reminder - Day 7 | service_lifecycle |
| Workflow 12: F3. Application Reminder - Day 3 | service_lifecycle |
| Workflow 11: F2. Application Reminder - Day 1 | service_lifecycle |
| Workflow 10: I. Support SLA Escalation | service_lifecycle |
| Workflow 9: H. Case Study Request | service_lifecycle |
| Workflow 8: G. Go-Live Lifecycle (Day 2/7/14/30) | service_lifecycle |
| Workflow 7: F. Closed Won - Onboarding Kickoff | service_lifecycle |
| Workflow 6: E. Proposal Follow-Up Cadence | reuse_reviewed_library |
| Workflow 5: D. No-Show Rescue | reuse_reviewed_library |
| Workflow 4: C. Appointment Booked | reuse_reviewed_library |
| Workflow 3: B. Estimate Request Intake | reuse_reviewed_library |
| Workflow 2: A. Statement Upload Intake | service_lifecycle |
| Workflow 1: New Lead Follow-up | service_lifecycle |

Template/workflow classes are assigned by purpose in the generator (sales and booking wording reusable after review; event and
account-relationship wording stays with its lifecycle).
