# Liberty Bancard Platform — Full Technical Audit Recap
**Generated:** 2026-08-08  
**Purpose:** Comprehensive codebase summary for third-party security/architecture audit  
**Repo root:** `/home/runner/workspace`

---

## 1. Executive Summary

Liberty Bancard is a full-stack merchant-services CRM and sales-automation platform. It serves three classes of users:

| Role | Access |
|---|---|
| `admin` | Full platform control |
| `manager` | Operational access, no user/role management |
| `agent` | Sales rep view — own contacts/deals only |
| `merchant` | Self-service portal — own documents/deals |

Core capabilities:
- **Lead pipeline** — ingest leads from public forms, CSV/Sunbiz registry imports, affiliates, and GoHighLevel (GHL); score and route them through a multi-stage CRM pipeline
- **Outbound SDR automation** — multi-channel sequences (email, SMS, voice AI, ringless voicemail) governed by consent tiers and a contactability engine
- **Merchant onboarding** — application flow → underwriting → document collection → boarding → statement analysis → auto-proposal generation
- **Residuals & partner management** — residual import, partner organization hierarchy, monthly digest emails
- **AI layer** — GPT-based lead scoring, proposal generation, sales prep, chat assistant, command center, sequence blueprint generation
- **Compliance** — TCPA/CAN-SPAM/DNC enforcement, PEWC consent audit, outbound global pause switch, sender policy registry, ZeroBounce email validation

---

## 2. Tech Stack

### Backend
| Component | Technology |
|---|---|
| Runtime | Node.js 20 + TypeScript |
| Framework | Express 5 |
| Database | PostgreSQL (Neon serverless) via `pg` pool |
| ORM | Drizzle ORM + Drizzle Kit (114 migrations) |
| Session store | `connect-pg-simple` (PostgreSQL-backed sessions) |
| Auth | Passport.js local strategy + `bcryptjs`; TOTP MFA via `otplib` |
| Queue/workers | BullMQ 5 on Upstash Redis (IORedis singleton, ≤20 connections) |
| Job scheduling | BullMQ `repeat.every` (all crons go through the queue, not `setInterval`) |
| File uploads | Multer; stored at `uploads/` path; MIME-filtered |
| Validation | Zod (schemas shared between client and server via `shared/`) |
| Email | Nodemailer (SMTP) + Google Gmail OAuth (per-sending-identity); GHL send API fallback |
| Push | Web Push (`web-push`) |
| Crypto | `crypto` (HMAC, AES-256-CBC for credential encryption), `otplib` |
| External APIs | GoHighLevel REST, OpenAI, Anthropic, ZeroBounce, Serper, NMI Gateway, Payarc, SFTP |
| PDF | `pdf-parse`, `pdfjs-dist`, `PDFKit`, `jsPDF` |
| CSRF protection | Custom CSRF token middleware (double-submit cookie pattern) |

### Frontend
| Component | Technology |
|---|---|
| Framework | React 18 + TypeScript |
| Build | Vite 7 |
| Routing | Wouter |
| Styling | Tailwind CSS + Radix UI primitives |
| State/data | TanStack React Query (server state); React Hook Form + Zod (forms) |
| Charts | Recharts |
| Animations | Framer Motion |
| Icons | Lucide React |

---

## 3. Project Structure

```
/
├── client/                  # React SPA
│   └── src/
│       ├── App.tsx           # Wouter route declarations (~120 routes)
│       ├── pages/            # Page-level components
│       │   ├── dashboard/    # All authenticated dashboard pages
│       │   └── *.tsx         # Public/marketing/auth pages
│       ├── components/       # Shared UI components
│       └── hooks/            # Custom React hooks
├── server/
│   ├── index.ts              # Express entry point
│   ├── routes/               # 66 route files (Express routers)
│   ├── services/             # ~115 service/worker files
│   ├── db.ts                 # Drizzle pool instance
│   ├── storage.ts            # High-level DB access layer
│   └── middleware/           # Auth, CSRF, rate limiting
├── shared/
│   ├── schema.ts             # Drizzle table definitions (~130 tables)
│   └── *.ts                  # Shared types and Zod schemas
├── migrations/               # 114 Drizzle SQL migration files
├── scripts/                  # 25+ operational/QA scripts
├── artifacts/mockup-sandbox/ # Isolated Vite component preview server
└── dist/                     # Compiled production bundle (dist/index.cjs)
```

---

## 4. Authentication & Authorization

### Session
- Express sessions stored in PostgreSQL (`sessions` table)
- Session secret from `SESSION_SECRET` env var
- Cookie: `httpOnly`, `secure` (production), `sameSite: lax`
- CSRF: custom double-submit token; all POST/PATCH/DELETE require `x-csrf-token` header

### Auth Middleware Chain
```
isAuthenticated        → checks req.user exists (Passport session)
isDashboardUser        → isAuthenticated + role in {admin, manager, agent}
requireRole(...roles)  → isDashboardUser + role matches
```
- `merchant` role uses `isAuthenticated` + ownership checks
- Public endpoints use IP-based rate limiting (express-rate-limit)
- Webhook endpoints use HMAC signature verification (`GHL_WEBHOOK_SECRET`)

### MFA
- TOTP-based 2FA via `otplib`
- Backup codes stored hashed in DB
- Admin-forced MFA for admin/manager roles configurable via system settings

### Password
- bcrypt (cost 12); admin seed user re-hashes on every startup from env vars

---

## 5. Database Schema (130+ Tables)

### Core CRM
| Table | Purpose |
|---|---|
| `contacts` | Master contact record; 50+ columns; email_status, lead_score, contactability fields |
| `deals` | Pipeline opportunities linked to contacts; stage, offer_path, ghl_opportunity_id |
| `pipeline_stages` | Configurable pipeline stages with automation rules |
| `stage_automation_rules` | Trigger → action rules on stage transitions |
| `tasks` | CRM tasks with SLA tracking, source/automation_key for idempotency |
| `notes` | Contact/deal notes |
| `comments` | Threaded comments on notes/activities |
| `calendar_events` | Rep calendar; linked to contacts and GHL |
| `email_logs` | Outbound email history |
| `call_logs` | Call activity records |
| `activity` (via `audit_logs`) | General activity timeline |

### Merchant & Onboarding
| Table | Purpose |
|---|---|
| `merchant_applications` | Full merchant application (EIN, bank, principals) — encrypted fields |
| `merchant_profiles` | Activated merchant profile linked to user account |
| `merchant_onboarding_stages` | Per-merchant onboarding checklist stage tracking |
| `onboarding_checklist_items` | Individual checklist line items |
| `onboarding_steps` | Step definitions for onboarding flows |
| `documents` | Uploaded merchant documents (statements, IDs, voided checks) |
| `document_access_log` | Audit trail for document access |
| `underwriting_decisions` | Underwriting pass/fail records |
| `underwriting_rules` | Configurable underwriting rule set |
| `merchant_health_scores` | Risk/health KPI snapshots |

### Sequences & Outbound
| Table | Purpose |
|---|---|
| `follow_up_sequences` | Sequence definitions (name, status, type, vertical) |
| `sequence_steps` | Individual steps within sequences (channel, delay, template) |
| `sequence_enrollments` | Per-contact enrollment records with state machine |
| `sdr_lead_state` | SDR pipeline state for each contact |
| `sdr_lead_events` | Event log for SDR pipeline (appointment, reply, opt-out, etc.) |
| `sdr_merchant_contacts` | Scraped/enriched contact info for SDR targets |
| `sdr_merchants` | SDR merchant prospect records |
| `sdr_channel_attempts` | Per-channel attempt log |
| `sdr_compliance_state` | Contact-level compliance flags for SDR |
| `outbound_messages` | All outbound message records (email/SMS/voicemail) |
| `outbound_send_counters` | Daily send-count capping per contact |
| `campaigns` | Campaign definitions |
| `campaign_steps` | Campaign step definitions |
| `campaigns_previews` | Preview/draft campaign records |

### Compliance & Consent
| Table | Purpose |
|---|---|
| `consent_audit_logs` | PEWC/TCPA consent decisions with disclosure version |
| `data_delete_requests` | CCPA/GDPR deletion request queue |
| `contact_source_events` | Per-contact provenance trail (who submitted, from where, when) |
| `import_executions` | CSV/registry import audit records |
| `health_alerts` | Infrastructure health alert history |
| `audit_logs` | Full operator action audit trail |
| `ai_audit_logs` | AI request/response audit (prompt, response, cost) |
| `analytics_events` | Custom analytics event stream |

### Partners & Residuals
| Table | Purpose |
|---|---|
| `partners` | ISO/agent partner records |
| `partner_organizations` | Multi-level partner org hierarchy |
| `partner_org_users` | User ↔ partner org membership |
| `residual_imports` | Residual file upload batches |
| `residual_import_rows` | Individual residual rows |
| `residual_reports` | Processed residual report snapshots |
| `merchant_residuals` | Per-merchant residual amounts |
| `commission_tiers` | Partner commission tier configuration |
| `agent_payouts` | Agent payout records |
| `agent_quotas` | Agent quota and performance tracking |
| `agent_merchants` | Agent → merchant ownership assignments |

### GHL Integration
| Table | Purpose |
|---|---|
| `ghl_sync_status` | Per-contact GHL sync state and last-synced timestamps |
| `ghl_activity_log` | GHL API call audit trail |
| `ghl_workflow_mappings` | Local workflow key → GHL workflow ID mapping |
| `sync_conflicts` | GHL identity conflict records |
| `sending_identities` | Per-user Gmail OAuth token storage (encrypted) |

### Enrichment & Discovery
| Table | Purpose |
|---|---|
| `sunbiz_entities` | Florida Sunbiz registry business records |
| `enrichment_jobs` | Enrichment job queue |
| `enrichment_runs` | Enrichment batch execution records |
| `lead_discovery_jobs` | Lead discovery job queue |
| `lead_discovery_results` | Discovery results |
| `master_leads` | Master lead import records |
| `master_lead_batches` | Batch tracking for master lead imports |
| `businesses` | Enriched business records |
| `business_locations` | Business location data |
| `business_aliases` | Business name alias records |
| `companies` | Company records linked to contacts |

### AI & Analytics
| Table | Purpose |
|---|---|
| `contact_ai_cache` | Cached AI analysis results per contact |
| `system_audit_runs` | Weekly AI-powered system health audit results |
| `executive_weekly_snapshots` | Weekly KPI snapshots for executive dashboard |
| `executive_goals` | Exec goal tracking |
| `daily_funnel_metrics` | Daily funnel conversion metrics |
| `identity_performance_daily` | Per-sending-identity email performance metrics |
| `mid_daily_stats` | MID-level daily transaction stats |

### Misc Operational
| Table | Purpose |
|---|---|
| `system_settings` | Key-value settings store (feature flags, cooldown timestamps, wizard flags) |
| `workflows` | Workflow definitions |
| `workflow_runs` | Workflow execution records |
| `rfis` | Request-for-information records |
| `chargebacks` | Chargeback case management |
| `nps_responses` | NPS survey responses |
| `tickets` | Support ticket records |
| `ticket_comments` | Ticket comment threads |
| `notifications` | In-app notification queue |
| `notification_preferences` | Per-user notification preference settings |
| `push_subscriptions` | Web push subscription tokens |
| `saved_filters` | User-saved filter presets |
| `review_queue` | Dead-letter / manual review items |
| `virtual_terminal_transactions` | Virtual terminal payment records |
| `sla_configs` | SLA rule configuration |
| `knowledge_base` | Internal knowledge base articles |
| `social_posts` | Scheduled social media posts |
| `generated_blog_posts` | AI-generated blog content |

---

## 6. API Routes (66 Route Files)

All routes are registered on the Express app in `server/index.ts`. Auth enforcement is per-route as noted.

### Public (No Auth)
| File | Routes | Notes |
|---|---|---|
| `public.ts` | `POST /api/contacts/public`, `POST /api/public/statement-upload`, `POST /api/public/estimate`, `POST /api/public/get-started`, `POST /api/public/free-analysis`, `POST /api/data-requests`, `POST /api/public/chat/session` | Rate-limited by IP; GHL webhook calls are mode-gated |
| `glossary.ts` | `GET /learn`, `GET /learn/:slug`, `GET /sitemap-glossary.xml` | SSR glossary pages |
| `og.ts` | `GET /api/og/:type/:id` | Open Graph image generation |
| `ssr-routes.ts` | `GET /sitemap.xml`, `GET /robots.txt`, various public SEO pages | |
| `widget.ts` | `GET /api/widget/config`, `POST /api/widget/chat` | Embeddable chat widget |

### Auth Required (`isAuthenticated`)
| File | Key Endpoints |
|---|---|
| `contacts.ts` | CRUD `/api/contacts*`, bulk ops, scoring triggers, `/api/contacts/:id/contactability` |
| `deals.ts` | CRUD `/api/deals*`, stage transitions, approvals, AI auto-progress |
| `activity.ts` | Activity timeline, notes, comments, email/call logs, calendar events |
| `documents.ts` | Document upload/download/delete, merchant portal documents |
| `inbox.ts` | Inbox items, message threads, composing |
| `merchants.ts` | Merchant profile management |
| `partners.ts` | Partner CRUD, earnings, referrals |
| `notifications.ts` | Notification list, mark-read, preferences |
| `tickets-tasks.ts` | Ticket/task CRUD, comments |
| `campaigns.ts` | Sequence/campaign CRUD and enrollment |
| `chargebacks.ts` | Chargeback case management, evidence uploads |
| `churn.ts` | Churn risk scoring, retention actions |
| `residuals.ts` | Residual reports, MID stats |
| `chat-assistant.ts` | AI chat conversations |
| `search.ts` | Global search across contacts/deals/documents |
| `savings.ts` | Savings analysis and proposal pages |
| `proposals.ts` | Statement proposals, co-branded proposals |

### Admin / Manager Only (`isDashboardUser` + `requireRole`)
| File | Key Endpoints |
|---|---|
| `admin.ts` | Users, sessions, MFA, roles, bulk backfills, GHL config, health checks, backups, deliverability |
| `activation.ts` | Channel audits/tests, outbound settings, feature flag management |
| `sdr.ts` | SDR pipeline management, sequence orchestration, operator digest |
| `prospects.ts` | Prospect list management, enrichment triggers |
| `analytics.ts` | Dashboard analytics, funnels, ROI metrics |
| `executive.ts` | Executive snapshots, KPI goals |
| `imports.ts` | Sunbiz/CSV/master-lead imports |
| `gmail-oauth.ts` | Gmail OAuth management per sending identity |
| `content.ts` | Blog/content CRUD, SEO management |
| `training.ts` | Roleplay sessions, leaderboard |
| `permissions-audit.ts` | Role permission audit trails |
| `system-audit.ts` | Weekly AI system audit results |
| `wizard.ts` | Onboarding wizard, feature flag overrides, connectivity tests |

### Merchant Portal (`isAuthenticated` + ownership)
| File | Key Endpoints |
|---|---|
| `merchant-portal-invite.ts` | Merchant portal invite flow |
| `boarding.ts` | Application processing, underwriting status |
| `portfolio.ts` | Merchant deal portfolio view |
| `onboarding-stages.ts` | Onboarding checklist and steps |

### Webhooks (HMAC-verified)
| File | Key Endpoints |
|---|---|
| `integrations.ts` | `POST /api/webhooks/ghl/*` — inbound GHL webhooks (contact, reply, opt-out, appointment, form, bounce) |

---

## 7. Services Layer (~115 Files)

### GHL Integration (`server/services/ghl*.ts`, `server/services/sdr/`)
| Service | Purpose |
|---|---|
| `ghl.ts` | Core GHL API wrapper — contacts, opportunities, tasks, notes, tags |
| `ghl-sync.ts` | BullMQ worker: bidirectional contact/deal/task sync to GHL; circuit breaker (5 consecutive failures → open for 5 min) |
| `ghl-form-sync.ts` | Sync form submissions to GHL contact fields |
| `ghl-workflow-enrollment.ts` | Enroll contacts in GHL automation workflows |
| `ghl-workflows.ts` | Resolve GHL workflow IDs from DB mappings |
| `ghl-enrollment-recovery.ts` | Recover deferred/failed GHL enrollments |
| `ghl-delete-sync.ts` | Propagate contact deletions to GHL |
| `ghl-channel-probes.ts` | Test GHL connectivity and channel health |
| `sdr/ghl-client.ts` | SDR-specific GHL API calls (tags, inbox, conversations) |
| `sdr/orchestrator.ts` | Main SDR pipeline: score → route → enroll → send |
| `sdr/scheduling.ts` | Appointment booking, calendar sync |
| `sdr/reply-intelligence.ts` | Classify inbound replies (opt-out, hot, cold, etc.) |
| `sdr/statement-flow.ts` | Statement-specific SDR flow |
| `sdr/chat-handlers.ts` | AI chat message routing |
| `sdr/dedupe.ts` | Contact deduplication on import |
| `sdr/operator-digest.ts` | Daily/weekly operator summary emails |
| `sdr/voice-orchestrator.ts` | Voice AI call orchestration |
| `sdr/proposal-tracking.ts` | Proposal follow-up sequences |

### Email & SMTP
| Service | Purpose |
|---|---|
| `smtp-email.ts` | Primary outbound email via Nodemailer SMTP; reads `SMTP_HOST/USER/PASS/PORT` |
| `gmail-oauth.ts` | Per-identity Gmail OAuth token management; send via Gmail API |
| `sender-policy.ts` | **Central registry**: enforces allowed From/Reply-To addresses; blocks noreply@ on Liberty Bancard domains; every send call passes `category:` |
| `email-signatures.ts` | Injects standardized CAN-SPAM-compliant footers and signatures |
| `bounce-feedback.ts` | Processes bounce/complaint feedback; marks contacts do-not-contact |
| `unsubscribe-token.ts` | Generates/validates HMAC unsubscribe tokens |

### Sequence Worker (`sequence-worker.ts`)
The largest single file. Processes all active sequence enrollments:
- Pulls due enrollments from DB
- Checks contactability for every contact before each step
- Dispatches email (SMTP preferred over GHL for cold sequences), SMS, voice AI, ringless voicemail steps
- Enforces daily send caps, DNC list, opt-out state, consent tier requirements
- ~8 min runtime on 155K contacts; runs every 10 min in prod

### Contactability Engine (`contactability.ts`)
Central permission gate checked before every outbound send:
- `deriveConsentTier()` — classifies contact as PEWC/PDPN/cold based on consent audit logs and interaction history
- `evaluateContactability()` — returns per-channel permission (email/SMS/voice/RVM) with reason codes
- Used by sequence worker, SDR orchestrator, and all manual send paths

### Lead Scoring (`lead-scoring.ts`, `contact-scoring-job.ts`)
- Periodic scoring of all contacts by `contact_scoring_job`
- Score factors: form submission, email engagement, SMS replies, appointment bookings, deal stage
- Scores stored on `contacts.lead_score` (0–100)

### Health Monitor (`health-monitor.ts`)
Runs every 5 min in prod via BullMQ. Checks:
1. **db** — PostgreSQL connectivity (uses `pg_class.reltuples`, not `COUNT(*)`)
2. **redis** — Redis ping via shared IORedis client
3. **sequenceWorker** — job completed within expected window
4. **kpiQuery** — KPI query latency benchmark
5. **ai** — OpenAI API reachability (non-critical)
6. **ghlSync** — GHL sync health (non-critical)
7. **dbBackup** — last backup timestamp
8. **outboundPause** — global pause switch state
9. **emailDeliverability** — bounce rate check

Sends email to `accounts@libertybancard.com` (or `ADMIN_ALERT_EMAIL` env var) on:
- Critical check (db/redis/sequenceWorker/kpiQuery) going from ok → degraded (1-hour cooldown)
- Critical check recovering back to ok (RESOLVED email, 15-min cooldown)
- 3-minute startup grace period suppresses alerts immediately after deploy

### DB Backup (`db-backup.ts`)
- Daily BullMQ job
- Runs `pg_dump` against the Neon database URL
- **Critical fix**: `options=` query param uses `%20` (not `+`) for spaces — URLSearchParams encodes `+` which libpq misinterprets as `+statement_timeout`
- Backup stored at `uploads/backups/`

### Enrichment (`enrichment.ts`, `sunbiz-enrichment.ts`, `sunbiz-scraper.ts`)
- BullMQ worker running every 10 min; processes batches of 200 Sunbiz entities
- Steps per entity: Sunbiz detail page → website search → Facebook → Yelp → YellowPages → LinkedIn → BBB → DBPR → Google → website scraping
- Re-entrancy guard prevents concurrent batches
- Result: phone, email, website, vertical classification written back to `sunbiz_entities`

### AI Services
| Service | Purpose |
|---|---|
| `executive-ai.ts` | GPT executive snapshot narrative generation |
| `deal-blueprint.ts` | AI deal analysis and recommendation |
| `proposal-engine.ts` | Auto-generate merchant proposals from statement analysis |
| `statement-analyzer.ts` | Extract and structure data from PDF merchant statements |
| `vertical-advisor-prompts.ts` | Vertical-specific AI prompt templates |
| `chat-assistant.ts` | Multi-turn chat assistant for dashboard users |
| `ai-audit-logger.ts` | Log all AI API calls to `ai_audit_logs` |
| `system-audit/` | Weekly AI-powered system health narrative |
| `sales-prep.ts` | AI sales preparation briefing for contacts |
| `lead-scoring.ts` | AI-assisted lead quality classification |
| `vertical-voice-scripts.ts` | AI-generated voice scripts per vertical |

### Compliance
| Service | Purpose |
|---|---|
| `contactability.ts` | Per-contact channel permission evaluation |
| `sender-policy.ts` | Central From/Reply-To registry with prohibition guard |
| `consent-evidence.ts` | Build PEWC consent evidence packets |
| `consent-merge.ts` | Merge consent records across duplicate contacts |
| `zerobounce-daily-limiter.ts` | Rate-limit ZeroBounce API calls (daily budget cap) |
| `public-form-payload.ts` | Validate and normalize public form submissions |
| `public-form-submission.ts` | Execute the full form intake pipeline |

### Infrastructure
| Service | Purpose |
|---|---|
| `queue-manager.ts` | Singleton BullMQ QueueManager — initializes all 17 queues, manages workers, circuit breaker, DLQ |
| `queue-connection.ts` | Shared IORedis singleton; `getSharedRedisClient()` export |
| `wizard-flag-overrides.ts` | DB-backed feature flag overrides (5-min cache TTL, 2-sec read timeout) |
| `feature-flags.ts` | Runtime feature flag resolution (env var → DB override → default) |
| `startup-reconcile.ts` | Startup consistency checks and data reconciliation |
| `migrations.ts` | Drizzle migrate() wrapper using a dedicated pg.Client (no pool statement_timeout) |
| `credential-encryption.ts` | AES-256-CBC encrypt/decrypt for sensitive stored credentials |
| `job-registry.ts` | BullMQ job deduplication registry |

---

## 8. BullMQ Queues & Automations

All queues use:
- Shared IORedis singleton (1 connection + N blocking workers ≤ 20 total for Upstash free tier)
- `maxRetriesPerRequest: null` (required for BullMQ blocking calls)
- `lockDuration: 120000` (2-min job lock)
- Exponential backoff on retry
- Dead-letter → `review_queue` table after exhausting retries

| Queue | Prod Interval | What It Does |
|---|---|---|
| `ghl-sync` | 45 seconds | Bidirectional GHL contact/deal/task sync; circuit breaker on 5 consecutive real failures |
| `sla-checks` | 5 minutes | Evaluate SLA rules against deals/onboarding stages; create tasks; send alert emails |
| `sequences` | 10 minutes | Process all due sequence enrollment steps across all contacts |
| `enrichment` | 10 minutes | Scrape enrichment data for Sunbiz entities (200/batch) |
| `health-monitor` | 5 minutes | Run 9 health checks; email alerts on state transitions |
| `ghl-enrollment-recovery` | 30 minutes | Re-attempt deferred GHL workflow enrollments |
| `digests` | 1 hour | Operator daily digest emails; NPS digest; pipeline silence check digest |
| `onboarding-reminder` | 4 hours | Send reminders for stalled merchant onboarding stages |
| `discovery` | 24 hours | Nightly lead discovery (Sunbiz registry scan for new businesses) |
| `mid-ingestion` | 24 hours | Ingest MID-level daily transaction stats from processor APIs |
| `abandoned-statement` | 24 hours | Detect and follow up on abandoned statement upload flows |
| `pipeline-silence-check` | 24 hours | Alert if any pipeline stage has had zero movement for configurable threshold |
| `enrollment-recovery` | 24 hours | Recover contacts whose sequence enrollment stalled |
| `proposal-followup` | 24 hours | Auto-send follow-up on proposals that haven't been viewed/responded to |
| `db-backup` | 24 hours | `pg_dump` nightly database backup |
| `executive-snapshot` | 7 days | Generate weekly executive KPI snapshot with AI narrative |
| `system-audit` | 7 days | Run full system health audit; generate GPT narrative; post to Slack |
| `partner-monthly-digest` | ~30 days | Monthly residuals summary email to partner organizations |

### One-Shot Startup Jobs
- Startup reconcile — runs on every server start to verify data consistency
- Initial health check — fires once on startup (within 3-min grace window; alerts suppressed)

### BullMQ Circuit Breaker (GHL Sync)
- Opens after 5 consecutive GHL API failures
- Closed state: normal sync
- Open state: skips API calls for 5 min then auto-closes
- Data-availability skips ("No GHL contact linked") do NOT count as failures

---

## 9. Public Forms & Intake

Five public form endpoints (all rate-limited by IP):

| Endpoint | Form | What Happens |
|---|---|---|
| `POST /api/public/statement-upload` | Statement upload landing page | Creates contact + deal (stage: "Statement Received") + document; triggers statement analysis job; enrolls in follow-up sequence |
| `POST /api/public/estimate` | Free estimate form | Creates contact + deal; referral attribution; offer-path routing |
| `POST /api/public/get-started` | Get Started form | Creates contact + deal; deterministic offer-path router |
| `POST /api/merchant-applications/draft` + `PATCH /api/merchant-applications/:id/finalize` | Merchant application | Two-step: draft (saves encrypted PII) → finalize (EIN dedupe, PEWC consent audit log, triggers underwriting) |
| `POST /api/affiliate/signup` | Affiliate portal signup | Creates contact + affiliate record + tracking |

**Intake Provenance System**: Every form submission writes to `contact_source_events` linking the contact to its form type, referral code, affiliate, and import execution — full audit trail.

---

## 10. Security Model

### Authentication
- Sessions: PostgreSQL-backed, httpOnly cookies
- CSRF: double-submit token on all state-changing requests
- MFA: TOTP (6-digit) with backup codes; admin-enforceable per role
- Rate limiting: per-IP on public endpoints (15 req/15min default); login endpoint has stricter limit

### Authorization
- Four roles enforced at route level: admin > manager > agent > merchant
- Row-level ownership: agents see only their assigned contacts/deals
- Merchant portal: ownership verified server-side on every document/deal access
- GHL webhook: HMAC-SHA256 signature verification on all inbound events

### Data Protection
- PII encryption: merchant application EIN, bank account, SSN fields encrypted at rest with AES-256-CBC (`CREDENTIAL_ENCRYPTION_KEY`)
- Sending identity OAuth tokens: encrypted before storage
- File uploads: MIME type filtering (whitelist); stored outside web root
- Unsubscribe tokens: HMAC-signed, time-bounded

### Compliance Controls
- **Global outbound pause**: persisted in `system_settings`; checked by sequence worker, SDR orchestrator, and all send paths before any outbound contact
- **DNC enforcement**: `contacts.doNotContact` flag; evaluated in contactability engine
- **Consent tiers**: PEWC (explicit written consent with disclosure version) > PDPN (prior business relationship) > cold (no contact)
- **CAN-SPAM**: automated footer injection on every marketing email; unsubscribe link generation
- **TCPA**: channel-level permission gates; SMS only to PEWC/PDPN tiers
- **Email validation**: ZeroBounce integration; daily call budget; bounce status stored on `contacts.email_status`

### Known Security Hardening (Recent)
- SDR merchant-contact routes upgraded from `isAuthenticated` → `isDashboardUser + requireRole("admin","manager")` (these expose full PII for all merchants)
- Large file upload MIME filter added (was unrestricted)
- Admin backfill status endpoint replaced 155K-row ID materialization with `count()` aggregates
- SSRF guard pattern applied to webhook test endpoints

---

## 11. External Integrations

| Integration | How | Credentials |
|---|---|---|
| **GoHighLevel (GHL)** | REST API v1; Private Integration Token | `GHL_PRIVATE_INTEGRATION_TOKEN`, `GHL_LOCATION_ID`, `GHL_CALENDAR_ID` |
| **OpenAI** | `openai` SDK; gpt-4o / gpt-5 depending on task | `AI_INTEGRATIONS_OPENAI_API_KEY`, `AI_INTEGRATIONS_OPENAI_BASE_URL` |
| **Anthropic** | `@anthropic-ai/sdk` | (via Replit connector or env) |
| **Google Gmail** | OAuth 2.0 per sending identity; tokens encrypted in DB | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| **ZeroBounce** | REST API; email validation | `ZEROBOUNCE_APi_KEY` |
| **Serper** | Google Search API proxy; used in enrichment | `SERPER_API_KEY` |
| **SMTP** | Nodemailer; cold-email and transactional fallback | `SMTP_HOST/PORT/USER/PASS` |
| **Redis (Upstash)** | BullMQ job queue and cache | `REDIS_URL` |
| **NMI Gateway** | Payment processing | `NMI_*` env vars |
| **Payarc** | Processor API | `PAYARC_*` env vars |
| **Google Drive** | Document storage (Replit connector) | Managed by Replit integration |
| **Push Notifications** | Web Push API via `web-push` | VAPID keys in env |

---

## 12. QA / Pre-Deploy Gate (19 Suites)

All gate suites run via `GHL_TEST_MODE=true npx tsx scripts/pre-deploy.ts` before any production deploy. Suites:

1. **Compliance Scan** — 125 static call-site checks; every email/SMS send must have a category
2. **Sender Policy** — From/Reply-To enforcement, noreply@ prohibition guard
3. **Sequence Compliance** — 114 live cases covering consent/DNC/send-cap/kill-switch/CAN-SPAM
4. **Contactability Engine** — consent tier derivation and per-channel permission evaluation
5. **New-Lead Enrollment Policy** — offer-path routing and sequence assignment logic
6. **Intake Provenance** — all 9 form types write `contact_source_events`
7. **Transport Dispatch** — Gmail/SMTP/GHL routing, unsubscribe URL injection
8. **GHL Inbound Webhooks** — reply/bounce/opt-out/STOP/dedup/signature validation
9. **BullMQ Resilience** — retry/backoff/DLQ/operator visibility (46 assertions)
10. **Sunbiz Timeout & Recovery** — enrichment never throws on bad input
11. **Role Guards** — 403 enforcement on agent/merchant attempting admin routes
12. **API Coverage** — all declared routes respond (no 404 mismatches)
13. **Live Health Monitor** — background workers running, AI responding
14. **SEO Audit** — meta tags, canonical URLs, noindex rules
15. **Chat Business Hours** — AI available 24/7; human handoff gated to business hours
16. **Outbound Pause Fence** — global pause persists across server restarts (DB-backed, not code default)
17. **Email Signature Coverage** — all 6 email types, CAN-SPAM footer, sender policy call-site checks (143 assertions)
18. **AI Assistant Boundaries** — auth/role/schema validation for all AI endpoints
19. **Public Forms** — end-to-end form submission, deal creation, consent log, duplicate EIN detection

---

## 13. Scripts (`scripts/`)

| Script | Purpose |
|---|---|
| `pre-deploy.ts` | Full 19-suite go/no-go gate |
| `test-sequence-compliance.ts` | 114-case sequence compliance test |
| `test-contactability.ts` | Contactability engine integration tests |
| `test-sender-policy.ts` | 82 sender policy assertion checks |
| `test-forms.ts` | Public form integration tests |
| `compliance-scan.ts` | Static source scan for ungated send call sites |
| `check-api-coverage.ts` | Verify all API routes are reachable |
| `smoke-role-guards.ts` | Role guard smoke tests across all protected routes |
| `seo-audit.ts` | SEO meta tag and sitemap audit |
| `mobile-screenshots.ts` | Mobile viewport screenshot tests |
| `check-api-coverage.ts` | API route coverage verification |
| `seed-*.ts` | Various DB seed scripts (sequences, workflows, content, vertical campaigns) |
| `migrate.ts` | Run Drizzle migrations |
| `check-api-coverage.ts` | API coverage validation |
| `sunbiz-import.ts` | Bulk Sunbiz registry import |
| `generate-glossary.ts` | Generate SEO glossary pages |
| `pre-deploy.ts` | Launch gate (master script) |

---

## 14. Known Architecture Decisions & Non-Obvious Behaviors

1. **BullMQ connection cap**: Upstash free tier = 20 Redis connections. Formula: 1 shared client + N blocking workers. With 17 queues = 18 connections. Every new `new IORedis()` in a request handler would exceed this cap — all code must use `getSharedRedisClient()`.

2. **Drizzle journal `when` timestamps**: New migrations must have a `when` value above 1784700000000 (the PHASE3_INDEX_WHEN) or Drizzle silently skips them. Always check against the high-water mark.

3. **Pool statement_timeout vs migrations**: The pg pool has `statement_timeout=30000` (30s). Drizzle `migrate()` uses a dedicated `pg.Client` with `statement_timeout=0` to allow `CREATE INDEX` on large tables.

4. **GHL Tasks API payload**: Only accepts `{title, dueDate, assignedTo, completed}`. Extra fields (`body`, `contactId`, `status`) cause 422 on every call.

5. **URLSearchParams + libpq**: `URLSearchParams` encodes spaces as `+`; libpq only accepts `%20` in the `options=` connection string parameter. Always build pg connection option values manually.

6. **Wizard flag cache**: `wizard-flag-overrides.ts` polls DB every 5 min (not 30s). Under enrichment load, DB reads use a 2-second race timeout to prevent pool saturation log storms.

7. **Health monitor grace period**: First 3 minutes after server start, critical alert emails are suppressed to avoid false positives during deployment restarts.

8. **Sequence worker runtime**: `processSequenceEnrollments` takes ~8 min against 155K contacts. The queue repeat interval is set to 10 min in prod to prevent job pile-up.

9. **`onConflictDoNothing` + partial indexes**: Drizzle's `onConflictDoNothing({ targetWhere })` does NOT emit the `WHERE` clause. Use raw `db.execute(sql\`INSERT … ON CONFLICT (cols) WHERE … DO NOTHING\`)` for partial-index conflicts.

10. **Drizzle `set()` casting**: `db.update().set({ ...obj } as any)` silently drops unknown columns. For single-field critical writes (e.g., `ghlOpportunityId`), use raw `db.execute(sql\`UPDATE ...\`)`.

---

## 15. Environment Variables (Required)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (Neon) |
| `SESSION_SECRET` | Express session signing secret |
| `CREDENTIAL_ENCRYPTION_KEY` | AES-256 key for PII field encryption |
| `REDIS_URL` | Upstash Redis URL for BullMQ |
| `GHL_PRIVATE_INTEGRATION_TOKEN` | GoHighLevel API token |
| `GHL_LOCATION_ID` | GHL location/subaccount ID |
| `GHL_CALENDAR_ID` | GHL calendar ID for booking |
| `GHL_WEBHOOK_SECRET` | HMAC secret for GHL webhook verification |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | OpenAI API key |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | OpenAI base URL (may proxy) |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `SMTP_HOST` | SMTP server hostname |
| `SMTP_PORT` | SMTP port |
| `SMTP_USER` | SMTP username |
| `SMTP_PASS` | SMTP password |
| `ZEROBOUNCE_APi_KEY` | ZeroBounce email validation API key |
| `ADMIN_SEED_EMAIL` | Admin user email (seeded on startup) |
| `ADMIN_SEED_PASSWORD` | Admin user password (re-hashed on startup) |
| `APP_URL` | Public app URL (used in unsubscribe links, OG tags) |
| `SENDER_DOMAIN_SPF_VERIFIED` | Manual flag confirming SPF/DKIM verified |
| `ADMIN_ALERT_EMAIL` | Override for health monitor alert recipient (default: accounts@libertybancard.com) |

---

*This document was auto-generated from source on 2026-08-08. Total: 66 route files, ~115 service files, 130+ DB tables, 17 BullMQ queues, 19 pre-deploy gate suites, 114 Drizzle migrations.*
