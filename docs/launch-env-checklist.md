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
| `GHL_WORKFLOW_INBOUND_LEAD` | Legacy reference slot. Replit does not enroll contacts here; a saved ID starts no message. |
| `GHL_WORKFLOW_INBOUND_CONFIRMATION` | Reference slot. A submitted web form is confirmed by the request receipt Replit sends, not by a GHL workflow. |
| `GHL_WORKFLOW_STATEMENT_REVIEW` | Reference slot. Statement uploads are received, held and reviewed in Replit; this slot starts no analysis. |
| `GHL_WORKFLOW_CALLBACK` | Reference slot. Callback requests create the follow-up task in Replit; this slot sends no confirmation text. |

### Onboarding Events

| Variable | Trigger |
|---|---|
| `GHL_WORKFLOW_MERCHANT_APP` | Handoff slot. Merchant application recorded — Replit can enroll the contact; skipped and reported as not sent when no ID is saved. |
| `GHL_WORKFLOW_MERCHANT_APPROVED` | Merchant profile approved — Replit triggers it when the ID and the contact's GHL record exist; otherwise portal access goes by direct email. |
| `GHL_WORKFLOW_PARTNER_WELCOME` | Reference slot. Partner approval and portal access are handled in Replit. |
| `GHL_WORKFLOW_AFFILIATE_WELCOME` | Handoff slot. Affiliate signup recorded — Replit can enroll the contact; skipped and reported as not sent when no ID is saved. |
| `GHL_WORKFLOW_EQUIPMENT_ORDER` | Reference slot. Equipment orders are tracked in Replit. |

### Scheduling

| Variable | Trigger |
|---|---|
| `GHL_WORKFLOW_BOOKING_CONFIRM` | Handoff slot. Appointment booked in Replit — Replit can pass the booking on. The 24-hour reminder is its own slot; no 1-hour reminder has a CRM-side owner. |
| `GHL_WORKFLOW_REMINDER` | 24-hour appointment reminder. |
| `GHL_WORKFLOW_NO_SHOW` | Handoff slot. Appointment recorded as a no-show — Replit can pass it on. |

### Sales Nurture

| Variable | Trigger |
|---|---|
| `GHL_WORKFLOW_POST_CALL` | Handoff slot. Sales call recorded as completed — Replit can pass it on. |
| `GHL_WORKFLOW_PROPOSAL_FOLLOWUP` | Handoff slot. Proposal recorded as sent — Replit can pass it on. |
| `GHL_WORKFLOW_LONG_NURTURE` | Handoff slot. Long-term nurture is a deliberate handoff and never overrides consent, suppression or the outbound pause. |

### Support

| Variable | Trigger |
|---|---|
| `GHL_WORKFLOW_SUPPORT_TICKET` | Reference slot. Support requests are recorded and assigned in Replit. |

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
| `REDIS_URL` | **CRITICAL** | Redis connection string required for BullMQ. If unset, BullMQ queues are `unavailable`; no in-memory fallback is started. **Always set before enabling background queue processing.** |

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

## Pre-Deploy Smoke Tests

Run these automated checks before every production deployment to catch regressions:

```bash
# API coverage — verifies every client /api/ path has a matching server handler
npx tsx scripts/check-api-coverage.ts

# Role-guard smoke test — verifies auth boundaries across anon / merchant / admin roles
ADMIN_SEED_EMAIL=<admin-email> ADMIN_SEED_PASSWORD=<admin-password> \
  BASE_URL=http://localhost:5000 npx tsx scripts/smoke-role-guards.ts
```

Both checks are also registered as named validation steps (`api-coverage` and `role-guards`) and run automatically as part of the project's validation suite.

### Required env vars for role-guard smoke tests

| Variable | Description |
|---|---|
| `ADMIN_SEED_EMAIL` | Email of the seeded admin account (same value used in §Authentication above). The smoke test logs in as this user to verify admin routes return 200. |
| `ADMIN_SEED_PASSWORD` | Password for the seeded admin account. The smoke test performs a real login via `/api/auth/login`. |

If either variable is absent the script skips cleanly (exit 0) rather than failing the deploy gate — but the role-guard checks will **not** run. Always set both vars in CI/CD for full coverage.

---

## Pre-Launch Verification Steps

1. **Confirm `SESSION_SECRET` is set** — any random 32+ char string works; generate with `openssl rand -hex 32`.
2. **Confirm `GHL_WEBHOOK_SECRET` is set** — without it, all GHL webhook endpoints return 503 in production.
3. **Confirm `DATABASE_URL` resolves** — run `npx tsx scripts/migrate.ts` to apply any pending migrations before go-live.
4. **Confirm `REDIS_URL` points to a live Redis** — check the Operator Dashboard → Job Queue tab after deploy.
5. **Confirm `AI_INTEGRATIONS_OPENAI_API_KEY` works** — the AI Advisors tab will show an error if the key is invalid.
6. **Send a test GHL webhook** — confirm the endpoint returns 200 (not 401 or 503).
7. **Submit a test lead form** — verify the contact appears in GHL within ~45 seconds (one sync cycle).
