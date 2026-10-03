# CRM enrichment repair handoff — October 2, 2026

This handoff addresses the existing CRM/enrichment system before importing the five new Outscraper workbooks. It replaces the idea that one gate or one 100-business cohort explains the whole failure. It separates observed production behavior, current repository implementation, and checks still requiring production database/worker access.

## Scope and evidence limits

Read-only recheck of the signed-in Liberty Bancard CRM: Businesses/contact-link census, South Florida Prospecting, Provider Results, Enrichment Program Health, and the high-confidence candidate preview. Relevant repository modules were fetched at commit `74c15805a5cbdb3e0a82183c8c56104999075671` (October 2, 20:12 UTC). The production Health screen reports runtime release/build identity `1fe28bc0d1ff9ad86e777c96b67902701f159fd8`. These are different identifiers; this alone does not prove an execution mismatch or blocker. Replit must establish the exact source commit for the published artifact before applying this handoff.

No repository edits, production data mutations, approvals, imports, paid provider requests, or outbound sends were performed in this recheck. The candidate preview was loaded read-only. User instruction: do not modify the repository while Replit is working.

This is not a direct production SQL census or a complete checkout/build/test of the entire repository. Live UI counts and sampled records are evidence, but cannot establish all full-pool denominators, current database trigger definitions, or every provider task's current state. Those unresolved checks are explicitly required below; do not mark them verified from documentation or source alone.

## Current production observations

| Measure | Observed value | Meaning / limit |
|---|---:|---|
| Canonical businesses | 85,450 | Businesses screen after loading; increased from earlier 85,416 |
| Contacts in link census pool | 154,418 | Separate population from source prospects and canonical businesses |
| Link census processed | 50,500 | 33%; incomplete, not a full-pool result |
| Strict auto eligible in processed census | 0 | Current strict policy, not proof that no legitimate link exists |
| Already verified in processed census | 1 | Census slice only |
| Recoverable identity in processed census | 46 | Candidates, not completed contact links |
| Needs business discovery in processed census | 32,768 | Exclusive bucket |
| Review in processed census | 17,684 | Exclusive bucket; not necessarily genuine ambiguity |
| Suppressed in processed census | 1 | Remaining exclusive buckets zero |
| CRM contacts with email | 153,566 | SFP overview population |
| Verified linked to canonical | 32 | SFP overview global measure |
| Inside frozen SFP cohorts | 31 | Narrower measure; not the same denominator |
| Provider operations, rolling 24h | 8,515 | Operation records, not proved paid HTTP requests or leads |
| Distinct provider targets, rolling 24h | 5,565 | Attempted target fingerprints |
| Validation decisions, rolling 24h | 1,293 / 14 eligible | Includes 1,217 `discovery_required` rows; not 1,293 ZeroBounce calls |
| Ready-held created, rolling 24h | 72 / 0 from contacts | Intent output; not 72 unique qualified recipients |
| General candidate pipeline | 7,728 staged / 0 admitted pending ZB | Admission backlog; exact causal gate must be traced |
| General CRO-03C provider admission | `NO_ATTESTATION` | Live diagnostic for that lane, not proof routine SFP shares it |
| SFP Phase A | 3,667 target / 1,564 non-target | Decision counts in displayed policy scope |
| Free-only continuation | cursor 82,960 / 87,701; 10,565 classified / 1,309 target | Bounded recurring classification, not proof paid AI ran |

Counts were read sequentially while production remained active; they are not one transactional database snapshot. Do not combine them into conversion rates.

## Changes that have landed or improved

1. Named-email review now exposes company/contact links and an actual address, with a reason dropdown instead of mandatory typed prose. The manual review hold itself remains.
2. Provider Results now distinguishes deterministic/free decisions, AI results and blocked attempts. The previous label claiming every classification row was an OpenAI call was wrong.
3. Provider Results explicitly separates discovery backlog from actual validation outcomes and labels reused results as having no new charge.
4. Serper and ZeroBounce now show healthy failure protection. A closed circuit means healthy transport protection, not a disabled provider.
5. The high-confidence preview now loads a table successfully. Business 82988 (Duany's Electrician Services LLC) has an enabled selection checkbox; excluded business 66245 is disabled. The screenshot's SQL 500 is not reproduced in this recheck. This does not verify freeze/execute writes or automatic processing.
6. `sfp-continuous-discovery.ts` now drains bounded batches and rotates/adopts cohorts; `queue-manager.ts` registers discovery and validation every ten minutes and classification every two minutes. The workers' existence does not prove production output, but the workflow is no longer purely manual in code.
7. Routine SFP certificate refresh is explicitly retired in `sfp-attestation-refresh.ts`. Routine SFP uses durable deployment ownership and renewable operation leases. Independent CRO-03C certificate-dependent paths remain separate. Do not reintroduce equality to an old cohort's release SHA.

## Remaining defects and required corrections

### 1. Automatic relationship authority still uses an overly restrictive contract

Confirmed current code: `server/services/contact-business-system-link-policy.ts`, `evaluateSystemLinkFacts` and `matchesSystemLinkDatabaseGuardIdentity` require independent Sunbiz linkage, matching registry/contact/business websites, matching names and a corporate email matching the domain. Live census reasons include 17,611 missing registry websites, 14,419 non-independent corporate email domains and 17,730 database guard identity mismatches in the processed 50,500 records. Reasons overlap.

The broader UI says a unique company-name match can be confirmed without a website or corporate email, but that is a human confirmation route. Census processing does not approve links; source materialization also does not create a verified contact relationship. Adding more review forms has not supplied the desired automatic write path.

Correction: implement a single evidence-backed automatic relationship decision service shared by match generation, writer and database enforcement. Support trusted stable business identifiers and independently corroborated name/address/phone/domain/filing evidence. Explicitly handle legal name versus trade name and company/location relationships. A missing registry website or a personal email host must not independently reject a company relationship. A name-only candidate can trigger further identity discovery; it must not be confused with a validated recipient. Genuine competing businesses or contradictory evidence remain conflicts. Shared hosts such as Instagram, Waze and link aggregators are not business identity domains.

Verify production database triggers and every system writer against the replacement policy. Otherwise the application can classify broader evidence but the database still refuses the write. Keep provenance, revision checks and replay protection; do not fabricate human approvals or label copied fields as independent evidence.

### 2. Vertical classification and contact filtering use separate authorities

Confirmed live Provider Results explanation: SFP classifications do not overwrite legacy business verticals. Current `lead-ops.ts` Businesses queries/filter facets use `businesses.vertical`; contacts route passes a distinct contact vertical filter; `contact-readiness.ts` evaluates `contact.vertical`. SFP classification evidence carries `resolved_vertical_id`, taxonomy and policy versions. These are different representations.

Therefore a blank or zero legacy contact facet is not a reliable census of SFP-classified businesses. It is also unacceptable as the working CRM view: the user cannot use the five intended verticals consistently.

Correction: expose one effective canonical vertical ID to Businesses, Contacts, filters, readiness, qualification, ranking and enrollment. Preserve raw provider/legacy labels and classification history separately. For a verified business relationship, inherit the business's current evidence-backed canonical classification unless a genuine contact/company conflict or explicit override applies. Backfill through a resumable worker and report missing, mapped, conflicting, excluded and unresolved counts separately. Current five targets: Automotive; Healthcare; Beauty/Spa; Construction/Trades/Home Services; Fitness/Recreation. Map old aliases such as Auto, Medical/Dental/Medspa, Construction, Gym and Salon/Spa explicitly, preserving subtypes. Do not infer an industry solely from an import filename.

### 3. Free-only classifications and AI execution must be measured separately

Confirmed code: `sfp-classification-bridge.ts` records `FREE_ONLY_NO_ESCALATION` without calling OpenAI in free-only mode. Unavailable/unconfigured escalation is provisional rather than completed. `sfp-free-classification-continuation.ts` has a paid escalation follow-up, gated by transport enablement and provider readiness. That is an improvement over permanently caching non-attempts.

Correction: verify live escalation dispatch receipts and return reasons grouped by transport disabled, credential unavailable, provider gate, runtime authority, insufficient evidence, actual model failure and actual model decision. Retry newly actionable provisional records automatically, with evidence/version-aware cooldowns. Strong category/service evidence should classify deterministically; ambiguous cases should acquire evidence or reach configured AI, without requiring operators to manually classify the pool. Do not call all zero-confidence rows model failures.

### 4. General candidate admission and routine SFP remain disconnected

Live Health shows 7,728 staged candidates, zero admitted pending ZB and a separate CRO-03C `NO_ATTESTATION` provider-admission diagnostic. Promotion is displayed open. Current routine SFP deliberately retired the old certificate refresh; that does not automatically repair independent CRO-03C flows.

Correction: trace the 7,728 candidates through the exact admission function, exclusion/eligibility predicates, runtime owner, queue producer and validation consumer. Record how many are actionable versus missing identity, scope, syntax, suppression or obsolete state. Do not assert that the adjacent `NO_ATTESTATION` card caused every candidate to stall without that trace. Choose and document the operational authority for each lane; automate the intended current-owner recovery and eliminate obsolete manual runtime tasks in routine enrichment. A healthy generic queue heartbeat must not substitute for named-worker completion and output.

### 5. Spend authorization still survives in current routine SFP code

Confirmed source: `sfp-validation.ts` preview calls `assertPaidBudgetAuthorized`; `sfp-provider-operations.ts` calls it in both ordinary and pre-cohort reservations. `mi09-pilot-authority.ts` throws if the authorization is missing/revoked. This conflicts with the user's instruction that routine provider-spend usage gates were removed. Missing live budget authorization has not been proven as the current blocker.

Correction: remove obsolete routine-spend authorization dependencies from all routine preview, reservation, dispatch and retry paths, including AI escalation. Preserve cost recording and provider-credit visibility as informational data. Retain credentials, health handling, idempotency and runtime ownership. Keep unrelated deliberately restricted legacy pilot flows clearly separated. Do not silently reinstall spend approvals.

### 6. Recipient policy depends on source representation

Confirmed code: contact candidates in `sfp-paid-evidence-writer.ts` use `subjectType: person`. `sfp-validation.ts` derives named-versus-role classification from that subject type. `sfp-outreach-policy.ts` defaults named contacts to review unless the active policy explicitly sets otherwise.

Confirmed live examples: Skyview Roofing, P & J Roofing, Rob Roofing and Escalante Landscaping each have a free-source row marked `validated_outreach_eligible` and a contact-source row for the same displayed business/address receipt held as `validated_review_required`. Building Promises Roofing and Tricoast Roofing repeat many times in the named review queue. Reuse correctly avoids additional provider charges, but does not produce a consistent recipient decision.

Correction: evaluate the actual recipient/email identity and current business association consistently across sources. A CRM row is not proof that an inbox belongs to a named person; a free candidate is not proof that it is a role inbox. Preserve genuine named identity and source evidence. Make corroborated business recipients automatically eligible under the intended cold-outreach policy; use review for unresolved identity/conflicts instead of every named address. Recompute existing valid-held projections from retained fresh receipts after the policy repair; do not spend credits again merely to repair projections. Keep send release separate.

### 7. One-winner/business selection cannot implement 1–3 recipients/business

Confirmed `sfp-validation.ts`: `selectWinnersPerBusiness` uses a business-keyed map and skips later candidates once a winner exists. `getUndecidedCohortBizIds` excludes a business once a staging intent exists for it in that cohort.

Correction: rank and deduplicate recipient identities, select up to the configured 1–3 useful recipients per business, and try alternatives after invalid/failed addresses. Count current unique recipients across cohorts to enforce the cap globally. Prefer corroborated owner/decision-maker or an appropriate business inbox; avoid contacting three representations of the same mailbox. Separate batch size from pool size. Twenty-five transports per call or a 100-record page can remain processing chunks, but must not cap the eligible universe.

### 8. Cohort-scoped history creates repeated projections and review work

Confirmed live repeated rows; current scheduling scans frozen non-voided/non-superseded cohorts. Historical cohort memberships are valuable provenance but cannot be the unique-recipient authority.

Correction: keep append-only cohort history while maintaining one current recipient projection and work key based on program, business, normalized email identity, active policy and relevant identity/evidence revision. Reuse completed provider observations. Prevent another overlapping cohort from generating the same manual-review item, intent or enrollment. New evidence can reopen work without replaying every old cohort. Test fresh discovery, failed address replacement, policy revision, publish restart and overlapping imports.

### 9. Metrics currently imply more processing than occurred

Confirmed `lead-ops.ts` counts all recent `sfp_outreach_eligibility` rows as validation decisions. Live 1,293 includes 1,217 discovery-required records. Provider-operation totals likewise include operation records rather than proving completed outbound provider HTTP requests. Ready-held counts are intent counts, not unique recipients.

Correction: show separate counts for eligible pool, admitted work, reserved operations, dispatched HTTP requests, completed observations, cached reuses, pending discovery, distinct valid addresses, policy-eligible unique recipients, businesses with 1–3 recipients, staged intents and accepted/paused enrollments. Put population/time/policy scope beside every measure. Show unavailable as unavailable, not zero. Attribute each rejection and blocked transition to its actual current code/reason.

### 10. Paid discovery may return the wrong business

Live retained Provider Results include a California result for Millennium Plumbing while the SFP target is South Florida. Historical shared-domain candidate examples also show why matching copied domain values is not independent corroboration. A returned result is not necessarily a qualified match.

Correction: reconcile provider target versus returned stable ID, address/geography, trade/legal name and contact ownership before promoting evidence. Distinguish wrong entity, wrong location, no result and missing email. Quarantine actual contradictions and continue alternatives automatically. Do not validate an unrelated result's email merely because the provider call completed.

### 11. The previously reported four provider tasks need current receipts

Repository execution-status documentation reports four historical `outscraper_task_submitted` items from a partial waterfall stage. This is not a verified current inventory of four pending tasks. Current retrieval code/schema support retained task IDs and polling.

Required production read: return each internal task ID, external provider task ID, submission operation, cohort/business, state, last/next poll, attempts, result count and terminal disposition. Match against the original provider request receipt. Resume retrieval of existing tasks where applicable; never resubmit them blindly. If no longer pending, correct the previous report. Their exact current IDs/state remain unverified in this audit.

## Implementation order and production acceptance

Replit should perform one integrated repair, reusing existing implementations where already correct:

1. Pin the published source revision and read actual production schema/guard versions. Produce the full census below before changing policies or replaying work.
2. Unify automatic business linking and canonical classification/projection across CRM and enrichment; deploy matching service/writer/database enforcement together.
3. Repair lane admission and obsolete routine authorization dependencies. Ensure restart/publish recovers work without an old SHA or manual event-ID ceremony.
4. Repair recipient policy, recipient deduplication and global 1–3 cap; recompute fresh cached receipts and drain actionable backlog automatically.
5. Verify live named workers for classification, discovery, task retrieval, validation, staging and accepted/paused enrollment. Observe at least two successive scheduled executions with actual record movement, not only job completion.
6. Update UI to expose current state and genuine conflicts. Then implement the idempotent 93-column Outscraper adapter, preserving raw rows and provenance. Import only after the repaired path passes.

Full production census must cover all source prospects, canonical businesses and contacts as separate denominators, grouped by five target verticals/geography and missing/unknown scope. Track source → canonical relationship → verified contact association → effective vertical/geography → candidate email → validation admission → actual dispatch/completed observation/reuse → policy eligibility → unique recipient → staging → accepted paused enrollment. Report exclusive primary blocked-transition buckets with optional overlapping secondary reasons. Include stable IDs for sample traces in every bucket.

Acceptance must demonstrate: clear imported identities automatically link without operator decisions; genuine conflicts remain unresolved; effective vertical filters agree across Contacts/Businesses/SFP; syntactically usable, in-scope unsuppressed addresses reach ZB automatically; transport errors never become invalid-email facts; one provider-valid recipient has one consistent eligibility decision across source types; 1–3 distinct recipients per business is enforced; invalid winners permit alternatives; no duplicate calls/intents/enrollments occur on replay, restart or publish; old cohort identity does not stall current execution; and no outbound messages are released.

Do not close Task 2060 on a UI change, passing type check, worker heartbeat, complete scan with zero links, one manufactured new contact, or one successful canary. Report actual production movement, remaining unresolved populations and reasons. Do not use 5,000 recipients across only 100 businesses as the acceptance target: it contradicts the 1–3 cap.

## Deferred Outscraper import

The five workbooks were previously analyzed as 2,914 exported rows and 1,245 unique place IDs; these are source rows/business identities, not CRM-qualified leads. They include 1,890 distinct `RECEIVING` emails across 1,042 businesses before geography/identity policy checks. `RECEIVING` is retained provider evidence and must not be relabeled as fresh ZeroBounce validity. Preserve all returned columns and contacts; choose 1–3 recipients/business after identity and scope resolution. Do not purchase another duplicate discovery pass for businesses whose usable evidence is already retained.

This handoff is ready for implementation reconciliation. The CRM has not been repaired by this audit, and production-only gaps above remain open until supported by actual queries and receipts.
