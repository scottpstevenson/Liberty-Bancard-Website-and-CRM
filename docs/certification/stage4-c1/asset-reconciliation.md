# Stage 4C1 production reconciliation

Read-only production snapshot taken 2026-11-01T20:40:57.923Z (served build `6777641f`), reconciled with the Appendix A register by
`scripts/generate-stage4c1-production-reconciliation.ts`. The snapshot stores hashes, lengths, link and token lists only. Nothing was
changed in production, and no asset is deleted, retired, activated or renamed by this register.

| | Appendix A | Production now |
| --- | ---: | ---: |
| Campaigns | 23 | 20 |
| Campaign steps | 80 | 79 |
| Sequences | 127 | 127 |
| Sequence steps | 517 | 517 |
| Stored templates | 8 | 8 |
| Workflows | 17 | 17 |

## Identity reconciliation

- Matched by id and name: 172
- Same id, different name: 0
- In production, not in Appendix A: 0
- In Appendix A, not in production now: 3
  - campaign 79: mismatch-gate-test-73d6d08a
  - campaign 77: mismatch-gate-test-7e85fb30
  - campaign 69: Preview-Test-concurrent-1783799218733

This register records that these rows are absent. It does not explain why; the cause was not investigated here.

## Link census (all message steps)

| Kind | Links |
| --- | ---: |
| booking | 6 |
| ghl_widget | 251 |
| retired_first_party | 16 |
| secure_upload | 6 |
| site_other | 45 |

## Open findings in installed wording

- Retired first-party link present: sequence 36, sequence 85, sequence 86, sequence 91, sequence 93, sequence 94, workflow 7, workflow 11, workflow 12, workflow 13
- GoHighLevel booking-widget link present (not the first-party /book address): sequence 4, sequence 5, sequence 6, sequence 7, sequence 8, sequence 9, sequence 10, sequence 11, sequence 12, sequence 13, sequence 14, sequence 15, sequence 16, sequence 17, sequence 18, sequence 19, sequence 20, sequence 21, sequence 22, sequence 23, sequence 24, sequence 25, sequence 30, sequence 33, sequence 36, sequence 37, sequence 38, sequence 39, sequence 40, sequence 41, sequence 42, sequence 43, sequence 44, sequence 45, sequence 46, sequence 47, sequence 48, sequence 49, sequence 50, sequence 51, sequence 52, sequence 53, sequence 54, sequence 55, sequence 56, sequence 57, sequence 58, sequence 59, sequence 60, sequence 61, sequence 62, sequence 63, sequence 64, sequence 65, sequence 66, sequence 67, sequence 68, sequence 69, sequence 70, sequence 71, sequence 72, sequence 73, sequence 74, sequence 75, sequence 76, sequence 77, sequence 78, sequence 79, sequence 80, sequence 81, sequence 82, sequence 84, sequence 87, sequence 89, sequence 90, sequence 1150, sequence 1151, sequence 1152
- `{{estimatedSavings}}` still used: sequence 36, sequence 84

Installed rows only change through the guarded owners (versioned template/workflow convergence, plan-hash-bound sequence adoption,
package publication). Any row listed above that the adoption plan does not cover is a decision for the owner, not an automatic edit.
