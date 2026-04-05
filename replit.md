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
- **External Communications**: GoHighLevel (GHL) is integrated for SMS, email, calendar management, and document e-signature, including a 2-way sync for contacts and deals.
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

## External Dependencies
- **PostgreSQL**: Primary relational database.
- **OpenAI API**: For AI functionalities.
- **GoHighLevel (GHL) API**: For communication, scheduling, e-signatures, and data synchronization.
- **Serper.dev API**: For Google search and business information discovery.
- **Outscraper API**: For Google Maps bulk business data pulls.
- **Apify API**: For Yelp and Facebook business page scraping.