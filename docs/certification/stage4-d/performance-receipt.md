# Stage 4D matched performance

Script: `scripts/test-stage4d-calendar-performance.ts` (explicit disposable opt-in). Raw receipt: `performance-receipt.json`.

## What was measured

| Item | Value |
|---|---|
| Surface | Calendar, `/dashboard/tasks-appointments?tab=calendar` |
| Baseline | the pre-Stage-4D client (git `e112d19e`), built into `generated-artifacts/s4d-baseline-client` |
| Candidate | the current build in `dist/public` (the receipt records the candidate identity) |
| Conditions | same disposable API, database, machine and session; only client assets vary; cold navigation, HTTP cache disabled; service worker bypassed; 7 samples per build per width after one warm-up |
| Fixture volume | 321 production contacts, 4 injected provider-read events |
| Readiness | shell-ready (page landmark present) and data-ready (no loading indicator for two consecutive 25 ms polls). A 15 s timeout fails the run; it is never recorded as a sample. Timed value is data-ready, median of 7. |
| Bound | candidate median <= baseline median x 1.25 + 150 ms |

## Result (disposable fixture, not production)

| Width | Baseline median (data-ready) | Candidate median (data-ready) | Delta | Within bound |
|---|---|---|---|---|
| 1280 | 344 ms | 361 ms | +17 ms | yes |
| 390 | 305 ms | 310 ms | +5 ms | yes |

JavaScript transferred on the Calendar route: 788,495 bytes baseline, 804,753 bytes candidate (+16,258).

## What this does not show

- **Production performance was not measured.** The agent cannot authenticate to the production app. Any production timing (for example the reviewer's observation that Program Health once showed a skeleton before loading) is the reviewer's and is a different population, network and data volume.
- Campaigns and Program Health were **not** measured: their data sources are not registered in the isolated fixture, so the numbers would be meaningless.
- The create console was not timed because the baseline build has no such console.
- The fixture is small (321 contacts, 4 events). It says nothing about large-volume behaviour.
