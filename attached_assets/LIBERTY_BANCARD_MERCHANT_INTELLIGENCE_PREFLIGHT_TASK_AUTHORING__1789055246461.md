# Liberty Bancard PREFLIGHT + PROGRAM TASK AUTHORING

**Program:** South Florida Merchant Intelligence, Qualification, Enrichment, and Lead Activation  
**Today's date (YYYYMMDD):** 20260910  
**Repository:** `scottpstevenson/Liberty-Bancard-Website-and-CRM`  
**Mode:** PRE-FLIGHT + TASK-SERIES AUTHORING ONLY  
**Do not enter Build Mode. Do not modify application code. Do not run paid providers. Do not mutate production.**

---

## 1. Assignment

Perform a fresh, evidence-backed audit of the current Liberty Bancard repository, current task history, migrations, runtime controls, production read-only status surfaces, and all lead/enrichment features. Then create the complete, dependency-correct series of Replit build tasks required to turn the existing components into one safe, economical, observable pipeline that produces high-quality credit-card-processing leads for South Florida.

The required business outcome is:

> Identify active South Florida merchant locations, qualify them for payment-processing fit, discover the correct business and decision-maker contact information, validate only the final outreach candidates, stage them safely, and promote approved records into the CRM without duplicate businesses, duplicate contacts, unsupported AI claims, uncontrolled provider spending, or unauthorized outreach.

This is not permission to implement the program in this session. Complete the preflight, reconcile all existing work, author the task series, and stop.

---

## 2. Absolute audit rule

Do not stop after finding one blocker, one disabled control, one architectural contradiction, or enough evidence to declare the program incomplete.

Continue until every affected path has been traced end to end:

1. source acquisition;
2. raw source storage;
3. source census and cohort selection;
4. business and location identity;
5. free deterministic enrichment;
6. AI classification;
7. paid provider routing;
8. provider result persistence;
9. field arbitration and provenance;
10. email discovery and validation;
11. suppression and channel eligibility;
12. `master_leads` staging;
13. canonical business/contact promotion;
14. GHL and outbound boundaries;
15. worker scheduling, queues, retries, budgets, observability, and operator UI;
16. mobile/operator usability;
17. pilot activation and exact-release certification.

Finding a P0 changes the verdict; it does not end the audit.

---

## 3. Required starting procedure

Before reaching conclusions:

1. Fetch the current remote repository state.
2. Record exact branch, full HEAD SHA, upstream SHA, working-tree status, and migration head.
3. Search the complete git history and task system for all related work, including CRO-03, CRO-03A/B/C/D, CRO-08A, contact census, reconciliation, quality-v1, identity crosswalk, sales-rep activation, source ingestion, `master_leads`, Sunbiz enrichment, SDR enrichment, Serper, Outscraper, Apollo, OpenAI, and ZeroBounce.
4. Treat `2273f80b0bb4f3f9b628c8a2316d9d445865b1bc` only as the last independently observed local reference SHA. Do not assume it remains current.
5. Inspect current code. Do not rely on task descriptions, completion summaries, old audit prose, UI labels, or comments as proof of runtime behavior.
6. Use read-only production inspection where authorized. Never expose secrets or raw PII.
7. Reconcile any contradiction among repository code, migrations, task claims, environment/configuration status, queue state, production counts, and UI behavior.

If current production access is unavailable, mark runtime claims `UNVERIFIED`; do not convert absence of evidence into a pass.

---

## 4. Existing work that must be preserved and reconciled

The repository already contains substantial governed infrastructure. Do not propose rebuilding it under new names without proving why the existing authority cannot be amended.

At minimum, inspect and reconcile:

- CRO-03 durable enrichment factory and provider economics;
- CRO-03A source census and qualification;
- CRO-03B provider-denied lifecycle;
- CRO-03C governed provider operations, receipts, reservations, settlements, continuation, ZeroBounce checkpoints, and outbound fences;
- CRO-03D production activation and exact-release ceremony;
- CRO-08A continuous candidate factory and enrichment operations;
- contact census and quality-v1 signal projection;
- bulk contactability remediation;
- identity crosswalk Gen-1 and any planned Gen-2 authorization;
- canonical `businesses`, business aliases, locations, contacts, prospects, `master_leads`, `sdr_merchants`, `sunbiz_entities`, and discovery-result models;
- consent, DNC, suppression, channel-eligibility, global-pause, and dispatch-disabled authorities;
- recent sales-rep/mobile/field-sales tasks and exact-release certification.

For every proposed task, classify its relationship to existing work as exactly one of:

- `CLOSE EXISTING TASK`;
- `AMEND EXISTING TASK`;
- `REPLACE/SUPERSEDE EXISTING TASK`;
- `NEW TASK`;
- `RUNTIME OPERATION ONLY`;
- `NO ACTION — ALREADY PROVEN`.

Do not assign a task number until current task-number availability and existing-task ownership have been verified. If that cannot be verified, use stable provisional program IDs and explicitly leave numeric task IDs unassigned.

---

## 5. Claims requiring fresh verification

The following were observed during an earlier audit. They are leads for investigation, not facts that may be copied without re-verification:

- approximately 1,919,454 `sunbiz_entities`;
- approximately 968,181 Sunbiz rows pending enrichment;
- approximately 292,854 marked enrichment-completed;
- only about 2,145 Sunbiz rows with email and 23,470 with phone;
- no current-day enrichment output, an inactive worker, and a stale last-enrichment timestamp;
- CRO-03 transport reported live while rollout/attestation/canary state was incomplete or expired;
- approximately 12,711 prospects, 34 `sdr_merchants`, zero `master_leads`, and a very small canonical `businesses` population;
- the current source-census UI staging at most 100 records per source without a meaningful best-cohort selector;
- the production qualification policy targeting only Auto, Healthcare, and Salon/Spa;
- a proposed ZeroBounce run of approximately 137,032 emails after local prefiltering;
- an identity crosswalk scanning roughly 1.9 million Sunbiz entities while producing almost no deterministic matches;
- `Enrich All Pending` being disabled in the client and returning a retired/503 response in the backend;
- `Analyze My Lead Pool` using a small sample to create narrative AI output without durable enrichment or promotion;
- free SDR website/RDAP/JSON-LD/contact-page enrichment existing in code but lacking a proven recurring producer and being narrowly scoped;
- paid provider executors persisting redacted receipts/counts while usable provider-returned contact values fail to reach canonical projections;
- Apollo search/enrichment behavior not matching the current Apollo API contract.

For each item, return `CONFIRMED`, `CORRECTED`, `STALE`, or `UNVERIFIED`, with exact evidence.

---

## 6. Mandatory UI-to-worker trace

Audit each operator action from button to durable terminal state. Include at least:

- Analyze My Lead Pool;
- Enrich All Pending;
- Lead Ops source census;
- Stage Source Census;
- Run Qualification;
- CRO-03 staging review;
- provider activation/canaries;
- Apollo organization and people discovery;
- Outscraper/Maps enrichment;
- Serper enrichment;
- OpenAI/AI SDR classification;
- ZeroBounce bulk validation and per-candidate validation;
- `master_leads` import/backfill/staging/promotion;
- contact census;
- quality-v1 preview/full run;
- reconciliation remediation controls;
- identity crosswalk Gen-1/Gen-2;
- Ready for Outreach and sequence/GHL handoff.

For each action identify:

1. route and component;
2. API endpoint;
3. authorization;
4. command/job producer;
5. queue and worker owner;
6. feature flag and activation authority;
7. source population and selection rule;
8. provider calls and maximum spend;
9. data written and canonical mutation owner;
10. retry/idempotency/cancellation/recovery behavior;
11. terminal/reconciliation definition;
12. operator-visible status;
13. whether the action is operational, diagnostic-only, retired, misleading, or dead.

UI wording is not runtime evidence. A configured API key is not proof that a provider participates in the live pipeline. A scheduled definition is not proof that a scheduler is active.

---

## 7. Canonical lifecycle to enforce

Audit the schema and writer ownership against this target lifecycle. Correct it if repository evidence requires a better model, but do not collapse distinct lifecycle stages:

`source record -> source observation -> normalized organization/location candidate -> identity resolution -> qualified merchant candidate -> enrichment evidence -> arbitrated canonical business/location -> master lead -> approved contact -> eligible channel -> sequence/GHL`

Required principles:

- Sunbiz is legal-entity evidence, not proof of an active storefront, outreach consent, or merchant fit.
- `businesses` is the canonical organization identity unless the current repository proves a different formally governed authority.
- An operating location must not be silently collapsed into a legal entity or contact.
- Source observations remain immutable and attributable.
- Provider results are evidence; they do not directly overwrite canonical values.
- Field arbitration must consider authority, freshness, confidence, conflicts, and provenance.
- `master_leads` is a governed pre-contact pool, not a duplicate contact table.
- Promotion must be explicit, idempotent, deduplicated, and suppression-aware.
- GHL is an external projection, not the canonical source of business/contact identity.
- No enrichment step may create a deal, enroll a sequence, or imply outreach authorization.

Audit every writer that violates or bypasses this lifecycle.

---

## 8. South Florida operating-merchant source strategy

The task series must not treat all 1.9 million Sunbiz entities as an equally valuable acquisition cohort. Audit and design a versioned source registry and importer strategy for active operating merchants in:

- Miami-Dade County;
- Broward County;
- Palm Beach County;
- Monroe County only as a separately approved expansion.

Evaluate and plan ingestion for official or authoritative sources, including:

1. Florida DBPR Hotels and Restaurants public records, including active licenses, new establishments, ownership changes, seating/inspection/location evidence where supplied;
2. Florida DBPR Alcoholic Beverages and Tobacco license and daily-activity records;
3. Florida DBPR Cosmetology business/license records;
4. Florida HealthSource healthcare-license data;
5. Miami-Dade local business tax/open-data records;
6. Broward local business tax/open-data records;
7. Palm Beach County business-tax records;
8. Sunbiz as legal identity/officer/status corroboration;
9. existing prospects, `sdr_merchants`, discovery results, contacts, and approved CSV/provider imports.

For every source specify:

- authority and terms/access method;
- refresh cadence;
- stable source key;
- legal name, DBA, address, location, license/status, dates, phone/email/domain fields;
- active/inactive semantics;
- change detection and tombstones;
- normalization and duplicate strategy;
- county/geography handling;
- expected merchant value;
- whether it can support new-opening or ownership-change triggers;
- provenance and source-record retention;
- cost and failure controls.

Do not scrape or integrate a source merely because it exists. Prefer lawful, stable, official bulk/open-data mechanisms.

---

## 9. Qualification policy v2

Design the work needed for a versioned South Florida merchant qualification policy that selects quality before paid enrichment.

### Hard gates

- active operating location in an approved county;
- not an existing customer or known duplicate;
- not suppressed, opted out, bounced, DNC, or otherwise channel-ineligible;
- acceptable business category and risk policy;
- sufficient identity/location evidence;
- no unresolved identity conflict that would make provider spending unsafe.

### Scored evidence

- card-present or recurring-payment likelihood;
- likely payment volume/merchant value;
- recent opening, ownership change, license activity, or other timing trigger;
- independent/local decision authority;
- location and operating-status confidence;
- website/domain confidence;
- recent reviews, ratings, hours, category, and verified Place evidence;
- processor/POS/booking/ecommerce fingerprints;
- named owner or appropriate decision-maker availability;
- direct/business phone and email availability;
- multi-location and chain/franchise handling;
- record freshness and cross-source agreement.

The policy must support at least restaurants/food service, bars, salons/spas, auto service, medical/dental/veterinary, specialty retail, fitness/wellness, lodging/hospitality, and other approved merchant-heavy categories. Construction and professional services must not outrank stronger card-processing merchants merely because they dominate Sunbiz counts.

AI-generated fit or close-rate guesses must not be presented as measured truth. Separate deterministic gates, model classifications, predicted scores, and observed conversion outcomes.

---

## 10. Free enrichment before paid providers

Audit and operationalize the existing free/deterministic capabilities before proposing new vendors:

- domain and URL normalization;
- website crawl;
- contact/about/team/location page discovery;
- JSON-LD and structured-data extraction;
- RDAP/WHOIS-derived organization evidence where lawful and useful;
- public email/phone extraction;
- processor, POS, booking, ecommerce, and technology fingerprints;
- local email syntax, placeholder, disposable-domain, and MX checks;
- deterministic vertical/category mapping;
- duplicate and source-conflict detection.

Determine why the existing free SDR enrichment path is not producing observable continuous results. Trace its producer, schedule, queue, worker, eligible population, terminal state, and recovery behavior. The resulting task must extend the capability through the canonical pipeline rather than creating another parallel enrichment engine.

---

## 11. Correct use of OpenAI and AI SDR

Audit every current AI lead-analysis and enrichment path, including model configuration, prompt inputs, structured output, evidence retention, retries, fallbacks, and claims shown to operators.

Use OpenAI for bounded evidence synthesis such as:

- vertical and subvertical classification;
- merchant-fit classification;
- processor/POS evidence interpretation;
- owner/title relevance;
- source-conflict summaries;
- structured reason codes and recommended next enrichment action.

Do not use OpenAI as proof of:

- mailbox existence or deliverability;
- person/business identity;
- consent or channel eligibility;
- operating status without evidence;
- actual processing volume, savings, or close probability;
- provider-returned facts that were not supplied to the model.

Plan schema-constrained outputs, model/prompt versioning, input-evidence hashes, confidence calibration, human-review thresholds, and offline/batch execution for bounded qualified cohorts. Narrative-only `Analyze My Lead Pool` output must not masquerade as durable qualification.

---

## 12. Provider waterfall and economics

Audit the current routing policy, adapters, API contracts, and live executor behavior for Serper, Outscraper, Apollo, OpenAI, and ZeroBounce.

The target economic order should be challenged and then implemented as appropriate:

1. official source and existing internal evidence;
2. free deterministic normalization/crawl/classification;
3. Serper or search only when a domain/location remains unresolved;
4. Outscraper/Google Maps for targeted operating-location evidence, Place identity, business status, reviews, hours, phone, website, and approved contact enrichment;
5. Apollo organization resolution only for a sufficiently resolved organization/domain;
6. Apollo people search/discovery followed by the current supported person-enrichment endpoint only for an approved role/person candidate;
7. local email prefilter;
8. ZeroBounce only for the selected final email candidate;
9. canonical arbitration and staging.

For every provider, require:

- current official endpoint verification;
- request/response contract tests using fake transport;
- exact returned-field handling;
- placeholder/locked-field rejection;
- match-confidence and ambiguity handling;
- per-call credit certainty;
- per-run, daily, and monthly caps;
- reservation, settlement, cancellation, and reconciliation;
- provider-specific rate limits and retry policy;
- redacted operational logs;
- encrypted or otherwise compliant durable storage for usable PII;
- provenance and freshness;
- yield and cost-per-qualified-lead metrics;
- a no-call outcome when prerequisite evidence is insufficient.

Specifically verify whether current Apollo code uses obsolete endpoints or assumes that People Search returns email/phone. Current Apollo documentation must govern the fix, not legacy assumptions.

Specifically verify whether current CRO-03 live executors preserve usable provider discoveries through stage chaining and canonical projection, or only receipts, hashes, counts, and billing metadata.

---

## 13. Email discovery and validation economics

Do not propose validating the entire existing CRM or all raw source emails merely to make identity matching produce results.

Design a winner-only validation funnel:

`qualified business -> candidate person/role -> candidate email(s) -> deterministic ranking -> local prefilter -> one selected candidate -> paid mailbox validation -> outreach eligibility`

Required email-state semantics must distinguish at least:

- absent;
- discovered/unvalidated;
- syntax invalid;
- placeholder/test;
- disposable;
- no MX;
- DNS indeterminate;
- provider valid;
- provider invalid;
- catch-all;
- unknown;
- spamtrap/abuse/do-not-mail risk where supported;
- stale/expired validation;
- bounced;
- suppressed/opted out.

MX presence is not mailbox validation. OpenAI is not an email validator. A catch-all response is not equivalent to a verified individual mailbox.

The tasks must include a bounded validator benchmark if an alternative to ZeroBounce is considered. Compare on a representative 500-1,000 final-candidate cohort using provider cost, definitive-result rate, catch-all/unknown rate, latency, false-positive signals, and subsequent delivery outcomes. Do not add a second validator without a measurable reason.

---

## 14. Crosswalk and reconciliation correction

Determine whether contact reconciliation, quality-v1, identity crosswalk Gen-1, and prospective Gen-2 are being run at the correct lifecycle stage.

Answer explicitly:

1. What population is the subject side of each run?
2. What population is the candidate side?
3. Which exact normalized fields and evidence tiers are compared?
4. Why did deterministic matches remain near zero?
5. Did the algorithm compare incompatible lifecycle entities, use the wrong source field, require an unavailable validation state, or all of the above?
6. Which matching tiers can operate before paid validation?
7. Which matches require a verified mailbox, and is that requirement identity-safe and economically justified?
8. Should Sunbiz be matched to canonical businesses/locations before any contact-person crosswalk?
9. What outputs from a cancelled/partial run remain valid, and how are they marked?
10. What exact preconditions must be green before rerunning any full scan?

Do not solve low deterministic-match yield by weakening identity evidence globally. Build the missing organization/location and enrichment stages, then rerun a bounded representative crosswalk before any full population run.

---

## 15. Master leads and promotion

Audit why `master_leads` is empty or underused and determine its correct place in the pipeline.

The task series must cover:

- staging qualified enriched leads without creating contacts;
- immutable source/provenance linkage;
- deduplication against canonical businesses, contacts, customers, prior leads, suppressions, and provider identities;
- readiness and review states;
- deterministic reason codes;
- promotion preconditions;
- atomic/idempotent business, location, and contact creation/linking;
- no automatic deal creation;
- no automatic sequence enrollment;
- GHL projection only after the appropriate boundary and authorization;
- batch reconciliation: selected = skipped + suppressed + duplicate + staged + promoted + failed;
- rollback/recovery semantics that do not erase source evidence.

Do not blindly backfill every existing contact or import all Sunbiz entities merely to make the table non-empty.

---

## 16. Operator experience and mobile requirements

Every task affecting Lead Ops, source census, qualification, enrichment, `master_leads`, contacts, or field sales must include premium desktop and mobile behavior.

The final operator flow must make it easy to answer:

- Where did this lead come from?
- Is it an active merchant location?
- Why is it considered a fit?
- What information is verified versus inferred?
- Which provider would run next and what can it cost?
- Why was a provider skipped or blocked?
- Is the email validated, catch-all, stale, or suppressed?
- Is this an existing business/contact/customer?
- What action is safe next?
- Has another rep claimed or visited it?

Require responsive cohort selection, filters, source/vertical/county controls, budget previews, progress/reconciliation, cancellation/resume, failure explanations, provenance, audit history, and accessible touch targets. Do not add dozens of disconnected Admin and System destinations. Prefer one coherent Lead Ops workspace with role-appropriate views.

Mobile requirements must include narrow-width navigation, no horizontal table dependency, readable cards/details, map/location handoff where applicable, offline-safe field outcomes where already governed, and conflict protection against two reps claiming or visiting the same merchant.

---

## 17. Safety and non-regression invariants

All authored tasks must preserve these invariants:

- global outbound remains paused unless separately authorized;
- dispatch remains disabled where current authority requires it;
- enrichment never implies consent;
- no provider call without durable authorization and budget reservation;
- no paid call from preview, source census, or qualification-only modes;
- no raw PII, keys, provider payloads, or email addresses in logs;
- no canonical last-write-wins behavior;
- no duplicate business/contact/GHL creation;
- no task may bypass CRO-03 reservations, settlements, receipts, or outbound fences;
- no production migration or data mutation during preflight;
- no full quality-v1, full crosswalk, bulk ZeroBounce, or full enrichment run until a bounded pilot proves correctness and economics;
- cancellation must not leave a run falsely `running` or falsely `complete`;
- fail-soft UI counters may not silently report zero/success when authority or data is unavailable;
- all test fixtures must remain isolated from production and normal operator views.

---

## 18. Required task decomposition

Create the smallest coherent task series that closes the program end to end. Aim for approximately 7-10 implementation/activation tasks, not dozens of fragments and not one unreviewable mega-task.

At minimum, the decomposition must resolve these workstreams, whether separately or through justified combinations:

1. **Program truth and authority convergence** — existing-task reconciliation, one orchestrator, worker/scheduler truth, retired-path cleanup, truthful UI status.
2. **South Florida merchant source registry and ingestion** — DBPR/county operating-location sources, refresh/delta handling, immutable source evidence.
3. **Canonical organization/location identity** — business/location projection, aliases, Sunbiz corroboration, dedupe and conflict review.
4. **Qualification policy v2 and cohort builder** — county/vertical/trigger controls, scoring, budgets, representative cohort selection.
5. **Free enrichment and processor intelligence** — make existing website/RDAP/JSON-LD/contact-page/POS detection durably scheduled and observable.
6. **Paid provider result chain** — current Serper/Outscraper/Apollo APIs, usable encrypted evidence, stage-to-stage chaining, arbitration, economics.
7. **Winner-only email validation** — local prefilter, final-candidate provider validation, status semantics, catch-all/unknown handling, cost controls.
8. **Master-lead staging and promotion** — safe pre-contact pool, dedupe, readiness, canonical promotion, GHL boundary.
9. **Operator UI, observability, and mobile workflow** — one coherent Lead Ops control surface, source-to-promotion evidence, queue/runtime health.
10. **Bounded activation and exact-release certification** — 100/500/1,000 cohort ladder, stop conditions, cost/yield/conversion evidence, no outreach.

If an existing task such as CRO-08A already owns a workstream, author a continuation/amendment rather than a duplicate. If two workstreams share the same schema, authority, writer, and release gate, combine them. Split tasks where production activation, paid transport, schema ownership, or rollback risk requires an independent gate.

---

## 19. Dependency and concurrency rules

Return a dependency graph and execution waves.

Default dependency logic to verify:

- program truth/authority convergence precedes activation;
- source ingestion and provider-chain repair may be parallel only if their schema contracts are frozen first;
- canonical organization/location identity precedes broad master-lead promotion;
- qualification v2 precedes scaled paid enrichment;
- free enrichment precedes paid-provider expansion;
- Apollo person enrichment requires resolved organization/domain prerequisites;
- paid email validation follows candidate selection;
- UI may be developed against frozen contracts but cannot claim runtime readiness before workers are proven;
- activation certification is last;
- no full crosswalk rerun precedes a representative end-to-end pilot.

For every parallel wave identify shared-file, migration, schema, queue, and UI conflict risks.

---

## 20. Format required for every authored build task

Write each task as a complete, independently usable Liberty Bancard Replit master task—not a one-paragraph ticket. Each task must include:

1. exact title and provisional/final task ID;
2. type: PRE-FLIGHT + BUILD, RUNTIME ACTIVATION, or CERTIFICATION;
3. repository and verified baseline SHA;
4. What and Why;
5. audited baseline and existing-task relationship;
6. in-scope behavior;
7. explicitly out-of-scope behavior;
8. exact files/services/tables/routes/components likely affected;
9. canonical authority and writer ownership;
10. schema/migration requirements and migration-head handling;
11. data lifecycle and state machine;
12. provider/API/economic requirements;
13. authorization, privacy, compliance, and outbound invariants;
14. queue/scheduler/retry/idempotency/recovery requirements;
15. desktop and mobile UI/UX requirements;
16. observability, audit, and reconciliation requirements;
17. exact acceptance criteria;
18. required tests and disposable-environment certification;
19. production verification packet;
20. rollout ladder, stop conditions, and rollback/recovery;
21. dependencies and parallelization constraints;
22. Definition of Done.

Every task must name concrete acceptance assertions. Avoid vague language such as “ensure,” “properly,” “robust,” “improve,” or “as needed” without a measurable condition.

---

## 21. Required preflight deliverables

Return all of the following before creating or finalizing task records:

### A. Executive verdict

State whether the program is `BUILD-READY`, `BUILD-READY WITH CORRECTIONS`, or `NOT BUILD-READY`, and why.

### B. Verified facts and corrections matrix

Include every claim from Section 5 with status, current value, repository/runtime evidence, and consequence.

### C. Existing capability matrix

For every named UI action/provider/worker show: present, reachable, scheduled, authorized, writes usable data, reconciles, operator-visible, and production-proven.

### D. Canonical data-flow map

Show current flow and target flow. Identify every dead end, parallel writer, discarded provider result, incompatible identity boundary, and premature contact/outbound mutation.

### E. Source strategy

Rank the South Florida lead sources by merchant value, freshness, operating-location quality, expected cost, and implementation difficulty.

### F. Provider economics plan

Show the proposed waterfall, prerequisites, maximum cost exposure, expected measurable yield, and skip conditions. Never invent vendor pricing or account balances.

### G. Crosswalk/reconciliation finding

Explain exactly why the prior match yield was poor and the preconditions for a useful rerun.

### H. Task coverage matrix

Map every confirmed finding and required capability to exactly one owning task. No orphan finding and no duplicate ownership.

### I. Complete task series

Provide every full task prompt using Section 20.

### J. Dependency graph and execution waves

Name what can run in parallel and what cannot.

### K. Operations-only runbook items

Separate tasks that require code from deployment/configuration/data operations that require no build.

### L. Decisions genuinely requiring owner approval

Ask only decisions that materially change cost, risk, source legality, business policy, or rollout scope. Do not ask questions that repository evidence can answer.

---

## 22. Task creation behavior

First complete the audit and coverage/dependency matrices. Then author the full tasks.

If Replit project-task creation tools are available:

- create tasks only after the matrix proves there is no duplicate or conflicting task;
- use verified available task numbers;
- preserve the full master-task content;
- keep every created task in planning/preflight status;
- do not start Build Mode;
- report the exact created task IDs and titles.

If task creation tools are unavailable or task-number availability is uncertain:

- do not invent numeric IDs;
- return the complete prompts under stable provisional IDs such as `MI-01`, `MI-02`, and so on;
- include a recommended mapping to existing tasks where applicable.

---

## 23. Prohibited shortcuts

Do not:

- recommend another full quality-v1 run as a prerequisite;
- recommend validating all 137,000+ emails;
- recommend rerunning the 1.9-million-row identity crosswalk before repairing the lifecycle;
- claim that Apollo is fully wired because an adapter or API key exists;
- claim that OpenAI validates emails;
- treat MX success as mailbox validity;
- treat Sunbiz registration as an active merchant location;
- populate `master_leads` merely to make its count nonzero;
- create contacts before qualification/promotion;
- weaken deterministic identity thresholds to manufacture match volume;
- discard usable provider output while marking enrichment successful;
- build a second scheduler, second canonical writer, or second enrichment factory without retiring or formally superseding the first;
- hide failures behind zero counters, generic success percentages, or canned AI output;
- use production provider calls, production writes, migrations, or outbound sends during this preflight;
- split one coherent correction into unnecessary microtasks;
- combine source ingestion, canonical identity, paid activation, and outbound into one unsafe mega-task.

---

## 24. Final response and stopping rule

Finish with:

1. exact audited HEAD and migration head;
2. program verdict;
3. corrected present-state summary;
4. number of existing tasks closed/amended/superseded;
5. number of genuinely new tasks;
6. task list in dependency order;
7. parallel execution waves;
8. operations-only items;
9. owner decisions, if any;
10. the exact next task to run first and why.

Then stop. Do not implement, migrate, activate providers, run a census, validate emails, rerun the crosswalk, promote leads, create GHL contacts, enroll sequences, or publish.

