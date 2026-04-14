# Liberty Bancard AI Business Operating System

## Overview
The Liberty Bancard AI Business Operating System is an AI-powered platform for the merchant payment processing industry. It integrates a public marketing website, lead generation, an internal CRM for pipeline and task management, and an automated workflow engine. The system uses AI for departmental advisory roles and compliance-driven communication to optimize operations, enhance customer engagement, and improve sales efficiency, aiming for market leadership.

## User Preferences
I want iterative development.
I prefer detailed explanations.
Do not make changes to the folder `node_modules`.
Do not make changes to the file `package-lock.json`.

## System Architecture
The system is built on a modern web stack, emphasizing scalability, responsiveness, and robust data management.

### UI/UX Decisions
The frontend uses React with Vite, TypeScript, Tailwind CSS, and shadcn/ui. `wouter` is used for routing and `react-helmet-async` for SEO. The design includes specific color schemes and templates for a professional user experience across public marketing, terminal shop, legal/compliance pages, and CRM dashboards.

### Technical Implementations
- **Backend**: Express.js with TypeScript, organizing API routes into domain-specific modules.
- **Database**: PostgreSQL with Drizzle ORM.
- **Authentication**: Custom email/password authentication with session-based auth, email verification, password recovery, and role-based access control.
- **AI Integration**: OpenAI powers AI advisors, lead enrichment, deal blueprint generation, and compliance-safe auto-replies. Includes an autonomous AI SDR pipeline with intent classification, voice AI orchestration, and a comprehensive compliance engine.
- **External Communications**: GoHighLevel (GHL) serves as the primary CRM/communications hub with a full 2-way sync engine for contacts, deals, companies, tasks, tickets, notes, tags, and activity logs, running on a 45-second auto-loop. All website form submissions sync to GHL with custom fields and lead source tagging. GHL workflow enrollment bridge allows sequences to delegate to native GHL workflows, while platform emails (password reset, verification) remain in the Replit app. A GHL Workflow ID Manager at `/dashboard/ghl-workflows` provides a DB-backed admin UI for mapping sequence names to GHL workflow IDs (env var takes priority, then DB, then hardcoded map). Canonical pipeline stage names: `New Lead → Statement Received → Review In Progress → Call Booked → Proposal Sent → Negotiation / Follow-Up → Verbal Commit → Closed Won / Closed Lost`. Closed Won auto-creates an onboarding pipeline deal and fires a merchant welcome email. Statement upload form submissions always trigger the GHL workflow via `sequenceName` resolution.
- **Analytics & Tracking**: GA4 and Facebook Pixel for analytics, conversion tracking, and UTM parameter capture.
- **Lead Management**: AI-powered prospect enrichment, multi-step personalized email campaigns, lead scoring, deal blueprint generation, universal CSV import, and a Nightly Lead Discovery Engine.
- **Workflow Automation**: Centralized engine for event-triggered actions with SLA enforcement.
- **Profit Instrumentation**: Integrates merchant tier, risk, health scores, and profit estimates into deal management.
- **Statement Review & Proposals**: AI-powered analysis for multi-plan pricing proposals and automated delivery.
- **Merchant Application & Portal**: Multi-step application wizard with e-signature and a self-service portal.
- **Outreach & Enrichment**: Outreach Command Center managing automated sales lifecycles, including Sunbiz entity imports, AI enrichment/classification, deep enrichment via Serper.dev, Processor Detection, and Tech Stack Intelligence.
- **Affiliate Program**: Public signup with referral codes, cookie-based attribution, performance tracking, and tiered commissions.
- **Conversation AI**: GHL chat widget integration with bot contexts, AI reply generation, and human handoff logic.
- **Go-Live Activation System**: Runtime feature flags (`SDR_ENABLED`, `ORCHESTRATOR_ENABLED`, etc.) gate system behaviors. Health endpoints provide operational readiness. Kill-switch and global pause/resume controls manage outbound communications. Admin Activation Panel at `/dashboard/activation` provides Day 1 go-live control.
- **Inbox Rotation & Deliverability Engine**: Multi-inbox sending identity management with intelligent rotation, warmup scheduling, auto-pause on high bounce/complaint rates, and health scoring.
- **Canonical Business Identity & Dedupe Engine**: Business-centric data model with a weighted deduplication engine.
- **Operator Dashboard**: Pilot instrumentation dashboard at `/dashboard/operator` with 7 KPIs, time range toggle, per-identity send monitoring, webhook event log viewer, stuck lead alerts, low-confidence intent classification flagging, and on-demand daily digest sending. Includes Anomaly Alerts, SMS Metrics, Voice AI Status, Serper Enrichment, and Discovery Controls tabs.
- **Anomaly Detection Monitoring**: Automated detection of send volume deviations, reply rate drops, inbox bounce spikes, and inbox health degradation, with alerts surfaced on the dashboard.
- **Calendar Booking Automation**: Meeting-intent reply classification triggers automatic booking link generation via GHL scheduling integration.

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