# Master Implementation Task — Canonical Enrichment, ROI Cohorts, and Governed Outreach

## Goal

Deliver one production path that continuously converts source evidence into deduplicated canonical businesses and locations, resolves the five target verticals, ranks exact South Florida candidates, exhausts free evidence, applies bounded paid enrichment only where justified, validates and suppresses emails, and assigns eligible prospects to governed campaigns and sequences without sending until an explicit operator launch.

This task closes the current gaps end-to-end. Do not split newly discovered blockers into follow-up tasks unless an external provider or DNS administrator action is genuinely required.

## Current production baseline

- 1,919,454 Sunbiz/source evidence rows
- 6,471 canonical businesses
- 154,418 contacts
- 14,349 production contacts missing email, phone, or website
- 6,147 staged free-discovery candidates
- 257 currently geography-resolved South Florida canonical businesses
- 6,209 geography-unresolved canonical businesses
- 0 five-vertical SFP candidates due raw-label exact matching
- 0 `master_leads`
- outreach queue count incomplete/null
- 13 campaigns, 117 sequences, 114 with missing workflow wiring
- provider credentials present; ZeroBounce enabled; canonical Serper/Outscraper/OpenAI/Apollo controls disabled
- no SFP cohort run and no outreach performed

## Workstream 1 — Canonical source inventory and lineage

1. Register real adapters for Sunbiz, Serper, Outscraper/provider CSV, Apollo, public web, and operator imports.
2. Add an append-only source-materialization ledger with immutable source hashes and terminal dispositions.
3. Backfill `canonical_source_links` for existing canonical businesses where deterministic evidence supports the link.
4. Build idempotent identity resolution using normalized domain, phone, and name/address/ZIP keys.
5. Route fuzzy name-only matches to review; never auto-merge them.
6. Preserve source history and merge aliases.

**Acceptance:** Every processed occurrence has a disposition; at least 95% canonical lineage coverage or an explicit provenance exception; no duplicate canonical business is created in rerun tests.

## Workstream 2 — Geography canonicalization

1. Normalize all business and source addresses into `business_locations`.
2. Resolve ZIP/city/state to county FIPS with versioned evidence.
3. Change the ROI selector to read every location row, including known non-target counties.
4. Create location-level states: inside verified/inferred, outside verified, conflicting, unresolved.
5. Make multi-location candidacy explicit.
6. Rebuild the UI funnel so all 6,471 rows reconcile exactly.

**Acceptance:** `inside + outside + conflicting + unresolved + excluded = total`; each SFP candidate contains a qualifying location ID and county FIPS.

## Workstream 3 — Versioned target-vertical resolver

1. Implement the exact five-vertical taxonomy from the audit report.
2. Map broad existing labels (`Auto`, `Healthcare`, `Salon/Spa`, `Food/Beverage`, `E-commerce`) using positive and negative evidence.
3. Reuse free-crawler page content—homepage, JSON-LD, contact/about, services/menu/team—not merely domain/name strings.
4. Persist evidence snippets/hashes, source URLs/page types, confidence, classifier version, and disposition.
5. Add a content-hash-cached OpenAI structured classifier for unresolved evidence bundles only.
6. Enforce no-invention and deterministic-evidence precedence.

**Acceptance:** All current 257 SFP rows receive a terminal classification attempt; exact raw-label mismatch can no longer produce zero solely because target names are narrower.

## Workstream 4 — Correct ROI selector and exact candidate export

1. Score after geography and vertical resolution, not before.
2. Correct email semantics: `active` is not `provider_valid`.
3. Persist all 13 dimensions plus classifier/geography versions.
4. Add an exact masked export for selected and excluded candidates.
5. Freeze a maximum 100 program cohort and a maximum 25 paid canary.
6. Make selection idempotent and globally ranked after all rows are evaluated.

**Acceptance:** Non-empty eligible cohort when qualifying evidence exists; rerun returns the same cohort hash; export includes business/location IDs, vertical, score, masked candidate, validation and exclusion state.

## Workstream 5 — Free-enrichment scheduler and shared domain evidence

1. Repair repeatable-job registration/telemetry so scheduler enabled, running state, next run, queue depth, and heartbeat agree.
2. Retain one canonical free producer.
3. Measure terminal attempts rather than cumulative `complete` counts.
4. Share domain cache/crawl results across businesses and contacts.
5. Preserve negative-cache TTL, domain locks, retries, reaper, and SSRF protections.
6. Sustain 500 terminal attempts/24h in soak; allow bounded configuration toward 1,000/day.

**Acceptance:** Non-null next run, truthful backlog ETA, no duplicate domain crawl under concurrency, and 24-hour source/page/yield telemetry.

## Workstream 6 — Contact enrichment integration

1. Keep the existing 24-hour contact cooldown and contact-level Serper budget/circuit breaker.
2. Link contacts to canonical businesses before fan-out where possible.
3. Route discovered domains through the shared crawler/candidate normalizer.
4. Report Serper website/phone/email snippet yield separately from free contact-page yield.
5. Clarify the separate contact Serper and canonical/SFP provider controls in UI.

**Acceptance:** The 14,349-row backlog has attempts/day and ETA; one attempt creates one cooldown event; crawler addresses are persisted as candidates, not placeholder counts.

## Workstream 7 — Complete the SFP paid-provider waterfall

1. Extract reusable adapters from the canonical CRO-03 live executors.
2. Wire Serper, Outscraper, OpenAI, Apollo, and ZeroBounce through `sfp-provider-operations`.
3. Require cohort/run/business/candidate identity on every operation.
4. Preserve runtime authority, credentials, provider control, circuit, pricing, local cap, aggregate $50 cap, reservation, settlement, and idempotency.
5. Apply the value order:
   - free crawl;
   - OpenAI vertical classification only for ambiguous page evidence;
   - Serper for missing identity/domain;
   - Outscraper for unresolved location/category;
   - Apollo for high-ROI decision-maker gaps;
   - ZeroBounce for the final selected address.
6. Stop once sufficient evidence exists.

**Acceptance:** Fake-transport tests cover every provider and stop condition; production preview shows exact worst-case cost; no global candidate can enter an SFP provider call.

## Workstream 8 — Validation and outreach eligibility

1. Keep ZeroBounce maximum batch 25 for the canary.
2. Validate only candidates belonging to the frozen cohort.
3. Recheck DBPR, existing-customer, suppression, opt-out, complaint, bounce, and test/demo status before reservation and before staging.
4. Keep role inbox provider-valid eligible; named provider-valid review-required until corroborated.
5. Mark catch-all/unknown review-required and invalid/abuse/spamtrap terminal.
6. Make `/api/outreach-queue/count` exact and complete.

**Acceptance:** Only fresh `provider_valid` plus all policy gates produces an eligible row; count/reason buckets reconcile to cohort size; rerun spends no duplicate credit.

## Workstream 9 — Campaign and sequence packages

1. Split campaign 6 into Med Spa and Dental.
2. Narrow campaigns 8 and 7 to Auto Repair and qualified Retail.
3. Review campaigns 5, 7, 8, 11 for content reuse; do not overwrite history.
4. Create five new paused governed sequences modeled on sequence 85:
   - SFP Med Spa — Cold Email + Manual Call
   - SFP Dental — Cold Email + Manual Call
   - SFP Auto Repair — Cold Email + Manual Call
   - SFP Restaurant — Cold Email + Manual Call
   - SFP Retail — Cold Email + Manual Call
5. Set `sequenceFamily`, `channelsAllowed=[email,task]`, and eligible consent tiers explicitly.
6. Exclude SMS/voice/ringless voicemail without verified PEWC.
7. Quarantine 18 test-like sequences and keep historical rows.

**Acceptance:** All five packages pass content/compliance review, remain paused, and expose a deterministic vertical-to-campaign-to-sequence mapping.

## Workstream 10 — Idempotent staging-to-enrollment bridge

1. Add campaign and sequence IDs plus policy/content versions to `sfp_campaign_staging_intents`.
2. Add a reviewed state transition: `staged -> approved -> enrollment_staged -> enrolled`.
3. Implement an idempotent consumer that creates campaign membership and sequence enrollment only after approval.
4. Keep all new enrollments paused until explicit launch.
5. Recheck contactability immediately before enrollment and immediately before each send.
6. Record every rejection/retry reason.

**Acceptance:** Staging never sends; approval creates at most one membership/enrollment; replay is a no-op; invalid/suppressed candidates cannot enroll.

## Workstream 11 — Lead Ops UI and operator workflow

Create one Enrichment & Outreach Operations view showing:

- source-to-canonical materialization funnel;
- lineage coverage;
- geography funnel;
- five-vertical classification funnel;
- exact ROI candidates;
- free/contact/paid provider yield and cost;
- validation and suppression funnel;
- campaign/sequence staging and enrollment counts;
- current configuration authority and next run;
- backlog ETA;
- masked candidate details and evidence.

Operator actions must be bounded and named:

- resolve/retry selected records;
- run bounded free catch-up;
- preview paid waterfall cost;
- authorize one frozen canary;
- validate at most 25;
- review named/catch-all candidates;
- approve campaign staging;
- launch paused canary.

**Acceptance:** No UI button silently changes secrets, starts recurrence, or sends. Every mutation returns a receipt and refreshed counts.

## Workstream 12 — Deliverability, tests, and production certification

### Deterministic tests

- source/link idempotency and dedupe;
- conflicting identity review;
- inside/outside/unresolved geography and multi-location behavior;
- all five vertical aliases and negative exclusions;
- webpage evidence and cached AI fallback;
- free scheduler registration, lease/reclaim, domain lock/cache;
- contact cooldown;
- each provider reservation/settlement and stop condition;
- cohort-only validation;
- suppression/DBPR/existing-customer/test exclusions;
- provider-valid-only eligibility;
- campaign/sequence mapping and idempotent enrollment;
- no send from discovery, validation, or staging;
- exact outreach queue reconciliation.

### Production checks

- SPF/DKIM/DMARC and sending identity;
- unsubscribe/footer/reply routing;
- mailbox/domain caps;
- bounce/complaint feedback;
- seed delivery/inbox placement;
- 25-record frozen canary cost preview;
- zero provider call outside cohort;
- zero send before explicit launch.

### Required production report

Produce one signed/captured report containing:

- before/after population counts;
- exact cohort hash and masked member export;
- provider operations and spend;
- free and paid yield by method;
- validation outcomes;
- campaign and sequence assignments;
- idempotency rerun proof;
- send count and outcomes after launch, if launch is separately authorized.

## Deployment order

1. Schema/migrations and read-only endpoints.
2. Canonicalization, geography, vertical resolution.
3. Corrected ROI preview/export.
4. Free scheduler and shared domain evidence.
5. Reusable paid adapters and fake-transport certification.
6. Validation/eligibility reconciliation.
7. Campaign/sequence packages and paused staging bridge.
8. Production read-only verification.
9. Bounded 25-record paid canary after operator approval.
10. Deliverability checks and separately authorized outreach launch.

## Definition of done

The task is complete only when production can show, in one reconciled view:

1. the source universe and its canonicalization dispositions;
2. exact inside/outside/unresolved geography counts;
3. exact five-vertical classifications with provenance;
4. a non-empty, frozen, masked ROI cohort when qualifying businesses exist;
5. free and contact enrichment throughput/ETA;
6. cohort-bound paid provider operations and costs;
7. provider-valid, suppression-clean outreach candidates;
8. one approved campaign and governed paused sequence per target vertical;
9. idempotent campaign/sequence staging;
10. exact outreach-ready counts;
11. no hidden global spillover;
12. no outreach until the operator issues the explicit launch action.

