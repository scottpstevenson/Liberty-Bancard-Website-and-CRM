# Liberty Bancard — canonical enrichment consolidation
Code, signed-in CRM and screenshot audit • revised 3 October 2026, 14:07 UTC

## Decision and scope
Replace competing eligibility and execution paths with one continuously running, program-scoped enrichment flow. Reuse the existing canonical records, evidence, provider receipts, queues and outbound controls; do not build another parallel funnel.

Process the entire existing contact/business population and newly imported records. Remove frozen/pilot membership, routine per-record approval, manual resume requirements and application-imposed financial/credit headroom as enrichment admission conditions. Target 1–3 useful recipients per business, not 50. Batch sizes are processing units, not limits on the eligible population.

Existing email addresses must immediately participate in business matching, classification, recipient preparation and campaign/sequence preparation. Queue ZeroBounce independently. Preserve the distinction between an available email, a provider-validated email and a send-eligible recipient. Do not mark unvalidated addresses valid or release paused outbound as a side effect.

This is an evidence-backed consolidation specification, not a claim that the system has been repaired. No production writes, imports, provider purchases or outbound actions were performed during this audit.

## Evidence boundary
Repository: scottpstevenson/Liberty-Bancard-Website-and-CRM.
Pinned source: 7fd447ada822cdd363d567e78f29b3a976714d05.
Signed-in CRM observations: October 3, approximately 07:37–07:58 and 09:53–10:07 Eastern. All twelve October 3 screenshots were opened and visually inspected. Routes, workers, services and migration contracts were read, including source qualification/admission, imports, contacts, vertical readers, validation, provider reporting, staging/promotion and post-enrichment enrollment.

The later live CRM reports API and worker revision **c85deb3c45bd617b066dc066b579d66520137d0b**. That revision was not retrievable from the connected GitHub repository: GitHub returned “No commit found for the ref.” The repository still exposes 7fd447ada822cdd363d567e78f29b3a976714d05 as its latest published commit. Consequently, code findings below are confirmed against the retrieved repository, and live failures are confirmed against the signed-in CRM; source/runtime equivalence cannot be certified. This is an evidence-access gap, not a recommendation to reinstate SHA equality as an enrichment gate.

Unrestricted production SQL, deployed function bodies, vendor billing/credit records and every external webhook handler were not accessible in this audit. No production configuration, code, imports, approvals, enrollments or provider spending was changed. This report completes the listed code-path and screenshot reviews; it does **not** claim a completed full-population database census or a verified working deployment.

### Earlier live observations — retained for comparison
| Observation | Meaning and limitation |
| --- | --- |
| 153,570 CRM contacts with email; 85,808 canonical businesses; 32 verified contact links; 31 inside frozen cohorts | Large stored pools, very small verified linkage. These are not qualified-recipient totals. |
| 8,175 staged free-discovery candidates; zero validation_admitted | Global candidate rows, not 8,175 unique emails or qualified businesses. SFP can consume staged evidence directly, so this alone does not prove no ZeroBounce execution. |
| Rolling 24h: 10,506 provider operations, 6,407 distinct targets; paid evidence 23 facts across 14 businesses | The visible facts were 14 phone and 9 domain facts, not email facts. Operation counts are not vendor HTTP-call counts. |
| 1,104 validation decisions; 5 eligible; 1,054 legacy/unknown discovery_required | Decisions include records without a dispatched validation request. They must not be described as 1,104 ZeroBounce calls. |
| Five ready-held creations, zero from imported contacts | Scheduling/provider activity has not demonstrated useful conversion of the imported contact pool. |
| Latest visible ZeroBounce result: Porter-russell Construction, 07:29:04, valid but validated_review_required | Corrects the claim that there are literally no valid ZeroBounce results. The CRM stored a result; independent credit debit was not verified. |
| Historical provider results: 33 distinct stored valid emails, 29 policy-eligible, 594 result records | Historical results are not a current fresh eligible-recipient census. |
| Current cohort: 100 businesses, 99 requiring discovery, one business with free candidates | A frozen sample remains a central operational unit. It is not the whole eligible population. |
| Imports UI: explicit admin approval at each list stage; standard upload CSV-only | The UI describes a manual staging workflow, not an automatic end-to-end import. |
| Visible import history: one September 9 import, 1,472 rows, zero new, 1,471 already existing, one error | The five October 2 workbooks were not shown in this history. This does not prove they are absent from every storage path. |

## Corrections to earlier findings
Some repairs have landed. Do not ask Replit to recreate them:
- Broader automatic relationship evidence exists in migration 0325 and the current system-link writer. Sunbiz registry websites and corporate email are no longer mandatory for every supported match.
- Effective vertical resolution and a resumable business/contact projection worker exist.
- Current SFP recipient selection supports multiple distinct addresses and program-scoped claims; the desired business limit is already 1–3.
- Current SFP provider code no longer uses financial headroom to gate execution. The shared paid-budget lock still exists for receipt/accounting serialization; its name does not prove a spending cap.
- The live vertical funnel now contains nonzero per-vertical counts. Earlier screenshots showing all zeros cannot be used as the current state.
- Stored valid ZeroBounce results exist. The issue is coverage, dispatch continuity, evidence persistence and automatic downstream admission, not a proven globally broken vendor connection.

## Current live blockers and what they actually establish

| Current evidence | Confirmed failure or meaning | Correction |
| --- | --- | --- |
| Automatic linking enabled; run prefix 39b07209, cursor 0, scanned 0, committed 0, error COMMERCIAL_SYSTEM_LINK_DATABASE_GUARD_MISSING | The enabled worker cannot get past its schema guard. Zero output is not evidence that 154k contacts fail the new matching policy. | Expose each guard predicate and inspect actual production schema/migrations. Repair the failed schema contract through the normal migration path; resume the same durable worker. Do not replace the guard with manual review for everyone. |
| Contact coverage census paused: 50,500 of 154,418; cursor 50,593 | Full-population coverage is incomplete. Its old strict buckets are diagnostic, not proof that broader automatic matching cannot succeed. | Run census/reconciliation continuously with checkpoints; keep audit labels aligned with the active rule. |
| Contact ZeroBounce automatic lane disabled; Data Quality campaign Not started; 154,313 unvalidated, 61 valid, 30 unsafe | The broad contact pool is not being drained through its automatic validation lane. The 154k count includes legacy active email states. | Feed existing stored addresses into the shared automatic address queue, independently of cohort/link completion. Prioritize useful production records and reuse fresh receipts. |
| SFP active, recurring enrichment on, promotion gate open; 2,946 rolling validation decisions, 0 eligible, 0 ready-held from contacts | SFP activity continues without useful current contact conversion. An open promotion switch does not enable the separate contact validation setting. Most decisions shown are discovery_required, not vendor requests. | Replace separate contact/SFP validation admission with one queue and publish selected/requested/responded/persisted/advanced counts. |
| SFP reports 153,572 contacts with email; only 32 verified linked, 31 inside frozen cohorts | Its verified-contact input is tiny relative to the CRM pool. Cohort scope further restricts business processing. | Automatically establish supported links, project verticals, and select eligible records across the entire program pool. |
| Phase A: 4,251 target, 2,134 non-target, 69,854 without evidence at current policy | Classification coverage is materially incomplete. A business being canonical or enriched does not establish current target classification. | Maintain one evidence-versioned classification queue across all production records; report coverage and automatic escalation separately. |
| Free classification continuation running; cursor 85,735 / 87,701, 13,274 classified, 1,421 target; last tick 09:06:15 at observation around 10:07 | State says running while last reported progress is approximately one hour old. Counts use a different processing scope from current business totals. | Inspect this named queue's actual completion/errors/lease and resume automatically. A general enrichment heartbeat does not prove classification progress. |
| Health: 45 enriched today, 5 emails, 43 phones; 293,774 total enriched; displayed 100% success | Completion mostly reflects an enrichment operation/status, not qualified recipients or email coverage. | Measure canonical outcomes and per-stage age/yield; retain operation counters as diagnostics. |
| Health pipeline counts all zero; legacy pool reports 32 master leads | Health filters staged/promoted rows to pipeline_origin=cro03_pipeline. It is not an all-pipeline inventory. | One canonical inventory with explicit scope; avoid displaying this subset as the complete funnel. |
| Provider controls enabled and circuit closed | Closed means the failure-protection circuit is healthy and permits execution. It does not mean the provider is disabled. Current SFP wording now says Failure protection: healthy. | Keep the clearer wording and show configuration, lane activation, dispatch and completion separately. |

The exact failed automatic-link guard subcondition is not established. A suspected stale trigger hash was explicitly tested and ruled out **in the retrieved source**: migration 0314's trigger body hashes to 30910090e380e90ea27bff572d2c5847; applying migration 0325's documented replacement produces 46f89326f7c158ac739814ce343c2559, exactly the application constant. The live error could still reflect missing/disabled schema objects, incomplete migration, constraint/function differences or different live code. The current error collapses all of these into one message.

## Additional traced defects that the earlier report missed

### A. “Canonical” is identity storage, not qualified business admission
The business-list route in server/routes/lead-ops.ts selects record_class='canonical'. Unless the user chooses a vertical filter, it does not require the five target industries, target counties or current high-confidence classification. This explains why global domains, colleges, retail and records with missing location appear in the same list. Do not delete records merely because they are outside this campaign: preserve them as non-target/source records and distinguish the whole inventory from the qualifying program pool.

Its unvalidated candidate count selects only staged free_discovery_candidates email rows. It is not a count of all stored business/contact/paid-source emails. canonical-business-email-display.ts can show discovered with zero counted candidates. canonical-business-safe-next-action.ts accepts mainEmail but does not use it; anything short of provider_valid can be directed back to discovery. Fix available-email versus missing-email selection, not merely the badge.

### B. The contact and SFP validation writers do not converge
zerobounce-campaign-worker.ts reads zerobounce_auto_run_enabled, returns feature_disabled when false, then checks provider_controls enabled/closed. It uses validation intents and contact observations and projects contact email status. The named auto-run is daily; the visible screen reports its next run October 4 at 02:00 Eastern. SFP has a different cohort worker and writes sfp_outreach_eligibility; its successful finalizer updates businesses.main_email/email_discovery_status. That finalizer does not update contacts.email_status. Stored valid SFP receipts therefore do not automatically prove that the contact-list status has been reconciled.

The campaign selector includes NULL/active/unvalidated contact email states. It filters placeholders, archived rows and DBPR lineage, but does not itself enforce production record class, target geography or the five verticals. Data Quality's prioritized rows visibly include Test Merchant/Test Promo/quiz fixtures. Do not simply enable an indiscriminate 154k validation campaign and call it ROI prioritization. Use the shared production/program selector, address deduplication and receipt projection, while allowing identity/classification preparation to proceed before validation.

The live legacy diagnostic also shows 100 in-flight provider operations requiring reconciliation. Their exact provider/dispatch/billing outcomes were not independently queried. Resume or reconcile known operations rather than issuing replacements blindly; do not turn this into another human-approval ladder.

### C. Repeated validation result rows are not proven repeated paid requests
The provider-results route reads sfp_outreach_eligibility, ordered by validation_at; it does not collapse records by normalized address and operation. Eligibility uniqueness includes cohort_run_id, business_id, policy_version and normalized_value_hash. A new cohort/policy projection can show the same receipt again. The screenshot explicitly labels many rows Reused; no new charge. The current selector also has address-level terminal history/claims and skips completed work except receipt-projection repair; a repeated row cannot establish that this selector paid repeatedly.

Show a latest address result with receipt expiry, original operation ID, source/contact/business and reuse count, with decision history expandable. Separately aggregate actual dispatched operations and vendor-confirmed charges. Check suspicious repeated masked addresses against retained plaintext/source in an authorized diagnostic; masking alone does not prove that an address is a crawler telemetry mailbox. Ftd Irrigation's visible valid/eligible result also disproves an absolute claim that every result is invalid.

### D. Free-only classification and AI escalation are separate passes
sfp-free-classification-continuation.ts first runs freeOnly=true; unknown evidence can yield AI_NOT_ATTEMPTED, EMPTY_VERTICAL_LABEL and FREE_ONLY_NO_ESCALATION. That is not a completed OpenAI call. Its paid escalation function exists: it requires CRO03_PROVIDER_TRANSPORT_ENABLED=true and OpenAI readiness, chooses up to 25 provisional businesses, and calls the bridge with freeOnly=false. Follow-ups additionally depend on the program/continuation state.

The screenshot contains a real gpt-4o-mini result for Aquatic Alex Illustration, and live token usage rose during inspection. OpenAI is not globally unused. The failure is inadequate current classification coverage and opaque progress/escalation, not a proven universal transport failure. The escalation selector excludes a business when any completed same-policy/taxonomy/classifier evidence exists; it does not compare that completion with the newer provisional evidence's source revision. Add evidence-revision-aware invalidation so changed evidence can be reconsidered without unconditional repeated calls. Confirm the deployed worker's exact reason for skipping each pending escalation.

### E. Source qualification still ends in mandatory projection review
Source Registry upload uses source-registry/import-runner.ts and atomically creates a cro03a_qualification_commands outbox record. queue-manager.ts consumes that named outbox every two minutes in production; a ten-minute recurring geography qualification consumer also exists. Thus the earlier implication that source staging has no consumer was wrong.

However CRO03B admission-service.ts consumes a qualified handoff, materializes/arbitrates evidence, records provider-denied stages and then unconditionally sets recipe item state=review_required, terminal_code=admin_projection_review_required. The review-and-project endpoint requires an admin. This is a real manual stop even for deterministic established evidence. Replace it with canonical automatic projection for unambiguous records; keep genuine conflicting evidence as an exception. Source staging/quarantine, qualification, admission, CRM creation and enrollment remain distinct completion states today.

### F. Census counts use incompatible source keys
getCro03aSourceCensus() groups cro03_source_subjects by source_system and subject_type, but then totals rows whose source_system equals the displayed CRO03A_SOURCE_CENSUS category. A provider_csv_row can have source_system='outscraper', while the panel category is provider_csv_rows; similarly sunbiz versus sunbiz_entities. The live page shows both types beneath zero category totals. Count by the documented source-category mapping, show staged subjects versus source database inventory separately, and reconcile list/count predicates. These zero cards do not prove that no Sunbiz/Outscraper observations exist.

### G. Old promotion and post-enrichment automation cannot serve as the shared funnel
master-leads/pipeline-promotion.ts explicitly creates a local contact with no deal, sequence enrollment or outbound effect. It also writes a terminal pipeline_local_only GHL projection. A promoted status therefore does not mean campaign enrollment.

sunbiz-enrichment.ts writeback requires entity.prospectId, then prospect.contactId to update an existing contact. It only queues post-enrichment work when it adds the first missing email/phone and finds an open sales deal. Contacts that already have email, unlinked contacts and contacts without a deal do not reach that event route. Failures are logged as non-critical.

post-enrichment-worker.ts then checks global outbound authority before creating its local enrollment and returns retryable outbound_paused. It selects a sequence by raw vertical/family/name/config with generic/any-active fallback. This differs from the SFP bridge, which explicitly creates paused enrollments while outbound remains paused. Delegate preparation/enrollment to one authority with explicit canonical vertical-to-sequence IDs; separate preparing paused records from releasing sends. Do not require a sales deal or first-contact-info event to process the existing contact backlog.

### H. Reachable UI operations can be legacy or unavailable
The enrichment-job PATCH endpoint returns 503 pending its governed state machine, while the client still renders status mutation controls. Prospect Enrich now calls POST /api/enrichment-jobs → createCro03BatchForProspects → source staging; it is not a direct legacy enrichment-job update. The business-detail next action can recommend Apollo even when credits are unavailable. Defer Apollo as requested, but continue existing-email validation, classification and local reconciliation. Hide/redirect obsolete controls and expose the actual next automatic transition.

### I. Inbound failures are visible, but are a separate function
The live Inbound Operations view has a free-analysis request held with FREE_ANALYSIS_PARTIAL_MUTATION, a statement-upload request failed with STATEMENT_UPLOAD_FAILED, and callback records with unassigned_policy_missing, while local contact/deal links were created for some callback requests. This surface reads inbound receipts/effects and canonical links; it is not the SFP business-admission mechanism. Investigate those specific requests independently and share canonical enrichment events; do not erase inbound ownership/SLA requirements to repair cold outreach. The underlying form failure cause and whether these were test submissions remain unverified.

## Confirmed architectural findings and required corrections

### 1. Provider imports leave the ordinary CRM creation path
Evidence: server/routes/imports.ts, approximately lines 1642–1868 and 2220 onward; server/services/csv-import-processor.ts; server/services/cro03/source-staging.ts.

Recognized Outscraper/Apollo rows are projected through a limited mapped-column object, sent to createCro03SourceBatch, assigned cro03_staging_review_required, and continued past the later contact/business creation logic. Source staging stores observations/candidates, but initializes quarantined/STAGING_RECIPE_DISABLED records and blocked memberships with executable_count=0. Recovery follows the same staging route.

A separate recurring CRO03A geography qualification consumer exists. Therefore this is not proof that staged observations are permanently unconsumed. It is proof that imports use a separate ladder whose qualification, admission and materialization must be traced per row.

Correction: every supported import must write retained observations and enqueue the same canonical normalization/upsert/reconciliation work used by other inputs. Eliminate routine staging-review prerequisites. Migrate existing staged rows through that flow with replay-safe identities. A completed upload is not a completed import until row outcomes link to actual CRM records and downstream jobs.

### 2. Workbook support and enrichment field preservation are incomplete
Evidence: server/routes/helpers.ts, approximately lines 83–104; imports.ts mapping and mapped-row projection.

The standard upload filter accepts CSV and rejects XLSX/XLS. The projected mapping does not preserve the complete Outscraper schema: multiple returned emails/contacts, stable provider identifiers and other enrichment fields can be omitted from the downstream observation.

Correction: support the actual supplied XLSX workbooks and CSV exports. Retain all source columns in protected raw evidence, normalize every returned email and named contact, and preserve source/verification semantics. Preserve business names, domains, phones, addresses/geography, place_id/google_id/cid/Maps URL, categories/subtypes, operating status/hours, ratings/review counts, coordinates/service-area status, contact names/titles/socials/categories and returned dates. Optional company insights must also survive when present. A vendor RECEIVING label must not be translated into ZeroBounce-valid.

### 3. Automatic linking still depends on a frozen SFP parent at initialization
Evidence: server/services/contact-link-automation.ts, processContactLinkAutomationTick.

When no automation setting exists, initialization selects a nonvoided, nonsuperseded frozen sfp_cohort_runs record belonging to an active program and calls assertSfpRuntimeAuthority. Failure returns awaiting_current_sfp_runtime_owner. Existing explicit disabled state is also preserved. The worker processes 25 contacts per page and checkpoints each outcome.

Correction: relationship reconciliation is CRM work and must initialize/run independently of SFP cohorts, discovery providers and outbound readiness. Persist automatic work state and process successive pages without user resumes. Keep retry fencing/idempotency; remove obsolete cohort-derived ownership.

### 4. A broader matching rule exists, but evidence and production deployment determine yield
Evidence: contact-business-evidence-page.ts; contact-business-system-link-policy.ts; contact-business-system-links.ts; migrations/0325_crm_evidence_relationship_authority.sql.

The active evidence-page loader replaces the old strict loader. Sunbiz matches can use filing identity, legal/trade name plus address, phone or independently established domain evidence. Outscraper/Maps matching supports stable place identity. Unique eligible matches can be automatically committed. The old strict code still exists as a fallback/dead path; it must not be mistaken for the sole active rule.

Correction: verify deployed DB functions/triggers against current source. Repair missing canonical_source_links and imported stable IDs before purchasing replacement discovery. Automatically commit sufficiently established unique relationships. Do not require a human reason/event ID for routine cases; generate provenance internally. Route only actual ambiguity/conflicting existing associations to a useful evidence-detail view. Shared addresses, copied domains and generic company names must not cause unrelated businesses to merge.

### 5. Vertical consumers disagree even after the new resolver/projection
Evidence: shared/effective-vertical.ts; crm-effective-vertical-projection.ts; server/storage/contacts.ts; server/routes/contacts.ts; contact-readiness.ts.

The detail read and readiness logic can use the effective vertical. Projection writes effective_vertical_id/effective_vertical_status. However getContacts returns raw rows; getContactVerticalCounts, getContactsByVertical, campaign audience/count queries and another audience prefilter still use contacts.vertical. CSV export and some quality counts also reference raw vertical. Projection does not overwrite that raw field.

Correction: adopt one canonical vertical ID/status across lists, detail, filters, counts, exports, audience selection, readiness and enrollment. Preserve raw labels only as evidence. Process every existing contact and business; inherit from a verified associated business where appropriate, then classify unresolved records from retained evidence. Assign one of the five target verticals only when supported; explicitly identify non-target and unresolved records. Do not manufacture a target classification to fill a quota. A secondary JavaScript normalization filter cannot recover rows already excluded by raw SQL.

### 6. Cohorts remain embedded across discovery, validation, evidence writes and staging
Evidence: sfp-continuous-discovery.ts; sfp-paid-evidence-writer.ts around line 503; sfp-campaign-staging-v2.ts; sfp-enrollment-bridge.ts.

Continuous discovery and validation enumerate frozen cohort runs. Paid-evidence persistence checks sfp_cohort_members. Staging selects cohort decisions/members and validates frozen classification. Enrollment still carries cohort references. Removing one UI freeze button would leave these downstream dependencies intact.

Correction: replace cohort membership as authority with current program geography/vertical rules and canonical record state. Historical run IDs may remain provenance only. Update selectors, constraints, foreign-key assumptions, claims, receipts, retries and enrollment consumers together. Work must succeed for a qualifying business that has never belonged to any pilot/frozen cohort.

### 7. Legacy promotion and current SFP validation are separate admission paths
Evidence: free-discovery/evidence-service.ts at live revision; current sfp-validation.ts and continuous worker.

Legacy staged-to-validation_admitted promotion requires an approved CRO03C activation policy and environment conditions, and promotion itself does not dispatch ZeroBounce. Another legacy route remains pilot scoped. SFP can select staged evidence through its own path, but continuous validation still traverses frozen cohorts.

Correction: one address-level validation queue, fed by all normalized existing/imported/discovered emails. No pilot/activation-review gate for ordinary validation. Reuse fresh receipts for the same normalized address, retain their original expiry, and dispatch missing/stale work automatically. Report selected, queued, requested, responded, persisted and advanced counts separately. Distinguish no candidates from gate closed, paused, missing credentials, API failure and persistence failure.

### 8. Valid emails can still be held by recipient policy and association acceptance
Evidence: sfp-outreach-policy.ts; sfp-enrollment-bridge.ts; latest live valid-but-review-required result.

Role, named and business-address decisions depend on classification/corroboration and active policy flags. The bridge can hold recipient_assignment_not_yet_accepted and uncorroborated associations. These are separate from ZeroBounce validity.

Correction: automatic recipient classification and association using retained evidence; remove universal named-email/manual acceptance prerequisites. Use actual conflicts as exceptions. An available email allows CRM/preparation work immediately, and validation proceeds in parallel. Pending validation remains a visible state; do not collapse it into discovery_required or treat it as a successful validation.

### 9. Financial controls and reliability controls must be separated
Evidence: current sfp-provider-operations.ts and shared-paid-budget-ledger.ts; legacy free-promotion activation checks.

Current SFP financial-headroom execution gating has already changed. The retained legacy pilot and CRO03C activation paths still expose approval/attestation authority; those are not proof of an active SFP financial cap. Provider readiness, deduplication and ambiguous-dispatch reconciliation remain separate checks.

Correction: no artificial dollar, credit, pilot-size or task-approval cap for the authorized canonical enrichment flow. Keep informational usage/cost reporting. Preserve actual vendor rate limits, retry backoff, credential errors, deduplication and transaction fencing. Remove routine activation attestations for enrichment; do not reuse an old cohort SHA as a required deployed release. A queue page size or accounting lock is not a financial limit.

### 10. UI status is disconnected from actual completion
Evidence: live Imports, SFP/Health/provider results; scheduler consumer routing.

Imports show stage-advance controls even for ready/completed statuses. “Enabled”/“closed” lacks an actionable explanation. Counts mix global and cohort populations, decision records and provider activity. Review controls do not supply enough evidence for an informed decision.

Correction: one pipeline view with record drill-downs, queue counts/age, last real progress, precise hold reason and next automatic retry. Generate internal IDs/provenance automatically. Show raw/effective vertical distinction only in diagnostics. Routine users should not need typed confirmation phrases, event IDs or repeated page resumes to advance established evidence.

## One canonical flow to implement
| Input/event | Required automatic outcome |
| --- | --- |
| Existing CRM contacts and canonical businesses | Normalize retained evidence, evaluate matches, resolve vertical, enqueue available emails. |
| Sunbiz source records | Resolve canonical business/source identity, search existing contacts and link supported unique relationships; classify business. |
| Outscraper/Apollo CSV/XLSX | Preserve source evidence and all returned people/emails; upsert existing records first; enqueue the same work. |
| Website/provider result | Attach evidence to the established business/contact and enqueue missing downstream work. |
| ZeroBounce result | Persist receipt/address status, recompute recipient readiness and advance eligible preparation/enrollment. |
| Relationship/classification correction | Recompute dependent vertical/audience/readiness states and revisit previously held work automatically. |

Use durable event/outbox delivery plus a resumable full-population catch-up. One canonical writer per entity/relationship, one address-level validation authority, one recipient readiness evaluator and one enrollment authority. Compatibility endpoints must delegate to these authorities rather than keep separate rules.

Independent steps should run in parallel: business classification, contact reconciliation and validation do not wait on each other's unrelated holds. Discovery uses retained emails first and only searches for missing useful data. High-ROI priority should consider supported target geography/vertical, actual business identity, stored website/email/contact evidence and missing downstream steps. Include fairness/age ordering so weaker records are not permanently starved.

Campaign/sequence preparation should persist pending_validation or other explicit readiness states automatically. Preserve the existing global outbound pause. Actual sending remains a separate action; this task must not silently release it.

## Migration and retirement work
1. Start with a current production inventory: tables, deployed migrations/functions/triggers, active settings, scheduler profiles, runtime owner, queue ages and provider receipts. Reconcile source against deployed behavior before coding.
2. Trace real existing records from each input through every table/job and record the first failing transition. Include an imported existing contact, a new imported contact, Sunbiz with no registry website, a free-mail address supported by business evidence and a business outside all cohorts.
3. Publish one entry-point/dependency register. Cover CSV recovery, source registry, CRO03A qualification/outbox, CRO03 admission/handoff, MI09 promotion, SFP, master-lead staging, manual admin actions and every active scheduler consumer. Identify delegation, retirement or retained exception handling for each.
4. Migrate pending source batches, staged candidate evidence, unlinked contacts, unresolved verticals, validation intents and held recipients. Preserve history and original receipt validity; reuse existing provider task IDs instead of buying duplicates.
5. Remove cohort/pilot authority from active database predicates and downstream code. Historical cohort data stays readable.
6. Switch every vertical reader/filter/count/export to the canonical authority. Backfill/project and continuously update the full pool.
7. Enable automatic canonical linking/validation/preparation, then retire manual routine controls. Keep useful evidence inspection and genuine-conflict correction.
8. Verify imports with the supplied five workbooks and replay. Import execution should follow the user's existing instruction to repair the CRM first; do not run paid discovery simply to prove parsing.

Production inventory must report unique businesses, unique contacts, unique normalized emails and their relationships separately. Account for every backlog row as actionable, already satisfied, duplicate, non-target, suppressed, conflicting, malformed or failed with a reason. Use the actual deployed schema rather than fabricated SQL columns.

## Required verification and closure evidence
- Tests against real database relationship functions/triggers, not only mocked policy helpers.
- XLSX and CSV versions of the same report produce the same entity/evidence outcomes; replay causes no duplicate entities, validations or enrollments. Multiple emails/people and stable Maps identity survive.
- A qualifying business never placed in a frozen/pilot cohort completes linking → vertical → available-email preparation → ZeroBounce dispatch/result → recipient readiness → paused enrollment.
- Missing registry website and personal email domains do not independently block an otherwise supported relationship.
- A business with no email still gets classified and reconciled.
- Existing stored emails create validation intents automatically; fresh same-address ZeroBounce receipts are reused without extending expiry.
- Verified link and vertical corrections reach contact list, filters, counts, export, audience, readiness and enrollment consistently.
- One bad row/provider failure does not prevent unrelated work; retries are automatic and idempotent.
- Useful distinct recipients are limited to 1–3 per business. Validation deduplicates addresses globally where appropriate; enrollment respects business/campaign identity.
- Suppressed recipients remain excluded from sends; global outbound pause remains enforced.
- Actual request/response/receipt persistence is demonstrated for ZeroBounce with timestamps and stable operation IDs. Recorded cost is not claimed as a verified vendor invoice/credit debit.
- At least two scheduled cycles show real downstream progression, not only scheduler ticks. Report throughput, backlog age, hold distribution and projected catch-up time.
- Full-population cursors/counts prove every existing production business/contact is considered; five successful samples do not prove the whole backlog was processed.

Do not close on build/type checks, a working panel, candidate counts or provider operation totals alone. Closure requires production evidence of the shared flow, automatic continuation and useful paused enrollments, with remaining exceptions quantified.

## Replit execution instruction
Implement this as one canonical consolidation, with migrations and compatibility delegation. Recheck the latest publish first and preserve fixes already landed. Do not add another pilot, frozen cohort, approval ladder, artificial spending quota or parallel enrichment framework. Return the changed authority/dependency map, deployed revision/migrations, before/after production inventory, exact remaining blockers and record-level end-to-end evidence. Clearly distinguish implemented source, deployed code, real provider execution and committed CRM outcomes.


## Screenshot audit — all twelve October 3 images

The timestamps below identify the uploaded screenshots, not the time of the later live checks. Where a later check contradicts an older screenshot, both are recorded rather than treating an old failure as current.

| Image time | What is visible | Finding and correction |
| --- | --- | --- |
| 08:21:04 | 85,808 canonical businesses; dropdown target counts Trades 2,295, Auto 1,094, Healthcare 590, Beauty 501, Fitness 324; global domains without locations/verticals | Those five counts total 4,804, not 85,808 qualified businesses. The unfiltered inventory includes non-target/unknown records. Separate identity inventory, industry coverage, geography and qualified pool. |
| 08:21:49 | Skylandgrain.com business 94123; potential contact 55436; relationship unverified; next provider Apollo; no indexed source observations | A potential name/domain match is not a committed link. The detail screen reveals missing source support. Defer Apollo and continue retained-email validation/local matching. Preserve this as a record-level diagnostic, not proof of the entire pool. |
| 08:22:19 | Global domains, discovered status with zero candidate counts, enrichment complete, missing vertical/location | Business status/count fields describe different subsets. Recompute available-email state from all address evidence; show whether merchant/geography evidence is missing. |
| 08:23:02 | Census provider/Sunbiz cards zero but provider_csv_row observations listed; manual preview/run; effects denied | Confirmed source-category/count mapping defect. Qualification is evidence-only; it does not itself create a contact or enroll. CRO03B subsequently imposes projection review. |
| 08:23:19 | Data Quality 154,313 unvalidated, 61 valid, campaign Not started, 420 missing raw vertical; test record at top | Not literally every email is unvalidated. Most legacy active states are unvalidated. Raw nonblank vertical is not canonical target coverage. Prioritization lacks a consistent production/program filter. |
| 08:24:37 | 10,821 operation rows, 6,548 targets; 21 facts/13 businesses; 3,072 decisions, 0 eligible; two ready-held, none from contacts | Activity is not end-to-end output; facts shown are phone/domain. Distinguish decision records from address submissions and unique recipients. Later rolling totals changed, but contact yield remained zero. |
| 08:24:51 | Freeze max 25; program cap 100; old frozen/failed runs | Frozen scope and manual controls still exist. Remove them from live selectors, writes and consumers, not only the UI. Processing chunks can remain. |
| 08:25:05 | Discovery Results dominated by Serper phone/domain facts | The report selects returned candidate evidence, not all dispatched operations. No email facts here means these facts do not replenish email recipients. Trace actual address queues before buying more discovery. |
| 08:25:34 | Free-only skipped AI/provisional rows; deterministic target; actual gpt-4o-mini review result | AI is not globally absent. Free-only rows are not AI failures. Current escalation/progress is inadequate and needs reason/coverage reporting and evidence-aware retry. |
| 08:26:05 | Same business/address repeated; many Reused; no new charge; some $0.02 invalid; Ftd Irrigation valid/eligible | Do not infer duplicate charges or zero valid results. Group latest unique address receipts, expose provenance and inspect true duplicate dispatches separately. |
| 08:26:34 | Legacy master-lead pool authority, 85,808 canonical, 6,488 excluded, 8,017 free complete, 32 master leads, funnel unavailable | These stages belong to different authorities/scopes. An unavailable funnel must not display zero. Legacy activation controls are not a single canonical pipeline. |
| 08:26:50 | Providers enabled/closed; contact ZB lane disabled; 100 in-flight operations; credit/cost ledger | Healthy circuit does not activate a job lane. Internal consumption is not independent billing evidence. Broad contact validation is disabled despite available configured provider capacity. |

Later live preview: the high-confidence table loaded successfully with selectable supported rows, and disabled business 66245, “J & R Complete Test Plumbing LLC,” with test_demo_internal. The earlier SQL 500 is not reproduced in the current session. It nevertheless marks name-derived classifications 0.95, including “Dc Medspa Properties Corp.” Name-derived industry confidence is not evidence of an operating merchant, current website, target geography, contact identity or deliverability. Keep these dimensions separate in ROI/admission.

Current named-email review list was empty. Earlier masked-only reason-input screenshots remain valid evidence of poor review design, but are not proof of a current pending-review count or a globally blocking review requirement.

## Traced entry-point and authority map

This replaces the earlier tab-only inventory. Each row names the code path actually inspected and its downstream stopping point. Code traces do not substitute for a committed production record at every transition; missing live proofs are listed afterward.

| Surface / entry | Route, writer and work delivery inspected | Current authority or stop | Consolidation disposition |
| --- | --- | --- | --- |
| Businesses list/detail | LeadOpsCenter → /api/lead-ops/businesses and /businesses/:id → canonical list, effective vertical SQL, evidence/candidate/master-lead projections | canonical record class; optional target filters; source support and business email status | One record view; full inventory and qualifying program counts separate; same address/link/readiness authorities. |
| Automatic business/contact links | contact-link-automation → contact-business-system-links → evidence-page/policy → commercial-link-authority, DB trigger and immutable evidence → link decision | Initialization still derives an SFP frozen parent; live DB guard fails before scanning; broader v2 rules exist | Independent full-population local worker; automatic unique evidence-backed links; real conflicts only to review. |
| Link coverage/reconciliation UI | Bounded coverage/reconciliation progress/preview/admin routes → durable cursors/suggestions; continuous-discovery queue invokes local workers | Separate paused coverage and suggestion/manual review workflows; old strict diagnostic classifications | Shared reconciliation state; background continuation and current-rule diagnostics. |
| Sunbiz bootstrap/backfill | Lead Ops bootstrap routes → sunbiz-bootstrap → canonical business/source links → bounded/full resumable job | Creates identity inventory, not automatically current target classification or verified contact | Emit shared classify/match/address events for every new/existing source business. |
| Source Prospects | Prospects → POST /api/enrichment-jobs → createCro03BatchForProspects → createCro03SourceBatch; conversion routes → prospect-conversion/local contact writer | Canonical staging admission can reject; conversion and source enrichment remain different actions | Source inventory feeding common normalization/upsert; no independent approval/vertical authority. |
| Provider CSV imports/recovery | imports.ts + csv-import-processor/import-normalizer → mapped provider rows → source-staging; ordinary rows continue contact/business path | Provider rows bypass ordinary CRM creation and enter staging review; standard filter CSV-only; incomplete mapped fields | Shared CSV/XLSX ingestion, retained raw evidence, all normalized contacts/emails, replay-safe upsert/outbox. |
| Priority sheet/master-lead import | imports.ts master-lead/import/generation routes → master_leads and staging receipts | Staged master-lead inventory; separate promotion controls; no automatic enrollment contract | Canonical preparation projection, not a second source-of-truth funnel. |
| Sources registry | source-registry routes → import-runner → source batch + atomic cro03a_qualification_commands → named outbox consumer | Adapters/import schedules manual; qualification delivery exists; downstream CRO03B review remains | Source configuration/provenance; common automatic projection after qualified evidence. |
| Census | /api/cro03a census/stage/preview/run routes → qualification-service → decisions/handoffs; recurring geographic qualifier | Frozen occurrence snapshot for reproducibility; fit/policy; source-category totals mismatch; excludes ordinary contacts/businesses from this source census | Coverage/geography projection of shared population; distinguish evidence snapshot from execution membership. |
| CRO03B admission | /api/cro03b/commands → admission-service claim → materialize/arbitrate → review-and-project | Unconditional admin_projection_review_required; local-only recipe/provider stages denied | Automatically project supported unique evidence; delegate conflicts; retire routine admin handoff. |
| Intelligence | LeadIntelligence → /api/lead-intelligence/score, blueprint, route → lead-scoring/smart-router, deal support | Score/recommendation does not resolve all canonical verticals, contacts or SFP readiness | Read shared evidence and write recommendations; no competing industry/admission authority. |
| Data Quality/contact validation | contacts quality/validation routes → zerobounce-eligibility → campaign → zerobounce-batch worker → validation intents/provider-readiness-control → observations/contact status | Automatic lane disabled; daily auto-run; broad legacy active selector; DBPR exclusion but no uniform production/program scope | One continuous address queue with receipt reuse; quality UI reports actual coverage, not raw-label completeness. |
| Staging & Promotion/Master Leads/Promotion Review | imports.ts pipeline/check/promote/generation routes → master-leads/pipeline-promotion | cro03_pipeline inventory; provider-valid/conflict/duplicate checks; explicit promotion; local contact only; terminal local-only GHL projection | Reuse existing contact and automatically prepare recipients; make legacy inventory read-only/delegated. |
| SFP classification | Phase A + free continuation → sfp-classification-bridge → deterministic/website/OpenAI evidence; paid escalation function | Program/current policy/taxonomy/classifier, follow-up state, transport/readiness; free-only provisional rows; incomplete/stale progress | One evidence-versioned classification queue, current canonical projection and explicit non-target/unresolved states. |
| SFP discovery/provider retrieval | Continuous discovery + paid waterfall/provider operations → free/paid candidate evidence; persisted provider tasks/polling | Frozen cohort enumeration; retained evidence membership checks; provider readiness; missing Apollo capacity | Entire program pool; reuse task IDs; defer Apollo without blocking retained-email steps. |
| SFP validation | Continuous validation → sfp-validation → unified free/paid/verified-contact candidates → address claims, fresh receipt reuse/provider operations → sfp_outreach_eligibility | Frozen business membership; verified contact source/link pins; email-type policy; duplicates/retries/receipts; contact status not projected by finalizer | Shared address queue/receipt projection; available email work immediate, send readiness after validation; no cohort or routine review prerequisite. |
| SFP ready-held/paused enrollment | sfp-campaign-staging-v2 + staging worker → recipient commitments/intents → sfp-enrollment-bridge → local contact/link/master-lead/enrollment ledger | Fresh eligibility/policy/link evidence; frozen inputs; accepted-assignment aliases/holds; bridge requires and preserves outbound pause | One preparation/readiness/enrollment authority, 1–3 recipients/business; auto-accept established associations with provenance. |
| Legacy Sunbiz post-enrichment | sunbiz-enrichment writeback → linked prospect/contact → first-info event + open sales deal → post-enrichment queue/recovery → post-enrichment-worker | No prospect/contact/deal or existing email means no event; outbound pause blocks local enrollment; raw-name sequence fallback | Delegate all resulting events to shared catch-up/preparation; explicit sequence IDs; create paused preparation without send permission. |
| Inbound Operations | /api/lead-ops/inbound-requests → inbound receipt/effect list and canonical links | Separate requests/assignment/SLA/effect lifecycle; observed failed/held requests | Preserve inbound function; share enrichment events; investigate individual failed receipts independently. |
| Provider Results | /api/lead-ops/sfp/provider-results → paid candidate evidence, classification evidence, eligibility history | Facts/decisions and reused receipts are not dispatched-call or billing counts | One latest-address/provider result view plus expandable raw history, request and receipt proof. |
| Paid Pilot (Legacy)/CRO03C | Pilot endpoints, run/cohort/advance/execute-phase/approval controls; CRO03C activation/attestation routes; named recovery jobs | Legacy pool/approval/runtime authority retained; live NO_ATTESTATION explicitly separate from routine SFP | Historical read-only pilot; routine endpoints delegate to canonical workers; remove activation ceremony from ordinary enrichment. |
| Health/schedulers | lead-ops health SQL + queue-manager named consumers: classification, continuous discovery/validation, link/projection, campaign staging, source qualifier, contact ZB, post-enrichment recovery | Mixed origins and cumulative operation metrics; generic heartbeat cannot certify named-stage progression; some BullMQ jobs not monitorable in panel | Per-stage queue/age/claims/completions with actual record yield and full population watermark. |
| Contacts filters/export/audiences/readiness | storage/contacts + routes/contacts + contact-readiness + effective-vertical/projector | Several list/count/export/audience queries read raw contacts.vertical while detail/readiness can use effective classification | Migrate every query to same canonical ID/status; backfill full pool; preserve raw label only as evidence. |

### What is still not verified in production

1. The precise failed DB guard predicate, installed migration inventory and actual function/constraint/trigger definitions. The code hash experiment rules out one source-level mismatch, not every deployed mismatch.
2. The exact latest runtime source: c85deb3 is not in the connected GitHub repository. Replit must expose/sync that source to reconcile these code findings with the current deployment.
3. Unique address/business/contact counts and dispositions for every staged backlog row. Live health distinguishes roughly 215 scoped staged rows from 7,969 outside current scope at that observation; the overall staged counter changed to 8,181 during polling. Independently refreshed counters must not be arithmetically combined as an exact same-transaction decomposition.
4. Actual ZeroBounce debits, exact vendor outcomes for the 100 in-flight operations, and the prior “four provider tasks” claimed in earlier conversation. No four exact task IDs were verified here; they must not be treated as a proven queue inventory.
5. A real production import row committed through source → canonical business/contact → address queue → valid receipt → paused enrollment; the existing workbook analysis is not that proof.
6. Every external webhook, GHL transport write and campaign/sequence branch in the repository. SFP and post-enrichment preparation/enrollment were traced; external delivery was not executed or fully certified. Do not label this report an exhaustive live audit of those effects.

These are specific remaining evidence gaps. They are not reasons to increase cohort size, buy more discovery or manually approve the entire pool.

## Implementation order and highest-ROI bulk enrichment

The implementation must be one coordinated consolidation. Steps below are milestones within that change, not additional enrichment tasks or separate funnels.

1. Reconcile the latest runtime source and failed link-schema predicates. Restore automatic local linking/classification progression and a reliable full-population watermark. Keep current broader rules and fixes that already landed.
2. Introduce or select the shared normalized-address job/receipt authority; connect existing contacts, businesses and imported evidence to it. Reconcile known in-flight operations. Project results consistently to contact, business and readiness views. No frozen/pilot admission or ordinary per-record review.
3. Switch every vertical reader and writer to canonical ID/status; finish current classification catch-up with automatic evidence-aware AI escalation. Assign supported target, non-target, unresolved or conflicting state for every production record. Non-target records remain retained, outside this program.
4. Unify ingestion and projection, including XLSX, multiple addresses/named contacts and stable Maps IDs. Migrate staged source rows and use existing CRM records first. Backfill pending preparation and remove deal/first-email-event dependencies.
5. Unify paused recipient/enrollment preparation and explicit sequence mapping. Retire manual promotion/cohort/activation controls and route compatibility endpoints to this authority. Keep outbound paused.
6. Demonstrate complete record traces, scheduled continuation and population accounting before closing the change. Replace mixed-scope dashboards with canonical outcomes.

Bulk priority tiers:

| Priority | Selection | Automatic work |
| --- | --- | --- |
| 1 | Production operating businesses in the five target verticals and three target counties, with retained usable emails and strong existing identity evidence | Reuse/link existing contact, project vertical, deduplicate address, reuse receipt or dispatch ZeroBounce, prepare 1–3 useful recipients. |
| 2 | Same target pool with an email but unresolved classification/link evidence that can be resolved from retained source/website/phone/address/Maps identity | Resolve missing local evidence and classification in parallel with validation; no repeated email discovery merely because the email is unvalidated. |
| 3 | Strong target businesses with no useful retained email | Website/contact discovery using available providers; validate newly discovered unique addresses; Apollo deferred. |
| 4 | Unknown location/industry, weak identity, malformed/telemetry addresses, test/demo records or actual conflicts | Classify/repair or exclude with explicit reason; do not let raw score or name-only 0.95 consume the useful work queue. |

Use age/fairness within priorities; stop selecting additional recipients once the business has 1–3 useful distinct addresses for this program. Keep real provider rate-limit handling and dispatch idempotency. The user's 10k ZeroBounce credits are provider capacity, not authority to mark unvalidated emails valid or an application-imposed quota; prioritize useful unique addresses instead of indiscriminately validating every stored row.

The existing paid Outscraper work must feed this same repaired ingestion pipeline. Preserve the already analyzed five workbooks: 2,914 rows, 1,245 businesses, 1,890 unique RECEIVING-labelled emails across 1,042 businesses in the prior file analysis. Those are source observations, not fresh ZeroBounce-qualified recipients. The user's instruction remains to fix the CRM first; no live workbook import was performed in this audit.

## User-facing consolidation

Replace operating funnels with five coherent views: Pipeline; Records; Imports & Sources; Exceptions; Settings & Health. Provider results, census, intelligence, quality and historical cohorts become contextual record/progress views. Keep inbound operations as a separate business function sharing canonical records. Routine users should not type event IDs, repeatedly resume pages, freeze cohorts or approve established links. They should see what was committed, what is next, the genuine failure reason and the automatic retry.

The report identifies concrete breaks and corrections; it does not certify a repaired system. Completion requires the production proofs defined above and in the verification section, including useful paused enrollments from existing contacts and a qualifying business that has never belonged to a frozen cohort.
