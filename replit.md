# Liberty Bancard AI Business Operating System

## Overview
The Liberty Bancard AI Business Operating System is an AI-powered platform for the merchant payment processing industry. It integrates a public marketing website, advanced lead generation, an internal CRM for pipeline and task management, and an automated workflow engine. The system leverages AI for departmental advisory roles and compliance-driven communication to optimize operations, enhance customer engagement, and improve sales efficiency, aiming for market leadership.

## User Preferences
I want iterative development.
I prefer detailed explanations.
Do not make changes to the folder `node_modules`.
Do not make changes to the file `package-lock.json`.

## System Architecture
The system is built on a modern web stack, emphasizing scalability, responsiveness, and robust data management.

### UI/UX Decisions
The frontend uses React with Vite, TypeScript, Tailwind CSS, and shadcn/ui. `wouter` is used for routing and `react-helmet-async` for SEO. The design incorporates specific color schemes and templates for a professional and intuitive user experience across the public marketing website, terminal shop, legal/compliance pages, and CRM dashboards.

### Technical Implementations
- **Backend**: Express.js with TypeScript. API routes are split into 21 domain-specific modules in `server/routes/` (contacts, deals, tickets-tasks, documents, notifications, public, workflows, ai, integrations, templates-settings, analytics, prospects, campaigns, search, activity, merchants, admin, partners, crm-operations, imports, sdr) with shared helpers in `server/routes/helpers.ts`. The main `server/routes.ts` is a thin orchestrator that registers each module.
- **Database**: PostgreSQL with Drizzle ORM.
- **Authentication**: Custom email/password authentication with session-based auth, email verification, password recovery, and role-based access control.
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
- **Outreach & Enrichment**: An Outreach Command Center manages automated sales lifecycles, including Sunbiz entity imports, AI enrichment/classification, lead scoring, and daily automated outreach. Deep enrichment with Serper.dev integration for email/phone/website discovery.
- **AI SDR Pipeline**: An autonomous lead development system with a 24-stage pipeline, GHL sync, two-way webhook integration, Reply Intelligence (GPT-4o-mini intent classification), Voice AI Orchestrator (6 bot modes with TCPA compliance), Booking/Scheduling integration, and a full Compliance Engine (consent checks, DNC, quiet hours, daily limits, bounce/complaint history).
- **Florida Vertical Playbooks**: Specialized playbooks for Florida Auto, Med Spa, and Medical/Dental sectors, including industry-specific seed sequences, vertical-specific scoring boosts, custom Voice AI scripts, and automated compliance handling.
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
- **AI SDR Pipeline Brain**: Autonomous sales development engine with 4-dimension scoring, orchestrator sweep for stage processing, AI-personalized email/SMS outreach via GHL, channel escalation, daily limits, and quiet hours enforcement. Week 4 additions: statement request flow with upload tokens and 3-step reminders (Day 2/5/7), proposal tracking with view/click events and auto-resend logic, human handoff system (LB-HUMAN-HANDOFF/LB-DO-NOT-AUTO GHL tags), no-show recovery with 3-attempt escalation, terminal shipping trigger on CLOSED_WON (auto equipment order + welcome email + tracking notification), 7 SDR launch sequences (Cold Outbound for Auto Repair/Med Spa/Dental, Reply Engaged, Statement Chase, Proposal Follow-Up, No-Show Recovery), and enhanced 4-tab SDR dashboard (Summary with closedWon/humanOwned metrics, Pipeline Funnel with conversion rates, Stuck Leads with stageAgeDays/handoff buttons, Channel Health with daily limit bars and no-answer rates).
- **Conversation AI & Chat Widget**: GHL chat widget embedded on all public pages via `client/src/components/ChatWidget.tsx` (env var `VITE_GHL_CHAT_WIDGET_ID`). 6 bot contexts (Homepage, 4 vertical-specific: restaurant/medspa/dental/auto, Existing Lead) route based on page URL. Chat leads auto-create merchants at DISCOVERED stage. Handoff logic detects explicit human requests, angry intent, complex pricing, and low-confidence responses; handoff disables GHL Conversation AI on the contact thread (`disableConversationAi`), sets `lb_owner_type=human`, tags `LB-CHAT-HANDOFF`, and creates internal notification. SMS and email thread handlers (`sms-thread`, `email-thread` webhooks) with AI reply generation. Chat analytics (initiated/messages/leads/bookings/handoffs/handoff rate/conversion rate) displayed in SDR Dashboard "Chat AI" tab. Setup guide: `docs/ghl-conversation-ai-setup.md`. Files: `server/services/sdr/conversation-ai.ts`, `server/services/sdr/chat-handlers.ts`, `server/services/sdr/ghl-client.ts`.
- **Processor Detection & Tech Stack Intelligence**: Automated detection of merchant payment processors (Square, Stripe, Toast, Clover, Shopify, PayPal), booking platforms (Mindbody, Vagaro, Boulevard), and POS systems (NCR) from website HTML/scripts, meta tags, and Serper search fallback. Ad detection for Facebook Pixel and Google Ads tracking codes. Schema: `processor_signals` (business_id, signal_type, vendor_name, detection_method, confidence_score, evidence), `ad_signals` (business_id, platform, is_running_ads, confidence_score, ad_count_estimate, evidence). Scoring engine adds processor_score (0-100) and growth_score (0-100) dimensions with weighted priority: fit(25%), revenue(20%), reachability(15%), processor(15%), growth(10%), composite(15%). Processor-specific outreach templates for Square, Stripe, Toast, Clover, PayPal, Shopify with confidence threshold (≥0.70). Processor Intelligence dashboard tab shows distribution, coverage rate, ad platform stats, and switchable targets. API routes: GET/POST processor-signals, detect-processors, ad-signals, detect-ads, processor-intelligence. Files: `server/services/sdr/processor-detector.ts`, `server/services/sdr/ad-detector.ts`.
- **Inbox Rotation & Deliverability Engine**: Multi-inbox sending identity management with intelligent rotation (lowest sends → best health score → domain diversity), warmup scheduling (5/day ramping +3/day over 14 days), auto-pause on high bounce/complaint rates, 7-day rolling health scoring, domain-level deduplication to prevent same-domain sends to same business, and admin dashboard at `/dashboard/inbox-health`. Schema: `sending_identities`, `identity_performance_daily`, `domain_business_log`.
- **Canonical Business Identity & Dedupe Engine**: Business-centric data model with `businesses` as the single source of truth, `business_aliases` for alternate names, `business_locations` for multi-location brands, `lead_sources` for source attribution/ROI tracking, and `enrichment_runs` for enrichment pass logging. Weighted dedupe engine (domain=50, phone=40, google_place_id=60, name+city=25, address=20) prevents duplicate outreach. Migration bridge converts existing contacts to business records with deduplication. SDR pipeline tables (sdr_merchants, sdr_lead_state) reference business_id for business-centric operations.
- **Nightly Lead Discovery Engine**: Automated lead discovery system that finds 500-2,000 new merchants daily across Florida's target verticals (Auto repair, Med spa, Dental, Chiropractic, Restaurant, Medical). Searches configured by vertical × metro matrix via Outscraper (Google Maps), Apify (Yelp/Facebook), and Serper (niche directories). Features include: configurable search matrix stored in system settings, canonical deduplication against existing sdr_merchants, automatic SDR lead state creation, enrichment queue integration, nightly scheduler (2 AM EST), manual trigger capability, cost tracking per source, and a Discovery dashboard tab with real-time stats (leads found/inserted/dedup rate), vertical/metro/source breakdowns, and job history. Schema: `lead_discovery_jobs`, `lead_discovery_results`. Files: `server/services/sdr/lead-finder.ts`, `server/services/sdr/outscraper.ts`, `server/services/sdr/apify.ts`.
- **Lookalike Scoring Model**: Profiles closed-won merchants to build a "best merchant profile" and scores pipeline leads by similarity. Applies up to 20-point priority boost to matching leads. Considers vertical distribution, geography, website/email/phone presence, location count, fit score, and revenue score. Files: `server/services/sdr/lookalike.ts`.
- **Re-enrichment Worker**: Identifies businesses last enriched 60+ days ago and rechecks for new email, phone, website changes, review count increases, and multi-location expansion. Updates scores and requalifies leads from nurture if data improves. Runs weekly on a configurable schedule. Files: `server/services/sdr/re-enrichment.ts`.
- **Daily Funnel Metrics & KPI Reporting**: Nightly aggregation of funnel metrics with breakdowns by date, vertical, state, and source type. Tracks leads found/enriched, hot/warm leads, emails/SMS/calls, replies, meetings, statements, proposals, closed won/lost. Schema: `daily_funnel_metrics`. Files: `server/services/sdr/funnel-metrics.ts`.
- **Source Quality Dashboard**: Shows per source type: leads generated, enrichment rate, reply rate, meeting rate, statement rate, close rate. Helps identify which lead sources to scale or cut.
- **Identity Health Dashboard**: Shows per sending identity: domain, sent today, bounce %, reply %, complaint %, health score. Alerts on degraded inboxes.
- **Market Expansion Logic**: Tracks market penetration by state and metro with estimated addressable market. Auto-suggests expanding to next state when pipeline utilization exceeds 80%.
- **Enhanced Weekly KPI Digest**: The weekly email digest now includes full SDR funnel metrics (top/mid/bottom funnel), vertical performance comparison, source quality table, inbox health alerts, and market expansion recommendations.
- **Affiliate / Sales Team Program**: Public signup for sales reps with referral codes, cookie-based attribution, performance tracking, tiered commissions, and marketing materials.

## External Dependencies
- **PostgreSQL**: Primary relational database.
- **OpenAI API**: For AI functionalities.
- **GoHighLevel (GHL) API**: For communication, scheduling, e-signatures, and data synchronization.
- **Serper.dev API**: For Google search and business information discovery.
- **Outscraper API**: For Google Maps bulk business data pulls.
- **Apify API**: For Yelp and Facebook business page scraping.
- **Passport.js**: For authentication strategies.
- **Multer**: For handling file uploads.