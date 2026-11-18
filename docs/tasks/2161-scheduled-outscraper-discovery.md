# Task 2161 — audited local implementation contract

This is the complete supplied task, retained below, with the current audit corrections taking precedence over historical notes. User authorization: audit the live CRM/repository, incorporate corrections, implement and verify locally on a separate branch. Production stays read-only; no paid pilot, import, schedule activation, control change, or publication is authorized by this build.

## Current audit and implementation decisions

- Base: origin/main 21b0db48; isolated branch codex/task-2161-scheduled-discovery in /Users/matt/Developer/liberty-2161-clean. Original local setup checkout, untracked setup notes and running preview are preserved.
- Live production read directly through Replit Production Database in read-only mode at 2026-11-18 04:09 UTC: neondb; runtime d34f09fc; one active taxonomy-v2 program f19cd9e4-9978-46f1-9973-df8df22df10a; counties 12011/12086/12099; five contracted verticals; 99,984 canonical businesses; latest creation November 7. Production journal has 318 entries. This does not imply Publish schema parity.
- Controls: Outscraper enabled/closed, consumed 8,268/reserved 96; Serper disabled; outbound paused epoch 4; GHL disabled epoch 16. No new-discovery lane tables exist. Reserved units on completed/released operation rows are historical requested amounts, not outstanding holds: filter billing_state before reporting held totals.
- New tables and a narrow worker capability own definitions, immutable scope/revision-pinned occurrences, content-addressed retained artifacts, lane ownership and coverage. Provider work stays in canonical provider_operations/provider_attempts and current runtime authority. No dummy business, new spend ceiling, monetary approval ceremony or optional paid enrichment.
- Strengthen fencing: a dedicated PostgreSQL session advisory lock spans submission and task-ID persistence, with a durable lane token and pre-I/O marker. A lease timeout alone cannot make a second submit safe. Unknown submissions retain the lane until an explicitly verified reconciliation; no automatic repurchase.
- Every mutation has a strict bounded schema and server-derived actor/program. Program drift blocks new dispatch and materialization but never discards retained artifacts. Recovery can fetch a known task under current provider/runtime controls even when the new-search schedule is off.
- Preview is strictly read-only for business/contact/source/validation state. Its batch overlay uses the same versioned resolver policy. Retained import rechecks scope and identity under the existing writer locks. A scope change holds local import rather than silently widening geography or fabricating evidence.
- Separate artifact content hash, occurrence key, import execution envelope hash and provider ID. Exact submitted payloads/results remain bounded, private source artifacts; no credentials or arbitrary results_location are fetched.
- Extend canonical import receipts atomically with durable business-created/matched facts at the resolver transaction boundary; derive distinct business/contact totals from those facts rather than row-disposition names. Preserve all manual/default-policy semantics and multi-email/source restrictions.
- Unsupported/malformed bodies and HTTP 202 without ID are uncertain submissions, never empty success; HTTP 204 is terminal failure, not pending. Preserve legacy transport endpoint by default; use an explicit versioned modern endpoint for this lane, with both endpoint contracts tested. Keep the 100-result safety bound and label saturation.
- The daily count includes pilot and scheduled actual dispatches. It limits automatic workload only; an explicit pilot does not acquire a new monetary cap. A repeat-window check prevents new keys from buying the same active definition repeatedly.
- Worker/readiness reporting must distinguish selected capability, Redis availability, heartbeat, schedule enabled, provider control and missing runtime authority. Deployment selection remains a release hold, not a reason to change production BACKGROUND_JOB_PROFILE during a local build.
- Mini routing attempted: trusted alias fails DNS resolution; use contained Air resources. No existing Air service is stopped. No new top-level CRM navigation; reuse existing tokens and Imports workspace.

## Final audit corrections incorporated into this contract

- The original Git object store failed a baseline tree read. Preserve it and the original checkout. The implementation uses an independent fresh clone at the same verified base; no reset, force checkout, merge or push is part of recovery. See the consolidated report for exact paths.
- Read-only production aggregate recheck at 2026-11-18 05:30 UTC independently confirms every weekly canonical count from September 14 through November 2, 2,220 Outscraper place links last first-seen October 15, 161,807 Sunbiz links last created October 24, and provider operation dates September 29–October 13. Missing weeks after November 2 have zero canonical creations, as verified with the last-created bound. Outbound is still paused epoch 4; GHL disabled epoch 16. A source import total is not a new-business count.
- Pausing a definition stops new dispatch but does not change the query revision or strand an accepted task. Accepted task-ID recovery must continue even when there is no longer a unique active program; retained materialization remains blocked by program drift. Retry transient poll failures by the same task ID. A 5xx/408 submission without a task ID remains unknown and holds the lane.
- An exact uniquely owned place/source identity stays automatic even when a shared brand has hundreds of weak domain/name candidates. Use bounded indexed retrieval for weak identities and hold overflow. Do not treat a truncated candidate list as a unique match.
- Browser acceptance must include the CRM's mobile desktop-layout handoff. The shared employee sheet imposes a 288px phone width, so this workflow opts into a full-width detail drawer without changing other sheets.
- Two existing certification fixtures fail identically on untouched base: the paid-waterfall mocks omit current employer/location evidence, and the validation gate requires retired routine fleet-certificate refresh. Update the former fixture to current pinned Maps/employer-scoped Apollo responses; replace the latter with current staged crawl/materialization/preparation, actual validation-intent recovery, actual BullMQ worker/default adapter and receipt assertions. Keep retired refresh and broad automatic validation contained. The report records the changed gate scope explicitly.
- The historical five private XLSX workbooks and their 2,914-row recovery manifest are absent locally. Do not invent those historical fixtures or report that gate passed. Add portable actual CSV/XLSX/Apollo/custom compatibility tests; retain the missing historical gate as a documented release blocker.
- Record full typecheck results against untouched base. At this base there are 41 identical diagnostics. Passing task checks/builds do not turn the global typecheck or full release roster green.
- The local test launcher must use canonical physical Postgres paths on macOS while preserving the existing strict private-infrastructure guards. Register task suites in both required rosters and resolve exact mandatory entries before fixture fallback; duplicate entries within a roster must still fail.

## Execution and gates

Implement the original Steps 0–13 and all Done looks like requirements. T01–T15 below remain acceptance requirements; record actual executed evidence, failures and unexecuted assertions separately. Required existing suite failures must be compared on unchanged base before attribution. Retain all original V01–V16/F01–F14 and census requirements. No passing mocks or source scans substitute for durable database/restart/browser proof.

Engineering completion, release readiness, deployed schema/profile, real paid pilot, production import, scheduler activation and selected-recipient validation are distinct dispositions. Production-only actions remain unexecuted under this local assignment.

## Supplied task and historical evidence (complete)

2161 - Scheduled Outscraper Business Discovery
What & Why
Add recurring, in-scope discovery of businesses not already present in Liberty. Run versioned vertical/area Maps searches using the existing Outscraper transport and governed provider operation accounting. Retain results and feed accepted live runs through the existing canonical provider-import service and import history.
Current SFP enrichment searches are primarily business-specific; this new source needs a real search-run operation subject before a business exists. Verify the historical growth narrative from distinct business/source data rather than assuming the visible contact-import totals establish it.
Serper stays off. Outbound and existing sync/provider controls remain as currently configured. No new spend caps, paid-approval ceremonies or optional paid enrichment add-ons.
Verified premise (production, read-only queries, re-run 2026-11-17): canonical business creation fell from about 6,500 per week in the weeks of Oct 12 and Oct 19 (6,566 and 6,514) to 11 and 3 in the weeks of Oct 26 and Nov 2 (weeks start Monday, New York time; the earlier weeks of Sept 14, Sept 21, Sept 28 and Oct 5 were 6,008, 27,299, 52,501 and 1,082). The first planning pass wrote 7 and 3 for the last two weeks; the re-run gives 11 and 3. Daily creation was 160 on Oct 24, 43 on Oct 25 and 7 on Oct 26, then 1 to 3 a day through Nov 8. The last Outscraper source link was first seen Oct 15 (2,220 Outscraper place links in total; use first-seen time, because the link rows' last-confirmed time is still touched later) and the last Sunbiz source link was created Oct 24 (161,807 Sunbiz links). The six completed imports (4,386 processed rows) ran Sept 9 (1,472 rows) and Oct 14 (five files). Outscraper provider operations in production ran only Sept 29 to Oct 13. State these dated figures instead of the original draft's "only manual uploads worked since late October" wording, and re-verify them from distinct business and source data when building. Re-run 2026-11-18: the weeks of Nov 9 and Nov 16 (so far) have 0 canonical creations, and the last canonical business was created 2026-11-07 20:30 UTC; the earlier weekly figures are unchanged.
How this plan is organized. The corrected contract (audit Appendix A) is reproduced verbatim: its "What and why" is this section, its "Done looks like" and "Out of scope" are the sections below, and its numbered sections 1 to 13 are the Steps. Under each step, a Preflight check block records what this planning pass verified against the current code, mocked provider responses and the production database, plus the additional requirements it found. The complete audit (its sections 1 to 27) follows the Steps verbatim as the "Preflight audit contract", then the verdicts for every audit claim and finding, then the relevant files. Where a Preflight check conflicts with the audit text, the Preflight check wins because it was re-verified against current code. Nothing from the audit has been dropped.
Done looks like
Admins see active-program vertical/area definitions, due/covered/paused state, actual worker/provider readiness, result saturation, retained preview/import history, distinct new/matched businesses, held/invalid/out-of-scope rows, contact outcomes and honest cost estimates/unknowns.
An admin can run one explicit paid preview for one definition. It persists request/result/accounting evidence but creates no businesses, contacts, source-link materialization, crawler jobs or validation work.
Preview results can later be imported from the retained artifact, without a second paid search. Normal scheduled runs import automatically through the shared canonical path.
New schedules default off. An admin sets/enables the daily new-search dispatch count, repeat window and timezone. These are workload/scheduling settings, not spend caps.
One new Maps search is in flight across this discovery lane’s workers/replicas/admin pilots at a time. Pending requests resume by ID; uncertain submissions are reconciled rather than purchased again.
Business matching favors practical automatic matches under the policy below, with review only for real conflicts/ambiguities.
Manual CSV/XLSX behavior, source evidence, suppression and existing import recovery remain unchanged by default.
Results enter existing free crawling and selected-recipient validation through their actual owners. Evidence distinguishes eligible, queued, processed, no-email, blocked and validated outcomes.
Admin controls, current CRM navigation, migrations, CI/pre-deploy registration, restart/concurrency tests and release/rollback evidence are delivered together.
Out of scope
No Serper or rejected-website reconsideration, new provider, optional paid service, restaurant/retail/outside-program discovery, global matching rewrite, bulk merge/reclassification, manual upload behavior change, broad ZeroBounce auto-run, validation-rule change, outbound unpause or historical ledger rewrite.
A versioned relaxed policy for this new discovery source and a shared provider-processor extraction are in scope. Preserve the existing default for manual imports.
Running a real paid pilot, importing, or enabling the schedule in production. Each is a separate explicit admin action after release, and none is part of the build.
Steps
The thirteen numbered sections of the corrected contract (audit Appendix A) are the steps, reproduced verbatim, preceded by step 0 (baseline recapture). Step 12 (Out of scope) is the Out of scope section above. Each step is followed by its Preflight check.
0. Baseline recapture and requirement ledger (audit sections 5, 17, 23)
Before editing, record the current HEAD, working-tree state, applied versus source migration head, concurrent reservations, and overlapping work in the imports route file, schema and journal, queue registry and profile, provider operations, organization policy, validation, and the CI and pre-deploy manifests. Number the Done looks like items 1 to 9 and the tests T01 to T15 (step 11) and cite those IDs in the final evidence. Do not start a competing implementation or a follow-up task for any known work here.
Preflight check: Re-audited 2026-11-17. HEAD is 361886eb (equal to origin main, clean working tree). It is 18 commits past the audit's pinned main c3a8277 and 8 commits past the first planning pass's HEAD 49b5f39a; both are ancestors. The production serving build is cce9ba00 (published 2026-11-17 18:44Z). None of those commits touched Outscraper, provider-operation, import-processor, resolver, queue or Lead Ops code: the 8 newest are partner-program and public-page work, and the first 10 included a change to the imports route file that retired the affiliate signup handler. They did change shared files this task will also edit, so treat these as collision-prone and re-read them at build time: client/src/App.tsx, migrations/meta/_journal.json, scripts/ci-suite-manifest.ts, scripts/pre-deploy.ts and shared/schema.ts. The journal has 390 entries ending at idx 389, tag 0386_partner_introduction_checks_validated, maximum when 1800400330000, so the next free migration number was 0387 on 2026-11-17 (it is now 0388; see the 2026-11-18 re-audit below); re-check it at build because other work keeps adding entries. No active or pending project task touches this area (searched 2026-11-17; this draft is the only one). Verified this pass at HEAD, read-only: the production control row (96 reserved / 8,268 consumed units), program row, business and source-link counts, migration ledger and validation-intent table; and scripts/check-migration-integrity.ts, scripts/scan-paid-provider-adapters.ts, scripts/test-sfp-provider-contracts.tsand scripts/test-cro03c-provider-manifest-coverage.ts all pass. Still not verified: the Replit worktree state, a full pre-deploy run, vendor invoices, the GHL epoch, the deployed background profile and the value of the FREE_DISCOVERY_VALIDATION_PROMOTION_ENABLED secret (deliberately not viewed).
Re-audit 2026-11-18 (supersedes the HEAD, serving build and migration figures above):HEAD and origin main are 21b0db48 (the "Published your App" commit). It changes no files over d34f09fc, which differs from cc82b7f0 only in two memory docs; the working tree is clean. 361886eb is an ancestor, 9 commits earlier. None of those 9 commits touches Outscraper, provider-operation, import-processor, resolver, queue or Lead Ops code: they are Phase 7 conversion experiments, SendGrid feedback, sequence and email send-path work, and public-audit certification. They did change shared files this task will also edit: migrations/meta/_journal.json, scripts/ci-suite-manifest.ts, scripts/pre-deploy.ts, shared/schema.ts, server/native-objects/reconciler.ts, server/index.tsand server/storage/automation.ts; re-read all of them at build time (client/src/App.tsxhas not changed since 361886eb). The production serving build is now d34f09fc(selected 2026-11-18 03:24:58Z by the publish handoff; the runtime owner is on the same SHA). The journal has 391 entries ending at idx 390, tag 0387_phase7_conversion_integrity, maximum when 1800400330001, so the next free migration number is 0388 and a new entry's when must exceed 1800400330001; re-check it at build because other work keeps adding entries. Production's migration ledger is still 318 entries ending at 0308; the five Phase 7 tables now exist in production through Publish, not through the ledger. Still true in production (read-only, 2026-11-18): outbound paused at epoch 4, GHL sync control epoch 16 with enabled false, the Outscraper control row (96 reserved, 8,268 consumed, last completed 2026-10-13), 2,220 Outscraper source links (last first seen Oct 15), and no canonical business created after 2026-11-07 20:30 UTC. No project task is pending, in progress or queued, and none has been created since 2026-11-17 23:00Z.
1. Definition scope queries and coverage
Seed definitions from the actual active sfp_programs id, county_fips, vertical_ids and taxonomy_version. Current v2 categories are Automotive, Healthcare, Beauty/Spa, Construction/Trades/Home Services and Fitness/Recreation. Current program guidance names Broward, Miami-Dade and Palm Beach; use the actual configured FIPS values.
Map each program category to versioned useful search terms. Do not use an unhelpful broad label as the only query, and do not reintroduce Restaurants/Retail or legacy statewide example cities. Subcategory/ZIP/city slices remain within the parent program scope.
Persist query text, area type/key, parent county, language/region, explicit resultLimit, endpoint/decoder version and definition revision. The current transport accepts 1–100 results, default five; never accidentally use that default for a county search. If a completed run reaches the configured limit, label it saturated/incomplete and support narrower area slices. A county query is discovery coverage, not a census of all businesses.
Resolve returned location/category from actual evidence with existing geography/taxonomy owners. Do not stamp a query’s county/vertical onto every result as verified truth. Out-of-scope and unresolved rows stay visible with accurate reasons.
Manual “covered” records require definition revision, covered area, covered-through time, actor and optional source/import reference. They suppress only the stated scope/window, not every child area. They do not create an import or fake $0 provider cost.
Preflight check and additions:
Production has exactly one active program row: taxonomy version 2, counties 12011, 12086 and 12099, and the five verticals above. The development database has two active programs (a version 1 dental program and the version 2 program), so select taxonomy_version 2 explicitly and fail closed with a visible reason on zero or more than one match. No migration inserts a program row; read it at runtime. The program table has no timezone column.
Starting search terms to validate against the existing vertical classifier (not fixed truth): Automotive (auto repair shop, auto body shop, tire shop, car dealer); Healthcare (dentist, chiropractor, medical clinic, physical therapist); Beauty/Spa (hair salon, nail salon, barber shop, day spa); Construction/Trades/Home Services (plumber, electrician, HVAC contractor, roofing contractor, landscaping service); Fitness/Recreation (gym, yoga studio, martial arts school, personal trainer).
Verified by execution: the transport sends limit=5 by default and rejects a limit above 100 with OUTSCRAPER_INPUT_INVALID. The vendor's documented current endpoint allows up to 500 results per query. Raising the local cap is a versioned transport change inside the approved adapter and is not required for this task; split dense areas into narrower slices instead.
County resolution exists only in TypeScript (resolveGeographyFromCandidates), not in SQL. Resolve returned rows through that owner.
2. Durable search runs and pre-business provider authority
Use durable definitions and runs plus the canonical provider_operations/provider_attempts accounting. Extend the existing operation owner with an explicit search-run subject and program/query/run revision authority. No dummy business, no use of businessId=0 and no calling business-pinned reserve functions with fabricated lineage.
Each occurrence pins program/query/matching/mapper versions and has one durable dispatch identity. Persist state such as queued, dispatching, submitted, pending, results_retained, preview_ready, importing, completed, failed, submission_unknown, expired and cancelled. Names may follow existing conventions; meanings and transitions must be explicit.
Record provider task ID, original operation/attempt, runtime owner/lease, dispatch time, last confirmed pending time, next poll, retention bound, artifact hash/reference and unique import execution relationship. Enforce identity and lane concurrency in the database, not only BullMQ concurrency or a process-local boolean.
Honor provider enabled/circuit/credential/runtime controls, caller admission and final pre-I/O checks. Preserve accounting and unknown-price visibility without adding a new spend ceiling or pricing-approval gate.
Preflight check and additions:
Verified: reserveSfpProviderOperationand reservePreCohortSfpProviderOperation both require a business ID and write the operation target as business:<id>. The dispatch boundary (markSfpProviderOperationDispatchBoundary) has only a stage-item branch and a classification-run branch. sfp_provider_retrieval_tasks requires stage run, cohort run and business on every row. So a new subject, its own reserve step, a new dispatch branch and new tables are required.
Audit finding F02 is partly true. The existing boundary already writes a durable pre-I/O marker (the attempt is recorded as ambiguous with a dispatch time before the transport runs), and a dispatched operation with no result stays ambiguous and is never auto-released; only expired pre-dispatch holds are released. The missing pieces are the search-run subject, the lost-task-ID classification (submission_unknown, which does not exist in the code today) and the admin reconcile action. Reuse the existing marker; do not rebuild it.
provider_operations has a unique (provider, idempotency_key), so one idempotency key per occurrence maps onto it. It has no CHECK on purpose or target format, so a new purpose and target value need no constraint change.
The existing adapter executeSfpOutscraperDiscovery asserts provider activation internally and is already admitted. Route the new request through that adapter inside the durable dispatch boundary; never set explicitPaidApproval in new code. Today the manifest's approved Outscraper callers are live-provider-executors, sfp-live-provider-adapters, sfp-provider-operations and sfp-paid-waterfall. Update the manifest, scripts/scan-paid-provider-adapters.ts and scripts/test-cro03c-provider-manifest-coverage.tstogether.
Migration: the journal has 391 entries (see step 0). Production's migration ledger has 318 entries ending at tag 0308 (re-confirmed 2026-11-18, unchanged) because Publish reconciles production schema, so never derive the next number from production and never replay the development journal at production startup. scripts/check-migration-integrity.ts checks SQL/journal parity; there is no allocate-next guard. Use raw SQL for partial-index conflict handling, and the native-object reconciler for any function or trigger.
Reuse generic lifecycle pieces only. The retrieval task's state, lease, retention and poll scheduling pattern is a good model for the new run table.
Also verified: provider_operations has a second unique index on (provider, provider_request_id) and a dispatch-receipt CHECK contract, so a provider request ID can be attached to only one operation and the new subject must satisfy that receipt contract.
3. Async transport expiry and recovery
Use performOutscraperSearch with async=true and performOutscraperTaskResults with the validated opaque ID. The existing transport uses /maps/search; current vendor docs label that endpoint deprecated and document /google-maps-search. Verify compatibility/response fixtures. Any endpoint change must be narrow, versioned, inside the approved adapter and regression-tested for current callers; deprecation alone is not proof current calls fail.
Persist the operation/attempt/dispatch marker before I/O. If a provider acceptance may have occurred but the ID is lost, set submission_unknown and stop automatic resubmission of that occurrence. Provide a scoped admin reconciliation action to attach a verified task ID/result or record a proven non-dispatch outcome. A local idempotency key does not prove the vendor deduplicates paid submissions.
Poll pending requests frequently enough to retain results before expiration. Vendor documentation describes four-hour result availability after completion; do not confuse a local 24-hour submission deadline with result retention. Reuse the existing conservative retention helpers where applicable, and define expired/lost-result evidence explicitly.
Do not run processSfpOutscraperRetrievalTask wholesale: its single-business filtering and optional paid Leads & Contacts stage are not this source. Extract/reuse generic lifecycle primitives while the new run imports all applicable results. Fetch through fixed provider endpoints, not arbitrary results_location URLs. Recognize successful zero-result responses explicitly; an unsupported/malformed body, HTTP 202 with no usable ID, or non-JSON HTTP 200 is not proof of a completed empty search.
Schedule disable stops new submissions but lets already-dispatched work drain under existing provider controls. Provider off/emergency stop blocks I/O according to the real control. Expiry, lost response and import retry never silently create a new paid search.
Preflight check and additions:
Verified by running the real transport with an injected fetch (no network): (a) an async submit answered with HTTP 202 and no task ID, or HTTP 200 with a non-JSON body, returns ok: true, no task, and billing of exact quantity "0", a false completed-empty zero-cost result; (b) a result poll answered with HTTP 204 (the vendor's documented finished-with-failure response) or with a non-JSON 200 is classified pending, so a failed search looks pending until it expires; (c) when only google_id is present, the normalized placeId becomes the google_id value. Fix these narrowly in the approved transport path with regression coverage for the existing SFP waterfall callers (scripts/test-sfp-paid-waterfall-apollo-outscraper.ts, scripts/test-sfp-provider-contracts.ts).
Vendor documentation read 2026-11-16 and re-read 2026-11-17 (unchanged): /maps/search is labeled "Google Places (deprecated)"; the documented endpoint is GET /google-maps-search. An async submit returns {id, status:"Pending", results_location}; a finished request returns HTTP 200 with status:"Success"and data:[[...]]; HTTP 204 with status:"Failure" means finished with failure. Results stay available 4 hours.
Retention: deriveOutscraperResultRetentionBound in server/services/sdr/sfp-provider-contracts.ts already encodes the 4-hour result bound and the 24-hour submission deadline. Reuse it.
Never fetch an arbitrary results_location; use only the fixed request-results path with the validated opaque ID.
Re-checked 2026-11-17 at HEAD 361886eband again 2026-11-18 at 21b0db48 (no diff to server/services/sdr/outscraper.ts): the transport is unchanged since planning (performOutscraperSearch, performOutscraperTaskResults and parseOutscraperResult in server/services/sdr/outscraper.ts; placeId is place_id || google_id), so the three defects above are still present. The vendor documents GET /google-maps-search with a limit of up to 500 per query, an async default of true, and a POST variant for larger payloads; the code still sends GET /maps/search.
Production still holds unfinished Outscraper operations from the old waterfall: 2 discovery and 10 poll operations in running/reserved state (created Oct 2 to Oct 9) plus 44 failed discovery operations whose billing state is ambiguous. Together they hold exactly the 96 reserved units on the production control row (82 + 4 + 10). The new run table must not inherit, clear or double count them; report them separately from the scheduled lane's accounting and do not release them as a side effect.
4. Practical automatic matching as requested
Implement a versioned discovery policy within organization-resolution-policy.ts/organization-resolver.ts, used identically by preview, import and recovery. Keep the existing manual-upload policy as the default. Pass the discovery policy version through immutable import metadata to the canonical materializer; do not fork a second resolver.
Evidence	Discovery action
Exact stable place/source ID belongs to one existing business	Match automatically despite a cosmetic/new display name, missing secondary fields or changed weak metadata
Unique normalized domain with no explicit different-location or ownership conflict	Match automatically; all fields need not be equal
Unique normalized phone with no explicit contradictory branch/owned-ID evidence	Match automatically
Unique normalized business name plus a specific compatible address/locality	Match automatically without requiring every other field
No known match, but usable provider/location identity exists	Create a new canonical business
Clearly identified different branch with distinct place/location evidence	Create/retain the distinct branch; sharing a brand domain is not a merge
Two strong identifiers resolve to different existing businesses, or several candidates remain genuinely indistinguishable	Hold for review with candidates/reason
Name alone without usable identity/location	Retain as unresolved; do not attach to an arbitrary business
Normalize case, punctuation, phone formatting and ordinary legal suffix/display-name differences. Do not introduce a configurable fuzzy-match slider or a manual approval requirement for ordinary matches.
Matching attaches source evidence and records why it matched; it does not overwrite existing verified core fields, merge businesses, transfer another contact’s affiliation or lift suppression. Real contact/business relationship conflicts retain their own authority.
Preflight check and additions:
Executed against the real pure policy: all seven audit cases reproduce (same place and location with a name that gains LLC defers; same domain and location with a changed name defers; same phone matches; a precisely identified different branch creates; a new business with a phone creates; name plus city and state only defers; exact compatible source evidence matches). Two extra probes: an exact place ID with only a legal-suffix change and no address defers, and a domain match with a different city defers. Re-run 2026-11-17 at HEAD 361886eb against the unchanged policy file: all nine outcomes are identical (the name-plus-city-and-state case defers with INSUFFICIENT_ORGANIZATION_EVIDENCE when there is no candidate to compare).
There is no policy-version parameter in decideOrganizationIdentity or the resolver today. About 14 service files call resolveOrganization, so the optional discovery-policy input must leave every existing caller's result unchanged; prove it with a default-policy characterization test plus the existing certifications.
An immutable suffix-insensitive name key already exists: crm_identity_name()(strips inc, llc, ltd, corp, co and similar), with an expression index in production on the businesses table for canonical-class rows (canonical_link_business_name_lookup_idx on crm_identity_name(canonical_name); despite its name it indexes businesses, not links). Use it for relaxed name retrieval instead of adding a second normalizer. Production also has indexes on normalized name plus city and state, website domain, Google place ID and main phone. Correction: the indexes named businesses_domain_unique_nonempty_uidx and businesses_place_unique_nonempty_uidx are plain partial btree indexes, not unique (indisunique is false in production and development), so they speed lookups but do not stop two businesses sharing a domain or place ID; the new path needs its own serialization and duplicate detection.
Measure candidate lookup on a synthetic population of about 100,000 canonical businesses (production has 99,984) and show the retrieval plan for every relaxed lookup.
5. Retained artifact shared import and accurate counts
Retain a deterministic normalized source artifact before materialization, including necessary original API fields, true ID namespaces, all supported email/contact evidence and immutable mapper version. Convert site/full_address/postal_code/type fields intentionally. Do not use the normalized placeId fallback to relabel google_id as a true place_id.
Keep separate:
Stable provider account/task/run identity.
Actual retained content hash.
Mapper/matching version and import execution key.
Canonical business/source identity.
Bind one request/artifact to one import execution with database uniqueness. Preserve manual file-content hash semantics. If reusing claimCsvExecution, use a deterministic retained synthetic artifact/envelope and metadata rather than pretending an arbitrary request ID is the original upload’s content hash.
Consolidate provider processing through processPersistedCsvImport/materializeCanonicalProviderImportRow and the current row ledger. It must work at worker cold start before any HTTP upload. Refactor the provider path narrowly; characterize and preserve manual CSV/XLSX/Apollo/custom behavior, receipt semantics, multi-email handling and restart recovery.
Use explicit trusted google_maps_outscraper source format for API-derived rows; do not depend on header auto-detection accidentally selecting it. Existing manual source detection remains unchanged.
Track distinct new/matched business outcomes at the resolver/commit boundary, contact outcomes separately, raw result rows, intra-result duplicates, held/invalid/out-of-scope rows and unfinished work. A matched business can add a new contact; a new business can have zero or several emails. Recompute totals from durable outcomes so replay cannot increment them twice.
History remains in the existing import view with a truthful “scheduled discovery”/provider-task source link, not a fictitious human file upload or delivered email.
Handle valid zero-result searches without manufacturing a placeholder row or sending them through the manual uploader’s empty-file rejection. Produce an explicit completed/no-result search receipt and a compatible zero-row history projection where the existing import model supports it.
Preflight check and additions:
Verified: the legacy column mapper (mapProviderCsvRow) keeps only company name, phone, vertical, zip, city, state, rating and review count from an API-shaped row. It drops site, full_address, emails, subtypes, place_id and google_id from the mapped fields. The canonical importer takes the website and street address from that mapped projection and the place ID from the raw row (place_id, google_place_id or placeid), so API-shaped rows would create businesses with no website (the free crawler requires one) and no street address. Convert the API fields into the importer's column names, or extend the shared projection only as a versioned, characterized change that cannot alter manual-upload results.
Header auto-detection requires name plus at least two of telephone, category, rating, review_count, reviews and keyword, so an API row set with no ratings can be misread as a custom file. Use the explicit trusted google_maps_outscraper format.
Import execution identity today is csv_contact:<fileHash>; the execution metadata is a JSON column that can carry the matching-policy version. Row-ledger counts are dispositions (created, matched_noop, deferred), not distinct business versus contact outcomes.
Cold start: registerPersistedCsvProcessor is called inside the upload handler in server/routes/imports.ts, while the comment in csv-import-processor.tssays it happens while routes are built, so fix that comment. Without registration the fallback recoverPersistedCsvImporthands provider formats to recoverProviderCsvImport. Startup recovery runs from server/index.ts and from server/services/queue-manager.ts, both calling resumeExpiredCsvImports, and canonical-import-recovery-worker.tscalls the provider materializer directly. The upload route rejects a file whose parsed record count is zero, so a valid zero-result search needs its own receipt path.
Mapper probe re-run 2026-11-17 (mapProviderCsvRow in server/services/provider-import-columns.ts, unchanged through 21b0db48): for an API-shaped row it keeps only company name, phone, zip (from the postal code), city, state, vertical (from type), industry (from category) and rating and review count only when they are strings. It drops site, full_address, emails, subtypes, place_id and google_id. The canonical importer (canonical-provider-import.ts) reads the place ID from the raw row (place_id, google_place_id or placeid) but takes website and address from the mapped row, so an API row loses its website and street address unless the new path maps them explicitly. classifyCsvSourceFormat in import-normalizer.ts labels a row google_maps_outscraper only when it has a name plus at least two of telephone, category, rating, review_count, reviews and keyword, so do not rely on header sniffing for API-shaped rows; set the source format explicitly.
6. Paid pilot read-only preview and retained import
Pilot uses the real declared Maps search and normal provider accounting, but only read-only matching/normalization after retaining results. Use/extend peekOrganizationResolution and the same versioned decision policy, with intra-result deduplication/preview overlay.
It must not call the materializing importer and roll back afterward, because that can trigger independent writes or queued work. Assert zero business/contact/source-link/materialization/validation changes; discovery run/artifact/operation/audit records are allowed.
Display counts as “would create,” “would match” and “needs review,” with preview time/policy version and cost certainty. Database state can change before import; re-resolve safely at commit and explain resulting count changes.
Provide “Import retained results” as an admin local-data action. Do not require another paid approval/pilot purchase. A retained pilot is not automatically labelled imported or universally covered.
Preflight check and additions:
peekOrganizationResolution is read-only but has no intra-batch overlay and has one caller today (the Sunbiz bootstrap). Add the overlay so duplicates inside one result set count once, using the same versioned decision policy as import.
Do not call the materializing importer and roll back. Assert zero changes to businesses, contacts, source links, materialization, crawler work and validation work, while discovery run, artifact, operation and audit records are allowed.
7. Scheduler due dates and failure policy
Default disabled. Store daily dispatch count, IANA timezone, repeat interval, per-definition enabled/paused state and next due. The South Florida daily boundary should be explicit; use America/New_York as the documented task default unless the existing program has a different authoritative timezone.
Never-run/oldest completed or explicitly covered searches are selected fairly, with bounded retry/backoff so one failing definition cannot starve the roster. Persist last attempted, last successful provider retrieval, last import completion and manual coverage separately.
Count new paid search dispatches atomically on the chosen day; retries known not dispatched, polling, importing and artifact reuse are not new searches. Unknown post-dispatch attempts occupy their occurrence and cannot be repurchased automatically. Define whether admin pilots count toward the displayed daily work count and show it clearly.
Register one owned BullMQ schedule and recovery owner in queue-manager.ts, queue-names.ts and background-profile.ts, using a narrow selected capability. Ensure actual production profile, repeatable job, worker heartbeat and pending-request recovery are observable. Do not enable unrelated queues or use a broad “full” profile.
Provider failures stop the current new-dispatch pass, record a clear reason and follow existing provider circuit/backoff behavior. Preserve/result-recover already accepted work; no global provider reset or automatic duplicate purchase.
Preflight check and additions:
The program has no timezone, so the default is America/New_York. Store the IANA timezone on the schedule.
WORKER_CAPABILITY_GROUPS in server/services/background-profile.ts (selected by BACKGROUND_JOB_PROFILE) has no narrow group that fits; sfp-continuous-discovery is a different blast radius. Add a new narrow group, cover it in scripts/test-background-profile.ts, and verify it is selected in the deployed profile.
The existing durable lock helper (acquireJobLock in server/services/job-registry.ts) is keyed by job name and returns a lock token. Release and health writes are token-gated, a heartbeat (renewJobLock) keeps a live lease, and a lease whose heartbeat lapses beyond the stale TTL (default 20 minutes) can be taken over. That fences the lock's own bookkeeping but not an in-flight provider submit by a holder that has lost its lease, and it is a per-job-name lock rather than a per-lane claim. Use a database-backed lane claim with a fencing token held across submit and persist of the task ID, and check it inside the dispatch boundary.
Daily count policy to display: scheduled and pilot dispatches both count toward the day's total, scheduled passes stop at the configured count, and an explicit admin pilot is never refused because of it.
8. Current crawler and ZeroBounce handoff
The acceptance path is:
Canonical in-scope business with a usable website becomes eligible for the existing free-enrichment lane under its normal predicates.
runFreeBusinessEnrichmentForBusiness writes existing CRO-03/first-party email evidence.
runStagedEmailMaterialization links/materializes appropriate contacts through existing authorities.
Canonical recipient preparation creates current selected-recipient preparation/validation work.
recoverValidationIntents/enqueueValidationIntent place current work on QUEUE_NAMES.ZEROBOUNCE_BATCH (“zerobounce-batch-validate”) as a “validation-intent” job.
processValidationIntent owns the provider execution; canonical-address-validation owns shared claim/receipt reuse and current selection is rechecked before spend.
processSfpContinuousValidationTick recovers the selected queue; it no longer directly buys validation for old frozen cohorts. processBusinessValidationIntent is a compatibility delegate to selected-address validation. The broad daily runZeroBounceAutoRun remains contained, and processLegacyCohortValidationTick remains unscheduled.
Do not enable zerobounce_auto_run_enabled or remove ZB_UNATTENDED_BROAD_AUTO_RUN_CONTAINED. Do not automatically invoke Outscraper’s email-validator add-on or rewrite ZeroBounce rules. Verify selected provider/worker/readiness and report actual blockers separately. A staged/queued/98-pending status is not proof of a completed validation.
No-site/no-email/out-of-scope/restricted records show their real outcome; they do not manufacture contacts or permission. Existing customer/suppression, recipient selection and no-send boundaries remain.
Preflight check and additions:
Verified free-enrichment eligibility: a canonical business with a website domain, not DBPR lineage; the lane has no vertical or geography predicate (runFreeBusinessEnrichmentForBusiness in server/services/queue-manager.ts). Staged-email materialization is runStagedEmailMaterialization.
prepareCanonicalRecipient requires a verified contact-business link, a resolved eligible geography, and a program and sequence binding, and records outboundAuthorized: false.
enqueueValidationIntent, recoverValidationIntents and processValidationIntent are in server/services/provider-readiness-control.ts; the queue is QUEUE_NAMES.ZEROBOUNCE_BATCH("zerobounce-batch-validate"). The continuous-validation tick recovers intents only when isSfpValidationPromotionEnabled() is true (a system setting override, otherwise the FREE_DISCOVERY_VALIDATION_PROMOTION_ENABLED environment flag). Report that setting's actual state as a blocker if it is off; do not change it. Production state read 2026-11-17: the sfp_validation_promotion_override_enabled setting has no row, so the tick defers to the FREE_DISCOVERY_VALIDATION_PROMOTION_ENABLED environment secret, which exists but whose value was deliberately not viewed (effective state unverified, report it at build time); outboundGlobalPaused is true. Production's validation-intent table shows 101 pending (98 deferred plus 3 enqueued), 782 blocked (669 enqueued, 113 deferred) and 3,005 completed.
ZB_UNATTENDED_BROAD_AUTO_RUN_CONTAINED is true and guards runZeroBounceAutoRun; processLegacyCohortValidationTick is declared in cro03/sfp-continuous-discovery.ts and never invoked. Leave both alone. Importing a business does not by itself guarantee a crawl, contact, preparation or validation, so report each stage's real outcome.
9. Cost and usage reporting
Record original search work/result-unit observations, polling request work, operation/attempt references, price snapshot/unit and estimated cost when known. Polling must not double-count the original Maps result usage.
Separate billable-unit evidence, price-based estimate, actual provider charge if independently supplied, and unknown/conflicting billing. Existing legacy usage estimates based on a fixed per-result multiplier are not an invoice authority. Unknown is not zero; finding fewer usable/new businesses does not erase provider usage.
No new monetary cap or approval ladder. The admin’s daily query count and per-query result limit remain workload settings and API bounds.
Preflight check and additions:
Transport billing today is unknown for an async submit and exact by returned result count after completion. That count is not an invoice. Existing reservations store a reviewed unit price and an estimate receipt, and pricing may be unknown, so reuse that and keep returned-unit counts, estimate and actual charge separate. Polling requests are their own one-unit operations in the existing waterfall; do not add them to the Maps result usage.
Production control row for Outscraper business discovery (read-only, 2026-11-17; re-read unchanged 2026-11-18): enabled, circuit closed, local budget 16,666 units, 96 reserved, 8,268 consumed, last completed 2026-10-13. The reserved units are the old unfinished operations listed in step 3, none created after Oct 11, so the real headroom is the budget minus consumed minus those holds. Show them as unresolved holds, never as scheduled-lane spend.
10. Admin UI authorization and safety
Add the panel to Lead Ops Imports with desktop table/phone cards, filters, exact query/scope detail, source/import links, next due, saturation and independent provider/scheduler/worker states. Use existing CRM theme/tokens and 44px targets; no new top-level navigation.
Admin-only mutations use existing CSRF/role/object guards and server-derived actor/program. Show read-only details only to existing permitted roles. Preview button clearly states it makes a paid search but does not import businesses. The retained-import action clearly states it creates/matches records without a new provider search.
Keep Serper disabled, current outbound paused, current sync controls and all existing provider on/off/emergency-stop behavior unchanged.
Preflight check and additions:
client/src/pages/dashboard/LeadImports.tsx is 1,836 lines and LeadOpsCenter.tsx is 4,048, so build the new panel as its own component and mount it inside the Imports tab of LeadOpsCenter.tsx (route allows admin and manager). /dashboard/lead-importsis a redirect to /dashboard/lead-ops?tab=imports.
Existing upload route /api/leads/import-csv requires admin or manager; managers keep read-only access to the new panel and no paid-scheduling authority. Every browser mutation must send the CSRF token (a raw fetch that skips it is rejected with 403). New routes must not collide with an existing same-shape path (the first registration wins silently); probe with curl after a full server restart.
Correction to the first planning pass: /api/master-leads/import-csv is not guarded by authentication alone. Its route uses isAuthenticated and the handler returns 403 unless the user's role is admin (inline check, present at both the audit's pinned main and the first planning pass's HEAD), so it is admin-only, just not through the shared role middleware. No change or report item is needed here. /api/leads/import-csv uses isDashboardUser plus requireRole("admin", "manager").
11. Required verification and release evidence
Use disposable real PostgreSQL/Redis, denied provider/network egress and injected transport responses. Include:
Two workers and simultaneous admin/scheduled dispatch produce one submission.
Crash before dispatch; after possible provider acceptance before ID persistence; after ID; while pending; after artifact retention; mid-import.
Same-ID polling resumes; expiry/unknown never auto-purchases.
Pilot zero materialization; later retained import has zero additional submissions.
Practical match cases above, real conflicts and branch separation.
Multiple emails, no-email business-only, API field mapping and true ID namespaces.
Documented zero results versus malformed/non-JSON/missing-ID responses; zero-row history without placeholders.
Matched-business/new-contact counts; replay totals stable; preview intra-result duplicates.
Query saturation, county/taxonomy mismatch, changed program scope and manual coverage semantics.
Cold-start worker before first upload, plus unchanged manual/Apollo/custom fixtures.
Preview/import identity lookup on a production-sized synthetic business population, including indexed relaxed-name retrieval and bounded memory.
Crawler evidence → contact materialization → preparation → current validation intent → captured provider receipt, with legacy lane not activated.
Admin/manager/anonymous/IDOR/CSRF negatives; UI loading/error/empty/unknown/expired/mobile states.
Provider manifest/spend-path and CI/pre-deploy scanners detect unmanaged call mutations.
Add the suites to actual manifests/runner. Run relevant existing suites, typecheck, build, migration/parity and diff checks; compare failures to untouched base.
Before release provide branch/base/candidate/migration status, safe staging proof, worker profile/schedule installation plan and rollback. Keep schedule off after publish until the admin enables it. A real paid pilot or production activation is a separate explicit admin action; this audit performed neither.
Preflight check and additions:
Gate registration reality (verified at HEAD 361886eb on 2026-11-17 and unchanged at 21b0db48 on 2026-11-18, in scripts/ci-suite-manifest.ts and scripts/pre-deploy.ts): of the suites the audit lists as existing gates, only scripts/certification/test-canonical-provider-import.ts and scripts/scan-paid-provider-adapters.ts are in both the CI manifest and pre-deploy. test-provider-import-recovery.ts and test-background-profile.ts are in pre-deploy only. test-retained-canonical-import-recovery, test-provider-upload-handoff, test-provider-upload-heartbeat, test-cro03c-provider-manifest-coverage, test-sfp-paid-waterfall-apollo-outscraper, test-sfp-provider-contracts, test-paid-provider-controls-convergence and test-sfp-validation-handoff-repair-certification are in neither manifest. Some run only through disposable runners (scripts/run-retained-import-recovery-disposable.ts for the retained recovery suite, run-sfp-certification-disposable.ts for the paid waterfall suite, run-sfp2060-certification-disposable.ts for provider-contracts and paid-provider-controls, run-sfp-validation-handoff-disposable.ts for the validation handoff suite, and the test:sfp-provider-contracts package script); the upload handoff, upload heartbeat and manifest coverage suites are not referenced by any runner or manifest. A passing manifest therefore does not mean those ran. Run each explicitly and report how it was run.
Register the new suites in the real CI manifest (RAW_SUITE_MANIFEST), in pre-deploy MANDATORY_SUITES, and in CERTIFICATION_FIXTURE_SUITES for suites that need a disposable database.
CI manifest check: npx tsx scripts/ci-suite-manifest.ts --check was red at 361886eb (20 gaps: 19 scripts/test-phase6-*.ts suites and scripts/test-website-lane-draft.ts were in pre-deploy MANDATORY_SUITES but not classified in the CI manifest). It is green at 21b0db48 (exit 0, "Suite manifest valid", all 299 MANDATORY_SUITES scripts classified, verified 2026-11-18) because the Phase 6 and Phase 7 work classified them. .github/workflows/ci.yml runs the same --check (lines 43 and 159) before scripts/run-ci-suites.ts. So a clean --check is again a required pass criterion: register every new suite in the manifest (and in pre-deploy MANDATORY_SUITES where it belongs), classify it correctly, and show --check still exits 0. If it fails at build time, compare against an untouched base before attributing the failure, and do not reclassify unrelated suites here.
Existing gates that pass at HEAD 21b0db48(re-run 2026-11-18; they also passed at 361886eb on 2026-11-17; no network, no provider calls): scripts/check-migration-integrity.ts (1,027 checks, was 1,024; 2 historical duplicate-timestamp warnings), scripts/scan-paid-provider-adapters.ts, scripts/test-sfp-provider-contracts.ts and scripts/test-cro03c-provider-manifest-coverage.ts. Not run in this pass: full pre-deploy, scripts/test-background-profile.ts and the disposable certification runners; run them at build time and compare any failure with the untouched base.
Test IDs to cite in the evidence:
T01 Two workers plus a simultaneous admin and scheduled dispatch produce exactly one submission.
T02 Crash before dispatch, after possible provider acceptance and before ID persistence, after ID, while pending, after artifact retention, and mid-import.
T03 Same-ID polling resumes; expiry and unknown outcomes never auto-purchase.
T04 Pilot produces zero materialization; the later retained import makes zero additional submissions.
T05 Every practical-match row, real conflicts, and branch separation.
T06 Multiple emails, business-only rows, API field mapping (website and street address survive) and true ID namespaces.
T07 Documented zero result versus 202-without-ID, non-JSON and HTTP 204; zero-row history without placeholders.
T08 Matched-business-plus-new-contact counts, replay-stable totals, and preview intra-result duplicates.
T09 Saturation, county and taxonomy mismatch, changed program scope, and manual-coverage semantics.
T10 Cold-start worker before the first upload, unchanged manual, Apollo and custom fixtures, and default-policy resolver characterization.
T11 Identity lookup on a production-sized synthetic population, with the relaxed-name retrieval plan and bounded memory.
T12 Crawler evidence to contact materialization to preparation to current validation intent to captured provider receipt, with the legacy lane not activated and no outbound.
T13 Admin, manager, anonymous, IDOR and CSRF negatives; UI loading, error, empty, unknown, expired and mobile states in a real browser.
T14 Provider manifest, spend-path and CI and pre-deploy scanners detect an unmanaged call mutation; existing SFP waterfall regression after the transport fixes.
T15 Endpoint-contract fixture check and worker-profile selection test.
Paid runs execute the published build, so publish before any pilot.
12. Out of scope
See the Out of scope section above (audit Appendix A section 12, verbatim).
13. Final delivery
Return one consolidated implementation report with source/runtime identities, actual schema/worker selection, counts by population, search/task/artifact/import lineage, match-policy version, cost certainty, tests and browser/role evidence, exact remaining blockers and rollback.
Do not create a follow-up task for known work in this contract. Distinguish engineering complete, deployed, schedule enabled, real pilot completed, imported, crawler completed and current-recipient validation completed. Never infer sending authorization from any of them.
Preflight check and additions: The audit's section 26 required report (reproduced below) and section 18 census apply here. For each census pattern give the full-checkout command, scope, match count, reviewed count and disposition. Add the patterns explicitPaidApproval, submission_unknown, crm_identity_nameand isSfpValidationPromotionEnabledto the audit's list.
Preflight audit contract (verbatim from the attached audit, sections 1 to 27)
Reproduced in full so the executor has every requirement. Section numbers here are prefixed "Audit section" to avoid confusion with the numbered Steps.
Liberty Task 2161 preflight audit and corrected implementation task
Task: #2161 Scheduled Outscraper Business Discovery Reviewed: November 16, 2026, with signed-in production CRM observations at approximately 7:20–7:23 PM America/New_York Repository: scottpstevenson/Liberty-Bancard-Website-and-CRM
The task addresses a real missing capability: recurring searches for businesses that are not already in Liberty. Keep it as one task, with the corrections below incorporated before implementation. Existing SFP discovery primarily enriches already-known businesses; its complete execution flow cannot simply be reused as a new-business search worker.
Your matching preference is incorporated:make practical automatic business matches. One reliable, non-conflicting identifier is sufficient; missing secondary fields, cosmetic name changes or a legal suffix must not create a hold. Reserve review for actual identity conflicts or ambiguity between locations. Keep existing manual-upload behavior unchanged through an explicit versioned policy inside the same resolver.
ZeroBounce clarification: the current automatic path is recipient preparation → validation_intents → the shared email-validation worker. The old broad daily auto-run is explicitly contained. Its disabled switch does not establish that the current selected-recipient path is disabled. Do not revive it for this task.
This file includes the findings, exact source owners, required tests and a complete copy-ready replacement for #2161. It does not authorize this auditor to run a paid pilot, import records, change settings, enable schedules or publish.
Audit section 1. Mode and non-negotiable boundary
This was a read-only repository and production-CRM audit. No application code, database record, provider setting, queue, deployment or outbound control was changed. No Outscraper, Serper or ZeroBounce request was made. The only executed behavioral checks imported the actual pure organization matching policy with synthetic inputs.
The proposed implementation remains one coordinated build. Its new schedule defaults off, and its pilot is an explicit paid admin action. No new spend cap or recurring paid-approval ceremony is part of the correction.
Audit section 2. Absolute end-to-end audit coverage
The review traced search transport, async submission/polling, provider admission/accounting, canonical import/matching, retained-source restart recovery, crawler evidence, contact materialization, recipient preparation, current/legacy validation paths, queue selection and the relevant CRM views.
Forty-eight task-relevant repository files were retrieved at the pinned revision, with existing same-revision CI manifests used for gate cross-checks. The complete repository tree contained 4,925 entries and was not truncated. This is a task-scope audit, not a claim that every unrelated file or CRM screen was line-reviewed or tested.
Audit section 3. Exact source and live baseline
Item	Verified observation
Current GitHub main	c3a8277160269554210dfc903e48947adcafd76c [Preflight corrected 2026-11-17: origin main and workspace HEAD are 361886ebde082c1d5e16a5cea7a13b54ce7b99c7, 18 commits later; none touches the provider, import, resolver or queue code] [Re-audited 2026-11-18: origin main and workspace HEAD are 21b0db48, a publication metadata commit with zero changed files over serving source d34f09fc; 9 commits past 361886eb, none touching provider, import, resolver or queue code]
Production serving SHA	2119c203cf6b3746881b0cdde2b8e3d14b337f26 [Preflight corrected 2026-11-17: the serving build is now cce9ba00, published 2026-11-17 18:44Z] [Re-audited 2026-11-18: the serving build is now d34f09fc, selected 2026-11-18 03:24:58Z]
Main versus serving source	Main is a publication metadata commit over the serving SHA with zero changed files
Production builtAt	2026-11-15T18:54:38.529Z
Production publishBuildId	a7dbaf13-cc92-4ca9-afe1-282c3575ab4c
Source migration journal	Same pinned source previously inspected: 386 entries; final idx 385, tag 0382_website_email_lifecycle [Preflight corrected 2026-11-17: the journal at HEAD has 390 entries, final idx 389, tag 0386_partner_introduction_checks_validated; production's applied ledger has 318 entries ending at 0308] [Re-audited 2026-11-18: the journal has 391 entries, final idx 390, tag 0387_phase7_conversion_integrity, next free 0388; the production ledger is still 318]
Signed-in CRM pages read	Lead Ops Imports, Program Health and Canonical Enrichment Pipeline/Settings
Replit workspace inspection	The read-only question was not submitted because the Replit agent was busy; no work was queued or interrupted
Not established	Uncommitted Replit branch/worktree, actual applied migration journal, full build/pre-deploy result, a new paid pilot, end-to-end native execution or vendor invoice amounts
Live CRM observations:
Population/control	What the CRM displayed	Interpretation
Manual import history	Six completed Outscraper-format imports; 4,386 processed rows	Intake history, not a count of distinct new businesses
Intake summary	2,468 “new contacts,” 1,903 already exists, 15 invalid/error rows	Preserve its population definition; do not relabel as business creation
Latest visible upload	October 13, 2026	The task’s “since late October” narrative was not established by this history
Canonical businesses	99,984	Current inventory snapshot; does not prove per-day/source growth
Preparation-linked validation queue	98 pending, 0 processing; oldest shown October 13, 2026	Pending work is not evidence of dispatch or completed validation [Preflight: production's validation-intent table shows 101 pending, of which 98 are deferred and 3 enqueued; 782 blocked; 3,005 completed]
Outscraper	Enabled, circuit closed, credential present; 96 reserved /8,268 consumed units	Existing provider is available at the control layer; not proof this new caller is authorized [Preflight verified 2026-11-17 from the production control row; the 96 reserved units are 44 ambiguous failed, 2 running discovery and 10 running poll operations from Sept 29 to Oct 11]
Serper	Disabled	Keep disabled
ZeroBounce	Enabled, circuit closed, credential present	Shared provider control differs from an individual scheduling lane
Old ZeroBounce automatic lane	Disabled	Also statically contained in code; do not enable it
Background job profile	Selective	A new queue must actually be selected and installed; registration alone is insufficient
Reconciliation population	3,178 in-flight operations reported across providers	Historical/global population; do not treat this as 3,178 active new-discovery searches
GHL monitor	Owner control showed outgoing sync paused, epoch 16	Preserve the current control; do not restore an older assumed state [Verified 2026-11-18 in production: ghlSyncControl has epoch 16 and enabled false; the outbound pause control is still paused at epoch 4]
The UI exposes different populations in different panels. For example, queue telemetry and database enrichment backlog figures differ. This audit does not add those figures together or infer new eligible work from a historical count.
Audit section 4. Evidence priority and corrections to the premise
Use current code and live state over old roadmaps or comments. The existing CSV processor comment says registration occurs while routes are built; the actual registerPersistedCsvProcessor call is inside the upload handler. The restart fallback is real, but the task must test a fresh worker before any upload has registered the richer processor.
Replace the unproven claim “only manual Outscraper uploads have worked since late October” with: “Liberty needs a recurring source of new, in-scope businesses. Verify recent business creation by source before using a specific date or claiming other sources stopped.”
The current taxonomy-v2 source and live Imports guidance name Automotive, Healthcare, Beauty/Spa, Construction/Trades/Home Services and Fitness/Recreation, across Broward, Miami-Dade and Palm Beach. Seed from the actual active program row and version; do not seed the older Med Spa/Dental/Auto Repair/Restaurant/Retail list or the legacy Florida example cards.
Audit section 5. Complete requirement ledger
The corrected task must cover: active scope/query definitions; area coverage; daily dispatch count; off-by-default schedule; admin paid pilot; retained preview results; practical business matching; exact subject-free provider operation ownership; request ambiguity; async expiry; durable import identity; shared processor/recovery; truthful business/contact counts; crawler/recipient/validation handoff; provider and outbound boundaries; admin UI; authorization; concurrency; migrations; tests; deployment/rollback.
Give each independently testable requirement an ID in the implementation evidence. Do not collapse “pipeline works” into one checkbox.
Audit section 6. Verified fact claims
ID	Task claim	Verdict and source-backed reality	Required correction
V01	Existing transport supports async Maps search and polling	Confirmed: performOutscraperSearch and performOutscraperTaskResults exist	Reuse them through a governed caller
V02	Existing SFP worker can own arbitrary new-business searches	False as framed: current operations and retrieval flow are pinned to an existing business/stage	Add a search-run subject to the durable operation boundary; no fake business
V03	Request ID persistence alone guarantees no repeat charge	Incomplete: response/ID can be lost after provider acceptance	Persist dispatch intent before I/O; unknown outcome must not auto-submit again
V04	Same request-derived hash is enough for all deduplication	Partial: execution identity, artifact integrity and business identity are separate	Persist request/run linkage, actual content hash, mapper/policy versions and canonical resolution
V05	Import processing must be extracted from scratch	Partial: request-free processor/recovery boundary already exists	Consolidate the provider path there; do not build a second importer
V06	Current matching is loose OR matching	False: the current policy can hold even a same-place record when its name differs	Implement the user-requested relaxed discovery policy in the canonical resolver
V07	Existing import row “created” equals a new business	False: row accounting can describe contacts or business-only transitions	Record distinct business creation/match and contact outcomes separately
V08	Pilot can call the real importer and roll back businesses	Unsafe design	Use read-only preview with retained results; never launch real import hooks in pilot
V09	Completed results remain retrievable indefinitely	False	Fetch and retain within the documented retention window; explicit expiry state
V10	One county query means county covered	False	Respect limits, flag saturation and partition dense areas
V11	New rows automatically produce validated emails	Unproven/incomplete	Verify the current selected-recipient path and truthful blocked/no-email outcomes
V12	Old daily ZeroBounce switch is the current validation authority	False	Name and test the shared intent worker; leave old broad auto-run contained
V13	Caller manifest registration alone is sufficient	False	Extend operation/attempt/dispatch/accounting and relevant scanners together
V14	Manual upload behavior remains unchanged after a broad refactor	Not yet proven	Characterize uploads and cold-start recovery before extraction
V15	Existing endpoint is a current permanent API contract	Partial: code uses /maps/search, which current vendor docs label deprecated	Add an endpoint-contract check; make any transition narrow and versioned
V16	Fake response tests alone prove recovery/worker/UI correctness	False	Add real disposable persistence, concurrent workers, process restart and browser evidence
Audit section 7. Complete ownership and call-path census
Capability	Canonical source owners to use
Maps transport/results	server/services/sdr/outscraper.ts
Existing SFP wrapper	server/services/cro03/sfp-live-provider-adapters.ts
Operation/attempt/runtime accounting	server/services/cro03/sfp-provider-operations.ts
Existing business-pinned async lifecycle	server/services/cro03/sfp-paid-waterfall.ts
Provider manifest/controls	server/services/provider-manifest.ts; paid-provider-control.ts
API response decoding/retention helpers	server/services/sdr/sfp-provider-contracts.ts
Upload controller	server/routes/imports.ts
Shared processing/recovery	server/services/csv-import-processor.ts; csv-import-recovery.ts; canonical-import-recovery-worker.ts
Durable execution/rows	server/services/import-execution.ts; canonical-provider-import.ts
Mapping/source detection	server/services/provider-import-columns.ts; import-normalizer.ts
Business identity	server/services/organization-resolver.ts; organization-resolution-policy.ts
Queue installation/profile	server/services/queue-manager.ts; queue-names.ts; background-profile.ts
Current import UI	client/src/pages/dashboard/LeadImports.tsx, embedded in LeadOpsCenter.tsx
Free crawling	free-enrichment-lane.ts; queue-manager.ts runFreeBusinessEnrichmentForBusiness
Staged email → contacts	server/services/free-discovery/staged-email-materialization.ts
Recipient preparation	server/services/canonical-recipient-preparation.ts
Current validation intent/worker	server/services/provider-readiness-control.ts
Shared validation claim/receipt	server/services/canonical-address-validation.ts
SFP validation recovery tick	cro03/sfp-continuous-discovery.ts
Legacy/compatibility validation	zerobounce-campaign-worker.ts; cro03/business-validation-service.ts; cro03/sfp-validation.ts
Source geography/taxonomy	cro03/sfp-discovery-scope.ts; sfp-vertical-classifier.ts; active sfp_programs row
Current navigation is /dashboard/lead-ops?tab=imports. /dashboard/lead-imports is a compatibility redirect. Add the panel inside the current workspace rather than creating another top-level menu item.
Audit section 8. Findings verified before fixes
P0 corrections
F01 — No correct pre-business operation subject is specified.reserveSfpProviderOperation and reservePreCohortSfpProviderOperation require an existing businessId; the existing retrieval task joins business-specific stages. This task searches for businesses that do not exist yet. Extend the canonical boundary with an explicitly typed program/search-run subject and its own eligibility/lease checks. Do not create a dummy business or bypass the provider boundary.
F02 — The lost-response charging window is missing. onTaskSubmitted runs after a provider response is received. A crash or lost response before that callback persists can leave a paid request with no local task ID. Persist the operation/attempt and dispatch marker before I/O; classify post-dispatch uncertainty as submission_unknown. Resume by a known ID; otherwise require request reconciliation, not another automatic purchase.
F03 — Complete reuse of the current retrieval worker would apply the wrong behavior.processSfpOutscraperRetrievalTask filters results to a single pinned business and may launch paid Leads & Contacts work. New-business discovery needs all in-scope results and no implicit paid add-ons. Reuse generic transport/retention/accounting primitives, not the entire business-specific orchestration.
P1 corrections
F04 — Matching would be stricter than you want. Seven executed pure-policy checks confirm the current resolver defers a same-place business when only its display name changes. The replacement task includes a practical automatic policy and preserves the old manual default.
F05 — The shared processor exists but is not uniformly installed. processPersistedCsvImport uses a registered richer processor when available and a request-independent recovery implementation otherwise. Registration currently happens during upload. Make the provider path stable on cold start and prove equivalence; avoid depending on a prior HTTP request.
F06 — Pilot, retained import and repeat-window semantics are missing. Persist one paid result artifact, preview it without business/contact writes and reuse it for a later explicit import. A preview is not ingestion; do not buy it again merely because it was a pilot.
F07 — Search completeness and scope are under-specified. The transport defaults to five results and accepts at most 100 today. A dense county cannot be called covered after a truncated sample. Persist resultLimit, query/area versions and saturation. Resolve returned geography/category; a query label alone is not proof of scope.
F08 — Business/contact/count/cost populations are mixed. Preserve existing intake history and add distinct business outcomes. Keep provider returned/billable-unit observations, estimated cost and actual invoice charge separate. Unknown cost must not display $0.
F09 — Source mapping can lose identity and emails. API fields include site, full_address, postal_code, place_id, google_id, type/subtypes and nested contacts/emails. The normalized transport’s placeId may fall back to google_id. Preserve the true ID namespaces and all supported emails; do not manufacture a place_id from a different Google identifier. Distinguish documented successful empty results from malformed/non-JSON responses or async replies missing a task ID; those must not become false zero-cost/covered runs.
F10 — “Crawler and ZeroBounce take over unchanged” needs an exact acceptance path. A free crawl writes staged evidence, not directly a validated contact. Prove staged materialization, preparation and current validation intent/receipt behavior. Respect no-website/no-email/blocked cases.
F11 — Per-process concurrency and a daily job are insufficient. One worker concurrency setting does not serialize replicas/admin pilots. Use a durable lane claim and frequent recovery/polling; the daily value limits new dispatch count, not polling or cost.
F12 — Failure/disable/restart behavior needs separate meanings. Schedule off stops new searches; pending result recovery should continue under existing provider controls. Provider off/emergency stop remains authoritative. Expired results or unknown submission outcomes do not trigger blind resubmission.
P2 improvements
F13 — Add useful operator states and actions.Show paid pilot versus import, scope/version, saturation, per-business/contact counts, reconciliation reasons, cost certainty, worker selection and next due time. Add “Import retained results” without another paid request.
F14 — Replace brittle line numbers and narrow tests. Use exact symbols, route/profile owners, real database outcomes and cold-start tests. Register new suites in the actual CI/pre-deploy manifests; do not grant scanner exemptions to make a new path pass.
Also measure candidate lookup and preview cost at the current roughly 100,000-business scale. Preserve indexed canonical identity lookups and bounded work; avoid loading the full contact/business roster or repeatedly scanning it for each result. Any alias-normalization lookup introduced by the relaxed policy must have a tested retrieval/index strategy, not just a changed pure decision function.
Audit section 9. Fix effectiveness matrix
Finding	Change site	Why the fix reaches the cause	Required detecting test
F01/F03	Provider operation authority plus generic retrieval adapter	Makes search-run scope real without an existing business; avoids target filtering/add-ons	Search with zero existing businesses succeeds through actual operation/attempt rows; no fake business or contact-enrichment request
F02/F12	Pre-I/O attempt/dispatch state and recovery	Distinguishes never dispatched from possibly accepted	Crash after provider acceptance but before local ID; exactly one submit
F04	Canonical pure policy/resolver with persisted policy version	Applies the same relaxed decision in preview, commit and recovery	Same-place name change matches; competing owned IDs hold; branches remain distinct
F05	Existing CSV processor and startup/recovery entry	Removes request-registration dependence	Import before first upload; process restart mid-row; manual fixtures unchanged
F06	Search run/artifact/import linkage	Separates purchase, preview and local import	Pilot has zero business/contact writes; later import uses original task/artifact with zero submits
F07	Definition/area scope plus decoder/coverage status	Prevents incomplete search being recorded as complete territory	Full-limit sample is saturated; out-of-county row never gains program eligibility from query
F08/F09	Artifact mapper and business outcome ledger	Preserves actual IDs/addresses/emails and counts the right subjects	One existing business plus new email reports matched business/new contact; multi-email and business-only fixtures
F10	Existing crawler/materialization/preparation/validation seams	Tests every real downstream transition	Actual selected validation intent and captured receipt; no broad auto-run/no outbound
F11	Queue registry/profile and DB lane lease	Covers replicas, pilots and restart	Two workers/admin calls race; one new search dispatch
F13/F14	Current Lead Ops UI and test manifests	Makes operational failures visible and regression checks mandatory	Browser state/role matrix and manifest validation
Audit section 10. Authority and source-of-truth boundaries
Use the existing provider operation/attempt accounting, canonical business resolver and import execution/row evidence. New tables may own discovery definitions, occurrences, retained artifacts and search-scoped recovery; they must not become a second business store or a second provider spend ledger.
The daily search count is an operational dispatch setting. Preserve enabled/circuit/credential, manifest, current runtime ownership and durable accounting checks. Do not reintroduce the older paid-provider approval ladder, spend ceilings or per-run monetary ceremonies. Existing routine SFP accounting already permits unknown pricing estimates rather than treating them as approval authority.
Never set explicitPaidApproval=true merely to make a raw transport call pass a manifest check. The approved caller must derive dispatch permission from the real enabled provider and authorized discovery run, then use the durable operation boundary.
Audit section 11. Data and migration safety
Add durable definition/run/artifact/import relationships with database-backed uniqueness. Store program/taxonomy/query/mapper/matching policy versions, exact provider task identity, dispatch/lease state, preview/import state and cost certainty.
Recapture the actual source/applied migration head and concurrent reservations before choosing a number. Source journal idx and tag numbering already differ; do not guess the next file from shared/schema.ts line 10041.
Preserve import rows, suppression, validation observations, existing partners/contacts and history. Do not rewrite prior import hashes or retroactively re-resolve all old businesses.
Audit section 12. Concurrency idempotency and recovery
Persist a definition fingerprint and immutable occurrence; one paid submission identity per occurrence. Keep separate identities for coverage, provider request, retained artifact and import execution.
Serialize pilot and scheduled dispatch across replicas under the same discovery-lane claim. Same request/result import must replay one execution. New provider request IDs cannot defeat repeat-window protection. Expired import claims can resume the retained artifact without buying results again.
Test pauses and scope/policy changes immediately before dispatch/commit. Recompute match decisions under lock at commit; preview counts are observations, not reservations.
Audit section 13. External side-effect ordering
Required order: authorize current run/scope → check provider/runtime/lease → persist operation/attempt/dispatch identity → final pre-I/O recheck → submit once → persist provider ID/result state → poll same ID → retain result artifact → settle/reconcile original operation → preview or import under its declared mode.
A known pending ID is safe to retrieve. An unknown accepted submission is not safe to resubmit automatically. A GET search is still a paid side effect despite its HTTP method.
Audit section 14. Authorization privacy and abuse
Admin-only mutations: pilot, import retained pilot, mark coverage, pause definition, update schedule/count/window and enable schedule. Use normal authenticated CSRF/object guards; managers may have existing read/upload permissions without gaining paid scheduling authority.
Derive actor/program from trusted context; do not trust body-supplied actor IDs or arbitrary program/provider/URL. Bound query text, row count, pagination, returned payload size and result fields. Fetch results only through the fixed provider request endpoint, never an arbitrary results_location URL.
Retain necessary API source evidence under the existing import access/retention model. Do not log keys, raw contact payloads or entire URLs containing sensitive data.
Audit section 15. Queue scheduler and background ownership
Register the queue/name/worker/repeatable/recovery ownership in queue-manager.ts, queue-names.ts and background-profile.ts. Use a narrow existing-compatible capability group, not “full,” and confirm it is selected in the deployed runtime.
One periodic tick can allocate due searches while frequent bounded result polling/recovery drains already-submitted requests. Do not poll only once daily. Record stable schedule identity, timezone, next tick, selected worker state, heartbeat and restart-safe installation. No setInterval sidecar or broad schedule removal.
Define daily count atomically at actual new search dispatch, including pilots according to an explicit displayed policy; polls, import retries and reuse of stored results do not consume a new search slot. Do not pre-dispatch tomorrow’s work after a restart.
Audit section 16. UI and operator workflow
Use /dashboard/lead-ops?tab=imports and the existing LeadImports component, not a new navigation workspace. Keep the manual uploader/history behavior and add a “Scheduled Outscraper discovery” section.
Desktop table: program vertical, county/area, status, last successful search/manual coverage, next due, returned results, distinct new/matched businesses, held/invalid/out-of-scope rows, contacts, saturation, cost status and row actions. Detail shows query/version, provider task/run, artifact and import links.
Phone: labelled cards, wrapping toolbar, full-width controls and an accessible detail sheet/page. Use existing CRM IBM Plex Sans/theme variables, 24/32 title, 14/20 body, 44px targets, 6px controls and 8px surfaces. Show loading, empty, error/retry, pending, preview-ready, importing, completed, held, expired, unknown and unauthorized states.
Display read-only current schedule/worker/provider readiness independently. A saved enabled checkbox is not proof the deployed worker is selected.
Audit section 17. Runtime and deployment assumptions
The audit verified public health and signed-in read-only state. It did not verify native branch status, worker environment variables, applied migration receipts or Redis scheduler installation.
The build must return code/merge/schema/deploy/runtime/activation evidence separately. New schedule stays off after migration/publish. Preserve Serper disabled, current outbound pause and current owner-controlled sync settings. Do not turn on a legacy validation lane to satisfy a UI status badge.
Audit section 18. Grep and census checks
Actual read-only source searches included the following patterns across the pinned task files. Exact retrieved-file search results are recorded in the audit evidence; they are not claimed as an exhaustive repository-wide call-site census.
Pattern family	Confirmed paths/behavior	Required build disposition
performOutscraperSearch / performOutscraperTaskResults	Context-free transport plus SFP callers	Admit new caller through canonical accounting
onTaskSubmitted / provider_task_id / retention	ID callback and business-pinned retrieval lifecycle	Add search-run context and lost-ID state
registerPersistedCsvProcessor / processPersistedCsvImport	Rich upload registration plus cold-start fallback	Stable shared provider processing
materializeCanonicalProviderImportRow / resolveOrganization	Actual local business/contact/source writers	Reuse with versioned relaxed discovery policy
validation-intent / processValidationIntent / recoverValidationIntents	Current shared selected-recipient path	Exact downstream acceptance
runZeroBounceAutoRun / ZB_UNATTENDED_BROAD_AUTO_RUN_CONTAINED	Broad legacy auto-run disabled/contained	Leave unchanged
processLegacyCohortValidationTick	Retained historical implementation, not scheduled	Do not revive
/dashboard/lead-imports / tab=imports	Redirect and current workspace	Extend current surface
The implementation report must provide full-checkout command/pattern, scope, match count, reviewed count and disposition. Source-only scans are not proof of dispatch ordering or actual recovery.
Executed narrow censuses below used rg -n on the retrieved same-revision files; every returned match was inspected. Paths are relative to the repository root. These counts describe the specified scopes, not a full-checkout scan.
rg pattern	Scope	Matches / reviewed	Disposition
^export async function performOutscraper(Search|TaskResults)	server/services/sdr/outscraper.ts	2 /2	Reuse both transport entry points
registerPersistedCsvProcessor(processCsvImport)	server/routes/imports.ts	1 /1	Registration is inside upload handler
^export async function (processPersistedCsvImport|peekOrganizationResolution|resolveOrganization)	csv-import-processor.ts and organization-resolver.ts	3 /3	Existing execution and read/write identity seams
^export async function (processValidationIntent|recoverValidationIntents|enqueueValidationIntent)	provider-readiness-control.ts	3 /3	Current selected-recipient recovery/worker path
ZB_UNATTENDED_BROAD_AUTO_RUN_CONTAINED	zerobounce-campaign-worker.ts	2 /2	Constant and guard both retain containment
processLegacyCohortValidationTick(	cro03/sfp-continuous-discovery.ts	1 /1	Historical function declaration; no invocation in this file
Audit section 19. Existing gates to run in the native build
Inspect and extend these actual suites:
scripts/certification/test-canonical-provider-import.ts.
scripts/certification/test-provider-import-recovery.ts and test-retained-canonical-import-recovery.ts.
scripts/test-provider-upload-handoff.ts; test-provider-upload-heartbeat.ts.
scripts/test-sfp-paid-waterfall-apollo-outscraper.ts; test-sfp-provider-contracts.ts.
scripts/test-cro03c-provider-manifest-coverage.ts; scripts/scan-paid-provider-adapters.ts.
scripts/test-paid-provider-controls-convergence.ts.
scripts/test-sfp-validation-handoff-repair-certification.ts.
scripts/test-background-profile.ts; relevant queue/scheduler/authorization suites.
scripts/ci-suite-manifest.ts; scripts/pre-deploy.ts and its real runner.
Run typecheck, build, migration/parity checks, relevant safe suites and git diff --check in the actual isolated checkout. Tests must deny live provider/network egress except their controlled fake transport/loopback fixtures. Do not weaken paid-path scans or global controls.
Audit section 20. Baseline failures
No native full-suite failure was reproduced during this external audit. Do not import an old six/seven-failure list as a waiver. If a required gate fails, compare the same command/environment on untouched base versus candidate and classify task-caused, task-affected or unchanged baseline.
The Replit agent’s busy response is an access limit, not a test failure or proof of the current task’s implementation state.
Audit section 21. Tests executed and tests that must be added
Seven checks ran against the actual pure organization-resolution-policy.ts, with the actual state-normalization helper transpiled using Node’s TypeScript stripping. No resolver logic was replaced.
Case	Current result
Same place ID and location; display name changes to include LLC	Deferred
Same domain/location; display name changes	Deferred
Same normalized phone; secondary input evidence absent	Matched
Precisely identified different branch	Create
New business with usable phone	Create
Only new name plus city/state, no stronger identity/address	Deferred
Exact compatible source/place evidence	Matched
All seven observations matched assertions. They demonstrate the existing behavior, not implementation of the new relaxed policy. No full HTTP/database/browser certification suite was executed.
Mandatory additional checks: no-business pilot; preview intra-result duplicates; retain/import without another search; lost-ID ambiguity; duplicate/concurrent dispatch; same-ID result resume; expired results; partial import recovery; cold start before upload; relaxed-match cases; branch separation; matched business/new contacts; multiple emails; source namespaces; result saturation; scope changes; admin/manager/anonymous roles; crawler/materialization/preparation/selected validation; no broad auto-run/Serper/outbound; deployment profile and UI states.
Audit section 22. Kill lines
Do not accept the original implementation if it uses a fake business ID, direct unmanaged paid fetch, whole SFP retrieval orchestration, automatic resubmission of an unknown request, in-memory-only concurrency, unretained results, pilot business/contact writes, misleading business/contact counts or a revived broad ZeroBounce auto-run.
Do not accept strict all-fields-equal matching as fulfillment of your updated request. Conversely, do not automatically merge branches or overwrite a contact’s existing business/consent to avoid a hold.
Audit section 23. Cross-task and branch collision risk
The Replit workspace was busy, so uncommitted or in-progress #2161 work could not be inspected through the read-only question tool. GitHub main and production identity were independently verified.
Before editing, recapture branch/dirty files and overlapping work in imports.ts, schema/journal, queue registry/profile, provider operations, organization policy, validation and CI manifests. Incorporate these corrections into the existing #2161 task; do not start a competing implementation.
Audit section 24. Executable task rewrite
Use the replacement task in Appendix A. It preserves the original business goal, no new spend caps, disabled-by-default schedule, Serper off, outbound paused and unchanged manual-upload behavior, while incorporating the relaxed matching preference and current validation owner.
New infrastructure for search-run ownership is implementation work within #2161, not permission to bypass the current operation ledger or a reason to create a separate task.
Audit section 25. Final verdict
PREFLIGHT BLOCKED — DO NOT BUILD THE ORIGINAL TEXT UNCHANGED.
The original leaves the pre-business paid-operation owner, lost-ID charge recovery, practical matching policy, result retention/pilot reuse and actual validation handoff unresolved. These are causal design gaps, not the ordinary absence of code the task intends to build.
Appendix A incorporates the corrections into a reviewable implementation contract. Apply it to #2161 and complete the native branch/schema/collision checks before Build Mode. No new monetary approval ladder or spend cap is required to clear these design gaps.
Audit section 26. Required final implementation report
Return audited base/candidate/runtime SHAs; native branch/migration status; requirement/VFC/fix matrices; changed canonical owners; actual grep counts; test receipts; preview/import/operation lineage; business/contact/cost outcome definitions; selected validation path proof; old-lane non-activation; worker selection/scheduler evidence; admin UI evidence; rollout/rollback and truthful activation status.
A mocked response can prove parser behavior. Only real disposable persistence/worker tests can prove durable resume, and only authorized deployed readback can establish live operation. No campaign release is implied.
Audit section 27. Final directive
Update the existing #2161 task with Appendix A before implementing. Finish every task-owned correction, test and operator surface in the same workstream. Preserve current controls; make a paid pilot explicit and reviewable; do not label a queue entry, source import or free crawl as a completed ZeroBounce validation.
Preflight verification results
Verified in this planning pass at HEAD 361886eb (clean working tree; first pass was at 49b5f39a, re-audited 2026-11-17): code read, real pure-policy execution, the real transport run with injected responses and no network, vendor documentation read live, existing static gates run, and read-only production queries. No provider request, import, setting change or deploy was made. Re-verified 2026-11-18 at HEAD 21b0db48with the same read-only boundary: the static gates in step 11, the journal, the production control row and counts, and the Outscraper transport, provider-import, resolver, queue-manager and imports/master-leads route code (no commit since 361886eb changes them).
Verdicts on the audit's fact claims (V01 to V16)
ID	Verdict	Basis
V01	Confirmed	performOutscraperSearch and performOutscraperTaskResults exist in server/services/sdr/outscraper.ts
V02	Confirmed	Reserve functions require a business ID; dispatch boundary has no search-run subject; retrieval table requires business, stage and cohort
V03	Partly true	A durable pre-I/O attempt marker already exists; the gap is the search-run subject, lost-ID classification and reconcile action
V04	Consistent with code	Import key is csv_contact:<fileHash>, metadata can hold versions, stable source key is separate; not executed end to end
V05	Confirmed	Request-free fallback and provider recovery path exist
V06	Confirmed	Executed: same-place name change defers
V07	Confirmed	Row ledger counts dispositions, not distinct businesses versus contacts
V08	Design judgment, accepted	The importer writes through independent paths; peek exists and is read-only but lacks an intra-batch overlay
V09	Confirmed	Vendor docs give 4-hour availability; retention helper exists
V10	Confirmed	Default limit 5, local cap 100, executed
V11	Code-read only	Downstream path traced; not run end to end
V12	Confirmed	Broad auto-run contained; tick recovers validation intents
V13	Confirmed	Manifest lists callers; adapter asserts activation internally; scanners and coverage test exist and pass at HEAD
V14	Not proven, as the audit says	Characterization tests required before refactoring
V15	Confirmed	Code uses /maps/search; vendor labels it deprecated and documents /google-maps-search
V16	Accepted	Real disposable persistence, concurrent workers, restart and browser evidence required
Verdicts on the audit's findings (F01 to F14)
ID	Verdict	Notes
F01	Confirmed	See step 2
F02	Partly true	Pre-I/O marker exists; see step 2
F03	Confirmed	Retrieval worker filters to one pinned business and can launch paid Leads & Contacts
F04	Confirmed	Seven executed cases plus two extra probes; see step 4
F05	Confirmed	Registration is inside the upload handler; see step 5
F06	Design requirement	Pilot, preview and retained import; see steps 5 to 7
F07	Confirmed	Default limit 5, cap 100; saturation and scope rules required
F08	Confirmed	Counts are dispositions; cost certainty rules in step 9
F09	Confirmed and extended	Mapper drops fields; transport false-zero and google_id defects found by execution; see steps 3 and 5
F10	Code-read confirmed	Exact acceptance path in step 8
F11	Confirmed, wording narrowed	Existing job lock is token-gated but time-based and per job name, and cannot fence an in-flight submit; see step 7
F12	Design requirement	See steps 3 and 7
F13	Design requirement	See step 10
F14	Confirmed and extended	Gate registration gaps documented in step 11; the CI manifest check was red at 361886eb (20 unrelated gaps) and is green at 21b0db48
Live observations from the audit, checked against production (read-only)
Audit observation	Result
99,984 canonical businesses	Confirmed (177,330 total business rows)
Six completed imports, 4,386 processed rows	Confirmed: Sept 9 (1,472 rows) and five files on Oct 14
Outscraper enabled, circuit closed; Serper disabled; ZeroBounce enabled	Confirmed (Apollo disabled)
98 validation items pending	Production's validation intent table shows 101 pending (98 deferred plus 3 enqueued), 782 blocked, 3,005 completed; the audit's 98 matches the deferred subset
"Since late October" narrative	Supported by creation data as stated in the premise above (weekly creation 11 and 3 for the weeks of Oct 26 and Nov 2; the first pass wrote 7 and 3)
96 reserved / 8,268 consumed units	Verified from the production control row; the 96 are 44 ambiguous failed, 2 running discovery and 10 running poll operations
GHL epoch 16, selective background profile	Epoch 16 verified 2026-11-18 in production (ghlSyncControl enabled false; outboundGlobalPaused true; pause control paused at epoch 4). The deployed selective background profile is still not verified
Serving SHA 2119c20	Superseded: the serving build was cce9ba00(published 2026-11-17 18:44Z) and is now d34f09fc (selected 2026-11-18 03:24:58Z)
New defects found beyond the audit
Async submit with HTTP 202 and no task ID, or HTTP 200 non-JSON, returns a successful zero-cost empty result (step 3).
HTTP 204 on a result poll, the documented failure response, is treated as pending (step 3).
google_id is recorded as the place ID when no place ID is present (step 3).
The shared column mapper drops website, street address and emails for API-shaped rows (step 5).
The development database has two active programs; seeding must select taxonomy version 2 and fail closed (step 1).
Most of the gates the audit calls existing are not registered in the CI or pre-deploy manifests (step 11).
The existing job lock is token-gated but time-based and per job name, and cannot fence an in-flight provider submit, so a database lane claim checked in the dispatch boundary is required (step 7).
scripts/ci-suite-manifest.ts --check failed at 361886eb with 20 unrelated gaps (19 phase-6 suites and scripts/test-website-lane-draft.ts) and is green at 21b0db48 (exit 0, 299 suites classified), so it is again a pass criterion: new suites must keep it green (step 11).
Production holds 12 unfinished Outscraper operations (2 discovery, 10 poll) plus 44 ambiguous failed discovery operations from Sept 29 to Oct 11; they account for all 96 reserved units and must be reported separately (steps 3 and 9).
resumeExpiredCsvImports is called from two places (server/index.ts and server/services/queue-manager.ts), and the comment on registerPersistedCsvProcessor in csv-import-processor.ts is inaccurate (step 5).
The indexes named businesses_domain_unique_nonempty_uidx and businesses_place_unique_nonempty_uidx are not unique (step 4).
Corrections made to the first planning pass
Re-audit on 2026-11-17 corrected these statements in this plan: weekly canonical creation for the weeks of Oct 26 and Nov 2 is 11 and 3, not 7 and 3; HEAD, serving build and journal figures (390 entries, idx 389, next free 0387); /api/master-leads/import-csv is admin-only through an inline role check, not authentication-only; the two ..._unique_nonempty_uidx indexes are not unique and the name-lookup index is on businesses; scripts/ci-suite-manifest.ts --check is red at baseline, so it is not a gate for this task; the job lock is token-gated but still not a lane claim; startup CSV recovery has a second call site in server/services/queue-manager.ts; LeadImports.tsx has 1,836 lines; and the 98 pending validation items are the deferred subset of 101 pending. Everything else in the first pass's checks was re-verified and stands.
Re-audit on 2026-11-18 updated these figures: HEAD 21b0db48; serving build d34f09fc; journal 391 entries, idx 390, next free migration 0388 (maximum when1800400330001); scripts/ci-suite-manifest.ts --check now green, so it is a gate again; scripts/check-migration-integrity.ts 1,027 checks; GHL epoch 16 verified in production; and no canonical business created after 2026-11-07 20:30 UTC (the weeks of Nov 9 and Nov 16 are 0 so far). The Outscraper transport, import, resolver and queue code, the production control row, the source-link counts and the weekly figures for earlier weeks are unchanged.
Relevant files
server/services/sdr/outscraper.ts
server/services/sdr/sfp-provider-contracts.ts
server/services/cro03/sfp-live-provider-adapters.ts
server/services/cro03/sfp-provider-operations.ts
server/services/cro03/sfp-paid-waterfall.ts
server/services/provider-manifest.ts
server/services/paid-provider-control.ts
server/routes/imports.ts
server/services/csv-import-processor.ts
server/services/csv-import-recovery.ts
server/services/canonical-import-recovery-worker.ts
server/services/import-execution.ts
server/services/canonical-provider-import.ts
server/services/provider-import-columns.ts
server/services/import-normalizer.ts
server/services/organization-resolution-policy.ts
server/services/organization-resolver.ts
server/services/queue-manager.ts
server/services/queue-names.ts
server/services/background-profile.ts
server/services/job-registry.ts
server/services/free-enrichment-lane.ts
server/services/free-discovery/staged-email-materialization.ts
server/services/canonical-recipient-preparation.ts
server/services/provider-readiness-control.ts
server/services/canonical-address-validation.ts
server/services/cro03/sfp-continuous-discovery.ts
server/services/cro03/south-florida-prospecting.ts
server/services/cro03/sfp-discovery-scope.ts
server/services/cro03/sfp-vertical-classifier.ts
server/services/cro03/business-validation-service.ts
server/services/cro03/sfp-validation.ts
server/services/zerobounce-campaign-worker.ts
server/services/outbound-pause-authority.ts
client/src/pages/dashboard/LeadImports.tsx
client/src/pages/dashboard/LeadOpsCenter.tsx
client/src/App.tsx
shared/schema.ts
migrations/meta/_journal.json
scripts/ci-suite-manifest.ts
scripts/pre-deploy.ts
scripts/check-migration-integrity.ts
scripts/scan-paid-provider-adapters.ts
scripts/test-background-profile.ts
scripts/test-cro03c-provider-manifest-coverage.ts
scripts/test-paid-provider-controls-convergence.ts
scripts/test-sfp-paid-waterfall-apollo-outscraper.ts
scripts/test-sfp-provider-contracts.ts
scripts/test-provider-upload-handoff.ts
scripts/test-provider-upload-heartbeat.ts
scripts/test-sfp-validation-handoff-repair-certification.ts
scripts/certification/test-canonical-provider-import.ts
scripts/certification/test-provider-import-recovery.ts
scripts/certification/test-retained-canonical-import-recovery.ts
scripts/run-retained-import-recovery-disposable.ts
scripts/run-sfp-certification-disposable.ts
scripts/run-sfp2060-certification-disposable.ts
scripts/run-sfp-validation-handoff-disposable.ts
scripts/run-sfp2060-predeploy-disposable.ts
scripts/run-ci-suites.ts
.github/workflows/ci.yml
