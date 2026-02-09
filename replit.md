# Liberty Bancard AI Business Operating System

## Overview
Complete AI-powered business operating system for Liberty Bancard, a merchant payment processing company. Built with Express + React + PostgreSQL. Includes a full public marketing website with lead generation, internal CRM dashboard with pipeline management, automated workflow triggers, compliance-first messaging, and AI advisors for 7 departments.

## Architecture
- **Frontend**: React + Vite + TypeScript + Tailwind CSS + shadcn/ui
- **Backend**: Express + TypeScript
- **Database**: PostgreSQL via Drizzle ORM
- **Auth**: Replit Auth (OIDC)
- **AI**: OpenAI integration for department-specific AI advisors
- **Routing**: wouter (frontend), Express (backend)

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
      Overview.tsx - Dashboard home with metrics
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
  components/
    Navbar.tsx - Public site navigation with compliance
    Footer.tsx - Full footer with disclaimers
    ui/ - shadcn/ui components
server/
  routes.ts - All API routes
  storage.ts - Storage interface (IStorage)
  db.ts - Database connection
shared/
  schema.ts - Drizzle schema + types
```

## Key Features Built
1. **Public Website**: Home + 6 marketing pages + 3 conversion forms + quiz + 2 legal + 4 thank-you pages
2. **Sales Enablement**: 30+ hidden pages (asset library + pitch packet hubs) via AssetPage
3. **CRM Dashboard**: Pipeline (sales/onboarding), contacts, tickets, tasks, notifications
4. **Internal Forms**: Call Outcome, Statement Review Complete, Onboarding Kickoff
5. **AI Advisors**: 7 department-specific advisors (Sales, Support, Onboarding, Marketing, Finance, Compliance, Executive)
6. **Compliance**: Microlines and disclaimers throughout; no savings claims without statement review
7. **Workflow Automation**: Create/manage automated workflows with triggers (deal_stage_changed, ticket_created, contact_created, etc.) and actions (create_task, send_notification, create_audit_log). Manual trigger support + run history.
8. **RFI System**: Request for Information tracking with categories (General, Pricing, Compliance, Technical, Onboarding, Underwriting, Equipment), priority levels, assignment, response tracking, and status workflow (Open → In Progress → Responded → Closed).

## Database Tables
contacts, deals, tickets, tasks, notifications, documents, auditLogs, workflows, workflowRuns, rfis, conversations, messages, users, sessions

## API Routes
- GET/POST /api/contacts, /api/deals, /api/tickets, /api/tasks, /api/notifications
- PUT /api/deals/:id, /api/tickets/:id, /api/tasks/:id
- GET/POST /api/workflows, PUT/DELETE /api/workflows/:id, POST /api/workflows/:id/run
- GET /api/workflow-runs
- GET/POST /api/rfis, PUT /api/rfis/:id
- POST /api/ai/chat (department-specific AI advisor)
- GET/POST /api/conversations (chat history)
- GET /api/user, POST /api/login, /api/logout (auth)

## Compliance Rules
- Never promise savings without statement review
- No legal/tax advice language
- All pricing mentions include: "Eligibility, underwriting, card brand rules, and applicable laws apply"
- No PCI data storage (full card numbers, SSNs, bank account numbers)

## Recent Changes
- Built complete public website with all marketing and conversion pages
- Created 30+ hidden sales enablement pages via dynamic AssetPage component
- Built full CRM dashboard with Sales/Onboarding pipeline Kanban boards
- Implemented 3 internal operational forms (CallOutcome, ReviewComplete, OnboardingKickoff)
- Added AI Business Advisor with 7 department-specific prompt configurations
- Added task management and notification center to dashboard
- Added "By the Numbers" animated stats section on homepage (useCountUp hook with IntersectionObserver)
- Added "Why Liberty" differentiator section on homepage (4 cards: Statement-Based Pricing, Direct Support, Next-Day Funding, No Contracts)
- Added Quick Callback form on homepage with POST /api/public/callback endpoint
- Added floating ContactBubble component for desktop visitors (persistent callback request widget)
- Added head-to-head comparison table on BeatSquareStripe page (Square vs Stripe vs Liberty feature grid)
- Conversion enhancers: StickyMobileCTA, ExitIntentPopup, ContactBubble all active on public pages
