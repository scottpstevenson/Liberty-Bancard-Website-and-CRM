# Stage 4C2 — appointment and follow-up authority: owner map, census, dispositions (2026-11-02)

Source specification: `attached_assets/Liberty-Stage4C2-Master-Preflight-and-Build-2026-11-02_1793632069713.md`.
Nothing here is a GO label. No native workflow was activated, no message was sent, no booking was made, no production write was performed.

**Correction pass (2026-11-02, same task):** `attached_assets/Liberty-Stage4C2-Post-Publication-Audit-and-Corrections-2026-11_1793661458781.md` was audited against fresh main and the serving source. Serving build SHA `bb107f91` = `c8a846b7` (the GitHub main the audit fetched) + the GHL sync exact-lookup commit; `5a25ed17` is the publish commit with an identical tree. Findings P01–P08 and E01 were fixed in source as one bounded pass (sections "Correction pass dispositions" and "Correction pass verification" below). The earlier "Verification run", census and R01–R07 text is kept as history; where a later section contradicts it, the later section governs.

## Owner map (one owner per effect)

| Effect | Owner (code) | Duplicate cadence risk removed |
| --- | --- | --- |
| Current appointment per contact + calendar purpose | `sdr/scheduling.ts` handlers + `ghl-appointment-events.ts` (derived from recorded state; lock order contact+purpose → appointment → merchant) | webhook arrival order no longer decides the current meeting |
| Occurrence identity for handoffs | `ghl-occurrence.ts` `occurrenceKeyOf` (same helper dispatches, defers, recovers, cancels) | cancel finds exactly the obligation the booking created |
| Calendar purpose | `ghl-calendar-purpose.ts` (account only from `AM_CALENDAR_URL`; no first-calendar fallback) | account meeting can no longer move a sales lead |
| Native workflow handoff | `ghl-workflow-enrollment.ts` (`workflow_not_configured` → held + audit) ; `ghl-workflows.ts` `workflowTriggerRefusal` | provider `succeded:false` is a refusal, not enrollment |
| Workflow run execution | `workflow-executor.ts` (occurrence-keyed run, input pin, per-step receipts) + `workflow-run-lease.ts` (SQL lease claim) | duplicate triggers return the existing run; two workers cannot own one due run |
| Delivery receipts for statement, proposal, application reminders, workflow steps, booking commands | `followup-effects.ts` / table `followup_effect_receipts` (written before I/O) | audit-count heuristics replaced by receipts |
| Application reminder milestones | `sla-worker.ts` (`nextApplicationReminderDay`, paged by id, consumed only when delivered) | no first-500 scan; paused/failed no longer consumes a milestone |
| Statement request / reminder | `sdr/statement-flow.ts` (intent separate from delivery, per-channel receipt, retry on non-delivery) | |
| Inbound GHL identity | `ghl-inbound-identity.ts` (exact contact; deal by opportunity or single open deal) | no limit-500 lookup; ambiguous/archived are audited and stop |
| Month calendar read | `appointment-range.ts` + `GET /api/appointments/range` (exclusive end, purpose calendar, 503 unavailable) | `/api/appointments` stays the bounded queue |
| Provider booking write | `ghl-booking-command.ts` + preview/execute routes (execute admin-only, default-denied behind `ghl_booking_writer_enabled`) | `toNotify` explicit, no slot-validation bypass |

## Census (read-only production SQL, before work)
`ghl_appointment_state`, `ghl_workflow_handoff_dispatches`, `ghl_provider_event_receipts`, `ghl_webhook_effect_steps`: 0 rows each. Legacy `workflow_runs`: 455, of which 41 "completed" with failed/`queued_no_ghl` steps; these are never rewritten. The Workflows screen first labelled them "completed · N steps not delivered"; the label is now "completed · N step(s) with unresolved or failed outcome" because an unresolved step is not the same as an undelivered one.

## Migration
`migrations/0379_stage4c2_correction_pass.sql` (journal idx 382; additive and idempotent: `workflow_runs.input_context jsonb`, `followup_effect_receipts.request_fingerprint text`, `followup_effect_receipts.attempt_count integer NOT NULL DEFAULT 1`). Migration head before this pass was 0378. Applied cleanly and re-applied idempotently on the disposable database (CP-01…CP-04). Not applied to production; it applies through the normal migration path on publish.

`migrations/0378_stage4c2_appointment_followup_authority.sql` (additive: `no_show` CHECK, open-appointment index, `workflow_runs` occurrence/pin/lease columns, partial unique index, `followup_effect_receipts`). 0374–0377 untouched. Applied and exercised on the disposable database by the two new suites.

## C2-R01 … R07 disposition

| Item | Disposition | Evidence / blocker |
| --- | --- | --- |
| R01 appointment identity and obligations | **Fixed** (pure derivation proven; handler concurrency not re-run as a multi-connection interleaving suite) | journey-authority JA-12…JA-18 incl. negative controls; handlers in `sdr/scheduling.ts` |
| R02 calendar purpose and booking commands | **Fixed** for resolver, templates, range reader, preview/execute/readback contract. **Native-only/owner:** a live provider create/reschedule/cancel and its notification behaviour were not exercised (writer is default-denied; owner must set `ghl_booking_writer_enabled` and approve GHL write scope) | calendar-contract CC-01…CC-45 |
| R03 durable workflow and follow-up effects | **Fixed** (receipts, occurrence runs, lease, pin, honest outcomes, reminders, statement, proposal) | JA-01…JA-11, JA-23…JA-49; `scripts/test-appointment-statement.ts` 7/7 on disposable DB |
| R04 canonical incoming events / route authority | **Fixed** for exact contact/deal lookup and booking-link authorization. **Narrowed:** other `limit: 500` sites remain in note/task handlers (`ghl.ts` ~2584) and were not in the delivery/inbound branches | JA-37…JA-40, JA-43 |
| R05 native workflow contracts | **Fixed** for typed refusal and held-not-skipped. **Native-only/owner:** installing and proving the reviewed native workflows (4D manifest below) | JA-18, JA-44 |
| R06 SMS and purpose readiness | *History (superseded by the correction pass: SMS recipient authority and toolkit forged-purpose refusal were delivered; see P07).* **Narrowed, not fixed at the time:** statement/workflow sends keep the existing consent gates and now use per-channel receipts, but purpose/recipient propagation through every SMS path was not re-audited in this task | no new SMS evidence |
| R07 operator UI, guidance and certification | **Fixed (disposable-database browser proof; not production acceptance):** stale native-workflow guidance corrected; Calendar uses the range reader, names its timezone, labels local events, and has a sales/account/local source filter (an unconfigured account calendar is shown as not configured, never as an empty month) and an appointment detail drawer (current occurrence, last observation, pending/accepted/unknown command state from recorded state only, via `GET /api/appointments/:appointmentId/detail`); the Add-event contact picker is the scoped, paged `AuthorizedContactPicker` (limit 25, never the first 250) and list names come from bounded per-contact reads; Workflows run history is server-paged and searchable (`GET /api/workflow-runs?limit&offset&search&status`, legacy array kept for Automation); booking-command receipt channel now carries the appointment id (`calendar_<op>:<id>`) so commands link to their appointment. Registered suite `scripts/test-stage4c2-workspace-browser.ts` (98 checks: 1280/768/390 × light/dark, negative controls for failed reads, unconfigured calendar, out-of-scope agent 404, search no-match). **Limits:** the provider appointment read is an injected fixture and commands use a fake provider; no live provider appointment or booking command was exercised; a create command links to its appointment only after it is accepted | CC-41…CC-44 (static), `test-stage4c2-workspace-browser.ts` (browser) |

## Verification run
- Disposable-DB suites: `test-stage4c2-journey-authority.ts` (71 checks), `test-stage4c2-calendar-contract.ts` (58 checks), `test-appointment-statement.ts` (7), all passed; evidence JSON beside this file.
- `scripts/test-ghl-ownership-readiness.ts` (73) passed after the scanner learned `enrollStep(...)` callers.
- `npm run build` passed (existing `import.meta` warning in `email-pre-filter.ts` unchanged).
- Review repairs proven on the disposable database: showing appointment A while B is open keeps the lead in its meeting stage with B current and starts no statement request (handler-level); the webhook calendar allowlist now includes the validated account calendar (gate-level, same function the route uses; no HTTP-level route test); booking reschedule/cancel require the reviewed provider version (refused with no write when stale, on another calendar, or missing) and are confirmed only by a readback matching the requested times or cancelled status.
- Controlled retry (completed steps skipped, unknown outcomes parked) and parked-run behaviour are proven on the disposable database; a real delivery after unpausing was not exercised because provider traffic is denied in certification.
- *History, superseded:* the first pass listed "Not run: full pre-deploy roster, queue/compliance base-vs-candidate scans, browser matrix, multi-connection interleaving of the appointment handlers." The browser matrix has since run (107 checks, see below). The full pre-deploy roster, queue/compliance base-vs-candidate scans and a multi-connection interleaving suite for the appointment handlers were **still not run** and remain open.

## Correction pass dispositions (P01–P08, E01)

| Item | Disposition | Receipt |
| --- | --- | --- |
| P01 appointment handler defects | **Fixed** (handler fixes in `sdr/scheduling.ts` / `ghl-appointment-events.ts`; cancel-versus-no-show ordering and identity conflicts refuse rather than guess) | journey-authority 71 checks (pass on final tree); a dedicated multi-connection interleaving suite was **not** written (narrowed) |
| P02 executor durability | **Fixed:** due-run lease, fenced saves, local-action receipts (tasks by `commandKey`; notification/audit by `wf_local` receipts), halt after an undelivered required send. **Narrowed:** a very small crash window remains between a local-action effect and its receipt | journey-authority, sms-recipient-authority (the two SMS steps now run as two workflows because the first failed send halts the run) |
| P03 follow-ups | **Fixed:** one statement-request owner per call (SDR lead present ⇒ SDR flow owns, CRM lifecycle transition skipped; decision audited as `statement_request_owner_selected`, key `statementOwner`), proposal touch identity (deal + token hash + touch; unknown outcome blocks the next touch), reminder occurrence/milestone identity (`application_reminder_day{n}_accepted`), settlement retry. **Narrowed:** the proposal-tracking SDR resend path is not unified with the worker path; deals with no authoritative onboarding-entry audit row get no reminder (logged) | `test-appointment-statement.ts` (2 = CRM-owned, 2b = SDR-owned, 3 = opt-out), correction-pass CP-16…CP-20, CP-27…CP-29 |
| P03 regression found and fixed during this pass | `establishStatementRequest` ignored the rep opt-out (`suppressStatementAuto`) and moved the stage anyway; it now refuses opt-outs and post-request stages in the same UPDATE | `test-appointment-statement.ts` test 3, CP-18/CP-19 |
| P04 inbound identity conflict | **Fixed** (conflicting identities refuse and audit; no silent pick). **Narrowed:** receipt-ordering concern documented, not changed | journey-authority |
| P05 booking command | **Fixed:** command id bound to the reviewed request (fingerprint) and version; contact/location/calendar identity refusals; provider contact resolved server-side from the local contact; read-only command status route; calendar DTO. Writer stays default-denied | calendar-contract 67 checks (incl. D3 block), CP-21…CP-23 |
| P06 trigger and held handoff | **Fixed:** strict trigger decoder (only an explicit true is success; `{}`/null/non-boolean = unconfirmed, never re-sent); a held `workflow_not_configured` handoff is a durable required obligation with an expiry no later than the appointment start and a stable identity (one row on repeat) | CP-05…CP-15 |
| P07 SMS | **Fixed:** SMS authority recheck before dispatch; toolkit `/api/sms-inbox/reply` refuses caller-supplied purpose/recipient fields (400) and sends through the canonical SMS path | sms-recipient-authority, CP-30 |
| P08 operator UI | **Fixed (disposable-database browser proof):** agenda at phone width, URL-held Calendar state (`cal_month`, `cal_date`, `cal_source`, `cal_item`; invalid values fall back), date-range deals reader (exclusive end, capped 2000 rows, `dealsPartial` flags partial coverage), 404 on appointment detail shown as "not available to your account" (never "no record"), contact handoff link, admin/manager booking command panel (preview; execute admin-only and server-refused while the writer is disabled), Workflows URL state (`wf_tab`, `wf_q`, `wf_status`, `wf_page`, `wf_run`), keyboard-operable read-only run Details sheet (no retry control), sidebar label "Workflow Automation", `leaseToken`/`inputPin` removed from run-history responses, missing-ID guidance now says held, not skipped | browser suite 107 checks; CP-24…CP-33 |
| E01 browser suite `expectedVersion:null` | **Fixed:** the suite now uses real provider versions with a stateful fake provider; separate checks prove a null version is denied for reschedule and for cancel, and a stale version is refused, each with zero provider writes. Stability fix: wait for the dialog animation before typing in the contact picker | browser suite, final rebuilt tree |
| Browser check of the denied-detail state | **Not done in the browser** (static/contract checks only: calendar-contract panel static checks) | — |

Runner registration: `test-stage4c2-correction-pass.ts` → `CERTIFICATION_FIXTURE_SUITES` (pre-deploy) and the certification runner; `sms-recipient-authority` added to the certification runner list; `test-ghl-sync-exact-lookups.ts` was unregistered and is now in the pre-deploy mandatory roster; `test-appointment-statement.ts` and `test-stage4c2-workspace-browser.ts` were already registered.

## Correction pass verification
- Node v22.23.4. `npm run build` passed on the final tree.
- Disposable-database suites, each passing on the final tree unless stated: journey-authority (71), calendar-contract (67), sms-recipient-authority, correction-pass (36 checks, 4 negative controls), `test-appointment-statement.ts`, `test-ghl-ownership-readiness.ts`, `test-ghl-sync-exact-lookups.ts`, `test-stage4c2-workspace-browser.ts` (107 checks; 1280/768/390 × light/dark, URL state, agenda, booking panel preview, run Details).
- Baseline versus candidate: `test-appointment-statement.ts` failed 2 checks on the first candidate run (tests 2 and 3). Test 3 was a real regression (opt-out ignored) and was fixed in code; test 2 asserted the pre-correction dual-owner behaviour and was replaced by the one-owner tests 2/2b. The first browser candidate run failed once on an animation race in the contact picker (test timing, fixed); no baseline failure was carried forward.
- Not run: full pre-deploy roster, queue/compliance base-vs-candidate scans, a multi-connection interleaving suite for the appointment handlers, dedicated suites for executor crash/lease, settlement failure and held-obligation expiry sweep (covered only by the journey and SMS suites above), 0379 upgrade from a restored production snapshot, full TypeScript (not run by standing instruction; focused editor diagnostics were clean).
- Safety state unchanged: global pause stays paused (epoch 1), outgoing GHL stays owner-paused (epoch 16), incoming as found, no send, no booking write, no provider job, no production backfill, no publish.

## Rollback
Code: revert to the serving build (`bb107f91` / publish commit `5a25ed17`). Migration 0379 is additive: the three columns are nullable or defaulted and unused by the older build, so no down-migration is needed to roll back. Do not drop them after a publish that wrote data. Legacy runs (455) were never rewritten.

## 4D native acceptance manifest (documentation only; nothing installed)
The owner must, in GHL, install and review separately: (1) booking confirmation workflow (slot `booking_confirmation`), (2) 24-hour reminder (own slot; do not duplicate in the confirmation workflow), (3) no-show reschedule (`no_show_reschedule`), (4) post-meeting statement request (`statement_request_after_meeting`). Acceptance per workflow: slot id saved, one test enrollment from a marked test contact, readback of the single message, confirm no duplicate from Replit, then record the proof. Until the slot id is saved the handoff is **held as a durable, expiring obligation** (not skipped, not lost); it is released only by the reviewed path and expires no later than the appointment start.

Additional finite owner decisions for 4D:
1. Approve the cancel disposition: a cancel stops the appointment's obligations; no recovery workflow starts, the outreach pause is unchanged and a rep review is owed.
2. Keep `ghl_booking_writer_enabled` unset until the owner approves GHL write scope; then run one live reschedule or cancel on a marked test contact and record the readback.
3. Confirm calendar-purpose configuration (`AM_CALENDAR_URL`, sales calendar IDs) so the gate-level allowlist is deployment-enforced.

## Publication handoff
Publish is required for any of this to run in production; paid/provider runs execute the published build. Migrations 0378 and 0379 apply through the normal migration path. After publish: verify `followup_effect_receipts` (incl. `request_fingerprint`, `attempt_count`), `workflow_runs.occurrence_key` and `workflow_runs.input_context` exist, keep outbound pause (epoch 1) and outgoing GHL owner-pause (epoch 16) unchanged, and leave `ghl_booking_writer_enabled` unset.


## Completion pass (2026-11-02, source-only; unpublished)
Input: `Liberty-Stage4C2-Merged-Repair-Review-2026-11-02`. Production serves `ce4d7865`; `main` `f8245106` has the same tree; this pass was tested on `8ca031a1` plus the uncommitted working tree.

| Finding | Disposition | Evidence |
|---|---|---|
| RC1A local workflow effects | **Fixed:** row + receipt in one transaction under a share-locked lease check | completion-pass CM-14…CM-22 |
| RC1B fingerprint binding | **Fixed:** inside the atomic claim; exact match, NULL only matches NULL; owner/channel bound | CM-06…CM-13 |
| RC2A generic inbound webhook | **Fixed:** canonical provider message identity, per-effect receipts; no-id deliveries converge on a payload fingerprint with an explicit audit | CM-23…CM-31 |
| RC2B non-durable hold | **Fixed:** fails at the owning step, retryable | CM-32 |
| RC2C recovery | **Fixed:** lock-protected re-read, amend-on-pending, expired hold terminal (`hold_expired`), no provider call | CM-33…CM-39 |
| RC3A per-channel owed state | **Fixed** | CM-40…CM-46 |
| RC3B SDR SMS | **Fixed:** provider-vs-local number and per-attempt recheck; dormant proposal resend retired | CM-47…CM-49 |
| RC4A readback identity | **Fixed:** appointment, calendar, location, contact, time/status | CM-50…CM-56; calendar-contract 67 |
| RC4B saved command | **Fixed** (browser: restore after reload, check saved result, unknown stays saved, unknown-to-server cleared) | browser suite 130 checks |
| RC4C create flow | **Deferred to 4D by explicit decision** (backend tested, no console form) | this section |
| RC4D historical runs | **Fixed** (browser) | browser suite |
| RC5 manifest | **Fixed** (`ci-suite-manifest --check` passes; suite passes on the disposable runner) | |

Browser matrix: 1280/768/390 in light and dark for admin, manager (read-only preview panel, no apply control) and agent (no booking panel; no run history). Baselines (unchanged files, recorded not green): compliance scan 3 failures; queue-compliance 3 coordinator warnings. Not run: full pre-deploy roster, full TypeScript. Rollback: revert the source; migration 0379 is untouched and additive.

**4D remaining:** native workflow install + one test enrollment each; cancel-disposition approval; booking-writer enablement and one canary; calendar-purpose configuration; delivery/readback proof; role and performance acceptance on the served build.

## Stage 4D update (2026-11-03)

Native acceptance remains BLOCKED. The corrected native packet (separate operation allowances, no single generic permit) is in `docs/certification/stage4-d/owner-and-native-matrix.md`. The `no_show` constraint repair packet is in `docs/certification/stage4-d/schema-repair/`. The booking writer row is still absent; note that the writer flag must read back as the string `"true"` through the application (a plain jsonb `"true"` or boolean reads as boolean and stays denied).
