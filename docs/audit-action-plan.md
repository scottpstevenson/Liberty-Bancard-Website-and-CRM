# Liberty Bancard AI Business Operating System
## Go-Live Readiness Action Plan
**Date:** June 25, 2026 | **Based on:** `docs/audit-go-live.md`

This action plan groups every approved improvement into six execution buckets. Each item includes: priority, audit reference, file/component, what to change, whether it merges/removes/renames/hides/improves an existing feature, why it helps, estimated effort, risk level, test steps, what not to break, and — for every item — an explicit cross-reference to any existing proposed task (or the marker **No existing task found** where none exists).

---

## BUCKET 1 — FIX BEFORE GO-LIVE
*These items block safe production operation. Do them before any merchant or live lead touches the system.*

---

### AP-1.01 — Set GHL_WEBHOOK_SECRET and harden verification logic

| Field | Value |
|---|---|
| **Priority** | P0 — Immediate |
| **Audit Ref** | C11-01 |
| **File** | `server/services/ghl.ts` — `validateGhlWebhookSignature` (lines 112–119) |
| **What to change** | Change the bypass condition from `NODE_ENV !== "production"` to `request origin is 127.0.0.1`. Require `GHL_WEBHOOK_SECRET` in any externally-accessible environment regardless of `NODE_ENV`. Add a startup log warning when the var is missing. Set the secret in all Replit env configs. |
| **Improves existing feature** | Yes — hardens existing webhook handler without changing its logic |
| **Why it helps** | Prevents forged GHL webhook events (contact updates, stage changes, task completions) from corrupting CRM data or triggering automations in staging/pre-production. |
| **Effort** | 30 minutes |
| **Risk** | Low — no behavior change in real production (secret already required there). Only changes how dev-mode bypass is evaluated. |
| **Test steps** | 1. Send a webhook request without a valid HMAC signature — confirm 401. 2. Send with correct signature — confirm 200 and data processed. 3. Remove `GHL_WEBHOOK_SECRET` from env, restart — confirm startup log emits a clear warning. |
| **What not to break** | GHL inbound webhook processing for contacts, opportunities, tasks, document e-sign callbacks. |
| **Existing task coverage** | **No existing task found** |

---

### AP-1.02 — Fix intent classifier model name and centralize AI model constants

| Field | Value |
|---|---|
| **Priority** | P0 — Immediate |
| **Audit Ref** | C5-03, C21-03 |
| **File** | `server/services/sdr/reply-intelligence.ts`; new file `server/config/ai-models.ts` |
| **What to change** | Replace `gpt-5-mini` with the correct model identifier (likely `gpt-4o-mini`). Create `server/config/ai-models.ts` with exported constants for all OpenAI model names used across the codebase. Import from there in all services. Add an error log (not silent fallback) when an AI call fails, so operators can detect AI failures in the Operator Dashboard. |
| **Improves existing feature** | Yes — fixes broken AI classification path and centralizes model name management |
| **Why it helps** | Invalid model name causes every AI reply classification to silently fail and fall through to keyword-only rules. Opt-outs and meeting intents may be missed, creating TCPA exposure. |
| **Effort** | 30–45 minutes |
| **Risk** | Low |
| **Test steps** | 1. Send a test reply with "I'm interested, let's talk" — confirm `meeting_intent` classification from AI (not rule-based). 2. Send "stop" — confirm `immediate_suppression` action fires. 3. Check AI audit log shows a successful classification call. 4. Verify startup does not warn about unknown model. |
| **What not to break** | Rule-based fallback (should still work as secondary path). Other advisor and analysis routes that use OpenAI. |
| **Existing task coverage** | **No existing task found** |

---

### AP-1.03 — Add requireRole("admin") to SDR pause/resume routes

| Field | Value |
|---|---|
| **Priority** | P0 — Immediate |
| **Audit Ref** | C5-02 |
| **File** | `server/routes/sdr.ts` — route registrations for `/api/sdr/pause-all` and `/api/sdr/resume-all` |
| **What to change** | Replace the inline `if (req.user.role !== "admin") return res.status(403)` check with `requireRole("admin")` applied directly as middleware on these two route handlers. Remove the inline check. |
| **Improves existing feature** | Yes — promotes inline check to middleware-level enforcement |
| **Why it helps** | Prevents an agent from accidentally or maliciously starting or stopping the entire SDR orchestrator. Defense-in-depth against future middleware refactors. |
| **Effort** | 15 minutes |
| **Risk** | Very Low |
| **Test steps** | 1. Log in as `agent` role. Call `POST /api/sdr/pause-all` — confirm 403. 2. Log in as `admin` — confirm 200 and orchestrator pauses. 3. Confirm Activation Panel pause button still works for admins. |
| **What not to break** | Admin-initiated pause/resume from Activation Panel and Operator Dashboard. |
| **Existing task coverage** | **No existing task found** |

---

### AP-1.04 — Invalidate sessions immediately on role change

| Field | Value |
|---|---|
| **Priority** | P0 — Immediate |
| **Audit Ref** | C15-01 |
| **File** | `server/routes/admin.ts` (role change route), `server/replit_integrations/auth/storage.ts` (`destroyUserSessions`) |
| **What to change** | After successfully updating a user's role in the DB, call `destroyUserSessions(userId)` (the function exists in auth storage and is not currently called on role change). Ensure the role-changing admin's own session is excluded from destruction. |
| **Improves existing feature** | Yes — closes a session management gap using existing infrastructure |
| **Why it helps** | A demoted or terminated user currently retains full privileged access for up to 7 days (session TTL). This closes that window immediately. |
| **Effort** | 30 minutes |
| **Risk** | Low — only affects the target user's sessions, not the admin performing the change |
| **Test steps** | 1. Log in as admin in Tab A. 2. In Tab B (admin), change Tab A user's role to `agent`. 3. Make an admin-only request from Tab A — confirm 401/403 and redirect to login. 4. Tab B admin's own session must remain active. |
| **What not to break** | The role-changing admin's own session. Normal login flow for the demoted user after re-login. |
| **Existing task coverage** | **No existing task found** |

---

### AP-1.05 — Add ADMIN_SEED_ONCE guard to admin seeding

| Field | Value |
|---|---|
| **Priority** | P0 — Immediate |
| **Audit Ref** | C15-03 |
| **File** | `server/replit_integrations/auth/replitAuth.ts` — `seedAdminUser` function |
| **What to change** | Add a check: if the admin user already exists in the DB with a password hash, skip the password update entirely. Add an `ADMIN_SEED_ONCE` env var that, when set to `true`, completely skips the seeding logic. Log a warning if the password update would have occurred but the guard prevented it. |
| **Improves existing feature** | Yes — reduces env var credential attack surface |
| **Why it helps** | Prevents an env var leak from immediately compromising the admin account on every boot. The password is set once on first startup, then guarded on subsequent boots. |
| **Effort** | 1–2 hours |
| **Risk** | Low — opt-in behavior via new env var |
| **Test steps** | 1. Set `ADMIN_SEED_ONCE=true` and restart. Confirm admin can still log in with existing password. 2. Change `ADMIN_SEED_PASSWORD` in env — restart — confirm admin password did NOT change. 3. Confirm startup log shows "Admin seeding skipped (ADMIN_SEED_ONCE=true)". 4. On a fresh empty DB (without ADMIN_SEED_ONCE), confirm admin is still seeded correctly. |
| **What not to break** | Initial admin creation on a fresh database — guard must not fire when no admin exists yet. |
| **Existing task coverage** | **No existing task found** |

---

### AP-1.06 — Audit SSN/banking data storage and encrypt if plain text

| Field | Value |
|---|---|
| **Priority** | P0 — Before any live merchant applications are accepted |
| **Audit Ref** | C8-02, C14-01 |
| **File** | `shared/schema.ts` — `merchantApplications` table; `server/routes/merchants.ts` — application submission handler |
| **What to change** | (1) Inspect the `merchantApplications` table schema for SSN and bank account number column types. (2) If plain text: add AES-256 application-level encryption in the route handler before DB insert using `MERCHANT_DATA_ENCRYPTION_KEY` env var; decrypt on read in all places that access these fields. (3) Store only the last 4 digits of bank account numbers — never the full account number. (4) Create a backfill migration for any existing plain-text records (document rollback plan before executing). (5) Add `MERCHANT_DATA_ENCRYPTION_KEY` to `docs/launch-env-checklist.md`. |
| **Improves existing feature** | Yes — PCI DSS compliance hardening of existing application flow |
| **Why it helps** | Plain-text SSNs and bank account numbers in PostgreSQL are a PCI DSS Requirement 3 violation and create FL DPLA and FTC exposure. A single breach triggers mandatory notification to every affected merchant. |
| **Effort** | 4–8 hours |
| **Risk** | High — requires a data migration for any existing plain-text records. Document and test the rollback plan before executing in production. |
| **Test steps** | 1. Submit a test merchant application. 2. Query the DB directly — confirm SSN column contains encrypted ciphertext, not readable SSN. 3. View the application in the CRM admin view — confirm last 4 digits display correctly. 4. Confirm underwriting engine can still read the fields it needs (verify decryption on read). |
| **What not to break** | Merchant application submission, underwriting engine field reads, admin application review, e-signature dispatch. |
| **Existing task coverage** | **No existing task found** |

---

### AP-1.07 — Add Florida Mini-TCPA express written consent gate

| Field | Value |
|---|---|
| **Priority** | P0 — Before SDR outbound is enabled |
| **Audit Ref** | C6-02, C14-02 |
| **File** | `server/services/sdr/compliance-engine.ts`; `shared/schema.ts` — `consentAuditLogs` table |
| **What to change** | (1) Add `consentType` column to `consentAuditLogs` with values `general_optin` | `express_written`. (2) Create and apply a schema migration. (3) In the compliance engine, add a state-level check: if contact state = `FL` (or timezone is Eastern and state is unknown), block all automated call/SMS unless `consentType = express_written`. (4) Add `STRICT_STATE_CONSENT_REQUIRED` env var (default: `FL`). (5) Update public lead forms to record `consentType = general_optin`. (6) Update merchant application submission to record `consentType = express_written`. (7) Treat contacts with no consent record as `general_optin` (safe default = blocked from FL outreach). |
| **Improves existing feature** | Yes — extends existing compliance engine with FL-specific PEWC enforcement |
| **Why it helps** | FL Mini-TCPA (SB 1120, 2021) violations carry $500–$1,500 per contact per message. With hundreds of FL contacts, a single outreach campaign without PEWC creates existential financial risk. |
| **Effort** | 4–8 hours |
| **Risk** | Medium — requires schema migration and compliance engine logic change. Test in staging with a FL-state test contact before deploying. |
| **Test steps** | 1. Create FL-state contact with `consentType = general_optin`. 2. Run compliance check — confirm block with reason `fl_tcpa_pewc_required`. 3. Update to `express_written` — confirm compliance check passes. 4. Create a non-FL contact — confirm existing consent logic is unchanged. |
| **What not to break** | Existing DNC, quiet hours, cooling period, and federal holiday checks. Non-FL outreach must not be affected. |
| **Existing task coverage** | "AI SDR Bot — Compliance, Legal & DNC Management" — **partially overlaps; do not duplicate this item if that task is in scope** |

---

### AP-1.08 — Add marketing consent disclosure to all public lead forms

| Field | Value |
|---|---|
| **Priority** | P0 — Before any public traffic is live |
| **Audit Ref** | C14-03, C17-01 |
| **File** | `client/src/pages/GetStarted.tsx`, `client/src/pages/UploadStatement.tsx`, `client/src/pages/FreeAnalysis.tsx`, `client/src/pages/Support.tsx`, `client/src/pages/Estimate.tsx` |
| **What to change** | Add below the submit button on each form: (1) Static consent text: "By submitting this form, you agree to receive SMS and email communications from Liberty Bancard regarding your request. Reply STOP to opt out at any time. Message & data rates may apply. View our [Privacy Policy]." (2) A required, unchecked checkbox for SMS consent specifically. (3) Record the consent in `consentAuditLogs` with `consentType = general_optin` and `channel = sms` on form submission. |
| **Improves existing feature** | Yes — adds compliant consent disclosure and audit logging to existing forms |
| **Why it helps** | TCPA and CAN-SPAM require consent disclosure at the point of data collection. Missing disclosure invalidates any consent obtained from those forms. All leads collected without it cannot be legally contacted via automated outreach. |
| **Effort** | 1–2 hours |
| **Risk** | Low — no backend changes required for the disclosure text. Checkbox adds one required field to the form schema. |
| **Test steps** | 1. Load each public form. 2. Confirm consent text appears below the submit button. 3. Attempt to submit without checking the SMS consent checkbox — confirm validation error. 4. Submit with checkbox checked — verify consent record created in `consentAuditLogs`. |
| **What not to break** | Form submission flow, GHL sync, lead creation pipeline. |
| **Existing task coverage** | "Standardize the primary CTA button text" — **do not modify CTA text while fixing this; address separately** |

---

### AP-1.09 — Fix dead booking CTA link with configurable env var

| Field | Value |
|---|---|
| **Priority** | P0 — Before public launch |
| **Audit Ref** | C17-02 |
| **File** | `client/src/pages/GetStarted.tsx`, `client/src/pages/UploadStatement.tsx`, any other pages with "Book a 10-Minute Call" CTA |
| **What to change** | (1) Add `VITE_BOOKING_URL` env var (frontend-accessible via `import.meta.env.VITE_BOOKING_URL`). (2) Replace all hardcoded placeholder booking URLs with this env var. (3) Add a `console.warn` at build time if the var is empty. (4) Set `VITE_BOOKING_URL` to the real GHL/Calendly scheduling link in Replit Secrets. |
| **Improves existing feature** | Yes — fixes a broken CTA on existing pages |
| **Why it helps** | The booking CTA on the highest-intent pages currently results in a broken/dead experience for every warm inbound lead who clicks it. Direct revenue impact. |
| **Effort** | 30 minutes |
| **Risk** | Very Low |
| **Test steps** | 1. Set `VITE_BOOKING_URL=https://yourbookinglink.com`. 2. Load each page with the CTA. 3. Click CTA — confirm redirect to correct booking page with no 404. |
| **What not to break** | Other CTA buttons on the same pages. The appointment scheduling flow itself (externally managed). |
| **Existing task coverage** | "Add a real calendar booking link so 'Book a 10-Minute Call' actually books a call" — **ALREADY PROPOSED; do not create a duplicate** |

---

### AP-1.10 — Build SDR compliance pre-check gate in orchestrator

| Field | Value |
|---|---|
| **Priority** | P0 — Before ORCHESTRATOR_ENABLED=true in production |
| **Audit Ref** | C5-01, C1-03 |
| **File** | `server/services/sdr/orchestrator.ts`; `server/routes/activation.ts`; `client/src/pages/dashboard/ActivationPanel.tsx` |
| **What to change** | (1) Add a `sdr_compliance_cleared` system setting (default: `false`). (2) At orchestrator boot, check this setting — if false, refuse to process any send jobs and log a warning. (3) Add a compliance readiness checklist in the Activation Panel with items: DNC list uploaded, consent forms configured, quiet hours verified, FL TCPA gate enabled, daily limits set. (4) Admin must check each item and click "Confirm Compliance Readiness" to set `sdr_compliance_cleared=true`. |
| **Improves existing feature** | Yes — adds a safety gate to the existing orchestrator without changing its send logic |
| **Why it helps** | Prevents accidental mass outbound before compliance prerequisites are verified. One env var (`ORCHESTRATOR_ENABLED=true`) currently starts outbound with no intermediate check. |
| **Effort** | 2–4 hours |
| **Risk** | Low — purely additive. Blocks sends until cleared; does not change any send logic. |
| **Test steps** | 1. Set `ORCHESTRATOR_ENABLED=true` with `sdr_compliance_cleared=false`. 2. Confirm orchestrator logs "Compliance gate not cleared — all sends blocked." 3. Confirm no emails/SMS/calls sent. 4. Set `sdr_compliance_cleared=true` via Activation Panel checklist. 5. Confirm orchestrator proceeds with normal batch sweep. |
| **What not to break** | Existing orchestrator sweep logic, kill-switch, bounce-rate kill-switch, global pause/resume controls. |
| **Existing task coverage** | "AI SDR Bot — Compliance, Legal & DNC Management" — **partially overlaps; coordinate with that task to avoid duplication** |

---

### AP-1.11 — Replace 500-contact in-memory GHL sync scans with indexed DB queries

| Field | Value |
|---|---|
| **Priority** | P1 — Before contact list exceeds 500 records |
| **Audit Ref** | C1-04, C19-01, C20-01 |
| **File** | `server/services/ghl-sync.ts` — all occurrences of `storage.getContacts({ limit: 500 })` followed by `.data.find()` |
| **What to change** | Replace each pattern `getContacts({ limit: 500 }).data.find(c => c.ghlContactId === id)` with `storage.getContactByGhlContactId(id)`. Replace `find(c => c.email === email)` with `storage.getContactByEmail(email)`. Apply the same fix to task lookups using `storage.getTaskByGhlTaskId(id)`. All three functions exist in `IStorage` and use database indexes. Affects 10+ call sites in `ghl-sync.ts`. |
| **Reduces duplication** | Yes — removes the same in-memory scan anti-pattern from 10+ locations |
| **Why it helps** | Beyond 500 contacts, the sync silently breaks — re-creating GHL duplicates and missing inbound updates. Also eliminates O(n) DB load every 45 seconds as the contact list grows. |
| **Effort** | 2–4 hours |
| **Risk** | Low — replaces in-memory logic with existing indexed storage methods |
| **Test steps** | 1. Seed contact #501 in the DB. 2. Run `fullSyncToGhl`. 3. Confirm contact #501 is synced to GHL (no duplicate created). 4. Simulate a GHL inbound webhook for contact #501 — confirm it updates, not creates a duplicate. 5. Run `getTasks({ limit: 500 })` replacement — confirm task GHL sync still works. |
| **What not to break** | All `syncContactFromGhl`, `syncContactToGhl`, `syncDealToGhl`, `runGhlSyncTick` code paths across the full sync loop. |
| **Existing task coverage** | "Backfill GHL Contact IDs for contacts created before the sync fix" — **related context, but that task addresses backfilling existing records while this task addresses the query pattern** |

---

### AP-1.12 — Add Redis-missing warning banner to Activation Panel

| Field | Value |
|---|---|
| **Priority** | P1 |
| **Audit Ref** | C12-01 |
| **File** | `client/src/pages/dashboard/ActivationPanel.tsx` (or SystemReadiness.tsx), `server/routes/activation.ts` |
| **What to change** | Add a persistent amber banner to the Activation Panel: "Job queue is running in in-memory mode. Set REDIS_URL for production durability. Jobs will be lost on server restart." Surface the existing System Readiness in-memory flag more prominently in the Activation Panel's health section. |
| **Improves existing feature** | Yes — promotes an existing System Readiness flag to a more visible surface |
| **Why it helps** | In production without Redis, a server restart drops all queued enrichment, GHL sync, and sequence jobs silently. Operators may not notice the System Readiness "In-memory" indicator buried in a secondary page. |
| **Effort** | 30 minutes |
| **Risk** | Very Low |
| **Test steps** | 1. Remove `REDIS_URL` from env and restart. 2. Open Activation Panel — confirm amber warning banner appears prominently. 3. Add `REDIS_URL` back — restart — confirm banner disappears. |
| **What not to break** | Existing System Readiness page display. Normal Activation Panel layout. |
| **Existing task coverage** | **No existing task found** |

---

### AP-1.13 — Add pipeline stage name validation at startup

| Field | Value |
|---|---|
| **Priority** | P1 |
| **Audit Ref** | C3-01 |
| **File** | `server/index.ts` (startup sequence), `shared/schema.ts` — `GHL_PIPELINE_STAGE_MAP` |
| **What to change** | At server startup, compare the keys of `GHL_PIPELINE_STAGE_MAP` against the canonical stage list: `["New Lead", "Statement Received", "Review In Progress", "Call Booked", "Proposal Sent", "Negotiation / Follow-Up", "Verbal Commit", "Closed Won", "Closed Lost"]`. Log a structured warning for any mismatch, including which stage name does not match and what GHL stage ID will be used as fallback. |
| **Improves existing feature** | Yes — adds startup validation to existing stage mapping |
| **Why it helps** | Stage name mismatches cause deals to silently fall back to `"new_lead"` GHL stage ID, breaking GHL automations and pipeline reporting without any error being thrown. |
| **Effort** | 1 hour |
| **Risk** | Very Low — read-only validation at startup |
| **Test steps** | 1. Intentionally rename one stage key in `GHL_PIPELINE_STAGE_MAP`. 2. Restart server — confirm startup log warns about the mismatch with the mismatched key name. 3. Restore correct name — confirm no warning on next restart. |
| **What not to break** | Normal GHL sync operation. The validation must not block server startup. |
| **Existing task coverage** | **No existing task found** |

---

### AP-1.14 — Add boarding simulation mode badge in UI

| Field | Value |
|---|---|
| **Priority** | P1 |
| **Audit Ref** | C8-01, C1-01 |
| **File** | `client/src/pages/dashboard/BoardingTracker.tsx`, `client/src/pages/dashboard/MerchantPortal.tsx` |
| **What to change** | (1) Add a health check endpoint (or extend existing) that returns whether `PROCESSOR_API_KEY` is configured. (2) When not configured, display a yellow "Simulation Mode" badge on the Boarding Tracker header and on the MID display in the Merchant Portal. (3) Add a tooltip: "Processor API credentials not configured. MIDs shown are simulated test values." |
| **Improves existing feature** | Yes — adds UI visibility to existing simulation behavior |
| **Why it helps** | Staff and merchants cannot currently distinguish real MIDs from simulation test MIDs, leading to support confusion and potential routing errors. |
| **Effort** | 1 hour |
| **Risk** | Very Low |
| **Test steps** | 1. Remove `PROCESSOR_API_KEY` from env. 2. Open Boarding Tracker — confirm yellow "Simulation Mode" badge appears in header. 3. Open Merchant Portal with a sim MID — confirm badge appears near the MID display. 4. Add real API key — confirm badge disappears. |
| **What not to break** | Boarding Tracker functionality, MID display, underwriting flow. |
| **Existing task coverage** | **No existing task found** |

---

### AP-1.15 — Add merchant role sidebar filter in DashboardLayout

| Field | Value |
|---|---|
| **Priority** | P1 |
| **Audit Ref** | C9-01 |
| **File** | `client/src/pages/dashboard/DashboardLayout.tsx` — sidebar navigation array |
| **What to change** | Add a role-based filter in the sidebar navigation that hides all CRM-only items (Pipeline, Contacts, SDR, Automation, Sequences, Outreach, Underwriting, etc.) when `user.role === "merchant"`. Only show for merchants: My Portal, Support, Documents, Notifications. The filter should be additive — it does not change what API routes are protected (those guards already exist). |
| **Improves existing feature** | Yes — adds role-based filtering to existing sidebar |
| **Why it helps** | Merchants currently see the full CRM sidebar and get 403 errors on every CRM click, which appears as a broken application. A clean sidebar improves trust and reduces support burden. |
| **Effort** | 2–4 hours |
| **Risk** | Low — purely additive UI filtering; does not change any API access controls |
| **Test steps** | 1. Log in as a `merchant` role user. 2. Confirm sidebar shows only My Portal, Support, Documents, Notifications. 3. Log in as `agent` — confirm full sidebar visible. 4. Log in as `admin` — confirm full sidebar visible. |
| **What not to break** | Admin, manager, and agent sidebar navigation. Partner role sidebar filtering (already exists separately). |
| **Existing task coverage** | **No existing task found** |

---

### AP-1.16 — Create structured startup environment variable validation

| Field | Value |
|---|---|
| **Priority** | P1 |
| **Audit Ref** | C1-05, C22-02 |
| **File** | New: `server/config/env-validation.ts`; `server/index.ts` — call at startup; `client/src/pages/dashboard/ActivationPanel.tsx` — surface results |
| **What to change** | (1) Create `server/config/env-validation.ts` that categorizes all env vars as `critical` (system fails or silently degrades without them), `important` (subsystem degrades), or `optional`. (2) Run at startup before any service initializes. (3) Log a structured table to console grouped by severity. (4) Expose missing critical vars via an API endpoint used by the Activation Panel. (5) Show missing critical vars as red indicators in the Activation Panel health section. |
| **Improves existing feature** | Yes — extends the existing Activation Panel and `docs/launch-env-checklist.md` with runtime enforcement |
| **Why it helps** | Currently, missing vars cause silent degradation with no structured operator feedback. The manual checklist doc requires cross-referencing — runtime validation is automatic. |
| **Effort** | 2–4 hours |
| **Risk** | Very Low — read-only validation |
| **Test steps** | 1. Remove `GHL_API_KEY` from env. 2. Restart — confirm startup log shows "CRITICAL: GHL_API_KEY missing — GHL sync disabled." 3. Open Activation Panel — confirm same information shown as red indicator. 4. Add key back — restart — confirm indicator clears. |
| **What not to break** | Normal startup sequence. Server must still start even when vars are missing (degrade gracefully). |
| **Existing task coverage** | **No existing task found** |

---

### AP-1.17 — Add scanned PDF detection gate in statement upload chain

| Field | Value |
|---|---|
| **Priority** | P1 |
| **Audit Ref** | C7-01, C19-02 |
| **File** | `server/services/proposal-engine.ts` — `extractStatementText`; `server/services/statement-upload-chain.ts` |
| **What to change** | (1) After text extraction, check: if `extractedText.trim().length < 100`, set `analysisStatus = "extraction_failed"` on the deal, create a rep notification: "Statement extraction produced insufficient text — likely a scanned image PDF. Please request a digital PDF or enter analysis manually." Do not proceed to AI analysis. (2) Wrap `extractStatementText` in a try/catch. On PDF parse error, set `analysisStatus = "extraction_error"` and notify the assigned rep with the error reason. |
| **Improves existing feature** | Yes — adds error handling and a content gate to the existing chain |
| **Why it helps** | Prevents the AI from running on empty input and hallucinating fee analysis. Prevents deals from being silently stuck in "Statement Received" with no rep notification after a corrupt upload. |
| **Effort** | 2–3 hours |
| **Risk** | Low — adds branching logic; does not modify the happy path for valid PDFs |
| **Test steps** | 1. Upload a scanned image PDF (all-image, no embedded text). 2. Confirm deal `analysisStatus` = `"extraction_failed"`. 3. Confirm assigned rep receives an in-app notification with an explanation. 4. Upload a valid text-based PDF — confirm analysis proceeds normally through all 11 chain steps. |
| **What not to break** | Normal statement analysis pipeline for valid text PDFs. Deal stage advancement to "Statement Received" (that should still happen even on extraction failure). |
| **Existing task coverage** | "AI SDR Bot — Statement Collection & Auto-Proposal Pipeline" — **partially overlaps; coordinate to avoid duplication** |

---

### AP-1.18 — Add inbound GHL webhook health indicator to sync status panel

| Field | Value |
|---|---|
| **Priority** | P1 |
| **Audit Ref** | C11-02 |
| **File** | `server/services/ghl-sync.ts` — webhook handler; `server/routes/integrations.ts`; GHL sync status UI component |
| **What to change** | (1) In the inbound webhook handler, update a system setting `lastInboundWebhookAt` (timestamp) on every successfully processed webhook. (2) Add a `ghl_inbound_webhook_healthy` field to the GHL sync status response. (3) In the GHL sync status UI panel, add a separate "Inbound Webhooks" health indicator: green if last webhook was received <2h ago, yellow if 2–24h, red if >24h or never received. |
| **Improves existing feature** | Yes — adds inbound observability to the existing sync status panel |
| **Why it helps** | The GHL sync status currently only reflects the outbound 45s loop. Operators see "last synced 45s ago" even when inbound webhooks are completely broken (e.g., missing `GHL_WEBHOOK_SECRET` in production). Two separate indicators give a complete sync health picture. |
| **Effort** | 2–4 hours |
| **Risk** | Low |
| **Test steps** | 1. With `GHL_WEBHOOK_SECRET` missing in production, simulate a GHL contact update. 2. Open GHL sync status panel — confirm inbound indicator shows red. 3. Add the secret, trigger a real webhook — confirm indicator turns green within 2 hours. |
| **What not to break** | Existing outbound GHL sync status display. Existing webhook processing logic. |
| **Existing task coverage** | **No existing task found** |

---

## BUCKET 2 — SIMPLIFY / DEDUPLICATE
*These items reduce maintenance burden, consolidate overlapping features, or remove confusing duplication.*

---

### AP-2.01 — Rename confusing sidebar and tab labels

| Field | Value |
|---|---|
| **Priority** | P2 |
| **Audit Ref** | C2-03, C3-02, C16-01, C16-02 |
| **Files** | `client/src/pages/dashboard/SdrDashboard.tsx`, `client/src/pages/dashboard/ContactDetail.tsx`, `client/src/pages/dashboard/DashboardLayout.tsx` |
| **What to change** | Rename these labels (display text only — do not change route paths): "Identity" tab → "Inbox Health"; "Market" tab → "Market Expansion"; Contact Detail "History" tab → "Audit Log"; Sidebar "Training" (Merchant section) → "Merchant Training"; Sidebar "Training" (Administration) → "System Training Hub"; Contact Detail "Co. Intelligence" tab label → "Company Intel" with a tooltip showing "Company Intelligence" on hover. |
| **Renames existing features** | Yes |
| **Why it helps** | Agents use the wrong tabs and miss health alerts. Sidebar confusion creates support requests. Self-explanatory labels reduce onboarding friction. |
| **Effort** | 30 minutes total |
| **Risk** | Very Low — display text only; no route paths change |
| **Test steps** | Visual review of each renamed tab. Confirm sidebar navigation links still work. Confirm renamed tabs still load the correct components. |
| **What not to break** | Route paths. Tab component bindings. Test IDs if any use the old label text. |
| **Existing task coverage** | **No existing task found** |

---

### AP-2.02 — Add descriptive subtitles to Automation, Workflows, and Sequences pages

| Field | Value |
|---|---|
| **Priority** | P2 |
| **Audit Ref** | C2-02 |
| **Files** | `client/src/pages/dashboard/Automation.tsx`, `client/src/pages/dashboard/Workflows.tsx`, `client/src/pages/dashboard/Sequences.tsx` |
| **What to change** | Add a one-sentence subtitle to each page header: Automation — "High-level orchestration view of all active automations and their current status"; Workflows — "Event-triggered internal rules (stage changes, SLA alerts, task auto-creation)"; Sequences — "Multi-step drip campaigns with email, SMS, and call scheduling." |
| **Improves existing feature** | Yes — adds context to existing pages |
| **Why it helps** | New agents cannot determine which tab to use for which action without trial and error. Subtitles eliminate the guesswork. |
| **Effort** | 15 minutes |
| **Risk** | Very Low |
| **Test steps** | Load each page — confirm subtitle appears under the page title in a secondary text style. |
| **What not to break** | Existing page functionality. Layout on narrow screens. |
| **Existing task coverage** | **No existing task found** |

---

### AP-2.03 — Group content creation tools under a collapsible sidebar section

| Field | Value |
|---|---|
| **Priority** | P2 |
| **Audit Ref** | C16-03 |
| **File** | `client/src/pages/dashboard/DashboardLayout.tsx` |
| **What to change** | Move "Blaze.ai Marketing", "Content Engine", and "LinkedIn Composer" sidebar items under a collapsible "Content Creation" parent section. Keep them as separate nav items inside that section. The section should default to collapsed for agents and expanded for managers/admins. |
| **Improves existing feature** | Yes — reorganizes existing sidebar items without removing any |
| **Why it helps** | Three ungrouped items look like three unrelated features. Grouping communicates they are related capabilities and reduces sidebar visual noise. |
| **Effort** | 30 minutes |
| **Risk** | Very Low |
| **Test steps** | Load dashboard sidebar. Confirm "Content Creation" section is present and collapsible. Expand it — confirm all three links navigate to correct destinations. Collapse it — confirm links are hidden. |
| **What not to break** | Existing navigation paths for each content tool. |
| **Existing task coverage** | **No existing task found** |

---

### AP-2.04 — Extract shared GHL HTTP plumbing into a base client module

| Field | Value |
|---|---|
| **Priority** | P3 — Sprint 2 |
| **Audit Ref** | C2-01, C21-01 |
| **Files** | New: `server/services/ghl-base-client.ts`; Modify: `server/services/ghl.ts`, `server/services/sdr/ghl-client.ts` |
| **What to change** | Extract shared primitives from both GHL clients — auth header construction, `fetch` wrapper with retry, 429 back-off handling — into `ghl-base-client.ts`. Both `ghl.ts` and `sdr/ghl-client.ts` import the base and add their domain-specific methods on top. Do NOT merge business logic — only HTTP plumbing. |
| **Reduces duplication** | Yes |
| **Why it helps** | Auth and retry bug fixes currently require changes in two separate clients. After this change, one place. Future GHL API version changes need only one update. |
| **Effort** | 4–8 hours |
| **Risk** | Medium — touches the HTTP layer for all GHL calls across both systems |
| **Test steps** | After refactor: (1) Run full GHL sync — confirm contacts sync to GHL. (2) Test SDR GHL enrollment — confirm GHL workflow triggered. (3) Test webhook ingestion — confirm contact update processed. (4) Simulate a GHL API 429 — confirm both clients retry correctly. |
| **What not to break** | All 50+ GHL API call sites across both clients. SDR rate limiter logic in `sdr/ghl-client.ts` (must remain in place). |
| **Existing task coverage** | **No existing task found** |

---

### AP-2.05 — Standardize partner authentication through Passport sessions

| Field | Value |
|---|---|
| **Priority** | P3 — Sprint 2 |
| **Audit Ref** | C10-02 |
| **Files** | `server/routes/partners.ts`, `server/routes/partner-orgs.ts`, `server/replit_integrations/auth/` |
| **What to change** | Remove the `req.session.partnerOrgUserId` pattern from all partner org routes. Route all partner org users through the standard Passport session using the existing `partner` role. Update partner org auth routes to call `req.login()` (Passport) instead of setting the custom session key. |
| **Reduces duplication** | Yes — removes a second parallel auth system |
| **Why it helps** | Two auth systems create fragmented session state — a partner may be logged in one context and get 401 in another tab. Single auth system is easier to audit and invalidate on logout. |
| **Effort** | 8–16 hours |
| **Risk** | High — risk of partner login breakage across all white-label portals. Test exhaustively in staging before deploying. Do not rush this change. |
| **Test steps** | (1) Partner org user logs in → confirm session active. (2) Access partner org dashboard → confirm data loads. (3) Log out → confirm both Passport session and any legacy custom session key are cleared. (4) Open two browser tabs as the same partner user — confirm both see identical auth state. (5) Admin revokes partner session — confirm partner is logged out immediately. |
| **What not to break** | Partner portal login, white-label org dashboard, referral tracking, co-branded collateral pages. |
| **Existing task coverage** | **No existing task found** |

---

## BUCKET 3 — POLISH QUICKLY
*Low-risk, high-visibility improvements each deliverable in under a day.*

---

### AP-3.01 — Rate limit OG image generation endpoint

| Field | Value |
|---|---|
| **Priority** | P2 |
| **Audit Ref** | C15-04, C20-02 |
| **File** | `server/routes/og.ts` |
| **What to change** | Apply a rate limiter (60 req/min per IP) to the `/og/:template/:slug.png` route using the existing rate-limiter middleware pattern. Verify the disk cache TTL is at least 24 hours. |
| **Improves existing feature** | Yes — adds protection to the existing OG image endpoint |
| **Effort** | 15 minutes |
| **Risk** | Very Low |
| **Test steps** | Send 61 requests from the same IP in 60 seconds — confirm 61st returns 429. Load a social share preview in a fresh browser — confirm OG image loads normally on first hit. |
| **What not to break** | Legitimate OG image loading for social share previews and metadata scrapers. |
| **Existing task coverage** | **No existing task found** |

---

### AP-3.02 — Fix partner org slug enumeration via public branding endpoint

| Field | Value |
|---|---|
| **Priority** | P2 |
| **Audit Ref** | C10-01 |
| **File** | `server/routes/partner-orgs.ts` — `/api/partner-org/:slug/branding` |
| **What to change** | For unknown slugs, return HTTP 200 with an empty branding object (same response as a known slug with no custom branding). Add a constant response delay of ~100ms for all requests regardless of whether the slug was found, to prevent timing-based enumeration. |
| **Improves existing feature** | Yes — hardens existing public branding endpoint |
| **Effort** | 30 minutes |
| **Risk** | Very Low |
| **Test steps** | 1. Request `/api/partner-org/nonexistent-slug-xyz/branding` — confirm 200 with empty branding object. 2. Request a known valid slug — confirm 200 with correct branding. 3. Time both responses — confirm they are within ~50ms of each other. |
| **What not to break** | White-label partner org pages that rely on the branding data for real slugs. |
| **Existing task coverage** | **No existing task found** |

---

### AP-3.03 — Add rate limiting to SSR marketing routes at origin

| Field | Value |
|---|---|
| **Priority** | P3 |
| **Audit Ref** | C17-03 |
| **File** | `server/routes/ssr-routes.ts` |
| **What to change** | Add a 200 req/min per IP rate limiter to all SSR marketing routes (applied at the Express route level). Legitimate CDN traffic uses distributed IPs and is unaffected. This protects the origin only. |
| **Improves existing feature** | Yes — adds origin protection alongside existing CDN-level caching |
| **Effort** | 30 minutes |
| **Risk** | Very Low — CDN traffic is unaffected; Googlebot uses distributed IPs |
| **Test steps** | Send 201 rapid requests from same IP — confirm 429 on 201st. Load a marketing page normally in a browser — confirm no change in behavior. |
| **What not to break** | Normal page loading, bot crawlers (Googlebot uses distributed IPs), CDN prefetch. |
| **Existing task coverage** | **No existing task found** |

---

### AP-3.04 — Add proposal narrative editor in Deal detail view

| Field | Value |
|---|---|
| **Priority** | P3 |
| **Audit Ref** | C7-02 |
| **File** | Deal detail page component, `server/routes/deals.ts` — PATCH endpoint |
| **What to change** | Add editable text areas for `repBriefing`, `competitivePositioning`, and `recommendedProgram` fields directly in the Deal detail view. Position them between the AI-generated proposal summary and the "Send Proposal" action button. Save changes via PATCH to the deal before send. |
| **Improves existing feature** | Yes — adds a human editing surface to the existing AI proposal flow |
| **Why it helps** | Reps currently either send AI output verbatim (risk of errors) or skip the proposal feature entirely because there is no easy way to customize it. |
| **Effort** | 4–8 hours |
| **Risk** | Low |
| **Test steps** | Edit `repBriefing` field → save → send proposal → confirm updated text appears in the delivered co-branded proposal PDF. |
| **What not to break** | AI proposal generation, co-branded proposal delivery, proposal tracking pixel. |
| **Existing task coverage** | "AI SDR Bot — Statement Collection & Auto-Proposal Pipeline" — **partially overlaps; coordinate to avoid duplication** |

---

### AP-3.05 — Add Executive AI advisor data disclaimer

| Field | Value |
|---|---|
| **Priority** | P3 |
| **Audit Ref** | C13-02 |
| **File** | `client/src/pages/dashboard/Chat.tsx` — advisor role display logic |
| **What to change** | When the selected advisor role is "Executive", display a static disclaimer banner below the chat input: "Responses are based on CRM data as of [last GHL sync timestamp]. Verify any financial projections with your accounting system before acting on them." Banner should not appear for other advisor roles. |
| **Improves existing feature** | Yes — adds a governance disclaimer to the existing Executive advisor mode |
| **Effort** | 30 minutes |
| **Risk** | Very Low |
| **Test steps** | Switch advisor to "Executive" → confirm disclaimer banner appears. Switch to "Sales" → confirm banner disappears. Verify the last sync timestamp shown is accurate. |
| **What not to break** | Other advisor modes (Sales, Support, Compliance, Finance, Onboarding, Marketing). |
| **Existing task coverage** | **No existing task found** |

---

## BUCKET 4 — STRENGTHEN RELIABILITY
*These items prevent data loss, silent failures, and scale-related breakage.*

---

### AP-4.01 — Add phone-only contact sync to GHL

| Field | Value |
|---|---|
| **Priority** | P2 |
| **Audit Ref** | C11-03 |
| **File** | `server/services/ghl-sync.ts` — `fullSyncToGhl` — `unsyncedContacts` filter |
| **What to change** | Remove the `&& c.email` condition from the `unsyncedContacts` filter in `fullSyncToGhl`. Ensure `upsertGhlContact` gracefully handles contacts with no email — it already uses phone as the lookup key when email is absent, but confirm it does not throw on null email. |
| **Improves existing feature** | Yes — expands existing sync coverage to phone-only contacts |
| **Why it helps** | Phone-only leads (inbound call forms, SMS opt-ins) permanently miss GHL follow-up automations. |
| **Effort** | 1–2 hours |
| **Risk** | Low — ensure `upsertGhlContact` handles null email in the payload without error |
| **Test steps** | Create a contact with a phone number but no email. Run `fullSyncToGhl`. Confirm a GHL contact is created using phone as the identifier. Confirm no errors thrown during sync. |
| **What not to break** | Email-based contact sync, GHL deduplication logic for email-only contacts. |
| **Existing task coverage** | "Backfill GHL Contact IDs for contacts created before the sync fix" — **related context; the backfill task should also run after this fix** |

---

### AP-4.02 — Add pre-import duplicate detection to CSV import

| Field | Value |
|---|---|
| **Priority** | P2 |
| **Audit Ref** | C18-02 |
| **File** | `server/routes/imports.ts`, import UI component |
| **What to change** | Before completing a CSV import, run a DB check for email and phone matches against existing contacts. Return a preview report to the user: "X records will be created new, Y records match existing contacts by email, Z match by phone." Allow the user to choose: skip duplicates / merge into existing / import all (override). |
| **Improves existing feature** | Yes — adds a validation gate to the existing CSV import flow |
| **Why it helps** | Bulk imports without dedup create thousands of duplicate contacts, inflate pipeline metrics, and cause duplicate outreach (TCPA risk). |
| **Effort** | 4–8 hours |
| **Risk** | Low — additive pre-flight check; does not change import logic for non-duplicate rows |
| **Test steps** | Import a CSV with 5 new and 5 existing email addresses. Confirm preview shows "5 new, 5 email duplicates." Choose "skip duplicates" — confirm only 5 new contacts created. Run again with "import all" — confirm all 10 imported. |
| **What not to break** | Existing CSV import for clean (non-duplicate) data. Sunbiz entity import (separate system). |
| **Existing task coverage** | **No existing task found** |

---

### AP-4.03 — Add phone number E.164 validation and normalization

| Field | Value |
|---|---|
| **Priority** | P2 |
| **Audit Ref** | C18-01 |
| **File** | `server/routes/contacts.ts`, `server/routes/public.ts` |
| **What to change** | Add E.164-format normalization and US phone validity check on all phone inputs using `libphonenumber-js` (lightweight, already commonly available). If invalid, return 400 with a clear message: "Invalid US phone number format — please enter a 10-digit US phone number." Store the normalized E.164 value in the DB. For existing contacts with non-normalized phone numbers, normalize on read (not on write, to avoid a backfill migration). |
| **Improves existing feature** | Yes — adds input validation to existing contact creation routes |
| **Why it helps** | Invalid phone numbers cause quiet-hours timezone misclassification (TCPA risk), failed GHL sync, and non-deliverable SMS messages. |
| **Effort** | 2–4 hours |
| **Risk** | Low |
| **Test steps** | Submit "(555) 123-4567" via the contact form — confirm stored as "+15551234567". Submit "1234" — confirm 400 validation error. Submit valid phone via public lead form — confirm GHL sync succeeds with the normalized number. |
| **What not to break** | Existing contacts with phone numbers already stored in various formats (normalize on read). International contacts if any (apply US-only validation only to contacts with US state indicated). |
| **Existing task coverage** | **No existing task found** |

---

### AP-4.04 — Reduce GHL sync worker failure alert threshold

| Field | Value |
|---|---|
| **Priority** | P3 |
| **Audit Ref** | C12-02 |
| **File** | `server/services/queue-manager.ts` — `WORKER_FAILURE_ALERT_THRESHOLD` |
| **What to change** | Reduce `WORKER_FAILURE_ALERT_THRESHOLD` for the `ghl-sync` queue from 10 to 3. Make it configurable via a `GHL_SYNC_FAILURE_THRESHOLD` env var (default: 3). Document the env var in `docs/launch-env-checklist.md`. |
| **Improves existing feature** | Yes — tunes existing alerting to be more sensitive for the most critical queue |
| **Effort** | 30 minutes |
| **Risk** | Very Low — may increase alert noise during GHL API transient issues. Acceptable tradeoff for faster failure detection. |
| **Test steps** | Disable GHL API key. After exactly 3 sync failures, confirm an operator alert fires. Restore GHL key — confirm sync recovers and alert clears. |
| **What not to break** | Normal sync operation when GHL API is healthy. Other queue alert thresholds (only change `ghl-sync`). |
| **Existing task coverage** | **No existing task found** |

---

## BUCKET 5 — HARDEN SECURITY AND COMPLIANCE
*These items close specific security gaps and compliance exposure.*

---

### AP-5.01 — Add per-advisor AI confidence thresholds for Compliance and Finance

| Field | Value |
|---|---|
| **Priority** | P2 |
| **Audit Ref** | C13-01 |
| **File** | `server/services/ai-audit-logger.ts`, `server/routes/ai.ts` |
| **What to change** | Add `HIGH_CONFIDENCE_ADVISOR_ROLES` env var (default: `compliance,finance`). When the advisor role matches a high-confidence role, use a higher confidence threshold (e.g., 0.85) for routing to the review queue, regardless of the global `AI_CONFIDENCE_THRESHOLD` setting. All other roles use the global threshold. |
| **Improves existing feature** | Yes — adds granularity to the existing AI governance routing |
| **Why it helps** | Compliance and Finance AI responses carry regulatory risk if wrong. A 72% confidence compliance response currently bypasses human review (global threshold 70%). A per-role override catches these before they reach staff. |
| **Effort** | 2–4 hours |
| **Risk** | Low — additive routing logic |
| **Test steps** | Set global threshold to 0.70 and `HIGH_CONFIDENCE_ADVISOR_ROLES=compliance`. Generate a compliance response with 0.75 confidence. Confirm it routes to review queue. Generate a sales response with 0.75 confidence — confirm it does NOT route to review queue. |
| **What not to break** | Sales, Support, Onboarding, Marketing, Executive advisor routing. Review queue processing. |
| **Existing task coverage** | **No existing task found** |

---

### AP-5.02 — Document and rationalize CSRF exemption list

| Field | Value |
|---|---|
| **Priority** | P2 |
| **Audit Ref** | C15-02 |
| **File** | `server/middleware/csrf.ts` — `EXEMPT_PATHS_EXACT` array |
| **What to change** | Add an inline comment for each exempt path explaining: (1) why it is exempt (public unauthenticated endpoint vs. webhook receiver), (2) whether it is authenticated or public. Format: `// [PUBLIC] /api/statements/upload — unauthenticated public form endpoint; no session to protect`. Add a developer note at the top of the array: "Adding an authenticated endpoint here requires a security review." |
| **Improves existing feature** | Yes — adds safety documentation to the existing CSRF middleware |
| **Effort** | 30 minutes |
| **Risk** | Very Low — documentation change only |
| **Test steps** | Code review — confirm every exempt path has a justification comment. Confirm no existing CSRF protection is removed. |
| **What not to break** | CSRF protection on all non-exempt routes. |
| **Existing task coverage** | **No existing task found** |

---

### AP-5.03 — Add PostgreSQL advisory lock to migration execution

| Field | Value |
|---|---|
| **Priority** | P3 — Relevant when Replit autoscale or multi-instance deployment is used |
| **Audit Ref** | C22-01 |
| **File** | `server/db-migrate.ts` |
| **What to change** | Wrap the migration execution block in a PostgreSQL advisory lock: acquire `pg_try_advisory_lock(12345)` before running migrations. If lock is not acquired (another instance holds it), poll every 500ms and retry for up to 30 seconds. Release the lock after migration completes. Advisory locks are automatically released on connection close even if code throws — no manual cleanup required on failure. |
| **Improves existing feature** | Yes — adds concurrency safety to the existing auto-migration |
| **Effort** | 2–4 hours |
| **Risk** | Low — advisory locks are safe and non-blocking on normal single-instance deployments |
| **Test steps** | Simulate two server processes starting simultaneously (two terminal windows, nearly concurrent). Confirm only one runs migrations (logs "Migration lock acquired"), the other waits and then confirms "Migrations already applied." Both processes start successfully. |
| **What not to break** | Normal single-instance migration flow. Migration rollback behavior. |
| **Existing task coverage** | **No existing task found** |

---

## BUCKET 6 — IMPROVE MAINTAINABILITY
*These items reduce technical debt and make the codebase easier to extend safely.*

---

### AP-6.01 — Centralize OpenAI model names in a constants file

| Field | Value |
|---|---|
| **Priority** | P2 |
| **Audit Ref** | C21-03, C5-03 |
| **File** | New: `server/config/ai-models.ts`; all `server/services/` files referencing OpenAI model strings |
| **What to change** | Create `server/config/ai-models.ts` with exported constants: `GPT_4O = "gpt-4o"`, `GPT_4O_MINI = "gpt-4o-mini"`, etc. Replace all inline model name string literals across `server/services/` with imports from this file. Fix `gpt-5-mini` in the process (same work as AP-1.02). |
| **Reduces duplication** | Yes — removes scattered hardcoded model name strings |
| **Why it helps** | OpenAI model upgrades require finding and updating every hardcoded string. A centralized constants file makes upgrades a one-line change. Invalid model names (like `gpt-5-mini`) become obvious during import. |
| **Effort** | 2 hours |
| **Risk** | Very Low |
| **Test steps** | After refactor, grep for any remaining model name strings in `server/services/`. Run AI advisor test — confirm model calls succeed. Run reply classification test — confirm correct model used. |
| **What not to break** | All AI service calls across advisors, analysis, enrichment, and classification. |
| **Existing task coverage** | **No existing task found** |

---

### AP-6.02 — Document route registration order constraints in server/routes.ts

| Field | Value |
|---|---|
| **Priority** | P3 |
| **Audit Ref** | C21-02 |
| **File** | `server/routes.ts` |
| **What to change** | Add block comments at the top and between registration groups documenting: (1) which registrations are order-sensitive and why, (2) that `registerOgRoutes` must precede `registerSsrRoutes` (to prevent OG paths being caught by SSR wildcard), (3) that `registerPermissionsAuditRoutes` must precede the API 404 catch-all. |
| **Improves existing feature** | Yes — adds safety documentation to the existing route registration |
| **Effort** | 30 minutes |
| **Risk** | Very Low — documentation only |
| **Test steps** | Code review — confirm comments are accurate and match actual order constraints. |
| **What not to break** | Nothing — documentation change only. |
| **Existing task coverage** | **No existing task found** |

---

### AP-6.03 — Add discovery flag interdependency warning at startup

| Field | Value |
|---|---|
| **Priority** | P2 |
| **Audit Ref** | C4-01 |
| **File** | `server/services/queue-manager.ts` or `server/index.ts` — startup sequence |
| **What to change** | At worker boot, if `NIGHTLY_DISCOVERY_ENABLED=true` but `LEGACY_OUTREACH_ENABLED=false`, log: "WARNING: NIGHTLY_DISCOVERY_ENABLED=true but LEGACY_OUTREACH_ENABLED=false — discovery jobs will be queued but the discovery worker will not process them. Set LEGACY_OUTREACH_ENABLED=true to enable discovery processing." Surface this warning in the Activation Panel's flag status section. |
| **Improves existing feature** | Yes — adds observability to the existing feature flag system |
| **Why it helps** | Operators enabling discovery alone get zero results and no explanation. This warning surfaces the interdependency clearly so operators can take the right corrective action. |
| **Effort** | 30 minutes |
| **Risk** | Very Low |
| **Test steps** | Set `NIGHTLY_DISCOVERY_ENABLED=true` with `LEGACY_OUTREACH_ENABLED=false`. Restart — confirm warning log appears. Open Activation Panel — confirm warning shown alongside flag status. Set both to true — confirm warning disappears. |
| **What not to break** | Normal discovery processing when both flags are set correctly. |
| **Existing task coverage** | **No existing task found** |

---

### AP-6.04 — Add discovery provider API key health checks to System Readiness

| Field | Value |
|---|---|
| **Priority** | P2 |
| **Audit Ref** | C4-02 |
| **File** | `client/src/pages/dashboard/SystemReadiness.tsx`, `server/routes/activation.ts` |
| **What to change** | Add health check rows to the System Readiness page for each discovery provider API key: Serper.dev (`SERPER_API_KEY`), Outscraper (`OUTSCRAPER_API_KEY`), Apify (`APIFY_API_TOKEN`). Show green if key is present and non-empty, red if missing. Optionally ping each API and report status/latency as a secondary check. |
| **Improves existing feature** | Yes — extends existing System Readiness coverage |
| **Why it helps** | Without key presence indicators, an expired or missing discovery provider key causes zero leads discovered with no visible reason. Operators conclude the feature is broken when the fix is a single env var. |
| **Effort** | 1–2 hours |
| **Risk** | Very Low |
| **Test steps** | Remove `SERPER_API_KEY` from env — confirm System Readiness shows Serper as red. Add it back — confirm green. All other existing readiness checks must continue to pass. |
| **What not to break** | Existing System Readiness checks (Redis, GHL, SMTP, OpenAI). |
| **Existing task coverage** | **No existing task found** |

---

## CROSS-REFERENCE: EXISTING PROPOSED TASKS

The following action plan items directly overlap with already-proposed tasks. Do not create duplicate tasks for these items:

| Action Plan Item | Existing Task (do not duplicate) |
|---|---|
| AP-1.09 (Fix dead booking CTA) | "Add a real calendar booking link so 'Book a 10-Minute Call' actually books a call" — **already proposed** |
| AP-1.07, AP-1.10 (FL TCPA, SDR compliance gate) | "AI SDR Bot — Compliance, Legal & DNC Management" — **partially overlaps; coordinate** |
| AP-1.17 (Statement chain error handling) | "AI SDR Bot — Statement Collection & Auto-Proposal Pipeline" — **partially overlaps; coordinate** |
| AP-3.04 (Proposal narrative editor) | "AI SDR Bot — Statement Collection & Auto-Proposal Pipeline" — **partially overlaps; coordinate** |
| AP-1.11, AP-4.01 (GHL contact sync) | "Backfill GHL Contact IDs for contacts created before the sync fix" — **related context; run backfill after the query pattern fix** |

The following action plan items have **no existing task coverage** and would need new tasks created if prioritized for sprint work:
AP-1.01, AP-1.02, AP-1.03, AP-1.04, AP-1.05, AP-1.06, AP-1.08, AP-1.12, AP-1.13, AP-1.14, AP-1.15, AP-1.16, AP-1.18, AP-2.01, AP-2.02, AP-2.03, AP-2.04, AP-2.05, AP-3.01, AP-3.02, AP-3.03, AP-3.05, AP-4.02, AP-4.03, AP-4.04, AP-5.01, AP-5.02, AP-5.03, AP-6.01, AP-6.02, AP-6.03, AP-6.04

The following existing tasks are **not covered** by any action plan item and remain independent:
- "Standardize the primary CTA button text across all public pages"
- "Fix remaining dead links in Navbar and UploadStatement page"
- "Track which Sales Tools links actually drive uploads"
- "Make the Equipment page printable as a product sheet"
- "Add mobile-optimized layout to the Sales One-Pager"
- "Let agents attach evidence files to a chargeback case"
- "Add chargeback ratio warning to the merchant overview card"
- "Apply the chargebacks DB schema change to production after next deployment"
- "Show a document count badge on the Documents tab"
- "Let reps bulk-download all documents for a merchant as a ZIP file"
- "Restrict document access so reps only see their own merchants' files"
- "Send NPS survey emails automatically when surveys are created"
- "Agent Agreement & Earnings Calculator"

---

## SUMMARY TABLE

| Item | Bucket | Priority | Effort | Risk | Go-Live Blocker | Existing Task |
|---|---|---|---|---|---|---|
| AP-1.01 Set GHL_WEBHOOK_SECRET | Fix | P0 | 30m | Low | Yes | No existing task |
| AP-1.02 Fix gpt-5-mini model name | Fix | P0 | 30m | Low | Yes | No existing task |
| AP-1.03 SDR pause/resume requireRole | Fix | P0 | 15m | Low | Yes | No existing task |
| AP-1.04 Invalidate sessions on role change | Fix | P0 | 30m | Low | Yes | No existing task |
| AP-1.05 ADMIN_SEED_ONCE guard | Fix | P0 | 1–2h | Low | Yes | No existing task |
| AP-1.06 SSN/banking encryption audit | Fix | P0 | 4–8h | High | Yes | No existing task |
| AP-1.07 FL TCPA consent gate | Fix | P0 | 4–8h | Med | Yes | Partially: Compliance task |
| AP-1.08 Public form consent disclosure | Fix | P0 | 1–2h | Low | Yes | No existing task |
| AP-1.09 Fix dead booking CTA | Fix | P0 | 30m | Low | Yes | Existing task |
| AP-1.10 SDR compliance pre-check gate | Fix | P0 | 2–4h | Low | Yes | Partially: Compliance task |
| AP-1.11 Replace 500-contact in-memory scan | Fix | P1 | 2–4h | Low | Yes | Partially: Backfill task |
| AP-1.12 Redis-missing warning banner | Fix | P1 | 30m | Low | Yes | No existing task |
| AP-1.13 Pipeline stage validation at startup | Fix | P1 | 1h | Low | Yes | No existing task |
| AP-1.14 Boarding simulation mode badge | Fix | P1 | 1h | Low | Yes | No existing task |
| AP-1.15 Merchant role sidebar filter | Fix | P1 | 2–4h | Low | Yes | No existing task |
| AP-1.16 Structured startup env validation | Fix | P1 | 2–4h | Low | Yes | No existing task |
| AP-1.17 Scanned PDF detection gate | Fix | P1 | 2–3h | Low | Yes | Partially: Statement task |
| AP-1.18 Inbound webhook health indicator | Fix | P1 | 2–4h | Low | Yes | No existing task |
| AP-2.01 Rename confusing labels | Simplify | P2 | 30m | Low | No | No existing task |
| AP-2.02 Descriptive page subtitles | Simplify | P2 | 15m | Low | No | No existing task |
| AP-2.03 Group content creation sidebar | Simplify | P2 | 30m | Low | No | No existing task |
| AP-2.04 Extract GHL base client | Simplify | P3 | 4–8h | Med | No | No existing task |
| AP-2.05 Standardize partner sessions | Simplify | P3 | 8–16h | High | No | No existing task |
| AP-3.01 Rate limit OG image endpoint | Polish | P2 | 15m | Low | No | No existing task |
| AP-3.02 Fix partner org slug enumeration | Polish | P2 | 30m | Low | No | No existing task |
| AP-3.03 Rate limit SSR routes | Polish | P3 | 30m | Low | No | No existing task |
| AP-3.04 Proposal narrative editor | Polish | P3 | 4–8h | Low | No | Partially: Statement task |
| AP-3.05 Executive advisor disclaimer | Polish | P3 | 30m | Low | No | No existing task |
| AP-4.01 Phone-only GHL sync | Reliability | P2 | 1–2h | Low | No | Partially: Backfill task |
| AP-4.02 CSV import duplicate detection | Reliability | P2 | 4–8h | Low | No | No existing task |
| AP-4.03 Phone E.164 normalization | Reliability | P2 | 2–4h | Low | No | No existing task |
| AP-4.04 Lower GHL sync failure threshold | Reliability | P3 | 30m | Low | No | No existing task |
| AP-5.01 Per-advisor AI confidence thresholds | Security | P2 | 2–4h | Low | No | No existing task |
| AP-5.02 Document CSRF exemption list | Security | P2 | 30m | Low | No | No existing task |
| AP-5.03 Migration advisory lock | Security | P3 | 2–4h | Low | No | No existing task |
| AP-6.01 Centralize AI model names | Maintain | P2 | 2h | Low | No | No existing task |
| AP-6.02 Route registration documentation | Maintain | P3 | 30m | Low | No | No existing task |
| AP-6.03 Discovery flag interdependency warning | Maintain | P2 | 30m | Low | No | No existing task |
| AP-6.04 Discovery provider health checks | Maintain | P2 | 1–2h | Low | No | No existing task |

**Total P0 estimated effort:** ~15–30 hours
**Total P1 estimated effort:** ~15–25 hours
**Total P2/P3 estimated effort:** ~45–80 hours
**Grand total:** ~75–135 hours

---

*End of docs/audit-action-plan.md*
