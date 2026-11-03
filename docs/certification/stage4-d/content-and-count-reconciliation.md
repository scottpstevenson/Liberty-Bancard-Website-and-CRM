# Content and count reconciliation

No content, CTA, package, sequence or count was changed, republished, adopted or approved by Stage 4D. All production figures are read-only replica aggregates. Each number below states unit, predicate, record class, actor, window and as-of; do not compare numbers across populations.

## Counts

Actor: read-only production replica query by the agent. Window: point-in-time snapshot (no time window). Availability: replica reads succeeded; composition figures were not re-derived at the later time.

### Projection (all-class) population, as of 2026-11-03T19:48Z

| Unit | Predicate | Count |
|---|---|---|
| contacts | all rows, every record class | 161,048 |
| contacts | record class `production` | 160,646 |
| contacts | record class `test` | 402 |
| businesses | all rows, every record class | 177,328 |
| businesses | record class `canonical` | 99,982 |
| businesses | record class `production` | 77,309 |
| businesses | record class `unknown` | 37 |

Arithmetic: 161,048 contacts = 160,568 unarchived production + 78 archived production + 402 test.

### Canonical scoped population, as of 2026-11-03T18:36:22Z

| Unit | Predicate | Count | Composition |
|---|---|---|---|
| contacts | record class `production`, not archived | 160,568 | 1,629 valid + 157,488 unvalidated + 1,451 blocked |
| businesses | record class `canonical` | 99,982 | 8,297 mapped + 76,270 unresolved + 15,415 excluded |

The contact predicate is stated as `production` and not archived because that predicate reproduces the 160,568 figure exactly when recounted at 19:48Z; the 18:36Z composition itself was not recounted. `valid` means a provider observation within the 180-day send authority; undated `valid` or `active` is counted as unvalidated.

Why two populations: the 161,048 / 177,328 figures are every row of every class and are what an unscoped projection would show. The 160,568 / 99,982 figures are the canonical, scoped populations used for SFP preparation. They answer different questions.

### Other production facts (as of the 2026-11-03T17:02Z recapture, unchanged at the 19:48Z control check)

- Five current SFP v2 package keys: `sfp.automotive.v2`, `sfp.beauty_spa.v2`, `sfp.construction_trades_home_services.v2`, `sfp.fitness_recreation.v2`, `sfp.healthcare.v2`, each with 3 steps. Their campaigns are `draft`; their sequences are `paused`.
- 31 of 127 sequences are active (17:02Z; not re-queried at 19:48Z).
- 4,267 enrollment rows sit on the five paused package sequences (pre-existing, untouched).
- Controls at 19:48Z: outbound pause paused; booking writer row absent.

## Content: live three-touch versus proposed five-touch

| Aspect | Live (current v2 packages) | Proposed five-touch drafts |
|---|---|---|
| Touches | 3 | 5 |
| Relative delay between touches | 0 / 3 / 5 days | defined in the drafts (not adopted) |
| Cumulative days from start | 0 / 3 / 8 | as drafted (not adopted) |
| Status | live packages, sequences paused | verified by `test-stage4c1-premium-drafts`; not adopted, approved or published |

The earlier wording "days from start 0/3/5" was wrong: 0/3/5 are the relative delays, and the cumulative days are 0/3/8. Adoption stays on the existing paired publication and approval authorities. The only wording change in Stage 4D is the booking-confirmation workflow description (no unowned reminder claim).
