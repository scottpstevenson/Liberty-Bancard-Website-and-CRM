# Liberty Bancard AI Business Operating System — QA Findings Report

**Date:** 2026-05-21  
**Scope:** Full-platform smoke test — all 20 module categories from the QA checklist, plus findings from the Platform Hardening Prompt (Sections 1–12).  
**Methodology:** Playwright end-to-end browser tests, authenticated API endpoint sweeps, SEO/route audits, role-guard smoke tests, code-level static analysis.  
**Tester:** Replit Agent (Task #277)

---

## Summary

| Severity | Count | Fixed in This Pass |
|---|---|---|
| Critical | 2 | 2 |
| High | 5 | 0 |
| Medium | 9 | 0 |
| Low | 8 | 0 |
| Feature Gap (Hardening Prompt) | 14 | 0 |

**37 total issues.** 2 Critical bugs were fixed during this QA run. All remaining issues are documented below as separate tasks.

---

## FIXED IN THIS PASS

### F-01 — Tickets page crash: `DialogTrigger is not defined`
- **File:** `client/src/pages/dashboard/Tickets.tsx` line 453
- **Cause:** `DialogTrigger` was used inside a `<Dialog>` wrapper but not included in the import on line 8.
- **Fix Applied:** Added `DialogTrigger` to the import: `import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";`
- **Severity:** Critical — page rendered a full-screen error overlay, completely blocking all ticket management.

### F-02 — Tickets page crash: `ResponsiveTable is not defined`
- **File:** `client/src/pages/dashboard/Tickets.tsx` line 547
- **Cause:** `<ResponsiveTable>` was used in the JSX but the component was never imported. The component exists at `@/components/ui/responsive-table`.
- **Fix Applied:** Added `import { ResponsiveTable } from "@/components/ui/responsive-table";`
- **Severity:** Critical — after fixing F-01, this second missing import caused the same crash for all users.

---

## CRITICAL

None remaining (all Critical issues resolved in this pass).

---

## HIGH

### H-01 — Pipeline: "Verbal Commit" stage missing from database
- **URL:** `/dashboard/pipeline`
- **Description:** The canonical 8-stage sales pipeline defined in `replit.md` and `server/routes/deals.ts` (line 424) includes "Verbal Commit" between "Negotiation / Follow-Up" and "Closed Won". However, the live database has 9 stages with "Nurture / Not Now" inserted at sort order 6, and "Verbal Commit" does not exist at all. The Kanban board therefore never renders a "Verbal Commit" column, and deals cannot be moved to that stage.
- **Evidence:** API call to `/api/pipeline-stages` returns: New Lead (0), Statement Received (1), Review In Progress (2), Call Booked (3), Proposal Sent (4), Negotiation / Follow-Up (5), **Nurture / Not Now (6)**, Closed Won (7), Closed Lost (8). No "Verbal Commit" row.
- **Impact:** Agents cannot record verbal commitments; stage-based automation rules for "Verbal Commit" will never trigger; GHL sequences tied to this stage are silently skipped.
- **Recommended Fix:** Run a DB migration to insert the "Verbal Commit" stage at sort order 6 and shift "Nurture / Not Now" to sort order 6.5 or a new position.
- **Severity:** High

### H-02 — GHL: Calendar and webhook integration non-functional
- **URL:** `/dashboard/ghl-settings`
- **Description:** The GHL status endpoint (`/api/ghl/status`) reports: `hasCalendarId: false` and `hasWebhookSecret: false`. Both `GHL_CALENDAR_ID` and `GHL_WEBHOOK_SECRET` environment variables are not configured.
- **Impact:** (1) The "Book a Call" CTA on all public pages opens a calendar that has no GHL calendar backing. (2) Incoming GHL webhook events (contact updates, reply notifications) are not validated or processed. (3) Calendar booking automation (meeting-intent classification → booking link) is fully broken.
- **Recommended Fix:** Configure `GHL_CALENDAR_ID` and `GHL_WEBHOOK_SECRET` in environment secrets. Re-test calendar booking flow end to end.
- **Severity:** High

### H-03 — GHL: Public API key not configured
- **URL:** `/dashboard/ghl-settings`, `/api/ghl/status`
- **Description:** `hasApiKey: false` — only the private token (`GHL_PRIVATE_API_KEY`) is set. Some GHL API calls require the public API key (`GHL_API_KEY`).
- **Impact:** Any GHL SDK calls that rely on the public API key will fail silently or return 401.
- **Recommended Fix:** Add the `GHL_API_KEY` environment variable from the GHL developer portal.
- **Severity:** High

### H-04 — Email delivery unverified; no SMTP fallback configured
- **Description:** Per the platform architecture, email delivery uses a 3-tier strategy: (1) GHL workflow, (2) GHL direct email, (3) SMTP fallback. The SMTP fallback env vars (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`) are not configured. The GHL email pathway depends on GHL_CALENDAR_ID being set (H-02). Password reset and email verification emails have not been confirmed to arrive in a real inbox.
- **Impact:** If GHL is not configured for a contact, no fallback email is sent. Password reset emails may not be delivered in production.
- **Recommended Fix:** Configure SMTP credentials (SendGrid, Resend, or Gmail app password). Trigger a test password reset and confirm email delivery within 2 minutes.
- **Severity:** High

### H-05 — Admin accounts not enrolled in 2FA; forced enrollment not enforced
- **URL:** `/dashboard/security`, `/dashboard/user-management`
- **Description:** Every dashboard page shows a persistent red security warning banner: "Admin 2FA is not enabled." The platform has the 2FA enrollment flow built but does not force admin/manager users to complete enrollment before accessing the dashboard. Any admin account without 2FA can continue using the CRM indefinitely.
- **Impact:** Admin accounts with full access to 515 deals, 50+ contacts, and all financial data are unprotected by a second factor. This is a security requirement for any payment-industry platform.
- **Recommended Fix:** Implement forced 2FA enrollment gate: when an admin or manager logs in without 2FA enrolled, redirect to `/dashboard/security` with a dismissal-blocked prompt before allowing dashboard access.
- **Severity:** High

---

## MEDIUM

### M-01 — `/legal/*` routes return 404 NotFound component
- **URLs:** `/legal/privacy`, `/legal/terms`, `/legal/pci`, `/legal/privacy-policy`
- **Description:** These paths are not registered in `client/src/App.tsx`. The SPA serves HTTP 200 (the shell HTML), but the React router renders the NotFound component (404 page). The actual legal pages are at `/privacy-policy`, `/terms`, etc. Any external links, GHL emails, or documentation pointing to `/legal/*` format will show a 404.
- **Impact:** Users following legal links from emails or documentation see a broken page. Google will eventually index these as soft 404s.
- **Recommended Fix:** Add redirect routes in App.tsx: `/legal/privacy` → `/privacy-policy`, `/legal/terms` → `/terms`, `/legal/pci` → `/security-compliance`. Or add server-side 301 redirects in `server/routes/ssr-routes.ts`.
- **Severity:** Medium

### M-02 — 6 pre-existing unmatched client API paths (tracked in #194)
- **Description:** The api-coverage workflow reports 6 client-side API paths with no matching server handler:
  - `/api/lead-intelligence/full`
  - `/api/public/proposal`
  - `/api/sdr/discovery/nightly/${start` (template literal not resolved)
  - `/api/sdr/merchants`
  - `/api/sms-inbox/thread`
  - `/api/voice-conversations/1/messages`
- **Impact:** Calling these endpoints from the frontend results in a 404 JSON response. Affected pages may show error states or empty data silently.
- **Recommended Fix:** Implement the missing server routes or remove dead client-side calls. (Tracked separately in Task #194.)
- **Severity:** Medium

### M-03 — Activation Panel: feature flag backend endpoint mismatch
- **URL:** `/dashboard/activation`
- **Description:** The `ActivationPanel.tsx` page correctly uses `/api/operator/activation-status` which returns 200. However, this endpoint returns `{"ready":false}` with a list of unmet checks (GHL, OpenAI, etc.) but does not expose individual runtime flag toggles (`SDR_ENABLED`, `ORCHESTRATOR_ENABLED`). The panel visually shows toggle controls but these may not persist toggles to a backend store.
- **Recommended Fix:** Verify that the activation flag toggles in the UI write to a persistent store (env vars cannot be set at runtime; confirm there is a DB-backed flags table). If not, document which flags must be set via environment variables.
- **Severity:** Medium

### M-04 — Live Chat page: `/api/live-chat/sessions` may return empty in all environments
- **URL:** `/dashboard/live-chat`
- **Description:** The Live Chat dashboard (`/dashboard/live-chat`) fetches from `/api/live-chat/sessions` which returns 200 but always empty. The GHL chat widget is the source of chat sessions, but without `GHL_WEBHOOK_SECRET` (H-02), inbound chat webhooks are not processed. Live chat shows an empty state in all current environments.
- **Severity:** Medium

### M-05 — Residual Revenue: wrong API endpoint pattern in UI
- **URL:** `/dashboard/residual-revenue`
- **Description:** The residuals API is at `/api/residuals/imports` (import history) and `/api/residuals/import` (upload). A direct call to `/api/residuals` returns 404. The frontend page uses the correct sub-paths when interacting through the UI, but any component making a direct `/api/residuals` call will fail.
- **Severity:** Medium

### M-06 — Partner portal: co-branded collateral links not verified
- **URL:** `/partner-portal`
- **Description:** The partner portal loads and shows KPI cards, but the co-branded collateral links ("Download PDF", "Sales Deck", etc.) could not be verified to download real files. The collateral packets API (`/api/collateral-packets`) returns 200 but the current environment has no packet records.
- **Severity:** Medium

### M-07 — Merchant portal: no active merchant accounts for end-to-end test
- **URL:** `/dashboard/merchant-portal`
- **Description:** `/api/merchants` returns an empty dataset (`total: 0`). The merchant portal application wizard loads correctly (all 6 steps render), but the post-submission downstream chain (admin notification, GHL e-sign trigger, onboarding pipeline entry) could not be verified without a live merchant account and configured GHL workflow IDs.
- **Severity:** Medium

### M-08 — NPS survey: no database records for positive-path test
- **URL:** `/nps/:token`
- **Description:** The NPS survey page at `/nps/test-token-123` renders gracefully with a "Survey Not Found or Expired" message — which is correct behavior for an invalid token. However, without seeded NPS records, the positive path (valid token → survey form → submission → health alert creation) could not be verified.
- **Severity:** Medium

### M-09 — GSC and Bing verification not configured
- **URL:** `/api/admin/seo-coverage`
- **Description:** The SEO coverage endpoint returns `gscVerificationConfigured: false` and `bingVerificationConfigured: false`. Google Search Console and Bing Webmaster Tools are not connected, meaning crawl errors and indexing issues cannot be monitored.
- **Severity:** Medium

---

## LOW

### L-01 — GHL workflow IDs: none configured
- **URL:** `/dashboard/ghl-workflows`
- **Description:** All GHL workflow ID mappings return `false` (inbound_lead, statement_review, merchant_app, partner_welcome, merchant_approved, etc.). No automated GHL sequences will fire for any platform event. The GHL Workflow ID Manager page renders correctly and can save mappings, but no mappings are set.
- **Severity:** Low

### L-02 — Pipeline: 515 deals in DB but no stage with "Verbal Commit"
- **Description:** Supplementary to H-01. With 515 existing deals, any deals that should be in "Verbal Commit" stage are either in the wrong stage or stuck at "Negotiation / Follow-Up".
- **Severity:** Low (data; fix H-01 first)

### L-03 — Training page: no `/api/training/modules` endpoint
- **URL:** `/dashboard/training`
- **Description:** The Training page uses `/api/training/status` (which exists and returns 200). A direct call to `/api/training/modules` returns 404. No training modules are seeded in the current environment. Page loads but shows an empty state.
- **Severity:** Low

### L-04 — Virtual terminal: no live NMI gateway connection
- **URL:** `/dashboard/virtual-terminal`
- **Description:** Virtual terminal page renders the card entry form correctly. The `/api/virtual-terminal/transactions` endpoint returns an empty array (no test transactions). There is no `/api/virtual-terminal/status` endpoint to confirm NMI gateway connection status — the page must infer this from transaction results.
- **Severity:** Low

### L-05 — Glossary routes: no term index endpoint
- **Description:** `/api/glossary/terms` returns 404. Individual glossary pages at `/glossary/:term` load correctly via server-side rendering. A glossary index page or search feature that calls the list endpoint will silently fail.
- **Severity:** Low

### L-06 — Mobile PWA: requires separate login
- **URL:** `/mobile`
- **Description:** The Mobile PWA (`/mobile`) redirects to `/mobile/login` for unauthenticated users. Users who are logged in via the main dashboard can access `/mobile` directly. The mobile app has its own login screen rather than sharing the main session. This is intentional per architecture but means field reps must log in twice if they switch between desktop and mobile views in different browser contexts.
- **Severity:** Low

### L-07 — `docs/` folder missing several documented artifacts
- **Description:** The following documentation files referenced in the platform specification do not exist:
  - `docs/api-key-status.md` — API key health log (per hardening prompt §1.2)
  - `docs/go-live-checklist.md` (per hardening prompt §12.3)
  - `docs/onboarding-guide.md` (per hardening prompt §12.4)
  - `docs/dialer-integration.md` (per hardening prompt §12.5)
  - `docs/backup-restore.md` (per hardening prompt §11.6)
- **Severity:** Low

### L-08 — Console 401 on page load (unauthenticated resource fetch)
- **Description:** The browser console logs a single 401 error on initial page load. This comes from a background fetch attempting to load user session data before the auth cookie is established. Does not affect UX but clutters the console.
- **Severity:** Low

---

## FEATURE GAPS (vs. Platform Hardening Prompt)

These are capabilities described in the attached hardening prompt that are either missing or unverified.

| # | Section | Feature | Status |
|---|---|---|---|
| FG-01 | §1.2 | `/api/health/db` endpoint with table count + last migration timestamp | Missing — `/api/health` exists but only returns `{ok, uptime, db, session, timestamp}` |
| FG-02 | §1.3 | Email delivery verified with real inbox test | Unverified — no SMTP configured, GHL email unconfirmed |
| FG-03 | §2.9 | GHL integration health dashboard widget on operator dashboard | Not present — operator dashboard has 5 tabs but no live GHL health widget |
| FG-04 | §3.6 | `/application-status` public page for merchants to check application progress | Missing route |
| FG-05 | §3.7 | Incomplete application recovery flow (24hr GHL re-engagement) | Not verified — logic may exist in GHL sequences but not confirmed |
| FG-06 | §4.3 | `/switch` dedicated outreach landing page (no nav, no footer, single form) | Missing — `/free-analysis` exists but has full site nav |
| FG-07 | §6.3 | AI fallback handler for OpenAI errors (user-friendly message, not crash) | Partially present — Error boundaries exist but AI-specific fallback message not confirmed |
| FG-08 | §6.4 | `/legal/ai-disclosure` or `/responsible-ai` page | `/responsible-ai` route exists in App.tsx — loads correctly ✓ |
| FG-09 | §6.5 | AI-powered merchant health alerts (volume drop >20% week-over-week) | Not verified — no merchant data to trigger |
| FG-10 | §7.3 | Merchant analytics tab in merchant portal | Not present — portal has Account, Onboarding, Documents, Support tabs only |
| FG-11 | §7.4 | Merchant chargeback tab in portal with evidence upload | Chargebacks tab exists on contact detail (CRM) but NOT in the merchant-facing portal |
| FG-12 | §8.4 | Co-branded PDF proposal generator for partners | Not present |
| FG-13 | §8.5 | Tiered partner incentives (Bronze/Silver/Gold/Platinum) | Commission tiers exist in DB schema but no tier-badge UI in partner portal |
| FG-14 | §10.2 | Forced 2FA enrollment for admin/manager on next login | Not implemented — see H-05 |

---

## PASSED CHECKS ✓

The following areas passed all smoke tests with no issues:

| Module | Result |
|---|---|
| All 407 public routes (HTTP 200) | ✓ Pass |
| All 37 role-guard auth boundaries (anon→401, merchant→403, admin→200) | ✓ Pass |
| Homepage visual render — hero, nav, CTAs, footer | ✓ Pass |
| `/get-started`, `/free-analysis`, `/upload-statement` forms render | ✓ Pass |
| `/merchant-application` multi-step wizard (all 6 steps) | ✓ Pass |
| Auth flow: login with valid credentials → dashboard redirect | ✓ Pass |
| Auth flow: login with wrong credentials → error shown, no redirect | ✓ Pass |
| Auth flow: `/signup` and `/forgot-password` pages render | ✓ Pass |
| Dashboard Overview loads with KPI data | ✓ Pass |
| Contacts list with pagination | ✓ Pass |
| Contact detail — all tabs (Overview, Activity, Documents, Chargebacks) | ✓ Pass |
| Pipeline Kanban board renders (7 of 8 stages — see H-01) | ✓ Partial |
| Tasks list loads | ✓ Pass |
| Statement Review page loads | ✓ Pass |
| AI Advisors chat — sends prompt, returns response | ✓ Pass |
| SDR dashboard KPI cards render | ✓ Pass |
| Operator dashboard — 5 tabs render without crash | ✓ Pass |
| `/dashboard/activation` — feature flag panel renders | ✓ Pass |
| `/dashboard/ghl-workflows` — workflow ID manager loads | ✓ Pass |
| `/dashboard/document-vault` — global document index renders | ✓ Pass |
| `/dashboard/user-management` — user table with 2FA column | ✓ Pass |
| `/dashboard/security` — MFA settings visible | ✓ Pass |
| `/dashboard/virtual-terminal` — card entry form renders | ✓ Pass |
| `/dashboard/residual-revenue` — import UI renders | ✓ Pass |
| `/dashboard/chargebacks` — list renders (empty state correct) | ✓ Pass |
| `/dashboard/nps` — NPS dashboard renders | ✓ Pass |
| `/dashboard/retention-campaigns` — page renders | ✓ Pass |
| `/dashboard/knowledge-base` — renders (empty state) | ✓ Pass |
| `/dashboard/boarding` — boarding tracker renders | ✓ Pass |
| `/dashboard/sequences`, `/dashboard/workflows`, `/dashboard/campaigns` | ✓ Pass |
| `/dashboard/outreach`, `/dashboard/lead-engine` | ✓ Pass |
| `/dashboard/merchant-health`, `/dashboard/merchant-portal` | ✓ Pass |
| Compare pages (`/compare/square`, `/compare/stripe`) | ✓ Pass |
| Industry pages (`/industries/restaurant-payment-processing` etc.) | ✓ Pass |
| Location × Industry pages (`/locations/miami/restaurant` etc.) | ✓ Pass |
| Blog (`/blog`), Help Center (`/help`), Partner Program (`/partners`) | ✓ Pass |
| Shop (`/shop`), Savings Calculator (`/savings-calculator`) | ✓ Pass |
| NPS survey invalid token → graceful error (not white screen) | ✓ Pass |
| Partner portal login page renders | ✓ Pass |
| Mobile PWA — `/mobile`, `/mobile/pipeline`, `/mobile/contacts`, `/mobile/tasks` at 390px | ✓ Pass |
| Mobile PWA bottom tab navigation visible, no horizontal overflow | ✓ Pass |
| Proposal viewer (`/proposal/:token`) renders without crash | ✓ Pass |
| All thanks pages (`/thanks-statement`, `/thanks-estimate`, `/thanks-call`, `/thanks/application`) | ✓ Pass |
| Legal pages: `/privacy-policy`, `/terms`, `/security-compliance`, `/do-not-sell`, etc. | ✓ Pass |
| `/responsible-ai` page renders | ✓ Pass |
| Error boundary wraps all pages — crash → user-friendly fallback | ✓ Pass |
| SEO audit: 407 routes, 0 HTTP failures, 12 warnings (title/description length) | ✓ Pass |
| GHL status: configured (private token + location ID set) | ✓ Partial |

---

## RECOMMENDED PRIORITY ORDER FOR FIXES

1. **H-05** — Force 2FA enrollment for admin/manager (security)
2. **H-02** — Configure `GHL_CALENDAR_ID` + `GHL_WEBHOOK_SECRET` (breaks calendar + webhooks)
3. **H-03** — Configure `GHL_API_KEY` (breaks some GHL API calls)
4. **H-04** — Verify email delivery end-to-end; configure SMTP fallback
5. **H-01** — Insert "Verbal Commit" pipeline stage into DB
6. **M-01** — Add `/legal/*` → correct path redirects
7. **FG-01** — Extend `/api/health` with DB table count + migration timestamp
8. **FG-04** — Build `/application-status` public page
9. **FG-06** — Build `/switch` dedicated outreach landing page
10. **FG-03** — Add GHL health widget to operator dashboard
11. **L-07** — Create `docs/go-live-checklist.md`, `docs/onboarding-guide.md`, `docs/dialer-integration.md`
12. **FG-10** — Add merchant analytics tab to merchant portal
13. **FG-11** — Add chargeback evidence upload to merchant portal (not just CRM)
14. **M-02** — Resolve 6 pre-existing unmatched API paths (Task #194)
