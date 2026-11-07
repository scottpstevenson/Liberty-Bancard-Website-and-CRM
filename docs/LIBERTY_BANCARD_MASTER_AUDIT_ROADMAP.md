# Liberty Bancard — Master Audit Roadmap

> **Created:** 2026-08-13 | **Branch:** main | **SHA:** `2075729957b5592504bbd49584c98c2ac684ebf9`
> 
> This roadmap is the sequenced plan for auditing, hardening, and improving the Liberty Bancard platform from its current pre-launch state to a healthy, high-performing production system. It is **phased by risk priority** — earlier phases address production safety and data integrity; later phases address revenue optimization and operator experience.
>
> **Gate to production:** The 30-suite pre-deploy gate is currently 30/30 ✅. The app is publishable. This roadmap covers post-publish hardening and growth.

---

## Phase 0 — Production Safety & Send Authority

**Objective:** Ensure that when the outbound global pause is lifted, every send is compliant, gated, and recoverable. No mass-send risk. No opt-out bypass.

**Prerequisite:** Pre-deploy gate 30/30 (currently met).

**Target window:** Complete before first live outbound send.

**Kill lines:** Do not lift `outboundGlobalPaused` until Phase 0 is complete.

---

### P0-1 — Fix vertical bulk enrollment bypass in `campaigns.ts`

**Priority:** P1 | **Subsystem:** Promotional Enrollment

**Evidence:** `server/routes/campaigns.ts:1209-1232` calls `createSequenceEnrollment()` directly, bypassing `enqueuePromotionalEnrollment()` and its full compliance fence (DNC check, consent tier, contactability, readiness threshold, sequence dedup, trigger identity dedup).

**Failure mode:** A contact with no consent record, or with `emailStatus = 'bounced'`, or with `doNotContact = true`, could be enrolled in a promotional sequence via the vertical bulk enrollment UI.

**Blast radius:** Any admin/manager who uses the vertical bulk enrollment campaign feature could trigger compliant-fence-bypassing sends to an unconstrained audience.

**Recommended fix:** Replace direct `createSequenceEnrollment()` call with `enqueuePromotionalEnrollment()` for each contact in the bulk set. Add a pre-flight count showing how many contacts pass vs are skipped by the gates.

**Success criteria:** `campaigns.ts` vertical bulk path calls canonical enrollment function. Compliance scan passes. Pre-deploy gate 30/30.

**Deliverable:** Code change + pre-deploy validation

---

### P0-2 — Fix SDR orchestrator `outboundGlobalPaused` restart gap

**Priority:** P1 | **Subsystem:** SDR, Outbound

**Evidence:** `server/services/sdr/orchestrator.ts` reads `outboundGlobalPaused` from DB at startup and caches it in memory. A server restart after pause is lifted — or a pause set after startup — is not reflected until the next restart.

**Failure mode:** Operator pauses outbound via Admin panel; SDR orchestrator continues sending because it cached the old value. Or conversely: outbound is enabled, server restarts, SDR reads stale paused value and stops sending.

**Recommended fix:** Reload `outboundGlobalPaused` from DB on every SDR orchestrator tick (or every N ticks with a short TTL). The setting is already in `system_settings` — it's a single DB read.

**Success criteria:** SDR orchestrator respects `outboundGlobalPaused` changes without requiring a server restart. Add a test case to the Channel Orchestrator or pre-deploy suite.

**Deliverable:** Code change in `sdr/orchestrator.ts` + test

---

### P0-3 — ZeroBounce validation before outbound lift

**Priority:** P0 | **Subsystem:** Email Delivery, Consent

**Evidence:** 155,660 contacts have `emailStatus = 'active'` which is the DB default meaning "not yet validated". ZeroBounce has only been run manually on a small fraction. Sending to unvalidated addresses risks 5-15% bounce rate, which can get Liberty's sending domain/IP flagged or blocked.

**Action (operational, not code):**
1. Run `scripts/check-api-coverage.ts` to confirm ZeroBounce API key credit balance
2. Run batch ZeroBounce validation on the highest-readiness contacts first (admin/manager bulk validation route at `POST /api/contacts/validate-emails/batch`)
3. Contacts with `unsafe`/`invalid` status will be automatically blocked from sends
4. Prioritize: A-grade readiness contacts → B-grade → C-grade → D-grade

**Success criteria:** All contacts targeted in first outbound campaign have been ZeroBounce-validated. Bounce rate on first send < 2%.

**Deliverable:** Operational runbook + validation completion report

---

### P0-4 — Confirm all 16 Wave 2 direct GHL send sites

**Priority:** P1 | **Subsystem:** Channel Authority

**Evidence:** 16 files remain in the Wave 2 backlog with direct `sendGhlEmail()`/`sendGhlSms()` calls that bypass `ChannelOrchestrator`. They are currently allowlisted in the compliance scan as "Wave 2 backlog." Before enabling outbound, confirm each site either: (a) should remain direct (true transactional, not promotional) or (b) must be migrated.

**Files to audit:** `services/sdr/terminal-shipping.ts`, `services/sdr/voice-orchestrator.ts`, `services/sdr/statement-flow.ts`, `services/sdr/proposal-tracking.ts`, `services/ghl-workflow-enrollment.ts`, `services/workflow-executor.ts`, `services/campaign-engine.ts`, `services/proposal-engine.ts`, `services/co-branded-proposal.ts`, `services/sla-worker.ts`, `routes/wizard.ts`, `routes/helpers.ts`, `routes/public.ts`, `routes/integrations.ts`, `routes/savings.ts`, `routes/contacts.ts`

**Deliverable:** Classification table: each site marked "transactional/keep" vs "promotional/migrate". Migrate promotional sites before live traffic.

---

### P0-5 — Add A2P registration for SMS

**Priority:** P0 (for SMS channel) | **Subsystem:** SMS

**Evidence:** `A2P_REGISTRATION_ID` and `GHL_PHONE_NUMBER_ID` are not set. SMS cannot be sent legally for business messaging in the US without A2P 10DLC registration.

**Action (operational):** Register Liberty Bancard's SMS program via GHL (Campaign Registry / TCR). Set `A2P_REGISTRATION_ID` and `GHL_PHONE_NUMBER_ID` as Replit secrets when registration is approved.

**Note:** Email-only launch is possible without this. SMS can be enabled post-launch.

**Deliverable:** A2P registration + secrets set + SMS smoke test

---

## Phase 1 — CRM Data Integrity

**Objective:** Ensure the 156K-contact database is clean, correctly attributed, and free of dangerous duplicates before high-volume outbound.

**Prerequisite:** Phase 0 complete.

**Target window:** First 30 days post-launch.

---

### P1-1 — Reconcile 98% of contacts with no GHL ID

**Priority:** P2 | **Subsystem:** GHL Sync

**Evidence:** 153,459 of 156,063 contacts have no `ghlContactId`. These contacts cannot receive GHL-routed communications, GHL workflow automations, or GHL-tracked replies.

**Action:** 
1. Run bulk GHL upsert for high-readiness, high-score contacts first (prioritize A+B readiness grades)
2. Monitor GHL rate limits (circuit breaker at 10 consecutive failures)
3. Expect identity conflicts for contacts that already exist in GHL from other sources — review conflict audit log

**Risk:** If a Liberty contact shares an email with a GHL contact created through another path, identity conflict guard will skip it. Manual resolution required for conflicts.

**Deliverable:** 95%+ of qualified contacts have GHL IDs. GHL sync audit report.

---

### P1-2 — Run bulk readiness scoring

**Priority:** P2 | **Subsystem:** Readiness

**Evidence:** 117,315 contacts (75%) have no `dataReadinessScore`. Campaign audience filters use readiness score — contacts with NULL score are excluded from most campaigns.

**Action:** Trigger `contact-readiness.ts` bulk re-score via admin script or BullMQ enrichment queue. Process in batches of 500. Monitor enrichment queue depth.

**Deliverable:** < 5% of contacts with null readiness. Readiness grade distribution report.

---

### P1-3 — Clean up test/QA contacts

**Priority:** P2 | **Subsystem:** Data Quality

**Evidence:** 553+ contacts matching test patterns (`@libertybancard.test`, `wh-test-*`, `ghl-deal-test-*`). These should not receive outbound sends or appear in rep queues.

**Action:** Run `scripts/purge-test-contacts.ts` after verifying predicate covers all test patterns. Confirm no production contacts match. Back up counts before deletion.

**Predicate:** `WHERE email LIKE '%@libertybancard.test' OR ghl_contact_id LIKE 'wh-test-%' OR ghl_contact_id LIKE 'ghl-deal-test-%'`

**Deliverable:** Test data cleanup execution + count verification

---

### P1-4 — Populate `import_executions` for historical imports

**Priority:** P3 | **Subsystem:** Provenance

**Evidence:** `import_executions` table has 0 rows. 156K contacts lack batch provenance records. This makes it impossible to trace "which import batch created contact X" for audit purposes.

**Action:** Create a backfill script that groups contacts by `import_batch_id` (where set) and creates `import_executions` rows retroactively. For contacts with no import batch ID, mark as `legacy/unknown`.

**Deliverable:** Provenance coverage report: % of contacts with traceable source

---

### P1-5 — Audit duplicate phone numbers

**Priority:** P2 | **Subsystem:** CRM Dedup

**Evidence:** No unique constraint on `contacts.phone`. Phone collisions are possible. Test isolation issues confirmed with hardcoded phones in smoke tests.

**Action:** Query for duplicate normalized phone numbers across non-archived contacts. Review top 20 duplicates manually. Determine if merge or data cleanup is needed.

**Query:** `SELECT normalize_phone(phone), COUNT(*) FROM contacts WHERE archived_at IS NULL GROUP BY 1 HAVING COUNT(*) > 1 ORDER BY 2 DESC LIMIT 20`

**Deliverable:** Duplicate phone audit report + decision: add constraint or leave as-is

---

## Phase 2 — Intake & Import Hardening

**Objective:** Ensure every lead entry path correctly captures provenance, deduplicates, and routes through the compliance fence.

**Prerequisite:** Phase 1 CRM cleanup complete.

**Target window:** 30–60 days post-launch.

---

### P2-1 — Wire CSV import through canonical `writeContact()`

**Priority:** P2 | **Subsystem:** Imports

**Evidence:** `routes/imports.ts` creates contacts directly and writes `leadScore` / `lastScoredAt` directly (non-canonical). Import does not use `writeContact()` or `enqueuePromotionalEnrollment()`. `import_executions` table is empty.

**Risk:** Imported contacts bypass: GHL pre-creation, provenance recording, promotional enrollment gate, and canonical scoring.

**Recommended fix:** Refactor import to call `writeContact()` per row with `sourceCategory='csv_import'`; create one `import_executions` row per batch; remove direct score writes.

**Deliverable:** Import refactor + test proving provenance is recorded

---

### P2-2 — Add strict field validation to all public forms

**Priority:** P2 | **Subsystem:** Public Forms

**Evidence:** Public form routes use Zod validation but not necessarily `strict()` mode. Extra fields in POST body could set unintended contact fields.

**Action:** Audit each public form handler for Zod schema strictness. Add `.strict()` to all form schemas or explicitly document why extra fields are allowed.

**Deliverable:** Strict validation audit + code change for any gap found

---

### P2-3 — Prospect system review

**Priority:** P3 | **Subsystem:** Prospects

**Evidence:** `prospects`, `prospect_lists`, `import_executions` tables exist. Code for prospect-to-contact conversion exists. In practice, most contacts are created directly. The prospect system appears underused.

**Action:** Determine if the prospect system should be the mandatory funnel for all non-form contacts (imports, SDR, Sunbiz) and enforce it, OR formally document that direct contact creation is acceptable and remove confusing prospect infrastructure.

**Deliverable:** Decision document + optional refactor

---

## Phase 3 — Data Quality Intelligence

**Objective:** Maximize the intelligence of each contact record to enable precise targeting and effective vertical campaigns.

**Prerequisite:** Phase 2 intake hardening complete.

**Target window:** 60–90 days post-launch.

---

### P3-1 — Harmonize vertical taxonomies

**Priority:** P2 | **Subsystem:** Enrichment, Vertical Classification

**Evidence:** Readiness scoring uses one vertical set (15 canonical verticals) and lead scoring uses a different set (9 broader buckets). A contact classified as "Auto Repair" can score as "Automotive" or "Home Services" depending on which path runs.

**Action:**
1. Define one canonical vertical taxonomy for Liberty Bancard
2. Create a normalization function that maps all source verticals to the canonical set
3. Update both `contact-readiness.ts` and `lead-scoring.ts` to use the same canonical set
4. Backfill `contacts.vertical` for contacts where the stored value is from a non-canonical source

**Deliverable:** Canonical vertical taxonomy document + code update + backfill

---

### P3-2 — Bulk enrichment run

**Priority:** P2 | **Subsystem:** Enrichment

**Evidence:** Enrichment providers (Serper, Outscraper, Apify) are configured but `SERPER_API_KEY` is not set (email discovery crippled). Contacts sourced from Sunbiz have basic registration data but many lack phone, email, website.

**Action:**
1. Set `SERPER_API_KEY` as a Replit secret
2. Run targeted enrichment on contacts with null email or null website (highest-value gap)
3. Monitor provider credit usage; set budget caps
4. Review `SUNBIZ_ENRICHMENT_ENABLED` gate and enable for production

**Deliverable:** Enrichment coverage report: % of contacts with email, phone, website before and after

---

### P3-3 — Implement ZeroBounce automatic validation on contact creation

**Priority:** P2 | **Subsystem:** Email Quality

**Evidence:** ZeroBounce validation is currently manual-only (admin/manager batch or single). New contacts created via any path get `emailStatus = 'active'` by default.

**Recommended fix:** Enqueue ZeroBounce validation via BullMQ enrichment queue on contact creation (post-create hook in `writeContact()`). Rate-limit to 1 API call per contact per 30 days. Gate on `ZEROBOUNCE_API_KEY` availability.

**Deliverable:** Automatic ZeroBounce integration + credit usage monitoring

---

### P3-4 — Improve `emailStatus` semantics

**Priority:** P2 | **Subsystem:** Data Model

**Evidence:** `emailStatus = 'active'` conflates "not yet validated" with "confirmed deliverable". This is the current default for all 155,660 contacts.

**Recommended fix:** Change the default to `'unvalidated'`. Add `'unvalidated'` as a valid status. Update contactability checks to treat `'unvalidated'` as "proceed with caution" (allow cold sends, but not warm sends). This is a schema migration + code update.

**Deliverable:** Migration + code update + pre-deploy validation

---

## Phase 4 — Outreach Engine

**Objective:** Harden the sequence/campaign/enrollment engine for high-volume reliable operation.

**Prerequisite:** Phase 0 complete (canonical enrollment fixed). Phase 3 data quality improvements underway.

**Target window:** First 90 days post-launch.

---

### P4-1 — Migrate Wave 2 direct GHL call sites to ChannelOrchestrator

**Priority:** P1 | **Subsystem:** Channel Authority

**Evidence:** 16 files in Wave 2 backlog bypass ChannelOrchestrator (see P0-4 audit). Any promotional send through these sites skips the compliance fence.

**Action:** For each site classified "promotional/migrate" in the P0-4 audit, replace `sendGhlEmail()`/`sendGhlSms()` with `channelOrchestrator.sendEmail()`/`channelOrchestrator.sendSms()` with appropriate `category`. Update compliance scan allowlist.

**Deliverable:** All promotional send sites use ChannelOrchestrator. Compliance scan allowlist reduced to zero. Pre-deploy gate clean.

---

### P4-2 — Fix `weekly-digest` and `daily-outreach` idempotency

**Priority:** P2 | **Subsystem:** Scheduled Jobs

**Evidence:** `weekly-digest` uses in-memory `lastSentWeek` (loses on restart). `daily-outreach` uses boolean `workerRunning` (not mutex-safe). Both can duplicate on server restart.

**Recommended fix:** Use `acquireJobLock()` with durable DB keys (in `system_settings` or a dedicated `job_locks` table). Already done for some workers — apply the same pattern.

**Deliverable:** Durable idempotency keys for weekly-digest and daily-outreach

---

### P4-3 — Upgrade Upstash to Pay-As-You-Go

**Priority:** P1 | **Subsystem:** Redis / BullMQ

**Evidence:** 24 Redis connections vs 20-connection Upstash free-tier cap. Periodic `connect ETIMEDOUT` errors on BullMQ workers. This is causing pre-deploy flaps and will cause production job losses.

**Action:** Upgrade Upstash plan to Pay-As-You-Go or consolidate low-frequency queues to reduce connection count.

**Deliverable:** Zero ETIMEDOUT errors in a 24-hour monitoring window

---

### P4-4 — Add BullMQ heartbeat alert

**Priority:** P2 | **Subsystem:** Observability

**Evidence:** Queue-manager heartbeat exists but no automated alert when a heartbeat stops. Silent queue failure is a P1 risk.

**Recommended fix:** BullMQ heartbeat writes to `system_settings`. If heartbeat stops for > 10 minutes, health-monitor sends admin email alert. (Task #1447 in backlog.)

**Deliverable:** Heartbeat alert wired to health-monitor CRITICAL_CHECKS

---

### P4-5 — Email content audit and subject line optimization

**Priority:** P3 | **Subsystem:** Sequence Copy

**Evidence:** 75+ sequences exist. Content has not been audited for: weak subject lines, unsupported claims, template variable safety (`{{agentEmail}}` / `{{agentPhone}}` rendering as raw syntax), broken CTAs.

**Action:** 
1. Audit all sequence email subjects and body for the patterns listed in audit spec §17
2. Prioritize: cold outbound sequences (highest volume risk)
3. Do not modify sequences without testing template variable rendering in staging first
4. Specific known issue: raw `{{agentEmail}}` and `{{agentPhone}}` syntax showing in prospect emails (Task #1136)

**Deliverable:** Content audit report + copy fixes for top 10 sequences by volume

---

## Phase 5 — Revenue Funnel

**Objective:** Maximize the conversion rate from qualified lead to boarded merchant.

**Prerequisite:** Phase 4 outreach engine stable.

**Target window:** 90–180 days post-launch.

---

### P5-1 — Statement acquisition follow-up optimization

**Priority:** P2 | **Subsystem:** Statement Acquisition

**Evidence:** `abandoned-statement` BullMQ queue chases statement requests stale 3+ days. StatementChain has 11 steps. Proposal follow-up is separate queue.

**Gap:** Statement-chase edge cases (task #1384/#1385): confirm behavior when statement is uploaded mid-chase, when contact is archived, and when deal stage changes externally.

**Deliverable:** Statement acquisition edge case test coverage + any fixes

---

### P5-2 — Pipeline pagination and deal management

**Priority:** P2 | **Subsystem:** Pipeline UI

**Evidence:** Pipeline UI may not paginate when deal count exceeds a threshold. 387 deals currently — manageable. At 2,000+ deals (realistic 6-month state), pagination is essential.

**Deliverable:** Pipeline board pagination + server-side filtering (task #1479)

---

### P5-3 — Application completion funnel

**Priority:** P3 | **Subsystem:** Applications

**Evidence:** Only 2 merchant applications in DB. Onboarding reminder worker exists but is triggered by abandoned applications. The application UI flow needs end-to-end testing with a real merchant user.

**Action:** Test full merchant portal flow: deal moves to Go-Live Scheduled → merchant invite sent → merchant logs in → completes application → PEWC consent → admin reviews → underwriting → MID assignment.

**Deliverable:** End-to-end merchant onboarding test + any gaps fixed

---

### P5-4 — Chargeback defense program tracking

**Priority:** P3 | **Subsystem:** Revenue

**Evidence:** "Chargeback Defense" sequence exists. `chargebacks` table referenced in task #1285. Confirm table structure and that residual/chargeback counts display correctly post-import.

**Deliverable:** Chargeback table audit + import verification (task #1285)

---

## Phase 6 — CRM / SDR Operator Experience

**Objective:** Make the platform fast, intuitive, and reliable for the 28-agent sales team and 3 admins.

**Prerequisite:** Phases 1-3 data quality improvements complete.

**Target window:** 60–120 days post-launch.

---

### P6-1 — Inbox auto-refresh

**Priority:** P3 | **Subsystem:** CRM UI

**Evidence:** Mobile inbox does not auto-refresh. Reps miss replies. (Task #1480)

**Deliverable:** Polling or WebSocket inbox refresh

---

### P6-2 — Daily briefing cache

**Priority:** P3 | **Subsystem:** AI / Reporting

**Evidence:** Daily AI briefing is recomputed on every load. At 28+ agents, this causes redundant OpenAI calls. (Task #1482)

**Deliverable:** Daily briefing cached per-day with Redis TTL

---

### P6-3 — Ready-for-Outreach queue enhancements

**Priority:** P3 | **Subsystem:** CRM / Rep Tools

**Evidence:** Task #1493 (Ready-for-Outreach queue) was just merged. Follow-up tasks #1504, #1505, #1506 were cancelled but the improvements remain valid:
- Click-to-call and email-compose buttons in the queue (#1504)
- Skip flag cleanup after re-enrichment (#1505)
- Role guard confirmation (#1506)

**Deliverable:** Enhanced outreach queue with one-click contact actions

---

### P6-4 — ZeroBounce history on contact detail page

**Priority:** P3 | **Subsystem:** CRM UI

**Evidence:** Reps cannot see why an email was blocked. ZeroBounce validation history is in `audit_logs` but not surfaced in the contact detail page. (Task #1153)

**Deliverable:** ZeroBounce history panel on contact detail

---

### P6-5 — Co-branded proposal engagement alerts in CRM pipeline

**Priority:** P3 | **Subsystem:** CRM Pipeline

**Evidence:** Co-branded proposals are tracked but engagement (open, click) events are not surfaced in the CRM pipeline board. (Task #303)

**Deliverable:** Proposal engagement event display in pipeline deal cards

---

## Phase 7 — Conversion Optimization

**Objective:** Improve conversion rates through better messaging, personalization, and funnel experiments.

**Prerequisite:** Phase 4 (outreach engine stable) + Phase 6 (CRM experience solid) + at least 90 days of outbound data.

**Target window:** 6–12 months post-launch.

---

### P7-1 — A/B test email subjects

**Priority:** P3 | **Subsystem:** Sequences

**Evidence:** 75+ sequences, no A/B testing infrastructure. Subject line quality is the #1 lever for cold email open rates.

**Action:** Build a lightweight A/B test framework on sequence step subjects. Use `analytics_events` for tracking. Run 2-week tests on top cold outbound sequences.

**Deliverable:** A/B test framework + first 3 subject line tests + result analysis

---

### P7-2 — Vertical-specific message optimization

**Priority:** P3 | **Subsystem:** Sequences / Copy

**Evidence:** Vertical sequences exist (V-Retail, V-Medical, V-Auto Repair, etc.) but copy may not be truly vertical-specific. Medical vs Med Spa vs Dental have different pain points (regulatory compliance vs aesthetics vs insurance billing).

**Action:** Review vertical sequence copy for specificity. Commission rewrite of top 3 converting verticals.

**Deliverable:** Vertical copy audit + copy refresh for 3 highest-volume verticals

---

### P7-3 — Funnel analytics and conversion reporting

**Priority:** P3 | **Subsystem:** Analytics

**Evidence:** `analytics_events` table exists (219 rows — very early). No funnel conversion reports visible in dashboard.

**Action:** Build conversion funnel report: Lead → Engaged → Statement Requested → Statement Received → Proposal Sent → Application → Closed Won. Track by vertical, rep, source, campaign.

**Deliverable:** Funnel conversion dashboard with vertical/rep/source breakdown

---

### P7-4 — Public site mobile visibility and presentation

**Priority:** P2 | **Subsystem:** Public site (marketing pages, footer, imagery)

**Status (2026-11-07):** Implemented and locally verified in source from base `6d2dafad`; **not published**. Detail, measurements and limits are in the go-live ledger change log entry of the same date.

**Evidence:** Chromium-only lab evidence on a production build in an isolated preview: 156-state mobile visibility matrix clean, 22 overlay probes passing, fonts and image-derivative checks passing, and LCP/CLS within the lab targets (≤ 2.5 s / ≤ 0.1) on six measured routes. New checks are registered in the pre-deploy roster and CI manifest.

**Open items that remain owner/follow-on decisions, not closed by this work:**
- A real iPhone/WebKit pass (safe area, dynamic bars, large text, keyboard) is NOT EXERCISED; it cannot run in this environment.
- All imagery is marked provenance `unverified`, usage `illustrative`; a licensed or verified merchant photograph is still needed to replace it.
- After publication, bind the read-only public smoke (`scripts/check-public-site-mobile.ts` with `BASE_URL`) to the serving SHA.
- Terminal product PNGs on `/0-percent-processing` (about 2.1 MB) were not routed through the new image pipeline.

**Deliverable:** Public pages readable and usable at phone widths with no change to CRM design, outbound pause, provider writers, consent or intake handlers.

---

## Phase 8 — Cleanup & Hardening

**Objective:** Remove technical debt, dead code, and test data. Improve performance and developer velocity.

**Prerequisite:** Platform stable in production for 30+ days.

**Target window:** Ongoing; schedule quarterly cleanup sprints.

---

### P8-1 — Remove demo/test data and legacy backfill files

**Priority:** P3 | **Subsystem:** Data Quality

**Action:** 
- Do not run heuristic cleanup against production. `scripts/cleanup-test-data.ts` is restricted to a separate `NODE_ENV=test` database; use classification reconciliation for production investigation.
- Archive Python repair scripts (`fix-server-errors-pass*.py`) — no longer needed
- Remove `scripts/archive/reroute-sequence-ctas.DONE.js`
- Clean up timestamped `backfill-backup-*.json` files from scripts/

**Deliverable:** Repository cleaned of stale files

---

### P8-2 — Unify legacy setInterval schedules with BullMQ

**Priority:** P3 | **Subsystem:** Workers

**Evidence:** Legacy `setInterval` schedules exist in `ghl-sync.ts`, `daily-outreach.ts`, `sdr/orchestrator.ts`, `sdr/re-enrichment.ts`, `sdr/funnel-metrics.ts`, `sdr/inbox-rotation.ts`, `sdr/lead-finder.ts`. These are fallback paths but can run in parallel with BullMQ if queue initialization fails partially.

**Action:** Audit each legacy schedule. Either remove it (if BullMQ is reliable enough) or add explicit mutual-exclusion fencing so both cannot run simultaneously.

**Deliverable:** Zero duplicate-execution risk from legacy/BullMQ overlap

---

### P8-3 — Add missing performance indexes

**Priority:** P3 | **Subsystem:** Database

**Action:** Profile slow queries using `pg_stat_statements`. Likely candidates:
- `contacts` by `assignedTo` (rep-scoped queries)
- `sequence_enrollments` by `contactId + status` (sequence worker due-work query)
- `deals` by `pipeline + stage` (pipeline board)
- `audit_logs` by `contactId + created_at` (contact history)

**Deliverable:** Query profiling report + index additions for hot paths

---

### P8-4 — Documentation drift cleanup

**Priority:** P3 | **Subsystem:** Documentation

**Action:** Review all docs in `/docs/` for accuracy vs current code. Mark stale docs with a deprecation header. Keep the new Knowledge Brief and Audit Roadmap as living documents — update them quarterly.

**Deliverable:** Stale doc audit + deprecation markers

---

## Phase Summary

| Phase | Name | When | Key Output |
|-------|------|------|-----------|
| **Phase 0** | Production Safety & Send Authority | Before first outbound send | Enrollment bypass fixed, ZeroBounce run, A2P set |
| **Phase 1** | CRM Data Integrity | First 30 days | GHL sync, readiness scoring, test cleanup |
| **Phase 2** | Intake & Import Hardening | 30–60 days | CSV import canonical, form strictness |
| **Phase 3** | Data Quality Intelligence | 60–90 days | Unified verticals, bulk enrichment, email status fix |
| **Phase 4** | Outreach Engine | First 90 days | Wave 2 migration, idempotency, Upstash upgrade |
| **Phase 5** | Revenue Funnel | 90–180 days | Statement edge cases, pipeline pagination, app flow |
| **Phase 6** | Operator Experience | 60–120 days | Inbox refresh, briefing cache, outreach queue |
| **Phase 7** | Conversion Optimization | 6–12 months | A/B testing, vertical copy, funnel analytics |
| **Phase 8** | Cleanup & Hardening | Ongoing quarterly | Legacy code, demo data, indexes |

---

## Risk Register

### P0 — Immediate production/compliance/data-loss risk

| ID | Risk | Subsystem | Evidence | Blast Radius | Blocks Production? |
|----|------|-----------|----------|-------------|-------------------|
| R-P0-01 | Vertical bulk enrollment bypasses compliance fence | Enrollment | `campaigns.ts:1209` | Any contact in Liberty DB | **YES** |
| R-P0-02 | Sending to 155K "active" email contacts without ZeroBounce validation | Email Delivery | DB count, schema default | Domain reputation, deliverability | **YES (for outbound)** |
| R-P0-03 | A2P registration missing — SMS cannot be sent legally | SMS | Env audit | All SMS sends | YES (SMS-only) |
| R-P0-04 | SDR orchestrator doesn't reload global pause from DB on restart | Outbound | Memory note | SDR sends post-restart | **YES** |
| R-P0-05 | 24 Redis connections vs 20 Upstash cap → job ETIMEDOUT | Infrastructure | BullMQ logs | All BullMQ jobs | **YES (for reliability)** |

### P1 — High operational/revenue risk

| ID | Risk | Subsystem | Evidence | Blast Radius |
|----|------|-----------|----------|-------------|
| R-P1-01 | 98% of contacts have no GHL ID — GHL communications not routed correctly | GHL Sync | DB: 153,459 without ghlContactId | All GHL-routed sends |
| R-P1-02 | 75% of contacts unscored — excluded from campaign audience filters | Readiness | DB: 117,315 null | Campaign reach severely limited |
| R-P1-03 | Wave 2 direct GHL call sites bypass ChannelOrchestrator | Channel Authority | 16 files in backlog | Promotional compliance for 16 send sites |
| R-P1-04 | `emailStatus = 'active'` semantics conflate unvalidated with valid | Data Model | Schema default | All downstream contactability decisions |
| R-P1-05 | `import_executions` empty — no provenance on 156K contacts | Provenance | DB: 0 rows | Cannot trace source for any historical contact |

### P2 — Important correctness/data-quality risk

| ID | Risk | Subsystem | Evidence | Blast Radius |
|----|------|-----------|----------|-------------|
| R-P2-01 | Dual vertical taxonomy mismatch (readiness vs lead scoring) | Data Quality | Enrichment subagent report | Vertical-targeted campaigns |
| R-P2-02 | No phone dedup constraint — phone collisions possible | CRM Dedup | Schema analysis | Duplicate contact routing |
| R-P2-03 | `weekly-digest` / `daily-outreach` lose idempotency on restart | Scheduled Jobs | Memory: scheduler-idempotency-gaps.md | Duplicate digests on restart |
| R-P2-04 | Fire-and-forget `.catch(() => {})` patterns lose audit events | Observability | Workers subagent | Compliance audit trail incomplete |
| R-P2-05 | Raw `fetch()` calls bypass CSRF in client code | Security | Memory: csrf-raw-fetch-gap.md | Authenticated state mutation |
| R-P2-06 | CSV import writes leadScore non-canonically | Data Quality | `routes/imports.ts:1080,1094` | Imported contacts have synthetic scores |

### P3 — Hardening / maintainability

| ID | Risk | Subsystem | Evidence | Blast Radius |
|----|------|-----------|----------|-------------|
| R-P3-01 | Legacy setInterval schedules can run in parallel with BullMQ | Workers | Workers subagent | Duplicate GHL syncs, SDR sends |
| R-P3-02 | `proposal` stage (lowercase) in DB vs "Proposal Sent" — likely stale | Pipeline | DB query: 30 deals with stage='proposal' | Pipeline reporting inaccurate |
| R-P3-03 | `consent_audit_logs` only 193 rows for 156K contacts | Consent | DB count | Formal consent trail incomplete |
| R-P3-04 | GHL workflow keys unresolved (GHL_WORKFLOW_* env vars not set) | GHL Automation | Logs: WORKFLOW_KEY_UNRESOLVED | GHL automations never fire |
| R-P3-05 | 25 "Go-Live Scheduled" deals with no corresponding active merchant | Onboarding | DB pipeline breakdown | Potentially stalled onboardings |

---

## Success Criteria for "Production Ready"

✅ Pre-deploy gate: 30/30  
✅ `campaigns.ts` enrollment bypass fixed  
✅ ZeroBounce run on all targeted contacts before first send  
✅ SDR orchestrator reads pause state dynamically  
✅ Upstash upgraded / connection count within cap  
✅ A2P registered (or email-only launch explicitly decided)  
✅ First outbound campaign sent with < 2% bounce rate  
✅ GHL IDs populated for top-1000 priority contacts  
✅ Readiness scores populated for all contacts  
✅ Test data cleaned from production DB  

---

### Stage 4 sequence (updated 2026-10-30)

Stage 4A (catalog and operational truth) is published. Stage 4B (SFP supply and throughput) is implemented in source and awaits publish; see ledger §49 (closure repair R01–R03 in §49.4: bounded inventory/release reads, late-registration fence, expired-claim settlement; inventory production completion time unverified). Remaining order: 4C1, then 4C2, then 4D. Staging-worker multi-window, concurrency and timed-suppression behaviour is fixture-proved on a disposable database (ledger §49.2); production behaviour of the new hold, active production policy/schema, the post-publish smoke and candidate deployment evidence remain release gates, and the build-start census is recorded as missing.

---

*This roadmap should be reviewed and updated quarterly. When a phase item is completed, mark it done with a date. New risks discovered during implementation should be added to the Risk Register.*


## Stage 4C1 → 4C2 → 4D (2026-10-31)

- **4C1 (content workspace):** source-partial, unpublished. Contract, token and booking repairs, draft CAS, transport previews, premium drafts as proposals and the asset disposition are in source. Remaining 4C1: grouped workspace views, paired package publication (3/5-touch, started-journey protection), draft adoption UI, 1280/768/390 browser proof. See the ledger entry of the same date.
- **4C2:** native appointment, calendar and SMS and native workflow install. Account-purpose booking destination and merchant-referral destination are prerequisites noted by the CTA contract.
- **4D:** integrated acceptance. Outbound stays paused until then.

- **4C2 (appointment and follow-up authority) — 2026-11-02:** source-implemented, unpublished; see ledger entry "Stage 4C2" and `docs/certification/stage4-c2/owner-map-and-disposition.md`. Correction pass (migration 0379) delivered the browser matrix, calendar drawer/source filter/agenda, run-history paging and SMS purpose work in source (still unpublished). Open: handler interleaving and executor-crash suites, full pre-deploy roster, queue/compliance baseline scans, native workflow installation, cancel-disposition approval and booking-writer enablement (4D).
- **4C2 completion pass — 2026-11-02:** RC1–RC5 repaired in source and tested on disposable databases (ledger "Stage 4C2 completion pass"); create-from-console explicitly deferred to 4D (RC4C); scanner baselines recorded as failing, not green; unpublished. Remaining 4D: native workflow install, booking-writer canary, delivery/readback, role/performance acceptance on the served build.

## Stage 4D — integrated acceptance (2026-11-03)

Separate verdicts (details in `docs/certification/stage4-d/`, including `publication-and-verdicts.md` and `integrated-journey-matrix.md`):
- **Implementation:** ready. `stage4d-integrated-acceptance` (47 checks incl. scanner gate-removal negative controls), `stage4d-vertical-county-matrix` (16, 516 rows), role-guard smoke (booking create/preview/execute roles, no receipt on denial), 173-check browser run including the New provider appointment console at 1280/768/390 x light/dark, and the section 19 suites that were run all pass on disposable infrastructure. `npm run build` passes. Compliance scan and queue-compliance now pass by per-file gate proof (no blanket allowlist). No provider network attempt.
- **Repairs:** inbound reply evidence and receipt in one transaction; audited reply-stop pause; non-sending expiry sweep for held GHL enrollments (also while paused); full-number SMS provider identity; null-workflow retry parks for review; governed create console with explicit purpose, IANA zone to UTC, server-owned preview context; campaign ownership filter.
- **Data/count, SFP prep/staging, content/CTA:** unchanged. Production recapture: five current v2 packages, 3 steps each, campaigns draft and sequences paused; five-touch drafts verified, not adopted or approved.
- **Native GHL/calendar:** **BLOCKED** — no authorized protected test path (booking writer default-denied, outgoing GHL disabled epoch 16). Feasibility packet and proposed protected path in `owner-and-native-matrix.md`.
- **Roles/UI/performance:** roles and the Calendar console verified in a real browser; Campaigns filter and Program Health note not browser-verified; no performance measurement.
- **Publication/schema/rollback:** no migration; uncommitted working-tree changes on HEAD `73272418`; `ghl_appointment_state_status_chk` still lacks `'no_show'` in production (owner SQL repair). Known baseline failure: `ghl-projection-authority` GPA-99.
- **Overall:** implementation ready; acceptance blocked. Open items are listed in the evidence packet.

### Stage 4D — completion status update (2026-11-03, after the published-build audit; earlier text above is kept as history)

- **Publication:** Stage 4D is merged and published as `548812f0` (build id `77138085-bcf3-4620-afee-0c69ab641d14`, built 2026-11-03T18:22:41Z). The earlier line "uncommitted working-tree changes on HEAD `73272418`" described the first pass and is superseded. Repository head `087a657e` also holds later Payarc changes that are not in the serving build.
- **Closed this pass (disposable database and fakes):** booking-create recovery (R1), zoned time (R2), GPA-99 (R3), bad-source journey, signed reply/STOP/bounce through both entrances, partner denial on booking routes, 4B/4C1/4C2 browser reruns, matched Calendar performance, schema repair and rollback rehearsal.
- **Found and fixed, not yet published:** SDR webhook signature middleware `require()` failure under ESM; a STOP arriving only through the specialized `message-received` route did not withdraw consent.
- **Still open:** native acceptance (BLOCKED, no authorized path), production `no_show` constraint repair (owner-run packet), production performance not measured, Campaigns filter and Program Health note not browser-verified, the two fixes need Publish.
- **Separate verdicts and evidence:** `docs/certification/stage4-d/publication-and-verdicts.md`. Stage 4D is not called complete because code is published.


### Stage 5 — Application to MID: status (corrected 2026-11-04 after the published-source audit; earlier text above is kept as history)

- **Correction:** the earlier "not published" status is superseded. The first Stage 5 change was published (production served `218d4c4e5a3697990c6955df3e94f559b474c0b0` when audited), and the published-source audit found it open: the real public application journey, effect/consent/delivery truth, readiness policy, processor uncertainty and contract, underwriting decision pinning, condition chases, MID semantics and registry, and the browser acceptance were incomplete. Repairs R01–R09 are now in source (uncommitted working tree on `8876077c`; the next publish is the owner's step). The 24 original findings keep their dispositions; this does not add entries to the 95-entry register.
- **Layers, stated separately:** application/review functionality PASS at fixture and browser layers; protected data/security PASS at fixture layer; processor/MID command integrity PASS at fixture layer with the provider denied; UI/roles/accessibility PASS for the focused browser journeys (BoardingPanel, public wizard, MID registry, underwriting, applications, role denials); installed schema fixture-only (migrations `0380`, `0381` apply on a disposable database; the production database holds the `0381` objects per the later read-only check while its Drizzle ledger has no `0380`/`0381` entry; `0380`'s `ALTER … USING NULL` discards any populated actor values and an application rollback cannot restore them; however, the present objects, empty tables and missing ledger rows do not prove that statement ran against production actor data (risk and verified facts are recorded separately in `docs/certification/stage5/verdicts.md`; no ledger stamp, replay or startup DDL was performed); `0381` is additive); native/production NOT RUN; release: published later, see the 2026-11-06 correction entry.
- **Defects the browser proof found and fixed:** signed-in operators' wizard writes had no CSRF header; autosave sent `null` yes/no answers (400); finalize returned 400 for any visitor with a stored landing page or click id because the strict schema rejected those keys.
- **Not passing:** `scripts/test-forms.ts` still fails in the disposable harness for environment reasons (statement upload, estimate queue manager, outbox worker profile). The policy matrix `boarding.policy.matrix.v1` is unrecorded, so real boarding fails closed.
- **Stage 5 remains open** until the owner publishes the repaired build and the read-only/native steps in `docs/certification/stage5/native-packet.md` are executed and reviewed. Evidence: `docs/certification/stage5/verdicts.md`, `native-packet.md`, `browser/`.

### Stage 5 completion pass (2026-11-05; still open; later published, production confirmed serving `b554212e` — see the 2026-11-06 correction entry)

Applied the published completion audit C01–C06 as one bounded pass. Fixture results: application-effects 69, underwriting-conditions 85, boarding-routes 114, boarding-worker 76, public-journey 34, payarc-codec 67, status-apply 14, underwriting evidence/read-model/override 27/31/46, application-contract 79, merchant-application-security 273/0; role guards, API coverage, migration integrity (1009), suite manifest and compliance scan pass. Browser (fixture, built client + source handlers, not the deployed server): 24 checks pass. `test-forms.ts` still exits 1 (provider deny mode starts no workers; estimate/get-started 400 reproduced at source as a record-class acceptance 409 that production data cannot confirm or refute). Read-only production schema check: `0381` columns/index present, chase table empty, ledger has no `0380`/`0381` entry; `0380` actor values are not restorable by an application rollback. No native, production, provider or publish step was taken; outbound paused (epoch 1), outgoing GHL disabled (epoch 16). Detail: `docs/certification/stage5/verdicts.md` and `native-packet.md`.


### Stage 5 correction pass F01–F03 (2026-11-06; still open)

Cross-reference: this entry corresponds to the canonical ledger/spec/roadmap entries §51.21 / §43.20 / §14.15 (the canonical documents also carry §51.20 / §43.19 / §14.14 for the published C01–C06 receipt). The repository copies of these documents do not contain those section numbers, so no section number is asserted here; identify this entry by title and date, and by `docs/certification/stage5/verdicts.md`. The 95-entry lineage is unchanged.

Production identity at the start of the pass: serving `b554212e` (publish build `8ce8a2ec-1666-4542-85d4-a4d3198484bb`), main `c7239f21`. Layers, kept separate: **Source** — F01 fresh-inbound class contradiction repaired (unknown contact and deal are accepted as a truthful `review_required` occurrence with durable unlinked management work, retained exact contact/deal/request evidence and held assignment/sending; explicit nonproduction, archived and foreign-linked contexts are retained as `INBOUND_CONTEXT_UNAVAILABLE` review evidence instead of a generic 400; later review continues the same request, contact, deal and task without duplicates); F02 one retry owner for outbox-owned workflow enrollment; F03 MID registry Open/Back round trip. **Fixture** — see `verdicts.md` for counts. **UI** — fixture browser only. **Native** — NOT RUN. **Release** — historical wording: these corrections were not published when this entry was written (later published; see the F01 recovery entry below). No production submit, send, provider call, reclassification or native enablement occurred; outbound pause epoch 1, outgoing GHL disabled epoch 16, incoming GHL enabled. Stage 5 remains OPEN; no closure or native-GO claim.


### Stage 5 F01 recovery and continuation pass (2026-11-06; still open)

Cross-reference: this entry corresponds to the canonical ledger/spec/roadmap entries §51.22 / §43.21 / §14.16 (the canonical documents also carry §51.21 / §43.20 / §14.15 for the F01–F03 correction, whose "not published" wording is historical: F01–F03 was later published, serving `f22696f1`, build `05b9f1ea-2c23-4ceb-9510-6a73b95eff5d`, main `e4e9d5ff`, post-publish browser receipt 2,694 inputs and 27 checks, live admin F03 walkthrough). The repository copies of these documents do not contain those section numbers, so no section number is asserted here; identify this entry by title and date, and by `docs/certification/stage5/verdicts.md`. Entries §51.21 / §43.20 / §14.15 are unchanged.

Layers, kept separate: **Source** — committed contact/consent/deal progress is bound to the public sales occurrence (immutable occurrence-keyed evidence only, never email/name/phone guesses); a failure with committed rows answers a truthful recoverable 202 and a same-key replay finishes the same request without duplicates or promotion; scoped admin/manager review continuation route with click-time authority/identity/revision checks, held external effects and real blocked reasons; public forms no longer treat a recoverable or unreadable response as success. **Fixture** — `test-stage5-intake-recovery` 193 checks (real HTTP failure injection after contact, consent, deal, link bind and notification; lost response; concurrent replay; stale lease; scoped resume matrix); fresh-inbound 168, test-forms 30 and the other focused regressions pass; manifest, API coverage, compliance, migration integrity and role-guard gates pass. **UI** — fixture browser `test-stage5-intake-browser` 34 scenario groups at 1280/390 px for Estimate, Get Started and Home callback; ContactBubble, the HelpCenter callback panel and the admin resume button were not browser-exercised. **Native** — NOT RUN. **Release** — candidate, not published by this entry. Migration `0380` wording in the native packet is now conditional: empty tables and current column types do not establish historical execution or data loss, with no provenance-incident or backup-recovery claim. No production form submission, reclassification, provider call, native operation or activation occurred; outbound pause epoch 1, outgoing GHL disabled epoch 16, incoming GHL enabled. Stage 5 remains OPEN; no closure or native-GO claim.

### Website email lifecycle readiness — default-closed implementation and isolated proof (2026-11-07; project task 2143; still open)

Cross-reference: this entry has no canonical section number in the repository copies of these documents, so none is asserted; identify it by title and date, and by `docs/certification/website-email/browser/receipt.json`. The plan is `.local/tasks/website-email-lifecycle-readiness.md`; the owner's corrected pre-build audit is `attached_assets/Liberty-Task2143-Final-Prebuild-Audit-and-Corrections-2026-11-0_1794078783321.md`. Earlier entries are unchanged.

Scope as run: the corrected preflight and the default-closed implementation with isolated tests only. No production write, send, mailbox or provider probe, profile or capability enablement, GHL or native writer, recipient release, control unpause or ad launch occurred. Live activation and delivery acceptance are NOT complete and are not claimed.

**Source (what the code now does; none of it is active).** A separate warm Gmail lane for website requesters, closed by default.
- Consent: Estimate, Get Started, Free Analysis and newsletter forms carry an optional, unchecked email-marketing box. The server owns the wording and its hash. An unchecked or omitted box writes no email consent event; a consent-write failure reports `unavailable`; the newsletter page reports a subscription only from a server-recorded consent; the "PDF" promise was removed; the Free Analysis phone-and-text sentence no longer claims email marketing. The phone consent control and its writers are untouched. New email opt-in writes appear only through the canonical consent authority (`website-email-consent.ts`); the other canonical opt-in writers are unchanged.
- Programs: `requested_followup` (purpose `human_response`, transport `transactional_response`) and `nurture` (stays `promotional`, transport `marketing_outreach`). Nurture needs an email opt-in from THIS occurrence. A second occurrence for a person who already has an active or completed journey for the same program is refused `PRIOR_JOURNEY_EXISTS`, whatever warm revision or source sequence the program is mapped to at that time (the check runs under the contact lock; a unique index on contact and program for active and completed admissions is the database backstop). Unknown record class holds both programs (`CLASS_REVIEW_PENDING`). A later inbound message stops the journey.
- Decision: one pure function, `decideWebsiteWarmAdmission`, judged at creation, claim and before-I/O; claim and before-I/O re-bind to the live address hash, address generation, frozen revision hash, channel and admission state. It calls the unchanged pure CR-06 decision with an explicit boundary and purpose (`website-email-contracts.ts`). `CR06_DISPATCH_AVAILABLE` is still `false` and the CR-06 decision file is unchanged. Warm enrollments never use the CR-04 fence, canonical recipient preparation or SFP cohorts, and never read a sequence's free-form trigger config.
- Lane configuration: append-only, compare-and-swap on the revision. Opening requires the connected Gmail account to equal the sender account, approved warm revisions with zero unsupported steps for every mapped program, and a daily limit above zero. The eligible-from time can move later, never earlier (only an open-to-open change carries the existing start; opening from closed floors to the change time). Requests that arrived before the lane opened are terminal `BEFORE_ELIGIBILITY_START`; held intents expire after 72 hours.
- Warm revisions: frozen snapshots copied from a paused source sequence (states inactive, approved, retired). Approving does not activate the source sequence; non-email steps are recorded as unsupported and block approval.
- Enrollment marker: `sequence_enrollments.website_admission_id`. The legacy sequence worker filters marked rows (`sequence-worker.ts`), and the read-only operator "silent sequences" widget excludes them (`server/routes/activation.ts`), so marked journeys reach only the warm runtime.
- Transport: Gmail OAuth only (non-cold sender category). Send attempts are written before I/O to `website_email_send_receipts`; an uncertain outcome stays fenced and is never resent automatically (admin resolve only); the global pause is enforced inside `sendGmailEmail`; the `website-email` queue cannot run while global outbound is paused. The mailbox reader uses Gmail history polling, is closed by default, and its first poll initializes the cursor with no backfill.
- New in the final pass: the lane proves from the catalog that `communication_events` accepts the provider `gmail` before it admits, claims, sends or opens (`PROVIDER_LEDGER_NOT_READY`, a recoverable hold). Reason: Publish delivers new tables but has previously skipped CHECK changes on existing tables, and a send that cannot be recorded must never be made. Status shows `ledger.acceptsGmail`; the lane card shows "Message ledger accepts Gmail".
- Admin surfaces (no new sidebar entry): Outbound readiness lane card (single authority-backed status; Save requires an ok preview of the identical input; opening needs an acknowledgment checkbox), Sequences warm-content panel (create frozen copy, preview, approve, retire), a read-only Activation panel summary with a link, and the existing receipt card. Ten admin routes under `/api/admin/website-email` (status, revision preview, config preview, config save, revision create, approve, retire, reader open, reader close, receipt resolve); admin only for writes, admin and manager for reads.
- Migration `0382_website_email_lifecycle` (journal index 385, `when` 1800400290000): seven additive tables, the nullable enrollment marker column and its foreign key, and a widened provider CHECK on `communication_events` (the old CHECK lacked `gmail`). The new background capability group `website-email` is defined but not selected by any checked-in profile.

**Fixture / disposable database (all on freshly created disposable databases; provider and network egress denied).**
- Backend certification `scripts/certification/test-website-email-lifecycle-disposable.ts`: 376 checks PASS on the final tree — consent source matrix across Estimate, Get Started, Free Analysis and newsletter, default-closed lane, per-occurrence per-program durable intents, scoped admission (including a remap to a different approved source sequence that still cannot start a second journey for the same contact and program, and a direct second insert refused by the database), marker ownership versus the legacy lane (including a production-shaped mirror), transport outcomes and capacity, reader and canonical stops, tick ownership, the role-denial matrix over all ten routes, the schema-delivery fence (narrow CHECK: zero Gmail calls, no receipt, lane unopenable, status says why; restore: same journey sends), and zero external network calls.
- `scripts/test-website-email-contracts.ts` 43 checks PASS; `test-cro05a-static.ts` 21 checks PASS; `test-consent-writer-dominance.ts` PASS (its three baseline assertions were repaired with negative controls; none showed a production leak); `test-redis-topology.ts` PASS (earlier tree); `smoke-role-guards.ts` PASS through the disposable runner after adding GET status (anonymous 401, merchant 403, agent 403, admin 200, manager 200) and GET revision preview (404 for admin and manager, 403 agent), which also proves the routes are mounted in the real app.
- Regression suites (E15), each through the disposable runner or run directly, all PASS: background-profile, forms, stage5 fresh-inbound, stage5 public-journey, stage5 intake-recovery, inbound-acknowledgement, canonical-release-authority, stage4d signed-reply journey, sequence-reply-decision, ghl-capability-policy, sender-policy (82/82). These ran on the tree before the final catalog-fence edit; that edit touched only the website-email contracts, lane store, status, lane card, reasons file and two test scripts. `smoke-selective-profile.ts` and `test-background-cadence-cleanup.ts` fail on the untouched baseline as recorded earlier and are not attributed to this work.
- Gates: `ci-suite-manifest --check` valid; `check-migration-integrity` PASS (1012 checks, 2 historical warnings); `check-api-coverage` PASS (883 client endpoints against 1805 handlers, no new unmatched); `check-queue-compliance` PASS; `compliance-scan` PASS (96 call sites). Focused compiler checks of the changed website-email files were clean. No whole-project TypeScript result is reported or relied on.

**Schema (E14).** `scripts/test-website-email-migration.ts` 173 checks PASS: fresh install through the production harness (exact 0382 ledger hash; rerun leaves the ledger unchanged); SQL-to-Drizzle parity for all seven tables and the marker column (columns, types, nullability, indexes, checks) with database negative controls; upgrade with historic rows from an EMULATED 0381 head (a harness-migrated database with exactly the 0382 objects reversed and its ledger row removed — not a genuine historic database; a genuine one cannot be built because the migrator folder is bound to the working directory); partial-schema convergence; replay idempotency with retained rows; a legacy raw enrollment insert still works; the journey unique index covers contact and program (not revision); narrowing the provider CHECK is refused while Gmail evidence exists (schema rollback is not a supported path). Registered in the suite manifest and the pre-deploy roster.

**Browser (fixture).** `scripts/test-website-email-browser.ts` 150 checks PASS, private Chromium against the real handlers on a disposable database: Sequences warm panel (copy, unsupported-step blocking, HTML/plain/link preview, keyboard open and Escape, approve), lane card (read facts, blocked open preview with reasons, closed save and reload, Back), Activation summary, admin-to-manager actor switch with direct 403s, role matrix admin/manager/agent plus merchant, partner and affiliate negatives at 1280, 768 and 390 px in light and dark, and the public Estimate, Get Started, Free Analysis and newsletter consent surfaces (checked, unchecked, request failure; the Free Analysis call-and-text sentence no longer names email). The Free Analysis scenarios were added in this pass after the first attempt returned 501: the browser fixture had not mounted the route file that holds the Free Analysis handler; it is now mounted and the real handler answered. Egress: the only denied external attempt is the existing deal-blueprint AI call from the unchanged public handlers (host-attributed); none to Gmail, GHL, ZeroBounce or any other provider. NOT exercised in the browser: ContactBubble and the HelpCenter callback panel (a callback without an email address is covered in the disposable-database certification: no consent event, no warm effect). The Stage 5 intake browser suite also passed (34 scenario groups); its re-rendered evidence images were restored to their committed content.

**Build and tested-tree identity.** Tested tree: uncommitted working tree on main `0332181102c736af52fab9768e833f7360bd3b6b` (55 changed or untracked paths, 22 of them untracked, before these documents were updated; package, lockfile and `.replit` unmodified; nothing stashed or reset). Final production build: `NODE_ENV=production npm run build`, buildId `365c3b65-b432-4257-b4ff-be345df14193`, artifactSha `0332181102c736af52fab9768e833f7360bd3b6b`. Browser receipt input hash `59b02859f12c8799984e45d059c4a14fe4ff994436bf017cc0b8d7ad44989f4c`, source input hash `5f686a3ad2205fe00ab08d8c307615f6e4e3740f12c15a4e3efa562833b61980`; the scope is stated there as the compiled client with registered source handlers, not deployed bundled-server parity. The final build, the browser run, the backend certification (376 checks), the migration proof (173 checks), the migration integrity check and the contract suite all ran after the last source edit (the one-journey-per-contact-and-program correction). The Stage 5 intake browser run and the E15 regression suites listed above ran earlier on the tree before that correction and the catalog-fence edit; the correction touched only the lane store admission check, the journey index in the migration and the Drizzle schema, and the certification script.

**Production, read-only.** `git ls-remote` shows origin main equals the tested base `0332181…` (no fetch was run). Production `/api/health` serves `8edb02db0a00623898a9a8509c050032d8c464de`, publishBuildId `32e186e8-d5f9-4194-b0ea-064fb780445f`, unchanged since preflight. On main the migration journal has 385 entries (last `0381_stage5_condition_chase_versioning`, `when` 1800400280000), so index 385 and `0382` are unreserved on main; other remote branch journals were not inspected. The development database was read: it does not contain the 0382 objects (the harness applies migrations when the development app boots, which was not done). The production database was not read or written; production controls, pause state and schema were not queried this pass.

**Gate and grep results.** The only new caller of the lifecycle decision (`website-email-contracts.ts`) passes an explicit boundary and purpose; existing callers use the compatible wrapper and were not edited beyond the marker filter. The background-profile diff adds only the `website-email` group; existing groups are unchanged. Enrollment-insert census: legacy storage method (never sets the marker), the SFP enrollment bridge, canonical recipient preparation and the post-enrichment worker's raw SQL (all unmarked, and the legacy worker's marker filter keeps marked rows away from them) and the warm writer (the only one that sets the marker). The existing "no usable channel" reason appears only in the untouched promotional-enrollment-eligibility and census code. Queue and send compliance scans pass; no direct send call outside the existing helpers; no production-targeted write script; no dependency, lockfile, environment or secret change; no checked-in profile or capability enablement; the 127 catalog sequences and the CR-06 cold pilot manifest are untouched. E12 (signed ingress) is not applicable because Gmail history polling was chosen over Pub/Sub.

**Migration and deploy instructions.** (1) Publish reconciles production from the development database, so boot the development app once so the harness applies 0382 (additive, closed) before publishing. (2) Publish delivers tables, columns, indexes and foreign keys; it has skipped CHECK alterations before, so after publishing confirm read-only that the CHECK on `communication_events` names `gmail` (the status route's `ledger.acceptsGmail`, or the same catalog predicate). If it does not, apply the final statements of `migrations/0382_website_email_lifecycle.sql` (drop the narrow CHECK, add `communication_events_provider_gmail_chk` NOT VALID, validate) through the owner's Database SQL console; until then the lane holds with `PROVIDER_LEDGER_NOT_READY` and cannot be opened. (3) After publishing, all seven tables are empty and the lane has no configuration revision: closed.

**Rollback and hold semantics.** Closing the lane (admin UI) appends a closed revision and admits nothing further; revoking revokes admitted journeys; global outbound pause and the queue pause gate stay as found. Code rollback is a redeploy of the previous build; the schema is additive and is not dropped (the database refuses narrowing the provider CHECK while Gmail evidence exists). Marked enrollments remain tied to paused source sequences; that an older build will not process them is reasoned from the paused sequences and the unchanged pure CR-06 refusal of promotional mail, not tested.

**Not verified.** Any deployed behaviour; the production database state; Gmail connection, alias and receiving mailbox; DNS, SPF, DKIM, DMARC and delivered headers; real delivery and inbox arrival; the ContactBubble and HelpCenter callback browser paths; the older-build behaviour above; a genuine historic migration head.

**Remaining gates (all pending and owner-controlled; none are claimed).** Owner publish; confirm serving identity and unchanged controls and schema; one narrowly authorized seed to the owner's designated inbox with real From and Reply-To, SPF, DKIM and DMARC alignment, links, unsubscribe and arrival; a protected complete website journey with authorized test mailboxes (receipt, enrollment, first and later step, reply stop, unsubscribe, bounce); proof of the actual Gmail connection and alias; scoped lifting of only the necessary pauses after exclusion of old work is shown, with SMS and unused native writers off and outgoing GHL contact sync as found; proof of immediate stop, revoke and recovery without replaying delivered or uncertain steps. Owner decisions still required: non-cold transport and sender (connect Gmail or approve a reviewed change), SMTP provider identity and policy eligibility for any SFP list, DNS and delivered-header alignment, incoming GHL bulk-sync status, and the ads minimum release. SFP provider and list eligibility, native GHL, SMS and calendar work, and ads remain open and are not marked complete here.
