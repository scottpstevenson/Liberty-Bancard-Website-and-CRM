# Launch Environment Variable Checklist

Use this checklist before every production deployment. Variables marked **REQUIRED** will cause the server to crash or refuse to start if unset. Variables marked **CRITICAL** will silently degrade security or key features if missing.

---

## Core Infrastructure

| Variable | Status | Description |
|---|---|---|
| `DATABASE_URL` | **REQUIRED** | PostgreSQL connection string. Server will not start without it. |
| `SESSION_SECRET` | **REQUIRED** | Secret used to sign session cookies. Must be a long random string (32+ chars). Server throws on startup if unset in production. |
| `APP_URL` | **CRITICAL** | Public base URL (e.g. `https://libertybancard.com`). Used in password reset links, invite URLs, and email links. Falls back to a hardcoded domain if unset — links may point to the wrong host. |

---

## Authentication

| Variable | Status | Description |
|---|---|---|
| `ADMIN_SEED_EMAIL` | **REQUIRED** | Email for the initial admin account created on first startup. |
| `ADMIN_SEED_PASSWORD` | **REQUIRED** | Password for the initial admin account. Change immediately after first login. |

---

## GoHighLevel (GHL) Integration

| Variable | Status | Description |
|---|---|---|
| `GHL_PRIVATE_INTEGRATION_TOKEN` | **CRITICAL** | Primary GHL API token (preferred over `GHL_API_KEY`). Without this or `GHL_API_KEY`, all GHL sync, email, and SMS is disabled. |
| `GHL_API_KEY` | **CRITICAL** | Legacy GHL API key (used if `GHL_PRIVATE_INTEGRATION_TOKEN` is not set). |
| `GHL_LOCATION_ID` | **CRITICAL** | GHL location (sub-account) ID. Required for all GHL operations. |
| `GHL_WEBHOOK_SECRET` | **CRITICAL** | HMAC secret for validating incoming GHL webhooks. **In production, all GHL webhook endpoints will return 503 if this is unset.** Set this before enabling GHL webhooks. |
| `GHL_CALENDAR_ID` | Optional | GHL calendar ID for booking link generation. Booking links will be unavailable if unset. |
| `GHL_MERCHANT_AGREEMENT_TEMPLATE_ID` | Optional | GHL document template ID for merchant e-signature. E-sign flow is disabled if unset. |

---

## GHL Workflow IDs

These map business events to GHL automation workflows. All are optional — the associated trigger is simply skipped if the variable is unset. Manage them from the admin UI at `/dashboard/integrations` or set them as environment variables (env var takes priority over the DB value).

### Inbound Lead / Form Events

| Variable | Trigger |
|---|---|
| `GHL_WORKFLOW_INBOUND_LEAD` | New inbound lead (get-started, free-analysis, estimate, cost-quiz forms). Sends welcome email + SMS with booking link; 24h follow-up if no booking. |
| `GHL_WORKFLOW_INBOUND_CONFIRMATION` | Inbound lead multi-step nurture / confirmation sequence. |
| `GHL_WORKFLOW_STATEMENT_REVIEW` | Statement uploaded — sends confirmation and schedules AI savings review. |
| `GHL_WORKFLOW_CALLBACK` | Callback request submitted — creates sales task and sends confirmation SMS. |

### Onboarding Events

| Variable | Trigger |
|---|---|
| `GHL_WORKFLOW_MERCHANT_APP` | Merchant application submitted — sends confirmation, triggers e-sign, begins onboarding. |
| `GHL_WORKFLOW_MERCHANT_APPROVED` | Merchant profile approved — sends portal welcome email with MID and next steps. |
| `GHL_WORKFLOW_PARTNER_WELCOME` | Partner approved — sends welcome email with portal access and referral instructions. |
| `GHL_WORKFLOW_AFFILIATE_WELCOME` | New affiliate signup — sends portal access and referral instructions. |
| `GHL_WORKFLOW_EQUIPMENT_ORDER` | Equipment order placed — sends order confirmation with setup timeline. |

### Scheduling

| Variable | Trigger |
|---|---|
| `GHL_WORKFLOW_BOOKING_CONFIRM` | Appointment booked — sends confirmation email + SMS with 24h and 1h reminders. |
| `GHL_WORKFLOW_REMINDER` | 24-hour appointment reminder. |
| `GHL_WORKFLOW_NO_SHOW` | Appointment no-show — sends reschedule link. |

### Sales Nurture

| Variable | Trigger |
|---|---|
| `GHL_WORKFLOW_POST_CALL` | Sales call completed — sends recap, proposal, and next steps. |
| `GHL_WORKFLOW_PROPOSAL_FOLLOWUP` | Proposal delivered — Day 1 check, Day 3 nudge, Day 7 urgency sequence. |
| `GHL_WORKFLOW_LONG_NURTURE` | Long-term nurture enrolled — monthly education-focused touch sequence. |

### Support

| Variable | Trigger |
|---|---|
| `GHL_WORKFLOW_SUPPORT_TICKET` | Support ticket created — assigns to support team, sends acknowledgment. |

### SDR Cold Outbound (by Vertical)

| Variable | Vertical |
|---|---|
| `GHL_WORKFLOW_SDR_AUTO` | Automotive |
| `GHL_WORKFLOW_SDR_MEDSPA` | Med Spa |
| `GHL_WORKFLOW_SDR_MEDICAL` | Medical / Dental |
| `GHL_WORKFLOW_SDR_RESTAURANT` | Restaurant |
| `GHL_WORKFLOW_SDR_RETAIL` | Retail |
| `GHL_WORKFLOW_SDR_DEFAULT` | All other / uncategorized verticals |
| `GHL_WORKFLOW_SDR_STATEMENT` | SDR statement audit–focused outreach |

---

## SMTP Email Fallback

Used when GHL is not configured or a contact has no GHL contact ID. All four fields are required for SMTP delivery to work.

| Variable | Status | Description |
|---|---|---|
| `SMTP_HOST` | Optional | SMTP server hostname (e.g. `smtp.gmail.com`). |
| `SMTP_PORT` | Optional | SMTP port. Defaults to 587; use 465 for SSL. |
| `SMTP_USER` | Optional | SMTP username / sender email address. |
| `SMTP_PASS` | Optional | SMTP password or app-specific password. |
| `SMTP_FROM` | Optional | Override From address. Defaults to `SMTP_USER` if unset. |

---

## AI / OpenAI

| Variable | Status | Description |
|---|---|---|
| `AI_INTEGRATIONS_OPENAI_API_KEY` | **CRITICAL** | OpenAI API key. All AI advisors, auto-proposals, deal blueprints, lead enrichment, and compliance analysis are disabled without this. |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | Optional | Override the OpenAI base URL (e.g. for Azure OpenAI). Defaults to the standard OpenAI endpoint. |

---

## Redis / Job Queue (BullMQ)

| Variable | Status | Description |
|---|---|---|
| `REDIS_URL` | **CRITICAL** (production) | Redis connection string. If unset, the system falls back to `ioredis-mock` (in-memory, non-persistent). All background queues — GHL sync, SLA checks, sequences, enrichment, discovery, digests, MID ingestion — lose durability and will not survive a restart. **Always set in production.** |

---

## Observability

| Variable | Status | Description |
|---|---|---|
| `SENTRY_DSN` | Optional | Sentry DSN for error tracking. Error reporting is silently disabled if unset. Strongly recommended for production. |
| `ADMIN_DIGEST_EMAIL` | Optional | Email address to receive daily KPI digest notifications. No digest emails are sent if unset. |

---

## External Enrichment & Discovery APIs

These are optional but disable specific outreach and enrichment features if unset.

| Variable | Feature |
|---|---|
| `SERPER_API_KEY` | Deep business enrichment via Google Search (Serper.dev). |
| `OUTSCRAPER_API_KEY` | Google Maps bulk business data pulls. |
| `APIFY_API_KEY` | Yelp and Facebook business scraping. |
| `APOLLO_API_KEY` | B2B contact and company discovery via Apollo.io. |

---

## Pre-Launch Verification Steps

1. **Confirm `SESSION_SECRET` is set** — any random 32+ char string works; generate with `openssl rand -hex 32`.
2. **Confirm `GHL_WEBHOOK_SECRET` is set** — without it, all GHL webhook endpoints return 503 in production.
3. **Confirm `DATABASE_URL` resolves** — run `npx tsx scripts/migrate.ts` to apply any pending migrations before go-live.
4. **Confirm `REDIS_URL` points to a live Redis** — check the Operator Dashboard → Job Queue tab after deploy.
5. **Confirm `AI_INTEGRATIONS_OPENAI_API_KEY` works** — the AI Advisors tab will show an error if the key is invalid.
6. **Send a test GHL webhook** — confirm the endpoint returns 200 (not 401 or 503).
7. **Submit a test lead form** — verify the contact appears in GHL within ~45 seconds (one sync cycle).
