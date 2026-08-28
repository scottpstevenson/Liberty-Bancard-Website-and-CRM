# Liberty Bancard AI Business Operating System

## Overview
The Liberty Bancard AI Business Operating System is an AI-powered platform designed for the merchant payment processing industry. It integrates a public marketing website, lead generation, an internal CRM for pipeline and task management, and an automated workflow engine. The system leverages AI for departmental advisory roles and compliance-driven communication to optimize operations, enhance customer engagement, and improve sales efficiency, aiming for market leadership.

## User Preferences
I want iterative development.
I prefer detailed explanations.
Do not make changes to the folder `node_modules`.
Do not make changes to the file `package-lock.json`.

## System Architecture
The system is built on a modern web stack, emphasizing scalability, responsiveness, and robust data management.

### UI/UX Decisions
The frontend uses React with Vite, TypeScript, Tailwind CSS, and shadcn/ui, with `wouter` for routing and `react-helmet-async` for SEO. The design incorporates specific color schemes and templates for a professional user experience across public marketing, terminal shop, legal/compliance pages, and CRM dashboards. Shared layout components like `PageHeader`, `ResponsiveTable`, and `DataState` ensure consistency. All icon-only buttons include `aria-label` attributes for accessibility. A Progressive Web App (PWA) at `/mobile` provides a mobile-optimized experience for field sales representatives, featuring bottom tab navigation, contact management, pipeline tracking, task management, and offline capabilities through a service worker.

### Technical Implementations
- **Backend**: Express.js with TypeScript, organizing API routes into domain-specific modules.
- **Database**: PostgreSQL with Drizzle ORM. Schema migrations are managed by drizzle-kit. Migration files live in `migrations/` and are tracked in `drizzle.__drizzle_migrations`. Run `npx tsx scripts/migrate.ts` for a standalone migration (e.g. before production deploys). On startup, `server/db-migrate.ts` applies any unapplied migrations automatically before the HTTP server binds.
- **Authentication**: Custom email/password authentication with session-based auth, email verification, password recovery, and role-based access control. Three-tier auth middleware: `isAuthenticated` (any logged-in user), `isDashboardUser` (admin/manager/agent — blocks merchants/partners from CRM data), `requireRole(...roles)` (specific role gate). All CRM-internal routes use `isDashboardUser`; sensitive mutations (pipeline config, stage rules, knowledge base, equipment orders, onboarding steps, commission tiers) require `requireRole("admin","manager")`. All public endpoints rate-limited via `publicLeadRateLimit` (10 req/15 min per IP). Includes full TOTP-based two-factor authentication (2FA/MFA): enrollment via QR code, backup codes, trusted devices (30-day remember), and admin-enforced MFA requirement. Security Settings page at `/dashboard/security`. Admin can view 2FA status per user and reset 2FA from User Management (`/dashboard/user-management`). Full audit documented in `docs/api-route-audit.md`; smoke test at `scripts/smoke-role-guards.ts`.
- **AI Integration**: OpenAI powers AI advisors, lead enrichment, deal blueprint generation, and compliance-safe auto-replies. Includes an autonomous AI SDR pipeline with intent classification, voice AI orchestration, and a comprehensive compliance engine.
- **External Communications**: GoHighLevel (GHL) serves as the primary CRM/communications hub with a full 2-way sync engine for contacts, deals, companies, tasks, tickets, notes, tags, and activity logs, running on a 45-second auto-loop. Contact upsert payloads use GHL's required `customFields` array format (`[{key, field_value}]`) — NOT the legacy `customField` object map (which causes 422 errors). Duplicate-contact 400 responses are auto-recovered by parsing the existing GHL ID from the error body and linking it. All website form submissions sync to GHL with custom fields and lead source tagging. GHL workflow enrollment bridge allows sequences to delegate to native GHL workflows, while platform emails (password reset, verification) remain in the Replit app. A GHL Workflow ID Manager at `/dashboard/ghl-workflows` provides a DB-backed admin UI for mapping sequence names to GHL workflow IDs (env var takes priority, then DB, then hardcoded map). Canonical pipeline stage names: `New Lead → Statement Received → Review In Progress → Call Booked → Proposal Sent → Negotiation / Follow-Up → Verbal Commit → Closed Won / Closed Lost`. Closed Won auto-creates an onboarding pipeline deal and fires a merchant welcome email. Statement upload form submissions always trigger the GHL workflow via `sequenceName` resolution.
- **Analytics & Tracking**: GA4 and Facebook Pixel are used for analytics, conversion tracking, and UTM parameter capture.
- **Lead Management**: Features AI-powered prospect enrichment, multi-step personalized email campaigns, lead scoring, deal blueprint generation, universal CSV import, and a Nightly Lead Discovery Engine.
- **Workflow Automation**: A centralized engine manages event-triggered actions with SLA enforcement.
- **Profit Instrumentation**: Integrates merchant tier, risk, health scores, and profit estimates into deal management.
- **Statement Review & Proposals**: AI-powered analysis facilitates multi-plan pricing proposals and automated delivery.
- **Merchant Application & Portal**: A multi-step application wizard with e-signature capabilities and a self-service merchant portal.
- **ISO & Partner Program**: A public-facing `/partners` page targets ISOs, CPAs, bookkeepers, and consultants, offering a residual income calculator, commission tier breakdown, and partner application. A partner portal provides login, dashboard KPIs, referred merchant list, co-branded collateral, and account details.
- **Outreach & Enrichment**: An Outreach Command Center manages automated sales lifecycles, including Sunbiz entity imports, AI enrichment/classification, deep enrichment via Serper.dev, Processor Detection, and Tech Stack Intelligence.
- **Affiliate Program**: Supports public signup with referral codes, cookie-based attribution, performance tracking, and tiered commissions.
- **Conversation AI**: Integrates the GHL chat widget with bot contexts, AI reply generation, and human handoff logic.
- **Go-Live Activation System**: Runtime feature flags (`SDR_ENABLED`, `ORCHESTRATOR_ENABLED`, etc.) control system behaviors. An Admin Activation Panel at `/dashboard/activation` provides Day 1 go-live control, alongside health endpoints, kill-switch, and global pause/resume controls for outbound communications.
- **Inbox Rotation & Deliverability Engine**: Manages multi-inbox sending identities with intelligent rotation, warmup scheduling, auto-pause on high bounce/complaint rates, and health scoring.
- **Canonical Business Identity & Dedupe Engine**: Implements a business-centric data model with a weighted deduplication engine.
- **Operator Dashboard**: Provides an instrumentation dashboard at `/dashboard/operator` with KPIs, time range toggles, send monitoring, webhook event logs, stuck lead alerts, low-confidence intent classification flagging, and on-demand daily digest sending. It includes tabs for Anomaly Alerts, SMS Metrics, Voice AI Status, Serper Enrichment, and Discovery Controls.
- **Anomaly Detection Monitoring**: Automated detection and alerting for deviations in send volume, reply rates, inbox bounce spikes, and inbox health.
- **Calendar Booking Automation**: Meeting-intent reply classification triggers automatic booking link generation via GHL scheduling integration.
- **Merchant Lifecycle Suite**: Four integrated features: NPS/CSAT Surveys (`/nps/:token`), Merchant Referral Portal, Retention Campaigns (`/dashboard/retention-campaigns`), and Review Collection.
- **Automated Residual Reconciliation**: Allows admins to upload monthly processor residual reports (CSV). The system parses, matches to merchant records, calculates variance, flags discrepancies, and shows per-agent reconciliation, with one-click confirmation to post residuals and trigger internal alerts.
- **Direct Processor Boarding & MID Data Pipeline**: Full NMI-style processor boarding integration for the onboarding pipeline. This includes new schema fields on `deals` for boarding status and logs, and a `mid_daily_stats` table for daily MID performance. An SLA worker runs nightly MID data ingestion.

### Feature Specifications
- **Public Website**: Marketing pages, conversion forms, legal pages, and hidden sales enablement content, optimized for SEO, including an e-commerce terminal shop.
- **Merchant Document Vault**: A per-merchant KYC and file management system within contact detail pages, supporting drag-and-drop uploads, category selection, and file management. A global admin document index is available at `/dashboard/document-vault`.
- **CRM Dashboard**: Modules for contact management, sales pipeline (Kanban), support tickets, task management, notifications, and KPI digests.
- **AI Advisors**: Seven specialized AI advisors covering Sales, Support, Onboarding, Marketing, Finance, Compliance, and Executive functions.
- **Compliance Rules**: Adherence to regulatory guidelines, including explicit disclaimers and PCI compliance.

## Job Queue (BullMQ)
The platform uses BullMQ for durable, Redis-backed job queues. Seven named queues manage all background work: `ghl-sync` (45s), `sla-checks` (5m), `sequences` (30s), `enrichment` (10m), `discovery` (daily), `digests` (1h), and `mid-ingestion` (nightly). Failed jobs are retried up to 3 times with exponential backoff; after all retries the job is moved to a dead-letter queue and an audit log entry is written. Graceful shutdown drains all workers on SIGTERM/SIGINT.

BullMQ requires a real Redis connection via `REDIS_URL`; there is no in-memory fallback. Without it, queue mode is `unavailable` and BullMQ workers do not start. `bullmq_redis` is the durable mode. A `legacy_interval_partial` mode, where explicitly reported, covers only the legacy task that owns that interval and never represents all queues. The Operator Dashboard → "Job Queue" tab provides real-time queue metrics, pause/resume controls, and dead-letter job management (retry / discard).

## GHL Workflow Environment Variables
The GHL Workflow ID Manager (`server/services/ghl-workflows.ts`) maintains a registry of all GHL workflow env vars. Each maps a business event to a GHL workflow ID. Key onboarding workflows:
- `GHL_WORKFLOW_MERCHANT_APPROVED` — Triggered when a merchant profile is approved. Sends portal welcome email with MID and next steps. Uses a 3-tier delivery strategy: (1) GHL workflow if env var is set and GHL contact exists, (2) GHL direct email if contact has a ghlContactId, (3) SMTP fallback if SMTP is configured. If the contact has no `ghlContactId`, the system attempts to upsert a GHL contact via `upsertContact()` before falling back to SMTP.
- `GHL_WORKFLOW_MERCHANT_APP` — Triggered on merchant application submission. Sends confirmation, triggers e-sign, begins onboarding.
- `GHL_WORKFLOW_PARTNER_WELCOME` — Welcome sequence for approved partners with portal access and referral instructions.

All workflow env vars can be managed via the admin GHL Workflow ID Manager UI at `/dashboard/integrations`.

### SMTP Fallback Configuration
When GHL is not configured or a contact has no GHL contact ID, the system can fall back to direct SMTP delivery. Configure with:
- `SMTP_HOST` — SMTP server hostname (e.g., `smtp.gmail.com`)
- `SMTP_PORT` — SMTP port (default: 587; use 465 for SSL)
- `SMTP_USER` — SMTP username/email for authentication
- `SMTP_PASS` — SMTP password or app-specific password
- `SMTP_FROM` — (optional) From address; defaults to SMTP_USER

The SMTP service is in `server/services/smtp-email.ts`.

## Build Identity & Release SHA

Every deployment must have `RELEASE_SHA` set to the 40-character hex output of `git rev-parse HEAD` at the time the deployment is created. This is the canonical build identity variable used by health endpoints and the pre-deploy gate.

**Setting RELEASE_SHA in Replit Deployments:**

1. In the Replit deployment environment variables, add:
   ```
   RELEASE_SHA = <output of git rev-parse HEAD>
   ```
2. Example (run locally before deploying):
   ```bash
   export RELEASE_SHA=$(git rev-parse HEAD)
   bash scripts/run-pre-deploy.sh
   ```
3. The pre-deploy gate (`scripts/pre-deploy.ts`) asserts `RELEASE_SHA` is set and matches the 40-hex format before running any test suite. An invalid or missing value causes an immediate `exit 1`.

**Health endpoint behavior:**
- `GET /api/health` — returns `{ status, sha, builtAt, env }`. When `RELEASE_SHA` is valid: `status="ok"` (subject to DB). When absent/malformed: `status="release-unverified"`, `sha="unset"` (HTTP 200 to avoid false load-balancer alerts).
- `GET /api/admin/live-health` — includes `releaseSha` alongside all background-worker checks.
- `BUILD_SHA` and `BUILD_AT` are frozen at process startup — never derived at request time.

**Smoke test:**
```bash
npx tsx scripts/test-build-identity.ts
```

## External Dependencies
- **PostgreSQL**: Primary relational database.
- **OpenAI API**: For AI functionalities.
- **GoHighLevel (GHL) API**: For communication, scheduling, e-signatures, and data synchronization.
- **Serper.dev API**: For Google search and business information discovery.
- **Outscraper API**: For Google Maps bulk business data pulls.
- **Apify API**: For Yelp and Facebook business scraping.
- **Apollo.io API**: For B2B contact and company discovery.
- **`LIBERTY_TARGET_EFFECTIVE_RATE_BPS`** (env var): Liberty's target effective processing rate in basis points (e.g. `150` = 1.50%), used by `server/services/statement-analyzer.ts` to compute merchant savings estimates (`monthlyVolume × (bps / 10000)` vs. the merchant's extracted fees). If unset (outside `TEST_MODE`/`SKIP_AI`), the analyzer shows "No estimate available — rep review required" instead of a dollar figure.
- **`SLACK_AUDIT_WEBHOOK_URL`** (env var): Slack incoming webhook URL for the Weekly AI System Audit Engine. When set, audit reports are posted to Slack after each run (scheduled or manual) with overall health score %, per-subsystem statuses, and the AI narrative. Critical real-time alerts (GHL circuit breaker open, DLQ overflow) also post to this webhook immediately. If unset, Slack delivery is skipped gracefully.
- **`SYSTEM_AUDIT_CRON`** (env var): Cron expression controlling the Weekly AI System Audit schedule (default: `"0 8 * * 1"` = Monday 8 AM UTC). Accepts any standard 5-field cron expression (e.g. `"0 6 * * 1"` for Monday 6 AM, `"0 8 * * 3"` for Wednesday 8 AM). Managed via BullMQ repeat job in `server/services/queue-manager.ts`.