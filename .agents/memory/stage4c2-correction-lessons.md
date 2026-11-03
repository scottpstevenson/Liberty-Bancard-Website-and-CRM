---
name: Stage 4C2 correction-pass lessons
description: Non-obvious constraints from the appointment/follow-up correction pass (statement owner, audit key redaction, test fixtures, browser runs)
---
- One owner per statement-request call: an SDR lead present means the SDR flow owns and the CRM lifecycle transition is skipped. The establish step itself must refuse rep opt-out (`suppressStatementAuto`) and post-request stages inside its UPDATE; checking only in the sender let the stage move anyway.
**Why:** a test caught the opt-out regression after the owner split.
- Audit-log `details` keys named `owner` are masked ("abc***") by the audit writer; use a different key (`statementOwner`) for values you must query.
- The executor halts a run after an undelivered required send, so test fixtures that need two sends must run them as two workflows.
- Provider traffic is denied in certification: inject fake transports/`smsProviderDeps`; use distinct GHL contact IDs per test.
- Browser suites: the build identity covers `scripts/`, so any script or roster edit needs `npm run build` before the browser run; wait for dialog animation before typing into a picker (a click can land on a result row). A browser run exceeds the 300s tool limit only if started in the background with nohup; run it in the foreground with timeout instead (nohup logs vanished).
- Tests not in a roster are invisible to the runner: register standalone tests in pre-deploy.ts (`--only` throws for unregistered scripts).
**How to apply:** before claiming a suite ran, confirm it appears in a roster and the runner printed child-exit.
