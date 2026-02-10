# Liberty Bancard AI Business Operating System

## Overview
This project is an AI-powered business operating system designed for Liberty Bancard, a merchant payment processing company. It integrates a public marketing website with lead generation capabilities, an internal CRM dashboard for pipeline and task management, and an automated workflow engine with SLA enforcement. The system includes GHL (GoHighLevel) integration for communication, AI advisors for various departments, and a strong emphasis on compliance in all messaging. The vision is to provide a comprehensive solution that streamlines operations, enhances customer engagement, and drives sales efficiency in the payment processing industry.

## User Preferences
I want iterative development.
I prefer detailed explanations.
Do not make changes to the folder `node_modules`.
Do not make changes to the file `package-lock.json`.

## System Architecture
The system is built on a modern web stack:
- **Frontend**: React with Vite, TypeScript, Tailwind CSS, and shadcn/ui for a modern, responsive user interface. `wouter` is used for client-side routing. `react-helmet-async` manages SEO meta tags.
- **Backend**: Express.js with TypeScript handles API services.
- **Database**: PostgreSQL is used for data persistence, accessed via Drizzle ORM.
- **Authentication**: Replit Auth (OIDC) is integrated for secure user authentication.
- **AI Integration**: OpenAI provides department-specific AI advisors and powers lead enrichment, scoring, and deal blueprint generation.
- **External Communications**: GoHighLevel (GHL) is the primary platform for SMS, email, and calendar management, deeply integrated with the system.
- **Core Features**:
    - **Public Website**: Features marketing pages, conversion forms (quiz, statement upload, estimate), and legal pages, all optimized for SEO and compliance. Includes 30+ hidden sales enablement pages.
    - **CRM Dashboard**: Provides modules for contact management, sales and onboarding pipelines (Kanban), support ticket management, task tracking, notifications, and KPI digests.
    - **AI Advisors**: Seven specialized AI advisors (Sales, Support, Onboarding, Marketing, Finance, Compliance, Executive) offer guidance and automation.
    - **Workflow Automation**: A centralized workflow execution engine (`server/services/workflow-executor.ts`) with 12+ action types (create_task, send_ghl_email, send_ghl_sms, wait/resume, enroll_sequence, update_contact_tags, send_packet, generate_proposal, request_review, update_deal, send_notification, create_audit_log) with template interpolation. All event triggers (contact_created, deal_stage_changed, form_submitted, ticket_created, inbound_message) fire workflows automatically. Waiting workflows resume via SLA worker. Manual runs also use the centralized executor. AI scheduled ops (deal progression, task generation) run every 10 minutes.
    - **AI Auto-Reply**: When inbound messages arrive via GHL, the system generates compliance-safe AI responses using GPT-4o-mini and sends them back via the same channel (email or SMS). Auto-replies are skipped for unsubscribe, callback, and neutral intents. All replies include compliance disclaimers and are audit-logged. Implemented in `server/services/ghl.ts` via `sendAiAutoReply()`.
    - **RFI System**: Manages Request for Information with categorization, prioritization, assignment, and status tracking.
    - **SLA Enforcement**: Automated monitoring and escalation for critical operational timelines (e.g., Statement Review, New Lead, Proposal, Support).
    - **Profit Instrumentation**: Integrates fields for merchant tier, risk tier, health score, average ticket, and estimated profit to deals. Includes a volume estimation engine (`server/services/volume-estimator.ts`) that calculates processing volume estimates and residuals (cash discount @ 3.5% margin, interchange plus @ 0.35% margin) with confidence levels that improve through the sales cycle (low at New Lead, medium at Statement Collected, high at Proposal/Negotiation, actual at Closed Won). Estimates auto-recalculate on deal stage changes and via cron. Contacts carry `estimatedProcessingVolume`, `estimatedResidual`, and `volumeConfidence` fields. Prospects carry `estimatedResidual` and `estimatedAvgTicket` fields. On-demand recalculation via `POST /api/deals/:id/recalculate-volume`, `POST /api/contacts/:id/recalculate-volume`, `POST /api/prospects/:id/recalculate-volume`.
    - **Lead Generation & Qualification Engine**: Features bulk CSV import, AI-powered prospect enrichment (website scraping, categorization, scoring), multi-step campaign sequences with AI-personalized emails, and tracking. It also includes an AI-powered lead scoring model (0-100 across 4 dimensions), AI deal blueprint generation, smart sequence routing, and document readiness tracking with auto-nudges.
    - **Lead Command Center** (`/dashboard/lead-command-center`): Unified dashboard consolidating 5 separate lead tools into a single 3-tab interface: (1) Enrichment Queue combining SunbizEntity[] and Prospect[] into normalized UnifiedRow[] with source badges, search, score/status/source filters; (2) Qualified Pipeline showing conversion-ready leads (hot/warm + A/B grade); (3) Lead Intelligence (embedded). Includes drag-drop file upload, 6 KPI cards, mass actions (batch enrich, convert to prospects/contacts, AI route to campaigns, enroll in sequences, add to workflows), and checkbox selection. Backend enhancements: `computeQualificationScore()` in sunbiz-enrichment.ts grades prospects A-F based on data completeness; `autoQualifyProspects()` and `retryFailedEnrichments()` in sunbiz-cron.ts; `autoPromoteProspects()` now creates Company records, maps avgTicket, priorityScore, leadScore, and address fields.
    - **Sunbiz Lead Gen Cleaner**: A specialized tool for processing Florida state filing data (corevt.zip files), performing deep enrichment, and converting entities into prospects. Includes automated cron jobs (`server/services/sunbiz-cron.ts`) that run every 5 minutes to: (1) auto-convert enriched hot/warm entities to prospects with volume estimates, (2) auto-promote qualified prospects (hot, or warm+A/B grade) to contacts+deals with full field mapping, (3) recalculate volume estimates for active deals.
    - **Statement Review & Savings Proposals**: AI-powered statement analysis that generates multi-plan pricing proposals (Cash Discount/Compliant Surcharging, Interchange Plus, Tiered Reduction) with 20-30% savings calculations, annual projections, Liberty Bancard margin data, compliance disclaimers, and urgency CTAs. Stored in deal.savingsProposal JSONB field. Dashboard page at `/dashboard/statement-review`.
    - **Blaze.ai Marketing Integration**: Integration settings page for connecting Blaze.ai AI marketing platform via Zapier/webhooks. Supports inbound webhook at `/api/webhooks/blaze` for content events. Dashboard page at `/dashboard/blaze`.
- **Compliance Rules**: Strict adherence to regulatory guidelines, including explicit disclaimers, no unsubstantiated savings claims, no legal/tax advice, and no PCI data storage.

## External Dependencies
- **PostgreSQL**: Relational database for all application data.
- **OpenAI API**: For AI advisor functionalities, lead enrichment, scoring, and deal blueprint generation.
- **GoHighLevel (GHL) API**: Used for contact synchronization, sending emails and SMS messages, calendar booking, handling inbound webhooks for communication tracking, and AI-powered auto-replies for inbound messages.
- **Replit Auth (OIDC)**: Provides user authentication services.
- **Multer**: Used for handling `multipart/form-data` for file uploads, specifically for CSV and corevt.zip imports.