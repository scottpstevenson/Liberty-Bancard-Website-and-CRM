---
name: Sender Policy Architecture
description: Central sender-policy registry for all outbound email — approved identities, category→From mapping, prohibition guard, test script.
---

# Sender Policy Architecture

## Rule
All outbound email From/Reply-To addresses MUST be resolved through `server/services/sender-policy.ts` `resolvePolicy()` / `resolveSender()`. Never hard-code addresses or fall back to env vars at a send site.

## Approved Identities
| category      | From address                        | channel         |
|---------------|-------------------------------------|-----------------|
| cold_outreach | Scott@mail.libertybancard.com       | dedicated cold mailbox |
| support       | support@libertybancard.com          | GWS alias       |
| onboarding    | onboarding@libertybancard.com       | GWS alias       |
| security      | security@libertybancard.com         | GWS alias       |
| partners      | partners@libertybancard.com         | GWS alias       |
| accounts      | accounts@libertybancard.com         | GWS alias       |
| internal_ops  | accounts@libertybancard.com         | GWS alias (maps to accounts@) |

All 5 Google Workspace aliases are on scott@libertybancard.com (monitored inbox). The cold-outreach mailbox is Scott@mail.libertybancard.com — a dedicated domain.

## internal_ops Decision
`internal_ops` maps to `accounts@libertybancard.com`. No additional alias needed; accounts@ owns financial/operational communications (rep alerts, digests, statement notifications).

## Prohibition Guard
`isProhibitedAddress()` / `assertNotProhibited()` block any `noreply`, `no-reply`, `donotreply`, `do-not-reply` local-part on `libertybancard.com` or `mail.libertybancard.com`. Runs at every send boundary in smtp-email.ts.

## SMTP `category` param
`sendSmtpEmail({ …, category: "X" })` resolves From/Reply-To from the policy when present. Without `category`, the legacy chain runs with a deprecation warning. All active send sites have been updated to pass `category`.

## GHL sends
`sendGhlEmail` and `sendGhlEmailForMerchant` now accept `fromEmail?`/`fromName?`. GHL `emailReplyMode: "custom"` with `emailFrom: "Name <email>"` controls the visible From. Note: GHL does NOT support a true Reply-To wire header — only SMTP controls Reply-To.

## Key Send-Site Assignments
- sequence-worker SMTP cold path → `category: "cold_outreach"`, `unsubscribeMailto: "Scott@mail.libertybancard.com"`
- sequence-worker GHL path → fromEmail from cold/non-cold branch (`accounts@` for non-cold)
- campaign-engine (both paths) → `cold_outreach`
- merchant-welcome → `onboarding`
- partner-welcome, partner auth → `partners`
- replitAuth security emails → `security`
- statement-chain step6 (rep) → `internal_ops` (→ accounts@)
- statement-chain step9 (merchant) → `accounts`
- proposal-engine, co-branded-proposal, savings, rate-review → `accounts`
- digests, operator-digest, admin test emails → `internal_ops`
- ghl-workflow-enrollment SMTP fallback → `accounts`

## Test Script
`scripts/test-sender-policy.ts` — 82/82 checks, covers registry completeness, prohibition guard, GHL formatting, APPROVED_SENDER_SET, send-site regression guard. Run with `npx tsx scripts/test-sender-policy.ts`.

## outboundGlobalPaused
NOT in featureFlags — stored in `system_settings` table, key `"outboundGlobalPaused"`. Controlled via Admin Activation Panel at `/dashboard/activation`. Must verify manually before enabling any outbound channel.

**Why:** Centralising identity prevents no-reply drift, compliance violations (CAN-SPAM/CASL require a monitored address), and accidental use of the cold-outreach domain for transactional mail.

**How to apply:** When adding any new email send site, pass `category: "X"` to `sendSmtpEmail()` or `fromEmail`/`fromName` to GHL wrappers — never hardcode. When adding a new category, register it in `POLICY_REGISTRY` first.
