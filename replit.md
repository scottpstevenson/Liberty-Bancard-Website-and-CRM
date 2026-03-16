# Liberty Bancard AI Business Operating System

## Overview
The Liberty Bancard AI Business Operating System is an AI-powered platform for the merchant payment processing industry. It combines a public marketing website with advanced lead generation, an internal CRM for pipeline and task management, and an automated workflow engine. The system uses AI for departmental advisory roles and compliance-driven communication to optimize operations, improve customer engagement, and enhance sales efficiency, with the goal of achieving market leadership.

## User Preferences
I want iterative development.
I prefer detailed explanations.
Do not make changes to the folder `node_modules`.
Do not make changes to the file `package-lock.json`.

## System Architecture
The system is built on a modern web stack, emphasizing scalability, responsiveness, and robust data management.

### UI/UX Decisions
The frontend uses React with Vite, TypeScript, Tailwind CSS, and shadcn/ui for a responsive user interface. `wouter` is used for routing and `react-helmet-async` for SEO. The design incorporates specific color schemes and templates for a professional and intuitive user experience, including a public marketing website, a terminal shop, legal/compliance pages, and CRM dashboards.

### Technical Implementations
- **Backend**: Express.js with TypeScript.
- **Database**: PostgreSQL with Drizzle ORM.
- **Authentication**: Custom email/password authentication with session-based auth (passport-local + bcryptjs), email verification, password recovery, and role-based access control.
- **AI Integration**: OpenAI powers AI advisors, lead enrichment, deal blueprint generation, and compliance-safe auto-replies.
- **External Communications**: GoHighLevel (GHL) is integrated for SMS, email, calendar management, and document e-signature.
- **Analytics & Tracking**: GA4 and Facebook Pixel for analytics, conversion tracking, and UTM parameter capture.
- **Promo System**: Dynamic promotion display and tracking with end-to-end code persistence from URL to CRM.
- **Lead Management**: AI-powered prospect enrichment, multi-step personalized email campaigns, lead scoring, deal blueprint generation, and a universal CSV import pipeline with auto-detection, deduplication, and vertical classification.
- **Sales Workflow**: Gated sales call follow-up system generates personalized email and SMS drafts via AI.
- **Workflow Automation**: Centralized engine for various actions triggered by events, with SLA enforcement.
- **Profit Instrumentation**: Integrates merchant tier, risk, health scores, and profit estimates into deal management.
- **Statement Review & Proposals**: AI-powered analysis generates multi-plan pricing proposals and automates proposal delivery.
- **Merchant Application & Portal**: A multi-step merchant application wizard with e-signature and a self-service portal for account management.
- **Outreach & Enrichment**: An Outreach Command Center manages automated sales lifecycles, including Sunbiz entity imports, AI enrichment/classification, lead scoring, and daily automated outreach. The enrichment pipeline includes deep enrichment with Serper.dev integration for email/phone/website discovery.
- **AI SDR Pipeline**: An autonomous lead development system with a 24-stage pipeline, GHL sync, and two-way webhook integration for real-time updates and compliance. Week 3 adds: Reply Intelligence (GPT-4o-mini intent classification of 12 labels with intent-to-action mapping), Voice AI Orchestrator (6 bot modes with TCPA-compliant business hours enforcement), Booking/Scheduling integration (GHL calendar selection, booking links, appointment lifecycle), and a full Compliance Engine (consent checks, DNC, quiet hours, daily limits, bounce/complaint history, compliance dashboard).
- **Florida Vertical Playbooks**: Specialized playbooks for Florida Auto, Med Spa, and Medical/Dental sectors. Includes industry-specific seed sequences (22-24), vertical-specific scoring boosts (100% for FL, 70% for non-FL), custom Voice AI scripts, and automated compliance handling (surcharging disclosures, FDACS registration, PHI disclaimers).
- **Affiliate Program**: Public signup with referral codes, cookie-based attribution, performance tracking, tiered commissions, and an admin dashboard.
- **Conversion Optimization**: A/B testing framework, enhanced thank-you pages with calendar booking links, and detailed GA4 tracking.

### Feature Specifications
- **Public Website**: Marketing pages, conversion forms (quiz, statement upload, estimate), legal pages, and hidden sales enablement content, all SEO-optimized. Includes SEO infrastructure, dynamic XML sitemap, industry-specific landing pages, blog, savings calculator, rate comparison tool, Help Center, AI-optimized FAQ, and case studies.
- **Terminal Shop**: Public e-commerce checkout for 6 terminals, managing browse, detail, cart, and checkout flows.
- **Confirmation SMS**: Automated SMS via GHL for all public form submissions.
- **CRM Dashboard**: Modules for contact, sales pipeline (Kanban), support tickets, task management, notifications, and KPI digests.
- **Sales Call Follow-Up System**: Gated workflow for logging call outcomes, AI-generated personalized email/SMS drafts, and automatic deal stage updates.
- **AI Advisors**: Seven specialized AI advisors (Sales, Support, Onboarding, Marketing, Finance, Compliance, Executive).
- **Free Analysis Quiz Landing Page**: High-conversion 5-step quiz providing personalized savings estimates, integrated with CRM.
- **Analytics & Ad Tracking**: GA4 and Facebook Pixel tracking with conversion events for key user actions. UTM parameters are captured and persisted.
- **Promo System**: Three promo offers (Free Terminal, Free Processing, Waived Setup Fee) with countdown timers, tracked end-to-end.
- **Lead Generation & Qualification**: Bulk CSV import, AI-powered enrichment, multi-step email campaigns, AI lead scoring, AI deal blueprint generation, and document readiness tracking.
- **CSV Import Pipeline**: Universal drag-and-drop CSV import with auto-detection, deduplication, vertical classification, lead scoring, and import history tracking.
- **Statement Review & Savings Proposals**: AI-powered analysis for multi-plan pricing proposals, automated email delivery via GHL, and manual override options.
- **Multi-Step Merchant Application**: Public 6-step wizard for merchant signup, including e-signature via GHL.
- **Merchant Self-Service Portal**: Dashboard for merchants to view account status, onboarding progress, and support tickets.
- **Compliance Rules**: Adherence to regulatory guidelines, including explicit disclaimers and PCI compliance.
- **Outreach Command Center**: Full pipeline dashboard for managing automated sales lifecycle, including Sunbiz entity import, AI enrichment/classification, lead scoring, deal creation, and GHL sync.
- **Enhanced Enrichment Pipeline**: Processing of Sunbiz data, SQL keyword classification, and deep enrichment via Serper.dev API and web scraping.
- **Serper.dev Integration**: Search API client for business information discovery, with rate limiting and usage tracking.
- **2-Way GHL Sync**: Bidirectional synchronization of contacts and deals with GoHighLevel, including custom field and tag management.
- **AI SDR Pipeline Brain**: Autonomous sales development engine with 4-dimension scoring, orchestrator sweep for stage processing, AI-personalized email/SMS outreach via GHL, channel escalation, daily limits, and quiet hours enforcement.
- **Inbox Rotation & Deliverability Engine**: Multi-inbox sending identity management with intelligent rotation (lowest sends → best health score → domain diversity), warmup scheduling (5/day ramping +3/day over 14 days), auto-pause on high bounce/complaint rates, 7-day rolling health scoring, domain-level deduplication to prevent same-domain sends to same business, and admin dashboard at `/dashboard/inbox-health`. Schema: `sending_identities`, `identity_performance_daily`, `domain_business_log`.
- **Affiliate / Sales Team Program**: Public signup for sales reps with referral codes, cookie-based attribution, performance tracking, tiered commissions, and marketing materials.

## External Dependencies
- **PostgreSQL**: Primary relational database.
- **OpenAI API**: For AI functionalities like advisory, content generation, and lead processing.
- **GoHighLevel (GHL) API**: For communication (SMS, email), calendar scheduling, e-signatures, and data synchronization.
- **Serper.dev API**: For Google search capabilities, business information discovery, and contact enrichment.
- **Passport.js**: For authentication strategies (`passport-local` with `bcryptjs`).
- **Multer**: For handling `multipart/form-data` uploads.