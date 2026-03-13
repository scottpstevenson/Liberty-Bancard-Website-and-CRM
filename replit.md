# Liberty Bancard AI Business Operating System

## Overview
The Liberty Bancard AI Business Operating System is an AI-powered platform for the merchant payment processing industry. It combines a public marketing website with advanced lead generation, an internal CRM for pipeline and task management, and an automated workflow engine. The system uses AI for departmental advisors and compliance-driven communication to streamline operations, enhance customer engagement, and boost sales efficiency, aiming to be a market leader.

## User Preferences
I want iterative development.
I prefer detailed explanations.
Do not make changes to the folder `node_modules`.
Do not make changes to the file `package-lock.json`.

## System Architecture
The system is built on a modern web stack, prioritizing scalability, responsiveness, and robust data management.

### UI/UX Decisions
- **Frontend**: React with Vite, TypeScript, Tailwind CSS, and shadcn/ui for a responsive UI. `wouter` for routing and `react-helmet-async` for SEO.

### Technical Implementations
- **Backend**: Express.js with TypeScript for API services.
- **Database**: PostgreSQL with Drizzle ORM.
- **Authentication**: Custom email/password authentication with session-based auth (passport-local + bcryptjs), including email verification, forgot password, and role-based access control.
- **AI Integration**: OpenAI for department-specific AI advisors, lead enrichment, scoring, deal blueprint generation, and compliance-safe AI auto-replies.
- **External Communications**: GoHighLevel (GHL) is integrated for SMS, email, calendar management, and document e-signature.

### Feature Specifications
- **Public Website**: Marketing pages, conversion forms (quiz, statement upload, estimate), legal pages, and hidden sales enablement content, all SEO-optimized and compliant. Includes SEO infrastructure, dynamic XML sitemap, industry-specific landing pages, blog, savings calculator, rate comparison tool, Help Center, AI-optimized FAQ, Why Liberty Bancard page, Case Studies, and competitor comparison pages.
- **Terminal Shop**: Public e-commerce checkout for 6 terminals, managing browse, detail, cart, and checkout flows. Orders create CRM contact, deal, and equipment_orders records. Promo codes captured from URL and stored on records.
- **Confirmation SMS**: All public form submissions (quiz, get-started, statement upload, callback, equipment order, support) send an automated confirmation SMS via GHL asking if a team member can call now (during business hours 9-5 EST) or during the next business hours window. SMS respects consent flags and includes STOP opt-out language.
- **Hidden Sales Enablement Pages**: Noindexed pages for equipment catalog, processing cost quiz, and industry/angle one-pagers.
- **SEO & Content Marketing**: Schema.org structured data across public pages. Blog with category filtering, search, and pagination. Help Center with search and structured data.
- **Legal & Compliance Pages**: 22 legal/consent pages covering privacy, terms, e-sign, SMS, TCPA, surcharging, and regulatory notices.
- **CRM Dashboard**: Modules for contact, sales pipeline (Kanban), support tickets (with auto-acknowledgment, status change notifications, and quick reply templates), task management, notifications, and KPI digests.
- **Sales Call Follow-Up System** (`/dashboard/call-outcome`): Gated follow-up workflow — log call outcome, paste Fireflies/meeting recap, AI generates personalized email + SMS drafts using OpenAI, agent reviews/edits before approving send via GHL. Outcomes auto-update deal stage, create follow-up tasks, and enroll in outcome-specific sequences. Endpoints: `POST /api/call-follow-ups/generate` and `POST /api/call-follow-ups/send`. 25 total drip sequences including 4 call-specific: Post-Call Review Follow-Up, Proposal Follow-Up, No-Show Reschedule, Long-Term Nurture.
- **AI Advisors**: Seven specialized AI advisors (Sales, Support, Onboarding, Marketing, Finance, Compliance, Executive).
- **Workflow Automation**: Centralized workflow execution engine with various action types, triggered by events, and SLA enforcement.
- **Profit Instrumentation**: Integrates merchant tier, risk, health score, average ticket, and estimated profit into deals, including a volume estimation engine.
- **Free Analysis Quiz Landing Page**: High-conversion 5-step quiz optimized for ads and affiliate sharing, providing personalized savings estimates. Integrates with CRM for contact/deal creation, lead scoring, and automated follow-ups.
- **Analytics & Ad Tracking**: GA4 (via `VITE_GA4_MEASUREMENT_ID` or `VITE_GA_ID`) and Facebook Pixel (`VITE_FB_PIXEL_ID`) tracking on all pages via auto page view tracking on route changes. Conversion events fire for: quiz completion, statement upload, equipment order, merchant application, affiliate signup, estimate request. UTM parameters captured from URL on landing, persisted in sessionStorage, and passed through all form submissions to be stored on contact (utmSource/utmMedium/utmCampaign/utmContent/utmTerm/landingPage) and deal (leadSource/campaignName) records. CRM Overview dashboard shows real-time KPIs including today's leads, weekly trend, conversion funnel, top lead sources, pipeline value, and win rate. Weekly KPI digest endpoint at `POST /api/analytics/weekly-digest`. Analytics API endpoints: `/api/analytics/lead-sources`, `/api/analytics/conversion-funnel`, `/api/analytics/daily-leads`.
- **Promo System**: Three promo offers (Free Terminal, Free Processing qualification via cash discount/surcharge program, Waived Setup Fee) with countdown timers, displayed on quiz landing and terminal shop. Promo codes are tracked end-to-end: captured from URL params (`?promo=FREE30`), persisted to localStorage, passed through quiz submission, stored on both contact (`promo_code`) and deal (`promo_code`) records, tagged in contact tags array, included in deal notes, and surfaced in sales notifications.
- **Enhanced Email Signatures**: Includes CTA buttons and affiliate tracking for marketing purposes.
- **Lead Generation & Qualification**: Bulk CSV import, AI-powered prospect enrichment, multi-step AI-personalized email campaigns, AI lead scoring, AI deal blueprint generation, and document readiness tracking. Contacts table extended with title, address, city, state, website, linkedinUrl, facebookUrl, industry, leadSource, employeeCount, annualRevenue columns.
- **Lead File Imports**: 152,805 total contacts from 8 files (Google Maps scraper CSV/XLSX, 43K lead file, 100K lead file, CC Leads June, CC Leads Automotive, 26K Brands). Auto-classified into 20+ verticals. Import scripts: `server/scripts/import-leads.ts`, `server/scripts/import-100k-leads.ts`. Sources tracked via `lead_source` column. 10,325 cross-file duplicates removed by email.
- **CSV Import Pipeline**: Universal drag-and-drop CSV import at `/api/leads/import-csv` that auto-detects Google Maps Outscraper, Apollo/lead list, and custom CSV formats. Deduplicates against existing contacts by email, phone, and company name. Auto-classifies verticals, scores leads via lead-scoring service, and creates deals for hot leads. Import history tracked in `csv_imports` table with source, date, row counts, dedup stats, vertical breakdown, and lead temperature. Dashboard at `/dashboard/lead-imports` with KPI cards, vertical distribution chart, import history table with expandable details, and Outscraper search reference for FL hot verticals.
- **Lead Command Center**: Unified dashboard for managing lead enrichment, qualified pipeline, and intelligence, with mass actions and detailed views.
- **Statement Review & Savings Proposals**: AI-powered analysis for multi-plan pricing proposals with savings calculations.
- **Multi-Step Merchant Application**: Public 6-step wizard for merchant signup, including e-signature via GHL.
- **Merchant Self-Service Portal**: Dashboard for merchants to view account status, onboarding progress, documents, and support tickets.
- **Compliance Rules**: Adherence to regulatory guidelines, including explicit disclaimers and PCI compliance features.
- **Outreach Command Center**: Full pipeline dashboard for managing the automated sales lifecycle, including Sunbiz entity import, AI enrichment/classification, lead scoring, deal creation, GHL sync, and daily automated outreach.
- **Sunbiz Data Imports**: Streamed processing of large Sunbiz corporate databases (corevt and cordata) for entity enrichment, with efficient bulk upsert mechanisms.
- **Enhanced Enrichment Pipeline**: 909K active FL businesses organized by vertical. Pure-SQL keyword classification (183K into 15 verticals), 88K unqualified filtered out, 308K cold for AI reclassification. Deep enrichment with self-healing (timeout/retry per step) finds email/phone/website via Serper.dev API (primary) with YellowPages/Yelp/contact page scraping as fallback. API endpoints: `/api/sunbiz/enrichment-dashboard`, `/api/sunbiz/run-pipeline`, `/api/sunbiz/bulk-ai-classify`, `/api/sunbiz/deep-enrich/:id`, `/api/sunbiz/deduplicate`, `/api/sunbiz/verticals`.
- **Serper.dev Integration**: Search API client (`server/services/serper.ts`) replaces raw Google scraping (which gets CAPTCHA'd). Functions: `searchBusiness()`, `searchBusinessEmail()`, `searchBusinessContacts()` with rate limiting (10 req/sec), usage tracking, and graceful fallback to raw Google when SERPER_API_KEY is not set. Usage tracked in system settings and displayed on enrichment dashboard. API endpoints: `/api/serper/status`, `/api/serper/reset-usage`.
- **Contact Batch Enrichment**: Endpoint `/api/contacts/enrich-batch` enriches imported contacts missing email/phone using Serper search. Progress tracking via `/api/contacts/enrich-progress`.
- **2-Way GHL Sync**: Bidirectional synchronization of contacts and deals with GoHighLevel.
- **Daily Outreach Automation**: Background worker for continuous enrichment, promotion of qualified leads, deal creation, GHL syncing, and automated campaign messages with daily limits.
- **Affiliate / Sales Team Program**: Public signup for sales reps with optional email/password login, unique referral codes, 30-day cookie-based attribution, performance tracking, affiliate leaderboard, tiered commission rates, monthly payout reports, pre-built marketing materials library, and an admin dashboard with commission tier management.
- **Additional Modules**: Features for residual revenue, agent management, merchant health, competitive tracking, partner programs, knowledge base, testimonial requests, onboarding tracking, equipment order management, calendar booking, revenue forecasting, analytics, quota tracking, CSV export, bulk messaging, document storage, activity timeline, welcome notifications, and data retention.

## External Dependencies
- **PostgreSQL**: Primary database.
- **OpenAI API**: AI advisors, lead enrichment, scoring, deal blueprint generation, and AI auto-replies.
- **GoHighLevel (GHL) API**: Contact sync, email/SMS sending, calendar management, inbound webhooks, and e-signature.
- **Serper.dev API**: Google search API for business website discovery and contact enrichment ($50/50K searches). Env var: `SERPER_API_KEY`.
- **Passport.js**: Authentication framework (passport-local + bcryptjs).
- **Multer**: Handles `multipart/form-data` for file uploads.