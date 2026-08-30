# LIBERTY BANCARD — CRO-03D PRODUCTION ACTIVATION & EXACT-RELEASE CERTIFICATION

## MASTER REPLIT PREFLIGHT + PRODUCTION OPERATIONS + CERTIFICATION PROMPT

## 1. Mode

This is a narrowly bounded production activation and exact-release certification task.

It begins only after Task #1731 / CRO-03C has been reviewed, merged, and is available as one immutable production-deployable artifact. CRO-03D does not rebuild CRO-03C, create a second live-provider path, or turn enrichment into a recurring operation.

Perform the work in this order:

1. Read-only preflight and evidence capture.
2. Exact-artifact deployment and migration verification.
3. Credential, commercial-policy, approval, and inventory readiness.
4. Exact production runtime attestation.
5. Applicable real-provider micro-canaries.
6. The globally unique `cro03c_initial_v1` batch.
7. Current-generation winning-email ZeroBounce validation.
8. Exact accounting, projection, and outbound-effect reconciliation.
9. Final signed production certification packet.

Do not mark CRO-03D complete unless every applicable production requirement has real exact-release evidence. A missing credential, approval, price schedule, worker, or runtime receipt is a fail-closed blocker—not permission to fabricate, bypass, or downgrade evidence.

## 2. Task Identity and Dependency Boundary

Task name:

> CRO-03D — Production Activation & Exact-Release Certification

Hard prerequisite:

> Task #1731 / CRO-03C is merged with all migrations, queue-owned dispatch, provider-specific accounting, validation authorization, causal effect fences, and disposable certification complete.

Drafting baseline observed on 2026-08-30:

- `origin/main`: `1e2783d55a1f347567bc770e71ebb4ec030c93e7`
- Migration head: `0202_cro03c_transport_invocation_checkpoint.sql`
- Commit subject: CRO-03C governed live activation completion

These values are evidence of the authoring baseline only. At execution time, recapture and freeze the actual merged #1731 commit, tree, migration journal, recipe, activation-policy schema, provider manifest, queue topology, and certification-suite state. Never silently substitute a later unrelated `main` SHA for the exact reviewed CRO-03C artifact.

CRO-03D owns production activation evidence. It does not own:

- CRO-03A candidate admission;
- CRO-03B recipe execution design or historical denial evidence;
- CRO-03C live authority, dispatcher, provider adapters, or initial-batch singleton implementation;
- CRO-08A recurring candidate/enrichment scheduling;
- CR-04 campaign eligibility;
- CR-06 campaign preparation or release;
- GHL synchronization;
- email, SMS, RVM, or campaign sending;
- global outbound-pause mutation.

## 3. What and Why

CRO-03C deliberately merged fail-closed without consuming its one-time production batch. CRO-03D exists because production deployment, owner-held credentials, signed approvals, exact runtime identities, real provider I/O, real billing receipts, and the irreversible singleton batch can only be proven after the implementation has been merged and deployed.

The objective is to convert:

> `SAFE TO MERGE — RUNTIME VERIFICATION PENDING`

into:

> `CRO-03D COMPLETE — EXACT-RELEASE PRODUCTION CERTIFIED`

while outreach remains:

> `PAUSED / NOT AUTHORIZED`

## 4. Non-Negotiable Production Safety Rule

CRO-03D is an operator/certification task against the exact merged artifact. It is not a convenient place to patch production code and then certify a different, unreviewed working tree.

Before any irreversible production action:

- require a clean repository;
- identify the exact reviewed #1731 merge SHA and tree hash;
- prove the deployment was produced from that artifact;
- prove the migration head is the exact expected head;
- prove all production web and worker processes belong to the attested fleet;
- prove shared Redis and the production database are the intended instances;
- prove global outbound is already paused;
- prove signed approvals and price schedules bind the same release, recipe, stage plan, providers, caps, and environment;
- prove the command and runtime attestations are unexpired and unrevoked.

If a genuine code or schema defect prevents safe activation:

1. Stop before provider I/O or singleton consumption.
2. Preserve all evidence and state.
3. Report the exact defect and affected authority.
4. Do not use direct SQL, disabled checks, ad hoc scripts, or a broader admin token to bypass it.
5. Require the defect to be fixed, reviewed, merged, and deployed as a new exact artifact.
6. Restart CRO-03D preflight against that new artifact and obtain fresh release-bound approvals where required.

Never certify a locally modified, uncommitted, preview, development, or mixed-release deployment.

## 5. Mandatory Preflight VFC

Before performing writes or production I/O, publish a Verified Fact Check table with columns:

| ID | Claim | Verdict | Exact evidence | Operational consequence |
|---|---|---|---|---|

At minimum, verify these claims:

| ID | Claim to verify |
|---|---|
| VFC-01 | #1731 is merged and the exact reviewed commit/tree is identifiable. |
| VFC-02 | All CRO-03C migrations are present, ordered, immutable, and applied in production. |
| VFC-03 | Historical CRO-03B denial evidence remains immutable and excluded from live execution. |
| VFC-04 | The CRO-03C queue owner, workers, recovery path, and job registry are deployed and healthy. |
| VFC-05 | The production release SHA is available to both web and workers through the implemented attestation authority. |
| VFC-06 | Production web and worker fleet identities match a signed deployment inventory. |
| VFC-07 | Production database and shared Redis are reachable by the attested runtime and are not disposable/test instances. |
| VFC-08 | Global outbound is readable as paused and CRO-03D has no authority to change it. |
| VFC-09 | Required credential presence can be verified without disclosing credential values. |
| VFC-10 | Every billable provider has an owner-approved, versioned price schedule, unit semantics, currency, and cap. |
| VFC-11 | Operator, data, finance, and legal approvals are independently signed, in scope, unexpired, and unrevoked. |
| VFC-12 | The activation policy binds the exact approval receipts, release, recipe, stage-plan, provider controls, price schedules, and environment. |
| VFC-13 | `cro03c_initial_v1` has never been created or consumed in production. |
| VFC-14 | Micro-canaries cannot project canonical CRM data or create readiness/scoring/outreach effects. |
| VFC-15 | Initial-batch continuation owns canonical projection, winning-email validation, readiness, and one coalesced scoring hook. |
| VFC-16 | ZeroBounce requires command-bound current-generation authorization at claim, reservation, and immediately before I/O. |
| VFC-17 | Provider dispatch ambiguity is quarantined and cannot be blindly retried. |
| VFC-18 | Provider reservations and settlements can be reconciled from immutable production receipts. |
| VFC-19 | CRO-03C-linked GHL, campaign, enrollment, sender, email, SMS, and RVM effects are database/code fenced. |
| VFC-20 | No recurring scheduler or successor-batch authority is introduced by CRO-03D. |

Verdicts must be `CONFIRMED`, `PARTIAL`, `FALSE`, `NOT APPLICABLE`, or `BLOCKED`, with file/route/table/receipt evidence. Any false or blocked safety prerequisite stops activation.

## 6. Required Repository and Runtime Census

Recapture the actual owners and interfaces. Do not trust frozen line numbers. Inspect at minimum:

- migrations `0195` through the actual current CRO-03C migration head;
- `shared/schema.ts` CRO-03C tables and constraints;
- CRO-03C live execution, live worker, provider executors, initial continuation, effect fence, runtime heartbeat, deployment inventory, and approval artifact services;
- CRO-03C admin routes;
- provider manifest and approved callers;
- queue manager, job registry, worker entrypoint, leases, and recovery;
- SafeEgress production transport and hop receipts;
- SerperGateway billing/circuit integration;
- Outscraper, Apollo, OpenAI/AI, and ZeroBounce provider controls;
- winning-email validation and readiness/scoring continuation;
- `scripts/certify-cro03c.ts` and all CRO-03C certification suites;
- CI and pre-deploy suite registration;
- global outbound pause authority and causal effect-fence readers.

Publish an authority map identifying the sole writer for:

- activation policies;
- signed approval imports and revocations;
- signed deployment inventories and revocations;
- runtime attestations;
- CRO-03C commands and cancellations;
- provider operations, attempts, receipts, reservations, and settlements;
- stage dispositions;
- initial-batch membership;
- projection receipts;
- validation authorization and ZeroBounce settlement;
- readiness/scoring continuation;
- outbound-effect reconciliation;
- final production certification packet.

## 7. Source-of-Truth and Non-Duplication Contract

Use the merged CRO-03C authorities exactly as designed.

Do not:

- create new production activation tables when existing CRO-03C tables already own the state;
- add another provider context or direct provider client;
- bypass admin APIs with direct database writes;
- create generic ZeroBounce validation intents;
- reuse legacy `cro03_enrichment_items` or historical provider-denied CRO-03B rows;
- create a second initial-batch key;
- treat logs, screenshots, shell output, or provider dashboards as substitutes for durable application receipts;
- treat credential presence as provider readiness;
- treat a `200` response as identity, parsing, billing, or settlement success;
- treat local RDAP/JSON-LD evidence processing as a real external-provider canary;
- label a skipped or non-applicable provider as passed.

Provider dashboards and deployment consoles may corroborate evidence, but the certification packet must bind them to canonical immutable application receipts.

## 8. Scope

In scope:

- deploy the exact merged #1731 artifact and migrations;
- configure or verify production secrets through the approved secret-management path;
- verify provider accounts, billing status, price schedules, budgets, and circuits;
- import signed deployment inventory and approval artifacts;
- create the production activation policy;
- create fresh exact-release runtime attestations;
- execute applicable real-provider micro-canaries under frozen caps;
- execute the one globally unique initial batch;
- execute command-bound current-generation winning-email validation;
- reconcile evidence, identity, projection, readiness/scoring, economics, and forbidden effects;
- create the final certification packet;
- leave outreach paused and schedule no successor.

Out of scope:

- feature development unrelated to a proven activation blocker;
- recurring scheduling or continuous replenishment;
- changing provider recipe policy ad hoc;
- approving new AI prompts/models during an activation run;
- bulk enrichment beyond the single bounded initial batch;
- campaign creation, campaign preparation, campaign release, or outreach;
- GHL writes;
- global pause changes;
- production-data repair or cleanup;
- historical migration edits;
- credential creation, billing-plan purchase, legal approval, or private-key signing on behalf of human owners.

## 9. No-Code Default and Change Control

The default expected CRO-03D diff is operational evidence and a certification packet, not application code.

Before changing any tracked source or schema, prove all of the following:

- the merged exact-release path cannot safely complete without the change;
- the issue is a real defect, not missing configuration, approval, pricing, credential, or operator access;
- no existing authority already supports the operation;
- the change can be reviewed before any live I/O;
- all release-bound evidence will be regenerated after merge and redeploy.

Never edit or replace an applied migration. If a defect requires an additive migration, activation stops until the new artifact is reviewed, merged, deployed, and freshly attested. A code change invalidates the earlier exact-release preflight and any approval whose signed scope includes the prior release or migration head.

## 10. Authorization and Separation of Duties

Respect the existing CRO-03C admin and operator roles. Browser/client input must never be trusted for release SHA, actor identity, fleet identity, claim token, settlement values, pricing authority, or execution context.

Signed approvals must preserve the required independent dimensions:

- operator;
- data;
- finance;
- legal.

Do not collapse four approval dimensions into one admin click. Do not self-sign approval artifacts from the application. The application must not receive or store the private Ed25519 signing keys.

Only trust issuers configured through the implemented trusted-issuer controls, including the exact production equivalents of:

- `CRO03C_TRUSTED_APPROVAL_ISSUERS`;
- `CRO03C_TRUSTED_DEPLOYMENT_INVENTORY_ISSUERS`.

Import signed artifacts through authenticated, CSRF-protected admin routes. Verify issuer, signature, payload hash, scope, validity window, revocation state, replay/idempotency behavior, and exact release/environment binding.

No task agent may invent an approval, impersonate an approver, weaken role gates, or use a service token to stand in for missing owner authorization.

## 11. Exact Artifact Deployment

Freeze an immutable deployment manifest containing:

- exact merged commit SHA;
- tree hash;
- build/artifact identity;
- repository identity;
- migration journal digest and expected head;
- dependency lockfile hash;
- runtime/build configuration hash excluding secret values;
- recipe version and hash;
- provider manifest hash;
- queue topology/configuration hash;
- environment and deployment identity;
- deployment start/completion timestamps;
- operator identity and deployment receipt reference.

Deploy by the normal reviewed production path. Do not deploy from a dirty Replit workspace or from an unmerged task branch.

After deployment:

- verify production reports the exact expected artifact SHA;
- verify migrations completed successfully and the database head matches exactly;
- verify no unexpected later migration or mixed schema exists;
- verify web and worker fleet processes were restarted onto the same attested release, unless independently deployed artifacts are explicitly supported and separately attested;
- verify old workers cannot continue claiming CRO-03C work;
- verify application startup, queue registration, worker heartbeats, DB health, and Redis health.

If production cannot prove the exact release, stop. A source-control SHA displayed in a console is insufficient without runtime and fleet binding.

## 12. Credential and Provider-Account Readiness

Verify presence and usability without ever printing, logging, exporting, or storing secret values in the certification packet.

Inspect the implemented secret names and provider controls, including the production equivalents of:

- `SERPER_API_KEY`;
- `OUTSCRAPER_API_KEY`;
- `APOLLO_API_KEY`;
- `AI_INTEGRATIONS_OPENAI_API_KEY`;
- `AI_INTEGRATIONS_OPENAI_BASE_URL`;
- `ZEROBOUNCE_API_KEY`.

For each potentially applicable provider, record:

- configured/not configured;
- account/environment identity in redacted form;
- account active/suspended state;
- billing enabled/disabled state;
- supported operation type;
- credential health-check result;
- circuit state and control revision;
- price schedule ID/version/hash;
- unit type, currency, and billing semantics;
- per-operation, canary, run, and activation cap;
- approval scope;
- readiness verdict and reason.

Never expose the key, secret prefix, request authorization header, raw provider payload containing PII, or a credential-derived fingerprint that weakens secrecy.

Missing or ambiguous commercial terms block that provider. Do not guess Apollo credits, Outscraper billable-result semantics, OpenAI token prices, ZeroBounce units, or any currency conversion.

## 13. Signed Pricing and Approval Artifacts

Obtain externally signed artifacts from the authorized owners. Their signed scope must bind, as implemented:

- production environment and deployment identity;
- exact artifact SHA and migration head;
- recipe version/hash and stage-plan hash;
- activation revision and policy key;
- provider and operation type;
- price schedule version/hash;
- unit type and currency;
- billing certainty rules;
- maximum units and maximum amount;
- approved handoff/cohort constraints;
- canary stop policy;
- initial-batch maximum size;
- global pause requirement;
- validity interval and expiration;
- cancellation/revocation behavior.

Import artifacts through the canonical admin APIs. Persist signature-verification and import receipts. Prove replay is idempotent and conflicting payloads are rejected.

Create or select exactly one activation policy binding all four required approval receipts and all exact provider price schedules. A receipt outside the release, environment, recipe, stage plan, provider, amount, or time scope is invalid.

## 14. Signed Deployment Inventory

Import a signed production deployment inventory that enumerates every process identity allowed to participate in CRO-03D, including:

- web process/boot identities;
- worker process/boot identities;
- queue roles and queue names;
- expected artifact SHA per process;
- migration head;
- queue topology/configuration hash;
- deployment/environment identity;
- inventory version/hash;
- issued, valid-from, expiration, and revocation data.

The runtime must derive and verify actual process identities. Do not accept browser-supplied or manually typed fleet claims.

Any unknown, stale, expired, wrong-release, wrong-topology, or revoked process blocks live authority. Persist the import and verification receipts.

## 15. Exact Production Runtime Attestation

Create fresh runtime attestation through the canonical server authority only after deployment, inventory import, worker startup, and database migration completion.

Attest:

- exact artifact SHA;
- exact migration head;
- deployment/environment identity;
- web process and boot identity;
- complete expected worker fleet process and boot identities;
- current worker heartbeats;
- queue topology/configuration hash;
- production database identity and successful health probe;
- shared Redis identity and successful health probe;
- recipe, provider manifest, activation policy, and provider-control revisions;
- signed deployment-inventory identity/hash;
- global outbound pause state and pause epoch;
- capture timestamp and short expiry.

Create a new attestation whenever the prior one expires or any bound fact changes. Never extend an expired attestation by editing timestamps.

Immediately before every reservation and immediately before every provider I/O boundary, the worker must revalidate the live authority required by CRO-03C. A stale heartbeat, mismatched release, changed circuit, expired command, revoked approval, lost claim, changed pause epoch, or unreadable dependency denies transport.

## 16. Cohort Selection and PII Boundary

Select production subjects through the canonical eligibility authority. Do not accept wildcards, `--all`, unconstrained database queries, raw contact lists, or browser-supplied execution identities.

For micro-canaries:

- use only explicitly approved targets;
- use the exact provider-specific sample size required by the frozen policy and implementation;
- freeze target membership and hash before execution;
- minimize data sent to each provider;
- persist only opaque stage/subject references outside the protected canonical authority;
- do not project contacts/businesses;
- do not create readiness, scoring, campaign, GHL, or outbound effects.

For the initial batch:

- choose 1–100 fresh eligible CRO-03A handoffs;
- exclude every handoff already admitted to an incompatible or historical denied execution for the same recipe as defined by the merged authority;
- freeze immutable membership and cohort hash;
- require deterministic server-derived stage planning;
- do not add or replace members after command creation;
- do not consume the singleton until all prerequisite canary and authority evidence is complete.

Never put raw email, phone, address, provider query payload, or other PII in command-line arguments, logs, screenshots, task comments, or the final packet.

## 17. Applicable-Provider Matrix

Before running any canary, publish this matrix from current code, signed policy, credentials, recipe, reviewed provider inputs, and selected targets:

| Stage/provider | External I/O? | Applicability | Required evidence | Cap | Verdict |
|---|---:|---|---|---:|---|
| Internal source | No | Recipe/control prerequisite | Immutable zero-cost evidence receipt | 0 | Pending |
| First-party website / SafeEgress | Yes | Only approved public domains with a justified gap | Per-hop/request and terminal crawl receipts | Frozen policy | Pending |
| RDAP | Verify implementation | Do not call it a real provider if current executor consumes frozen local evidence | Evidence provenance and zero-cost receipt | Frozen policy | Pending |
| JSON-LD | Verify implementation | Do not call it external if parsed from approved fetched evidence | Parsing/provenance receipt | Frozen policy | Pending |
| Serper | Conditional | Only unresolved approved search gaps | Gateway request, circuit, billing, identity, and settlement receipts | Frozen policy | Pending |
| Outscraper | Conditional | Only approved unresolved operation/target | Provider operation, result identity, billing, and settlement receipts | Frozen policy | Pending |
| OpenAI / AI | Conditional | Only if reviewed model/system-prompt/prompt hashes are present in the merged allowlists and signed scope | Input-bundle, citation, token, model, output, and cost receipts | Frozen policy | Pending |
| Apollo | Conditional | Only approved organization match with unresolved gap | Organization identity, result, credit/unit, and settlement receipts | Frozen policy | Pending |
| ZeroBounce | Conditional continuation | Winning-email, current-generation, command-bound validation only | Three authority checkpoints, provider result, settlement, readiness receipt | Server-derived | Pending |

Known drafting-baseline caution:

- The merged CRO-03C OpenAI reviewed allowlists were intentionally empty during implementation review. If they remain empty, record OpenAI as `NOT_APPLICABLE_UNAPPROVED_INPUT_BUNDLE`. Do not add an arbitrary model or prompt hash inside CRO-03D.
- RDAP and JSON-LD may be local/frozen-evidence operations rather than real outbound provider calls. Classify them truthfully.
- ZeroBounce must be proven through the winning-email current-generation continuation implemented by CRO-03C. Do not manufacture a generic validation canary.
- The initial batch is not a fan-out through every paid provider. Stage eligibility remains server-derived and evidence-gap driven.

Allowed applicability verdicts:

- `APPLICABLE_READY`;
- `NOT_APPLICABLE_NO_ELIGIBLE_GAP`;
- `NOT_APPLICABLE_UNAPPROVED_INPUT_BUNDLE`;
- `BLOCKED_MISSING_CREDENTIAL`;
- `BLOCKED_COMMERCIAL_TERMS`;
- `BLOCKED_APPROVAL`;
- `BLOCKED_CONTROL`;
- `BLOCKED_RUNTIME`.

Only `APPLICABLE_READY` providers may dispatch. A `NOT_APPLICABLE` verdict requires evidence; it is not a shortcut around a failed canary.

## 18. Micro-Canary Contract

Run micro-canaries sequentially, not as an uncontrolled parallel blast. Run only one provider/stage canary command at a time unless the signed policy and CRO-03C concurrency controls explicitly prove otherwise.

For each applicable canary:

1. Freeze exact targets and target hash.
2. Freeze provider, operation, unit type, currency, price schedule, and caps.
3. Create the command through the authenticated CRO-03C admin API with a unique idempotency key and exact confirmation phrase.
4. Bind the active activation revision and fresh runtime attestation.
5. Confirm command expiration exceeds the bounded run but is not open-ended.
6. Confirm the global pause epoch and effect fence.
7. Let the canonical queue owner claim and execute it.
8. Do not invoke provider clients directly from a shell or route.
9. Observe immutable operation, attempt, reservation, pre-I/O checkpoint, result, evidence, settlement, and terminal stage receipts.
10. Reconcile before starting the next provider.

Each canary verdict must distinguish:

- transport success;
- parse/schema success;
- target/organization identity success;
- legitimate `no_result`;
- evidence yield;
- malformed or uncited output;
- budget/cap denial;
- provider rejection;
- ambiguous dispatch or billing;
- authority cancellation/expiry;
- final economic reconciliation.

A legitimate `no_result` may prove transport but does not automatically satisfy yield policy. Apply the exact signed denominator, threshold, and stop policy. Do not reinterpret two failures, zero yield, or identity conflict without the frozen definitions.

Micro-canaries must produce zero canonical projections and zero readiness/scoring/outreach effects.

## 19. Provider-Specific Execution Rules

### 19.1 Internal source and zero-cost evidence

- Persist truthful zero-cost operation/evidence receipts.
- Never describe a local evidence evaluation as a real external-provider call.
- Require successful internal-source admission evidence before the initial batch if the merged authority requires it.

### 19.2 First-party website / SafeEgress

- Use only the production DNS-pinned transport installed by CRO-03C.
- One crawl operation may include robots retrieval, homepage, up to the approved page limit, and bounded redirects.
- Enforce domain, scheme, DNS, IP, redirect, content type, response size, timeout, and page-count limits.
- Re-resolve and pin every network hop as implemented.
- Persist per-hop/request receipts and one terminal crawl receipt.
- Never fall back to generic `fetch()` after a one-time DNS check.

### 19.3 Serper

- Create the CRO-03C provider operation before dispatch.
- Preserve SerperGateway circuit and billing-window authority.
- Link the gateway request and result into CRO-03C lineage.
- Do not double-reserve or double-settle the same request.

### 19.4 Outscraper and Apollo

- Use only the CRO-03C generation/stage-bound context.
- Preserve exact target and organization matching.
- Settle actual contract-defined units and amounts.
- Quarantine unknown or ambiguous billing.
- Never infer credit semantics from a response count or legacy estimate.

### 19.5 OpenAI / AI

- Run only if the exact reviewed model, system prompt, prompt, output schema, and evidence-bundle hashes are already approved by merged code and signed policy.
- Reserve token and amount ceilings before I/O.
- Persist actual model, tokens, cost, citations, parsing, and output receipts.
- Reject malformed, uncited, wrong-model, over-cap, or unreviewed output.
- If reviewed allowlists remain empty, the correct verdict is non-applicable, not a last-minute code edit.

### 19.6 ZeroBounce

- Use only `purpose='cro03_winning_email'` or the exact implemented equivalent.
- Require current contact subject generation and normalized-email hash.
- Require command/run/generation/activation/release binding.
- Revalidate authority at claim, reservation, and immediately before I/O.
- Reject expired, revoked, stale-generation, generic-marketing, or mismatched-email authority.
- Persist provider result, reservation, settlement, contact-generation outcome, readiness continuation, and coalesced scoring evidence.

## 20. Canary Stop Policy

Stop the activation immediately upon:

- exact-release or migration mismatch;
- inventory, heartbeat, queue topology, DB, or Redis mismatch;
- command/approval/attestation expiry or revocation;
- global pause unreadable, changed, or not paused;
- provider circuit open or control revision mismatch;
- missing/unknown price schedule or billing semantics;
- cap exhaustion or reservation imbalance;
- wrong target/organization identity;
- malformed or uncited output;
- provider response outside the frozen schema;
- ambiguous dispatch or billing;
- unexpected canonical projection during a micro-canary;
- any linked outreach/GHL/campaign effect;
- any stop threshold in the signed policy.

Cancel unstarted commands through the canonical cancellation authority where appropriate. Do not delete or rewrite receipts. Do not blindly retry an operation that might have crossed the dispatch boundary.

## 21. Globally Unique Initial Batch

Only after every applicable provider canary and all admission gates pass, create the single production initial-batch command through the canonical admin API.

Required rollout key:

> `cro03c_initial_v1`

Required guarantees:

- the key is globally unique in the production database;
- no prior row exists, including failed, cancelled, or abandoned attempts;
- membership contains 1–100 fresh eligible handoffs;
- membership and cohort hash are immutable;
- the command binds exact release, migration, activation, runtime attestation, recipe, stage plan, approvals, and pause evidence;
- provider and validation caps are server-derived where implemented;
- stages execute only when the frozen eligibility decision says they are eligible;
- skipped stages create no reservation, provider operation, attempt, or I/O;
- one handoff/stage cannot be claimed twice;
- no successor command, recurring job, cron entry, delayed self-schedule, or queue repeat is created;
- cancellation, failure, or activation revision change can never create a second `cro03c_initial_v1` batch.

The singleton is irreversible even if the run later fails. Therefore perform one final read-only readiness ceremony immediately before command creation and capture its receipt in the final packet.

Do not change the key, create `v2`, delete a failed singleton, or relabel a micro-canary as the initial batch to obtain another attempt.

## 22. Initial-Batch Continuation and Projection

Allow only the merged CRO-03C continuation authority to perform:

1. frozen stage-plan execution;
2. immutable evidence capture;
3. arbitration and review-required disposition;
4. canonical business resolution/replay;
5. local contact creation/replay;
6. source-event persistence;
7. authority-mediated contact/business link decision;
8. local compare-and-set field projection;
9. projection receipts;
10. winning-email validation intent;
11. command-bound current-generation ZeroBounce;
12. readiness continuation;
13. exactly one coalesced scoring request;
14. terminal effect-fence reconciliation.

Do not use CRO-03D scripts or direct SQL to create contacts, businesses, source events, field decisions, validation intents, readiness state, or scoring jobs.

Ambiguous identity remains review-required. A failed or missing provider result is not permission to overwrite stronger canonical evidence. Replays must preserve immutable decisions and must not duplicate hooks.

## 23. Current-Generation ZeroBounce Certification

For every winning email eligible for validation in the initial batch, prove:

- the validation intent belongs to the projected current contact generation;
- the normalized email hash matches the authorization;
- the authorization binds the exact command, run, live generation, activation revision, release, migration, and provider-control revision;
- authorization was valid and rechecked at claim;
- authorization was valid and rechecked before reservation;
- authorization was valid and rechecked immediately before provider I/O;
- the reservation did not exceed the server-derived aggregate cap;
- actual provider units and amount settled exactly once;
- stale, revoked, cancelled, superseded, and generic intents could not dispatch;
- the result updated only the current generation through the canonical validation authority;
- readiness remained blocked until the current result was terminal;
- exactly one coalesced scoring hook was created after terminal continuation;
- no generic validation/readiness/scoring duplicates were created.

If no batch member produces an eligible winning email, do not falsely claim ZeroBounce runtime certification. Mark the requirement `NOT PROVEN — NO ELIGIBLE CURRENT-GENERATION EMAIL` and do not call CRO-03D complete unless the governing approval/policy explicitly defined and approved a separate exact-purpose certification path supported by the merged code.

## 24. Provider Economics and Reconciliation

For every operation, reconcile:

- provider and operation type;
- unit type and currency;
- price schedule version/hash;
- reserved maximum units and amount;
- actual requested and returned units;
- settled units and amount;
- released unused reservation;
- provider receipt/reference;
- billing certainty;
- duplicate-request/idempotency evidence;
- terminal reconciliation disposition.

Required invariant:

> Sum of settled amounts + released reservations + still-valid quarantined ambiguity must exactly explain every reservation, without negative balances, double settlement, orphaned charges, or unbounded exposure.

Provider-specific ownership remains canonical:

- SerperGateway owns its gateway circuit/billing window and is linked without double accounting.
- Outscraper and Apollo settle under their exact contract semantics.
- AI settles actual approved tokens/model cost.
- ZeroBounce settles through validation provider controls.
- internal and approved local-evidence operations produce truthful zero-cost receipts.

An ambiguous charge or possible dispatch is terminally quarantined for manual reconciliation. It is not silently released or retried.

## 25. Result, Evidence, and Projection Reconciliation

For every micro-canary and initial-batch member, produce a lineage record from:

> signed authority → command → run → generation → handoff → stage plan → claim/fence → provider operation → attempt/checkpoint → result/evidence → reservation/settlement → arbitration → projection or review disposition → validation → readiness/scoring → effect reconciliation

Prove:

- every eligible stage has exactly one terminal disposition;
- every skipped stage has zero I/O artifacts;
- every dispatched stage has one durable operation and explainable attempt history;
- every provider result is linked to its exact target without raw PII duplication;
- every accepted field is supported by evidence and canonical arbitration;
- every rejected/conflicting field remains auditable;
- every projection is compare-and-set and replay-safe;
- every item is terminal, blocked, review-required, or quarantined with a precise reason;
- no orphaned claims, leases, operations, reservations, validation intents, or continuation jobs remain.

## 26. Causal No-Outbound Certification

Global snapshots alone are insufficient. Use the merged CRO-03C effect fence and causal identifiers.

Prove for the exact commands, runs, generations, handoffs, contacts, businesses, and cohort:

- `effect_authorized=false` for all outreach effects;
- zero CR-04 cohort mutation caused by CRO-03D;
- zero CR-06 campaign preparation or release;
- zero campaign or sequence enrollment;
- zero GHL mutation;
- zero sender activation;
- zero email attempt;
- zero SMS attempt;
- zero RVM attempt;
- zero global/channel pause mutation;
- no successor batch scheduled.

Capture pre/post pause epochs and relevant global observations. If a global counter moves during the certification window but no CRO-03D-linked forbidden effect exists, do not falsely attribute it. Stop and record:

> `INCONCLUSIVE_PENDING_RECONCILIATION`

until causality is resolved.

Any CRO-03D-linked forbidden effect is a hard certification failure and incident condition. Preserve evidence and do not continue activation.

Final outreach status must remain exactly:

> `PAUSED / NOT AUTHORIZED`

## 27. Concurrency, Recovery, and Dispatch Ambiguity

Observe and certify the merged production behavior for:

- duplicate admin submissions with the same idempotency key;
- conflicting submissions with reused keys;
- simultaneous command or stage claims;
- claim-token and execution-fence enforcement;
- lease expiry before dispatch;
- cancellation immediately before reservation;
- cancellation immediately before I/O;
- worker restart before dispatch;
- worker restart after possible dispatch;
- shared Redis interruption;
- worker heartbeat expiry;
- runtime attestation expiry;
- provider timeout after request transmission;
- settlement recovery;
- continuation replay.

Do not deliberately crash production or disrupt shared infrastructure merely to demonstrate a test already certified in disposable environments. Production evidence should prove normal recovery and any naturally encountered failure. The final packet must include the disposable certification receipts from #1731 for destructive fault cases and real production receipts for the executed path.

No uncertain attempt may be reclaimed into blind duplicate I/O. Allowed recovery outcomes are:

- completed and reconciled;
- confirmed not dispatched and safely releasable;
- ambiguous billing/result quarantined for manual reconciliation.

## 28. Security, Privacy, and Evidence Handling

All production operations must preserve:

- admin authentication and CSRF protections;
- role and capability checks;
- 404-style IDOR handling where applicable;
- request/body limits;
- strict command schemas;
- opaque references instead of duplicated raw PII;
- log and audit redaction;
- secret non-disclosure;
- signed-artifact verification;
- immutable evidence and revocation history.

The final packet must not contain:

- API keys or secret fragments;
- authorization headers;
- session cookies or CSRF tokens;
- private signing keys;
- raw provider payloads with PII;
- raw emails, phone numbers, addresses, or protected merchant data;
- Redis/database credentials;
- unredacted deployment environment dumps.

Use opaque IDs, hashes, counts, redacted account identifiers, and canonical receipt references.

## 29. Production Execution Phases

### Phase 0 — Freeze the exact task baseline

- Capture #1731 merge SHA/tree, migration head, diff boundary, suite results, and deployment target.
- Confirm clean repository and no unreviewed code.
- Publish the preflight VFC and authority map.
- Stop if the exact artifact cannot be identified.

### Phase 1 — Verify production prerequisites

- Verify trusted issuers, credential presence, provider accounts, commercial terms, budgets, circuits, global pause, DB, Redis, queue topology, and worker configuration.
- Classify each provider using the applicability matrix.
- Return owner-action blockers without exposing secrets.

### Phase 2 — Import signed authority

- Import signed deployment inventory.
- Import independent operator/data/finance/legal approval artifacts.
- Import or select exact signed price schedules.
- Create the activation policy binding them.
- Verify replay, scope, expiry, and revocation.

### Phase 3 — Deploy and attest

- Deploy the exact merged artifact normally.
- Apply and verify migrations.
- Restart/replace the exact web and worker fleet.
- Verify startup, DB, Redis, queue, and heartbeat health.
- Create a fresh short-lived runtime attestation.

### Phase 4 — Execute applicable micro-canaries

- Freeze provider-specific targets and caps.
- Run one applicable canary at a time through authenticated admin commands and canonical queue workers.
- Re-attest as required.
- Reconcile each provider completely before proceeding.
- Stop on the first failed kill line.

### Phase 5 — Final singleton readiness ceremony

- Confirm every applicable canary passed.
- Confirm every non-applicable provider has a valid evidence-backed reason.
- Confirm approvals, pricing, controls, attestation, inventory, workers, DB, Redis, pause, and caps are current.
- Confirm `cro03c_initial_v1` does not exist.
- Freeze 1–100 fresh handoffs and immutable cohort hash.
- Persist the readiness receipt.

### Phase 6 — Execute `cro03c_initial_v1`

- Create the single command through the canonical authenticated route.
- Allow only the queue-owned dispatcher to execute it.
- Monitor bounded progression without direct state mutation.
- Stop new dispatch on any kill line while preserving in-flight reconciliation.

### Phase 7 — Validate and continue

- Observe projection and winning-email intent creation through canonical authorities.
- Execute current-generation command-bound ZeroBounce.
- Observe readiness and exactly one coalesced scoring continuation.
- Reconcile review-required and ambiguous items without forcing completion.

### Phase 8 — Reconcile and certify

- Reconcile all provider operations and accounting.
- Reconcile all stage dispositions, results, evidence, arbitration, projections, validation, readiness, and scoring.
- Reconcile causal outbound-effect fences.
- Confirm no successor schedule or batch.
- Produce and sign/hash the final certification packet.

## 30. Production Command and Operator-Session Rules

Use only the authenticated production operations supported by the merged implementation.

The production certification CLI may be a denial-first preflight/argument validator rather than an autonomous live executor. Do not remove or bypass any guard such as a requirement for committed approval receipts and an authenticated exact-release operator session merely to make the command run.

If live command creation is implemented through admin APIs:

- use an authenticated admin session;
- preserve CSRF protections;
- use exact opaque IDs;
- use unique idempotency keys;
- use exact confirmation strings;
- use bounded arrays and server-validated limits;
- let the server derive actor, release, fleet, claim, stage, price, and execution context;
- never embed credentials or raw PII in the command.

Reject:

- arbitrary or nonexistent IDs;
- wildcards;
- `--all`;
- unbounded values;
- wrong environment;
- wrong release;
- stale attestation;
- missing signed approval;
- browser-supplied actor/release/pricing/fleet state;
- direct provider calls;
- direct SQL activation.

## 31. Kill Lines

Stop before the next irreversible action if any of these is true:

1. The deployed artifact is not the exact reviewed #1731 SHA/tree.
2. The production migration head is missing, ahead unexpectedly, divergent, or unverifiable.
3. A web or worker process is absent from the signed inventory or runs the wrong release/topology.
4. DB or shared Redis identity/health is not exact and readable.
5. Global outbound is not paused, is unreadable, or changes unexpectedly.
6. An approval, inventory, command, attestation, or price schedule is missing, invalid, expired, mismatched, or revoked.
7. A provider credential/account/billing state is missing or ambiguous.
8. Provider unit type, currency, price, or billing semantics are guessed.
9. A provider operation exceeds its approved units or amount.
10. A micro-canary projects canonical data or creates readiness/scoring work.
11. A skipped stage creates an attempt, reservation, or I/O.
12. Target or organization identity is ambiguous or incorrect.
13. An AI model/prompt/input bundle is not already reviewed and allowed.
14. ZeroBounce authority is generic, stale-generation, mismatched, expired, or not revalidated at all three checkpoints.
15. Dispatch or billing is ambiguous and the system attempts an automatic retry.
16. Provider reservation and settlement cannot be balanced exactly.
17. `cro03c_initial_v1` already exists in any state.
18. More than 100 initial-batch members are requested or membership is mutable.
19. Any CRO-03D-linked GHL, campaign, enrollment, sender, email, SMS, or RVM effect occurs.
20. A successor batch, repeatable queue job, cron, or recurring schedule is created.
21. Historical CRO-03B denial evidence is changed or reused.
22. Direct SQL or a bypass script is proposed to manufacture authority or evidence.
23. Raw PII, secrets, or private signing material appears in logs or evidence.
24. A code change is made without invalidating and restarting exact-release certification.

## 32. Required Gates Before Production I/O

Before the first real provider call, rerun and record against the exact merged artifact:

- TypeScript compilation with incremental output disabled;
- migration integrity;
- empty-database migration certification;
- prior-head upgrade certification;
- migration replay and schema parity;
- queue ownership/compliance;
- CI suite-manifest validation;
- CRO-03 static, worker, continuation, provider, manifest, Outscraper, Apollo, SafeEgress, validation, and effect-fence suites;
- paid-provider and transport scans;
- CRO-03B legacy-writer protection;
- disposable PostgreSQL and isolated-Redis integration certification;
- production build;
- `git diff --check`;
- clean exact-release working tree;
- current production health check.

No gate may silently be skipped. Distinguish:

- exact-release pass;
- unchanged documented baseline failure;
- CRO-03D-affecting failure;
- unavailable evidence.

Any CRO-03D-affecting failure blocks live I/O. An unrelated baseline failure must be proven against the untouched exact artifact and recorded; it cannot be used to waive a CRO-03D gate.

## 33. Final Production Certification Packet

Produce one immutable, hash-addressed certification packet with a redacted operator-readable rendering. It must contain or reference:

### Identity and deployment

- task ID and CRO-03D identifier;
- exact #1731 merge SHA and tree hash;
- build/artifact and deployment IDs;
- migration journal digest and head;
- recipe, provider manifest, stage-plan, queue-topology, and configuration hashes;
- signed deployment-inventory ID/hash;
- web and worker fleet identities;
- DB and Redis attestation receipts;
- runtime attestation IDs and validity windows.

### Authority

- activation revision and policy ID/hash;
- operator/data/finance/legal receipt IDs, issuers, validity, and verification status;
- price schedule IDs/hashes;
- provider control revisions;
- command IDs, idempotency keys, expiration, and cancellation state;
- global pause state and epochs.

### Micro-canaries

- complete applicability matrix;
- exact target/cohort hashes and sample counts;
- per-provider operation, attempt, result, evidence, and terminal receipt IDs;
- transport, parsing, identity, yield, and stop-policy verdicts;
- reservation and settlement reconciliation;
- proof of zero canonical projections and hooks.

### Initial batch and continuation

- singleton row/receipt for `cro03c_initial_v1`;
- immutable membership count and cohort hash;
- exact command/run/generation IDs;
- stage-disposition totals;
- provider-operation and evidence totals;
- projection/review-required/conflict totals;
- winning-email validation totals;
- current-generation ZeroBounce receipts;
- readiness and coalesced-scoring receipts;
- outstanding ambiguous/manual-reconciliation items.

### Economics

- totals by provider, operation, unit type, currency, and price schedule;
- reserved, settled, released, and quarantined amounts;
- provider receipt references;
- proof of no double reservation or settlement;
- final balance invariant verdict.

### No-outbound evidence

- pre/post pause epochs;
- causal effect-fence receipts;
- CRO-03D-linked forbidden-effect counts, all zero;
- relevant global observation reconciliation;
- confirmation that no successor batch or recurring schedule exists;
- final status `PAUSED / NOT AUTHORIZED`.

### Gates and exceptions

- test/gate names, exact command or suite identity, counts, and results;
- disposable certification receipt references from #1731;
- exact production failures, blockers, or non-applicable reasons;
- redaction review;
- packet hash, generation timestamp, and responsible operator.

Do not include secret values or raw PII.

## 34. Final VFC and Completion States

Repeat the complete VFC after execution. Every preflight claim must have a final verdict and production evidence.

Use only these task states:

### `PREFLIGHT BLOCKED — NO LIVE I/O`

Use when deployment, credentials, pricing, approvals, inventory, runtime, pause, or gates are not ready. Report exact owner actions. Do not consume canaries or the singleton.

### `CANARY FAILED — INITIAL BATCH NOT CONSUMED`

Use when an applicable real-provider canary fails before singleton creation. Reconcile the canary, preserve evidence, and stop.

### `INITIAL BATCH CONSUMED — CERTIFICATION FAILED`

Use when the globally unique batch exists but final validation, reconciliation, or no-outbound proof fails. Never delete or replace the singleton. Report the exact incident/remediation state.

### `INCONCLUSIVE_PENDING_RECONCILIATION`

Use when global effects, dispatch, billing, or result causality cannot be resolved. Do not claim success.

### `CRO-03D COMPLETE — EXACT-RELEASE PRODUCTION CERTIFIED`

Use only when:

- the exact merged artifact and migrations are deployed and attested;
- every applicable real-provider canary passed;
- every non-applicable provider has a valid evidence-backed reason;
- `cro03c_initial_v1` executed exactly once with at most 100 members;
- current-generation ZeroBounce was genuinely proven where required;
- reservations, settlements, results, evidence, projections, readiness, and scoring reconcile;
- all CRO-03D-linked forbidden outbound effects are zero;
- no successor batch or recurring schedule exists;
- the final production certification packet is complete and hash-addressed;
- outreach remains `PAUSED / NOT AUTHORIZED`.

Do not invent a CRO-03E activation task merely because an owner-controlled prerequisite is missing. Keep CRO-03D pending with a precise blocker list. If a real implementation defect is found, report it honestly as remediation required; after the fix is merged, CRO-03D must restart exact-release certification against the new artifact.

## 35. Required Final Response

Return a concise operator summary followed by the evidence packet reference. Include:

1. Final CRO-03D state.
2. Exact deployed SHA/tree and migration head.
3. Deployment, inventory, activation-policy, and runtime-attestation IDs.
4. Provider applicability and canary verdict table.
5. Initial-batch singleton ID, member count, cohort hash, and terminal status.
6. ZeroBounce current-generation result totals.
7. Provider reservation/settlement totals by currency.
8. Projection, review-required, readiness, and scoring totals.
9. Causal forbidden-effect counts, all explicitly stated.
10. Confirmation that no successor batch or recurring schedule exists.
11. Final outreach status `PAUSED / NOT AUTHORIZED`.
12. Certification packet path/ID/hash.
13. Any exact blocker, ambiguity, incident, or owner action still required.

Never use “passed,” “activated,” “live,” “certified,” or “complete” without the corresponding immutable production receipt.

## 36. Final Directive

Execute CRO-03D as a production ceremony, not a development approximation.

Deploy and attest the exact reviewed CRO-03C artifact. Use owner-supplied signed authority and canonical admin operations. Run only justified, bounded, applicable real-provider canaries. Consume `cro03c_initial_v1` once and only once after every gate passes. Prove command-bound current-generation ZeroBounce, exact economics, canonical projection lineage, causal zero-outreach effects, and no successor scheduling. Preserve every denial, ambiguity, and failure truthfully.

The business remains protected until the entire exact-release certification packet proves otherwise, and even successful CRO-03D certification does not authorize outreach.
