# Liberty Bancard CRM Enrichment & Outreach System Audit

**Audit date:** 2026-09-23 UTC  
**Scope:** Production CRM, Lead Ops UI/API, enrichment workers, canonicalization, free discovery, paid-provider controls, validation, campaigns, sequences, and repository implementation  
**Mode:** Read-only. No provider activation, spend, enrollment, campaign launch, or outreach was performed.

## Executive verdict

The system is **not yet ready for controlled cold-email launch**, but the problem is narrower and more concrete than the UI suggests.

The CRM already has substantial source data, a working free crawler, contact-level Serper enrichment, provider credentials, paid-provider guardrails, ZeroBounce validation, and campaign/sequence assets. What it does not yet have is one truthful path that turns the right source records into a geographically resolved, vertically classified, deduplicated, validated, suppression-clean outreach cohort.

The current production selector reports zero qualified candidates because it compares raw canonical vertical labels directly against five narrower target labels. All 257 currently recognized South Florida canonical businesses fail that exact string comparison. This is a **taxonomy mismatch**, not proof that none of the 257 are suitable. At the same time, 6,209 of 6,471 canonical businesses are geography-unresolved, so treating the 257 as the whole opportunity would also be wrong.

The broader system contains five distinct populations:

| Population | Production count | What it actually represents |
|---|---:|---|
| Sunbiz/source entities | 1,919,454 | Raw evidence and source occurrences; not deduplicated canonical businesses |
| Canonical businesses | 6,471 | Materialized business identities currently available to the canonical enrichment lane |
| CRM contacts | 154,418 | Existing contact records; many are unrelated to the current South Florida pilot scope |
| Free email candidates | 6,147 staged | Encrypted discovered addresses awaiting cohort-bound validation; not outreach-ready |
| SFP five-vertical candidates | 0 | Current selector result after the faulty exact-label gate |

The correct remedy is not to turn every provider on globally. It is to build a system-wide source-to-canonical funnel, resolve geography and verticals with evidence and provenance, rank an exact South Florida/five-vertical cohort, exhaust free evidence first, then use bounded paid providers only where they improve the expected value of that cohort.

## Audit evidence and limitations

The audit used:

- authenticated production Lead Ops and API responses;
- production provider controls, campaign/sequence inventory, health, quality, and funnel endpoints;
- repository code for cohort selection, free discovery, paid provider reservation/settlement, validation, campaign staging, contactability, and sequence policy;
- aggregate counts and masked evidence only.

No plaintext email addresses or personal data are reproduced here. Because the current production funnel returns no eligible candidates, there is no truthful list of final named businesses to publish yet. The implementation must generate that list after geography and vertical resolution, including stable business IDs, evidence, score, and disposition.

## 1. Production inventory

### 1.1 Raw Sunbiz/source universe

`GET /api/lead-ops/stats` reads from `sunbiz_entities`, not the canonical `businesses` table.

| Metric | Count |
|---|---:|
| Total source entities | 1,919,454 |
| Enrichment marked complete | 293,267 |
| Pending processing | 967,729 |
| Processing | 39 |
| Failed | 536 |
| Hot | 198,446 |
| Warm | 51,262 |
| Cold | 322,158 |
| Rows with an email field | 2,207 |
| Rows with a phone field | 23,502 |
| Rows with both email and phone | 2,159 |
| Rows with owner name | 762,994 |

These counts cannot be compared directly with canonical business or contact counts. They are source-evidence counts and can include duplicates, non-target geography, incomplete identity, and records that should never be materialized.

### 1.2 Canonical businesses

| Metric | Count |
|---|---:|
| Canonical businesses | 6,471 |
| Canonical non-DBPR businesses | 6,471 |
| Excluded businesses | 24 |
| Free-enrichment complete | 6,354 |
| Canonical source links | 200 |
| Registered source adapters | 0 |
| `master_leads` rows | 0 |

The low lineage coverage is a material governance and deduplication problem: only 200 source links exist for 6,471 canonical businesses, and the source-adapter registry reports zero adapters. Canonical rows may exist, but most cannot be traced through a formal adapter/link contract.

Canonical vertical counts total 6,272, leaving **199 canonical businesses with a blank/null vertical**.

| Canonical vertical | Count | Canonical vertical | Count |
|---|---:|---|---:|
| Other | 1,317 | Auto | 943 |
| Marketing/Media | 667 | Professional Services | 541 |
| Healthcare | 423 | Retail | 393 |
| Real Estate | 387 | Construction | 355 |
| Fitness/Recreation | 246 | Restaurant | 241 |
| Technology | 185 | Salon/Spa | 137 |
| Accounting | 101 | Legal | 82 |
| Hospitality | 78 | Education | 67 |
| Insurance | 58 | Cleaning Services | 24 |
| Transportation | 14 | E-commerce | 10 |
| Food/Beverage | 3 | Blank/null | 199 |

### 1.3 Contacts and deliverability

| Metric | Count |
|---|---:|
| Total contacts | 154,418 |
| Production-class contacts | 153,983 |
| Test-class contacts | 435 |
| Missing phone | 12,225 |
| Missing vertical | 456 |
| Provider-verified valid email | 53 |
| Bad/bounced email | 32 |
| Quality endpoint classified as unvalidated | 154,322 |
| Blocked-contact rows | 78 |
| Missing at least one of email/phone/website | 14,349 |

The CRM has a semantic inconsistency: most contacts carry an `active` email outcome, while the quality endpoint correctly treats almost all of them as unvalidated. `active` must never be interpreted as `provider_valid`.

### 1.4 Free discovery

At the audit refresh:

| Metric | Value |
|---|---:|
| Businesses enriched today | 128 |
| Emails found today | 30 |
| Phones found today | 126 |
| Free candidates staged | 6,147 |
| Validation-admitted | 0 |
| Suppressed | 0 |
| Stalled | 0 |
| Stuck business-processing rows | 0 |
| Pending free-enrichment jobs | 0 |
| Canonical free-enrichment queue depth | 0 |

The scheduler is declared enabled and the worker heartbeat is currently active, but the program-health endpoint reports `running=false`, `status=idle`, `nextRunAt=null`, and a last program run from 2026-09-22 21:21 UTC. This is either a scheduling defect or a telemetry contract defect. It must be corrected before throughput promises are trusted.

### 1.5 South Florida/five-vertical program

The active program definition is:

- Counties: Broward `12011`, Miami-Dade `12086`, Palm Beach `12099`
- Target verticals: Med Spa, Dental, Auto Repair, Restaurant, Retail
- Maximum cohort: 100
- Recurring: disabled

Current selector funnel:

| Stage | Count | Audit interpretation |
|---|---:|---|
| Canonical scanned | 6,471 | Entire current canonical pool |
| South Florida resolved | 257 | Geography currently resolves into one of the three counties |
| Geography unresolved | 6,209 | Location evidence is insufficient or not read correctly |
| Test/demo/internal | 5 | Correctly excluded |
| Outside geography | 0 | Not credible as a world-wide result; most non-SF records are unresolved instead |
| Target vertical | 0 | Caused by exact-label comparison |
| `verticalUnresolved` | 257 | Actually raw-label mismatch, not necessarily unknown industry |
| Eligible after exclusions | 0 | No cohort can be frozen |

The selector loads only target-matching county-FIPS location rows into its FIPS map. A business with a known non-target `business_locations` row can therefore fall through to `geography_unresolved` instead of `outside_geography` if the primary business row lacks usable ZIP/city. The geography funnel is not yet truthful.

### 1.6 Paid providers

Credentials are present. The aggregate paid budget is authorized with a $50 cap and no paid spend recorded in the audited pilot budget.

| Provider | Production control | Unit price | Current role | Finding |
|---|---|---:|---|---|
| Serper | Disabled in canonical paid-provider control; separate contact gateway active | $0.001/request | Website/business discovery | Two independent control planes are confusing operators |
| Outscraper | Disabled | $0.003/result | Business/category/location evidence | Not wired into the independent SFP waterfall |
| OpenAI | Disabled | $0.00001/token | Classification | Existing adapter is tied to CRO-03 generation/handoff context |
| Apollo | Disabled | $0.025/credit | Named decision-maker/contact enrichment | Not wired into the independent SFP waterfall |
| ZeroBounce | Enabled, circuit closed | $0.0195/request | Email validation | 630 consumed, 4 reserved at refresh |

The contact backlog uses its own `serper_control` gateway and is active. The canonical/SFP provider cards use `provider_controls`, where Serper is disabled. Turning on one does not turn on the other.

The independent SFP paid waterfall currently supports only Serper plus a free first-party recrawl. The repository has canonical Apollo/Outscraper/OpenAI executors, but they are not reusable SFP adapters yet. Provider controls alone therefore cannot create the intended full waterfall.

### 1.7 Campaigns and sequences

| Asset | Count/status |
|---|---|
| Campaigns | 13 total: 12 draft, 1 active |
| Campaign sends | Target campaigns show 0 sent |
| Sequences | 117 total: 48 active, 69 paused |
| Sequence grouping | 50 vertical-specific, 25 cold outreach, 18 uncategorized |
| Test/kill/gate-like sequence names | 18 |
| Missing workflow wiring | 114 of 117 |

Relevant campaign drafts:

| Vertical | Existing campaign asset | Decision |
|---|---|---|
| Med Spa | Campaign 6: Medical / Dental / Medspa | Split; do not combine with Dental |
| Dental | Campaign 6: Medical / Dental / Medspa | Split; unique offer and objections |
| Auto Repair | Campaign 8: Auto / Service / Trades | Narrow to Auto Repair |
| Restaurant | Campaign 5: Restaurant & Food Service | Reuse after compliance/content review |
| Retail | Campaign 7: Retail & E-Commerce | Narrow to qualified retail storefront/DTC |

Existing vertical outbound sequences (55 Med Spa, 58 Dental, 61 Auto Repair, 33 Restaurant, 24 Retail) do not carry the explicit consent/channel governance metadata shown on sequence 85. Sequence 85, `W6 — Cold Outreach: Email + Manual Call`, is paused and has the safer shape: email plus manual task, with explicit cold/warm/PEWC tiers. The correct plan is to create five governed vertical-specific variants of that model, not enroll candidates directly into ungoverned active sequences.

The SFP `stageForCampaign()` service does **not** apply a campaign or sequence. It creates a no-send staging intent and a `master_leads` row marked `not_ready` with reason `awaiting_explicit_campaign_authorization`. No consumer maps those staging intents to campaign/sequence enrollments. That missing handoff is a real implementation gap.

The outreach queue endpoint currently returns `count=null`, `exact=false`, and `incomplete=true`; there is no trustworthy outreach-ready count.

## 2. Correct canonical data model

The production system must treat the following as distinct layers:

| Layer | Canonical unit | Required identity/provenance |
|---|---|---|
| Source evidence | One occurrence from Sunbiz, Serper, Outscraper, Apollo, public web, CSV | Adapter, external ID, captured time, immutable raw hash |
| Canonical business | One operating business identity | Normalized domain, name/address/phone keys, merge history |
| Business location | One physical/operating location | Full normalized address, ZIP, county FIPS, confidence, source |
| Person/contact evidence | Named person or role attached to business | Role, source, confidence; no auto-promotion from officer evidence |
| Email candidate | One normalized encrypted address | Page/source, candidate type, confidence, rejection/disposition |
| Validated channel | Candidate plus provider result | Provider, result, timestamp, freshness, suppression recheck |
| Outreach prospect | Business/contact view eligible for one campaign | Cohort, vertical, score, consent tier, policy version, campaign/sequence intent |

### Canonical identity rules

Use deterministic evidence in this order:

1. normalized registrable domain plus operating name;
2. exact normalized phone plus compatible name/location;
3. normalized legal/DBA name plus street and ZIP;
4. source-specific identifier linked through `canonical_source_links`;
5. fuzzy name-only matches must enter review, never merge automatically.

Sunbiz document number proves source lineage; it does not by itself prove that two operating locations or brands should be merged. Registered agents and officers are decision-maker evidence only and must not become CRM contacts without corroboration.

## 3. Exact target taxonomy

The five campaign groups must use versioned canonical vertical IDs and an evidence-backed classifier, not raw string equality.

| Target vertical | Deterministic aliases/evidence | Exclusions requiring different group or review |
|---|---|---|
| Med Spa | `Salon/Spa` or `Healthcare` plus med spa, medical spa, aesthetics, injectables, Botox, cosmetic laser, skin rejuvenation | Salon-only, massage-only, day spa without medical/aesthetic procedures |
| Dental | `Healthcare`/`Professional Services` plus dentist, dental, orthodont, endodont, periodont, prosthodont, oral surgery | Dental lab, manufacturer, insurer, distributor |
| Auto Repair | `Auto` plus repair, mechanic, body shop, collision, transmission, tire, oil change, service center | Dealership-only, rental, towing-only, parts-only |
| Restaurant | `Restaurant` or qualified `Food/Beverage` plus restaurant, cafe, grill, pizzeria, bakery, catering, bar, food truck | Manufacturer, wholesale distributor, grocery retail |
| Retail | `Retail`/qualified `E-commerce` plus store, shop, boutique, apparel, jewelry, gift, specialty retail, DTC storefront | Wholesale-only, manufacturer-only, marketplace seller with no operating business evidence |

Classification outcomes must be:

- `resolved_high`: deterministic match with corroborating website/source evidence;
- `resolved_medium`: strong alias/keyword match requiring no conflicting evidence;
- `review_required`: ambiguous or conflicting evidence;
- `not_target`: evidence supports another vertical;
- `unresolved`: insufficient evidence after bounded attempts.

OpenAI may classify only the last two ambiguous evidence bundles using structured output, a fixed taxonomy, citations to supplied snippets, and content-hash caching. It must never invent a contact, address, revenue, or consent fact.

## 4. Exact candidate groups and treatment

The system should produce the following mutually exclusive cohorts. These are the exact operational group definitions; today only the global counts shown below are available because the SFP selector yields zero candidates.

| Group | Exact definition | Current known count | Next action |
|---|---|---:|---|
| X0 Excluded | DBPR lineage, test/demo, existing customer, suppressed, complaint, hard bounce, inactive terminal state | 5 test/demo in SFP funnel; other SFP exclusions currently 0 | Never enrich/send; retain reason |
| G1 Geography unresolved | Canonical business without resolved inside/outside geography | 6,209 | Address/location canonicalization |
| G2 SFP vertical unresolved/mismatched | In target counties; target classifier not complete | 257 | Deterministic website/source classification, then cached AI fallback |
| G3 Target + provider-valid | SFP target vertical, suppression-clean, fresh provider-valid email | 0 proven | Highest-priority campaign staging |
| G4 Target + staged email candidate | Same scope with staged encrypted candidate but no fresh validation | SFP count unknown; 6,147 global | ZeroBounce, bounded by cohort |
| G5 Target + domain, no candidate | Same scope, domain known, free crawl completed/no candidate or stale | Unknown until classification | Targeted free recrawl/contact-page crawl |
| G6 Target + missing domain | Same scope, no trusted website | Unknown until classification | Serper, then Outscraper if needed |
| G7 Named decision-maker gap | High-ROI business; no corroborated named contact/address | Unknown | Apollo only after free/business evidence is exhausted |
| G8 Valid catch-all/ambiguous | Provider catch-all/unknown or conflicting role attribution | 0 in contact summary | Manual review; no automatic enrollment |
| G9 Outside SFP | Resolved outside the three counties | Current selector incorrectly reports 0 | Park for later regional program |
| G10 Existing contact backlog | Production contact missing email, phone, or website and not excluded | 14,349 | Continue contact Serper + shared domain crawler |

An “exact candidate” export must contain: canonical business ID, canonical name, location ID/county, target vertical and classifier version, evidence sources, ROI score/dimensions, selected masked email candidate, validation status/date, suppression state, chosen campaign, chosen sequence, and final disposition. It must never return plaintext email in the health/audit UI.

## 5. Root causes and ranked blockers

### P0 — Blocks any truthful cohort

1. **Geography is unresolved for 6,209/6,471 canonical businesses.** Location evidence is not comprehensively normalized or interpreted.
2. **Vertical matching uses exact raw strings.** All 257 resolved-SFP rows are rejected before classification.
3. **No system-wide materialization funnel exists.** The 1.919M source universe is not reconciled to the 6,471 canonical businesses with complete lineage and dispositions.
4. **Outreach-ready state is incomplete.** The API cannot return an exact queue count and no SFP cohort exists.

### P1 — Blocks scalable enrichment and paid ROI

5. **Free scheduler truth is inconsistent.** Enabled worker, idle program, zero queue depth, and null next run cannot support an ETA.
6. **Independent SFP waterfall lacks Outscraper, Apollo, and OpenAI adapters.** Enabling provider controls does not make them runnable in SFP.
7. **6,147 staged candidates are global.** Globally promoting them would violate the requested South Florida/five-vertical scope.
8. **Contact and canonical Serper use separate gates.** The UI does not explain the distinction.

### P2 — Blocks safe campaign execution

9. **Campaign staging is a dead-end intent.** It creates `master_leads` but no governed campaign/sequence application.
10. **114/117 sequences lack workflow wiring; 18 look like tests.** Existing active vertical sequences lack explicit channel/consent metadata.
11. **Med Spa and Dental are combined in one campaign asset.** Their offers, economics, roles, and objections differ.
12. **Pre-send infrastructure was not proven by this audit.** SPF, DKIM, DMARC, sending-domain reputation, mailbox warm-up, bounce/complaint limits, and unsubscribe rendering require a separate production check before sends.

## 6. What is already usable

- Free homepage/JSON-LD/contact-page crawling and encrypted candidate persistence.
- Per-domain caching and negative-result caching.
- Contact backlog Serper path with a 24-hour cooldown.
- Suppression, DBPR, existing-customer, test/demo, and bounce exclusions.
- Bounded provider reservation/settlement, pricing artifacts, circuit breakers, and $50 aggregate cap.
- ZeroBounce validation with provider-valid-only projection.
- SFP cohort/run schema and no-send campaign staging intent.
- A safe sequence governance example: sequence 85 (email + manual task only).

## 7. Final audit conclusion

The fastest legitimate route to cold outreach is not another manual pilot definition and not global provider activation. It is one implementation that:

1. inventories and canonicalizes the full source universe;
2. resolves geography for the current canonical pool and future materializations;
3. applies a versioned five-vertical classifier with deterministic evidence first;
4. generates an exact ranked SFP cohort;
5. runs free discovery and contact Serper first;
6. applies paid providers only to unresolved, high-ROI cohort members;
7. validates and suppression-checks the selected address;
8. creates five governed email/manual-call sequence families;
9. stages but does not send until pre-send infrastructure and content are approved;
10. publishes a production certification report with exact counts, IDs, costs, and zero hidden global spillover.

