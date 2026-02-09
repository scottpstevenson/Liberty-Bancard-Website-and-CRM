# Liberty Bancard AI Business Operating System

## Overview
Complete AI-powered business operating system for Liberty Bancard, a merchant payment processing company. Built with Express + React + PostgreSQL. Includes a full public marketing website with lead generation, internal CRM dashboard with pipeline management, automated workflow engine with SLA enforcement, GHL (GoHighLevel) integration for communications, AI advisors for 7 departments, and compliance-first messaging throughout.

## Architecture
- **Frontend**: React + Vite + TypeScript + Tailwind CSS + shadcn/ui
- **Backend**: Express + TypeScript
- **Database**: PostgreSQL via Drizzle ORM
- **Auth**: Replit Auth (OIDC)
- **AI**: OpenAI integration for department-specific AI advisors
- **Routing**: wouter (frontend), Express (backend)
- **SEO**: react-helmet-async for per-page meta tags
- **Communications**: GHL (GoHighLevel) as external communications layer (SMS/email/calendar)

## Project Structure
```
client/src/
  pages/
    Home.tsx - Landing page with hero, services, trust, FAQ
    GetStarted.tsx - Multi-step lead generation quiz
    UploadStatement.tsx - Statement upload form
    ZeroPercent.tsx - 0% processing program page
    BeatSquareStripe.tsx - Comparison vs flat-rate processors
    AboutContact.tsx - Company info + contact form
    Estimate.tsx - Quick estimate request form
    Support.tsx - Support ticket submission
    PrivacyPolicy.tsx, Terms.tsx - Legal pages
    Thanks*.tsx - 4 thank-you/confirmation pages
    AssetPage.tsx - Dynamic sales enablement pages (30+ hidden pages)
    DashboardLayout.tsx - Dashboard sidebar layout
    dashboard/
      Overview.tsx - KPI digest with real-time pipeline/support/task metrics
      Contacts.tsx - Contact management
      Pipeline.tsx - Sales pipeline Kanban board
      Onboarding.tsx - Onboarding pipeline Kanban board
      Tickets.tsx - Support ticket management
      Tasks.tsx - Task management
      Notifications.tsx - Notification center
      Chat.tsx - AI Business Advisor (7 departments)
      CallOutcome.tsx - Sales call outcome form
      ReviewComplete.tsx - Statement review complete form
      OnboardingKickoff.tsx - Onboarding kickoff form
      CaseStudyIntake.tsx - Case study intake form
      GhlSettings.tsx - GHL connection status + activity logs
      Automation.tsx - KPI summary + workflow management
      Prospects.tsx - Prospect list with search, filter, enrichment triggers
      ProspectImport.tsx - CSV bulk upload with drag-drop and list management
      Campaigns.tsx - Campaign creation, step management, activation
      OutreachAnalytics.tsx - KPI cards, campaign performance, message activity
  components/
    Navbar.tsx - Public site navigation with compliance
    Footer.tsx - Full footer with disclaimers
    SEO.tsx - Reusable SEO meta tag component
    ui/ - shadcn/ui components
server/
  routes.ts - All API routes
  storage.ts - Storage interface (IStorage)
  db.ts - Database connection
  services/
    ghl.ts - GoHighLevel API integration service
    sla-worker.ts - SLA timer with 5-minute interval checks
    seed-workflows.ts - Pre-built workflow/template/SLA seeding
    enrichment.ts - AI prospect enrichment (website scraping, OpenAI classification, scoring)
    campaign-engine.ts - Campaign queue builder, AI email personalization, send scheduler
shared/
  schema.ts - Drizzle schema + types
```

## Key Features Built
1. **Public Website**: Home + 6 marketing pages + 3 conversion forms + quiz + 2 legal + 4 thank-you pages + SEO meta tags on all pages
2. **Sales Enablement**: 30+ hidden pages (asset library + pitch packet hubs) via AssetPage
3. **CRM Dashboard**: Pipeline (sales/onboarding), contacts, tickets, tasks, notifications, KPI digest
4. **Internal Forms**: Call Outcome, Statement Review Complete, Onboarding Kickoff, Case Study Intake
5. **AI Advisors**: 7 department-specific advisors (Sales, Support, Onboarding, Marketing, Finance, Compliance, Executive)
6. **Compliance**: Microlines and disclaimers throughout; no savings claims without statement review
7. **Workflow Automation**: 9 pre-built workflows with triggers (deal_stage_changed, ticket_created, contact_created, etc.) and 10 action types including GHL email/SMS, packet sending, proposal generation, deal updates
8. **RFI System**: Request for Information tracking with categories, priority levels, assignment, response tracking, status workflow
9. **GHL Integration**: Contact sync, email/SMS sending via templates, calendar booking, webhook handling, merge field templating
10. **SLA Enforcement**: Automated SLA monitoring (Statement Review 2hr, New Lead 24hr, Proposal 48hr, Call 24hr, Support 4hr) with escalation
11. **Profit Instrumentation**: Merchant tier, risk tier, health score, avg ticket, estimated profit fields on deals
12. **Lead Generation Engine**: Bulk CSV prospect import, AI enrichment (website scraping, business categorization, scoring), multi-step campaign sequences with AI-personalized emails, ~2k/day send rate via GHL, open/reply/bounce tracking

## Database Tables
contacts, deals, tickets, tasks, notifications, documents, auditLogs, workflows, workflowRuns, rfis, conversations, messages, users, sessions, messageTemplates, collateralPackets, ghlActivityLog, slaConfigs, prospectLists, prospects, enrichmentJobs, campaigns, campaignSteps, outboundMessages

## API Routes
- GET/POST /api/contacts, /api/deals, /api/tickets, /api/tasks, /api/notifications
- PUT /api/deals/:id, /api/tickets/:id, /api/tasks/:id
- GET/POST /api/workflows, PUT/DELETE /api/workflows/:id, POST /api/workflows/:id/run
- GET /api/workflow-runs
- GET/POST /api/rfis, PUT /api/rfis/:id
- POST /api/ai/chat (department-specific AI advisor)
- GET/POST /api/conversations (chat history)
- GET /api/user, POST /api/login, /api/logout (auth)
- GET /api/kpi/summary (real-time KPI metrics)
- POST /api/ghl/webhook (GHL inbound webhook)
- GET /api/ghl/status, /api/ghl/activity (GHL settings)
- GET /api/message-templates, /api/collateral-packets, /api/sla-configs
- POST /api/public/callback (quick callback form)
- GET/POST /api/prospect-lists (prospect list management)
- GET/POST /api/prospects, PUT /api/prospects/:id (prospect CRUD)
- POST /api/prospects/import (CSV bulk upload with multer)
- GET/POST /api/enrichment-jobs, POST /api/enrichment/process-queue (AI enrichment)
- GET/POST /api/campaigns, PUT /api/campaigns/:id (campaign management)
- GET/POST /api/campaigns/:id/steps (campaign step management)
- GET /api/campaigns/:id/analytics (campaign performance stats)
- POST /api/campaigns/:id/queue (queue campaign messages)
- GET /api/outbound-messages (outbound message list)
- POST /api/outbound/process-queue (trigger send queue processing)
- POST /api/outbound/webhook (tracking webhook for opens/replies/bounces)

## Environment Variables
- DATABASE_URL - PostgreSQL connection
- SESSION_SECRET - Session signing key
- GHL_API_KEY - GoHighLevel API key (optional, for GHL integration)
- GHL_LOCATION_ID - GoHighLevel location ID (optional)
- GHL_CALENDAR_ID - GoHighLevel calendar ID (optional)

## Compliance Rules
- Never promise savings without statement review
- No legal/tax advice language
- All pricing mentions include: "Eligibility, underwriting, card brand rules, and applicable laws apply"
- No PCI data storage (full card numbers, SSNs, bank account numbers)

## Recent Changes
- Built GHL integration service layer with contact sync, email/SMS, calendar booking, webhooks
- Extended workflow engine with 10 action types (send_ghl_email, send_ghl_sms, send_packet, update_contact_tags, generate_proposal, request_review, update_deal, create_task, send_notification, create_audit_log)
- Implemented SLA timer system with 5-minute scheduled checks and automatic escalation
- Seeded 9 pre-built workflows, 8 message templates, 6 collateral packets, 5 SLA configurations
- Added profit instrumentation fields to deals schema
- Created Case Study Intake, GHL Settings, and Automation dashboard pages
- Added SEO meta tags with react-helmet-async to all public pages
- Enhanced Overview dashboard with real-time KPI data (pipeline stats, conversion rates, support metrics, onboarding status)
- Conversion enhancers: StickyMobileCTA, ExitIntentPopup, ContactBubble all active on public pages
- Built Lead Generation & Qualification Engine: prospect_lists, prospects, enrichment_jobs, campaigns, campaign_steps, outbound_messages tables
- AI enrichment service with website scraping, OpenAI classification, hot/warm/cold/unqualified scoring
- Campaign engine with multi-step email sequences, AI personalization, 2k/day GHL send rate limit
- CSV bulk import with smart column mapping (30+ column aliases supported)
- Dashboard pages: Prospects list, Import Prospects (drag-drop CSV), Campaigns builder, Outreach Analytics
- Webhook endpoint for tracking opens, replies, bounces, unsubscribes
- AI Automation: 10 AI action buttons wired across Tasks/Pipeline/Prospects pages, AI Command Center with run-all, scheduled background AI ops (every 30 min)
- Activity Timeline on Contacts page: unified audit + GHL activity log per contact with icons, relative timestamps
- AI Ticket Classification: auto-categorization with suggested responses on ticket creation
- Onboarding Automation: 7-step milestone progress tracker, terminal shipping status workflow, AI next-step recommendations, progress bars
- Reporting/Analytics dashboard: pipeline velocity, support performance, task analytics, stage distribution, KPI cards
- AI Statement Analysis on upload page: fee analysis, program recommendations, key findings
- Form-to-workflow triggers: all form submissions auto-trigger matching workflows, external webhook trigger endpoint
- GET /api/activity endpoint for unified activity timeline (audit logs + GHL activity)
