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
- **Database**: PostgreSQL with Drizzle ORM.
- **Authentication**: Custom email/password authentication with session-based auth, email verification, password recovery, and role-based access control. It includes full TOTP-based two-factor authentication (2FA/MFA) with enrollment via QR code, backup codes, trusted devices, and admin-enforced MFA. CSRF protection is implemented via a double-submit cookie pattern on all authenticated routes.
- **AI Integration**: OpenAI powers AI advisors, lead enrichment, deal blueprint generation, and compliance-safe auto-replies. This includes an autonomous AI SDR pipeline, intent classification, voice AI orchestration, and a comprehensive compliance engine.
- **External Communications**: GoHighLevel (GHL) serves as the primary CRM/communications hub with a full 2-way sync engine for contacts, deals, companies, tasks, tickets, notes, tags, and activity logs. Website form submissions and pipeline actions are synchronized with GHL, including custom fields and lead source tagging. A GHL Workflow ID Manager allows for mapping sequence names to GHL workflows.
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
- **Automated Residual Reconciliation**: Allows admins to upload monthly processor residual reports (CSV/XLSX). The system parses, matches to merchant records, calculates variance, flags discrepancies, and shows per-agent reconciliation, with one-click confirmation to post residuals and trigger internal alerts.
- **Direct Processor Boarding & MID Data Pipeline**: Full NMI-style processor boarding integration for the onboarding pipeline. This includes new schema fields on `deals` for boarding status and logs, and a `mid_daily_stats` table for daily MID performance. An SLA worker runs nightly MID data ingestion.

### Feature Specifications
- **Public Website**: Marketing pages, conversion forms, legal pages, and hidden sales enablement content, optimized for SEO, including an e-commerce terminal shop.
- **Merchant Document Vault**: A per-merchant KYC and file management system within contact detail pages, supporting drag-and-drop uploads, category selection, and file management. A global admin document index is available at `/dashboard/document-vault`.
- **CRM Dashboard**: Modules for contact management, sales pipeline (Kanban), support tickets, task management, notifications, and KPI digests.
- **AI Advisors**: Seven specialized AI advisors covering Sales, Support, Onboarding, Marketing, Finance, Compliance, and Executive functions.
- **Compliance Rules**: Adherence to regulatory guidelines, including explicit disclaimers and PCI compliance.

## External Dependencies
- **PostgreSQL**: Primary relational database.
- **OpenAI API**: For AI functionalities.
- **GoHighLevel (GHL) API**: For communication, scheduling, e-signatures, and data synchronization.
- **Serper.dev API**: For Google search and business information discovery.
- **Outscraper API**: For Google Maps bulk business data pulls.
- **Apify API**: For Yelp and Facebook business scraping.
- **Apollo.io API**: For B2B contact and company discovery.