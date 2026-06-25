# Liberty Bancard AI Business Operating System
## Go-Live Readiness Audit — 22-Category Report
**Audit Date:** June 25, 2026
**Auditor:** AI Readiness Review
**Codebase snapshot:** Current HEAD

> **Issue schema used for every finding:**
> Category · Severity · File/Component/Route · What is wrong · Why it matters · Business/operational impact · Compliance/security risk · Smallest safe fix · Reduces duplication · Estimated effort · Risk level · Fixable without rewrite · Must fix before go-live

---

## PART I — FINDINGS BY CATEGORY

---

### CATEGORY 1 — GO-LIVE READINESS

---

**C1-01 — Processor boarding runs in simulation mode**

| Field | Value |
|---|---|
| **Category** | Go-Live Readiness |
| **Severity** | Critical |
| **File/Component** | `server/services/processor-api.ts`, `server/services/processors/nmi.adapter.ts` |
| **What is wrong** | The NMI/processor boarding integration runs in simulation mode when `PROCESSOR_API_KEY` and `NMI_SECURITY_KEY` are absent. `generateMockMid()` creates fake MIDs. No visible warning appears in the UI. |
| **Why it matters** | Live merchant boarding is the core operational outcome. Sim mode makes the boarding UI appear functional when nothing real happens. |
| **Business/operational impact** | Merchants receive fake MIDs. Residuals, health scores, and MID data pipelines all operate on test data. Staff cannot distinguish sim MIDs from real ones. |
| **Compliance/security risk** | Falsely approved MID records could constitute misrepresentation to merchants. |
| **Smallest safe fix** | Set `PROCESSOR_API_KEY` and `NMI_SECURITY_KEY` with real credentials. Until credentials are live, display a "Simulation Mode" banner in the Boarding Tracker and Merchant Portal when `PROCESSOR_API_KEY` is missing. |
| **Reduces duplication** | No |
| **Estimated effort** | 1–2 hours (env var + banner) |
| **Risk level** | High |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | Yes |

---

**C1-02 — E-signature flow missing GHL template ID**

| Field | Value |
|---|---|
| **Category** | Go-Live Readiness |
| **Severity** | Critical |
| **File/Component** | `server/services/ghl.ts` (`sendDocumentForEsign`), `server/routes/merchants.ts` |
| **What is wrong** | The e-signature flow requires `GHL_MERCHANT_AGREEMENT_TEMPLATE_ID`. Without it, the system sends a generic "pending" email with no e-sign link. Merchant applications complete with no legally binding signature. |
| **Why it matters** | Merchant agreements must be signed before processing begins. An unsigned application creates direct liability. |
| **Business/operational impact** | Merchants start processing without signed agreements. No contract exists to enforce terms. |
| **Compliance/security risk** | Regulatory exposure for processing without merchant consent documents. Potential contract enforceability issue. |
| **Smallest safe fix** | Set `GHL_MERCHANT_AGREEMENT_TEMPLATE_ID` in env, or block application submission with an admin alert when the var is missing. |
| **Reduces duplication** | No |
| **Estimated effort** | 1 hour (env var + guard) |
| **Risk level** | High |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | Yes |

---

**C1-03 — SDR activation flags have no compliance pre-check gate**

| Field | Value |
|---|---|
| **Category** | Go-Live Readiness |
| **Severity** | High |
| **File/Component** | `server/services/feature-flags.ts`, `server/services/sdr/orchestrator.ts` |
| **What is wrong** | `SDR_ENABLED` defaults to `true` but `ORCHESTRATOR_ENABLED`, `VOICE_AI_ENABLED`, `SMS_ENABLED`, and `NIGHTLY_DISCOVERY_ENABLED` default to `false`. A single accidental `ORCHESTRATOR_ENABLED=true` in production before DNC/compliance review starts mass outbound with no gate. |
| **Why it matters** | No confirmation prompt or compliance pre-check exists before outbound launches. |
| **Business/operational impact** | Accidental mass outreach before DNC list upload triggers TCPA complaints and potential regulatory action. |
| **Compliance/security risk** | TCPA violation risk if orchestrator fires before opt-in/DNC data is loaded. |
| **Smallest safe fix** | Add a `sdr_compliance_cleared` system setting (default: `false`). Orchestrator checks this before processing any send job. Admin confirms compliance checklist before setting to `true`. |
| **Reduces duplication** | No |
| **Estimated effort** | 2–4 hours |
| **Risk level** | Medium |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | Yes |

---

**C1-04 — GHL sync hard-capped at 500 contacts via in-memory filter**

| Field | Value |
|---|---|
| **Category** | Go-Live Readiness |
| **Severity** | High |
| **File/Component** | `server/services/ghl-sync.ts` (lines 189, 220, 263, 557, 642, 780, 784, 887, 911, 1030) |
| **What is wrong** | GHL sync calls `storage.getContacts({ limit: 500 })` and filters in memory. With >500 contacts, contacts beyond the window are invisible to the sync engine — silently re-created as duplicates in GHL or missed entirely. |
| **Why it matters** | Data divergence between CRM and GHL grows unbounded past 500 contacts. |
| **Business/operational impact** | Duplicate GHL contacts, missed follow-up sequences, wrong reporting. Affects all sales and SDR operations at scale. |
| **Compliance/security risk** | Duplicate contacts cause duplicate outreach — a TCPA risk at scale. |
| **Smallest safe fix** | Replace in-memory filter with indexed DB queries: `getContactByGhlContactId()` and `getContactByEmail()` already exist in IStorage. Use them instead. |
| **Reduces duplication** | Yes — removes in-memory scan anti-pattern used in 10+ locations |
| **Estimated effort** | 2–4 hours |
| **Risk level** | Medium |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | Yes |

---

**C1-05 — No runtime enforcement or UI warning for missing critical env vars**

| Field | Value |
|---|---|
| **Category** | Go-Live Readiness |
| **Severity** | High |
| **File/Component** | `server/index.ts`, `client/src/pages/dashboard/ActivationPanel.tsx`, `docs/launch-env-checklist.md` |
| **What is wrong** | Critical subsystems silently degrade or run in sim/fallback mode with no structured operator visibility. Missing vars include: `REDIS_URL`, `GHL_API_KEY`, `GHL_LOCATION_ID`, `GHL_PIPELINE_ID`, `GHL_WEBHOOK_SECRET`, `PROCESSOR_API_KEY`, `GHL_MERCHANT_AGREEMENT_TEMPLATE_ID`, `OPENAI_API_KEY`, `SMTP_HOST`. |
| **Why it matters** | The team believes the system is live when critical integrations are disabled. |
| **Business/operational impact** | No GHL sync, no AI analysis, no email delivery — all silently degraded with no operator alert. |
| **Compliance/security risk** | None directly, but operational blind spots can mask compliance failures. |
| **Smallest safe fix** | Create `server/config/env-validation.ts` that runs at startup and logs a structured warning table. Surface missing critical vars as red indicators in the Activation Panel. |
| **Reduces duplication** | No |
| **Estimated effort** | 2–4 hours |
| **Risk level** | Low |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | Yes |

---

### CATEGORY 2 — DUPLICATION AND SIMPLIFICATION

---

**C2-01 — Two GHL API clients with overlapping functionality**

| Field | Value |
|---|---|
| **Category** | Duplication and Simplification |
| **Severity** | Medium |
| **File/Component** | `server/services/ghl.ts`, `server/services/sdr/ghl-client.ts` |
| **What is wrong** | Two separate GHL API clients exist: `ghl.ts` (core CRM sync) and `sdr/ghl-client.ts` (SDR-specific with rate limiter). Both handle contact upsert, workflow enrollment, and authentication. Bug fixes must be applied twice. |
| **Why it matters** | Rate limiting exists only in the SDR client. The core client relies on retry-after headers. Auth and retry logic diverge over time. |
| **Business/operational impact** | Maintenance overhead. Future GHL auth token changes require two code updates. Inconsistent error handling across sync paths. |
| **Compliance/security risk** | None directly. |
| **Smallest safe fix** | Extract shared HTTP primitives (auth headers, fetch wrapper, retry) into `server/services/ghl-base-client.ts`. Both clients import from it. Do not merge domain logic. |
| **Reduces duplication** | Yes |
| **Estimated effort** | 4–8 hours |
| **Risk level** | Medium |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | No |

---

**C2-02 — Three automation sidebar tabs with overlapping scope**

| Field | Value |
|---|---|
| **Category** | Duplication and Simplification |
| **Severity** | Low |
| **File/Component** | `client/src/pages/dashboard/Automation.tsx`, `client/src/pages/dashboard/Workflows.tsx`, `client/src/pages/dashboard/Sequences.tsx` |
| **What is wrong** | Three separate sidebar tabs (Automation, Workflows, Sequences) cover overlapping automation concerns with no descriptive subtitles. To a new agent they look identical. |
| **Why it matters** | Agents cannot determine which tab to use for which action without trial and error. |
| **Business/operational impact** | Support requests and misconfigured automations from confused reps. |
| **Compliance/security risk** | None. |
| **Smallest safe fix** | Add one-sentence subtitles to each page header explaining scope. |
| **Reduces duplication** | Partially — no code removed, but reduces confusion from apparent duplication |
| **Estimated effort** | 15 minutes |
| **Risk level** | Low |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | No |

---

**C2-03 — "Training" appears twice in sidebar with different destinations**

| Field | Value |
|---|---|
| **Category** | Duplication and Simplification |
| **Severity** | Low |
| **File/Component** | `client/src/pages/dashboard/DashboardLayout.tsx` — sidebar navigation |
| **What is wrong** | The sidebar label "Training" appears in both the Merchant section and the Administration section, pointing to different routes. Agents cannot tell which to use. |
| **Why it matters** | Creates navigation confusion and leads to wrong-tab support requests. |
| **Business/operational impact** | Minor — agents land on wrong training page and must back-navigate. |
| **Compliance/security risk** | None. |
| **Smallest safe fix** | Rename to "Merchant Training" and "System Training Hub" respectively. |
| **Reduces duplication** | Yes |
| **Estimated effort** | 10 minutes |
| **Risk level** | Low |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | No |

---

### CATEGORY 3 — CRM AND PIPELINE CLARITY

---

**C3-01 — Pipeline stage names not validated against GHL stage IDs at startup**

| Field | Value |
|---|---|
| **Category** | CRM and Pipeline Clarity |
| **Severity** | Medium |
| **File/Component** | `shared/schema.ts` — `GHL_PIPELINE_STAGE_MAP`, `server/services/ghl-sync.ts` — `mapDealStageToGhl` |
| **What is wrong** | The canonical stage list in `replit.md` is `New Lead → Statement Received → Review In Progress → Call Booked → Proposal Sent → Negotiation / Follow-Up → Verbal Commit → Closed Won / Closed Lost`. Any mismatch with `GHL_PIPELINE_STAGE_MAP` keys causes deals to silently fall back to `"new_lead"` GHL stage ID, breaking GHL automations and pipeline reporting. |
| **Why it matters** | Stage drift causes wrong follow-up sequences and incorrect forecast reporting in GHL. |
| **Business/operational impact** | GHL automations fire on wrong stages. Proposals sent at wrong times. Revenue forecasting skewed. |
| **Compliance/security risk** | None directly. |
| **Smallest safe fix** | Add a startup validation that cross-checks `GHL_PIPELINE_STAGE_MAP` keys against the canonical stage list and logs a structured warning for any mismatch. |
| **Reduces duplication** | No |
| **Estimated effort** | 1 hour |
| **Risk level** | Low |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | Yes |

---

**C3-02 — Contact Detail "History" and "Activity" tabs ambiguously named**

| Field | Value |
|---|---|
| **Category** | CRM and Pipeline Clarity |
| **Severity** | Low |
| **File/Component** | `client/src/pages/dashboard/ContactDetail.tsx` |
| **What is wrong** | Contact Detail page has both a "History" tab (audit log via `ChangeHistoryTab`) and an "Activity" tab (CRM activity timeline). Both show historical records about the contact. The naming is ambiguous. |
| **Why it matters** | Reps looking for audit trails check the wrong tab first. |
| **Business/operational impact** | Minor UX friction; reps may miss important audit information. |
| **Compliance/security risk** | None. |
| **Smallest safe fix** | Rename "History" to "Audit Log" — self-explanatory and matches what the tab shows. |
| **Reduces duplication** | No |
| **Estimated effort** | 10 minutes |
| **Risk level** | Low |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | No |

---

### CATEGORY 4 — LEAD DISCOVERY ENGINE

---

**C4-01 — Discovery worker requires two flags but no documentation links them**

| Field | Value |
|---|---|
| **Category** | Lead Discovery Engine |
| **Severity** | High |
| **File/Component** | `server/services/feature-flags.ts` — `NIGHTLY_DISCOVERY_ENABLED` (default false), `server/services/sdr/lead-finder.ts` |
| **What is wrong** | The Nightly Lead Discovery Engine is disabled by default. The BullMQ `discovery` queue exists but the worker also requires `LEGACY_OUTREACH_ENABLED=true` to process any jobs. Two flags must be enabled together with no documentation linking them. Enabling `NIGHTLY_DISCOVERY_ENABLED` alone produces no results and no error message. |
| **Why it matters** | Operators enabling discovery alone get zero results with no explanation, wasting setup time. |
| **Business/operational impact** | Lead pipeline stays empty; team concludes the feature is broken. |
| **Compliance/security risk** | None. |
| **Smallest safe fix** | Log a clear warning at worker boot: "NIGHTLY_DISCOVERY_ENABLED is true but LEGACY_OUTREACH_ENABLED is false — discovery jobs will be queued but not processed." Surface in Activation Panel. |
| **Reduces duplication** | No |
| **Estimated effort** | 30 minutes |
| **Risk level** | Low |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | No |

---

**C4-02 — No health checks for discovery provider API keys**

| Field | Value |
|---|---|
| **Category** | Lead Discovery Engine |
| **Severity** | Medium |
| **File/Component** | `server/services/sdr/serper-enrichment.ts`, `server/services/sdr/outscraper.ts`, `server/services/sdr/apify.ts` |
| **What is wrong** | Discovery relies on three external paid APIs (Serper.dev, Outscraper, Apify). Failed discovery jobs are DLQ'd but there is no UI indicator distinguishing "API key missing" from "transient API error." |
| **Why it matters** | Operators may not realize discovery is silently failing due to missing/expired API keys. |
| **Business/operational impact** | Zero new leads discovered with no explanation. Lost prospecting ROI. |
| **Compliance/security risk** | None. |
| **Smallest safe fix** | Add API key presence check (green/red) to the System Readiness page for each discovery provider: `SERPER_API_KEY`, `OUTSCRAPER_API_KEY`, `APIFY_API_TOKEN`. |
| **Reduces duplication** | No |
| **Estimated effort** | 1–2 hours |
| **Risk level** | Low |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | No |

---

### CATEGORY 5 — SDR ORCHESTRATOR AND SEQUENCES

---

**C5-01 — SDR orchestrator has no compliance pre-check gate**

| Field | Value |
|---|---|
| **Category** | SDR Orchestrator and Sequences |
| **Severity** | Critical |
| **File/Component** | `server/services/sdr/orchestrator.ts`, `server/services/feature-flags.ts` |
| **What is wrong** | The orchestrator has a bounce-rate kill-switch but no pre-launch compliance gate. DNC list loading, consent record verification, and quiet-hours configuration are not validated before `ORCHESTRATOR_ENABLED=true` starts outbound sends. |
| **Why it matters** | TCPA requires verifiable consent before outbound SMS/calls. No gate means one env var change triggers mass outreach. |
| **Business/operational impact** | Regulatory complaints, cease-and-desist, blocked sending domains. |
| **Compliance/security risk** | Direct TCPA and CAN-SPAM violation risk. FL Mini-TCPA ($500–$1,500 per violation). |
| **Smallest safe fix** | Add `sdr_compliance_cleared` system setting (default: `false`). Orchestrator blocks all sends until an admin checks a readiness checklist in the Activation Panel and confirms. |
| **Reduces duplication** | No |
| **Estimated effort** | 2–4 hours |
| **Risk level** | Medium |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | Yes |

---

**C5-02 — SDR pause/resume uses inline role check instead of middleware**

| Field | Value |
|---|---|
| **Category** | SDR Orchestrator and Sequences |
| **Severity** | High |
| **File/Component** | `server/routes/sdr.ts` — `/api/sdr/pause-all`, `/api/sdr/resume-all` |
| **What is wrong** | Both routes use `isAuthenticated` at middleware level then check `req.user.role === "admin"` inline. If the inline check is accidentally removed, any authenticated user (including agents) can pause or resume the entire SDR orchestrator. |
| **Why it matters** | Defense-in-depth principle: security checks should not rely on inline handler code alone. |
| **Business/operational impact** | An agent could accidentally start the SDR orchestrator during non-compliance period. |
| **Compliance/security risk** | Unauthorized activation of outbound SDR sends — TCPA exposure. |
| **Smallest safe fix** | Replace inline check with `requireRole("admin")` middleware directly on these two route registrations. |
| **Reduces duplication** | No |
| **Estimated effort** | 15 minutes |
| **Risk level** | Low |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | Yes |

---

**C5-03 — Intent classifier references invalid OpenAI model name**

| Field | Value |
|---|---|
| **Category** | SDR Orchestrator and Sequences |
| **Severity** | High |
| **File/Component** | `server/services/sdr/reply-intelligence.ts` |
| **What is wrong** | The intent classifier references `gpt-5-mini` (likely a placeholder for `gpt-4o-mini`). Invalid model names cause every AI reply classification to fail silently and fall through to keyword-only rule-based fallback with no error logged to operators. |
| **Why it matters** | Silent AI failure means opt-outs may only be caught by keyword rules — not the full AI classification pipeline. |
| **Business/operational impact** | Missed meeting intents (no booking links sent), missed edge-case opt-outs. |
| **Compliance/security risk** | Missed opt-out detection is a TCPA/CAN-SPAM compliance risk. |
| **Smallest safe fix** | Correct the model name. Add an error log (not just silent fallback) when the AI call fails so operators can see the failure rate. |
| **Reduces duplication** | No |
| **Estimated effort** | 30 minutes |
| **Risk level** | Low |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | Yes |

---

### CATEGORY 6 — REPLY INTELLIGENCE

---

**C6-01 — No operator visibility into AI vs rule-based classification failure rate**

| Field | Value |
|---|---|
| **Category** | Reply Intelligence |
| **Severity** | High |
| **File/Component** | `server/services/sdr/reply-intelligence.ts`, `client/src/pages/dashboard/OperatorDashboard.tsx` |
| **What is wrong** | There is no monitoring for how frequently the AI classification path fails and the rule-based fallback fires. Operators cannot tell if the AI is working or if the system is silently running on keyword rules only. |
| **Why it matters** | If the AI is broken (wrong model name, OpenAI outage, quota exceeded), operators see no signal — they assume the system is working correctly. |
| **Business/operational impact** | Missed meeting intents (lost bookings), missed opt-outs, wrong sequence advancement. |
| **Compliance/security risk** | Missed opt-outs are a TCPA/CAN-SPAM risk. |
| **Smallest safe fix** | Add counters to the Operator Dashboard: "AI classify success/failure/fallback counts in last 24h." |
| **Reduces duplication** | No |
| **Estimated effort** | 2–4 hours |
| **Risk level** | Low |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | No |

---

**C6-02 — Florida Mini-TCPA express written consent not enforced**

| Field | Value |
|---|---|
| **Category** | Reply Intelligence |
| **Severity** | High |
| **File/Component** | `server/services/sdr/compliance-engine.ts` |
| **What is wrong** | Florida's Mini-TCPA (SB 1120, July 1, 2021) requires prior express written consent (PEWC) for automated calls/texts to Florida numbers. The compliance engine enforces quiet hours and DNC but does not distinguish between PEWC and general opt-in consent. |
| **Why it matters** | Liberty Bancard operates primarily in Florida. FL Mini-TCPA violations carry $500–$1,500 per violation per contact. |
| **Business/operational impact** | Regulatory fines, lawsuits, sending domain blacklisting. Potentially thousands of contacts in FL without PEWC. |
| **Compliance/security risk** | Direct regulatory exposure in the primary market. High. |
| **Smallest safe fix** | Add `consentType` field to consent audit log (`general_optin` vs `express_written`). Block FL-state contacts from automated outreach unless `consentType = express_written`. Add `STRICT_STATE_CONSENT_REQUIRED` env var (default: `FL`). |
| **Reduces duplication** | No |
| **Estimated effort** | 4–8 hours |
| **Risk level** | Medium |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | Yes |

---

### CATEGORY 7 — STATEMENT REVIEW AND PROPOSAL CHAIN

---

**C7-01 — Scanned/image PDFs produce empty AI analysis with no warning**

| Field | Value |
|---|---|
| **Category** | Statement Review and Proposal Chain |
| **Severity** | Medium |
| **File/Component** | `server/services/proposal-engine.ts` — `extractStatementText` |
| **What is wrong** | Statement text extraction uses `pdf-parse` for text-based PDFs only. Scanned PDFs return near-empty text. The AI analysis then runs on blank input and may hallucinate hidden fees. There is no OCR fallback or minimum text threshold check. |
| **Why it matters** | Many merchant statements are scanned PDFs from physical processors. These produce garbage AI analysis. |
| **Business/operational impact** | Wrong proposals sent to merchants; undermines trust in the analysis product. Rep time wasted on manual correction. |
| **Compliance/security risk** | None directly, but incorrect fee analysis could mislead merchants about competitor rates. |
| **Smallest safe fix** | If extracted text < 100 characters, set `analysisStatus = "extraction_failed"`, create a rep notification, and halt AI analysis. Do not send a proposal based on blank input. |
| **Reduces duplication** | No |
| **Estimated effort** | 1–2 hours |
| **Risk level** | Low |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | Yes |

---

**C7-02 — No UI for editing AI-generated proposal before sending**

| Field | Value |
|---|---|
| **Category** | Statement Review and Proposal Chain |
| **Severity** | Low |
| **File/Component** | Deal detail page, `server/services/co-branded-proposal.ts` |
| **What is wrong** | The UI for editing an AI-generated proposal before sending is limited to raw JSON in the deals table. A rep cannot edit narrative, adjust pricing recommendations, or customize the proposal without modifying database fields directly. |
| **Why it matters** | Reps send AI output verbatim (risk of errors) or skip the proposal feature entirely. |
| **Business/operational impact** | Reduced proposal quality and adoption rate. Lost close rate on warm proposals. |
| **Compliance/security risk** | None directly. |
| **Smallest safe fix** | Add editable text fields for `repBriefing`, `competitivePositioning`, and `recommendedProgram` in the Deal detail view before the "Send Proposal" button. |
| **Reduces duplication** | No |
| **Estimated effort** | 4–8 hours |
| **Risk level** | Low |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | No |

---

### CATEGORY 8 — MERCHANT APPLICATION AND ONBOARDING

---

**C8-01 — Simulation MIDs indistinguishable from real MIDs in UI**

| Field | Value |
|---|---|
| **Category** | Merchant Application and Onboarding |
| **Severity** | High |
| **File/Component** | `server/services/processor-api.ts` — `generateMockMid`, `client/src/pages/dashboard/BoardingTracker.tsx`, `client/src/pages/dashboard/MerchantPortal.tsx` |
| **What is wrong** | The processor boarding API inserts simulation MIDs (prefixed `TEST-` or random) into `deals.mid` when in sim mode. No visible badge or indicator differentiates them from live MIDs in the Boarding Tracker or Merchant Portal. |
| **Why it matters** | Staff and merchants cannot distinguish real MIDs from test MIDs in production. |
| **Business/operational impact** | Support confusion, potential billing/routing errors if sim MIDs are treated as live. |
| **Compliance/security risk** | None directly. |
| **Smallest safe fix** | Display a "Simulation Mode" badge on Boarding Tracker and Merchant Portal when `PROCESSOR_API_KEY` is absent. |
| **Reduces duplication** | No |
| **Estimated effort** | 1 hour |
| **Risk level** | Low |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | Yes |

---

**C8-02 — SSN and banking data may be stored in plain text**

| Field | Value |
|---|---|
| **Category** | Merchant Application and Onboarding |
| **Severity** | Critical |
| **File/Component** | `client/src/pages/MerchantApplication.tsx`, `server/routes/merchants.ts`, `shared/schema.ts` — `merchantApplications` table |
| **What is wrong** | The merchant application wizard collects SSN and banking information. The schema does not document whether these fields are encrypted at rest. If stored as plain text, this violates PCI DSS Requirement 3 and applicable data protection laws. |
| **Why it matters** | SSN and bank account numbers stored in plain text are a critical compliance and legal liability. |
| **Business/operational impact** | A data breach exposing SSNs triggers state breach notification obligations, FTC action, and merchant lawsuits. |
| **Compliance/security risk** | PCI DSS Requirement 3 violation. FL Digital Privacy Law exposure. Federal FTC exposure. High — must be addressed before any live applications are accepted. |
| **Smallest safe fix** | Audit `merchantApplications` table. If SSN is plain text, add AES-256 application-level encryption before DB insert. Store only last 4 digits of bank account numbers. |
| **Reduces duplication** | No |
| **Estimated effort** | 4–8 hours |
| **Risk level** | High |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | Yes |

---

### CATEGORY 9 — MERCHANT PORTAL

---

**C9-01 — Merchant role sees full CRM sidebar navigation**

| Field | Value |
|---|---|
| **Category** | Merchant Portal |
| **Severity** | Medium |
| **File/Component** | `client/src/pages/dashboard/DashboardLayout.tsx` — sidebar navigation |
| **What is wrong** | Merchants log in via the same dashboard session system as staff. The partner-role guard blocks CRM API calls (403), but the merchant still sees the full CRM sidebar (Pipeline, Contacts, SDR, Outreach, etc.) before hitting the 403 on click. |
| **Why it matters** | Every CRM sidebar link appears broken to a merchant user. |
| **Business/operational impact** | Poor merchant UX. Merchants assume the portal is broken and contact support. Potential information disclosure from sidebar labels (e.g., merchant sees competitor-related labels). |
| **Compliance/security risk** | Minor — sidebar labels could expose internal operational terms to merchants. |
| **Smallest safe fix** | Add a role-based sidebar filter in `DashboardLayout.tsx` that hides CRM-only items when `user.role === "merchant"`. Show only: My Portal, Support, Documents, Notifications. |
| **Reduces duplication** | No |
| **Estimated effort** | 2–4 hours |
| **Risk level** | Low |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | Yes |

---

### CATEGORY 10 — PARTNER AND AFFILIATE PROGRAMS

---

**C10-01 — Partner org slug enumeration via public branding endpoint**

| Field | Value |
|---|---|
| **Category** | Partner and Affiliate Programs |
| **Severity** | Medium |
| **File/Component** | `server/routes/partner-orgs.ts` — `/api/partner-org/:slug/branding` |
| **What is wrong** | The partner org branding endpoint is public and unauthenticated. A 200 response confirms the slug exists; a 404 confirms it does not. Any actor can enumerate all valid partner org slugs. |
| **Why it matters** | Exposes the partner/sub-agent roster to competitors. |
| **Business/operational impact** | Competitive intelligence exposure. Competitors can map Liberty Bancard's entire ISO network. |
| **Compliance/security risk** | None regulatory, but a business confidentiality concern. |
| **Smallest safe fix** | Return 200 with an empty branding object for unknown slugs (same as known slugs with no custom branding). Add a constant ~100ms response time to prevent timing attacks. |
| **Reduces duplication** | No |
| **Estimated effort** | 30 minutes |
| **Risk level** | Low |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | No |

---

**C10-02 — Partner authentication uses two separate session mechanisms**

| Field | Value |
|---|---|
| **Category** | Partner and Affiliate Programs |
| **Severity** | Medium |
| **File/Component** | `server/routes/partners.ts`, `server/routes/partner-orgs.ts`, `server/replit_integrations/auth/` |
| **What is wrong** | Partner portal authentication uses `req.session.partnerOrgUserId` in some routes vs. standard Passport `req.user` session in others. This fragmented auth state causes unpredictable behavior — a partner can be "logged in" in one context but get 401 in another. |
| **Why it matters** | Auth inconsistency creates support burden and potential data access issues. |
| **Business/operational impact** | Partner confusion, support burden. A partner may see dashboard in one tab and 401 in another on the same session. |
| **Compliance/security risk** | Fragmented sessions are harder to audit and harder to invalidate on logout. |
| **Smallest safe fix** | Standardize all partner authentication through Passport's session using the `partner` role. Remove `req.session.partnerOrgUserId` pattern. |
| **Reduces duplication** | Yes — removes a second auth system |
| **Estimated effort** | 8–16 hours |
| **Risk level** | Medium |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | No |

---

### CATEGORY 11 — GHL INTEGRATION

---

**C11-01 — Webhook signature verification skipped in non-production without secret**

| Field | Value |
|---|---|
| **Category** | GHL Integration |
| **Severity** | High |
| **File/Component** | `server/services/ghl.ts` — `validateGhlWebhookSignature` (lines 112–119) |
| **What is wrong** | When `GHL_WEBHOOK_SECRET` is not set and `NODE_ENV !== "production"`, webhook signature verification is skipped entirely. In staging or pre-production environments accessible externally, this allows unauthenticated actors to inject fake GHL webhook events (contact updates, opportunity stage changes, task completions). |
| **Why it matters** | Forged webhooks can corrupt CRM data, trigger automated workflows, and enroll contacts in wrong sequences. |
| **Business/operational impact** | CRM data corruption. Contacts enrolled in wrong sequences. Pipeline stages advanced by forged events. |
| **Compliance/security risk** | Data integrity. Unauthorized automation of outreach. |
| **Smallest safe fix** | Change bypass condition: only skip verification if `NODE_ENV === "development"` AND request is from localhost (127.0.0.1). Require `GHL_WEBHOOK_SECRET` in all externally-accessible environments. Add startup warning when missing. |
| **Reduces duplication** | No |
| **Estimated effort** | 30 minutes |
| **Risk level** | Medium |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | Yes |

---

**C11-02 — Inbound webhook health not surfaced in GHL sync status UI**

| Field | Value |
|---|---|
| **Category** | GHL Integration |
| **Severity** | High |
| **File/Component** | `server/services/ghl-sync.ts`, GHL sync status UI component |
| **What is wrong** | When `GHL_WEBHOOK_SECRET` is absent in production, the webhook handler returns 503 for all incoming webhooks (correctly rejected). However, the GHL sync status panel shows "last synced 45s ago" (from the outbound loop) even when inbound webhooks are completely broken. No operator alert exists for this state. |
| **Why it matters** | Operators see green sync status while inbound sync is silently broken. |
| **Business/operational impact** | Inbound contact updates, stage changes, and task completions from GHL are lost with no operator awareness. |
| **Compliance/security risk** | None directly. |
| **Smallest safe fix** | Track `lastInboundWebhookAt` as a system setting, updated on every successful inbound webhook. Show a separate inbound health indicator: green <2h, yellow 2–24h, red >24h or never. |
| **Reduces duplication** | No |
| **Estimated effort** | 2–4 hours |
| **Risk level** | Low |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | Yes |

---

**C11-03 — Phone-only contacts never synced to GHL**

| Field | Value |
|---|---|
| **Category** | GHL Integration |
| **Severity** | Medium |
| **File/Component** | `server/services/ghl-sync.ts` — `fullSyncToGhl` |
| **What is wrong** | `fullSyncToGhl` skips contacts where `c.email` is falsy (`const unsyncedContacts = contacts.filter(c => !c.ghlContactId && c.email)`). Contacts created from phone-only inbound leads are never synced to GHL and never enter GHL follow-up sequences. |
| **Why it matters** | Phone-only leads — common for inbound call forms — permanently miss GHL automations. |
| **Business/operational impact** | A category of leads never gets follow-up. Missed revenue from phone-only inbound traffic. |
| **Compliance/security risk** | None. |
| **Smallest safe fix** | Remove the `&& c.email` filter. Ensure `upsertGhlContact` handles phone-only payloads gracefully (it already uses phone as lookup key when email absent). |
| **Reduces duplication** | No |
| **Estimated effort** | 1–2 hours |
| **Risk level** | Low |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | No |

---

### CATEGORY 12 — JOB QUEUES AND AUTOMATION SAFETY

---

**C12-01 — No warning when running without Redis (in-memory fallback active)**

| Field | Value |
|---|---|
| **Category** | Job Queues and Automation Safety |
| **Severity** | Medium |
| **File/Component** | `server/services/queue-connection.ts`, `server/index.ts`, `client/src/pages/dashboard/ActivationPanel.tsx` |
| **What is wrong** | When `REDIS_URL` is missing, the system falls back to `setInterval`-based workers (non-persistent). Jobs in flight when the server restarts are lost. The System Readiness page shows "In-memory fallback" but this is easy to miss. No persistent warning banner exists. |
| **Why it matters** | In production without Redis, a server restart drops all queued enrichment, GHL sync, and sequence jobs silently. |
| **Business/operational impact** | Silent data loss during restarts; GHL sync gaps; sequence timing drift. Data quality degrades without Redis. |
| **Compliance/security risk** | Lost compliance logs (consent, DNC) if audit log writes are queue-backed. |
| **Smallest safe fix** | Add a persistent amber banner to the Activation Panel when in-memory fallback is active: "Warning: Job queue is in-memory only. Set REDIS_URL for production durability." |
| **Reduces duplication** | No |
| **Estimated effort** | 30 minutes |
| **Risk level** | Low |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | Yes |

---

**C12-02 — GHL sync worker failure alert threshold too high**

| Field | Value |
|---|---|
| **Category** | Job Queues and Automation Safety |
| **Severity** | Low |
| **File/Component** | `server/services/queue-manager.ts` — `WORKER_FAILURE_ALERT_THRESHOLD` |
| **What is wrong** | The worker failure alert threshold defaults to 10 consecutive failures. At 45s per job, that means ~7.5 minutes of undetected sync failure before an alert fires. No per-queue override exists. |
| **Why it matters** | A GHL API outage or token expiry takes 7.5 minutes to surface. During that time, CRM updates are silently lost. |
| **Business/operational impact** | Extended GHL sync outage with no operator awareness. Deals may advance stages locally without GHL automation firing. |
| **Compliance/security risk** | None directly. |
| **Smallest safe fix** | Reduce default threshold to 3 for the `ghl-sync` queue. Make configurable via `GHL_SYNC_FAILURE_THRESHOLD` env var. |
| **Reduces duplication** | No |
| **Estimated effort** | 30 minutes |
| **Risk level** | Low |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | No |

---

### CATEGORY 13 — AI ADVISORS AND AI GOVERNANCE

---

**C13-01 — AI confidence threshold is global — no per-advisor override**

| Field | Value |
|---|---|
| **Category** | AI Advisors and AI Governance |
| **Severity** | Medium |
| **File/Component** | `server/services/ai-audit-logger.ts` — confidence threshold logic |
| **What is wrong** | The AI confidence threshold for routing to the review queue is a single global env var (`AI_CONFIDENCE_THRESHOLD`). Compliance and Finance advisor responses carry regulatory risk if wrong but are reviewed at the same threshold as Sales advisor responses. |
| **Why it matters** | A Compliance advisor response with 72% confidence (above global 70% threshold) bypasses human review, but that response may contain incorrect regulatory guidance. |
| **Business/operational impact** | Staff act on incorrect AI compliance guidance without knowing it was low-confidence. Regulatory exposure. |
| **Compliance/security risk** | Incorrect compliance guidance could expose the company to regulatory risk from FTC, TCPA enforcement, or state regulators. |
| **Smallest safe fix** | Add `HIGH_CONFIDENCE_ADVISOR_ROLES` env var (default: `compliance,finance`). Use a higher threshold (e.g., 0.85) for these roles regardless of global setting. |
| **Reduces duplication** | No |
| **Estimated effort** | 2–4 hours |
| **Risk level** | Low |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | No |

---

**C13-02 — Executive AI advisor has no disclaimer for financial projections**

| Field | Value |
|---|---|
| **Category** | AI Advisors and AI Governance |
| **Severity** | Low |
| **File/Component** | `client/src/pages/dashboard/Chat.tsx` — Executive advisor mode |
| **What is wrong** | The "Executive" advisor uses a generic prompt and lacks integration with real-time financial data beyond basic CRM metrics. Executive users may ask forward-looking questions (cash flow projections, pipeline forecasts) that the AI cannot answer accurately, with no disclosure of this limitation. |
| **Why it matters** | Incorrect executive summaries could drive poor business decisions. |
| **Business/operational impact** | Poor financial decision-making based on AI projections that exceed CRM data. |
| **Compliance/security risk** | None regulatory directly. |
| **Smallest safe fix** | Add a static disclaimer in the Executive advisor UI: "Responses are based on CRM data as of [last sync time]. Verify financial projections with your accounting system." |
| **Reduces duplication** | No |
| **Estimated effort** | 30 minutes |
| **Risk level** | Low |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | No |

---

### CATEGORY 14 — COMPLIANCE AND PAYMENTS SAFETY

---

**C14-01 — SSN/banking data PCI compliance not verified (duplicate of C8-02)**

| Field | Value |
|---|---|
| **Category** | Compliance and Payments Safety |
| **Severity** | Critical |
| **File/Component** | `shared/schema.ts` — `merchantApplications` table, `server/routes/merchants.ts` |
| **What is wrong** | Same as C8-02 — SSN and bank account number fields in `merchantApplications` are not verified to be encrypted at rest. This is classified separately here as a compliance issue, not just an onboarding UI issue. |
| **Why it matters** | PCI DSS Requirement 3 mandates protection of stored cardholder and sensitive authentication data. SSNs and bank account numbers are covered. |
| **Business/operational impact** | Data breach notification obligations in all 50 states. FTC enforcement. Merchant lawsuits. PCI DSS audit failure. |
| **Compliance/security risk** | PCI DSS Requirement 3 violation. FL Digital Privacy Law Act. Federal FTC Act Section 5 (unfair or deceptive practices). CRITICAL. |
| **Smallest safe fix** | See C8-02. Immediate audit required. AES-256 encryption before DB insert for SSN. Store last 4 of bank account only. |
| **Reduces duplication** | No |
| **Estimated effort** | 4–8 hours |
| **Risk level** | High |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | Yes |

---

**C14-02 — FL Mini-TCPA express written consent not enforced (duplicate classification of C6-02)**

| Field | Value |
|---|---|
| **Category** | Compliance and Payments Safety |
| **Severity** | High |
| **File/Component** | `server/services/sdr/compliance-engine.ts`, `shared/schema.ts` — `consentAuditLogs` |
| **What is wrong** | Same root issue as C6-02, classified here as a payments safety concern. Florida's Mini-TCPA requires PEWC before any automated call/text to FL numbers. The system treats all opt-ins equivalently. |
| **Why it matters** | Liberty Bancard's primary market is FL. Per-violation fines of $500–$1,500 with a large contact base creates existential financial risk. |
| **Business/operational impact** | In a worst-case scenario (1,000 FL contacts × 3 automated messages × $500/violation = $1.5M in fines). |
| **Compliance/security risk** | FL Mini-TCPA SB 1120 (effective July 1, 2021). Direct regulatory enforcement risk. |
| **Smallest safe fix** | See C6-02. Add `consentType` field. Block FL contacts without PEWC. |
| **Reduces duplication** | No |
| **Estimated effort** | 4–8 hours |
| **Risk level** | High |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | Yes |

---

**C14-03 — Public lead forms missing marketing consent disclosure**

| Field | Value |
|---|---|
| **Category** | Compliance and Payments Safety |
| **Severity** | High |
| **File/Component** | `client/src/pages/GetStarted.tsx`, `client/src/pages/UploadStatement.tsx`, `client/src/pages/FreeAnalysis.tsx`, `client/src/pages/Support.tsx`, `client/src/pages/Estimate.tsx` |
| **What is wrong** | All public lead capture forms lack explicit SMS/email consent disclosure at submission. Florida law and CAN-SPAM require clear disclosure that phone/email will be used for marketing communications at the point of data collection. No consent checkbox exists on any form. |
| **Why it matters** | Collecting contact info for marketing without disclosure invalidates consent obtained from those forms. |
| **Business/operational impact** | All leads collected without disclosure cannot be legally contacted via automated outreach. Retroactive DNC exposure for existing lead database. |
| **Compliance/security risk** | TCPA / CAN-SPAM / FL Mini-TCPA violation at point of collection. |
| **Smallest safe fix** | Add consent language below each submit button: "By submitting, you agree to receive SMS and email communications from Liberty Bancard. Reply STOP to opt out. Message & data rates may apply." Add unchecked SMS consent checkbox. |
| **Reduces duplication** | No |
| **Estimated effort** | 1–2 hours |
| **Risk level** | Low |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | Yes |

---

### CATEGORY 15 — SECURITY AND PERMISSIONS

---

**C15-01 — Sessions not invalidated when a user's role changes**

| Field | Value |
|---|---|
| **Category** | Security and Permissions |
| **Severity** | High |
| **File/Component** | `server/routes/admin.ts` — `/api/admin/users/:id/role`, `server/replit_integrations/auth/storage.ts` |
| **What is wrong** | When a user's role is changed, existing sessions for that user are not invalidated. A demoted user (admin → agent) or terminated employee retains full privileged access for up to 7 days (session TTL). |
| **Why it matters** | A terminated or demoted employee retains privileged access with no revocation mechanism. |
| **Business/operational impact** | Insider threat. Unauthorized data access or data exfiltration post-termination for up to 7 days. |
| **Compliance/security risk** | Insider threat. Violates principle of least privilege. SOC 2 / ISO 27001 control gap. |
| **Smallest safe fix** | Call `destroyUserSessions(userId)` (function exists in auth storage) immediately after a role change. The affected user is re-directed to login with their new role. |
| **Reduces duplication** | No |
| **Estimated effort** | 30 minutes |
| **Risk level** | Low |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | Yes |

---

**C15-02 — CSRF exemption list too broad without documentation**

| Field | Value |
|---|---|
| **Category** | Security and Permissions |
| **Severity** | Medium |
| **File/Component** | `server/middleware/csrf.ts` — `EXEMPT_PATHS_EXACT` — includes `/api/statements/upload` |
| **What is wrong** | `/api/statements/upload` is in the CSRF exemption list (it is public and unauthenticated — intentionally). However, no comments document WHY each path is exempt. Future developers may accidentally add authenticated state-changing endpoints by pattern-matching. |
| **Why it matters** | The exemption list is a maintenance risk that grows over time. |
| **Business/operational impact** | Future developers may inadvertently exempt authenticated endpoints, creating CSRF vulnerabilities. |
| **Compliance/security risk** | Medium — CSRF vulnerabilities on authenticated endpoints allow cross-site request forgery attacks. |
| **Smallest safe fix** | Add inline comment for each exempt path: reason for exemption, whether it is authenticated or public. |
| **Reduces duplication** | No |
| **Estimated effort** | 30 minutes |
| **Risk level** | Low |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | No |

---

**C15-03 — Admin password re-seeded from env var on every server boot**

| Field | Value |
|---|---|
| **Category** | Security and Permissions |
| **Severity** | Medium |
| **File/Component** | `server/replit_integrations/auth/replitAuth.ts` — `seedAdminUser` |
| **What is wrong** | The admin user is seeded from `ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD` env vars on every startup. If these vars are present in production, an env var leak immediately compromises the admin account with no audit trail (the password is updated silently). |
| **Why it matters** | Env var leaks (CI logs, Replit secrets exposure) directly compromise the highest-privileged account. |
| **Business/operational impact** | Complete admin account takeover from a single env var leak. |
| **Compliance/security risk** | Admin credential compromise. SOC 2 control gap. |
| **Smallest safe fix** | Add `ADMIN_SEED_ONCE` flag. If admin user already exists in DB with a password hash, skip the password update entirely. Log a warning if the update would have occurred but was skipped. |
| **Reduces duplication** | No |
| **Estimated effort** | 1–2 hours |
| **Risk level** | Low |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | Yes |

---

**C15-04 — OG image endpoint not rate-limited (CPU-intensive with sharp)**

| Field | Value |
|---|---|
| **Category** | Security and Permissions |
| **Severity** | Medium |
| **File/Component** | `server/routes/og.ts` — `/og/:template/:slug.png` |
| **What is wrong** | This endpoint uses `sharp` to rasterize SVGs into PNG — a CPU-intensive operation. It has a disk cache, but unique slug combinations bypass the cache. No rate limiting exists. An attacker can send thousands of unique slug requests to saturate CPU. |
| **Why it matters** | Denial of service via image generation is a known attack vector for Node.js servers. |
| **Business/operational impact** | CPU saturation degrades the entire application for all users during an attack. |
| **Compliance/security risk** | DDoS / availability risk. |
| **Smallest safe fix** | Add 60 req/min per IP rate limiter to the OG image route. Ensure cache TTL ≥ 24 hours. |
| **Reduces duplication** | No |
| **Estimated effort** | 15 minutes |
| **Risk level** | Low |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | No |

---

### CATEGORY 16 — UI/UX CLARITY

---

**C16-01 — SDR Dashboard tab labels are abbreviated and unclear**

| Field | Value |
|---|---|
| **Category** | UI/UX Clarity |
| **Severity** | Medium |
| **File/Component** | `client/src/pages/dashboard/SdrDashboard.tsx` |
| **What is wrong** | SDR Dashboard tabs use abbreviated/cryptic labels: "Identity" (actually Inbox Health), "Market" (actually Market Expansion). Without mousing over, agents cannot determine what each tab shows. |
| **Why it matters** | Agents use the wrong tab, miss health alerts, or avoid the dashboard entirely. |
| **Business/operational impact** | Missed inbox health alerts lead to undetected bounce spikes and sending domain blacklisting. |
| **Compliance/security risk** | None. |
| **Smallest safe fix** | Rename tab trigger labels: "Identity" → "Inbox Health", "Market" → "Market Expansion." |
| **Reduces duplication** | No |
| **Estimated effort** | 10 minutes |
| **Risk level** | Low |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | No |

---

**C16-02 — "Co. Intelligence" tab abbreviation unclear to new agents**

| Field | Value |
|---|---|
| **Category** | UI/UX Clarity |
| **Severity** | Low |
| **File/Component** | `client/src/pages/dashboard/ContactDetail.tsx` |
| **What is wrong** | The "Co. Intelligence" tab (Company Intelligence) is visible only for parent accounts. The abbreviation is unclear to new agents, who may not click it or understand what it contains. |
| **Why it matters** | Agents miss company intelligence data on parent accounts, reducing sales effectiveness. |
| **Business/operational impact** | Underutilized feature; missed competitive intelligence for multi-location merchants. |
| **Compliance/security risk** | None. |
| **Smallest safe fix** | Expand to "Company Intel" and add a tooltip showing "Company Intelligence" on hover. |
| **Reduces duplication** | No |
| **Estimated effort** | 10 minutes |
| **Risk level** | Low |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | No |

---

**C16-03 — Content creation tools ungrouped in sidebar**

| Field | Value |
|---|---|
| **Category** | UI/UX Clarity |
| **Severity** | Low |
| **File/Component** | `client/src/pages/dashboard/DashboardLayout.tsx` — sidebar |
| **What is wrong** | "Blaze.ai Marketing", "Content Engine", and "LinkedIn Composer" appear as three separate unrelated sidebar items. New agents see three separate "marketing AI" tools and do not know which to use for a given task. |
| **Why it matters** | Three ungrouped tools suggest confusion about feature ownership and purpose. |
| **Business/operational impact** | Underutilization of content generation features. Agents default to one and ignore the others. |
| **Compliance/security risk** | None. |
| **Smallest safe fix** | Group under a collapsible "Content Creation" sidebar section. |
| **Reduces duplication** | Partially |
| **Estimated effort** | 30 minutes |
| **Risk level** | Low |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | No |

---

### CATEGORY 17 — PUBLIC WEBSITE AND LEAD CAPTURE

---

**C17-01 — Public lead forms missing consent disclosure (covered by C14-03)**

| Field | Value |
|---|---|
| **Category** | Public Website and Lead Capture |
| **Severity** | High |
| **File/Component** | `client/src/pages/GetStarted.tsx`, `client/src/pages/UploadStatement.tsx`, `client/src/pages/FreeAnalysis.tsx`, `client/src/pages/Support.tsx` |
| **What is wrong** | Same issue as C14-03, classified here as a public website concern. All public lead capture forms lack explicit marketing consent language at the point of data collection. |
| **Why it matters** | This is a public-facing compliance gap that invalidates every lead collected without proper disclosure. |
| **Business/operational impact** | All leads collected without disclosure cannot be legally contacted via automated outreach. |
| **Compliance/security risk** | TCPA / CAN-SPAM / FL Mini-TCPA. |
| **Smallest safe fix** | See C14-03. Consent text + unchecked SMS checkbox on each form. |
| **Reduces duplication** | No |
| **Estimated effort** | 1–2 hours |
| **Risk level** | Low |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | Yes |

---

**C17-02 — Dead booking CTA link on highest-intent pages**

| Field | Value |
|---|---|
| **Category** | Public Website and Lead Capture |
| **Severity** | High |
| **File/Component** | `client/src/pages/GetStarted.tsx`, `client/src/pages/UploadStatement.tsx` |
| **What is wrong** | The "Book a 10-Minute Call" CTA links to a placeholder URL that is dead. Every click from a warm lead on the highest-intent pages results in a broken experience. |
| **Why it matters** | The booking CTA is on the highest-intent pages. A broken link loses the best inbound leads. |
| **Business/operational impact** | Direct revenue impact — every warm lead who clicks books nothing. Lost pipeline value from inbound traffic. |
| **Compliance/security risk** | None. |
| **Smallest safe fix** | Set `VITE_BOOKING_URL` env var to a real GHL/Calendly scheduling link. Replace all placeholder booking URLs with this env var. Add a build-time warning if the var is empty. |
| **Reduces duplication** | No |
| **Estimated effort** | 30 minutes |
| **Risk level** | Low |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | Yes |

---

**C17-03 — SSR marketing pages not rate-limited at origin**

| Field | Value |
|---|---|
| **Category** | Public Website and Lead Capture |
| **Severity** | Low |
| **File/Component** | `server/routes/ssr-routes.ts` |
| **What is wrong** | SSR marketing pages (`/industries/:slug`, `/blog/:slug`, etc.) are not rate-limited at the origin. They rely on `Cache-Control` headers for CDN offloading, but direct cache-bypass hits can overload the origin. |
| **Why it matters** | A flood of unique slug requests bypasses CDN cache and hits the Node.js server directly. |
| **Business/operational impact** | Origin overload degrades the entire application during a crawl storm or targeted attack. |
| **Compliance/security risk** | DDoS / availability risk. Low. |
| **Smallest safe fix** | Add 200 req/min per IP rate limit to all SSR marketing routes. Legitimate CDN traffic uses distributed IPs and is unaffected. |
| **Reduces duplication** | No |
| **Estimated effort** | 30 minutes |
| **Risk level** | Low |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | No |

---

### CATEGORY 18 — DATA VALIDATION AND QUALITY GATES

---

**C18-01 — Phone number validation limited to non-empty check**

| Field | Value |
|---|---|
| **Category** | Data Validation and Quality Gates |
| **Severity** | Medium |
| **File/Component** | `server/routes/contacts.ts`, `server/routes/public.ts` |
| **What is wrong** | Phone number validation on inbound lead forms accepts any non-empty string. Invalid formats (e.g., "1234", "000-000-0000", foreign numbers) are stored in the DB. These fail when the compliance engine determines timezone for quiet hours and when GHL sync attempts to upsert. |
| **Why it matters** | Invalid phone numbers cause quiet-hours misclassification and failed GHL sync. |
| **Business/operational impact** | TCPA quiet hours violations for misclassified timezones. GHL sync errors for invalid phone formats. |
| **Compliance/security risk** | TCPA quiet hours compliance gap for misclassified numbers. |
| **Smallest safe fix** | Add E.164-format normalization and US phone validity check using `libphonenumber-js`. Return 400 for invalid numbers with a clear message. |
| **Reduces duplication** | No |
| **Estimated effort** | 2–4 hours |
| **Risk level** | Low |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | No |

---

**C18-02 — CSV import creates duplicate contacts with no dedup check**

| Field | Value |
|---|---|
| **Category** | Data Validation and Quality Gates |
| **Severity** | Medium |
| **File/Component** | `server/routes/imports.ts` |
| **What is wrong** | The universal CSV import does not validate for duplicate emails or phone numbers against existing contacts before importing. Bulk imports create thousands of duplicate contacts that must be manually merged. |
| **Why it matters** | Duplicate contacts cause duplicate outreach (TCPA risk) and inflate pipeline metrics. |
| **Business/operational impact** | Pipeline metrics inflated by duplicates. Duplicate outreach exposure. Manual cleanup cost. |
| **Compliance/security risk** | Duplicate outreach is a TCPA risk (multiple contacts of same person). |
| **Smallest safe fix** | Add a pre-import duplicate detection report showing counts of email/phone matches. Allow user to choose skip/merge/overwrite before confirming import. |
| **Reduces duplication** | Yes — prevents duplicate contact records |
| **Estimated effort** | 4–8 hours |
| **Risk level** | Low |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | No |

---

### CATEGORY 19 — RELIABILITY AND ROBUSTNESS

---

**C19-01 — GHL sync 500-contact limit causes silent data divergence at scale (see C1-04)**

| Field | Value |
|---|---|
| **Category** | Reliability and Robustness |
| **Severity** | High |
| **File/Component** | `server/services/ghl-sync.ts` — all in-memory contact filter occurrences |
| **What is wrong** | Same root issue as C1-04. Classified separately here as a reliability concern because the failure mode is silent — no error is thrown, no alert fires, data simply diverges past 500 contacts. |
| **Why it matters** | Reliability failures that are silent are the most dangerous — they are invisible until a merchant complains or an audit reveals data gaps. |
| **Business/operational impact** | CRM data diverges from GHL at scale. Deals won locally don't advance in GHL. Sequences don't enroll. |
| **Compliance/security risk** | None directly. |
| **Smallest safe fix** | Indexed DB queries — same fix as C1-04. Use existing `getContactByGhlContactId` and `getContactByEmail` storage methods. |
| **Reduces duplication** | Yes |
| **Estimated effort** | 2–4 hours (same as C1-04) |
| **Risk level** | Medium |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | Yes |

---

**C19-02 — Corrupt PDF upload leaves deal stuck with no rep notification**

| Field | Value |
|---|---|
| **Category** | Reliability and Robustness |
| **Severity** | Medium |
| **File/Component** | `server/services/proposal-engine.ts` — `extractStatementText`, `server/services/statement-upload-chain.ts` |
| **What is wrong** | If `pdf-parse` throws on a corrupted PDF, the entire statement upload chain crashes for that contact and leaves the deal in a partially advanced state: stage moved to "Statement Received" but analysis never runs. No rep notification. No error recovery. |
| **Why it matters** | A corrupt upload leaves the deal visually stuck with no way to know what happened or how to recover. |
| **Business/operational impact** | Rep follows up on a "Statement Received" deal with no analysis to reference. Manual triage required. |
| **Compliance/security risk** | None. |
| **Smallest safe fix** | Wrap `extractStatementText` in try/catch. On failure, set `analysisStatus = "extraction_error"` on the deal and create a rep notification with the error reason. |
| **Reduces duplication** | No |
| **Estimated effort** | 1–2 hours |
| **Risk level** | Low |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | No |

---

### CATEGORY 20 — PERFORMANCE AND SCALE

---

**C20-01 — 500-contact in-memory scan is O(n) load on every 45-second sync tick**

| Field | Value |
|---|---|
| **Category** | Performance and Scale |
| **Severity** | Medium |
| **File/Component** | `server/services/ghl-sync.ts` — bulk contact fetch pattern |
| **What is wrong** | Same root as C1-04/C19-01. At 500 contacts, scans are ~2ms. At 5,000 contacts after prospecting, the GHL sync tick must fetch and scan 5,000+ rows every 45 seconds — adding significant DB load at every tick. |
| **Why it matters** | Performance degrades non-linearly as the contact list grows with no schema or query change needed. |
| **Business/operational impact** | DB load increases quadratically with contact count. Response times for all CRM queries degrade during sync ticks. |
| **Compliance/security risk** | None. |
| **Smallest safe fix** | Indexed DB lookups (same fix as C1-04). The existing `contacts_ghl_contact_id_idx` and `contacts_email_archived_at_idx` indexes make these O(1). |
| **Reduces duplication** | Yes |
| **Estimated effort** | 2–4 hours (same fix as C1-04) |
| **Risk level** | Medium |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | Yes |

---

**C20-02 — OG image endpoint vulnerable to CPU saturation via unique slug flood**

| Field | Value |
|---|---|
| **Category** | Performance and Scale |
| **Severity** | Low |
| **File/Component** | `server/routes/og.ts` |
| **What is wrong** | Sharp-based PNG rasterization is CPU-bound. Without rate limiting, a flood of unique slug requests bypasses the disk cache and saturates Node.js. (See also C15-04.) |
| **Why it matters** | CPU saturation from OG requests degrades the entire application for real users. |
| **Business/operational impact** | Application-wide slowdown or outage during an attack or crawler storm. |
| **Compliance/security risk** | DDoS / availability risk. |
| **Smallest safe fix** | Rate limit + verify cache TTL ≥ 24h to minimize re-renders. (Same fix as C15-04.) |
| **Reduces duplication** | No |
| **Estimated effort** | 15 minutes |
| **Risk level** | Low |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | No |

---

### CATEGORY 21 — CODE CLARITY AND MAINTAINABILITY

---

**C21-01 — Two GHL clients create compounding maintenance burden (see C2-01)**

| Field | Value |
|---|---|
| **Category** | Code Clarity and Maintainability |
| **Severity** | Low |
| **File/Component** | `server/services/ghl.ts`, `server/services/sdr/ghl-client.ts` |
| **What is wrong** | Same root as C2-01. Future GHL API feature additions require changes in two places. Rate limiting exists in only one. Token management diverges over time. |
| **Why it matters** | Technical debt compounds with every GHL feature addition. |
| **Business/operational impact** | Slower feature development. Higher bug rate from missed dual-update. |
| **Compliance/security risk** | None. |
| **Smallest safe fix** | Extract shared HTTP layer into `ghl-base-client.ts`. (Same fix as C2-01.) |
| **Reduces duplication** | Yes |
| **Estimated effort** | 4–8 hours |
| **Risk level** | Medium |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | No |

---

**C21-02 — Route registration order undocumented in server/routes.ts**

| Field | Value |
|---|---|
| **Category** | Code Clarity and Maintainability |
| **Severity** | Low |
| **File/Component** | `server/routes.ts` — 50+ sequential route module registrations |
| **What is wrong** | `server/routes.ts` registers 50+ route modules sequentially with no comments explaining order-sensitive constraints (e.g., OG routes before SSR routes, permissions audit before API 404 catch-all). New developers cannot safely add a new route without risking silent breakage. |
| **Why it matters** | Route registration order bugs are silent and hard to detect without full integration testing. |
| **Business/operational impact** | Developer time wasted debugging route order issues. Risk of broken routes reaching production undetected. |
| **Compliance/security risk** | None. |
| **Smallest safe fix** | Add section comments documenting order-sensitive registrations and explaining why. |
| **Reduces duplication** | No |
| **Estimated effort** | 30 minutes |
| **Risk level** | Low |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | No |

---

**C21-03 — OpenAI model names hardcoded as strings in multiple service files**

| Field | Value |
|---|---|
| **Category** | Code Clarity and Maintainability |
| **Severity** | Low |
| **File/Component** | `server/services/sdr/reply-intelligence.ts`, other service files referencing OpenAI models |
| **What is wrong** | OpenAI model names are hardcoded as string literals in multiple service files, including at least one invalid name (`gpt-5-mini`). No single source of truth exists for model names. |
| **Why it matters** | Model upgrades require finding and updating every hardcoded string. Invalid model names cause silent runtime failures. |
| **Business/operational impact** | AI call failures that are only discovered when a feature stops working, not at deployment time. |
| **Compliance/security risk** | None. |
| **Smallest safe fix** | Create `server/config/ai-models.ts` with exported constants. All services import from there. |
| **Reduces duplication** | Yes |
| **Estimated effort** | 2 hours |
| **Risk level** | Low |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | No |

---

### CATEGORY 22 — REPLIT DEPLOYMENT READINESS

---

**C22-01 — Auto-migration at startup lacks concurrent-instance safety**

| Field | Value |
|---|---|
| **Category** | Replit Deployment Readiness |
| **Severity** | Medium |
| **File/Component** | `server/db-migrate.ts` |
| **What is wrong** | Migrations run automatically at startup before the HTTP server binds. If two instances start simultaneously (e.g., Replit autoscale or restart racing), both may attempt to run migrations concurrently, causing schema conflicts or double-migration errors. No advisory lock or migration table lock prevents this. |
| **Why it matters** | Concurrent migrations can corrupt schema state — a rare but catastrophic failure. |
| **Business/operational impact** | Schema corruption requires manual DB recovery. Application-wide outage during the repair window. |
| **Compliance/security risk** | None directly; but a migration failure during peak hours causes an outage that affects merchant operations. |
| **Smallest safe fix** | Add a PostgreSQL advisory lock around migration execution: `SELECT pg_try_advisory_lock(12345)` before running, release after. If lock not acquired, wait 500ms and retry. |
| **Reduces duplication** | No |
| **Estimated effort** | 2–4 hours |
| **Risk level** | Medium |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | No (acceptable for single-instance deployment) |

---

**C22-02 — No structured startup env var validation surfaced in UI**

| Field | Value |
|---|---|
| **Category** | Replit Deployment Readiness |
| **Severity** | Medium |
| **File/Component** | `server/index.ts`, `client/src/pages/dashboard/ActivationPanel.tsx` |
| **What is wrong** | 30+ env vars are required for full production operation. The existing `docs/launch-env-checklist.md` documents them but there is no runtime validation that surfaces missing vars in a structured, categorized way. Critical subsystems degrade silently. |
| **Why it matters** | A deployment with missing vars runs in degraded mode with no clear operator indication of which services are affected. |
| **Business/operational impact** | Operators believe the system is fully configured when critical services are disabled. Support issues traced to missing env vars that could have been caught at boot. |
| **Compliance/security risk** | None directly. |
| **Smallest safe fix** | Create `server/config/env-validation.ts` that categorizes vars as `critical` / `important` / `optional` at startup. Log a structured table. Surface missing critical vars in Activation Panel as red indicators. |
| **Reduces duplication** | No |
| **Estimated effort** | 2–4 hours |
| **Risk level** | Low |
| **Fixable without rewrite** | Yes |
| **Must fix before go-live** | Yes |

---

## PART II — SUMMARY SECTIONS

---

### SECTION A — EXECUTIVE SUMMARY

The Liberty Bancard AI Business Operating System is a highly ambitious and largely well-architected platform. The core CRM (contacts, deals, pipeline, tickets, tasks) is production-ready. The GHL 2-way sync engine, BullMQ queue system, AI advisor suite, partner/affiliate programs, and merchant portal are all substantively implemented and go well beyond what most ISOs operate on.

However, **12 go-live blockers** require resolution before the system can safely operate with live merchants and outbound communication. These are documented in detail in Section B.

**Summary of findings by severity:**
- Critical: 4 issues (C1-01, C5-01, C8-02/C14-01, C14-02)
- High: 14 issues
- Medium: 12 issues
- Low: 14 issues
- Total: 44 issues across 22 categories

**Overall readiness rating:**
- CRM/pipeline manual operations: **85% ready**
- Merchant onboarding and applications: **55% ready** (pending SSN encryption audit and e-signature config)
- GHL integration: **70% ready** (pending webhook hardening and 500-contact fix)
- SDR autonomous outbound: **30% ready** (pending compliance gate, FL TCPA gate, model name fix)
- Security posture: **65% ready** (pending session invalidation, admin seeding, webhook hardening)

**Total estimated effort for all 12 go-live blockers:** approximately 30–60 hours of development work.

---

### SECTION B — GO-LIVE BLOCKERS

The following 12 issues constitute true go-live blockers — operating without them creates immediate legal, compliance, data integrity, or security exposure with live merchants and outbound communications.

| # | Issue ID | Issue | Effort | Risk |
|---|---|---|---|---|
| 1 | C8-02 / C14-01 | SSN/banking data encryption not verified (PCI DSS) | 4–8h | High |
| 2 | C14-02 / C6-02 | FL Mini-TCPA express written consent not enforced | 4–8h | High |
| 3 | C1-02 | E-signature flow missing `GHL_MERCHANT_AGREEMENT_TEMPLATE_ID` | 1h | High |
| 4 | C5-01 / C1-03 | SDR orchestrator has no compliance pre-check gate | 2–4h | Medium |
| 5 | C11-01 | GHL webhook verification skipped without `GHL_WEBHOOK_SECRET` | 30m | Medium |
| 6 | C1-04 / C19-01 / C20-01 | GHL sync hard-capped at 500 contacts (silent data divergence) | 2–4h | Medium |
| 7 | C14-03 / C17-01 | Public forms missing marketing consent disclosure | 1–2h | Low |
| 8 | C15-01 | Sessions not invalidated when user role changes | 30m | Low |
| 9 | C5-03 | Intent classifier references invalid model name `gpt-5-mini` | 30m | Low |
| 10 | C15-03 | Admin password re-seeded from env var on every boot | 1–2h | Low |
| 11 | C17-02 | Dead booking CTA link on highest-intent public pages | 30m | Low |
| 12 | C5-02 | SDR pause/resume uses inline role check instead of middleware | 15m | Low |

**Additional P1 items** (strong operational and security reasons to fix before scaling beyond first week):

| # | Issue ID | Issue | Effort |
|---|---|---|---|
| 13 | C1-01 | Boarding simulation mode active — no badge | 1–2h |
| 14 | C1-05 / C22-02 | No structured startup env var validation | 2–4h |
| 15 | C3-01 | Pipeline stage names not validated at startup | 1h |
| 16 | C8-01 | Simulation MIDs indistinguishable in UI | 1h |
| 17 | C9-01 | Merchant role sees full CRM sidebar (all 403) | 2–4h |
| 18 | C11-02 | Inbound GHL webhook health not shown in sync status | 2–4h |
| 19 | C12-01 | No Redis-missing warning banner in Activation Panel | 30m |
| 20 | C7-01 | Scanned PDFs produce empty AI analysis with no warning | 1–2h |

---

### SECTION C — CRITICAL ISSUES

Issues rated Critical requiring immediate escalation:

| ID | Category | Issue |
|---|---|---|
| C8-02 / C14-01 | Compliance / Merchant Application | SSN and banking data storage encryption not verified — PCI DSS Requirement 3 |
| C5-01 | SDR Orchestrator | No compliance pre-check gate — one env var change starts mass outbound |
| C14-02 | Compliance / Payments Safety | FL Mini-TCPA express written consent not enforced |
| C1-01 | Go-Live Readiness | Processor boarding in simulation mode — merchants receive fake MIDs |

---

### SECTION D — DUPLICATE TABS / FEATURES / WORKFLOWS FOUND

| Location | Duplicate | Nature |
|---|---|---|
| `server/services/` | `ghl.ts` + `sdr/ghl-client.ts` | Two GHL HTTP clients with overlapping fetch/auth/retry logic |
| Dashboard sidebar | "Training" in Merchant section + Administration section | Same label, different destinations |
| Contact Detail page | "History" tab + "Activity" tab | Both show contact history; labels ambiguous |
| Sidebar | Automation + Workflows + Sequences | Three tabs with overlapping scope, no subtitles |
| `ghl-sync.ts` | `getContacts({ limit: 500 }).find()` pattern | Used 10+ times; should be single indexed DB query |
| Compliance findings | C6-02 and C14-02 | Same root issue classified in two categories |
| Reliability findings | C1-04 and C19-01 and C20-01 | Same root issue: 500-contact limit, classified in 3 categories |

---

### SECTION E — TABS TO MERGE

| Candidate | Action |
|---|---|
| "Blaze.ai Marketing" + "Content Engine" + "LinkedIn Composer" | Group under a collapsible "Content Creation" sidebar section |

---

### SECTION F — TABS TO RENAME

| Current Label | Proposed Label | Location |
|---|---|---|
| "Identity" | "Inbox Health" | SDR Dashboard tabs |
| "Market" | "Market Expansion" | SDR Dashboard tabs |
| "History" | "Audit Log" | Contact Detail page tabs |
| "Co. Intelligence" | "Company Intel" (with tooltip) | Contact Detail page (parent accounts) |
| "Training" (Merchant section) | "Merchant Training" | Sidebar |
| "Training" (Administration section) | "System Training Hub" | Sidebar |

---

### SECTION G — TABS TO HIDE / REMOVE

| Tab / Route | Recommendation | Reason |
|---|---|---|
| All SDR sidebar items for non-admin/non-manager | Hide unless `user.role` is admin or manager | Agents should not see SDR controls they cannot configure |
| Boarding Tracker (when sim mode active) | Display prominent "Simulation Mode" banner | Prevents staff from treating sim MIDs as real |

---

### SECTION H — CRM SIMPLIFICATION

1. Add one-sentence scope descriptions to Automation, Workflows, and Sequences pages.
2. Rename "History" → "Audit Log" in Contact Detail.
3. Group content creation sidebar tools under a collapsible "Content Creation" section.
4. Filter merchant role users to a simplified sidebar showing only: My Portal, Support, Documents, Notifications.
5. Rename both "Training" sidebar entries to distinct labels.
6. Add a "Simulation Mode" badge to Boarding Tracker and Merchant Portal when `PROCESSOR_API_KEY` is missing.

---

### SECTION I — LEAD DISCOVERY HARDENING CHECKLIST

- [ ] Set `NIGHTLY_DISCOVERY_ENABLED=true` AND `LEGACY_OUTREACH_ENABLED=true` together (document interdependency — C4-01)
- [ ] Verify Serper.dev, Outscraper, Apify API keys in System Readiness page (C4-02)
- [ ] Add API key presence indicators for all three discovery providers
- [ ] Review daily discovery batch size limits to avoid API rate cap exhaustion
- [ ] Confirm discovery results flow into SDR lead queue, not directly to outbound
- [ ] Test full discovery → enrichment → scoring → queue pipeline end-to-end in staging
- [ ] Load DNC/blocklist before first live discovery run

---

### SECTION J — SDR HARDENING CHECKLIST

- [ ] Fix `gpt-5-mini` → correct model name in `reply-intelligence.ts` (C5-03)
- [ ] Add `requireRole("admin")` middleware to pause-all/resume-all routes (C5-02)
- [ ] Build compliance pre-check gate — `sdr_compliance_cleared` system setting (C5-01, C1-03)
- [ ] Upload DNC list before setting `ORCHESTRATOR_ENABLED=true`
- [ ] Verify quiet hours timezone logic works correctly for FL (Eastern) contacts
- [ ] Add FL express written consent gate (C6-02, C14-02)
- [ ] Set conservative day-1 limits: Email 50/day, SMS 25/day, Call 10/day
- [ ] Enable `ORCHESTRATOR_REVIEW_MODE=true` for first week (human approval required)
- [ ] Confirm all GHL workflow IDs populated in the Workflow ID Manager for each vertical
- [ ] Test full enrollment → send → reply → classification → action loop in staging

---

### SECTION K — REPLY INTELLIGENCE CHECKLIST

- [ ] Fix model name in `reply-intelligence.ts` (C5-03)
- [ ] Add AI call success/failure/fallback counter to Operator Dashboard (C6-01)
- [ ] Add FL state check before any classified action leads to an automated send (C6-02)
- [ ] Test opt-out keyword detection via rule-based path independently
- [ ] Confirm `onOptOut` fires correctly for `stop` and `angry` intents
- [ ] Test meeting-intent classification triggers booking link delivery
- [ ] Configure per-advisor confidence thresholds for Compliance and Finance (C13-01)

---

### SECTION L — STATEMENT / PROPOSAL CHECKLIST

- [ ] Add minimum text length check before AI analysis on extracted PDF text (C7-01)
- [ ] Add error recovery for corrupt PDF uploads (C19-02)
- [ ] Add proposal field editor (`repBriefing`, `recommendedProgram`) to Deal detail view (C7-02)
- [ ] Test co-branded proposal delivery with partner org branding applied
- [ ] Verify proposal tracking pixel fires on first view
- [ ] Confirm `GHL_WORKFLOW_PROPOSAL_FOLLOWUP` is set for automated follow-up
- [ ] Test full chain: upload → extraction → analysis → blueprint → proposal → delivery → GHL enrollment

---

### SECTION M — MERCHANT ONBOARDING CHECKLIST

- [ ] Set `GHL_MERCHANT_AGREEMENT_TEMPLATE_ID` for e-signature (C1-02)
- [ ] Set real processor API credentials (C1-01, C8-01)
- [ ] Add "Simulation Mode" badge to Boarding Tracker when `PROCESSOR_API_KEY` is missing (C8-01)
- [ ] Audit SSN/banking fields for plain text — encrypt if needed (C8-02, C14-01)
- [ ] Test full application → e-sign → underwriting → approval → MID assignment flow
- [ ] Verify `GHL_WORKFLOW_MERCHANT_APPROVED` fires merchant portal welcome email
- [ ] Confirm onboarding checklist items auto-populate on pipeline move
- [ ] Test SMTP fallback for merchant welcome email when GHL contact ID is missing

---

### SECTION N — MERCHANT PORTAL CHECKLIST

- [ ] Filter CRM sidebar for merchant role users (C9-01)
- [ ] Test Rate Review request submission → GHL workflow enrollment
- [ ] Test NPS survey delivery when merchant MID is assigned
- [ ] Verify Referral Portal generates unique referral links per merchant
- [ ] Test document upload from merchant portal persists to Document Vault
- [ ] Confirm "Admin MID Editor" only visible to admin/manager roles
- [ ] Verify merchant cannot access other merchants' data via API

---

### SECTION O — PARTNER / AFFILIATE CHECKLIST

- [ ] Fix fragmented partner session management (C10-02)
- [ ] Add response normalization to partner org slug endpoint (C10-01)
- [ ] Test full partner application → approval → invite email → portal login flow
- [ ] Verify affiliate referral code cookie attribution survives across sessions
- [ ] Test residual reconciliation CSV upload → match → variance alert pipeline
- [ ] Confirm commission tier progression notifications fire correctly
- [ ] Test partner org white-label branding on all public-facing pages

---

### SECTION P — GHL SYNC CHECKLIST

- [ ] Set `GHL_WEBHOOK_SECRET` in all environments (C11-01)
- [ ] Harden webhook verification for non-localhost non-production environments (C11-01)
- [ ] Add inbound webhook health indicator to GHL sync status panel (C11-02)
- [ ] Replace 500-contact in-memory scans with indexed DB queries (C1-04)
- [ ] Add phone-only contact sync support to `fullSyncToGhl` (C11-03)
- [ ] Validate canonical pipeline stage names match GHL stage IDs at startup (C3-01)
- [ ] Set `GHL_PIPELINE_ID` to the correct Liberty Bancard pipeline ID
- [ ] Test 2-way sync conflict detection and resolution workflow
- [ ] Confirm GHL task sync roundtrip: create in CRM → appears in GHL and vice versa
- [ ] Verify GHL Workflow ID Manager has all 25+ workflow IDs populated

---

### SECTION Q — QUEUE / AUTOMATION SAFETY CHECKLIST

- [ ] Set `REDIS_URL` for production (C12-01)
- [ ] Add Redis-missing warning banner to Activation Panel (C12-01)
- [ ] Reduce `WORKER_FAILURE_ALERT_THRESHOLD` to 3 for `ghl-sync` queue (C12-02)
- [ ] Test BullMQ dead-letter job retry from Operator Dashboard
- [ ] Verify graceful shutdown drains workers on SIGTERM
- [ ] Set `ORCHESTRATOR_ENABLED=false` in production until compliance gate is built (C5-01)
- [ ] Configure discovery + legacy outreach flags together when enabling discovery (C4-01)
- [ ] Test sequence worker handles GHL workflow enrollment failures gracefully
- [ ] Verify SLA worker fires ticket escalation notifications correctly

---

### SECTION R — AI GOVERNANCE CHECKLIST

- [ ] Centralize OpenAI model names in `server/config/ai-models.ts` (C21-03)
- [ ] Fix `gpt-5-mini` placeholder in `reply-intelligence.ts` (C5-03)
- [ ] Add per-advisor confidence thresholds for Compliance and Finance roles (C13-01)
- [ ] Add Executive AI advisor data disclaimer (C13-02)
- [ ] Test AI audit log captures all 7 advisor calls
- [ ] Verify review queue routes low-confidence outputs correctly
- [ ] Test review queue item approval/rejection workflow
- [ ] Confirm AI cost dashboard shows accurate token consumption

---

### SECTION S — COMPLIANCE / PAYMENTS SAFETY CHECKLIST

- [ ] Audit SSN storage — encrypt if plain text (C14-01)
- [ ] Add `consentType` field to consent audit log (C14-02)
- [ ] Gate FL-state contacts on express written consent before automated outreach (C14-02)
- [ ] Add consent disclosure to all public lead forms (C14-03)
- [ ] Build compliance pre-check gate in orchestrator (C5-01)
- [ ] Verify CAN-SPAM compliance on all email templates (unsubscribe link, physical address)
- [ ] Review CSRF exemption list — add inline documentation (C15-02)
- [ ] Verify PCI DSS Requirement 3 compliance for all stored financial data

---

### SECTION T — SECURITY HARDENING CHECKLIST

- [ ] Invalidate sessions on role change (C15-01) — 30 minute fix
- [ ] Add `ADMIN_SEED_ONCE` flag to prevent password re-seeding (C15-03)
- [ ] Add rate limit to OG image generation endpoint (C15-04)
- [ ] Require `GHL_WEBHOOK_SECRET` in all non-localhost environments (C11-01)
- [ ] Add rate limit to SSR marketing routes at origin (C17-03)
- [ ] Normalize partner org slug endpoint to prevent enumeration (C10-01)
- [ ] Normalize `internal-webhook-auth.ts` to require secret in staging/prod
- [ ] Add inline comments to all CSRF exempt paths (C15-02)
- [ ] Verify `httpOnly`, `secure`, and `sameSite` session cookie attributes are production-correct
- [ ] Test that 2FA trusted device cookie expires correctly after 30 days

---

### SECTION U — UI/UX POLISH LIST

- [ ] Rename SDR tab "Identity" → "Inbox Health" (C16-01)
- [ ] Rename SDR tab "Market" → "Market Expansion" (C16-01)
- [ ] Rename Contact Detail "History" → "Audit Log" (C3-02)
- [ ] Rename sidebar duplicate "Training" entries (C2-03)
- [ ] Group content creation sidebar tools under "Content Creation" section (C16-03)
- [ ] Add one-sentence descriptions to Automation, Workflows, Sequences pages (C2-02)
- [ ] Add "Co. Intelligence" hover tooltip with full label (C16-02)
- [ ] Add "Simulation Mode" badge on Boarding Tracker when `PROCESSOR_API_KEY` missing (C8-01)
- [ ] Add loading skeletons to all async dashboard cards missing them
- [ ] Add empty-state messaging to SDR dashboard tabs when no data exists

---

### SECTION V — MOBILE PWA FIXES

| Issue | Priority |
|---|---|
| Verify bottom tab navigation works on iOS Safari with tab bar viewport offset | Medium |
| Test service worker offline caching of contact list | Medium |
| Verify push notification enrollment survives app reinstall | Low |
| Test offline task creation syncs correctly when connectivity returns | Low |

---

### SECTION W — PUBLIC WEBSITE FIXES

| Issue | Priority |
|---|---|
| Add consent language and unchecked SMS checkbox to all public lead forms (C14-03) | Critical |
| Fix dead booking CTA links with `VITE_BOOKING_URL` env var (C17-02) | High |
| Add rate limiting to SSR routes at origin (C17-03) | Low |
| Verify GA4 and Facebook Pixel fire on all thank-you pages | Medium |
| Test UTM parameter capture persists through multi-step form flows | Medium |
| Confirm Open Graph images render correctly for all `/industries/:slug` pages | Low |

---

### SECTION X — REPLIT DEPLOYMENT CHECKLIST

- [ ] Set all required env vars in Replit Secrets before first production deployment
- [ ] Set `REDIS_URL` pointing to a persistent Redis instance (not in-memory fallback)
- [ ] Set `NODE_ENV=production` — enables strict webhook verification
- [ ] Run `npx tsx scripts/migrate.ts` standalone before first deployment
- [ ] Verify `db-migrate.ts` auto-migration completes before HTTP server binds
- [ ] Consider PostgreSQL advisory lock for migration safety on multi-instance deployments (C22-01)
- [ ] Create structured env var validation at startup (C22-02)
- [ ] Verify production start command is correct for deployed builds (not `npm run dev`)
- [ ] Test graceful SIGTERM handling — BullMQ workers should drain before exit
- [ ] Confirm Replit PostgreSQL connection pool size is appropriate for concurrent load

---

### SECTION Y — QUICK WINS (UNDER 1 HOUR EACH)

| Fix | Time | Impact |
|---|---|---|
| Set `GHL_WEBHOOK_SECRET` in all env configs | 5 min | Critical security |
| Fix `gpt-5-mini` → correct model name | 15 min | Compliance (opt-out detection) |
| Add `requireRole("admin")` to SDR pause/resume routes | 15 min | Security |
| Add consent language to all public lead capture forms | 30 min | TCPA compliance |
| Fix dead booking CTA link with `VITE_BOOKING_URL` | 15 min | Revenue |
| Add "Simulation Mode" badge to Boarding Tracker | 30 min | Operational clarity |
| Rename SDR tab labels (Identity → Inbox Health, Market → Market Expansion) | 10 min | UX |
| Rename Contact Detail "History" → "Audit Log" | 10 min | UX |
| Rename both "Training" sidebar entries | 10 min | UX |
| Invalidate sessions on role change (one function call added) | 30 min | Security |
| Add Redis-missing warning banner to Activation Panel | 30 min | Reliability |
| Rate limit OG image generation endpoint | 15 min | Security / Performance |
| Add pipeline stage mismatch startup validation | 30 min | Data integrity |

---

### SECTION Z — IMPROVEMENTS UNDER 1 DAY EACH

| Fix | Time | Impact |
|---|---|---|
| Replace 500-contact in-memory GHL sync scans with indexed DB queries (C1-04) | 4h | Reliability at scale |
| Add inbound webhook health indicator to GHL status panel (C11-02) | 4h | Observability |
| Audit SSN field storage — add encryption if plain text (C14-01) | 4–8h | PCI compliance |
| Add FL express written consent gate in compliance engine (C14-02) | 4–8h | TCPA compliance |
| Create structured env var validation at startup (C22-02) | 4h | Operational clarity |
| Build SDR compliance pre-check gate system setting (C5-01) | 4h | TCPA compliance |
| Add merchant role sidebar filter in DashboardLayout (C9-01) | 2–4h | UX for merchants |
| Add `ADMIN_SEED_ONCE` flag to auth seeding (C15-03) | 2h | Security |
| Add scanned-PDF detection gate in statement chain (C7-01) | 2h | Data quality |
| Add AI classify success/failure counter to Operator Dashboard (C6-01) | 4h | Observability |
| Centralize OpenAI model names in `server/config/ai-models.ts` (C21-03) | 2h | Maintainability |
| Add pre-import duplicate detection to CSV import (C18-02) | 4–8h | Data quality / TCPA |

---

### SECTION AA — SAFE IMPLEMENTATION ORDER

**Week 1 — Security and Compliance (must-do before ANY merchant touches the system)**
1. Set `GHL_WEBHOOK_SECRET`, `NODE_ENV=production` in env
2. Fix `gpt-5-mini` model name in `reply-intelligence.ts`
3. Add `requireRole("admin")` to SDR pause/resume routes
4. Invalidate sessions on role change
5. Add consent language to all public lead forms
6. Fix dead booking CTA link
7. Add `ADMIN_SEED_ONCE` flag to auth seeding
8. Audit SSN storage — encrypt if plain text

**Week 2 — Data Integrity and Scale**
1. Replace 500-contact in-memory GHL sync with indexed DB queries
2. Add pipeline stage validation at startup
3. Add scanned PDF detection gate in statement chain
4. Add Redis-missing warning to Activation Panel
5. Add inbound webhook health indicator
6. Add structured env var validation at startup

**Week 3 — Compliance Gates and SDR Safety**
1. Build compliance pre-check gate for orchestrator
2. Add FL express written consent gate
3. Set real processor API credentials (exit simulation mode)
4. Set `GHL_MERCHANT_AGREEMENT_TEMPLATE_ID`
5. Add boarding simulation mode badge in UI

**Week 4 — UX, Observability, and Remaining Hardening**
1. Rename all confusing tab and sidebar labels
2. Filter merchant sidebar
3. Add AI classify success/failure metrics to Operator Dashboard
4. Add per-advisor confidence thresholds
5. Group content creation sidebar tools
6. Rate limit OG image and SSR routes

---

### SECTION BB — ITEMS TOO RISKY TO CHANGE WITHOUT OPERATOR APPROVAL

| Item | Risk | Reason |
|---|---|---|
| Merging the two GHL API clients into one | Medium | Risk of regression in 50+ integration touch points across core sync and SDR |
| Standardizing partner session management (removing `req.session.partnerOrgUserId`) | High | Risk of partner login breakage across all white-label portals — needs exhaustive staging test |
| Changing GHL contact upsert payload format | High | Any format change could cause 422 errors at scale in the 45s sync loop |
| Modifying migration auto-run at startup | High | Risk of schema state mismatch if migration behavior changes between deployments |
| Changing BullMQ queue names | High | Existing queued jobs become orphaned in renamed queues |
| Modifying the pipeline stage canonical list | High | Cascades to GHL stage IDs, automation rules, stage transition logic, and SLA configs |
| Adding mandatory SSN encryption without a backfill migration plan | High | Existing plain-text SSN values would fail decryption; requires a one-time backfill migration with rollback plan |
| Changing the GHL webhook endpoint path | High | GHL webhook subscriptions are registered externally; changing the path breaks inbound sync until re-registered in GHL |

---

*End of docs/audit-go-live.md*
