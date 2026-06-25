---
name: Master audit 2026 + 12-wave build plan
description: Key findings from the June 2026 compliance/conversion audit and the resulting task structure.
---

## Audit report location
`docs/audit-report-2026-06-25.md`

## 6 Kill Lines Found (June 25, 2026)
1. `contacts.doNotAutoContact` exists in schema but is NOT checked by `compliance-engine.ts` — only `sdr_merchants.doNotContactFlag` is checked.
2. No canonical `evaluateContactability()` — SDR path uses `checkBeforeSend()`, sequence worker uses a separate ad-hoc bounce/status check. No shared gate.
3. GHL-native workflow triggers bypass Replit's channel permission state entirely.
4. `consentAuditLogs` stores `disclosureVersion`, `disclosureText`, `formId`, `consentedPhone` in JSONB `details` — not queryable top-level columns.
5. `/upload-statement` form has no PEWC optional checkbox — every statement upload lead is permanently `warm_no_pewc`.
6. `contacts` table missing `phoneType`, `consentTier`, `lifecycleStage`, `timezone` columns.

## Schema gaps on contacts table
Missing: `phoneType` (mobile|landline|voip), `consentTier` (cold_no_consent|warm_no_pewc|pewc_full_automation|opted_out|do_not_contact), `lifecycleStage` (12-value enum), `timezone`.

## consentAuditLogs gap
Needs top-level columns: `disclosureVersion`, `disclosureText`, `formId`, `consentedPhone` (currently all in JSONB details).

## Analytics gaps
Missing: `phone_cta_click`, `booking_cta_click`, `statement_upload_started/failed`, `form_abandoned`, `pewc_checked/unchecked`, server-side `contactability_evaluated`/`channel_blocked`/`offer_route_assigned`/`deal_stage_changed`.

Booking attribution is broken: GHL calendar links do not carry UTM params from sessionStorage.

## Missing public page
`/free-smart-terminal` does not exist — only CTA links to `/get-started?offer=free-terminal`. Needs dedicated page (Wave 3, Task #573).

## 12-wave task map (Tasks #571–582)
- #571 Wave 1: Contactability engine (P0, no deps)
- #572 Wave 2: Consent + form upgrade (P0, needs #571)
- #573 Wave 3: Landing page rebuild (P1, no deps — parallel with Wave 1)
- #574 Wave 4: SEO/programmatic (P1, needs #573)
- #575 Wave 5: Offer router + AI (P1, needs #571)
- #576 Wave 6: SDR sequence architecture (P1, needs #571 #575)
- #577 Wave 7: GHL sync hardening (P1, needs #571 #572)
- #578 Wave 8: Analytics + attribution (P1, needs #572 #573)
- #579 Wave 9: Operator command center (P2, needs #571 #577 #578)
- #580 Wave 10: Merchant app + onboarding (P2, needs #572)
- #581 Wave 11: Partner + referral (P2, needs #580)
- #582 Wave 12: QA + go-live safety (P2, needs all above)

## Recommended start order
Begin #571 + #573 in parallel. After #571 merges, start #572 #575 #577 in parallel.

**Why:** Wave 1 is the safety-critical foundation gating 5 other waves. Wave 3 is the fastest conversion win and has no dependencies.
