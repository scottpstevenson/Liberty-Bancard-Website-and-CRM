# Team intake email alerts

Matt authorized alerts to `scott@libertybancard.com` for new merchant referrals and sales-agent/referral-partner applications, including sending those staff-only alerts while customer/prospect outbound remains paused. No publish is authorized.

Use an additive durable outbox, committed in the same transactions as new intake records. Cover both application paths, partner introductions (including held matches), standalone partner/affiliate referrals and merchant-profile referrals. A referral materialized from an already-alerted introduction must not create a second alert. Do not backfill historical records or send approval/welcome/marketing messages.

Keep the fixed recipient and three event types server-owned. A claimed outbox row grants a narrow per-message operational lease through the canonical SMTP pause authority. Verify the exact recipient, template/body and claim again at the final transport boundary; reject mixed marketing/seed/receipt purposes and recipient overrides. Preserve the pause epoch and activation barrier for all other messages. Non-production workers do not send live mail.

Reuse the existing partner-intake recovery tick; introduce no new physical queue or timer. Claim with PostgreSQL row locks, deduplicate by source identity, retry only known-unsent failures with bounded backoff, and retain uncertain/crashed-after-dispatch outcomes for review without automatic resend. Use the existing internal-operations sender policy. Store delivery outcomes and expose read-only admin/manager status for post-deploy verification.

Validate atomic rollback and replay, all intake sources, concurrency, failure/crash recovery, HTML/header safety, fixed-recipient/purpose/epoch guards at the real SMTP entry point, no historical backfill, source/schema migration parity and actual intake HTTP handlers. Use disposable databases, fake SMTP and fatal provider/network denial. Run typecheck/build and focused existing partner/pause checks. Production settings, database and deliveries remain unchanged until separately authorized deployment.
