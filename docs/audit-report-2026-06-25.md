# Liberty Bancard — Master Audit Report
**Date:** June 25, 2026  
**Audit Basis:** Master Replit Audit + Conversion Lifecycle Build Plan (2135-line document)  
**Auditor:** AI Agent (full codebase read + explorer subagents)  
**Mode:** Read-only audit → phased build plan

---

## 1. Executive Verdict

**READY AFTER TARGETED FIXES**

- The backend is structurally sound: GHL 2-way sync, BullMQ job queues, role-guard middleware, SDR orchestrator, compliance engine, and programmatic SEO are all functional.
- Five kill lines from the audit specification are currently tripped and must be resolved before scaling paid or outbound acquisition.
- The contactability gate exists (`checkBeforeSend` in `compliance-engine.ts`) but is siloed to the SDR path, skips `doNotAutoContact`, and is bypassed by GHL-native workflow triggers.
- Every inbound form that captures a phone number needs a PEWC (Prior Express Written Consent) capture path before leads can be unlocked for SMS/voice automation.
- Attribution is partially broken: appointment bookings and phone CTA clicks are not tracked to source/campaign.
- The platform can safely run cold email + manual call outreach today. SMS, AI voice, and ringless voicemail must remain off until Waves 1–2 are merged.

---

## 2. Kill Lines — Current Status

| # | Kill Line | Status | Evidence |
|---|-----------|--------|----------|
| KL-1 | `doNotAutoContact` not checked before automated sends | **TRIPPED** | `compliance-engine.ts` checks `sdr_merchants.doNotContactFlag` but ignores `contacts.doNotAutoContact` (field exists, not read) |
| KL-2 | No canonical `evaluateContactability()` gate | **TRIPPED** | SDR path has `checkBeforeSend()`; sequence worker uses a separate bounce/status check; no shared function |
| KL-3 | GHL workflows can bypass Replit channel permission state | **TRIPPED** | GHL-native triggers (tag applied, form filled in GHL) can start SMS/voice sequences without calling Replit's gate |
| KL-4 | PEWC checkbox exists but does not store structured disclosure evidence | **TRIPPED** | `disclosureVersion`, `disclosureText`, `formId`, `consentedPhone` are stuffed into JSONB `details` — not queryable top-level columns |
| KL-5 | High-intent form captures phone with no PEWC unlock path | **TRIPPED** | `/upload-statement` has only a required `consentSms` checkbox — no optional PEWC full-automation consent; every statement-upload lead is permanently `warm_no_pewc` |
| KL-6 | No `phoneType` field — ringless VM guard has no mobile signal | **TRIPPED** | `contacts` table has no `phoneType` column; cannot distinguish mobile from landline for ringless voicemail compliance |
| KL-7 | Statement upload succeeds without CRM/deal creation | **SAFE** | `/api/public/statement-upload` creates contact + deal in DB ✓ |
| KL-8 | Appointment booking not attributed to source/campaign | **TRIPPED** | GHL calendar links are plain URLs — UTM params from sessionStorage are not appended before navigation |
| KL-9 | Closed Won deal does not trigger onboarding | **PARTIAL** | Closed Won creates onboarding pipeline deal and fires `GHL_WORKFLOW_MERCHANT_APPROVED`, but does NOT auto-create the 5 SLA onboarding tasks in the `tasks` table |
| KL-10 | Sensitive document routes lack role protection | **SAFE** | Document vault routes use `isDashboardUser` middleware; document access log is written on every download ✓ |
| KL-11 | Queue failures invisible to operators | **SAFE** | Operator Dashboard has Job Queue tab with dead-letter visibility ✓ |
| KL-12 | Programmatic SEO pages are thin or duplicated | **PARTIAL** | Location×industry pages use a template with city-specific content injection, but there is no minimum-content guard — zero-data city pages could be generated with only template copy |

---

## 3. Schema Audit — contacts Table

### Present ✓
`doNotContact`, `doNotAutoContact`, `emailStatus`, `smsStatus`, `consentSms`, `consentEmail`, `smsOptInAt`, `emailOptInAt`, `dncReason`, `utmSource/Medium/Campaign/Content/Term`, `landingPage`, `primaryOfferPath`, `leadScore`, `vertical`, `state`, `city`

### Missing ✗ — Required for full contactability compliance

| Field | Type | Why Needed | Wave |
|-------|------|-----------|------|
| `phoneType` | text (mobile\|landline\|voip\|unknown) | Ringless voicemail is only legal to mobile numbers; without this field the VM guard has no signal | Wave 1 |
| `consentTier` | text (cold_no_consent\|warm_no_pewc\|pewc_full_automation\|opted_out\|do_not_contact) | Single authoritative field driving channel eligibility; currently derived ad-hoc per worker | Wave 1 |
| `lifecycleStage` | text (12-value enum) | Lifecycle Command Center, stuck-lead alerts, offer routing, sequence eligibility | Wave 1 |
| `timezone` | text (IANA tz, e.g. America/New_York) | Quiet hours enforcement requires merchant local time, not server time | Wave 1 |

### consentAuditLogs Table

#### Present ✓
`contactId`, `userId`, `channel`, `action`, `consented`, `consentType`, `source` (maps to sourceUrl), `ipAddress`, `userAgent`, `details` (JSONB)

#### Missing as Dedicated Columns ✗

| Field | Current State | Why Dedicated Column Needed |
|-------|--------------|----------------------------|
| `disclosureVersion` | Stuffed in `details` JSONB | Must be queryable to reproduce exact consent evidence in legal/regulatory context |
| `disclosureText` | Stuffed in `details` JSONB | Same |
| `formId` | Stuffed in `details` JSONB | Same |
| `consentedPhone` | Relies on contactId join | Number may change — must capture the exact phone number consented at the moment of consent |

---

## 4. Compliance Channel Safety Matrix (Current State)

| Channel | Cold Scraped | Inbound No-PEWC | PEWC Captured | Status |
|---------|-------------|-----------------|---------------|--------|
| Email (manual) | ✅ Allowed | ✅ Allowed | ✅ Allowed | Safe |
| Manual Call Task | ✅ Allowed | ✅ Allowed | ✅ Allowed | Safe |
| Automated SMS | ❌ Blocked (flag off) | ❌ Blocked (flag off) | ⚠️ Blocked (flag off, but gate not enforcing PEWC check correctly) | Flag off = safe today |
| AI Voice Call | ❌ Blocked (flag off) | ❌ Blocked (flag off) | ❌ Blocked (flag off) | Safe |
| Ringless Voicemail | ❌ Blocked (flag off) | ❌ Blocked (flag off) | ❌ Blocked (flag off) | Safe — but `phoneType` gap must be fixed before ever enabling |
| Nightly Discovery | ✅ Active | N/A | N/A | Safe |
| GHL Native Workflows | ⚠️ **Not gated by Replit** | ⚠️ **Not gated** | ⚠️ **Not gated** | **Exposure** |

**Bottom line:** Feature flags prevent unsafe automation today. The risk is that enabling any flag before Wave 1 is merged could allow GHL-triggered sends that bypass Replit's gate, and `doNotAutoContact` would still not be enforced.

---

## 5. Conversion System Audit

### Current Lifecycle (As Implemented)

```
Scraped prospect
  → enriched by SDR (Serper/Outscraper/Apify/Apollo)
  → scored (leadScore, revPotentialScore)
  → enrolled in cold email + manual call sequence (if SDR_ENABLED)
  → OR inbound form fill (upload-statement / free-analysis / get-started)
    → contact + deal created
    → GHL synced
    → sequence enrollment (manual)
  → rep picks up from CRM pipeline
  → Proposal → Closed Won → onboarding deal created → portal welcome email
```

### Intended High-Converting Lifecycle

```
Scraped/inbound prospect
  → evaluateContactability() called at every touch point
  → offer route auto-assigned at creation (processor detection → offer)
  → enrolled in correct sequence family by consentTier
  → cold: email + manual call task only
  → warm inbound: email + manual call + optional PEWC checkbox shown
  → PEWC captured: SMS/booking follow-up unlocked (when flags enabled)
  → phone CTA click → tracked → rep called → appointment booked → deal stage updated
  → statement upload → savings estimate email → proposal → close
  → Closed Won → 5 SLA onboarding tasks → portal → MID → first batch → referral ask
```

### Gap Analysis

| Step | Current | Ideal | Gap |
|------|---------|-------|-----|
| Lead creation | Offer route not set at creation time for inbound | Processor detection sets offer route within seconds | Wave 5 |
| Consent capture | consentSms checkbox only | PEWC optional checkbox + structured evidence storage | Wave 2 |
| Sequence selection | Manual or ad-hoc | Auto-enrolled by consentTier + offerRoute | Wave 6 |
| Phone CTA | Untracked link | `phone_cta_click` GA4 event + tap-to-call | Wave 3 + 8 |
| Booking CTA | Untracked plain URL | UTM-appended link + `booking_cta_click` event | Wave 8 |
| Appointment → stage | Manual | `booking-confirmed` callback auto-updates deal stage | Wave 8 |
| Onboarding | Manual | 5 SLA tasks auto-created on Closed Won | Wave 10 |
| Referral | Manual | "Refer a Business" in merchant portal → sequence | Wave 11 |

---

## 6. Conversion Funnel Diagnosis

### Leak Points by Stage

**SEO Visit → Landing Page**
- Issue: `/free-smart-terminal` page does not exist — one of the highest-intent offer routes has no dedicated landing page
- Affected: All paid and organic traffic for terminal eligibility offers
- Impact: High — this is a top offer route for restaurants, retail, healthcare
- Fix: Create dedicated page (Wave 3)
- Priority: P1

**Landing Page → CTA Click**
- Issue: `phone_cta_click` event not fired on any call button; `booking_cta_click` not fired on GHL calendar links
- Affected: `Navbar.tsx`, `Footer.tsx`, `StickyMobileCTA.tsx`, all landing pages
- Impact: Cannot optimize page CTA placement; cannot calculate phone conversion rate
- Fix: Add click event tracking to all call and booking CTAs (Wave 8)
- Priority: P1

**Statement Upload → PEWC**
- Issue: `/upload-statement` form has no PEWC checkbox; 100% of statement upload leads are locked at `warm_no_pewc`
- Affected: All statement upload conversions
- Impact: Every high-intent lead is permanently ineligible for SMS/voice follow-up even when feature flags are enabled
- Fix: Add optional PEWC checkbox with structured evidence storage (Wave 2)
- Priority: P0

**Form Submit → Attribution**
- Issue: UTM params captured in sessionStorage but not appended to GHL calendar booking links; appointment bookings lose source attribution
- Affected: All appointment bookings from paid/email campaigns
- Impact: Cannot calculate cost per appointment by campaign
- Fix: Append UTM params to booking URL at click time; create `/api/public/booking-confirmed` callback (Wave 8)
- Priority: P1

**Merchant Application → Prefill**
- Issue: `/merchant-application` does not accept `?contactId=&dealId=` params; agents cannot share a prefill link; duplicate EIN/email not checked
- Affected: All merchant applications
- Impact: Higher drop-off (re-entering known data); potential duplicate applications
- Fix: Prefill from contact/deal + duplicate guard (Wave 10)
- Priority: P2

**Closed Won → Onboarding SLA**
- Issue: Closed Won creates onboarding deal and sends welcome email, but does NOT create the 5 structured onboarding SLA tasks in the `tasks` table
- Affected: All Closed Won merchants
- Impact: Onboarding steps are untracked; reps must create tasks manually
- Fix: Auto-create 5 SLA tasks on Closed Won (Wave 10)
- Priority: P2

---

## 7. SEO Audit Findings

### What Works ✓
- Sitemap index at `/sitemap-index.xml` pointing to 4 sub-sitemaps (locations, blog, compare, glossary)
- `SEO` component with canonical, OG tags, Twitter card, and schema helpers (LocalBusiness, FAQPage, BreadcrumbList, Product)
- SSR rendering for all public pages (added in Task #49)
- All compare pages (`/compare/:competitor`) exist
- All industry pages (`/industries/:slug`) exist
- All location×industry pages (`/locations/:city/:industry`) dynamically generated

### What Needs Work ✗

| Issue | Affected Routes | Priority |
|-------|----------------|----------|
| `/free-smart-terminal` page missing entirely | New route needed | P1 |
| FAQPage schema not passed to `/faq` | `/faq` | P1 |
| BreadcrumbList schema not passed on nested pages | `/compare/*`, `/industries/*`, `/locations/*`, `/blog/*` | P2 |
| Location×industry pages have no minimum content threshold — zero-data city×industry could be indexed | All `/locations/*` | P2 |
| Internal linking: compare pages don't link to industry pages; industry pages don't link to location pages | System-wide | P2 |
| `/free-smart-terminal` missing from all sitemaps | Sitemap index | P1 (after Wave 3 creates the page) |
| Image alt text not verified across all landing pages | All public pages | P3 |

### Programmatic SEO Quality Check
- Location×industry pages include: city H1, industry pain point, localized stats, offer CTAs — template content is solid
- **Risk**: A city×industry combination with zero local business data generates a page with only template text and no unique content signal — must add a content threshold guard to avoid thin-page penalties

---

## 8. Website UX/UI Findings

### Desktop
- ✅ Professional visual design, financial-services credible
- ✅ Comparison tables on `/beat-square-stripe` and `/compare/*`
- ✅ Rate calculator on homepage
- ⚠️ Phone CTA not visible in hero on desktop without scrolling
- ⚠️ Booking CTA uses "Book a Call" — should be "Book My 15-Minute Review"
- ⚠️ Primary CTA label inconsistency: "Get My Free Analysis", "Get Started", "Upload Statement", "Check My Savings" used interchangeably — landing page H1 should control which CTA appears

### Mobile
- ✅ `StickyMobileCTA.tsx` exists with "Call", "Book", "Upload" buttons
- ✅ Tap-to-call links exist in the sticky bar
- ⚠️ Mobile CTA bar not shown on all high-intent pages (conditional rendering needs audit)
- ⚠️ Statement upload file picker may not show file name clearly on mobile Safari

### Forms
- ✅ UTM params captured and sent with all API payloads
- ✅ Statement upload has file format support and file size display
- ⚠️ No `form_abandoned` tracking — drop-off at any step is invisible
- ⚠️ No PEWC checkbox on `/upload-statement` (highest-intent form)
- ⚠️ No disclosure versioning system

### Trust Proof
- ✅ Footer has compliance disclaimers
- ✅ `AdvertisingDisclosure.tsx` exists and is linked
- ⚠️ No trust badge strip (BBB, PCI, ISO) visible above fold on homepage

### Copy Audit
- ✅ Pain-point copy present: "Are you overpaying for payment processing?", "Upload your statement for a free savings review"
- ⚠️ "Get Started" used as primary CTA in several places — too generic; replace with offer-specific language
- ⚠️ `/0-percent-processing` should use "Liberty Zero™ fee-offset program" consistently and never lead with "free processing" without the compliance qualifier

---

## 9. Backend / Automation Findings

### Sequence Worker Pre-Send Order (Current)
1. Bounce guard: checks `contact.emailStatus` (bounced/invalid)
2. Global toggle: `GHL_WORKFLOW_ONLY_MODE`, `ORCHESTRATOR_ENABLED`
3. `checkBeforeSend()` (compliance engine): DNC, compliance state, cooling period, channel specifics, rate limits
4. **Missing**: `contacts.doNotAutoContact` check (field exists, not read)
5. **Missing**: shared `evaluateContactability()` — logic duplicated across workers

### SDR Orchestrator
- ✅ Checks `doNotContactFlag` on `sdr_merchants`
- ✅ Checks `contact.doNotContact` and `contact.doNotAutoContact` in one place (`orchestrator.ts:567-568`)
- ⚠️ This check is only in the orchestrator path — the regular sequence worker does NOT call it

### GHL Sync Engine
- ✅ 45-second auto-loop running
- ✅ Contact upsert uses correct `customFields` array format
- ✅ Duplicate 400 response auto-recovery implemented
- ⚠️ GHL circuit breaker was previously OPEN (5 consecutive failures in deals phase) — may recur
- ⚠️ Channel permissions (`lb_channel_permissions`, `lb_consent_tier`) not yet synced to GHL

### Queue Health
- ✅ 7 BullMQ queues with retry + dead-letter behavior
- ✅ Graceful shutdown on SIGTERM
- ✅ ioredis-mock fallback for dev
- ⚠️ No `compliance-audit-log` queue — audit log writes are synchronous and could slow request handlers under load

### Worker Idempotency
- ✅ GHL sync has idempotency via `ghlContactId` linkage
- ⚠️ Sequence worker step execution does not have a per-step idempotency key — if a worker crashes mid-step, the step could be re-executed

---

## 10. Analytics Findings

### What's Tracked ✓
- `generate_lead` GA4 event on most form completions
- `form_submission` general event
- `quiz_start`, `quiz_step`, `quiz_complete` for `/free-analysis` and `/get-started`
- `statement_upload` GA4 event on upload success
- `merchant_application` GA4 event on submission
- `fbq('track', 'Lead')` on conversions
- `fbq('track', 'CompleteRegistration')` on quiz/application completion
- `fbq('track', 'Schedule')` on calendar booking CTA clicks
- UTM params captured in `sessionStorage` via `utm.ts`, appended to API payloads

### What's Missing ✗

| Missing Event | Impact | Wave |
|--------------|--------|------|
| `phone_cta_click` | Cannot calculate phone conversion rate by page/campaign | Wave 8 |
| `booking_cta_click` | Cannot calculate booking conversion rate | Wave 8 |
| `statement_upload_started` | Cannot see drop-off between click and submit | Wave 8 |
| `statement_upload_failed` | Cannot diagnose upload failure causes | Wave 8 |
| `form_abandoned` | Cannot see where users drop out of multi-step forms | Wave 8 |
| `pewc_checked` / `pewc_unchecked` | Cannot track PEWC capture rate by form | Wave 2 |
| `thank_you_page_view` | Cannot verify thank-you page reach rate | Wave 2 |
| `savings_calculator_completed` | Cannot see calculator engagement to CTA conversion | Wave 8 |
| Server: `contactability_evaluated` | Cannot audit how many sends are blocked vs allowed | Wave 1 |
| Server: `channel_blocked` | Cannot report on compliance block reasons | Wave 1 |
| Server: `offer_route_assigned` | Cannot track offer routing quality | Wave 5 |
| Server: `deal_stage_changed` | Cannot build funnel report from audit logs | Wave 8 |
| Booking attribution | GHL calendar booking loses UTM source | Wave 8 |

### Recommended Event Taxonomy (Partial)
Every event should include: `event_name`, `timestamp`, `contact_id` (if known), `deal_id` (if known), `source`, `medium`, `campaign`, `landing_page`, `offer_route`, `vertical`, `consent_tier`, `lifecycle_stage`, `device`.

---

## 11. AI Agent Findings

### Current Agents ✓
1. **Lead Enrichment Agent** — outputs vertical, volume estimate, processor likelihood, risk tier, offer route
2. **Offer Router** — embedded in enrichment; outputs `primaryOfferPath`
3. **Reply Intent Agent** — classifies inbound replies (meeting_request, stop, info_request, etc.)
4. **Statement Analysis Agent** — reads uploaded PDF, outputs effective rate, savings estimate, proposal draft
5. **Sales Advisor** — chat-based, helps reps with objections and call prep
6. **Compliance Advisor** — flags unsafe channel use, missing consent, risky copy
7. **AI SDR Orchestrator** — drives automated outreach sequence enrollment

### Agent Gaps ✗

| Missing Agent | Purpose |
|--------------|---------|
| **Appointment Setter Agent** | Replies to inbound interest with booking link, qualifies merchant, asks for statement — currently handled by reply intent + manual rep action |
| **Offer Router as Standalone API** | Offer routing should be callable at creation time without full enrichment queue latency |

### Agent Risk Behaviors to Monitor
- The Appointment Setter (once built) must not send SMS without PEWC and must not make unsupported savings promises
- Compliance Advisor prompt must explicitly flag "free processing" language without qualifier
- Reply Intent Agent: `angry_compliance_risk` and `legal_request` classifications must immediately halt automation and create a rep task

---

## 12. GHL / Replit Ownership Diagnosis

### Replit Owns (Source of Truth)
- All compliance fields: `doNotContact`, `doNotAutoContact`, `consentTier`, `lifecycleStage`
- Consent audit log (PEWC evidence)
- Channel permissions (derived from contactability gate)
- All CRM data: contacts, deals, tasks, documents

### GHL Owns (Execution Layer)
- Message delivery (email, SMS, voice)
- Calendar / booking
- Conversation inbox
- Native workflow automation

### Sync Rules (Current)
- ✅ GHL contact upsert uses `customFields` array format
- ✅ 45-second sync loop
- ⚠️ GHL does NOT receive `lb_consent_tier`, `lb_channel_permissions`, `lb_lifecycle_stage`, `lb_do_not_autocontact`
- ⚠️ GHL-native workflow triggers are not gated by Replit's permission state
- ⚠️ No `POST /api/ghl/permission-check` webhook endpoint for GHL to query before sending

---

## 13. Master Build Wave Roadmap

### Wave 1 — Lifecycle Source of Truth + Contactability Engine
**Task #571** | P0 | No dependencies | ~5 days  
Add 4 schema fields to contacts + 4 top-level columns to consentAuditLogs. Build `server/services/contactability.ts` with canonical `evaluateContactability()`. Wire sequence worker and SDR compliance engine to use it. Fix `doNotAutoContact` gap.

**Done looks like:** Every automated send calls one shared gate. `doNotAutoContact` is enforced. `consentTier` and `lifecycleStage` fields exist.

### Wave 2 — Consent Capture + Form Conversion Upgrade
**Task #572** | P0 | Depends on #571 | ~4 days  
Add optional PEWC checkbox to all 5 public forms. Build disclosure versioning config. Store structured PEWC evidence using the new dedicated columns. Upgrade all thank-you pages.

**Done looks like:** Forms are higher-converting. Every PEWC opt-in stores `disclosureVersion`, `disclosureText`, `formId`, `consentedPhone` as top-level DB columns.

### Wave 3 — High-Converting Landing Page Rebuild
**Task #573** | P1 | No dependencies (parallel with Wave 1) | ~5 days  
Create `/free-smart-terminal` page. Upgrade homepage, `/beat-square-stripe`, `/0-percent-processing`, `/upload-statement`, compare pages, industry pages, location pages with specific CTA labels, phone CTAs, booking CTAs, and trust proof.

**Done looks like:** Every high-intent page has specific CTA labels, visible phone CTA on mobile, and analytics-ready buttons.

### Wave 4 — SEO + Programmatic Page Quality Upgrade
**Task #574** | P1 | Depends on #573 | ~3 days  
Wire FAQPage schema to `/faq`. Add BreadcrumbList to all nested pages. Add thin-page guard to location×industry generator. Add internal linking between compare, industry, and location pages.

**Done looks like:** SEO audit workflow passes with zero critical failures.

### Wave 5 — Offer Router + AI Lead Qualification
**Task #575** | P1 | Depends on #571 | ~3 days  
Processor detection at creation time. Offer Router agent as standalone API. Contact detail "Offer Intelligence" card. GHL custom fields for offer route.

**Done looks like:** Every lead has `primaryOfferPath`, `offerConfidence`, `recommendedNextAction` within seconds of creation.

### Wave 6 — Compliant SDR Sequence Architecture
**Task #576** | P1 | Depends on #571 #575 | ~5 days  
10 sequence families by consentTier. Enrollment consent gate. 4 missing families (no-show recovery, application abandon, merchant referral, partner referral). Sequence worker integration with `evaluateContactability()`.

**Done looks like:** 10/10 sequence families exist. Cold leads cannot be enrolled in PEWC sequences. No step sends without calling the gate.

### Wave 7 — GHL/Replit Sync Authority Hardening
**Task #577** | P1 | Depends on #571 #572 | ~3 days  
Add `lb_consent_tier`, `lb_channel_permissions`, `lb_do_not_autocontact`, `lb_lifecycle_stage` to GHL custom field sync. Create `POST /api/ghl/permission-check` webhook. Harden opt-out webhook. Build GHL Sync Dashboard.

**Done looks like:** GHL has Replit's permission state. GHL workflows can query Replit before sending. Opt-outs write structured consent logs.

### Wave 8 — Analytics + Attribution System
**Task #578** | P1 | Depends on #572 #573 | ~4 days  
Add all missing frontend events. UTM-append GHL booking links. Create booking attribution callback. Server-side event taxonomy in audit_logs. Conversion dashboard.

**Done looks like:** Visitor → Lead → Appointment → Statement → Proposal → Closed Won funnel is measurable by source and campaign.

### Wave 9 — Operator Command Center
**Task #579** | P2 | Depends on #571 #577 #578 | ~3 days  
Lifecycle Command Center tab. Channel Safety Dashboard extension. SDR Dashboard tab. Conversion Dashboard tab. GHL Sync tab. Launch Readiness Checklist.

**Done looks like:** Admin can see what is converting, what is blocked, what is unsafe, and what needs human action from one dashboard.

### Wave 10 — Merchant Application + Onboarding Conversion
**Task #580** | P2 | Depends on #572 | ~4 days  
Application prefill from contact/deal. Duplicate EIN+email guard. Partial application autosave + abandon recovery. Closed Won auto-creates 5 SLA onboarding tasks. Merchant portal onboarding tracker. Document vault KYC integration.

**Done looks like:** Closed Won merchants move smoothly into onboarding. Reps see SLA task deadlines. Partial applications trigger recovery sequences.

### Wave 11 — Partner + Referral Growth Loop
**Task #581** | P2 | Depends on #580 | ~4 days  
Referral link attribution. Partner portal KPI upgrade. Merchant referral flow in merchant portal. Residual reconciliation partner breakdown. Co-branded proposal attribution. Partner page SEO upgrades.

**Done looks like:** Liberty has a measurable partner/referral flywheel. Commission visibility is in the partner portal.

### Wave 12 — Release QA + Go-Live Safety
**Task #582** | P2 | Depends on all above | ~3 days  
Contactability unit tests. Sequence enrollment compliance tests. Form integration tests. Static compliance grep. Playwright mobile screenshots. Feature flag matrix UI. Go/no-go checklist document.

**Done looks like:** The system passes 20-item go/no-go checklist. Every kill line is verified safe before any feature flag is enabled.

---

## 14. Recommended Launch Sequence

```
Week 1:  Start #571 (Wave 1) + #573 (Wave 3) in parallel
Week 2:  After #571 merges → start #572, #575, #577 in parallel
Week 3:  After #572 + #573 merge → start #578 (analytics)
         After #575 merges → start #576 (sequences)
Week 4:  After #571 + #577 + #578 merge → start #579 (operator)
         After #572 merges → start #580 (merchant app)
Week 5:  After #573 merges → start #574 (SEO)
         After #580 merges → start #581 (partner/referral)
Week 6:  After all above merge → run #582 (QA + go-live)
```

---

## 15. Final Go/No-Go Criteria (Before Enabling Any Automation Flag)

Before setting `SMS_ENABLED=true`, `VOICE_AI_ENABLED=true`, or `RINGLESS_VM_ENABLED=true`:

- [ ] `evaluateContactability()` is the single gate called by all send paths
- [ ] `doNotAutoContact` is enforced in the gate
- [ ] `consentTier` field exists and is populated on all contacts
- [ ] PEWC evidence is stored with `disclosureVersion`, `disclosureText`, `formId`, `consentedPhone` as top-level columns
- [ ] `phoneType` field exists (for ringless VM)
- [ ] All public forms have PEWC checkbox
- [ ] GHL opt-out webhook writes structured consent audit log
- [ ] `lb_channel_permissions` is synced to GHL for all contacts
- [ ] `POST /api/ghl/permission-check` endpoint is live
- [ ] 10 sequence families seeded with correct `consentTierRequired`
- [ ] Enrollment guard rejects incompatible consent tier
- [ ] Cold email + manual call sequences tested and running
- [ ] Role guard smoke tests all passing (currently 40/40)
- [ ] SEO audit workflow passes with zero critical failures
- [ ] Analytics conversion funnel shows statement uploads, appointments, and applications attributed to source
- [ ] No dead-letter BullMQ jobs from contactability or consent workers
- [ ] Feature flag matrix displays prerequisites for each flag
- [ ] Florida leads isolated and verified at `warm_no_pewc` or higher
- [ ] QA: statement upload → contact created → GHL synced → offer route assigned verified
- [ ] QA: Closed Won → onboarding deal → SLA tasks → portal welcome email verified

---

*This report was generated from a full read-only codebase audit on June 25, 2026. All findings reference live code in the current main branch.*
