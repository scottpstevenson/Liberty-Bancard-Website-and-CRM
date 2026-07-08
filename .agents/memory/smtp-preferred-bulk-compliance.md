---
name: SMTP-preferred bulk email compliance
description: Why cold-outreach and campaign bulk sends route through SMTP instead of GHL, and what that requires at every send call site.
---

GoHighLevel's `/conversations/messages` API (used by `sendGhlEmail()`) has no way to inject a `List-Unsubscribe` header. Gmail/Yahoo require this header for bulk senders (2024 rules), and GHL's own native Workflows product is the only GHL-side way around it — which this project's owner explicitly does not want to manage (no building/maintaining sequences inside the GHL dashboard).

**Decision:** for bulk/marketing-style sends, prefer SMTP (`sendSmtpEmail()` in `server/services/smtp-email.ts`) over GHL whenever SMTP is configured (`isSmtpConfigured()`), since `sendSmtpEmail` supports `unsubscribeUrl`/`unsubscribeMailto` params that set RFC 2369 `List-Unsubscribe` and RFC 8058 `List-Unsubscribe-Post` headers. Fall back to GHL when SMTP isn't configured, to preserve existing behavior.

**Why:** this keeps the "click a sequence/campaign in our own UI" workflow the user wants, without requiring GHL-side workflow building, while still meeting CAN-SPAM/bulk-sender header requirements.

**How to apply — there are TWO independent bulk-send call sites, both needed fixing:**
1. `server/services/sequence-worker.ts` — cold sequence step sends (gated by `isColdOutreachSequence(sequence)`).
2. `server/services/campaign-engine.ts` — `processSendQueue()`, the "Campaigns" feature (targetListId / ProspectList → bulk marketing send). This one previously had **no compliance footer at all** (no mailing address, no unsubscribe link) — a bigger gap than the header issue. Don't assume fixing one call site covers the other; grep for all `sendGhlEmail(` call sites before considering "bulk email compliance" done.

**Unsubscribe tokens are contact-only.** `generateUnsubscribeToken()` / `/unsubscribe` route only work with a `contactId` (not a raw `prospectId`). `campaign-engine.ts` sends to `Prospect` records that may not have a linked `contactId` — those are skipped (audit-logged as `campaign_send_blocked_no_contact_link`) rather than sent without a working opt-out link. If prospect-to-contact linkage becomes unreliable, this will start silently dropping campaign recipients — check `campaign_send_blocked_no_contact_link` audit logs first.

Both call sites also gate on `compliance_mailing_address` system setting and `APP_URL` being set before sending (reusing the pattern from `getComplianceFooterHtml`), and block/pause with an audit log entry when those secrets are missing.
