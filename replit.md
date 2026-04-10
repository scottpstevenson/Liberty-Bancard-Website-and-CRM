# Liberty Bancard AI Business Operating System

## Overview
The Liberty Bancard AI Business Operating System is an AI-powered platform designed for the merchant payment processing industry. It integrates a public marketing website, advanced lead generation, an internal CRM for pipeline and task management, and an automated workflow engine. The system leverages AI for departmental advisory roles and compliance-driven communication to optimize operations, enhance customer engagement, and improve sales efficiency, aiming for market leadership.

## User Preferences
I want iterative development.
I prefer detailed explanations.
Do not make changes to the folder `node_modules`.
Do not make changes to the file `package-lock.json`.

## System Architecture
The system is built on a modern web stack, emphasizing scalability, responsiveness, and robust data management.

### UI/UX Decisions
The frontend uses React with Vite, TypeScript, Tailwind CSS, and shadcn/ui, with `wouter` for routing and `react-helmet-async` for SEO. The design incorporates specific color schemes and templates for a professional and intuitive user experience across the public marketing website, terminal shop, legal/compliance pages, and CRM dashboards.

### Technical Implementations
- **Backend**: Express.js with TypeScript, organizing API routes into domain-specific modules.
- **Database**: PostgreSQL with Drizzle ORM.
- **Authentication**: Custom email/password authentication with session-based auth, email verification, password recovery, and role-based access control.
- **AI Integration**: OpenAI powers AI advisors, lead enrichment, deal blueprint generation, and compliance-safe auto-replies. Includes an autonomous AI SDR pipeline with intent classification, voice AI orchestration, and a comprehensive compliance engine.
- **External Communications**: GoHighLevel (GHL) is the primary day-to-day CRM/communications hub. Full 2-way sync engine covers contacts, deals/opportunities, companies, tasks, tickets, notes, tags, and activity logs. The sync engine runs on a 45-second auto-loop. All website form submissions (10 forms) sync to GHL with 35+ custom fields and lead source tagging via `server/services/ghl-form-sync.ts`. Per-form-type sync logic includes DND/consent sync, statement notes, support tasks with team assignment, affiliate tagging, and merchant app opportunities with GHL pipeline creation. GHL workflow enrollment bridge allows sequences to delegate to native GHL workflows. Platform emails (password reset, verification) stay in the Replit app; all sales/support communications route through GHL.
- **Analytics & Tracking**: GA4 and Facebook Pixel for analytics, conversion tracking, and UTM parameter capture.
- **Promo System**: Dynamic promotion display and tracking with end-to-end code persistence.
- **Lead Management**: AI-powered prospect enrichment, multi-step personalized email campaigns, lead scoring, deal blueprint generation, universal CSV import, and a Nightly Lead Discovery Engine.
- **Sales Workflow**: Gated sales call follow-up system with AI-generated personalized drafts.
- **Workflow Automation**: Centralized engine for event-triggered actions with SLA enforcement.
- **Profit Instrumentation**: Integrates merchant tier, risk, health scores, and profit estimates into deal management.
- **Statement Review & Proposals**: AI-powered analysis for multi-plan pricing proposals and automated delivery.
- **Merchant Application & Portal**: Multi-step application wizard with e-signature and a self-service portal.
- **Outreach & Enrichment**: Outreach Command Center managing automated sales lifecycles, including Sunbiz entity imports, AI enrichment/classification, and deep enrichment via Serper.dev. Processor Detection & Tech Stack Intelligence automatically identifies merchant payment processors and ad platforms.
- **Affiliate Program**: Public signup with referral codes, cookie-based attribution, performance tracking, and tiered commissions.
- **Conversation AI**: GHL chat widget integration with bot contexts, AI reply generation, and human handoff logic.
- **Go-Live Activation System**: Runtime feature flags (SDR_ENABLED, ORCHESTRATOR_ENABLED, LEGACY_OUTREACH_ENABLED, VOICE_AI_ENABLED, SMS_ENABLED, NIGHTLY_DISCOVERY_ENABLED) gate system behaviors. Health endpoints (/api/health, /api/ghl/health, /api/sdr/health) provide operational readiness. Kill-switch auto-pauses outbound on high bounce rates or duplicate sends. Global pause/resume controls all outbound. Bridge script (POST /api/sdr/bridge) imports contacts/sunbiz entities to SDR with dry-run mode. Admin Activation Panel at /dashboard/activation provides Day 1 go-live control center.
- **Inbox Rotation & Deliverability Engine**: Multi-inbox sending identity management with intelligent rotation, warmup scheduling, auto-pause on high bounce/complaint rates, and health scoring.
- **Canonical Business Identity & Dedupe Engine**: Business-centric data model with a weighted deduplication engine to prevent duplicate outreach.
- **Lookalike Scoring Model**: Scores pipeline leads based on similarity to closed-won merchants.
- **Re-enrichment Worker**: Re-enriches businesses with outdated information.
- **Daily Funnel Metrics & KPI Reporting**: Aggregation of funnel metrics and KPI reporting with market expansion logic.
- **Operator Dashboard**: Pilot instrumentation dashboard at `/dashboard/operator` with 7 KPIs (leads queued, contacted, send success, bounce rate, reply rate, positive-intent, booked calls), time range toggle (today/yesterday/7-day), per-identity send monitoring with auto-refresh, webhook event log viewer with filtering, stuck lead alerts (>48h in same stage), low-confidence intent classification flagging (<70%), and on-demand daily digest sending.
- **SDR Daily Digest Email**: Automated daily digest at 8 AM ET via `checkAndSendDigests()` including outreach stats, reply breakdown, inbox health, kill-switch status, and top 5 stuck leads. Uses `server/services/sdr/operator-digest.ts`.
- **Enhanced Inbox Health**: Warmup progress tracking with day count and progress bars, daily cap utilization visualization, per-identity pause/resume controls, and bounce/complaint trend bars per identity.
- **Anomaly Detection Monitoring**: Automated detection of send volume deviations (>50%), reply rate drops (>30%), inbox bounce spikes (>3%), and inbox health degradation (<70 score). Alerts surfaced on dashboard with severity levels (warning/critical).
- **Serper Enrichment Service**: Batch enrichment of merchant data using Serper.dev API for website, phone, email, and address discovery. Metrics tracked and surfaced on dashboard.
- **Calendar Booking Automation**: Meeting-intent reply classification triggers automatic booking link generation via GHL scheduling integration.
- **Multi-Inbox Bulk Management**: Bulk pause/resume operations for sending identities with select-all capability in the inbox health dashboard.
- **Sprint C Dashboard Tabs**: SDR Dashboard extended with Anomaly Alerts, SMS Metrics, Voice AI Status, Serper Enrichment, and Discovery Controls tabs.

### Feature Specifications
- **Public Website**: Marketing pages, conversion forms, legal pages, and hidden sales enablement content, all SEO-optimized. Includes an e-commerce terminal shop.
- **CRM Dashboard**: Modules for contact, sales pipeline (Kanban), support tickets, task management, notifications, and KPI digests.
- **AI Advisors**: Seven specialized AI advisors (Sales, Support, Onboarding, Marketing, Finance, Compliance, Executive).
- **Compliance Rules**: Adherence to regulatory guidelines, including explicit disclaimers and PCI compliance.

### GHL Workflow Enrollment & Automation (Task #40)
- **GHL Workflow Enrollment Service** (`server/services/ghl-workflow-enrollment.ts`): Maps all 30+ seed sequences to GHL workflow IDs via env vars (`GHL_WORKFLOW_<SEQUENCE_NAME>`) or a default (`GHL_DEFAULT_WORKFLOW_ID`). Enrolls contacts into GHL-native workflows via `triggerWorkflow()`, tags contacts for LeadConnector inbox organization, and falls back to Replit direct sends when no workflow ID is configured.
- **Sequence Worker Bridge**: Modified `server/services/sequence-worker.ts` to attempt GHL workflow enrollment at step 0 before falling back to Replit direct email/SMS sends. Respects `LB-ACTIVE-PIPELINE` tag exclusion and `doNotContact` flags.
- **Inbound Lead Confirmation**: All public form submissions (statement upload, estimate, get-started, callback) trigger `enrollInInboundConfirmation()` which sends welcome email + SMS with booking link + 24h follow-up via GHL workflow (or direct sends as fallback).
- **Appointment Scheduling Automation**: `enrollInAppointmentWorkflow()` sends confirmation email, 24h reminder, 1h SMS reminder, and post-meeting follow-up. Wired into GHL appointment-booked webhook handler.
- **LeadConnector Inbox Organization**: Contacts tagged with sequence-specific tags (e.g., `LB-SEQ-STATEMENT-AUDIT`), vertical tags (`LB-AUTO`, `LB-MEDSPA`, `LB-DENTAL`), and smart list tags (`LB-SDR`, `LB-REPLIED`, `LB-BOOKING-READY`, `LB-STATEMENT-PENDING`, `LB-HUMAN-HANDOFF`, `LB-ACTIVE-PIPELINE`). SDR orchestrator email/SMS sends also tag via `tagContactForInboxOrganization()`.
- **Platform Email Separation**: Transactional emails (password reset, email verification, security alerts) stay in Replit. Marketing/sales emails (SDR sequences, inbound confirmations, appointment reminders, proposals, nurture drips) route through GHL.
- **E-Sign Flow**: Verified complete — `sendDocumentForEsign()` and `getDocumentStatus()` in ghl.ts, full endpoint chain in merchants.ts with webhook handler at `/api/webhooks/ghl-document`, `markEsignComplete()` verification in enrollment service.
- **API Endpoints**: `GET /api/sdr/ghl-enrollment/status` (enrollment system status), `GET /api/sdr/ghl-enrollment/mappings` (sequence-to-workflow mappings and smart list tags).
- **Required Env Vars**: `GHL_WORKFLOW_INBOUND_CONFIRMATION`, `GHL_WORKFLOW_APPOINTMENT`, `GHL_DEFAULT_WORKFLOW_ID`, `GHL_MERCHANT_AGREEMENT_TEMPLATE_ID`.

### Pre-Deployment Security & Stability (Tasks #33-#38)
- **Auth Middleware**: All CRM/internal API endpoints require `isAuthenticated` middleware. Only public marketing routes, health checks, and external webhook receivers are unprotected.
- **Error Handling**: All route handlers wrapped in try/catch with structured error logging. SLA worker catch blocks log errors instead of swallowing silently.
- **Database Indexes**: 33 performance indexes on contacts (email, phone, status, lead_score, ghl_contact_id), deals (pipeline, stage, contact_id), tickets, tasks, prospects, sunbiz_entities (filing_number, enrichment_status, list_id), audit_logs, documents, and notifications. Index creation SQL at `server/add-indexes.sql`.
- **Pagination**: `getContacts()`, `getDeals()`, `getTickets()`, `getTasks()`, `getProspects()`, `getSunbizEntities()` accept optional `{ limit, offset }`. API routes support `?limit=N&offset=N` query params (max 1000).
- **GHL Hardening**: Legacy webhook HMAC verification, `ghlFetch()` retry with exponential backoff, calendar/workflow env var runtime checks, production enforcement of `GHL_WEBHOOK_SECRET`.
- **Required Env Vars for Go-Live**: `GHL_PRIVATE_INTEGRATION_TOKEN`, `GHL_LOCATION_ID`, `GHL_WEBHOOK_SECRET`, `SERPER_API_KEY`, `ADMIN_DIGEST_EMAIL`, `GHL_CALENDAR_ID`, `GHL_WORKFLOW_BOOKING_LINK`, `GHL_WORKFLOW_REMINDER`.

### GHL Integration Architecture (Tasks #39-#41)
- **Full 2-Way Sync Engine** (`server/services/ghl-sync.ts`): Bidirectional sync for contacts, deals/opportunities, companies, tasks, tickets, notes, tags, and activity. Pipeline stage mapping with auto-discovery. Active pipeline exclusion via `LB-ACTIVE-PIPELINE` tag. Auto-sync loop every 45 seconds.
- **GHL Form Sync** (`server/services/ghl-form-sync.ts`): Centralized service that syncs all website form submissions to GHL with full custom field mapping. Handles statement uploads (adds note + triggers workflow), support tickets (creates GHL task), merchant applications (syncs all fields), and consent/DND settings.
- **GHL Workflow Registry** (`server/services/ghl-workflows.ts`): 21 registered workflow types covering SDR outbound (6 verticals), inbound lead confirmation, scheduling (booking/reminder/no-show), support, onboarding, and nurture. Each mapped to an env var for configuration. Platform email separation clearly documented (password reset/verification stay in Replit app).
- **Sequence Worker GHL Bridge**: The sequence worker (`server/services/sequence-worker.ts`) now checks for a `ghlWorkflowId` on sequences. If present, it enrolls the contact in the corresponding GHL workflow instead of sending directly, making the worker an enrollment dispatcher.
- **35+ GHL Custom Fields**: Bootstrap includes: lb_merchant_id, lb_current_stage, lb_fit_score, lb_revenue_score, lb_vertical, lb_monthly_volume, lb_current_processor, lb_pain_points, lb_terminal_need, lb_preferred_program, lb_utm_source/medium/campaign, lb_promo_code, lb_lead_source, lb_consent_sms/email, lb_estimated_savings, lb_recommended_program, lb_referral_code, lb_landing_page, lb_deal_stage/pipeline, and more.
- **GHL API Endpoints**: `/api/ghl/workflows` (workflow registry status), `/api/ghl/email-config` (platform email routing), plus existing sync/health/status endpoints.

## External Dependencies
- **PostgreSQL**: Primary relational database.
- **OpenAI API**: For AI functionalities.
- **GoHighLevel (GHL) API**: For communication, scheduling, e-signatures, and data synchronization.
- **Serper.dev API**: For Google search and business information discovery.
- **Outscraper API**: For Google Maps bulk business data pulls.
- **Apify API**: For Yelp and Facebook business page scraping.