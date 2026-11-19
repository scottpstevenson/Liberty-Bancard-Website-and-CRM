# Staff intake alert validation and rollout

Implemented on `codex/team-intake-email-alerts`, based on GitHub main `cead2534782fbd17f26b6a24f48ca83e2612e89d`. GitHub main was rechecked unchanged after validation. No production configuration, database, outbound control, GitHub branch or Replit workspace was changed.

The recipient is fixed to scott@libertybancard.com. New merchant referrals, partner introductions and applications for sales agents or referral partners enqueue one durable staff alert alongside the source transaction. This staff-only purpose is explicitly authorized while customer/prospect outbound stays paused. The canonical SMTP boundary verifies the actual durable claim, exact content and recipient, and current pause epoch. The pre-deploy scanner exemption covers only the intake owner; it does not exempt the SMTP boundary from runtime authorization.

## Executed evidence

- Node 22.22.0, npm 10.9.4; existing locked dependencies, no dependency changes.
- TypeScript `npm run check`: passed.
- Production `npm run build`: passed. It retains warnings about large chunks and the existing email-pre-filter CommonJS `import.meta` expression; this task does not change that code. The build ran before the feature commit and its generated parent-SHA identity must not be used as a deployed-feature identity.
- Standard disposable pre-deploy launcher selecting both new suites: 2/2 passed, no setup/teardown/gate-control failures, pause true afterward. These selected results are not full-roster release approval.
- Native alert suite: 40 checks, including actual source writers, failed-alert-insert rollback, replay/concurrency, same-claim concurrent SMTP dispatch, five-attempt cap, known-unsent retry, uncertain/crash retention, HTML escaping, fixed-recipient/content checks, override rejection and epoch/activation guards. All SMTP intercepted by fake nodemailer; no real delivery or provider request.
- Actual HTTP/session suite: 11 checks. Both application paths and replay leave one pending alert; merchant referral is pending; admin/manager can read status while other roles cannot; no send, approval or external provider request.
- Existing partner-program lifecycle: 171 checks passed.
- Existing partner approval delivery: 26 checks passed.
- CI suite manifest and queue compliance: passed. No new physical queue or timer.

The older `scripts/test-outbound-pause-authority.ts` suite reports 84 passes and three failures on both this feature and the clean `f58d5b7c87c9ce678bbffcff439093c6ff590a64` baseline. The baseline and main have identical relevant toolkit, pause-control and test files. One assertion expects a legacy setting seeded by startup in this migration-only fixture. Two inspect toolkit.ts for inline authority/inflight calls, although its SMS route delegates to the canonical gated `sendGhlSms` boundary in ghl.ts. These failures are recorded, not counted as passing or repaired within this feature. Current source tracing and the new paused SMTP tests do not constitute live SMS acceptance.

## Deployment requirements (not performed)

1. Review and merge the feature, then deploy separately when authorized. Apply additive migration `0393_team_intake_email_alerts` with its journal entry using the existing production schema owner. It adds one table and two indexes and backfills no historical events.
2. Production needs the existing valid SMTP_HOST, SMTP_USER and SMTP_PASS settings. No new secret is introduced. EMAIL_OVERRIDE_TO must be unset. The worker is disabled outside NODE_ENV=production except under the denied certification harness.
3. Keep customer/prospect outbound paused. The existing partner-application recovery tick processes staff alerts every 60 seconds when background jobs are enabled. No applicant approval, welcome, campaign enrollment or marketing send is authorized by this feature.
4. Read GET /api/admin/team-intake-alerts/status as admin or manager to confirm the recipient, SMTP configuration and state counts. Sent means SMTP acceptance, not proof of inbox delivery. Uncertain deliveries remain for operator review and are not automatically resent. Known-unsent failures retry with backoff up to five total attempts.
5. After authorized deployment, use a fresh synthetic submission to verify pending CRM state, the outbox result and Scott's actual inbox. This live delivery proof has not been performed. No historical applications/referrals receive catch-up alerts.

Merchant-profile referral emails link to the merchant portfolio and include the exact referral ID; this application currently has no dedicated staff detail deep link for that referral type. Other alerts link to the appropriate referral-program tab and include their source ID.
