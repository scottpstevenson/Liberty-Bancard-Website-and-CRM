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
    - **Workflow Automation**: A robust engine with 9 pre-built workflows, 10 action types (including GHL interactions, packet sending, proposal generation), and trigger-based automation.
    - **RFI System**: Manages Request for Information with categorization, prioritization, assignment, and status tracking.
    - **SLA Enforcement**: Automated monitoring and escalation for critical operational timelines (e.g., Statement Review, New Lead, Proposal, Support).
    - **Profit Instrumentation**: Integrates fields for merchant tier, risk tier, health score, average ticket, and estimated profit to deals.
    - **Lead Generation & Qualification Engine**: Features bulk CSV import, AI-powered prospect enrichment (website scraping, categorization, scoring), multi-step campaign sequences with AI-personalized emails, and tracking. It also includes an AI-powered lead scoring model (0-100 across 4 dimensions), AI deal blueprint generation, smart sequence routing, and document readiness tracking with auto-nudges.
    - **Sunbiz Lead Gen Cleaner**: A specialized tool for processing Florida state filing data (corevt.zip files), performing deep enrichment, and converting entities into prospects.
- **Compliance Rules**: Strict adherence to regulatory guidelines, including explicit disclaimers, no unsubstantiated savings claims, no legal/tax advice, and no PCI data storage.

## External Dependencies
- **PostgreSQL**: Relational database for all application data.
- **OpenAI API**: For AI advisor functionalities, lead enrichment, scoring, and deal blueprint generation.
- **GoHighLevel (GHL) API**: Used for contact synchronization, sending emails and SMS messages, calendar booking, and handling inbound webhooks for communication tracking.
- **Replit Auth (OIDC)**: Provides user authentication services.
- **Multer**: Used for handling `multipart/form-data` for file uploads, specifically for CSV and corevt.zip imports.