# Liberty Bancard AI BOS — Go/No-Go Checklist

**Purpose:** Operator-run before enabling any automation flags at scale. Each item must be independently verified. Record results and keep this file as release evidence.

**Verdict key:** ✅ GO | ⚠ GO WITH CONDITIONS | ❌ NO-GO

---

## Checklist

### 1. Role-Guard Smoke Test
- [ ] **Command:** `npx tsx scripts/smoke-role-guards.ts`
- **Pass condition:** Exit 0; all 48+ guarded routes behave correctly across anon/merchant/admin. Document ownership guard returns 403 for unrelated authenticated merchant.
- **Failure blocks:** Any unauthenticated access to CRM data, or unauthorized cross-tenant document access.
- **Owner/operator:** Engineering lead. Run from a terminal with DB access.

---

### 2. Static Compliance Scan
- [ ] **Command:** `npx tsx scripts/compliance-scan.ts`
- **Pass condition:** Exit 0; all outbound send call sites are either in the allowlist (low-level sender wrappers) or have a visible `evaluateContactability` gate. No `unknown` email categories.
- **Failure blocks:** Any unapproved mass-send path reaching GHL/SMS/email without a contactability check. This is a hard NO-GO.
- **Owner/operator:** Engineering lead. Must review all FAIL lines before clearing.

---

### 3. API Coverage Check
- [ ] **Command:** `npx tsx scripts/check-api-coverage.ts`
- **Pass condition:** Exit 0; no frontend API paths are unmatched by backend route handlers.
- **Failure blocks:** Dead-end UI actions that would silently fail in production.
- **Owner/operator:** Engineering lead.

---

### 4. Contactability Engine Tests
- [ ] **Command:** `npx tsx scripts/test-contactability.ts`
- **Pass condition:** Exit 0; 14+ assertions pass including all Wave 12 cases (RVM blocked without PEWC, email-only SMS blocked, manual_call fallback, PEWC+SMS_ENABLED=false blocked, PEWC+SMS_ENABLED=true env override allowed).
- **Failure blocks:** Any compliance gate hole that allows unapproved outreach. Hard NO-GO.
- **Owner/operator:** Engineering lead. Review each failed assertion before clearing.

---

### 5. Sequence Compliance Tests
- [ ] **Command:** `npx tsx scripts/test-sequence-compliance.ts`
- **Pass condition:** Exit 0; all 8 dryRun cases pass (cold PEWC block, opted-out SMS, doNotContact, doNotAutoContact, DNC, FL without PEWC, mid-sequence opt-out, PEWC+flags enabled).
- **Failure blocks:** Sequences enrolling blocked contacts. Hard NO-GO.
- **Owner/operator:** Engineering lead.

---

### 6. Form Integration Tests
- [ ] **Command:** `GHL_TEST_MODE=true BASE_URL=http://localhost:5000 npx tsx scripts/test-forms.ts`
- **Pass condition:** Exit 0; statement upload/estimate/get-started create correct DB records; merchant app consent log written; booking attribution `sdr_lead_events` row created; all test records cleaned up.
- **Failure blocks:** Form submissions creating live GHL contacts in non-isolated test. Run with `GHL_TEST_MODE=true` or with token unset.
- **Owner/operator:** Engineering lead. Confirm cleanup proof in output.

---

### 7. SEO Audit
- [ ] **Command:** `npx tsx scripts/seo-audit.ts`
- **Pass condition:** Exit 0; all public routes return 200, unique titles, meta descriptions, canonical tags, H1 present. Partner pages have canonical. Conversion pages have no noindex. Sitemap noted.
- **Failure blocks:** Missing SEO metadata on live marketing pages degrades organic traffic from day one.
- **Owner/operator:** Marketing + engineering. Fix missing canonical/meta before launch.

---

### 8. Mobile Screenshots Captured
- [ ] **Command:** `BASE_URL=http://localhost:5000 npx tsx scripts/mobile-screenshots.ts`
- **Pass condition:** Exit 0 (all 5 captured) or exit 2 (environment limitation acknowledged). Screenshots in `attached_assets/screenshots/*-mobile-390.jpg`. Visually verify no layout breaks.
- **Failure blocks:** Exit 1 (route 404s) means conversion pages are unreachable on mobile — NO-GO.
- **Owner/operator:** Engineering + design. Review screenshots visually before clearing.

---

### 9. GHL Token Validity
- [ ] **Command:** Check `/dashboard/activation` → System Health → GHL Auth Test shows ✓ (not N/A).
- **Pass condition:** GHL Private Integration Token is valid and API calls succeed.
- **Failure blocks:** All GHL sync, contact creation, and sequence enrollment would fail silently.
- **Owner/operator:** Operator. Regenerate token in GHL Settings → Private Integrations if expired.

---

### 10. Redis / BullMQ Connectivity
- [ ] **Command:** Check `/dashboard/activation` → Queue Health → no queue shows "not registered". Verify `REDIS_URL` is set in Secrets.
- **Pass condition:** All 8 queues registered; no "in-memory (no REDIS_URL)" badge in production. At least 5 critical queues show IDLE or RUNNING.
- **Failure blocks:** Without Redis, job queue is in-memory and non-persistent — restarts lose all queued work.
- **Owner/operator:** Operator. Set `REDIS_URL` in Replit Secrets before enabling any automation.

---

### 11. SDR_ENABLED Sequence Review
- [ ] **Command:** `npx tsx scripts/test-sequence-compliance.ts` + manually review `/dashboard/sequences` for ACTIVE sequences.
- **Pass condition:** All ACTIVE sequences have approved content. No unapproved sequences in ACTIVE state. SDR_ENABLED risk noted and accepted.
- **Failure blocks:** SDR defaults to ON — email sequences can fire to any opted-in lead without SMS/voice flags. Content must be reviewed.
- **Owner/operator:** Sales/marketing team lead + compliance officer.

---

### 12. Feature Flag State Verified
- [ ] **Command:** Check `/dashboard/activation` → Feature Flag Risk Matrix.
- **Pass condition:** Each flag is in its intended state. HIGH-risk flags (ORCHESTRATOR_ENABLED, SMS_ENABLED, VOICE_AI_ENABLED, RINGLESS_VM_ENABLED) are OFF unless operator has signed off on prerequisites.
- **Failure blocks:** Accidental flag enables could trigger mass automated outreach.
- **Owner/operator:** Operator + engineering lead. Document flag state at launch time.

---

### 13. PEWC Consent Form Wiring
- [ ] **Command:** Test statement upload form in browser; verify `consent_audit_logs` row created with `consented=true` and `disclosureVersion` set.
- **Pass condition:** Every form with PEWC checkbox writes a `consent_audit_logs` row before any outreach is allowed.
- **Failure blocks:** Outreach to contacts who never gave valid PEWC consent — TCPA violation risk.
- **Owner/operator:** Engineering lead + compliance officer. Review DB directly.

---

### 14. Document Access-Token Ownership Guard
- [ ] **Command:** `npx tsx scripts/smoke-role-guards.ts` — verify `doc access-token (ownership guard)` case shows ✓.
- **Pass condition:** Unrelated authenticated merchant receives 403 (not 200 or 404) on another merchant's document access-token endpoint.
- **Failure blocks:** Cross-tenant document access is a data security violation.
- **Owner/operator:** Engineering lead. If 200 returned for unrelated merchant, code fix required before go-live.

---

### 15. GHL Sync Verified (Sandbox Contact)
- [ ] **Command:** Create a test contact in the CRM, wait 45s, verify the contact appears in GHL sandbox.
- **Pass condition:** Contact synced to GHL within one sync cycle (≤45s). Custom fields (lb_sms_allowed, lb_email_allowed, etc.) populated.
- **Failure blocks:** If GHL sync is broken, no automation workflows will fire.
- **Owner/operator:** Operator. Test with a `QA_RELEASE_TEST` named contact and delete after.

---

### 16. Email Deliverability Verified
- [ ] **Command:** Send a test email via `/dashboard/activation` → Outreach Controls or via operator dashboard.
- **Pass condition:** Email arrives in inbox (not spam) within 5 minutes. `From` address matches configured identity.
- **Failure blocks:** All email sequences landing in spam means zero response rates.
- **Owner/operator:** Operations + marketing. Check sending identity SPF/DKIM records.

---

### 17. Public Routes Return 200
- [ ] **Command:** `npx tsx scripts/seo-audit.ts` (covers static + partner pages) or spot-check in browser.
- **Pass condition:** All marketing pages (`/`, `/free-smart-terminal`, `/beat-square-stripe`, `/upload-statement`, `/get-started`, `/partners`, etc.) return 200. No broken links on nav.
- **Failure blocks:** Broken public pages prevent lead capture.
- **Owner/operator:** Engineering lead.

---

### 18. Nightly Discovery OFF by Default
- [ ] **Command:** Check `/dashboard/activation` → Feature Flag Risk Matrix → `NIGHTLY_DISCOVERY_ENABLED`.
- **Pass condition:** `NIGHTLY_DISCOVERY_ENABLED` shows OFF. If ON, at least one discovery API key is configured and budget reviewed.
- **Failure blocks:** Discovery running without configured keys will produce errors; running without budget review can incur unexpected API costs.
- **Owner/operator:** Operator. Confirm in Replit Secrets.

---

### 19. Anomaly Detection Active
- [ ] **Command:** Check `/dashboard/operator` → Anomaly Alerts tab shows no active critical alerts.
- **Pass condition:** No unresolved anomaly alerts. Monitoring loop running (visible in send metrics).
- **Failure blocks:** Unmonitored systems can trigger compliance violations silently.
- **Owner/operator:** Operator.

---

### 20. Test Data Cleaned Up
- [ ] **Command:** Run `SELECT COUNT(*) FROM contacts WHERE email LIKE 'qa-release-test-%'` — expect 0.
- **Pass condition:** All `qa-release-test-*@libertybancard.test` contacts, deals, consent logs, sdr_lead_events, and merchant_applications are deleted. No QA_RELEASE_TEST records have `doNotAutoContact=false`.
- **Failure blocks:** Test contacts entering automation pipelines causes false positive metrics and potentially real outreach to test addresses.
- **Owner/operator:** Engineering lead. Run after all test scripts complete.

---

## Final Verdict

| Verdict | Criteria |
|---|---|
| ✅ GO | All 20 items checked, all scripts exit 0, no P0/P1 unresolved. |
| ⚠ GO WITH CONDITIONS | All scripts exit 0 except environment-limited items (e.g. Playwright exit 2 — screenshots captured via browser). Document condition and timeline to resolve. |
| ❌ NO-GO | Any of items 1–7, 9, 10, 13, 14 fail. Any compliance scan FAIL. Any contactability gate hole found. |

**Recorded verdict:** _______________

**Operator sign-off:** _______________ Date: _______________

**Engineering lead sign-off:** _______________ Date: _______________
