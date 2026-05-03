# Storage layer

  The `storage` runtime is composed from a set of per-domain mixin classes that
  each live in their own file under `server/storage/`. The barrel module
  `server/storage.ts` declares the canonical `IStorage` interface and the
  `DatabaseStorage` class, then mixes the methods from each domain class onto
  the `DatabaseStorage` prototype at module load.

  ## Layout

  - `server/storage.ts` — barrel; defines `IStorage`, the `DatabaseStorage`
    class shell, runs `applyMixins`, and exports the singleton
    `storage` instance. Callers continue to import via
    `import { storage } from "../storage";` (or `./storage`).
  - `server/storage/_shared.ts` — re-exports common imports (`db`, schema
    tables, drizzle operators) plus the shared pagination helpers used by
    several domain modules.
  - `server/storage/<domain>.ts` — one class per domain. Methods are unmodified
    copies of the original implementations. `this.` references stay within the
    same domain so cross-mixin lookups are never required.

  ## Domains

  | File | Class | Responsibility |
  | --- | --- | --- |
  | contacts.ts | ContactsStorage | Contacts, companies, contact↔company links, dedupe/merge |
  | deals.ts | DealsStorage | Deals, pipeline lookups, archive/restore, bulk stage |
  | tickets.ts | TicketsStorage | Tickets, ticket comments, SLA breach lookups |
  | tasks.ts | TasksStorage | Tasks, bulk task ops |
  | documents.ts | DocumentsStorage | Documents |
  | audit.ts | AuditStorage | Audit logs |
  | notifications.ts | NotificationsStorage | Notifications + per-user preferences |
  | workflows.ts | WorkflowsStorage | Workflows, workflow runs, RFIs |
  | templates.ts | TemplatesStorage | Message templates, collateral packets, GHL activity log, SLA configs |
  | prospects.ts | ProspectsStorage | Prospect lists, prospects, enrichment jobs |
  | campaigns.ts | CampaignsStorage | Campaigns, campaign steps, outbound messages |
  | notes.ts | NotesStorage | Notes + comments |
  | comm-logs.ts | CommLogsStorage | Email and call activity logs |
  | automation.ts | AutomationStorage | Stage automation rules, follow-up sequences, sequence enrollments |
  | sunbiz.ts | SunbizStorage | Sunbiz entities + aggregate dashboards/stats |
  | merchants.ts | MerchantsStorage | Merchant applications/profiles, equipment orders, agents, agent quotas |
  | residuals.ts | ResidualsStorage | Residual reports, merchant residuals, residual imports, MID daily stats |
  | health.ts | HealthStorage | Health alerts, deal competitors |
  | partners.ts | PartnersStorage | Partners (affiliates), referrals, commission tiers, knowledge base |
  | reviews.ts | ReviewsStorage | Review requests, testimonial submissions, NPS, merchant referrals, retention configs |
  | misc.ts | MiscStorage | Onboarding, consent audit, calendar, data delete requests, system settings, pipeline stages, saved filters, CSV imports, generated blog posts, live chat, chargebacks |
  | businesses.ts | BusinessesStorage | Businesses, aliases, locations, lead sources, enrichment runs |
  | sdr.ts | SdrStorage | SDR merchants/contacts/lead state/events/attempts/compliance, dashboard, sending identities, lead discovery, GHL workflow mappings |
  | partner-orgs.ts | PartnerOrgsStorage | Partner organizations + org users |

  ## Adding methods

  When adding a new method:

  1. Add its signature to the `IStorage` interface in `server/storage.ts`.
  2. Implement the method on the relevant domain class under `server/storage/`.
  3. If the method is genuinely new functionality, add the file to the table
     above. If you create a new domain file, also import it and add it to the
     `applyMixins` call in `server/storage.ts`.
  