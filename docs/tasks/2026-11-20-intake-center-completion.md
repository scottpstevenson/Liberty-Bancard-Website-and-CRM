# Intake Center completion

Product code: `42ba26437a67a096dc791d05689cb32bcf2f2464`, branch `codex/intake-center`. No push, Replit sync, production setting change or publication in this task.

## Delivered

- `/dashboard/intake`, prominent admin/manager navigation, five approved tabs. Merchant-submitted referrals are included alongside partner referrals. Existing entrances retain their handlers and review controls.
- Selected panels mount independently; filters, source references, browser history and reload are retained. Existing approval, record-class and CSRF boundaries remain in force.
- Per-record Review & next steps drawers: linked tasks, CRM alerts, staff-alert attempts, automatic receipt state, recorded messages, next steps, branded preview and explicit staff correspondence. Managers can review/preview/create tasks; administrator authority is required to send. Privacy correspondence remains administrator-only.
- New-submission reconciliation creates durable follow-up work and staff alerts idempotently. Introduction-created referral rows resolve to their introduction's existing task/receipt owner.
- One receipt owner continues to enforce immutable prepared recipients/content, per-message claims, bounded retries and no automatic retry of uncertain sends. New v4 source contracts preserve replay of v2/v3 occurrences. Automatic receipt wording and staff alerts use a shared Liberty layout. Relevant receipts/manual correspondence include `https://libertybancard.com/book`; privacy receipts omit the scheduling CTA.
- Staff email recipient remains `scott@libertybancard.com`. Referrals acknowledge the submitting referrer, not the referred business. New intake never grants marketing consent, starts a campaign or unpauses cold outreach.
- Migration `0396_intake_operations` adds the operational ledger and widens the staff-alert constraints for truthful website/merchant-application event kinds. No historical backfill or activation is performed by the migration.

## Executed verification

- TypeScript: `npm run check`, exit 0.
- Committed production build: exit 0, artifact SHA `42ba26437a67a096dc791d05689cb32bcf2f2464`, build ID `5bcf7e4d-9dce-42ee-9411-2df1b89b5811`. Existing build warnings remain: Zod pure annotations, CommonJS import.meta and bundle size.
- Canonical deterministic-static runner: **108/108 suites passed**. Suite manifest validates all 318 required suite entries.
- New registered HTTP/database/receipt-authority suite: **43 checks passed**. Includes real sessions/CSRF, role restrictions, all referral sources, source-only addressing, preview integrity, idempotency, notification allowlisting, paused-outbound receipt admission, uncertainty handling, original v3 replay and no historical catch-up. Providers were not delivered to; transport acceptance was exercised with an injected synthetic sender and actual durable capability checks.
- Existing focused regressions on separate freshly migrated disposable databases: inbound acknowledgments **92**, staff-alert durability/pause isolation **40**, staff-alert HTTP **11**, partner review **133** checks passed.
- Real Chrome on the Air, compiled candidate and disposable backend: all five categories; merchant review; application filters across tabs, Back and reload; source-addressed preview; preview-to-queue timeline; introduction/referral owner alias; empty merchant-referral state; loading states. At 390px the existing mobile handoff opens the responsive desktop workspace without document overflow; application/intro mobile cards retain the new action, and the drawer remains within the viewport. Default viewport restored.
- Live read-only calendar check: `/book` redirected to Liberty Bancard — Sales Meeting on the existing GHL calendar. No appointment booked.
- Browser testing caught and repaired portal clicks opening their parent row, missing mobile action buttons and introduction-owned referral tracking. Static assertions were updated for extracted panel ownership, the approved navigation entry and manifest v4 while retaining v3.
- `git diff --check` clean. Isolated browser tabs, server, PostgreSQL and Redis stopped. Other projects/services were preserved.

Local evidence directory: `/Users/matt/.local/share/liberty-dev/`. Logs: `intake-final-typecheck.log`, `intake-committed-build.log`, `intake-committed-static.log`, `intake-focused-current.log`, `intake-integration-complete.log`. Images: `intake-center-desktop.jpg`, `intake-center-mobile.jpg`, `intake-email-preview.jpg`.

## Production activation remains pending

This implementation is unpublished. Existing production staff-alert behavior and its pause exception were preserved; no production email was sent by these tests. No offline-conversion upload, campaign, cold-outreach or Outscraper setting was changed. The $50 cap remains the existing policy.

After a separately authorized release applies migration 0396 and serves this code, an administrator opens Intake Center → Intake automation → **Enable new intake receipts & follow-up**. This saves the first automation cutoff and the explicit transactional receipt classes; repeat saves preserve cutoffs and older submissions are never caught up automatically. Production background workers and SMTP must be active; the panel reports their actual status. This control does not activate cold outreach, campaigns or offline-conversion uploads. Older records can receive explicit, previewed staff correspondence without a bulk historical receipt replay.

No full production pre-deploy gate, real SMTP/inbox delivery, Safari/native phone or live production activation is claimed by the local checks above.
