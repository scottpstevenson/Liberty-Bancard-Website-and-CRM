# MASTER TASK — CR-01 THROUGH CR-06 REVENUE CRM AND COLD-OUTREACH READINESS

## Mode

**PREFLIGHT → BUILD → ISOLATED VERIFY → DOCUMENT**

This task converts the current fragmented lead/enrichment/outreach implementation into one trustworthy revenue CRM. It is not authorization to send outreach, consume production provider credits, mass-enrich production, clear holds, unpause outbound, delete production data, or run a production backfill.

Complete every tranche:

1. **CR-01 — Canonical lead/contact/business/deal authority**
2. **CR-02 — Production/test classification and provenance projections**
3. **CR-03 — Enrichment factory and channel-qualified readiness**
4. **CR-04 — CRM operator journey and reconciled reporting**
5. **CR-05 — Premium campaigns, sequences, sender/provider readiness**
6. **CR-06 — Controlled email-pilot preparation and evidence**

Do not stop after the first defect. Continue through all source, schema, API, UI, test, and documentation deliverables. If a production mutation, paid provider call, send, deployment, or destructive cleanup is required, stop that operation only, preserve the remaining progress, and report the exact approval required.

## Repository baseline

Repository: `scottpstevenson/Liberty-Bancard-Website-and-CRM`

At the authenticated audit:

- Reviewed source baseline: `78ae07e8c5ffb643467a93dc42b95834d65289a8`
- Production deployment: `f2cfa4aade9b24435128c9bd5787ad01f5281563`
- PR #6 correction head: `a16fdc2a46e9402faf30dc95fc907a33051c651d`, open/unmerged when last observed

Before implementation:

1. Fetch current `origin/main` and record its exact SHA.
2. Inspect PR #6 state; do not assume it is merged.
3. Start from the latest clean main after approved merges.
4. Preserve unrelated/untracked uploads.
5. Use a dedicated branch and PR.
6. Require a clean task-owned diff.
7. Do not deploy automatically.

## Absolute safety contract

- Keep global outbound paused.
- Keep SMS disabled.
- Never send email/SMS to a real contact.
- Never invoke real GHL mutations, provider probes, enrichment calls, or paid APIs for test evidence.
- Never mass-enrich, reclassify, merge, backfill, or delete production data.
- Never run `scripts/run-pre-deploy.sh` for this task.
- Never substitute the normal `DATABASE_URL` for a missing `TEST_DATABASE_URL`.
- Stateful tests require `NODE_ENV=test`, disposable PostgreSQL, exact `DATABASE_URL=TEST_DATABASE_URL`, a test/ci database name, isolated Redis with a unique UUID-qualified `TEST_REDIS_PREFIX`, fake transports, and cleanup proof.
- Use `GHL_TRANSPORT_FAILFAST=true` and provider-deny mode.
- Production evidence is read-only counts/aggregates with bounded samples and no PII.

## Authenticated production facts to reproduce safely

Treat these as audit observations, not hardcoded test fixtures:

| Population | Observed count |
|---|---:|
| Contacts / People | 155,356 |
| Prospects / Leads | 12,711 |
| Prospect-to-contact links | 1,559 |
| Enriched prospects | 12,686 |
| Prospects with email | 1,362 |
| Prospects with owner evidence | 2,103 |
| Lead Ops pool | 1,919,454 |
| Lead Ops enriched | 292,680 |
| Lead Ops contactable | 2,098 |
| Lead Ops pending | 968,179 |
| Outbound Prospects | 152,496 |
| Ready for Outreach | 153,643 |
| GHL-linked contacts | 1,921 |
| Contacts missing GHL ID | 153,435 |

The system must expose live counts truthfully; never encode these numbers as expected constants.

## CR-01 — Canonical revenue authority

### Objective

Make these meanings explicit and enforceable:

- Discovery record: raw observation/evidence.
- Prospect: pre-CRM staged candidate.
- Contact: canonical person/contact endpoint.
- Lead: contact/business with an open qualified deal.
- Deal: sales-stage authority.
- Merchant: won/onboarded account with merchant evidence.

### Required work

1. Rename the current Leads UI to **Prospect Staging**.
2. Create a real **Leads** view derived from canonical contacts joined to open deals.
3. Do not copy all contacts into `prospects`.
4. Preserve `prospects.contact_id` and idempotent promotion.
5. Add or complete durable source/entity links so contacts created outside prospects can still reconcile to discovery/import evidence.
6. Define business/contact role links for owner/decision maker/finance/operations.
7. Ensure one sales opportunity maps to one deal authority.
8. Make Pipeline, Reporting, Tasks, Statements, Applications, Portfolio, and GHL stage mappings use the same deal population.
9. Prevent cold prospects from appearing as merchants.
10. Add reconciliation APIs returning exact counts and mismatch buckets.

### Acceptance

- People, Prospect Staging, Leads, Deals, and Merchants have distinct definitions.
- Every displayed total is server-derived and paginated independently of the current page size.
- Prospect conversion is idempotent and creates/reuses one contact and one intended deal.
- Existing contacts do not require fabricated prospect rows.
- Pipeline and reporting totals reconcile.

## CR-02 — Classification, provenance, and production projections

### Objective

Remove test/demo/synthetic/unknown contamination from production business views without destructive cleanup.

### Required work

1. Inventory every `record_class` authority for contacts, prospects, businesses, deals, statements, applications, merchants, tasks, campaigns, sequences, and imports.
2. Create deterministic classification evidence and versioned projections.
3. Quarantine unknown rows from production lead, outreach, portfolio, finance, and KPI views.
4. Identify test/demo/synthetic records using source evidence, domains, users, batches, explicit flags, and fixtures—not name-only destructive heuristics.
5. Preserve unknown as unknown when proof is absent.
6. Require primary source event pointers for promotion and campaign qualification.
7. Reconcile import executions, row dispositions, batch totals, source events, and canonical entities.
8. Fix UI cards that use a 100/500-row fetch cap as a global total.
9. Label partial/sample counts clearly.
10. Add a read-only classification/provenance coverage dashboard.

### Acceptance

- Zero unknown/test/demo rows enter production revenue or outreach views.
- Raw rows remain recoverable and auditable.
- Import totals satisfy input = created + updated + skipped + conflicted + invalid.
- Samples never masquerade as global KPIs.

## CR-03 — Enrichment factory and qualified readiness

### Objective

Turn enrichment into a measurable funnel that produces channel-qualified contact records, not merely enriched timestamps or hot/warm labels.

### Required stages

1. Classification/quarantine.
2. Source reconciliation.
3. Business identity resolution.
4. Deterministic/free enrichment.
5. Controlled provider observation.
6. Decision-maker resolution.
7. Email discovery.
8. Email validation with generation/freshness checks.
9. Consent/suppression projection.
10. Separate ICP, identity, contactability, offer-fit, and priority scores.
11. Human cohort review.

### Provider rules

- Store provider results as observations with source, timestamp, cost, latency, status, and evidence.
- Distinguish success, no-result, failure, skipped, budget-blocked, and not-configured.
- Failed/no-result providers cannot approve a record.
- AI cannot overwrite canonical facts directly.
- No provider network call during automated tests.
- Add budgets, rate limits, circuit breakers, and per-provider yield dashboards.
- Apollo and Proxycurl remain not configured unless separately provisioned; do not probe them.

### Replace Ready for Outreach

Create channel-specific decision records:

- `READY_EMAIL`
- `READY_MANUAL_CALL`
- `READY_SMS`
- blocked with reason codes

Email readiness must require:

- production class;
- non-synthetic identity;
- primary source;
- resolved collision/identity;
- vertical/ICP/offer match with evidence;
- decision-maker evidence;
- current valid email evidence;
- clear email-specific suppression/permission;
- current readiness model after last mutation;
- ownership/shared-pool policy;
- campaign and sender version;
- decision timestamp, expiry, ruleset, and reviewer.

Queue membership and send-time authorization remain separate. Send-time contactability must recheck all current enforcement authorities.

### Acceptance

- Current Ready page no longer admits synthetic/unknown rows.
- Phone presence cannot make an opted-out email appear email-ready.
- Hot/warm/cold is not used as a substitute for contactability.
- Every cohort can be reproduced exactly.

## CR-04 — CRM operator journey

### Objective

Give reps and managers one coherent path from qualified lead to merchant revenue.

### Required work

1. Fix Pipeline full-page load failure.
2. Reconcile deal counts with Reporting.
3. Make Tasks show actionable, owned work; isolate/resolve SLA flood causes without production cleanup in this PR.
4. Make Inbox list, unread badge, refresh, error, empty, partial, and ownership states reconcile.
5. Prevent unauthorized cross-agent contact/conversation/detail access.
6. Make Portfolio contain only actual merchants and show exact totals.
7. Reconcile Statement Reviews with deals containing statements.
8. Preserve canonical application/underwriting/onboarding transition owners.
9. Add clear breadcrumbs, loading, empty, error, forbidden, deep-link, back/forward, mobile, and desktop states.
10. Remove test users/data from default production operational views via classification, not destructive deletion.

### Role matrix

Test anonymous, agent A, agent B, manager, and admin in isolated browser fixtures. Client hiding is not authorization. Verify direct APIs and indirect parent-object access.

### Acceptance

- One rep can move a qualified lead through reply, statement, meeting, proposal, application, win, and merchant onboarding with complete lineage.
- Every screen shows the same canonical objects and totals.
- No unauthorized data flash or IDOR.

## CR-05 — Premium campaigns, sequences, and provider readiness

### Objective

Preserve the useful campaign catalog while separating templates, tests, drafts, active programs, and evidence.

### Required work

1. Classify every campaign/sequence as template, test, draft, pilot, active, paused, retired, or invalid.
2. Quarantine test and zero-step sequences from production operator views.
3. Reconcile anomalous enrollment counts, including test sequences showing enrollment without active/completed state.
4. Require approved campaign versions, merge-field fallbacks, sender policy, offer/vertical mapping, and exact cohort decisions.
5. Add campaign preflight covering sample rendering, facts, suppression, duplicate enrollment, caps, sender identity, GHL mapping, reply ingestion, and attribution.
6. Reconcile sending identity authority: the readiness screen reported zero active while the identity page showed one warm primary at 30/day.
7. Complete required GHL inbound handoffs and pipeline-stage mappings in isolated/configuration-safe workflows; do not mutate live GHL without approval.
8. Keep SMS blocked until A2P/TCR and number/location ownership evidence is approved.
9. Add truthful campaign analytics from durable message receipts.
10. Use positive replies, statements, meetings, applications, and wins as primary optimization outcomes.

### Initial content family

Create or refine a five-touch, proof-first Statement Review campaign for the selected ICP:

- Touch 1: business-specific relevance + statement review.
- Touch 2: one vertical-specific fee/workflow mechanism.
- Touch 3: transparent review process and proof.
- Touch 4: alternate operational angle.
- Touch 5: respectful close/opt-out.

Never invent facts, savings, processor identity, local familiarity, or pain points.

### Acceptance

- Template and test data never appear active.
- One reviewed campaign version renders correctly for every pilot contact.
- Sender/provider readiness is authoritative and consistent.
- No live send is required to pass build/CI.

## CR-06 — Controlled email-pilot preparation

### Objective

Produce an immutable, human-reviewed email-only pilot packet without launching it.

### Required work

1. Compare at least three ICP candidates using coverage and expected valid-email yield.
2. Select one ICP and one offer.
3. Create a disposable/test cohort for automated flow testing.
4. Create a production read-only preview for 100–250 candidate contacts.
5. Require human approval before any production cohort becomes enrollable.
6. Freeze IDs, evidence, campaign version, sender, ruleset, and expiry.
7. Produce counts and blocked-reason distributions.
8. Produce a controlled-recipient receipt-test plan requiring separate approval.
9. Produce reply-routing, task, statement, meeting, and attribution operating procedures.
10. Keep global pause enabled and return a pilot GO/NO-GO report.

### Pilot launch remains separately authorized

This task may prepare but must not:

- unpause;
- enroll production contacts;
- send internal or external test mail;
- call Process Queue;
- run GHL backfill/resync;
- run provider enrichment/validation;
- mutate production classifications;
- change GHL workflow IDs;
- alter sending identities.

## Testing and CI

Use current canonical runners. At minimum:

```text
npm run check
npm run build
npx tsx scripts/ci-suite-manifest.ts --check
npx tsx scripts/check-migration-integrity.ts
npx tsx scripts/compliance-scan.ts
npx tsx scripts/run-ci-suites.ts --capability deterministic-static
npx tsx scripts/test-security-controls.ts
npx tsx scripts/scan-csrf-fetch.ts
npx tsx scripts/scan-tracked-files.ts
npx tsx scripts/scan-paid-provider-adapters.ts
npx tsx scripts/test-ghl-route-pause-gates-1629.ts
npx tsx scripts/test-sender-policy.ts
git diff --check
```

Then use disposable PostgreSQL/Redis and fake providers for:

- canonical migration twice;
- deterministic integration;
- contact/prospect conversion idempotency;
- classification/provenance reconciliation;
- enrichment observations and failure semantics;
- channel readiness;
- campaign preflight;
- sequence enrollment/dispatch idempotency;
- Pipeline/Reporting/Portfolio reconciliation;
- Inbox/ownership/role matrix;
- statement/application/deal lineage;
- server-required browser matrix.

Any skip, unreachable fixture, timeout, or unavailable required server is a non-pass.

## Required deliverables

Create:

1. `docs/CRM_CANONICAL_AUTHORITY_<SHA8>_<DATE>.md`
2. `docs/CRM_DATA_RECONCILIATION_<SHA8>_<DATE>.md`
3. `docs/ENRICHMENT_FACTORY_EVIDENCE_<SHA8>_<DATE>.md`
4. `docs/CRM_OPERATOR_BROWSER_MATRIX_<SHA8>_<DATE>.md`
5. `docs/CAMPAIGN_SEQUENCE_READINESS_<SHA8>_<DATE>.md`
6. `docs/EMAIL_PILOT_PACKET_<SHA8>_<DATE>.md`
7. `docs/CRM_COLD_OUTREACH_GO_NO_GO_<SHA8>_<DATE>.md`

Each must state exact source SHA, environment, commands, counts, isolation, cleanup, failures, remaining access/approval requirements, and confirmation that no real outreach/provider mutation occurred.

## Final response

Return:

1. Exact branch/head SHA and base SHA.
2. Files changed.
3. Canonical object definitions.
4. Before/after reconciliation tables.
5. Every UI/API defect fixed.
6. Enrichment funnel and provider-yield evidence.
7. Campaign/sequence cleanup classification.
8. Browser role-matrix results.
9. Tests/CI results with skips treated as failures.
10. Production actions explicitly not performed.
11. Remaining blockers with owner and next action.
12. Separate verdicts for CRM readiness, email pilot, SMS, and mass scale.
13. PR URL; do not merge or deploy without explicit approval.

## Done when

- One canonical data authority drives People, Leads, Pipeline, Portfolio, Reporting, and Outreach.
- Unknown/test/demo rows cannot enter production revenue or outreach views.
- Enrichment produces evidence-backed, channel-qualified contacts.
- All totals reconcile independently of pagination.
- The operator journey works end to end in isolated browser tests.
- One premium email-only pilot packet is complete and human-reviewable.
- CI is fully green for the exact SHA.
- No production mutation, provider call, or outreach occurred.
