# Liberty Bancard — One Integrated Enrichment Repair and Activation Task

Paste this entire document into one Replit Agent task. This replaces the older September 23 activation prompt and its stale counts, old five-vertical taxonomy, Task #1940 dependency, and pilot-by-pilot stopping points. Treat this as one end-to-end workstream. Do not return another audit-only report, create follow-up tasks, stop after the first defect, or ask me to choose between already-specified options.

## Objective

Make the existing Liberty Bancard CRM continuously produce a growing, deduplicated, evidence-backed pool of high-ROI South Florida businesses and associated contacts, with real discovered and ZeroBounce-validated email results visible in the CRM and flowing into canonical master leads, v2 package-pinned ready-held staging, and idempotent paused sequence enrollments.

Use the existing eligible source pools together: Sunbiz/source registry, canonical businesses and locations, the existing contacts table, prospects/imports, already staged free-discovery candidates, current provider observations, and existing master leads. Resolve each person and business once and preserve lineage. Do not build a parallel CRM or count the same business/contact multiple times.

This task covers enrichment, its control plane, and the no-send handoff into paused enrollment. It does not authorize outbound sends, SMS, calls, GHL workflow changes, or unpausing campaigns/sequences.

## Explicit authorization and non-negotiable limits

I authorize this task to:

- Use Serper, ZeroBounce, Apollo, OpenAI, and Outscraper in a governed production enrichment workflow when a provider is actually useful for a missing field and its credential, contract/account, current price, and adapter are verified.
- Enable the named provider controls for that workflow and make the necessary per-provider limits adjustable in the admin CRM, provided every paid operation remains inside the shared aggregate budget and all provider-local limits.
- Restore the canonical SFP Serper local ceiling to **50,000 units**. The current reported canonical value is 67 with 65 consumed. This is the only existing local ceiling I explicitly authorize increasing. Preserve all consumed/reserved counters, provider history, reservations, and the legacy Serper account-call counter. Fix the old arm-pilot behavior so arming a bounded pilot can never leave a reduced shared cap behind.
- Keep the shared aggregate enrichment paid-spend ceiling at **$50.00** for this task. Make it clearly adjustable by an authorized admin in the CRM for a later decision, but do not increase it, reset it, or erase/reclassify prior spend now.
- Run real production enrichment against real eligible businesses/contacts after the exact release is live, up to the true remaining shared budget. Do not make paid calls in development, against synthetic fixtures, or against a non-production database.

Provider selection must remain evidence-driven and cost-aware. “Use all five providers” means make all five available and route useful work to each where appropriate; it does not mean call all five on every record. Do not invent a price, provider result, contact, email, consent, identity, or validation outcome. If one provider is unavailable because its account, contract, current price, or credential cannot be verified, finish all safe work and all other providers; report that provider-specific blocker without stopping the rest of the pipeline.

Keep the canonical global outbound pause enabled throughout. Keep email, SMS, cold-email, campaign, sequence-send, and GHL send authority paused. After all eligibility checks, the system may create only internal, idempotent **paused** sequence enrollments through the approved CRM flow. No enrollment may be active or send-capable.

## Evidence to reconcile first

The following are observed reports, not permanent truth. Re-query the actual current production system and explain any difference by environment, date, status definition, or ledger source before changing data:

- A recent production report showed about 7,123 free-discovery candidates staged, 2 validation-admitted, 116 frozen-cohort businesses, only 2 paid-discovery evidence rows, zero SFP outreach-eligibility rows, zero SFP staging intents, and zero master leads.
- Other reports used counts around 6,864, 6,951, or 7,123 for staged candidates. These may be different dates or populations. Reconcile the exact denominator and define whether each count is global, canonical, South Florida, v2-target, email-bearing, or eligible.
- The latest reported production controls showed Serper enabled but canonical local ceiling 67 / consumed 65; ZeroBounce enabled with a 50,000-unit ceiling and 684 consumed; OpenAI enabled with a 20,000-unit ceiling and 8,673 consumed; Apollo and Outscraper disabled. Forty-one ZeroBounce-valid results were reported in the general contact lane, not proven to be linked into SFP eligibility.
- A previous report showed the 10-minute validation job running but returning “no cohort with validation work”; staged candidates were not promoted because the free-discovery validation-promotion gate was false. Confirm the current effective gate and its actual producer/consumer.
- The last signed-in Lead Ops page I inspected on 2026-09-29 displayed 59,129 canonical businesses. Its visible rows often showed location as blank and vertical as “Other”. The page showed Sunbiz full backfill idle at cursor 0 / processed 0, while the separate Sunbiz bootstrap action was manual and capped at 25. The UI host contains “dev” in its hostname; do not assume from that text alone whether it is development or production. Prove the environment and database identity before any write or paid call.
- The visible provider UI and the recent provider-control report disagreed about Serper’s ceiling: the UI showed a 50,000 legacy cap while the SFP canonical gate reported 67. Reconcile the effective control sources and make the CRM display the exact effective source, units, consumed/reserved, and dollar spend.
- The $50 dashboard and the SFP spend report have also disagreed (the legacy card showed $0 while another report identified $0.231 in SFP stage/classification spend). Reconcile ledgers. Never treat a zero from one incomplete ledger as proof no money was spent or that the full $50 remains.

Prior repo snapshots and older audit prompts disagree about commit SHAs, counts, queue names, package taxonomy, and provider wiring. Fetch the actual current origin/main and query the live app’s health/release identity. Do not reuse a SHA, count, migration head, or state from a stale local clone. Verify that app, worker, Redis, and database belong to the same intended production release/environment.

## Required execution behavior

1. Audit current origin/main, exact deployed release, migration state, provider controls, durable queues, program configuration, candidate tables, and Lead Ops UI. Read the current code paths and data; do not assume earlier patches are present, correct, or deployed.
2. Build a source-to-stage map that names the actual tables, functions, routes, queue owners, and effective settings for every handoff. Use this map to find every broken link from the sources above through validated email and paused enrollment.
3. Implement every enrichment-scoped repair in this task, with additive migrations only when needed. Reuse the existing canonical models and controls. Do not add another shadow candidate system.
4. Run a meaningful disposable-Postgres end-to-end certification with fake providers, then exact-release verification. Compare failures against the unchanged baseline and fix regressions from this work. Do not spend this task chasing unrelated, longstanding pre-deploy failures unless the diff or evidence ties them to this release.
5. Deploy/publish the exact tested commit if the platform allows it. If the owner must click Publish, finish all code, tests, docs, and readiness work first; state that single exact action only at the end. Once published, continue from the same task to verify production. Do not ask whether to continue.
6. On production, activate the selective, non-outreach enrichment profile and recurring work needed for the full pipeline. Continue useful free work even if one paid provider is paused. A provider-specific failure must not freeze the whole factory.

Do not impose a human-operated canary of 1, 5, 10, or 25 records as the definition of progress. Preserve immutable cohort/evidence snapshots and provider/API request-size limits where required, but make recurring workers drain across successive cohorts and pages automatically. A 10/25-sized API request must be followed by the next eligible request in the same durable drain cycle or the next scheduled cycle; it must not be the total per-tick or total-program ceiling. Drain until eligible work is exhausted or a real safety boundary is reached: remaining shared budget, provider-local cap, provider quota/rate limit, provider circuit, hard processing-time limit, high-error/zero-yield trip, or required authority/health failure. Checkpoint and resume without skips or duplicate billing.

## One canonical South Florida population

Use these current v2 target verticals only:

1. Automotive
2. Healthcare
3. Beauty/Spa
4. Construction/Trades/Home Services
5. Fitness/Recreation

Use the South Florida counties already configured for the active program: Broward FIPS 12011, Miami-Dade FIPS 12086, and Palm Beach FIPS 12099. Verify current program configuration and location evidence. Do not bring back the old v1 set of Med Spa, Dental, Auto Repair, Restaurant, and Retail; do not let old package rows or old classifier evidence admit candidates into v2.

Use a versioned, evidence-backed classifier and geography selector. Deterministic source/website evidence comes first. OpenAI may resolve only bounded ambiguous evidence bundles with structured output and citations to supplied evidence. Keep review_required, conflicting, low-confidence, wrong-geography, and unresolved records out of automatic admission. Exclude DBPR-derived source scope, test/demo/synthetic records, existing customers, duplicates, invalid identities, suppression/DNC/opt-out/complaint/hard-bounce cases, and anything that fails current contactability policy. Recheck exclusions before provider reservation, before eligibility, before staging, and before paused enrollment.

For web/domain acceptance, exact name similarity by itself is not sufficient. Corroborate the candidate site with the business name/services and South Florida geography. Preserve the wrong-site quarantine and discredited-evidence protections created after the Boynton Beach business was incorrectly matched to a New York business. Never reintroduce quarantined domain, phone, or derived emails as valid evidence. Maintain the 24-hour or stricter existing no-result cooldown and do not repay for recent terminal no-result attempts.

Treat record types correctly:

- Canonical business/location is the business identity and geography truth.
- Contact is the person/channel record and should link to its verified canonical business when evidence supports it.
- Prospects/import rows and Sunbiz/provider records are source evidence, not duplicate canonical businesses.
- Master lead is the CRM’s campaign-facing projection of a qualified business/contact, not a substitute for source evidence or a count of raw candidates.

Deduplicate across contacts, canonical businesses, prospects, master leads, source links, and staged candidates. Reuse a fresh, source-linked provider observation when valid under current policy; do not treat an active email status as provider-verified. Do not create orphan contacts or master leads before the transaction can safely complete. Preserve the transactional, idempotent #2029 bridge and its rollback guarantees.

## The pipeline that must actually run

Implement and prove this single connected path. Every candidate must have an auditable disposition at each stage:

Source census and ongoing Sunbiz intake → identity resolution and canonical business/location/contact links → South Florida geography and v2 vertical classification → ROI priority and exclusions → existing CRM/contact/staged-candidate reuse → free enrichment and shared domain crawl → field-specific paid provider waterfall where needed → candidate normalization and winner selection → ZeroBounce validation of the final selected email → suppression/contactability recheck → SFP outreach eligibility → canonical master lead → v2 campaign-package-pinned ready_held intent → authorized review → idempotent internal paused sequence enrollment.

Specific requirements:

- Feed eligible existing contacts and their email/domain evidence into the same canonical South Florida selection, using business_id and deterministic crosswalks where appropriate. Do not ignore the 150k+ existing CRM contact pool; do not bulk-buy validation for the entire pool. Free-filter and match the pool first, rank it, then validate only the winning candidate email for an eligible target business/contact.
- Continue qualifying and materializing eligible South Florida Sunbiz/source additions with durable monotonic cursors and terminal dispositions. Resume eligible backlogs after restart; no silent idle cursor at zero, skipped retryable failure, or one-off manual batch as the only intake path. Do not indiscriminately paid-enrich all 1.9M source records; first scope, deduplicate, classify, and prioritize.
- Use free first-party website/contact-page/structured-data crawling wherever a trustworthy domain exists. Share cached domain evidence across linked business/contact records. Free-enrichment and OpenAI classification must automatically feed the same canonical result model, not stop in isolated queues.
- Wire Serper, Outscraper, OpenAI, Apollo, and ZeroBounce through the same governed operation/accounting boundary for this factory. Reuse existing provider adapters/contracts where correct; build missing SFP integrations where controls alone are currently disconnected from usable adapters.
- Use the least-cost provider that can resolve the specific missing field: free evidence first; OpenAI only for evidence-grounded classification/normalization; Serper for missing, identity-corroborated web/domain evidence; Outscraper for applicable business/location/category evidence when its verified price/yield is better; Apollo only for a high-value unresolved contact/decision-maker need after business identity is established; ZeroBounce only for the selected final email candidate.
- Persist provider, operation, source, timestamp, result, evidence hash, confidence, units, exact price version, reserved/settled/refunded cost, and retry/disposition. Every retry is idempotent and cannot double-charge. A provider no-result does not prevent other valid enrichment work; it gets a cooldown and an explicit terminal/retryable state.
- Verify that ZeroBounce’s SFP validation worker actually claims SFP candidates and writes the SFP run/attempt/eligibility rows. General contacts/validate-emails-batch activity is a separate lane and must not be reported as SFP throughput. Where a current fresh, linked ZeroBounce-valid observation already exists, reuse it without a duplicate charge if policy permits.
- Repair the current validation-promotion gate so qualifying free-discovery candidates can enter the SFP validation lane automatically. It must be an explicit, visible, audited admin control with a truthful effective state; it cannot remain silently false in an environment variable or system setting. The recurring validation job must not merely tick and return “no cohort with validation work” while eligible candidates wait in staged.
- Verify v2 campaign staging recognizes the five current v2 package keys, not obsolete v1 keys. Repair program recurrence and any campaignStaging=0 configuration that prevents eligible rows reaching ready_held. Use package keys/version pins, not a loose campaign-name match.
- The existing ready_held bridge may create only internal paused sequence-enrollment records after all policy gates and the configured admin approval. It must be transaction-safe, auditable, concurrency-safe, and idempotent on replay. It must never activate a sequence, dispatch, send, call, SMS, or write to GHL.

## Provider control, budget, and cost correctness

Make one authoritative effective-control contract for each provider and for the shared SFP/contact enrichment workflow. Clearly distinguish legacy account quota units from provider-local request/credit units and from dollar spend. No page may show a 50,000 legacy Serper cap as if it overrides a canonical SFP ceiling of 67.

- Restore only canonical SFP Serper local budget to 50,000 units, preserving the exact live consumed/reserved values (the last report showed 65 consumed). Make canonical state authoritative for the SFP path and reconcile/label any separate contact Serper control. Remove the arm-pilot cap regression: pilot authorization must use an atomic reservation or scoped allowance and must not overwrite or permanently shrink the recurring worker ceiling.
- Preserve the current shared $50.00 aggregate cap and all prior accounting. No budget reset, counter reset, deletion, ledger relabeling, or bypass. Before further paid work, reconcile spend/reservations across SFP, classification, contact enrichment, MI09/CRO03 paid operations, and legacy provider operations used by this target workflow. Count unsettled reservations and previous paid work correctly.
- The global aggregate budget must be enforced atomically across all named providers and both contact/SFP entry paths, before every paid dispatch and again at settlement. Concurrent workers must not overspend. Provider-local caps and vendor quotas remain additional limits.
- Use the current approved price schedule/account plan, not stale artifacts or hardcoded estimates. If a price is unavailable or contradictory, block that provider’s paid dispatch while continuing free work and providers with verified pricing; do not fabricate a default.
- Show exact per-provider dollars and units: attempted, succeeded, no-result, failed, retried, reserved, settled, remaining local headroom, aggregate committed/reserved/headroom, average cost per accepted business, and cost per fresh valid email. Use integer micros or exact decimal arithmetic.
- Label the scope of the $50 cap accurately (lifetime/window/occurrence from the actual source of truth). Do not call a one-time cap daily. Report both measured daily output and budget-limited sustainable output. Compute a defensible expected business/email throughput from observed provider costs and actual yield; separate capacity from completed results. Do not equate queue ticks or HTTP attempts with unique qualified businesses or verified emails.
- Provide authorized-admin UI controls to change the shared cap later and provider-specific enable/pause/local ceilings without resetting history. Keep this run’s aggregate cap at $50. Every change is permission-checked, confirmed in the UI, atomic, audited, and reflected in workers immediately.

## Continuous processing and restart safety

Use a selective background profile containing only required source intake, free enrichment, SFP classification, provider-live enrichment, email validation, staging, and required recovery workers. Do not use a broad/full profile that starts campaign sends, sequence sends, workflow enrollment, legacy outreach, SMS, voice, or unrelated maintenance.

Make schedules durable and visible. Confirm one owner per repeatable job, correct deployment/release binding, Redis capacity, concurrency, next-run time, fresh heartbeat, last actual completion, queue depth, oldest eligible age, retries, and dead letters. A dashboard timestamp must come from a real worker execution, not scheduled time or an optimistic cache.

Workers must:

- drain eligible work across successive cohorts/pages rather than stop after one small fixed batch;
- recheck pause, budget, provider state, runtime attestation, and suppression between passes;
- persist checkpoints and resume after restart;
- safely reclaim stale or partial work without duplicate provider billing;
- have bounded retries, exponential delay/cooldown, dead-letter reason, and operator replay;
- avoid spin loops when a provider is blocked, an attestation expires, or a cohort is partially processed;
- continue free classification/crawling and other available providers when one paid provider is paused.

Do not mark a queue healthy from a repeatable definition alone. The CRM must distinguish scheduled, waiting, active, blocked, paused, stale heartbeat, failed, retryable, no-result, and completed.

## CRM control center and result visibility

Finish one useful Enrichment Control Center inside Lead Ops. It must make the real workflow operable and auditable without code or a separate Replit console. Do not add display-only controls that fail to affect the worker’s authoritative settings.

The screen must show:

- exact environment, deployed SHA, migration head, active capability profile, and worker ownership;
- source denominators and dispositions from Sunbiz, canonical businesses/locations, contacts, prospects/imports, staged free discoveries, and current master leads;
- funnel counts with mutually exclusive stages/reasons, broken down by date, county, v2 vertical, source family, provider, business, contact, and campaign package;
- source-to-canonical, canonical-to-target, target-to-email-candidate, candidate-to-ZeroBounce, valid-email-to-master-lead, ready-held, approved, and paused-enrollment totals;
- current eligible, staged, queued, in-flight, retryable, blocked, excluded, and terminal counts with oldest age and truthful ETA;
- each provider’s enabled/effective state, control source, credential presence only, circuit, cap units, consumed/reserved, price version, exact dollar spend, success/no-result/failure yield, last real call, and pause reason;
- each queue’s last real heartbeat/completion, next run, waiting/active/delayed/failed counts, retry age, dead-letter count, and backfill cursor;
- record drill-down with canonical business/contact IDs, county/vertical, source lineage, masked candidate email, evidence, validation timestamp/outcome, cost, suppression reason, package key, and final disposition. Never expose plaintext email, provider secrets, or raw sensitive payloads in aggregate screens/logs.

Provide admin-only audited controls for free enrichment, classification/promotion, each provider, validation, source/backfill schedules, SFP program recurrence, staging, and approve-to-paused-enrollment. Make the effective value and the consequence of each control obvious. Show global outbound pause as locked/paused status; this enrichment UI cannot release it. Make Legacy Serper vs canonical SFP Serper distinction impossible to misread.

## v2 packages and no-send campaign handoff

Use only the existing or newly converged package keys for the current v2 verticals: Automotive, Healthcare, Beauty/Spa, Construction/Trades/Home Services, Fitness/Recreation. Audit campaign/sequence status and approval metadata. Do not re-use the old Restaurant/Retail/Med Spa/Dental/Auto Repair v1 mapping. Keep campaigns draft and sequences paused. Do not enroll suppressed, unvalidated, unresolved, duplicate, out-of-area, non-target, or otherwise ineligible records.

For qualifying records, automatically create/refresh the canonical master-lead projection and package-pinned ready-held intent. Expose review and approval in the CRM. After approved, bridge to one internal paused sequence enrollment with the expected business/contact relationship. Replaying any stage must not create duplicates or orphan contacts. The CRM must show which exact stage stopped each record and how an authorized reviewer resolves it.

## Required tests and proof

Run the project’s relevant tests against the exact current release. Add/repair meaningful tests as needed. At minimum prove in disposable Postgres with fake transports:

1. Contact-pool, Sunbiz/source, prospect/import, canonical business, and staged-candidate inputs converge on one deduplicated business/contact identity with source lineage.
2. South Florida county resolution and all five v2 classifier outcomes work; old v1 evidence/packages cannot leak into v2; DBPR, wrong geography, test/demo, quarantine, suppression, and identity conflict are rejected.
3. Free enrichment and OpenAI evidence classification automatically feed the canonical SFP path without inventing facts.
4. The validation-promotion gate admits only policy-qualified rows; the SFP ZeroBounce worker claims the actual candidates, stores attempts/outcomes, and yields exact valid/invalid/catch-all/unknown counts.
5. A fresh existing provider-valid observation is reused only when properly linked and within freshness; otherwise only the selected final candidate is sent to ZeroBounce. An active status alone never counts as valid.
6. Serper/Outscraper/Apollo/OpenAI/ZeroBounce use the correct adapter only for the field it resolves; provider disable, missing key, invalid price, circuit, local cap, shared cap, timeout, no-result cooldown, retry, and settlement paths behave correctly.
7. Concurrent mixed-provider operations cannot exceed the shared $50 cap; failed reservations/settlements do not lose or duplicate units; no counter or historical ledger is reset.
8. Serper pilot arming cannot lower the persistent canonical ceiling or overwrite a concurrent update; the 50,000 restore changes only the authorized ceiling and preserves all counters.
9. Continuous drain processes multiple pages/cohorts, reclaims partial runs, advances cursors without skipping retryable failures, survives worker restart, and does not spin when blocked.
10. End-to-end: eligible source → real-shaped canonical business/contact → selected email → fake ZeroBounce valid → SFP eligibility → master lead → v2 ready-held intent → admin approval → exactly one paused enrollment on replay. Forced failure at every transaction boundary leaves no orphan contact/enrollment/evidence.
11. Global outbound pause remains enforced; zero send, GHL, campaign-dispatch, SMS, or active-enrollment side effects from all enrichment workers and UI actions.
12. CRM API/UI numbers reconcile to the same database snapshot and direct aggregates; stale timestamps cannot say healthy.

Run typecheck, production build, migration replay/convergence, focused SFP/provider/contact/campaign tests, role guards, API coverage, and the relevant deployment gate. Compare failures against the unchanged baseline and fix regressions from this work. Report unrelated historical failures only when they are genuinely required to explain release readiness; do not reopen or spend this task repairing unrelated old baseline noise. Never weaken safety tests to pass.

## Production execution after deployment

After the exact tested release is live, use the authenticated production CRM and production-scoped read/write paths only. Do not use development DB access, raw dev environment variables, synthetic rows, or a browser session on a differently scoped environment as production evidence.

1. Verify environment identity and release SHA for API and worker; verify database/Redis and migration head.
2. Confirm all outbound pauses are on and no sender/sequence dispatcher can start.
3. Reconcile current spend and reserved amounts across all relevant ledgers; confirm the actual remaining portion of the $50 cap before any new paid dispatch.
4. Apply the explicitly authorized Serper 50,000-unit SFP ceiling correction without changing counters. Confirm provider controls, all named provider prices/limits, schedules, and active profile.
5. Enable recurring South Florida intake, classification, free enrichment, governed provider enrichment, final-email ZeroBounce validation, ready-held staging, and paused-enrollment review/bridge. Process the eligible production backlog continuously. Do not stop after a tiny canary or a single cohort.
6. Let each provider and queue run through multiple real work cycles. Monitor measured unique records, terminal outcomes, accepted domains/emails, validator yield, costs, errors, retries, exclusions, and spend. Stop paid dispatch automatically at the actual remaining budget, local limit, quota, or safety threshold while free eligible work continues.
7. Verify that fresh valid emails actually become linked canonical contacts/master leads and v2 ready-held records; prove paused enrollment only where approval is present. If the chain still has zero at any stage, trace the first nonzero-to-zero transition in production, repair it in this same workstream, deploy the fix, and repeat verification while budget remains. Do not report success from a queue heartbeat alone.
8. Re-read outbound pause and send/GHL counters after processing; they must remain paused and zero.

If a true owner-only provider credential, contract/pricing approval, or platform Publish click is required, finish everything independent of it. Give the exact missing item, the exact affected provider/stage, the evidence that proves it is the only blocker, and the single owner action. Do not ask broad questions or stop the other usable providers/free lanes.

## Definition of complete

This is complete only when:

- current production has an exact, verified, version-bound source-to-validated-email funnel using the existing 150k+ contacts and eligible canonical/Sunbiz/source pools;
- eligible SFP businesses are scored, deduplicated, classified into the five current v2 verticals and three counties, and processed continuously with restart-safe cursors;
- free enrichment and every usable named provider feed one canonical evidence and eligibility model automatically;
- the ZeroBounce SFP lane has actual provider attempts and actual outcomes, not only general contact validation ticks;
- real eligible businesses with fresh valid emails flow into linked master leads and v2 ready-held package records, with paused enrollment available only under the reviewed policy;
- the CRM surfaces every relevant source, gate, toggle, schedule, queue, provider cap, exact cost, result, failure, retry, backlog, and terminal disposition truthfully;
- the complete eligible queue drains across successive cohorts without an arbitrary 10/25-record stopping rule, while respecting the unchanged $50 aggregate cap and actual vendor limits;
- measured production daily yield/cost is reported separately from theoretical capacity, and the dashboard makes future budget changes straightforward for an authorized admin;
- outbound remains paused and zero sends/GHL dispatches occur.

## Required final handoff

Return one evidence-backed completion receipt, not another roadmap. Include:

1. Starting/current/deployed SHA, environment identity, migration head, and publish status.
2. The exact first broken handoff found and all repairs made in this integrated workstream.
3. Before/after and current source, dedupe, county, v2-vertical, candidate, validated-email, master-lead, ready-held, and paused-enrollment counts. Reconcile the old 6,864 / 6,951 / 7,123 reports explicitly.
4. For every provider: effective control source, enabled state, verified credential presence (never value), price source/version, cap units, consumed/reserved/headroom, calls by outcome, exact spend, and cost per fresh valid email.
5. Shared aggregate cap scope, prior settled/reserved spend, actual remaining dollars, and proof it stayed at $50 with no reset.
6. Repeatable schedule owner/cadence, last real heartbeat/completion, next run, queue depth, retry/dead-letter state, and restart evidence.
7. Actual daily completed-business and valid-email throughput by source/county/v2 vertical, plus a clearly labeled projection under the current budget.
8. Disposable end-to-end proof and relevant test totals; classify only remaining failures that affect this release.
9. CRM UI routes/tabs/controls delivered and evidence that API, screen, and direct database aggregates reconcile.
10. Safety receipt: wrong-site quarantine intact, DBPR/test/suppression exclusions intact, outbound paused, zero sends/GHL mutations/active enrollments.
11. Any single unavoidable owner action, if one remains; otherwise state clearly that the enrichment factory is running and show production evidence.

Start now. Reconcile existing work, repair the entire connected enrichment path, activate it within the explicit limits above, and finish with this single receipt. Do not turn this back into a sequence of follow-up tasks.
