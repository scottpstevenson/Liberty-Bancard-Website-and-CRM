# API Route Security Audit

**Date:** 2026-05-04
**Scope:** All `server/routes/*.ts` files — rate-limiting, auth guards, role checks

---

## 1. Public Endpoints (no auth, rate-limited)

| Route | File | Rate Limit |
|---|---|---|
| `POST /api/public/callback` | public.ts | `publicLeadRateLimit` |
| `POST /api/equipment-order` | public.ts | `publicLeadRateLimit` |
| `POST /api/public/integration-request` | public.ts | `publicLeadRateLimit` |
| `POST /api/public/testimonial-submit` | public.ts | `publicLeadRateLimit` |
| `POST /api/partner-apply` | partners.ts | `publicLeadRateLimit` |
| `POST /api/partner/login` | partners.ts | `partnerLoginRateLimit` |
| `POST /api/partners/login` | partners.ts | `partnerLoginRateLimit` |
| `POST /api/partner/reset-password-request` | partners.ts | `partnerForgotPasswordRateLimit` |
| `POST /api/partners/forgot-password` | partners.ts | `partnerForgotPasswordRateLimit` |
| `POST /api/partner/reset-password` | partners.ts | `publicLeadRateLimit` |
| `POST /api/partners/reset-password` | partners.ts | `publicLeadRateLimit` |
| `POST /api/partners/set-password` | partners.ts | `publicLeadRateLimit` |
| `GET  /api/partner/track/:code` | partners.ts | `publicLeadRateLimit` |

## 2. CRM-Internal Routes — `isDashboardUser` Guard

These routes are accessible only to admin, manager, and agent roles (blocks merchants and partners):

### deals.ts
- `GET/POST /api/deals`, `GET/PUT /api/deals/:id`
- `POST /api/deals/:id/recalculate-volume`
- `POST /api/contacts/:id/recalculate-volume`
- `POST /api/prospects/:id/recalculate-volume`
- `GET /api/deal-competitors`, `GET /api/deal-competitors/deal/:dealId`
- `POST /api/deal-competitors`, `PATCH /api/deal-competitors/:id`
- `GET /api/stage-rules`, `GET /api/stage-rules/:id`
- `GET /api/pipeline-stages`

### contacts.ts
- `GET/POST /api/contacts`, `GET/PUT /api/contacts/:id`
- `POST /api/contacts/:id/enrich-linkedin`
- `POST /api/contacts/bulk-enrich-linkedin`
- `POST /api/contacts/enrich-batch`
- `GET /api/contacts/enrich-progress`
- `GET/POST /api/companies`
- `GET /api/serper/status`, `GET /api/proxycurl/status`

### tickets-tasks.ts
- `GET/POST /api/tickets`, `GET/PUT /api/tickets/:id`
- `GET/POST /api/tasks`, `PUT /api/tasks/:id`
- `GET/POST /api/tickets/:id/comments`

### chargebacks.ts
- `GET /api/chargebacks`, `GET /api/chargebacks/stats`
- `GET /api/chargebacks/overdue`
- `GET /api/chargebacks/contact/:contactId`, `GET /api/chargebacks/deal/:dealId`
- `GET /api/chargebacks/:id`
- `POST /api/chargebacks`, `PATCH /api/chargebacks/:id`
- `POST /api/chargebacks/:id/evidence`

### boarding.ts
- `POST /api/deals/:id/submit-to-processor`
- `POST /api/deals/:id/refresh-boarding-status`
- `GET /api/deals/:id/boarding-status`
- `GET /api/deals/:id/mid-stats`, `POST /api/deals/:id/refresh-mid-stats`
- `GET /api/mid-stats/pipeline-summary`, `GET /api/mid-stats/summary`
- `GET /api/boarding/submissions`

### documents.ts (legacy routes + collateral + knowledge base reads)
- `GET/POST /api/documents`
- `POST /api/documents/upload`
- `GET /api/documents/download/:id`
- `GET /api/documents/contact/:contactId`
- `GET/POST /api/collateral-packets`
- `GET /api/knowledge-base`, `GET /api/knowledge-base/category/:category`
- `GET /api/knowledge-base/:id`

### merchants.ts (CRM-managed sections)
- `GET /api/equipment-orders`, `GET /api/equipment-orders/:id`
- `POST /api/equipment-orders`
- `GET /api/onboarding-steps/deal/:dealId`
- `GET /api/onboarding-steps/application/:applicationId`

### partners.ts (CRM partner management)
- `GET /api/partners`, `GET /api/partners/:id`
- `POST /api/partners`, `PATCH /api/partners/:id`
- `GET /api/referrals`, `POST /api/referrals`, `PATCH /api/referrals/:id`
- `GET /api/commission-tiers`

## 3. Admin/Manager Role-Gated Routes — `requireRole("admin","manager")`

| Route | File | Guard |
|---|---|---|
| `POST /api/stage-rules` | deals.ts | admin, manager |
| `PUT /api/stage-rules/:id` | deals.ts | admin, manager |
| `DELETE /api/stage-rules/:id` | deals.ts | admin, manager |
| `POST /api/pipeline-stages` | deals.ts | admin, manager |
| `PUT /api/pipeline-stages/:id` | deals.ts | admin, manager |
| `DELETE /api/pipeline-stages/:id` | deals.ts | admin, manager |
| `POST /api/pipeline-stages/reorder` | deals.ts | admin, manager |
| `POST /api/ai/auto-progress-deals` | deals.ts | admin, manager |
| `POST /api/serper/reset-usage` | contacts.ts | admin, manager |
| `DELETE /api/chargebacks/:id` | chargebacks.ts | admin, manager |
| `POST /api/admin/run-mid-ingestion` | boarding.ts | admin |
| `POST /api/knowledge-base` | documents.ts | admin, manager |
| `PATCH /api/knowledge-base/:id` | documents.ts | admin, manager |
| `PATCH /api/equipment-orders/:id` | merchants.ts | admin, manager |
| `POST /api/onboarding-steps` | merchants.ts | admin, manager |
| `PATCH /api/onboarding-steps/:id` | merchants.ts | admin, manager |
| `POST /api/contacts/enrich-batch` | contacts.ts | admin, manager |
| `POST /api/partners` | partners.ts | admin |
| `PATCH /api/partners/:id` | partners.ts | admin |
| `POST /api/commission-tiers` | partners.ts | admin |
| `DELETE /api/commission-tiers/:id` | partners.ts | admin |

## 4. Merchant Self-Service Routes — `isAuthenticated` + Ownership

These routes correctly use `isAuthenticated` because merchants need access, with per-record ownership checks:

| Route | File | Ownership Check |
|---|---|---|
| `GET /api/merchant-documents` | documents.ts | inline admin/manager check |
| `GET /api/merchant-documents/contact/:contactId` | documents.ts | `canAccessContactDocs` |
| `POST /api/merchant-documents/upload` | documents.ts | `canAccessContactDocs` |
| `GET /api/merchant-documents/:id/download` | documents.ts | `canAccessContactDocs` |
| `DELETE /api/merchant-documents/:id` | documents.ts | `canAccessContactDocs` |
| `POST /api/merchant-portal/upload-statement` | documents.ts | user-scoped |
| `POST /api/merchant-applications` | merchants.ts | user creates own |
| `GET /api/merchant-applications/user/:userId` | merchants.ts | user-scoped |
| `GET /api/merchant-applications/:id` | merchants.ts | `canAccessApplication` |
| `POST /api/merchant-applications/:id/send-esign` | merchants.ts | `canAccessApplication` |
| `GET /api/merchant-applications/:id/esign-status` | merchants.ts | `canAccessApplication` |
| `GET /api/merchant-profile` | merchants.ts | user-scoped |
| `POST /api/merchant-profiles` | merchants.ts | user creates own |
| `PATCH /api/merchant-profiles/:id` | merchants.ts | inline admin/manager check |

## 5. Partner Self-Service Routes — `isPartnerAuthenticated`

| Route | File |
|---|---|
| `GET /api/partner/session` | partners.ts |
| `GET /api/partners/me` | partners.ts |
| `GET /api/partner/dashboard/:code` | partners.ts |

## 6. Summary of Changes Made

1. **Rate limits added** to 13 public endpoints (was 0 before audit).
2. **`isDashboardUser` guard** applied to 60+ CRM-internal routes across 8 files (previously used `isAuthenticated`, allowing merchants/partners to access CRM data).
3. **`requireRole("admin","manager")` guard** applied to 18 sensitive mutation endpoints (pipeline config, stage rules, knowledge base, equipment orders, onboarding, commission tiers).

---

## 7. Task #229 Audit — Unauthenticated Email/GHL-Triggering Endpoints

**Date:** 2026-05-08
**Scope:** All unauthenticated routes that send emails, trigger GHL workflows, or write records; cross-checked against `server/routes/merchants.ts`, `server/routes/public.ts`, `server/routes/partners.ts`, `server/routes/lifecycle.ts`, and `server/replit_integrations/auth/replitAuth.ts`.

### Gaps Found & Fixed

| Route | File | Issue | Fix Applied |
|---|---|---|---|
| `POST /api/auth/reset-password` | replitAuth.ts | No rate limit — token brute-force risk | Added `resetPasswordRateLimit` (5 req / 15 min per IP) |
| `GET /api/nps/:token` | lifecycle.ts | No rate limit — token enumeration risk | Added `publicLeadRateLimit` (10 req / 15 min per IP) |
| `POST /api/nps/:token/submit` | lifecycle.ts | No rate limit — creates health alerts & review requests | Added `publicLeadRateLimit` |
| `POST /api/review-requests/:id/track-click` | lifecycle.ts | No rate limit — unauthenticated write endpoint | Added `publicLeadRateLimit` |
| `POST /api/merchant-referrals` | lifecycle.ts | No rate limit — creates referral DB records unauthenticated | Added `publicLeadRateLimit` |

### Already-Protected Routes (Confirmed)

| Route | File | Rate Limit |
|---|---|---|
| `POST /api/public/statement-upload` | public.ts | `publicLeadRateLimit` |
| `POST /api/public/estimate` | public.ts | `publicLeadRateLimit` |
| `POST /api/public/support` | public.ts | `publicLeadRateLimit` |
| `POST /api/public/get-started` | public.ts | `publicLeadRateLimit` |
| `POST /api/public/integration-request` | public.ts | `publicLeadRateLimit` |
| `POST /api/public/callback` | public.ts | `publicLeadRateLimit` |
| `POST /api/equipment-order` | public.ts | `publicLeadRateLimit` |
| `POST /api/public/testimonial-submit` | public.ts | `publicLeadRateLimit` |
| `POST /api/merchant-applications/request-esign` | merchants.ts | `publicLeadRateLimit` |
| `POST /api/partner-apply` | partners.ts | `publicLeadRateLimit` |
| `POST /api/partner/login` | partners.ts | `partnerLoginRateLimit` |
| `POST /api/partners/login` | partners.ts | `partnerLoginRateLimit` |
| `POST /api/partner/reset-password-request` | partners.ts | `partnerForgotPasswordRateLimit` |
| `POST /api/partners/forgot-password` | partners.ts | `partnerForgotPasswordRateLimit` |
| `POST /api/partner/reset-password` | partners.ts | `publicLeadRateLimit` |
| `POST /api/partners/reset-password` | partners.ts | `publicLeadRateLimit` |
| `POST /api/partners/set-password` | partners.ts | `publicLeadRateLimit` |
| `GET  /api/partner/track/:code` | partners.ts | `publicLeadRateLimit` |
| `POST /api/auth/forgot-password` | replitAuth.ts | `forgotPasswordRateLimit` (3 req / hr) |
| `POST /api/auth/signup` | replitAuth.ts | `signupRateLimit` (3 req / hr) — sends GHL welcome email on success |
| `POST /api/auth/login` | replitAuth.ts | `loginRateLimit` (5 req / 15 min) |
| `GET /api/auth/verify-email` | replitAuth.ts | `verifyEmailRateLimit` (10 req / 15 min per IP) — added Task #239 |
| `POST /api/webhooks/ghl-document` | merchants.ts | `webhookRateLimit` (30 req / min per IP) + signature verification — added Task #239 |

### Non-Email Unauthenticated Routes (Confirmed Safe / No Action Needed)

| Route | File | Notes |
|---|---|---|
| `POST /api/partners/logout` | partners.ts | Logout; no email/write risk |
| `POST /api/partner/logout` | partners.ts | Logout; no email/write risk |
| `GET /api/public/testimonials/approved` | public.ts | Read-only, returns sanitized data |
