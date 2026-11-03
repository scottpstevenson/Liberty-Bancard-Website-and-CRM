# Stage 4D requirements ledger

Baseline: HEAD = origin/main = `e112d19e98d3467eb3de1a6a05bdc0bd9b5babfe`, clean tree at start. Node v22.23.4, npm 10.9.9 (spec named 10.9.4; recorded, no package or lockfile change). Migrations end at 0379; **no new migration was needed**.

Status values: `closed-tested` (code + disposable-database test with negative control), `closed-static` (code + source-contract check), `open-owner` (needs owner/protected action), `open-baseline` (pre-existing failure recorded, not changed), `blocked` (no authorized path).
Test ids refer to `scripts/certification/test-stage4d-integrated-acceptance.ts` (S4D-nn) unless noted.

| Group | Item | Lineage | Status | Owner | Test | Evidence / gate |
|---|---|---|---|---|---|---|
| D01 | Truth baseline, kill lines, census | 4A–4C2 | closed-static | agent | n/a | `baseline-and-census.json`; no send/release/provider/control change |
| D02 | Inbound reply evidence is one transaction with its receipt; webhook aliases converge | 4C2 narrow gap | closed-tested | agent | S4D-01..04 | crash after event insert leaves neither event nor receipt; 3 concurrent deliveries -> 1 event |
| D03 | Reply-stop/bounce pause and its audit atomic; real count | 4C2 narrow gap | closed-tested | agent | S4D-05..09 | audit failure rolls pause back; repeat fabricates no audit |
| D04 | Held GHL enrollments expire without sending, also while paused | 4C2 | closed-tested | agent | S4D-10..16; stage4c2-completion-pass | non-claiming, non-retry-counting sweep; diagnostics on Program Health |
| D05 | Direct SMS transport re-reads provider number and compares the full normalized number every attempt | 4C2 | closed-tested | agent | S4D-17..21; sms-recipient-authority (42) | unreadable target = transient; mismatch = transport identity, never consent withdrawal |
| D06 | Retrying a failed run with no workflow parks for review | 4C2 | closed-tested | agent | S4D-22..23 | `workflow_unavailable` |
| D12 | Booking confirmation workflow wording is confirmation-only | 4C2 | closed-static | agent | S4D-25 | 24h reminder is a separate workflow; no 1h owner exists |
| D13 | Governed provider-appointment create console (admin/manager see, admin executes), local authorized contact required | 4C2 RC4C deferral | closed-tested (server) / not browser-verified (UI) | agent | S4D-24, S4D-26; stage4c2-calendar-contract (67) | writer remains default-denied; no provider write possible while outgoing GHL disabled |
| D14 | Campaign cards show Current SFP / Historical from the admin catalog truth | 4C | closed-static | agent | n/a | hidden when unreadable |
| D18/D19 | Worker heartbeat interpretation (paused_by_control / not_selected_expected_idle / stale / failed / unavailable) | 4B | closed-static | agent | stage4a tests unchanged | UI badges updated |
| D20 | Scanner baselines: compliance scan (`partner-approval-delivery.ts:107`, `sdr/voice-orchestrator.ts:594`, `sfp-seed-test.ts:219`); queue scan (`inbound-acknowledgement.ts`, `partner-approval-delivery.ts`, `sfp-seed-test.ts`) | pre-existing | open-baseline | agent follow-up | n/a | not adjudicated here; no blanket allowlist added |
| D21 | Native workflow slot install, test enrollment, cancel-disposition, calendar-purpose, booking-writer canary | 4C2 remaining | blocked | owner | n/a | see `owner-and-native-matrix.md` |
| D22 | `ghl_appointment_state_status_chk` lacks `'no_show'` in production | 4C2 | open-owner | owner (SQL console) | n/a | repair SQL is owner-run; no startup DDL |
| D23 | Five current SFP package pins draft/paused/unapproved; live packages 3 touches 0/3/5 days | 4C | open-owner | owner | n/a | use existing paired publication/approval authority; five-touch drafts not auto-adopted |
