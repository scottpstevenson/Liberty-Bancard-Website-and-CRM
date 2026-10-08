# Enrichment system audit — October 7, 2026  
  
## Scope and limits  
  
Read-only investigation of all 35 supplied screenshots (IMG_1576–IMG_1610),  
current workspace code, production database queries, and published runtime logs.  
No enrichment jobs were launched, provider calls made, controls changed,  
outbound enabled, database records modified, or application code changed.  
  
Production was identified through deployment metadata, not the development  
database. The deployment reported a successful public autoscale build, with  
primary URL https://dev.libertybancard.com and additional production domains  
libertybancard.com and liberty-bancard-system.replit.app. Runtime logs identify  
release bcb67a883c4d647da2a835183a962cbc472bb9bc. Workspace source inspections  
are identified separately from production observations; a successful build is  
not evidence that its enrichment workflow works.  
  
Counts below are snapshots taken during an active production workload, between  
20:50 and 21:56 UTC. They are not a transactionally frozen population.  
Historical rows, current selected work, provider requests, unique businesses,  
validation receipts, and qualified recipients have different denominators.  
  
No authenticated browser session was created or used to operate the system.  
The supplied signed-in screenshots and existing production request logs were  
examined. The screenshot review error is confirmed as an observed symptom;  
its exact exception was not recovered. No production worker was replayed.  
  
## Executive conclusion  
  
The system contains multiple enrichment paths with different records,  
authorities, schedules, and downstream effects. Some older entry points now  
redirect into governed commands; others still have independent workers.  
  
It is inaccurate to say there are no connections at all: the queue manager  
explicitly connects contact coverage, reconciliation, vertical projection,  
automatic linking, registry projection, recipient preparation, and continuous  
discovery, and a separate validation tick recovers shared validation intents.  
It is equally inaccurate to call that an operating end-to-end workflow:  
production evidence shows failed claims, missing prerequisites, current  
selection with no matching validation work, and historical work not aligned  
with provider completion.  
  
The canonical overview is an observation/navigation surface. It does not  
repair these handoffs. A UI-only consolidation cannot establish completion.  
  
## Confirmed findings and bounded conclusions  
  
### 1. Geography incorrectly rejects the stored full state name  
  
`server/services/cro03a/geography.ts` uppercases state, then rejects every  
nonempty value other than `FL` before considering county, ZIP, or city.  
`sfp-geography-resolver.ts` calls this evaluator for location candidates;  
`canonical-recipient-preparation.ts` requires eligible current geography.  
  
A pure, read-only execution of the actual evaluator with identical Fort  
Lauderdale / 33301 / Broward FIPS inputs returned:  
  
| State input | Eligible | Reason |  
|---|---|---|  
| FL | true | COUNTY_FIPS_VERIFIED |  
| Florida | false | STATE_NOT_FLORIDA |  
  
Production has 811 business-location rows for 811 businesses storing  
`Florida`; none of those rows has a populated target county FIPS. The  
classification-item ledger contains 804 distinct businesses with an  
outside-territory route and STATE_NOT_FLORIDA; 795 also have a location storing  
`Florida`. These joins identify affected records, not 795 proven outreach-  
eligible businesses: other affiliation, vertical, suppression, and email  
requirements still apply.  
  
The preparation priority checkpoint reports 452 held transitions for  
CURRENT_GEOGRAPHY_UNRESOLVED_OR_EXCLUDED. This is cumulative transition  
accounting, not 452 unique businesses proven to share the state-format defect.  
  
### 2. Import recovery is scheduled but repeatedly fails before a committed claim  
  
Published logs repeatedly report:  
  
- `canonical_import_recovery_tick`  
- `outcome=row_processing_failed`  
- phase `import_cursor_claim`  
- attempted=0, fulfilled=0  
- no SQLSTATE or reason code in the exposed diagnostic  
  
Consecutive failures exceeded 370 during the investigation. This is not a  
missing scheduler and is not evidence that all enrichment workers are dead.  
Historical fulfillment audit entries exist; the latest observed fulfillment  
was October 7 at 16:47:58 UTC. Those past entries do not establish current  
recovery progress.  
  
A read-only version of the exact next-row selection SQL, with its locking  
clause removed, selected original Outscraper execution  
79356e0b-c0b0-4a2f-abe1-f5844b7c9335, source row 495. Its accounting disposition  
is failed / RECOVERY_PROVIDER_STAGING_FAILED, and its mapped observation  
fingerprint differs from the original accounting fingerprint.  
  
The identity verifier requires an immutable-observation native guard for this  
bridged-identity path. Production has zero matching  
`cro03_source_observation_immutable` triggers on `cro03_source_observations`,  
including zero satisfying the exact code-owned function/body fingerprint.  
An additional read-only replay loaded this row through the actual  
`loadProviderImportIdentity` query. The actual `verifyProviderImportIdentity`  
function was executed against the retained production evidence, with its  
database executor substituted with that one returned row and the independently  
verified absent native-guard result. Original evidence checks passed, followed  
by the exact exception `PROVIDER_IMPORT_IDENTITY_BRIDGE_NATIVE_GUARD_MISSING`.  
No worker, transaction, provider call, or write was executed in this replay.  
This establishes the exception for the selected row under the observed  
prerequisites, not that every historical import failure has the same cause.  
By 21:48 UTC, the published recovery queue logged 510 consecutive failures.  
  
Separately, the exact general system-link guard SELECT was evaluated read-only  
in production. All seven checks returned true. Thus the UI's general “Native  
contract verified” result does not certify this additional import identity-  
bridge contract.  
  
The original execution contains 1,472 input rows. Its old completed result  
reports 1,471 skipped and one error. Later recovery is a separate authority  
and accounting layer; neither the old completed label nor historic recovered  
contacts proves all original rows are fulfilled now.  
  
### 3. Shared validation is connected in code, but has no current selected intake  
  
`processSfpContinuousValidationTick()` now recovers shared CRM  
`validation_intents`. The old cohort validation implementation is retained  
but is not the scheduled exported function.  
  
Recovery requires a pending, due intent with matching contact/email hash,  
a current prepared-recipient row, matching business affiliation, an active  
program, and a nonarchived contact.  
  
Production observations:  
  
| Shared validation state | Rows | Matching current preparation |  
|---|---:|---:|  
| blocked / non_positive | 662 | 0 |  
| completed | 49 | 0 |  
| blocked / ambiguous_billing | 6 | 0 |  
| pending / enqueued | 3 | 0 |  
  
The 31 canonical prepared-recipient rows are all ready_held, pin retained  
validation operation IDs, and have zero matching shared validation intents.  
Their receipt reuse is expected, not a missing-enqueue defect. There are no  
current pending_validation preparation rows in this snapshot. The three  
pending intents have matching current email hashes/generations but no assigned  
business, verified business relationship, or preparation. The exact recovery  
predicate consequently cannot select them. This is missing qualified intake,  
not proof that ZeroBounce rejects requests or that its credential is invalid.  
  
ZeroBounce's production control is enabled/closed, with 800 completed/committed  
operations, six failed/ambiguous operations, and one running/reserved operation.  
The latest completed-operation start is October 3 at 13:42:21 UTC. Scheduled  
validation audit ticks continue through October 7. Therefore “enabled” and  
“worker ticking” do not establish address validation progress.  
  
There are also 97 historical ZeroBounce stage rows in claimed state and 686  
retry rows. These are not automatically admitted work under the new selected-  
recipient rule. Blanket enqueueing them would bypass the intended selection.  
  
### 4. Provider completion and stage state disagree in historical records  
  
The stage/provider-operation join found, among other combinations:  
  
- Serper: 5,516 claimed stage rows attached to completed provider operations.  
- Outscraper: 1,854 claimed stage rows attached to completed operations.  
- Apollo: 1,368 claimed stage rows attached to failed operations; seven attached  
  to running operations.  
- ZeroBounce: claimed and retry rows with missing, failed, completed, and  
  running operations.  
  
These are recorded-history discrepancies, not proof that every row is currently  
claimable or represents a still-running network request. Current program  
selection, lease expiry, receipt reuse, supersession, and immutable-history  
semantics must be checked before recovery or retirement. Counts of “claimed”  
must not be presented as live throughput or unique pending recipients.  
  
### 5. The throughput screenshot reflects an actual production query timeout  
  
The Enrichment Throughput tiles read `/api/lead-ops/health`. Their source query  
aggregates the entire legacy `sunbiz_entities` table, not the full current  
canonical/CRM/SFP pipeline. Its errors are caught and rendered as unavailable /  
query_failed.  
  
At 18:17:10.959 UTC, the production route's query failed after approximately  
30,023 ms with SQLSTATE 57014. Nearby production logs also show query timeouts  
on lead stats, Sunbiz status, and entity listing. The exact aggregate query  
later succeeded through the production read-only interface, returning:  
  
- one enriched/email/phone result in the previous 24 hours;  
- 967,148 pending legacy Sunbiz rows;  
- 293,777 enriched legacy Sunbiz rows;  
- 539 failed rows.  
  
This supports a production request-time failure, not missing columns or a  
proven permanently failing query. The underlying cause of the slow scan was  
not conclusively established. Pool starvation is not proven by these logs:  
several affected samples had idle connections and no pool waiters.  
  
### 6. Identity/domain coverage limits downstream progression  
  
Production has 963 current verified contact-business decisions versus a much  
larger contact pool and candidate history. Candidate counts are not verified  
relationships.  
  
The automatic-link program is enabled but its checkpoint shows 3,796 scanned,  
13 committed, and 3,783 held transitions. Its dominant hold is  
independent_business_identity_not_found (3,675); the others include state/name  
conflicts and insufficient independent corroboration. Requiring real identity  
evidence is intentional, but the ordinary intake must supply that evidence  
instead of making the owner perform routine manual linking.  
  
Canonical business free-enrichment inventory:  
  
| State | Businesses | With website domain |  
|---|---:|---:|  
| no free-enrichment status | 77,794 | 0 |  
| enriched | 8,817 | 8,817 |  
| failed | 1 | 1 |  
  
The free crawler lane's entry predicate needs a website domain. Thus the large  
no-domain population is not an admitted website-crawl backlog. Discovery of  
identity/location/domain and downstream crawling are separate handoffs.  
  
CRM Serper enrichment continues independently. Its history includes 28,553  
no_match, 9,757 success, 1,474 candidate_staged, 798 partial, and 46 processing  
rows. Repeated runs and candidate staging are not distinct contacts completed  
through validation or qualification. The latest batch checkpoint processed  
20 contacts, found zero emails and one phone.  
  
## Path inventory and handoff map  
  
“Registered” means reachable code exists; it does not prove production use.  
“Scheduled” means worker wiring/profile was observed; it does not prove  
successful work. Empty legacy tables do not prove their routes are dead.  
  
| Path | Entry / worker evidence | Records and downstream handoff | Production assessment |  
|---|---|---|---|  
| CRM single-contact enrichment | POST `/api/contacts/:id/enrich` | CRO03 batch command, not direct legacy enrichment | Registered; requires idempotency key |  
| CRM batch/backlog Serper enrichment | `/api/contacts/enrich-batch`, enrichment queue backlog tick | CRM mutations, evidence/candidates, readiness recalculation | Active; successes and repeated no_match; not automatic SFP qualification |  
| Legacy prospect/list enrichment | `/api/enrichment-jobs`, `/api/enrichment/process-queue` | Compatibility entry points into governed intake/commands | Registered; legacy enrichment_jobs empty |  
| Legacy Sunbiz scrape/enrich/promote | Sunbiz individual/batch/mass/deep routes; enrichment worker gated by feature controls | Sunbiz entities → legacy prospects/contact promotion, with bootstrap ownership exclusions | Legacy inventory large; runtime flag activation not inferred merely from configured secret names |  
| Sunbiz canonical bootstrap/backfill | Lead Ops bootstrap routes; sunbiz-full-backfill queue | Registry identity → canonical businesses/source links | Running; more than 105k processed; zero dead letters in checked checkpoint; not email validation |  
| Canonical source-registry projection | canonical-registry-projection worker inside continuous discovery orchestration | Original source work → canonical business/source bindings | Connected; screenshot zero applicable source items does not certify other import paths |  
| Canonical provider CSV/mailbox import recovery | canonical-import-recovery queue | Original row and identity bridge → business/contact affiliation → fulfillment receipt | Current pre-claim failures; additional native guard missing |  
| Canonical business free enrichment | `/api/lead-ops/businesses/:businessId/enrich-free`; free-enrichment-lane | Domain/website crawl → candidate evidence/winner selection | Working bounded lane; domain absence excludes most unprocessed canonical businesses |  
| Legacy SDR merchant free enrichment | enrichment/free-contact-enrichment jobs; RDAP, JSON-LD, contact-page adapters | sdr_merchants → sdr_merchant_contacts, not automatically the same CRM/canonical authority | Independently wired; must not combine its totals with canonical recipients |  
| SDR Serper/re-enrichment | `/api/sdr/serper-enrichment/run`, merchant endpoint, `/api/sdr/re-enrichment/run` | Merchant/business descriptive evidence and rescoring | Registered separate entry points; no external calls made to certify credentials |  
| LinkedIn contact enrichment | individual/bulk LinkedIn routes | Legacy enrichment functionality behind an explicit deny | Returns 503 pending approved durable provider operation; not a working fallback |  
| CRO03A evidence-only qualification/staging | `/api/cro03` routes and cro03a-qualification queue | Source evidence → deterministic staging decisions | Separate from paid providers, CRM writes, and contact validation |  
| CRO03B local recipes | governed recipe functions / registered CRO03 routes | Local recipe work and handoffs | Recipe-item table empty; not proof all calling routes are retired |  
| CRO03C live governed enrichment | cro03c-live queue; governed execute routes | Provider stage operations → evidence/validation/winner/staging intents | Runs table empty in checked production; newer provider-operation history exists separately |  
| SFP free/AI classification and cohort tooling | Lead Ops Phase A, classifier, cohort routes and free-classification queue | Geography/vertical evidence → program targeting/frozen provenance | Active program; geography defect and extensive review_required history; manual cohort UI is not routine automation |  
| SFP continuous paid discovery | sfp-continuous-discovery queue | Current eligible business facts → Serper / Outscraper / Apollo operations → candidate evidence | Active network-operation history; completion is not verified recipient output |  
| Business winner validation/stager | business-validation-service, master-lead-stager | Winner/validation intents → master lead staging | Business validation/staging intent tables empty in checked snapshot |  
| Shared address/CRM validation | zerobounce-batch-validate, provider-readiness-control, canonical-address-validation | Selected address → shared receipt → contact status / downstream evaluation | Connected; no current prepared match for pending intents; no recent completion |  
| SFP validation/eligibility | sfp-validation and SFP stage/eligibility tables | Receipt plus current affiliation/policy → eligibility decision | Historical results remain; contact-page SFP status is explicitly separate from CRM status |  
| Coverage, human review, and automatic business linking | contact-link-coverage routes; reconciliation/link workers inside continuous orchestration | Census/candidates → reviewed or independently evidenced verified decision | Census paused in screenshots; automation enabled with mostly holds; human review screenshot shows 500 |  
| Canonical recipient preparation | canonical-recipient-preparation worker | Current program/vertical/sequence + independent affiliation + geography + valid address → preparation | Full cursor has no preparation progress; priority cursor has 62 cumulative prepared transitions and many geography holds |  
| SFP campaign/master staging and paused enrollment | sfp-campaign-staging, ready-held consumer, CR04 preparation | Eligible recipient → held staging → paused enrollment | 72 historical SFP staging rows across 28 businesses; 31 canonical ready-held intents; not send permission |  
| GHL sync / confirmation / outbound | contact screens and separate provider/sender authorities | Sync/confirmation/status and transport | Independent of enrichment eligibility; sync pending/unvalidated is not proof of lost source data; outbound remains paused |  
  
The published selective queue profile lists 13 queues, including enrichment,  
post-enrichment, cro03a-qualification, free-enrichment-lane, cro03c-live,  
master-lead-stager, zerobounce-batch-validate, sunbiz-full-backfill,  
sfp-free-classification, sfp-campaign-staging, sfp-continuous-discovery,  
sfp-continuous-validation, and canonical-import-recovery.  
  
Production controls showed Serper, ZeroBounce, Outscraper, Apollo and OpenAI  
enabled with closed circuits. This is internal authorization/health evidence,  
not independent proof that every external credential or API is operational.  
No credential values were read or displayed, and no provider requests were  
issued for the audit.  
  
## All screenshot observations mapped  
  
| Screenshot | Observed surface/symptom | Audit interpretation / path |  
|---|---|---|  
| IMG_1576 | Briefing partly unavailable; outbound globally paused | Independent briefing/transport status; pause preserved |  
| IMG_1577 | Contact summary, lifecycle, decision-maker and suppression controls | CRM record view; these badges do not prove enrichment or affiliation |  
| IMG_1578 | Source-registry canonical projection has zero fulfilled/pending/held items | Registry projection scope only; does not establish CSV recovery completeness |  
| IMG_1579 | Enrichment Control Center: Serper and ZeroBounce enabled | Provider readiness indicators, not completed output |  
| IMG_1580 | 154,525 CRM emails; 963 verified links; 31 frozen-cohort CRM emails | Different inventory and cohort denominators |  
| IMG_1581 | Provider operations/evidence; zero 24-hour validation and ready-held creation | Network/evidence activity without shown downstream movement |  
| IMG_1582 | Vertical breakdown and repeated provider activity | Cohort-specific reporting; does not cover whole CRM pool |  
| IMG_1583 | Routine candidate gate open; 9,528 staged, only 296 scoped | Candidate eligibility/promotion is separate; gate open is not proof of progress |  
| IMG_1584 | Contact sync pending; confirmation not sent; CRM unvalidated; no SFP decision | Three independent handoffs/status models |  
| IMG_1585 | Imported business contact with email/phone/website but unvalidated | Intake field presence does not establish affiliation, selected validation or qualification |  
| IMG_1586 | Preparation observed; population cursor scanned 47,777 with zero prepared; no pending validation | Scanning is happening, but this population is not advancing |  
| IMG_1587 | Priority pass 370 scanned, 62 prepared, 308 held | Cumulative transitions, not unique current enrollments or full-population convergence |  
| IMG_1588 | Contact/business inventory and 103 preparation history records | Historical and inventory counters; not qualified recipient totals |  
| IMG_1589 | 72 historical SFP staging and 31 ready-held records | Separate staging/preparation authorities and history |  
| IMG_1590 | Provider history and Native contract verified | History plus limited schema check; missing identity-bridge guard is outside the general verified check |  
| IMG_1591 | Known evidence limitations | Correctly warns counts are not dispatch eligibility |  
| IMG_1592 | More evidence limitations and snapshot time | Confirms historical/cumulative scope |  
| IMG_1593 | Contact coverage paused at 50,500/154,418; 32,768 need discovery; 17,684 review | Census and review classification are not committed relationships |  
| IMG_1594 | Coverage reason counts, name/domain/filing conflicts | Overlapping reasons; not additive contact counts |  
| IMG_1595 | Missing canonical/Sunbiz identity and manual resume instructions | Upstream identity coverage gap; manual controls do not satisfy routine automatic progression |  
| IMG_1596 | Automatic-link pass 3,055 scanned, only 13 committed | Real automatic wiring exists, but overwhelmingly held |  
| IMG_1597 | Link hold reasons and pause button | Program authority is distinct from read-only census |  
| IMG_1598 | Human-review candidate page returns HTTP 500 | Confirmed visible failure; exact exception unresolved; related production queries slow/intermittent |  
| IMG_1599 | Master-lead staging overview: 32 staged, none ready | Production master_leads count independently confirms 32, all linked; not the 9,529 routine-candidate pool |  
| IMG_1600 | Evidence-only South Florida qualification inventory | Local qualification path, not paid enrichment/CRM validation |  
| IMG_1601 | Phase A/free-only backlog completed; manual run/freeze controls | Classification/backlog completion does not mean recipient completion |  
| IMG_1602 | Frozen cohort runs and failed entries | Historical/manual cohort workflow remains exposed alongside continuous workflow |  
| IMG_1603 | Provider enabled; 24-hour movement zero for validation/ready-held | Current control health and actual output diverge |  
| IMG_1604 | Validation history: valid/review-required, invalid and reused results | Provider result, policy status and charge/reuse are distinct |  
| IMG_1605 | Latest visible validation history ends October 3 | Production ZeroBounce completion history confirms no newer completion in checked snapshot |  
| IMG_1606 | Repeated invalid results for same business | Attempt history must not be mistaken for distinct businesses or productive recipients |  
| IMG_1607 | AI unavailable/provisional and insufficient-data classifications | Classification exceptions; provider enabled does not make every classification resolvable |  
| IMG_1608 | More review-required classification results | Genuine exceptions and weak evidence; not blanket permission to autoapprove |  
| IMG_1609 | Legacy master pipeline zeros; free/paid queue zeros; throughput query_failed | Mixed authorities; legacy Sunbiz aggregate timeout explains unavailable throughput |  
| IMG_1610 | Routine candidate gate open; 9,529 staged; one admitted | Large candidate pool is separate from actual current selected validation/preparation |  
  
## Additional causal findings from the expanded investigation  
  
### 7. Apollo is actively receiving authorization failures, not simply idle  
  
`provider_attempts` records 808 `APOLLO_HTTP_401` attempts, including October 7  
at 21:47 UTC. They are labeled `retryable_failed` with `retryable=true`. This  
is distinct from the 2,165 older completed/no-result Apollo operations.  
  
`server/services/sdr/apollo.ts` supplies the configured API key in the request  
header and throws `APOLLO_HTTP_<status>` on a rejected response.  
`sfp-provider-operations.ts` marks unsuccessful settlement retryable without  
distinguishing configuration/authentication failures from transient failures.  
Enabled/closed controls therefore coexist with repeated authorization denial.  
  
The proved external symptom is HTTP 401. Whether the key is invalid/revoked,  
the account lacks endpoint entitlement, or the deployment uses the wrong  
credential cannot be determined from this status alone. No secret was inspected  
and no external request was issued. Rotating keys without checking endpoint  
entitlement is not an established fix.  
  
### 8. The OpenAI selector is empty, and the completed results mostly lack input evidence  
  
The exact policy-2/taxonomy-2/classifier-3 pending-escalation predicate has  
12,270 distinct businesses with qualifying provisional history and **zero  
currently selected businesses**. Every one is excluded by a completed row.  
Its `NOT EXISTS` is scoped to business and policy/ruleset/taxonomy, not to a  
current evidence fingerprint. A changed business/domain/website can therefore  
remain excluded by an older completed insufficient-data result.  
  
Current completed AI evidence:  
  
| Outcome | Businesses | No current domain | No industry fields | No structured vertical | Retained website source |  
|---|---:|---:|---:|---:|---:|  
| review_required | 8,559 | 8,558 | 8,559 | 8,559 | 1 |  
| target | 2,338 | 2,337 | 2,338 | 2,338 | 1 |  
| non_target | 1,373 | 1,373 | 1,373 | 1,373 | 0 |  
  
The provider adapter successfully completed 12,295 operations historically.  
The actual bridge prompt includes name, raw vertical, industry fields, domain,  
website service/category/JSON-LD signals and locality. In almost this entire  
population the structured and website evidence is absent. Insufficient-data  
results are not evidence that the model or credential never worked.  
  
All 2,338 AI target rows have `admission_tier=NULL`; 765 also lack  
`resolved_vertical_id`. Current effective-vertical authority requires a target  
row with `admission_tier='resolved_high'`. AI target is therefore not recipient  
qualification. This separation is deliberate: repair missing corroborating  
evidence and decision handoffs, not relabel AI guesses as deterministic proof.  
  
The bridge cache correctly excludes malformed historical AI target rows that  
lack a resolved ID. The outer pending selector does not mirror that exclusion,  
so those historical rows can still prevent reaching the corrected cache logic.  
  
### 9. OpenAI failure handling loses the distinction needed to repair individual failures  
  
The actual transport returns `invalid_output` with model, request reference  
and known usage when parsing/schema validation fails. The classification bridge  
settles this as `observation='transport'`, returns null, and suppresses settlement  
exceptions. Its broad catch also returns null for most other exceptions.  
The caller then appends `OPENAI_UNAVAILABLE`.  
  
There are 550 historical retryable-failed OpenAI attempts labeled `transport`,  
314 failed/committed operations, 211 failed/ambiguous operations, and 38  
running/reserved operations. Their precise provider/parser/settlement exceptions  
cannot be reconstructed from this collapsed label. The audit does not invent  
a single credential, token-parameter, or model failure to explain all of them.  
  
Reservation idempotency actually appends the owning run ID. A prompt hash is  
not a permanent cross-run failed-operation lock. The earlier hypothesis that  
the prompt-only key permanently blocks all new runs is disproved by the actual  
reservation implementation.  
  
### 10. Free candidate admission remains cohort-dependent beside a recipient-scoped consumer  
  
There are 9,531 staged email candidates across 2,287 business IDs and 151  
contact IDs. Business and person counts overlap; they are not 9,531 distinct  
deliverable recipients.  
  
The exact old routine admission scope admits consideration of just 298 staged  
candidates through current frozen cohort membership. The routine producer in  
`free-discovery/evidence-service.ts` joins `sfp_cohort_members` and  
`sfp_cohort_runs`; the new scheduled shared validation consumer instead  
requires current canonical preparation. One admitted disposition is recorded;  
none of these candidate rows has a populated promotion timestamp.  
  
An admission disposition alone does not create a verified business/contact  
relationship, preparation, validation intent, or paid-provider receipt.  
Changing every staged row to admitted would not repair the new consumer.  
The fix must connect qualified candidate selection/materialization to the  
existing preparation/intent producer rather than revive blanket cohort spend.  
  
### 11. CRM email inventory is mostly disconnected from current business affiliation  
  
Current nonarchived production contacts with email:  
  
| Email status | Contacts | Business assigned |  
|---|---:|---:|  
| active | 153,234 | 18 |  
| unvalidated | 1,624 | 914 |  
| valid | 80 | 31 |  
| opted_out | 1 | 0 |  
  
`active` is legacy-unvalidated, not current validation proof. For the 963  
current verified contact-business decisions, an execution of the actual  
effective-vertical and sequence-binding expressions found 676 distinct  
businesses, 535 contacts with a resolved effective vertical, and just 24  
contacts with a current program/vertical/sequence binding. All 24 already have  
a preparation record. A resolved vertical outside the five current program  
verticals is not a missing sequence package.  
  
All five program verticals have current package versions and paused sequences.  
There is no evidence that missing packages explain the entire CRM population.  
The high email count, low business affiliation, geography/classification holds,  
and current binding population must be tracked separately.  
  
### 12. Current coverage itself times out; the candidate-list query lacks a paging index  
  
At 21:48:59 UTC a query in the published continuous-discovery job failed after  
30,070 ms with SQLSTATE `57014`, while the pool had three idle connections and  
zero waiters. Its fingerprint `5ed15d1305212bee` exactly matches the actual  
exported `CONTACT_LINK_COVERAGE_BATCH_SQL`. This establishes the failing coverage  
batch, rather than merely associating an unrelated slow query with the worker.  
  
The latest checkpoint was ready/server-processing at cursor 54,593, watermark  
159,476 and processed 54,500. The screenshot's earlier paused state is not  
the current state of this run.  
  
Separately, `EXPLAIN` for the exact first-page candidate listing shows parallel  
sequential scans of candidates and successors, an anti-join, global sort and  
Gather Merge before LIMIT 100. Existing candidate indexes do not cover  
`(source_version,created_at,id)`; the unique supersession index does exist.  
This proves a costly listing access path, not the exact exception behind the  
supplied human-review 500. Its rehydration step and failed request correlation  
still need separate verification.  
  
### 13. Expired provider operations require outcome reconciliation, not blind retries  
  
Older-than-24-hour running operations: Apollo 7, OpenAI 38, Outscraper 10,  
Serper 22 and ZeroBounce 1. Every operation lease is expired. All but two  
Serper operations have a durable dispatch marker.  
  
`releaseExpiredPreDispatchSfpReservations` only releases provably pre-dispatch  
work; it intentionally cannot declare dispatched requests unspent. A terminal  
timeout, provider task retrieval, known completion receipt and ambiguous  
dispatch need different recovery. Releasing all reserved units or rerunning  
every expired operation would risk duplicate calls and false billing.  
  
### 14. A successful queue tick can conceal failed local handoffs  
  
The continuous-discovery queue handler independently catches errors from  
coverage, reconciliation, vertical projection, automatic links, registry  
projection and preparation, then continues provider discovery. This protects  
independent work, but a completed overall queue job does not prove those local  
handoffs succeeded. Import diagnostics also lose the domain exception when it  
does not match the current canonical error pattern.  
  
Legacy SDR currently has 34 pending merchants, no website/domain on those rows,  
and no email-bearing merchant-contact rows. Post-enrichment enrollment intents  
and business-validation/master-staging intent tables are empty in the checked  
snapshot. Registered compatibility routes and empty tables must not be displayed  
as active, successful canonical progression.  
  
## Required fixes, recovery and acceptance — not applied  
  
These are concrete corrective requirements for the existing system, not new  
replacement tasks, an instruction to enable outbound, or proof of implementation.  
Production fixes must execute the published build, preserve authority and  
immutable evidence, and then demonstrate scheduled effects without owner-operated  
routine jobs.  
  
| Area / exact owner | Required correction | Existing-data recovery | Required proof |  
|---|---|---|---|  
| Geography — `cro03a/geography.ts`, `sfp-geography-resolver.ts` | Normalize trimmed state aliases `FL`/`Florida` to FL before territory comparison. Retain county/ZIP/city conflict and operating-site checks; never interpret an addressless record as eligible. | Append updated geography/classification decisions for affected original locations; refresh current qualification/preparation through the existing scheduler. | FL and Florida yield identical decisions for identical valid evidence; non-FL, conflicting county and registered-agent-only examples remain held. |  
| Import native contract — `provider-import-identity.ts`, code-owned source-observation immutable migration | Restore the exact required mutation-rejection function/trigger in the development schema and verify the supported Publish reconciliation includes it. Check schema, enabled trigger, function identity and body hash after publishing; if custom objects are not carried through, record a production installation blocker requiring a platform-supported procedure. Do not bypass the assertion, blindly replay the migration journal or add production DDL hooks. | Resume the retained original-row cursor only after guard verification; preserve raw evidence, accounting identity, mapped-observation bridge and fulfillment receipts. | Selected row passes the same verifier; ordinary upload and restart recovery separately fulfill or truthfully hold every original row without duplicates. |  
| Import diagnostics — canonical recovery worker / canonical transaction diagnostics | Preserve safe domain codes such as `PROVIDER_IMPORT_IDENTITY_BRIDGE_NATIVE_GUARD_MISSING`, nested SQLSTATE and transaction phase. Preserve causes without logging raw rows or credentials. | Retain failure history and refresh current failure state; do not clear failure counters as a substitute for progress. | An injected missing guard produces its exact actionable reason, not `unknown`; a repaired scheduled tick produces new committed fulfillment. |  
| Canonical intake — source staging, registry projection, import materialization | Make each accepted ordinary source observation reach business resolution, independently supported affiliation and fulfillment accounting. A disabled legacy staging recipe must not be treated as successful canonical import. | Classify the 13,431 `STAGING_RECIPE_DISABLED` items and original rows by current applicability; recover applicable original evidence under the existing authority, explicitly retain nonapplicable/ambiguous holds. | Source-to-business/contact/source-link/fulfillment linkage is demonstrable for every intake family and each held row has a durable reason. |  
| Identity handoff — coverage/reconciliation/link automation and ordinary intake producers | Carry retained source business identity, domain, locality and affiliation evidence into the canonical resolver. Reuse sufficient verified provenance; do not infer employer identity from a personal mailbox or require every business to have Sunbiz/corporate-domain evidence. | Resume held records only when supporting source evidence is available; keep name/state conflicts and contradictory provenance held. | Representative ordinary imports link automatically, unsupported personal email and contradictory identity remain held, and no routine manual linking is required. |  
| Coverage batch — `contact-link-coverage-query.ts` / coverage checkpoint worker | Optimize the exact fingerprint-matched batch. Keep base-row limiting ahead of evidence expansion; eliminate broad or repeated source/registry scans, match indexed normalization expressions, and use a bounded page/transaction budget. Persist progress before retryable expensive work. Increasing statement timeout alone is not the fix. | Continue the existing frozen denominator/cursor without erasing census progress; retry the failed page, not the entire completed population. | Exact pathological page finishes within the agreed latency budget, checkpoints advance monotonically, restart repeats no committed page, and unrelated local handoffs continue. |  
| Human-review listing — `contact-link-coverage.ts` | Add a publish-safe `(source_version,created_at,id)` paging index, preserve the supersession index, and keep rehydration limited to selected contact IDs. Return a typed retryable failure rather than an unexplained 500 if bounded rehydration fails. | No candidate-history deletion or fabricated verification. Retain reviewed/superseded candidates. | EXPLAIN uses bounded indexed pagination; authenticated first/next pages render and superseded candidates are absent. Capture the actual previously failing request before assigning its exception to this fix. |  
| Domain/website evidence — free-enrichment selectors, Serper discovery and classification bridge | Connect current eligible no-domain businesses to governed domain discovery, persist sourced identity evidence, and pass retrieved website evidence to classification before paid AI escalation. Keep domainless work distinct from crawler-admitted work. | Feed applicable unresolved businesses through bounded discovery; do not crawl or spend across the entire no-domain inventory indiscriminately. | A previously domainless qualified business gains sourced domain/site evidence and advances automatically; no-result/domain conflicts get cooldown/holds, not repeated immediate spend. |  
| OpenAI pending selector — `sfp-free-classification-continuation.ts` | Replace business-wide completed exclusion with current-input/ruleset/taxonomy/policy fingerprint comparison. Mirror the bridge's malformed-target and nonattempt exclusions. Completed insufficient-data results are reusable only for unchanged input; changed corroborating evidence can enter again. | Append evidence revisions for changed inputs and the 765 malformed historical targets; never mutate/delete immutable classifications. Do not blindly retry all 8,559 unchanged review results. | Unchanged uncertain input does not re-spend; changed website/industry evidence re-enters once; malformed target reaches the corrected validator; deterministic current target/non-target remains reusable. |  
| OpenAI evidence usefulness — classification bridge and website extractor | Do not equate name-only AI completion with enrichment completion. First gather applicable structured/website evidence, persist why context could not be acquired, and use paid escalation only where it has meaningful unresolved evidence. | Preserve all historical usage and results; re-evaluate only changed or invalid applicable inputs. | Representative businesses produce independently supported, current vertical decisions, not merely additional completed/review-required rows. |  
| AI versus admission authority — `sfp-classification-bridge.ts`, `shared/effective-vertical.ts` | Keep AI output and deterministic/corroborated admission separate. Wire usable AI suggestions into evidence acquisition and a policy-owned qualified decision, rather than leaving them as permanent orphan “targets.” Do not set `resolved_high` merely because a model says target. | Append current justified qualification decisions once corroboration exists; retain conflicting/unresolved latest-state precedence. | An AI-suggested target with sufficient sourced corroboration can become qualified automatically; name-only/contradictory suggestions do not gain send or spend permission. |  
| OpenAI failure accounting — bridge, live executor, provider settlement | Carry typed configuration/auth/rate-limit/timeout/refusal/truncation/invalid-JSON/schema/settlement results, HTTP status and safe provider reference. Keep known response usage even for invalid output; never silently swallow failed settlement. | Reconcile historical ambiguous dispatch by request/provider evidence before re-execution. Historical flattened exceptions cannot be recovered by guessing. | Fake responses for each failure remain distinguishable with correct attempt/billing state and usage; settlement failure remains visible and recoverable. |  
| Apollo auth failures — `sdr/apollo.ts`, provider operation/control policy | Classify HTTP 401 as authentication/configuration unavailability, not endlessly transient retryable work. Suspend that lane until credential/entitlement revision or a bounded approved health check succeeds. Independently verify the exact deployed endpoint/account entitlement before requesting replacement credentials. | Retain the 808 failures and request lineage; do not replay them en masse or turn all ambiguous balances into zero without evidence. | Invalid authorization stops repeated Apollo attempts, the panel says authentication unavailable, and Outscraper/Serper/first-party fallback still progress. |  
| Free candidates — `free-discovery/evidence-service.ts`, preparation producer / candidate materialization | Connect current business/program/sequence-qualified candidate selection to independent contact affiliation, preparation and the shared intent producer. Keep frozen cohorts as provenance/pilot scope, not a mandatory owner-created routine prerequisite. `validation_admitted` alone is not dispatch authority. | Reconsider applicable retained candidates under current qualification, primary plus at most two alternatives per business; deduplicate normalized addresses and reuse existing receipts. | Ordinary discovery produces linked selected recipients and pending_validation/ready_held automatically; unsupported, suppressed or out-of-program candidates cause zero provider spend. |  
| Shared ZeroBounce intake — preparation worker and `provider-readiness-control.ts` | Repair upstream selected-recipient supply, not `recoverValidationIntents` by removing its scope predicate. Reconcile stale unselected queue labels with an explicit current prerequisite hold; preserve email-generation/hash pins. | Three currently unbound pending contacts await proven affiliation and qualification. The 31 prepared valid contacts reuse their retained receipts without a new call. | A newly selected qualified address creates/recoverably enqueues one intent; restart recovers it; existing fresh valid/invalid receipt causes zero extra dispatch. |  
| Historical ZeroBounce retries — intent worker and receipt policy | Distinguish invalid/non-deliverable from unknown/risky/transient provider failure. Retry only a current selected address after cooldown and bounded policy; ambiguous billing requires reconciliation, not automatic resubmission. | Of 662 old non-positive holds, 586 have unknown/retryable observations and 76 risky/retryable observations. Reconsider only if current selection and evidence warrant it; six ambiguous timeouts remain separately accounted. | Unknown is not silently marked invalid, retry exhaustion is explicit, changed address generations cannot inherit old validation, and ambiguous dispatch is not duplicated. |  
| Invalid-slot replenishment — candidate selection, capacity and preparation worker | Retire a rejected/expired/suppressed occupied address and select the next independent eligible candidate automatically; maintain one primary plus two alternatives and address-level dedupe/capacity fencing. | Reuse existing candidate evidence and truthful negative receipts; release only the rejected slot, not every business commitment. | Primary invalid → next candidate admitted; valid fresh primary → no redundant validation; simultaneous ticks cannot exceed capacity; suppression retires a ready-held recipient. |  
| Expired operations — `sfp-provider-operations.ts` / retained-task reconciliation | Recover pre-dispatch expiration separately from dispatched task/request uncertainty. Retrieve retained Outscraper task outcomes where permitted; preserve request references and reconcile committed results, unknown usage and authority drift independently. | Older running operations across all five providers need per-dispatch reconciliation; do not bulk-release reservations or erase terminal history. | Crash before dispatch releases once; crash after dispatch resumes receipt/task recovery without duplicate paid request; stale authority cannot promote but may retain a truthful provider receipt. |  
| Historical stage projection — SFP stage/eligibility/staging readers and reconciler | Reconcile read models with authoritative operation/attempt/receipt state and current applicability. Separate historical claimed rows, current runnable work, archived cohort work and shared recipient work. | Completed Serper/Outscraper operations with claimed stage rows and failed Apollo rows are reconciled without reissuing a known completed request or rewriting immutable receipts. | Counts distinguish unique current recipients from attempts and history, and no completed request appears as active network work solely because of its old stage state. |  
| CRM/SFP status parity — contact status readers, effective vertical projection, qualification/preparation APIs | Show current business affiliation, provenance, raw versus effective vertical, validation receipt/hash/generation/expiry, current selected status, and held enrollment separately. Legacy `active`, discovered email and GHL sync are not validation proof. | Rebuild compatibility projections from retained canonical facts, not from a generic success label. Preserve suppression and current-classification precedence. | The same contact's CRM, business/SFP and preparation panels agree on actual facts and display distinct reasons for unlinked, unqualified, pending validation, reused receipt and held enrollment. |  
| Throughput/health — `/api/lead-ops/health`, lead stats/Sunbiz readers | Replace repeated request-time full-population aggregates with indexed incremental/time-window reads or freshness-tagged snapshots. Show legacy Sunbiz throughput separately from canonical/source/recipient throughput; failures must not become zero or “all healthy.” | Establish a truthful current baseline and source-attributed counters; do not count imports, candidates and paid calls as qualified recipients. | Measured route latency stays below the request budget during ordinary worker load, stale/unavailable data is visible, and published counts match authoritative ledger populations. |  
| Queue liveness — continuous orchestration and status APIs | Keep independent local try/catch isolation, but persist per-handoff outcome, exact reason, last committed progress and retry status. A successful discovery tick with failed coverage/preparation is degraded, not successful end-to-end enrichment. | Surface current stuck checkpoints and retained failures; readiness is not reset by a heartbeat. | Injected coverage/preparation failure leaves independent discovery running while the UI and tick summary report the failed handoff and lack of progress. |  
| Legacy/compatibility paths — CRM, prospects, Sunbiz, SDR, LinkedIn, CRO03A/B/C route families | Preserve canonical redirects/deny boundaries; for each still-active legacy producer use the same evidence/selection/receipt contracts or explicitly mark it as legacy-local only. Do not revive LinkedIn's denied transport or pilots by removing approval fences. | Determine actual applicable source records before moving or retiring historical work. Empty intent/job tables are not permission to merge unrelated populations. | Role-specific routes cannot bypass selection, DBPR/suppression, paid dispatch or outbound authority; legacy success cannot be represented as a prepared canonical recipient. |  
| Master lead / paused enrollment / GHL — stagers, CR04 and synchronization readers | Reconcile current qualification, contact affiliation, channel receipt and enrollment snapshots automatically. Keep GHL synchronization and outbound authorization independent of enrichment readiness. | Retain 72 historical ready-held stage rows separately from 31 canonical preparations; retire stale commitments and reuse valid current ones without activating outbound. | Qualified selected recipient reaches a truthful paused membership automatically; loss of qualification retires it; GHL changes do not bypass identity/validation; outbound remains paused throughout. |  
  
### Production recovery order  
  
1. Preserve current outbound and suppression holds. Record the published build  
   and current cursors/receipt identities, not development database counts.  
2. Restore and verify native-contract definitions in development, then use the  
   supported Publish schema reconciliation for managed production. Inspect its  
   proposed changes and verify the exact function/body/trigger identities after  
   deployment; ordinary table synchronization must not be assumed to install  
   custom objects. If these objects are not represented, treat installation as  
   a platform-supported deployment blocker, not permission for custom production  
   migration scripts, deploy hooks, startup DDL or direct production DDL.  
3. Publish native-guard diagnostics, Florida normalization, bounded coverage/  
   metrics reads, typed provider failure outcomes and Apollo auth handling before  
   replay or new spend.  
4. Resume original local intake/census/identity progression from retained cursors.  
   Recompute only affected current geography/evidence/qualification; preserve  
   existing fulfilled rows, independently valid links and suppression decisions.  
5. Supply missing current domain/website evidence and connect retained candidate  
   materialization to canonical preparation. Append classification revisions only  
   for changed/invalid applicable evidence.  
6. Reconcile expired dispatched provider operations and ambiguous billing before  
   issuing replacements. ZeroBounce reuses fresh address receipts first; only  
   current selected missing/expired receipts enter new bounded validation.  
7. Verify automatic primary/alternative selection, invalid replacement and held  
   enrollment against representative imported, discovered, CRM and registry  
   sources. No routine manual jobs, linking or approval clicks count as acceptance.  
8. Measure multiple scheduled ticks and restart recovery in the published build.  
   UI/status parity, original-row fulfillment and actual recipient progression  
   are required in addition to successful provider transport.  
  
### Cross-path acceptance checklist  
  
- Ordinary new upload, original pending-row recovery and already-fulfilled replay  
  are separate cases. Every original row ends in a durable truthful disposition.  
- Test mailbox/business role, named person, personal mailbox with supported  
  affiliation, multi-mailbox business and conflicting/ambiguous identity.  
- Test current/old policy, changed input evidence, malformed AI target,  
  name-only uncertain input, retained website evidence and unsupported vertical.  
- Test missing domain, no-result discovery cooldown, successful website evidence,  
  free/paid candidate dedupe and paused/unavailable individual providers.  
- Test fresh valid and invalid receipts, expiration, shared address across  
  businesses, changed email generation, suppression and retryable/ambiguous  
  provider failure.  
- Test one primary/two alternatives, rejected-slot replacement, late-ID fairness,  
  stale qualification retirement, concurrent workers, crash and published owner  
  fencing. Useful-recipient priority is not full-population completion.  
- Test admin/manager/non-admin legacy routes and current UI entry points. No  
  denied old route may regain provider dispatch or outbound permissions.  
- Check every supplied screenshot's current corresponding UI/API state, not  
  only the canonical overview. Signed-in page interaction must be verified  
  separately from database/route inspection.  
  
## Remaining uncertainties — not disguised as completed proof  
  
1. Other possible import-row failures after the proved selected-row native-guard  
   failure is corrected. The actual selected row's original evidence checks  
   and exact verifier exception have now been reproduced read-only. Scheduled  
   worker progress after deployment has not been executed or certified.  
2. Exact cause/correlation of the screenshot human-review HTTP 500.  
   Production shows slow candidate list/hydration queries and some successful  
   requests, so it is not justified to call this permanently broken or to assign  
   every related request to one specific exception.  
3. Row-level justification for every historical claimed/retry stage versus  
   current selection and retained receipt reuse. The joined disagreements are  
   real, but their entire history has not been reclassified.  
4. Exhaustive row-level readiness/exclusion decisions for the full historical CRM  
   pool. Missing affiliation, domain/website evidence, unresolved or out-of-program  
   verticals, the Florida rejection and the current selection boundary are now  
   independently established. They do not justify assigning a single reason to  
   every contact, admitting all emails or certifying every hold as correct.  
5. Independent external credential/billing reconciliation. Internal controls  
   and receipts were audited; external provider actions were intentionally not  
   performed.  
6. Full scheduled acceptance after correction, including ordinary uploads,  
   restart recovery, useful-recipient fairness, invalid-slot replenishment,  
   receipt freshness/reuse, truthful CRM/SFP display and outbound-paused  
   enrollment. This is implementation verification, not accomplished by this  
   read-only audit.  
  
These items remain within the original audit/consolidation scope. They are not  
new optional follow-up tasks. This report is a diagnosis and corrective plan;  
it does not claim that all root causes are resolved or that fixes were applied.  
  
### Disproved explanations  
  
- The geography-followup query does not fail because `business_locations.updated_at`  
  is missing: current production has the column and the exact query succeeded.  
- The OpenAI operation key is not prompt-only across every run: reservation  
  appends the owning run ID.  
- A taxonomy-2 run header versus classifier-3 evidence is not itself proof of  
  failed selection; taxonomy and ruleset versions are distinct.  
- Five current vertical packages and paused sequences exist. Missing packages  
  do not explain the entire unbound CRM inventory.  
- Internal consumed units exceeding an old local ceiling is not, by itself,  
  a current blocking gate; the actual reservation/control predicates govern.  
- A query timeout with idle pool connections is not evidence of pool exhaustion.  
- Ready-held receipt reuse is not a failed validation enqueue, and a completed  
  AI review result is not evidence of a broken OpenAI credential.  
  
## Constraints for any corrective work  
  
- Preserve original observations, row accounting, identity and suppression  
  authority; do not loosen evidence requirements merely to increase counts.  
- Do not blanket-enqueue the CRM or historical validation backlog.  
- Selection must prioritize one primary and at most two alternatives per  
  business, reuse qualifying fresh receipts, and replenish invalid slots.  
- Apollo unavailability must not block independent fallback paths.  
- Keep outbound paused. Ready-held/prepared/validated never means send permission.  
- Routine progression must not require the owner to operate separate programs,  
  run jobs, approve ordinary rows or manually link ordinary intake.  
- Correct both worker handoffs and truthful UI status. A new screen is not a  
  substitute for a functioning source-to-recipient path.  
- Do not present disposable/local certification or a successful publish as  
  production end-to-end acceptance.  
