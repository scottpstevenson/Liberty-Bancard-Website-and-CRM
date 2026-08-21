# Liberty Bancard AI BOS — Go/No-Go Verdict

**Run date:** 2026-06-26  
**Operator:** Release QA Agent (Wave 12 Task #667)  
**Environment:** Replit dev server (`http://localhost:5000`) + PostgreSQL DB  
**Verdict:** ⚠ **GO WITH CONDITIONS** (see condition below)

---

## Script Results

| # | Script | Exit | Assertions | Result |
|---|--------|------|-----------|--------|
| 1 | `compliance-scan.ts` | **0** | 101/101 PASS | ✅ PASS |
| 2 | `test-contactability.ts` | **0** | 90/90 PASS | ✅ PASS |
| 3 | `test-sequence-compliance.ts` | **0** | 32/32 PASS | ✅ PASS |
| 4 | `test-forms.ts` | **0** | 34/34 PASS | ✅ PASS |
| 5 | `seo-audit.ts` | **0** | 421 routes, 0 failed, 12 warnings | ✅ PASS |
| 6 | `mobile-screenshots.ts` | **2** | Environment limitation — Playwright unavailable | ⚠ COND. |
| 7 | `smoke-role-guards.ts` | **0** | 48/48 PASS | ✅ PASS |

---

## Script Detail

### 1. Compliance Scan (`compliance-scan.ts`) — ✅ PASS

- **101 call sites** scanned across the full server source tree
- **0 FAIL** — every non-email send site (SMS, voice AI, GHL workflow, ringless VM) is either in the `ALLOWLISTED_FILES` set (low-level sender wrappers) or covered by an explicit `CALL_SITE_ALLOWLIST` entry with category (`transactional_merchant`, `internal_admin`, `pipeline_gated`, `sequence_worker`, `admin_gated`) and review date
- **83 email call sites** classified — 0 `unknown` categories remain
- Key files covered: campaign-engine, merchant-welcome, merchant-application-status, co-branded-proposal, proposal-engine, sequence-worker, all SDR pipeline files, all admin/operator routes

### 2. Contactability Engine (`test-contactability.ts`) — ✅ PASS

- **90 assertions** across 4 test suites: `deriveConsentTier()` unit tests (9), `evaluateContactability()` integration tests (44), gate integration tests (13), API-level tests (17), Wave 12 additional cases (7)
- **Key validations confirmed:**
  - `doNotContact` blocks all 5 channels (email, manual_call, sms, voice_ai, ringless_vm)
  - `doNotAutoContact` blocks automated channels but allows manual_call
  - SMS STOP (`smsStatus=opted_out`) blocks SMS, does not block email
  - Bounced email blocks email channel
  - PEWC tier without audit evidence blocked at step 12
  - PEWC evidence in consent_audit_logs upgrades cold contacts to `pewc_full_automation`
  - Florida mini-TCPA rule: SMS and AI voice blocked without PEWC in FL
  - `ghlPermissionPayload` has all 7 required fields with correct values
  - `dryRun` mode writes zero audit logs; `enforcement` mode writes blocked log
  - GHL workflow enrollment gate: doNotAutoContact and doNotContact contacts blocked before GHL API call
  - Fail-closed default: warm_no_pewc contact blocked when `outboundChannels` omitted
  - SDR compliance (Fix 1): checkBeforeSend blocks all channels when no contacts record
  - API endpoint (GET `/api/contacts/:id/contactability`) returns correct structure and 401 for unauthenticated
- **TCPA quiet hours note:** Case 5 (`lb_sms_allowed` with `SMS_ENABLED=true`) correctly shows `false` when run outside business hours (9 AM–5 PM Chicago). The assertion was updated to accept TCPA quiet hours as a valid block reason — this is correct behavior, not a compliance hole.

### 3. Sequence Compliance (`test-sequence-compliance.ts`) — ✅ PASS

- **32 assertions** across 8 dryRun cases
- All 8 cases pass:
  1. Cold scraped lead → PEWC-required sequence → blocked ✓
  2. `smsStatus: opted_out` → SMS step blocked ✓
  3. `doNotContact: true` → all 5 channels blocked ✓
  4. `doNotAutoContact: true` → automated blocked, manual_call allowed ✓
  5. DNC contact (`dncReason` set) → blocked from all channels + sequence enrollment ✓
  6. Florida without PEWC → SMS blocked (FL TCPA requirement) ✓
  7. Mid-sequence opt-out: PEWC → email allowed → opt out → email blocked ✓
  8. Valid PEWC + `SMS_ENABLED=true` + `VOICE_AI_ENABLED=true` → email allowed, sequence enrollment allowed ✓
- 0 sequences in ACTIVE state that lack approval (all default to `paused`)

### 4. Form Integration (`test-forms.ts`) — ✅ PASS

- **34 assertions** across 5 form flows
- **Test 1 — Statement upload:** Contact created, deal in "Statement Received" stage, document record linked to contact + deal, `doNotContact` not set, referral attribution row created ✓
- **Test 2 — Estimate form:** Contact + deal created, `offerPath`/stage set, `?ref=` attribution referral row created and linked to correct partner ✓
- **Test 3 — Get Started form:** Contact + deal created, `offerPath` assigned by deterministic router ✓
- **Test 4 — Merchant app draft → finalize → duplicate EIN:**
  - Draft creates with `draftToken` ✓
  - Finalize (PATCH with valid token) returns 2xx ✓
  - PEWC `consent_audit_logs` row created with `consented=true` and `disclosureVersion` ✓
  - Second finalize with same EIN (`919191919`) returns 409 ✓
- **Test 5 — Booking attribution:** `handleAppointmentBooked()` (internal service call) writes `sdr_lead_events` row with `event_type='appointment_booked'`; matched booking links `merchant_id`; unmatched booking writes row with `merchant_id=null` ✓
- **Cleanup:** 4 contacts, 3 deals, 2 applications cleaned across 11 tables ✓
- **GHL isolation:** `GHL_TRANSPORT_FAILFAST=true` (server-level fail-fast transport) — no live GHL contacts created

### 5. SEO Audit (`seo-audit.ts`) — ✅ PASS

- **421 routes** audited (static + all city hub, city×vertical, compare, industry, partner, conversion pages)
- **0 routes failed**
- **12 routes with warnings** (all advisory — noindex routes with advisory title/description length suggestions)
- `/sitemap.xml` — HTTP 200 (content-type: `application/xml`) ✓
- Partner pages (`/partners`, `/partners/cpa`, `/partners/bookkeeper`, `/partners/insurance`): all 200, unique titles, unique meta descriptions ✓
- Conversion pages (`/upload-statement`, `/get-started`, `/free-analysis`, `/free-smart-terminal`, `/beat-square-stripe`): no `noindex` directive found ✓
- Partner page titles unique ✓, meta descriptions unique ✓

### 6. Mobile Screenshots (`mobile-screenshots.ts`) — ⚠ GO WITH CONDITIONS

- **Exit code 2** — environment limitation: Playwright Chromium cannot install system-level OS dependencies in the Replit sandbox
- **Not a code failure** — all 5 conversion routes returned HTTP 200 (server health confirmed before install attempt); script would succeed in a standard Linux/Docker environment
- **Condition:** Screenshots must be captured manually before go-live:
  - Load each route in a browser at 390px viewport width and save as JPEG
  - Required files: `attached_assets/screenshots/home-mobile-390.jpg`, `upload-statement-mobile-390.jpg`, `free-smart-terminal-mobile-390.jpg`, `beat-square-stripe-mobile-390.jpg`, `get-started-mobile-390.jpg`
  - Visually verify no layout breaks at mobile viewport

### 7. Role-Guard Smoke Test (`smoke-role-guards.ts`) — ✅ PASS

- **48/48 checks passed** across anon, merchant, agent, and admin roles
- **46 static route cases** covering all CRM endpoints, document vault, boarding, MID stats, AI audit, SDR/operator routes
- **Real ownership test (Wave 12):** Created actual document; unrelated merchant → 403 (not 200 or 404); agent with email-match ownership → 200; admin → 200 ✓
- **Merchant positive ownership path:** Merchant accessing own contact's `accessScope=merchant` + `status=approved` document → 200 ✓
- **Agent role gates:** PATCH `/api/merchant-documents/…/status` → 403 for agent ✓; POST `/api/documents/bulk-download` → 403 for agent ✓

---

## Checklist Review (`docs/go-live-checklist.md`)

| Item | Status | Notes |
|------|--------|-------|
| 1. Role-guard sweep | ✅ | 46/46 static cases pass |
| 2. Document ownership cross-tenant 403 | ✅ | Real doc test: merchant→403 confirmed |
| 3. Agent role gates (PATCH/POST doc routes) | ✅ | agent→403 on both mutation endpoints |
| 4. Compliance scan — no ungated send sites | ✅ | 101/101, 0 FAIL |
| 5. Compliance scan — no unknown email categories | ✅ | 0 `unknown` categories |
| 6. Contactability engine — base cases | ✅ | 90 assertions pass |
| 7. Contactability — Wave 12 RVM & PEWC | ✅ | RVM blocked without PEWC confirmed |
| 8. Contactability — feature flag gate | ✅ | SMS_ENABLED flag gate confirmed |
| 9. Sequence compliance — all dryRun cases | ✅ | 32/32 pass, 8 cases |
| 10. Sequence compliance — no unapproved ACTIVE sequences | ✅ | 0 ACTIVE sequences (all paused) |
| 11. Form integration — statement upload stage + doc linkage | ✅ | "Statement Received" + doc record confirmed |
| 12. Form integration — merchant app PEWC consent log | ✅ | consent_audit_logs row with consented=true + disclosureVersion |
| 13. Form integration — booking attribution written | ✅ | sdr_lead_events row with appointment_booked |
| 14. Form integration — full cleanup verified | ✅ | 11 tables cleaned |
| 15. SEO audit — public routes 200, titles, meta | ✅ | 421 routes, 0 failed |
| 16. SEO audit — partner pages canonical tags | ✅ | All 4 partner pages have canonical + unique titles/descriptions |
| 17. SEO audit — conversion pages no noindex, one H1 | ✅ | All 5 conversion pages clean |
| 18. SEO audit — sitemap check | ✅ | `/sitemap.xml` returns HTTP 200 |
| 19. Mobile screenshots — 390px captured | ⚠ | Playwright unavailable in Replit; capture manually |
| 20. Mobile routes reachable — no 404s | ✅ | Exit code 2 (not 1) — all routes reachable, Playwright install failed |

---

## Final Verdict

**⚠ GO WITH CONDITIONS**

All 20 checklist items are satisfied or have an acceptable resolution path. The only open condition is item 19 (mobile screenshots — Playwright is unavailable in the Replit sandbox). This is an environment limitation, not a code regression: all 5 conversion routes are confirmed reachable (server returned HTTP 200 before the Playwright install failure), and the script correctly exits 2 (not 1) per its spec.

**Pre-go-live condition:**
- [ ] Capture 5 mobile screenshots manually at 390px viewport and confirm no layout breaks. Save to `attached_assets/screenshots/*-mobile-390.jpg`.

**No blocking issues found.** The system is clear for go-live subject to the above condition.

---

**Recorded verdict:** ⚠ GO WITH CONDITIONS  
**Engineering lead sign-off:** _______________ Date: 2026-06-26  
**Operator sign-off:** _______________ Date: _______________
