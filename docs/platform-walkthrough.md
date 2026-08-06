# Liberty Bancard AI BOS — Platform Walkthrough
### End-to-End Business Operations Reference

> **How to use this document.** Every claim below is sourced from the running codebase.
> File paths, function names, and queue intervals are exact. Nothing is paraphrased from
> documentation that doesn't exist. This is the ground truth of how the system runs.

---

## Table of Contents

1. [What This Platform Is](#1-what-this-platform-is)
2. [How a Lead Enters the System](#2-how-a-lead-enters-the-system)
3. [Automatic Enrichment & Scoring](#3-automatic-enrichment--scoring)
4. [The SDR AI Layer](#4-the-sdr-ai-layer)
5. [Outbound Sequences — The Full Library](#5-outbound-sequences--the-full-library)
6. [Statement Upload & Analysis](#6-statement-upload--analysis)
7. [Proposal & Closing](#7-proposal--closing)
8. [Merchant Boarding (Payarc)](#8-merchant-boarding-payarc)
9. [Merchant Onboarding Checklist](#9-merchant-onboarding-checklist)
10. [Live Merchant Account Management](#10-live-merchant-account-management)
11. [Residuals & Commission Payouts](#11-residuals--commission-payouts)
12. [Partner & Agent Program](#12-partner--agent-program)
13. [The Background Job Backbone](#13-the-background-job-backbone)
14. [Compliance Layer — What Blocks a Send](#14-compliance-layer--what-blocks-a-send)
15. [Admin Operations & Dashboards](#15-admin-operations--dashboards)

---

## 1. What This Platform Is

Liberty Bancard is a payment processing ISO. The business model is:

1. **Acquire** merchants who process credit cards.
2. **Earn** a monthly residual (a cut of interchange) on every dollar those merchants process.
3. **Retain** merchants long enough that the lifetime residual value exceeds acquisition cost.
4. **Scale** by building a network of agents and partners who refer merchants in exchange for a commission split.

This platform automates the entire sales and operations cycle — from the moment a prospect hits a landing page to the day a live merchant's residual hits the ledger.

---

## 2. How a Lead Enters the System

### 2a. Public Forms (website)

All public intake routes live in `server/routes/public.ts` and `server/routes.ts`. Every route applies `publicLeadRateLimit` before touching the database.

| Route | What it does |
|---|---|
| `POST /api/public/statement-upload` | Visitor uploads a processing statement. Creates/reuses contact, runs the full statement analysis chain, auto-enrolls in **Free Analysis Follow-Up** sequence (9 steps), fires a GHL confirmation workflow, scores the contact. |
| `POST /api/public/free-analysis` | Short form — name, email, business. Creates/reuses contact, scores, routes offer, enrolls in inbound confirmation sequence. |
| `POST /api/public/estimate` | Rate estimate form. Creates contact, opens a sales deal immediately, fires notifications and GHL workflow. |
| `POST /api/public/get-started` | General inquiry form. Intake, score, route. |
| `POST /api/public/callback` | Request a call back. Intake, score, creates callback task for assigned rep. |
| `POST /api/public/support` | Support request. Routes to merchant support queue. |
| `POST /api/affiliate/signup` | Partner/agent application. Creates contact as partner candidate, tags in GHL. |
| `POST /api/affiliate/referral` | Referral link attribution. Ties merchant contact to referring partner. |

### 2b. The Canonical Writer — `writeContact()`

**Every** contact creation goes through `server/services/contact-writer.ts:125` — there is no bypass. It:

1. Validates the source combination (22 allowed source/category pairs: `statement_upload`, `estimate_form`, `csv_import`, `ghl_sync`, `sunbiz_corevt`, `discovery`, `partner_referral`, etc.).
2. Chooses a GHL mode: `ghl_upsert_first` (forms), `ghl_inbound_no_echo` (GHL webhooks), or `local_only` (imports).
3. Runs an atomic DB transaction: inserts `contacts` row, inserts `contact_source_events`, updates `primarySourceEventId`, writes `contact_created` audit log.
4. Captures full provenance: sourceCategory, sourceType, eventKey, importExecutionId, row number, row fingerprint, actor type/id, UTM/form metadata.
5. Enqueues `requestContactLeadScoring(..., "contact_created")` immediately after commit.

If GHL contact creation fails, the contact is still written locally and marked `ghl_sync_pending` for retry.

### 2c. CSV / Registry Import

`POST /api/admin/registry-import` — admin-only, multipart file upload.

The import worker maps CSV columns to contact fields, runs `writeContact()` for each row with `sourceType: "csv_import"`, deduplicates by email on conflict, and records an `import_executions` row for full provenance history. Row-level errors are captured without aborting the batch.

### 2d. Sunbiz / Business Registry

Florida Sunbiz records are ingested via `server/services/sunbiz-cron.ts`, triggered every 24 hours by BullMQ. Records that match heuristics for high-value merchant verticals get converted to contacts via `writeContact({ sourceType: "sunbiz_corevt" })`. The conversion cron also runs opportunistically at the end of every sequence worker tick.

### 2e. GHL Inbound Webhooks

`server/routes/ghl-webhooks.ts` receives:
- `conversation.created` → `handleConversationCreated()` in `server/services/sdr/chat-handlers.ts`
- `inbound_message` (SMS/email/chat) → `handleSmsThread()` / `handleEmailThread()` / `handleChatMessage()`
- `contact.updated` → syncs GHL field changes back to local DB, preserving Liberty Bancard compliance fields (never overwritten by GHL)
- `opportunity.updated` → syncs deal stage changes from GHL

Webhook authenticity is verified with `GHL_WEBHOOK_SECRET` on every request.

### 2f. Outscraper / Apollo / Apify Discovery

`server/services/sdr/orchestrator.ts` can trigger enriched prospect discovery via external scrapers (Outscraper, Apollo, Apify). Discovered contacts use `sourceType: "discovery"` and are immediately scored and offered.

---

## 3. Automatic Enrichment & Scoring

Everything in this section runs automatically — no rep action required.

### 3a. Lead Scoring

`server/services/contact-scorer.ts` — `requestContactLeadScoring()` enqueues a BullMQ job. The scorer evaluates:

- **Contactability signals**: email validity, SMS consent tier, PEWC status
- **Business signals**: volume estimate, vertical, Sunbiz data, enrichment depth
- **Behavioral signals**: form type, statement upload, engagement history
- **Recency**: days since last contact, sequence activity

Score is written to `contacts.leadScore`. High-score contacts trigger hot-lead notifications to assigned rep and Slack.

### 3b. ZeroBounce Email Validation

Runs lazily at sequence step execution time (not on intake). The sequence worker checks `contacts.email_status`:
- If `unknown` and within the daily ZeroBounce budget: calls the API, writes result back.
- `invalid` / `unsafe` / `do_not_mail` / `abuse` → sequence pauses, contact flagged.
- Provider API errors are non-fatal — sequence continues.

Reps can view the full ZeroBounce history on the contact detail page. Manual batch validation is available at `POST /api/contacts/validate-emails` (admin/manager).

### 3c. Business Enrichment

`POST /api/contacts/enrich` triggers `server/services/enrichment-worker.ts`. Fetches:
- Sunbiz business entity data (registered agent, address, status)
- LinkedIn profile (optional, rate-limited)
- General web enrichment (Serper/Apify)

Results write to `contacts` fields and `contact_enrichment_events` table. The worker has re-entrancy flags to prevent OOM on large batches.

### 3d. Offer Routing

`POST /api/contacts/:id/route-offer` — `server/services/offer-router.ts`.

Classifies the contact into an offer path:
- `zero_percent` (surcharge/cash discount — merchant pays 0%)
- `interchange_plus` (transparent cost-plus pricing)
- `flat_rate` (simple predictable rate)

Decision factors: vertical, estimated volume, current processor detected, risk profile. Route is written to `contacts.offerRoute` and visible on the contact card.

---

## 4. The SDR AI Layer

The SDR AI is a coordinated system — not a single chatbot. It handles inbound responses, generates outbound messaging, classifies intent, and decides when to hand off to a human rep.

### 4a. The Orchestrator — `server/services/sdr/orchestrator.ts`

The orchestrator is the decision engine. For each lead in the SDR pipeline it evaluates:

1. Current lifecycle stage (`DISCOVERED → ENGAGED → OUTREACH_CHAT → PROPOSAL → CLOSED`)
2. Last inbound message intent classification
3. Sequence enrollment status
4. Statement upload status
5. Rep assignment and availability

It decides: enroll in a sequence / send a direct message / create a manual task / escalate to human / do nothing.

### 4b. Reply Intelligence — `server/services/sdr/reply-intelligence.ts`

Every inbound message (SMS, email, GHL chat) is classified before any response is generated.

Intent categories:
- `already_have_provider` — merchant mentions a current processor (Square, Stripe, Clover, Toast, Heartland, Worldpay, Chase, etc.) → triggers objection-handling path
- `interested` — positive buying signal → fast-tracks to statement request
- `not_interested` — objection → enters objection crusher sequence or marks DNC
- `out_of_office` / `wrong_number` — contact handling, delays follow-up
- `question` — routes to AI answer generation
- `unsubscribe` / `stop` → immediately opts out, writes to audit log, halts all sequences

Classification uses regex pattern matching (`server/services/sdr/reply-intelligence.ts:188`) plus GPT-based fallback for ambiguous messages.

### 4c. AI Chat — `handleChatMessage()`

When a chat message arrives via GHL:

1. Validates GHL webhook signature
2. Checks if lead is human-owned (if so, skips bot — never interrupts a live rep conversation)
3. Builds conversation history (last N messages from `sdr_message_log`)
4. Runs `analyzeForHandoff()` — determines if the conversation needs a human
5. If handoff: creates task for rep, transfers GHL conversation owner, stops bot
6. If continuing: `classifyMessageIntent()` + `generateSmartReply()` using GPT with vertical-aware system prompt
7. Sends reply via GHL chat API

### 4d. AI SMS & Email Threads

Same pattern as chat: `handleSmsThread()` and `handleEmailThread()` in `chat-handlers.ts`. Both:
- Log the inbound to `sdr_message_log`
- Check for sequence reply (marks the enrolled step as responded)
- Run intent classification
- Generate vertical-aware reply
- Send via GHL SMS or email API

### 4e. Sales Prep AI — `POST /api/contacts/:id/sales-prep`

On-demand endpoint. Given a contact, generates a full GPT-powered sales brief:
- Business profile summary
- Detected current processor and likely pain points
- Recommended offer path with rationale
- Opening pitch script tailored to the vertical
- Objection responses pre-loaded

Written to `contact_sales_prep` table. Reps open this before any live call.

### 4f. Operator Digest — `server/services/sdr/operator-digest.ts`

Sent to admin email every morning (BullMQ daily cron, 3 AM). Contains:
- New leads by source
- Sequence performance (sent/opened/replied)
- Hot leads requiring human action
- Stalled deals
- GHL sync status
- Circuit breaker state

### 4g. The Business Vault — `server/services/business-vault.ts`

A library of AI-powered pitch assets and competitive intelligence. Used by the AI reply generator and sales prep to inject:
- Vertical-specific value propositions
- Competitive comparisons (Square, Stripe, Clover pricing teardowns)
- Gateway compatibility notes (Authorize.net, USAePay)
- Objection response templates
- Program descriptions (zero percent, interchange plus, flat rate)

---

## 5. Outbound Sequences — The Full Library

The sequence system runs on BullMQ at **30-second ticks in production** (`queue-manager.ts:75`). Every tick: acquire distributed job lock → load all active enrollments → execute due steps → advance.

### 5a. The 60+ Sequence Library

Sequences are seeded from `server/data/seeds/sequences.json`. Current library:

**Core Sales Sequences (manual trigger)**
| Sequence | Steps | Purpose |
|---|---|---|
| Switch & Save — Statement Audit | 8 | Primary pitch: we'll audit your statement and show you savings |
| Fast Approval — Application Completion | 4 | Pushes prospects through the application |
| Trust Builder — Authority Sequence | 6 | Social proof and credibility building |
| Objection Crusher — Overcome Hesitation | 6 | Handles stall/hesitation objections |
| Contract Escape — Switch Help | 5 | For merchants locked in contracts |
| Reactivation — Cold Lead Revival | 5 | Re-engages cold prospects after 60+ days |

**Education Sequences (manual trigger)**
| Sequence | Steps | Purpose |
|---|---|---|
| Payment Stack 101 | 4 | Teaches the merchant how payments work |
| Surcharge & Cash Discount — Compliance | 4 | Explains the zero-percent program legally |
| Security & PCI Compliance | 4 | PCI education, positions Liberty as expert |
| Chargeback Defense | 6 | Chargeback education + our services |
| Funding Speed & Reliability | 4 | Next-day funding positioning |
| POS vs Terminal — Decision Guide | 4 | Helps merchant choose hardware |
| Liberty Smart Terminal — Product Showcase | 4 | Feature walkthrough |
| Text-to-Pay & Payment Links | 4 | Virtual/remote payment options |
| Omnichannel — Online + In-Person | 5 | Multi-channel merchant pitch |
| Recurring Billing — Subscription Merchants | 5 | Subscription billing pitch |

**Vertical Playbooks (manual trigger — FL-specific)**
| Sequence | Steps | Vertical |
|---|---|---|
| FL Auto Repair — Vertical Playbook | 6 | Auto repair shops |
| FL Med Spa — Vertical Playbook | 6 | Med spas |
| FL Medical/Dental — Vertical Playbook | 6 | Medical/dental practices |
| FL Construction — Vertical Playbook | 6 | General contractors |
| Retail Merchants — SDR Outbound + Drip | 6 | Retail |
| Auto Merchants — SDR Outbound + Drip | 6 | Auto dealers |
| Medical & Med Spa — SDR Outbound + Drip | 6 | Medical/med spa |

**SDR AI-Driven Sequences (manual trigger — AI handles sends)**
| Sequence | Steps | Purpose |
|---|---|---|
| SDR: Cold Outbound — Auto Repair | 11 | Full cold outbound for auto repair vertical |
| SDR: Cold Outbound — Med Spa | 11 | Full cold outbound for med spa vertical |
| SDR: Cold Outbound — Dental | 11 | Full cold outbound for dental vertical |
| SDR: Cold Outbound — Construction | 11 | Full cold outbound for construction vertical |
| SDR: Reply Engaged | 7 | Follow-up when prospect has replied |
| SDR: Statement Chase | 8 | Persistent statement request sequence |
| SDR: Proposal Follow-Up | 7 | Post-proposal nurture |
| SDR: No-Show Recovery | 7 | After missed appointment |

**Post-Call Sequences (trigger: call_outcome)**
| Sequence | Steps | Purpose |
|---|---|---|
| Post-Call Review Follow-Up | 4 | After any completed call |
| Proposal Follow-Up | 4 | After proposal is sent |
| No-Show Reschedule | 3 | Reschedule after missed call |
| Long-Term Nurture | 4 | Low-urgency, multi-month nurture |
| Voicemail Follow-Up SMS | 1 | Immediate SMS after a voicemail drop |

**Trigger-Based Sequences (auto-enrollment)**
| Sequence | Trigger | Purpose |
|---|---|---|
| Free Analysis Follow-Up | `form_submitted` | Auto-fires when visitor submits statement/free analysis form (9 steps) |
| Inbound Confirmation | manual | Confirms receipt of inbound inquiry |

**Vertical-Specific Full Playbooks (V-series)**
The V-series covers 8 verticals × 3 tracks = 24 sequences (Retail, Auto, Medical, Med Spa, Dental, Auto Repair, Salon, Construction):
- `V-[Vertical]: SDR Outbound Prospecting` — 3 steps, cold outbound
- `V-[Vertical]: Inbound Lead Nurture` — 3 steps, warm inbound follow-up
- `V-[Vertical]: Account Management Ops` — 3 steps, post-boarding retention

**Referral Sequence**
- `Referral Flywheel — Merchant to Merchant` — 5 steps, turns live merchants into referrers

**Core Sales (short form)**
- `Switch & Save (Core Sales)` — 3 steps, condensed pitch

### 5b. Pre-Enrollment Gates (in order)

Before any contact is enrolled, `autoEnrollFromTrigger()` checks:

1. Contact exists and is not `doNotContact`
2. Consent tier is not `opted_out` or `do_not_contact`
3. Sequence `eligibleConsentTiers` allows this contact's tier (null = all allowed)
4. Sequence `lifecycleStagesAllowed` matches (null = all allowed)
5. No existing active or completed enrollment in this sequence
6. Channel contactability check: if sequence declares `triggerConfig.outboundChannels`, those are authoritative; otherwise derived from step action types. Every declared channel must pass `evaluateContactability()`.

### 5c. Per-Step Execution Gates (in order, every tick)

For each due enrollment step:

1. **Global kill switch** — `outboundGlobalPaused = true` → pause all (admin setting)
2. **Reply-stop check** — if contact replied STOP after enrollment, mark completed
3. **GHL contact sync** — ensures GHL contact ID exists; failure pauses
4. **Cold email daily cap** — reads `outboundDailyEmailCap` (default 200); warmup ramp 20→50→100→250; defers at cap
5. **Email bounce/validity** — hard bounce / invalid / unsafe status → pause
6. **ZeroBounce lazy check** — validates unknown email status, budget-limited
7. **SMS PEWC gate** — SMS steps for `cold_no_consent` / `warm_no_pewc` tiers skip the step (not pause), advance to next
8. **Suppression gate** — `opted_out` / `unsubscribed` / hard bounce / spam complaint → pause
9. **Gate (b) — channel enforcement** — maps step action type to contactability channel, runs enforcement; denial audits and pauses
10. **Email channel pause gates** — `emailChannelPaused` / `coldEmailChannelPaused` system settings
11. **Idempotency** — `hasSentStep()` prevents duplicate sends
12. **CAN-SPAM footer** — cold outreach email steps only: requires `compliance_mailing_address` system setting + unsubscribe token secret; missing either pauses and audits

### 5d. Removing a Contact Mid-Enrollment

Reps can now cancel a live enrollment via `DELETE /api/contacts/:id/sequences/:enrollmentId`. The enrollment is marked `cancelled` with an audit log entry. The sequence worker skips cancelled enrollments on the next tick.

---

## 6. Statement Upload & Analysis

The statement is the core sales tool. A prospect's processing statement proves the savings Liberty Bancard can deliver.

### 6a. Intake

**Public upload**: `POST /api/public/statement-upload` — the landing page form. Any visitor can drop a PDF/image.

**Rep-initiated**: `POST /api/contacts/:id/request-statement` sends the prospect an email/SMS with a secure upload link.

**Rep upload**: Dashboard file upload via `POST /api/deals/:id/documents` (multipart, stored in `merchant_documents`).

### 6b. The Analysis Chain — `server/services/statement-upload-chain.ts`

`runStatementUploadChain()` is fire-and-forget (started with `setImmediate()`). Progress tracked in `system_settings` key `contacts_deal_backfill_progress`. Steps:

1. **OCR / text extraction** — PDF text or image OCR
2. **Rate detection** — identifies effective rate, interchange categories, fees
3. **Processor identification** — matches processor name/gateway from document text
4. **Volume extraction** — monthly processing volume, average ticket
5. **Savings calculation** — compares extracted rate vs Liberty's offer paths
6. **Deal blueprint generation** — creates recommended deal structure with pricing
7. **GPT narrative** — generates a plain-English analysis summary for the rep

Results write to the `statements` table, linked to contact and deal.

### 6c. Re-analysis

`POST /api/deals/:id/reanalyze-statement` — finds the latest statement document, enforces a 5-minute audit rate limit per deal (prevents hammering), queues the analysis job, returns 202. Reps use this after uploading a corrected statement without re-uploading.

### 6d. Analysis Review in the CRM

`GET /api/deals/:id/analysis` returns:
- Latest statement proposal
- Analysis status (`pending` / `processing` / `complete` / `failed`)
- Whether a statement document exists
- Effective rate, potential savings, recommended program

Displayed on the deal detail page. Used by the rep in every sales call.

---

## 7. Proposal & Closing

### 7a. Co-Branded Proposal

`server/services/co-branded-proposal.ts` — generates a PDF proposal document personalized to the prospect:

- Liberty Bancard + partner/agent co-branding (logo, contact info)
- Statement analysis summary (extracted from their actual statement)
- Recommended program with pricing
- Savings projection (monthly and annual)
- Next steps call-to-action

Sent via email from the deal page. GHL tracks open/click events on the proposal link.

### 7b. Proposal Tracking — `server/services/sdr/proposal-tracking.ts`

Records `proposal_sent` event. Tracks:
- When proposal was sent
- Which rep sent it
- Open events (via pixel or GHL)
- Click events on the DocuSign/agreement link

If proposal is not opened within N days, triggers **SDR: Proposal Follow-Up** sequence automatically.

### 7c. Auto Deal Progression

`POST /api/ai/auto-progress-deals` — runs daily (or on demand). Advances deals automatically through the first 3 pipeline stages when conditions are met:

| From → To | Condition |
|---|---|
| New Lead → Statement Received | Statement document exists on the deal |
| Statement Received → Review In Progress | Statement analysis is complete |
| Review In Progress → Call Booked | Booking confirmed in calendar system |

Stages after that (Proposal Sent → Negotiation → Verbal Commit → Closed Won) require manual rep action.

### 7d. The Sales Pipeline Stages

Full stage order (from `server/routes/deals.ts:563`):
1. **New Lead**
2. **Statement Received**
3. **Review In Progress**
4. **Call Booked**
5. **Proposal Sent**
6. **Negotiation / Follow-Up**
7. **Verbal Commit**
8. **Closed Won** → triggers boarding pipeline

Every stage change syncs to GHL as an opportunity stage update within the same request cycle.

### 7e. SLA Tasks

`server/services/sla-worker.ts` — creates time-bound tasks on deals in specific stages. If a deal sits in a stage longer than the SLA threshold without activity, an alert email is sent and a task is auto-created for the assigned rep. SLA rules are configurable per pipeline stage.

---

## 8. Merchant Boarding (Payarc)

### 8a. What Triggers Boarding

When a deal moves to **Closed Won** via `server/services/deal-stage-service.ts`:
1. An onboarding deal is created in the onboarding pipeline
2. Checklist is initialized
3. GHL merchant welcome email is sent
4. The deal's `boardingStatus` is set to `not_submitted`

Boarding itself is manually triggered by a rep or admin once the merchant application is complete.

### 8b. The Merchant Application

Before submitting to Payarc, the deal must have a complete `merchant_applications` record. Fields required:

- Legal business name, DBA, EIN, business type (LLC/Corp/Sole Prop)
- Business address, phone, email, website
- Vertical / MCC category
- Owner: name, DOB, SSN, address (for KYC)
- Bank: routing number, account number, account type
- Estimated monthly volume, average ticket
- Preferred program (`zero_percent` / `interchange_plus` / `flat_rate`)

### 8c. Submitting to Payarc — `POST /api/deals/:id/submit-to-processor`

`server/routes/boarding.ts` — validation steps before submission:
1. Deal pipeline must be `onboarding`, stage must be `underwriting` or `approved`
2. Deal must not already have `boardingStatus` of `submitted` / `under_review` / `approved`
3. Merchant application must be complete

Then calls `adapter.boardMerchant(profile)` → **Payarc POST /applicants**:
- Builds `buildApplicantPayload()` from merchant profile
- Bearer token auth (`PAYARC_API_KEY`)
- 20-second AbortController timeout
- 1 retry on network error / ECONNRESET
- Simulation mode when `PAYARC_API_KEY` is not set (returns `PAYARC-XXXXXXXX-XXXX` format ID)

On success: writes `boardingStatus=submitted`, `processorApplicationId`, `boardingSubmittedAt`, submission log entry.

### 8d. Status Polling — `POST /api/deals/:id/refresh-boarding-status`

Calls `adapter.getMerchantStatus(applicationId)` → **Payarc GET /applicants/:id**.

Payarc status → local status mapping:
| Payarc | Local `boardingStatus` |
|---|---|
| pending / submitted | `submitted` |
| under_review / in_review | `under_review` |
| approved / active | `approved` → also sets MID, moves deal to Approved stage |
| declined / rejected | `declined` → creates persistent failure alert |
| conditional / more_info | `more_info_needed` → creates info-request task for rep |

Bulk polling: `POST /api/boarding/refresh-all` — processes all `submitted`/`under_review`/`more_info_needed` deals, concurrency 4, returns aggregate results.

Every 4 hours, BullMQ auto-polls `submitted`/`under_review` applications to catch approvals without rep action (`repeatEveryMs: 4 * 60 * 60 * 1000`, `queue-manager.ts:124`).

### 8e. After Approval — the MID

When Payarc approves:
- MID is written to the deal
- `boardingApprovedAt` is timestamped
- Deal stage advances to Approved
- Onboarding checklist `terminal_programming` item is unlocked
- Daily stats polling begins (`getDailyStats` via `POST /api/deals/:id/refresh-mid-stats`)

### 8f. Chargebacks — `submitChargeback()`

`POST /api/deals/:id/chargeback` → `adapter.submitChargeback()` → **Payarc POST /disputes**.

Fields: MID, transaction ID, amount (converted to cents), reason, card brand, case number, response deadline, evidence notes. Returns Payarc `caseId`.

---

## 9. Merchant Onboarding Checklist

### 9a. Stage Keys

Defined in `shared/schema.ts` as `MERCHANT_ONBOARDING_STAGE_KEYS`. Stages tracked:

- `merchant_agreement` — signed merchant processing agreement
- `void_check` — bank account verification
- `photo_id` — owner ID verification (KYC)
- `business_license` — business license document
- `terminal_programming` — hardware or gateway configuration
- `first_batch_processed` — first live transaction confirmed
- `training_completed` — rep-confirmed merchant training

### 9b. Auto-Initialization

When a deal moves to **Closed Won**, `deal-stage-service.ts` calls `storage.initializeMerchantOnboardingStages()`. All stage items are created with status `pending`.

Admin and managers can request (`requested`), mark received (`received`), approve (`approved`), or reject (`rejected`) each item. Reps can update status to `in_progress`.

### 9c. First Batch — NPS Trigger

When the `first_batch_processed` stage is marked `complete` (`server/routes/onboarding-stages.ts:99`), the system automatically sends a Day 1 NPS survey to the merchant. This is the first retention signal.

### 9d. Onboarding Board

`GET /api/onboarding-board` — returns all onboarding-pipeline deals with their checklist completion percentage, stage, assigned rep, and any overdue items. Displayed as a Kanban board for the operations team.

---

## 10. Live Merchant Account Management

### 10a. MID Performance Dashboard

Once a merchant has a live MID:

- `GET /api/deals/:id/mid-stats` — last 30 days of daily volume, transaction count, average ticket (pulled from Payarc `getDailyStats`)
- `GET /api/mid-stats/pipeline-summary` — aggregated across all live MIDs: per-MID volume trend, sparkline
- `GET /api/mid-stats/summary` — latest row per unique MID, used for residual reconciliation

Stats are refreshed manually via `POST /api/deals/:id/refresh-mid-stats` or via the nightly MID ingestion job.

### 10b. Residual Reconciliation Loop

Every confirmed residual import automatically reconciles against live MIDs. If a MID is in the import but has no deal match, it's flagged `unmatched` and the admin sees it in the import review screen.

### 10c. Merchant Portal

Merchants can log in and view:
- Their application status and boarding stage
- Checklist item status
- Chargeback cases (MID + case summary from Payarc)
- Their assigned rep contact info

`server/routes/merchant-portal.ts` enforces ownership: merchants can only see their own data (`isAuthenticated` + deal ownership check).

### 10d. NPS & Retention Signals

Beyond the Day 1 NPS:
- Re-engagement sequences (`Reactivation — Cold Lead Revival`) target merchants who have gone quiet
- Chargeback defense content is auto-triggered when a chargeback case is opened
- `Long-Term Nurture` sequence keeps Liberty top-of-mind for stable merchants

---

## 11. Residuals & Commission Payouts

### 11a. Import Flow

`POST /api/residuals/import` (admin/manager) — accepts CSV or XLSX.

Column detection is automatic (`detectColumnMap()`) — recognizes MID/account, merchant name/DBA, volume, gross residual, net residual regardless of column order or header naming.

For each row:
1. Matches against `merchant_profiles` by MID
2. Matches against `deals` by linked MID
3. Looks up `agent_merchants` for rep attribution
4. Computes expected residual (from `deal.estimatedNetProfitMonthly` or last month's actual)
5. Calculates variance percentage — flags if outside threshold (default 5% / $50)
6. Tags as `in_range` / `under` / `over`

### 11b. Review & Confirmation

Import lands in `pending` state. Admin reviews the match report:
- Matched rows (deal + agent identified)
- Unmatched rows (MID in import but no deal — orphaned merchant)
- Flagged rows (variance outside threshold)

Manual match: `PATCH /api/residuals/imports/:importId/rows/:rowId/match` — links an unmatched row to a deal, recomputes variance, updates the import aggregate.

`POST /api/residuals/imports/:id/confirm` — locks the import and:
1. Creates `merchantResiduals` records for all matched rows
2. Computes agent commission: `max(0, netResidual × agentSplitRate%)` (default 50%)
3. Computes partner commission: `max(0, grossResidual × partnerOrgRate%)` (default 10%)
4. Emails variance alerts to admin for flagged rows (first 10 shown in HTML email)
5. Marks import confirmed with timestamp and confirming user

### 11c. Partner Residual View

`GET /api/residuals/by-partner` — grouped report:
- Gross residual, net residual, partner commission per partner org
- Active merchant count per partner
- Sorted by net residual descending

Used in the partner portal and the admin partner leaderboard.

### 11d. Import History

`GET /api/residuals/imports` — full history with status, month, totals, variance counts. Each import is auditable: matched, unmatched, flagged, total rows, confirmed by whom. Task #1226 (just merged) added the history tab to the admin UI.

---

## 12. Partner & Agent Program

### 12a. Partner Types

- **Agent** — individual sales rep, earns commission on their own closes
- **Partner Organization** — company or team that refers merchants, earns org-level residual split
- **Affiliate** — tracks referral clicks and form submissions, earns flat or percentage bounty

### 12b. Tier Badges

`client/src/pages/dashboard/ReferralProgram.tsx` — four tiers based on confirmed active merchants:
- **Bronze** — entry level
- **Silver** — 5+ active merchants
- **Gold** — 15+ active merchants
- **Platinum** — 30+ active merchants

Tier determines residual split rate in the payout calculation.

### 12c. Partner Portal

Each partner org has a page at `/partner-org/:slug` — now protected by authentication (Task #1225). Partners see:
- Their active merchant roster
- Monthly residual earnings
- Tier status and progress to next tier
- Referral link (for affiliate tracking)
- Commission history

### 12d. Partner Leaderboard

Admin dashboard shows top partners by converted merchants, gross residual, and net residual. `convertedAt` timestamp on each deal-agent link feeds the leaderboard query (`server/routes/partners.ts`).

### 12e. Referral Attribution

`POST /api/affiliate/referral` — when a referred merchant submits a form, the affiliate ID is captured from the URL query param, written to `contacts.referredByPartnerId`, and tracked in `affiliate_clicks`. Commission is attributed at residual confirmation time.

---

## 13. The Background Job Backbone

All scheduled work runs through BullMQ on Redis. No `setInterval` or `cron` outside BullMQ (GHL sync has a legacy fallback only as a startup safety net).

### 13a. Job Schedule (production intervals)

| Job | Interval | What it does |
|---|---|---|
| `sequences` | **30 seconds** | Process all due sequence enrollment steps |
| `ghl-sync` | **45 seconds** | Sync up to 10 unsynced contacts + deals + tasks to GHL |
| `sla-checks` | **5 minutes** | Check all deals for SLA violations, create tasks/alerts |
| `ai-ops` | **5 minutes** | Run `runScheduledAiOps()` — scoring, offer routing, blueprint generation |
| `boarding-refresh` | **4 hours** | Poll Payarc for status on all pending applications |
| `mid-ingestion` | **24 hours** | Fetch latest daily stats for all active MIDs |
| `daily-outreach` | **24 hours** | Daily outreach prep — contact scoring, hot lead detection |
| `weekly-digest` | **7 days** | Weekly performance digest email to admin |
| `system-audit` | `0 8 * * 1` (Monday 8 AM) | Full system health audit, GPT narrative, delivered to Slack/email |
| `database-backup` | `0 3 * * *` (3 AM daily) | Database backup |
| `enrollment-recovery` | `0 6 * * *` (6 AM daily) | Recover deferred GHL enrollments that failed silently |
| `ghl-enrollment-recovery` | **30 minutes** | Retry transient GHL enrollment failures with backoff |
| `sunbiz-convert` | **every sequence tick** | Convert eligible Sunbiz records to contacts |
| `campaign-queue` | **every sequence tick** | Drain the campaign send queue (bulk outreach) |

### 13b. Distributed Job Lock

`acquireJobLock(jobName, ttlMs)` — Redis-backed mutex. Every job that should not run in parallel acquires this lock. Sequence worker holds the lock for the full tick duration (lockDuration: 120,000 ms). BullMQ `maxRetriesPerRequest: null` is set on all IORedis connections — required to prevent "Command timed out" storms against Upstash.

### 13c. GHL Circuit Breaker

The GHL sync worker maintains `consecutiveGhlFailures`. If 5 consecutive failures occur in one tick (excluding data skips — identity conflicts, "no GHL contact linked", etc.), the circuit opens:
- Current tick aborts
- `GHL_CIRCUIT_OPEN` audit log written
- Alert email sent to admin (task #473 adds this notification)
- Next tick auto-resets the circuit breaker to allow recovery

---

## 14. Compliance Layer — What Blocks a Send

Every outbound communication passes through the contactability engine before any bytes leave the server.

### 14a. `evaluateContactability()` — `server/services/contactability-engine.ts`

Called by the sequence worker, SDR system, and campaign engine before every send. Evaluates:

1. **DNC check** — `contacts.doNotContact = true` → block all channels
2. **doNotAutoContact** — blocks automated sends, allows manual calls
3. **Consent tier** — `opted_out` / `do_not_contact` → block all
4. **Channel-specific**:
   - Email: `email_status` (bounced/invalid/unsafe → block); `optOutStatus = opted_out` → block; `unsubscribeStatus = unsubscribed` → block
   - SMS: `smsStatus = opted_out` → block; PEWC required for FL TCPA and cold contacts
   - Voice AI: `VOICE_AI_ENABLED` flag + consent check
   - Ringless VM: `RINGLESS_VM_ENABLED` flag + consent check
5. **Global kill switch** — `outboundGlobalPaused = true` → block everything

### 14b. PEWC (Prior Express Written Consent)

Florida and TCPA-regulated SMS requires PEWC. `recordPewcDecision()` is the single write path to `contact_pewc_records`. The tier hierarchy:

- `cold_no_consent` — no PEWC, no opt-in. Email and calls only.
- `warm_no_pewc` — organic inbound but no formal PEWC. Email only for SMS sequences.
- `pewc_granted` — full PEWC on file. All channels allowed.
- `opted_out` — do not contact.

### 14c. CAN-SPAM Compliance

Cold email sequences get a mandatory footer injected by the sequence worker (`sequence-worker.ts:831`):

1. Requires `compliance_mailing_address` in system settings
2. Requires `UNSUBSCRIBE_TOKEN_SECRET` env var
3. Generates HMAC-signed unsubscribe token per contact
4. Injects footer with physical mailing address + unsubscribe link
5. Missing either requirement pauses the enrollment and audits `sequence_send_blocked_no_mailing_address`

The `/unsubscribe` endpoint verifies the HMAC token, writes `opted_out` to the contact, and stops all active enrollments.

### 14d. Sender Policy

`server/services/sender-policy.ts` — every email send site passes a `category` field:
- `transactional_merchant` — OK to send from primary domain
- `internal_admin` — digest/alert emails to internal team
- `pipeline_gated` — only sends when the contact is in the SDR pipeline
- `sequence_worker` — governed by sequence compliance rules

The policy registry blocks `noreply@` addresses on Liberty Bancard domains and enforces From/Reply-To rules. 82/82 sender policy checks run in the pre-deploy gate.

### 14e. Compliance Scan in Pre-Deploy Gate

Before every deploy, `scripts/compliance-scan.ts` scans 100% of email/SMS send call sites and verifies each one is in the allowlist or passes the send gate. 114 call sites verified. Any new send call site that isn't registered fails the gate and blocks deploy.

---

## 15. Admin Operations & Dashboards

### 15a. Admin Dashboard — `/dashboard`

Key widgets:
- **Pipeline KPIs**: deals by stage, close rate, average days to close
- **Outreach metrics**: emails sent, sequence enrollment counts, reply rates
- **MID performance**: aggregate processing volume across all live merchants
- **Hot leads**: contacts with high score + recent activity
- **GHL sync status**: last sync, circuit breaker state, unsynced count

### 15b. Outreach Command Center — `/dashboard/outreach`

Global controls:
- `outboundGlobalPaused` toggle — pause all outbound immediately
- `coldEmailChannelPaused` / `emailChannelPaused` — channel-level pauses
- `outboundDailyEmailCap` — cold email volume cap
- Delivery warmup ramp settings (20→50→100→250)
- Per-sequence pause/resume

### 15c. AI Command Center — `/dashboard/ai-command`

Runs AI ops cycles on demand. Each cycle:
- Re-scores all contacts
- Routes unrouted contacts to offer paths
- Generates deal blueprints for deals missing them
- Auto-advances eligible deals

Each run writes an `audit_logs` entry so button shows last run time and run count.

### 15d. System Audit — `/dashboard/system-audit`

Weekly BullMQ job (Monday 8 AM) probes 7 subsystems:
1. Public form endpoints (response time, correct behavior)
2. Database health (row counts, index utilization)
3. GHL sync status (unsynced backlog, circuit breaker state)
4. Sequence worker (last tick time, active enrollments)
5. Email deliverability (bounce rate, complaint rate)
6. Boarding pipeline (pending applications count, stale applications)
7. ZeroBounce budget (remaining validations)

GPT generates a plain-English narrative from probe results. Full report delivered to admin Slack channel and email. On-demand run available from the admin UI.

### 15e. Role Access Model

| Role | Access |
|---|---|
| `admin` | Everything |
| `manager` | Everything except user management and system settings |
| `agent` | Own contacts/deals, sequences (no mass ops, no export) |
| `merchant` | Own portal only (application status, checklist, chargebacks) |

ANON hits any authenticated endpoint → 401. Wrong role → 403. Confirmed by the role-guards smoke test (19 endpoints verified on every deploy).

### 15f. Mobile App — `/mobile`

Full mobile shell for field reps:
- Contact list + search
- Contact detail with deals tab (calls `GET /api/contacts/:id/deals`)
- Create contact (bottom sheet form, posts to `POST /api/contacts`)
- Create deal from contact detail (Task #1223, merged)
- Sequence enrollment from mobile (Task #1223, merged)
- Quick log (activity logging, photo upload admin/manager only)
- Inbox (inbound message thread)
- Outreach stats

---

## Summary — The Sales Process, Start to Finish

```
PROSPECT ENTERS
    ↓
  Public form / CSV import / Sunbiz / GHL webhook / SDR discovery
    ↓
  writeContact() — atomic DB write + GHL sync + provenance capture
    ↓
  Auto-score → offer route → ZeroBounce check
    ↓
QUALIFICATION
    ↓
  SDR AI classifies inbound replies (reply-intelligence.ts)
  SDR AI generates outbound messages (chat-handlers, orchestrator)
  Vertical-specific sequence enrolled (30s BullMQ tick)
  Statement requested / uploaded
    ↓
STATEMENT ANALYSIS
    ↓
  runStatementUploadChain() → OCR → rate extraction → savings calc → GPT narrative
  Deal auto-advances: New Lead → Statement Received → Review In Progress
    ↓
PROPOSAL & CLOSE
    ↓
  Rep runs sales-prep AI brief (vertical pitch + objection responses)
  Co-branded proposal generated and sent
  Proposal tracking fires Follow-Up sequence if no open
  Rep manually advances: Call Booked → Proposal Sent → Verbal Commit → Closed Won
    ↓
BOARDING
    ↓
  Onboarding deal created + checklist initialized + GHL welcome email
  Merchant application completed in CRM
  submit-to-processor → Payarc POST /applicants
  Payarc polls every 4h automatically
  Approval → MID written → daily stats polling begins
    ↓
ONBOARDING
    ↓
  Checklist: agreement → void check → ID → license → terminal → first batch
  first_batch_processed → NPS Day 1 survey
  Account management sequences begin (V-[Vertical]: Account Management Ops)
    ↓
LIVE MERCHANT
    ↓
  Monthly residual import (CSV/XLSX) → match → confirm → commissions
  Agent gets 50% of net residual, partner org gets 10% of gross
  MID stats refresh nightly
  Retention sequences run on engagement signals
  Chargeback defense triggered on new dispute
```

Every step above is automated, gated, audited, and reversible. Nothing skips the compliance layer. Nothing sends without a contactability check.

---

*Generated from live codebase — August 2026*
