# VG-01 through VG-04 Redacted Evidence Packet — 78ae07e8 — 2026-08-27

**Tested live-main SHA:** `78ae07e8c5ffb643467a93dc42b95834d65289a8`
**Observed published SHA:** `f2cfa4aade9b24435128c9bd5787ad01f5281563`
**Capture window:** 2026-08-26T21:41:39Z through 2026-08-27T02:55:09Z
**Operator:** Replit Agent
**Redaction:** counts, status buckets, release identities, route names, and queue names only; no credentials, provider tokens, contact identifiers, email addresses, phone numbers, or row samples.

## Evidence integrity

Command:
`sha256sum attached_assets/LIBERTY_BANCARD_RUNTIME_VERIFICATION_REGISTER_1786901209005.md`

Result:
`a97f1772aa6a494ac46c13009c50adade1c7c000b7df3f5eec2e5ab90dc9e897`

Command:
`git rev-parse origin/main`

Result:
`78ae07e8c5ffb643467a93dc42b95834d65289a8`

The uploaded task instructions were copied out before switching branches and restored as untracked files. They are absent from commits 48dcc124 and 776f206c.

## GitHub and exact-main CI evidence

Command:
`gh run view 33016539222 --repo scottpstevenson/Liberty-Bancard-Website-and-CRM --json headSha,status,conclusion,jobs`

Redacted result:
- head SHA `78ae07e8c5ffb643467a93dc42b95834d65289a8`
- workflow conclusion `success`
- Static Checks `success`
- Integration Tests `success`

Command:
`gh api repos/scottpstevenson/Liberty-Bancard-Website-and-CRM/branches/main/protection`

Redacted result:
- HTTP 404, `Branch not protected`
- RV-CI-01 is `FAIL_CURRENT_RELEASE`; the successful checks are not governance-enforced.

## Local exact-main commands and outputs

| Command | Redacted result |
|---|---|
| `npm run check` | exit 0; TypeScript clean |
| `npm run build` | exit 0; client and server built; chunk-size and stale Browserslist warnings only |
| `npx tsx scripts/ci-suite-manifest.ts --check` | exit 0; 59/59 mandatory suites classified |
| `npx tsx scripts/check-migration-integrity.ts` | exit 0; 361 checks; two documented historical duplicate-time warnings |
| `npx tsx scripts/compliance-scan.ts` | exit 0; 106/106 call sites; 84 email sites classified; pause boundary clean |
| `npx tsx scripts/run-ci-suites.ts --capability deterministic-static` | exit 0; 19/19 suites |
| `npx tsx scripts/test-sender-policy.ts` | exit 0; 82/82 checks |
| API coverage workflow | exit 0; no new unmatched paths; 16 pre-existing unmatched patterns listed by the workflow |
| SEO audit workflow | exit 0; 421 routes; 0 failed; 12 warnings |
| role-guards workflow | exit 0 skip; server unreachable; classified as non-pass, not evidence |

Stateful runner attempts:
- deterministic-integration exited 1 because `NODE_ENV` was not `test`.
- server-required exited 1 for the same reason.
- `TEST_DATABASE_URL` was absent, so the normal database was not substituted.

Cleanup proof:
- No local stateful test was started, no disposable database or Redis keyspace was created, and no cleanup command was needed.
- The guarded migration launcher was negative-tested with missing `TEST_DATABASE_URL`; it exited before importing the canonical migration runner.

## Published release identity evidence

Endpoints:
- `GET https://dev.libertybancard.com/api/health`
- `GET https://libertybancard.com/api/health`
- `GET https://liberty-bancard-system.replit.app/api/health`

Redacted result for all three:
- HTTP 200
- status `ok`
- environment `production`
- SHA `f2cfa4aade9b24435128c9bd5787ad01f5281563`
- built at `2026-08-27T01:10:26.811Z`

Authenticated boundary:
- `GET /api/admin/live-health?refresh=1` returned HTTP 401.
- `GET /api/operator/queue-metrics` returned HTTP 401.
- No production login was performed because it would create session state.

Conclusion: the published release is not the exact live-main SHA. No runtime row is marked PASS.

## Worker and topology evidence

Source: redacted deployment-log query for `worker:ready`.

Result:
- 25 unique queue names observed.
- one observed processId: 37.
- processIdentity: null.
- every observed worker SHA: `f2cfa4aade9b24435128c9bd5787ad01f5281563`.

Queues observed: abandoned-statement, activation-monitor, chargeback-commands, db-backup, deal-stage-effects, digests, enrichment, enrollment-recovery, executive-snapshot, ghl-enrollment-recovery, ghl-sync, health-monitor, merchant-success, mid-ingestion, onboarding-reminder, partner-monthly-digest, pipeline-silence-check, post-enrichment, proposal-followup, sequences, statement-upload, system-audit, voicemail-sync, winback-outreach, zerobounce-batch-validate.

Recent redacted failure signals:
- GHL transient timeout retries.
- boarding and merchant outbox tick errors.
- GHL mutations blocked by global pause in development logs.

Limit: no authenticated repeatable-job or topology export and no 24-hour series. One-owner and health rows remain non-pass.

## Security evidence

Fresh managed scans:
- dependency audit: critical 0; high 31; moderate 39; low 6.
- SAST: 8 findings, including high findings in historical password-reset migration content and OG path handling.
- privacy scan: 93 findings, primarily logging-oriented; no raw identifier is reproduced here.

Representative high dependency packages: drizzle-orm, multer, nodemailer, path-to-regexp, sharp, undici, uuid, vite, ws, xlsx. These are blockers pending triage or remediation.

### Repository-hygiene finding

Current `main` tracks six synthetic statement PDFs under `uploads/statement-command/` and tracked pasted-instruction text under `attached_assets/`. The certification records but does not delete them. `scan-tracked-files.ts` detects selected prohibited extensions and signatures rather than rejecting those directories categorically, so these files were outside its existing rule coverage. A separate reviewed remediation must remove them and extend the scanner.

## Production read-only aggregate evidence

All queries used the production read-only database tool. They selected only schema names, counts, and status buckets. No identifiers or values were returned.

Query target: commercial classification grouped by `record_class`.

Result:
- contacts: unknown 155,356.
- deals: unknown 1,571.
- companies: unknown 1,221.

Query target: provenance counts.

Result:
- contacts total 155,356.
- contacts with primary source 144.
- contacts without primary source 155,212.
- contact source events 146.
- import executions 0.

Query target: email validation status.

Result:
- active 155,249; valid 32; bounced 61; opted_out 13; subscribed 1.

Query target: readiness and scoring.

Result:
- readiness grade null 116,769.
- readiness model version null 116,769.
- lead score null 0; zero 152,000; positive 3,356.

Query target: GHL linkage.

Result:
- linked 1,921; missing 153,435.

Schema catalog result:
- provider controls/attempts/observations/operations/dispositions exist.
- ZeroBounce campaigns/runs/attempts exist.
- statement commands/proposals/reviews and residual import/report tables exist.

No production row was inserted, updated, deleted, migrated, backfilled, reconciled, sampled, or printed.

## Provider boundary evidence

Configuration-presence checks only:
- Apollo key absent.
- Serper, Outscraper, GHL location/calendar/token, ZeroBounce, and SMTP variables present.
- Secret values were never read or printed.

No live Apollo, GHL, ZeroBounce, Serper, Outscraper, SMTP, SMS, OCR, or AI certification call was made. No provider credit was intentionally consumed by the certification. TCR/A2P evidence was unavailable; SMS remains NO-GO.

## Browser and stateful execution boundary

Command:
`browser-use doctor`

Result:
- exit 127; command unavailable in the workspace.

Static route/guard reconnaissance mapped Queue Holds, Comms Hub, contact/deal ownership, statement/application, chargeback, residual, and revenue surfaces. No authenticated browser flow was executed because disposable DB/Redis, isolated identities, and fake providers were unavailable. No screenshot is claimed. UI and revenue rows remain ACCESS_REQUIRED or INCONCLUSIVE.

## Validator evidence

Positive command:
`npx tsx scripts/validate-vg-runtime-register.ts docs/LIBERTY_BANCARD_RUNTIME_VERIFICATION_REGISTER_78ae07e8_2026-08-27.md`

Result:
- 39/39 unique source IDs structurally reconciled.
- immutable source checksum, exact source claims, required fields, status vocabulary, UTC timestamps, exact SHAs, SHA/date filename, and evidence artifact enforced.

Negative tests:
- a changed runtime claim exits 1 with source-claim mismatch.
- a PENDING status exits 1.
- a fabricated PASS without matching evidence block exits 1.
- missing test database causes guarded migration launcher to exit before canonical migration import.

## Failures and repairs during certification

1. The initial runbook called an import-only guard as a CLI. Independent review caught the issue before task completion. Repair: guarded canonical migration launcher plus a UUID-qualified Redis namespace.
2. The initial validator checked IDs and shape but not source claims or exact SHAs. Repair: immutable claim binding, exact SHA/timestamp/filename checks, evidence artifacts, and future-PASS deployment/evidence block requirements.
3. Completion review found inherited AI credentials could trigger knowledge indexing. Repair: explicit provider-deny mode scrubs provider credentials and blocks HTTP before canonical migrator import; regression test verifies the inherited AI key is removed.
4. Post-review found integration and isolated-server child processes could still inherit credentials. Repair: guarded outer launchers now spawn migration, suite, and server application children with one explicit replacement environment; provider denial covers global fetch and direct Node HTTP(S) before application imports, and blocked external requests fail the process. The server alone installs a fixed non-secret dummy AI constructor key with a loopback base URL after denial; migration and suite children retain no AI key. The certification server is route-only: workers, operational provider-health sweeps, GHL live validation, and recurring schedulers are disabled while loopback route readiness remains mandatory.
5. The register now records release, email-pilot, SMS, and mass-scale criticality independently, plus role-specific owner and recurrence. RV-OUT-05 blocks SMS and applicable mass scale, not an email-only pilot.
6. No failed production mutation or provider operation occurred.
7. Final architecture review found URL-plus-options overrides could bypass a first-argument loopback check and Redis prefixes were not collision-reserved. Repair: validate the effective HTTP(S) target, reject custom connection hooks, make blocked attempts immediately fatal, and atomically reserve UUID-qualified per-operation Redis namespaces with stale-key rejection and release-on-exit. Dedicated regressions cover both controls.

## Register evidence map

| RV ID | Final status | Evidence section | Redacted result summary |
|---|---|---|---|
| RV-1548-01 | DEPLOYMENT_REQUIRED | Static and isolated execution evidence | All published health endpoints and 25 observed worker queues report f2cfa4aa, not live-main 78ae07e8. |
| RV-1548-02 | DEPLOYMENT_REQUIRED | Static and isolated execution evidence | Migration integrity passed 361 checks on exact main; published ledger/current-release schema was not available. |
| RV-1548-03 | ACCESS_REQUIRED | Static and isolated execution evidence | Stateful runner failed closed because TEST_DATABASE_URL is absent. |
| RV-1548-04 | DEPLOYMENT_REQUIRED | Worker and topology evidence | Authenticated queue-holds/live-health returned 401; worker processIdentity is null. |
| RV-1548-05 | ACCESS_REQUIRED | Static and isolated execution evidence | No approved authenticated preview plus same-window aggregate harness was available. |
| RV-1548-06 | ACCESS_REQUIRED | Worker and topology evidence | Worker queues were observed but repeatable schedule enumeration was unavailable. |
| RV-1548-07 | ACCESS_REQUIRED | Static and isolated execution evidence | PE lease, attempt, reason, and oldest-age aggregates were not available. |
| RV-1548-08 | ACCESS_REQUIRED | Static and isolated execution evidence | Crash recovery scenarios require disposable DB, Redis, and fake transports. |
| RV-OUT-01 | ACCESS_REQUIRED | Static and isolated execution evidence | Static pause/compliance gates passed; isolated runtime adapter probes were not run. |
| RV-OUT-02 | ACCESS_REQUIRED | Static and isolated execution evidence | Two-process epoch propagation needs isolated multi-process infrastructure. |
| RV-OUT-03 | ACCESS_REQUIRED | Static and isolated execution evidence | Controlled missing, malformed, slow, and unavailable DB startup fixtures were unavailable. |
| RV-OUT-04 | ACCESS_REQUIRED | Static and isolated execution evidence | Reason-scoped hold survival requires isolated pause/unpause mutations. |
| RV-OUT-05 | ACCESS_REQUIRED | Provider boundary evidence | No read-only TCR/A2P registration or number ownership evidence was available. |
| RV-QUE-01 | ACCESS_REQUIRED | Worker and topology evidence | Redis is configured; plan, max-client, and rejection telemetry were unavailable. |
| RV-QUE-02 | ACCESS_REQUIRED | Worker and topology evidence | Recent logs show queue activity, GHL timeouts, and outbox errors; no 24-hour series. |
| RV-QUE-03 | INCONCLUSIVE | Worker and topology evidence | One processId, null processIdentity, and 25 queues observed; repeatables/topology unavailable. |
| RV-QUE-04 | ACCESS_REQUIRED | Worker and topology evidence | Alert injection needs isolated stale-heartbeat and threshold fixtures. |
| RV-CI-01 | FAIL_CURRENT_RELEASE | GitHub and exact-main CI evidence | Exact-main CI passed static and integration jobs, but main is not protected. |
| RV-ZB-01 | DEPLOYMENT_REQUIRED | Provider boundary evidence | ZB tables and worker queue exist; published SHA is stale and latest run heartbeat unavailable. |
| RV-ZB-02 | ACCESS_REQUIRED | Provider boundary evidence | Email-status counts available; campaign, run, attempt, ETA, and completion reconciliation unavailable. |
| RV-ZB-03 | ACCESS_REQUIRED | Provider boundary evidence | Provider/budget behavior requires fake provider and disposable DB; no live call made. |
| RV-DAT-01 | FAIL_CURRENT_RELEASE | Production read-only aggregate evidence | Counts: contacts 155356 unknown; deals 1571 unknown; companies 1221 unknown. |
| RV-DAT-02 | ACCESS_REQUIRED | Production read-only aggregate evidence | No normalized email/phone collision aggregate was run. |
| RV-DAT-03 | ACCESS_REQUIRED | Production read-only aggregate evidence | Only 144 of 155356 contacts have primary source; 146 source events; 0 import executions. |
| RV-DAT-04 | ACCESS_REQUIRED | Production read-only aggregate evidence | Sensitive values were never read; only schema catalog was inspected. |
| RV-ENR-01 | DEPLOYMENT_REQUIRED | Provider boundary evidence | Enrichment worker is active; published SHA is stale and durable heartbeat aggregate unavailable. |
| RV-ENR-02 | ACCESS_REQUIRED | Provider boundary evidence | Serper is configured and logs show calls; current-release usage/cost report unavailable. |
| RV-ENR-03 | ACCESS_REQUIRED | Provider boundary evidence | No approved bounded before/after yield cohort was available. |
| RV-ENR-04 | ACCESS_REQUIRED | Provider boundary evidence | Provider secrets are configured; no live probe or cost report was run. |
| RV-ENR-05 | ACCESS_REQUIRED | Provider boundary evidence | Logs show discovery work; authoritative run/status/oldest-age aggregates unavailable. |
| RV-ENR-06 | ACCESS_REQUIRED | Production read-only aggregate evidence | 116769 of 155356 contacts lack readiness grade and model version. |
| RV-ENR-07 | ACCESS_REQUIRED | Production read-only aggregate evidence | Lead scores: null 0; zero 152000; positive 3356; version coverage unavailable. |
| RV-GHL-01 | DEPLOYMENT_REQUIRED | Production read-only aggregate evidence | GHL linked 1921; missing 153435; timeouts visible while global pause blocks mutation. |
| RV-GHL-02 | ACCESS_REQUIRED | Provider boundary evidence | GHL configuration exists; prohibited live workflow validation was not called. |
| RV-UI-01 | ACCESS_REQUIRED | Browser and stateful execution boundary | browser-use unavailable and no isolated authenticated identities/database were provisioned. |
| RV-UI-02 | INCONCLUSIVE | Browser and stateful execution boundary | Static route map audited; role-guard workflow skipped and no browser crawl ran. |
| RV-UI-03 | ACCESS_REQUIRED | Browser and stateful execution boundary | Synthetic inbound event requires isolated DB and fake provider. |
| RV-REV-01 | ACCESS_REQUIRED | Browser and stateful execution boundary | Statement/application E2E needs disposable DB, encrypted fixtures, CSRF, and fake providers. |
| RV-REV-02 | ACCESS_REQUIRED | Browser and stateful execution boundary | Financial tables cataloged; source/import/report amount reconciliation was not run. |

## Machine-readable PASS evidence contract

The current register has zero PASS rows, so this packet intentionally contains no `RV-EVIDENCE` PASS blocks. A future PASS must add a block matching this exact shape and the validator binds it to the row, tested SHA, observed deployed SHA, timestamp, environment, substantive locator/result, and isolation proof:

```text
<!-- RV-EVIDENCE RV-EXAMPLE-00
evidence_date=2026-08-27T02:55:09Z
exact_sha=40-character deployed SHA
environment=exact environment name
locator=command:path-or-command-with-artifact-reference
result=substantive redacted output of at least twenty characters
isolation=matching read-only, disposable, fake transport, or no network proof
-->
```
