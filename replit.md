# Liberty Bancard AI Business Operating System

## Overview
The Liberty Bancard AI Business Operating System is an AI-powered platform designed for the merchant payment processing industry. It integrates a public marketing website with advanced lead generation capabilities, an internal CRM for pipeline and task management, and an automated workflow engine. The system leverages AI for departmental advisory roles and compliance-driven communication to optimize operations, improve customer engagement, and boost sales efficiency, aiming to establish market leadership.

## User Preferences
I want iterative development.
I prefer detailed explanations.
Do not make changes to the folder `node_modules`.
Do not make changes to the file `package-lock.json`.

## System Architecture
The system is built on a modern web stack, emphasizing scalability, responsiveness, and robust data management.

### UI/UX Decisions
The frontend utilizes React with Vite, TypeScript, Tailwind CSS, and shadcn/ui for a responsive user interface. `wouter` is used for routing and `react-helmet-async` for SEO management. The design incorporates specific color schemes and templates for a professional and intuitive user experience. Key features include a public marketing website, a terminal shop, legal and compliance pages, and CRM dashboards.

### Technical Implementations
- **Backend**: Express.js with TypeScript for API services.
- **Database**: PostgreSQL with Drizzle ORM.
- **Authentication**: Custom email/password authentication featuring session-based auth (passport-local + bcryptjs), email verification, password recovery, and role-based access control.
- **AI Integration**: OpenAI powers department-specific AI advisors, lead enrichment and scoring, deal blueprint generation, and compliance-safe AI auto-replies.
- **External Communications**: GoHighLevel (GHL) is integrated for SMS, email, calendar management, and document e-signature.
- **Analytics & Tracking**: GA4 and Facebook Pixel for comprehensive analytics, conversion tracking, and UTM parameter capture.
- **Promo System**: Dynamic promotion display and tracking with end-to-end code persistence from URL to CRM.
- **Lead Management**: Features AI-powered prospect enrichment, multi-step personalized email campaigns, lead scoring, and deal blueprint generation. Includes a universal CSV import pipeline with auto-detection, deduplication, vertical classification, and lead scoring.
- **Sales Workflow**: A gated sales call follow-up system generates personalized email and SMS drafts via AI.
- **Workflow Automation**: A centralized engine executes various actions triggered by events, with SLA enforcement.
- **Profit Instrumentation**: Integrates merchant tier, risk, health scores, and profit estimates into deal management.
- **Statement Review & Proposals**: AI-powered analysis generates multi-plan pricing proposals and automates proposal delivery.
- **Merchant Application & Portal**: A multi-step merchant application wizard with e-signature and a self-service portal for account management.
- **Outreach & Enrichment**: An Outreach Command Center manages automated sales lifecycles, including Sunbiz entity imports, AI enrichment/classification, lead scoring, and daily automated outreach. The enrichment pipeline includes deep enrichment with Serper.dev integration for email/phone/website discovery.
- **AI SDR Pipeline**: An autonomous lead development system with a 24-stage pipeline, GHL sync, and two-way webhook integration for real-time updates and compliance.
- **Affiliate Program**: Public signup with referral codes, cookie-based attribution, performance tracking, tiered commissions, and an admin dashboard.
- **Conversion Optimization**: A/B testing framework, enhanced thank-you pages with calendar booking links, and detailed GA4 tracking.

## External Dependencies
- **PostgreSQL**: The primary relational database.
- **OpenAI API**: Used for various AI functionalities including advisory, content generation, and lead processing.
- **GoHighLevel (GHL) API**: Integrated for comprehensive communication (SMS, email), calendar scheduling, e-signatures, and bidirectional data synchronization.
- **Serper.dev API**: Provides Google search capabilities for business information discovery and contact enrichment.
- **Passport.js**: Utilized for authentication strategies, specifically `passport-local` with `bcryptjs`.
- **Multer**: Employed for handling `multipart/form-data` uploads.