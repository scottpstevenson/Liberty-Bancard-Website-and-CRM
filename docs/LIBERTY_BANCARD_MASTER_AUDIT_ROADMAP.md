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

## Phase 8 — Cleanup & Hardening

**Objective:** Remove technical debt, dead code, and test data. Improve performance and developer velocity.

**Prerequisite:** Platform stable in production for 30+ days.

**Target window:** Ongoing; schedule quarterly cleanup sprints.

---

### P8-1 — Remove demo/test data and legacy backfill files

**Priority:** P3 | **Subsystem:** Data Quality

**Action:** 
- Run `scripts/cleanup-test-data.ts` to remove QA contacts
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

*This roadmap should be reviewed and updated quarterly. When a phase item is completed, mark it done with a date. New risks discovered during implementation should be added to the Risk Register.*
