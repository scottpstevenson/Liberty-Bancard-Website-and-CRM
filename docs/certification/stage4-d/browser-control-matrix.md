# Browser control matrix

Updated 2026-11-03. All runs are real-browser runs on a disposable database with the compiled client and real sessions; provider reads are injected fixtures. They are not published-candidate or production acceptance.

| Control | Test id | Verified by |
|---|---|---|
| New provider appointment button / create console (purpose, IANA zone, disabled preview, no apply before preview, touch targets, fit, no sideways scroll) | `button-create-provider-appointment`, `booking-create-panel` | `test-stage4c2-workspace-browser.ts`, 187 checks pass, 1280/768/390 x light/dark |
| R2 zoned time in the console: skipped hour refused with an explanation, repeated hour needs a chosen occurrence, reviewed UTC instant sent | `booking-create-time-error`, `booking-create-occurrence-select` | same run (2027-03-14 02:30 and 2026-11-01 01:30, America/New_York) |
| Filled create journey: preview shows the reviewed UTC, execute refused at the transport gate when outgoing GHL is unselected, no provider write, nothing left pending after reload | `booking-create-outcome-refused` | same run. The confirmed-write path is certified at the command-writer level, not in the browser. |
| Add local event (separate label) | `button-add-event` | same run |
| Roles: manager and agent sessions on the Calendar | existing role matrix in the suite | same run |
| Stage 4B surfaces: cold-lead page, backlog page, Provider Results (admin) | see suite | `test-stage4b-workspace-browser.ts`, 27 checks, admin at 1280 and 390 only (no 768, no dark, no other roles in this suite) |
| Stage 4C1 surfaces: Sequences/Campaigns "Message as sent" previews, stored-template draft editor, current-SFP package editor (preview only) | see suite | `test-stage4c1-browser.ts`, 41 checks, 1280/768/390 and a seven-role matrix with direct API refusals |
| Campaign ownership filter and catalog badges | `campaign-ownership-filter`, `badge-catalog-class-<id>` | **Not browser-verified**; built and syntax-checked only |
| Held enrollment expiry note on Program Health | `text-held-enrollment-expiry` | **Not browser-verified**; source/certification only. Program Health once showed a skeleton-only state before loading; this was a slow first read, not a persistent outage. |

Not covered by any browser run: 503 and loading states on the Campaigns/Program Health surfaces beyond what the suites above assert, and production pages.
