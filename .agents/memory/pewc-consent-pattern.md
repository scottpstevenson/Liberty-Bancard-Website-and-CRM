---
name: PEWC Consent Pattern (Wave 2)
description: How PEWC opt-in is collected, stored, and gated across public forms and server routes.
---

## The rule
`recordPewcDecision()` in `server/services/consent-evidence.ts` is the single write path for all PEWC audit evidence. Never call `storage.createConsentAuditLog` directly for express-written consent.

**Why:** Centralises no-downgrade logic and disclosure version stamping in one place. If a contact is already at `pewc_full_automation`, a declined check writes a `pewc_declined` audit row but skips the DB tier update — preventing accidental downgrades.

**How to apply:**
- Import from `../services/consent-evidence` in any route that collects phone + PEWC checkbox.
- Pass `checked: pewcConsent === true` — never a truthy string.
- After `recordPewcDecision()`, gate `sendConfirmationSms` behind `evaluateContactability({ mode: "enforcement" })`.
- Always use `mode: "enforcement"` — a denied check silently skips the send, never throws.

## PewcCheckbox component
`client/src/components/PewcCheckbox.tsx` — controlled, optional. Links to `/sms-terms` and `/tcpa-consent` (both routes exist in App.tsx).
- Never wrap in `FormField` / `Controller` — connect via `form.watch("pewcConsent")` + `form.setValue`.
- Schema: `z.boolean().optional().default(false)` — no `.refine()`.

## Critical pitfall
When replacing a mandatory consent `FormField` with `PewcCheckbox`, verify no other `<Checkbox>` components in the same file still need the shadcn Checkbox import. UploadStatement.tsx uses `Checkbox` for `interestedIn0Percent` and `needTerminal` — both imports must coexist.

## Disclosure version
`PEWC_DISCLOSURE_VERSION = "v2026-06-25"` in `shared/consent-disclosures.ts`. Bump if disclosure language changes.

## Forms covered (Wave 2)
statement-upload, get-started, callback (Home.tsx), estimate, free-analysis (quiz), merchant-application.
