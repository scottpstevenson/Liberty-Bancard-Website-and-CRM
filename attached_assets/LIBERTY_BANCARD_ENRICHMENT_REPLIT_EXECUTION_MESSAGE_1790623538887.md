# Liberty Bancard — Enrichment Completion

Paste this as the Replit task message. Treat it as **one end-to-end completion objective with sequential gates**, not one giant code patch. Keep the work connected across the gates; do not declare the project complete after an isolated fix, queue tick, or test suite. Do not ask me to choose between the work listed here.

## Objective

Make the South Florida enrichment funnel continuously turn eligible canonical businesses and their linked existing contacts into traceable, validated email prospects for the five current v2 verticals, then stage them as `ready_held` and, where policy permits, idempotently create paused enrollments. Surface the actual controls, costs, results, and blockers in Lead Ops. Keep all outbound sending paused.

## Re-pin the live baseline first

The following are read-only production observations from September 28, 2026. Recheck them against the exact current Replit workspace and authenticated production CRM before acting; do not rely on these counts if they have changed.

- Production reported release `229547793cf5651fccba2e3cca9a3b8197ed3b9b`. The workspace-reported `8c88fd1` attestation-refresh work was not in that deployed release.
- Production showed 48,841 canonical businesses and a large existing contacts pool. `master_leads` and Source Prospects showed zero. Existing contacts were not an input to the SFP candidate reader.
- South Florida Sunbiz backfill was running, but materialized source records still needed to flow through canonical identity, geography, classification, contact matching, enrichment, validation, and staging.
- The v2 program was scoped to Broward (12011), Miami-Dade (12086), and Palm Beach (12099), with Automotive, Healthcare, Beauty/Spa, Construction/Trades/Home Services, and Fitness/Recreation. The active 100-member cohort showed zero free-discovery candidates, zero addresses to validate, and zero staged intents; a paid preview listed Serper-eligible businesses but recurring discovery was not active. A funnel preview showed 808 eligible while a UI count showed 809; some cursor/status displays were stale.
- Free business enrichment was running for canonical businesses that already had domains. It did not link the general contact pool into SFP. SFP validation reported `NO_LIVE_RUNTIME_AUTHORITY`; recurring paid discovery, validation, and staging workers were not all active in the deployed profile.
- Provider controls and cost surfaces disagreed. Serper’s canonical usage view and legacy `serper_control` window differed; Outscraper and Apollo were disabled; OpenAI was enabled for classification rather than general contact sourcing; ZeroBounce was enabled but recurring validation was off. The general status card showed `$0` while SFP’s ledger showed spend.
- The shared SFP limit was $50, with about $0.22516 committed in the SFP preview at that snapshot. This is a one-time shared cap, not a daily allowance. All global, email, SMS, and cold-email pauses were on, with zero sends observed.

Record the current branch, HEAD, dirty files, migration head, deployed API SHA, deployed worker SHA, effective profile, provider controls, pricing version, aggregate ledger, outbound pauses, and current funnel counts. Keep dev and production separate. Never use dev fixtures for production proof or live paid calls.

## Gate 1 — One truthful source and eligibility funnel

Use `businesses.record_class=canonical` as the company identity, geography, and vertical authority. Sunbiz is an intake source and must materialize through the existing resumable path before becoming a candidate. Join existing `contacts` to canonical businesses by `business_id` or the existing high-confidence identity crosswalk; do not require `master_leads` or empty prospects as the sole input. Reuse the existing contact pool when the evidence qualifies.

Admit only the five current v2 verticals and the three South Florida counties above. Preserve DBPR-family, existing-customer, test/demo/synthetic, identity, geography, suppression, bounce, opt-out, consent, and contactability gates. Do not revive v1 restaurant/food categories. Keep classifier version and taxonomy version distinct. `email_status=active` is not verified; a verified email requires current valid validation evidence.

**Gate passes when:** the source-to-canonical-to-contact joins are restart-safe and deduplicated; geography, vertical, and exclusions are enforced in the actual selector; stage counts reconcile to their denominators; and the live preview can explain included and excluded records with evidence and reason codes. Add disposable-DB tests for this path.

## Gate 2 — Continuous, cost-aware enrichment and validation

Build one restart-safe rolling workflow. Prefer current evidence, existing linked contacts, deterministic classification, cached evidence, and free first-party website/contact-page recrawls. Call paid providers only to fill a documented gap:

- **Serper:** official-domain discovery, with corroborated business identity and compatible geography. Wrong-site results and every derivative candidate must be quarantined and excluded from repayment/reuse until corroborated review.
- **Outscraper:** a remaining business identity/location gap.
- **Apollo:** a justified named decision-maker/contact gap.
- **OpenAI:** versioned, evidence-grounded classification or extraction under a strict schema; never invent contact facts.
- **ZeroBounce:** validate actual candidate email addresses.

Connect each result to the same canonical evidence and cost ledger. Reuse current valid email evidence. Preserve cooldowns and idempotency. Block retry storms and make partial, provider-paused, budget-paused, and attestation-paused work durable and resumable.

Make the work self-draining. Remove manual max-10/max-25 batches as the normal operating mechanism. Internal batch sizes may be configurable for technical limits, but workers must continue automatically without a person freezing each batch. Reconcile schedules, capability groups, selected queues, actual worker instances, heartbeats, and next ticks. Validate the reported `8c88fd1` attestation refresh against the canonical runtime authority and fail closed when release or fleet evidence is missing.

Keep the shared cap at **$50** for this release. Do not raise it, reset it, zero counters, or create another ledger. Make it adjustable by an authorized admin for future changes, with audit history and before/after values. Reconcile Serper’s legacy and canonical controls without discarding or double-counting history. Every provider call must atomically reserve and settle against the same aggregate cap. A missing per-provider ceiling must never mean unlimited. Honor my direction to enable Serper, ZeroBounce, Apollo, OpenAI, and Outscraper in production in their appropriate roles, within existing provider/credit ceilings and the $50 cap. If a specific provider ceiling or ledger cannot be reconciled safely, pause that provider with the exact reason and keep the other safe lanes running; do not bypass the gate.

Verify current pricing and show its version and timestamp. The September 28 snapshot rates were Serper `$0.001/request`, Outscraper `$0.003/result`, Apollo `$0.025/credit`, OpenAI `$0.00001/token`, and ZeroBounce `$0.0195/request`. Show actual billable units, settled cost, reservations/releases, no-result billing, and cap remaining by provider and in aggregate. Do not report zero spend when the ledger is incomplete.

**Gate passes when:** disposable-DB and fake-transport tests prove the complete automatic free-first/provider-specific/validation path, exact shared-budget enforcement, correct retry behavior, and no dev network calls. Production worker profiles and provider control views must show the effective—not merely configured—state.

## Gate 3 — Lead Ops controls, results, and paused handoff

Extend the existing Lead Ops pages into one usable Enrichment Control Center. Show fresh, timestamped, disjoint funnel counts for source, county, vertical, canonical businesses, linked contacts, missing domains, free results, provider outcomes, discovered emails, ZeroBounce valid/invalid/catch-all/unknown, policy-eligible, `ready_held`, paused enrollments, suppressed, quarantined, retryable, and exhausted records. Mark stale or partial data; never mix denominators or show a missing ledger as `$0`.

Provide authorized, audited controls for provider enable/pause, provider ceilings, shared cap, program pause/recurrence, worker schedule, concurrency/rate, validation, staging, and emergency stop. Show queues, actual heartbeats, next ticks, backlog, retries, last provider result, exact cost, and searchable business/contact lineage. Keep raw PII in the existing authorized detail flow. Fix the stale cursor display, 808/809 mismatch, and false `outboundEnrichmentPaused` status.

Verify the existing five v2 campaign/sequence package mappings. Automatically create package-pinned `ready_held` intents only after current validation and policy checks. Use the existing idempotent bridge for **paused enrollment only**. Do not activate campaigns/sequences, unpause records, call GHL, queue sends, or send email/SMS/other outreach. Preserve the known wrong-site quarantine.

**Gate passes when:** disposable-DB end-to-end tests prove one eligible business/contact can move through source linkage, classification, free/paid evidence, validation, package-pinned `ready_held`, and exactly one paused enrollment—including replay, concurrency, and forced-failure rollback—with zero sends or outbound writes.

## Final release and production verification

Run relevant typecheck/build, migration replay/schema, worker-profile, API coverage, role/CSRF/privacy, provider-boundary, and end-to-end certification tests. Compare any failing gate with the untouched base SHA; fix failures caused or affected by this work. Commit one coherent release and report its exact publish-ready SHA, migrations/head, required worker profile, changed areas, tests, and any specific external blocker.

After the exact release is published, verify that both production API and workers report that SHA and the expected migrations. Enable and run the safe production enrichment lanes under the existing $50 cap; do not use dev data. Let the workers drain eligible production records automatically rather than asking me to run manual batches. Report daily and cumulative distinct businesses and contacts at each funnel stage, actual verified-email count and yield, cost per valid email, units/cost by provider, cap remaining, retry/cooldown state, worker heartbeats, and zero sends. If $50 cannot produce a few thousand valid emails at the measured yield, state the measured maximum and cost shortfall plainly instead of promising a number.

Proceed through all gates in order without stopping after the first code fix or asking me to choose between these specified steps. Preserve progress between implementation checkpoints. Do not create unrelated follow-up tasks. Do not call this complete until the full source-to-verified-email path and production receipt are proven. Keep outbound sending paused throughout.
