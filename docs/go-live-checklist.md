# Liberty Bancard AI BOS — Go/No-Go Checklist

**Purpose:** Operator-run before enabling any automation flags at scale. Each item must be independently verified by running the listed command and confirming the stated pass condition. Record results and keep this file as release evidence.

**Verdict key:** ✅ GO | ⚠ GO WITH CONDITIONS | ❌ NO-GO

---

## CI Automation Coverage

The Wave 12 scripts are wired into GitHub Actions (`.github/workflows/wave12-ci.yml`).
Every push and pull request to `main` runs them automatically.

| Checklist items | Script | CI job | Required GitHub secrets |
|---|---|---|---|
| 4, 5 | `compliance-scan.ts` | `static` | none |
| (surface check) | `check-api-coverage.ts` | `static` | none |
| 1, 2, 3 | `smoke-role-guards.ts` | `integration` | `ADMIN_SEED_EMAIL`, `ADMIN_SEED_PASSWORD` |
| 6, 7, 8 | `test-contactability.ts` | `integration` | `ADMIN_SEED_EMAIL`, `ADMIN_SEED_PASSWORD` |
| 9, 10 | `test-sequence-compliance.ts` | `integration` | none |
| 11–14 | `test-forms.ts` | `integration` | none (`GHL_TEST_MODE=true` prevents live GHL) |
| 15–18 | `seo-audit.ts` | `integration` | none |
| 19, 20 | `mobile-screenshots.ts` | `integration` | none (exit 2 = env limitation, not a block) |

**To enable CI:** add `ADMIN_SEED_EMAIL` and `ADMIN_SEED_PASSWORD` to the repository's GitHub Actions secrets (Settings → Secrets and variables → Actions). All other scripts run without any secrets.

**Manual items still required before go-live:** visual review of mobile screenshots (item 19), compliance officer sign-off (items 7, 12), and sales/marketing review of active sequence names (item 10). These cannot be automated.

---

## Checklist

### 1. Role-Guard Sweep — All Routes Pass
- [ ] **Command:** `npx tsx scripts/smoke-role-guards.ts`
- **Pass condition:** Exit 0; all 48+ guarded routes return the expected status codes across anon, merchant, agent, and admin. No dashboard route accessible to unauthenticated users.
- **Failure blocks:** Any unauthenticated access to CRM data or role escalation path. Hard NO-GO.
- **Owner/operator:** Engineering lead. Run from a terminal with `ADMIN_SEED_EMAIL` and `ADMIN_SEED_PASSWORD` env vars set.

---

### 2. Document Ownership Guard — Cross-Tenant 403
- [ ] **Command:** `npx tsx scripts/smoke-role-guards.ts`
- **Pass condition:** Output line `doc access-token (real doc …): merchant→403 (403✓)` appears. Unrelated authenticated merchant receives 403 (not 200 or 404) on another merchant's document access-token endpoint.
- **Failure blocks:** Cross-tenant document access is a data security violation. Hard NO-GO.
- **Owner/operator:** Engineering lead. If merchant receives 200, a code fix in `server/routes/documents.ts` is required before go-live.

---

### 3. Agent Role Gates — PATCH / POST Document Routes
- [ ] **Command:** `npx tsx scripts/smoke-role-guards.ts`
- **Pass condition:** Output shows `PATCH /api/merchant-documents/…/status` and `POST /api/documents/bulk-download` returning 403 for the smoke agent role. Assigned agent → 200 on access-token.
- **Failure blocks:** Agent users gaining admin-level document mutation access. Hard NO-GO.
- **Owner/operator:** Engineering lead.

---

### 4. Compliance Scan — No Ungated Send Sites
- [ ] **Command:** `npx tsx scripts/compliance-scan.ts`
- **Pass condition:** Exit 0; all outbound send call sites are in the allowlist (low-level sender wrappers) or have a visible `evaluateContactability` gate. Zero FAIL lines in output.
- **Failure blocks:** Any unapproved mass-send path reaching GHL, SMS, or email without a contactability check. Hard NO-GO.
- **Owner/operator:** Engineering lead. Review every FAIL line before clearing.

---

### 5. Compliance Scan — No Unknown Email Categories
- [ ] **Command:** `npx tsx scripts/compliance-scan.ts`
- **Pass condition:** Output shows no `unknown` category classifications in the email send-site scan. All sites are classified as `marketing_outreach`, `sequence_step`, `transactional_merchant`, or `internal_admin`.
- **Failure blocks:** Unclassified send sites cannot be audited for contactability compliance.
- **Owner/operator:** Engineering lead. Any `unknown` classification must be resolved in `compliance-scan.ts` allowlist.

---

### 6. Contactability Engine — Base Cases (14+)
- [ ] **Command:** `npx tsx scripts/test-contactability.ts`
- **Pass condition:** Exit 0; all 14+ base assertions pass — doNotContact blocks all channels, opted_out SMS blocked, consentTier gates correct, PEWC tier enforcement active.
- **Failure blocks:** Any contactability gate hole allowing unapproved outreach to DNC or opted-out contacts. Hard NO-GO.
- **Owner/operator:** Engineering lead. Review every failed assertion individually.

---

### 7. Contactability Engine — Wave 12 RVM & PEWC Cases
- [ ] **Command:** `npx tsx scripts/test-contactability.ts`
- **Pass condition:** Exit 0; Wave 12 cases pass: RVM blocked without PEWC, email-only contact blocked from SMS, manual_call falls back correctly, Florida mini-TCPA rule enforced.
- **Failure blocks:** RVM or SMS outreach to contacts lacking required PEWC consent — TCPA violation risk.
- **Owner/operator:** Engineering lead + compliance officer.

---

### 8. Contactability Engine — Feature Flag Gate (SMS_ENABLED Override)
- [ ] **Command:** `npx tsx scripts/test-contactability.ts`
- **Pass condition:** Exit 0; PEWC+`SMS_ENABLED=false` blocks SMS send; PEWC+`SMS_ENABLED=true` allows it. Feature flag gates function as the last line of defense before outbound.
- **Failure blocks:** If flags are ignored, enabling SMS_ENABLED in production could bypass the PEWC check.
- **Owner/operator:** Engineering lead. Confirm flag env-var override behavior matches `server/services/feature-flags.ts`.

---

### 9. Sequence Compliance — All DryRun Cases Pass
- [ ] **Command:** `npx tsx scripts/test-sequence-compliance.ts`
- **Pass condition:** Exit 0; all 8 dryRun cases pass: cold PEWC blocked, opted-out SMS blocked, doNotContact blocked, doNotAutoContact blocked, DNC list blocked, FL without PEWC blocked, mid-sequence opt-out honored, PEWC+flags-enabled allowed.
- **Failure blocks:** Sequences enrolling or advancing steps for blocked contacts. Hard NO-GO.
- **Owner/operator:** Engineering lead.

---

### 10. Sequence Compliance — No Unapproved ACTIVE Sequences
- [ ] **Command:** `npx tsx scripts/test-sequence-compliance.ts`
- **Pass condition:** Exit 0; output shows 0 sequences in ACTIVE state that lack approval. SDR_ENABLED defaults ON — confirm email sequences are reviewed and approved before clearing this item.
- **Failure blocks:** Unapproved sequences firing to opted-in leads from day one. SDR defaults to ON.
- **Owner/operator:** Sales/marketing lead + compliance officer. Document each ACTIVE sequence name and approval date.

---

### 11. Form Integration — Statement Upload Deal Stage + Document Linkage
- [ ] **Command:** `GHL_TEST_MODE=true npx tsx scripts/test-forms.ts`
- **Pass condition:** Exit 0; statement upload creates contact, deal in stage "Statement Received", and document record linked to both contact and deal. `doNotContact` not set by form.
- **Failure blocks:** Statement upload creating deals in wrong pipeline stage breaks the `Statement Received → Review In Progress` funnel.
- **Owner/operator:** Engineering lead. Set `GHL_TEST_MODE=true` or unset `GHL_PRIVATE_INTEGRATION_TOKEN` to prevent live GHL contact creation.

---

### 12. Form Integration — Merchant App PEWC Consent Log
- [ ] **Command:** `GHL_TEST_MODE=true npx tsx scripts/test-forms.ts`
- **Pass condition:** Exit 0; merchant app finalize creates a `consent_audit_logs` row with `consented=true`, `disclosureVersion` set, and `ipAddress` captured. Duplicate EIN returns 409.
- **Failure blocks:** Outreach to merchant applicants who never gave valid PEWC consent — TCPA violation. Hard NO-GO.
- **Owner/operator:** Engineering lead + compliance officer.

---

### 13. Form Integration — Booking Attribution Written
- [ ] **Command:** `GHL_TEST_MODE=true npx tsx scripts/test-forms.ts`
- **Pass condition:** Exit 0; `sdr_lead_events` row written with `event_type='appointment_booked'` via internal `handleAppointmentBooked()` service call. No unattributed booking path exists.
- **Failure blocks:** Untracked booked appointments break pipeline stage progression and commission attribution.
- **Owner/operator:** Engineering lead.

---

### 14. Form Integration — Full Cleanup Verified
- [ ] **Command:** `GHL_TEST_MODE=true npx tsx scripts/test-forms.ts`
- **Pass condition:** Exit 0; output shows cleanup across all 12 tables: contacts, deals, merchant_documents, documents, merchant_applications, consent_audit_logs, sdr_lead_events, audit_logs, sequence_enrollments, referrals, affiliate_clicks, merchant_referrals. No QA records remain.
- **Failure blocks:** Orphaned test contacts entering automation pipelines generate false metrics and may trigger real outreach.
- **Owner/operator:** Engineering lead. Confirm "Cleaned up" line in output matches expected table list.

---

### 15. SEO Audit — Public Routes 200, Titles, Meta Descriptions
- [ ] **Command:** `npx tsx scripts/seo-audit.ts`
- **Pass condition:** Exit 0; all public marketing routes return 200; each page has a unique title and meta description; JSON-LD structured data present on home/landing pages.
- **Failure blocks:** Missing SEO metadata on live marketing pages degrades organic traffic from day one.
- **Owner/operator:** Marketing + engineering. Fix any missing title or meta before launch.

---

### 16. SEO Audit — Partner Pages Have Canonical Tags
- [ ] **Command:** `npx tsx scripts/seo-audit.ts`
- **Pass condition:** Exit 0; `/partners`, `/partners/cpa`, `/partners/bookkeeper`, `/partners/insurance` each return 200 with unique title, unique meta description, and a `<link rel="canonical">` tag present.
- **Failure blocks:** Partner pages without canonical tags are at risk of duplicate-content penalties that reduce partner program discoverability.
- **Owner/operator:** Marketing + engineering.

---

### 17. SEO Audit — Conversion Pages Have No Noindex and Exactly One H1
- [ ] **Command:** `npx tsx scripts/seo-audit.ts`
- **Pass condition:** Exit 0; `/upload-statement`, `/get-started`, `/free-analysis`, `/free-smart-terminal`, `/beat-square-stripe` each have no `<meta name="robots" content="noindex">` directive and exactly one `<h1>` tag. Multiple H1 is a FAIL (not a warning) for these pages.
- **Failure blocks:** Noindex on lead-gen pages means Google cannot index primary conversion pages — direct revenue impact. Hard NO-GO.
- **Owner/operator:** Engineering lead. Remove any accidental noindex directives.

---

### 18. SEO Audit — Sitemap Check Logged
- [ ] **Command:** `npx tsx scripts/seo-audit.ts`
- **Pass condition:** Output contains either "sitemap.xml found (200)" or "sitemap.xml not found — not blocking". A 200 sitemap accelerates indexing; a 404 is noted but not a blocker for this release.
- **Failure blocks:** Not blocking. Advisory: add `sitemap.xml` before broad content marketing launch.
- **Owner/operator:** Engineering lead.

---

### 19. Mobile Screenshots Captured at 390px
- [ ] **Command:** `npx tsx scripts/mobile-screenshots.ts`
- **Pass condition:** Exit 0 (all 5 screenshots captured) or exit 2 (Playwright environment limitation — screenshots captured via browser instead). Files present in `attached_assets/screenshots/*-mobile-390.jpg`. Visually verify no layout breaks.
- **Failure blocks:** Exit 1 means a conversion page returned 404 on mobile — NO-GO.
- **Owner/operator:** Engineering + design. Review screenshots visually before clearing this item.

---

### 20. Mobile Routes Reachable — No 404s on Conversion Pages
- [ ] **Command:** `npx tsx scripts/mobile-screenshots.ts`
- **Pass condition:** Script exits with code 0 or 2 (never 1). All 5 conversion pages (`/`, `/upload-statement`, `/free-smart-terminal`, `/beat-square-stripe`, `/get-started`) reachable at mobile viewport without returning 404.
- **Failure blocks:** Any conversion page returning 404 on mobile means leads cannot reach the form. Hard NO-GO.
- **Owner/operator:** Engineering lead. Investigate broken routes if exit code is 1.

---

## Final Verdict

| Verdict | Criteria |
|---|---|
| ✅ GO | All 20 items checked; all scripts exit 0; no P0/P1 unresolved. |
| ⚠ GO WITH CONDITIONS | All scripts exit 0 except environment-limited items (e.g., Playwright exit 2 — screenshots captured via browser). Document condition and timeline to resolve. |
| ❌ NO-GO | Any of items 1–10, 11–14, 15, 17, 19, 20 fails. Any compliance scan FAIL line found. Any contactability gate hole. Any document ownership breach. |

**Recorded verdict:** _______________

**Operator sign-off:** _______________ Date: _______________

**Engineering lead sign-off:** _______________ Date: _______________
