# Development CRM and full pre-deploy verification — November 18, 2026

## Result

The complete 304-entry pre-deploy roster finished with **210 passing suite gates and 94 failing suite gates** (exit 1). Child failures: 94. Suite setup/teardown failures: 0. Shared launcher failures: 0. This is not release approval.

Candidate: `a9acad2dd35225788cd2e3d28fa73765c352cf83`, tree `57c3c5680c580af45ddc8c1558409ed2bb81f02f`. Execution checkout: `/Users/matt/Developer/liberty-dev-crm-predeploy`, branch `codex/dev-crm-predeploy`. Source was unchanged throughout the run. This report is a subsequent documentation-only change; no new implementation was pushed or synchronized.

## Development authentication and CRM

Replit's internal checks reported identical stored credential verifiers for the configured active admin in development and production; the configured credential verifies against both. No credential/account repair was applied because that credential already works. No password, verifier, token, or credential value was disclosed or copied between environments. No forced seed update was enabled.

Normal authenticated development API probes returned 200 for login, auth user, contacts, tasks, a selected task, bounded local calendar, and logout. The probe session was invalidated and its subsequent auth-user request returned 401. Existing browser sessions were preserved. The development calendar is empty: its 200 proves route availability, not populated-calendar correctness. Populated calendar boundary checks passed separately in the private C4 HTTP suite.

**The Air browser login still failed and the rendered signed-in walkthrough remains unverified.** The visible browser error was “Invalid email or password”; earlier request logs showed 401, not a rate-limit rejection or server error. Neither those logs nor timing establish exactly what the browser submitted. The successful internal probe does not prove the browser flow works for the user. No authentication bypass was introduced. The user subsequently chose to pursue manual publishing; this work did not initiate publication.

Replit dev was verified as development mode against `heliumdb`, with background jobs off, source `a9acad2`, and no pending journal migrations at its restart. The preceding restart added no migration entries (437 remained, newest journal entry 0388). Its standalone port-5000 preview renders; the default portless domain serves the component sandbox and the embedded CRM iframe is blocked. No security header was relaxed to permit embedding.

## Full run and containment

Declared runtime: Node 22.22.0, npm 10.9.4, existing locked dependencies. The Mini hostname did not resolve, so the run used a task-owned Air checkout. Existing local previews were preserved and both localhost 5187 and 5188 returned HTTP 200 after completion.

Command: `node --import tsx scripts/run-sfp2060-predeploy-disposable.ts --include-auth-concurrency`.

The registered launcher retained all 304 mandatory roster entries, including the explicitly selected private auth-concurrency coverage. Each entry received a private PostgreSQL clone, private Redis process/namespace and owned HTTP port; shared application database URLs and credentials were scrubbed. CRM provider transports were denied. The dependency-audit suite intentionally queried the npm registry. No checks ran against the shared development or production databases. The launcher completed its cleanup with no setup/teardown errors.

Passing evidence includes:

- Release artifact gate: TypeScript check, fresh production build, dependency inventory and redacting artifact credential scan all passed.
- C4 HTTP actions: 330 bounded named HTTP cases plus scoped assertions passed.
- C2 HTTP actions: 138 actual HTTP assertions passed.
- Auth-action source and real integration tests, including the private concurrency opt-in, passed.

## Failure inventory

These are observed diagnostic categories, not independent root-cause diagnoses. A failing source-text assertion alone does not prove a connected production defect. No failures were waived, hidden, skipped into a pass, or described as pre-existing without a baseline comparison.

| Observed category | Failed suites |
|---|---:|
| missing Linux Chromium executable | 29 |
| assertion failure (cause not yet diagnosed) | 20 |
| other nonzero suite result (cause not yet diagnosed) | 39 |
| missing baseline build or Git history prerequisite | 3 |
| database query failure (cause not yet diagnosed) | 2 |
| process terminated at runner time limit | 1 |

Notable concrete results:

- 29 suites failed to spawn `/usr/bin/chromium`, a Linux-only executable absent on this Mac. Their browser assertions did not complete. The private browser fixture hard-codes the Replit/Linux executable paths; a Mac browser fallback was not added during this audit.
- Three suites required missing historical/baseline build prerequisites. Historical Git object `cafc77ab1ba7c5a834a84fa000299524516aa626` was subsequently fetched successfully, without changing candidate source; that earlier failure was not silently counted as passing. The C5 and Stage4D performance baseline builds were absent.
- The canonical provider-import suite reached 725/1472 genuine synthetic bulk rows before the roster's 180-second limit terminated it (exit 143). Its inner bulk timeout is 600 seconds. This is a recorded incomplete test, not a bulk-recovery pass.
- The full dependency audit rejected **0 critical and 14 high** findings. The script aborts on the full report before reaching the production-only audit; this run does not establish that all 14 affect production dependencies.
- The pause-fence suite could not find its expected private `outbound_pause_control` row. The outbound-authority scanner also failed inline toolkit gate/inflight assertions. Current toolkit code calls the shared SMS transport boundary; the scanner result alone does not establish an actual provider bypass. These gates remain failed pending focused investigation.
- Other failures include queue/merge/seed/API coverage scans, static website contracts, mounted component behavior, and database fixture queries. Their exact ownership/contracts and causes need focused review before recommending code changes.

All 94 failing suites are listed below. Full per-suite results and first diagnostics are also saved in `/Users/matt/.local/share/liberty-dev/http-repairs/full-predeploy-results-2026-11-18.json`; the complete execution log is `/Users/matt/.local/share/liberty-dev/logs/dev-crm-full-predeploy.log` (its digest is in the JSON receipt).

| Suite | Observed category |
|---|---|
| scripts/test-stage3-c3-browser.ts | missing Linux Chromium executable |
| scripts/test-stage4c1-browser.ts | missing Linux Chromium executable |
| scripts/test-stage4c2-workspace-browser.ts | missing Linux Chromium executable |
| scripts/test-stage3-c3-browser-sequences.ts | missing Linux Chromium executable |
| scripts/test-stage3-c3-browser-campaigns.ts | missing Linux Chromium executable |
| scripts/test-stage3-d-r2-contracts.ts | assertion failure (cause not yet diagnosed) |
| scripts/test-stage3-c5-mounted.ts | other nonzero suite result (cause not yet diagnosed) |
| scripts/test-stage3-c5-panels.ts | missing Linux Chromium executable |
| scripts/test-stage3-d-v-landmarks-browser.ts | missing Linux Chromium executable |
| scripts/test-stage3-d-v-partner-browser.ts | missing Linux Chromium executable |
| scripts/test-partner-application-browser.ts | missing Linux Chromium executable |
| scripts/test-partner-review-browser.ts | missing Linux Chromium executable |
| scripts/test-stage3-d-v-contact-core-browser.ts | missing Linux Chromium executable |
| scripts/test-stage3-d-v-contact-actor-browser.ts | missing baseline build or Git history prerequisite |
| scripts/test-stage3-d-v-cohort-browser.ts | missing Linux Chromium executable |
| scripts/test-stage3-d-v-data-health-browser.ts | missing Linux Chromium executable |
| scripts/test-stage3-c5-ghl-stored-run.ts | missing Linux Chromium executable |
| scripts/test-stage3-c5-walk.ts | missing Linux Chromium executable |
| scripts/test-stage3-c5-performance.ts | missing baseline build or Git history prerequisite |
| scripts/test-stage4d-calendar-performance.ts | missing baseline build or Git history prerequisite |
| scripts/test-stage3-c5-browser.ts | missing Linux Chromium executable |
| scripts/test-website-email-browser.ts | missing Linux Chromium executable |
| scripts/test-website-email-migration.ts | assertion failure (cause not yet diagnosed) |
| scripts/test-stage3-c4-browser.ts | missing Linux Chromium executable |
| scripts/test-stage3-c4-health-browser.ts | missing Linux Chromium executable |
| scripts/test-c2-postmerge-browser.ts | assertion failure (cause not yet diagnosed) |
| scripts/test-c2-contact-header.ts | missing Linux Chromium executable |
| scripts/test-toast-viewport-layout.mjs | missing Linux Chromium executable |
| scripts/test-wd-locations-contract.ts | other nonzero suite result (cause not yet diagnosed) |
| scripts/test-wd-industries-contract.ts | other nonzero suite result (cause not yet diagnosed) |
| scripts/test-public-shell-browser.mjs | missing Linux Chromium executable |
| scripts/test-stage3-c2-browser.mjs | missing Linux Chromium executable |
| scripts/test-phase6-provenance-and-record-class.ts | database query failure (cause not yet diagnosed) |
| scripts/test-phase6-intake-cohorts.ts | database query failure (cause not yet diagnosed) |
| scripts/test-phase6-workspace-identity.ts | assertion failure (cause not yet diagnosed) |
| scripts/test-phase6-browser.ts | missing Linux Chromium executable |
| scripts/test-phase7-public-mobile.ts | missing Linux Chromium executable |
| scripts/test-phase7-upgrade.ts | assertion failure (cause not yet diagnosed) |
| scripts/test-phase7-browser.ts | missing Linux Chromium executable |
| scripts/test-phase6-populated-journeys.ts | missing Linux Chromium executable |
| scripts/test-stage3-c1-browser.mjs | missing Linux Chromium executable |
| scripts/certification/test-audited-retained-import-recovery.ts | assertion failure (cause not yet diagnosed) |
| scripts/certification/test-canonical-registry-projection.ts | assertion failure (cause not yet diagnosed) |
| scripts/certification/test-crm-contact-link-automation.ts | other nonzero suite result (cause not yet diagnosed) |
| scripts/certification/test-canonical-provider-import.ts | process terminated at runner time limit |
| scripts/certification/test-recipient-preparation-lane-reserve.ts | assertion failure (cause not yet diagnosed) |
| scripts/test-partner-hub-react-media.ts | other nonzero suite result (cause not yet diagnosed) |
| scripts/test-stage3-b-lifecycle.ts | assertion failure (cause not yet diagnosed) |
| scripts/test-stage3-b-browser.ts | missing Linux Chromium executable |
| scripts/check-migration-seed-registration.ts | other nonzero suite result (cause not yet diagnosed) |
| scripts/dependency-audit-policy.ts | other nonzero suite result (cause not yet diagnosed) |
| scripts/test-sfp-disposable-certification.ts | assertion failure (cause not yet diagnosed) |
| scripts/test-sfp2000-disposable-certification.ts | assertion failure (cause not yet diagnosed) |
| scripts/test-sfp2001-campaign-staging-certification.ts | assertion failure (cause not yet diagnosed) |
| scripts/check-contact-merge-manifest.ts | other nonzero suite result (cause not yet diagnosed) |
| scripts/check-queue-compliance.ts | other nonzero suite result (cause not yet diagnosed) |
| scripts/test-ghl-route-pause-gates-1629.ts | other nonzero suite result (cause not yet diagnosed) |
| scripts/scan-serper-raw-fetch.ts | other nonzero suite result (cause not yet diagnosed) |
| scripts/test-serper-gateway.ts | other nonzero suite result (cause not yet diagnosed) |
| scripts/test-sequence-compliance.ts | other nonzero suite result (cause not yet diagnosed) |
| scripts/test-sequence-terminalization-race.ts | assertion failure (cause not yet diagnosed) |
| scripts/test-contactability.ts | other nonzero suite result (cause not yet diagnosed) |
| scripts/test-new-lead-enrollment-policy.ts | other nonzero suite result (cause not yet diagnosed) |
| scripts/sfp-certification.ts | other nonzero suite result (cause not yet diagnosed) |
| scripts/test-transport-dispatch.ts | other nonzero suite result (cause not yet diagnosed) |
| scripts/test-redis-topology.ts | other nonzero suite result (cause not yet diagnosed) |
| scripts/check-cro02-authority.ts | other nonzero suite result (cause not yet diagnosed) |
| scripts/test-cro03c-static.ts | assertion failure (cause not yet diagnosed) |
| scripts/test-cro03c-integration.ts | other nonzero suite result (cause not yet diagnosed) |
| scripts/test-cro03b-integration.ts | other nonzero suite result (cause not yet diagnosed) |
| scripts/certify-cro03b-csv-handoff.ts | assertion failure (cause not yet diagnosed) |
| scripts/test-cro03-ledger-convergence.ts | other nonzero suite result (cause not yet diagnosed) |
| scripts/test-seed-convergence-verifier-integrity.ts | other nonzero suite result (cause not yet diagnosed) |
| server/tests/cr06-promotional-boundary-inventory.source.test.ts | assertion failure (cause not yet diagnosed) |
| scripts/test-cr06-disposable-certification.ts | assertion failure (cause not yet diagnosed) |
| scripts/test-cro07-disposable-certification.ts | assertion failure (cause not yet diagnosed) |
| scripts/test-cro03-integration.ts | other nonzero suite result (cause not yet diagnosed) |
| scripts/test-cro03-http-authorization.ts | assertion failure (cause not yet diagnosed) |
| scripts/test-crm-operator-experience.ts | assertion failure (cause not yet diagnosed) |
| scripts/test-reconciliation-certification.ts | other nonzero suite result (cause not yet diagnosed) |
| scripts/check-api-coverage.ts | other nonzero suite result (cause not yet diagnosed) |
| scripts/seo-audit.ts | other nonzero suite result (cause not yet diagnosed) |
| scripts/check-public-site-mobile.ts | other nonzero suite result (cause not yet diagnosed) |
| scripts/check-public-shell-design.ts | other nonzero suite result (cause not yet diagnosed) |
| scripts/check-public-fonts.ts | other nonzero suite result (cause not yet diagnosed) |
| scripts/check-public-overlay.ts | other nonzero suite result (cause not yet diagnosed) |
| scripts/check-public-server-hydrated-parity.ts | other nonzero suite result (cause not yet diagnosed) |
| scripts/check-wd-pv-browser.ts | other nonzero suite result (cause not yet diagnosed) |
| scripts/test-pause-fence.ts | other nonzero suite result (cause not yet diagnosed) |
| scripts/test-outbound-pause-authority.ts | other nonzero suite result (cause not yet diagnosed) |
| scripts/test-outbound-boundary-1626.ts | other nonzero suite result (cause not yet diagnosed) |
| scripts/test-statement-acquisition.ts | other nonzero suite result (cause not yet diagnosed) |
| scripts/test-nba.ts | other nonzero suite result (cause not yet diagnosed) |
| scripts/test-forms.ts | other nonzero suite result (cause not yet diagnosed) |

## Evidence preservation and operational state

Fresh generated certification outputs were archived privately and eight pre-existing tracked evidence files were restored byte-for-byte. Task-owned `.local` output, including synthetic private VAPID keys, was moved to a private archive and excluded from Git. Application/test/configuration source remains unchanged. No broad reset or cleanup touched another worktree.

The final read-only Replit readback confirmed production paused at epoch 4 and development paused at epoch 750; the dev app still had background jobs off. It also reported Replit HEAD `c54fdf18`, two commits after the tested candidate: `bc4f3b0f` (described by the Replit Agent as a discovery-check fix) and `c54fdf18` (titled “Published your App”). It reported four changed fix files. Their exact contents, authorization/provenance, full hashes and deployed-runtime identity were not independently inspected, so the 304-suite results must not be attributed to that newer source. Nothing was reset or overwritten. The user objected to visible Replit Agent messages; further Replit requests were stopped and the pending read-only follow-up orchestration was terminated. No outbound controls, production credentials/settings, production workers or schema were changed by this work. No publish was initiated by this work. Any publication the user performs manually is separate from this test result.
