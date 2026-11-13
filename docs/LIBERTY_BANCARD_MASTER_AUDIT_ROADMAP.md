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

### Status update — 2026-11-12 (closure of the post-Publish verification)

The live audit ("Live CRM audit and Phase 6 roadmap", 2026-11-11) replaced the five old items below with 22 findings (CRM-01 to CRM-22) in five packages. A post-Publish verification (2026-11-12, 26 rows) then found nine repairs still needed (R01–R09). They were checked on isolated infrastructure and then **published by the owner** (live health sha `b58b20be…`, build `b7a93741…`, 2026-11-13). A read-only readback confirmed the published source matches the checked candidate file for file and that the live client files are byte-identical to the candidate's; no signed-in session was used, so the repaired screens themselves were not read live. Full evidence, hashes and the row-by-row table are in [`docs/certification/phase6-closure/README.md`](certification/phase6-closure/README.md).

| Package | Findings | State |
|---|---|---|
| 6A - Review-path reliability | CRM-01 to 04, 13, 17 | Built. Exact task and request paths (R01), safe legacy aliases, one business time zone, notifications that resolve from their own recorded request (R07). |
| 6B - Mobile continuity and privacy | CRM-05 to 08 | Built. Narrowing a window keeps the exact record address (R04), truthful summaries, no private API caching in the service worker, foreground-only bounded refresh. |
| 6C - Inventory truth and provenance | CRM-09 to 12, 15, 16 | Built. Bounded, fenced inventory reads (R02), counts that state their definition (R05), email-lane guidance matching local receipts (R03), record-class labels from the classification authority only. No production repair was applied. |
| 6D - Daily sales workspace | CRM-14, 18 to 22 | Built. Contact is a person with a separately labelled business and three-state consent (R06). Maintenance details behind disclosures with the emergency stop visible (R08). Page identity: area names come from the sidebar entries; record pages show an area-only breadcrumb and a Back control that survives reload (R09). Single-record claim of unassigned work is admin/manager only through the existing fenced update. |
| 6E - Acceptance and serving receipt | all | Isolated acceptance done. Published; serving sha, source match and client-bundle identity confirmed live (read-only). Signed-in live screens and production-scale timing not run. See below. |

**Evidence that exists (isolated infrastructure, final candidate source hash in the closure README):** nine static and seven disposable-database Phase 6 suites, the Phase 6 browser suite (55 named checks, 36 audited states: five widths and native 200% zoom, Back/reload/breakpoint continuity, late responses, actor change, offline, role revocation, keyboard, role matrix, claim fencing), the populated-journey browser suite (66 checks: Inbox, Outreach Queue, validation history, proposal events, Pipeline at 320 px), the contact header browser check, role-guard smoke and route-guard checks. Two authorization gaps found on the way were closed (ZeroBounce history and co-branded proposal reads now apply the owner checks) and the Pipeline toolbar no longer covers every card at 320 px.

**Evidence still missing (not claimed):**
- Signed-in readback of the repaired screens on the live site, and production-scale timing and query plans for the bounded inventory reads (fixture scale only; the routes need an admin session). Done after Publish: health sha and build capture, source comparison (0 differences), client-bundle byte identity, unauthenticated route refusals, startup and log review, read-only production counts (closure README section 9).
- Real simultaneous multi-tab behaviour, WebKit, real phones and installed-app behaviour; a browser run in a device time zone other than the container's; a real-browser walk of the exact task, request and file actions and of opening a notification; signed-in production screens.
- Full pre-deploy roster on the published candidate.
- Checks that already failed on the exact clean base and still fail at the same first assertion: CRM operator experience, CRM interface contracts, dashboard calendar update, industry-page contract, lead-ops budget removal, attestation promotion regression. These scripts stop at the first failure, so their later assertions were not executed on either side. The contact header browser check also failed on the base (section navigation below the phone fold) and passes on the candidate after a compact-header change. The SEO audit's hydrated-metadata step flagged a different pair of pages on each of two runs; it looks like a timing flake but was not compared with a clean base.

**Row verdicts (26 rows).** ACCEPTED = proved by the isolated evidence named in the closure README. LIMITED = accepted for that scope; a named part was not executed. OWNER-DEFERRED = needs an owner decision or Publish.

| Row | Verdict | Row | Verdict |
|---|---|---|---|
| CRM-01 Inbox visibility | ACCEPTED, LIMITED (provider-side live facts not reproduced) | CRM-13 Exact request | ACCEPTED, LIMITED (no real-browser walk) |
| CRM-02 Exact task | ACCEPTED, LIMITED (no real-browser walk) | CRM-14 Claim fencing | ACCEPTED |
| CRM-03 Legacy aliases | ACCEPTED | CRM-15 Email-lane states | ACCEPTED |
| CRM-04 Business time zone | ACCEPTED, LIMITED (container zone only) | CRM-16 Email-lane guidance | ACCEPTED, LIMITED (live after Publish) |
| CRM-05 Mobile continuity | ACCEPTED, LIMITED (Chromium only) | CRM-17 Notifications | ACCEPTED, LIMITED (no real-browser open journey) |
| CRM-06 Mobile privacy | ACCEPTED, LIMITED (source level) | CRM-18 Contact is a person | ACCEPTED |
| CRM-07 Stale / actor change | ACCEPTED, LIMITED (no real multi-tab) | CRM-19 Documents | ACCEPTED |
| CRM-08 Foreground refresh | ACCEPTED, LIMITED (desktop Inbox in browser) | CRM-20 Work presentation | ACCEPTED, LIMITED (Work page not width-audited) |
| CRM-09 Bounded reads | ACCEPTED, LIMITED (fixture scale; live readback) | CRM-21A Today queue | ACCEPTED, LIMITED (density not measured) |
| CRM-10 Provenance | ACCEPTED | CRM-21B Pipeline | ACCEPTED, LIMITED; read-first drawer OWNER-DEFERRED |
| CRM-11 Record class / QA | ACCEPTED for labels; reclassification cohort OWNER-DEFERRED | CRM-21C Responsive | ACCEPTED, LIMITED (listed pages; no real devices) |
| CRM-12 Counts | ACCEPTED, LIMITED (fixture scale; live readback) | CRM-21D Maintenance | ACCEPTED, LIMITED |
| CRM-22A | ACCEPTED, LIMITED (density not measured) | CRM-22B Page identity | ACCEPTED |

**Old items reconciled against the audit's crosswalk:**
- P6-1 Inbox auto-refresh: desktop already polled every 45 s; mobile and the selected thread now refresh in the foreground only, on the same cadence. The populated Inbox journey shows a new message arriving through that refresh with the selection and a half-typed draft kept. No second inbox was built.
- P6-2 Daily briefing cache: the server already caches per actor, role, time zone and day. The briefing's day now uses the business time zone. Redis is not required for it.
- P6-3 Outreach queue actions, P6-4 ZeroBounce history, P6-5 Proposal engagement: populated proofs now exist on isolated data. Outreach Queue rows show contact, call, email, Start and Skip (Start was never pressed; rows come from a labelled stand-in for the CR04 projection) and Skip is audited and owner-fenced. Validation history shows current, earlier, past-window, earlier-address, legacy-status, failed-read and Retry states. Proposal engagement shows the open count, alert age, accepted, older-than-seven-days and failed-read states per deal. Board-wide proposal badges need a per-deal open, which is a separate proposed task.

**Owner decisions still open (not implemented):** whether to have the signed-in live screens proved; classifying deal 2589 through the admin route so the waiting inbound request can resume; wider assignment policy for unassigned intake and service work; whether to recover the three older failed statement commands; approval of any provenance or test-record reclassification cohort; a read-first Pipeline deal drawer; automatic statement analysis; content and form mappings and controlled email acceptance. Outreach, unpause, release, sends and paid provider spend stay off.

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
| **Phase 6** | Operator Experience | 60–120 days | CRM workflow repairs built 2026-11-12 (see Phase 6 status); acceptance readback open |
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

### Website intake and CRM handoff repair — durable review handoff, statement-upload queue capability and review surfaces (2026-11-07; direct owner request; Publish required)

Cross-reference: this entry has no canonical section number in the repository copies of these documents, so none is asserted; identify it by title and date, and by the three certification scripts `scripts/certification/test-website-intake-handoff.ts`, `scripts/certification/test-statement-upload-queue-capability.ts` and `scripts/certification/test-website-intake-handoff-browser.ts`. The owner's scope is `attached_assets/Liberty-Website-Intake-and-CRM-Handoff-Full-Repair-Scope-2026-1_1794106172520.md`.

Scope as run: one bounded repair with three checkpoints (A trace and durable handoff, B public and operator behaviour, C integrated proof). Isolated tests only. No production write, send, provider call, profile or capability enablement, GHL write, recipient release, control unpause, deletion or reclassification occurred. Production was read only for diagnosis. The repair is NOT live: it is unpublished, and the existing occurrence 269B66AF has NOT been recovered. Neither is claimed.

**Root cause (sanitized evidence).** The site serving libertybancard.com ran build `8edb02db…`; the repository head was `22286be2…` and unpublished. Reference 269B66AF is a statement upload whose 521,585-byte PDF was retained; its request lifecycle was `failed` with `STATEMENT_COMMAND_QUEUE_UNAVAILABLE`, its statement command was `recoverable_failed`, its receipt (transactional acknowledgement) was already `sent`, and its assignment, sales work, SLA and statement-review effects were `held`, so no task or notification existed. A second identical failure (reference 0A900C02) exists and is reported only. All four production statement commands were `recoverable_failed`. Three defects combined. (1) The `.replit` background profile selected no group containing the `statement-upload` capability, so no producer queue existed and the public route answered 503 before it accepted the request. (2) The receipt sweep had no prerequisite that the internal review work exist, so a receipt could promise review that nobody had been asked to do. (3) Re-saving the receipt capability moved the eligibility start forward.

**Source (what the code now does).**
- Capability: a narrow `statement-upload` group is selected by the profile (`selective:…,ghl-sync-only,statement-upload`). It admits only the statement producer queue and consumer; it does not widen the critical-commands group.
- Durable handoff: queue refusal is not a failed request. The retained file and in-progress command stand, one review task with its deadline and one management notification (label "Processing needs attention", link `/dashboard/lead-ops?tab=pipeline&ref=<REF>`, no statement or financial content) are created, the request is `review_required` with terminal reason `STATEMENT_PROCESSING_DEFERRED:<code>`, and the merchant receives a truthful 202 with an eight-character reference that says automatic processing is behind and an advisor will handle it. A same-key replay answers 200 with the same reference. The other six statement producers keep their boolean/503 contract.
- Storage and responses: the 10 MB limit is kept; the file type is judged from the real bytes (PDF, JPG, PNG), with 413, 415 and 400 for an oversized file, an unsupported file and a malformed submission, before any contact, file or request is written.
- Receipt gating: receipts are gated per request class on the internal review milestone and a per-class cutoff, so an old request is never back-filled and a re-save never moves the start; the global pause and the five-class capability are unchanged.
- Recovery: admin-only, CSRF-protected `POST /api/lead-ops/inbound-requests/:receipt/statement-recovery`; it re-enqueues the retained command only when a consumer exists, otherwise says so plainly and changes nothing; it never touches a receipt, never creates a replacement submission, contact, task or notification.
- Review surfaces: Inbound Operations (cards below 1024 px, table from 1024 px) with reference lookup, the review task link and the retry control for admins; an Overview "Website requests" card for admin and manager; the Messaging Inbox "Site chat" scope note that points to Inbound Operations and a failed-source notice that names the source, says it is not an all-clear and offers Retry; stale deal links now resolve to `/dashboard/pipeline?id=`. No sidebar entry was added.
- Receipt settings and previews: per-class windows and save semantics are shown; previews are sent as support@ and render in an empty sandbox; the dashboard preview inlines the logo for display only (the sent HTML and its absolute logo URL are unchanged); the full-preview dialog now starts focus on the dialog so Escape closes it (the preview frame used to take focus and swallow the key).
- Disclosed behaviour change: automatic statement AI analysis for the website source is held behind a default-closed `system_settings` flag, so a deferred upload does not spend a provider call on its own.

**Test receipts by layer (all on disposable databases, deny-by-default egress, global outbound pause in force).**
- Service/route/queue/effects: `test-website-intake-handoff.ts` 116 checks passed; `test-statement-upload-queue-capability.ts` 32 checks passed; `server/tests/statement-command-worker.test.ts` and `scripts/test-redis-topology.ts` passed.
- Mounted browser (private Chromium, compiled production client, real sessions, 1280, 768 and 390 px, light and dark): `test-website-intake-handoff-browser.ts` 140 checks passed on two consecutive runs: Inbound Operations matrix, long business name, lookup, retry, Overview, receipt settings and previews, Messaging Inbox, notification link, the merchant upload form driven like a merchant (no file, a program posing as a PDF, a real PDF), manager and agent role boundaries, no uncaught browser exception, no external call, no message sent. The Messaging Inbox payload in that run is fixture-supplied and proves how the client renders a failed source and Retry, not what the live reader returns.
- Static: migration integrity (no migration was added), queue compliance, CSRF fetch scan, outbound compliance scan passed. Both new certifications and the browser certification are registered in the disposable runner roster and the CI suite manifest.
- Known baseline failures, unrelated and present before this work: `test-task2056-crm-ui-contracts`, `test-crm-operator-experience`, `test-lead-ops-budget-removal`, and the `server/db.ts` line 174 type error. A whole-project type check was not run.

**Unchanged controls.** No code path in this repair enables a provider, sequence, campaign, SMS, GHL write or booking, and none changes the global outbound pause or the five-class receipt capability; the certifications assert that nothing is sent and that receipt effect rows are untouched by retry. A production readback of those controls is a post-Publish step and has not been done.

**Rollback.** Redeploy the previous build; there is no schema change. Removing `statement-upload` from the `.replit` profile returns the previous (failing) behaviour, so rollback would reintroduce the defect.

**Not verified.** Any deployed behaviour; the production serving identity after Publish; the production state of 269B66AF; real merchant browsers other than Chromium; the live Messaging Inbox reader.

**Remaining gates (pending; none are claimed).** Owner Publish of the current build, which also delivers the `.replit` profile change; confirm the serving identity and the unchanged controls read back; recover 269B66AF only through the admin recovery route with its full request identifier, without resending its receipt and without creating a replacement submission, then confirm its review task and notification exist and its CRM projection stays held; leave 0A900C02 unrecovered until the owner decides; the review links are `/dashboard/lead-ops?tab=pipeline&ref=269B66AF`, `/dashboard/tasks-appointments?tab=tasks`, `/dashboard/notifications`, `/dashboard/comms-hub` and `/dashboard/ghl-integration?tab=settings`.

### Website intake and CRM handoff repair — Publish verification and recovery of occurrence 269B66AF (2026-11-08; direct owner request; follows the 2026-11-07 repair entry)

**Serving identity.** After the owner Publish, the unauthenticated health endpoint of the production site reported source commit `d041c5c6` built 2026-11-08 13:00 UTC with `env: production`. That commit holds the full repair, including the `statement-upload` group in the `.replit` background profile; the platform's "Published your App" commit above it carries no file changes. The statement-recovery route answers an unauthenticated POST with 401 (present and guarded), and the production `worker_heartbeat_statement-upload` heartbeat is current (13:40 UTC on the recovery day) and its worker consumed the recovered command, so the narrow queue capability is live.

**Controls read back, read-only, before and after recovery.** The global outbound pause is still `paused` at epoch 1 (committed 2026-08-15, unchanged). The receipt capability setting is unchanged since 2026-11-07 20:22 UTC: enabled, the same five classes. No `communication_events` rows were created after 13:30 UTC on the recovery day. No `ghl_projection_operations` rows exist for the contact, and the review task has no GHL task id, so nothing was written to GHL and the CRM projection stayed held. No provider, sequence, campaign, SMS, booking or paid call was started by this work.

**Recovery of 269B66AF.** Before: request `failed` with `STATEMENT_COMMAND_QUEUE_UNAVAILABLE`, its command `recoverable_failed` with zero attempts, four held review effects, no task, no notification, the receipt effect `sent` (attempt 1, 2026-11-07 20:21 UTC). Action: one admin-authenticated, CSRF-protected `POST /api/lead-ops/inbound-requests/269b66af-…/statement-recovery`. Result: `outcome: recovered`, `queued: true`, no queue code. After, read back from production: the same command row `succeeded` after one attempt with the stored statement document attached; the request is `review_required`; review task 7072 ("Review statement", pending, normal priority, due 2026-11-11 17:00 UTC, no deal, no GHL id) is linked to the request; exactly one internal management notification exists (unread); the SLA effect and statement-review effect are `sent` as internal authority only; assignment remains held (`UNASSIGNED_POLICY_MISSING`, no assignment policy recorded; the task is unassigned until a manager takes it); the receipt effect's state, attempt count and timestamp are exactly as before. One `statement_occurrence_recovered` audit row records `receiptTouched: false` and `replacementSubmissionCreated: false`. The Inbound Operations list returns the occurrence by its short reference with the task link, and the 7-day summary reads received 7, needs review 5, statement attention 3.

**Left as found.** Occurrence 0A900C02 (failed, `STATEMENT_COMMAND_QUEUE_UNAVAILABLE`, command `recoverable_failed`) was reported only and not recovered, pending the owner's decision; the two other `recoverable_failed` statement commands are untouched. No receipt was resent, no replacement submission was created, and no historical receipt was replayed.

**Not verified.** The signed-in screens were not rendered in a browser against production (production sign-in is not available to the capture tool); the data behind them was read through the authenticated list and summary routes and direct production reads. Task assignment, the statement analysis result and any contact with the merchant are manager work and have not been done.

**Rollback.** Unchanged: redeploy the previous build. The recovery created a task, a notification, a stored document link and one audit row for a real submission; they can stay or be archived through the normal task and notification controls, and nothing external depends on them.

**Remaining gates.** Owner decision on 0A900C02 and the other two failed statement commands; a manager takes task 7072 and reviews the statement; the owner sets an assignment policy if automatic assignment is wanted. Review links: `/dashboard/lead-ops?tab=pipeline&ref=269B66AF`, `/dashboard/tasks-appointments?tab=tasks`, `/dashboard/notifications`, `/dashboard/comms-hub` and `/dashboard/ghl-integration?tab=settings`.

### W-A Public Truth and Terms — equipment, statement fee handling, timing, zero-percent program, integrations and competitor pricing (2026-11-08; project task "W-A Public Truth and Terms"; source and fixture receipt, not published)

**Serving identity.** Candidate is the working tree on `f20104fa` (not committed by this work; 43 tracked files changed, 8 new files). It was built with `npm run build` and served only from an isolated preview (disposable database and Redis, no provider calls). Nothing was published and the live site is still on the previously published build. The full record, the LI-W evidence table, the owner-evidence register, the competitor price table and the census are in `docs/LIBERTY_W_A_PUBLIC_CLAIMS_RECORD.md`.

**What changed.** A typed claim register now governs the wording of equipment and contract terms, statement fee handling, timing and funding, the zero-percent program, integration compatibility and competitor prices. A claim shows only when approved with an evidence key held in a server-only register; the equipment "no upfront" placement claim and the volume threshold are withheld, and 30 earlier assertions are retired with approved fallbacks. React pages, server-rendered pages, navigation, footers, metadata and structured data read the same selectors. Fixed here: the month-to-month and no-ETF assertions beside a footer that says early termination fees may apply, 48-hour, same-day, one-business-day and next-day windows (including the site-wide Organization schema), invented Liberty markups and savings ranges, the retired Square rate (2.6% + 10¢, now the dated list rate 2.6% + 15¢ in person), "never shared" statement handling text, the legality opinion and dollar math on the zero-percent page, the 20+ platform count and lock-in claims on Integrations, and the internal margin and payback tables that were publicly visible on the terminal shop page. Competitor prices are 12 dated, source-cited records checked 2026-11-08; Toast shows no rate because none is published. Route URLs, `offer=free-terminal`, `?terminal=yes` and the "Free Smart Terminal" label are unchanged.

**Test receipts by layer.**
- Source/fixture: `scripts/test-public-claims-contract.ts` 664 assertions and 31 negative controls passed, also with `PUBLIC_CLAIMS_REQUIRE_BUNDLE=1` against a fresh build (the server-only evidence register is absent from the client bundle); registered in the pre-deploy mandatory suites and the CI manifest (`ci-suite-manifest.ts --check` valid). `test-public-route-validation.ts` 12 passed. Production build succeeded. A focused type check over every changed file found no errors in changed code; a whole-project type check was not run.
- Browser (Chromium, lab, dev server and isolated preview): mobile gate across the owned routes and the other edited pages at 320, 390, 768, 1024 and 1440 px, light and dark where stated in the record: no overflow and no failure in changed markup; `/integrations` contrast defect caused by this work fixed and re-verified. Overlay check 22 probes, 0 failed. Fonts check 25 of 26 routes ok. Performance (CPU x4, 1.6 Mbps, cold cache, median of 5): the eight measured routes are within the 2.5 s LCP and 0.1 CLS budgets and comparable to a baseline measured from a `git archive` snapshot of `f20104fa`. One rendered-output scan of 22 routes and a follow-up grep found five remaining universal next-day funding statements (site-wide Organization schema description and service offer, Why Liberty schema description, Help Center funding FAQ, Free Analysis badge), all fixed.
- Baseline, not introduced here: a layout shift of about 0.23 on `/industries/retail-payment-processing` in the fonts check (present with the `f20104fa` Industry page and intermittent), small tap targets on `/integrations` and `/beat-square-stripe`, and contrast and tap targets on the `/merchant-application` stepper.

**Unchanged controls.** No setting, schema, migration, journal, lockfile, dependency or theme change; no `statement_auto_analysis_enabled` or other setting write; no GHL, provider, paid, Gmail, message or booking call; the global outbound pause and every provider and sequence control are as found. The Terms, Privacy, Advertising Disclosure, Merchant Policies, Refund and Security pages were not edited.

**Rollback.** Revert the changed source files to `f20104fa` and redeploy; there is no schema, data or setting change. Reverting restores the contradictory and unsupported claims listed above. Never delete submissions or receipts as part of a rollback.

**Not verified.** Anything on the deployed site; Safari/WebKit and real devices (WebKit cannot run here, and Chromium cannot reach port 6000); field performance; receipt delivery, native booking, GHL and advertising behavior; the legal, contractual and operational facts that the withheld and fallback wording still depends on.

**Remaining gates (pending; none are claimed).** Owner Publish of a build containing this work, then a read of the health endpoint to compare the served source to the tested candidate; the owner evidence in section 4 of the record (agreement and equipment terms, inventory and placement rights, fulfillment capacity, funding availability, acquirer program rules, integration test evidence, statement retention and AI disclosure, case releases, image rights, PCI attestation) so held claims can be approved; W-B (shared footer and navigation consumption, Home sections), W-C (quiz and offer flow, statement-upload states, consent placement) and W-D (long-tail pages: blog, help-center articles, glossary, case studies, asset pages, testimonials, location pages, partner and affiliate talking points, free-analysis guarantee page, `/merchant-application` stepper styling, tap targets) handoffs listed in the record.

### W-A Public Truth and Terms — post-Publish read-back (2026-11-08; follows the W-A source and fixture entry above)

**Serving identity.** After the owner Publish, the unauthenticated health endpoint of the production site reported source commit `1a90e734`, built 2026-11-08 17:52 UTC, `env: production`, publish build `f8e627db`. That commit is an ancestor of the current main head (`d7066e8b`, "Published your App"), contains the claim register, the server-only evidence register and the contract suite, and the only later difference is a memory note. The published source therefore equals the tested candidate.

**Live read-back (read-only; unauthenticated GETs of public pages in a private Chromium with analytics, marketing and third-party scripts blocked).** After hydration, the page text, title, meta description and every JSON-LD block of 18 routes were searched for the retired assertions (month-to-month, no-ETF, ownership, no-lock-in, 48 hours, same-day, one-business-day, all-50-states, never-shared, the retired Square rate, invented Liberty markups and savings ranges, free/no-upfront equipment, contract-term assertions, next-day funding, internal margin tables, Review/AggregateRating schema, evidence-register markers): `/`, `/free-smart-terminal`, `/upload-statement`, `/0-percent-processing`, `/integrations`, `/compare/square`, `/compare/stripe`, `/compare-rates`, `/beat-square-stripe`, `/faq`, `/get-started`, `/shop`, `/free-analysis`, `/about-contact`, `/why-liberty-bancard`, `/savings-calculator`, `/merchant-application`, `/industries/retail-payment-processing`. Zero matches on all 18. A raw-HTML pass over 13 of the same routes found the same except one server-rendered "Next-Day Funding" card on `/why-liberty-bancard`, which hydration replaces; it is on the W-D list. `/free-smart-terminal` and `/shop` are served as the client shell (no server-rendered body), so their wording is only visible after hydration.

**Not verified.** Safari/WebKit and real devices; field performance; signed-in screens; receipt delivery, native booking, GHL and advertising behavior; the production state of the outbound pause, receipt capability and provider controls (a post-Publish read-back of those controls was not done by this work and no code in it changes them); the legal, contractual and operational facts that the withheld and fallback wording depends on.

**Rollback.** Unchanged: revert the changed source files to `f20104fa` and redeploy; no schema, data or setting change.

**Remaining gates.** The owner-evidence items in section 4 of `docs/LIBERTY_W_A_PUBLIC_CLAIMS_RECORD.md` so held claims can be approved; the W-B, W-C and W-D handoffs in that record; a controls read-back after this Publish if the owner wants one recorded.

### W-B Design and Responsive Layout with post-Publish review corrections (2026-11-08; follows the W-A post-Publish read-back above)

**Source and build identity.** Base `2a3671a6` plus uncommitted working-tree changes; production build `a60d049d-cf77-4d8a-a995-72b5aa84ddd0`; Node v22.23.4, npm 10.9.9 (project pins 10.9.4). No dependency, schema, migration, setting or data change. Full detail: section 7b of `docs/LIBERTY_W_A_PUBLIC_CLAIMS_RECORD.md`.

**Review corrections.** R01: the promotion banner, list, inline and card variants, their Free Analysis and shop consumers and the retained shop equipment and fee assertions read the approved shared claims; `FREE30` remains only in the link and attribution. R02: every comparison table, FAQ, JSON-LD block and server summary keeps the product, plan, channel and rate qualifier with its rate; Authorize.net All-in-One and Gateway Only are separate records. R03: the shared statement, program FAQ, schema and Home and program consumers say credit-card surcharging does not apply to debit or prepaid cards and keep cash discount separate; the register has an official-source entry. R04: the record, ledger, spec and roadmap carry these receipts.

**W-B design.** B1: one shared server-shell stylesheet and menu model for every server page; the server-only comparison and switch pages no longer render the logo at its intrinsic 3,360 px width; link and button colors moved to token colors that meet contrast. B2: `/free-smart-terminal` call-to-action buttons wrap at 320 px and at 200% zoom. B3: Integrations and Beat Square/Stripe targets are at least 44 px. B4: palette extension (navy, red, light surface), shared navigation, `/industries` hub, rebuilt Home and About and Contact, no new promotion or price. B5: product images served as derivatives (about 2.1 MB to 16-66 KB on initial load for the three product pages; `/shop` 792 KB to 45 KB); shell logos at 420 px (about 8 KB instead of about 75 KB twice per server page; `/alternatives/square` document 218,909 to 47,804 bytes).

**Verification.** Contract suite 18 families, 938 assertions, 90 negative controls, 0 failures (plain and with the bundle required); suite manifest, image pipeline (13 sources) and route validation pass; production build succeeds. On an isolated production-profile preview (Chromium): strict design check 320 probes, 0 failed; mobile gate at 320/390/768/1440 across 27 gated routes (108 states) and 28 more routes (112 states), 0 findings; overlay 22 probes, 0 failed; fonts 27 routes ok; SEO audit passed. Matched lab performance (baseline `2a3671a6` versus candidate): 14 of 15 routes within the LCP and CLS budgets; `/faq` is over the LCP budget on both builds in that session (host-load spread, carried to W-D). A focused type check of the changed files shows only errors that exist at the base; a whole-project type check was not run.

**Not verified.** Safari/WebKit and real devices; dark color scheme beyond the default gates; field performance; signed-in screens; live form submission, receipts, booking, GHL and advertising behavior; the production outbound pause and provider controls (untouched). The owner Publish has not happened, so no deployed-UI read-back exists yet.

**Rollback.** Revert the 7b source files to `2a3671a6` and redeploy; no schema, data or setting change.

**Remaining gates.** Owner Publish, then a read-only read-back (health source commit; shop, comparison, program FAQ and server and mobile shell); W-C and W-D handoffs and the owner-evidence items in the record.

### W-B Public Shell and Hubs (2026-11-09; follows the W-B design section above)

**Source and build identity.** Base `4f8fdf16` (`4f8fdf163079905ad702650fa8f5d79ff402c492`) plus uncommitted working-tree changes; production-profile preview build `61d8d77e-5309-481f-9243-b3561b966176`; Node v22.23.4, npm 10.9.9 (project pins 10.9.4). No dependency, lockfile, schema, migration, setting, data, content-security-policy or provider change; the only routing change is sitemap and SEO entries for the two new public routes. Full detail: section 7c of `docs/LIBERTY_W_A_PUBLIC_CLAIMS_RECORD.md`.

**Delivered.** `/payment-processing` and `/pricing-and-programs` (one shared content module for the server and React renders; commercial wording only from the W-A claim records). Industries hub heading with all 14 industry routes preserved. Header: Solutions to `/payment-processing`, Pricing & programs to `/pricing-and-programs`, Help under Resources, utilities Support, Account sign in (`/login`) and Partner sign in (`/partner-login`), Talk to Liberty in the bar from 400 px and in the Menu drawer below that; the server header uses a no-script disclosure menu. Home sections in one contract order in both renders. About and Contact server render with a stable `#inquiry` anchor, no form and no "Call/Text" label. Curated footer (Staff Login and the old Partner Portal Login replaced by the two sign-in entries). Glossary hub and term pages on the shared shell (one main, one h1) with their own same-origin font faces. The glossary is server-only (no client route), so the hydrated header, drawer and footer link to it with native anchors; real clicks from hydrated pages to the hub and a term page are proven. Public tokens single-sourced; CRM tokens untouched. Field-services slot is an icon tile. The performance gate counts an invalid measurement as a failure.

**LI-W evidence.** LI-W01 (`/` offer hierarchy): shell contract (section order in both renders, claim-backed review and equipment text), design gates clean. LI-W08 (`/about-contact`): phone 954-266-8214 and support@libertybancard.com from one shared module, `#inquiry` present, no form; response time and hours remain unstated until the owner confirms them. LI-W22 (footer and partner utility): curated footer and the Partner sign in entry proven by contract and by the role-flow browser test; `/partners` page wording was not changed in W-B.

**Verification.** Claims contract 959 assertions, 93 negative controls, 0 failures; new public shell contract 113 assertions, 21 negative controls, 0 failures; the three new suites are registered in the pre-deploy roster and the CI manifest (`ci-suite-manifest.ts --check` valid). Role-flow proof on a disposable database and Redis with the compiled client and real pointer input: 16 receipt groups passed (both utilities reach the real sign-in forms; wrong passwords create no session; admin, merchant and partner password sign-in land in `/dashboard`, `/dashboard/merchant-portal` and `/partner-portal`; the public shell is absent on destinations and restored on the next public page; 390, 430 and 320 px menu behavior; OS and stored dark mode; static glossary pages). Development server, Chromium: shell design 78 states, mobile gate 310 states, strict design 425 probes, overlay 22 probes, fonts 31 routes and `seo-audit` all clean. Isolated production-profile preview on port 6100: shell design 58 states, strict design 390 probes, overlay 22 probes and fonts 31 routes clean; mobile gate 310 states with 290 clean and 20 findings, all on the two glossary routes that the isolated preview does not serve (clean on the development server and on the compiled build in the role-flow fixture). A focused type check shows only errors that exist at the base; a whole-project type check was not run.

**Performance.** 10 routes, 5 cold-cache runs each, 0 invalid measurements; 9 inside the 2.5 s LCP and 0.1 CLS budgets (`/payment-processing` 1124 ms, `/pricing-and-programs` 932 ms, `/about-contact` 924 ms, `/` 1748 ms). `/faq` is over the LCP budget (4576 ms), as in the previous W-B session; carried to W-D. No baseline build was served, so comparison with earlier figures is indicative only.

**Deviations.** Home review card body stays claim `offer.review.short`; the equipment note is a disclosure sentence plus an equipment claim; image provenance stays "unverified" (open owner licence item); the overlay probe that targeted the removed Staff Login now targets the last footer link (same intent).

**Not verified.** Safari/WebKit and real devices; field performance; production sign-in and form submission; receipt delivery, native booking, GHL and advertising behavior; the production outbound pause and provider controls (untouched). The owner Publish has not happened, so no deployed-UI read-back exists yet.

**Rollback.** Revert the 7c source files to `4f8fdf16` and redeploy; no schema, data or setting change.

**Remaining gates and handoffs.** Owner Publish, then a read-only read-back (health source commit; the two new pages, Industries, About and Contact, `/learn` and a term page at 390 and 1440 px). W-C: the `#inquiry` mount point and Contact labels. W-D: Why Liberty team photo, long-tail editorial and proof publication, the `/faq` first-paint spread. Owner: image licence evidence, an approved founder portrait, and wording for SMS, hours or response time.

### W-C Forms and CRM Handoff (2026-11-09; follows the W-B Public Shell and Hubs section above)

**Source and build identity.** Base `fe4ae7f8` (`fe4ae7f8448eae2c42a63a77292beec5f98ab1f3`) plus uncommitted working-tree changes (39 tracked files changed, 12 new); production build identity `fe4ae7f8` (the artifact records HEAD, not the dirty tree); Node v22.23.4, npm 10.9.9 (project pins 10.9.4). No dependency, lockfile, schema, migration, setting, data, CSRF, `.replit` or provider change. Full detail, route inventory, request contracts and the release checklist: `docs/LIBERTY_W_C_INTAKE_AND_HANDOFF_RECORD.md`.

**Delivered.** (1) `/free-smart-terminal`: every primary, eligibility, card and final call to action opens a no-statement equipment inquiry; an offer section carries the approved equipment-terms disclosure beside the call to action; the existing product derivatives stay with an honest equipment-options note (provenance still unverified; no image invented). (2) `/get-started?offer=free-terminal` (and `?terminal=yes`): the short terminal inquiry; the generic six-step quiz is untouched without a mode. (3) `/about-contact#inquiry`: the short general or new-business inquiry; the secure application stays the next stage and `MerchantApplication.tsx` is untouched. (4) `/upload-statement`: form first, both `#upload-form` and `#statement-review-form` reach and focus the form, phone and industry optional end to end, formats stated as PDF, JPG or PNG up to 10 MB, strict bounded multipart fields, semantic fingerprint with legacy replay. (5) `/support`: no attachment picker, no text-message requirement, no response-time promise, sensitive statements pointed to the protected statement form, per-effect resumable executor (one ticket, one comment, one notification, original receipt on retry). (6) Staff handoff: the two new modes and support appear in Lead Ops with the frozen intent, protected document access without a deal, correctly addressed notifications; the statement handoff view reports held, manual review and unavailable states truthfully with Retry (it previously filtered audit actions that are never written and treated held steps as success). (7) Mobile Menu focus (WB-PV01): focus returns to the Menu button after Escape or close, `aria-expanded` and `aria-controls` accurate, navigation focuses the destination `<main>`. (8) Receipt kept until the status read confirms it, per-form intent storage, no key rotation after an ambiguous response.

**Source-policy and fingerprint decision.** `website_form|equipment_inquiry` and `website_form|general_inquiry` exist in the current (v3) contract only, as sales requests with the existing sales effects, added to the sales recovery list and deliberately **absent from the website warm lane**, so there is no nurture, requested-follow-up or promotional admission; support has its own executor. New statement requests use a plain 64-hex v2 semantic fingerprint (the `v2:`-prefixed first attempt failed the `inbound_requests.request_fingerprint` CHECK and was replaced by hashing the version into the digest); legacy fingerprints still replay.

**LI-W evidence.** LI-W02 (hardware visual and terms): source complete with the equipment-options fallback; approved hardware depiction is an owner-evidence item. LI-W04 (ad click to short terminal path): source and browser proof; paid-traffic landing check belongs to the ads owner. LI-W05 (statement form-first): source, API cert and browser proof. LI-W07 (booking): `/book` preserved and untouched; native booking receipt and routing need separately authorized marked-contact acceptance (not done). LI-W21 (support): source, API cert and browser proof; hours and response expectations await the owner. LI-W23 (new-business inquiry): source, API cert and browser proof. LB-FT-01 to FT-03, LB-SR-01 to SR-05 and LB-C-01: intake behavior covered by the same suites.

**Verification.** W-C API/handler cert on a disposable database and Redis with real multipart, fake transports and egress denied: 169 checks. W-C mounted browser acceptance with the production build, real pointer input, 320/390/768/1024/1440 px, light and dark, keyboard, native 200% browser zoom (device pixel ratio 2, 720 CSS px), Back/Forward, reload, request to task to protected document for admin, manager and agent, plus anonymous public journeys: 231 checks. Existing website intake handoff 116 and mounted browser 140; claims contract 960 assertions with 93 negative controls; `test-cro05a-static` 21, `test-consent-unchecked-not-optout` 4, `test-public-route-validation` 13, Stage 3 C3 contracts 211, D-R2 contracts 58; Stage 4A retired pilot routes, public shell contract and role-guard smoke pass; inbound acknowledgement, statement-upload queue capability, Stage 5 fresh inbound and intake recovery, Stage 3 B intake and A authority, merchant outbox handoff and the ready-held consumer contract pass; `ci-suite-manifest.ts --check` valid (261 suites; both new suites registered in the pre-deploy roster and the manifest); API coverage shows no new uncovered endpoint; `seo-audit` passes (it caught a 166-character `/support` description during the work; shortened to 150); `git diff --check` clean; production build succeeds.

**Performance.** Matched baseline and candidate, isolated production-build preview, 390 x 844 at DPR 2, CPU x4, 1.6 Mbps and 150 ms, cold cache, 5 runs per route, 0 invalid in either matched run. Candidate versus baseline LCP: `/free-smart-terminal` 1044 versus 1008 ms, `/get-started?offer=free-terminal` 980 versus 884 ms, `/upload-statement` 980 versus 1168 ms, `/about-contact` 916 versus 712 ms (all within budget). `/support` is over the LCP budget in **both** builds (3020 versus 3084 ms): not task-caused, not relabelled green. Candidate CLS on `/free-smart-terminal` is 0.045 against 0.0001 (within the 0.1 budget; cause not isolated). Later reruns on the same host were invalid for both builds and are excluded. Lab fixture timings, not field performance.

**Baseline failures (reproduced at the base commit, not introduced).** `test-statement-acquisition` (two step-7 "held" assertions), `test-crm-operator-experience`, `test-task2056-crm-ui-contracts`, `test-lead-ops-budget-removal`, `test-consent-field-protection` (foreign-key cleanup on the shared development database). Not run: `test-forms` (needs the GHL fail-fast server) and whole-project type check (kill line).

**Deviations and decisions.** Existing static tests coupled to moved code were updated, not loosened. The status read treats 404, 409 and a failed read as "unresolved", never as permission to clear the saved intent. The statement form follows the same rule: only a pre-claim refusal releases its key; a server fault, key conflict or lost answer keeps it, a changed detail or file is held back until the visitor starts a new request, and a fault in optional bookkeeping after acceptance still returns the accepted receipt. Merchant and partner fixtures were not run as separate actors in the new certs; they are refused by the same admin and manager gates.

**Superseded W-B statements (kept above for history).** "About and Contact server render with a stable `#inquiry` anchor, no form" and the W-C "`#inquiry` mount point and Contact labels" handoff are now delivered: the anchor hosts the inquiry form. The W-A and W-B statements that `/free-smart-terminal` leads to `/upload-statement?offer=free-terminal` and starts with a statement upload are superseded by the no-statement inquiry path. Any earlier support response window (4 hours, 1 hour, 24/7) is retired.

**Not verified.** Deployed UI (the owner Publish has not happened); production `/api/health`; real submissions, receipt delivery and inbox arrival; native booking, GHL, advertising and outbound behavior (untouched and not exercised); Safari/WebKit and real devices; signed-in CSRF for public submits (middleware unchanged, no new case); browser zoom above 200%.

**Rollback.** Revert the changed source files to `fe4ae7f8` and redeploy; no schema, data or setting change. Never delete submissions, tasks, tickets, receipts or protected files. Compatibility limits: occurrences created under the two new sources or the v2 fingerprint are not understood by the older build (labels and recovery), so do not run the older build's recovery over them; rollback also restores the 4-hour support promise and the statement-first terminal path.

**Remaining gates and handoffs.** Owner Publish, then the read-only checklist in the record (health source commit; the five changed routes at 390 and 1440 px; Menu focus; first-party `/book`; signed-in request, task or ticket, notification and protected-file readback if an authorized fresh submission exists, otherwise production end-to-end acceptance stays pending). Owner evidence: approved hardware depiction and image rights, support hours and response expectations, retention wording. W-D: long-tail response-time wording (Help Center, chat widget, Asset page and similar), the `/faq` and `/support` first-paint spread.


### W-C closure correction pass (2026-11-10; follows the W-C section above; published as `87159c74cb4ca9bfb6ed88fc263e44fd09600dad`, see the next section)

Source: the W-C post-publish audit of 2026-11-09. Full record: `docs/LIBERTY_W_C_INTAKE_AND_HANDOFF_RECORD.md` section 17.

**Identity.** Serving `532a8b56015127ffb31ef9dd2d4bd1d0ddba7ac9` (built 2026-11-09T21:27:55.713Z, publish build `70e570f7-a89e-407c-8943-29a4752e057d`, re-read 2026-11-10); GitHub main `63b9e6f7a2edacaff4b4dea7770d9ea472b31772` with an identical tree. The corrections are a working tree on `63b9e6f7`: 15 modified and 2 new source and test files. No commit was made by this work (the platform checkpoint makes it). Tested-tree digest `2cd4d65cee8b5b3ecd7170c76d6506f98814f053bd75a78947f0bc19e7fa7aa5` (SHA-256 of `git diff HEAD --binary -- client server shared scripts` plus each untracked file in those roots, rule in the record). The suites ran on that tree after a fresh build, not on the serving commit.

**Corrected.** WC-PV01 both statement fragments in the server HTML plus one shared anchor helper that scrolls under the fixed header and focuses the form heading on a lazily rendered page; WC-PV02 terminal heading, intro, title and description from one shared module read by the server renderer and the React page for `?offer=free-terminal` and `?terminal=yes`; WC-PV03 a stored pending upload is restored as an unconfirmed request with the same key after a reload; WC-PV04 statement analysis wording derived from each upload's own evidence ("Analysis result not recorded for this statement" when none exists); WC-PV05 public-form controls 48 px and actions 52 px, scoped to the public theme.

**Evidence.** Failing before at the base source: API cert five failed sections, browser suite eight (four anchor sections, hydrated terminal step, sizing, reload during upload, analysis wording). Passing after: API cert 294, browser 404 (Chromium), website intake handoff 116 and 140, claims contract 960 assertions and 93 negative controls, shell contract 113 and 21, cro05a 21, route validation 13, role guards 1/1, manifest valid (267 classified, 261 mandatory), API coverage 882 endpoints and 1,807 handlers, SEO audit 424 routes passed, production build, `git diff --check` clean, `.replit` and package files unchanged. Whole-project type check not run (standing instruction); changed-file diagnostics clean. Added isolated coverage for six signed-in actors submitting public support requests with and without a CSRF token (policy unchanged), CSRF negative controls, and merchant, partner and affiliate refusals on the staff surfaces.

**Record corrections.** Support notifications carry no typed contact or ticket target and link to Inbound Operations (`/dashboard/lead-ops?tab=pipeline&ref=<REF>`); admin and manager recognize the event. The original browser cert did not assert direct-anchor focus; the original record's "Not published", signed-in CSRF and merchant/partner coverage statements are corrected in place.

**Production walkthrough (read-only, 2026-11-10).** One administrator sign-in, session confirmed twice, GET requests only, metadata-only read-replica queries. Request `269B66AF`: row, source, lifecycle `review_required`, assignment held (`UNASSIGNED_POLICY_MISSING`), due 2026-11-11 17:00 UTC; task 7072 pending and linked; management notification 5002 unread with the Inbound Operations link; protected document 1077 present with empty size and type metadata (observed, not investigated); handoff list four occurrences, three needing attention; summary 7 / 5 / 3 / 0 as in the audit. The audit's browser bounce to login is not reproduced and not explained; the sign-out confirmation line was not captured. No production statement row has a deal, so the occurrence-bound wording is not observable live.

**Not closed.** W-C is not labelled fully closed until the owner publishes the corrected build and the post-publish read-back in the record (health commit, first HTML for both entrances, real-browser fragments, new analysis wording, control heights) is recorded. Chromium only; WebKit and real devices not exercised; the upload-hold fault simulates an in-flight transfer rather than aborting a real connection. The earlier-review observation about a direct, confirmed JSON-form save clearing the stored intent is repaired in the next section. No send, setting change, auto-analysis enablement, GHL write, new submission, historical-command recovery, reclassification, schema or dependency change was made.


### W-C second closure correction (2026-11-10; follows the closure correction above; published as `8dd9e26ca0b03a7f76230847ddba98d4510325dc`)

Source: `attached_assets/Liberty-W-C-Closure-Verification-2026-11-09_1794278816886.md`. Full record: `docs/LIBERTY_W_C_INTAKE_AND_HANDOFF_RECORD.md` section 18. WC-PV01, WC-PV02, WC-PV03 and WC-PV05 stay as repaired and were re-run; only two items were finished. #2150 and W-D are separate and untouched.

**Identity.** Serving `87159c74cb4ca9bfb6ed88fc263e44fd09600dad` (built 2026-11-10T01:57:58.106Z, publish build `612af1d2-8f51-4dc9-b97e-c3e294d51c2d`, read from `/api/health` on 2026-11-10); GitHub main `b5c01724791bd403b8285d6054e13bef73e0233d`, tree `b84351eb32eb911cb7986599c3ce16fe79ba5633`. The candidate is a working tree on `b5c01724`: 18 modified files and 1 new source file; no commit was made by this work. Tested-tree digest `59791cd576fa5315a3c0d38909b6d2b10903536a6ccdfecc3a1428666dc1a607` (rule in the record; it replaces the earlier digest). Published identity: `/api/health` returns `8dd9e26ca0b03a7f76230847ddba98d4510325dc` (the platform checkpoint of the candidate), built 2026-11-10T03:59:21.987Z, publish build `f1a030be-5ae4-419a-8413-5bc77efaf32d`; the later "Published your App" commit `8198ab1ec2a0aaa506999b462cfa3d76c9dae3ae` has an identical tree. Recomputing the digest from the range `b5c01724..8dd9e26c` reproduces `59791cd5...1a607` exactly, so the published tree is the tested tree. The first sentence of this paragraph describes the serving build before this publish.

**Corrected.** (A) WC-PV04: the deal's analysis status only records that the deal blueprint finished, so it never completes a statement; only an analyzer result record that names the upload's document does, a document-bound failure record reads failed even when the deal says complete, the newest record per deal and document decides, and the worker now writes the document id on its failure record. No stored row is rewritten. (B) A confirmed direct save is retained in the tab as identity and state only (key, request hash, receipt, pending-review state, once-per-receipt conversion claims; no personal details, notes or file bytes); a reload, Back or Forward restores the original reference and the pending-review wording; the same details replay under the same key; only Send another starts a new request and then creates exactly one new occurrence; conversions and thank-you page views fire once per receipt. Covers equipment and general inquiry, support, estimate, get started and the home, bubble and help-panel callbacks.

**Evidence.** Failing before (base sources restored, same new tests): the confirmed-save cert section failed at its first check, the browser suite failed six steps (four confirmed-save flows, the estimate/get-started restore, the analysis wording), and the base analysis files failed three sections of the worker-bound analysis cert. Passing after: API cert 415 checks, browser (Chromium) 440 checks, website intake handoff 116 and 140, claims contract 960 assertions and 93 negative controls, shell contract 113 and 21, CRO-05A static 21, route validation 13, role guards 1/1, manifest valid (261 mandatory), API coverage 882 endpoints and 1,807 handlers, SEO audit passed, production build, `git diff --check` clean, `.replit` and package files unchanged. Whole-project type check not run (standing instruction); changed-file diagnostics clean. Real isolated coverage: the real client library driven in Node against the real handlers with a recording fetch and lost-answer mode, the real worker job with a loopback fake OpenAI transport, and a real browser with a recording analytics stub and public-POST counter.

**Published read-back and limits.** Read-only public checks after the Publish matched: health identity, the live entry assets equal the tested build's, the confirmed-save chunks are served with the new text, and first HTML carries the terminal H1 for `?offer=free-terminal`, the generic H1 for `/get-started`, and both statement fragments plus the form heading id. Not observed live: restore after a real submission (none authorized), live real-browser fragment, focus and control-height checks, staff analysis wording through Inbound Operations and the handoff panel (no signed-in session opened; no production row has a deal), and the audit's login bounce (unreproduced). Chromium only in the suites; WebKit and real devices not exercised; the help-center callback panel and the unmounted floating callback bubble are covered through the shared storage slot and source, not a browser. Observed and left unchanged: the analyzer returns normally after recording a failure, builds its OpenAI client without an explicit base URL, and the blueprint generator swallows errors. No send, setting change, auto-analysis enablement, GHL or booking write, new submission, historical recovery, reclassification, schema or dependency change was made.

### W-D content, media and acceptance (2026-11-10; follows the W-C second closure correction above; candidate prepared, not published)

Source: `attached_assets/Liberty-W-D-Content-and-Acceptance_1794335430673.md`. Full record: `docs/LIBERTY_W_D_CONTENT_AND_ACCEPTANCE_RECORD.md` (20 sections). W-A, W-B and W-C behaviour is untouched except where the record lists an intentional existing-suite update.

**Identity.** Serving build read at preflight: `8dd9e26ca0b03a7f76230847ddba98d4510325dc` (built 2026-11-10T03:59:21.987Z, publish build `f1a030be-5ae4-419a-8413-5bc77efaf32d`); GitHub main `8198ab1ec2a0aaa506999b462cfa3d76c9dae3ae`, tree `f85cac8aef4bab1550cbd716d99300a54013cd01` (identical to the serving tree). The W-C second closure correction above is therefore published, not pending. Local `main` was two documentation and memory commits above that (`b821c9d6dd91e7e5b190358bf567c51174bd6627`, tree `3c8ac43f…`), and those two commits were local only; nothing here claims an earlier blocked documentation push landed. The candidate is an uncommitted working tree on `b821c9d6`: 91 modified, 39 deleted and 139 new paths, of which 115 are image files. Tested build `d7848507-8c92-4af0-b230-f0e77eb1b7e8`; tested-tree digest `ba2121f325382745444e0db22004a08cce8f4998fb2b94170184e21b86a17d74` (rule in the record, section 1). No schema, migration, dependency, lock-file or `.replit` change.

**Delivered.** (A) 330 location URLs now serve one shared contract in both renderers: a hub per city, a detail page per vertical, a unique first paragraph and fact list built only from approved claims, no invented counts, populations, rates, addresses or testimonials; unknown keys stay an empty-body 404 and the sitemap keeps all 330. (B) All 14 industry pages read one content contract in both renderers; healthcare is a text page with no unlicensed photograph. (C) Proof: the shipped proof register is empty on purpose, so case studies, testimonials and Why Liberty render an honest "understand your process" fallback, with no review, video or aggregate schema. (D) Editorial reconciliation of the glossary (61 terms), Help Center, blog and FAQ: superseded figures and guarantees removed or conditioned on the written agreement; both renderers agree. (E) Imagery: 13 masters with 102 responsive derivatives replace the old photographs, recorded `generated` and `owner-review-pending`; the 1.7 MB Why Liberty photograph and a decorative Support photograph are gone. (F) A Home hero and payment-context section per the owner's copy, and the 24 LI-W rows reconciled with a state and open input each.

**Evidence.** Performance on matched builds (throw-away copy of the base commit against the candidate, five runs, median): every route that was over budget on the base commit is repaired: `/faq` 4540 to 1048 ms LCP, `/help` 3908 to 860, `/support` 3028 to 936, `/why-liberty-bancard` 7172 to 904 (a 1.7 MB photograph replaced by 30 KB of derivatives) and the `/free-analysis` layout shift from 0.108 to 0.011; the FAQ, Help and Support cause was a scroll-reveal fade on the hero text that kept the browser from counting it as the largest paint until the web font loaded. Sub-second differences on routes whose code did not change are run-to-run variation. `/alternatives/square` reads INVALID in the harness on every build (no `main` element); measured by a copy of the harness it is 184 to 200 ms. Census of all 541 sitemap URLs, a 78-check visual probe, and a strict mobile visibility gate (31 routes, three widths, light and dark, 186 states) found no contrast, nested-control, overflow or heading failure after two real findings were fixed (touch targets on `/areas-served`; a trailing full stop in a heading). The static contract suites for locations (18 assertions, 25 negative controls), industries (15, 24), content (38, 24) and media (23, 41), the claims contract (1023, 93), the shell contract (114, 21), security controls, D-R2 (59 checks), CRO-05A (21 checks), the image builder check, the manifest check and API coverage (882 endpoints, 1807 handlers) pass. Isolated stack: role guards 171 of 171, Stage 5 public journey 34, W-C intake certification 415, public shell browser 16 receipt groups, W-C intake browser 440. **The SEO audit found a real regression during acceptance:** 75 of 430 routes failed because the new location titles with the brand suffix exceeded 70 characters; one shared rule now adds the suffix only when the whole title fits, and the audit passes (430 routes, 0 failed). The five legacy suites from the archived task fail identically on the base commit (stale source-text assertions in the task 2056 CRM, lead-ops budget and CRM operator suites, and two held-send assertions in statement acquisition after the analysis queue reported unavailable) or cannot run in the isolated stack (consent field protection is unregistered); none was repaired or relaxed. Focused diagnostics show only three errors that exist on the base commit.

**Published read-back and limits.** Nothing was published and no deployed URL was opened; the read-back is the owner's step after the normal Publish (record section 17), and publication alone is not an acceptance verdict. Chromium only; WebKit and real devices were not exercised. Performance was measured on build `cbfd5173-cb0a-447c-88e9-03793f70435d`; the final build differs by three small edits (touch-target classes, one heading full stop, the location title rule) and was not re-measured. The glossary pages were verified on the development application, not in the isolated preview, which does not register them. Observed and left unchanged: the glossary renders raw `**bold**` and `- ` list markers in some definitions, and four public pages carry a different `h1` in the server and hydrated documents and a few titles differ (record section 13.1), and 33 of the 60 glossary term pages show literal `**` characters because definitions are escaped as plain text. The tracker workbook was not available and was not edited (exact amendment in section 18). No founder portrait, healthcare photograph or customer case was invented; those stay truthful fallbacks. No send, setting change, activation, provider or GHL call, production write, schema or dependency change was made. Rollback is the working-tree differences from `b821c9d6` (no schema), or the previous platform checkpoint.


### W-D post-Publish corrections WD-PV01 to WD-PV09 (2026-11-11; follows the W-D content, media and acceptance section above; candidate prepared, not published)

Source: `attached_assets/Liberty-W-D-Post-Publish-Audit-and-Corrections-2026-11-11_1794397511125.md`. Full record: `docs/LIBERTY_W_D_CONTENT_AND_ACCEPTANCE_RECORD.md`, section 21. Earlier W-A, W-B, W-C and W-D entries are not rewritten; the sentences in them that are no longer current are listed in section 21.5 of the record.

**Identity.** Serving build read 2026-11-11T13:57:56Z: `2361f342984e5b8dba2a4c3d7ef987b51db017e0` (built 2026-11-11T00:04:22.465Z, publish build `881f7a78-379a-44f6-bb06-de2d109d6cb8`); it still prints literal `**` on `/learn/ach-payment`. GitHub main `d5571065` holds the existing glossary repair. Local HEAD `966994f29c50fe321671f644202a6331955b57ca` is `d5571065` plus two local commits present before this pass: `5d3f9283` (title and `h1` parity for four routes) and `966994f2` (a ZeroBounce spend-gating change that is not part of this pass and rides along in any Publish). The candidate is an uncommitted working tree on `966994f2`: 23 modified and 5 new files under `client`, `server`, `shared` and `scripts`; tested-tree digest `26c453386594fcd4a1d212ced5306560935ba1f107cbf2c815bad7235c7034f6` (rule in record section 1). Final build `c8e37ef8-9487-4f6a-9a50-30d88d21339f` (`npx --yes npm@10.9.4 run build` on Node v22.23.4). No schema, migration, dependency, lock-file or `.replit` change.

**Delivered / corrected.** PV01: Home hero actions stay inside the copy column at intermediate widths and the Home `h1` is painted in IBM Plex Sans in the React hero and both server emitters. PV02: the calculator requires the visitor to choose the quote basis (all-in, markup over pass-through costs, or not sure); a markup quote needs the card-network costs, no average is estimated, and incomplete input shows "Comparison incomplete" with no total or saving. PV03: no new formatter; the existing repair is in the tree and ships with the next Publish. PV04: the public application scopes 48 px fields, 52 px actions and 44 px checkbox rows without changing the shared Input. PV05: four-route parity kept, hydrated titles aligned, `Vary: User-Agent` on `/free-smart-terminal`, `/blog` and `/blog/:slug`, and an 18-route parity script. PV06: unknown dynamic URLs answer 404 with a branded, noindex, no-echo document shared by the server and the React page. PV07: the SEO audit is driven by the emitted sitemap (541 URLs plus 16 code routes), rejects titles over 70 characters in every family, and five titles plus glossary descriptions and alternatives/switch-from social tags were corrected. PV08: not reproduced; no repair; a speculative font preload was removed. PV09: Worldpay and Gravity copy made neutral and plan-specific.

**Evidence.** Chromium and the development application on the final tree: content contract 60 assertions and 46 negative controls, claims contract 1,023 and 93, parity 18 routes with 11 controls, SEO audit 557 routes, fonts 31 ok, new browser check 111 ok (hero geometry and hit tests from 320 to 1440 px and at doubled text size, calculator, application sizes at 320, 390, 768 and 1280 px plus dark and doubled text, not-found pages), 61 glossary documents with no literal `**`. Production-profile preview: 10-route performance gate with 0 over budget and 0 invalid (Home LCP 1,148 ms, `/faq` 980 ms, `/faq` CLS 0.0014). PV08 comparison on matched builds (390 px, CPU x4, 1.6 Mbps, cold cache, sequential): Home LCP medians 1,188 ms baseline against 1,328 and 1,348 ms candidate; FAQ CLS about 0.0015 in every profile; the audit's FAQ CLS 0.118, Home LCP 4,988 ms and duplicate hero entry did not reproduce.

**Published read-back and limits.** Nothing was published, activated or sent, and no deployed page was measured; the read-back is the owner's step after the normal Publish (record section 21.6: `/api/health` must include `d5571065`; `/learn/ach-payment` has no literal `**` once the document cache lifetime has passed), and publication alone is not an acceptance verdict. Chromium only; WebKit, real devices and field performance were not exercised, and the audit's field numbers stay unverified. Source, fixture, browser, deployed, data, receipt, native booking and GHL, and advertising verdicts are kept separate in record section 21.6. No outbound unpause, worker selection, provider enablement, GHL write, email or SMS, or old-submission recovery occurred, and the CRM and outreach are not claimed active. Rollback is the working-tree differences from `966994f2` (no schema), or the previous platform checkpoint.

**Published read-back (2026-11-11, after the owner's Publish; supersedes the "not published" statements above).** Record section 21.7. Production `/api/health` at 2026-11-11T15:53:29Z: sha `5f72226c36c4c0ad310bb23d58f18a87f2d7042c` (built 2026-11-11T15:51:34.926Z, publish build `f3a76517-3f65-4f7a-9671-73ab43cb7505`), which contains `d5571065` and carries the ZeroBounce commit `966994f2` disclosed above; the committed source roots reproduce the tested-tree digest `26c45338…`. Read-only checks on `https://libertybancard.com` (Chromium and HTTP, nothing submitted, no provider, GHL, email or SMS call): all 61 glossary documents have no literal `**` in first HTML or rendered text; the 111-check browser script passes on production; parity 18 of 18 routes and `Vary: Origin, User-Agent` on the three branched route families; seven unknown dynamic URLs answer 404 with a branded, noindex, no-store body that does not echo the path; the SEO audit passes on the second run (557 routes, 541 of 541 sitemap URLs, 88 of 88 hydrated pages) after a first-run miss on the `/data-processing-agreement` hydrated-metadata check that three direct loads did not reproduce; the Worldpay, glossary and Gravity wording is live. Lab performance on production (Chromium, phone profile, not field): 10 routes within budget, Home LCP 2,360 ms (median 2,024 ms widgets blocked, 2,160 ms allowed in the cause probe), CLS at most 0.0157, hero fetched once; the audit's FAQ CLS 0.118, Home LCP 4,988 ms and duplicate hero were not observed, so PV08 has no demonstrated cause and no repair, and field performance is not established. Not verified: WebKit, real devices, screen readers, later application steps with real data, signed-in surfaces. CRM, outreach, outbound, GHL, receipts and booking were not touched and are not claimed active.
