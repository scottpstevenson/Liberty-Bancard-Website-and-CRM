# Liberty Bancard — Go-Live / GO/NO-GO Checklist

**Date**: _______________  
**Operator**: _______________  
**Version**: Wave 12 Release QA  
**Decision**: ☐ GO &nbsp;&nbsp; ☐ GO WITH CONDITIONS &nbsp;&nbsp; ☐ NO-GO

---

## Instructions

Each item must be marked **PASS**, **FAIL**, or **N/A** before the final verdict.  
Any single **FAIL** blocks GO unless escalated to a named condition in "GO WITH CONDITIONS."  
The verdict is a 3-state **manual** decision — no automated system overrides this checklist.

---

## 1. Compliance Kill Lines

| # | Check | Command / Evidence | Result |
|---|-------|--------------------|--------|
| 1 | **Static compliance scan passes** | `npx tsx scripts/compliance-scan.ts` → exit 0 | ☐ PASS / ☐ FAIL |
| 2 | **Contactability gate covers all 5 channels** | `npx tsx scripts/test-contactability.ts` → exit 0 | ☐ PASS / ☐ FAIL |
| 3 | **DNC contacts blocked on all channels** | test-contactability output: "doNotContact blocks email/manual_call/sms/voice_ai/ringless_vm — 5/5 ✓" | ☐ PASS / ☐ FAIL |
| 4 | **PEWC evidence required for SMS/voice/RVM** | test-contactability: "PEWC tier without audit evidence is blocked at step 12 ✓" | ☐ PASS / ☐ FAIL |
| 5 | **Florida mini-TCPA rule enforced** | test-contactability: "Florida: SMS blocked without PEWC ✓" | ☐ PASS / ☐ FAIL |
| 6 | **Sequence compliance tests pass** | `npx tsx scripts/test-sequence-compliance.ts` → exit 0 | ☐ PASS / ☐ FAIL |

---

## 2. Authentication & Role Guards

| # | Check | Command / Evidence | Result |
|---|-------|--------------------|--------|
| 7 | **Role guard smoke test passes** | `npx tsx scripts/smoke-role-guards.ts` → exit 0 | ☐ PASS / ☐ FAIL |
| 8 | **Document vault ownership guard verified** | smoke-role-guards output: "merchant-document access-token ownership ✓" | ☐ PASS / ☐ FAIL |
| 9 | **MFA enforced for admin users** | Login as admin without 2FA → redirected to 2FA setup | ☐ PASS / ☐ FAIL |

---

## 3. Feature Flags & Queue Health

| # | Check | Command / Evidence | Result |
|---|-------|--------------------|--------|
| 10 | **SDR_ENABLED default state reviewed** | Activation Panel → Feature Flags → SDR_ENABLED confirmed | ☐ PASS / ☐ FAIL |
| 11 | **SMS_ENABLED=false in production config** | Env var confirmed OFF before Day 1 unless explicitly approved | ☐ PASS / ☐ FAIL |
| 12 | **VOICE_AI_ENABLED=false in production config** | Env var confirmed OFF unless voice AI is ready | ☐ PASS / ☐ FAIL |
| 13 | **5 critical BullMQ queues healthy** | Activation Panel → Job Queue tab: ghl-sync, sequences, sla-checks, onboarding-reminder, mid-ingestion all show active | ☐ PASS / ☐ FAIL |
| 14 | **No dead-letter jobs** | Job Queue → DLQ count = 0 (or reviewed and cleared) | ☐ PASS / ☐ FAIL |

---

## 4. Form & Lead Flow

| # | Check | Command / Evidence | Result |
|---|-------|--------------------|--------|
| 15 | **Form integration tests pass** | `npx tsx scripts/test-forms.ts` → exit 0 | ☐ PASS / ☐ FAIL |
| 16 | **Public rate limiter active** | test-forms: "Rate limiter returns 429 after 10+ rapid submissions ✓" | ☐ PASS / ☐ FAIL |
| 17 | **PEWC consent audit log written** | Submit statement form with PEWC checkbox → consent_audit_logs row created | ☐ PASS / ☐ FAIL |

---

## 5. SEO & Mobile

| # | Check | Command / Evidence | Result |
|---|-------|--------------------|--------|
| 18 | **SEO audit passes** | `npx tsx scripts/seo-audit.ts` → exit 0 | ☐ PASS / ☐ FAIL |
| 19 | **Mobile PWA routes healthy** | `npx tsx scripts/mobile-screenshots.ts` → exit 0 or exit 2 (env limit) | ☐ PASS / ☐ FAIL |
| 20 | **GHL token validity confirmed** | Activation Panel → GHL Auth Test → "✓ Connected" (not N/A) | ☐ PASS / ☐ FAIL |

---

## Verdict

**Passing items**: _____ / 20  
**Failing items**: _____  
**N/A items**: _____

### GO
All 20 items PASS (or N/A for items not applicable to this deployment phase).  
Signed off by: _______________ Date: _______________

### GO WITH CONDITIONS
Items ___ and ___ are FAIL but have documented mitigations:  
Condition 1: _______________________________________________  
Condition 2: _______________________________________________  
Signed off by: _______________ Date: _______________  
Re-check deadline: _______________

### NO-GO
One or more critical items (1–9) are FAIL and unmitigated.  
Root cause: _______________________________________________  
Next check date: _______________

---

## Notes

_Use this space to record observations, partial passes, or items requiring follow-up:_

```
[operator notes here]
```
