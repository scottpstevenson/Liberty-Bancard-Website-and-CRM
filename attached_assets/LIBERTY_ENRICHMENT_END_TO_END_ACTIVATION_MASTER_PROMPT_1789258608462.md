# LIBERTY BANCARD — ENRICHMENT END-TO-END PRODUCTION ACTIVATION

Paste this entire prompt into one Replit Agent task **after Task #1940 has finished and merged**. This is one preflight/build/deploy/activation task—not a request for another roadmap or a chain of follow-up tasks.

---

## 1. MODE AND OUTCOME

Operate in **inspect → correct → test → deploy → activate → verify** mode.

The required outcome is to turn on Liberty Bancard’s governed enrichment system end to end for the entire eligible existing database, restore its recurring enrichment schedules, validate discovered and existing emails, and produce a measurable pool of records that are ready for a later cold-email launch.

This task authorizes production enrichment and the necessary bounded provider calls. It does **not** authorize sending cold email, SMS, voice calls, ringless voicemail, GHL workflow enrollment, or any other outbound communication. Keep every outbound pause and suppression boundary enforced throughout this task.

Do not merely analyze, write a plan, create more tasks, or stop after a dry run. Finish this as one workstream unless an actual owner-only credential, unresolved current pricing approval, protected deployment permission, or failed safety gate makes production activation impossible. If one of those real blockers occurs, complete every safe code/config/test step, stop immediately before the blocked external effect, and report the exact single owner action required.

## 2. BASELINE AND TASK #1940 SEQUENCING

1. Do not work from an old Replit task branch or an in-progress Task #1940 workspace.
2. Confirm Task #1940 is complete and merged, then fetch and reset the task workspace to the exact current `origin/main` using a clean, non-destructive workflow.
3. Record the starting commit SHA, branch, tree status, migration head, Node/npm versions, deployment target, and production `RELEASE_SHA`.
4. Treat Task #1940’s merged pricing corrections as the new baseline. Re-audit them; do not recreate, overwrite, or silently conflict with them.
5. At the time of this prompt’s external audit, upstream was `be80dc2d2af395ba17582887c00ef9a5ac0b5f96`. That SHA is evidence only, not permission to use it if `origin/main` has advanced.
6. Preserve unrelated user work. Never use `git reset --hard` against a dirty or user-owned workspace.

## 3. KNOWN FINDINGS TO REVERIFY BEFORE CHANGING CODE

Reverify every item below against the post-#1940 tree. These are known activation blockers or material risks, not optional observations:

1. `BACKGROUND_JOB_PROFILE` fails closed to `off`; `server/services/background-profile.ts` supports `off`, `core`, `full`, and `selective`.
2. The existing selective capability groups include enrichment, provider-live, and email-validation queues, but do not include `cro08a-scheduler` or `cro08a-processor`. Therefore `selective:enrichment,provider-live,email-validation` cannot activate the continuous factory. Do not solve this by using `full`, because `full` also starts unrelated/outbound-capable work.
3. CRO08A’s scheduler currently snapshots all CRO03A census cursors and the processor enumerates the frozen sources. Its schedule definition policy versions are not an enforced source allowlist. Consequently, existing `dbpr-*` cursors or handoffs could be consumed unless an immutable source-scope contract is added and enforced.
4. CRO03A’s enumerated sources do not include canonical `businesses` or `contacts`. Current free enrichment only covers canonical businesses with a website domain and does not by itself prove complete canonical-database intake. “Run CRO03A” therefore does not equal “enrich the entire database.”
5. Source Registry contains DBPR adapters (`dbpr-hr`, `dbpr-abt`, `dbpr-cos`, `dbpr-bar`) seeded schedule-disabled. They must remain disabled and unused in this run.
6. The old discovery endpoints are intentionally hard-disabled pending durable command ownership. Do not revive them or use legacy outreach discovery as a shortcut.
7. Provider controls default disabled. Secret presence alone is not activation. Serper may have both `provider_controls` and a separate `serper_control`; reconcile these gates so there is one unambiguous effective state and no contradictory enablement.
8. ZeroBounce’s recurring campaign additionally depends on `system_settings.zerobounce_auto_run_enabled`, its daily limit, its provider control, circuit state, and secret.
9. Provider transport depends on `CRO03_PROVIDER_TRANSPORT_ENABLED=true` in an authorized context; `VG_PROVIDER_DENY_MODE` must not be enabled for live calls.
10. The CRO03 migration authority constant was observed at `0260_mi07_dedup_unique_indexes` while the journal already extended through `0262_mi09_pilot_phase_command_type`. Bind ceremony and current-release certification to the actual final migration head and migration hash chain after #1940.
11. `scripts/cro03d-run-ceremony.ts` was observed at more than 113,000 lines with repeated pricing content, alongside temporary pricing/signing scripts and a committed signed artifact. Verify Task #1940 has normalized this. No duplicated ceremony implementation, temporary pricing repair script, provisional price masquerading as authority, private key, or stale signature may remain an activation dependency.
12. Production paid-provider activation is governed by release-bound policy, pricing, deployment inventory/runtime attestation, four approval dimensions, pilot evidence, circuit breakers, budgets, and the CRO08A post-pilot certification. Do not bypass those controls.
13. The initial-rollout singleton may already exist in production. Inspect and reconcile it. Never delete, recreate, or fabricate it to make a ceremony pass.

## 4. EXACT SCOPE: WHAT “THE ENTIRE DATABASE” MEANS

Build a production census before mutation. The denominator is every **eligible existing prospect/business record** from current canonical and staged populations, including at minimum:

- canonical prospective `businesses`;
- `master_leads`;
- `prospects`;
- `sdr_merchants`;
- eligible `lead_discovery_results` already in the database;
- eligible `public_web` and provider-CSV handoffs already in the database;
- existing Sunbiz-derived CRM records only when they are already stored, are not DBPR-derived, and pass all canonical eligibility rules;
- existing contacts associated with eligible records, for email validation and winner selection.

Exclude from the denominator and from provider submission:

- all DBPR source families and all DBPR-derived records, handoffs, cursors, batches, candidates, commands, and occurrences;
- restaurants and food trucks that entered through any DBPR dataset;
- existing customers/current merchants unless an owner-approved lifecycle policy explicitly marks them as prospect-eligible;
- test, demo, fixture, synthetic, malformed, or unknown-record-class rows;
- opt-outs, DNC, suppression-list matches, spam complaints, hard bounces, invalid emails, legal holds, and channel-ineligible identities;
- unresolved identity conflicts and records that cannot be safely attached to one canonical business;
- records outside approved geography or ICP rules, if those rules are part of the current canonical policy.

Do not define success as “every row has an email.” Define success as **100% of the eligible census reaching a durable, explainable terminal state**: enriched/validated and ready; no result; invalid/suppressed; manual review; or bounded failure after retry exhaustion. Report email yield separately.

## 5. NON-NEGOTIABLE DBPR EXCLUSION

This run must not import, schedule, enumerate, enrich, convert, or send to a provider any DBPR record.

Implement an immutable source-scope contract for every continuous schedule definition and occurrence. It must support an explicit allowlist plus exclusions and be bound into the definition/occurrence identity, audit hash, approval, scheduler snapshot, processor command, idempotency key, and certification receipt.

Enforce the scope at all of these layers:

1. schedule-definition creation and validation;
2. scheduler cursor selection and frozen snapshot creation;
3. occurrence creation;
4. processor enumeration;
5. candidate/command binding;
6. provider dispatch;
7. recovery/replay paths;
8. operational UI/API views and production reporting.

Reject—not merely skip silently—any activation scope containing `dbpr`, `dbpr-*`, or a row whose lineage resolves to DBPR. Add negative tests for direct, aliased, mixed-source, stale-cursor, replay, and recovery cases. Keep every DBPR Source Registry adapter `schedule_disabled=true`; do not call its import endpoint and do not enqueue `source-registry-import` for DBPR.

Before and after activation, run production read-only proofs showing zero DBPR records in the chosen census, occurrences, commands, provider attempts, and completed provider results. Include counts and query fingerprints in the final report without exposing sensitive data.

## 6. COMPLETE CANONICAL BACKFILL INTAKE

Add or finish a durable, idempotent intake path for eligible canonical businesses that the current CRO03A source adapters do not cover. Do not treat the contacts table as an ungoverned discovery source and do not duplicate businesses.

The intake must:

- attach to the existing canonical business/identity model;
- preserve source lineage and record class;
- use stable dedupe/idempotency keys;
- route canonical businesses through the governed qualification/master-lead/provider workflow;
- route existing/discovered emails through the canonical email-evidence, winner-selection, and ZeroBounce validation workflow;
- checkpoint progress and resume after restart;
- reconcile already-enriched records instead of blindly re-calling paid providers;
- preserve manual-review and suppression decisions;
- expose denominator, eligible, excluded, pending, in-flight, retry, and terminal counts.

Do not create a parallel shadow CRM table or a second enrichment truth model.

## 7. CORRECT SELECTIVE BACKGROUND PROFILE

Extend the selective background-job model so a narrow production profile can run the complete enrichment system without starting outreach.

Create a clearly named capability such as `continuous-enrichment` containing exactly the CRO08A scheduler/processor queues and any strictly required recovery queue. Then use an explicit production profile equivalent to:

`selective:enrichment,post-enrichment,provider-live,email-validation,continuous-enrichment`

Use the repository’s real grammar and names; do not copy that string if implementation uses a different canonical representation.

Prove the resolved queue allowlist includes only required enrichment/validation/qualification/staging queues and excludes campaign sends, sequence sends, workflow enrollment, legacy outreach, SMS, voice, ringless voicemail, and unrelated maintenance queues. Add profile-resolution tests and a production startup log/health view that shows the resolved queues without secret values.

## 8. PROVIDER ROUTING: ENRICH INTELLIGENTLY, NOT EXPENSIVELY

Use a missing-field/evidence-driven cascade. Do not call every provider for every record.

1. Run free first-party enrichment first: stored website/domain evidence, first-party web/contact pages, RDAP, JSON-LD, and supported HTML-derived signals.
2. Use Serper only when required website/contact/business evidence is still missing or stale.
3. Use Outscraper only where its approved contract is the least-cost applicable source for a specific missing field; do not blanket-submit the database.
4. Use Apollo only after business identity is resolved and an ICP-appropriate decision-maker/contact is still needed.
5. Use OpenAI only for bounded evidence-grounded classification/normalization/summarization allowed by policy. It must never invent a person, email, phone, consent, legal status, or provider fact.
6. Submit every candidate email—existing or newly discovered—to the canonical validation flow before it can become outreach-ready. Enforce winner selection, confidence, provenance, freshness, suppression, and catch-all/manual-review policy.
7. Do not activate Apify, Proxycurl, or any other provider unless the current canonical pipeline actually requires it, its pricing and contract are approved, and its inclusion is necessary to close a documented coverage gap.

Each paid call must carry the canonical command/occurrence/release/policy/pricing scope and produce an auditable attempt/result. Retries must not double-charge by losing idempotency.

## 9. SECRETS AND CONFIGURATION

Inspect secret/config presence and validity without printing values. Never copy a secret into source, logs, diffs, artifacts, shell history, UI responses, or the final report.

At minimum verify the current canonical names and runtime access for:

- `DATABASE_URL`
- `REDIS_URL`
- `RELEASE_SHA`
- `MERCHANT_DATA_ENCRYPTION_KEY`
- `SERPER_API_KEY`
- `OUTSCRAPER_API_KEY`
- `APOLLO_API_KEY`
- `ZEROBOUNCE_API_KEY`
- `AI_INTEGRATIONS_OPENAI_API_KEY`
- `AI_INTEGRATIONS_OPENAI_BASE_URL`
- the current trusted approval/deployment-inventory issuer configuration;
- the offline ceremony signing key only if the approved ceremony explicitly requires it.

If a secret is missing, invalid, unauthorized, or belongs to the wrong environment/account, stop that provider before any call and request only that exact owner action. Do not generate, guess, echo, migrate, or rotate owner secrets. If the code’s secret-status endpoint uses a different name from the actual adapter (for example `APIFY_TOKEN` vs `APIFY_API_TOKEN`), correct the status check only if that provider is legitimately in scope.

Required safe configuration includes:

- corrected selective `BACKGROUND_JOB_PROFILE`;
- `FREE_ENRICHMENT_ENABLED=true`;
- `CRO03_PROVIDER_TRANSPORT_ENABLED=true` only after all live gates pass;
- `VG_PROVIDER_DENY_MODE` absent/false for the authorized live phase;
- `SUNBIZ_ENRICHMENT_ENABLED=false` for this activation unless the current canonical policy requires refresh of already-stored, non-DBPR Sunbiz records without new source acquisition;
- `LEGACY_OUTREACH_ENABLED=false`;
- `ORCHESTRATOR_ENABLED=false`;
- `NIGHTLY_DISCOVERY_ENABLED=false`;
- `SMS_ENABLED=false`;
- `VOICE_AI_ENABLED=false`;
- `RINGLESS_VM_ENABLED=false`.

Inspect Redis connection capacity and worker concurrency before enabling the selected profile. Do not solve capacity risk by dropping locks, shrinking idempotency windows, or disabling recovery.

## 10. PRICING, BUDGETS, AND GOVERNED AUTHORITY

Use only the single current, owner-approved pricing truth produced or confirmed by Task #1940. Verify it against the actual Liberty provider accounts/plans and bind it to the deployed release. Never use a provisional estimate, stale August/September artifact, copied constant, or temporary script as production authority.

Normalize or retire any remaining duplicated ceremony logic, temporary pricing repair/resign scripts, and stale signed artifacts if Task #1940 has not already done so. Do not commit a private key or a newly signed production authority artifact to Git.

For each enabled paid provider:

- verify account identity and available balance/credit;
- set an explicit daily and per-occurrence cap;
- set concurrency and rate limits below the provider limit;
- verify the circuit starts closed and can trip on auth, spend, yield, drift, or error thresholds;
- make cap updates auditable and atomic;
- ensure retries/resumes cannot exceed the cap;
- ensure no second control table can contradict the effective provider state.

Never convert a missing approval or unresolved price into a permissive default.

## 11. MIGRATIONS AND DATA SAFETY

Determine the exact current migration head from the post-#1940 journal and update every CRO03/CRO08 authority, discovery, ceremony, and certification check to bind to that head and its hash chain.

Use checked-in migrations only. Do not use `db push`. Prove clean-database replay, production ledger convergence, drift detection, and rollback/roll-forward behavior. Make schema changes additive and backward-compatible for the source-scope contract and census/backfill state.

Do not alter canonical IDs, silently merge ambiguous businesses, overwrite stronger provenance with weaker evidence, or downgrade suppression/consent state.

## 12. RECURRING JOBS TO RESTORE

Restore and verify the repository’s canonical recurring schedules after code/deploy gates pass. At the audited baseline these included:

- free canonical business enrichment cadence fence: every 4 hours;
- CRO03A qualification tick: every 60 seconds;
- CRO03A outbox/recovery: every 2 minutes in production;
- CRO03C live recovery: every 15 minutes in production;
- master-lead stager recovery: every 10 minutes;
- CRO08A scheduler tick: every 10 minutes;
- CRO08A processor tick: every 15 minutes;
- ZeroBounce campaign: daily at the approved `ZEROBOUNCE_AUTO_RUN_CRON` (code default was 06:00 UTC), with `system_settings.zerobounce_auto_run_enabled=true` and an approved daily cap;
- governed freshness refresh according to canonical field/source freshness policy, including the current 90-day free-enrichment rule where applicable.

Reverify current names/cadences rather than blindly introducing duplicates. Enumerate BullMQ repeatables before and after activation, remove only proven stale duplicates using the queue manager’s safe mechanism, and prove one owner per schedule.

Do not create a recurring Source Registry import for DBPR. Do not enable legacy daily outreach/discovery. Do not use a web-process timer as a substitute for durable repeatable jobs.

## 13. OUTBOUND AND SUPPRESSION KILL LINES

All canonical global, email, SMS, and cold-email pause controls must remain paused before, during, and after this task.

The enrichment system may calculate readiness, qualification, score, owner/contact role, and master-lead stage. It may not:

- send an email or SMS;
- make a call or voicemail;
- enroll a record in a GHL workflow or outbound sequence;
- create a promotional campaign intent that can execute;
- bypass DNC, opt-out, suppression, consent, channel-eligibility, or legal-review controls;
- write directly to GHL as a substitute for the canonical outbound boundary.

Add/retain tests proving selected post-enrichment workers cannot produce an outbound side effect while outbound is paused. Run the repository’s non-outreach pilot verification against the deployed release.

## 14. PREFLIGHT VERDICT

Before mutation, produce a machine-readable and human-readable preflight with PASS/BLOCKED for:

- exact clean release SHA and migration head;
- Task #1940 pricing convergence;
- database and Redis health;
- queue profile/allowlist;
- census denominator and exclusions;
- DBPR zero-membership proof;
- source-scope enforcement;
- secrets present/valid, reported only as present/missing/invalid;
- provider contracts, balances, controls, caps, circuits, and transport;
- canonical pauses and suppression service;
- current activation policy and all required operator/data/finance/legal approvals;
- deployment inventory and runtime attestation;
- prior initial-rollout state;
- MI09 pilot lifecycle state;
- current-release CRO08A certification readiness.

No paid provider call or recurring live factory activation is permitted while any required item is BLOCKED.

## 15. TEST AND CERTIFICATION GATES

Discover the canonical package scripts and run all relevant checks. At minimum include current equivalents of:

- typecheck and production build;
- `git diff --check` and repository secret scan;
- migration replay/convergence/drift checks;
- free-enrichment kill-line tests;
- provider-contract and provider-readiness tests;
- CRO03A static, batch-equivalence, geography/policy, auto-wire, and source-registry certification tests;
- CRO03B handoff/static/integration and legacy-writer checks;
- CRO03C static, integration, worker-static, provider-executor, provider-manifest, and initial-continuation tests;
- CRO03D ceremony/discovery static and integration tests;
- CRO08A continuous-factory tests;
- MI06 email-winner tests;
- MI07 pipeline tests;
- MI08 role-guard tests;
- MI09 pilot lifecycle tests;
- ZeroBounce filter and campaign tests;
- provider-denial tests, followed by authorized-live tests only in the gated production phase;
- pilot non-outreach verification;
- pre-deploy checks.

Add focused tests for the newly corrected selective profile, canonical-business backfill, source-scope hash/binding, DBPR rejection at every layer, restart/resume, duplicate repeatables, idempotent provider billing, and suppression propagation.

Do not weaken or delete a safety test to obtain green status. Classify every failure as pre-existing, introduced, environmental, or release-blocking, with evidence.

## 16. DEPLOYMENT AND RELEASE BINDING

Deploy only the tested exact commit. Confirm production reports the same `RELEASE_SHA`, migration head, policy versions, pricing version, provider manifest, and source-scope hash. Do not certify one SHA and run another.

Run read-only operator discovery first. If the release needs a new governed approval/ceremony, use the canonical offline signing workflow with the real authorized signer and current inputs. Never fabricate an issuer, signature, approval, deployment inventory, or runtime heartbeat.

If a prior rollout singleton exists, follow the repository’s legitimate continuation/reconciliation path and preserve its audit history.

## 17. BOUNDED LIVE RAMP WITHIN THIS ONE TASK

Perform the full ramp; do not activate the entire backlog in one unbounded jump.

1. **Free-only proof:** run a small representative, non-DBPR cohort through first-party/RDAP/JSON-LD/web enrichment. Reconcile writes, provenance, dedupe, suppression, and no-outreach proof.
2. **Provider smoke proof:** one or the minimum safe number of eligible records per selected paid provider, with exact request authorization, cost, result, and redacted logs.
3. **MI09 pilot ladder:** complete every required pilot level in canonical order with the existing cohort/budget caps and pass/fail criteria. Do not skip levels or rewrite a failed phase as passed.
4. **Fresh certification:** issue the current-release CRO08A certification only after all pilot levels pass, using the deployed SHA, actual migration head, current pricing, provider controls, source-scope hash, and non-outreach evidence.
5. **Continuous schedules:** enable the four logical factory activities—candidate discovery/enrichment/freshness refresh/backfill—only for the approved non-DBPR source scope and with bounded budgets.
6. **Backlog drain:** enqueue/resume the complete eligible census through checkpoints. Increase concurrency only after healthy yield, error, latency, spend, duplicate, and suppression metrics remain inside policy.
7. **Daily validation:** activate the ZeroBounce recurring campaign for eligible unvalidated contacts under its approved cap.

At every stage, a kill line must stop new provider dispatch on authentication failure, budget exhaustion, unexpected price/cost, high error rate, zero-yield cooldown, DBPR lineage, release/policy drift, missing heartbeat, suppression failure, duplicate surge, or outbound side effect.

## 18. COMPLETION AND RECURRENCE PROOF

Activation is not complete when jobs are merely enqueued. Demonstrate:

- the eligible census denominator is stable and auditable;
- all eligible records are terminal or have an explicit bounded in-flight/retry state;
- checkpoint/restart resumes without duplicates;
- at least two consecutive cycles of each short-cadence recurring job execute successfully;
- the daily ZeroBounce schedule is installed and, if the scheduled time cannot reasonably be observed in-task, execute its canonical bounded manual-equivalent once and prove the repeatable is installed for the next run;
- worker heartbeats remain fresh after a controlled restart/deploy;
- no duplicate repeatables or dual schedule owners exist;
- spend matches authorized attempts and provider balances within expected tolerances;
- DBPR counts remain zero throughout;
- outbound side-effect counts remain zero;
- the UI/API operational views accurately show progress, exclusions, provider state, circuits, budgets, and terminal outcomes.

## 19. REQUIRED METRICS

Report, by source family and in total:

- raw rows scanned;
- canonical identities;
- eligible and excluded counts with exclusion reasons;
- already fresh vs stale/missing fields;
- free-enrichment attempted/succeeded/no-result/failed;
- each paid provider attempted/succeeded/no-result/failed/retried;
- unique contacts discovered;
- emails validated valid/invalid/catch-all/unknown/manual review;
- winner emails selected;
- ready-for-cold-email records;
- suppressed/channel-ineligible records;
- unresolved/manual-review records;
- terminal coverage percentage;
- spend by provider, average cost per successful enrichment, and cap remaining;
- duplicate prevention/reconciliation counts;
- DBPR selected/dispatched/completed counts, each required to be zero;
- outbound sends/enrollments/GHL writes, each required to be zero.

Redact PII and secrets from aggregate reports and logs.

## 20. REQUIRED REPOSITORY ARTIFACTS

Update or add the canonical in-repo operational documentation, keeping one source of truth rather than parallel notes:

1. enrichment activation/runbook with the exact selective profile, schedules, controls, stop conditions, restart, and rollback steps;
2. production activation receipt/report bound to the deployed SHA, migration head, source-scope hash, pricing/policy versions, timestamps, and aggregate metrics;
3. data dictionary/lineage update for the canonical-business backfill and source-scope contract;
4. operator steps for adding/changing a provider without bypassing pricing, approval, pilots, or budget gates.

Do not place secret values, private keys, raw provider payloads, or unredacted PII in these artifacts.

## 21. FINAL DIFF AND PRACTICAL REVIEW

Before production activation and again before finishing:

- review every changed file and migration;
- verify no unrelated feature or UI regression was introduced;
- search for stale profile names, schedule owners, migration heads, pricing constants, temporary ceremony scripts, DBPR wildcard selection, direct provider calls, direct GHL writes, and outbound bypasses;
- verify all provider writes use canonical adapters/contracts and all canonical mutations retain provenance;
- verify error messages/logs are redacted but operationally useful;
- verify no “temporary,” “TODO,” permissive fallback, demo credential, or silent skip remains in an activation-critical path.

## 22. FINAL RESPONSE FORMAT

Return one concise production handoff containing:

1. **Activation status:** ACTIVE, PARTIALLY ACTIVE, or BLOCKED.
2. **Exact release:** starting SHA, deployed SHA, migration head, and environment.
3. **What changed:** code, migrations, controls, schedules, and docs.
4. **Scope:** census denominator, exclusions, and explicit DBPR zero-proof.
5. **Provider readiness:** selected providers, secrets as present/missing only, controls, budgets, circuits, approved pricing versions, and observed spend.
6. **Recurring jobs:** each repeatable’s canonical name, owner, cadence, next run, and latest successful run.
7. **Pipeline results:** terminal coverage and enrichment/email-validation/readiness metrics.
8. **Safety proof:** pauses still active; suppression enforced; zero outbound/GHL side effects.
9. **Verification:** tests/certifications run with pass/fail counts and any pre-existing failures.
10. **Remaining owner action:** only if genuinely blocked, name the exact one action and the exact gate it unlocks. Do not propose a new roadmap or a list of future tasks.

## 23. FINAL ACCEPTANCE CRITERIA

This task is complete only when all of the following are true, or the final response accurately marks the task BLOCKED at a protected owner-only gate:

- the deployed code can run the complete enrichment stack in a selective, non-outreach profile;
- CRO08A schedule definitions enforce immutable non-DBPR source scope end to end;
- eligible canonical businesses missing from CRO03A have an idempotent governed backfill path;
- current migration/pricing/release authority is internally consistent;
- required secrets and provider accounts are verified without disclosure;
- selected provider controls, caps, circuits, transport, and recurring schedules are active;
- free enrichment, paid-provider pilots, current-release certification, continuous factory, and daily email validation have passed;
- the entire eligible existing-database census is processing or terminal under durable checkpoints;
- DBPR involvement is zero;
- cold-email/outbound activity remains paused and zero;
- an exact, reproducible activation receipt and operator runbook exist.

Execute this task now against the post-#1940 current main branch.
