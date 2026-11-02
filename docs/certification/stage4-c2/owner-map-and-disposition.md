# Stage 4C2 — appointment and follow-up authority: owner map, census, dispositions (2026-11-02)

Source specification: `attached_assets/Liberty-Stage4C2-Master-Preflight-and-Build-2026-11-02_1793632069713.md`.
Nothing here is a GO label. No native workflow was activated, no message was sent, no booking was made, no production write was performed.

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
`ghl_appointment_state`, `ghl_workflow_handoff_dispatches`, `ghl_provider_event_receipts`, `ghl_webhook_effect_steps`: 0 rows each. Legacy `workflow_runs`: 455, of which 41 "completed" with failed/`queued_no_ghl` steps; these are never rewritten and the Workflows screen now labels them "completed · N steps not delivered".

## Migration
`migrations/0378_stage4c2_appointment_followup_authority.sql` (additive: `no_show` CHECK, open-appointment index, `workflow_runs` occurrence/pin/lease columns, partial unique index, `followup_effect_receipts`). 0374–0377 untouched. Applied and exercised on the disposable database by the two new suites.

## C2-R01 … R07 disposition

| Item | Disposition | Evidence / blocker |
| --- | --- | --- |
| R01 appointment identity and obligations | **Fixed** (pure derivation proven; handler concurrency not re-run as a multi-connection interleaving suite) | journey-authority JA-12…JA-18 incl. negative controls; handlers in `sdr/scheduling.ts` |
| R02 calendar purpose and booking commands | **Fixed** for resolver, templates, range reader, preview/execute/readback contract. **Native-only/owner:** a live provider create/reschedule/cancel and its notification behaviour were not exercised (writer is default-denied; owner must set `ghl_booking_writer_enabled` and approve GHL write scope) | calendar-contract CC-01…CC-45 |
| R03 durable workflow and follow-up effects | **Fixed** (receipts, occurrence runs, lease, pin, honest outcomes, reminders, statement, proposal) | JA-01…JA-11, JA-23…JA-49; `scripts/test-appointment-statement.ts` 7/7 on disposable DB |
| R04 canonical incoming events / route authority | **Fixed** for exact contact/deal lookup and booking-link authorization. **Narrowed:** other `limit: 500` sites remain in note/task handlers (`ghl.ts` ~2584) and were not in the delivery/inbound branches | JA-37…JA-40, JA-43 |
| R05 native workflow contracts | **Fixed** for typed refusal and held-not-skipped. **Native-only/owner:** installing and proving the reviewed native workflows (4D manifest below) | JA-18, JA-44 |
| R06 SMS and purpose readiness | **Narrowed, not fixed:** statement/workflow sends keep the existing consent gates and now use per-channel receipts, but purpose/recipient propagation through every SMS path was not re-audited in this task | no new SMS evidence |
| R07 operator UI, guidance and certification | **Fixed (disposable-database browser proof; not production acceptance):** stale native-workflow guidance corrected; Calendar uses the range reader, names its timezone, labels local events, and has a sales/account/local source filter (an unconfigured account calendar is shown as not configured, never as an empty month) and an appointment detail drawer (current occurrence, last observation, pending/accepted/unknown command state from recorded state only, via `GET /api/appointments/:appointmentId/detail`); the Add-event contact picker is the scoped, paged `AuthorizedContactPicker` (limit 25, never the first 250) and list names come from bounded per-contact reads; Workflows run history is server-paged and searchable (`GET /api/workflow-runs?limit&offset&search&status`, legacy array kept for Automation); booking-command receipt channel now carries the appointment id (`calendar_<op>:<id>`) so commands link to their appointment. Registered suite `scripts/test-stage4c2-workspace-browser.ts` (98 checks: 1280/768/390 × light/dark, negative controls for failed reads, unconfigured calendar, out-of-scope agent 404, search no-match). **Limits:** the provider appointment read is an injected fixture and commands use a fake provider; no live provider appointment or booking command was exercised; a create command links to its appointment only after it is accepted | CC-41…CC-44 (static), `test-stage4c2-workspace-browser.ts` (browser) |

## Verification run
- Disposable-DB suites: `test-stage4c2-journey-authority.ts` (71 checks), `test-stage4c2-calendar-contract.ts` (58 checks), `test-appointment-statement.ts` (7), all passed; evidence JSON beside this file.
- `scripts/test-ghl-ownership-readiness.ts` (73) passed after the scanner learned `enrollStep(...)` callers.
- `npm run build` passed (existing `import.meta` warning in `email-pre-filter.ts` unchanged).
- Review repairs proven on the disposable database: showing appointment A while B is open keeps the lead in its meeting stage with B current and starts no statement request (handler-level); the webhook calendar allowlist now includes the validated account calendar (gate-level, same function the route uses; no HTTP-level route test); booking reschedule/cancel require the reviewed provider version (refused with no write when stale, on another calendar, or missing) and are confirmed only by a readback matching the requested times or cancelled status.
- Controlled retry (completed steps skipped, unknown outcomes parked) and parked-run behaviour are proven on the disposable database; a real delivery after unpausing was not exercised because provider traffic is denied in certification.
- Not run: full pre-deploy roster, queue/compliance base-vs-candidate scans, browser matrix, multi-connection interleaving of the appointment handlers.

## 4D native acceptance manifest (documentation only; nothing installed)
The owner must, in GHL, install and review separately: (1) booking confirmation workflow (slot `booking_confirmation`), (2) 24-hour reminder (own slot; do not duplicate in the confirmation workflow), (3) no-show reschedule (`no_show_reschedule`), (4) post-meeting statement request (`statement_request_after_meeting`). Acceptance per workflow: slot id saved, one test enrollment from a marked test contact, readback of the single message, confirm no duplicate from Replit, then record the proof. Until then the handoff is held and visible.

## Publication handoff
Publish is required for any of this to run in production; paid/provider runs execute the published build. Migration 0378 applies through the normal migration path. After publish: verify `followup_effect_receipts` and `workflow_runs.occurrence_key` exist, keep outbound pause (epoch 1) and outgoing GHL owner-pause (epoch 16) unchanged, and leave `ghl_booking_writer_enabled` unset.
